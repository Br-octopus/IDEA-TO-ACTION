const test = require('node:test');
const assert = require('node:assert/strict');
const { createWritingDOM } = require('./helpers/writing-dom.js');
const { createWritingApp } = require('./helpers/writing-app.js');
const { createWritingWorkbenchCoordinator } = require('../prototype/writing-workbench-coordinator.js');
const storage = require('../prototype/storage.js');
const { createWritingWorkbenchUI } = require('../prototype/writing-workbench-ui.js');
const writingPackCatalog = require('../prototype/writing-pack-catalog.js');

test('新写作与文章改写共用引导步骤，只有改写要求原文；分析失败可手动确认', async () => {
  const f = fixture();
  let analyzedInput = null;
  f.coordinator.analyzeTask = async input => { analyzedInput = input; throw new Error('分析服务暂不可用'); };
  assert.match(f.mount.innerHTML, /新写作：从目标开始/);
  assert.doesNotMatch(f.mount.innerHTML, /待改原文/);
  const initialIds = [...f.mount.innerHTML.split('<div hidden>')[0].matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(initialIds).size, initialIds.length, '首屏控件 ID 唯一');
  await f.input('writing-goal', '写一篇介绍本地备份的文章');
  await f.click('wizard-analyze');
  assert.match(f.mount.innerHTML, /确认方向/);
  assert.match(f.mount.innerHTML, /可手动选择后继续/);
  await f.change('writing-wizard-genre', 'article');
  await f.change('writing-wizard-task-type', 'revision');
  await f.click('wizard-confirm');
  assert.equal(f.coordinator.listArticles().length, 1);
  assert.match(f.mount.innerHTML, /生成提示词/);
  assert.match(f.mount.innerHTML, /可编辑提示词/);
  const promptStageIds = [...f.mount.innerHTML.split('<div hidden>')[0].matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(promptStageIds).size, promptStageIds.length, '提示词阶段控件 ID 唯一');

  const firstArticleId = f.coordinator.listArticles()[0].id;
  await f.input('writing-prompt', '用户手工调整后的提示词');
  await f.click('wizard-stage', { stage: '2' });
  await f.input('writing-goal', '补充目标细节');
  await f.click('wizard-confirm');
  const firstWorkspace = f.coordinator.getWorkspace(firstArticleId);
  assert.equal(firstWorkspace.rounds.length, 2, '任务目标变化后生成新轮次');
  assert.equal(f.node('writing-prompt').value, '用户手工调整后的提示词', '回退确认后保留手工编辑的提示词');
  assert.equal(firstWorkspace.rounds.at(-1).promptVersions.at(-1).content, '用户手工调整后的提示词');
  assert.match(f.mount.innerHTML, /已保留你手动编辑的提示词/);

  await f.click('new');
  await f.change('writing-wizard-mode-rewrite', 'rewrite');
  assert.match(f.mount.innerHTML, /待改原文/);
  await f.input('writing-goal', '保留事实，改得更简洁');
  await f.click('wizard-analyze');
  assert.match(f.mount.innerHTML, /请先提供待改原文和改写目标/);
  assert.equal(analyzedInput.draft, '', '原文缺失时不发起分析请求');
  await f.input('writing-draft', '这是需要改写的原文。');
  await f.click('wizard-analyze');
  assert.equal(analyzedInput.draft, '这是需要改写的原文。');
  await f.change('writing-wizard-genre', 'article');
  await f.change('writing-wizard-task-type', 'revision');
  await f.click('wizard-confirm');

  const articleId = f.coordinator.listArticles().at(-1).id;
  await f.click('wizard-used');
  await f.input('writing-newDraft', '外部 AI 返回的改写结果。');
  f.coordinator.runModelDiagnosis = async id => {
    const round = f.coordinator.getWorkspace(id).rounds.at(-1);
    await f.coordinator.addIssue(id, { roundId: round.id, excerpt: '遗漏范围说明', observation: '结果没有说明适用范围',
      impact: '读者无法判断适用对象', evidenceCategory: 'requirement', evidenceDescription: '任务目标要求明确适用范围',
      suggestion: '补充适用范围', priority: 'high' });
    return { diagnosis: '发现适用范围遗漏。', prompt: '修订提示词基础内容' };
  };
  await f.click('wizard-check');
  const issue = f.coordinator.getWorkspace(articleId).issues.at(-1);
  assert.match(f.mount.innerHTML, /选择需要处理的问题/);
  await f.change(`writing-wizard-issue-${issue.id}`, true);
  await f.click('wizard-next');
  assert.match(f.node('writing-prompt').value, /结果没有说明适用范围/);
  assert.match(f.coordinator.getWorkspace(articleId).rounds.at(-1).promptVersions.at(-1).content, /结果没有说明适用范围/);
});

test('引导材料候选可即时搜索并清除筛选，未匹配时仍保留完整候选', async () => {
  const f = fixture();
  assert.match(f.mount.innerHTML, /搜索候选文件/);
  await f.input('writing-wizard-material-search', '备份');
  assert.match(f.mount.innerHTML, /没有匹配的候选文件/);
  await f.click('wizard-clear-material-search');
  assert.equal(f.node('writing-wizard-material-search').value, '');
});

test('长原文从独立文件导入，章节范围进入分析和保存轮次，提示词要求附原件', async () => {
  const f = fixture();
  await f.change('writing-wizard-mode-rewrite', 'rewrite');
  assert.match(f.mount.innerHTML, /id="writing-source-file"/);
  assert.match(f.mount.innerHTML, /待改原文/);
  await f.input('writing-goal', '优化操作手册');
  await f.change('writing-source-file', [{ name: '操作手册.md', size: 80, lastModified: 1,
    text: async () => '# 安装软件\n安装内容哨兵'.repeat(4) }]);
  assert.match(f.mount.innerHTML, /操作手册\.md/);
  await f.change('writing-source-processing-scope', 'sections');
  assert.match(f.mount.innerHTML, /安装软件/);
  const sectionId = f.mount.querySelectorAll('[data-source-section]')[0]?.id;
  assert.ok(sectionId, '应显示可选择章节');
  await f.change(sectionId, true);
  f.coordinator.analyzeTask = async input => {
    assert.equal(input.sourceDocument.name, '操作手册.md');
    assert.equal(input.sourceDocument.selectedSectionIds.length, 1);
    return { genre: 'article', taskType: 'revision', reason: '已有操作手册' };
  };
  await f.click('wizard-analyze');
  await f.change('writing-wizard-genre', 'article');
  await f.change('writing-wizard-task-type', 'revision');
  await f.click('wizard-confirm');
  const round = f.coordinator.getWorkspace(f.coordinator.listArticles()[0].id).rounds.at(-1);
  assert.equal(round.sourceDocument.name, '操作手册.md');
  assert.match(round.prompt, /请在当前 AI 对话中附上该文件/);
  assert.match(round.prompt, /安装软件/);
  assert.doesNotMatch(round.prompt, /安装内容哨兵/);
});

test('参考文件夹按20项分页搜索；过滤文件恢复后才读取，敏感路径不展示', async () => {
  const f = fixture();
  const makeFile = (path, text) => {
    const bytes = Uint8Array.from(Buffer.from(text));
    return { name: path.split('/').at(-1), webkitRelativePath: `repo/${path}`, size: bytes.length,
      arrayBuffer: async () => bytes.buffer };
  };
  const files = Array.from({ length: 24 }, (_, index) => makeFile(`src/file-${index}.js`, `export const item${index} = true;`));
  files.push(makeFile('docs/操作手册.md', '# 操作手册\n安装步骤说明。'));
  files.push(makeFile('build_v8.js', 'export const generated = true;'));
  files.push(makeFile('.env', 'API_KEY=hidden-value'));
  await f.change('writing-material-folder', files);
  assert.match(f.mount.innerHTML, /每页 20 项/);
  await f.input('writing-wizard-material-search', '操作手册');
  assert.match(f.mount.innerHTML, /docs\/操作手册\.md/);
  await f.input('writing-wizard-material-search', '');
  await f.click('wizard-filtered-toggle');
  assert.match(f.mount.innerHTML, /build_v8\.js/);
  assert.doesNotMatch(f.mount.innerHTML, /\.env|hidden-value/);
  const restore = f.mount.querySelectorAll('[data-writing-action="wizard-restore-filtered"]')[0];
  assert.ok(restore);
  await f.click('wizard-restore-filtered', { projectSource: restore.dataset.projectSource, relativePath: 'build_v8.js' });
  assert.match(f.mount.innerHTML, /build_v8\.js/);
  assert.match(f.mount.innerHTML, /generated = true/);
  assert.doesNotMatch(f.mount.innerHTML, /API_KEY=hidden-value/);
});

test('不同文件夹的同路径候选去重，移除一个来源后保留另一个来源的候选', async () => {
  const f = fixture();
  const makeFile = (root, text) => {
    const bytes = Uint8Array.from(Buffer.from(text));
    return { name: 'guide.md', webkitRelativePath: `${root}/docs/guide.md`, size: bytes.length,
      arrayBuffer: async () => bytes.buffer };
  };
  await f.change('writing-material-folder', [makeFile('project-a', '# Guide\nFirst source excerpt.')]);
  await f.change('writing-material-folder', [makeFile('project-b', '# Guide\nSecond source excerpt.')]);

  assert.equal(f.mount.querySelectorAll('[data-wizard-material]').length, 1, '相同相对路径只显示一个候选');
  assert.match(f.mount.innerHTML, /First source excerpt/);
  const sources = f.mount.querySelectorAll('[data-writing-action="wizard-remove-project-source"]');
  assert.equal(sources.length, 2);
  await f.click('wizard-remove-project-source', { projectSource: sources[0].dataset.projectSource });

  assert.equal(f.mount.querySelectorAll('[data-wizard-material]').length, 1, '移除单个来源不应误删仍被引用的候选');
  assert.match(f.mount.innerHTML, /Second source excerpt/);
  assert.doesNotMatch(f.mount.innerHTML, /First source excerpt/);
});

test('原文文件快速替换时迟到解析结果不会覆盖当前文件', async () => {
  const f = fixture();
  await f.change('writing-wizard-mode-rewrite', 'rewrite');
  let releaseFirst;
  const firstRead = new Promise(resolve => { releaseFirst = resolve; });
  const first = f.change('writing-source-file', [{ name: '旧手册.md', size: 10, lastModified: 1, text: () => firstRead }]);
  await new Promise(resolve => setImmediate(resolve));
  const second = f.change('writing-source-file', [{ name: '新手册.md', size: 12, lastModified: 2,
    text: async () => '# 新目录\n新文件正文' }]);
  await second;
  releaseFirst('# 旧目录\n旧文件正文');
  await first;
  assert.match(f.mount.innerHTML, /新手册\.md/);
  assert.doesNotMatch(f.mount.innerHTML, /旧手册\.md|旧目录/);
});

test('UMD界面从schema配置读取名称、目标标签、维度和说明，选择维度实际进入诊断', async () => {
  const vm = require('node:vm');
  const { readFileSync } = require('node:fs');
  const schema = require('../prototype/writing-workbench-schema.js');
  const config = { name: '配置文章名', applicability: '适用范围哨兵',
    targetFields: { title: '标题', goal: '配置目标标签', audience: '读者', platform: '平台', successCriteria: '成功标准', preserveItems: '保留项', constraints: '限制条件' },
    checkDimensions: ['事实依据'], riskReminders: ['风险提醒哨兵'], styleBaseline: ['风格建议哨兵'], memoryNamespace: '内部记忆标识哨兵' };
  const context = vm.createContext({ WritingWorkbenchSchema: { ...schema, getWritingGenreConfig: genre => genre === 'article' ? config : null } });
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-workbench-ui.js'), 'utf8'), context);
  const dom = createWritingDOM();
  const coordinator = createWritingWorkbenchCoordinator();
  context.WritingWorkbenchUI.createWritingWorkbenchUI({ document: dom.document, coordinator, getState: () => ({}) });
  assert.equal(dom.node('writing-genre').value, config.name);
  assert.deepEqual(dom.mount.querySelectorAll('[data-writing-dimension]').map(n => n.dataset.writingDimension), ['事实依据']);
  for (const text of ['配置目标标签', '适用范围哨兵', '风险提醒哨兵', '风格建议哨兵']) assert.ok(dom.mount.innerHTML.includes(text), text);
  assert.ok(!dom.mount.innerHTML.includes('内部记忆标识哨兵'));
  await dom.change('writing-dimension-0', true);
  await dom.input('writing-goal', '配置目标输入');
  await dom.click('create');
  const article = coordinator.listArticles()[0];
  assert.equal(article.genre, 'article');
  assert.equal(article.goal, '配置目标输入');
  assert.deepEqual(article.dimensions, ['事实依据']);
  assert.ok(dom.node('writing-diagnosis').value.includes('事实依据'));
  assert.ok(!dom.node('writing-diagnosis').value.includes('语言表达：'));
});

