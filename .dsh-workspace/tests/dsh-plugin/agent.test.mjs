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

async function create(store, dir, conversationId = 'c1', domain = 'general') {
  return createTask(store, { cwd: dir, title: 'Agent 测试', entryType: 'advance-idea', domain, originalInput: '做一个简易工具', conversationId }, { expectedRevision: store.read().revision, eventId: `create-${conversationId}` })
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

test('模型成功但任务写入失败时返回可恢复草稿，且不写入任务或学习记录', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir)
  const transact = store.transact.bind(store)
  const failingStore = {
    read: () => store.read(),
    transact(expectedRevision, eventId, mutate) {
      if (eventId === 'agent-run:unsaved-run') {
        throw Object.assign(new Error('存储不可用'), { code: 'storage_failure' })
      }
      return transact(expectedRevision, eventId, mutate)
    },
  }

  const result = await runAgent({
    store: failingStore,
    taskId: task.taskId,
    taskRevision: task.revision,
    stage: 'planning',
    requestId: 'unsaved-run',
    generate: async () => '模型已生成但未保存的草稿',
  })

  assert.deepEqual(result.unsavedDraft, {
    content: '模型已生成但未保存的草稿',
    stage: 'planning',
    errorCode: 'storage_failure',
  })
  assert.equal(result.task.revision, task.revision)
  const state = store.read()
  assert.equal(state.tasks.find(item => item.taskId === task.taskId).versions.length, 0)
  assert.equal(state.learning.jobs.length, 0)
  assert.equal(state.processedEvents.includes('agent-run:unsaved-run'), false)
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

test('写作上下文超预算时在调用模型前失败', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, 'budget-c1', 'writing')
  let modelCalls = 0
  await assert.rejects(runAgent({
    store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning', maxChars: 1,
    projectId: task.projectId, conversationId: 'budget-c1', requestId: 'budget-rejected',
    generate: async () => { modelCalls += 1; return '不应调用模型' },
  }), { code: 'budget_exceeded' })
  assert.equal(modelCalls, 0)
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

test('Agent 在生成期间长期记忆版本变化时保留旧快照并标记可重新生成', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir)
  const seeded = store.read()
  await store.transact(seeded.revision, 'seed-racing-memory', state => {
    state.sources.push({ sourceId: 'source-racing', active: true, userAuthored: true })
    state.memories.push({ memoryId: 'm-racing', revision: 1, key: 'tone', value: '旧表达偏好', scope: 'global', status: 'active', sourceRefs: ['source-racing'] })
  })

  const output = deferred()
  let markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  const running = runAgent({
    store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning',
    projectId: task.projectId, conversationId: 'c1', requestId: 'memory-revision-race',
    generate: async () => { markStarted(); return output.promise },
  })
  await started

  const current = store.read()
  await store.transact(current.revision, 'change-racing-memory', state => {
    const memory = state.memories.find(item => item.memoryId === 'm-racing')
    memory.revision = 2
    memory.status = 'disabled'
    memory.value = '新表达偏好'
  })
  output.resolve('使用旧偏好生成的结果')

  const result = await running
  assert.deepEqual(result.version.usedMemories, [{ memoryId: 'm-racing', revision: 1 }])
  assert.equal(result.version.memoryRevisionChanged, true)
  assert.equal(result.version.content, '使用旧偏好生成的结果')
  const savedVersion = store.read().tasks.find(item => item.taskId === task.taskId).versions[0]
  assert.deepEqual(savedVersion.usedMemories, [{ memoryId: 'm-racing', revision: 1 }])
  assert.equal(savedVersion.content, '使用旧偏好生成的结果', '撤销记忆后已保存版本仍保留原文和采用快照')
})


