const test = require('node:test');
const assert = require('node:assert/strict');
const { createWritingWorkbenchCoordinator } = require('../prototype/writing-workbench-coordinator.js');
const schema = require('../prototype/writing-workbench-schema.js');

function setup(extra = {}) {
  let state = { writingArticles: [], writingMemories: [], promptAgentTasks: [] };
  let fail = false;
  const coordinator = createWritingWorkbenchCoordinator({
    getState: () => state,
    persistState(next) {
      if (fail) throw new Error('磁盘已满');
      state = { ...structuredClone(next), writingArticles: next.writingArticles.map(schema.normalizeWritingWorkspace) };
      return structuredClone(state);
    }, ...extra
  });
  return { c: coordinator, state: () => state, fail: value => { fail = value; } };
}

test('新篇隔离、轮次关联、开关保存冻结、切篇不丢稿和显式删除', async () => {
  const { c, state } = setup();
  const a = await c.createArticle({ draft: '初稿' });
  const b = await c.createArticle({ draft: '另一篇' });
  assert.notEqual(a.id, b.id);
  assert.equal(state().writingArticles.length, 0);
  const r = await c.appendRound(a.id, { draft: '外部新稿', feedback: '加例子' });
  assert.equal(r.round.parentRoundId, a.rounds[0].id);
  assert.ok(r.round.diagnosis && r.round.prompt);
  await c.setSaveEnabled(a.id, true);
  await c.setSaveEnabled(a.id, false);
  const frozen = structuredClone(state().writingArticles[0]);
  await c.appendRound(a.id, { draft: '只在会话的新稿' });
  await c.rememberPreference(b.id, { preference: '保留术语', scope: 'general' });
  assert.deepEqual(state().writingArticles[0], frozen);
  assert.equal(c.openArticle(a.id).article.draft, '只在会话的新稿');
  await assert.rejects(c.deleteArticle(a.id), { code: 'CONFIRMATION_REQUIRED' });
  await c.deleteArticle(a.id, { confirmed: true });
  assert.equal(state().writingArticles.length, 0);
  assert.throws(() => c.openArticle(a.id), { code: 'ARTICLE_NOT_FOUND' });
});

test('保存失败可见且保留当前稿，删除失败也保留会话', async () => {
  const { c, fail } = setup();
  const a = await c.createArticle({ draft: '旧稿' });
  await c.setSaveEnabled(a.id, true);
  fail(true);
  await assert.rejects(c.appendRound(a.id, { draft: '不能丢的新稿' }), { code: 'PERSIST_FAILED' });
  assert.equal(c.getWorkspace(a.id).article.draft, '不能丢的新稿');
  await assert.rejects(c.deleteArticle(a.id, { confirmed: true }), { code: 'PERSIST_FAILED' });
  assert.equal(c.getRounds(a.id).length, 2);
});

test('记忆跨不同文章晋升、保存证据重启恢复和撤销不重建', async () => {
  const env = setup();
  const { c } = env;
  const preference = { preference: '减少空泛总结', example: '用实际结果收尾' };
  const a = await c.createArticle({ draft: '甲' });
  await c.setSaveEnabled(a.id, true);
  await c.appendRound(a.id, { preferences: [preference] });
  await c.appendRound(a.id, { preferences: [preference] });
  assert.equal(c.getRelevantMemories('article').length, 0);
  const restarted = createWritingWorkbenchCoordinator({ getState: env.state, persistState: next => Object.assign(env.state(), next) });
  const b = await restarted.createArticle({ draft: '乙' });
  await restarted.setSaveEnabled(b.id, true);
  const result = await restarted.appendRound(b.id, { preferences: [preference] });
  assert.equal(result.notifications.length, 1);
  const memory = restarted.getRelevantMemories('article')[0];
  assert.deepEqual(new Set(memory.evidenceArticleIds), new Set([a.id, b.id]));
  assert.equal(env.state().writingMemories.length, 1);
  await restarted.undoMemory(result.notifications[0].undoId);
  await restarted.appendRound(b.id, { preferences: [preference] });
  assert.equal(restarted.getRelevantMemories('article').length, 0);
});

