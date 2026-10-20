const { app, BrowserWindow, dialog, ipcMain, safeStorage, session } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createBackupStore } = require(path.join(__dirname, 'backup-store.js'));
const { createSettingsStore } = require(path.join(__dirname, 'settings-store.js'));
const { createModelClient } = require(path.join(__dirname, '..', 'server', 'model-client.js'));
const { createSearchClient } = require(path.join(__dirname, '..', 'server', 'search-client.js'));
const { createSocialBrowserManager } = require(path.join(__dirname, 'social-browser-manager.js'));
const { createSocialSourceManager } = require(path.join(__dirname, 'social-source-manager.js'));
const { createBrowserPlatformAdapters, isRegisteredSearchAdapter } = require(path.join(__dirname, 'social-browser-adapters.js'));
const { parseSocialContentUrl } = require(path.join(__dirname, 'social-content-url.js'));
const { createSocialApiClient, listSocialPlatformDefinitions, SOCIAL_API_CODES } = require(path.join(__dirname, '..', 'server', 'social-api-client.js'));
const { createSocialAttachmentStore } = require(path.join(__dirname, 'social-attachment-store.js'));
const workspaceArchive = require(path.join(__dirname, 'workspace-backup-archive.js'));
const { createPromptAgentSources } = require(path.join(__dirname, 'prompt-agent-sources.js'));
const { createPptSourceReader } = require(path.join(__dirname, 'ppt-source-reader.js'));
const { createPptFeedbackAttachmentStore } = require(path.join(__dirname, 'ppt-feedback-attachment-store.js'));
const { createPptPreviewManager } = require(path.join(__dirname, 'ppt-preview-manager.js'));

const DEV_PAGE_URL = process.env.DESKTOP_SERVICE_URL || 'http://127.0.0.1:4173';
const SERVER_SHUTDOWN_TIMEOUT_MS = 2000;
let mainWindow;
let bundledService;
let localServiceUrl = DEV_PAGE_URL;
let settingsStore;
let backupStore;
let backupExportTempSequence = 0;
let socialBrowserManager;
let socialSourceManager;
const socialBrowserAdapters = new Map();
let socialAttachmentStore;
let pptFeedbackAttachmentStore;
let pptPreviewManager;
const activePptPreviews = new Set();
const deletedPptAttachments = new Set();
const socialProfiles = new Map();
const backupImportStages = new Map();
const backupImportTransactions = new Map();
const SOCIAL_PLATFORMS = new Set(listSocialPlatformDefinitions().map(item => item.platform));
const SOCIAL_START_URLS = Object.freeze({
  xiaohongshu: 'https://www.xiaohongshu.com/',
  bilibili: 'https://www.bilibili.com/',
  weibo: 'https://weibo.com/',
  zhihu: 'https://www.zhihu.com/',
  reddit: 'https://www.reddit.com/',
  youtube: 'https://www.youtube.com/'
});
const SOCIAL_RESULT_DOMAINS = Object.freeze({
  xiaohongshu: new Set(['www.xiaohongshu.com', 'xiaohongshu.com']),
  bilibili: new Set(['www.bilibili.com', 'bilibili.com']),
  weibo: new Set(['www.weibo.com', 'weibo.com']),
  zhihu: new Set(['www.zhihu.com', 'zhihu.com', 'zhuanlan.zhihu.com']),
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

function getSocialSourceManager() {
  if (!socialSourceManager) socialSourceManager = createSocialSourceManager({ app, resourcesPath: process.resourcesPath });
  return socialSourceManager;
}

function getSocialAdapter(platform, profileId) {
  const key = `${platform}:${profileId}`;
  let adapter = socialBrowserAdapters.get(key);
  if (!adapter) {
    adapter = createBrowserPlatformAdapters({ manager: getSocialManager() })[platform];
    if (!adapter || typeof adapter.search !== 'function') {
      throw Object.assign(new Error('该平台没有已注册的只读浏览器搜索适配器'), { code: 'UNSUPPORTED_CAPABILITY' });
    }
    adapter.attachSession(key);
    socialBrowserAdapters.set(key, adapter);
  }
  return adapter;
}

function getSocialAttachmentStore() {
  if (!socialAttachmentStore) socialAttachmentStore = createSocialAttachmentStore({ userDataPath: app.getPath('userData') });
  return socialAttachmentStore;
}

function getPptFeedbackAttachmentStore() {
  if (!pptFeedbackAttachmentStore) {
    pptFeedbackAttachmentStore = createPptFeedbackAttachmentStore({ app, fs, path });
  }
  return pptFeedbackAttachmentStore;
}

function getPptPreviewManager() {
  if (!pptPreviewManager) {
    pptPreviewManager = createPptPreviewManager({
      BrowserWindow,
      session,
      fs,
      path,
      app,
      attachmentStore: getPptFeedbackAttachmentStore(),
      createId: () => randomUUID()
    });
  }
  return pptPreviewManager;
}

function createPptFeedbackError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validatePptFeedbackId(value, code, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw createPptFeedbackError(code, `${label}无效。`);
  }
  return value;
}

function validatePptFeedbackRequest(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowedKeys.includes(key))) {
    throw createPptFeedbackError('INVALID_REQUEST', '请求参数无效。');
  }
}

