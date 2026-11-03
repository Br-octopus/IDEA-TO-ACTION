import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { createPromptAgentTask } = require('../vendor/core/prompt-agent-schema.js')
const ENTRY_TYPES = new Set(['advance-idea', 'optimize-prompt', 'diagnose-ai-result'])
const DOMAINS = new Set(['general', 'writing', 'ppt'])

function error(code, message, details) {
  const value = new Error(message)
  value.code = code
  if (details !== undefined) value.impact = details
  return value
}

function validateWrite(tx) {
  if (!tx || !Number.isInteger(tx.expectedRevision) || typeof tx.eventId !== 'string' || !tx.eventId.trim()) {
    throw error('invalid_input', '事务选项必须包含 expectedRevision 和 eventId')
  }
}

async function transact(store, tx, mutate) {
  validateWrite(tx)
  return store.transact(tx.expectedRevision, tx.eventId, state => {
    const result = mutate(state)
    state.changes.push({ eventId: tx.eventId, reason: result.reason, taskId: result.taskId, createdAt: new Date().toISOString() })
    return result
  })
}

function findTask(state, taskId) {
  const task = state.tasks.find(item => item.taskId === taskId)
  if (!task) throw error('invalid_input', `任务不存在: ${taskId}`)
  return task
}

function checkTaskRevision(task, taskRevision) {
  if (!Number.isInteger(taskRevision) || task.revision !== taskRevision) {
    throw error('conflict', '任务版本已变化，请重新读取后再修改')
  }
}

export function canonicalProjectId(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) throw error('invalid_input', '项目目录不能为空')
  let absolute
  try {
    absolute = realpathSync.native(cwd).replaceAll('\\', '/')
  } catch (cause) {
    throw error('invalid_input', `项目目录不存在或不可读取: ${cwd}`, { cause: String(cause) })
  }
  const normalized = process.platform === 'win32' ? absolute.toLowerCase() : absolute
  return createHash('sha256').update(normalized).digest('hex')
}

export async function createTask(store, input, tx) {
  if (!input || typeof input !== 'object') throw error('invalid_input', '任务输入无效')
  if (!ENTRY_TYPES.has(input.entryType)) throw error('invalid_input', '不支持的任务入口类型')
  if (!DOMAINS.has(input.domain)) throw error('invalid_input', '不支持的任务领域')
  if (typeof input.originalInput !== 'string' || !input.originalInput.trim()) throw error('invalid_input', '任务原文不能为空')
  if (typeof input.conversationId !== 'string' || !input.conversationId.trim()) throw error('invalid_input', '对话标识不能为空')
  validateWrite(tx)
  const projectId = canonicalProjectId(input.cwd)
  const taskId = randomUUID()
  const now = new Date().toISOString()
  const task = {
    projectId,
    taskId,
    revision: 1,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : input.originalInput.trim().slice(0, 80),
    entryType: input.entryType,
    domain: input.domain,
    archived: false,
    agent: createPromptAgentTask({ id: taskId, type: input.entryType, goal: input.originalInput }),
    originalInput: input.originalInput,
    currentRequirements: [],
    materials: [],
    methodState: {},
    versions: [],
    reviews: [],
    conversations: [input.conversationId],
    createdAt: now,
    updatedAt: now,
  }
  const result = await transact(store, tx, state => {
    let project = state.projects.find(item => item.projectId === projectId)
    if (!project) {
      project = { projectId, cwd: realpathSync.native(input.cwd), label: task.title, createdAt: now, updatedAt: now }
      state.projects.push(project)
    } else {
      project.updatedAt = now
    }
    state.tasks.push(task)
    const binding = { projectId, taskId, conversationId: input.conversationId, eventId: tx.eventId, createdAt: now }
    state.bindings.push(binding)
    return { taskId, reason: '创建任务' }
  })
  const committed = result.tasks.find(item => item.taskId === taskId)
  if (committed) return structuredClone(committed)
  const replayBinding = result.bindings.find(binding => binding.eventId === tx.eventId)
  return structuredClone(findTask(result, replayBinding?.taskId))
}

export async function updateTask(store, { taskId, taskRevision, patch }, tx) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw error('invalid_input', '任务更新内容无效')
  const immutable = ['projectId', 'taskId', 'revision', 'createdAt']
  if (immutable.some(key => Object.hasOwn(patch, key))) throw error('invalid_input', '任务身份字段不可修改')
  if (Object.keys(patch).some(key => key.startsWith('__'))) throw error('invalid_input', '任务字段名无效')
  const now = new Date().toISOString()
  const result = await transact(store, tx, state => {
    const task = findTask(state, taskId)
    checkTaskRevision(task, taskRevision)
    Object.assign(task, structuredClone(patch))
    task.revision += 1
    task.updatedAt = now
    return { taskId, reason: '更新任务' }
  })
  return structuredClone(findTask(result, taskId))
}

