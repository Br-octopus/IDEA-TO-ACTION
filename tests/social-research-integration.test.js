const test = require('node:test');
const assert = require('node:assert/strict');
const { createSocialResearchCoordinator } = require('../prototype/app.js');
const storage = require('../prototype/storage.js');

function makeModelClient({ emptyPlan = false, emptyReport = false, planResponse, reportError } = {}) {
  const calls = [];
  return {
    calls,
    async requestModel({ messages, options }) {
      const purpose = options?.purpose;
      const prompt = messages?.[0]?.content || '';
      calls.push({ purpose, prompt });
      if (purpose === 'plan') {
        return emptyPlan ? '' : JSON.stringify(planResponse || {
          objective: '了解独立开发者记账工具的用户痛点',
          researchType: 'pain-points',
          platformRoles: [
            { platform: 'reddit', role: '收集海外体验', queries: ['bookkeeping app'] },
            { platform: 'youtube', role: '收集视频评论', queries: ['bookkeeping app review'] }
          ],
          queries: ['bookkeeping app'],
          expectedResultCount: 2,
          budget: { maxPlatforms: 2, maxQueriesPerPlatform: 2 }
        });
      }
      if (purpose === 'report' && reportError) throw new Error(reportError);
      return emptyReport ? '' : JSON.stringify({
        summary: '发现两个平台的共同痛点',
        coreFindings: ['用户关注账单同步可靠性'],
        resultIds: ['reddit-1', 'youtube-1']
      });
    }
  };
}

function makeSocial(overrides = {}) {
  const calls = [];
  const social = {
    calls,
    async check(platform, profileId) {
      calls.push(['check', platform, profileId]);
      if (overrides[platform]?.check) return overrides[platform].check({ platform, profileId });
      return { platform, status: 'ready', apiAvailable: platform === 'reddit', browserAvailable: true };
    },
    async search(platform, { query, mode }) {
      calls.push(['search', platform, query, mode]);
      if (overrides[platform]?.search) return overrides[platform].search({ platform, query, mode });
      return [{ id: `${platform}-1`, platform, url: `https://${platform}.example/${query}`, title: `${platform} result`, summary: `${platform} summary` }];
    }
  };
  return social;
}

function makeHarness({ social, model, initialState, persistState } = {}) {
  const saves = [];
  const api = {
    social: social || makeSocial(),
    requestModel: (model || makeModelClient()).requestModel,
    saveState(state) { saves.push(structuredClone(state)); return state; }
  };
  return { coordinator: createSocialResearchCoordinator({ desktopApi: api, initialState: initialState || storage.createEmptyState(), persistState: persistState || (state => { saves.push(structuredClone(state)); return state; }) }), saves, api };
}

async function prepareAndRun(harness, input = {}) {
  const task = await harness.coordinator.createPlan({
    topic: '独立开发者记账工具', template: 'pain-points', platforms: ['reddit', 'youtube'], ...input
  });
  assert.equal(task.status, 'awaiting-plan-confirmation');
  const approved = await harness.coordinator.confirmPlan(task.id);
  assert.equal(approved.status, 'awaiting-platform-preparation');
  return harness.coordinator.run(task.id);
}

test('目标到报告并只保存用户勾选结果的完整闭环', async () => {
  const harness = makeHarness();
  const finished = await prepareAndRun(harness);
  assert.equal(finished.status, 'awaiting-save');
  assert.equal(finished.results.length, 2);
  assert.equal(finished.report.summary, '发现两个平台的共同痛点');
  await assert.rejects(() => harness.coordinator.run(finished.id), /可运行的准备状态/);
  const saved = harness.coordinator.saveSelected(finished.id, ['reddit-1']);
  assert.equal(saved.status, 'saved');
  assert.deepEqual(saved.savedResultIds, ['reddit-1']);
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 1);
  assert.equal(harness.coordinator.getState().knowledgeEntries[0].sourceType, '社媒研究');
  assert.equal(harness.coordinator.getState().knowledgeEntries[0].sourceUrl, 'https://reddit.example/bookkeeping app');
  await assert.rejects(() => harness.coordinator.run(finished.id), /可运行的准备状态/);
});

