const assert = require('node:assert/strict');
const test = require('node:test');

const {
  estimateTokenCount,
  detectSensitiveContent,
  buildSendReport
} = require('../prototype/send-safety');

test('安全预览模块导出稳定的基础 API', () => {
  assert.equal(typeof estimateTokenCount, 'function');
  assert.equal(typeof detectSensitiveContent, 'function');
  assert.equal(typeof buildSendReport, 'function');
  assert.ok(estimateTokenCount('提示词') >= 1);
});

test('检测常见高风险凭证并保留来源和位置', () => {
  const text = [
    'api_key=sk-test-1234567890',
    'password: very-secret-value',
    'Authorization: Bearer abcdefghijklmnop',
    '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    'postgres://user:pass@example.com:5432/app'
  ].join('\n');
  const findings = detectSensitiveContent(text, { source: '基础提示词' });
  const kinds = new Set(findings.map(item => item.kind));
  for (const kind of ['apiKey', 'password', 'authorization', 'privateKey', 'databaseConnection']) {
    assert.ok(kinds.has(kind), `缺少 ${kind} 检测`);
  }
  assert.ok(findings.every(item => item.source === '基础提示词'));
  assert.ok(findings.every(item => Number.isInteger(item.start) && item.end > item.start));
  assert.ok(findings.some(item => item.severity === 'high'));
});

test('检测手机号、邮箱和身份证号，但不把普通 token/secret 单词误报为凭证', () => {
  const text = '联系 13800138000 或 test@example.com，身份证 11010519491231002X；token 和 secret 只是普通说明。';
  const findings = detectSensitiveContent(text, { source: '用户原文/当前编辑文本' });
  const kinds = findings.map(item => item.kind);
  assert.ok(kinds.includes('phone'));
  assert.ok(kinds.includes('email'));
  assert.ok(kinds.includes('idCard'));
  assert.equal(kinds.includes('token'), false);
  assert.equal(kinds.includes('secret'), false);
});

test('buildSendReport 保留分段原文并汇总统计与确认状态', () => {
  const segments = [
    { source: '基础提示词', text: '请分析问题。' },
    { source: '用户原文/当前编辑文本', text: '邮箱 test@example.com' },
    { source: '公开资料', text: '公开摘要' }
  ];
  const report = buildSendReport(segments);
  assert.equal(report.text, segments.map(item => item.text).join(''));
  assert.equal(report.segments.length, 3);
  assert.equal(report.characters, report.text.length);
  assert.equal(report.tokenCount, estimateTokenCount(report.text));
  assert.equal(report.highRiskCount, 0);
  assert.equal(report.requiresConfirmation, false);
  assert.equal(report.segments[1].findings[0].source, '用户原文/当前编辑文本');
  assert.equal(report.segments[0].text, segments[0].text);
});

test('高风险内容要求确认，且不修改原文', () => {
  const text = 'password=do-not-change';
  const report = buildSendReport([{ source: '本地资料', text }]);
  assert.equal(report.text, text);
  assert.equal(report.requiresConfirmation, true);
  assert.ok(report.highRiskCount >= 1);
  assert.equal(report.segments[0].text, text);
});
