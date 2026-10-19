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
  assert.throws(() => workflow.requestExternalResearch(task, { objective: '再次搜索' }), /已拒绝联网/);
  assert.throws(() => workflow.approveExternalResearch(task), /等待联网确认/);
  const restored = workflow.createPromptAgentFlow(normalizePromptAgentTask(task));
  assert.throws(() => workflow.requestExternalResearch(restored, { objective: '恢复后再次搜索' }), /已拒绝联网/);
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
