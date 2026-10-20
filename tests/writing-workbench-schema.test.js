const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../prototype/writing-workbench-schema.js');

test('普通文章配置覆盖七项规格且深层不可变，未知文体明确不支持', () => {
  assert.deepEqual(Object.keys(schema.WRITING_GENRE_CONFIGS), ['article']);
  const config = schema.getWritingGenreConfig('article');
  assert.equal(config, schema.WRITING_GENRE_CONFIGS.article);
  assert.equal(config.name, '普通文章');
  assert.ok(config.applicability.length > 0);
  assert.deepEqual(Object.keys(config.targetFields).sort(),
    ['title', 'goal', 'audience', 'platform', 'successCriteria', 'preserveItems', 'constraints'].sort());
  assert.deepEqual(config.checkDimensions, ['目标读者', '事实依据', '逻辑结构', '语言表达', '风格修辞', '术语一致', '格式排版', '约束风险']);
  assert.ok(config.outputRequirements.diagnosis && config.outputRequirements.revision);
  assert.ok(config.riskReminders.length && config.styleBaseline.length);
  assert.equal(config.memoryNamespace, 'article', '复用现有记忆标识，不能迁移保存数据');
  function frozen(value) {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(frozen);
  }
  frozen(schema.WRITING_GENRE_CONFIGS);
  assert.equal(Reflect.set(config.targetFields, 'goal', '篡改目标'), false);
  assert.throws(() => config.checkDimensions.push('新维度'), TypeError);
  assert.equal(schema.getWritingGenreConfig('article').targetFields.goal, '目标');
  for (const genre of [undefined, null, '', 'novel', 'Article', 'constructor', '__proto__', [], Symbol('article'), { toString() { throw new Error('不应转换'); } }]) {
    assert.equal(schema.getWritingGenreConfig(genre), null);
  }
  const context = vm.createContext({});
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-workbench-schema.js'), 'utf8'), context);
  assert.equal(JSON.stringify(context.WritingWorkbenchSchema.getWritingGenreConfig('article')), JSON.stringify(config));
  assert.equal(context.WritingWorkbenchSchema.getWritingGenreConfig('novel'), null);
});
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

test('研究只持久化拒绝状态，自动来源标记有限白名单，不允许导入计划授权', () => {
  const rejected = schema.normalizeWritingArticle({ research: { status: 'rejected', queries: ['私有输入'], apiKey: 'secret' } });
  assert.deepEqual(rejected.research, { status: 'rejected' });
  for (const status of ['approved', 'running', 'awaiting-confirmation', 'complete']) {
    assert.equal(Object.hasOwn(schema.normalizeWritingArticle({ research: { status } }), 'research'), false);
  }
  const source = schema.normalizeWritingRound({ sources: [{ title: '自动资料', origin: 'local-search', apiKey: 'secret' }] }).sources[0];
  assert.equal(source.origin, 'local-search');
  assert.equal(Object.hasOwn(source, 'apiKey'), false);
  assert.equal(Object.hasOwn(schema.normalizeWritingRound({ sources: [{ title: '未知', origin: 'private-folder' }] }).sources[0], 'origin'), false);
});

test('普通文章类型默认值和文章保存开关', () => {
  const article = schema.normalizeWritingArticle({ title: '  我的文章  ' });

  assert.equal(article.genre, 'article');
  assert.equal(article.saveEnabled, false);
  assert.equal(article.title, '我的文章');
  assert.equal(schema.normalizeWritingArticle({ genre: 'novel' }).genre, '');
  assert.equal(schema.normalizeWritingArticle({ saveEnabled: false }).saveEnabled, false);
  assert.equal(schema.normalizeWritingArticle({ saveEnabled: true }).saveEnabled, true);
  for (const value of [undefined, null, 0, 1, 'true', 'false', {}, []]) {
    assert.equal(schema.normalizeWritingArticle({ saveEnabled: value }).saveEnabled, false);
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
    successCriteria: [],
    audience: '第一次接触的用户',
    platform: '',
    preserveItems: [],
    dimensions: [],
    constraints: '',
    sourceArticleId: 'source-article-9',
    draft: '当前稿件',
    saveEnabled: false,
    styleProfileId: '',
    createdAt: '',
    updatedAt: ''
  });
  assert.equal('unknownField' in article, false);
});

