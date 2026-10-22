const test = require('node:test');
const assert = require('node:assert/strict');
const { createWritingWorkbenchCoordinator } = require('../prototype/writing-workbench-coordinator.js');
const schema = require('../prototype/writing-workbench-schema.js');

test('协调器按项目和配置命名空间筛选记忆，未知文体只读通用', async () => {
  const { readFileSync } = require('node:fs');
  const vm = require('node:vm');
  let namespace = 'article';
  const context = vm.createContext({ WritingWorkbenchPrompts: require('../prototype/writing-workbench-prompts.js'),
    WritingWorkbenchSchema: { ...schema, getWritingGenreConfig: genre => genre === 'article' ? { memoryNamespace: namespace } : null } });
  vm.runInContext(readFileSync(require.resolve('../prototype/writing-workbench-coordinator.js'), 'utf8'), context);
  const c = context.WritingWorkbenchCoordinator.createWritingWorkbenchCoordinator({ getState: () => ({ writingMemories: [
    { id: 'general', scope: 'general', preference: '通用偏好' },
    { id: 'genre', scope: 'genre', genre: 'article', preference: '普通文章偏好' },
    { id: 'project', scope: 'project', projectId: 'a', preference: '当前项目偏好' },
    { id: 'other-project', scope: 'project', projectId: 'b', preference: '其他项目偏好' },
    { id: 'own', scope: 'article', articleId: 'a', preference: '单篇偏好' },
    { id: 'other', scope: 'article', articleId: 'b', preference: '其他篇偏好' }
  ] }) });
  const ids = genre => Array.from(c.getRelevantMemories(genre, 'a'), m => m.id);
  assert.deepEqual(ids('article'), ['own', 'project', 'genre']);
  namespace = '不匹配现有记忆';
  assert.deepEqual(ids('article'), ['own', 'project', 'general'], '更改配置必须改变文体偏好筛选');
  for (const genre of ['novel', '', null, '__proto__']) assert.deepEqual(ids(genre), ['general']);
});

test('长篇项目显式关联资料、保存变更影响并将当前资料冻结到提示词版本', async () => {
  const { c, state } = realStorageSetup();
  const article = await c.createArticle({ genre: 'fiction', title: '雾城', draft: '主人公进入旧车站。', saveEnabled: true });
  const unit = await c.addUnit(article.id, { type: 'chapter', title: '第一章', goal: '介绍车站', summary: '主角抵达',
    viewpoint: '主角视角', storyTime: '午夜', location: '旧车站', purpose: '解释规则', characterIds: ['hero'] });
  const fact = await c.saveLongformItem(article.id, 'canon', '', {
    category: 'rule', name: '旧车站规则', text: '午夜后不能使用钟表', status: 'confirmed', unitIds: [unit.id]
  });
  const first = await c.build(article.id, { unitId: unit.id, taskType: 'longform-chapter-draft' });
  const firstRound = c.readRound(article.id, first.roundId);
  assert.match(first.prompt, /旧车站规则/);
  assert.match(first.prompt, /本轮从已登记资料中选入/);
  assert.match(first.prompt, /主角视角/);
  assert.match(first.prompt, /故事内时间：午夜/);
  assert.match(first.prompt, /场景目的\/冲突：解释规则/);
  assert.equal(firstRound.promptVersions.at(-1).longformSnapshot.canon[0].text, '午夜后不能使用钟表');

  await c.saveLongformItem(article.id, 'canon', fact.id, {
    text: '午夜后不能使用钟表，违反者会迷路', changeReason: '明确规则后果'
  });
  const workspace = c.getWorkspace(article.id);
  assert.equal(workspace.longform.changes.length, 1);
  assert.equal(workspace.longform.changes[0].impacts[0].id, unit.id);
  await c.reviewLongformImpact(article.id, workspace.longform.changes[0].id, unit.id, 'reviewed', '已检查章节计划');
  assert.equal(c.getWorkspace(article.id).longform.changes[0].impacts[0].reason, '已检查章节计划');
  const second = await c.build(article.id, { unitId: unit.id, taskType: 'longform-continuity' });
  assert.match(second.prompt, /违反者会迷路/);
  assert.equal(c.readRound(article.id, second.roundId).promptVersions.at(-1).longformSnapshot.canon[0].text,
    '午夜后不能使用钟表，违反者会迷路');
  assert.equal(state().writingArticles.find(item => item.id === article.id).longform.mode, 'fiction');
});

test('视听领域任务在生成提示词时写入本地静态初检和口播时长估算', async () => {
  const { c } = realStorageSetup();
  const article = await c.createArticle({
    genre: 'spoken-script',
    title: '口播静态初检',
    domainInputs: { duration: '约2分钟' },
    draft: '这是一段用于验证口播静态检查的合成稿件。'
  });

  const result = await c.build(article.id, { taskType: 'spoken-draft' });
  assert.match(result.diagnosis, /文字量估算/);
  assert.match(result.diagnosis, /约2分钟/);
  assert.match(c.getWorkspace(article.id).rounds.at(-1).diagnosis, /试读/);
});