test('模型计划字段使用白名单，用户连接偏好和 profileId 优先', async () => {
  const model = makeModelClient({ planResponse: {
    objective: '模型覆盖主题',
    researchType: 'model-type',
    platformRoles: [{ platform: 'reddit', role: 'model role', queries: ['model query'] }],
    queries: ['model query'],
    connectionModes: { reddit: 'browser' },
    profileId: 'model-profile',
    status: 'saved',
    unexpected: 'must be ignored'
  } });
  const harness = makeHarness({ model });
  const task = await harness.coordinator.createPlan({
    topic: '用户主题',
    template: 'pain-points',
    platforms: ['reddit'],
    queries: ['user query'],
    connectionModes: { reddit: 'api' },
    profileId: 'user-profile',
    objective: '用户目标'
  });

  assert.equal(task.status, 'awaiting-plan-confirmation');
  assert.equal(task.topic, '用户主题');
  assert.equal(task.plan.objective, '用户目标');
  assert.deepEqual(task.plan.queries, ['user query']);
  assert.deepEqual(task.connectionModes, { reddit: 'api' });
  assert.equal(task.profileId, 'user-profile');
  assert.equal(task.unexpected, undefined);
});

test('API 无配置直接使用浏览器，API 空结果自动回退浏览器', async () => {
  const social = makeSocial({
    reddit: { search: async ({ mode }) => mode === 'api' ? [] : [{ id: 'reddit-1', platform: 'reddit', url: 'https://reddit.example/browser', title: 'browser', summary: 'ok' }] },
    youtube: { search: async ({ mode }) => mode === 'browser' ? [{ id: 'youtube-1', platform: 'youtube', url: 'https://youtube.example/browser', title: 'browser', summary: 'ok' }] : [] }
  });
  const harness = makeHarness({ social });
  const result = await prepareAndRun(harness);
  const searches = social.calls.filter(call => call[0] === 'search');
  assert.deepEqual(searches.map(call => [call[1], call[3]]), [['reddit', 'api'], ['reddit', 'browser'], ['youtube', 'browser']]);
  assert.equal(result.results.length, 2);
});

test('用户指定 API 时失败不回退浏览器', async () => {
  const social = makeSocial({ reddit: { search: async ({ mode }) => { if (mode === 'api') throw new Error('api down'); return [{ id: 'unexpected', platform: 'reddit', url: 'https://reddit.example/browser' }]; } } });
  const harness = makeHarness({ social });
  const result = await prepareAndRun(harness, { connectionModes: { reddit: 'api', youtube: 'browser' } });
  assert.equal(result.results.some(item => item.id === 'unexpected'), false);
  assert.equal(result.platformErrors.reddit.message, 'api down');
  assert.ok(harness.coordinator.getState().researchTasks[0].report.needsVerification.includes('reddit 平台执行失败，需核验：api down'));
  assert.equal(social.calls.some(call => call[1] === 'reddit' && call[3] === 'browser'), false);
});

test('单平台失败后继续执行其他平台并生成报告', async () => {
  const social = makeSocial({ reddit: { search: async () => { throw new Error('reddit failed'); } } });
  const harness = makeHarness({ social });
  const result = await prepareAndRun(harness);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].platform, 'youtube');
  assert.equal(result.status, 'awaiting-save');
  assert.equal(result.platformErrors.reddit.message, 'reddit failed');
  assert.ok(harness.coordinator.getState().researchTasks[0].report.needsVerification.includes('reddit 平台执行失败，需核验：reddit failed'));
});

