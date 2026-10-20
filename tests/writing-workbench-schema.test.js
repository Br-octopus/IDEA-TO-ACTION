const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../prototype/writing-workbench-schema.js');

test('普通文章类型默认值和文章保存开关', () => {
  const article = schema.normalizeWritingArticle({ title: '  我的文章  ' });

  assert.equal(article.genre, 'article');
  assert.equal(article.saveEnabled, true);
  assert.equal(article.title, '我的文章');
  assert.equal(schema.normalizeWritingArticle({ genre: 'novel' }).genre, '');
  assert.equal(schema.normalizeWritingArticle({ saveEnabled: false }).saveEnabled, false);
  assert.equal(schema.normalizeWritingArticle({ saveEnabled: true }).saveEnabled, true);
  for (const value of [null, 0, 1, 'false', {}, []]) {
    assert.equal(schema.normalizeWritingArticle({ saveEnabled: value }).saveEnabled, true);
  }
});

test('文章字段保留目标、受众、正文引用和来源文章 ID', () => {
  const article = schema.normalizeWritingArticle({
    id: 'article-1',
    title: '产品说明',
    genre: 'article',
    goal: '解释产品如何工作',
    audience: '第一次接触的用户',
    sourceArticleId: 'source-article-9',
    draft: '当前稿件',
    unknownField: '丢弃'
  });

  assert.deepEqual(article, {
    id: 'article-1',
    title: '产品说明',
    genre: 'article',
    goal: '解释产品如何工作',
    audience: '第一次接触的用户',
    constraints: '',
    sourceArticleId: 'source-article-9',
    draft: '当前稿件',
    saveEnabled: true,
    styleProfileId: '',
    createdAt: '',
    updatedAt: ''
  });
  assert.equal('unknownField' in article, false);
});

test('轮次保存稿件、反馈和撤销信息，并限制轮次数量字段', () => {
  const round = schema.normalizeWritingRound({
    id: 'round-1',
    articleId: 'article-1',
    draft: '  新一轮稿件  ',
    feedback: '  请减少空泛总结  ',
    userFeedback: '增加具体例子',
    revisionNote: '依据上一轮诊断',
    undo: {
      action: 'remember-preference',
      memoryId: 'memory-1',
      roundId: 'round-0',
      undoneAt: '2026-10-20T10:00:00Z'
    },
    extra: '丢弃'
  });

  assert.equal(round.draft, '新一轮稿件');
  assert.equal(round.feedback, '请减少空泛总结');
  assert.equal(round.userFeedback, '增加具体例子');
  assert.deepEqual(round.undo, {
    action: 'remember-preference',
    memoryId: 'memory-1',
    roundId: 'round-0',
    undoneAt: '2026-10-20T10:00:00Z'
  });
  assert.equal('extra' in round, false);
  assert.equal(schema.normalizeWritingRound({}).id, '');
});

test('材料用途只允许内容、风格或两者', () => {
  for (const purpose of ['content', 'style', 'both']) {
    const material = schema.normalizeWritingRound({
      materials: [{ id: 'm1', title: '材料', purpose, excerpt: '片段', sourceArticleId: 'source-1', unknown: '丢弃', apiKey: 'secret' }]
    }).materials[0];
    assert.equal(material.purpose, purpose);
    assert.equal(material.title, '材料');
    assert.equal(material.sourceArticleId, 'source-1');
    assert.equal('unknown' in material, false);
    assert.equal('apiKey' in material, false);
  }

  assert.equal(schema.normalizeWritingRound({ materials: [{ id: 'm1', purpose: 'research' }] }).materials[0].purpose, 'content');
});

test('风格档案记录来源、把握度和有限样本', () => {
  const profile = schema.normalizeWritingStyleProfile({
    source: 'user-corrected',
    confidence: 'high',
    traits: ['具体', '克制'],
    samples: [{ sourceArticleId: 'article-7', excerpt: '示例片段', features: ['短句'], unknown: '丢弃', accessToken: 'secret' }],
    sourceArticleIds: ['article-7', 'article-8'],
    unsupported: '丢弃'
  });

  assert.equal(profile.source, 'user-corrected');
  assert.equal(profile.confidence, 'high');
  assert.deepEqual(profile.traits, ['具体', '克制']);
  assert.equal(profile.samples[0].sourceArticleId, 'article-7');
  assert.equal(profile.samples[0].excerpt, '示例片段');
  assert.deepEqual(profile.samples[0].features, ['短句']);
  assert.equal('unknown' in profile.samples[0], false);
  assert.equal('accessToken' in profile.samples[0], false);
  assert.deepEqual(profile.sourceArticleIds, ['article-7', 'article-8']);
  assert.equal('unsupported' in profile, false);
  assert.equal(schema.normalizeWritingStyleProfile({ source: 'guess', confidence: 'certain' }).source, '');
  assert.equal(schema.normalizeWritingStyleProfile({ source: 'guess', confidence: 'certain' }).confidence, 'low');
});

