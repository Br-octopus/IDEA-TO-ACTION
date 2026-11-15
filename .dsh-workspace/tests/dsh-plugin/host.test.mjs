import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectHostCapabilities, invokeHostCapability, validateHostPort } from '../../dsh-plugin/forward-step-dsh/host/port.js'
import { checkCompatibility } from '../../dsh-plugin/forward-step-dsh/host/compatibility.js'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'
import { TYPERT } from '../../dsh-plugin/forward-step-dsh/lib/typert.host.js'
import { TYPERT_REMOTE } from '../../dsh-plugin/forward-step-dsh/lib/typert.remote-client.js'

const requiredMethods = ['requestModel', 'registerPanel', 'exposeService', 'getContext', 'subscribe']
const completePort = () => Object.fromEntries(requiredMethods.map((name) => [name, () => {}]))
const fingerprint = () => ({
  exeSha256: 'exe-hash',
  cliVersion: '0.2.0-rc.2',
  profile: 'forward-step-test',
  pluginRoot: 'D:/workspace/dsh-plugin/forward-step-dsh',
})

test('缺少宿主能力时阻止启用', () => {
  assert.throws(() => validateHostPort({}), { code: 'unsupported_host' })
})
test('完整内部 HostPort 被接受且保持原对象', () => {
  const port = completePort()
  assert.equal(validateHostPort(port), port)
})
test('HostPort 报告具体缺失方法', () => {
  const port = completePort()
  delete port.requestModel
  assert.throws(() => validateHostPort(port), (error) => error.code === 'unsupported_host' && error.message.includes('requestModel'))
})
test('宿主能力矩阵逐项暴露缺失项，不把部分能力误报为整体不可用', () => {
  const port = { getContext() {}, requestModel() {}, registerPanel() {}, subscribe() {}, dispose() {} }
  assert.deepEqual(inspectHostCapabilities(port), {
    storage: { status: 'available', missing: [] },
    model: { status: 'available', missing: [] },
    search: { status: 'unavailable', missing: ['search'] },
    file: { status: 'unavailable', missing: ['selectFile'] },
    directory: { status: 'unavailable', missing: ['selectDirectory'] },
    panel: { status: 'available', missing: [] },
    service: { status: 'unavailable', missing: ['exposeService'] },
    lifecycle: { status: 'available', missing: [] },
  })
})
test('已核验能力返回原结果，拒绝保持宿主错误', async () => {
  const expected = { items: ['a'] }
  assert.equal(await invokeHostCapability({ search: async () => expected }, 'search', 'search', ['query']), expected)
  await assert.rejects(invokeHostCapability({ search: async () => { throw new Error('denied') } }, 'search', 'search'), /denied/)
})
test('缺失能力和未登记能力稳定返回 unsupported_host', async () => {
  await assert.rejects(invokeHostCapability({}, 'file', 'selectFile'), { code: 'unsupported_host', capability: 'file' })
  await assert.rejects(invokeHostCapability({}, 'file', 'deleteFile'), { code: 'unsupported_host' })
})
test('已取消操作不调用宿主，运行中取消返回 cancelled', async () => {
  let calls = 0
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(invokeHostCapability({ search: () => { calls += 1 } }, 'search', 'search', [], { signal: cancelled.signal }), { code: 'cancelled' })
  assert.equal(calls, 0)
  const queued = new AbortController()
  const queuedCall = invokeHostCapability({ search: () => { calls += 1 } }, 'search', 'search', [], { signal: queued.signal })
  queued.abort()
  await assert.rejects(queuedCall, { code: 'cancelled' })
  assert.equal(calls, 0, '调度后、Host 微任务执行前取消时也不得产生宿主副作用')
  const running = new AbortController()
  const pending = invokeHostCapability({ search: () => new Promise(() => {}) }, 'search', 'search', [], { signal: running.signal })
  running.abort()
  await assert.rejects(pending, { code: 'cancelled' })
})

