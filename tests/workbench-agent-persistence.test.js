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
const legacyStart = source.indexOf('  function legacyWorkbenchRecordTitle(');
const legacyEnd = source.indexOf('  function renderWorkbenchContentCatalog(', legacyStart);
assert.ok(legacyStart >= 0 && legacyEnd > legacyStart);
const legacySource = source.slice(legacyStart, legacyEnd);
const submitStart = source.indexOf('  async function submitWorkbenchReply(');
const submitEnd = source.indexOf('  document.getElementById("workbench-messages").addEventListener("click"', submitStart);
assert.ok(submitStart >= 0 && submitEnd > submitStart);
const submitSource = source.slice(submitStart, submitEnd);
const homeImportStart = source.indexOf('  let pendingHomeImport = null;');
const homeImportEnd = source.indexOf('  const ideaForm =', homeImportStart);
assert.ok(homeImportStart >= 0 && homeImportEnd > homeImportStart);
const homeImportSource = source.slice(homeImportStart, homeImportEnd);
const restoreStart = source.indexOf('  async function restoreWorkbenchManifests() {');
const restoreEnd = source.indexOf('  function getWorkbenchSessionLayout(', restoreStart);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
const restoreSource = source.slice(restoreStart, restoreEnd);
const writingHelpersStart = source.indexOf('  function getWorkbenchPromptGoal(');
const writingHelpersEnd = source.indexOf('  function getWorkbenchUnifiedPrompt(', writingHelpersStart);
assert.ok(writingHelpersStart >= 0 && writingHelpersEnd > writingHelpersStart);
const writingHelpersSource = source.slice(writingHelpersStart, writingHelpersEnd);
const attachmentHelpersStart = source.indexOf('  function getWorkbenchPromptDeliveries(');
const attachmentHelpersEnd = source.indexOf('  function findWorkbenchAttachmentVersion(', attachmentHelpersStart);
assert.ok(attachmentHelpersStart >= 0 && attachmentHelpersEnd > attachmentHelpersStart);
const attachmentHelpersSource = source.slice(attachmentHelpersStart, attachmentHelpersEnd);

test('首次学术论文任务进入写作规则并按目标选择任务类型', () => {
  const state = { promptAgentTasks: [], writingArticles: [], writingPacks: [], writingPackSettings: [] };
  const context = {
    state,
    methodCardsApi: require('../prototype/method-cards.js'),
    window: { WritingWorkbenchSchema: require('../prototype/writing-workbench-schema.js') }
  };
  const helpers = vm.runInNewContext(`(function(){ ${writingHelpersSource}; return {
    getWorkbenchPromptRoute, getWorkbenchWritingPromptInput, getWorkbenchWritingTaskType, getWorkbenchWritingFollowUpRule
  }; })()`, context);
  const planning = { id: 'academic-plan', goalSummary: '为硕士学位论文制定研究计划' };
  const diagnosis = { id: 'academic-review', goalSummary: '诊断这篇论文的结构与论证' };

  assert.equal(helpers.getWorkbenchPromptRoute(planning), 'writing');
  assert.equal(helpers.getWorkbenchWritingPromptInput(planning).article.genre, 'academic-paper');
  assert.equal(helpers.getWorkbenchWritingTaskType(planning, state), 'academic-planning');
  assert.equal(helpers.getWorkbenchWritingTaskType(diagnosis, state), 'diagnosis');
});

