const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const api = require('../prototype/writing-workbench-prompts.js');
const { buildWritingDiagnosisPrompt: diagnose, buildWritingRevisionPrompt: revise,
  deriveWritingStyleProfile: derive, buildLocalWritingDiagnosis: local } = api;
const material = (purpose, excerpt, id = purpose) => ({ id, sourceArticleId: `source-${id}`, purpose, excerpt });

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
    assert.match(prompt, /摘要/);
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

test('UMD 浏览器与 CommonJS 一致，非法输入稳定且纯函数不联网', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-workbench-schema.js'), 'utf8'), context);
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
  assert.ok(html.indexOf('/prototype/writing-workbench-prompts.js') > html.indexOf('/prototype/writing-workbench-schema.js'));
  const coordinator = html.indexOf('/prototype/writing-workbench-coordinator.js');
  if (coordinator >= 0) assert.ok(html.indexOf('/prototype/writing-workbench-prompts.js') < coordinator);
  assert.doesNotMatch(html, /<script[^>]+src=["']\/prototype\/local-source-index\.js/);
});

test('所有白名单字段同时满额时仍不超过8000，纠正、反馈和约束完整保留', () => {
  const fill = '长'.repeat(20000);
  const input = { article: { title: fill, goal: fill, audience: fill, platform: fill, constraints: fill,
    draft: fill, successCriteria: Array(20).fill(fill), preserveItems: Array(30).fill(fill) },
    round: { feedback: fill, userFeedback: fill, diagnosis: fill, revisionNote: fill,
      materials: Array.from({ length: 20 }, () => ({ id: fill, sourceArticleId: fill, purpose: 'both', excerpt: fill })) },
    styleProfile: { userCorrections: fill, traits: Array(20).fill(fill), sourceArticleIds: Array(20).fill(fill) },
    memories: Array(30).fill({ id: fill, preference: fill }),
    rounds: Array(100).fill({ diagnosis: fill, feedback: fill, userFeedback: fill }) };
  for (const build of [diagnose, revise]) {
    const prompt = build(input);
    assert.ok(prompt.length <= 8000, prompt.length);
    assert.ok(prompt.includes(`关键约束：${'长'.repeat(500)}`));
    assert.ok(prompt.includes(`当前反馈：${'长'.repeat(2000)}`));
    assert.ok(prompt.includes(`当前用户反馈：${'长'.repeat(2000)}`));
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
