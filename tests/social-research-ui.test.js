const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ui = require('../prototype/social-research-ui.js');

const root = path.resolve(__dirname, '..');

test('研究页包含工作流、平台准备、结果和报告入口及明确的只读提示', () => {
  const html = fs.readFileSync(path.join(root, 'prototype/index.html'), 'utf8');
  for (const id of [
    'social-research-entry', 'social-research-template', 'social-research-platforms',
    'social-research-plan', 'social-research-plan-confirm', 'social-platform-preparation',
    'social-research-status', 'social-research-results', 'social-research-report',
    'social-research-save-selection'
  ]) assert.ok(html.includes(`id="${id}"`), `缺少研究 UI 入口 ${id}`);
  for (const copy of ['API', '真实浏览器', '自动回退', '独立 profile', '只读', '登录状态', '未核验', '不会自动发布']) {
    assert.ok(html.includes(copy), `缺少边界说明：${copy}`);
  }
  const schema = html.indexOf('src="/prototype/social-research-schema.js"');
  const workflow = html.indexOf('src="/prototype/social-research-workflow.js"');
  const uiScript = html.indexOf('src="/prototype/social-research-ui.js"');
  const app = html.indexOf('src="/prototype/app.js"');
  assert.ok(schema >= 0 && schema < workflow && workflow < uiScript && uiScript < app, '研究模块必须按 schema、workflow、UI、app 顺序加载');
});

test('结果筛选覆盖平台、查询、日期、证据和保存状态', () => {
  const results = [
    { id: 'a', platform: 'reddit', searchQueries: ['账本'], publishedAt: '2026-10-01', evidenceStatus: 'unverified' },
    { id: 'b', platform: 'youtube', searchQueries: ['预算'], publishedAt: '2026-10-19', evidenceStatus: 'source-reviewed' },
    { id: 'c', platform: 'reddit', searchQueries: ['账本'], publishedAt: '', evidenceStatus: 'unverified' }
  ];
  assert.deepEqual(ui.filterResearchResults(results, { platform: 'reddit', query: '账本', from: '2026-10-02', saved: 'unsaved' }, ['b']).map(item => item.id), ['c']);
  assert.deepEqual(ui.filterResearchResults(results, { evidence: 'source-reviewed', saved: 'saved' }, ['b']).map(item => item.id), ['b']);
});

test('UI 调用与 preload 一致的平台 API 签名，并把计划生命周期交给 coordinator', () => {
  const source = fs.readFileSync(path.join(root, 'prototype/social-research-ui.js'), 'utf8');
  for (const signature of [
    'desktopApi.social.listPlatforms()',
    'desktopApi.social.getStatus(platform)',
    'desktopApi.social.openLogin(platform, id)',
    'desktopApi.social.check(platform, id)',
    'desktopApi.social.clearProfile(platform, id)',
    'coordinator.createPlan(', 'coordinator.confirmPlan(task.id)', 'coordinator.run(task.id, { onEvent:',
    'coordinator.cancel(task.id)', 'coordinator.saveSelected(task.id, ids)'
  ]) assert.ok(source.includes(signature), `缺少 UI 事件接线 ${signature}`);
});

test('运行控制包含暂停/继续、运行中取消和实时执行上下文', () => {
  const html = fs.readFileSync(path.join(root, 'prototype/index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'prototype/social-research-ui.js'), 'utf8');
  for (const id of ['social-research-pause', 'social-research-progress-detail']) {
    assert.ok(html.includes(`id="${id}"`), `缺少运行控制入口 ${id}`);
  }
  for (const signature of ['coordinator.pause(task.id)', 'coordinator.resume(task.id)', 'onEvent:', 'platform-start', 'query-start', 'result-count', 'platform-finish']) {
    assert.ok(source.includes(signature), `缺少实时控制或进度接线 ${signature}`);
  }
  assert.ok(source.includes('["awaiting-plan-confirmation", "awaiting-platform-preparation", "searching"]'), '运行中应允许请求取消');
});

test('报告生成期间明确说明取消边界，禁用暂停并保留取消入口', () => {
  const source = fs.readFileSync(path.join(root, 'prototype/social-research-ui.js'), 'utf8');
  assert.ok(source.includes('event.type === "report-start"'), '收到报告开始事件后应切换报告生成状态');
  assert.ok(source.includes('正在生成报告；取消将在当前模型请求完成后生效'), '报告阶段应说明取消延迟到模型请求完成');
  assert.ok(source.includes('|| reportGenerating'), '模型请求期间应禁用暂停');
  assert.ok(source.includes('coordinator.cancel(task.id)'), '报告生成期间仍通过现有入口允许取消');
});

test('partial-failure 的报告区和状态栏展示真实错误详情及错误码', () => {
  const source = fs.readFileSync(path.join(root, 'prototype/social-research-ui.js'), 'utf8');
  assert.ok(source.includes('task.reportErrorCode'), '错误码应展示在状态栏或报告区');
  assert.ok(source.includes('task.reportError'), '错误详情应展示在状态栏或报告区');
  assert.ok(source.includes('研究未完成：'), '状态栏应明确指出研究未完成');
});
