const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const { createPptFeedbackAttachmentStore } = require('../electron/ppt-feedback-attachment-store.js');
const { createPptPreviewManager } = require('../electron/ppt-preview-manager.js');

const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const HTML = Buffer.from('<!doctype html><title>Preview</title><p>safe text</p>');

function loadPreloadApi() {
  let exposed;
  const invocations = [];
  const preloadPath = path.join(__dirname, '..', 'electron', 'preload.js');
  vm.runInNewContext(fs.readFileSync(preloadPath, 'utf8'), {
    Object,
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name, api) => { exposed = { name, api }; } },
        ipcRenderer: { invoke: (...args) => { invocations.push(args); return Promise.resolve(); } }
      };
    }
  }, { filename: preloadPath });
  return { ...exposed, invocations };
}

function makeTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-feedback-preview-'));
}

function makeStore(userData, options = {}) {
  let nextId = 0;
  return createPptFeedbackAttachmentStore({
    app: { getPath: () => userData },
    fs,
    path,
    crypto,
    createId: () => `generated-${++nextId}`,
    now: () => '2026-10-20T10:00:00.000Z',
    ...options
  });
}

function makePreviewHarness(userData, attachmentStore) {
  const windows = [];
  const sessions = [];
  let partitionNumber = 0;
  const BrowserWindow = class {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.webContents = {
        listeners: new Map(),
        on: (name, handler) => this.webContents.listeners.set(name, handler),
        setWindowOpenHandler: handler => { this.windowOpenHandler = handler; }
      };
      this.on = (name, handler) => this.listeners.set(name, handler);
      this.loadFile = async filePath => { this.loadedFile = filePath; };
      this.close = () => this.listeners.get('closed')?.();
      windows.push(this);
    }
  };
  const session = {
    fromPartition(partition, options) {
      const handlers = {};
      const requests = {
        onBeforeRequest: (_filter, handler) => { handlers.beforeRequest = handler; },
        onHeadersReceived: (_filter, handler) => { handlers.headers = handler; }
      };
      const created = {
        partition,
        options,
        handlers,
        webRequest: requests,
        setPermissionRequestHandler: handler => { created.permissionHandler = handler; },
        clearStorageData: async () => { created.storageCleared = true; },
        clearCache: async () => { created.cacheCleared = true; }
      };
      sessions.push(created);
      return created;
    }
  };
  const manager = createPptPreviewManager({
    BrowserWindow,
    session,
    fs,
    path,
    app: { getPath: () => userData },
    attachmentStore,
    createId: () => `preview-${++partitionNumber}`,
    now: () => '2026-10-20T10:00:00.000Z'
  });
  return { manager, windows, sessions };
}

test('preload 仅暴露 pptFeedback 窄接口并映射到命名 IPC 通道', () => {
  const { name, api, invocations } = loadPreloadApi();

  assert.equal(name, 'desktopApi');
  assert.deepEqual(Object.keys(api.pptFeedback), [
    'chooseFile', 'listAttachments', 'openPreview', 'closePreview', 'deleteAttachment', 'saveAnnotation'
  ]);
  assert.equal(api.fs, undefined);
  assert.equal(api.path, undefined);
  assert.equal(api.ipcRenderer, undefined);

  api.pptFeedback.chooseFile('task-1');
  api.pptFeedback.listAttachments('task-1');
  api.pptFeedback.openPreview('attachment-1');
  api.pptFeedback.closePreview('attachment-1');
  api.pptFeedback.deleteAttachment('attachment-1');
  api.pptFeedback.saveAnnotation({ taskId: 'task-1', attachmentId: 'attachment-1' });

  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [
    ['ppt-feedback:choose-file', { taskId: 'task-1' }],
    ['ppt-feedback:list-attachments', { taskId: 'task-1' }],
    ['ppt-feedback:open-preview', { attachmentId: 'attachment-1' }],
    ['ppt-feedback:close-preview', { attachmentId: 'attachment-1' }],
    ['ppt-feedback:delete-attachment', { attachmentId: 'attachment-1' }],
    ['ppt-feedback:save-annotation', { taskId: 'task-1', attachmentId: 'attachment-1' }]
  ]);
});

