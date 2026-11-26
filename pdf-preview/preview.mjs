import { getDocument, GlobalWorkerOptions } from './pdf.min.mjs';

const get = id => document.getElementById(id);
const reader = get('reader');
const pageNumber = get('page');
const zoomControl = get('zoom');
const book = get('book');
const left = get('left');
const right = get('right');
const status = get('status');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let motionDisabled = false;
let pdf, pageSize, current, pending, requestedPage = 1, painting = false;

GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', import.meta.url).href;

function dimensions() {
  const width = Math.min((reader.clientWidth - 54) / (pageSize.width * 2), (reader.clientHeight - 54) / pageSize.height);
  const scale = Math.max(.2, width) * Number(zoomControl.value);
  return { width: Math.round(pageSize.width * scale), height: Math.round(pageSize.height * scale), scale };
}

async function renderPage(number, size) {
  if (number < 1 || number > pdf.numPages) {
    const blank = document.createElement('div');
    blank.className = 'blank-page';
    blank.setAttribute('aria-hidden', 'true');
    return blank;
  }
  const page = await pdf.getPage(number);
  const viewport = page.getViewport({ scale: size.scale });
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width * ratio);
  canvas.height = Math.round(viewport.height * ratio);
  canvas.dataset.page = number;
  canvas.setAttribute('aria-label', t("Druckseite {number}", { number }));
  await page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] }).promise;
  return canvas;
}

async function turn(direction, oldLeft, oldRight, nextLeft, nextRight) {
  const leaf = document.createElement('div');
  const forward = direction > 0;
  leaf.className = 'turning-leaf ' + (forward ? 'forward' : 'backward');
  leaf.setAttribute('aria-hidden', 'true');
  const front = document.createElement('div');
  const rear = document.createElement('div');
  front.className = 'leaf-face front';
  rear.className = 'leaf-face rear';
  front.append(forward ? oldRight : oldLeft);
  rear.append(forward ? nextLeft : nextRight);
  leaf.append(front, rear);
  left.replaceChildren(forward ? oldLeft : nextLeft);
  right.replaceChildren(forward ? nextRight : oldRight);
  book.append(leaf);
  const animation = leaf.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${forward ? -180 : 180}deg)` }], {
    duration: 540, easing: 'cubic-bezier(.25,.68,.26,1)', fill: 'forwards'
  });
  try { await animation.finished; } finally { leaf.remove(); }
}

function updateControls() {
  const last = Math.floor(pdf.numPages / 2) * 2;
  get('back').disabled = painting || !current?.spread;
  get('next').disabled = painting || current?.spread >= last;
  pageNumber.disabled = painting;
  if (current) pageNumber.value = Math.max(1, current.spread);
}

async function showSpread(requested, animate = true) {
  if (!pdf) return;
  requestedPage = Math.min(pdf.numPages, Math.max(1, Math.round(Number(requested) || 1)));
  pending = { spread: Math.floor(requestedPage / 2) * 2, animate };
  if (painting) return;
  painting = true;
  updateControls();
  try {
    while (pending) {
      const { spread, animate } = pending;
      pending = null;
      const size = dimensions();
      if (current?.spread === spread && size.width === current.size.width && size.height === current.size.height) continue;
      const [nextLeft, nextRight] = await Promise.all([renderPage(spread, size), renderPage(spread + 1, size)]);
      book.style.setProperty('--page-width', size.width + 'px');
      book.style.setProperty('--page-height', size.height + 'px');
      get('book-space').hidden = false;
      if (current && animate && !motionDisabled && !reduceMotion.matches && Math.abs(spread - current.spread) === 2
        && current.size.width === size.width && current.size.height === size.height) {
        await turn(spread - current.spread, left.firstChild, right.firstChild, nextLeft, nextRight);
      }
      left.replaceChildren(nextLeft);
      right.replaceChildren(nextRight);
      current = { spread, size };
      const pages = [spread, spread + 1].filter(number => number > 0 && number <= pdf.numPages);
      get('current-spread').textContent = t("Druckseiten {pages} von {total}", { pages: new Intl.ListFormat(document.documentElement.lang).format(pages.map(String)), total: pdf.numPages });
      status.hidden = true;
    }
  } catch (error) {
    status.hidden = false;
    status.textContent = t("Die Seite konnte nicht dargestellt werden.") + ' ' + error.message;
  } finally {
    painting = false;
    updateControls();
  }
}

const previous = () => showSpread((current?.spread ?? 0) - 2);
const next = () => showSpread((current?.spread ?? 0) + 2);
pageNumber.onchange = () => showSpread(pageNumber.value);
get('back').onclick = previous;
get('next').onclick = next;
zoomControl.onchange = () => showSpread(requestedPage, false);
document.addEventListener('keydown', event => {
  if (event.target.matches('input, select') || painting) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); previous(); }
  if (event.key === 'ArrowRight') { event.preventDefault(); next(); }
});

function updateWindowControls(status) {
  const controls = get('preview-window-buttons');
  controls.hidden = !status.linuxControls;
  document.body.classList.toggle('custom-window', status.linuxControls);
  const maximize = controls.querySelector('[data-action="toggle-maximize"]');
  const label = status.maximized ? t("Fenster wiederherstellen") : t("Fenster maximieren");
  maximize.textContent = status.maximized ? '❐' : '□';
  maximize.setAttribute('aria-label', label);
  maximize.title = label;
}
for (const button of get('preview-window-buttons').querySelectorAll('button')) {
  button.onclick = () => window.previewData.windowControl(button.dataset.action).then(updateWindowControls).catch(error => {
    status.textContent = error.message;
    status.hidden = false;
  });
}
window.previewData.onWindowState(updateWindowControls);
try {
  const { bytes, theme, access, window: windowStatus } = await window.previewData.get();
  updateWindowControls(windowStatus);
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.highContrast = String(access.highContrast);
  document.documentElement.dataset.strongFocus = String(access.strongFocus);
  motionDisabled = access.reduceMotion;
  pdf = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useWasm: false }).promise;
  pageSize = (await pdf.getPage(1)).getViewport({ scale: 1 });
  pageNumber.max = pdf.numPages;
  get('total').textContent = '/ ' + pdf.numPages;
  await showSpread(1, false);
  new ResizeObserver(() => showSpread(requestedPage, false)).observe(reader);
} catch (error) {
  status.textContent = t("Das PDF konnte nicht geladen werden.") + ' ' + error.message;
}
