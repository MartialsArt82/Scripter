'use strict';

const noteColors = { sand: 'Sand', sage: 'Salbei', rose: 'Rosé', blue: 'Blau' };
const board = $('#storyboard-canvas');
const scroller = $('#storyboard-scroll');
let boardMode = 'board';
let pendingLines = 0;
let noteDrag;
const boardOffset = { x: 252, y: 28 };
const timelinePanel = $('#storyboard-timeline');
const linkColors = { green: 'Grün', blue: 'Blau', red: 'Rot', gold: 'Gold' };
let linking, linkPointer, timelineDrag;
const noteWidth = 245;
const notePosition = value => Math.round(Math.max(0, Math.min(100000, value)));

function chapterLinks(note) {
  return note.chapters.map(id => state.chapters.find(item => item.id === id)).filter(Boolean)
    .map(item => `<button type="button" class="chapter-chip" data-open-chapter="${esc(item.id)}">${esc(item.title || t("Ohne Titel"))}</button>`).join('');
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
  timelinePanel.hidden = !timeline;
  $('#connection-color-label').hidden = timeline;
  $('#board-instruction').hidden = timeline;
  if (timeline) cancelLink();
  for (const button of $$('[data-board-mode]')) button.setAttribute('aria-pressed', String(button.dataset.boardMode === boardMode));
  $('#board-chapters').innerHTML = state.chapters.map((item, index) => `<button type="button" class="board-chapter" data-open-chapter="${esc(item.id)}"><span>${index + 1}</span>${esc(item.title || t("Ohne Titel"))}</button>`).join('');
  $('#board-notes').innerHTML = notes.map(note =>
    `<article class="sticky-note" data-note-id="${esc(note.id)}" data-tone="${note.color}" style="left:${boardOffset.x + note.x}px;top:${boardOffset.y + note.y}px">
      <button type="button" class="note-grip icon-button" data-note-grip title="${esc(t("Ziehen oder mit den Pfeiltasten verschieben"))}" aria-label="${esc(t("„{title}“ verschieben", { title: note.title }))}" data-icon="grip"></button>
      <button type="button" class="note-port icon-button" data-note-port draggable="true" title="${esc(t("Verbindung ziehen oder Start- und Zielzettel anklicken"))}" aria-label="${esc(t("„{title}“ verbinden", { title: note.title }))}" data-icon="link"></button>
      ${noteFields(note)}
    </article>`
  ).join('');
  $('#board-empty').hidden = Boolean(notes.length);
  timelinePanel.innerHTML = notes.length
    ? timelineNotes().map(note => `<article class="timeline-note" data-timeline-id="${esc(note.id)}" data-tone="${note.color}">
      <button type="button" class="timeline-grip icon-button" draggable="true" data-timeline-grip aria-label="${esc(t("„{title}“ in der Zeitleiste verschieben", { title: note.title }))}" title="${esc(t("Ziehen oder Pfeiltasten benutzen"))}" data-icon="grip"></button>
      ${noteFields(note)}
      ${mobile ? `<div class="timeline-touch-order">
        <button type="button" class="icon-button" data-timeline-move="-1" aria-label="${esc(t("Nach oben"))}" >↑</button>
        <button type="button" class="icon-button" data-timeline-move="1" aria-label="${esc(t("Nach unten"))}" >↓</button></div>` : ''}</article>`).join('')
    : ("<p class=\"timeline-empty\">" + esc(t("Erstelle einen Zettel, um deine Zeitleiste zu beginnen.")) + "</p>");
  decorate($('#storyboard-view'));
  updateLinkStatus();
  if (!timeline) {
    board.style.minWidth = Math.max(600, ...notes.map(note => note.x + boardOffset.x + noteWidth + 112)) + 'px';
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
    const markers = Object.keys(linkColors).map(color =>
      `<marker id="board-arrow-${color}" data-link-color="${color}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"/></marker>`);
    const pairs = new Map();
    const fromPort = (from, to) => from.left <= to.left ? [from.right, to.left] : [from.left, to.right];
    const curvePath = (x1, y1, x2, y2, offset = 0) => {
      const gap = Math.max(35, Math.abs(x2 - x1) * .45);
      const direction = Math.sign(x2 - x1) || 1;
      return `M ${x1} ${y1} C ${x1 + direction * gap} ${y1 + offset}, ${x2 - direction * gap} ${y2 + offset}, ${x2} ${y2}`;
    };
    for (const link of state.storyLinks) {
      const from = notePositions.get(link.from), to = notePositions.get(link.to);
      if (!from || !to) continue;
      const key = JSON.stringify([link.from, link.to].sort());
      const index = pairs.get(key) ?? 0;
      pairs.set(key, index + 1);
      const offset = index === 0 ? 0 : (index % 2 ? -1 : 1) * 38 * Math.ceil(index / 2);
      const overlap = from.left < to.right && to.left < from.right;
      const [x1, x2] = overlap ? [from.right, to.right] : fromPort(from, to);
      const y1 = from.top - box.top + 60 + Math.max(-32, Math.min(32, offset / 3));
      const y2 = to.top - box.top + 60 + Math.max(-32, Math.min(32, offset / 3));
      const bow = Math.max(x1, x2) - box.left + 62 + index * 15;
      const path = overlap
        ? `M ${x1 - box.left} ${y1} C ${bow} ${y1}, ${bow} ${y2}, ${x2 - box.left} ${y2}`
        : curvePath(x1 - box.left, y1, x2 - box.left, y2, offset);
      paths.push(`<path class="story-edge" data-link-color="${link.color}" d="${path}" marker-end="url(#board-arrow-${link.color})"/><path class="story-edge-hit" data-edge-id="${esc(link.id)}" d="${path}"/>`);
    }
    if (linking && linkPointer && notePositions.has(linking)) {
      const from = notePositions.get(linking);
      const startX = linkPointer.x >= from.left + from.width / 2 ? from.right : from.left;
      paths.push(`<path class="story-edge story-edge-preview" data-link-color="${$('#connection-color').value}" d="${curvePath(startX - box.left, from.top - box.top + 60, linkPointer.x - box.left, linkPointer.y - box.top)}"/>`);
    }
    svg.innerHTML = '<defs>' + markers.join('') + '</defs>' + paths.join('');
  });
}

