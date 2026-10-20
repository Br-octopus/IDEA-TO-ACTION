const test = require('node:test');
const assert = require('node:assert/strict');
const { createWritingDOM } = require('./helpers/writing-dom.js');
const { createWritingWorkbenchCoordinator } = require('../prototype/writing-workbench-coordinator.js');
const storage = require('../prototype/storage.js');
const { createWritingWorkbenchUI } = require('../prototype/writing-workbench-ui.js');

function fixture(options = {}) {
  const dom = createWritingDOM();
  let state = storage.createEmptyState();
  const disk = new Map();
  let failSave = false;
  let requests = 0;
  const copied = [];
  const coordinator = createWritingWorkbenchCoordinator({
    getState: () => state,
    persistState(next) { if (failSave) throw new Error('磁盘已满'); state = storage.saveState({ getItem: key => disk.get(key), setItem: (key, value) => disk.set(key, value) }, next); return state; },
    requestModel: async payload => { requests++; return options.requestModel ? options.requestModel(payload) : '模型诊断'; },
    promptAgentCoordinator: { selectMaterials: async () => [{ id: 'local-1', title: '本地资料', excerpt: '来源事实', location: 'https://example.test/source' }] }
  });
  const ui = createWritingWorkbenchUI({ document: dom.document, coordinator, getState: () => state, copyText: async text => copied.push(text), confirm: options.confirm || (() => true) });
  return { ...dom, ui, coordinator, copied, get state() { return state; }, get requests() { return requests; }, set failSave(value) { failSave = value; } };
}
async function create(f, title = '文章甲', draft = '众所周知，这个产品非常重要。') {
  await f.input('writing-title', title);
  await f.input('writing-goal', '向新读者解释产品');
  await f.input('writing-draft', draft);
  await f.click('create');
  return f.coordinator.listArticles().at(-1)?.id;
}

test('同一表单离线新建与继续回带，更新目标不增加轮次，偏好来自显式候选', async () => {
  const f = fixture();
  const id = await create(f);
  assert.equal(f.requests, 0);
  assert.equal(f.state.writingArticles.length, 0);
  assert.match(f.node('writing-diagnosis').value, /众所周知|非常重要/);
  await f.input('writing-goal', '更新目标');
  await f.click('update');
  assert.equal(f.coordinator.getRounds(id).length, 1);
  await f.input('writing-new-draft', '外部 AI 新稿');
  await f.input('writing-feedback', '整段反馈不能偷偷变成长期偏好');
  await f.input('writing-preference', '少用套话');
  await f.input('writing-example', '直接讲事实');
  await f.input('writing-counterexample', '值得注意的是');
  await f.click('append');
  const rounds = f.coordinator.getRounds(id);
  assert.equal(rounds.length, 2);
  assert.equal(rounds[1].draft, '外部 AI 新稿');
  assert.deepEqual(rounds[1].preferences, [{ preference: '少用套话', example: '直接讲事实', counterexample: '值得注意的是' }]);
  assert.equal(f.state.writingMemories.length, 0);
});

test('切篇、回看只读轮次及重复渲染保留各篇未提交输入', async () => {
  const f = fixture();
  const a = await create(f);
  await f.input('writing-new-draft', '甲未提交');
  await f.input('writing-feedback', '甲反馈');
  await f.click('new');
  const b = await create(f, '文章乙', '乙原文');
  await f.input('writing-new-draft', '乙未提交');
  await f.change('writing-article-list', a);
  assert.equal(f.node('writing-new-draft').value, '甲未提交');
  const round = f.coordinator.getRounds(a)[0];
  await f.click('round', { roundId: round.id });
  assert.equal(f.node('writing-history-draft').readOnly, true);
  assert.equal(f.node('writing-history-draft').value, round.draft);
  f.ui.render();
  assert.equal(f.node('writing-feedback').value, '甲反馈');
  await f.change('writing-article-list', b);
  assert.equal(f.node('writing-new-draft').value, '乙未提交');
});

