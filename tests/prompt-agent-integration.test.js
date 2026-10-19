const test = require('node:test');
const assert = require('node:assert/strict');
const { createPromptAgentResearchBridge } = require('../prototype/prompt-agent-research-bridge.js');
const { createPromptAgentCoordinator } = require('../prototype/prompt-agent-coordinator.js');
const schema = require('../prototype/prompt-agent-schema.js');
const workflow = require('../prototype/prompt-agent-workflow.js');
const prompts = require('../prototype/prompt-agent-prompts.js');
const { createPptSceneCoordinator } = require('../prototype/ppt-scene-coordinator.js');
const { createEmptyState, loadState, saveState } = require('../prototype/storage.js');

function makeScope(overrides = {}) {
  return {
    objective: '核对提示词写作方法',
    queries: ['prompt writing guide'],
    sourceTypes: ['web'],
    platforms: [],
    ...overrides
  };
}

test('预览和用户批准前不会调用网页或社媒服务，拒绝后不可执行', async () => {
  let webCalls = 0;
  let socialCalls = 0;
  const bridge = createPromptAgentResearchBridge({
    searchWeb: async () => { webCalls += 1; return { results: [] }; },
    createSocialResearchPlan: async () => { socialCalls += 1; return { status: 'awaiting-plan-confirmation' }; }
  });
  const preview = bridge.preview(makeScope({ sourceTypes: ['web', 'social'], platforms: ['reddit'] }));
  assert.equal(preview.status, 'awaiting-confirmation');
  assert.equal(webCalls, 0);
  assert.equal(socialCalls, 0);
  bridge.reject(preview.id);
  await assert.rejects(() => bridge.execute(preview.id), /必须先确认/);
  assert.equal(webCalls, 0);
  assert.equal(socialCalls, 0);
});

test('网页结果保留引用元数据并受查询与来源预算约束', async () => {
  const queries = [];
  const bridge = createPromptAgentResearchBridge({
    searchWeb: async query => {
      queries.push(query);
      return { configured: true, results: [
        { title: `来源 ${query}`, url: `https://example.com/${encodeURIComponent(query)}`, date: '2026-10-19', summary: '摘要', applicability: '适用写作', limitations: '需查原文', content: '不应回传全文' },
        { title: '超过预算', url: `https://example.com/extra/${encodeURIComponent(query)}`, summary: '额外来源' }
      ] };
    }
  });
  const preview = bridge.preview(makeScope({ queries: ['q1', 'q2', 'q3'] }));
  const approved = bridge.approve(preview.id);
  assert.equal(approved.budget.maxQueries, 3);
  const result = await bridge.execute(preview.id);

  assert.deepEqual(queries, ['q1', 'q2', 'q3']);
  assert.equal(result.usedQueries, 3);
  assert.equal(result.usedSources, 5);
  assert.equal(result.results.length, 5);
  assert.equal(result.results[0].date, '2026-10-19');
  assert.equal(result.results[0].applicability, '适用写作');
  assert.equal(JSON.stringify(result).includes('不应回传全文'), false);
});

test('官方文档、社区、GitHub、评测和案例来源类型复用网页搜索通道', async () => {
  const queries = [];
  const bridge = createPromptAgentResearchBridge({
    searchWeb: async query => {
      queries.push(query);
      return { results: [{ title: '来源', url: 'https://example.com/source', summary: '摘要' }] };
    }
  });
  const sourceTypes = ['official-docs', '官方文档', 'community', 'github', '评测', '案例'];
  const preview = bridge.preview(makeScope({ sourceTypes, queries: ['资料指南'] }));
  assert.deepEqual(preview.sourceTypes, sourceTypes);
  bridge.approve(preview.id);
  const result = await bridge.execute(preview.id);

  assert.deepEqual(queries, ['资料指南']);
  assert.equal(result.status, 'complete');
});

