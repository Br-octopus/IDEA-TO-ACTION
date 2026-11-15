const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const yazl = require('yazl');
const { buildSelectedAnnotationPrompt } = require('../prototype/ppt-feedback.js');

const root = path.resolve(__dirname, '..');

test('DOCX/PPTX 通过工作台选择器安全入库并按版本读取原文件', async t => {
  for (const extension of ['pptx', 'docx']) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `office-preview-${extension}-`));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const sourcePath = path.join(directory, `sample.${extension}`);
    const userData = path.join(directory, 'user-data');
    const kind = extension === 'pptx' ? 'pptx' : 'docx';
    const source = await createOfficePackage(kind);
    fs.writeFileSync(sourcePath, source);

    const harness = await createMainHarness(userData, sourcePath);
    const { attachment } = await harness.handlers.get('ppt-feedback:choose-file')(null, { taskId: 'task-office' });
    assert.equal(attachment.kind, kind);
    assert.equal(attachment.taskId, 'task-office');
    assert.equal(attachment.sha256, crypto.createHash('sha256').update(source).digest('hex'));
    assert.deepEqual(fs.readFileSync(sourcePath), source);

    const read = await harness.handlers.get('ppt-feedback:read-office')(null, {
      attachmentId: attachment.id, expectedHash: attachment.sha256
    });
    assert.equal(read.status, 'ok');
    assert.equal(read.attachmentId, attachment.id);
    assert.deepEqual(Buffer.from(read.data), source);
    await assert.rejects(harness.handlers.get('ppt-feedback:read-office')(null, {
      attachmentId: attachment.id, expectedHash: '0'.repeat(64)
    }), error => error.code === 'ATTACHMENT_VERSION_MISMATCH');
  }
});

test('旧版 .doc/.ppt 选择后明确返回不支持且不复制进工作区', async t => {
  for (const extension of ['doc', 'ppt']) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `unsupported-office-${extension}-`));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const sourcePath = path.join(directory, `legacy.${extension}`);
    const source = Buffer.from(`legacy ${extension} fixture`);
    const userData = path.join(directory, 'user-data');
    fs.writeFileSync(sourcePath, source);

    const harness = await createMainHarness(userData, sourcePath);
    const result = await harness.handlers.get('ppt-feedback:choose-file')(null, { taskId: 'task-legacy' });
    assert.equal(result.canceled, false);
    assert.equal(result.status, 'unsupported-preview');
    assert.equal(result.format, extension);
    const listed = await harness.handlers.get('ppt-feedback:list-attachments')(null, { taskId: 'task-legacy' });
    assert.deepEqual(listed.attachments, []);
    assert.deepEqual(fs.readFileSync(sourcePath), source);
  }
});

function createOfficePackage(kind) {
  const entries = kind === 'pptx'
    ? ['[Content_Types].xml', 'ppt/presentation.xml', 'ppt/slides/slide1.xml']
    : ['[Content_Types].xml', 'word/document.xml'];
  const archive = new yazl.ZipFile();
  const chunks = [];
  return new Promise((resolve, reject) => {
    archive.outputStream.on('data', chunk => chunks.push(chunk));
    archive.outputStream.on('error', reject);
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    for (const entry of entries) archive.addBuffer(Buffer.from('<root/>'), entry);
    archive.end();
  });
}