test('工作区经 JSON 往返后保留轮次诊断、提示词和父轮次', () => {
  const workspace = schema.normalizeWritingWorkspace({
    article: { id: 'article-1', platform: '公众号', preserveItems: ['观点'], dimensions: ['依据'] },
    rounds: [{
      parentRoundId: 'round-0',
      diagnosis: '  依据不足，需要补充来源  ',
      prompt: '  请保留观点并补充证据  ',
      sources: [{ title: '指南', url: 'https://example.com', excerpt: '证据', purpose: 'content', verificationStatus: 'source-reviewed' }]
    }],
    styleProfile: { traits: ['具体'], userCorrections: '保留必要长句', scope: 'genre', genre: 'article' }
  });
  const restored = schema.normalizeWritingWorkspace(JSON.parse(JSON.stringify(workspace)));

  assert.equal(restored.rounds.length, 1);
  assert.equal(restored.rounds[0].parentRoundId, 'round-0');
  assert.equal(restored.rounds[0].diagnosis, '依据不足，需要补充来源');
  assert.equal(restored.rounds[0].prompt, '请保留观点并补充证据');
  assert.equal(restored.article.saveEnabled, false);
  assert.equal(restored.article.platform, '公众号');
  assert.deepEqual(restored.article.preserveItems, ['观点']);
  assert.deepEqual(restored.article.dimensions, ['依据']);
  assert.equal(restored.rounds[0].sources[0].verificationStatus, 'source-reviewed');
  assert.deepEqual(restored.styleProfile.traits, ['具体']);
  assert.equal(restored.styleProfile.userCorrections, '保留必要长句');
  assert.equal(restored.styleProfile.scope, 'genre');
  assert.equal(restored.styleProfile.genre, 'article');
  assert.deepEqual(restored, workspace);
});

test('轮次保存稿件、反馈和撤销信息', () => {
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

  assert.equal(workspace.rounds.length, 12);
  assert.equal(workspace.styleProfiles.length, 3);
  assert.equal(workspace.memories.length, 30);
  assert.equal(workspace.sourceArticleIds.length, 20);
  assert.equal('unknown' in workspace, false);
});

test('文章保留平台、保留项和八维选择，并限制条数与长度', () => {
  const article = schema.normalizeWritingArticle({
    platform: '  公众号  ',
    preserveItems: ['  事实  ', '', null, { apiKey: 'secret' }, '观点'],
    dimensions: ['目标/读者', '依据', '逻辑结构', '语言', '风格修辞', '术语一致', '格式排版', '约束风险']
  });
  assert.equal(article.platform, '公众号');
  assert.deepEqual(article.preserveItems, ['事实', '观点']);
  assert.equal(article.dimensions.length, 8);

  const limited = schema.normalizeWritingArticle({
    platform: '文'.repeat(20000),
    preserveItems: Array(40).fill('文'.repeat(20000)),
    dimensions: Array(20).fill('文'.repeat(20000))
  });
  assert.equal(limited.platform.length, 160);
  assert.equal(limited.preserveItems.length, 30);
  assert.ok(limited.preserveItems.every(item => item.length === 500));
  assert.equal(limited.dimensions.length, 8);
  assert.ok(limited.dimensions.every(item => item.length === 160));
});

test('轮次来源保留用途和验证状态，并剔除嵌套未知及凭证字段', () => {
  for (const purpose of schema.MATERIAL_PURPOSES) {
    for (const verificationStatus of ['unverified', 'source-reviewed', 'user-confirmed']) {
      const source = schema.normalizeWritingRound({ sources: [{
        title: '  指南  ', url: '  https://example.com/guide  ', excerpt: '  证据摘要  ',
        purpose, verificationStatus, apiKey: 'secret', unknown: { password: 'secret' }
      }] }).sources[0];
      assert.deepEqual(source, {
        title: '指南', url: 'https://example.com/guide', excerpt: '证据摘要', purpose, verificationStatus
      });
    }
  }
  const sources = schema.normalizeWritingRound({ sources: [
    null, [], { apiKey: 'secret' },
    { url: 'https://example.com', purpose: 'research', verificationStatus: 'verified' }
  ] }).sources;
  assert.deepEqual(sources, [{
    title: '', url: 'https://example.com', excerpt: '', purpose: 'content', verificationStatus: 'unverified'
  }]);
});