test('超出默认预算时要求确认调整，且仍受硬上限约束', () => {
  const bridge = createPromptAgentResearchBridge();
  const preview = bridge.preview(makeScope({ queries: ['a', 'b', 'c', 'd'], budget: { maxQueries: 4, maxSources: 8 } }));
  assert.equal(preview.requiresBudgetConfirmation, true);
  assert.throws(() => bridge.approve(preview.id), /需确认/);
  const approved = bridge.approve(preview.id, {
    confirmBudget: true,
    budget: { maxQueries: 4, maxSources: 8 }
  });
  assert.equal(approved.budget.maxQueries, 4);
  assert.equal(approved.budget.maxSources, 8);
  const capped = bridge.preview(makeScope({ budget: { maxQueries: 999, maxSources: 999 } }));
  assert.equal(capped.requestedBudget.maxQueries, 10);
  assert.equal(capped.requestedBudget.maxSources, 20);
});

test('社媒桥接只创建既有研究 Agent 的待确认计划，不直接执行社媒搜索', async () => {
  const calls = [];
  const bridge = createPromptAgentResearchBridge({
    createSocialResearchPlan: async request => {
      calls.push(request);
      return { id: 'social-1', status: 'awaiting-plan-confirmation' };
    }
  });
  const preview = bridge.preview(makeScope({ sourceTypes: ['social'], platforms: ['reddit', 'youtube'], queries: ['prompt examples'] }));
  assert.equal(preview.requiresBudgetConfirmation, false);
  const approved = bridge.approve(preview.id);
  assert.equal(calls.length, 0);
  const result = await bridge.execute(approved.id);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].topic, '核对提示词写作方法');
  assert.equal(calls[0].template, 'fact-check');
  assert.deepEqual(calls[0].platforms, ['reddit', 'youtube']);
  assert.deepEqual(calls[0].queries, ['prompt examples']);
  assert.equal(calls[0].budget.maxDetails, 5);
  assert.equal(calls[0].budget.maxResultsPerQuery, undefined);
  assert.equal(result.socialHandoff.status, 'awaiting-plan-confirmation');
  assert.equal(result.status, 'awaiting-social-plan-confirmation');
  assert.equal(result.incomplete, true);
  const imported = bridge.collectSocialResearchResult({
    status: 'awaiting-save',
    report: { summary: '社媒研究摘要', needsVerification: ['样本数量有限'] },
    results: [{ title: '讨论', url: 'https://reddit.example/post', summary: '用户经验', content: '不应透传全文' }]
  });
  assert.equal(imported.summary, '社媒研究摘要');
  assert.equal(imported.sources.length, 1);
  assert.deepEqual(imported.limitations, ['样本数量有限']);
  assert.equal(JSON.stringify(imported).includes('不应透传全文'), false);
});

test('混合研究在网页来源耗尽预算后不会创建超额社媒计划', async () => {
  let socialCalls = 0;
  const bridge = createPromptAgentResearchBridge({
    searchWeb: async () => ({ results: Array.from({ length: 5 }, (_, index) => ({
      title: `来源 ${index}`, url: `https://example.com/${index}`, summary: '摘要'
    })) }),
    createSocialResearchPlan: async () => { socialCalls += 1; return { status: 'awaiting-plan-confirmation' }; }
  });
  const preview = bridge.preview(makeScope({
    sourceTypes: ['web', 'social'], platforms: ['reddit'], queries: ['q1']
  }));
  bridge.approve(preview.id);
  const result = await bridge.execute(preview.id);

  assert.equal(result.results.length, 5);
  assert.equal(result.status, 'partial');
  assert.equal(socialCalls, 0);
  assert.match(result.errors[0].message, /来源预算已耗尽/);
});

