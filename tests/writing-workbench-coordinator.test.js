const test = require('node:test');
const assert = require('node:assert/strict');
const { createWritingWorkbenchCoordinator } = require('../prototype/writing-workbench-coordinator.js');
const schema = require('../prototype/writing-workbench-schema.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function realStorageSetup(extra = {}) {
  const storage = require('../prototype/storage.js');
  const data = new Map();
  const memoryStorage = { getItem: name => data.get(name) ?? null, setItem: (name, value) => data.set(name, value) };
  let state = storage.createEmptyState();
  let beforeWrite;
  let afterWrite;
  let writes = 0;
  const save = next => { writes++; state = storage.saveState(memoryStorage, next); return state; };
  const dependencies = { getState: () => state, persistState(next) {
    const wait = beforeWrite?.();
    const write = () => { const result = save(next); const returned = afterWrite?.(); return returned ? returned.then(() => result) : result; };
    return wait ? wait.then(write) : write();
  }, ...extra };
  return { c: createWritingWorkbenchCoordinator(dependencies), dependencies, state: () => state,
    disk: () => JSON.parse(data.get(storage.STORAGE_KEY)), writes: () => writes,
    delay: hook => { beforeWrite = hook; }, delayReturn: hook => { afterWrite = hook; },
    importState: next => { state = storage.saveState(memoryStorage, next, { restoreWriting: true }); } };
}

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

test('选择资料保留手工内容和风格样本，合并来源共三条且重复选择不堆叠', async () => {
  const { c } = setup({ promptAgentCoordinator: { selectMaterials: async () => [
    { id: 'auto-1', title: '检索资料一', excerpt: '检索内容一' },
    { id: 'auto-2', title: '检索资料二', excerpt: '检索内容二' }
  ] } });
  const a = await c.createArticle({ materials: [
    { id: 'manual-content', title: '手工内容', purpose: 'content', excerpt: '保留的手工事实' },
    { id: 'manual-style', title: '手工样本', purpose: 'style', excerpt: '短句。再一段。' }
  ] });
  await c.selectMaterials(a.id);
  await c.selectMaterials(a.id);
  const round = c.getRounds(a.id)[0];
  assert.deepEqual(round.materials, a.rounds[0].materials);
  assert.equal(round.sources.length, 1);
  assert.match(round.prompt, /保留的手工事实/);
  assert.match(round.prompt, /手工样本/);
  assert.match(round.prompt, /检索资料一/);
  assert.doesNotMatch(round.prompt, /检索资料二/);
  assert.equal(c.getWorkspace(a.id).styleProfile.source, 'sample');
  const b = await c.createArticle({ materials: a.rounds[0].materials,
    sources: [{ title: '手工来源', excerpt: '用户指定来源', purpose: 'content' }] });
  await c.selectMaterials(b.id);
  assert.deepEqual(c.getRounds(b.id)[0].sources, b.rounds[0].sources);
});

test('改变目标和维度刷新已保存初检，显式初检替换模型结果，失败保留当前初检', async () => {
  let fail = false;
  const { c, state } = setup({ requestModel: async () => { if (fail) throw new Error('断网'); return '旧目标下的模型诊断'; } });
  const a = await c.createArticle({ goal: '旧目标', dimensions: ['语言表达'], draft: '非常重要。', saveEnabled: true });
  await c.updateArticle(a.id, { goal: '新目标', dimensions: ['事实依据'] });
  let round = c.getRounds(a.id)[0];
  assert.match(round.diagnosis, /事实依据/);
  assert.doesNotMatch(round.diagnosis, /语言表达/);
  assert.match(round.prompt, /新目标/);
  assert.deepEqual(state().writingArticles[0].rounds[0], round);
  await c.runModelDiagnosis(a.id);
  assert.equal(c.getRounds(a.id)[0].diagnosis, '旧目标下的模型诊断');
  const built = await c.diagnose(a.id);
  assert.match(built.diagnosis, /^本地规则初检/);
  assert.doesNotMatch(built.prompt, /旧目标下的模型诊断/);
  fail = true;
  const before = c.getWorkspace(a.id);
  await assert.rejects(c.runModelDiagnosis(a.id), { code: 'MODEL_FAILED', diagnosisCurrent: false });
  assert.deepEqual(c.getWorkspace(a.id), before);
  await c.updateArticle(a.id, { dimensions: ['语言表达'] });
  round = c.getRounds(a.id)[0];
  assert.match(round.diagnosis, /语言表达/);
  fail = false;
  await c.runModelDiagnosis(a.id);
  await c.updateArticle(a.id, { goal: '再次改目标', dimensions: ['逻辑结构'] });
  assert.match(c.getRounds(a.id)[0].diagnosis, /^本地规则初检[\s\S]*逻辑结构/);
  assert.doesNotMatch(c.getRounds(a.id)[0].prompt, /旧目标下的模型诊断/);
});

