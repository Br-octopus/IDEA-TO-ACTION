import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { appendReview, appendVersion, markStale } from './versions.js'
import { isEligibleUserPreferenceSource } from '../memory/service.js'
import { cleanupTaskLearnedState } from '../memory/history.js'

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

function enqueueUserPreferenceSource(state, { eventId, projectId, taskId, conversationId, locator, kind, excerpt, createdAt }) {
  if (state.learning?.paused === true || !isEligibleUserPreferenceSource(excerpt)) return
  if (!state.learning || !Array.isArray(state.learning.jobs) || !Array.isArray(state.sources)) {
    throw error('storage_failure', '学习来源存储结构无效')
  }

  const sourceDigest = createHash('sha256').update(excerpt, 'utf8').digest('hex')
  const eventDigest = createHash('sha256').update(eventId, 'utf8').digest('hex').slice(0, 32)
  const sourceId = `source:${eventDigest}`
  const jobId = `learn:${eventDigest}`
  if (state.sources.some(source => source?.sourceId === sourceId)
    || state.learning.jobs.some(job => job?.jobId === jobId)) return

  state.sources.push({
    sourceId,
    projectId,
    taskId,
    conversationId,
    locator,
    kind,
    excerpt,
    digest: sourceDigest,
    active: true,
    userAuthored: true,
    createdAt,
  })
  state.learning.jobs.push({
    jobId,
    taskId,
    projectId,
    conversationId,
    sourceRefs: [sourceId],
    status: 'queued',
    attempts: 0,
    createdAt,
  })
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
    enqueueUserPreferenceSource(state, {
      eventId: tx.eventId, projectId, taskId, conversationId: input.conversationId,
      locator: 'task.originalInput', kind: 'user-message', excerpt: input.originalInput, createdAt: now,
    })
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
    if (Object.hasOwn(patch, 'methodState')) {
      const currentWriting = task.methodState?.writing
      const currentRound = currentWriting?.round
      if (currentRound?.packSnapshot) {
        const nextWriting = patch.methodState?.writing
        const nextRound = nextWriting?.round
        const startsNewRound = typeof nextRound?.id === 'string'
          && nextRound.id.length > 0
          && nextRound.id !== currentRound.id
        if (!startsNewRound) {
          if (!nextWriting || !nextRound) throw error('conflict', '专业包快照已冻结；同一写作轮次不可移除')
          const frozenFields = [
            [currentWriting.article?.genre, nextWriting.article?.genre],
            [currentRound.taskType, nextRound.taskType],
            [currentRound.packSelections, nextRound.packSelections],
            [currentRound.packSnapshot, nextRound.packSnapshot],
          ]
          if (frozenFields.some(([current, next]) => !isDeepStrictEqual(current, next))) {
            throw error('conflict', '专业包快照已冻结；文体、任务类型、专业包选择和快照需在新轮次修改')
          }
        }
      }
    }
    const versionableFields = ['domain', 'originalInput', 'currentRequirements', 'methodState', 'materials']
    const changedInput = versionableFields.some(key => Object.hasOwn(patch, key)
      && JSON.stringify(task[key]) !== JSON.stringify(patch[key]))
    if (changedInput && !Object.hasOwn(patch, 'versions')) {
      task.versions = markStale(task, '任务目标、要求、方法状态或材料发生变化；请复查后再使用').versions
    }
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
    source: 'user-pasted',
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
    if (promptVersion.stepId ? promptVersion.stepId !== stepId : stepId !== 'task') {
      throw error('invalid_input', '外部结果必须关联同一步骤的提示词版本')
    }
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

export async function saveReview(store, input, tx) {
  const { projectId, taskId, taskRevision, conversationId, resultVersionId, promptVersionId, verdict, checks = [], feedback = '', confirmed = false } = input ?? {}
  if (![projectId, taskId, conversationId, resultVersionId, promptVersionId].every(value => typeof value === 'string' && value.trim())) {
    throw error('invalid_input', '项目、任务、对话及版本标识不能为空')
  }
  validateWrite(tx)
  const now = new Date().toISOString()
  const result = await transact(store, tx, state => {
    const task = findTask(state, taskId)
    checkTaskRevision(task, taskRevision)
    if (task.projectId !== projectId) throw error('invalid_input', '任务不属于当前项目')
    const binding = state.bindings.filter(item => item.projectId === projectId && item.conversationId === conversationId).at(-1)
    if (!binding || binding.taskId !== taskId) throw error('conflict', '当前对话未绑定此任务')
    const reviewed = appendReview(task, { resultVersionId, promptVersionId, verdict, checks, feedback, confirmed })
    task.reviews = reviewed.reviews
    task.revision += 1
    task.updatedAt = now
    const review = task.reviews.at(-1)
    const reviewExcerpt = [feedback, ...checks.map(item => item.note ?? '')].filter(value => typeof value === 'string' && value.trim()).join('\n')
    enqueueUserPreferenceSource(state, {
      eventId: tx.eventId, projectId, taskId, conversationId,
      locator: `review:${review.reviewId}:feedback`, kind: 'user-feedback', excerpt: reviewExcerpt, createdAt: now,
    })
    return { taskId, reason: '记录任务复盘' }
  })
  const saved = findTask(result, taskId)
  return structuredClone({ task: saved, review: saved.reviews.at(-1), revision: result.revision })
}

export async function savePromptRevision(store, input, tx) {
  const { projectId, taskId, taskRevision, conversationId, stepId, sourceVersionId, content } = input ?? {}
  if (![projectId, taskId, conversationId, stepId, sourceVersionId].every(value => typeof value === 'string' && value.trim())) {
    throw error('invalid_input', '项目、任务、对话、步骤和来源提示词版本不能为空')
  }
  if (typeof content !== 'string' || !content.trim()) throw error('invalid_input', '提示词正文不能为空')
  validateWrite(tx)
  const now = new Date().toISOString()
  const result = await transact(store, tx, state => {
    const task = findTask(state, taskId)
    checkTaskRevision(task, taskRevision)
    if (task.projectId !== projectId) throw error('invalid_input', '任务不属于当前项目')
    const binding = state.bindings.filter(item => item.projectId === projectId && item.conversationId === conversationId).at(-1)
    if (!binding || binding.taskId !== taskId) throw error('conflict', '当前对话未绑定此任务')
    const steps = task.agent?.steps ?? []
    if (stepId !== 'task' && !steps.some(step => step.id === stepId)) throw error('invalid_input', '所选步骤不属于当前任务')
    const parent = task.versions.find(version => version.versionId === sourceVersionId && version.kind !== 'external-result')
    if (!parent || (parent.stepId ? parent.stepId !== stepId : stepId !== 'task')) throw error('invalid_input', '来源提示词版本必须属于同一步骤')
    const next = appendVersion(task, {
      kind: 'prompt',
      requestId: `prompt-edit:${tx.eventId}`,
      eventId: tx.eventId,
      stage: parent.stage,
      stepId,
      parentVersionId: parent.versionId,
      content,
      usedMemories: parent.usedMemories ?? [],
      usedSources: parent.usedSources ?? [],
      omissions: parent.omissions ?? [],
    })
    task.versions = next.versions
    task.revision += 1
    task.updatedAt = now
    return { taskId, reason: '保存提示词新版本' }
  })
  const saved = findTask(result, taskId)
  const version = saved.versions.find(item => item.eventId === tx.eventId)
  if (!version) throw error('idempotency_mismatch', '提示词版本请求已处理，但对应版本不存在')
  return structuredClone({ task: saved, version, revision: result.revision })
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
    clearLearned: clearLearned === true,
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
    cleanupTaskLearnedState(state, taskId, { clearLearned: clearLearned === true })
    for (const job of state.learning?.jobs ?? []) {
      if (job.taskId !== taskId || job.status === 'completed') continue
      job.status = 'cancelled'
      job.cancelledAt = new Date().toISOString()
      delete job.leaseId
      delete job.leaseUntil
    }
    return { taskId, reason: '删除任务' }
  })
  return structuredClone(result)
}