test('用户取消后不执行搜索、不生成报告且不保存结果', async () => {
  const social = makeSocial();
  const harness = makeHarness({ social });
  const task = await harness.coordinator.createPlan({ topic: '取消测试', template: 'trends', platforms: ['reddit'] });
  const cancelled = harness.coordinator.cancel(task.id);
  assert.equal(cancelled.status, 'cancelled');
  await assert.rejects(() => harness.coordinator.run(task.id), /可运行的准备状态/);
  assert.equal(social.calls.some(call => call[0] === 'search'), false);
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 0);

  const preparing = await harness.coordinator.createPlan({ topic: '准备阶段取消', template: 'trends', platforms: ['reddit'] });
  await harness.coordinator.confirmPlan(preparing.id);
  assert.equal(harness.coordinator.cancel(preparing.id).status, 'cancelled');
});

test('所有平台检查失败时通过状态机终止任务且不能保存报告', async () => {
  const social = makeSocial({
    reddit: { check: async () => { throw new Error('reddit unavailable'); } },
    youtube: { check: async () => { throw new Error('youtube unavailable'); } }
  });
  const model = makeModelClient();
  const harness = makeHarness({ social, model });
  const task = await harness.coordinator.createPlan({
    topic: '平台准备失败', template: 'trends', platforms: ['reddit', 'youtube']
  });
  await harness.coordinator.confirmPlan(task.id);

  const failed = await harness.coordinator.run(task.id);

  assert.equal(failed.status, 'failed');
  assert.equal(failed.failureReason, '没有可用平台，研究未启动');
  assert.deepEqual(Object.keys(failed.platformErrors), ['reddit', 'youtube']);
  assert.equal(social.calls.some(call => call[0] === 'search'), false);
  assert.equal(model.calls.some(call => call.purpose === 'report'), false);
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 0);
  assert.throws(() => harness.coordinator.saveSelected(task.id, []), /尚未进入保存阶段/);
});

test('部分平台检查失败时继续搜索已准备平台并在报告中保留失败', async () => {
  const social = makeSocial({
    youtube: { check: async () => { throw new Error('youtube unavailable'); } }
  });
  const harness = makeHarness({ social });
  const task = await harness.coordinator.createPlan({
    topic: '部分平台可用', template: 'trends', platforms: ['reddit', 'youtube']
  });
  await harness.coordinator.confirmPlan(task.id);

  const result = await harness.coordinator.run(task.id);

  assert.equal(result.status, 'awaiting-save');
  assert.deepEqual(result.results.map(item => item.platform), ['reddit']);
  assert.equal(result.platformErrors.youtube.message, 'youtube unavailable');
  assert.ok(result.report.needsVerification.includes('youtube 平台执行失败，需核验：youtube unavailable'));
  assert.deepEqual(social.calls.filter(call => call[0] === 'search').map(call => call[1]), ['reddit']);
});

test('报告模型请求失败会记录错误并进入 partial-failure，不能保存或重跑', async () => {
  const harness = makeHarness({ model: makeModelClient({ reportError: 'report service unavailable' }) });
  const task = await harness.coordinator.createPlan({
    topic: '报告失败', template: 'trends', platforms: ['reddit']
  });
  await harness.coordinator.confirmPlan(task.id);

  const failed = await harness.coordinator.run(task.id);

  assert.equal(failed.status, 'partial-failure');
  assert.equal(failed.reportError, 'report service unavailable');
  assert.throws(() => harness.coordinator.saveSelected(task.id, []), /尚未进入保存阶段/);
  await assert.rejects(() => harness.coordinator.run(task.id), /可运行的准备状态/);
});

test('未勾选结果不会自动进入知识库', async () => {
  const harness = makeHarness();
  const result = await prepareAndRun(harness);
  assert.equal(result.status, 'awaiting-save');
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 0);
});