test('搜索服务故障降级为手动查询并保留已有来源，取消停止后续查询', async () => {
  const bridge = createPromptAgentResearchBridge({
    searchWeb: async () => { throw new Error('search offline'); }
  });
  const preview = bridge.preview(makeScope({ queries: ['q1', 'q2'] }));
  bridge.approve(preview.id);
  const result = await bridge.execute(preview.id);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.manualQueries, ['q1', 'q2']);
  assert.equal(result.errors.length, 2);

  const emptySearch = createPromptAgentResearchBridge({ searchWeb: async () => ({ results: [] }) });
  const emptyPreview = emptySearch.preview(makeScope());
  emptySearch.approve(emptyPreview.id);
  const emptyResult = await emptySearch.execute(emptyPreview.id);
  assert.equal(emptyResult.status, 'failed');
  assert.equal(emptyResult.incomplete, true);
  assert.deepEqual(emptyResult.manualQueries, ['prompt writing guide']);

  const controller = new AbortController();
  let calls = 0;
  const cancellable = createPromptAgentResearchBridge({
    searchWeb: async () => {
      calls += 1;
      controller.abort();
      return { results: [{ title: 'partial', url: 'https://example.com/partial', summary: '保留来源' }] };
    }
  });
  const cancelledPreview = cancellable.preview(makeScope({ queries: ['q1', 'q2'] }));
  cancellable.approve(cancelledPreview.id);
  const cancelled = await cancellable.execute(cancelledPreview.id, { signal: controller.signal });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(calls, 1);
  assert.equal(cancelled.results[0].title, 'partial');
});

test('coordinator 只向桥接传研究范围白名单字段，执行前必须先批准预览', async () => {
  const coordinator = createPromptAgentCoordinator({
    schema, workflow, prompts,
    getState: () => ({}),
    searchWeb: async query => ({ results: [{ title: '结果', url: `https://example.com/${query}`, summary: '摘要' }] })
  });
  const task = schema.createPromptAgentTask({
    id: 'sensitive-task', goal: '分析文章语气', currentState: '用户粘贴的完整文章正文不能发送'
  });
  const preview = coordinator.previewExternalResearch({
    objective: '查找写作指导', queries: ['writing style guide'], sourceTypes: ['web'],
    article: '用户粘贴的完整文章正文不能发送', chatHistory: ['私人对话不能发送'], taskId: task.id
  });
  assert.equal(JSON.stringify(preview).includes('完整文章正文'), false);
  await assert.rejects(() => coordinator.runExternalResearch(preview.id), /必须先确认/);
  coordinator.approveExternalResearch(preview.id);
  const result = await coordinator.runExternalResearch(preview.id);

  assert.equal(result.status, 'complete');
  assert.equal(JSON.stringify(result).includes('完整文章正文'), false);
});