test('未保存反馈不落盘、普通反馈不泛化、显式记忆立即保存并按范围选择', async () => {
  const { c, state } = setup();
  const a = await c.createArticle({ draft: '秘密正文' });
  const b = await c.createArticle({});
  await c.appendRound(a.id, { feedback: '这句有AI味', preferences: [{ preference: '少用套话' }] });
  assert.equal(state().writingMemories.length, 0);
  const promoted = await c.appendRound(b.id, { preferences: [{ preference: ' 少用套话。 ' }] });
  assert.equal(state().writingMemories.length, 1);
  assert.equal(promoted.notifications.length, 1);
  assert.equal(JSON.stringify(state()).includes('秘密正文'), false);
  assert.equal(JSON.stringify(state()).includes('这句有AI味'), false);
  await c.undoMemory(promoted.notifications[0].undoId);
  assert.equal(state().writingArticles.length, 0);
  assert.equal(state().writingMemories.length, 1);
  const general = await c.rememberPreference(a.id, { scope: 'general', preference: '保留事实' });
  const genre = await c.rememberPreference(a.id, { scope: 'genre', preference: '文章简洁' });
  await c.rememberPreference(a.id, { scope: 'article', preference: '本篇保留长句' });
  assert.equal(state().writingArticles.length, 0);
  assert.deepEqual(c.getRelevantMemories('novel', a.id).map(m => m.id), [general.id]);
  assert.equal(c.getRelevantMemories('article', b.id).some(m => m.scope === 'article'), false);
  await c.editMemory(genre.id, { preference: '文章详细' });
  await c.deleteMemory(genre.id);
  assert.equal(c.getRelevantMemories('novel')[0].preference, '保留事实');
});

test('类型确认、风格用途、更正优先、维度和本地资料复用', async () => {
  let task;
  const { c, state } = setup({ promptAgentCoordinator: { selectMaterials: async input => {
    task = input;
    return Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, title: `参考${i}`, excerpt: '资料句子。', location: '授权资料', purpose: 'content' }));
  } } });
  await assert.rejects(c.createArticle({ genre: 'novel' }), { code: 'GENRE_CONFIRMATION_REQUIRED' });
  const a = await c.createArticle({ genre: 'novel', confirmAsArticle: true, draft: '原文', goal: '解释', audience: '新人', platform: '博客', dimensions: ['语言表达'], materials: [{ purpose: 'content', excerpt: '不应作为风格。' }] });
  assert.equal(a.styleProfile.source, 'temporary');
  await c.correctStyleProfile(a.id, '保留长句');
  const result = await c.appendRound(a.id, { materials: [{ purpose: 'style', excerpt: '短句。另一句。' }] });
  assert.equal(c.getWorkspace(a.id).styleProfile.userCorrections, '保留长句');
  assert.match(result.round.prompt, /保留长句/);
  await c.selectMaterials(a.id);
  assert.equal(task.goal, '解释');
  assert.ok(JSON.stringify(task).includes('新人'));
  assert.ok(!JSON.stringify(task).includes('原文'));
  const round = c.getRounds(a.id).at(-1);
  assert.equal(round.materials.length + round.sources.length, 3);
  assert.match(round.prompt, /S3/);
  assert.equal(state().promptAgentTasks.length, 0);
  assert.equal(c.getWorkspace(a.id).article.draft, '原文');
});

