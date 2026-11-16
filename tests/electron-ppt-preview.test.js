const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');

const { createPptFeedbackAttachmentStore } = require('../electron/ppt-feedback-attachment-store.js');
const { createPptPreviewManager } = require('../electron/ppt-preview-manager.js');

const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const HTML = Buffer.from('<!doctype html><title>Preview</title><p>safe text</p>');
const PDF = Buffer.from('%PDF-1.7\nsynthetic preview fixture\n%%EOF\n');

function loadPreloadApi() {
  let exposed;
  const invocations = [];
  const listeners = [];
  const sends = [];
  const preloadPath = path.join(__dirname, '..', 'electron', 'preload.js');
  vm.runInNewContext(fs.readFileSync(preloadPath, 'utf8'), {
    Object,
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name, api) => { exposed = { name, api }; } },
        ipcRenderer: {
          invoke: (...args) => { invocations.push(args); return Promise.resolve(); },
          send: (...args) => sends.push(args),
          on: (...args) => listeners.push(args),
          removeListener: (...args) => listeners.push(['remove', ...args])
        }
      };
    }
  }, { filename: preloadPath });
  return { ...exposed, invocations, listeners, sends };
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
  const views = [];
  const sessions = [];
  const sent = [];
  let partitionNumber = 0;
  const BrowserWindow = class {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.webContents = {
        mainFrame: {},
        listeners: new Map(),
        on: (name, handler) => this.webContents.listeners.set(name, handler),
        send: (...args) => sent.push(args),
        setWindowOpenHandler: handler => { this.windowOpenHandler = handler; }
      };
      this.on = (name, handler) => this.listeners.set(name, handler);
      this.loadFile = async filePath => { this.loadedFile = filePath; };
      this.close = () => this.listeners.get('closed')?.();
      windows.push(this);
    }
  };
  const WebContentsView = class {
    constructor(options) {
      this.options = options;
      let destroyed = false;
      this.webContents = {
        mainFrame: {},
        listeners: new Map(),
        on: (name, handler) => this.webContents.listeners.set(name, handler),
        send: (...args) => sent.push(args),
        setWindowOpenHandler: handler => { this.windowOpenHandler = handler; },
        loadURL: async url => { this.loadedUrl = url; this.loadedFile = fileURLToPath(url); },
        isDestroyed: () => destroyed,
         destroy: () => {
           destroyed = true;
           this.webContents.listeners.get('destroyed')?.();
         }
      };
      this.setBounds = bounds => { this.bounds = bounds; };
      this.setVisible = visible => { this.visible = visible; };
      views.push(this);
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
    WebContentsView,
    session,
    fs,
    path,
    app: { getPath: () => userData },
    attachmentStore,
    createId: () => `preview-${++partitionNumber}`,
    now: () => '2026-10-20T10:00:00.000Z'
  });
  return { manager, windows, views, sessions, sent };
}

