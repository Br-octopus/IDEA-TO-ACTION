const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const catalog = require('../prototype/writing-pack-catalog.js');
const workbench = require('../prototype/writing-workbench-schema.js');

test('内置包目录覆盖核心、文体和专项三层，核心与专项包有明确范围和方法卡', () => {
  const packs = catalog.getBuiltinWritingPacks();
  assert.deepEqual([...new Set(packs.map(pack => pack.layer))].sort(), ['core', 'genre', 'task']);
  const core = packs.find(pack => pack.id === 'builtin-writing-core');
  const revision = packs.find(pack => pack.id === 'builtin-task-revision');
  assert.ok(core?.methods.some(method => method.inputs.length && method.outputs.length && method.checks.length));
  assert.equal(core.genre, '');
  assert.deepEqual(revision.applicability.tasks, ['revision']);
  assert.ok(revision.applicability.exclusions.length);
  assert.ok(revision.routes.length === 0 || revision.routes.every(route => route.stages.every(stage =>
    stage.methodCardIds.every(id => revision.methods.some(method => method.id === id)))));
});

test('catalog 的普通文章内置包等价于现有 article 配置并含完整规则内容', () => {
  const packs = catalog.getBuiltinWritingPacks();
  const pack = packs.find(item => item.id === 'builtin-article');
  const config = workbench.WRITING_GENRE_CONFIGS.article;
  assert.ok(pack);
  assert.equal(pack.builtin, true);
  assert.equal(pack.layer, 'genre');
  assert.equal(pack.genre, 'article');
  assert.equal(pack.applicability.description, config.applicability);
  assert.deepEqual(pack.targetFields, config.targetFields);
  assert.deepEqual(pack.checkDimensions, config.checkDimensions);
  assert.deepEqual(pack.outputRequirements, config.outputRequirements);
  assert.deepEqual(pack.riskReminders, config.riskReminders);
  assert.deepEqual(pack.styleBaseline, config.styleBaseline);
  assert.equal(pack.memoryNamespace, config.memoryNamespace);
  assert.deepEqual(pack.checks.map(item => item.statement), config.checkDimensions);
  assert.deepEqual(pack.style.map(item => item.statement), config.styleBaseline);
  assert.deepEqual(pack.repairs.map(item => item.action), config.riskReminders);
  assert.deepEqual(pack.prompts.map(item => item.content), Object.values(config.outputRequirements));
  assert.deepEqual(pack.applicability.exclusions, ['其他文体需确认按普通文章处理。']);
  assert.ok(pack.sources.length > 0);
  assert.ok(pack.sources.every(source => source.verificationStatus === 'unverified'));
  assert.ok([...pack.checks, ...pack.style, ...pack.repairs, ...pack.prompts].every(item => item.verificationStatus === 'unverified'));
});

test('软著内容包可用于普通文章诊断与改写提示词，并区分官方要求和社区参考', () => {
  const pack = catalog.getBuiltinWritingPacks().find(item => item.id === 'builtin-softcopyright-content');
  assert.ok(pack);
  assert.equal(pack.name, '软著内容');
  assert.equal(pack.layer, 'task');
  assert.equal(pack.genre, 'article');
  assert.deepEqual(pack.applicability.tasks, ['article', 'diagnosis', 'revision']);
  assert.deepEqual(pack.prompts.map(item => item.taskType).sort(), ['diagnosis', 'revision']);
  assert.ok(pack.methods.some(item => /功能—证据—手册段落/.test(item.title)));
  assert.ok(pack.structures.some(item => /操作步骤/.test(item.sections.join(''))));
  assert.ok(pack.checks.some(item => /官方提交要求与社区写作建议分开/.test(item.statement)));
  assert.match(pack.requirements.find(item => item.id === 'softcopyright-document-pages')?.statement || '', /前、后各连续30页.*不足60页时提交全文.*每页不少于30行/);
  assert.match(pack.requirements.find(item => item.id === 'softcopyright-document-kind')?.statement || '', /没有规定操作手册必须使用固定目录/);
  assert.ok(pack.evidenceRules.some(item => /证据位置/.test(item.statement)));
  assert.equal(pack.sources.find(item => item.id === 'software-registration-measures')?.verificationStatus, 'source-reviewed');
  for (const id of ['softcopyright-yuefan', 'softcopyright-fanbuz', 'softcopyright-rodert', 'softcopyright-suling', 'user-docs-writing-skill']) {
    assert.ok(pack.sources.some(item => item.id === id), `缺少参考来源 ${id}`);
  }
  assert.ok(pack.prompts.every(item => item.sourceIds.every(id => pack.sources.some(source => source.id === id))));
});

