const test = require('node:test');
const assert = require('node:assert/strict');

const workflow = require('../prototype/social-research-workflow.js');
const prompts = require('../prototype/social-research-prompts.js');

const {
  createResearchPlan,
  startResearchTask,
  approveResearchPlan,
  rejectResearchPlan,
  transitionResearchTask,
  consumeResearchBudget,
  approveSupplementarySearch,
  decideConnectionMode,
  shouldFallbackToBrowser,
  canRequestSupplementarySearch
} = workflow;

function makePlan(overrides = {}) {
  return createResearchPlan({
    topic: '小红书上的独立开发工具体验',
    template: 'pain-points',
    platforms: ['xiaohongshu', 'reddit', 'youtube'],
    ...overrides
  });
}

function approve(overrides = {}) {
  return approveResearchPlan(makePlan(overrides));
}

test('创建计划需要用户确认，未确认不能启动，批准后进入平台准备', () => {
  const planned = makePlan();

  assert.equal(planned.status, 'awaiting_confirmation');
  assert.throws(() => startResearchTask(planned), error => (
    error.code === 'PLAN_NOT_CONFIRMED' && /确认/.test(error.message)
  ));

  const approved = approveResearchPlan(planned);
  assert.equal(approved.status, 'preparing_platforms');
  assert.equal(approved.approved, true);
});

test('未批准、已取消或已拒绝的任务不能进入搜索', () => {
  const planned = makePlan();
  const cancelled = rejectResearchPlan(planned, '用户取消');

  assert.equal(cancelled.status, 'cancelled');
  assert.throws(() => startResearchTask(cancelled), error => error.code === 'TASK_CANCELLED');
  assert.throws(() => transitionResearchTask(cancelled, 'start_search'), error => error.code === 'TASK_CANCELLED');
  assert.throws(() => transitionResearchTask(planned, 'start_search'), error => error.code === 'PLAN_NOT_CONFIRMED');
});

test('状态迁移只允许批准后的确定性顺序', () => {
  const approved = approve();
  const searching = startResearchTask(approved);
  const reportReady = transitionResearchTask(searching, 'report_ready');

  assert.equal(searching.status, 'searching');
  assert.equal(reportReady.status, 'report_ready');
  assert.throws(() => transitionResearchTask(reportReady, 'start_search'), error => (
    error.code === 'INVALID_TRANSITION'
  ));
});

test('补搜确认不能被 startResearchTask 绕过，取消任务也不能推进', () => {
  const approved = approve({ platforms: ['reddit'], budget: { maxQueriesPerPlatform: 2 } });
  const searching = startResearchTask(approved);
  const reportReady = transitionResearchTask(searching, 'report_ready');
  const waiting = transitionResearchTask(reportReady, {
    type: 'request_supplementary',
    request: { platform: 'reddit', queries: 1 }
  });

  assert.equal(waiting.status, 'awaiting_supplementary_confirmation');
  assert.throws(() => startResearchTask(waiting), error => error.code === 'SUPPLEMENTARY_CONFIRMATION_REQUIRED');
  const cancelled = rejectResearchPlan(waiting, '用户取消');
  assert.throws(() => approveSupplementarySearch(cancelled, { platform: 'reddit', queries: 1 }), error => error.code === 'TASK_CANCELLED');
});

test('批准补搜在同一校验中消费预算，超预算不部分消费', () => {
  const approved = approve({ platforms: ['reddit'], budget: { maxQueriesPerPlatform: 2 } });
  const waiting = transitionResearchTask(
    transitionResearchTask(startResearchTask(approved), 'report_ready'),
    'request_supplementary'
  );
  const first = approveSupplementarySearch(waiting, { platform: 'reddit', queries: 1 });
  assert.equal(first.code, 'ok');
  assert.equal(first.status, 'searching');
  assert.equal(first.budgetUsage.queriesByPlatform.reddit, 1);

  const waitingWithPlatforms = transitionResearchTask(
    transitionResearchTask(first.task, 'report_ready'),
    'request_supplementary'
  );
  const second = approveSupplementarySearch(waitingWithPlatforms, { platforms: ['reddit'], queries: 1 });
  assert.equal(second.code, 'ok');
  assert.equal(second.budgetUsage.platforms, 0);
  assert.equal(second.budgetUsage.queriesByPlatform.reddit, 2);

  const waitingAgain = transitionResearchTask(
    transitionResearchTask(second.task, 'report_ready'),
    'request_supplementary'
  );
  const exceeded = approveSupplementarySearch(waitingAgain, { platform: 'reddit', queries: 2 });
  assert.equal(exceeded.code, 'budget_exceeded');
  assert.equal(exceeded.status, 'awaiting_supplementary_confirmation');
  assert.equal(exceeded.budgetUsage.queriesByPlatform.reddit, 2);
});

test('平台、查询、翻页、详情、时间、附件和分析 token 超预算返回 budget_exceeded', () => {
  const limits = {
    maxPlatforms: 1,
    maxQueriesPerPlatform: 1,
    maxPages: 1,
    maxDetails: 1,
    maxDurationMs: 100,
    maxAttachmentBytes: 10,
    maxAnalysisTokens: 10
  };
  const task = approve({ platforms: ['reddit'], budget: limits });
  const cases = [
    { platforms: 2 },
    { queries: { reddit: 2 } },
    { pages: 2 },
    { details: 2 },
    { durationMs: 101 },
    { attachmentBytes: 11 },
    { analysisTokens: 11 }
  ];

  for (const usage of cases) {
    const result = consumeResearchBudget(task, usage);
    assert.equal(result.code, 'budget_exceeded', JSON.stringify(usage));
    assert.equal(result.ok, false);
  }
});

