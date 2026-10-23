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
const knowledgeSearch = require('../prototype/knowledge-search.js');
const { createEmptyState, confirmCase } = require('../prototype/storage');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'prototype', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'prototype', 'app.js'), 'utf8');

test('旧公开资料取消选择和切换项目会清理模型上下文', () => {
  assert.match(app, /state\.researchSelection = \[\.\.\.\(state\.researchSelection \|\| \[\]\), id\];\s*state\.knowledgeSelection = \[\.\.\.\(state\.knowledgeSelection \|\| \[\]\), id\];/);
  assert.match(app, /state\.researchSelection = \(state\.researchSelection \|\| \[\]\)\.filter\(selected => selected !== id\);\s*state\.knowledgeSelection = \(state\.knowledgeSelection \|\| \[\]\)\.filter\(selected => selected !== id\);/);
  assert.match(app, /if \(activeProjectId && activeProjectId !== project\.id\) \{\s*state\.knowledgeSelection = \[\];\s*selectedSearchIds\.clear\(\);\s*remoteSearchResults = \[\];\s*sendDraft = null;\s*persist\(\);\s*document\.getElementById\("send-preview"\)\.hidden = true;\s*renderSearchResults\(\);/);
});

test('资料库包含搜索、类型筛选和新增资料入口', () => {
  for (const id of [
    'knowledge-query',
    'knowledge-type',
    'knowledge-domain',
    'knowledge-stage',
    'knowledge-verification',
    'knowledge-search',
    'knowledge-search-status',
    'knowledge-entry-form',
    'open-knowledge-entry',
    'knowledge-entry-type',
    'knowledge-entry-title',
    'knowledge-entry-url',
    'knowledge-entry-domains',
    'knowledge-entry-stages',
    'knowledge-entry-keywords',
    'knowledge-entry-summary',
    'knowledge-entry-patterns',
    'knowledge-entry-limitations',
    'knowledge-entry-license',
    'cancel-knowledge-entry',
    'knowledge-results',
    'knowledge-detail',
    'close-knowledge-detail'
  ]) {
    assert.match(html, new RegExp("id=[\\\"']" + id + "[\\\"']"));
  }
  assert.match(html, /本地资料库/);
  assert.match(html, /搜索本地资料/);
  assert.match(html, /公开资料入口/);
  assert.match(html, /只保存摘要、可借鉴方法和必要摘录/);

  for (const functionName of [
    'renderKnowledgeResults',
    'getKnowledgeFilters',
    'saveKnowledgeEntry',
    'selectKnowledgeEntry',
    'refreshKnowledgeView'
  ]) {
    assert.match(app, new RegExp(`function ${functionName}\\(`));
  }
  assert.match(app, /getElementById\("knowledge-search"\)\.addEventListener\("click", refreshKnowledgeView\)/);
  assert.match(app, /getElementById\("open-knowledge-entry"\)\.addEventListener\("click"/);
  assert.match(app, /getElementById\("cancel-knowledge-entry"\)\.addEventListener\("click"/);
  assert.match(app, /getElementById\("knowledge-entry-form"\)\.addEventListener\("submit", saveKnowledgeEntry\)/);
  assert.match(app, /getElementById\("close-knowledge-detail"\)\.addEventListener\("click"/);
});

test('资料库页面包含搜索、筛选和新增摘要的界面骨架', () => {
  const html = fs.readFileSync(path.join(root, 'prototype', 'index.html'), 'utf8');
  const dictionaryScriptIndex = html.indexOf('<script src="/prototype/search-dictionary.js"></script>');
  const knowledgeSearchScriptIndex = html.indexOf('<script src="/prototype/knowledge-search.js"></script>');
  assert.ok(
    dictionaryScriptIndex >= 0 && dictionaryScriptIndex < knowledgeSearchScriptIndex,
    '正式入口必须先加载 search-dictionary.js 再加载 knowledge-search.js'
  );
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
  assert.ok(html.includes('导出备份'), '资料库应提供备份导出入口');
  assert.ok(html.includes('导入备份'), '资料库应提供备份导入入口');
  assert.ok(html.includes('最近备份'), '资料库应显示最近备份状态');
  assert.ok(html.includes('从资料库移除'), '必须区分移除资料库与删除原始数据');
  assert.ok(html.includes('删除手动资料'), '批量删除必须明确限于手动资料');
  assert.ok(html.includes('<option value="favorite">收藏</option>'), '应提供收藏筛选');
  assert.ok(html.includes('<option value="recent">最近使用</option>'), '应提供最近使用筛选');
  assert.ok(html.includes('<option value="pinned">置顶</option>'), '应提供置顶筛选');
  const app = fs.readFileSync(path.join(root, 'prototype', 'app.js'), 'utf8');
  for (const phrase of ['当前版本', '最近复盘', '复盘次数', '适用场景', '不适用场景', '查看历史', '对比版本', '暂不复用', '删除案例']) {
    assert.match(app, new RegExp(phrase), '案例资料卡缺少版本或适用边界能力: ' + phrase);
  }
  assert.match(app, /<details class="case-history">/, '案例历史默认应折叠');
  assert.match(app, /data-case-compare/, '案例应提供版本对比入口');
  assert.match(app, /data-case-delete/, '案例应提供删除入口');
  assert.match(app, /createSafetyBackup\(\)/, '删除案例前必须创建安全备份');
  assert.match(app, /deleteCase\(state, caseId\)/, '删除案例必须调用 storage.deleteCase');
  assert.match(app, /deferCaseReuseState\(state, caseId\)/, '暂不复用必须更新案例持久化状态');
  assert.match(app, /filter\(item => !item\.hiddenAt\)/, '发送上下文必须排除已隐藏资料卡');
  assert.match(app, /\["knowledge-scope", "knowledge-type", "knowledge-domain", "knowledge-stage", "knowledge-verification", "case-filter", "case-domain", "case-project"\]\.forEach\(id => document\.getElementById\(id\)\.addEventListener\("change", refreshKnowledgeView\)\)/, '资料范围筛选变更必须立即刷新资料视图');
  assert.ok(app.includes('data-knowledge-edit'), '手动资料应提供编辑入口');
  assert.ok(app.includes('data-knowledge-source'), '派生资料应提供编辑原始来源入口');
  assert.ok(app.includes('data-knowledge-edit'), '手动资料编辑按钮必须存在');
  assert.ok(app.includes('beginKnowledgeEntryEdit(entry)'), '手动资料编辑按钮必须绑定可执行事件');
  assert.ok(app.includes('data-knowledge-source'), '派生资料来源按钮必须存在');
  assert.ok(app.includes('handleKnowledgeSourceAction(entry)'), '派生资料来源按钮必须绑定可执行事件');
  const searchResult = knowledgeSearch.searchKnowledge([
    { id: 'smoke-entry', title: '提示词复核', summary: '检查验收标准', keywords: ['review', '验收'] }
  ], 'review');
  assert.deepEqual(searchResult.map(item => item.id), ['smoke-entry']);
  assert.ok(searchResult[0].matchedFields.includes('keywords'), '搜索结果应保留命中字段解释');
  assert.ok(knowledgeSearch.suggestSearchTerms('不存在的复核词', [{ title: '提示词复核', keywords: ['review'] }]).length <= 3, '无结果搜索应提供有界建议');
  assert.ok(app.includes('knowledgeForm.dataset.editId = entry.id'), '手动资料编辑必须设置 edit id');
  assert.match(app, /当前来源暂不支持直接编辑，资料卡和原始项目均未删除/, '不可编辑来源必须给出明确提示');
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

test('发送面板接入安全预览并保留编辑与失败状态契约', () => {
  const html = fs.readFileSync(path.join(root, 'prototype', 'index.html'), 'utf8');
  const safetyScriptIndex = html.indexOf('<script src="/prototype/send-safety.js"></script>');
  const appScriptIndex = html.indexOf('<script src="/prototype/app.js"></script>');
  assert.ok(safetyScriptIndex >= 0 && safetyScriptIndex < appScriptIndex, 'send-safety.js 必须在 app.js 前加载');
  for (const id of [
    'send-preview-stats',
    'send-preview-segments',
    'send-preview-findings',
    'send-preview-confirmation'
  ]) {
    assert.ok(html.includes('id="' + id + '"'), '发送面板缺少安全预览控件: ' + id);
  }
  assert.match(html, /本地规则检测明显敏感信息.*不能保证识别所有凭证/);
  const app = fs.readFileSync(path.join(root, 'prototype', 'app.js'), 'utf8');
  assert.ok(app.includes('window.ForwardStepSendSafety'), 'app.js 必须读取正式安全预览模块');
  assert.ok(app.includes('buildSendReport'), '发送面板必须生成安全报告');
  assert.ok(app.includes('sendDraft.renderedText = event.target.value'), '编辑文本必须保留为实际发送文本');
  assert.ok(app.includes('renderSendPanel()'), '编辑和删除资料后必须重新渲染安全统计');
  assert.match(app, /function buildSendContent\(\)[\s\S]*return \{ text: fullText, segments \}/, '安全报告和发送文本必须来自同一分段构造');
  assert.match(app, /syncUneditedSendText\(\)/, '资料变更后必须同步重建未编辑文本');
  assert.match(app, /send-preview-confirm"\)\.disabled\s*=\s*!serviceConfig\.model\?\.configured/);
  assert.match(app, /sendDraft\.confirmedRisk/);
  assert.match(app, /if \(succeeded\) closeSendPanel\(\{ cancelled: false \}\);/);
  assert.match(app, /近似 token/);
  assert.match(app, /高风险/);
  assert.match(app, /确认高风险内容后再发送/);
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
  assert.ok(app.includes('consumeBrowserImportGate(importGate);'), '文件 change 入口必须保留令牌防御检查');
  assert.match(app, /下载已触发，请确认你已看到并保存安全备份文件/);
  assert.match(app, /未确认已保存安全备份/);
  assert.ok(app.includes('browserImportGate = null;'), '令牌必须在 change 前后清理，防止重复导入');
  assert.ok(app.indexOf('consumeBrowserImportGate(importGate);') < app.indexOf('await importBackupContent(await file.text());'), '未通过令牌检查不能读取文件或调用导入');
});

test('社媒研究入口加载 UI 并贯通计划、平台准备、结果和报告区域', () => {
  const html = fs.readFileSync(path.join(root, 'prototype', 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'prototype', 'social-research-ui.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'prototype', 'app.js'), 'utf8');
  for (const id of [
    'view-social-research', 'social-research-entry', 'social-research-plan-confirm',
    'social-platform-preparation', 'social-research-status', 'social-research-results',
    'social-research-save-selection', 'social-research-report'
  ]) assert.ok(html.includes(`id="${id}"`), `研究工作台缺少 ${id}`);
  assert.ok(html.indexOf('src="/prototype/social-research-ui.js"') < html.indexOf('src="/prototype/app.js"'));
  assert.match(app, /createSocialResearchCoordinator\(/);
  assert.match(app, /ForwardStepSocialResearchUI\.createSocialResearchUI\(/);
  assert.match(ui, /data-report-result/);
  assert.match(ui, /data-save-result/);
});

test('社媒研究工作区备份可恢复摘要报告和附件元数据且不带凭证', () => {
  const { createBackup, replaceState } = require('../prototype/workspace-backup.js');
  const state = {
    researchTasks: [{
      id: 'smoke-research-task',
      topic: '用户对产品的反馈',
      results: [{ id: 'smoke-result', summary: '用户普遍反馈上手困难。', url: 'https://example.test/post' }],
      report: { coreFindings: ['上手成本是主要问题。'], resultIds: ['smoke-result'] },
      apiKey: 'task-secret'
    }],
    platformConnections: {
      reddit: {
        platform: 'reddit', status: 'ready', profilePath: 'C:/private/profile',
        storagePath: 'C:/private/storage', profileDirectory: 'C:/private/profile-directory',
        cookies: ['cookie-secret'], sessionToken: 'session-secret', apiKey: 'api-secret', password: 'password-secret'
      }
    },
    researchAttachments: [{
      id: 'smoke-attachment', type: 'document', size: 128, sourceResultId: 'smoke-result',
      relativePath: 'research/smoke.pdf', savedAt: '2026-10-19T08:00:00.000Z', password: 'attachment-secret'
    }]
  };

  const backup = createBackup(state, { scope: 'workspace', now: '2026-10-19T08:00:00.000Z' });
  const restored = replaceState({}, JSON.parse(JSON.stringify(backup)));
  const serialized = JSON.stringify(backup);

  assert.equal(restored.researchTasks[0].results[0].summary, '用户普遍反馈上手困难。');
  assert.deepEqual(restored.researchTasks[0].report.coreFindings, ['上手成本是主要问题。']);
  assert.deepEqual(restored.researchTasks[0].report.resultIds, ['smoke-result']);
  assert.deepEqual(restored.researchAttachments[0], {
    id: 'smoke-attachment', type: 'document', size: 128, sourceResultId: 'smoke-result',
    relativePath: 'research/smoke.pdf', savedAt: '2026-10-19T08:00:00.000Z'
  });
  assert.equal(restored.platformConnections.reddit.status, 'needs-recheck');
  const connectionMetadata = restored.platformConnections.reddit;
  for (const pathField of ['profilePath', 'storagePath', 'profileDirectory']) {
    assert.equal(Object.hasOwn(connectionMetadata, pathField), false, `连接备份不应包含 ${pathField}`);
    assert.equal(serialized.includes(pathField), false, `序列化备份不应包含 ${pathField}`);
  }
  for (const secret of ['task-secret', 'C:/private/profile', 'C:/private/storage', 'C:/private/profile-directory', 'cookie-secret', 'session-secret', 'api-secret', 'password-secret', 'attachment-secret']) {
    assert.equal(serialized.includes(secret), false, `备份不应包含 ${secret}`);
  }
});

test('PPT 规划工作台从提示词 Agent 入口加载并保持文件输出边界', () => {
  const sceneUi = fs.readFileSync(path.join(root, 'prototype', 'ppt-scene-ui.js'), 'utf8');
  const retrieverIndex = html.indexOf('src="/prototype/retriever.js"');
  const schemaIndex = html.indexOf('src="/prototype/ppt-scene-schema.js"');
  const workflowIndex = html.indexOf('src="/prototype/ppt-scene-workflow.js"');
  const promptsIndex = html.indexOf('src="/prototype/ppt-scene-prompts.js"');
  const coordinatorIndex = html.indexOf('src="/prototype/ppt-scene-coordinator.js"');
  const uiIndex = html.indexOf('src="/prototype/ppt-scene-ui.js"');
  const appIndex = html.indexOf('src="/prototype/app.js"');
  assert.ok(schemaIndex >= 0 && schemaIndex < coordinatorIndex, 'PPT schema 必须先于 coordinator 加载');
  assert.ok(retrieverIndex >= 0 && retrieverIndex < coordinatorIndex, '资料检索器必须先于 coordinator 加载');
  assert.ok(workflowIndex >= 0 && workflowIndex < coordinatorIndex, 'PPT workflow 必须先于 coordinator 加载');
  assert.ok(promptsIndex >= 0 && promptsIndex < coordinatorIndex, 'PPT prompts 必须先于 coordinator 加载');
  assert.ok(coordinatorIndex < uiIndex && uiIndex < appIndex, 'coordinator、UI、app 必须按顺序加载');
  assert.match(html, /id="ppt-scene-root"/);
  assert.match(app, /createPptSceneCoordinator\(/);
  assert.match(app, /createPptSceneUI\(/);
  assert.match(app, /searchWeb/);
  assert.match(app, /searchLocalSources/);
  assert.match(app, /createSocialResearchPlan/);
  assert.match(sceneUi, /normalizePptScene/);
  assert.doesNotMatch(app, /writeFile|saveAs\(|createPresentation|pptxgen/i, '规划工作台不能写入最终演示文稿或成品文件');
});


test('写作、提示词Agent与学术论文分别挂载到独立页面', () => {
  assert.equal((html.match(/id="writing-workbench-root"/g) || []).length, 1);
  const promptView = html.indexOf('id="view-prompt-agent"');
  const writingView = html.indexOf('id="view-article"');
  const academicView = html.indexOf('id="view-academic-workbench"');
  const promptRoot = html.indexOf('id="prompt-agent-root"');
  const writingRoot = html.indexOf('id="writing-workbench-root"');
  const academicRoot = html.indexOf('id="academic-literature-root"');
  const academicReviewRoot = html.indexOf('id="academic-review-root"');
  const academicPublishingRoot = html.indexOf('id="academic-publishing-root"');
  assert.ok(promptView < promptRoot && promptRoot < writingView);
  assert.ok(writingView < writingRoot && writingRoot < academicView);
  assert.ok(academicView < academicRoot && academicRoot < academicReviewRoot && academicReviewRoot < academicPublishingRoot);
  assert.doesNotMatch(html, /id="article-form"/);
  assert.doesNotMatch(app, /currentArticleReviewCase|resetArticleReviewResult|article-original|article-revised/);
  const scripts = ['writing-workbench-schema', 'writing-workbench-prompts', 'writing-workbench-coordinator', 'writing-workbench-ui', 'app'];
  const positions = scripts.map(name => html.indexOf('src="/prototype/' + name + '.js"'));
  assert.ok(positions.every((pos, i) => pos >= 0 && (i === 0 || pos > positions[i - 1])));
  for (const scene of ['task', 'ppt']) assert.ok(html.includes('data-agent-scene="' + scene + '"'));
  assert.doesNotMatch(html, /data-agent-scene="writing"/);
  assert.match(html, /#view-prompt-agent \[hidden\]\s*\{\s*display:\s*none/);
});

test('写作工作台独立于提示词Agent的任务与PPT场景', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  await f.event('nav-article');
  assert.notEqual(f.mount.hidden, true);
  assert.match(f.element('breadcrumb').textContent, /写作工作台/);
  await f.event('scene-ppt');
  assert.equal(f.element('ppt-scene-root').hidden, false);
  await f.event('scene-task');
  assert.equal(f.element('prompt-agent-root').hidden, false);
  assert.equal(f.element('ppt-scene-root').hidden, true);
  assert.notEqual(f.mount.hidden, true, 'Agent 场景切换不隐藏独立写作页内容');
});

test('长手册改写闭环将原文与三份辅助材料分开并生成附原件的选章提示词', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  await f.change('writing-wizard-mode-rewrite', 'rewrite');
  await f.input('writing-goal', '保留事实，优化操作手册表达');
  await f.change('writing-source-file', [{ name: '操作手册.md', size: 100, lastModified: 1,
    text: async () => '# 安装步骤\n全文唯一原文哨兵。\n'.repeat(3) }]);
  await f.change('writing-source-processing-scope', 'sections');
  const sectionId = f.mount.querySelectorAll('[data-source-section]')[0]?.id;
  assert.ok(sectionId, '应提取出可选章节');
  await f.change(sectionId, true);

  const files = Array.from({ length: 4 }, (_, index) => {
    const content = `export const reference${index} = '参考摘录${index}';`;
    const bytes = Uint8Array.from(Buffer.from(content));
    return { name: `reference-${index}.js`, webkitRelativePath: `repo/src/reference-${index}.js`, size: bytes.length,
      arrayBuffer: async () => bytes.buffer };
  });
  await f.change('writing-material-folder', files);
  const candidates = f.mount.querySelectorAll('[data-wizard-material]');
  assert.equal(candidates.length, 4);
  for (let index = 0; index < 3; index++) await f.changeData('wizardMaterial', index, true);
  assert.equal(f.mount.querySelectorAll('[data-wizard-material]').filter(item => item.disabled).length, 1,
    '三份材料选满后应阻止勾选第四份');

  let analyzedInput;
  f.coordinator.analyzeTask = async input => {
    analyzedInput = input;
    return { genre: 'article', taskType: 'revision', reason: '按章节改写手册' };
  };
  await f.click('wizard-analyze');
  assert.equal(analyzedInput.sourceDocument.preview.length <= 8000, true);
  assert.equal(analyzedInput.materials.length, 3);
  assert.ok(analyzedInput.materials.every(item => item.excerpt));
  await f.change('writing-wizard-genre', 'article');
  await f.change('writing-wizard-task-type', 'revision');
  await f.click('wizard-confirm');
  const round = f.coordinator.getWorkspace(f.coordinator.listArticles()[0].id).rounds.at(-1);
  assert.match(round.prompt, /请在当前 AI 对话中附上该文件/);
  assert.match(round.prompt, /只处理以下章节/);
  assert.match(round.prompt, /安装步骤/);
  assert.doesNotMatch(round.prompt, /全文唯一原文哨兵/);
  assert.equal(round.sourceDocument.selectedSectionIds.length, 1);
});