test('材料卡显示自动选材理由并允许用户排除本轮不采用的材料', async () => {
  const app = fixture();
  await app.click('add-material');
  await app.input('writing-material-0-title', '预算记录');
  await app.input('writing-material-0-excerpt', '项目预算依据为公开报价。');
  app.ui.render();
  assert.match(app.mount.innerHTML, /系统按当前任务文本匹配|材料数量未超过上限|没有找到明确关键词匹配/);
  await app.change('writing-material-0-selection', false);
  await app.input('writing-goal', '核对预算依据');
  await app.click('create');
  const article = app.coordinator.listArticles()[0];
  const round = app.coordinator.getWorkspace(article.id).rounds[0];
  assert.equal(round.materials[0].selectedForPrompt, false);
  assert.doesNotMatch(round.prompt, /项目预算依据为公开报价/);
});

function fixture(options = {}) {
  const dom = createWritingDOM();
  let state = options.initialState || storage.createEmptyState();
  const disk = new Map();
  let failSave = false;
  let requests = 0;
  const copied = [];
  const writingPacks = options.writingPacks || [];
  const coordinator = createWritingWorkbenchCoordinator({
    getState: () => state,
    persistState(next) { if (failSave) throw new Error('磁盘已满'); state = storage.saveState({ getItem: key => disk.get(key), setItem: (key, value) => disk.set(key, value) }, next); return state; },
    writingPacks,
    requestModel: async payload => { requests++; return options.requestModel ? options.requestModel(payload) : '模型诊断'; },
    promptAgentCoordinator: options.promptAgentCoordinator || { selectMaterials: async () => [{ id: 'local-1', title: '本地资料', excerpt: '来源事实', location: 'https://example.test/source' }] }
  });
  const packUI = writingPacks.length ? {
    getAvailablePacks: () => writingPacks,
    getSelection: () => ({ selectedIds: writingPacks.map(pack => pack.id) }),
    renderManager: () => '', connectWorkbenchRenderer() {}, handle() {}
  } : undefined;
  const ui = createWritingWorkbenchUI({ document: dom.document, coordinator, packUI, getState: () => state, desktopApi: options.desktopApi,
    fetch: options.fetch, copyText: async text => copied.push(text), downloadText: options.downloadText,
    confirm: options.confirm || (() => true), saveMaterialToLibrary: options.saveMaterialToLibrary });
  return { ...dom, ui, coordinator, copied, get state() { return state; }, get requests() { return requests; }, set failSave(value) { failSave = value; } };
}

test('软著内容包在普通文章中可选，且不会自动用于无关文章', () => {
  const packs = writingPackCatalog.getBuiltinWritingPacks();
  const f = fixture({ writingPacks: packs });
  const checkbox = f.node('writing-pack-selection-builtin-softcopyright-content');
  assert.ok(checkbox, '软著内容包显示在专业基础包选择区');
  assert.equal(checkbox.checked, false, '普通文章默认不自动套用软著规则');
  assert.match(f.mount.innerHTML, /软著内容/);
});
test('通用核心包可在普通文章任务中选择并进入实际提示词', async () => {
  const app = createWritingApp();
  await app.settle();
  await app.packCoordinator.createPack({
    id: 'shared-core-writing-rules', name: '通用写作规则', layer: 'core',
    checks: [{ id: 'core-rule', statement: '通用核心规则进入提示词' }]
  });
  app.window.WritingWorkbenchUIController.render();

  const selection = app.node('writing-pack-selection-shared-core-writing-rules');
  assert.ok(selection, '核心层包显示在普通文章选择区');
  await app.change('writing-pack-selection-shared-core-writing-rules', true);
  await app.input('writing-goal', '验证核心层包消费');
  await app.input('writing-draft', '这是一段验收初稿。');
  await app.click('create');
  await app.settle();

  const article = app.coordinator.getWorkspace(app.coordinator.listArticles()[0].id);
  assert.deepEqual(article.article.packSelections, ['builtin-writing-core', 'shared-core-writing-rules']);
  assert.match(article.rounds[0].prompt, /通用核心规则进入提示词/);
});

test('写作工作台可预览资料库全量范围、确认覆盖并完成一批外部处理', async () => {
  const initialState = storage.createEmptyState();
  initialState.knowledgeEntries = [
    { id: 'knowledge-a', title: '材料甲', summary: '甲材料的完整摘要。', updatedAt: 'v1' },
    { id: 'knowledge-b', title: '材料乙', contentExcerpt: '乙材料的可用摘录。', updatedAt: 'v2' }
  ];
  const f = fixture({ initialState });
  await f.input('writing-title', '资料覆盖项目');
  await f.input('writing-goal', '逐项处理完整资料范围');
  await f.click('create');
  await f.change('writing-save', true);
  await f.click('coverage-preview-library');
  assert.match(f.mount.innerHTML, /发现 2 项 · 枚举完整/);
  assert.match(f.mount.innerHTML, /材料甲/);
  assert.match(f.mount.innerHTML, /材料乙/);
  await f.change('writing-coverage-include-library:knowledge-b', false);
  await f.click('coverage-confirm-range');
  assert.match(f.mount.innerHTML, /待处理 1/);
  assert.match(f.mount.innerHTML, /排除 1/);
  await f.click('coverage-start-batch');
  assert.match(f.mount.innerHTML, /当前批次提示词/);
  assert.equal(f.copied.length, 0, '生成提示词不能伪装成复制或外部处理');
  const articleId = f.coordinator.listArticles()[0].id;
  const batch = f.coordinator.getWorkspace(articleId).materialCoverage.batches[0];
  assert.deepEqual(batch.itemIds, ['library:knowledge-a']);
  await f.click('coverage-copy-batch');
  assert.equal(f.copied.length, 1);
  assert.equal(f.coordinator.getWorkspace(articleId).rounds[0].promptVersions.find(version => version.id === batch.promptVersionId).copied, true);
  await f.input(`writing-coverage-result-${batch.id}`, '两条资料均已逐项阅读并汇总。');
  await f.click(`coverage-return`);
  assert.match(f.mount.innerHTML, /已带回 1/);
  await f.input(`writing-coverage-confirmation-${batch.id}`, '已核对外部结果覆盖两条材料');
  await f.click('coverage-confirm');
  assert.match(f.mount.innerHTML, /已完成 1/);
  assert.match(f.mount.innerHTML, /覆盖率 50%/);
  assert.equal(f.state.writingArticles.find(item => item.id === articleId).materialCoverage.items[0].status, 'processed');
});

test('授权目录覆盖只纳入筛选子目录，并在生成批次前重新读取来源版本', async () => {
  const initialState = storage.createEmptyState();
  initialState.promptAgentSources = [{ id: 'grant-a', label: '合成目录', enabled: true }];
  let fingerprint = 'v1';
  let refreshes = 0;
  const desktopApi = { promptAgentSources: { async refreshIndex() {
    refreshes++;
    return { inventoryComplete: true, inventory: [
      { id: 'notes/one.md', relativePath: 'notes/one.md', title: '目录甲', status: 'indexed' },
      { id: 'other/two.md', relativePath: 'other/two.md', title: '目录乙', status: 'indexed' }
    ], files: [
      { id: 'notes/one.md', relativePath: 'notes/one.md', title: '目录甲', fingerprint, excerpt: '甲摘录' },
      { id: 'other/two.md', relativePath: 'other/two.md', title: '目录乙', fingerprint: 'other-v1', excerpt: '乙摘录' }
    ], traversalErrors: [] };
  } } };
  const f = fixture({ initialState, desktopApi });
  await f.input('writing-title', '授权目录覆盖项目');
  await f.input('writing-goal', '只处理选定子目录');
  await f.click('create');
  await f.input('writing-coverage-directory-filter', 'notes');
  await f.click('coverage-preview-directory', { sourceId: 'grant-a' });
  assert.match(f.mount.innerHTML, /发现 1 项 · 枚举完整/);
  assert.match(f.mount.innerHTML, /目录甲/);
  assert.doesNotMatch(f.mount.innerHTML, /目录乙/);
  await f.click('coverage-confirm-range');
  fingerprint = 'v2';
  await f.click('coverage-start-batch');
  assert.equal(refreshes, 2, '批次启动前必须重新检查授权目录来源');
  assert.match(f.mount.innerHTML, /版本已变化/);
  assert.equal(f.coordinator.getWorkspace(f.coordinator.listArticles()[0].id).materialCoverage.items[0].status, 'pending');
});

test('长篇研究文章可为章节保存摘要和前后章节关系', async () => {
  const f = fixture();
  await f.input('writing-title', '跨章节研究文章');
  await f.input('writing-genre', 'longform-research-article');
  await f.input('writing-goal', '解释研究问题并追踪证据');
  await f.click('create');
  const id = f.coordinator.listArticles().at(-1).id;

  assert.ok(f.node('writing-unit-summary'), '新增章节表单提供摘要字段');
  assert.ok(f.node('writing-unit-prior-unit-ids'), '新增章节表单提供前序章节字段');
  assert.ok(f.node('writing-unit-next-unit-ids'), '新增章节表单提供后续章节字段');
  await f.input('writing-unit-title', '第二节：证据分析');
  await f.input('writing-unit-summary', '比较两组证据的适用范围');
  await f.input('writing-unit-prior-unit-ids', '第一节ID');
  await f.input('writing-unit-next-unit-ids', '第三节ID');
  await f.click('add-unit');

  let units = f.coordinator.getWorkspace(id).units;
  assert.equal(units[0].summary, '比较两组证据的适用范围');
  assert.deepEqual(units[0].priorUnitIds, ['第一节ID']);
  assert.deepEqual(units[0].nextUnitIds, ['第三节ID']);

  await f.input(`writing-unit-${units[0].id}-summary`, '修订后的证据范围摘要');
  await f.input(`writing-unit-${units[0].id}-priorUnitIds`, '第一节ID, 引言ID');
  await f.click(`update-unit`, { unitId: units[0].id });
  units = f.coordinator.getWorkspace(id).units;
  assert.equal(units[0].summary, '修订后的证据范围摘要');
  assert.deepEqual(units[0].priorUnitIds, ['第一节ID', '引言ID']);
});

async function create(f, title = '文章甲', draft = '众所周知，这个产品非常重要。') {
  await f.input('writing-title', title);
  await f.input('writing-goal', '向新读者解释产品');
  await f.input('writing-draft', draft);
  await f.click('create');
  return f.coordinator.listArticles().at(-1)?.id;
}

test('真实按钮展示搜索精确预览并确认，未配置明确降级且保留未提交输入和可复制诊断', async () => {
  let calls = 0;
  const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator({
    searchWeb: async () => { calls++; return { configured: false, message: '尚未配置搜索服务' }; }
  });
  const f = fixture({ promptAgentCoordinator: agent });
  const id = await create(f);
  await f.input('writing-new-draft', '未提交的新稿');
  await f.input('writing-feedback', '未提交的反馈');
  await f.input('writing-research-keywords', '产品说明');
  const diagnosis = f.node('writing-diagnosis').value;
  const prompt = f.node('writing-prompt').value;
  await f.click('preview-research');
  assert.equal(calls, 0);
  assert.match(f.mount.innerHTML, /site:github.com|site:github\.com/);
  assert.match(f.mount.innerHTML, /最多.*3.*5|3.*查询.*5.*来源/);
  await f.click('approve-research');
  assert.ok(calls <= 3 && calls > 0);
  assert.equal(f.coordinator.getResearchState(id).status, 'failed');
  assert.match(f.mount.innerHTML, /尚未配置搜索服务/);
  assert.equal(f.node('writing-new-draft').value, '未提交的新稿');
  assert.equal(f.node('writing-feedback').value, '未提交的反馈');
  assert.equal(f.node('writing-diagnosis').value, diagnosis);
  assert.equal(f.node('writing-prompt').value, prompt);
  await f.click('copy-prompt');
  assert.equal(f.copied.at(-1), prompt);
});