function validatePptFeedbackTaskRequest(request) {
  validatePptFeedbackRequest(request, ['taskId']);
  return validatePptFeedbackId(request.taskId, 'INVALID_TASK_ID', '任务标识');
}

function validatePptFeedbackAttachmentRequest(request) {
  validatePptFeedbackRequest(request, ['attachmentId']);
  return validatePptFeedbackId(request.attachmentId, 'INVALID_ATTACHMENT_ID', '附件标识');
}

function validatePptAnnotationTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注定位无效。');
  }
  const finiteCoordinate = (value, label) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw createPptFeedbackError('INVALID_ANNOTATION', `${label}无效。`);
    }
    return value;
  };
  if (target.kind === 'element') {
    validatePptFeedbackRequest(target, ['kind', 'selector']);
    if (typeof target.selector !== 'string' || !target.selector.trim() || target.selector.length > 500) {
      throw createPptFeedbackError('INVALID_ANNOTATION', 'HTML selector 无效。');
    }
    return { kind: 'element', selector: target.selector.trim() };
  }
  if (target.kind === 'point') {
    validatePptFeedbackRequest(target, ['kind', 'x', 'y']);
    return { kind: 'point', x: finiteCoordinate(target.x, '横坐标'), y: finiteCoordinate(target.y, '纵坐标') };
  }
  if (target.kind === 'region') {
    validatePptFeedbackRequest(target, ['kind', 'x', 'y', 'width', 'height']);
    const x = finiteCoordinate(target.x, '横坐标');
    const y = finiteCoordinate(target.y, '纵坐标');
    if (typeof target.width !== 'number' || !Number.isFinite(target.width) || target.width <= 0
      || typeof target.height !== 'number' || !Number.isFinite(target.height) || target.height <= 0
      || x + target.width > 1 || y + target.height > 1) {
      throw createPptFeedbackError('INVALID_ANNOTATION', '标注区域无效。');
    }
    return { kind: 'region', x, y, width: target.width, height: target.height };
  }
  throw createPptFeedbackError('INVALID_ANNOTATION', '标注定位类型无效。');
}

function validatePptAnnotation(annotation) {
  const allowedKeys = [
    'id', 'taskId', 'attachmentId', 'contentHash', 'pageIndex', 'target',
    'comment', 'category', 'createdAt', 'status', 'selected'
  ];
  validatePptFeedbackRequest(annotation, allowedKeys);
  const taskId = validatePptFeedbackId(annotation.taskId, 'INVALID_TASK_ID', '任务标识');
  const attachmentId = validatePptFeedbackId(annotation.attachmentId, 'INVALID_ATTACHMENT_ID', '附件标识');
  if (annotation.id !== undefined) validatePptFeedbackId(annotation.id, 'INVALID_ANNOTATION', '标注标识');
  if (typeof annotation.contentHash !== 'string' || !annotation.contentHash.trim() || annotation.contentHash.length > 140) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注版本摘要无效。');
  }
  const comment = typeof annotation.comment === 'string' ? annotation.comment.trim() : '';
  if (!comment || comment.length > 2000 || /^data:/i.test(comment)) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注评论无效。');
  }
  const category = annotation.category === undefined ? 'other' : annotation.category;
  if (!['content', 'logic', 'evidence', 'style', 'layout', 'format', 'readability', 'other'].includes(category)) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注分类无效。');
  }
  const pageIndex = annotation.pageIndex === undefined ? 0 : annotation.pageIndex;
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注页码无效。');
  }
  const status = annotation.status === undefined ? 'active' : annotation.status;
  if (!['active', 'stale'].includes(status)) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注状态无效。');
  }
  if (annotation.createdAt !== undefined && (typeof annotation.createdAt !== 'string' || annotation.createdAt.length > 80)) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注时间无效。');
  }
  if (annotation.selected !== undefined && typeof annotation.selected !== 'boolean') {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注选择状态无效。');
  }
  const target = validatePptAnnotationTarget(annotation.target);
  const id = annotation.id || crypto.randomUUID();
  const createdAt = annotation.createdAt || new Date().toISOString();
  return { id, taskId, attachmentId, contentHash: annotation.contentHash.trim(), pageIndex, target, comment, category, createdAt, status, selected: annotation.selected === true };
}

