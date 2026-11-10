import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const FIELDS = new Set(['key', 'value', 'scope', 'domains', 'status', 'reason', 'manualScope', 'sourceRefs'])
const SCOPES = new Set(['global', 'domain', 'project', 'task', 'conversation'])
const digest = value => createHash('sha256').update(String(value), 'utf8').digest('hex')
const clone = value => structuredClone(value)
const time = now => (typeof now === 'function' ? now() : new Date()).toISOString()

function codedError(code, message, impact) {
  const error = new Error(message)
  error.code = code
  if (impact !== undefined) error.impact = impact
  return error
}

function validateTx(tx) {
  if (!tx || !Number.isInteger(tx.expectedRevision) || typeof tx.eventId !== 'string' || !tx.eventId.trim()) {
    throw codedError('invalid_input', '记忆操作必须包含 expectedRevision 和 eventId')
  }
}

function findMemory(state, memoryId) {
  const memory = state.memories.find(item => item.memoryId === memoryId)
  if (!memory) throw codedError('invalid_input', '记忆不存在或已删除')
  return memory
}

function checkRevision(memory, revision) {
  if (!Number.isInteger(revision) || memory.revision !== revision) throw codedError('conflict', '记忆版本已变化，请刷新后重试')
}

function sameScopeIdentity(left, right) {
  if (left.scope !== right.scope || !isDeepStrictEqual(left.domains ?? [], right.domains ?? [])) return false
  if (left.scope === 'global' || left.scope === 'domain') return true
  if (left.projectId !== right.projectId) return false
  if (left.scope === 'project') return true
  if (left.taskId !== right.taskId) return false
  if (left.scope === 'task') return true
  return left.scope === 'conversation' && left.conversationId === right.conversationId
}

function recordChange(state, { eventId, memoryId, before, after, reason, changedFields, now, undoOf }) {
  const change = { eventId, memoryId, before: clone(before), after: clone(after), reason, changedFields: [...changedFields], createdAt: time(now) }
  if (undoOf) change.undoOf = undoOf
  state.changes.push(change)
  return change
}

function addSuppression(state, memory, reason, now) {
  const sourceDigests = (memory.sourceRefs ?? []).map(id => state.sources.find(source => source.sourceId === id)?.digest).filter(value => typeof value === 'string')
  const record = {
    suppressionId: randomUUID(), memoryId: memory.memoryId, keyDigest: digest(memory.key), valueDigest: digest(memory.value),
    sourceDigests: [...new Set(sourceDigests)], reason, createdAt: time(now),
  }
  const duplicate = state.suppressions.find(item => item.keyDigest === record.keyDigest && item.valueDigest === record.valueDigest)
  if (duplicate) {
    duplicate.sourceDigests = [...new Set([...(duplicate.sourceDigests ?? []), ...record.sourceDigests])]
    duplicate.memoryId = memory.memoryId
    duplicate.reason = reason
    return duplicate
  }
  state.suppressions.push(record)
  return record
}

function removeSuppression(state, memory) {
  const keyDigest = digest(memory.key), valueDigest = digest(memory.value)
  state.suppressions = state.suppressions.filter(item => item.keyDigest !== keyDigest || item.valueDigest !== valueDigest)
}

/** 按字段比较撤销基准，不让整条记录的新 revision 阻止可独立补偿的旧字段。 */
export function planUndo(memory, change) {
  const patch = {}, conflicts = []
  const fields = Array.isArray(change?.changedFields) ? change.changedFields : []
  for (const field of fields) {
    if (!FIELDS.has(field)) continue
    if (isDeepStrictEqual(memory?.[field], change.after?.[field])) patch[field] = clone(change.before?.[field])
    else conflicts.push({ field, current: clone(memory?.[field]), before: clone(change.before?.[field]), after: clone(change.after?.[field]) })
  }
  return { patch, conflicts }
}