test('模型只在按钮触发、异步绑定文章轮次、不代写、失败取消保留结果', async () => {
  let finish;
  const { c } = setup({ requestModel: () => new Promise(resolve => { finish = resolve; }) });
  const a = await c.createArticle({ draft: '原稿' });
  const old = c.getRounds(a.id)[0];
  const request = c.runModelDiagnosis(a.id);
  const b = await c.createArticle({ draft: '乙稿' });
  c.openArticle(b.id);
  await c.appendRound(a.id, { draft: '甲新稿' });
  finish('模型的诊断结果');
  await request;
  assert.equal(c.readRound(a.id, old.id).diagnosis, '模型的诊断结果');
  assert.equal(c.getWorkspace(a.id).article.draft, '甲新稿');
  assert.equal(c.getWorkspace(b.id).article.draft, '乙稿');
  const failed = setup({ requestModel: async () => { throw new Error('网络失败'); } });
  const f = await failed.c.createArticle({ draft: '保留' });
  const before = failed.c.getWorkspace(f.id);
  await assert.rejects(failed.c.runModelDiagnosis(f.id), { code: 'MODEL_FAILED' });
  assert.deepEqual(failed.c.getWorkspace(f.id), before);
  const controller = new AbortController();
  const pending = c.runModelDiagnosis(a.id, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'MODEL_CANCELLED' });
});

test('超长强约束错误可见且会话输入保留，不显示已生成', async () => {
  const { c } = setup();
  const a = await c.createArticle({ draft: '正文' });
  await assert.rejects(c.appendRound(a.id, { feedback: '甲'.repeat(2000), userFeedback: '乙'.repeat(2000), materials: Array.from({ length: 3 }, () => ({ title: '丙'.repeat(160), purpose: 'both', excerpt: '句。' })), userCorrections: '丁'.repeat(2001) }), RangeError);
  const round = c.getRounds(a.id).at(-1);
  assert.equal(round.userFeedback.length, 2000);
  assert.equal(round.prompt, '');
});


test('真实 storage.saveState 返回冻结快照也不能覆盖最新会话稿', async () => {
  const storage = require('../prototype/storage.js');
  const data = new Map();
  const memoryStorage = { getItem: name => data.get(name) ?? null, setItem: (name, value) => data.set(name, value) };
  let state = storage.createEmptyState();
  const c = createWritingWorkbenchCoordinator({ getState: () => state, persistState: next => {
    state = storage.saveState(memoryStorage, next);
    return state;
  } });
  const a = await c.createArticle({ draft: '已保存初稿' });
  await c.setSaveEnabled(a.id, true);
  await c.setSaveEnabled(a.id, false);
  await c.appendRound(a.id, { draft: '关闭保存后的最新稿', preferences: [{ preference: '结尾给例子', example: '列出效果' }] });
  const b = await c.createArticle({ draft: '另一篇' });
  await c.appendRound(b.id, { preferences: [{ preference: '结尾给例子' }] });
  assert.equal(state.writingMemories.length, 1);
  assert.equal(state.writingArticles[0].article.draft, '已保存初稿');
  assert.equal(c.openArticle(a.id).article.draft, '关闭保存后的最新稿');
  assert.equal(c.getRounds(a.id).length, 2);
  const raw = JSON.parse(data.get(storage.STORAGE_KEY));
  assert.equal(raw.writingArticles[0].rounds.length, 1);
  assert.equal(raw.writingMemories[0].example, '列出效果');
  assert.equal(JSON.stringify(raw).includes('关闭保存后的最新稿'), false);
  await c.setSaveEnabled(a.id, true);
  assert.equal(state.writingArticles[0].article.draft, '关闭保存后的最新稿');
  assert.equal(state.writingArticles[0].rounds[1].preferences[0].preference, '结尾给例子');
});


test('关闭保存与更新正文同一次调用，磁盘必须冻结到旧稿', async () => {
  const { c, state } = setup();
  const a = await c.createArticle({ draft: '原快照', saveEnabled: true });
  await c.updateArticle(a.id, { draft: '仅会话', saveEnabled: false });
  assert.equal(state().writingArticles[0].article.draft, '原快照');
  assert.equal(c.openArticle(a.id).article.draft, '仅会话');
});

test('保存开关非法值和不适用风格先校验，不改会话', async () => {
  const { c } = setup();
  const a = await c.createArticle({ draft: '原稿' });
  await assert.rejects(c.updateArticle(a.id, { title: '不应改变', saveEnabled: 'false' }), { code: 'INVALID_INPUT' });
  assert.equal(c.getWorkspace(a.id).article.title, '');
  await assert.rejects(c.appendRound(a.id, { styleProfile: { scope: 'genre', genre: 'novel' } }), { code: 'STYLE_SCOPE_INVALID' });
  assert.equal(c.getRounds(a.id).length, 1);
});

