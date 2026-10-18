const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const appSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'prototype', 'app.js'), 'utf8');
const managementContext = { Date };
vm.runInNewContext(appSource.slice(0, appSource.indexOf('(() => {')), managementContext);
const management = Object.fromEntries(['toggleKnowledgeFavorite', 'toggleKnowledgePinned', 'markKnowledgeUsed', 'hideKnowledgeEntry', 'restoreKnowledgeEntry', 'deleteKnowledgeEntries', 'selectKnowledgeEntries'].map(name => [name, managementContext[name]]));const { createBackup, validateBackup, replaceState } = require('../prototype/workspace-backup.js');

function state() {
  return { knowledgeEntries: [
    { id: 'manual-1', sourceKind: 'manual', favorite: false, pinned: false, hiddenAt: '', lastUsedAt: '' },
    { id: 'prompt-1', sourceKind: 'prompt', favorite: false, pinned: false, hiddenAt: '', lastUsedAt: '' },
    { id: 'case-1', sourceKind: 'case', favorite: false, pinned: false, hiddenAt: '', lastUsedAt: '' },
    { id: 'manual-hidden', sourceKind: 'manual', hiddenAt: '2026-01-01T00:00:00.000Z' }
  ], knowledgeSelection: [] };
}

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

test('非法导入在校验前后都不替换当前状态', () => {
  const current = state();
  const backup = createBackup(current, { scope: 'knowledge-base', now: '2026-10-19T00:00:00.000Z' });
  backup.data.knowledgeEntries[0].id = '';
  assert.throws(() => validateBackup(backup));
  assert.equal(current.knowledgeEntries[0].id, 'manual-1');
  assert.equal(replaceState(current, createBackup(current, { scope: 'knowledge-base' })).knowledgeEntries[0].id, 'manual-1');
});

test('导出备份支持 workspace 和 knowledge-base 范围', () => {
  const current = { ...state(), projects: [{ id: 'project-1' }], prompts: [], cases: [], references: [] };
  assert.equal(createBackup(current, { scope: 'workspace' }).scope, 'workspace');
  assert.equal(createBackup(current, { scope: 'knowledge-base' }).scope, 'knowledge-base');
});