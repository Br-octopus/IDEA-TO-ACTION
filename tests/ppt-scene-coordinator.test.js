const test = require('node:test');
const assert = require('node:assert/strict');
const { createPptSceneCoordinator } = require('../prototype/ppt-scene-coordinator.js');
const { createPromptAgentResearchBridge } = require('../prototype/prompt-agent-research-bridge.js');
const { createPromptAgentCoordinator } = require('../prototype/prompt-agent-coordinator.js');
const promptAgentSchema = require('../prototype/prompt-agent-schema.js');
const promptAgentWorkflow = require('../prototype/prompt-agent-workflow.js');
const promptAgentPrompts = require('../prototype/prompt-agent-prompts.js');

function fixture(overrides = {}) {
  const calls = { model: [], materialStages: [], retrieval: [], research: [] };
  const bridge = {
    approved: new Set(),
    preview(scope) {
      calls.research.push(['preview', scope]);
      return { id: 'research-1', status: 'awaiting-confirmation', objective: scope.objective };
    },
    approve(id, confirmation) {
      calls.research.push(['approve', id, confirmation]);
      this.approved.add(id);
      return { id, status: 'approved' };
    },
    reject(id) { calls.research.push(['reject', id]); return { id, status: 'rejected' }; },
    async execute(id) {
      calls.research.push(['execute', id]);
      if (!this.approved.has(id)) throw new Error('研究计划必须先确认');
      return { status: 'complete', results: [{ id: 'provider-id-is-ignored', title: '官方流程指南', url: 'https://example.test/guide', summary: '说明新流程的分流步骤。', date: '2026-10-20' }], errors: [], usedQueries: 1, usedSources: 1 };
    }
  };
  const responses = {
    brief: JSON.stringify({ idea: '说明客服分流流程', audience: '一线客服', audienceAction: '按新流程分流', facts: ['新流程下周启用'], assumptions: ['听众熟悉旧流程'], hardRequirements: ['解释升级条件'], preferences: ['少用术语'], constraints: { minSlides: 2, maxSlides: 4 } }),
    outline: JSON.stringify({ title: '从识别到升级', storyLine: '先识别紧急度，再完成分流，最后说明升级条件。', rationale: '两页可覆盖判断与执行。', slides: [{ id: 'o1', page: 1, purpose: '建立判断标准', title: '先判断紧急程度', claim: '按紧急程度分流', sourceIds: ['web:example.test/guide'], transition: '转入执行步骤' }, { id: 'o2', page: 2, purpose: '说明后续动作', title: '按规则完成升级', claim: '不确定时升级处理', sourceIds: [], transition: '结束' }] }),
    'outline-review': JSON.stringify({ summary: '故事线完整，第二页的升级依据需要补证。', issues: ['第 2 页缺少来源引用。'] }),
    slides: JSON.stringify({ title: '客服分流', slides: [{ id: 's1', page: 1, purpose: '建立判断标准', title: '先判断紧急程度', body: ['先收集关键信息'], visualDescription: '用三级流程图呈现', sourceIds: ['web:example.test/guide'] }, { id: 's2', page: 2, purpose: '说明后续动作', title: '按规则完成升级', body: ['无法判断时转人工'], visualDescription: '突出升级入口', sourceIds: [] }] })
  };
  const promptAgentCoordinator = {
    async selectMaterials(task, options) {
      calls.materialStages.push(options.stage);
      return [{ id: 'local:guide', title: '客服操作手册', location: 'guide.md', excerpt: '分流步骤说明', verificationStatus: 'user-confirmed' }];
    }
  };
  const retriever = {
    async searchPromptAgentMaterials(entries, query) {
      calls.retrieval.push(query);
      return entries.slice(0, 1);
    }
  };
  const coordinator = createPptSceneCoordinator({
    promptAgentCoordinator,
    retriever,
    researchBridge: bridge,
    requestModel: async request => {
      calls.model.push(request);
      const stage = request.stage;
      if (overrides.failStage === stage) throw new Error('模型暂不可用');
      return responses[stage] || '{}';
    },
    ...overrides.dependencies
  });
  return { calls, bridge, coordinator };
}

