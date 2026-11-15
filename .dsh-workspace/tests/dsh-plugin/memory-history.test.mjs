import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { createLearningService } from '../../dsh-plugin/forward-step-dsh/memory/service.js'
import { deleteMemory, editMemory, invalidateSource, planUndo, previewDeleteMemory, setMemoryStatus, undoChange } from '../../dsh-plugin/forward-step-dsh/memory/history.js'

function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-history-'))
  const store = openStore(join(dir, 'state.sqlite'))
  store.transact(0, 'seed', state => {
    state.projects.push({ projectId: 'p1', cwd: '/p1' })
    state.tasks.push({ taskId: 't1', projectId: 'p1', domain: 'writing', revision: 1, versions: [] })
    state.sources.push(...(overrides.sources ?? []))
    state.memories.push({ memoryId: 'm1', revision: 3, key: 'tone', value: '简洁', scope: 'global', domains: [], projectId: 'p1', taskId: 't1', conversationId: 'c1', status: 'active', sourceRefs: (overrides.sources ?? []).map(source => source.sourceId), reason: '用户明确表达', manualScope: false, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...(overrides.memory ?? {}) })
  })
  t.after(() => { try { store.close() } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) } })
  return store
}
const source = (sourceId, digest = `digest-${sourceId}`) => ({ sourceId, projectId: 'p1', taskId: 't1', conversationId: 'c1', locator: `msg:${sourceId}`, kind: 'user-message', excerpt: '我偏好简洁表达', digest, active: true, userAuthored: true })
const tx = (store, eventId) => ({ expectedRevision: store.read().revision, eventId })

test('planUndo 按字段恢复，保留其它字段的后续修改', () => {
  assert.deepEqual(planUndo({ scope: 'global', value: '更简洁' }, { changedFields: ['scope'], before: { scope: 'task' }, after: { scope: 'global' } }), { patch: { scope: 'task' }, conflicts: [] })
})

test('同字段后续修改时先预览冲突，确认后按字段恢复', async t => {
  const store = fixture(t, { memory: { revision: 5, scope: 'project', value: '更简洁' } })
  const state = store.read()
  store.transact(state.revision, 'promote', current => current.changes.push({ eventId: 'promote', memoryId: 'm1', reason: 'scope_change', changedFields: ['scope'], before: { scope: 'task' }, after: { scope: 'global' } }))
  const revision = store.read().revision
  const preview = await undoChange(store, { memoryId: 'm1', eventId: 'promote', memoryRevision: 5 })
  assert.equal(preview.conflicts[0].field, 'scope')
  assert.equal(store.read().revision, revision)
  const result = await undoChange(store, { memoryId: 'm1', eventId: 'promote', memoryRevision: 5, resolve: { scope: 'restore' } }, tx(store, 'undo-promote'))
  assert.equal(result.memory.scope, 'task')
  assert.equal(result.memory.value, '更简洁')
})

test('撤销创建会停用并保留抑制，不生成正文副本', async t => {
  const store = fixture(t, { sources: [source('s1')] })
  const state = store.read()
  store.transact(state.revision, 'created', current => current.changes.push({ eventId: 'created', memoryId: 'm1', before: null, after: structuredClone(current.memories[0]) }))
  const result = await undoChange(store, { memoryId: 'm1', eventId: 'created', memoryRevision: 3 }, tx(store, 'undo-created'))
  assert.equal(result.memory.status, 'disabled')
  const suppression = store.read().suppressions[0]
  assert.equal(suppression.key, undefined)
  assert.deepEqual(Object.keys(suppression).sort(), ['createdAt', 'keyDigest', 'memoryId', 'reason', 'sourceDigests', 'suppressionId', 'valueDigest'].sort())
  const repeat = await undoChange(store, { memoryId: 'm1', eventId: 'created', memoryRevision: 4 }, tx(store, 'undo-created-again'))
  assert.equal(repeat.idempotent, true)
})

test('新来源命中抑制内容时生成 candidate，不复活旧记忆', async t => {
  const store = fixture(t, { sources: [source('s1')] })
  await setMemoryStatus(store, { memoryId: 'm1', memoryRevision: 3, status: 'disabled' }, tx(store, 'suppress'))
  const state = store.read()
  store.transact(state.revision, 'new-source', current => {
    current.sources.push(source('s2', 'digest-s2'))
    current.learning.jobs.push({ jobId: 'learn:new', projectId: 'p1', taskId: 't1', conversationId: 'c1', sourceRefs: ['s2'], status: 'queued', attempts: 0, createdAt: 'now' })
  })
  const learning = createLearningService({ store, extract: async () => ({ candidates: [{ key: 'tone', value: '简洁', sourceRefs: ['s2'], reason: '新依据', projectSpecific: false, conflict: false }] }) })
  await learning.drain()
  assert.equal(store.read().memories.find(item => item.memoryId === 'm1').status, 'disabled')
  assert.ok(store.read().memories.some(item => item.status === 'candidate' && item.sourceRefs.includes('s2')))
})

