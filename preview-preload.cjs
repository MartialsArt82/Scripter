const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('previewData', {
  get: () => ipcRenderer.invoke('preview-pdf'),
  windowControl: action => ipcRenderer.invoke('window-control', action),
  onWindowState: callback => { ipcRenderer.on('window-state', (_, value) => callback(value)); }
});
