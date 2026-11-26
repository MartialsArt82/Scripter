'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const editor = $('#manuscript');
const modal = $('#modal');
const mobile = window.desk.mobile === true;
if (mobile) {
  document.body.classList.add('mobile-app');
  $('#mobile-navigation').hidden = false;
  $('#mobile-tools').hidden = false;
  $('#mobile-navigation').onclick = () => toggleMobilePanel('navigation');
  $('#mobile-tools').onclick = () => toggleMobilePanel('tools');
  $('#mobile-scrim').onclick = closeMobilePanels;
}
function toggleMobilePanel(name) {
  const panel = document.body.dataset.mobilePanel === name ? '' : name;
  document.body.dataset.mobilePanel = panel;
  $('#mobile-navigation').setAttribute('aria-expanded', String(panel === 'navigation'));
  $('#mobile-tools').setAttribute('aria-expanded', String(panel === 'tools'));
  $('#mobile-scrim').hidden = !panel;
}
function closeMobilePanels() {
  if (mobile && document.body.dataset.mobilePanel) toggleMobilePanel(document.body.dataset.mobilePanel);
}
const langs = { de: 'Deutsch', en: 'Englisch', es: 'Spanisch', pt: 'Portugiesisch', fr: 'Französisch' };
const types = { text: 'Textdatei', image: 'Bild', pdf: 'PDF', audio: 'Audio', video: 'Video', web: 'Webseite', file: 'Datei' };
const icons = { text: 'file-text', image: 'image', pdf: 'file-text', audio: 'headphones', video: 'video', web: 'globe', file: 'file' };
let readingAccess = appearance.normalizeAccess();
const exportsList = { pdf: 'PDF · Buchsatz', docx: 'DOCX · Word', doc: 'DOC · Word 97–2003', odt: 'ODT · OpenDocument', epub: 'EPUB 3 · E-Book', rtf: 'RTF · Rich Text', txt: 'TXT · Reintext', markdown: 'Markdown', html: 'HTML', latex: 'LaTeX', icml: 'ICML · Adobe InCopy' };
const trueWords = /[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = value => Number(value).toLocaleString(document.documentElement.lang);
const cleanOptions = {
  ALLOWED_TAGS: ['a','b','blockquote','br','code','del','div','em','font','h1','h2','h3','h4','h5','h6','hr','i','img','li','ol','p','pre','s','span','strike','strong','sub','sup','table','tbody','td','th','thead','tr','u','ul'],
  ALLOWED_ATTR: ['alt','colspan','rowspan','href','src','style','align','dir','title']
};
DOMPurify.addHook('uponSanitizeAttribute', (_node, event) => {
  if (event.attrName === 'src' && !/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-z0-9+/=]+$/i.test(event.attrValue)) event.keepAttr = false;
  if (event.attrName === 'href' && !/^https?:\/\//i.test(event.attrValue)) event.keepAttr = false;
  if (event.attrName === 'style') {
    event.attrValue = event.attrValue.split(';').map(value => value.trim()).filter(value => /^(?:text-align:\s*(?:left|right|center|justify)|text-decoration(?:-line)?:\s*(?:underline|line-through)|font-style:\s*italic|font-weight:\s*(?:bold|[1-9]00))$/i.test(value)).join('; ');
  }
});
const sanitize = html => DOMPurify.sanitize(html, cleanOptions);
const chapter = () => state.chapters.find(item => item.id === state.active) || state.chapters[0];
const words = text => String(text).match(trueWords) || [];
const counts = new Map();
let state, view = 'editor', saveTimer, toastTimer, selection, modalAction, recording, transcribing = false, projectDialogBusy = false, imports = 0, dragDepth = 0, spellRequest = 0, lookupRequest = 0;
let dirty = false;

function decorate(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    if (node.firstElementChild) continue;
    const image = document.createElement('span');
    image.style.setProperty('--icon-image', `url("icons/${node.dataset.icon}.svg")`);
    image.className = 'svg-icon';
    image.setAttribute('aria-hidden', 'true');
    node.append(image);
  }
}
function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  node.dataset.error = String(error);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 12500 : 3800);
}
function errorToast(error) {
  toast(t(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')), true);
}
function queueSave() {
  dirty = true;
  $('#save-status').textContent = t("Speichert …");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 380);
}
function flush() {
  clearTimeout(saveTimer);
  if (!dirty || !state) return true;
  const result = window.desk.flush(state);
  const saved = result === true;
  dirty = !saved;
  $('#save-status').textContent = saved ? t("Lokal gespeichert") : t("Speichern fehlgeschlagen");
  if (!saved) toast(typeof result === 'string' ? result : t("Das Projekt konnte nicht gespeichert werden."), true);
  return saved;
}
function refreshMetrics() {
  const count = counts.get(chapter().id) || 0;
  const target = Number(chapter().goal) || 0;
  const pc = target ? Math.round(count / target * 100) : 0;
  $('#total-words').textContent = number([...counts.values()].reduce((total, next) => total + next, 0)) + ' ' + t("Wörter");
  $('#chapter-metrics').textContent = number(count) + ' ' + (count === 1 ? t("Wort") : t("Wörter")) + ' · ' + number(editor.innerText.length) + ' ' + t("Zeichen");
  $('#status-count').textContent = view === 'editor' ? $('#chapter-metrics').textContent : '';
  $('#goal-current').textContent = number(count);
  $('#goal-amount').textContent = target ? '/ ' + number(target) + ' ' + t("Wörter") : t("Wörter");
  $('#goal-progress').hidden = !target;
  $('#goal-progress').value = Math.min(100, pc);
  $('#goal-caption').textContent = !target ? t("Kein Wortziel") : count >= target ? t("Ziel erreicht") : t("{percent} % erreicht", { percent: number(pc) });
}
function edited() {
  const item = chapter();
  item.html = editor.innerHTML === '<br>' ? '' : editor.innerHTML;
  counts.set(item.id, words(editor.innerText).length);
  $('#spell-result').replaceChildren();
  spellRequest++;
  refreshMetrics();
  queueSave();
}
function renderProject() {
  $('#project-name').textContent = state.title;
  const category = appearance.categories[state.category] ?? appearance.categories.general;
  $('#project-category').textContent = t(category.label);
  const symbol = $('#project-menu .project-symbol');
  symbol.dataset.icon = category.icon;
  symbol.replaceChildren();
  decorate($('#project-menu'));
  applyAppearance(state.accent, state.settings.theme, readingAccess);
  $('#crumb-project').textContent = state.title;
  $('#book-cover h2').textContent = state.title;
  $('#book-cover p').textContent = state.author;
}
function renderChapters() {
  $('#chapter-list').innerHTML = state.chapters.map((item, index) => `<div class="chapter-row ${item.id === chapter().id ? 'current' : ''}">
    <button class="choose-chapter" data-id="${esc(item.id)}" ${item.id === chapter().id ? 'aria-current="true"' : ''}><span class="order">${String(index + 1).padStart(2,'0')}</span><span>${esc(item.title || t("Ohne Titel"))}</span></button>
    <button class="icon-button chapter-options" data-id="${esc(item.id)}" data-icon="ellipsis" title="${esc(t("Kapiteloptionen"))}" aria-label="${esc(t("Kapiteloptionen"))}"></button></div>`).join('');
  decorate($('#chapter-list'));
}
function renderChapter() {
  const item = chapter();
  state.active = item.id;
  selection = null;
  $('#chapter-number').textContent = t("Kapitel") + ' ' + String(state.chapters.indexOf(item) + 1).padStart(2, '0');
  $('#chapter-title').value = item.title;
  $('#intent').value = item.intent || '';
  editor.innerHTML = sanitize(item.html || '');
  $('#spell-result').replaceChildren();
  spellRequest++;
  refreshMetrics();
  renderChapters();
}
function renderPreferences() {
  const settings = state.settings;
  applyAppearance(state.accent, settings.theme, readingAccess);
  document.documentElement.style.setProperty('--manuscript-font', appearance.fontStack(settings.font));
  editor.lang = settings.lang;
  $('#spell-language').value = settings.lang;
  $('#dictionary-language').value = settings.lang;
  $('#theme').replaceChildren();
  $('#theme').dataset.icon = settings.theme === 'dark' ? 'sun' : 'moon';
  decorate();
  const zoom = readingAccess.zoom ?? settings.zoom;
  $('#status-zoom').textContent = zoom + ' %';
  window.desk.zoom(zoom).catch(errorToast);
  window.desk.spell([], settings.lang).catch(errorToast);
}
function paragraphs(text) {
  return text.split(/\r?\n(?:[\t ]*\r?\n)*/).filter(line => line.trim()).map(line => '<p>' + esc(line) + '</p>').join('');
}
function selectionInEditor() {
  const current = getSelection();
  if (!current?.rangeCount) return null;
  const range = current.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) ? range : null;
}
function rememberSelection() {
  const current = selectionInEditor();
  if (current) selection = { range: current.cloneRange(), chapter: chapter().id, text: current.toString() };
}
function restoreSelection() {
  editor.focus();
  const current = getSelection();
  current.removeAllRanges();
  if (selection?.chapter === chapter().id && editor.contains(selection.range.commonAncestorContainer)) {
    current.addRange(selection.range);
  } else {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    current.addRange(range);
  }
}
function runEdit(command, value = null) {
  restoreSelection();
  document.execCommand(command, false, value);
  rememberSelection();
  edited();
  formatState();
}
function insertContent(html, target = chapter().id) {
  const item = state.chapters.find(entry => entry.id === target);
  if (!item) { toast(t("Das ursprüngliche Kapitel wurde entfernt."), true); return; }
  const content = sanitize(html);
  if (!content) return;
  if (chapter().id === target) {
    showView('editor');
    runEdit('insertHTML', content);
  } else {
    item.html = sanitize(item.html) + content;
    countChapter(item);
    refreshMetrics();
    queueSave();
  }
}
function countChapter(item) {
  const container = document.createElement('div');
  container.innerHTML = sanitize(item.html || '');
  for (const node of container.querySelectorAll('br,p,div,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote,hr')) node.append(' ');
  counts.set(item.id, words(container.textContent).length);
}
function startProject(next) {
  state = next;
  state.settings = { theme: 'light', font: 'Georgia', zoom: 100, lang: 'de', speech: 'auto', trim: 'trade', margins: 19, size: 11, leading: 1.5, pageNumbers: true, ...state.settings };
  counts.clear();
  for (const item of state.chapters) countChapter(item);
  dirty = false;
  renderProject();
  renderChapter();
  renderPreferences();
  renderLayout();
  renderMaterials();
  showView('editor');
}
function showView(name) {
  if (view === 'storyboard' && name !== 'storyboard') cancelLink();
  view = name;
  if (name !== 'editor') document.body.classList.remove('focus');
  closeMobilePanels();
  if (mobile) $('#mobile-tools').hidden = name !== 'editor';
  for (const button of $$('[data-view]')) {
    button.classList.toggle('active', button.dataset.view === name);
    if (button.dataset.view === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const key of ['editor','storyboard','material','layout']) $('#' + key + '-view').hidden = key !== name;
  $('#crumb-view').textContent = { editor: t("Schreiben"), storyboard: t("Storyboard"), material: t("Material"), layout: t("Buchsatz") }[name];
  if (name === 'storyboard') renderStoryboard();
  refreshMetrics();
}
function openModal(title, content, action, verb = t("Speichern")) {
  $('#modal-title').textContent = title;
  $('#modal-content').onclick = null;
  $('#modal-content').innerHTML = content;
  $('#confirm-modal').textContent = verb;
  $('#confirm-modal').hidden = !action;
  $('#confirm-modal').disabled = false;
  $('#cancel-modal').textContent = action ? t("Abbrechen") : t("Schließen");
  modalAction = action;
  decorate(modal);
  if (!modal.open) modal.showModal();
}
const field = (label, html) => `<label class="modal-field"><span>${esc(label)}</span>${html}</label>`;
const option = (value, label, selected) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
function formatState() {
  for (const button of $$('[data-command]')) {
    if (['undo','redo'].includes(button.dataset.command)) continue;
    const active = Boolean(selectionInEditor() && document.queryCommandState(button.dataset.command));
    button.classList.toggle('on', active);
    button.setAttribute('aria-pressed', String(active));
  }
  if (selectionInEditor()) {
    const value = document.queryCommandValue('formatBlock');
    if ([...$('#block').options].some(item => item.value === value)) $('#block').value = value;
    else $('#block').value = 'p';
  }
}
function newChapter() {
  closeMobilePanels();
  openModal(t("Kapitel hinzufügen"), field(t("Kapiteltitel"), '<input name="title" required maxlength="150" autofocus>'), data => {
    const title = String(data.get('title')).trim();
    if (!title) throw new Error(t("Bitte gib einen Kapiteltitel ein."));
    const item = { id: crypto.randomUUID(), title, goal: 1500, intent: '', html: '' };
    state.chapters.push(item);
    state.active = item.id;
    countChapter(item);
    renderChapter();
    showView('editor');
    queueSave();
  }, t("Hinzufügen"));
}
function chapterOptions(id) {
  const item = state.chapters.find(entry => entry.id === id);
  const index = state.chapters.indexOf(item);
  openModal(item.title || t("Kapitel"), `<div class="actions"><button type="button" class="secondary" id="move-up" ${index === 0 ? 'disabled' : ''}>${esc(t("Nach oben"))}</button><button type="button" class="secondary" id="move-down" ${index === state.chapters.length - 1 ? 'disabled' : ''}>${esc(t("Nach unten"))}</button><button type="button" class="secondary" id="delete-chapter" ${state.chapters.length === 1 ? 'disabled' : ''}>${esc(t("Löschen …"))}</button></div>`);
  const move = offset => {
    state.chapters.splice(index, 1);
    state.chapters.splice(index + offset, 0, item);
    if (item.id === chapter().id) $('#chapter-number').textContent = t("Kapitel") + ' ' + String(index + offset + 1).padStart(2,'0');
    else $('#chapter-number').textContent = t("Kapitel") + ' ' + String(state.chapters.indexOf(chapter()) + 1).padStart(2,'0');
    renderChapters();
    queueSave();
    modal.close();
  };
  $('#move-up').onclick = () => move(-1);
  $('#move-down').onclick = () => move(1);
  $('#delete-chapter').onclick = () => {
    openModal(t("Kapitel löschen?"), `<p>${esc(t("„{title}“ und sein Manuskripttext werden aus dem Projekt entfernt.", { title: item.title }))}</p>`, () => {
      state.chapters.splice(index, 1);
      for (const note of state.storyboard) note.chapters = note.chapters.filter(chapterId => chapterId !== id);
      counts.delete(id);
      if (state.active === id) { state.active = state.chapters[Math.min(index, state.chapters.length - 1)].id; renderChapter(); }
      else {
        renderChapters();
        $('#chapter-number').textContent = t("Kapitel") + ' ' + String(state.chapters.indexOf(chapter()) + 1).padStart(2,'0');
        refreshMetrics();
      }
      queueSave();
    }, t("Löschen"));
  };
}
const cloudProviders = { google: 'Google Drive', onedrive: 'OneDrive', dropbox: 'Dropbox', icloud: 'iCloud Drive', other: 'Anderer Anbieter' };
async function settingsDialog() {
  const settings = state.settings;
  const locations = await window.desk.locations();
  const access = appearance.normalizeAccess(locations.access);
  const locationField = (label, name) => `<div class="modal-field"><span>${esc(label)}</span><div class="location-field">
    <input id="${name}-path" aria-label="${esc(label)}" readonly>
    <button type="button" id="${name}-choose" class="secondary">${esc(t("Auswählen"))}</button>
    <button type="button" id="${name}-clear" class="text-button">${esc(t("Entfernen"))}</button>
  </div></div>`;
  closeMobilePanels();
  openModal(t("Einstellungen"), [
    field(t("Oberflächensprache"), `<select name="uiLanguage">${Object.entries(scripterI18n.languages).map(([key, label]) => option(key, label, locations.uiLanguage)).join('')}</select>`),
    field(t("Darstellung"), `<select name="theme">${option('light',t("Hell"),settings.theme)}${option('dark',t("Dunkel"),settings.theme)}</select>`),
    fontPreview(settings.font),
    field(t("Bildschirmskalierung"), `<select name="zoom">${appearance.zoomLevels.map(zoom => option(zoom,zoom + ' %',access.zoom ?? settings.zoom)).join('')}</select>`),
    `<div class="settings-support"><button type="button" id="kofi-support" aria-label="${esc(t("Scripter auf Ko-fi unterstützen (öffnet den Browser)"))}">
      <img src="assets/kofi-${settings.theme === 'dark' ? 'beige' : 'dark'}.avif" width="980" height="198" alt="">
    </button></div>`,
    accessibilityFields(access),
    field(t(mobile ? "Diktatsprache" : "Transkriptsprache"), `<select name="speech">${Object.entries({auto:'Automatisch', ...(mobile ? langs : { de: 'Deutsch', en: 'Englisch' })}).map(([lang,label]) => option(lang,t(label),settings.speech)).join('')}</select>`),
    ...(!mobile ? [
    ("<h3>" + esc(t("Speicherorte")) + "</h3>"),
    locationField(t("Wunschort für neue lokale Projekte"), 'preferred'),
    ("<h3>" + esc(t("Cloud-Synchronisation")) + "</h3>"),
    field(t("Anbieter"), `<select id="cloud-provider">${Object.entries(cloudProviders).map(([key,label]) => option(key,t(label),locations.provider)).join('')}</select>`),
    locationField(t("Synchronisierter Ordner"), 'cloud'),
    ("<p>" + esc(t("Wähle einen lokal eingebundenen Ordner deines Anbieters. Sein Sync-Programm gleicht die Dateien ab. Im Projektmenü kannst du Cloud-Projekte anlegen, öffnen oder eine Kopie dorthin speichern.")) + "</p>"),
    ("<p>" + esc(t("Für Diktat und Transkripte brauchst du Python 3.12. Bei der Einrichtung wird das mehrsprachige Whisper-Modell heruntergeladen. Die Erkennung läuft danach lokal.")) + "</p><button id=\"speech-setup\" type=\"button\" class=\"secondary\">" + esc(t("Spracherkennung einrichten")) + "</button><p id=\"setup-status\" role=\"status\"></p>")
    ] : [`<p>${esc(t("Android verwendet für Diktat die Spracherkennung des Geräts."))}</p>`] )
  ].join(''), async data => {
    locations.uiLanguage = data.get('uiLanguage');
    locations.access = appearance.normalizeAccess({
      zoom: Number(data.get('zoom')), textSize: Number(data.get('textSize')), lineHeight: Number(data.get('lineHeight')),
      highContrast: data.has('highContrast'), strongFocus: data.has('strongFocus'), reduceMotion: data.has('reduceMotion')
    });
    readingAccess = (await window.desk.saveLocations(locations)).access;
    for (const name of ['theme','font','speech']) settings[name] = data.get(name);
    settings.zoom = readingAccess.zoom;
    if (locations.uiLanguage !== scripterI18n.getLanguage()) applyInterfaceLanguage(locations.uiLanguage);
    renderPreferences();
    renderLayout();
    queueSave();
  });
  $('#kofi-support').onclick = () => window.desk.openKofi().catch(errorToast);
  $('#font-picker').onchange = event => {
    if (event.target.name !== 'font') return;
    const name = event.target.value;
    $('#selected-font').textContent = name;
    $('#selected-font').style.fontFamily = appearance.fontStack(name);
  };
  if (mobile) return;
  const refreshLocations = () => {
    $('#preferred-path').value = locations.preferred;
    $('#preferred-path').placeholder = t("Standardordner (Dokumente)");
    $('#preferred-clear').disabled = !locations.preferred;
    $('#cloud-path').value = locations.clouds[locations.provider] || '';
    $('#cloud-path').placeholder = t("Ordner auswählen");
    $('#cloud-clear').disabled = !locations.clouds[locations.provider];
  };
  $('#cloud-provider').onchange = event => { locations.provider = event.target.value; refreshLocations(); };
  for (const mode of ['preferred','cloud']) {
    const assign = (provider, value) => {
      if (mode === 'preferred') locations.preferred = value;
      else locations.clouds[provider] = value;
      if ($('#' + mode + '-path')) refreshLocations();
    };
    $('#' + mode + '-choose').onclick = async () => {
      const current = $('#' + mode + '-path');
      const provider = locations.provider;
      try {
        const chosen = await window.desk.chooseFolder(current.value);
        if (chosen && current.isConnected) assign(provider, chosen);
      } catch (error) { errorToast(error); }
    };
    $('#' + mode + '-clear').onclick = () => assign(locations.provider, '');
  }
  refreshLocations();
  $('#speech-setup').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    $('#setup-status').textContent = t("Pakete und Modell werden heruntergeladen …");
    try {
      await window.desk.setup();
      if (button.isConnected) $('#setup-status').textContent = t("Spracherkennung ist eingerichtet.");
      else toast(t("Spracherkennung ist eingerichtet."));
    } catch (error) {
      if (button.isConnected) $('#setup-status').textContent = t("Einrichtung fehlgeschlagen. Siehe Hilfe.");
      errorToast(error);
    } finally { button.disabled = false; }
  };
}
function renderMaterials() {
  $('#material-list').innerHTML = state.assets.map(item => {
    const id = esc(item.id);
    const media = ['audio','video'].includes(item.kind);
    const preview = item.kind === 'image' && /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(item.file || '');
    const insertable = mobile ? ['image', 'web'].includes(item.kind) || /\.(?:txt|md|markdown|csv)$/i.test(item.file || '') : ['text','image','pdf','web'].includes(item.kind);
    return `<article class="asset" data-id="${id}">
      ${preview ? `<img src="${mobile ? esc(window.desk.materialUrl(item)) : 'romanasset://' + id + '/vorschau'}" alt="">` : `<span class="panel-icon" data-icon="${icons[item.kind] || 'file'}"></span>`}
      <div class="asset-info"><strong>${esc(item.name)}</strong><small>${esc(item.url || t(types[item.kind] || "Datei"))}</small></div>
      <button class="secondary" data-asset="open">${esc(t("Öffnen"))}</button>
      ${media && !mobile ? ("<button class=\"secondary\" data-asset=\"transcribe\">" + esc(t("Transkribieren")) + "</button>") : ''}
      ${item.transcript ? ("<button class=\"secondary\" data-asset=\"transcript\">" + esc(t("Transkript ansehen")) + "</button>") : ''}
      ${insertable ? ("<button class=\"secondary\" data-asset=\"insert\">" + esc(t("Ins Kapitel")) + "</button>") : ''}
      <button class="icon-button" data-asset="delete" aria-label="${esc(t("Material entfernen"))}" title="${esc(t("Material entfernen"))}" data-icon="trash-2"></button>
    </article>`;
  }).join('');
  decorate($('#material-list'));
}
async function importFiles(files, urls = []) {
  if (!files.length && !urls.length) return;
  imports++;
  try {
    let errors = [];
    if (files.length) {
      const result = await window.desk.add(files);
      state.assets = result.assets;
      errors = result.errors;
    }
    for (const url of urls) state.assets = await window.desk.addLink(url);
    if (mobile) { queueSave(); flush(); }
    renderMaterials();
    showView('material');
    if (errors.length) toast(t("Diese Dateien konnten nicht importiert werden: {files}", { files: errors.join(', ') }), true);
  } catch (error) { errorToast(error); }
  finally { imports--; }
}
function formatTime(seconds) {
  const time = Math.floor(seconds);
  return String(Math.floor(time / 60)).padStart(2,'0') + ':' + String(time % 60).padStart(2,'0');
}
function showTranscript(result, name, target, assetId) {
  const timed = result.segments.map(segment => '[' + formatTime(segment.start) + '] ' + segment.text).join('\n');
  const corrected = result.segments.some(segment => segment.originalText != null);
  const original = corrected ? result.segments.map(segment => segment.originalText ?? segment.text).join('\n') : '';
  const value = result.segments.map(segment => segment.text).join('\n');
  if (!value) { toast(t("Es wurde keine Sprache erkannt.")); return; }
  openModal(name, `<p>${esc(t(langs[result.language] || result.language))} · ${esc(t("{count} Abschnitte", { count: number(result.segments.length) }))}</p>
    <textarea id="transcript-text" rows="10" aria-label="${esc(t("Transkript"))}" readonly>${esc(timed)}</textarea>
    ${corrected ? `<details class="speech-original"><summary>${esc(t("Ursprüngliche Erkennung anzeigen"))}</summary><textarea id="transcript-original" rows="5" aria-label="${esc(t("Ursprüngliche Erkennung"))}" readonly>${esc(original)}</textarea></details>` : ''}
    <button type="button" id="learn-transcript" class="secondary">${esc(t("Markierung lernen"))}</button>`, () => {
    modal.close();
    insertContent(paragraphs(value), target);
  }, t("Ins Kapitel"));
  $('#learn-transcript').onclick = () => {
    const selected = [...$('#modal-content').querySelectorAll('textarea')].find(textarea =>
      textarea.selectionEnd > textarea.selectionStart);
    const marked = selected?.value.slice(selected.selectionStart, selected.selectionEnd).trim();
    if (!marked) return toast(t("Markiere zuerst das Wort oder die Wendung im Transkript."));
    if (marked.length > 160 || /\[\d+:\d+\]/.test(marked)) return toast(t("Markiere höchstens 160 Zeichen ohne Zeitstempel."));
    editSpeechRule({
      marked,
      language: ['de','en'].includes(result.language) ? result.language : 'any',
      onSaved: async () => {
        if (!flush()) throw new Error(t("Das Sprachwörterbuch konnte nicht gespeichert werden."));
        const updated = await window.desk.refreshTranscript(result);
        state.assets = await window.desk.saveTranscript(assetId, updated);
        showTranscript(updated, name, target, assetId);
      }
    });
  };
}
function renderLayout() {
  const settings = state.settings;
  const form = $('#layout-settings');
  for (const key of ['trim','margins','size','leading']) form.elements[key].value = settings[key];
  form.elements.pageNumbers.checked = settings.pageNumbers;
  const ratios = { trade: '.628', pocket: '.632', a5: '.705', a4: '.707', us: '.667' };
  $('#book-cover').style.setProperty('--ratio', ratios[settings.trim] || '.628');
  $('#book-cover').style.fontFamily = appearance.fontStack(settings.font);
  $('#book-cover h2').style.fontFamily = 'inherit';
}
function manuscript(scope = 'book') {
  return { title: state.title, author: state.author, settings: state.settings, chapters: (scope === 'chapter' ? [chapter()] : state.chapters).map(item => ({ title: item.title || t("Ohne Titel"), html: sanitize(item.html) })) };
}
function publicationDialog() {
  const content = '<div class="export-grid">' + Object.entries(exportsList).filter(([key]) => !mobile || window.desk.exportFormats.includes(key)).map(([key,label]) => `<label><input type="radio" name="format" value="${key}" ${key === 'pdf' ? 'checked' : ''}>${esc(t(label))}</label>`).join('') + '</div>'
    + (mobile ? '' : "<p>" + esc(t("Für das ältere Word-Format DOC ist LibreOffice erforderlich.")) + "</p>")
    + field(t("Umfang"), ("<select name=\"scope\"><option value=\"book\">" + esc(t("Gesamtes Manuskript")) + "</option><option value=\"chapter\">" + esc(t("Aktuelles Kapitel")) + "</option></select>"));
  openModal(t("Manuskript exportieren"), content, async data => {
    const result = await window.desk.publish(data.get('format'), manuscript(data.get('scope')));
    if (result === true) toast(t("Manuskript exportiert."));
    else if (!result) return false;
  }, t("Exportieren"));
}
function toggleFocus() {
  document.body.classList.toggle('focus');
  $('#focus-mode').setAttribute('aria-pressed', String(document.body.classList.contains('focus')));
}
async function dictate() {
  if (recording) return recording.stop();
  if (transcribing) return toast(t("Eine Transkription läuft bereits."));
  const target = chapter().id;
  if (mobile) {
    transcribing = true;
    try {
      const content = await window.desk.dictate(state.settings.speech === 'auto' ? state.settings.lang : state.settings.speech, state.speechRules);
      if (content) insertContent(paragraphs(content), target);
    } catch (error) { errorToast(error); }
    finally { transcribing = false; }
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const recorder = new MediaRecorder(stream);
    recording = recorder;
    $('#dictate').classList.add('recording');
    $('#dictate span:last-child').textContent = t("Stopp");
    $('#dictate').setAttribute('aria-label', t("Diktat stoppen"));
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      for (const track of stream.getTracks()) track.stop();
      recording = null;
      $('#dictate').classList.remove('recording');
      $('#dictate span:last-child').textContent = t("Diktat");
      $('#dictate').setAttribute('aria-label', t("Diktat starten"));
      transcribing = true;
      toast(t("Das Diktat wird transkribiert …"));
      try {
        const bytes = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer();
        if (!flush()) return;
        const result = await window.desk.transcribe({ bytes }, state.settings.speech);
        const content = result.segments.map(segment => segment.text).join(' ');
        if (content) { insertContent(paragraphs(content), target); toast(t("Diktat eingefügt.")); }
        else toast(t("Es wurde keine Sprache erkannt."));
      } catch (error) { errorToast(error); }
      finally { transcribing = false; }
    };
    recorder.start(1000);
  } catch (error) {
    if (stream) for (const track of stream.getTracks()) track.stop();
    errorToast(error);
  }
}

