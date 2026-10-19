const { app, BrowserWindow, dialog, ipcMain, safeStorage, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createBackupStore } = require(path.join(__dirname, 'backup-store.js'));
const { createSettingsStore } = require(path.join(__dirname, 'settings-store.js'));
const { createModelClient } = require(path.join(__dirname, '..', 'server', 'model-client.js'));
const { createSearchClient } = require(path.join(__dirname, '..', 'server', 'search-client.js'));
const { createSocialBrowserManager } = require(path.join(__dirname, 'social-browser-manager.js'));
const { createBrowserPlatformAdapters } = require(path.join(__dirname, 'social-browser-adapters.js'));
const { createSocialApiClient, listSocialPlatformDefinitions } = require(path.join(__dirname, '..', 'server', 'social-api-client.js'));
const { createSocialAttachmentStore } = require(path.join(__dirname, 'social-attachment-store.js'));
const { createPromptAgentSources } = require(path.join(__dirname, 'prompt-agent-sources.js'));

const DEV_PAGE_URL = process.env.DESKTOP_SERVICE_URL || 'http://127.0.0.1:4173';
const SERVER_SHUTDOWN_TIMEOUT_MS = 2000;
let mainWindow;
let bundledService;
let localServiceUrl = DEV_PAGE_URL;
let settingsStore;
let backupStore;
let backupExportTempSequence = 0;
let socialBrowserManager;
const socialBrowserAdapters = new Map();
let socialAttachmentStore;
const socialProfiles = new Map();
const SOCIAL_PLATFORMS = new Set(listSocialPlatformDefinitions().map(item => item.platform));
const SOCIAL_START_URLS = Object.freeze({
  xiaohongshu: 'https://www.xiaohongshu.com/',
  reddit: 'https://www.reddit.com/',
  youtube: 'https://www.youtube.com/'
});
const SOCIAL_RESULT_DOMAINS = Object.freeze({
  xiaohongshu: new Set(['www.xiaohongshu.com', 'xiaohongshu.com']),
  reddit: new Set(['www.reddit.com', 'reddit.com']),
  youtube: new Set(['www.youtube.com', 'youtube.com'])
});
const SOCIAL_MODES = new Set(['auto', 'api', 'browser']);

function isDevelopment() {
  return !app.isPackaged || process.env.NODE_ENV === 'development';
}