export async function undoChange(store, input, tx) {
  const state = store.read()
  const change = state.changes.find(item => item.eventId === input.eventId && item.memoryId === input.memoryId)
  if (!change) throw codedError('invalid_input', '找不到可撤销的记忆变更')
  const priorUndo = state.changes.find(item => item.undoOf === input.eventId && item.memoryId === input.memoryId)
  if (priorUndo) return { memory: clone(state.memories.find(item => item.memoryId === input.memoryId) ?? null), change: clone(priorUndo), idempotent: true }
  const memory = findMemory(state, input.memoryId)
  checkRevision(memory, input.memoryRevision)
  const creating = change.before === null
  const planned = creating
    ? { patch: { status: 'disabled' }, conflicts: [] }
    : planUndo(memory, change)
  const resolve = input.resolve ?? {}
  if (planned.conflicts.length) {
    const unresolved = planned.conflicts.filter(item => !['keep', 'restore'].includes(resolve[item.field]))
    if (unresolved.length) return { needsResolution: true, memoryRevision: memory.revision, patch: planned.patch, conflicts: planned.conflicts }
    for (const item of planned.conflicts) if (resolve[item.field] === 'restore') planned.patch[item.field] = clone(item.before)
  }
  validateTx(tx)
  let result
  const next = await store.transact(tx.expectedRevision, tx.eventId, current => {
    const target = findMemory(current, input.memoryId)
    checkRevision(target, input.memoryRevision)
    if (creating) {
      addSuppression(current, target, 'undo_create', input.now)
      planned.patch.status = 'disabled'
    }
    const before = Object.fromEntries(Object.keys(planned.patch).map(field => [field, clone(target[field])]))
    for (const [field, value] of Object.entries(planned.patch)) target[field] = clone(value)
    target.revision += 1
    target.updatedAt = time(input.now)
    result = { memory: clone(target), idempotent: false }
    result.change = recordChange(current, { eventId: tx.eventId, memoryId: target.memoryId, before, after: Object.fromEntries(Object.keys(planned.patch).map(field => [field, clone(target[field])])), reason: 'undo', changedFields: Object.keys(planned.patch), now: input.now, undoOf: input.eventId })
  })
  if (!result) result = { memory: clone(next.memories.find(item => item.memoryId === input.memoryId)), change: clone(next.changes.find(item => item.undoOf === input.eventId)), idempotent: true }
  return result
}

export async function editMemory(store, input, tx) {
  const patch = input?.patch
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(field => !FIELDS.has(field) || ['status', 'manualScope', 'sourceRefs'].includes(field))) {
    throw codedError('invalid_input', '记忆编辑字段无效')
  }
  if (Object.hasOwn(patch, 'value') && (typeof patch.value !== 'string' || !patch.value.trim() || patch.value.length > 500)) throw codedError('invalid_input', '记忆值必须为 1–500 字符')
  if (Object.hasOwn(patch, 'scope') && !SCOPES.has(patch.scope)) throw codedError('invalid_input', '记忆范围无效')
  if (Object.hasOwn(patch, 'domains') && (!Array.isArray(patch.domains) || patch.domains.some(value => !['general', 'writing', 'ppt'].includes(value)))) throw codedError('invalid_input', '记忆领域无效')
  const existingState = store.read()
  const existingMemory = findMemory(existingState, input.memoryId)
  checkRevision(existingMemory, input.memoryRevision)
  if (Object.entries(patch).every(([field, value]) => isDeepStrictEqual(existingMemory[field], value))) return { memory: clone(existingMemory), unchanged: true }
  validateTx(tx)
  let output
  const next = await store.transact(tx.expectedRevision, tx.eventId, state => {
    const memory = findMemory(state, input.memoryId)
    checkRevision(memory, input.memoryRevision)
    const before = {}, changedFields = []
    for (const [field, value] of Object.entries(patch)) {
      if (isDeepStrictEqual(memory[field], value)) continue
      before[field] = clone(memory[field])
      memory[field] = clone(value)
      changedFields.push(field)
    }
    if (!changedFields.length) { output = { memory: clone(memory), unchanged: true }; return }
    if (changedFields.includes('value') || changedFields.includes('key')) addSuppression(state, { ...memory, ...before }, 'user_edit', input.now)
    if (changedFields.includes('scope') || changedFields.includes('domains')) memory.manualScope = true
    if (memory.status === 'active') removeSuppression(state, memory)
    memory.revision += 1
    memory.updatedAt = time(input.now)
    const after = Object.fromEntries(changedFields.map(field => [field, clone(memory[field])]))
    if ((changedFields.includes('scope') || changedFields.includes('domains')) && !changedFields.includes('manualScope')) { before.manualScope = false; after.manualScope = true; changedFields.push('manualScope') }
    output = { memory: clone(memory), change: recordChange(state, { eventId: tx.eventId, memoryId: memory.memoryId, before, after, reason: 'user_edit', changedFields, now: input.now }) }
  })
  return output ?? { memory: clone(next.memories.find(item => item.memoryId === input.memoryId)), idempotent: true }
}

