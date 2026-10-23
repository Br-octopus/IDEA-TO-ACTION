const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const api = require('../prototype/writing-workbench-prompts.js');
const schema = require('../prototype/writing-workbench-schema.js');
const { buildWritingDiagnosisPrompt: diagnose, buildWritingRevisionPrompt: revise,
  deriveWritingStyleProfile: derive, buildLocalWritingDiagnosis: local,
  selectWritingPacks } = api;
const material = (purpose, excerpt, id = purpose) => ({ id, sourceArticleId: `source-${id}`, purpose, excerpt });

test('小说与剧本任务仅带入显式关联的前后单元摘要和未解决问题', () => {
  const prompt = api.buildDomainWritingPrompt({
    article: { id: 'story-a', genre: 'fiction', goal: '写当前章节' },
    units: [
      { id: 'before', title: '前章', summary: '前章摘要哨兵', nextUnitIds: ['current'] },
      { id: 'current', title: '当前章', priorUnitIds: ['before'], nextUnitIds: ['after'] },
      { id: 'after', title: '后章', summary: '后章摘要哨兵', priorUnitIds: ['current'] },
      { id: 'unrelated', title: '无关章', summary: '无关单元泄漏哨兵' }
    ],
    round: { id: 'round-a', unitId: 'current', taskType: 'longform-chapter-draft',
      unitSnapshot: { id: 'current', title: '当前章', priorUnitIds: ['before'], nextUnitIds: ['after'] },
      longformSnapshot: { mode: 'fiction', canon: [], characters: [], timeline: [], foreshadowing: [],
        contextNote: '前后单元摘要\n前章[before]：前章摘要哨兵\n后章[after]：后章摘要哨兵\n当前未解决问题\n[issue-current] 当前章问题哨兵' },
      materials: [] },
    issues: [
      { id: 'issue-current', articleId: 'story-a', unitId: 'current', status: 'pending-user', observation: '当前章问题哨兵' },
      { id: 'issue-other', articleId: 'story-a', unitId: 'unrelated', status: 'pending-user', observation: '无关问题泄漏哨兵' },
      { id: 'issue-foreign', articleId: 'story-b', unitId: 'before', status: 'pending-user', observation: '其他作品泄漏哨兵' }
    ]
  }, 'longform-chapter-draft');
  assert.match(prompt, /前章摘要哨兵/);
  assert.match(prompt, /后章摘要哨兵/);
  assert.match(prompt, /当前章问题哨兵/);
  assert.doesNotMatch(prompt, /无关单元泄漏哨兵|无关问题泄漏哨兵|其他作品泄漏哨兵/);
  assert.match(prompt, /用户目标与专业规则冲突处理/);
  assert.match(prompt, /未核验规则不得作为权威要求/);
});

test('长篇研究文章提示词使用章节关系上下文，不混入故事连续性字段', () => {
  const prompt = api.buildDomainWritingPrompt({
    article: { id: 'research-a', genre: 'longform-research-article', goal: '追踪章节论点和证据' },
    units: [{ id: 'section-2', title: '第二节：证据分析', summary: '比较两组证据范围', priorUnitIds: ['section-1'], nextUnitIds: ['section-3'] }],
    round: { id: 'round-research', unitId: 'section-2', taskType: 'section-plan',
      unitSnapshot: { id: 'section-2', type: 'chapter', title: '第二节：证据分析', goal: '整理证据关系',
        completionCriteria: ['每个论点可回到材料'], summary: '比较两组证据范围', priorUnitIds: ['section-1'], nextUnitIds: ['section-3'] },
      materials: [] }
  }, 'section-plan');

  assert.match(prompt, /研究文章章节上下文/);
  assert.match(prompt, /第二节：证据分析/);
  assert.match(prompt, /比较两组证据范围/);
  assert.match(prompt, /前序章节 section-1/);
  assert.match(prompt, /后续章节 section-3/);
  assert.doesNotMatch(prompt, /章节\/场景上下文|故事内时间|人物出场|设定 ID|伏笔/);
});

test('领域提示词使用适用范围内的记忆并显式处理偏好冲突', () => {
  const prompt = api.buildDomainWritingPrompt({
    id: 'project-a',
    article: { id: 'project-a', genre: 'business-document', goal: '只写已确认的客户数量' },
    memories: [
      { id: 'project-memory', scope: 'project', projectId: 'project-a', preference: '缺少依据的指标标为待核实' },
      { id: 'other-project', scope: 'project', projectId: 'project-b', preference: '其他项目偏好哨兵' },
      { id: 'global-memory', scope: 'general', preference: '句子尽量简洁' }
    ],
    round: { id: 'round-project', taskType: 'business-proposal', materials: [] }
  }, 'business-proposal');

  assert.match(prompt, /用户偏好与专业规则冲突处理/);
  assert.match(prompt, /项目范围：缺少依据的指标标为待核实/);
  assert.match(prompt, /通用范围：句子尽量简洁/);
  assert.doesNotMatch(prompt, /其他项目偏好哨兵/);
  assert.match(prompt, /适用记忆是用户偏好，不是事实、证据或专业规则/);
  assert.match(prompt, /当前目标、成功标准、保留项或限制条件冲突时/);
  assert.match(prompt, /与专业规则冲突时，列出双方依据、规则条目、来源与核验状态/);
});

test('结构化领域提示词将事实和规则材料的来源元数据带入实际提示词', () => {
  const metadata = {
    provider: '播客来源发布方哨兵', accessedAt: '2026-10-22', license: '播客来源许可哨兵',
    applicability: '播客来源适用范围哨兵', limitations: '播客来源限制哨兵'
  };
  const prompt = api.buildDomainWritingPrompt({
    article: { id: 'podcast-metadata', genre: 'podcast', goal: '用可追溯材料整理播客提纲' },
    round: { id: 'round-podcast-metadata', taskType: 'podcast-script', materials: [
      { id: 'podcast-fact', title: '事实材料', purpose: 'content', excerpt: '合成事实摘录', ...metadata },
      { id: 'podcast-rule', title: '要求材料', purpose: 'requirement', excerpt: '合成要求摘录', ...metadata }
    ] }
  }, 'podcast-script');

  for (const value of Object.values(metadata)) assert.ok(prompt.includes(value), value);
  assert.match(prompt, /未核验/);
  assert.match(prompt, /合成事实摘录/);
  assert.match(prompt, /合成要求摘录/);
});

