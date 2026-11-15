const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const path = require('node:path');

const source = fs.readFileSync(process.env.WORKBENCH_APP_SOURCE || path.join(__dirname, '../prototype/app.js'), 'utf8');
const start = source.indexOf('  async function requestWorkbenchAgent(project) {');
const end = source.indexOf('  document.getElementById("workbench-message-input").addEventListener("keydown"', start);
assert.ok(start >= 0 && end > start);
const requestSource = source.slice(start, end);

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
        return { text: '{"reply":"已了解目标","recommendation":{"text":"周五回顾","reason":"容易执行"},"question":null}' };
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
    assert.equal(pendingWorkbenchProjects.size, 0);
  });
}

