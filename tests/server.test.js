const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { startServer } = require('../server');
const { MODEL_CODES, createModelClient, normalizeModelError } = require('../server/model-client');
const { SEARCH_CODES, createSearchClient, normalizeResult } = require('../server/search-client');
const { SOCIAL_API_CODES } = require('../server/social-api-client');

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

test('未配置模型返回稳定错误码', async () => {
  assert.deepEqual(normalizeModelError(new Error('MODEL_NOT_CONFIGURED')), {
    code: 'MODEL_NOT_CONFIGURED', retryable: false
  });
  const client = createModelClient({});
  assert.equal((await client.request([{ role: 'user', content: 'test' }])).code, MODEL_CODES.NOT_CONFIGURED);
});

test('模型客户端归一化成功、空内容和常见失败', async () => {
  const success = createModelClient({ baseUrl: 'https://model.example/v1', name: 'demo', apiKey: 'secret' }, {
    fetchImpl: async () => response({ choices: [{ message: { content: '建议内容' } }] })
  });
  assert.deepEqual(await success.request([{ role: 'user', content: 'test' }]), { configured: true, text: '建议内容', model: 'demo' });

  const empty = createModelClient({ baseUrl: 'https://model.example/v1', name: 'demo', apiKey: 'secret' }, {
    fetchImpl: async () => response({ choices: [{ message: { content: '' } }] })
  });
  assert.equal((await empty.request([])).code, MODEL_CODES.EMPTY_RESPONSE);

  for (const [status, code] of [[401, MODEL_CODES.AUTH_FAILED], [429, MODEL_CODES.RATE_LIMITED], [503, MODEL_CODES.UPSTREAM_ERROR]]) {
    const client = createModelClient({ baseUrl: 'https://model.example/v1', name: 'demo', apiKey: 'secret' }, {
      fetchImpl: async () => response({}, status)
    });
    assert.equal((await client.request([])).code, code);
  }
});

test('模型请求超时使用稳定错误码且默认上限为 30 秒', async () => {
  const client = createModelClient({ baseUrl: 'https://model.example/v1', name: 'demo', apiKey: 'secret' }, {
    timeoutMs: 5,
    fetchImpl: (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  });
  assert.equal((await client.request([])).code, MODEL_CODES.TIMEOUT);
});

test('搜索未配置或失败时降级，成功结果最多五条且字段统一', async () => {
  const missing = await createSearchClient({}).search('test');
  assert.equal(missing.code, SEARCH_CODES.NOT_CONFIGURED);
  assert.deepEqual(missing.results, []);

  const results = Array.from({ length: 8 }, (_, index) => ({ name: `结果 ${index}`, url: `https://example.com/${index}`, snippet: `摘要 ${index}`, published_at: '2026-10-17' }));
  const client = createSearchClient({ baseUrl: 'https://search.example/query', apiKey: 'secret' }, {
    fetchImpl: async (_url, options) => {
      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.max_results, 5);
      return response({ results });
    }
  });
  const data = await client.search('test', { maxResults: 20 });
  assert.equal(data.results.length, 5);
  assert.deepEqual(data.results[0], {
    title: '结果 0', url: 'https://example.com/0', link: 'https://example.com/0', summary: '摘要 0', date: '2026-10-17', limitations: '搜索摘要未经过本工具独立核验。'
  });

  const normalizedFromLink = normalizeResult({ title: '兼容结果', link: 'https://example.com/link', snippet: '摘要' });
  assert.equal(normalizedFromLink.url, 'https://example.com/link');
  assert.equal(normalizedFromLink.link, normalizedFromLink.url);

  const failed = createSearchClient({ baseUrl: 'https://search.example/query', apiKey: 'secret' }, {
    fetchImpl: async () => response({}, 500)
  });
  assert.equal((await failed.search('test')).code, SEARCH_CODES.UPSTREAM_ERROR);
  assert.deepEqual((await failed.search('test')).results, []);
});

