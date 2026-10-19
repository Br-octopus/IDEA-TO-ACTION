const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SOCIAL_API_CODES,
  createSocialApiClient,
  listSocialPlatformDefinitions,
  normalizeApiSocialResult,
  normalizeSocialApiError
} = require('../server/social-api-client');

const redditConfig = { accessToken: 'reddit-secret', userAgent: 'linux:forward-step-test:v1.0 (by /u/test-contact)' };
const youtubeConfig = { apiKey: 'youtube-secret' };

function response(body, status = 200, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name === 'content-type' ? contentType : null },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body)
  };
}

test('平台白名单说明 API 可用性、配置要求、上限与实际能力', () => {
  const definitions = listSocialPlatformDefinitions();
  assert.deepEqual(definitions.map(item => item.platform), ['xiaohongshu', 'reddit', 'youtube']);
  assert.equal(definitions.find(item => item.platform === 'xiaohongshu').apiAvailable, false);
  assert.deepEqual(definitions.find(item => item.platform === 'reddit').requiredConfig, ['accessToken', 'userAgent']);
  assert.deepEqual(definitions.find(item => item.platform === 'youtube').requiredConfig, ['apiKey']);
  assert.ok(definitions.filter(item => item.apiAvailable).every(item => Number.isInteger(item.maxResults) && item.maxResults > 0));
  assert.equal(definitions.find(item => item.platform === 'xiaohongshu').maxResults, 0);
  assert.ok(definitions.filter(item => item.apiAvailable).every(item => item.supportsSearch && !item.supportsDetail && !item.supportsComments));
  assert.ok(definitions.every(item => Array.isArray(item.supportedFields)));
  assert.equal(createSocialApiClient({ platform: 'xiaohongshu', config: { baseUrl: 'https://search.example', apiKey: 'secret' } }).configured, false);
});

test('Reddit 搜索成功后统一结果字段并限制返回数量', async () => {
  let requested;
  const client = createSocialApiClient({
    platform: 'reddit', config: redditConfig, fetchImpl: async (url, options) => {
      requested = { url, options };
      return response({ data: { children: Array.from({ length: 3 }, (_, i) => ({ data: {
        title: `帖子 ${i}`, permalink: `/r/test/comments/${i}`, selftext: '摘要', author: '作者', created_utc: 1792000000, score: 3, num_comments: 2
      } })) } });
    }
  });
  const results = await client.search('主题', { maxResults: 2 });
  assert.equal(new URL(requested.url).origin, 'https://oauth.reddit.com');
  assert.equal(requested.options.headers.authorization, 'Bearer reddit-secret');
  assert.equal(requested.options.headers['user-agent'], redditConfig.userAgent);
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 2);
  assert.doesNotMatch(JSON.stringify(results), /reddit-secret|authorization/i);
  assert.deepEqual(results[0], {
    id: results[0].id, platform: 'reddit', url: 'https://www.reddit.com/r/test/comments/0', title: '帖子 0', author: '作者',
    publishedAt: new Date(1792000000 * 1000).toISOString(), capturedAt: results[0].capturedAt, searchQueries: ['主题'],
    summary: '摘要', discussionSummary: '', publicMetrics: { likes: 3, comments: 2 }, contentType: 'post',
    retrievalMethod: 'api', evidenceStatus: 'unverified', marketingRisk: 'unknown', needsManualReview: false, attachmentIds: []
  });
});

test('YouTube API key 只通過認證請求頭發送', async () => {
  let requested;
  const client = createSocialApiClient({ platform: 'youtube', config: youtubeConfig, fetchImpl: async (url, options) => {
    requested = { url, options };
    return response({ items: [{ id: { videoId: 'abc123' }, snippet: { title: '视频', channelTitle: '频道', description: '描述', publishedAt: '2026-10-19T00:00:00Z' } }] });
  } });
  const result = await client.search('主题');
  assert.equal(new URL(requested.url).origin, 'https://www.googleapis.com');
  assert.equal(requested.options.headers['x-goog-api-key'], 'youtube-secret');
  assert.equal(new URL(requested.url).searchParams.has('key'), false);
  assert.equal(result[0].url, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(result[0].retrievalMethod, 'api');
  assert.doesNotMatch(JSON.stringify(result), /youtube-secret|authorization/i);
});

test('未配置、非 JSON、认证、限流、上游、超时和空结果均返回稳定安全错误', async () => {
  const missing = await createSocialApiClient({ platform: 'reddit', config: {} }).search('test');
  assert.equal(missing.code, SOCIAL_API_CODES.NOT_CONFIGURED);
  const scenarios = [
    [response('sensitive upstream body', 200, 'text/plain'), SOCIAL_API_CODES.INVALID_RESPONSE],
    [response({ private: 'sensitive upstream body' }, 401), SOCIAL_API_CODES.AUTH_FAILED],
    [response({}, 429), SOCIAL_API_CODES.RATE_LIMITED],
    [response({}, 503), SOCIAL_API_CODES.UPSTREAM_ERROR],
    [response({ data: { children: [] } }), SOCIAL_API_CODES.EMPTY_RESULTS]
  ];
  for (const [upstream, expectedCode] of scenarios) {
    const client = createSocialApiClient({ platform: 'reddit', config: redditConfig, fetchImpl: async () => upstream });
    const result = await client.search('test');
    assert.equal(result.code, expectedCode);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /reddit-secret|authorization|sensitive upstream body/i);
  }
  const timeout = createSocialApiClient({ platform: 'reddit', config: redditConfig, timeoutMs: 5, fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('private body'), { name: 'AbortError' })), { once: true });
  }) });
  assert.equal((await timeout.search('test')).code, SOCIAL_API_CODES.TIMEOUT);
});

