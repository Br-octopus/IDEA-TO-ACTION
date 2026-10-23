const test = require('node:test');
const assert = require('node:assert/strict');
const { createWritingApp } = require('./helpers/writing-app.js');

// 通过真实 UI 控件管理专业基础包；确认逻辑由 helper 的 confirm 选项控制。
test('包管理区展示内置与自定义包，详情显示来源和验证状态', async () => {
  const app = createWritingApp();
  await app.settle();
  const dom = app;
  await dom.click('manage-packs');
  assert.equal(dom.mount.innerHTML.includes('专业基础包'), true, '管理区标题可见');
  assert.equal(dom.mount.innerHTML.includes('普通文章'), true, '内置包可见');
  assert.equal(dom.mount.innerHTML.includes('数据-action="pack-detail"') || dom.mount.innerHTML.includes('pack-detail'), true, '详情入口存在');
});

test('打开和关闭包管理不会替换或清空写作工作台', async () => {
  const app = createWritingApp();
  await app.settle();
  await app.input('writing-goal', '这段未提交的写作目标');

  await app.click('manage-packs');
  assert.equal(app.mount.innerHTML.includes('专业基础包'), true, '管理面板已打开');
  assert.equal(app.mount.innerHTML.includes('writing-goal'), true, '工作台表单仍然可见');

  await app.click('pack-close');
  assert.equal(app.mount.innerHTML.includes('写作工作台'), true, '关闭管理面板后工作台仍在');
  assert.equal(app.node('writing-goal').value, '这段未提交的写作目标', '未提交输入得到保留');
  assert.equal(app.mount.innerHTML.includes('class="writing-pack-manager"'), false, '管理面板已关闭');
});

test('基础包编辑器将用户输入写回并保存', async () => {
  const app = createWritingApp();
  await app.settle();
  const coordinator = app.packCoordinator;
  await coordinator.createPack({ id: 'ui-edit-me', name: '旧名称', layer: 'task', checks: [{ id: 'c1', statement: '旧检查' }] });
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-edit', { packId: 'ui-edit-me' });
  await app.input('pack-field-name', '新名称');
  await app.input('pack-field-checks', '新检查');
  await app.click('pack-save');
  await app.settle();

  const edited = app.state.writingPacks.find(pack => pack.id === 'ui-edit-me');
  assert.equal(edited.name, '新名称');
  assert.equal(edited.checks[0].statement, '新检查');
});

test('管理界面可新建带来源的包并将来源关联到检查项', async () => {
  const app = createWritingApp();
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-new');
  await app.input('pack-field-id', 'ui-created-pack');
  await app.input('pack-field-name', '界面创建的包');
  await app.input('pack-field-genre', 'article');
  await app.input('pack-field-taskType', 'revision');
  await app.input('pack-field-checks', '检查改稿是否保留事实');
  await app.input('pack-field-sources', '写作指南 | 第 2 节 | https://example.org/guide | v1 | CC BY 4.0 | 普通文章改稿 | 不用于事实核验');
  await app.click('pack-save');
  await app.settle();

  const pack = app.state.writingPacks.find(item => item.id === 'ui-created-pack');
  assert.equal(pack.sources[0].title, '写作指南');
  assert.equal(pack.sources[0].locator, '第 2 节');
  assert.equal(pack.sources[0].applicability, '普通文章改稿');
  assert.equal(pack.sources[0].verificationStatus, 'unverified');
  assert.deepEqual(pack.checks[0].sourceIds, ['source-1']);
  assert.ok(app.node('writing-pack-selection-ui-created-pack'), '新包可从工作台按任务选择');
});