function createMainHarness(userData, sourcePath) {
  const handlers = new Map();
  const listeners = new Map();
  const windows = [];
  const messages = [];
  const app = {
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    getPath: name => name === 'userData' ? userData : path.join(userData, name),
    getAppPath: () => root,
    on() {},
    quit() {}
  };
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.closed = false;
      this.listeners = new Map();
      this.webContents = {
        mainFrame: {},
        on: (name, listener) => this.webContents.listeners.set(name, listener),
        listeners: new Map(),
        send: (...args) => messages.push({ window: this, args }),
        setWindowOpenHandler: listener => { this.windowOpenHandler = listener; }
      };
      windows.push(this);
    }
    on(name, listener) { this.listeners.set(name, listener); }
    isDestroyed() { return this.closed; }
    async loadURL() {}
    async loadFile(filePath) { this.loadedFile = filePath; }
    show() {}
    close() { this.closed = true; this.listeners.get('closed')?.(); }
    destroy() { this.close(); }
  }
  BrowserWindow.getAllWindows = () => windows.filter(window => !window.isDestroyed());
  const session = {
    fromPartition: () => ({
      webRequest: { onBeforeRequest() {}, onHeadersReceived() {} },
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
      async clearStorageData() {},
      async clearCache() {}
    })
  };
  const electron = {
    app, BrowserWindow, session,
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [sourcePath] }),
      showSaveDialog: async () => ({ canceled: true }),
      showMessageBox: async () => ({ response: 0 })
    },
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      on: (channel, handler) => listeners.set(channel, handler)
    },
    safeStorage: { isEncryptionAvailable: () => false }
  };
  const mainPath = path.join(root, 'electron', 'main.js');
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
    console, Buffer, Date, Promise, URL, setTimeout, clearTimeout, crypto: require('node:crypto'),
    process: { env: {}, platform: 'win32', pid: 1, resourcesPath: root },
    __dirname: path.join(root, 'electron'),
    require(request) { return request === 'electron' ? electron : require(request); }
  }, { filename: mainPath });
  return new Promise(resolve => setImmediate(() => resolve({ handlers, listeners, windows, messages })));
}

