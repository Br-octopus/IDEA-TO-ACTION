const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', Object.freeze({
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  requestModel: payload => ipcRenderer.invoke('model:request', payload),
  requestSearch: payload => ipcRenderer.invoke('search:request', payload)
}));
