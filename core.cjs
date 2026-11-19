const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const locales = { de: 'de-DE', en: 'en-US', es: 'es-ES', pt: 'pt-PT', fr: 'fr-FR' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const chapter = (title = 'Neues Kapitel') => ({ id: crypto.randomUUID(), title, goal: 1500, intent: '', html: '' });
const defaults = { theme: 'light', font: 'Georgia', zoom: 100, lang: 'de', speech: 'auto', trim: 'trade', margins: 19, size: 11, leading: 1.5, pageNumbers: true };
function project(title, demo = false) {
  const first = chapter(demo ? 'Der Brief' : 'Kapitel 1');
  if (demo) {
    first.goal = 1200;
    first.intent = 'Clara findet den Brief. Der erste Hinweis führt zum Bahnhof.';
    first.html = '<p>Als Clara an jenem Morgen die Tür öffnete, lag ein Brief auf der Schwelle. Der Umschlag war feucht und an einer Ecke eingerissen. Sie erkannte die Schrift ihrer Schwester, obwohl sie seit zwölf Jahren keinen Brief mehr von ihr bekommen hatte.</p><p>Hinter den Häusern setzte sich der erste Zug in Bewegung. Clara blieb barfuß im Türrahmen stehen, bis das Geräusch der Räder verklungen war. Erst dann drehte sie den Umschlag um.</p><p>Auf der Rückseite stand nur eine Uhrzeit.</p>';
  }
  return { version: 1, title, author: '', active: first.id, chapters: demo ? [first, chapter('Am Bahnsteig'), chapter('Die Rückkehr')] : [first], assets: [], settings: { ...defaults } };
}
function atomic(filename, value) {
  const temp = filename + '.partial';
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, filename);
}
function validProject(value) {
  if (value?.version !== 1 || !Array.isArray(value.chapters) || !value.chapters.length || !Array.isArray(value.assets)) throw new Error('Diese Datei ist kein Scripter-Projekt.');
  return value;
}
const trims = { trade: [135, 215], pocket: [120, 190], a5: [148, 210], a4: [210, 297], us: [152.4, 228.6] };
function bookHtml(meta, chapters, settings, print = false) {
  const [width, height] = trims[settings.trim] || trims.trade;
  const margin = Math.min(35, Math.max(11, Number(settings.margins) || 19));
  const size = Math.min(20, Math.max(8, Number(settings.size) || 11));
  const leading = Math.min(2.2, Math.max(1.1, Number(settings.leading) || 1.5));
  const font = ['Georgia', 'Palatino', 'Times New Roman', 'Garamond', 'Arial', 'Verdana'].includes(settings.font) ? settings.font : 'Georgia';
  const pageNumbers = print && settings.pageNumbers ? '@bottom-center { content: counter(page); font: 9pt Georgia; }' : '';
  return `<!doctype html><html lang="${locales[settings.lang] || 'de-DE'}"><head><meta charset="utf-8"><title>${escape(meta.title)}</title><meta name="author" content="${escape(meta.author)}"><style>
  @page {size: ${width}mm ${height}mm; margin: ${margin}mm; ${pageNumbers}}
  @page :first { @bottom-center { content: none; } }
  body { margin: 0; color: #1c1d1b; font: ${size}pt "${font}", serif; line-height:${leading}; overflow-wrap: anywhere; }
  .front { text-align: center; padding-top: 26%; }
  h1,h2,h3 { line-height: 1.15; break-after: avoid; }
  h1 { font-size: 2.25em; } h2 { font-size: 1.65em; margin: 1em 0 1.6em; } h3{font-size:1.25em}
  p{orphans:3;widows:3;margin: 0 0 .65em} .chapter { break-before: page; }
  blockquote { border-left: 1px solid #aaa; margin-left: 0; padding-left: 12pt; }
  img { max-width: 100%; max-height: 65vh; object-fit: contain; } table{border-collapse:collapse} td,th{border:1px solid #aaa;padding:4px}
  @media screen {body{max-width:${width - 2 * margin}mm;margin:auto;padding:16mm 11mm} .chapter{margin-top:12mm;padding-top:8mm;border-top:1px solid #ddd} .front{padding: 5mm 0 12mm}}
  </style></head><body><section class="front"><h1>${escape(meta.title)}</h1><p>${escape(meta.author)}</p></section>${chapters.map(item => `<section class="chapter"><h2>${escape(item.title)}</h2>${item.html}</section>`).join('')}</body></html>`;
}
module.exports = { atomic, bookHtml, chapter, defaults, escape, locales, project, validProject };
