const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { exportWorkspaceArchive } = require('../electron/workspace-backup-archive');
const test = require('node:test');
const vm = require('node:vm');
const { createSocialAttachmentStore, MAX_ATTACHMENT_BYTES } = require('../electron/social-attachment-store');
const socialApiClient = require('../server/social-api-client');

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

function loadMain({ createSocialApiClient = socialApiClient.createSocialApiClient, openDialogResult = { canceled: true, filePaths: [] } } = {}) {
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
      this.webContents = { getURL: () => this.url || '', executeJavaScript: async source => {
        executedScripts.push(source);
        return { supported: true, ready: true, empty: true, items: [] };
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
    dialog: { showMessageBox: async () => {}, showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => openDialogResult },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() },
    session: { fromPartition: partition => ({ partition, clearStorageData: async () => {}, clearCache: async () => {} }) }
  };
  const localRequire = createRequire(mainPath);
  const context = {
    console: { error() {} }, __dirname: path.join(root, 'electron'), Buffer, Date, Promise, URL,
    setTimeout, clearTimeout, process: { env: {}, platform: 'win32', pid: 17 },
    require: request => {
      if (request === 'electron') return electron;
      if (path.resolve(request) === path.join(root, 'server', 'social-api-client.js')) {
        return { ...socialApiClient, createSocialApiClient };
      }
      return localRequire(request);
    }
  };
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), context, { filename: mainPath });
  return new Promise(resolve => setImmediate(() => resolve({ handlers, windows, executedScripts, userData, appEvents, context })));
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
  api.socialSource.beginResearchOperation();
  api.socialSource.endResearchOperation('00000000-0000-4000-8000-000000000001');
  api.socialSource.listVersions();
  api.socialSource.prepareVersion('mediacrawler-lite', '1.2.0');
  api.socialSource.activateVersion('mediacrawler-lite', '1.2.0');
  api.socialSource.rollbackVersion('mediacrawler-lite');
  api.socialSource.cleanupVersions('mediacrawler-lite');
  api.socialSource.uninstall('mediacrawler-lite');
  api.research.readAttachment('task_0123456789abcdef0123456789abcdef.txt');
  api.commitBackupImport('stage-id', ['task_0123456789abcdef0123456789abcdef.txt'], ['task_1123456789abcdef0123456789abcdef.txt']);
  api.recoverBackupImports(['task_0123456789abcdef0123456789abcdef.txt']);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [
    ['social:list-platforms'], ['social:search', 'reddit', { query: 'coffee', profileId: 'primary' }],
    ['social-source:research:begin'],
    ['social-source:research:end', { leaseId: '00000000-0000-4000-8000-000000000001' }],
    ['social-source:versions:list'],
    ['social-source:version:prepare', { sourceId: 'mediacrawler-lite', versionId: '1.2.0' }],
    ['social-source:version:activate', { sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true }],
    ['social-source:version:rollback', { sourceId: 'mediacrawler-lite', confirmed: true }],
    ['social-source:version:cleanup', { sourceId: 'mediacrawler-lite', confirmed: true }],
    ['social-source:uninstall', { sourceId: 'mediacrawler-lite', confirmed: true }],
    ['research:read-attachment', 'task_0123456789abcdef0123456789abcdef.txt'],
    ['backup:commit-import', {
      stageId: 'stage-id', attachmentIds: ['task_0123456789abcdef0123456789abcdef.txt'],
      targetAttachmentIds: ['task_1123456789abcdef0123456789abcdef.txt']
    }],
    ['backup:recover-imports', ['task_0123456789abcdef0123456789abcdef.txt']]
  ]);
});