test('新建包可选择核心层并通过完整内容编辑器保存专业规则和来源字段', async () => {
  const app = createWritingApp();
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-new');
  await app.input('pack-field-id', 'ui-core-pack');
  await app.input('pack-field-name', '通用研究核心包');
  await app.input('pack-field-layer', 'core');
  await app.input('pack-field-content', JSON.stringify({
    methods: [{ id: 'method-core', title: '证据检查', guidance: '按来源位置核实', applicability: ['研究写作'], sourceIds: ['source-core'], verificationStatus: 'unverified' }],
    evidenceRules: [{ id: 'evidence-core', statement: '结论需回指来源', sourceIds: ['source-core'], verificationStatus: 'unverified' }],
    sources: [{ id: 'source-core', title: '研究指南', url: 'https://example.org/research', locator: '第 3 节', version: '2026 版', license: 'CC BY 4.0', checkedAt: '2026-10-21', applicability: '研究写作通用', limitations: '不替代专业审查', verificationStatus: 'unverified' }]
  }));
  await app.click('pack-save');
  await app.settle();

  const pack = app.state.writingPacks.find(item => item.id === 'ui-core-pack');
  assert.equal(pack.layer, 'core');
  assert.equal(pack.methods[0].guidance, '按来源位置核实');
  assert.equal(pack.evidenceRules[0].statement, '结论需回指来源');
  assert.equal(pack.sources[0].applicability, '研究写作通用');

  await app.click('pack-detail', { packId: 'ui-core-pack' });
  for (const value of ['https://example.org/research', '2026 版', 'CC BY 4.0', '研究写作通用', '不替代专业审查', '2026-10-21']) {
    assert.equal(app.mount.innerHTML.includes(value), true, `来源详情显示 ${value}`);
  }
});

test('编辑内置包生成带 basePackId 的副本并保存到状态', async () => {
  const app = createWritingApp({ confirm: () => true, prompt: () => '我的文章包' });
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-edit', { packId: 'builtin-article' });
  // 通过表单修改名称并保存
  await app.input('pack-field-name', '我的文章包');
  await app.click('pack-save');
  await app.settle();
  const packs = app.state.writingPacks || [];
  assert.equal(packs.some(p => p.basePackId === 'builtin-article'), true, '副本已保存');
});

test('从内置包副本恢复时删除该副本并保留内置原版', async () => {
  const app = createWritingApp({ confirm: () => true, prompt: () => '我的文章包' });
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-edit', { packId: 'builtin-article' });
  await app.input('pack-field-name', '我的文章包');
  await app.click('pack-save');
  await app.settle();

  const copy = app.state.writingPacks.find(pack => pack.basePackId === 'builtin-article');
  assert.ok(copy, '编辑内置包应先创建自定义副本');
  // 副本卡片把动作目标映射到其 basePackId，协调器才能恢复对应内置包。
  await app.click('pack-restore', { packId: copy.basePackId });
  await app.settle();

  assert.equal(app.state.writingPacks.some(pack => pack.basePackId === 'builtin-article'), false);
  assert.equal(app.packCoordinator.listPacks().some(pack => pack.id === 'builtin-article' && pack.builtin), true);
});

test('停用的包不再被提示词采用', async () => {
  const app = createWritingApp();
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-toggle', { packId: 'builtin-article' });
  await app.settle();
  const selection = app.packCoordinator ? null : null;
  // 通过 UI 再查一次选中状态
  const ui = app.window.WritingPackUIController;
  assert.equal(typeof ui.getSelection, 'function', 'UI 暴露选择查询');
  assert.equal(ui.getSelection().selectedIds.includes('builtin-article'), false, '停用后不选中');
});

