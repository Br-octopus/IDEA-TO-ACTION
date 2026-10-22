const { normalizeSocialResult } = require('../prototype/social-research-schema');
const { getSocialPlatformDefinition, listSocialPlatformDefinitions } = require('./social-platforms');

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const SOCIAL_API_CODES = Object.freeze({
  NOT_CONFIGURED: 'SOCIAL_API_NOT_CONFIGURED',
  UNSUPPORTED_PLATFORM: 'SOCIAL_API_UNSUPPORTED_PLATFORM',
  UNSUPPORTED_CAPABILITY: 'SOCIAL_API_UNSUPPORTED_CAPABILITY',
  AUTH_FAILED: 'SOCIAL_API_AUTH_FAILED',
  RATE_LIMITED: 'SOCIAL_API_RATE_LIMITED',
  UPSTREAM_ERROR: 'SOCIAL_API_UPSTREAM_ERROR',
  TIMEOUT: 'SOCIAL_API_TIMEOUT',
  INVALID_RESPONSE: 'SOCIAL_API_INVALID_RESPONSE',
  EMPTY_RESULTS: 'SOCIAL_API_EMPTY_RESULTS',
  PLATFORM_MISMATCH: 'SOCIAL_API_PLATFORM_MISMATCH',
  REQUEST_FAILED: 'SOCIAL_API_REQUEST_FAILED'
});

const ERROR_MESSAGES = Object.freeze({
  [SOCIAL_API_CODES.NOT_CONFIGURED]: '该平台尚未配置 API。',
  [SOCIAL_API_CODES.UNSUPPORTED_PLATFORM]: '不支持该平台。',
  [SOCIAL_API_CODES.UNSUPPORTED_CAPABILITY]: '该平台暂不支持此 API 能力。',
  [SOCIAL_API_CODES.AUTH_FAILED]: '平台 API 凭证无效或已过期。',
  [SOCIAL_API_CODES.RATE_LIMITED]: '平台 API 暂时限流。',
  [SOCIAL_API_CODES.UPSTREAM_ERROR]: '平台 API 暂时不可用。',
  [SOCIAL_API_CODES.TIMEOUT]: '平台 API 请求超时。',
  [SOCIAL_API_CODES.INVALID_RESPONSE]: '平台 API 返回了无法识别的数据。',
  [SOCIAL_API_CODES.EMPTY_RESULTS]: '平台 API 未返回可用结果。',
  [SOCIAL_API_CODES.PLATFORM_MISMATCH]: '平台 API 返回了不匹配的平台结果。',
  [SOCIAL_API_CODES.REQUEST_FAILED]: '社媒 API 请求失败。'
});

function normalizeSocialApiError(error = {}) {
  const status = Number(error.status || error.statusCode);
  const message = String(error.code || error.message || '').toUpperCase();
  let code = SOCIAL_API_CODES.REQUEST_FAILED;
  if (Object.values(SOCIAL_API_CODES).includes(error.code)) code = error.code;
  else if (error.name === 'AbortError' || message.includes('TIMEOUT')) code = SOCIAL_API_CODES.TIMEOUT;
  else if (status === 401 || status === 403 || message.includes('401')) code = SOCIAL_API_CODES.AUTH_FAILED;
  else if (status === 429 || message.includes('429')) code = SOCIAL_API_CODES.RATE_LIMITED;
  else if (status >= 500 && status <= 599 || message.includes('5XX')) code = SOCIAL_API_CODES.UPSTREAM_ERROR;
  return { code, message: ERROR_MESSAGES[code] };
}

function isValidRedditUserAgent(value) {
  if (typeof value !== 'string') return false;
  if (/[\x00-\x1F\x7F]/.test(value)) return false;
  const userAgent = value.trim();
  return Boolean(userAgent)
    && /^[^:\s]+:[^:\s]+:[^()\s]+ \(by [^()\s]+\)$/.test(userAgent);
}

function normalizeApiSocialResult(platform, item = {}, query = '') {
  const definition = getSocialPlatformDefinition(platform);
  if (!definition) throw Object.assign(new Error(), { code: SOCIAL_API_CODES.UNSUPPORTED_PLATFORM });
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw Object.assign(new Error(), { code: SOCIAL_API_CODES.INVALID_RESPONSE });
  }
  const reportedPlatform = String(item.platform || item.platformId || item.data?.platform || item.data?.platformId || '').toLowerCase();
  if (reportedPlatform && reportedPlatform !== platform) throw Object.assign(new Error(), { code: SOCIAL_API_CODES.PLATFORM_MISMATCH });
  let url = '';
  let title = '';
  let author = '';
  let publishedAt = '';
  let summary = '';
  let publicMetrics = {};
  if (platform === 'reddit') {
    const data = item.data || item;
    title = String(data.title || '').trim();
    const permalink = String(data.permalink || '').trim();
    if (permalink.startsWith('/')) url = `https://www.reddit.com${permalink}`;
    else if (permalink.startsWith('https://www.reddit.com/')) url = permalink;
    author = String(data.author || '').trim();
    const createdAtSeconds = data.created_utc == null || data.created_utc === '' ? NaN : Number(data.created_utc);
    const createdAt = Number.isFinite(createdAtSeconds) ? new Date(createdAtSeconds * 1000) : null;
    publishedAt = createdAt && Number.isFinite(createdAt.getTime()) ? createdAt.toISOString() : '';
    summary = String(data.selftext || '').trim();
    publicMetrics = {
      ...(Number.isFinite(Number(data.score)) && Number(data.score) >= 0 ? { likes: Number(data.score) } : {}),
      ...(Number.isFinite(Number(data.num_comments)) && Number(data.num_comments) >= 0 ? { comments: Number(data.num_comments) } : {})
    };
  } else if (platform === 'youtube') {
    const data = item.snippet ? item : item.data || item;
    const videoId = String(data.id?.videoId || data.videoId || '').trim();
    if (/^[A-Za-z0-9_-]{1,128}$/.test(videoId)) url = `https://www.youtube.com/watch?v=${videoId}`;
    title = String(data.snippet?.title || data.title || '').trim();
    author = String(data.snippet?.channelTitle || data.author || '').trim();
    publishedAt = String(data.snippet?.publishedAt || data.publishedAt || '').trim();
    summary = String(data.snippet?.description || data.description || '').trim();
  }
  if (!title || !url) return null;
  return normalizeSocialResult({
    platform, url, title, author, publishedAt, summary, searchQueries: query ? [query] : [],
    publicMetrics, contentType: platform === 'youtube' ? 'video' : 'post',
    retrievalMethod: 'api', evidenceStatus: 'unverified'
  });
}

