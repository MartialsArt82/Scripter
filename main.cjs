const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { applySpeechRules, voiceHints } = require('./speech.cjs');
const { productName, version } = require('./package.json');
const { atomic, bookHtml, escape, locales, project, validProject } = require('./core.cjs');

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
  pdf: ['PDF (Satzlayout)', 'pdf'], docx: ['Word', 'docx'], doc: ['Word 97–2003', 'doc'],
  odt: ['OpenDocument Text', 'odt'], epub: ['EPUB 3', 'epub'], rtf: ['Rich Text', 'rtf'],
  txt: ['Nur Text', 'txt'], markdown: ['Markdown', 'md'], html: ['HTML', 'html'],
  latex: ['LaTeX', 'tex'], icml: ['InDesign InCopy', 'icml']
};
let main, folder, manifest, registry, state, thesaurus, whisperBusy = false;

function remember() {
  atomic(registry, JSON.stringify({ folder }));
}
function load(dir) {
  const filename = path.join(dir, 'roman.json');
  const next = validProject(JSON.parse(fs.readFileSync(filename, 'utf8')));
  folder = dir;
  manifest = filename;
  state = next;
  remember();
  return state;
}
function initialize(dir, title, demo) {
  fs.mkdirSync(path.join(dir, 'Material'), { recursive: true });
  const filename = path.join(dir, 'roman.json');
  fs.writeFileSync(filename, JSON.stringify(project(title, demo), null, 2), { flag: 'wx' });
  return load(dir);
}
function persist() {
  atomic(manifest, JSON.stringify(state, null, 2));
}
function save(draft) {
  const validated = validProject(draft);
  state = { ...validated, assets: state.assets };
  persist();
}
function asset(id) {
  const result = state.assets.find(entry => entry.id === id);
  if (!result) throw new Error('Das Material wurde nicht gefunden.');
  return result;
}
function assetPath(item) {
  const file = path.basename(item.file || '');
  if (!file || !file.startsWith(item.id + '.')) throw new Error('Ungültiger Materialpfad.');
  return path.join(folder, 'Material', file);
}
function fileStem(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 100) || 'Manuskript';
}
function webAddress(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Nutze eine gültige HTTP- oder HTTPS-Adresse.');
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
  throw new Error(`${name} wurde nicht gefunden. Die Installationsanleitung findest du unter „Hilfe“.`);
}
const pandoc = () => executable('Pandoc', [process.env.ROMAN_PANDOC, path.join(process.resourcesPath, process.platform === 'win32' ? 'pandoc.exe' : 'pandoc'), 'pandoc', '/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc', path.join(process.env.LOCALAPPDATA || os.homedir(), 'Pandoc', 'pandoc.exe'), 'C:\\Program Files\\Pandoc\\pandoc.exe'].filter(Boolean));
const office = () => executable('LibreOffice', ['soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice', 'C:\\Program Files\\LibreOffice\\program\\soffice.com', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com']);
const tempDir = () => fsp.mkdtemp(path.join(app.getPath('temp'), 'scripter-'));
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const voiceDir = () => path.join(app.getPath('userData'), 'sprache');
const voicePython = () => path.join(voiceDir(), 'venv', isWin ? 'Scripts/python.exe' : 'bin/python');
async function setupWhisper() {
  if (whisperBusy) throw new Error('Eine Sprachaufgabe läuft bereits.');
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
      if (!created) throw new Error('Python 3.12 mit venv wurde nicht gefunden. Siehe Installationsanleitung.');
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
  if (!['auto','de','en'].includes(lang)) throw new Error('Ungültige Transkriptsprache.');
  if (whisperBusy) throw new Error('Eine Sprachaufgabe läuft bereits.');
  if (!fs.existsSync(path.join(voiceDir(), 'bereit.json'))) throw new Error('Richte die Spracherkennung zuerst unter „Einstellungen“ ein.');
  whisperBusy = true;
  let temp;
  try {
    temp = await tempDir();
    let input;
    if (typeof source === 'string') {
      const item = asset(source);
      if (!['audio','video','recording'].includes(item.kind)) throw new Error('Wähle eine Audio- oder Videodatei.');
      input = assetPath(item);
    } else {
      if (source.bytes.byteLength > 200 * 1024 * 1024) throw new Error('Die Diktataufnahme ist zu groß.');
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
    if (!previewable.includes(path.extname(filename))) throw new Error('Für den Manuskriptsatz werden PNG, JPEG, GIF, WebP, AVIF und BMP unterstützt. Das Original kann in der Materialsammlung geöffnet werden.');
    if ((await fsp.stat(filename)).size > 8 * 1024 * 1024) throw new Error('Bitte verkleinere das Bild zum Einfügen auf maximal 8 MB.');
    const ext = path.extname(filename).slice(1);
    return { type: 'image', url: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${(await fsp.readFile(filename)).toString('base64')}`, name: item.name };
  }
  if (item.kind === 'pdf') {
    const program = await executable('Poppler / pdftotext', ['pdftotext', '/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext']);
    return { type: 'text', value: await run(program, ['-enc', 'UTF-8', filename, '-']) };
  }
  if (item.kind !== 'text') throw new Error('Für dieses Material steht Transkribieren zur Verfügung.');
  const ext = path.extname(filename);
  if ((await fsp.stat(filename)).size > 20 * 1024 * 1024) throw new Error('Die Datei ist zum direkten Einfügen zu groß.');
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
    const preview = new BrowserWindow({ parent: main, width: 860, height: 900, title: 'Satzvorschau', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preview-preload.cjs'), contextIsolation: true, sandbox: true } });
    const id = preview.webContents.id;
    previewDocuments.set(id, { bytes, theme: manuscript.settings.theme });
    preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    preview.webContents.on('will-navigate', event => event.preventDefault());
    preview.on('closed', () => previewDocuments.delete(id));
    try { await preview.loadURL('romansatz://app/index.html'); }
    catch (error) { preview.destroy(); throw error; }
    return true;
  }
  if (!Object.hasOwn(formats, format)) throw new Error('Unbekanntes Exportformat.');
  const [label, extension] = formats[format];
  const result = await dialog.showSaveDialog(main, { title: 'Manuskript exportieren', defaultPath: fileStem(manuscript.title) + '.' + extension, filters: [{ name: label, extensions: [extension] }] });
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
app.whenReady().then(() => {
  registry = path.join(app.getPath('userData'), 'zuletzt.json');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  try {
    load(JSON.parse(fs.readFileSync(registry, 'utf8')).folder);
  } catch {
    const dir = path.join(app.getPath('userData'), 'Beispielprojekt');
    if (fs.existsSync(path.join(dir, 'roman.json'))) load(dir);
    else initialize(dir, 'Der letzte Sommer', true);
  }
  main = new BrowserWindow({ width: 1540, height: 960, minWidth: 750, minHeight: 620, backgroundColor: '#f6f5ef', title: productName + ' ' + version, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: true } });
  main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  main.webContents.on('will-navigate', event => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === main.webContents && permission === 'media' && details.mediaTypes?.includes('audio') && !details.mediaTypes?.includes('video')));
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => contents === main.webContents && permission === 'media' && details.mediaType !== 'video');
  if (isMac) Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  else Menu.setApplicationMenu(null);
  main.webContents.on('context-menu', (_, params) => {
    const items = [...params.dictionarySuggestions.slice(0, 7).map(word => ({ label: word, click: () => main.webContents.replaceMisspelling(word) }))];
    if (params.misspelledWord) items.push({ label: 'Zum Wörterbuch hinzufügen', click: () => session.defaultSession.addWordToSpellCheckerDictionary(params.misspelledWord) });
    if (params.isEditable || params.selectionText) {
      if (items.length) items.push({ type: 'separator' });
      if (params.isEditable) items.push({ role: 'cut', label: 'Ausschneiden', enabled: params.editFlags.canCut });
      items.push({ role: 'copy', label: 'Kopieren', enabled: params.editFlags.canCopy });
      if (params.isEditable) items.push({ role: 'paste', label: 'Einfügen', enabled: params.editFlags.canPaste });
    }
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
  protocol.handle('romansatz', async request => {
    const address = new URL(request.url);
    const file = address.pathname.slice(1);
    if (address.hostname !== 'app' || !previewFiles.has(file)) return new Response('', { status: 404 });
    const mime = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
    return new Response(await fsp.readFile(path.join(__dirname, 'pdf-preview', file)), { headers: { 'Content-Type': mime + '; charset=utf-8' } });
  });
  ipcMain.handle('preview-pdf', event => {
    if (event.senderFrame?.parent || !previewDocuments.has(event.sender.id)) throw new Error('Satzvorschau ist nicht verfügbar.');
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
    if (event.sender !== main.webContents || event.senderFrame?.parent) throw new Error('Ungültiger Aufruf.');
    return action(...args);
  });
  handle('get', () => state);
  handle('identity', () => ({ name: productName, version }));
  handle('save', save);
  ipcMain.on('flush', (event, draft) => {
    if (event.sender !== main.webContents) return;
    try { save(draft); event.returnValue = true; }
    catch { event.returnValue = false; }
  });
  handle('new', async () => {
    const choice = await dialog.showSaveDialog(main, { title: 'Projektordner anlegen', defaultPath: path.join(app.getPath('documents'), 'Mein Roman') });
    if (choice.canceled) return null;
    if (fs.existsSync(choice.filePath)) throw new Error('Wähle einen neuen Ordnernamen.');
    return initialize(choice.filePath, path.basename(choice.filePath), false);
  });
  handle('open', async () => {
    const choice = await dialog.showOpenDialog(main, { title: 'roman.json aus einem Projekt öffnen', properties: ['openFile'], filters: [{ name: 'Scripter-Projekt', extensions: ['json'] }] });
    if (choice.canceled) return null;
    if (path.basename(choice.filePaths[0]) !== 'roman.json') throw new Error('Wähle die Datei „roman.json“ im Projektordner.');
    return load(path.dirname(choice.filePaths[0]));
  });
  handle('backup', async () => {
    const choice = await dialog.showSaveDialog(main, { title: 'Sicherung in neuem Ordner speichern', defaultPath: path.join(app.getPath('documents'), fileStem(state.title) + ' – Sicherung') });
    if (choice.canceled) return false;
    const destination = path.resolve(choice.filePath);
    if (fs.existsSync(destination) || destination.startsWith(path.resolve(folder) + path.sep)) throw new Error('Wähle einen neuen Ordner außerhalb des Projektordners.');
    const temp = destination + '.partial-' + randomUUID();
    try {
      await fsp.mkdir(temp);
      await fsp.copyFile(manifest, path.join(temp, 'roman.json'));
      const media = path.join(folder, 'Material');
      if (fs.existsSync(media)) await fsp.cp(media, path.join(temp, 'Material'), { recursive: true });
      await fsp.rename(temp, destination);
      return true;
    } finally {
      await fsp.rm(temp, { recursive: true, force: true });
    }
  });
  handle('pick', async () => {
    const result = await dialog.showOpenDialog(main, { title: 'Material hinzufügen', properties: ['openFile','multiSelections'] });
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
        if (!(await fsp.stat(file)).isFile()) throw new Error('Datei erwartet.');
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
      persist();
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
  handle('remove-asset', id => {
    const item = asset(id);
    state.assets = state.assets.filter(entry => entry.id !== id);
    try { persist(); } catch (error) { state.assets.push(item); throw error; }
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
  handle('save-transcript', (id, result) => {
    const item = asset(id);
    const previous = item.transcript;
    item.transcript = result;
    try { persist(); } catch (error) { item.transcript = previous; throw error; }
    return state.assets;
  });
  handle('zoom', value => main.webContents.setZoomFactor(Math.max(.75, Math.min(1.5, Number(value) / 100 || 1))));
  handle('setup', setupWhisper);
  handle('refresh-transcript', value => applySpeechRules(value, state.speechRules));
  handle('transcribe', transcript);
  handle('publish', publish);
  handle('help', async () => {
    const win = new BrowserWindow({ parent: main, width: 800, height: 800, title: 'Hilfe', webPreferences: { javascript: false, sandbox: true } });
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(webAddress(url)).catch(() => {}); return { action: 'deny' }; });
    win.webContents.on('will-navigate', event => event.preventDefault());
    await win.loadFile('hilfe.html');
  });
  main.loadFile('index.html');
});
app.on('window-all-closed', () => app.quit());
