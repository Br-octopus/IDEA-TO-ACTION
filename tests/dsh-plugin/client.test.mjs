import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const clientPath = new URL('../../dsh-plugin/forward-step-dsh/client.js', import.meta.url);
const panelId = 'forward-step-dsh';
const success = value => ({ ok: true, value });

async function loadClient() {
  const source = await readFile(clientPath, 'utf8');
  let registration;
  const state = [];
  let stateIndex = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initialValue) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initialValue;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
  };
  let nextTimerId = 0;
  const timers = new Map();
  const context = vm.createContext({
    window: { __ModuleLoader__: { load(value) { registration = value; } } },
    AbortController,
    crypto: { randomUUID: () => 'test-event-id' },
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      if (delay <= 100) callback();
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context, { filename: 'client.js' });
  assert.ok(registration, 'client entry should register a lazy module factory');
  assert.equal(registration.id, '@local/forward-step-dsh');
  const module = registration.factory(name => {
    assert.equal(name, 'react');
    return React;
  });
  return {
    module,
    state,
    fireTimer(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      if (!entry) throw new Error(`timer ${delay} not found`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
    render(component, props) {
      stateIndex = 0;
      return component(props);
    },
  };
}

function flattenText(node) {
  if (typeof node === 'string') return [node];
  if (!node || typeof node !== 'object') return [];
  return [...(node.children ?? []).flatMap(flattenText)];
}

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const result = findNode(child, predicate);
    if (result) return result;
  }
  return undefined;
}

function makeContext(remote) {
  const injectedSlots = [];
  const registrations = [];
  const cleanupFactories = [];
  const ctx = {
    remote: {
      async $mount(descriptor) {
        ctx.mountedDescriptor = descriptor;
        return async () => { ctx.unmounted = true; };
      },
    },
    effect(factory, label) { cleanupFactories.push({ factory, label }); },
    async inject(paths, callback) {
      ctx.injectedRemotePaths = paths;
      await callback({ remote: { forwardStepProbe: remote } });
    },
    slots: {
      inject(name, factory) {
        injectedSlots.push({ name, factory });
        return () => {};
      },
      register(slot, component) {
        registrations.push({ slot, component });
        return () => {};
      },
    },
  };
  return { ctx, injectedSlots, registrations, cleanupFactories };
}

test('client entry 使用 DSH module loader 惰性注册，注入 slots/remote 且无 Node 内置模块依赖', async () => {
  const source = await readFile(clientPath, 'utf8');
  assert.match(source, /window\.__ModuleLoader__\.load/);
  assert.doesNotMatch(source, /node:[\w/.-]+/);
  const { module } = await loadClient();
  assert.deepEqual(Array.from(module.inject), ['slots', 'remote']);
});

test('侧栏 client 挂载生成的 Remote 并注册唯一主面板和 sidebar.panellist 项', async () => {
  const { module, state, render } = await loadClient();
  const remote = {
    async echo(input) { return success({ marker: input.marker, observed: true }); },
    async wait() { return success({ marker: 'unused', observed: true }); },
    async storageWrite(input) { return success({ marker: input.marker, stored: true }); },
    async storageRead() { return success({ marker: 'forward-step-probe', stored: true }); },
    async listTasks() { return success({ projectId: 'project-1', revision: 0, tasks: [{ taskId: 'task-a', title: '任务 A', domain: 'general', entryType: 'advance-idea', originalInput: 'A', currentRequirements: [], versions: [], projectId: 'project-1' }, { taskId: 'task-b', title: '任务 B', domain: 'general', entryType: 'advance-idea', originalInput: 'B', currentRequirements: [], versions: [], projectId: 'project-1' }] }); },
    async getCurrentBinding() { return success({ binding: { taskId: 'task-b' } }); },
    async bindTask() { return success({ binding: {}, revision: 1 }); },
  };
  const { ctx, injectedSlots, registrations } = makeContext(remote);
  await module.apply(ctx);

  assert.ok(ctx.mountedDescriptor, 'Client 应挂载生成的 Remote descriptor');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.injectedRemotePaths)), ['remote.forwardStepProbe']);
  assert.deepEqual(injectedSlots.map(item => item.name), ['main', 'sidebar.panellist']);
  for (const item of injectedSlots) item.factory();
  assert.equal(registrations.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(registrations.map(item => item.slot))), [
    { name: 'main', key: panelId },
    { name: 'sidebar.panellist', id: panelId, order: 80, label: '向前一步' },
  ]);

  const panelElement = registrations[0].component();
  const panel = render(panelElement.type, panelElement.props);
  const text = flattenText(panel).join(' ');
  assert.match(text, /DSH 原生侧栏任务工作区/);
  assert.match(text, /首版生成规划与外部 AI 执行提示词/);
  assert.match(text, /选择提供方/);
  assert.match(text, /选择模型/);

  const projectInput = findNode(panel, node => node.type === 'input' && node.props.placeholder === '例如 D:/work/project');
  projectInput.props.onChange({ target: { value: process.cwd() } });
  const conversationInput = findNode(panel, node => node.type === 'input' && node.props.placeholder === '粘贴当前 DSH 对话 ID');
  conversationInput.props.onChange({ target: { value: 'conversation-b' } });
  const reloadPanel = render(panelElement.type, panelElement.props);
  const loadButton = findNode(reloadPanel, node => node.type === 'button' && flattenText(node).join('') === '读取项目任务');
  await loadButton.props.onClick();
  const afterLoadPanel = render(panelElement.type, panelElement.props);
  assert.equal(findNode(afterLoadPanel, node => node.type === 'select' && node.props.value === 'task-b')?.props.value, 'task-b', '重载项目任务后应按当前对话绑定恢复 B，而不是默认 A');
  assert.match(state[0], /已恢复当前对话任务/);
});

