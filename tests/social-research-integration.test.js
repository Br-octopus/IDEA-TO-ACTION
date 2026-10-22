const test = require('node:test');
const assert = require('node:assert/strict');
const { createSocialResearchCoordinator } = require('../prototype/app.js');
const storage = require('../prototype/storage.js');
const schema = require('../prototype/social-research-schema.js');

function makeModelClient({ emptyPlan = false, emptyReport = false, planResponse, planError, reportError, usageByPurpose = {} } = {}) {
  const calls = [];
  return {
    calls,
    async requestModel({ messages, options }) {
      const purpose = options?.purpose;
      const prompt = messages?.[0]?.content || '';
      calls.push({ purpose, prompt, options: structuredClone(options || {}) });
      const respond = text => usageByPurpose[purpose]
        ? { text, usage: usageByPurpose[purpose] }
        : text;
      if (purpose === 'plan') {
        if (planError) throw planError instanceof Error ? planError : new Error(planError);
        if (emptyPlan) return respond('');
        if (planResponse) return respond(JSON.stringify(planResponse));
        const inputStart = prompt.indexOf('输入：\n');
        const input = inputStart >= 0 ? JSON.parse(prompt.slice(inputStart + '输入：\n'.length)) : {};
        const selectedPlatforms = input.platforms || [];
        const queries = input.queries?.length ? input.queries : ['需求体验'];
        return respond(JSON.stringify({
          platforms: selectedPlatforms,
          objective: '了解独立开发者工具的用户痛点',
          researchType: 'pain-points',
          platformRoles: selectedPlatforms.map(platform => ({ platform, role: '收集用户体验', queries })),
          queries,
          expectedResultCount: selectedPlatforms.length,
          budget: { maxPlatforms: 4, maxQueriesPerPlatform: 2 }
        }));
      }
      if (purpose === 'report' && reportError) throw reportError instanceof Error ? reportError : new Error(reportError);
      return respond(emptyReport ? '' : JSON.stringify({
        summary: '发现两个平台的共同痛点',
        coreFindings: ['用户关注账单同步可靠性'],
        resultIds: ['xiaohongshu-1', 'bilibili-1']
      }));
    }
  };
}

function makeSocial(overrides = {}) {
  const calls = [];
  const checkTimeouts = [];
  const searchTimeouts = [];
  const social = {
    calls,
    checkTimeouts,
    searchTimeouts,
    async check(platform, profileInput) {
      const profileId = typeof profileInput === 'string' ? profileInput : profileInput?.profileId;
      checkTimeouts.push(typeof profileInput === 'object' ? profileInput.timeoutMs : undefined);
      calls.push(['check', platform, profileId]);
      if (overrides[platform]?.check) return overrides[platform].check({ platform, profileId, timeoutMs: profileInput?.timeoutMs });
      return { platform, status: 'ok', ready: true, apiConfigured: false, browserAvailable: true };
    },
    async search(platform, options = {}) {
      const { query, mode, profileId } = options;
      searchTimeouts.push(options.timeoutMs);
      calls.push(['search', platform, query, mode, profileId]);
      const response = overrides[platform]?.search
        ? await overrides[platform].search({ platform, ...options })
        : [{ id: `${platform}-1`, platform, url: `https://${platform}.example/${query}`, title: `${platform} result`, summary: `${platform} summary` }];
      return Array.isArray(response) ? { status: 'ok', results: response } : response;
    }
  };
  return social;
}

function makeHarness({ social, model, initialState, persistState, now } = {}) {
  const saves = [];
  const api = {
    social: social || makeSocial(),
    requestModel: (model || makeModelClient()).requestModel,
    saveState(state) { saves.push(structuredClone(state)); return state; }
  };
  return { coordinator: createSocialResearchCoordinator({ desktopApi: api, initialState: initialState || storage.createEmptyState(), persistState: persistState || (state => { saves.push(structuredClone(state)); return state; }), ...(now ? { now } : {}) }), saves, api };
}

async function prepareAndRun(harness, input = {}) {
  const task = await harness.coordinator.createPlan({
    topic: '独立开发者记账工具', template: 'pain-points', platforms: ['xiaohongshu', 'bilibili'], ...input
  });
  assert.equal(task.status, 'awaiting-plan-confirmation');
  const approved = await harness.coordinator.confirmPlan(task.id);
  assert.equal(approved.status, 'awaiting-platform-preparation');
  return harness.coordinator.run(task.id);
}

function makeDeepHarness({ platform = 'xiaohongshu', results, sourceAction, model, initialState, now } = {}) {
  const sourceCalls = [];
  const attachments = [];
  const social = makeSocial({ [platform]: { search: async () => results } });
  const harness = makeHarness({ social, model, initialState, now });
  harness.api.socialSource = {
    async list() {
      return [{ id: 'mediacrawler-lite', version: '1.0.0', capabilities: {
        xiaohongshu: ['health', 'session', 'detail', 'comments'],
        bilibili: ['health', 'session', 'detail', 'comments']
      } }];
    },
    async run(request) {
      sourceCalls.push({ request: structuredClone(request), state: structuredClone(harness.coordinator.getState()) });
      return sourceAction ? sourceAction(request) : {
        status: 'ok', version: '1.0.0', data: request.action === 'comments'
          ? { comments: [] } : { title: '详情标题', desc: '详情正文' }
      };
    },
    async cancel(request) { sourceCalls.push({ cancel: structuredClone(request) }); return { status: 'ok', cancelled: true }; }
  };
  harness.api.research = {
    async saveAttachment(payload) {
      attachments.push(structuredClone(payload));
      return { status: 'ok', attachment: {
        id: `${payload.taskId}_0123456789abcdef0123456789abcdef.txt`,
        type: 'text/plain', size: Buffer.from(payload.content, 'base64').length,
        sourceResultId: payload.sourceResultId,
        relativePath: `${payload.taskId}/saved.txt`, savedAt: '2026-10-21T00:00:00.000Z'
      } };
    }
  };
  return { ...harness, sourceCalls, attachments };
}

async function completeDeepTask(harness, platform = 'xiaohongshu', budget = {}) {
  const task = await harness.coordinator.createPlan({
    topic: '按需深读验收', template: 'pain-points', platforms: [platform], budget
  });
  await harness.coordinator.confirmPlan(task.id);
  return harness.coordinator.run(task.id);
}

function deepReadInitialState(platform, result, maxPages) {
  const task = schema.createResearchTask({
    id: 'deep-read-budget-task', topic: '深读预算', template: 'pain-points', platforms: [platform],
    status: 'awaiting-save', budget: { maxPages }, usage: { pages: 0 }, results: [result],
    plan: { objective: '深读预算', researchType: 'pain-points', queries: ['q'],
      platformRoles: [{ platform, role: '读取详情', queries: ['q'] }], budget: { maxPages } }
  });
  return { ...storage.createEmptyState(), researchTasks: [task] };
}

test('重启恢复运行操作为未知且不联网，逐项重试或跳过保留原任务预算', async () => {
  const task = schema.createResearchTask({ id: 'restart-queue', status: 'searching', platforms: ['bilibili'], usage: { pages: 2, sourceRequests: 4 }, operations: [
    { operationId: 'interrupted-op', platform: 'bilibili', profileId: 'profile-1', sourceId: 'source-1', capability: 'search', query: 'q', state: 'running', attempt: 1 },
    { operationId: 'failed-op', platform: 'bilibili', capability: 'detail', state: 'failed', attempt: 1 }
  ] });
  const model = makeModelClient();
  const harness = makeHarness({ model, initialState: { ...storage.createEmptyState(), researchTasks: [task] } });
  const recovered = harness.coordinator.getState().researchTasks[0];
  assert.equal(recovered.operations[0].state, 'unknown');
  assert.equal(harness.api.social.calls.length, 0, '构造协调器恢复队列不能发起平台请求');
  assert.equal(model.calls.length, 0, '恢复队列不能调用模型');
  const retried = harness.coordinator.chooseOperation(task.id, 'interrupted-op', 'retry');
  assert.equal(retried.operations[0].attempt, 2);
  assert.equal(retried.operations[0].parentOperationId, 'interrupted-op');
  assert.deepEqual(retried.usage, recovered.usage);
  const skipped = harness.coordinator.chooseOperation(task.id, 'failed-op', 'skip');
  assert.equal(skipped.operations[1].state, 'skipped');
  assert.deepEqual(skipped.usage, recovered.usage);
});

test('显式重试只执行原查询并创建关联尝试，不清零累计预算', async () => {
  const task = schema.createResearchTask({ id: 'retry-one-query', status: 'searching', platforms: ['bilibili'], usage: { pages: 1, sourceRequests: 1, queriesByPlatform: { bilibili: 1 } }, operations: [
    { operationId: 'failed-search', platform: 'bilibili', profileId: 'profile-1', capability: 'search', query: '原查询', state: 'failed', attempt: 1 }
  ] });
  const harness = makeHarness({ initialState: { ...storage.createEmptyState(), researchTasks: [task] } });
  const result = await harness.coordinator.retryOperation(task.id, 'failed-search');
  const retry = result.operations.find(operation => operation.parentOperationId === 'failed-search');
  assert.equal(harness.api.social.calls.filter(call => call[0] === 'search').length, 1);
  assert.equal(harness.api.social.calls.find(call => call[0] === 'search')[2], '原查询');
  assert.equal(retry.state, 'completed');
  assert.equal(retry.attempt, 2);
  assert.equal(retry.resultIds.length, 1);
  assert.equal(result.usage.queriesByPlatform.bilibili, 2);
  assert.equal(result.usage.sourceRequests, 2);
});