test('轮次新增文本和来源元数据均有限长、有限条数', () => {
  const longText = '文'.repeat(20000);
  const round = schema.normalizeWritingRound({
    parentRoundId: longText, diagnosis: longText, prompt: longText, draft: longText,
    sources: Array(25).fill({ title: longText, url: longText, excerpt: longText })
  });
  assert.equal(round.parentRoundId.length, 100);
  assert.equal(round.diagnosis.length, 4000);
  assert.equal(round.prompt.length, 8000);
  assert.equal(round.draft.length, 8000);
  assert.equal(round.sources.length, 20);
  assert.ok(round.sources.every(source => source.title.length === 160
    && source.url.length === 2000 && source.excerpt.length === 1200));
});

test('风格档案保留用户修正和适用范围，未知文体不伪装', () => {
  for (const scope of ['general', 'genre', 'article']) {
    const profile = schema.normalizeWritingStyleProfile({
      scope, genre: 'article', userCorrections: '  保留必要长句  '
    });
    assert.equal(profile.scope, scope);
    assert.equal(profile.genre, 'article');
    assert.equal(profile.userCorrections, '保留必要长句');
  }
  const profile = schema.normalizeWritingStyleProfile({
    scope: 'unknown', genre: 'novel', userCorrections: '文'.repeat(20000), credentials: { password: 'secret' }
  });
  assert.equal(profile.scope, 'article');
  assert.equal(profile.genre, '');
  assert.equal(profile.userCorrections.length, 2000);
  assert.equal('credentials' in profile, false);
});

test('工作区超过轮次上限时保留最新一百轮，诊断或提示词单独存在也不丢失', () => {
  const rounds = Array.from({ length: 105 }, (_, index) => ({ id: `round-${index}` }));
  const workspace = schema.normalizeWritingWorkspace({ rounds });
  assert.equal(workspace.rounds.length, 100);
  assert.equal(workspace.rounds[0].id, 'round-5');
  assert.equal(workspace.rounds.at(-1).id, 'round-104');
  assert.deepEqual(schema.normalizeWritingWorkspace({ rounds: [
    { diagnosis: '诊断' }, { prompt: '提示词' }, { userFeedback: '反馈' },
    { sources: [{ title: '来源' }] }
  ] }).rounds.map(round => round.diagnosis || round.prompt || round.userFeedback || round.sources[0].title),
  ['诊断', '提示词', '反馈', '来源']);
});

test('非法输入和嵌套字段安全降级，原输入不变且规范化结果可重复处理', () => {
  const normalizers = [schema.normalizeWritingArticle, schema.normalizeWritingRound,
    schema.normalizeWritingStyleProfile, schema.normalizeWritingMemory, schema.normalizeWritingWorkspace];
  for (const normalize of normalizers) {
    for (const input of [undefined, null, [], 'text', 1, false, Symbol('非法值')]) {
      assert.doesNotThrow(() => normalize(input));
    }
  }
  const input = {
    article: { saveEnabled: 'true', platform: { password: 'secret' }, preserveItems: [{}], dimensions: null },
    rounds: [{ diagnosis: { apiKey: 'secret' }, prompt: ['secret'], sources: [{
      title: '来源', url: { accessToken: 'secret' }, excerpt: ['secret'], credentials: { password: 'secret' }
    }], materials: [null, {}], undo: { action: '撤销', credentials: 'secret' } }],
    styleProfile: { userCorrections: {}, samples: [null, { features: [{}] }] },
    memories: [{ preference: '偏好', evidenceArticleIds: ['article-1', { apiKey: 'secret' }] }]
  };
  const original = JSON.stringify(input);
  const workspace = schema.normalizeWritingWorkspace(input);
  assert.equal(JSON.stringify(input), original);
  assert.equal(JSON.stringify(workspace).includes('secret'), false);
  assert.deepEqual(workspace.memories[0].evidenceArticleIds, ['article-1']);
  assert.deepEqual(schema.normalizeWritingWorkspace(workspace), workspace);
});

