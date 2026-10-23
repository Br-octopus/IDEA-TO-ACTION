const test = require('node:test');
const assert = require('node:assert/strict');
const coordinator = require('../prototype/writing-pack-coordinator.js');
const catalog = require('../prototype/writing-pack-catalog.js');
const BUILTIN_PACK_COUNT = catalog.getBuiltinWritingPacks().length;

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
  assert.equal(c.listPacks().length, BUILTIN_PACK_COUNT + 1);
  assert.equal(c.listPacks().some(pack => pack.id === 'builtin-academic-review'), true);
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
  assert.equal(c.listPacks().length, BUILTIN_PACK_COUNT + 1, '预览不写入');
  await assert.rejects(() => c.confirmImport(preview), /冲突|collision/i);
  const fresh = c.previewImport([makePack({ id: 'custom-new' })]);
  await c.confirmImport(fresh);
  assert.equal(c.listPacks().some(p => p.id === 'custom-new'), true, '确认后写入');
});

test('导入预览将所有来源和内容核验状态降级为未核验', () => {
  const c = makeCoordinator({ writingPacks: [], writingPackSettings: [] });
  const preview = c.previewImport([makePack({
    id: 'imported-reviewed-pack',
    requirements: [{ id: 'requirement', statement: '要求', verificationStatus: 'case-validated' }],
    sources: [{ id: 'source', title: '来源', verificationStatus: 'source-reviewed' }]
  })]);

  assert.equal(preview.packs[0].requirements[0].verificationStatus, 'unverified');
  assert.equal(preview.packs[0].sources[0].verificationStatus, 'unverified');
});

test('批量选择持久化自定义包状态到包本身，默认启用状态写入内置覆盖集合', async () => {
  const state = {
    writingPacks: [makePack({ id: 'custom-batch', enabled: true })],
    writingPackSettings: [{ id: 'builtin-article', enabled: false, updatedAt: '2026-10-20' }]
  };
  const c = makeCoordinator(state);
  const expectedBuiltinSettings = catalog.getBuiltinWritingPacks()
    .filter(pack => pack.enabled !== false)
    .map(pack => ({ id: pack.id, enabled: false }));

  await c.selectPacks([]);

  assert.equal(state.writingPacks[0].enabled, false);
  assert.deepEqual(state.writingPackSettings.map(({ id, enabled }) => ({ id, enabled })), [
    ...expectedBuiltinSettings
  ]);
  const reloaded = makeCoordinator(structuredClone(state));
  assert.deepEqual(reloaded.getSelection().selectedIds, []);
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
  assert.equal(c.listPacks().length, BUILTIN_PACK_COUNT + 1, '失败后内存数据不变');
});

test('无持久化依赖时只读操作可用，写操作明确失败', async () => {
  const c = coordinator.createWritingPackCoordinator({
    builtinCatalog: catalog.getBuiltinWritingPacks(),
    getState: () => ({ writingPacks: [makePack()], writingPackSettings: [] })
  });
  assert.equal(c.listPacks().length, BUILTIN_PACK_COUNT + 1);
  await assert.rejects(() => c.createPack(makePack({ id: 'no-persist' })), /持久化|persist/i);
});

test('编辑专业包条目会撤销该条目及嵌套路线的旧验证状态，纯名称变化不降级', async () => {
  const pack = makePack({
    methods: [{ id: 'method-a', title: '方法', guidance: '原指导', verificationStatus: 'case-validated' }],
    routes: [{ id: 'route-a', title: '路线', verificationStatus: 'case-validated', stages: [
      { id: 'stage-a', title: '步骤', inputs: ['稿件'], verificationStatus: 'case-validated' }
    ] }]
  });
  const state = { writingPacks: [pack], writingPackSettings: [] };
  const c = makeCoordinator(state);
  await c.updatePack(pack.id, { name: '新展示名称' });
  assert.equal(c.getPack(pack.id).methods[0].verificationStatus, 'case-validated');
  await c.updatePack(pack.id, { methods: [{ ...c.getPack(pack.id).methods[0], guidance: '新指导' }] });
  assert.equal(c.getPack(pack.id).methods[0].verificationStatus, 'unverified');
  await c.updatePack(pack.id, { routes: [{ ...c.getPack(pack.id).routes[0], stages: [
    { ...c.getPack(pack.id).routes[0].stages[0], inputs: ['新稿件'] }
  ] }] });
  assert.equal(c.getPack(pack.id).routes[0].verificationStatus, 'unverified');
  assert.equal(c.getPack(pack.id).routes[0].stages[0].verificationStatus, 'unverified');
});

test('内置包先保存已接受基线，更新差异需显式接受并保留用户副本', async () => {
  const builtins = structuredClone(catalog.getBuiltinWritingPacks());
  const state = { writingPacks: [], writingPackSettings: [] };
  const c = coordinator.createWritingPackCoordinator({
    builtinCatalog: builtins, getState: () => state,
    persistState(next) { Object.assign(state, structuredClone(next)); return state; }
  });
  await c.initializeBuiltinBaselines();
  const base = c.getPack('builtin-article');
  const copy = await c.updatePack('builtin-article', { name: '我的保留副本' });
  builtins[builtins.findIndex(pack => pack.id === 'builtin-article')] = {
    ...base, version: base.version + 1,
    checks: [...base.checks, { id: 'new-release-check', statement: '新规则' }]
  };
  const preview = c.previewBuiltinUpdate('builtin-article');
  assert.equal(preview.available, true);
  assert.ok(preview.changes.some(item => item.field === 'checks' && item.added === 1));
  assert.equal(c.getPack('builtin-article').version, base.version, '未接受前新轮仍读已接受基线');
  assert.equal(state.writingPackSettings.find(item => item.id === 'builtin-article').acceptedVersion, base.version);
  await c.acceptBuiltinUpdate('builtin-article');
  assert.equal(c.previewBuiltinUpdate('builtin-article').available, false);
  assert.equal(c.getPack('builtin-article').version, base.version + 1, '接受后新轮读取新版本');
  assert.equal(c.getPack(copy.id).name, '我的保留副本');
});