export async function setMemoryStatus(store, input, tx) {
  if (!['active', 'disabled'].includes(input?.status)) throw codedError('invalid_input', '记忆状态只支持 active 或 disabled')
  const existingState = store.read()
  const existingMemory = findMemory(existingState, input.memoryId)
  checkRevision(existingMemory, input.memoryRevision)
  if (existingMemory.status === input.status) return { memory: clone(existingMemory), unchanged: true }
  validateTx(tx)
  let output
  const next = await store.transact(tx.expectedRevision, tx.eventId, state => {
    const memory = findMemory(state, input.memoryId)
    checkRevision(memory, input.memoryRevision)
    if (memory.status === input.status) { output = { memory: clone(memory), unchanged: true }; return }
    const before = { status: memory.status }
    if (input.status === 'active') {
      for (const other of state.memories) {
        if (other.memoryId === memory.memoryId || other.key !== memory.key || other.status !== 'active' || isDeepStrictEqual(other.value, memory.value)) continue
        if (!sameScopeIdentity(other, memory)) continue
        const priorStatus = other.status
        addSuppression(state, other, 'user_conflict_resolved', input.now)
        other.status = 'disabled'
        other.revision += 1
        other.updatedAt = time(input.now)
        recordChange(state, { eventId: `${tx.eventId}:resolve:${other.memoryId}`, memoryId: other.memoryId, before: { status: priorStatus }, after: { status: 'disabled' }, reason: 'user_conflict_resolved', changedFields: ['status'], now: input.now })
      }
    }
    memory.status = input.status
    if (input.status === 'disabled') addSuppression(state, memory, 'user_disabled', input.now)
    else removeSuppression(state, memory)
    memory.revision += 1
    memory.updatedAt = time(input.now)
    output = { memory: clone(memory), change: recordChange(state, { eventId: tx.eventId, memoryId: memory.memoryId, before, after: { status: memory.status }, reason: input.status === 'disabled' ? 'user_disabled' : 'user_restored', changedFields: ['status'], now: input.now }) }
  })
  return output ?? { memory: clone(next.memories.find(item => item.memoryId === input.memoryId)), idempotent: true }
}

function scrubSourceCopies(state, sourceIds) {
  const ids = new Set(sourceIds)
  const scrub = value => {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.filter(item => !ids.has(item)).map(scrub)
    for (const [key, item] of Object.entries(value)) {
      if (key === 'sourceRefs' && Array.isArray(item)) value[key] = item.filter(id => !ids.has(id))
      else value[key] = scrub(item)
    }
    return value
  }
  for (const change of state.changes) {
    change.before = scrub(change.before)
    change.after = scrub(change.after)
  }
  for (const job of state.learning?.jobs ?? []) {
    if ((job.sourceRefs ?? []).some(id => ids.has(id))) {
      delete job.summary
      job.auditRedacted = true
    }
    job.sourceRefs = (job.sourceRefs ?? []).filter(id => !ids.has(id))
  }
}

