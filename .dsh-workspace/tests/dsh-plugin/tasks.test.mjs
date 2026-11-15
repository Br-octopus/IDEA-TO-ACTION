import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { archiveTask, bindTask, canonicalProjectId, createTask, deleteTask, getCurrentBinding, listTasks, previewDeleteTask, savePromptRevision, saveReview, updateTask } from '../../dsh-plugin/forward-step-dsh/core/tasks.js'
import { approveResearch, rejectResearch, requestResearch } from '../../dsh-plugin/forward-step-dsh/core/research.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tasks-'))
  let store
  t.after(() => store?.close())
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store = openStore(join(dir, 'state.sqlite'))
  return { dir, store }
}

function tx(store, eventId) {
  return { expectedRevision: store.read().revision, eventId }
}

async function create(store, cwd, title, conversationId, originalInput = title) {
  return createTask(store, { cwd, title, entryType: 'advance-idea', domain: 'general', originalInput, conversationId }, tx(store, `create-${conversationId}-${title}`))
}

test('任务可在同一项目多对话绑定并按最后绑定切换，保留不可变历史', async t => {
  const { dir, store } = fixture(t)
  const taskA = await create(store, dir, '任务 A', 'conversation-1', 'A 原文')
  const taskB = await create(store, dir, '任务 B', 'conversation-2', 'B 原文')
  await bindTask(store, { projectId: taskA.projectId, taskId: taskA.taskId, conversationId: 'conversation-2' }, tx(store, 'bind-a-c2'))
  await updateTask(store, { taskId: taskA.taskId, taskRevision: taskA.revision, patch: { currentRequirements: ['保留 A 的进度'] } }, tx(store, 'update-a'))
  const oldBinding = await getCurrentBinding(store, taskA.projectId, 'conversation-1')
  await bindTask(store, { projectId: taskB.projectId, taskId: taskB.taskId, conversationId: 'conversation-1' }, tx(store, 'bind-b-c1'))
  assert.equal(oldBinding.taskId, taskA.taskId)
  assert.equal((await getCurrentBinding(store, taskA.projectId, 'conversation-1')).taskId, taskB.taskId)
  assert.equal((await getCurrentBinding(store, taskA.projectId, 'conversation-2')).taskId, taskA.taskId)
  const state = store.read()
  assert.equal(state.bindings.filter(binding => binding.conversationId === 'conversation-1').length, 2)
  assert.deepEqual(state.tasks.find(task => task.taskId === taskA.taskId).currentRequirements, ['保留 A 的进度'])
})

test('同名任务在不同真实目录归属不同项目', async t => {
  const { dir, store } = fixture(t)
  const firstDir = join(dir, 'project-a')
  const secondDir = join(dir, 'project-b')
  mkdirSync(firstDir)
  mkdirSync(secondDir)
  const first = await create(store, firstDir, '同名任务', 'c-a')
  const second = await create(store, secondDir, '同名任务', 'c-b')
  assert.notEqual(first.projectId, second.projectId)
  assert.equal((await listTasks(store, { projectId: first.projectId })).length, 1)
  assert.equal((await listTasks(store, { projectId: second.projectId })).length, 1)
})

test('项目路径规范化且保留完整长原文', async t => {
  const { dir, store } = fixture(t)
  const projectId = canonicalProjectId(dir)
  const normalized = canonicalProjectId(dir.toUpperCase())
  assert.equal(normalized, projectId)
  const originalInput = '目标与约束。'.repeat(200)
  const task = await create(store, dir, '长输入', 'long-input', originalInput)
  assert.equal(task.originalInput, originalInput)
  assert.equal(task.agent.id, task.taskId)
  assert.equal(task.revision, 1)
  assert.deepEqual(task.versions, [])
  assert.deepEqual(task.reviews, [])
})

