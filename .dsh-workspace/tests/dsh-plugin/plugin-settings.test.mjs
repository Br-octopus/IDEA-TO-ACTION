import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'

function storageDomain() {
  const tables = new Map()
  return { async open() { return { table(name) {
    if (!tables.has(name)) tables.set(name, new Map())
    const rows = tables.get(name)
    return { get: key => rows.get(key), put: async (key, value) => rows.set(key, structuredClone(value)), update: async (key, mutate) => { const value = mutate(rows.get(key)); rows.set(key, structuredClone(value)); return value } }
  }, async close() {} } } }
}

test('插件偏好可读写、限定为受支持默认项并保存在插件存储', async () => {
  const host = new ForwardStepProbe(storageDomain(), { create: async () => { throw new Error('unused') } }, { listProviders: () => [{ id: 'provider-test', name: 'Test' }], listModels: async provider => provider === 'provider-test' ? [{ id: 'model-test', name: 'Test Model', provider }] : [] })
  try {
    assert.deepEqual((await host.getPluginPreferences()).preferences, { defaultEntryType: 'advance-idea', defaultDomain: 'general', preferredProvider: '', preferredModel: '' })
    const capabilities = (await host.getHostCapabilities()).capabilities
    assert.equal(capabilities.find(item => item.id === 'search')?.status, 'unavailable')
    assert.equal(capabilities.find(item => item.id === 'fetch')?.status, 'unavailable')
    const saved = await host.savePluginPreferences({ defaultEntryType: 'optimize-prompt', defaultDomain: 'writing', preferredProvider: 'provider-test', preferredModel: 'model-test' })
    assert.deepEqual(saved.preferences, { defaultEntryType: 'optimize-prompt', defaultDomain: 'writing', preferredProvider: 'provider-test', preferredModel: 'model-test' })
    assert.deepEqual((await host.getPluginPreferences()).preferences, saved.preferences)
    await assert.rejects(host.savePluginPreferences({ defaultEntryType: 'unknown', defaultDomain: 'writing', preferredProvider: '', preferredModel: '' }), { code: 'invalid_input' })
    await assert.rejects(host.savePluginPreferences({ ...saved.preferences, preferredModel: 'missing' }), { code: 'model_unavailable' })
    assert.deepEqual((await host.getPluginPreferences()).preferences, saved.preferences, '非法偏好不得覆盖现有值')
  } finally { await host.dispose() }
})

test('插件服务配置只保存无凭证的端点和模型标识并可读回', async () => {
  const host = new ForwardStepProbe(storageDomain(), { create: async () => { throw new Error('unused') } }, null)
  try {
    const saved = await host.savePluginServiceConfig({ searchEndpoint: 'https://search.example/api', auxiliaryWritingEndpoint: 'https://writer.example/v1/', auxiliaryWritingModel: 'writer-model-v2' })
    assert.deepEqual(saved.serviceConfig, { searchEndpoint: 'https://search.example/api', auxiliaryWritingEndpoint: 'https://writer.example/v1', auxiliaryWritingModel: 'writer-model-v2' })
    assert.deepEqual((await host.getPluginServiceConfig()).serviceConfig, saved.serviceConfig)
    await assert.rejects(host.savePluginServiceConfig({ searchEndpoint: 'https://user:pass@search.example/api', auxiliaryWritingEndpoint: '', auxiliaryWritingModel: '' }), { code: 'invalid_input' })
    await assert.rejects(host.savePluginServiceConfig({ searchEndpoint: 'https://search.example/api?token=secret', auxiliaryWritingEndpoint: '', auxiliaryWritingModel: '' }), { code: 'invalid_input' })
    await assert.rejects(host.savePluginServiceConfig({ searchEndpoint: '', auxiliaryWritingEndpoint: '', auxiliaryWritingModel: '', apiKey: 'secret' }), { code: 'invalid_input' })
    await assert.rejects(host.savePluginServiceConfig({ searchEndpoint: '', auxiliaryWritingEndpoint: 'https://writer.example/v1', auxiliaryWritingModel: '' }), { code: 'invalid_input' })
    assert.deepEqual((await host.getPluginServiceConfig()).serviceConfig, saved.serviceConfig, '拒绝非法输入时不覆盖已保存配置')
  } finally { await host.dispose() }
})