test('邮件和周报按新目标选择写作文体与任务类型并结合已有对话追问', () => {
  const state = { writingArticles: [{ id: 'legacy-writing', article: { genre: 'article' },
    rounds: [{ taskType: 'revision' }] }] };
  const context = {
    state,
    methodCardsApi: require('../prototype/method-cards.js'),
    window: { WritingWorkbenchSchema: require('../prototype/writing-workbench-schema.js') }
  };
  const helpers = vm.runInNewContext(`(function(){ ${writingHelpersSource}; return {
    getWorkbenchPromptRoute, getWorkbenchWritingPromptInput, getWorkbenchWritingTaskType, getWorkbenchWritingFollowUpRule
  }; })()`, context);
  const linked = [{ collection: 'writingArticles', sourceId: 'legacy-writing' }];
  const email = { id: 'email-task', goalSummary: '起草一封邮件', workbenchLegacyRefs: linked,
    conversation: [{ role: 'user', text: '收件人是合作方，邀请下周开会' }], workbenchDraft: { opinion: '语气简洁' } };
  const emailInput = helpers.getWorkbenchWritingPromptInput(email);
  assert.equal(helpers.getWorkbenchPromptRoute(email), 'writing');
  assert.equal(emailInput.article.genre, 'email', '新目标应覆盖旧文章文体');
  assert.equal(helpers.getWorkbenchWritingTaskType(email, state), 'email-draft', '旧轮次类型不能覆盖邮件起草');
  assert.match(emailInput.round.feedback, /收件人是合作方/);
  assert.match(emailInput.round.feedback, /语气简洁/);
  assert.match(helpers.getWorkbenchWritingFollowUpRule('email'), /收件人关系、沟通目的和期望行动/);
  assert.equal(helpers.getWorkbenchWritingTaskType({ ...email, goalSummary: '润色这封邮件' }, state), 'email-revision');
  assert.equal(helpers.getWorkbenchWritingTaskType({ ...email, goalSummary: '审阅这封邮件' }, state), 'email-review');

  const report = { ...email, goalSummary: '根据本周数据写周报' };
  assert.equal(helpers.getWorkbenchPromptRoute(report), 'writing');
  assert.equal(helpers.getWorkbenchWritingPromptInput(report).article.genre, 'business-document');
  assert.equal(helpers.getWorkbenchWritingTaskType(report, state), 'business-report');
  assert.match(helpers.getWorkbenchWritingFollowUpRule('business-document'), /统计周期、目标读者和数据来源/);
});

test('回填优先关联已复制版本；无交付时提示最近准备稿并支持解除关联', () => {
  const context = {
    workbenchSchema: require('../prototype/unified-workbench-schema.js'),
    workbenchContentKind: attachment => attachment.kind || 'file'
  };
  const helpers = vm.runInNewContext(`(function(){ ${attachmentHelpersSource}; return {
    getWorkbenchPromptDeliveries, getWorkbenchPromptDeliverySuggestion, ensureWorkbenchAttachmentContents, updateWorkbenchPromptAssociation
  }; })()`, context);
  const project = { id: 'task-association', workbenchPromptRounds: [
    { id: 'round-1', deliveries: [
      { id: 'prepared-1', status: 'prepared' }, { id: 'copied-1', status: 'copied' },
      { id: 'export-1', status: 'prepared', exportSnapshot: true }
    ] },
    { id: 'round-2', deliveries: [{ id: 'prepared-2', status: 'prepared' }] }
  ] };
  assert.deepEqual(Array.from(helpers.getWorkbenchPromptDeliveries(project), item => item.delivery.id),
    ['prepared-1', 'copied-1', 'prepared-2'], '素材包快照不作为提示词版本');
  assert.equal(helpers.getWorkbenchPromptDeliverySuggestion(project).delivery.id, 'copied-1',
    '已有复制/交付版本优先于更新的准备稿');

  const preparedOnly = { id: 'task-prepared', workbenchPromptRounds: [
    { id: 'round-1', deliveries: [{ id: 'prepared-1', status: 'prepared' }] },
    { id: 'round-2', deliveries: [{ id: 'prepared-2', status: 'prepared' }] }
  ] };
  assert.equal(helpers.getWorkbenchPromptDeliverySuggestion(preparedOnly).delivery.id, 'prepared-2');
  assert.equal(helpers.ensureWorkbenchAttachmentContents(preparedOnly, [
    { id: 'attachment-1', displayName: '回填稿.txt', kind: 'text', sha256: 'sha256:1' }
  ]), true);
  const content = preparedOnly.workbenchContents[0];
  const version = content.versions[0];
  assert.equal(content.purpose, 'result');
  assert.match(content.purposeReason, /尚未记录交付/);
  assert.deepEqual([version.roundId, version.deliveryId], ['round-2', 'prepared-2']);

  assert.equal(helpers.updateWorkbenchPromptAssociation(preparedOnly, version.id, '1'), true);
  assert.deepEqual([version.roundId, version.deliveryId], ['round-1', 'prepared-1']);
  assert.equal(helpers.updateWorkbenchPromptAssociation(preparedOnly, version.id, ''), true);
  assert.equal(version.roundId, undefined, '选择独立保存会解除轮次关联');
  assert.equal(version.deliveryId, undefined);

  const independent = { id: 'task-independent' };
  helpers.ensureWorkbenchAttachmentContents(independent, [
    { id: 'attachment-2', displayName: '参考资料.txt', kind: 'text', sha256: 'sha256:2' }
  ]);
  assert.equal(independent.workbenchContents[0].purpose, 'reference');
  assert.equal(independent.workbenchContents[0].versions[0].roundId, undefined);
  assert.match(source, /data-workbench-prompt-association/);
});