export async function saveExternalResult(store, input, tx) {
  const { projectId, taskId, taskRevision, conversationId, stepId, promptVersionId, content, feedback = '' } = input ?? {}
  if (![projectId, taskId, conversationId, stepId, promptVersionId].every(value => typeof value === 'string' && value.trim())) {
    throw error('invalid_input', '项目、任务、对话、步骤和提示词版本标识不能为空')
  }
  if (typeof content !== 'string' || !content.trim()) throw error('invalid_input', '外部结果不能为空')
  if (typeof feedback !== 'string') throw error('invalid_input', '复盘反馈必须是文本')
  validateWrite(tx)
  const now = new Date().toISOString()
  const externalVersion = {
    versionId: randomUUID(),
    requestId: `external:${tx.eventId}`,
    eventId: tx.eventId,
    kind: 'external-result',
    stage: 'external-result',
    stepId,
    promptVersionId,
    content,
    feedback,
    createdAt: now,
    usedMemories: [],
    usedSources: [],
    omissions: [],
  }
  const result = await transact(store, tx, state => {
    const task = findTask(state, taskId)
    checkTaskRevision(task, taskRevision)
    if (task.projectId !== projectId) throw error('invalid_input', '任务不属于当前项目')
    const binding = state.bindings.filter(item => item.projectId === projectId && item.conversationId === conversationId).at(-1)
    if (!binding || binding.taskId !== taskId) throw error('conflict', '当前对话未绑定此任务')
    const steps = task.agent?.steps ?? []
    if (stepId !== 'task' && !steps.some(step => step.id === stepId)) throw error('invalid_input', '所选步骤不属于当前任务')
    const promptVersion = task.versions.find(version => version.versionId === promptVersionId && version.kind !== 'external-result')
    if (!promptVersion) throw error('invalid_input', '所选提示词版本不属于当前任务或已失效')
    if (!Array.isArray(task.versions)) task.versions = []
    task.versions.push(externalVersion)
    task.revision += 1
    task.updatedAt = now
    return { taskId, reason: '保存外部结果' }
  })
  const saved = findTask(result, taskId)
  const version = saved.versions.find(item => item.eventId === tx.eventId)
  if (!version) throw error('idempotency_mismatch', '外部结果请求已处理，但对应版本不存在')
  return structuredClone(saved)
}
export async function bindTask(store, { projectId, taskId, conversationId }, tx) {
  if (![projectId, taskId, conversationId].every(value => typeof value === 'string' && value.trim())) {
    throw error('invalid_input', '项目、任务和对话标识不能为空')
  }
  const now = new Date().toISOString()
  const result = await transact(store, tx, state => {
    const task = findTask(state, taskId)
    if (task.projectId !== projectId) throw error('invalid_input', '任务不属于指定项目')
    const binding = { projectId, taskId, conversationId, eventId: tx.eventId, createdAt: now }
    state.bindings.push(binding)
    if (!task.conversations.includes(conversationId)) task.conversations.push(conversationId)
    task.updatedAt = now
    return { taskId, reason: '绑定任务到对话' }
  })
  return structuredClone(result.bindings.find(binding => binding.eventId === tx.eventId))
}

export function getCurrentBinding(store, projectId, conversationId) {
  const state = store.read()
  return structuredClone(state.bindings.filter(binding => binding.projectId === projectId && binding.conversationId === conversationId).at(-1) ?? null)
}

export function listTasks(store, { projectId, archived } = {}) {
  if (typeof projectId !== 'string' || !projectId) throw error('invalid_input', '项目标识不能为空')
  const state = store.read()
  return structuredClone(state.tasks
    .filter(task => task.projectId === projectId && (archived === undefined || task.archived === archived))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
}

export async function archiveTask(store, { taskId, taskRevision, archived }, tx) {
  if (typeof archived !== 'boolean') throw error('invalid_input', '归档状态必须为布尔值')
  const now = new Date().toISOString()
  const result = await transact(store, tx, state => {
    const task = findTask(state, taskId)
    checkTaskRevision(task, taskRevision)
    task.archived = archived
    task.revision += 1
    task.updatedAt = now
    return { taskId, reason: archived ? '归档任务' : '恢复任务' }
  })
  return structuredClone(findTask(result, taskId))
}

export function previewDeleteTask(store, { taskId, taskRevision, clearLearned = false }) {
  const state = store.read()
  const task = findTask(state, taskId)
  checkTaskRevision(task, taskRevision)
  return {
    taskId,
    title: task.title,
    bindingCount: state.bindings.filter(binding => binding.taskId === taskId).length,
    versionCount: task.versions.length,
    reviewCount: task.reviews.length,
    memoryCount: clearLearned === true ? state.memories.filter(memory => memory.taskId === taskId).length : 0,
    sourceCount: state.sources.filter(source => source.taskId === taskId).length,
  }
}

export async function deleteTask(store, { taskId, taskRevision, confirmed, clearLearned }, tx) {
  if (confirmed !== true) {
    throw error('confirmation_required', '删除任务需要明确确认', previewDeleteTask(store, { taskId, taskRevision, clearLearned }))
  }
  const result = await transact(store, tx, state => {
    const task = findTask(state, taskId)
    checkTaskRevision(task, taskRevision)
    state.tasks = state.tasks.filter(item => item.taskId !== taskId)
    state.bindings = state.bindings.filter(binding => binding.taskId !== taskId)
    state.sources = state.sources.filter(source => source.taskId !== taskId)
    if (clearLearned === true) state.memories = state.memories.filter(memory => memory.taskId !== taskId)
    return { taskId, reason: '删除任务' }
  })
  return structuredClone(result)
}
