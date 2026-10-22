const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const schema = require('../prototype/social-research-schema.js');
const workflow = require('../prototype/social-research-workflow.js');
const prompts = require('../prototype/social-research-prompts.js');

const platforms = ['xiaohongshu', 'bilibili', 'weibo'];

function makePlan(overrides = {}) {
  return workflow.createResearchPlan({
    topic: '小红书上的独立开发工具体验',
    template: 'pain-points',
    platforms,
    ...overrides
  });
}

test('新建研究只接受四个国内平台且拒绝空值、未知值与重复项', () => {
  assert.deepEqual(workflow.assertDomesticPlatformList(['xiaohongshu', 'bilibili', 'weibo', 'zhihu']), [
    'xiaohongshu', 'bilibili', 'weibo', 'zhihu'
  ]);
  for (const value of [undefined, [], ['reddit'], ['xiaohongshu', 'youtube'], ['xiaohongshu', 'xiaohongshu']]) {
    assert.throws(() => workflow.assertDomesticPlatformList(value), TypeError);
  }
});

function startPreparedTask(task) {
  const prepared = workflow.transitionResearchTask(task, { type: 'prepared', platforms: task.platforms });
  return workflow.startResearchTask(prepared);
}

function expectBudgetExceeded(task, usage) {
  assert.throws(
    () => workflow.consumeResearchBudget(task, usage),
    error => error.code === 'budget_exceeded'
  );
}

test('计划使用 schema 状态并等待用户确认，且接受 schema 标准结构', () => {
  const planned = makePlan();
  assert.equal(planned.status, 'awaiting-plan-confirmation');
  assert.deepEqual(planned.platforms, platforms);
  assert.equal(planned.plan.objective, '小红书上的独立开发工具体验');
  assert.equal(planned.plan.researchType, 'pain-points');
  assert.equal(schema.normalizeResearchPlan(planned.plan).researchType, 'pain-points');
});

test('未批准不能开始或消耗搜索预算，批准后进入平台准备状态', () => {
  const planned = makePlan();
  assert.throws(() => workflow.startResearchTask(planned), /确认/);
  assert.throws(() => workflow.consumeResearchBudget(planned, { queries: 1 }), /确认/);
  const approved = workflow.approveResearchPlan(planned);
  assert.equal(approved.status, 'awaiting-platform-preparation');
  assert.equal(planned.status, 'awaiting-plan-confirmation');
  assert.throws(() => workflow.startResearchTask(approved), /至少需要一个已准备的平台/);
  assert.throws(() => workflow.startResearchTask(approved, platforms), /至少需要一个已准备的平台/);
});

test('准备的平台必须属于计划，至少一个平台就绪后才能开始', () => {
  const approved = workflow.approveResearchPlan(makePlan());
  const partial = workflow.transitionResearchTask(approved, { type: 'prepared', platforms: platforms.slice(0, 2) });
  assert.equal(partial.status, 'awaiting-platform-preparation');
  assert.deepEqual(partial.preparedPlatforms, platforms.slice(0, 2));
  assert.equal(workflow.startResearchTask(partial).status, 'searching');
  assert.throws(() => workflow.startResearchTask(approved), /至少需要一个已准备的平台/);
  const ready = workflow.transitionResearchTask(partial, { type: 'prepared', platforms });
  assert.deepEqual(ready.preparedPlatforms, platforms);
  assert.equal(workflow.startResearchTask(ready).status, 'searching');
  assert.throws(() => workflow.transitionResearchTask(approved, { type: 'start' }), /至少需要一个已准备的平台/);
  assert.throws(() => workflow.transitionResearchTask(approved, { type: 'prepared', platforms: ['not-planned'] }), /不在已批准计划/);
});

test('没有平台就绪时通过明确的失败转换终止', () => {
  const approved = workflow.approveResearchPlan(makePlan());
  const failed = workflow.transitionResearchTask(approved, { type: 'preparation_failed' });
  assert.equal(failed.status, 'failed');
  assert.throws(() => workflow.startResearchTask(failed), /取消或终止/);
  assert.throws(() => workflow.transitionResearchTask(failed, { type: 'preparation_failed' }), /取消或终止/);
});