test('Host 能力矩阵覆盖成功结果、参数透传、拒绝与订阅释放', async () => {
  let releaseCount = 0
  const returned = { value: 'host-result' }
  const port = {
    getContext: async (scope) => ({ scope }),
    requestModel: async (input) => ({ text: input.prompt }),
    search: async (input, signal) => ({ query: input.query, aborted: signal?.aborted === true }),
    selectFile: async (options) => ({ path: options.accept[0] }),
    selectDirectory: async (options) => ({ path: options.title }),
    registerPanel: async (panel) => panel,
    exposeService: async (service) => ({ exposed: service.name }),
    subscribe: () => () => { releaseCount += 1 },
    dispose: async () => returned,
  }
  assert.deepEqual(Object.values(inspectHostCapabilities(port)).map(item => item.status), Array(8).fill('available'))
  assert.deepEqual(await invokeHostCapability(port, 'storage', 'getContext', ['project']), { scope: 'project' })
  assert.deepEqual(await invokeHostCapability(port, 'model', 'requestModel', [{ prompt: 'hello' }]), { text: 'hello' })
  assert.deepEqual(await invokeHostCapability(port, 'search', 'search', [{ query: 'topic' }]), { query: 'topic', aborted: false })
  assert.deepEqual(await invokeHostCapability(port, 'file', 'selectFile', [{ accept: ['.md'] }]), { path: '.md' })
  assert.deepEqual(await invokeHostCapability(port, 'directory', 'selectDirectory', [{ title: 'workspace' }]), { path: 'workspace' })
  const panel = { id: 'panel' }
  assert.equal(await invokeHostCapability(port, 'panel', 'registerPanel', [panel]), panel)
  assert.deepEqual(await invokeHostCapability(port, 'service', 'exposeService', [{ name: 'probe' }]), { exposed: 'probe' })
  const disposeSubscription = await invokeHostCapability(port, 'lifecycle', 'subscribe')
  disposeSubscription()
  assert.equal(releaseCount, 1)
  assert.equal(await invokeHostCapability(port, 'lifecycle', 'dispose'), returned)
  await assert.rejects(invokeHostCapability({ requestModel: async () => { throw Object.assign(new Error('model denied'), { code: 'denied' }) } }, 'model', 'requestModel'), { code: 'denied' })
})

test('Host 能力矩阵对每类缺失入口分别标记 unavailable', () => {
  const cases = [
    ['storage', 'getContext'], ['model', 'requestModel'], ['search', 'search'],
    ['file', 'selectFile'], ['directory', 'selectDirectory'], ['panel', 'registerPanel'], ['service', 'exposeService'], ['lifecycle', 'dispose'],
  ]
  for (const [capability, method] of cases) {
    const port = { getContext() {}, requestModel() {}, search() {}, selectFile() {}, selectDirectory() {}, registerPanel() {}, exposeService() {}, subscribe() {}, dispose() {} }
    delete port[method]
    assert.equal(inspectHostCapabilities(port)[capability].status, 'unavailable', capability)
    assert.ok(inspectHostCapabilities(port)[capability].missing.includes(method), capability)
  }
})

test('匹配的宿主指纹通过', () => {
  const expected = fingerprint()
  assert.deepEqual(checkCompatibility(expected, { ...expected }), { ok: true, differences: [] })
})
test('程序、版本、profile 或插件路径变化阻断兼容性', () => {
  const expected = fingerprint()
  const actual = { ...expected, exeSha256: 'changed-exe-hash', cliVersion: '0.2.0-rc.3', profile: 'desktop', pluginRoot: 'D:/other/forward-step-dsh' }
  const result = checkCompatibility(expected, actual)
  assert.equal(result.ok, false)
  assert.deepEqual(result.differences.map(({ field }) => field), ['exeSha256', 'cliVersion', 'profile', 'pluginRoot'])
})
test('未提供预期或实际字段也报告不兼容', () => {
  const expected = fingerprint()
  const actual = { ...expected }
  delete actual.pluginRoot
  assert.equal(checkCompatibility(expected, actual).ok, false)
})
test('宿主指纹字段双方均缺失、为空白或类型错误时仍拒绝兼容', () => {
  assert.equal(checkCompatibility({}, {}).ok, false)
  const expected = fingerprint()
  const missingFromBoth = Object.fromEntries(Object.keys(expected).map(field => [field, undefined]))
  assert.deepEqual(checkCompatibility(missingFromBoth, missingFromBoth).differences.map(item => item.field), Object.keys(expected))
  const actual = { ...expected, cliVersion: '   ', profile: 42 }
  assert.deepEqual(checkCompatibility(expected, actual).differences.map(item => item.field), ['cliVersion', 'profile'])
})


