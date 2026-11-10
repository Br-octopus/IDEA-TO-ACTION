import * as React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

type Pack = { id: string; name: string; genre: string; layer: string; version: number; builtin: boolean; enabled: boolean; history?: Pack[]; [key: string]: any }
type Genre = { genre: string; name: string; taskTypes: string[]; representativeTask?: string; status: string; reason?: string }
export type WritingPacksRemote = {
  listWritingPacks(): Promise<RemoteResult<{ packs: Pack[] }>>
  compareWritingPackVersions(input: { packId: string; leftVersion: number; rightVersion: number }): Promise<RemoteResult<{ changes: { path: string; before: unknown; after: unknown; beforeExists: boolean; afterExists: boolean }[] }>>
  listWritingGenres(): Promise<RemoteResult<{ genres: Genre[] }>>
  previewWritingPackSnapshot(input: { genre: string; taskType?: string; selectedIds: string[] }): Promise<RemoteResult<{ snapshot: any; revision: number }>>
  saveWritingPack(input: { packId?: string; pack: Pack }): Promise<RemoteResult<{ pack: Pack }>>
  setWritingPackEnabled(input: { packId: string; enabled: boolean }): Promise<RemoteResult<unknown>>
  restoreBuiltinWritingPack(input: { packId: string }): Promise<RemoteResult<unknown>>
  deleteWritingPack(input: { packId: string }): Promise<RemoteResult<unknown>>
  previewImportWritingPacks(input: { packs: Pack[] }): Promise<RemoteResult<{ preview: { packs: Pack[]; collisions: string[] } }>>
  confirmImportWritingPacks(input: { preview: { packs: Pack[]; collisions: string[] } }): Promise<RemoteResult<unknown>>
  exportWritingPacks(input: { ids: string[] }): Promise<RemoteResult<{ packs: Pack[] }>>
}

const { createElement: h, useState } = React
const unwrap = <T,>(result: RemoteResult<T>): T => { if (result.ok) return result.value; throw result.error }
const blankPack = (): Pack => ({
  id: '', name: '', genre: 'article', layer: 'genre', taskType: '', version: 1, builtin: false, enabled: true,
  basePackId: '', applicability: '', targetFields: {}, memoryNamespace: '', checkDimensions: [],
  outputRequirements: {}, riskReminders: [], styleBaseline: [], clarifications: [], materials: [],
  requirements: [], methods: [], prompts: [], structures: [], style: [], terminology: [], evidenceRules: [],
  routes: [], checks: [], repairs: [], nextSteps: [], examples: [], resources: [], sources: [],
})

