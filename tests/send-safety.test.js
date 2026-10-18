const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createSendPanelVm({ includeSafety = true } = {}) {
  const listeners = new Map();
  const elements = new Map();
  const checkbox = {
    checked: false,
    disabled: false
  };
  const makeElement = id => ({
    id,
    value: id === 'idea' ? '测试发送安全' : '',
    checked: false,
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, callback) { listeners.set(`${id}:${type}`, callback); },
    querySelector(selector) { return id === 'send-preview-confirmation' && selector === 'input' ? checkbox : null; },
    querySelectorAll() { return []; },
    append() {},
    remove() {},
    reset() {},
    focus() {},
    scrollIntoView() {},
    click() {},
    select() {}
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    createElement() { return makeElement('created'); },
    body: { append() {} },
    execCommand() { return true; }
  };
  const state = {
    projects: [],
    prompts: [],
    cases: [],
    references: [],
    knowledgeEntries: [],
    knowledgeSelection: [],
    researchSelection: []
  };
  let requestModelCalls = 0;
  const requestModelPrompts = [];
  let configCalls = 0;
  const promptEngine = {
    buildGoalPrompt() { return 'password=secret-value'; },
    buildStagePrompt() { return ''; },
    buildFollowupPrompt() { return ''; },
    buildArticleDiagnosticPrompt() { return ''; },
    buildPromptOptimizationPrompt() { return ''; },
    buildCaseReviewPrompt() { return ''; },
    appendKnowledgeContext(prompt) { return String(prompt); }
  };
  const fetch = async url => {
    if (url === '/api/config') return { json: async () => ({ model: { configured: true, name: '测试模型' }, search: { configured: false } }) };
    return { ok: true, json: async () => ({ text: '模型结果' }) };
  };
  const window = {
    ForwardStepPromptEngine: promptEngine,
    ForwardStepResearchCatalog: require('../prototype/research-catalog'),
    ForwardStepMethodCards: require('../prototype/method-cards'),
    ForwardStepKnowledgeSearch: {
      collectKnowledgeEntries() { return []; },
      searchKnowledge() { return []; }
    },
    ForwardStepStorage: {
      STORAGE_KEY: 'test',
      createEmptyState() { return state; },
      loadState() { return { state }; },
      saveState() { return state; },
      addPromptVersion() {},
      confirmCase() {},
      updateCase() {},
      upsertKnowledgeEntry() {}
    },
    ForwardStepWorkspaceBackup: {
      createBackup() { return {}; },
      getBackupSummary() { return { scope: 'workspace', counts: {} }; },
      replaceState() { return state; },
      mergeState() { return { state, added: [] }; }
    },
    desktopApi: {
      async getConfig() { configCalls += 1; return { model: { configured: true, name: '测试模型' }, search: { configured: false } }; },
      async requestModel({ messages }) {
        requestModelCalls += 1;
        requestModelPrompts.push(messages[0].content);
        return { code: 'MODEL_FAILED', message: '测试失败' };
      }
    },
    confirm() { return false; },
    scrollTo() {}
  };
  const context = {
    window,
    document,
    navigator: { clipboard: { writeText: async () => {} } },
    crypto: { randomUUID: () => 'vm-project' },
    fetch,
    setTimeout: () => 1,
    clearTimeout() {},
    Date,
    console
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'prototype', 'app.js'), 'utf8');
  const reports = [];
  if (includeSafety) {
    const safety = require('../prototype/send-safety');
    window.ForwardStepSendSafety = {
      ...safety,
      buildSendReport(segments) {
        const report = safety.buildSendReport(segments);
        reports.push(report);
        return report;
      }
    };
  }
  vm.runInNewContext(source, context, { filename: 'prototype/app.js' });
  return {
    listeners,
    checkbox,
    confirmButton: document.getElementById('send-preview-confirm'),
    text: document.getElementById('send-preview-text'),
    findings: document.getElementById('send-preview-findings'),
    model: document.getElementById('send-preview-model'),
    reports,
    async waitForConfig() {
      for (let index = 0; index < 4; index += 1) {
        await new Promise(resolve => setImmediate(resolve));
        await Promise.resolve();
      }
    },
    get configCalls() { return configCalls; },
    get requestModelCalls() { return requestModelCalls; },
    get requestModelPrompts() { return requestModelPrompts; }
  };
}

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

test('密码占位值降为一般风险，未知值保持高风险', () => {
  const findings = detectSensitiveContent([
    'password=true',
    'password=false',
    'password=example',
    'password=test',
    'password=<your-password>',
    'password=changeme',
    'password=real-unknown-value'
  ].join('\n'), { source: '文档' });
  const passwords = findings.filter(item => item.kind === 'password');
  assert.equal(passwords.length, 7);
  assert.deepEqual(passwords.slice(0, 6).map(item => item.severity), [
    'medium', 'medium', 'medium', 'medium', 'medium', 'medium'
  ]);
  assert.equal(passwords[6].severity, 'high');
});

