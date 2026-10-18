const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { startServer } = require('../server');
const {
  buildGoalPrompt,
  buildStagePrompt,
  buildCaseReviewPrompt
} = require('../prototype/prompt-engine');
const {
  appendReferenceContext,
  createSearchStub
} = require('../prototype/research-catalog');
const { createEmptyState, confirmCase } = require('../prototype/storage');

const root = path.resolve(__dirname, '..');

test('资料库页面包含搜索、筛选和新增摘要的界面骨架', () => {
  const html = fs.readFileSync(path.join(root, 'prototype', 'index.html'), 'utf8');
  for (const id of [
    'knowledge-query',
    'knowledge-type',
    'knowledge-domain',
    'knowledge-stage',
    'knowledge-search',
    'knowledge-entry-form',
    'knowledge-results',
    'knowledge-scope',
    'knowledge-export-open',
    'knowledge-import-open',
    'knowledge-bulk-actions',
    'knowledge-stats'
  ]) {
    assert.ok(html.includes('id="' + id + '"'), 'index.html 缺少 id: ' + id);
  }
  assert.ok(html.includes('资料库'), '应包含资料库入口');
  assert.ok(html.includes('从资料库移除'), '必须区分移除资料库与删除原始数据');
  assert.ok(html.includes('删除手动资料'), '批量删除必须明确限于手动资料');
  assert.ok(html.includes('最近备份'), '应显示最近备份提示');  assert.ok(html.includes('<option value="pinned">置顶</option>'), '应提供置顶筛选');
  const app = fs.readFileSync(path.join(root, 'prototype', 'app.js'), 'utf8');
  assert.ok(app.includes('data-knowledge-edit'), '手动资料应提供编辑入口');
  assert.ok(app.includes('data-knowledge-source'), '派生资料应提供编辑原始来源入口');
  assert.ok(html.includes('不要粘贴完整仓库'), '应提示不要粘贴完整仓库');
  for (const copy of [
    '本地资料库',
    '用户确认案例',
    '搜索本地资料',
    '仅摘要、可借鉴方法和来源',
    '热门或被收录不代表已验证',
    '在统一搜索结果中按类型和验证状态区分'
  ]) {
    assert.ok(html.includes(copy), '资料库页面缺少用户可见文案: ' + copy);
  }
});

test('MVP 主流程可在静态边界串联，不等同于真实 Electron UI 验收', () => {
  const project = {
    idea: '把团队周报整理成可复用的工作流程',
    goalSummary: '形成一套可检查、可交接的周报流程',
    domain: '产品与工作',
    currentState: '已有零散周报和会议记录',
    successCriteria: ['新成员能按流程完成周报', '关键事实和待办不丢失'],
    preserveItems: ['事实依据', '未完成事项', '负责人和截止时间'],
    assumptions: ['先用一周样例验证'],
    missingInfo: ['团队是否已有固定模板'],
    methodGuidance: '先确认目标、输入、限制和验收标准，再按步骤交接',
    currentStep: '确定周报字段和验收方式',
    nextAction: '列出最小字段并找一份真实样例核对'
  };

  const goalPrompt = buildGoalPrompt(project);
  assert.match(goalPrompt, /目标摘要草稿/);
  assert.match(goalPrompt, /暂时假设/);
  assert.match(goalPrompt, /遗漏、相互矛盾、可能错误/);
  assert.match(goalPrompt, /不要直接改文章、做 PPT、写代码/);

  const stagePrompt = buildStagePrompt(project, {
    title: '确定周报字段和验收方式',
    description: '把已有材料压缩成最小可执行字段',
    deliverable: '字段清单和检查方式'
  });
  assert.match(stagePrompt, /当前步骤/);
  assert.match(stagePrompt, /只生成一条我可以复制给其他 AI 的本步指令提示词/);

  const referenceSummary = appendReferenceContext(stagePrompt, [{
    title: '公开流程参考',
    url: 'https://example.com/reference',
    summary: '只借鉴字段组织方式。',
    borrowablePatterns: '先定义输入和验收，再做小样本验证。',
    fullText: '这段不应进入发送上下文的长篇原文。'
  }]);
  assert.match(referenceSummary, /公开流程参考/);
  assert.match(referenceSummary, /只借鉴字段组织方式/);
  assert.doesNotMatch(referenceSummary, /这段不应进入发送上下文的长篇原文/);

  const reviewPrompt = buildCaseReviewPrompt(project, {
    before: '周报格式不统一，待办常被遗漏。',
    externalResult: '外部 AI 给出统一模板，但删除了负责人字段。',
    userFeedback: '希望保留负责人和截止时间。',
    dimensions: ['字段完整性', '事实保留']
  });
  assert.match(reviewPrompt, /前后对照/);
  assert.match(reviewPrompt, /具体片段、变化、数据或可观察行为/);
  assert.match(reviewPrompt, /成功”“失败”或“待验证/);
  assert.match(reviewPrompt, /下一条修正提示词/);

  const caseData = {
    id: 'smoke-case-1',
    projectId: 'smoke-project-1',
    domain: project.domain,
    taskType: '流程整理',
    goal: project.goalSummary,
    preserveItems: project.preserveItems,
    before: '格式不统一',
    after: '统一模板但缺少负责人字段',
    externalResult: '统一模板但缺少负责人字段',
    userFeedback: '必须保留负责人和截止时间',
    dimensions: ['字段完整性'],
    evidence: ['模板字段列表中没有负责人'],
    suggestedLabel: '待验证',
    status: '待验证',
    lessons: '先核对保留项再确认模板',
    nextPrompt: '保留负责人和截止时间后重新生成模板建议'
  };
  assert.equal(confirmCase(createEmptyState(), caseData, false).cases.length, 0);
  assert.equal(confirmCase(createEmptyState(), caseData, true).cases.length, 1);

  const manualSearch = createSearchStub('周报字段验收方法');
  assert.equal(manualSearch.completed, false);
  assert.match(manualSearch.instruction, /手动搜索/);
});