test('IPC 注册完整白名单，校验平台和 shape，凭证不接收也不返回', async t => {
  const harness = await loadMain();
  t.after(() => fs.rmSync(harness.userData, { recursive: true, force: true }));
  const expected = [
    'backup:commit-import', 'backup:discard-import', 'backup:finalize-import', 'backup:rollback-import', 'backup:recover-imports',
    'social:list-platforms', 'social:get-status', 'social:open-login', 'social:check', 'social:search',
    'social:fetch-detail', 'social:capture-evidence', 'social:close', 'social:clear-profile',
    'social-source:research:begin', 'social-source:research:end',
    'social-source:versions:list', 'social-source:version:prepare', 'social-source:version:activate',
    'social-source:version:rollback', 'social-source:version:cleanup', 'social-source:uninstall',
    'research:save-attachment', 'research:read-attachment', 'research:delete-attachment'
  ];
  for (const channel of expected) assert.equal(harness.handlers.has(channel), true, channel);

  const invoke = (channel, ...args) => harness.handlers.get(channel)({}, ...args);
  assert.deepEqual(JSON.parse(JSON.stringify(await invoke('social-source:versions:list'))), {
    status: 'ok', sourceId: 'mediacrawler-lite', activeVersion: '1.1.0', previousVersion: null,
    candidates: [], cleanupAvailable: false, retainedPreviousVersions: 1
  });
  for (const payload of [
    { sourceId: 'mediacrawler-lite', versionId: '1.2.0', path: 'C:/outside' },
    { sourceId: 'mediacrawler-lite', versionId: '1.2.0', command: 'python' },
    { sourceId: 'mediacrawler-lite', versionId: '1.2.0', url: 'https://example.invalid' },
    { sourceId: 'mediacrawler-lite', versionId: '1.2.0', sha256: 'a'.repeat(64) },
    { sourceId: 'mediacrawler-lite', versionId: '../escape' }
  ]) assert.equal((await invoke('social-source:version:prepare', payload)).code, 'INVALID_REQUEST');
  assert.equal((await invoke('social-source:version:cleanup', { sourceId: 'mediacrawler-lite', confirmed: false })).code, 'INVALID_REQUEST');
  const platformDefinitions = await invoke('social:list-platforms');
  for (const platform of ['xiaohongshu', 'bilibili', 'weibo', 'zhihu']) {
    const definition = platformDefinitions.find(item => item.platform === platform);
    assert.equal(definition.browserSearchRegistered, true, platform);
    assert.equal(definition.supportsSearch, true, platform);
    assert.equal(definition.searchVerified, false, platform);
  }
  assert.equal((await invoke('social:get-status', 'not-real')).code, 'UNSUPPORTED_PLATFORM');
  assert.equal((await invoke('social:open-login', 'reddit', '../escape')).code, 'INVALID_REQUEST');
  for (const channel of ['social:fetch-detail', 'social:capture-evidence']) {
    const validPayload = { profileId: 'p', resultId: 'result-1', url: 'https://www.reddit.com/r/test/comments/123/example/' };
    for (const payload of [
      { ...validPayload, profileId: '../escape' },
      { ...validPayload, resultId: '' },
      { ...validPayload, resultId: ' '.repeat(513) },
      { ...validPayload, resultId: 'x'.repeat(513) },
      { ...validPayload, url: 'javascript:alert(1)' },
      { ...validPayload, url: 'file:///etc/passwd' },
      { ...validPayload, url: 'https://reddit.com.attacker.invalid/post' },
      { ...validPayload, url: 'https://attacker.invalid/reddit.com/post' },
      { ...validPayload, url: 'https://evil.reddit.com/r/test/' },
      { ...validPayload, url: 'https://old.reddit.com/r/test/' },
      { ...validPayload, url: 'https://user:pass@reddit.com/post' },
      { ...validPayload, url: 'https://reddit.com/' + 'x'.repeat(2048) }
    ]) {
      assert.equal((await invoke(channel, 'reddit', payload)).code, 'INVALID_REQUEST', `${channel}: ${payload.url}`);
    }
    const validPost = await invoke(channel, 'reddit', validPayload);
    assert.equal(validPost.status, 'unsupported');
    const subredditListing = await invoke(channel, 'reddit', { ...validPayload, url: 'https://reddit.com/r/test/' });
    assert.equal(subredditListing.status, 'error');
    assert.equal(subredditListing.code, 'INVALID_REQUEST');
  }
  assert.equal((await invoke('social:search', 'reddit', { query: 'x', profileId: 'p', endpoint: 'https://attacker.invalid' })).code, 'INVALID_REQUEST');
  assert.equal((await invoke('social:search', 'reddit', { query: 'x', profileId: 'p', apiKey: 'secret' })).code, 'INVALID_REQUEST');
  for (const timeoutMs of [0, -1, 1.5, 600001, '10']) {
    assert.equal((await invoke('social:search', 'reddit', { query: 'x', profileId: 'p', timeoutMs })).code, 'INVALID_REQUEST');
  }
  const forcedApi = await invoke('social:search', 'reddit', { query: 'coffee', profileId: 'p', mode: 'api' });
  assert.deepEqual(JSON.parse(JSON.stringify(forcedApi)), { status: 'error', code: 'NOT_CONFIGURED', message: '该平台 API 尚未安全配置。' });
  const limitedApi = harness.context.socialError({ code: 'SOCIAL_API_RATE_LIMITED' });
  assert.equal(limitedApi.code, 'SOCIAL_API_RATE_LIMITED');
  assert.match(limitedApi.message, /限流/);
  assert.doesNotMatch(JSON.stringify(forcedApi), /secret|key|header|endpoint/i);
  const login = await invoke('social:open-login', 'reddit', 'p');
  assert.equal(login.status, 'ok');
  assert.equal(harness.windows.length, 2); // 一个主窗口和一个由主进程管理的可视平台窗口。
  const autoResult = await invoke('social:search', 'reddit', { query: 'coffee', profileId: 'p', mode: 'auto' });
  assert.equal(autoResult.status, 'ok');
  assert.equal(autoResult.platform, 'reddit');
  assert.ok(harness.executedScripts.some(source => source.includes('document.querySelectorAll')));
  assert.ok(harness.executedScripts.every(source => !source.includes('secret')));
  const secondLogin = await invoke('social:open-login', 'reddit', 'second');
  assert.equal(secondLogin.status, 'ok');
  const statuses = await invoke('social:get-status', 'reddit');
  assert.deepEqual(JSON.parse(JSON.stringify(statuses.profiles.map(item => item.profileId).sort())), ['p', 'second']);
  await invoke('social:clear-profile', 'reddit', 'p');
  const afterClear = await invoke('social:get-status', 'reddit');
  assert.deepEqual(JSON.parse(JSON.stringify(afterClear.profiles.map(item => item.profileId))), ['second']);
  assert.equal(afterClear.profiles[0].status, 'ready');
  const secondCheck = await invoke('social:check', 'reddit', { profileId: 'second', timeoutMs: 25 });
  assert.equal(secondCheck.status, 'ok');
  assert.equal(secondCheck.platform, 'reddit');
  assert.equal(secondCheck.ready, true);
  assert.match(secondCheck.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  const blocked = await invoke('social:search', 'youtube', { query: 'coffee', profileId: 'p', mode: 'browser', script: 'alert(1)' });
  assert.equal(blocked.code, 'INVALID_REQUEST');
});

test('备份恢复清理孤立 UUID 暂存目录并保留非 UUID 目录', async t => {
  const harness = await loadMain();
  t.after(() => fs.rmSync(harness.userData, { recursive: true, force: true }));
  const stagingRoot = path.join(harness.userData, 'workspace-backup-import-staging');
  const orphanId = '11111111-2222-4333-8444-555555555555';
  const orphanDirectory = path.join(stagingRoot, orphanId);
  const unrelatedDirectory = path.join(stagingRoot, 'keep-me');
  fs.mkdirSync(orphanDirectory, { recursive: true });
  fs.writeFileSync(path.join(orphanDirectory, 'partial.txt'), 'partial');
  fs.mkdirSync(unrelatedDirectory);

  const recover = harness.handlers.get('backup:recover-imports');
  const result = await recover({}, []);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'ok', recovered: 0 });
  assert.equal(fs.existsSync(orphanDirectory), false);
  assert.equal(fs.existsSync(unrelatedDirectory), true);
});

