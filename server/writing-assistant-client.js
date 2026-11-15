const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 256_000;

const CODES = Object.freeze({
  NOT_CONFIGURED: 'WRITING_ASSISTANT_NOT_CONFIGURED',
  INVALID_CONFIG: 'WRITING_ASSISTANT_INVALID_CONFIG',
  TIMEOUT: 'WRITING_ASSISTANT_TIMEOUT',
  AUTH_FAILED: 'WRITING_ASSISTANT_AUTH_FAILED',
  RATE_LIMITED: 'WRITING_ASSISTANT_RATE_LIMITED',
  REDIRECT_BLOCKED: 'WRITING_ASSISTANT_REDIRECT_BLOCKED',
  PROTOCOL_MISMATCH: 'WRITING_ASSISTANT_PROTOCOL_MISMATCH',
  UPSTREAM_ERROR: 'WRITING_ASSISTANT_UPSTREAM_ERROR',
  INVALID_RESPONSE: 'WRITING_ASSISTANT_INVALID_RESPONSE'
});

function validateBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (!['https:', ...(local ? ['http:'] : [])].includes(url.protocol)
    || url.username || url.password || url.search || url.hash) return null;
  return url.toString().replace(/\/$/, '');
}

function endpointFor(config) {
  const base = new URL(config.baseUrl);
  const prefix = base.pathname.replace(/\/$/, '');
  if (config.mode === 'system-one') {
    base.pathname = `${prefix}${prefix.endsWith('/v1') ? '' : '/v1'}/systemone`;
  } else if (config.mode === 'decisions') {
    base.pathname = `${prefix}${prefix.endsWith('/api/alpha') ? '' : '/api/alpha'}/decisions`;
  } else {
    base.pathname = `${prefix}${prefix.endsWith('/chat/completions') ? '' : '/chat/completions'}`;
  }
  base.pathname = base.pathname.replace(/\/{2,}/g, '/');
  return base.toString();
}

function extractJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = Array.isArray(value)
    ? value.map(item => item?.text || item?.content || '').join('').trim()
    : typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(unfenced); } catch {}
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(unfenced.slice(start, end + 1)); } catch { return null; }
}

function safeError(code, message) {
  return { ok: false, code, message };
}

function validateJevResponse(data, questions) {
  if (!data || typeof data !== 'object' || !data.answers || typeof data.answers !== 'object') return false;
  const expected = Object.keys(questions || {});
  if (!expected.length || expected.some(key => !Object.hasOwn(data.answers, key))) return false;
  return expected.every(key => {
    const answer = data.answers[key];
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return false;
    const expectedType = String(questions[key]?.type || '').toLowerCase();
    const answerType = String(answer.type || '').toLowerCase();
    if (!['choice', 'score', 'noul'].includes(expectedType) || answerType !== expectedType) return false;
    if (expectedType === 'choice') return typeof answer.choice === 'string' || typeof answer.value === 'string';
    if (expectedType === 'score') return Number.isFinite(answer.score ?? answer.value);
    return Number.isFinite(answer.noul ?? answer.value);
  });
}

function validateOpenAiResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value.results) || value.results.length > 20) return false;
  const seen = new Set();
  return value.results.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || !item.id || item.id.length > 160
      || !Number.isFinite(item.relevance) || item.relevance < 0 || item.relevance > 1
      || typeof item.rationale !== 'string' || item.rationale.length > 2_000
      || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function estimateInputTokens(value) {
  // UTF-8 字节估算覆盖完整序列化协议请求，并额外预留协议侧固定开销。
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 3) + 256;
}