test('提示词和本地初检实际消费文体配置，保留用户要求与风格优先级', () => {
  const schema = require('../prototype/writing-workbench-schema.js');
  const config = {
    name: '普通文章', applicability: '适用哨兵', targetFields: { goal: '配置目标', title: '标题', audience: '读者', platform: '平台', successCriteria: '成功标准', preserveItems: '保留项', constraints: '限制条件' },
    checkDimensions: ['事实依据'], outputRequirements: { diagnosis: '诊断输出哨兵', revision: '改稿输出哨兵' },
    riskReminders: ['风险哨兵'], styleBaseline: ['风格基线哨兵'], memoryNamespace: 'article'
  };
  const context = vm.createContext({ WritingWorkbenchSchema: { ...schema,
    getWritingGenreConfig: genre => genre === 'article' ? config : null } });
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-workbench-prompts.js'), 'utf8'), context);
  const api = context.WritingWorkbenchPrompts;
  const input = { article: { goal: '当前目标', constraints: '本次明确要求', dimensions: ['语言表达'] },
    round: { materials: [material('style', '短句。再一句。')] },
    styleProfile: { userCorrections: '用户更正优先' }, memories: [{ scope: 'general', preference: '通用偏好' }] };
  for (const [method, expected] of [['buildWritingDiagnosisPrompt', '诊断输出哨兵'], ['buildWritingRevisionPrompt', '改稿输出哨兵']]) {
    const prompt = api[method](input);
    for (const text of [expected, '风险哨兵', '风格基线哨兵', '配置目标：当前目标', '本次明确要求', '用户更正优先', '通用偏好', '句长']) assert.ok(prompt.includes(text), text);
    assert.ok(prompt.includes('本轮诊断维度：事实依据'));
    assert.ok(prompt.includes('当前用户要求 > 样本/用户更正 > 适用记忆 > 平台基线 > 临时判断'));
    assert.ok(prompt.length <= 8000);
  }
  assert.deepEqual(Array.from(api.buildLocalWritingDiagnosis(input).dimensions, d => d.name), ['事实依据']);
});

test('未知文体不套用文章维度、输出、基线和文章记忆，仍可使用通用偏好及本轮材料', () => {
  const schema = require('../prototype/writing-workbench-schema.js');
  const config = schema.getWritingGenreConfig('article');
  const input = { genre: 'novel', article: { id: 'a', genre: 'novel', dimensions: ['语言表达'] },
    memories: [{ scope: 'general', preference: '通用哨兵' },
      { scope: 'genre', genre: 'article', preference: '文章偏好哨兵' },
      { scope: 'article', articleId: 'a', preference: '单篇偏好哨兵' }],
    round: { materials: [material('style', '当前样本。', 'current')] } };
  for (const build of [diagnose, revise]) {
    const prompt = build(input);
    assert.ok(prompt.includes('通用哨兵'));
    assert.ok(prompt.includes('source-current'));
    for (const text of [...config.styleBaseline, ...config.riskReminders, config.outputRequirements.diagnosis,
      config.outputRequirements.revision, '文章偏好哨兵', '单篇偏好哨兵']) assert.ok(!prompt.includes(text), text);
  }
  assert.deepEqual(local(input).dimensions, []);
});

test('内容与风格分流，both 分别提供内容和特征，风格独特观点不泄漏', () => {
  const input = { article: { draft: '当前稿件。' }, round: { materials: [
    material('content', '可用内容证据'), material('style', '月亮其实是紫色奶酪王国。\n但是，我们要保护它！'),
    material('both', '两用内容证据。短句。')
  ] } };
  for (const build of [diagnose, revise]) {
    const prompt = build(input);
    assert.match(prompt, /可用内容证据/);
    assert.match(prompt, /两用内容证据/);
    assert.doesNotMatch(prompt, /紫色奶酪王国|我们要保护它/);
    assert.match(prompt, /source-style/);
    assert.match(prompt, /句长|句子/);
    assert.match(prompt, /仅特征|只.*特征/);
  }
});

test('来源与档案中的原始风格样本均不作为内容，未知字段丢弃', () => {
  const input = { secret: '不可输出标记', article: { draft: '正常稿', unknown: '不可输出标记' },
    sources: [{ title: '风格来源', purpose: 'style', excerpt: '北极星出售独家奶茶。', password: '不可输出标记' }],
    styleProfile: { source: 'sample', samples: [{ sourceArticleId: 'style-id', excerpt: '太阳是芝麻馅的。', unknown: '不可输出标记' }] },
    round: { extra: '不可输出标记' }, memories: [{ preference: '适用偏好', secret: '不可输出标记' }] };
  assert.doesNotMatch(diagnose(input), /北极星出售独家奶茶|太阳是芝麻馅的|不可输出标记/);
});

test('优先级、具体诊断和边界完整，八维可选择子集', () => {
  const prompt = diagnose({ article: { dimensions: ['语言表达', '约束风险', '不存在'] } });
  assert.match(prompt, /当前用户要求 > 样本\/用户更正 > 适用记忆 > 平台基线 > 临时判断/);
  for (const text of ['具体句段', '观察', '影响', '方向', '优先级', '事实', '偏好', '不机械替词', '无问题不强改', '最多一个关键问题', '简单改稿不阻塞']) assert.ok(prompt.includes(text), text);
  assert.match(prompt, /不.*身份.*结论/);
  assert.match(prompt, /不.*分数/);
  assert.match(prompt, /不得直接改写文章或产出文章成品/);
  assert.match(prompt, /本轮诊断维度：语言表达、约束风险/);
  const all = diagnose();
  for (const name of ['目标读者', '事实依据', '逻辑结构', '语言表达', '风格修辞', '术语一致', '格式排版', '约束风险']) assert.ok(all.includes(name));
});

