const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { createBrowserPlatformAdapters, PAGE_SCRIPTS } = require('../electron/social-browser-adapters');

function createAdapterHarness({ scripts = {} } = {}) {
  const navigations = [];
  const manager = {
    navigateSession: async (sessionId, url) => { navigations.push({ sessionId, url }); return { status: 'ready' }; },
    executeReadOnlyScript: async (_sessionId, name) => scripts[name]
  };
  return { adapters: createBrowserPlatformAdapters({ manager, now: () => '2026-10-19T00:00:00.000Z' }), manager, navigations };
}

test('三平台适配器只使用 manager 固定脚本名，不注册可执行代码', () => {
  const { adapters, manager } = createAdapterHarness();
  assert.deepEqual(Object.keys(adapters), ['xiaohongshu', 'reddit', 'youtube']);
  assert.equal(manager.registerReadOnlyScript, undefined);
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
    assert.equal(response.results[0].capturedAt, '2026-10-19T00:00:00.000Z');
    assert.deepEqual(response.results[0].searchQueries, ['主题 query']);
    assert.equal(response.results[0].html, undefined);
    assert.match(navigations[0].url, /%E4%B8%BB%E9%A2%98%20query/);
  }
});

test('各平台存在结果容器但卡片选择器失配时标记 unsupported', () => {
  const cases = [
    ['xiaohongshu.search', '[class*="search-result"]'],
    ['reddit.search', 'faceplate-partial'],
    ['youtube.search', '#section-list']
  ];
  for (const [scriptName, containerSelector] of cases) {
    const document = {
      querySelectorAll: () => [],
      querySelector: selector => selector.split(', ').includes(containerSelector) ? {} : null
    };
    const result = vm.runInNewContext(`(${PAGE_SCRIPTS[scriptName].toString()})()`, { document });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { supported: false }, scriptName);
  }
});

test('已知空结果标记允许返回受支持的空列表', () => {
  const cases = [
    ['xiaohongshu.search', '[class*="no-result"]'],
    ['reddit.search', '[data-testid*="empty"]'],
    ['youtube.search', 'ytd-message-renderer']
  ];
  for (const [scriptName, emptySelector] of cases) {
    const document = {
      querySelectorAll: () => [],
      querySelector: selector => selector.split(', ').includes(emptySelector) ? {} : null
    };
    const result = vm.runInNewContext(`(${PAGE_SCRIPTS[scriptName].toString()})()`, { document });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { supported: true, items: [] }, scriptName);
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

test('导航超时和会话关闭保留稳定状态码', async () => {
  for (const [code, expectedStatus] of [['NAVIGATION_TIMEOUT', 'timeout'], ['SESSION_CLOSED', 'closed']]) {
    const harness = createAdapterHarness();
    harness.adapters.reddit.attachSession('reddit:profile');
    harness.manager.navigateSession = async () => { throw Object.assign(new Error('navigation'), { code }); };
    const response = await harness.adapters.reddit.search('query');
    assert.equal(response.status, expectedStatus);
    assert.equal(response.code, code);
  }
});
