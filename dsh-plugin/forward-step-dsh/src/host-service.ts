import { cwd as getHostWorkingDirectory, env as processEnv } from 'node:process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Remote, bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertGatewayBinding } from '@deepseek-ai/dsh-typert-protocol'
import { defineDomain, domainTable, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { ProbeInput, ProbeOutput, ProbeWaitInput, ProbeStorageOutput, ProbeAgentIsolationOutput, ListTasksInput, ListTasksOutput, CreateTaskInput, CreateTaskOutput, BindTaskInput, BindTaskOutput, GetCurrentBindingInput, GetCurrentBindingOutput, ListProvidersOutput, ListModelsInput, ListModelsOutput, RunTaskInput, RunTaskOutput, CancelTaskInput, CancelTaskOutput, UpdateTaskInput, UpdateTaskOutput, ArchiveTaskInput, ArchiveTaskOutput, PreviewDeleteTaskInput, PreviewDeleteTaskOutput, DeleteTaskInput, DeleteTaskOutput, SaveExternalResultInput, SaveExternalResultOutput, RealModelIsolationInput, RealModelIsolationOutput } from './types.js'

function messageFingerprint(messages: readonly unknown[]): string {
  let hash = 2166136261
  for (const character of JSON.stringify(messages)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

type AgentMessage = {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly source: { readonly kind: 'user' }
}

type ProbeAgentHandle = {
  readonly agent: {
    readonly session: { readonly id: string; snapshotEvents(): readonly { readonly type: string; readonly data?: any }[] }
    readonly options?: { readonly provider?: string; readonly model?: string }
    readonly status?: string
    readonly inbox?: { readonly nextTurn: readonly unknown[]; readonly nextStep?: readonly unknown[] }
    readonly ctx?: { on(name: string, listener: (payload: any, next: () => Promise<unknown>) => unknown): unknown }
    followup(message: AgentMessage): void
    whenIdle(): Promise<void>
    cancel(cause: { readonly kind: 'user' } | { readonly kind: 'disposed' }): void
  }
  dispose(): Promise<void>
}

type AgentRegistry = {
  create(options: {
    readonly sessionId: string
    readonly meta?: { readonly cwd?: string }
    readonly agentOptions: { readonly provider: string; readonly model: string; readonly maxTokens: number }
    readonly signal?: AbortSignal
    readonly setup?: (agentContext: { readonly tools: { restrict(filter: { readonly allow: readonly string[] }): () => void } }) => void
  }): Promise<ProbeAgentHandle>
}

type RealModelCapturedRequest = {
  readonly sessionId: string | undefined
  readonly purpose: 'compaction' | 'session-title' | undefined
  readonly provider: string | undefined
  readonly model: string | undefined
  readonly messageCount: number
  readonly roles: readonly string[]
  readonly textBytes: number
  readonly messageDigest: string
  readonly containsTaskA: boolean
  readonly containsTaskB: boolean
}

type CapturedRequest = {
  readonly sessionId: string | undefined
  readonly purpose: 'compaction' | 'session-title' | undefined
  readonly containsTaskA: boolean
  readonly containsTaskB: boolean
}

type AdapterRequest = {
  readonly sessionId?: string
  readonly purpose?: 'compaction' | 'session-title'
  readonly messages: readonly { readonly content?: readonly { readonly type?: string; readonly text?: string }[] }[]
  readonly signal?: AbortSignal
}
type ObservedLlmRequest = {
  readonly sessionId?: string
  readonly purpose?: 'compaction' | 'session-title'
  readonly provider?: string
  readonly model?: string
  readonly messages: readonly { readonly role?: string; readonly content?: string | readonly { readonly type?: string; readonly text?: string }[] }[]
}

type CaptureAdapter = {
  providerInfo(provider: string): { id: string; name: string }
  providerRetryPolicy(): undefined
  imageRequestPricing(): undefined
  listModels(provider: string): Promise<readonly { provider: string; id: string; name: string }[]>
  resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<{ provider: string; id: string; name: string }>
  prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{
    model: { provider: string; id: string; name: string }
    stream(options: AdapterRequest): AsyncIterable<unknown>
  }>
  stream(options: AdapterRequest): AsyncIterable<unknown>
}

type LlmRuntime = {
  stream(options: any): AsyncIterable<any>
  listProviders(): { id: string; name?: string }[]
  listModels(provider: string): Promise<readonly { provider: string; id: string; name?: string }[]>
  registerAdapter(providers: string[], adapter: CaptureAdapter): () => void
}

const runtimeRequire = createRequire(import.meta.url)
const { createDomainStore } = runtimeRequire('../core/store.js')
const taskOperations = runtimeRequire('../core/tasks.js')
const { runAgent, cancelAgentRun } = runtimeRequire('../core/agent.js')

const forwardStepDomainSpec = defineDomain({
  name: 'forward_step_dsh_tasks', version: 1, layout: 'single',
  tables: { state: domainTable(z.object({ schemaVersion: z.number().int(), revision: z.number().int(), projects: z.array(z.unknown()), tasks: z.array(z.unknown()), bindings: z.array(z.unknown()), memories: z.array(z.unknown()), changes: z.array(z.unknown()), suppressions: z.array(z.unknown()), sources: z.array(z.unknown()), learning: z.unknown(), processedEvents: z.array(z.string()) })) },
})

const probeDomainSpec = defineDomain({
  name: 'forward_step_dsh_probe',
  version: 1,
  layout: 'single',
  tables: {
    state: domainTable(z.object({ marker: z.string() })),
  },
})

/** 仅用于阶段一验证 Host/Client RPC、取消、宿主持久化与 Agent/Session 隔离。 */
export class ForwardStepProbe {
  readonly typertRemote: TypertGatewayBinding<ForwardStepProbe> = bindTypertRemote(this, 'forwardStepProbe')
  private domainPromise?: Promise<Domain<typeof probeDomainSpec>>
  private readonly activeWaits = new Set<(reason: string) => void>()
  private readonly activeIsolationRuns = new Map<() => void, Promise<void>>()
  private disposed = false
  private disposePromise?: Promise<void>
  private taskStorePromise?: Promise<any>
  private taskStore?: any
  private readonly activeTaskRuns = new Map<AbortController, Promise<void>>()
  private readonly activeStorageWrites = new Set<Promise<unknown>>()
  private activeRealModelAudit?: { taskAMarker: string; taskBMarker: string; requests: RealModelCapturedRequest[] }

  constructor(
    private readonly storageDomain: Pick<DomainFacility, 'open'>,
    private readonly agents?: AgentRegistry,
    private readonly llm?: LlmRuntime,
  ) {}

  private assertActive(): void {
    if (this.disposed) throw Object.assign(new Error('插件 Host service 已卸载'), { code: 'service_disposed' })
  }

  private async openTaskStore(): Promise<any> {
    this.assertActive()
    if (this.taskStore) return this.taskStore
    if (!this.taskStorePromise) {
      const pending = (async () => {
        const domain = await this.storageDomain.open(forwardStepDomainSpec)
        const store = createDomainStore(domain)
        try {
          await store.initialize()
          this.assertActive()
          this.taskStore = store
          return store
        } catch (error) {
          await store.close()
          throw error
        }
      })()
      this.taskStorePromise = pending
      void pending.catch(() => { if (this.taskStorePromise === pending) this.taskStorePromise = undefined })
    }
    return this.taskStorePromise
  }

  private async generate(
    messages: { role: string; content: string }[],
    provider: string,
    model: string,
    options: { signal: AbortSignal; cwd?: string },
  ): Promise<string> {
    if (!this.agents || typeof this.agents.create !== 'function') throw Object.assign(new Error('DSH Agent 服务不可用'), { code: 'agent_unavailable' })
    if (!this.llm || typeof this.llm.listModels !== 'function') throw Object.assign(new Error('DSH LLM 服务不可用'), { code: 'model_unavailable' })
    if (!provider || !model) throw Object.assign(new Error('请先在侧栏明确选择模型提供方和模型'), { code: 'model_selection_required' })
    if (!this.llm.listProviders().some(item => item.id === provider)) throw Object.assign(new Error('所选模型提供方当前不可用，请重新选择'), { code: 'model_unavailable' })
    const models = await this.llm.listModels(provider)
    if (!models.some(item => item.id === model && item.provider === provider)) throw Object.assign(new Error('所选模型不属于当前提供方或已不可用，请重新选择'), { code: 'model_unavailable' })
    if (options.signal.aborted) throw options.signal.reason ?? Object.assign(new Error('Agent 调用已取消'), { code: 'cancelled' })
    const text = messages.map(message => {
      if (!['system', 'user', 'assistant'].includes(message.role)) throw Object.assign(new Error('不支持的消息角色：' + message.role), { code: 'invalid_message' })
      return '### ' + message.role + '\n' + message.content
    }).join('\n\n')
    if (!text.trim()) throw Object.assign(new Error('Agent 输入为空'), { code: 'invalid_input' })

    const handle = await this.agents.create({
      sessionId: randomUUID(),
      ...(options.cwd ? { meta: { cwd: options.cwd } } : {}),
      agentOptions: { provider, model, maxTokens: 4096 },
      signal: options.signal,
      setup: (agentContext: { readonly tools: { restrict(filter: { readonly allow: readonly string[] }): () => void } }) => {
        agentContext.tools.restrict({ allow: [] })
      },
    })
    const cancel = () => handle.agent.cancel({ kind: 'user' })
    options.signal.addEventListener('abort', cancel, { once: true })
    try {
      if (options.signal.aborted) cancel()
      handle.agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      })
      await handle.agent.whenIdle()
      if (options.signal.aborted) throw options.signal.reason ?? Object.assign(new Error('Agent 调用已取消'), { code: 'cancelled' })
      const events = handle.agent.session.snapshotEvents()
      const endedTurn = events.filter(event => event.type === 'turn/end').at(-1)
      const reason = endedTurn?.data?.reason
      if (reason?.kind === 'error') throw Object.assign(new Error(reason.error?.message ?? 'DSH Agent 运行失败'), { code: reason.error?.code ?? 'agent_failure' })
      if (reason?.kind === 'aborted') throw Object.assign(new Error('DSH Agent 运行已取消'), { code: 'cancelled' })
      if (reason?.kind !== 'completed' && reason?.kind !== 'max-tokens') throw Object.assign(new Error('DSH Agent 未完成本轮生成'), { code: 'agent_incomplete' })
      const turn = endedTurn?.data?.turn ?? -1
      const content = events
        .filter(event => event.type === 'assistant/message' && event.data?.turn === turn)
        .flatMap(event => Array.isArray(event.data?.message?.content) ? event.data.message.content : [])
        .filter(item => item?.type === 'text' && typeof item.text === 'string')
        .map(item => item.text)
        .join('')
      if (!content.trim()) throw Object.assign(new Error('DSH Agent 未返回可保存的文本结果'), { code: 'invalid_result' })
      return content
    } finally {
      options.signal.removeEventListener('abort', cancel)
      await handle.dispose()
    }
  }

  @Remote('listProviders')
  listProviders(): ListProvidersOutput {
    this.assertActive()
    if (!this.llm || typeof this.llm.listProviders !== 'function') throw Object.assign(new Error('DSH LLM 服务不可用'), { code: 'model_unavailable' })
    return { providers: this.llm.listProviders().map(item => ({ id: item.id, name: item.name ?? item.id })) }
  }

  @Remote('listModels')
  async listModels(input: ListModelsInput): Promise<ListModelsOutput> {
    this.assertActive()
    if (!this.llm || typeof this.llm.listModels !== 'function') throw Object.assign(new Error('DSH LLM 服务不可用'), { code: 'model_unavailable' })
    if (!this.llm.listProviders().some(item => item.id === input.provider)) throw Object.assign(new Error('模型提供方不存在或不可用'), { code: 'model_unavailable' })
    return { models: (await this.llm.listModels(input.provider)).map(item => ({ provider: item.provider, id: item.id, name: item.name ?? item.id })) }
  }

  @Remote('listTasks')
  async listTasks(input: ListTasksInput): Promise<ListTasksOutput> {
    this.assertActive()
    const store = await this.openTaskStore()
    const projectId = taskOperations.canonicalProjectId(input.cwd)
    return { projectId, revision: store.read().revision, tasks: taskOperations.listTasks(store, { projectId, archived: input.archived }) }
  }

  @Remote('createTask')
  async createTask(input: CreateTaskInput): Promise<CreateTaskOutput> {
    this.assertActive()
    const store = await this.openTaskStore()
    this.assertActive()
    const operation = taskOperations.createTask(store, input, { expectedRevision: store.read().revision, eventId: input.eventId ?? randomUUID() })
    this.activeStorageWrites.add(operation)
    try {
      const task = await operation
      return { task, revision: store.read().revision }
    } finally { this.activeStorageWrites.delete(operation) }
  }

  private assertCurrentTask(store: any, input: { projectId: string; taskId: string; conversationId: string }): void {
    if (!input.projectId || !input.taskId || !input.conversationId) throw Object.assign(new Error('项目、任务和对话标识不能为空'), { code: 'invalid_input' })
    const binding = taskOperations.getCurrentBinding(store, input.projectId, input.conversationId)
    if (!binding || binding.taskId !== input.taskId) throw Object.assign(new Error('当前对话未绑定此任务'), { code: 'conflict' })
    const task = taskOperations.listTasks(store, { projectId: input.projectId }).find((item: any) => item.taskId === input.taskId)
    if (!task) throw Object.assign(new Error('任务不属于当前项目或已被删除'), { code: 'invalid_input' })
  }

  @Remote('updateTask')
  async updateTask(input: UpdateTaskInput): Promise<UpdateTaskOutput> {
    this.assertActive()
    const store = await this.openTaskStore()
    this.assertCurrentTask(store, input)
    const operation = taskOperations.updateTask(store, input, { expectedRevision: store.read().revision, eventId: input.eventId ?? randomUUID() })
    this.activeStorageWrites.add(operation)
    try { const task = await operation; return { task, revision: store.read().revision } }
    finally { this.activeStorageWrites.delete(operation) }
  }

  @Remote('archiveTask')
  async archiveTask(input: ArchiveTaskInput): Promise<ArchiveTaskOutput> {
    this.assertActive()
    const store = await this.openTaskStore()
    this.assertCurrentTask(store, input)
    const operation = taskOperations.archiveTask(store, input, { expectedRevision: store.read().revision, eventId: input.eventId ?? randomUUID() })
    this.activeStorageWrites.add(operation)
    try { const task = await operation; return { task, revision: store.read().revision } }
    finally { this.activeStorageWrites.delete(operation) }
  }

  @Remote('previewDeleteTask')
  async previewDeleteTask(input: PreviewDeleteTaskInput): Promise<PreviewDeleteTaskOutput> {
    this.assertActive()
    const store = await this.openTaskStore()
    this.assertCurrentTask(store, input)
    return { impact: taskOperations.previewDeleteTask(store, input) }
  }

  @Remote('deleteTask')
  async deleteTask(input: DeleteTaskInput): Promise<DeleteTaskOutput> {
    this.assertActive()
    const store = await this.openTaskStore()
    this.assertCurrentTask(store, input)
    if (input.confirmed !== true) throw Object.assign(new Error('删除任务需要明确确认'), { code: 'confirmation_required', data: taskOperations.previewDeleteTask(store, input) })
    const operation = taskOperations.deleteTask(store, input, { expectedRevision: store.read().revision, eventId: input.eventId ?? randomUUID() })
    this.activeStorageWrites.add(operation)
    try { await operation; return { deleted: true, taskId: input.taskId, revision: store.read().revision } }
    finally { this.activeStorageWrites.delete(operation) }
  }
  @Remote('saveExternalResult')
  async saveExternalResult(input: SaveExternalResultInput): Promise<SaveExternalResultOutput> {
    this.assertActive()
    const store = await this.openTaskStore()
    this.assertCurrentTask(store, input)
    const operation = taskOperations.saveExternalResult(store, input, { expectedRevision: store.read().revision, eventId: input.eventId })
    this.activeStorageWrites.add(operation)
    try {
      const task = await operation
      const version = task.versions.find((item: any) => item.eventId === input.eventId)
      if (!version) throw Object.assign(new Error('外部结果已保存但找不到对应版本'), { code: 'idempotency_mismatch' })
      return { task, version, revision: store.read().revision }
    } finally { this.activeStorageWrites.delete(operation) }
  }
  @Remote('bindTask')
  async bindTask(input: BindTaskInput): Promise<BindTaskOutput> {
    this.assertActive()
    const store = await this.openTaskStore()
    this.assertActive()
    const operation = taskOperations.bindTask(store, input, { expectedRevision: store.read().revision, eventId: input.eventId ?? randomUUID() })
    this.activeStorageWrites.add(operation)
    try {
      const binding = await operation
      return { binding, revision: store.read().revision }
    } finally { this.activeStorageWrites.delete(operation) }
  }

  @Remote('getCurrentBinding')
  async getCurrentBinding(input: GetCurrentBindingInput): Promise<GetCurrentBindingOutput> {
    this.assertActive()
    const store = await this.openTaskStore()
    return { binding: taskOperations.getCurrentBinding(store, input.projectId, input.conversationId) }
  }

  @Remote('runTask')
  async runTask(input: RunTaskInput, signal: AbortSignal): Promise<RunTaskOutput> {
    this.assertActive()
    const store = await this.openTaskStore()
    this.assertActive()
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason ?? new Error('模型调用已取消'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    let resolveCompletion!: () => void
    const completion = new Promise<void>(resolve => { resolveCompletion = resolve })
    this.activeTaskRuns.set(controller, completion)
    try {
      return await runAgent({ store, ...input, signal: controller.signal, generate: (messages: { role: string; content: string }[], options: { signal: AbortSignal; cwd?: string }) => this.generate(messages, input.provider, input.model, options) })
    } finally {
      signal.removeEventListener('abort', abort)
      this.activeTaskRuns.delete(controller)
      resolveCompletion()
    }
  }

  @Remote('cancelTask')
  cancelTask(input: CancelTaskInput): CancelTaskOutput { this.assertActive(); return { cancelled: cancelAgentRun(input.requestId) } }

  private openDomain(): Promise<Domain<typeof probeDomainSpec>> {
    this.assertActive()
    if (!this.domainPromise) {
      const pending = this.storageDomain.open(probeDomainSpec)
      this.domainPromise = pending
      void pending.catch(() => {
        if (this.domainPromise === pending) this.domainPromise = undefined
      })
    }
    return this.domainPromise
  }

  @Remote('echo')
  echo(input: ProbeInput): ProbeOutput {
    this.assertActive()
    return { marker: input.marker, observed: true }
  }

  @Remote('wait')
  wait(input: ProbeWaitInput, signal: AbortSignal): Promise<ProbeOutput> {
    this.assertActive()
    if (signal.aborted) return Promise.reject(new Error('probe request cancelled'))

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        this.activeWaits.delete(cancel)
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve({ marker: input.marker, observed: true })
      }, input.milliseconds)
      const cancel = (reason: string) => {
        cleanup()
        reject(new Error(reason))
      }
      const onAbort = () => cancel('probe request cancelled')
      this.activeWaits.add(cancel)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  @Remote('storageWrite')
  async storageWrite(input: ProbeInput): Promise<ProbeStorageOutput> {
    this.assertActive()
    const domain = await this.openDomain()
    await domain.table('state').put('current', { marker: input.marker })
    return { marker: input.marker, stored: true }
  }

  @Remote('storageRead')
  async storageRead(): Promise<ProbeStorageOutput> {
    this.assertActive()
    const domain = await this.openDomain()
    const record = domain.table('state').get('current')
    return { marker: record?.marker ?? '', stored: record !== undefined }
  }


  /** Capture metadata only while the isolated real-model probe is running. */
  captureRealModelRequest(options: ObservedLlmRequest): void {
    const audit = this.activeRealModelAudit
    if (!audit) return
    const messages = options.messages ?? []
    const text = messages.flatMap(message => {
      if (typeof message.content === 'string') return [message.content]
      return (message.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '')
    })
    const combined = text.join('\n')
    audit.requests.push({
      sessionId: options.sessionId,
      purpose: options.purpose,
      provider: options.provider,
      model: options.model,
      messageCount: messages.length,
      roles: messages.map(message => message.role ?? 'unknown'),
      textBytes: combined.length,
      messageDigest: messageFingerprint(messages),
      containsTaskA: combined.includes(audit.taskAMarker),
      containsTaskB: combined.includes(audit.taskBMarker),
    })
  }

  @Remote('realModelIsolation')
  async realModelIsolation(input: RealModelIsolationInput, signal: AbortSignal): Promise<RealModelIsolationOutput> {
    this.assertActive()
    const agents = this.agents
    const llm = this.llm
    if (!agents || !llm) return { passed: false, reason: 'DSH Agent/LLM 服务不可用', requests: [], taskRequestCount: 0, auxiliaryRequestCount: 0, sessionsDistinct: false, requestAIsolated: false, requestBIsolated: false, agentsDisposed: true }
    if (!input.provider || !input.model || !llm.listProviders().some(item => item.id === input.provider)) return { passed: false, reason: '请选择当前可用的真实模型提供方和模型', requests: [], taskRequestCount: 0, auxiliaryRequestCount: 0, sessionsDistinct: false, requestAIsolated: false, requestBIsolated: false, agentsDisposed: true }
    const models = await llm.listModels(input.provider)
    if (!models.some(item => item.provider === input.provider && item.id === input.model)) return { passed: false, reason: '所选模型已不可用，请重新读取模型列表', requests: [], taskRequestCount: 0, auxiliaryRequestCount: 0, sessionsDistinct: false, requestAIsolated: false, requestBIsolated: false, agentsDisposed: true }
    if (this.activeRealModelAudit) return { passed: false, reason: '真实模型隔离探针正在运行', requests: [], taskRequestCount: 0, auxiliaryRequestCount: 0, sessionsDistinct: false, requestAIsolated: false, requestBIsolated: false, agentsDisposed: true }

    const taskAMarker = `REAL_TASK_A_${randomUUID()}`
    const taskBMarker = `REAL_TASK_B_${randomUUID()}`
    const audit = { taskAMarker, taskBMarker, requests: [] as RealModelCapturedRequest[] }
    this.activeRealModelAudit = audit
    const handles: ProbeAgentHandle[] = []
    const sessionIds: string[] = []
    const cancel = () => { for (const handle of handles) { try { handle.agent.cancel({ kind: 'user' }) } catch {} } }
    const cancelForDispose = () => { for (const handle of handles) { try { handle.agent.cancel({ kind: 'disposed' }) } catch {} } }
    let resolveRun!: () => void
    const runDone = new Promise<void>(resolve => { resolveRun = resolve })
    this.activeIsolationRuns.set(cancelForDispose, runDone)
    signal.addEventListener('abort', cancel, { once: true })
    const statuses: string[] = []
    const endReasons: string[] = []
    let diagnostic = ''
    let agentsDisposed = true
    try {
      for (const [label, marker] of [['A', taskAMarker], ['B', taskBMarker]] as const) {
        if (signal.aborted) throw signal.reason ?? new Error('probe cancelled')
        const sessionId = randomUUID()
        sessionIds.push(sessionId)
        const handle = await withTimeout(agents.create({
          sessionId,
          meta: { cwd: processEnv.TEMP ?? processEnv.TMPDIR ?? getHostWorkingDirectory() },
          agentOptions: { provider: input.provider, model: input.model, maxTokens: 64 },
          signal,
          setup: (agentContext: { readonly tools: { restrict(filter: { readonly allow: readonly string[] }): () => void } }) => { agentContext.tools.restrict({ allow: [] }) },
        }), 8000, `创建真实模型探针 Agent ${label} 超时`)
        handles.push(handle)
        handle.agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: `只回复“收到”。本次隔离标记：${marker}` }], source: { kind: 'user' } })
        await withTimeout(handle.agent.whenIdle(), 45000, `真实模型探针 Agent ${label} 等待超时`)
        statuses.push(handle.agent.status ?? 'unknown')
        const events = handle.agent.session.snapshotEvents()
        const turnEnd = [...events].reverse().find(event => event.type === 'turn/end') as any
        endReasons.push(turnEnd?.data?.reason?.kind ?? turnEnd?.data?.reason ?? 'unknown')
      }
    } catch (error) {
      diagnostic = error instanceof Error ? error.message.replace(/(?:api[_-]?key|authorization|token)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]').replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]').slice(0, 180) : '真实模型探针失败'
      if (signal.aborted) throw error
    } finally {
      signal.removeEventListener('abort', cancel)
      this.activeRealModelAudit = undefined
      for (const [index, handle] of [...handles].reverse().entries()) {
        try { await withTimeout(handle.dispose(), 3000, `释放 Agent ${handles.length - index} 超时`) } catch { agentsDisposed = false }
      }
      this.activeIsolationRuns.delete(cancelForDispose)
      resolveRun()
    }
    const taskRequests = audit.requests.filter(request => request.purpose === undefined)
    const auxiliaryRequests = audit.requests.filter(request => request.purpose !== undefined)
    const requestA = taskRequests.filter(request => request.sessionId === sessionIds[0])
    const requestB = taskRequests.filter(request => request.sessionId === sessionIds[1])
    const sessionsDistinct = sessionIds.length === 2 && sessionIds[0] !== sessionIds[1] && requestA.length > 0 && requestB.length > 0
    const requestAIsolated = requestA.length > 0 && requestA.every(request => request.containsTaskA && !request.containsTaskB && request.provider === input.provider && request.model === input.model)
    const requestBIsolated = requestB.length > 0 && requestB.every(request => request.containsTaskB && !request.containsTaskA && request.provider === input.provider && request.model === input.model)
    return {
      passed: !diagnostic && agentsDisposed && taskRequests.length >= 2 && requestAIsolated && requestBIsolated && sessionsDistinct && endReasons.length === 2 && endReasons.every(reason => reason === 'completed'),
      reason: diagnostic,
      requests: audit.requests.map(request => ({ ...(request.purpose ? { purpose: request.purpose } : {}), ...(request.provider ? { provider: request.provider } : {}), ...(request.model ? { model: request.model } : {}), messageCount: request.messageCount, roles: request.roles, textBytes: request.textBytes, messageDigest: request.messageDigest, containsTaskA: request.containsTaskA, containsTaskB: request.containsTaskB })),
      taskRequestCount: taskRequests.length,
      auxiliaryRequestCount: auxiliaryRequests.length,
      sessionsDistinct,
      requestAIsolated,
      requestBIsolated,
      agentsDisposed,
      turnEndReasons: endReasons,
      agentStatuses: statuses,
    }
  }
  @Remote('agentIsolation')
  async agentIsolation(signal: AbortSignal): Promise<ProbeAgentIsolationOutput> {
    this.assertActive()
    const agents = this.agents
    const llm = this.llm
    const taskAMarker = 'TASK_A_73917'
    const taskBMarker = 'TASK_B_86420'
    const provider = `forward-step-isolation-${globalThis.crypto.randomUUID()}`
    const requests: CapturedRequest[] = []
    const handles: ProbeAgentHandle[] = []
    const requestedOptionsMatched: boolean[] = []
    const agentStatusesAfterFollowup: string[] = []
    const agentStatusesAfterIdle: string[] = []
    const pendingFollowupsAfterFollowup: number[] = []
    const pendingFollowupsAfterIdle: number[] = []
    const pendingNextStepsAfterFollowup: number[] = []
    const pendingNextStepsAfterIdle: number[] = []
    const requestErrorCodes: string[] = []
    const sessionEventKinds: string[] = []
    const turnStoppingEvents: string[] = []
    const turnEndReasonKinds: string[] = []
    const turnEndErrorCodes: string[] = []
    const turnEndErrorMessages: string[] = []
    let registration: (() => void) | undefined
    let agentsDisposed = true
    let adapterReleased = false
    let diagnosticStage = 'preflight'
    let diagnosticErrorName = ''
    let diagnosticErrorCode = ''
    let diagnosticErrorMessage = ''
    const cleanupErrors: string[] = []
    let resolveRun!: () => void
    const runDone = new Promise<void>(resolve => { resolveRun = resolve })

    const cancelHandles = (cause: { readonly kind: 'user' } | { readonly kind: 'disposed' }) => {
      for (const handle of handles) {
        try {
          handle.agent.cancel(cause)
        } catch {
          // Agent teardown may already have begun; dispose() below still owns cleanup.
        }
      }
    }
    const cancelForDispose = () => cancelHandles({ kind: 'disposed' })
    const cancelForRequest = () => cancelHandles({ kind: 'user' })
    this.activeIsolationRuns.set(cancelForDispose, runDone)
    signal.addEventListener('abort', cancelForRequest, { once: true })

    const adapter: CaptureAdapter = {
      providerInfo: route => ({ id: route, name: 'Forward Step isolation capture probe' }),
      providerRetryPolicy: () => undefined,
      imageRequestPricing: () => undefined,
      listModels: route => Promise.resolve([{ provider: route, id: 'capture-only', name: 'Capture-only probe' }]),
      resolveModel: (route, model) => Promise.resolve({ provider: route, id: model, name: 'Capture-only probe' }),
      prepareCall: async (route, model, requestSignal) => ({
        model: await adapter.resolveModel(route, model, requestSignal),
        stream: options => adapter.stream({ ...options, signal: requestSignal }),
      }),
      async *stream(options) {
        if (options.signal?.aborted) throw options.signal.reason ?? new Error('probe request cancelled')
        const text = options.messages.flatMap(message => message.content ?? [])
          .filter(block => block.type === 'text')
          .map(block => block.text ?? '')
        requests.push({
          sessionId: options.sessionId,
          purpose: options.purpose,
          containsTaskA: text.some(value => value.includes(taskAMarker)),
          containsTaskB: text.some(value => value.includes(taskBMarker)),
        })
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '隔离探针完成' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '隔离探针完成' } }
        yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 6 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }

    let result: Omit<ProbeAgentIsolationOutput, 'agentsDisposed' | 'adapterReleased' | 'passed' | 'diagnosticStage' | 'diagnosticErrorName' | 'diagnosticErrorCode' | 'diagnosticErrorMessage' | 'cleanupErrors'> | undefined
    try {
      if (signal.aborted) throw signal.reason ?? new Error('probe request cancelled')
      diagnosticStage = 'service-injection-check'
      if (this.disposed) throw new Error('probe service disposed')
      if (!agents || !llm) throw new Error('DSH Agent/LLM services are unavailable')
      diagnosticStage = 'register-adapter'
      registration = llm.registerAdapter([provider], adapter)

      const runTask = async (marker: string, taskLabel: 'A' | 'B'): Promise<string> => {
        if (signal.aborted) throw signal.reason ?? new Error('probe request cancelled')
        const sessionId = globalThis.crypto.randomUUID()
        diagnosticStage = `create-agent-${taskLabel}`
        const createController = new AbortController()
        const createSignal = AbortSignal.any([signal, createController.signal])
        let createTimedOut = false
        const createPromise = agents.create({
          sessionId,
          // 测试适配器不读写项目文件；临时 cwd 可避免 DSH 对宿主仓库做工作区快照。
          meta: { cwd: processEnv.TEMP ?? processEnv.TMPDIR ?? getHostWorkingDirectory() },
          agentOptions: { provider, model: 'capture-only', maxTokens: 32 },
          signal: createSignal,
        }).then(async handle => {
          if (createTimedOut) await handle.dispose()
          return handle
        })
        let handle: ProbeAgentHandle
        try {
          handle = await withTimeout(createPromise, 8000, `Timed out creating Agent ${taskLabel}.`)
        } catch (error) {
          createTimedOut = true
          createController.abort(error)
          void createPromise.catch(() => undefined)
          throw error
        }
        handles.push(handle)
        if (this.disposed || signal.aborted) {
          handle.agent.cancel({ kind: this.disposed ? 'disposed' : 'user' })
          throw signal.reason ?? new Error('probe service disposed')
        }
        const actualSessionId = handle.agent.session.id
        requestedOptionsMatched.push(handle.agent.options?.provider === provider && handle.agent.options?.model === 'capture-only')
        diagnosticStage = `subscribe-request-errors-${taskLabel}`
        handle.agent.ctx?.on('agent/request-error', (payload, next) => {
          const code = payload?.failure?.code
          if (typeof code === 'string') requestErrorCodes.push(code)
          return next()
        })
        handle.agent.ctx?.on('agent/turn-stopping', () => {
          turnStoppingEvents.push(`${taskLabel}:start`, `${taskLabel}:end`)
        })
        diagnosticStage = `followup-${taskLabel}`
        handle.agent.followup({
          id: globalThis.crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: marker }],
          source: { kind: 'user' },
        })
        agentStatusesAfterFollowup.push(handle.agent.status ?? 'unknown')
        pendingFollowupsAfterFollowup.push(handle.agent.inbox?.nextTurn.length ?? -1)
        pendingNextStepsAfterFollowup.push(handle.agent.inbox?.nextStep?.length ?? -1)
        let idleTimeout: ReturnType<typeof setTimeout> | undefined
        diagnosticStage = `wait-idle-${taskLabel}`
        const idleResult = await Promise.race([
          handle.agent.whenIdle().then(() => 'idle' as const, () => 'error' as const),
          new Promise<'timeout'>(resolve => { idleTimeout = setTimeout(() => resolve('timeout'), 7000) }),
        ])
        if (idleTimeout !== undefined) clearTimeout(idleTimeout)
        if (idleResult === 'timeout') {
          turnEndReasonKinds.push('timeout')
          turnEndErrorMessages.push('Timed out waiting for the capture-only agent to become idle.')
          handle.agent.cancel({ kind: 'user' })
          let cancellationTimeout: ReturnType<typeof setTimeout> | undefined
          await Promise.race([
            handle.agent.whenIdle().then(() => undefined, () => undefined),
            new Promise<void>(resolve => { cancellationTimeout = setTimeout(resolve, 1500) }),
          ])
          if (cancellationTimeout !== undefined) clearTimeout(cancellationTimeout)
        } else if (idleResult === 'error') {
          turnEndReasonKinds.push('error')
          turnEndErrorMessages.push('Agent whenIdle rejected before the session became idle.')
        }
        agentStatusesAfterIdle.push(handle.agent.status ?? 'unknown')
        pendingFollowupsAfterIdle.push(handle.agent.inbox?.nextTurn.length ?? -1)
        pendingNextStepsAfterIdle.push(handle.agent.inbox?.nextStep?.length ?? -1)
        diagnosticStage = `read-session-events-${taskLabel}`
        const sessionEvents = handle.agent.session.snapshotEvents()
        sessionEventKinds.push(...sessionEvents.map(event => event.type))
        for (const event of sessionEvents) {
          if (event.type !== 'turn/end') continue
          const reason = event.data?.reason
          if (typeof reason?.kind === 'string') turnEndReasonKinds.push(reason.kind)
          if (typeof reason?.error?.code === 'string') turnEndErrorCodes.push(reason.error.code)
          if (typeof reason?.error?.message === 'string') turnEndErrorMessages.push(reason.error.message.slice(0, 240))
        }
        if (this.disposed || signal.aborted) throw signal.reason ?? new Error('probe service disposed')
        return actualSessionId
      }

      const sessionA = await runTask(taskAMarker, 'A')
      const sessionB = await runTask(taskBMarker, 'B')
      const taskRequests = requests.filter(request => request.purpose === undefined)
      const auxiliaryRequests = requests.filter(request => request.purpose !== undefined)
      const requestA = taskRequests.find(request => request.sessionId === sessionA)
      const requestB = taskRequests.find(request => request.sessionId === sessionB)
      const auxiliaryRequestsIsolated = requests.every(request =>
        request.sessionId === sessionA ? !request.containsTaskB
          : request.sessionId === sessionB ? !request.containsTaskA
            : false,
      )
      diagnosticStage = 'assemble-result'
      result = {
        adapterRequests: requests.length,
        taskRequests: taskRequests.length,
        auxiliaryRequests: auxiliaryRequests.length,
        auxiliaryRequestsIsolated,
        sessionsDistinct: sessionA !== sessionB,
        requestAUsesSessionA: requestA !== undefined,
        requestBUsesSessionB: requestB !== undefined,
        requestAContainsTaskA: requestA?.containsTaskA ?? false,
        requestAContainsTaskB: requestA?.containsTaskB ?? false,
        requestBContainsTaskA: requestB?.containsTaskA ?? false,
        requestBContainsTaskB: requestB?.containsTaskB ?? false,
        requestedOptionsMatched,
        agentStatusesAfterFollowup,
        agentStatusesAfterIdle,
        pendingFollowupsAfterFollowup,
        pendingFollowupsAfterIdle,
        pendingNextStepsAfterFollowup,
        pendingNextStepsAfterIdle,
        requestErrorCodes,
        sessionEventKinds,
        turnStoppingEvents,
        turnEndReasonKinds,
        turnEndErrorCodes,
        turnEndErrorMessages,
      }
    } catch (error) {
      diagnosticErrorName = error instanceof Error ? error.name : 'UnknownError'
      const errorRecord = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : undefined
      diagnosticErrorCode = typeof errorRecord?.code === 'string' ? errorRecord.code.slice(0, 80) : ''
      const message = error instanceof Error ? error.message : String(error)
      diagnosticErrorMessage = message
        .replace(/(?:api[_-]?key|authorization|token)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
        .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]')
        .slice(0, 240)
      if (signal.aborted) throw error
      const taskRequests = requests.filter(request => request.purpose === undefined)
      const auxiliaryRequests = requests.filter(request => request.purpose !== undefined)
      result = {
        adapterRequests: requests.length,
        taskRequests: taskRequests.length,
        auxiliaryRequests: auxiliaryRequests.length,
        auxiliaryRequestsIsolated: false,
        sessionsDistinct: false,
        requestAUsesSessionA: false,
        requestBUsesSessionB: false,
        requestAContainsTaskA: false,
        requestAContainsTaskB: false,
        requestBContainsTaskA: false,
        requestBContainsTaskB: false,
        requestedOptionsMatched,
        agentStatusesAfterFollowup,
        agentStatusesAfterIdle,
        pendingFollowupsAfterFollowup,
        pendingFollowupsAfterIdle,
        pendingNextStepsAfterFollowup,
        pendingNextStepsAfterIdle,
        requestErrorCodes,
        sessionEventKinds,
        turnStoppingEvents,
        turnEndReasonKinds,
        turnEndErrorCodes,
        turnEndErrorMessages,
      }
    } finally {
      signal.removeEventListener('abort', cancelForRequest)
      for (const [index, handle] of [...handles].reverse().entries()) {
        try {
          await withTimeout(handle.dispose(), 1500, `Timed out disposing Agent ${handles.length - index}.`)
        } catch (error) {
          agentsDisposed = false
          cleanupErrors.push(`dispose-agent-${handles.length - index}: ${error instanceof Error ? error.name : 'UnknownError'}`)
        }
      }
      if (registration) {
        try {
          registration()
          adapterReleased = true
        } catch (error) {
          cleanupErrors.push(`release-adapter: ${error instanceof Error ? error.name : 'UnknownError'}`)
        }
      }
      this.activeIsolationRuns.delete(cancelForDispose)
      resolveRun()
    }

    if (!result) throw new Error('Agent/Session isolation probe did not produce a result')
    if (!diagnosticErrorMessage && cleanupErrors.length === 0) diagnosticStage = 'complete'
    const cleanupSucceeded = agentsDisposed && adapterReleased
    return {
      ...result,
      diagnosticStage,
      diagnosticErrorName,
      diagnosticErrorCode,
      diagnosticErrorMessage,
      cleanupErrors,
      agentsDisposed,
      adapterReleased,
      passed: cleanupSucceeded
        && result.adapterRequests === result.taskRequests + result.auxiliaryRequests
        && result.taskRequests === 2
        && result.auxiliaryRequestsIsolated
        && result.sessionsDistinct
        && result.requestAUsesSessionA
        && result.requestBUsesSessionB
        && result.requestAContainsTaskA
        && !result.requestAContainsTaskB
        && !result.requestBContainsTaskA
        && result.requestBContainsTaskB
        && agentStatusesAfterIdle.length === 2
        && agentStatusesAfterIdle.every(status => status === 'idle')
        && turnStoppingEvents.join(',') === 'A:start,A:end,B:start,B:end'
        && turnEndReasonKinds.length === 2
        && turnEndReasonKinds.every(reason => reason === 'completed')
        && turnEndErrorCodes.length === 0,
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    this.disposePromise = this.disposeResources()
    return this.disposePromise
  }

  private async disposeResources(): Promise<void> {
    for (const controller of this.activeTaskRuns.keys()) controller.abort(new Error('插件正在卸载'))
    for (const cancel of this.activeIsolationRuns.keys()) cancel()
    for (const cancel of this.activeWaits) cancel('probe service disposed')
    await Promise.all([...this.activeTaskRuns.values(), ...this.activeStorageWrites, ...this.activeIsolationRuns.values()])

    const taskStorePromise = this.taskStorePromise
    this.taskStorePromise = undefined
    if (taskStorePromise) { try { const store = this.taskStore ?? await taskStorePromise; await store.close() } catch {} }
    const domainPromise = this.domainPromise
    this.domainPromise = undefined
    if (domainPromise) await (await domainPromise).close()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    forwardStepProbe: ForwardStepProbe
  }
}
