const test = require('node:test');
const assert = require('node:assert/strict');
const coordinator = require('../prototype/writing-pack-coordinator.js');
const catalog = require('../prototype/writing-pack-catalog.js');

function makePack(overrides = {}) {
  return {
    id: 'pack-x', name: '测试包', layer: 'task', genre: 'article', taskType: 'revision',
    checks: [{ id: 'check-1', statement: '检查项', sourceIds: [], verificationStatus: 'unverified' }],
    ...overrides
  };
}

function makeCoordinator(state, options = {}) {
  const box = { state };
  return coordinator.createWritingPackCoordinator({
    builtinCatalog: catalog.getBuiltinWritingPacks(),
    getState: () => box.state,
    persistState(next) {
      if (options.failWrite) throw new Error('磁盘写入失败');
      box.state = structuredClone(next);
      return box.state;
    }
  }, options);
}

test('读取方法返回防御性副本，外部修改不影响内部状态', () => {
  const state = { writingPacks: [makePack()], writingPackSettings: [] };
  const c = makeCoordinator(state);
  const packs = c.listPacks();
  packs[0].name = '篡改';
  packs.push(makePack({ id: 'another' }));
  assert.equal(c.listPacks().length, 2);
  assert.equal(c.listPacks()[0].name, '普通文章');
  assert.equal(c.getPack('builtin-article').name, '普通文章');
});

test('列出内置、自定义和选中状态；内置不可原地改写', () => {
  const state = {
    writingPacks: [makePack()],
    writingPackSettings: [{ id: 'builtin-article', enabled: false, updatedAt: '2026-10-20' }]
  };
  const c = makeCoordinator(state);
  const packs = c.listPacks();
  const builtin = packs.find(p => p.builtin === true);
  const custom = packs.find(p => p.id === 'pack-x');
  assert.equal(builtin.enabled, false, '停用设置应反映在列表上');
  assert.equal(custom.builtin, false);
  assert.equal(c.getSelection().selectedIds.includes('pack-x'), true, '启用中的包默认选中');
  assert.equal(c.getSelection().selectedIds.includes('builtin-article'), false, '停用的内置包不选中');
  return assert.rejects(() => c.deletePack('builtin-article'), /内置|builtin/i);
});

test('基于内置包编辑生成带 basePackId 的副本，恢复内置移除覆盖', async () => {
  const state = { writingPacks: [], writingPackSettings: [] };
  const c = makeCoordinator(state);
  const copy = await c.updatePack('builtin-article', { name: '我的文章包', checks: [{ id: 'my-check', statement: '我的检查' }] });
  assert.equal(copy.basePackId, 'builtin-article');
  assert.equal(copy.builtin, false);
  assert.equal(copy.name, '我的文章包');
  assert.equal(c.listPacks().some(p => p.id === 'builtin-article'), true, '内置仍在列表');
  assert.equal(c.listPacks().some(p => p.basePackId === 'builtin-article'), true, '副本已保存');
  await c.restoreBuiltin('builtin-article');
  assert.equal(c.listPacks().some(p => p.basePackId === 'builtin-article'), false, '副本已移除');
});

test('自定义包可新建、复制、启用停用和删除；重复 ID 明确冲突', async () => {
  const state = { writingPacks: [], writingPackSettings: [] };
  const c = makeCoordinator(state);
  const created = await c.createPack(makePack({ id: 'custom-1' }));
  assert.equal(created.id, 'custom-1');
  await assert.rejects(() => c.createPack(makePack({ id: 'custom-1' })), /冲突|collision|已存在/i);
  const dup = await c.duplicatePack('custom-1');
  assert.notEqual(dup.id, 'custom-1');
  assert.equal(dup.name.includes('测试包'), true);
  await c.setPackEnabled('custom-1', false);
  assert.equal(c.getPack('custom-1').enabled, false);
  assert.equal(c.getSelection().selectedIds.includes('custom-1'), false, '停用后不选中');
  await c.deletePack(dup.id);
  assert.equal(c.getPack(dup.id), null);
  await assert.rejects(() => c.deletePack('builtin-article'), /内置|builtin/i);
});

test('导入先预览不写入，确认后才保存；同 ID 冲突返回明确冲突', async () => {
  const state = { writingPacks: [makePack({ id: 'custom-1' })], writingPackSettings: [] };
  const c = makeCoordinator(state);
  const incoming = [makePack({ id: 'custom-1', name: '导入包' })];
  const preview = c.previewImport(incoming);
  assert.equal(preview.packs.length, 1);
  assert.deepEqual(preview.collisions, ['custom-1']);
  assert.equal(c.listPacks().length, 2, '预览不写入');
  await assert.rejects(() => c.confirmImport(preview), /冲突|collision/i);
  const fresh = c.previewImport([makePack({ id: 'custom-new' })]);
  await c.confirmImport(fresh);
  assert.equal(c.listPacks().some(p => p.id === 'custom-new'), true, '确认后写入');
});

test('导出只包含用户明确选择的自定义包', () => {
  const state = {
    writingPacks: [makePack({ id: 'custom-1' }), makePack({ id: 'custom-2' })],
    writingPackSettings: []
  };
  const c = makeCoordinator(state);
  const exported = c.exportPacks(['custom-1']);
  assert.deepEqual(exported.map(p => p.id), ['custom-1']);
  assert.throws(() => c.exportPacks(['builtin-article']), /内置|builtin|自定义/i);
});

test('持久化失败时保留原数据并抛出明确错误', async () => {
  const state = { writingPacks: [makePack()], writingPackSettings: [] };
  const c = makeCoordinator(state, { failWrite: true });
  await assert.rejects(() => c.createPack(makePack({ id: 'will-fail' })), /写入失败|persist/i);
  assert.equal(c.listPacks().length, 2, '失败后内存数据不变');
});

test('无持久化依赖时只读操作可用，写操作明确失败', async () => {
  const c = coordinator.createWritingPackCoordinator({
    builtinCatalog: catalog.getBuiltinWritingPacks(),
    getState: () => ({ writingPacks: [makePack()], writingPackSettings: [] })
  });
  assert.equal(c.listPacks().length, 2);
  await assert.rejects(() => c.createPack(makePack({ id: 'no-persist' })), /持久化|persist/i);
});

