'use strict';

const projectValidation = (() => {
  const { normalizeProjectStyle } = typeof module === 'undefined' ? appearance : require('./appearance.js');
  const { normalizeSpeechRules } = typeof module === 'undefined' ? speechRules : require('./speech.cjs');

  function validProject(value) {
    if (value?.version !== 1 || !Array.isArray(value.chapters) || !value.chapters.length || !Array.isArray(value.assets)) throw new Error('Diese Datei ist kein Scripter-Projekt.');
    Object.assign(value, normalizeProjectStyle(value));
    const chapters = new Set(value.chapters.map(chapter => chapter.id));
    const position = number => Math.round(Math.max(0, Math.min(100000, Number(number) || 0)));
    value.storyboard = (Array.isArray(value.storyboard) ? value.storyboard : []).filter(note => typeof note?.id === 'string').map(note => ({
      id: note.id,
      title: String(note.title ?? '').slice(0, 100),
      body: String(note.body ?? '').slice(0, 2000),
      when: String(note.when ?? '').slice(0, 80),
      order: Math.min(99999, Math.max(1, Math.round(Number(note.order) || 1))),
      color: ['sand', 'sage', 'rose', 'blue'].includes(note.color) ? note.color : 'sand',
      x: position(note.x),
      y: position(note.y),
      chapters: [...new Set(Array.isArray(note.chapters) ? note.chapters.filter(id => chapters.has(id)) : [])]
    }));
    const notes = new Set(value.storyboard.map(note => note.id));
    const existingLinks = new Set();
    value.storyLinks = (Array.isArray(value.storyLinks) ? value.storyLinks : []).flatMap(link => {
      if (typeof link?.id !== 'string' || existingLinks.has(link.id) || link.from === link.to || !notes.has(link.from) || !notes.has(link.to)) return [];
      existingLinks.add(link.id);
      return [{ id: link.id, from: link.from, to: link.to, color: ['green','blue','red','gold'].includes(link.color) ? link.color : 'green' }];
    });
    value.speechRules = normalizeSpeechRules(value.speechRules);
    return value;
  }

  return { validProject };
})();
if (typeof module !== 'undefined') module.exports = projectValidation;