test('编辑自动记忆替代原候选，重启或删除后不从旧候选复活', async () => {
  const { c, state } = setup();
  const preference = { preference: '减少总结' };
  const a = await c.createArticle({ preferences: [preference], saveEnabled: true });
  const b = await c.createArticle({ preferences: [preference], saveEnabled: true });
  const original = c.getRelevantMemories('article')[0];
  await c.editMemory(original.id, { preference: '保留必要总结' });
  let result = await c.appendRound(a.id, {});
  assert.equal(result.notifications.length, 0);
  assert.deepEqual(c.getRelevantMemories('article').map(m => m.preference), ['保留必要总结']);
  const restarted = createWritingWorkbenchCoordinator({ getState: state, persistState: next => Object.assign(state(), next) });
  result = await restarted.appendRound(b.id, {});
  assert.equal(result.notifications.length, 0);
  assert.equal(state().writingMemories.length, 1);
  assert.equal(restarted.getRelevantMemories('article')[0].id, original.id);
  await restarted.deleteMemory(original.id);
  await restarted.refreshFromStorage();
  await restarted.appendRound(a.id, {});
  assert.equal(restarted.getRelevantMemories('article').length, 0);
});

test('updateArticle 风格更正超长抛错并保留会话原文，不写截断结果', async () => {
  const { c, state } = setup();
  const a = await c.createArticle({ draft: '正文', saveEnabled: true });
  const before = structuredClone(state().writingArticles[0]);
  const corrections = '更'.repeat(2100);
  await assert.rejects(c.updateArticle(a.id, { styleProfile: { userCorrections: corrections } }), RangeError);
  assert.equal(c.getWorkspace(a.id).styleProfile.userCorrections, corrections);
  assert.deepEqual(state().writingArticles[0], before);
  await c.correctStyleProfile(a.id, '保留长句');
  assert.match(c.getRounds(a.id)[0].prompt, /保留长句/);
});

test('删除开始即失效资料和模型结果，延迟真实保存完成后不会复活文章', async () => {
  const materials = deferred(), model = deferred(), entered = deferred(), release = deferred();
  const env = realStorageSetup({ requestModel: () => model.promise,
    promptAgentCoordinator: { selectMaterials: () => materials.promise } });
  const { c } = env;
  const a = await c.createArticle({ draft: '删除的正文', saveEnabled: true });
  const selection = c.selectMaterials(a.id).then(() => null, e => e);
  const diagnosis = c.runModelDiagnosis(a.id).then(() => null, e => e);
  env.delay(() => { entered.resolve(); return release.promise; });
  const deletion = c.deleteArticle(a.id, { confirmed: true });
  await entered.promise;
  materials.resolve([{ title: '迟到来源', excerpt: '迟到材料' }]);
  model.resolve('迟到诊断');
  await new Promise(resolve => setImmediate(resolve));
  release.resolve();
  await deletion;
  const errors = await Promise.all([selection, diagnosis]);
  await c.refreshFromStorage();
  assert.deepEqual(errors.map(e => e?.code), ['STALE_RESULT', 'STALE_RESULT']);
  assert.equal(env.disk().writingArticles.length, 0);
  assert.throws(() => c.openArticle(a.id), { code: 'ARTICLE_NOT_FOUND' });
});

test('删除失败恢复会话可重试，已排队旧保存失效且不重写真实磁盘', async () => {
  const entered = deferred(), release = deferred();
  const env = realStorageSetup();
  const { c } = env;
  const a = await c.createArticle({ draft: '原稿', saveEnabled: true });
  const before = env.writes();
  let first = true;
  env.delay(() => {
    if (!first) return;
    first = false; entered.resolve(); return release.promise;
  });
  const blocker = c.rememberPreference(a.id, { scope: 'general', preference: '保留事实' });
  await entered.promise;
  const queued = c.appendRound(a.id, { draft: '只保留会话的新稿' }).then(() => null, e => e);
  const deletion = c.deleteArticle(a.id, { confirmed: true }).then(() => null, e => e);
  env.delay(() => { throw new Error('删除失败'); });
  release.resolve();
  await blocker;
  assert.equal((await deletion)?.code, 'PERSIST_FAILED');
  assert.equal((await queued)?.code, 'STALE_RESULT');
  assert.equal(env.writes(), before + 1);
  assert.equal(env.disk().writingArticles[0].article.draft, '原稿');
  assert.equal(c.getWorkspace(a.id).article.draft, '只保留会话的新稿');
  env.delay(undefined);
  await c.build(a.id);
  assert.equal(env.disk().writingArticles[0].article.draft, '只保留会话的新稿');
  await c.deleteArticle(a.id, { confirmed: true });
  assert.equal(env.disk().writingArticles.length, 0);
});