test('拒绝和取消后任务不可继续推进', () => {
  const rejected = workflow.rejectResearchPlan(makePlan(), '范围太大');
  assert.equal(rejected.status, 'cancelled');
  assert.throws(() => workflow.startResearchTask(rejected), /取消|终止/);
  const cancelled = workflow.transitionResearchTask(workflow.approveResearchPlan(makePlan()), { type: 'cancel' });
  assert.equal(cancelled.status, 'cancelled');
  assert.throws(() => workflow.transitionResearchTask(cancelled, { type: 'start' }), /取消|终止/);
});

test('每类预算超限都以 budget_exceeded 拒绝且不修改原任务', () => {
  assert.throws(
    () => makePlan({ platforms: [...platforms, 'tiktok'], budget: { maxPlatforms: 4 } }),
    TypeError
  );
  assert.throws(
    () => makePlan({ platforms: [...platforms, 'zhihu'], budget: { maxPlatforms: 3 } }),
    error => error.code === 'budget_exceeded'
  );
  assert.throws(
    () => makePlan({ queries: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] }),
    error => error.code === 'budget_exceeded'
  );
  const task = startPreparedTask(workflow.approveResearchPlan(makePlan({
    budget: {
      maxPlatforms: 3,
      maxQueriesPerPlatform: 2,
      maxPages: 2,
      maxDetails: 2,
      maxDurationMs: 1000,
      maxAttachmentBytes: 100
    }
  })));
  const cases = [
    { platforms: 4 },
    { platform: 'xiaohongshu', queries: 3 },
    { pages: 3 },
    { details: 3 },
    { durationMs: 1001 },
    { attachmentBytes: 101 },
    { analysisTokens: 10001 }
  ];
  const originalUsage = structuredClone(task.usage);
  for (const usage of cases) expectBudgetExceeded(task, usage);
  assert.throws(
    () => workflow.consumeResearchBudget(task, { platform: 'xiaohongshu', queries: 0, queriesPerPlatform: 100 }),
    TypeError
  );
  expectBudgetExceeded(task, { platform: 'xiaohongshu', queries: 3, queriesPerPlatform: 3 });
  assert.deepEqual(task.usage, originalUsage);
  const consumed = workflow.consumeResearchBudget(task, { platform: 'xiaohongshu', queries: 1 });
  assert.equal(consumed.usage.platforms, 1);
  assert.deepEqual(consumed.usage.queriesByPlatform, { xiaohongshu: 1 });
  assert.equal(task.usage.platforms, 0);
});

test('模型实际用量即使意外超预算也要记录，阻止后续继续消耗', () => {
  const task = startPreparedTask(workflow.approveResearchPlan(makePlan({
    budget: { maxAnalysisTokens: 100 }
  })));
  const recorded = workflow.recordAnalysisTokens(task, 120);
  assert.equal(recorded.usage.analysisTokens, 120);
  assert.equal(recorded.usage.analysisTokensEstimated, false);
  assert.equal(task.usage.analysisTokens, 0);
  assert.equal(workflow.recordAnalysisTokens(task, 12, { estimated: true }).usage.analysisTokensEstimated, true);
  assert.equal(workflow.canRequestSupplementarySearch(recorded, { platform: 'xiaohongshu', analysisTokens: 1 }).allowed, false);
  assert.throws(() => workflow.recordAnalysisTokens(recorded, -1), TypeError);
});

test('查询计量必须带平台或使用逐平台 map，并对重复调用累计', () => {
  const task = startPreparedTask(workflow.approveResearchPlan(makePlan({
    budget: { maxQueriesPerPlatform: 2 }
  })));
  assert.throws(() => workflow.consumeResearchBudget(task, { queries: 1 }), TypeError);
  assert.throws(() => workflow.consumeResearchBudget(task, { queriesPerPlatform: 1 }), TypeError);
  let used = workflow.consumeResearchBudget(task, { platform: 'xiaohongshu', queries: 1 });
  used = workflow.consumeResearchBudget(used, { platform: 'xiaohongshu', queriesPerPlatform: 1 });
  assert.equal(used.usage.queriesByPlatform.xiaohongshu, 2);
  expectBudgetExceeded(used, { platform: 'xiaohongshu', queries: 1 });
  used = workflow.consumeResearchBudget(task, { queriesByPlatform: { xiaohongshu: 2, bilibili: 1 } });
  assert.deepEqual(used.usage.queriesByPlatform, { xiaohongshu: 2, bilibili: 1 });
});