test('PPT brief 到逐页稿、路线提示词和存储恢复形成端到端闭环', async () => {
  const modelStages = [];
  const coordinator = createPptSceneCoordinator({
    promptAgentCoordinator: {
      selectMaterials: async () => [{
        id: 'public-guide', title: '公开指南', summary: '仅供参考', verificationStatus: 'unverified'
      }]
    },
    requestModel: async request => {
      modelStages.push(request.stage);
      if (request.stage === 'brief') return { brief: { audience: '业务负责人', audienceAction: '批准试点', preserveItems: ['样本数据'] } };
      if (request.stage === 'outline') return { outline: {
        title: '试点方案', storyLine: '问题、证据、行动',
        slides: [{ id: 'outline-1', page: 1, title: '先做小范围验证', claim: '验证成本可控', purpose: '提出建议' }]
      } };
      if (request.stage === 'slides') return { draft: { title: '试点方案', slides: [{
        id: 'slide-1', page: 1, title: '先做小范围验证', claim: '验证成本可控',
        body: ['保留样本数据'], visualDescription: '展示样本和验证步骤', speakerNotes: '补充口头说明'
      }] } };
      throw new Error(`不应调用的阶段：${request.stage}`);
    }
  });
  let task = coordinator.createTask({
    id: 'ppt-e2e', goal: '为试点申请资源',
    pptScene: { brief: { audience: '业务负责人', preserveItems: ['样本数据'] } }
  });
  task = (await coordinator.generateBrief(task)).task;
  task = (await coordinator.gatherMaterials(task)).task;
  task = coordinator.chooseRoute(task, 'native-ppt');
  task = (await coordinator.generateOutline(task)).task;
  task = coordinator.approveOutline(task);
  task = (await coordinator.generateSlides(task)).task;

  assert.deepEqual(modelStages, ['brief', 'outline', 'slides']);
  assert.equal(task.pptScene.brief.preserveItems[0], '样本数据');
  assert.equal(task.pptScene.sources[0].verificationStatus, 'unverified');
  assert.equal(task.pptScene.route.selected, 'native-ppt');
  assert.equal(task.pptScene.outline.slides.length, 1);
  assert.equal(task.pptScene.outline.slides[0].evidenceStatus, 'needs-verification');
  assert.equal(task.pptScene.draft.slides[0].speakerNotes, '补充口头说明');
  const routePrompt = coordinator.getStagePrompt(task);
  assert.match(routePrompt, /native-ppt/);
  assert.match(routePrompt, /保留及待修改页面/);
  assert.match(routePrompt, /不代做最终文件/);
  assert.doesNotMatch(routePrompt, /speakerNotes|口头说明/);
  assert.doesNotMatch(routePrompt, /writeFile|pptxgen/i);

  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  saveState(storage, { ...createEmptyState(), promptAgentTasks: [task] });
  const restored = loadState(storage).state.promptAgentTasks[0];
  assert.equal(restored.pptScene.brief.idea, '为试点申请资源');
  assert.equal(restored.pptScene.route.selected, 'native-ppt');
  assert.equal(restored.pptScene.outline.slides[0].title, '先做小范围验证');
  assert.equal(restored.pptScene.sources[0].verificationStatus, 'unverified');
  assert.equal(restored.pptScene.draft.slides[0].body[0], '保留样本数据');
  assert.equal((restored.cases || []).length, 0, '未确认的 PPT 复盘不得自动进入案例库');
});

test('PPT 扩展搜索预算须确认，模型失败时原有逐页草稿可恢复', async () => {
  const researchBridge = createPromptAgentResearchBridge();
  const coordinator = createPptSceneCoordinator({
    researchBridge,
    requestModel: async ({ stage }) => {
      if (stage === 'slides') throw new Error('model offline');
      return { outline: { slides: [{ id: 'outline-1', page: 1, title: '待验证页面' }] } };
    }
  });
  let task = coordinator.createTask({ id: 'ppt-failure', goal: '准备汇报' });
  const preview = coordinator.previewResearch(task, makeScope({
    queries: ['q1', 'q2', 'q3', 'q4'],
    budget: { maxQueries: 4, maxSources: 8 }
  }));
  assert.equal(preview.requiresBudgetConfirmation, true);
  assert.throws(() => coordinator.approveResearch(task, preview.id), /需确认/);
  coordinator.approveResearch(task, preview.id, {
    confirmBudget: true, budget: { maxQueries: 4, maxSources: 8 }
  });

  task = (await coordinator.generateOutline(task)).task;
  task = coordinator.approveOutline(task);
  task = { ...task, pptScene: {
    ...task.pptScene,
    draft: { title: '已有草稿', slides: [{ id: 'saved-slide', page: 1, title: '不要丢失' }] }
  } };
  const failed = await coordinator.generateSlides(task);
  assert.equal(failed.error.code, 'model_failure');
  assert.equal(failed.task.pptScene.draft.slides[0].title, '不要丢失');

  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  saveState(storage, { ...createEmptyState(), promptAgentTasks: [failed.task] });
  const restored = loadState(storage).state.promptAgentTasks[0];
  assert.equal(restored.pptScene.draft.title, '已有草稿');
  assert.equal(restored.pptScene.draft.slides[0].title, '不要丢失');
});