async function requestLocalService(endpoint, options = {}) {
  const response = await fetch(`${localServiceUrl}${endpoint}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }

  if (!response.ok) {
    throw new Error(body?.message || `本地服务请求失败（${response.status}）`);
  }
  return body;
}

function getBundledServerPath() {
  return path.join(app.getAppPath(), 'server.js');
}

function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = createSettingsStore({ safeStorage, getUserDataPath: () => app.getPath('userData') });
  }
  return settingsStore;
}

function getBackupStore() {
  if (!backupStore) {
    backupStore = createBackupStore({ userDataPath: app.getPath('userData') });
  }
  return backupStore;
}

function getSocialManager() {
  if (!socialBrowserManager) {
    socialBrowserManager = createSocialBrowserManager({ BrowserWindow, session, app });
  }
  return socialBrowserManager;
}

function getSocialAdapter(platform, profileId) {
  const key = `${platform}:${profileId}`;
  let adapter = socialBrowserAdapters.get(key);
  if (!adapter) {
    adapter = createBrowserPlatformAdapters({ manager: getSocialManager() })[platform];
    adapter.attachSession(key);
    socialBrowserAdapters.set(key, adapter);
  }
  return adapter;
}

function getSocialAttachmentStore() {
  if (!socialAttachmentStore) socialAttachmentStore = createSocialAttachmentStore({ userDataPath: app.getPath('userData') });
  return socialAttachmentStore;
}

function validateSocialPlatform(platform) {
  if (typeof platform !== 'string' || !SOCIAL_PLATFORMS.has(platform)) {
    throw Object.assign(new TypeError(), { code: 'UNSUPPORTED_PLATFORM' });
  }
}

function validateSocialProfileId(profileId) {
  if (typeof profileId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profileId)) {
    throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  }
}

function validateSocialResultPayload(platform, payload) {
  validateSocialPayload(payload, ['profileId', 'resultId', 'url']);
  validateSocialProfileId(payload.profileId);
  if (typeof payload.resultId !== 'string' || !payload.resultId.trim() || payload.resultId.length > 512
    || typeof payload.url !== 'string' || !payload.url || payload.url.trim() !== payload.url || payload.url.length > 2048) {
    throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  }

  let resultUrl;
  try { resultUrl = new URL(payload.url); }
  catch { throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' }); }

  const hostname = resultUrl.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(resultUrl.protocol) || resultUrl.username || resultUrl.password
    || !SOCIAL_RESULT_DOMAINS[platform].has(hostname)) {
    throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  }
}

function validateSocialPayload(payload, allowedKeys) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some(key => !allowedKeys.includes(key))) {
    throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  }
}

function socialError(error) {
  const code = ['UNSUPPORTED_PLATFORM', 'INVALID_REQUEST', 'NOT_CONFIGURED', 'UNSUPPORTED_CAPABILITY', 'SESSION_NOT_FOUND', 'SESSION_CLOSED', 'NAVIGATION_TIMEOUT', 'UNSUPPORTED_PAGE', 'PAGE_READ_FAILED', 'NAVIGATION_FAILED', 'AUTH_FAILED', 'RATE_LIMITED', 'UPSTREAM_ERROR', 'TIMEOUT', 'INVALID_RESPONSE', 'EMPTY_RESULTS', 'REQUEST_FAILED', 'ATTACHMENT_ERROR'].includes(error?.code)
    ? error.code : 'REQUEST_FAILED';
  const messages = {
    UNSUPPORTED_PLATFORM: '不支持该平台。', INVALID_REQUEST: '请求参数无效。', NOT_CONFIGURED: '该平台 API 尚未安全配置。',
    UNSUPPORTED_CAPABILITY: '该平台暂不支持此 API 能力。', SESSION_NOT_FOUND: '尚未打开该平台浏览器。',
    SESSION_CLOSED: '平台浏览器已关闭。', NAVIGATION_TIMEOUT: '平台页面加载超时。', UNSUPPORTED_PAGE: '平台页面结构暂不支持。',
    PAGE_READ_FAILED: '无法读取平台页面。', NAVIGATION_FAILED: '平台页面导航失败。', AUTH_FAILED: '平台 API 凭证无效或已过期。',
    RATE_LIMITED: '平台 API 暂时限流。', UPSTREAM_ERROR: '平台 API 暂时不可用。', TIMEOUT: '平台 API 请求超时。',
    INVALID_RESPONSE: '平台 API 返回了无法识别的数据。', EMPTY_RESULTS: '平台 API 未返回可用结果。',
    ATTACHMENT_ERROR: '附件操作失败。', REQUEST_FAILED: '社媒请求失败。'
  };
  return { status: 'error', code, message: messages[code] };
}

function attachSocialProfile(platform, profileId) {
  socialProfiles.set(`${platform}:${profileId}`, { platform, profileId });
  getSocialAdapter(platform, profileId);
}

async function browserSocialSearch(platform, profileId, payload) {
  validateSocialProfileId(profileId);
  return getSocialAdapter(platform, profileId).search(payload.query, { maxResults: payload.maxResults });
}

async function runSocialSearch(platform, payload) {
  validateSocialPlatform(platform);
  validateSocialPayload(payload, ['query', 'profileId', 'mode', 'maxResults']);
  const query = typeof payload.query === 'string' ? payload.query.trim() : '';
  if (!query || query.length > 500) throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  const mode = payload.mode || 'auto';
  if (!SOCIAL_MODES.has(mode)) throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  const maxResults = payload.maxResults == null ? 5 : payload.maxResults;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  validateSocialProfileId(payload.profileId);
  const normalized = { query, profileId: payload.profileId, maxResults };

  if (mode !== 'browser' && platform !== 'xiaohongshu') {
    const settings = getSettingsStore();
    const config = typeof settings.getSocialApiConfig === 'function' ? settings.getSocialApiConfig(platform) : null;
    const client = createSocialApiClient({ platform, config: config || {} });
    if (client.configured) {
      const apiResult = await client.search(query, { maxResults });
      if (Array.isArray(apiResult) && (mode === 'api' || apiResult.length >= maxResults)) {
        return { status: 'ok', platform, retrievalMethod: 'api', results: apiResult };
      }
      if (!Array.isArray(apiResult) && mode === 'api') return socialError(apiResult);
    } else if (mode === 'api') {
      return socialError(Object.assign(new Error(), { code: 'NOT_CONFIGURED' }));
    }
  } else if (mode === 'api') {
    return socialError(Object.assign(new Error(), { code: 'UNSUPPORTED_CAPABILITY' }));
  }
  return browserSocialSearch(platform, payload.profileId, normalized);
}

function registerSocialHandlers() {
  ipcMain.handle('social:list-platforms', async () => listSocialPlatformDefinitions());
  ipcMain.handle('social:get-status', async (_event, platform) => {
    try {
      validateSocialPlatform(platform);
      const profiles = [...socialProfiles.values()].filter(item => item.platform === platform).map(item => ({
        profileId: item.profileId,
        ...getSocialManager().getSessionStatus(`${platform}:${item.profileId}`)
      }));
      return { status: 'ok', platform, apiConfigured: false, profiles };
    } catch (error) { return socialError(error); }
  });
  ipcMain.handle('social:open-login', async (_event, platform, profileId) => {
    try {
      validateSocialPlatform(platform); validateSocialProfileId(profileId);
      const manager = getSocialManager();
      const opened = await manager.openPlatformSession({ platform, profileId, startUrl: SOCIAL_START_URLS[platform] });
      attachSocialProfile(platform, profileId);
      return { status: 'ok', ...opened };
    } catch (error) { return socialError(error); }
  });
  ipcMain.handle('social:check', async (_event, platform, profileId) => {
    try {
      validateSocialPlatform(platform); validateSocialProfileId(profileId);
      if (!socialProfiles.has(`${platform}:${profileId}`)) return { status: 'not-ready', platform, profileId };
      return await getSocialAdapter(platform, profileId).checkReady();
    } catch (error) { return socialError(error); }
  });
  ipcMain.handle('social:search', async (_event, platform, payload) => {
    try { return await runSocialSearch(platform, payload); } catch (error) { return socialError(error); }
  });
  ipcMain.handle('social:fetch-detail', async (_event, platform, payload) => {
    try {
      validateSocialPlatform(platform); validateSocialResultPayload(platform, payload);
      return await getSocialAdapter(platform, payload.profileId).fetchDetail(payload);
    } catch (error) { return socialError(error); }
  });
  ipcMain.handle('social:capture-evidence', async (_event, platform, payload) => {
    try {
      validateSocialPlatform(platform); validateSocialResultPayload(platform, payload);
      return await getSocialAdapter(platform, payload.profileId).captureEvidence(payload, {});
    } catch (error) { return socialError(error); }
  });
  ipcMain.handle('social:close', async (_event, platform, profileId) => {
    try {
      validateSocialPlatform(platform); validateSocialProfileId(profileId);
      return { status: 'ok', ...(await getSocialManager().closeSession(`${platform}:${profileId}`)) };
    } catch (error) { return socialError(error); }
  });
  ipcMain.handle('social:clear-profile', async (_event, platform, profileId) => {
    try {
      validateSocialPlatform(platform); validateSocialProfileId(profileId);
      const result = await getSocialManager().clearPlatformProfile(platform, profileId);
      socialProfiles.delete(`${platform}:${profileId}`);
      socialBrowserAdapters.delete(`${platform}:${profileId}`);
      return { status: 'ok', ...result };
    } catch (error) { return socialError(error); }
  });
  ipcMain.handle('research:save-attachment', async (_event, payload) => {
    try { return { status: 'ok', attachment: getSocialAttachmentStore().save(payload) }; }
    catch { return socialError(Object.assign(new Error(), { code: 'ATTACHMENT_ERROR' })); }
  });
  ipcMain.handle('research:read-attachment', async (_event, id) => {
    try { return { status: 'ok', content: getSocialAttachmentStore().read(id).toString('base64') }; }
    catch { return socialError(Object.assign(new Error(), { code: 'ATTACHMENT_ERROR' })); }
  });
  ipcMain.handle('research:delete-attachment', async (_event, id) => {
    try { return { status: 'ok', ...getSocialAttachmentStore().delete(id) }; }
    catch { return socialError(Object.assign(new Error(), { code: 'ATTACHMENT_ERROR' })); }
  });
}

function showFileDialog(method, options) {
  if (mainWindow && !mainWindow.isDestroyed()) return dialog[method](mainWindow, options);
  return dialog[method](options);
}

function serializeBackupContent(content) {
  if (typeof content === 'string' || Buffer.isBuffer(content)) return content;
  const serialized = JSON.stringify(content);
  if (serialized === undefined) throw new TypeError('备份内容必须是字符串或可序列化对象');
  return serialized;
}

function validateBackupExportPath(filePath) {
  if (typeof filePath !== 'string' || !filePath || path.extname(filePath).toLowerCase() !== '.json') {
    throw new TypeError('只能导出 JSON 备份文件');
  }
}

function getBackupExportTempPath(filePath) {
  backupExportTempSequence += 1;
  return path.join(
    path.dirname(filePath),
    `.forward-step-backup-${process.pid}-${Date.now()}-${backupExportTempSequence}.tmp`
  );
}

function cleanupBackupExportTemp(tempPath) {
  try {
    fs.unlinkSync(tempPath);
  } catch (error) {
    if (error.code !== 'ENOENT') return false;
  }
  return true;
}

function writeBackupFileAtomically(filePath, content) {
  validateBackupExportPath(filePath);
  const tempPath = getBackupExportTempPath(filePath);

  try {
    fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tempPath, filePath);
  } catch {
    cleanupBackupExportTemp(tempPath);
    const error = new Error('备份导出失败，请检查目标文件权限或重试。');
    error.code = 'BACKUP_EXPORT_WRITE_FAILED';
    throw error;
  }
}

function readBackupFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (cause) {
    const error = new Error('备份文件读取失败，请检查文件是否存在或访问权限。');
    error.code = 'BACKUP_IMPORT_READ_FAILED';
    error.cause = cause;
    throw error;
  }
}

async function startBundledService() {
  if (bundledService) return localServiceUrl;

  const { startServer } = require(getBundledServerPath());
  bundledService = await startServer({ port: 0, host: '127.0.0.1', config: getSettingsStore().getServiceConfig() });
  const address = bundledService.address();
  if (!address || typeof address === 'string') {
    throw new Error('内置本地服务没有返回有效的监听地址');
  }
  localServiceUrl = `http://127.0.0.1:${address.port}`;
  return localServiceUrl;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const pageUrl = isDevelopment() ? DEV_PAGE_URL : await startBundledService();
  await mainWindow.loadURL(pageUrl);
}

async function reportStartupError(error) {
  console.error('应用启动失败：', error);
  try {
    const options = {
      type: 'error',
      title: '应用启动失败',
      message: '应用无法正常启动。',
      detail: error.message || String(error)
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, options);
    } else {
      await dialog.showMessageBox(options);
    }
  } catch (dialogError) {
    console.error('显示启动错误提示失败：', dialogError);
  } finally {
    app.quit();
  }
}