test('明确偏好作为用户来源和 queued job 与任务在同一事务保存', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '偏好来源', 'preference-source', '我偏好写作时使用简洁、直接的表达')
  const state = store.read()
  const source = state.sources.find(item => item.taskId === task.taskId)
  const job = state.learning.jobs.find(item => item.taskId === task.taskId)

  assert.ok(source)
  assert.equal(source.projectId, task.projectId)
  assert.equal(source.conversationId, 'preference-source')
  assert.equal(source.locator, 'task.originalInput')
  assert.equal(source.kind, 'user-message')
  assert.equal(source.excerpt, task.originalInput)
  assert.equal(source.active, true)
  assert.equal(source.userAuthored, true)
  assert.equal(job.status, 'queued')
  assert.deepEqual(job.sourceRefs, [source.sourceId])
})

test('学习暂停时任务照常保存，但不新增偏好来源或学习 job', async t => {
  const { dir, store } = fixture(t)
  const current = store.read()
  await store.transact(current.revision, 'pause-learning-before-task', state => { state.learning.paused = true })
  const task = await create(store, dir, '暂停期间', 'paused-preference', '我偏好先列结论，再给必要细节')
  const state = store.read()

  assert.ok(state.tasks.some(item => item.taskId === task.taskId))
  assert.equal(state.sources.some(item => item.taskId === task.taskId), false)
  assert.equal(state.learning.jobs.some(item => item.taskId === task.taskId), false)
})

test('非法入口、领域和身份字段 patch 被拒绝', async t => {
  const { dir, store } = fixture(t)
  await assert.rejects(createTask(store, { cwd: dir, title: 'x', entryType: 'unknown', domain: 'general', originalInput: 'x', conversationId: 'c' }, tx(store, 'bad-entry')), { code: 'invalid_input' })
  await assert.rejects(createTask(store, { cwd: dir, title: 'x', entryType: 'advance-idea', domain: 'unknown', originalInput: 'x', conversationId: 'c' }, tx(store, 'bad-domain')), { code: 'invalid_input' })
  const task = await create(store, dir, '可更新', 'c-update')
  await assert.rejects(updateTask(store, { taskId: task.taskId, taskRevision: task.revision, patch: { projectId: 'forged' } }, tx(store, 'forged')), { code: 'invalid_input' })
  await assert.rejects(updateTask(store, { taskId: task.taskId, taskRevision: 0, patch: { title: '过期' } }, tx(store, 'stale')), { code: 'conflict' })
})

test('归档、恢复和删除保留历史；删除必须确认并报告影响', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '生命周期', 'c-life')
  await assert.rejects(deleteTask(store, { taskId: task.taskId, taskRevision: task.revision, confirmed: false, clearLearned: false }, tx(store, 'delete-preview')), error => error.code === 'confirmation_required' && error.impact.taskId === task.taskId)
  const archived = await archiveTask(store, { taskId: task.taskId, taskRevision: task.revision, archived: true }, tx(store, 'archive'))
  assert.equal(archived.archived, true)
  assert.equal(await listTasks(store, { projectId: task.projectId, archived: false }).length, 0)
  const restored = await archiveTask(store, { taskId: task.taskId, taskRevision: archived.revision, archived: false }, tx(store, 'restore'))
  assert.equal(restored.archived, false)
  assert.equal(store.read().bindings.length, 1)
  await deleteTask(store, { taskId: task.taskId, taskRevision: restored.revision, confirmed: true, clearLearned: true }, tx(store, 'delete-confirmed'))
  assert.equal((await listTasks(store, { projectId: task.projectId })).length, 0)
  assert.equal(store.read().bindings.length, 0)
  assert.equal(store.read().changes.some(change => change.eventId === 'delete-confirmed'), true)
})

