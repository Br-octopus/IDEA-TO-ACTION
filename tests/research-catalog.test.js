const test = require('node:test');
const assert = require('node:assert/strict');
const { catalog, filterReferences, limitReferences, selectReferences, buildReferenceContext, appendReferenceContext, createSearchStub } = require('../prototype/research-catalog.js');

test('按领域和阶段筛选资料', () => {
  const results = filterReferences(catalog, { domain: '写作', stage: 'review' });
  assert.deepEqual(results.map(item => item.id), ['humanizer-zh']);
});

test('每条精选资料都满足固定字段契约', () => {
  const fields = [
    'id', 'title', 'url', 'sourceType', 'licenseNote', 'domains', 'stages',
    'summary', 'borrowablePatterns', 'limitations', 'updatedAt', 'verification', 'kind'
  ];

  assert.ok(catalog.length > 0);
  for (const item of catalog) {
    for (const field of fields) assert.ok(Object.hasOwn(item, field), `${item.id} 缺少字段 ${field}`);
    assert.equal(typeof item.id, 'string');
    assert.equal(typeof item.title, 'string');
    assert.equal(typeof item.url, 'string');
    assert.equal(typeof item.sourceType, 'string');
    assert.equal(typeof item.licenseNote, 'string');
    assert.ok(Array.isArray(item.domains));
    assert.ok(Array.isArray(item.stages));
    assert.equal(typeof item.summary, 'string');
    assert.equal(typeof item.borrowablePatterns, 'string');
    assert.equal(typeof item.limitations, 'string');
    assert.equal(typeof item.updatedAt, 'string');
    assert.equal(typeof item.verification, 'object');
    assert.equal(typeof item.kind, 'string');
  }
});

test('选择资料最多保留三条', () => {
  assert.equal(limitReferences(catalog, 5).length, 3);
  assert.equal(limitReferences(catalog, 2).length, 2);
});

test('根据当前选择重建上下文，不复用上一次选择的资料', () => {
  const basePrompt = '复盘指令';
  const first = appendReferenceContext(basePrompt, selectReferences([catalog[0].id]));
  const current = appendReferenceContext(basePrompt, selectReferences([catalog[1].id]));

  assert.match(first, new RegExp(catalog[0].title));
  assert.doesNotMatch(first, new RegExp(catalog[1].title));
  assert.match(current, new RegExp(catalog[1].title));
  assert.doesNotMatch(current, new RegExp(catalog[0].title));
});

test('模型上下文只带摘要、方法和来源，不带整篇原文', () => {
  const context = buildReferenceContext([{ ...catalog[0], fullText: '不可发送的整篇原文' }]);
  assert.match(context, /社区提示词目录/);
  assert.match(context, /先按任务筛选/);
  assert.match(context, /https:\/\/github.com\/f\/prompts.chat/);
  assert.doesNotMatch(context, /不可发送的整篇原文/);
});

test('复用已带资料摘要的提示词时不会重复注入', () => {
  const original = '复盘指令';
  const withContext = appendReferenceContext(original, [catalog[0]]);
  const reused = appendReferenceContext(withContext, [catalog[0]]);
  assert.equal(reused, withContext);
  assert.equal((reused.match(/【用户选择的本地资料摘要】/g) || []).length, 1);
});

test('热门资料和目录收录不会自动标记为已验证', () => {
  assert.ok(catalog.every(item => item.verification.status !== 'verified'));
});

test('搜索 stub 明确标记研究未完成并生成可复制指令', () => {
  const result = createSearchStub('本周新的提示词评测方法');
  assert.equal(result.completed, false);
  assert.equal(result.status, '未完成研究');
  assert.match(result.instruction, /本周新的提示词评测方法/);
});
