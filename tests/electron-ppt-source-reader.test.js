const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { createPptSourceReader } = require('../electron/ppt-source-reader.js');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-source-reader-'));
}

function harness() {
  const handlers = new Map();
  const dialogCalls = [];
  let selectedPath = null;
  const dialog = {
    showOpenDialog: async options => {
      dialogCalls.push(options);
      if (!selectedPath) return { canceled: true, filePaths: [] };
      return { canceled: false, filePaths: [selectedPath] };
    }
  };
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const reader = createPptSourceReader({ fs, path, dialog, ipcMain, now: () => '2026-10-20T00:00:00.000Z' });
  const invoke = (channel, ...args) => handlers.get(channel)({}, ...args);
  return { reader, handlers, dialogCalls, setSelectedPath: value => { selectedPath = value; }, invoke };
}

test('选择文件后只能按不透明 sourceId 读取文本并返回统一来源元数据', async t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'notes.md');
  fs.writeFileSync(filePath, '# 研究笔记\n\n来源正文', 'utf8');
  const h = harness();
  h.setSelectedPath(filePath);

  const selected = await h.invoke('ppt-source:select-file');
  assert.equal(selected.kind, 'local-file');
  assert.equal(typeof selected.sourceId, 'string');
  assert.equal(selected.path, undefined);
  const result = await h.invoke('ppt-source:read', { sourceId: selected.sourceId });
  assert.equal(result.status, 'complete');
  assert.equal(result.kind, 'local-file');
  assert.equal(result.title, 'notes.md');
  assert.match(result.content, /研究笔记/);
  assert.equal(result.location.relativePath, 'notes.md');
  assert.equal(result.retrievedAt, '2026-10-20T00:00:00.000Z');
  assert.equal(result.verificationStatus, 'unverified');
  assert.equal(result.license, 'unknown');
  assert.equal(result.processedRange.pages, 1);
  assert.doesNotMatch(JSON.stringify(selected), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('目录授权后只能列举授权根目录内支持的文件，跳过敏感目录和不支持扩展', async t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'guide.html'), '<title>指南</title><p>正文</p>', 'utf8');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=secret', 'utf8');
  fs.writeFileSync(path.join(root, 'image.png'), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(root, 'docs', 'guide.exe'), 'MZ', 'utf8');
  const h = harness();
  h.setSelectedPath(root);

  const selected = await h.invoke('ppt-source:select-directory');
  const listed = await h.invoke('ppt-source:list-directory', { sourceId: selected.sourceId });
  assert.deepEqual(listed.files.map(file => file.relativePath), ['docs/guide.html']);
  assert.ok(listed.skipped.some(item => item.reason === 'sensitive-path'));
  assert.ok(listed.skipped.some(item => item.reason === 'unsupported-extension'));
  assert.equal(listed.files[0].path, undefined);
});

test('选择敏感目录或凭证命名的根目录时拒绝授权', async t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const h = harness();

  for (const directoryName of ['.git', 'node_modules', 'build', 'dist', 'release']) {
    const directoryPath = path.join(root, directoryName);
    fs.mkdirSync(directoryPath);
    h.setSelectedPath(directoryPath);
    await assert.rejects(
      h.invoke('ppt-source:select-directory'),
      error => error.code === 'INVALID_SOURCE'
    );
  }

  const credentialNamedRoot = path.join(root, 'credentials');
  fs.mkdirSync(credentialNamedRoot);
  h.setSelectedPath(credentialNamedRoot);
  await assert.rejects(
    h.invoke('ppt-source:select-directory'),
    error => error.code === 'INVALID_SOURCE'
  );

  const credentialFile = path.join(root, 'credentials.json');
  fs.writeFileSync(credentialFile, '{"token":"secret"}', 'utf8');
  h.setSelectedPath(credentialFile);
  await assert.rejects(
    h.invoke('ppt-source:select-file'),
    error => error.code === 'INVALID_SOURCE'
  );
});

