const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');
const { createSocialAttachmentStore, MAX_ATTACHMENT_BYTES } = require('../electron/social-attachment-store');

const root = path.resolve(__dirname, '..');
const mainPath = path.join(root, 'electron', 'main.js');
const preloadPath = path.join(root, 'electron', 'preload.js');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'social-attachments-'));
}

function loadPreload() {
  let exposed;
  const invocations = [];
  const context = {
    Object,
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name, api) => { exposed = { name, api }; } },
        ipcRenderer: { invoke: (...args) => { invocations.push(args); return Promise.resolve(); } }
      };
    }
  };
  vm.runInNewContext(fs.readFileSync(preloadPath, 'utf8'), context, { filename: preloadPath });
  return { ...exposed, invocations };
}

function loadMain() {
  const handlers = new Map();
  const windows = [];
  const executedScripts = [];
  const appEvents = new Map();
  const userData = tempDirectory();
  const app = {
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    getPath: name => name === 'documents' ? userData : userData,
    getAppPath: () => root,
    on: (name, handler) => appEvents.set(name, handler),
    quit() {}
  };
  class BrowserWindow {
    constructor(options = {}) {
      this.options = options;
      this.webContents = { executeJavaScript: async source => {
        executedScripts.push(source);
        return { supported: true, ready: true, items: [] };
      } };
      windows.push(this);
    }
    on() {}
    isDestroyed() { return false; }
    async loadURL(url) { this.url = url; }
    close() {}
  }
  BrowserWindow.getAllWindows = () => [];
  const electron = {
    app,
    BrowserWindow,
    dialog: { showMessageBox: async () => {}, showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() },
    session: { fromPartition: partition => ({ partition, clearStorageData: async () => {}, clearCache: async () => {} }) }
  };
  const localRequire = createRequire(mainPath);
  const context = {
    console: { error() {} }, __dirname: path.join(root, 'electron'), Buffer, Date, Promise, URL,
    setTimeout, clearTimeout, process: { env: {}, platform: 'win32', pid: 17 },
    require: request => request === 'electron' ? electron : localRequire(request)
  };
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), context, { filename: mainPath });
  return new Promise(resolve => setImmediate(() => resolve({ handlers, windows, executedScripts, userData, appEvents })));
}

test('preload 只导出固定 social/research API，调用映射到命名 IPC 通道', async () => {
  const { name, api, invocations } = loadPreload();
  assert.equal(name, 'desktopApi');
  assert.deepEqual(Object.keys(api.social), ['listPlatforms', 'getStatus', 'openLogin', 'check', 'search', 'fetchDetail', 'captureEvidence', 'close', 'clearProfile']);
  assert.deepEqual(Object.keys(api.research), ['saveAttachment', 'readAttachment', 'deleteAttachment']);
  assert.equal(api.ipcRenderer, undefined);
  assert.equal(api.readFile, undefined);
  api.social.listPlatforms();
  api.social.search('reddit', { query: 'coffee', profileId: 'primary' });
  api.research.readAttachment('task_0123456789abcdef0123456789abcdef.txt');
  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [
    ['social:list-platforms'], ['social:search', 'reddit', { query: 'coffee', profileId: 'primary' }],
    ['research:read-attachment', 'task_0123456789abcdef0123456789abcdef.txt']
  ]);
});

test('IPC 注册完整白名单，校验平台和 shape，凭证不接收也不返回', async t => {
  const harness = await loadMain();
  t.after(() => fs.rmSync(harness.userData, { recursive: true, force: true }));
  const expected = [
    'social:list-platforms', 'social:get-status', 'social:open-login', 'social:check', 'social:search',
    'social:fetch-detail', 'social:capture-evidence', 'social:close', 'social:clear-profile',
    'research:save-attachment', 'research:read-attachment', 'research:delete-attachment'
  ];
  for (const channel of expected) assert.equal(harness.handlers.has(channel), true, channel);

  const invoke = (channel, ...args) => harness.handlers.get(channel)({}, ...args);
  assert.equal((await invoke('social:get-status', 'not-real')).code, 'UNSUPPORTED_PLATFORM');
  assert.equal((await invoke('social:open-login', 'reddit', '../escape')).code, 'INVALID_REQUEST');
  assert.equal((await invoke('social:search', 'reddit', { query: 'x', profileId: 'p', endpoint: 'https://attacker.invalid' })).code, 'INVALID_REQUEST');
  assert.equal((await invoke('social:search', 'reddit', { query: 'x', profileId: 'p', apiKey: 'secret' })).code, 'INVALID_REQUEST');
  const forcedApi = await invoke('social:search', 'reddit', { query: 'coffee', profileId: 'p', mode: 'api' });
  assert.deepEqual(JSON.parse(JSON.stringify(forcedApi)), { status: 'error', code: 'NOT_CONFIGURED', message: '该平台 API 尚未安全配置。' });
  assert.doesNotMatch(JSON.stringify(forcedApi), /secret|key|header|endpoint/i);
  const login = await invoke('social:open-login', 'reddit', 'p');
  assert.equal(login.status, 'ready');
  assert.equal(harness.windows.length, 2); // 一个主窗口和一个由主进程管理的可视平台窗口。
  const autoResult = await invoke('social:search', 'reddit', { query: 'coffee', profileId: 'p', mode: 'auto' });
  assert.equal(autoResult.status, 'ok');
  assert.equal(autoResult.platform, 'reddit');
  assert.ok(harness.executedScripts.some(source => source.includes('document.querySelectorAll')));
  assert.ok(harness.executedScripts.every(source => !source.includes('secret')));
  const secondLogin = await invoke('social:open-login', 'reddit', 'second');
  assert.equal(secondLogin.status, 'ready');
  const statuses = await invoke('social:get-status', 'reddit');
  assert.deepEqual(JSON.parse(JSON.stringify(statuses.profiles.map(item => item.profileId).sort())), ['p', 'second']);
  await invoke('social:close', 'reddit', 'second');
  assert.equal((await invoke('social:get-status', 'reddit')).profiles.find(item => item.profileId === 'p').status, 'ready');
  const blocked = await invoke('social:search', 'youtube', { query: 'coffee', profileId: 'p', mode: 'browser', script: 'alert(1)' });
  assert.equal(blocked.code, 'INVALID_REQUEST');
});

