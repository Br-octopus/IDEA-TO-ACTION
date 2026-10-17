const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const MODEL_BASE_URL = (process.env.MODEL_BASE_URL || '').replace(/\/$/, '');
const MODEL_API_KEY = process.env.MODEL_API_KEY || '';
const MODEL_NAME = process.env.MODEL_NAME || 'gpt-4o-mini';
const SEARCH_API_URL = (process.env.SEARCH_API_URL || '').replace(/\/$/, '');
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || '';

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

const modelConfigured = () => Boolean(MODEL_BASE_URL && MODEL_API_KEY && MODEL_NAME);
const searchConfigured = () => Boolean(SEARCH_API_URL && SEARCH_API_KEY);

async function callModel(messages, options = {}) {
  if (!modelConfigured()) return { configured: false, message: '尚未配置模型。你仍可以复制指令交给其他 AI。' };
  const response = await fetch(`${MODEL_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${MODEL_API_KEY}` },
    body: JSON.stringify({ model: MODEL_NAME, messages, temperature: options.temperature ?? 0.2 }),
  });
  const raw = await response.text();
  let data; try { data = JSON.parse(raw); } catch { data = { error: raw.slice(0, 500) }; }
  if (!response.ok) throw new Error(data.error?.message || data.error || `模型请求失败（${response.status}）`);
  return { configured: true, text: data.choices?.[0]?.message?.content || '', model: MODEL_NAME };
}

async function searchWeb(query, options = {}) {
  if (!searchConfigured()) return { configured: false, message: '尚未配置搜索服务。请复制搜索指令到支持联网的 AI，或手动打开参考链接。', results: [] };
  const response = await fetch(SEARCH_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SEARCH_API_KEY}` },
    body: JSON.stringify({ query, max_results: options.maxResults || 5 }),
  });
  const raw = await response.text();
  let data; try { data = JSON.parse(raw); } catch { data = { error: raw.slice(0, 500) }; }
  if (!response.ok) throw new Error(data.error?.message || data.error || `搜索请求失败（${response.status}）`);
  return { configured: true, results: data.results || data.data || data.items || [] };
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

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && requestUrl.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/config') {
      return sendJson(res, 200, { model: { configured: modelConfigured(), name: MODEL_NAME }, search: { configured: searchConfigured() } });
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/model') {
      const body = await readBody(req);
      if (!Array.isArray(body.messages) || body.messages.length === 0) return sendJson(res, 400, { error: '缺少 messages' });
      return sendJson(res, 200, await callModel(body.messages, body.options));
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/search') {
      const body = await readBody(req);
      if (!body.query?.trim()) return sendJson(res, 400, { error: '缺少搜索词' });
      return sendJson(res, 200, await searchWeb(body.query.trim(), body.options));
    }
    if (req.method === 'GET') return serveStatic(req, res);
    return sendJson(res, 405, { error: '不支持的请求方法' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || '服务发生未知错误' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`向前一步已启动：http://${HOST}:${PORT}`);
  console.log(`模型：${modelConfigured() ? `已配置（${MODEL_NAME}）` : '未配置，保留复制指令模式'}`);
  console.log(`搜索：${searchConfigured() ? '已配置' : '未配置，保留手动搜索模式'}`);
});