test('Agent / Session 按钮会把有时限的取消信号传给 Host，超时后恢复界面', async () => {
  const { module, state, render, fireTimer } = await loadClient();
  let requestSignal;
  const remote = {
    async echo() { return success({ marker: 'unused', observed: true }); },
    async wait() { return success({ marker: 'unused', observed: true }); },
    async storageWrite() { return success({ marker: 'unused', stored: true }); },
    async storageRead() { return success({ marker: 'unused', stored: true }); },
    async agentIsolation(signal) {
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  };
  const { ctx, injectedSlots, registrations } = makeContext(remote);
  await module.apply(ctx);
  injectedSlots[0].factory();
  const panelElement = registrations[0].component();
  const panel = render(panelElement.type, panelElement.props);
  const button = findNode(panel, node => node.type === 'button' && flattenText(node).join('').includes('Agent / Session'));

  const pending = button.props.onClick();
  assert.equal(requestSignal.aborted, false);
  assert.equal(state[1], true);
  fireTimer(45000);
  await pending;
  assert.equal(requestSignal.aborted, true);
  assert.match(state[0], /Agent \/ Session 隔离探针失败：Agent \/ Session probe timed out/);
  assert.equal(state[1], false);
});

test('RPC、存储读写和取消按钮使用生成的 Remote，释放 effect 时卸载 Remote', async () => {
  const { module, state, render } = await loadClient();
  const calls = [];
  const remote = {
    async echo(input) { calls.push(['echo', input]); return { marker: input.marker, observed: true }; },
    async wait(input, signal) { calls.push(['wait', input, signal]); return { ok: true }; },
    async storageWrite(input) { calls.push(['storageWrite', input]); return success({ marker: input.marker, stored: true }); },
    async storageRead() { calls.push(['storageRead']); return success({ marker: 'forward-step-probe', stored: true }); },
  };
  const { ctx, injectedSlots, registrations, cleanupFactories } = makeContext(remote);
  await module.apply(ctx);
  injectedSlots[0].factory();
  const panelElement = registrations[0].component();
  const panel = render(panelElement.type, panelElement.props);

  const rpcButton = findNode(panel, node => node.type === 'button' && flattenText(node).join('').includes('RPC'));
  await rpcButton.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['echo', { marker: 'dsh-sidebar-probe' }]);
  assert.equal(state[0], '{"marker":"dsh-sidebar-probe","observed":true}');

  const writeButton = findNode(panel, node => node.type === 'button' && flattenText(node).join('').includes('写入持久化探针'));
  await writeButton.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), ['storageWrite', { marker: 'forward-step-probe' }]);
  assert.match(state[0], /写入结果/);

  const readButton = findNode(panel, node => node.type === 'button' && flattenText(node).join('').includes('读取持久化探针'));
  await readButton.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2])), ['storageRead']);
  assert.match(state[0], /读取结果/);

  const cancelButton = findNode(panel, node => node.type === 'button' && flattenText(node).join('').includes('验证 Host / Client 取消'));
  await cancelButton.props.onClick();
  assert.equal(calls[3][0], 'wait');
  assert.equal(calls[3][2].aborted, true);
  assert.equal(state[0], '取消探针未取消');

  assert.equal(cleanupFactories.length, 1);
  assert.match(cleanupFactories[0].label, /remote contribution/);
  await cleanupFactories[0].factory()();
  assert.equal(ctx.unmounted, true);
});


