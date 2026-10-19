const PLATFORM_HOSTS = Object.freeze({
  xiaohongshu: new Set(['www.xiaohongshu.com', 'xiaohongshu.com']),
  reddit: new Set(['www.reddit.com', 'reddit.com']),
  youtube: new Set(['www.youtube.com', 'youtube.com'])
});
const NAVIGATION_TIMEOUT_MS = 15000;
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const READ_ONLY_SCRIPTS = Object.freeze(new Map(Object.entries(require('./social-browser-adapters.js').PAGE_SCRIPTS)));

function validateProfile(platform, profileId) {
  if (!Object.hasOwn(PLATFORM_HOSTS, platform)) throw new TypeError('不支持的平台');
  if (typeof profileId !== 'string' || !PROFILE_ID_PATTERN.test(profileId)) {
    throw new TypeError('profileId 必须是稳定标识，且不能包含路径或凭证');
  }
}

function validatePlatformUrl(platform, value) {
  if (typeof value !== 'string') throw new TypeError('平台 URL 必须是字符串');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('平台 URL 无效');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !PLATFORM_HOSTS[platform]?.has(url.hostname.toLowerCase())) {
    throw new TypeError('URL 不在该平台的 HTTPS 白名单中');
  }
  return url.href;
}

function createSocialBrowserManager({ BrowserWindow, session, app, now = () => new Date().toISOString(), navigationTimeoutMs = NAVIGATION_TIMEOUT_MS }) {
  if (!BrowserWindow || !session || !app) throw new TypeError('BrowserWindow、session 和 app 为必需依赖');
  const sessions = new Map();

  function getRecord(sessionId) {
    const record = sessions.get(sessionId);
    if (!record) throw Object.assign(new Error('浏览器会话不存在'), { code: 'SESSION_NOT_FOUND' });
    return record;
  }

  async function openPlatformSession({ platform, profileId, startUrl }) {
    validateProfile(platform, profileId);
    const safeUrl = validatePlatformUrl(platform, startUrl);
    const existing = [...sessions.values()].find(item => item.platform === platform && item.profileId === profileId && item.status !== 'closed');
    if (existing) {
      if (existing.status !== 'ready') await navigateSession(existing.sessionId, safeUrl);
      return publicStatus(existing);
    }

    const sessionId = `${platform}:${profileId}`;
    const partition = `persist:forward-step-social-${platform}-${profileId}`;
    const partitionSession = session.fromPartition(partition);
    const window = new BrowserWindow({
      width: 1100,
      height: 800,
      show: true,
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    const record = { sessionId, platform, profileId, window, status: 'opening', currentUrl: '', openedAt: now(), updatedAt: now(), errorCode: '' };
    sessions.set(sessionId, record);
    window.on?.('closed', () => {
      record.status = 'closed';
      record.errorCode = 'SESSION_CLOSED';
      record.updatedAt = now();
      record.window = null;
    });
    try {
      await navigateSession(sessionId, safeUrl);
    } catch (error) {
      if (!['closed', 'timeout'].includes(record.status)) record.status = 'failed';
      throw error;
    }
    return publicStatus(record);
  }

  function publicStatus(record) {
    const destroyed = !record.window || record.window.isDestroyed?.();
    return {
      sessionId: record.sessionId,
      platform: record.platform,
      profileId: record.profileId,
      status: destroyed ? 'closed' : record.status,
      currentUrl: record.currentUrl,
      openedAt: record.openedAt,
      updatedAt: record.updatedAt,
      errorCode: record.errorCode
    };
  }

  async function navigateSession(sessionId, value) {
    const record = getRecord(sessionId);
    const url = validatePlatformUrl(record.platform, value);
    if (!record.window || record.window.isDestroyed?.()) {
      record.status = 'closed';
      record.errorCode = 'SESSION_CLOSED';
      return publicStatus(record);
    }
    record.status = 'navigating';
    record.errorCode = '';
    let timeout;
    try {
      await Promise.race([
        record.window.loadURL(url),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(Object.assign(new Error('页面导航超时'), { code: 'NAVIGATION_TIMEOUT' })), navigationTimeoutMs);
        })
      ]);
      record.currentUrl = url;
      record.status = 'ready';
    } catch (error) {
      const closed = !record.window || record.window.isDestroyed?.() || error.code === 'SESSION_CLOSED';
      record.status = closed ? 'closed' : error.code === 'NAVIGATION_TIMEOUT' ? 'timeout' : 'failed';
      record.errorCode = closed ? 'SESSION_CLOSED' : record.status === 'timeout' ? 'NAVIGATION_TIMEOUT' : 'NAVIGATION_FAILED';
      const message = closed ? '浏览器会话已关闭' : record.status === 'timeout' ? '页面导航超时' : '页面导航失败';
      throw Object.assign(new Error(message), { code: record.errorCode });
    } finally {
      clearTimeout(timeout);
    }
    record.updatedAt = now();
    return publicStatus(record);
  }

  function getSessionStatus(sessionId) {
    return publicStatus(getRecord(sessionId));
  }

  async function executeReadOnlyScript(sessionId, scriptName, args = {}) {
    const record = getRecord(sessionId);
    const script = READ_ONLY_SCRIPTS.get(scriptName);
    if (!script) throw Object.assign(new Error('未注册的只读脚本'), { code: 'SCRIPT_NOT_ALLOWED' });
    if (!record.window || record.window.isDestroyed?.()) throw Object.assign(new Error('浏览器会话已关闭'), { code: 'SESSION_CLOSED' });
    const safeArgs = JSON.stringify(args ?? {});
    const source = `(${script.toString()})(JSON.parse(${JSON.stringify(safeArgs)}))`;
    return record.window.webContents.executeJavaScript(source, true);
  }

  async function closeSession(sessionId) {
    const record = sessions.get(sessionId);
    if (!record) return { sessionId, status: 'closed' };
    if (record.window && !record.window.isDestroyed?.()) record.window.close();
    record.status = 'closed';
    record.errorCode = 'SESSION_CLOSED';
    record.window = null;
    record.updatedAt = now();
    return publicStatus(record);
  }

  async function clearPlatformProfile(platform, profileId) {
    validateProfile(platform, profileId);
    const sessionId = `${platform}:${profileId}`;
    await closeSession(sessionId);
    const partition = `persist:forward-step-social-${platform}-${profileId}`;
    const partitionSession = session.fromPartition(partition);
    await partitionSession.clearStorageData();
    await partitionSession.clearCache?.();
    return { platform, profileId, status: 'cleared' };
  }

  return Object.freeze({
    openPlatformSession, navigateSession, getSessionStatus, executeReadOnlyScript,
    closeSession, clearPlatformProfile
  });
}

module.exports = { createSocialBrowserManager, validatePlatformUrl };
