const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('previewData', { get: () => ipcRenderer.invoke('preview-pdf') });
