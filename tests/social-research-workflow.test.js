const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const schema = require('../prototype/social-research-schema.js');
const workflow = require('../prototype/social-research-workflow.js');
const prompts = require('../prototype/social-research-prompts.js');

const platforms = ['xiaohongshu', 'reddit', 'youtube'];

function makePlan(overrides = {}) {
  return workflow.createResearchPlan({
    topic: '小红书上的独立开发工具体验',
    template: 'pain-points',
    platforms,
    ...overrides
  });
}

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
  assert.throws(() => workflow.startResearchTask(approved), /平台.*准备/);
  assert.throws(() => workflow.startResearchTask(approved, platforms), /平台.*准备/);
});

test('平台准备事件不能直接搜索，缺少任一平台时拒绝开始', () => {
  const approved = workflow.approveResearchPlan(makePlan());
  const partial = workflow.transitionResearchTask(approved, { type: 'prepared', platforms: platforms.slice(0, 2) });
  assert.equal(partial.status, 'awaiting-platform-preparation');
  assert.deepEqual(partial.preparedPlatforms, platforms.slice(0, 2));
  assert.throws(() => workflow.startResearchTask(partial), /平台.*准备/);
  assert.throws(() => workflow.startResearchTask(approved, platforms.slice(0, 2)), /平台.*准备/);
  const ready = workflow.transitionResearchTask(partial, { type: 'prepared', platforms });
  assert.deepEqual(ready.preparedPlatforms, platforms);
  assert.equal(workflow.startResearchTask(ready).status, 'searching');
  assert.throws(() => workflow.transitionResearchTask(approved, { type: 'start' }), /平台.*准备/);
  assert.throws(() => workflow.transitionResearchTask(approved, { type: 'start', platforms }), /平台.*准备/);
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
    () => makePlan({ platforms: [...platforms, 'tiktok'], budget: { maxPlatforms: 3 } }),
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
    { platform: 'reddit', queries: 3 },
    { pages: 3 },
    { details: 3 },
    { durationMs: 1001 },
    { attachmentBytes: 101 },
    { analysisTokens: 10001 }
  ];
  const originalUsage = structuredClone(task.usage);
  for (const usage of cases) expectBudgetExceeded(task, usage);
  assert.throws(
    () => workflow.consumeResearchBudget(task, { platform: 'reddit', queries: 0, queriesPerPlatform: 100 }),
    TypeError
  );
  expectBudgetExceeded(task, { platform: 'reddit', queries: 3, queriesPerPlatform: 3 });
  assert.deepEqual(task.usage, originalUsage);
  const consumed = workflow.consumeResearchBudget(task, { platform: 'reddit', queries: 1 });
  assert.equal(consumed.usage.platforms, 1);
  assert.deepEqual(consumed.usage.queriesByPlatform, { reddit: 1 });
  assert.equal(task.usage.platforms, 0);
});