function redactMemoryHistory(state, memoryId) {
  for (const change of state.changes) {
    if (change.memoryId !== memoryId) continue
    change.before = null
    change.after = null
    change.changedFields = []
    change.auditRedacted = true
  }
}

export function previewDeleteMemory(state, memoryId) {
  const memory = state.memories.find(item => item.memoryId === memoryId)
  if (!memory) throw codedError('invalid_input', '记忆不存在或已删除')
  const otherMemoryRefs = (memory.sourceRefs ?? []).filter(sourceId => state.memories.some(item => item.memoryId !== memoryId && item.sourceRefs?.includes(sourceId)))
  return { memoryId, sourceCount: (memory.sourceRefs ?? []).length, exclusivelyOwnedSourceCount: (memory.sourceRefs ?? []).length - otherMemoryRefs.length, changeCount: state.changes.filter(change => change.memoryId === memoryId).length }
}

export async function deleteMemory(store, input, tx) {
  const state = store.read()
  const memory = findMemory(state, input?.memoryId)
  checkRevision(memory, input.memoryRevision)
  const impact = previewDeleteMemory(state, input.memoryId)
  if (input.confirmed !== true) throw codedError('confirmation_required', '删除记忆需要明确确认；将清理记忆正文、历史副本和专属来源摘录，不影响 DSH 原始对话或用户备份', impact)
  validateTx(tx)
  const next = await store.transact(tx.expectedRevision, tx.eventId, current => {
    const target = findMemory(current, input.memoryId)
    checkRevision(target, input.memoryRevision)
    addSuppression(current, target, 'user_deleted', input.now)
    const sourceIds = target.sourceRefs ?? []
    current.memories = current.memories.filter(item => item.memoryId !== target.memoryId)
    redactMemoryHistory(current, target.memoryId)
    const exclusive = sourceIds.filter(sourceId => !current.memories.some(item => item.sourceRefs?.includes(sourceId)))
    if (exclusive.length) {
      current.sources = current.sources.filter(source => !exclusive.includes(source.sourceId))
      scrubSourceCopies(current, exclusive)
    }
  })
  return { deleted: !next.memories.some(item => item.memoryId === input.memoryId), memoryId: input.memoryId, revision: next.revision, impact }
}

function taskOfSource(state, source) {
  return state.tasks.find(task => task.taskId === source.taskId)
}

function narrowScopeFromSources(state, memory, sources) {
  if (memory.manualScope || !sources.length) return memory.scope
  const taskIds = [...new Set(sources.map(source => source.taskId).filter(Boolean))]
  const domains = [...new Set(sources.map(source => taskOfSource(state, source)?.domain).filter(Boolean))]
  const inferred = taskIds.length < 2 ? 'task' : domains.length === 1 ? 'domain' : 'global'
  const rank = { global: 1, domain: 2, project: 3, task: 4, conversation: 5 }
  return (rank[inferred] ?? 0) > (rank[memory.scope] ?? 0) ? inferred : memory.scope
}

function invalidateSourceInState(state, source, now) {
  source.active = false
  source.invalidatedAt = time(now)
  const affected = []
  for (const memory of state.memories) {
    if (!memory.sourceRefs?.includes(source.sourceId)) continue
    const before = { status: memory.status, scope: memory.scope, domains: clone(memory.domains ?? []) }
    const remaining = (memory.sourceRefs ?? []).map(id => state.sources.find(item => item.sourceId === id)).filter(item => item?.active === true)
    if (!remaining.length) {
      memory.status = 'disabled'
      addSuppression(state, memory, 'source_invalidated', now)
    } else {
      memory.scope = narrowScopeFromSources(state, memory, remaining)
      if (memory.scope !== 'domain') memory.domains = []
      else memory.domains = [...new Set(remaining.map(item => taskOfSource(state, item)?.domain).filter(Boolean))]
    }
    const changedFields = ['status', 'scope', 'domains'].filter(field => !isDeepStrictEqual(before[field], memory[field]))
    if (!changedFields.length) continue
    memory.revision += 1
    memory.updatedAt = time(now)
    affected.push({ memory: clone(memory), change: recordChange(state, { eventId: `source:${source.sourceId}:${txEvent(now)}`, memoryId: memory.memoryId, before, after: { status: memory.status, scope: memory.scope, domains: clone(memory.domains ?? []) }, reason: 'source_invalidated', changedFields, now }) })
  }
  return affected
}