test('选择任务单元后只采用全文和当前单元材料，并显示目标、材料长度与未采用范围', () => {
  const prompt = revise({
    units: [{ id: 'unit-1', type: 'chapter', title: '第一章', goal: '解释研究背景', completionCriteria: ['说明关键概念'] }],
    article: { goal: '完成文章', draft: '当前稿件' },
    round: {
      unitId: 'unit-1', unitSnapshot: { id: 'unit-1', type: 'chapter', title: '第一章', goal: '解释研究背景', completionCriteria: ['说明关键概念'] },
      materials: [
        { id: 'whole', title: '全文共用', purpose: 'content', excerpt: '全文证据' },
        { id: 'current', title: '第一章资料', purpose: 'content', excerpt: '本章专用依据', unitIds: ['unit-1'] },
        { id: 'other', title: '第二章资料', purpose: 'content', excerpt: '跨章污染哨兵', unitIds: ['unit-2'] }
      ]
    }
  });

  for (const value of ['第一章', '解释研究背景', '说明关键概念', '全文证据', '本章专用依据', '第二章资料', '未采用', '实际嵌入']) {
    assert.ok(prompt.includes(value), value);
  }
  assert.ok(!prompt.includes('跨章污染哨兵'));
  assert.match(prompt, /全文材料与当前单元材料/);
  assert.match(prompt, /材料\d+字|材料.*字/);
  assert.ok(prompt.length <= 8000);
});

test('没有任务单元时保留原有全文材料行为', () => {
  const prompt = revise({ round: { materials: [
    { id: 'a', title: '资料甲', purpose: 'content', excerpt: '全文上下文甲' },
    { id: 'b', title: '资料乙', purpose: 'content', excerpt: '全文上下文乙', unitIds: ['unit-other'] }
  ] } });
  assert.ok(prompt.includes('全文上下文甲'));
  assert.ok(prompt.includes('全文上下文乙'));
});

test('提示词只读取轮次路线快照并明确来源状态、步骤和非认证边界', () => {
  const prompt = revise({ round: {
    routeSnapshot: {
      packId: 'pack-1', packVersion: 2, routeId: 'route-1', title: '逐项核对路线',
      sourceIds: ['source-1'], verificationStatus: 'unverified', currentStageId: 'stage-1',
      sources: [{ id: 'source-1', title: '路线参考来源', verificationStatus: 'unverified' }],
      stages: [{
        id: 'stage-1', title: '核对论据', inputs: ['稿件'], outputs: ['证据表'], checks: ['能定位'],
        sourceIds: ['source-1'], verificationStatus: 'unverified', status: 'in-progress'
      }]
    }
  } });
  for (const value of ['逐项核对路线', '路线参考来源', '核对论据', '证据表', 'in-progress', '用户确认完成不等于专业认证']) {
    assert.ok(prompt.includes(value), value);
  }
  assert.match(prompt, /路线来源.*未核验|未核验.*路线来源/);

  const direct = revise({ round: { draft: '普通全文' } });
  assert.match(direct, /直接模式.*当前选用的基础包没有适用路线/);
});

test('模型诊断要求严格 JSON 问题候选，不允许替用户确认或改变状态', () => {
  const prompt = diagnose({ round: { draft: '待诊断稿件' } });
  for (const value of ['结构化问题候选 JSON', '"issues"', '"location"', '"excerpt"', '"observation"',
    '"impact"', '"evidenceCategory"', '"evidenceDescription"', '"suggestion"', '"priority"',
    '候选问题', '不得改变问题处理状态']) assert.ok(prompt.includes(value), value);
  assert.match(prompt, /无法输出有效 JSON.*原始诊断仍可查看|原始诊断仍保留/);
});

test('离线风格统计具有来源关联和低中置信度，纠正优先且不修改输入', () => {
  const materials = [material('style', '# 标题\n短句。\n但是这是一句明显更长的句子，用来解释为什么。难道不是吗？', 'm1')];
  const original = JSON.stringify(materials);
  const profile = derive(materials, { userCorrections: '保留必要长句', secret: '不可输出标记' });
  assert.equal(profile.source, 'user-corrected');
  assert.equal(profile.userCorrections, '保留必要长句');
  assert.ok(['low', 'medium'].includes(profile.confidence));
  assert.ok(profile.sourceArticleIds.includes('source-m1'));
  for (const pattern of [/句长/, /段落/, /标点/, /转折/, /标题/, /修辞/]) assert.match(profile.traits.join('；'), pattern);
  assert.equal(profile.samples[0].excerpt, '');
  assert.equal(JSON.stringify(materials), original);
  assert.doesNotMatch(JSON.stringify(profile), /明显更长的句子|难道不是吗|不可输出标记/);
});

test('无样本标 temporary，无样本记忆时明确临时建议', () => {
  assert.equal(derive([]).source, 'temporary');
  assert.match(diagnose({}), /临时建议/);
  assert.match(diagnose({}), /temporary/);
  assert.equal(derive([material('content', '不能作为风格')]).source, 'temporary');
});

test('下一轮指令保留目标、全部成功标准、保留项、最新反馈、诊断和风格，允许外部 AI 修改', () => {
  const prompt = revise({ article: { goal: '解释流程', successCriteria: Array.from({ length: 20 }, (_, i) => `验收标准${i}`), preserveItems: ['保留核心结论'], draft: '第一稿' },
    rounds: [{ id: 'r0', diagnosis: '前轮诊断标记' }],
    round: { draft: '当前稿', feedback: '最新反馈标记', userFeedback: '用户反馈标记', revisionNote: '本轮说明' },
    styleProfile: { source: 'user', traits: ['简洁克制'], userCorrections: '保留专业术语' } });
  for (const text of ['解释流程', '保留核心结论', '最新反馈标记', '用户反馈标记', '前轮诊断标记', '简洁克制', '保留专业术语', '当前稿', '本轮说明']) assert.ok(prompt.includes(text), text);
  for (let i = 0; i < 20; i++) assert.ok(prompt.includes(`验收标准${i}`));
  assert.match(prompt, /外部 AI.*执行修改/);
  assert.match(prompt, /本工具只生成提示词/);
});