test('运行态 Host 能力报告只标记实际注入的能力，并逐项解释缺失项', async t => {
  const storageDomain = { open: async () => { throw new Error('能力报告不应打开存储') } }
  const host = new ForwardStepProbe(storageDomain)
  t.after(() => host.dispose())
  const report = host.getHostCapabilities()
  assert.deepEqual(report.capabilities.map(({ id, status }) => [id, status]), [
    ['storage', 'available'], ['model', 'unavailable'], ['search', 'unavailable'],
    ['fetch', 'unavailable'], ['file', 'unavailable'], ['image-understanding', 'unavailable'], ['directory', 'unavailable'],
    ['panel', 'available'], ['service', 'available'], ['lifecycle', 'available'],
  ])
  assert.match(report.capabilities.find(item => item.id === 'directory').detail, /未接入/u)
  assert.match(report.capabilities.find(item => item.id === 'file').detail, /本地文件选择仍可用/u)
})

test('运行态 Host 能力报告识别模型、附件和网页服务，不执行这些服务', async t => {
  let calls = 0
  const llm = { listProviders() { calls += 1; return [] }, listModels() { calls += 1; return [] } }
  const attachments = { saveFileStream() { calls += 1 }, readFileStream() { calls += 1 }, admitPromptContent() { calls += 1 } }
  const web = { search() { calls += 1 }, fetch() { calls += 1 } }
  const host = new ForwardStepProbe({ open: async () => { calls += 1 } }, { create() { calls += 1 } }, llm, attachments, web)
  t.after(() => host.dispose())
  const report = host.getHostCapabilities()
  for (const id of ['model', 'search', 'fetch', 'file', 'image-understanding']) assert.equal(report.capabilities.find(item => item.id === id).status, 'available')
  assert.equal(calls, 0)
})

test('PPT 导入、逐页理解与标注字段通过 Host 和 Client RPC 契约往返保留', () => {
  const methodState = {
    ppt: {
      stage: 'visual-feedback',
      outline: { title: '逐页验收', status: 'draft', slides: [{
        title: '证据页', content: 'OCR 校对文本', visualDescription: '人工页面理解', modelVisualDescription: '模型页面理解',
        imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=', imageDataUrls: ['data:image/jpeg;base64,/9j/'],
        sourceImageName: 'slide-1.png', sourceDocumentName: 'source.pptx',
        table: { rows: [['指标', '值'], ['转化率', '12%']] },
        chart: { title: '趋势', categories: ['一月', '二月'], series: [{ name: '线索', values: [1, 2] }] },
        style: { title: {}, body: {} },
      }] },
      visualFeedback: [{ id: 'feedback-1', pageIndex: 0, target: { kind: 'point', x: 0.221, y: 0.779 }, category: 'evidence', comment: '补充证据', contentSnapshot: 'snapshot', selected: true, createdAt: '2026-11-09T00:00:00.000Z' }],
    },
  }
  const request = { projectId: 'project-1', taskId: 'task-1', taskRevision: 1, conversationId: 'conversation-1', eventId: 'event-1', patch: { methodState } }
  const task = {
    projectId: 'project-1', taskId: 'task-1', revision: 2, title: '逐页验收', entryType: 'ppt', domain: 'ppt', archived: false,
    originalInput: '', currentRequirements: [], materials: [], methodState, versions: [], reviews: [], conversations: ['conversation-1'],
    createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z', agent: { id: 'agent-1', type: 'agent', goal: '逐页验收' },
  }

  for (const [name, contract] of [['Host', TYPERT], ['Client', TYPERT_REMOTE]]) {
    const updateTask = (contract.invocations ?? contract.descriptors).find(invocation => invocation.method === 'updateTask')
    assert.ok(updateTask, `${name} 必须声明 updateTask RPC`)
    assert.deepEqual(updateTask.parameters[0].codec.create().parse(request).patch.methodState, methodState, `${name} 请求不得剥离页面素材与反馈字段`)
    assert.deepEqual(updateTask.result.create().parse({ task, revision: 2 }).task.methodState, methodState, `${name} 回包必须保留保存后的页面素材与反馈字段`)
  }
})