test('未绑定的新对话读取任务时不自动继承或绑定最近任务', async () => {
  const { module, state, render } = await loadClient();
  const boundCalls = [];
  const remote = {
    async echo() { return { marker: 'unused', observed: true }; },
    async wait() { return { ok: true }; },
    async storageWrite(input) { return success({ marker: input.marker, stored: true }); },
    async storageRead() { return { marker: 'unused', stored: true }; },
    async listTasks() { return success({ projectId: 'project-1', revision: 3, tasks: [{ taskId: 'task-a', title: '旧任务 A', domain: 'general' }, { taskId: 'task-b', title: '旧任务 B', domain: 'general' }] }); },
    async getCurrentBinding() { return success({ binding: null }); },
    async bindTask(input) { boundCalls.push(input); return success({ binding: {}, revision: 4 }); },
  };
  const { ctx, injectedSlots, registrations } = makeContext(remote);
  await module.apply(ctx);
  injectedSlots[0].factory();
  const panelElement = registrations[0].component();
  const panel = render(panelElement.type, panelElement.props);
  const projectInput = findNode(panel, node => node.type === 'input' && node.props.placeholder === '例如 D:/work/project');
  projectInput.props.onChange({ target: { value: process.cwd() } });
  const conversationInput = findNode(panel, node => node.type === 'input' && node.props.placeholder === '粘贴当前 DSH 对话 ID');
  conversationInput.props.onChange({ target: { value: 'new-conversation' } });
  const readyPanel = render(panelElement.type, panelElement.props);
  const loadButton = findNode(readyPanel, node => node.type === 'button' && flattenText(node).join('') === '读取项目任务');
  await loadButton.props.onClick();

  assert.equal(state[0], '已读取 2 个任务；修订 3');
  assert.equal(state[5].length, 2, 'Remote 成功信封的 value.tasks 应被保存为任务列表');
  assert.equal(state[6], '', '没有历史绑定的新对话应保持未选任务');
  assert.deepEqual(boundCalls, [], '读取任务列表不能隐式创建绑定');
});