function annotationsPath(taskId) {
  return path.join(app.getPath('userData'), 'ppt-feedback', taskId, 'annotations.json');
}

function readPptAnnotations(taskId) {
  const filePath = annotationsPath(taskId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(stored)) throw new Error('annotations must be an array');
    return stored.map(validatePptAnnotation);
  } catch (cause) {
    throw createPptFeedbackError('ANNOTATION_READ_FAILED', `标注读取失败：${cause.message}`);
  }
}

function savePptAnnotations(taskId, annotations) {
  const filePath = annotationsPath(taskId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(annotations), { encoding: 'utf8', mode: 0o600 });
  if (typeof fs.chmodSync === 'function') fs.chmodSync(filePath, 0o600);
}

function registerPptFeedbackHandlers() {
  ipcMain.handle('ppt-feedback:choose-file', async (_event, request) => {
    const taskId = validatePptFeedbackTaskRequest(request);
    const result = await showFileDialog('showOpenDialog', {
      title: '选择 PPT 反馈附件',
      properties: ['openFile'],
      filters: [{ name: 'HTML 与图片', extensions: ['html', 'htm', 'png', 'jpg', 'jpeg', 'webp'] }]
    });
    const sourcePath = result.filePaths?.[0];
    if (result.canceled || !sourcePath) return { canceled: true };
    const extension = path.extname(sourcePath).toLowerCase();
    const mimeType = {
      '.html': 'text/html', '.htm': 'text/html', '.png': 'image/png',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'
    }[extension];
    if (!mimeType) throw createPptFeedbackError('INVALID_ATTACHMENT', '附件格式不受支持。');
    const attachment = await getPptFeedbackAttachmentStore().saveAttachment({ taskId, sourcePath, mimeType });
    return { canceled: false, attachment };
  });

  ipcMain.handle('ppt-feedback:list-attachments', async (_event, request) => {
    const taskId = validatePptFeedbackTaskRequest(request);
    const attachments = getPptFeedbackAttachmentStore().listAttachments(taskId)
      .filter(attachment => !deletedPptAttachments.has(attachment.id));
    return { status: 'ok', attachments };
  });

  ipcMain.handle('ppt-feedback:open-preview', async (_event, request) => {
    const attachmentId = validatePptFeedbackAttachmentRequest(request);
    if (deletedPptAttachments.has(attachmentId)) throw createPptFeedbackError('INVALID_ATTACHMENT_ID', '附件不存在。');
    const result = await getPptPreviewManager().openPreview({ attachmentId });
    if (result.status === 'opened') activePptPreviews.add(attachmentId);
    return result;
  });

  ipcMain.handle('ppt-feedback:close-preview', async (_event, request) => {
    const attachmentId = validatePptFeedbackAttachmentRequest(request);
    const closed = pptPreviewManager ? await pptPreviewManager.closePreview(attachmentId) : false;
    activePptPreviews.delete(attachmentId);
    return { status: 'ok', attachmentId, closed };
  });

  ipcMain.handle('ppt-feedback:delete-attachment', async (_event, request) => {
    const attachmentId = validatePptFeedbackAttachmentRequest(request);
    if (deletedPptAttachments.has(attachmentId)) throw createPptFeedbackError('INVALID_ATTACHMENT_ID', '附件不存在。');
    const store = getPptFeedbackAttachmentStore();
    const attachmentPath = store.getAttachmentPath(attachmentId);
    if (pptPreviewManager) await pptPreviewManager.closePreview(attachmentId);
    activePptPreviews.delete(attachmentId);
    fs.rmSync(path.dirname(attachmentPath), { recursive: true, force: true });
    deletedPptAttachments.add(attachmentId);
    return { status: 'ok', attachmentId };
  });

  ipcMain.handle('ppt-feedback:save-annotation', async (_event, annotation) => {
    const normalized = validatePptAnnotation(annotation);
    if (deletedPptAttachments.has(normalized.attachmentId)) {
      throw createPptFeedbackError('INVALID_ATTACHMENT_ID', '附件不存在。');
    }
    const annotations = readPptAnnotations(normalized.taskId);
    const index = annotations.findIndex(item => item.id === normalized.id);
    if (index === -1) annotations.push(normalized);
    else annotations[index] = normalized;
    savePptAnnotations(normalized.taskId, annotations);
    return { status: 'ok', annotation: normalized };
  });
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
    || resultUrl.protocol !== 'https:' || resultUrl.port || !SOCIAL_RESULT_DOMAINS[platform].has(hostname)) {
    throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  }

  const isDomesticContent = ['xiaohongshu', 'bilibili', 'weibo', 'zhihu'].includes(platform)
    ? Boolean(parseSocialContentUrl(platform, payload.url))
    : isLegacySocialContentUrl(platform, resultUrl);
  if (!isDomesticContent) throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
}