test('拒绝搜索真实控件可达、零搜索且不重复申请，新篇可独立预览', async () => {
  let calls = 0;
  const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator({ searchWeb: async () => { calls++; return []; } });
  const f = fixture({ promptAgentCoordinator: agent });
  await create(f);
  await f.click('preview-research');
  await f.click('reject-research');
  assert.match(f.mount.innerHTML, /已拒绝/);
  assert.equal(f.mount.querySelector('[data-writing-action="preview-research"]').disabled, true);
  await f.click('new');
  await create(f, '新篇');
  await f.click('preview-research');
  assert.equal(calls, 0);
});

test('搜索成功后真实保存失败显示会话最新提示词和来源，保留未提交输入', async () => {
  const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator({
    searchWeb: async () => [{ title: '写失败也必须可见的来源', url: 'https://public.test/visible', summary: '摘要' }]
  });
  const f = fixture({ promptAgentCoordinator: agent });
  const id = await create(f);
  await f.change('writing-save', true);
  await f.input('writing-new-draft', '不能丢的新稿');
  await f.input('writing-feedback', '不能丢的反馈');
  await f.click('preview-research');
  f.failSave = true;
  await f.click('approve-research');
  assert.match(f.mount.innerHTML, /保存失败/);
  assert.equal(f.node('writing-prompt').value, f.coordinator.getRounds(id).at(-1).prompt);
  assert.match(f.node('writing-prompt').value, /写失败也必须可见的来源/);
  assert.equal(f.node('writing-material-0-title').value, '写失败也必须可见的来源');
  assert.equal(f.node('writing-new-draft').value, '不能丢的新稿');
  assert.equal(f.node('writing-feedback').value, '不能丢的反馈');
});

test('搜索进行中切篇或取消控件立即生效，迟到适配器不续查询且不污染另一篇', async () => {
  for (const action of ['switch', 'cancel']) {
    let release, started;
    const pending = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { started = resolve; });
    let calls = 0;
    const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator({
      searchWeb: async () => { calls++; started(); return pending; }
    });
    const f = fixture({ promptAgentCoordinator: agent });
    const a = await create(f, '甲');
    await f.click('new');
    const b = await create(f, '乙');
    f.ui.openArticle(a);
    await f.click('preview-research');
    const running = f.click('approve-research');
    await ready;
    assert.equal(f.coordinator.getResearchState(a).status, 'running');
    if (action === 'switch') await f.change('writing-article-list', b);
    else await f.click('cancel-research');
    await running;
    assert.equal(f.coordinator.getResearchState(a).status, 'cancelled');
    release([{ title: '迟到公开来源', url: 'https://late.test', summary: '不得写回' }]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.doesNotMatch(f.node('writing-prompt').value, /迟到公开来源/);
    assert.equal(f.coordinator.getRounds(b).at(-1).sources.length, 0);
  }
});

test('部分、空结果、成功均明确显示，已有模型诊断保留且公开来源不升级记忆', async () => {
  for (const mode of ['partial', 'empty', 'complete']) {
    let calls = 0;
    const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator({ searchWeb: async () => {
      calls++;
      if (mode === 'empty') return [];
      if (mode === 'partial' && calls > 1) throw new Error('第二查询不可用');
      return [{ title: '公开skill', url: 'https://public.test/skill', summary: '公开技能线索', applicability: '普通文章', limitations: '不能当作个人经验' }];
    } });
    const f = fixture({ promptAgentCoordinator: agent });
    const id = await create(f);
    await f.click('model');
    const diagnosis = f.node('writing-diagnosis').value;
    await f.input('writing-new-draft', '未提交新稿');
    await f.click('preview-research');
    await f.click('approve-research');
    assert.equal(f.coordinator.getResearchState(id).status, mode === 'empty' ? 'failed' : mode);
    assert.equal(f.node('writing-diagnosis').value, diagnosis);
    assert.equal(f.node('writing-new-draft').value, '未提交新稿');
    assert.equal(f.state.writingMemories.length, 0);
    if (mode === 'partial') assert.match(f.mount.innerHTML, /部分完成[\s\S]*第二查询不可用/);
    if (mode === 'empty') assert.match(f.mount.innerHTML, /无结果/);
    if (mode === 'complete') assert.match(f.mount.innerHTML, /适用：普通文章[\s\S]*局限：不能当作个人经验/);
  }
});

test('三份受保护上下文占满时UI明确外部摘要未纳入提示词，手工与style/both不丢失', async () => {
  const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator({
    searchWeb: async () => [{ title: '未纳入的公开摘要', url: 'https://public.test/unused', summary: '公开线索' }]
  });
  const f = fixture({ promptAgentCoordinator: agent });
  const w = await f.coordinator.createArticle({ draft: '草稿', materials: [{ title: '手工材料', excerpt: '内容', purpose: 'content' }], sources: [
    { title: '风格样本', excerpt: '风格', purpose: 'style' }, { title: '两用样本', excerpt: '两用', purpose: 'both' }
  ] });
  f.ui.openArticle(w.id);
  await f.click('preview-research');
  await f.click('approve-research');
  assert.match(f.mount.innerHTML, /公开摘要未纳入提示词/);
  assert.doesNotMatch(f.node('writing-prompt').value, /未纳入的公开摘要/);
  assert.equal(f.node('writing-material-0-title').value, '手工材料');
  assert.equal(f.node('writing-material-1-purpose').value, 'style');
  assert.equal(f.node('writing-material-2-purpose').value, 'both');
});

test('同一表单离线新建与继续回带，更新目标不增加轮次，偏好来自显式候选', async () => {
  const f = fixture();
  const id = await create(f);
  assert.equal(f.requests, 0);
  assert.equal(f.state.writingArticles.length, 0);
  assert.match(f.node('writing-diagnosis').value, /众所周知|非常重要/);
  await f.input('writing-goal', '更新目标');
  await f.click('update');
  assert.equal(f.coordinator.getRounds(id).length, 1);
  await f.input('writing-new-draft', '外部 AI 新稿');
  await f.input('writing-feedback', '整段反馈不能偷偷变成长期偏好');
  await f.input('writing-preference', '少用套话');
  await f.input('writing-example', '直接讲事实');
  await f.input('writing-counterexample', '值得注意的是');
  await f.click('append');
  const rounds = f.coordinator.getRounds(id);
  assert.equal(rounds.length, 2);
  assert.equal(rounds[1].draft, '外部 AI 新稿');
  assert.deepEqual(rounds[1].preferences, [{ preference: '少用套话', example: '直接讲事实', counterexample: '值得注意的是' }]);
  assert.equal(f.state.writingMemories.length, 0);
});

test('写作记忆可限定到当前项目并在界面明确显示范围', async () => {
  const f = fixture();
  const id = await create(f, '项目记忆范围');
  assert.match(f.mount.innerHTML, /仅当前项目/);
  await f.change('writing-memory-scope', 'project');
  await f.input('writing-preference', '本项目统一使用守门人称谓');
  await f.click('remember');
  const memory = f.state.writingMemories[0];
  assert.equal(memory.scope, 'project');
  assert.equal(memory.projectId, id);
  assert.ok(f.coordinator.getRelevantMemories('article', id).some(item => item.id === memory.id));
});

test('切篇、回看只读轮次及重复渲染保留各篇未提交输入', async () => {
  const f = fixture();
  const a = await create(f);
  await f.input('writing-new-draft', '甲未提交');
  await f.input('writing-feedback', '甲反馈');
  await f.click('new');
  const b = await create(f, '文章乙', '乙原文');
  await f.input('writing-new-draft', '乙未提交');
  await f.change('writing-article-list', a);
  assert.equal(f.node('writing-new-draft').value, '甲未提交');
  const round = f.coordinator.getRounds(a)[0];
  await f.click('round', { roundId: round.id });
  assert.equal(f.node('writing-history-draft').readOnly, true);
  assert.equal(f.node('writing-history-draft').value, round.draft);
  f.ui.render();
  assert.equal(f.node('writing-feedback').value, '甲反馈');
  await f.change('writing-article-list', b);
  assert.equal(f.node('writing-new-draft').value, '乙未提交');
});

test('真实工作台可保存和复制提示词版本、关联带回稿、比较历史并从旧轮继续', async () => {
  const f = fixture();
  const id = await create(f, '版本与分支验收', '第一轮稿');
  await f.change('writing-save', true);
  const first = f.coordinator.getRounds(id)[0];

  await f.input('writing-prompt', '用户编辑的第一版提示词');
  await f.click('save-prompt-version');
  await f.input('writing-prompt', '用户确认复制的第二版提示词');
  await f.click('copy-prompt');
  const versions = f.coordinator.readRound(id, first.id).promptVersions;
  const saved = versions.at(-2);
  const copied = versions.at(-1);
  assert.equal(saved.content, '用户编辑的第一版提示词');
  assert.equal(saved.copied, false);
  assert.equal(copied.content, '用户确认复制的第二版提示词');
  assert.equal(copied.copied, true);
  assert.equal(copied.parentVersionId, saved.id);

  await f.input('writing-new-draft', '第二轮结果');
  await f.change('writing-source-prompt-version', copied.id);
  await f.click('append');
  assert.equal(f.coordinator.getRounds(id)[1].sourcePromptVersionId, copied.id);
  await f.input('writing-new-draft', '第三轮结果');
  await f.click('append');

  await f.click('round', { roundId: first.id });
  await f.change('writing-history-compare', f.coordinator.getRounds(id)[2].id);
  assert.match(f.mount.innerHTML, /writing-history-comparison/);
  assert.match(f.mount.innerHTML, /第一轮稿/);
  assert.match(f.mount.innerHTML, /第三轮结果/);

  await f.click('continue-from-round', { roundId: first.id });
  const rounds = f.coordinator.getRounds(id);
  assert.equal(rounds.length, 4);
  assert.equal(rounds[1].draft, '第二轮结果');
  assert.equal(rounds[2].draft, '第三轮结果');
  assert.equal(rounds[3].draft, '第一轮稿');
  assert.equal(rounds[3].parentRoundId, first.id);
  assert.equal(rounds[3].restoredFromRoundId, first.id);
});

test('接近历史提醒阈值时提示导出且导出完整本轮提示词版本', async () => {
  let downloaded;
  const f = fixture({ downloadText: (filename, content) => { downloaded = { filename, content }; } });
  const id = await create(f, '提示词历史导出', '第一轮稿');
  const round = f.coordinator.getRounds(id)[0];
  for (let index = 0; index < 79; index++) {
    await f.coordinator.recordPromptVersion(id, round.id, `历史提示词${index}`);
  }
  f.ui.render();
  assert.match(f.mount.innerHTML, /历史已接近100条/);
  await f.click('export-prompt-history');
  const exported = JSON.parse(downloaded.content);
  assert.match(downloaded.filename, /writing-prompt-history/);
  assert.equal(exported.promptVersions.length, 80);
  assert.equal(exported.promptVersions[0].content, round.prompt);
  assert.equal(exported.promptVersions.at(-1).content, '历史提示词78');
  assert.match(f.mount.innerHTML, /已导出本轮80条提示词版本/);
});

test('未写入当前轮次的新材料不提供立即应用范围操作', async () => {
  const f = fixture();
  await create(f, '延迟加入材料', '全文原稿');
  await f.click('add-material');
  await f.input('writing-material-0-title', '稍后进入轮次的材料');
  await f.input('writing-material-0-excerpt', '仅在下一轮保存的内容');
  await f.input('writing-unit-title', '第一章');
  await f.click('add-unit');

  const applyButtons = f.mount.querySelectorAll('[data-writing-action="apply-material-units"]');
  assert.equal(applyButtons.length, 1);
  assert.equal(applyButtons[0].disabled, true);
});

