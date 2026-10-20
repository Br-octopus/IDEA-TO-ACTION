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
    undoneAt: '2026-10-20T10:00:00Z'
  });
  assert.equal('extra' in round, false);
  assert.equal(schema.normalizeWritingRound({}).id, '');
});

test('材料用途只允许内容、风格或两者', () => {
  for (const purpose of ['content', 'style', 'both']) {
    assert.equal(schema.normalizeWritingRound({ materials: [{ id: 'm1', purpose }] }).materials[0].purpose, purpose);
  }

  assert.equal(schema.normalizeWritingRound({ materials: [{ id: 'm1', purpose: 'research' }] }).materials[0].purpose, 'content');
});

test('风格档案记录来源、把握度和有限样本', () => {
  const profile = schema.normalizeWritingStyleProfile({
    source: 'user-corrected',
    confidence: 'high',
    traits: ['具体', '克制'],
    samples: [{ sourceArticleId: 'article-7', excerpt: '示例片段', features: ['短句'] }],
    sourceArticleIds: ['article-7', 'article-8'],
    unsupported: '丢弃'
  });

  assert.equal(profile.source, 'user-corrected');
  assert.equal(profile.confidence, 'high');
  assert.deepEqual(profile.traits, ['具体', '克制']);
  assert.equal(profile.samples[0].sourceArticleId, 'article-7');
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
    undo: { action: 'auto-promote', undoneAt: '2026-10-20' }
  });
  const article = schema.normalizeWritingMemory({ scope: 'article', articleId: 'article-2', preference: '多给例子' });

  assert.equal(general.scope, 'general');
  assert.equal(general.sourceArticleId, 'article-1');
  assert.deepEqual(general.undo, { action: 'auto-promote', undoneAt: '2026-10-20' });
  assert.equal(article.scope, 'article');
  assert.equal(article.articleId, 'article-2');
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

test('凭证字段直接传入规范化器时抛出敏感字段错误', () => {
  assert.throws(() => schema.normalizeWritingArticle({ apiKey: 'secret' }), /敏感/);
  assert.throws(() => schema.normalizeWritingRound({ credentials: { token: 'secret' } }), /敏感/);
});