test('搜索端点按 SearXNG JSON 协议探测且需显式确认', async () => {
  const requested = []
  const web = { fetch: async (request) => { requested.push(request); return { url: request.url, statusCode: 200, body: { kind: 'text', content: JSON.stringify({ results: [] }) }, truncated: false } } }
  const host = new ForwardStepProbe(storageDomain(), { create: async () => { throw new Error('unused') } }, null, null, web)
  try {
    await host.savePluginServiceConfig({ searchEndpoint: 'https://search.example/api', auxiliaryWritingEndpoint: 'https://writer.example/v1', auxiliaryWritingModel: 'model-a' })
    await assert.rejects(host.testPluginServiceEndpoint({ service: 'search', confirmed: false }), { code: 'confirmation_required' })
    assert.equal(requested.length, 0)
    const result = await host.testPluginServiceEndpoint({ service: 'search', confirmed: true })
    assert.equal(result.reachable, true)
    assert.equal(result.statusCode, 200)
    const requestedUrl = new URL(requested[0].url)
    assert.equal(requestedUrl.origin + requestedUrl.pathname, 'https://search.example/api')
    assert.equal(requestedUrl.searchParams.get('q'), 'forward-step-connection-test')
    assert.equal(requestedUrl.searchParams.get('format'), 'json')
    const badStatus = new ForwardStepProbe(storageDomain(), { create: async () => { throw new Error('unused') } }, null, null, { fetch: async request => ({ url: request.url, statusCode: 503, body: { kind: 'text', content: '' }, truncated: false }) })
    try {
      await badStatus.savePluginServiceConfig({ searchEndpoint: 'https://search.example/api', auxiliaryWritingEndpoint: '', auxiliaryWritingModel: '' })
      assert.equal((await badStatus.testPluginServiceEndpoint({ service: 'search', confirmed: true })).reachable, false)
    } finally { await badStatus.dispose() }
  } finally { await host.dispose() }
})

test('设置面板可编辑偏好并说明宿主凭证的管理边界', async () => {
  const [panel, entry] = await Promise.all([
    readFile(new URL('../../dsh-plugin/forward-step-dsh/src/client/settings-panel.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../dsh-plugin/forward-step-dsh/src/client/index.ts', import.meta.url), 'utf8'),
  ])
  assert.match(panel, /保存插件偏好/u)
  assert.match(panel, /getHostCapabilities/u)
  assert.match(panel, /getPluginServiceConfig/u)
  assert.match(panel, /测试搜索端点（SearXNG JSON）/u)
  assert.match(panel, /测试辅助端点（发送固定测试提示）/u)
  assert.match(panel, /testPluginServiceEndpoint/u)
  assert.match(panel, /保存服务端点与模型标识/u)
  assert.match(panel, /不保存密钥/u)
  assert.match(panel, /宿主能力状态/u)
  assert.match(panel, /辅助写作服务：已配置 OpenAI 兼容 Chat Completions 端点时可独立调用/u)
  assert.match(panel, /runAuxiliaryWriting/u)
  assert.match(panel, /辅助写作输入/u)
  assert.match(panel, /接口注入，不代表请求已验证/u)
  assert.match(panel, /默认模型提供方/u)
  assert.match(panel, /已保存的模型当前不可用/u, '已不存在的模型不得作为默认模型恢复')
  assert.match(panel, /密钥、搜索服务配置与凭证仍由宿主管理/u)
  assert.match(entry, /#workspace-settings/u)
  assert.match(entry, /setEntryType\(preferences\.defaultEntryType\); setDomain\(preferences\.defaultDomain\)/u)
  assert.match(entry, /setProviders\(availableProviders\)[\s\S]*?setModels\(availableModels\)/u, '恢复模型偏好时主工作台下拉列表同步可用项')
})


test('辅助写作端点测试会发送固定合成提示并检查 Chat Completions 响应', async t => {
  const previousFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options })
    return { ok: true, status: 200, headers: { get: () => null }, async json() { return { choices: [{ message: { content: 'OK' } }] } } }
  }
  const host = new ForwardStepProbe(storageDomain(), { create: async () => { throw new Error('unused') } })
  t.after(async () => { globalThis.fetch = previousFetch; await host.dispose() })
  await host.savePluginServiceConfig({ searchEndpoint: '', auxiliaryWritingEndpoint: 'https://writer.example/v1/chat/completions', auxiliaryWritingModel: 'model-a' })
  await assert.rejects(host.testPluginServiceEndpoint({ service: 'auxiliary-writing', confirmed: false }), { code: 'confirmation_required' })
  const result = await host.testPluginServiceEndpoint({ service: 'auxiliary-writing', confirmed: true }, new AbortController().signal)
  assert.equal(result.reachable, true)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://writer.example/v1/chat/completions')
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(JSON.parse(requests[0].options.body).model, 'model-a')
  assert.equal(JSON.parse(requests[0].options.body).messages[0].content, '请仅回复 OK，用于验证辅助写作服务连通性。')
})
