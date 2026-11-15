import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const workspace = join(testDirectory, '../..')
const pluginDirectory = join(workspace, 'dsh-plugin/forward-step-dsh')
const fixtureModules = join(workspace, '.verification/typert-generator-fixture/node_modules/@deepseek-ai')
const packageJson = JSON.parse(await readFile(join(pluginDirectory, 'package.json'), 'utf8'))
const clientBundle = await readFile(join(pluginDirectory, 'client.js'), 'utf8')
const { TYPERT } = await import(pathToFileURL(join(pluginDirectory, 'lib/typert.host.js')).href)
const { TYPERT_REMOTE } = await import(pathToFileURL(join(pluginDirectory, 'lib/typert.remote-client.js')).href)
const { ForwardStepProbe } = await import(pathToFileURL(join(pluginDirectory, 'lib/host-service.js')).href)
const { Context } = await import(pathToFileURL(join(pluginDirectory, 'node_modules/@deepseek-ai/cordis/lib/index.js')).href)
const { TypertRegistry } = await import(pathToFileURL(join(fixtureModules, 'dsh-typert-registry/lib/index.js')).href)
const { TypertGatewayService } = await import(pathToFileURL(join(fixtureModules, 'dsh-api-gateway/lib/types/index.js')).href)
const { apply: applyRemoteClient } = await import(pathToFileURL(join(fixtureModules, 'dsh-api-gateway/lib/types/client/index.js')).href)

 test('正式插件声明宿主与远程端生成产物', () => {
  assert.deepEqual(packageJson.exports['./typert'], {
    types: './lib/typert.host.d.ts',
    default: './lib/typert.host.js',
  })
  assert.deepEqual(packageJson.exports['./remote'], {
    types: './lib/typert.remote-client.d.ts',
    default: './lib/typert.remote-client.js',
  })
  assert.ok(packageJson.files.includes('lib/typert.host.js'))
  assert.ok(packageJson.files.includes('lib/typert.remote-client.js'))
})