function isLegacySocialContentUrl(platform, url) {
  if (platform === 'reddit') {
    return /^\/r\/[A-Za-z0-9_]+\/comments\/[A-Za-z0-9]+(?:\/|$)/.test(url.pathname);
  }
  if (platform === 'youtube') {
    const contentId = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]+)\/?$/)?.[1]
      || (url.pathname === '/watch' ? url.searchParams.get('v') : '');
    return /^[A-Za-z0-9_-]+$/.test(contentId || '');
  }
  return false;
}

function validateSocialPayload(payload, allowedKeys) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some(key => !allowedKeys.includes(key))) {
    throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  }
}

function socialError(error) {
  const code = new Set(['UNSUPPORTED_PLATFORM', 'INVALID_REQUEST', 'NOT_CONFIGURED', 'UNSUPPORTED_CAPABILITY', 'SESSION_NOT_FOUND', 'SESSION_CLOSED', 'SESSION_BUSY', 'NAVIGATION_TIMEOUT', 'SCRIPT_TIMEOUT', 'BUDGET_EXCEEDED', 'UNSUPPORTED_PAGE', 'PAGE_NOT_READY', 'PAGE_READ_FAILED', 'NAVIGATION_FAILED', 'LOGIN_REQUIRED', 'MANUAL_VERIFICATION_REQUIRED', 'AUTH_FAILED', 'RATE_LIMITED', 'UPSTREAM_ERROR', 'TIMEOUT', 'INVALID_RESPONSE', 'EMPTY_RESULTS', 'REQUEST_FAILED', 'ATTACHMENT_ERROR', ...Object.values(SOCIAL_API_CODES)]).has(error?.code)
    ? error.code : 'REQUEST_FAILED';
  const messages = {
    UNSUPPORTED_PLATFORM: '不支持该平台。', INVALID_REQUEST: '请求参数无效。', NOT_CONFIGURED: '该平台 API 尚未安全配置。',
    UNSUPPORTED_CAPABILITY: '该平台暂不支持此 API 能力。', SESSION_NOT_FOUND: '尚未打开该平台浏览器。',
    SESSION_CLOSED: '平台浏览器已关闭。', SESSION_BUSY: '该平台浏览器正在执行其他操作。',
    NAVIGATION_TIMEOUT: '平台页面加载超时；浏览器已关闭，请重新检查连接。',
    SCRIPT_TIMEOUT: '平台页面读取超时；浏览器已关闭，请重新检查连接。',
    BUDGET_EXCEEDED: '研究任务已达到 maxDurationMs。',
    UNSUPPORTED_PAGE: '平台页面结构暂不支持。', PAGE_NOT_READY: '平台搜索结果在等待时间内未就绪。',
    LOGIN_REQUIRED: '该平台要求登录后才能继续搜索。', MANUAL_VERIFICATION_REQUIRED: '该平台要求人工完成安全验证。',
    PAGE_READ_FAILED: '无法读取平台页面。', NAVIGATION_FAILED: '平台页面导航失败。', AUTH_FAILED: '平台 API 凭证无效或已过期。',
    RATE_LIMITED: '平台 API 暂时限流。', UPSTREAM_ERROR: '平台 API 暂时不可用。', TIMEOUT: '平台 API 请求超时。',
    INVALID_RESPONSE: '平台 API 返回了无法识别的数据。', EMPTY_RESULTS: '平台 API 未返回可用结果。',
    ATTACHMENT_ERROR: '附件操作失败。', REQUEST_FAILED: '社媒请求失败。',
    [SOCIAL_API_CODES.NOT_CONFIGURED]: '该平台 API 尚未安全配置。',
    [SOCIAL_API_CODES.UNSUPPORTED_PLATFORM]: '不支持该平台。',
    [SOCIAL_API_CODES.UNSUPPORTED_CAPABILITY]: '该平台暂不支持此 API 能力。',
    [SOCIAL_API_CODES.AUTH_FAILED]: '平台 API 凭证无效或已过期。',
    [SOCIAL_API_CODES.RATE_LIMITED]: '平台 API 暂时限流。',
    [SOCIAL_API_CODES.UPSTREAM_ERROR]: '平台 API 暂时不可用。',
    [SOCIAL_API_CODES.TIMEOUT]: '平台 API 请求超时。',
    [SOCIAL_API_CODES.INVALID_RESPONSE]: '平台 API 返回了无法识别的数据。',
    [SOCIAL_API_CODES.EMPTY_RESULTS]: '平台 API 未返回可用结果。',
    [SOCIAL_API_CODES.PLATFORM_MISMATCH]: '平台 API 返回了不匹配的平台结果。',
    [SOCIAL_API_CODES.REQUEST_FAILED]: '社媒 API 请求失败。'
  };
  return { status: 'error', code, message: messages[code] };
}