test('保存失败不误报，暂停后旧历史冻结，删除取消保留整篇', async () => {
  let confirmed = false;
  const f = fixture({ confirm: () => confirmed });
  const id = await create(f);
  f.failSave = true;
  await f.change('writing-save', true);
  assert.equal(f.state.writingArticles.length, 0);
  assert.match(f.mount.innerHTML, /磁盘已满/);
  assert.match(f.mount.innerHTML, /0\/1/);
  f.failSave = false;
  await f.change('writing-save', true);
  assert.equal(f.state.writingArticles[0].rounds.length, 1);
  await f.change('writing-save', false);
  await f.input('writing-new-draft', '仅会话新稿');
  await f.click('append');
  assert.equal(f.state.writingArticles[0].rounds.length, 1);
  assert.equal(f.coordinator.getRounds(id).length, 2);
  assert.match(f.mount.innerHTML, /1\/2/);
  await f.click('delete-article');
  assert.equal(f.coordinator.listArticles().length, 1);
  confirmed = true;
  await f.click('delete-article');
  assert.equal(f.coordinator.listArticles().length, 0);
  assert.equal(f.state.writingArticles.length, 0);
});

test('材料共三份、用途可选，风格原文不进提示词，本地选择复用协调器', async () => {
  const f = fixture();
  await f.click('add-material');
  await f.input('writing-material-0-title', '风格样本');
  await f.input('writing-material-0-excerpt', '样本独有观点绝不进入提示词。短句。');
  await f.change('writing-material-0-purpose', 'style');
  const id = await create(f);
  assert.doesNotMatch(f.node('writing-prompt').value, /样本独有观点/);
  assert.match(f.mount.innerHTML, /句长|段落密度/);
  await f.input('writing-style-corrections', '保留短句，避免夸张');
  await f.click('correct-style');
  assert.match(f.coordinator.getWorkspace(id).styleProfile.userCorrections, /保留短句/);
  await f.click('select-materials');
  assert.equal(f.coordinator.getRounds(id)[0].sources.length, 1);
  await f.click('add-material');
  assert.equal(f.mount.querySelectorAll('[data-material-purpose]').length, 3);
});

test('编辑复制提示词，模型失败保留诊断和输入，迟到结果不串篇', async () => {
  let rejectModel;
  const f = fixture({ requestModel: () => new Promise((_, reject) => { rejectModel = reject; }) });
  const a = await create(f);
  await f.input('writing-prompt', '我的编辑提示词');
  await f.click('copy-prompt');
  assert.deepEqual(f.copied, ['我的编辑提示词']);
  const diagnosis = f.node('writing-diagnosis').value;
  const running = f.click('model');
  await new Promise(resolve => setImmediate(resolve));
  await f.input('writing-feedback', '请求中继续输入');
  await f.click('new');
  await create(f, '乙');
  rejectModel(new Error('模型不可用'));
  await running;
  assert.equal(f.node('writing-title').value, '乙');
  await f.change('writing-article-list', a);
  assert.equal(f.node('writing-diagnosis').value, diagnosis);
  assert.equal(f.node('writing-feedback').value, '请求中继续输入');
  assert.match(f.mount.innerHTML, /模型不可用/);
});

test('应用真实接线：旧文章别名进入单写作root，场景隔离且面包屑正确', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  assert.ok(f.coordinator, '应用需要实际创建写作协调器');
  await f.event('nav-article');
  assert.equal(f.mount.hidden, false);
  assert.equal(f.element('ppt-scene-root').hidden, true);
  assert.match(f.element('breadcrumb').textContent, /写作工作台/);
  await f.input('writing-goal', '切场景不丢失');
  await f.event('scene-ppt');
  assert.equal(f.mount.hidden, true);
  assert.equal(f.element('ppt-scene-root').hidden, false);
  await f.event('scene-writing');
  assert.equal(f.node('writing-goal').value, '切场景不丢失');
  await f.event('nav-prompt-agent');
  assert.match(f.element('breadcrumb').textContent, /提示词 Agent/);
});

test('应用真实发送预览确认前零请求，取消保留原诊断，确认才外发', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  await f.settle();
  await create(f);
  const before = f.node('writing-diagnosis').value;
  let running = f.click('model');
  await f.settle();
  assert.equal(f.requests, 0);
  assert.equal(f.element('send-preview').hidden, false);
  await f.event('send-preview-cancel');
  await running;
  assert.equal(f.node('writing-diagnosis').value, before);
  running = f.click('model');
  await f.settle();
  await f.event('send-preview-confirm');
  await running;
  assert.equal(f.requests, 1);
  assert.match(f.node('writing-diagnosis').value, /真实预览确认后/);
});