test('预算计量拒绝非有限、负数和非整数值，且无效输入不修改旧任务', () => {
  const task = startPreparedTask(workflow.approveResearchPlan(makePlan()));
  const invalidInputs = [];
  for (const field of ['platforms', 'queries', 'queriesPerPlatform', 'pages', 'details', 'durationMs', 'attachmentBytes', 'analysisTokens']) {
    invalidInputs.push({ [field]: NaN }, { [field]: Infinity }, { [field]: -1 });
  }
  for (const field of ['platforms', 'queries', 'queriesPerPlatform', 'pages', 'details', 'attachmentBytes', 'analysisTokens']) {
    invalidInputs.push({ [field]: 1.5 });
  }
  const original = structuredClone(task);
  for (const usage of invalidInputs) {
    assert.throws(() => workflow.consumeResearchBudget(task, usage), TypeError);
    assert.deepEqual(task, original);
  }
  assert.equal(workflow.consumeResearchBudget(task, { durationMs: 0.5 }).usage.durationMs, 0.5);
});

test('补搜只允许在已批准预算剩余额度内进行', () => {
  const task = startPreparedTask(workflow.approveResearchPlan(makePlan({
    budget: { maxQueriesPerPlatform: 2 }
  })));
  assert.equal(workflow.canRequestSupplementarySearch(task, { platform: 'xiaohongshu', queries: 1 }).allowed, true);
  const used = workflow.consumeResearchBudget(task, { platform: 'xiaohongshu', queries: 2 });
  assert.equal(workflow.canRequestSupplementarySearch(used, { platform: 'xiaohongshu', queries: 1 }).allowed, false);
  const analysisUsed = workflow.consumeResearchBudget(task, { analysisTokens: 9000 });
  assert.equal(analysisUsed.usage.analysisTokens, 9000);
  assert.equal(workflow.canRequestSupplementarySearch(analysisUsed, { analysisTokens: 1001 }).allowed, false);
  assert.equal(workflow.canRequestSupplementarySearch(analysisUsed, { analysisTokens: 1000 }).allowed, true);
  assert.equal(workflow.canRequestSupplementarySearch(used, { platform: 'tiktok', platforms: ['tiktok'] }).allowed, false);
});

test('补搜规范化单平台数组、累计平台预算并要求多平台逐平台查询 map', () => {
  const task = startPreparedTask(workflow.approveResearchPlan(makePlan({
    budget: { maxPlatforms: 3, maxQueriesPerPlatform: 2 }
  })));
  const single = workflow.canRequestSupplementarySearch(task, { platforms: [' XIAOHONGSHU '], queries: 1 });
  assert.equal(single.allowed, true);
  assert.equal(single.usage.platform, 'xiaohongshu');
  let used = single.task;
  const second = workflow.canRequestSupplementarySearch(used, { platforms: ['bilibili'], queries: 1 });
  assert.equal(second.allowed, true);
  used = second.task;
  assert.deepEqual(used.usage.usedPlatforms, ['xiaohongshu', 'bilibili']);
  const third = workflow.canRequestSupplementarySearch(used, { platforms: ['weibo'], queries: 1 });
  assert.equal(third.allowed, true);
  used = third.task;
  assert.equal(used.usage.platforms, 3);
  const limitedTask = { ...task, budget: { ...task.budget, maxPlatforms: 2 } };
  const firstLimited = workflow.canRequestSupplementarySearch(limitedTask, { platforms: ['xiaohongshu'], queries: 1 });
  const secondLimited = workflow.canRequestSupplementarySearch(firstLimited.task, { platforms: ['bilibili'], queries: 1 });
  assert.equal(secondLimited.allowed, true);
  const thirdLimited = workflow.canRequestSupplementarySearch(secondLimited.task, { platforms: ['weibo'], queries: 1 });
  assert.equal(thirdLimited.allowed, false);
  assert.equal(workflow.canRequestSupplementarySearch(task, { platforms: ['unknown'] }).allowed, false);
  assert.equal(workflow.canRequestSupplementarySearch(task, {
    platform: 'unknown',
    platforms: ['xiaohongshu', 'bilibili'],
    queriesByPlatform: { xiaohongshu: 1, bilibili: 1 }
  }).allowed, false);
  assert.equal(workflow.canRequestSupplementarySearch(task, { platforms: ['xiaohongshu', 'bilibili'], queries: 1 }).allowed, false);
  const multi = workflow.canRequestSupplementarySearch(task, {
    platforms: ['xiaohongshu', 'bilibili'],
    queriesByPlatform: { xiaohongshu: 1, bilibili: 2 }
  });
  assert.equal(multi.allowed, true);
  assert.deepEqual(multi.usage.queriesByPlatform, { xiaohongshu: 1, bilibili: 2 });
});

