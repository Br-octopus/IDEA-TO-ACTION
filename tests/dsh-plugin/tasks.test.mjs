import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { archiveTask, bindTask, canonicalProjectId, createTask, deleteTask, getCurrentBinding, listTasks, previewDeleteTask, updateTask } from '../../dsh-plugin/forward-step-dsh/core/tasks.js'

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
  assert.deepEqual(impact, { taskId: task.taskId, title: '待删除任务', bindingCount: 1, versionCount: 0, reviewCount: 0, memoryCount: 0, sourceCount: 0 })
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
      versions: [{ versionId: 'prompt-v1', requestId: 'prompt-r1', stage: 'step-prompt', content: '外部执行提示词', createdAt: new Date().toISOString() }],
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