test('只选适用少量记忆，排除其他文章、文体和撤销项，优先文章级', () => {
  const memories = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, scope: 'general', preference: `通用偏好${i}` })),
    { id: 'mine', scope: 'article', articleId: 'a1', preference: '当前文章专属' },
    { scope: 'article', articleId: 'a2', preference: '别的文章记忆' },
    { scope: 'genre', genre: 'novel', preference: '不适用文体' },
    { scope: 'general', preference: '已撤销偏好', undo: { undoneAt: '2026-10-20' } }
  ];
  const prompt = diagnose({ article: { id: 'a1' }, memories });
  assert.match(prompt, /当前文章专属/);
  assert.doesNotMatch(prompt, /别的文章记忆|不适用文体|已撤销偏好|通用偏好7/);
  assert.match(prompt, /记忆.*摘要|记忆.*选取/);
});

test('超限上下文预算保留最新反馈与约束，全部标准与保留项有摘要，提示词可持久化', () => {
  const input = { article: { goal: '目标'.repeat(250), constraints: '关键约束'.repeat(125), draft: '正文'.repeat(6000),
    successCriteria: Array.from({ length: 20 }, (_, i) => `标准${i}：` + '细则'.repeat(250)),
    preserveItems: Array.from({ length: 30 }, (_, i) => `保留${i}：` + '内容'.repeat(250)) },
    rounds: Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, draft: '旧稿'.repeat(4000), diagnosis: '旧诊断'.repeat(1000) })),
    round: { feedback: '反馈'.repeat(997) + '反馈尾标记', userFeedback: '更正'.repeat(997) + '更正尾标记', revisionNote: '说明'.repeat(500) },
    sources: Array.from({ length: 20 }, (_, i) => ({ title: `来源${i}`, excerpt: '材料'.repeat(600), purpose: 'content' })) };
  for (const build of [diagnose, revise]) {
    const prompt = build(input);
    assert.ok(prompt.length <= 8000, prompt.length);
    assert.ok(prompt.includes(input.article.constraints));
    assert.ok(prompt.includes(input.round.feedback));
    assert.ok(prompt.includes(input.round.userFeedback));
    for (let i = 0; i < 20; i++) assert.ok(prompt.includes(`标准${i}：`), `标准${i}`);
    for (let i = 0; i < 30; i++) assert.ok(prompt.includes(`保留${i}：`), `保留${i}`);
    assert.match(prompt, /前缀节选；未作摘要/);
    assert.match(prompt, /8000/);
    assert.match(prompt, /省略|未纳入/);
    assert.match(prompt, /当前用户要求 > 样本/);
  }
});

test('本地初检只给具体线索，八维未确定项待核实，不冒充模型或质量验证', () => {
  const result = local({ article: { draft: '这是非常重要的。\n\n这是非常重要的。\n#标题未分隔' } });
  assert.match(result.label, /本地规则初检，未经过模型诊断/);
  assert.equal(result.dimensions.length, 8);
  const serialized = JSON.stringify(result);
  assert.match(serialized, /这是非常重要的/);
  assert.match(serialized, /重复/);
  assert.match(serialized, /待核实/);
  assert.doesNotMatch(serialized, /AI生成概率|质量已验证/);
  assert.equal(local({ article: { dimensions: ['事实依据'], draft: '普通句子。' } }).dimensions.length, 1);
});

test('口播本地初检只估算文字时长并标出过长句段供试读，不冒充真实测时', () => {
  const draft = '夜间通勤需要提前查看班次和站点信息遇到临时调整时先核对官方通知再选择安全的替代路线'.repeat(5);
  const result = local({ article: { genre: 'spoken-script', domainInputs: { duration: '约2分钟' } }, round: { draft } });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /文字量估算/);
  assert.match(serialized, /每分钟220–280字/);
  assert.match(serialized, /试读并确认自然停顿/);
  assert.match(serialized, /不等同于实际朗读时长/);
  assert.match(serialized, /目标时长.*约2分钟/);
});

test('短视频初检只按显式分段时长求和并提示分轨缺项，不假定实拍时长', () => {
  const result = local({ article: { genre: 'short-video', domainInputs: { duration: '30秒', tracks: '口播、画面、字幕' } }, round: {
    taskType: 'video-script', draft: '[5秒] 口播：先看清站点。\n[10秒] 口播：再确认班次。画面：公交站牌。字幕：核对信息。'
  } });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /显式标注的分段时长合计15秒/);
  assert.match(serialized, /目标时长30秒/);
  assert.match(serialized, /不代表实拍或剪辑后的实际时长/);
  assert.match(serialized, /第1段未识别到用户要求的画面、字幕轨道/);
});

test('社媒轮播初检仅在能识别页码时核对页面数，不判定内容完整性', () => {
  const result = local({ article: { genre: 'social-post', domainInputs: { cardCount: '3页' } }, round: {
    taskType: 'social-carousel', draft: '第1页：问题\n第2页：做法'
  } });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /识别到2页/);
  assert.match(serialized, /目标为3页/);
  assert.match(serialized, /静态页码检查不代表内容完整或符合平台规则/);
});

test('多人播客初检提示缺少说话人标签但不推断嘉宾回答是否真实', () => {
  const result = local({ article: { genre: 'podcast', domainInputs: { format: '多人采访', speakers: '主持人、嘉宾' } }, round: {
    taskType: 'podcast-script', draft: '开场：欢迎收听。\n问题：你如何看待这个主题？'
  } });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /未发现明确的主持人\/嘉宾说话人标签/);
  assert.match(serialized, /人工确认发言归属/);
  assert.match(serialized, /不判断回答真实性/);
});

test('演讲本地初检估算文字时长并提示个人经历需本人确认', () => {
  const draft = '个人经历：我曾经服务过一万名学员。'.repeat(80);
  const result = local({ article: { genre: 'speech', domainInputs: { duration: '约5分钟', personalFacts: '演讲者经历待确认' } }, round: { taskType: 'speech-draft', draft } });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /文字量估算/);
  assert.match(serialized, /不等同于实际演讲时长/);
  assert.match(serialized, /个人经历或承诺，但稿件中未发现明显占位提示/);
});

test('UMD 浏览器与 CommonJS 一致，非法输入稳定且纯函数不联网', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-workbench-schema.js'), 'utf8'), context);
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-pack-schema.js'), 'utf8'), context);
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-pack-catalog.js'), 'utf8'), context);
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-workbench-prompts.js'), 'utf8'), context);
  for (const name of Object.keys(api)) {
    assert.equal(typeof context.WritingWorkbenchPrompts[name], 'function');
    assert.equal(JSON.stringify(context.WritingWorkbenchPrompts[name]()), JSON.stringify(api[name]()));
  }
  for (const input of [null, undefined, [], 'x', Symbol('非法')]) {
    assert.doesNotThrow(() => diagnose(input));
    assert.doesNotThrow(() => revise(input));
    assert.doesNotThrow(() => local(input));
    assert.doesNotThrow(() => derive(input));
  }
});

