const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { createBrowserPlatformAdapters, isRegisteredSearchAdapter, PAGE_SCRIPTS } = require('../electron/social-browser-adapters');

function createAdapterHarness({ scripts = {}, maxSearchReadAttempts, searchReadIntervalMs = 0, nowMs, navigationCostMs = 0, readCostMs = 0 } = {}) {
  const navigations = [];
  const reads = [];
  const actions = [];
  const timeouts = [];
  let clock = 0;
  const manager = {
    async navigateSession(sessionId, url, options = {}) {
      navigations.push({ sessionId, url });
      timeouts.push({ action: 'navigate', timeoutMs: options.timeoutMs });
      clock += navigationCostMs;
      return { status: 'ready' };
    },
    async executeReadOnlyScript(sessionId, name, args, options = {}) {
      reads.push({ sessionId, name, args });
      timeouts.push({ action: 'read', timeoutMs: options.timeoutMs });
      clock += readCostMs;
      const result = scripts[name];
      return typeof result === 'function' ? result(reads.filter(item => item.name === name).length) : result;
    },
    async runSessionAction(sessionId, action) {
      actions.push(sessionId);
      return action({
        navigateSession: (url, options) => manager.navigateSession(sessionId, url, options),
        executeReadOnlyScript: (name, args, options) => manager.executeReadOnlyScript(sessionId, name, args, options)
      });
    }
  };
  const options = { manager, now: () => '2026-10-19T00:00:00.000Z', nowMs: nowMs || (() => clock), searchReadIntervalMs };
  if (maxSearchReadAttempts !== undefined) options.maxSearchReadAttempts = maxSearchReadAttempts;
  return {
    adapters: createBrowserPlatformAdapters(options), manager, navigations, reads, actions, timeouts
  };
}

test('四个平台的搜索适配器均已注册且只执行固定只读脚本', () => {
  const { adapters, manager } = createAdapterHarness();
  const domestic = ['xiaohongshu', 'bilibili', 'weibo', 'zhihu'];
  for (const platform of domestic) assert.equal(isRegisteredSearchAdapter(platform), true);
  assert.equal(isRegisteredSearchAdapter('missing'), false);
  assert.deepEqual(Object.keys(adapters), ['xiaohongshu', 'bilibili', 'weibo', 'zhihu', 'reddit', 'youtube']);
  assert.equal(manager.registerReadOnlyScript, undefined);
  for (const adapter of Object.values(adapters)) {
    assert.equal(typeof adapter.checkReady, 'function');
    assert.equal(typeof adapter.search, 'function');
    assert.equal(typeof adapter.fetchDetail, 'function');
    assert.equal(typeof adapter.captureEvidence, 'function');
  }
});

test('检查结果区分页面可读与登录状态，无法证明时返回 unknown 且不验证搜索', async () => {
  const harness = createAdapterHarness({ scripts: {
    'xiaohongshu.login': { supported: true, loginState: 'unknown' },
    'bilibili.login': { supported: true, code: 'LOGIN_REQUIRED' },
    'weibo.login': { supported: true, loginState: 'logged-in' },
    'zhihu.login': { supported: true, supportedLogin: true }
  } });
  const expected = [
    ['xiaohongshu', 'unknown', 'ok', true, 'ready'],
    ['bilibili', 'login-required', 'ok', false, 'not-ready'],
    ['weibo', 'logged-in', 'ok', true, 'ready'],
    ['zhihu', 'unknown', 'ok', true, 'ready']
  ];
  for (const [platform, loginState, status, ready, browserStatus] of expected) {
    const adapter = harness.adapters[platform];
    adapter.attachSession(`${platform}:profile`);
    const response = await adapter.checkReady();
    assert.equal(response.status, status);
    assert.equal(response.ready, ready);
    assert.equal(response.browserStatus, browserStatus);
    assert.equal(response.loginState, loginState);
    assert.equal(response.searchVerified, false);
    if (platform === 'bilibili') assert.equal(response.code, 'LOGIN_REQUIRED');
    assert.equal(response.checkedAt, '2026-10-19T00:00:00.000Z');
  }
  const missing = await createAdapterHarness().adapters.xiaohongshu.checkReady();
  assert.equal(missing.code, 'SESSION_NOT_FOUND');
  assert.equal(missing.ready, false);
  assert.equal(missing.loginState, 'unknown');
  assert.equal(missing.searchVerified, false);
});

