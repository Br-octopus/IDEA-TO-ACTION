const path = require('node:path');
const { refreshSourceIndex } = require('../prototype/local-source-index.js');

const CHANNELS = Object.freeze({
  select: 'prompt-agent-sources:select-directory',
  list: 'prompt-agent-sources:list-authorized',
  refresh: 'prompt-agent-sources:refresh-index',
  remove: 'prompt-agent-sources:remove-authorization'
});

function createPromptAgentSources({ fs, dialog, ipcMain, createId = () => require('node:crypto').randomUUID(), now = () => new Date().toISOString() }) {
  if (!fs || !dialog || !ipcMain) throw new TypeError('必须提供 fs、dialog 和 ipcMain');
  const grants = new Map();

  async function selectDirectory() {
    const result = await dialog.showOpenDialog({ title: '选择本地资料目录', properties: ['openDirectory'] });
    const selectedPath = result.filePaths?.[0];
    if (result.canceled || !selectedPath) return null;
    const root = fs.realpathSync(selectedPath);
    if (!fs.statSync(root).isDirectory()) throw new Error('所选路径不是目录');
    const id = String(createId());
    const metadata = {
      id,
      label: path.basename(root) || '本地目录',
      type: 'local-directory',
      permission: 'read-only',
      enabled: true,
      authorizedAt: now()
    };
    grants.set(id, { root, metadata, index: null });
    return { ...metadata };
  }

  function assertNoExtraArgs(args) {
    if (args.length) throw new TypeError('请求参数无效');
  }

  function getGrant(id) {
    if (typeof id !== 'string' || !grants.has(id)) throw new Error('本地目录未授权或授权已移除');
    return grants.get(id);
  }

  ipcMain.handle(CHANNELS.select, async (_event, ...args) => {
    assertNoExtraArgs(args);
    return selectDirectory();
  });
  ipcMain.handle(CHANNELS.list, async (_event, ...args) => {
    assertNoExtraArgs(args);
    return [...grants.values()].map(grant => ({ ...grant.metadata }));
  });
  ipcMain.handle(CHANNELS.refresh, async (_event, id, ...args) => {
    assertNoExtraArgs(args);
    const grant = getGrant(id);
    const freshRoot = fs.realpathSync(grant.root);
    grant.index = refreshSourceIndex(freshRoot, grant.index);
    return grant.index;
  });
  ipcMain.handle(CHANNELS.remove, async (_event, id, ...args) => {
    assertNoExtraArgs(args);
    getGrant(id);
    grants.delete(id);
    return { removed: true };
  });

  return { selectDirectory, listAuthorized: () => [...grants.values()].map(grant => ({ ...grant.metadata })) };
}

module.exports = { CHANNELS, createPromptAgentSources };