$('#modal-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!modalAction) return modal.close();
  if ($('#confirm-modal').disabled) return;
  $('#confirm-modal').disabled = true;
  try {
    const result = await modalAction(new FormData(event.currentTarget));
    if (result !== false) modal.close();
  } catch (error) { errorToast(error); }
  finally { $('#confirm-modal').disabled = false; }
});
$('#close-modal').onclick = $('#cancel-modal').onclick = () => { if (!$('#confirm-modal').disabled) modal.close(); };
modal.addEventListener('cancel', event => { if ($('#confirm-modal').disabled) event.preventDefault(); });
for (const button of $$('[data-view]')) button.onclick = () => showView(button.dataset.view);
$('#new-chapter').onclick = $('#add-chapter').onclick = newChapter;
$('#settings').onclick = $('#status-zoom').onclick = () => settingsDialog().catch(errorToast);
$('#theme').onclick = () => {
  state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
  renderPreferences();
  queueSave();
};
$('#help').onclick = () => {
  if (!mobile) return window.desk.help().catch(errorToast);
  openModal(t("Hilfe"), `<p>${esc(t("Öffne die Navigation, um ein Projekt oder Kapitel auszuwählen. Über die Kapitelwerkzeuge bearbeitest du das Schreibziel und prüfst die Rechtschreibung."))}</p>
    <p>${esc(t("Sichere dein Projekt als ZIP, um es mit Material auf ein anderes Gerät zu übertragen. Android kann die ZIP-Datei sowie eine einzelne roman.json öffnen."))}</p>
    <p>${esc(t("Android nutzt die Diktierfunktion des Geräts. Die Transkription importierter Audio- und Videodateien sowie der vollständige Drucksatz stehen in der Desktop-App zur Verfügung."))}</p>`);
};
$('#export').onclick = publicationDialog;
$('#preview').onclick = () => {
  if (!mobile) return window.desk.publish('preview', manuscript()).catch(errorToast);
  openModal(t("Satzvorschau"), '<div class="mobile-book">' + window.desk.publicationMarkup(manuscript()) + '</div>');
};
window.closeScripterPanel = () => {
  if (modal.open && !$('#confirm-modal').disabled) modal.close();
  else if (document.body.dataset.mobilePanel) closeMobilePanels();
  else return false;
  return true;
};
$('#focus-mode').onclick = toggleFocus;
$('#dictate').onclick = dictate;
$('#chapter-list').addEventListener('click', event => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  if (button.classList.contains('chapter-options')) return chapterOptions(button.dataset.id);
  openChapter(button.dataset.id);
});
function openChapter(id) {
  if (!state.chapters.some(item => item.id === id)) return;
  if (state.active !== id) {
    state.active = id;
    renderChapter();
    queueSave();
  }
  showView('editor');
}
$('#project-menu').onclick = () => {
  const menu = $('#project-options');
  menu.hidden = !menu.hidden;
  $('#project-menu').setAttribute('aria-expanded', String(!menu.hidden));
};
document.addEventListener('click', event => {
  if (!event.target.closest('#project-menu') || event.target.closest('[data-project]')) {
    $('#project-options').hidden = true;
    $('#project-menu').setAttribute('aria-expanded', 'false');
  }
});
for (const button of $$('[data-project]')) button.onclick = async () => {
  const action = button.dataset.project;
  closeMobilePanels();
  if (action === 'meta') {
    openModal(t("Projektangaben"), field(t("Romantitel"), `<input name="title" value="${esc(state.title)}" maxlength="180" required>`) + field(t("Autorin oder Autor"), `<input name="author" value="${esc(state.author)}" maxlength="180">`) + projectFields(state), data => {
      const title = String(data.get('title')).trim();
      if (!title) throw new Error(t("Bitte gib einen Romantitel ein."));
      state.title = title;
      state.author = String(data.get('author')).trim();
      Object.assign(state, appearance.normalizeProjectStyle(Object.fromEntries(data)));
      renderProject();
      queueSave();
    });
    bindProjectFields();
    return;
  }
  if (action === 'new' || action === 'new-cloud') {
    openModal(action === 'new-cloud' ? t("Neues Cloud-Projekt") : t("Neues Projekt"),
      field(t("Projekttitel"), ("<input name=\"title\" maxlength=\"180\" placeholder=\"" + esc(t("Mein Roman")) + "\" autofocus>")) + projectFields(),
      async data => {
        const details = Object.fromEntries(data);
        modal.close();
        await runProjectAction(action, false, details);
        return false;
      }, mobile ? t("Anlegen") : t("Speicherort wählen"));
    bindProjectFields();
    return;
  }
  await runProjectAction(action);
};
async function runProjectAction(action, discard = false, details) {
  if (projectDialogBusy || imports || recording || transcribing) return toast(t("Beende zuerst die laufende Projektaktion."));
  const copy = ['backup', 'copy-cloud'].includes(action);
  if (!copy && !discard && !flush()) {
    openModal(t("Projekt wechseln?"), ("<p>" + esc(t("Der aktuelle Arbeitsstand konnte nicht gespeichert werden. Sichere ihn im Projektmenü als Kopie, wenn du ihn behalten willst.")) + "</p>"), async () => {
      modal.close();
      await runProjectAction(action, true, details);
      return false;
    }, t("Trotzdem wechseln"));
    return;
  }
  projectDialogBusy = true;
  try {
    if (copy) {
      if (await window.desk.backup(state, action === 'copy-cloud')) {
        toast(action === 'copy-cloud' ? t("Cloud-Kopie gespeichert. Öffne sie über „Cloud-Projekt öffnen“.") : t("Projektsicherung gespeichert."));
      }
    } else {
      const method = action.startsWith('new') ? 'newProject' : 'openProject';
      const next = await window.desk[method](action.endsWith('-cloud'), details);
      if (next) startProject(next);
    }
  } catch (error) { errorToast(error); }
  finally { projectDialogBusy = false; }
}
$('#chapter-title').addEventListener('input', event => {
  chapter().title = event.target.value;
  renderChapters();
  queueSave();
});
$('#intent').addEventListener('input', event => {
  chapter().intent = event.target.value;
  queueSave();
});
$('#edit-goal').onclick = () => {
  const item = chapter();
  openModal(t("Kapitelziel bearbeiten"), field(t("Wortziel (0 für kein Ziel)"), `<input name="goal" type="number" value="${Number(item.goal) || 0}" min="0" max="1000000" required>`), data => {
    item.goal = Number(data.get('goal'));
    refreshMetrics();
    queueSave();
  });
};
editor.addEventListener('input', edited);
editor.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault(); });
editor.addEventListener('paste', event => {
  event.preventDefault();
  const html = event.clipboardData.getData('text/html');
  const text = event.clipboardData.getData('text/plain');
  rememberSelection();
  runEdit('insertHTML', html ? sanitize(html) : paragraphs(text));
});
document.addEventListener('selectionchange', () => {
  if (!state) return;
  rememberSelection();
  formatState();
});
for (const button of $$('[data-command]')) {
  button.onmousedown = event => event.preventDefault();
  button.onclick = () => runEdit(button.dataset.command);
}
$('#block').onchange = event => runEdit('formatBlock', event.target.value);
function applyInterfaceLanguage(language) {
  translateInterface(language);
  for (const select of [$('#dictionary-language'), $('#spell-language')]) {
    const previous = select.value || state?.settings.lang;
    select.innerHTML = Object.entries(langs).map(([code, label]) => option(code, t(label), previous)).join('');
  }
  if (currentWindowStatus) updateWindowControls(currentWindowStatus);
  if (!state) return;
  renderProject();
  renderChapters();
  $('#chapter-number').textContent = t("Kapitel") + ' ' + String(state.chapters.indexOf(chapter()) + 1).padStart(2, '0');
  renderMaterials();
  $('#synonyms').replaceChildren();
  $('#spell-result').replaceChildren();
  lookupRequest++;
  spellRequest++;
  showView(view);
}
$('#use-selection').onclick = () => {
  const text = (selection?.text || '').trim();
  if (!text) return toast(t("Markiere zuerst ein Wort im Manuskript."));
  $('#lookup-word').value = text.slice(0,60);
  $('#lookup').requestSubmit();
};
$('#lookup').onsubmit = async event => {
  event.preventDefault();
  const word = $('#lookup-word').value.trim();
  const currentRequest = ++lookupRequest;
  const lang = $('#dictionary-language').value;
  if (!word) return;
  try {
    const groups = await window.desk.dictionary(word, lang);
    if (currentRequest !== lookupRequest) return;
    let html = '';
    for (const [label, ...values] of groups.slice(0, 10)) {
      const choices = [...new Set(values.map(value => value.trim()).filter(value => !/\(antonym\)/i.test(value)).map(value => value.replace(/\s*\((?:similar term|related term|synonym|Hauptform)\)\s*$/i, '')).filter(value => value && value.toLowerCase() !== word.toLowerCase()))].slice(0, 18);
      if (!choices.length) continue;
      html += `<div class="sense">${label.trim() !== '-' ? '<strong>' + esc(label) + '</strong>' : ''}${choices.map(value => `<button type="button" data-synonym="${esc(value)}" title="${esc(t("Einfügen oder kopieren"))}">${esc(value)}</button>`).join('')}</div>`;
    }
    $('#synonyms').innerHTML = html || t("Kein Eintrag gefunden. Versuche die Grundform des Wortes.");
  } catch (error) { errorToast(error); }
};
$('#synonyms').onclick = async event => {
  const value = event.target.closest('button')?.dataset.synonym;
  if (!value) return;
  const selected = selection?.text.trim();
  if (selection?.chapter === chapter().id && selected && selected.toLowerCase() === $('#lookup-word').value.trim().toLowerCase()) {
    runEdit('insertText', value);
  } else {
    try { await window.desk.copy(value); toast(t("In die Zwischenablage kopiert.")); }
    catch (error) { errorToast(error); }
  }
};
$('#spell-language').onchange = async event => {
  state.settings.lang = event.target.value;
  editor.lang = state.settings.lang;
  $('#spell-result').replaceChildren();
  spellRequest++;
  queueSave();
  window.desk.spell([], state.settings.lang).catch(errorToast);
};
$('#check-spelling').onclick = async () => {
  const currentRequest = ++spellRequest;
  const candidates = [...new Set(words(editor.innerText).filter(word => /\p{L}/u.test(word)))];
  $('#spell-result').textContent = t("Prüft …");
  try {
    const suspect = await window.desk.spell(candidates, state.settings.lang);
    if (currentRequest !== spellRequest) return;
    $('#spell-result').innerHTML = suspect.length ? suspect.map(word => `<button class="spell-word" data-spell="${esc(word)}" type="button">${esc(word)}</button>`).join('') : t("Keine auffälligen Wörter gefunden.");
  } catch (error) { errorToast(error); $('#spell-result').replaceChildren(); }
};
$('#spell-result').onclick = async event => {
  const term = event.target.closest('button')?.dataset.spell;
  if (!term) return;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const match = [...node.textContent.matchAll(trueWords)].find(item => item[0] === term);
    if (!match) continue;
    editor.focus();
    const range = document.createRange();
    range.setStart(node, match.index);
    range.setEnd(node, match.index + term.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    node.parentElement.scrollIntoView({ block: 'nearest' });
    rememberSelection();
    try {
      const corrections = await window.desk.suggest(term, state.settings.lang);
      if (!corrections.length) return;
      if (selection?.text === term) {
        const target = selection;
        openModal(t("Rechtschreibung"), field(t("Vorschlag für „{word}“", { word: term }), '<select name="replacement">' + corrections.map(value => option(value,value)).join('') + '</select>'), data => {
          modal.close();
          selection = target;
          runEdit('insertText', data.get('replacement'));
        }, t("Ersetzen"));
      }
    } catch (error) { errorToast(error); }
    break;
  }
};
$('#pick-files').onclick = async () => {
  if (projectDialogBusy || imports) return;
  imports++;
  try { await importFiles(await window.desk.pick()); }
  catch (error) { errorToast(error); }
  finally { imports--; }
};
$('#add-url').onclick = () => openModal(t("Weblink hinzufügen"), field(t("Webadresse"), '<input name="url" type="url" placeholder="https://…" required autofocus>'), async data => {
  state.assets = await window.desk.addLink(data.get('url'));
  if (mobile) { queueSave(); flush(); }
  renderMaterials();
}, t("Hinzufügen"));
$('#material-list').onclick = async event => {
  const action = event.target.closest('[data-asset]')?.dataset.asset;
  if (!action) return;
  const id = event.target.closest('.asset').dataset.id;
  const item = state.assets.find(entry => entry.id === id);
  const target = chapter().id;
  try {
    if (action === 'open') await window.desk.openAsset(id);
    if (action === 'insert') {
      const value = await window.desk.insertAsset(id);
      const html = { text: () => paragraphs(value.value), html: () => value.value, image: () => `<p><img src="${esc(value.url)}" alt="${esc(value.name)}"></p>`, link: () => `<p><a href="${esc(value.url)}">${esc(value.name)}</a></p>` }[value.type]();
      if (html.trim()) insertContent(html, target);
      else toast(t("Das Material enthält keinen einfügbaren Text."));
    }
    if (action === 'delete') {
      openModal(t("Material entfernen?"), `<p>${esc(t("„{file}“ wird aus dem Projektordner entfernt.", { file: item.name }))}</p>`, async () => {
        state.assets = await window.desk.removeAsset(id);
        if (mobile) { queueSave(); flush(); }
        renderMaterials();
      }, t("Entfernen"));
    }
    if (action === 'transcript') showTranscript(item.transcript, item.name, target, id);
    if (action === 'transcribe') {
      if (transcribing || recording) return toast(t("Eine Sprachaufgabe läuft bereits."));
      transcribing = true;
      toast(t("Die Datei wird transkribiert …"));
      try {
        if (!flush()) return;
        const result = await window.desk.transcribe(id, state.settings.speech);
        state.assets = await window.desk.saveTranscript(id, result);
        renderMaterials();
        showTranscript(result, item.name, target, id);
      } finally { transcribing = false; }
    }
  } catch (error) { errorToast(error); }
};
$('#layout-settings').onchange = event => {
  const input = event.target;
  if (!input.checkValidity()) { input.reportValidity(); return; }
  state.settings[input.name] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
  renderLayout();
  queueSave();
};
function exteriorDrop(event) {
  return [...(event.dataTransfer?.types || [])].some(type => type === 'Files' || type === 'text/uri-list');
}
document.addEventListener('dragenter', event => {
  if (exteriorDrop(event)) { event.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; }
});
document.addEventListener('dragover', event => {
  if (exteriorDrop(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
});
document.addEventListener('dragleave', event => {
  if (exteriorDrop(event)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-overlay').hidden = true; }
});
document.addEventListener('drop', event => {
  if (!exteriorDrop(event)) return;
  event.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  const files = [...event.dataTransfer.files].map(window.desk.path).filter(Boolean);
  const urls = event.dataTransfer.getData('text/uri-list').split(/\r?\n/).map(value => value.trim()).filter(value => /^https?:\/\//i.test(value));
  if (!projectDialogBusy) importFiles(files, urls);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('beforeunload', event => {
  if (!flush()) { event.preventDefault(); event.returnValue = false; }
});
document.addEventListener('keydown', event => {
  if (!state || modal.open) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (flush()) toast(t("Projekt gespeichert.")); }
  if (event.key === 'Escape' && document.body.classList.contains('focus')) toggleFocus();
});
decorate();
Promise.all([window.desk.get(), window.desk.locations()]).then(([project, locations]) => {
  readingAccess = appearance.normalizeAccess(locations.access);
  applyInterfaceLanguage(locations.uiLanguage);
  startProject(project);
}).catch(errorToast);
window.desk.unavailableProject().then(path => {
  if (path) toast(t("Das letzte Projekt ist derzeit nicht verfügbar. Öffne es erneut, sobald der Ordner erreichbar ist.\n") + path, true);
}).catch(errorToast);
for (const button of $$('[data-window-action]')) {
  button.onclick = () => window.desk.windowControl(button.dataset.windowAction).then(updateWindowControls).catch(errorToast);
}
window.desk.onWindowState(updateWindowControls);
window.desk.identity().then(({ name, version, window: status }) => {
  updateWindowControls(status);
  const title = name + ' ' + version;
  document.title = title;
  $('#app-brand').textContent = title;
}).catch(errorToast);