test('深读重试沿用原 operation 关联并更新同一材料记录', async () => {
  const result = schema.normalizeSocialResult({
    id: 'retry-detail-result', platform: 'xiaohongshu', contentId: 'note_retry',
    url: 'https://www.xiaohongshu.com/explore/note_retry', title: '待恢复结果'
  });
  const task = schema.createResearchTask({ id: 'retry-detail-task', status: 'awaiting-save', platforms: ['xiaohongshu'], results: [result], operations: [
    { operationId: 'failed-detail', platform: 'xiaohongshu', capability: 'detail', contentId: { noteId: 'note_retry' }, state: 'failed', attempt: 2 }
  ] });
  const harness = makeDeepHarness({ initialState: { ...storage.createEmptyState(), researchTasks: [task] } });
  const finished = await harness.coordinator.retryOperation(task.id, 'failed-detail');
  const retry = finished.operations.find(operation => operation.parentOperationId === 'failed-detail');
  const material = finished.results[0].materials.find(item => item.operationId === retry.operationId);
  assert.equal(retry.state, 'completed');
  assert.equal(retry.attempt, 3);
  assert.equal(harness.sourceCalls.length, 1);
  assert.equal(harness.sourceCalls[0].request.contentId.noteId, 'note_retry');
  assert.equal(material.status, 'completed');
  assert.equal(finished.usage.details, 1);
});

test('目标到报告并只保存用户勾选结果的完整闭环', async () => {
  const harness = makeHarness();
  const finished = await prepareAndRun(harness, { queries: ['bookkeeping app'] });
  assert.equal(finished.status, 'awaiting-save', finished.reportError);
  assert.equal(finished.results.length, 2);
  assert.equal(finished.report.summary, '发现两个平台的共同痛点');
  await assert.rejects(() => harness.coordinator.run(finished.id), /可运行的准备状态/);
  const saved = harness.coordinator.saveSelected(finished.id, ['xiaohongshu-1']);
  assert.equal(saved.status, 'saved');
  assert.deepEqual(saved.savedResultIds, ['xiaohongshu-1']);
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 1);
  assert.equal(harness.coordinator.getState().knowledgeEntries[0].sourceType, '社媒研究');
  assert.equal(harness.coordinator.getState().knowledgeEntries[0].sourceUrl, 'https://xiaohongshu.example/bookkeeping app');
  await assert.rejects(() => harness.coordinator.run(finished.id), /可运行的准备状态/);
});

test('计划、报告与重新生成报告累计模型用量并按剩余预算限制输出', async () => {
  const budget = { maxAnalysisTokens: 10000 };
  const model = makeModelClient({ usageByPurpose: {
    plan: { prompt_tokens: 20, completion_tokens: 11, total_tokens: 31 },
    report: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 }
  } });
  const harness = makeDeepHarness({ model, results: [{
    id: 'xiaohongshu-1', platform: 'xiaohongshu', contentId: 'note_1',
    url: 'https://www.xiaohongshu.com/explore/note_1', title: '搜索结果'
  }] });
  const task = await completeDeepTask(harness, 'xiaohongshu', budget);
  assert.equal(task.usage.analysisTokens, 91);
  assert.equal(task.usage.analysisTokensEstimated, false);
  const estimateInput = prompt => 264 + new TextEncoder().encode(prompt).byteLength;
  assert.equal(model.calls[0].options.max_tokens, budget.maxAnalysisTokens - estimateInput(model.calls[0].prompt));
  assert.equal(model.calls[1].options.max_tokens, budget.maxAnalysisTokens - 31 - estimateInput(model.calls[1].prompt));

  await harness.coordinator.deepRead(task.id, ['xiaohongshu-1'], ['detail']);
  const regenerated = await harness.coordinator.regenerateReport(task.id);
  assert.equal(regenerated.usage.analysisTokens, 151);
  assert.equal(model.calls[2].options.max_tokens, budget.maxAnalysisTokens - 91 - estimateInput(model.calls[2].prompt));
});

test('模型没有返回 usage 时按输入和输出字节保守计量', async () => {
  const harness = makeHarness();
  const finished = await prepareAndRun(harness, { platforms: ['xiaohongshu'] });
  assert.ok(finished.usage.analysisTokens > 0);
  assert.ok(finished.usage.analysisTokens <= finished.budget.maxAnalysisTokens);
  assert.equal(finished.usage.analysisTokensEstimated, true);
});

test('计划请求超时会预留剩余模型预算并返回可人工确认的默认计划', async () => {
  const model = makeModelClient({ planError: Object.assign(new Error('模型请求超时'), { code: 'MODEL_TIMEOUT' }) });
  const harness = makeHarness({ model });
  const task = await harness.coordinator.createPlan({
    topic: '超时计划', template: 'pain-points', platforms: ['xiaohongshu'],
    budget: { maxAnalysisTokens: 10000 }
  });
  assert.equal(task.status, 'awaiting-plan-confirmation');
  assert.equal(task.planErrorCode, 'MODEL_TIMEOUT');
  assert.match(task.planError, /默认计划/);
  assert.equal(task.usage.analysisTokens, 10000);
  assert.equal(task.usage.analysisTokensEstimated, true);
});

test('剩余 token 预算不足时不发起报告请求并保留已经消耗的预算', async () => {
  const model = makeModelClient({ usageByPurpose: { plan: { total_tokens: 9000 } } });
  const harness = makeHarness({ model, social: makeSocial() });
  const task = await harness.coordinator.createPlan({
    topic: 'token 预算', template: 'pain-points', platforms: ['xiaohongshu'],
    budget: { maxAnalysisTokens: 10000 }
  });
  await harness.coordinator.confirmPlan(task.id);
  const finished = await harness.coordinator.run(task.id);
  assert.equal(finished.status, 'partial-failure');
  assert.equal(finished.usage.analysisTokens, 9000);
  assert.deepEqual(model.calls.map(call => call.purpose), ['plan']);
  assert.match(finished.reportError, /token 预算不足/);
});

test('计划实际 token 超预算时不提高额度、保留用量并跳过报告请求', async () => {
  const model = makeModelClient({ usageByPurpose: { plan: { total_tokens: 10001 } } });
  const harness = makeHarness({ model });
  const task = await harness.coordinator.createPlan({
    topic: '计划 token 超额', template: 'pain-points', platforms: ['xiaohongshu'],
    budget: { maxAnalysisTokens: 10000 }
  });

  assert.equal(task.budget.maxAnalysisTokens, 10000);
  assert.equal(task.usage.analysisTokens, 10001);
  assert.equal(task.planErrorCode, 'analysis_budget_exceeded');
  assert.match(task.planError, /默认计划/);
  assert.equal(model.calls.length, 1);
  await harness.coordinator.confirmPlan(task.id);
  const finished = await harness.coordinator.run(task.id);
  assert.equal(finished.usage.analysisTokens, 10001);
  assert.equal(finished.reportErrorCode, 'analysis_budget_exceeded');
  assert.deepEqual(model.calls.map(call => call.purpose), ['plan']);
});

test('搜索失败和 API 到浏览器回退分别计入任务来源请求预算', async () => {
  const social = makeSocial({ xiaohongshu: {
    check: async () => ({ platform: 'xiaohongshu', status: 'ok', ready: true, apiConfigured: true, browserAvailable: true }),
    search: async ({ mode }) => mode === 'api'
      ? { status: 'error', code: 'NETWORK_ERROR', message: 'API 失败' }
      : [{ id: 'fallback-result', platform: 'xiaohongshu', url: 'https://xiaohongshu.example/fallback' }]
  } });
  const harness = makeHarness({ social });
  const task = await harness.coordinator.createPlan({
    topic: '来源回退计量', template: 'pain-points', platforms: ['xiaohongshu'],
    connectionModes: { xiaohongshu: 'auto' }, budget: { maxSourceRequests: 2 }
  });
  await harness.coordinator.confirmPlan(task.id);
  const finished = await harness.coordinator.run(task.id);
  assert.deepEqual(social.calls.filter(call => call[0] === 'search').map(call => call[3]), ['api', 'browser']);
  assert.equal(finished.usage.sourceRequests, 2);
});

test('搜索耗尽来源请求预算后拒绝后续查询且不发送请求', async () => {
  const social = makeSocial();
  const harness = makeHarness({ social });
  const finished = await prepareAndRun(harness, {
    platforms: ['xiaohongshu'], queries: ['q1', 'q2'],
    budget: { maxQueriesPerPlatform: 2, maxSourceRequests: 1 },
    plan: { platformRoles: [{ platform: 'xiaohongshu', role: '搜索', queries: ['q1', 'q2'] }] }
  });
  assert.equal(social.calls.filter(call => call[0] === 'search').length, 1);
  assert.equal(finished.usage.sourceRequests, 1);
  assert.equal(finished.platformErrors.xiaohongshu.code, 'budget_exceeded');
});

test('浏览器适配器给出的小红书临时令牌仅供当前任务深读', async () => {
  const harness = makeDeepHarness({ results: [{
    id: 'xhs-volatile', platform: 'xiaohongshu', contentId: 'note_volatile',
    url: 'https://www.xiaohongshu.com/explore/note_volatile?campaign=one',
    volatileAccess: { xsecToken: 'ephemeral-token' }
  }] });
  const task = await completeDeepTask(harness);
  assert.equal(JSON.stringify(harness.coordinator.getState()).includes('ephemeral-token'), false);
  await harness.coordinator.deepRead(task.id, ['xhs-volatile'], ['detail']);
  assert.equal(harness.sourceCalls[0].request.contentId.xsecToken, 'ephemeral-token');
  assert.equal(JSON.stringify(harness.coordinator.getState()).includes('ephemeral-token'), false);
});

