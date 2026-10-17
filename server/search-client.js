const SEARCH_TIMEOUT_MS = 30_000;

const SEARCH_CODES = Object.freeze({
  NOT_CONFIGURED: 'SEARCH_NOT_CONFIGURED',
  AUTH_FAILED: 'SEARCH_AUTH_FAILED',
  RATE_LIMITED: 'SEARCH_RATE_LIMITED',
  UPSTREAM_ERROR: 'SEARCH_UPSTREAM_ERROR',
  TIMEOUT: 'SEARCH_TIMEOUT',
  REQUEST_FAILED: 'SEARCH_REQUEST_FAILED'
});

function normalizeSearchError(error = {}) {
  const status = Number(error.status || error.statusCode);
  const message = String(error.code || error.message || '').toUpperCase();
  if (message.includes(SEARCH_CODES.NOT_CONFIGURED)) return { code: SEARCH_CODES.NOT_CONFIGURED, retryable: false };
  if (error.name === 'AbortError' || message.includes('TIMEOUT')) return { code: SEARCH_CODES.TIMEOUT, retryable: true };
  if (status === 401 || message.includes('401')) return { code: SEARCH_CODES.AUTH_FAILED, retryable: false };
  if (status === 429 || message.includes('429')) return { code: SEARCH_CODES.RATE_LIMITED, retryable: true };
  if (status >= 500 && status <= 599 || message.includes('5XX')) return { code: SEARCH_CODES.UPSTREAM_ERROR, retryable: true };
  return { code: SEARCH_CODES.REQUEST_FAILED, retryable: false };
}

function searchMessage(code) {
  const messages = {
    [SEARCH_CODES.NOT_CONFIGURED]: '尚未配置搜索服务，研究结果保持未完成；你仍可复制搜索指令。',
    [SEARCH_CODES.AUTH_FAILED]: '搜索服务拒绝了凭证，已降级为手动搜索。',
    [SEARCH_CODES.RATE_LIMITED]: '搜索服务暂时限流，已降级为手动搜索。',
    [SEARCH_CODES.UPSTREAM_ERROR]: '搜索服务暂时不可用，已降级为手动搜索。',
    [SEARCH_CODES.TIMEOUT]: '搜索请求超时，已降级为手动搜索。',
    [SEARCH_CODES.REQUEST_FAILED]: '搜索失败，已降级为手动搜索。'
  };
  return messages[code] || messages[SEARCH_CODES.REQUEST_FAILED];
}

function isConfigured(config) {
  return Boolean(config?.baseUrl && config?.apiKey);
}

function sourceItems(data) {
  if (Array.isArray(data)) return data;
  return data?.results || data?.data || data?.items || [];
}

function normalizeResult(item = {}) {
  const url = String(item.link || item.url || item.href || '').trim();
  return {
    title: String(item.title || item.name || item.headline || '未命名结果').trim(),
    url,
    link: url,
    summary: String(item.summary || item.snippet || item.description || item.content || '').trim(),
    date: String(item.date || item.publishedAt || item.published_at || item.updatedAt || item.updated_at || '未提供').trim(),
    limitations: String(item.limitations || item.limitation || '搜索摘要未经过本工具独立核验。').trim()
  };
}

function normalizeResults(data, maximum = 5) {
  return sourceItems(data).map(normalizeResult).filter(item => item.title || item.url || item.summary).slice(0, Math.min(5, Math.max(0, Number(maximum) || 5)));
}

function createSearchClient(config = {}, { fetchImpl = globalThis.fetch, timeoutMs = SEARCH_TIMEOUT_MS } = {}) {
  const baseUrl = String(config.baseUrl || '').replace(/\/$/, '');

  async function search(query, options = {}) {
    if (!isConfigured(config)) {
      return { configured: false, code: SEARCH_CODES.NOT_CONFIGURED, retryable: false, message: searchMessage(SEARCH_CODES.NOT_CONFIGURED), results: [] };
    }
    if (typeof fetchImpl !== 'function') {
      return { configured: true, ...normalizeSearchError(), message: searchMessage(SEARCH_CODES.REQUEST_FAILED), results: [] };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || timeoutMs);
    try {
      const response = await fetchImpl(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ query, max_results: Math.min(5, Math.max(1, Number(options.maxResults) || 5)) }),
        signal: controller.signal
      });
      const raw = await response.text();
      let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      if (!response.ok) {
        const normalized = normalizeSearchError({ status: response.status });
        return { configured: true, ...normalized, message: searchMessage(normalized.code), results: [] };
      }
      return { configured: true, results: normalizeResults(data, options.maxResults) };
    } catch (error) {
      const normalized = normalizeSearchError(error);
      return { configured: true, ...normalized, message: searchMessage(normalized.code), results: [] };
    } finally {
      clearTimeout(timer);
    }
  }

  return { configured: isConfigured(config), search };
}

module.exports = { SEARCH_TIMEOUT_MS, SEARCH_CODES, normalizeSearchError, normalizeResult, normalizeResults, createSearchClient };
