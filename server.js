const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { createModelClient } = require('./server/model-client');
const { createSearchClient } = require('./server/search-client');
const { createSocialApiClient, SOCIAL_API_CODES, listSocialPlatformDefinitions } = require('./server/social-api-client');
const { normalizeSocialResult } = require('./prototype/social-research-schema');
const { createAcademicLiteratureClient } = require('./server/academic-literature-client');
const { createWritingMaterialParser } = require('./server/writing-material-parser');
const { createWebPageReader } = require('./server/web-page-reader');

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

function readBody(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) return fail(new InvalidRequestError());
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InvalidRequestError();
        if (settled) return;
        settled = true;
        resolve(parsed);
      } catch {
        fail(new InvalidRequestError());
      }
    });
    req.on('error', fail);
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

function createServer({ config = ENV_CONFIG, socialFetchImpl = globalThis.fetch, socialTimeoutMs, academicFetchImpl = globalThis.fetch, academicTimeoutMs, writingMaterialParser = createWritingMaterialParser(), webPageReader = createWebPageReader() } = {}) {
  const modelClient = createModelClient(config.model);
  const searchClient = createSearchClient(config.search);
  const academicLiteratureClient = createAcademicLiteratureClient({ fetchImpl: academicFetchImpl, timeoutMs: academicTimeoutMs });
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
    if (req.method === 'POST' && requestUrl.pathname === '/api/academic-literature/lookup') {
      const body = await readBody(req);
      const keys = Object.keys(body);
      if (keys.length !== 1 || !['doi', 'pmid'].includes(keys[0]) || typeof body[keys[0]] !== 'string') {
        return sendJson(res, 400, { code: 'ACADEMIC_INVALID_REQUEST', message: '每次只能提交一个 DOI 或 PMID；不会发送标题、摘要或摘录。' });
      }
      const result = keys[0] === 'doi'
        ? await academicLiteratureClient.lookupByDoi(body.doi)
        : await academicLiteratureClient.lookupByPmid(body.pmid);
      if (!result.ok) {
        const status = result.code === 'INVALID_IDENTIFIER' ? 400
          : result.code === 'NOT_FOUND' ? 404
            : result.code === 'TIMEOUT' ? 504 : 502;
        return sendJson(res, status, { code: result.code, message: result.message });
      }
      return sendJson(res, 200, { metadata: result.metadata });
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/writing-materials/parse') {
      const remoteAddress = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1') {
        return sendJson(res, 403, { code: 'WRITING_MATERIAL_LOCAL_ONLY', message: '材料解析仅允许本机调用。' });
      }
      const body = await readBody(req, 30 * 1024 * 1024);
      const allowed = new Set(['fileName', 'mimeType', 'dataBase64']);
      if (Object.keys(body).some(key => !allowed.has(key))
        || typeof body.fileName !== 'string' || body.fileName.length > 160
        || typeof body.mimeType !== 'string' || typeof body.dataBase64 !== 'string'
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.dataBase64)) {
        return sendJson(res, 400, { code: 'WRITING_MATERIAL_INVALID_REQUEST', message: '解析请求格式无效。' });
      }
      const extension = path.extname(body.fileName).toLowerCase();
      const expectedMime = ({ '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[extension];
      if (!expectedMime || expectedMime !== body.mimeType) {
        return sendJson(res, 400, { code: 'WRITING_MATERIAL_INVALID_TYPE', message: '文件扩展名与类型不匹配，无法解析。' });
      }
      const buffer = Buffer.from(body.dataBase64, 'base64');
      if (!buffer.length || buffer.toString('base64') !== body.dataBase64) {
        return sendJson(res, 400, { code: 'WRITING_MATERIAL_INVALID_REQUEST', message: '文件内容编码无效。' });
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      const abortOnClose = () => { if (!res.writableEnded) abort(); };
      req.once('aborted', abort);
      res.once('close', abortOnClose);
      try {
        const parsed = await writingMaterialParser.parse({ buffer, mimeType: body.mimeType, signal: controller.signal });
        if (res.destroyed || res.writableEnded) return;
        if (!parsed.ok) {
          const status = parsed.error.code === 'INVALID_INPUT' ? 400
            : parsed.error.code === 'LIMIT_EXCEEDED' ? 413
              : parsed.error.code === 'CANCELLED' ? 499 : 422;
          return sendJson(res, status, { code: `WRITING_MATERIAL_${parsed.error.code}`, message: parsed.error.message });
        }
        const maxSegmentChars = 30_000;
        const rawSegments = parsed.format === 'pdf'
          ? parsed.pages.map(page => ({ locator: `第${page.page}页${page.method === 'pdf-ocr' ? ' · OCR' : ''}`, text: page.text }))
          : parsed.format === 'docx' && Array.isArray(parsed.paragraphs)
            ? parsed.paragraphs.map((paragraph, index) => ({ locator: `第${index + 1}段`, text: paragraph.text, headingLevel: paragraph.headingLevel ?? null }))
            : parsed.text.split(/\n+/).map((text, index) => ({ locator: parsed.format === 'docx' ? `第${index + 1}段` : `图片识别`, text: text.trim() })).filter(segment => segment.text);
        let remaining = maxSegmentChars;
        let segmentTruncated = false;
        const segments = rawSegments.flatMap(segment => {
          if (remaining <= 0) { segmentTruncated = true; return []; }
          const text = segment.text.slice(0, remaining);
          remaining -= text.length;
          if (text.length < segment.text.length) segmentTruncated = true;
          return text ? [{ locator: segment.locator, text, ...(segment.headingLevel == null ? {} : { headingLevel: segment.headingLevel }) }] : [];
        });
        const truncated = Boolean(parsed.truncated || segmentTruncated);
        return sendJson(res, 200, {
          status: parsed.characterCount ? 'parsed' : 'empty', mimeType: body.mimeType,
          method: parsed.format === 'pdf' ? (parsed.usedOcr ? 'pdf-ocr' : 'pdf-text')
            : parsed.format === 'docx' ? 'docx-text' : 'local-ocr',
          pageCount: parsed.format === 'pdf' ? parsed.pageCount : undefined,
          recognitionConfidence: Number.isFinite(parsed.confidence) ? parsed.confidence : undefined,
          extractedCharacters: parsed.characterCount, truncated,
          warnings: parsed.warnings || [], segments
        });
      } finally {
        req.off('aborted', abort);
        res.off('close', abortOnClose);
      }
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/writing-materials/read-webpage') {
      const remoteAddress = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      const origin = typeof req.headers.origin === 'string' ? new URL(req.headers.origin) : null;
      const requestHost = String(req.headers.host || '').toLowerCase();
      const originHost = origin?.host.toLowerCase();
      const originIsLoopback = origin && origin.protocol === 'http:'
        && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname.toLowerCase())
        && Number(origin.port) === req.socket.localPort;
      if ((remoteAddress !== '127.0.0.1' && remoteAddress !== '::1') || !originIsLoopback
        || originHost !== requestHost
        || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
        return sendJson(res, 403, { code: 'WRITING_WEB_LOCAL_ONLY', message: '网页读取仅允许当前本机应用页面调用。' });
      }
      const body = await readBody(req, 8_192);
      if (Object.keys(body).length !== 1 || typeof body.url !== 'string' || body.url.length > 2_048) {
        return sendJson(res, 400, { code: 'WRITING_WEB_INVALID_REQUEST', message: '网页链接格式无效。' });
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      const abortOnClose = () => { if (!res.writableEnded) abort(); };
      req.once('aborted', abort);
      res.once('close', abortOnClose);
      try {
        const result = await webPageReader.read(body.url, { signal: controller.signal });
        if (res.destroyed || res.writableEnded) return;
        if (!result.ok) {
          const status = result.code === 'INVALID_URL' ? 400
            : result.code === 'BUSY' ? 429
              : result.code === 'TIMEOUT' ? 504
                : result.code === 'CANCELLED' ? 499
                  : result.code === 'TOO_LARGE' ? 413 : 422;
          return sendJson(res, status, { code: `WRITING_WEB_${result.code}`, message: result.message });
        }
        return sendJson(res, 200, { title: result.title, finalUrl: result.finalUrl, text: result.text,
          characterCount: result.characterCount, truncated: result.truncated, incomplete: result.incomplete });
      } finally {
        req.off('aborted', abort);
        res.off('close', abortOnClose);
      }
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

function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, config = ENV_CONFIG, socialFetchImpl, socialTimeoutMs, academicFetchImpl, academicTimeoutMs, writingMaterialParser, webPageReader } = {}) {
  const server = createServer({ config, socialFetchImpl, socialTimeoutMs, academicFetchImpl, academicTimeoutMs, writingMaterialParser, webPageReader });
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