test('失败创建和失败回带可通过精简新稿恢复，完整失败原文仍在会话', async () => {
  const f = fixture();
  const original = '原'.repeat(8001);
  await create(f, '失败原稿', original);
  const id = f.coordinator.listArticles()[0].id;
  assert.match(f.mount.innerHTML, /超过8000/);
  assert.equal(f.coordinator.getRounds(id)[0].draft, original);
  await f.input('writing-new-draft', '精简可用稿');
  await f.click('append');
  assert.equal(f.coordinator.getRounds(id).length, 2);
  assert.equal(f.coordinator.getRounds(id)[1].draft, '精简可用稿');
  await f.input('writing-new-draft', '新'.repeat(8001));
  await f.click('append');
  await f.input('writing-new-draft', '再次恢复');
  await f.click('append');
  assert.equal(f.coordinator.getRounds(id).at(-1).draft, '再次恢复');
  await f.change('writing-save', true);
  assert.equal(f.state.writingArticles[0].rounds.length, 2);
  assert.equal(f.coordinator.getRounds(id).length, 4);
  assert.match(f.mount.innerHTML, /2\/4/);
});

test('显式记忆管理覆盖全部而非相关三条，编辑例句反例、删除和自动晋升撤销', async () => {
  const f = fixture();
  await create(f);
  for (let i = 0; i < 5; i++) {
    await f.input('writing-preference', `偏好${i}`);
    await f.change('writing-memory-scope', ['general', 'genre', 'article'][i % 3]);
    await f.click('remember');
  }
  assert.equal(f.state.writingMemories.length, 5);
  const m = f.state.writingMemories[0];
  await f.click('manage-memories');
  assert.equal(f.mount.querySelectorAll('[data-memory-field="preference"]').length, 5);
  await f.input(`writing-memory-${m.id}-preference`, '修改后的偏好');
  await f.input(`writing-memory-${m.id}-example`, '例句');
  await f.input(`writing-memory-${m.id}-counterexample`, '反例');
  await f.click('edit-memory', { memoryId: m.id });
  assert.equal(f.state.writingMemories.find(x => x.id === m.id).example, '例句');
  await f.click('delete-memory', { memoryId: m.id });
  assert.ok(f.state.writingMemories.find(x => x.id === m.id).undo.undoneAt);
  assert.equal(f.mount.querySelectorAll('[data-memory-field="preference"]').length, 4);
  await f.input('writing-preference', '跨篇相同候选');
  await f.click('append');
  await f.click('new');
  await create(f, '第二篇');
  await f.input('writing-preference', '跨篇相同候选');
  await f.click('append');
  const promoted = f.state.writingMemories.find(x => x.preference === '跨篇相同候选');
  assert.ok(promoted);
  assert.match(f.mount.innerHTML, /跨文章重复偏好/);
  await f.click('undo-memory', { memoryId: promoted.id });
  assert.ok(f.state.writingMemories.find(x => x.id === promoted.id).undo.undoneAt);
});

test('未知文体明确确认，动态内容转义，危险URL不生成链接', async () => {
  let allow = false;
  const f = fixture({ confirm: () => allow });
  await f.input('writing-genre', 'novel');
  await create(f, '<img src=x onerror=alert(1)>');
  assert.equal(f.coordinator.listArticles().length, 0);
  allow = true;
  const id = await create(f, '<img src=x onerror=alert(1)>');
  assert.equal(f.coordinator.getWorkspace(id).genre, 'article');
  assert.doesNotMatch(f.mount.innerHTML, /<img src=x/);
  assert.match(f.mount.innerHTML, /&lt;img/);
  await f.coordinator.appendRound(id, { draft: '正文', sources: [{ title: '危险来源', url: 'javascript:alert(1)', purpose: 'content', excerpt: '<svg onload=alert(1)>' }] });
  const fresh = createWritingDOM();
  const ui = createWritingWorkbenchUI({ document: fresh.document, coordinator: f.coordinator, getState: () => f.state });
  ui.openArticle(id);
  assert.match(fresh.mount.innerHTML, /危险来源/);
  assert.doesNotMatch(fresh.mount.innerHTML, /href="javascript:|<svg onload/);
  assert.match(fresh.mount.innerHTML, /&lt;svg/);
});

test('应用保存尊重读取阻断，写失败不替换真实state', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const blocked = createWritingApp({ readBlocked: true });
  await create(blocked);
  await blocked.change('writing-save', true);
  assert.equal(blocked.writes, 0);
  assert.match(blocked.mount.innerHTML, /已暂停保存/);
  const f = createWritingApp();
  await create(f);
  const before = f.state;
  f.failSave = true;
  await f.change('writing-save', true);
  assert.equal(f.state, before);
  assert.match(f.mount.innerHTML, /磁盘已满/);
});

