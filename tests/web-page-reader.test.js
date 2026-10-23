'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createWebPageReader, extractHtml, isPublicAddress, validateUrl } = require('../server/web-page-reader');
const { startServer } = require('../server');

const htmlResponse = (html, extraHeaders = {}) => ({ statusCode: 200,
  headers: { 'content-type': 'text/html; charset=utf-8', ...extraHeaders }, body: Buffer.from(html) });
const longText = '公开网页正文内容。'.repeat(20);

test('网页地址只接受无凭证、默认端口的标准 HTTP(S) 公网目标', () => {
  for (const url of ['file:///etc/passwd', 'http://user:pass@example.com/', 'http://example.com:8080/',
    'http://localhost/', 'http://printer/', 'http://127.0.0.1/', 'http://2130706433/', 'http://[::1]/',
    'http://[::ffff:8.8.8.8]/']) assert.equal(validateUrl(url), null, url);
  assert.ok(validateUrl('https://example.com/path?q=1'));
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('192.0.2.1'), false);
  assert.equal(isPublicAddress('2606:4700::1111'), true);
  assert.equal(isPublicAddress('2001:db8::1'), false);
});

test('混合公网和私网 DNS 答案整体拒绝，未发起连接', async () => {
  let requests = 0;
  const reader = createWebPageReader({ lookupImpl: async () => [
    { address: '8.8.8.8', family: 4 }, { address: '10.0.0.8', family: 4 }
  ], requestImpl: async () => { requests++; return htmlResponse(longText); } });
  assert.equal((await reader.read('https://example.com/')).code, 'BLOCKED_ADDRESS');
  assert.equal(requests, 0);
});

test('每跳连接固定到已验证 DNS 地址且保留 URL 主机名', async () => {
  const calls = [];
  const reader = createWebPageReader({ lookupImpl: async host => {
    assert.equal(host, 'example.com');
    return [{ address: '93.184.216.34', family: 4 }];
  }, requestImpl: async (url, address, family) => {
    calls.push({ hostname: url.hostname, address, family });
    return htmlResponse(`<title>安全标题</title><main>${longText}<script>不应提取</script></main>`);
  } });
  const result = await reader.read('https://example.com/article');
  assert.equal(result.ok, true);
  assert.equal(result.title, '安全标题');
  assert.match(result.text, /公开网页正文/);
  assert.doesNotMatch(result.text, /不应提取/);
  assert.deepEqual(calls, [{ hostname: 'example.com', address: '93.184.216.34', family: 4 }]);
});

test('每次重定向重新校验目标并阻止私网跳转和 HTTPS 降级', async () => {
  let calls = 0;
  const privateRedirect = createWebPageReader({ requestImpl: async () => {
    calls++;
    return { statusCode: 302, headers: { location: 'http://192.168.1.1/admin' }, body: Buffer.alloc(0) };
  } });
  assert.equal((await privateRedirect.read('https://example.com/')).code, 'BLOCKED_REDIRECT');
  assert.equal(calls, 1);

  const downgrade = createWebPageReader({ requestImpl: async () => ({ statusCode: 302,
    headers: { location: 'http://example.org/' }, body: Buffer.alloc(0) }) });
  assert.equal((await downgrade.read('https://example.com/')).code, 'BLOCKED_REDIRECT');
});

test('不接受压缩、非 HTML、超限或过短正文，超时与取消给出稳定状态', async () => {
  const makeReader = response => createWebPageReader({ requestImpl: async () => response });
  assert.equal((await makeReader(htmlResponse(longText, { 'content-encoding': 'gzip' })).read('https://example.com/')).code, 'UNSUPPORTED_CONTENT');
  assert.equal((await makeReader({ statusCode: 200, headers: { 'content-type': 'application/pdf' }, body: Buffer.from(longText) }).read('https://example.com/')).code, 'UNSUPPORTED_CONTENT');
  assert.equal((await makeReader({ statusCode: 200, headers: { 'content-type': 'text/html' }, tooLarge: true }).read('https://example.com/')).code, 'TOO_LARGE');
  assert.equal((await makeReader(htmlResponse('<title>空</title><p>太短</p>')).read('https://example.com/')).code, 'CONTENT_TOO_SHORT');

  const timeout = createWebPageReader({ timeoutMs: 5, lookupImpl: () => new Promise(() => {}) });
  assert.equal((await timeout.read('https://example.com/')).code, 'TIMEOUT');
  const controller = new AbortController();
  const cancelled = createWebPageReader({ lookupImpl: () => new Promise(() => {}) });
  const pending = cancelled.read('https://example.com/', { signal: controller.signal });
  controller.abort();
  assert.equal((await pending).code, 'CANCELLED');
});

test('HTML 文本提取排除可执行内容并解码实体', () => {
  const result = extractHtml('<title>A &amp; B</title><script>run()</script><p>事实 &lt;待核&gt;</p><svg>隐藏</svg>');
  assert.equal(result.title, 'A & B');
  assert.match(result.text, /事实 <待核>/);
  assert.doesNotMatch(result.text, /run|隐藏/);
});

test('本机读取 API 拒绝跨站、缺失 Origin 和伪造 Host 请求', async t => {
  let reads = 0;
  const server = await startServer({ port: 0, host: '127.0.0.1', config: { model: {}, search: {} },
    webPageReader: { async read(url) { reads++; return { ok: true, title: '标题', finalUrl: url, text: longText, characterCount: longText.length, truncated: false, incomplete: false }; } } });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ url: 'https://example.com/?token=private' });
  const request = headers => fetch(`${baseUrl}/api/writing-materials/read-webpage`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  assert.equal((await request({})).status, 403);
  assert.equal((await request({ origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' })).status, 403);
  const spoofedHost = await new Promise((resolve, reject) => {
    const payload = Buffer.from(body);
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/writing-materials/read-webpage', method: 'POST',
      headers: { host: 'attacker.example', origin: baseUrl, 'content-type': 'application/json', 'content-length': payload.length } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.end(payload);
  });
  assert.equal(spoofedHost, 403);
  assert.equal(reads, 0);
  const allowed = await request({ origin: baseUrl, 'sec-fetch-site': 'same-origin' });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).characterCount, longText.length);
  assert.equal(reads, 1);
});
