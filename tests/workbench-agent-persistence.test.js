const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const path = require('node:path');
const { createRequire } = require('node:module');

const source = fs.readFileSync(process.env.WORKBENCH_APP_SOURCE || path.join(__dirname, '../prototype/app.js'), 'utf8');
const start = source.indexOf('  async function requestWorkbenchAgent(project) {');
const end = source.indexOf('  document.getElementById("workbench-message-input").addEventListener("keydown"', start);
assert.ok(start >= 0 && end > start);
const requestSource = source.slice(start, end);
const submitStart = source.indexOf('  async function submitWorkbenchReply(');
const submitEnd = source.indexOf('  document.getElementById("workbench-messages").addEventListener("click"', submitStart);
assert.ok(submitStart >= 0 && submitEnd > submitStart);
const submitSource = source.slice(submitStart, submitEnd);
const homeImportStart = source.indexOf('  let pendingHomeImport = null;');
const homeImportEnd = source.indexOf('  const ideaForm =', homeImportStart);
assert.ok(homeImportStart >= 0 && homeImportEnd > homeImportStart);
const homeImportSource = source.slice(homeImportStart, homeImportEnd);

for (const mode of ['success', 'failure']) {
  test(`工作台异步模型${mode === 'success' ? '成功' : '失败'}回复写入保存后的当前任务`, async () => {
    const initialState = { projects: [{ id: 'task-1', conversation: [{ role: 'user', text: '每周进度回顾' }] }] };
    const pendingWorkbenchProjects = new Set();
    const queuedWorkbenchProjects = new Set();
    const context = {
      state: initialState, pendingWorkbenchProjects, queuedWorkbenchProjects,
      renderWorkbench: () => { context.state = structuredClone(context.state); },
      persist: () => { context.state = structuredClone(context.state); }, activeProjectId: 'task-1', serviceConfigReady: true,
      serviceConfig: { model: { configured: true } },
      desktopApi: { requestModel: async () => {
        if (mode === 'failure') throw Error('模型测试错误');
        return { text: '{"reply":"已了解目标","recommendation":{"text":"周五回顾","reason":"容易执行"},"question":"先统一哪一部分？","options":["整体结构","更新节奏"],"recommendedOption":1}' };
      } },
      workbenchDialogue: require('../prototype/workbench-dialogue.js'),
      crypto: { randomUUID: () => 'response-id' },
      fetch: () => { throw Error('桌面版不应调用浏览器请求'); }
    };
    const request = vm.runInNewContext(`(function(){ ${requestSource}; return requestWorkbenchAgent; })()`, context);
    await request(context.state.projects[0]);
    const messages = context.state.projects[0].conversation;
    assert.equal(messages.length, 2);
    assert.equal(messages[1].role, 'assistant');
    assert.match(messages[1].text, mode === 'success' ? /已了解目标/ : /模型测试错误/);
    if (mode === 'success') {
      assert.deepEqual(Array.from(messages[1].options), ['整体结构', '更新节奏']);
      assert.equal(messages[1].recommendedOption, 1);
    }
    assert.equal(pendingWorkbenchProjects.size, 0);
  });
}

test('模型失败后重试沿用原答复，不重复写入用户消息或内部错误状态', async () => {
  const project = { id: 'task-retry', conversation: [
    { id: 'goal', role: 'user', text: '整理周报' },
    { id: 'question', role: 'assistant', text: '先看哪个团队？', question: '先看哪个团队？', options: ['产品', '研发'], resolved: true },
    { id: 'answer', role: 'user', text: '研发', replyToMessageId: 'question', selectedOptionIndex: 1 }
  ] };
  const requests = [];
  let attempt = 0;
  let messageId = 0;
  const context = {
    state: { projects: [project] }, pendingWorkbenchProjects: new Set(), queuedWorkbenchProjects: new Set(),
    renderWorkbench() { context.state = structuredClone(context.state); },
    persist() { context.state = structuredClone(context.state); },
    activeProjectId: project.id, serviceConfigReady: true,
    serviceConfig: { model: { configured: true } },
    desktopApi: { async requestModel({ messages }) {
      requests.push(messages);
      if (attempt++ === 0) throw Error('临时连接错误');
      return { text: '{"reply":"重试成功"}' };
    } },
    workbenchDialogue: require('../prototype/workbench-dialogue.js'),
    crypto: { randomUUID: () => `response-${++messageId}` },
    fetch: () => { throw Error('桌面版不应调用浏览器请求'); }
  };
  const request = vm.runInNewContext(`(function(){ ${requestSource}; return requestWorkbenchAgent; })()`, context);

  await request(context.state.projects[0]);
  assert.equal(context.state.projects[0].conversation.at(-1).retryable, true);
  await request(context.state.projects[0]);

  const conversation = context.state.projects[0].conversation;
  assert.equal(conversation.filter(message => message.role === 'user' && message.text === '研发').length, 1);
  assert.equal(conversation.at(-1).text, '重试成功');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].filter(message => message.role === 'user').length, 2);
  assert.equal(requests[1].some(message => message.content.includes('临时连接错误')), false);
});

