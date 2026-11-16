const { app, BrowserWindow, WebContentsView, dialog, ipcMain, safeStorage, session, shell } = require('electron');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createBackupStore } = require(path.join(__dirname, 'backup-store.js'));
const { createSettingsStore } = require(path.join(__dirname, 'settings-store.js'));
const { createModelClient } = require(path.join(__dirname, '..', 'server', 'model-client.js'));
const { createWritingAssistantClient } = require(path.join(__dirname, '..', 'server', 'writing-assistant-client.js'));
const { createWritingResourceRunner } = require(path.join(__dirname, '..', 'server', 'writing-resource-runner.js'));
const { getBuiltinWritingPacks } = require(path.join(__dirname, '..', 'prototype', 'writing-pack-catalog.js'));
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
const workbenchMaterialExport = require(path.join(__dirname, 'workbench-material-export.js'));
const workbenchSchema = require(path.join(__dirname, '..', 'prototype', 'unified-workbench-schema.js'));
const workspaceBackup = require(path.join(__dirname, '..', 'prototype', 'workspace-backup.js'));
const { createPptPreviewManager } = require(path.join(__dirname, 'ppt-preview-manager.js'));
const { readSavedPort, savePort, selectWorkspacePort } = require(path.join(__dirname, 'workspace-origin.js'));

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
let promptAgentSources;
const activePptPreviews = new Set();
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