test('catalog 提供三类综述路线和可追溯的官方报告来源', () => {
  const pack = catalog.getBuiltinWritingPacks().find(item => item.id === 'builtin-academic-review');
  assert.ok(pack, '综述工作台应能取得专用内置包');
  assert.equal(pack.builtin, true);
  assert.equal(pack.layer, 'genre');
  assert.equal(pack.genre, 'academic-review');
  assert.equal(pack.version, 1);
  assert.deepEqual(pack.routes.map(route => route.taskTypes[0]).sort(), [
    'narrative-review', 'scoping-review', 'systematic-review'
  ]);
  const sourceById = new Map(pack.sources.map(source => [source.id, source]));
  assert.match(sourceById.get('prisma-2020')?.url || '', /prisma-statement\.org\/prisma-2020/);
  assert.match(sourceById.get('prisma-scr')?.url || '', /prisma-statement\.org\/scoping/);
  assert.match(sourceById.get('prisma-s')?.url || '', /prisma-statement\.org\/prisma-search/);
  assert.match(sourceById.get('cochrane-handbook')?.version || '', /6\.5/);
  assert.equal(sourceById.get('jbi-manual')?.verificationStatus, 'source-reviewed');
  assert.match(sourceById.get('jbi-manual')?.locator || '', /10\.1.*10\.2/);
  assert.match(sourceById.get('jbi-manual')?.version || '', /27 August 2026/);
  assert.ok(pack.routes.find(route => route.taskTypes[0] === 'scoping-review').sourceIds.includes('jbi-manual'));
  assert.ok(pack.routes.every(route => route.sourceIds.every(id => sourceById.has(id))));
  assert.ok(pack.checks.some(item => /报告指南/.test(item.statement)));
  assert.ok(pack.checks.some(item => /偏倚风险/.test(item.statement)));
});

test('catalog 提供论文与学位论文专属包、规划路线及报告指南边界', () => {
  const pack = catalog.getBuiltinWritingPacks().find(item => item.id === 'builtin-academic-paper');
  assert.ok(pack, '论文工作台需要独立的学术文体包');
  assert.equal(pack.builtin, true);
  assert.equal(pack.layer, 'genre');
  assert.equal(pack.genre, 'academic-paper');
  assert.equal(pack.version, 1);
  assert.equal(pack.memoryNamespace, 'academic-paper');
  assert.deepEqual(pack.routes.map(route => route.id), ['academic-paper-route']);
  assert.deepEqual(pack.routes[0].taskTypes, ['academic-planning', 'academic-outline', 'academic-chapter-draft', 'diagnosis', 'revision']);
  assert.ok(pack.routes[0].stages.some(stage => /研究问题/.test(stage.title)));
  assert.ok(pack.routes[0].stages.some(stage => /章节/.test(stage.title)));
  assert.ok(pack.prompts.some(prompt => prompt.taskType === 'academic-chapter-draft'));
  assert.ok(pack.prompts.some(prompt => prompt.taskType === 'academic-outline'));
  assert.ok(pack.checks.some(check => /方法学质量|质量评分/.test(check.statement)));
  const source = pack.sources.find(item => item.id === 'equator-reporting-guidelines');
  assert.match(source?.url || '', /equator-network\.org\/library\/browse-reporting-guidelines-by-specialty/);
  assert.equal(source?.verificationStatus, 'source-reviewed');
  assert.ok(source?.checkedAt);
  assert.match(source?.limitations || '', /不.*质量|质量.*不/);
  assert.ok(pack.sources.every(item => item.license));
  assert.ok(pack.prompts.every(item => item.verificationStatus === 'unverified'));
  assert.equal(pack.checks.find(item => item.id === 'academic-report-vs-quality')?.verificationStatus, 'source-reviewed');
  assert.equal(pack.checks.find(item => item.id === 'academic-evidence-trace')?.verificationStatus, 'unverified');
});