test('完整规划链路复用 Agent 资料与研究授权，并让页面主张关联来源 ID', async () => {
  const { calls, coordinator } = fixture();
  let task = coordinator.createTask({ id: 'ppt-task', goal: '为客服团队说明新的分流流程' });
  task = (await coordinator.generateBrief(task)).task;
  task = (await coordinator.gatherMaterials(task)).task;
  assert.deepEqual(calls.materialStages, ['planning']);
  assert.equal(task.pptScene.sources[0].id, 'local:guide');

  const scope = { objective: '核对新客服分流流程', queries: ['客服分流流程'], sourceTypes: ['web'], platforms: [], budget: { maxQueries: 1, maxSources: 3 } };
  const preview = coordinator.previewResearch(task, scope);
  assert.equal(preview.status, 'awaiting-confirmation');
  assert.deepEqual(calls.research.map(call => call[0]), ['preview']);
  await assert.rejects(() => coordinator.runResearch(task, preview.id), /确认/);
  coordinator.approveResearch(task, preview.id);
  task = (await coordinator.runResearch(task, preview.id)).task;
  assert.deepEqual(calls.research.map(call => call[0]), ['preview', 'approve', 'execute']);
  assert.ok(task.pptScene.sources.some(source => source.id === 'web:example.test/guide'));

  task = (await coordinator.generateOutline(task)).task;
  assert.equal(task.pptScene.outline.storyLine.includes('分流'), true);
  assert.equal(task.pptScene.outline.slides[0].evidenceStatus, 'cited');
  assert.equal(task.pptScene.outline.slides[1].evidenceStatus, 'needs-verification');
  assert.deepEqual(task.pptScene.outline.slides[1].suggestedSourceIds, ['web:example.test/guide']);
  assert.ok(calls.retrieval.some(query => query.includes('不确定时升级处理')));

  task = (await coordinator.reviewOutline(task)).task;
  assert.match(task.pptScene.outline.reviewSummary, /故事线完整/);
  task = coordinator.approveOutline(task);
  assert.equal(task.pptScene.outlineStatus, 'approved');
  task = (await coordinator.generateSlides(task)).task;
  assert.equal(task.pptScene.draft.slides.length, 2);
  assert.equal(task.pptScene.draft.slides[1].evidenceStatus, 'needs-verification');
  assert.equal(coordinator.getStagePrompt(task, 'route-prompt').includes('本工具只提供建议和提示词'), true);
  assert.deepEqual(calls.model.map(request => request.stage), ['brief', 'outline', 'outline-review', 'slides']);
});

test('模型失败保留已保存的简报、大纲与逐页稿', async () => {
  const { coordinator } = fixture({ failStage: 'slides' });
  const task = coordinator.createTask({
    id: 'existing-ppt', goal: '已有计划',
    pptScene: {
      brief: { idea: '已有简报' }, status: 'ready', stage: 'slides',
      outline: { title: '已有大纲', storyLine: '已有故事线', slides: [{ id: 'o1', page: 1, title: '已有页' }] },
      draft: { title: '已有逐页稿', slides: [{ id: 's1', page: 1, title: '保留这页', body: ['现有文案'] }] }
    }
  });
  const result = await coordinator.generateSlides(task);

  assert.equal(result.error.code, 'model_failure');
  assert.equal(result.task.pptScene.brief.idea, '已有简报');
  assert.equal(result.task.pptScene.outline.title, '已有大纲');
  assert.equal(result.task.pptScene.draft.slides[0].title, '保留这页');
});