test('构建后的 Client bundle 会挂载生成的 Remote 并调用 Host 探针', () => {
  assert.ok(packageJson.files.includes('client.js'))
  assert.match(clientBundle, /ctx\.remote\.\$mount\(TYPERT_REMOTE\)/)
  assert.match(clientBundle, /remote\.forwardStepProbe/)
  assert.match(clientBundle, /saveExternalResult/)
  assert.match(clientBundle, /dsh-cancel-probe/)
  assert.match(clientBundle, /验证 Agent \/ Session 消息隔离/)
  assert.match(clientBundle, /require\(\"react\"\)/)
  assert.match(clientBundle, /ZodError|ZodObject|ZodString/)
})

test('正式插件客户端只把 DSH Gateway 作为 external，并注入真实宿主依赖', () => {
  assert.deepEqual(packageJson.dsh.client.external, ['@deepseek-ai/dsh-api-gateway/client'])
  assert.deepEqual(packageJson.dsh.client.inject, [
    '@deepseek-ai/dsh-api-gateway',
    '@deepseek-ai/dsh-client-connection',
  ])
})

test('正式生成的 Host/Client 契约包含严格 schema 与取消元数据', () => {
  assert.equal(TYPERT.package, packageJson.name)
  assert.equal(TYPERT.face, 'host')
  assert.deepEqual(TYPERT.invocations.map(({ namespace, method }) => `${namespace}/${method}`), [
    'forwardStepProbe/agentIsolation',
    'forwardStepProbe/archiveTask',
    'forwardStepProbe/bindTask',
    'forwardStepProbe/cancelTask',
    'forwardStepProbe/createTask',
    'forwardStepProbe/deleteTask',
    'forwardStepProbe/echo',
    'forwardStepProbe/getCurrentBinding',
    'forwardStepProbe/listModels',
    'forwardStepProbe/listProviders',
    'forwardStepProbe/listTasks',
    'forwardStepProbe/previewDeleteTask',
    'forwardStepProbe/realModelIsolation',
    'forwardStepProbe/runTask',
    'forwardStepProbe/saveExternalResult',
    'forwardStepProbe/storageRead',
    'forwardStepProbe/storageWrite',
    'forwardStepProbe/updateTask',
    'forwardStepProbe/wait',
  ])
  assert.equal(TYPERT_REMOTE.package, packageJson.name)
  assert.equal(TYPERT_REMOTE.descriptors.length, 19)
  const echo = TYPERT.invocations.find(({ method }) => method === 'echo')
  const wait = TYPERT.invocations.find(({ method }) => method === 'wait')
  const echoInput = echo.parameters[0].codec.create()
  assert.equal(echoInput.safeParse({ marker: 'valid' }).success, true)
  assert.equal(echoInput.safeParse({ marker: 17 }).success, false)
  assert.deepEqual(wait.cancellation, { parameter: 'signal' })
  assert.deepEqual(TYPERT_REMOTE.descriptors.find(({ method }) => method === 'wait').cancellation, { parameter: 'signal' })
})

test('Host 通过独立 DSH Agent/session 使用所选 provider/model 并保存消息上下文', async () => {
  let capturedOptions
  let capturedMessage
  let capturedToolAllow
  let disposed = 0
  const events = []
  const agent = {
    options: {},
    session: { id: 'session-test', snapshotEvents: () => events },
    followup(message) { capturedMessage = message },
    async whenIdle() {
      events.push({ type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'Agent 结果' }] } } })
      events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    },
    cancel() {},
  }
  const agents = { create: async options => { capturedOptions = options; options.setup({ tools: { restrict(filter) { capturedToolAllow = filter.allow; return () => {} } } }); return { agent, async dispose() { disposed += 1 } } } }
  const llm = {
    listProviders: () => [{ id: 'provider-a', name: 'A' }, { id: 'provider-b', name: 'B' }],
    listModels: async provider => [{ provider, id: 'model-selected', name: 'Selected' }],
  }
  const host = new ForwardStepProbe({ open: async () => { throw new Error('storage not used') } }, agents, llm)
  assert.deepEqual(host.listProviders(), { providers: [{ id: 'provider-a', name: 'A' }, { id: 'provider-b', name: 'B' }] })
  assert.deepEqual(await host.listModels({ provider: 'provider-b' }), { models: [{ provider: 'provider-b', id: 'model-selected', name: 'Selected' }] })
  const signal = new AbortController().signal
  assert.equal(await host.generate([{ role: 'user', content: 'current request' }], 'provider-b', 'model-selected', { signal, cwd: 'D:/project' }), 'Agent 结果')
  assert.equal(capturedOptions.agentOptions.provider, 'provider-b')
  assert.equal(capturedOptions.agentOptions.model, 'model-selected')
  assert.equal(capturedOptions.meta.cwd, 'D:/project')
  assert.deepEqual(capturedToolAllow, [])
  assert.equal(capturedMessage.role, 'user')
  assert.match(capturedMessage.content[0].text, /current request/)
  assert.equal(disposed, 1)
  await assert.rejects(host.generate([{ role: 'user', content: 'x' }], '', '', { signal }), { code: 'model_selection_required' })
  await assert.rejects(host.generate([{ role: 'user', content: 'x' }], 'provider-b', 'wrong-model', { signal }), { code: 'model_unavailable' })
})

test('正式 Host contribution 可注册、经 Gateway 调用并在释放后撤销', async () => {
  const ctx = new Context()
  const registryFiber = ctx.plugin(TypertRegistry)
  await registryFiber
  const hostFiber = ctx.plugin({
    name: 'forward-step-formal-host-test',
    inject: ['typert'],
    *apply(ctx) {
      ctx.provide('forwardStepProbe', new ForwardStepProbe({ open: async () => { throw new Error('storage not used by this test'); } }))
      yield ctx.typert.register(TYPERT)
    },
  })
  await hostFiber
  assert.deepEqual(ctx.typert.local.list().map(({ namespace, method }) => `${namespace}/${method}`), [
    'forwardStepProbe/agentIsolation',
    'forwardStepProbe/archiveTask',
    'forwardStepProbe/bindTask',
    'forwardStepProbe/cancelTask',
    'forwardStepProbe/createTask',
    'forwardStepProbe/deleteTask',
    'forwardStepProbe/echo',
    'forwardStepProbe/getCurrentBinding',
    'forwardStepProbe/listModels',
    'forwardStepProbe/listProviders',
    'forwardStepProbe/listTasks',
    'forwardStepProbe/previewDeleteTask',
    'forwardStepProbe/realModelIsolation',
    'forwardStepProbe/runTask',
    'forwardStepProbe/saveExternalResult',
    'forwardStepProbe/storageRead',
    'forwardStepProbe/storageWrite',
    'forwardStepProbe/updateTask',
    'forwardStepProbe/wait',
  ])

  const gatewayFiber = ctx.plugin(TypertGatewayService)
  await gatewayFiber
  assert.deepEqual(await ctx.typertGateway.invoke({
    namespace: 'forwardStepProbe',
    method: 'echo',
    args: { input: { marker: 'formal-host' } },
  }), { marker: 'formal-host', observed: true })

  await gatewayFiber.dispose()
  await hostFiber.dispose()
  assert.equal(ctx.typert.local.list().length, 0)
  await registryFiber.dispose()
})