test('preload 仅暴露工作台和 pptFeedback 窄接口并映射到命名 IPC 通道', () => {
  const { name, api, invocations, listeners, sends } = loadPreloadApi();

  assert.equal(name, 'desktopApi');
  assert.deepEqual(Object.keys(api.workbench), ['listManifests', 'readManifest', 'saveManifest', 'openTaskFolder', 'exportMaterials']);
  assert.deepEqual(Object.keys(api.pptFeedback), [
    'chooseFile', 'saveImage', 'saveWebSnapshot', 'listAttachments', 'listDeletedAttachments', 'listBackupAttachments', 'listAnnotations', 'readImage', 'readPdf', 'readText', 'readOffice', 'openPreview', 'setPreviewBounds', 'closePreview', 'onPreviewTarget', 'deleteAttachment', 'restoreAttachment', 'saveAnnotation'
  ]);
  assert.equal(api.fs, undefined);
  assert.equal(api.path, undefined);
  assert.equal(api.ipcRenderer, undefined);

  api.pptFeedback.chooseFile('task-1');
  const imageBytes = new Uint8Array([1, 2, 3]);
  api.pptFeedback.saveImage('task-1', imageBytes, 'image/png', 'image.png');
  const snapshot = { title: 'Title', finalUrl: 'https://example.com/', fetchedAt: '2026-11-12T01:02:03.000Z', contentHash: `sha256:${'a'.repeat(64)}`, html: '<main>Page text</main>', text: 'Page text', incomplete: false };
  api.pptFeedback.saveWebSnapshot('task-1', snapshot);
  api.pptFeedback.listAttachments('task-1');
  api.pptFeedback.listDeletedAttachments('task-1');
  api.pptFeedback.listBackupAttachments('task-1');
  api.pptFeedback.listAnnotations('task-1');
  api.pptFeedback.readImage('attachment-1');
  api.pptFeedback.readPdf('attachment-1');
  api.pptFeedback.readText('attachment-1');
  const locateTarget = { kind: 'text', selector: 'main > p', exact: 'safe text', prefix: '', suffix: '', start: 0, end: 9 };
  api.pptFeedback.openPreview('attachment-1', locateTarget, 'a'.repeat(64));
  api.pptFeedback.openPreview('attachment-2', undefined, 'b'.repeat(64), true);
  api.pptFeedback.setPreviewBounds('attachment-2', { x: 10, y: 20, width: 300, height: 400, visible: true });
  api.pptFeedback.closePreview('attachment-1');
  const received = [];
  const unsubscribe = api.pptFeedback.onPreviewTarget(value => received.push(value));
  assert.equal(typeof unsubscribe, 'function');
  assert.equal(listeners[0][0], 'ppt-feedback:preview-target');
  listeners[0][1](null, { target: 'selection' });
  unsubscribe();
  assert.deepEqual(received, [{ target: 'selection' }]);
  assert.equal(listeners[1][0], 'remove');
  api.pptFeedback.deleteAttachment('task-1', 'attachment-1');
  api.pptFeedback.restoreAttachment('task-1', 'attachment-1');
  api.pptFeedback.saveAnnotation({ taskId: 'task-1', attachmentId: 'attachment-1' });
  api.workbench.listManifests();
  api.workbench.readManifest('task-1');
  api.workbench.saveManifest('task-1', { schemaVersion: 1 });
  api.workbench.openTaskFolder('task-1');
  api.workbench.exportMaterials('task-1', 'round-1', 'delivery-1');

  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [
    ['ppt-feedback:choose-file', { taskId: 'task-1' }],
    ['ppt-feedback:save-image', { taskId: 'task-1', bytes: { 0: 1, 1: 2, 2: 3 }, mimeType: 'image/png', displayName: 'image.png' }],
    ['ppt-feedback:save-web-snapshot', { taskId: 'task-1', snapshot }],
    ['ppt-feedback:list-attachments', { taskId: 'task-1' }],
    ['ppt-feedback:list-deleted-attachments', { taskId: 'task-1' }],
    ['ppt-feedback:list-backup-attachments', { taskId: 'task-1' }],
    ['ppt-feedback:list-annotations', { taskId: 'task-1' }],
    ['ppt-feedback:read-image', { attachmentId: 'attachment-1' }],
    ['ppt-feedback:read-pdf', { attachmentId: 'attachment-1' }],
    ['ppt-feedback:read-text', { attachmentId: 'attachment-1' }],
    ['ppt-feedback:open-preview', { attachmentId: 'attachment-1', target: locateTarget, expectedHash: 'a'.repeat(64) }],
    ['ppt-feedback:open-preview', { attachmentId: 'attachment-2', expectedHash: 'b'.repeat(64), embedded: true }],
    ['ppt-feedback:close-preview', { attachmentId: 'attachment-1' }],
    ['ppt-feedback:delete-attachment', { taskId: 'task-1', attachmentId: 'attachment-1' }],
    ['ppt-feedback:restore-attachment', { taskId: 'task-1', attachmentId: 'attachment-1' }],
    ['ppt-feedback:save-annotation', { taskId: 'task-1', attachmentId: 'attachment-1' }],
    ['workbench:list-manifests'],
    ['workbench:read-manifest', { taskId: 'task-1' }],
    ['workbench:save-manifest', { taskId: 'task-1', manifest: { schemaVersion: 1 } }],
    ['workbench:open-task-folder', { taskId: 'task-1' }],
    ['workbench:export-materials', { taskId: 'task-1', roundId: 'round-1', deliveryId: 'delivery-1' }]
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(sends)), [
    ['ppt-feedback:set-preview-bounds', { attachmentId: 'attachment-2', bounds: { x: 10, y: 20, width: 300, height: 400, visible: true } }]
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

  assert.deepEqual(Object.keys(saved).sort(), ['createdAt', 'displayName', 'id', 'kind', 'mimeType', 'sha256', 'size', 'taskId', 'version']);
  assert.equal(saved.taskId, 'task-42');
  assert.equal(saved.displayName, 'design.html');
  assert.equal(saved.kind, 'html');
  assert.equal(saved.mimeType, 'text/html');
  assert.equal(saved.sha256, crypto.createHash('sha256').update(HTML).digest('hex'));
  assert.equal(saved.version, saved.sha256);
  assert.equal(saved.createdAt, '2026-10-20T10:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(saved), /user-data|doctype html|data:/i);
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
  assert.equal(store.readImageDataUrl(image.id), `data:image/png;base64,${PNG.toString('base64')}`);
  assert.throws(() => store.readImageDataUrl(saved.id), error => error.code === 'UNSUPPORTED_PREVIEW');

  const pdfPath = path.join(root, 'design.pdf');
  fs.writeFileSync(pdfPath, PDF);
  const pdf = await store.saveAttachment({ taskId: 'task-42', sourcePath: pdfPath, mimeType: 'application/pdf' });
  assert.equal(pdf.kind, 'pdf');
  assert.equal(pdf.mimeType, 'application/pdf');
  assert.equal(pdf.sha256, crypto.createHash('sha256').update(PDF).digest('hex'));
  const pdfDataUrl = store.readPdfDataUrl(pdf.id);
  assert.match(pdfDataUrl, /^data:application\/pdf;base64,/);
  assert.deepEqual(Buffer.from(pdfDataUrl.split(',')[1], 'base64'), PDF);
  assert.throws(() => store.readImageDataUrl(pdf.id), error => error.code === 'UNSUPPORTED_PREVIEW');
});

test('TXT/MD 保留原字节，按附件版本校验后仅以 UTF-8 文本预览', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const txtPath = path.join(root, 'notes.txt');
  const mdPath = path.join(root, 'brief.md');
  const invalidPath = path.join(root, 'invalid.txt');
  const imagePath = path.join(root, 'image.png');
  const txt = Buffer.from('目标：整理素材\n先保留原文', 'utf8');
  const md = Buffer.from('# 页面参考\n\n- 保留导航', 'utf8');
  fs.writeFileSync(txtPath, txt);
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(invalidPath, Buffer.from([0xc3, 0x28]));
  fs.writeFileSync(imagePath, PNG);
  const store = makeStore(userData);
  const textAttachment = await store.saveAttachment({ taskId: 'task-text', sourcePath: txtPath, mimeType: 'text/plain' });
  const markdownAttachment = await store.saveAttachment({ taskId: 'task-text', sourcePath: mdPath, mimeType: 'text/markdown' });
  const invalidAttachment = await store.saveAttachment({ taskId: 'task-text', sourcePath: invalidPath, mimeType: 'text/plain' });

  assert.deepEqual(store.readText(textAttachment.id), {
    attachmentId: textAttachment.id, sha256: textAttachment.sha256, text: txt.toString('utf8')
  });
  assert.equal(store.readText(markdownAttachment.id).text, md.toString('utf8'));
  assert.deepEqual(fs.readFileSync(store.getAttachmentPath(textAttachment.id)), txt);
  assert.throws(() => store.readText(invalidAttachment.id), error => error.code === 'INVALID_TEXT_ENCODING');
  const imageAttachment = await store.saveAttachment({ taskId: 'task-text', sourcePath: imagePath, mimeType: 'image/png' });
  assert.throws(() => store.readText(imageAttachment.id), error => error.code === 'UNSUPPORTED_PREVIEW');
});

test('应用重启后按任务恢复附件 ID 和内容版本，同名新版本不覆盖旧批注目标', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const source = path.join(root, 'same-name.html');
  fs.writeFileSync(source, HTML);
  const firstStore = makeStore(userData);
  const first = await firstStore.saveAttachment({ taskId: 'task-42', sourcePath: source, mimeType: 'text/html' });

  fs.writeFileSync(source, Buffer.from('<!doctype html><title>Updated</title>'));
  const second = await firstStore.saveAttachment({ taskId: 'task-42', sourcePath: source, mimeType: 'text/html' });
  const restartedStore = makeStore(userData);

  assert.notEqual(first.id, second.id);
  assert.notEqual(first.version, second.version);
  await assert.rejects(makeStore(userData).saveAttachment({ taskId: 'task-42', sourcePath: source, mimeType: 'text/html' }), error => error.code === 'ATTACHMENT_SAVE_FAILED');
  assert.deepEqual(restartedStore.listAttachments('task-42').map(item => item.id).sort(), [first.id, second.id].sort());
  assert.deepEqual(restartedStore.getAttachment(first.id), first);
  assert.deepEqual(fs.readFileSync(restartedStore.getAttachmentPath(first.id)), HTML);
  assert.deepEqual(fs.readFileSync(restartedStore.getAttachmentPath(second.id)), Buffer.from('<!doctype html><title>Updated</title>'));
});

