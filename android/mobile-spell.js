const { loadModule } = require('hunspell-asm/dist/cjs/index.js');

const languages = ['de', 'en', 'es', 'pt', 'fr'];
const dictionaries = new Map();
let factory;

function checker(language) {
  if (!languages.includes(language)) throw new Error('Invalid language');
  if (!dictionaries.has(language)) {
    factory ??= loadModule();
    const bytes = async extension => {
      const response = await fetch(`/spell/${language}.${extension}`);
      if (!response.ok) throw new Error('Das Wörterbuch konnte nicht geladen werden.');
      return new Uint8Array(await response.arrayBuffer());
    };
    dictionaries.set(language, Promise.all([factory, bytes('aff'), bytes('dic')]).then(([hunspell, aff, dic]) =>
      hunspell.create(hunspell.mountBuffer(aff, language + '.aff'), hunspell.mountBuffer(dic, language + '.dic'))));
  }
  return dictionaries.get(language);
}

window.scripterSpell = {
  async check(words, language) {
    const dictionary = await checker(language);
    return words.filter(word => word.length > 1 && word.length < 45 && !dictionary.spell(word));
  },
  async suggest(word, language) {
    return (await checker(language)).suggest(word).slice(0, 12);
  }
};