test('删除任务时在同一事务取消未完成学习 job', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '待学习任务', 'c-learning-delete', '我偏好先列结论，再补必要细节')
  const job = store.read().learning.jobs.find(item => item.taskId === task.taskId)
  assert.equal(job?.status, 'queued')

  await deleteTask(store, { taskId: task.taskId, taskRevision: task.revision, confirmed: true, clearLearned: false }, tx(store, 'delete-learning-task'))
  const deleted = store.read()
  assert.equal(deleted.learning.jobs.find(item => item.jobId === job.jobId)?.status, 'cancelled')
  const retainedSource = deleted.sources.find(source => source.taskId === task.taskId)
  assert.equal(retainedSource?.taskRemoved, true)
  assert.match(retainedSource?.locator, /^已移除任务：/)
})

test('删除任务选择清理学习记录时同时删除专属记忆和来源摘录', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '待清理偏好', 'clear-learned', '我偏好写作时使用简洁、直接的表达')
  const source = store.read().sources.find(item => item.taskId === task.taskId)
  let state = store.read()
  store.transact(state.revision, 'seed-learned-memory', current => current.memories.push({
    memoryId: 'task-memory', revision: 1, key: 'tone', value: '简洁直接', scope: 'task', domains: [],
    projectId: task.projectId, taskId: task.taskId, conversationId: 'clear-learned', status: 'active',
    sourceRefs: [source.sourceId], reason: '用户明确偏好', manualScope: false,
    createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z',
  }))
  assert.equal(previewDeleteTask(store, { taskId: task.taskId, taskRevision: task.revision, clearLearned: true }).memoryCount, 1)
  await deleteTask(store, { taskId: task.taskId, taskRevision: task.revision, confirmed: true, clearLearned: true }, tx(store, 'delete-clear-learned'))
  state = store.read()
  assert.equal(state.memories.some(memory => memory.taskId === task.taskId), false)
  assert.equal(state.sources.some(item => item.sourceId === source.sourceId), false)
  assert.equal(state.suppressions.some(item => item.memoryId === 'task-memory'), true)
  assert.equal(state.learning.jobs.find(item => item.taskId === task.taskId).status, 'cancelled')
})



test('同一任务的两个对话共享任务进度，新对话不会继承旧绑定', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '共享进度', 'conversation-old')
  await bindTask(store, { projectId: task.projectId, taskId: task.taskId, conversationId: 'conversation-new' }, tx(store, 'bind-new-conversation'))
  const revised = await updateTask(store, {
    taskId: task.taskId,
    taskRevision: task.revision,
    patch: { currentRequirements: ['要求一'], materials: [{ id: 'm1', text: '资料内容' }] },
  }, tx(store, 'save-progress'))
  assert.equal(await getCurrentBinding(store, task.projectId, 'conversation-new').taskId, task.taskId)
  assert.deepEqual((await listTasks(store, { projectId: task.projectId }))[0].currentRequirements, ['要求一'])
  assert.equal(await getCurrentBinding(store, task.projectId, 'conversation-unrelated'), null)
  assert.deepEqual(revised.materials, [{ id: 'm1', text: '资料内容' }])
})

test('修改领域不会清空其他领域材料和版本记录', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '跨领域', 'conversation-domain')
  const revised = await updateTask(store, {
    taskId: task.taskId,
    taskRevision: task.revision,
    patch: {
      domain: 'writing',
      materials: [{ id: 'm1', kind: 'text' }],
      versions: [{ versionId: 'v1', stage: 'planning' }],
      methodState: { ppt: { outline: ['原PPT提纲'] } },
    },
  }, tx(store, 'set-writing-domain'))
  assert.equal(revised.domain, 'writing')
  assert.deepEqual(revised.materials, [{ id: 'm1', kind: 'text' }])
  assert.deepEqual(revised.versions, [{ versionId: 'v1', stage: 'planning' }])
  assert.deepEqual(revised.methodState.ppt.outline, ['原PPT提纲'])
})