test('附件正常保存、读取和删除，按 taskId 分隔目录', t => {
  const userData = tempDirectory();
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const store = createSocialAttachmentStore({ userDataPath: userData, createId: () => 'a'.repeat(32), now: () => '2026-10-19T00:00:00.000Z' });
  const saved = store.save({ taskId: 'task-one', content: Buffer.from('evidence'), mimeType: 'text/plain', sourceResultId: 'result-1' });
  assert.deepEqual(saved, {
    id: `task-one_${'a'.repeat(32)}.txt`, type: 'text/plain', size: 8,
    sourceResultId: 'result-1', relativePath: `task-one/task-one_${'a'.repeat(32)}.txt`, savedAt: '2026-10-19T00:00:00.000Z'
  });
  assert.equal(store.read(saved.id).toString(), 'evidence');
  assert.deepEqual(store.delete(saved.id), { id: saved.id, deleted: true });
  assert.throws(() => store.read(saved.id));
  const other = createSocialAttachmentStore({ userDataPath: userData, createId: () => 'b'.repeat(32) });
  const second = other.save({ taskId: 'task-two', content: Buffer.from('other'), mimeType: 'text/plain' });
  assert.equal(fs.existsSync(path.join(userData, 'research-attachments', 'task-one', second.id)), false);
});

test('附件拒绝 traversal、绝对路径、非法 ID、超限内容和非白名单 MIME', t => {
  const userData = tempDirectory();
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const store = createSocialAttachmentStore({ userDataPath: userData });
  for (const taskId of ['../escape', '..', 'C:\\temp', '/tmp/escape']) {
    assert.throws(() => store.save({ taskId, content: Buffer.from('x'), mimeType: 'text/plain' }));
  }
  for (const id of ['../outside', '/etc/passwd', 'task_../../secret.txt', 'task_' + 'a'.repeat(32) + '.exe']) {
    assert.throws(() => store.read(id));
    assert.throws(() => store.delete(id));
  }
  assert.throws(() => store.save({ taskId: 'task', content: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), mimeType: 'text/plain' }), /大小/);
  assert.throws(() => store.save({ taskId: 'task', content: Buffer.from('x'), mimeType: 'text/html' }), /不受支持/);
  assert.throws(() => store.save({ taskId: 'task', content: '!!!', encoding: 'base64', mimeType: 'text/plain' }));
});

test('附件目录或文件符号链接不能跳出存储根目录', t => {
  const userData = tempDirectory();
  const outside = tempDirectory();
  t.after(() => { fs.rmSync(userData, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  const store = createSocialAttachmentStore({ userDataPath: userData });
  const attachmentRoot = path.join(userData, 'research-attachments');
  fs.mkdirSync(attachmentRoot, { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(attachmentRoot, 'linked-task'), 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) return t.skip(`当前环境无法创建符号链接：${error.code}`);
    throw error;
  }
  assert.throws(() => store.save({ taskId: 'linked-task', content: Buffer.from('x'), mimeType: 'text/plain' }));

  fs.mkdirSync(path.join(attachmentRoot, 'task'));
  const id = `task_${'c'.repeat(32)}.txt`;
  try {
    fs.symlinkSync(path.join(outside, 'secret'), path.join(attachmentRoot, 'task', id));
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) return t.skip(`当前环境无法创建文件符号链接：${error.code}`);
    throw error;
  }
  assert.throws(() => store.read(id));
  assert.throws(() => store.delete(id));
});