test('HTML 文字锚点经 Electron IPC 保存、重开、按版本返回原文并进入提示词', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-annotation-main-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'source.html');
  const userData = path.join(directory, 'user-data');
  fs.writeFileSync(sourcePath, '<!doctype html><main><p>safe text</p></main>');

  const first = await createMainHarness(userData, sourcePath);
  const { attachment } = await first.handlers.get('ppt-feedback:choose-file')(null, { taskId: 'task-anchor' });
  const openedPreview = await first.handlers.get('ppt-feedback:open-preview')(null, { attachmentId: attachment.id });
  assert.doesNotThrow(() => structuredClone(openedPreview));
  assert.deepEqual(JSON.parse(JSON.stringify(openedPreview)), { status: 'opened', attachmentId: attachment.id });
  const previewWindow = first.windows.find(window => window.options.show === false);
  const selectionTarget = {
    kind: 'text', selector: 'body > main > p', exact: 'safe text', prefix: '', suffix: '', start: 0, end: 9
  };
  const receiveTarget = first.listeners.get('ppt-feedback:preview-target');
  const beforeSubframeMessage = first.messages.filter(item => item.args[0] === 'ppt-feedback:preview-target').length;
  receiveTarget({ sender: previewWindow.webContents, senderFrame: {} }, selectionTarget);
  assert.equal(first.messages.filter(item => item.args[0] === 'ppt-feedback:preview-target').length, beforeSubframeMessage);
  receiveTarget({ sender: previewWindow.webContents, senderFrame: previewWindow.webContents.mainFrame }, selectionTarget);
  const selection = first.messages.find(item => item.args[0] === 'ppt-feedback:preview-target').args[1];
  assert.deepEqual(JSON.parse(JSON.stringify(selection)), {
    taskId: 'task-anchor', attachmentId: attachment.id, contentHash: attachment.sha256, target: selectionTarget
  });

  const saved = await first.handlers.get('ppt-feedback:save-annotation')(null, {
    ...selection, comment: '把这句改得更直接', category: 'readability', selected: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(saved.annotation.target)), selectionTarget);
  assert.equal(saved.annotation.updatedAt, saved.annotation.createdAt);
  const listed = await first.handlers.get('ppt-feedback:list-annotations')(null, { taskId: 'task-anchor' });
  assert.deepEqual(JSON.parse(JSON.stringify(listed.annotations[0].target)), selectionTarget);
  const prompt = buildSelectedAnnotationPrompt(listed.annotations, attachment);
  assert.match(prompt, /safe text/);
  assert.match(prompt, /把这句改得更直接/);

  const other = await first.handlers.get('ppt-feedback:save-annotation')(null, {
    ...selection, target: { kind: 'element', selector: 'body > main > p', excerpt: 'safe text' }, comment: '另一条独立意见', reassociatedFromId: saved.annotation.id
  });
  assert.equal(other.annotation.reassociatedFromId, saved.annotation.id);
  const edited = await first.handlers.get('ppt-feedback:save-annotation')(null, {
    ...saved.annotation, createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', comment: '更新后的意见'
  });
  assert.equal(edited.annotation.id, saved.annotation.id);
  assert.equal(edited.annotation.createdAt, saved.annotation.createdAt);
  assert.notEqual(edited.annotation.updatedAt, '2000-01-01T00:00:00.000Z');
  const editedList = await first.handlers.get('ppt-feedback:list-annotations')(null, { taskId: 'task-anchor' });
  assert.equal(editedList.annotations.length, 2);
  assert.equal(editedList.annotations.find(item => item.id === other.annotation.id).comment, '另一条独立意见');
  assert.equal(editedList.annotations.find(item => item.id === other.annotation.id).reassociatedFromId, saved.annotation.id);
  assert.equal(editedList.annotations.find(item => item.id === saved.annotation.id).comment, '更新后的意见');
  await first.handlers.get('ppt-feedback:save-annotation')(null, { ...other.annotation, status: 'deleted', selected: false });
  let scopedList = await first.handlers.get('ppt-feedback:list-annotations')(null, { taskId: 'task-anchor' });
  assert.equal(scopedList.annotations.find(item => item.id === other.annotation.id).status, 'deleted');
  assert.equal(scopedList.annotations.find(item => item.id === saved.annotation.id).status, 'active');
  await first.handlers.get('ppt-feedback:save-annotation')(null, { ...other.annotation, status: 'active', selected: false });
  scopedList = await first.handlers.get('ppt-feedback:list-annotations')(null, { taskId: 'task-anchor' });
  assert.equal(scopedList.annotations.find(item => item.id === other.annotation.id).status, 'active');
  assert.equal(scopedList.annotations.find(item => item.id === saved.annotation.id).comment, '更新后的意见');
  await assert.rejects(first.handlers.get('ppt-feedback:save-annotation')(null, {
    ...selection, id: 'note-self', reassociatedFromId: 'note-self', comment: '无效自引用'
  }), error => error.code === 'INVALID_ANNOTATION');
  await assert.rejects(first.handlers.get('ppt-feedback:save-annotation')(null, {
    ...selection, reassociatedFromId: 'missing-source-note', comment: '悬空来源'
  }), error => error.code === 'INVALID_ANNOTATION');

  await first.handlers.get('ppt-feedback:close-preview')(null, { attachmentId: attachment.id });
  const reopened = await createMainHarness(userData, sourcePath);
  const restored = await reopened.handlers.get('ppt-feedback:list-annotations')(null, { taskId: 'task-anchor' });
  assert.deepEqual(JSON.parse(JSON.stringify(restored.annotations[0].target)), selectionTarget);
  assert.equal(restored.annotations.find(item => item.id === saved.annotation.id).selected, true);
  await assert.rejects(
    reopened.handlers.get('ppt-feedback:open-preview')(null, {
      attachmentId: attachment.id, target: selectionTarget, expectedHash: '0'.repeat(64)
    }),
    error => error.code === 'ATTACHMENT_VERSION_MISMATCH'
  );
  await reopened.handlers.get('ppt-feedback:open-preview')(null, {
    attachmentId: attachment.id, target: restored.annotations[0].target, expectedHash: attachment.sha256
  });
  const returnedPreview = reopened.windows.find(window => window.options.show === false);
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.messages.find(item => item.window === returnedPreview).args)), [
    'ppt-feedback:preview-locate', selectionTarget
  ]);
  await reopened.handlers.get('ppt-feedback:close-preview')(null, { attachmentId: attachment.id });
});