test('首页添加资料保留未发送草稿，保存重试不重复导入或请求模型', async () => {
  const input = { value: '  检查方案结构  \n' };
  const status = {
    hidden: true,
    children: [],
    replaceChildren(...children) {
      this.children.forEach(child => { if (child && typeof child === 'object') child.isConnected = false; });
      this.children = children;
    },
    append(...children) { this.children.push(...children); }
  };
  const calls = { chooseFile: 0, chooseFileTaskId: '', persist: 0, render: 0, request: 0 };
  const context = {
    state: { projects: [] },
    activeView: 'home',
    methodCardsApi: null,
    workbenchSessionLayouts: new Map(),
    homeWorkbenchLayout: { mode: 'preview', ratio: 0.6, lastSide: 'preview' },
    document: {
      getElementById(id) { return id === 'idea' ? input : status; },
      querySelectorAll() { return []; },
      querySelector(selector) {
        return selector === '[data-retry-home-import]'
          ? status.children.find(child => child?.dataset?.retryHomeImport === 'true') || null
          : null;
      },
      createElement() { return { dataset: {}, isConnected: true }; },
      createTextNode(text) { return { textContent: text, isConnected: true }; }
    },
    desktopApi: { pptFeedback: { async chooseFile(taskId) {
      calls.chooseFile++;
      calls.chooseFileTaskId = taskId;
      return { attachment: { id: 'attachment-1', displayName: '方案.pdf', kind: 'pdf' } };
    } } },
    crypto: { randomUUID: () => 'task-import-1' },
    selectDomain() {},
    getMethodCard: () => ({ id: 'generic', temporary: false, guidance: '' }),
    buildGoalPrompt: () => 'goal prompt',
    withReferenceUseRule: value => value,
    persist() { calls.persist++; return calls.persist > 1; },
    renderProject() { calls.render++; },
    renderRecent() {},
    refreshWorkbenchMaterials: async () => {},
    requestWorkbenchAgent() { calls.request++; }
  };
  const beginImport = vm.runInNewContext(`(function(){ ${homeImportSource}; return beginHomeMaterialImport; })()`, context);

  await beginImport();
  assert.equal(context.state.projects.length, 0);
  assert.equal(status.hidden, false);
  assert.equal(calls.request, 0);

  await beginImport();
  const project = context.state.projects[0];
  assert.equal(calls.chooseFile, 1);
  assert.equal(project.id, calls.chooseFileTaskId);
  assert.equal(project.title, '方案.pdf');
  assert.equal(project.idea, '');
  assert.deepEqual(Array.from(project.conversation), []);
  assert.equal(project.conversationDraft, input.value);
  assert.equal(calls.request, 0);
  assert.equal(calls.render, 1);
  assert.equal(status.hidden, true);
});

function submissionFixture({ persistResult = true, project, inputText = '' } = {}) {
  const initialProject = project || {
    id: 'task-submit', idea: '整理周报', conversation: [{ id: 'question-1', role: 'assistant',
      question: '先選哪一項？', options: ['甲', '乙'], recommendedOption: 1, optional: true }], conversationDraft: ''
  };
  const input = { value: inputText };
  const title = { textContent: '' };
  const calls = { persist: 0, render: 0, request: 0 };
  const pendingWorkbenchProjects = new Set();
  const context = {
    state: { projects: [initialProject] }, activeProjectId: initialProject.id,
    pendingWorkbenchProjects, workbenchDraftSaveTimer: null,
    document: { getElementById: id => id === 'workbench-message-input' ? input : id === 'project-title' ? title : null },
    structuredClone, crypto: { randomUUID: () => `user-${calls.persist + 1}` }, clearTimeout() {},
    getActiveProject() { return context.state.projects.find(item => item.id === context.activeProjectId); },
    getWorkbenchPendingQuestion(current) {
      const latest = [...(current.conversation || [])].reverse().find(message => message?.role === 'assistant' && !message.kind);
      return latest && !latest.resolved && (latest.question || latest.recommendation || latest.options?.length) ? latest : null;
    },
    persist() {
      calls.persist++;
      if (!persistResult) return false;
      context.state = structuredClone(context.state);
      return true;
    },
    renderWorkbench() { calls.render++; },
    requestWorkbenchAgent(current) { calls.request++; pendingWorkbenchProjects.add(current.id); },
    workbenchDialogue: require('../prototype/workbench-dialogue.js')
  };
  vm.createContext(context);
  const submit = vm.runInContext(`(function(){ ${submitSource}; return submitWorkbenchReply; })()`, context);
  return { context, submit, input, title, calls, pendingWorkbenchProjects };
}