test('切换路线只失效路线提示词，保留简报、大纲和逐页稿', () => {
  const { coordinator } = fixture();
  const task = coordinator.createTask({
    id: 'route-task', goal: '展示客服流程',
    pptScene: {
      brief: { idea: '展示客服流程' }, status: 'ready', stage: 'route-prompt',
      outline: { title: '流程大纲', storyLine: '先判断再执行', slides: [{ id: 'o1', page: 1, title: '判断' }] },
      draft: { title: '流程稿', slides: [{ id: 's1', page: 1, title: '判断紧急度' }] }
    }
  });
  const next = coordinator.chooseRoute(task, 'html-final');

  assert.equal(next.pptScene.brief.route, 'html-final');
  assert.equal(next.pptScene.route.selected, 'html-final');
  assert.equal(next.pptScene.outline.title, '流程大纲');
  assert.equal(next.pptScene.draft.title, '流程稿');
  assert.equal(next.pptScene.stage, 'route-prompt');
  assert.match(coordinator.getStagePrompt(next, 'route-prompt'), /html-final/);
});

test('删除页面必须保留原因，且删除页不会进入路线提示词', () => {
  const { coordinator } = fixture();
  const task = coordinator.createTask({ id: 'page-task', goal: '客服流程' });
  task.pptScene.draft = { title: '流程稿', slides: [{ id: 's1', page: 1, title: '不适用步骤', body: ['旧规则'], visualDescription: '流程图' }] };

  assert.throws(() => coordinator.setSlideDisposition(task, 's1', 'deleted', ''), /原因/);
  const next = coordinator.setSlideDisposition(task, 's1', 'deleted', '该步骤已被新制度取代');
  assert.equal(next.pptScene.draft.slides[0].disposition, 'deleted');
  assert.equal(next.pptScene.draft.slides[0].deleteReason, '该步骤已被新制度取代');
  assert.doesNotMatch(coordinator.getStagePrompt(next, 'route-prompt'), /不适用步骤/);
});

test('真实确认式网页研究为无 id 搜索结果生成稳定来源 ID 并可供大纲引用', async () => {
  const bridge = createPromptAgentResearchBridge({
    searchWeb: async () => ({ results: [{
      title: '分流规则指南', url: 'https://Example.test/guide/?campaign=weekly#overview', summary: '说明客服升级步骤。'
    }] })
  });
  const promptAgentCoordinator = createPromptAgentCoordinator({
    schema: promptAgentSchema,
    workflow: promptAgentWorkflow,
    prompts: promptAgentPrompts,
    researchBridge: bridge,
    getState: () => ({}),
    requestModel: async () => '{}'
  });
  const pptCoordinator = createPptSceneCoordinator({
    promptAgentCoordinator,
    requestModel: async ({ stage }) => stage === 'outline' ? JSON.stringify({
      title: '客服分流', storyLine: '按规则识别并升级',
      slides: [{ id: 'o1', page: 1, title: '按规则升级', claim: '按分流规则完成升级', sourceIds: ['web:example.test/guide'] }]
    }) : '{}'
  });
  const task = pptCoordinator.createTask({ id: 'real-bridge-ppt', goal: '说明客服分流规则' });
  const preview = pptCoordinator.previewResearch(task, {
    objective: '核对客服分流规则', queries: ['客服分流规则'], sourceTypes: ['web'], platforms: []
  });
  assert.equal(preview.status, 'awaiting-confirmation');
  pptCoordinator.approveResearch(task, preview.id);
  const researched = await pptCoordinator.runResearch(task, preview.id);

  assert.equal(researched.error, undefined);
  assert.equal(researched.task.pptScene.sources[0].id, 'web:example.test/guide');
  assert.match(researched.task.pptScene.brief.sourceIds[0], /^web:.+/);
  const outlined = await pptCoordinator.generateOutline(researched.task);
  assert.equal(outlined.task.pptScene.outline.slides[0].evidenceStatus, 'cited');
  assert.deepEqual(outlined.task.pptScene.outline.slides[0].sourceIds, ['web:example.test/guide']);
});