test('编辑、停用与显式恢复均校验修订并写审计事件', async t => {
  const store = fixture(t)
  const edited = await editMemory(store, { memoryId: 'm1', memoryRevision: 3, patch: { value: '先结论后细节' } }, tx(store, 'edit'))
  assert.equal(edited.memory.value, '先结论后细节')
  assert.deepEqual(store.read().changes.at(-1).changedFields, ['value'])
  const disabled = await setMemoryStatus(store, { memoryId: 'm1', memoryRevision: 4, status: 'disabled' }, tx(store, 'disable'))
  assert.equal(disabled.memory.status, 'disabled')
  assert.equal(store.read().suppressions.length, 2)
  const restored = await setMemoryStatus(store, { memoryId: 'm1', memoryRevision: 5, status: 'active' }, tx(store, 'restore'))
  assert.equal(restored.memory.status, 'active')
  assert.equal(store.read().suppressions.length, 1)
})

test('明确采用候选冲突值时停用同范围旧值并写入补偿记录', async t => {
  const store = fixture(t, { sources: [source('s1'), source('s2')], memory: { scope: 'global', value: '简洁', projectId: 'p2', taskId: 't2', conversationId: 'c2' } })
  const state = store.read()
  store.transact(state.revision, 'add-conflict', current => current.memories.push({
    memoryId: 'm2', revision: 1, key: 'tone', value: '先结论后细节', scope: 'global', domains: [],
    projectId: 'p1', taskId: 't1', conversationId: 'c1', status: 'candidate', sourceRefs: ['s2'],
    reason: '用户后续纠正', manualScope: false, createdAt: 'now', updatedAt: 'now',
  }))
  const selected = await setMemoryStatus(store, { memoryId: 'm2', memoryRevision: 1, status: 'active' }, tx(store, 'choose-candidate'))
  assert.equal(selected.memory.status, 'active')
  assert.equal(store.read().memories.find(memory => memory.memoryId === 'm1').status, 'disabled')
  assert.equal(store.read().changes.some(change => change.memoryId === 'm1' && change.reason === 'user_conflict_resolved'), true)
})

test('删除记忆清理正文历史与专属来源副本并留下抑制标识', async t => {
  const store = fixture(t, { sources: [source('s1')] })
  const state = store.read()
  store.transact(state.revision, 'history', current => {
    current.changes.push({ eventId: 'learned', memoryId: 'm1', reason: 'automatic_learning', before: null, after: structuredClone(current.memories[0]) })
    current.learning.jobs.push({ jobId: 'learn:s1', taskId: 't1', sourceRefs: ['s1'], status: 'completed', summary: '简洁表达的学习依据' })
  })
  assert.equal(previewDeleteMemory(store.read(), 'm1').exclusivelyOwnedSourceCount, 1)
  const result = await deleteMemory(store, { memoryId: 'm1', memoryRevision: 3, confirmed: true }, tx(store, 'delete'))
  assert.equal(result.deleted, true)
  const deleted = store.read()
  assert.equal(deleted.memories.length, 0)
  assert.equal(deleted.sources.length, 0)
  assert.equal(deleted.changes[0].auditRedacted, true)
  assert.equal(JSON.stringify(deleted.changes).includes('简洁'), false)
  assert.equal(deleted.learning.jobs[0].summary, undefined)
  assert.equal(deleted.learning.jobs[0].auditRedacted, true)
  assert.equal(deleted.suppressions.length, 1)
})

test('来源失效使自动范围收窄，全部来源失效后停止生效', async t => {
  const store = fixture(t, { sources: [source('s1'), source('s2')] })
  const first = await invalidateSource(store, { sourceId: 's1', confirmed: true }, tx(store, 'invalidate-1'))
  assert.equal(first.memory.scope, 'task')
  const second = await invalidateSource(store, { sourceId: 's2', confirmed: true }, tx(store, 'invalidate-2'))
  assert.equal(second.memory.status, 'disabled')
})
