const speechText = value => typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/gu, ' ').slice(0, 160) : '';
const speechKey = value => speechText(value).toLowerCase();
const speechLanguages = ['any', 'de', 'en'];

function normalizeSpeechRules(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const from = speechText(item?.from);
    const to = speechText(item?.to);
    if (!to || typeof item?.id !== 'string' || !speechLanguages.includes(item.lang)) return [];
    return [{ id: item.id, from, to, lang: item.lang }];
  }).slice(0, 200);
}

function voiceHints(rules, language) {
  const applicable = rules.filter(item => language === 'auto' || item.lang === 'any' || item.lang === language);
  return [...new Set(applicable.map(item => item.to).reverse())].slice(0, 24).join(', ').slice(0, 480);
}

function applySpeechRules(transcript, rules) {
  const replacements = new Map();
  for (const rule of rules) {
    if (rule.lang === 'any' && rule.from) replacements.set(speechKey(rule.from), rule.to);
  }
  for (const rule of rules) {
    if (rule.lang === transcript.language && rule.from) replacements.set(speechKey(rule.from), rule.to);
  }

  const alternatives = [...replacements.keys()].sort((a, b) => b.length - a.length).map(term =>
    term.split(' ').map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  );
  const word = '[\\p{L}\\p{N}\\p{M}_]';
  const pattern = replacements.size ? new RegExp('(?<!' + word + ')(?:' + alternatives.join('|') + ')(?!' + word + ')', 'giu') : null;
  return {
    ...transcript,
    segments: transcript.segments.map(segment => {
      const { originalText, text: previous, ...details } = segment;
      const original = originalText ?? previous;
      const text = pattern ? original.normalize('NFC').replace(pattern, match => replacements.get(speechKey(match)) ?? match) : original;
      return text === original ? { ...details, text } : { ...details, text, originalText: original };
    })
  };
}

const speechRules = { normalizeSpeechRules, voiceHints, applySpeechRules };
if (typeof module !== 'undefined') module.exports = speechRules;
