const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('desk', {
  get: () => call('get'), identity: () => call('identity'), save: project => call('save', project), flush: project => ipcRenderer.sendSync('flush', project),
  newProject: (cloud, details, discard) => call('new', cloud, details, discard),
  openProject: (cloud, details, discard) => call('open', cloud, details, discard),
  backup: (draft, cloud, saveAs) => call('backup', draft, cloud, saveAs),
  waitForSave: () => call('wait-for-archive'),
  onArchiveError: callback => { ipcRenderer.on('archive-error', (_, message) => callback(message)); },
  unavailableProject: () => call('unavailable-project'), locations: () => call('locations'), saveLocations: value => call('save-locations', value), chooseFolder: path => call('choose-folder', path),
  pick: () => call('pick'), add: files => call('add', files), path: file => webUtils.getPathForFile(file),
  addLink: url => call('link', url), openAsset: id => call('open-asset', id), insertAsset: id => call('insert-asset', id),
  removeAsset: id => call('remove-asset', id), dictionary: (word, lang) => call('dictionary', word, lang),
  copy: text => call('copy', text), saveTranscript: (id, result) => call('save-transcript', id, result),
  suggest: (word, lang) => call('suggest', word, lang),
  spell: (words, lang) => call('spell', words, lang), zoom: value => call('zoom', value),
  publish: (format, manuscript) => call('publish', format, manuscript),
  transcribe: (source, lang) => call('transcribe', source, lang),
  refreshTranscript: value => call('refresh-transcript', value), setup: () => call('setup'),
  windowControl: action => call('window-control', action),
  onWindowState: callback => { ipcRenderer.on('window-state', (_, value) => callback(value)); },
  openKofi: () => call('open-kofi'),
  help: () => call('help')
});