test('正式 Host Gateway 将取消信号送达服务并及时结束调用', async () => {
  const ctx = new Context()
  const registryFiber = ctx.plugin(TypertRegistry)
  await registryFiber
  const hostFiber = ctx.plugin({
    name: 'forward-step-formal-cancel-test',
    inject: ['typert'],
    *apply(ctx) {
      ctx.provide('forwardStepProbe', new ForwardStepProbe({ open: async () => { throw new Error('storage not used by this test'); } }))
      yield ctx.typert.register(TYPERT)
    },
  })
  await hostFiber
  const gatewayFiber = ctx.plugin(TypertGatewayService)
  await gatewayFiber
  const controller = new AbortController()
  const startedAt = Date.now()
  const pending = ctx.typertGateway.invoke({
    namespace: 'forwardStepProbe',
    method: 'wait',
    args: { input: { marker: 'cancel', milliseconds: 5000 } },
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(new Error('fixture cancellation')), 25)
  await assert.rejects(pending, error => error.code === 'gateway/cancelled')
  assert.equal(controller.signal.aborted, true)
  assert.ok(Date.now() - startedAt < 1000, '取消调用应在 1 秒内结束，而不是等待 5 秒超时')
  await gatewayFiber.dispose()
  await hostFiber.dispose()
  await registryFiber.dispose()
})

test('正式 Client contribution mount 后注册 descriptor，卸载后撤销 descriptor', async () => {
  const ctx = new Context()
  const registryFiber = ctx.plugin(TypertRegistry)
  await registryFiber
  ctx.provide('connection', {
    rpc: { open: () => { throw new Error('本探针不应打开 stream') }, call: async () => ({ ok: true, value: { marker: 'client-call', observed: true } }) },
    generation: { getSnapshot: () => undefined },
    isLoopback: true,
    registerGenerationSource: () => () => {},
    start: () => ({ stop() {} }),
  })
  await ctx.plugin({ name: 'dsh-api-gateway-client', inject: ['typert', 'connection'], apply: applyRemoteClient })
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE)
  assert.deepEqual(ctx.typert.remotes.list().map(({ namespace, method }) => `${namespace}/${method}`), [
    'forwardStepProbe/agentIsolation',
    'forwardStepProbe/archiveTask',
    'forwardStepProbe/bindTask',
    'forwardStepProbe/cancelTask',
    'forwardStepProbe/createTask',
    'forwardStepProbe/deleteTask',
    'forwardStepProbe/echo',
    'forwardStepProbe/getCurrentBinding',
    'forwardStepProbe/listModels',
    'forwardStepProbe/listProviders',
    'forwardStepProbe/listTasks',
    'forwardStepProbe/previewDeleteTask',
    'forwardStepProbe/realModelIsolation',
    'forwardStepProbe/runTask',
    'forwardStepProbe/saveExternalResult',
    'forwardStepProbe/storageRead',
    'forwardStepProbe/storageWrite',
    'forwardStepProbe/updateTask',
    'forwardStepProbe/wait',
  ])
  assert.deepEqual(await ctx.remote.forwardStepProbe.echo({ marker: 'client-call' }), {
    ok: true,
    value: { marker: 'client-call', observed: true },
  })
  await unmount()
  assert.equal(ctx.typert.remotes.list().length, 0)
  assert.equal(typeof ctx.remote.forwardStepProbe?.echo, 'undefined')
  await registryFiber.dispose()
})









