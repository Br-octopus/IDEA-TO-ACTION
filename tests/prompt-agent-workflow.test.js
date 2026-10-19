const test = require('node:test');
const assert = require('node:assert/strict');
const { createPromptAgentTask, normalizePromptAgentTask } = require('../prototype/prompt-agent-schema.js');
const workflow = require('../prototype/prompt-agent-workflow.js');

test('三类入口保留任务类型并从澄清阶段开始', () => {
  for (const type of ['advance-idea', 'optimize-prompt', 'diagnose-ai-result']) {
    const task = createPromptAgentTask({ type, goal: '目标' });
    const flow = workflow.createPromptAgentFlow(task);
    assert.equal(flow.type, type);
    assert.equal(flow.status, 'clarifying');
    assert.equal(flow.stage, 'clarification');
  }
});

test('创建流程保留已有进度与研究决定，只为缺省字段补默认值', () => {
  const existing = createPromptAgentTask({
    goal: '恢复任务', status: 'ready', stage: 'draft', clarificationCount: 1,
    clarifications: [{ question: '对象？', answer: '编辑' }], researchDecision: 'approved'
  });
  const resumed = workflow.createPromptAgentFlow(existing);
  assert.equal(resumed.status, 'ready');
  assert.equal(resumed.stage, 'draft');
  assert.deepEqual(resumed.clarifications, [{ question: '对象？', answer: '编辑' }]);
  assert.equal(resumed.researchDecision, 'approved');

  const incomplete = workflow.createPromptAgentFlow({ type: 'advance-idea' });
  assert.equal(incomplete.status, 'clarifying');
  assert.equal(incomplete.stage, 'clarification');
});

test('每次只记录一个问题，最多三个关键追问，信息足够可先形成草稿', () => {
  let task = workflow.createPromptAgentFlow(createPromptAgentTask({ goal: '完成目标' }));
  task = workflow.recordClarification(task, { question: '对象是谁？', answer: '新手' });
  assert.equal(task.clarificationCount, 1);
  assert.equal(task.clarifications.length, 1);
  assert.throws(() => workflow.recordClarification(task, {
    questions: ['问题一', '问题二'], answer: '答复'
  }), /一个问题/);
  task = workflow.recordClarification(task, { question: '限制是什么？', answer: '时间有限' });
  task = workflow.recordClarification(task, { question: '如何验收？', answer: '可以复现' });
  assert.throws(() => workflow.recordClarification(task, { question: '更多？', answer: '否' }), /最多三个/);
  const drafted = workflow.setTaskDraft(task, { summary: '目标和对象已明确', route: ['先验证'] });
  assert.equal(drafted.status, 'ready');
  assert.deepEqual(drafted.assumptions, []);
});

test('非阻断缺口作为假设保留，拒绝联网后不能再次申请搜索', () => {
  let task = workflow.createPromptAgentFlow(createPromptAgentTask({
    goal: '评估方案', missingInfo: ['具体发布日期']
  }));
  task = workflow.setTaskDraft(task, {
    summary: '可以先评估', nonBlockingGaps: ['具体发布日期']
  });
  assert.deepEqual(task.assumptions, ['具体发布日期']);
  task = workflow.requestExternalResearch(task, { objective: '核对现行标准' });
  assert.equal(task.status, 'awaiting-research-approval');
  task = workflow.rejectExternalResearch(task);
  assert.equal(task.researchDecision, 'rejected');
  assert.equal(task.assumptions.includes('用户已拒绝本任务联网研究'), false);
  assert.throws(() => workflow.requestExternalResearch(task, { objective: '再次搜索' }), /已拒绝联网/);
  assert.throws(() => workflow.approveExternalResearch(task), /等待联网确认/);
  const restored = workflow.createPromptAgentFlow(normalizePromptAgentTask(task));
  assert.throws(() => workflow.requestExternalResearch(restored, { objective: '恢复后再次搜索' }), /已拒绝联网/);
});