test('catalog 提供核引、审稿回应和投稿准备专属包及官方来源边界', () => {
  const pack = catalog.getBuiltinWritingPacks().find(item => item.id === 'builtin-academic-publishing');
  assert.ok(pack, '学术 D 需要可独立启用的核验与投稿准备包');
  assert.equal(pack.builtin, true);
  assert.equal(pack.genre, 'academic-publishing');
  assert.equal(pack.version, 1);
  assert.deepEqual(pack.applicability.tasks, ['citation-check', 'reviewer-response', 'submission-prep']);
  const sources = new Map(pack.sources.map(source => [source.id, source]));
  assert.match(sources.get('crossref-rest-api')?.url || '', /crossref\.org\/documentation\/retrieve-metadata\/rest-api/);
  assert.match(sources.get('icmje-recommendations')?.url || '', /icmje\.org\/recommendations/);
  assert.match(sources.get('icmje-ai-confidentiality')?.url || '', /icmje\.org\/recommendations\/browse\/artificial-intelligence/);
  assert.match(sources.get('cope-peer-reviewers')?.url || '', /publicationethics\.org\/guidance\/guideline\/ethical-guidelines-peer-reviewers/);
  assert.ok([...sources.values()].every(source => source.verificationStatus === 'source-reviewed' && source.checkedAt));
  assert.match(sources.get('crossref-rest-api')?.limitations || '', /不.*论断|不能.*支持/);
  assert.match(sources.get('icmje-recommendations')?.applicability || '', /医学期刊/);
  assert.match(sources.get('icmje-ai-confidentiality')?.limitations || '', /明确许可|保密/);
  assert.deepEqual(pack.routes.map(route => route.id), ['academic-publishing-route']);
  assert.ok(pack.routes[0].stages.some(stage => /实际修改/.test(stage.title)));
  assert.ok(pack.checks.some(check => /用户确认|人工确认/.test(check.statement)));
  assert.ok(pack.prompts.some(prompt => prompt.taskType === 'citation-check'));
  assert.ok(pack.prompts.some(prompt => prompt.taskType === 'reviewer-response'));
  assert.ok(pack.prompts.some(prompt => prompt.taskType === 'submission-prep'));
  assert.ok(pack.prompts.every(prompt => prompt.verificationStatus === 'unverified'));
});

