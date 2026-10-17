const test = require('node:test');
const assert = require('node:assert/strict');
const { collectKnowledgeEntries } = require('../prototype/knowledge-search.js');
const { toKnowledgeEntry } = require('../prototype/research-catalog.js');
const { methodCardsToKnowledgeEntries } = require('../prototype/method-cards.js');

test('统一索引包含公开资料、提示词、方法卡和已确认案例', () => {
  const entries = collectKnowledgeEntries({
    prompts: [{ id: 'p1', title: '写作提示词', text: '保留观点', note: '保留事实' }],
    cases: [
      { id: 'c1', confirmed: true, status: '成功', lessons: '先定义验收标准' },
      { id: 'c2', confirmed: false, status: '成功', lessons: '不应进入经验库' }
    ],
    knowledgeEntries: [{ id: 'm1', type: 'article-summary', title: '文章教程', summary: '句式节奏' }]
  }, {
    references: [{ id: 'r1', title: '公开资料', summary: '目标澄清' }],
    methodCards: [{ id: 'writing', title: '写作方法', guidance: '检查句式' }]
  });

  assert.ok(entries.some(item => item.id === 'prompt-p1' && item.type === 'user-prompt'));
  assert.ok(entries.some(item => item.id === 'case-c1' && item.type === 'success-case'));
  assert.equal(entries.some(item => item.id === 'case-c2'), false);
  assert.ok(entries.some(item => item.id === 'r1' && item.type === 'github-summary'));
  assert.ok(entries.some(item => item.id === 'method-writing' && item.type === 'method-card'));
  assert.ok(entries.some(item => item.id === 'm1' && item.type === 'article-summary'));
});

test('同一来源重复 id 只保留一个条目且公开资料保持未验证', () => {
  const entries = collectKnowledgeEntries(
    {},
    {
      references: [
        { id: 'r1', title: '公开资料', summary: '原始来源' },
        { id: 'r1', title: '重复公开资料', summary: '重复来源' }
      ]
    }
  );

  assert.equal(entries.filter(item => item.id === 'r1').length, 1);
  assert.equal(entries[0].verificationStatus, 'unverified');
});

test('不同来源使用同名 id 时各自保留，同一来源仍然去重', () => {
  const entries = collectKnowledgeEntries({
    prompts: [
      { id: 'same', title: '提示词一' },
      { id: 'same', title: '提示词二' }
    ],
    cases: [
      { id: 'same', confirmed: true, status: '成功' },
      { id: 'same', confirmed: true, status: '失败' }
    ],
    knowledgeEntries: [
      { id: 'same', type: 'manual-note', title: '手动条目一' },
      { id: 'same', type: 'manual-note', title: '手动条目二' }
    ]
  }, {
    references: [
      { id: 'same', title: '公开资料一' },
      { id: 'same', title: '公开资料二' }
    ],
    methodCards: [
      { id: 'same', title: '方法卡一' },
      { id: 'same', title: '方法卡二' }
    ]
  });

  assert.equal(entries.length, 5);
  assert.equal(entries.filter(item => item.id === 'same').length, 2);
  assert.equal(entries.filter(item => item.id === 'prompt-same').length, 1);
  assert.equal(entries.filter(item => item.id === 'case-same').length, 1);
  assert.equal(entries.filter(item => item.id === 'method-same').length, 1);
  assert.ok(entries.some(item => item.id === 'same' && item.type === 'github-summary'));
  assert.ok(entries.some(item => item.id === 'same' && item.type === 'manual-note'));
});

test('转换公开资料和提示词时只保留摘要与正文摘录', () => {
  const reference = toKnowledgeEntry({
    id: 'guide-1',
    kind: 'guide',
    title: '文章教程',
    sourceType: '文章',
    summary: '短摘要',
    url: 'https://example.com/guide'
  });
  const longText = '完整提示词正文'.repeat(100);
  const prompt = collectKnowledgeEntries({
    prompts: [{ id: 'p1', title: '提示词', text: longText, note: '测试记录' }]
  }).find(item => item.id === 'prompt-p1');

  assert.equal(reference.type, 'article-summary');
  assert.equal(reference.verificationStatus, 'unverified');
  assert.equal(reference.summary, '短摘要');
  assert.equal(prompt.summary, '测试记录');
  assert.equal(prompt.contentExcerpt.length, 240);
  assert.equal(prompt.summary.includes(longText), false);
});

test('方法卡转换导出统一条目', () => {
  const entries = methodCardsToKnowledgeEntries([{ id: 'writing', title: '写作方法', guidance: '检查句式' }]);
  assert.deepEqual(entries.map(item => item.id), ['method-writing']);
  assert.equal(entries[0].type, 'method-card');
  assert.equal(entries[0].verificationStatus, 'source-reviewed');
  assert.equal(entries[0].reusablePatterns, '检查句式');
});

test('缺少来源 id 时不会生成只有前缀的条目', () => {
  const entries = collectKnowledgeEntries({
    prompts: [{ title: '无 id 提示词' }],
    cases: [{ confirmed: true, status: '成功' }]
  }, {
    methodCards: [{ title: '无 id 方法卡' }]
  });

  assert.deepEqual(entries, []);
});
