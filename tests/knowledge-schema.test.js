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
