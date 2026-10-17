const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { createModelClient } = require('./server/model-client');
const { createSearchClient } = require('./server/search-client');

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
  }
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error('请求内容过大'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('请求不是有效 JSON')); }
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

function createServer({ config = ENV_CONFIG } = {}) {
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
      if (!body.query?.trim()) return sendJson(res, 400, { error: '缺少搜索词' });
      return sendJson(res, 200, await searchClient.search(body.query.trim(), body.options));
    }
    if (req.method === 'GET') return serveStatic(req, res);
    return sendJson(res, 405, { error: '不支持的请求方法' });
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    return sendJson(res, 500, { error: error.message || '服务发生未知错误' });
  }
  });
}

function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, config = ENV_CONFIG } = {}) {
  const server = createServer({ config });
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