test('无元数据清单的旧附件仍按目录恢复并重新计算内容哈希', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const source = path.join(root, 'legacy.html');
  fs.writeFileSync(source, HTML);
  const oldStore = makeStore(userData);
  const saved = await oldStore.saveAttachment({ taskId: 'task-legacy', sourcePath: source, mimeType: 'text/html' });
  fs.rmSync(path.join(userData, 'ppt-feedback', 'task-legacy', saved.id, 'metadata.json'));

  const restored = makeStore(userData);
  assert.deepEqual(restored.listAttachments('task-legacy').map(item => item.id), [saved.id]);
  assert.equal(restored.getAttachment(saved.id).sha256, saved.sha256);
  assert.equal(restored.getAttachment(saved.id).displayName, '资料.html');
  assert.deepEqual(fs.readFileSync(restored.getAttachmentPath(saved.id)), HTML);
});

test('移除附件保留原记录与批注目标，并可在应用重启后恢复', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const source = path.join(root, 'restore.html');
  fs.writeFileSync(source, HTML);
  const store = makeStore(userData);
  const saved = await store.saveAttachment({ taskId: 'task-restore', sourcePath: source, mimeType: 'text/html' });

  store.deleteAttachment(saved.id);
  assert.deepEqual(store.listAttachments('task-restore'), []);
  assert.deepEqual(store.listDeletedAttachments('task-restore').map(item => item.id), [saved.id]);
  assert.deepEqual(store.listBackupAttachments('task-restore').map(item => ({ id: item.id, deleted: item.deleted })), [{ id: saved.id, deleted: true }]);
  assert.throws(() => store.getAttachment(saved.id), error => error.code === 'INVALID_ATTACHMENT_ID');

  const restarted = makeStore(userData);
  assert.deepEqual(restarted.listDeletedAttachments('task-restore').map(item => item.id), [saved.id]);
  assert.deepEqual(restarted.listBackupAttachments('task-restore').map(item => ({ id: item.id, deleted: item.deleted })), [{ id: saved.id, deleted: true }]);
  restarted.restoreAttachment(saved.id);
  assert.deepEqual(restarted.listAttachments('task-restore').map(item => item.id), [saved.id]);
  assert.deepEqual(fs.readFileSync(restarted.getAttachmentPath(saved.id)), HTML);
  assert.equal(restarted.getAttachment(saved.id).sha256, saved.sha256);
});

