import * as React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type PluginPreferences = { defaultEntryType: string; defaultDomain: string; preferredProvider: string; preferredModel: string }
type Provider = { id: string; name: string }
type Model = { id: string; name: string; provider: string }
type HostCapability = { id: string; label: string; status: 'available' | 'unavailable'; detail: string }
type PluginServiceConfig = { searchEndpoint: string; auxiliaryWritingEndpoint: string; auxiliaryWritingModel: string }
export type SettingsRemote = {
  getPluginPreferences(): Promise<RemoteResult<{ preferences: PluginPreferences }>>
  savePluginPreferences(input: PluginPreferences): Promise<RemoteResult<{ preferences: PluginPreferences; revision: number }>>
  listProviders(): Promise<RemoteResult<{ providers: Provider[] }>>
  listModels(input: { provider: string }): Promise<RemoteResult<{ models: Model[] }>>
  getHostCapabilities(): Promise<RemoteResult<{ capabilities: HostCapability[] }>>
  getPluginServiceConfig(): Promise<RemoteResult<{ serviceConfig: PluginServiceConfig }>>
  savePluginServiceConfig(input: PluginServiceConfig): Promise<RemoteResult<{ serviceConfig: PluginServiceConfig; revision: number }>>
  testPluginServiceEndpoint(input: { service: 'search' | 'auxiliary-writing'; confirmed: boolean }, signal?: AbortSignal): Promise<RemoteResult<{ service: string; reachable: boolean; statusCode: number; checkedAt: string }>>
  runAuxiliaryWriting(input: { prompt: string; confirmed: boolean }, signal?: AbortSignal): Promise<RemoteResult<{ text: string; model: string }>>
}

const { createElement: h, useEffect, useRef, useState } = React
function unwrap<T>(result: RemoteResult<T>): T { if (result.ok) return result.value; throw result.error }