test('用户显式导入历史 Agent 和写作记录时建立来源快照并按来源去重', () => {
  const agent = { id: 'agent-old', type: 'advance-idea', goal: '整理项目计划', steps: [{ title: '拆分步骤', deliverable: '步骤清单' }] };
  const writing = { id: 'writing-old', article: { title: '旧文章', genre: 'article', draft: '已保存正文' },
    rounds: [{ id: 'round-old', taskType: 'revision', userFeedback: '保留原意', draft: '上一轮正文' }] };
  const state = { promptAgentTasks: [agent], writingArticles: [writing] };
  const original = structuredClone(state);
  const project = { id: 'unified-task', idea: '继续整理' };
  const opened = [];
  const toasts = [];
  let id = 0;
  let saves = 0;
  const context = {
    state, project, workbenchSchema: require('../prototype/unified-workbench-schema.js'), structuredClone,
    workbenchId: prefix => `${prefix}-${++id}`, openWorkbenchDocument: (_project, content) => opened.push(content.id),
    persist: () => { saves++; return true; }, renderWorkbench() {}, toast: message => toasts.push(message)
  };
  vm.runInNewContext(`${legacySource}\nimportWorkbenchLegacyRecord(project, 'promptAgentTasks', 'agent-old');\nimportWorkbenchLegacyRecord(project, 'writingArticles', 'writing-old');\nimportWorkbenchLegacyRecord(project, 'promptAgentTasks', 'agent-old');`, context);

  assert.equal(project.workbenchContents.length, 2);
  assert.deepEqual(Array.from(project.workbenchLegacyRefs, item => [item.collection, item.sourceId]), [
    ['promptAgentTasks', 'agent-old'], ['writingArticles', 'writing-old']
  ]);
  assert.match(project.workbenchContents[0].versions[0].text, /拆分步骤/);
  assert.match(project.workbenchContents[1].versions[0].text, /已保存正文/);
  assert.deepEqual(state, original, '原始历史集合保持不变');
  assert.equal(saves, 2, '重复选择已有来源不会再次创建副本');
  assert.equal(opened.length, 1, '重复选择会打开已关联快照');
  assert.equal(toasts.length, 3);
});