test('工作区归档可安全读取并按原 ID 导入工作台附件，失败时可回滚', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.html');
  const stagedPath = path.join(root, 'staged.html');
  fs.writeFileSync(sourcePath, HTML);
  fs.writeFileSync(stagedPath, HTML);
  const source = await makeStore(path.join(root, 'source-data'))
    .saveAttachment({ taskId: 'task-archive', sourcePath, mimeType: 'text/html' });
  const sourceStore = makeStore(path.join(root, 'source-data'));
  const streamChunks = [];
  for await (const chunk of sourceStore.createReadStream(source.id)) streamChunks.push(chunk);
  assert.deepEqual(Buffer.concat(streamChunks), HTML);

  const targetStore = makeStore(path.join(root, 'target-data'));
  const descriptor = {
    taskId: source.taskId, id: source.id, mimeType: source.mimeType,
    displayName: source.displayName, size: source.size, sha256: source.sha256,
    createdAt: source.createdAt, sourcePath: stagedPath
  };
  assert.equal((await targetStore.importAttachment(descriptor)).imported, true);
  assert.equal((await targetStore.importAttachment(descriptor)).imported, false);
  assert.deepEqual(fs.readFileSync(targetStore.getAttachmentPath(source.id)), HTML);
  await assert.rejects(targetStore.importAttachment({ ...descriptor, id: 'invalid-copy', sha256: '0'.repeat(64) }),
    error => error.code === 'CHECKSUM_MISMATCH');
  assert.equal(targetStore.listAttachments(source.taskId).length, 1);
  assert.equal(targetStore.removeImportedAttachment(source.id), true);
  assert.deepEqual(targetStore.listAttachments(source.taskId), []);

  const deletedStore = makeStore(path.join(root, 'deleted-data'));
  assert.equal((await deletedStore.importAttachment({ ...descriptor, deleted: true })).imported, true);
  assert.equal(deletedStore.listAttachments(source.taskId).length, 0);
  assert.equal(deletedStore.listDeletedAttachments(source.taskId)[0].id, source.id);
  assert.throws(() => deletedStore.getAttachmentPath(source.id), error => error.code === 'INVALID_ATTACHMENT_ID');
  const deletedChunks = [];
  for await (const chunk of deletedStore.createReadStream(source.id, { includeDeleted: true })) deletedChunks.push(chunk);
  assert.deepEqual(Buffer.concat(deletedChunks), HTML);
});

