const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../prototype/writing-workbench-schema.js');
const coverage = require('../prototype/writing-material-coverage.js');

test('常用工作空间只保留有界元数据与安全相对路径', () => {
  const record = schema.normalizeWritingWorkspaceRecord({
    id: ' workspace-1 ', name: ' 项目材料 ', rootLabel: ' sample-project ',
    sourceKind: 'browser-directory', createdAt: '2026-10-23T08:00:00.000Z',
    selectedPaths: [
      { path: 'src\\save.js', fingerprint: '42:abcd1234', content: '文件原文不得保存' },
      { path: '../secret.txt', fingerprint: 'secret' },
      { path: 'D:/private/file.txt', fingerprint: 'secret' },
      { path: '/root/file.txt', fingerprint: 'secret' },
      { path: 'folder/./file.txt', fingerprint: 'secret' },
      { path: 'folder/..\\secret.txt', fingerprint: 'secret' },
      { path: 'docs/raw.txt', fingerprint: '这不是文件指纹而是原文' },
      { path: 'src/save.js', fingerprint: 'duplicate' },
      { path: 'docs/guide.md', fingerprint: '17:ef0099' }
    ],
    absolutePath: 'D:/private', fileContents: '原文哨兵', browserHandle: { secret: true }, apiKey: 'secret'
  });

  assert.deepEqual(record, {
    id: 'workspace-1', name: '项目材料', rootLabel: 'sample-project', sourceKind: 'browser-directory',
    selectedPaths: [
      { path: 'src/save.js', fingerprint: '42:abcd1234' },
      { path: 'docs/guide.md', fingerprint: '17:ef0099' }
    ],
    createdAt: '2026-10-23T08:00:00.000Z'
  });
  assert.doesNotMatch(JSON.stringify(record), /原文哨兵|文件原文|D:\\/);

  const bounded = schema.normalizeWritingWorkspaceRecord({
    id: 'x'.repeat(150), name: 'n'.repeat(300), rootLabel: 'r'.repeat(300),
    sourceKind: 'untrusted-kind', createdAt: 'd'.repeat(100),
    selectedPaths: Array.from({ length: 220 }, (_, index) => ({
      path: `folder/file-${index}.md`, fingerprint: `${index}:abcdef12`
    }))
  });
  assert.equal(bounded.id.length, 100);
  assert.equal(bounded.name.length, 120);
  assert.equal(bounded.rootLabel.length, 120);
  assert.equal(bounded.sourceKind, '');
  assert.equal(bounded.createdAt.length, 80);
  assert.equal(bounded.selectedPaths.length, 200);
  assert.equal(bounded.selectedPaths[0].fingerprint, '0:abcdef12');
  assert.deepEqual(schema.normalizeWritingWorkspaceRecords([
    { id: 'one', name: '一' }, { id: 'one', name: '重复' }, ...Array.from({ length: 25 }, (_, index) => ({ id: `ws-${index}` }))
  ]).map(item => item.id).length, 20);
});