test('规范化恢复后保留澄清问答和拒绝联网决定', () => {
  let task = workflow.createPromptAgentFlow(createPromptAgentTask({ goal: '目标' }));
  task = workflow.recordClarification(task, { question: '面向谁？', answer: '新手' });
  task = workflow.requestExternalResearch(task, { objective: '查询资料' });
  task = workflow.rejectExternalResearch(task);
  const restored = workflow.createPromptAgentFlow(normalizePromptAgentTask(task));

  assert.deepEqual(restored.clarifications, [{ question: '面向谁？', answer: '新手' }]);
  assert.equal(restored.researchDecision, 'rejected');
  assert.deepEqual(restored.assumptions, []);
  assert.throws(() => workflow.requestExternalResearch(restored, { objective: '再次查询' }), /已拒绝联网/);
});

test('批准联网只在待确认状态有效，路线只允许选择现有步骤', () => {
  let task = workflow.createPromptAgentFlow(createPromptAgentTask({
    goal: '推进项目', steps: [{ id: 's1', title: '验证', goal: '验证假设' }]
  }));
  assert.throws(() => workflow.approveExternalResearch(task), /等待联网确认/);
  task = workflow.setTaskDraft(task, { summary: '目标明确' });
  task = workflow.selectPromptStep(task, 's1');
  assert.equal(task.currentStepId, 's1');
  assert.throws(() => workflow.selectPromptStep(task, 'missing'), /不存在/);
  task = workflow.requestExternalResearch(task, { objective: '查资料' });
  task = workflow.approveExternalResearch(task);
  assert.equal(task.researchDecision, 'approved');
  assert.throws(() => workflow.transitionPromptAgentTask(task, { type: 'finish' }), /不允许/);
});

test('联网确认预览固定查询、来源类型、平台和默认预算，超限需单独确认预算', () => {
  const base = workflow.createPromptAgentFlow(createPromptAgentTask({ goal: '评估工具' }));
  const pending = workflow.requestExternalResearch(base, {
    objective: '比较隐私友好的笔记工具',
    queries: ['隐私笔记工具', '本地笔记同步', '端到端加密笔记'],
    sourceTypes: ['官方文档', '评测'],
    platforms: ['web']
  });
  assert.equal(pending.status, 'awaiting-research-approval');
  assert.deepEqual(pending.researchScope.budget, { maxQueries: 3, maxSources: 5 });
  assert.equal(pending.researchScope.queries.length, 3);
  assert.equal(pending.researchScope.platforms[0], 'web');

  const overBudget = workflow.requestExternalResearch(base, {
    objective: '扩展比较', queries: ['q1', 'q2', 'q3', 'q4'],
    platforms: ['web'], budget: { maxQueries: 4, maxSources: 7 }
  });
  assert.equal(overBudget.status, 'awaiting-research-budget-approval');
  assert.equal(overBudget.researchScope.budget.requiresConfirmation, true);
  assert.throws(() => workflow.approveExternalResearch(overBudget), /预算/);
  const budgetConfirmed = workflow.approveExternalResearchBudget(overBudget);
  assert.equal(budgetConfirmed.status, 'awaiting-research-approval');
  assert.equal(budgetConfirmed.researchScope.budget.maxQueries, 4);
  assert.equal(workflow.approveExternalResearch(budgetConfirmed).researchDecision, 'approved');
});

test('联网范围只保留白名单摘要字段，不持久化文章原文或聊天记录', () => {
  const base = workflow.createPromptAgentFlow(createPromptAgentTask({ goal: '核实说法' }));
  const pending = workflow.requestExternalResearch(base, {
    objective: '核实说法', queries: ['核实说法 官方来源'], platforms: ['web'],
    sourceTypes: ['官方文档'], pastedArticle: '用户粘贴的完整文章',
    chatHistory: ['完整对话'], arbitraryInput: '不可透传'
  });
  const normalized = normalizePromptAgentTask(pending);
  assert.equal(normalized.researchScope.pastedArticle, undefined);
  assert.equal(normalized.researchScope.chatHistory, undefined);
  assert.equal(normalized.researchScope.arbitraryInput, undefined);
  assert.deepEqual(normalized.researchScope.queries, ['核实说法 官方来源']);
});
