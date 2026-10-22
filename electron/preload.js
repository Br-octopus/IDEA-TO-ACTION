const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', Object.freeze({
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  requestModel: payload => ipcRenderer.invoke('model:request', payload),
  requestSearch: payload => ipcRenderer.invoke('search:request', payload),
  exportBackup: content => ipcRenderer.invoke('backup:export', content),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  commitBackupImport: (stageId, attachmentIds, targetAttachmentIds) => ipcRenderer.invoke('backup:commit-import', {
    stageId, attachmentIds, ...(Array.isArray(targetAttachmentIds) ? { targetAttachmentIds } : {})
  }),
  discardBackupImport: stageId => ipcRenderer.invoke('backup:discard-import', stageId),
  finalizeBackupImport: transactionId => ipcRenderer.invoke('backup:finalize-import', transactionId),
  rollbackBackupImport: transactionId => ipcRenderer.invoke('backup:rollback-import', transactionId),
  recoverBackupImports: attachmentIds => ipcRenderer.invoke('backup:recover-imports', attachmentIds),
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
  socialSource: Object.freeze({
    list: () => ipcRenderer.invoke('social-source:list'),
    beginResearchOperation: () => ipcRenderer.invoke('social-source:research:begin'),
    endResearchOperation: leaseId => ipcRenderer.invoke('social-source:research:end', { leaseId }),
    listVersions: () => ipcRenderer.invoke('social-source:versions:list'),
    prepareVersion: (sourceId, versionId) => ipcRenderer.invoke('social-source:version:prepare', { sourceId, versionId }),
    activateVersion: (sourceId, versionId) => ipcRenderer.invoke('social-source:version:activate', { sourceId, versionId, confirmed: true }),
    rollbackVersion: sourceId => ipcRenderer.invoke('social-source:version:rollback', { sourceId, confirmed: true }),
    cleanupVersions: sourceId => ipcRenderer.invoke('social-source:version:cleanup', { sourceId, confirmed: true }),
    uninstall: sourceId => ipcRenderer.invoke('social-source:uninstall', { sourceId, confirmed: true }),
    getDiagnostics: () => ipcRenderer.invoke('social-source:diagnostics'),
    checkEnvironment: sourceId => ipcRenderer.invoke('social-source:check-environment', sourceId),
    prepare: sourceId => ipcRenderer.invoke('social-source:prepare', sourceId),
    openLogin: request => ipcRenderer.invoke('social-source:open-login', request),
    run: request => ipcRenderer.invoke('social-source:run', request),
    cancel: request => ipcRenderer.invoke('social-source:cancel', request),
    stopProfile: request => ipcRenderer.invoke('social-source:stop-profile', request),
    onProgress: listener => {
      if (typeof listener !== 'function') throw new TypeError('listener 必须是函数');
      const handler = (_event, progress) => listener(progress);
      ipcRenderer.on('social-source:progress', handler);
      return () => ipcRenderer.removeListener('social-source:progress', handler);
    }
  }),
  research: Object.freeze({
    saveAttachment: payload => ipcRenderer.invoke('research:save-attachment', payload),
    readAttachment: id => ipcRenderer.invoke('research:read-attachment', id),
    deleteAttachment: id => ipcRenderer.invoke('research:delete-attachment', id)
  }),
  promptAgentSources: Object.freeze({
    selectDirectory: () => ipcRenderer.invoke('prompt-agent-sources:select-directory'),
    listAuthorized: () => ipcRenderer.invoke('prompt-agent-sources:list-authorized'),
    refreshIndex: id => ipcRenderer.invoke('prompt-agent-sources:refresh-index', id),
    searchIndex: (id, query, filters) => ipcRenderer.invoke('prompt-agent-sources:search-index', id, query, filters),
    setAuthorizationEnabled: (id, enabled) => ipcRenderer.invoke('prompt-agent-sources:set-authorization-enabled', id, enabled),
    removeAuthorization: id => ipcRenderer.invoke('prompt-agent-sources:remove-authorization', id)
  })
}));