test('写作与 PPT 方法状态及材料可通过任务修订持久化', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '跨阶段规划', 'conversation-method')
  const methodState = {
    writing: { article: { audience: '一般读者', genre: 'article' }, round: { draft: '第二轮稿件', feedback: '保留数据' }, roundNumber: 2 },
    ppt: { stage: 'outline', brief: { audience: '项目组', durationMinutes: 8, constraints: { minSlides: 4, maxSlides: 8 } }, outline: { status: 'draft', slides: [{ title: '风险', content: '已知事项', imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }] } },
  }
  const materials = [{ id: 'style-1', title: '表达样本', purpose: 'style', excerpt: '短句、克制' }]
  const updated = await updateTask(store, { taskId: task.taskId, taskRevision: task.revision, patch: { methodState, materials } }, tx(store, 'save-domain-method-state'))
  assert.deepEqual(updated.methodState, methodState)
  assert.deepEqual(updated.materials, materials)
  assert.deepEqual(store.read().tasks.find(item => item.taskId === task.taskId).methodState.ppt.outline.slides, [{ title: '风险', content: '已知事项', imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }])
})

test('用户导入材料写入插件 SQLite 后重开仍可读回且不保存本地路径', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-material-reopen-'))
  const databasePath = join(dir, 'state.sqlite')
  let store = openStore(databasePath)
  t.after(() => {
    try { store?.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  })

  const task = await create(store, dir, '材料读回', 'conversation-material-reopen')
  const materials = [{
    id: 'material-imported-1',
    sourceId: 'material-imported-1',
    kind: 'user-selected-text-file',
    title: '用户选入.md',
    purpose: 'content',
    excerpt: '导入后明确保存的摘录',
    selected: false,
    verificationStatus: 'unverified',
  }]
  await updateTask(store, {
    taskId: task.taskId,
    taskRevision: task.revision,
    patch: { materials },
  }, tx(store, 'save-imported-material-for-reopen'))
  store.close()
  store = openStore(databasePath)

  const reopened = (await listTasks(store, { projectId: task.projectId }))[0]
  assert.deepEqual(reopened.materials, materials)
  assert.equal(JSON.stringify(reopened.materials).includes(dir), false)
})

test('写作轮次冻结后拒绝修改文体、任务类型、专业包选择和快照', async t => {
  const { dir, store } = fixture(t)
  let task = await create(store, dir, '冻结写作轮次', 'conversation-frozen-round')
  const writing = {
    article: { genre: 'article' },
    round: {
      id: 'round-frozen',
      taskType: 'article',
      packSelections: ['pack-a'],
      packSnapshot: { packs: [{ id: 'pack-a', version: 1 }], selectedIds: ['pack-a'] },
    },
  }
  task = await updateTask(store, {
    taskId: task.taskId,
    taskRevision: task.revision,
    patch: { domain: 'writing', methodState: { writing } },
  }, tx(store, 'seed-frozen-writing-round'))

  for (const [eventId, changedWriting] of [
    ['change-frozen-genre', { ...writing, article: { genre: 'academic-paper' } }],
    ['change-frozen-task-type', { ...writing, round: { ...writing.round, taskType: 'revision' } }],
    ['change-frozen-pack-selection', { ...writing, round: { ...writing.round, packSelections: [] } }],
    ['replace-frozen-snapshot', { ...writing, round: { ...writing.round, packSnapshot: { packs: [], selectedIds: [] } } }],
    ['remove-frozen-round', { ...writing, round: { id: 'round-frozen' } }],
  ]) {
    await assert.rejects(updateTask(store, {
      taskId: task.taskId,
      taskRevision: task.revision,
      patch: { methodState: { writing: changedWriting } },
    }, tx(store, eventId)), { code: 'conflict' })
  }

  const nextRound = await updateTask(store, {
    taskId: task.taskId,
    taskRevision: task.revision,
    patch: { methodState: { writing: { ...writing, round: { id: 'round-next', taskType: 'revision', packSelections: [] } } } },
  }, tx(store, 'start-next-writing-round'))
  assert.equal(nextRound.methodState.writing.round.id, 'round-next')
  assert.equal(nextRound.methodState.writing.round.packSnapshot, undefined)
})