test('真实工作台可创建任务单元、关联材料并让选中单元约束下一轮提示词', async () => {
  const f = fixture();
  await f.click('add-material');
  await f.input('writing-material-0-title', '第一章材料');
  await f.input('writing-material-0-excerpt', '第一章证据哨兵');
  await f.click('add-material');
  await f.input('writing-material-1-title', '第二章材料');
  await f.input('writing-material-1-excerpt', '第二章排除哨兵');
  const id = await create(f, '单元和材料范围', '全文原稿');

  await f.input('writing-unit-title', '第一章');
  await f.input('writing-unit-goal', '解释第一章目标');
  await f.input('writing-unit-criteria', '第一章完成标准');
  await f.click('add-unit');
  await f.input('writing-unit-title', '第二章');
  await f.input('writing-unit-goal', '解释第二章目标');
  await f.click('add-unit');
  const units = f.coordinator.getWorkspace(id).units;
  await f.change(`writing-material-0-unit-${units[0].id}`, true);
  await f.click('apply-material-units', { index: '0' });
  await f.change(`writing-material-1-unit-${units[1].id}`, true);
  await f.click('apply-material-units', { index: '1' });
  await f.change('writing-unit-selection', units[0].id);
  await f.input('writing-new-draft', '第一章具体稿件');
  await f.click('append');

  const round = f.coordinator.getRounds(id).at(-1);
  assert.equal(round.unitId, units[0].id);
  assert.equal(round.unitSnapshot.goal, '解释第一章目标');
  assert.match(round.prompt, /第一章证据哨兵/);
  assert.doesNotMatch(round.prompt, /第二章排除哨兵/);
  assert.match(round.prompt, /未采用/);
});

test('长篇连续性表单可新增并编辑单元摘要和前后序单元 ID', async () => {
  const f = createWritingApp();
  await f.settle();
  await f.change('writing-genre', 'fiction');
  await f.input('writing-title', '单元连续性资料');
  await f.click('create');
  await f.settle();
  const articleId = f.coordinator.listArticles()[0].id;

  for (const id of ['writing-unit-summary', 'writing-unit-prior-unit-ids', 'writing-unit-next-unit-ids']) {
    assert.ok(f.node(id), `新增单元表单应显示 ${id}`);
  }
  await f.input('writing-unit-title', '第二章');
  await f.input('writing-unit-summary', '新增时填写的用户摘要');
  await f.input('writing-unit-prior-unit-ids', 'chapter-1, chapter-0');
  await f.input('writing-unit-next-unit-ids', 'chapter-3');
  await f.click('add-unit');
  await f.settle();

  let unit = f.coordinator.getWorkspace(articleId).units[0];
  assert.equal(unit.summary, '新增时填写的用户摘要');
  assert.deepEqual(unit.priorUnitIds, ['chapter-1', 'chapter-0']);
  assert.deepEqual(unit.nextUnitIds, ['chapter-3']);
  for (const suffix of ['summary', 'priorUnitIds', 'nextUnitIds']) {
    assert.ok(f.node(`writing-unit-${unit.id}-${suffix}`), `已有单元编辑表单应显示 ${suffix}`);
  }

  await f.input(`writing-unit-${unit.id}-summary`, '编辑后的用户摘要');
  await f.input(`writing-unit-${unit.id}-priorUnitIds`, 'chapter-0');
  await f.input(`writing-unit-${unit.id}-nextUnitIds`, 'chapter-4, chapter-5');
  await f.click('update-unit', { unitId: unit.id });
  await f.settle();

  unit = f.coordinator.getWorkspace(articleId).units[0];
  assert.equal(unit.summary, '编辑后的用户摘要');
  assert.deepEqual(unit.priorUnitIds, ['chapter-0']);
  assert.deepEqual(unit.nextUnitIds, ['chapter-4', 'chapter-5']);
});

test('真实工作台允许手动录入问题并在新轮后显式复核', async () => {
  const f = fixture();
  const id = await create(f, '问题复核', '原稿中存在待核对结论');
  await f.input('writing-issue-excerpt', '样本只覆盖两人');
  await f.input('writing-issue-observation', '结论写成普遍规律');
  await f.input('writing-issue-impact', '证据范围小于结论范围');
  await f.input('writing-issue-evidence', '核对研究方法');
  await f.input('writing-issue-suggestion', '收窄结论并补充依据');
  await f.click('add-issue');
  const issue = f.coordinator.getWorkspace(id).issues[0];
  assert.equal(issue.status, 'pending-user');
  assert.equal(issue.judgment, 'candidate');
  assert.equal(issue.promptVersionId, f.coordinator.getRounds(id)[0].promptVersions.at(-1).id);

  await f.input('writing-new-draft', '补充了样本范围和来源的新稿');
  await f.click('append');
  const nextRound = f.coordinator.getRounds(id).at(-1);
  await f.change(`writing-issue-${issue.id}-status`, 'review-passed');
  await f.change(`writing-issue-${issue.id}-review-round`, nextRound.id);
  assert.equal(f.node(`writing-issue-${issue.id}-status`).value, 'review-passed');
  assert.equal(f.node(`writing-issue-${issue.id}-review-round`).value, nextRound.id);
  await f.input(`writing-issue-${issue.id}-reason`, '新稿已补充可定位来源');
  await f.click('update-issue', { issueId: issue.id });
  const reviewed = f.coordinator.getWorkspace(id).issues[0];
  assert.equal(reviewed.status, 'review-passed', f.mount.innerHTML.match(/id="writing-error"[^>]*>([^<]*)</)?.[1] || '状态未写入');
  assert.equal(reviewed.roundId, issue.roundId);
  assert.equal(reviewed.reviewedRoundId, nextRound.id, f.mount.innerHTML.match(/id="writing-error"[^>]*>([^<]*)</)?.[1] || '复核轮次未写入');
  assert.equal(reviewed.status, 'review-passed');
  assert.equal(reviewed.statusReason, '新稿已补充可定位来源');
});

test('手动新增问题可关联结果实际使用的上一轮提示词版本', async () => {
  const f = fixture();
  const id = await create(f, '跨轮提示词问题关联', '待检查稿件');
  const sourcePromptVersionId = f.coordinator.getRounds(id)[0].promptVersions.at(-1).id;
  await f.change('writing-source-prompt-version', sourcePromptVersionId);
  await f.input('writing-new-draft', '由第一轮提示词生成的模拟结果');
  await f.click('append');

  const resultRound = f.coordinator.getRounds(id).at(-1);
  assert.equal(resultRound.sourcePromptVersionId, sourcePromptVersionId);
  await f.input('writing-issue-excerpt', '待核查摘录');
  await f.input('writing-issue-observation', '当前结果缺少对应来源');
  await f.input('writing-issue-impact', '结论可能超出可见证据');
  await f.input('writing-issue-evidence', '只使用合成验收输入');
  await f.click('add-issue');

  const issue = f.coordinator.getWorkspace(id).issues[0];
  assert.equal(issue.roundId, resultRound.id);
  assert.equal(issue.promptVersionId, sourcePromptVersionId);
});

test('真实工作台显示来源路线并支持受阻退回、重做和显式完成', async () => {
  const pack = {
    id: 'ui-route-pack', name: '界面路线包', layer: 'task', genre: 'article', taskType: 'revision', version: 3,
    enabled: true, checks: [], sources: [{ id: 'route-source', title: '方法来源', verificationStatus: 'source-reviewed' }],
    routes: [{ id: 'ui-route', title: '材料核对', taskTypes: ['revision'], sourceIds: ['route-source'], verificationStatus: 'source-reviewed', stages: [
      { id: 'gather', title: '补充材料', inputs: ['原文'], outputs: ['材料记录'], checks: ['来源可定位'], sourceIds: ['route-source'], verificationStatus: 'source-reviewed', skippable: false, returnWhenMissing: [] },
      { id: 'assess', title: '评估材料', inputs: ['材料记录'], outputs: ['评估结论'], checks: ['结论可追溯'], sourceIds: ['route-source'], verificationStatus: 'source-reviewed', skippable: false, returnWhenMissing: ['补充材料后重做'] }
    ] }]
  };
  const f = fixture({ writingPacks: [pack] });
  await f.change('writing-pack-selection-ui-route-pack', true);
  const id = await create(f, '路线界面', '待核对稿件');
  await f.click('select-writing-route', { routeId: 'ui-route', packId: pack.id });
  assert.equal(f.document.activeElement?.id, 'writing-route-start-gather');
  assert.match(f.mount.innerHTML, /当前建议：开始当前步骤/);
  assert.match(f.mount.innerHTML, /优先理由：这是路线中当前首个未完成步骤/);
  await f.click('route-start', { stageId: 'gather' });
  assert.equal(f.document.activeElement?.id, 'writing-route-result');
  assert.ok(f.mount.innerHTML.indexOf('id="writing-route-result"') < f.mount.innerHTML.indexOf('id="writing-route-evidence"'));
  assert.ok(f.mount.innerHTML.indexOf('id="writing-route-evidence"') < f.mount.innerHTML.indexOf('id="writing-route-complete-gather"'));
  await f.input('writing-route-result', '材料记录已整理');
  await f.input('writing-route-evidence', '内部材料表');
  await f.click('route-complete', { stageId: 'gather' });
  assert.equal(f.document.activeElement?.id, 'writing-route-start-assess');
  await f.click('route-start', { stageId: 'assess' });
  await f.input('writing-route-block-reason', '缺少一份来源');
  await f.change('writing-route-return', 'gather');
  await f.click('route-block', { stageId: 'assess' });

  assert.equal(f.coordinator.getWorkspace(id).routeProgress.currentStageId, 'gather');
  await f.click('route-start', { stageId: 'gather' });
  await f.input('writing-route-result', '补充来源后的材料记录');
  await f.input('writing-route-evidence', '新增来源定位');
  await f.click('route-complete', { stageId: 'gather' });
  await f.click('route-start', { stageId: 'assess' });
  await f.input('writing-route-result', '结论已回链到来源');
  await f.input('writing-route-evidence', '来源核验记录');
  await f.click('route-complete', { stageId: 'assess' });

  const route = f.coordinator.getWorkspace(id).routeProgress;
  assert.equal(route.stages[0].status, 'user-confirmed-complete');
  assert.equal(route.stages[1].status, 'user-confirmed-complete');
  assert.equal(route.stages[1].verificationStatus, 'source-reviewed');
  assert.equal(route.stages[1].evidence, '来源核验记录');
  assert.match(f.coordinator.getRounds(id).at(-1).prompt, /材料核对/);
});

test('保存失败不误报，暂停后旧历史冻结，删除取消保留整篇', async () => {
  let confirmed = false;
  const f = fixture({ confirm: () => confirmed });
  const id = await create(f);
  f.failSave = true;
  await f.change('writing-save', true);
  assert.equal(f.state.writingArticles.length, 0);
  assert.match(f.mount.innerHTML, /磁盘已满/);
  assert.match(f.mount.innerHTML, /0\/1/);
  f.failSave = false;
  await f.change('writing-save', true);
  assert.equal(f.state.writingArticles[0].rounds.length, 1);
  await f.change('writing-save', false);
  await f.input('writing-new-draft', '仅会话新稿');
  await f.click('append');
  assert.equal(f.state.writingArticles[0].rounds.length, 1);
  assert.equal(f.coordinator.getRounds(id).length, 2);
  assert.match(f.mount.innerHTML, /1\/2/);
  await f.click('delete-article');
  assert.equal(f.coordinator.listArticles().length, 1);
  confirmed = true;
  await f.click('delete-article');
  assert.equal(f.coordinator.listArticles().length, 0);
  assert.equal(f.state.writingArticles.length, 0);
});

test('材料共三份、用途可选，风格原文不进提示词，本地选择复用协调器', async () => {
  const f = fixture();
  await f.click('add-material');
  await f.input('writing-material-0-title', '风格样本');
  await f.input('writing-material-0-excerpt', '样本独有观点绝不进入提示词。短句。');
  await f.change('writing-material-0-purpose', 'style');
  const id = await create(f);
  assert.doesNotMatch(f.node('writing-prompt').value, /样本独有观点/);
  assert.match(f.mount.innerHTML, /句长|段落密度/);
  await f.input('writing-style-corrections', '保留短句，避免夸张');
  await f.click('correct-style');
  assert.match(f.coordinator.getWorkspace(id).styleProfile.userCorrections, /保留短句/);
  await f.click('select-materials');
  assert.equal(f.coordinator.getRounds(id)[0].sources.length, 1);
  await f.click('add-material');
  assert.equal(f.mount.querySelectorAll('[data-material-purpose]').length, 3);
});