test('保存 HTML 和图片到任务隔离目录，只返回安全元数据并保留原文件', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const source = path.join(root, 'design.html');
  fs.writeFileSync(source, HTML);
  const store = makeStore(userData);

  const saved = await store.saveAttachment({ taskId: 'task-42', sourcePath: source, mimeType: 'text/html' });

  assert.deepEqual(Object.keys(saved).sort(), ['createdAt', 'id', 'kind', 'mimeType', 'sha256', 'size', 'version']);
  assert.equal(saved.kind, 'html');
  assert.equal(saved.mimeType, 'text/html');
  assert.equal(saved.sha256, crypto.createHash('sha256').update(HTML).digest('hex'));
  assert.equal(saved.version, saved.sha256);
  assert.equal(saved.createdAt, '2026-10-20T10:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(saved), /user-data|design\.html|doctype html|data:/i);
  assert.deepEqual(fs.readFileSync(source), HTML);
  const storedPath = store.getAttachmentPath(saved.id);
  assert.equal(path.relative(userData, storedPath).split(path.sep).slice(0, 3).join('/'), 'ppt-feedback/task-42/generated-1');
  assert.equal(path.basename(storedPath), 'attachment.html');
  assert.deepEqual(fs.readFileSync(storedPath), HTML);

  const imagePath = path.join(root, 'design.png');
  fs.writeFileSync(imagePath, PNG);
  const image = await store.saveAttachment({ taskId: 'task-42', sourcePath: imagePath, mimeType: 'image/png' });
  assert.equal(image.kind, 'image');
  assert.equal(image.sha256, crypto.createHash('sha256').update(PNG).digest('hex'));
});

test('拒绝 MIME/扩展名伪装、路径穿越和超限附件', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const htmlPath = path.join(root, 'fake.png.html');
  const textPath = path.join(root, 'not-html.txt');
  const largeHtmlPath = path.join(root, 'large.html');
  fs.writeFileSync(htmlPath, HTML);
  fs.writeFileSync(textPath, HTML);
  fs.writeFileSync(largeHtmlPath, HTML);
  const store = makeStore(path.join(root, 'user-data'), { limits: { maxHtmlBytes: 10, maxImageBytes: 20 } });

  await assert.rejects(store.saveAttachment({ taskId: 'task-1', sourcePath: htmlPath, mimeType: 'image/png' }), error => error.code === 'INVALID_ATTACHMENT');
  await assert.rejects(store.saveAttachment({ taskId: 'task-1', sourcePath: textPath, mimeType: 'text/html' }), error => error.code === 'INVALID_ATTACHMENT');
  await assert.rejects(store.saveAttachment({ taskId: '../escape', sourcePath: textPath, mimeType: 'text/html' }), error => error.code === 'INVALID_TASK_ID');
  await assert.rejects(store.saveAttachment({ taskId: 'task-1', sourcePath: largeHtmlPath, mimeType: 'text/html' }), error => error.code === 'FILE_TOO_LARGE');
  assert.equal(fs.existsSync(path.join(root, 'escape')), false);
});

test('拒绝图片实际内容与声明 MIME 不匹配及附件 ID 路径穿越', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'image.png');
  fs.writeFileSync(source, Buffer.from('not a PNG'));
  const store = makeStore(path.join(root, 'user-data'));

  await assert.rejects(store.saveAttachment({ taskId: 'task-1', sourcePath: source, mimeType: 'image/png' }), error => error.code === 'INVALID_ATTACHMENT');
  assert.throws(() => store.getAttachmentPath('../outside'), error => error.code === 'INVALID_ATTACHMENT_ID');
});

