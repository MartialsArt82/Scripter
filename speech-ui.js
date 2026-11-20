'use strict';

const speechLabels = { any: 'Alle Sprachen', de: 'Deutsch', en: 'Englisch' };

function speechDictionary() {
  const rows = state.speechRules.map(rule => `<li><div><strong>${esc(rule.to)}</strong><small>${rule.from ? 'Ersetzt „' + esc(rule.from) + '“ · ' : ''}${esc(speechLabels[rule.lang])}</small></div><button type="button" class="secondary" data-speech-edit="${esc(rule.id)}">Bearbeiten</button></li>`).join('');
  openModal('Sprachwörterbuch', '<p>Persönliche Namen und Wendungen für Diktat und Transkripte dieses Projekts.</p>'
    + '<button id="new-speech-rule" type="button" class="secondary"><span data-icon="plus"></span> Eintrag hinzufügen</button>'
    + (rows ? '<ul class="speech-rules">' + rows + '</ul>' : '<p>Dieses Projekt hat noch keine eigenen Einträge.</p>'));
  $('#new-speech-rule').onclick = () => editSpeechRule({ onSaved: speechDictionary });
  $('#modal-content').onclick = event => {
    const button = event.target.closest('[data-speech-edit]');
    if (!button) return;
    const rule = state.speechRules.find(item => item.id === button.dataset.speechEdit);
    if (rule) editSpeechRule({ rule, onSaved: speechDictionary });
  };
}

function editSpeechRule({ rule, marked = '', language = 'any', editorSelection, onSaved } = {}) {
  const from = rule?.from ?? marked;
  const to = rule?.to ?? '';
  const replace = editorSelection
    ? '<label class="speech-replace"><input type="checkbox" name="replace" checked> Markierten Text im Kapitel ersetzen</label>' : '';
  const remove = rule ? '<button type="button" id="delete-speech-rule" class="text-button">Eintrag löschen</button>' : '';
  openModal(rule ? 'Spracheintrag bearbeiten' : 'Ins Sprachwörterbuch', [
    field('Bisher erkannt (optional)', `<input name="from" maxlength="160" value="${esc(from)}">`),
    field('Gewünschte Formulierung', `<input name="to" required maxlength="160" value="${esc(to)}" autofocus>`),
    field('Gilt für', `<select name="lang">${Object.entries(speechLabels).map(([key, label]) => option(key, label, rule?.lang ?? language)).join('')}</select>`),
    '<p>Ein erkannter Ausdruck wird gezielt ersetzt. Ein Eintrag ohne bisherigen Ausdruck gibt Whisper einen Hinweis auf das gewünschte Vokabular.</p>',
    replace, remove
  ].join(''), async data => {
    const normalize = value => String(value).normalize('NFC').trim().replace(/\s+/gu, ' ');
    const entry = { id: rule?.id ?? crypto.randomUUID(), from: normalize(data.get('from')), to: normalize(data.get('to')), lang: data.get('lang') };
    if (!entry.to) throw new Error('Gib die gewünschte Formulierung ein.');
    const duplicate = state.speechRules.find(item => item.id !== entry.id && item.lang === entry.lang
      && (entry.from ? item.from.toLowerCase() === entry.from.toLowerCase() : !item.from && item.to.toLowerCase() === entry.to.toLowerCase()));
    if (duplicate) throw new Error('Für diese Form und Sprache gibt es bereits einen Eintrag. Du kannst ihn im Sprachwörterbuch bearbeiten.');
    const index = state.speechRules.findIndex(item => item.id === entry.id);
    if (index === -1 && state.speechRules.length >= 200) throw new Error('Das Sprachwörterbuch hat bereits 200 Einträge.');
    if (index === -1) state.speechRules.push(entry);
    else state.speechRules[index] = entry;
    queueSave();
    if (editorSelection && data.get('replace') && entry.to !== marked) {
      modal.close();
      selection = editorSelection;
      runEdit('insertText', entry.to);
    }
    toast('Im Sprachwörterbuch gespeichert.');
    if (onSaved) {
      await onSaved();
      return false;
    }
  });
  if (rule) $('#delete-speech-rule').onclick = () => {
    state.speechRules = state.speechRules.filter(item => item.id !== rule.id);
    queueSave();
    speechDictionary();
  };
}

$('#speech-vocabulary').onclick = speechDictionary;
$('#learn-speech').onmousedown = event => event.preventDefault();
$('#learn-speech').onclick = () => {
  rememberSelection();
  const marked = selection?.text?.trim();
  if (!marked) return toast('Markiere zuerst das Wort oder die Wendung im Manuskript.');
  if (marked.length > 160) return toast('Markiere höchstens 160 Zeichen.');
  editSpeechRule({ marked, editorSelection: selection });
};