test('编辑复制提示词，模型失败保留诊断和输入，迟到结果不串篇', async () => {
  let rejectModel;
  const f = fixture({ requestModel: () => new Promise((_, reject) => { rejectModel = reject; }) });
  const a = await create(f);
  await f.input('writing-prompt', '我的编辑提示词');
  await f.click('copy-prompt');
  assert.deepEqual(f.copied, ['我的编辑提示词']);
  const diagnosis = f.node('writing-diagnosis').value;
  const running = f.click('model');
  await new Promise(resolve => setImmediate(resolve));
  await f.input('writing-feedback', '请求中继续输入');
  await f.click('new');
  await create(f, '乙');
  rejectModel(new Error('模型不可用'));
  await running;
  assert.equal(f.node('writing-title').value, '乙');
  await f.change('writing-article-list', a);
  assert.equal(f.node('writing-diagnosis').value, diagnosis);
  assert.equal(f.node('writing-feedback').value, '请求中继续输入');
  assert.match(f.mount.innerHTML, /模型不可用/);
});

test('应用真实接线：写作入口独立呈现且保留任务草稿', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  assert.ok(f.coordinator, '应用需要实际创建写作协调器');
  await f.event('nav-article');
  assert.notEqual(f.mount.hidden, true);
  assert.match(f.element('breadcrumb').textContent, /写作工作台/);
  await f.input('writing-goal', '切场景不丢失');
  await f.event('scene-ppt');
  assert.equal(f.element('ppt-scene-root').hidden, false);
  await f.event('scene-task');
  assert.equal(f.node('writing-goal').value, '切场景不丢失');
  await f.event('nav-prompt-agent');
  assert.match(f.element('breadcrumb').textContent, /提示词 Agent/);
});

test('应用真实发送预览确认前零请求，取消保留原诊断，确认才外发', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  await f.settle();
  await create(f);
  const before = f.node('writing-diagnosis').value;
  let running = f.click('model');
  await f.settle();
  assert.equal(f.requests, 0);
  assert.equal(f.element('send-preview').hidden, false);
  await f.event('send-preview-cancel');
  await running;
  assert.equal(f.node('writing-diagnosis').value, before);
  running = f.click('model');
  await f.settle();
  await f.event('send-preview-confirm');
  await running;
  assert.equal(f.requests, 1);
  assert.match(f.node('writing-diagnosis').value, /真实预览确认后/);
});

test('失败创建和失败回带可通过精简新稿恢复，完整失败原文仍在会话', async () => {
  const f = fixture();
  const original = '原'.repeat(8001);
  await create(f, '失败原稿', original);
  const id = f.coordinator.listArticles()[0].id;
  assert.match(f.mount.innerHTML, /超过8000/);
  assert.match(f.mount.innerHTML, /原稿和材料已保留/);
  assert.match(f.mount.innerHTML, /正文8001字/);
  assert.match(f.mount.innerHTML, /适用材料摘录共0字/);
  assert.match(f.mount.innerHTML, /逐单元生成/);
  assert.match(f.mount.innerHTML, /未纳入内容不会被标记为已阅读或已审核/);
  assert.equal(f.coordinator.getRounds(id)[0].draft, original);
  await f.input('writing-new-draft', '精简可用稿');
  await f.click('append');
  assert.equal(f.coordinator.getRounds(id).length, 2);
  assert.equal(f.coordinator.getRounds(id)[1].draft, '精简可用稿');
  await f.input('writing-new-draft', '新'.repeat(8001));
  await f.click('append');
  await f.input('writing-new-draft', '再次恢复');
  await f.click('append');
  assert.equal(f.coordinator.getRounds(id).at(-1).draft, '再次恢复');
  await f.change('writing-save', true);
  assert.equal(f.state.writingArticles[0].rounds.length, 2);
  assert.equal(f.coordinator.getRounds(id).length, 4);
  assert.match(f.mount.innerHTML, /2\/4/);
});

test('显式记忆管理覆盖全部而非相关三条，编辑例句反例、删除和自动晋升撤销', async () => {
  const f = fixture();
  await create(f);
  for (let i = 0; i < 5; i++) {
    await f.input('writing-preference', `偏好${i}`);
    await f.change('writing-memory-scope', ['general', 'genre', 'article'][i % 3]);
    await f.click('remember');
  }
  assert.equal(f.state.writingMemories.length, 5);
  const m = f.state.writingMemories[0];
  await f.click('manage-memories');
  assert.equal(f.mount.querySelectorAll('[data-memory-field="preference"]').length, 5);
  await f.input(`writing-memory-${m.id}-preference`, '修改后的偏好');
  await f.input(`writing-memory-${m.id}-example`, '例句');
  await f.input(`writing-memory-${m.id}-counterexample`, '反例');
  await f.click('edit-memory', { memoryId: m.id });
  assert.equal(f.state.writingMemories.find(x => x.id === m.id).example, '例句');
  await f.click('delete-memory', { memoryId: m.id });
  assert.ok(f.state.writingMemories.find(x => x.id === m.id).undo.undoneAt);
  assert.equal(f.mount.querySelectorAll('[data-memory-field="preference"]').length, 4);
  await f.input('writing-preference', '跨篇相同候选');
  await f.click('append');
  await f.click('new');
  await create(f, '第二篇');
  await f.input('writing-preference', '跨篇相同候选');
  await f.click('append');
  const promoted = f.state.writingMemories.find(x => x.preference === '跨篇相同候选');
  assert.ok(promoted);
  assert.match(f.mount.innerHTML, /跨文章重复偏好/);
  await f.click('undo-memory', { memoryId: promoted.id });
  assert.ok(f.state.writingMemories.find(x => x.id === promoted.id).undo.undoneAt);
});

test('未知文体明确确认，动态内容转义，危险URL不生成链接', async () => {
  let allow = false;
  const f = fixture({ confirm: () => allow });
  await f.input('writing-genre', 'novel');
  await create(f, '<img src=x onerror=alert(1)>');
  assert.equal(f.coordinator.listArticles().length, 0);
  allow = true;
  const id = await create(f, '<img src=x onerror=alert(1)>');
  assert.equal(f.coordinator.getWorkspace(id).genre, 'article');
  assert.doesNotMatch(f.mount.innerHTML, /<img src=x/);
  assert.match(f.mount.innerHTML, /&lt;img/);
  await f.coordinator.appendRound(id, { draft: '正文', sources: [{ title: '危险来源', url: 'javascript:alert(1)', purpose: 'content', excerpt: '<svg onload=alert(1)>' }] });
  const fresh = createWritingDOM();
  const ui = createWritingWorkbenchUI({ document: fresh.document, coordinator: f.coordinator, getState: () => f.state });
  ui.openArticle(id);
  assert.match(fresh.mount.innerHTML, /危险来源/);
  assert.doesNotMatch(fresh.mount.innerHTML, /href="javascript:|<svg onload/);
  assert.match(fresh.mount.innerHTML, /&lt;svg/);
});

test('应用保存尊重读取阻断，写失败不替换真实state', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const blocked = createWritingApp({ readBlocked: true });
  await create(blocked);
  await blocked.change('writing-save', true);
  assert.equal(blocked.writes, 0);
  assert.match(blocked.mount.innerHTML, /已暂停保存/);
  const f = createWritingApp();
  await create(f);
  const before = f.state;
  f.failSave = true;
  await f.change('writing-save', true);
  assert.equal(f.state, before);
  assert.match(f.mount.innerHTML, /磁盘已满/);
});

test('完整备份恢复暂停保存历史且刷新协调器，资料库导入保留会话', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const backupAPI = require('../prototype/workspace-backup.js');
  const f = createWritingApp();
  await create(f, '会话草稿');
  const sessionId = f.coordinator.listArticles()[0].id;
  await f.input('writing-feedback', '尚未提交反馈');
  await f.import(backupAPI.createBackup(storage.createEmptyState(), { scope: 'knowledge-base' }));
  assert.equal(f.coordinator.getWorkspace(sessionId).article.title, '会话草稿');
  assert.equal(f.node('writing-feedback').value, '尚未提交反馈');
  const source = fixture();
  const savedId = await create(source, '导入暂停历史');
  await source.change('writing-save', true);
  await source.change('writing-save', false);
  await f.import(backupAPI.createBackup(source.state, { scope: 'workspace' }));
  assert.equal(f.state.writingArticles[0].article.saveEnabled, false);
  assert.equal(f.state.writingArticles[0].rounds.length, 1);
  assert.equal(f.coordinator.listArticles().length, 1);
  assert.equal(f.coordinator.getWorkspace(savedId).article.title, '导入暂停历史');
});

test('模型异步成功绑定发起篇，等待中仍可复制，过期错误保留输入和诊断', async () => {
  let resolveModel;
  const f = fixture({ requestModel: () => new Promise(resolve => { resolveModel = resolve; }) });
  const a = await create(f);
  const running = f.click('model');
  await new Promise(resolve => setImmediate(resolve));
  await f.input('writing-prompt', '等待时编辑的提示词');
  await f.click('copy-prompt');
  assert.deepEqual(f.copied, ['等待时编辑的提示词']);
  await f.click('new');
  await create(f, '乙篇');
  resolveModel('甲篇模型结果');
  await running;
  assert.equal(f.node('writing-title').value, '乙篇');
  assert.doesNotMatch(f.node('writing-diagnosis').value, /甲篇模型结果/);
  await f.change('writing-article-list', a);
  assert.match(f.node('writing-diagnosis').value, /甲篇模型结果/);
  assert.equal(f.node('writing-prompt').value, '等待时编辑的提示词');
  const old = f.node('writing-diagnosis').value;
  const stale = f.click('model');
  await new Promise(resolve => setImmediate(resolve));
  await f.input('writing-feedback', '过期也要保留');
  await f.coordinator.correctStyleProfile(a, '新风格要求');
  resolveModel('过期内容');
  await stale;
  assert.equal(f.node('writing-feedback').value, '过期也要保留');
  assert.equal(f.node('writing-diagnosis').value, old);
  assert.match(f.mount.innerHTML, /过期/);
});

test('中文状态可读且选择维度真的控制初检', async () => {
  const f = fixture();
  await f.change('writing-dimension-3', true);
  await create(f);
  assert.match(f.node('writing-diagnosis').value, /语言表达/);
  assert.doesNotMatch(f.node('writing-diagnosis').value, /事实依据：/);
  assert.match(f.mount.innerHTML, /来源：临时判断 · 把握度：低/);
  assert.equal(f.node('writing-genre').value, '普通文章');
});

test('初始首页面包屑不被隐藏Agent场景初始化覆盖', () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  assert.doesNotMatch(f.element('breadcrumb').textContent, /提示词 Agent/);
});

test('同ID备份替换后显示恢复轮次和保存开关，仍保留未提交的新稿反馈', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const backupAPI = require('../prototype/workspace-backup.js');
  const f = createWritingApp();
  const id = await create(f);
  await f.change('writing-save', true);
  await f.input('writing-new-draft', '未提交新稿');
  await f.input('writing-feedback', '未提交反馈');
  const restored = JSON.parse(JSON.stringify(f.state));
  restored.writingArticles[0].article.saveEnabled = false;
  restored.writingArticles[0].article.draft = '导入稿';
  restored.writingArticles[0].rounds[0].draft = '导入稿';
  restored.writingArticles[0].rounds[0].diagnosis = '导入诊断';
  await f.import(backupAPI.createBackup(restored, { scope: 'workspace' }));
  assert.equal(f.coordinator.getWorkspace(id).rounds[0].draft, '导入稿');
  assert.equal(f.node('writing-draft').value, '导入稿');
  assert.equal(f.node('writing-save').checked, false);
  assert.equal(f.node('writing-new-draft').value, '未提交新稿');
  assert.equal(f.node('writing-feedback').value, '未提交反馈');
});

test('第二篇新建首轮触发候选晋升也显示通知，并可立即撤销', async () => {
  const f = fixture();
  await f.input('writing-preference', '结尾写具体结果');
  const a = await create(f);
  await f.click('new');
  await f.input('writing-preference', '结尾写具体结果');
  const b = await create(f, '第二篇');
  const memory = f.state.writingMemories.find(m => m.preference === '结尾写具体结果');
  assert.deepEqual(new Set(memory.evidenceArticleIds), new Set([a, b]));
  assert.match(f.mount.innerHTML, /跨文章重复偏好/);
  await f.click('undo-memory', { memoryId: memory.id });
  assert.ok(f.state.writingMemories.find(m => m.id === memory.id).undo.undoneAt);
});

