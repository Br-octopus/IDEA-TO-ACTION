import * as React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { isCurrentMemoryViewRequest, toMemoryView } from '../../client/memory.js'
import type { DeleteMemoryInput, EditMemoryInput, InvalidateMemorySourceInput, LearningControlOutput, MemoryMutationOutput, MemoryViewInput, MemoryViewOutput, RetryLearningInput, SetLearningPausedInput, SetMemoryStatusInput, UndoMemoryInput } from '../types.js'

export interface MemoryPanelRemote {
  getMemoryView(input: MemoryViewInput): Promise<RemoteResult<MemoryViewOutput>>
  setLearningPaused(input: SetLearningPausedInput): Promise<RemoteResult<LearningControlOutput>>
  retryLearning(input: RetryLearningInput): Promise<RemoteResult<LearningControlOutput>>
  editMemory(input: EditMemoryInput): Promise<RemoteResult<MemoryMutationOutput>>
  setMemoryStatus(input: SetMemoryStatusInput): Promise<RemoteResult<MemoryMutationOutput>>
  undoMemory(input: UndoMemoryInput): Promise<RemoteResult<MemoryMutationOutput>>
  deleteMemory(input: DeleteMemoryInput): Promise<RemoteResult<MemoryMutationOutput>>
  invalidateMemorySource(input: InvalidateMemorySourceInput): Promise<RemoteResult<MemoryMutationOutput>>
}

type Task = { projectId: string; taskId: string; revision: number; title: string; domain: string; entryType: string; originalInput: string; currentRequirements: string[]; versions: { versionId: string; stage: string }[] }
const { createElement: h, useEffect, useRef, useState } = React
const SCOPE_LABELS = { global: '全局', domain: '领域', project: '项目', task: '任务', conversation: '当前对话' } as const
const DOMAIN_LABELS = { general: '通用', writing: '写作', ppt: 'PPT' } as const

function unwrap<T>(response: RemoteResult<T>): T {
  if (response.ok) return response.value
  throw response.error
}