function responseItems(platform, data) {
  if (platform === 'reddit' && Array.isArray(data?.data?.children)) return data.data.children;
  if (platform === 'youtube' && Array.isArray(data?.items)) return data.items;
  throw Object.assign(new Error(), { code: SOCIAL_API_CODES.INVALID_RESPONSE });
}

function createSocialApiClient({ platform, config = {}, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const definition = getSocialPlatformDefinition(platform);
  const unsupported = !definition || !definition.apiAvailable;
  const configured = !unsupported
    && definition.requiredConfig.every(key => Boolean(config?.[key]))
    && (platform !== 'reddit' || isValidRedditUserAgent(config?.userAgent));

  async function search(query, options = {}) {
    if (!definition) return { ...normalizeSocialApiError({ code: SOCIAL_API_CODES.UNSUPPORTED_PLATFORM }), results: [] };
    if (!definition.apiAvailable) return { ...normalizeSocialApiError({ code: SOCIAL_API_CODES.UNSUPPORTED_CAPABILITY }), results: [] };
    if (!configured) return { ...normalizeSocialApiError({ code: SOCIAL_API_CODES.NOT_CONFIGURED }), results: [] };
    if (typeof fetchImpl !== 'function') return { ...normalizeSocialApiError(), results: [] };
    const maximum = Math.min(definition.maxResults, Math.max(1, Math.floor(Number(options.maxResults) || definition.maxResults)));
    const endpoint = new URL(definition.endpoint);
    endpoint.searchParams.set('q', query);
    if (platform === 'reddit') {
      endpoint.searchParams.set('limit', String(maximum));
      endpoint.searchParams.set('type', 'link');
    } else {
      endpoint.searchParams.set('part', 'snippet');
      endpoint.searchParams.set('type', 'video');
      endpoint.searchParams.set('maxResults', String(maximum));
    }
    const headers = platform === 'reddit'
      ? { authorization: `Bearer ${config.accessToken}`, 'user-agent': config.userAgent.trim() }
      : { 'x-goog-api-key': config.apiKey };
    const requestedTimeout = Number(options.timeoutMs);
    const configuredTimeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? requestedTimeout : timeoutMs;
    const controller = new AbortController();
    const duration = Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.floor(Number(configuredTimeout) || DEFAULT_TIMEOUT_MS)));
    const timer = setTimeout(() => controller.abort(), duration);
    try {
      const response = await fetchImpl(endpoint.toString(), { method: 'GET', headers, signal: controller.signal });
      if (!response.ok) return { ...normalizeSocialApiError({ status: response.status }), results: [] };
      const contentType = response.headers?.get?.('content-type') || '';
      if (contentType && !contentType.toLowerCase().includes('application/json')) return { ...normalizeSocialApiError({ code: SOCIAL_API_CODES.INVALID_RESPONSE }), results: [] };
      let data;
      try {
        if (typeof response.json === 'function') data = await response.json();
        else {
          const raw = await response.text();
          data = raw ? JSON.parse(raw) : {};
        }
      } catch { return { ...normalizeSocialApiError({ code: SOCIAL_API_CODES.INVALID_RESPONSE }), results: [] }; }
      const items = responseItems(platform, data);
      const results = [];
      for (const item of items) {
        try {
          const result = normalizeApiSocialResult(platform, item, query);
          if (result) results.push(result);
        } catch {}
        if (results.length >= maximum) break;
      }
      if (!results.length) {
        const code = items.length > 0 ? SOCIAL_API_CODES.INVALID_RESPONSE : SOCIAL_API_CODES.EMPTY_RESULTS;
        return { ...normalizeSocialApiError({ code }), results: [] };
      }
      return results;
    } catch (error) {
      return { ...normalizeSocialApiError(error), results: [] };
    } finally {
      clearTimeout(timer);
    }
  }

  return { platform, configured, search };
}

module.exports = {
  SOCIAL_API_CODES, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, createSocialApiClient, listSocialPlatformDefinitions,
  normalizeApiSocialResult, normalizeSocialApiError
};