test('社媒报告交接会保存为统一任务内容并选入当前提示词', async () => {
  const start = source.indexOf('  async function handoffSocialResearchToWorkbench(');
  const end = source.indexOf('  async function beginHomeMaterialImport(', start);
  assert.ok(start >= 0 && end > start);
  const handoffSource = source.slice(start, end);
  const project = { id: 'unified-social-task' };
  let createdIdea = '';
  let persisted = 0;
  let rendered = 0;
  const context = {
    createProjectFromIdea: async idea => { createdIdea = idea; return project; },
    ensureWorkbenchProjectData(value) {
      value.workbenchContents ||= [];
      value.workbenchSelection ||= { items: [], layoutIntent: { enabled: false } };
      value.workbenchDraft ||= { goal: '', opinion: '', promptText: '', annotations: [] };
    },
    createWorkbenchTextSnapshot: input => ({
      ...input, id: 'content-1', draft: { text: input.text, baseVersionId: 'version-1' },
      versions: [{ id: 'version-1', text: input.text }]
    }),
    persist: () => { persisted++; return true; },
    renderProject: value => { assert.equal(value, project); rendered++; },
    toast() {}
  };
  const handoff = vm.runInNewContext(`(function(){ ${handoffSource}; return handoffSocialResearchToWorkbench; })()`, context);
  const result = await handoff({ topic: '分析订阅退款原因', summary: '首月退款增加。', sourceTaskId: 'research-1' });

  assert.equal(result, project);
  assert.equal(createdIdea, '基于社媒研究结果继续：分析订阅退款原因');
  assert.equal(project.workbenchContents[0].draft.text, '首月退款增加。');
  assert.equal(project.workbenchContents[0].sourceRef.sourceId, 'research-1');
  assert.equal(JSON.stringify(project.workbenchSelection.items), JSON.stringify([{ contentVersionId: 'version-1' }]));
  assert.equal(project.workbenchOpenContentId, 'content-1');
  assert.equal(project.workbenchPreviewMode, 'material');
  assert.equal(persisted, 1);
  assert.equal(rendered, 1);
});

test('桌面启动时恢复未进入本地索引的工作台任务', async () => {
  const project = { id: 'task-restored', title: '恢复任务', workbenchPersistenceEnabled: true, workbenchDraft: { goal: '继续整理' } };
  const context = {
    state: { projects: [] }, localStorage: {}, recentRenders: 0, toasts: [],
    desktopApi: { workbench: { listManifests: async () => ({
      manifests: [{ taskId: project.id, revision: 4, project }], errors: []
    }) } },
    migrateState: value => ({ projects: value.projects.map(item => ({ ...item })) }),
    workbenchManifestRevisions: new Map(), workbenchManifestSignatures: new Map(),
    isUnifiedWorkbenchProject: item => item.workbenchPersistenceEnabled === true,
    getWorkbenchManifestSignature: item => JSON.stringify(item),
    prepareWorkbenchManifestState: value => ({ state: value, signatures: [] }),
    saveState: (_storage, value) => { context.state = value; return value; },
    scheduleWorkbenchManifestSave: () => assert.fail('已恢复的 manifest 不应立即重复保存'),
    toast: message => context.toasts.push(message),
    renderRecent: () => { context.recentRenders++; },
    getActiveProject: () => context.state.projects[0],
    renderWorkbench: item => { context.renderedProject = item; }
  };
  const restore = vm.runInNewContext(`(function(){ ${restoreSource}; return restoreWorkbenchManifests; })()`, context);
  await restore();

  assert.equal(context.state.projects[0].id, project.id);
  assert.equal(context.state.projects[0].workbenchRevision, 4);
  assert.equal(context.state.projects[0].workbenchDraft.goal, '继续整理');
  assert.equal(context.state.projects[0].workbenchDraftStatus, 'saved');
  assert.equal(context.recentRenders, 1);
  assert.equal(context.renderedProject.id, project.id);
  const bootStart = source.indexOf('  renderCaseProjectOptions();');
  const bootEnd = source.indexOf('  const academicLiteratureRoot', bootStart);
  assert.ok(bootStart >= 0 && bootEnd > bootStart);
  assert.ok(source.slice(bootStart, bootEnd).includes('void restoreWorkbenchManifests()'));
});