ipcMain.handle('config:get', async () => {
  const saved = getSettingsStore().getPublicConfig();
  let service = null;
  try {
    service = await requestLocalService('/api/config');
  } catch (error) {
    service = { available: false, message: error.message };
  }
  return { ...saved, service };
});

ipcMain.handle('config:save', async (_event, config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('配置必须是对象');
  }
  return getSettingsStore().save(config);
});

ipcMain.handle('model:request', async (_event, payload) => {
  const client = createModelClient(getSettingsStore().getServiceConfig());
  return client.request(payload?.messages, payload?.options);
});

ipcMain.handle('search:request', async (_event, payload) => {
  const client = createSearchClient(getSettingsStore().getServiceConfig());
  return client.search(String(payload?.query || '').trim(), payload?.options);
});

ipcMain.handle('backup:export', async (_event, content) => {
  const result = await showFileDialog('showSaveDialog', {
    title: '导出备份',
    defaultPath: path.join(app.getPath('documents'), 'forward-step-backup.json'),
    filters: [{ name: 'JSON 备份', extensions: ['json'] }],
    showOverwriteConfirmation: true
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  writeBackupFileAtomically(result.filePath, serializeBackupContent(content));
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('backup:import', async () => {
  const result = await showFileDialog('showOpenDialog', {
    title: '导入备份',
    properties: ['openFile'],
    filters: [{ name: 'JSON 备份', extensions: ['json'] }]
  });
  const filePath = result.filePaths?.[0];
  if (result.canceled || !filePath) return { canceled: true };
  if (path.extname(filePath).toLowerCase() !== '.json') {
    const error = new TypeError('只能导入 JSON 备份文件');
    error.code = 'BACKUP_IMPORT_INVALID_EXTENSION';
    throw error;
  }
  return {
    canceled: false,
    filePath,
    content: readBackupFile(filePath)
  };
});

ipcMain.handle('backup:list', async () => getBackupStore().listBackups());

ipcMain.handle('backup:read', async (_event, filename) => getBackupStore().readBackup(filename));

registerSocialHandlers();
createPromptAgentSources({ fs, path, userDataPath: app.getPath('userData'), dialog, ipcMain });

app.whenReady().then(() => createWindow()).catch(reportStartupError);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch(reportStartupError);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let shuttingDown = false;
app.on('before-quit', event => {
  if (!bundledService || shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;

  const forceCloseTimer = setTimeout(() => {
    bundledService.closeAllConnections?.();
    app.quit();
  }, SERVER_SHUTDOWN_TIMEOUT_MS);

  try {
    bundledService.close(() => {
      clearTimeout(forceCloseTimer);
      app.quit();
    });
  } catch (error) {
    clearTimeout(forceCloseTimer);
    console.error('关闭本地服务失败：', error);
    bundledService.closeAllConnections?.();
    app.quit();
  }
});
