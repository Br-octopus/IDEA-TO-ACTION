import * as React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

type WritingRound = { id: string; taskType?: string; prompt?: string; draft?: string; feedback?: string; reviewStatus?: string; reviewNote?: string; restoredFromRoundId?: string }
type WritingWorkspace = { id: string; genre: string; projectId?: string; taskId?: string; article: { title?: string; goal?: string; domainInputs?: Record<string, string>; academicTarget?: Record<string, string> }; rounds: WritingRound[] }
type Genre = { genre: string; name: string; applicability?: string; domainFields?: Record<string, string>; fieldStorage?: 'domainInputs' | 'academicTarget'; materialPurposes?: string[]; status: 'supported' | 'partial' | 'unsupported'; taskTypes: string[]; reason: string }

export type WritingWorkspaceRemote = {
  listWritingGenres(): Promise<RemoteResult<{ genres: Genre[] }>>
  listWritingWorkspaces(input: { projectId?: string; taskId?: string }): Promise<RemoteResult<{ workspaces: WritingWorkspace[]; revision: number }>>
  createWritingWorkspace(input: { genre: string; title: string; goal: string; projectId?: string; taskId?: string; domainInputs?: Record<string, string> }): Promise<RemoteResult<{ workspace: WritingWorkspace; revision: number }>>
  saveWritingWorkspace(input: { workspace: WritingWorkspace }): Promise<RemoteResult<{ workspace: WritingWorkspace; revision: number }>>
  appendWritingRound(input: { articleId: string; round: Record<string, unknown> }): Promise<RemoteResult<{ workspace: WritingWorkspace; revision: number }>>
  setWritingRoundReview(input: { articleId: string; roundId: string; status: 'confirmed' | 'skipped'; note?: string }): Promise<RemoteResult<{ workspace: WritingWorkspace; revision: number }>>
  restoreWritingRound(input: { articleId: string; roundId: string }): Promise<RemoteResult<{ workspace: WritingWorkspace; revision: number }>>
  compareWritingRounds(input: { articleId: string; leftRoundId: string; rightRoundId: string }): Promise<RemoteResult<{ comparison: any; workspace: WritingWorkspace; revision: number }>>
  getPluginServiceConfig(): Promise<RemoteResult<{ serviceConfig: { auxiliaryWritingEndpoint: string; auxiliaryWritingModel: string } }>>
  runAuxiliaryWriting(input: { prompt: string; confirmed: boolean }, signal?: AbortSignal): Promise<RemoteResult<{ text: string; model: string }>>
}

const { createElement: h, useRef, useState } = React
function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

