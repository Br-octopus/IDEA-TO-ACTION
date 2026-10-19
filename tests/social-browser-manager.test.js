const assert = require('node:assert/strict');
const test = require('node:test');
const { createSocialBrowserManager } = require('../electron/social-browser-manager');

function createHarness({ loadURL, navigationTimeoutMs } = {}) {
  const partitions = [];
  const windows = [];
  const cleared = [];
  const fakeSession = {
    clearStorageData: async () => cleared.push('storage'),
    clearCache: async () => cleared.push('cache')
  };
  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.listeners = {};
      this.webContents = { executeJavaScript: async source => source };
      windows.push(this);
    }
    on(name, listener) { this.listeners[name] = listener; }
    isDestroyed() { return this.destroyed; }
    async loadURL(url) { if (loadURL) return loadURL(url, this); this.url = url; }
    close() { this.destroyed = true; this.listeners.closed?.(); }
    destroy() { this.destroyed = true; this.listeners.closed?.(); }
  }
  const manager = createSocialBrowserManager({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: partition => { partitions.push(partition); return fakeSession; } },
    app: { getPath: () => 'must-not-leak' },
    now: () => '2026-10-19T00:00:00.000Z',
    ...(navigationTimeoutMs ? { navigationTimeoutMs } : {})
  });
  return { manager, partitions, windows, cleared };
}

test('按平台和 profile 隔离 persistent 分区，重复打开复用同一窗口', async () => {
  const { manager, partitions, windows } = createHarness();
  const first = await manager.openPlatformSession({ platform: 'reddit', profileId: 'primary', startUrl: 'https://www.reddit.com/' });
  const reused = await manager.openPlatformSession({ platform: 'reddit', profileId: 'primary', startUrl: 'https://www.reddit.com/' });
  await manager.openPlatformSession({ platform: 'youtube', profileId: 'primary', startUrl: 'https://www.youtube.com/' });
  assert.equal(windows.length, 2);
  assert.equal(windows[0].options.webPreferences.partition, partitions[0]);
  assert.deepEqual(partitions, [
    'persist:forward-step-social-reddit-primary',
    'persist:forward-step-social-youtube-primary'
  ]);
  assert.equal(first.sessionId, reused.sessionId);
  assert.equal(first.status, 'ready');
  assert.equal(JSON.stringify(first).includes('must-not-leak'), false);
});

test('状态、导航和关闭反映明确状态', async () => {
  const { manager, windows } = createHarness();
  const opened = await manager.openPlatformSession({ platform: 'youtube', profileId: 'work', startUrl: 'https://youtube.com/' });
  assert.equal(manager.getSessionStatus(opened.sessionId).status, 'ready');
  const moved = await manager.navigateSession(opened.sessionId, 'https://www.youtube.com/results?search_query=test');
  assert.equal(moved.currentUrl, 'https://www.youtube.com/results?search_query=test');
  const closed = await manager.closeSession(opened.sessionId);
  assert.equal(closed.status, 'closed');
  assert.equal(windows[0].destroyed, true);
});

test('关闭窗口和按指定 profile 清理只触及该 profile', async () => {
  const { manager, partitions, windows, cleared } = createHarness();
  await manager.openPlatformSession({ platform: 'reddit', profileId: 'one', startUrl: 'https://reddit.com/' });
  await manager.openPlatformSession({ platform: 'reddit', profileId: 'two', startUrl: 'https://reddit.com/' });
  await manager.clearPlatformProfile('reddit', 'two');
  assert.equal(windows[1].destroyed, true);
  assert.deepEqual(cleared, ['storage', 'cache']);
  assert.deepEqual(partitions.slice(-1), ['persist:forward-step-social-reddit-two']);
  assert.equal(manager.getSessionStatus('reddit:one').status, 'ready');
  const otherProfile = await manager.navigateSession('reddit:one', 'https://reddit.com/search/?q=still-open');
  assert.equal(otherProfile.status, 'ready');
  assert.equal(windows[0].url, 'https://reddit.com/search/?q=still-open');
  assert.equal(manager.getSessionStatus('reddit:two').status, 'closed');
});

test('导航超时会标记 timeout 并对调用方返回稳定错误', async () => {
  const { manager } = createHarness({ loadURL: () => new Promise(() => {}), navigationTimeoutMs: 5 });
  const pending = manager.openPlatformSession({ platform: 'reddit', profileId: 'slow', startUrl: 'https://reddit.com/' });
  await assert.rejects(pending, error => error.code === 'NAVIGATION_TIMEOUT');
  assert.equal(manager.getSessionStatus('reddit:slow').status, 'closed');
  assert.equal(manager.getSessionStatus('reddit:slow').errorCode, 'NAVIGATION_TIMEOUT');
});