test('跨查询的相同内容合并为一条，保留首个 ID、链接和完整查询来源', async () => {
  const social = makeSocial({ xiaohongshu: { search: async ({ query }) => query === 'q1'
    ? [{ id: 'first-id', platform: 'xiaohongshu', contentId: 'post-1', url: 'https://xiaohongshu.example/post-1?first=1', title: '首个标题', searchQueries: ['q1'] }]
    : [{ id: 'later-id', platform: 'xiaohongshu', contentId: 'post-1', url: 'https://xiaohongshu.example/post-1?later=1', title: '后续标题', searchQueries: ['q2'] }] } });
  const harness = makeHarness({ social });
  const result = await prepareAndRun(harness, {
    platforms: ['xiaohongshu'],
    queries: ['q1', 'q2'],
    budget: { maxQueriesPerPlatform: 2 },
    plan: { platformRoles: [{ platform: 'xiaohongshu', role: '测试', queries: ['q1', 'q2'] }] }
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, 'first-id');
  assert.equal(result.results[0].url, 'https://xiaohongshu.example/post-1?first=1');
  assert.deepEqual(result.results[0].searchQueries, ['q1', 'q2']);
});

test('模型计划字段使用白名单，用户连接偏好和 profileId 优先', async () => {
  const model = makeModelClient({ planResponse: {
    objective: '模型覆盖主题',
    researchType: 'model-type',
    platformRoles: [{ platform: 'xiaohongshu', role: 'model role', queries: ['model query'] }],
    queries: ['model query'],
    connectionModes: { xiaohongshu: 'browser' },
    profileId: 'model-profile',
    status: 'saved',
    unexpected: 'must be ignored'
  } });
  const harness = makeHarness({ model });
  const task = await harness.coordinator.createPlan({
    topic: '用户主题',
    template: 'pain-points',
    platforms: ['xiaohongshu'],
    queries: ['user query'],
    connectionModes: { xiaohongshu: 'api' },
    profileId: 'user-profile',
    objective: '用户目标'
  });

  assert.equal(task.status, 'awaiting-plan-confirmation');
  assert.equal(task.topic, '用户主题');
  assert.equal(task.plan.objective, '用户目标');
  assert.deepEqual(task.plan.queries, ['user query']);
  assert.deepEqual(task.connectionModes, { xiaohongshu: 'api' });
  assert.equal(task.profileId, 'user-profile');
  assert.equal(task.unexpected, undefined);
});

test('空平台、未知平台和国际平台在调用模型前拒绝；模型生成的平台再次校验', async () => {
  const model = makeModelClient();
  const harness = makeHarness({ model });
  for (const platforms of [undefined, [], ['reddit'], ['xiaohongshu', 'youtube'], ['unknown']]) {
    await assert.rejects(
      () => harness.coordinator.createPlan({ topic: '平台校验', template: 'trends', ...(platforms === undefined ? {} : { platforms }) }),
      /国内社媒平台|仅支持小红书、B 站、微博和知乎/
    );
  }
  assert.equal(model.calls.length, 0);

  const invalidModel = makeModelClient({ planResponse: {
    platforms: ['xiaohongshu', 'reddit'],
    platformRoles: [{ platform: 'xiaohongshu', role: '采集', queries: ['q'] }]
  } });
  const invalidHarness = makeHarness({ model: invalidModel });
  await assert.rejects(
    () => invalidHarness.coordinator.createPlan({ topic: '模型平台校验', template: 'trends', platforms: ['xiaohongshu'] }),
    /仅支持小红书、B 站、微博和知乎/
  );
  assert.equal(invalidModel.calls.filter(call => call.purpose === 'plan').length, 1);
  assert.equal(invalidHarness.coordinator.getState().researchTasks.length, 0);
});

test('历史国际平台任务保留可读，但不能确认或运行', async () => {
  const legacyTask = schema.createResearchTask({
    id: 'legacy-international-task', topic: '历史研究', template: 'trends',
    platforms: ['reddit'], status: 'awaiting-plan-confirmation'
  });
  const initialState = storage.createEmptyState();
  initialState.researchTasks.push(legacyTask);
  const harness = makeHarness({ initialState });

  assert.equal(harness.coordinator.getState().researchTasks[0].platforms[0], 'reddit');
  await assert.rejects(() => harness.coordinator.confirmPlan(legacyTask.id), /仅支持小红书、B 站、微博和知乎/);
  await assert.rejects(() => harness.coordinator.run(legacyTask.id), /仅支持小红书、B 站、微博和知乎/);
  assert.equal(harness.coordinator.getState().researchTasks[0].status, 'awaiting-plan-confirmation');
});

test('平台检查和搜索使用相同解析后的独立 profile', async () => {
  const social = makeSocial();
  const harness = makeHarness({ social });
  await prepareAndRun(harness, { platforms: ['xiaohongshu'], profileId: 'custom-social-profile' });
  assert.deepEqual(social.calls.filter(call => ['check', 'search'].includes(call[0])).map(call => call.at(-1)), [
    'custom-social-profile', 'custom-social-profile'
  ]);
});

test('API 未配置时使用浏览器；明确成功的空结果不回退且仍记为搜索验证', async () => {
  const social = makeSocial({
    xiaohongshu: {
      check: async () => ({ status: 'ok', ready: true, apiConfigured: true }),
      search: async () => ({ status: 'ok', results: [] })
    }
  });
  const harness = makeHarness({ social });
  const result = await prepareAndRun(harness);
  const searches = social.calls.filter(call => call[0] === 'search');
  assert.deepEqual(searches.map(call => [call[1], call[3]]), [['xiaohongshu', 'api'], ['bilibili', 'browser']]);
  assert.equal(result.results.length, 1);
  assert.equal(result.usage.queriesByPlatform.xiaohongshu, 1);
  assert.equal(result.usage.pages, 2);
  const connection = harness.coordinator.getState().platformConnections.xiaohongshu;
  assert.equal(connection.profileId, 'social-research-xiaohongshu');
  assert.equal(connection.searchVerified, true);
  assert.ok(connection.lastSuccessfulSearchAt);
});

test('自动 API 返回非零但字段不足时最多回退一次，两个请求分别预扣并持久化预算', async () => {
  let harness;
  const observedBudgets = [];
  const social = makeSocial({
    xiaohongshu: {
      check: async () => ({ status: 'ok', ready: true, apiConfigured: true, requiredFields: ['title'] }),
      search: async ({ mode }) => {
        const savedTask = harness.saves.at(-1).researchTasks[0];
        observedBudgets.push(savedTask.usage.queriesByPlatform.xiaohongshu);
        return mode === 'api'
          ? { status: 'ok', results: [{ id: 'incomplete', url: 'https://example.test/incomplete' }] }
          : [{ id: 'fallback-result', url: 'https://example.test/fallback', title: '完整结果' }];
      }
    }
  });
  harness = makeHarness({ social });
  const result = await prepareAndRun(harness, { platforms: ['xiaohongshu'] });
  const searches = social.calls.filter(call => call[0] === 'search');
  assert.deepEqual(searches.map(call => call[3]), ['api', 'browser']);
  assert.deepEqual(observedBudgets, [1, 2]);
  assert.deepEqual(result.results.map(item => item.id), ['fallback-result']);
  assert.equal(result.usage.queriesByPlatform.xiaohongshu, 2);
  assert.equal(result.usage.pages, 2);
  assert.equal(result.usage.details, 0);
});

test('用户指定 API 时失败不回退浏览器', async () => {
  const social = makeSocial({ xiaohongshu: {
    check: async () => ({ status: 'ok', ready: true, apiConfigured: true }),
    search: async ({ mode }) => { if (mode === 'api') throw Object.assign(new Error('api down'), { code: 'API_DOWN' }); return [{ id: 'unexpected', platform: 'xiaohongshu', url: 'https://xiaohongshu.example/browser' }]; }
  } });
  const harness = makeHarness({ social });
  const result = await prepareAndRun(harness, { connectionModes: { xiaohongshu: 'api', bilibili: 'browser' } });
  assert.equal(result.results.some(item => item.id === 'unexpected'), false);
  assert.equal(result.platformErrors.xiaohongshu.message, 'api down');
  assert.equal(result.platformErrors.xiaohongshu.code, 'API_DOWN');
  assert.ok(harness.coordinator.getState().researchTasks[0].report.needsVerification.includes('xiaohongshu 平台执行失败，需核验：api down'));
  assert.equal(social.calls.some(call => call[1] === 'xiaohongshu' && call[3] === 'browser'), false);
  assert.equal(harness.coordinator.getState().platformConnections.xiaohongshu, undefined);
});

test('单平台失败后继续执行其他平台并生成报告', async () => {
  const social = makeSocial({ xiaohongshu: { search: async () => { throw new Error('xiaohongshu failed'); } } });
  const harness = makeHarness({ social });
  const result = await prepareAndRun(harness);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].platform, 'bilibili');
  assert.equal(result.status, 'awaiting-save');
  assert.equal(result.platformErrors.xiaohongshu.message, 'xiaohongshu failed');
  assert.ok(harness.coordinator.getState().researchTasks[0].report.needsVerification.includes('xiaohongshu 平台执行失败，需核验：xiaohongshu failed'));
});