test('导入预览显示真实文章记忆数量，写失败和校验失败均保留原state及会话', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const backupAPI = require('../prototype/workspace-backup.js');
  const previews = [];
  const f = createWritingApp({ confirm(message) { previews.push(message); return true; } });
  const id = await create(f);
  await f.change('writing-save', true);
  await f.input('writing-preference', '保存偏好');
  await f.click('remember');
  await f.input('writing-new-draft', '导入失败不丢稿');
  const backup = backupAPI.createBackup(f.state, { scope: 'workspace' });
  const before = f.state;
  f.failSave = true;
  await f.import(backup);
  assert.equal(f.state, before);
  assert.equal(f.coordinator.getWorkspace(id).article.title, '文章甲');
  assert.equal(f.node('writing-new-draft').value, '导入失败不丢稿');
  assert.match(previews.at(-1), /1 篇文章、1 条写作记忆/);
  f.failSave = false;
  const writes = f.writes;
  await f.import({ ...backup, counts: { ...backup.counts, writingArticles: 50 } });
  assert.equal(f.writes, writes);
  assert.equal(f.state, before);
});

test('整篇删除写失败保留全部轮次和未提交输入', async () => {
  const f = fixture();
  const id = await create(f);
  await f.change('writing-save', true);
  await f.input('writing-feedback', '等待中的反馈');
  f.failSave = true;
  await f.click('delete-article');
  assert.equal(f.coordinator.getRounds(id).length, 1);
  assert.equal(f.state.writingArticles.length, 1);
  assert.equal(f.node('writing-feedback').value, '等待中的反馈');
  assert.match(f.mount.innerHTML, /磁盘已满/);
});

test('导出按钮真实事件支持完整工作区和仅资料库，范围决定文章记忆是否包含', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  await create(f);
  await f.change('writing-save', true);
  await f.input('writing-preference', '结尾写具体结果');
  await f.click('remember');
  assert.ok(f.listeners.has('knowledge-export-open:click'), '导出按钮必须绑定真实事件');
  f.element('knowledge-export-scope').value = 'workspace';
  await f.event('knowledge-export-open');
  const workspace = f.exports.at(-1);
  assert.equal(workspace.scope, 'workspace');
  assert.equal(workspace.data.writingArticles.length, 1);
  assert.equal(workspace.data.writingMemories.length, 1);
  assert.match(f.element('knowledge-backup-status').textContent, /工作区/);
  f.element('knowledge-export-scope').value = 'knowledge-base';
  await f.event('knowledge-export-open');
  const knowledge = f.exports.at(-1);
  assert.equal(knowledge.scope, 'knowledge-base');
  assert.equal(Object.hasOwn(knowledge.data, 'writingArticles'), false);
  assert.equal(Object.hasOwn(knowledge.data, 'writingMemories'), false);
  assert.match(f.element('knowledge-backup-status').textContent, /资料库/);
  assert.equal(f.exports.length, 2);
});

test('导出API取消或失败保留原备份时间且不能报告成功', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  let result = { canceled: true };
  const f = createWritingApp({ exportBackup() { if (result instanceof Error) throw result; return result; } });
  assert.ok(f.listeners.has('knowledge-export-open:click'), '导出按钮必须绑定真实事件');
  f.element('knowledge-export-scope').value = 'workspace';
  f.element('knowledge-backup-status').textContent = '最近备份：原时间';
  await f.event('knowledge-export-open');
  assert.equal(f.element('knowledge-backup-status').textContent, '最近备份：原时间');
  assert.match(f.element('toast').textContent, /取消/);
  assert.doesNotMatch(f.element('toast').textContent, /已导出/);
  result = new Error('目标目录不可写');
  await f.event('knowledge-export-open');
  assert.equal(f.element('knowledge-backup-status').textContent, '最近备份：原时间');
  assert.match(f.element('toast').textContent, /导出失败.*目标目录不可写/);
});

test('浏览器安全备份确认后可导入一次，令牌不得重复消费或重放', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const backupAPI = require('../prototype/workspace-backup.js');
  const source = fixture();
  await create(source, '浏览器恢复历史');
  await source.change('writing-save', true);
  await source.change('writing-save', false);
  const raw = JSON.stringify(backupAPI.createBackup(source.state, { scope: 'workspace' }));
  const confirmations = [];
  const f = createWritingApp({ browser: true, confirm(message) { confirmations.push(message); return true; } });
  await f.event('knowledge-import-open');
  assert.deepEqual(f.clicks, ['created', 'knowledge-import-file']);
  assert.match(confirmations[0], /确认.*保存安全备份/);
  let reads = 0;
  const file = { text: async () => { reads++; return raw; } };
  const input = { files: [file], value: 'backup.json' };
  await f.event('knowledge-import-file', 'change', { target: input });
  assert.equal(f.state.writingArticles.length, 1, '确认安全备份后应允许真实浏览器分支写入');
  assert.equal(f.state.writingArticles[0].article.saveEnabled, false);
  assert.equal(input.value, '');
  assert.equal(reads, 1);
  assert.match(f.element('toast').textContent, /导入成功/);
  const writes = f.writes;
  await f.event('knowledge-import-file', 'change', { target: input });
  assert.equal(f.writes, writes);
  assert.equal(reads, 1, '已消费的令牌不得再次读取或导入文件');
  assert.match(f.element('toast').textContent, /未确认已保存安全备份/);
});

test('浏览器未确认安全备份时不能打开选择器或读取导入文件', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp({ browser: true, confirm: () => false });
  await f.event('knowledge-import-open');
  assert.deepEqual(f.clicks, ['created']);
  let reads = 0;
  await f.event('knowledge-import-file', 'change', { target: { files: [{ text: async () => { reads++; return '{}'; } }], value: 'backup.json' } });
  assert.equal(reads, 0);
  assert.equal(f.writes, 0);
  assert.match(f.element('toast').textContent, /未确认已保存安全备份/);
});

test('真实页面资料表单和字段ID唯一，资料类型具有可选默认值', () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  assert.match(f.mount.innerHTML, /id="writing-material-files" type="file" aria-label="导入写作参考材料"/);
  const ids = [...f.pageHTML.matchAll(/\bid="(knowledge-entry-[^"]+)"/g)].map(match => match[1]);
  assert.equal(f.knowledgeForms.length, 1, '必须只有一个可操作的资料表单');
  assert.equal(new Set(ids).size, ids.length, '资料字段ID不得重复');
  assert.equal(f.element('knowledge-entry-type').value, 'manual-note', '首个表单必须有真实可选类型');
});

test('两种资料打开取消入口共用表单，保存手工资料后写作可选入本篇', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp({ realMaterials: true });
  for (const [open, cancel] of [['open-knowledge-entry', 'cancel-knowledge-entry'], ['knowledge-add-open', 'knowledge-entry-cancel']]) {
    await f.event(open);
    assert.equal(f.element('knowledge-entry-form').hidden, false);
    await f.event(cancel);
    assert.equal(f.element('knowledge-entry-form').hidden, true);
  }
  await f.event('knowledge-add-open');
  assert.equal(f.element('knowledge-entry-type').value, 'manual-note', '应沿用真实HTML中的默认类型');
  f.element('knowledge-entry-title').value = '产品交付事实';
  f.element('knowledge-entry-summary').value = '产品交付事实：三个客户已完成试用';
  f.element('knowledge-entry-domains').value = '普通文章';
  await f.event('knowledge-entry-form', 'submit');
  assert.equal(f.state.knowledgeEntries.length, 1, '一次提交只能新增一条资料');
  assert.equal(f.state.knowledgeEntries[0].type, 'manual-note');
  assert.equal(f.state.knowledgeEntries[0].verificationStatus, 'unverified');
  assert.equal(f.element('knowledge-entry-form').hidden, true);
  await create(f);
  await f.input('writing-goal', '产品交付事实');
  await f.click('update');
  await f.click('select-materials');
  const workspace = f.coordinator.getWorkspace(f.coordinator.listArticles()[0].id);
  assert.ok(workspace.rounds[0].sources.some(source => source.title.includes('产品交付事实') && source.excerpt.includes('三个客户已完成试用')));
  assert.match(f.node('writing-prompt').value, /三个客户已完成试用/);
  assert.equal(f.requests, 0);
});

test('完整工作区合并空备份及新增文章保留未保存会话和未提交输入', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const backupAPI = require('../prototype/workspace-backup.js');
  const f = createWritingApp({ confirm: () => false });
  const id = await create(f, '只有会话的文章');
  await f.input('writing-new-draft', '未提交新稿');
  await f.input('writing-feedback', '未提交反馈');
  const diagnosis = f.node('writing-diagnosis').value;
  const source = fixture();
  const importedId = await create(source, '备份文章');
  await source.change('writing-save', true);
  for (const state of [storage.createEmptyState(), source.state]) {
    await f.import(backupAPI.createBackup(state, { scope: 'workspace' }));
    assert.match(f.element('toast').textContent, /导入成功/);
    assert.ok(f.coordinator.listArticles().some(a => a.id === id), '合并不得丢弃仅存在会话的文章');
    assert.equal(f.node('writing-article-list').value, id);
    assert.equal(f.node('writing-new-draft').value, '未提交新稿');
    assert.equal(f.node('writing-feedback').value, '未提交反馈');
    assert.equal(f.node('writing-diagnosis').value, diagnosis);
    assert.ok(!f.state.writingArticles.some(w => w.id === id), '保留会话不代表偷偷持久化');
  }
  assert.equal(f.coordinator.getWorkspace(importedId).article.title, '备份文章');
});

test('普通文本文件进入本轮提示词并明确标记截取范围', async () => {
  const f = fixture();
  await f.change('writing-material-files', [{
    name: '访谈记录.txt', type: 'text/plain', size: 2400,
    async text() { return '甲'.repeat(2400); }
  }]);
  const id = await create(f, '文件材料验收');
  const round = f.coordinator.getRounds(id).at(-1);
  assert.equal(round.materials[0].title, '访谈记录.txt');
  assert.equal(round.materials[0].contentStatus, 'truncated');
  assert.equal(round.materials[0].originalLength, 2400);
  assert.match(round.prompt, /只读取前1200字符，共2400个字符/);
  assert.match(round.prompt, /甲{20}/);
});

test('读取材料期间锁定文章提交，完成后材料进入同一首轮提示词', async () => {
  let finishRead;
  const f = fixture();
  const reading = f.change('writing-material-files', [{
    name: '等待读取.txt', type: 'text/plain', size: 10,
    text: () => new Promise(resolve => { finishRead = resolve; })
  }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.mount.innerHTML, /正在读取所选材料/);
  await assert.rejects(f.click('import-material-files'), /操作已禁用：import-material-files/);
  await assert.rejects(f.click('create'), /操作已禁用：create/);
  assert.equal(f.coordinator.listArticles().length, 0);
  finishRead('必须进入首轮的材料');
  await reading;
  assert.doesNotMatch(f.mount.innerHTML, /正在读取所选材料/);
  const id = await create(f, '等待读取完成');
  assert.match(f.coordinator.getRounds(id)[0].prompt, /必须进入首轮的材料/);
});

test('PDF 本机解析后可选页摘录，提示词只含选中的未核验摘录', async () => {
  let request;
  const f = fixture({ fetch: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({
      status: 'parsed', mimeType: 'application/pdf', method: 'pdf-text', pageCount: 2,
      extractedCharacters: 1600, truncated: false,
      segments: [{ locator: '第1页', text: '未选中的背景文字。' }, { locator: '第2页', text: '研究证据句。'.repeat(140) }]
    }) };
  } });
  await f.input('writing-material-link-title', '参考文章');
  await f.input('writing-material-link-url', 'https://example.test/article');
  await f.click('add-material-link');
  await f.change('writing-material-files', [
    { name: '全文.pdf', type: 'application/pdf', size: 3,
      async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; } }
  ]);
  assert.equal(request.url, '/api/writing-materials/parse');
  assert.equal(request.body.fileName, '全文.pdf');
  assert.equal(request.body.mimeType, 'application/pdf');
  assert.equal(request.body.dataBase64, 'AQID');
  assert.match(f.mount.innerHTML, /本机解析/);
  assert.match(f.mount.innerHTML, /第2页/);
  await f.click('use-material-segment', { index: '1', segmentIndex: '1' });
  assert.match(f.node('writing-material-1-excerpt').value, /^研究证据句。/);
  assert.ok(f.node('writing-material-1-excerpt').value.length <= 1200);
  const id = await create(f, '引用材料验收');
  const round = f.coordinator.getRounds(id).at(-1);
  assert.equal(round.sources.length, 1);
  assert.equal(round.sources[0].url, 'https://example.test/article');
  assert.equal(round.sources[0].contentStatus, 'reference-only');
  assert.equal(round.materials.length, 1);
  assert.equal(round.materials[0].excerptLocator, '第2页');
  assert.equal(round.materials[0].verificationStatus, 'unverified');
  assert.equal(round.materials[0].attachmentRequired, true);
  assert.match(round.prompt, /研究证据句/);
  assert.doesNotMatch(round.prompt, /未选中的背景文字/);
  assert.match(round.prompt, /外部 AI/);
});