function attachSocialProfile(platform, profileId) {
  socialProfiles.set(`${platform}:${profileId}`, { platform, profileId });
  getSocialAdapter(platform, profileId);
}

async function browserSocialSearch(platform, profileId, payload) {
  validateSocialProfileId(profileId);
  return getSocialAdapter(platform, profileId).search(payload.query, {
    maxResults: payload.maxResults, timeoutMs: payload.timeoutMs
  });
}

async function runSocialSearch(platform, payload) {
  validateSocialPlatform(platform);
  validateSocialPayload(payload, ['query', 'profileId', 'mode', 'maxResults', 'timeoutMs']);
  const query = typeof payload.query === 'string' ? payload.query.trim() : '';
  if (!query || query.length > 500) throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  const mode = payload.mode || 'auto';
  if (!SOCIAL_MODES.has(mode)) throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  const maxResults = payload.maxResults == null ? 5 : payload.maxResults;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  const timeoutMs = payload.timeoutMs;
  if (timeoutMs != null && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000)) {
    throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
  }
  validateSocialProfileId(payload.profileId);
  const normalized = { query, profileId: payload.profileId, maxResults, ...(timeoutMs == null ? {} : { timeoutMs }) };

  if (mode !== 'browser' && platform !== 'xiaohongshu') {
    const settings = getSettingsStore();
    const config = typeof settings.getSocialApiConfig === 'function' ? settings.getSocialApiConfig(platform) : null;
    const client = createSocialApiClient({ platform, config: config || {} });
    if (client.configured) {
      const apiResult = await client.search(query, { maxResults, timeoutMs });
      if (!Array.isArray(apiResult) && apiResult?.code === SOCIAL_API_CODES.EMPTY_RESULTS) {
        return { status: 'ok', platform, retrievalMethod: 'api', results: [] };
      }
      if (Array.isArray(apiResult)) {
        return { status: 'ok', platform, retrievalMethod: 'api', results: apiResult };
      }
      return socialError(apiResult);
    } else if (mode === 'api') {
      return socialError(Object.assign(new Error(), { code: 'NOT_CONFIGURED' }));
    }
  } else if (mode === 'api') {
    return socialError(Object.assign(new Error(), { code: 'UNSUPPORTED_CAPABILITY' }));
  }
  return browserSocialSearch(platform, payload.profileId, normalized);
}