test('完整备份恢复暂停保存历史且刷新协调器，资料库导入保留会话', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const backupAPI = require('../prototype/workspace-backup.js');
  const f = createWritingApp();
  await create(f, '会话草稿');
  const sessionId = f.coordinator.listArticles()[0].id;
  await f.input('writing-feedback', '尚未提交反馈');
  await f.import(backupAPI.createBackup(storage.createEmptyState(), { scope: 'knowledge-base' }));
  assert.equal(f.coordinator.getWorkspace(sessionId).article.title, '会话草稿');
  assert.equal(f.node('writing-feedback').value, '尚未提交反馈');
  const source = fixture();
  const savedId = await create(source, '导入暂停历史');
  await source.change('writing-save', true);
  await source.change('writing-save', false);
  await f.import(backupAPI.createBackup(source.state, { scope: 'workspace' }));
  assert.equal(f.state.writingArticles[0].article.saveEnabled, false);
  assert.equal(f.state.writingArticles[0].rounds.length, 1);
  assert.equal(f.coordinator.listArticles().length, 1);
  assert.equal(f.coordinator.getWorkspace(savedId).article.title, '导入暂停历史');
});

test('模型异步成功绑定发起篇，等待中仍可复制，过期错误保留输入和诊断', async () => {
  let resolveModel;
  const f = fixture({ requestModel: () => new Promise(resolve => { resolveModel = resolve; }) });
  const a = await create(f);
  const running = f.click('model');
  await new Promise(resolve => setImmediate(resolve));
  await f.input('writing-prompt', '等待时编辑的提示词');
  await f.click('copy-prompt');
  assert.deepEqual(f.copied, ['等待时编辑的提示词']);
  await f.click('new');
  await create(f, '乙篇');
  resolveModel('甲篇模型结果');
  await running;
  assert.equal(f.node('writing-title').value, '乙篇');
  assert.doesNotMatch(f.node('writing-diagnosis').value, /甲篇模型结果/);
  await f.change('writing-article-list', a);
  assert.match(f.node('writing-diagnosis').value, /甲篇模型结果/);
  assert.equal(f.node('writing-prompt').value, '等待时编辑的提示词');
  const old = f.node('writing-diagnosis').value;
  const stale = f.click('model');
  await new Promise(resolve => setImmediate(resolve));
  await f.input('writing-feedback', '过期也要保留');
  await f.coordinator.correctStyleProfile(a, '新风格要求');
  resolveModel('过期内容');
  await stale;
  assert.equal(f.node('writing-feedback').value, '过期也要保留');
  assert.equal(f.node('writing-diagnosis').value, old);
  assert.match(f.mount.innerHTML, /过期/);
});

test('中文状态可读且选择维度真的控制初检', async () => {
  const f = fixture();
  await f.change('writing-dimension-3', true);
  await create(f);
  assert.match(f.node('writing-diagnosis').value, /语言表达/);
  assert.doesNotMatch(f.node('writing-diagnosis').value, /事实依据：/);
  assert.match(f.mount.innerHTML, /来源：临时判断 · 把握度：低/);
  assert.equal(f.node('writing-genre').value, '普通文章');
});

test('初始首页面包屑不被隐藏Agent场景初始化覆盖', () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  assert.doesNotMatch(f.element('breadcrumb').textContent, /提示词 Agent/);
});

test('同ID备份替换后显示恢复轮次和保存开关，仍保留未提交的新稿反馈', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const backupAPI = require('../prototype/workspace-backup.js');
  const f = createWritingApp();
  const id = await create(f);
  await f.change('writing-save', true);
  await f.input('writing-new-draft', '未提交新稿');
  await f.input('writing-feedback', '未提交反馈');
  const restored = JSON.parse(JSON.stringify(f.state));
  restored.writingArticles[0].article.saveEnabled = false;
  restored.writingArticles[0].article.draft = '导入稿';
  restored.writingArticles[0].rounds[0].draft = '导入稿';
  restored.writingArticles[0].rounds[0].diagnosis = '导入诊断';
  await f.import(backupAPI.createBackup(restored, { scope: 'workspace' }));
  assert.equal(f.coordinator.getWorkspace(id).rounds[0].draft, '导入稿');
  assert.equal(f.node('writing-draft').value, '导入稿');
  assert.equal(f.node('writing-save').checked, false);
  assert.equal(f.node('writing-new-draft').value, '未提交新稿');
  assert.equal(f.node('writing-feedback').value, '未提交反馈');
});