test('catalog 提供九个独立结构化文档文体包且来源状态诚实标为未核验', () => {
  const expected = [
    ['longform-research-article', '长篇研究文章'], ['technical-document', '技术文档'],
    ['business-document', '商务文档'], ['news', '新闻'], ['official-document', '公文'],
    ['legal-document', '法律文书'], ['tutorial-course', '教程课程'],
    ['resume-job-search', '简历求职'], ['email', '邮件']
  ];
  const packs = catalog.getBuiltinWritingPacks();
  const { normalizeWritingPack } = require('../prototype/writing-pack-schema.js');
  const structured = expected.map(([genre, name]) => {
    const pack = packs.find(item => item.id === `builtin-${genre}`);
    assert.ok(pack, `缺少 ${name} 内置包`);
    assert.equal(pack.name, name);
    assert.equal(pack.layer, 'genre');
    assert.equal(pack.genre, genre);
    assert.equal(pack.taskType, '');
    assert.equal(pack.builtin, true);
    assert.ok(pack.applicability.description.length > 0);
    assert.ok(pack.applicability.exclusions.length > 0);
    assert.ok(pack.prompts.length > 0);
    assert.ok(pack.checks.length > 0);
    assert.ok(pack.sources.length > 0);
    assert.ok(pack.prompts.every(prompt => prompt.verificationStatus === 'unverified'));
    assert.ok(pack.checks.every(check => check.verificationStatus === 'unverified'));
    assert.ok(pack.sources.every(source => source.verificationStatus === 'unverified'));
    assert.ok(pack.sources.every(source => /原创建议|未核验/.test(source.title + source.license + source.limitations)));
    assert.ok(pack.methods.length > 0, `${name} 缺少原创方法`);
    assert.ok(pack.repairs.length > 0, `${name} 缺少问题修复建议`);
    assert.ok(pack.examples.length > 0, `${name} 缺少固定合成示例`);
    assert.deepEqual(normalizeWritingPack(pack), { ...pack, builtin: false });
    return pack;
  });

  assert.equal(structured.length, 9);
  assert.equal(new Set(structured.map(pack => pack.genre)).size, 9);
  assert.equal(new Set(structured.flatMap(pack => pack.applicability.tasks)).size, structured.reduce((sum, pack) => sum + pack.applicability.tasks.length, 0));
  for (const pack of structured) {
    const declaredTasks = new Set(pack.applicability.tasks);
    assert.deepEqual([...declaredTasks], pack.applicability.tasks);
    assert.ok(pack.prompts.every(prompt => declaredTasks.has(prompt.taskType)));
    assert.ok(pack.routes.every(route => route.taskTypes.length > 0 && route.taskTypes.every(task => declaredTasks.has(task))));
    assert.ok(pack.routes.every(route => route.sourceIds.every(id => pack.sources.some(source => source.id === id))));
    assert.ok([...pack.prompts, ...pack.checks, ...pack.requirements, ...pack.methods, ...pack.repairs].every(item =>
      item.sourceIds.every(id => pack.sources.some(source => source.id === id))));
    assert.ok([...pack.methods, ...pack.repairs, ...pack.examples].every(item => item.verificationStatus === 'unverified'));
    assert.ok(pack.examples.every(item => item.kind === 'synthetic' && item.input && item.result && item.notes));
  }
  for (const pack of structured) {
    assert.ok(pack.routes.length > 0, `${pack.genre} 缺少专属路线`);
    assert.ok(pack.routes.every(route => route.stages.length > 0));
  }
});

test('九个结构化包和通用长篇包的方法/修复会进入适用提示词且来源维持未核验', () => {
  const prompts = require('../prototype/writing-workbench-prompts.js');
  const packs = catalog.getBuiltinWritingPacks();
  const genres = [
    'longform-research-article', 'technical-document', 'business-document', 'news',
    'tutorial-course', 'resume-job-search', 'email', 'official-document', 'legal-document',
    'longform-general'
  ];
  for (const genre of genres) {
    const pack = packs.find(item => item.genre === genre);
    const taskType = pack.applicability.tasks[0];
    const prompt = prompts.buildDomainWritingPrompt({
      article: { id: `article-${genre}`, genre, goal: '契约验证' },
      round: { taskType, draft: '仅用于提示词消费检查的模拟材料' }
    }, taskType, { phase: 'diagnosis' });
    assert.ok(pack.methods.every(item => prompt.includes(item.title) && prompt.includes(item.guidance)), `${genre} 方法未进入诊断提示词`);
    assert.ok(pack.repairs.every(item => prompt.includes(item.issue) && prompt.includes(item.action)), `${genre} 修复建议未进入诊断提示词`);
    assert.match(prompt, /核验：unverified/);
    assert.doesNotMatch(prompt, /专业验证通过|来源已审阅/);
  }
});

test('结构化文档包与普通文章、学术包及其他结构化文体的 genre/task 相互隔离', () => {
  const packs = catalog.getBuiltinWritingPacks();
  const ids = new Set([
    'builtin-longform-research-article', 'builtin-technical-document', 'builtin-business-document',
    'builtin-news', 'builtin-official-document', 'builtin-legal-document',
    'builtin-tutorial-course', 'builtin-resume-job-search', 'builtin-email'
  ]);
  const structured = packs.filter(pack => ids.has(pack.id));
  const existing = packs.filter(pack => !ids.has(pack.id));
  assert.equal(structured.length, 9);
  for (const pack of structured) {
    assert.ok(existing.every(other => other.genre !== pack.genre));
    assert.ok(existing.every(other => other.taskType !== pack.taskType || !pack.taskType));
    for (const other of structured) {
      if (other.id === pack.id) continue;
      assert.notEqual(other.genre, pack.genre);
      assert.ok(!pack.taskType || other.taskType !== pack.taskType);
      assert.ok(pack.prompts.every(prompt => !other.applicability.tasks.includes(prompt.taskType)));
    }
  }
});

