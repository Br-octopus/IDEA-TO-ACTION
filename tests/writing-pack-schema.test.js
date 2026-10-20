const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const schema = require('../prototype/writing-pack-schema.js');

const packInput = {
  id: 'custom-pack', name: '自定义包', layer: 'task', genre: 'article', taskType: 'review', version: 2,
  builtin: true, basePackId: 'builtin-article', enabled: true,
  applicability: { tasks: ['review'], languages: ['zh'], exclusions: ['其他文体'], apiKey: 'secret' },
  clarifications: [{ id: 'q1', question: '目标是什么？', required: true, when: '开始前', credentials: { password: 'secret' } }],
  materials: [{ id: 'm1', purpose: '背景', required: false, acceptedTypes: ['md'], accessToken: 'secret' }],
  requirements: [{ id: 'r1', statement: '有依据', sourceIds: ['s1'], verificationStatus: 'source-reviewed' }],
  methods: [{ id: 'method1', title: '检查', guidance: '逐项检查', applicability: ['review'], sourceIds: ['s1'], verificationStatus: 'case-validated' }],
  prompts: [{ id: 'p1', taskType: 'review', content: '不要补造事实', sourceIds: ['s1'], verificationStatus: 'unverified' }],
  structures: [{ id: 'st1', taskType: 'review', sections: ['结论', '依据'] }],
  style: [{ id: 'style1', statement: '清楚具体', sourceIds: ['s1'], verificationStatus: 'unverified' }],
  terminology: [{ id: 'term1', term: '依据', definition: '支持判断的信息', sourceIds: ['s1'] }],
  evidenceRules: [{ id: 'e1', statement: '论断回指来源', sourceIds: ['s1'], verificationStatus: 'unverified' }],
  routes: [{ id: 'route1', stages: [{ id: 'stage1', inputs: ['draft'], outputs: ['review'], checks: ['c1'], skippable: false, returnWhenMissing: ['draft'] }] }],
  checks: [{ id: 'c1', statement: '检查具体内容', sourceIds: ['s1'], verificationStatus: 'unverified' }],
  repairs: [{ id: 'fix1', issue: '缺少目标', action: '先澄清', sourceIds: ['s1'] }],
  nextSteps: [{ id: 'next1', when: '目标明确', action: '开始诊断', sourceIds: ['s1'] }],
  examples: [{ id: 'ex1', kind: 'positive', taskType: 'review', input: '稿件', prompt: '检查稿件', result: '列出问题', notes: '仅示范格式', verificationStatus: 'unverified' }],
  sources: [{ id: 's1', title: '来源', url: 'https://example.test/source', locator: '第 1 节', version: '1', license: '待核对', checkedAt: '未核对', applicability: '一般说明', limitations: '未经独立验证', password: 'secret' }],
  createdAt: '2026-10-20', updatedAt: '2026-10-20', unknown: 'drop'
};

test('写作包规范化保留完整契约并过滤所有嵌套未知字段和凭证', () => {
  const pack = schema.normalizeWritingPack(packInput);
  assert.deepEqual(Object.keys(pack), ['id', 'name', 'layer', 'genre', 'taskType', 'version', 'builtin', 'basePackId', 'enabled', 'applicability', 'clarifications', 'materials', 'requirements', 'methods', 'prompts', 'structures', 'style', 'terminology', 'evidenceRules', 'routes', 'checks', 'repairs', 'nextSteps', 'examples', 'sources', 'createdAt', 'updatedAt']);
  assert.equal(pack.builtin, false);
  assert.equal(pack.applicability.tasks[0], 'review');
  assert.equal(pack.clarifications[0].required, true);
  assert.equal(pack.materials[0].acceptedTypes[0], 'md');
  assert.equal(pack.methods[0].verificationStatus, 'case-validated');
  assert.equal(pack.sources[0].url, 'https://example.test/source');
  assert.equal(JSON.stringify(pack).includes('secret'), false);
  assert.equal('unknown' in pack, false);
  assert.deepEqual(schema.normalizeWritingPack(pack), pack);
});