test('第二篇新建首轮触发候选晋升也显示通知，并可立即撤销', async () => {
  const f = fixture();
  await f.input('writing-preference', '结尾写具体结果');
  const a = await create(f);
  await f.click('new');
  await f.input('writing-preference', '结尾写具体结果');
  const b = await create(f, '第二篇');
  const memory = f.state.writingMemories.find(m => m.preference === '结尾写具体结果');
  assert.deepEqual(new Set(memory.evidenceArticleIds), new Set([a, b]));
  assert.match(f.mount.innerHTML, /跨文章重复偏好/);
  await f.click('undo-memory', { memoryId: memory.id });
  assert.ok(f.state.writingMemories.find(m => m.id === memory.id).undo.undoneAt);
});

test('导入预览显示真实文章记忆数量，写失败和校验失败均保留原state及会话', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const backupAPI = require('../prototype/workspace-backup.js');
  const previews = [];
  const f = createWritingApp({ confirm(message) { previews.push(message); return true; } });
  const id = await create(f);
  await f.change('writing-save', true);
  await f.input('writing-preference', '保存偏好');
  await f.click('remember');
  await f.input('writing-new-draft', '导入失败不丢稿');
  const backup = backupAPI.createBackup(f.state, { scope: 'workspace' });
  const before = f.state;
  f.failSave = true;
  await f.import(backup);
  assert.equal(f.state, before);
  assert.equal(f.coordinator.getWorkspace(id).article.title, '文章甲');
  assert.equal(f.node('writing-new-draft').value, '导入失败不丢稿');
  assert.match(previews.at(-1), /1 篇文章、1 条写作记忆/);
  f.failSave = false;
  const writes = f.writes;
  await f.import({ ...backup, counts: { ...backup.counts, writingArticles: 50 } });
  assert.equal(f.writes, writes);
  assert.equal(f.state, before);
});

test('整篇删除写失败保留全部轮次和未提交输入', async () => {
  const f = fixture();
  const id = await create(f);
  await f.change('writing-save', true);
  await f.input('writing-feedback', '等待中的反馈');
  f.failSave = true;
  await f.click('delete-article');
  assert.equal(f.coordinator.getRounds(id).length, 1);
  assert.equal(f.state.writingArticles.length, 1);
  assert.equal(f.node('writing-feedback').value, '等待中的反馈');
  assert.match(f.mount.innerHTML, /磁盘已满/);
});

test('导出按钮真实事件支持完整工作区和仅资料库，范围决定文章记忆是否包含', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  await create(f);
  await f.change('writing-save', true);
  await f.input('writing-preference', '结尾写具体结果');
  await f.click('remember');
  assert.ok(f.listeners.has('knowledge-export-open:click'), '导出按钮必须绑定真实事件');
  f.element('knowledge-export-scope').value = 'workspace';
  await f.event('knowledge-export-open');
  const workspace = f.exports.at(-1);
  assert.equal(workspace.scope, 'workspace');
  assert.equal(workspace.data.writingArticles.length, 1);
  assert.equal(workspace.data.writingMemories.length, 1);
  assert.match(f.element('knowledge-backup-status').textContent, /工作区/);
  f.element('knowledge-export-scope').value = 'knowledge-base';
  await f.event('knowledge-export-open');
  const knowledge = f.exports.at(-1);
  assert.equal(knowledge.scope, 'knowledge-base');
  assert.equal(Object.hasOwn(knowledge.data, 'writingArticles'), false);
  assert.equal(Object.hasOwn(knowledge.data, 'writingMemories'), false);
  assert.match(f.element('knowledge-backup-status').textContent, /资料库/);
  assert.equal(f.exports.length, 2);
});

test('导出API取消或失败保留原备份时间且不能报告成功', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  let result = { canceled: true };
  const f = createWritingApp({ exportBackup() { if (result instanceof Error) throw result; return result; } });
  assert.ok(f.listeners.has('knowledge-export-open:click'), '导出按钮必须绑定真实事件');
  f.element('knowledge-export-scope').value = 'workspace';
  f.element('knowledge-backup-status').textContent = '最近备份：原时间';
  await f.event('knowledge-export-open');
  assert.equal(f.element('knowledge-backup-status').textContent, '最近备份：原时间');
  assert.match(f.element('toast').textContent, /取消/);
  assert.doesNotMatch(f.element('toast').textContent, /已导出/);
  result = new Error('目标目录不可写');
  await f.event('knowledge-export-open');
  assert.equal(f.element('knowledge-backup-status').textContent, '最近备份：原时间');
  assert.match(f.element('toast').textContent, /导出失败.*目标目录不可写/);
});