test('备份导入 IPC 将源附件写入重映射目标 ID，回滚仅删除事务目标文件', async t => {
  const userData = tempDirectory();
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const sourceId = `research-task_${'a'.repeat(32)}.txt`;
  const targetId = `research-task_${'b'.repeat(32)}.txt`;
  const attachmentPath = path.join(userData, 'source.txt');
  const archivePath = path.join(userData, 'backup.zip');
  const content = Buffer.from('saved research evidence');
  fs.writeFileSync(attachmentPath, content);
  const output = fs.createWriteStream(archivePath);
  await exportWorkspaceArchive({
    output,
    workspace: {
      format: 'forward-step-workspace', scope: 'workspace',
      data: { researchAttachments: [{ id: sourceId, type: 'text/plain', size: content.length }] }
    },
    attachments: [{
      id: sourceId, taskId: 'research-task', type: 'text/plain', size: content.length, path: attachmentPath
    }]
  });
  const harness = await loadMain({ openDialogResult: { canceled: false, filePaths: [archivePath] } });
  const invoke = (channel, ...args) => harness.handlers.get(channel)({}, ...args);
  const staged = await invoke('backup:import');
  assert.equal(staged.format, 'workspace-archive');

  const committed = await invoke('backup:commit-import', {
    stageId: staged.stageId, attachmentIds: [sourceId], targetAttachmentIds: [targetId]
  });
  const store = createSocialAttachmentStore({ userDataPath: harness.userData });
  assert.equal(store.read(targetId).toString(), content.toString());
  assert.equal(store.has(sourceId), false);

  const rolledBack = await invoke('backup:rollback-import', committed.transactionId);
  assert.equal(rolledBack.rolledBack, true);
  assert.equal(store.has(targetId), false);
});