test('长篇当前轮冻结明确关联的前后摘要与未解决问题，设定变更影响可按类型逐项确认或驳回', async () => {
  const { c } = realStorageSetup();
  const story = await c.createArticle({ genre: 'fiction', title: '多章故事', saveEnabled: true });
  const previous = await c.addUnit(story.id, { title: '前章', summary: '前章旧摘要' });
  const current = await c.addUnit(story.id, { title: '当前章', priorUnitIds: [previous.id],
    canonIds: ['fact-shared'], summary: '当前章摘要' });
  const next = await c.addUnit(story.id, { title: '后章', summary: '后章摘要', canonIds: ['fact-shared'] });
  await c.updateUnit(story.id, previous.id, { nextUnitIds: [current.id] });
  await c.updateUnit(story.id, current.id, { nextUnitIds: [next.id] });
  await c.updateUnit(story.id, next.id, { priorUnitIds: [current.id] });
  await c.addUnit(story.id, { title: '无关章', summary: '不应进入提示词' });
  const fact = await c.saveLongformItem(story.id, 'canon', '', {
    id: 'fact-shared', name: '共用设定', text: '旧事实', unitIds: [current.id, next.id]
  });
  const openIssue = await c.addIssue(story.id, { unitId: next.id, excerpt: '摘录', observation: '后章待解决问题' });
  const first = await c.build(story.id, { unitId: current.id, taskType: 'longform-chapter-draft' });
  const oldRound = c.readRound(story.id, first.roundId);
  assert.match(first.prompt, /前章旧摘要/);
  assert.match(first.prompt, /后章摘要/);
  assert.match(first.prompt, /后章待解决问题/);
  assert.doesNotMatch(first.prompt, /不应进入提示词/);

  const materialRound = await c.appendRound(story.id, { unitId: next.id, materials: [
    { id: 'material-shared', title: '关联材料', excerpt: '关联材料内容', sourceLocator: 'interview.md#p3',
      verificationStatus: 'unverified', unitIds: [next.id] }
  ] });
  const continuityPrompt = await c.build(story.id, { unitId: current.id, taskType: 'longform-continuity' });
  assert.match(continuityPrompt.prompt, /关联材料内容/);
  assert.match(continuityPrompt.prompt, /关联材料（用途 content；状态 unverified；位置 interview\.md#p3/);
  assert.doesNotMatch(continuityPrompt.prompt, /不应进入提示词/);
  const affectedMaterial = materialRound.round.materials[0];
  const issue = await c.addIssue(story.id, { roundId: materialRound.round.id, unitId: next.id,
    excerpt: '另一个摘录', observation: '另一待解决问题' });
  const foreshadowing = await c.saveLongformItem(story.id, 'foreshadowing', '', {
    planted: '已登记伏笔', canonIds: [fact.id], unitIds: [next.id]
  });
  await c.saveLongformItem(story.id, 'canon', fact.id, { text: '新事实' });
  const change = c.getWorkspace(story.id).longform.changes.at(-1);
  for (const [type, id] of [['unit', next.id], ['material', affectedMaterial.id], ['issue', issue.id], ['foreshadowing', foreshadowing.id]]) {
    assert.ok(change.impacts.some(item => item.type === type && item.id === id), `${type}:${id}`);
  }
  const unitImpact = change.impacts.find(item => item.type === 'unit' && item.id === next.id);
  const issueImpact = change.impacts.find(item => item.type === 'issue' && item.id === issue.id);
  await c.reviewLongformImpact(story.id, change.id, { type: 'unit', id: unitImpact.id }, 'reviewed', '已检查后章');
  await c.reviewLongformImpact(story.id, change.id, { type: 'issue', id: issueImpact.id }, 'deferred', '暂不处理');
  const foreshadowImpact = change.impacts.find(item => item.type === 'foreshadowing');
  await c.reviewLongformImpact(story.id, change.id, { type: 'foreshadowing', id: foreshadowImpact.id }, 'no-change', '确认不受影响');
  const reviewed = c.getWorkspace(story.id).longform.changes.at(-1).impacts;
  assert.equal(reviewed.find(item => item.type === 'unit' && item.id === next.id).status, 'reviewed');
  assert.equal(reviewed.find(item => item.type === 'issue' && item.id === issue.id).status, 'deferred');
  assert.equal(reviewed.find(item => item.type === 'foreshadowing').status, 'no-change');
  assert.equal(c.readRound(story.id, oldRound.id).longformSnapshot.canon[0].text, '旧事实');
});

test('写作搜索预览零调用，批准真实 bridge 后只发固定方法和独立关键词', async () => {
  const calls = [];
  const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator({
    searchWeb: async (query, options) => {
      calls.push({ query, maximum: options.maxResults });
      return { results: [{ title: '公开方法', url: `https://example.test/${calls.length}`, summary: '可供评估的公开摘要', applicability: '普通文章', limitations: '需核对原文' }] };
    }
  });
  const { c, state } = setup({ promptAgentCoordinator: agent });
  const a = await c.createArticle({ draft: '正文隐私哨兵', goal: '目标隐私哨兵', constraints: '必须保留用户要求',
    materials: [{ title: '用户样本', excerpt: '这是风格样本。', purpose: 'style' }] });
  await c.appendRound(a.id, { draft: '正文隐私哨兵', feedback: '反馈隐私哨兵',
    materials: [{ title: '用户样本', excerpt: '这是风格样本。', purpose: 'style' }] });
  const preview = c.previewResearch(a.id, { keywords: '产品说明', draft: '偷带正文', directory: 'C:/私有目录' });
  assert.equal(preview.status, 'awaiting-confirmation');
  assert.equal(calls.length, 0);
  assert.equal(preview.queries.length, 3);
  assert.deepEqual(preview.budget, { maxQueries: 3, maxSources: 5 });
  assert.ok(preview.queries.some(q => q.includes('site:github.com')));
  assert.doesNotMatch(JSON.stringify(preview), /隐私哨兵|偷带正文|私有目录/);
  await assert.rejects(c.approveResearch(a.id), /确认/);
  assert.equal(calls.length, 0);
  const result = await c.approveResearch(a.id, { confirmed: true });
  assert.equal(result.status, 'complete');
  assert.deepEqual(calls.map(c => c.query), preview.queries);
  assert.ok(calls.every(c => c.maximum <= 5));
  const round = c.getRounds(a.id).at(-1);
  assert.equal(round.materials[0].title, '用户样本');
  assert.equal(round.materials.length + round.sources.length, 3);
  assert.match(round.prompt, /必须保留用户要求/);
  assert.match(round.prompt, /未核验|未验证/);
  assert.match(round.prompt, /普通文章|适用/);
  assert.match(round.prompt, /需核对原文|局限/);
  assert.equal(state().writingMemories.length, 0);
  assert.equal(state().promptAgentTasks.length, 0);
});

test('搜索拒绝按篇，保存开启跨刷新保留、暂停历史冻结，新篇可搜索', async () => {
  let searches = 0;
  const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator({ searchWeb: async () => { searches++; return []; } });
  const env = realStorageSetup({ promptAgentCoordinator: agent });
  const { c } = env;
  const a = await c.createArticle({ draft: '保存正文', saveEnabled: true });
  c.previewResearch(a.id);
  await c.rejectResearch(a.id);
  assert.equal(c.getResearchState(a.id).status, 'rejected');
  await c.refreshFromStorage();
  assert.equal(c.getResearchState(a.id).status, 'rejected');
  assert.throws(() => c.previewResearch(a.id), /拒绝/);
  const b = await c.createArticle({ draft: '新篇', saveEnabled: true });
  await c.setSaveEnabled(b.id, false);
  const frozen = structuredClone(env.state().writingArticles.find(w => w.id === b.id));
  c.previewResearch(b.id);
  await c.rejectResearch(b.id);
  assert.deepEqual(env.state().writingArticles.find(w => w.id === b.id), frozen);
  await c.refreshFromStorage();
  assert.equal(c.getResearchState(b.id).status, 'idle');
  assert.equal(c.previewResearch(b.id).status, 'awaiting-confirmation');
  assert.equal(searches, 0);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

for (const invalidation of ['append', 'refresh', 'merge', 'delete', 'cancel']) {
  test(`忽略 signal 的真实搜索适配器在 ${invalidation} 后不续查询、不复活迟到结果`, async () => {
    const pending = deferred();
    const started = deferred();
    let calls = 0;
    const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator({
      searchWeb: async () => { calls++; started.resolve(); return pending.promise; }
    });
    const { c, state } = setup({ promptAgentCoordinator: agent });
    const a = await c.createArticle({ draft: '甲', saveEnabled: true });
    const b = await c.createArticle({ draft: '乙', saveEnabled: true });
    c.previewResearch(a.id);
    const running = c.approveResearch(a.id, { confirmed: true });
    await started.promise;
    if (invalidation === 'append') await c.appendRound(a.id, { draft: '新轮' });
    if (invalidation === 'refresh') await c.refreshFromStorage();
    if (invalidation === 'merge') await c.refreshFromStorage({ preserveSessions: true });
    if (invalidation === 'delete') await c.deleteArticle(a.id, { confirmed: true });
    if (invalidation === 'cancel') c.cancelResearch(a.id);
    pending.resolve({ results: [{ title: '迟到资料', url: 'https://example.test/late', summary: '绝不能复活' }] });
    const result = await running;
    assert.equal(result.status, 'cancelled');
    assert.equal(calls, 1);
    assert.equal(c.getRounds(b.id).at(-1).sources.length, 0);
    assert.doesNotMatch(JSON.stringify(state()), /迟到资料|绝不能复活/);
    if (invalidation !== 'delete') assert.doesNotMatch(JSON.stringify(c.getWorkspace(a.id)), /迟到资料|绝不能复活/);
  });
}

test('搜索关键词超长或含路径时拒绝而非静默截断，正文反馈绝不用于默认查询', async () => {
  const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator();
  const { c } = setup({ promptAgentCoordinator: agent });
  const a = await c.createArticle({ draft: '正文哨兵', goal: '目标哨兵', audience: '读者哨兵' });
  for (const keywords of ['字'.repeat(41), 'C:/私有目录', 'https://private.test', '甲\n乙', 'user@example.test']) {
    assert.throws(() => c.previewResearch(a.id, { keywords }), /关键词/);
  }
  const preview = c.previewResearch(a.id);
  assert.doesNotMatch(JSON.stringify(preview), /哨兵/);
});

test('本地自动来源占满三份时公开摘要至少纳入一份，手工材料与style/both来源保留', async () => {
  const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator({
    searchWeb: async () => [{ title: '公开新摘要', url: 'https://public.test/guide', summary: '公开案例的可评估内容', applicability: '普通文章', limitations: '尚待验证' }]
  });
  agent.selectMaterials = async () => Array.from({ length: 3 }, (_, i) => ({ id: `auto-${i}`, title: `自动资料${i}`, location: `https://local.test/${i}`, excerpt: `本地内容${i}` }));
  const { c } = setup({ promptAgentCoordinator: agent });
  const a = await c.createArticle({ draft: '初稿' });
  await c.selectMaterials(a.id);
  assert.equal(c.getRounds(a.id)[0].sources.length, 3);
  c.previewResearch(a.id);
  const result = await c.approveResearch(a.id, { confirmed: true });
  assert.equal(result.sources.length, 3);
  assert.ok(result.sources.some(s => s.url === 'https://public.test/guide'));
  assert.match(c.getRounds(a.id)[0].prompt, /公开新摘要/);
  const b = await c.createArticle({ draft: '初稿', materials: [{ title: '手工', purpose: 'content', excerpt: '必须保留手工' }], sources: [
    { title: '风格', purpose: 'style', excerpt: '必须保留风格' }, { title: '两用', purpose: 'both', excerpt: '必须保留两用' }
  ] });
  const before = c.getRounds(b.id)[0];
  c.previewResearch(b.id);
  const blocked = await c.approveResearch(b.id, { confirmed: true });
  const after = c.getRounds(b.id)[0];
  assert.deepEqual(after.materials, before.materials);
  assert.deepEqual(after.sources, before.sources);
  assert.equal(blocked.includedSources, 0);
  assert.match(c.getResearchState(b.id).contextNote, /未纳入.*提示词/);
});

test('真实storage搜索写失败只尝试一次，结果和来源可读取且磁盘保持旧快照', async () => {
  let writes = 0;
  let failing = false;
  const values = new Map();
  const storage = require('../prototype/storage.js');
  const store = { getItem: key => values.get(key), setItem(key, value) { writes++; if (failing) throw new Error('磁盘写入失败'); values.set(key, value); } };
  let state = storage.createEmptyState();
  const agent = require('../prototype/prompt-agent-coordinator.js').createPromptAgentCoordinator({
    searchWeb: async () => [{ title: '可见来源', url: 'https://public.test/write', summary: '合并摘要' }]
  });
  const c = createWritingWorkbenchCoordinator({ getState: () => state, persistState(next) { state = storage.saveState(store, next); return state; }, promptAgentCoordinator: agent });
  const a = await c.createArticle({ draft: '稿件', saveEnabled: true });
  const snapshot = structuredClone(state);
  c.previewResearch(a.id);
  const beforeWrites = writes;
  failing = true;
  await assert.rejects(c.approveResearch(a.id, { confirmed: true }), { code: 'PERSIST_FAILED' });
  assert.equal(writes - beforeWrites, 1);
  assert.deepEqual(state, snapshot);
  assert.match(c.getRounds(a.id)[0].prompt, /可见来源/);
  assert.equal(c.getRounds(a.id)[0].sources[0].title, '可见来源');
});

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

test('写作选材保留授权目录相对位置、指纹版本、摘录行和选用理由', async () => {
  const { c } = setup({ promptAgentCoordinator: { selectMaterials: async () => [{
    id: 'local:guide/writing.md', type: 'local-source-document', title: '写作指南',
    location: 'guide/writing.md', relativePath: 'guide/writing.md',
    fingerprint: 'c'.repeat(64), fragments: [{ text: '证据范围摘录', line: 24 }],
    excerpt: '证据范围摘录', useReason: '与本轮目标相关', verificationStatus: 'unverified'
  }] } });
  const article = await c.createArticle({ goal: '按证据范围整理写作指南' });
  await c.selectMaterials(article.id);
  const source = c.getRounds(article.id)[0].sources[0];

  assert.equal(source.title, '写作指南');
  assert.equal(source.sourceId, 'local:guide/writing.md');
  assert.equal(source.sourceLocator, 'guide/writing.md');
  assert.equal(source.sourceVersion, `sha256:${'c'.repeat(64)}`);
  assert.equal(source.excerptLocator, '第 24 行');
  assert.equal(source.selectionReason, '与本轮目标相关');
  assert.equal(source.origin, 'authorized-directory');
  assert.equal(source.attachmentRequired, true);
  assert.match(source.excerpt, /证据范围摘录/);
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

test('合并刷新保留全部会话且立即失效旧模型资料与排队保存', async () => {
  const entered = deferred(), release = deferred(), selected = deferred(), model = deferred();
  const env = realStorageSetup({ requestModel: () => model.promise,
    promptAgentCoordinator: { selectMaterials: () => selected.promise } });
  const { c } = env;
  const unsaved = await c.createArticle({ draft: '仅会话原稿' });
  const a = await c.createArticle({ draft: '已保存原稿', saveEnabled: true });
  const materialResult = c.selectMaterials(unsaved.id).then(() => null, e => e);
  const modelResult = c.runModelDiagnosis(unsaved.id).then(() => null, e => e);
  env.delayReturn(() => { entered.resolve(); return release.promise; });
  const blocker = c.rememberPreference(a.id, { preference: '保留证据' });
  await entered.promise;
  const queued = c.appendRound(a.id, { draft: '尚未写盘新轮' }).then(() => null, e => e);
  env.importState(structuredClone(env.state()));
  const refresh = c.refreshFromStorage({ preserveSessions: true });
  selected.resolve([{ title: '过期资料', excerpt: '不能进入会话' }]);
  model.resolve('过期模型诊断');
  release.resolve();
  await blocker;
  await refresh;
  assert.equal((await queued)?.code, 'STALE_RESULT');
  assert.equal((await materialResult)?.code, 'STALE_RESULT');
  assert.equal((await modelResult)?.code, 'STALE_RESULT');
  assert.equal(c.getWorkspace(unsaved.id).rounds[0].draft, '仅会话原稿');
  assert.equal(c.getWorkspace(unsaved.id).rounds[0].sources.length, 0);
  assert.doesNotMatch(c.getWorkspace(unsaved.id).rounds[0].diagnosis, /过期模型/);
  assert.equal(c.getWorkspace(a.id).rounds.at(-1).draft, '尚未写盘新轮');
  assert.equal(env.disk().writingArticles.length, 1);
  assert.equal(env.disk().writingArticles[0].rounds.length, 1);
  env.delayReturn(null);
  await c.updateArticle(unsaved.id, { goal: '新边界允许继续编辑' });
  assert.equal(c.getWorkspace(unsaved.id).article.goal, '新边界允许继续编辑');
});

test('合并同ID当前数据优先，暂停新轮及失败原文标记保留且可精简恢复', async () => {
  const backupAPI = require('../prototype/workspace-backup.js');
  const env = realStorageSetup();
  const { c } = env;
  const paused = await c.createArticle({ title: '当前标题', draft: '已保存原稿', saveEnabled: true });
  await c.setSaveEnabled(paused.id, false);
  await c.appendRound(paused.id, { draft: '暂停后的会话新稿' });
  const failing = await c.createArticle({ draft: '另一篇首稿', saveEnabled: true });
  const longDraft = '失败原文'.repeat(2100);
  await assert.rejects(c.appendRound(failing.id, { draft: longDraft }), RangeError);
  const before = c.getWorkspace(failing.id);
  const incoming = structuredClone(env.state());
  incoming.writingArticles[0].article.title = '备份中的冲突标题';
  incoming.writingArticles[0].rounds[0].draft = '备份中的冲突稿';
  const merged = backupAPI.mergeState(env.state(), backupAPI.createBackup(incoming, { scope: 'workspace' }));
  assert.ok(merged.conflicts.some(conflict => conflict.id === paused.id));
  env.importState(merged.state);
  await c.refreshFromStorage({ preserveSessions: true });
  assert.equal(env.disk().writingArticles.find(w => w.id === paused.id).article.title, '当前标题');
  assert.equal(c.getWorkspace(paused.id).rounds.at(-1).draft, '暂停后的会话新稿');
  assert.deepEqual(c.getWorkspace(failing.id), before, '刷新不得重新规范化并截断失败原文');
  await c.appendRound(failing.id, { draft: '精简恢复稿' });
  const saved = env.disk().writingArticles.find(w => w.id === failing.id);
  assert.deepEqual(saved.rounds.map(r => r.draft), ['另一篇首稿', '精简恢复稿'], '失败轮标记必须保留以防恢复时误写入原文');
  assert.equal(c.getWorkspace(failing.id).rounds[1].draft, longDraft);
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

test('文章轮次记录所选基础包快照，基础包更新后历史提示词仍使用旧版本', async () => {
  const pack = {
    id: 'pack-coordinator', name: '协调器包', layer: 'task', genre: 'article', taskType: 'revision', version: 1, enabled: true,
    checks: [{ id: 'coordinator-rule', statement: '旧规则哨兵', sourceIds: ['coordinator-source'] }],
    sources: [{ id: 'coordinator-source', title: '协调器来源', url: 'https://example.test/coordinator' }]
  };
  let state = { writingArticles: [], writingMemories: [], writingPacks: [pack], writingPackSettings: [] };
  const c = createWritingWorkbenchCoordinator({
    getState: () => state,
    persistState(next) { state = structuredClone(next); return state; }
  });
  const article = await c.createArticle({ draft: '初稿', packSelections: ['pack-coordinator'], saveEnabled: true });
  const first = c.getRounds(article.id)[0];
  assert.deepEqual(first.packSelections, ['pack-coordinator']);
  assert.equal(first.packSnapshot.packs.some(item => item.id === 'pack-coordinator'), true);
  assert.match(first.prompt, /旧规则哨兵/);
  state = { ...state, writingPacks: [{ ...pack, version: 2,
    checks: [{ id: 'coordinator-rule-v2', statement: '新规则哨兵' }] }] };
  const rebuilt = await c.build(article.id, { roundId: first.id });
  assert.match(rebuilt.prompt, /旧规则哨兵/);
  assert.doesNotMatch(rebuilt.prompt, /新规则哨兵/);
});

test('多个基础包引用同名来源时，历史提示词保留每个包的来源元数据', async () => {
  const packs = [
    { id: 'pack-a', name: '包A', layer: 'task', genre: 'article', taskType: 'revision', version: 1, enabled: true,
      checks: [{ id: 'rule-a', statement: '包A规则哨兵', sourceIds: ['shared-source'] }],
      sources: [{ id: 'shared-source', title: '包A来源哨兵', locator: 'pack-a#shared-source' }] },
    { id: 'pack-b', name: '包B', layer: 'task', genre: 'article', taskType: 'revision', version: 1, enabled: true,
      checks: [{ id: 'rule-b', statement: '包B规则哨兵', sourceIds: ['shared-source'] }],
      sources: [{ id: 'shared-source', title: '包B来源哨兵', locator: 'pack-b#shared-source' }] }
  ];
  let state = { writingArticles: [], writingMemories: [], writingPacks: packs, writingPackSettings: [] };
  const c = createWritingWorkbenchCoordinator({
    getState: () => state,
    persistState(next) { state = structuredClone(next); return state; }
  });
  const article = await c.createArticle({ draft: '初稿', packSelections: ['pack-a', 'pack-b'], saveEnabled: true });
  const round = c.getRounds(article.id)[0];
  // builtin-article 也会带一个默认来源，加上两个跨包同名来源共 3 条。
  assert.equal(round.packSnapshot.sources.length, 3);
  assert.match(round.prompt, /包A来源哨兵/);
  assert.match(round.prompt, /包B来源哨兵/);
});

test('任务单元可新增、编辑、归档，轮次保存单元快照且材料关联生效', async () => {
  const { c } = setup();
  const article = await c.createArticle({ draft: '整篇初稿' });
  const first = await c.addUnit(article.id, {
    type: 'chapter', title: '第一章', goal: '介绍背景', completionCriteria: ['说明概念']
  });
  const second = await c.addUnit(article.id, { type: 'chapter', title: '第二章' });
  await c.updateUnit(article.id, first.id, { goal: '解释研究背景', completionCriteria: ['说明关键概念'] });

  const result = await c.appendRound(article.id, {
    draft: '第一章稿件', unitId: first.id,
    materials: [
      { id: 'whole-material', title: '全文共用', purpose: 'content', excerpt: '全文依据' },
      { id: 'unit-material', title: '章节材料', purpose: 'content', excerpt: '章节依据', unitIds: [first.id] },
      { id: 'other-material', title: '另一章材料', purpose: 'content', excerpt: '另一章哨兵', unitIds: [second.id] }
    ]
  });
  assert.equal(result.round.unitId, first.id);
  assert.equal(result.round.unitSnapshot.goal, '解释研究背景');
  assert.ok(result.round.prompt.includes('章节依据'));
  assert.ok(!result.round.prompt.includes('另一章哨兵'));

  const materials = await c.setMaterialUnits(article.id, result.round.id, 'unit-material', [second.id]);
  assert.deepEqual(materials.materials.find(item => item.id === 'unit-material').unitIds, [second.id]);
  const regenerated = await c.build(article.id, { roundId: result.round.id });
  assert.ok(!regenerated.prompt.includes('章节依据'));

  await c.archiveUnit(article.id, first.id);
  assert.equal(c.getWorkspace(article.id).units.find(item => item.id === first.id).archived, true);
  await assert.rejects(c.appendRound(article.id, { unitId: first.id }), { code: 'UNIT_ARCHIVED' });
});

test('路线只从当前选用且适用的基础包读取，推进必须经过显式用户确认', async () => {
  const selectedPack = {
    id: 'selected-route-pack', name: '来源路线包', layer: 'task', genre: 'article', taskType: 'revision', version: 4,
    enabled: true, checks: [{ id: 'route-check', statement: '保留包用于路线选择' }],
    sources: [{ id: 'route-source', title: '已审阅方法来源', verificationStatus: 'source-reviewed' }],
    routes: [{
      id: 'revision-route', title: '逐项核对', taskTypes: ['revision'], sourceIds: ['route-source'],
      verificationStatus: 'source-reviewed', stages: [{
        id: 'verify-evidence', title: '核对证据', inputs: ['当前稿件'], outputs: ['证据表'], checks: ['来源可定位'],
        sourceIds: ['route-source'], verificationStatus: 'source-reviewed', skippable: false,
        returnWhenMissing: ['补充来源后重做']
      }]
    }]
  };
  const otherPack = { ...selectedPack, id: 'unselected-route-pack', routes: [{
    ...selectedPack.routes[0], id: 'unselected-route', title: '不可见路线'
  }] };
  const { c, state } = setup({ writingPacks: [selectedPack, otherPack] });
  const article = await c.createArticle({ draft: '需要核对的文章', packSelections: ['selected-route-pack'], saveEnabled: true });

  const routes = c.listRoutes(article.id, 'revision');
  assert.deepEqual(routes.map(route => route.routeId), ['revision-route']);
  assert.equal(routes[0].verificationStatus, 'source-reviewed');
  assert.equal(routes[0].sources[0].verificationStatus, 'source-reviewed');
  assert.equal(c.listRoutes(article.id, 'diagnosis').length, 0);

  const selected = await c.selectRoute(article.id, 'revision-route');
  assert.equal(selected.routeProgress.packVersion, 4);
  assert.equal(selected.routeProgress.stages[0].status, 'not-started');
  assert.equal(selected.round.routeSnapshot.verificationStatus, 'source-reviewed');
  assert.match(selected.round.prompt, /核对证据/);
  assert.match(selected.round.prompt, /已审阅方法来源/);
  await assert.rejects(c.advanceRoute(article.id, 'verify-evidence', 'skip'), { code: 'ROUTE_STEP_NOT_SKIPPABLE' });
  await assert.rejects(c.advanceRoute(article.id, 'verify-evidence', 'complete'), { code: 'ROUTE_CONFIRMATION_REQUIRED' });

  await c.advanceRoute(article.id, 'verify-evidence', 'start');
  const blocked = await c.advanceRoute(article.id, 'verify-evidence', 'block', { reason: '缺少原始来源' });
  assert.equal(blocked.routeProgress.stages[0].status, 'blocked');
  assert.equal(blocked.routeProgress.stages[0].statusReason, '缺少原始来源');
  await c.advanceRoute(article.id, 'verify-evidence', 'start');
  const completed = await c.advanceRoute(article.id, 'verify-evidence', 'complete', {
    confirmed: true, result: '来源已定位', evidence: 'https://example.test/source'
  });
  assert.equal(completed.routeProgress.stages[0].status, 'user-confirmed-complete');
  assert.equal(completed.routeProgress.stages[0].evidence, 'https://example.test/source');
  assert.equal(completed.routeProgress.stages[0].verificationStatus, 'source-reviewed',
    '用户确认完成不得改写专业来源核验状态');
  assert.equal(state().writingArticles[0].routeProgress.stages[0].status, 'user-confirmed-complete');
});

test('长篇领域路线按当前任务类型选择而非普通文章改稿任务', async () => {
  const { c } = setup();
  const story = await c.createArticle({ genre: 'fiction', title: '路线任务隔离' });
  const taskType = c.getWorkspace(story.id).rounds[0].taskType;
  const route = c.listRoutes(story.id, taskType)[0];
  assert.ok(route, '小说基础包应提供当前任务适用路线');
  const selected = await c.selectRoute(story.id, route.routeId, route.packId);
  assert.equal(selected.routeProgress.routeId, route.routeId);
  assert.equal(selected.round.routeSnapshot.routeId, route.routeId);
});

test('路线受阻退回后允许重做此前已确认的步骤，再回到受阻步骤', async () => {
  const pack = {
    id: 'route-return-pack', name: '退回路线', layer: 'task', genre: 'article', taskType: 'revision', version: 1,
    enabled: true, checks: [], sources: [], routes: [{
      id: 'two-step-return', title: '两步核对', taskTypes: ['revision'], sourceIds: [], verificationStatus: 'unverified',
      stages: [
        { id: 'gather', title: '补充材料', inputs: [], outputs: ['材料记录'], checks: ['材料可读'], sourceIds: [], verificationStatus: 'unverified', skippable: false, returnWhenMissing: [] },
        { id: 'assess', title: '评估材料', inputs: ['材料记录'], outputs: ['评估结论'], checks: ['结论可追溯'], sourceIds: [], verificationStatus: 'unverified', skippable: false, returnWhenMissing: ['补充材料后重做'] }
      ]
    }]
  };
  const { c } = setup({ writingPacks: [pack] });
  const article = await c.createArticle({ draft: '待核对稿件', packSelections: [pack.id] });
  await c.selectRoute(article.id, 'two-step-return');
  await c.advanceRoute(article.id, 'gather', 'start');
  await c.advanceRoute(article.id, 'gather', 'complete', { confirmed: true, result: '材料已整理' });
  await c.advanceRoute(article.id, 'assess', 'start');
  const blocked = await c.advanceRoute(article.id, 'assess', 'block', { reason: '还缺一份来源', returnToStageId: 'gather' });
  assert.equal(blocked.routeProgress.currentStageId, 'gather');

  const restarted = await c.advanceRoute(article.id, 'gather', 'start');
  assert.equal(restarted.routeProgress.stages[0].status, 'in-progress');
  await c.advanceRoute(article.id, 'gather', 'complete', { confirmed: true, result: '已补来源' });
  assert.equal(c.getWorkspace(article.id).routeProgress.currentStageId, 'assess');
  await c.advanceRoute(article.id, 'assess', 'start');
  const completed = await c.advanceRoute(article.id, 'assess', 'complete', { confirmed: true, result: '评估完成' });
  assert.equal(completed.routeProgress.stages[1].status, 'user-confirmed-complete');
});

test('有效诊断 JSON 只新增候选问题并关联实际提示词，原始诊断保持原样', async () => {
  const raw = JSON.stringify({ issues: [{
    location: '第二段第 2 句', excerpt: '样本只覆盖两名参与者', observation: '结论写成普遍规律',
    impact: '证据范围与结论范围不一致', evidenceCategory: 'source', evidenceDescription: '核对样本方法',
    packId: '', sourceId: '', suggestion: '限定结论范围并补充依据', priority: 'high'
  }] });
  const { c } = setup({ requestModel: async () => raw });
  const article = await c.createArticle({ draft: '待诊断稿件', saveEnabled: true });
  const roundId = article.rounds.at(-1).id;
  await c.runModelDiagnosis(article.id, { roundId });

  const workspace = c.getWorkspace(article.id);
  const round = workspace.rounds.find(item => item.id === roundId);
  const issue = workspace.issues[0];
  assert.equal(round.diagnosis, raw);
  assert.equal(round.diagnosisParseStatus, 'parsed');
  assert.equal(issue.roundId, roundId);
  assert.equal(issue.promptVersionId, round.promptVersions.find(item => item.id === issue.promptVersionId).id);
  assert.equal(issue.judgment, 'candidate');
  assert.equal(issue.status, 'pending-user');
  assert.equal(issue.excerpt, '样本只覆盖两名参与者');
  assert.equal(round.promptVersions.find(item => item.id === issue.promptVersionId).taskType, 'diagnosis');
  assert.equal(round.promptVersions.find(item => item.id === issue.promptVersionId).copied, false);
});

test('无效 JSON 原文仍保留且可手动录入；新轮复核只由用户显式更新', async () => {
  const raw = '{"issues":[{"excerpt":"未完成字段"}]}';
  const { c } = setup({ requestModel: async () => raw });
  const article = await c.createArticle({ draft: '旧稿' });
  const originalRound = article.rounds.at(-1);
  await c.runModelDiagnosis(article.id, { roundId: originalRound.id });

  let workspace = c.getWorkspace(article.id);
  const diagnosed = workspace.rounds.find(item => item.id === originalRound.id);
  assert.equal(diagnosed.diagnosis, raw);
  assert.equal(diagnosed.diagnosisParseStatus, 'unparsed');
  assert.equal(workspace.issues.length, 0);

  const issue = await c.addIssue(article.id, {
    roundId: originalRound.id, location: '第一段', excerpt: '原始摘录', observation: '缺少依据',
    impact: '读者无法复核', evidenceCategory: 'source', suggestion: '补充来源', priority: 'medium'
  });
  assert.equal(issue.status, 'pending-user');
  await assert.rejects(c.updateIssue(article.id, issue.id, { status: 'review-passed' }), { code: 'ISSUE_REVIEW_ROUND_REQUIRED' });
  const next = await c.appendRound(article.id, { draft: '修改后新稿' });
  workspace = c.getWorkspace(article.id);
  assert.equal(workspace.issues[0].status, 'pending-user', '新稿到达不能自动关闭原问题');
  const reviewed = await c.updateIssue(article.id, issue.id, {
    judgment: 'needs-verification', status: 'review-passed', reviewedRoundId: next.round.id,
    statusReason: '用户确认新稿已补充可定位来源'
  });
  assert.equal(reviewed.roundId, originalRound.id);
  assert.equal(reviewed.excerpt, '原始摘录');
  assert.equal(reviewed.reviewedRoundId, next.round.id);
  assert.equal(reviewed.status, 'review-passed');
  assert.equal(c.getWorkspace(article.id).issues.length, 1);
  assert.equal(c.getWorkspace(article.id).rounds.find(item => item.id === originalRound.id).diagnosis, raw);
});

test('提示词编辑保存与复制分别记录版本状态，历史比较和分支继续不覆盖已有轮次', async () => {
  const { c } = setup();
  const article = await c.createArticle({ draft: '最初稿', saveEnabled: true });
  const first = article.rounds.at(-1);
  const savedPrompt = await c.recordPromptVersion(article.id, first.id, '用户编辑的首版提示词');
  const copiedPrompt = await c.recordPromptVersion(article.id, first.id, '用户明确复制的提示词', { copied: true });
  assert.equal(savedPrompt.copied, false);
  assert.equal(savedPrompt.generated, false);
  assert.equal(copiedPrompt.copied, true);
  assert.equal(copiedPrompt.parentVersionId, savedPrompt.id);

  const second = await c.appendRound(article.id, { draft: '第二轮稿', feedback: '保留第二轮反馈' });
  const third = await c.appendRound(article.id, { draft: '第三轮稿' });
  const comparison = c.compareRounds(article.id, third.round.id, first.id);
  assert.equal(comparison.left.draft, '第三轮稿');
  assert.equal(comparison.right.draft, '最初稿');
  assert.equal(comparison.changes.draft.changed, true);
  assert.ok(comparison.changes.draft.removed.length);
  assert.ok(comparison.changes.draft.added.length);

  const fork = await c.continueFromRound(article.id, first.id, { contexts: ['draft'] });
  const rounds = c.getWorkspace(article.id).rounds;
  assert.equal(rounds.length, 4);
  assert.equal(rounds[1].id, second.round.id);
  assert.equal(rounds[2].id, third.round.id);
  assert.equal(fork.round.draft, '最初稿');
  assert.equal(fork.round.parentRoundId, first.id);
  assert.equal(fork.round.restoredFromRoundId, first.id);
  assert.equal(rounds.find(item => item.id === second.round.id).draft, '第二轮稿');
  assert.equal(rounds.find(item => item.id === third.round.id).draft, '第三轮稿');
});

test('单轮提示词版本超过旧上限仍完整保留且历史 ID 可关联问题', async () => {
  const { c } = setup();
  const article = await c.createArticle({ draft: '初稿', saveEnabled: true });
  const round = article.rounds.at(-1);
  let last;
  for (let index = 0; index < 105; index++) {
    last = await c.recordPromptVersion(article.id, round.id, `提示词版本${index}`);
  }
  const saved = c.getWorkspace(article.id).rounds[0].promptVersions;
  assert.equal(saved.length, 106);
  assert.equal(saved[0].id, round.promptVersions[0].id);
  assert.equal(saved.at(-1).id, last.id);
  const issue = await c.addIssue(article.id, { roundId: round.id, promptVersionId: round.promptVersions[0].id,
    excerpt: '旧版本关联仍有效', observation: '测试引用' });
  assert.equal(issue.promptVersionId, round.promptVersions[0].id);
});

test('带回结果只关联用户选择的提示词版本，未知来源保持未关联', async () => {
  const { c } = setup();
  const article = await c.createArticle({ draft: '初稿', saveEnabled: true });
  const first = article.rounds.at(-1);
  const promptVersion = await c.recordPromptVersion(article.id, first.id, '确认已复制的提示词', { copied: true });

  const linked = await c.appendRound(article.id, { draft: '外部结果', sourcePromptVersionId: promptVersion.id });
  assert.equal(linked.round.sourcePromptVersionId, promptVersion.id);
  const unlinked = await c.appendRound(article.id, { draft: '来源不明的结果', sourcePromptVersionId: 'missing-version' });
  assert.equal(unlinked.round.sourcePromptVersionId, '');
});

test('学术工作区可直接创建，任务提示词与章节单元进入独立历史版本', async () => {
  const { c, state } = realStorageSetup();
  const workspace = await c.createArticle({ genre: 'academic-paper', title: '学位论文',
    academicTarget: { paperType: 'dissertation', discipline: '教育学', institution: '示例大学' },
    goal: '研究生学习体验', saveEnabled: true, draft: '已有研究材料，尚无统计结果。' });

  assert.equal(workspace.article.genre, 'academic-paper');
  assert.equal(workspace.article.academicTarget.institution, '示例大学');
  assert.match(workspace.rounds[0].prompt, /研究规划|研究问题/);
  assert.equal(workspace.rounds[0].promptVersions.at(-1).taskType, 'academic-planning');
  assert.equal(state().writingArticles[0].article.genre, 'academic-paper');

  const chapter = await c.addUnit(workspace.id, { type: 'chapter', title: '结果章节', goal: '报告已提供结果' });
  const next = await c.appendRound(workspace.id, { taskType: 'academic-chapter-draft', unitId: chapter.id,
    materials: [{ id: 'evidence', title: '结果记录', purpose: 'content', excerpt: '仅保留已提供数据。', unitIds: [chapter.id] }] });
  assert.equal(next.round.unitSnapshot.title, '结果章节');
  assert.equal(next.round.promptVersions.at(-1).taskType, 'academic-chapter-draft');
  assert.match(next.round.prompt, /仅保留已提供数据/);

  const outline = await c.build(workspace.id, { taskType: 'academic-outline', roundId: next.round.id });
  assert.equal(outline.taskType, 'academic-outline');
  assert.equal(c.getWorkspace(workspace.id).rounds.at(-1).promptVersions.at(-1).taskType, 'academic-outline');
  assert.deepEqual(c.getWorkspace(workspace.id).rounds.at(-1).promptVersions.at(-1).packVersions,
    [{ id: 'builtin-academic-paper', version: 1 }]);
  assert.equal(c.getWorkspace(workspace.id).rounds.at(-1).promptVersions.at(-1).unitId, chapter.id);
});

test('结构化文体默认加载专属内置包，任务切换保留来源并生成领域提示词', async () => {
  const { c } = realStorageSetup();
  const workspace = await c.createArticle({ genre: 'technical-document', title: '部署手册',
    goal: '说明服务部署和故障恢复', audience: '值班工程师', platform: 'Windows Server',
    constraints: '不得声称未验证的命令已执行',
    materials: [{ id: 'ops', title: '部署记录', purpose: 'content', excerpt: '服务端口为4173。', sourceLocator: 'runbook.md#L12', verificationStatus: 'user-confirmed' }],
    sources: [{ id: 'style', title: '语气样本', purpose: 'style', excerpt: '欢迎查看我们的方案。' }] });
  assert.equal(workspace.rounds[0].taskType, 'technical-procedure');
  assert.match(workspace.rounds[0].prompt, /技术文档/);
  assert.match(workspace.rounds[0].prompt, /部署记录/);
  assert.match(workspace.rounds[0].prompt, /runbook\.md#L12/);
  assert.doesNotMatch(workspace.rounds[0].prompt, /欢迎查看我们的方案/);
  assert.deepEqual(workspace.rounds[0].packSnapshot.packs.map(pack => pack.id), ['builtin-technical-document']);
  const next = await c.build(workspace.id, { taskType: 'technical-troubleshooting', roundId: workspace.rounds[0].id });
  assert.equal(next.taskType, 'technical-troubleshooting');
  assert.match(next.prompt, /故障排查/);
  assert.equal(c.getWorkspace(workspace.id).rounds[0].promptVersions.at(-1).taskType, 'technical-troubleshooting');
  await assert.rejects(c.build(workspace.id, { taskType: 'email-draft', roundId: workspace.rounds[0].id }), /不支持该专属任务/);
});

test('结构化文档模型诊断与后续修订保留领域任务和专业包上下文', async () => {
  let diagnosisRequest = '';
  const { c } = realStorageSetup({ requestModel: async request => {
    diagnosisRequest = request.messages[0].content;
    return JSON.stringify({ issues: [{
      location: '第 2 步', excerpt: '执行部署命令', observation: '缺少执行结果', impact: '读者无法判断是否成功',
      evidenceCategory: 'requirement', evidenceDescription: '技术文档需要可观察的预期结果',
      suggestion: '补充验证命令及其预期输出', priority: 'high'
    }] });
  } });
  const workspace = await c.createArticle({ genre: 'technical-document', title: '部署手册',
    goal: '说明服务部署和故障恢复', audience: '值班工程师', platform: 'Windows Server',
    constraints: '不得声称未验证的命令已执行', draft: '第 2 步：执行部署命令。' });
  const taskType = workspace.rounds[0].taskType;
  const result = await c.runModelDiagnosis(workspace.id);
  const updated = c.getWorkspace(workspace.id).rounds[0];

  assert.match(diagnosisRequest, /技术文档/);
  assert.match(diagnosisRequest, /前置条件和预期结果/);
  assert.match(diagnosisRequest, /诊断/);
  assert.equal(result.diagnosisParseStatus, 'parsed');
  assert.match(result.prompt, /技术文档/);
  assert.match(result.prompt, /故障恢复/);
  assert.match(result.prompt, /缺少执行结果/);
  assert.match(result.prompt, /补充验证命令及其预期输出/);
  assert.equal(updated.taskType, taskType);
  assert.equal(updated.promptVersions.at(-1).taskType, taskType);
  assert.equal(updated.promptVersions.at(-1).content, result.prompt);
});

test('学术文体记忆使用独立命名空间，不写入普通文章偏好', async () => {
  const { c } = setup();
  const workspace = await c.createArticle({ genre: 'academic-paper', title: '学术项目' });
  const memory = await c.rememberPreference(workspace.id, { scope: 'genre', preference: '保留证据来源位置' });
  assert.equal(memory.genre, 'academic-paper');
  assert.ok(c.getRelevantMemories('academic-paper', workspace.id).some(item => item.id === memory.id));
  assert.ok(!c.getRelevantMemories('article', workspace.id).some(item => item.id === memory.id));
});

test('通用资料覆盖批次生成有界提示词并仅在显式确认后计入完成', async () => {
  const { c, state } = realStorageSetup();
  const article = await c.createArticle({ title: '全库批次验收', goal: '逐项比较合成资料', saveEnabled: true });
  await c.setMaterialCoverage(article.id, {
    id: 'coverage-library-1', sourceKind: 'knowledge-library', inventoryComplete: true, knownTotal: 2,
    items: [
      { id: 'entry-1', title: '资料一', sourceVersion: 'v1' },
      { id: 'entry-2', title: '资料二', sourceVersion: 'v1' }
    ]
  });
  const batch = await c.startMaterialBatch(article.id, { batchSize: 2, materials: [
    { id: 'entry-1', sourceVersion: 'v1', excerpt: '合成摘录甲' },
    { id: 'entry-2', sourceVersion: 'v1', excerpt: '合成摘录乙' }
  ] });
  assert.match(batch.promptVersion.content, /合成摘录甲/);
  assert.match(batch.promptVersion.content, /不得声称阅读未列出的原文件/);
  assert.equal(batch.batch.promptVersionId, batch.promptVersion.id);
  assert.equal(state().writingArticles[0].materialCoverage.items[0].status, 'in-progress');

  const returned = await c.recordMaterialBatchOutcome(article.id, batch.batch.id, {
    kind: 'returned', promptVersionId: batch.promptVersion.id, resultSummary: '固定合成回带'
  });
  assert.equal(returned.summary.processed, 0);
  assert.equal(returned.summary.returned, 2);
  const confirmed = await c.confirmMaterialBatch(article.id, batch.batch.id, { evidence: '用户确认本批外部处理已完成' });
  assert.equal(confirmed.summary.processed, 2);
  assert.equal(confirmed.summary.coveragePercent, 100);
  assert.equal(c.getWorkspace(article.id).materialCoverage.batches[0].status, 'confirmed');
});

test('资料来源版本变化时拒绝启动覆盖批次并保留待处理状态', async () => {
  const { c } = realStorageSetup();
  const article = await c.createArticle({ title: '来源版本校验', saveEnabled: true });
  await c.setMaterialCoverage(article.id, {
    id: 'coverage-version-1', sourceKind: 'knowledge-library', inventoryComplete: true, knownTotal: 1,
    items: [{ id: 'entry-1', title: '资料一', sourceVersion: 'v1' }]
  });
  await assert.rejects(c.startMaterialBatch(article.id, {
    materials: [{ id: 'entry-1', sourceVersion: 'v2', excerpt: '旧版本不可混用' }]
  }), /版本已变化/);
  assert.equal(c.getMaterialCoverage(article.id).items[0].status, 'pending');
});

test('替换资料范围时保留旧范围的逐项状态和批次历史', async () => {
  const { c } = realStorageSetup();
  const article = await c.createArticle({ title: '范围历史', saveEnabled: true });
  await c.setMaterialCoverage(article.id, { id: 'scope-old', sourceKind: 'knowledge-library', inventoryComplete: true,
    knownTotal: 1, items: [{ id: 'old-item', title: '旧范围材料', sourceVersion: 'v1' }] });
  const batch = await c.startMaterialBatch(article.id, { materials: [{ id: 'old-item', sourceVersion: 'v1', excerpt: '旧范围摘录' }] });
  await c.recordMaterialBatchOutcome(article.id, batch.batch.id, { kind: 'returned', resultSummary: '旧范围结果' });
  await c.confirmMaterialBatch(article.id, batch.batch.id, { evidence: '旧范围已核对', confirmedAt: '2026-10-22' });
  await c.setMaterialCoverage(article.id, { id: 'scope-new', sourceKind: 'knowledge-library', inventoryComplete: true,
    knownTotal: 1, items: [{ id: 'new-item', title: '新范围材料', sourceVersion: 'v2' }] });
  const coverage = c.getMaterialCoverage(article.id);
  assert.equal(coverage.id, 'scope-new');
  assert.equal(coverage.history.length, 1);
  assert.equal(coverage.history[0].items[0].status, 'processed');
  assert.equal(coverage.history[0].batches[0].confirmation, '旧范围已核对');
});