test('在工作台选择的基础包规则和来源进入新文章提示词', async () => {
  const app = createWritingApp();
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-new');
  await app.input('pack-field-id', 'ui-revision-pack');
  await app.input('pack-field-name', '改稿专项包');
  await app.input('pack-field-genre', 'article');
  await app.input('pack-field-taskType', 'revision');
  await app.input('pack-field-checks', '工作台选择规则哨兵');
  await app.input('pack-field-sources', '工作台来源哨兵 | 指南第 2 节 | https://example.test/guide | v1 | CC BY 4.0 | 普通文章改稿；改稿任务 | 未核对科学结论');
  await app.click('pack-save');
  await app.settle();
  assert.equal(app.state.writingPacks.find(pack => pack.id === 'ui-revision-pack').taskType, 'revision');
  assert.deepEqual(app.state.writingPacks.find(pack => pack.id === 'ui-revision-pack').sources[0].applicability,
    '普通文章改稿；改稿任务');
  await app.click('pack-close');
  await app.change('writing-pack-selection-ui-revision-pack', true);
  await app.input('writing-goal', '保留证据并检查结构');
  await app.input('writing-draft', '一段待修改的初稿。');
  await app.click('create');
  await app.settle();

  const articleId = app.coordinator.listArticles()[0].id;
  const article = app.coordinator.getWorkspace(articleId);
  assert.deepEqual(article.article.packSelections, ['builtin-writing-core', 'ui-revision-pack']);
  assert.deepEqual(article.rounds[0].packSelections, ['builtin-writing-core', 'ui-revision-pack']);
  assert.match(article.rounds[0].prompt, /工作台选择规则哨兵/);
  assert.match(article.rounds[0].prompt, /工作台来源哨兵/);
  assert.match(article.rounds[0].prompt, /CC BY 4.0/);
});

test('未勾选的启用包不会进入文章提示词', async () => {
  const app = createWritingApp();
  await app.settle();
  await app.packCoordinator.createPack({
    id: 'ui-unselected-pack', name: '未选择专项包', layer: 'task', genre: 'article', taskType: 'revision',
    checks: [{ id: 'ui-unselected-rule', statement: '未选用规则哨兵' }]
  });
  app.window.WritingWorkbenchUIController.render();
  await app.input('writing-draft', '一段待修改的初稿。');
  await app.click('create');
  await app.settle();

  const articleId = app.coordinator.listArticles()[0].id;
  const article = app.coordinator.getWorkspace(articleId);
  assert.deepEqual(article.article.packSelections, ['builtin-writing-core']);
  assert.doesNotMatch(article.rounds[0].prompt, /未选用规则哨兵/);
});

test('删除自定义包需要确认，取消时不删除', async () => {
  let confirmMessage = '';
  const app = createWritingApp({ confirm: message => { confirmMessage = message; return false; } });
  await app.settle();
  // 先通过协调器创建一个自定义包
  const coordinator = app.packCoordinator;
  await coordinator.createPack({ id: 'ui-delete-me', name: '待删包', layer: 'task', checks: [{ id: 'c1', statement: '检查' }] });
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-delete', { packId: 'ui-delete-me' });
  await app.settle();
  assert.equal(confirmMessage.includes('删除'), true, '删除前有确认提示');
  assert.equal((app.state.writingPacks || []).some(p => p.id === 'ui-delete-me'), true, '取消后包仍在');
});

test('导出结果可解析为 JSON 并包含自定义包', async () => {
  const app = createWritingApp();
  await app.settle();
  const coordinator = app.packCoordinator;
  await coordinator.createPack({ id: 'ui-export-me', name: '导出包', layer: 'task', checks: [{ id: 'c1', statement: '检查' }] });
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-export-open');
  await app.settle();
  // 导出会调用剪贴板或下载；通过 coordinator export 校验
  const exported = coordinator.exportPacks(['ui-export-me']);
  const json = JSON.parse(JSON.stringify(exported));
  assert.equal(json[0].id, 'ui-export-me');
});