export function SettingsPanel({ remote, onSaved }: { remote: SettingsRemote; onSaved: (preferences: PluginPreferences, providers: Provider[], models: Model[]) => void }) {
  const [preferences, setPreferences] = useState<PluginPreferences>({ defaultEntryType: 'advance-idea', defaultDomain: 'general', preferredProvider: '', preferredModel: '' })
  const [providers, setProviders] = useState<Provider[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [hostCapabilities, setHostCapabilities] = useState<HostCapability[]>([])
  const [serviceConfig, setServiceConfig] = useState<PluginServiceConfig>({ searchEndpoint: '', auxiliaryWritingEndpoint: '', auxiliaryWritingModel: '' })
  const [serviceConfigBusy, setServiceConfigBusy] = useState(false)
  const [endpointTestBusy, setEndpointTestBusy] = useState('')
  const [auxiliaryPrompt, setAuxiliaryPrompt] = useState('')
  const [auxiliaryResult, setAuxiliaryResult] = useState('')
  const [auxiliaryBusy, setAuxiliaryBusy] = useState(false)
  const auxiliaryController = useRef<AbortController | null>(null)
  const [capabilitiesBusy, setCapabilitiesBusy] = useState(false)
  const [capabilitiesMessage, setCapabilitiesMessage] = useState('正在读取宿主能力状态…')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('正在读取插件偏好…')
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { preferences: saved } = unwrap(await remote.getPluginPreferences())
        const { providers: available } = unwrap(await remote.listProviders())
        const { serviceConfig: savedServiceConfig } = unwrap(await remote.getPluginServiceConfig())
        if (!active) return
        setServiceConfig(savedServiceConfig)
        try {
          const { capabilities } = unwrap(await remote.getHostCapabilities())
          if (active) { setHostCapabilities(capabilities); setCapabilitiesMessage('接口注入状态已读取；显示可用不代表外部请求已成功。') }
        } catch (error) {
          if (active) setCapabilitiesMessage(`读取宿主能力失败：${error instanceof Error ? error.message : String(error)}`)
        }
        setProviders(available)
        let usable = saved
        let modelOptions: Model[] = []
        let status = '插件偏好已读取。模型密钥、搜索服务配置与凭证由 DSH 宿主管理。'
        if (saved.preferredProvider) {
          if (!available.some(item => item.id === saved.preferredProvider)) {
            usable = { ...saved, preferredProvider: '', preferredModel: '' }
            status = '已保存的模型提供方当前不可用；默认入口与领域仍可用，请选择其他模型后再保存。'
          } else {
            const { models: listed } = unwrap(await remote.listModels({ provider: saved.preferredProvider }))
            if (!listed.some(item => item.id === saved.preferredModel)) {
              usable = { ...saved, preferredProvider: '', preferredModel: '' }
              status = '已保存的模型当前不可用；默认入口与领域仍可用，请选择其他模型后再保存。'
            } else { modelOptions = listed; if (active) setModels(listed) }
          }
        }
        if (!active) return
        setPreferences(usable)
        onSaved(usable, available, modelOptions)
        setMessage(status)
      } catch (error) { if (active) setMessage('读取插件偏好或宿主模型列表失败：' + (error instanceof Error ? error.message : String(error))) }
    })()
    return () => { active = false }
  }, [remote])

  async function testServiceEndpoint(service: 'search' | 'auxiliary-writing') {
    const endpoint = service === 'search' ? serviceConfig.searchEndpoint : serviceConfig.auxiliaryWritingEndpoint
    const confirmation = service === 'search'
      ? `将向已保存的搜索端点发送一次固定连通性查询，并检查 SearXNG JSON 响应格式；不会发送任务内容或凭证。\n${endpoint}`
      : `将向辅助写作端点发送一条固定的“只回复 OK”测试提示，以验证 Chat Completions 接口；不会发送任务内容或保存结果。\n${endpoint}`
    if (!endpoint || typeof globalThis.confirm !== 'function' || !globalThis.confirm(confirmation)) return
    const controller = new AbortController()
    setEndpointTestBusy(service)
    try {
      const result = unwrap(await remote.testPluginServiceEndpoint({ service, confirmed: true }, controller.signal))
      setMessage(`${service === 'search' ? '搜索协议' : '辅助写作接口'} ${result.reachable ? '验证通过' : '返回异常状态'}：HTTP ${result.statusCode}（${result.checkedAt}）。真实任务效果仍需单独验收。`)
    } catch (error) { setMessage(`端点测试失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setEndpointTestBusy('') }
  }
  async function runAuxiliaryWriting() {
    const prompt = auxiliaryPrompt.trim()
    if (!prompt || !serviceConfig.auxiliaryWritingEndpoint || !serviceConfig.auxiliaryWritingModel || typeof globalThis.confirm !== 'function') return
    if (!globalThis.confirm(`将把以下 ${prompt.length} 个字符发送到已配置的辅助写作服务：${serviceConfig.auxiliaryWritingEndpoint}。插件不会保存输入或结果。继续？`)) return
    const controller = new AbortController()
    auxiliaryController.current = controller
    setAuxiliaryBusy(true)
    setAuxiliaryResult('')
    try {
      const result = unwrap(await remote.runAuxiliaryWriting({ prompt, confirmed: true }, controller.signal))
      setAuxiliaryResult(result.text)
      setMessage(`辅助写作完成（模型 ${result.model}）；结果仅显示在当前面板，未写入任务。`)
    } catch (error) { setMessage(`辅助写作失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { auxiliaryController.current = null; setAuxiliaryBusy(false) }
  }
  async function saveServiceConfig() {
    setServiceConfigBusy(true)
    try {
      const result = unwrap(await remote.savePluginServiceConfig(serviceConfig))
      setServiceConfig(result.serviceConfig)
      setMessage(`非敏感服务配置已保存（修订 ${result.revision}）；恢复后须由用户重新测试连接。`)
    } catch (error) { setMessage(`保存服务配置失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setServiceConfigBusy(false) }
  }
  async function refreshHostCapabilities() {
    setCapabilitiesBusy(true)
    try {
      const { capabilities } = unwrap(await remote.getHostCapabilities())
      setHostCapabilities(capabilities)
      setCapabilitiesMessage('接口注入状态已刷新；网页搜索/读取仍需在对应任务中实际探测。')
    } catch (error) { setCapabilitiesMessage(`刷新宿主能力失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setCapabilitiesBusy(false) }
  }
  async function chooseProvider(provider: string) {
    setPreferences(value => ({ ...value, preferredProvider: provider, preferredModel: '' }))
    setModels([])
    if (!provider) return
    try { setModels(unwrap(await remote.listModels({ provider })).models) }
    catch (error) { setMessage(`读取模型失败：${error instanceof Error ? error.message : String(error)}`) }
  }
  async function save() {
    setBusy(true)
    try {
      const saved = unwrap(await remote.savePluginPreferences(preferences))
      setPreferences(saved.preferences)
      onSaved(saved.preferences, providers, models)
      setMessage(`插件偏好已保存（修订 ${saved.revision}）。`)
    } catch (error) { setMessage(`保存插件偏好失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }
  return h('section', { 'aria-label': '插件设置', 'data-testid': 'plugin-settings' },
    h('h2', null, '插件设置'),
    h('p', null, '默认入口、领域以及 DSH 提供方/模型标识可随插件备份保存；模型密钥、搜索服务配置与凭证仍由宿主管理。'),
    h('section', { 'aria-label': '宿主能力状态', 'data-testid': 'host-capability-settings' },
      h('h3', null, '宿主能力状态（接口注入，不代表请求已验证）'),
      ...hostCapabilities.map(item => h('p', { key: item.id, 'data-testid': `host-capability-${item.id}` }, `${item.label}：${item.status === 'available' ? '已提供' : '不可用'}；${item.detail}`)),
      h('p', { 'data-testid': 'auxiliary-writing-capability' }, '辅助写作服务：已配置 OpenAI 兼容 Chat Completions 端点时可独立调用；否则可使用上方选择的 DSH 模型。'),
      h('button', { type: 'button', disabled: capabilitiesBusy, onClick: () => void refreshHostCapabilities() }, capabilitiesBusy ? '正在检查…' : '重新检查宿主能力'),
      h('p', { role: 'status' }, capabilitiesMessage)),
    h('section', { 'aria-label': '插件服务配置', 'data-testid': 'plugin-service-config' },
      h('h3', null, '可选非敏感服务配置'),
      h('p', null, '这里只保存端点和模型标识，不保存密钥。搜索端点用于 PPT 与社媒公开来源搜索，须兼容 SearXNG GET JSON（q、format=json、results 数组）；其余网页搜索仍使用 DSH WebRuntime。辅助写作端点须兼容 OpenAI Chat Completions（POST JSON）。端点不允许包含用户名、密码、查询参数或片段。'),
      h('label', null, '搜索服务端点（可选） ', h('input', { type: 'url', maxLength: 2048, value: serviceConfig.searchEndpoint, disabled: serviceConfigBusy, onChange: (event: any) => setServiceConfig(value => ({ ...value, searchEndpoint: event.target.value })) })),
      h('label', null, '辅助写作服务端点（可选） ', h('input', { type: 'url', maxLength: 2048, value: serviceConfig.auxiliaryWritingEndpoint, disabled: serviceConfigBusy, onChange: (event: any) => setServiceConfig(value => ({ ...value, auxiliaryWritingEndpoint: event.target.value })) })),
      h('label', null, '辅助写作模型标识 ', h('input', { maxLength: 200, value: serviceConfig.auxiliaryWritingModel, disabled: serviceConfigBusy, onChange: (event: any) => setServiceConfig(value => ({ ...value, auxiliaryWritingModel: event.target.value })) })),
      h('button', { type: 'button', disabled: serviceConfigBusy, onClick: () => void saveServiceConfig() }, serviceConfigBusy ? '正在保存…' : '保存服务端点与模型标识'),
      h('button', { type: 'button', disabled: serviceConfigBusy || endpointTestBusy !== '' || !serviceConfig.searchEndpoint, onClick: () => void testServiceEndpoint('search') }, endpointTestBusy === 'search' ? '正在测试搜索端点…' : '测试搜索端点（SearXNG JSON）'),
      h('button', { type: 'button', disabled: serviceConfigBusy || endpointTestBusy !== '' || !serviceConfig.auxiliaryWritingEndpoint, onClick: () => void testServiceEndpoint('auxiliary-writing') }, endpointTestBusy === 'auxiliary-writing' ? '正在测试辅助端点…' : '测试辅助端点（发送固定测试提示）'),
      h('label', null, '辅助写作输入（最多 30000 字符；调用前会再次确认发送）', h('textarea', { maxLength: 30000, value: auxiliaryPrompt, disabled: auxiliaryBusy, onChange: (event: any) => setAuxiliaryPrompt(event.target.value) })),
      h('button', { type: 'button', disabled: auxiliaryBusy || !auxiliaryPrompt.trim() || !serviceConfig.auxiliaryWritingEndpoint || !serviceConfig.auxiliaryWritingModel, onClick: () => void runAuxiliaryWriting() }, auxiliaryBusy ? '辅助写作请求中…' : '调用辅助写作服务'),
      auxiliaryBusy ? h('button', { type: 'button', onClick: () => auxiliaryController.current?.abort(new Error('用户取消辅助写作请求')) }, '取消辅助写作请求') : null,
      auxiliaryResult ? h('pre', { 'data-testid': 'auxiliary-writing-result' }, auxiliaryResult) : null), 
    h('label', null, '默认任务入口 ', h('select', { value: preferences.defaultEntryType, disabled: busy, onChange: (event: any) => setPreferences(value => ({ ...value, defaultEntryType: event.target.value })) },
      ...[['advance-idea', '推进想法'], ['optimize-prompt', '优化提示词'], ['diagnose-ai-result', '诊断 AI 结果']].map(([value, label]) => h('option', { key: value, value }, label)))),
    h('label', null, '默认领域 ', h('select', { value: preferences.defaultDomain, disabled: busy, onChange: (event: any) => setPreferences(value => ({ ...value, defaultDomain: event.target.value })) },
      ...[['general', '通用'], ['writing', '写作'], ['ppt', 'PPT']].map(([value, label]) => h('option', { key: value, value }, label)))),
    h('label', null, '默认模型提供方 ', h('select', { value: preferences.preferredProvider, disabled: busy, onChange: (event: any) => void chooseProvider(event.target.value) }, h('option', { value: '' }, '不固定默认模型'), ...providers.map(item => h('option', { key: item.id, value: item.id }, item.name)))),
    h('label', null, '默认模型 ', h('select', { value: preferences.preferredModel, disabled: busy || !preferences.preferredProvider, onChange: (event: any) => setPreferences(value => ({ ...value, preferredModel: event.target.value })) }, h('option', { value: '' }, '选择模型'), ...models.map(item => h('option', { key: item.id, value: item.id }, item.name)))),
    h('button', { type: 'button', disabled: busy || Boolean(preferences.preferredProvider && !preferences.preferredModel), onClick: () => void save() }, busy ? '正在保存…' : '保存插件偏好'),
    h('p', { role: 'status' }, message))
}

