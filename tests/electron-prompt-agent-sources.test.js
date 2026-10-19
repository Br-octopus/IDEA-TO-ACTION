const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createPromptAgentSources } = require('../electron/prompt-agent-sources.js');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-agent-sources-'));
}

function harness(selectedPath, userDataPath = tempDirectory()) {
  const handlers = new Map();
  const calls = [];
  const dialog = { showOpenDialog: async options => { calls.push(options); return { canceled: false, filePaths: [selectedPath] }; } };
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const sources = createPromptAgentSources({ fs, path, userDataPath, dialog, ipcMain, createId: () => 'source-1', now: () => '2026-10-19T00:00:00.000Z' });
  const invoke = (channel, ...args) => handlers.get(channel)({}, ...args);
  return { handlers, calls, sources, invoke, userDataPath };
}

test('只能通过原生目录选择授权，列表元数据不泄露路径或文件内容', async t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'guide.md'), '# Confidential title\nConfidential body');
  const h = harness(root);
  t.after(() => fs.rmSync(h.userDataPath, { recursive: true, force: true }));
  const selected = await h.invoke('prompt-agent-sources:select-directory');
  assert.deepEqual(h.calls[0].properties, ['openDirectory']);
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), {
    id: 'source-1', label: path.basename(root), type: 'local-directory', permission: 'read-only', enabled: true, authorizedAt: '2026-10-19T00:00:00.000Z'
  });
  assert.doesNotMatch(JSON.stringify(selected), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(JSON.stringify(selected), /Confidential/);
  const listed = await h.invoke('prompt-agent-sources:list-authorized');
  assert.equal(listed.authorizations[0].id, 'source-1');
  assert.equal(listed.storageError, null);
  const refreshed = await h.invoke('prompt-agent-sources:refresh-index', 'source-1');
  assert.equal(refreshed.files[0].title, 'Confidential title');
  assert.ok(!JSON.stringify(refreshed).includes(root));
  assert.deepEqual(Object.keys(refreshed.files[0]).sort(), ['excerpt', 'fingerprint', 'fragments', 'id', 'relativePath', 'title', 'type']);
  const persisted = fs.readFileSync(path.join(h.userDataPath, 'prompt-agent-sources.json'), 'utf8');
  assert.equal(JSON.parse(persisted).authorizations[0].root, fs.realpathSync(root));
  assert.doesNotMatch(JSON.stringify(listed), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(fs.readdirSync(h.userDataPath).some(name => /backup|localStorage/i.test(name)), false);
  assert.deepEqual(await h.invoke('prompt-agent-sources:remove-authorization', 'source-1'), { removed: true });
});

test('IPC 不接受 renderer 提交的根路径或绝对文件路径，并拒绝未知授权 ID', async t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const h = harness(root);
  t.after(() => fs.rmSync(h.userDataPath, { recursive: true, force: true }));
  await h.invoke('prompt-agent-sources:select-directory');
  await assert.rejects(h.invoke('prompt-agent-sources:list-authorized', root));
  await assert.rejects(h.invoke('prompt-agent-sources:refresh-index', 'source-1', path.join(root, 'secret.md')));
  await assert.rejects(h.invoke('prompt-agent-sources:refresh-index', 'missing'));
});

test('preload 只暴露四个命名目录授权操作', async () => {
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
  assert.deepEqual(Object.keys(exposed.api.promptAgentSources), ['selectDirectory', 'listAuthorized', 'refreshIndex', 'setAuthorizationEnabled', 'removeAuthorization']);
  exposed.api.promptAgentSources.selectDirectory();
  exposed.api.promptAgentSources.listAuthorized();
  exposed.api.promptAgentSources.refreshIndex('source-1');
  exposed.api.promptAgentSources.setAuthorizationEnabled('source-1', false);
  exposed.api.promptAgentSources.removeAuthorization('source-1');
  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [
    ['prompt-agent-sources:select-directory'], ['prompt-agent-sources:list-authorized'],
    ['prompt-agent-sources:refresh-index', 'source-1'], ['prompt-agent-sources:set-authorization-enabled', 'source-1', false],
    ['prompt-agent-sources:remove-authorization', 'source-1']
  ]);
  assert.equal(exposed.api.promptAgentSources.readFile, undefined);
});