test('读取时拒绝路径穿越、绝对越界、凭证和二进制文件', async t => {
  const root = tempDirectory();
  const outside = tempDirectory();
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'safe.txt'), 'safe', 'utf8');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=secret', 'utf8');
  fs.writeFileSync(path.join(root, 'binary.txt'), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(outside, 'outside.txt'), 'outside', 'utf8');
  const h = harness();
  h.setSelectedPath(root);
  const selected = await h.invoke('ppt-source:select-directory');

  await assert.rejects(
    h.invoke('ppt-source:read', { sourceId: selected.sourceId, relativePath: '../outside.txt' }),
    error => error.code === 'INVALID_SOURCE'
  );
  await assert.rejects(
    h.invoke('ppt-source:read', { sourceId: selected.sourceId, path: path.join(outside, 'outside.txt') }),
    error => error.code === 'INVALID_SOURCE'
  );

  const listed = await h.invoke('ppt-source:list-directory', { sourceId: selected.sourceId });
  assert.equal(listed.files.some(file => file.relativePath === '.env'), false);
  assert.equal(listed.files.some(file => file.relativePath === 'binary.txt'), false);
});

test('缺少解析器的媒体来源返回 unsupported 和明确替代方式', async t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const h = harness();
  for (const extension of ['pdf', 'ppt', 'pptx', 'png', 'mp4']) {
    const filePath = path.join(root, `sample.${extension}`);
    fs.writeFileSync(filePath, 'placeholder', 'utf8');
    h.setSelectedPath(filePath);
    const selected = await h.invoke('ppt-source:select-file');
    const result = await h.invoke('ppt-source:read', { sourceId: selected.sourceId });
    assert.equal(result.status, 'unsupported');
    assert.equal(result.errorCode, 'PARSER_UNAVAILABLE');
    assert.match(result.limitations, /粘贴文本|上传可解析副本/);
  }
});

test('文件大小和页数限制返回稳定错误，HTML 按摘要读取并过滤脚本', async t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'large.txt'), '1234567890', 'utf8');
  fs.writeFileSync(path.join(root, 'page.html'), '<title>页面</title><script>secret()</script><p>可见内容</p>', 'utf8');
  const h = createPptSourceReader({
    fs,
    path,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(root, 'large.txt')] }) },
    ipcMain: { handle() {} },
    limits: { maxBytes: 5, maxPages: 1 },
    now: () => '2026-10-20T00:00:00.000Z'
  });
  await assert.rejects(h.readPptSource({ source: { path: path.join(root, 'large.txt') }, purpose: 'content' }), error => error.code === 'FILE_TOO_LARGE');

  const htmlReader = createPptSourceReader({ fs, path, limits: { maxPages: 1 }, now: () => '2026-10-20T00:00:00.000Z' });
  const result = await htmlReader.readPptSource({ source: { path: path.join(root, 'page.html') }, purpose: 'content', pageRange: { start: 1, end: 1 } });
  assert.equal(result.status, 'complete');
  assert.match(result.content, /可见内容/);
  assert.doesNotMatch(result.content, /secret/);
  await assert.rejects(
    htmlReader.readPptSource({ source: { path: path.join(root, 'page.html') }, pageRange: { start: 2, end: 2 } }),
    error => error.code === 'PAGE_RANGE_EXCEEDED'
  );
});

test('读取支持 AbortSignal，取消后不返回正文', async t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'cancel.txt');
  fs.writeFileSync(filePath, 'should not be returned', 'utf8');
  const reader = createPptSourceReader({ fs, path, now: () => '2026-10-20T00:00:00.000Z' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    reader.readPptSource({ source: { path: filePath }, signal: controller.signal }),
    error => error.code === 'CANCELED'
  );
});

test('preload 只暴露来源选择、列举、读取和取消接口，不暴露任意路径读取', () => {
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
  assert.deepEqual(Object.keys(exposed.api.pptSourceReader), ['selectFile', 'selectDirectory', 'listDirectory', 'read', 'cancel']);
  exposed.api.pptSourceReader.selectFile();
  exposed.api.pptSourceReader.selectDirectory();
  exposed.api.pptSourceReader.listDirectory('directory-1');
  exposed.api.pptSourceReader.read('file-1', { purpose: 'content' });
  exposed.api.pptSourceReader.cancel('request-1');
  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [
    ['ppt-source:select-file'],
    ['ppt-source:select-directory'],
    ['ppt-source:list-directory', { sourceId: 'directory-1' }],
    ['ppt-source:read', { sourceId: 'file-1', purpose: 'content' }],
    ['ppt-source:cancel', { requestId: 'request-1' }]
  ]);
  assert.equal(exposed.api.pptSourceReader.readFile, undefined);
});