test('预算消费成功后只允许在剩余预算内补搜', () => {
  const task = approve({
    platforms: ['reddit'],
    budget: { maxQueriesPerPlatform: 2, maxPages: 2 }
  });
  const consumed = consumeResearchBudget(task, { queries: { reddit: 1 }, pages: 1 });
  const next = consumed.task;

  assert.equal(consumed.code, 'ok');
  assert.equal(canRequestSupplementarySearch(next, { platform: 'reddit', queries: 1, pages: 1 }), true);
  assert.equal(canRequestSupplementarySearch(next, { platform: 'reddit', queries: 2, pages: 1 }), false);
  assert.equal(canRequestSupplementarySearch(task, { platform: 'reddit', queries: 1 }), false);
});

test('连接策略遵守 API、浏览器和自动偏好', () => {
  const apiConnection = { apiAvailable: true, apiConfigured: true, browserAvailable: true };
  const browserOnly = { apiAvailable: false, browserAvailable: true };

  assert.equal(decideConnectionMode('reddit', browserOnly, 'auto'), 'browser');
  assert.equal(decideConnectionMode('reddit', apiConnection, 'auto'), 'api');
  assert.equal(decideConnectionMode('reddit', apiConnection, 'api'), 'api');
  assert.equal(decideConnectionMode('reddit', apiConnection, 'browser'), 'browser');
  assert.equal(decideConnectionMode('reddit', { apiAvailable: false, browserAvailable: true }, 'api'), 'api_unavailable');
  assert.equal(decideConnectionMode('reddit', { apiAvailable: true, apiConfigured: false }, 'api'), 'api_unavailable');
  assert.equal(decideConnectionMode('reddit', { apiAvailable: true, apiConfigured: true }, 'browser'), 'browser');
});

test('API 认证失败、超时、限流、空结果、结果不足或字段不完整时建议浏览器', () => {
  const capability = { minimumResults: 2, requiredFields: ['title', 'url'] };
  const failures = [
    { code: 'AUTH_FAILED' },
    { code: 'TIMEOUT' },
    { code: 'RATE_LIMITED' },
    { results: [] },
    { results: [{ title: '只有一条', url: 'https://example.test/1' }] },
    { results: [{ title: '缺少链接' }] }
  ];

  for (const result of failures) assert.equal(shouldFallbackToBrowser(result, capability), true);
  assert.equal(shouldFallbackToBrowser({ results: [
    { title: '完整结果一', url: 'https://example.test/1' },
    { title: '完整结果二', url: 'https://example.test/2' }
  ] }, capability), false);
  assert.equal(shouldFallbackToBrowser({ code: 'AUTH_FAILED' }, capability, 'api'), false);
});

test('四种研究模板提示词要求可解析结构、来源链接和未完成平台', () => {
  for (const template of ['trends', 'pain-points', 'content-competitors', 'fact-check']) {
    const prompt = prompts.buildResearchPlanPrompt({
      topic: '独立开发工具',
      template,
      platforms: ['reddit']
    });
    assert.match(prompt, /JSON|结构化/);
    assert.match(prompt, /链接|URL/);
    assert.match(prompt, /未完成平台/);
    assert.match(prompt, /高热度.*事实|事实.*高热度/);
  }
});

test('补搜和报告提示词要求证据可追溯且不为无链接结果生成结论', () => {
  const task = approve({ platforms: ['reddit'] });
  const supplementary = prompts.buildSupplementarySearchPrompt(task, '缺少反例和发布时间');
  const report = prompts.buildResearchReportPrompt(task, [
    { id: 'result-1', platform: 'reddit', title: '结果', url: 'https://example.test/1' }
  ]);

  for (const prompt of [supplementary, report]) {
    assert.match(prompt, /结构化|JSON/);
    assert.match(prompt, /链接|URL/);
    assert.match(prompt, /追溯|来源/);
  }
  assert.match(report, /没有.*链接|无.*链接/);
});

test('提示词会脱敏主题、证据缺口和结果摘要中的疑似凭证', () => {
  const secret = 'sk-live-1234567890abcdef';
  const plan = prompts.buildResearchPlanPrompt({ topic: `研究主题 password=${secret}`, platforms: ['reddit'] });
  const supplementary = prompts.buildSupplementarySearchPrompt(
    { id: 'task-1', topic: '正常中文主题', template: 'pain-points', platforms: ['reddit'], budget: {}, budgetUsage: {}, status: 'awaiting_supplementary_confirmation' },
    `缺口 token: ${secret}`
  );
  const report = prompts.buildResearchReportPrompt(
    { id: 'task-1', topic: '正常中文主题', template: 'pain-points', platforms: ['reddit'] },
    [{ id: 'r1', platform: 'reddit', title: '结果', url: 'https://example.test/1', summary: `摘要 secret=${secret}` }]
  );

  for (const prompt of [plan, supplementary, report]) {
    assert.equal(prompt.includes(secret), false);
    assert.match(prompt, /REDACTED_SENSITIVE_VALUE/);
  }
  assert.match(plan, /研究主题/);
});
