const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  collectKnowledgeEntries,
  searchKnowledge,
  buildKnowledgeContext
} = require('../prototype/knowledge-search.js');
const { toKnowledgeEntry } = require('../prototype/research-catalog.js');
const { methodCardsToKnowledgeEntries } = require('../prototype/method-cards.js');

function loadBrowserKnowledgeSearch(segmenter) {
  const intl = Object.create(Intl);
  if (arguments.length > 0) intl.Segmenter = segmenter;
  const context = { Intl: intl };
  for (const file of [
    'knowledge-schema.js',
    'method-cards.js',
    'research-catalog.js',
    'knowledge-search.js'
  ]) {
    const filename = require.resolve(`../prototype/${file}`);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  return context;
}

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

test('不同 URL 的公开资料同 id 共存，相同 URL 仍去重', () => {
  const entries = collectKnowledgeEntries({}, {
    references: [
      { id: 'same', title: '资料 A', kind: 'prompt-library', url: 'https://example.com/a' },
      { id: 'same', title: '资料 A 的重复记录', kind: 'prompt-library', url: 'https://example.com/a' },
      { id: 'same', title: '资料 B', kind: 'prompt-library', url: 'https://example.com/b' }
    ]
  });

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(item => item.sourceUrl), [
    'https://example.com/a',
    'https://example.com/b'
  ]);
});

