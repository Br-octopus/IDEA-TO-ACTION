const test = require('node:test');
const assert = require('node:assert/strict');
const sceneSchema = require('../prototype/ppt-scene-schema.js');
const taskSchema = require('../prototype/prompt-agent-schema.js');
const feedbackSchema = require('../prototype/ppt-feedback-schema.js');
const feedback = require('../prototype/ppt-feedback.js');
const { createPptFeedbackUI } = require('../prototype/ppt-feedback-ui.js');

function fixture({ withApi = true } = {}) {
  const annotation = feedbackSchema.normalizePptAnnotation({
    id: 'a1', taskId: 'fb-task', attachmentId: 'att-1', contentHash: 'h1',
    target: { kind: 'point', x: 0.5, y: 0.5 }, comment: '标题过大', category: 'layout'
  });
  const task = {
    ...taskSchema.createPromptAgentTask({ id: 'fb-task', goal: '测试反馈' }),
    pptScene: sceneSchema.normalizePptScene({ status: 'ready', brief: { idea: '测试反馈' } }),
    pptFeedback: { attachments: [{ id: 'att-1', displayName: 'deck.html', mimeType: 'text/html', version: 'v1', contentHash: 'h1', sourceType: 'html-file', addedAt: '2026-10-20T00:00:00Z' }], annotations: [annotation] }
  };
  const state = { promptAgentTasks: [task] };
  const handlers = {};
  const root = {
    innerHTML: '',
    addEventListener(type, handler) { handlers.click = handler; },
    querySelector(selector) { return selector.includes('a1') ? { value: '修改后的评论' } : null; },
    querySelectorAll() { return []; }
  };
  const calls = [];
  const document = { getElementById: id => id === 'ppt-feedback-root' ? root : null };
  function getTask() { return state.promptAgentTasks.find(item => item.id === 'fb-task'); }
  const api = {
    async chooseFile() { calls.push('choose'); return { attachment: { id: 'att-1' } }; },
    async listAttachments() {
      calls.push('list');
      return { attachments: getTask().pptFeedback.attachments || [] };
    },
    async openPreview(id) { calls.push(['open', id]); return {}; },
    async saveAnnotation(input) {
      // 真实桌面端由主进程写回任务存储，这里模拟同样行为
      calls.push(['save', input.comment]);
      const t = getTask();
      const list = (t.pptFeedback.annotations || []).filter(item => item.id !== input.id);
      t.pptFeedback.annotations = [...list, input];
      return input;
    },
    async deleteAttachment(id) { calls.push(['delete', id]); }
  };
  const windowMock = withApi ? { desktopApi: { pptFeedback: api } } : {};
  const previousWindow = global.window;
  global.window = { ...previousWindow, ...windowMock };
  const controllerPromise = createPptFeedbackUI({
    document, sceneSchema, feedbackSchema, feedback, taskSchema,
    getState: () => state,
    persistState: next => Object.assign(state, next),
    notify: message => calls.push(['notify', message])
  });
  return {
    controllerPromise, handlers, root, state, calls, task, api,
    cleanup() { global.window = previousWindow; }
  };
}

test('无桌面 API 时反馈工作台显示降级说明', async () => {
  const { controllerPromise, root, calls, cleanup } = fixture({ withApi: false });
  await controllerPromise;
  assert.match(root.innerHTML, /只在 Windows 桌面版可用/);
  assert.ok(!calls.some(item => item[0] === 'list'));
  cleanup();
});

test('反馈工作台渲染附件与标注，保存评论走窄接口并写回任务', async () => {
  const { controllerPromise, handlers, root, state, calls, cleanup } = fixture();
  await controllerPromise;
  assert.match(root.innerHTML, /deck\.html/);
  assert.match(root.innerHTML, /标题过大/);
  await handlers.click({ target: { closest: () => ({ dataset: { pptFbSaveAnnotation: 'a1' } }) } });
  assert.ok(calls.some(item => item[0] === 'save' && item[1] === '修改后的评论'));
  const saved = state.promptAgentTasks[0].pptFeedback.annotations.find(item => item.id === 'a1');
  assert.equal(saved.comment, '修改后的评论');
  cleanup();
});

test('新增标注和复制选中反馈走同一套窄接口', async () => {
  const { controllerPromise, handlers, root, calls, cleanup } = fixture();
  await controllerPromise;
  // fixture 创建时已执行一次 listAttachments，清掉初始记录避免误判
  while (calls.length) calls.pop();
  await handlers.click({ target: { closest: () => ({ dataset: { pptFbAction: 'annotate' } }) } });
  assert.ok(calls.some(item => item[0] === 'save' && typeof item[1] === 'string' && item[1].includes('请补充')));
  assert.ok(calls.some(item => item[0] === 'save'), '新增标注后应立即走一次窄接口写回');
  const originalNavigator = global.navigator;
  Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: async text => calls.push(['copy', text.includes('请补充')]) } }, configurable: true });
  await handlers.click({ target: { closest: () => ({ dataset: { pptFbAction: 'copy-context' } }) } });
  assert.ok(calls.some(item => item[0] === 'copy' && item[1] === true));
  assert.match(root.innerHTML, /选中反馈已复制/);
  if (originalNavigator === undefined) delete global.navigator; else Object.defineProperty(global, 'navigator', { value: originalNavigator, configurable: true });
  cleanup();
});