test('备份恢复按工作区附件引用清理未提交事务并保留已提交附件', async t => {
  const harness = await loadMain();
  t.after(() => fs.rmSync(harness.userData, { recursive: true, force: true }));
  const store = createSocialAttachmentStore({ userDataPath: harness.userData });
  const unreferenced = store.save({ taskId: 'task-recovery', content: Buffer.from('rollback'), mimeType: 'text/plain' });
  const referenced = store.save({ taskId: 'task-recovery', content: Buffer.from('committed'), mimeType: 'text/plain' });
  const transactionRoot = path.join(harness.userData, 'workspace-backup-transactions');
  fs.mkdirSync(transactionRoot, { recursive: true });
  const writeJournal = (transactionId, attachmentId) => fs.writeFileSync(
    path.join(transactionRoot, `${transactionId}.json`),
    JSON.stringify({ version: 1, transactionId, stageId: '11111111-2222-4333-8444-555555555555', attachmentIds: [attachmentId] })
  );
  writeJournal('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', unreferenced.id);
  writeJournal('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', referenced.id);

  const recovered = await harness.handlers.get('backup:recover-imports')({}, [referenced.id]);

  assert.equal(recovered.recovered, 2);
  assert.equal(store.has(unreferenced.id), false);
  assert.equal(store.has(referenced.id), true);
  assert.deepEqual(fs.readdirSync(transactionRoot), []);
});

test('备份附件安装中途失败时回滚此前已写入的附件和事务日志', async t => {
  const userData = tempDirectory();
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const taskId = 'task-partial';
  const attachments = [
    { id: `${taskId}_${'c'.repeat(32)}.txt`, content: Buffer.from('first') },
    { id: `${taskId}_${'d'.repeat(32)}.txt`, content: Buffer.from('second') }
  ];
  const archivePath = path.join(userData, 'backup.zip');
  for (const item of attachments) fs.writeFileSync(path.join(userData, item.id), item.content);
  const output = fs.createWriteStream(archivePath);
  await exportWorkspaceArchive({
    output,
    workspace: {
      format: 'forward-step-workspace', scope: 'workspace',
      data: { researchAttachments: attachments.map(item => ({ id: item.id, type: 'text/plain', size: item.content.length })) }
    },
    attachments: attachments.map(item => ({
      id: item.id, taskId, type: 'text/plain', size: item.content.length,
      path: path.join(userData, item.id)
    }))
  });
  const harness = await loadMain({ openDialogResult: { canceled: false, filePaths: [archivePath] } });
  const invoke = (channel, ...args) => harness.handlers.get(channel)({}, ...args);
  const staged = await invoke('backup:import');
  const missingStagedFile = path.join(harness.userData, 'workspace-backup-import-staging', staged.stageId,
    'attachments', taskId, attachments[1].id);
  fs.unlinkSync(missingStagedFile);

  await assert.rejects(invoke('backup:commit-import', {
    stageId: staged.stageId, attachmentIds: attachments.map(item => item.id)
  }));

  const store = createSocialAttachmentStore({ userDataPath: harness.userData });
  assert.equal(store.has(attachments[0].id), false);
  assert.equal(store.has(attachments[1].id), false);
  assert.deepEqual(fs.readdirSync(path.join(harness.userData, 'workspace-backup-transactions')), []);
});