test('页面脚本 schema 早于 storage，prompts 早于 coordinator，移除 Node 专用脚本', () => {
  const html = readFileSync(require.resolve('../prototype/index.html'), 'utf8');
  assert.ok(html.indexOf('/prototype/writing-workbench-schema.js') >= 0);
  assert.ok(html.indexOf('/prototype/writing-workbench-schema.js') < html.indexOf('/prototype/storage.js'));
  const packSchema = html.indexOf('/prototype/writing-pack-schema.js');
  const packCatalog = html.indexOf('/prototype/writing-pack-catalog.js');
  const prompts = html.indexOf('/prototype/writing-workbench-prompts.js');
  assert.ok(packSchema >= 0 && packSchema < packCatalog && packCatalog < prompts,
    '包 schema 和 catalog 必须先于提示词模块加载');
  const coordinator = html.indexOf('/prototype/writing-workbench-coordinator.js');
  if (coordinator >= 0) assert.ok(prompts < coordinator);
  assert.doesNotMatch(html, /<script[^>]+src=["']\/prototype\/local-source-index\.js/);
});

test('满额强约束超限明确报错，精简反馈后完整保留更正和约束', () => {
  const fill = '长'.repeat(20000);
  const input = { article: { title: fill, goal: fill, audience: fill, platform: fill, constraints: fill,
    draft: fill, successCriteria: Array(20).fill(fill), preserveItems: Array(30).fill(fill) },
    round: { feedback: fill, userFeedback: fill, diagnosis: fill, revisionNote: fill,
      materials: Array.from({ length: 20 }, () => ({ id: fill, sourceArticleId: fill, purpose: 'both', excerpt: fill })) },
    styleProfile: { userCorrections: fill, traits: Array(20).fill(fill), sourceArticleIds: Array(20).fill(fill) },
    memories: Array(30).fill({ id: fill, preference: fill }),
    rounds: Array(100).fill({ diagnosis: fill, feedback: fill, userFeedback: fill }) };
  for (const build of [diagnose, revise]) {
    assert.throws(() => build(input), error => error instanceof RangeError && /8000.*精简/.test(error.message));
    const prompt = build({ ...input, round: { ...input.round, feedback: '长'.repeat(1000), userFeedback: '长'.repeat(1000) } });
    assert.ok(prompt.length <= 8000, prompt.length);
    assert.ok(prompt.includes(`关键约束：${'长'.repeat(500)}`));
    assert.ok(prompt.includes(`当前反馈：${'长'.repeat(1000)}`));
    assert.ok(prompt.includes(`当前用户反馈：${'长'.repeat(1000)}`));
    assert.ok(prompt.includes('用户风格更正（优先于样本）：' + '长'.repeat(2000)));
    assert.ok(prompt.includes('省略') || prompt.includes('未纳入'));
  }
});

test('两种指令保留轮次来源的标题、HTTP(S) URL 与状态局限，状态变化可见', () => {
  for (const build of [diagnose, revise]) {
    const input = { round: { sources: [{ title: '原始公告甲', url: 'https://example.org/original',
      excerpt: '销量100台', purpose: 'content', verificationStatus: 'user-confirmed' }] } };
    const confirmed = build(input);
    for (const value of ['原始公告甲', 'https://example.org/original', 'user-confirmed', '用户确认', '销量100台']) assert.ok(confirmed.includes(value), value);
    assert.match(confirmed, /不代表独立验证/);
    input.round.sources[0].verificationStatus = 'unverified';
    const unverified = build(input);
    assert.notEqual(confirmed, unverified);
    assert.match(unverified, /unverified.*未核验/);
    input.round.sources[0].verificationStatus = 'source-reviewed';
    assert.match(build(input), /source-reviewed.*来源已审阅/);
  }
});

test('两种提示词消费与材料卡片一致的来源位置、版本、摘录行、选用理由和失败状态', () => {
  for (const build of [diagnose, revise]) {
    const prompt = build({ round: { sources: [{
      id: 'local:guides/writing.md', title: '授权目录指南', excerpt: '只采用这段已展示摘录',
      sourceType: 'authorized-directory', origin: 'authorized-directory',
      sourceId: 'local:guides/writing.md', sourceLocator: 'guides/writing.md',
      sourceVersion: `sha256:${'b'.repeat(64)}`, excerptLocator: '第 24 行',
      selectionReason: '命中当前目标', verificationStatus: 'unverified',
      contentStatus: 'embedded', attachmentRequired: true
    }, {
      id: 'failed-file', title: '无法读取的资料', excerpt: '',
      sourceType: 'unread-file-reference', contentStatus: 'failed', contentError: '拒绝访问',
      attachmentRequired: true
    }, {
      id: 'style-only', title: '风格样本', excerpt: '不能变成事实的风格观点',
      purpose: 'style', contentStatus: 'embedded'
    }] } });

    for (const value of ['local:guides/writing.md', 'guides/writing.md', 'sha256:', '第 24 行',
      '命中当前目标', '只采用这段已展示摘录', '拒绝访问', '附件需另行提供']) assert.ok(prompt.includes(value), value);
    assert.doesNotMatch(prompt, /不能变成事实的风格观点/);
    assert.doesNotMatch(prompt, /[A-Za-z]:[\\/]|\\\\Users/);
  }
});

test('来源元数据预算截取使用前缀标签，不伪称语义摘要', () => {
  const prompt = diagnose({ sources: [{
    id: 'long-source', title: '长来源标题'.repeat(30), excerpt: '供测试选择的摘录', purpose: 'content',
    selectedForPrompt: true, contentStatus: 'embedded'
  }] });
  assert.match(prompt, /〔前缀节选；余下省略〕/);
  assert.doesNotMatch(prompt, /〔摘要，余下省略〕/);
});

test('风格来源与顶层来源保留可追溯元数据，原句隔离并拒绝非HTTP(S) URL', () => {
  for (const build of [diagnose, revise]) {
    const prompt = build({ round: { sources: [{ title: '风格样本甲', url: 'http://example.org/style',
      excerpt: '海王星居民只喝蓝色咖啡。', purpose: 'style', verificationStatus: 'user-confirmed' }] },
      sources: [{ title: '补充公告乙', url: 'https://example.org/extra', purpose: 'both', excerpt: '补充内容', verificationStatus: 'source-reviewed' },
        { title: '不安全地址', url: 'javascript:secretPayload()', purpose: 'style', excerpt: '不可泄漏的观点' }] });
    for (const value of ['风格样本甲', 'http://example.org/style', 'round-source-1', 'user-confirmed',
      '补充公告乙', 'https://example.org/extra', 'source-reviewed']) assert.ok(prompt.includes(value), value);
    assert.doesNotMatch(prompt, /海王星居民只喝蓝色咖啡|不可泄漏的观点|javascript:|secretPayload/);
    assert.match(prompt, /非HTTP\(S\).*省略/);
  }
});

test('来源元数据单独预算，极长标题和链接仍不挤掉状态、最新反馈及8000字约束', () => {
  for (const build of [diagnose, revise]) {
    const prompt = build({ article: { draft: '正文'.repeat(5000), constraints: '关键'.repeat(250),
      successCriteria: Array(20).fill('标准'.repeat(250)), preserveItems: Array(30).fill('保留'.repeat(250)) },
      round: { feedback: '反馈'.repeat(1000), userFeedback: '用户'.repeat(1000),
        sources: Array.from({ length: 20 }, (_, i) => ({ title: `公告${i}` + '长标题'.repeat(100),
          url: 'https://example.org/' + 'path'.repeat(500), excerpt: '依据'.repeat(600),
          purpose: i % 2 ? 'style' : 'content', verificationStatus: 'user-confirmed' })) } });
    assert.ok(prompt.length <= 8000, prompt.length);
    for (const text of ['https://example.org/', 'user-confirmed', '用户确认', '不代表独立验证', '公告0', '公告1', '公告2', '省略']) assert.ok(prompt.includes(text), text);
    assert.ok(prompt.includes('当前反馈：' + '反馈'.repeat(1000)));
    assert.ok(prompt.includes('当前用户反馈：' + '用户'.repeat(1000)));
    assert.ok(prompt.includes('关键约束：' + '关键'.repeat(250)));
    assert.doesNotMatch(prompt, /公告3/);
  }
});

test('不适用文体档案先隔离样本和更正，本轮风格材料仍可使用', () => {
  for (const build of [diagnose, revise]) {
    for (const [genre, profileGenre] of [['article', 'novel'], ['novel', 'article'], ['novel', 'novel']]) {
      const input = { article: { genre }, styleProfile: { scope: 'genre', genre: profileGenre,
        userCorrections: '跨文体更正不得出现', traits: ['跨文体偏好不得出现'], sourceArticleIds: ['foreign-style'],
        samples: [{ sourceArticleId: 'foreign-sample', excerpt: '长段样本！但是请勿借用。' }] } };
      const prompt = build(input);
      assert.doesNotMatch(prompt, /跨文体|foreign-style|foreign-sample|user-corrected/);
      assert.match(prompt, /temporary/);
      input.round = { materials: [material('style', '本次样本。短句。', 'current-style')] };
      const current = build(input);
      assert.match(current, /source-current-style/);
      assert.doesNotMatch(current, /跨文体|foreign-style|foreign-sample/);
    }
  }
});

test('完整保留用户更正尾部强约束，超出固定预算明确要求精简', () => {
  const corrections = '风格'.repeat(240) + '禁止删除结论';
  const input = { article: { draft: '正文'.repeat(4000), successCriteria: Array(20).fill('标准'.repeat(250)),
    preserveItems: Array(30).fill('保留'.repeat(250)) }, styleProfile: { userCorrections: corrections } };
  for (const build of [diagnose, revise]) {
    const prompt = build(input);
    assert.ok(prompt.includes(corrections));
    assert.ok(prompt.length <= 8000);
    const overloaded = { ...input, article: { ...input.article, constraints: '约束'.repeat(250) },
      styleProfile: { userCorrections: '更正'.repeat(1000) },
      round: { feedback: '反馈'.repeat(1000), userFeedback: '用户'.repeat(1000), sources: Array.from({ length: 3 }, () => ({
        title: '标题'.repeat(80), url: 'https://example.org/' + 'path'.repeat(100), purpose: 'content', excerpt: '证据'
      })) } };
    assert.throws(() => build(overloaded), error => error instanceof RangeError && /8000.*精简/.test(error.message));
  }
});

test('近似UUID材料使用S序号并在元数据中保留原ID，内容和元数据同一选集', () => {
  const ids = ['12345678-abcd-1234-abcd-000000000001', '12345678-abcd-1234-abcd-000000000002'];
  for (const build of [diagnose, revise]) {
    const prompt = build({ round: { materials: ids.map((id, i) => ({ id, title: `材料标题${i}`,
      sourceArticleId: `原文章${i}`, purpose: 'content', excerpt: `证据句${i}` })) } });
    ids.forEach((id, i) => {
      assert.ok(prompt.includes(id));
      assert.ok(prompt.includes(`原文章${i}`));
      assert.match(prompt, new RegExp(`内容来源\\[S${i + 1}\\]：证据句${i}`));
      assert.match(prompt, new RegExp(`来源\\[S${i + 1}\\]`));
    });
    const excluded = build({ round: { sources: [0, 1, 2].map(i => ({ purpose: 'style', title: `样本${i}`, excerpt: '隔离的样本观点。' }))
      .concat({ purpose: 'content', title: '第四条标题', excerpt: '第四条脱离元数据的内容' }) } });
    assert.doesNotMatch(excluded, /第四条标题|第四条脱离元数据的内容|隔离的样本观点/);
    assert.match(excluded, /选取3\/4/);
  }
});

test('只选择启用且适用的基础包条目，并把来源和跳过原因做成稳定快照', () => {
  const packs = [
    {
      id: 'pack-revision', name: '改稿专业包', layer: 'task', genre: 'article', taskType: 'revision', version: 2,
      enabled: true, applicability: { tasks: ['revision'], languages: ['zh'] },
      checks: [{ id: 'rule-revision', statement: '改稿规则哨兵', sourceIds: ['source-revision'] }],
      sources: [{ id: 'source-revision', title: '专业来源哨兵', url: 'https://example.test/revision', version: 'v2', license: 'MIT' }]
    },
    { id: 'pack-disabled', name: '停用包', layer: 'task', genre: 'article', version: 1, enabled: false,
      checks: [{ id: 'rule-disabled', statement: '停用规则哨兵' }] },
    { id: 'pack-diagnosis', name: '诊断包', layer: 'task', genre: 'article', taskType: 'diagnosis', version: 1, enabled: true,
      checks: [{ id: 'rule-diagnosis', statement: '诊断规则哨兵' }] },
    { id: 'pack-other-genre', name: '其他文体包', layer: 'genre', genre: 'novel', version: 1, enabled: true,
      checks: [{ id: 'rule-other', statement: '其他文体规则哨兵' }] }
  ];
  const selection = selectWritingPacks({
    workspace: schema.normalizeWritingWorkspace({ article: { id: 'article-1', genre: 'article' } }),
    packs, selectedIds: ['pack-revision', 'pack-disabled', 'pack-diagnosis', 'pack-other-genre', 'missing-pack'],
    taskType: 'revision'
  });
  assert.ok(selection.entries.some(entry => entry.id === 'rule-revision'));
  assert.ok(selection.sources.some(source => source.id === 'source-revision'));
  assert.ok(selection.skipped.some(item => item.id === 'pack-disabled' && item.reason === 'disabled'));
  assert.ok(selection.skipped.some(item => item.id === 'pack-diagnosis' && item.reason === 'task-mismatch'));
  assert.ok(selection.skipped.some(item => item.id === 'pack-other-genre' && item.reason === 'genre-mismatch'));
  assert.ok(selection.skipped.some(item => item.id === 'missing-pack' && item.reason === 'unknown'));
  assert.equal(selection.snapshot.packs[0].id, 'builtin-article');
  assert.equal(selection.snapshot.entries.some(entry => entry.id === 'rule-revision'), true);
});

test('选择软著内容包后，文章诊断和定向改写提示词都会带入对应规则与来源', () => {
  const packId = 'builtin-softcopyright-content';
  const base = {
    article: { id: 'softcopyright-article', genre: 'article', goal: '编写软件操作手册', packSelections: [packId] },
    round: { draft: '用户提供的手册草稿。', feedback: '补充每个功能的实际操作入口。' }
  };
  const diagnosis = diagnose(base);
  const revision = revise(base);
  for (const prompt of [diagnosis, revision]) {
    assert.match(prompt, /软著内容 专用提示词/);
    assert.match(prompt, /功能—证据—手册段落映射/);
    assert.match(prompt, /步骤写清入口、前置条件、用户动作和可见结果/);
    assert.match(prompt, /https:\/\/github\.com\/Rodert\/copyright-forge-skill/);
    assert.match(prompt, /《计算机软件著作权登记办法》/);
  }
  assert.match(diagnosis, /不直接改写成稿/);
  assert.match(revision, /定向改写提示词/);

  const withoutPack = diagnose({ article: { id: 'generic-article', genre: 'article' }, round: { draft: '普通文章' } });
  assert.doesNotMatch(withoutPack, /软著内容 专用提示词|功能—证据—手册段落映射/);
});

test('单项停用不进入快照，方法卡按任务适用范围筛选并冻结结构字段', () => {
  const pack = {
    id: 'method-scope-pack', name: '方法卡包', layer: 'core', version: 4,
    methods: [
      { id: 'revision-method', title: '改稿方法', guidance: '逐项比对', applicability: ['revision'],
        inputs: ['原稿', '反馈'], outputs: ['修改指令'], checks: ['位置可回指'], skippable: true,
        returnWhenMissing: ['缺原稿时退回'] },
      { id: 'diagnosis-method', title: '诊断方法', guidance: '发现问题', applicability: ['diagnosis'] }
    ],
    checks: [{ id: 'disabled-rule', statement: '不注入', enabled: false }]
  };
  const selection = selectWritingPacks({
    workspace: schema.normalizeWritingWorkspace({ article: { id: 'method-workspace', genre: 'article' } }),
    packs: [pack], selectedIds: [pack.id], taskType: 'revision'
  });
  const packageEntries = selection.entries.filter(entry => entry.packId === pack.id);
  assert.deepEqual(packageEntries.map(entry => entry.id), ['revision-method']);
  assert.deepEqual(packageEntries[0].inputs, ['原稿', '反馈']);
  assert.deepEqual(packageEntries[0].returnWhenMissing, ['缺原稿时退回']);
  assert.ok(selection.skipped.some(item => item.id === 'diagnosis-method' && item.reason === 'task-mismatch'));
  assert.ok(selection.skipped.some(item => item.id === 'disabled-rule' && item.reason === 'disabled'));
});

test('提示词只消费选中包和历史快照，保留普通文章基线与用户临时修正', () => {
  const customPack = {
    id: 'pack-current', name: '当前专业包', layer: 'task', genre: 'article', taskType: 'revision', version: 1,
    enabled: true, checks: [{ id: 'current-rule', statement: '当前包新规则哨兵', sourceIds: ['current-source'] }],
    sources: [{ id: 'current-source', title: '当前来源哨兵', url: 'https://example.test/current' }]
  };
  const oldPack = {
    id: 'pack-history', name: '历史专业包', layer: 'task', genre: 'article', taskType: 'revision', version: 1,
    enabled: true, checks: [{ id: 'old-rule', statement: '历史包旧规则哨兵', sourceIds: ['old-source'] }],
    sources: [{ id: 'old-source', title: '历史来源哨兵', url: 'https://example.test/old' }]
  };
  const selected = selectWritingPacks({
    workspace: schema.normalizeWritingWorkspace({ article: { id: 'article-1', genre: 'article' } }),
    packs: [oldPack], selectedIds: ['pack-history'], taskType: 'revision'
  });
  const prompt = revise({
    article: { id: 'article-1', genre: 'article', constraints: '用户当前约束哨兵' },
    round: { packSelections: ['pack-current'], packSnapshot: selected.snapshot, userFeedback: '临时修正哨兵' },
    writingPacks: [customPack], packSelections: ['pack-current'], packCorrections: '临时修正哨兵'
  });
  assert.match(prompt, /历史包旧规则哨兵/);
  assert.match(prompt, /历史来源哨兵/);
  assert.doesNotMatch(prompt, /当前包新规则哨兵|当前来源哨兵/);
  assert.match(prompt, /事实、数据和引用需核对来源/);
  assert.match(prompt, /用户当前约束哨兵/);
  assert.match(prompt, /临时修正哨兵/);
});

test('合并所有适用基础包提示词，不让内置提示词遮住核心包指令', () => {
  const prompt = revise({
    article: { id: 'article-prompt-composition', genre: 'article' },
    round: { draft: '当前稿件', diagnosis: '当前诊断', packSelections: ['core-prompt-pack'] },
    writingPacks: [{
      id: 'core-prompt-pack', name: '通用核心包', layer: 'core', version: 1,
      prompts: [{ id: 'core-prompt', taskType: 'article', content: '核心包提示词哨兵：保留证据边界。' }]
    }],
    writingPackSettings: []
  });

  assert.match(prompt, /交给外部 AI 的下一轮写作指令/);
  assert.match(prompt, /核心包提示词哨兵：保留证据边界/);
});

test('学术规划提示词区分研究证据、目标要求和风格，且只纳入当前章节材料', () => {
  const prompt = api.buildAcademicWritingPrompt({
    id: 'academic-workspace', genre: 'academic-paper',
    article: { id: 'academic-workspace', genre: 'academic-paper', title: '论文', goal: '研究问题',
      academicTarget: { paperType: 'dissertation', discipline: '教育学', researchType: 'observational',
        institution: '示例大学', requirements: [{ id: 'req-1', title: '学位要求', text: '结果章节报告研究对象', verificationStatus: 'user-confirmed' }] } },
    units: [{ id: 'chapter-1', type: 'chapter', title: '第一章', goal: '说明研究背景', completionCriteria: ['提出研究缺口'], order: 0 }],
    round: { id: 'academic-round', unitId: 'chapter-1', unitSnapshot: { id: 'chapter-1', type: 'chapter', title: '第一章', goal: '说明研究背景' },
      materials: [
        { id: 'evidence', title: '访谈摘录', purpose: 'content', excerpt: '三名参与者提到使用成本', unitIds: ['chapter-1'] },
        { id: 'other-chapter', title: '其他章节材料', purpose: 'content', excerpt: '章节隔离哨兵材料', unitIds: ['chapter-2'] },
        { id: 'requirement', title: '学院要求', purpose: 'requirement', excerpt: '提交时附研究伦理说明', unitIds: ['chapter-1'] },
        { id: 'style', title: '风格样本', purpose: 'style', excerpt: '风格原文观点隔离哨兵' }
      ] }
  }, 'academic-chapter-draft');

  assert.match(prompt, /academic-chapter-draft|章节起草/);
  assert.match(prompt, /示例大学/);
  assert.match(prompt, /三名参与者提到使用成本/);
  assert.match(prompt, /提交时附研究伦理说明/);
  assert.doesNotMatch(prompt, /章节隔离哨兵材料|风格原文观点隔离哨兵/);
  assert.match(prompt, /不得虚构|不补造/);
});

test('同一份风格摘录既在本轮材料又在工作区档案时只输出一次特征', () => {
  const styleMaterial = { id: 'style-sample', title: '风格样本', purpose: 'style', excerpt: '先交代观察范围，再区分事实和解释。' };
  const profile = derive([styleMaterial]);
  const prompt = api.buildAcademicWritingPrompt({
    id: 'academic-style-dedup', genre: 'academic-paper',
    article: { id: 'academic-style-dedup', genre: 'academic-paper', title: '论文', goal: '研究问题' },
    styleProfile: {
      id: 'style-profile', scope: 'genre', genre: 'academic-paper', source: 'sample',
      confidence: profile.confidence, traits: profile.traits, samples: profile.samples
    },
    round: { id: 'academic-style-round', materials: [styleMaterial] }
  }, 'academic-outline');

  assert.equal(prompt.split(profile.traits[0]).length - 1, 1);
});

test('提示词来源摘要包含来源元数据并明确未核验，轮次快照保留原字段', () => {
  const metadata = {
    provider: '来源发布方哨兵', accessedAt: '2026-10-20', license: '来源许可哨兵',
    applicability: '来源适用范围哨兵', limitations: '来源限制哨兵'
  };
  const round = schema.normalizeWritingRound({
    materials: [{ id: 'material-meta', title: '材料元数据', excerpt: '材料摘录', ...metadata }],
    sources: [{ id: 'source-meta', title: '来源元数据', excerpt: '来源摘录', ...metadata }]
  });
  const prompt = api.buildWritingDiagnosisPrompt({
    article: { id: 'metadata-article', genre: 'article', goal: '核对来源' }, round
  });
  for (const text of Object.values(metadata)) assert.ok(prompt.includes(text), text);
  assert.match(prompt, /未核验/);
  assert.equal(round.materials[0].provider, metadata.provider);
  assert.equal(round.sources[0].limitations, metadata.limitations);
});

test('超出材料上限时按任务关键词推荐并说明理由，未匹配材料不进入提示词', () => {
  const prompt = api.buildWritingRevisionPrompt({
    article: { id: 'material-rank', genre: 'article', goal: '核对预算依据' },
    round: { id: 'material-rank-round', materials: [
      { id: 'unrelated-a', title: '园艺随笔', purpose: 'content', excerpt: '栽培植物的日常观察。' },
      { id: 'budget-source', title: '预算基准', purpose: 'content', excerpt: '预算依据与金额边界。' },
      { id: 'unrelated-b', title: '旅行见闻', purpose: 'content', excerpt: '旅途风景记录。' },
      { id: 'style-source', title: '语气样本', purpose: 'style', excerpt: '句子短，先列数据再说结论。' }
    ] }
  });
  assert.match(prompt, /预算基准/);
  assert.match(prompt, /关键词建议/);
  assert.doesNotMatch(prompt, /园艺随笔|旅行见闻|语气样本/);
});