test('自动记忆保存失败后可重试，证据仍保留在会话', async () => {
  const { c, state, fail } = setup();
  const a = await c.createArticle({ preferences: [{ preference: '少用长句' }] });
  const b = await c.createArticle({});
  fail(true);
  await assert.rejects(c.appendRound(b.id, { preferences: [{ preference: '少用长句' }] }), { code: 'PERSIST_FAILED' });
  assert.equal(c.getRounds(b.id).at(-1).preferences[0].preference, '少用长句');
  fail(false);
  await c.appendRound(a.id, {});
  assert.equal(state().writingMemories.length, 1);
});

test('普通反馈不变成候选，未保存单篇证据重启丢弃', async () => {
  const { c, state } = setup();
  await c.createArticle({ feedback: '这句有AI味' });
  await c.createArticle({ feedback: '这句有AI味' });
  assert.equal(state().writingMemories.length, 0);
  await c.createArticle({ preferences: [{ preference: '使用短段落' }] });
  const restarted = createWritingWorkbenchCoordinator({ getState: state, persistState: next => Object.assign(state(), next) });
  await restarted.createArticle({ preferences: [{ preference: '使用短段落' }] });
  assert.equal(state().writingMemories.length, 0);
});

test('导入后显式刷新和迟到模型结果不会复活旧会话', async () => {
  let finish;
  const { c, state } = setup({ requestModel: () => new Promise(resolve => { finish = resolve; }) });
  const a = await c.createArticle({ draft: '原稿', saveEnabled: true });
  const request = c.runModelDiagnosis(a.id);
  state().writingArticles[0].article.draft = '导入稿';
  await c.refreshFromStorage();
  assert.equal(c.openArticle(a.id).article.draft, '导入稿');
  finish('迟到诊断');
  await assert.rejects(request, { code: 'STALE_RESULT' });
  assert.equal(c.getRounds(a.id)[0].diagnosis.includes('迟到诊断'), false);
});

test('规范化允许范围内的强约束总预算溢出也保留完整输入', async () => {
  const { c } = setup();
  const a = await c.createArticle({ constraints: '约束'.repeat(250), draft: '正文' });
  await assert.rejects(c.appendRound(a.id, { feedback: '反馈'.repeat(1000), userFeedback: '用户'.repeat(1000),
    userCorrections: '更正'.repeat(1000), sources: Array.from({ length: 3 }, () => ({
      title: '标题'.repeat(80), url: 'https://example.org/' + 'path'.repeat(100), purpose: 'content', excerpt: '证据'
    })) }), error => error instanceof RangeError && /8000/.test(error.message));
  const w = c.getWorkspace(a.id);
  assert.equal(w.styleProfile.userCorrections, '更正'.repeat(1000));
  assert.equal(w.rounds.at(-1).feedback, '反馈'.repeat(1000));
  assert.equal(w.rounds.at(-1).prompt, '');
});

test('UMD 浏览器导出可离线创建文章，读取副本不会污染会话', async () => {
  const { readFileSync } = require('node:fs');
  const vm = require('node:vm');
  const context = vm.createContext({ console });
  for (const file of ['schema', 'prompts', 'coordinator']) {
    vm.runInContext(readFileSync(require.resolve(`../prototype/writing-workbench-${file}.js`), 'utf8'), context);
  }
  const c = context.WritingWorkbenchCoordinator.createWritingWorkbenchCoordinator();
  const a = await c.createArticle({ draft: '离线稿' });
  a.article.draft = '污染';
  assert.equal(c.getWorkspace(a.id).article.draft, '离线稿');
  assert.ok((await c.build(a.id)).prompt.length <= 8000);
  await assert.rejects(c.runModelDiagnosis(a.id), { code: 'MODEL_UNAVAILABLE' });
});