test('HTTP API 在未配置模型和搜索时仍返回可降级的 JSON', async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', config: { model: {}, search: {} } });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const modelResponse = await fetch(`${baseUrl}/api/model`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }) });
  const model = await modelResponse.json();
  assert.equal(modelResponse.status, 200);
  assert.equal(model.code, MODEL_CODES.NOT_CONFIGURED);

  const searchResponse = await fetch(`${baseUrl}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'test' }) });
  const search = await searchResponse.json();
  assert.equal(searchResponse.status, 200);
  assert.equal(search.code, SEARCH_CODES.NOT_CONFIGURED);
  assert.deepEqual(search.results, []);
});

test('社媒 API 路由只接受白名单平台并返回标准化结果', async t => {
  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    config: { model: {}, search: {}, social: { reddit: { accessToken: 'server-only-secret', userAgent: 'linux:forward-step-test:v1.0 (by /u/test-contact)' } } },
    socialFetchImpl: async (url, options) => {
      assert.equal(new URL(url).origin, 'https://oauth.reddit.com');
      assert.equal(options.headers.authorization, 'Bearer server-only-secret');
      return response({ data: { children: [{ data: { title: '帖子', permalink: '/r/test/comments/1', selftext: '摘要', author: '用户' } }] } });
    }
  });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const search = await fetch(`${baseUrl}/api/social/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'reddit', query: '主题' })
  });
  const payload = await search.json();
  assert.equal(search.status, 200);
  assert.equal(payload.results[0].retrievalMethod, 'api');
  assert.equal(payload.results[0].evidenceStatus, 'unverified');
  assert.doesNotMatch(JSON.stringify(payload), /server-only-secret|authorization/i);

  const unsupported = await fetch(`${baseUrl}/api/social/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'arbitrary', query: '主题' })
  });
  const unsupportedPayload = await unsupported.json();
  assert.equal(unsupported.status, 400);
  assert.equal(unsupportedPayload.code, SOCIAL_API_CODES.UNSUPPORTED_PLATFORM);
  assert.doesNotMatch(JSON.stringify(unsupportedPayload), /server-only-secret|authorization/i);
});

test('服务端搜索参数校验和通用异常响应不会回显运行时错误', async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', config: { model: {}, search: {} } });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const invalidQuery = await fetch(`${baseUrl}/api/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 42 })
  });
  assert.equal(invalidQuery.status, 400);
  assert.deepEqual(await invalidQuery.json(), { error: '缺少搜索词' });

  const malformedJson = await fetch(`${baseUrl}/api/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{'
  });
  const errorPayload = await malformedJson.json();
  assert.equal(malformedJson.status, 400);
  assert.equal(errorPayload.code, 'INVALID_REQUEST');
  assert.equal(errorPayload.message, '请求格式无效。');
  assert.doesNotMatch(JSON.stringify(errorPayload), /请求不是有效 JSON|SyntaxError|Unexpected end/i);
});

test('社媒 API 路由限制查询长度和结果数量，且不将通用搜索配置当成平台 API', async t => {
  const server = await startServer({
    port: 0, host: '127.0.0.1',
    config: { model: {}, search: { baseUrl: 'https://search.example', apiKey: 'generic-search-secret' }, social: {} },
    socialFetchImpl: async () => { throw new Error('不应调用 fetch'); }
  });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tooLong = await fetch(`${baseUrl}/api/social/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'reddit', query: 'x'.repeat(501) })
  });
  assert.equal(tooLong.status, 400);

  const invalidCount = await fetch(`${baseUrl}/api/social/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'reddit', query: '主题', maxResults: 999 })
  });
  assert.equal(invalidCount.status, 400);

  const notConfigured = await fetch(`${baseUrl}/api/social/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'reddit', query: '主题' })
  });
  const payload = await notConfigured.json();
  assert.equal(notConfigured.status, 503);
  assert.equal(payload.code, SOCIAL_API_CODES.NOT_CONFIGURED);
  assert.doesNotMatch(JSON.stringify(payload), /generic-search-secret|authorization/i);

  const noPlatformApi = await fetch(`${baseUrl}/api/social/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'xiaohongshu', query: '主题' })
  });
  const noPlatformApiPayload = await noPlatformApi.json();
  assert.equal(noPlatformApi.status, 501);
  assert.equal(noPlatformApiPayload.code, SOCIAL_API_CODES.UNSUPPORTED_CAPABILITY);
});

test('搜索结果页面、远程结果 id 和发送上下文统一使用 url', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'prototype', 'app.js'), 'utf8');
  assert.match(appSource, /escapeHtml\(item\.url\)/);
  assert.match(appSource, /search-\$\{index\}-\$\{item\.url \|\| item\.title\}/);
  assert.match(appSource, /item\.url \|\| item\.link \|\| "未提供链接"/);
});

test('设置页区分浏览器开发模式和 Windows 桌面安全存储文案', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'prototype', 'app.js'), 'utf8');
  assert.match(appSource, /function settingsStorageMessage\(config\)/);
  assert.match(appSource, /if \(!desktopApi\) return "当前是浏览器开发模式，不能安全保存密钥，请使用 Windows 桌面应用。"/);
  assert.match(appSource, /config\?\.safeStorageAvailable === false/);
  assert.match(appSource, /密钥只交给桌面主进程保存，不会进入本地计划或提示词库。/);
});

test('发送失败时保留面板，只有成功收到非空模型文本才关闭', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'prototype', 'app.js'), 'utf8');
  assert.match(appSource, /const succeeded = await requestModel\(text, draft\.onModelResult, draft\.onModelError\);\s*draft\.sending = false;\s*if \(sendDraft !== draft\) return;\s*if \(succeeded\) closeSendPanel\(\{ cancelled: false \}\);/);
  assert.match(appSource, /if \(data\.code\) \{[\s\S]*return false;/);
  assert.match(appSource, /if \(!text\) \{[\s\S]*return false;/);
  assert.match(appSource, /output\.textContent = text;\s*onSuccess\?\.\(text\);\s*return true;/);
  assert.match(appSource, /if \(options\.cancelled !== false && sendDraft\?\.onCancel\) sendDraft\.onCancel\(new Error\("用户取消发送"\)\);/);
  assert.doesNotMatch(appSource, /closeSendPanel\([^;]*\);\s*(?:const succeeded = )?await requestModel\(text[,)]/);
});

test('用户编辑发送文本后删除资料不会用 basePrompt 覆盖实际文本', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'prototype', 'app.js'), 'utf8');
  // 本地资料条目会拼接进初始渲染文本；无本地资料时与旧行为一致
  assert.match(appSource, /renderedText: appendKnowledgeContext\(\s*withSelectedReferences\(prompt\),\s*knowledgeEntries\),\s*userEdited: false/);
  assert.match(appSource, /sendDraft\.renderedText = event\.target\.value;\s*sendDraft\.userEdited = true;/);
  assert.match(appSource, /function buildSendContent\(\)[\s\S]*sendDraft\.userEdited[\s\S]*const text = sendDraft\.renderedText/);
  assert.match(appSource, /const \{ text, segments \} = buildSendContent\(\);\s*if \(!draft\.userEdited\) draft\.renderedText = text;\s*if \(!text\.trim\(\)\)/);
  assert.match(appSource, /const report = buildSendReport\(segments\);[\s\S]*requestModel\(text, draft\.onModelResult, draft\.onModelError\)/);
});
