'use strict';

const noteColors = { sand: 'Sand', sage: 'Salbei', rose: 'Rosé', blue: 'Blau' };
const board = $('#storyboard-canvas');
const scroller = $('#storyboard-scroll');
let boardMode = 'board';
let pendingLines = 0;
let noteDrag;
const boardOffset = { x: 252, y: 28 };
const noteWidth = 245;
const notePosition = value => Math.round(Math.max(0, Math.min(100000, value)));

function chapterLinks(note) {
  return note.chapters.map(id => state.chapters.find(item => item.id === id)).filter(Boolean)
    .map(item => `<button type="button" class="chapter-chip" data-open-chapter="${esc(item.id)}">${esc(item.title || 'Ohne Titel')}</button>`).join('');
}

function noteFields(note) {
  return `<div class="note-time"><span>${note.order}</span>${note.when ? esc(note.when) : ''}</div>
    <button type="button" class="note-title" data-note-edit="${esc(note.id)}">${esc(note.title)}</button>
    ${note.body ? `<p class="note-body">${esc(note.body)}</p>` : ''}
    <div class="note-chapters">${chapterLinks(note)}</div>`;
}

function renderStoryboard() {
  const notes = state.storyboard;
  const timeline = boardMode === 'timeline';
  scroller.hidden = timeline;
  $('#storyboard-timeline').hidden = !timeline;
  for (const button of $$('[data-board-mode]')) button.setAttribute('aria-pressed', String(button.dataset.boardMode === boardMode));
  $('#board-chapters').innerHTML = state.chapters.map((item, index) => `<button type="button" class="board-chapter" data-open-chapter="${esc(item.id)}"><span>${index + 1}</span>${esc(item.title || 'Ohne Titel')}</button>`).join('');
  $('#board-notes').innerHTML = notes.map(note =>
    `<article class="sticky-note" data-note-id="${esc(note.id)}" data-tone="${note.color}" style="left:${boardOffset.x + note.x}px;top:${boardOffset.y + note.y}px">
      <button type="button" class="note-grip icon-button" data-note-grip title="Ziehen oder mit den Pfeiltasten verschieben" aria-label="${esc(note.title)} verschieben" data-icon="grip"></button>
      ${noteFields(note)}
    </article>`
  ).join('');
  $('#board-empty').hidden = Boolean(notes.length);
  $('#storyboard-timeline').innerHTML = notes.length
    ? [...notes].sort((a, b) => a.order - b.order).map(note => `<article class="timeline-note" data-tone="${note.color}">${noteFields(note)}</article>`).join('')
    : '<p class="timeline-empty">Erstelle einen Zettel, um deine Zeitleiste zu beginnen.</p>';
  decorate($('#storyboard-view'));
  if (!timeline) {
    board.style.minWidth = Math.max(600, ...notes.map(note => note.x + boardOffset.x + noteWidth + 32)) + 'px';
    board.style.minHeight = Math.max(550, state.chapters.length * 54 + 80, ...notes.map(note => note.y + boardOffset.y + 235)) + 'px';
    requestBoardLines();
  }
}

function requestBoardLines() {
  if (pendingLines) return;
  pendingLines = requestAnimationFrame(() => {
    pendingLines = 0;
    const svg = $('#board-connections');
    if (scroller.hidden || $('#storyboard-view').hidden) return;
    svg.setAttribute('viewBox', `0 0 ${board.clientWidth} ${board.clientHeight}`);
    const box = board.getBoundingClientRect();
    const notePositions = new Map([...board.querySelectorAll('[data-note-id]')].map(card => [card.dataset.noteId, card.getBoundingClientRect()]));
    const chapterPositions = new Map([...$('#board-chapters').querySelectorAll('button')].map(node => [node.dataset.openChapter, node.getBoundingClientRect()]));
    const paths = [];
    for (const note of state.storyboard) {
      const card = notePositions.get(note.id);
      if (!card) continue;
      for (const id of note.chapters) {
        const chapterBox = chapterPositions.get(id);
        if (!chapterBox) continue;
        const x1 = chapterBox.right - box.left;
        const y1 = chapterBox.top + chapterBox.height / 2 - box.top;
        const x2 = card.left - box.left;
        const y2 = card.top + Math.min(50, card.height / 2) - box.top;
        const curve = Math.max(20, (x2 - x1) * 0.5);
        paths.push(`<path data-tone="${note.color}" d="M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}"/>`);
      }
    }
    svg.innerHTML = paths.join('');
  });
}

