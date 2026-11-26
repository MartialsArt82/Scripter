'use strict';

globalThis.scripterI18n = (() => {
  const languages = Object.freeze({ de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español', pt: 'Português' });
  const normalize = code => Object.hasOwn(languages, code) ? code : 'de';
  const catalogs = new Map();
  let language = 'de';
  const loadLanguage = (code, messages) => catalogs.set(normalize(code), messages);
  const setLanguage = code => { language = normalize(code); return language; };
  const getLanguage = () => language;
  function t(key, values) {
    const catalog = catalogs.get(language);
    const text = catalog && Object.hasOwn(catalog, key) ? catalog[key] : key;
    return values ? text.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? values[name] : match) : text;
  }
  return { languages, normalize, loadLanguage, setLanguage, getLanguage, t };
})();

if (typeof module !== 'undefined') module.exports = globalThis.scripterI18n;