test('读取图片只返回校验过版本的 data URL，文件变更后拒绝继续预览', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const source = path.join(root, 'image.png');
  fs.writeFileSync(source, PNG);
  const store = makeStore(userData);
  const attachment = await store.saveAttachment({ taskId: 'task-image', sourcePath: source, mimeType: 'image/png' });
  const dataUrl = store.readImageDataUrl(attachment.id);
  assert.match(dataUrl, /^data:image\/png;base64,/);
  assert.equal(Buffer.from(dataUrl.split(',')[1], 'base64').compare(PNG), 0);

  fs.chmodSync(store.getAttachmentPath(attachment.id), 0o600);
  fs.writeFileSync(store.getAttachmentPath(attachment.id), Buffer.from('changed image'));
  assert.throws(() => store.readImageDataUrl(attachment.id), error => error.code === 'ATTACHMENT_VERSION_MISMATCH');
});

test('拒绝 MIME/扩展名伪装、路径穿越和超限附件', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const htmlPath = path.join(root, 'fake.png.html');
  const textPath = path.join(root, 'not-html.txt');
  const largeHtmlPath = path.join(root, 'large.html');
  const largePdfPath = path.join(root, 'large.pdf');
  fs.writeFileSync(htmlPath, HTML);
  fs.writeFileSync(textPath, HTML);
  fs.writeFileSync(largeHtmlPath, HTML);
  fs.writeFileSync(largePdfPath, PDF);
  const store = makeStore(path.join(root, 'user-data'), { limits: { maxHtmlBytes: 10, maxImageBytes: 20, maxPdfBytes: 10 } });

  await assert.rejects(store.saveAttachment({ taskId: 'task-1', sourcePath: htmlPath, mimeType: 'image/png' }), error => error.code === 'INVALID_ATTACHMENT');
  await assert.rejects(store.saveAttachment({ taskId: 'task-1', sourcePath: textPath, mimeType: 'text/html' }), error => error.code === 'INVALID_ATTACHMENT');
  await assert.rejects(store.saveAttachment({ taskId: '../escape', sourcePath: textPath, mimeType: 'text/html' }), error => error.code === 'INVALID_TASK_ID');
  await assert.rejects(store.saveAttachment({ taskId: 'task-1', sourcePath: largeHtmlPath, mimeType: 'text/html' }), error => error.code === 'FILE_TOO_LARGE');
  await assert.rejects(store.saveAttachment({ taskId: 'task-1', sourcePath: largePdfPath, mimeType: 'application/pdf' }), error => error.code === 'FILE_TOO_LARGE');
  assert.equal(fs.existsSync(path.join(root, 'escape')), false);
});

