const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('desk', {
  get: () => call('get'), identity: () => call('identity'), save: project => call('save', project), flush: project => ipcRenderer.sendSync('flush', project),
  newProject: () => call('new'), openProject: () => call('open'), backup: () => call('backup'),
  pick: () => call('pick'), add: files => call('add', files), path: file => webUtils.getPathForFile(file),
  addLink: url => call('link', url), openAsset: id => call('open-asset', id), insertAsset: id => call('insert-asset', id),
  removeAsset: id => call('remove-asset', id), dictionary: (word, lang) => call('dictionary', word, lang),
  copy: text => call('copy', text), saveTranscript: (id, result) => call('save-transcript', id, result),
  suggest: (word, lang) => call('suggest', word, lang),
  spell: (words, lang) => call('spell', words, lang), zoom: value => call('zoom', value),
  publish: (format, manuscript) => call('publish', format, manuscript),
  transcribe: (source, lang) => call('transcribe', source, lang), setup: () => call('setup'),
  help: () => call('help')
});
