const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { crc32 } = require('node:zlib');
const { Transform, Writable } = require('node:stream');
const yauzl = require('yauzl');
const yazl = require('yazl');
const { atomic, validProject } = require('./core.cjs');

const INVALID = 'Diese Datei ist kein Scripter-Projekt.';
const MISSING = 'Ein Anhang fehlt. Das Projektpaket wurde nicht gespeichert.';
const LIMIT = 'Das Projektpaket überschreitet die zulässige Größe.';
const CONFLICT = 'Die .scrpt-Datei wurde außerhalb von Scripter geändert oder ist nicht erreichbar. Sichere deinen Arbeitsstand über „Als .scrpt speichern …“.';
const MANIFEST_LIMIT = 50 * 1024 ** 2;
const MATERIAL_LIMIT = 8 * 1024 ** 3;
const ENTRY_LIMIT = 10000;
const reference = /^[a-f0-9-]{36}$/;
const portable = /^[a-f0-9-]{36}\.[a-z0-9]{1,14}$/;
const digest = text => createHash('sha256').update(text).digest('hex');

function stamp(filename) {
  let stat;
  try { stat = fs.lstatSync(filename, { bigint: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile()) throw new Error(INVALID);
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

function materials(assets, normalize = false) {
  const entries = new Map();
  for (const item of assets) {
    if (!item || typeof item.id !== 'string' || !reference.test(item.id)) throw new Error(INVALID);
    if (!item.file) continue;
    if (typeof item.file !== 'string' || !item.file.startsWith(item.id + '.') ||
      item.file !== path.basename(item.file) || /[\\/\0]/.test(item.file)) throw new Error(INVALID);
    const filename = normalize && !portable.test(item.file) ? item.id + '.bin' : item.file;
    if (!portable.test(filename) || entries.has(filename)) throw new Error(INVALID);
    entries.set(filename, item.file);
  }
  return entries;
}

function parseProject(raw) {
  let state;
  try { state = validProject(JSON.parse(raw)); } catch { throw new Error(INVALID); }
  if (typeof state.title !== 'string' ||
    state.chapters.some(chapter => typeof chapter?.id !== 'string' || typeof chapter.title !== 'string' || typeof chapter.html !== 'string')) {
    throw new Error(INVALID);
  }
  return state;
}

async function writeArchive(filename, raw, folder, expected) {
  const state = parseProject(raw);
  const entries = materials(state.assets, true);
  for (const item of state.assets) if (item.file && !portable.test(item.file)) item.file = item.id + '.bin';
  const data = Buffer.from(JSON.stringify(state, null, 2));
  if (data.length > MANIFEST_LIMIT || entries.size + 2 > ENTRY_LIMIT) throw new Error(LIMIT);
  let bytes = 0;
  const files = [];
  for (const [name, original] of entries) {
    const file = path.join(folder, 'Material', original);
    const stat = await fsp.lstat(file).catch(error => {
      if (error.code === 'ENOENT') throw new Error(MISSING);
      throw error;
    });
    if (!stat.isFile()) throw new Error(MISSING);
    bytes += stat.size;
    if (bytes > MATERIAL_LIMIT) throw new Error(LIMIT);
    files.push([name, file, stat]);
  }
  const temp = filename + '.partial-' + randomUUID();
  const zip = new yazl.ZipFile();
  if (stamp(filename) !== expected) throw new Error(CONFLICT);
  let materialStream;
  zip.on('error', error => zip.outputStream.destroy(error));
  zip.outputStream.once('close', () => materialStream?.destroy());
  try {
    const writing = pipeline(zip.outputStream, fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
    zip.addBuffer(data, 'roman.json');
    zip.addEmptyDirectory('Material/');
    for (const [name, file, stat] of files) {
      zip.addReadStreamLazy('Material/' + name, { size: stat.size, mtime: stat.mtime, compressionLevel: 1 }, callback => {
        materialStream = fs.createReadStream(file);
        materialStream.once('error', error => zip.outputStream.destroy(error));
        callback(null, materialStream);
      });
    }
    zip.end({ forceZip64Format: false });
    await writing;
    const output = await fsp.open(temp, 'r+');
    try { await output.sync(); } finally { await output.close(); }
    if (stamp(filename) !== expected) throw new Error(CONFLICT);
    if (expected === null) {
      // Exclusive creation also protects an independently created file at this path.
      try {
        fs.linkSync(temp, filename);
        fs.unlinkSync(temp);
      } catch (error) {
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error.code) || stamp(filename) !== null) throw error;
        fs.renameSync(temp, filename);
      }
    } else {
      fs.renameSync(temp, filename);
    }
    return stamp(filename);
  } finally {
    await fsp.rm(temp, { force: true });
  }
}

async function extractEntry(zip, entry, destination) {
  const stream = await zip.openReadStreamPromise(entry);
  let checksum = 0;
  const guard = new Transform({
    transform(chunk, _, done) { checksum = crc32(chunk, checksum); done(null, chunk); },
    flush(done) { done(checksum === entry.crc32 ? null : new Error(INVALID)); }
  });
  await pipeline(stream, guard, destination);
}

async function readArchive(filename, folder, strict) {
  const before = stamp(filename);
  if (before === null) throw new Error(INVALID);
  const zip = await yauzl.openPromise(filename, { lazyEntries: true, strictFileNames: true });
  let raw;
  let bytes = 0;
  const names = new Set();
  try {
    if (zip.entryCount > ENTRY_LIMIT) throw new Error(LIMIT);
    await fsp.mkdir(path.join(folder, 'Material'), { recursive: true });
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      if (names.has(name)) throw new Error(INVALID);
      names.add(name);
      if (name === 'Material/' && entry.uncompressedSize === 0) continue;
      if (name === 'roman.json') {
        if (entry.uncompressedSize > MANIFEST_LIMIT) throw new Error(LIMIT);
        const chunks = [];
        await extractEntry(zip, entry, new Writable({ write(chunk, _, done) { chunks.push(chunk); done(); } }));
        raw = Buffer.concat(chunks).toString('utf8');
        continue;
      }
      const assetName = name.startsWith('Material/') ? name.slice('Material/'.length) : '';
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (!portable.test(assetName) || (mode !== 0 && mode !== 0o100000)) throw new Error(INVALID);
      bytes += entry.uncompressedSize;
      if (bytes > MATERIAL_LIMIT) throw new Error(LIMIT);
      await extractEntry(zip, entry, fs.createWriteStream(path.join(folder, 'Material', assetName), { flags: 'wx' }));
    }
    const state = parseProject(raw);
    const files = materials(state.assets);
    if (strict) {
      for (const name of files.keys()) if (!names.has('Material/' + name)) throw new Error(INVALID);
    }
    if (stamp(filename) !== before) throw new Error(CONFLICT);
    await fsp.writeFile(path.join(folder, 'roman.json'), raw, { flag: 'wx' });
    return before;
  } finally {
    zip.close();
  }
}

// The working manifest is durable before the async archive replacement starts.
class ArchiveSession {
  constructor(filename, folder, expected, savedHash, onError) {
    this.filename = filename;
    this.folder = folder;
    this.expected = expected;
    this.savedHash = savedHash;
    this.onError = onError;
  }

  remember() {
    atomic(path.join(this.folder, 'archive.json'), JSON.stringify({
      filename: this.filename, expected: this.expected, savedHash: this.savedHash
    }));
  }

  queue(raw) {
    if (digest(raw) === this.savedHash && !this.task) {
      this.pending = undefined;
      return;
    }
    this.pending = raw;
    if (!this.task) this.run();
  }

  run() {
    this.task = (async () => {
      while (this.pending !== undefined) {
        const raw = this.pending;
        this.pending = undefined;
        try {
          if (digest(raw) !== this.savedHash) {
            this.expected = await writeArchive(this.filename, raw, this.folder, this.expected);
            this.savedHash = digest(raw);
            this.remember();
          }
        } catch (error) {
          this.pending ??= raw;
          this.onError(error);
          throw error;
        }
      }
    })().finally(() => { this.task = undefined; });
    // The desktop stays usable after a failed update. The working file can be exported.
    this.task.catch(() => {});
  }

  async sync() {
    if (!this.task && this.pending !== undefined) this.run();
    await this.task;
  }
}

module.exports = { ArchiveSession, readArchive, writeArchive, stamp, digest, CONFLICT };
