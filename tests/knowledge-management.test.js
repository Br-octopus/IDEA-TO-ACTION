const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const appSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'prototype', 'app.js'), 'utf8');
const managementContext = { Date };
vm.runInNewContext(appSource.slice(0, appSource.indexOf('(() => {')), managementContext);
const management = Object.fromEntries(['toggleKnowledgeFavorite', 'toggleKnowledgePinned', 'markKnowledgeUsed', 'hideKnowledgeEntry', 'restoreKnowledgeEntry', 'deleteKnowledgeEntries', 'selectKnowledgeEntries', 'buildManualKnowledgeEntry', 'confirmBrowserSafetyBackup', 'consumeBrowserImportGate', 'filterKnowledgeEntriesByScope', 'SAFETY_BACKUP_NOT_CONFIRMED'].map(name => [name, managementContext[name]]));
const { normalizeKnowledgeEntry } = require('../prototype/knowledge-schema.js');const { createBackup, validateBackup, replaceState } = require('../prototype/workspace-backup.js');

function state() {
  return { knowledgeEntries: [
    { id: 'manual-1', sourceKind: 'manual', favorite: false, pinned: false, hiddenAt: '', lastUsedAt: '' },
    { id: 'prompt-1', sourceKind: 'prompt', favorite: false, pinned: false, hiddenAt: '', lastUsedAt: '' },
    { id: 'case-1', sourceKind: 'case', favorite: false, pinned: false, hiddenAt: '', lastUsedAt: '' },
    { id: 'manual-hidden', sourceKind: 'manual', hiddenAt: '2026-01-01T00:00:00.000Z' }
  ], knowledgeSelection: [] };
}

test('编辑手动资料保留管理和来源元数据并更新表单字段', () => {
  const previousEntry = normalizeKnowledgeEntry({
    id: 'manual-stable-id',
    type: 'manual-note',
    title: '旧标题',
    sourceUrl: 'https://old.example.com',
    sourceType: '用户添加',
    sourceKind: 'manual',
    sourceId: 'source-stable-id',
    favorite: true,
    pinned: true,
    lastUsedAt: '2026-10-18T01:02:03.000Z',
    hiddenAt: '2026-10-18T02:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    linkedCaseId: 'case-stable-id',
    summary: '旧摘要'
  });
  const edited = management.buildManualKnowledgeEntry(previousEntry, {
    type: 'manual-note',
    title: '新标题',
    sourceUrl: 'https://new.example.com',
    domains: '软件开发',
    stages: '执行',
    keywords: '编辑,元数据',
    summary: '新摘要',
    reusablePatterns: '新模式',
    limitations: '新限制',
    licenseNote: 'MIT'
  }, normalizeKnowledgeEntry);

  assert.equal(edited.id, previousEntry.id);
  assert.equal(edited.title, '新标题');
  assert.equal(edited.summary, '新摘要');
  assert.equal(edited.sourceUrl, 'https://new.example.com');
  assert.deepEqual(edited.domains, ['软件开发']);
  assert.equal(edited.favorite, true);
  assert.equal(edited.pinned, true);
  assert.equal(edited.lastUsedAt, previousEntry.lastUsedAt);
  assert.equal(edited.hiddenAt, previousEntry.hiddenAt);
  assert.equal(edited.createdAt, previousEntry.createdAt);
  assert.equal(edited.sourceKind, 'manual');
  assert.equal(edited.sourceId, 'source-stable-id');
  assert.equal(edited.linkedCaseId, 'case-stable-id');
});
test('资料管理动作不可变且只更新目标条目', () => {
  const current = state();
  const before = JSON.stringify(current);
  const next = management.toggleKnowledgeFavorite(current, 'manual-1');
  assert.equal(next.knowledgeEntries[0].favorite, true);
  assert.equal(JSON.stringify(current), before);
  assert.notEqual(next, current);
});

test('最近使用、隐藏和恢复使用稳定时间字段', () => {
  let current = state();
  current = management.markKnowledgeUsed(current, 'prompt-1', '2026-10-19T01:02:03.000Z');
  assert.equal(current.knowledgeEntries[1].lastUsedAt, '2026-10-19T01:02:03.000Z');
  current = management.hideKnowledgeEntry(current, 'prompt-1', '2026-10-19T02:00:00.000Z');
  assert.equal(current.knowledgeEntries[1].hiddenAt, '2026-10-19T02:00:00.000Z');
  assert.equal(management.restoreKnowledgeEntry(current, 'prompt-1').knowledgeEntries[1].hiddenAt, '');
});