function createWritingAssistantClient(config = {}, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const mode = config.mode;
  const baseUrl = validateBaseUrl(config.baseUrl);
  const modelId = typeof config.modelId === 'string' ? config.modelId.trim() : '';
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  const configured = ['system-one', 'decisions', 'openai-chat-completions'].includes(mode)
    && Boolean(baseUrl && modelId && apiKey && typeof fetchImpl === 'function');

  function requestBody(payload) {
    return mode === 'openai-chat-completions'
      ? {
        model: modelId,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '按给定 JSON 契约评估候选材料。只输出 JSON：{"results":[{"id":"候选ID","relevance":0到1之间的数字,"rationale":"简短依据"}]}。不得编造候选。' },
          { role: 'user', content: JSON.stringify(payload) }
        ]
      }
      : { model: modelId, state: payload.state, questions: payload.questions };
  }

  async function request(payload, expectedQuestions = null) {
    if (!configured) return safeError(config.baseUrl && config.modelId ? CODES.INVALID_CONFIG : CODES.NOT_CONFIGURED, '请检查辅助判断服务地址、模型 ID 和 API Key。');
    const controller = new AbortController();
    const requestTimeoutMs = Number.isFinite(Number(timeoutMs))
      ? Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.floor(Number(timeoutMs))))
      : DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    try {
      const body = requestBody(payload);
      response = await fetchImpl(endpointFor({ mode, baseUrl }), {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (response.status >= 300 && response.status < 400) return safeError(CODES.REDIRECT_BLOCKED, '服务返回了重定向；为保护 API Key，本次连接已停止。请检查 Base URL。');
      if (response.status === 401 || response.status === 403) return safeError(CODES.AUTH_FAILED, '辅助判断服务鉴权失败，请检查 API Key 和服务权限。');
      if (response.status === 429) return safeError(CODES.RATE_LIMITED, '辅助判断服务请求过于频繁，请稍后重试。');
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return safeError(CODES.INVALID_RESPONSE, '辅助判断服务响应超出大小限制。');
      let data;
      try { data = JSON.parse(text); } catch { return safeError(CODES.INVALID_RESPONSE, '辅助判断服务返回的内容不是有效 JSON。'); }
      if (!response.ok) {
        const upstreamMessage = String(data?.error?.message || data?.message || '');
        if (/only supports\s+\/v1\/systemone|仅支持.*system ?one/i.test(upstreamMessage)) {
          return safeError(CODES.PROTOCOL_MISMATCH, '当前上游模型仅支持 System One 协议，请将辅助服务协议改为 System One。');
        }
        return safeError(CODES.UPSTREAM_ERROR, `辅助判断服务请求被拒绝（HTTP ${response.status}），请检查协议、模型 ID 和请求参数。`);
      }
      if (mode === 'openai-chat-completions') {
        const content = data?.choices?.[0]?.message?.content;
        const result = extractJsonObject(content);
        if (!validateOpenAiResult(result)) return safeError(CODES.INVALID_RESPONSE, '辅助模型响应不符合要求的 JSON 结构。');
        return { ok: true, protocol: mode, model: modelId, results: result.results };
      }
      if (!validateJevResponse(data, expectedQuestions || payload.questions)) return safeError(CODES.INVALID_RESPONSE, 'Jev 响应缺少有效的类型化答案。');
      return { ok: true, protocol: mode, model: typeof data.model === 'string' ? data.model : modelId, answers: data.answers, usage: data.usage || null };
    } catch (error) {
      return safeError(error?.name === 'AbortError' ? CODES.TIMEOUT : CODES.UPSTREAM_ERROR,
        error?.name === 'AbortError' ? '辅助判断服务连接超时。' : '无法连接辅助判断服务，请检查地址和网络。');
    } finally {
      clearTimeout(timer);
    }
  }

  async function evaluate({ state, questions } = {}) {
    if (typeof state !== 'string' && (!state || typeof state !== 'object' || Array.isArray(state))) return safeError(CODES.INVALID_CONFIG, '辅助判断输入格式无效。');
    if (!questions || typeof questions !== 'object' || Array.isArray(questions) || !Object.keys(questions).length) return safeError(CODES.INVALID_CONFIG, '辅助判断问题格式无效。');
    return request({ state, questions }, questions);
  }

  async function testConnection() {
    const probe = { state: '连接检查：请按固定选项识别此探测请求。', questions: {
      connection_check: { type: 'choice', instructions: '请选择唯一选项。', criteria: { ready: '连接检查请求已收到。', unavailable: '连接检查请求不可用。' } }
    } };
    const result = await request(probe, probe.questions);
    if (!result.ok) return result;
    return { ok: true, protocol: mode, model: result.model, validated: true, message: '连接成功，响应格式有效；此检查不验证第三方模型身份。' };
  }

  async function evaluateCandidates(candidates = [], taskSummary = '') {
    const allItems = Array.isArray(candidates) ? candidates.filter(item => item && typeof item.id === 'string') : [];
    const skipped = [];
    const task = String(taskSummary || '').trim().slice(0, 4_000);
    const selected = [];
    const seenIds = new Set();
    let selectedTokenBudget = 0;
    for (const item of allItems) {
      const candidate = {
        id: item.id.slice(0, 160),
        path: String(item.relativePath || item.title || '').slice(0, 500),
        excerpt: String(item.excerpt || '').slice(0, 900)
      };
      if (!candidate.id || !candidate.excerpt) {
        skipped.push({ id: item.id, reason: '缺少候选标识或可评估摘录' });
        continue;
      }
      if (seenIds.has(candidate.id)) {
        skipped.push({ id: item.id, reason: '候选标识重复，无法安全关联评估结果' });
        continue;
      }
      seenIds.add(candidate.id);
      // System One 的问题 ID 有独立的格式约束，不能直接使用文件路径或候选 ID。
      // 真实文件 ID 保留在 state.candidate.id 中，响应回来后再映射回去。
      const questionId = `candidate_${selected.length}`;
      const payload = mode === 'openai-chat-completions'
        ? { state: { taskSummary: task, candidates: [candidate] }, questions: { candidate: { type: 'choice', instructions: '只评估提供的这一份材料，返回 results 数组，给出 0 到 1 的相关度和简短依据。' } } }
        : {
          state: JSON.stringify({ taskSummary: task, candidate }),
          questions: { [questionId]: { type: 'score', instructions: '只评估提供的这一份材料，结合任务目标给出0到1之间的相关度。' } }
        };
      const estimatedTokens = estimateInputTokens(requestBody(payload));
      if (selectedTokenBudget + estimatedTokens <= 4_000) {
        selected.push({ candidate, payload, questionId, estimatedTokens });
        selectedTokenBudget += estimatedTokens;
      } else skipped.push({ id: item.id, reason: '完整协议请求超过4,000 token累计预算' });
    }
    const estimatedTokens = selectedTokenBudget;
    if (!selected.length) return { ok: true, protocol: mode, model: modelId, results: [], evaluatedIds: [], unevaluated: skipped, estimatedTokens };

    const results = [];
    const requestFailures = [];
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < selected.length) {
        const index = nextIndex++;
        const entry = selected[index];
        const result = await request(entry.payload, entry.payload.questions);
        if (!result.ok) {
          requestFailures.push({ id: entry.candidate.id, reason: `${result.message || '辅助服务请求失败'}，交由主模型复核` });
          continue;
        }
        if (mode === 'openai-chat-completions') {
          const matching = result.results.filter(item => item.id === entry.candidate.id);
          if (result.results.some(item => item.id !== entry.candidate.id) || matching.length !== 1) {
            requestFailures.push({ id: entry.candidate.id, reason: '辅助响应未准确覆盖该候选，交由主模型复核' });
            continue;
          }
          results.push(matching[0]);
          continue;
        }
        const answer = result.answers?.[entry.questionId];
        const value = Number(answer?.score ?? answer?.value);
        if (!Number.isFinite(value)) {
          requestFailures.push({ id: entry.candidate.id, reason: '辅助响应缺少有效评分，交由主模型复核' });
          continue;
        }
        results.push({ id: entry.candidate.id, relevance: Math.max(0, Math.min(1, value)), rationale: '辅助模型返回的相关度评分。' });
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, selected.length) }, () => worker()));
    const evaluatedIds = results.map(item => item.id);
    const evaluatedSet = new Set(evaluatedIds);
    const failedIds = new Set(requestFailures.map(item => item.id));
    const notReturned = selected.filter(entry => !evaluatedSet.has(entry.candidate.id) && !failedIds.has(entry.candidate.id))
      .map(entry => ({ id: entry.candidate.id, reason: '辅助响应未覆盖该候选，交由主模型复核' }));
    return { ok: true, protocol: mode, model: modelId, results, evaluatedIds,
      unevaluated: [...skipped, ...requestFailures, ...notReturned], estimatedTokens };
  }

  return { configured, mode, baseUrl, modelId, evaluate, evaluateCandidates, testConnection };
}

module.exports = { CODES, createWritingAssistantClient, validateBaseUrl, endpointFor, extractJsonObject, validateJevResponse, validateOpenAiResult, estimateInputTokens };