test('Host service 卸载会等待活动 Agent 结束后再关闭存储，且幂等拒绝新调用', async () => {
  const valuesByDomain = []
  const closedDomains = []
  const storageDomain = {
    async open() {
      const values = new Map()
      valuesByDomain.push(values)
      return {
        table() {
          return {
            get: key => values.get(key),
            put: (key, value) => { values.set(key, structuredClone(value)) },
            update: (key, updater) => {
              const value = updater(values.get(key))
              values.set(key, structuredClone(value))
              return structuredClone(value)
            },
          }
        },
        async close() { closedDomains.push(values) },
      }
    },
  }
  let markAgentStarted
  const agentStarted = new Promise(resolve => { markAgentStarted = resolve })
  const agents = {
    create(options) {
      markAgentStarted()
      return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason ?? new Error('aborted')), { once: true })
      })
    },
  }
  const llm = {
    listProviders: () => [{ id: 'provider-a', name: 'Provider A' }],
    listModels: async provider => [{ provider, id: 'model-a', name: 'Model A' }],
  }
  const host = new ForwardStepProbe(storageDomain, agents, llm)
  const cwd = process.cwd()
  const created = await host.createTask({
    cwd,
    conversationId: 'conversation-dispose',
    entryType: 'advance-idea',
    domain: 'general',
    originalInput: '卸载期间应等待 Agent 并安全关闭存储',
  })
  const controller = new AbortController()
  const run = host.runTask({
    taskId: created.task.taskId,
    taskRevision: created.task.revision,
    stage: 'planning',
    requestId: 'dispose-active-run',
    projectId: created.task.projectId,
    conversationId: 'conversation-dispose',
    provider: 'provider-a',
    model: 'model-a',
  }, controller.signal)
  await agentStarted

  const observedRun = assert.rejects(run, error => error?.code === 'cancelled' || error?.message === '插件正在卸载')
  const firstDispose = host.dispose()
  const secondDispose = host.dispose()
  assert.equal(firstDispose, secondDispose, '重复卸载应复用同一个清理过程')
  await firstDispose
  await observedRun
  assert.equal(closedDomains.length, 1, '任务 Domain 应在 Agent 收尾后恰好关闭一次')
  await assert.rejects(host.listTasks({ cwd }), { code: 'service_disposed' })
})


test('正式 Host RPC 创建任务、读取当前对话绑定并验证任务切换', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { openStore } = await import(pathToFileURL(join(pluginDirectory, 'core/store.js')).href)
  const directory = await mkdtemp(join(tmpdir(), 'forward-step-host-bindings-'))
  const filename = join(directory, 'state.sqlite')
  const open = async () => {
    const store = openStore(filename)
    return {
      table() {
        return {
          get: key => { try { return store.read()[key] } catch { return undefined } },
          put: async (key, value) => store.transact(store.read().revision, `put:${Date.now()}:${Math.random()}`, state => { state[key] = value }),
          update: async (key, updater) => {
            const value = updater(store.read()[key])
            await store.transact(store.read().revision, `update:${Date.now()}:${Math.random()}`, state => { state[key] = value })
            return value
          },
        }
      },
      async close() { store.close() },
    }
  }
  let host
  try {
    host = new ForwardStepProbe({ open })
    const cwd = process.cwd()
    const first = await host.createTask({ cwd, conversationId: 'conversation-a', entryType: 'advance-idea', domain: 'general', originalInput: '文章 A' })
    const second = await host.createTask({ cwd, conversationId: 'conversation-b', entryType: 'advance-idea', domain: 'general', originalInput: '文章 B' })
    await host.bindTask({ projectId: first.task.projectId, taskId: second.task.taskId, conversationId: 'conversation-a' })
    assert.equal((await host.getCurrentBinding({ projectId: first.task.projectId, conversationId: 'conversation-a' })).binding.taskId, second.task.taskId)
    assert.equal((await host.getCurrentBinding({ projectId: first.task.projectId, conversationId: 'conversation-b' })).binding.taskId, second.task.taskId)
    assert.equal((await host.getCurrentBinding({ projectId: first.task.projectId, conversationId: 'new-conversation' })).binding, null)
    const renameInput = { projectId: second.task.projectId, taskId: second.task.taskId, taskRevision: second.task.revision, conversationId: 'conversation-a', patch: { title: '重命名后的任务 B' }, eventId: 'rename-task-b' }
    const renamed = await host.updateTask(renameInput)
    assert.equal(renamed.task.title, '重命名后的任务 B')
    const repeatedRename = await host.updateTask(renameInput)
    assert.equal(repeatedRename.revision, renamed.revision, '重复 eventId 不应再次递增存储修订')
    const prepared = await host.updateTask({
      projectId: second.task.projectId,
      taskId: second.task.taskId,
      taskRevision: renamed.task.revision,
      conversationId: 'conversation-a',
      patch: {
        agent: { ...renamed.task.agent, steps: [{ id: 'step-body', title: '正文' }] },
        versions: [{ versionId: 'prompt-version-1', requestId: 'prompt-request-1', stage: 'step-prompt', content: '外部执行提示词', createdAt: new Date().toISOString() }],
      },
      eventId: 'prepare-external-result',
    })
    const externalInput = {
      projectId: second.task.projectId, taskId: second.task.taskId, taskRevision: prepared.task.revision,
      conversationId: 'conversation-a', stepId: 'step-body', promptVersionId: 'prompt-version-1',
      content: '外部 AI 返回的正文', feedback: '补充证据后再继续', eventId: 'external-result-1',
    }
    const external = await host.saveExternalResult(externalInput)
    assert.equal(external.version.kind, 'external-result')
    assert.equal(external.version.stepId, 'step-body')
    assert.equal(external.version.promptVersionId, 'prompt-version-1')
    assert.equal(external.version.content, externalInput.content)
    const repeatedExternal = await host.saveExternalResult(externalInput)
    assert.equal(repeatedExternal.revision, external.revision, '重放 eventId 不应再次追加外部结果版本')
    await assert.rejects(host.saveExternalResult({ ...externalInput, eventId: 'external-wrong-conversation', conversationId: 'conversation-b' }), { code: 'conflict' })
    await assert.rejects(host.saveExternalResult({ ...externalInput, taskRevision: external.task.revision, eventId: 'external-wrong-prompt', promptVersionId: 'missing-prompt' }), { code: 'invalid_input' })
    await assert.rejects(host.updateTask({ projectId: second.task.projectId, taskId: second.task.taskId, taskRevision: second.task.revision, conversationId: 'conversation-a', patch: { title: '过期写入' } }), { code: 'conflict' })
    await assert.rejects(host.archiveTask({ projectId: second.task.projectId, taskId: second.task.taskId, taskRevision: renamed.task.revision, conversationId: 'new-conversation', archived: true }), { code: 'conflict' })
    const archived = await host.archiveTask({ projectId: second.task.projectId, taskId: second.task.taskId, taskRevision: external.task.revision, conversationId: 'conversation-a', archived: true, eventId: 'archive-task-b' })
    assert.equal(archived.task.archived, true)
    assert.equal((await host.listTasks({ cwd, archived: true })).tasks[0].taskId, second.task.taskId)
    const impact = await host.previewDeleteTask({ projectId: second.task.projectId, taskId: second.task.taskId, taskRevision: archived.task.revision, conversationId: 'conversation-a' })
    assert.equal(impact.impact.bindingCount, 2)
    const removed = await host.deleteTask({ projectId: second.task.projectId, taskId: second.task.taskId, taskRevision: archived.task.revision, conversationId: 'conversation-a', confirmed: true, eventId: 'delete-task-b' })
    assert.equal(removed.deleted, true)
    assert.equal((await host.listTasks({ cwd })).tasks.some(task => task.taskId === second.task.taskId), false)
    await host.dispose()
  } finally {
    await host?.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})