test('入口文件和本地服务的无模型/无搜索降级可验证', async t => {
  assert.ok(fs.existsSync(path.join(root, 'prototype', 'index.html')));
  assert.ok(fs.existsSync(path.join(root, 'electron', 'main.js')));
  assert.ok(fs.existsSync(path.join(root, 'electron', 'preload.js')));

  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    config: { model: {}, search: {} }
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const pageResponse = await fetch(`${baseUrl}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /向前一步/);

  const config = await (await fetch(`${baseUrl}/api/config`)).json();
  assert.equal(config.model.configured, false);
  assert.equal(config.search.configured, false);

  const modelResponse = await fetch(`${baseUrl}/api/model`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'smoke' }] })
  });
  const model = await modelResponse.json();
  assert.equal(modelResponse.status, 200);
  assert.equal(model.code, 'MODEL_NOT_CONFIGURED');
  assert.match(model.message, /复制提示词/);

  const searchResponse = await fetch(`${baseUrl}/api/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'smoke' })
  });
  const search = await searchResponse.json();
  assert.equal(searchResponse.status, 200);
  assert.equal(search.code, 'SEARCH_NOT_CONFIGURED');
  assert.deepEqual(search.results, []);
  assert.match(search.message, /复制搜索指令/);
});


test('浏览器导入入口先确认安全备份，再打开文件选择并导入', () => {
  const app = fs.readFileSync(path.join(root, 'prototype', 'app.js'), 'utf8');
  const importStart = app.indexOf('async function importKnowledgeBackup()');
  const changeStart = app.indexOf('document.getElementById("knowledge-import-file").addEventListener');
  const importBlock = app.slice(importStart, changeStart);
  assert.ok(importBlock.indexOf('await createSafetyBackup();') < importBlock.indexOf('.click();'), '必须先完成安全备份确认再打开文件选择器');
  assert.ok(importBlock.includes('browserImportGate.confirmed = true;'), '确认成功后必须显式放行');
  assert.ok(importBlock.includes('document.getElementById("knowledge-import-file").click();'), '确认后才打开文件选择器');
  assert.ok(importBlock.indexOf('if (!desktopApi)') < importBlock.indexOf('await createSafetyBackup();'), '桌面模式不应走浏览器安全门禁');
  assert.ok(app.includes('consumeBrowserImportGate(importGate);'), 'change 和导入函数必须保留令牌防御检查');
  assert.match(app, /下载已触发，请确认你已看到并保存安全备份文件/);
  assert.match(app, /未确认已保存安全备份/);
  assert.ok(app.includes('browserImportGate = null;'), '令牌必须在 change 前后清理，防止重复导入');
  assert.ok(app.indexOf('consumeBrowserImportGate(importGate);') < app.indexOf('await importBackupContent(await file.text(), importGate);'), '未通过令牌检查不能调用导入');
});
