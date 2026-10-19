const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { createModelClient } = require('./server/model-client');
const { createSearchClient } = require('./server/search-client');
const { createSocialApiClient, SOCIAL_API_CODES, listSocialPlatformDefinitions } = require('./server/social-api-client');
const { normalizeSocialResult } = require('./prototype/social-research-schema');

const ROOT = __dirname;
const DEFAULT_PORT = Number(process.env.PORT || 4173);
const DEFAULT_HOST = process.env.HOST || '127.0.0.1';
const ENV_CONFIG = {
  model: {
    baseUrl: process.env.MODEL_BASE_URL || '',
    apiKey: process.env.MODEL_API_KEY || '',
    name: process.env.MODEL_NAME || 'gpt-4o-mini'
  },
  search: {
    baseUrl: process.env.SEARCH_API_URL || '',
    apiKey: process.env.SEARCH_API_KEY || ''
  },
  social: {
    reddit: {
      accessToken: process.env.REDDIT_ACCESS_TOKEN || '',
      userAgent: process.env.REDDIT_USER_AGENT || ''
    },
    youtube: { apiKey: process.env.YOUTUBE_API_KEY || '' }
  }
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

class InvalidRequestError extends Error {}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) reject(new InvalidRequestError());
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InvalidRequestError();
        resolve(parsed);
      } catch {
        reject(new InvalidRequestError());
      }
    });
    req.on('error', reject);
  });
}

function safeFilePath(urlPath) {
  const pathname = decodeURIComponent(urlPath === '/' ? '/prototype/index.html' : urlPath);
  const candidate = path.resolve(ROOT, `.${pathname}`);
  return candidate.startsWith(ROOT) ? candidate : null;
}

function serveStatic(req, res) {
  const filePath = safeFilePath(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (!filePath) return sendJson(res, 403, { error: '禁止访问该路径' });
  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(res, 404, { error: '找不到页面' });
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    res.writeHead(200, { 'content-type': types[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
}

function createServer({ config = ENV_CONFIG, socialFetchImpl = globalThis.fetch, socialTimeoutMs } = {}) {
  const modelClient = createModelClient(config.model);
  const searchClient = createSearchClient(config.search);
  return http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && requestUrl.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/config') {
      return sendJson(res, 200, { model: { configured: modelClient.configured, name: modelClient.name }, search: { configured: searchClient.configured } });
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/model') {
      const body = await readBody(req);
      if (!Array.isArray(body.messages) || body.messages.length === 0) return sendJson(res, 400, { error: '缺少 messages' });
      return sendJson(res, 200, await modelClient.request(body.messages, body.options));
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/search') {
      const body = await readBody(req);
      if (typeof body?.query !== 'string' || !body.query.trim()) return sendJson(res, 400, { error: '缺少搜索词' });
      return sendJson(res, 200, await searchClient.search(body.query.trim(), body.options));
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/social/platforms') {
      const definitions = listSocialPlatformDefinitions().map(({ platform, displayName, apiAvailable, requiredConfig, maxResults, supportedFields, supportsSearch, supportsDetail, supportsComments }) => ({
        platform, displayName, apiAvailable, requiredConfig, maxResults, supportedFields, supportsSearch, supportsDetail, supportsComments
      }));
      return sendJson(res, 200, { platforms: definitions });
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/social/search') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return sendJson(res, 400, { code: 'SOCIAL_API_INVALID_REQUEST', message: '请求内容必须是 JSON 对象。' });
      }
      const platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : '';
      const definition = listSocialPlatformDefinitions().find(item => item.platform === platform);
      if (!definition) return sendJson(res, 400, { code: SOCIAL_API_CODES.UNSUPPORTED_PLATFORM, message: '不支持该社交平台。' });
      if (!definition.apiAvailable) return sendJson(res, 501, { code: SOCIAL_API_CODES.UNSUPPORTED_CAPABILITY, message: '该平台暂不支持 API 搜索。' });
      const query = typeof body.query === 'string' ? body.query.trim() : '';
      if (!query || query.length > 500) return sendJson(res, 400, { code: 'SOCIAL_API_INVALID_QUERY', message: '搜索词长度必须为 1 到 500 个字符。' });
      const requestedMaxResults = body.maxResults === undefined ? definition.maxResults : Number(body.maxResults);
      if (!Number.isInteger(requestedMaxResults) || requestedMaxResults < 1) {
        return sendJson(res, 400, { code: 'SOCIAL_API_INVALID_RESULT_COUNT', message: '结果数量超出平台允许范围。' });
      }
      if (requestedMaxResults > definition.maxResults) {
        return sendJson(res, 400, { code: 'SOCIAL_API_INVALID_RESULT_COUNT', message: '结果数量超出平台允许范围。' });
      }
      const maxResults = requestedMaxResults;
      const client = createSocialApiClient({
        platform,
        config: config.social?.[platform] || {},
        fetchImpl: socialFetchImpl,
        timeoutMs: socialTimeoutMs
      });
      const outcome = await client.search(query, { maxResults });
      if (!Array.isArray(outcome)) {
        const status = outcome.code === SOCIAL_API_CODES.UNSUPPORTED_CAPABILITY ? 501
          : outcome.code === SOCIAL_API_CODES.NOT_CONFIGURED ? 503
            : outcome.code === SOCIAL_API_CODES.RATE_LIMITED ? 429
              : outcome.code === SOCIAL_API_CODES.TIMEOUT ? 504
                : outcome.code === SOCIAL_API_CODES.UNSUPPORTED_PLATFORM ? 400
                  : 502;
        return sendJson(res, status, { code: outcome.code, message: outcome.message });
      }
      const results = outcome.map(result => normalizeSocialResult(result));
      return sendJson(res, 200, { platform, results });
    }
    if (req.method === 'GET') return serveStatic(req, res);
    return sendJson(res, 405, { error: '不支持的请求方法' });
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    if (error instanceof InvalidRequestError) {
      return sendJson(res, 400, { code: 'INVALID_REQUEST', message: '请求格式无效。' });
    }
    return sendJson(res, 500, { code: 'INTERNAL_ERROR', message: '服务发生未知错误。' });
  }
  });
}

function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, config = ENV_CONFIG, socialFetchImpl, socialTimeoutMs } = {}) {
  const server = createServer({ config, socialFetchImpl, socialTimeoutMs });
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      server.on('error', error => {
        console.error('本地服务运行错误：', error);
      });
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

module.exports = { createServer, startServer };

if (require.main === module) {
  startServer().then(server => {
    const address = server.address();
    console.log(`向前一步已启动：http://${DEFAULT_HOST}:${address.port}`);
    const modelClient = createModelClient(ENV_CONFIG.model);
    const searchClient = createSearchClient(ENV_CONFIG.search);
    console.log(`模型：${modelClient.configured ? `已配置（${modelClient.name}）` : '未配置，保留复制指令模式'}`);
    console.log(`搜索：${searchClient.configured ? '已配置' : '未配置，保留手动搜索模式'}`);
  }).catch(error => {
    console.error('本地服务启动失败：', error);
    process.exitCode = 1;
  });
}