test('用户取消后不执行搜索、不生成报告且不保存结果', async () => {
  const social = makeSocial();
  const harness = makeHarness({ social });
  const task = await harness.coordinator.createPlan({ topic: '取消测试', template: 'trends', platforms: ['xiaohongshu'] });
  const cancelled = harness.coordinator.cancel(task.id);
  assert.equal(cancelled.status, 'cancelled');
  await assert.rejects(() => harness.coordinator.run(task.id), /可运行的准备状态/);
  assert.equal(social.calls.some(call => call[0] === 'search'), false);
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 0);

  const preparing = await harness.coordinator.createPlan({ topic: '准备阶段取消', template: 'trends', platforms: ['xiaohongshu'] });
  await harness.coordinator.confirmPlan(preparing.id);
  assert.equal(harness.coordinator.cancel(preparing.id).status, 'cancelled');
});

test('所有平台检查失败时通过状态机终止任务且不能保存报告', async () => {
  const social = makeSocial({
    xiaohongshu: { check: async () => { throw new Error('xiaohongshu unavailable'); } },
    bilibili: { check: async () => { throw new Error('bilibili unavailable'); } }
  });
  const model = makeModelClient();
  const harness = makeHarness({ social, model });
  const task = await harness.coordinator.createPlan({
    topic: '平台准备失败', template: 'trends', platforms: ['xiaohongshu', 'bilibili']
  });
  await harness.coordinator.confirmPlan(task.id);

  const failed = await harness.coordinator.run(task.id);

  assert.equal(failed.status, 'failed');
  assert.equal(failed.failureReason, '没有可用平台，研究未启动');
  assert.deepEqual(Object.keys(failed.platformErrors), ['xiaohongshu', 'bilibili']);
  assert.equal(social.calls.some(call => call[0] === 'search'), false);
  assert.equal(model.calls.some(call => call.purpose === 'report'), false);
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 0);
  assert.throws(() => harness.coordinator.saveSelected(task.id, []), /尚未进入保存阶段/);
});

test('部分平台检查失败时继续搜索已准备平台并在报告中保留失败', async () => {
  const social = makeSocial({
    bilibili: { check: async () => { throw new Error('bilibili unavailable'); } }
  });
  const harness = makeHarness({ social });
  const task = await harness.coordinator.createPlan({
    topic: '部分平台可用', template: 'trends', platforms: ['xiaohongshu', 'bilibili']
  });
  await harness.coordinator.confirmPlan(task.id);

  const result = await harness.coordinator.run(task.id);

  assert.equal(result.status, 'awaiting-save');
  assert.deepEqual(result.results.map(item => item.platform), ['xiaohongshu']);
  assert.equal(result.platformErrors.bilibili.message, 'bilibili unavailable');
  assert.ok(result.report.needsVerification.includes('bilibili 平台执行失败，需核验：bilibili unavailable'));
  assert.deepEqual(social.calls.filter(call => call[0] === 'search').map(call => call[1]), ['xiaohongshu']);
});

test('检查虽返回 ready true 但 status 非 ok 时隔离失败平台并继续其他平台', async () => {
  const social = makeSocial({
    xiaohongshu: { check: async () => ({ status: 'error', ready: true, code: 'UNSUPPORTED_PAGE', message: '页面不匹配' }) }
  });
  const harness = makeHarness({ social });
  const task = await harness.coordinator.createPlan({
    topic: '严格检查状态', template: 'trends', platforms: ['xiaohongshu', 'bilibili']
  });
  await harness.coordinator.confirmPlan(task.id);

  const result = await harness.coordinator.run(task.id);

  assert.equal(result.status, 'awaiting-save');
  assert.equal(result.platformErrors.xiaohongshu.code, 'UNSUPPORTED_PAGE');
  assert.deepEqual(result.results.map(item => item.platform), ['bilibili']);
});

test('报告模型请求失败会记录错误并进入 partial-failure，不能保存或重跑', async () => {
  const harness = makeHarness({ model: makeModelClient({ reportError: Object.assign(new Error('report service unavailable'), { code: 'model_unavailable' }) }) });
  const task = await harness.coordinator.createPlan({
    topic: '报告失败', template: 'trends', platforms: ['xiaohongshu']
  });
  await harness.coordinator.confirmPlan(task.id);

  const failed = await harness.coordinator.run(task.id);

  assert.equal(failed.status, 'partial-failure');
  assert.equal(failed.reportError, 'report service unavailable');
  assert.equal(failed.reportErrorCode, 'model_unavailable');
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
    topic: '进度事件', template: 'trends', platforms: ['xiaohongshu'],
    queries: ['词一', '词二'], budget: { maxQueriesPerPlatform: 2 },
    plan: { platformRoles: [{ platform: 'xiaohongshu', role: '测试', queries: ['词一', '词二'] }] }
  });
  await harness.coordinator.confirmPlan(task.id);
  const events = [];
  await harness.coordinator.run(task.id, { onEvent: event => events.push(event) });

  assert.deepEqual(events.map(event => event.type), [
    'platform-start', 'query-start', 'search-verified', 'result-count', 'query-start', 'search-verified',
    'result-count', 'platform-finish', 'report-start'
  ]);
  assert.equal(events[0].platform, 'xiaohongshu');
  assert.equal(events[1].query, '词一');
  assert.equal(events[3].resultCount, 1);
  assert.equal(events.at(-1).resultCount, 2);
});

test('暂停后阻塞在查询边界，继续后才发起下一个查询', async () => {
  let releaseSearch;
  let searchCount = 0;
  const social = makeSocial({ xiaohongshu: { search: async () => {
    searchCount += 1;
    if (searchCount === 1) return new Promise(resolve => { releaseSearch = resolve; });
    return [{ id: 'xiaohongshu-2', platform: 'xiaohongshu', url: 'https://xiaohongshu.example/2' }];
  } } });
  const harness = makeHarness({ social });
  const task = await harness.coordinator.createPlan({
    topic: '暂停测试', template: 'trends', platforms: ['xiaohongshu'],
    queries: ['词一', '词二'], budget: { maxQueriesPerPlatform: 2 },
    plan: { platformRoles: [{ platform: 'xiaohongshu', role: '测试', queries: ['词一', '词二'] }] }
  });
  await harness.coordinator.confirmPlan(task.id);
  const run = harness.coordinator.run(task.id);
  while (!releaseSearch) await new Promise(resolve => setImmediate(resolve));
  harness.coordinator.pause(task.id);
  releaseSearch([{ id: 'xiaohongshu-1', platform: 'xiaohongshu', url: 'https://xiaohongshu.example/1' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(social.calls.filter(call => call[0] === 'search').length, 1);
  assert.equal(harness.coordinator.getState().researchTasks[0].usage.queriesByPlatform.xiaohongshu, 1);
  harness.coordinator.resume(task.id);
  const result = await run;
  assert.equal(result.status, 'awaiting-save');
  assert.equal(social.calls.filter(call => call[0] === 'search').length, 2);
});

test('运行中取消保留先前完成结果与预算，只丢弃在途响应并跳过报告', async () => {
  let releaseSearch;
  const social = makeSocial({ xiaohongshu: { search: async ({ query }) => query === 'q1'
    ? [{ id: 'completed-result', platform: 'xiaohongshu', url: 'https://xiaohongshu.example/completed' }]
    : new Promise(resolve => { releaseSearch = resolve; }) } });
  const model = makeModelClient();
  const harness = makeHarness({ social, model });
  const task = await harness.coordinator.createPlan({
    topic: '运行取消', template: 'trends', platforms: ['xiaohongshu'], queries: ['q1', 'q2'],
    budget: { maxQueriesPerPlatform: 2 },
    plan: { platformRoles: [{ platform: 'xiaohongshu', role: '测试', queries: ['q1', 'q2'] }] }
  });
  await harness.coordinator.confirmPlan(task.id);
  const run = harness.coordinator.run(task.id);
  while (!releaseSearch) await new Promise(resolve => setImmediate(resolve));
  const requested = harness.coordinator.cancel(task.id);
  assert.equal(requested.status, 'searching');
  releaseSearch([{ id: 'unfinished-result', platform: 'xiaohongshu', url: 'https://xiaohongshu.example/1' }]);
  const cancelled = await run;

  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.results.map(result => result.id), ['completed-result']);
  assert.deepEqual(cancelled.resultIds, ['completed-result']);
  assert.equal(cancelled.usage.queriesByPlatform.xiaohongshu, 2);
  assert.equal(cancelled.usage.pages, 2);
  assert.equal(cancelled.report.summary, '');
  assert.equal(model.calls.some(call => call.purpose === 'report'), false);
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 0);
  assert.throws(() => harness.coordinator.saveSelected(task.id, ['unfinished-result']), /尚未进入保存阶段/);
});

test('报告请求发出前通知进度；请求中取消会保留结果并丢弃晚到报告', async () => {
  let releaseReport;
  const model = makeModelClient();
  const originalRequest = model.requestModel;
  model.requestModel = async input => input.options?.purpose === 'report'
    ? new Promise(resolve => { releaseReport = resolve; })
    : originalRequest(input);
  const harness = makeHarness({ model });
  const task = await harness.coordinator.createPlan({ topic: '报告阶段取消', template: 'trends', platforms: ['xiaohongshu'] });
  await harness.coordinator.confirmPlan(task.id);
  const events = [];
  const run = harness.coordinator.run(task.id, { onEvent: event => events.push(event) });
  while (!releaseReport) await new Promise(resolve => setImmediate(resolve));

  assert.equal(events.at(-1).type, 'report-start');
  assert.equal(harness.coordinator.getState().researchTasks[0].status, 'searching');
  harness.coordinator.cancel(task.id);
  releaseReport(JSON.stringify({ summary: '不应保留的报告', resultIds: ['xiaohongshu-1'] }));
  const cancelled = await run;

  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.results.map(result => result.id), ['xiaohongshu-1']);
  assert.deepEqual(cancelled.resultIds, ['xiaohongshu-1']);
  assert.equal(cancelled.report.summary, '');
  assert.equal(harness.coordinator.getState().researchTasks[0].report.summary, '');
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 0);
  assert.equal(cancelled.rejectionReason, '用户取消');
});

