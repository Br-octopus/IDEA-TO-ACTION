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

test('六平台适配器只使用 manager 固定脚本名，不注册可执行代码', () => {
  const { adapters, manager } = createAdapterHarness();
  assert.deepEqual(Object.keys(adapters), ['xiaohongshu', 'reddit', 'youtube', 'bilibili', 'weibo', 'zhihu']);
  assert.equal(manager.registerReadOnlyScript, undefined);
  for (const adapter of Object.values(adapters)) {
    assert.equal(typeof adapter.checkReady, 'function');
    assert.equal(typeof adapter.search, 'function');
    assert.equal(typeof adapter.fetchDetail, 'function');
    assert.equal(typeof adapter.captureEvidence, 'function');
  }
});

test('登录状态区分未连接、已登录和页面结构不支持', async () => {
  for (const platform of ['xiaohongshu', 'reddit', 'youtube', 'bilibili', 'weibo', 'zhihu']) {
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

test('B 站公开搜索无需登录，页面加载完成即可 ready', async () => {
  const scriptResult = vm.runInNewContext(`(${PAGE_SCRIPTS['bilibili.login'].toString()})()`, {
    document: { readyState: 'complete', querySelector: () => null }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(scriptResult)), {
    ready: true, supported: true, publicSearchAvailable: true
  });

  const { adapters } = createAdapterHarness({ scripts: { 'bilibili.login': scriptResult } });
  adapters.bilibili.attachSession('bilibili:public');
  assert.equal((await adapters.bilibili.checkReady()).ready, true);
});

test('微博和知乎仅在识别到站点搜索框或登录入口时判定页面可检查', () => {
  for (const platform of ['weibo', 'zhihu']) {
    const searchBox = {};
    const result = vm.runInNewContext(`(${PAGE_SCRIPTS[`${platform}.login`].toString()})()`, {
      document: { readyState: 'complete', querySelector: selector => selector.includes('input') || selector.includes('SearchBar-input') ? searchBox : null }
    });
    assert.equal(result.ready, true, platform);
    assert.equal(result.supported, true, platform);
    const unknownPage = vm.runInNewContext(`(${PAGE_SCRIPTS[`${platform}.login`].toString()})()`, {
      document: { readyState: 'complete', querySelector: () => null }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(unknownPage)), { ready: false, supported: false }, platform);
  }
});

test('六平台搜索结果只保留 schema 标准字段并标记 browser/unverified', async () => {
  const cases = [
    ['xiaohongshu', 'xiaohongshu.search', 'https://www.xiaohongshu.com/explore/1'],
    ['reddit', 'reddit.search', 'https://www.reddit.com/r/test/comments/1/post/'],
    ['youtube', 'youtube.search', 'https://www.youtube.com/watch?v=abc'],
    ['bilibili', 'bilibili.search', 'https://www.bilibili.com/video/BV1xx411c7mD'],
    ['weibo', 'weibo.search', 'https://weibo.com/123456/AbCdEf'],
    ['zhihu', 'zhihu.search', 'https://www.zhihu.com/question/123456']
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

test('B 站搜索 URL 使用编码查询词，结果只接受视频站域名并标准化为视频', async () => {
  const { adapters, navigations } = createAdapterHarness({ scripts: {
    'bilibili.search': { supported: true, items: [{
      title: ' 标题 ', url: 'https://www.bilibili.com/video/BV1xx411c7mD', author: '作者', summary: '摘要'
    }] }
  } });
  const adapter = adapters.bilibili;
  adapter.attachSession('bilibili:profile');
  const result = await adapter.search('  中文 query  ');
  assert.equal(new URL(navigations[0].url).hostname, 'search.bilibili.com');
  assert.equal(new URL(navigations[0].url).searchParams.get('keyword'), '中文 query');
  assert.equal(result.results[0].platform, 'bilibili');
  assert.equal(result.results[0].title, '标题');
  assert.equal(result.results[0].contentType, 'video');
  assert.equal(result.results[0].retrievalMethod, 'browser');
  assert.equal(result.results[0].evidenceStatus, 'unverified');
});

test('B 站只读页面脚本从视频卡片提取标准字段', () => {
  const title = { innerText: '视频标题' };
  const link = { href: 'https://www.bilibili.com/video/BV1xx411c7mD' };
  const author = { textContent: 'UP 主' };
  const summary = { innerText: '视频简介' };
  const card = {
    querySelector(selector) {
      if (selector === '.bili-video-card__info--tit a') return title;
      if (selector === 'a[href*="/video/"]') return link;
      if (selector === '.bili-video-card__info--owner') return author;
      if (selector === '.bili-video-card__info--desc') return summary;
      return null;
    }
  };
  const result = vm.runInNewContext(`(${PAGE_SCRIPTS['bilibili.search'].toString()})()`, {
    document: { querySelectorAll: () => [card], querySelector: () => null }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    supported: true,
    items: [{ title: '视频标题', url: 'https://www.bilibili.com/video/BV1xx411c7mD', author: 'UP 主', summary: '视频简介' }]
  });
});

test('微博和知乎使用固定公开搜索 URL 并只输出标准字段', async () => {
  for (const [platform, scriptName, expectedHost, expectedPath] of [
    ['weibo', 'weibo.search', 's.weibo.com', '/weibo'],
    ['zhihu', 'zhihu.search', 'www.zhihu.com', '/search']
  ]) {
    const { adapters, navigations } = createAdapterHarness({ scripts: {
      [scriptName]: { supported: true, items: [{
        title: '标题', url: platform === 'weibo' ? 'https://weibo.com/123456/AbCdEf' : 'https://www.zhihu.com/question/123456',
        author: '作者', summary: '摘要', extra: 'must-not-leak'
      }] }
    } });
    const adapter = adapters[platform];
    adapter.attachSession(`${platform}:profile`);
    const result = await adapter.search('中文 查询');
    const searchUrl = new URL(navigations[0].url);
    assert.equal(searchUrl.hostname, expectedHost);
    assert.equal(searchUrl.pathname, expectedPath);
    assert.equal(searchUrl.searchParams.get('q'), '中文 查询');
    assert.equal(result.results[0].retrievalMethod, 'browser');
    assert.equal(result.results[0].evidenceStatus, 'unverified');
    assert.equal(result.results[0].extra, undefined);
  }
});

test('微博和知乎固定只读脚本提取卡片字段，未知页面结构失败关闭', () => {
  const weiboFields = {
    content: { innerText: '微博正文' },
    link: { href: 'https://weibo.com/123456/AbCdEf', getAttribute: name => name === 'title' ? '2026-10-20' : '/123456/AbCdEf' },
    author: { innerText: '微博作者' }
  };
  const weiboCard = { querySelector: selector => {
    if (selector.includes('feed_list_content')) return weiboFields.content;
    if (selector.includes('feed_list_item_date')) return weiboFields.link;
    if (selector === '.name, [class*="name"]') return weiboFields.author;
    return null;
  } };
  const weibo = vm.runInNewContext(`(${PAGE_SCRIPTS['weibo.search'].toString()})()`, {
    document: { querySelectorAll: () => [weiboCard], querySelector: () => null }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(weibo)), {
    supported: true,
    items: [{ title: '微博正文', url: 'https://weibo.com/123456/AbCdEf', author: '微博作者', publishedAt: '2026-10-20', summary: '微博正文' }]
  });

  const fields = {
    title: { innerText: '卡片标题' },
    link: { href: 'https://www.zhihu.com/question/123456', getAttribute: () => '/question/123456' },
    author: { innerText: '作者' },
    summary: { innerText: '摘要' }
  };
  const card = { querySelector: selector => {
    if (selector.includes('ContentItem-title')) return fields.title;
    if (selector.includes('zhihu.com/question/')) return fields.link;
    if (selector.includes('AuthorInfo-name')) return fields.author;
    if (selector.includes('RichContent-inner')) return fields.summary;
    return null;
  } };
  const zhihu = vm.runInNewContext(`(${PAGE_SCRIPTS['zhihu.search'].toString()})()`, {
    document: { querySelectorAll: () => [card], querySelector: () => null }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(zhihu)), {
    supported: true, items: [{ title: '卡片标题', url: 'https://www.zhihu.com/question/123456', author: '作者', summary: '摘要' }]
  });

  for (const platform of ['weibo', 'zhihu']) {
    const unsupported = vm.runInNewContext(`(${PAGE_SCRIPTS[`${platform}.search`].toString()})()`, {
      document: { querySelectorAll: () => [], querySelector: () => null }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(unsupported)), { supported: false }, platform);
  }
});

test('小红书搜索卡片兼容替代字段和链接属性', () => {
  const title = { textContent: ' 替代标题 ' };
  const link = { getAttribute: name => name === 'href' ? '/explore/note-1' : null };
  link.href = 'https://www.xiaohongshu.com/explore/note-1';
  const author = { innerText: '作者名' };
  const summary = { textContent: '笔记摘要' };
  const card = {
    querySelector(selector) {
      if (selector === '[class*="title"]') return null;
      if (selector === '[class*="Title"]') return title;
      if (selector === 'a[href*="/explore/"]') return link;
      if (selector === '[class*="author"]') return author;
      if (selector === '[class*="desc"]') return summary;
      return null;
    }
  };
  const result = vm.runInNewContext(`(${PAGE_SCRIPTS['xiaohongshu.search'].toString()})()`, {
    document: {
      querySelectorAll: () => [card],
      querySelector: () => null
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    supported: true,
    items: [{ title: '替代标题', url: 'https://www.xiaohongshu.com/explore/note-1', author: '作者名', summary: '笔记摘要' }]
  });
});

test('各平台存在结果容器但卡片选择器失配时标记 unsupported', () => {
  const cases = [
    ['xiaohongshu.search', '[class*="search-result"]'],
    ['reddit.search', 'faceplate-partial'],
    ['youtube.search', '#section-list'],
    ['bilibili.search', '.video-list'],
    ['weibo.search', '.card-wrap'],
    ['zhihu.search', '.SearchResult-Card']
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
    ['youtube.search', 'ytd-message-renderer'],
    ['bilibili.search', '[class*="no-result"]'],
    ['weibo.search', '.card-no-result'],
    ['zhihu.search', '.SearchResult-Empty']
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
    'reddit.search': { supported: true, items: [{ title: '伪造', url: 'https://www.youtube.com/watch?v=x' }] },
    'bilibili.search': { supported: true, items: [
      { title: '伪造域名', url: 'https://bilibili.com.attacker.invalid/video/BV1xx411c7mD' },
      { title: '伪造协议', url: 'http://www.bilibili.com/video/BV1xx411c7mD' },
      { title: '非视频内容', url: 'https://www.bilibili.com/read/cv123' }
    ] }
  } });
  const adapter = adapters.reddit;
  adapter.attachSession('reddit:profile');
  await assert.rejects(adapter.search('   '), /不能为空/);
  const result = await adapter.search('test');
  assert.equal(result.results.length, 0);
  const bilibiliResult = await adapters.bilibili.search('test');
  assert.equal(bilibiliResult.results.length, 0);
  for (const [platform, scriptName, invalidUrls] of [
    ['weibo', 'weibo.search', ['https://weibo.com.attacker.invalid/123/abc', 'http://weibo.com/123/abc']],
    ['zhihu', 'zhihu.search', ['https://zhihu.com/', 'https://evil.zhihu.com/question/123', 'https://www.zhihu.com/topic/123', 'http://www.zhihu.com/question/123']]
  ]) {
    adapters[platform].attachSession(`${platform}:profile`);
    const validShape = invalidUrls.map(url => ({ title: '标题', url }));
    const harness = createAdapterHarness({ scripts: { [scriptName]: { supported: true, items: validShape } } });
    harness.adapters[platform].attachSession(`${platform}:profile`);
    const response = await harness.adapters[platform].search('test');
    assert.equal(response.status, 'adapter-error', platform);
    assert.equal(response.code, 'UNSUPPORTED_PAGE', platform);
  }
});

test('微博和知乎详情及证据截图保持 unsupported，结果缺失时返回 adapter-error', async () => {
  for (const platform of ['weibo', 'zhihu']) {
    const { adapters } = createAdapterHarness({ scripts: { [`${platform}.search`]: { supported: true } } });
    adapters[platform].attachSession(`${platform}:profile`);
    assert.equal((await adapters[platform].fetchDetail({})).status, 'unsupported');
    assert.equal((await adapters[platform].captureEvidence({}, {})).status, 'unsupported');
    const response = await adapters[platform].search('关键词');
    assert.equal(response.status, 'adapter-error');
    assert.equal(response.code, 'UNSUPPORTED_PAGE');
  }
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