test('Reddit User-Agent 必须由配置提供且拒绝原始值中的首尾和中间换行', async () => {
  const validUserAgent = 'linux:app:v1 (by /u/contact)';
  const invalidValues = [
    undefined,
    '',
    '   ',
    `linux:app:v1 (by /u/contact)\u0000`,
    `linux:app:v1 (by /u/contact)\t`,
    `linux:app:v1 (by /u/contact)\u007f`,
    `\r${validUserAgent}`,
    `${validUserAgent}\n`,
    `linux:app:v1\r (by /u/contact)`,
    `linux:app:v1 (by /u/contact)\r\nX-Injected: yes`
  ];
  for (const userAgent of invalidValues) {
    let called = false;
    const client = createSocialApiClient({
      platform: 'reddit', config: { ...redditConfig, userAgent },
      fetchImpl: async () => { called = true; throw new Error('不应发起请求'); }
    });
    const result = await client.search('test');
    assert.equal(client.configured, false);
    assert.equal(called, false);
    assert.equal(result.code, SOCIAL_API_CODES.NOT_CONFIGURED);
    assert.doesNotMatch(JSON.stringify(result), /X-Injected|\/u\/contact/i);
  }
});

test('不完整条目被丢弃，来源平台不匹配按稳定错误处理', async () => {
  const partial = normalizeApiSocialResult('reddit', { title: '', permalink: '', selftext: '仅有正文' });
  assert.equal(partial, null);
  assert.throws(() => normalizeApiSocialResult('reddit', { platform: 'youtube', title: '错平台' }), error => error.code === SOCIAL_API_CODES.PLATFORM_MISMATCH);
  const client = createSocialApiClient({ platform: 'reddit', config: redditConfig, fetchImpl: async () => response({ data: { children: [{ platform: 'youtube', data: { title: '错平台', permalink: '/r/x' } }] } }) });
  assert.equal((await client.search('test')).code, SOCIAL_API_CODES.INVALID_RESPONSE);
});

test('单条异常 Reddit 记录不会丢弃同批有效结果，越界时间戳安全处理', async () => {
  const client = createSocialApiClient({
    platform: 'reddit', config: redditConfig,
    fetchImpl: async () => response({ data: { children: [
      null,
      { data: { title: '时间越界但内容可用', permalink: '/r/test/comments/invalid-date', created_utc: 1e100 } },
      { data: { title: '有效记录', permalink: '/r/test/comments/valid', created_utc: 1792000000 } }
    ] } })
  });
  const results = await client.search('主题');
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 2);
  assert.equal(results[0].publishedAt, '');
  assert.equal(results[1].title, '有效记录');
});

test('全部记录无效时返回稳定 INVALID_RESPONSE', async () => {
  const client = createSocialApiClient({
    platform: 'reddit', config: redditConfig,
    fetchImpl: async () => response({ data: { children: [null, { data: { title: '缺链接' } }] } })
  });
  assert.equal((await client.search('主题')).code, SOCIAL_API_CODES.INVALID_RESPONSE);
});

test('错误规范化不保留原始错误、凭证或请求头', () => {
  const normalized = normalizeSocialApiError(new Error('Bearer reddit-secret Authorization: private upstream body'));
  assert.deepEqual(normalized, { code: SOCIAL_API_CODES.REQUEST_FAILED, message: '社媒 API 请求失败。' });
  assert.doesNotMatch(JSON.stringify(normalized), /reddit-secret|authorization|private upstream body/i);
});