test('查询计量必须带平台或使用逐平台 map，并对重复调用累计', () => {
  const task = startPreparedTask(workflow.approveResearchPlan(makePlan({
    budget: { maxQueriesPerPlatform: 2 }
  })));
  assert.throws(() => workflow.consumeResearchBudget(task, { queries: 1 }), TypeError);
  assert.throws(() => workflow.consumeResearchBudget(task, { queriesPerPlatform: 1 }), TypeError);
  let used = workflow.consumeResearchBudget(task, { platform: 'reddit', queries: 1 });
  used = workflow.consumeResearchBudget(used, { platform: 'reddit', queriesPerPlatform: 1 });
  assert.equal(used.usage.queriesByPlatform.reddit, 2);
  expectBudgetExceeded(used, { platform: 'reddit', queries: 1 });
  used = workflow.consumeResearchBudget(task, { queriesByPlatform: { reddit: 2, youtube: 1 } });
  assert.deepEqual(used.usage.queriesByPlatform, { reddit: 2, youtube: 1 });
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
  assert.equal(workflow.canRequestSupplementarySearch(task, { platform: 'reddit', queries: 1 }).allowed, true);
  const used = workflow.consumeResearchBudget(task, { platform: 'reddit', queries: 2 });
  assert.equal(workflow.canRequestSupplementarySearch(used, { platform: 'reddit', queries: 1 }).allowed, false);
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
  const single = workflow.canRequestSupplementarySearch(task, { platforms: [' REDDIT '], queries: 1 });
  assert.equal(single.allowed, true);
  assert.equal(single.usage.platform, 'reddit');
  let used = single.task;
  const second = workflow.canRequestSupplementarySearch(used, { platforms: ['youtube'], queries: 1 });
  assert.equal(second.allowed, true);
  used = second.task;
  assert.deepEqual(used.usage.usedPlatforms, ['reddit', 'youtube']);
  const third = workflow.canRequestSupplementarySearch(used, { platforms: ['xiaohongshu'], queries: 1 });
  assert.equal(third.allowed, true);
  used = third.task;
  assert.equal(used.usage.platforms, 3);
  const limitedTask = { ...task, budget: { ...task.budget, maxPlatforms: 2 } };
  const firstLimited = workflow.canRequestSupplementarySearch(limitedTask, { platforms: ['reddit'], queries: 1 });
  const secondLimited = workflow.canRequestSupplementarySearch(firstLimited.task, { platforms: ['youtube'], queries: 1 });
  assert.equal(secondLimited.allowed, true);
  const thirdLimited = workflow.canRequestSupplementarySearch(secondLimited.task, { platforms: ['xiaohongshu'], queries: 1 });
  assert.equal(thirdLimited.allowed, false);
  assert.equal(workflow.canRequestSupplementarySearch(task, { platforms: ['unknown'] }).allowed, false);
  assert.equal(workflow.canRequestSupplementarySearch(task, {
    platform: 'unknown',
    platforms: ['reddit', 'youtube'],
    queriesByPlatform: { reddit: 1, youtube: 1 }
  }).allowed, false);
  assert.equal(workflow.canRequestSupplementarySearch(task, { platforms: ['reddit', 'youtube'], queries: 1 }).allowed, false);
  const multi = workflow.canRequestSupplementarySearch(task, {
    platforms: ['reddit', 'youtube'],
    queriesByPlatform: { reddit: 1, youtube: 2 }
  });
  assert.equal(multi.allowed, true);
  assert.deepEqual(multi.usage.queriesByPlatform, { reddit: 1, youtube: 2 });
});

test('补搜仅在 searching 状态开放', () => {
  const draft = makePlan();
  const awaitingPreparation = workflow.approveResearchPlan(draft);
  const searching = startPreparedTask(awaitingPreparation);
  const reportReady = workflow.transitionResearchTask(searching, { type: 'finish' });
  const awaitingSave = workflow.transitionResearchTask(reportReady, { type: 'request_save' });
  for (const task of [draft, awaitingPreparation, awaitingSave]) {
    assert.equal(workflow.canRequestSupplementarySearch(task, { platform: 'reddit', queries: 1 }).allowed, false);
  }
  assert.equal(workflow.canRequestSupplementarySearch(searching, { platform: 'reddit', queries: 1 }).allowed, true);
});

test('连接偏好尊重能力和明确选择，并在 auto 下检查 API 结果质量', () => {
  assert.equal(workflow.decideConnectionMode('xiaohongshu', { apiAvailable: false, browserAvailable: true }, 'auto'), 'browser');
  assert.equal(workflow.decideConnectionMode('reddit', { apiAvailable: true, browserAvailable: true }, 'auto'), 'api');
  assert.equal(workflow.decideConnectionMode('reddit', { apiAvailable: true, browserAvailable: true }, 'browser'), 'browser');
  assert.equal(workflow.decideConnectionMode('reddit', { apiAvailable: true, browserAvailable: true }, 'api'), 'api');
  assert.throws(
    () => workflow.decideConnectionMode('reddit', { apiAvailable: false, browserAvailable: true }, 'api'),
    error => error.code === 'api_unavailable' && /API/.test(error.message)
  );
  assert.throws(
    () => workflow.decideConnectionMode('reddit', { apiAvailable: true, status: 'not-ready' }, 'api'),
    error => error.code === 'api_unavailable'
  );
  assert.equal(workflow.decideConnectionMode('reddit', { apiAvailable: false, browserAvailable: true }, 'auto'), 'browser');
  const capability = { minimumResults: 2, requiredFields: ['url', 'title'] };
  for (const apiResult of [
    { error: 'authentication' }, { error: 'timeout' }, { error: 'rate_limit' },
    { results: [] }, { results: [{ url: 'https://a.test', title: 'a' }] },
    { results: [{ url: 'https://a.test', title: 'a' }, { url: 'https://b.test' }] }
  ]) assert.equal(workflow.shouldFallbackToBrowser(apiResult, capability), true);
  assert.equal(workflow.shouldFallbackToBrowser({ results: [
    { url: 'https://a.test', title: 'a' }, { url: 'https://b.test', title: 'b' }
  ] }, capability), false);
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