test('批量删除只删除手动资料，不删除派生提示词或案例', () => {
  const next = management.deleteKnowledgeEntries(state(), ['manual-1', 'prompt-1', 'case-1']);
  assert.equal(JSON.stringify(next.knowledgeEntries.map(item => item.id)), JSON.stringify(['prompt-1', 'case-1', 'manual-hidden']));
});

test('资料选择过滤隐藏项并最多选择五条', () => {
  const current = { knowledgeEntries: Array.from({ length: 7 }, (_, index) => ({ id: `manual-${index}`, hiddenAt: index === 6 ? 'hidden' : '' })), knowledgeSelection: [] };
  const next = management.selectKnowledgeEntries(current, current.knowledgeEntries.map(item => item.id), 5);
  assert.equal(next.knowledgeSelection.length, 5);
  assert.equal(next.knowledgeSelection.includes('manual-6'), false);
});

test('置顶资料范围只返回置顶且排除非置顶条目', () => {
  const entries = [
    { id: 'pinned-entry', pinned: true },
    { id: 'regular-entry', pinned: false },
    { id: 'missing-pinned-entry' }
  ];
  assert.deepEqual(
    management.filterKnowledgeEntriesByScope(entries, 'pinned').map(item => item.id),
    ['pinned-entry']
  );
});
test('资料范围筛选变更会绑定资料视图刷新', () => {
  const listenerBinding = appSource.match(/\["knowledge-scope"[^\]]*\]\.forEach\(id => document\.getElementById\(id\)\.addEventListener\("change", refreshKnowledgeView\)\)/);
  assert.ok(listenerBinding, 'knowledge-scope 必须绑定 change 事件并刷新资料视图');
});

test('浏览器安全备份必须由用户确认后才能继续导入', () => {
  let message = '';
  assert.equal(management.confirmBrowserSafetyBackup(text => { message = text; return true; }), true);
  assert.match(message, /下载已触发/);
  assert.match(message, /已看到并保存安全备份文件/);
  assert.throws(() => management.confirmBrowserSafetyBackup(() => false), error => String(error).includes('未确认已保存安全备份'));
});

test('浏览器安全备份未确认时阻断导入写入', async () => {
  let writes = 0;
  await assert.rejects(async () => {
    await management.confirmBrowserSafetyBackup(() => false);
    writes += 1;
  }, error => String(error).includes('未确认已保存安全备份'));
  assert.equal(writes, 0);
});

test('浏览器导入令牌只能显式确认后消费一次', () => {
  const gate = { confirmed: false, used: false };
  assert.throws(() => management.consumeBrowserImportGate(gate), error => String(error.message || error).includes('未确认已保存安全备份'));
  gate.confirmed = true;
  assert.equal(management.consumeBrowserImportGate(gate), true);
  assert.throws(() => management.consumeBrowserImportGate(gate), error => String(error.message || error).includes('未确认已保存安全备份'));
});

test('非法导入在校验前后都不替换当前状态', () => {
  const current = state();
  const backup = createBackup(current, { scope: 'knowledge-base', now: '2026-10-19T00:00:00.000Z' });
  backup.data.knowledgeEntries[0].id = '';
  assert.throws(() => validateBackup(backup));
  assert.equal(current.knowledgeEntries[0].id, 'manual-1');
  assert.equal(replaceState(current, createBackup(current, { scope: 'knowledge-base' })).knowledgeEntries[0].id, 'manual-1');
});

test('资料卡编辑和来源事件分支可执行且来源分支不删除原始项目', () => {
  assert.ok(appSource.includes('data-knowledge-edit'));
  assert.ok(appSource.includes('beginKnowledgeEntryEdit(entry)'));
  assert.ok(appSource.includes('knowledgeForm.dataset.editId = entry.id'));
  assert.ok(appSource.includes('data-knowledge-source'));
  assert.ok(appSource.includes('handleKnowledgeSourceAction(entry)'));
  assert.ok(appSource.includes('function handleKnowledgeSourceAction'));
  assert.ok(appSource.includes('未执行任何删除操作'));
  const sourceBranch = appSource.slice(appSource.indexOf('function handleKnowledgeSourceAction'), appSource.indexOf('function saveKnowledgeEntry'));
  assert.equal(sourceBranch.includes('deleteKnowledgeEntries'), false);
  assert.equal(sourceBranch.includes('state.cases ='), false);
  assert.equal(sourceBranch.includes('state.projects ='), false);
});

test('导出备份支持 workspace 和 knowledge-base 范围', () => {
  const current = { ...state(), projects: [{ id: 'project-1' }], prompts: [], cases: [], references: [] };
  assert.equal(createBackup(current, { scope: 'workspace' }).scope, 'workspace');
  assert.equal(createBackup(current, { scope: 'knowledge-base' }).scope, 'knowledge-base');
});