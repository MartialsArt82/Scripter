const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { applySpeechRules, voiceHints } = require('./speech.cjs');
const { normalizeAccess } = require('./appearance.js');
const { productName, version } = require('./package.json');
const ui = require('./i18n.js');
require('./i18n-messages.js');
const { t } = ui;
const { atomic, bookHtml, escape, locales, project, validProject } = require('./core.cjs');
const { ArchiveSession, readArchive, writeArchive, stamp, digest } = require('./project-archive.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'romanasset', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } },
  { scheme: 'romansatz', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }
]);
app.setName(productName);
if (process.platform === 'linux') app.setDesktopName('de.scripter.Scripter.desktop');
if (process.env.ROMAN_TEST_DIR) {
  app.setPath('userData', process.env.ROMAN_TEST_DIR);
} else {
  const legacyProfile = path.join(app.getPath('appData'), 'romanwerkstatt');
  if (!fs.existsSync(path.join(app.getPath('userData'), 'zuletzt.json')) && fs.existsSync(path.join(legacyProfile, 'zuletzt.json'))) {
    app.setPath('userData', legacyProfile);
  }
}
if (!app.requestSingleInstanceLock()) app.quit();

const dictionaryPackages = { de: 'dictionary-de', en: 'dictionary-en', es: 'dictionary-es', pt: 'dictionary-pt', fr: 'dictionary-fr' };
const spellcheckers = new Map();
let hunspell;
function checkerFor(lang) {
  hunspell ??= require('hunspell-asm').loadModule();
  if (!spellcheckers.has(lang)) {
    spellcheckers.set(lang, Promise.all([hunspell, import(dictionaryPackages[lang])]).then(([factory, { default: { aff, dic } }]) => {
      const affPath = factory.mountBuffer(aff, lang + '.aff');
      const dicPath = factory.mountBuffer(dic, lang + '.dic');
      return factory.create(affPath, dicPath);
    }));
  }
  return spellcheckers.get(lang);
}
const extensions = {
  image: ['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.tif','.tiff','.heic'],
  audio: ['.mp3','.wav','.m4a','.aac','.ogg','.opus','.flac','.aiff','.aif','.wma','.mka','.amr','.mp2','.m4b','.caf','.au','.ac3','.aifc','.weba','.oga','.spx'],
  video: ['.mp4','.mov','.mkv','.webm','.avi','.m4v','.mpeg','.mpg','.wmv','.3gp','.mts','.m2ts','.ts','.flv','.mxf','.vob','.ogv'],
  text: ['.txt','.md','.markdown','.rtf','.doc','.docx','.odt','.html','.htm','.csv','.tex'],
  pdf: ['.pdf']
};
const previewDocuments = new Map();
const previewFiles = new Set(['index.html', 'preview.css', 'preview.mjs', 'pdf.min.mjs', 'pdf.worker.min.mjs']);
const previewable = ['.png','.jpg','.jpeg','.gif','.webp','.avif','.bmp'];
const formats = {
  pdf: ["PDF (Satzlayout)", 'pdf'], docx: ['Word', 'docx'], doc: ['Word 97–2003', 'doc'],
  odt: ['OpenDocument Text', 'odt'], epub: ['EPUB 3', 'epub'], rtf: ['Rich Text', 'rtf'],
  txt: ["Nur Text", 'txt'], markdown: ['Markdown', 'md'], html: ['HTML', 'html'],
  latex: ['LaTeX', 'tex'], icml: ['InDesign InCopy', 'icml']
};
const cloudProviders = new Set(['google','onedrive','dropbox','icloud','other']);
let main, folder, manifest, manifestContents, registry, locationFile, state, thesaurus, whisperBusy = false;
let archiveSession;
let unavailableProject = '';
let locations = normalizeLocations();

function remember(dir, archive) {
  atomic(registry, JSON.stringify({ folder: dir, archive: archive?.filename }));
}
function load(dir, rememberProject = true, archive) {
  const filename = path.join(dir, 'roman.json');
  const raw = fs.readFileSync(filename, 'utf8');
  const next = validProject(JSON.parse(raw));
  if (rememberProject) remember(dir, archive);
  const previous = archiveSession;
  folder = dir;
  manifest = filename;
  manifestContents = raw;
  state = next;
  archiveSession = archive;
  if (previous && previous.folder !== dir && !previous.task && previous.pending === undefined) {
    fsp.rm(previous.folder, { recursive: true, force: true }).catch(() => {});
  }
  return state;
}
const workRoot = () => path.join(app.getPath('userData'), 'project-work');
async function workingFolder() {
  await fsp.mkdir(workRoot(), { recursive: true });
  return fsp.mkdtemp(path.join(workRoot(), 'project-'));
}
function openSession(filename, dir, expected, savedHash) {
  return new ArchiveSession(filename, dir, expected, savedHash, error => {
    if (main && !main.isDestroyed()) main.webContents.send('archive-error', error.message);
  });
}