test('真实任务 Agent 将完整上下文经 coordinator preparedRequest 发送并保存结果', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir)
  let call
  const result = await runAgent({
    store,
    taskId: task.taskId,
    taskRevision: task.revision,
    stage: 'planning',
    requestId: 'prepared-task-run',
    projectId: task.projectId,
    conversationId: 'c1',
    generate: async (messages, options) => {
      call = { messages, options }
      return '路线已按任务目标整理'
    },
  })
  assert.equal(call.options.preparedRequest, true)
  assert.equal(call.options.stage, 'planning')
  assert.equal(call.options.requestId, 'prepared-task-run')
  assert.equal(call.messages.length, 1)
  assert.match(call.messages[0].content, new RegExp(task.originalInput))
  assert.match(call.messages[0].content, /首版交付边界/)
  assert.equal(result.version.content, '路线已按任务目标整理')
  assert.equal(result.version.requestId, 'prepared-task-run')
})

test('写作规划经真实 Agent preparedRequest 保留超过旧 builder 上限的完整要求', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, 'writing-c1', 'writing')
  const requirement = `${'当前用户要求优先并必须完整保留。'.repeat(40)}尾部保留哨兵`
  const { updateTask } = await import('../../dsh-plugin/forward-step-dsh/core/tasks.js')
  const prepared = await updateTask(store, {
    taskId: task.taskId,
    taskRevision: task.revision,
    patch: {
      currentRequirements: [requirement],
      methodState: { writing: { article: { genre: 'article', audience: '一般读者' }, round: { id: 'round-1', draft: '尚未改写的原稿' } } },
    },
  }, { expectedRevision: store.read().revision, eventId: 'prepare-writing-long-requirement' })
  let serialized
  const result = await runAgent({
    store,
    taskId: prepared.taskId,
    taskRevision: prepared.revision,
    stage: 'planning',
    projectId: prepared.projectId,
    conversationId: 'writing-c1',
    requestId: 'writing-long-requirement-run',
    generate: async messages => { serialized = JSON.stringify(messages); return '写作路线草案' },
  })

  assert.match(serialized, /尾部保留哨兵/)
  assert.match(serialized, /尚未改写的原稿/)
  assert.match(serialized, /3–7 步/)
  assert.equal(result.version.content, '写作路线草案')
})


test('Agent only injects selected and enabled writing pack rules', async t => {
  const { dir, store } = fixture(t)
  let task = await create(store, dir, 'writing-pack-c1', 'writing')
  const rule = 'PACK_RULE_SENTINEL_204'
  store.transact(store.read().revision, 'seed-writing-pack', state => {
    state.writingPacks.push({
      id: 'custom-article-pack', name: 'Custom Article Pack', genre: 'article', version: 1,
      requirements: [{ id: 'pack-rule', statement: rule, sourceIds: [], verificationStatus: 'unverified' }],
    })
    const storedTask = state.tasks.find(item => item.taskId === task.taskId)
    storedTask.methodState = { writing: { article: { genre: 'article' }, round: { packSelections: ['custom-article-pack'] } } }
  })

  let serialized
  await runAgent({
    store, taskId: task.taskId, taskRevision: task.revision, stage: 'diagnosis', requestId: 'writing-pack-selected',
    generate: async messages => { serialized = JSON.stringify(messages); return 'Selected pack route' },
  })
  assert.match(serialized, new RegExp(rule))

  store.transact(store.read().revision, 'deselect-writing-pack', state => {
    state.tasks.find(item => item.taskId === task.taskId).methodState.writing.round = { id: 'writing-pack-c1-round-2', packSelections: [] }
  })
  task = store.read().tasks.find(item => item.taskId === task.taskId)
  await runAgent({
    store, taskId: task.taskId, taskRevision: task.revision, stage: 'diagnosis', requestId: 'writing-pack-unselected',
    generate: async messages => { serialized = JSON.stringify(messages); return 'Unselected pack route' },
  })
  assert.doesNotMatch(serialized, new RegExp(rule))

  store.transact(store.read().revision, 'disable-writing-pack', state => {
    state.tasks.find(item => item.taskId === task.taskId).methodState.writing.round = { id: 'writing-pack-c1-round-3', packSelections: ['custom-article-pack'] }
    state.writingPackSettings.push({ id: 'custom-article-pack', enabled: false })
  })
  task = store.read().tasks.find(item => item.taskId === task.taskId)
  await runAgent({
    store, taskId: task.taskId, taskRevision: task.revision, stage: 'diagnosis', requestId: 'writing-pack-disabled',
    generate: async messages => { serialized = JSON.stringify(messages); return 'Disabled pack route' },
  })
  assert.doesNotMatch(serialized, new RegExp(rule))
})