test('授权重启后保留 ID 和根目录，暂停、恢复、移除状态均持久化', async t => {
  const root = tempDirectory();
  const userDataPath = tempDirectory();
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(userDataPath, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'notes.md'), '# Notes\nalpha\nbeta\nlate-only-needle');
  const first = harness(root, userDataPath);
  await first.invoke('prompt-agent-sources:select-directory');
  const restarted = harness(root, userDataPath);
  assert.deepEqual((await restarted.invoke('prompt-agent-sources:list-authorized')).authorizations.map(item => item.id), ['source-1']);
  const refreshed = await restarted.invoke('prompt-agent-sources:refresh-index', 'source-1');
  const found = restarted.sources.searchIndex('source-1', 'late-only-needle').files[0];
  assert.ok(found.excerpt.includes('late-only-needle'));
  assert.equal(found.fragments[0].line, 4);
  assert.ok(found.excerpt.length < fs.readFileSync(path.join(root, 'notes.md'), 'utf8').length);
  await restarted.invoke('prompt-agent-sources:set-authorization-enabled', 'source-1', false);
  assert.equal((await restarted.invoke('prompt-agent-sources:list-authorized')).authorizations[0].enabled, false);
  await assert.rejects(restarted.invoke('prompt-agent-sources:refresh-index', 'source-1'), /暂停/);
  assert.throws(() => restarted.sources.searchIndex('source-1', 'needle'), /暂停/);
  const resumed = harness(root, userDataPath);
  await resumed.invoke('prompt-agent-sources:set-authorization-enabled', 'source-1', true);
  assert.ok((await resumed.invoke('prompt-agent-sources:refresh-index', 'source-1')).files.length);
  await resumed.invoke('prompt-agent-sources:remove-authorization', 'source-1');
  const afterRemoval = harness(root, userDataPath);
  assert.deepEqual((await afterRemoval.invoke('prompt-agent-sources:list-authorized')).authorizations, []);
  assert.ok(refreshed.files.length);
});

test('目录被删除或改成普通文件后报告失效且不刷新索引', async t => {
  const root = tempDirectory();
  const userDataPath = tempDirectory();
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(userDataPath, { recursive: true, force: true }); });
  const h = harness(root, userDataPath);
  await h.invoke('prompt-agent-sources:select-directory');
  fs.rmSync(root, { recursive: true, force: true });
  fs.writeFileSync(root, 'now a file');
  const restarted = harness(root, userDataPath);
  const [listed] = (await restarted.invoke('prompt-agent-sources:list-authorized')).authorizations;
  assert.equal(listed.enabled, false);
  assert.equal(listed.unavailable, true);
  await assert.rejects(restarted.invoke('prompt-agent-sources:refresh-index', 'source-1'), /失效/);
});

test('损坏授权 JSON 对 UI 显示错误并拒绝所有操作，原始文件字节保持不变', async t => {
  const root = tempDirectory();
  const userDataPath = tempDirectory();
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(userDataPath, { recursive: true, force: true }); });
  const storePath = path.join(userDataPath, 'prompt-agent-sources.json');
  const damagedBytes = Buffer.from('{ "authorizations": [ invalid }\r\n', 'utf8');
  fs.writeFileSync(storePath, damagedBytes);
  const h = harness(root, userDataPath);

  const listed = await h.invoke('prompt-agent-sources:list-authorized');
  assert.deepEqual(listed.authorizations, []);
  assert.match(listed.storageError, /JSON/);

  const mutations = [
    () => h.invoke('prompt-agent-sources:select-directory'),
    () => h.invoke('prompt-agent-sources:refresh-index', 'source-1'),
    () => h.invoke('prompt-agent-sources:set-authorization-enabled', 'source-1', false),
    () => h.invoke('prompt-agent-sources:set-authorization-enabled', 'source-1', true),
    () => h.invoke('prompt-agent-sources:remove-authorization', 'source-1')
  ];
  for (const mutate of mutations) await assert.rejects(mutate(), /配置无法读取/);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(fs.readFileSync(storePath), damagedBytes);

  const invalidShapeBytes = Buffer.from(JSON.stringify({ authorizations: [{ id: 'source-1', root, metadata: { id: 'source-1', enabled: 'yes' } }] }), 'utf8');
  fs.writeFileSync(storePath, invalidShapeBytes);
  const invalidShape = harness(root, userDataPath);
  assert.match((await invalidShape.invoke('prompt-agent-sources:list-authorized')).storageError, /格式/);
  await assert.rejects(invalidShape.invoke('prompt-agent-sources:remove-authorization', 'source-1'), /配置无法读取/);
  assert.deepEqual(fs.readFileSync(storePath), invalidShapeBytes);
});