test('报告请求期间重复 run 被拒绝，活动运行不会被覆盖', async () => {
  let releaseSearch;
  const social = makeSocial({ xiaohongshu: { search: async () => new Promise(resolve => { releaseSearch = resolve; }) } });
  const harness = makeHarness({ social });
  const task = await harness.coordinator.createPlan({ topic: '阻止重复运行', template: 'trends', platforms: ['xiaohongshu'] });
  await harness.coordinator.confirmPlan(task.id);
  const run = harness.coordinator.run(task.id);
  while (!releaseSearch) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => harness.coordinator.run(task.id), /已在运行/);
  harness.coordinator.cancel(task.id);
  releaseSearch([{ id: 'discard-me', platform: 'xiaohongshu', url: 'https://xiaohongshu.example/1' }]);
  assert.equal((await run).status, 'cancelled');
});

test('持久化异常原样抛出；预算超限保留已收集结果和错误码', async () => {
  const persistenceError = Object.assign(new Error('写入失败'), { code: 'storage_unavailable' });
  const persistenceHarness = makeHarness({ persistState(state) {
    if (state.researchTasks.some(task => task.status === 'searching')) throw persistenceError;
    return state;
  } });
  const persistenceTask = await persistenceHarness.coordinator.createPlan({ topic: '持久化异常', template: 'trends', platforms: ['xiaohongshu'] });
  await persistenceHarness.coordinator.confirmPlan(persistenceTask.id);
  await assert.rejects(persistenceHarness.coordinator.run(persistenceTask.id), error => error === persistenceError);

  const social = makeSocial({ xiaohongshu: { search: async ({ query }) => [
    { id: `${query}-result`, platform: 'xiaohongshu', url: `https://xiaohongshu.example/${query}` }
  ] } });
  const budgetHarness = makeHarness({ social });
  const budgetTask = await budgetHarness.coordinator.createPlan({
    topic: '预算异常', template: 'trends', platforms: ['xiaohongshu'], queries: ['q1', 'q2'],
    plan: { platformRoles: [{ platform: 'xiaohongshu', role: '测试', queries: ['q1', 'q2'] }] },
    budget: { maxPages: 1, maxQueriesPerPlatform: 2 }
  });
  await budgetHarness.coordinator.confirmPlan(budgetTask.id);
  const budgetResult = await budgetHarness.coordinator.run(budgetTask.id);
  assert.equal(budgetResult.status, 'awaiting-save');
  assert.equal(budgetResult.platformErrors.xiaohongshu.code, 'budget_exceeded');
  assert.deepEqual(budgetResult.results.map(result => result.id), ['q1-result']);
  assert.deepEqual(budgetResult.resultIds, ['q1-result']);
  assert.equal(budgetResult.usage.queriesByPlatform.xiaohongshu, 1);
  assert.equal(budgetResult.usage.pages, 1);
  assert.equal(budgetResult.usage.details, 0);
  assert.equal(social.calls.filter(call => call[0] === 'search').length, 1);
  assert.deepEqual(budgetHarness.coordinator.getState().researchTasks[0].resultIds, ['q1-result']);
});

test('报告模型抛错时取消优先，最终状态为 cancelled', async () => {
  let rejectReport;
  const model = makeModelClient();
  const originalRequest = model.requestModel;
  model.requestModel = input => input.options?.purpose === 'report'
    ? new Promise((resolve, reject) => { rejectReport = reject; })
    : originalRequest(input);
  const harness = makeHarness({ model });
  const task = await harness.coordinator.createPlan({ topic: '取消后报告异常', template: 'trends', platforms: ['xiaohongshu'] });
  await harness.coordinator.confirmPlan(task.id);
  const run = harness.coordinator.run(task.id);
  while (!rejectReport) await new Promise(resolve => setImmediate(resolve));
  harness.coordinator.cancel(task.id);
  rejectReport(Object.assign(new Error('report service unavailable'), { code: 'model_unavailable' }));
  const cancelled = await run;

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.reportError, '');
  assert.deepEqual(cancelled.results.map(result => result.id), ['xiaohongshu-1']);
});

test('搜索结束不自动深读；小红书显式详情动作使用对象 contentId 并预占预算', async () => {
  const harness = makeDeepHarness({ results: [{
    id: 'xhs-result', platform: 'xiaohongshu', contentId: 'note_123',
    url: 'https://www.xiaohongshu.com/explore/note_123?xsec_source=pc&campaign=spring&XsecToken=abc',
    title: '搜索标题', summary: '搜索摘要'
  }] });
  const task = await completeDeepTask(harness);
  assert.equal(harness.sourceCalls.length, 0, '搜索和自动报告不得调用详情来源');
  const persistedResult = harness.coordinator.getState().researchTasks[0].results[0];
  const persistedUrl = new URL(persistedResult.url);
  assert.equal(persistedUrl.searchParams.get('xsec_source'), 'pc');
  assert.equal(persistedUrl.searchParams.get('campaign'), 'spring');
  assert.equal([...persistedUrl.searchParams.keys()].some(name => /^(?:xsec_token|xsectoken)$/i.test(name)), false);
  assert.equal(JSON.stringify(harness.coordinator.getState()).includes('xsecToken'), false);

  await harness.coordinator.deepRead(task.id, ['xhs-result'], ['detail']);
  const call = harness.sourceCalls[0];
  assert.deepEqual(call.request.contentId, { noteId: 'note_123', xsecSource: 'pc', xsecToken: 'abc' });
  assert.deepEqual(Object.keys(call.request).sort(), [
    'action', 'budget', 'capability', 'contentId', 'platform', 'profileId', 'sourceId', 'taskId'
  ]);
  assert.equal(call.request.action, call.request.capability);
  assert.equal(call.request.budget.maxRequests, 1);
  assert.equal(call.request.budget.maxItems, 1);
  assert.equal(call.state.researchTasks[0].usage.details, 1);
  assert.equal(call.state.researchTasks[0].usage.pages, 2, '搜索页和深读页均已计费');
  const updated = harness.coordinator.getState().researchTasks[0];
  assert.equal(updated.results[0].summary, '搜索摘要', '深读不能覆盖搜索摘要');
  assert.equal(updated.results[0].materials[0].status, 'completed');
  assert.equal(updated.results[0].materials[0].sourceId, 'mediacrawler-lite');
  assert.equal(updated.results[0].materials[0].connectionMethod, 'local-process');
  assert.equal(updated.results[0].materials[0].acquisitionMethod, 'platform-interface');
  assert.equal(updated.results[0].materials[0].totalCount, null);
});

test('从持久化状态重启后不恢复小红书访问 token', async () => {
  const original = makeDeepHarness({ results: [{
    id: 'xhs-restart', platform: 'xiaohongshu', contentId: 'note_restart',
    url: 'https://www.xiaohongshu.com/explore/note_restart?xsec_source=pc&keep=1&xsec_token=restart-secret'
  }] });
  const task = await completeDeepTask(original);
  const savedState = structuredClone(original.coordinator.getState());
  assert.equal(JSON.stringify(savedState).includes('restart-secret'), false);

  const restarted = makeDeepHarness({ initialState: savedState });
  await restarted.coordinator.deepRead(task.id, ['xhs-restart'], ['detail']);
  const contentId = restarted.sourceCalls[0].request.contentId;
  assert.deepEqual(contentId, { noteId: 'note_restart', xsecSource: 'pc' });
  assert.equal(Object.hasOwn(contentId, 'xsecToken'), false);
});

test('B 站详情与评论使用各自的精确对象 contentId', async () => {
  const harness = makeDeepHarness({ platform: 'bilibili', results: [{
    id: 'bili-result', platform: 'bilibili', contentId: 'BV1Q541167Qg',
    url: 'https://www.bilibili.com/video/BV1Q541167Qg', title: '视频标题', summary: '视频搜索摘要'
  }] });
  const task = await completeDeepTask(harness, 'bilibili');
  await harness.coordinator.deepRead(task.id, ['bili-result'], ['detail', 'comments']);
  assert.deepEqual(harness.sourceCalls.map(item => item.request.action), ['detail', 'comments']);
  assert.deepEqual(harness.sourceCalls[0].request.contentId, { bvid: 'BV1Q541167Qg' });
  assert.deepEqual(harness.sourceCalls[1].request.contentId, { bvid: 'BV1Q541167Qg', cursor: 0 });
  assert.equal(harness.sourceCalls[1].request.budget.maxItems, 20);
  assert.equal(harness.coordinator.getState().researchTasks[0].results[0].summary, '视频搜索摘要');
});

