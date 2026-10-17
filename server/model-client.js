const MODEL_TIMEOUT_MS = 30_000;

const MODEL_CODES = Object.freeze({
  NOT_CONFIGURED: 'MODEL_NOT_CONFIGURED',
  AUTH_FAILED: 'MODEL_AUTH_FAILED',
  RATE_LIMITED: 'MODEL_RATE_LIMITED',
  UPSTREAM_ERROR: 'MODEL_UPSTREAM_ERROR',
  TIMEOUT: 'MODEL_TIMEOUT',
  EMPTY_RESPONSE: 'MODEL_EMPTY_RESPONSE',
  REQUEST_FAILED: 'MODEL_REQUEST_FAILED'
});

function normalizeModelError(error = {}) {
  const status = Number(error.status || error.statusCode);
  const message = String(error.code || error.message || '').toUpperCase();
  if (message.includes(MODEL_CODES.NOT_CONFIGURED)) return { code: MODEL_CODES.NOT_CONFIGURED, retryable: false };
  if (error.name === 'AbortError' || message.includes('TIMEOUT')) return { code: MODEL_CODES.TIMEOUT, retryable: true };
  if (status === 401 || message.includes('401')) return { code: MODEL_CODES.AUTH_FAILED, retryable: false };
  if (status === 429 || message.includes('429')) return { code: MODEL_CODES.RATE_LIMITED, retryable: true };
  if (status >= 500 && status <= 599 || message.includes('5XX')) return { code: MODEL_CODES.UPSTREAM_ERROR, retryable: true };
  if (message.includes(MODEL_CODES.EMPTY_RESPONSE)) return { code: MODEL_CODES.EMPTY_RESPONSE, retryable: false };
  return { code: MODEL_CODES.REQUEST_FAILED, retryable: false };
}

function modelMessage(code) {
  const messages = {
    [MODEL_CODES.NOT_CONFIGURED]: '尚未配置模型，仍可复制提示词交给其他 AI。',
    [MODEL_CODES.AUTH_FAILED]: '模型服务拒绝了凭证，请检查配置。',
    [MODEL_CODES.RATE_LIMITED]: '模型服务暂时限流，请稍后重试。',
    [MODEL_CODES.UPSTREAM_ERROR]: '模型服务暂时不可用，请稍后重试。',
    [MODEL_CODES.TIMEOUT]: '模型请求超过 30 秒，已停止等待。',
    [MODEL_CODES.EMPTY_RESPONSE]: '模型没有返回可用内容。',
    [MODEL_CODES.REQUEST_FAILED]: '模型请求失败，仍可复制提示词继续。'
  };
  return messages[code] || messages[MODEL_CODES.REQUEST_FAILED];
}

function isConfigured(config) {
  return Boolean(config?.baseUrl && config?.name && config?.apiKey);
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
  if (Array.isArray(content)) return content.map(item => item?.text || item?.content || '').join('').trim();
  return typeof content === 'string' ? content.trim() : '';
}

function createModelClient(config = {}, { fetchImpl = globalThis.fetch, timeoutMs = MODEL_TIMEOUT_MS } = {}) {
  const baseUrl = String(config.baseUrl || '').replace(/\/$/, '');
  const name = String(config.name || '');

  async function request(messages, options = {}) {
    if (!isConfigured(config)) {
      return { configured: false, code: MODEL_CODES.NOT_CONFIGURED, retryable: false, message: modelMessage(MODEL_CODES.NOT_CONFIGURED) };
    }
    if (typeof fetchImpl !== 'function') {
      return { configured: true, code: MODEL_CODES.REQUEST_FAILED, retryable: false, message: modelMessage(MODEL_CODES.REQUEST_FAILED) };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: name, messages, temperature: options.temperature ?? 0.2 }),
        signal: controller.signal
      });
      const raw = await response.text();
      let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      if (!response.ok) {
        const normalized = normalizeModelError({ status: response.status });
        return { configured: true, ...normalized, message: modelMessage(normalized.code) };
      }
      const text = extractText(data);
      if (!text) {
        return { configured: true, code: MODEL_CODES.EMPTY_RESPONSE, retryable: false, message: modelMessage(MODEL_CODES.EMPTY_RESPONSE) };
      }
      return { configured: true, text, model: name };
    } catch (error) {
      const normalized = normalizeModelError(error);
      return { configured: true, ...normalized, message: modelMessage(normalized.code) };
    } finally {
      clearTimeout(timer);
    }
  }

  return { configured: isConfigured(config), name, request };
}

module.exports = { MODEL_TIMEOUT_MS, MODEL_CODES, normalizeModelError, createModelClient, extractText };