function workbenchManifestSignature(manifest) {
  const normalized = {
    schemaVersion: workbenchSchema.WORKBENCH_SCHEMA_VERSION,
    taskId: manifest.taskId,
    revision: manifest.revision,
    project: workbenchSchema.normalizeWorkbenchProject(manifest.project)
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function removeImportedWorkbenchManifests(store, entries = []) {
  for (const entry of entries) {
    const current = store.readTaskManifest(entry.taskId);
    if (current && workbenchManifestSignature(current) === entry.sha256) store.deleteTaskManifest(entry.taskId);
  }
}

function getPptPreviewManager() {
  if (!pptPreviewManager) {
    pptPreviewManager = createPptPreviewManager({
      BrowserWindow,
      WebContentsView,
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

function validatePptFeedbackTaskAttachmentRequest(request) {
  validatePptFeedbackRequest(request, ['taskId', 'attachmentId']);
  return {
    taskId: validatePptFeedbackId(request.taskId, 'INVALID_TASK_ID', '任务标识'),
    attachmentId: validatePptFeedbackId(request.attachmentId, 'INVALID_ATTACHMENT_ID', '附件标识')
  };
}

function validatePptAnnotationSource(source) {
  if (source === undefined) return undefined;
  validatePptFeedbackRequest(source, ['url', 'fetchedAt', 'contentHash']);
  if (typeof source.url !== 'string' || source.url.length > 2048 || typeof source.fetchedAt !== 'string' || source.fetchedAt.length > 80
    || !Number.isFinite(Date.parse(source.fetchedAt)) || typeof source.contentHash !== 'string'
    || !/^sha256:[a-f0-9]{64}$/i.test(source.contentHash)) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '网页来源版本信息无效。');
  }
  let url;
  try {
    url = new URL(source.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid URL');
    url.search = '';
    url.hash = '';
  } catch {
    throw createPptFeedbackError('INVALID_ANNOTATION', '网页来源网址无效。');
  }
  return { url: url.href, fetchedAt: source.fetchedAt, contentHash: source.contentHash };
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
    validatePptFeedbackRequest(target, ['kind', 'selector', 'excerpt', 'source']);
    if (typeof target.selector !== 'string' || !target.selector.trim() || target.selector.length > 500) {
      throw createPptFeedbackError('INVALID_ANNOTATION', 'HTML selector 无效。');
    }
    if (target.excerpt !== undefined && (typeof target.excerpt !== 'string' || target.excerpt.length > 500)) {
      throw createPptFeedbackError('INVALID_ANNOTATION', 'HTML 摘录无效。');
    }
    const source = validatePptAnnotationSource(target.source);
    return { kind: 'element', selector: target.selector.trim(), excerpt: (target.excerpt || '').trim(), ...(source ? { source } : {}) };
  }
  if (target.kind === 'text') {
    validatePptFeedbackRequest(target, ['kind', 'selector', 'exact', 'prefix', 'suffix', 'start', 'end', 'source']);
    if (typeof target.selector !== 'string' || !target.selector.trim() || target.selector.length > 500
      || typeof target.exact !== 'string' || !target.exact.trim() || target.exact.length > 2000
      || target.prefix !== undefined && (typeof target.prefix !== 'string' || target.prefix.length > 120)
      || target.suffix !== undefined && (typeof target.suffix !== 'string' || target.suffix.length > 120)) {
      throw createPptFeedbackError('INVALID_ANNOTATION', '文字选区锚点无效。');
    }
    const exact = target.exact.trim();
    const hasPosition = target.start !== undefined || target.end !== undefined;
    if (hasPosition && (!Number.isSafeInteger(target.start) || !Number.isSafeInteger(target.end)
      || target.start < 0 || target.end <= target.start || target.end - target.start !== Array.from(exact).length)) {
      throw createPptFeedbackError('INVALID_ANNOTATION', '文字选区位置无效。');
    }
    const source = validatePptAnnotationSource(target.source);
    return {
      kind: 'text', selector: target.selector.trim(), exact,
      prefix: target.prefix || '', suffix: target.suffix || '',
      ...(hasPosition ? { start: target.start, end: target.end } : {}), ...(source ? { source } : {})
    };
  }
  if (target.kind === 'point') {
    validatePptFeedbackRequest(target, ['kind', 'x', 'y']);
    return { kind: 'point', x: finiteCoordinate(target.x, '横坐标'), y: finiteCoordinate(target.y, '纵坐标') };
  }
  if (target.kind === 'arrow') {
    validatePptFeedbackRequest(target, ['kind', 'x1', 'y1', 'x2', 'y2']);
    const x1 = finiteCoordinate(target.x1, '起点横坐标');
    const y1 = finiteCoordinate(target.y1, '起点纵坐标');
    const x2 = finiteCoordinate(target.x2, '终点横坐标');
    const y2 = finiteCoordinate(target.y2, '终点纵坐标');
    if (Math.hypot(x2 - x1, y2 - y1) < 0.005) throw createPptFeedbackError('INVALID_ANNOTATION', '箭头长度无效。');
    return { kind: 'arrow', x1, y1, x2, y2 };
  }
  if (target.kind === 'path') {
    validatePptFeedbackRequest(target, ['kind', 'points']);
    if (!Array.isArray(target.points) || target.points.length < 2 || target.points.length > 128) {
      throw createPptFeedbackError('INVALID_ANNOTATION', '笔迹点数无效。');
    }
    const points = target.points.map(point => {
      validatePptFeedbackRequest(point, ['x', 'y']);
      return { x: finiteCoordinate(point.x, '横坐标'), y: finiteCoordinate(point.y, '纵坐标') };
    });
    if (points.every(point => point.x === points[0].x && point.y === points[0].y)) throw createPptFeedbackError('INVALID_ANNOTATION', '笔迹长度无效。');
    return { kind: 'path', points };
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
    'comment', 'category', 'intent', 'createdAt', 'updatedAt', 'status', 'selected', 'reassociatedFromId'
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
  const intent = annotation.intent === undefined ? 'modify' : annotation.intent;
  if (!['modify', 'add', 'remove', 'keep', 'question', 'verify'].includes(intent)) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注意图无效。');
  }
  const pageIndex = annotation.pageIndex === undefined ? 0 : annotation.pageIndex;
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注页码无效。');
  }
  const status = annotation.status === undefined ? 'active' : annotation.status;
  if (!['active', 'stale', 'deleted'].includes(status)) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注状态无效。');
  }
  if (annotation.createdAt !== undefined && (typeof annotation.createdAt !== 'string' || annotation.createdAt.length > 80)) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注时间无效。');
  }
  if (annotation.updatedAt !== undefined && (typeof annotation.updatedAt !== 'string' || annotation.updatedAt.length > 80)) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注更新时间无效。');
  }
  if (annotation.selected !== undefined && typeof annotation.selected !== 'boolean') {
    throw createPptFeedbackError('INVALID_ANNOTATION', '标注选择状态无效。');
  }
  if (status === 'deleted' && annotation.selected === true) {
    throw createPptFeedbackError('INVALID_ANNOTATION', '已撤销标注不能被选入提示词。');
  }
  const target = validatePptAnnotationTarget(annotation.target);
  const id = annotation.id || crypto.randomUUID();
  const reassociatedFromId = annotation.reassociatedFromId === undefined
    ? '' : validatePptFeedbackId(annotation.reassociatedFromId, 'INVALID_ANNOTATION', '来源批注标识');
  if (reassociatedFromId && reassociatedFromId === id) throw createPptFeedbackError('INVALID_ANNOTATION', '批注不能重新关联到自身。');
  const createdAt = annotation.createdAt || new Date().toISOString();
  const updatedAt = annotation.updatedAt || createdAt;
  return { id, taskId, attachmentId, contentHash: annotation.contentHash.trim(), pageIndex, target, comment, category, intent, createdAt, updatedAt, status, selected: annotation.selected === true, ...(reassociatedFromId ? { reassociatedFromId } : {}) };
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
  ipcMain.handle('workbench:list-manifests', async () => getPptFeedbackAttachmentStore().listTaskManifests());
  ipcMain.handle('workbench:read-manifest', async (_event, request) => {
    validatePptFeedbackRequest(request, ['taskId']);
    const taskId = validatePptFeedbackId(request.taskId, 'INVALID_WORKBENCH_TASK_ID', '任务标识');
    return { status: 'ok', manifest: getPptFeedbackAttachmentStore().readTaskManifest(taskId) };
  });
  ipcMain.handle('workbench:save-manifest', async (_event, request) => {
    validatePptFeedbackRequest(request, ['taskId', 'manifest']);
    const taskId = validatePptFeedbackId(request.taskId, 'INVALID_WORKBENCH_TASK_ID', '任务标识');
    const revision = getPptFeedbackAttachmentStore().saveTaskManifest(taskId, request.manifest);
    return { status: 'ok', revision };
  });
  ipcMain.handle('workbench:open-task-folder', async (_event, request) => {
    validatePptFeedbackRequest(request, ['taskId']);
    const taskId = validatePptFeedbackId(request.taskId, 'INVALID_WORKBENCH_TASK_ID', '任务标识');
    const message = await shell.openPath(getPptFeedbackAttachmentStore().getTaskDirectory(taskId));
    if (message) throw createPptFeedbackError('WORKBENCH_FOLDER_OPEN_FAILED', message);
    return { status: 'ok' };
  });
  ipcMain.handle('workbench:export-materials', async (_event, request) => {
    validatePptFeedbackRequest(request, ['taskId', 'roundId', 'deliveryId']);
    const taskId = validatePptFeedbackId(request.taskId, 'INVALID_WORKBENCH_TASK_ID', '任务标识');
    const roundId = validatePptFeedbackId(request.roundId, 'INVALID_WORKBENCH_ROUND_ID', '提示词轮次标识');
    const deliveryId = validatePptFeedbackId(request.deliveryId, 'INVALID_WORKBENCH_DELIVERY_ID', '提示词交付标识');
    const store = getPptFeedbackAttachmentStore();
    const manifest = store.readTaskManifest(taskId);
    if (!manifest) throw createPptFeedbackError('WORKBENCH_EXPORT_INVALID_SNAPSHOT', '找不到已保存的工作台任务清单');
    const snapshot = workbenchMaterialExport.preparePackage({ taskId, manifest, roundId, deliveryId, attachmentStore: store });
    if (snapshot.scopeWarnings.length) {
      const confirmationOptions = {
        type: 'warning', title: '素材包包含完整原件',
        message: '部分素材无法生成所选页面或区域图，继续将附带完整原件。',
        detail: `${snapshot.scopeWarnings.map(item => `${item.title}：${item.scopeNote}`).join('\n')}\n取消后可返回工作台排除这些素材，再重新导出。`,
        buttons: ['继续并附带完整原件', '取消并返回排除素材'], defaultId: 1, cancelId: 1
      };
      const confirmation = mainWindow
        ? await dialog.showMessageBox(mainWindow, confirmationOptions)
        : await dialog.showMessageBox(confirmationOptions);
      if (confirmation.response !== 0) return { canceled: true, reason: 'full-original-scope' };
    }
    const result = await showFileDialog('showSaveDialog', {
      title: '导出本轮素材包',
      defaultPath: path.join(app.getPath('documents'), `workbench-materials-${taskId}.zip`),
      filters: [{ name: '工作台本轮素材包', extensions: ['zip'] }],
      showOverwriteConfirmation: true
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    if (path.extname(result.filePath).toLowerCase() !== '.zip') {
      throw createPptFeedbackError('WORKBENCH_EXPORT_INVALID_EXTENSION', '本轮素材包必须导出为 ZIP 文件');
    }
    const tempPath = `${result.filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      const summary = await workbenchMaterialExport.writeWorkbenchMaterialArchive({
        outputPath: tempPath, taskId, manifest, roundId, deliveryId, attachmentStore: store
      });
      fs.renameSync(tempPath, result.filePath);
      return { status: 'ok', canceled: false, filePath: result.filePath, summary };
    } catch (error) {
      try { fs.unlinkSync(tempPath); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
      const wrapped = createPptFeedbackError(error.code || 'WORKBENCH_EXPORT_FAILED', error.message || '本轮素材包导出失败');
      wrapped.cause = error;
      throw wrapped;
    }
  });

  ipcMain.on('ppt-feedback:preview-target', (event, value) => {
    if (!event.sender?.mainFrame || event.senderFrame !== event.sender.mainFrame) return;
    const selection = pptPreviewManager?.acceptSelection(event, value);
    if (!selection || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('ppt-feedback:preview-target', selection);
  });
  ipcMain.on('ppt-feedback:set-preview-bounds', (event, request) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !event.sender?.mainFrame || event.senderFrame !== event.sender.mainFrame) return;
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || Object.keys(request).some(key => !['attachmentId', 'bounds'].includes(key))
      || typeof request.attachmentId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(request.attachmentId)) return;
    pptPreviewManager?.setPreviewBounds(request.attachmentId, request.bounds);
  });

  ipcMain.handle('ppt-feedback:choose-file', async (_event, request) => {
    const taskId = validatePptFeedbackTaskRequest(request);
    const result = await showFileDialog('showOpenDialog', {
      title: '选择工作台资料',
      properties: ['openFile'],
      filters: [
        { name: '可预览的网页、PDF、Office、文稿与图片', extensions: ['html', 'htm', 'pdf', 'pptx', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'] },
        { name: '旧版 Office 文件（预览暂不可用）', extensions: ['ppt', 'doc'] }
      ]
    });
    const sourcePath = result.filePaths?.[0];
    if (result.canceled || !sourcePath) return { canceled: true };
    const extension = path.extname(sourcePath).toLowerCase();
    if (['.ppt', '.doc'].includes(extension)) {
      return { canceled: false, status: 'unsupported-preview', format: extension.slice(1) };
    }
    const mimeType = {
      '.txt': 'text/plain', '.md': 'text/markdown',
      '.html': 'text/html', '.htm': 'text/html', '.png': 'image/png',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }[extension];
    if (!mimeType) throw createPptFeedbackError('INVALID_ATTACHMENT', '附件格式不受支持。');
    const attachment = await getPptFeedbackAttachmentStore().saveAttachment({ taskId, sourcePath, mimeType });
    return { canceled: false, attachment };
  });

  ipcMain.handle('ppt-feedback:save-image', async (_event, request) => {
    validatePptFeedbackRequest(request, ['taskId', 'bytes', 'mimeType', 'displayName']);
    const taskId = validatePptFeedbackId(request.taskId, 'INVALID_TASK_ID', '任务标识');
    const bytes = request.bytes;
    const isByteArray = ArrayBuffer.isView(bytes) && bytes.BYTES_PER_ELEMENT === 1
      && Object.prototype.toString.call(bytes) === '[object Uint8Array]';
    if (!isByteArray || bytes.byteLength === 0 || typeof request.displayName !== 'string'
      || !request.displayName.trim() || request.displayName.length > 180
      || !['image/png', 'image/jpeg', 'image/webp'].includes(request.mimeType)) {
      throw createPptFeedbackError('INVALID_ATTACHMENT', '图片字节或格式无效。');
    }
    if (bytes.byteLength > 20 * 1024 * 1024) {
      throw createPptFeedbackError('FILE_TOO_LARGE', '图片超过 20 MB 限制。');
    }
    const attachment = await getPptFeedbackAttachmentStore().saveAttachment({
      taskId, bytes, mimeType: request.mimeType, displayName: request.displayName
    });
    return { canceled: false, attachment };
  });

  ipcMain.handle('ppt-feedback:save-web-snapshot', async (_event, request) => {
    validatePptFeedbackRequest(request, ['taskId', 'snapshot']);
    const taskId = validatePptFeedbackId(request.taskId, 'INVALID_TASK_ID', '任务标识');
    const snapshot = request.snapshot;
    validatePptFeedbackRequest(snapshot, ['title', 'finalUrl', 'fetchedAt', 'contentHash', 'html', 'text', 'incomplete']);
    if (typeof snapshot.title !== 'string' || typeof snapshot.finalUrl !== 'string'
      || typeof snapshot.fetchedAt !== 'string' || typeof snapshot.contentHash !== 'string'
      || typeof snapshot.html !== 'string' || Buffer.byteLength(snapshot.html, 'utf8') > 1_048_576
      || typeof snapshot.text !== 'string' || typeof snapshot.incomplete !== 'boolean') {
      throw createPptFeedbackError('INVALID_ATTACHMENT', '网页快照信息不完整。');
    }
    const attachment = await getPptFeedbackAttachmentStore().saveHtmlSnapshot({
      taskId, title: snapshot.title, sourceUrl: snapshot.finalUrl, fetchedAt: snapshot.fetchedAt,
      sourceContentHash: snapshot.contentHash, html: snapshot.html, text: snapshot.text, incomplete: snapshot.incomplete
    });
    return { status: 'ok', attachment };
  });

  ipcMain.handle('ppt-feedback:list-attachments', async (_event, request) => {
    const taskId = validatePptFeedbackTaskRequest(request);
    const attachments = getPptFeedbackAttachmentStore().listAttachments(taskId);
    return { status: 'ok', attachments };
  });

  ipcMain.handle('ppt-feedback:list-deleted-attachments', async (_event, request) => {
    const taskId = validatePptFeedbackTaskRequest(request);
    const attachments = getPptFeedbackAttachmentStore().listDeletedAttachments(taskId);
    return { status: 'ok', attachments };
  });

  ipcMain.handle('ppt-feedback:list-backup-attachments', async (_event, request) => {
    const taskId = validatePptFeedbackTaskRequest(request);
    return { status: 'ok', attachments: getPptFeedbackAttachmentStore().listBackupAttachments(taskId) };
  });

  ipcMain.handle('ppt-feedback:list-annotations', async (_event, request) => {
    const taskId = validatePptFeedbackTaskRequest(request);
    return { status: 'ok', annotations: readPptAnnotations(taskId) };
  });

  ipcMain.handle('ppt-feedback:read-image', async (_event, request) => {
    const attachmentId = validatePptFeedbackAttachmentRequest(request);
    return { status: 'ok', attachmentId, dataUrl: getPptFeedbackAttachmentStore().readImageDataUrl(attachmentId) };
  });

  ipcMain.handle('ppt-feedback:read-pdf', async (_event, request) => {
    const attachmentId = validatePptFeedbackAttachmentRequest(request);
    return { status: 'ok', attachmentId, dataUrl: getPptFeedbackAttachmentStore().readPdfDataUrl(attachmentId) };
  });

  ipcMain.handle('ppt-feedback:read-text', async (_event, request) => {
    const attachmentId = validatePptFeedbackAttachmentRequest(request);
    return { status: 'ok', ...getPptFeedbackAttachmentStore().readText(attachmentId) };
  });

  ipcMain.handle('ppt-feedback:read-office', async (_event, request) => {
    validatePptFeedbackRequest(request, ['attachmentId', 'expectedHash']);
    const attachmentId = validatePptFeedbackId(request.attachmentId, 'INVALID_ATTACHMENT_ID', '附件标识');
    if (typeof request.expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedHash)) {
      throw createPptFeedbackError('INVALID_ANNOTATION', 'Office 资料版本摘要无效。');
    }
    const data = getPptFeedbackAttachmentStore().readOfficeBuffer(attachmentId, request.expectedHash);
    return { status: 'ok', attachmentId, data };
  });

  ipcMain.handle('ppt-feedback:open-preview', async (_event, request) => {
    validatePptFeedbackRequest(request, ['attachmentId', 'target', 'expectedHash', 'embedded']);
    const attachmentId = validatePptFeedbackId(request.attachmentId, 'INVALID_ATTACHMENT_ID', '附件标识');
    if (request.embedded !== undefined && typeof request.embedded !== 'boolean') {
      throw createPptFeedbackError('INVALID_REQUEST', '预览模式参数无效。');
    }
    if (request.expectedHash !== undefined && (typeof request.expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedHash))) {
      throw createPptFeedbackError('INVALID_ANNOTATION', '批注版本摘要无效。');
    }
    if (request.target !== undefined && request.expectedHash === undefined) {
      throw createPptFeedbackError('INVALID_ANNOTATION', '返回批注原处时必须同时校验资料版本。');
    }
    const result = await getPptPreviewManager().openPreview({
      attachmentId, target: request.target, expectedHash: request.expectedHash,
      embedded: request.embedded === true, parentWindow: request.embedded === true ? mainWindow : undefined
    });
    if (result.status === 'opened') activePptPreviews.add(attachmentId);
    return result.status === 'opened'
      ? { status: result.status, attachmentId: result.attachmentId }
      : result;
  });

  ipcMain.handle('ppt-feedback:close-preview', async (_event, request) => {
    const attachmentId = validatePptFeedbackAttachmentRequest(request);
    const closed = pptPreviewManager ? await pptPreviewManager.closePreview(attachmentId) : false;
    activePptPreviews.delete(attachmentId);
    return { status: 'ok', attachmentId, closed };
  });

  ipcMain.handle('ppt-feedback:delete-attachment', async (_event, request) => {
    const { taskId, attachmentId } = validatePptFeedbackTaskAttachmentRequest(request);
    const store = getPptFeedbackAttachmentStore();
    if (store.getAttachment(attachmentId).taskId !== taskId) throw createPptFeedbackError('INVALID_ATTACHMENT_ID', '附件不属于当前任务。');
    if (pptPreviewManager) await pptPreviewManager.closePreview(attachmentId);
    activePptPreviews.delete(attachmentId);
    const attachment = store.deleteAttachment(attachmentId);
    return { status: 'ok', attachment };
  });

  ipcMain.handle('ppt-feedback:restore-attachment', async (_event, request) => {
    const { taskId, attachmentId } = validatePptFeedbackTaskAttachmentRequest(request);
    const store = getPptFeedbackAttachmentStore();
    const deleted = store.listDeletedAttachments(taskId).some(item => item.id === attachmentId);
    if (!deleted) throw createPptFeedbackError('INVALID_ATTACHMENT_ID', '已移除资料不属于当前任务。');
    return { status: 'ok', attachment: store.restoreAttachment(attachmentId) };
  });

  ipcMain.handle('ppt-feedback:save-annotation', async (_event, annotation) => {
    const normalized = validatePptAnnotation(annotation);
    const attachmentStore = getPptFeedbackAttachmentStore();
    const attachment = attachmentStore.getAttachment(normalized.attachmentId);
    if (attachment.taskId !== normalized.taskId || attachment.sha256 !== normalized.contentHash) {
      throw createPptFeedbackError('INVALID_ANNOTATION', '标注与当前任务或附件版本不匹配。');
    }
    const annotations = readPptAnnotations(normalized.taskId);
    if (normalized.reassociatedFromId && !annotations.some(item => item.id === normalized.reassociatedFromId)) {
      throw createPptFeedbackError('INVALID_ANNOTATION', '来源批注不存在或不属于当前任务。');
    }
    const index = annotations.findIndex(item => item.id === normalized.id);
    const existing = index === -1 ? null : annotations[index];
    const saved = {
      ...normalized,
      createdAt: existing?.createdAt || normalized.createdAt,
      updatedAt: existing ? new Date().toISOString() : normalized.updatedAt
    };
    if (index === -1) annotations.push(saved);
    else annotations[index] = saved;
    savePptAnnotations(normalized.taskId, annotations);
    return { status: 'ok', annotation: saved };
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
  const userDataPath = app.getPath('userData');
  const config = getSettingsStore().getServiceConfig();
  const savedPort = readSavedPort(userDataPath);
  const port = await selectWorkspacePort(userDataPath, async legacyPort => {
    let service;
    try {
      service = await startServer({ port: legacyPort, host: '127.0.0.1', config });
    } catch (error) {
      if (error.code === 'EADDRINUSE') throw new Error(`旧工作区端口 ${legacyPort} 已被占用，未连接其他本地服务`);
      throw error;
    }
    try {
      const probeWindow = new BrowserWindow({ show: false, webPreferences: {
        contextIsolation: true, nodeIntegration: false, sandbox: true
      } });
      try {
        await probeWindow.loadURL(`http://127.0.0.1:${legacyPort}/__workspace_probe__`);
        return await probeWindow.webContents.executeJavaScript(
          'localStorage.getItem("forward-step.workspace.v2") || localStorage.getItem("forward-step.workspace.v1")'
        );
      } finally { probeWindow.destroy(); }
    } finally {
      await new Promise((resolve, reject) => service.close(error => error ? reject(error) : resolve()));
    }
  }, async ports => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: '选择旧工作区', message: '找到多个保存内容的旧工作区，请选择要继续使用的一个。',
      buttons: [...ports.map(value => `工作区（端口 ${value}）`), '取消'],
      cancelId: ports.length, defaultId: ports.length
    });
    return ports[result.response];
  });
  try {
    bundledService = await startServer({ port, host: '127.0.0.1', config });
  } catch (error) {
    if (port && error.code === 'EADDRINUSE') throw new Error(`工作区端口 ${port} 已被占用，原有数据未被更改`);
    throw error;
  }
  const address = bundledService.address();
  if (!address || typeof address === 'string') {
    throw new Error('内置本地服务没有返回有效的监听地址');
  }
  localServiceUrl = `http://127.0.0.1:${address.port}`;
  if (savedPort === null) savePort(userDataPath, address.port);
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