export function MemoryPanel({ remote, task, conversationId }: { remote: MemoryPanelRemote; task: Task; conversationId: string }) {
  const [tab, setTab] = useState<'task' | 'learning' | 'profile'>('task')
  const [crossTask, setCrossTask] = useState(false)
  const [view, setView] = useState<ReturnType<typeof toMemoryView> | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pendingUndo, setPendingUndo] = useState<{ change: any; memory: any; conflicts: any[]; choices: Record<string, 'keep' | 'restore'> } | null>(null)
  const viewRequestId = useRef(0)

  const context = { projectId: task.projectId, taskId: task.taskId, taskRevision: task.revision, conversationId }
  async function refresh(requestedCrossTask = crossTask) {
    const requestId = ++viewRequestId.current
    setLoading(true)
    setError('')
    try {
      const response = unwrap(await remote.getMemoryView({ ...context, crossTask: requestedCrossTask }))
      if (!isCurrentMemoryViewRequest(requestId, viewRequestId.current, response.taskId, task.taskId)) return
      setView(toMemoryView(response, context, { crossTask: requestedCrossTask }))
    } catch (cause) {
      if (requestId !== viewRequestId.current) return
      setError(`記憶讀取失敗：${cause instanceof Error ? cause.message : String(cause)}`)
      setView(null)
    } finally {
      if (requestId === viewRequestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    setView(null)
    setPendingUndo(null)
    void refresh(crossTask)
    return () => { viewRequestId.current += 1 }
  }, [task.taskId, task.revision, conversationId, crossTask])

  async function run(operation: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try { await operation(); setPendingUndo(null); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  function newEventId() { return globalThis.crypto.randomUUID() }
  function edit(memory: any, patch: EditMemoryInput['patch']) {
    return run(async () => { unwrap(await remote.editMemory({ ...context, memoryId: memory.memoryId, memoryRevision: memory.revision, patch, eventId: newEventId() })) })
  }
  function changeStatus(memory: any, status: 'active' | 'disabled') {
    return run(async () => { unwrap(await remote.setMemoryStatus({ ...context, memoryId: memory.memoryId, memoryRevision: memory.revision, status, eventId: newEventId() })) })
  }
  async function undo(change: any, memory: any, choices?: Record<string, 'keep' | 'restore'>) {
    setBusy(true)
    setError('')
    try {
      const result = unwrap(await remote.undoMemory({ ...context, memoryId: memory.memoryId, memoryRevision: memory.revision, changeEventId: change.eventId, ...(choices ? { resolve: choices } : {}), eventId: newEventId() }))
      if (result.needsResolution) setPendingUndo({ change, memory, conflicts: result.conflicts ?? [], choices: choices ?? {} })
      else { setPendingUndo(null); await refresh() }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  function removeMemory(memory: any) {
    const accepted = globalThis.confirm('删除后会清理插件中的记忆正文、历史副本和专属来源摘录；不会删除 DSH 原始对话、原始资料或用户备份。继续？')
    if (!accepted) return
    void run(async () => { unwrap(await remote.deleteMemory({ ...context, memoryId: memory.memoryId, memoryRevision: memory.revision, confirmed: true, eventId: newEventId() })) })
  }
  function invalidateSource(sourceId: string) {
    if (!globalThis.confirm('确认将此学习来源标记失效？关联记忆会重新检查证据并可能停止生效。')) return
    void run(async () => { unwrap(await remote.invalidateMemorySource({ ...context, sourceId, confirmed: true, eventId: newEventId() })) })
  }
  function pauseLearning(paused: boolean) {
    void run(async () => { unwrap(await remote.setLearningPaused({ ...context, paused, eventId: newEventId() })) })
  }
  function retry(jobId: string) {
    void run(async () => { unwrap(await remote.retryLearning({ ...context, jobId, eventId: newEventId() })) })
  }

  const sourceById = new Map((view?.sources ?? []).map((source: any) => [source.sourceId, source]))
  const scopeOptions = Object.entries(SCOPE_LABELS)
  const domainOptions = Object.entries(DOMAIN_LABELS)
  return h('section', { 'aria-label': '学习动态与用户画像', style: { minWidth: 0, padding: '12px', border: '1px solid var(--dsw-alias-border-primary, #8884)', borderRadius: '8px', overflowWrap: 'anywhere' } },
    h('h2', { style: { margin: '0 0 8px', fontSize: '16px' } }, '任务记忆与学习'),
    h('nav', { 'aria-label': '任务记忆视图', style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
      ...([['task', '任务'], ['learning', '学习动态'], ['profile', '用户画像']] as const).map(([value, label]) => h('button', { key: value, type: 'button', 'aria-pressed': tab === value, onClick: () => setTab(value) }, label))),
    loading ? h('p', { role: 'status' }, '正在读取学习记录…') : null,
    error ? h('p', { role: 'alert' }, error) : null,
    view && tab === 'task' ? h('div', null,
      h('p', null, `${task.title} · ${task.domain} · ${task.versions.length} 个已保存版本`),
      h('h3', null, '本任务生成时实际采用的记忆'),
      view.usedMemories.length ? h('ul', null, ...view.usedMemories.map((used: any) => h('li', { key: `${used.versionId}:${used.memoryId}:${used.revision}` }, `${used.versionId.slice(0, 8)} 使用 ${used.memoryId.slice(0, 8)}@${used.revision}`))) : h('p', null, '当前版本没有记录已采用的记忆。'),
      h('p', null, '任务结果先保存，学习在后台完成；外部 AI 结果由你带回后再复盘。')) : null,
    view && tab === 'learning' ? h('div', null,
      h('label', null, h('input', { type: 'checkbox', checked: crossTask, onChange: (event: any) => setCrossTask(event.target.checked) }), '显示跨任务学习摘要（默认关闭）'),
      h('label', null, h('input', { type: 'checkbox', checked: view.learningPaused, disabled: busy, onChange: (event: any) => pauseLearning(event.target.checked) }), '暂停自动学习（任务仍会保存）'),
      h('h3', null, '学习队列'),
      view.jobs.length ? h('ul', null, ...view.jobs.map((job: any) => h('li', { key: job.jobId }, `${job.status}${job.summary ? ` · ${job.summary}` : ''}${job.errorCode ? ` · ${job.errorCode}` : ''}`, ['failed', 'paused'].includes(job.status) ? h('button', { type: 'button', disabled: busy || view.learningPaused, onClick: () => retry(job.jobId), title: '重试此学习任务' }, '重试') : null))) : h('p', null, '没有学习任务。'),
      h('h3', null, '记忆与来源'),
      view.memories.length ? view.memories.map((memory: any) => h('article', { key: memory.memoryId, style: { minWidth: 0, margin: '10px 0', padding: '10px', border: '1px solid var(--dsw-alias-border-primary, #8884)', borderRadius: '6px' } },
        h('strong', null, `${memory.key} · ${memory.status === 'active' ? '生效' : memory.status === 'candidate' ? '候选' : '已停用'}`),
        h('p', null, memory.value),
        h('small', null, `范围：${SCOPE_LABELS[memory.scope as keyof typeof SCOPE_LABELS] ?? memory.scope} · ${memory.domains?.map((domain: string) => DOMAIN_LABELS[domain as keyof typeof DOMAIN_LABELS] ?? domain).join('、') || '所有领域'} · revision ${memory.revision}`),
        memory.reason ? h('p', null, `依据：${memory.reason}`) : null,
        view.memories.some((other: any) => other.memoryId !== memory.memoryId && other.key === memory.key && other.status === 'active' && other.scope === memory.scope && other.projectId === memory.projectId && other.taskId === memory.taskId && other.conversationId === memory.conversationId && JSON.stringify(other.domains ?? []) === JSON.stringify(memory.domains ?? []) && other.value !== memory.value) ? h('div', { role: 'alert' }, h('strong', null, '同范围偏好冲突'), h('ul', null, ...view.memories.filter((other: any) => other.memoryId !== memory.memoryId && other.key === memory.key && other.status === 'active' && other.scope === memory.scope && other.projectId === memory.projectId && other.taskId === memory.taskId && other.conversationId === memory.conversationId && JSON.stringify(other.domains ?? []) === JSON.stringify(memory.domains ?? []) && other.value !== memory.value).map((other: any) => h('li', { key: other.memoryId }, `${other.value} (${other.memoryId.slice(0, 8)}@${other.revision})`))), memory.status === 'candidate' ? h('button', { type: 'button', disabled: busy, onClick: () => changeStatus(memory, 'active'), title: '采用此候选并停用同范围的冲突值' }, '采用此值') : null) : null,
        h('ul', null, ...(memory.sourceRefs ?? []).map((sourceId: string) => {
          const source: any = sourceById.get(sourceId)
          return h('li', { key: sourceId }, source
            ? `${source.active ? '来源' : '来源已失效'} · ${source.kind} · ${source.locator ?? '原定位已失效'} · ${source.excerpt}`
            : `来源已失效 · ${sourceId}`, source?.active && source.taskId === task.taskId ? h('button', { type: 'button', disabled: busy, title: '将来源标记为失效', onClick: () => invalidateSource(sourceId) }, '停用来源') : null)
        })),
        h('label', null, '修订记忆 ', h('input', { value: drafts[memory.memoryId] ?? memory.value, onChange: (event: any) => setDrafts(current => ({ ...current, [memory.memoryId]: event.target.value })) })),
        h('button', { type: 'button', disabled: busy || !(drafts[memory.memoryId] ?? memory.value).trim(), onClick: () => edit(memory, { value: drafts[memory.memoryId] ?? memory.value }) }, '保存修订'),
        h('label', null, '作用范围 ', h('select', { value: memory.scope, disabled: busy, onChange: (event: any) => edit(memory, { scope: event.target.value }) }, ...scopeOptions.map(([value, label]) => h('option', { key: value, value }, label)))),
        h('fieldset', null, h('legend', null, '适用领域'), ...domainOptions.map(([value, label]) => h('label', { key: value }, h('input', { type: 'checkbox', checked: (memory.domains ?? []).includes(value), disabled: busy, onChange: (event: any) => edit(memory, { domains: event.target.checked ? [...new Set([...(memory.domains ?? []), value])] : (memory.domains ?? []).filter((domain: string) => domain !== value) }) }), label))),
        h('button', { type: 'button', disabled: busy, title: memory.status === 'active' ? '停用这条记忆并阻止自动复活' : '明确恢复这条记忆', onClick: () => changeStatus(memory, memory.status === 'active' ? 'disabled' : 'active') }, memory.status === 'active' ? '停用' : '恢复'),
        h('button', { type: 'button', disabled: busy, title: '删除记忆正文及其专属历史副本', onClick: () => removeMemory(memory) }, '删除…'),
        h('details', null, h('summary', null, '变更历史与撤销'), ...(view.changes.filter((change: any) => change.memoryId === memory.memoryId).map((change: any) => h('div', { key: change.eventId, style: { minWidth: 0 } },
          h('p', null, `${change.reason} · ${change.createdAt}${change.auditRedacted ? ' · 已按删除请求清理正文' : ''}`),
          h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, `前：${JSON.stringify(change.before)}\n后：${JSON.stringify(change.after)}`),
          !change.auditRedacted && change.changedFields?.length && change.reason !== 'undo' ? h('button', { type: 'button', disabled: busy, onClick: () => void undo(change, memory) }, '撤销此变更') : null,
          pendingUndo?.change.eventId === change.eventId ? h('div', { role: 'alert' }, h('p', null, '这些字段后来又有修改，请逐项选择，不会静默覆盖：'), ...pendingUndo.conflicts.map((conflict: any) => h('label', { key: conflict.field }, `${conflict.field} 当前=${JSON.stringify(conflict.current)}，撤销目标=${JSON.stringify(conflict.before)} `, h('select', { value: pendingUndo.choices[conflict.field] ?? '', onChange: (event: any) => setPendingUndo(current => current ? { ...current, choices: { ...current.choices, [conflict.field]: event.target.value } } : current) }, h('option', { value: '' }, '选择处理方式'), h('option', { value: 'keep' }, '保留现值'), h('option', { value: 'restore' }, '恢复旧值')))), h('button', { type: 'button', disabled: busy || pendingUndo.conflicts.some((conflict: any) => !pendingUndo.choices[conflict.field]), onClick: () => void undo(change, memory, pendingUndo.choices) }, '确认撤销')) : null,
        )))))) : h('p', null, '当前没有可显示的记忆记录。')) : null,
    view && tab === 'profile' ? h('div', null,
      h('p', null, '画像由当前适用且有有效来源的记忆实时生成，不另存一份无法回溯的结论。'),
      view.profile.length ? h('ul', null, ...view.profile.map((item: any) => h('li', { key: `${item.key}:${item.memories.map((memory: any) => memory.memoryId).join(',')}` }, `${item.key}：${item.value} · ${SCOPE_LABELS[item.scope as keyof typeof SCOPE_LABELS] ?? item.scope} · ${item.memories.map((memory: any) => `${memory.memoryId.slice(0, 8)}@${memory.revision}`).join('、')}`))) : h('p', null, '当前任务没有已生效画像。')) : null)
}
