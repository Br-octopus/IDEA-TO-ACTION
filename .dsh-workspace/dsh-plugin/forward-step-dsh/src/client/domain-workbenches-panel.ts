import * as React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

type AcademicProject = { id: string; title: string; workspaceKind: 'review' | 'publishing'; question?: string; scope?: string; reviewType?: string; screeningModel?: 'single-reviewer' | 'two-reviewers'; records?: any[]; extractionFields?: any[]; target?: { venue?: string; manuscriptVersion?: string }; requirements?: any[]; checklist?: any[]; citationClaims?: any[]; reviewerRounds?: any[]; promptRounds?: any[] }
type AcademicLiterature = { id: string; title: string; type: string; keywords?: string[]; literature?: { authors?: string[]; year?: string; doi?: string; abstractExcerpt?: string; importedFields?: Record<string, string[]> } }
type SocialResult = { id: string; platform: string; title: string; sourceUrl: string; excerpt: string; knowledgeEntryIds?: string[]; attachmentIds?: string[]; trust: 'untrusted' }
type SocialTask = { id: string; topic: string; platforms: string[]; capabilities?: { platform: string; status: string; verified: boolean }[]; queries: string[]; status: string; results?: SocialResult[]; attachments?: { id: string; name: string; mimeType: string; bytes: number; sha256: string; trust: 'untrusted' }[]; recoveryAttachments?: { id: string; name: string; status: string; bytes: number }[]; platformResults?: { platform: string; status: string; errorCode?: string; results?: unknown[] }[]; publicSearchRuns?: { id: string; platform: string; query: string; status: string; errorCode?: string; truncated?: boolean; candidates: { id: string; platform: string; title: string; sourceUrl: string; excerpt: string; trust: 'untrusted' }[] }[]; reportRuns?: { id: string; resultIds: string[]; status: string; createdAt: string; prompt: string; report?: string }[]; budget?: { maxQueriesPerPlatform: number; maxPlatforms: number; maxSourceRequests?: number; maxResultsPerQuery?: number }; usage?: { sourceRequests?: number } }
type SocialPlatformRunReceipt = { id: string; platform: string; status: string; queryCount: number; resultCount: number; errorCode?: string; retryOf?: string; updatedAt: string }
function renderSocialPlatformRunReceipts(task: SocialTask) {
  const receipts = (task as SocialTask & { platformRunReceipts?: SocialPlatformRunReceipt[] }).platformRunReceipts
  if (!receipts?.length) return null
  const labels: Record<string, string> = { running: '进行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' }
  return React.createElement('section', { 'data-testid': `social-platform-run-receipts-${task.id}`, 'aria-label': '平台采集运行收据' },
    React.createElement('h4', null, '最近的平台采集收据'),
    ...receipts.slice(-5).map(receipt => React.createElement('p', { key: receipt.id }, `${receipt.platform} · ${labels[receipt.status] ?? receipt.status}${receipt.retryOf ? ` · 重试自 ${receipt.retryOf.slice(0, 8)}` : ''} · ${receipt.queryCount} 个查询 · ${receipt.resultCount} 条结果${receipt.errorCode ? ` · ${receipt.errorCode}` : ''} · ${receipt.updatedAt}`)))
}
type SocialPlatformAvailability = { platform: string; canRun: boolean; profileConfigured?: boolean; reason?: string }
type SocialKnowledgeEntry = { id: string; title: string; sourceUrl?: string; summary?: string; contentExcerpt?: string }
export type DomainWorkbenchesRemote = {
  listAcademicWorkspaces(): Promise<RemoteResult<{ projects: AcademicProject[]; literature: AcademicLiterature[]; revision: number }>>
  createAcademicWorkspace(input: { kind: 'review' | 'publishing'; title: string; question?: string; scope?: string; reviewType?: string; screeningModel?: 'single-reviewer' | 'two-reviewers'; venue?: string }): Promise<RemoteResult<{ project: AcademicProject; revision: number }>>
  saveAcademicWorkspace(input: { project: AcademicProject }): Promise<RemoteResult<{ project: AcademicProject; revision: number }>>
  previewAcademicBibliography(input: { text: string; format: string }): Promise<RemoteResult<{ preview: any; revision: number }>>
  importAcademicBibliography(input: { entries: any[] }): Promise<RemoteResult<{ entries: AcademicLiterature[]; duplicates: any[]; revision: number }>>
  applyAcademicWorkspaceAction(input: { projectId: string; action: string; args: any[] }): Promise<RemoteResult<{ project: AcademicProject; revision: number }>>
  buildAcademicPrompt(input: { projectId: string; kind: string; ids: string[] }): Promise<RemoteResult<{ prompt: string }>>
  listSocialResearchTasks(): Promise<RemoteResult<{ tasks: SocialTask[]; revision: number }>>
  listSocialPlatformAvailability(): Promise<RemoteResult<{ platforms: SocialPlatformAvailability[] }>>
  runAuthorizedSocialResearch(input: { taskId: string; confirmed: boolean; platforms?: string[] }, signal?: AbortSignal): Promise<RemoteResult<{ task: SocialTask; revision: number }>>
  beginSocialResearchAttachmentDownload(input: { taskId: string; attachmentId: string }): Promise<RemoteResult<{ downloadId: string; chunkBytes: number; attachment: { id: string; name: string; mimeType: string; bytes: number } }>>
  removeSocialResearchAttachment(input: { taskId: string; attachmentId: string }): Promise<RemoteResult<{ task: SocialTask; attachment: { id: string; name: string; bytes: number }; storageObjectRetained: true; revision: number }>>
  removeSocialResearchResult(input: { taskId: string; resultId: string }): Promise<RemoteResult<{ task: SocialTask; removedAttachmentCount: number; storageObjectsRetained: boolean; revision: number }>>
  readSocialResearchAttachmentChunk(input: { downloadId: string; taskId: string; offset: number }, signal?: AbortSignal): Promise<RemoteResult<{ offset: number; nextOffset: number; totalBytes: number; dataBase64: string; done: boolean }>>
  finishSocialResearchAttachmentDownload(input: { downloadId: string }): Promise<RemoteResult<{ finished: boolean }>>
  createSocialResearchPlan(input: { topic: string; platforms: string[]; queries: string[]; budget: { maxPlatforms: number; maxQueriesPerPlatform: number; maxSourceRequests: number } }): Promise<RemoteResult<{ task: SocialTask; revision: number }>>
  confirmSocialResearchPlan(input: { taskId: string }): Promise<RemoteResult<{ task: SocialTask; revision: number }>>
  rejectSocialResearchPlan(input: { taskId: string; reason?: string }): Promise<RemoteResult<{ task: SocialTask; revision: number }>>
  searchSocialPublicSources(input: { taskId: string; platform: string; query: string; confirmed: boolean }, signal?: AbortSignal): Promise<RemoteResult<{ task: SocialTask; run: NonNullable<SocialTask['publicSearchRuns']>[number]; revision: number; sourceMode: 'public-web-search' }>>
  searchConfirmedSocialPublicPlan(input: { taskId: string; confirmed: boolean }, signal?: AbortSignal): Promise<RemoteResult<{ task: SocialTask; runs: NonNullable<SocialTask['publicSearchRuns']>; truncated: boolean; revision: number; sourceMode: 'public-web-search' }>>
  fetchSocialPublicSource(input: { taskId: string; platform: string; sourceUrl: string; confirmed: boolean }, signal?: AbortSignal): Promise<RemoteResult<{ candidateId: string; platform: string; title: string; sourceUrl: string; excerpt: string; trust: 'untrusted'; selected: false }>>
  applySocialResearchTaskAction(input: { taskId: string; action: 'pause' | 'resume' | 'cancel' | 'skip-platform'; platform?: string }): Promise<RemoteResult<{ task: SocialTask; revision: number }>>
  listKnowledgeEntries(input: { filters?: Record<string, unknown> }): Promise<RemoteResult<{ entries: SocialKnowledgeEntry[] }>>
  saveSocialResearchResult(input: { taskId: string; result: { platform: string; title: string; sourceUrl: string; excerpt: string; knowledgeEntryIds: string[] } }): Promise<RemoteResult<{ task: SocialTask; revision: number }>>
  beginSocialAttachmentUpload(input: { taskId: string; resultId: string; name: string; mimeType: string; size: number }): Promise<RemoteResult<{ uploadId: string; chunkBytes: number }>>
  appendSocialAttachmentChunk(input: { uploadId: string; index: number; dataBase64: string }): Promise<RemoteResult<{ nextChunk: number; bytes: number }>>
  commitSocialAttachmentUpload(input: { uploadId: string }): Promise<RemoteResult<{ task: SocialTask; attachment: { id: string; name: string; status: string } }>>
  cancelSocialAttachmentUpload(input: { uploadId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
  buildSocialResearchReportPrompt(input: { taskId: string; resultIds: string[] }): Promise<RemoteResult<{ prompt: string; selectedResultCount: number; task: SocialTask; reportRun: { id: string; resultIds: string[]; status: string; createdAt: string } }>>
  generateSocialResearchReport(input: { taskId: string; resultIds: string[]; provider: string; model: string }, signal?: AbortSignal): Promise<RemoteResult<{ task: SocialTask; reportRun: { id: string; resultIds: string[]; prompt: string; report: string; status: string; createdAt: string } }>>
  saveSocialResearchReportPrompt(input: { taskId: string; parentRunId: string; prompt: string }): Promise<RemoteResult<{ task: SocialTask; reportRun: { id: string; parentRunId: string; resultIds: string[]; prompt: string; status: string; createdAt: string } }>>
}

const { createElement: h, useEffect, useRef, useState } = React
const platforms = [['xiaohongshu', '小红书'], ['bilibili', '哔哩哔哩'], ['weibo', '微博'], ['zhihu', '知乎']]

function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

export function DomainWorkbenchesPanel({ remote, provider, model }: { remote: DomainWorkbenchesRemote; provider: string; model: string }) {
  const activeSocialSearch = useRef<{ taskId: string; controller: AbortController; done: Promise<void>; operation: 'public-plan-search' | 'authorized-platform-collection' | 'public-search' } | null>(null)
  const activeSocialReport = useRef<{ taskId: string; controller: AbortController } | null>(null)
  const activeSocialDownload = useRef<{ taskId: string; controller: AbortController } | null>(null)
  const activeSocialTaskActions = useRef(new Set<string>())
  const [activeSocialReportTaskId, setActiveSocialReportTaskId] = useState('')
  const [activeSocialSearchTaskId, setActiveSocialSearchTaskId] = useState('')
  const [activeSocialDownloadTaskId, setActiveSocialDownloadTaskId] = useState('')
  const [projects, setProjects] = useState<AcademicProject[]>([])
  const [literature, setLiterature] = useState<AcademicLiterature[]>([])
  const [editingProjectId, setEditingProjectId] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedLiteratureId, setSelectedLiteratureId] = useState('')
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const [selectedRoundId, setSelectedRoundId] = useState('')
  const [tasks, setTasks] = useState<SocialTask[]>([])
  const [socialAvailability, setSocialAvailability] = useState<SocialPlatformAvailability[]>([])
  const [knowledgeEntries, setKnowledgeEntries] = useState<SocialKnowledgeEntry[]>([])
  const [selectedSocialTaskId, setSelectedSocialTaskId] = useState('')
  const [socialCandidatePreview, setSocialCandidatePreview] = useState<{ taskId: string; candidateId: string; platform: string; title: string; sourceUrl: string; excerpt: string } | null>(null)
  const [socialPlatform, setSocialPlatform] = useState('')
  const [socialResultTitle, setSocialResultTitle] = useState('')
  const [socialResultUrl, setSocialResultUrl] = useState('')
  const [socialResultExcerpt, setSocialResultExcerpt] = useState('')
  const [socialAttachment, setSocialAttachment] = useState<File | null>(null)
  const [selectedSocialKnowledgeIds, setSelectedSocialKnowledgeIds] = useState<string[]>([])
  const [selectedSocialResultIds, setSelectedSocialResultIds] = useState<string[]>([])
  const [socialReportPrompt, setSocialReportPrompt] = useState('')
  const [savedSocialReportPrompt, setSavedSocialReportPrompt] = useState('')
  const [socialReportOutput, setSocialReportOutput] = useState('')
  const [selectedSocialReportRunId, setSelectedSocialReportRunId] = useState('')
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [scope, setScope] = useState('')
  const [venue, setVenue] = useState('')
  const [bibliographyText, setBibliographyText] = useState('')
  const [bibliographyFormat, setBibliographyFormat] = useState('ris')
  const [bibliographyPreview, setBibliographyPreview] = useState<any>(null)
  const [academicAction, setAcademicAction] = useState('include')
  const [reviewer, setReviewer] = useState('reviewerOne')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [location, setLocation] = useState('')
  const [fullTextConfirmed, setFullTextConfirmed] = useState(false)
  const [fieldId, setFieldId] = useState('finding')
  const [fieldLabel, setFieldLabel] = useState('主要发现')
  const [extractedValue, setExtractedValue] = useState('')
  const [claimText, setClaimText] = useState('')
  const [roundTitle, setRoundTitle] = useState('第一轮审稿')
  const [reviewerComment, setReviewerComment] = useState('')
  const [responseDraft, setResponseDraft] = useState('')
  const [changeSummary, setChangeSummary] = useState('')
  const [changeLocation, setChangeLocation] = useState('')
  const [requirementTitle, setRequirementTitle] = useState('')
  const [requirementBody, setRequirementBody] = useState('')
  const [checklistTitle, setChecklistTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<'review' | 'publishing'>('review')
  const [reviewType, setReviewType] = useState('narrative-review')
  const [screeningModel, setScreeningModel] = useState('single-reviewer')
  const [topic, setTopic] = useState('')
  const [queries, setQueries] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [socialMaxPlatforms, setSocialMaxPlatforms] = useState(4)
  const [socialMaxQueries, setSocialMaxQueries] = useState(3)
  const [socialMaxRequests, setSocialMaxRequests] = useState(100)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('学术项目和社媒研究计划独立保存在插件数据中。')
  useEffect(() => () => { activeSocialSearch.current?.controller.abort(); activeSocialReport.current?.controller.abort(); activeSocialDownload.current?.controller.abort() }, [])
  const selectedProject = projects.find(project => project.id === selectedProjectId) ?? projects[0]
  const selectedReviewRecord = selectedProject?.records?.find(record => record.id === selectedRecordId)
  const extractionConfirmationControls = selectedReviewRecord
    ? (selectedProject?.extractionFields ?? []).flatMap(field => {
      const extraction = selectedReviewRecord.extraction?.[field.id]
      if (!extraction) return []
      return [h('div', { key: `extraction-${field.id}` },
        h('span', null, `${field.label}：${extraction.value} · ${extraction.confirmed ? '已核对' : '待核对'}`),
        !extraction.confirmed ? h('button', {
          type: 'button',
          disabled: busy || !extraction.value || !extraction.evidence || !extraction.sourceLocation,
          onClick: () => void applyAction('confirmExtractionValue', [selectedReviewRecord.id, field.id]),
        }, `确认“${field.label}”提取`) : null)]
    })
    : []

  async function refreshAcademic() {
    const result = unwrap(await remote.listAcademicWorkspaces())
    setProjects(result.projects)
    setLiterature(result.literature ?? [])
    if (!selectedProjectId && result.projects[0]) setSelectedProjectId(result.projects[0].id)
    return result
  }

  async function applyAction(action: string, args: any[]) {
    if (!selectedProject) return
    setBusy(true)
    try {
      const result = unwrap(await remote.applyAcademicWorkspaceAction({ projectId: selectedProject.id, action, args }))
      setProjects(current => current.map(project => project.id === result.project.id ? result.project : project))
      setMessage(`已保存学术操作：${action}`)
    } catch (error) {
      setMessage(`学术操作失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function previewBibliography() {
    setBusy(true)
    try {
      const result = unwrap(await remote.previewAcademicBibliography({ text: bibliographyText, format: bibliographyFormat }))
      setBibliographyPreview(result.preview)
      setMessage(`预览完成：${result.preview.entries.length} 条可导入，${result.preview.duplicates.length} 条重复，${result.preview.errors.length} 条格式错误。未知字段将随所选条目保留。`)
    } catch (error) { setMessage(`题录预览失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function importSelectedBibliography() {
    const selected = bibliographyPreview?.entries?.filter((entry: any) => entry.selected !== false) ?? []
    if (!selected.length) { setMessage('请至少保留一条有效题录再导入。'); return }
    setBusy(true)
    try {
      const result = unwrap(await remote.importAcademicBibliography({ entries: selected }))
      const refreshed = unwrap(await remote.listAcademicWorkspaces())
      setLiterature(refreshed.literature ?? [])
      setBibliographyPreview(null)
      setMessage(`已导入 ${result.entries.length} 条；重复 ${result.duplicates.length} 条。`)
    } catch (error) { setMessage(`题录导入失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function makePrompt(kind: string, ids: string[]) {
    if (!selectedProject) return
    setBusy(true)
    try {
      const result = unwrap(await remote.buildAcademicPrompt({ projectId: selectedProject.id, kind, ids }))
      setPrompt(result.prompt)
      unwrap(await remote.applyAcademicWorkspaceAction({ projectId: selectedProject.id, action: 'addPromptRound', args: [{ kind, selectedIds: ids, prompt: result.prompt }] }))
      const refreshed = unwrap(await remote.listAcademicWorkspaces())
      setProjects(refreshed.projects)
      setMessage('提示词已生成；请检查选择范围和外发内容后再复制。')
    } catch (error) { setMessage(`提示词生成失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function load() {
    setBusy(true)
    try {
      const [academic, social, knowledge, availability] = await Promise.all([remote.listAcademicWorkspaces(), remote.listSocialResearchTasks(), remote.listKnowledgeEntries({ filters: {} }), remote.listSocialPlatformAvailability()])
      setProjects(unwrap(academic).projects)
      setLiterature(unwrap(academic).literature ?? [])
      if (!selectedProjectId && unwrap(academic).projects[0]) setSelectedProjectId(unwrap(academic).projects[0].id)
      setTasks(unwrap(social).tasks)
      setSocialAvailability(unwrap(availability).platforms)
      setKnowledgeEntries(unwrap(knowledge).entries ?? [])
      setMessage(`已加载 ${unwrap(academic).projects.length} 个学术项目、${unwrap(social).tasks.length} 个社媒研究计划和 ${unwrap(knowledge).entries.length} 条可选资料。`)
    } catch (error) {
      setMessage(`读取工作区失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function refreshSocialAvailability() {
    setBusy(true)
    try {
      const availability = unwrap(await remote.listSocialPlatformAvailability())
      setSocialAvailability(availability.platforms)
      setMessage('已刷新 DSH Host 当前平台采集能力与授权状态。')
    } catch (error) {
      setMessage(`刷新平台状态失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function createAcademic() {
    setBusy(true)
    try {
      const existing = projects.find(project => project.id === editingProjectId)
      const result = existing
        ? unwrap(await remote.saveAcademicWorkspace({ project: existing.workspaceKind === 'review'
          ? { ...existing, title: title.trim(), question: question.trim(), scope: scope.trim() }
          : { ...existing, title: title.trim(), target: { ...existing.target, venue: venue.trim() } } }))
        : unwrap(await remote.createAcademicWorkspace({ kind, title: title.trim(), question: question.trim(), scope: scope.trim(), reviewType, screeningModel, venue: venue.trim() }))
      setProjects(current => [result.project, ...current.filter(item => item.id !== result.project.id)])
      setEditingProjectId('')
      setTitle('')
      setQuestion('')
      setScope('')
      setVenue('')
      setMessage(existing ? '学术项目已更新并保存。' : '学术项目已创建；可继续导入题录、记录证据和整理投稿回应。')
      setSelectedProjectId(result.project.id)
    } catch (error) {
      setMessage(`保存学术项目失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  function editAcademic(projectId: string) {
    const project = projects.find(item => item.id === projectId)
    if (!project) return
    setEditingProjectId(project.id)
    setKind(project.workspaceKind)
    setTitle(project.title)
    setQuestion(project.question ?? '')
    setScope(project.scope ?? '')
    setVenue(project.target?.venue ?? '')
    setReviewType(project.reviewType ?? 'narrative-review')
    setScreeningModel(project.screeningModel ?? 'single-reviewer')
  }

  async function createSocialPlan() {
    setBusy(true)
    try {
      const result = unwrap(await remote.createSocialResearchPlan({ topic: topic.trim(), platforms: selectedPlatforms, queries: queries.split(/\r?\n/u).map(value => value.trim()).filter(Boolean), budget: { maxPlatforms: socialMaxPlatforms, maxQueriesPerPlatform: socialMaxQueries, maxSourceRequests: socialMaxRequests } }))
      setTasks(current => [result.task, ...current.filter(item => item.id !== result.task.id)])
      setMessage('计划已保存并等待确认；此操作没有发起平台采集。')
    } catch (error) {
      setMessage(`创建研究计划失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function confirmPlan(taskId: string) {
    setBusy(true)
    try {
      const result = unwrap(await remote.confirmSocialResearchPlan({ taskId }))
      setTasks(current => current.map(item => item.id === taskId ? result.task : item))
      setMessage('研究计划已确认，状态为等待平台准备；平台登录状态会在运行前由 DSH Host 检查。')
    } catch (error) {
      setMessage(`确认计划失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function searchConfirmedSocialPlan(task: SocialTask) {
    if (activeSocialSearch.current) return
    const requestBudget = task.budget?.maxSourceRequests ?? 100
    const usedRequests = task.usage?.sourceRequests ?? 0
    const operationCount = task.platforms.length * task.queries.length
    if (typeof globalThis.confirm !== 'function' || !globalThis.confirm(`将按已确认计划执行 ${operationCount} 次公开网页搜索（${task.platforms.join('、')}；每平台 ${task.queries.length} 个查询）。不使用平台登录态或官方 API，候选均为不可信材料并需逐条核对；本任务搜索预算 ${usedRequests}/${requestBudget} 次。继续？`)) return
    const controller = new AbortController()
    let finishSearch!: () => void
    const done = new Promise<void>(resolve => { finishSearch = resolve })
    activeSocialSearch.current = { taskId: task.id, controller, done, operation: 'public-plan-search' }
    setActiveSocialSearchTaskId(task.id)
    setBusy(true)
    try {
      const result = unwrap(await remote.searchConfirmedSocialPublicPlan({ taskId: task.id, confirmed: true }, controller.signal))
      setTasks(current => current.map(item => item.id === task.id ? result.task : item))
      const completed = result.runs.filter(run => run.status === 'completed').length
      const failed = result.runs.length - completed
      const budgetNote = result.truncated ? `；已按剩余请求预算截断（${result.runs.length}/${operationCount} 次）` : ""
      const candidateCount = result.runs.reduce((sum, run) => sum + run.candidates.length, 0)
      setMessage(result.cancelled
        ? `计划公开搜索已取消：已保留 ${completed} 次成功、${failed} 次失败的检查点及 ${candidateCount} 条未选候选；未完成查询可再次运行。`
        : `计划公开搜索已完成：${completed} 次成功、${failed} 次失败，共 ${candidateCount} 条未选候选${budgetNote}；请逐条核对后保存。`)
    } catch (error) {
      setMessage(controller.signal.aborted || (error as any)?.code === 'cancelled'
        ? '计划公开搜索已取消；已完成并保存的查询检查点会保留，未完成查询可再次运行。'
        : `计划公开搜索失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (activeSocialSearch.current?.controller === controller) activeSocialSearch.current = null
      setActiveSocialSearchTaskId('')
      setBusy(false)
      finishSearch()
    }
  }
  async function runAuthorizedPlatform(task: SocialTask, platform: string) {
    if (activeSocialSearch.current) return
    const controller = new AbortController()
    let runRequested = false
    let finishSearch!: () => void
    const done = new Promise<void>(resolve => { finishSearch = resolve })
    activeSocialSearch.current = { taskId: task.id, controller, done, operation: 'authorized-platform-collection' }
    setActiveSocialSearchTaskId(task.id)
    setBusy(true)
    try {
      const latest = unwrap(await remote.listSocialPlatformAvailability())
      setSocialAvailability(latest.platforms)
      if (controller.signal.aborted) { setMessage('平台状态刷新期间采集已取消。'); return }
      const availability = latest.platforms.find(item => item.platform === platform)
      if (!availability?.canRun) {
        setMessage(availability?.reason ?? '当前 Host 未提供可运行的社媒采集能力。')
        return
      }
      const maxRequests = task.budget?.maxSourceRequests ?? 100
      const usedRequests = task.usage?.sourceRequests ?? 0
      if (usedRequests >= maxRequests) { setMessage(`来源请求预算已用尽（${usedRequests}/${maxRequests}），未发起平台采集。`); return }
      const querySummary = task.queries.map((query, index) => `${index + 1}. ${query}`).join('\n')
      const resultSummary = task.results?.map(item => item.title).filter(Boolean).join('；') || '无'
      const attachmentSummary = task.attachments?.map(item => item.name).filter(Boolean).join('；') || '无'
      const confirmation = `${availability.profileConfigured
        ? `将通过 DSH Browser 使用已配置的 ${platform} 登录 profile 尝试采集；profile 已配置不代表当前仍登录，运行时会检查。`
        : `将通过 DSH 已核验并授权的 ${platform} 适配器采集。`}\n以下查询将发送给该平台：\n${querySummary}\n预算：已用 ${usedRequests}/${maxRequests} 次来源请求；已有结果（本次不发送）：${resultSummary}；已归档附件（本次不发送）：${attachmentSummary}。是否继续？`
      if (typeof globalThis.confirm !== 'function' || !globalThis.confirm(confirmation)) return
      if (controller.signal.aborted) { setMessage('平台采集已取消；已完成并保存的结果会保留。'); return }
      runRequested = true
      const result = unwrap(await remote.runAuthorizedSocialResearch({ taskId: task.id, confirmed: true, platforms: [platform] }, controller.signal))
      setTasks(current => current.map(item => item.id === task.id ? result.task : item))
      const platformResult = result.task.platformResults?.find(item => item.platform === platform)
      const resultCount = platformResult?.results?.length ?? 0
      setMessage(platformResult?.status === 'failed'
        ? `${platform} 采集失败（${platformResult.errorCode ?? 'platform_failure'}）；请检查登录状态、验证码、限流或页面结构。`
        : resultCount
          ? `${platform} 采集完成，已保存 ${resultCount} 条结果；结果仍需人工核对。`
          : `${platform} 采集已运行，但没有返回结果；请检查 DSH Browser 当前登录状态、验证码或页面结构。`)
    } catch (error) {
      const message = controller.signal.aborted ? '平台采集已取消；已完成并保存的结果会保留。' : '平台采集失败：' + (error instanceof Error ? error.message : String(error))
      setMessage(message)
      if (runRequested) {
        try { setTasks(unwrap(await remote.listSocialResearchTasks()).tasks) }
        catch { setMessage(message + ' 平台运行收据刷新失败，请重新加载工作台。') }
      }
    } finally {
      if (activeSocialSearch.current?.controller === controller) activeSocialSearch.current = null
      setActiveSocialSearchTaskId('')
      setBusy(false)
      finishSearch()
    }
  }

  async function searchSocialSources(task: SocialTask, platform: string, query: string) {
    if (activeSocialSearch.current) return
    const budget = task.budget
    const usedRequests = task.usage?.sourceRequests ?? 0
    const maxRequests = budget?.maxSourceRequests ?? 100
    const usedQueries = new Set((task.publicSearchRuns ?? []).filter(run => run.platform === platform).map(run => run.query)).size
    const maxQueries = budget?.maxQueriesPerPlatform ?? 3
    const prompt = `将通过 DSH 网页搜索查询公开网页，不使用 ${platform} 登录态或官方 API。\n平台：${platform}\n查询：site-specific 公开搜索 + ${query}\n预算：此平台已用 ${usedQueries}/${maxQueries} 个不同查询；搜索结果最多 ${budget?.maxResultsPerQuery ?? 20} 条；全任务已用 ${usedRequests}/${maxRequests} 次请求，剩余 ${Math.max(0, maxRequests - usedRequests)} 次。\n材料：本次只发送上述搜索查询，不发送已保存的 ${task.results?.length ?? 0} 条结果或 ${task.attachments?.length ?? 0} 个附件。候选会保持未选，只有用户核对并手动加入后才保存。\n是否继续？`
    if (typeof globalThis.confirm !== 'function' || !globalThis.confirm(prompt)) return
    const controller = new AbortController()
    let finishSearch!: () => void
    const done = new Promise<void>(resolve => { finishSearch = resolve })
    activeSocialSearch.current = { taskId: task.id, controller, done, finish: finishSearch, operation: 'public-search' }
    setActiveSocialSearchTaskId(task.id)
    setBusy(true)
    try {
      const result = unwrap(await remote.searchSocialPublicSources({ taskId: task.id, platform, query, confirmed: true }, controller.signal))
      setTasks(current => current.map(item => item.id === task.id ? result.task : item))
      setMessage(result.run.status === 'completed'
        ? `${platform} 公开网页搜索完成：${result.run.candidates.length} 条候选；请核对后逐条加入。`
        : `${platform} 公开网页搜索失败（${result.run.errorCode ?? 'search_failed'}）；可在任务总请求预算内重试。`)
    } catch (error) {
      setMessage(controller.signal.aborted || (error as any)?.code === 'cancelled'
        ? '公开网页搜索已取消；未记录失败，也未消耗预算。'
        : `公开网页搜索失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (activeSocialSearch.current?.controller === controller) activeSocialSearch.current = null
      setActiveSocialSearchTaskId('')
      setBusy(false)
      finishSearch()
    }
  }

  async function fetchPublicCandidate(task: SocialTask, candidate: NonNullable<SocialTask['publicSearchRuns']>[number]['candidates'][number]) {
    if (activeSocialSearch.current) return
    const prompt = `读取 ${candidate.sourceUrl} 的公开页面内容，仅生成不可信预览；预览不会自动保存。是否继续？`
    if (typeof globalThis.confirm !== 'function' || !globalThis.confirm(prompt)) return
    const controller = new AbortController()
    let finishSearch!: () => void
    const done = new Promise<void>(resolve => { finishSearch = resolve })
    activeSocialSearch.current = { taskId: task.id, controller, done, finish: finishSearch, operation: 'public-search' }
    setActiveSocialSearchTaskId(task.id)
    setBusy(true)
    try {
      const preview = unwrap(await remote.fetchSocialPublicSource({ taskId: task.id, platform: candidate.platform, sourceUrl: candidate.sourceUrl, confirmed: true }, controller.signal))
      setSocialCandidatePreview({ taskId: task.id, ...preview })
      setMessage('页面摘录已载入预览；内容仍是不可信材料，确认加入后才写入任务。')
    } catch (error) {
      setMessage(controller.signal.aborted || (error as any)?.code === 'cancelled'
        ? '来源读取已取消；任务和搜索预算未变更。'
        : `来源读取失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (activeSocialSearch.current?.controller === controller) activeSocialSearch.current = null
      setActiveSocialSearchTaskId('')
      setBusy(false)
      finishSearch()
    }
  }

  async function savePublicCandidate(task: SocialTask, candidate: NonNullable<SocialTask['publicSearchRuns']>[number]['candidates'][number], preview?: { sourceUrl: string; excerpt: string }) {
    setBusy(true)
    try {
      const result = unwrap(await remote.saveSocialResearchResult({ taskId: task.id, result: {
        platform: candidate.platform, title: candidate.title, sourceUrl: preview?.sourceUrl ?? candidate.sourceUrl,
        excerpt: preview?.excerpt || candidate.excerpt || '公开搜索结果未提供摘要；请打开来源核验后补充摘录。', knowledgeEntryIds: [],
      } }))
      setTasks(current => current.map(item => item.id === task.id ? result.task : item))
      setMessage(`已将“${candidate.title}”加入用户选择结果；该公开网页候选仍属不可信材料。`)
    } catch (error) {
      setMessage(`加入候选失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  function renderPublicCandidate(task: SocialTask, candidate: NonNullable<SocialTask['publicSearchRuns']>[number]['candidates'][number]) {
    const preview = socialCandidatePreview?.taskId === task.id && socialCandidatePreview.candidateId === candidate.id ? socialCandidatePreview : null
    return h('article', { key: candidate.id },
      h('a', { href: candidate.sourceUrl, target: '_blank', rel: 'noreferrer' }, candidate.title),
      candidate.excerpt ? h('p', null, candidate.excerpt) : h('p', null, '搜索服务未提供摘要。'),
      h('button', { type: 'button', disabled: busy, onClick: () => void fetchPublicCandidate(task, candidate) }, '读取公开页面摘录'),
      h('button', { type: 'button', disabled: busy || task.results?.some(result => result.sourceUrl === candidate.sourceUrl), onClick: () => void savePublicCandidate(task, candidate) }, '核对后加入搜索摘要'),
      preview ? h('div', { role: 'group', 'aria-label': '不可信页面摘录预览', 'data-testid': `social-source-preview-${candidate.id}` },
        h('p', null, `${preview.sourceUrl} · 页面内容为不可信材料，尚未保存。`),
        h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: '20rem', overflow: 'auto' } }, preview.excerpt),
        h('button', { type: 'button', disabled: busy, onClick: () => void savePublicCandidate(task, candidate, preview) }, '确认加入页面摘录'),
        h('button', { type: 'button', disabled: busy, onClick: () => setSocialCandidatePreview(null) }, '丢弃预览')) : null)
  }

  async function rejectPlan(taskId: string) {
    setBusy(true)
    try {
      const result = unwrap(await remote.rejectSocialResearchPlan({ taskId, reason: '用户在工作台取消计划' }))
      setTasks(current => current.map(item => item.id === taskId ? result.task : item))
      setMessage('计划已取消；没有发起平台采集。')
    } catch (error) {
      setMessage(`取消计划失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function retrySocialAttachmentRecovery(taskId: string) {
    setBusy(true)
    try {
      // Host 列表读取会校验并幂等重试待恢复附件，然后返回最新任务状态。
      const refreshed = unwrap(await remote.listSocialResearchTasks())
      setTasks(refreshed.tasks)
      const task = refreshed.tasks.find(item => item.id === taskId)
      const pending = task?.recoveryAttachments?.length ?? 0
      setMessage(pending ? `仍有 ${pending} 个附件待恢复；原始研究结果和附件记录已保留。` : '附件恢复完成，已通过 Host 存储读回校验。')
    } catch (error) {
      setMessage(`重试附件恢复失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }
  async function applySocialTaskAction(taskId: string, action: 'pause' | 'resume' | 'cancel' | 'skip-platform', platform?: string) {
    if (activeSocialTaskActions.current.has(taskId)) return
    activeSocialTaskActions.current.add(taskId)
    try {
      const interruptedActiveOperation = action === 'pause' && activeSocialSearch.current?.taskId === taskId
      if ((action === 'pause' || action === 'cancel') && activeSocialSearch.current?.taskId === taskId) {
        const activeSearch = activeSocialSearch.current
        activeSearch.controller.abort(Object.assign(new Error(action === 'pause' ? '用户暂停社媒任务' : '用户取消社媒任务'), { code: 'cancelled' }))
        setSocialCandidatePreview(current => current?.taskId === taskId ? null : current)
        await activeSearch.done
      }
      if (action === 'cancel' && activeSocialReport.current?.taskId === taskId) {
        activeSocialReport.current.controller.abort(Object.assign(new Error('用户取消社媒任务'), { code: 'cancelled' }))
      }
      setBusy(true)
      try {
        const result = unwrap(await remote.applySocialResearchTaskAction({ taskId, action, platform }))
        setTasks(current => current.map(item => item.id === taskId ? result.task : item))
        setMessage(action === 'pause' ? interruptedActiveOperation ? '当前操作已中止并保存已完成检查点；计划已暂停，恢复后不会自动开始采集。' : '待准备计划已暂停；当前没有正在运行的采集。' : action === 'resume' ? '计划已恢复到平台准备状态；不会自动开始采集。' : action === 'cancel' ? '计划已取消。' : `已跳过 ${platform} 的失败记录；该平台不计为采集成功。`)
      } catch (error: any) { setMessage(error.message) }
      finally { setBusy(false) }
    } finally {
      activeSocialTaskActions.current.delete(taskId)
    }
  }

  const selectedSocialTask = tasks.find(task => task.id === selectedSocialTaskId)

  async function saveSocialResult() {
    if (!selectedSocialTask) return
    setBusy(true)
    try {
      const result = unwrap(await remote.saveSocialResearchResult({
        taskId: selectedSocialTask.id,
        result: {
          platform: socialPlatform || selectedSocialTask.platforms[0] || '',
          title: socialResultTitle,
          sourceUrl: socialResultUrl,
          excerpt: socialResultExcerpt,
          knowledgeEntryIds: selectedSocialKnowledgeIds,
        },
      }))
      setTasks(current => current.map(item => item.id === result.task.id ? result.task : item))
      setSocialResultTitle('')
      setSocialResultUrl('')
      setSocialResultExcerpt('')
      setSelectedSocialKnowledgeIds([])
      setMessage('已保存用户选择的来源摘录；内容按不可信资料处理，未启动平台采集。')
    } catch (error) {
      setMessage(`保存来源失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function uploadSocialAttachment() {
    if (!selectedSocialTask || !selectedSocialResultIds.length || !socialAttachment) return
    let uploadId = ''
    setBusy(true)
    try {
      const begun = unwrap(await remote.beginSocialAttachmentUpload({
        taskId: selectedSocialTask.id, resultId: selectedSocialResultIds[0], name: socialAttachment.name,
        mimeType: socialAttachment.type || 'application/octet-stream', size: socialAttachment.size,
      }))
      uploadId = begun.uploadId
      if (!Number.isSafeInteger(begun.chunkBytes) || begun.chunkBytes < 1 || begun.chunkBytes > 48 * 1024) throw new Error('Host 返回的附件分块预算无效')
      const bytes = new Uint8Array(await socialAttachment.arrayBuffer())
      for (let offset = 0, index = 0; offset < bytes.length; offset += begun.chunkBytes, index += 1) {
        const chunk = bytes.subarray(offset, Math.min(offset + begun.chunkBytes, bytes.length))
        let binary = ''
        for (let cursor = 0; cursor < chunk.length; cursor += 32 * 1024) {
          binary += String.fromCharCode(...chunk.subarray(cursor, Math.min(cursor + 32 * 1024, chunk.length)))
        }
        unwrap(await remote.appendSocialAttachmentChunk({ uploadId, index, dataBase64: btoa(binary) }))
      }
      const committed = unwrap(await remote.commitSocialAttachmentUpload({ uploadId }))
      setTasks(current => current.map(task => task.id === committed.task.id ? committed.task : task))
      setSocialAttachment(null)
      setMessage(committed.attachment.status === 'verified'
        ? `附件“${committed.attachment.name}”已校验并保存到插件备份数据。`
        : `附件“${committed.attachment.name}”已暂存，存储读回待恢复；刷新计划会自动重试校验。`)
    } catch (error) {
      if (uploadId) { try { await remote.cancelSocialAttachmentUpload({ uploadId }) } catch {} }
      try {
        const refreshed = unwrap(await remote.listSocialResearchTasks())
        setTasks(refreshed.tasks)
      } catch {}
      setMessage(`保存社媒附件失败：${error instanceof Error ? error.message : String(error)}；已刷新任务状态，待恢复附件会单独标示。`)
    } finally { setBusy(false) }
  }

  async function removeSocialResult(taskId: string, resultId: string, title: string) {
    const confirm = globalThis.confirm
    if (typeof confirm !== 'function' || !confirm(`从当前任务中移除来源“${title}”？已有报告版本会保留为历史记录；关联附件将从插件任务和备份中解除，但 DSH 内容对象不会删除。`)) return
    setBusy(true)
    try {
      const result = unwrap(await remote.removeSocialResearchResult({ taskId, resultId }))
      setTasks(current => current.map(task => task.id === taskId ? result.task : task))
      setSelectedSocialResultIds(current => current.filter(id => id !== resultId))
      setMessage(`来源“${title}”已从当前任务移除；历史报告保留${result.removedAttachmentCount ? `，${result.removedAttachmentCount} 个附件关联已解除（Host 内容对象保留）` : ''}。`)
    } catch (error) {
      setMessage(`移除来源失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function removeSocialAttachment(taskId: string, attachmentId: string, name: string) {
    const confirm = globalThis.confirm
    if (typeof confirm !== 'function' || !confirm(`从当前任务、结果关联和插件备份中移除附件“${name}”？DSH Host 附件存储中的内容对象会保留，不会自动删除。`)) return
    setBusy(true)
    try {
      const result = unwrap(await remote.removeSocialResearchAttachment({ taskId, attachmentId }))
      setTasks(current => current.map(task => task.id === taskId ? result.task : task))
      setMessage(`附件“${result.attachment.name}”已从任务及插件备份关联中移除；DSH Host 内容对象仍保留。`)
    } catch (error) {
      setMessage(`移除附件关联失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function downloadSocialAttachment(taskId: string, attachmentId: string) {
    let downloadId = ''
    const controller = new AbortController()
    activeSocialDownload.current = { taskId, controller }
    setActiveSocialDownloadTaskId(taskId)
    setBusy(true)
    try {
      const begun = unwrap(await remote.beginSocialResearchAttachmentDownload({ taskId, attachmentId }))
      downloadId = begun.downloadId
      if (!Number.isSafeInteger(begun.attachment.bytes) || begun.attachment.bytes < 1 || begun.attachment.bytes > 25 * 1024 * 1024
        || !Number.isSafeInteger(begun.chunkBytes) || begun.chunkBytes < 1 || begun.chunkBytes > 48 * 1024) throw new Error('Host 返回的附件大小或分块预算无效')
      const parts: Uint8Array[] = []
      let offset = 0
      while (offset < begun.attachment.bytes) {
        const chunk = unwrap(await remote.readSocialResearchAttachmentChunk({ downloadId, taskId, offset }, controller.signal))
        const bytes = Uint8Array.from(atob(chunk.dataBase64), character => character.charCodeAt(0))
        if (chunk.offset !== offset || chunk.totalBytes !== begun.attachment.bytes || chunk.nextOffset !== offset + bytes.byteLength
          || bytes.byteLength < 1 || bytes.byteLength > begun.chunkBytes || chunk.done !== (chunk.nextOffset === chunk.totalBytes)) {
          throw new Error('附件分块次序或长度与 Host 校验结果不符')
        }
        parts.push(bytes)
        offset = chunk.nextOffset
      }
      if (offset !== begun.attachment.bytes) throw new Error('附件下载长度与已校验记录不符')
      const url = URL.createObjectURL(new Blob(parts as BlobPart[], { type: begun.attachment.mimeType }))
      const link = document.createElement('a')
      link.href = url
      link.download = begun.attachment.name
      link.hidden = true
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setMessage(`附件“${begun.attachment.name}”已通过摘要校验并开始下载；内容仍是不可信资料。`)
    } catch (error) {
      setMessage(controller.signal.aborted || (error as any)?.code === 'cancelled' ? '附件下载已取消。' : `读取附件失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (downloadId) { try { await remote.finishSocialResearchAttachmentDownload({ downloadId }) } catch {} }
      if (activeSocialDownload.current?.controller === controller) activeSocialDownload.current = null
      setActiveSocialDownloadTaskId('')
      setBusy(false)
    }
  }

  async function makeSocialReportPrompt(resultIds = selectedSocialResultIds) {
    if (!selectedSocialTask) return
    setBusy(true)
    try {
      const result = unwrap(await remote.buildSocialResearchReportPrompt({ taskId: selectedSocialTask.id, resultIds }))
      setSocialReportPrompt(result.reportRun.prompt)
      setSavedSocialReportPrompt(result.reportRun.prompt)
      setSelectedSocialReportRunId(result.reportRun.id)
      setTasks(current => current.map(task => task.id === result.task.id ? result.task : task))
      setMessage(`已保存第 ${result.task.reportRuns?.length ?? 1} 版报告提示词（${result.selectedResultCount} 条结果）；检查内容后再复制/外发。`)
    } catch (error) {
      setMessage(`报告提示词生成失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function generateSocialReport(resultIds = selectedSocialResultIds) {
    if (!selectedSocialTask || !provider || !model) { setMessage('请先在主工作台选择模型提供方和模型。'); return }
    if (activeSocialReport.current) return
    const controller = new AbortController()
    activeSocialReport.current = { taskId: selectedSocialTask.id, controller }
    setActiveSocialReportTaskId(selectedSocialTask.id)
    setBusy(true)
    try {
      const result = unwrap(await remote.generateSocialResearchReport({ taskId: selectedSocialTask.id, resultIds, provider, model }, controller.signal))
      setSocialReportOutput(result.reportRun.report)
      setSocialReportPrompt(result.reportRun.prompt)
      setSavedSocialReportPrompt(result.reportRun.prompt)
      setSelectedSocialReportRunId(result.reportRun.id)
      setTasks(current => current.map(task => task.id === result.task.id ? result.task : task))
      setMessage(`报告已生成并保存为第 ${result.task.reportRuns?.length ?? 1} 版（${result.reportRun.resultIds.length} 条来源）；请复核后再使用。`)
    } catch (error) {
      setMessage(controller.signal.aborted ? '已取消报告生成，未保存新版本。' : `社媒报告生成失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (activeSocialReport.current?.controller === controller) activeSocialReport.current = null
      setActiveSocialReportTaskId('')
      setBusy(false)
    }
  }

  async function saveEditedSocialReportPrompt() {
    if (!selectedSocialTask || !selectedSocialReportRunId || !socialReportPrompt.trim()) return
    setBusy(true)
    try {
      const result = unwrap(await remote.saveSocialResearchReportPrompt({
        taskId: selectedSocialTask.id, parentRunId: selectedSocialReportRunId, prompt: socialReportPrompt,
      }))
      setTasks(current => current.map(task => task.id === result.task.id ? result.task : task))
      setSocialReportPrompt(result.reportRun.prompt)
      setSavedSocialReportPrompt(result.reportRun.prompt)
      setSelectedSocialReportRunId(result.reportRun.id)
      setMessage(`已另存编辑后的报告提示词（${result.reportRun.resultIds.length} 条原始来源），上一版本保持不变。`)
    } catch (error) {
      setMessage(`保存编辑版本失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  return h('section', { 'aria-label': '学术与社媒工作台' },
    h('h2', { style: { fontSize: '17px', margin: 0 } }, '学术与社媒工作台'),
    h('button', { type: 'button', disabled: busy, onClick: () => void load() }, '读取已保存工作区'),
    h('section', { 'aria-label': '学术项目' },
      h('h3', null, '学术项目'),
      h('label', null, '工作流 ', h('select', { value: kind, disabled: busy, onChange: (event: any) => setKind(event.target.value) }, h('option', { value: 'review' }, '综述项目'), h('option', { value: 'publishing' }, '投稿与审稿核验'))),
      h('label', null, '项目名称 ', h('input', { value: title, maxLength: 200, onChange: (event: any) => setTitle(event.target.value) })),
      kind === 'review' ? h('div', null,
        h('label', null, '研究问题 ', h('textarea', { value: question, rows: 2, onChange: (event: any) => setQuestion(event.target.value) })),
        h('label', null, '综述范围 ', h('textarea', { value: scope, rows: 2, onChange: (event: any) => setScope(event.target.value) })),
        h('label', null, '综述类型 ', h('select', { value: reviewType, disabled: busy, onChange: (event: any) => setReviewType(event.target.value) }, ...[['narrative-review','叙述性综述'],['scoping-review','范围综述'],['systematic-review','系统综述']].map(([value, label]) => h('option', { key: value, value }, label)))),
        h('label', null, '筛选模式 ', h('select', { value: screeningModel, disabled: busy, onChange: (event: any) => setScreeningModel(event.target.value) }, h('option', { value: 'single-reviewer' }, '单人筛选'), h('option', { value: 'two-reviewers' }, '双人筛选（分歧需裁定）'))))
        : h('label', null, '目标期刊/机构 ', h('input', { value: venue, onChange: (event: any) => setVenue(event.target.value) })),
      h('button', { type: 'button', disabled: busy || !title.trim() || (kind === 'review' && (!question.trim() || !scope.trim())), onClick: () => void createAcademic() }, editingProjectId ? '保存项目修改' : '新建并保存项目'),
      projects.length ? h('ul', null, ...projects.map(project => h('li', { key: project.id }, h('label', null, h('input', { type: 'radio', name: 'academic-project', checked: selectedProject?.id === project.id, onChange: () => setSelectedProjectId(project.id) }), `${project.title} · ${project.workspaceKind === 'review' ? '综述' : '投稿/审稿'}${project.target?.venue ? ` · ${project.target.venue}` : ''} `), h('button', { type: 'button', disabled: busy, onClick: () => editAcademic(project.id) }, '编辑')))) : h('p', null, '尚未加载学术项目。'),
      h('details', null,
        h('summary', null, '导入 RIS / BibTeX 题录'),
        h('label', null, '格式 ', h('select', { value: bibliographyFormat, disabled: busy, onChange: (event: any) => { setBibliographyFormat(event.target.value); setBibliographyPreview(null) } }, h('option', { value: 'ris' }, 'RIS'), h('option', { value: 'bibtex' }, 'BibTeX'))),
        h('label', null, '题录内容 ', h('textarea', { value: bibliographyText, rows: 5, maxLength: 2000000, disabled: busy, onChange: (event: any) => { setBibliographyText(event.target.value); setBibliographyPreview(null) } })),
        h('button', { type: 'button', disabled: busy || !bibliographyText.trim(), onClick: () => void previewBibliography() }, '预览题录'),
        bibliographyPreview ? h('div', null,
          h('p', null, `有效 ${bibliographyPreview.entries.length} 条；重复 ${bibliographyPreview.duplicates.length} 条；错误 ${bibliographyPreview.errors.length} 条。未知字段会保留，请在入库前检查。`),
          ...bibliographyPreview.entries.map((entry: any) => h('label', { key: entry.id, style: { display: 'block' } }, h('input', { type: 'checkbox', checked: entry.selected !== false, onChange: (event: any) => setBibliographyPreview((current: any) => ({ ...current, entries: current.entries.map((item: any) => item.id === entry.id ? { ...item, selected: event.target.checked } : item) })) }), `${entry.title} · ${entry.literature.doi || '无 DOI'}${Object.keys(entry.literature.importedFields).length ? ` · 未识别字段：${Object.keys(entry.literature.importedFields).join(', ')}` : ''}`)),
          ...bibliographyPreview.errors.map((item: any, index: number) => h('p', { key: `error-${index}`, role: 'alert' }, `记录 ${item.record}：${item.message}`)),
          h('button', { type: 'button', disabled: busy || !bibliographyPreview.entries.some((entry: any) => entry.selected !== false), onClick: () => void importSelectedBibliography() }, '导入所选题录')) : null),
      literature.length ? h('div', null, h('h4', null, '插件资料库中的学术文献'), h('label', null, '选择文献 ', h('select', { value: selectedLiteratureId, onChange: (event: any) => setSelectedLiteratureId(event.target.value) }, h('option', { value: '' }, '选择题录'), ...literature.map(entry => h('option', { key: entry.id, value: entry.id }, `${entry.title}${entry.literature?.doi ? ` · ${entry.literature.doi}` : ''}`))))) : null,
      selectedProject?.workspaceKind === 'review' ? h('section', { 'aria-label': '综述筛选与证据' },
        h('h4', null, '综述筛选与证据'),
        h('button', { type: 'button', disabled: busy || !selectedProject || !selectedLiteratureId, onClick: () => void applyAction('addLiteratureRecords', [[selectedLiteratureId]]) }, '将题录快照加入综述'),
        selectedProject.records?.length ? h('ul', null, ...selectedProject.records.map(record => h('li', { key: record.id },
          h('label', null, h('input', { type: 'radio', name: 'academic-record', checked: selectedRecordId === record.id, onChange: () => setSelectedRecordId(record.id) }), `${record.snapshot.title} · ${record.screening.titleAbstract.adjudication.decision || record.screening.titleAbstract.reviewerOne.decision || '待筛选'}`),
          h('button', { type: 'button', disabled: busy, onClick: () => { setSelectedRecordId(record.id); void applyAction('setScreeningDecision', [record.id, 'title-abstract', reviewer, { decision: academicAction, reason, evidence, location }]) } }, `${reviewer === 'reviewerOne' ? '审阅者一' : '审阅者二'}：${academicAction}`),
          h('button', { type: 'button', disabled: busy || selectedProject.screeningModel !== 'two-reviewers', onClick: () => { setSelectedRecordId(record.id); void applyAction('adjudicateScreeningDecision', [record.id, { decision: academicAction, reason, evidence, location }]) } }, '保存人工裁定'),
          selectedProject.reviewType === 'narrative-review' ? h('button', { type: 'button', disabled: busy, onClick: () => void applyAction('setNarrativeSelection', [record.id, !record.narrativeSelected]) }, record.narrativeSelected ? '取消纳入叙述材料' : '纳入叙述材料') : h('button', { type: 'button', disabled: busy || !fullTextConfirmed, onClick: () => void applyAction('setFullTextDecision', [record.id, { decision: 'include', userConfirmedFullText: fullTextConfirmed, location }]) }, '确认全文纳入')))) : h('p', null, '将资料库文献加入项目后可进行筛选。'),
        h('label', null, '审阅者 ', h('select', { value: reviewer, onChange: (event: any) => setReviewer(event.target.value) }, h('option', { value: 'reviewerOne' }, '审阅者一'), h('option', { value: 'reviewerTwo' }, '审阅者二'))),
        h('label', null, '筛选决定 ', h('select', { value: academicAction, onChange: (event: any) => setAcademicAction(event.target.value) }, ...[['include','纳入候选'],['exclude','排除'],['uncertain','待定'],['duplicate','重复']].map(([value, label]) => h('option', { key: value, value }, label)))),
        h('label', null, '理由 ', h('input', { value: reason, onChange: (event: any) => setReason(event.target.value) })),
        h('label', null, '用户核对证据 ', h('textarea', { value: evidence, rows: 2, onChange: (event: any) => setEvidence(event.target.value) })),
        h('label', null, '来源位置 ', h('input', { value: location, onChange: (event: any) => setLocation(event.target.value) })),
        h('label', null, h('input', { type: 'checkbox', checked: fullTextConfirmed, onChange: (event: any) => setFullTextConfirmed(event.target.checked) }), '我已亲自核对全文'),
        h('label', null, '提取字段 ID ', h('input', { value: fieldId, onChange: (event: any) => setFieldId(event.target.value) })),
        h('label', null, '字段名称 ', h('input', { value: fieldLabel, onChange: (event: any) => setFieldLabel(event.target.value) })),
        h('button', { type: 'button', disabled: busy || !selectedRecordId || !fieldId.trim() || !fieldLabel.trim(), onClick: () => void applyAction('updateExtractionFields', [[...(selectedProject.extractionFields ?? []).filter(field => field.id !== fieldId), { id: fieldId, label: fieldLabel }]]) }, '保存提取字段'),
        h('label', null, '提取值 ', h('textarea', { value: extractedValue, rows: 2, onChange: (event: any) => setExtractedValue(event.target.value) })),
        h('button', { type: 'button', disabled: busy || !selectedRecordId || !fieldId.trim() || !extractedValue.trim(), onClick: () => void applyAction('setExtractionValue', [selectedRecordId, fieldId, { value: extractedValue, evidence, sourceLocation: location, confirmed: false }]) }, '保存待核对证据提取'),
        ...extractionConfirmationControls,
        h('button', { type: 'button', disabled: busy || !selectedRecordId, onClick: () => void makePrompt('review-extraction', [selectedRecordId]) }, '生成所选文献证据提示词')) : null,
      selectedProject?.workspaceKind === 'publishing' ? h('section', { 'aria-label': '投稿要求与审稿回应' },
        h('h4', null, '投稿要求与审稿回应'),
        h('label', null, '稿件论断 ', h('textarea', { value: claimText, rows: 2, onChange: (event: any) => setClaimText(event.target.value) })),
        h('button', { type: 'button', disabled: busy || !selectedLiteratureId || !claimText.trim() || !evidence.trim() || !location.trim(), onClick: () => void applyAction('addCitationClaim', [{ statement: claimText, sources: [{ knowledgeEntryId: selectedLiteratureId, relation: 'supports', evidenceExcerpt: evidence, evidenceLocation: location }] }]) }, '关联所选插件文献并保存论断'),
        ...selectedProject.citationClaims?.map(claim => h('button', { key: `citation-prompt-${claim.id}`, type: 'button', disabled: busy, onClick: () => void makePrompt('citation-check', [claim.id]) }, `生成引用核对提示词：${claim.statement.slice(0, 24)}`)) ?? [],
        h('label', null, '投稿要求标题 ', h('input', { value: requirementTitle, onChange: (event: any) => setRequirementTitle(event.target.value) })),
        h('label', null, '要求内容 ', h('textarea', { value: requirementBody, rows: 2, onChange: (event: any) => setRequirementBody(event.target.value) })),
        h('button', { type: 'button', disabled: busy || !requirementTitle.trim() || !requirementBody.trim(), onClick: () => void applyAction('addRequirementCard', [{ title: requirementTitle, body: requirementBody, issuer: venue }]) }, '保存投稿要求'),
        selectedProject.requirements?.length ? h('ul', null, ...selectedProject.requirements.map(requirement => h('li', { key: requirement.id }, `${requirement.title} · ${requirement.verificationStatus} · ${requirement.sourceLocator || '来源位置未记录'}`))) : null,
        h('label', null, '投稿清单项 ', h('input', { value: checklistTitle, onChange: (event: any) => setChecklistTitle(event.target.value) })),
        h('button', { type: 'button', disabled: busy || !checklistTitle.trim(), onClick: () => void applyAction('addChecklistItem', [{ title: checklistTitle }]) }, '添加投稿清单项'),
        selectedProject.checklist?.length ? h('ul', null, ...selectedProject.checklist.map(item => h('li', { key: item.id }, h('label', null, item.title, ' ', h('select', { value: item.status, disabled: busy, onChange: (event: any) => void applyAction('updateChecklistItem', [item.id, { status: event.target.value }]) }, ...[['todo','待办'],['in-progress','处理中'],['complete','已记录完成']].map(([value, label]) => h('option', { key: value, value }, label))))))) : null,
        ...selectedProject.checklist?.map(item => h('button', { key: `submission-prompt-${item.id}`, type: 'button', disabled: busy, onClick: () => void makePrompt('submission-prep', [item.id]) }, `生成投稿核对提示词：${item.title.slice(0, 24)}`)) ?? [],
        h('label', null, '审稿轮次 ', h('input', { value: roundTitle, onChange: (event: any) => setRoundTitle(event.target.value) })),
        h('button', { type: 'button', disabled: busy || !roundTitle.trim(), onClick: async () => { await applyAction('addReviewerRound', [{ title: roundTitle }]); setSelectedRoundId('') } }, '新增审稿轮次'),
        selectedProject.reviewerRounds?.length ? h('label', null, '当前轮次 ', h('select', { value: selectedRoundId || selectedProject.reviewerRounds.at(-1)?.id || '', onChange: (event: any) => setSelectedRoundId(event.target.value) }, ...selectedProject.reviewerRounds.map(round => h('option', { key: round.id, value: round.id }, round.title)))) : null,
        h('label', null, '审稿意见 ', h('textarea', { value: reviewerComment, rows: 3, onChange: (event: any) => setReviewerComment(event.target.value) })),
        h('button', { type: 'button', disabled: busy || !selectedRoundId && !selectedProject.reviewerRounds?.length || !reviewerComment.trim(), onClick: () => void applyAction('addReviewerComment', [selectedRoundId || selectedProject.reviewerRounds?.at(-1)?.id, { reviewer: '审稿人', rawComment: reviewerComment }]) }, '保存逐条审稿意见'),
        selectedProject.reviewerRounds?.flatMap(round => round.comments.map(comment => h('details', { key: comment.id }, h('summary', null, `${round.title} · ${comment.reviewer} · ${comment.status}`), h('p', null, comment.rawComment), h('label', null, '回复草稿 ', h('textarea', { value: responseDraft || comment.responseDraft, rows: 2, onChange: (event: any) => setResponseDraft(event.target.value) })), h('label', null, '实际改动摘要 ', h('input', { value: changeSummary || comment.changeSummary, onChange: (event: any) => setChangeSummary(event.target.value) })), h('label', null, '改动位置 ', h('input', { value: changeLocation || comment.changeLocation, onChange: (event: any) => setChangeLocation(event.target.value) })), h('button', { type: 'button', disabled: busy || !changeSummary.trim() || !changeLocation.trim(), onClick: () => void applyAction('resolveReviewerComment', [round.id, comment.id, { status: 'revised', responseDraft, changeSummary, changeLocation }]) }, '记录已完成修改'), h('button', { type: 'button', disabled: busy || !responseDraft.trim(), onClick: () => void applyAction('resolveReviewerComment', [round.id, comment.id, { status: 'planned', responseDraft }]) }, '保存计划回复'), h('button', { type: 'button', disabled: busy || !reason.trim(), onClick: () => void applyAction('resolveReviewerComment', [round.id, comment.id, { status: 'no-change', responseDraft, noChangeReason: reason }]) }, '记录不修改理由')))) ?? [],
        selectedProject.reviewerRounds?.flatMap(round => round.comments.map(comment => h('button', { key: `prompt-${comment.id}`, type: 'button', disabled: busy, onClick: () => void makePrompt('reviewer-response', [comment.id]) }, `生成回复提示词：${comment.id.slice(0, 8)}`))) ?? []) : null,
      selectedProject?.promptRounds?.length ? h('details', null, h('summary', null, `已保存提示词轮次（${selectedProject.promptRounds.length}）`), ...selectedProject.promptRounds.map(round => h('details', { key: round.id }, h('summary', null, `${round.kind} · ${round.createdAt}`), h('pre', { style: { whiteSpace: 'pre-wrap' } }, round.prompt)))) : null,
      prompt ? h('label', null, '提示词预览（外发前检查） ', h('textarea', { value: prompt, rows: 8, readOnly: true }), h('button', { type: 'button', onClick: () => void globalThis.navigator?.clipboard?.writeText(prompt).then(() => setMessage('提示词已复制到剪贴板。')).catch(() => setMessage('复制失败；提示词仍显示在预览框中。')) }, '复制提示词')) : null),
    h('section', { id: 'social-research-plan-form', 'aria-label': '社媒研究计划' },
      h('h3', null, '社媒研究计划'),
      h('label', null, '研究主题 ', h('input', { value: topic, maxLength: 500, onChange: (event: any) => setTopic(event.target.value) })),
      h('fieldset', null, h('legend', null, '平台'), ...platforms.map(([value, label]) => h('label', { key: value }, h('input', { type: 'checkbox', checked: selectedPlatforms.includes(value), onChange: (event: any) => setSelectedPlatforms(current => event.target.checked ? [...current, value] : current.filter(item => item !== value)) }), label))),
      h('label', null, '查询（每行一条） ', h('textarea', { value: queries, rows: 3, onChange: (event: any) => setQueries(event.target.value) })),      h('fieldset', { 'aria-label': '研究预算' }, h('legend', null, '研究预算（创建后随计划保存）'),
        h('label', null, '平台数上限 ', h('input', { type: 'number', min: 1, max: 4, step: 1, value: socialMaxPlatforms, onChange: (event: any) => setSocialMaxPlatforms(Math.max(1, Math.min(4, Number(event.target.value) || 1))) })),
        h('label', null, '每平台不同查询上限 ', h('input', { type: 'number', min: 1, max: 3, step: 1, value: socialMaxQueries, onChange: (event: any) => setSocialMaxQueries(Math.max(1, Math.min(3, Number(event.target.value) || 1))) })),
        h('label', null, '公开搜索总请求上限 ', h('input', { type: 'number', min: 1, max: 100, step: 1, value: socialMaxRequests, onChange: (event: any) => setSocialMaxRequests(Math.max(1, Math.min(100, Number(event.target.value) || 1))) })),
        selectedPlatforms.length > socialMaxPlatforms ? h('p', { role: 'alert' }, '已选平台数超过预算上限，请减少平台或提高上限。') : null,
        queries.split(/\r?\n/u).map(value => value.trim()).filter(Boolean).length > socialMaxQueries ? h('p', { role: 'alert' }, '查询数超过每平台预算上限，请删减查询或提高上限。') : null),
      h('button', { type: 'button', disabled: busy || !topic.trim() || !selectedPlatforms.length || selectedPlatforms.length > socialMaxPlatforms || !queries.trim() || queries.split(/\r?\n/u).map(value => value.trim()).filter(Boolean).length > socialMaxQueries, onClick: () => void createSocialPlan() }, '保存待确认计划'),
      tasks.length ? h('ul', null, ...tasks.map(task => h('li', { key: task.id }, h('details', { open: selectedSocialTaskId === task.id },
        h('summary', { onClick: () => { setSelectedSocialTaskId(task.id); setSocialPlatform(task.platforms[0] ?? ''); setSelectedSocialReportRunId(task.reportRuns?.at(-1)?.id ?? ''); setSocialReportPrompt(task.reportRuns?.at(-1)?.prompt ?? ''); setSocialReportOutput(task.reportRuns?.at(-1)?.report ?? ''); setSavedSocialReportPrompt(task.reportRuns?.at(-1)?.prompt ?? ''); setSelectedSocialResultIds([]) } }, `${task.topic} · ${task.platforms.join(', ')} · ${task.status} · ${task.results?.length ?? 0} 条结果`),
        (task.usage?.sourceRequests ?? 0) >= (task.budget?.maxSourceRequests ?? 100) ? h('button', { type: 'button', disabled: busy, onClick: () => {
          const supportedPlatforms = task.platforms.filter(platform => platforms.some(([id]) => id === platform))
          const unsupportedPlatforms = task.platforms.filter(platform => !supportedPlatforms.includes(platform))
          setTopic(task.topic)
          setSelectedPlatforms(supportedPlatforms)
          setQueries(task.queries.join('\n'))
          setSocialMaxPlatforms(Math.max(1, Math.min(4, task.budget?.maxPlatforms ?? task.platforms.length)))
          setSocialMaxQueries(Math.max(1, Math.min(3, task.budget?.maxQueriesPerPlatform ?? 3)))
          setSocialMaxRequests(Math.max(1, Math.min(100, task.budget?.maxSourceRequests ?? 100)))
          setMessage('已复制主题、受支持平台和查询到新计划表单；旧计划及预算保持不变。请复核内容并设置新计划预算，再保存待确认计划。' + (unsupportedPlatforms.length ? ` 未复制历史/不支持平台：${unsupportedPlatforms.join('、')}。` : ''))
          globalThis.document?.getElementById('social-research-plan-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        } }, '复制为新计划并重新设预算') : null,
        h('p', null, `查询：${task.queries.join('；') || '无'}`),
        renderSocialPlatformRunReceipts(task),
        h('p', null, `预算：最多 ${task.budget?.maxQueriesPerPlatform ?? '未设定'} 个不同查询/平台、${task.budget?.maxPlatforms ?? '未设定'} 个平台、${task.budget?.maxSourceRequests ?? 100} 次公开搜索（已用 ${task.usage?.sourceRequests ?? 0} 次）。`),
        h('section', { 'data-testid': `social-platform-capabilities-${task.id}`, 'aria-label': '平台能力状态' },
          h('h4', null, '平台能力状态（profile 配置不代表当前已登录）'),
          h('button', { type: 'button', disabled: busy, onClick: () => void refreshSocialAvailability() }, '刷新 Host 平台状态'),
          h('ul', null, ...task.platforms.map(platform => {
            const capability = task.capabilities?.find(item => item.platform === platform)
            const verified = capability?.status === 'verified' && capability.verified
            const availability = socialAvailability.find(item => item.platform === platform)
            const currentlyAvailable = availability?.canRun === true
            const status = availability?.profileConfigured ? 'profile-configured' : currentlyAvailable ? 'ready' : verified ? 'needs-authorization' : 'unverified'
            const description = availability?.profileConfigured
              ? 'DSH Browser profile 已配置；当前登录状态尚未确认，采集时再检查'
              : currentlyAvailable
              ? 'Host 当前报告适配已核验且已授权'
              : verified ? '计划记录适配已核验，但 Host 当前未报告可运行连接' : '直接采集适配未核验；登录授权状态未导入'
            return h('li', { key: platform, 'data-platform': platform, 'data-capability-status': status },
              `${platform}：${description}。下方公开网页搜索是独立路径，不是平台官方 API 采集。`)
          }))),
        task.status === 'awaiting-platform-preparation' ? h('section', { 'aria-label': `DSH 平台采集能力 ${task.id}` },
          h('p', null, '平台采集使用 DSH Host 的适配器或 DSH Browser 登录 profile；profile 配置不等于登录有效，登录态由 DSH 管理，不会导入插件。'),
          ...task.platforms.filter(platform => socialAvailability.some(item => item.platform === platform && item.canRun)).map(platform => h('button', { key: `direct:${platform}`, type: 'button', disabled: busy, onClick: () => void runAuthorizedPlatform(task, platform) }, `确认并采集：${platform}`)),
          ...task.platforms.filter(platform => !socialAvailability.some(item => item.platform === platform && item.canRun)).map(platform => h('small', { key: `unavailable:${platform}`, style: { display: 'block' } }, `${platform}：${socialAvailability.find(item => item.platform === platform)?.reason ?? '当前 Host 未核验适配或授权'}；可使用下方公开网页搜索路径。`))) : null,
        task.status === 'awaiting-platform-preparation' ? h('section', { 'aria-label': `公开网页搜索 ${task.id}` },
          h('p', null, '这是 DSH 网页搜索，不读取平台登录态，也不是官方 API 采集。候选网址会按目标平台域名过滤；每次搜索先确认，候选必须逐条手动加入。'),
          activeSocialSearchTaskId === task.id ? h('button', { type: 'button', onClick: () => activeSocialSearch.current?.controller.abort() }, activeSocialSearch.current?.operation === 'authorized-platform-collection' ? '取消当前平台采集' : '取消公开搜索') : null,
          ...task.platforms.flatMap(platform => task.queries.map(query => {
            const retry = (task.publicSearchRuns ?? []).some(run => run.platform === platform && run.query === query && run.status === 'failed')
            const requestsExhausted = (task.usage?.sourceRequests ?? 0) >= (task.budget?.maxSourceRequests ?? 100)
            return h('button', { key: `${platform}:${query}`, type: 'button', disabled: busy || requestsExhausted, onClick: () => void searchSocialSources(task, platform, query) }, `${retry ? '重试' : '确认'}公开搜索：${platform} · ${query}`)
          }))) : null,
        selectedSocialTask?.id === task.id && task.publicSearchRuns?.length ? h('section', { 'data-testid': `social-public-search-${task.id}`, 'aria-label': '公开网页搜索候选' },
          h('h4', null, '公开网页搜索候选（尚未加入研究结果）'),
          ...task.publicSearchRuns.map(run => h('div', { key: run.id, 'data-search-status': run.status },
            h('p', null, `${run.platform} · ${run.query} · ${run.status === 'failed' ? `失败：${run.errorCode ?? 'search_failed'}` : `${run.candidates.length} 条候选${run.truncated ? '（结果截断）' : ''}`}`),
            ...run.candidates.map(candidate => renderPublicCandidate(task, candidate))))) : null,
        task.status === 'awaiting-plan-confirmation' ? h('section', { 'aria-label': '待确认社媒计划摘要' },
          h('h4', null, '确认前核对计划'),
          h('p', null, `平台：${task.platforms.join('、') || '无'}`),
          h('p', null, '查询：'),
          task.queries.length ? h('ol', null, ...task.queries.map((query, index) => h('li', { key: `${task.id}:query:${index}` }, query))) : h('p', null, '无查询'),
          h('p', null, `预算：最多 ${task.budget?.maxPlatforms ?? task.platforms.length} 个平台；每平台最多 ${task.budget?.maxQueriesPerPlatform ?? 3} 个不同查询；全任务最多 ${task.budget?.maxSourceRequests ?? 100} 次来源请求；每次最多 ${task.budget?.maxResultsPerQuery ?? 20} 条结果。`),
          h('p', null, `已有结果（未确认发送）：${task.results?.map(item => item.title).filter(Boolean).join('；') || '无'}`),
          h('p', null, `已归档附件（未确认发送）：${task.attachments?.map(item => item.name).filter(Boolean).join('；') || '无'}`),
          h('button', { type: 'button', disabled: busy, onClick: () => void confirmPlan(task.id) }, '确认计划（不启动采集）'),
          h('button', { type: 'button', disabled: busy, onClick: () => void rejectPlan(task.id) }, '取消计划')) : null,
        task.status === 'awaiting-platform-preparation' ? h('div', null,
          h('button', { type: 'button', disabled: busy, onClick: () => void searchConfirmedSocialPlan(task) }, '执行已确认计划公开搜索'),
          h('button', { type: 'button', disabled: busy && activeSocialSearchTaskId !== task.id, onClick: () => void applySocialTaskAction(task.id, 'pause') }, activeSocialSearchTaskId === task.id ? '暂停当前操作并保留检查点' : '暂停待准备计划'),
          h('button', { type: 'button', disabled: busy && activeSocialSearchTaskId !== task.id, onClick: () => void applySocialTaskAction(task.id, 'cancel') }, '取消计划')) : null,
        task.status === 'paused' ? h('div', null,
          h('button', { type: 'button', disabled: busy, onClick: () => void applySocialTaskAction(task.id, 'resume') }, '恢复计划'),
          h('button', { type: 'button', disabled: busy && activeSocialSearchTaskId !== task.id, onClick: () => void applySocialTaskAction(task.id, 'cancel') }, '取消计划')) : null,
        ['report-ready', 'partial-failure', 'failed'].includes(task.status) ? h('button', { type: 'button', disabled: busy && activeSocialSearchTaskId !== task.id, onClick: () => void applySocialTaskAction(task.id, 'cancel') }, '取消任务') : null,
        task.platformResults?.filter(item => item.status === 'failed').map(item => {
          const budgetAvailable = (task.usage?.sourceRequests ?? 0) < (task.budget?.maxSourceRequests ?? 100)
          const canRetry = budgetAvailable && socialAvailability.some(platform => platform.platform === item.platform && platform.canRun)
          return h('div', { key: `failure-${item.platform}` },
            h('span', null, `${item.platform} 失败${item.errorCode ? `：${item.errorCode}` : ''}。${canRetry ? '可在确认预算后重试此平台。' : !budgetAvailable ? '来源请求预算已用尽；请调整预算后再重试。' : socialAvailability.find(platform => platform.platform === item.platform)?.reason ?? '当前 Host 未核验该平台适配或授权。'}`),
            canRetry ? h('button', { type: 'button', disabled: busy, onClick: () => void runAuthorizedPlatform(task, item.platform) }, `确认并重试：${item.platform}`) : null,
            h('button', { type: 'button', disabled: busy, onClick: () => void applySocialTaskAction(task.id, 'skip-platform', item.platform) }, '跳过此平台'))
        }),
        selectedSocialTask?.id === task.id && task.attachments?.length ? h('section', { 'data-testid': `social-attachments-${task.id}`, 'aria-label': '已归档社媒附件' },
          h('h4', null, '已归档附件（存储校验通过；内容仍是不可信资料）'),
          activeSocialDownloadTaskId === task.id ? h('button', { type: 'button', onClick: () => activeSocialDownload.current?.controller.abort(Object.assign(new Error('用户取消附件下载'), { code: 'cancelled' })) }, '取消附件下载') : null,
          ...task.attachments.map(attachment => {
            const result = task.results?.find(item => item.attachmentIds?.includes(attachment.id))
            return h('div', { key: attachment.id }, h('p', null, `${attachment.name} · ${attachment.mimeType} · ${attachment.bytes} 字节 · 关联来源：${result?.title ?? '未找到关联来源'}`), h('button', { type: 'button', disabled: busy, onClick: () => void downloadSocialAttachment(task.id, attachment.id) }, '下载已校验附件'), h('button', { type: 'button', disabled: busy, onClick: () => void removeSocialAttachment(task.id, attachment.id, attachment.name) }, '从任务移除附件'))
          })) : null,
        selectedSocialTask?.id === task.id && task.recoveryAttachments?.length ? h('div', { role: 'status', 'data-testid': `social-attachment-recovery-${task.id}` },
          ...task.recoveryAttachments.map(item => h('div', { key: item.id }, h('p', null, `附件“${item.name}”尚未完成存储读回校验${item.errorCode ? `（${item.errorCode}）` : ''}；研究结果仍保留。`), h('button', { type: 'button', disabled: busy, onClick: () => void removeSocialAttachment(task.id, item.id, item.name) }, '从任务移除待恢复附件'))),
          h('button', { type: 'button', disabled: busy, onClick: () => void retrySocialAttachmentRecovery(task.id) }, '立即重试附件恢复')) : null,
        selectedSocialTask?.id === task.id && task.results?.length ? h('fieldset', { 'data-testid': `social-results-${task.id}` },
          h('legend', null, '已保存的用户选择结果（不可信资料）'),
          ...task.results.map(item => h('div', { key: item.id, style: { display: 'flex', alignItems: 'center', gap: 8 } }, h('label', null, h('input', {
            type: 'checkbox', checked: selectedSocialResultIds.includes(item.id),
            onChange: (event: any) => setSelectedSocialResultIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)),
          }), `${item.platform} · ${item.title} · ${item.sourceUrl}`), h('button', { type: 'button', disabled: busy, onClick: () => void removeSocialResult(task.id, item.id, item.title) }, '从任务移除来源'))),
          h('button', { type: 'button', disabled: busy || !selectedSocialResultIds.length, onClick: () => void makeSocialReportPrompt() }, task.reportRuns?.length ? '重跑报告提示词（保存新版本）' : '生成所选结果的报告提示词'),
          task.reportRuns?.length ? h('div', { 'data-testid': 'social-report-run-history' },
            h('label', null, '历史报告提示词 ', h('select', { 'aria-label': '历史报告提示词版本', value: selectedSocialReportRunId || task.reportRuns.at(-1)?.id || '', disabled: busy, onChange: (event: any) => { const run = task.reportRuns?.find(item => item.id === event.target.value); if (run && selectedSocialTask?.id === task.id) { setSelectedSocialReportRunId(run.id); setSocialReportPrompt(run.prompt); setSocialReportOutput(run.report ?? ''); setSavedSocialReportPrompt(run.prompt) } } }, ...task.reportRuns.map((run, index) => h('option', { key: run.id, value: run.id }, `第 ${index + 1} 版 · ${run.createdAt} · ${run.resultIds.length} 条来源`)))),
            h('button', { type: 'button', disabled: busy || !task.reportRuns.find(run => run.id === selectedSocialReportRunId), onClick: () => { const run = task.reportRuns?.find(item => item.id === selectedSocialReportRunId); if (run) { setSelectedSocialResultIds(run.resultIds); void makeSocialReportPrompt(run.resultIds) } } }, '按此版本的来源重新生成提示词'),
            h('button', { type: 'button', disabled: busy || !provider || !model || !task.reportRuns.find(run => run.id === selectedSocialReportRunId), onClick: () => { const run = task.reportRuns?.find(item => item.id === selectedSocialReportRunId); if (run) void generateSocialReport(run.resultIds) } }, '按此版本的来源重新生成报告'),
            activeSocialReportTaskId === task.id ? h('button', { type: 'button', onClick: () => activeSocialReport.current?.controller.abort() }, '取消报告生成') : null,
            h('p', null, `已保存 ${task.reportRuns.length} 个提示词版本；最新：${task.reportRuns.at(-1)?.createdAt}`)) : null,
        h('label', null, '选择要归档的附件（PDF、TXT、CSV、PNG、JPEG、WebP，最多 25 MiB） ', h('input', { type: 'file', disabled: busy || !selectedSocialResultIds.length, accept: '.pdf,.txt,.csv,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,text/csv,image/png,image/jpeg,image/webp', onChange: (event: any) => setSocialAttachment(event.target.files?.[0] ?? null) })),
        h('button', { type: 'button', disabled: busy || !selectedSocialResultIds.length || !socialAttachment, onClick: () => void uploadSocialAttachment() }, '保存附件到插件备份（关联首个选中结果）')) : null)))) : h('p', null, '尚未加载社媒研究计划。'),
      selectedSocialTask && ['awaiting-platform-preparation', 'report-ready', 'partial-failure', 'failed'].includes(selectedSocialTask.status) ? h('section', { 'aria-label': '添加用户选择的社媒结果' },
        h('h4', null, '添加用户选择的结果'),
        h('label', null, '平台 ', h('select', { value: socialPlatform || selectedSocialTask.platforms[0] || '', disabled: busy, onChange: (event: any) => setSocialPlatform(event.target.value) }, ...selectedSocialTask.platforms.map(value => h('option', { key: value, value }, value)))),
        h('label', null, '标题 ', h('input', { value: socialResultTitle, maxLength: 300, onChange: (event: any) => setSocialResultTitle(event.target.value) })),
        h('label', null, '来源链接 ', h('input', { type: 'url', value: socialResultUrl, maxLength: 2000, onChange: (event: any) => setSocialResultUrl(event.target.value) })),
        h('label', null, '用户选择的摘录 ', h('textarea', { value: socialResultExcerpt, rows: 4, maxLength: 5000, onChange: (event: any) => setSocialResultExcerpt(event.target.value) })),
        knowledgeEntries.length ? h('fieldset', { 'data-testid': 'social-knowledge-attachments' }, h('legend', null, '关联已保存资料（按需选择）'), ...knowledgeEntries.map(entry => h('label', { key: entry.id, style: { display: 'block' } }, h('input', {
          type: 'checkbox', checked: selectedSocialKnowledgeIds.includes(entry.id),
          onChange: (event: any) => setSelectedSocialKnowledgeIds(current => event.target.checked ? [...current, entry.id] : current.filter(id => id !== entry.id)),
        }), `${entry.title}${entry.sourceUrl ? ` · ${entry.sourceUrl}` : ''}`))) : h('p', null, '资料库暂无可关联条目。'),
        h('button', { type: 'button', disabled: busy || !socialResultTitle.trim() || !socialResultUrl.trim() || !socialResultExcerpt.trim(), onClick: () => void saveSocialResult() }, '保存结果与资料关联')) : null,
      socialReportOutput ? h('label', { 'data-testid': 'social-report-output' }, '模型生成的报告（已保存；请复核） ', h('textarea', { value: socialReportOutput, rows: 12, readOnly: true })) : null,
      socialReportPrompt ? h('label', { 'data-testid': 'social-report-prompt' }, '报告提示词（可编辑；修改后另存新版本，不会自动发送） ', h('textarea', { value: socialReportPrompt, rows: 8, disabled: busy, onChange: (event: any) => setSocialReportPrompt(event.target.value) }), h('button', { type: 'button', disabled: busy || !selectedSocialReportRunId || !socialReportPrompt.trim() || socialReportPrompt === savedSocialReportPrompt, onClick: () => void saveEditedSocialReportPrompt() }, '保存编辑并另存新版本'), h('button', { type: 'button', disabled: busy, onClick: () => void globalThis.navigator?.clipboard?.writeText(socialReportPrompt).then(() => setMessage('报告提示词已复制。')).catch(() => setMessage('复制失败；提示词仍保留在编辑框中。')) }, '复制报告提示词')) : null,
      h('small', null, '确认计划只更新本地状态，不会采集平台内容；结果由用户手动选择并记录。模型报告由用户明确选择模型并点击生成；真实平台采集仍需 DSH 侧已核验能力和明确授权。')),
    h('p', { role: 'status', 'aria-live': 'polite' }, message))
}