test('复盘写入任务历史并校验外部结果与提示词版本关联', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '复盘任务', 'conversation-review')
  const prompt = { versionId: 'prompt-review', requestId: 'run-1', kind: 'agent-output', stage: 'step-prompt', stepId: 'task', content: '提示词', createdAt: new Date().toISOString(), usedMemories: [], usedSources: [], omissions: [] }
  const result = { versionId: 'result-review', requestId: 'external:event-1', kind: 'external-result', stage: 'external-result', stepId: 'task', promptVersionId: prompt.versionId, source: 'user-pasted', content: '用户带回的结果', createdAt: new Date().toISOString(), usedMemories: [], usedSources: [], omissions: [] }
  const withVersions = await updateTask(store, { taskId: task.taskId, taskRevision: task.revision, patch: { versions: [prompt, result], currentRequirements: ['保留结论边界'] } }, tx(store, 'add-review-fixture'))
  const saved = await saveReview(store, {
    projectId: task.projectId,
    taskId: task.taskId,
    taskRevision: withVersions.revision,
    conversationId: 'conversation-review',
    resultVersionId: result.versionId,
    promptVersionId: prompt.versionId,
    verdict: 'failure',
    checks: [{ requirement: '保留结论边界', result: 'fail', note: '结论范围变宽' }],
    feedback: '需重新整理',
    confirmed: true,
  }, tx(store, 'save-review-1'))
  assert.equal(saved.review.confirmed, true)
  assert.deepEqual(saved.review.requirementsSnapshot, ['保留结论边界'])
  assert.equal(store.read().tasks.find(item => item.taskId === task.taskId).reviews[0].resultVersionId, result.versionId)
  await assert.rejects(saveReview(store, {
    projectId: task.projectId, taskId: task.taskId, taskRevision: saved.task.revision,
    conversationId: 'conversation-review', resultVersionId: result.versionId,
    promptVersionId: 'other-task-prompt', verdict: 'success', checks: [{ requirement: '保留结论边界', result: 'pass' }], confirmed: true,
  }, tx(store, 'save-review-invalid')), { code: 'invalid_input' })
  await assert.rejects(saveReview(store, {
    projectId: task.projectId, taskId: task.taskId, taskRevision: saved.task.revision,
    conversationId: 'conversation-review', resultVersionId: result.versionId,
    promptVersionId: prompt.versionId, verdict: 'success', checks: [], confirmed: true,
  }, tx(store, 'save-review-missing-check')), { code: 'invalid_input' })
})

test('编辑提示词追加不可变新版本，方法状态变化只标记提示词陈旧', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '提示词改稿', 'conversation-prompt-revision')
  const original = { versionId: 'prompt-original', requestId: 'run-original', kind: 'agent-output', stage: 'step-prompt', stepId: 'task', content: '保留第一版要求', createdAt: new Date().toISOString(), usedMemories: [], usedSources: [], omissions: [] }
  const prepared = await updateTask(store, { taskId: task.taskId, taskRevision: task.revision, patch: { versions: [original] } }, tx(store, 'prepare-prompt-revision'))
  const revised = await savePromptRevision(store, {
    projectId: task.projectId, taskId: task.taskId, taskRevision: prepared.revision,
    conversationId: 'conversation-prompt-revision', stepId: 'task', sourceVersionId: original.versionId,
    content: '保留第一版要求并补充验收方式',
  }, tx(store, 'save-prompt-revision'))
  assert.equal(revised.task.versions.length, 2)
  assert.equal(revised.task.versions[0].content, '保留第一版要求')
  assert.equal(revised.version.kind, 'prompt')
  assert.equal(revised.version.parentVersionId, original.versionId)

  const externalModule = await import('../../dsh-plugin/forward-step-dsh/core/tasks.js')
  const external = await externalModule.saveExternalResult(store, {
    projectId: task.projectId, taskId: task.taskId, taskRevision: revised.task.revision,
    conversationId: 'conversation-prompt-revision', stepId: 'task', promptVersionId: revised.version.versionId,
    content: '用户回填结果',
  }, tx(store, 'save-prompt-result'))
  const changed = await updateTask(store, {
    taskId: task.taskId,
    taskRevision: external.revision,
    patch: { methodState: { writing: { article: { audience: '新的读者' } } } },
  }, tx(store, 'change-audience'))
  assert.equal(changed.versions.find(version => version.versionId === original.versionId).stale, true)
  assert.equal(changed.versions.find(version => version.versionId === revised.version.versionId).stale, true)
  assert.notEqual(changed.versions.find(version => version.kind === 'external-result').stale, true)
})