test('同一 URL 即使资料类型不同也只保留一个条目', () => {
  const entries = collectKnowledgeEntries({}, {
    references: [
      {
        id: 'same',
        title: 'GitHub 资料',
        kind: 'prompt-library',
        sourceType: 'GitHub 仓库',
        url: 'https://example.com/same'
      },
      {
        id: 'same',
        title: '文章资料',
        kind: 'guide',
        sourceType: '文章',
        url: 'https://example.com/same'
      }
    ]
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceUrl, 'https://example.com/same');
});

test('URL 规范化后相同来源仍只保留一个条目', () => {
  const entries = collectKnowledgeEntries({}, {
    references: [
      { id: 'same', title: '带片段资料', url: 'https://EXAMPLE.com/same#section' },
      { id: 'same', title: '规范化资料', url: 'https://example.com/same' }
    ]
  });

  assert.equal(entries.length, 1);
});

test('公开资料无 URL 时不因 sourceType 不同而重复', () => {
  const entries = collectKnowledgeEntries({}, {
    references: [
      { id: 'same', title: 'GitHub 资料', sourceType: 'GitHub 仓库' },
      { id: 'same', title: '文章资料', sourceType: '文章' }
    ]
  });

  assert.equal(entries.length, 1);
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

test('案例 nextPrompt 只保留有限长度摘要', () => {
  const nextPrompt = '案例中的完整下一步提示词和可能包含的敏感内容'.repeat(100);
  const entry = collectKnowledgeEntries({
    cases: [{ id: 'long', confirmed: true, status: '成功', nextPrompt }]
  }).find(item => item.id === 'case-long');

  assert.equal(entry.contentExcerpt.length, 240);
  assert.equal(entry.contentExcerpt, nextPrompt.slice(0, 240));
  assert.equal(entry.contentExcerpt.includes(nextPrompt.slice(240)), false);
});

test('只有 verified === true 的提示词才标记为用户确认', () => {
  const entries = collectKnowledgeEntries({
    prompts: [
      { id: 'confirmed', title: '已确认', verified: true },
      { id: 'string-false', title: '字符串假值', verified: 'false' },
      { id: 'missing', title: '未验证' }
    ]
  });

  assert.equal(entries.find(item => item.id === 'prompt-confirmed').verificationStatus, 'user-confirmed');
  assert.equal(entries.find(item => item.id === 'prompt-string-false').verificationStatus, 'unverified');
  assert.equal(entries.find(item => item.id === 'prompt-missing').verificationStatus, 'unverified');
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

const searchableEntries = [
  {
    id: 'writing', type: 'method-card', title: '写作方法', domains: ['写作'], stages: ['review'],
    keywords: ['句式', '节奏'], summary: '检查文章句式和节奏', reusablePatterns: '引用具体片段说明问题'
  },
  {
    id: 'software', type: 'success-case', title: '软件开发案例', domains: ['软件开发'], stages: ['plan'],
    keywords: ['验收'], summary: '先定义测试和验收标准', reusablePatterns: '拆成可验证的小步骤'
  }
];

test('中文查询优先返回标题和关键词命中的资料', () => {
  const result = searchKnowledge(searchableEntries, '句式 节奏', { limit: 5 });
  assert.equal(result[0].id, 'writing');
  assert.ok(result[0].score > 0);
  assert.ok(result[0].matchedFields.includes('keywords'));
});

test('搜索结果明确记录命中的查询词', () => {
  const result = searchKnowledge(searchableEntries, '句式 节奏', { limit: 5 });

  assert.deepEqual(result[0].matchedTerms, ['句式', '节奏']);
});

test('标题命中按高于摘要的字段权重计分并排在前面', () => {
  const entries = [
    { id: 'summary-hit', type: 'test-entry', title: '低权重资料', summary: 'needle' },
    { id: 'title-hit', type: 'test-entry', title: 'needle', summary: '其他内容' }
  ];

  const result = searchKnowledge(entries, 'needle', { limit: 5 });

  assert.deepEqual(result.map(item => item.id), ['title-hit', 'summary-hit']);
  assert.deepEqual(result.map(item => item.score), [8, 3]);
  assert.deepEqual(result.map(item => item.matchedFields), [['title'], ['summary']]);
});

test('搜索可以按领域、阶段和类型过滤', () => {
  const result = searchKnowledge(searchableEntries, '标准', {
    domain: '软件开发', stage: 'plan', types: ['success-case'], limit: 5
  });
  assert.deepEqual(result.map(item => item.id), ['software']);
});

test('空查询保留全部资料且无结果查询返回空列表', () => {
  const emptyQueryResult = searchKnowledge(searchableEntries, '   ');
  assert.equal(emptyQueryResult.length, searchableEntries.length);
  assert.ok(emptyQueryResult.every(item => item.score === 0));
  assert.deepEqual(searchKnowledge(searchableEntries, 'qzxv-unique-token-8271'), []);
});

test('搜索可以按验证状态筛选', () => {
  const entries = [
    { id: 'confirmed', title: '搜索目标', summary: '搜索目标', verificationStatus: 'user-confirmed' },
    { id: 'unverified', title: '搜索目标', summary: '搜索目标', verificationStatus: 'unverified' }
  ];

  const result = searchKnowledge(entries, '搜索目标', { verificationStatus: 'unverified' });
  assert.deepEqual(result.map(item => item.id), ['unverified']);
});

test('相同分数且标题相同的结果保持输入顺序', () => {
  const entries = [
    { id: 'first', title: '同名资料', summary: '共同查询词' },
    { id: 'second', title: '同名资料', summary: '共同查询词' }
  ];

  const result = searchKnowledge(entries, '共同查询词');
  assert.equal(result[0].score, result[1].score);
  assert.deepEqual(result.map(item => item.id), ['first', 'second']);
});

test('搜索限制将 NaN 和未提供值设为 10，并将数值夹在 1 到 20', () => {
  const entries = Array.from({ length: 25 }, (_, index) => ({
    id: `entry-${index}`,
    title: `搜索资料 ${index}`,
    summary: '目标查询词'
  }));

  assert.equal(searchKnowledge(entries, '目标查询词').length, 10);
  assert.equal(searchKnowledge(entries, '目标查询词', { limit: Number.NaN }).length, 10);
  assert.equal(searchKnowledge(entries, '目标查询词', { limit: -1 }).length, 1);
  assert.equal(searchKnowledge(entries, '目标查询词', { limit: 0 }).length, 1);
  assert.equal(searchKnowledge(entries, '目标查询词', { limit: 21 }).length, 20);
});

test('浏览器 UMD 入口使用依赖脚本导出统一搜索全局', () => {
  const context = loadBrowserKnowledgeSearch();
  const api = context.ForwardStepKnowledgeSearch;

  assert.equal(typeof api.collectKnowledgeEntries, 'function');
  assert.equal(typeof api.searchKnowledge, 'function');
  assert.equal(typeof api.buildKnowledgeContext, 'function');
  assert.equal(api.searchKnowledge(searchableEntries, '句式')[0].id, 'writing');
});

test('缺少 Intl.Segmenter 时中文正则回退仍能命中', () => {
  const context = loadBrowserKnowledgeSearch(undefined);
  const result = context.ForwardStepKnowledgeSearch.searchKnowledge(
    [{ id: 'chinese', title: '中文搜索词', summary: '适合中文检索' }],
    '中文 搜索'
  );

  assert.deepEqual(Array.from(result, item => item.id), ['chinese']);
});

test('缺少 Intl.Segmenter 时单字中文查询只返回标题命中资料并计分', () => {
  const context = loadBrowserKnowledgeSearch(undefined);
  const result = context.ForwardStepKnowledgeSearch.searchKnowledge(
    [
      { id: 'writing', title: '写作指南' },
      { id: 'reading', title: '阅读指南' }
    ],
    '作'
  );

  assert.deepEqual(Array.from(result, item => item.id), ['writing']);
  assert.ok(result[0].score > 0);
});

test('Intl.Segmenter 构造失败时中文正则回退仍能命中', () => {
  const context = loadBrowserKnowledgeSearch(function Segmenter() {
    throw new Error('当前运行环境不支持 Segmenter 配置');
  });
  const result = context.ForwardStepKnowledgeSearch.searchKnowledge(
    [{ id: 'chinese', title: '中文搜索词', summary: '适合中文检索' }],
    '中文 搜索'
  );

  assert.deepEqual(Array.from(result, item => item.id), ['chinese']);
});

test('模型上下文只包含摘要、方法和来源，不包含完整原文', () => {
  const context = buildKnowledgeContext([{
    id: 'x', title: '案例', sourceUrl: 'https://example.com', summary: '短摘要',
    reusablePatterns: '可借鉴方法', verificationStatus: 'unverified', limitations: '仅适用于小范围试验',
    contentExcerpt: '不应默认发送的长原文',
    before: '原稿', after: '改稿'
  }], { maxChars: 1000 });
  assert.match(context, /短摘要/);
  assert.match(context, /可借鉴方法/);
  assert.match(context, /unverified/);
  assert.match(context, /仅适用于小范围试验/);
  assert.match(context, /https:\/\/example.com/);
  assert.equal(context.includes('不应默认发送的长原文'), false);
  assert.equal(context.includes('原稿'), false);
});

test('模型上下文最多包含五条且不会越过长度限制或带入原文字段', () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    id: `context-${index + 1}`,
    title: index === 4 ? '超限资料' : `上下文资料-${index + 1}`,
    summary: index === 4 ? '超长摘要'.repeat(2000) : `摘要-${index + 1}`,
    reusablePatterns: index === 4 ? '超长方法'.repeat(2000) : `方法-${index + 1}`,
    verificationStatus: 'unverified',
    limitations: `边界-${index + 1}`,
    sourceType: '本地资料',
    contentExcerpt: `全文标记-${index + 1}`,
    before: `前文标记-${index + 1}`,
    after: `后文标记-${index + 1}`
  }));
  const fiveEntryContext = buildKnowledgeContext(entries.map((entry, index) => ({
    ...entry,
    title: `上下文资料-${index + 1}`,
    summary: `摘要-${index + 1}`,
    reusablePatterns: `方法-${index + 1}`
  })), { maxChars: 5000 });
  const boundedContext = buildKnowledgeContext(entries, { maxChars: 900 });
  const includedTitles = fiveEntryContext.match(/上下文资料-\d/g) || [];

  assert.equal(includedTitles.length, 5);
  assert.equal(fiveEntryContext.includes('上下文资料-6'), false);
  assert.ok(boundedContext.length <= 900);
  assert.equal(boundedContext.includes('超限资料'), false);
  assert.equal(boundedContext.includes('上下文资料-6'), false);
  for (let index = 1; index <= 6; index += 1) {
    assert.equal(boundedContext.includes(`全文标记-${index}`), false);
    assert.equal(boundedContext.includes(`前文标记-${index}`), false);
    assert.equal(boundedContext.includes(`后文标记-${index}`), false);
  }
});