test('B 站评论按两页预占任务预算，空间不足时不发送来源请求', async () => {
  const result = {
    id: 'bili-budget-result', platform: 'bilibili', contentId: 'BV1Q541167Qg',
    url: 'https://www.bilibili.com/video/BV1Q541167Qg'
  };
  const onePageHarness = makeDeepHarness({
    platform: 'bilibili', results: [result],
    initialState: deepReadInitialState('bilibili', result, 1)
  });
  const onePageTask = onePageHarness.coordinator.getState().researchTasks[0];
  const insufficient = await onePageHarness.coordinator.deepRead(onePageTask.id, [result.id], ['comments']);
  assert.equal(onePageHarness.sourceCalls.filter(call => call.request).length, 0);
  assert.equal(insufficient.usage.pages, 0);
  assert.ok(insufficient.usage.pages <= insufficient.budget.maxPages);
  assert.equal(insufficient.results[0].materials[0].errorCode, 'budget_exceeded');

  const twoPageHarness = makeDeepHarness({
    platform: 'bilibili', results: [result],
    initialState: deepReadInitialState('bilibili', result, 2)
  });
  const twoPageTask = twoPageHarness.coordinator.getState().researchTasks[0];
  await twoPageHarness.coordinator.deepRead(twoPageTask.id, [result.id], ['comments']);
  assert.equal(twoPageHarness.sourceCalls.filter(call => call.request).length, 1);
  assert.equal(twoPageHarness.sourceCalls[0].state.researchTasks[0].usage.pages, 2);
  assert.equal(twoPageHarness.coordinator.getState().researchTasks[0].usage.pages, 2);
  assert.equal(twoPageHarness.sourceCalls[0].request.budget.maxRequests, 2);
});

test('来源请求按桥接统计累计并在重启后耗尽时拒绝新请求', async () => {
  const harness = makeDeepHarness({
    results: [{ id: 'source-budget-result', platform: 'xiaohongshu', contentId: 'note_budget', url: 'https://www.xiaohongshu.com/explore/note_budget' }],
    sourceAction: async request => ({
      status: 'ok', version: '1.0.0',
      budget: { usedRequests: 1, usedItems: request.action === 'comments' ? 1 : 0, unknownRequests: 0 },
      data: request.action === 'comments' ? { comments: [{ id: 'c1' }] } : { note: { desc: '详情' } }
    })
  });
  const task = await completeDeepTask(harness, 'xiaohongshu', { maxSourceRequests: 2 });
  await harness.coordinator.deepRead(task.id, ['source-budget-result'], ['detail']);
  const persisted = structuredClone(harness.coordinator.getState());
  assert.equal(persisted.researchTasks[0].usage.sourceRequests, 2, '搜索和深读请求都计入同一任务预算');
  assert.equal(persisted.researchTasks[0].budget.maxSourceRequests, 2);

  const restarted = makeDeepHarness({ initialState: persisted });
  await restarted.coordinator.deepRead(task.id, ['source-budget-result'], ['comments']);
  const updated = restarted.coordinator.getState().researchTasks[0];
  assert.equal(restarted.sourceCalls.length, 0, '耗尽后不得调用来源');
  assert.equal(updated.usage.sourceRequests, 2);
  assert.equal(updated.results[0].materials.at(-1).errorCode, 'budget_exceeded');
  assert.match(updated.results[0].materials.at(-1).errorMessage, /来源出站请求次数/);
});

test('来源失败按可信桥接用量结算，缺失或无效统计时保留操作上限', async () => {
  const knownFailure = makeDeepHarness({
    platform: 'bilibili',
    results: [{ id: 'known-failure', platform: 'bilibili', contentId: 'BV1Q541167Qg', url: 'https://www.bilibili.com/video/BV1Q541167Qg' }],
    sourceAction: async () => ({
      status: 'error', code: 'TIMEOUT', message: '超时',
      budget: { usedRequests: 1, usedItems: 0, unknownRequests: 1 }
    })
  });
  const knownTask = await completeDeepTask(knownFailure, 'bilibili');
  await knownFailure.coordinator.deepRead(knownTask.id, ['known-failure'], ['comments']);
  assert.equal(knownFailure.coordinator.getState().researchTasks[0].usage.sourceRequests, 2,
    'unknownRequests 是 usedRequests 的子集，不能重复相加');

  const unknownFailure = makeDeepHarness({
    platform: 'bilibili',
    results: [{ id: 'unknown-failure', platform: 'bilibili', contentId: 'BV1Q541167Qg', url: 'https://www.bilibili.com/video/BV1Q541167Qg' }],
    sourceAction: async () => ({ status: 'error', code: 'TIMEOUT', message: '桥接未返回预算统计' })
  });
  const unknownTask = await completeDeepTask(unknownFailure, 'bilibili');
  await unknownFailure.coordinator.deepRead(unknownTask.id, ['unknown-failure'], ['comments']);
  assert.equal(unknownFailure.coordinator.getState().researchTasks[0].usage.sourceRequests, 3,
    '统计未知时按本次操作 maxRequests 全额保守计量');
});

test('评论硬限制为 20 条一级评论，不保留二级回复并记录截断', async () => {
  const comments = Array.from({ length: 25 }, (_, index) => ({
    id: `comment-${index}`, content: `评论 ${index}`, replies: [{ id: `reply-${index}`, content: '二级回复不应保留' }]
  }));
  const harness = makeDeepHarness({
    results: [{ id: 'xhs-comments', platform: 'xiaohongshu', contentId: 'note_456', url: 'https://www.xiaohongshu.com/explore/note_456' }],
    sourceAction: async () => ({ status: 'ok', version: '1.0.0', data: { comments } })
  });
  const task = await completeDeepTask(harness);
  await harness.coordinator.deepRead(task.id, ['xhs-comments'], ['comments']);
  const material = harness.coordinator.getState().researchTasks[0].results[0].materials[0];
  const content = harness.coordinator.getTransientMaterial(material.id);
  assert.equal(harness.sourceCalls[0].request.budget.maxItems, 20);
  assert.equal(content.comments.length, 20);
  assert.equal(content.comments[0].replies, undefined);
  assert.equal(material.itemCount, 20);
  assert.equal(material.truncated, true);
  assert.equal(material.sortOrder, 'unknown');
  assert.equal(material.totalCount, null);
});

test('评论来源提供排序和可见总数时原样保存在材料元数据', async () => {
  const harness = makeDeepHarness({
    results: [{ id: 'comment-metadata', platform: 'xiaohongshu', contentId: 'note_meta', url: 'https://www.xiaohongshu.com/explore/note_meta' }],
    sourceAction: async () => ({ status: 'ok', version: '1.0.0', data: {
      comments: [{ id: 'c1' }], sort_order: '最新评论', total_count: 37
    } })
  });
  const task = await completeDeepTask(harness);
  await harness.coordinator.deepRead(task.id, ['comment-metadata'], ['comments']);
  const material = harness.coordinator.getState().researchTasks[0].results[0].materials[0];
  assert.equal(material.sortOrder, '最新评论');
  assert.equal(material.totalCount, 37);
});

test('逐项预占 maxDetails/maxPages；预算耗尽后不发请求并记录可恢复状态', async () => {
  const harness = makeDeepHarness({ results: [
    { id: 'first', platform: 'xiaohongshu', contentId: 'note_1', url: 'https://www.xiaohongshu.com/explore/note_1', summary: '保留的搜索摘要' },
    { id: 'second', platform: 'xiaohongshu', contentId: 'note_2', url: 'https://www.xiaohongshu.com/explore/note_2', summary: '第二条搜索摘要' }
  ] });
  const task = await completeDeepTask(harness, 'xiaohongshu', { maxDetails: 1, maxPages: 2 });
  await harness.coordinator.deepRead(task.id, ['first', 'second'], ['detail', 'comments']);
  const updated = harness.coordinator.getState().researchTasks[0];
  assert.equal(harness.sourceCalls.length, 1);
  assert.equal(harness.sourceCalls[0].state.researchTasks[0].usage.details, 1);
  assert.equal(harness.sourceCalls[0].state.researchTasks[0].usage.pages, 2);
  assert.equal(updated.usage.details, 1);
  assert.equal(updated.usage.pages, 2);
  assert.equal(updated.results[0].materials[0].status, 'completed');
  assert.ok(updated.results.flatMap(result => result.materials).some(material => material.errorCode === 'budget_exceeded' || material.errorCode === 'BUDGET_EXCEEDED'));
  assert.equal(updated.results[0].summary, '保留的搜索摘要');
});

test('单条来源失败保留搜索摘要和其他已完成材料', async () => {
  const harness = makeDeepHarness({
    results: [{ id: 'keep-result', platform: 'xiaohongshu', contentId: 'note_7', url: 'https://www.xiaohongshu.com/explore/note_7', summary: '原搜索摘要' }],
    sourceAction: async request => request.action === 'comments'
      ? { status: 'error', code: 'TIMEOUT', message: '采集动作已超时。' }
      : { status: 'ok', version: '1.0.0', data: { note: { desc: '已完成详情' } } }
  });
  const task = await completeDeepTask(harness);
  await harness.coordinator.deepRead(task.id, ['keep-result'], ['detail', 'comments']);
  const result = harness.coordinator.getState().researchTasks[0].results[0];
  assert.equal(result.summary, '原搜索摘要');
  assert.equal(result.materials[0].status, 'completed');
  assert.equal(result.materials[1].status, 'failed');
  assert.equal(result.materials.length, 2, '失败应更新在途材料，不能留下 running 副本');
  assert.equal(result.materials[1].errorCategory, 'timeout');
  assert.equal(harness.coordinator.getTransientMaterial(result.materials[0].id).note.desc, '已完成详情');
});