test('结构化文档每个任务都有领域专属输入、输出结构和边界检查', () => {
  const expected = {
    'longform-research-article': {
      'research-brief': ['章节职责', '材料映射'], 'section-plan': ['章节目标', '材料范围'],
      'section-diagnosis': ['问题定位', '优先级'], 'section-revision': ['修改指令', '保留项'],
      'cross-section-review': ['跨节追踪', '来源位置']
    },
    'technical-document': {
      'technical-procedure': ['前置条件', '逐步操作', '预期结果'],
      'technical-api': ['请求', '响应', '错误码'], 'technical-design': ['需求', '方案', '权衡'],
      'technical-troubleshooting': ['现象', '诊断步骤', '恢复条件']
    },
    'business-document': {
      'business-report': ['决策摘要', '数据来源'], 'business-proposal': ['方案选项', '成本依赖'],
      'business-marketing': ['受众', '主张依据', '行动号召']
    },
    news: {
      'news-fact-organization': ['时间线', '原始引语', '来源位置'],
      'news-release': ['事实表', '归属', '待回应'], 'news-review': ['逐项核对', '更正风险']
    },
    'tutorial-course': {
      'course-plan': ['学习目标', '课程顺序'], 'lesson-plan': ['讲解', '示例', '练习'],
      'learning-check': ['题目', '答案依据', '完成条件']
    },
    'resume-job-search': {
      'resume-experience-map': ['经历证据', '待用户确认'],
      'resume-target-fit': ['岗位要求', '证据映射', '缺口'],
      'resume-revision': ['原始事实', '改写建议', '核实项']
    },
    email: {
      'email-draft': ['主题', '请求动作', '期限'],
      'email-revision': ['原意', '修改建议', '承诺边界'],
      'email-review': ['收件人', '行动人', '发送前确认']
    },
    'official-document': {
      'official-document-plan': ['组织层级', '文种', '行文对象'],
      'official-document-review': ['规范来源', '版本时点', '待核对']
    },
    'legal-document': {
      'legal-fact-organization': ['当事人陈述', '证据', '待证事项'],
      'legal-document-outline': ['用户指定文书', '法域', '专业审阅'],
      'legal-document-review': ['规则来源', '适用时点', '律师审阅']
    }
  };
  const packs = catalog.getBuiltinWritingPacks();
  for (const [genre, tasks] of Object.entries(expected)) {
    const pack = packs.find(item => item.genre === genre);
    assert.ok(pack, `缺少 ${genre}`);
    assert.deepEqual(pack.prompts.map(item => item.taskType), Object.keys(tasks));
    for (const [taskType, markers] of Object.entries(tasks)) {
      const prompt = pack.prompts.find(item => item.taskType === taskType);
      const output = pack.outputRequirements[taskType];
      assert.ok(prompt.content.length > 250, `${genre}/${taskType} 的提示词应包含完整专属指令`);
      for (const marker of markers) {
        assert.ok(output.includes(marker) && prompt.content.includes(marker), `${genre}/${taskType} 缺少专属输出项：${marker}`);
      }
      assert.ok(prompt.content.includes('原创操作建议') || prompt.content.includes('项目自拟'), `${genre}/${taskType} 应说明内容为项目自拟建议`);
    }
  }
  const technical = packs.find(item => item.genre === 'technical-document');
  for (const task of technical.prompts) {
    assert.match(task.content, /版本|环境/);
    assert.match(task.content, /材料|验证|待确认/);
  }
  const news = packs.find(item => item.genre === 'news');
  for (const task of news.prompts) assert.match(task.content, /引语|原话/);
  const official = packs.find(item => item.genre === 'official-document');
  for (const task of official.prompts) assert.match(task.content, /用户确认|用户提供/);
  const legal = packs.find(item => item.genre === 'legal-document');
  for (const task of legal.prompts) assert.match(task.content, /法域|时点/);
});