test('导入刷新立即失效等待结果和排队保存，不覆盖真实导入稿', async () => {
  const entered = deferred(), release = deferred(), selected = deferred(), model = deferred();
  const env = realStorageSetup({ requestModel: () => model.promise,
    promptAgentCoordinator: { selectMaterials: () => selected.promise } });
  const { c } = env;
  const a = await c.createArticle({ draft: '旧稿', saveEnabled: true });
  const materialResult = c.selectMaterials(a.id).then(() => null, e => e);
  const modelResult = c.runModelDiagnosis(a.id).then(() => null, e => e);
  env.delayReturn(() => { entered.resolve(); return release.promise; });
  const blocker = c.rememberPreference(a.id, { preference: '保留证据' });
  await entered.promise;
  const queued = c.appendRound(a.id, { draft: '排队旧稿' }).then(() => null, e => e);
  const imported = structuredClone(env.state());
  imported.writingArticles[0].article.draft = '导入新稿';
  // 当前同步写入已发生，仅让回调延后返回；导入不能被队列里的旧快照覆盖。
  env.importState(imported);
  const refresh = c.refreshFromStorage();
  selected.resolve([{ title: '旧资料', excerpt: '失效内容' }]);
  model.resolve('失效模型结果');
  release.resolve();
  await blocker;
  await refresh;
  assert.equal((await queued)?.code, 'STALE_RESULT');
  assert.equal((await materialResult)?.code, 'STALE_RESULT');
  assert.equal((await modelResult)?.code, 'STALE_RESULT');
  assert.equal(env.disk().writingArticles[0].article.draft, '导入新稿');
  assert.equal(c.getWorkspace(a.id).article.draft, '导入新稿');
});

test('超长约束后模型入口拒绝发送和写入，异步返回也不能保存截断约束', async () => {
  const response = deferred();
  let calls = 0;
  const env = realStorageSetup({ requestModel: () => { calls++; return response.promise; } });
  const { c } = env;
  const a = await c.createArticle({ draft: '正文', saveEnabled: true });
  const pending = c.runModelDiagnosis(a.id);
  const constraints = '甲'.repeat(500) + '绝不披露姓名';
  const writes = env.writes();
  await assert.rejects(c.updateArticle(a.id, { constraints }), RangeError);
  response.resolve('旧输入的诊断');
  await assert.rejects(pending, error => error instanceof RangeError || error.code === 'STALE_RESULT');
  await assert.rejects(c.runModelDiagnosis(a.id), RangeError);
  assert.equal(calls, 1);
  assert.equal(env.writes(), writes);
  assert.equal(c.getWorkspace(a.id).article.constraints, constraints);
  assert.equal(env.disk().writingArticles[0].article.constraints, '');
});

test('失败原文不能被无关标题或部分风格补丁截断，显式精简后恢复', async () => {
  const env = realStorageSetup();
  const { c } = env;
  const a = await c.createArticle({ draft: '正文', saveEnabled: true });
  const constraints = '甲'.repeat(500) + '绝不披露姓名';
  await assert.rejects(c.updateArticle(a.id, { constraints }), RangeError);
  await assert.rejects(c.updateArticle(a.id, { title: '新标题', unknown: '丢弃' }), RangeError);
  assert.equal(c.getWorkspace(a.id).article.constraints, constraints);
  assert.equal(c.getWorkspace(a.id).article.title, '新标题');
  assert.equal('unknown' in c.getWorkspace(a.id).article, false);
  await c.updateArticle(a.id, { constraints: '不披露姓名' });
  const draft = '稿'.repeat(8001), feedback = '反馈'.repeat(1001), corrections = '正'.repeat(2001);
  await assert.rejects(c.appendRound(a.id, { draft, feedback, userCorrections: corrections }), RangeError);
  await assert.rejects(c.updateArticle(a.id, { title: '保留原文', styleProfile: { confidence: 'medium' } }), RangeError);
  let w = c.getWorkspace(a.id);
  assert.equal(w.article.draft, draft);
  assert.equal(w.rounds.at(-1).draft, draft);
  assert.equal(w.rounds.at(-1).feedback, feedback);
  assert.equal(w.styleProfile.userCorrections, corrections);
  assert.equal(env.disk().writingArticles[0].rounds.length, 1);
  await c.updateArticle(a.id, { draft: '精简稿', styleProfile: { userCorrections: '保留术语' } });
  w = c.getWorkspace(a.id);
  assert.equal(w.rounds.at(-2).feedback, feedback);
  assert.equal(w.article.draft, '精简稿');
  const saved = env.disk().writingArticles[0];
  assert.equal(saved.rounds.length, 2);
  assert.equal(saved.rounds.at(-1).parentRoundId, saved.rounds[0].id);
  assert.equal(saved.rounds.some(r => r.draft.includes('稿'.repeat(8000)) || r.feedback.includes('反馈'.repeat(1000))), false);
  assert.equal(saved.article.draft, '精简稿');
});