test('执行过程发送平台、查询、结果数和平台完成事件', async () => {
  const harness = makeHarness();
  const task = await harness.coordinator.createPlan({
    topic: '进度事件', template: 'trends', platforms: ['reddit'],
    queries: ['词一', '词二'], budget: { maxQueriesPerPlatform: 2 },
    plan: { platformRoles: [{ platform: 'reddit', role: '测试', queries: ['词一', '词二'] }] }
  });
  await harness.coordinator.confirmPlan(task.id);
  const events = [];
  await harness.coordinator.run(task.id, { onEvent: event => events.push(event) });

  assert.deepEqual(events.map(event => event.type), [
    'platform-start', 'query-start', 'result-count', 'query-start', 'result-count', 'platform-finish', 'report-start'
  ]);
  assert.equal(events[0].platform, 'reddit');
  assert.equal(events[1].query, '词一');
  assert.equal(events[2].resultCount, 1);
  assert.equal(events.at(-1).resultCount, 2);
});

test('暂停后阻塞在查询边界，继续后才发起下一个查询', async () => {
  let releaseSearch;
  let searchCount = 0;
  const social = makeSocial({ reddit: { search: async () => {
    searchCount += 1;
    if (searchCount === 1) return new Promise(resolve => { releaseSearch = resolve; });
    return [{ id: 'reddit-2', platform: 'reddit', url: 'https://reddit.example/2' }];
  } } });
  const harness = makeHarness({ social });
  const task = await harness.coordinator.createPlan({
    topic: '暂停测试', template: 'trends', platforms: ['reddit'],
    queries: ['词一', '词二'], budget: { maxQueriesPerPlatform: 2 },
    plan: { platformRoles: [{ platform: 'reddit', role: '测试', queries: ['词一', '词二'] }] }
  });
  await harness.coordinator.confirmPlan(task.id);
  const run = harness.coordinator.run(task.id);
  while (!releaseSearch) await new Promise(resolve => setImmediate(resolve));
  harness.coordinator.pause(task.id);
  releaseSearch([{ id: 'reddit-1', platform: 'reddit', url: 'https://reddit.example/1' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(social.calls.filter(call => call[0] === 'search').length, 1);
  assert.equal(harness.coordinator.getState().researchTasks[0].usage.queriesByPlatform.reddit, 1);
  harness.coordinator.resume(task.id);
  const result = await run;
  assert.equal(result.status, 'awaiting-save');
  assert.equal(social.calls.filter(call => call[0] === 'search').length, 2);
});

test('运行中取消在安全边界生效，丢弃结果并跳过报告和保存', async () => {
  let releaseSearch;
  const social = makeSocial({ reddit: { search: async () => new Promise(resolve => { releaseSearch = resolve; }) } });
  const model = makeModelClient();
  const harness = makeHarness({ social, model });
  const task = await harness.coordinator.createPlan({ topic: '运行取消', template: 'trends', platforms: ['reddit'] });
  await harness.coordinator.confirmPlan(task.id);
  const run = harness.coordinator.run(task.id);
  while (!releaseSearch) await new Promise(resolve => setImmediate(resolve));
  const requested = harness.coordinator.cancel(task.id);
  assert.equal(requested.status, 'searching');
  releaseSearch([{ id: 'unfinished-result', platform: 'reddit', url: 'https://reddit.example/1' }]);
  const cancelled = await run;

  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.results, []);
  assert.equal(cancelled.report.summary, '');
  assert.equal(model.calls.some(call => call.purpose === 'report'), false);
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 0);
  assert.throws(() => harness.coordinator.saveSelected(task.id, ['unfinished-result']), /尚未进入保存阶段/);
});

test('报告请求发出前通知进度；请求中取消会在返回后丢弃报告和结果', async () => {
  let releaseReport;
  const model = makeModelClient();
  const originalRequest = model.requestModel;
  model.requestModel = async input => input.options?.purpose === 'report'
    ? new Promise(resolve => { releaseReport = resolve; })
    : originalRequest(input);
  const harness = makeHarness({ model });
  const task = await harness.coordinator.createPlan({ topic: '报告阶段取消', template: 'trends', platforms: ['reddit'] });
  await harness.coordinator.confirmPlan(task.id);
  const events = [];
  const run = harness.coordinator.run(task.id, { onEvent: event => events.push(event) });
  while (!releaseReport) await new Promise(resolve => setImmediate(resolve));

  assert.equal(events.at(-1).type, 'report-start');
  assert.equal(harness.coordinator.getState().researchTasks[0].status, 'searching');
  harness.coordinator.cancel(task.id);
  releaseReport(JSON.stringify({ summary: '不应保留的报告', resultIds: ['reddit-1'] }));
  const cancelled = await run;

  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.results, []);
  assert.equal(cancelled.report.summary, '');
  assert.equal(harness.coordinator.getState().researchTasks[0].report.summary, '');
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 0);
  assert.equal(cancelled.failureReason, '用户取消（在当前请求完成后生效，未完成结果已丢弃）');
});