test('记忆限制为通用或普通文章范围，并保留撤销信息', () => {
  const general = schema.normalizeWritingMemory({
    id: 'memory-1',
    scope: 'general',
    preference: '少用空泛总结',
    sourceArticleId: 'article-1',
    undo: { action: 'auto-promote', undoneAt: '2026-10-20', password: 'secret' }
  });
  const article = schema.normalizeWritingMemory({ scope: 'article', articleId: 'article-2', preference: '多给例子' });
  const genre = schema.normalizeWritingMemory({ scope: 'genre', genre: 'article', preference: '使用具体例子', unknown: '丢弃' });

  assert.equal(general.scope, 'general');
  assert.equal(general.sourceArticleId, 'article-1');
  assert.deepEqual(general.undo, { action: 'auto-promote', undoneAt: '2026-10-20' });
  assert.equal(article.scope, 'article');
  assert.equal(article.articleId, 'article-2');
  assert.equal(genre.scope, 'genre');
  assert.equal(genre.genre, 'article');
  assert.equal('unknown' in genre, false);
  assert.equal(schema.normalizeWritingMemory({ scope: 'style', preference: 'x' }).scope, 'general');
});

test('工作区整体验证文章、轮次、风格档案和记忆的数量上限', () => {
  const workspace = schema.normalizeWritingWorkspace({
    article: { id: 'article-1', genre: 'article' },
    rounds: Array.from({ length: 12 }, (_, index) => ({ id: `round-${index}`, draft: '稿件' })),
    styleProfiles: Array.from({ length: 5 }, () => ({ traits: ['具体'] })),
    memories: Array.from({ length: 40 }, () => ({ preference: '偏好' })),
    sourceArticleIds: Array.from({ length: 25 }, (_, index) => `a${index}`),
    unknown: true
  });

  assert.equal(workspace.rounds.length, 10);
  assert.equal(workspace.styleProfiles.length, 3);
  assert.equal(workspace.memories.length, 30);
  assert.equal(workspace.sourceArticleIds.length, 20);
  assert.equal('unknown' in workspace, false);
});

test('未知文体不会在文章或工作区中伪装成普通文章', () => {
  assert.equal(schema.normalizeWritingArticle({ genre: 'novel' }).genre, '');
  const articleWorkspace = schema.normalizeWritingWorkspace({ genre: 'article' });
  const unknownWorkspace = schema.normalizeWritingWorkspace({ genre: 'novel' });

  assert.equal(articleWorkspace.genre, 'article');
  assert.equal(articleWorkspace.article.genre, 'article');
  assert.equal(unknownWorkspace.genre, '');
  assert.equal(unknownWorkspace.article.genre, '');
});

test('所有文本字段限长，未知字段和凭证字段不会进入规范化结果', () => {
  const longText = 'x'.repeat(20000);
  const workspace = schema.normalizeWritingWorkspace({
    article: { title: longText, draft: longText },
    rounds: [{ draft: longText }],
    memory: { preference: longText },
    unknownField: '丢弃'
  });
  const serialized = JSON.stringify(workspace);

  assert.ok(workspace.article.title.length <= 500);
  assert.ok(workspace.article.draft.length <= 8000);
  assert.ok(workspace.memory.preference.length <= 500);
  assert.equal(serialized.includes('secret'), false);
  assert.equal('apiToken' in workspace, false);
  assert.equal('unknownField' in workspace, false);
});

test('凭证和未知字段被白名单剔除，且不误拒绝业务字段', () => {
  const workspace = schema.normalizeWritingWorkspace({
    article: { title: '文章', apiKey: 'secret' },
    rounds: [{ draft: '稿件', accessToken: 'secret', credentials: { password: 'secret' } }],
    styleProfile: { samples: [{ excerpt: '片段', session: 'secret' }] },
    memory: { preference: '偏好', password: 'secret' },
    tokenBudget: 10,
    searchTokenCount: 2,
    apiKey: 'secret',
    unknownField: '丢弃'
  });
  const serialized = JSON.stringify(workspace);

  assert.equal(serialized.includes('secret'), false);
  for (const field of ['apiKey', 'accessToken', 'credentials', 'password', 'tokenBudget', 'searchTokenCount', 'unknownField']) {
    assert.equal(serialized.includes(field), false);
  }
});