test('catalog 增加八个视听社媒与长篇创作包，任务与 schema 一致且来源均未核验', () => {
  const expectedGenres = ['social-post', 'short-video', 'spoken-script', 'podcast', 'speech', 'fiction', 'script', 'longform-general'];
  const packs = catalog.getBuiltinWritingPacks();
  const newPacks = expectedGenres.map(genre => {
    const pack = packs.find(item => item.id === `builtin-${genre}`);
    const config = workbench.getWritingGenreConfig(genre);
    assert.ok(pack, `缺少 ${genre} 内置包`);
    assert.ok(config, `schema 缺少 ${genre} 配置`);
    assert.equal(pack.genre, genre);
    assert.equal(pack.layer, 'genre');
    assert.equal(pack.builtin, true);
    assert.equal(pack.taskType, '');
    assert.deepEqual(pack.applicability.tasks, config.taskTypes);
    assert.deepEqual(pack.prompts.map(prompt => prompt.taskType), config.taskTypes);
    assert.deepEqual(pack.routes.map(route => route.taskTypes), [config.taskTypes]);
    assert.ok(pack.applicability.description.length > 0);
    assert.ok(pack.applicability.exclusions.length > 0);
    assert.ok(pack.checks.length > 0);
    assert.equal(pack.routes.length, 1);
    assert.ok(pack.routes[0].stages.length > 0);
    assert.ok(pack.prompts.every(prompt => prompt.content.length > 30));
    assert.ok(pack.sources.length > 0);
    assert.ok(pack.sources.every(source => source.verificationStatus === 'unverified'));
    assert.ok(pack.sources.every(source => /原创操作建议/.test(source.title + source.license)));
    assert.ok(pack.sources.every(source => /未核验/.test(source.title + source.checkedAt + source.limitations)));
    assert.ok([...pack.prompts, ...pack.checks, ...pack.requirements, ...pack.routes,
      ...pack.routes.flatMap(route => route.stages)].every(item =>
      item.sourceIds.every(id => pack.sources.some(source => source.id === id))));
    return pack;
  });

  assert.equal(newPacks.length, 8);
  assert.equal(new Set(newPacks.map(pack => pack.genre)).size, 8);
  assert.equal(packs.length, 24, '包含原有包和新增软著内容包');
});

test('视听社媒与长篇包的提示词按文体及专属任务隔离', () => {
  const genres = ['social-post', 'short-video', 'spoken-script', 'podcast', 'speech', 'fiction', 'script', 'longform-general'];
  const packs = genres.map(genre => catalog.getBuiltinWritingPacks().find(item => item.genre === genre));
  for (const pack of packs) {
    assert.ok(pack);
    assert.ok(pack.prompts.every(prompt => prompt.content.includes(pack.name)));
    assert.ok(pack.prompts.every(prompt => pack.applicability.tasks.includes(prompt.taskType)));
    for (const other of packs) {
      if (other.genre === pack.genre) continue;
      assert.notEqual(other.genre, pack.genre);
      assert.notEqual(other.id, pack.id);
    }
  }
  for (const sharedTask of ['longform-planning', 'longform-outline', 'longform-continuity', 'longform-revision']) {
    const matching = packs.filter(pack => pack.applicability.tasks.includes(sharedTask));
    assert.ok(matching.length > 1, `${sharedTask} 应按 schema 供多个长篇文体使用`);
    assert.equal(new Set(matching.map(pack => pack.prompts.find(prompt => prompt.taskType === sharedTask).content)).size, matching.length,
      `${sharedTask} 在不同文体中应保有独立提示词`);
  }
});