test('网页静态快照经 IPC 保存，来源版本随 HTML 批注、提示词定位和重启恢复', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-web-snapshot-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'source.html');
  fs.writeFileSync(sourcePath, '<!doctype html><p>local fixture</p>');
  const userData = path.join(directory, 'user-data');
  const first = await createMainHarness(userData, sourcePath);
  const pageHtml = '<!doctype html><html><head><style>.article{max-width:40rem}</style><script>window.pwned=true</script></head><body><main class="article"><p>需要批注的正文</p></main></body></html>';
  const sourceContentHash = `sha256:${crypto.createHash('sha256').update(Buffer.from(pageHtml)).digest('hex')}`;
  const snapshot = {
    title: '<资料 & 页面>', finalUrl: 'https://example.com/articles/1?token=private#section',
    fetchedAt: '2026-11-12T01:02:03.000Z', contentHash: sourceContentHash,
    html: pageHtml, text: '需要批注的正文', incomplete: false
  };
  await assert.rejects(first.handlers.get('ppt-feedback:save-web-snapshot')(null, {
    taskId: 'task-web', snapshot: { ...snapshot, html: `${pageHtml} ` }
  }), error => error.code === 'CHECKSUM_MISMATCH');
  const saved = await first.handlers.get('ppt-feedback:save-web-snapshot')(null, { taskId: 'task-web', snapshot });
  assert.equal(saved.status, 'ok');
  assert.equal(saved.attachment.kind, 'html');
  assert.match(saved.attachment.displayName, new RegExp(`2026-11-12 · ${sourceContentHash.slice(-8)}\.html$`));
  const htmlPath = path.join(userData, 'ppt-feedback', 'task-web', saved.attachment.id, 'attachment.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const sourceMarker = html.match(/^<!--forward-step-source:([A-Za-z0-9+/=]+)-->/);
  assert.ok(sourceMarker);
  assert.deepEqual(JSON.parse(Buffer.from(sourceMarker[1], 'base64').toString('utf8')), {
    url: 'https://example.com/articles/1', fetchedAt: snapshot.fetchedAt, contentHash: sourceContentHash, incomplete: false
  });
  assert.match(html, /class="article"/);
  assert.match(html, /<script>window\.pwned=true<\/script>/i);
  assert.doesNotMatch(html, /token=private|#section/);

  await first.handlers.get('ppt-feedback:open-preview')(null, { attachmentId: saved.attachment.id });
  const preview = first.windows.find(window => window.options.show === false);
  const previewHtml = fs.readFileSync(preview.loadedFile, 'utf8');
  assert.doesNotMatch(previewHtml, /<iframe/);
  assert.match(previewHtml, /frame-src 'none'/);
  assert.match(previewHtml, /id="forward-step-preview-info"/);
  assert.match(previewHtml, new RegExp(sourceContentHash.slice(7)));
  assert.doesNotMatch(previewHtml, /window\.pwned/);
  const payload = previewHtml.match(/<textarea[^>]*id="forward-step-preview-source"[^>]*>([A-Za-z0-9+/=]+)<\/textarea>/)?.[1];
  assert.equal(Buffer.from(payload, 'base64').toString('utf8'), pageHtml);
  first.listeners.get('ppt-feedback:preview-target')(
    { sender: preview.webContents, senderFrame: preview.webContents.mainFrame },
    { kind: 'text', selector: 'body > main > p:nth-of-type(2)', exact: '需要批注的正文', prefix: '', suffix: '', start: 0, end: 7 }
  );
  const selection = first.messages.find(item => item.args[0] === 'ppt-feedback:preview-target').args[1];
  assert.deepEqual(JSON.parse(JSON.stringify(selection.target.source)), {
    url: 'https://example.com/articles/1', fetchedAt: snapshot.fetchedAt, contentHash: sourceContentHash
  });
  const annotation = await first.handlers.get('ppt-feedback:save-annotation')(null, {
    ...selection, comment: '保留网页来源并调整措辞', selected: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(annotation.annotation.target.source)), JSON.parse(JSON.stringify(selection.target.source)));

  first.listeners.get('ppt-feedback:preview-target')(
    { sender: preview.webContents, senderFrame: preview.webContents.mainFrame },
    { kind: 'element', selector: 'body > main.article > p', excerpt: '需要批注的正文' }
  );
  const elementSelection = first.messages.filter(item => item.args[0] === 'ppt-feedback:preview-target').at(-1).args[1];
  assert.equal(elementSelection.target.kind, 'element');
  assert.equal(elementSelection.target.excerpt, '需要批注的正文');
  assert.deepEqual(JSON.parse(JSON.stringify(elementSelection.target.source)), JSON.parse(JSON.stringify(selection.target.source)));
  const elementAnnotation = await first.handlers.get('ppt-feedback:save-annotation')(null, {
    ...elementSelection, comment: '保留网页元素来源并检查此段', selected: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(elementAnnotation.annotation.target.source)), JSON.parse(JSON.stringify(selection.target.source)));
  await first.handlers.get('ppt-feedback:close-preview')(null, { attachmentId: saved.attachment.id });

  const reopened = await createMainHarness(userData, sourcePath);
  const restored = await reopened.handlers.get('ppt-feedback:list-annotations')(null, { taskId: 'task-web' });
  assert.deepEqual(JSON.parse(JSON.stringify(restored.annotations[0].target.source)), JSON.parse(JSON.stringify(selection.target.source)));
  const restoredElement = restored.annotations.find(item => item.target.kind === 'element');
  assert.ok(restoredElement);
  assert.deepEqual(JSON.parse(JSON.stringify(restoredElement.target.source)), JSON.parse(JSON.stringify(selection.target.source)));
  await reopened.handlers.get('ppt-feedback:open-preview')(null, {
    attachmentId: saved.attachment.id, target: restored.annotations[0].target, expectedHash: saved.attachment.sha256
  });
  const reopenedPreview = reopened.windows.find(window => window.options.show === false);
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.messages.find(item => item.window === reopenedPreview).args[1].source)),
    JSON.parse(JSON.stringify(selection.target.source)));
  await reopened.handlers.get('ppt-feedback:close-preview')(null, { attachmentId: saved.attachment.id });
  await reopened.handlers.get('ppt-feedback:open-preview')(null, {
    attachmentId: saved.attachment.id, target: restoredElement.target, expectedHash: saved.attachment.sha256
  });
  const reopenedElementPreview = reopened.windows.find(window => window.options.show === false);
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.messages.find(item => item.window === reopenedElementPreview).args[1].source)),
    JSON.parse(JSON.stringify(selection.target.source)));
  await reopened.handlers.get('ppt-feedback:close-preview')(null, { attachmentId: saved.attachment.id });
});

