import { randomUUID } from 'node:crypto'
import { buildContext } from './context.js'
import { buildMethodPrompt } from './methods.js'
import { getCurrentBinding, updateTask } from './tasks.js'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createPromptAgentCoordinator } = require('../vendor/core/prompt-agent-coordinator.js')

const activeRuns = new Map()

function failure(code, message) {
  return Object.assign(new Error(message), { code })
}

function normalizeResult(value) {
  if (typeof value === 'string') return value
  if (value && typeof value.text === 'string') return value.text
  if (value && Array.isArray(value.content)) {
    return value.content.filter(item => item?.type === 'text').map(item => item.text ?? '').join('')
  }
  throw failure('invalid_result', 'Agent 返回了无法保存的结果')
}

function findTask(state, taskId) {
  const task = state.tasks.find(item => item.taskId === taskId)
  if (!task) throw failure('invalid_input', '任务不存在')
  return task
}

export function cancelAgentRun(requestId, reason = '用户取消了本次 Agent 运行') {
  const run = activeRuns.get(requestId)
  if (!run) return false
  run.controller.abort(failure('cancelled', reason))
  return true
}

export async function runAgent({
  store,
  taskId,
  taskRevision,
  stage,
  requestId = randomUUID(),
  projectId,
  conversationId,
  memories = [],
  sources = [],
  maxChars,
  signal,
  generate,
} = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.transact !== 'function') throw failure('invalid_input', 'Agent 缺少有效存储')
  if (typeof generate !== 'function') throw failure('invalid_input', 'Agent 缺少模型调用函数')
  if (typeof requestId !== 'string' || !requestId.trim()) throw failure('invalid_input', 'requestId 不能为空')
  if (activeRuns.has(requestId)) throw failure('conflict', '相同 requestId 正在运行')

  const initial = store.read()
  const replayEventId = `agent-run:${requestId}`
  if (initial.processedEvents.includes(replayEventId)) {
    const saved = findTask(initial, taskId)
    const version = saved.versions.find(item => item.requestId === requestId)
    if (!version) throw failure('idempotency_mismatch', '请求已标记处理，但对应结果版本不存在')
    return { requestId, duplicate: true, task: saved, version }
  }
  const task = findTask(initial, taskId)
  const project = initial.projects.find(item => item.projectId === task.projectId)
  if (!Number.isInteger(taskRevision) || task.revision !== taskRevision) throw failure('conflict', '任务版本已变化，请重新读取后再运行')
  if (projectId !== undefined && task.projectId !== projectId) throw failure('invalid_input', '任务不属于当前项目')
  if (conversationId !== undefined) {
    if (typeof projectId !== 'string' || !projectId) throw failure('invalid_input', '校验对话绑定时必须提供项目标识')
    const binding = getCurrentBinding(store, projectId, conversationId)
    if (!binding || binding.taskId !== taskId) throw failure('conflict', '当前对话已切换到其他任务')
  }

  const controller = new AbortController()
  const composedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const run = { controller, taskId, taskRevision, startedAt: new Date().toISOString() }
  activeRuns.set(requestId, run)
  const throwIfAborted = () => {
    if (composedSignal.aborted) throw composedSignal.reason ?? failure('cancelled', 'Agent 运行已取消')
  }
  const onAbort = () => controller.abort(signal.reason ?? failure('cancelled', 'Agent 运行已取消'))
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    throwIfAborted()
    const methodPrompt = buildMethodPrompt(task, stage)
    const memoryContext = typeof conversationId === 'string' && conversationId.trim()
      ? { projectId: task.projectId, taskId: task.taskId, conversationId, domain: task.domain }
      : undefined
    const context = buildContext({
      task, stage, methodPrompt, memories, sources,
      ...(memoryContext ? { memoryState: initial, memoryContext, overrides: task.methodState?.currentOverrides ?? [] } : {}),
      ...(maxChars === undefined ? {} : { maxChars }),
    })
    const coordinator = createPromptAgentCoordinator({
      timeoutMs: 120_000,
      requestModel: request => generate(request.messages, {
        signal: request.signal,
        requestId,
        taskId,
        stage: request.stage,
        cwd: project?.cwd,
        preparedRequest: true,
      }),
    })
    const legacyTask = {
      id: task.taskId,
      type: task.entryType,
      domain: task.domain,
      goal: task.originalInput,
      target: task.target ?? '',
      currentState: task.currentState ?? '',
      constraints: (task.currentRequirements ?? []).join('\n'),
      successCriteria: task.successCriteria ?? [],
      preserveItems: task.preserveItems ?? [],
      facts: task.facts ?? [],
      assumptions: task.assumptions ?? [],
      missingInfo: task.missingInfo ?? [],
      steps: task.agent?.steps ?? [],
      currentStepId: task.agent?.currentStepId ?? '',
      review: task.reviews?.at(-1) ?? task.agent?.review ?? {},
    }
    const coordinated = await coordinator.runStage(legacyTask, {
      stage,
      runId: requestId,
      signal: composedSignal,
      preparedRequest: {
        messages: context.messages,
        selectedSources: sources,
      },
    })
    throwIfAborted()
    if (coordinated.error) {
      const code = coordinated.error.code === 'timeout' ? 'model_timeout'
        : coordinated.error.code === 'cancelled' ? 'cancelled'
          : coordinated.error.code ?? 'model_failure'
      throw failure(code, coordinated.error.message || 'Prompt Agent 执行失败')
    }
    const content = normalizeResult(coordinated.draft)
    if (!content.trim()) throw failure('invalid_result', 'Agent 返回空结果')

    const current = store.read()
    const latest = findTask(current, taskId)
    if (latest.revision !== taskRevision) throw failure('conflict', 'Agent 运行期间任务已变化，已丢弃迟到结果')
    if (conversationId !== undefined) {
      const binding = getCurrentBinding(store, projectId, conversationId)
      if (!binding || binding.taskId !== taskId) throw failure('conflict', 'Agent 运行期间当前对话已切换任务，已丢弃结果')
    }

    const createdAt = new Date().toISOString()
    const version = {
      versionId: randomUUID(),
      requestId,
      stage,
      content,
      createdAt,
      usedMemories: context.usedMemories,
      usedSources: context.usedSources,
      omissions: context.omissions,
    }
    const methodState = {
      ...(latest.methodState ?? {}),
      [stage]: { requestId, prompt: methodPrompt, updatedAt: createdAt },
    }
    const savedTask = await updateTask(store, {
      taskId,
      taskRevision,
      patch: { versions: [...(latest.versions ?? []), version], methodState },
    }, { expectedRevision: current.revision, eventId: replayEventId })
    return { requestId, duplicate: false, task: savedTask, version }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (activeRuns.get(requestId) === run) activeRuns.delete(requestId)
  }
}