test('社媒图文、短视频、口播、播客、演讲、小说和剧本包含自拟方法、修复和固定合成示例', () => {
  const genres = ['social-post', 'short-video', 'spoken-script', 'podcast', 'speech', 'fiction', 'script'];
  for (const genre of genres) {
    const pack = catalog.getBuiltinWritingPacks().find(item => item.genre === genre);
    assert.ok(pack);
    assert.ok(pack.methods.length > 0, `${genre} 缺少操作方法`);
    assert.ok(pack.repairs.length > 0, `${genre} 缺少问题修复建议`);
    assert.ok(pack.examples.length > 0, `${genre} 缺少固定示例`);
    for (const item of [...pack.methods, ...pack.repairs, ...pack.examples]) {
      assert.equal(item.verificationStatus, 'unverified');
      if (item.sourceIds) assert.ok(item.sourceIds.every(id => pack.sources.some(source => source.id === id)));
    }
    assert.ok(pack.examples.every(example => example.kind === 'synthetic' && example.input && example.result && example.notes));
    assert.ok(pack.sources.every(source => source.verificationStatus === 'unverified'));
    assert.ok(pack.sources.every(source => /自拟|原创操作建议/.test(source.title + source.license + source.limitations)));
    assert.ok(pack.sources.every(source => !/平台规范已核实|专业验证通过/.test(source.limitations)));
  }
});

test('catalog 返回深层不可变副本', () => {
  const packs = catalog.getBuiltinWritingPacks();
  const freezeDeep = value => {
    if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value));
      Object.values(value).forEach(freezeDeep);
    }
  };
  freezeDeep(packs);
  assert.throws(() => packs[0].checks.push({ id: 'fake', statement: '篡改' }), TypeError);
  packs[0].sources[0].title = '篡改';
  assert.equal(packs[0].sources[0].title, '现有普通文章规则');
  assert.equal(catalog.getBuiltinWritingPacks()[0].sources[0].title, '现有普通文章规则');
});

test('catalog 工厂不接受输入覆盖 builtin 且 UMD 全局可调用', () => {
  const { normalizeWritingPack } = require('../prototype/writing-pack-schema.js');
  const custom = normalizeWritingPack({ id: 'custom', name: '用户包', layer: 'task', version: 1, builtin: true, basePackId: 'builtin-article' });
  assert.equal(custom.builtin, false);
  const context = vm.createContext({});
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-pack-catalog.js'), 'utf8'), context);
  assert.equal(typeof context.WritingPackCatalog.getBuiltinWritingPacks, 'function');
  assert.equal(context.WritingPackCatalog.getBuiltinWritingPacks()[0].id, 'builtin-article');
});

test('浏览器 UMD 遇到旧版或残缺普通文章配置时安全使用基线默认值', () => {
  const source = readFileSync(require.resolve('../prototype/writing-pack-catalog.js'), 'utf8');
  const schemaSource = readFileSync(require.resolve('../prototype/writing-pack-schema.js'), 'utf8');
  for (const workbench of [
    {},
    { WRITING_GENRE_CONFIGS: { article: {} } },
    { WRITING_GENRE_CONFIGS: { article: { targetFields: { title: '标题' }, outputRequirements: { revision: '保留观点' } } } }
  ]) {
    const context = vm.createContext({ WritingWorkbenchSchema: workbench });
    vm.runInContext(schemaSource, context);
    vm.runInContext(source, context);
    const pack = context.WritingPackCatalog.getBuiltinWritingPacks()[0];
    assert.equal(pack.id, 'builtin-article');
    assert.equal(pack.memoryNamespace, 'article');
    assert.equal(pack.checkDimensions.length, 8);
    assert.deepEqual(Object.keys(pack.outputRequirements), ['diagnosis', 'revision']);
    assert.equal(pack.targetFields.goal, '目标');
  }
});

test('没有 globalThis 的 UMD 环境仍能调用内置包 catalog', () => {
  const schemaSource = readFileSync(require.resolve('../prototype/writing-pack-schema.js'), 'utf8');
  const catalogSource = readFileSync(require.resolve('../prototype/writing-pack-catalog.js'), 'utf8');
  const workbenchSource = readFileSync(require.resolve('../prototype/writing-workbench-schema.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(workbenchSource, context);
  vm.runInContext('delete globalThis.globalThis', context);
  vm.runInContext(schemaSource, context);
  vm.runInContext(catalogSource, context);
  assert.equal(context.WritingPackCatalog.getBuiltinWritingPacks()[0].id, 'builtin-article');
});
