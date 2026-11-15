import { prepareSelectedKnowledgeFiles } from '../../client/knowledge-files.js'
import { browseWorkspaceDirectory } from '../../client/workspace-files.js'
import * as React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

type KnowledgeEntry = {
  id: string
  type: string
  title: string
  sourceUrl?: string
  domains?: string[]
  stages?: string[]
  summary?: string
  contentExcerpt?: string
  limitations?: string
  verificationStatus?: string
  favorite?: boolean
  pinned?: boolean
}

export type WorkspaceFilesRemote = {
  list(sessionId: string, path: string, signal?: AbortSignal): Promise<{ path: string; entries: { name: string; type: 'file' | 'directory' | 'other'; size?: number }[]; truncated: boolean }>
  read(sessionId: string, path: string, range: { offset: number; limit: number }, signal?: AbortSignal): Promise<{ offset: number; text: string; lines: number; eof: boolean; version: string; bytes?: number }>
}

type WorkspaceDirectorySummary = { directoryPath: string; count: number }

export type KnowledgeRemote = {
  listKnowledgeEntries(input: { filters: any; workspaceSessionId?: string }): Promise<RemoteResult<{ entries: KnowledgeEntry[]; selectedIds: string[]; filters: any; workspaceDirectories?: WorkspaceDirectorySummary[]; revision: number }>>
  syncWorkspaceKnowledgeDirectory(input: { sessionId: string; directoryPath: string; files: { relativePath: string; text: string }[]; eventId: string }): Promise<RemoteResult<{ indexed: number; removed: number; revision: number }>>
  revokeWorkspaceKnowledgeDirectory(input: { sessionId: string; directoryPath: string; eventId: string }): Promise<RemoteResult<{ removed: number; revision: number }>>
  saveKnowledgeEntry(input: { entry: Partial<KnowledgeEntry>; eventId: string }): Promise<RemoteResult<{ entry: KnowledgeEntry; revision: number }>>
  deleteKnowledgeEntry(input: { entryId: string; eventId: string }): Promise<RemoteResult<{ deleted: boolean; revision: number }>>
  setKnowledgeFlags(input: { entryId: string; patch: { favorite?: boolean; pinned?: boolean }; eventId: string }): Promise<RemoteResult<{ revision: number }>>
  setKnowledgeSelection(input: { ids: string[]; eventId: string }): Promise<RemoteResult<{ selectedIds: string[]; revision: number }>>
  setKnowledgeFilters(input: { filters: any; eventId: string }): Promise<RemoteResult<{ filters: any; revision: number }>>
  previewKnowledgeContext(): Promise<RemoteResult<{ sourceIds: string[]; digest: string; text: string; entries: { id: string; title: string; sourceUrl?: string; verificationStatus: string }[]; revision: number }>>
}

const { createElement: h, useState, useRef } = React
const types = [
  ['manual-note', '手动笔记'], ['prompt-example', '提示词示例'], ['user-prompt', '用户提示词'],
  ['success-case', '成功案例'], ['failure-case', '失败案例'], ['review-insight', '复盘洞见'],
  ['method-card', '方法卡'], ['github-summary', 'GitHub 摘要'], ['article-summary', '文章摘要'],
  ['academic-literature', '学术文献'],
]
const verificationStates = [['unverified', '未验证'], ['source-reviewed', '来源已核对'], ['user-confirmed', '用户已确认']]

function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

function emptyEntry(): Partial<KnowledgeEntry> {
  return { type: 'manual-note', title: '', sourceUrl: '', domains: [], stages: [], summary: '', contentExcerpt: '', limitations: '', verificationStatus: 'unverified' }
}

function splitList(value: string) {
  return value.split(/[,，\n]/u).map(item => item.trim()).filter(Boolean)
}

