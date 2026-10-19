const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPromptAgentTask,
  normalizePromptAgentTask,
  normalizePromptAgentStep,
  sanitizePromptAgentState
} = require('../prototype/prompt-agent-schema.js');

test('任务摘要规范三类输入、事实分类、最多三次追问和复盘标签', () => {
  const task = createPromptAgentTask({
    type: 'diagnose-ai-result',
    goal: '检查外部 AI 是否满足要求',
    facts: ['用户提供了结果'],
    assumptions: ['结果用于公开发布'],
    missingInfo: ['目标读者尚未确认'],
    clarificationCount: 8,
    review: { label: '待验证', evidence: ['缺少读者反馈'] },
    originalArticle: '这篇很长的外部原文不应进入摘要'.repeat(1000)
  });

  assert.equal(task.type, 'diagnose-ai-result');
  assert.deepEqual(task.facts, ['用户提供了结果']);
  assert.deepEqual(task.assumptions, ['结果用于公开发布']);
  assert.deepEqual(task.missingInfo, ['目标读者尚未确认']);
  assert.equal(task.clarificationCount, 3);
  assert.equal(task.review.label, '待验证');
  assert.equal(JSON.stringify(task).includes('外部原文不应进入摘要'), false);
  assert.equal(createPromptAgentTask({ type: 'advance-idea' }).type, 'advance-idea');
  assert.equal(createPromptAgentTask({ type: 'optimize-prompt' }).type, 'optimize-prompt');
  assert.throws(() => createPromptAgentTask({ type: 'execute-task' }), /类型/);
  assert.throws(() => createPromptAgentTask({ goal: 'x', apiKey: 'secret' }), /敏感/);
});

test('路线步骤可编辑，当前步骤及研究预算按白名单规范化', () => {
  const step = normalizePromptAgentStep({
    id: 'step-1', title: '先梳理目标', description: '编辑后的说明',
    deliverable: '目标摘要', status: 'current', shellCommand: 'rm -rf /'
  });
  const task = normalizePromptAgentTask({
    type: 'advance-idea', goal: '推进想法', steps: [step], currentStepId: 'step-1',
    researchBudget: { maxQueries: 5, maxSources: 9, usedQueries: 2 }
  });

  assert.equal(task.steps[0].description, '编辑后的说明');
  assert.equal(task.currentStepId, 'step-1');
  assert.equal(task.researchBudget.maxQueries, 3);
  assert.equal(task.researchBudget.maxSources, 5);
  assert.equal(Object.hasOwn(task.steps[0], 'shellCommand'), false);
  assert.throws(() => normalizePromptAgentTask({ researchBudget: { apiToken: 'secret' } }), /敏感/);
});

test('复盘标签只允许成功、失败或待验证', () => {
  for (const label of ['成功', '失败', '待验证']) {
    assert.equal(normalizePromptAgentTask({ review: { label } }).review.label, label);
  }
  assert.equal(normalizePromptAgentTask({ review: { label: '自动保存' } }).review.label, '待验证');
});

test('联网决定和澄清问答按白名单、长度及数量限制规范化', () => {
  const task = normalizePromptAgentTask({
    researchDecision: 'rejected',
    clarifications: [
      { question: '  问题  ', answer: ' 答复 ' },
      ...Array.from({ length: 4 }, (_, index) => ({ question: `问题${index}`, answer: '答复' }))
    ]
  });

  assert.equal(task.researchDecision, 'rejected');
  assert.equal(task.clarifications.length, 3);
  assert.deepEqual(task.clarifications[0], { question: '问题', answer: '答复' });
  assert.equal(task.clarifications[0].question.length, 2);
  assert.equal(normalizePromptAgentTask({ researchDecision: 'invalid' }).researchDecision, 'none');
  const legacy = normalizePromptAgentTask({ assumptions: ['用户已拒绝本任务联网研究', '真实假设'] });
  assert.equal(legacy.researchDecision, 'rejected');
  assert.deepEqual(legacy.assumptions, ['真实假设']);
});

test('Agent 状态只保留白名单摘要和授权来源元数据', () => {
  const state = sanitizePromptAgentState({
    promptAgentTasks: [{ id: 'task-1', type: 'advance-idea', goal: '目标' }],
    promptAgentSources: [{ id: 'source-1', label: '工作资料', permission: 'read', enabled: true,
      absolutePath: 'C:/private', indexContent: '索引全文', accessToken: 'secret' }],
    promptAgentIndex: [{ content: '不进入持久状态' }]
  });

  assert.equal(state.promptAgentTasks[0].goal, '目标');
  assert.deepEqual(state.promptAgentSources, [{ id: 'source-1', label: '工作资料', permission: 'read', enabled: true }]);
  assert.equal(Object.hasOwn(state, 'promptAgentIndex'), false);
});