test('取消正在等待的本机解析会保留原附件卡片且不采用迟到结果', async () => {
  const f = fixture({ fetch: (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
  }) });
  const parsing = f.change('writing-material-files', [{ name: '待取消.pdf', type: 'application/pdf', size: 3,
    async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; } }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.mount.innerHTML, /取消读取/);
  await f.click('cancel-material-parse');
  await parsing;
  assert.match(f.mount.innerHTML, /待取消\.pdf/);
  assert.match(f.mount.innerHTML, /本机解析已取消/);
  assert.doesNotMatch(f.mount.innerHTML, /parsedSegments/);
});

test('无效链接不会写入来源，读取失败的文件可见且不冒充已读取', async () => {
  const f = fixture();
  await f.input('writing-material-link-url', 'file:///private/notes.txt');
  await f.click('add-material-link');
  assert.match(f.mount.innerHTML, /仅支持公开的 HTTP 或 HTTPS 链接/);
  assert.equal(f.coordinator.listArticles().length, 0);
  await f.change('writing-material-files', [{
    name: '读取失败.txt', type: 'text/plain', size: 10,
    async text() { throw new Error('读取被拒绝'); }
  }]);
  assert.match(f.mount.innerHTML, /读取被拒绝/);
  const id = await create(f, '读取失败验收');
  const round = f.coordinator.getRounds(id).at(-1);
  assert.equal(round.materials[0].contentStatus, 'failed');
  assert.match(round.materials[0].contentError, /读取被拒绝/);
  assert.match(round.prompt, /读取失败/);
});

test('未知格式保留为不支持材料卡片并显示失败原因', async () => {
  const f = fixture();
  await f.change('writing-material-files', [{ name: '私有资料.xyz', type: 'application/octet-stream', size: 20 }]);
  assert.match(f.mount.innerHTML, /私有资料\.xyz/);
  assert.match(f.mount.innerHTML, /暂不支持|不支持/);
  const id = await create(f, '不支持文件验收');
  const material = f.coordinator.getRounds(id)[0].materials[0];
  assert.equal(material.contentStatus, 'unsupported');
  assert.match(material.contentError, /格式暂不支持/);
});

test('材料卡片展示来源位置版本和选用理由，仅有摘录的卡片可显式保存到资料库', async () => {
  const saved = [];
  const f = fixture({ saveMaterialToLibrary: async material => { saved.push(material); return { id: 'library-material-1' }; } });
  const workspace = await f.coordinator.createArticle({ draft: '当前稿', sources: [{
    id: 'local:guides/writing.md', title: '写作指南', excerpt: '可用来源摘录',
    sourceType: 'authorized-directory', origin: 'authorized-directory',
    sourceId: 'local:guides/writing.md', sourceLocator: 'guides/writing.md',
    sourceVersion: `sha256:${'a'.repeat(64)}`, excerptLocator: '第 24 行',
    selectionReason: '命中当前目标', verificationStatus: 'unverified', contentStatus: 'embedded',
    attachmentRequired: true
  }, {
    id: 'link-only', title: '未读取链接', url: 'https://example.test/private', excerpt: '',
    sourceType: 'link', contentStatus: 'reference-only', attachmentRequired: true
  }] });
  f.ui.openArticle(workspace.id);

  for (const text of ['guides/writing.md', '第 24 行', 'sha256:', '命中当前目标', '原附件需另行提供']) {
    assert.ok(f.mount.innerHTML.includes(text), `卡片应显示${text}`);
  }
  assert.equal((f.mount.innerHTML.match(/data-writing-action="save-material-to-library"/g) || []).length, 1);
  await f.click('save-material-to-library', { index: '0' });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].excerpt, '可用来源摘录');
  assert.equal(saved[0].sourceLocator, 'guides/writing.md');
  assert.match(f.mount.innerHTML, /已保存到资料库/);
  assert.equal((f.mount.innerHTML.match(/data-writing-action="save-material-to-library"/g) || []).length, 0);
});

test('显式保存失败保留当前材料卡片和可见摘录，支持重试', async () => {
  let fail = true;
  const f = fixture({ saveMaterialToLibrary: async () => {
    if (fail) throw new Error('资料库写入失败');
    return { id: 'saved-after-retry' };
  } });
  const workspace = await f.coordinator.createArticle({ draft: '当前稿', materials: [{
    id: 'manual-excerpt', title: '用户摘录', excerpt: '不可丢失的摘录', purpose: 'content',
    sourceType: 'pasted-text', origin: 'user-pasted', contentStatus: 'embedded'
  }] });
  f.ui.openArticle(workspace.id);

  await f.click('save-material-to-library', { index: '0' });
  assert.match(f.mount.innerHTML, /资料库写入失败/);
  assert.match(f.mount.innerHTML, /不可丢失的摘录/);
  assert.equal(f.coordinator.getRounds(workspace.id)[0].materials[0].excerpt, '不可丢失的摘录');

  fail = false;
  await f.click('save-material-to-library', { index: '0' });
  assert.match(f.mount.innerHTML, /已保存到资料库/);
});

test('D盘应用中显式保存材料只将用户可见摘录写入现有资料库且不要求开启文章保存', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  await f.change('writing-material-files', [{
    name: '访谈摘录.txt', type: 'text/plain', size: 18,
    async text() { return '受访者确认三家客户完成试用'; }
  }]);
  await create(f, '显式资料库保存', '本篇草稿');
  assert.equal(f.state.writingArticles.length, 0, '文章历史默认未保存');

  f.failSave = true;
  await f.click('save-material-to-library', { index: '0' });
  assert.equal(f.state.knowledgeEntries.length, 0, '磁盘失败时不得谎报资料入库');
  assert.match(f.mount.innerHTML, /资料库写入失败/);
  assert.match(f.mount.innerHTML, /受访者确认三家客户完成试用/);

  f.failSave = false;

  await f.click('save-material-to-library', { index: '0' });

  assert.equal(f.state.knowledgeEntries.length, 1);
  assert.equal(f.state.knowledgeEntries[0].summary, '受访者确认三家客户完成试用');
  assert.equal(f.state.knowledgeEntries[0].contentExcerpt, '受访者确认三家客户完成试用');
  assert.equal(f.state.knowledgeEntries[0].verificationStatus, 'unverified');
  assert.equal(f.state.writingArticles.length, 0, '仅保存资料不启动文章历史保存');
  assert.equal(f.diskState.knowledgeEntries[0].contentExcerpt, '受访者确认三家客户完成试用');
});

test('学术文体可在真实工作台创建并从任务按钮生成带目标要求的提示词', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp({ confirm: () => { throw new Error('支持的学术文体不应要求降级确认'); } });
  await f.settle();
  await f.input('writing-genre', 'academic-paper');
  f.window.WritingWorkbenchUIController.render();
  assert.match(f.mount.innerHTML, /学术目标与要求/);

  await f.input('writing-title', '教育学位论文');
  await f.input('writing-goal', '研究生学习体验');
  await f.input('writing-academic-discipline', '教育学');
  await f.input('writing-academic-researchType', '观察性研究');
  await f.input('writing-academic-institution', '示例大学');
  await f.click('academic-add-requirement');
  await f.input('writing-academic-requirement-0-title', '学院格式要求');
  await f.input('writing-academic-requirement-0-text', '结果章节报告研究对象');
  await f.input('writing-academic-requirement-0-issuer', '研究生院');
  await f.input('writing-academic-requirement-0-version', '2026版');
  await f.input('writing-academic-requirement-0-sourceUrl', 'https://example.test/guide');
  await f.input('writing-draft', '已有访谈材料，尚无统计结果。');
  await f.click('create');
  await f.settle();

  const article = f.coordinator.getWorkspace(f.coordinator.listArticles()[0].id);
  assert.equal(article.article.genre, 'academic-paper');
  assert.equal(article.article.academicTarget.discipline, '教育学');
  assert.equal(article.article.academicTarget.requirements[0].text, '结果章节报告研究对象');
  assert.equal(article.rounds[0].promptVersions.at(-1).taskType, 'academic-planning');
  for (const task of ['academic-planning', 'academic-outline', 'academic-chapter-draft', 'diagnosis', 'revision']) {
    assert.match(f.mount.innerHTML, new RegExp(`data-task-type="${task}"`));
  }

  await f.click('academic-task', { taskType: 'academic-outline' });
  await f.settle();
  const updated = f.coordinator.getWorkspace(article.id).rounds[0];
  assert.equal(updated.promptVersions.at(-1).taskType, 'academic-outline');
  assert.match(updated.prompt, /结果章节报告研究对象/);
});

test('结构化文档文体可在真实工作台创建并切换专属任务生成独立提示词', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp({ confirm: () => { throw new Error('受支持文体不应要求降级确认'); } });
  await f.settle();
  await f.change('writing-genre', 'technical-document');
  await f.input('writing-title', '服务运行手册');
  await f.input('writing-goal', '说明部署前置条件和故障恢复');
  await f.input('writing-audience', '值班工程师');
  await f.input('writing-platform', 'Windows Server');
  await f.input('writing-draft', '部署记录显示端口为4173。');
  await f.click('create');
  await f.settle();
  const id = f.coordinator.listArticles()[0].id;
  assert.equal(f.coordinator.getWorkspace(id).article.genre, 'technical-document');
  await f.input('writing-domain-prerequisites', '已获得管理员权限');
  await f.click('update');
  await f.settle();
  assert.match(f.mount.innerHTML, /data-task-type="technical-troubleshooting"/);
  await f.click('domain-task', { taskType: 'technical-troubleshooting' });
  await f.settle();
  const workspace = f.coordinator.getWorkspace(id);
  const round = workspace.rounds.at(-1);
  assert.equal(workspace.rounds.length, 2, '切换领域任务保留原轮次并新增任务轮次');
  assert.equal(round.promptVersions.at(-1).taskType, 'technical-troubleshooting');
  assert.match(round.prompt, /故障排查/);
  assert.match(round.prompt, /Windows Server/);
  assert.match(round.prompt, /前置条件：已获得管理员权限/);
  assert.match(round.prompt, /不得补造事实/);
});

test('真实工作台可维护故事设定、关联章节、审查变更影响并按连续性任务生成快照提示词', async () => {
  const f = createWritingApp();
  await f.settle();
  await f.change('writing-genre', 'fiction');
  await f.input('writing-title', '雾城项目');
  await f.input('writing-draft', '主人公在午夜进入旧车站。');
  await f.click('create');
  await f.settle();
  const id = f.coordinator.listArticles()[0].id;
  await f.input('writing-unit-title', '第一章');
  await f.input('writing-unit-type', 'chapter', 'change');
  await f.click('add-unit');
  await f.settle();
  const unit = f.coordinator.getWorkspace(id).units[0];
  await f.input('writing-story-canon-name', '旧车站规则');
  await f.input('writing-story-canon-text', '午夜后不能使用钟表');
  await f.input('writing-story-canon-units', unit.id);
  await f.click('add-longform-item', { longformType: 'canon' });
  await f.settle();
  const fact = f.coordinator.getWorkspace(id).longform.canon[0];
  assert.equal(fact.text, '午夜后不能使用钟表');
  await f.input(`writing-story-item-${fact.id}-value`, '午夜后不能使用钟表，违反者会迷路');
  await f.input(`writing-story-item-${fact.id}-reason`, '补充故事后果');
  await f.click('update-longform-item', { longformType: 'canon', itemId: fact.id });
  await f.settle();
  let workspace = f.coordinator.getWorkspace(id);
  const change = workspace.longform.changes[0];
  assert.ok(change.impacts.some(item => item.id === unit.id));
  const impactStatusId = `writing-story-impact-status-${change.id}-${unit.id}`;
  assert.equal(f.node(impactStatusId).value, '', '影响项必须等待用户明确选择，不能默认为已检查');
  await f.click('review-longform-impact', { changeId: change.id, itemId: unit.id });
  assert.equal(f.coordinator.getWorkspace(id).longform.changes[0].impacts.find(item => item.id === unit.id).status, 'pending');
  await f.input(`writing-story-impact-${change.id}-${unit.id}`, '已核对第一章提纲');
  await f.input(impactStatusId, 'no-change', 'change');
  await f.click('review-longform-impact', { changeId: change.id, itemId: unit.id });
  await f.settle();
  await f.click('domain-task', { taskType: 'longform-continuity' });
  await f.settle();
  workspace = f.coordinator.getWorkspace(id);
  assert.match(workspace.rounds[0].prompt, /旧车站规则/);
  assert.match(workspace.rounds[0].prompt, /违反者会迷路/);
  assert.equal(workspace.rounds[0].promptVersions.at(-1).longformSnapshot.canon[0].id, fact.id);
  assert.equal(workspace.longform.changes[0].impacts.find(item => item.id === unit.id).status, 'no-change');
  assert.equal(workspace.longform.changes[0].impacts.find(item => item.id === unit.id).reason, '已核对第一章提纲');
});