test('loginScript 的 restricted 状态保留为受限检查并阻断准备', async () => {
  const harness = createAdapterHarness({ scripts: {
    'weibo.login': { supported: true, loginState: 'restricted' }
  } });
  harness.adapters.weibo.attachSession('weibo:restricted');
  const response = await harness.adapters.weibo.checkReady();
  assert.equal(response.status, 'error');
  assert.equal(response.loginState, 'restricted');
  assert.equal(response.browserStatus, 'restricted');
  assert.equal(response.ready, false);
  assert.equal(response.code, 'RESTRICTED');
  assert.equal(response.message, '该平台当前限制了此连接。');
  assert.equal(response.searchVerified, false);
});

test('B 站 readyState 不能被当作登录证明', () => {
  const result = vm.runInNewContext(`(${PAGE_SCRIPTS['bilibili.login'].toString()})()`, {
    document: { readyState: 'complete', querySelector: () => null }
  });
  assert.equal(result.supported, true);
  assert.equal(result.loginState, 'unknown');
  assert.equal(result.ready, undefined);
});

test('搜索只保留真实内容链接，先过滤和去重再应用结果上限', async () => {
  const { adapters, navigations, actions } = createAdapterHarness({ scripts: {
    'bilibili.search': { supported: true, items: [
      { title: '伪造作者页', url: 'https://www.bilibili.com/space/123/video' },
      { title: '首个视频', url: '/video/BV1xx411c7mD?from=search' },
      { title: '重复视频', url: 'https://bilibili.com/video/BV1xx411c7mD?from=other' },
      { title: '第二个视频', url: '/video/av123456' },
      { title: '仿冒主机', url: 'https://www.bilibili.com.attacker.invalid/video/BV123' }
    ] }
  } });
  const adapter = adapters.bilibili;
  adapter.attachSession('bilibili:profile');
  const response = await adapter.search('视频 主题', { maxResults: 2 });
  assert.equal(response.status, 'ok');
  assert.deepEqual(response.results.map(item => item.title), ['首个视频', '第二个视频']);
  assert.deepEqual(response.results.map(item => item.contentId), ['BV1xx411c7mD', 'av123456']);
  assert.equal(response.results[0].id.length > 0, true);
  assert.equal(response.results[0].url, 'https://www.bilibili.com/video/BV1xx411c7mD?from=search');
  assert.deepEqual(response.results[0].searchQueries, ['视频 主题']);
  assert.equal(response.results[0].retrievalMethod, 'browser');
  assert.equal(response.results[0].evidenceStatus, 'unverified');
  assert.match(navigations[0].url, /^https:\/\/search\.bilibili\.com\/all\?/);
  assert.deepEqual(actions, ['bilibili:profile']);
});

test('四个平台的有效内容链接会生成 contentId，小红书令牌仅作为临时访问信息返回', async () => {
  const cases = [
    ['xiaohongshu', 'xiaohongshu.search', '/explore/note-1?xsec_token=token'],
    ['bilibili', 'bilibili.search', '/video/BV1xx411c7mD'],
    ['weibo', 'weibo.search', '/123456789/post1'],
    ['zhihu', 'zhihu.search', 'https://zhuanlan.zhihu.com/p/123']
  ];
  for (const [platform, script, url] of cases) {
    const { adapters } = createAdapterHarness({ scripts: { [script]: { supported: true, items: [{ title: '内容', url }] } } });
    adapters[platform].attachSession(`${platform}:profile`);
    const result = await adapters[platform].search('query');
    assert.equal(result.status, 'ok', `${platform}: ${result.code || result.message || ''}`);
    assert.equal(result.results.length, 1);
    assert.ok(result.results[0].contentId);
    if (platform === 'xiaohongshu') {
      assert.doesNotMatch(result.results[0].url, /xsec_token=/i);
      assert.equal(result.results[0].volatileAccess?.xsecToken, 'token');
    }
  }
});

test('页面限制和固定脚本错误返回明确错误，不伪装成空结果', async () => {
  for (const code of ['LOGIN_REQUIRED', 'MANUAL_VERIFICATION_REQUIRED', 'RATE_LIMITED']) {
    const { adapters } = createAdapterHarness({ scripts: { 'weibo.search': { supported: true, code } } });
    adapters.weibo.attachSession('weibo:profile');
    const result = await adapters.weibo.search('query');
    assert.equal(result.status, 'error');
    assert.equal(result.code, code);
    assert.equal(Object.hasOwn(result, 'results'), false);
  }
  const unsupported = createAdapterHarness({ scripts: { 'zhihu.search': { supported: false } } });
  unsupported.adapters.zhihu.attachSession('zhihu:profile');
  assert.equal((await unsupported.adapters.zhihu.search('query')).code, 'UNSUPPORTED_PAGE');
});

