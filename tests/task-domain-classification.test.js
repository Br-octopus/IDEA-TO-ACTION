const assert = require('node:assert/strict');
const test = require('node:test');
const { inferTaskDomains } = require('../prototype/method-cards.js');

test('明确任务只匹配一个现有方法卡', () => {
  assert.deepEqual(inferTaskDomains('帮我润色这篇文章'), ['写作']);
  assert.deepEqual(inferTaskDomains('规划一份学习计划，准备考试'), ['学习目标']);
  assert.deepEqual(inferTaskDomains('帮我制作产品介绍 PPT'), ['PPT']);
});

test('跨领域识别只供 Agent 理解任务，不要求用户逐项选择领域', () => {
  assert.deepEqual(inferTaskDomains('把写作工作台做成一个 App'), ['写作', '软件开发']);
  assert.deepEqual(inferTaskDomains('帮我做一个产品发布汇报 PPT'), ['PPT', '产品构想']);
});

test('未识别任务保留通用计划，不强迫用户选择', () => {
  assert.deepEqual(inferTaskDomains('明年我想过得更从容'), []);
  assert.deepEqual(inferTaskDomains(''), []);
});
