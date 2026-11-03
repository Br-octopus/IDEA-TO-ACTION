import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { bindTask, createTask } from '../../dsh-plugin/forward-step-dsh/core/tasks.js'
import { cancelAgentRun, runAgent } from '../../dsh-plugin/forward-step-dsh/core/agent.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-agent-'))
  const store = openStore(join(dir, 'state.sqlite'))
  t.after(() => store.close())
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, store }
}

async function create(store, dir, conversationId = 'c1') {
  return createTask(store, { cwd: dir, title: 'Agent 测试', entryType: 'advance-idea', domain: 'general', originalInput: '做一个简易工具', conversationId }, { expectedRevision: store.read().revision, eventId: `create-${conversationId}` })
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('Agent 使用当前任务上下文并将外部结果保存为新版本', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir)
  let captured
  const result = await runAgent({ store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning', projectId: task.projectId, conversationId: 'c1', requestId: 'run-1', generate: async (messages, options) => { captured = { messages, options }; return '外部执行提示词草案' } })
  assert.equal(result.version.content, '外部执行提示词草案')
  assert.equal(result.task.versions.length, 1)
  assert.equal(result.task.revision, task.revision + 1)
  assert.match(JSON.stringify(captured.messages), /做一个简易工具/)
  assert.equal(captured.options.requestId, 'run-1')
  const replay = await runAgent({ store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning', requestId: 'run-1', generate: async () => assert.fail('幂等重放不得再次调用模型') })
  assert.equal(replay.duplicate, true)
})

test('重复 requestId 返回对应历史版本，而非当前任务的最后版本', async t => {
  const { store, dir } = fixture(t)
  const task = await create(store, dir)
  const first = await runAgent({ store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning', requestId: 'repeat-first', generate: async () => '第一版结果' })
  const second = await runAgent({ store, taskId: task.taskId, taskRevision: first.task.revision, stage: 'review', requestId: 'repeat-second', generate: async () => '第二版结果' })
  const replay = await runAgent({ store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning', requestId: 'repeat-first', generate: async () => assert.fail('幂等重放不得再次调用模型') })
  assert.equal(second.version.content, '第二版结果')
  assert.equal(replay.duplicate, true)
  assert.equal(replay.version.versionId, first.version.versionId)
  assert.equal(replay.version.content, '第一版结果')
})

test('Agent 拒绝过期任务修订和已切换对话绑定', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir)
  await assert.rejects(runAgent({ store, taskId: task.taskId, taskRevision: 0, stage: 'planning', generate: async () => '' }), { code: 'conflict' })
  const other = await createTask(store, { cwd: dir, title: '另一任务', entryType: 'advance-idea', domain: 'general', originalInput: '另一目标', conversationId: 'c2' }, { expectedRevision: store.read().revision, eventId: 'create-c2' })
  await bindTask(store, { projectId: task.projectId, taskId: other.taskId, conversationId: 'c1' }, { expectedRevision: store.read().revision, eventId: 'switch-c1' })
  await assert.rejects(runAgent({ store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning', projectId: task.projectId, conversationId: 'c1', generate: async () => '' }), { code: 'conflict' })
})

test('Agent 丢弃生成期间任务变化后的迟到回复', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir)
  const output = deferred()
  const running = runAgent({ store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning', requestId: 'late-run', generate: () => output.promise })
  await new Promise(resolve => setImmediate(resolve))
  const current = store.read()
  const saved = current.tasks.find(item => item.taskId === task.taskId)
  const nextTaskRevision = saved.revision
  const { updateTask } = await import('../../dsh-plugin/forward-step-dsh/core/tasks.js')
  await updateTask(store, { taskId: task.taskId, taskRevision: nextTaskRevision, patch: { title: '并发更新' } }, { expectedRevision: current.revision, eventId: 'concurrent-update' })
  output.resolve('过期输出')
  await assert.rejects(running, { code: 'conflict' })
  assert.equal(store.read().tasks[0].versions.length, 0)
})

test('取消活动 Agent 调用并释放 requestId', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir)
  let startedResolve
  const started = new Promise(resolve => { startedResolve = resolve })
  const running = runAgent({ store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning', requestId: 'cancel-run', generate: async (_messages, { signal }) => new Promise((_resolve, reject) => { startedResolve(); signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }) })
  await started
  assert.equal(cancelAgentRun('cancel-run'), true)
  await assert.rejects(running, { code: 'cancelled' })
  assert.equal(cancelAgentRun('cancel-run'), false)
})



test('Agent 仅注入当前范围内 active 记忆', async t => {
  const { dir, store } = fixture(t);
  const task = await create(store, dir);
  const current = store.read();
  await store.transact(current.revision, 'seed-memories', state => {
    state.sources.push(
      { sourceId: 'source-active', active: true, userAuthored: true },
      { sourceId: 'source-other', active: true, userAuthored: true },
      { sourceId: 'source-candidate', active: true, userAuthored: true },
    );
    state.memories.push(
      { memoryId: 'm-active', revision: 2, key: 'tone', value: '优先简洁表达', scope: 'global', status: 'active', sourceRefs: ['source-active'] },
      { memoryId: 'm-other', revision: 1, key: 'private', value: 'OTHER_PROJECT_SECRET', scope: 'project', projectId: 'different-project', status: 'active', sourceRefs: ['source-other'] },
      { memoryId: 'm-candidate', revision: 1, key: 'format', value: 'CANDIDATE_SECRET', scope: 'global', status: 'candidate', sourceRefs: ['source-candidate'] },
    );
  });
  let serialized;
  const result = await runAgent({
    store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning',
    projectId: task.projectId, conversationId: 'c1', requestId: 'memory-scope-run',
    generate: async messages => { serialized = JSON.stringify(messages); return '已生成执行提示词'; },
  });
  assert.match(serialized, /优先简洁表达/);
  assert.doesNotMatch(serialized, /OTHER_PROJECT_SECRET|CANDIDATE_SECRET/);
  assert.deepEqual(result.version.usedMemories, [{ memoryId: 'm-active', revision: 2 }]);
  assert.ok(result.version.omissions.some(item => item.id === 'm-other' && item.reason === 'scope'));
  assert.ok(result.version.omissions.some(item => item.id === 'm-candidate' && item.reason === 'inactive'));
});