async function openPackage(filename, previous, reuse = true) {
  if (path.extname(filename).toLowerCase() === '.zip') return importZip(filename);
  const existing = reuse ? (archiveSession?.filename === filename ? archiveSession.folder : previous) : null;
  if (existing && folderContains(workRoot(), existing) && existing !== workRoot()) {
    let stored;
    try { stored = JSON.parse(await fsp.readFile(path.join(existing, 'archive.json'), 'utf8')); } catch {}
    if (stored?.filename === filename && typeof stored.savedHash === 'string') {
      const raw = await fsp.readFile(path.join(existing, 'roman.json'), 'utf8').catch(() => null);
      if (raw !== null && (digest(raw) !== stored.savedHash || stamp(filename) === stored.expected)) {
        const archive = openSession(filename, existing, stored.expected, stored.savedHash);
        const next = load(existing, true, archive);
        archive.queue(raw);
        return next;
      }
    }
  }
  const dir = await workingFolder();
  try {
    const expected = await readArchive(filename, dir, true);
    const raw = fs.readFileSync(path.join(dir, 'roman.json'), 'utf8');
    const archive = openSession(filename, dir, expected, digest(raw));
    archive.remember();
    return load(dir, true, archive);
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw error;
  }
}
async function importZip(filename) {
  // A legacy ZIP is an import. Remember the working copy for that source version
  // so switching projects does not strand edits made before converting it.
  const fingerprint = stamp(filename);
  const dir = path.join(workRoot(), 'import-' + digest(filename + '\0' + fingerprint));
  if (fs.existsSync(path.join(dir, 'roman.json'))) return load(dir);
  const temp = await workingFolder();
  try {
    if (await readArchive(filename, temp, false) !== fingerprint) throw new Error(t("Die Datei wurde während des Öffnens geändert. Öffne sie erneut."));
    await fsp.rename(temp, dir);
    return load(dir);
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
}
async function createPackage(filename, title, style) {
  const dir = await workingFolder();
  const raw = JSON.stringify(project(title, false, style, t("Kapitel") + " 1"), null, 2);
  try {
    await fsp.mkdir(path.join(dir, 'Material'));
    await fsp.writeFile(path.join(dir, 'roman.json'), raw, { flag: 'wx' });
    const expected = await writeArchive(filename, raw, dir, null);
    const archive = openSession(filename, dir, expected, digest(raw));
    archive.remember();
    return load(dir, true, archive);
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw error;
  }
}

function initialize(dir, title, demo, rememberProject = true, style) {
  fs.mkdirSync(path.join(dir, 'Material'), { recursive: true });
  const filename = path.join(dir, 'roman.json');
  fs.writeFileSync(filename, JSON.stringify(project(title, demo, style, t("Kapitel") + " 1"), null, 2), { flag: 'wx' });
  return load(dir, rememberProject);
}
function persist() {
  let current;
  try { current = fs.readFileSync(manifest, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(t("Die Projektdatei ist nicht mehr erreichbar. Prüfe den Ordner oder sichere deinen Arbeitsstand als Kopie."));
    throw error;
  }
  if (current !== manifestContents) throw new Error(t("Die Projektdatei wurde außerhalb dieses Fensters geändert. Sichere deinen Arbeitsstand als Kopie, bevor du die andere Fassung öffnest."));
  const next = JSON.stringify(state, null, 2);
  if (next === current) return;
  atomic(manifest, next);
  manifestContents = next;
  archiveSession?.queue(next);
}
function save(draft) {
  const validated = validProject(draft);
  const previous = state;
  state = { ...validated, assets: state.assets };
  try { persist(); } catch (error) { state = previous; throw error; }
}
function normalizeLocations(value) {
  const knownPath = input => typeof input === 'string' && path.isAbsolute(input) && !input.includes('\0') ? path.normalize(input) : '';
  return {
    preferred: knownPath(value?.preferred),
    uiLanguage: ui.normalize(value?.uiLanguage),
    provider: cloudProviders.has(value?.provider) ? value.provider : 'google',
    access: normalizeAccess(value?.access),
    clouds: Object.fromEntries([...cloudProviders].map(key => [key, knownPath(value?.clouds?.[key])]))
  };
}
function folderContains(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function cloudRoot() {
  const chosen = locations.clouds[locations.provider];
  if (!chosen) throw new Error(t("Richte zuerst in den Einstellungen einen Cloud-Ordner ein."));
  try {
    if (fs.statSync(chosen).isDirectory()) return fs.realpathSync(chosen);
  } catch {}
  throw new Error('Der Cloud-Ordner ist derzeit nicht erreichbar.');
}
function preferredRoot() {
  try { if (locations.preferred && fs.statSync(locations.preferred).isDirectory()) return locations.preferred; }
  catch {}
  return app.getPath('documents');
}
function packageDestination(destination, root) {
  const filename = /\.scrpt$/i.test(destination) ? destination : destination + '.scrpt';
  const directory = fs.realpathSync(path.dirname(filename));
  const resolved = path.join(directory, path.basename(filename));
  if (root && !folderContains(root, resolved)) throw new Error(t("Wähle einen Ordner innerhalb deines Cloud-Ordners."));
  if (folderContains(workRoot(), resolved)) throw new Error(t("Wähle einen neuen Ordner außerhalb des Projektordners."));
  if (stamp(resolved) !== null) throw new Error(t("Es gibt bereits eine Datei mit diesem Namen. Wähle einen anderen Namen."));
  return resolved;
}
const packageFilter = () => [{ name: t("Scripter-Projekt"), extensions: ['scrpt'] }];
function asset(id) {
  const result = state.assets.find(entry => entry.id === id);
  if (!result) throw new Error(t("Das Material wurde nicht gefunden."));
  return result;
}
function assetPath(item) {
  const file = path.basename(item.file || '');
  if (!file || !file.startsWith(item.id + '.')) throw new Error(t("Ungültiger Materialpfad."));
  return path.join(folder, 'Material', file);
}
function fileStem(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 100) || t("Manuskript");
}
function webAddress(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(t("Nutze eine gültige HTTP- oder HTTPS-Adresse."));
  return url.href;
}
function run(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, ...options });
    let stdout = '', stderr = '';
    child.stdout?.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr?.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-5000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `Prozess beendet (${code}).`)));
    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end();
    }
  });
}
async function executable(name, candidates) {
  for (const candidate of candidates) {
    try {
      await run(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {}
  }
  throw new Error(t("{program} wurde nicht gefunden. Die Installationsanleitung findest du unter „Hilfe“.", { program: name }));
}
const pandoc = () => executable('Pandoc', [process.env.ROMAN_PANDOC, path.join(process.resourcesPath, process.platform === 'win32' ? 'pandoc.exe' : 'pandoc'), 'pandoc', '/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc', path.join(process.env.LOCALAPPDATA || os.homedir(), 'Pandoc', 'pandoc.exe'), 'C:\\Program Files\\Pandoc\\pandoc.exe'].filter(Boolean));
const office = () => executable('LibreOffice', ['soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice', 'C:\\Program Files\\LibreOffice\\program\\soffice.com', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com']);
const tempDir = () => fsp.mkdtemp(path.join(app.getPath('temp'), 'scripter-'));
const isLinux = process.platform === 'linux';
function describeWindow(win) {
  return { linuxControls: isLinux, maximized: win.isMaximized() };
}
function registerWindowState(win) {
  if (!isLinux) return;
  for (const event of ['maximize','unmaximize','restore']) {
    win.on(event, () => { if (!win.isDestroyed()) win.webContents.send('window-state', describeWindow(win)); });
  }
}
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const voiceDir = () => path.join(app.getPath('userData'), 'sprache');
const voicePython = () => path.join(voiceDir(), 'venv', isWin ? 'Scripts/python.exe' : 'bin/python');
async function setupWhisper() {
  if (whisperBusy) throw new Error(t("Eine Sprachaufgabe läuft bereits."));
  whisperBusy = true;
  try {
    await fsp.mkdir(voiceDir(), { recursive: true });
    if (!fs.existsSync(voicePython())) {
      const list = isWin ? ['py', 'python3.12', 'python'] : [
        'python3.12', '/opt/homebrew/bin/python3.12', '/usr/local/bin/python3.12',
        '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12', 'python3'
      ];
      let created = false;
      for (const candidate of list) {
        try {
          const args = candidate === 'py' ? ['-3.12'] : [];
          await run(candidate, [...args, '-c', 'import sys; assert sys.version_info[:2] == (3, 12)']);
          await run(candidate, [...args, '-m', 'venv', path.dirname(path.dirname(voicePython()))]);
          created = true;
          break;
        } catch {}
      }
      if (!created) throw new Error(t("Python 3.12 mit venv wurde nicht gefunden. Siehe Installationsanleitung."));
    }
    await run(voicePython(), ['-m','pip','install','--disable-pip-version-check','faster-whisper==1.2.1','av==16.1.0']);
    await run(voicePython(), ['-c','from faster_whisper.utils import download_model; import sys; download_model("base", output_dir=sys.argv[1])', path.join(voiceDir(), 'modell')], { env: { ...process.env, HF_HUB_DISABLE_XET: '1', HF_HOME: path.join(voiceDir(), 'cache') } });
    atomic(path.join(voiceDir(), 'bereit.json'), JSON.stringify({ model: 'base' }));
    return true;
  } finally {
    whisperBusy = false;
  }
}
async function transcript(source, lang) {
  if (!['auto','de','en'].includes(lang)) throw new Error(t("Ungültige Transkriptsprache."));
  if (whisperBusy) throw new Error(t("Eine Sprachaufgabe läuft bereits."));
  if (!fs.existsSync(path.join(voiceDir(), 'bereit.json'))) throw new Error(t("Richte die Spracherkennung zuerst unter „Einstellungen“ ein."));
  whisperBusy = true;
  let temp;
  try {
    temp = await tempDir();
    let input;
    if (typeof source === 'string') {
      const item = asset(source);
      if (!['audio','video','recording'].includes(item.kind)) throw new Error(t("Wähle eine Audio- oder Videodatei."));
      input = assetPath(item);
    } else {
      if (source.bytes.byteLength > 200 * 1024 * 1024) throw new Error(t("Die Diktataufnahme ist zu groß."));
      input = path.join(temp, 'diktat.webm');
      await fsp.writeFile(input, Buffer.from(source.bytes));
    }
    const script = path.join(temp, 'transcribe.py');
    await fsp.copyFile(path.join(__dirname, 'transcribe.py'), script);
    const rules = state.speechRules;
    const hintFile = path.join(temp, 'vokabular.txt');
    await fsp.writeFile(hintFile, voiceHints(rules, lang), 'utf8');
    const output = await run(voicePython(), [script, input, lang, path.join(voiceDir(), 'modell'), hintFile], {
      env: { ...process.env, HF_HUB_OFFLINE: '1', HF_HOME: path.join(voiceDir(), 'cache') }
    });
    return applySpeechRules(JSON.parse(output), rules);
  } finally {
    whisperBusy = false;
    if (temp) await fsp.rm(temp, { recursive: true, force: true });
  }
}
async function insertable(id) {
  const item = asset(id);
  if (item.kind === 'web') return { type: 'link', url: item.url, name: item.name };
  const filename = assetPath(item);
  if (item.kind === 'image') {
    if (!previewable.includes(path.extname(filename))) throw new Error(t("Für den Manuskriptsatz werden PNG, JPEG, GIF, WebP, AVIF und BMP unterstützt. Das Original kann in der Materialsammlung geöffnet werden."));
    if ((await fsp.stat(filename)).size > 8 * 1024 * 1024) throw new Error(t("Bitte verkleinere das Bild zum Einfügen auf maximal 8 MB."));
    const ext = path.extname(filename).slice(1);
    return { type: 'image', url: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${(await fsp.readFile(filename)).toString('base64')}`, name: item.name };
  }
  if (item.kind === 'pdf') {
    const program = await executable('Poppler / pdftotext', ['pdftotext', '/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext']);
    return { type: 'text', value: await run(program, ['-enc', 'UTF-8', filename, '-']) };
  }
  if (item.kind !== 'text') throw new Error(t("Für dieses Material steht Transkribieren zur Verfügung."));
  const ext = path.extname(filename);
  if ((await fsp.stat(filename)).size > 20 * 1024 * 1024) throw new Error(t("Die Datei ist zum direkten Einfügen zu groß."));
  if (['.txt','.md','.markdown','.csv','.tex'].includes(ext)) {
    const raw = await fsp.readFile(filename);
    const encoding = raw[0] === 255 && raw[1] === 254 ? 'utf-16le' : raw[0] === 254 && raw[1] === 255 ? 'utf-16be' : 'utf-8';
    try { return { type: 'text', value: new TextDecoder(encoding, { fatal: true }).decode(raw) }; }
    catch { return { type: 'text', value: new TextDecoder('windows-1252').decode(raw) }; }
  }
  if (['.html','.htm'].includes(ext)) return { type: 'html', value: await fsp.readFile(filename, 'utf8') };
  let target = filename, temp;
  try {
    if (ext === '.doc') {
      temp = await tempDir();
      await run(await office(), [`-env:UserInstallation=${pathToFileURL(path.join(temp, 'profil')).href}`,'--headless','--convert-to','docx','--outdir',temp,filename]);
      target = path.join(temp, path.basename(filename, ext) + '.docx');
    }
    return { type: 'html', value: await run(await pandoc(), ['--to=html', target]) };
  } finally {
    if (temp) await fsp.rm(temp, { recursive: true, force: true });
  }
}
async function printPdf(html) {
  const temp = await tempDir();
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    const filename = path.join(temp, 'buch.html');
    await fsp.writeFile(filename, html);
    await win.loadFile(filename);
    return await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
  } finally {
    win.destroy();
    await fsp.rm(temp, { recursive: true, force: true });
  }
}
async function publish(format, manuscript) {
  if (format === 'preview') {
    const bytes = await printPdf(bookHtml(manuscript, manuscript.chapters, manuscript.settings, true));
    const preview = new BrowserWindow({ parent: main, width: 1160, height: 840, minWidth: 540, frame: !isLinux, title: t("Satzvorschau"), autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preview-preload.cjs'), contextIsolation: true, sandbox: true } });
    const id = preview.webContents.id;
    previewDocuments.set(id, { bytes, theme: manuscript.settings.theme, access: locations.access, window: describeWindow(preview) });
    registerWindowState(preview);
    preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    preview.webContents.on('will-navigate', event => event.preventDefault());
    preview.on('closed', () => previewDocuments.delete(id));
    try { await preview.loadURL('romansatz://app/index.html?lang=' + locations.uiLanguage); }
    catch (error) { preview.destroy(); throw error; }
    return true;
  }
  if (!Object.hasOwn(formats, format)) throw new Error(t("Unbekanntes Exportformat."));
  const [label, extension] = formats[format];
  const result = await dialog.showSaveDialog(main, { title: t("Manuskript exportieren"), defaultPath: fileStem(manuscript.title) + '.' + extension, filters: [{ name: t(label), extensions: [extension] }] });
  if (result.canceled) return false;
  const output = result.filePath;
  const html = bookHtml(manuscript, manuscript.chapters, manuscript.settings, format === 'pdf');
  if (format === 'html') {
    await fsp.writeFile(output, html);
  } else if (format === 'pdf') {
    await fsp.writeFile(output, await printPdf(html));
  } else {
    const temp = await tempDir();
    try {
      const input = path.join(temp, 'manuskript.html');
      const contents = manuscript.chapters.map(item => `<h1>${escape(item.title)}</h1>${item.html}`).join('\n');
      await fsp.writeFile(input, `<!doctype html><meta charset="utf-8"><title>${escape(manuscript.title)}</title>${contents}`);
      const dest = path.join(temp, 'manuskript.' + (format === 'doc' ? 'docx' : extension));
      const args = [input, '--from=html', '--to=' + (format === 'doc' ? 'docx' : format === 'epub' ? 'epub3' : format === 'txt' ? 'plain' : format === 'markdown' ? 'gfm' : format), '--standalone',
        '-M', 'title=' + manuscript.title, '-M', 'author=' + manuscript.author, '-M', 'lang=' + (locales[manuscript.settings.lang] || 'de'), '-o', dest];
      if (format === 'epub') args.push('--toc');
      await run(await pandoc(), args);
      if (format === 'doc') {
        await run(await office(), [`-env:UserInstallation=${pathToFileURL(path.join(temp, 'profil')).href}`,'--headless','--convert-to','doc:MS Word 97','--outdir',temp,dest]);
        await fsp.copyFile(path.join(temp, 'manuskript.doc'), output);
      } else {
        await fsp.copyFile(dest, output);
      }
    } finally {
      await fsp.rm(temp, { recursive: true, force: true });
    }
  }
  return true;
}

app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });
app.whenReady().then(async () => {
  registry = path.join(app.getPath('userData'), 'zuletzt.json');
  locationFile = path.join(app.getPath('userData'), 'speicherorte.json');
  try { locations = normalizeLocations(JSON.parse(fs.readFileSync(locationFile, 'utf8'))); } catch {}
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  ui.setLanguage(locations.uiLanguage);
  let recent;
  try {
    recent = JSON.parse(fs.readFileSync(registry, 'utf8'));
    if (recent.archive) await openPackage(recent.archive, recent.folder);
    else load(recent.folder);
  } catch {
    const dir = path.join(app.getPath('userData'), 'Beispielprojekt');
    const last = recent?.archive || recent?.folder;
    if (typeof last === 'string' && last !== dir) unavailableProject = last;
    if (fs.existsSync(path.join(dir, 'roman.json'))) load(dir, !unavailableProject);
    else initialize(dir, 'Der letzte Sommer', true, !unavailableProject);
  }
  main = new BrowserWindow({ width: 1540, height: 960, minWidth: 750, minHeight: 620, frame: !isLinux, backgroundColor: '#f6f5ef', title: productName + ' ' + version, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: true } });
  registerWindowState(main);
  let allowClose = false;
  let closing = false;
  main.on('close', async event => {
    if (allowClose || !archiveSession) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    try {
      if (!await main.webContents.executeJavaScript('document.body.inert = true; flush()')) throw new Error(t("Das Projekt konnte nicht gespeichert werden."));
      await archiveSession.sync();
    } catch (error) {
      const result = await dialog.showMessageBox(main, {
        type: 'warning', message: t("Das Projektpaket konnte nicht aktualisiert werden."),
        detail: t(error.message),
        buttons: [t("Abbrechen"), t("Trotzdem schließen")], defaultId: 0, cancelId: 0
      });
      if (result.response !== 1) {
        await main.webContents.executeJavaScript('document.body.inert = false');
        closing = false;
        return;
      }
    }
    allowClose = true;
    main.close();
    // The renderer can still veto the close if a final local write fails.
    if (!main.isDestroyed()) { allowClose = false; closing = false; }
  });
  main.webContents.on('will-prevent-unload', () => { main.webContents.executeJavaScript('document.body.inert = false').catch(() => {}); });
  main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  main.webContents.on('will-navigate', event => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === main.webContents && permission === 'media' && details.mediaTypes?.includes('audio') && !details.mediaTypes?.includes('video')));
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => contents === main.webContents && permission === 'media' && details.mediaType !== 'video');
  if (isMac) Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  else Menu.setApplicationMenu(null);
  main.webContents.on('context-menu', (_, params) => {
    const items = [...params.dictionarySuggestions.slice(0, 7).map(word => ({ label: word, click: () => main.webContents.replaceMisspelling(word) }))];
    if (params.misspelledWord) items.push({ label: t("Zum Wörterbuch hinzufügen"), click: () => session.defaultSession.addWordToSpellCheckerDictionary(params.misspelledWord) });
    if (params.isEditable || params.selectionText) {
      if (items.length) items.push({ type: 'separator' });
      if (params.isEditable) items.push({ role: 'cut', label: t("Ausschneiden"), enabled: params.editFlags.canCut });
      items.push({ role: 'copy', label: t("Kopieren"), enabled: params.editFlags.canCopy });
      if (params.isEditable) items.push({ role: 'paste', label: t("Einfügen"), enabled: params.editFlags.canPaste });
    }
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
  protocol.handle('romansatz', async request => {
    const address = new URL(request.url);
    const file = address.pathname.slice(1);
    if (address.hostname !== 'app') return new Response('', { status: 404 });
    const scripts = ['i18n.js', 'i18n-messages.js', 'i18n-ui.js'];
    if (scripts.some(name => file === 'i18n/' + name)) {
      return new Response(await fsp.readFile(path.join(__dirname, path.basename(file))), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
    }
    if (!previewFiles.has(file)) return new Response('', { status: 404 });
    const mime = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
    return new Response(await fsp.readFile(path.join(__dirname, 'pdf-preview', file)), { headers: { 'Content-Type': mime + '; charset=utf-8' } });
  });
  ipcMain.handle('window-control', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!isLinux || !win || event.senderFrame?.parent || (win !== main && !previewDocuments.has(event.sender.id))) throw new Error(t("Fenstersteuerung nicht verfügbar."));
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') setImmediate(() => { if (!win.isDestroyed()) win.close(); });
    else if (action !== 'get') throw new Error(t("Unbekannte Fensteraktion."));
    return describeWindow(win);
  });
  ipcMain.handle('preview-pdf', event => {
    if (event.senderFrame?.parent || !previewDocuments.has(event.sender.id)) throw new Error(t("Satzvorschau ist nicht verfügbar."));
    return previewDocuments.get(event.sender.id);
  });
  protocol.handle('romanasset', request => {
    try {
      const item = asset(new URL(request.url).hostname);
      if (item.kind !== 'image' || !previewable.includes(path.extname(item.file))) return new Response('', { status: 404 });
      return net.fetch(pathToFileURL(assetPath(item)).href);
    } catch { return new Response('', { status: 404 }); }
  });
  const handle = (name, action) => ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== main.webContents || event.senderFrame?.parent) throw new Error(t("Ungültiger Aufruf."));
    return action(...args);
  });
  handle('get', () => state);
  handle('unavailable-project', () => unavailableProject);
  handle('identity', () => ({ name: productName, version, window: describeWindow(main) }));
  handle('save', save);
  handle('wait-for-archive', () => archiveSession?.sync());
  ipcMain.on('flush', (event, draft) => {
    if (event.sender !== main.webContents) return;
    try { save(draft); event.returnValue = true; }
    catch (error) { event.returnValue = error.message; }
  });
  handle('locations', () => locations);
  handle('save-locations', input => {
    const next = normalizeLocations(input);
    atomic(locationFile, JSON.stringify(next, null, 2));
    locations = next;
    ui.setLanguage(locations.uiLanguage);
    return next;
  });
  handle('choose-folder', async selected => {
    const choice = await dialog.showOpenDialog(main, { title: t("Ordner auswählen"), defaultPath: typeof selected === 'string' && path.isAbsolute(selected) ? selected : preferredRoot(), properties: ['openDirectory','createDirectory'] });
    return choice.canceled ? null : choice.filePaths[0];
  });
  handle('new', async (cloud, details, discard) => {
    const root = cloud ? cloudRoot() : null;
    const title = typeof details?.title === 'string' ? details.title.trim().slice(0, 180) : '';
    const suggested = title ? fileStem(title) : t("Mein Roman");
    const choice = await dialog.showSaveDialog(main, { title: t("Scripter-Projekt"), defaultPath: path.join(root ?? preferredRoot(), suggested + '.scrpt'), filters: packageFilter() });
    if (choice.canceled) return null;
    if (!discard) await archiveSession?.sync();
    const destination = packageDestination(choice.filePath, root);
    return createPackage(destination, title || path.basename(destination, path.extname(destination)), details);
  });
  handle('open', async (cloud, _details, discard) => {
    const root = cloud ? cloudRoot() : null;
    const choice = await dialog.showOpenDialog(main, {
      title: t("Projekt öffnen"), defaultPath: root ?? preferredRoot(), properties: ['openFile'],
      filters: [{ name: t("Scripter-Projekt"), extensions: ['scrpt', 'zip', 'json'] }]
    });
    if (choice.canceled) return null;
    if (!discard) await archiveSession?.sync();
    const selected = choice.filePaths[0];
    const actual = fs.realpathSync(selected);
    if (root && !folderContains(root, actual)) throw new Error(t("Wähle ein Projekt innerhalb deines Cloud-Ordners."));
    if (['.scrpt', '.zip'].includes(path.extname(actual).toLowerCase())) return openPackage(actual, undefined, !discard);
    if (path.basename(actual) !== 'roman.json') throw new Error(t("Wähle eine .scrpt-Datei, eine ZIP-Sicherung oder roman.json."));
    return load(path.dirname(actual));
  });
  handle('backup', async (draft, cloud, saveAs) => {
    const root = cloud ? cloudRoot() : null;
    const name = fileStem(draft.title) + (cloud || saveAs ? '' : t(" – Sicherung"));
    const choice = await dialog.showSaveDialog(main, {
      title: cloud ? t("Projekt als Cloud-Kopie speichern") : t("Als .scrpt speichern …"),
      defaultPath: path.join(root ?? preferredRoot(), name + '.scrpt'), filters: packageFilter()
    });
    if (choice.canceled) return null;
    const destination = packageDestination(choice.filePath, root);
    const snapshot = { ...validProject(draft), assets: state.assets };
    await writeArchive(destination, JSON.stringify(snapshot, null, 2), folder, null);
    return saveAs ? openPackage(destination) : true;
  });
  handle('pick', async () => {
    const result = await dialog.showOpenDialog(main, { title: t("Material hinzufügen"), properties: ['openFile','multiSelections'] });
    return result.filePaths;
  });
  handle('add', async files => {
    const dir = path.join(folder, 'Material');
    await fsp.mkdir(dir, { recursive: true });
    const errors = [];
    for (const file of files) {
      const ext = path.extname(file).toLowerCase().slice(0, 15);
      const item = { id: randomUUID(), name: path.basename(file), kind: Object.keys(extensions).find(kind => extensions[kind].includes(ext)) || 'file' };
      item.file = item.id + (ext || '.bin');
      const dest = path.join(dir, item.file);
      try {
        if (!(await fsp.stat(file)).isFile()) throw new Error(t("Datei erwartet."));
        await fsp.copyFile(file, dest);
        state.assets.push(item);
        try { persist(); } catch (error) { state.assets.pop(); throw error; }
      } catch (error) {
        await fsp.rm(dest, { force: true });
        errors.push(item.name);
      }
    }
    return { assets: state.assets, errors };
  });
  handle('link', value => {
    const url = webAddress(value);
    if (!state.assets.some(item => item.url === url)) {
      state.assets.push({ id: randomUUID(), name: new URL(url).hostname, url, kind: 'web' });
      try { persist(); } catch (error) { state.assets.pop(); throw error; }
    }
    return state.assets;
  });
  handle('open-asset', async id => {
    const item = asset(id);
    if (item.kind === 'web') return shell.openExternal(webAddress(item.url));
    if (item.kind === 'file') return shell.showItemInFolder(assetPath(item));
    const error = await shell.openPath(assetPath(item));
    if (error) throw new Error(error);
  });
  handle('insert-asset', insertable);
  handle('remove-asset', async id => {
    // Let an in-flight ZIP finish reading before deleting a referenced file.
    if (archiveSession?.task) await archiveSession.task.catch(() => {});
    const item = asset(id);
    const previous = state.assets;
    state.assets = previous.filter(entry => entry.id !== id);
    try { persist(); } catch (error) { state.assets = previous; throw error; }
    if (item.file) fs.rmSync(assetPath(item), { force: true });
    return state.assets;
  });
  handle('dictionary', (word, lang) => {
    if (!Object.hasOwn(locales, lang)) return [];
    if (!thesaurus) {
      const { DatabaseSync } = require('node:sqlite');
      const filename = path.join(__dirname, 'data', 'thesauri.sqlite');
      const unpacked = filename.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
      thesaurus = new DatabaseSync(unpacked, { readOnly: true });
    }
    return (thesaurus.prepare('select senses from thesaurus where lang=? and word=?').get(lang, word.trim().toLocaleLowerCase(locales[lang]))?.senses || '').split('\n').filter(Boolean).map(line => line.split('|').filter(Boolean));
  });
  handle('spell', async (words, lang) => {
    if (!Object.hasOwn(locales, lang)) return [];
    if (!isMac && session.defaultSession.availableSpellCheckerLanguages.includes(locales[lang]) && session.defaultSession.getSpellCheckerLanguages()[0] !== locales[lang]) session.defaultSession.setSpellCheckerLanguages([locales[lang]]);
    if (!words.length) return [];
    const checker = await checkerFor(lang);
    return words.filter(word => word.length > 1 && word.length < 45 && !checker.spell(word));
  });
  handle('suggest', async (word, lang) => {
    if (!Object.hasOwn(locales, lang)) return [];
    return (await checkerFor(lang)).suggest(word).slice(0, 12);
  });
  handle('copy', text => clipboard.writeText(String(text)));
  handle('open-kofi', () => shell.openExternal('https://ko-fi.com/paulweigl/tip'));
  handle('save-transcript', (id, result) => {
    const item = asset(id);
    const previous = item.transcript;
    item.transcript = result;
    try { persist(); } catch (error) { item.transcript = previous; throw error; }
    return state.assets;
  });
  handle('zoom', value => main.webContents.setZoomFactor(Math.max(.75, Math.min(2, Number(value) / 100 || 1))));
  handle('setup', setupWhisper);
  handle('refresh-transcript', value => applySpeechRules(value, state.speechRules));
  handle('transcribe', transcript);
  handle('publish', publish);
  handle('help', async () => {
    const win = new BrowserWindow({ parent: main, width: 800, height: 800, title: t("Hilfe"), webPreferences: { sandbox: true } });
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(webAddress(url)).catch(() => {}); return { action: 'deny' }; });
    win.webContents.on('will-navigate', event => event.preventDefault());
    await win.loadFile('hilfe.html', { query: { lang: locations.uiLanguage } });
  });
  main.loadFile('index.html');
});
app.on('window-all-closed', () => app.quit());