test('浏览器 UMD 导出与 CommonJS 的五个纯函数行为一致', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-workbench-schema.js'), 'utf8'), context);
  const browser = context.WritingWorkbenchSchema;
  for (const name of ['normalizeWritingArticle', 'normalizeWritingRound', 'normalizeWritingStyleProfile',
    'normalizeWritingMemory', 'normalizeWritingWorkspace']) {
    assert.equal(typeof browser[name], 'function');
    assert.equal(JSON.stringify(browser[name]({})), JSON.stringify(schema[name]({})));
  }
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

test('嵌套文章缺省文体继承工作区明确文体，并保留自身显式文体', () => {
  const input = Object.freeze({
    genre: 'novel', article: Object.freeze({ id: 'a1', draft: '小说' })
  });
  const workspace = schema.normalizeWritingWorkspace(input);
  assert.equal(workspace.genre, '');
  assert.equal(workspace.article.genre, '');
  assert.equal(workspace.article.id, 'a1');
  assert.equal(workspace.article.draft, '小说');
  assert.equal('genre' in input.article, false);
  assert.deepEqual(schema.normalizeWritingWorkspace(JSON.parse(JSON.stringify(workspace))), workspace);

  for (const [genre, article, expected] of [
    ['novel', { genre: undefined }, ''],
    ['article', {}, 'article'],
    [undefined, {}, 'article'],
    ['novel', { genre: 'article' }, 'article'],
    ['article', { genre: 'novel' }, ''],
    ['article', { genre: '' }, ''],
    ['article', { genre: null }, '']
  ]) {
    assert.equal(schema.normalizeWritingWorkspace({ genre, article }).article.genre, expected);
  }
});

test('文章成功标准仅保留字符串，最多二十项且每项五百字符', () => {
  const article = schema.normalizeWritingArticle({
    successCriteria: ['  读者能复述步骤  ', '', '  ', null, 1, false, ['secret'], { apiKey: 'secret' }, '包含证据']
  });
  assert.deepEqual(article.successCriteria, ['读者能复述步骤', '包含证据']);
  const workspace = schema.normalizeWritingWorkspace({ article });
  const restored = schema.normalizeWritingWorkspace(JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(restored.article.successCriteria, article.successCriteria);

  const limited = schema.normalizeWritingArticle({ successCriteria: Array(25).fill('文'.repeat(600)) });
  assert.equal(limited.successCriteria.length, 20);
  assert.ok(limited.successCriteria.every(item => item.length === 500));
  for (const value of [undefined, null, '标准', {}, 1, false]) {
    assert.deepEqual(schema.normalizeWritingArticle({ successCriteria: value }).successCriteria, []);
  }
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

test('显式轮次偏好候选及记忆例子有限长白名单，缺省不添加字段', () => {
  assert.equal('preferences' in schema.normalizeWritingRound({}), false);
  assert.equal('example' in schema.normalizeWritingMemory({}), false);
  const round = schema.normalizeWritingRound({ preferences: Array.from({ length: 12 }, () => ({
    preference: ' 偏好 ', example: '例'.repeat(700), counterexample: '反例', secret: '删除'
  })) });
  assert.equal(round.preferences.length, 8);
  assert.equal(round.preferences[0].preference, '偏好');
  assert.equal(round.preferences[0].example.length, 500);
  assert.equal(round.preferences[0].counterexample, '反例');
  assert.equal('secret' in round.preferences[0], false);
  const memory = schema.normalizeWritingMemory({ example: '正例', counterexample: '反例' });
  assert.equal(memory.example, '正例');
  assert.equal(memory.counterexample, '反例');
});

test('自动记忆原候选关联显式保留且限长，缺省不增加字段', () => {
  assert.equal('sourcePreferenceKey' in schema.normalizeWritingMemory({}), false);
  const memory = schema.normalizeWritingMemory({ preference: '编辑后的偏好', sourcePreferenceKey: '原'.repeat(600) });
  assert.equal(memory.sourcePreferenceKey.length, 500);
  assert.deepEqual(schema.normalizeWritingMemory(JSON.parse(JSON.stringify(memory))), memory);
});