ipcMain.handle('writing-assistant:test', async (_event, payload) => {
  if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some(key => !['mode', 'baseUrl', 'modelId', 'apiKey', 'reuseModelConnection'].includes(key)))) {
    return { ok: false, code: 'WRITING_ASSISTANT_INVALID_CONFIG', message: '连接测试只接受辅助服务配置，不接受任务或文件内容。' };
  }
  const config = getSettingsStore().getServiceConfig();
  const assistant = payload || config.writingAssistant || {};
  const resolved = assistant.reuseModelConnection
    ? { ...assistant, baseUrl: config.model.baseUrl, apiKey: config.model.apiKey }
    : assistant;
  return createWritingAssistantClient(resolved).testConnection();
});

ipcMain.handle('writing-assistant:evaluate', async (_event, payload) => {
  const candidates = Array.isArray(payload) ? payload : payload?.candidates;
  if (!Array.isArray(candidates) || candidates.length > 10000) {
    return { ok: false, code: 'WRITING_ASSISTANT_INVALID_INPUT', message: '辅助判断候选数量超过本次安全上限。' };
  }
  if (!Array.isArray(payload) && payload?.taskSummary !== undefined && typeof payload.taskSummary !== 'string') {
    return { ok: false, code: 'WRITING_ASSISTANT_INVALID_INPUT', message: '辅助判断任务摘要格式无效。' };
  }
  const config = getSettingsStore().getServiceConfig();
  const assistant = config.writingAssistant || {};
  const resolved = assistant.reuseModelConnection
    ? { ...assistant, baseUrl: config.model.baseUrl, apiKey: config.model.apiKey }
    : assistant;
  const client = createWritingAssistantClient(resolved);
  if (!client.configured) return { ok: false, code: 'WRITING_ASSISTANT_NOT_CONFIGURED', message: '辅助判断未配置。' };
  const result = await client.evaluateCandidates(candidates, Array.isArray(payload) ? '' : payload.taskSummary || '');
  return { ...result, mode: client.mode, model: client.modelId };
});