test('侧栏重命名与删除前预览使用当前任务修订和幂等事件标识', async () => {
  const { module, render } = await loadClient()
  const task = { taskId: 'task-managed', revision: 4, title: '管理任务', domain: 'general', entryType: 'advance-idea', originalInput: '原始内容', archived: false, currentRequirements: [], versions: [], projectId: 'project-managed' }
  const calls = []
  const remote = {
    async echo() { return success({ marker: 'unused', observed: true }) },
    async wait() { return success({ marker: 'unused', observed: true }) },
    async storageWrite() { return success({ marker: 'unused', stored: true }) },
    async storageRead() { return success({ marker: 'unused', stored: true }) },
    async listTasks() { return success({ projectId: task.projectId, revision: 1, tasks: [task] }) },
    async getCurrentBinding() { return success({ binding: { taskId: task.taskId } }) },
    async updateTask(input) { calls.push(['updateTask', input]); return success({ task: { ...task, title: input.patch.title, revision: 5 }, revision: 2 }) },
    async previewDeleteTask(input) { calls.push(['previewDeleteTask', input]); return success({ impact: { taskId: task.taskId, title: task.title, bindingCount: 1, versionCount: 2, reviewCount: 0, memoryCount: 0, sourceCount: 0 } }) },
    async deleteTask(input) { calls.push(['deleteTask', input]); return success({ deleted: true, taskId: task.taskId, revision: 3 }) },
  }
  const { ctx, injectedSlots, registrations } = makeContext(remote)
  await module.apply(ctx)
  injectedSlots[0].factory()
  const component = registrations[0].component()
  const getPanel = () => render(component.type, component.props)
  let panel = getPanel()
  findNode(panel, node => node.type === 'input' && node.props.placeholder === '例如 D:/work/project').props.onChange({ target: { value: process.cwd() } })
  findNode(panel, node => node.type === 'input' && node.props.placeholder === '粘贴当前 DSH 对话 ID').props.onChange({ target: { value: 'conversation-managed' } })
  panel = getPanel()
  await findNode(panel, node => node.type === 'button' && flattenText(node).join('') === '读取项目任务').props.onClick()
  panel = getPanel()
  findNode(panel, node => node.type === 'input' && node.props.value === '管理任务').props.onChange({ target: { value: '已重命名' } })
  panel = getPanel()
  await findNode(panel, node => node.type === 'button' && flattenText(node).join('') === '保存名称').props.onClick()
  assert.equal(calls[0][0], 'updateTask')
  assert.equal(calls[0][1].taskRevision, 4)
  assert.equal(calls[0][1].patch.title, '已重命名')
  assert.equal(calls[0][1].eventId, 'test-event-id')
  panel = getPanel()
  await findNode(panel, node => node.type === 'button' && flattenText(node).join('') === '删除任务…').props.onClick()
  assert.equal(calls[1][0], 'previewDeleteTask')
  panel = getPanel()
  assert.match(flattenText(panel).join(' '), /将移除 1 个绑定、2 个版本/)
  await findNode(panel, node => node.type === 'button' && flattenText(node).join('') === '确认删除').props.onClick()
  assert.equal(calls[2][0], 'deleteTask')
  assert.equal(calls[2][1].confirmed, true)
  assert.equal(calls[2][1].eventId, 'test-event-id')
})
test('侧栏粘贴外部结果并关联步骤/提示词版本，保存失败保留草稿', async () => {
  const { module, render } = await loadClient()
  const projectId = 'project-external-result'
  const task = {
    taskId: 'task-external-result', revision: 5, title: '结果回填', domain: 'writing', entryType: 'advance-idea',
    originalInput: '保留任务原文', currentRequirements: [], projectId,
    agent: { steps: [{ id: 'step-body', title: '正文步骤' }] },
    versions: [{ versionId: 'prompt-v1', stage: 'step-prompt', content: '外部执行提示词', createdAt: '2026-11-03T00:00:00.000Z' }],
  }
  const calls = []
  let shouldFail = true
  const remote = {
    async echo() { return success({ marker: 'unused', observed: true }) },
    async wait() { return success({ marker: 'unused', observed: true }) },
    async storageWrite() { return success({ marker: 'unused', stored: true }) },
    async storageRead() { return success({ marker: 'unused', stored: true }) },
    async listTasks() { return success({ projectId, revision: 6, tasks: [task] }) },
    async getCurrentBinding() { return success({ binding: { taskId: task.taskId } }) },
    async saveExternalResult(input) {
      calls.push(input)
      if (shouldFail) throw Object.assign(new Error('临时存储错误'), { code: 'storage_failure' })
      const version = { versionId: 'external-v1', eventId: input.eventId, kind: 'external-result', stage: 'external-result', stepId: input.stepId, promptVersionId: input.promptVersionId, content: input.content, feedback: input.feedback, createdAt: '2026-11-03T00:01:00.000Z' }
      return success({ task: { ...task, revision: 6, versions: [...task.versions, version] }, version, revision: 7 })
    },
  }
  const { ctx, injectedSlots, registrations } = makeContext(remote)
  await module.apply(ctx)
  injectedSlots[0].factory()
  const component = registrations[0].component()
  const getPanel = () => render(component.type, component.props)
  let panel = getPanel()
  findNode(panel, node => node.type === 'input' && node.props.placeholder === '例如 D:/work/project').props.onChange({ target: { value: process.cwd() } })
  findNode(panel, node => node.type === 'input' && node.props.placeholder === '粘贴当前 DSH 对话 ID').props.onChange({ target: { value: 'conversation-external-result' } })
  panel = getPanel()
  await findNode(panel, node => node.type === 'button' && flattenText(node).join('') === '读取项目任务').props.onClick()
  panel = getPanel()
  findNode(panel, node => node.type === 'textarea' && node.props['aria-label'] === '外部 AI 结果').props.onChange({ target: { value: '外部生成的正文内容' } })
  panel = getPanel()
  findNode(panel, node => node.type === 'textarea' && node.props['aria-label'] === '复盘反馈').props.onChange({ target: { value: '补充一个真实案例' } })
  panel = getPanel()
  await findNode(panel, node => node.type === 'button' && flattenText(node).join('') === '保存外部结果').props.onClick()
  panel = getPanel()
  assert.equal(findNode(panel, node => node.type === 'textarea' && node.props['aria-label'] === '外部 AI 结果').props.value, '外部生成的正文内容')
  assert.match(flattenText(panel).join(' '), /输入仍保留/)

  shouldFail = false
  await findNode(panel, node => node.type === 'button' && flattenText(node).join('') === '保存外部结果').props.onClick()
  assert.equal(calls.length, 2)
  assert.equal(calls[1].taskRevision, 5)
  assert.equal(calls[1].stepId, 'step-body')
  assert.equal(calls[1].promptVersionId, 'prompt-v1')
  assert.equal(calls[1].content, '外部生成的正文内容')
  assert.equal(calls[1].feedback, '补充一个真实案例')
  assert.equal(calls[1].eventId, 'test-event-id')
  panel = getPanel()
  assert.equal(findNode(panel, node => node.type === 'textarea' && node.props['aria-label'] === '外部 AI 结果').props.value, '')
  assert.match(flattenText(panel).join(' '), /外部结果已保存/)
})