for (const mode of ['success', 'failure']) {
  test(`工作台异步模型${mode === 'success' ? '成功' : '失败'}回复写入保存后的当前任务`, async () => {
    const initialState = { projects: [{ id: 'task-1', conversation: [{ role: 'user', text: '每周进度回顾' }] }] };
    const pendingWorkbenchProjects = new Set();
    const queuedWorkbenchProjects = new Set();
    const modelRequests = [];
    const context = {
      state: initialState, pendingWorkbenchProjects, queuedWorkbenchProjects,
      renderWorkbench: () => { context.state = structuredClone(context.state); },
      persist: () => { context.state = structuredClone(context.state); }, activeProjectId: 'task-1', serviceConfigReady: true,
      serviceConfig: { model: { configured: true } },
      desktopApi: { requestModel: async ({ messages }) => {
        modelRequests.push(messages);
        if (mode === 'failure') throw Error('模型测试错误');
        return { text: '{"reply":"已了解目标","recommendation":{"text":"周五回顾","reason":"容易执行"},"question":"先统一哪一部分？","options":["整体结构","更新节奏"],"recommendedOption":1}' };
      } },
      window: { ForwardStepPromptAgentPrompts: require('../prototype/prompt-agent-prompts.js') },
      getWorkbenchPromptAgentTask: project => ({ id: project.id, type: 'advance-idea', goal: project.conversation[0].text }),
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
    assert.match(modelRequests[0][0].content, /当前阶段任务摘要/);
    assert.match(modelRequests[0][0].content, /每周进度回顾/);
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
    window: { ForwardStepPromptAgentPrompts: require('../prototype/prompt-agent-prompts.js') },
    getWorkbenchPromptAgentTask: current => ({ id: current.id, type: 'advance-idea', goal: current.conversation[0].text }),
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
    persistenceBlocked: false,
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
  const beginImport = vm.runInNewContext(`(function(){ let homeWorkbenchGoalDraftId = ""; ${homeImportSource}; return beginHomeMaterialImport; })()`, context);

  await beginImport();
  assert.equal(context.state.projects.length, 0);
  assert.equal(status.hidden, false);
  assert.equal(calls.request, 0);

  await beginImport();
  const project = context.state.projects[0];
  assert.equal(calls.chooseFile, 1);
  assert.equal(project.id, calls.chooseFileTaskId);
  assert.equal(project.title, input.value.trim());
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

test('桌面 manifest 已写入但本地缓存失败时，重试只补缓存', async () => {
  const start = source.indexOf('  function saveWorkbenchManifest(taskId) {');
  const end = source.indexOf('  function renderWorkbenchSaveStatus(', start);
  assert.ok(start >= 0 && end > start);
  const saveSource = source.slice(start, end);
  const project = { id: 'task-cache-retry', workbenchPersistenceEnabled: true, workbenchRevision: 1, workbenchDraftStatus: 'dirty' };
  const manifestWrites = [];
  let cacheAttempts = 0;
  const context = {
    state: { projects: [project] }, localStorage: {}, activeProjectId: project.id,
    desktopApi: { workbench: { async saveManifest(taskId, manifest) {
      manifestWrites.push({ taskId, revision: manifest.revision });
      return { status: 'ok', revision: manifest.revision };
    } } },
    workbenchManifestTimers: new Map(), workbenchManifestTimerStartedAt: new Map(),
    workbenchManifestQueues: new Map(), workbenchManifestRevisions: new Map([[project.id, 1]]),
    workbenchManifestSignatures: new Map(),
    workbenchManifestCacheRetryRevisions: new Map(),
    isUnifiedWorkbenchProject: item => item?.workbenchPersistenceEnabled === true,
    getWorkbenchManifestSignature(item) {
      const { workbenchRevision, workbenchDraftStatus, workbenchSaveError, ...snapshot } = item;
      return JSON.stringify(snapshot);
    },
    saveState(_storage, value) {
      cacheAttempts += 1;
      if (cacheAttempts === 1) throw new Error('本地缓存写入失败');
      return value;
    },
    renderWorkbenchSaveStatus() {}, toast() {}, clearTimeout, structuredClone
  };
  const save = vm.runInNewContext(`(function(){ ${saveSource}; return saveWorkbenchManifest; })()`, context);

  assert.equal(await save(project.id), false);
  assert.equal(project.workbenchDraftStatus, 'error');
  assert.equal(await save(project.id), true);
  assert.deepEqual(manifestWrites, [{ taskId: project.id, revision: 1 }]);
  assert.equal(cacheAttempts, 2);
  assert.equal(project.workbenchDraftStatus, 'saved');

  project.workbenchRevision = 2;
  project.workbenchDraftStatus = 'dirty';
  assert.equal(await save(project.id), true);
  assert.deepEqual(manifestWrites, [{ taskId: project.id, revision: 1 }, { taskId: project.id, revision: 2 }]);
});

