const PLATFORM_HOSTS = Object.freeze({
  xiaohongshu: new Set(['www.xiaohongshu.com', 'xiaohongshu.com']),
  bilibili: new Set(['www.bilibili.com', 'bilibili.com']),
  weibo: new Set(['www.weibo.com', 'weibo.com', 's.weibo.com']),
  zhihu: new Set(['www.zhihu.com', 'zhihu.com', 'zhuanlan.zhihu.com']),
  reddit: new Set(['www.reddit.com', 'reddit.com']),
  youtube: new Set(['www.youtube.com', 'youtube.com'])
});
const NAVIGATION_TIMEOUT_MS = 15000;
const SCRIPT_TIMEOUT_MS = 10000;
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const READ_ONLY_SCRIPTS = Object.freeze(new Map(Object.entries(require('./social-browser-adapters.js').PAGE_SCRIPTS)));

function busyError() {
  return Object.assign(new Error('该平台浏览器正在执行其他操作'), { code: 'SESSION_BUSY' });
}

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
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !PLATFORM_HOSTS[platform]?.has(url.hostname.toLowerCase())) {
    throw new TypeError('URL 不在该平台的 HTTPS 白名单中');
  }
  return url.href;
}

function createSocialBrowserManager({ BrowserWindow, session, app, now = () => new Date().toISOString(), navigationTimeoutMs = NAVIGATION_TIMEOUT_MS, scriptTimeoutMs = SCRIPT_TIMEOUT_MS }) {
  if (!BrowserWindow || !session || !app) throw new TypeError('BrowserWindow、session 和 app 为必需依赖');
  const sessions = new Map();
  const activeActions = new Set();

  function getRecord(sessionId) {
    const record = sessions.get(sessionId);
    if (!record) throw Object.assign(new Error('浏览器会话不存在'), { code: 'SESSION_NOT_FOUND' });
    return record;
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

  function terminateTimedOutWindow(record, code) {
    record.status = 'closed';
    record.errorCode = code;
    record.updatedAt = now();
    const window = record.window;
    record.window = null;
    if (window && !window.isDestroyed?.()) {
      if (typeof window.destroy === 'function') window.destroy();
      else window.close();
    }
  }

  async function runWithTimeout(operation, timeoutMs, onTimeout, code, message) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            onTimeout();
            reject(Object.assign(new Error(message), { code }));
          }, Math.max(1, Math.floor(timeoutMs)));
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function resolveActionTimeout(requested, maximum) {
    const value = Number(requested);
    return Number.isFinite(value) && value > 0
      ? Math.max(1, Math.min(maximum, Math.floor(value))) : maximum;
  }

  async function navigateSessionInternal(sessionId, value, options = {}) {
    const record = getRecord(sessionId);
    const url = validatePlatformUrl(record.platform, value);
    if (!record.window || record.window.isDestroyed?.()) {
      record.status = 'closed';
      record.errorCode = 'SESSION_CLOSED';
      return publicStatus(record);
    }
    record.status = 'navigating';
    record.errorCode = '';
    try {
      const window = record.window;
      await runWithTimeout(
        () => window.loadURL(url),
        resolveActionTimeout(options.timeoutMs, navigationTimeoutMs),
        () => terminateTimedOutWindow(record, 'NAVIGATION_TIMEOUT'),
        'NAVIGATION_TIMEOUT', '页面导航超时；浏览器已关闭，请重新检查连接。'
      );
      record.currentUrl = url;
      record.status = 'ready';
    } catch (error) {
      const timedOut = error?.code === 'NAVIGATION_TIMEOUT';
      const closed = !timedOut && (!record.window || record.window.isDestroyed?.() || error?.code === 'SESSION_CLOSED');
      record.status = timedOut || closed ? 'closed' : 'failed';
      record.errorCode = timedOut ? 'NAVIGATION_TIMEOUT' : closed ? 'SESSION_CLOSED' : 'NAVIGATION_FAILED';
      record.updatedAt = now();
      const message = timedOut ? '页面导航超时；浏览器已关闭，请重新检查连接。' : closed ? '浏览器会话已关闭' : '页面导航失败';
      throw Object.assign(new Error(message), { code: record.errorCode });
    }
    record.updatedAt = now();
    return publicStatus(record);
  }

  async function executeReadOnlyScriptInternal(sessionId, scriptName, args = {}, options = {}) {
    const record = getRecord(sessionId);
    const script = READ_ONLY_SCRIPTS.get(scriptName);
    if (!script) throw Object.assign(new Error('未注册的只读脚本'), { code: 'SCRIPT_NOT_ALLOWED' });
    const scriptPlatform = typeof scriptName === 'string' ? scriptName.split('.')[0] : '';
    if (scriptPlatform !== record.platform || scriptName.split('.').length !== 2) {
      throw Object.assign(new Error('只读脚本不属于当前平台'), { code: 'SCRIPT_NOT_ALLOWED' });
    }
    if (!record.window || record.window.isDestroyed?.()) {
      throw Object.assign(new Error('浏览器会话已关闭'), { code: 'SESSION_CLOSED' });
    }
    const currentUrl = record.window.webContents?.getURL?.();
    if (typeof currentUrl !== 'string' || !currentUrl) {
      throw Object.assign(new Error('无法确认平台页面地址'), { code: 'UNSUPPORTED_PAGE' });
    }
    try {
      record.currentUrl = validatePlatformUrl(record.platform, currentUrl);
    } catch {
      throw Object.assign(new Error('当前页面不属于平台白名单'), { code: 'UNSUPPORTED_PAGE' });
    }
    const safeArgs = JSON.stringify(args ?? {});
    const source = `(${script.toString()})(JSON.parse(${JSON.stringify(safeArgs)}))`;
    const window = record.window;
    try {
      return await runWithTimeout(
        () => window.webContents.executeJavaScript(source, true),
        resolveActionTimeout(options.timeoutMs, scriptTimeoutMs),
        () => terminateTimedOutWindow(record, 'SCRIPT_TIMEOUT'),
        'SCRIPT_TIMEOUT', '平台页面读取超时；浏览器已关闭，请重新检查连接。'
      );
    } catch (error) {
      if (error?.code === 'SCRIPT_TIMEOUT') {
        throw Object.assign(new Error('平台页面读取超时；浏览器已关闭，请重新检查连接。'), { code: 'SCRIPT_TIMEOUT' });
      }
      throw error;
    }
  }

  function runSessionAction(sessionId, action) {
    if (typeof action !== 'function') throw new TypeError('会话操作必须是函数');
    if (activeActions.has(sessionId)) throw busyError();
    activeActions.add(sessionId);
    const scopedActions = Object.freeze({
      navigateSession: (value, options) => navigateSessionInternal(sessionId, value, options),
      executeReadOnlyScript: (scriptName, args, options) => executeReadOnlyScriptInternal(sessionId, scriptName, args, options)
    });
    return Promise.resolve().then(() => action(scopedActions)).finally(() => activeActions.delete(sessionId));
  }

  async function openPlatformSession({ platform, profileId, startUrl }) {
    validateProfile(platform, profileId);
    const safeUrl = validatePlatformUrl(platform, startUrl);
    const sessionId = `${platform}:${profileId}`;
    return runSessionAction(sessionId, async actions => {
      const existing = sessions.get(sessionId);
      if (existing && existing.status !== 'closed' && existing.window && !existing.window.isDestroyed?.()) {
        if (existing.status !== 'ready') await actions.navigateSession(safeUrl);
        return publicStatus(existing);
      }

      const partition = `persist:forward-step-social-${platform}-${profileId}`;
      session.fromPartition(partition);
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
        if (!['NAVIGATION_TIMEOUT', 'SCRIPT_TIMEOUT'].includes(record.errorCode)) record.errorCode = 'SESSION_CLOSED';
        record.updatedAt = now();
        record.window = null;
      });
      try {
        await actions.navigateSession(safeUrl);
      } catch (error) {
        if (!['closed', 'timeout'].includes(record.status)) record.status = 'failed';
        throw error;
      }
      return publicStatus(record);
    });
  }

  async function navigateSession(sessionId, value, options = {}) {
    return runSessionAction(sessionId, actions => actions.navigateSession(value, options));
  }

  function getSessionStatus(sessionId) {
    return publicStatus(getRecord(sessionId));
  }

  async function executeReadOnlyScript(sessionId, scriptName, args = {}, options = {}) {
    return runSessionAction(sessionId, actions => actions.executeReadOnlyScript(scriptName, args, options));
  }

  function closeSessionInternal(sessionId) {
    const record = sessions.get(sessionId);
    if (!record) return { sessionId, status: 'closed' };
    if (record.window && !record.window.isDestroyed?.()) record.window.close();
    record.status = 'closed';
    record.errorCode = 'SESSION_CLOSED';
    record.window = null;
    record.updatedAt = now();
    return publicStatus(record);
  }

  async function closeSession(sessionId) {
    return runSessionAction(sessionId, () => closeSessionInternal(sessionId));
  }

  async function clearPlatformProfile(platform, profileId) {
    validateProfile(platform, profileId);
    const sessionId = `${platform}:${profileId}`;
    return runSessionAction(sessionId, async () => {
      closeSessionInternal(sessionId);
      const partition = `persist:forward-step-social-${platform}-${profileId}`;
      const partitionSession = session.fromPartition(partition);
      await partitionSession.clearStorageData();
      await partitionSession.clearCache?.();
      return { platform, profileId, status: 'cleared' };
    });
  }

  return Object.freeze({
    openPlatformSession, navigateSession, getSessionStatus, executeReadOnlyScript, runSessionAction,
    closeSession, clearPlatformProfile
  });
}

module.exports = { createSocialBrowserManager, validatePlatformUrl };
