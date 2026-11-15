import * as React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import forwardStepRemote from '@local/forward-step-dsh/remote'
import type {} from '@local/forward-step-dsh/remote'
import { createClientState, reduceClient } from '../../client/state.js'
import { deleteTaskDraft, readTaskDraft, writeTaskDraft } from '../../client/drafts.js'

type PluginRemote = {
  echo(input: { marker: string }): Promise<RemoteResult<{ marker: string; observed: boolean }>>
  wait(input: { marker: string; milliseconds: number }, signal?: AbortSignal): Promise<RemoteResult<{ marker: string; observed: boolean }>>
  storageWrite(input: { marker: string }): Promise<RemoteResult<{ marker: string; stored: boolean }>>
  storageRead(): Promise<RemoteResult<{ marker: string; stored: boolean }>>
  agentIsolation(signal?: AbortSignal): Promise<RemoteResult<any>>
  realModelIsolation(input: { provider: string; model: string }, signal?: AbortSignal): Promise<RemoteResult<any>>
  listProviders(): Promise<RemoteResult<{ providers: { id: string; name: string }[] }>>
  listModels(input: { provider: string }): Promise<RemoteResult<{ models: { provider: string; id: string; name: string }[] }>>
  listTasks(input: { cwd: string; archived?: boolean }): Promise<RemoteResult<{ projectId: string; revision: number; tasks: Task[] }>>
  getCurrentBinding(input: { projectId: string; conversationId: string }): Promise<RemoteResult<{ binding: { taskId: string } | null }>>
  createTask(input: { cwd: string; title?: string; entryType: string; domain: string; originalInput: string; conversationId: string; eventId: string }): Promise<RemoteResult<{ task: Task; revision: number }>>
  updateTask(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; patch: { title?: string }; eventId: string }): Promise<RemoteResult<{ task: Task; revision: number }>>
  archiveTask(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; archived: boolean; eventId: string }): Promise<RemoteResult<{ task: Task; revision: number }>>
  previewDeleteTask(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string }): Promise<RemoteResult<{ impact: { title: string; bindingCount: number; versionCount: number; reviewCount: number; memoryCount: number; sourceCount: number } }>>
  deleteTask(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; confirmed: boolean; eventId: string }): Promise<RemoteResult<{ deleted: boolean; taskId: string; revision: number }>>
  saveExternalResult(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; stepId: string; promptVersionId: string; content: string; feedback?: string; eventId: string }): Promise<RemoteResult<{ task: Task; version: TaskVersion; revision: number }>>
  bindTask(input: { projectId: string; taskId: string; conversationId: string; eventId: string }): Promise<RemoteResult<{ binding: any; revision: number }>>
  runTask(input: { taskId: string; taskRevision: number; stage: string; requestId: string; projectId: string; conversationId: string; provider: string; model: string }, signal?: AbortSignal): Promise<RemoteResult<any>>
  cancelTask(input: { requestId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
}

type TaskVersion = { versionId: string; requestId?: string; eventId?: string; kind?: 'agent-output' | 'external-result'; stage: string; stepId?: string; promptVersionId?: string; content: string; feedback?: string; createdAt: string }
type Task = { taskId: string; revision: number; title: string; domain: string; entryType: string; originalInput: string; archived?: boolean; currentRequirements: string[]; versions: TaskVersion[]; projectId: string; agent?: { steps?: { id: string; title: string; status?: string }[]; currentStepId?: string } }
type ExternalDraft = { content: string; feedback: string; stepId: string; promptVersionId: string }


const { createElement: h, useState } = React
const panelId = 'forward-step-dsh'

function unwrapRemote<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

function Panel({ remote }: { remote: PluginRemote }) {
  const [result, setResult] = useState('尚未调用 Host')
  const [busy, setBusy] = useState(false)
  const [cwd, setCwd] = useState('')
  const [cwdLoaded, setCwdLoaded] = useState(false)
  const [conversationId, setConversationId] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [input, setInput] = useState('')
  const [entryType, setEntryType] = useState('advance-idea')
  const [domain, setDomain] = useState('general')
  const [showArchived, setShowArchived] = useState(false)
  const [clientState, setClientState] = useState(createClientState())
  const [deleteImpact, setDeleteImpact] = useState<any>(null)
  const [stage, setStage] = useState('planning')
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([])
  const [models, setModels] = useState<{ provider: string; id: string; name: string }[]>([])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [projectId, setProjectId] = useState('')
  const [runningRequest, setRunningRequest] = useState('')
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [externalDraftsByTask, setExternalDraftsByTask] = useState<Record<string, ExternalDraft>>({})
  const [draftStorageStatusByTask, setDraftStorageStatusByTask] = useState<Record<string, 'saved' | 'error'>>({})
  const selectedTask = tasks.find(task => task.taskId === selectedTaskId)
  const renameDraft = selectedTask ? (clientState.draftsByTask[selectedTaskId] ?? selectedTask.title) : ''
  const externalDraft = selectedTask ? (externalDraftsByTask[selectedTask.taskId] ?? { content: '', feedback: '', stepId: '', promptVersionId: '' }) : { content: '', feedback: '', stepId: '', promptVersionId: '' }
  const externalSteps = selectedTask?.agent?.steps?.length ? selectedTask.agent.steps : [{ id: 'task', title: '整项任务' }]
  const externalStepId = externalSteps.some(step => step.id === externalDraft.stepId) ? externalDraft.stepId : externalSteps[0].id
  const promptVersions = selectedTask?.versions.filter(version => version.kind !== 'external-result') ?? []
  const externalPromptVersionId = promptVersions.some(version => version.versionId === externalDraft.promptVersionId) ? externalDraft.promptVersionId : (promptVersions.at(-1)?.versionId ?? '')
  function dispatchClient(event: any) { setClientState(current => reduceClient(current, event)) }

  function persistTaskDraft(taskId: string, patch: { title?: string; externalResult?: Partial<ExternalDraft> }) {
    if (!projectId) return false
    try {
      writeTaskDraft(window.localStorage, projectId, taskId, patch)
      setDraftStorageStatusByTask(current => ({ ...current, [taskId]: 'saved' }))
      return true
    } catch (error) {
      setDraftStorageStatusByTask(current => ({ ...current, [taskId]: 'error' }))
      setResult(`本机草稿保存失败，当前输入仍保留在面板：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  function updateExternalDraft(task: Task, draft: ExternalDraft) {
    setExternalDraftsByTask(current => ({ ...current, [task.taskId]: draft }))
    persistTaskDraft(task.taskId, { externalResult: draft })
  }

  async function loadTasks() {
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.listTasks({ cwd, archived: showArchived }))
      setProjectId(response.projectId)
      setCwdLoaded(true)
      setTasks(response.tasks)
      const restoredExternalDrafts: Record<string, ExternalDraft> = {}
      const restoredTitles: { taskId: string; title: string }[] = []
      const restoredDraftIds: string[] = []
      let draftRestoreFailed = false
      for (const task of response.tasks) {
        try {
          const draft = readTaskDraft(window.localStorage, response.projectId, task.taskId)
          if (draft?.title) {
            restoredTitles.push({ taskId: task.taskId, title: draft.title })
            restoredDraftIds.push(task.taskId)
          }
          if (draft?.externalResult) {
            restoredExternalDrafts[task.taskId] = {
              content: typeof draft.externalResult.content === 'string' ? draft.externalResult.content : '',
              feedback: typeof draft.externalResult.feedback === 'string' ? draft.externalResult.feedback : '',
              stepId: typeof draft.externalResult.stepId === 'string' ? draft.externalResult.stepId : '',
              promptVersionId: typeof draft.externalResult.promptVersionId === 'string' ? draft.externalResult.promptVersionId : '',
            }
            restoredDraftIds.push(task.taskId)
          }
        } catch {
          draftRestoreFailed = true
        }
      }
      setExternalDraftsByTask(restoredExternalDrafts)
      setDraftStorageStatusByTask(Object.fromEntries(restoredDraftIds.map(taskId => [taskId, 'saved'])))
      setClientState(current => restoredTitles.reduce((state, draft) => reduceClient(state, { type: 'draft.restored', taskId: draft.taskId, draft: draft.title }), current))
      const current = conversationId.trim()
        ? unwrapRemote(await remote.getCurrentBinding({ projectId: response.projectId, conversationId }))
        : { binding: null }
      const boundTaskId = current.binding?.taskId
      const nextTaskId = boundTaskId && response.tasks.some(task => task.taskId === boundTaskId)
        ? boundTaskId
        : ''
      setSelectedTaskId(nextTaskId)
      dispatchClient({ type: 'task.selected', taskId: nextTaskId })
      setSessionLoaded(true)
      setResult(draftRestoreFailed
        ? `已读取 ${response.tasks.length} 个任务，但有本机草稿无法读取；请检查存储后再继续。`
        : `已读取 ${response.tasks.length} 个任务；修订 ${response.revision}${boundTaskId ? '；已恢复当前对话任务' : ''}`)
    } catch (error) { setResult(`读取任务失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(false) }
  }

  async function createTask() {
    if (!cwd.trim() || !conversationId.trim() || !input.trim()) return setResult('请先填写项目目录、对话标识和任务内容。')
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.createTask({ cwd, conversationId, entryType, domain, originalInput: input, eventId: globalThis.crypto.randomUUID() }))
      setProjectId(response.task.projectId)
      setCwdLoaded(true)
      setSessionLoaded(true)
      setTasks(current => [response.task, ...current])
      setSelectedTaskId(response.task.taskId)
      dispatchClient({ type: 'task.selected', taskId: response.task.taskId })
      setResult(`任务已保存：${response.task.title}`)
    } catch (error) { setResult(`创建任务失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(false) }
  }

  async function selectTask(taskId: string) {
    setSelectedTaskId(taskId)
    setDeleteImpact(null)
    const taskForTitle = tasks.find(task => task.taskId === taskId)
    dispatchClient({ type: 'task.selected', taskId })
    if (!taskId || !projectId || !conversationId) return
    const selected = tasks.find(task => task.taskId === taskId)
    if (!selected) return
    try { unwrapRemote(await remote.bindTask({ projectId, taskId, conversationId, eventId: globalThis.crypto.randomUUID() })) } catch (error) { setResult(`切换任务失败：${error instanceof Error ? error.message : String(error)}`) }
  }

  async function saveTaskTitle() {
    if (!selectedTask || !conversationId.trim() || !renameDraft.trim()) return
    dispatchClient({ type: 'save.started', taskId: selectedTask.taskId })
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.updateTask({ projectId: selectedTask.projectId, taskId: selectedTask.taskId, taskRevision: selectedTask.revision, conversationId, patch: { title: renameDraft.trim() }, eventId: globalThis.crypto.randomUUID() }))
      setTasks(current => current.map(task => task.taskId === response.task.taskId ? response.task : task))
      dispatchClient({ type: 'save.succeeded', taskId: response.task.taskId })
      const draftCleared = persistTaskDraft(response.task.taskId, { title: '' })
      setResult(draftCleared ? '任务名称已保存。' : '任务名称已保存，但本机草稿未能清理。')
    } catch (error) {
      const draft = renameDraft
      if ((error as any)?.code === 'conflict') {
        try {
          const latest = unwrapRemote(await remote.listTasks({ cwd }))
          const serverVersion = latest.tasks.find(task => task.taskId === selectedTask.taskId) ?? null
          if (serverVersion) setTasks(current => current.map(task => task.taskId === serverVersion.taskId ? serverVersion : task))
          dispatchClient({ type: 'conflict', taskId: selectedTask.taskId, localDraft: draft, serverVersion })
          setResult('任务版本已变化；本地草稿和服务器版本都已保留，请比较后再保存。')
        } catch {
          dispatchClient({ type: 'save.failed', taskId: selectedTask.taskId, draft })
          setResult('无法读取最新任务版本；本地草稿仍保留。')
        }
      } else {
        dispatchClient({ type: 'save.failed', taskId: selectedTask.taskId, draft })
        setResult('重命名失败，草稿仍保留：' + (error instanceof Error ? error.message : String(error)))
      }
    }
    finally { setBusy(false) }
  }

  async function toggleArchive() {
    if (!selectedTask || !conversationId.trim()) return
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.archiveTask({ projectId: selectedTask.projectId, taskId: selectedTask.taskId, taskRevision: selectedTask.revision, conversationId, archived: !selectedTask.archived, eventId: globalThis.crypto.randomUUID() }))
      setTasks(current => current.filter(task => task.taskId !== selectedTask.taskId))
      setSelectedTaskId('')
      setResult(response.task.archived ? '任务已归档。' : '任务已恢复。')
    } catch (error) { setResult(`归档状态更新失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function requestDeletePreview() {
    if (!selectedTask || !conversationId.trim()) return
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.previewDeleteTask({ projectId: selectedTask.projectId, taskId: selectedTask.taskId, taskRevision: selectedTask.revision, conversationId }))
      setDeleteImpact(response.impact)
    } catch (error) { setResult(`读取删除影响失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function confirmDeleteTask() {
    if (!selectedTask || !conversationId.trim()) return
    setBusy(true)
    try {
      unwrapRemote(await remote.deleteTask({ projectId: selectedTask.projectId, taskId: selectedTask.taskId, taskRevision: selectedTask.revision, conversationId, confirmed: true, eventId: globalThis.crypto.randomUUID() }))
      setTasks(current => current.filter(task => task.taskId !== selectedTask.taskId))
      setSelectedTaskId('')
      dispatchClient({ type: 'task.deleted', taskId: selectedTask.taskId })
      let draftCleanupFailed = false
      try {
        deleteTaskDraft(window.localStorage, selectedTask.projectId, selectedTask.taskId)
        setDraftStorageStatusByTask(current => { const next = { ...current }; delete next[selectedTask.taskId]; return next })
      } catch {
        draftCleanupFailed = true
      }
      setDeleteImpact(null)
      setResult(draftCleanupFailed ? '任务已删除，但本机草稿未能清理。' : '任务已删除。')
    } catch (error) { setResult(`删除失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }
  async function loadProviders() {
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.listProviders())
      setProviders(response.providers)
      setResult('已读取 ' + response.providers.length + ' 个模型提供方。')
    } catch (error) {
      setResult('读取模型提供方失败：' + (error instanceof Error ? error.message : String(error)))
    } finally { setBusy(false) }
  }

  async function chooseProvider(value: string) {
    setProvider(value)
    setModel('')
    setModels([])
    if (!value) return
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.listModels({ provider: value }))
      setModels(response.models)
      setResult('已读取 ' + response.models.length + ' 个模型。')
    } catch (error) {
      setResult('读取模型失败：' + (error instanceof Error ? error.message : String(error)))
    } finally { setBusy(false) }
  }

  async function saveExternalResult() {
    if (!selectedTask || !conversationId.trim()) return setResult('请先选择当前任务和对话。')
    if (!externalPromptVersionId) return setResult('请先生成或选择一条提示词版本。')
    if (!externalDraft.content.trim()) return setResult('请粘贴外部 AI 返回的结果。')
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.saveExternalResult({
        projectId: selectedTask.projectId,
        taskId: selectedTask.taskId,
        taskRevision: selectedTask.revision,
        conversationId,
        stepId: externalStepId,
        promptVersionId: externalPromptVersionId,
        content: externalDraft.content,
        feedback: externalDraft.feedback,
        eventId: globalThis.crypto.randomUUID(),
      }))
      setTasks(current => current.map(task => task.taskId === response.task.taskId ? response.task : task))
      const emptyDraft = { content: '', feedback: '', stepId: '', promptVersionId: '' }
      setExternalDraftsByTask(current => ({ ...current, [selectedTask.taskId]: emptyDraft }))
      const draftCleared = persistTaskDraft(selectedTask.taskId, { externalResult: emptyDraft })
      setResult(draftCleared
        ? `外部结果已保存并关联提示词版本 ${response.version.promptVersionId}。`
        : `外部结果已保存，但本机草稿未能清理；关联提示词版本 ${response.version.promptVersionId}。`)
    } catch (error) {
      setResult(`外部结果保存失败，输入仍保留：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }
  async function runCurrentTask() {
    if (!selectedTask || !conversationId) return setResult('请先选择一个任务并填写当前对话标识。')
    if (!provider || !model) return setResult('请先明确选择模型提供方和模型。')
    const requestId = globalThis.crypto.randomUUID()
    const controller = new AbortController()
    setRunningRequest(requestId)
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.runTask({ taskId: selectedTask.taskId, taskRevision: selectedTask.revision, stage, requestId, projectId: selectedTask.projectId, conversationId, provider, model }, controller.signal))
      setTasks(current => current.map(task => task.taskId === response.task.taskId ? response.task : task))
      setResult(response.version?.content ?? '任务已完成。')
    } catch (error) { setResult(`运行失败：${error instanceof Error ? error.message : String(error)}`) } finally { setRunningRequest(''); setBusy(false) }
  }

  async function cancelCurrentTask() { if (!runningRequest) return; try { const result = unwrapRemote(await remote.cancelTask({ requestId: runningRequest })); setResult(result.cancelled ? '已请求取消当前任务。' : '当前任务已结束。') } catch (error) { setResult(`取消失败：${error instanceof Error ? error.message : String(error)}`) } }

  async function runStorageProbe(action: 'write' | 'read') {
    setBusy(true)
    try {
      const response = action === 'write'
        ? await remote.storageWrite({ marker: 'forward-step-probe' })
        : await remote.storageRead()
      setResult(`${action === 'write' ? '写入' : '读取'}结果：${JSON.stringify(response)}`)
    } catch (error) {
      setResult(`存储探针失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function runRealModelIsolationProbe() {
    if (!provider || !model) return setResult('请先选择真实模型提供方和模型。')
    setBusy(true)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('真实模型隔离探针超时')), 120000)
    try {
      const response = unwrapRemote(await remote.realModelIsolation({ provider, model }, controller.signal))
      setResult('真实模型消息隔离结果：' + JSON.stringify(response))
    } catch (error) {
      setResult(`真实模型隔离探针失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timer)
      setBusy(false)
    }
  }

  async function runAgentIsolationProbe() {
    setBusy(true)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('Agent / Session probe timed out')), 45000)
    try {
      const response = await remote.agentIsolation(controller.signal)
      setResult(`Agent / Session 隔离结果：${JSON.stringify(response)}`)
    } catch (error) {
      setResult(`Agent / Session 隔离探针失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timer)
      setBusy(false)
    }
  }

  async function runProbe() {
    setBusy(true)
    try {
      const response = await remote.echo({ marker: 'dsh-sidebar-probe' })
      setResult(JSON.stringify(response))
    } catch (error) {
      setResult(`调用失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return h('main', {
    style: {
      height: '100%',
      overflow: 'auto',
      padding: '24px',
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-background-primary)',
      fontFamily: 'inherit',
    },
  },
  h('style', null, 'main { box-sizing: border-box; max-width: 100%; } main, main * { box-sizing: border-box; } main label { display: grid; gap: 5px; min-width: 0; } main input, main select, main textarea { width: 100%; max-width: 100%; min-width: 0; } main textarea { resize: vertical; } main > label, main > section > label { width: 100%; margin: 8px 0; } main > div { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; margin: 8px 0; } main > div > label { flex: 1 1 200px; } main > section { display: grid; gap: 8px; min-width: 0; margin: 16px 0; } main button { max-width: 100%; white-space: normal; } main pre { max-width: 100%; overflow-wrap: anywhere; } @media (max-width: 480px) { main { padding: 16px !important; } main > div > label { flex-basis: 100%; } }'),
  h('h1', { style: { margin: '0 0 12px', fontSize: '20px' } }, '向前一步'),
  h('p', { style: { margin: '0 0 8px' } }, 'DSH 原生侧栏任务工作区'),
  h('p', { style: { margin: '0 0 16px', color: 'var(--dsw-alias-label-secondary)' } }, '任务独立保存，切换对话和重启后可继续。首版生成规划与外部 AI 执行提示词。'),
  h('label', null, '项目目录 ', h('input', { value: cwd, placeholder: '例如 D:/work/project', onChange: (event: any) => { setCwd(event.target.value); setCwdLoaded(false); setSessionLoaded(false); setSelectedTaskId('') } })),
  h('label', null, '当前对话标识 ', h('input', { value: conversationId, placeholder: '粘贴当前 DSH 对话 ID', onChange: (event: any) => { setConversationId(event.target.value); setSessionLoaded(false); setSelectedTaskId('') } })),
  h('div', null,
    h('label', null, '入口 ', h('select', { value: entryType, onChange: (event: any) => setEntryType(event.target.value) }, ...[['advance-idea','推进想法'],['optimize-prompt','优化提示词'],['diagnose-ai-result','诊断 AI 结果']].map(([value,label]) => h('option', { key: value, value }, label)))),
    h('label', null, '领域 ', h('select', { value: domain, onChange: (event: any) => setDomain(event.target.value) }, ...[['general','通用'],['writing','写作'],['ppt','PPT']].map(([value,label]) => h('option', { key: value, value }, label)))),
  ),  h('div', null, h('button', { type: 'button', disabled: busy || !cwd.trim() || !conversationId.trim(), onClick: loadTasks }, '读取项目任务'), h('button', { type: 'button', disabled: busy || !cwd.trim() || !conversationId.trim() || !input.trim(), onClick: createTask }, '创建任务')),
  h('button', { type: 'button', disabled: busy || !cwd.trim(), onClick: () => { setShowArchived(value => !value); setSelectedTaskId(''); setTasks([]) } }, showArchived ? '查看未归档任务' : '查看归档任务'),  h('label', null, '任务 ', h('select', { value: selectedTaskId, onChange: (event: any) => void selectTask(event.target.value) }, h('option', { value: '' }, '选择任务'), ...tasks.map(task => h('option', { key: task.taskId, value: task.taskId }, `${task.title} · ${task.domain}`)))),
  selectedTask ? h('section', null,
    h('label', null, '任务名称 ', h('input', { value: renameDraft, onChange: (event: any) => { dispatchClient({ type: 'draft.changed', taskId: selectedTask.taskId, draft: event.target.value }); persistTaskDraft(selectedTask.taskId, { title: event.target.value }) } })),
    h('button', { type: 'button', disabled: busy || !renameDraft.trim() || renameDraft.trim() === selectedTask.title, onClick: saveTaskTitle }, '保存名称'),
    clientState.saveStatusByTask[selectedTask.taskId] === 'unsaved' ? h('small', { role: 'status' }, draftStorageStatusByTask[selectedTask.taskId] === 'saved' ? '名称草稿已保存在本机，尚未同步到任务' : '名称草稿尚未保存') : clientState.saveStatusByTask[selectedTask.taskId] === 'conflict' ? h('small', { role: 'alert' }, '任务版本已冲突；本地草稿仍保留') : null,
    h('button', { type: 'button', disabled: busy, onClick: toggleArchive }, selectedTask.archived ? '恢复任务' : '归档任务'),
    deleteImpact ? h('div', { role: 'alert' }, h('p', null, `确认删除“${deleteImpact.title}”？将移除 ${deleteImpact.bindingCount} 个绑定、${deleteImpact.versionCount} 个版本、${deleteImpact.reviewCount} 条复盘记录和 ${deleteImpact.sourceCount} 个来源。`), h('button', { type: 'button', disabled: busy, onClick: confirmDeleteTask }, '确认删除'), h('button', { type: 'button', disabled: busy, onClick: () => setDeleteImpact(null) }, '取消')) : h('button', { type: 'button', disabled: busy, onClick: requestDeletePreview }, '删除任务…'),
  ) : null,  h('label', null, '新任务内容 ', h('textarea', { value: input, rows: 4, onChange: (event: any) => setInput(event.target.value), placeholder: '描述想法、提示词或待诊断结果' })),
  h('div', null, h('button', { type: 'button', disabled: busy || !cwdLoaded, onClick: loadProviders }, '读取模型提供方'), h('select', { 'aria-label': '模型提供方', value: provider, onChange: (event: any) => void chooseProvider(event.target.value) }, h('option', { value: '' }, '选择提供方'), ...providers.map(item => h('option', { key: item.id, value: item.id }, item.name))), h('select', { 'aria-label': '模型', value: model, disabled: !provider || busy, onChange: (event: any) => setModel(event.target.value) }, h('option', { value: '' }, '选择模型'), ...models.map(item => h('option', { key: item.id, value: item.id }, item.name)))),
  h('label', null, 'Agent 阶段 ', h('select', { value: stage, onChange: (event: any) => setStage(event.target.value) }, ...['clarification','diagnosis','planning','step-prompt','review'].map(value => h('option', { key: value, value }, value)))),
  h('div', null, h('button', { type: 'button', disabled: busy || !cwdLoaded || !sessionLoaded || !conversationId.trim() || !selectedTask, onClick: runCurrentTask }, busy ? '正在运行…' : '运行当前阶段'), h('button', { type: 'button', disabled: !runningRequest, onClick: cancelCurrentTask }, '取消运行')),
  selectedTask ? h('section', null, h('h2', null, selectedTask.title),
    h('p', null, `进度修订 ${selectedTask.revision} · ${selectedTask.versions.length} 个版本`),
    h('section', { 'aria-label': '外部结果回填' },
      h('h3', null, '外部结果回填'),
      h('label', null, '关联步骤 ', h('select', { 'aria-label': '关联步骤', value: externalStepId, onChange: (event: any) => updateExternalDraft(selectedTask, { ...externalDraft, stepId: event.target.value }) }, ...externalSteps.map(step => h('option', { key: step.id, value: step.id }, step.title || step.id)))),
      h('label', null, '对应提示词版本 ', h('select', { 'aria-label': '对应提示词版本', value: externalPromptVersionId, disabled: promptVersions.length === 0 || busy, onChange: (event: any) => updateExternalDraft(selectedTask, { ...externalDraft, promptVersionId: event.target.value }) }, ...promptVersions.map(version => h('option', { key: version.versionId, value: version.versionId }, `${version.stage} · ${version.versionId.slice(0, 8)}`)))),
      promptVersions.length ? null : h('small', null, '请先运行一个阶段生成可关联的提示词版本。'),
      h('label', null, '外部 AI 结果 ', h('textarea', { 'aria-label': '外部 AI 结果', value: externalDraft.content, rows: 5, onChange: (event: any) => updateExternalDraft(selectedTask, { ...externalDraft, content: event.target.value }) })),
      h('label', null, '复盘反馈 ', h('textarea', { 'aria-label': '复盘反馈', value: externalDraft.feedback, rows: 2, onChange: (event: any) => updateExternalDraft(selectedTask, { ...externalDraft, feedback: event.target.value }) })),
      draftStorageStatusByTask[selectedTask.taskId] === 'saved' ? h('small', { role: 'status' }, '未提交输入已保存在本机') : draftStorageStatusByTask[selectedTask.taskId] === 'error' ? h('small', { role: 'alert' }, '本机草稿保存失败；当前输入仍保留在面板') : null,
      h('button', { type: 'button', disabled: busy || !externalDraft.content.trim() || !externalPromptVersionId, onClick: saveExternalResult }, '保存外部结果')),
    ...selectedTask.versions.map(version => h('details', { key: version.versionId }, h('summary', null, `${version.kind === 'external-result' ? '外部结果' : version.stage} · ${new Date(version.createdAt).toLocaleString()}${version.promptVersionId ? ` · 关联 ${version.promptVersionId.slice(0, 8)}` : ''}`), h('pre', { style: { whiteSpace: 'pre-wrap' } }, version.content)))) : null,
  h('button', { type: 'button', disabled: busy || !cwdLoaded, onClick: runAgentIsolationProbe }, '验证 Agent / Session 消息隔离（测试适配器）'),
  h('button', { type: 'button', disabled: busy || !cwdLoaded || !provider || !model, onClick: runRealModelIsolationProbe }, '验证真实模型 A/B 消息隔离'),
  h('button', { type: 'button', disabled: busy || !cwdLoaded, onClick: runProbe }, busy ? '正在调用 Host…' : '验证 Host / Client RPC'),
  h('button', { type: 'button', disabled: busy || !cwdLoaded, onClick: () => runStorageProbe('write') }, '写入持久化探针'),
  h('button', { type: 'button', disabled: busy || !cwdLoaded, onClick: () => runStorageProbe('read') }, '读取持久化探针'),
  h('button', { type: 'button', disabled: busy || !cwdLoaded, onClick: async () => {
    setBusy(true)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('browser cancellation probe')), 60)
    try {
      const response = await remote.wait({ marker: 'dsh-cancel-probe', milliseconds: 5000 }, controller.signal)
      setResult(response.ok ? '取消探针未取消' : '取消结果：' + response.error.code)
    } catch (error) {
      setResult('取消异常：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      clearTimeout(timer)
      setBusy(false)
    }
  } }, '验证 Host / Client 取消'),
  h('pre', { 'data-testid': 'forward-step-rpc-result', style: { whiteSpace: 'pre-wrap', marginTop: '12px' } }, result))
}

function PanelIcon({ size = 18, active = false }) {
  return h('span', {
    'aria-hidden': true,
    style: {
      display: 'inline-flex',
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 5,
      fontSize: Math.max(12, size - 4),
      fontWeight: 700,
      color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
    },
  }, '向')
}

export const inject = ['slots', 'remote']

export async function apply(ctx: any) {
  const unmountRemote = await ctx.remote.$mount(forwardStepRemote)
  ctx.effect(() => async () => { await unmountRemote() }, 'forward-step: remote contribution')

  await ctx.inject(['remote.forwardStepProbe'], (remoteCtx: any) => {
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelId }, () => h(Panel, { remote: remoteCtx.remote.forwardStepProbe })))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: panelId,
      order: 80,
      label: '向前一步',
    }, PanelIcon))
  })
}