test('报告请求期间重复 run 被拒绝，活动运行不会被覆盖', async () => {
  let releaseSearch;
  const social = makeSocial({ reddit: { search: async () => new Promise(resolve => { releaseSearch = resolve; }) } });
  const harness = makeHarness({ social });
  const task = await harness.coordinator.createPlan({ topic: '阻止重复运行', template: 'trends', platforms: ['reddit'] });
  await harness.coordinator.confirmPlan(task.id);
  const run = harness.coordinator.run(task.id);
  while (!releaseSearch) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => harness.coordinator.run(task.id), /已在运行/);
  harness.coordinator.cancel(task.id);
  releaseSearch([{ id: 'discard-me', platform: 'reddit', url: 'https://reddit.example/1' }]);
  assert.equal((await run).status, 'cancelled');
});

test('意外持久化异常和预算超限会持久化 partial-failure 错误', async () => {
  let failSearchingPersist = true;
  const persistedStates = [];
  const persistenceHarness = makeHarness({ persistState(state) {
    if (failSearchingPersist && state.researchTasks.some(task => task.status === 'searching')) {
      failSearchingPersist = false;
      throw new Error('写入失败');
    }
    persistedStates.push(structuredClone(state));
    return state;
  } });
  const persistenceTask = await persistenceHarness.coordinator.createPlan({ topic: '持久化异常', template: 'trends', platforms: ['reddit'] });
  await persistenceHarness.coordinator.confirmPlan(persistenceTask.id);
  const persistenceFailure = await persistenceHarness.coordinator.run(persistenceTask.id);
  assert.equal(persistenceFailure.status, 'partial-failure');
  assert.equal(persistenceFailure.reportError, '写入失败');
  assert.equal(persistenceHarness.coordinator.getState().researchTasks[0].status, 'partial-failure');
  assert.equal(persistedStates.at(-1).researchTasks[0].status, 'partial-failure');
  assert.equal(persistedStates.at(-1).researchTasks[0].reportError, '写入失败');

  const social = makeSocial({ reddit: { search: async () => [
    { id: 'reddit-1', platform: 'reddit', url: 'https://reddit.example/1' },
    { id: 'reddit-2', platform: 'reddit', url: 'https://reddit.example/2' }
  ] } });
  const budgetHarness = makeHarness({ social });
  const budgetTask = await budgetHarness.coordinator.createPlan({
    topic: '预算异常', template: 'trends', platforms: ['reddit'], budget: { maxDetails: 1 }
  });
  await budgetHarness.coordinator.confirmPlan(budgetTask.id);
  const budgetFailure = await budgetHarness.coordinator.run(budgetTask.id);
  assert.equal(budgetFailure.status, 'partial-failure');
  assert.match(budgetFailure.reportError, /budget_exceeded|详情数超出预算/);
  assert.equal(budgetHarness.coordinator.getState().researchTasks[0].status, 'partial-failure');
});
