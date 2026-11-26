'use strict';

const { t } = scripterI18n;
const translateInterface = (() => {
  const text = [];
  const attributes = [];
  const translatable = ['aria-label', 'title', 'placeholder', 'data-placeholder'];
  const reader = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: node => /\p{L}/u.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  });
  while (reader.nextNode()) text.push([reader.currentNode, reader.currentNode.nodeValue]);
  for (const node of document.querySelectorAll(translatable.map(name => '[' + name + ']').join(','))) {
    for (const name of translatable) {
      if (node.hasAttribute(name)) attributes.push([node, name, node.getAttribute(name)]);
    }
  }
  return code => {
    document.documentElement.lang = scripterI18n.setLanguage(code);
    for (const [node, original] of text) {
      if (node.isConnected) node.nodeValue = original.replace(/\S(?:[\s\S]*\S)?/, key => t(key));
    }
    for (const [node, name, original] of attributes) {
      if (node.isConnected) node.setAttribute(name, t(original));
    }
  };
})();

const requestedLanguage = new URLSearchParams(location.search).get('lang');
if (requestedLanguage) translateInterface(requestedLanguage);