test('Host service 在卸载期间完成中的存储初始化会关闭 Domain 并拒绝迟到写入', async () => {
  let releaseOpen
  const opened = new Promise(resolve => { releaseOpen = resolve })
  let domainClosed = 0
  const storageDomain = {
    open: () => opened,
  }
  const values = new Map()
  const domain = {
    table() {
      return {
        get: key => values.get(key),
        put: (key, value) => values.set(key, structuredClone(value)),
        update: async (key, updater) => {
          const value = updater(values.get(key))
          values.set(key, structuredClone(value))
          return structuredClone(value)
        },
      }
    },
    async close() { domainClosed += 1 },
  }
  const host = new ForwardStepProbe(storageDomain)
  const listing = host.listTasks({ cwd: process.cwd() })
  const observedListing = assert.rejects(listing, { code: 'service_disposed' })
  const disposing = host.dispose()
  releaseOpen(domain)
  await disposing
  await observedListing
  assert.equal(domainClosed, 1)
  assert.equal(values.has('current'), true, '初始化可完成，但卸载后不应再执行任务写入')
})


test('Host service 卸载等待进行中的任务持久化提交后才关闭 Domain', async () => {
  const values = new Map()
  let markUpdateStarted
  const updateStarted = new Promise(resolve => { markUpdateStarted = resolve })
  let releaseUpdate
  const updateGate = new Promise(resolve => { releaseUpdate = resolve })
  let closed = false
  const storageDomain = {
    async open() {
      return {
        table() {
          return {
            get: key => values.get(key),
            put: async (key, value) => { values.set(key, structuredClone(value)) },
            update: async (key, updater) => {
              markUpdateStarted()
              await updateGate
              if (closed) throw new Error('write attempted after close')
              const value = updater(values.get(key))
              values.set(key, structuredClone(value))
              return structuredClone(value)
            },
          }
        },
        async close() { closed = true },
      }
    },
  }
  const host = new ForwardStepProbe(storageDomain)
  const creating = host.createTask({ cwd: process.cwd(), conversationId: 'conversation-write', entryType: 'advance-idea', domain: 'general', originalInput: '等待写事务提交' })
  await updateStarted
  const dispose = host.dispose()
  await Promise.resolve()
  assert.equal(closed, false, '写事务未提交时存储必须仍保持打开')
  releaseUpdate()
  await Promise.all([creating, dispose])
  assert.equal(closed, true)
  assert.equal(values.get('current').tasks.length, 1)
})