export function WritingWorkspacePanel({ remote, projectId, taskId }: { remote: WritingWorkspaceRemote; projectId?: string; taskId?: string }) {
  const [genres, setGenres] = useState<Genre[]>([])
  const [workspaces, setWorkspaces] = useState<WritingWorkspace[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [genre, setGenre] = useState('article')
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [newDomainInputs, setNewDomainInputs] = useState<Record<string, string>>({})
  const [workspaceDomainInputs, setWorkspaceDomainInputs] = useState<Record<string, string>>({})
  const [taskType, setTaskType] = useState('')
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState('')
  const [feedback, setFeedback] = useState('')
  const [externalResultId, setExternalResultId] = useState('')
  const [leftRoundId, setLeftRoundId] = useState('')
  const [rightRoundId, setRightRoundId] = useState('')
  const [comparison, setComparison] = useState<any>(null)
  const [auxiliaryResult, setAuxiliaryResult] = useState('')
  const [auxiliaryBusy, setAuxiliaryBusy] = useState(false)
  const auxiliaryController = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('写作文章、提示词轮次和复盘状态保存在插件工作区。')
  const selected = workspaces.find(item => item.id === selectedId)
  const selectedGenre = genres.find(item => item.genre === selected?.genre)
  const creationGenre = genres.find(item => item.genre === genre)

  async function load() {
    setBusy(true)
    try {
      const [genreResult, listResult] = await Promise.all([
        remote.listWritingGenres(), remote.listWritingWorkspaces({ projectId, taskId }),
      ])
      const nextGenres = unwrap(genreResult).genres
      setGenres(nextGenres)
      if (!taskType && nextGenres.length) setTaskType(nextGenres.find(item => item.genre === genre)?.taskTypes[0] ?? '')
      const next = unwrap(listResult).workspaces
      setWorkspaces(next)
      if (selectedId && !next.some(item => item.id === selectedId)) setSelectedId('')
      setMessage(`已加载 ${next.length} 个写作工作区；文体状态按已完成能力如实标注。`)
    } catch (error) { setMessage(`读取写作工作区失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function create() {
    if (!title.trim() || !goal.trim()) return setMessage('请填写文章名称和写作目标。')
    setBusy(true)
    try {
      const result = unwrap(await remote.createWritingWorkspace({ genre, title: title.trim(), goal: goal.trim(), projectId, taskId, ...(Object.keys(newDomainInputs).length ? { domainInputs: newDomainInputs } : {}) }))
      setWorkspaces(current => [result.workspace, ...current.filter(item => item.id !== result.workspace.id)])
      setSelectedId(result.workspace.id)
      setWorkspaceDomainInputs(result.workspace.article.domainInputs ?? result.workspace.article.academicTarget ?? newDomainInputs)
      setPrompt(''); setDraft(''); setFeedback(''); setExternalResultId(''); setComparison(null)
      setMessage('写作工作区已创建并关联当前项目/任务。')
    } catch (error) { setMessage(`创建工作区失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function saveMetadata() {
    if (!selected) return
    setBusy(true)
    try {
      const result = unwrap(await remote.saveWritingWorkspace({ workspace: { ...selected, article: { ...selected.article, title: selected.article.title ?? '', goal: selected.article.goal ?? '', ...(selected.genre === 'academic-paper' ? { academicTarget: { ...(selected.article.academicTarget ?? {}), ...workspaceDomainInputs } } : { domainInputs: workspaceDomainInputs }) } } }))
      setWorkspaces(current => current.map(item => item.id === result.workspace.id ? result.workspace : item))
      setMessage('文章元数据已保存；已有轮次正文保持不变。')
    } catch (error) { setMessage(`保存文章失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function requestAuxiliaryDraft() {
    if (!selected) return setMessage('请先选择一个写作工作区。')
    const previousRound = selected.rounds.at(-1)
    const requestText = [
      `文章：${selected.article.title ?? ''}`,
      `写作目标：${selected.article.goal ?? ''}`,
      `文体：${selected.genre}`,
      `本轮任务：${taskType || previousRound?.taskType || ''}`,
      `提示词：${prompt.trim() || previousRound?.prompt?.trim() || ''}`,
      `已有稿件：${draft.trim() || previousRound?.draft?.trim() || ''}`,
      `反馈：${feedback.trim() || previousRound?.feedback?.trim() || ''}`,
    ].filter(item => item.split('：')[1]?.trim()).join('\n\n')
    if (!requestText || requestText.length > 30000) return setMessage('请填写提示词或稿件；辅助写作输入不得超过 30000 字符。')
    setBusy(true)
    try {
      const { serviceConfig } = unwrap(await remote.getPluginServiceConfig())
      if (!serviceConfig.auxiliaryWritingEndpoint || !serviceConfig.auxiliaryWritingModel) return setMessage('请先在插件设置中配置并保存辅助写作端点与模型。')
      if (typeof globalThis.confirm !== 'function' || !globalThis.confirm(`将把本轮文章信息、提示词、稿件与反馈（${requestText.length} 字符）发送至 ${serviceConfig.auxiliaryWritingEndpoint}。结果不会自动覆盖稿件，继续？`)) return
      const controller = new AbortController()
      auxiliaryController.current = controller
      setAuxiliaryBusy(true)
      const result = unwrap(await remote.runAuxiliaryWriting({ prompt: requestText, confirmed: true }, controller.signal))
      setAuxiliaryResult(result.text)
      setMessage(`辅助写作结果已返回（${result.model}）；检查后可手动将其填入本轮稿件。`)
    } catch (error) { setMessage(`辅助写作调用失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { auxiliaryController.current = null; setAuxiliaryBusy(false); setBusy(false) }
  }

  async function appendRound() {
    if (!selected) return setMessage('请先选择一个写作工作区。')
    if (!prompt.trim() && !draft.trim()) return setMessage('请填写提示词或外部 AI 回填稿件后再保存新轮次。')
    setBusy(true)
    try {
      const result = unwrap(await remote.appendWritingRound({ articleId: selected.id, round: {
        taskType: taskType || selectedGenre?.taskTypes[0], prompt, draft, feedback, externalResultId: externalResultId.trim() || undefined,
        parentRoundId: selected.rounds.at(-1)?.id,
      } }))
      setWorkspaces(current => current.map(item => item.id === result.workspace.id ? result.workspace : item))
      setPrompt(''); setDraft(''); setFeedback(''); setExternalResultId(''); setComparison(null)
      setMessage('新轮次已追加；历史轮次保留不变，外部 AI 结果由用户回填。')
    } catch (error) { setMessage(`保存轮次失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function reviewRound(roundId: string, status: 'confirmed' | 'skipped') {
    if (!selected) return
    setBusy(true)
    try {
      const result = unwrap(await remote.setWritingRoundReview({ articleId: selected.id, roundId, status, note: status === 'confirmed' ? '用户已复盘确认' : '用户选择跳过复盘' }))
      setWorkspaces(current => current.map(item => item.id === result.workspace.id ? result.workspace : item))
      setMessage(status === 'confirmed' ? '复盘状态已确认。' : '复盘状态已标记为跳过。')
    } catch (error) { setMessage(`保存复盘失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function restoreRound(roundId: string) {
    if (!selected) return
    setBusy(true)
    try {
      const result = unwrap(await remote.restoreWritingRound({ articleId: selected.id, roundId }))
      setWorkspaces(current => current.map(item => item.id === result.workspace.id ? result.workspace : item))
      setMessage('已从所选轮次追加恢复版本，原有版本未覆盖。')
    } catch (error) { setMessage(`恢复轮次失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function compareRounds() {
    if (!selected || !leftRoundId || !rightRoundId) return setMessage('请选择两个轮次进行比较。')
    setBusy(true)
    try {
      const result = unwrap(await remote.compareWritingRounds({ articleId: selected.id, leftRoundId, rightRoundId }))
      setComparison(result.comparison)
      setMessage('已生成轮次差异摘要。')
    } catch (error) { setMessage(`比较轮次失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  return h('section', { 'aria-label': '写作工作区' },
    h('h3', null, '写作工作区与轮次'),
    h('p', null, '可保存文章、提示词、人工回填结果与复盘状态；保存不代表外部 AI 已执行。'),
    h('button', { type: 'button', disabled: busy, onClick: () => void load() }, '读取写作工作区'),
    h('div', null,
      h('label', null, '文体 ', h('select', { value: genre, disabled: busy, onChange: (event: any) => { const nextGenre = event.target.value; setGenre(nextGenre); setNewDomainInputs({}); setTaskType(genres.find(item => item.genre === nextGenre)?.taskTypes[0] ?? '') } }, ...genres.map(item => h('option', { key: item.genre, value: item.genre }, `${item.name} · ${item.status}`)))),
      h('label', null, '文章名称 ', h('input', { value: title, maxLength: 200, disabled: busy, onChange: (event: any) => setTitle(event.target.value) })),
      h('label', null, '写作目标 ', h('input', { value: goal, maxLength: 1000, disabled: busy, onChange: (event: any) => setGoal(event.target.value) })),
      ...Object.entries(creationGenre?.domainFields ?? {}).map(([field, label]) => h('label', { key: `new-${field}` }, `${label} `, h('textarea', { rows: 2, value: newDomainInputs[field] ?? '', maxLength: 1000, disabled: busy, onChange: (event: any) => setNewDomainInputs(current => ({ ...current, [field]: event.target.value })) }))),
      creationGenre?.applicability ? h('small', null, creationGenre.applicability) : null,
      h('button', { type: 'button', disabled: busy || !genres.length || !title.trim() || !goal.trim(), onClick: () => void create() }, '创建写作工作区')),
    workspaces.length ? h('ul', null, ...workspaces.map(item => h('li', { key: item.id }, h('button', { type: 'button', disabled: busy, 'aria-pressed': item.id === selectedId, onClick: () => { setSelectedId(item.id); setWorkspaceDomainInputs(item.article.domainInputs ?? item.article.academicTarget ?? {}); setTaskType(item.rounds.at(-1)?.taskType ?? genres.find(value => value.genre === item.genre)?.taskTypes[0] ?? ''); setComparison(null) } }, `${item.article.title || '未命名文章'} · ${genres.find(value => value.genre === item.genre)?.status ?? '未加载'} · ${item.rounds.length} 轮`)))) : h('p', null, '暂无写作工作区。'),
    selected ? h('div', null,
      h('label', null, '文章名称 ', h('input', { value: selected.article.title ?? '', disabled: busy, onChange: (event: any) => setWorkspaces(current => current.map(item => item.id === selected.id ? { ...item, article: { ...item.article, title: event.target.value } } : item)) })),
      h('label', null, '写作目标 ', h('textarea', { rows: 2, value: selected.article.goal ?? '', disabled: busy, onChange: (event: any) => setWorkspaces(current => current.map(item => item.id === selected.id ? { ...item, article: { ...item.article, goal: event.target.value } } : item)) })),
      h('p', null, `关联项目：${selected.projectId || '无'}；关联任务：${selected.taskId || '无'}`),
      ...Object.entries(selectedGenre?.domainFields ?? {}).map(([field, label]) => h('label', { key: `edit-${field}` }, `${label} `, h('textarea', { rows: 2, value: workspaceDomainInputs[field] ?? selected.article.domainInputs?.[field] ?? selected.article.academicTarget?.[field] ?? '', maxLength: 1000, disabled: busy, onChange: (event: any) => setWorkspaceDomainInputs(current => ({ ...current, [field]: event.target.value })) }))),
      h('button', { type: 'button', disabled: busy, onClick: () => void saveMetadata() }, '保存文章信息'),
      selectedGenre?.applicability ? h('small', null, selectedGenre.applicability) : null,
      h('h4', null, '追加新轮次'),
      h('label', null, '本轮任务类型 ', h('select', { value: taskType || selectedGenre?.taskTypes[0] || '', disabled: busy || !selectedGenre?.taskTypes.length, onChange: (event: any) => setTaskType(event.target.value) }, ...(selectedGenre?.taskTypes ?? []).map(type => h('option', { key: type, value: type }, type)))),
      h('label', null, '提示词 ', h('textarea', { rows: 4, value: prompt, disabled: busy, onChange: (event: any) => setPrompt(event.target.value) })),
      h('label', null, '外部 AI 回填稿件 ', h('textarea', { rows: 5, value: draft, disabled: busy, onChange: (event: any) => setDraft(event.target.value) })),
      h('button', { type: 'button', disabled: busy || (!prompt.trim() && !draft.trim() && !selected?.rounds.at(-1)?.prompt && !selected?.rounds.at(-1)?.draft), onClick: () => void requestAuxiliaryDraft() }, '用辅助写作服务生成草稿建议'),
      auxiliaryBusy ? h('button', { type: 'button', disabled: false, onClick: () => auxiliaryController.current?.abort(new Error('用户取消辅助写作请求')) }, '取消辅助写作请求') : null,
      auxiliaryResult ? h('section', { 'aria-label': '辅助写作结果' }, h('pre', null, auxiliaryResult), h('button', { type: 'button', disabled: busy, onClick: () => { setDraft(auxiliaryResult); setAuxiliaryResult(''); setMessage('结果已填入当前草稿；保存新轮次后才会持久化。') } }, '将结果填入本轮稿件')) : null,
      h('label', null, '本轮反馈 ', h('textarea', { rows: 2, value: feedback, disabled: busy, onChange: (event: any) => setFeedback(event.target.value) })),
      h('label', null, '外部结果引用 ID（可选） ', h('input', { value: externalResultId, maxLength: 100, disabled: busy, onChange: (event: any) => setExternalResultId(event.target.value) })),
      h('button', { type: 'button', disabled: busy, onClick: () => void appendRound() }, '保存为新轮次'),
      selected.rounds.length ? h('section', { 'aria-label': '写作轮次列表' },
        h('h4', null, '历史轮次'),
        h('ul', null, ...selected.rounds.map(round => h('li', { key: round.id }, `${round.id} · ${round.reviewStatus ?? 'pending'}${round.restoredFromRoundId ? ` · 从 ${round.restoredFromRoundId} 恢复` : ''} `,
          h('button', { type: 'button', disabled: busy, onClick: () => void reviewRound(round.id, 'confirmed') }, '确认复盘'),
          h('button', { type: 'button', disabled: busy, onClick: () => void reviewRound(round.id, 'skipped') }, '跳过复盘'),
          h('button', { type: 'button', disabled: busy, onClick: () => void restoreRound(round.id) }, '从此轮恢复')))),
        h('div', null,
          h('label', null, '比较左侧轮次 ', h('select', { value: leftRoundId, onChange: (event: any) => setLeftRoundId(event.target.value) }, h('option', { value: '' }, '请选择'), ...selected.rounds.map(round => h('option', { key: round.id, value: round.id }, round.id)))),
          h('label', null, '比较右侧轮次 ', h('select', { value: rightRoundId, onChange: (event: any) => setRightRoundId(event.target.value) }, h('option', { value: '' }, '请选择'), ...selected.rounds.map(round => h('option', { key: round.id, value: round.id }, round.id)))),
          h('button', { type: 'button', disabled: busy, onClick: () => void compareRounds() }, '比较轮次')),
        comparison ? h('pre', null, JSON.stringify(comparison, null, 2)) : null) : null) : null,
    h('p', { role: 'status', 'aria-live': 'polite' }, message))
}