export function KnowledgePanel({ remote, sessionId, workspaceFiles, onContextPreview }: { remote: KnowledgeRemote; sessionId?: string; workspaceFiles?: WorkspaceFilesRemote; onContextPreview?: (digest: string | null) => void }) {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [filters, setFilters] = useState<any>({ query: '', type: '', domain: '', stage: '', verificationStatus: '', favoriteOnly: false, pinnedOnly: false })
  const [draft, setDraft] = useState<Partial<KnowledgeEntry>>(emptyEntry())
  const [domainsDraft, setDomainsDraft] = useState('')
  const [stagesDraft, setStagesDraft] = useState('')
  const [editingId, setEditingId] = useState('')
  const [deleteId, setDeleteId] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('尚未加载资料库。')
  const [workspaceDirectory, setWorkspaceDirectory] = useState('')
  const [workspaceDirectories, setWorkspaceDirectories] = useState<WorkspaceDirectorySummary[]>([])
  const [workspaceReadCancellable, setWorkspaceReadCancellable] = useState(false)
  const workspaceReadRef = useRef<AbortController | null>(null)

  async function load() {
    setBusy(true)
    try {
      const result = unwrap(await remote.listKnowledgeEntries({ filters, workspaceSessionId: sessionId }))
      if (JSON.stringify(result.selectedIds) !== JSON.stringify(selectedIds)) {
        setPreview(null)
        onContextPreview?.(null)
      }
      setEntries(result.entries)
      setSelectedIds(result.selectedIds)
      setWorkspaceDirectories(result.workspaceDirectories ?? [])
      setFilters(result.filters ?? filters)
      setMessage(`已加载 ${result.entries.length} 条资料；本轮引用 ${result.selectedIds.length}/5。`)
    } catch (error) {
      setMessage(`读取资料失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function applyFilters() {
    setBusy(true)
    try {
      unwrap(await remote.setKnowledgeFilters({ filters, eventId: globalThis.crypto.randomUUID() }))
      const result = unwrap(await remote.listKnowledgeEntries({ filters }))
      setEntries(result.entries)
      setSelectedIds(result.selectedIds)
      setWorkspaceDirectories(result.workspaceDirectories ?? [])
      setMessage(`找到 ${result.entries.length} 条资料。`)
    } catch (error) {
      setMessage(`筛选失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  function beginEdit(entry: KnowledgeEntry) {
    setEditingId(entry.id)
    setDraft({ ...entry })
    setDomainsDraft((entry.domains ?? []).join(', '))
    setStagesDraft((entry.stages ?? []).join(', '))
  }

  function beginCreate() {
    setEditingId('')
    setDraft(emptyEntry())
    setDomainsDraft('')
    setStagesDraft('')
  }

  async function saveEntry() {
    if (!draft.title?.trim()) return setMessage('资料标题不能为空。')
    setBusy(true)
    try {
      unwrap(await remote.saveKnowledgeEntry({
        entry: { ...draft, id: editingId || undefined, title: draft.title.trim(), domains: splitList(domainsDraft), stages: splitList(stagesDraft) },
        eventId: globalThis.crypto.randomUUID(),
      }))
      setPreview(null)
      onContextPreview?.(null)
      setDraft(emptyEntry())
      setEditingId('')
      await load()
      setMessage('资料已保存。')
    } catch (error) {
      setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function toggleSelection(entryId: string) {
    const next = selectedIds.includes(entryId) ? selectedIds.filter(id => id !== entryId) : [...selectedIds, entryId]
    if (next.length > 5) return setMessage('本轮最多引用五条资料。')
    setBusy(true)
    try {
      const result = unwrap(await remote.setKnowledgeSelection({ ids: next, eventId: globalThis.crypto.randomUUID() }))
      setSelectedIds(result.selectedIds)
      setPreview(null)
      onContextPreview?.(null)
      setMessage(`本轮已选择 ${result.selectedIds.length}/5 条资料。`)
    } catch (error) { setMessage(`更新引用选择失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function toggleFlag(entry: KnowledgeEntry, flag: 'favorite' | 'pinned') {
    setBusy(true)
    try {
      unwrap(await remote.setKnowledgeFlags({ entryId: entry.id, patch: { [flag]: !entry[flag] }, eventId: globalThis.crypto.randomUUID() }))
      await load()
    } catch (error) { setMessage(`更新资料状态失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function removeEntry(entryId: string) {
    setBusy(true)
    try {
      unwrap(await remote.deleteKnowledgeEntry({ entryId, eventId: globalThis.crypto.randomUUID() }))
      setDeleteId('')
      setPreview(null)
      onContextPreview?.(null)
      await load()
      setMessage('资料已删除，已同步移除本轮引用。')
    } catch (error) { setMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function indexSelectedDirectory(files: FileList | File[] | null) {
    if (!files?.length) return
    setBusy(true)
    try {
      const prepared = await prepareSelectedKnowledgeFiles(files)
      const saved = []
      const failures = [...prepared.failures]
      for (const entry of prepared.entries) {
        try {
          unwrap(await remote.saveKnowledgeEntry({ entry, eventId: globalThis.crypto.randomUUID() }))
          saved.push(entry.title)
        } catch (error) {
          failures.push({ fileName: entry.title, code: error instanceof Error ? error.message : 'save_failed' })
        }
      }
      if (saved.length) {
        setPreview(null)
        onContextPreview?.(null)
        await load()
      }
      const failureSummary = failures.length ? `；${failures.length} 个文件未导入：${failures.map(item => `${item.fileName}（${item.code}）`).join('、')}` : ''
      setMessage(`已索引 ${saved.length} 个用户选择文件；仅保存快照，未自动加入本轮引用${failureSummary}`)
    } catch (error) {
      setMessage(`目录索引失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function indexDSHWorkspaceDirectory(directory = workspaceDirectory) {
    if (!sessionId?.trim()) { setMessage('请先填写当前 DSH 对话标识；它将作为工作区读取范围。'); return }
    if (!workspaceFiles) { setMessage('当前 DSH Host 未提供 workspaceFiles；无法读取会话工作区目录。'); return }
    const controller = new AbortController()
    workspaceReadRef.current = controller
    setWorkspaceReadCancellable(true)
    setBusy(true)
    try {
      const snapshot = await browseWorkspaceDirectory(workspaceFiles, { sessionId, directoryPath: directory, signal: controller.signal })
      if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('操作已取消', 'AbortError')
      workspaceReadRef.current = null
      setWorkspaceReadCancellable(false)
      const saved = unwrap(await remote.syncWorkspaceKnowledgeDirectory({ sessionId, directoryPath: snapshot.directoryPath, files: snapshot.files, eventId: globalThis.crypto.randomUUID() }))
      setWorkspaceDirectory(snapshot.directoryPath)
      setPreview(null)
      onContextPreview?.(null)
      await load()
      setMessage(`已从调用方提供的 Session 标识读取“${snapshot.directoryPath}”：更新 ${saved.indexed} 个文本文件快照，清理 ${saved.removed} 个已移除快照。范围由 DSH Host 按该 Session 的实际文件系统权限执行。资料未自动加入本轮引用。`)
    } catch (error) {
      if (controller.signal.aborted || (error as Error)?.name === 'AbortError') setMessage('已取消目录读取；本次快照未提交。')
      else setMessage(`DSH 目录索引失败，原快照保持不变：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (workspaceReadRef.current === controller) workspaceReadRef.current = null
      setWorkspaceReadCancellable(false)
      setBusy(false)
    }
  }

  function cancelDSHWorkspaceRead() {
    const controller = workspaceReadRef.current
    if (!controller) return
    controller.abort()
    workspaceReadRef.current = null
    setWorkspaceReadCancellable(false)
  }

  async function revokeDSHWorkspaceDirectory(directory: string) {
    if (!sessionId?.trim()) return setMessage('当前没有可用的 DSH Session。')
    setBusy(true)
    try {
      const result = unwrap(await remote.revokeWorkspaceKnowledgeDirectory({ sessionId, directoryPath: directory, eventId: globalThis.crypto.randomUUID() }))
      setPreview(null)
      onContextPreview?.(null)
      await load()
      setMessage(`已撤销“${directory}”的插件读取快照并删除 ${result.removed} 条资料；没有后台目录监听。`)
    } catch (error) { setMessage(`撤销目录快照失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }
  async function previewContext() {
    setBusy(true)
    try {
      const result = unwrap(await remote.previewKnowledgeContext())
      setPreview(result)
      onContextPreview?.(result.digest)
      setMessage('以下为已选择资料的隔离预览；未选择资料不会进入本轮引用。')
    } catch (error) { setPreview(null); onContextPreview?.(null); setMessage(`生成引用预览失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  return h('section', { 'aria-label': '资料库与本轮引用' },
    h('h2', { style: { fontSize: '17px', margin: '0' } }, '资料库'),
    h('p', null, '资料内容按不可信引用处理。只有明确勾选并在本轮启用后，资料摘要才会进入模型请求。'),
    h('div', null,
      h('label', null, '关键词 ', h('input', { value: filters.query, onChange: (event: any) => setFilters((value: any) => ({ ...value, query: event.target.value })) })),
      h('label', null, '类型 ', h('select', { value: filters.type, onChange: (event: any) => setFilters((value: any) => ({ ...value, type: event.target.value })) }, h('option', { value: '' }, '全部类型'), ...types.map(([value, label]) => h('option', { key: value, value }, label)))),
      h('label', null, '领域 ', h('input', { value: filters.domain, onChange: (event: any) => setFilters((value: any) => ({ ...value, domain: event.target.value })) })),
      h('label', null, '阶段 ', h('input', { value: filters.stage, onChange: (event: any) => setFilters((value: any) => ({ ...value, stage: event.target.value })) })),
      h('label', null, '验证状态 ', h('select', { value: filters.verificationStatus, onChange: (event: any) => setFilters((value: any) => ({ ...value, verificationStatus: event.target.value })) }, h('option', { value: '' }, '全部状态'), ...verificationStates.map(([value, label]) => h('option', { key: value, value }, label)))),
      h('label', null, h('input', { type: 'checkbox', checked: filters.favoriteOnly, onChange: (event: any) => setFilters((value: any) => ({ ...value, favoriteOnly: event.target.checked })) }), ' 仅收藏'),
      h('label', null, h('input', { type: 'checkbox', checked: filters.pinnedOnly, onChange: (event: any) => setFilters((value: any) => ({ ...value, pinnedOnly: event.target.checked })) }), ' 仅置顶')),
    h('button', { type: 'button', disabled: busy, onClick: applyFilters }, '筛选资料'),
    h('button', { type: 'button', disabled: busy, onClick: load }, '刷新资料库'),
    h('button', { type: 'button', disabled: busy, onClick: beginCreate }, '新增资料'),
    h('section', { 'aria-label': 'DSH 工作区目录索引' },
      h('h3', null, 'DSH 工作区目录'),
      h('p', null, workspaceFiles ? (sessionId ? `调用方提供的 Session 标识：${sessionId}。DSH Host 按此标识对应的工作区和文件权限执行读取；逐级列举并只读取你指定的相对目录，不会后台扫描或监听。` : '请先在任务区填写用于定位工作区的 DSH Session 标识。') : '当前 Host 未提供 workspaceFiles 能力，DSH 工作区目录索引不可用。'),
      h('label', null, '该 Session 工作区内相对目录（输入 . 表示工作区根目录）', h('input', { value: workspaceDirectory, disabled: busy, placeholder: '例如 docs/research 或 .', onChange: (event: any) => setWorkspaceDirectory(event.target.value) })),
      h('button', { type: 'button', disabled: busy || !workspaceFiles || !sessionId?.trim() || !workspaceDirectory.trim(), onClick: () => void indexDSHWorkspaceDirectory() }, '读取并索引此目录'),
      workspaceReadCancellable ? h('button', { type: 'button', onClick: cancelDSHWorkspaceRead }, '取消读取') : null,
      h('ul', null, ...workspaceDirectories.map(directory => h('li', { key: directory.directoryPath },
        h('span', null, `“${directory.directoryPath}” · ${directory.count} 个快照`),
        h('button', { type: 'button', disabled: busy || !workspaceFiles || !sessionId?.trim(), onClick: () => void indexDSHWorkspaceDirectory(directory.directoryPath) }, '刷新快照'),
        h('button', { type: 'button', disabled: busy, onClick: () => void revokeDSHWorkspaceDirectory(directory.directoryPath) }, '撤销并删除快照'))))),
    h('label', null, '手动选择本地目录文本/源码文件（浏览器快照）', h('input', { type: 'file', multiple: true, webkitdirectory: true, directory: true, accept: '.txt,.md,.markdown,.rst,.adoc,.csv,.tsv,.json,.jsonl,.ndjson,.log,.yaml,.yml,.toml,.xml,.html,.htm,.ini,.cfg,.conf,.properties,.js,.mjs,.cjs,.jsx,.ts,.tsx,.vue,.svelte,.css,.scss,.less,.py,.pyi,.rb,.go,.rs,.java,.kt,.kts,.c,.h,.cc,.cpp,.hpp,.cs,.php,.swift,.sh,.bash,.zsh,.ps1,.bat,.cmd,.sql,.graphql,.gql,.proto', disabled: busy, onChange: (event: any) => { void indexSelectedDirectory(event.target.files); event.target.value = '' } })),
    h('button', { type: 'button', disabled: busy || selectedIds.length === 0, onClick: previewContext }, '预览本轮引用'),
    draft ? h('fieldset', null,
      h('legend', null, editingId ? '编辑资料' : '新增资料'),
      h('label', null, '标题 ', h('input', { value: draft.title ?? '', onChange: (event: any) => setDraft(value => ({ ...value, title: event.target.value })) })),
      h('label', null, '类型 ', h('select', { value: draft.type ?? 'manual-note', onChange: (event: any) => setDraft(value => ({ ...value, type: event.target.value })) }, ...types.map(([value, label]) => h('option', { key: value, value }, label)))),
      h('label', null, '来源链接 ', h('input', { value: draft.sourceUrl ?? '', onChange: (event: any) => setDraft(value => ({ ...value, sourceUrl: event.target.value })) })),
      h('label', null, '领域标签 ', h('input', { value: domainsDraft, onChange: (event: any) => setDomainsDraft(event.target.value) })),
      h('label', null, '阶段标签 ', h('input', { value: stagesDraft, onChange: (event: any) => setStagesDraft(event.target.value) })),
      h('label', null, '验证状态 ', h('select', { value: draft.verificationStatus ?? 'unverified', onChange: (event: any) => setDraft(value => ({ ...value, verificationStatus: event.target.value })) }, ...verificationStates.map(([value, label]) => h('option', { key: value, value }, label)))),
      h('label', null, '摘要 ', h('textarea', { rows: 3, value: draft.summary ?? '', onChange: (event: any) => setDraft(value => ({ ...value, summary: event.target.value })) })),
      h('label', null, '来源摘录 ', h('textarea', { rows: 4, value: draft.contentExcerpt ?? '', onChange: (event: any) => setDraft(value => ({ ...value, contentExcerpt: event.target.value })) })),
      h('label', null, '适用边界 ', h('textarea', { rows: 2, value: draft.limitations ?? '', onChange: (event: any) => setDraft(value => ({ ...value, limitations: event.target.value })) })),
      h('button', { type: 'button', disabled: busy, onClick: saveEntry }, '保存资料'),
      h('button', { type: 'button', disabled: busy, onClick: beginCreate }, '清空表单')) : null,
    h('p', { role: 'status' }, message),
    h('p', null, `本轮引用 ${selectedIds.length}/5 条`),
    h('ul', null, ...entries.map(entry => h('li', { key: entry.id },
      h('label', null, h('input', { type: 'checkbox', checked: selectedIds.includes(entry.id), disabled: busy, onChange: () => void toggleSelection(entry.id) }), ` 引用：${entry.title}`),
      h('p', null, `${entry.type} · ${entry.verificationStatus ?? 'unverified'}${entry.domains?.length ? ` · ${entry.domains.join('、')}` : ''}`),
      entry.summary ? h('p', null, entry.summary) : null,
      entry.sourceUrl ? h('a', { href: entry.sourceUrl, target: '_blank', rel: 'noreferrer' }, '打开来源') : null,
      h('button', { type: 'button', disabled: busy, onClick: () => void toggleFlag(entry, 'favorite') }, entry.favorite ? '取消收藏' : '收藏'),
      h('button', { type: 'button', disabled: busy, onClick: () => void toggleFlag(entry, 'pinned') }, entry.pinned ? '取消置顶' : '置顶'),
      h('button', { type: 'button', disabled: busy, onClick: () => beginEdit(entry) }, '编辑'),
      deleteId === entry.id
        ? h('span', null, h('span', null, '确认删除此资料？'), h('button', { type: 'button', disabled: busy, onClick: () => void removeEntry(entry.id) }, '确认删除'), h('button', { type: 'button', onClick: () => setDeleteId('') }, '取消'))
        : h('button', { type: 'button', disabled: busy, onClick: () => setDeleteId(entry.id) }, '删除')))),
    preview ? h('section', { 'aria-label': '本轮引用预览', 'data-testid': 'knowledge-context-preview' },
      h('h3', null, `本轮引用预览 · ${preview.entries.length} 条`),
      ...preview.entries.map((entry: any) => h('p', { key: entry.id }, `${entry.title} · ${entry.verificationStatus}${entry.sourceUrl ? ` · ${entry.sourceUrl}` : ''}`)),
      h('pre', { style: { whiteSpace: 'pre-wrap' } }, preview.text || '所选条目没有可发送的摘要内容。')) : null)
}
