const assert = require('node:assert/strict');
const test = require('node:test');
const { CODES, createWritingAssistantClient, endpointFor, estimateInputTokens } = require('../server/writing-assistant-client');

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

test('System One 和 Decisions 使用各自路由并验证类型化 Jev 答案', async () => {
  for (const [mode, suffix] of [['system-one', '/v1/systemone'], ['decisions', '/api/alpha/decisions']]) {
    let request;
    const client = createWritingAssistantClient({ mode, baseUrl: 'https://jev.example', modelId: 'jev-model', apiKey: 'secret' }, {
      fetchImpl: async (url, options) => {
        request = { url, options };
        return response({ answers: { relevant: { type: 'Choice', choice: 'yes' } } });
      }
    });
    const result = await client.evaluate({ state: '候选材料', questions: { relevant: { type: 'Choice' } } });
    assert.equal(result.ok, true);
    assert.equal(request.url, `https://jev.example${suffix}`);
    assert.equal(request.options.redirect, 'manual');
    assert.equal(request.options.headers.authorization, 'Bearer secret');
    assert.equal(JSON.parse(request.options.body).state, '候选材料');
  }
});

test('OpenAI Chat Completions 使用 JSON 输出并校验结果', async () => {
  let request;
  const client = createWritingAssistantClient({ mode: 'openai-chat-completions', baseUrl: 'https://relay.example/v1', modelId: 'jev-alias', apiKey: 'secret' }, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ choices: [{ message: { content: JSON.stringify({ results: [{ id: 'doc-1', relevance: 0.9, rationale: '匹配目标' }] }) } }] });
    }
  });
  const result = await client.evaluate({ state: { candidates: [{ id: 'doc-1' }] }, questions: { relevant: { type: 'Score' } } });
  assert.equal(request.url, 'https://relay.example/v1/chat/completions');
  assert.deepEqual(JSON.parse(request.options.body).response_format, { type: 'json_object' });
  assert.deepEqual(result.results, [{ id: 'doc-1', relevance: 0.9, rationale: '匹配目标' }]);
});

test('System One 会正确处理已经包含 /v1 的 Base URL', () => {
  assert.equal(endpointFor({ mode: 'system-one', baseUrl: 'https://linxi.chat/v1' }), 'https://linxi.chat/v1/systemone');
  assert.equal(endpointFor({ mode: 'openai-chat-completions', baseUrl: 'https://relay.example/v1' }), 'https://relay.example/v1/chat/completions');
});

test('上游明确只支持 System One 时返回可操作的协议错误', async () => {
  const client = createWritingAssistantClient({ mode: 'openai-chat-completions', baseUrl: 'https://linxi.chat/v1', modelId: 'jev-1.13.0', apiKey: 'secret' }, {
    fetchImpl: async () => response({ error: { message: 'TypeSafe only supports /v1/systemone' } }, 400)
  });
  const result = await client.testConnection();
  assert.equal(result.code, CODES.PROTOCOL_MISMATCH);
  assert.match(result.message, /System One/);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('OpenAI 响应允许代码围栏或前置说明但仍严格校验结果', async () => {
  const client = createWritingAssistantClient({ mode: 'openai-chat-completions', baseUrl: 'https://relay.example/v1', modelId: 'jev-alias', apiKey: 'secret' }, {
    fetchImpl: async () => response({ choices: [{ message: { content: '结果如下：\n```json\n{"results":[{"id":"doc-1","relevance":0.8,"rationale":"匹配"}]}\n```' } }] })
  });
  const result = await client.evaluate({ state: { candidates: [{ id: 'doc-1' }] }, questions: { relevant: { type: 'Score' } } });
  assert.deepEqual(result.results, [{ id: 'doc-1', relevance: 0.8, rationale: '匹配' }]);
});

test('连接测试只发固定探测数据，并分别验证响应结构', async () => {
  let payload;
  const client = createWritingAssistantClient({ mode: 'decisions', baseUrl: 'https://jev.example', modelId: 'jev', apiKey: 'secret' }, {
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return response({ answers: { connection_check: { type: 'Choice', choice: 'ready' } } });
    }
  });
  const result = await client.testConnection();
  assert.equal(result.ok, true);
  assert.match(payload.state, /连接检查/);
  assert.doesNotMatch(JSON.stringify(payload), /用户任务|文件内容|private-task/);
  assert.match(result.message, /不验证第三方模型身份/);
});

test('跨 origin 重定向使用 manual 且失败消息不包含密钥或上游正文', async () => {
  let calls = 0;
  let redirectMode;
  const client = createWritingAssistantClient({ mode: 'openai-chat-completions', baseUrl: 'https://relay.example/v1', modelId: 'model', apiKey: 'top-secret' }, {
    fetchImpl: async (_url, options) => {
      calls += 1;
      redirectMode = options.redirect;
      return { ok: false, status: 302, text: async () => 'top-secret' };
    }
  });
  const result = await client.testConnection();
  assert.equal(result.code, CODES.REDIRECT_BLOCKED);
  assert.equal(redirectMode, 'manual');
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /top-secret/);
});