test('补搜仅在 searching 状态开放', () => {
  const draft = makePlan();
  const awaitingPreparation = workflow.approveResearchPlan(draft);
  const searching = startPreparedTask(awaitingPreparation);
  const reportReady = workflow.transitionResearchTask(searching, { type: 'finish' });
  const awaitingSave = workflow.transitionResearchTask(reportReady, { type: 'request_save' });
  for (const task of [draft, awaitingPreparation, awaitingSave]) {
    assert.equal(workflow.canRequestSupplementarySearch(task, { platform: 'xiaohongshu', queries: 1 }).allowed, false);
  }
  assert.equal(workflow.canRequestSupplementarySearch(searching, { platform: 'xiaohongshu', queries: 1 }).allowed, true);
});

test('连接偏好尊重能力和明确选择，并在 auto 下检查 API 结果质量', () => {
  assert.equal(workflow.decideConnectionMode('xiaohongshu', { apiConfigured: false, browserAvailable: true }, 'auto'), 'browser');
  assert.equal(workflow.decideConnectionMode('xiaohongshu', { apiConfigured: true, browserAvailable: true }, 'auto'), 'api');
  assert.equal(workflow.decideConnectionMode('xiaohongshu', { apiConfigured: true, browserAvailable: true }, 'browser'), 'browser');
  assert.equal(workflow.decideConnectionMode('xiaohongshu', { apiConfigured: true, browserAvailable: true }, 'api'), 'api');
  assert.throws(
    () => workflow.decideConnectionMode('xiaohongshu', { apiConfigured: false, browserAvailable: true }, 'api'),
    error => error.code === 'api_unavailable' && /API/.test(error.message)
  );
  assert.throws(
    () => workflow.decideConnectionMode('xiaohongshu', { apiConfigured: true, status: 'not-ready' }, 'api'),
    error => error.code === 'api_unavailable'
  );
  assert.equal(workflow.decideConnectionMode('xiaohongshu', { apiConfigured: false, browserAvailable: true }, 'auto'), 'browser');
  const capability = { minimumResults: 2, requiredFields: ['url', 'title'] };
  for (const apiResult of [
    { status: 'error', code: 'API_DOWN', message: 'timeout' },
    { status: 'ok', results: [{ url: 'https://a.test', title: 'a' }] },
    { status: 'ok', results: [{ url: 'https://a.test', title: 'a' }, { url: 'https://b.test' }] }
  ]) assert.equal(workflow.shouldFallbackToBrowser(apiResult, capability), true);
  assert.equal(workflow.shouldFallbackToBrowser({ status: 'ok', results: [] }, capability), false);
  assert.equal(workflow.shouldFallbackToBrowser({ status: 'ok', results: [
    { url: 'https://a.test', title: 'a' }, { url: 'https://b.test', title: 'b' }
  ] }, capability), false);
  for (const apiResult of [
    { status: 'error', code: 'RATE_LIMITED' },
    { status: 'error', code: 'SOCIAL_API_RATE_LIMITED' },
    { status: 'error', code: 'SOCIAL_API_AUTH_FAILED' },
    { status: 'error', code: 'SOCIAL_API_PERMISSION_DENIED' },
    { status: 'error', code: 'MANUAL_VERIFICATION_REQUIRED' },
    { status: 'restricted', code: 'RESTRICTED' },
    { status: 'error', code: 'UNSUPPORTED_PAGE' }
  ]) assert.equal(workflow.shouldFallbackToBrowser(apiResult, capability), false);
  assert.equal(workflow.shouldFallbackToBrowser({ status: 'error', code: 'SOCIAL_API_UNSUPPORTED_CAPABILITY' }, capability), true);
  assert.equal(workflow.shouldFallbackToBrowser({ ok: false, error: 'timeout' }, { preference: 'api' }), false);
  assert.equal(workflow.shouldFallbackToBrowser({ error: 'timeout' }, { preference: 'browser' }), false);
});