test('浏览器安全备份确认后可导入一次，令牌不得重复消费或重放', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const backupAPI = require('../prototype/workspace-backup.js');
  const source = fixture();
  await create(source, '浏览器恢复历史');
  await source.change('writing-save', true);
  await source.change('writing-save', false);
  const raw = JSON.stringify(backupAPI.createBackup(source.state, { scope: 'workspace' }));
  const confirmations = [];
  const f = createWritingApp({ browser: true, confirm(message) { confirmations.push(message); return true; } });
  await f.event('knowledge-import-open');
  assert.deepEqual(f.clicks, ['created', 'knowledge-import-file']);
  assert.match(confirmations[0], /确认.*保存安全备份/);
  let reads = 0;
  const file = { text: async () => { reads++; return raw; } };
  const input = { files: [file], value: 'backup.json' };
  await f.event('knowledge-import-file', 'change', { target: input });
  assert.equal(f.state.writingArticles.length, 1, '确认安全备份后应允许真实浏览器分支写入');
  assert.equal(f.state.writingArticles[0].article.saveEnabled, false);
  assert.equal(input.value, '');
  assert.equal(reads, 1);
  assert.match(f.element('toast').textContent, /导入成功/);
  const writes = f.writes;
  await f.event('knowledge-import-file', 'change', { target: input });
  assert.equal(f.writes, writes);
  assert.equal(reads, 1, '已消费的令牌不得再次读取或导入文件');
  assert.match(f.element('toast').textContent, /未确认已保存安全备份/);
});

test('浏览器未确认安全备份时不能打开选择器或读取导入文件', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp({ browser: true, confirm: () => false });
  await f.event('knowledge-import-open');
  assert.deepEqual(f.clicks, ['created']);
  let reads = 0;
  await f.event('knowledge-import-file', 'change', { target: { files: [{ text: async () => { reads++; return '{}'; } }], value: 'backup.json' } });
  assert.equal(reads, 0);
  assert.equal(f.writes, 0);
  assert.match(f.element('toast').textContent, /未确认已保存安全备份/);
});

test('真实页面资料表单和字段ID唯一，资料类型具有可选默认值', () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  const ids = [...f.pageHTML.matchAll(/\bid="(knowledge-entry-[^"]+)"/g)].map(match => match[1]);
  assert.equal(f.knowledgeForms.length, 1, '必须只有一个可操作的资料表单');
  assert.equal(new Set(ids).size, ids.length, '资料字段ID不得重复');
  assert.equal(f.element('knowledge-entry-type').value, 'manual-note', '首个表单必须有真实可选类型');
});

test('两种资料打开取消入口共用表单，保存手工资料后写作可选入本篇', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp({ realMaterials: true });
  for (const [open, cancel] of [['open-knowledge-entry', 'cancel-knowledge-entry'], ['knowledge-add-open', 'knowledge-entry-cancel']]) {
    await f.event(open);
    assert.equal(f.element('knowledge-entry-form').hidden, false);
    await f.event(cancel);
    assert.equal(f.element('knowledge-entry-form').hidden, true);
  }
  await f.event('knowledge-add-open');
  assert.equal(f.element('knowledge-entry-type').value, 'manual-note', '应沿用真实HTML中的默认类型');
  f.element('knowledge-entry-title').value = '产品交付事实';
  f.element('knowledge-entry-summary').value = '产品交付事实：三个客户已完成试用';
  f.element('knowledge-entry-domains').value = '普通文章';
  await f.event('knowledge-entry-form', 'submit');
  assert.equal(f.state.knowledgeEntries.length, 1, '一次提交只能新增一条资料');
  assert.equal(f.state.knowledgeEntries[0].type, 'manual-note');
  assert.equal(f.state.knowledgeEntries[0].verificationStatus, 'unverified');
  assert.equal(f.element('knowledge-entry-form').hidden, true);
  await create(f);
  await f.input('writing-goal', '产品交付事实');
  await f.click('update');
  await f.click('select-materials');
  const workspace = f.coordinator.getWorkspace(f.coordinator.listArticles()[0].id);
  assert.ok(workspace.rounds[0].sources.some(source => source.title.includes('产品交付事实') && source.excerpt.includes('三个客户已完成试用')));
  assert.match(f.node('writing-prompt').value, /三个客户已完成试用/);
  assert.equal(f.requests, 0);
});
