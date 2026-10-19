const fsDefault = require('node:fs');
const pathDefault = require('node:path');
const crypto = require('node:crypto');
const { refreshSourceIndex, searchSourceIndex } = require('../prototype/local-source-index.js');

const CHANNELS = Object.freeze({
  select: 'prompt-agent-sources:select-directory',
  list: 'prompt-agent-sources:list-authorized',
  refresh: 'prompt-agent-sources:refresh-index',
  setEnabled: 'prompt-agent-sources:set-authorization-enabled',
  remove: 'prompt-agent-sources:remove-authorization'
});
const STORE_FILENAME = 'prompt-agent-sources.json';

function createPromptAgentSources({
  fs = fsDefault,
  path = pathDefault,
  userDataPath,
  dialog,
  ipcMain,
  createId = () => crypto.randomUUID(),
  now = () => new Date().toISOString()
}) {
  if (!fs || !path || !userDataPath || !dialog || !ipcMain) {
    throw new TypeError('必须提供 fs、path、userDataPath、dialog 和 ipcMain');
  }
  const storePath = path.join(userDataPath, STORE_FILENAME);
  const grants = new Map();

  function readSavedGrants() {
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (!Array.isArray(parsed.authorizations)) return;
      for (const saved of parsed.authorizations) {
        if (!saved || typeof saved.id !== 'string' || !saved.id || typeof saved.root !== 'string'
          || !saved.metadata || saved.metadata.id !== saved.id) continue;
        const { root, metadata } = saved;
        grants.set(saved.id, {
          root,
          metadata: {
            id: saved.id,
            label: typeof metadata.label === 'string' ? metadata.label : '本地目录',
            type: 'local-directory',
            permission: 'read-only',
            enabled: metadata.enabled === true,
            authorizedAt: typeof metadata.authorizedAt === 'string' ? metadata.authorizedAt : ''
          },
          index: null
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') return;
    }
  }

  function persistGrants() {
    fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
    const content = JSON.stringify({
      version: 1,
      authorizations: [...grants.values()].map(grant => ({
        id: grant.metadata.id,
        root: grant.root,
        metadata: grant.metadata
      }))
    });
    const temporaryPath = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temporaryPath, storePath);
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
      throw error;
    }
  }

  function resolveValidRoot(grant) {
    const root = fs.realpathSync(grant.root);
    if (path.relative(grant.root, root) !== '' || path.relative(root, grant.root) !== '') {
      throw new Error('授权目录真实路径已变化');
    }
    if (!fs.statSync(root).isDirectory()) throw new Error('授权目录已失效或不再是目录');
    return root;
  }

  function publicMetadata(grant) {
    const metadata = { ...grant.metadata };
    try {
      resolveValidRoot(grant);
      metadata.unavailable = false;
    } catch {
      metadata.enabled = false;
      metadata.unavailable = true;
    }
    return metadata;
  }

  function getGrant(id, requireEnabled = false) {
    if (typeof id !== 'string' || !grants.has(id)) throw new Error('本地目录未授权或授权已移除');
    const grant = grants.get(id);
    if (requireEnabled && !grant.metadata.enabled) throw new Error('本地目录授权已暂停');
    return grant;
  }

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
    persistGrants();
    return { ...metadata };
  }

  function assertNoExtraArgs(args) {
    if (args.length) throw new TypeError('请求参数无效');
  }

  readSavedGrants();
  ipcMain.handle(CHANNELS.select, async (_event, ...args) => {
    assertNoExtraArgs(args);
    return selectDirectory();
  });
  ipcMain.handle(CHANNELS.list, async (_event, ...args) => {
    assertNoExtraArgs(args);
    return [...grants.values()].map(publicMetadata);
  });
  ipcMain.handle(CHANNELS.refresh, async (_event, id, ...args) => {
    assertNoExtraArgs(args);
    const grant = getGrant(id, true);
    const freshRoot = resolveValidRoot(grant);
    grant.index = refreshSourceIndex(freshRoot, grant.index, { fs, path });
    return grant.index;
  });
  ipcMain.handle(CHANNELS.setEnabled, async (_event, id, enabled, ...args) => {
    assertNoExtraArgs(args);
    if (typeof enabled !== 'boolean') throw new TypeError('授权状态必须是布尔值');
    const grant = getGrant(id);
    if (enabled) resolveValidRoot(grant);
    grant.metadata.enabled = enabled;
    persistGrants();
    return publicMetadata(grant);
  });
  ipcMain.handle(CHANNELS.remove, async (_event, id, ...args) => {
    assertNoExtraArgs(args);
    getGrant(id);
    grants.delete(id);
    persistGrants();
    return { removed: true };
  });

  return {
    selectDirectory,
    listAuthorized: () => [...grants.values()].map(publicMetadata),
    searchIndex(id, query, filters) {
      const grant = getGrant(id, true);
      resolveValidRoot(grant);
      if (!grant.index) throw new Error('请先刷新本地目录索引');
      return searchSourceIndex(grant.index, query, filters);
    }
  };
}

module.exports = { CHANNELS, createPromptAgentSources };