test('HTML 预览启用 Electron 隔离选项且不加载通用 preload', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const source = path.join(root, 'source.html');
  fs.writeFileSync(source, HTML);
  const store = makeStore(userData);
  const attachment = await store.saveAttachment({ taskId: 'task-1', sourcePath: source, mimeType: 'text/html' });
  const h = makePreviewHarness(userData, store);

  const opened = await h.manager.openPreview({ attachmentId: attachment.id });

  const prefs = h.windows[0].options.webPreferences;
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.preload, undefined);
  assert.equal(h.sessions[0].options.cache, false);
  assert.match(h.windows[0].loadedFile, /preview-[^/\\]+[\\/]attachment\.html$/);
  assert.match(fs.readFileSync(h.windows[0].loadedFile, 'utf8'), /Content-Security-Policy/);
  assert.equal(opened.status, 'opened');
  assert.equal(opened.attachmentId, attachment.id);
  assert.equal(opened.path, undefined);
});

test('预览拦截外部请求、顶层导航、弹窗和权限请求，并添加严格 CSP', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.html');
  fs.writeFileSync(source, HTML);
  const userData = path.join(root, 'user-data');
  const store = makeStore(userData);
  const attachment = await store.saveAttachment({ taskId: 'task-1', sourcePath: source, mimeType: 'text/html' });
  const h = makePreviewHarness(userData, store);
  await h.manager.openPreview({ attachmentId: attachment.id });
  const preview = h.windows[0];
  const previewSession = h.sessions[0];
  const request = (url, resourceType = 'xhr') => new Promise(resolve => previewSession.handlers.beforeRequest({ url, resourceType }, resolve));

  assert.deepEqual(await request('https://example.com/tracker.js'), { cancel: true });
  assert.deepEqual(await request('file:///C:/Users/private.txt'), { cancel: true });
  assert.deepEqual(await request(pathToFileURL(preview.loadedFile).href, 'mainFrame'), { cancel: false });
  assert.deepEqual(preview.windowOpenHandler({ url: 'https://example.com' }), { action: 'deny' });
  let permissionDecision;
  previewSession.permissionHandler({}, 'media', allowed => { permissionDecision = allowed; });
  assert.equal(permissionDecision, false);

  let navigationPrevented = false;
  preview.webContents.listeners.get('will-navigate')({ preventDefault: () => { navigationPrevented = true }, url: 'https://example.com' });
  assert.equal(navigationPrevented, true);

  const response = { responseHeaders: { 'content-type': ['text/html'] } };
  previewSession.handlers.headers({ responseHeaders: response.responseHeaders }, value => {
    const csp = Object.entries(value.responseHeaders).find(([name]) => name.toLowerCase() === 'content-security-policy')?.[1]?.[0];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'none'/);
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /img-src 'self'/);
    assert.doesNotMatch(csp, /https:/);
  });
});

test('关闭预览清理临时副本和会话数据', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.html');
  fs.writeFileSync(source, HTML);
  const userData = path.join(root, 'user-data');
  const store = makeStore(userData);
  const attachment = await store.saveAttachment({ taskId: 'task-1', sourcePath: source, mimeType: 'text/html' });
  const h = makePreviewHarness(userData, store);
  const opened = await h.manager.openPreview({ attachmentId: attachment.id });
  const tempCopy = h.windows[0].loadedFile;

  h.windows[0].close();
  await opened.closed;

  assert.equal(fs.existsSync(tempCopy), false);
  assert.equal(h.sessions[0].storageCleared, true);
  assert.equal(h.sessions[0].cacheCleared, true);
});

test('网页和开发页只保存来源版本与抓取时间，无法安全捕获时降级为截图或文本', async () => {
  const root = makeTempDirectory();
  try {
    const h = makePreviewHarness(path.join(root, 'user-data'), {});
    const result = await h.manager.openPreview({
      source: { kind: 'url', url: 'https://user:secret@example.com/deck?token=private#slide-4', version: 'remote-v3' }
    });

    assert.equal(result.status, 'unsupported');
    assert.equal(result.source.kind, 'url');
    assert.equal(result.source.url, 'https://example.com/deck');
    assert.equal(result.source.version, 'remote-v3');
    assert.equal(result.source.fetchedAt, '2026-10-20T10:00:00.000Z');
    assert.deepEqual(result.fallback, ['screenshot', 'text']);
    assert.equal(h.windows.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /data:|absolutePath|body|html/i);
    assert.doesNotMatch(JSON.stringify(result), /secret|token=|slide-4/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
