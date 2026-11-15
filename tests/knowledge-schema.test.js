const test = require('node:test');
const assert = require('node:assert/strict');
const {
  KNOWLEDGE_TYPES,
  VERIFICATION_STATES,
  normalizeKnowledgeEntry
} = require('../prototype/knowledge-schema.js');

test('知识条目保留统一字段并规范化数组', () => {
  const entry = normalizeKnowledgeEntry({
    id: ' prompt-1 ',
    type: 'user-prompt',
    title: '  一个提示词  ',
    domains: '写作,学习目标',
    stages: ['plan'],
    keywords: '句式, 复盘',
    summary: '短摘要',
    reusablePatterns: '先说明目标',
    verificationStatus: 'unverified'
  });

  assert.equal(entry.id, 'prompt-1');
  assert.equal(entry.title, '一个提示词');
  assert.deepEqual(entry.domains, ['写作', '学习目标']);
  assert.deepEqual(entry.keywords, ['句式', '复盘']);
  assert.equal(entry.type, 'user-prompt');
  assert.equal(entry.verificationStatus, 'unverified');
  assert.equal(typeof entry.updatedAt, 'string');
});

test('未知类型和验证状态回退到安全默认值', () => {
  const entry = normalizeKnowledgeEntry({ id: 'x', type: 'unknown', verificationStatus: 'bad' });
  assert.equal(entry.type, KNOWLEDGE_TYPES.MANUAL_NOTE);
  assert.equal(entry.verificationStatus, VERIFICATION_STATES.UNVERIFIED);
});

test('用户评分空值保留为 null 并限制在 1 到 5 分', () => {
  for (const value of [null, '', false]) {
    assert.equal(normalizeKnowledgeEntry({ userRating: value }).userRating, null);
  }
  assert.equal(normalizeKnowledgeEntry({ userRating: 3 }).userRating, 3);
  assert.equal(normalizeKnowledgeEntry({ userRating: 0 }).userRating, 1);
  assert.equal(normalizeKnowledgeEntry({ userRating: 8 }).userRating, 5);
  assert.equal(normalizeKnowledgeEntry({ userRating: 'not-a-rating' }).userRating, null);
});

test('资料索引元数据有稳定默认值', () => {
  const entry = normalizeKnowledgeEntry({ id: 'manual-1', title: '资料' });

  assert.equal(entry.sourceKind, 'manual');
  assert.equal(entry.sourceId, '');
  assert.equal(entry.hiddenAt, '');
  assert.equal(entry.favorite, false);
  assert.equal(entry.pinned, false);
  assert.equal(entry.lastUsedAt, '');
  assert.deepEqual(entry.customAliases, []);
});

test('资料来源元数据保留受限相对路径、有效抓取时间与能力，不保留本机绝对路径', () => {
  const entry = normalizeKnowledgeEntry({
    id: 'source-1', sourcePath: '  guides\\writing.md  ',
    sourceFetchedAt: '2026-11-12T01:02:03.000Z', sourceFormat: 'Markdown',
    sourceVersion: `sha256:${'a'.repeat(64)}`,
    sourceCapabilities: ['已保存摘要/摘录', '已保存摘要/摘录', '完整原件仍需随附']
  });
  assert.equal(entry.sourcePath, 'guides/writing.md');
  assert.equal(entry.sourceFetchedAt, '2026-11-12T01:02:03.000Z');
  assert.equal(entry.sourceVersion, `sha256:${'a'.repeat(64)}`);
  assert.equal(entry.sourceFormat, 'Markdown');
  assert.deepEqual(entry.sourceCapabilities, ['已保存摘要/摘录', '完整原件仍需随附']);
  assert.equal(normalizeKnowledgeEntry({ sourcePath: 'C:\\Users\\someone\\private.pdf' }).sourcePath, '');
  assert.equal(normalizeKnowledgeEntry({ sourcePath: '../private.pdf' }).sourcePath, '');
  assert.equal(normalizeKnowledgeEntry({ sourceFetchedAt: 'not-a-date' }).sourceFetchedAt, '');
  assert.equal(normalizeKnowledgeEntry({ sourceVersion: 'x'.repeat(300) }).sourceVersion.length, 160);
});