test('领域任务按钮先应用未提交字段，长篇资料可归档恢复且影响对象可跳转', async () => {
  const f = createWritingApp();
  await f.settle();
  await f.change('writing-genre', 'business-document');
  await f.input('writing-title', '商务事实核验');
  await f.input('writing-draft', '产品有 4 名支持人员；未提供转化率。');
  await f.click('create');
  await f.settle();
  const id = f.coordinator.listArticles()[0].id;
  await f.input('writing-domain-businessGoal', '比较两种支持排班，不推断销售效果');
  await f.click('domain-task', { taskType: 'business-proposal' });
  await f.settle();
  assert.match(f.coordinator.getWorkspace(id).rounds.at(-1).prompt, /比较两种支持排班/);

  const story = createWritingApp();
  await story.settle();
  await story.change('writing-genre', 'fiction');
  await story.input('writing-title', '归档交互');
  await story.click('create');
  await story.settle();
  const storyId = story.coordinator.listArticles()[0].id;
  await story.input('writing-unit-title', '第一章');
  await story.click('add-unit');
  await story.settle();
  const unit = story.coordinator.getWorkspace(storyId).units[0];
  await story.input('writing-story-canon-name', '城门规则');
  await story.input('writing-story-canon-text', '夜间关闭');
  await story.input('writing-story-canon-units', unit.id);
  await story.click('add-longform-item', { longformType: 'canon' });
  await story.settle();
  const fact = story.coordinator.getWorkspace(storyId).longform.canon[0];
  await story.input(`writing-story-item-${fact.id}-value`, '夜间关闭，黎明开启');
  await story.input(`writing-story-item-${fact.id}-reason`, '设定调整');
  await story.click('update-longform-item', { longformType: 'canon', itemId: fact.id });
  await story.settle();
  assert.ok(story.mount.innerHTML.includes(`href="#writing-unit-${unit.id}"`));
  await story.click('archive-longform-item', { longformType: 'canon', itemId: fact.id });
  await story.settle();
  assert.equal(story.coordinator.getWorkspace(storyId).longform.canon[0].archived, true);
  await story.click('domain-task', { taskType: 'longform-continuity' });
  await story.settle();
  assert.doesNotMatch(story.coordinator.getWorkspace(storyId).rounds.at(-1).prompt, /城门规则|夜间关闭/);
  await story.click('restore-longform-item', { longformType: 'canon', itemId: fact.id });
  await story.settle();
  assert.equal(story.coordinator.getWorkspace(storyId).longform.canon[0].archived, false);
  await story.click('domain-task', { taskType: 'longform-continuity' });
  await story.settle();
  assert.match(story.coordinator.getWorkspace(storyId).rounds.at(-1).prompt, /城门规则/);
});

test('长篇研究文章领域任务把当前章节材料范围写入新提示词轮次', async () => {
  const f = fixture();
  await f.input('writing-title', '分节材料范围');
  await f.input('writing-genre', 'longform-research-article');
  await f.input('writing-goal', '按章节范围使用研究材料');
  await f.click('create');
  const id = f.coordinator.listArticles()[0].id;

  await f.input('writing-unit-title', '第一节');
  await f.click('add-unit');
  const firstUnit = f.coordinator.getWorkspace(id).units[0];
  await f.input('writing-unit-title', '第二节');
  await f.click('add-unit');
  const secondUnit = f.coordinator.getWorkspace(id).units[1];

  await f.click('add-material');
  await f.input('writing-material-0-title', '第一节来源');
  await f.input('writing-material-0-excerpt', '第一节专属证据哨兵');
  await f.change(`writing-material-0-unit-${firstUnit.id}`, true);
  await f.click('add-material');
  await f.input('writing-material-1-title', '第二节来源');
  await f.input('writing-material-1-excerpt', '第二节专属证据哨兵');
  await f.change(`writing-material-1-unit-${secondUnit.id}`, true);
  await f.change('writing-unit-selection', secondUnit.id);
  await f.click('domain-task', { taskType: 'section-plan' });

  const round = f.coordinator.getWorkspace(id).rounds.at(-1);
  assert.equal(round.unitId, secondUnit.id);
  assert.equal(round.materials.find(item => item.title === '第二节来源').unitIds[0], secondUnit.id);
  assert.match(round.prompt, /第二节专属证据哨兵/);
  assert.doesNotMatch(round.prompt, /第一节专属证据哨兵/);
});

test('追加第二次真实写入失败仍展示现存新轮，保留回带输入且模型预览对应可见稿', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  await f.settle();
  const id = await create(f);
  await f.change('writing-save', true);
  await f.input('writing-goal', '更新目标已成功落盘');
  await f.input('writing-new-draft', '新轮正文：客户完成三次试用。');
  await f.input('writing-feedback', '保留三次试用这个事实');
  const writes = f.writes;
  f.failWriteAt = writes + 2;
  await f.click('append');
  assert.equal(f.writes, writes + 2, '先保存目标成功，再让新轮的实际setItem失败');
  assert.equal(f.diskState.writingArticles[0].article.goal, '更新目标已成功落盘');
  assert.equal(f.diskState.writingArticles[0].rounds.length, 1);
  const round = f.coordinator.getWorkspace(id).rounds.at(-1);
  assert.equal(f.coordinator.getWorkspace(id).rounds.length, 2);
  assert.equal(f.node('writing-draft').readOnly, true);
  assert.equal(f.node('writing-draft').value, round.draft);
  assert.equal(f.node('writing-prompt').value, round.prompt);
  assert.equal(f.node('writing-diagnosis').value, round.diagnosis);
  assert.equal(f.node('writing-new-draft').value, '新轮正文：客户完成三次试用。');
  assert.equal(f.node('writing-feedback').value, '保留三次试用这个事实');
  assert.match(f.mount.innerHTML, /1\/2.*尚未保存/);
  assert.match(f.mount.innerHTML, /磁盘已满/);
  const pending = f.click('model');
  await f.settle();
  assert.equal(f.requests, 0);
  assert.match(f.element('send-preview-text').value, /新轮正文：客户完成三次试用/);
  await f.event('send-preview-cancel');
  await pending;
  assert.equal(f.node('writing-draft').value, round.draft);
  assert.equal(f.node('writing-new-draft').value, '新轮正文：客户完成三次试用。');
});

test('公开网页读取只暂存正文，用户选摘后才进入下一轮提示词', async () => {
  let requestedUrl = '';
  const pageText = '已选网页摘录的事实范围。'.repeat(55);
  const f = fixture({ fetch: async (url, options) => {
    requestedUrl = url;
    assert.equal(options.method, 'POST');
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ title: '公开页面', finalUrl: 'https://example.test/final', text: pageText,
      characterCount: pageText.length, truncated: false, incomplete: false }) };
  } });
  await f.input('writing-material-link-title', '公开来源');
  await f.input('writing-material-link-url', 'https://example.test/article?ref=visible');
  await f.click('add-material-link');
  const id = await create(f, '网页读取隔离验收');
  await f.click('read-web-material', { index: '0' });
  assert.equal(requestedUrl, '/api/writing-materials/read-webpage');
  assert.match(f.mount.innerHTML, /网页正文（仅当前页面暂存）/);
  assert.equal(f.node('writing-material-0-excerpt').value, '');
  assert.equal(f.coordinator.getRounds(id).at(-1).prompt.includes('已选网页摘录的事实范围'), false);
  await f.click('use-web-segment', { index: '0' });
  assert.match(f.node('writing-material-0-excerpt').value, /^已选网页摘录/);
  assert.equal(f.node('writing-material-0-excerpt').value.length, Math.min(1200, pageText.length));
  await f.input('writing-new-draft', '带回一段待修改的新稿。');
  await f.click('append');
  const round = f.coordinator.getRounds(id).at(-1);
  assert.equal(round.sources[0].sourceType, 'web-text');
  assert.equal(round.sources[0].verificationStatus, 'unverified');
  assert.match(round.prompt, /已选网页摘录的事实范围/);
});

test('公开网页读取失败和取消都保留链接且忽略迟到正文', async () => {
  const failed = fixture({ fetch: async () => ({ ok: false, json: async () => ({ message: '网页需要登录' }) }) });
  await failed.input('writing-material-link-url', 'https://example.test/private');
  await failed.click('add-material-link');
  await failed.click('read-web-material', { index: '0' });
  assert.match(failed.mount.innerHTML, /网页需要登录/);
  assert.match(failed.mount.innerHTML, /example\.test\/private/);

  const cancelled = fixture({ fetch: (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
  }) });
  await cancelled.input('writing-material-link-url', 'https://example.test/cancel');
  await cancelled.click('add-material-link');
  const reading = cancelled.click('read-web-material', { index: '0' });
  await new Promise(resolve => setImmediate(resolve));
  await cancelled.click('cancel-material-parse');
  await reading;
  assert.match(cancelled.mount.innerHTML, /网页正文尚未读取/);
  assert.match(cancelled.mount.innerHTML, /example\.test\/cancel/);
});

test('材料和来源表单可编辑并展示来源元数据且保留未核验状态', async () => {
  const f = fixture();
  await f.click('add-material');
  await f.input('writing-material-0-provider', '发布方哨兵');
  await f.input('writing-material-0-accessedAt', '2026-10-20');
  await f.input('writing-material-0-license', '授权说明哨兵');
  await f.input('writing-material-0-applicability', '适用范围哨兵');
  await f.input('writing-material-0-limitations', '限制哨兵');
  assert.equal(f.node('writing-material-0-provider').value, '发布方哨兵');
  assert.equal(f.node('writing-material-0-provider').attrs['aria-label'], '提供方/发布方');

  await f.input('writing-material-link-url', 'https://example.test/source');
  await f.click('add-material-link');
  assert.match(f.mount.innerHTML, /发布方哨兵/);
  await f.input('writing-material-1-provider', '来源提供方哨兵');
  await f.input('writing-material-1-accessedAt', '2026-10-21');
  await f.input('writing-material-1-license', '来源许可哨兵');
  await f.input('writing-material-1-applicability', '来源适用范围哨兵');
  await f.input('writing-material-1-limitations', '来源限制哨兵');
  assert.equal(f.node('writing-material-1-provider').value, '来源提供方哨兵');
  assert.equal(f.node('writing-material-1-provider').attrs['aria-label'], '提供方/发布方');
  await f.click('add-material');
  for (const text of ['来源提供方哨兵', '2026-10-21', '来源许可哨兵', '来源适用范围哨兵', '来源限制哨兵']) {
    assert.ok(f.mount.innerHTML.includes(text), text);
  }
  assert.match(f.mount.innerHTML, /来源核验：未核验/);
});

test('播客动态领域字段都有明确的可访问名称', async () => {
  const f = fixture();
  await f.input('writing-genre', '播客');
  await f.click('create');
  for (const [key, label] of Object.entries({
    format: '单人/多人/采访', speakers: '主持人与嘉宾角色', duration: '目标时长',
    segments: '段落与提问次序', sources: '引用材料'
  })) {
    const control = f.node(`writing-domain-${key}`);
    assert.ok(control, `${key} 动态字段应渲染`);
    assert.equal(control.attrs['aria-label'], label, `${key} 应有可访问名称`);
  }
});