test('箭头和画笔定位经主进程校验后独立保存并重开恢复', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-annotation-drawing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'source.html');
  fs.writeFileSync(sourcePath, '<!doctype html><main>drawing test</main>');
  const harness = await createMainHarness(path.join(directory, 'user-data'), sourcePath);
  const { attachment } = await harness.handlers.get('ppt-feedback:choose-file')(null, { taskId: 'task-drawing' });
  const targets = [
    { kind: 'arrow', x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 },
    { kind: 'path', points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }, { x: 0.7, y: 0.6 }] }
  ];
  await assert.rejects(
    harness.handlers.get('ppt-feedback:save-annotation')(null, {
      taskId: 'task-drawing', attachmentId: attachment.id, contentHash: attachment.sha256,
      target: { kind: 'path', points: Array.from({ length: 129 }, () => ({ x: 0.5, y: 0.5 })) }, comment: '超长笔迹'
    }),
    error => error.code === 'INVALID_ANNOTATION'
  );
  for (const [index, target] of targets.entries()) {
    await harness.handlers.get('ppt-feedback:save-annotation')(null, {
      taskId: 'task-drawing', attachmentId: attachment.id, contentHash: attachment.sha256,
      target, comment: `批注 ${index + 1}`, selected: true
    });
  }
  const reopened = await createMainHarness(path.join(directory, 'user-data'), sourcePath);
  const listed = await reopened.handlers.get('ppt-feedback:list-annotations')(null, { taskId: 'task-drawing' });
  assert.deepEqual(JSON.parse(JSON.stringify(listed.annotations.map(item => item.target))), targets);
});