function registerSocialHandlers() {
  getSocialSourceManager().registerIpcHandlers(ipcMain);
  ipcMain.handle('social:list-platforms', async () => listSocialPlatformDefinitions().map(definition => {
    const browserSearchRegistered = isRegisteredSearchAdapter(definition.platform);
    return {
      ...definition,
      browserSearchRegistered,
      browserAvailable: browserSearchRegistered || definition.apiAvailable === true,
      supportsSearch: definition.apiAvailable === true ? definition.supportsSearch === true : browserSearchRegistered,
      searchVerified: definition.searchVerified === true,
      browserSearchStatus: browserSearchRegistered
        ? (definition.searchVerified === true ? 'verified' : 'pending-live-test')
        : 'unavailable'
    };
  }));
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
      return { ...opened, status: 'ok', browserStatus: opened.status };
    } catch (error) { return socialError(error); }
  });
  ipcMain.handle('social:check', async (_event, platform, profileInput) => {
    try {
      let profileId = profileInput;
      let timeoutMs;
      if (profileInput && typeof profileInput === 'object' && !Array.isArray(profileInput)) {
        validateSocialPayload(profileInput, ['profileId', 'timeoutMs']);
        profileId = profileInput.profileId;
        timeoutMs = profileInput.timeoutMs;
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) {
          throw Object.assign(new TypeError(), { code: 'INVALID_REQUEST' });
        }
      }
      validateSocialPlatform(platform); validateSocialProfileId(profileId);
      if (!socialProfiles.has(`${platform}:${profileId}`)) return { status: 'not-ready', platform, profileId };
      return await getSocialAdapter(platform, profileId).checkReady({ timeoutMs });
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
  const archiveRequest = content && typeof content === 'object' && !Array.isArray(content)
    && content.format === 'workspace-archive';
  if (archiveRequest && (Object.keys(content).some(key => !['format', 'content', 'attachmentIds'].includes(key))
    || typeof content.content !== 'string' || !Array.isArray(content.attachmentIds))) {
    throw Object.assign(new TypeError('工作区 ZIP 备份请求无效'), { code: 'BACKUP_EXPORT_INVALID_REQUEST' });
  }
  const result = await showFileDialog('showSaveDialog', {
    title: '导出备份',
    defaultPath: path.join(app.getPath('documents'), archiveRequest ? 'forward-step-workspace.zip' : 'forward-step-backup.json'),
    filters: archiveRequest
      ? [{ name: '完整工作区 ZIP', extensions: ['zip'] }]
      : [{ name: 'JSON 备份', extensions: ['json'] }],
    showOverwriteConfirmation: true
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  if (!archiveRequest) {
    writeBackupFileAtomically(result.filePath, serializeBackupContent(content));
    return { canceled: false, filePath: result.filePath, format: 'json' };
  }
  if (path.extname(result.filePath).toLowerCase() !== '.zip') {
    throw Object.assign(new TypeError('完整工作区备份必须导出为 ZIP 文件'), { code: 'BACKUP_EXPORT_INVALID_EXTENSION' });
  }
  let backup;
  try { backup = JSON.parse(content.content); } catch (error) {
    throw Object.assign(new TypeError('工作区 JSON 内容无效', { cause: error }), { code: 'BACKUP_EXPORT_INVALID_JSON' });
  }
  if (backup?.scope !== 'workspace' || backup?.format !== 'forward-step-workspace') {
    throw Object.assign(new TypeError('完整工作区备份需要工作区 JSON'), { code: 'BACKUP_EXPORT_INVALID_JSON' });
  }
  const attachments = content.attachmentIds.map(id => {
    if (typeof id !== 'string') throw Object.assign(new TypeError('附件 ID 无效'), { code: 'BACKUP_EXPORT_INVALID_ATTACHMENT' });
    const metadata = backup.data?.researchAttachments?.find(item => item?.id === id);
    const match = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})_([a-f0-9]{32})\.(txt|pdf|png|jpg|webp)$/.exec(id);
    if (!metadata || !match) throw Object.assign(new TypeError('附件索引无效'), { code: 'BACKUP_EXPORT_INVALID_ATTACHMENT' });
    return {
      id, taskId: match[1], type: metadata.type, size: metadata.size,
      openStream: () => getSocialAttachmentStore().createReadStream(id)
    };
  });
  const tempPath = result.filePath + `.tmp-${process.pid}-${Date.now()}`;
  try {
    const output = fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });
    await workspaceArchive.exportWorkspaceArchive({ output, workspace: backup, attachments });
    fs.renameSync(tempPath, result.filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
    throw Object.assign(new Error('完整工作区 ZIP 导出失败'), { code: error.code || 'BACKUP_EXPORT_FAILED', cause: error });
  }
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('backup:import', async () => {
  const result = await showFileDialog('showOpenDialog', {
    title: '导入备份',
    properties: ['openFile'],
    filters: [{ name: '完整工作区 ZIP 或 JSON 备份', extensions: ['zip', 'json'] }]
  });
  const filePath = result.filePaths?.[0];
  if (result.canceled || !filePath) return { canceled: true };
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.zip') {
    const stageId = randomUUID();
    const stageDirectory = path.join(app.getPath('userData'), 'workspace-backup-import-staging', stageId);
    fs.mkdirSync(stageDirectory, { recursive: true, mode: 0o700 });
    try {
      const archive = await workspaceArchive.importWorkspaceArchive({ archivePath: filePath, tempDirectory: stageDirectory });
      backupImportStages.set(stageId, { stageDirectory, archive });
      return {
        canceled: false, format: 'workspace-archive', stageId,
        content: JSON.stringify(archive.workspace),
        attachments: archive.attachments.map(({ id, taskId, type, size, sha256 }) => ({ id, taskId, type, size, sha256 }))
      };
    } catch (error) {
      fs.rmSync(stageDirectory, { recursive: true, force: true });
      throw Object.assign(new Error('工作区 ZIP 校验失败'), { code: error.code || 'BACKUP_IMPORT_INVALID_ARCHIVE', cause: error });
    }
  }
  if (extension !== '.json') {
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

ipcMain.handle('backup:commit-import', async (_event, payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some(key => !['stageId', 'attachmentIds', 'targetAttachmentIds'].includes(key))
    || typeof payload.stageId !== 'string' || !Array.isArray(payload.attachmentIds)
    || payload.attachmentIds.some(id => typeof id !== 'string')
    || payload.targetAttachmentIds !== undefined && (!Array.isArray(payload.targetAttachmentIds)
      || payload.targetAttachmentIds.some(id => typeof id !== 'string'))) {
    throw Object.assign(new TypeError('工作区导入提交请求无效'), { code: 'BACKUP_IMPORT_INVALID_REQUEST' });
  }
  const stage = backupImportStages.get(payload.stageId);
  if (!stage) throw Object.assign(new Error('工作区 ZIP 暂存已失效，请重新选择文件'), { code: 'BACKUP_IMPORT_STAGE_EXPIRED' });
  const selected = payload.attachmentIds;
  if (new Set(selected).size !== selected.length) {
    throw Object.assign(new TypeError('工作区附件导入清单重复'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
  }
  const targetIds = payload.targetAttachmentIds || selected;
  if (targetIds.length !== selected.length || new Set(targetIds).size !== targetIds.length) {
    throw Object.assign(new TypeError('工作区附件目标 ID 清单无效'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
  }
  const descriptors = new Map(stage.archive.attachments.map(item => [item.id, item]));
  if (selected.some(id => !descriptors.has(id))) throw Object.assign(new TypeError('导入附件不在已校验清单中'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
  const store = getSocialAttachmentStore();
  for (const [index, sourceId] of selected.entries()) {
    const item = descriptors.get(sourceId);
    const targetId = targetIds[index];
    const prefix = `${item.taskId}_`;
    const targetSuffix = targetId.startsWith(prefix) ? targetId.slice(prefix.length) : '';
    if (!/^[a-f0-9]{32}\.(txt|pdf|png|jpg|webp)$/.test(targetSuffix)) {
      throw Object.assign(new TypeError('工作区附件目标 ID 与所属任务不匹配'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
    }
    if (store.has(targetId)) throw Object.assign(new Error('目标设备已存在相同附件 ID；请先处理冲突再导入'), { code: 'BACKUP_IMPORT_ATTACHMENT_CONFLICT' });
  }
  const transactionId = randomUUID();
  const transactionRoot = path.join(app.getPath('userData'), 'workspace-backup-transactions');
  fs.mkdirSync(transactionRoot, { recursive: true, mode: 0o700 });
  const journalPath = path.join(transactionRoot, `${transactionId}.json`);
  const ids = targetIds;
  const journal = { version: 1, transactionId, stageId: payload.stageId, stageDirectory: stage.stageDirectory, attachmentIds: ids };
  writeBackupFileAtomically(journalPath, JSON.stringify(journal));
  backupImportTransactions.set(transactionId, { journalPath, journal });
  try {
    for (const [index, sourceId] of selected.entries()) {
      const item = descriptors.get(sourceId);
      await store.importFile({ id: targetIds[index], type: item.type, size: item.size, sha256: item.sha256, sourcePath: item.path });
    }
    return { status: 'ok', transactionId };
  } catch (error) {
    for (const id of ids) { if (store.has(id)) store.delete(id); }
    fs.rmSync(journalPath, { force: true });
    throw Object.assign(new Error('工作区附件安装失败，已回滚导入文件'), { code: error.code || 'BACKUP_IMPORT_COMMIT_FAILED', cause: error });
  }
});

ipcMain.handle('backup:discard-import', async (_event, stageId) => {
  if (typeof stageId !== 'string') throw Object.assign(new TypeError('工作区暂存 ID 无效'), { code: 'BACKUP_IMPORT_INVALID_REQUEST' });
  const stage = backupImportStages.get(stageId);
  if (!stage) return { status: 'ok', discarded: false };
  fs.rmSync(stage.stageDirectory, { recursive: true, force: true });
  backupImportStages.delete(stageId);
  return { status: 'ok', discarded: true };
});

ipcMain.handle('backup:finalize-import', async (_event, transactionId) => {
  const transaction = backupImportTransactions.get(transactionId);
  if (!transaction) return { status: 'ok', finalized: false };
  fs.rmSync(transaction.journalPath, { force: true });
  const stage = backupImportStages.get(transaction.journal.stageId);
  if (stage) fs.rmSync(stage.stageDirectory, { recursive: true, force: true });
  backupImportStages.delete(transaction.journal.stageId);
  backupImportTransactions.delete(transactionId);
  return { status: 'ok', finalized: true };
});

ipcMain.handle('backup:rollback-import', async (_event, transactionId) => {
  const transaction = backupImportTransactions.get(transactionId);
  if (!transaction) return { status: 'ok', rolledBack: false };
  const store = getSocialAttachmentStore();
  for (const id of transaction.journal.attachmentIds) { if (store.has(id)) store.delete(id); }
  fs.rmSync(transaction.journalPath, { force: true });
  const stage = backupImportStages.get(transaction.journal.stageId);
  if (stage) fs.rmSync(stage.stageDirectory, { recursive: true, force: true });
  backupImportStages.delete(transaction.journal.stageId);
  backupImportTransactions.delete(transactionId);
  return { status: 'ok', rolledBack: true };
});

ipcMain.handle('backup:recover-imports', async (_event, attachmentIds) => {
  if (!Array.isArray(attachmentIds) || attachmentIds.some(id => typeof id !== 'string')) {
    throw Object.assign(new TypeError('附件引用列表无效'), { code: 'BACKUP_IMPORT_INVALID_REQUEST' });
  }
  const transactionRoot = path.join(app.getPath('userData'), 'workspace-backup-transactions');
  const references = new Set(attachmentIds);
  const store = getSocialAttachmentStore();
  let recovered = 0;
  if (fs.existsSync(transactionRoot)) {
    for (const filename of fs.readdirSync(transactionRoot).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
      const journalPath = path.join(transactionRoot, filename);
      let journal;
      try { journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')); } catch { fs.rmSync(journalPath, { force: true }); continue; }
      if (journal?.version !== 1 || !Array.isArray(journal.attachmentIds)
        || journal.attachmentIds.some(id => typeof id !== 'string')) { fs.rmSync(journalPath, { force: true }); continue; }
      const committed = journal.attachmentIds.every(id => references.has(id));
      if (!committed) for (const id of journal.attachmentIds) { if (store.has(id)) store.delete(id); }
      if (typeof journal.stageDirectory === 'string') {
        const expectedRoot = path.resolve(app.getPath('userData'), 'workspace-backup-import-staging');
        const resolved = path.resolve(journal.stageDirectory);
        const relative = path.relative(expectedRoot, resolved);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) fs.rmSync(resolved, { recursive: true, force: true });
      }
      fs.rmSync(journalPath, { force: true });
      recovered += 1;
    }
  }

  const stagingRoot = path.join(app.getPath('userData'), 'workspace-backup-import-staging');
  if (fs.existsSync(stagingRoot)) {
    const rootStats = fs.lstatSync(stagingRoot);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw Object.assign(new Error('工作区导入暂存目录不安全，未执行清理'), { code: 'BACKUP_IMPORT_UNSAFE_STAGING' });
    }
    const protectedStageIds = new Set([
      ...backupImportStages.keys(),
      ...[...backupImportTransactions.values()].map(item => item.journal.stageId)
    ]);
    const root = fs.realpathSync(stagingRoot);
    for (const stageId of fs.readdirSync(root)) {
      if (!/^[a-f0-9-]{36}$/.test(stageId) || protectedStageIds.has(stageId)) continue;
      const stageDirectory = path.join(root, stageId);
      const stats = fs.lstatSync(stageDirectory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) continue;
      const resolved = fs.realpathSync(stageDirectory);
      const relative = path.relative(root, resolved);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    }
  }
  return { status: 'ok', recovered };
});

ipcMain.handle('backup:list', async () => getBackupStore().listBackups());

ipcMain.handle('backup:read', async (_event, filename) => getBackupStore().readBackup(filename));

registerSocialHandlers();
registerPptFeedbackHandlers();
registerPptFeedbackHandlers();
registerPptFeedbackHandlers();
registerPptFeedbackHandlers();
createPromptAgentSources({ fs, path, userDataPath: app.getPath('userData'), dialog, ipcMain });
createPptSourceReader({ fs, path, dialog, ipcMain });

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
  if (shuttingDown) return;
  if (!bundledService && !socialSourceManager) return;
  event.preventDefault();
  shuttingDown = true;

  const forceCloseTimer = setTimeout(() => {
    bundledService?.closeAllConnections?.();
    app.quit();
  }, SERVER_SHUTDOWN_TIMEOUT_MS);
  const cleanup = [socialSourceManager?.stopAll() || Promise.resolve()];
  if (bundledService) {
    cleanup.push(new Promise(resolve => {
      try {
        bundledService.close(resolve);
      } catch {
        bundledService.closeAllConnections?.();
        resolve();
      }
    }));
  }
  Promise.allSettled(cleanup).finally(() => {
    clearTimeout(forceCloseTimer);
    app.quit();
  });
});
