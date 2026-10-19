const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserPlatformAdapters } = require('../electron/social-browser-adapters');

function createAdapterHarness({ scripts = {} } = {}) {
  const registered = new Map();
  const navigations = [];
  const manager = {
    registerReadOnlyScript: (name, script) => registered.set(name, script),
    navigateSession: async (sessionId, url) => { navigations.push({ sessionId, url }); return { status: 'ready' }; },
    executeReadOnlyScript: async (_sessionId, name) => scripts[name]
  };
  return { adapters: createBrowserPlatformAdapters({ manager, now: () => '2026-10-19T00:00:00.000Z' }), registered, navigations };
}

test('三平台都注册固定登录检查与搜索脚本', () => {
  const { adapters, registered } = createAdapterHarness();
  assert.deepEqual(Object.keys(adapters), ['xiaohongshu', 'reddit', 'youtube']);
  assert.equal(registered.size, 6);
  for (const adapter of Object.values(adapters)) {
    assert.equal(typeof adapter.checkReady, 'function');
    assert.equal(typeof adapter.search, 'function');
    assert.equal(typeof adapter.fetchDetail, 'function');
    assert.equal(typeof adapter.captureEvidence, 'function');
  }
});

test('登录状态区分未连接、已登录和页面结构不支持', async () => {
  for (const platform of ['xiaohongshu', 'reddit', 'youtube']) {
    const { adapters } = createAdapterHarness({ scripts: { [`${platform}.login`]: { supported: true, ready: true } } });
    const adapter = adapters[platform];
    assert.deepEqual(await adapter.checkReady(), { status: 'not-ready', platform });
    adapter.attachSession(`${platform}:profile`);
    assert.deepEqual(await adapter.checkReady(), {
      status: 'ok', platform, ready: true, checkedAt: '2026-10-19T00:00:00.000Z'
    });
  }
  const unsupported = createAdapterHarness({ scripts: { 'youtube.login': { supported: false } } }).adapters.youtube;
  unsupported.attachSession('youtube:profile');
  assert.equal((await unsupported.checkReady()).code, 'UNSUPPORTED_PAGE');
});

test('三平台搜索结果只保留 schema 标准字段并标记 browser/unverified', async () => {
  const cases = [
    ['xiaohongshu', 'xiaohongshu.search', 'https://www.xiaohongshu.com/explore/1'],
    ['reddit', 'reddit.search', 'https://www.reddit.com/r/test/comments/1/post/'],
    ['youtube', 'youtube.search', 'https://www.youtube.com/watch?v=abc']
  ];
  for (const [platform, scriptName, url] of cases) {
    const { adapters, navigations } = createAdapterHarness({ scripts: {
      [scriptName]: { supported: true, items: [{ title: ' 标题 ', url, author: '作者', summary: '摘要', html: '<secret>' }] }
    } });
    const adapter = adapters[platform];
    adapter.attachSession(`${platform}:profile`);
    const response = await adapter.search('主题 query', { maxResults: 3 });
    assert.equal(response.status, 'ok');
    assert.equal(response.results.length, 1);
    assert.equal(response.results[0].platform, platform);
    assert.equal(response.results[0].retrievalMethod, 'browser');
    assert.equal(response.results[0].evidenceStatus, 'unverified');
    assert.deepEqual(response.results[0].searchQueries, ['主题 query']);
    assert.equal(response.results[0].html, undefined);
    assert.match(navigations[0].url, /%E4%B8%BB%E9%A2%98%20query/);
  }
});

test('详情、评论和截图明确 unsupported；页面改版返回 adapter error', async () => {
  const { adapters } = createAdapterHarness({ scripts: { 'reddit.search': { supported: false } } });
  const adapter = adapters.reddit;
  adapter.attachSession('reddit:profile');
  assert.equal((await adapter.fetchDetail({})).status, 'unsupported');
  assert.equal((await adapter.captureEvidence({}, {})).status, 'unsupported');
  const result = await adapter.search('test');
  assert.equal(result.status, 'adapter-error');
  assert.equal(result.code, 'UNSUPPORTED_PAGE');
});

test('拒绝空查询和跨平台结果 URL', async () => {
  const { adapters } = createAdapterHarness({ scripts: {
    'reddit.search': { supported: true, items: [{ title: '伪造', url: 'https://www.youtube.com/watch?v=x' }] }
  } });
  const adapter = adapters.reddit;
  adapter.attachSession('reddit:profile');
  await assert.rejects(adapter.search('   '), /不能为空/);
  const result = await adapter.search('test');
  assert.equal(result.results.length, 0);
});
