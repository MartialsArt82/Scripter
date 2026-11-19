import { getDocument, GlobalWorkerOptions } from './pdf.min.mjs';

const get = id => document.getElementById(id);
const pageNumber = get('page');
const canvas = get('paper');
const status = get('status');
let pdf, pending, painting = false;

GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', import.meta.url).href;

async function render(requested) {
  if (!pdf) return;
  pending = Math.max(1, Math.min(pdf.numPages, Math.round(Number(requested) || 1)));
  if (painting) return;
  painting = true;
  try {
    while (pending) {
      const number = pending;
      pending = null;
      pageNumber.value = number;
      get('back').disabled = number === 1;
      get('next').disabled = number === pdf.numPages;
      const page = await pdf.getPage(number);
      const factor = Number(get('zoom').value) * 96 / 72;
      const viewport = page.getViewport({ scale: factor });
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(viewport.width * pixelRatio);
      canvas.height = Math.round(viewport.height * pixelRatio);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      await page.render({ canvas, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] }).promise;
      canvas.hidden = false;
      canvas.dataset.page = number;
      status.hidden = true;
    }
  } catch (error) {
    status.hidden = false;
    status.textContent = 'Die Seite konnte nicht dargestellt werden. ' + error.message;
  } finally { painting = false; }
}
pageNumber.onchange = () => render(pageNumber.value);
get('back').onclick = () => render(Number(pageNumber.value) - 1);
get('next').onclick = () => render(Number(pageNumber.value) + 1);
get('zoom').onchange = () => render(pageNumber.value);

try {
  const { bytes, theme } = await window.previewData.get();
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  pdf = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useWasm: false }).promise;
  pageNumber.max = pdf.numPages;
  get('total').textContent = '/ ' + pdf.numPages;
  await render(1);
} catch (error) {
  status.textContent = 'Das PDF konnte nicht geladen werden. ' + error.message;
}
