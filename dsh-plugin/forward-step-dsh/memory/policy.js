import { createHash } from 'node:crypto'

const SCOPE_PRIORITY = Object.freeze({
  global: 1,
  domain: 2,
  project: 3,
  task: 4,
  conversation: 5,
})
const MAX_SELECTED = 3
const EXCLUSION_REASONS = new Set([
  'scope', 'domain', 'inactive', 'source', 'suppressed', 'conflict', 'overridden', 'budget',
])

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function belongsToDomain(memory, context) {
  return !Array.isArray(memory.domains) || memory.domains.length === 0 || memory.domains.includes(context.domain)
}

function matchesScope(memory, context) {
  switch (memory.scope) {
    case 'global':
      return true
    case 'domain':
      return Array.isArray(memory.domains) && memory.domains.includes(context.domain)
    case 'project':
      return memory.projectId === context.projectId
    case 'task':
      return memory.projectId === context.projectId && memory.taskId === context.taskId
    case 'conversation':
      return memory.projectId === context.projectId && memory.taskId === context.taskId && memory.conversationId === context.conversationId
    default:
      return false
  }
}

/**
 * 判断一条记忆是否同时适用于当前范围和领域。
 * 未知 scope 一律不通过，避免意外把记忆提升到更宽的上下文。
 */
export function inScope(memory, context) {
  if (!memory || typeof memory !== 'object' || !context || typeof context !== 'object') return false
  return belongsToDomain(memory, context) && matchesScope(memory, context)
}

function validateInput(state, context, options) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.memories) || !Array.isArray(state.sources)) {
    throw codedError('invalid_input', '记忆状态必须包含 memories 和 sources 数组')
  }
  if (!context || typeof context !== 'object' || !['projectId', 'taskId', 'conversationId', 'domain'].every(key => typeof context[key] === 'string' && context[key].trim())) {
    throw codedError('invalid_input', '记忆筛选上下文缺少项目、任务、对话或领域标识')
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw codedError('invalid_input', '记忆筛选选项无效')
  }
  const requestedLimit = options.limit ?? MAX_SELECTED
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 0) {
    throw codedError('invalid_input', '记忆数量预算必须为非负整数')
  }
  if (options.overrides !== undefined && (!Array.isArray(options.overrides) || options.overrides.some(item => !item || typeof item.key !== 'string' || !item.key.trim()))) {
    throw codedError('invalid_input', '当前要求覆盖项必须是含 key 的数组')
  }
  return Math.min(requestedLimit, MAX_SELECTED)
}

function hasActiveSource(memory, activeSourceIds) {
  return Array.isArray(memory.sourceRefs) && memory.sourceRefs.some(sourceId => activeSourceIds.has(sourceId))
}

function isSuppressed(memory, suppressions) {
  const keyDigest = digest(memory.key)
  const valueDigest = digest(memory.value)
  return suppressions.some(item => {
    if (!item || typeof item !== 'object') return false
    if (item.memoryId && item.memoryId === memory.memoryId) return true
    return item.keyDigest === keyDigest && item.valueDigest === valueDigest
  })
}

function addExcluded(excluded, memory, reason) {
  if (!EXCLUSION_REASONS.has(reason)) throw codedError('invalid_input', `未知记忆排除原因: ${reason}`)
  // 不返回 key/value/sourceRefs，避免不适用记忆正文进入侧栏或其他任务响应。
  excluded.push({ memoryId: memory?.memoryId ?? null, reason })
}

/**
 * 选择当前任务可用的记忆。相同 key 只保留最具体的一项；同一优先级存在不同
 * 值时 fail closed，并将该 key 下的候选全部标记为冲突。
 */
export function selectMemories(state, context, options = {}) {
  const limit = validateInput(state, context, options)
  const activeSourceIds = new Set(state.sources
    .filter(source => source && source.active === true && typeof source.sourceId === 'string')
    .map(source => source.sourceId))
  const suppressions = Array.isArray(state.suppressions) ? state.suppressions : []
  const overriddenKeys = new Set((options.overrides ?? []).map(item => item.key))
  const excluded = []
  const eligible = []

  for (const memory of state.memories) {
    if (!memory || typeof memory !== 'object') {
      addExcluded(excluded, null, 'inactive')
      continue
    }
    if (!matchesScope(memory, context)) {
      addExcluded(excluded, memory, 'scope')
      continue
    }
    if (!belongsToDomain(memory, context)) {
      addExcluded(excluded, memory, 'domain')
      continue
    }
    if (memory.status !== 'active') {
      addExcluded(excluded, memory, 'inactive')
      continue
    }
    if (!hasActiveSource(memory, activeSourceIds)) {
      addExcluded(excluded, memory, 'source')
      continue
    }
    if (isSuppressed(memory, suppressions)) {
      addExcluded(excluded, memory, 'suppressed')
      continue
    }
    eligible.push(memory)
  }

  const groups = new Map()
  for (const memory of eligible) {
    if (typeof memory.key !== 'string' || !memory.key.trim()) {
      addExcluded(excluded, memory, 'inactive')
      continue
    }
    const group = groups.get(memory.key) ?? []
    group.push(memory)
    groups.set(memory.key, group)
  }

  const resolved = []
  for (const [key, group] of groups) {
    if (overriddenKeys.has(key)) {
      for (const memory of group) addExcluded(excluded, memory, 'overridden')
      continue
    }
    const highestPriority = Math.max(...group.map(memory => SCOPE_PRIORITY[memory.scope] ?? 0))
    const top = group.filter(memory => (SCOPE_PRIORITY[memory.scope] ?? 0) === highestPriority)
    const values = new Set(top.map(memory => JSON.stringify(memory.value)))
    if (values.size > 1) {
      const topSet = new Set(top)
      for (const memory of group) addExcluded(excluded, memory, topSet.has(memory) ? 'conflict' : 'overridden')
      continue
    }
    const winner = top[0]
    resolved.push(winner)
    for (const memory of group) {
      if (memory !== winner) addExcluded(excluded, memory, 'overridden')
    }
  }

  // 先放更具体的范围，避免宽泛全局记忆占满三条上下文预算。
  resolved.sort((left, right) => (SCOPE_PRIORITY[right.scope] ?? 0) - (SCOPE_PRIORITY[left.scope] ?? 0))
  const selected = []
  for (const memory of resolved) {
    if (selected.length >= limit) {
      addExcluded(excluded, memory, 'budget')
      continue
    }
    selected.push(structuredClone(memory))
  }
  return { selected, excluded }
}
