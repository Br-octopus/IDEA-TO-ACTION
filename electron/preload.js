const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', Object.freeze({
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  requestModel: payload => ipcRenderer.invoke('model:request', payload),
  requestSearch: payload => ipcRenderer.invoke('search:request', payload),
  exportBackup: content => ipcRenderer.invoke('backup:export', content),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  readBackup: filename => ipcRenderer.invoke('backup:read', filename),
  social: Object.freeze({
    listPlatforms: () => ipcRenderer.invoke('social:list-platforms'),
    getStatus: platform => ipcRenderer.invoke('social:get-status', platform),
    openLogin: (platform, profileId) => ipcRenderer.invoke('social:open-login', platform, profileId),
    check: (platform, profileId) => ipcRenderer.invoke('social:check', platform, profileId),
    search: (platform, payload) => ipcRenderer.invoke('social:search', platform, payload),
    fetchDetail: (platform, payload) => ipcRenderer.invoke('social:fetch-detail', platform, payload),
    captureEvidence: (platform, payload) => ipcRenderer.invoke('social:capture-evidence', platform, payload),
    close: (platform, profileId) => ipcRenderer.invoke('social:close', platform, profileId),
    clearProfile: (platform, profileId) => ipcRenderer.invoke('social:clear-profile', platform, profileId)
  }),
  research: Object.freeze({
    saveAttachment: payload => ipcRenderer.invoke('research:save-attachment', payload),
    readAttachment: id => ipcRenderer.invoke('research:read-attachment', id),
    deleteAttachment: id => ipcRenderer.invoke('research:delete-attachment', id)
  })
}));