test('拒绝 PDF 扩展名与文件签名不匹配', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'not-really.pdf');
  fs.writeFileSync(source, Buffer.from('<html>not a pdf</html>'));
  const store = makeStore(path.join(root, 'user-data'));
  await assert.rejects(store.saveAttachment({ taskId: 'task-1', sourcePath: source, mimeType: 'application/pdf' }), error => error.code === 'INVALID_ATTACHMENT');
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
  assert.match(prefs.preload, /ppt-feedback-preview-preload\.js$/);
  assert.equal(h.sessions[0].options.cache, false);
  assert.match(h.windows[0].loadedFile, /preview-[^/\\]+[\\/]attachment\.html$/);
  assert.match(fs.readFileSync(h.windows[0].loadedFile, 'utf8'), /Content-Security-Policy/);
  assert.equal(opened.status, 'opened');
  assert.equal(opened.attachmentId, attachment.id);
  assert.equal(opened.path, undefined);
});

test('HTML 预览可作为隔离 WebContentsView 嵌入工作台并正确裁切、隐藏和清理', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'user-data');
  const source = path.join(root, 'source.html');
  fs.writeFileSync(source, HTML);
  const store = makeStore(userData);
  const attachment = await store.saveAttachment({ taskId: 'task-embedded', sourcePath: source, mimeType: 'text/html' });
  const h = makePreviewHarness(userData, store);
  const children = [];
  const parentWindow = {
    contentView: {
      addChildView: view => children.push(view),
      removeChildView: view => children.splice(children.indexOf(view), 1)
    },
    getContentSize: () => [400, 300]
  };

  const opened = await h.manager.openPreview({ attachmentId: attachment.id, expectedHash: attachment.sha256, embedded: true, parentWindow });
  const view = h.views[0];
  assert.equal(opened.status, 'opened');
  assert.equal(h.windows.length, 0);
  assert.equal(children[0], view);
  assert.equal(view.options.webPreferences.sandbox, true);
  assert.match(view.options.webPreferences.preload, /ppt-feedback-preview-preload\.js$/);
  assert.match(view.loadedFile, /preview-[^/\\]+[\\/]attachment\.html$/);
  assert.equal(view.visible, false);
  assert.equal(h.manager.setPreviewBounds(attachment.id, { x: -10, y: 20, width: 100, height: 500, visible: true }), true);
  assert.deepEqual(view.bounds, { x: 0, y: 20, width: 90, height: 280 });
  assert.equal(view.visible, true);
  assert.equal(h.manager.setPreviewBounds(attachment.id, { visible: false }), true);
  assert.equal(view.visible, false);
  const target = { kind: 'text', selector: 'body > p', exact: 'safe text', prefix: '', suffix: '' };
  assert.equal(h.manager.acceptSelection({ sender: view.webContents, senderFrame: view.webContents.mainFrame }, target).attachmentId, attachment.id);

  await h.manager.closePreview(attachment.id);
  assert.deepEqual(children, []);
  assert.equal(view.webContents.isDestroyed(), true);
  assert.equal(h.sessions[0].storageCleared, true);
  assert.equal(h.sessions[0].cacheCleared, true);
  assert.equal(fs.existsSync(view.loadedFile), false);

  const reopened = await h.manager.openPreview({ attachmentId: attachment.id, expectedHash: attachment.sha256, embedded: true, parentWindow });
  const destroyedView = h.views[1];
  destroyedView.webContents.destroy();
  await reopened.closed;
  assert.equal(h.sessions[1].storageCleared, true);
  assert.equal(h.sessions[1].cacheCleared, true);
  assert.equal(fs.existsSync(destroyedView.loadedFile), false);
});

