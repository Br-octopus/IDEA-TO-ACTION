const test = require('node:test');
const assert = require('node:assert/strict');
const { createPromptAgentTask } = require('../prototype/prompt-agent-schema.js');
const prompts = require('../prototype/prompt-agent-prompts.js');

const baseTask = createPromptAgentTask({
  type: 'advance-idea', goal: '推出课程', target: '职场新人', currentState: '只有初步想法',
  constraints: '两周内完成', successCriteria: ['完成试讲'], preserveItems: ['保留线上形式'],
  facts: ['已有讲师'], assumptions: ['学员可晚间参与'], missingInfo: ['预算'],
  chatHistory: ['不应发送的聊天历史']
});

test('澄清和诊断提示词包含任务摘要字段且不执行目标成果', () => {
  for (const prompt of [prompts.buildClarificationPrompt(baseTask), prompts.buildDiagnosisPrompt({
    ...baseTask, type: 'diagnose-ai-result'
  })]) {
    for (const value of ['推出课程', '职场新人', '只有初步想法', '两周内完成', '完成试讲', '保留线上形式']) {
      assert.ok(prompt.includes(value), `提示词缺少：${value}`);
    }
    assert.match(prompt, /每轮最多提出一个问题/);
    assert.match(prompt, /不得直接产出|不要直接产出/);
    assert.equal(prompt.includes('不应发送的聊天历史'), false);
  }
});

test('路线逐步包含目标、输入、产出和检查，并只引用选定证据', () => {
  const prompt = prompts.buildRoutePrompt(baseTask, [
    { id: 'ref-1', title: '相关方法', excerpt: '短摘录', selected: true },
    { id: 'ref-2', title: '未选资料', excerpt: '不应带入', selected: false }
  ]);
  for (const field of ['目标', '输入', '产出', '检查', '短摘录']) assert.ok(prompt.includes(field));
  assert.equal(prompt.includes('不应带入'), false);
  assert.match(prompt, /只规划路线/);
});

test('步骤提示词只包含当前步骤详细要求，不展开其他步骤或产出目标成果', () => {
  const prompt = prompts.buildStepPrompt({
    ...baseTask,
    steps: [
      { id: 's1', title: '访谈', goal: '了解学员', inputs: ['学员名单'], deliverable: '访谈摘要', checklist: ['覆盖三类学员'] },
      { id: 's2', title: '制作课程', goal: '编写完整课程正文' }
    ]
  }, { id: 's1', title: '访谈', goal: '了解学员', inputs: ['学员名单'], deliverable: '访谈摘要', checklist: ['覆盖三类学员'] });
  assert.match(prompt, /了解学员/);
  assert.match(prompt, /学员名单/);
  assert.equal(prompt.includes('编写完整课程正文'), false);
  assert.match(prompt, /不得直接完成目标任务/);
});

test('复盘引用具体差异，提出成功失败待验证建议和证据', () => {
  const prompt = prompts.buildResultReviewPrompt(baseTask,
    { excerpt: '结果没有安排试讲', differences: ['缺少试讲环节'] }, '请重点看可执行性');
  assert.match(prompt, /没有安排试讲/);
  assert.match(prompt, /缺少试讲环节/);
  for (const label of ['成功', '失败', '待验证', '证据']) assert.ok(prompt.includes(label));
  assert.match(prompt, /不得改写结果正文/);
});