test('重复绑定事件不追加第二条历史，跨项目绑定被拒绝', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '绑定边界', 'c-initial')
  const bind = { projectId: task.projectId, taskId: task.taskId, conversationId: 'c-extra' }
  const bindingTx = tx(store, 'bind-once')
  await bindTask(store, bind, bindingTx)
  const count = store.read().bindings.length
  await bindTask(store, bind, bindingTx)
  assert.equal(store.read().bindings.length, count)
  await assert.rejects(bindTask(store, { ...bind, projectId: 'wrong-project' }, tx(store, 'wrong-project-bind')), { code: 'invalid_input' })
})

test('重命名记录变更历史且不覆盖原文', async t => {
  const { dir, store } = fixture(t)
  const originalInput = '用户给出的原始任务完整输入'
  const task = await create(store, dir, '旧标题', 'c-rename', originalInput)
  const renamed = await updateTask(store, { taskId: task.taskId, taskRevision: task.revision, patch: { title: '新标题' } }, tx(store, 'rename'))
  assert.equal(renamed.title, '新标题')
  assert.equal(renamed.originalInput, originalInput)
  assert.equal(store.read().changes.filter(change => change.eventId === 'rename').length, 1)
})


test('删除预览校验修订并返回影响范围，不修改存储', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '待删除任务', 'conversation-preview')
  const beforeRevision = store.read().revision
  const impact = previewDeleteTask(store, { taskId: task.taskId, taskRevision: task.revision })
  assert.deepEqual(impact, { taskId: task.taskId, title: '待删除任务', bindingCount: 1, versionCount: 0, reviewCount: 0, clearLearned: false, memoryCount: 0, sourceCount: 0 })
  assert.equal(store.read().revision, beforeRevision)
  assert.throws(() => previewDeleteTask(store, { taskId: task.taskId, taskRevision: task.revision - 1 }), { code: 'conflict' })
})
test('外部结果以独立版本保存，并关联已有步骤和提示词版本', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '外部结果关联', 'conversation-result')
  const prepared = await updateTask(store, {
    taskId: task.taskId,
    taskRevision: task.revision,
    patch: {
      agent: { ...task.agent, steps: [{ id: 'step-body', title: '正文' }], currentStepId: 'step-body' },
      versions: [{ versionId: 'prompt-v1', requestId: 'prompt-r1', kind: 'agent-output', stage: 'step-prompt', stepId: 'step-body', content: '外部执行提示词', createdAt: new Date().toISOString(), usedMemories: [], usedSources: [], omissions: [] }],
    },
  }, tx(store, 'prepare-external-result'))

  const { saveExternalResult } = await import('../../dsh-plugin/forward-step-dsh/core/tasks.js')
  const input = {
    projectId: task.projectId,
    taskId: task.taskId,
    taskRevision: prepared.revision,
    conversationId: 'conversation-result',
    stepId: 'step-body',
    promptVersionId: 'prompt-v1',
    content: '外部 AI 返回的正文版本',
    feedback: '保留第一段，补充来源说明',
  }
  const saved = await saveExternalResult(store, input, tx(store, 'save-external-result'))
  const version = saved.versions.at(-1)
  assert.equal(version.kind, 'external-result')
  assert.equal(version.stepId, 'step-body')
  assert.equal(version.promptVersionId, 'prompt-v1')
  assert.equal(version.content, input.content)
  assert.equal(version.feedback, input.feedback)
  assert.equal(saved.revision, prepared.revision + 1)
  assert.equal(saved.originalInput, task.originalInput)

  const replay = await saveExternalResult(store, input, { expectedRevision: prepared.revision, eventId: 'save-external-result' })
  assert.equal(replay.versions.filter(item => item.kind === 'external-result').length, 1)
  assert.equal(replay.versions.at(-1).versionId, version.versionId)
})

