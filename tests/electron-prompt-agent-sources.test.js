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

function harness(selectedPath) {
  const handlers = new Map();
  const calls = [];
  const dialog = { showOpenDialog: async options => { calls.push(options); return { canceled: false, filePaths: [selectedPath] }; } };
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const sources = createPromptAgentSources({ fs, dialog, ipcMain, createId: () => 'source-1', now: () => '2026-10-19T00:00:00.000Z' });
  const invoke = (channel, ...args) => handlers.get(channel)({}, ...args);
  return { handlers, calls, sources, invoke };
}

test('只能通过原生目录选择授权，列表元数据不泄露路径或文件内容', async t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'guide.md'), '# Confidential title\nConfidential body');
  const h = harness(root);
  const selected = await h.invoke('prompt-agent-sources:select-directory');
  assert.deepEqual(h.calls[0].properties, ['openDirectory']);
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), {
    id: 'source-1', label: path.basename(root), type: 'local-directory', permission: 'read-only', enabled: true, authorizedAt: '2026-10-19T00:00:00.000Z'
  });
  assert.doesNotMatch(JSON.stringify(selected), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(JSON.stringify(selected), /Confidential/);
  const listed = await h.invoke('prompt-agent-sources:list-authorized');
  assert.equal(listed[0].id, 'source-1');
  const refreshed = await h.invoke('prompt-agent-sources:refresh-index', 'source-1');
  assert.equal(refreshed.files[0].title, 'Confidential title');
  assert.ok(!JSON.stringify(refreshed).includes(root));
  assert.deepEqual(Object.keys(refreshed.files[0]).sort(), ['excerpt', 'fingerprint', 'id', 'keywords', 'relativePath', 'title', 'type']);
  assert.deepEqual(await h.invoke('prompt-agent-sources:remove-authorization', 'source-1'), { removed: true });
});

test('IPC 不接受 renderer 提交的根路径或绝对文件路径，并拒绝未知授权 ID', async t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const h = harness(root);
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
  assert.deepEqual(Object.keys(exposed.api.promptAgentSources), ['selectDirectory', 'listAuthorized', 'refreshIndex', 'removeAuthorization']);
  exposed.api.promptAgentSources.selectDirectory();
  exposed.api.promptAgentSources.listAuthorized();
  exposed.api.promptAgentSources.refreshIndex('source-1');
  exposed.api.promptAgentSources.removeAuthorization('source-1');
  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [
    ['prompt-agent-sources:select-directory'], ['prompt-agent-sources:list-authorized'],
    ['prompt-agent-sources:refresh-index', 'source-1'], ['prompt-agent-sources:remove-authorization', 'source-1']
  ]);
  assert.equal(exposed.api.promptAgentSources.readFile, undefined);
});