ipcMain.handle('writing-resource:execute', async (_event, payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some(key => !['actionId', 'resourceId', 'rootId', 'params', 'mode'].includes(key))) {
    return { status: 'failed', code: 'RESOURCE_INVALID_REQUEST', message: '资源动作请求格式无效。' };
  }
  if (!promptAgentSources || typeof promptAgentSources.resolveAuthorizedRoot !== 'function') {
    return { status: 'unavailable', code: 'RESOURCE_ROOT_NOT_AUTHORIZED', message: '当前没有可用的本地目录授权。' };
  }
  try {
    const root = promptAgentSources.resolveAuthorizedRoot(payload.rootId);
    const runner = createWritingResourceRunner({ resources: getBuiltinWritingPacks().flatMap(pack => pack.resources || []),
      resourceRoots: { 'authorized-project-root': root } });
    return await runner.execute({ ...payload, rootId: 'authorized-project-root' });
  } catch (error) {
    return { status: 'failed', code: error.code || 'RESOURCE_EXEC_FAILED', message: error.message || '资源动作执行失败。' };
  }
});

ipcMain.handle('writing-resource:read', async (_event, payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some(key => !['resourceId', 'relativePath', 'limit'].includes(key))) {
    return { status: 'failed', code: 'RESOURCE_INVALID_REQUEST', message: '资源读取请求格式无效。' };
  }
  const runner = createWritingResourceRunner({ resources: getBuiltinWritingPacks().flatMap(pack => pack.resources || []), resourceArchives: {
    'softcopyright-evidence-skill': process.env.SOFTCOPYRIGHT_EVIDENCE_SKILL_ARCHIVE || 'D:/百度网盘下载文件/软著材料skill/软著材料skill.zip',
    'softcopyright-materials-skill': process.env.SOFTCOPYRIGHT_MATERIALS_SKILL_ARCHIVE || 'D:/夸克/软著申请资料skill/SoftwareCopyright-Skill-main(1).zip'
  } });
  try {
    return await runner.read(payload);
  } catch (error) {
    return { status: 'failed', code: error.code || 'RESOURCE_READ_FAILED', message: error.message || '资源读取失败。' };
  }
});