function editStoryboardNote(existing) {
  const notes = state.storyboard;
  const order = existing?.order ?? Math.min(99999, Math.max(0, ...notes.map(note => note.order)) + 1);
  const chapterOptions = state.chapters.map((item, index) => `<label><input type="checkbox" name="chapters" value="${esc(item.id)}" ${existing?.chapters.includes(item.id) ? 'checked' : ''}> <span>${index + 1}. ${esc(item.title || 'Ohne Titel')}</span></label>`).join('');
  const form = [
    field('Titel', `<input name="title" required maxlength="100" value="${esc(existing?.title)}" autofocus>`),
    '<div class="note-form-row">' + field('Zeitleistenposition', `<input name="order" required type="number" min="1" max="99999" value="${order}">`)
      + field('Zeitpunkt (optional)', `<input name="when" maxlength="80" placeholder="Tag 3 · abends" value="${esc(existing?.when)}">`) + '</div>',
    field('Notiz', `<textarea name="body" rows="4" maxlength="2000">${esc(existing?.body)}</textarea>`),
    field('Farbe', `<select name="color">${Object.entries(noteColors).map(([key, label]) => option(key, label, existing?.color ?? 'sand')).join('')}</select>`),
    `<fieldset class="note-chapter-picker"><legend>Mit Kapiteln verknüpfen</legend><div>${chapterOptions}</div></fieldset>`,
    existing ? '<button type="button" id="delete-story-note" class="text-button">Zettel löschen</button>' : ''
  ].join('');
  openModal(existing ? 'Zettel bearbeiten' : 'Zettel hinzufügen', form, data => {
    const title = String(data.get('title')).trim();
    if (!title) throw new Error('Gib dem Zettel einen Titel.');
    const note = existing ?? { id: crypto.randomUUID(), x: 0, y: 0 };
    Object.assign(note, {
      title, body: String(data.get('body')).trim(), when: String(data.get('when')).trim(),
      order: Number(data.get('order')), color: data.get('color'), chapters: data.getAll('chapters')
    });
    if (!existing) {
      const slots = Math.max(1, Math.floor((scroller.clientWidth - boardOffset.x) / (noteWidth + 28)));
      for (let index = 0; ; index++) {
        const x = (index % slots) * (noteWidth + 28);
        const y = Math.floor(index / slots) * 218;
        if (!notes.some(other => Math.abs(other.x - x) < noteWidth && Math.abs(other.y - y) < 178)) {
          note.x = notePosition(x);
          note.y = notePosition(y);
          break;
        }
      }
      notes.push(note);
    }
    queueSave();
    renderStoryboard();
    if (!existing && boardMode === 'board') {
      const card = [...board.querySelectorAll('[data-note-id]')].find(node => node.dataset.noteId === note.id);
      card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
  if (existing) $('#delete-story-note').onclick = () => {
    openModal('Zettel löschen?', `<p>„${esc(existing.title)}“ wird von der Pinnwand und der Zeitleiste entfernt.</p>`, () => {
      state.storyboard = state.storyboard.filter(note => note.id !== existing.id);
      queueSave();
      renderStoryboard();
    }, 'Löschen');
  };
}

function moveStoryboardNote(card, x, y) {
  card.style.left = boardOffset.x + x + 'px';
  card.style.top = boardOffset.y + y + 'px';
  board.style.minWidth = Math.max(parseFloat(board.style.minWidth) || 600, boardOffset.x + x + noteWidth + 32) + 'px';
  board.style.minHeight = Math.max(parseFloat(board.style.minHeight) || 550, boardOffset.y + y + card.offsetHeight + 32) + 'px';
  requestBoardLines();
}

$('#add-story-note').onclick = () => editStoryboardNote();
for (const button of $$('[data-board-mode]')) button.onclick = () => {
  boardMode = button.dataset.boardMode;
  renderStoryboard();
};
$('#storyboard-view').addEventListener('click', event => {
  const link = event.target.closest('[data-open-chapter]');
  if (link) return openChapter(link.dataset.openChapter);
  const button = event.target.closest('[data-note-edit]');
  const note = button && state.storyboard.find(item => item.id === button.dataset.noteEdit);
  if (note) editStoryboardNote(note);
});
board.addEventListener('pointerdown', event => {
  const grip = event.target.closest('[data-note-grip]');
  if (!grip || event.button !== 0) return;
  const card = grip.closest('[data-note-id]');
  const note = state.storyboard.find(item => item.id === card.dataset.noteId);
  grip.setPointerCapture(event.pointerId);
  card.classList.add('dragging');
  noteDrag = { card, note, pointer: event.pointerId, mouseX: event.clientX, mouseY: event.clientY,
    scrollX: scroller.scrollLeft, scrollY: scroller.scrollTop, x: note.x, y: note.y };
});
board.addEventListener('pointermove', event => {
  if (noteDrag?.pointer !== event.pointerId) return;
  const drag = noteDrag;
  drag.x = notePosition(drag.note.x + event.clientX - drag.mouseX + scroller.scrollLeft - drag.scrollX);
  drag.y = notePosition(drag.note.y + event.clientY - drag.mouseY + scroller.scrollTop - drag.scrollY);
  moveStoryboardNote(drag.card, drag.x, drag.y);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) board.addEventListener(type, event => {
  if (noteDrag?.pointer !== event.pointerId) return;
  const { card, note, x, y } = noteDrag;
  noteDrag = null;
  card.classList.remove('dragging');
  if (event.type !== 'pointerup') return moveStoryboardNote(card, note.x, note.y);
  if (note.x === x && note.y === y) return;
  Object.assign(note, { x, y });
  queueSave();
});
board.addEventListener('keydown', event => {
  const grip = event.target.closest('[data-note-grip]');
  const movement = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
  if (!grip || !Object.hasOwn(movement, event.key)) return;
  event.preventDefault();
  const card = grip.closest('[data-note-id]');
  const note = state.storyboard.find(item => item.id === card.dataset.noteId);
  const [dx, dy] = movement[event.key];
  const step = event.shiftKey ? 64 : 16;
  note.x = notePosition(note.x + dx * step);
  note.y = notePosition(note.y + dy * step);
  moveStoryboardNote(card, note.x, note.y);
  card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  queueSave();
});
new ResizeObserver(requestBoardLines).observe(board);