test('Agent freezes writing pack rules for a round and reads updated packs in a new round', async t => {
  const { dir, store } = fixture(t)
  let task = await create(store, dir, 'writing-pack-snapshot-c1', 'writing')
  const oldRule = 'PACK_SNAPSHOT_OLD_RULE'
  const newRule = 'PACK_SNAPSHOT_NEW_RULE'
  store.transact(store.read().revision, 'seed-writing-pack-snapshot', state => {
    state.writingPacks.push({
      id: 'snapshot-article-pack', name: 'Snapshot Article Pack', genre: 'article', version: 1,
      requirements: [{ id: 'snapshot-rule', statement: oldRule, sourceIds: [], verificationStatus: 'unverified' }],
    })
    const storedTask = state.tasks.find(item => item.taskId === task.taskId)
    storedTask.methodState = { writing: { article: { genre: 'article' }, round: { id: 'round-1', packSelections: ['snapshot-article-pack'] } } }
  })
  task = store.read().tasks.find(item => item.taskId === task.taskId)

  let serialized
  const first = await runAgent({
    store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning', requestId: 'pack-snapshot-first',
    generate: async messages => { serialized = JSON.stringify(messages); return '首轮路线' },
  })
  assert.match(serialized, new RegExp(oldRule))
  assert.equal(first.task.methodState.writing.round.packSnapshot.packs.find(pack => pack.id === 'snapshot-article-pack').version, 1)

  store.transact(store.read().revision, 'update-writing-pack-after-snapshot', state => {
    const pack = state.writingPacks.find(item => item.id === 'snapshot-article-pack')
    pack.version = 2
    pack.requirements[0].statement = newRule
    state.writingPackSettings.push({ id: 'snapshot-article-pack', enabled: false })
    const storedTask = state.tasks.find(item => item.taskId === task.taskId)
    storedTask.methodState.writing.round.packSelections = []
  })
  task = store.read().tasks.find(item => item.taskId === task.taskId)
  const replayedRound = await runAgent({
    store, taskId: task.taskId, taskRevision: task.revision, stage: 'diagnosis', requestId: 'pack-snapshot-same-round',
    generate: async messages => { serialized = JSON.stringify(messages); return '同轮复跑' },
  })
  assert.match(serialized, new RegExp(oldRule))
  assert.doesNotMatch(serialized, new RegExp(newRule))
  assert.equal(replayedRound.task.methodState.writing.round.packSnapshot.packs.find(pack => pack.id === 'snapshot-article-pack').version, 1)
  assert.deepEqual(replayedRound.task.methodState.writing.round.packSnapshot.selectedIds, ['snapshot-article-pack'])

  store.transact(store.read().revision, 'start-writing-pack-snapshot-round-2', state => {
    const storedTask = state.tasks.find(item => item.taskId === task.taskId)
    state.writingPackSettings = state.writingPackSettings.filter(item => item.id !== 'snapshot-article-pack')
    storedTask.methodState.writing.round = { id: 'round-2', packSelections: ['snapshot-article-pack'] }
  })
  task = store.read().tasks.find(item => item.taskId === task.taskId)
  const nextRound = await runAgent({
    store, taskId: task.taskId, taskRevision: task.revision, stage: 'planning', requestId: 'pack-snapshot-new-round',
    generate: async messages => { serialized = JSON.stringify(messages); return '第二轮路线' },
  })
  assert.match(serialized, new RegExp(newRule))
  assert.equal(nextRound.task.methodState.writing.round.packSnapshot.packs.find(pack => pack.id === 'snapshot-article-pack').version, 2)
})