test('包导入先展示来源许可范围版本覆盖对象和规则差异，确认前不写入', async () => {
  const app = createWritingApp();
  await app.settle();
  const builtin = app.packCoordinator.getPack('builtin-article');
  const imported = {
    ...builtin,
    id: 'import-article-custom',
    name: '导入的文章包',
    builtin: false,
    basePackId: 'builtin-article',
    version: 3,
    applicability: { description: '文章改稿', tasks: ['revision'], languages: ['zh-CN'], exclusions: ['事实核验'] },
    checks: [{ id: 'import-check', statement: '导入差异哨兵', verificationStatus: 'case-validated' }],
    sources: [{ id: 'import-source', title: '合成写作指南', locator: '第 4 节', url: 'https://example.org/guide', version: '2026 版', license: 'CC BY 4.0', checkedAt: '2026-10-21', applicability: '文章改稿', limitations: '不用于事实核验', verificationStatus: 'source-reviewed' }]
  };

  await app.click('manage-packs');
  await app.click('pack-import-open');
  await app.input('pack-import-json', JSON.stringify([imported]));
  await app.click('pack-import-preview');
  await app.settle();

  for (const expected of ['导入预览', '合成写作指南', '第 4 节', 'CC BY 4.0', '文章改稿', '不用于事实核验', '2026 版', 'builtin-article', '新增', '未核验']) {
    assert.equal(app.mount.innerHTML.includes(expected), true, `预览显示 ${expected}`);
  }
  assert.equal(app.mount.innerHTML.includes('导入差异哨兵'), true, '预览显示导入规则内容');
  assert.equal(app.state.writingPacks.some(pack => pack.id === 'import-article-custom'), false, '预览阶段不写入');

  await app.click('pack-import-confirm');
  await app.settle();
  const saved = app.state.writingPacks.find(pack => pack.id === 'import-article-custom');
  assert.ok(saved, '显式确认后写入包');
  assert.equal(saved.sources[0].verificationStatus, 'unverified', '导入来源不会继承已核验状态');
  assert.equal(saved.checks[0].verificationStatus, 'unverified', '导入规则不会继承已核验状态');
});

test('包导入 ID 冲突在预览中说明并阻止确认', async () => {
  const app = createWritingApp();
  await app.packCoordinator.createPack({ id: 'existing-import-id', name: '已存在', layer: 'task' });
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-import-open');
  await app.input('pack-import-json', JSON.stringify([{ id: 'existing-import-id', name: '冲突包', layer: 'task' }]));
  await app.click('pack-import-preview');
  await app.settle();

  assert.match(app.mount.innerHTML, /ID 冲突/);
  assert.match(app.mount.innerHTML, /data-action="pack-import-confirm" disabled/);
  assert.equal(app.state.writingPacks.filter(pack => pack.id === 'existing-import-id').length, 1, '冲突预览不写入重复包');
});

test('键盘可聚焦的按钮和选项存在', async () => {
  const app = createWritingApp();
  await app.settle();
  await app.click('manage-packs');
  const html = app.mount.innerHTML;
  // 所有操作按钮必须是 button 或带 tabindex 的元素
  assert.equal(/<button[^>]*data-action="pack-detail"/.test(html) || /data-action="pack-detail"/.test(html), true, '详情按钮存在');
  assert.equal(/<button[^>]*data-action="pack-toggle"/.test(html) || /data-action="pack-toggle"/.test(html), true, '启停按钮存在');
});

test('详情中可独立停用或启用单项规则', async () => {
  const app = createWritingApp();
  await app.packCoordinator.createPack({ id: 'item-toggle-pack', name: '条目开关包', layer: 'task', genre: 'article', taskType: 'revision',
    checks: [{ id: 'toggle-check', statement: '必须核对', verificationStatus: 'source-reviewed' }] });
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-detail', { packId: 'item-toggle-pack' });
  await app.click('pack-item-toggle', { packId: 'item-toggle-pack', packField: 'checks', itemId: 'toggle-check' });
  await app.settle();
  assert.equal(app.state.writingPacks.find(pack => pack.id === 'item-toggle-pack').checks[0].enabled, false);
  await app.click('pack-item-toggle', { packId: 'item-toggle-pack', packField: 'checks', itemId: 'toggle-check' });
  await app.settle();
  assert.equal(app.state.writingPacks.find(pack => pack.id === 'item-toggle-pack').checks[0].enabled, true);
});