test('来源登记查询失败记录真实错误，不误报不支持来源且保留已有材料', async t => {
  const scenarios = [
    {
      name: 'list IPC reject 保留原始错误码',
      expectedCode: 'REGISTRY_IPC_DISCONNECTED',
      expectedMessage: '来源登记 IPC 连接中断。',
      list: async () => {
        throw Object.assign(new Error('来源登记 IPC 连接中断。'), { code: 'REGISTRY_IPC_DISCONNECTED' });
      }
    },
    {
      name: 'list IPC 错误响应保留原始错误码',
      expectedCode: 'REQUEST_FAILED',
      expectedMessage: '登记查询失败响应。',
      list: async () => ({ status: 'error', code: 'REQUEST_FAILED', message: '登记查询失败响应。' })
    },
    {
      name: '无效响应使用稳定错误码',
      expectedCode: 'SOURCE_REGISTRY_FAILED',
      expectedMessage: '来源登记查询返回无效响应。',
      list: async () => ({ unexpected: true })
    }
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const result = {
        id: 'registry-query-result', platform: 'xiaohongshu', contentId: 'note_registry',
        url: 'https://www.xiaohongshu.com/explore/note_registry', summary: '原搜索摘要',
        materials: [{
          id: 'existing-detail-material', kind: 'detail', contentId: 'note_registry',
          sourceId: 'mediacrawler-lite', status: 'completed', summary: '已有详情材料'
        }]
      };
      const harness = makeDeepHarness({
        results: [result],
        initialState: deepReadInitialState('xiaohongshu', result, 5)
      });
      harness.api.socialSource.list = scenario.list;

      const task = harness.coordinator.getState().researchTasks[0];
      const updated = await harness.coordinator.deepRead(task.id, [result.id], ['comments']);
      const updatedResult = updated.results[0];
      const failedMaterial = updatedResult.materials.find(material => material.kind === 'comments');

      assert.equal(harness.sourceCalls.length, 0, '登记查询失败时不得调用 source.run');
      assert.equal(updatedResult.summary, '原搜索摘要');
      assert.ok(updatedResult.materials.some(material =>
        material.id === 'existing-detail-material' && material.status === 'completed'
          && material.summary === '已有详情材料'));
      assert.equal(failedMaterial.status, 'failed');
      assert.equal(failedMaterial.errorCode, scenario.expectedCode);
      assert.equal(failedMaterial.errorMessage, scenario.expectedMessage);
      assert.equal(failedMaterial.errorCategory, 'source-registry-error');
    });
  }
});

test('来源登记查询成功但来源未登记时仍标记为不可用', async () => {
  const result = {
    id: 'unregistered-source-result', platform: 'xiaohongshu', contentId: 'note_unregistered',
    url: 'https://www.xiaohongshu.com/explore/note_unregistered', summary: '保留的搜索摘要'
  };
  const harness = makeDeepHarness({
    results: [result],
    initialState: deepReadInitialState('xiaohongshu', result, 5)
  });
  harness.api.socialSource.list = async () => [];

  const task = harness.coordinator.getState().researchTasks[0];
  const updated = await harness.coordinator.deepRead(task.id, [result.id], ['detail']);
  const material = updated.results[0].materials[0];

  assert.equal(harness.sourceCalls.length, 0);
  assert.equal(updated.results[0].summary, '保留的搜索摘要');
  assert.equal(material.status, 'unavailable');
  assert.equal(material.errorCode, 'UNSUPPORTED_SOURCE');
  assert.equal(material.errorCategory, 'source-unavailable');
});

test('权限不足和页面结构变化使用各自稳定错误分类，普通错误不误分类', async () => {
  for (const [code, category] of [
    ['PERMISSION_DENIED', 'permission-denied'],
    ['PAGE_STRUCTURE_CHANGED', 'page-changed'],
    ['REQUEST_FAILED', 'source-error']
  ]) {
    const harness = makeDeepHarness({
      results: [{ id: `error-${code}`, platform: 'xiaohongshu', contentId: 'note_error',
        url: 'https://www.xiaohongshu.com/explore/note_error' }],
      sourceAction: async () => ({ status: 'error', code, message: '读取未完成。' })
    });
    const task = await completeDeepTask(harness);
    const updated = await harness.coordinator.deepRead(task.id, [`error-${code}`], ['detail']);
    const material = updated.results[0].materials[0];
    assert.equal(material.errorCode, code);
    assert.equal(material.errorCategory, category);
  }
});

test('全文默认只留内存；用户主动保存后附件索引关联结果和材料', async () => {
  const longBody = `FULL_BODY_SENTINEL${'保留为全文但不进入持久状态。'.repeat(80)}`;
  const harness = makeDeepHarness({
    results: [{ id: 'private-result', platform: 'xiaohongshu', contentId: 'note_8', url: 'https://www.xiaohongshu.com/explore/note_8', summary: '搜索摘要' }],
    sourceAction: async () => ({ status: 'ok', version: '1.0.0', data: { note: { desc: longBody } } })
  });
  const task = await completeDeepTask(harness);
  await harness.coordinator.deepRead(task.id, ['private-result'], ['detail']);
  let stateJson = JSON.stringify(harness.coordinator.getState());
  assert.equal(stateJson.includes('FULL_BODY_SENTINEL'), false);
  const result = harness.coordinator.getState().researchTasks[0].results[0];
  const material = result.materials[0];
  assert.equal(material.summary.includes('FULL_BODY_SENTINEL'), false);
  assert.equal(harness.coordinator.getTransientMaterial(material.id).note.desc, longBody);
  assert.equal(harness.attachments.length, 0, '未显式保存前不得调用附件 API');

  await harness.coordinator.saveMaterials(task.id, [material.id]);
  assert.equal(harness.attachments.length, 1);
  assert.match(Buffer.from(harness.attachments[0].content, 'base64').toString('utf8'), /FULL_BODY_SENTINEL/);
  const saved = harness.coordinator.getState();
  const savedMaterial = saved.researchTasks[0].results[0].materials[0];
  assert.ok(savedMaterial.attachmentId);
  assert.ok(saved.researchTasks[0].results[0].attachmentIds.includes(savedMaterial.attachmentId));
  assert.equal(saved.researchAttachments[0].sourceResultId, 'private-result');
  stateJson = JSON.stringify(saved);
  assert.equal(stateJson.includes('FULL_BODY_SENTINEL'), false);
});

