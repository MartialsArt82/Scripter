const fs = require('node:fs');
const path = require('node:path');

// Hunspell's published CommonJS wrapper uses Nano ID 2's callable export.
// The lockfile keeps a maintained Nano ID 3 release with a named export.
const root = path.resolve(__dirname, '..', 'node_modules');
const modules = ['hunspell-asm/dist/cjs/hunspellLoader.js', 'emscripten-wasm-loader/dist/cjs/path/mountBuffer.js'];
const oldLine = /const nanoid = require\(["']nanoid["']\);/;
const newLine = 'const { nanoid } = require("nanoid");';
for (const module of modules) {
  const filename = path.join(root, module);
  const text = fs.readFileSync(filename, 'utf8');
  if (text.includes(newLine)) continue;
  if (!oldLine.test(text)) throw new Error('Unerwartete Nano-ID-Schnittstelle in ' + module);
  fs.writeFileSync(filename, text.replace(oldLine, newLine));
}