test('URL 校验拒绝凭证、查询参数和公网 HTTP', async () => {
  for (const baseUrl of ['https://user:pass@example.com/v1', 'https://example.com/v1?key=x', 'http://example.com/v1']) {
    const client = createWritingAssistantClient({ mode: 'openai-chat-completions', baseUrl, modelId: 'model', apiKey: 'secret' });
    assert.equal(client.configured, false);
  }
});

test('辅助判断把任务目标和完整 OpenAI 协议包装纳入预算，超限候选明确留给主模型', async () => {
  const requests = [];
  const client = createWritingAssistantClient({ mode: 'openai-chat-completions', baseUrl: 'https://relay.example/v1', modelId: 'jev-alias', apiKey: 'secret' }, {
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      const payload = JSON.parse(request.messages[1].content);
      return response({ choices: [{ message: { content: JSON.stringify({ results: payload.state.candidates.map(item => ({ id: item.id, relevance: 0.8, rationale: '与目标相关' })) }) } }] });
    }
  });
  const candidates = Array.from({ length: 20 }, (_, index) => ({ id: `doc-${index}`, relativePath: `材料/${index}.md`, excerpt: '中文材料'.repeat(220) }));
  const result = await client.evaluateCandidates(candidates, '为高校新生撰写操作手册');
  const payload = JSON.parse(requests[0].messages[1].content);
  assert.equal(payload.state.taskSummary, '为高校新生撰写操作手册');
  assert.ok(result.results.length > 0 && result.results.length < candidates.length);
  assert.equal(result.unevaluated.length, candidates.length - result.results.length);
  assert.ok(result.unevaluated.every(item => /超过4,000/.test(item.reason)));
  assert.ok(result.estimatedTokens <= 4_000);
  assert.equal(requests.length, result.results.length, '每个候选单独请求，累计预算应统计所有完整请求');
  assert.equal(requests.reduce((sum, request) => sum + estimateInputTokens(request), 0), result.estimatedTokens);
});

test('Jev 不限制候选数量，按协议请求总预算评估并保留未评估原因', async () => {
  const requests = [];
  const client = createWritingAssistantClient({ mode: 'decisions', baseUrl: 'https://jev.example', modelId: 'jev-model', apiKey: 'secret' }, {
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      const questions = Object.keys(request.questions);
      return response({ answers: Object.fromEntries(questions.map(id => [id, { type: 'Score', score: 0.7 }])) });
    }
  });
  const candidates = Array.from({ length: 53 }, (_, index) => ({ id: `doc-${index}`, relativePath: `${index}.md`, excerpt: '摘录' }));
  const result = await client.evaluateCandidates(candidates, '根据目标挑选材料');
  assert.ok(result.results.length > 0 && result.results.length < candidates.length);
  assert.equal(result.unevaluated.length, candidates.length - result.results.length);
  assert.ok(result.unevaluated.every(item => /超过4,000/.test(item.reason)), '未评估项只由累计输入预算限制');
  assert.ok(result.estimatedTokens <= 4_000);
  assert.equal(requests.length, result.results.length);
  assert.equal(requests.reduce((sum, request) => sum + estimateInputTokens(request), 0), result.estimatedTokens);
  assert.ok(requests.every(request => /根据目标挑选材料/.test(request.state)));
});

test('System One 评估使用安全问题键，并映射回真实文件 ID', async () => {
  let request;
  const client = createWritingAssistantClient({ mode: 'system-one', baseUrl: 'https://jev.example/v1', modelId: 'jev-model', apiKey: 'secret' }, {
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      const questionId = Object.keys(request.questions)[0];
      return response({ answers: { [questionId]: { type: 'Score', score: 0.93 } } });
    }
  });
  const result = await client.evaluateCandidates([{
    id: 'search:folder-1792812952637-ptngd:student_growth_lite1/frontend/.trae/specs/six_dimensions_improvement/spec.md',
    relativePath: 'student_growth_lite1/frontend/.trae/specs/six_dimensions_improvement/spec.md',
    excerpt: '与任务相关的中文材料摘录'
  }], '根据项目材料生成操作手册改写提示词');
  const questionId = Object.keys(request.questions)[0];
  assert.match(questionId, /^candidate_\d+$/);
  assert.equal(result.results[0].id, 'search:folder-1792812952637-ptngd:student_growth_lite1/frontend/.trae/specs/six_dimensions_improvement/spec.md');
  assert.equal(result.results[0].relevance, 0.93);
});