test('普通文章配置覆盖七项规格且深层不可变，未知文体明确不支持', () => {
  assert.deepEqual(Object.keys(schema.WRITING_GENRE_CONFIGS).slice(0, 2), ['article', 'academic-paper']);
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

test('结构化、视听社媒和长篇创作文体有独立配置及稳定任务类型', () => {
  const expected = {
    'longform-research-article': ['research-brief', 'section-plan', 'section-diagnosis', 'section-revision', 'cross-section-review'],
    'technical-document': ['technical-procedure', 'technical-api', 'technical-design', 'technical-troubleshooting'],
    'business-document': ['business-report', 'business-proposal', 'business-marketing'],
    news: ['news-fact-organization', 'news-release', 'news-review'],
    'tutorial-course': ['course-plan', 'lesson-plan', 'learning-check'],
    'resume-job-search': ['resume-experience-map', 'resume-target-fit', 'resume-revision'],
    email: ['email-draft', 'email-revision', 'email-review'],
    'official-document': ['official-document-plan', 'official-document-review'],
    'legal-document': ['legal-fact-organization', 'legal-document-outline', 'legal-document-review']
  };
  for (const [genre, taskTypes] of Object.entries(expected)) {
    const config = schema.getWritingGenreConfig(genre);
    assert.ok(config, genre);
    assert.deepEqual(config.taskTypes, taskTypes);
    assert.ok(config.applicability);
    assert.ok(config.riskReminders.length);
  }
  assert.equal(schema.WRITING_GENRES.length, Object.keys(schema.WRITING_GENRE_CONFIGS).length);
  const legacy = schema.normalizeWritingArticle({ genre: 'article', taskType: 'legal-document-review', arbitrary: true });
  assert.equal(legacy.genre, 'article');
  assert.equal(legacy.taskType, undefined);
});

test('领域专属输入按当前文体白名单保存并清理路径凭证与未知键', () => {
  const article = schema.normalizeWritingArticle({ genre: 'technical-document', domainInputs: {
    prerequisites: '需要管理员权限', environment: 'C:\\private\\host', unknown: '不能保存',
    productVersion: 'Bearer abcdefghijklmnop'
  } });
  assert.deepEqual(article.domainInputs, {
    environment: '[本地路径已省略]', prerequisites: '需要管理员权限', productVersion: 'Bearer [凭证已省略]'
  });
  const wrongGenre = schema.normalizeWritingArticle({ genre: 'article', domainInputs: { prerequisites: '不应保存' } });
  assert.equal(wrongGenre.domainInputs, undefined);
});

test('学术论文目标元数据与机构要求受白名单、长度、条数和来源状态限制', () => {
  const article = schema.normalizeWritingArticle({ genre: 'academic-paper', academicTarget: {
    paperType: 'dissertation', discipline: '教育学', researchType: 'observational',
    institution: '示例大学', program: '教育学院', degreeLevel: '硕士', citationStyle: 'GB/T 7714',
    unknown: 'drop', apiKey: 'secret',
    requirements: [{ id: 'req-1', title: '学校要求', issuer: '研究生院', target: '学位论文', version: '2026',
      text: '结果章节报告完整', sourceUrl: 'https://example.test/guide', locator: '第三章',
      verificationStatus: 'user-confirmed', absolutePath: 'D:/private/guide.pdf', password: 'secret' },
      { id: 'req-2', text: '要求'.repeat(700), sourceUrl: 'file:///D:/guide.pdf', locator: '../secret', verificationStatus: 'verified' },
      ...Array.from({ length: 21 }, (_, index) => ({ id: `extra-${index}`, text: '额外要求' }))]
  } });
  assert.equal(article.genre, 'academic-paper');
  assert.equal(article.academicTarget.paperType, 'dissertation');
  assert.equal(article.academicTarget.requirements.length, 20);
  assert.deepEqual(article.academicTarget.requirements[0], {
    id: 'req-1', title: '学校要求', issuer: '研究生院', target: '学位论文', version: '2026',
    text: '结果章节报告完整', sourceUrl: 'https://example.test/guide', locator: '第三章', verificationStatus: 'user-confirmed'
  });
  assert.equal(article.academicTarget.requirements[1].text.length, 1200);
  assert.equal(article.academicTarget.requirements[1].sourceUrl, '');
  assert.equal(article.academicTarget.requirements[1].locator, '');
  assert.equal(article.academicTarget.requirements[1].verificationStatus, 'unverified');
  assert.doesNotMatch(JSON.stringify(article), /apiKey|password|absolutePath|D:\\/);
  assert.equal(Object.hasOwn(schema.normalizeWritingArticle({ genre: 'article' }), 'academicTarget'), false);
  assert.equal(Object.hasOwn(schema.normalizeWritingArticle({ genre: 'novel', academicTarget: { paperType: 'dissertation' } }), 'academicTarget'), false);
});

test('requirement 是独立材料用途，保留旧用途兼容且只进入对应来源', () => {
  assert.ok(schema.MATERIAL_PURPOSES.includes('requirement'));
  for (const purpose of ['content', 'style', 'both', 'requirement']) {
    assert.equal(schema.normalizeWritingRound({ materials: [{ id: purpose, purpose }] }).materials[0].purpose, purpose);
  }
  assert.equal(schema.normalizeWritingRound({ materials: [{ id: 'unknown', title: '未知用途', purpose: 'unknown' }] }).materials[0].purpose, 'content');
});

test('学术工作区 JSON 往返保留目标，旧工作区不会伪造目标字段', () => {
  const workspace = schema.normalizeWritingWorkspace({
    id: 'paper-workspace', genre: 'academic-paper',
    article: { id: 'paper-workspace', genre: 'academic-paper', academicTarget: { discipline: '教育学' } }
  });
  assert.equal(JSON.parse(JSON.stringify(workspace)).article.academicTarget.discipline, '教育学');
  assert.equal(Object.hasOwn(schema.normalizeWritingWorkspace({ id: 'legacy', article: { id: 'legacy' } }).article, 'academicTarget'), false);
});

test('提示词版本保留学术任务类型，未知任务类型仍不进入历史', () => {
  const round = schema.normalizeWritingRound({ promptVersions: [
    { id: 'academic-outline', taskType: 'academic-outline', content: '提纲提示词' },
    { id: 'academic-chapter', taskType: 'academic-chapter-draft', content: '章节提示词' },
    { id: 'unknown', taskType: 'arbitrary-task', content: '未知任务' }
  ] });
  assert.equal(round.promptVersions[0].taskType, 'academic-outline');
  assert.equal(round.promptVersions[1].taskType, 'academic-chapter-draft');
  assert.equal(Object.hasOwn(round.promptVersions[2], 'taskType'), false);
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

test('材料快照保留有限的读取范围状态并清理路径与凭证', () => {
  const material = schema.normalizeWritingRound({ materials: [{
    id: 'material-1', title: '章节一.txt', purpose: 'content', excerpt: '可用摘录',
    sourceType: 'text-file', contentStatus: 'truncated', originalLength: 5000,
    absolutePath: 'D:/private/chapters/one.txt', apiKey: 'secret'
  }] }).materials[0];
  assert.deepEqual(material, {
    id: 'material-1', title: '章节一.txt', purpose: 'content', excerpt: '可用摘录',
    sourceArticleId: '', sourceType: 'text-file', contentStatus: 'truncated', originalLength: 5000
  });
  const reference = schema.normalizeWritingRound({ sources: [{
    title: '参考网页', url: 'https://example.test/page', contentStatus: 'reference-only',
    password: 'secret'
  }] }).sources[0];
  assert.equal(reference.contentStatus, 'reference-only');
  assert.equal(Object.hasOwn(reference, 'password'), false);
  assert.equal(Object.hasOwn(schema.normalizeWritingRound({ materials: [{ title: '未知状态', contentStatus: 'read' }] }).materials[0], 'contentStatus'), false);
});

test('材料卡片与来源保留相对位置、版本、摘录行、选用理由和读取失败状态', () => {
  const round = schema.normalizeWritingRound({
    materials: [{
      id: 'material-local-1', title: '写作指南', purpose: 'content', excerpt: '证据摘录',
      sourceType: 'authorized-directory', origin: 'authorized-directory',
      sourceId: 'local:guides/writing.md', sourceLocator: 'guides/writing.md',
      sourceVersion: `sha256:${'a'.repeat(64)}`, excerptLocator: '第 18 行',
      selectionReason: '与当前写作目标相关', verificationStatus: 'unverified',
      contentStatus: 'embedded', attachmentRequired: true,
      absolutePath: 'D:/private/guides/writing.md', apiKey: 'secret'
    }],
    sources: [{
      id: 'local-source-1', title: '目录材料', excerpt: '命中摘录', purpose: 'content',
      sourceType: 'authorized-directory', origin: 'authorized-directory',
      sourceId: 'local:notes/source.md', sourceLocator: 'notes/source.md',
      sourceVersion: 'sha256:version-1', excerptLocator: '第 4 行',
      selectionReason: '关键词命中', verificationStatus: 'unverified', contentStatus: 'embedded'
    }, {
      title: '解析失败文件', sourceLocator: 'notes/broken.pdf', contentStatus: 'failed'
    }, {
      title: '非法绝对路径', sourceLocator: 'D:/private/secret.pdf', contentStatus: 'unsupported'
    }]
  });

  const material = round.materials[0];
  assert.equal(material.sourceId, 'local:guides/writing.md');
  assert.equal(material.sourceLocator, 'guides/writing.md');
  assert.equal(material.sourceVersion, `sha256:${'a'.repeat(64)}`);
  assert.equal(material.excerptLocator, '第 18 行');
  assert.equal(material.selectionReason, '与当前写作目标相关');
  assert.equal(material.attachmentRequired, true);
  assert.equal('absolutePath' in material, false);
  assert.equal('apiKey' in material, false);

  assert.equal(round.sources[0].sourceId, 'local:notes/source.md');
  assert.equal(round.sources[0].sourceLocator, 'notes/source.md');
  assert.equal(round.sources[0].excerptLocator, '第 4 行');
  assert.equal(round.sources[0].selectionReason, '关键词命中');
  assert.equal(round.sources[1].contentStatus, 'failed');
  assert.equal(round.sources[2].contentStatus, 'unsupported');
  assert.equal('sourceLocator' in round.sources[2], false);
});

test('材料读取失败原因可回看，来源元数据不会夹带本机绝对路径', () => {
  const round = schema.normalizeWritingRound({
    materials: [{
      id: 'failed-file', title: '失败文件.txt', excerpt: '', contentStatus: 'failed',
      contentError: '读取失败：C:/Users/Alarm/private.txt 无权限', sourceType: 'unread-file-reference'
    }],
    sources: [{
      title: 'D:/Users/Alarm/private.md', url: 'file:///D:/Users/Alarm/private.md',
      excerpt: '已确认摘录 C:/Users/Alarm/private.txt', sourceId: 'local:D:/Users/Alarm/private.md',
      sourceLocator: '../private.md', selectionReason: '读取自 C:/Users/Alarm/private',
      contentError: '目录不可访问：C:/Users/Alarm/private'
    }]
  });

  assert.match(round.materials[0].contentError, /读取失败/);
  assert.equal(round.sources[0].url, '');
  assert.equal(round.sources[0].sourceLocator, undefined);
  assert.doesNotMatch(JSON.stringify(round), /[A-Za-z]:[\\/]|file:\/\/|\\\\Users/);
  assert.match(round.sources[0].excerpt, /已确认摘录/);
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

test('记忆支持通用、文体、项目和旧单篇范围，并保留撤销信息', () => {
  const general = schema.normalizeWritingMemory({
    id: 'memory-1',
    scope: 'general',
    preference: '少用空泛总结',
    sourceArticleId: 'article-1',
    undo: { action: 'auto-promote', undoneAt: '2026-10-20', password: 'secret' }
  });
  const article = schema.normalizeWritingMemory({ scope: 'article', articleId: 'article-2', preference: '多给例子' });
  const project = schema.normalizeWritingMemory({ scope: 'project', projectId: 'project-2', preference: '本项目保留角色称谓' });
  const genre = schema.normalizeWritingMemory({ scope: 'genre', genre: 'article', preference: '使用具体例子', unknown: '丢弃' });

  assert.equal(general.scope, 'general');
  assert.equal(general.sourceArticleId, 'article-1');
  assert.deepEqual(general.undo, { action: 'auto-promote', undoneAt: '2026-10-20' });
  assert.equal(article.scope, 'article');
  assert.equal(article.articleId, 'article-2');
  assert.equal(project.scope, 'project');
  assert.equal(project.projectId, 'project-2');
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

test('文章和轮次可选基础包选择与快照按白名单规范化', () => {
  const workspace = schema.normalizeWritingWorkspace({
    article: {
      id: 'article-pack',
      packSelections: [' pack-a ', '', 'pack-b'],
      secret: '不得保留'
    },
    rounds: [{
      id: 'round-pack',
      packSelections: ['pack-a'],
      packSnapshot: {
        packs: [{ id: 'pack-a', version: 2, name: '任务包', layer: 'task', genre: 'article', taskType: 'revision', secret: '不得保留' }],
        entries: [{ id: 'rule-a', packId: 'pack-a', packVersion: 2, kind: 'check', taskType: 'revision', text: '规则', sourceIds: ['source-a'], password: '不得保留' }],
        sources: [{ id: 'source-a', title: '来源', url: 'https://example.test/source', license: '内部', accessToken: '不得保留' }],
        skipped: [{ id: 'pack-b', reason: 'disabled', extra: '不得保留' }],
        unknown: '不得保留'
      }
    }]
  });
  assert.deepEqual(workspace.article.packSelections, ['pack-a', 'pack-b']);
  assert.deepEqual(workspace.rounds[0].packSelections, ['pack-a']);
  assert.deepEqual(workspace.rounds[0].packSnapshot.packs[0], {
    id: 'pack-a', version: 2, name: '任务包', layer: 'task', genre: 'article', taskType: 'revision'
  });
  assert.deepEqual(workspace.rounds[0].packSnapshot.entries[0], {
    id: 'rule-a', packId: 'pack-a', packVersion: 2, kind: 'check', taskType: 'revision',
    text: '规则', sourceIds: ['source-a'], verificationStatus: 'unverified'
  });
  assert.equal(workspace.rounds[0].packSnapshot.sources[0].id, 'source-a');
  assert.equal('accessToken' in workspace.rounds[0].packSnapshot.sources[0], false);
  assert.deepEqual(workspace.rounds[0].packSnapshot.skipped, [{ id: 'pack-b', reason: 'disabled' }]);
});

test('基础包快照来源跨包同名时保留各自元数据，不按 ID 互相覆盖', () => {
  const snapshot = schema.normalizeWritingPackSnapshot({
    packs: [
      { id: 'pack-a', version: 1, name: '包A', layer: 'task', genre: 'article' },
      { id: 'pack-b', version: 1, name: '包B', layer: 'task', genre: 'article' }
    ],
    entries: [
      { id: 'rule-1', packId: 'pack-a', packVersion: 1, kind: 'check', text: '包A规则',
        sourceIds: ['src'], verificationStatus: 'unverified' },
      { id: 'rule-2', packId: 'pack-b', packVersion: 1, kind: 'check', text: '包B规则',
        sourceIds: ['src'], verificationStatus: 'source-reviewed' }
    ],
    sources: [
      { id: 'src', title: '包A来源', locator: 'pack-a#src' },
      { id: 'src', title: '包B来源', locator: 'pack-b#src', verificationStatus: 'source-reviewed' }
    ],
    skipped: []
  });
  assert.equal(snapshot.sources.length, 2);
  const locators = snapshot.sources.map(source => source.locator).sort();
  assert.deepEqual(locators, ['pack-a#src', 'pack-b#src']);
  assert.ok(snapshot.sources.every(source => source.id === 'src'));
});

test('历史包快照保留方法卡结构与来源固定版本元数据', () => {
  const snapshot = schema.normalizeWritingPackSnapshot({
    packs: [{ id: 'method-pack', version: 3 }],
    entries: [{ id: 'method-a', packId: 'method-pack', packVersion: 3, kind: 'method', text: '方法说明',
      inputs: ['稿件'], outputs: ['问题清单'], checks: ['位置可回指'], skippable: true,
      returnWhenMissing: ['缺稿时退回'], sourceIds: ['source-a'], verificationStatus: 'unverified' }],
    sources: [{ id: 'source-a', packId: 'method-pack', title: '方法来源', versionHash: 'sha256:fixed',
      readAt: '2026-10-22', adoptionReason: '形成方法卡', reviewRecord: '待审阅' }]
  });
  assert.deepEqual(snapshot.entries[0].inputs, ['稿件']);
  assert.deepEqual(snapshot.entries[0].outputs, ['问题清单']);
  assert.equal(snapshot.entries[0].skippable, true);
  assert.deepEqual(snapshot.entries[0].returnWhenMissing, ['缺稿时退回']);
  assert.equal(snapshot.sources[0].versionHash, 'sha256:fixed');
  assert.equal(snapshot.sources[0].adoptionReason, '形成方法卡');
  assert.equal(snapshot.sources[0].reviewRecord, '待审阅');
});

test('基础包快照条目超过 100 条时记录截断降级，不静默丢弃', () => {
  const entries = [];
  for (let i = 0; i < 120; i += 1) {
    // 前 100 条恰好属于 pack-a，后 20 条属于 pack-b，pack-b 整包被截断。
    entries.push({ id: `rule-${i}`, packId: i < 100 ? 'pack-a' : 'pack-b', text: `规则${i}` });
  }
  const snapshot = schema.normalizeWritingPackSnapshot({
    packs: [{ id: 'pack-a', version: 1 }, { id: 'pack-b', version: 1 }],
    entries, skipped: []
  });
  assert.equal(snapshot.entries.length, 100);
  // 截掉的规则按包去重记录，用户能看到哪些包的条目被截断。
  assert.deepEqual(snapshot.skipped, [{ id: 'pack-b', reason: 'entries-truncated' }]);
});

test('核心 C 工作区保留有界任务单元、证据问题与路线进度', () => {
  const workspace = schema.normalizeWritingWorkspace({
    units: [{
      id: 'unit-1', type: 'chapter', title: '第一章', goal: '说明问题',
      completionCriteria: ['交代背景', '指出缺口'], order: 2, archived: false,
      absolutePath: 'D:/private/chapter.md', apiKey: 'secret'
    }],
    issues: [{
      id: 'issue-1', roundId: 'round-1', promptVersionId: 'prompt-1', unitId: 'unit-1',
      location: '第二段', excerpt: '需要核对的原句', observation: '缺少比较对象', impact: '结论范围不清',
      evidenceCategory: 'source', evidenceDescription: '应有对应来源', packId: 'pack-1', sourceId: 'source-1',
      suggestion: '补充可核对的比较依据', priority: 'high', judgment: 'candidate',
      status: 'pending-user', statusReason: '待作者判断', reviewedRoundId: '', reviewedAt: '',
      password: 'secret'
    }],
    routeProgress: {
      packId: 'pack-1', packVersion: 3, routeId: 'route-1', sourceIds: ['source-1'],
      verificationStatus: 'unverified', currentUnitId: 'unit-1', currentStageId: 'stage-1',
      stages: [{
        id: 'stage-1', title: '核对材料', inputs: ['来源'], outputs: ['核对表'], checks: ['能定位'],
        sourceIds: ['source-1'], verificationStatus: 'source-reviewed', status: 'blocked',
        result: '', evidence: '', absolutePath: 'D:/private/source.pdf'
      }]
    }
  });

  assert.deepEqual(workspace.units, [{
    id: 'unit-1', type: 'chapter', title: '第一章', goal: '说明问题',
    completionCriteria: ['交代背景', '指出缺口'], order: 2, archived: false
  }]);
  assert.equal(workspace.issues[0].id, 'issue-1');
  assert.equal(workspace.issues[0].judgment, 'candidate');
  assert.equal(workspace.issues[0].status, 'pending-user');
  assert.equal(workspace.issues[0].excerpt, '需要核对的原句');
  assert.equal(workspace.routeProgress.packVersion, 3);
  assert.equal(workspace.routeProgress.stages[0].status, 'blocked');
  assert.equal(workspace.routeProgress.stages[0].verificationStatus, 'source-reviewed');
  assert.doesNotMatch(JSON.stringify(workspace), /D:\\|apiKey|password|secret/);
  assert.equal(Object.hasOwn(schema.normalizeWritingWorkspace({}), 'units'), false,
    '旧工作区不伪造任务单元');
  assert.equal(Object.hasOwn(schema.normalizeWritingWorkspace({}), 'issues'), false,
    '旧工作区不伪造问题记录');
});

test('核心 C 轮次保留任务单元快照、提示词副本和明确的分支来源', () => {
  const workspace = schema.normalizeWritingWorkspace({ rounds: [{
    id: 'round-2', articleId: 'article-1', unitId: 'unit-1',
    unitSnapshot: { id: 'unit-1', type: 'chapter', title: '第一章', goal: '说明问题', completionCriteria: ['交代背景'] },
    prompt: '生成的原始提示词',
    promptVersions: [
      { id: 'prompt-1', parentVersionId: '', content: '首版提示词', createdAt: '2026-10-21', copied: true },
      { id: 'prompt-2', parentVersionId: 'prompt-1', content: '用户修订提示词', createdAt: '2026-10-22', copied: false,
        taskType: 'diagnosis', generated: true }
    ],
    diagnosisParseStatus: 'parsed',
    sourcePromptVersionId: '', restoredFromRoundId: 'round-1',
    routeSnapshot: {
      packId: 'pack-1', packVersion: 2, routeId: 'route-1', title: '有来源路线',
      sourceIds: ['source-1'], verificationStatus: 'unverified', currentUnitId: 'unit-1',
      stages: [{ id: 'stage-1', title: '核对', status: 'user-confirmed-complete', confirmedAt: '2026-10-21' }]
    },
    materials: [{ id: 'material-1', title: '章节资料', excerpt: '仅用于第一章', unitIds: ['unit-1', 'unit-1', 'unit-2'] }]
  }] });

  const round = workspace.rounds[0];
  assert.equal(round.unitId, 'unit-1');
  assert.equal(round.unitSnapshot.title, '第一章');
  assert.equal(round.promptVersions[1].parentVersionId, 'prompt-1');
  assert.equal(round.promptVersions[1].taskType, 'diagnosis');
  assert.equal(round.promptVersions[1].generated, true);
  assert.equal(round.diagnosisParseStatus, 'parsed');
  assert.equal(round.promptVersions[0].copied, true, '复制标记仅记录操作');
  assert.equal(round.sourcePromptVersionId, '');
  assert.equal(round.restoredFromRoundId, 'round-1');
  assert.equal(round.routeSnapshot.packVersion, 2);
  assert.equal(round.routeSnapshot.stages[0].status, 'user-confirmed-complete');
  assert.deepEqual(round.materials[0].unitIds, ['unit-1', 'unit-2']);
  assert.equal(schema.normalizeWritingWorkspace({ rounds: [{ id: 'legacy-round', draft: '旧稿' }] }).rounds[0].unitId, '');
});

test('核心 C 关系字段有界、枚举受限且剔除路径、未知字段与凭证', () => {
  const normalized = schema.normalizeWritingWorkspace({
    units: Array.from({ length: 110 }, (_, index) => ({ id: `unit-${index}`, type: 'unknown', title: '单元'.repeat(300), order: -1 })),
    issues: [{
      id: 'issue-1', roundId: 'r1', judgment: 'expert-certified', status: 'auto-resolved',
      priority: 'urgent', excerpt: '引文'.repeat(1000), suggestion: '建议', secret: 'token'
    }],
    rounds: [{ id: 'r1', draft: '稿件', promptVersions: Array.from({ length: 120 }, (_, index) => ({
      id: `p${index}`, content: '词'.repeat(9000), copied: 'yes', absolutePath: 'D:/secret'
    })) }]
  });

  assert.ok(normalized.units.length <= 100);
  assert.ok(normalized.units[0].title.length <= 500);
  assert.equal(normalized.units[0].type, 'task');
  assert.equal(normalized.units[0].order, 0);
  assert.equal(normalized.issues[0].judgment, 'undetermined');
  assert.equal(normalized.issues[0].status, 'pending');
  assert.equal(normalized.issues[0].priority, 'medium');
  assert.ok(normalized.issues[0].excerpt.length <= 1200);
  assert.equal(normalized.rounds[0].promptVersions.length, 120, '归一化不得静默丢弃超出旧上限的版本');
  assert.ok(normalized.rounds[0].promptVersions[0].content.length <= 8000);
  assert.equal(normalized.rounds[0].promptVersions[0].copied, false);
  assert.doesNotMatch(JSON.stringify(normalized), /D:\\|secret|absolutePath/);
});

test('长篇项目资料白名单保留设定关系与历史，并清理未知字段和本机路径', () => {
  const workspace = schema.normalizeWritingWorkspace({
    genre: 'fiction',
    units: [{ id: 'chapter-1', type: 'chapter', title: '第一章', characterIds: ['hero'], summary: '主角抵达', viewpoint: '主角视角' }],
    longform: {
      mode: 'fiction', medium: '奇幻小说', viewpoint: '第三人称',
      canon: [{ id: 'fact-1', category: 'rule', name: '魔法代价', text: '使用后会疲惫', status: 'confirmed', unitIds: ['chapter-1'], path: 'D:/secret' }],
      characters: [{ id: 'hero', name: '林', goal: '找到姐姐', known: '姐姐失踪', unitIds: ['chapter-1'] }],
      timeline: [{ id: 'event-1', text: '离开村庄', storyTime: '秋季第 3 日', characterIds: ['hero'], unitIds: ['chapter-1'], order: 'before' }],
      foreshadowing: [{ id: 'foreshadow-1', planted: '旧徽章', status: 'planted', unitIds: ['chapter-1'] }],
      changes: [{ id: 'change-1', itemId: 'fact-1', itemType: 'canon', oldValue: '疲惫', newValue: '失忆', reason: '改设定', impacts: [{ id: 'chapter-1', type: 'unit', status: 'pending' }] }],
      accessToken: 'secret'
    }
  });
  assert.equal(workspace.longform.mode, 'fiction');
  assert.equal(workspace.longform.canon[0].status, 'confirmed');
  assert.deepEqual(workspace.longform.canon[0].unitIds, ['chapter-1']);
  assert.equal(workspace.longform.characters[0].id, 'hero');
  assert.equal(workspace.longform.timeline[0].order, 'before');
  assert.equal(workspace.longform.foreshadowing[0].status, 'planted');
  assert.equal(workspace.longform.changes[0].impacts[0].status, 'pending');
  assert.equal(workspace.units[0].summary, '主角抵达');
  assert.doesNotMatch(JSON.stringify(workspace), /D:\\|secret|accessToken|path/);
  assert.deepEqual(schema.normalizeWritingWorkspace(JSON.parse(JSON.stringify(workspace))), workspace);
  assert.equal(Object.hasOwn(schema.normalizeWritingWorkspace({ genre: 'article' }), 'longform'), false);
});

test('写作工作区持久化并白名单清洗资料覆盖状态', () => {
  const snapshot = coverage.createCoverageSnapshot({
    id: 'coverage-1', sourceKind: 'authorized-directory', inventoryComplete: true, knownTotal: 1,
    items: [{ id: 'source-1', title: '章节资料', sourceVersion: 'sha256:abc', relativePath: 'chapters/one.md', absolutePath: 'D:/private/one.md' }]
  });
  const normalized = schema.normalizeWritingWorkspace({
    id: 'article-1', genre: 'article', materialCoverage: snapshot,
    secret: 'drop-me'
  });
  assert.equal(normalized.materialCoverage.items[0].relativePath, 'chapters/one.md');
  assert.equal(normalized.materialCoverage.items[0].sourceVersion, 'sha256:abc');
  assert.equal(Object.hasOwn(normalized.materialCoverage.items[0], 'absolutePath'), false);
  assert.equal(Object.hasOwn(normalized, 'secret'), false);
  assert.deepEqual(schema.normalizeWritingWorkspace(JSON.parse(JSON.stringify(normalized))), normalized);
  assert.equal(Object.hasOwn(schema.normalizeWritingWorkspace({ genre: 'article', materialCoverage: { id: 'bad' } }), 'materialCoverage'), false);
});

test('材料来源元数据在新旧轮次中按白名单保留且不会升级核验状态', () => {
  const metadata = {
    provider: '出版社甲', accessedAt: '2026-10-20', license: '仅供研究引用',
    applicability: '适用于本研究范围', limitations: '不代表完整原文'
  };
  const round = schema.normalizeWritingRound({
    materials: [{ id: 'material-meta', title: '材料', ...metadata, secret: 'drop' }],
    sources: [{ id: 'source-meta', title: '来源', ...metadata, verificationStatus: 'unverified', secret: 'drop' }]
  });
  for (const item of [...round.materials, ...round.sources]) {
    for (const [key, value] of Object.entries(metadata)) assert.equal(item[key], value);
    assert.equal(item.verificationStatus || 'unverified', 'unverified');
    assert.equal(Object.hasOwn(item, 'secret'), false);
  }
  const savedRound = schema.normalizeWritingWorkspace({ rounds: [round] }).rounds[0];
  assert.equal(savedRound.materials[0].provider, '出版社甲');
  assert.equal(savedRound.sources[0].license, '仅供研究引用');
  const legacy = schema.normalizeWritingRound({ materials: [{ id: 'legacy', title: '旧材料' }] });
  assert.equal(legacy.materials[0].verificationStatus || 'unverified', 'unverified');
  assert.equal(Object.hasOwn(legacy.materials[0], 'provider'), false);
});

test('待改文件元数据只保留有限预览、有效目录选择和安全字段', () => {
  const round = schema.normalizeWritingRound({ sourceDocument: {
    name: '操作手册.docx', format: 'docx', fingerprint: '12000:abcd', parseStatus: 'parsed',
    extractedCharacterCount: 30000, pageCount: 0, preview: '预览'.repeat(5000),
    outline: [{ id: 's1', title: '安装', level: 1, locator: '第1段' }, { id: 's2', title: '配置', level: 2 }],
    selectedSectionIds: ['s1', 'unknown'], manualSectionRange: '', processingScope: 'sections', attachmentRequired: true,
    absolutePath: 'D:/private/操作手册.docx', file: { bytes: 'secret' }, raw: '完整正文哨兵'
  } });
  assert.ok(round.sourceDocument.preview.length <= 8000);
  assert.deepEqual(round.sourceDocument.selectedSectionIds, ['s1']);
  assert.equal(round.sourceDocument.outline.length, 2);
  assert.equal(Object.hasOwn(round.sourceDocument, 'absolutePath'), false);
  assert.equal(Object.hasOwn(round.sourceDocument, 'file'), false);
  assert.equal(JSON.stringify(round).includes('完整正文哨兵'), false);
  assert.equal(JSON.stringify(round).includes('secret'), false);
  const restored = schema.normalizeWritingWorkspace({ rounds: [round] }).rounds[0];
  assert.equal(restored.sourceDocument.name, '操作手册.docx');
  assert.deepEqual(restored.sourceDocument.selectedSectionIds, ['s1']);
});