export function WritingPacksPanel({ remote }: { remote: WritingPacksRemote }) {
  const [packs, setPacks] = useState<Pack[]>([])
  const [genres, setGenres] = useState<Genre[]>([])
  const [packId, setPackId] = useState('')
  const [draft, setDraft] = useState('')
  const [importText, setImportText] = useState('')
  const [preview, setPreview] = useState<{ packs: Pack[]; collisions: string[] } | null>(null)
  const [comparison, setComparison] = useState<{ packId: string; leftVersion: number; rightVersion: number; changes: any[] } | null>(null)
  const [versionPairs, setVersionPairs] = useState<Record<string, [number, number]>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('专业包为不同文体和任务提供可维护规则；每次修改会保存为新版本。')

  async function load() {
    setBusy(true)
    try {
      const [packResult, genreResult] = await Promise.all([remote.listWritingPacks(), remote.listWritingGenres()])
      setPacks(unwrap(packResult).packs)
      setGenres(unwrap(genreResult).genres)
      setMessage('专业包和文体配置已读取。')
    } catch (error) { setMessage(`读取失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function save(event: any) {
    event.preventDefault()
    try {
      const pack = JSON.parse(draft) as Pack
      if (!pack || Array.isArray(pack) || typeof pack !== 'object' || !pack.name?.trim()) throw new Error('请输入含名称的专业包 JSON。')
      setBusy(true)
      const saved = unwrap(await remote.saveWritingPack({ ...(packId ? { packId } : {}), pack }))
      setPackId(saved.pack.id)
      setDraft(JSON.stringify(saved.pack, null, 2))
      await load()
      setMessage(`已保存 ${saved.pack.name} V${saved.pack.version}。`)
    } catch (error) { setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function changeEnabled(pack: Pack) {
    setBusy(true)
    try { unwrap(await remote.setWritingPackEnabled({ packId: pack.id, enabled: !pack.enabled })); await load() }
    catch (error) { setMessage(`更新失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function compareVersions(pack: Pack) {
    const [leftVersion, rightVersion] = versionPairs[pack.id] ?? [pack.history?.[0]?.version ?? pack.version, pack.version]
    setBusy(true)
    try {
      const result = unwrap(await remote.compareWritingPackVersions({ packId: pack.id, leftVersion, rightVersion }))
      setComparison({ packId: pack.id, leftVersion, rightVersion, changes: result.changes })
      setMessage(`已比较 ${pack.name} V${leftVersion} 与 V${rightVersion}。`)
    } catch (error) { setMessage(`版本比较失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function restore(pack: Pack) {
    setBusy(true)
    try { unwrap(await remote.restoreBuiltinWritingPack({ packId: pack.id })); await load(); setMessage(`已恢复 ${pack.name} 默认版本。`) }
    catch (error) { setMessage(`恢复失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function remove(pack: Pack) {
    if (!globalThis.confirm?.(`删除自建专业包“${pack.name}”？`)) return
    setBusy(true)
    try { unwrap(await remote.deleteWritingPack({ packId: pack.id })); if (packId === pack.id) { setPackId(''); setDraft('') }; await load(); setMessage(`已删除 ${pack.name}。`) }
    catch (error) { setMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function previewImport() {
    try {
      const source = JSON.parse(importText)
      const packsToImport = Array.isArray(source) ? source : [source]
      setBusy(true)
      const result = unwrap(await remote.previewImportWritingPacks({ packs: packsToImport }))
      setPreview(result.preview)
      setMessage(`预览 ${result.preview.packs.length} 个包，ID 冲突 ${result.preview.collisions.length} 个。`)
    } catch (error) { setMessage(`导入预览失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function confirmImport() {
    if (!preview || preview.collisions.length) return
    setBusy(true)
    try { unwrap(await remote.confirmImportWritingPacks({ preview })); setPreview(null); setImportText(''); await load(); setMessage('专业包导入完成，外部验证状态已重置。') }
    catch (error) { setMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function exportPack(pack: Pack) {
    setBusy(true)
    try {
      const result = unwrap(await remote.exportWritingPacks({ ids: [pack.id] }))
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.packs, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${pack.id}.json`
      link.click()
      URL.revokeObjectURL(url)
      setMessage(`已导出 ${pack.name}。`)
    } catch (error) { setMessage(`导出失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  return h('section', { 'aria-label': '写作专业包管理' },
    h('h2', null, '写作专业包与文体'),
    h('p', null, '规则包保存适用范围、要求、提示词、检查项和来源许可；已开始的写作轮次保留原包快照。'),
    h('div', null,
      h('button', { type: 'button', disabled: busy, onClick: () => void load() }, '读取专业包'),
      h('button', { type: 'button', disabled: busy, onClick: () => { setPackId(''); setDraft(JSON.stringify(blankPack(), null, 2)) } }, '新建专业包')),
    genres.length ? h('ul', { 'aria-label': '已配置写作文体' }, ...genres.map(item => h('li', { key: item.genre }, `${item.name} · ${item.status} · ${item.taskTypes.join('、')} · 代表任务 ${item.representativeTask ?? item.taskTypes[0] ?? '未定义'} · ${item.reason ?? '暂无说明'}`))) : null,
    packs.length ? h('ul', { 'aria-label': '专业包列表' }, ...packs.map(pack => h('li', { key: pack.id },
      h('strong', null, `${pack.name} · V${pack.version}`), h('span', null, ` · ${pack.genre || '通用'} · ${pack.layer} · ${pack.enabled ? '启用' : '停用'} · ${pack.builtin ? '内置' : '自建'}`),
      h('button', { type: 'button', disabled: busy, onClick: () => { setPackId(pack.id); setDraft(JSON.stringify(pack, null, 2)) } }, '查看/编辑'),
      h('button', { type: 'button', disabled: busy, onClick: () => void changeEnabled(pack) }, pack.enabled ? '停用' : '启用'),
      h('button', { type: 'button', disabled: busy, onClick: () => void exportPack(pack) }, '导出'),
      pack.builtin ? h('button', { type: 'button', disabled: busy, onClick: () => void restore(pack) }, '恢复默认') : h('button', { type: 'button', disabled: busy, onClick: () => void remove(pack) }, '删除'),
      pack.history?.length ? h('details', null,
        h('summary', null, `历史版本 ${pack.history.length}`),
        h('label', null, '比较版本', h('select', {
          'aria-label': `${pack.name}较早版本`, disabled: busy,
          value: (versionPairs[pack.id] ?? [pack.history[0]?.version ?? pack.version, pack.version])[0],
          onChange: (event: any) => setVersionPairs(current => ({ ...current, [pack.id]: [Number(event.target.value), (current[pack.id] ?? [pack.history[0]?.version ?? pack.version, pack.version])[1]] })),
        }, ...[...pack.history, pack].map(item => h('option', { key: item.version, value: item.version }, `V${item.version}`)))),
        h('label', null, '与版本比较', h('select', {
          'aria-label': `${pack.name}较新版本`, disabled: busy,
          value: (versionPairs[pack.id] ?? [pack.history[0]?.version ?? pack.version, pack.version])[1],
          onChange: (event: any) => setVersionPairs(current => ({ ...current, [pack.id]: [(current[pack.id] ?? [pack.history[0]?.version ?? pack.version, pack.version])[0], Number(event.target.value)] })),
        }, ...[...pack.history, pack].map(item => h('option', { key: item.version, value: item.version }, `V${item.version}`)))),
        h('button', { type: 'button', disabled: busy || !pack.history.length, onClick: () => void compareVersions(pack) }, '比较版本'),
        comparison?.packId === pack.id ? h('div', { 'aria-label': `V${comparison.leftVersion} 与 V${comparison.rightVersion} 的差异` },
          h('p', null, comparison.changes.length ? `差异 ${comparison.changes.length} 项` : '两个版本的规则内容相同。'),
          ...comparison.changes.map((change, index) => h('pre', { key: `${change.path}-${index}` }, JSON.stringify(change, null, 2)))) : null,
        ...pack.history.map(item => h('pre', { key: `${item.id}-${item.version}` }, JSON.stringify(item, null, 2)))) : null)))
      : h('p', null, '尚未读取专业包。'),
    h('form', { onSubmit: save }, h('label', null, packId ? '编辑专业包 JSON' : '新专业包 JSON', h('textarea', { 'aria-label': '专业包 JSON', rows: 14, value: draft, onChange: (event: any) => setDraft(event.target.value) })), h('button', { type: 'submit', disabled: busy || !draft.trim() }, '保存新版本')),
    h('label', null, '导入专业包 JSON（单个对象或数组）', h('textarea', { 'aria-label': '导入专业包 JSON', rows: 6, value: importText, onChange: (event: any) => { setImportText(event.target.value); setPreview(null) } })),
    h('button', { type: 'button', disabled: busy || !importText.trim(), onClick: () => void previewImport() }, '预览导入'),
    preview ? h('section', { 'aria-label': '专业包导入预览' }, h('p', null, `待导入 ${preview.packs.length} 个；冲突：${preview.collisions.join('、') || '无'}`), h('button', { type: 'button', disabled: busy || preview.collisions.length > 0, onClick: () => void confirmImport() }, '确认导入'), h('button', { type: 'button', disabled: busy, onClick: () => setPreview(null) }, '取消')) : null,
    h('p', { role: 'status', 'aria-live': 'polite' }, message))
}
