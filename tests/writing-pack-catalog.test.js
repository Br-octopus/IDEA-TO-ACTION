const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const catalog = require('../prototype/writing-pack-catalog.js');
const workbench = require('../prototype/writing-workbench-schema.js');

test('catalog 的普通文章内置包等价于现有 article 配置并含完整规则内容', () => {
  const packs = catalog.getBuiltinWritingPacks();
  const pack = packs.find(item => item.id === 'builtin-article');
  const config = workbench.WRITING_GENRE_CONFIGS.article;
  assert.ok(pack);
  assert.equal(pack.builtin, true);
  assert.equal(pack.layer, 'genre');
  assert.equal(pack.genre, 'article');
  assert.equal(pack.applicability.description, config.applicability);
  assert.deepEqual(pack.targetFields, config.targetFields);
  assert.deepEqual(pack.checkDimensions, config.checkDimensions);
  assert.deepEqual(pack.outputRequirements, config.outputRequirements);
  assert.deepEqual(pack.riskReminders, config.riskReminders);
  assert.deepEqual(pack.styleBaseline, config.styleBaseline);
  assert.equal(pack.memoryNamespace, config.memoryNamespace);
  assert.deepEqual(pack.checks.map(item => item.statement), config.checkDimensions);
  assert.deepEqual(pack.style.map(item => item.statement), config.styleBaseline);
  assert.deepEqual(pack.repairs.map(item => item.action), config.riskReminders);
  assert.deepEqual(pack.prompts.map(item => item.content), Object.values(config.outputRequirements));
  assert.deepEqual(pack.applicability.exclusions, ['其他文体需确认按普通文章处理。']);
  assert.ok(pack.sources.length > 0);
  assert.ok(pack.sources.every(source => source.verificationStatus === 'unverified'));
  assert.ok([...pack.checks, ...pack.style, ...pack.repairs, ...pack.prompts].every(item => item.verificationStatus === 'unverified'));
});

test('catalog 返回深层不可变副本', () => {
  const packs = catalog.getBuiltinWritingPacks();
  const freezeDeep = value => {
    if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value));
      Object.values(value).forEach(freezeDeep);
    }
  };
  freezeDeep(packs);
  assert.throws(() => packs[0].checks.push({ id: 'fake', statement: '篡改' }), TypeError);
  packs[0].sources[0].title = '篡改';
  assert.equal(packs[0].sources[0].title, '现有普通文章规则');
  assert.equal(catalog.getBuiltinWritingPacks()[0].sources[0].title, '现有普通文章规则');
});

test('catalog 工厂不接受输入覆盖 builtin 且 UMD 全局可调用', () => {
  const { normalizeWritingPack } = require('../prototype/writing-pack-schema.js');
  const custom = normalizeWritingPack({ id: 'custom', name: '用户包', layer: 'task', version: 1, builtin: true, basePackId: 'builtin-article' });
  assert.equal(custom.builtin, false);
  const context = vm.createContext({});
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-pack-catalog.js'), 'utf8'), context);
  assert.equal(typeof context.WritingPackCatalog.getBuiltinWritingPacks, 'function');
  assert.equal(context.WritingPackCatalog.getBuiltinWritingPacks()[0].id, 'builtin-article');
});

test('浏览器 UMD 遇到旧版或残缺普通文章配置时安全使用基线默认值', () => {
  const source = readFileSync(require.resolve('../prototype/writing-pack-catalog.js'), 'utf8');
  const schemaSource = readFileSync(require.resolve('../prototype/writing-pack-schema.js'), 'utf8');
  for (const workbench of [
    {},
    { WRITING_GENRE_CONFIGS: { article: {} } },
    { WRITING_GENRE_CONFIGS: { article: { targetFields: { title: '标题' }, outputRequirements: { revision: '保留观点' } } } }
  ]) {
    const context = vm.createContext({ WritingWorkbenchSchema: workbench });
    vm.runInContext(schemaSource, context);
    vm.runInContext(source, context);
    const pack = context.WritingPackCatalog.getBuiltinWritingPacks()[0];
    assert.equal(pack.id, 'builtin-article');
    assert.equal(pack.memoryNamespace, 'article');
    assert.equal(pack.checkDimensions.length, 8);
    assert.deepEqual(Object.keys(pack.outputRequirements), ['diagnosis', 'revision']);
    assert.equal(pack.targetFields.goal, '目标');
  }
});

test('没有 globalThis 的 UMD 环境仍能调用内置包 catalog', () => {
  const schemaSource = readFileSync(require.resolve('../prototype/writing-pack-schema.js'), 'utf8');
  const catalogSource = readFileSync(require.resolve('../prototype/writing-pack-catalog.js'), 'utf8');
  const workbenchSource = readFileSync(require.resolve('../prototype/writing-workbench-schema.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(workbenchSource, context);
  vm.runInContext('delete globalThis.globalThis', context);
  vm.runInContext(schemaSource, context);
  vm.runInContext(catalogSource, context);
  assert.equal(context.WritingPackCatalog.getBuiltinWritingPacks()[0].id, 'builtin-article');
});