ipcMain.handle('model:request', async (_event, payload) => {
  const client = createModelClient(getSettingsStore().getServiceConfig().model);
  return client.request(payload?.messages, payload?.options);
});

ipcMain.handle('search:request', async (_event, payload) => {
  const client = createSearchClient(getSettingsStore().getServiceConfig().search);
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
    if (metadata) {
      const match = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})_([a-f0-9]{32})\.(txt|pdf|png|jpg|webp)$/.exec(id);
      if (!match) throw Object.assign(new TypeError('研究附件索引无效'), { code: 'BACKUP_EXPORT_INVALID_ATTACHMENT' });
      return { id, taskId: match[1], type: metadata.type, size: metadata.size,
        openStream: () => getSocialAttachmentStore().createReadStream(id) };
    }
    const workbench = backup.data?.workbenchAttachments?.find(item => item?.archiveId === id);
    const match = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|png|jpg|webp|html|txt|md|pptx|docx)$/.exec(id);
    const typeByMime = { 'text/plain': 'text/plain', 'text/markdown': 'text/markdown', 'application/pdf': 'application/pdf', 'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/webp': 'image/webp', 'text/html': 'text/html',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    if (!workbench || !match || workbench.id !== match[2] || workbench.taskId !== match[1]
      || !typeByMime[workbench.mimeType] || !Number.isSafeInteger(workbench.size) || !/^[a-f0-9]{64}$/.test(workbench.sha256 || '')) {
      throw Object.assign(new TypeError('工作台附件索引无效'), { code: 'BACKUP_EXPORT_INVALID_ATTACHMENT' });
    }
    return { id, taskId: match[1], type: typeByMime[workbench.mimeType], size: workbench.size,
      openStream: () => getPptFeedbackAttachmentStore().createReadStream(workbench.id, { includeDeleted: workbench.deleted === true }) };
  });
  const { manifests: workbenchManifests, errors: workbenchManifestErrors } = getPptFeedbackAttachmentStore().listTaskManifests();
  if (workbenchManifestErrors.length) {
    throw Object.assign(new Error('存在无法读取的工作台任务清单，完整备份未导出'), { code: 'BACKUP_EXPORT_INVALID_WORKBENCH_MANIFEST' });
  }
  const tempPath = result.filePath + `.tmp-${process.pid}-${Date.now()}`;
  try {
    const output = fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });
    await workspaceArchive.exportWorkspaceArchive({ output, workspace: backup, attachments, workbenchManifests });
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
        attachments: archive.attachments.map(({ id, taskId, type, size, sha256 }) => ({ id, taskId, type, size, sha256 })),
        attachmentErrors: archive.attachmentErrors,
        workbenchManifests: archive.workbenchManifests,
        workbenchErrors: archive.workbenchErrors
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
    || Object.keys(payload).some(key => !['stageId', 'attachmentIds', 'targetAttachmentIds', 'workbenchAssets'].includes(key))
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
  const workbenchAssets = payload.workbenchAssets || { mode: 'merge', attachments: [], annotations: [] };
  const workbenchAssetKeys = ['mode', 'attachments', 'annotations', 'taskIds', 'manifests', 'taskIdMap', 'attachmentIdMap'];
  if (!workbenchAssets || !['merge', 'replace'].includes(workbenchAssets.mode)
    || Object.keys(workbenchAssets).some(key => !workbenchAssetKeys.includes(key))
    || !Array.isArray(workbenchAssets.attachments) || !Array.isArray(workbenchAssets.annotations)
    || workbenchAssets.taskIds !== undefined && (!Array.isArray(workbenchAssets.taskIds)
      || workbenchAssets.taskIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id))
      || new Set(workbenchAssets.taskIds).size !== workbenchAssets.taskIds.length)
    || workbenchAssets.manifests !== undefined && !Array.isArray(workbenchAssets.manifests)
    || workbenchAssets.taskIdMap !== undefined && !Array.isArray(workbenchAssets.taskIdMap)
    || workbenchAssets.attachmentIdMap !== undefined && !Array.isArray(workbenchAssets.attachmentIdMap)) {
    throw Object.assign(new TypeError('工作台批注导入数据无效'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
  }
  const readIdMap = (entries, pattern, label) => {
    const result = new Map();
    const targets = new Set();
    for (const item of entries || []) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).some(key => !['from', 'to'].includes(key))
        || typeof item.from !== 'string' || !pattern.test(item.from)
        || typeof item.to !== 'string' || !pattern.test(item.to)
        || result.has(item.from) || targets.has(item.to)) {
        throw Object.assign(new TypeError(label + '映射无效'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
      }
      result.set(item.from, item.to);
      targets.add(item.to);
    }
    return result;
  };
  const safeTaskId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
  const safeAttachmentId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const taskIdMap = readIdMap(workbenchAssets.taskIdMap, safeTaskId, '任务 ID');
  const attachmentIdMap = readIdMap(workbenchAssets.attachmentIdMap, safeAttachmentId, '附件 ID');
  const archiveWorkspace = stage.archive.workspace || {};
  const archiveData = archiveWorkspace.data || archiveWorkspace;
  const sourceProjects = Array.isArray(archiveData.projects) ? archiveData.projects : [];
  const sourceWorkbenchAttachments = Array.isArray(archiveData.workbenchAttachments) ? archiveData.workbenchAttachments : [];
  const sourceWorkbenchAnnotations = Array.isArray(archiveData.workbenchAnnotations) ? archiveData.workbenchAnnotations : [];
  const sourceWorkbenchTasks = new Set(sourceProjects.filter(project => project && (
    project.workbenchPersistenceEnabled === true || project.workbenchDraft || project.workbenchContents
      || project.workbenchCanvases || project.workbenchPromptRounds || project.workbenchAttachmentId || project.workbenchAttachmentIds
  )).map(project => project.id));
  for (const item of sourceWorkbenchAttachments) sourceWorkbenchTasks.add(item.taskId);
  for (const item of sourceWorkbenchAnnotations) sourceWorkbenchTasks.add(item.taskId);
  for (const item of stage.archive.workbenchManifests || []) sourceWorkbenchTasks.add(item.taskId);
  const taskIds = new Set(workbenchAssets.taskIds || []);
  const sourceByTargetTask = new Map();
  for (const [sourceTaskId, targetTaskId] of taskIdMap) {
    if (!sourceWorkbenchTasks.has(sourceTaskId) || !taskIds.has(targetTaskId)) {
      throw Object.assign(new TypeError('任务 ID 映射与已校验 ZIP 或实际导入任务不一致'), { code: 'BACKUP_IMPORT_INVALID_MANIFEST' });
    }
    sourceByTargetTask.set(targetTaskId, sourceTaskId);
  }
  for (const taskId of taskIds) {
    const sourceTaskId = sourceByTargetTask.get(taskId) || taskId;
    if (!sourceWorkbenchTasks.has(sourceTaskId)) {
      throw Object.assign(new TypeError('导入任务没有对应的已校验工作台数据'), { code: 'BACKUP_IMPORT_INVALID_MANIFEST' });
    }
  }
  const sourceAttachmentsById = new Map(sourceWorkbenchAttachments.map(item => [item.id, item]));
  const importedSourceAttachmentIds = new Set(workbenchAssets.attachments.map(item => {
    const archiveId = item?.sourceArchiveId || item?.archiveId;
    const match = typeof archiveId === 'string' && /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(txt|md|pdf|png|jpg|webp|html|pptx|docx)$/i.exec(archiveId);
    return match?.[2] || '';
  }));
  for (const [sourceAttachmentId, targetAttachmentId] of attachmentIdMap) {
    if (!importedSourceAttachmentIds.has(sourceAttachmentId)
      || !workbenchAssets.attachments.some(item => item.id === targetAttachmentId)) {
      throw Object.assign(new TypeError('附件 ID 映射与实际导入工作台附件不一致'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
    }
  }
  const workbenchManifests = workbenchAssets.manifests || [];
  const sourceManifestTaskIds = new Set((stage.archive.workbenchManifests || []).map(item => item.taskId));
  const manifestTasks = new Set();
  const manifestJournalEntries = [];
  for (const manifest of workbenchManifests) {
    const sourceTaskId = manifest?.sourceTaskId || manifest?.taskId;
    const sourceManifest = (stage.archive.workbenchManifests || []).find(item => item.taskId === sourceTaskId);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || Object.keys(manifest).some(key => !['schemaVersion', 'taskId', 'revision', 'project', 'sourceTaskId'].includes(key))
      || manifest.schemaVersion !== workbenchSchema.WORKBENCH_SCHEMA_VERSION
      || typeof manifest.taskId !== 'string' || !safeTaskId.test(manifest.taskId)
      || !Number.isSafeInteger(manifest.revision) || manifest.revision < 1
      || !manifest.project || typeof manifest.project !== 'object' || Array.isArray(manifest.project)
      || manifest.project.id !== manifest.taskId || !taskIds.has(manifest.taskId)
      || typeof sourceTaskId !== 'string' || !safeTaskId.test(sourceTaskId)
      || !sourceManifestTaskIds.has(sourceTaskId)
      || (sourceByTargetTask.get(manifest.taskId) || manifest.taskId) !== sourceTaskId
      || (taskIdMap.get(sourceTaskId) || sourceTaskId) !== manifest.taskId
      || manifestTasks.has(manifest.taskId)) {
      throw Object.assign(new TypeError('工作台任务清单与 ZIP 或任务 ID 映射不一致'), { code: 'BACKUP_IMPORT_INVALID_MANIFEST' });
    }
    const backupProject = sourceProjects.find(item => item.id === sourceTaskId);
    const backupRevision = Number.isSafeInteger(backupProject?.workbenchRevision) ? backupProject.workbenchRevision : 0;
    const sourceProject = backupRevision > sourceManifest.revision ? backupProject : sourceManifest.project;
    const sourceRevision = backupRevision > sourceManifest.revision ? backupRevision : sourceManifest.revision;
    let expectedManifest;
    try {
      expectedManifest = workspaceBackup.rewriteWorkbenchTaskIds(
        { projects: [sourceProject] },
        [{ ...sourceManifest, revision: sourceRevision, project: sourceProject }],
        workbenchAssets.taskIdMap || [], workbenchAssets.attachmentIdMap || []
      ).workbenchManifests[0];
    } catch (error) {
      throw Object.assign(new TypeError('工作台任务清单的 ZIP 来源无法映射', { cause: error }), { code: 'BACKUP_IMPORT_INVALID_MANIFEST' });
    }
    const importedAttachmentIds = workbenchAssets.attachments.filter(item => item.taskId === manifest.taskId).map(item => item.id);
    expectedManifest.project.workbenchAttachmentIds = importedAttachmentIds;
    expectedManifest.project.workbenchAttachmentId = importedAttachmentIds.includes(expectedManifest.project.workbenchAttachmentId)
      ? expectedManifest.project.workbenchAttachmentId : importedAttachmentIds[0] || null;
    if (manifest.revision !== sourceRevision
      || stableJson(workbenchSchema.normalizeWorkbenchProject(manifest.project))
        !== stableJson(workbenchSchema.normalizeWorkbenchProject(expectedManifest.project))) {
      throw Object.assign(new TypeError('工作台任务清单正文或 revision 与已校验 ZIP 不一致'), { code: 'BACKUP_IMPORT_INVALID_MANIFEST' });
    }
    try { manifestJournalEntries.push({ taskId: manifest.taskId, sha256: workbenchManifestSignature(manifest) }); }
    catch (error) {
      throw Object.assign(new TypeError('工作台任务清单内容无效', { cause: error }), { code: 'BACKUP_IMPORT_INVALID_MANIFEST' });
    }
    manifestTasks.add(manifest.taskId);
  }
  const workbenchByArchiveId = new Map(workbenchAssets.attachments.map(item => [item?.sourceArchiveId || item?.archiveId, item]));
  if (workbenchByArchiveId.size !== workbenchAssets.attachments.length
    || workbenchAssets.attachments.some(item => !item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.archiveId !== 'string' || item.sourceArchiveId !== undefined && typeof item.sourceArchiveId !== 'string')
    || new Set(workbenchAssets.attachments.map(item => item.id)).size !== workbenchAssets.attachments.length) {
    throw Object.assign(new TypeError('工作台附件归档 ID 重复'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
  }
  const researchStore = getSocialAttachmentStore();
  const workbenchStore = getPptFeedbackAttachmentStore();
  const researchIds = [];
  const workbenchIds = [];
  for (const [index, sourceId] of selected.entries()) {
    const item = descriptors.get(sourceId);
    const targetId = targetIds[index];
    const workbench = workbenchByArchiveId.get(sourceId);
    if (workbench) {
      const mimeType = { 'text/plain': 'text/plain', 'text/markdown': 'text/markdown', 'application/pdf': 'application/pdf', 'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/webp': 'image/webp', 'text/html': 'text/html',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }[workbench.mimeType];
      const extension = { 'text/plain': 'txt', 'text/markdown': 'md', 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/html': 'html',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' }[workbench.mimeType];
      const sourceTaskId = item.taskId;
      const targetTaskId = taskIdMap.get(sourceTaskId) || sourceTaskId;
      const sourcePrefix = sourceTaskId + '_';
      const sourceAttachment = sourceId.startsWith(sourcePrefix) ? sourceId.slice(sourcePrefix.length) : '';
      const sourceAttachmentId = sourceAttachment.replace(/\.(txt|md|pdf|png|jpg|webp|html|pptx|docx)$/i, '');
      const sourceAsset = sourceAttachmentsById.get(sourceAttachmentId);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(targetId)
        || !safeAttachmentId.test(sourceAttachmentId)
        || (attachmentIdMap.get(sourceAttachmentId) || sourceAttachmentId) !== targetId
        || !sourceAsset || sourceAsset.taskId !== sourceTaskId || sourceAsset.archiveId !== sourceId
        || sourceAsset.size !== workbench.size || sourceAsset.sha256 !== workbench.sha256
        || workbench.id !== targetId || workbench.taskId !== targetTaskId
        || workbench.archiveId !== targetTaskId + '_' + targetId + '.' + extension
        || !mimeType || mimeType !== item.type || workbench.size !== item.size || workbench.sha256 !== item.sha256) {
        throw Object.assign(new TypeError('工作台附件 ID、任务、类型或摘要与 ZIP 不匹配'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
      }
      workbenchIds.push({ sourceId, targetId, workbench, item });
      continue;
    }
    const prefix = `${item.taskId}_`;
    const targetSuffix = targetId.startsWith(prefix) ? targetId.slice(prefix.length) : '';
    if (!/^[a-f0-9]{32}\.(txt|pdf|png|jpg|webp)$/.test(targetSuffix)) {
      throw Object.assign(new TypeError('研究附件目标 ID 与所属任务不匹配'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
    }
    if (researchStore.has(targetId)) throw Object.assign(new Error('目标设备已存在相同附件 ID；请先处理冲突再导入'), { code: 'BACKUP_IMPORT_ATTACHMENT_CONFLICT' });
    researchIds.push({ sourceId, targetId, item });
  }
  if (workbenchIds.length !== workbenchAssets.attachments.length) {
    throw Object.assign(new TypeError('工作台附件与 ZIP 暂存清单不一致'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
  }
  const workbenchAttachmentById = new Map(workbenchAssets.attachments.map(item => [item.id, item]));
  const annotations = workbenchAssets.annotations.map(annotation => validatePptAnnotation(annotation));
  if (new Set(annotations.map(item => item.id)).size !== annotations.length
    || annotations.some(annotation => {
      const attachment = workbenchAttachmentById.get(annotation.attachmentId);
      return !attachment || annotation.taskId !== attachment.taskId || annotation.contentHash !== attachment.sha256;
    })) {
    throw Object.assign(new TypeError('工作台批注没有对应的有效附件版本'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
  }
  const importableWorkbenchIds = new Set(workbenchIds.map(entry => entry.workbench.id));
  if (annotations.some(annotation => !importableWorkbenchIds.has(annotation.attachmentId))) {
    throw Object.assign(new TypeError('工作台批注引用的附件没有通过 ZIP 校验'), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
  }
  const transactionId = randomUUID();
  const transactionRoot = path.join(app.getPath('userData'), 'workspace-backup-transactions');
  fs.mkdirSync(transactionRoot, { recursive: true, mode: 0o700 });
  const journalPath = path.join(transactionRoot, `${transactionId}.json`);
  const existingWorkbench = new Map(workbenchStore.listBackupAttachments().map(item => [item.id, item]));
  for (const entry of manifestJournalEntries) {
    try {
      if (workbenchStore.readTaskManifest(entry.taskId)) {
        throw Object.assign(new Error('目标任务已有工作台清单，导入不会覆盖'), { code: 'BACKUP_IMPORT_MANIFEST_CONFLICT' });
      }
    } catch (error) {
      if (error.code === 'BACKUP_IMPORT_MANIFEST_CONFLICT') throw error;
      throw Object.assign(new Error('目标工作台任务清单无法安全读取'), { code: 'BACKUP_IMPORT_MANIFEST_CONFLICT', cause: error });
    }
  }
  const newWorkbenchIds = [];
  for (const { workbench } of workbenchIds) {
    const existing = existingWorkbench.get(workbench.id);
    if (!existing) {
      newWorkbenchIds.push(workbench.id);
      continue;
    }
    if (existing.taskId !== workbench.taskId || existing.mimeType !== workbench.mimeType
      || existing.size !== workbench.size || existing.sha256 !== workbench.sha256
      || existing.deleted !== (workbench.deleted === true)) {
      throw Object.assign(new Error('目标设备已存在不同的同 ID 工作台资料'), { code: 'BACKUP_IMPORT_ATTACHMENT_CONFLICT' });
    }
  }
  const annotationTaskIds = [...new Set([
    ...workbenchAssets.attachments.map(item => item.taskId),
    ...(workbenchAssets.taskIds || [])
  ])];
  for (const taskId of annotationTaskIds) {
    const snapshotPath = path.join(transactionRoot, `${transactionId}-${taskId}.annotations.json`);
    if (fs.existsSync(annotationsPath(taskId))) fs.copyFileSync(annotationsPath(taskId), snapshotPath, fs.constants.COPYFILE_EXCL);
  }
  const journal = {
    version: 3, transactionId, stageId: payload.stageId, stageDirectory: stage.stageDirectory,
    attachmentIds: researchIds.map(item => item.targetId), workbenchAttachmentIds: [...newWorkbenchIds],
    workbenchManifests: manifestJournalEntries, annotationTaskIds, mode: workbenchAssets.mode
  };
  writeBackupFileAtomically(journalPath, JSON.stringify(journal));
  backupImportTransactions.set(transactionId, { journalPath, journal });
  try {
    for (const { targetId, item } of researchIds) {
      await researchStore.importFile({ id: targetId, type: item.type, size: item.size, sha256: item.sha256, sourcePath: item.path });
    }
    for (const { targetId, workbench, item } of workbenchIds) {
      const result = await workbenchStore.importAttachment({
        taskId: workbench.taskId, id: targetId, mimeType: workbench.mimeType, displayName: workbench.displayName,
        size: item.size, sha256: item.sha256, sourcePath: item.path, createdAt: workbench.createdAt,
        deleted: workbench.deleted === true
      });
      if (result.imported && !journal.workbenchAttachmentIds.includes(targetId)) journal.workbenchAttachmentIds.push(targetId);
    }
    for (const manifest of workbenchManifests) workbenchStore.installTaskManifest(manifest.taskId, manifest);
    for (const taskId of annotationTaskIds) {
      const incoming = annotations.filter(item => item.taskId === taskId);
      const current = workbenchAssets.mode === 'merge' ? readPptAnnotations(taskId) : [];
      const byId = new Map(current.map(item => [item.id, item]));
      for (const annotation of incoming) if (!byId.has(annotation.id)) byId.set(annotation.id, annotation);
      savePptAnnotations(taskId, [...byId.values()]);
    }
    writeBackupFileAtomically(journalPath, JSON.stringify(journal));
    return { status: 'ok', transactionId };
  } catch (error) {
    for (const { targetId } of researchIds) { if (researchStore.has(targetId)) researchStore.delete(targetId); }
    for (const id of journal.workbenchAttachmentIds) workbenchStore.removeImportedAttachment(id);
    removeImportedWorkbenchManifests(workbenchStore, journal.workbenchManifests);
    for (const taskId of annotationTaskIds) {
      const snapshotPath = path.join(transactionRoot, `${transactionId}-${taskId}.annotations.json`);
      if (fs.existsSync(snapshotPath)) fs.copyFileSync(snapshotPath, annotationsPath(taskId));
      else fs.rmSync(annotationsPath(taskId), { force: true });
      fs.rmSync(snapshotPath, { force: true });
    }
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
  for (const taskId of transaction.journal.annotationTaskIds || []) {
    fs.rmSync(path.join(path.dirname(transaction.journalPath), `${transactionId}-${taskId}.annotations.json`), { force: true });
  }
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
  const workbenchStore = getPptFeedbackAttachmentStore();
  for (const id of transaction.journal.workbenchAttachmentIds || []) workbenchStore.removeImportedAttachment(id);
  removeImportedWorkbenchManifests(workbenchStore, transaction.journal.workbenchManifests);
  for (const taskId of transaction.journal.annotationTaskIds || []) {
    const snapshotPath = path.join(path.dirname(transaction.journalPath), `${transactionId}-${taskId}.annotations.json`);
    if (fs.existsSync(snapshotPath)) fs.copyFileSync(snapshotPath, annotationsPath(taskId));
    else fs.rmSync(annotationsPath(taskId), { force: true });
    fs.rmSync(snapshotPath, { force: true });
  }
  fs.rmSync(transaction.journalPath, { force: true });
  const stage = backupImportStages.get(transaction.journal.stageId);
  if (stage) fs.rmSync(stage.stageDirectory, { recursive: true, force: true });
  backupImportStages.delete(transaction.journal.stageId);
  backupImportTransactions.delete(transactionId);
  return { status: 'ok', rolledBack: true };
});

ipcMain.handle('backup:recover-imports', async (_event, attachmentIds) => {
  const recovery = Array.isArray(attachmentIds)
    ? { attachmentIds, workbenchAttachmentIds: [], workbenchTaskIds: [] }
    : attachmentIds && typeof attachmentIds === 'object' && !Array.isArray(attachmentIds)
      ? { ...attachmentIds, workbenchTaskIds: attachmentIds.workbenchTaskIds || [] }
      : attachmentIds;
  if (!recovery || typeof recovery !== 'object' || Array.isArray(recovery)
    || Object.keys(recovery).some(key => !['attachmentIds', 'workbenchAttachmentIds', 'workbenchTaskIds'].includes(key))
    || !Array.isArray(recovery.attachmentIds) || recovery.attachmentIds.some(id => typeof id !== 'string')
    || !Array.isArray(recovery.workbenchAttachmentIds) || recovery.workbenchAttachmentIds.some(id => typeof id !== 'string')
    || !Array.isArray(recovery.workbenchTaskIds) || recovery.workbenchTaskIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id))) {
    throw Object.assign(new TypeError('附件引用列表无效'), { code: 'BACKUP_IMPORT_INVALID_REQUEST' });
  }
  const transactionRoot = path.join(app.getPath('userData'), 'workspace-backup-transactions');
  const references = new Set(recovery.attachmentIds);
  const workbenchReferences = new Set(recovery.workbenchAttachmentIds);
  const workbenchTaskReferences = new Set(recovery.workbenchTaskIds);
  const store = getSocialAttachmentStore();
  const workbenchStore = getPptFeedbackAttachmentStore();
  let recovered = 0;
  if (fs.existsSync(transactionRoot)) {
    for (const filename of fs.readdirSync(transactionRoot).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
      const journalPath = path.join(transactionRoot, filename);
      let journal;
      try { journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')); } catch { fs.rmSync(journalPath, { force: true }); continue; }
      if (![1, 2, 3].includes(journal?.version) || !Array.isArray(journal.attachmentIds)
        || journal.attachmentIds.some(id => typeof id !== 'string')
        || journal.version >= 2 && (journal.transactionId !== filename.slice(0, -5)
          || !Array.isArray(journal.workbenchAttachmentIds) || journal.workbenchAttachmentIds.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
          || !Array.isArray(journal.annotationTaskIds) || journal.annotationTaskIds.some(id => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)))
        || journal.version === 3 && (!Array.isArray(journal.workbenchManifests)
          || journal.workbenchManifests.some(item => !item || typeof item.taskId !== 'string'
            || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(item.taskId) || !/^[a-f0-9]{64}$/.test(item.sha256)))) {
        fs.rmSync(journalPath, { force: true }); continue;
      }
      const committed = journal.attachmentIds.every(id => references.has(id))
        && (journal.workbenchAttachmentIds || []).every(id => workbenchReferences.has(id))
        && (journal.workbenchManifests || []).every(item => workbenchTaskReferences.has(item.taskId));
      if (!committed) {
        for (const id of journal.attachmentIds) { if (store.has(id)) store.delete(id); }
        for (const id of journal.workbenchAttachmentIds || []) workbenchStore.removeImportedAttachment(id);
        removeImportedWorkbenchManifests(workbenchStore, journal.workbenchManifests);
        for (const taskId of journal.annotationTaskIds || []) {
          const snapshotPath = path.join(transactionRoot, `${journal.transactionId}-${taskId}.annotations.json`);
          if (fs.existsSync(snapshotPath)) fs.copyFileSync(snapshotPath, annotationsPath(taskId));
          else fs.rmSync(annotationsPath(taskId), { force: true });
          fs.rmSync(snapshotPath, { force: true });
        }
      } else {
        for (const taskId of journal.annotationTaskIds || []) {
          fs.rmSync(path.join(transactionRoot, `${journal.transactionId}-${taskId}.annotations.json`), { force: true });
        }
      }
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
promptAgentSources = createPromptAgentSources({ fs, path, userDataPath: app.getPath('userData'), dialog, ipcMain });
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