test('检测常见前缀 API Key，并覆盖超长文本尾部敏感内容', () => {
  const text = `${'x'.repeat(200500)}\npassword=tail-secret\nsk-tail-secret-1234567890\nghp_${'a'.repeat(20)}\ngithub_pat_${'b'.repeat(20)}`;
  const report = buildSendReport([{ source: '用户原文/当前编辑文本', text }]);
  assert.ok(report.findings.some(item => item.kind === 'password' && item.fragment.includes('tail-secret')));
  assert.ok(report.findings.some(item => item.kind === 'apiKey' && item.fragment.includes('sk-tail-secret')));
  assert.ok(report.findings.some(item => item.kind === 'apiKey' && item.fragment.includes('ghp_')));
  assert.ok(report.findings.some(item => item.kind === 'apiKey' && item.fragment.includes('github_pat_')));
  assert.ok(report.requiresConfirmation);
});

test('编辑文本作为单一用户来源分段，风险归因不回指基础提示词', () => {
  const text = 'password=当前编辑值';
  const report = buildSendReport([{ source: '用户原文/当前编辑文本', text }]);
  assert.deepEqual(report.segments.map(item => item.source), ['用户原文/当前编辑文本']);
  assert.equal(report.segments[0].text, text);
  assert.equal(report.findings[0].source, '用户原文/当前编辑文本');
});

test('首尾空白不会让安全报告与实际发送文本分叉', async () => {
  const vmApp = createSendPanelVm();
  await vmApp.waitForConfig();
  vmApp.listeners.get('idea-form:submit')({ preventDefault() {} });
  vmApp.listeners.get('preview-master:click')();
  const rawText = '  \npassword=spaced-secret\n  ';
  vmApp.text.value = rawText;
  vmApp.listeners.get('send-preview-text:input')({ target: vmApp.text });
  vmApp.checkbox.checked = true;
  vmApp.listeners.get('send-preview-confirmation:change')({ target: vmApp.checkbox });
  await vmApp.listeners.get('send-preview-confirm:click')({});
  assert.equal(vmApp.requestModelCalls, 1);
  assert.equal(vmApp.requestModelPrompts[0], rawText.trim());
  assert.equal(vmApp.reports[vmApp.reports.length - 1].text, vmApp.requestModelPrompts[0]);
});

test('发送 handler 在 VM 中拒绝未确认高风险，确认后才调用模型', async () => {
  const vmApp = createSendPanelVm();
  await vmApp.waitForConfig();
  assert.equal(vmApp.configCalls, 1);
  vmApp.listeners.get('idea-form:submit')({ preventDefault() {} });
  vmApp.listeners.get('preview-master:click')();
  assert.equal(vmApp.model.textContent, '测试模型');
  assert.match(vmApp.text.value, /password=secret-value/);
  const confirm = vmApp.listeners.get('send-preview-confirm:click');
  await confirm({});
  assert.equal(vmApp.requestModelCalls, 0, '未确认高风险时不得调用模型');
  assert.equal(vmApp.confirmButton.disabled, true);

  vmApp.text.value = 'password=secret-value';
  vmApp.listeners.get('send-preview-text:input')({ target: vmApp.text });
  vmApp.checkbox.checked = true;
  vmApp.listeners.get('send-preview-confirmation:change')({ target: vmApp.checkbox });
  await confirm({});
  assert.equal(vmApp.requestModelCalls, 1, '确认高风险后允许调用模型');
  assert.deepEqual(vmApp.requestModelPrompts, ['password=secret-value'], '模型必须收到当前编辑后的发送文本');

  vmApp.text.value = 'password=another-secret';
  vmApp.listeners.get('send-preview-text:input')({ target: vmApp.text });
  await confirm({});
  assert.equal(vmApp.requestModelCalls, 1, '编辑文本后必须清除旧确认，不能直接再次发送');
  assert.equal(vmApp.text.value, 'password=another-secret');
  assert.equal(vmApp.checkbox.checked, false, '编辑文本后确认控件必须重置');
});

test('缺失安全模块时 fail-closed，脚本直接触发也不得调用模型', async () => {
  const vmApp = createSendPanelVm({ includeSafety: false });
  await vmApp.waitForConfig();
  vmApp.listeners.get('idea-form:submit')({ preventDefault() {} });
  vmApp.listeners.get('preview-master:click')();
  await vmApp.listeners.get('send-preview-confirm:click')({});
  assert.equal(vmApp.requestModelCalls, 0);
  assert.equal(vmApp.confirmButton.disabled, true);
  assert.match(vmApp.findings.innerHTML, /安全检查不可用，已阻止发送/);
});