test('搜索 IPC 校验 timeoutMs 并把有效值传给社媒 API client', async () => {
  const calls = [];
  const harness = await loadMain({ createSocialApiClient: () => ({
    configured: true,
    async search(query, options) { calls.push({ query, options }); return []; }
  }) });
  const invoke = (channel, ...args) => harness.handlers.get(channel)({}, ...args);

  const result = await invoke('social:search', 'reddit', {
    query: 'budget', profileId: 'primary', mode: 'api', timeoutMs: 37
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ query: 'budget', options: { maxResults: 5, timeoutMs: 37 } }]);
});

test('已配置 API 的 auto 搜索将普通错误、限流和鉴权结果交给协调器', async t => {
  for (const code of ['SOCIAL_API_UPSTREAM_ERROR', 'SOCIAL_API_RATE_LIMITED', 'SOCIAL_API_AUTH_FAILED']) {
    const harness = await loadMain({
      createSocialApiClient: () => ({ configured: true, search: async () => ({ code, message: 'API access denied' }) })
    });
    t.after(() => fs.rmSync(harness.userData, { recursive: true, force: true }));
    harness.context.getSettingsStore = () => ({ getSocialApiConfig: () => ({ apiKey: 'test-key' }) });

    const result = await harness.handlers.get('social:search')({}, 'reddit', {
      query: 'coffee', profileId: 'p', mode: 'auto'
    });

    assert.equal(result.status, 'error');
    assert.equal(result.code, code);
    assert.equal(harness.executedScripts.length, 0);
  }
});