test('HTML 预览仅向隔离窗口发送经校验的原文定位目标', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.html');
  fs.writeFileSync(source, HTML);
  const userData = path.join(root, 'user-data');
  const store = makeStore(userData);
  const attachment = await store.saveAttachment({ taskId: 'task-locate', sourcePath: source, mimeType: 'text/html' });
  const h = makePreviewHarness(userData, store);
  const target = { kind: 'text', selector: 'body > p', exact: 'safe text', prefix: '', suffix: '', start: 0, end: 9 };

  await h.manager.openPreview({ attachmentId: attachment.id, target });

  assert.deepEqual(h.sent, [['ppt-feedback:preview-locate', target]]);
  await assert.rejects(h.manager.openPreview({ attachmentId: attachment.id, target: { ...target, start: 9 } }), /定位/);
});

test('HTML 隔离预览只向主工作台返回限长选区并绑定任务与附件版本', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.html');
  fs.writeFileSync(source, HTML);
  const userData = path.join(root, 'user-data');
  const store = makeStore(userData);
  const attachment = await store.saveAttachment({ taskId: 'task-anchor', sourcePath: source, mimeType: 'text/html' });
  const h = makePreviewHarness(userData, store);
  await h.manager.openPreview({ attachmentId: attachment.id });
  const preview = h.windows[0];
  const event = { sender: preview.webContents, senderFrame: preview.webContents.mainFrame };
  const selection = h.manager.acceptSelection(event, {
    kind: 'text', selector: 'main > p:nth-of-type(1)', exact: 'safe text', prefix: 'before ', suffix: ' after', start: 6, end: 15
  });

  assert.deepEqual(selection, {
    taskId: 'task-anchor', attachmentId: attachment.id, contentHash: attachment.sha256,
    target: { kind: 'text', selector: 'main > p:nth-of-type(1)', exact: 'safe text', prefix: 'before ', suffix: ' after', start: 6, end: 15 }
  });
  assert.equal(h.manager.acceptSelection(event, { kind: 'text', selector: 'p', exact: 'forged' })?.target.exact, 'forged');
  assert.equal(h.manager.acceptSelection({ ...event, senderFrame: {} }, { kind: 'text', selector: 'p', exact: 'forged' }), null);
  assert.equal(h.manager.acceptSelection({ ...event, sender: {} }, { kind: 'text', selector: 'p', exact: 'forged' }), null);
  assert.equal(h.manager.acceptSelection({ sender: {}, senderFrame: undefined }, { kind: 'text', selector: 'p', exact: 'forged' }), null);
  assert.equal(h.manager.acceptSelection(event, { kind: 'text', selector: 'p', exact: 'x'.repeat(2001) }), null);
});

test('HTML 预览在打开前校验预期版本及附件副本哈希', async t => {
  const root = makeTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.html');
  fs.writeFileSync(source, HTML);
  const userData = path.join(root, 'user-data');
  const store = makeStore(userData);
  const attachment = await store.saveAttachment({ taskId: 'task-version', sourcePath: source, mimeType: 'text/html' });
  const h = makePreviewHarness(userData, store);

  await assert.rejects(
    h.manager.openPreview({ attachmentId: attachment.id, expectedHash: '0'.repeat(64) }),
    error => error.code === 'ATTACHMENT_VERSION_MISMATCH'
  );
  assert.equal(h.windows.length, 0);

  const storedPath = store.getAttachmentPath(attachment.id);
  fs.chmodSync(storedPath, 0o600);
  fs.writeFileSync(storedPath, Buffer.from('<!doctype html><p>tampered</p>'));
  await assert.rejects(
    h.manager.openPreview({ attachmentId: attachment.id }),
    error => error.code === 'ATTACHMENT_VERSION_MISMATCH'
  );
  assert.equal(h.windows.length, 0);
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