test('导航超时销毁旧窗口，迟到的 loadURL 不影响后续同 profile 会话', async () => {
  let finishLateLoad;
  const { manager, windows } = createHarness({
    navigationTimeoutMs: 5,
    loadURL: (url, window) => {
      if (url.endsWith('/slow')) {
        return new Promise(resolve => {
          finishLateLoad = () => {
            window.url = url;
            resolve();
          };
        });
      }
      window.url = url;
      return Promise.resolve();
    }
  });
  await assert.rejects(
    manager.openPlatformSession({ platform: 'reddit', profileId: 'late', startUrl: 'https://reddit.com/slow' }),
    error => error.code === 'NAVIGATION_TIMEOUT'
  );

  const timedOutWindow = windows[0];
  assert.equal(timedOutWindow.destroyed, true);
  assert.equal(manager.getSessionStatus('reddit:late').status, 'closed');
  assert.equal(manager.getSessionStatus('reddit:late').errorCode, 'NAVIGATION_TIMEOUT');

  const later = await manager.openPlatformSession({ platform: 'reddit', profileId: 'late', startUrl: 'https://reddit.com/later' });
  assert.equal(windows.length, 2);
  assert.equal(later.status, 'ready');
  assert.equal(windows[1].url, 'https://reddit.com/later');

  finishLateLoad();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timedOutWindow.url, 'https://reddit.com/slow');
  assert.equal(windows[1].url, 'https://reddit.com/later');
  assert.equal(manager.getSessionStatus('reddit:late').status, 'ready');
  assert.equal(manager.getSessionStatus('reddit:late').currentUrl, 'https://reddit.com/later');
});

test('拒绝非白名单 URL、路径型 profile 与非固定脚本名', async () => {
  const { manager } = createHarness();
  for (const startUrl of [
    'http://reddit.com/',
    'https://www.youtube.com/',
    'https://user:pass@reddit.com/'
  ]) {
    await assert.rejects(manager.openPlatformSession({ platform: 'reddit', profileId: 'x', startUrl }), /白名单/);
  }
  await assert.rejects(manager.openPlatformSession({ platform: 'reddit', profileId: '../secret', startUrl: 'https://reddit.com/' }), /稳定标识/);
  const opened = await manager.openPlatformSession({ platform: 'reddit', profileId: 'ok', startUrl: 'https://reddit.com/' });
  assert.equal(manager.registerReadOnlyScript, undefined);
  await assert.rejects(manager.executeReadOnlyScript(opened.sessionId, 'alert(1)', {}), error => error.code === 'SCRIPT_NOT_ALLOWED');
  await assert.rejects(manager.executeReadOnlyScript(opened.sessionId, 'reddit.search.extra', {}), error => error.code === 'SCRIPT_NOT_ALLOWED');
});

test('固定只读脚本使用 JSON 参数；任意函数不能加入执行白名单', async () => {
  const { manager, windows } = createHarness();
  const opened = await manager.openPlatformSession({ platform: 'reddit', profileId: 'safe', startUrl: 'https://reddit.com/' });
  let source;
  windows[0].webContents.executeJavaScript = async value => { source = value; return 'ok'; };
  assert.equal(await manager.executeReadOnlyScript(opened.sessionId, 'reddit.search', { query: '"); alert(1);//' }), 'ok');
  assert.match(source, /document\.querySelectorAll/);
  assert.doesNotMatch(source.slice(0, source.indexOf('JSON.parse')), /alert\(1\)/);
  assert.match(source, /JSON\.parse/);
  assert.equal(manager.registerReadOnlyScript, undefined);
});

test('窗口关闭后只读脚本返回稳定 SESSION_CLOSED', async () => {
  const { manager, windows } = createHarness();
  const opened = await manager.openPlatformSession({ platform: 'youtube', profileId: 'closed', startUrl: 'https://youtube.com/' });
  windows[0].close();
  assert.equal(manager.getSessionStatus(opened.sessionId).status, 'closed');
  await assert.rejects(manager.executeReadOnlyScript(opened.sessionId, 'youtube.search'), error => error.code === 'SESSION_CLOSED');
});