for (const scope of ['genre', 'general']) for (const action of ['edit', 'delete']) {
  test(`显式${scope}记忆${action}后旧候选重启不复活且不压制其他偏好`, async () => {
    const env = realStorageSetup();
    const { c } = env;
    const preference = { preference: '减少总结' };
    const a = await c.createArticle({ preferences: [preference], saveEnabled: true, draft: '保密正文' });
    const memory = await c.rememberPreference(a.id, { scope, preference: preference.preference });
    const b = await c.createArticle({ preferences: [preference], saveEnabled: true });
    if (action === 'edit') await c.editMemory(memory.id, { preference: '保留必要总结' });
    else assert.equal((await c.deleteMemory(memory.id)).deleted, true);
    const restarted = createWritingWorkbenchCoordinator(env.dependencies);
    const round = await restarted.appendRound(b.id, {});
    assert.equal(round.notifications.length, 0);
    assert.equal(restarted.getRelevantMemories('article').some(m => m.preference === '减少总结'), false);
    assert.equal(restarted.getRelevantMemories('novel').some(m => m.preference === '保留必要总结'), scope === 'general' && action === 'edit');
    assert.equal(JSON.stringify(env.disk().writingMemories).includes('保密正文'), false);
    await restarted.appendRound(a.id, { preferences: [{ preference: '多给实例' }] });
    const promoted = await restarted.appendRound(b.id, { preferences: [{ preference: '多给实例' }] });
    assert.equal(promoted.notifications.length, 1);
  });
}

test('单篇记忆的编辑删除不扩大为跨文章候选抑制', async () => {
  const env = realStorageSetup();
  const a = await env.c.createArticle({ preferences: [{ preference: '使用短段落' }], saveEnabled: true });
  const memory = await env.c.rememberPreference(a.id, { scope: 'article', preference: '使用短段落' });
  await env.c.editMemory(memory.id, { preference: '本篇使用长段落' });
  await env.c.deleteMemory(memory.id);
  const restarted = createWritingWorkbenchCoordinator(env.dependencies);
  const b = await restarted.createArticle({});
  const result = await restarted.appendRound(b.id, { preferences: [{ preference: '使用短段落' }] });
  assert.equal(result.notifications.length, 1);
  assert.equal(restarted.getRelevantMemories('article', b.id)[0].preference, '使用短段落');
});

for (const change of ['新轮', '更正']) {
  test(`旧轮资料等待期间${change}后只更新原轮，不覆盖最新风格`, async () => {
    const selected = deferred();
    const env = realStorageSetup({ promptAgentCoordinator: { selectMaterials: () => selected.promise } });
    const { c } = env;
    const a = await c.createArticle({ saveEnabled: true, materials: [{ id: 'old-style', purpose: 'style', excerpt: '旧。短。' }] });
    const pending = c.selectMaterials(a.id);
    if (change === '新轮') await c.appendRound(a.id, { materials: [{ id: 'new-style', purpose: 'style', excerpt: '新的样本使用明显更长的句子，保留完整解释和具体例子。' }] });
    else await c.correctStyleProfile(a.id, '用户后来的更正优先');
    const profile = c.getWorkspace(a.id).styleProfile;
    selected.resolve([{ id: 'late-style', title: '迟到风格', purpose: 'style', excerpt: '迟。到。' }]);
    const result = await pending;
    assert.equal(result.roundId, a.rounds[0].id);
    assert.equal(c.readRound(a.id, a.rounds[0].id).sources.length, 1);
    assert.deepEqual(c.getWorkspace(a.id).styleProfile, profile);
    assert.deepEqual(env.disk().writingArticles[0].styleProfile, profile);
    const next = await c.appendRound(a.id, {});
    assert.deepEqual(c.getWorkspace(a.id).styleProfile.traits, profile.traits);
    if (change === '更正') assert.match(next.round.prompt, /用户后来的更正优先/);
  });
}

test('旧轮模型等待期间更正风格后旧结果失效且不覆盖提示词', async () => {
  const model = deferred();
  const { c } = setup({ requestModel: () => model.promise });
  const a = await c.createArticle({ draft: '首稿' });
  const pending = c.runModelDiagnosis(a.id);
  await c.appendRound(a.id, { draft: '新稿' });
  await c.correctStyleProfile(a.id, '本次保持长句');
  const before = c.getWorkspace(a.id);
  model.resolve('更正前旧模型结果');
  await assert.rejects(pending, { code: 'STALE_RESULT' });
  assert.deepEqual(c.getWorkspace(a.id), before);
});