const txEvent = now => `${typeof now === 'function' ? now().getTime() : Date.now()}`

export async function invalidateSource(store, input, tx) {
  const state = store.read()
  const source = state.sources.find(item => item.sourceId === input?.sourceId)
  if (!source) throw codedError('invalid_input', '学习来源不存在')
  if (input.confirmed !== true) throw codedError('confirmation_required', '使来源失效需要明确确认', { sourceId: source.sourceId, affectedMemoryCount: state.memories.filter(memory => memory.sourceRefs?.includes(source.sourceId)).length })
  validateTx(tx)
  let affected = []
  const next = await store.transact(tx.expectedRevision, tx.eventId, current => {
    const target = current.sources.find(item => item.sourceId === input.sourceId)
    if (!target) throw codedError('invalid_input', '学习来源不存在')
    if (target.active) affected = invalidateSourceInState(current, target, input.now)
  })
  return { source: clone(next.sources.find(item => item.sourceId === input.sourceId)), memories: affected, memory: affected[0]?.memory ?? null, revision: next.revision }
}

/** 供删除任务事务内调用，任务本身与学习来源清理保持原子。 */
export function cleanupTaskLearnedState(state, taskId, { clearLearned = false, now } = {}) {
  const taskSources = state.sources.filter(source => source.taskId === taskId)
  if (!clearLearned) {
    for (const source of taskSources) {
      source.taskRemoved = true
      source.locator = `已移除任务：${source.locator ?? source.sourceId}`
    }
    return { retainedSourceCount: taskSources.length, deletedMemoryCount: 0 }
  }
  let deletedMemoryCount = 0
  for (const source of taskSources) {
    if (source.active) invalidateSourceInState(state, source, now)
  }
  for (const source of taskSources) {
    for (const memory of [...state.memories]) {
      if (!memory.sourceRefs?.includes(source.sourceId)) continue
      const beforeRefs = clone(memory.sourceRefs)
      memory.sourceRefs = memory.sourceRefs.filter(id => id !== source.sourceId)
      const remaining = memory.sourceRefs.map(id => state.sources.find(item => item.sourceId === id)).filter(item => item?.active === true)
      if (memory.taskId === taskId && !remaining.length) {
        addSuppression(state, memory, 'task_deleted', now)
        state.memories = state.memories.filter(item => item.memoryId !== memory.memoryId)
        redactMemoryHistory(state, memory.memoryId)
        deletedMemoryCount += 1
      } else {
        const before = { sourceRefs: beforeRefs, scope: memory.scope, domains: clone(memory.domains ?? []) }
        memory.scope = narrowScopeFromSources(state, memory, remaining)
        if (memory.scope !== 'domain') memory.domains = []
        memory.revision += 1
        memory.updatedAt = time(now)
        recordChange(state, { eventId: `task-delete:${taskId}:${memory.memoryId}:${memory.revision}`, memoryId: memory.memoryId, before, after: { sourceRefs: clone(memory.sourceRefs), scope: memory.scope, domains: clone(memory.domains ?? []) }, reason: 'task_deleted', changedFields: ['sourceRefs', 'scope', 'domains'], now })
      }
    }
  }
  const sourceIds = taskSources.map(source => source.sourceId)
  scrubSourceCopies(state, sourceIds)
  state.sources = state.sources.filter(source => !sourceIds.includes(source.sourceId))
  state.learning.processedSourceDigests = (state.learning?.processedSourceDigests ?? []).filter(digest => !taskSources.some(source => source.digest === digest))
  return { retainedSourceCount: 0, deletedMemoryCount }
}