test('同一全文的并发保存复用进行中的请求，只保存一个附件并扣一次预算', async () => {
  const harness = makeDeepHarness({ results: [{
    id: 'concurrent-result', platform: 'xiaohongshu', contentId: 'note_concurrent',
    url: 'https://www.xiaohongshu.com/explore/note_concurrent', summary: '搜索摘要'
  }] });
  const task = await completeDeepTask(harness);
  await harness.coordinator.deepRead(task.id, ['concurrent-result'], ['detail']);
  const material = harness.coordinator.getState().researchTasks[0].results[0].materials[0];
  const content = harness.coordinator.getTransientMaterial(material.id);
  const expectedBytes = Buffer.byteLength(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  const usageBefore = harness.coordinator.getState().researchTasks[0].usage.attachmentBytes;
  const saveAttachment = harness.api.research.saveAttachment;
  let callCount = 0;
  let releaseSave;
  harness.api.research.saveAttachment = async payload => {
    callCount += 1;
    await new Promise(resolve => { releaseSave = resolve; });
    return saveAttachment(payload);
  };

  const saves = [
    harness.coordinator.saveMaterials(task.id, [material.id]),
    harness.coordinator.saveMaterials(task.id, [material.id])
  ];
  while (!releaseSave) await new Promise(resolve => setImmediate(resolve));
  assert.equal(callCount, 1);
  releaseSave();
  await Promise.all(saves);

  const saved = harness.coordinator.getState();
  assert.equal(harness.attachments.length, 1);
  assert.equal(saved.researchAttachments.length, 1);
  assert.deepEqual(saved.researchTasks[0].results[0].attachmentIds, [saved.researchAttachments[0].id]);
  assert.equal(saved.researchTasks[0].usage.attachmentBytes, usageBefore + expectedBytes);
});

test('附件保存异常会回滚预算并释放锁，重试成功后只扣一次预算', async () => {
  const harness = makeDeepHarness({ results: [{
    id: 'retry-result', platform: 'xiaohongshu', contentId: 'note_retry',
    url: 'https://www.xiaohongshu.com/explore/note_retry', summary: '搜索摘要'
  }] });
  const task = await completeDeepTask(harness);
  await harness.coordinator.deepRead(task.id, ['retry-result'], ['detail']);
  const material = harness.coordinator.getState().researchTasks[0].results[0].materials[0];
  const content = harness.coordinator.getTransientMaterial(material.id);
  const expectedBytes = Buffer.byteLength(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  const usageBefore = harness.coordinator.getState().researchTasks[0].usage.attachmentBytes;
  const saveAttachment = harness.api.research.saveAttachment;
  let callCount = 0;
  harness.api.research.saveAttachment = async payload => {
    callCount += 1;
    if (callCount === 1) throw new Error('临时附件存储错误');
    return saveAttachment(payload);
  };

  await assert.rejects(() => harness.coordinator.saveMaterials(task.id, [material.id]), /临时附件存储错误/);
  assert.equal(harness.coordinator.getState().researchTasks[0].usage.attachmentBytes, usageBefore);

  await harness.coordinator.saveMaterials(task.id, [material.id]);
  const saved = harness.coordinator.getState();
  assert.equal(callCount, 2);
  assert.equal(harness.attachments.length, 1);
  assert.equal(saved.researchAttachments.length, 1);
  assert.equal(saved.researchTasks[0].usage.attachmentBytes, usageBefore + expectedBytes);
});

test('报告 citation 只接受真实结果与其已完成材料，报告失败保留旧报告', async () => {
  const harness = makeDeepHarness({ results: [{
    id: 'cited-result', platform: 'xiaohongshu', contentId: 'note_9',
    url: 'https://www.xiaohongshu.com/explore/note_9', summary: '搜索摘要'
  }] });
  const task = await completeDeepTask(harness, 'xiaohongshu', { maxAnalysisTokens: 100000 });
  await harness.coordinator.deepRead(task.id, ['cited-result'], ['detail']);
  const before = harness.coordinator.getState().researchTasks[0];
  const materialId = before.results[0].materials[0].id;
  harness.api.requestModel = async ({ options }) => options?.purpose === 'report' ? JSON.stringify({
    summary: '包含有效材料引用', coreFindings: ['经材料核实的发现'],
    resultIds: ['cited-result', 'invented-result'],
    citations: [
      { findingIndex: 0, resultId: 'cited-result', materialId },
      { findingIndex: 0, resultId: 'invented-result', materialId: 'invented-material' },
      { findingIndex: 0, resultId: 'cited-result', materialId: 'invented-material' }
    ]
  }) : '';
  const updated = await harness.coordinator.regenerateReport(task.id);
  assert.deepEqual(updated.report.resultIds, ['cited-result']);
  assert.deepEqual(updated.report.citations, [{ findingIndex: 0, resultId: 'cited-result', materialId }]);
  const oldReport = structuredClone(updated.report);
  harness.api.requestModel = async () => { throw Object.assign(new Error('模型服务超时'), { code: 'TIMEOUT' }); };
  const failed = await harness.coordinator.regenerateReport(task.id);
  assert.deepEqual(failed.report, oldReport);
  assert.equal(failed.reportError, '模型服务超时');
  assert.equal(failed.results[0].materials[0].id, materialId);
});

test('深读取消后来源晚到成功响应不会保存内容，并保留此前完成材料', async () => {
  let finishRequest;
  const harness = makeDeepHarness({
    results: [{ id: 'cancel-result', platform: 'xiaohongshu', contentId: 'note_10', url: 'https://www.xiaohongshu.com/explore/note_10' }],
    sourceAction: request => request.action === 'detail'
      ? { status: 'ok', version: '1.0.0', data: { note: { desc: '此前完成的详情' } } }
      : new Promise(resolve => { finishRequest = resolve; })
  });
  const task = await completeDeepTask(harness);
  const running = harness.coordinator.deepRead(task.id, ['cancel-result'], ['detail', 'comments']);
  while (!finishRequest) await new Promise(resolve => setImmediate(resolve));
  harness.coordinator.cancel(task.id);
  finishRequest({ status: 'ok', version: '1.0.0', data: { comments: [{ content: '晚到但不得保存的评论' }] } });
  const updated = await running;
  assert.deepEqual(harness.sourceCalls.find(item => item.cancel)?.cancel, {
    sourceId: 'mediacrawler-lite', platform: 'xiaohongshu',
    profileId: `social-research-xiaohongshu`, taskId: task.id
  });
  assert.equal(updated.status, 'awaiting-save');
  assert.equal(updated.results[0].id, 'cancel-result');
  assert.deepEqual(updated.results[0].materials.map(material => material.status), ['completed', 'cancelled']);
  assert.equal(harness.coordinator.getTransientMaterial(updated.results[0].materials[0].id).note.desc, '此前完成的详情');
  assert.equal(harness.coordinator.getTransientMaterial(updated.results[0].materials[1].id), undefined);
  assert.equal(JSON.stringify(updated).includes('晚到但不得保存的评论'), false);
  assert.equal(harness.sourceCalls.filter(item => item.request).length, 2);
});

test('计划、平台检查、搜索与报告共用 duration 预算并向请求传入剩余 timeout', async () => {
  let clock = 0;
  const baseModel = makeModelClient();
  const modelCalls = [];
  const model = {
    async requestModel(input) {
      const purpose = input.options?.purpose;
      modelCalls.push({ purpose, timeoutMs: input.options?.timeoutMs });
      clock += purpose === 'plan' ? 5 : 13;
      return baseModel.requestModel(input);
    }
  };
  const social = makeSocial({ xiaohongshu: {
    async check() { clock += 7; return { status: 'ok', ready: true }; },
    async search() {
      clock += 11;
      return [{ id: 'timed-result', platform: 'xiaohongshu', url: 'https://xiaohongshu.example/timed' }];
    }
  } });
  const harness = makeHarness({ model, social, now: () => clock });
  const task = await harness.coordinator.createPlan({
    topic: '累计时间', template: 'trends', platforms: ['xiaohongshu'], budget: { maxDurationMs: 200 }
  });
  assert.equal(task.usage.durationMs, 5);
  await harness.coordinator.confirmPlan(task.id);
  const finished = await harness.coordinator.run(task.id);

  assert.equal(finished.usage.durationMs, 36);
  assert.deepEqual(modelCalls, [
    { purpose: 'plan', timeoutMs: 200 },
    { purpose: 'report', timeoutMs: 177 }
  ]);
  assert.deepEqual(social.checkTimeouts, [195]);
  assert.deepEqual(social.searchTimeouts, [188]);
});

test('搜索响应超过剩余预算时完整计时、丢弃晚到结果并跳过后续搜索和报告', async () => {
  let clock = 0;
  const model = makeModelClient();
  const social = makeSocial({ xiaohongshu: {
    async search({ query }) {
      if (query === 'q1') return [{ id: 'completed-before-timeout', platform: 'xiaohongshu', url: 'https://xiaohongshu.example/complete' }];
      return new Promise(resolve => setTimeout(() => {
        clock += 60;
        resolve([{ id: 'late-result', platform: 'xiaohongshu', url: 'https://xiaohongshu.example/late' }]);
      }, 10));
    }
  } });
  const harness = makeHarness({ model, social, now: () => clock });
  const task = await harness.coordinator.createPlan({
    topic: '晚到搜索', template: 'trends', platforms: ['xiaohongshu'],
    queries: ['q1', 'q2'], budget: { maxDurationMs: 50, maxQueriesPerPlatform: 2 },
    plan: { platformRoles: [{ platform: 'xiaohongshu', role: '测试', queries: ['q1', 'q2'] }] }
  });
  await harness.coordinator.confirmPlan(task.id);
  const failed = await harness.coordinator.run(task.id);

  assert.equal(failed.status, 'partial-failure');
  assert.deepEqual(failed.results.map(result => result.id), ['completed-before-timeout']);
  assert.equal(failed.usage.durationMs, 60);
  assert.deepEqual(social.calls.filter(call => call[0] === 'search').map(call => call[2]), ['q1', 'q2']);
  assert.equal(model.calls.some(call => call.purpose === 'report'), false);
});

test('用户暂停期间不扣研究时间', async () => {
  let clock = 0;
  let releaseSearch;
  const social = makeSocial({ xiaohongshu: { search: async () => new Promise(resolve => { releaseSearch = resolve; }) } });
  const harness = makeHarness({ social, now: () => clock });
  const task = await harness.coordinator.createPlan({
    topic: '暂停计时', template: 'trends', platforms: ['xiaohongshu'], budget: { maxDurationMs: 100 }
  });
  await harness.coordinator.confirmPlan(task.id);
  const running = harness.coordinator.run(task.id);
  while (!releaseSearch) await new Promise(resolve => setImmediate(resolve));
  clock += 3;
  harness.coordinator.pause(task.id);
  clock += 1000;
  releaseSearch([{ id: 'pause-result', platform: 'xiaohongshu', url: 'https://xiaohongshu.example/pause' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.coordinator.getState().researchTasks[0].usage.durationMs, 3);
  harness.coordinator.resume(task.id);
  const finished = await running;
  assert.equal(finished.usage.durationMs, 3);
});

test('深读晚到响应被丢弃、deadline 使用剩余预算且此前完成材料保留', async () => {
  const result = schema.normalizeSocialResult({
    id: 'deep-budget-result', platform: 'xiaohongshu', contentId: 'note_1',
    url: 'https://www.xiaohongshu.com/explore/note_1', title: '深读目标'
  });
  const completedMaterial = schema.normalizeResearchMaterial({
    id: 'previously-completed-material', resultId: result.id, kind: 'detail', status: 'completed',
    summary: '此前已完成的材料', sourceId: 'mediacrawler-lite', itemCount: 1
  }, result.id);
  result.materials = [completedMaterial];
  const task = schema.createResearchTask({
    id: 'deep-budget-timeout-task', topic: '深读时限', template: 'trends',
    platforms: ['xiaohongshu'], status: 'awaiting-save',
    budget: { maxDurationMs: 30, maxPages: 5, maxDetails: 5 },
    usage: { durationMs: 0, pages: 0, details: 1 }, results: [result]
  });
  const initialState = { ...storage.createEmptyState(), researchTasks: [task] };
  const harness = makeDeepHarness({
    initialState,
    sourceAction: () => new Promise(resolve => setTimeout(() => resolve({
      status: 'ok', version: '1.0.0', data: { comments: [{ content: '超时后到达' }] }
    }), 60))
  });
  const updated = await harness.coordinator.deepRead(task.id, [result.id], ['comments']);
  const request = harness.sourceCalls.find(call => call.request)?.request;

  assert.ok(Date.parse(request.budget.deadlineAt) - Date.now() <= 30000);
  assert.ok(updated.usage.durationMs >= 25);
  assert.equal(updated.results[0].materials[0].id, completedMaterial.id);
  assert.equal(updated.results[0].materials[0].status, 'completed');
  assert.equal(updated.results[0].materials[1].status, 'failed');
  assert.equal(updated.results[0].materials[1].errorCode, 'budget_exceeded');
  assert.deepEqual(harness.sourceCalls.find(call => call.cancel)?.cancel, {
    sourceId: 'mediacrawler-lite', platform: 'xiaohongshu',
    profileId: 'social-research-xiaohongshu', taskId: task.id
  });
  assert.equal(JSON.stringify(updated).includes('超时后到达'), false);
});