test('提示词覆盖四种模板并要求结构化输出、证据边界和来源链接', () => {
  const templates = ['trends', 'pain-points', 'content-competitors', 'fact-check'];
  for (const template of templates) {
    const input = { topic: '独立开发工具', template, platforms };
    const planPrompt = prompts.buildResearchPlanPrompt(input);
    const reportPrompt = prompts.buildResearchReportPrompt({ ...makePlan({ template }), plan: { researchType: template } }, []);
    assert.match(planPrompt, /JSON|可解析/);
    assert.match(reportPrompt, /JSON|可解析/);
    assert.match(reportPrompt, /热度.*事实|热度不等于事实/);
    assert.match(reportPrompt, /未完成平台/);
    assert.match(reportPrompt, /链接/);
    assert.match(prompts.buildSupplementarySearchPrompt(makePlan({ template }), '缺少反例'), /JSON|可解析/);
  }
});

test('工作流和提示词同时支持浏览器全局导出', () => {
  for (const [file, globalName, exportName] of [
    ['social-research-workflow.js', 'ForwardStepSocialResearchWorkflow', 'createResearchPlan'],
    ['social-research-prompts.js', 'ForwardStepSocialResearchPrompts', 'buildResearchPlanPrompt']
  ]) {
    const context = {};
    vm.runInNewContext(fs.readFileSync(require.resolve(`../prototype/${file}`), 'utf8'), context);
    assert.equal(typeof context[globalName][exportName], 'function');
  }
});

test('深读预算可逐项预占详情与页面并在耗尽时拒绝后续请求', () => {
  const task = startPreparedTask(workflow.approveResearchPlan(makePlan({ budget: { maxDetails: 1, maxPages: 2 } })));
  const oneContent = workflow.reserveDeepReadBudget(task, { details: 1 });
  const onePage = workflow.reserveDeepReadBudget(oneContent, { pages: 1 });
  const secondPage = workflow.reserveDeepReadBudget(onePage, { pages: 1 });
  assert.equal(secondPage.usage.details, 1);
  assert.equal(secondPage.usage.pages, 2);
  assert.throws(() => workflow.reserveDeepReadBudget(secondPage, { details: 1 }), error => error.code === 'budget_exceeded');
  assert.throws(() => workflow.reserveDeepReadBudget(secondPage, { pages: 1 }), error => error.code === 'budget_exceeded');
  assert.equal(secondPage.usage.pages, 2, '拒绝预占不能修改旧预算');
});

test('重启将运行操作标为未知，重试递增尝试且跳过不改变任务预算', () => {
  const task = schema.createResearchTask({ id: 'recover-task', status: 'searching', usage: { pages: 2, sourceRequests: 3 }, operations: [
    { operationId: 'op-running', platform: 'bilibili', capability: 'search', state: 'running', attempt: 1 },
    { operationId: 'op-failed', platform: 'xiaohongshu', capability: 'detail', state: 'failed', attempt: 2 }
  ] });
  const recovered = workflow.recoverResearchOperations(task, '2026-10-21T00:00:00.000Z');
  assert.equal(recovered.operations[0].state, 'unknown');
  const retried = workflow.chooseResearchOperation(recovered, 'op-running', 'retry', '2026-10-21T00:01:00.000Z', 'op-running-2');
  assert.equal(retried.operations[0].attempt, 2);
  assert.equal(retried.operations[0].parentOperationId, 'op-running');
  assert.equal(retried.operations[0].state, 'waiting');
  const skipped = workflow.chooseResearchOperation(retried, 'op-failed', 'skip');
  assert.equal(skipped.operations[1].state, 'skipped');
  assert.deepEqual(skipped.usage, task.usage);
});