test('动态选项仅提交一次并保留未发送的输入草稿', async () => {
  const f = submissionFixture({ inputText: '还没发送的补充' });
  assert.equal(await f.submit('', { messageId: 'question-1', optionIndex: 1 }), true);
  assert.equal(await f.submit('', { messageId: 'question-1', optionIndex: 0 }), false);
  const conversation = f.context.state.projects[0].conversation;
  assert.deepEqual(Array.from(conversation.at(-1).text), Array.from('乙'));
  assert.equal(conversation.at(-1).replyToMessageId, 'question-1');
  assert.equal(conversation.at(-1).selectedOptionIndex, 1);
  assert.equal(f.context.state.projects[0].conversationDraft, '还没发送的补充');
  assert.equal(f.input.value, '还没发送的补充');
  assert.equal(f.calls.request, 1);
});

test('资料先行任务以首次真实输入建目标，保存失败时不请求模型', async () => {
  const project = { id: 'task-file', title: '方案.pdf', idea: '', conversation: [], conversationDraft: '' };
  const success = submissionFixture({ project: structuredClone(project), inputText: '检查方案结构' });
  assert.equal(await success.submit(success.input.value, { fromComposer: true }), true);
  assert.equal(success.context.state.projects[0].idea, '检查方案结构');
  assert.equal(success.context.state.projects[0].conversation[0].text, '检查方案结构');
  assert.equal(success.context.state.projects[0].title, '检查方案结构');
  assert.equal(success.calls.request, 1);

  const failure = submissionFixture({ persistResult: false, project: structuredClone(project), inputText: '检查方案结构' });
  assert.equal(await failure.submit(failure.input.value, { fromComposer: true }), false);
  assert.equal(failure.context.state.projects[0].idea, '');
  assert.deepEqual(Array.from(failure.context.state.projects[0].conversation), []);
  assert.equal(failure.input.value, '检查方案结构');
  assert.equal(failure.calls.request, 0);
});

test('跳过只接受当前可选问题，过期问题不写入对话', async () => {
  const f = submissionFixture();
  assert.equal(await f.submit('', { messageId: 'stale-question', optionIndex: 0 }), false);
  assert.equal(f.calls.persist, 0);
  assert.equal(await f.submit('', { messageId: 'question-1', skip: true }), true);
  const answer = f.context.state.projects[0].conversation.at(-1);
  assert.equal(answer.skipped, true);
  assert.equal(answer.replyToMessageId, 'question-1');
  assert.equal(f.calls.request, 1);
});

test('工作区备份往返保留对话选项和已访问的预览标签', () => {
  const file = path.join(__dirname, '../prototype/workspace-backup.js');
  const scope = { module: { exports: {} }, require: createRequire(file) };
  vm.runInNewContext(fs.readFileSync(process.env.WORKBENCH_BACKUP_SOURCE || file, 'utf8'), scope);
  const { createBackup, replaceState } = scope.module.exports;
  const project = { id: 'task-backup', workbenchVisitedPreviewModes: ['task', 'prompt'], conversation: [
    { id: 'q1', role: 'assistant', text: '选一个', question: '先看哪项？', options: ['甲', '乙'], recommendedOption: 1, optional: true },
    { id: 'a1', role: 'user', text: '本轮先跳过这个问题', skipped: true, replyToMessageId: 'q1' },
    { id: 'e1', role: 'assistant', kind: 'agent-status', retryable: true, text: '模型请求失败' }
  ] };
  const restored = replaceState({}, JSON.parse(JSON.stringify(createBackup({ projects: [project] }))));
  assert.deepEqual(Array.from(restored.projects[0].workbenchVisitedPreviewModes), ['task', 'prompt']);
  assert.deepEqual(Array.from(restored.projects[0].conversation[0].options), ['甲', '乙']);
  assert.equal(restored.projects[0].conversation[0].recommendedOption, 1);
  assert.equal(restored.projects[0].conversation[0].optional, true);
  assert.equal(restored.projects[0].conversation[1].skipped, true);
  assert.equal(restored.projects[0].conversation[1].replyToMessageId, 'q1');
  assert.equal(restored.projects[0].conversation[2].retryable, true);
});