test('搜索结果轮询只接受卡片或明确空状态，超出短轮询期限返回 PAGE_NOT_READY', async () => {
  const harness = createAdapterHarness({
    scripts: { 'weibo.search': { supported: false, pending: true } },
    maxSearchReadAttempts: 2,
    searchReadIntervalMs: 0
  });
  harness.adapters.weibo.attachSession('weibo:profile');
  const result = await harness.adapters.weibo.search('query');
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'PAGE_NOT_READY');
  assert.equal(harness.reads.filter(item => item.name === 'weibo.search').length, 2);
});

test('浏览器搜索把剩余 timeoutMs 传给导航和页面读取', async () => {
  const harness = createAdapterHarness({
    scripts: { 'bilibili.search': { supported: true, items: [{ title: '视频', url: '/video/BV1xx411c7mD' }] } },
    navigationCostMs: 20,
    readCostMs: 15
  });
  harness.adapters.bilibili.attachSession('bilibili:timed');
  const result = await harness.adapters.bilibili.search('timeout', { timeoutMs: 100 });

  assert.equal(result.status, 'ok');
  assert.deepEqual(harness.timeouts, [
    { action: 'navigate', timeoutMs: 100 },
    { action: 'read', timeoutMs: 80 }
  ]);
});

test('只接受明确空状态作为成功的空结果，关闭或忙碌会话保留错误码', async () => {
  const empty = createAdapterHarness({ scripts: { 'zhihu.search': { supported: true, empty: true, items: [] } } });
  empty.adapters.zhihu.attachSession('zhihu:profile');
  assert.deepEqual((await empty.adapters.zhihu.search('none')).results, []);

  const closed = createAdapterHarness();
  closed.adapters.zhihu.attachSession('zhihu:closed');
  closed.manager.navigateSession = async () => { throw Object.assign(new Error('closed'), { code: 'SESSION_CLOSED' }); };
  assert.equal((await closed.adapters.zhihu.search('query')).code, 'SESSION_CLOSED');

  const busy = createAdapterHarness();
  busy.adapters.zhihu.attachSession('zhihu:busy');
  busy.manager.runSessionAction = async () => { throw Object.assign(new Error('busy'), { code: 'SESSION_BUSY' }); };
  assert.equal((await busy.adapters.zhihu.search('query')).code, 'SESSION_BUSY');
});

test('YouTube 只认 zero-results 标记，普通消息页返回 UNSUPPORTED_PAGE', async () => {
  const pageResult = vm.runInNewContext(`(${PAGE_SCRIPTS['youtube.search'].toString()})()`, {
    document: {
      readyState: 'complete',
      querySelector: selector => {
        if (selector === 'ytd-search[has-results], #section-list') return { querySelector: () => null };
        if (selector === 'ytd-message-renderer #message') return { textContent: 'No results found in this section' };
        return null;
      },
      querySelectorAll: () => []
    }
  });
  assert.equal(pageResult.supported, false);

  const unsupported = createAdapterHarness({ scripts: { 'youtube.search': pageResult } });
  unsupported.adapters.youtube.attachSession('youtube:profile');
  assert.equal((await unsupported.adapters.youtube.search('query')).code, 'UNSUPPORTED_PAGE');

  const explicitEmpty = vm.runInNewContext(`(${PAGE_SCRIPTS['youtube.search'].toString()})()`, {
    document: {
      readyState: 'complete',
      querySelector: selector => selector === '#zero-results' ? {} : null,
      querySelectorAll: () => []
    }
  });
  assert.equal(explicitEmpty.supported, true);
  assert.equal(explicitEmpty.empty, true);
  assert.deepEqual(Array.from(explicitEmpty.items), []);
});

test('登录与实测检查脚本能识别验证码、限流和登录拦截', () => {
  const run = (script, matchingSelector) => vm.runInNewContext(`(${PAGE_SCRIPTS[script].toString()})()`, {
    document: {
      readyState: 'complete',
      querySelector: selector => selector.includes(matchingSelector) ? {} : null
    }
  });
  assert.equal(run('xiaohongshu.search', 'captcha').code, 'MANUAL_VERIFICATION_REQUIRED');
  assert.equal(run('bilibili.search', 'rate-limit').code, 'RATE_LIMITED');
  assert.equal(run('zhihu.search', 'SignFlow').code, 'LOGIN_REQUIRED');
});
