const test = require('node:test');
const assert = require('node:assert/strict');
const { createRetriever, dedupeResearchResults } = require('../prototype/retriever.js');

const entries = [
  { id: 'local-search', title: '本地关键词检索', summary: '关键词命中资料' },
  { id: 'unrelated', title: '其他资料', summary: '无关内容' }
];

test('默认关键词模式可以命中资料', async () => {
  const retriever = createRetriever();

  const result = await retriever.search(entries, '关键词');

  assert.deepEqual(result.map(item => item.id), ['local-search']);
  assert.deepEqual(retriever.status(), { mode: 'keyword', fallback: false });
});

test('语义提供器成功时使用其结果并透传 options', async () => {
  const options = { limit: 3, domain: '写作' };
  const semanticResult = [{ id: 'semantic-result' }];
  const calls = [];
  const retriever = createRetriever({
    mode: 'semantic',
    semanticProvider: {
      async search(...args) {
        calls.push(args);
        return semanticResult;
      }
    }
  });

  const result = await retriever.search(entries, '自然语言查询', options);

  assert.equal(result, semanticResult);
  assert.deepEqual(calls, [[entries, '自然语言查询', options]]);
  assert.deepEqual(retriever.status(), { mode: 'semantic', fallback: false });
});

test('语义提供器失败时回退关键词并标记 fallback', async () => {
  const retriever = createRetriever({
    mode: 'semantic',
    semanticProvider: {
      async search() {
        throw new Error('语义服务不可用');
      }
    }
  });

  const result = await retriever.search(entries, '关键词');

  assert.deepEqual(result.map(item => item.id), ['local-search']);
  assert.deepEqual(retriever.status(), { mode: 'semantic', fallback: true });
});

test('keyword 模式不调用 semanticProvider', async () => {
  let called = false;
  const retriever = createRetriever({
    mode: 'keyword',
    semanticProvider: {
      async search() {
        called = true;
        return [{ id: 'unexpected' }];
      }
    }
  });

  const result = await retriever.search(entries, '关键词');

  assert.equal(called, false);
  assert.deepEqual(result.map(item => item.id), ['local-search']);
});

test('没有 provider 或 provider.search 非函数时稳定回退关键词', async () => {
  const missingProvider = createRetriever({ mode: 'semantic' });
  const invalidProvider = createRetriever({
    mode: 'semantic',
    semanticProvider: { search: '不是函数' }
  });

  const missingResult = await missingProvider.search(entries, '关键词');
  const invalidResult = await invalidProvider.search(entries, '关键词');

  assert.deepEqual(missingResult.map(item => item.id), ['local-search']);
  assert.deepEqual(invalidResult.map(item => item.id), ['local-search']);
  assert.deepEqual(missingProvider.status(), { mode: 'semantic', fallback: false });
  assert.deepEqual(invalidProvider.status(), { mode: 'semantic', fallback: false });
});

test('社媒结果按 platform 和 contentId 去重，保留首个 ID、访问链接和查询来源顺序', () => {
  const results = dedupeResearchResults([
    { id: 'first', platform: 'weibo', contentId: 'post-1', url: 'https://weibo.com/123/post-1?from=search', searchQueries: ['q1'] },
    { id: 'second', platform: 'weibo', contentId: 'post-1', url: 'https://weibo.com/detail/post-1', searchQueries: ['q2', 'q1'] },
    { id: 'other-platform', platform: 'zhihu', contentId: 'post-1', url: 'https://zhuanlan.zhihu.com/p/post-1', searchQueries: ['q3'] }
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'first');
  assert.equal(results[0].url, 'https://weibo.com/123/post-1?from=search');
  assert.deepEqual(results[0].searchQueries, ['q1', 'q2']);
  assert.equal(results[1].id, 'other-platform');
});

test('URL 回退键只规范 scheme 和 host，不合并大小写不同的路径', () => {
  const results = dedupeResearchResults([
    { id: 'upper', platform: 'custom', url: 'HTTPS://Example.COM/CaseSensitive' },
    { id: 'same', platform: 'custom', url: 'https://example.com/CaseSensitive' },
    { id: 'lower', platform: 'custom', url: 'https://example.com/casesensitive' }
  ]);
  assert.deepEqual(results.map(item => item.id), ['upper', 'lower']);
});

test('重复内容的首个链接无效时采用后续有效访问链接', () => {
  const results = dedupeResearchResults([
    { id: 'stable-id', platform: 'zhihu', contentId: '1:2', url: 'javascript:alert(1)', searchQueries: ['q1'] },
    { id: 'new-id', platform: 'zhihu', contentId: '1:2', url: 'https://www.zhihu.com/question/1/answer/2', searchQueries: ['q2'] }
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'stable-id');
  assert.equal(results[0].url, 'https://www.zhihu.com/question/1/answer/2');
  assert.deepEqual(results[0].searchQueries, ['q1', 'q2']);
});