test('已配置 API 的 auto 搜索将不足 maxResults 的成功结果交给协调器', async t => {
  const harness = await loadMain({
    createSocialApiClient: () => ({ configured: true, search: async () => [{ id: 'api-result' }] })
  });
  t.after(() => fs.rmSync(harness.userData, { recursive: true, force: true }));
  harness.context.getSettingsStore = () => ({ getSocialApiConfig: () => ({ apiKey: 'test-key' }) });

  const result = await harness.handlers.get('social:search')({}, 'reddit', {
    query: 'coffee', profileId: 'p', mode: 'auto', maxResults: 5
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.retrievalMethod, 'api');
  assert.deepEqual(JSON.parse(JSON.stringify(result.results)), [{ id: 'api-result' }]);
  assert.equal(harness.executedScripts.length, 0);
});

test('主进程将 API 明确空结果保留为成功空结果', async t => {
  const harness = await loadMain({
    createSocialApiClient: () => ({
      configured: true,
      search: async () => ({ code: 'SOCIAL_API_EMPTY_RESULTS', results: [] })
    })
  });
  t.after(() => fs.rmSync(harness.userData, { recursive: true, force: true }));
  harness.context.getSettingsStore = () => ({ getSocialApiConfig: () => ({ apiKey: 'test-key' }) });

  const result = await harness.context.runSocialSearch('reddit', {
    query: 'coffee', profileId: 'p', mode: 'auto'
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(JSON.parse(JSON.stringify(result.results)), []);
  assert.equal(result.retrievalMethod, 'api');
  assert.equal(harness.executedScripts.length, 0);
});

test('未配置 API 的 auto 搜索直接使用浏览器', async t => {
  let apiSearchCalls = 0;
  const harness = await loadMain({
    createSocialApiClient: () => ({
      configured: false,
      search: async () => { apiSearchCalls += 1; throw new Error('未配置时不能发起 API 请求'); }
    })
  });
  t.after(() => fs.rmSync(harness.userData, { recursive: true, force: true }));
  await harness.handlers.get('social:open-login')({}, 'reddit', 'p');

  const result = await harness.handlers.get('social:search')({}, 'reddit', {
    query: 'coffee', profileId: 'p', mode: 'auto'
  });

  assert.equal(result.status, 'ok');
  assert.equal(apiSearchCalls, 0);
  assert.ok(harness.executedScripts.some(source => source.includes('document.querySelectorAll')));
});

test('mode:browser 搜索不调用已配置 API 并返回浏览器结果', async t => {
  let apiSearchCalls = 0;
  const harness = await loadMain({
    createSocialApiClient: () => ({
      configured: true,
      search: async () => { apiSearchCalls += 1; return []; }
    })
  });
  t.after(() => fs.rmSync(harness.userData, { recursive: true, force: true }));
  harness.context.getSettingsStore = () => ({ getSocialApiConfig: () => ({ apiKey: 'test-key' }) });
  await harness.handlers.get('social:open-login')({}, 'reddit', 'p');
  const profileWindow = harness.windows[harness.windows.length - 1];
  profileWindow.webContents.executeJavaScript = async source => {
    harness.executedScripts.push(source);
    return {
      supported: true, ready: true, empty: false,
      items: [{ title: '浏览器搜索结果', url: 'https://www.reddit.com/r/test/comments/123/browser-result/' }]
    };
  };

  const result = await harness.handlers.get('social:search')({}, 'reddit', {
    query: 'coffee', profileId: 'p', mode: 'browser'
  });

  assert.equal(result.status, 'ok');
  assert.equal(apiSearchCalls, 0);
  assert.equal(result.results[0].retrievalMethod, 'browser');
  assert.equal(result.results[0].title, '浏览器搜索结果');
});

test('mode:api 的已配置 API 错误明确返回且不触发浏览器', async t => {
  const harness = await loadMain({
    createSocialApiClient: () => ({ configured: true, search: async () => ({ code: 'SOCIAL_API_UPSTREAM_ERROR' }) })
  });
  t.after(() => fs.rmSync(harness.userData, { recursive: true, force: true }));
  harness.context.getSettingsStore = () => ({ getSocialApiConfig: () => ({ apiKey: 'test-key' }) });

  const result = await harness.handlers.get('social:search')({}, 'reddit', {
    query: 'coffee', profileId: 'p', mode: 'api'
  });

  assert.equal(result.status, 'error');
  assert.equal(result.code, 'SOCIAL_API_UPSTREAM_ERROR');
  assert.equal(harness.executedScripts.length, 0);
});

test('详情和证据 IPC 仅接受规范 HTTPS 内容路径并接受带安全参数的小红书链接', async t => {
  const harness = await loadMain();
  t.after(() => fs.rmSync(harness.userData, { recursive: true, force: true }));
  const invoke = (channel, payload) => harness.handlers.get(channel)({}, 'xiaohongshu', payload);
  const payload = {
    profileId: 'p', resultId: 'result-1',
    url: 'https://www.xiaohongshu.com/explore/note-1?xsec_token=token&xsec_source=pc'
  };

  for (const channel of ['social:fetch-detail', 'social:capture-evidence']) {
    for (const url of [
      'https://www.xiaohongshu.com/',
      'https://www.xiaohongshu.com/user/profile/123',
      'http://www.xiaohongshu.com/explore/note-1'
    ]) {
      assert.equal((await invoke(channel, { ...payload, url })).code, 'INVALID_REQUEST', `${channel}: ${url}`);
    }
    assert.equal((await invoke(channel, payload)).status, 'unsupported', channel);
  }
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

test('附件可由主进程流式导出并校验后恢复，拒绝冲突和错误摘要', async t => {
  const userData = tempDirectory();
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const store = createSocialAttachmentStore({ userDataPath: userData, createId: () => 'd'.repeat(32) });
  const saved = store.save({ taskId: 'archive-task', content: Buffer.from('saved body'), mimeType: 'text/plain' });
  const chunks = [];
  for await (const chunk of store.createReadStream(saved.id)) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), 'saved body');

  const stagedPath = path.join(userData, 'staged.txt');
  fs.writeFileSync(stagedPath, 'restored body');
  const id = `restored-task_${'e'.repeat(32)}.txt`;
  const sha256 = createHash('sha256').update('restored body').digest('hex');
  assert.deepEqual(await store.importFile({ id, type: 'text/plain', size: 13, sha256, sourcePath: stagedPath }), { id, imported: true });
  assert.equal(store.read(id).toString(), 'restored body');
  await assert.rejects(() => store.importFile({ id, type: 'text/plain', size: 13, sha256, sourcePath: stagedPath }), error => error.code === 'ATTACHMENT_CONFLICT');
  await assert.rejects(() => store.importFile({ id: `restored-task_${'f'.repeat(32)}.txt`, type: 'text/plain', size: 13, sha256: '0'.repeat(64), sourcePath: stagedPath }), /校验失败/);
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