test('拒绝无效层级、验证状态和非正整数版本', () => {
  for (const layer of ['core', 'genre', 'task']) assert.equal(schema.normalizeWritingPack({ ...packInput, layer }).layer, layer);
  for (const layer of ['other', '', null]) assert.throws(() => schema.normalizeWritingPack({ ...packInput, layer }), /layer|层级/);
  for (const status of ['unverified', 'source-reviewed', 'case-validated']) assert.equal(schema.normalizeWritingPack({ ...packInput, requirements: [{ id: 'r', statement: '规则', verificationStatus: status }] }).requirements[0].verificationStatus, status);
  for (const status of ['verified', 'user-confirmed']) assert.throws(() => schema.normalizeWritingPack({ ...packInput, requirements: [{ id: 'r', statement: '规则', verificationStatus: status }] }), /verificationStatus|验证状态/);
  for (const version of [0, -1, 1.5, true, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => schema.normalizeWritingPack({ ...packInput, version }), /version|正安全整数/);
});

test('包内各条目与来源 ID 唯一，且文本、数组和集合数量受限', () => {
  assert.throws(() => schema.normalizeWritingPack({ ...packInput, checks: [{ id: 'x', statement: '一' }, { id: 'x', statement: '二' }] }), /唯一|重复/);
  assert.throws(() => schema.normalizeWritingPack({ ...packInput, sources: [{ id: 's1', title: '一' }, { id: 's1', title: '二' }] }), /唯一|重复/);
  assert.throws(() => schema.normalizeWritingPack({ ...packInput, sources: [{ id: '', title: '来源' }] }), /id|ID/);
  const pack = schema.normalizeWritingPack({ ...packInput, name: '名'.repeat(2000), checks: Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, statement: '检查' })) });
  assert.ok(pack.name.length <= schema.WRITING_PACK_LIMITS.text);
  assert.ok(pack.checks.length <= schema.WRITING_PACK_LIMITS.itemsPerCollection);
  assert.ok(pack.applicability.tasks.length <= schema.WRITING_PACK_LIMITS.listItems);
});

test('设置和包集合使用白名单、唯一 ID 与有界条目', () => {
  const setting = schema.normalizeWritingPackSettings({ id: 'builtin-article', enabled: false, updatedAt: 'today', apiKey: 'secret' });
  assert.deepEqual(setting, { id: 'builtin-article', enabled: false, updatedAt: 'today' });
  assert.throws(() => schema.normalizeWritingPackSettings({ id: '', enabled: true }), /id|ID/);
  const collection = schema.normalizeWritingPackCollection([packInput, { ...packInput, id: 'second', builtin: true }]);
  assert.equal(collection.length, 2);
  assert.ok(collection.every(item => item.builtin === false));
  assert.throws(() => schema.normalizeWritingPackCollection([packInput, packInput]), /唯一|重复/);
  assert.ok(schema.normalizeWritingPackCollection(Array.from({ length: 100 }, (_, i) => ({ ...packInput, id: `p${i}` }))).length <= schema.WRITING_PACK_LIMITS.packs);
});

test('异常输入安全降级且不修改调用方对象', () => {
  for (const input of [undefined, null, [], 'x', 1, false, Symbol('x')]) assert.doesNotThrow(() => schema.normalizeWritingPack(input));
  const input = structuredClone(packInput);
  const original = JSON.stringify(input);
  schema.normalizeWritingPack(input);
  assert.equal(JSON.stringify(input), original);
});

test('schema 以 WritingPackSchema 名称提供 UMD 全局导出', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-pack-schema.js'), 'utf8'), context);
  assert.equal(typeof context.WritingPackSchema.normalizeWritingPack, 'function');
  assert.equal(JSON.stringify(context.WritingPackSchema.normalizeWritingPack(packInput)), JSON.stringify(schema.normalizeWritingPack(packInput)));
});