test('外部结果拒绝未知步骤、未知提示词版本、空内容和陈旧任务修订', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '外部结果校验', 'conversation-result-validation')
  const prepared = await updateTask(store, {
    taskId: task.taskId,
    taskRevision: task.revision,
    patch: {
      agent: { ...task.agent, steps: [{ id: 'step-valid', title: '有效步骤' }] },
      versions: [{ versionId: 'prompt-valid', requestId: 'prompt-r1', stage: 'planning', content: '规划提示', createdAt: new Date().toISOString() }],
    },
  }, tx(store, 'prepare-validation'))
  const { saveExternalResult } = await import('../../dsh-plugin/forward-step-dsh/core/tasks.js')
  const input = { projectId: task.projectId, taskId: task.taskId, taskRevision: prepared.revision, conversationId: 'conversation-result-validation', stepId: 'step-valid', promptVersionId: 'prompt-valid', content: '外部结果' }
  await assert.rejects(saveExternalResult(store, { ...input, stepId: 'missing-step' }, tx(store, 'bad-step')), { code: 'invalid_input' })
  await assert.rejects(saveExternalResult(store, { ...input, promptVersionId: 'missing-prompt' }, tx(store, 'bad-prompt')), { code: 'invalid_input' })
  await assert.rejects(saveExternalResult(store, { ...input, content: '  ' }, tx(store, 'blank-result')), { code: 'invalid_input' })
  await assert.rejects(saveExternalResult(store, { ...input, taskRevision: prepared.revision - 1 }, tx(store, 'stale-result')), { code: 'conflict' })
})

test('联网研究批准状态写入任务并在 SQLite 重开后保留', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '研究任务', 'research-restart', '整理目标市场的公开资料')
  const pending = requestResearch(task, { objective: task.originalInput, queries: [task.originalInput] })
  const saved = await updateTask(store, { taskId: task.taskId, taskRevision: task.revision, patch: { agent: pending.agent } }, tx(store, 'research-preview'))
  const approved = approveResearch(saved)
  const persisted = await updateTask(store, { taskId: task.taskId, taskRevision: saved.revision, patch: { agent: approved.agent } }, tx(store, 'research-approve'))

  store.close()
  const reopened = openStore(join(dir, 'state.sqlite'))
  t.after(() => reopened.close())
  const restored = reopened.read().tasks.find(item => item.taskId === task.taskId)
  assert.equal(persisted.agent.research.status, 'not-executed')
  assert.equal(restored.agent.research.decision, 'approved')
  assert.equal(restored.agent.research.scope.queries[0], task.originalInput)
  assert.deepEqual(restored.agent.research.budget, { maxQueries: 3, maxSources: 5 })
  reopened.close()
})
test('联网研究拒绝决定在重启后仍禁止同任务再次申请', async t => {
  const { dir, store } = fixture(t)
  const task = await create(store, dir, '拒绝研究任务', 'research-rejected-restart', '拒绝后不可再次申请')
  const pending = requestResearch(task, { objective: task.originalInput, queries: [task.originalInput] })
  const rejected = rejectResearch(pending)
  await updateTask(store, { taskId: task.taskId, taskRevision: task.revision, patch: { agent: rejected.agent } }, tx(store, 'research-reject-restart'))

  store.close()
  const reopened = openStore(join(dir, 'state.sqlite'))
  const restored = reopened.read().tasks.find(item => item.taskId === task.taskId)
  assert.equal(restored.agent.research.decision, 'rejected')
  assert.throws(() => requestResearch(restored, { objective: '重试', queries: ['重试'] }), /已经拒绝/)
  reopened.close()
})