function editStoryboardNote(existing) {
  const notes = state.storyboard;
  const order = existing?.order ?? Math.min(99999, Math.max(0, ...notes.map(note => note.order)) + 1);
  const chapterOptions = state.chapters.map((item, index) => `<label><input type="checkbox" name="chapters" value="${esc(item.id)}" ${existing?.chapters.includes(item.id) ? 'checked' : ''}> <span>${index + 1}. ${esc(item.title || t("Ohne Titel"))}</span></label>`).join('');
  const form = [
    field(t("Titel"), `<input name="title" required maxlength="100" value="${esc(existing?.title)}" autofocus>`),
    '<div class="note-form-row">' + field(t("Zeitleistenposition"), `<input name="order" required type="number" min="1" max="99999" value="${order}">`)
      + field(t("Zeitpunkt (optional)"), `<input name="when" maxlength="80" placeholder="${esc(t("Tag 3 · abends"))}" value="${esc(existing?.when)}">`) + '</div>',
    field(t("Notiz"), `<textarea name="body" rows="4" maxlength="2000">${esc(existing?.body)}</textarea>`),
    field(t("Farbe"), `<select name="color">${Object.entries(noteColors).map(([key, label]) => option(key, t(label), existing?.color ?? 'sand')).join('')}</select>`),
    `<fieldset class="note-chapter-picker"><legend>${esc(t("Mit Kapiteln verknüpfen"))}</legend><div>${chapterOptions}</div></fieldset>`,
    existing ? noteLinks(existing.id) : '',
    existing ? ("<button type=\"button\" id=\"delete-story-note\" class=\"text-button\">" + esc(t("Zettel löschen")) + "</button>") : ''
  ].join('');
  openModal(existing ? t("Zettel bearbeiten") : t("Zettel hinzufügen"), form, data => {
    const title = String(data.get('title')).trim();
    if (!title) throw new Error(t("Gib dem Zettel einen Titel."));
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
  if (existing) for (const button of $$('#modal-content [data-edit-story-link]')) {
    button.onclick = () => editStoryLink(button.dataset.editStoryLink);
  }
  if (existing) $('#delete-story-note').onclick = () => {
    openModal(t("Zettel löschen?"), `<p>${esc(t("„{title}“ wird von der Pinnwand und der Zeitleiste entfernt.", { title: existing.title }))}</p>`, () => {
      state.storyboard = state.storyboard.filter(note => note.id !== existing.id);
      state.storyLinks = state.storyLinks.filter(link => link.from !== existing.id && link.to !== existing.id);
      queueSave();
      renderStoryboard();
    }, t("Löschen"));
  };
}

function moveStoryboardNote(card, x, y) {
  card.style.left = boardOffset.x + x + 'px';
  card.style.top = boardOffset.y + y + 'px';
  board.style.minWidth = Math.max(parseFloat(board.style.minWidth) || 600, boardOffset.x + x + noteWidth + 112) + 'px';
  board.style.minHeight = Math.max(parseFloat(board.style.minHeight) || 550, boardOffset.y + y + card.offsetHeight + 32) + 'px';
  requestBoardLines();
}

$('#add-story-note').onclick = () => editStoryboardNote();
for (const button of $$('[data-board-mode]')) button.onclick = () => {
  boardMode = button.dataset.boardMode;
  renderStoryboard();
};
$('#storyboard-view').addEventListener('click', event => {
  const edge = event.target.closest('[data-edge-id]');
  if (edge) return editStoryLink(edge.dataset.edgeId);
  const card = event.target.closest('[data-note-id]');
  if (event.target.closest('[data-note-port]') && card) {
    if (linking && linking !== card.dataset.noteId) finishLink(card.dataset.noteId);
    else if (linking === card.dataset.noteId) cancelLink();
    else startLink(card.dataset.noteId);
    return;
  }
  if (linking && card && !event.target.closest('[data-note-grip],[data-open-chapter]')) return finishLink(card.dataset.noteId);
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

function timelineNotes() {
  return [...state.storyboard].sort((a, b) => a.order - b.order);
}
function reorderTimeline(source, target, after) {
  if (source === target) return;
  const notes = timelineNotes();
  const from = notes.find(note => note.id === source);
  if (!from || !notes.some(note => note.id === target)) return;
  notes.splice(notes.indexOf(from), 1);
  notes.splice(notes.findIndex(note => note.id === target) + Number(after), 0, from);
  notes.forEach((note, index) => { note.order = index + 1; });
  queueSave();
  const scroll = timelinePanel.scrollTop;
  renderStoryboard();
  timelinePanel.scrollTop = scroll;
}
function clearTimelineTarget() {
  for (const row of timelinePanel.querySelectorAll('.drop-before,.drop-after')) row.classList.remove('drop-before','drop-after');
}
timelinePanel.addEventListener('dragstart', event => {
  const grip = event.target.closest('[data-timeline-grip]');
  if (!grip) return;
  timelineDrag = grip.closest('[data-timeline-id]').dataset.timelineId;
  event.dataTransfer.setData('application/x-scripter-timeline', timelineDrag);
  event.dataTransfer.effectAllowed = 'move';
});
timelinePanel.addEventListener('dragover', event => {
  const row = event.target.closest('[data-timeline-id]');
  if (!timelineDrag || !row || row.dataset.timelineId === timelineDrag) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const box = row.getBoundingClientRect();
  clearTimelineTarget();
  row.classList.add(event.clientY > box.top + box.height / 2 ? 'drop-after' : 'drop-before');
});
timelinePanel.addEventListener('drop', event => {
  const row = event.target.closest('[data-timeline-id]');
  if (!timelineDrag || !row) return;
  event.preventDefault();
  const box = row.getBoundingClientRect();
  reorderTimeline(timelineDrag, row.dataset.timelineId, event.clientY > box.top + box.height / 2);
  timelineDrag = undefined;
  clearTimelineTarget();
});
timelinePanel.addEventListener('dragend', () => { timelineDrag = undefined; clearTimelineTarget(); });
timelinePanel.addEventListener('click', event => {
  const control = event.target.closest('[data-timeline-move]');
  if (!control) return;
  const id = control.closest('[data-timeline-id]').dataset.timelineId;
  const notes = timelineNotes();
  const offset = Number(control.dataset.timelineMove);
  const target = notes[notes.findIndex(note => note.id === id) + offset];
  if (target) reorderTimeline(id, target.id, offset > 0);
});
timelinePanel.addEventListener('keydown', event => {
  const grip = event.target.closest('[data-timeline-grip]');
  if (!grip || !['ArrowUp','ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const id = grip.closest('[data-timeline-id]').dataset.timelineId;
  const notes = timelineNotes();
  const after = event.key === 'ArrowDown';
  const target = notes[notes.findIndex(note => note.id === id) + (after ? 1 : -1)];
  if (!target) return;
  reorderTimeline(id, target.id, after);
  [...timelinePanel.querySelectorAll('[data-timeline-id]')].find(row => row.dataset.timelineId === id)?.querySelector('[data-timeline-grip]').focus();
});
function updateLinkStatus() {
  const note = state.storyboard.find(item => item.id === linking);
  $('#board-instruction').textContent = note ? t("Zielzettel für „{title}“ wählen", { title: note.title }) : t("Zettel über das Kettensymbol verbinden");
  for (const card of board.querySelectorAll('[data-note-id]')) card.classList.toggle('linking', card.dataset.noteId === linking);
}
function startLink(id) {
  linking = id;
  updateLinkStatus();
}
function cancelLink() {
  linking = linkPointer = undefined;
  updateLinkStatus();
  requestBoardLines();
}
function finishLink(id) {
  const color = $('#connection-color').value;
  if (linking !== id && state.storyboard.some(note => note.id === id) && state.storyboard.some(note => note.id === linking)) {
    if (!state.storyLinks.some(link => link.from === linking && link.to === id && link.color === color)) {
      state.storyLinks.push({ id: crypto.randomUUID(), from: linking, to: id, color });
      queueSave();
    }
  }
  cancelLink();
}
board.addEventListener('dragstart', event => {
  const port = event.target.closest('[data-note-port]');
  if (!port) return;
  startLink(port.closest('[data-note-id]').dataset.noteId);
  event.dataTransfer.setData('application/x-scripter-link', linking);
  event.dataTransfer.effectAllowed = 'link';
});
board.addEventListener('dragover', event => {
  if (!linking || !event.dataTransfer.types.includes('application/x-scripter-link')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'link';
  linkPointer = { x: event.clientX, y: event.clientY };
  requestBoardLines();
});
board.addEventListener('drop', event => {
  if (!linking || !event.dataTransfer.types.includes('application/x-scripter-link')) return;
  event.preventDefault();
  const target = event.target.closest('[data-note-id]');
  if (target) finishLink(target.dataset.noteId);
  else cancelLink();
});
board.addEventListener('dragend', () => { if (linking) cancelLink(); });
board.addEventListener('pointermove', event => {
  if (!linking) return;
  linkPointer = { x: event.clientX, y: event.clientY };
  requestBoardLines();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && linking) cancelLink();
});
$('#connection-color').onchange = requestBoardLines;

function noteLinks(id) {
  const nodes = new Map(state.storyboard.map(note => [note.id, note.title]));
  const links = state.storyLinks.filter(link => [link.from, link.to].includes(id));
  if (!links.length) return '';
  return ("<fieldset class=\"note-chapter-picker\"><legend>" + esc(t("Zettelverbindungen")) + "</legend><div>") + links.map(link =>
    `<button type="button" class="secondary" data-edit-story-link="${esc(link.id)}">${esc(nodes.get(link.from))} → ${esc(nodes.get(link.to))} · ${esc(t(linkColors[link.color]))}</button>`).join('') + '</div></fieldset>';
}
function editStoryLink(id) {
  const link = state.storyLinks.find(item => item.id === id);
  if (!link) return;
  const label = state.storyboard.find(note => note.id === link.from).title + ' → ' + state.storyboard.find(note => note.id === link.to).title;
  openModal(t("Zettelverbindung"), '<p>' + esc(label) + '</p>'
    + field(t("Linienfarbe"), `<select name="color">${Object.entries(linkColors).map(([key, label]) => option(key, t(label), link.color)).join('')}</select>`)
    + ("<button id=\"remove-story-link\" type=\"button\" class=\"text-button\">" + esc(t("Verbindung entfernen")) + "</button>"), data => {
    const color = data.get('color');
    if (state.storyLinks.some(item => item.id !== id && item.from === link.from && item.to === link.to && item.color === color)) throw new Error(t("Diese Verbindung gibt es bereits in der gewählten Farbe."));
    link.color = color;
    queueSave();
    requestBoardLines();
  });
  $('#remove-story-link').onclick = () => {
    state.storyLinks = state.storyLinks.filter(item => item.id !== id);
    queueSave();
    requestBoardLines();
    modal.close();
  };
}
