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
    async loadURL(url) { if (loadURL) return loadURL(url); this.url = url; }
    close() { this.destroyed = true; this.listeners.closed?.(); }
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
  windows[0].close();
  assert.equal(manager.getSessionStatus('reddit:one').status, 'closed');
  await manager.clearPlatformProfile('reddit', 'two');
  assert.equal(windows[1].destroyed, true);
  assert.deepEqual(cleared, ['storage', 'cache']);
  assert.deepEqual(partitions.slice(-1), ['persist:forward-step-social-reddit-two']);
});

test('导航超时会标记 timeout 并对调用方返回稳定错误', async () => {
  const { manager } = createHarness({ loadURL: () => new Promise(() => {}), navigationTimeoutMs: 5 });
  const pending = manager.openPlatformSession({ platform: 'reddit', profileId: 'slow', startUrl: 'https://reddit.com/' });
  await assert.rejects(pending, error => error.code === 'NAVIGATION_TIMEOUT');
  assert.equal(manager.getSessionStatus('reddit:slow').status, 'timeout');
});

test('拒绝非白名单 URL、路径型 profile 与未注册脚本', async () => {
  const { manager } = createHarness();
  await assert.rejects(manager.openPlatformSession({ platform: 'reddit', profileId: 'x', startUrl: 'https://evil.example/' }), /白名单/);
  await assert.rejects(manager.openPlatformSession({ platform: 'reddit', profileId: '../secret', startUrl: 'https://reddit.com/' }), /稳定标识/);
  const opened = await manager.openPlatformSession({ platform: 'reddit', profileId: 'ok', startUrl: 'https://reddit.com/' });
  await assert.rejects(manager.executeReadOnlyScript(opened.sessionId, 'alert(1)', {}), error => error.code === 'SCRIPT_NOT_ALLOWED');
});

test('只执行注册的固定脚本并以 JSON 数据传入参数', async () => {
  const { manager, windows } = createHarness();
  const opened = await manager.openPlatformSession({ platform: 'reddit', profileId: 'safe', startUrl: 'https://reddit.com/' });
  let source;
  windows[0].webContents.executeJavaScript = async value => { source = value; return 'ok'; };
  manager.registerReadOnlyScript('reddit.search', args => document.title + args.query);
  assert.equal(await manager.executeReadOnlyScript(opened.sessionId, 'reddit.search', { query: '"); alert(1);//' }), 'ok');
  assert.match(source, /reddit\.search|document\.title/);
  assert.doesNotMatch(source.slice(0, source.indexOf('JSON.parse')), /alert\(1\)/);
  assert.match(source, /JSON\.parse/);
});
