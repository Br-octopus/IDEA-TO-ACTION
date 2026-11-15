import * as React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '../remote-errors.js'
import forwardStepRemote from '@local/forward-step-dsh/remote'
import type {} from '@local/forward-step-dsh/remote'
import { createClientState, reduceClient } from '../../client/state.js'
import { MemoryPanel, type MemoryPanelRemote } from './memory-panel.js'
import { deleteTaskDraft, readTaskDraft, writeTaskDraft } from '../../client/drafts.js'
import { browseWorkspaceDirectory } from '../../client/workspace-files.js'
import { workspaceFilesToWritingMaterials } from '../../client/writing-directory-materials.js'
import { approveResearch, cancelResearch, rejectResearch, requestResearch } from '../../core/research.js'
import { deriveCurrentOverrides } from '../../core/current-overrides.js'
import { importSelectedTextMaterials, readSelectedFileBytes, readSelectedFileText, uploadAndParseSelectedFile } from '../../client/material-files.js'
import { MigrationPanel, type MigrationRemote } from './migration-panel.js'
import { BackupPanel, type BackupRemote } from './backup-panel.js'
import { SettingsPanel, type SettingsRemote, type PluginPreferences } from './settings-panel.js'
import { KnowledgePanel, type KnowledgeRemote, type WorkspaceFilesRemote } from './knowledge-panel.js'
import { ExternalReferencesPanel } from './external-references-panel.js'
import { DomainWorkbenchesPanel, type DomainWorkbenchesRemote } from './domain-workbenches-panel.js'
import { AssetsPanel, type AssetsRemote } from './assets-panel.js'
import { WritingPacksPanel, type WritingPacksRemote } from './writing-packs-panel.js'
import { WritingWorkspacePanel, type WritingWorkspaceRemote } from './writing-workspace-panel.js'
import { downloadPptHtmlPresentation } from '../../core/ppt-html-export.js'
import { importPptHtmlPresentation } from '../../core/ppt-html-import.js'
import { downloadPptxPresentation } from '../../core/pptx-export.js'
import { importPptxPresentation } from '../../core/pptx-import.js'
import { importPptScreenshots } from '../../client/ppt-screenshot-import.js'
import { hasExpectedImageSignature } from '../../client/ppt-screenshot-import.js'
import { addPptxImageOcr } from './pptx-image-ocr.js'
import { listPptPageImages, removePptPageImage } from './ppt-page-images.js'
import type { PptVisualFeedback, StoredReview, TaskMaterial, TaskMethodState } from '../types.js'

const MAX_PPT_IMAGE_BYTES_TOTAL = 20 * 1024 * 1024

function estimatePptImageBytes(value: unknown): number {
  if (typeof value !== 'string') return 0
  const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value)
  if (!match) return 0
  const padding = match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0
  return Math.floor(match[1].length * 3 / 4) - padding
}

function renderPptTablePreview(table: any): React.ReactNode {
  if (!Array.isArray(table?.rows) || !table.rows.length) return null
  return React.createElement('table', { 'aria-label': '当前页面表格预览', style: { borderCollapse: 'collapse', width: '100%', marginTop: 8 } },
    React.createElement('tbody', null, ...table.rows.map((row: any[], rowIndex: number) => React.createElement('tr', { key: rowIndex },
      ...row.map((value: any, columnIndex: number) => {
        const cell = typeof value === 'string' ? { text: value } : value
        const Tag = rowIndex === 0 ? 'th' : 'td'
        return React.createElement(Tag, { key: columnIndex, style: { border: '1px solid #98a2b3', padding: '4px 8px', textAlign: 'left', fontWeight: cell.bold || rowIndex === 0 ? 700 : undefined, color: cell.color ? `#${cell.color}` : undefined, background: cell.fillColor ? `#${cell.fillColor}` : undefined } }, cell.text)
      }),
    ))),
  )
}

function renderPptChartPreview(chart: any): React.ReactNode {
  if (!chart || !Array.isArray(chart.categories)) return null
  const series = Array.isArray(chart.series) ? chart.series : Array.isArray(chart.values) ? [{ name: '数值', values: chart.values }] : []
  if (!series.length || series.some((item: any) => !Array.isArray(item?.values))) return null
  const maximum = Math.max(1, ...series.flatMap((item: any) => item.values.map(Number).filter(Number.isFinite)))
  const colors = ['#4472c4', '#ed7d31', '#70ad47', '#a5a5a5']
  return React.createElement('figure', { 'data-testid': 'ppt-chart-preview', 'aria-label': `图表预览：${chart.title || '数据图表'}`, style: { margin: '8px 0', padding: '12px', border: '1px solid var(--dsw-alias-border-default)', borderRadius: '6px' } },
    React.createElement('figcaption', { style: { fontWeight: 600, marginBottom: '8px' } }, chart.title || '数据图表'),
    React.createElement('div', { role: 'list', 'aria-label': '图表数据', style: { minHeight: '130px', display: 'flex', alignItems: 'stretch', gap: '8px', overflowX: 'auto' } },
      ...chart.categories.map((category: string, categoryIndex: number) => React.createElement('div', { key: `${category}-${categoryIndex}`, role: 'listitem', 'aria-label': String(category), style: { flex: '1 0 48px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' },
        },
        React.createElement('div', { style: { width: '100%', height: '92px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '2px' } },
          ...series.map((item: any, seriesIndex: number) => {
            const value = Number(item.values[categoryIndex])
            const height = Number.isFinite(value) && value > 0 ? Math.max(3, Math.round(value / maximum * 88)) : 2
            return React.createElement('span', { key: `${item.name}-${seriesIndex}`, role: 'img', 'aria-label': `${category}，${item.name}：${item.values[categoryIndex]}`, title: `${item.name}：${item.values[categoryIndex]}`, style: { width: `${Math.max(8, Math.floor(70 / series.length))}%`, height: `${height}px`, background: colors[seriesIndex % colors.length], borderRadius: '3px 3px 0 0' } })
          }),
        ),
        React.createElement('small', { style: { textAlign: 'center', overflowWrap: 'anywhere' } }, String(category)),
      )),
    ),
    React.createElement('ul', { 'aria-label': '图例', style: { display: 'flex', flexWrap: 'wrap', gap: '4px 14px', listStyle: 'none', padding: 0, margin: '8px 0 0' } },
      ...series.map((item: any, index: number) => React.createElement('li', { key: `${item.name}-${index}`, style: { color: colors[index % colors.length] } }, `■ ${item.name}`)),
    ),
  )
}

type PluginRemote = MemoryPanelRemote & BackupRemote & KnowledgeRemote & DomainWorkbenchesRemote & AssetsRemote & WritingPacksRemote & WritingWorkspaceRemote & {
  beginPluginBackupExport(input: { includePreferences: boolean; includeServiceConfig: boolean }): Promise<RemoteResult<{ exportId: string; chunkBytes: number; byteLength: number; attachmentCount: number; sha256: string }>>
  readPluginBackupExportChunk(input: { exportId: string; offset: number; length: number }): Promise<RemoteResult<{ offset: number; dataBase64: string; nextOffset: number; byteLength: number; sha256: string; done: boolean }>>
  cancelPluginBackupExport(input: { exportId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
  beginPluginBackupImport(input: { sourceName: string; size: number }): Promise<RemoteResult<{ uploadId: string; chunkBytes: number }>>
  appendPluginBackupImportChunk(input: { uploadId: string; index: number; dataBase64: string }): Promise<RemoteResult<{ nextChunk: number; bytes: number }>>
  previewPluginBackupImport(input: { uploadId: string; mode: 'replace' | 'merge' }): Promise<RemoteResult<any>>
  restorePluginBackupArchive(input: { uploadId: string; mode: 'replace' | 'merge'; expectedSha256: string; expectedRevision: number; confirmed: boolean; eventId: string }): Promise<RemoteResult<any>>
  cancelPluginBackupImport(input: { uploadId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
  finishPluginBackupImport(input: { uploadId: string }): Promise<RemoteResult<{ finished: boolean }>>
  beginArchiveImport(input: { sourceName: string; size: number }): Promise<RemoteResult<{ uploadId: string; chunkBytes: number }>>
  appendArchiveImportChunk(input: { uploadId: string; index: number; dataBase64: string }): Promise<RemoteResult<{ nextChunk: number; bytes: number }>>
  previewArchiveImport(input: { uploadId: string; size: number }): Promise<RemoteResult<any>>
  commitArchiveImport(input: { uploadId: string; selectedCategories: string[]; eventId: string }): Promise<RemoteResult<any>>
  cancelArchiveImport(input: { uploadId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
  beginWritingMaterialUpload(input: { sourceName: string; mimeType: string; size: number }): Promise<RemoteResult<{ uploadId: string; chunkBytes: number }>>
  appendWritingMaterialChunk(input: { uploadId: string; index: number; dataBase64: string }): Promise<RemoteResult<{ nextChunk: number; bytes: number }>>
  parseWritingMaterialUpload(input: { uploadId: string }, signal?: AbortSignal): Promise<RemoteResult<any>>
  cancelWritingMaterialUpload(input: { uploadId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
  previewImport(input: { backupJson: string; sourceName?: string }): Promise<RemoteResult<any>>
  commitImport(input: { backupJson: string; selectedCategories: string[]; eventId: string }): Promise<RemoteResult<any>>
  listImportReceipts(): Promise<RemoteResult<{ receipts: any[] }>>
  deleteImportReceipt(input: { receiptId: string; eventId: string }): Promise<RemoteResult<{ deleted: boolean; revision: number }>>
  echo(input: { marker: string }): Promise<RemoteResult<{ marker: string; observed: boolean }>>
  wait(input: { marker: string; milliseconds: number }, signal?: AbortSignal): Promise<RemoteResult<{ marker: string; observed: boolean }>>
  storageWrite(input: { marker: string }): Promise<RemoteResult<{ marker: string; stored: boolean }>>
  storageRead(): Promise<RemoteResult<{ marker: string; stored: boolean }>>
  agentIsolation(signal?: AbortSignal): Promise<RemoteResult<any>>
  realModelIsolation(input: { provider: string; model: string }, signal?: AbortSignal): Promise<RemoteResult<any>>
  getHostCapabilities(): Promise<RemoteResult<{ capabilities: { id: string; label: string; status: 'available' | 'unavailable'; detail: string }[] }>>
  getPluginPreferences(): Promise<RemoteResult<{ preferences: PluginPreferences }>>
  savePluginPreferences(input: PluginPreferences): Promise<RemoteResult<{ preferences: PluginPreferences; revision: number }>>
  getPluginServiceConfig(): Promise<RemoteResult<{ serviceConfig: { searchEndpoint: string; auxiliaryWritingEndpoint: string; auxiliaryWritingModel: string } }>>
  savePluginServiceConfig(input: { searchEndpoint: string; auxiliaryWritingEndpoint: string; auxiliaryWritingModel: string }): Promise<RemoteResult<{ serviceConfig: { searchEndpoint: string; auxiliaryWritingEndpoint: string; auxiliaryWritingModel: string }; revision: number }>>
  testPluginServiceEndpoint(input: { service: 'search' | 'auxiliary-writing'; confirmed: boolean }, signal?: AbortSignal): Promise<RemoteResult<{ service: string; reachable: boolean; statusCode: number; checkedAt: string }>>
  runAuxiliaryWriting(input: { prompt: string; confirmed: boolean }, signal?: AbortSignal): Promise<RemoteResult<{ text: string; model: string }>>
  listProviders(): Promise<RemoteResult<{ providers: { id: string; name: string }[] }>>
  listModels(input: { provider: string }): Promise<RemoteResult<{ models: { provider: string; id: string; name: string }[] }>>
  listTasks(input: { cwd: string; archived?: boolean }): Promise<RemoteResult<{ projectId: string; revision: number; tasks: Task[] }>>  getWritingMaterialCoverage(input: { articleId: string }): Promise<RemoteResult<{ workspace: any; summary: any; revision: number }>>
  initializeWritingMaterialCoverage(input: { articleId: string; genre: string; goal?: string; items: any[] }): Promise<RemoteResult<{ workspace: any; summary: any; revision: number }>>
  applyWritingMaterialCoverageAction(input: { articleId: string; action: string; batchSize?: number; promptVersionId?: string; batchId?: string; itemId?: string; kind?: string; resultSummary?: string; reason?: string; evidence?: string }): Promise<RemoteResult<{ workspace: any; summary: any; revision: number }>>
  getCurrentBinding(input: { projectId: string; conversationId: string }): Promise<RemoteResult<{ binding: { taskId: string } | null }>>
  createTask(input: { cwd: string; title?: string; entryType: string; domain: string; originalInput: string; conversationId: string; eventId: string }): Promise<RemoteResult<{ task: Task; revision: number }>>
  updateTask(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; patch: { title?: string; agent?: Task["agent"]; currentRequirements?: string[]; methodState?: TaskMethodState; materials?: TaskMaterial[] }; eventId: string }): Promise<RemoteResult<{ task: Task; revision: number }>>
  archiveTask(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; archived: boolean; eventId: string }): Promise<RemoteResult<{ task: Task; revision: number }>>
  previewDeleteTask(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; clearLearned?: boolean }): Promise<RemoteResult<{ impact: { title: string; bindingCount: number; versionCount: number; reviewCount: number; clearLearned: boolean; memoryCount: number; sourceCount: number } }>>
  deleteTask(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; confirmed: boolean; clearLearned?: boolean; eventId: string }): Promise<RemoteResult<{ deleted: boolean; taskId: string; revision: number }>>
  saveExternalResult(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; stepId: string; promptVersionId: string; content: string; feedback?: string; eventId: string }): Promise<RemoteResult<{ task: Task; version: TaskVersion; revision: number }>>
  saveReview(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; resultVersionId: string; promptVersionId: string; verdict: 'success' | 'failure' | 'unverified'; checks: { requirement: string; result: 'pass' | 'fail' | 'not-checked'; note?: string }[]; feedback?: string; confirmed: boolean; eventId: string }): Promise<RemoteResult<{ task: Task; review: StoredReview; revision: number }>>
  savePromptRevision(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; stepId: string; sourceVersionId: string; content: string; eventId: string }): Promise<RemoteResult<{ task: Task; version: TaskVersion; revision: number }>>
  bindTask(input: { projectId: string; taskId: string; conversationId: string; eventId: string }): Promise<RemoteResult<{ binding: any; revision: number }>>
  runTask(input: { taskId: string; taskRevision: number; stage: string; requestId: string; projectId: string; conversationId: string; provider: string; model: string }, signal?: AbortSignal): Promise<RemoteResult<any>>
  understandPptPage(input: { projectId: string; taskId: string; taskRevision: number; conversationId: string; pageIndex: number; imageIndex?: number; imageIndices?: number[]; provider: string; model: string }, signal?: AbortSignal): Promise<RemoteResult<{ visualDescription: string }>>
  cancelTask(input: { requestId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
  searchPptSources(input: { projectId: string; taskId: string; conversationId: string; query: string; confirmed: boolean; probe?: boolean }, signal?: AbortSignal): Promise<RemoteResult<{ query: string; sources: PptSourceCandidate[]; truncated: boolean; selectedByUser: false; status: string }>>
  runApprovedResearch(input: { taskId: string }, signal?: AbortSignal): Promise<RemoteResult<{ task: Task; revision: number; truncated: boolean }>>
  fetchPptSource(input: { projectId: string; taskId: string; conversationId: string; url: string; confirmed: boolean; probe?: boolean }, signal?: AbortSignal): Promise<RemoteResult<{ url: string; statusCode: number; excerpt: string; truncated: boolean; trust: 'untrusted'; scriptsExecuted: false }>>
}

type TaskVersion = { versionId: string; requestId?: string; eventId?: string; kind?: 'prompt' | 'agent-output' | 'external-result'; stage: string; stepId?: string; promptVersionId?: string; content: string; feedback?: string; source?: 'user-pasted'; stale?: boolean; staleReason?: string; memoryRevisionChanged?: boolean; model?: string; taskRevision?: number; sentMessages?: { count: number; roles: string[]; textBytes: number; digest: string }; createdAt: string }
type Task = { taskId: string; revision: number; title: string; domain: string; entryType: string; originalInput: string; archived?: boolean; currentRequirements: string[]; materials: TaskMaterial[]; methodState: TaskMethodState; versions: TaskVersion[]; reviews?: StoredReview[]; projectId: string; agent?: { steps?: { id: string; title: string; status?: string }[]; currentStepId?: string; research?: { status: string; decision: string; scope: { objective: string; queries: string[]; sourceTypes: string[] }; budget: { maxQueries: number; maxSources: number }; results: { url: string; title: string; summary: string }[]; message?: string } } }
type ExternalDraft = { content: string; feedback: string; stepId: string; promptVersionId: string }
type ActiveRun = { taskId: string; requestId: string; controller: AbortController; cancelled: boolean }
type PptSourceCandidate = { id: string; title: string; url: string; excerpt: string; publishedAt: string; trust: 'untrusted' }


const { createElement: h, useState, useRef } = React
const panelId = 'forward-step-dsh'
const defaultWritingGenres = [
  { genre: 'article', name: '普通文章', taskTypes: ['diagnosis', 'revision'], representativeTask: 'revision', status: 'supported', reason: '主工作台支持目标、约束、稿件、反馈和轮次保存。' },
  { genre: 'academic-paper', name: '学术论文与学位论文', taskTypes: ['academic-planning', 'academic-outline', 'academic-chapter-draft', 'diagnosis', 'revision'], representativeTask: 'academic-planning', status: 'partial', reason: '学术专属规则已接入；完整字段和综述/审稿工作台仍待贯通。' },
]

function unwrapRemote<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

async function copyText(text: string): Promise<boolean> {
  let copied = false
  try {
    const clipboard = globalThis.navigator?.clipboard
    if (clipboard?.writeText) {
      await clipboard.writeText(text)
      copied = true
    }
  } catch { /* 某些宿主没有剪贴板权限，继续尝试兼容路径。 */ }

  try {
    const documentRef = globalThis.document
    if (documentRef?.body && typeof documentRef.execCommand === 'function') {
      let textarea: any
      let fallbackCopied = false
      try {
        textarea = documentRef.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        documentRef.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        textarea.setSelectionRange(0, textarea.value.length)
        fallbackCopied = documentRef.execCommand('copy')
      } finally {
        try { textarea?.remove() } catch { /* 清理失败不改变复制结果。 */ }
      }
      copied = fallbackCopied || copied
    }
  } catch { /* 兼容复制失败时仍保留可见文本。 */ }
  return copied
}

function Panel({ remote, workspaceFiles }: { remote: PluginRemote; workspaceFiles?: WorkspaceFilesRemote }) {
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
  const [clearLearned, setClearLearned] = useState(false)
  const [stage, setStage] = useState('planning')
  const [reviewVerdict, setReviewVerdict] = useState<'success' | 'failure' | 'unverified'>('unverified')
  const [includeKnowledge, setIncludeKnowledge] = useState(false)
  const [knowledgePreviewDigest, setKnowledgePreviewDigest] = useState('')
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([])
  const [hostCapabilities, setHostCapabilities] = useState<{ id: string; label: string; status: 'available' | 'unavailable'; detail: string }[] | null>(null)
  const [models, setModels] = useState<{ provider: string; id: string; name: string }[]>([])
  const [writingGenres, setWritingGenres] = useState(defaultWritingGenres)
  const [writingPacks, setWritingPacks] = useState<any[]>([])
  const [writingCoverage, setWritingCoverage] = useState<any>(null)
  const [writingCoverageReason, setWritingCoverageReason] = useState('人工确认本批覆盖')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [projectId, setProjectId] = useState('')
  const [runningRequest, setRunningRequest] = useState('')
  const activeRunRef = useRef<ActiveRun | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [externalDraftsByTask, setExternalDraftsByTask] = useState<Record<string, ExternalDraft>>({})
  const [methodDraftsByTask, setMethodDraftsByTask] = useState<Record<string, TaskMethodState>>({})
  const [pptFeedbackPageIndex, setPptFeedbackPageIndex] = useState(0)
  const [pptPreviewPageIndex, setPptPreviewPageIndex] = useState(0)
  const [pptExpandedImage, setPptExpandedImage] = useState<{ taskId: string; pageIndex: number; imageIndex: number; src: string } | null>(null)
  const [pptUnderstandingDraft, setPptUnderstandingDraft] = useState<{ taskId: string; pageIndex: number; imageIndex: number; imageCount: number; imageIndices: number[]; contentSnapshot: string; text: string } | null>(null)
  const pptSlidesRef = useRef<any[]>([])
  const pptUnderstandingRequestRef = useRef<AbortController | null>(null)
  function cancelPptUnderstanding() {
    const controller = pptUnderstandingRequestRef.current
    pptUnderstandingRequestRef.current = null
    controller?.abort(Object.assign(new Error('PPT 页面或任务已切换'), { code: 'cancelled' }))
    setPptUnderstandingDraft(null)
  }
  const pptPageImageReaderRef = useRef<FileReader | null>(null)
  function cancelPptPageImageRead() {
    const reader = pptPageImageReaderRef.current
    pptPageImageReaderRef.current = null
    reader?.abort()
  }
  React.useEffect(() => () => {
    const controller = pptUnderstandingRequestRef.current
    pptUnderstandingRequestRef.current = null
    controller?.abort(Object.assign(new Error("PPT 面板已关闭"), { code: "cancelled" }))
    cancelPptPageImageRead()
  }, [])
  const pptTableDraftRef = useRef<HTMLTextAreaElement | null>(null)
  const [pendingPptImport, setPendingPptImport] = useState<{ taskId: string; format: 'HTML' | 'PPTX'; title: string; fileName: string; slides: any[]; limitations: string[] } | null>(null)
  const [pendingPptImportPageIndex, setPendingPptImportPageIndex] = useState(0)
  const [pptFeedbackCategory, setPptFeedbackCategory] = useState<PptVisualFeedback['category']>('content')
  const [pptFeedbackComment, setPptFeedbackComment] = useState('')
  const [pptFeedbackTarget, setPptFeedbackTarget] = useState<{ taskId: string; pageIndex: number; x: number; y: number; imageIndex?: number } | null>(null)
  const [pptSearchQueriesByTask, setPptSearchQueriesByTask] = useState<Record<string, string>>({})
  const [pptSourcesByTask, setPptSourcesByTask] = useState<Record<string, PptSourceCandidate[]>>({})
  const [pptSourceStatusByTask, setPptSourceStatusByTask] = useState<Record<string, string>>({})
  const [pptVerifiedWebByTask, setPptVerifiedWebByTask] = useState<Record<string, { search: boolean; fetch: boolean }>>({})
  const pptSourceRequestRef = useRef<{ taskId: string; controller: AbortController } | null>(null)
  const [requirementsDraftsByTask, setRequirementsDraftsByTask] = useState<Record<string, string>>({})
  const [materialDraftsByTask, setMaterialDraftsByTask] = useState<Record<string, TaskMaterial[]>>({})
  const [materialPurpose, setMaterialPurpose] = useState<'content' | 'style' | 'both'>('content')
  const [materialImporting, setMaterialImporting] = useState(false)
  const [materialImportMessage, setMaterialImportMessage] = useState('')
  const [workspaceMaterialDirectory, setWorkspaceMaterialDirectory] = useState('.')
  const materialImportRef = useRef<AbortController | null>(null)
  const [reviewResultIdsByTask, setReviewResultIdsByTask] = useState<Record<string, string>>({})
  const [reviewCheckResultsByTask, setReviewCheckResultsByTask] = useState<Record<string, Record<string, 'pass' | 'fail' | 'not-checked'>>>({})
  const [promptEditorDraftsByTask, setPromptEditorDraftsByTask] = useState<Record<string, string>>({})
  const [draftStorageStatusByTask, setDraftStorageStatusByTask] = useState<Record<string, 'saved' | 'error'>>({})
  const [researchSearchActive, setResearchSearchActive] = useState(false)
  const researchSearchRef = useRef<AbortController | null>(null)
  const selectedTask = tasks.find(task => task.taskId === selectedTaskId)
  const methodState = selectedTask ? (methodDraftsByTask[selectedTask.taskId] ?? selectedTask.methodState ?? {}) : {}
  const writingState = methodState.writing ?? {}
  const writingGenre = writingState.article?.genre ?? 'article'
  const activeWritingGenre = writingGenres.find(item => item.genre === writingGenre)
  const writingTaskTypes: string[] = activeWritingGenre?.taskTypes ?? []
  const selectedWritingPackIds: string[] = writingState.round?.packSelections ?? []
  const availableWritingPacks = writingPacks.filter(pack => !pack.builtin && pack.enabled !== false
    && (!pack.genre || pack.genre === writingGenre)
    && (!pack.taskType || pack.taskType === 'article' || pack.taskType === writingState.round?.taskType))
  const pptState = methodState.ppt ?? {}
  const pptSlides = pptState.outline?.slides ?? []
  pptSlidesRef.current = pptSlides
  const pptActivePreviewIndex = Math.min(pptPreviewPageIndex, Math.max(0, pptSlides.length - 1))
  const pptPreviewSlide = pptSlides[pptActivePreviewIndex]
  const currentPptUnderstandingDraft = pptUnderstandingDraft && pptUnderstandingDraft.taskId === selectedTask?.taskId && pptUnderstandingDraft.pageIndex === pptActivePreviewIndex && pptUnderstandingSnapshot(pptPreviewSlide, pptUnderstandingDraft.imageIndices) === pptUnderstandingDraft.contentSnapshot ? pptUnderstandingDraft : null
  const hasCurrentPptFeedback = (pptState.visualFeedback ?? []).some(item => item.selected && item.comment.trim() && item.contentSnapshot === pptFeedbackSnapshot(pptSlides[item.pageIndex] ?? {}))
  const latestPptModificationPrompt = selectedTask
    ? [...selectedTask.versions].reverse().find(version => version.kind === 'agent-output' && version.stage === 'step-prompt')?.content ?? ''
    : ''
  const taskMaterials = selectedTask ? (materialDraftsByTask[selectedTask.taskId] ?? selectedTask.materials ?? []) : []
  const renameDraft = selectedTask ? (clientState.draftsByTask[selectedTaskId] ?? selectedTask.title) : ''
  const externalDraft = selectedTask ? (externalDraftsByTask[selectedTask.taskId] ?? { content: '', feedback: '', stepId: '', promptVersionId: '' }) : { content: '', feedback: '', stepId: '', promptVersionId: '' }
  const externalSteps = selectedTask?.agent?.steps?.length ? [{ id: 'task', title: '整项任务' }, ...selectedTask.agent.steps] : [{ id: 'task', title: '整项任务' }]
  const promptVersions = selectedTask?.versions.filter(version => version.kind !== 'external-result') ?? []
  const externalPromptVersionId = promptVersions.some(version => version.versionId === externalDraft.promptVersionId) ? externalDraft.promptVersionId : (promptVersions.at(-1)?.versionId ?? '')
  const selectedPromptVersion = promptVersions.find(version => version.versionId === externalPromptVersionId)
  const editablePromptVersion = selectedTask ? promptVersions.filter(version => version.stage === stage).at(-1) ?? promptVersions.at(-1) : undefined
  const promptEditorContent = selectedTask ? (promptEditorDraftsByTask[selectedTask.taskId] ?? editablePromptVersion?.content ?? '') : ''
  const externalStepId = externalSteps.some(step => step.id === externalDraft.stepId) ? externalDraft.stepId : (selectedPromptVersion?.stepId ?? 'task')
  const externalVersions = selectedTask?.versions.filter(version => version.kind === 'external-result') ?? []
  const selectedReviewResultId = externalVersions.some(version => version.versionId === reviewResultIdsByTask[selectedTaskId]) ? reviewResultIdsByTask[selectedTaskId] : (externalVersions.at(-1)?.versionId ?? '')
  const selectedReviewResult = externalVersions.find(version => version.versionId === selectedReviewResultId)
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

  function updateMethodDraft(task: Task, next: TaskMethodState) {
    setMethodDraftsByTask(current => ({ ...current, [task.taskId]: next }))
  }

  function removeCurrentPptImage(imageIndex: number) {
    const slides = [...(pptState.outline?.slides ?? [])]
    const slide = slides[pptActivePreviewIndex]
    if (!slide) return
    slides[pptActivePreviewIndex] = removePptPageImage(slide, imageIndex)
    setPptUnderstandingDraft(null)
    updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, outline: { ...pptState.outline, slides } } })
    setPptFeedbackTarget(null)
  }

  function pptImagesFingerprint(images: string[]) {
    const image = images.join('\n')
    let first = 2166136261
    let second = 0x9e3779b9
    for (let index = 0; index < image.length; index += 1) {
      const code = image.charCodeAt(index)
      first = Math.imul(first ^ code, 16777619)
      second = Math.imul(second ^ (code + index), 2246822519)
    }
    return image ? `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}` : ''
  }

  function pptFeedbackSnapshot(slide: { title?: string; content?: string; visualDescription?: string; modelVisualDescription?: string; table?: unknown; chart?: unknown; imageDataUrl?: string; imageDataUrls?: string[] }) {
    const imageFingerprint = pptImagesFingerprint(listPptPageImages(slide))
    const modelVisualDescription = slide.modelVisualDescription?.trim() ?? ''
    return JSON.stringify({ title: slide.title?.trim() ?? '', content: slide.content?.trim() ?? '', visualDescription: slide.visualDescription?.trim() ?? '', ...(modelVisualDescription ? { modelVisualDescription } : {}), table: slide.table ?? null, chart: slide.chart ?? null, imageFingerprint })
  }

  function pptUnderstandingSnapshot(slide: { title?: string; content?: string; body?: string; imageDataUrl?: string; imageDataUrls?: string[] } | undefined, imageIndices: number[]) {
    const images = listPptPageImages(slide ?? {})
    const imageFingerprint = pptImagesFingerprint(imageIndices.map(index => images[index] ?? ''))
    return JSON.stringify({ title: String(slide?.title ?? '').slice(0, 300), content: String(slide?.content ?? slide?.body ?? '').slice(0, 3000), imageFingerprint })
  }

  function addPptFeedback() {
    if (!selectedTask) return
    const slides = pptState.outline?.slides ?? []
    const slide = slides[pptFeedbackPageIndex]
    if (!slide || !pptFeedbackComment.trim()) { setResult('请先选择有效页面并填写反馈内容。'); return }
    const feedback: PptVisualFeedback = {
      id: globalThis.crypto.randomUUID(), pageIndex: pptFeedbackPageIndex,
      ...(pptFeedbackTarget?.taskId === selectedTask.taskId && pptFeedbackTarget.pageIndex === pptFeedbackPageIndex ? { target: { kind: 'point', x: pptFeedbackTarget.x, y: pptFeedbackTarget.y, ...(Number.isSafeInteger(pptFeedbackTarget.imageIndex) ? { imageIndex: pptFeedbackTarget.imageIndex } : {}) } } : {}),
      category: pptFeedbackCategory, comment: pptFeedbackComment.trim(), contentSnapshot: pptFeedbackSnapshot(slide), selected: true, createdAt: new Date().toISOString(),
    }
    updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, visualFeedback: [...(pptState.visualFeedback ?? []), feedback] } })
    setPptFeedbackComment('')
  }

  function updatePptFeedback(id: string, patch: Partial<PptVisualFeedback>) {
    if (!selectedTask) return
    updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, visualFeedback: (pptState.visualFeedback ?? []).map(item => item.id === id ? { ...item, ...patch } : item) } })
  }

  async function searchPptSources() {
    if (!selectedTask || selectedTask.domain !== 'ppt' || !conversationId.trim()) return
    const query = (pptSearchQueriesByTask[selectedTask.taskId] ?? '').trim()
    if (!query) { setPptSourceStatusByTask(current => ({ ...current, [selectedTask.taskId]: '请先填写搜索主题。' })); return }
    if (typeof globalThis.confirm !== 'function' || !globalThis.confirm(`将把以下查询发送给 DSH Host 的网页搜索服务：\n\n${query}\n\n是否继续？`)) return
    const task = selectedTask
    const controller = new AbortController()
    pptSourceRequestRef.current = { taskId: task.taskId, controller }
    setPptSourceStatusByTask(current => ({ ...current, [task.taskId]: '正在搜索网页来源…' }))
    try {
      const request = { projectId: task.projectId, taskId: task.taskId, conversationId, query, confirmed: true }
      const probe = !pptVerifiedWebByTask[task.taskId]?.search
      let response: { query: string; sources: PptSourceCandidate[]; truncated: boolean; selectedByUser: false; status: string }
      try {
        response = unwrapRemote(await remote.searchPptSources({ ...request, probe }, controller.signal))
      } catch (error) {
        // Host 重启会重置会话探测状态；该错误在搜索副作用前返回，可安全用同一已确认请求重新探测。
        if (probe || (error as { code?: string } | null)?.code !== 'capability_unverified' || controller.signal.aborted) throw error
        response = unwrapRemote(await remote.searchPptSources({ ...request, probe: true }, controller.signal))
      }
      if (controller.signal.aborted) throw Object.assign(new Error('用户取消网页来源搜索'), { code: 'cancelled' })
      setPptVerifiedWebByTask(current => ({ ...current, [task.taskId]: { search: true, fetch: current[task.taskId]?.fetch === true } }))
      setPptSourcesByTask(current => ({ ...current, [task.taskId]: response.sources }))
      setPptSourceStatusByTask(current => ({ ...current, [task.taskId]: `搜索完成：${response.sources.length} 条候选来源${response.truncated ? '（结果已截断）' : ''}。候选摘录尚未加入任务材料。` }))
    } catch (error) {
      setPptSourceStatusByTask(current => ({ ...current, [task.taskId]: controller.signal.aborted ? '已取消网页来源搜索。' : `网页来源搜索失败：${error instanceof Error ? error.message : String(error)}` }))
    } finally {
      if (pptSourceRequestRef.current?.controller === controller) pptSourceRequestRef.current = null
    }
  }

  function cancelPptSourceSearch() {
    const active = pptSourceRequestRef.current
    if (!active) return
    active.controller.abort(new Error('用户取消网页来源请求'))
    pptSourceRequestRef.current = null
    setPptSourceStatusByTask(current => ({ ...current, [active.taskId]: '已取消网页来源请求；未完成的结果不会加入材料。' }))
  }

  async function addPptSourceMaterial(source: PptSourceCandidate) {
    if (!selectedTask || selectedTask.domain !== 'ppt' || !conversationId.trim()) return
    if (typeof globalThis.confirm !== 'function' || !globalThis.confirm(`将读取此网页并提取最多 30,000 字符作为不可信摘录：\n\n${source.title || source.url}\n${source.url}\n\n网页内容不会执行；读取结果默认不选用。是否继续？`)) return
    const task = selectedTask
    const controller = new AbortController()
    pptSourceRequestRef.current = { taskId: task.taskId, controller }
    setPptSourceStatusByTask(current => ({ ...current, [task.taskId]: `正在读取来源：${source.title || source.url}` }))
    try {
      const probe = !pptVerifiedWebByTask[task.taskId]?.fetch
      const request = { projectId: task.projectId, taskId: task.taskId, conversationId, url: source.url, confirmed: true }
      let response: { url: string; statusCode: number; excerpt: string; truncated: boolean; trust: 'untrusted'; scriptsExecuted: false }
      try {
        response = unwrapRemote(await remote.fetchPptSource({ ...request, probe }, controller.signal))
      } catch (error) {
        if (probe || (error as { code?: string } | null)?.code !== 'capability_unverified' || controller.signal.aborted) throw error
        response = unwrapRemote(await remote.fetchPptSource({ ...request, probe: true }, controller.signal))
      }
      if (controller.signal.aborted) throw Object.assign(new Error('用户取消网页来源读取'), { code: 'cancelled' })
      setPptVerifiedWebByTask(current => ({ ...current, [task.taskId]: { search: current[task.taskId]?.search === true, fetch: true } }))
      const material: TaskMaterial = {
        id: source.id,
        sourceId: source.id,
        title: source.title || response.url,
        purpose: 'research',
        excerpt: response.excerpt,
        url: response.url,
        selected: false,
        verificationStatus: 'unverified',
        sourceType: 'web',
        contentStatus: 'parsed',
        extractedCharacterCount: response.excerpt.length,
        truncated: response.truncated,
      }
      setMaterialDraftsByTask(current => {
        const previous = current[task.taskId] ?? task.materials ?? []
        if (previous.some(item => item.sourceId === source.id || item.url === response.url)) return current
        return { ...current, [task.taskId]: [...previous, material] }
      })
      setPptSourceStatusByTask(current => ({ ...current, [task.taskId]: `已加入未选用材料草稿：${material.title}。核对摘录后，勾选并保存才会用于提示词。${response.truncated ? ' 来源内容已截断。' : ''}` }))
    } catch (error) {
      setPptSourceStatusByTask(current => ({ ...current, [task.taskId]: controller.signal.aborted ? '已取消网页来源读取；材料草稿未变更。' : `网页来源读取失败：${error instanceof Error ? error.message : String(error)}` }))
    } finally {
      if (pptSourceRequestRef.current?.controller === controller) pptSourceRequestRef.current = null
    }
  }

  function updateMaterialDraft(task: Task, value: string) {
    const existingMaterials = materialDraftsByTask[task.taskId] ?? task.materials ?? []
    const materials = value.split(/\r?\n/).filter(Boolean).map((line, index) => {
      const [purpose = 'content', title = `材料 ${index + 1}`, ...tail] = line.split('|')
      const url = tail.length > 1 ? tail.pop() ?? '' : ''
      const excerpt = tail.join('|')
      const previous = existingMaterials[index] ?? {}
      const supportedPurpose = ['content', 'style', 'both', 'research', 'reference'].includes(purpose) ? purpose : 'content'
      return { ...previous, id: previous.id ?? previous.sourceId ?? `material-${index + 1}`, purpose: supportedPurpose, title, excerpt, url: url || undefined } satisfies TaskMaterial
    })
    setMaterialDraftsByTask(current => ({ ...current, [task.taskId]: materials }))
  }

  async function importMaterialFiles(files: FileList | File[] | null) {
    if (!selectedTask || !files?.length) return
    const taskAtStart = selectedTask
    const controller = new AbortController()
    materialImportRef.current = controller
    setMaterialImporting(true)
    setBusy(true)
    setMaterialImportMessage(`正在读取 ${files.length} 个用户选择的材料文件…`)
    try {
      const result = await importSelectedTextMaterials(files, {
        purpose: materialPurpose,
        signal: controller.signal,
        readText: readSelectedFileText,
        parseFile: (file, options) => uploadAndParseSelectedFile(file, { ...options, remote, readBytes: readSelectedFileBytes }),
        createId: () => globalThis.crypto.randomUUID(),
      })
      if (controller.signal.aborted) throw Object.assign(new Error('材料导入已取消'), { code: 'cancelled' })
      if (result.materials.length) {
        const previous = materialDraftsByTask[taskAtStart.taskId] ?? taskAtStart.materials ?? []
        setMaterialDraftsByTask(current => ({ ...current, [taskAtStart.taskId]: [...previous, ...result.materials] }))
      }
      const failures = result.failures.map(item => `${item.fileName}（${item.code}）`).join('；')
      setMaterialImportMessage(`读取完成：新增 ${result.materials.length} 条未默认选用的材料${failures ? `；失败 ${result.failures.length} 条：${failures}` : ''}。保存后才写入任务。`)
    } catch (error) {
      setMaterialImportMessage(error instanceof Error && (error as any).code === 'cancelled' ? '已取消读取；本批次临时内容已丢弃，原材料保持不变。' : `材料读取失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (materialImportRef.current === controller) materialImportRef.current = null
      setMaterialImporting(false)
      setBusy(false)
    }
  }

  async function importWorkspaceDirectoryMaterials() {
    if (!selectedTask || selectedTask.domain !== 'writing') return
    if (typeof workspaceFiles?.list !== 'function' || typeof workspaceFiles?.read !== 'function') { setMaterialImportMessage('当前 DSH Host 未提供可用的 workspaceFiles.list/read；目录材料入口不可用。'); return }
    if (!conversationId.trim()) { setMaterialImportMessage('请先建立当前 DSH 对话，再读取其工作区目录。'); return }
    const taskAtStart = selectedTask
    const controller = new AbortController()
    materialImportRef.current?.abort(new Error('开始新的材料读取'))
    materialImportRef.current = controller
    setMaterialImporting(true)
    setBusy(true)
    setMaterialImportMessage(`正在读取当前 DSH Session 的指定目录：${workspaceMaterialDirectory}…`)
    try {
      const snapshot = await browseWorkspaceDirectory(workspaceFiles, {
        sessionId: conversationId,
        directoryPath: workspaceMaterialDirectory,
        signal: controller.signal,
      })
      if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('操作已取消', 'AbortError')
      const imported = await workspaceFilesToWritingMaterials(snapshot, { purpose: materialPurpose })
      if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('操作已取消', 'AbortError')
      const previous = materialDraftsByTask[taskAtStart.taskId] ?? taskAtStart.materials ?? []
      const byId = new Map(previous.map(material => [material.sourceId ?? material.id, material]))
      for (const material of imported) byId.set(material.sourceId ?? material.id, material)
      const merged = [...byId.values()]
      setMaterialDraftsByTask(current => ({ ...current, [taskAtStart.taskId]: merged }))
      setMaterialImportMessage(`已读取 ${imported.length} 个文件（${snapshot.bytes} 字节）；新增或刷新内容均默认未选用，核验并保存前不会写入任务。${imported.some(item => item.truncated) ? ' 超过 30,000 字符的摘录已截断。' : ''}`)
    } catch (error) {
      const cancelled = controller.signal.aborted || (error as Error)?.name === 'AbortError'
      setMaterialImportMessage(cancelled ? '已取消目录读取；本批材料草稿未变更。' : `目录材料读取失败；既有材料保持不变：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (materialImportRef.current === controller) materialImportRef.current = null
      setMaterialImporting(false)
      setBusy(false)
    }
  }

  function cancelMaterialImport() {
    materialImportRef.current?.abort(new Error('用户取消材料读取'))
  }
  function updateMaterialSelection(task: Task, index: number, selected: boolean) {
    const materials = materialDraftsByTask[task.taskId] ?? task.materials ?? []
    setMaterialDraftsByTask(current => ({ ...current, [task.taskId]: materials.map((material, itemIndex) => itemIndex === index ? { ...material, selected } : material) }))
  }
  async function saveMethodDraft(override?: TaskMethodState): Promise<Task | false | undefined> {
    if (!selectedTask || !conversationId.trim()) { setResult('请先选择当前任务和对话。'); return false }
    const draft = override ?? methodDraftsByTask[selectedTask.taskId] ?? selectedTask.methodState
    if (!draft) return false
    const currentRequirements = (requirementsDraftsByTask[selectedTask.taskId] ?? (selectedTask.currentRequirements ?? []).join('\n'))
      .split(/\r?\n/u).map(item => item.trim()).filter(Boolean)
    const next = {
      ...draft,
      currentOverrides: deriveCurrentOverrides({ ...selectedTask, currentRequirements, methodState: draft }),
    }
    if (selectedTask.domain === 'ppt' && next.ppt?.brief?.durationMinutes !== undefined && (!Number.isFinite(next.ppt.brief.durationMinutes) || next.ppt.brief.durationMinutes <= 0)) {
      return setResult('PPT 演讲时长必须为正数；表单草稿仍保留。')
    }
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.updateTask({
        projectId: selectedTask.projectId,
        taskId: selectedTask.taskId,
        taskRevision: selectedTask.revision,
        conversationId,
        patch: { currentRequirements, methodState: next, materials: materialDraftsByTask[selectedTask.taskId] ?? selectedTask.materials },
        eventId: globalThis.crypto.randomUUID(),
      }))
      setTasks(current => current.map(task => task.taskId === response.task.taskId ? response.task : task))
      setMethodDraftsByTask(current => ({ ...current, [response.task.taskId]: response.task.methodState }))
      setRequirementsDraftsByTask(current => ({ ...current, [response.task.taskId]: (response.task.currentRequirements ?? []).join('\n') }))
      setMaterialDraftsByTask(current => ({ ...current, [response.task.taskId]: response.task.materials }))
      setResult('领域状态已保存；已有提示词和下游规划不会被自动视为最新。')
      return response.task
    } catch (error) {
      setResult(`领域状态保存失败，编辑仍保留：${error instanceof Error ? error.message : String(error)}`)
      return false
    } finally { setBusy(false) }
  }

  async function loadWritingCoverage() {
    if (!selectedTask) return
    setBusy(true)
    try {
      const result = unwrapRemote(await remote.getWritingMaterialCoverage({ articleId: selectedTask.taskId }))
      setWritingCoverage(result)
      setResult(result.summary ? '已读回写作材料覆盖状态。' : '当前文章尚无覆盖快照；可按本任务明确选用的材料建立范围。')
    } catch (error) { setResult(`读取材料覆盖失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function initializeWritingCoverage() {
    if (!selectedTask) return
    const items = taskMaterials.filter(material => material.selected !== false).map((material, index) => ({
      id: String(material.sourceId ?? material.id ?? `material-${index + 1}`),
      title: String(material.title ?? `材料 ${index + 1}`),
      sourceVersion: String(material.sourceVersion ?? ''),
    }))
    if (!items.length) { setResult('请先明确选用至少一条材料，再创建覆盖范围。'); return }
    setBusy(true)
    try {
      const result = unwrapRemote(await remote.initializeWritingMaterialCoverage({
        articleId: selectedTask.taskId, genre: writingGenre,
        goal: String(writingState.article?.goal ?? selectedTask.originalInput), items,
      }))
      setWritingCoverage(result)
      setResult(`已建立 ${items.length} 条所选材料的覆盖范围；没有扫描其它资料。`)
    } catch (error) { setResult(`建立材料覆盖范围失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function applyWritingCoverageAction(action: string, extra: Record<string, unknown> = {}) {
    if (!selectedTask) return
    setBusy(true)
    try {
      const result = unwrapRemote(await remote.applyWritingMaterialCoverageAction({
        articleId: selectedTask.taskId, action, ...extra,
      }))
      setWritingCoverage(result)
      setResult('材料覆盖状态已保存。')
    } catch (error) { setResult(`更新材料覆盖失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }
  async function startWritingRound() {
    if (!selectedTask) return
    const writing = methodDraftsByTask[selectedTask.taskId]?.writing ?? selectedTask.methodState?.writing ?? {}
    const current = writing.round
    const genre = writing.article?.genre ?? 'article'
    const config = writingGenres.find(item => item.genre === genre)
    const round = { id: globalThis.crypto.randomUUID(), parentRoundId: current?.id, taskType: config?.taskTypes?.[0], draft: current?.draft ?? '', feedback: '', packSelections: current?.packSelections ?? [] }
    const next = { ...(methodDraftsByTask[selectedTask.taskId] ?? selectedTask.methodState ?? {}), writing: { ...writing, roundHistory: [...(writing.roundHistory ?? []), ...(current?.id ? [current] : [])].slice(-20), round } }
    updateMethodDraft(selectedTask, next)
    await saveMethodDraft(next)
  }

  async function previewWritingPackSelection() {
    if (!selectedTask) return
    setBusy(true)
    try {
      const writing = methodDraftsByTask[selectedTask.taskId]?.writing ?? selectedTask.methodState?.writing ?? {}
      const genre = writing.article?.genre ?? 'article'
      const round = writing.round ?? {}
      const result = unwrapRemote(await remote.previewWritingPackSnapshot({ genre, taskType: round.taskType, selectedIds: round.packSelections ?? [] }))
      const next = { ...(methodDraftsByTask[selectedTask.taskId] ?? selectedTask.methodState ?? {}), writing: { ...writing, round: { ...round, packSnapshot: result.snapshot } } }
      const saved = await saveMethodDraft(next)
      if (!saved) {
        setResult('快照预览已生成，但保存失败；本轮仍未冻结，当前选择已保留。')
        return
      }
      setResult(`本轮已冻结 ${result.snapshot.packs.length} 个专业包；跳过 ${result.snapshot.skipped.length} 项。`)
    } catch (error) {
      setResult(`预览专业包失败，当前选择仍保留：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function loadTasks() {
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.listTasks({ cwd, archived: showArchived }))
      try { setWritingGenres(unwrapRemote(await remote.listWritingGenres()).genres) } catch { /* Host 不支持文体目录时保留基础文体选项。 */ }
      try { setWritingPacks(unwrapRemote(await remote.listWritingPacks()).packs) } catch { setWritingPacks([]) }
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
      setPptPreviewPageIndex(0)
      setPptFeedbackPageIndex(0)
      setPptFeedbackTarget(null)
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
      setPptPreviewPageIndex(0)
      setPptFeedbackPageIndex(0)
      setPptFeedbackTarget(null)
      dispatchClient({ type: 'task.selected', taskId: response.task.taskId })
      setResult(`任务已保存：${response.task.title}`)
    } catch (error) { setResult(`创建任务失败：${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(false) }
  }

  async function selectTask(taskId: string) {
    cancelPptPageImageRead()
    cancelPptUnderstanding()
    if (pptSourceRequestRef.current && pptSourceRequestRef.current.taskId !== taskId) cancelPptSourceSearch()
    if (!taskId) {
      setSelectedTaskId('')
      setPptPreviewPageIndex(0)
      setPptFeedbackPageIndex(0)
      setPptFeedbackTarget(null)
      setDeleteImpact(null)
      dispatchClient({ type: 'task.selected', taskId: '' })
      return
    }
    if (!projectId || !conversationId) return
    const selected = tasks.find(task => task.taskId === taskId)
    if (!selected) return
    setBusy(true)
    try {
      unwrapRemote(await remote.bindTask({ projectId, taskId, conversationId, eventId: globalThis.crypto.randomUUID() }))
      setSelectedTaskId(taskId)
      setPptPreviewPageIndex(0)
      setPptFeedbackPageIndex(0)
      setPptFeedbackTarget(null)
      setDeleteImpact(null)
      dispatchClient({ type: 'task.selected', taskId })
      setResult(`已切换到任务：${selected.title}`)
    } catch (error) {
      setResult(`切换任务失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
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
      setClearLearned(false)
      const response = unwrapRemote(await remote.previewDeleteTask({ projectId: selectedTask.projectId, taskId: selectedTask.taskId, taskRevision: selectedTask.revision, conversationId, clearLearned: false }))
      setDeleteImpact(response.impact)
    } catch (error) { setResult(`读取删除影响失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function updateDeleteLearned(value: boolean) {
    if (!selectedTask || !conversationId.trim()) return
    setClearLearned(value)
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.previewDeleteTask({ projectId: selectedTask.projectId, taskId: selectedTask.taskId, taskRevision: selectedTask.revision, conversationId, clearLearned: value }))
      setDeleteImpact(response.impact)
    } catch (error) { setResult(`更新删除影响失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function confirmDeleteTask() {
    if (!selectedTask || !conversationId.trim()) return
    setBusy(true)
    try {
      unwrapRemote(await remote.deleteTask({ projectId: selectedTask.projectId, taskId: selectedTask.taskId, taskRevision: selectedTask.revision, conversationId, confirmed: true, clearLearned, eventId: globalThis.crypto.randomUUID() }))
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
      setClearLearned(false)
      setResult(draftCleanupFailed ? '任务已删除，但本机草稿未能清理。' : '任务已删除。')
    } catch (error) { setResult(`删除失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }
  async function loadHostCapabilities() {
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.getHostCapabilities())
      const hasWorkspaceDirectory = typeof workspaceFiles?.list === 'function' && typeof workspaceFiles?.read === 'function'
      setHostCapabilities(response.capabilities.map(item => item.id === 'directory' && hasWorkspaceDirectory
        ? { ...item, status: 'available' as const, detail: '当前 DSH Session 提供只读 workspaceFiles.list/read；仅在用户指定目录后读取' }
        : item))
      setResult('已读取 Host 与 Client 的能力状态；未连接的能力保持不可用，不会触发外部请求。')
    } catch (error) { setResult(`读取 Host 能力失败：${error instanceof Error ? error.message : String(error)}`) }
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

  async function saveTaskReview() {
    if (!selectedTask || !conversationId.trim()) return setResult('请先选择当前任务和对话。')
    const externalVersions = selectedTask.versions.filter(version => version.kind === 'external-result')
    const reviewedResult = externalVersions.find(version => version.versionId === reviewResultIdsByTask[selectedTask.taskId]) ?? externalVersions.at(-1)
    if (!reviewedResult?.promptVersionId) return setResult('该外部结果没有有效的提示词版本关联，不能记录复盘。')
    const checks = selectedTask.currentRequirements.map(requirement => ({ requirement, result: reviewCheckResultsByTask[selectedTask.taskId]?.[requirement] ?? 'not-checked' as const }))
    if (reviewVerdict === 'success' && checks.some(check => check.result !== 'pass')) return setResult('确认成功前，请将每条适用要求标记为“通过”；当前输入已保留。')
    if (reviewVerdict === 'failure' && checks.length > 0 && !checks.some(check => check.result === 'fail')) return setResult('确认失败前，请至少将一条适用要求标记为“未通过”；当前输入已保留。')
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.saveReview({
        projectId: selectedTask.projectId,
        taskId: selectedTask.taskId,
        taskRevision: selectedTask.revision,
        conversationId,
        resultVersionId: reviewedResult.versionId,
        promptVersionId: reviewedResult.promptVersionId,
        verdict: reviewVerdict,
        checks,
        feedback: reviewedResult.feedback ?? '',
        confirmed: reviewVerdict !== 'unverified',
        eventId: globalThis.crypto.randomUUID(),
      }))
      setTasks(current => current.map(task => task.taskId === response.task.taskId ? response.task : task))
      setResult(`复盘已保存：${response.review.verdict}${response.review.confirmed ? '（用户已确认）' : '（待验证）'}。`)
    } catch (error) {
      setResult(`复盘保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function savePromptRevision() {
    if (!selectedTask || !editablePromptVersion || !conversationId.trim()) return setResult('请先选择任务、对话和已有提示词版本。')
    if (!promptEditorContent.trim()) return setResult('提示词正文不能为空；编辑草稿仍保留。')
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.savePromptRevision({
        projectId: selectedTask.projectId,
        taskId: selectedTask.taskId,
        taskRevision: selectedTask.revision,
        conversationId,
        stepId: editablePromptVersion.stepId ?? 'task',
        sourceVersionId: editablePromptVersion.versionId,
        content: promptEditorContent,
        eventId: globalThis.crypto.randomUUID(),
      }))
      setTasks(current => current.map(task => task.taskId === response.task.taskId ? response.task : task))
      setPromptEditorDraftsByTask(current => ({ ...current, [response.task.taskId]: response.version.content }))
      setResult(`提示词已保存为新版本 ${response.version.versionId.slice(0, 8)}；旧版本保留。`)
    } catch (error) {
      setResult(`提示词新版本保存失败，草稿仍保留：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function copyPromptDraft() {
    if (!promptEditorContent.trim()) return setResult('提示词正文为空，无法复制。')
    const copied = await copyText(promptEditorContent)
    setResult(copied
      ? '已复制当前提示词编辑稿。'
      : '复制失败；编辑稿仍保留在文本框中，请手动选择复制。')
  }

  async function copyUnsavedRunOutput() {
    const content = clientState.outputByTask[selectedTaskId]
    if (!content) return
    const copied = await copyText(content)
    setResult(copied ? '已复制未保存的生成草稿。' : '复制失败；未保存草稿仍显示在当前任务中。')
  }

  async function changeResearch(action: 'preview' | 'approve' | 'reject' | 'cancel' | 'run') {
    if (!selectedTask || !conversationId.trim()) return
    setBusy(true)
    const previousAgent = selectedTask.agent ?? { id: selectedTask.taskId, type: selectedTask.entryType, goal: selectedTask.originalInput }
    try {
      if (action === 'run') {
        const controller = new AbortController()
        researchSearchRef.current = controller
        setResearchSearchActive(true)
        const response = unwrapRemote(await remote.runApprovedResearch({ taskId: selectedTask.taskId }, controller.signal))
        setTasks(current => current.map(task => task.taskId === response.task.taskId ? response.task : task))
        setResult(response.task.agent?.research?.message ?? '联网研究已完成。')
        return
      }
      const nextTask = action === 'preview'
        ? requestResearch(selectedTask, { objective: selectedTask.originalInput, queries: [selectedTask.originalInput] })
        : action === 'approve' ? approveResearch(selectedTask) : action === 'reject' ? rejectResearch(selectedTask) : cancelResearch(selectedTask)
      const response = unwrapRemote(await remote.updateTask({
        projectId: selectedTask.projectId,
        taskId: selectedTask.taskId,
        taskRevision: selectedTask.revision,
        conversationId,
        patch: { agent: { ...previousAgent, ...nextTask.agent } },
        eventId: globalThis.crypto.randomUUID(),
      }))
      setTasks(current => current.map(task => task.taskId === response.task.taskId ? response.task : task))
      setResult(action === 'preview' ? '研究范围已保存，等待你确认；尚未搜索。' : action === 'approve' ? response.task.agent.research?.message ?? '研究已批准但未执行。' : action === 'reject' ? '已拒绝联网研究，本任务不会再次申请。' : '已取消当前研究确认。')
    } catch (error) {
      setResult(`研究状态未能保存：${error instanceof Error ? error.message : String(error)}`)
    }
    finally {
      if (action === 'run') { researchSearchRef.current = null; setResearchSearchActive(false) }
      setBusy(false)
    }
  }
  async function runCurrentTask(stageOverride = stage, taskRevision = selectedTask?.revision) {
    if (!selectedTask || !conversationId) return setResult('请先选择一个任务并填写当前对话标识。')
    if (!provider || !model) return setResult('请先明确选择模型提供方和模型。')
    if (includeKnowledge && !knowledgePreviewDigest) return setResult('请先预览当前选择的资料，再确认将其用于本轮。')
    const requestId = globalThis.crypto.randomUUID()
    const controller = new AbortController()
    const run: ActiveRun = { taskId: selectedTask.taskId, requestId, controller, cancelled: false }
    activeRunRef.current = run
    dispatchClient({ type: 'request.started', taskId: run.taskId, requestId })
    setRunningRequest(requestId)
    setBusy(true)
    try {
      const response = unwrapRemote(await remote.runTask({ taskId: selectedTask.taskId, taskRevision, stage: stageOverride, requestId, projectId: selectedTask.projectId, conversationId, provider, model, includeKnowledge, ...(includeKnowledge ? { expectedKnowledgeDigest: knowledgePreviewDigest } : {}) }, controller.signal))
      setTasks(current => current.map(task => task.taskId === response.task.taskId ? response.task : task))
      if (activeRunRef.current !== run) {
        dispatchClient({ type: 'request.late', taskId: run.taskId, requestId, output: response.version?.content ?? '迟到的任务响应已忽略。' })
        return
      }
      if (run.cancelled) {
        dispatchClient({ type: 'request.cancelled', taskId: run.taskId, requestId, output: '当前任务已取消。' })
        setResult('当前任务已取消。')
        return
      }
      if (!response.saved && response.unsavedDraft?.content) {
        dispatchClient({ type: 'request.unsaved', taskId: run.taskId, requestId, output: response.unsavedDraft.content })
        setResult('模型已返回结果，但任务保存失败；草稿仍保留在本任务面板。')
        return
      }
      const output = response.version?.memoryRevisionChanged
        ? `生成期间使用的长期记忆已更新或撤销；本版本仍基于请求开始时的记忆快照。请按最新记忆重新生成后再确认结果。\n\n${response.version.content}`
        : response.version?.content ?? '任务已完成。'
      dispatchClient({ type: 'request.completed', taskId: run.taskId, requestId, output })
      setResult(output)
      return output
    } catch (error) {
      if (activeRunRef.current !== run) {
        dispatchClient({ type: 'request.late', taskId: run.taskId, requestId, output: '迟到的任务错误已忽略。' })
        return
      }
      const output = run.cancelled ? '当前任务已取消。' : `运行失败：${error instanceof Error ? error.message : String(error)}`
      dispatchClient({ type: run.cancelled ? 'request.cancelled' : 'request.failed', taskId: run.taskId, requestId, output })
      setResult(output)
    } finally {
      if (activeRunRef.current === run) {
        activeRunRef.current = null
        setRunningRequest('')
        setBusy(false)
      }
    }
  }

  async function understandPptImage(imageIndex: number) {
    if (!selectedTask || !provider || !model) { setResult('请先选择任务、模型提供方和模型，再发送当前页图像生成理解草稿。'); return }
    const taskId = selectedTask.taskId
    const pageIndex = pptActivePreviewIndex
    cancelPptUnderstanding()
    const savedTask = await saveMethodDraft()
    if (!savedTask || typeof savedTask !== 'object' || savedTask.taskId !== taskId) return
    const slide = savedTask.methodState?.ppt?.outline?.slides?.[pageIndex]
    if (!slide) { setResult(`第 ${pageIndex + 1} 页未包含在已保存的大纲中，请重新读取页面后再理解。`); return }
    const controller = new AbortController()
    pptUnderstandingRequestRef.current = controller
    setBusy(true)
    setResult(`正在将第 ${pageIndex + 1} 页图像发送给所选模型分析；图像仅在此操作中发送。`)
    try {
      const imageIndices = imageIndex < 0 ? listPptPageImages(slide).map((_, index) => index) : [imageIndex]
      const contentSnapshot = pptUnderstandingSnapshot(slide, imageIndices)
      const result = unwrapRemote(await remote.understandPptPage({ projectId: savedTask.projectId, taskId, taskRevision: savedTask.revision, conversationId, pageIndex, ...(imageIndices.length === 1 ? { imageIndex: imageIndices[0] } : { imageIndices }), provider, model }, controller.signal))
      if (pptUnderstandingRequestRef.current === controller) {
        if (pptUnderstandingSnapshot(pptSlidesRef.current[pageIndex], imageIndices) !== contentSnapshot) {
          setResult('页面标题、正文或发送图像已变化；旧页面理解结果已丢弃，请重新理解。')
        } else {
          setPptUnderstandingDraft({ taskId, pageIndex, imageIndex, imageCount: imageIndices.length, imageIndices, contentSnapshot, text: result.visualDescription })
        }
      }
    } catch (error) {
      if (pptUnderstandingRequestRef.current === controller) setResult(controller.signal.aborted ? '页面图像理解已取消；现有页面备注未修改。' : `页面图像理解失败：${error instanceof Error ? error.message : String(error)}；现有页面备注未修改。`)
    } finally {
      if (pptUnderstandingRequestRef.current === controller) {
        pptUnderstandingRequestRef.current = null
        setBusy(false)
      }
    }
  }

  function applyPptUnderstandingDraft() {
    if (!selectedTask || !pptUnderstandingDraft || pptUnderstandingDraft.taskId !== selectedTask.taskId || pptUnderstandingDraft.pageIndex !== pptActivePreviewIndex) return
    if (pptUnderstandingSnapshot(pptSlidesRef.current[pptActivePreviewIndex], pptUnderstandingDraft.imageIndices) !== pptUnderstandingDraft.contentSnapshot) {
      setPptUnderstandingDraft(null)
      setResult('页面标题、正文或发送图像已变化；旧页面理解结果已丢弃，请重新理解。')
      return
    }
    const slides = [...pptSlides]
    const current = slides[pptActivePreviewIndex]
    if (!current) return
    slides[pptActivePreviewIndex] = { ...current, modelVisualDescription: pptUnderstandingDraft.text.trim() }
    updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, outline: { ...pptState.outline, slides } } })
    setPptUnderstandingDraft(null)
    setResult('已将模型理解保存到独立字段；请核对后再生成逐页修改提示词。')
  }

  async function generatePptModificationPrompt() {
    if (!selectedTask || !hasCurrentPptFeedback) return
    if (!provider || !model) { setResult('请先选择模型提供方和模型，再生成逐页修改提示词。'); return }
    const next = { ...methodState, ppt: { ...pptState, stage: 'visual-feedback' } }
    const savedTask = await saveMethodDraft(next)
    if (!savedTask || typeof savedTask !== 'object') return
    setStage('step-prompt')
    await runCurrentTask('step-prompt', savedTask.revision)
  }

  async function cancelCurrentTask() {
    const run = activeRunRef.current
    if (!run || !runningRequest) return
    try {
      const result = unwrapRemote(await remote.cancelTask({ requestId: run.requestId }))
      if (result.cancelled) {
        run.cancelled = true
        run.controller.abort()
        setResult('已请求取消当前任务。')
      } else {
        setResult('当前任务已结束。')
      }
    } catch (error) { setResult(`取消失败：${error instanceof Error ? error.message : String(error)}`) }
  }

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

  const pptFieldStyle = { display: 'grid', gap: 5, minWidth: 0, width: '100%', margin: '8px 0' }

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
  h('style', null, 'main { box-sizing: border-box; max-width: 100%; } main, main * { box-sizing: border-box; } main label { display: grid; gap: 5px; min-width: 0; } main input, main select, main textarea { width: 100%; max-width: 100%; min-width: 0; } main textarea { resize: vertical; } main > label, main > section > label, #workspace-tasks > label { width: 100%; margin: 8px 0; } main > div, #workspace-tasks > div { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; margin: 8px 0; } main > div > label, #workspace-tasks > div > label { flex: 1 1 200px; } main > section, #workspace-tasks > section { display: grid; gap: 8px; min-width: 0; margin: 16px 0; } main button { max-width: 100%; white-space: normal; } main pre { max-width: 100%; overflow-wrap: anywhere; } @media (max-width: 480px) { main { padding: 16px !important; } main > div > label, #workspace-tasks > div > label { flex-basis: 100%; } }'),
  h('h1', { style: { margin: '0 0 12px', fontSize: '20px' } }, '向前一步'),
  h('p', { style: { margin: '0 0 8px' } }, 'DSH 原生侧栏任务工作区'),
  h('p', { style: { margin: '0 0 16px', color: 'var(--dsw-alias-label-secondary)' } }, '任务独立保存，切换对话和重启后可继续。首版生成规划与外部 AI 执行提示词。'),
  h('nav', { 'aria-label': '工作区导航', style: { display: 'flex', flexWrap: 'wrap', gap: '8px', position: 'sticky', top: 0, zIndex: 2, padding: '8px 0', background: 'var(--dsw-alias-background-primary)' } },
    ...[
      ['#workspace-tasks', '任务'],
      ['#workspace-references', '资料'],
      ['#workspace-assets', '提示词与写作'],
      ['#workspace-domains', '学术与社媒'],
      ['#workspace-settings', '设置'],
      ['#workspace-migration', '备份与迁移'],
    ].map(([href, label]) => h('a', { key: href, href, style: { color: 'var(--dsw-alias-label-primary)' } }, label))),
  h('div', { id: 'workspace-settings', style: { display: 'block', scrollMarginTop: '56px' } },
    h(SettingsPanel, { remote: remote as SettingsRemote, onSaved: (preferences: PluginPreferences, availableProviders: { id: string; name: string }[], availableModels: { id: string; name: string; provider: string }[]) => { setEntryType(preferences.defaultEntryType); setDomain(preferences.defaultDomain); setProviders(availableProviders); if (preferences.preferredProvider) { setProvider(preferences.preferredProvider); setModel(preferences.preferredModel); setModels(availableModels) } } })),
  h('div', { id: 'workspace-migration', style: { display: 'block', scrollMarginTop: '56px' } },
    h(MigrationPanel, { remote: remote as MigrationRemote }),
    h(BackupPanel, { remote: remote as BackupRemote })),
  h('div', { id: 'workspace-references', style: { display: 'block', scrollMarginTop: '56px' } },
    h(KnowledgePanel, { key: conversationId, remote: remote as KnowledgeRemote, sessionId: conversationId, workspaceFiles, onContextPreview: (digest: string | null) => { setKnowledgePreviewDigest(digest ?? ''); if (!digest) setIncludeKnowledge(false) } }),
    h(ExternalReferencesPanel)),
  h('div', { id: 'workspace-assets', style: { display: 'block', scrollMarginTop: '56px' } },
    h(AssetsPanel, { remote, onSelectDomain: setDomain }),
    h(WritingPacksPanel, { remote }),
    h(WritingWorkspacePanel, { remote, projectId: selectedTask?.projectId, taskId: selectedTask?.taskId })),
  h('div', { id: 'workspace-domains', style: { display: 'block', scrollMarginTop: '56px' } },
    h(DomainWorkbenchesPanel, { remote, provider, model })),
  h('div', { id: 'workspace-tasks', style: { display: 'block', scrollMarginTop: '56px' } },
  h('label', null, '项目目录 ', h('input', { value: cwd, disabled: busy, placeholder: '例如 D:/work/project', onChange: (event: any) => { setCwd(event.target.value); setCwdLoaded(false); setSessionLoaded(false); setSelectedTaskId('') } })),
  h('label', null, '当前对话标识 ', h('input', { value: conversationId, disabled: busy, placeholder: '粘贴当前 DSH 对话 ID', onChange: (event: any) => { setConversationId(event.target.value); setSessionLoaded(false); setSelectedTaskId('') } })),
  h('div', null,
    h('label', null, '入口 ', h('select', { value: entryType, onChange: (event: any) => setEntryType(event.target.value) }, ...[['advance-idea','推进想法'],['optimize-prompt','优化提示词'],['diagnose-ai-result','诊断 AI 结果']].map(([value,label]) => h('option', { key: value, value }, label)))),
    h('label', null, '领域 ', h('select', { value: domain, onChange: (event: any) => setDomain(event.target.value) }, ...[['general','通用'],['writing','写作'],['ppt','PPT']].map(([value,label]) => h('option', { key: value, value }, label)))),
  ),
  (!cwd.trim() || !conversationId.trim()) ? h('small', { role: 'status' }, '创建任务前请填写项目目录和当前 DSH 对话标识。') : null,
  h('div', null, h('button', { type: 'button', disabled: busy || !cwd.trim() || !conversationId.trim(), onClick: loadTasks }, '读取项目任务'), h('button', { type: 'button', disabled: busy || !cwd.trim() || !conversationId.trim() || !input.trim(), onClick: createTask }, '创建任务')),
  h('div', null,
    h('span', { role: 'status' }, `当前列表：${showArchived ? '归档' : '未归档'}任务`),
    h('button', { type: 'button', disabled: busy || !cwd.trim(), onClick: () => { setShowArchived(value => !value); setSelectedTaskId(''); setTasks([]) } }, showArchived ? '切换到未归档任务' : '切换到归档任务'),
  ),
  h('label', null, '任务 ', h('select', { value: selectedTaskId, disabled: busy, onChange: (event: any) => void selectTask(event.target.value) }, h('option', { value: '' }, '选择任务'), ...tasks.map(task => h('option', { key: task.taskId, value: task.taskId }, `${task.title} · ${task.domain}`)))),
  selectedTask ? h('section', null,
    h('label', null, '任务名称 ', h('input', { value: renameDraft, onChange: (event: any) => { dispatchClient({ type: 'draft.changed', taskId: selectedTask.taskId, draft: event.target.value }); persistTaskDraft(selectedTask.taskId, { title: event.target.value }) } })),
    h('button', { type: 'button', disabled: busy || !renameDraft.trim() || renameDraft.trim() === selectedTask.title, onClick: saveTaskTitle }, '保存名称'),
    clientState.saveStatusByTask[selectedTask.taskId] === 'unsaved' ? h('small', { role: 'status' }, draftStorageStatusByTask[selectedTask.taskId] === 'saved' ? '名称草稿已保存在本机，尚未同步到任务' : '名称草稿尚未保存') : clientState.saveStatusByTask[selectedTask.taskId] === 'conflict' ? h('small', { role: 'alert' }, '任务版本已冲突；本地草稿仍保留') : null,
    h('button', { type: 'button', disabled: busy, onClick: toggleArchive }, selectedTask.archived ? '恢复任务' : '归档任务'),
    h('label', null, '当前明确要求（每行一条） ', h('textarea', {
      'aria-label': '当前明确要求', rows: 3,
      value: requirementsDraftsByTask[selectedTask.taskId] ?? (selectedTask.currentRequirements ?? []).join('\n'),
      onChange: (event: any) => setRequirementsDraftsByTask(current => ({ ...current, [selectedTask.taskId]: event.target.value })),
    })),
    h('small', null, '可识别的固定表达会覆盖冲突记忆；未识别或有歧义的要求仍以原文保存，不作推断。'),
    h('button', { type: 'button', disabled: busy, onClick: () => saveMethodDraft() }, '保存当前要求'),
    deleteImpact ? h('div', { role: 'alert' }, h('p', null, `确认删除“${deleteImpact.title}”？将移除 ${deleteImpact.bindingCount} 个绑定、${deleteImpact.versionCount} 个版本、${deleteImpact.reviewCount} 条复盘记录和 ${deleteImpact.sourceCount} 个来源。`), h('label', null, h('input', { type: 'checkbox', checked: clearLearned, disabled: busy, onChange: (event: any) => void updateDeleteLearned(event.target.checked) }), '同时清理本任务学习记录、记忆和专属来源摘录'), h('p', null, clearLearned ? `预计清理 ${deleteImpact.memoryCount} 条记忆；不删除 DSH 原始对话或原始资料。` : '保留学习摘要，并把来源定位标记为“任务已移除”；不删除 DSH 原始对话或原始资料。'), h('button', { type: 'button', disabled: busy, onClick: confirmDeleteTask }, '确认删除'), h('button', { type: 'button', disabled: busy, onClick: () => setDeleteImpact(null) }, '取消')) : h('button', { type: 'button', disabled: busy, onClick: requestDeletePreview }, '删除任务…'),
  ) : null,
  selectedTask ? h(MemoryPanel, { key: selectedTask.taskId, remote, task: selectedTask, conversationId }) : null,
  h('label', null, '新任务内容 ', h('textarea', { value: input, rows: 4, onChange: (event: any) => setInput(event.target.value), placeholder: '描述想法、提示词或待诊断结果' })),
  h('div', null,
    h('button', { type: 'button', disabled: busy || !cwdLoaded, onClick: loadProviders }, '读取模型提供方'),
    h('button', { type: 'button', disabled: busy, onClick: loadHostCapabilities }, '检查当前 Host 能力'),
    h('select', { 'aria-label': '模型提供方', value: provider, disabled: busy, onChange: (event: any) => void chooseProvider(event.target.value) }, h('option', { value: '' }, '选择提供方'), ...providers.map(item => h('option', { key: item.id, value: item.id }, item.name))),
    h('select', { 'aria-label': '模型', value: model, disabled: !provider || busy, onChange: (event: any) => setModel(event.target.value) }, h('option', { value: '' }, '选择模型'), ...models.map(item => h('option', { key: item.id, value: item.id }, item.name))),
    hostCapabilities ? h('ul', { 'aria-label': 'Host 能力状态' }, ...hostCapabilities.map(item => h('li', { key: item.id, 'data-status': item.status }, `${item.label}：${item.status === 'available' ? '可用' : '不可用'} — ${item.detail}`))) : null,
  ),
  h('label', null, 'Agent 阶段 ', h('select', { value: stage, disabled: busy, onChange: (event: any) => setStage(event.target.value) }, ...['clarification','diagnosis','planning','step-prompt','review'].map(value => h('option', { key: value, value }, value)))),
    h('label', null, h('input', { type: 'checkbox', checked: includeKnowledge, disabled: busy || !knowledgePreviewDigest, onChange: (event: any) => setIncludeKnowledge(event.target.checked) }), ' 本轮发送已预览的资料库引用'),
    h('div', null, h('button', { type: 'button', disabled: busy || !cwdLoaded || !sessionLoaded || !conversationId.trim() || !selectedTask, onClick: runCurrentTask }, busy ? '正在运行…' : selectedTask?.versions.at(-1)?.stage === stage && selectedTask.versions.at(-1).memoryRevisionChanged ? '按最新记忆重新生成' : '运行当前阶段'), h('button', { type: 'button', disabled: !runningRequest, onClick: cancelCurrentTask }, '取消运行')),
  selectedTask ? h('section', null, h('h2', null, selectedTask.title),
    h('p', null, `进度修订 ${selectedTask.revision} · ${selectedTask.versions.length} 个版本`),
    clientState.requestByTask[selectedTask.taskId] ? h('small', { role: 'status' }, '本任务正在运行…') : null,
    clientState.outputByTask[selectedTask.taskId] ? h('details', { 'data-testid': 'task-run-output' }, h('summary', null, clientState.unsavedOutputByTask[selectedTask.taskId] ? '未保存的生成草稿' : '本任务最近一次运行响应'), clientState.unsavedOutputByTask[selectedTask.taskId] ? h('p', { role: 'alert' }, '此结果尚未保存到任务历史。请先复制草稿；确认任务状态后可重试。') : null, h('pre', { style: { whiteSpace: 'pre-wrap' } }, clientState.outputByTask[selectedTask.taskId]), clientState.unsavedOutputByTask[selectedTask.taskId] ? h('button', { type: 'button', disabled: busy, onClick: copyUnsavedRunOutput }, '复制未保存草稿') : null) : null,
    editablePromptVersion ? h('section', { 'aria-label': '提示词版本编辑' },
      h('h3', null, '提示词版本编辑'),
      h('p', null, `当前阶段 ${editablePromptVersion.stage} · 来源版本 ${editablePromptVersion.versionId.slice(0, 8)}${editablePromptVersion.stale ? ' · 需复查' : ''}`),
      editablePromptVersion.staleReason ? h('small', { role: 'status' }, editablePromptVersion.staleReason) : null,
      h('label', null, '可编辑执行提示词 ', h('textarea', { 'aria-label': '可编辑执行提示词', value: promptEditorContent, rows: 8, onChange: (event: any) => setPromptEditorDraftsByTask(current => ({ ...current, [selectedTask.taskId]: event.target.value })) })),
      h('button', { type: 'button', disabled: busy || !promptEditorContent.trim(), onClick: copyPromptDraft }, '复制提示词'),
      h('button', { type: 'button', disabled: busy || !promptEditorContent.trim(), onClick: savePromptRevision }, '保存为新提示词版本')) : null,
    selectedTask.domain === 'writing' ? h('section', { 'aria-label': '写作方法状态' },
      h('h3', null, `${activeWritingGenre?.name ?? '写作'} · ${activeWritingGenre?.status ?? '未配置'}`),
      h('label', null, '写作目标 ', h('input', { 'aria-label': '写作目标', value: writingState.article?.goal ?? selectedTask.originalInput, onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, writing: { ...writingState, article: { ...writingState.article, goal: event.target.value } } }) })),
      h('label', null, '读者 ', h('input', { 'aria-label': '写作读者', value: writingState.article?.audience ?? '', onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, writing: { ...writingState, article: { ...writingState.article, audience: event.target.value } } }) })),
      h('label', null, '发布平台 ', h('input', { 'aria-label': '写作平台', value: writingState.article?.platform ?? '', onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, writing: { ...writingState, article: { ...writingState.article, platform: event.target.value } } }) })),
      h('label', null, '文体 ', h('select', { 'aria-label': '写作文体', value: writingGenre, disabled: Boolean(writingState.round?.packSnapshot), onChange: (event: any) => { const genre = event.target.value; const config = writingGenres.find(item => item.genre === genre); updateMethodDraft(selectedTask, { ...methodState, writing: { ...writingState, article: { ...writingState.article, genre }, round: { ...writingState.round, taskType: config?.taskTypes?.[0], packSnapshot: undefined } } }) } }, ...writingGenres.map(item => h('option', { key: item.genre, value: item.genre }, `${item.name} · ${item.status}`)))),
      activeWritingGenre?.reason ? h('small', { role: 'status' }, `${activeWritingGenre.reason}${activeWritingGenre.representativeTask ? ` 代表任务：${activeWritingGenre.representativeTask}` : ''}`) : null,
      writingTaskTypes.length ? h('label', null, '本轮任务类型 ', h('select', { 'aria-label': '写作任务类型', value: writingState.round?.taskType ?? writingTaskTypes[0], disabled: Boolean(writingState.round?.packSnapshot), onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, writing: { ...writingState, round: { ...writingState.round, taskType: event.target.value, packSnapshot: undefined } } }) }, ...writingTaskTypes.map(taskType => h('option', { key: taskType, value: taskType }, taskType)))) : null,
      h('fieldset', { 'aria-label': '本轮专业包选择' }, h('legend', null, '本轮专业包'), h('small', null, writingState.round?.packSnapshot ? '本轮专业包已冻结；如需更换文体、任务类型或专业包，请新建写作轮次。' : '内置包按文体自动选择；勾选自建包后预览并冻结版本。'), availableWritingPacks.length ? h('div', null, ...availableWritingPacks.map(pack => h('label', { key: pack.id }, h('input', { type: 'checkbox', checked: selectedWritingPackIds.includes(pack.id), disabled: busy || Boolean(writingState.round?.packSnapshot), onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, writing: { ...writingState, round: { ...writingState.round, packSelections: event.target.checked ? [...new Set([...selectedWritingPackIds, pack.id])] : selectedWritingPackIds.filter(id => id !== pack.id), packSnapshot: undefined } } }) }), `${pack.name} · V${pack.version}`))) : h('p', null, '当前文体没有可选的自建专业包。')),
      writingState.round?.packSnapshot ? h('small', { role: 'status' }, `已保存本轮快照：${writingState.round.packSnapshot.packs?.length ?? 0} 个包，跳过 ${writingState.round.packSnapshot.skipped?.length ?? 0} 项。`) : null,
      h('button', { type: 'button', disabled: busy || Boolean(writingState.round?.packSnapshot), onClick: () => void previewWritingPackSelection() }, writingState.round?.packSnapshot ? '本轮专业包已冻结' : '预览并冻结本轮专业包'),
      h('button', { type: 'button', disabled: busy, onClick: () => void startWritingRound() }, '新建写作轮次'),
      ...(writingState.roundHistory ?? []).slice(-20).map((round: any) => h('details', { key: round.id }, h('summary', null, `${round.id} · ${round.taskType ?? '未分类'}`), round.packSnapshot ? h('small', null, `专业包快照：${round.packSnapshot.packs?.map((pack: any) => `${pack.name ?? pack.id} V${pack.version}`).join('、') ?? '无'}`) : h('small', null, '未冻结专业包快照'), round.draft ? h('pre', { style: { whiteSpace: 'pre-wrap' } }, round.draft) : null)),
      h('label', null, '本轮约束 ', h('textarea', { 'aria-label': '写作约束', value: writingState.article?.constraints ?? '', rows: 3, onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, writing: { ...writingState, article: { ...writingState.article, constraints: event.target.value } } }) })),
      h('label', null, '稿件正文 ', h('textarea', { 'aria-label': '写作稿件正文', value: writingState.round?.draft ?? '', rows: 5, onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, writing: { ...writingState, round: { ...writingState.round, draft: event.target.value } } }) })),
      h('label', null, '本轮反馈 ', h('textarea', { 'aria-label': '写作本轮反馈', value: writingState.round?.feedback ?? '', rows: 2, onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, writing: { ...writingState, round: { ...writingState.round, feedback: event.target.value } } }) })),
      h('button', { type: 'button', disabled: busy, onClick: () => saveMethodDraft() }, '保存写作状态'),
      h('fieldset', { 'aria-label': '写作材料覆盖' }, h('legend', null, '材料覆盖与处理进度'),
        h('p', null, '仅使用当前任务中已选材料。目录授权尚未启用；覆盖完成必须经人工确认。'),
        h('button', { type: 'button', disabled: busy, onClick: loadWritingCoverage }, '读取已保存覆盖状态'),
        h('button', { type: 'button', disabled: busy || !taskMaterials.some(material => material.selected !== false), onClick: initializeWritingCoverage }, '按已选材料建立覆盖范围'),
        writingCoverage?.summary ? h('div', { role: 'status' },
          h('p', null, `总计 ${writingCoverage.summary.discovered}/${writingCoverage.summary.knownTotal} · 待处理 ${writingCoverage.summary.pending} · 处理中 ${writingCoverage.summary.inProgress} · 已回带 ${writingCoverage.summary.returned} · 已确认 ${writingCoverage.summary.processed} · 排除 ${writingCoverage.summary.excluded} · 失败 ${writingCoverage.summary.failed} · 覆盖率 ${writingCoverage.summary.coveragePercent === null ? '未知（清单不完整）' : `${writingCoverage.summary.coveragePercent}%`}`),
          h('button', { type: 'button', disabled: busy || writingCoverage.summary.pending === 0 || promptVersions.length === 0, onClick: () => void applyWritingCoverageAction('start-batch', { batchSize: 5, promptVersionId: promptVersions.at(-1)!.versionId }) }, '启动下一批'),
          h('label', null, '操作依据 ', h('input', { 'aria-label': '材料覆盖操作依据', value: writingCoverageReason, onChange: (event: any) => setWritingCoverageReason(event.target.value) })),
          ...(writingCoverage.workspace.materialCoverage.items ?? []).map((item: any) => h('p', { key: item.id }, `${item.title} · ${item.status}${item.reason ? ` · ${item.reason}` : ''}`, ['pending', 'failed'].includes(item.status) ? h('button', { type: 'button', disabled: busy || !writingCoverageReason.trim(), onClick: () => void applyWritingCoverageAction('exclude-item', { itemId: item.id, reason: writingCoverageReason }) }, '排除此材料') : null)),
          ...(writingCoverage.workspace.materialCoverage.batches ?? []).map((batch: any) => h('div', { key: batch.id }, h('p', null, `${batch.id} · ${batch.status} · ${batch.itemIds.length} 条材料`),
            batch.status === 'in-progress' ? h('div', null,
              h('button', { type: 'button', disabled: busy, onClick: () => void applyWritingCoverageAction('record-outcome', { batchId: batch.id, kind: 'returned', resultSummary: writingCoverageReason, promptVersionId: batch.promptVersionId || 'manual-round' }) }, '记录结果已回带'),
              h('button', { type: 'button', disabled: busy || !writingCoverageReason.trim(), onClick: () => void applyWritingCoverageAction('record-outcome', { batchId: batch.id, kind: 'failed', reason: writingCoverageReason }) }, '记录失败')) : null,
            batch.status === 'result-returned' ? h('button', { type: 'button', disabled: busy || !writingCoverageReason.trim(), onClick: () => void applyWritingCoverageAction('confirm-batch', { batchId: batch.id, evidence: writingCoverageReason }) }, '人工确认本批已处理') : null,
            batch.status === 'failed' ? h('button', { type: 'button', disabled: busy, onClick: () => void applyWritingCoverageAction('retry-batch', { batchId: batch.id }) }, '重试失败批次') : null))) : null)) : null,
    selectedTask.domain === 'ppt' ? h('section', { 'aria-label': 'PPT 方法状态' },
      h('h3', null, 'PPT 分阶段规划'),
      h('section', { 'aria-label': 'PPT 网页来源研究' },
        h('h4', null, '网页来源研究（需逐次确认）'),
        h('p', null, '搜索会将查询发送给 DSH Host 网页搜索服务；搜索结果仅是未核验候选。读取网页会提取不可信文本，不执行网页脚本或命令。加入的材料默认未选，核对、勾选并保存后才进入任务提示词。'),
        h('label', null, '搜索主题 ', h('input', { 'aria-label': 'PPT 网页搜索主题', value: pptSearchQueriesByTask[selectedTask.taskId] ?? '', disabled: busy, onChange: (event: any) => setPptSearchQueriesByTask(current => ({ ...current, [selectedTask.taskId]: event.target.value })) })),
        h('button', { type: 'button', disabled: busy || Boolean(pptSourceRequestRef.current) || !(pptSearchQueriesByTask[selectedTask.taskId] ?? '').trim(), onClick: searchPptSources }, pptVerifiedWebByTask[selectedTask.taskId]?.search ? '确认并搜索网页来源' : '确认探测并搜索网页来源'),
        pptSourceRequestRef.current?.taskId === selectedTask.taskId ? h('button', { type: 'button', disabled: busy, onClick: cancelPptSourceSearch }, '取消来源请求') : null,
        pptSourceStatusByTask[selectedTask.taskId] ? h('p', { role: 'status', 'aria-live': 'polite' }, pptSourceStatusByTask[selectedTask.taskId]) : null,
        ...(pptSourcesByTask[selectedTask.taskId] ?? []).map(source => h('article', { key: source.id, 'aria-label': '网页来源候选', 'data-source-id': source.id },
          h('h5', null, source.title || source.url),
          h('a', { href: source.url, target: '_blank', rel: 'noreferrer' }, source.url),
          source.publishedAt ? h('p', null, `来源标注时间：${source.publishedAt}`) : null,
          source.excerpt ? h('p', null, `不可信搜索摘要：${source.excerpt}`) : null,
          h('button', { type: 'button', disabled: busy || Boolean(pptSourceRequestRef.current), onClick: () => addPptSourceMaterial(source) }, pptVerifiedWebByTask[selectedTask.taskId]?.fetch ? '确认读取并加入未选材料' : '确认探测读取并加入未选材料')))),
      h('p', { role: 'status' }, `网页搜索${pptVerifiedWebByTask[selectedTask.taskId]?.search ? '已在本会话成功探测' : '尚未在本会话探测'}；网页读取${pptVerifiedWebByTask[selectedTask.taskId]?.fetch ? '已在本会话成功探测' : '尚未在本会话探测'}。首次请求会明确确认并实测当前 Host 响应；探测成功仅对当前 Host 会话有效，不替代真实 DSH 安装验收。候选内容仍须人工核验，本地文件仍可明确选择解析。HTML 成品路线可导出离线演示，支持结构化图表和用户配图；PPTX 支持可编辑文字、PowerPoint 原生图表及用户配图。导入 HTML 仅转换安全白名单；PPTX 导入可复用为可编辑文字与 PNG/JPEG 配图草稿，图表数据、主题、动画和复杂版式不会转换。`),
      h('label', null, '规划阶段 ', h('select', { 'aria-label': 'PPT 阶段', value: pptState.stage ?? 'brief', onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, stage: event.target.value as NonNullable<TaskMethodState['ppt']>['stage'] } }) }, ...[['brief', '简报'], ['outline', '大纲'], ['slides', '逐页规划'], ['route-prompt', '制作路线提示词'], ['visual-feedback', '视觉反馈']].map(([value, label]) => h('option', { key: value, value }, label)))),
      h('label', null, '制作路线 ', h('select', { 'aria-label': 'PPT 制作路线', value: pptState.route ?? 'undecided', onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, route: event.target.value } }) }, ...[['undecided', '待确定'], ['native-ppt', 'PowerPoint 原生对象'], ['image-rebuild', '图片参考后重建'], ['html-final', 'HTML 成品'], ['html-to-ppt', 'HTML 转 PPT']].map(([value, label]) => h('option', { key: value, value }, label)))),
      h('label', null, '受众 ', h('input', { 'aria-label': 'PPT 受众', value: pptState.brief?.audience ?? '', onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, brief: { ...pptState.brief, audience: event.target.value } } }) })),
      h('label', null, '场景/受众行动 ', h('input', { 'aria-label': 'PPT 场景和行动', value: pptState.brief?.audienceAction ?? '', onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, brief: { ...pptState.brief, audienceAction: event.target.value } } }) })),
      h('label', null, '时长（分钟） ', h('input', { 'aria-label': 'PPT 时长', type: 'number', min: '1', value: pptState.brief?.durationMinutes ?? '', onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, brief: { ...pptState.brief, durationMinutes: event.target.value === '' ? undefined : Number(event.target.value) } } }) })),
      h('label', null, '核心信息/硬要求（每行一条） ', h('textarea', { 'aria-label': 'PPT 核心信息', value: (pptState.brief?.hardRequirements ?? []).join('\n'), rows: 3, onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, brief: { ...pptState.brief, hardRequirements: event.target.value.split(/\r?\n/).filter(Boolean) } } }) })),
      h('label', null, '页数范围 ', h('input', { 'aria-label': 'PPT 最少页数', type: 'number', min: '1', value: pptState.brief?.constraints?.minSlides ?? '', onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, brief: { ...pptState.brief, constraints: { ...pptState.brief?.constraints, minSlides: event.target.value === '' ? undefined : Number(event.target.value) } } } }) }), ' 至 ', h('input', { 'aria-label': 'PPT 最多页数', type: 'number', min: '1', value: pptState.brief?.constraints?.maxSlides ?? '', onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, brief: { ...pptState.brief, constraints: { ...pptState.brief?.constraints, maxSlides: event.target.value === '' ? undefined : Number(event.target.value) } } } }) })),
      h('label', null, '大纲/逐页规划（每行一页：标题 — 内容） ', h('textarea', { 'aria-label': 'PPT 大纲草稿', value: (pptState.outline?.slides ?? []).map(slide => `${slide.title ?? ''}${slide.content ? ` — ${slide.content}` : ''}`).join('\n'), rows: 5, onChange: (event: any) => updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, outline: { ...pptState.outline, status: 'draft', slides: event.target.value.split(/\r?\n/).filter(Boolean).map(line => { const [title, ...content] = line.split('—'); return { title: title.trim(), content: content.join('—').trim() } }) } } }) })),
      h('section', { 'aria-label': 'PPT 本地规划预览', style: { display: 'grid', gap: 8, minWidth: 0 } },
        h('h4', null, '逐页草稿预览（本地规划展示，不是 PPT/HTML 成品）'),
        pptSlides.length ? h('div', null,
          h('label', { style: pptFieldStyle }, '预览页面 ', h('select', { 'aria-label': 'PPT 预览页面', value: pptActivePreviewIndex, onChange: (event: any) => { cancelPptPageImageRead(); cancelPptUnderstanding(); const pageIndex = Number(event.target.value); setPptPreviewPageIndex(pageIndex); setPptFeedbackPageIndex(pageIndex); setPptFeedbackTarget(null) } }, ...pptSlides.map((slide, index) => h('option', { key: index, value: index }, `第 ${index + 1} 页 · ${slide.title || '未命名页面'}`)))),
          h('label', { style: pptFieldStyle }, '当前页标题（可校对）', h('input', { 'aria-label': '当前 PPT 页面标题', value: pptPreviewSlide?.title ?? '', disabled: busy, onChange: (event: any) => {
            if (!selectedTask || !pptPreviewSlide) return
            const slides = [...pptSlides]
            slides[pptActivePreviewIndex] = { ...slides[pptActivePreviewIndex], title: event.target.value }
            setPptUnderstandingDraft(null)
            updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, outline: { ...pptState.outline, slides } } })
          } })),
          h('label', { style: pptFieldStyle }, '当前页正文 / OCR（可校对）', h('textarea', { 'aria-label': '当前 PPT 页面正文', value: pptPreviewSlide?.content ?? pptPreviewSlide?.body ?? '', rows: 6, disabled: busy, onChange: (event: any) => {
            if (!selectedTask || !pptPreviewSlide) return
            const slides = [...pptSlides]
            slides[pptActivePreviewIndex] = { ...slides[pptActivePreviewIndex], content: event.target.value, body: event.target.value }
            setPptUnderstandingDraft(null)
            updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, outline: { ...pptState.outline, slides } } })
          } })),
          currentPptUnderstandingDraft ? h('div', { 'data-testid': 'ppt-understanding-draft', role: 'group', 'aria-label': '模型页面理解草稿' },
            h('p', null, `${currentPptUnderstandingDraft.imageIndex < 0 ? `本页 ${currentPptUnderstandingDraft.imageCount} 张图像资料` : `图像资料 ${currentPptUnderstandingDraft.imageIndex + 1}`} 的理解草稿（模型生成，请核对）：${currentPptUnderstandingDraft.text}`),
            h('button', { type: 'button', disabled: busy, onClick: applyPptUnderstandingDraft }, '采纳为待核对模型理解'),
            h('button', { type: 'button', disabled: busy, onClick: () => setPptUnderstandingDraft(null) }, '丢弃理解草稿'),
          ) : null,
          h('small', null, '模型理解需人工核对；采纳后与人工页面备注分开保存，并用于逐页修改提示词。'),
          h('label', { style: pptFieldStyle }, '已采纳模型理解（模型生成，仍需核对）', h('textarea', { 'aria-label': '当前 PPT 模型理解', value: pptPreviewSlide?.modelVisualDescription ?? '', rows: 4, disabled: busy, onChange: (event: any) => {
            if (!selectedTask || !pptPreviewSlide) return
            const slides = [...pptSlides]
            slides[pptActivePreviewIndex] = { ...slides[pptActivePreviewIndex], modelVisualDescription: event.target.value }
            updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, outline: { ...pptState.outline, slides } } })
          } })),
          h('label', { style: pptFieldStyle }, '人工页面理解备注（布局、视觉层级、图表关系）', h('textarea', { 'aria-label': '当前 PPT 页面理解', value: pptPreviewSlide?.visualDescription ?? '', rows: 4, disabled: busy, onChange: (event: any) => {
            if (!selectedTask || !pptPreviewSlide) return
            const slides = [...pptSlides]
            slides[pptActivePreviewIndex] = { ...slides[pptActivePreviewIndex], visualDescription: event.target.value }
            updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, outline: { ...pptState.outline, slides } } })
          } })),
          h('label', { style: pptFieldStyle }, `第 ${pptActivePreviewIndex + 1} 页配图（PNG/JPEG，单张不超过 3 MiB）`, h('input', { type: 'file', accept: 'image/png,image/jpeg', 'aria-label': '选择当前 PPT 页面配图', disabled: busy, onChange: (event: any) => {
            const file = event.target.files?.[0] as File | undefined
            event.target.value = ''
            if (!file) return
            if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 3 * 1024 * 1024) { setResult('配图只支持不超过 3 MiB 的 PNG/JPEG。'); return }
            const existingImageBytes = (pptState.outline?.slides ?? []).reduce((total, slide, index) => index === pptActivePreviewIndex ? total : total + estimatePptImageBytes(slide.imageDataUrl) + (slide.imageDataUrls ?? []).reduce((sum, image) => sum + estimatePptImageBytes(image), 0), 0)
            if (existingImageBytes + file.size > MAX_PPT_IMAGE_BYTES_TOTAL) { setResult('所有页面配图总量不能超过 20 MiB；当前页面草稿保持不变。'); return }
            cancelPptPageImageRead()
            const taskId = selectedTask?.taskId
            const pageIndex = pptActivePreviewIndex
            const reader = new FileReader()
            pptPageImageReaderRef.current = reader
            reader.onerror = () => {
              if (pptPageImageReaderRef.current !== reader) return
              pptPageImageReaderRef.current = null
              setResult('读取配图失败；当前页面内容保持不变。')
            }
            reader.onabort = () => { if (pptPageImageReaderRef.current === reader) pptPageImageReaderRef.current = null }
            reader.onload = () => {
              if (pptPageImageReaderRef.current !== reader) return
              pptPageImageReaderRef.current = null
              if (typeof reader.result !== 'string' || !selectedTask || selectedTask.taskId !== taskId || pptActivePreviewIndex !== pageIndex) return
              const slides = [...(pptState.outline?.slides ?? [])]
              slides[pageIndex] = { ...slides[pageIndex], imageDataUrl: reader.result }
                        setPptFeedbackTarget(null)
              setPptUnderstandingDraft(null)
              updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, outline: { ...pptState.outline, slides } } })
              setResult(`第 ${pageIndex + 1} 页配图已加入当前草稿；重新导出 PPTX 后会嵌入图片。`)
            }
            reader.readAsDataURL(file)
          } }), pptSlides[pptActivePreviewIndex]?.imageDataUrl ? h('button', { type: 'button', disabled: busy, onClick: () => {
            const slides = [...(pptState.outline?.slides ?? [])]
            const { imageDataUrl: _removed, ...slide } = slides[pptActivePreviewIndex]
            slides[pptActivePreviewIndex] = slide
                    setPptFeedbackTarget(null)
            setPptUnderstandingDraft(null)
            updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, outline: { ...pptState.outline, slides } } })
          } }, '移除当前页面配图') : null),
          pptSlides[pptActivePreviewIndex]?.imageDataUrl ? h('img', { src: pptSlides[pptActivePreviewIndex].imageDataUrl, alt: `第 ${pptActivePreviewIndex + 1} 页配图预览`, style: { display: 'block', maxWidth: '100%', maxHeight: 240, objectFit: 'contain' } }) : null,
          ...listPptPageImages(pptPreviewSlide).map((image, imageIndex) => h('div', { key: `ppt-image-actions-${imageIndex}` },
            h('button', { type: 'button', 'aria-label': `放大查看第 ${pptActivePreviewIndex + 1} 页图像资料 ${imageIndex + 1}`, disabled: busy, onClick: () => setPptExpandedImage({ taskId: selectedTask.taskId, pageIndex: pptActivePreviewIndex, imageIndex, src: image }) }, `放大查看图像 ${imageIndex + 1}`),
            h('button', { type: 'button', 'aria-label': `发送第 ${pptActivePreviewIndex + 1} 页图像资料 ${imageIndex + 1} 给模型理解`, disabled: busy || !provider || !model, onClick: () => void understandPptImage(imageIndex) }, `发送图像 ${imageIndex + 1} 给模型理解`),
          )),
          listPptPageImages(pptPreviewSlide).length > 1 ? h('button', { type: 'button', 'aria-label': `理解第 ${pptActivePreviewIndex + 1} 页全部图像资料`, disabled: busy || !provider || !model || listPptPageImages(pptPreviewSlide).length > 8, onClick: () => void understandPptImage(-1) }, '综合理解本页全部图像（最多 8 张）') : null,
          pptUnderstandingRequestRef.current ? h('button', { type: 'button', onClick: () => pptUnderstandingRequestRef.current?.abort(), 'aria-label': '取消当前页图像理解' }, '取消图像理解') : null,
          h('article', { 'data-testid': 'ppt-slide-preview', 'aria-label': `第 ${pptActivePreviewIndex + 1} 页规划预览；点击页面可定位反馈`, onClick: (event: any) => { const rect = event.currentTarget.getBoundingClientRect(); if (rect.width && rect.height) { setPptFeedbackTarget({ taskId: selectedTask.taskId, pageIndex: pptActivePreviewIndex, x: Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 1000) / 1000, y: Math.round(Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 1000) / 1000 }); setPptFeedbackPageIndex(pptActivePreviewIndex) } }, onKeyDown: (event: any) => { if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const current = pptFeedbackTarget?.taskId === selectedTask?.taskId && pptFeedbackTarget.pageIndex === pptActivePreviewIndex ? pptFeedbackTarget : { taskId: selectedTask?.taskId ?? '', pageIndex: pptActivePreviewIndex, x: 0.5, y: 0.5 }; const step = event.shiftKey ? 0.1 : 0.02; setPptFeedbackTarget({ ...current, x: Math.max(0, Math.min(1, current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0))), y: Math.max(0, Math.min(1, current.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0))) }); setPptFeedbackPageIndex(pptActivePreviewIndex) }, role: 'button', tabIndex: 0, style: { boxSizing: 'border-box', position: 'relative', cursor: 'crosshair', aspectRatio: '16 / 9', maxWidth: '720px', padding: '5%', border: '1px solid var(--dsw-alias-border-default)', background: pptPreviewSlide?.style?.backgroundColor ? `#${pptPreviewSlide.style.backgroundColor}` : 'var(--dsw-alias-background-primary)', color: 'var(--dsw-alias-label-primary)', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' } },
            ...(() => { const images = listPptPageImages(pptPreviewSlide); return images.length ? [h('div', { key: 'ppt-slide-image-grid', 'data-testid': 'ppt-slide-image-grid', 'aria-label': '本页导入图像资料', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6, maxHeight: 190, overflowY: 'auto', alignContent: 'start' } }, ...images.map((image, index) => h('div', { key: `ppt-slide-image-${index}` }, h('img', { src: image, alt: `第 ${pptActivePreviewIndex + 1} 页图像资料 ${index + 1}`, style: { width: '100%', height: 180, objectFit: 'contain', background: 'white' } }), h('button', { type: 'button', disabled: busy, 'aria-label': `移除第 ${pptActivePreviewIndex + 1} 页第 ${index + 1} 张导入图像`, onClick: (event: any) => { event.stopPropagation(); removeCurrentPptImage(index) } }, `移除图像 ${index + 1}`)))) ] : [] })(),
            h('small', null, `第 ${pptActivePreviewIndex + 1} 页 / 共 ${pptSlides.length} 页 · ${pptPreviewSlide?.imageDataUrl || pptPreviewSlide?.imageDataUrls?.length ? '\u5bfc\u5165\u56fe\u50cf\u6807\u6ce8' : '规划草稿'}`),
            (pptPreviewSlide as any)?.sourceImageName || (pptPreviewSlide as any)?.sourceDocumentName ? h('small', null, `原始文件：${(pptPreviewSlide as any).sourceImageName || (pptPreviewSlide as any).sourceDocumentName}`) : null,
            ...(pptState.visualFeedback ?? []).filter(item => item.pageIndex === pptActivePreviewIndex && item.target?.kind === 'point' && item.target.imageIndex === undefined).map((item, index) => { const categoryLabel = ({ content: '内容', logic: '逻辑', evidence: '证据', style: '风格', layout: '布局', readability: '可读性', other: '其他' } as Record<PptVisualFeedback['category'], string>)[item.category]; const comment = item.comment.slice(0, 120); return h('span', { key: item.id, role: 'img', 'aria-label': '第 ' + (index + 1) + ' 个标注点：' + categoryLabel + '，' + comment, title: '标注 ' + (index + 1) + ' · ' + categoryLabel + '：' + comment, onClick: (event: any) => event.stopPropagation(), style: { position: 'absolute', left: `${item.target!.x * 100}%`, top: `${item.target!.y * 100}%`, transform: 'translate(-50%, -50%)', borderRadius: '50%', background: '#d92d20', color: 'white', width: 22, height: 22, display: 'grid', placeItems: 'center', fontSize: 12, pointerEvents: 'auto', cursor: 'help', zIndex: 1 } }, String(index + 1)) }),
            h('h3', { style: { color: pptPreviewSlide?.style?.title?.color ? `#${pptPreviewSlide.style.title.color}` : undefined, fontSize: pptPreviewSlide?.style?.title?.fontSize ? `${pptPreviewSlide.style.title.fontSize / 100}pt` : undefined, fontWeight: pptPreviewSlide?.style?.title?.bold ? 700 : undefined, fontStyle: pptPreviewSlide?.style?.title?.italic ? 'italic' : undefined, textAlign: pptPreviewSlide?.style?.title?.align } }, pptPreviewSlide?.title || '未命名页面'),
            renderPptChartPreview((pptPreviewSlide as any)?.chart),
            h('p', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.5, color: pptPreviewSlide?.style?.body?.color ? `#${pptPreviewSlide.style.body.color}` : undefined, fontSize: pptPreviewSlide?.style?.body?.fontSize ? `${pptPreviewSlide.style.body.fontSize / 100}pt` : undefined, fontWeight: pptPreviewSlide?.style?.body?.bold ? 700 : undefined, fontStyle: pptPreviewSlide?.style?.body?.italic ? 'italic' : undefined, textAlign: pptPreviewSlide?.style?.body?.align } }, pptPreviewSlide?.content ?? (Array.isArray((pptPreviewSlide as any)?.body) ? (pptPreviewSlide as any).body.join('\n') : (pptPreviewSlide as any)?.body) ?? '尚无页面文案'),
            renderPptTablePreview((pptPreviewSlide as any)?.table),
          ),
          pptExpandedImage?.taskId === selectedTask.taskId && pptExpandedImage.pageIndex === pptActivePreviewIndex && listPptPageImages(pptPreviewSlide)[pptExpandedImage.imageIndex] === pptExpandedImage.src ? h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `第 ${pptExpandedImage.pageIndex + 1} 页原图放大预览`, 'data-testid': 'ppt-image-zoom-dialog', style: { position: 'fixed', inset: '4vh 4vw', zIndex: 10000, display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, padding: 12, background: 'var(--dsw-alias-background-primary)', border: '1px solid var(--dsw-alias-border-default)', boxShadow: '0 8px 32px #0008' } },
            h('div', null, h('span', null, `第 ${pptExpandedImage.pageIndex + 1} 页 · 图像资料 ${pptExpandedImage.imageIndex + 1}`), h('button', { type: 'button', autoFocus: true, onClick: () => setPptExpandedImage(null) }, '关闭原图预览')),
            h('div', { 'data-testid': 'ppt-image-zoom-canvas', 'aria-label': '点击原图定位逐页反馈；方向键微调位置', role: 'button', tabIndex: 0, style: { position: 'relative', display: 'grid', placeItems: 'center', minHeight: 0, cursor: 'crosshair' }, onClick: (event: any) => {
              const image = event.currentTarget.querySelector('img')
              const rect = image?.getBoundingClientRect()
              if (!rect?.width || !rect?.height || !image.naturalWidth || !image.naturalHeight) return
              const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
              const displayedWidth = image.naturalWidth * scale
              const displayedHeight = image.naturalHeight * scale
              const offsetX = (rect.width - displayedWidth) / 2
              const offsetY = (rect.height - displayedHeight) / 2
              const x = event.clientX - rect.left - offsetX
              const y = event.clientY - rect.top - offsetY
              if (x < 0 || y < 0 || x > displayedWidth || y > displayedHeight) return
              setPptFeedbackTarget({ taskId: selectedTask.taskId, pageIndex: pptExpandedImage.pageIndex, imageIndex: pptExpandedImage.imageIndex, x: Math.round(x / displayedWidth * 1000) / 1000, y: Math.round(y / displayedHeight * 1000) / 1000 })
              setPptFeedbackPageIndex(pptExpandedImage.pageIndex)
            }, onKeyDown: (event: any) => {
              if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
              event.preventDefault()
              const current = pptFeedbackTarget?.taskId === selectedTask.taskId && pptFeedbackTarget.pageIndex === pptExpandedImage.pageIndex && pptFeedbackTarget.imageIndex === pptExpandedImage.imageIndex
                ? pptFeedbackTarget
                : { taskId: selectedTask.taskId, pageIndex: pptExpandedImage.pageIndex, imageIndex: pptExpandedImage.imageIndex, x: 0.5, y: 0.5 }
              const step = event.shiftKey ? 0.1 : 0.02
              setPptFeedbackTarget({ ...current, x: Math.max(0, Math.min(1, current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0))), y: Math.max(0, Math.min(1, current.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0))) })
              setPptFeedbackPageIndex(pptExpandedImage.pageIndex)
            } },
              h('div', { style: { position: 'relative', maxWidth: '100%', maxHeight: '100%', lineHeight: 0 } },
                h('img', { src: pptExpandedImage.src, alt: `第 ${pptExpandedImage.pageIndex + 1} 页图像资料 ${pptExpandedImage.imageIndex + 1} 放大预览`, style: { display: 'block', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } }),
                pptFeedbackTarget?.taskId === selectedTask.taskId && pptFeedbackTarget.pageIndex === pptExpandedImage.pageIndex && pptFeedbackTarget.imageIndex === pptExpandedImage.imageIndex ? h('span', { 'data-testid': 'ppt-image-feedback-marker', role: 'img', 'aria-label': '当前图像标注点', style: { position: 'absolute', left: `${pptFeedbackTarget.x * 100}%`, top: `${pptFeedbackTarget.y * 100}%`, transform: 'translate(-50%, -50%)', width: 20, height: 20, borderRadius: '50%', border: '2px solid white', background: '#d92d20', boxShadow: '0 1px 5px #0009', pointerEvents: 'none' } }) : null,
              ),
            ),
          ) : null,
          h('p', { role: 'status' }, pptFeedbackTarget?.taskId === selectedTask.taskId && pptFeedbackTarget.pageIndex === pptFeedbackPageIndex ? `已定位在页面${pptFeedbackTarget.imageIndex === undefined ? '' : `图像资料 ${pptFeedbackTarget.imageIndex + 1}`} ${pptFeedbackTarget.x}, ${pptFeedbackTarget.y}（0–1 相对坐标）；保存意见后会一并带入提示词。` : '点击上方页面预览可附加画面位置；放大图像资料时点击图片可定位到该图；也可只保存页面级意见。'),
          h('fieldset', { 'aria-label': '当前页面表格编辑' },
            h('legend', null, '当前页面表格（每行一行，Tab 分列；最多 20 行、8 列）'),
            h('textarea', { key: `ppt-table-${selectedTask.taskId}-${pptActivePreviewIndex}`, ref: pptTableDraftRef, 'aria-label': '表格行列内容', rows: 5, defaultValue: ((pptPreviewSlide as any)?.table?.rows ?? []).map((row: any[]) => row.map((cell: any) => typeof cell === 'string' ? cell : cell.text).join('\t')).join('\n'), placeholder: '指标\t数值\n一月\t12', disabled: busy }),
            h('button', { type: 'button', disabled: busy, onClick: () => {
              if (!selectedTask || !pptTableDraftRef.current) return
              const raw = pptTableDraftRef.current.value.trim()
              const slides = [...(pptState.outline?.slides ?? [])]
              const slide = { ...slides[pptActivePreviewIndex] }
              if (!raw) delete slide.table
              else {
                const rows = raw.split(/\r?\n/u).map(line => line.split('\t').map(cell => cell.trim()))
                if (rows.length > 20 || rows.some(row => row.length > 8 || row.length === 0) || new Set(rows.map(row => row.length)).size !== 1 || rows.some(row => row.some(cell => cell.length > 1000))) {
                  setResult('表格无效：需要 1–20 行、每行 1–8 列且列数一致，每格最多 1,000 字符；当前页面未修改。')
                  return
                }
                const previousRows = slide.table?.rows ?? []
                slide.table = { rows: rows.map((row, rowIndex) => row.map((text, columnIndex) => {
                  const previous = previousRows[rowIndex]?.[columnIndex]
                  return previous && typeof previous === 'object' ? { ...previous, text } : text
                })) }
              }
              slides[pptActivePreviewIndex] = slide
              updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, outline: { ...pptState.outline, slides } } })
              setResult(raw ? `第 ${pptActivePreviewIndex + 1} 页表格已更新。` : `第 ${pptActivePreviewIndex + 1} 页表格已移除。`)
            } }, '应用表格到当前页面'),
          ),
          h('div', { 'aria-label': '本页规划反馈' }, ...(pptState.visualFeedback ?? []).filter(item => item.pageIndex === pptActivePreviewIndex).map(item => {
            const stale = item.contentSnapshot !== pptFeedbackSnapshot(pptPreviewSlide ?? {})
             return h('p', { key: item.id, role: stale ? 'status' : undefined }, `反馈：${item.comment}${item.target?.kind === 'point' ? `（${item.target.imageIndex === undefined ? '页面' : `图像资料 ${item.target.imageIndex + 1}`}位置 ${item.target.x}, ${item.target.y}）` : ''}${stale ? '（页面已变化，反馈已过期）' : item.selected ? '（已选用于下一轮提示词）' : '（未选）'}`)
          })),
        ) : h('p', null, '添加逐页规划后，可在此查看本地草稿预览。'),
        h('button', { type: 'button', disabled: busy || pptState.route !== 'html-final' || !pptSlides.length, onClick: () => {
          try {
            const result = downloadPptHtmlPresentation({ title: pptState.outline?.title || selectedTask.title, slides: pptSlides })
            setResult(`HTML 演示已生成：${result.filename}，${result.slideCount} 页，包含结构化图表和已选配图。此文件为 HTML 成品，不是 PPTX。`)
          } catch (error) { setResult(`HTML 演示导出失败：${error instanceof Error ? error.message : String(error)}`) }
        } }, '导出离线 HTML 演示（成品）'),
        h('label', null, '导入静态 HTML 演示（最大 10 MiB；仅转换安全白名单内容） ', h('input', { type: 'file', accept: '.html,.htm,text/html', 'aria-label': '导入静态 HTML 并转换为可编辑草稿', disabled: busy, onChange: async (event: any) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file || !selectedTask) return
          if (file.size > 10 * 1024 * 1024) { setPendingPptImport(null); setResult('HTML 演示超过 10 MiB 上限。当前大纲未修改。'); return }
          setPendingPptImport(null)
          setPendingPptImportPageIndex(0)
          try {
            const imported = importPptHtmlPresentation(await file.text())
            setPendingPptImport({ taskId: selectedTask.taskId, format: 'HTML', title: imported.title, fileName: file.name, slides: imported.slides, limitations: imported.limitations })
            setPendingPptImportPageIndex(0)
            setResult(`已读取 ${file.name}：${imported.slides.length} 页待审核；现有规划未修改。请逐页复核并确认替换后再写入。${imported.limitations.join(' ')}`)
          } catch (error) { setResult(`HTML 导入失败：${error instanceof Error ? error.message : String(error)}`) }
        } })),
        h('label', null, '导入 PPTX 演示（最大 128 MiB；仅读取文字与 PNG/JPEG 配图） ', h('input', { type: 'file', accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', 'aria-label': '导入 PPTX 并转换为可编辑草稿', disabled: busy, onChange: async (event: any) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file || !selectedTask) return
          if (file.size > 128 * 1024 * 1024) { setPendingPptImport(null); setResult('PPTX 超过 128 MiB 上限。当前大纲未修改。'); return }
          setPendingPptImport(null)
          setPendingPptImportPageIndex(0)
          const controller = new AbortController()
          materialImportRef.current = controller
          setMaterialImporting(true)
          setBusy(true)
          setResult('正在读取 PPTX 并识别内嵌图片文字…')
          try {
            const parsed = await importPptxPresentation(await file.arrayBuffer())
            if (controller.signal.aborted) throw Object.assign(new Error('PPTX 导入已取消'), { code: 'cancelled' })
            const ocr = await addPptxImageOcr(parsed.slides, {
              signal: controller.signal,
              onProgress: ({ completedImages, totalImages, pageNumber }) => setResult(`正在识别 PPTX 图片：${completedImages}/${totalImages} 张（第 ${pageNumber} 页）…`),
              parseImage: (image, options) => uploadAndParseSelectedFile(image, { ...options, remote, readBytes: readSelectedFileBytes }),
            })
            if (controller.signal.aborted) throw Object.assign(new Error('PPTX 导入已取消'), { code: 'cancelled' })
            const imported = { ...parsed, slides: ocr.slides.map(slide => ({ ...slide, sourceDocumentName: file.name.replace(/[\r\n\t]/gu, ' ').slice(0, 240) })), limitations: [...parsed.limitations, ...ocr.limitations] }
            setPendingPptImport({ taskId: selectedTask.taskId, format: 'PPTX', title: imported.title, fileName: file.name, slides: imported.slides, limitations: imported.limitations })
            setPendingPptImportPageIndex(0)
            setResult('已读取 ' + file.name + '：' + imported.slides.length + ' 页待审核；内嵌图片 OCR 成功 ' + ocr.recognizedImages + ' 张。' + imported.limitations.join(' '))
          } catch (error) {
            setResult(controller.signal.aborted || (error as any)?.code === 'cancelled' ? 'PPTX 导入已取消；当前大纲未修改。' : 'PPTX 导入失败：' + (error instanceof Error ? error.message : String(error)))
          } finally {
            if (materialImportRef.current === controller) materialImportRef.current = null
            setMaterialImporting(false)
            setBusy(false)
          }
        } })),
        h('label', null, '\u5bfc\u5165\u5e7b\u706f\u7247\u622a\u56fe\uff08PNG/JPEG\uff0c\u5355\u5f20\u6700\u5927 3 MiB\uff1b\u9010\u9875\u6807\u6ce8\u540e\u751f\u6210\u4fee\u6539\u63d0\u793a\u8bcd\uff09 ', h('input', { type: 'file', accept: 'image/png,image/jpeg,.png,.jpg,.jpeg', multiple: true, 'aria-label': '\u5bfc\u5165\u5e7b\u706f\u7247\u622a\u56fe', disabled: busy, onChange: async (event: any) => {
          const files = Array.from(event.target.files ?? []) as File[]
          event.target.value = ''
          if (!files.length || !selectedTask) return
          const taskAtStart = selectedTask
          const controller = new AbortController()
          materialImportRef.current = controller
          setMaterialImporting(true)
          setBusy(true)
          setResult(`正在读取 ${files.length} 张截图并执行本地 OCR…`)
          try {
            const imported = await importPptScreenshots(files, {
              signal: controller.signal,
              onProgress: ({ completedImages, totalImages, pageNumber }) => setResult(`\u6b63\u5728\u8bc6\u522b\u622a\u56fe\uff1a${completedImages}/${totalImages} \u5f20\uff08\u7b2c ${pageNumber} \u9875\uff09\u2026`),
              parseImage: (file, options) => uploadAndParseSelectedFile(file, { ...options, remote, readBytes: readSelectedFileBytes }),
            })
            if (controller.signal.aborted) throw Object.assign(new Error('截图导入已取消'), { code: 'cancelled' })
            setPendingPptImport({ taskId: taskAtStart.taskId, format: '截图', title: imported.title, fileName: files.map(file => file.name).join('、'), slides: imported.slides, limitations: imported.limitations })
            setPendingPptImportPageIndex(0)
            setResult(`已读取 ${files.length} 张截图：OCR 文字待逐页校对；当前大纲未修改。确认后可继续标注并生成修改提示词。`)
          } catch (error) { setResult(controller.signal.aborted || (error as any)?.code === "cancelled" ? "截图导入已取消；当前大纲未修改。" : `截图导入失败：${error instanceof Error ? error.message : String(error)}`) }
          finally {
            if (materialImportRef.current === controller) materialImportRef.current = null
            setMaterialImporting(false)
            setBusy(false)
          }
        } })),
      pendingPptImport?.taskId === selectedTask.taskId ? h('section', { 'data-testid': 'ppt-import-pending', 'aria-label': `待确认的${pendingPptImport.format}导入` },
        h('h4', null, `逐页复核 ${pendingPptImport.format} 导入`),
        h('p', null, `${pendingPptImport.fileName}：${pendingPptImport.slides.length} 页待导入；当前大纲未修改。${pendingPptImport.limitations.join(' ')}`),
        h('label', null, '待导入页面 ', h('select', { 'aria-label': '待导入页面', value: pendingPptImportPageIndex, onChange: (event: any) => setPendingPptImportPageIndex(Number(event.target.value)) }, ...pendingPptImport.slides.map((slide, index) => h('option', { key: index, value: index }, `第 ${index + 1} 页 · ${slide.title || '未命名页面'}`)))),
        h('article', { 'data-testid': 'ppt-import-slide-preview', 'aria-label': `待导入第 ${pendingPptImportPageIndex + 1} 页预览` },
          h('small', null, `第 ${pendingPptImportPageIndex + 1} 页 / 共 ${pendingPptImport.slides.length} 页 · 未写入当前大纲`),
          pendingPptImport.slides[pendingPptImportPageIndex]?.sourceDocumentName ? h('small', null, `来源演示文件：${pendingPptImport.slides[pendingPptImportPageIndex].sourceDocumentName}`) : null,
          pendingPptImport.slides[pendingPptImportPageIndex]?.sourceImageName ? h('small', null, `原始/关联截图：${pendingPptImport.slides[pendingPptImportPageIndex].sourceImageName}`) : null,
          h('label', null, '页面标题校对 ', h('input', { 'aria-label': '待导入页面标题', value: pendingPptImport.slides[pendingPptImportPageIndex]?.title ?? '', disabled: busy, onChange: (event: any) => setPendingPptImport(current => current ? { ...current, slides: current.slides.map((slide, index) => index === pendingPptImportPageIndex ? { ...slide, title: event.target.value } : slide) } : current) })),
          pendingPptImport.slides[pendingPptImportPageIndex]?.imageDataUrl ? h('figure', { 'aria-label': `待导入第 ${pendingPptImportPageIndex + 1} 页整页参考截图` },
            h('figcaption', null, `整页参考截图${pendingPptImport.slides[pendingPptImportPageIndex]?.sourceImageName ? ` · ${pendingPptImport.slides[pendingPptImportPageIndex].sourceImageName}` : ''}`),
            h('img', { src: pendingPptImport.slides[pendingPptImportPageIndex].imageDataUrl, alt: `待导入第 ${pendingPptImportPageIndex + 1} 页整页参考截图`, style: { display: 'block', maxWidth: '100%', maxHeight: 420, objectFit: 'contain' } }),
            h('button', { type: 'button', disabled: busy, onClick: () => { const slides = [...pendingPptImport.slides]; const { imageDataUrl: _image, ...slide } = slides[pendingPptImportPageIndex]; slides[pendingPptImportPageIndex] = slide; setPendingPptImport({ ...pendingPptImport, slides }) } }, '移除整页参考截图'),
          ) : null,
          h('label', null, '从当前页起按顺序关联整页截图（PNG/JPEG，单张不超过 3 MiB） ', h('input', { type: 'file', accept: 'image/png,image/jpeg,.png,.jpg,.jpeg', multiple: true, 'aria-label': '待导入页面整页截图', disabled: busy, onChange: async (event: any) => {
            const files = Array.from(event.target.files ?? []) as File[]
            event.target.value = ''
            if (!files.length) return
            const endPageIndex = pendingPptImportPageIndex + files.length
            if (endPageIndex > pendingPptImport.slides.length) { setResult(`从第 ${pendingPptImportPageIndex + 1} 页开始只剩 ${pendingPptImport.slides.length - pendingPptImportPageIndex} 页；截图数量过多，当前导入未修改。`); return }
            if (files.some(file => !['image/png', 'image/jpeg'].includes(file.type) || file.size > 3 * 1024 * 1024)) { setResult('整页截图只支持单张不超过 3 MiB 的 PNG/JPEG；当前导入未修改。'); return }
            const replacedImageBytes = pendingPptImport.slides.slice(pendingPptImportPageIndex, endPageIndex).reduce((total, slide) => total + estimatePptImageBytes(slide.imageDataUrl), 0)
            const existingImageBytes = pendingPptImport.slides.reduce((total, slide) => total + estimatePptImageBytes(slide.imageDataUrl) + (slide.imageDataUrls ?? []).reduce((sum: number, image: string) => sum + estimatePptImageBytes(image), 0), 0)
            if (existingImageBytes - replacedImageBytes + files.reduce((total, file) => total + file.size, 0) > MAX_PPT_IMAGE_BYTES_TOTAL) { setResult('本次导入的所有页面图像总量不能超过 20 MiB；当前导入未修改。'); return }
            setBusy(true)
            try {
              const images = await Promise.all(files.map(file => new Promise<{ file: File; dataUrl: string }>((resolve, reject) => {
                const reader = new FileReader()
                reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`))
                reader.onload = () => {
                  if (typeof reader.result !== 'string' || !reader.result.startsWith(`data:${file.type};base64,`) || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/u.test(reader.result) || !hasExpectedImageSignature(reader.result, file.type)) { reject(new Error(`${file.name} 图像内容无效`)); return }
                  resolve({ file, dataUrl: reader.result })
                }
                reader.readAsDataURL(file)
              })))
              const slides = [...pendingPptImport.slides]
              images.forEach(({ file, dataUrl }, offset) => {
                const pageIndex = pendingPptImportPageIndex + offset
                slides[pageIndex] = { ...slides[pageIndex], imageDataUrl: dataUrl, sourceImageName: file.name.replace(/[\r\n\t]/gu, ' ').slice(0, 240) }
              })
              setPendingPptImport({ ...pendingPptImport, slides })
              setResult(`已按所选顺序将 ${images.length} 张整页截图关联到第 ${pendingPptImportPageIndex + 1}–${endPageIndex} 页；确认导入后可用于逐页复核和标注。`)
            } catch (error) { setResult(`整页截图导入失败：${error instanceof Error ? error.message : String(error)}；当前导入未修改。`) }
            finally { setBusy(false) }
          } })),          ...pendingPptImport.slides[pendingPptImportPageIndex]?.imageDataUrls?.map((image: string, index: number) => h('div', { key: `ppt-import-preview-image-${index}`, 'aria-label': `待导入第 ${pendingPptImportPageIndex + 1} 页图像资料 ${index + 1}` },
            h('img', { src: image, alt: `待导入第 ${pendingPptImportPageIndex + 1} 页图像资料 ${index + 1}`, style: { display: 'block', maxWidth: '100%', maxHeight: 360, objectFit: 'contain' } }),
            h('button', { type: 'button', disabled: busy, onClick: () => { const slide = pendingPptImport.slides[pendingPptImportPageIndex]; setPendingPptImport({ ...pendingPptImport, slides: pendingPptImport.slides.map((item, pageIndex) => pageIndex === pendingPptImportPageIndex ? { ...slide, imageDataUrls: slide.imageDataUrls.filter((_item: string, imageIndex: number) => imageIndex !== index) } : item) }) } }, '移除这张导入图像'),
          )) ?? [],
          renderPptChartPreview(pendingPptImport.slides[pendingPptImportPageIndex]?.chart),
          h('label', null, 'OCR 文本（请逐页校对）', h('textarea', { 'aria-label': '待导入页面 OCR 文本', value: pendingPptImport.slides[pendingPptImportPageIndex]?.content ?? pendingPptImport.slides[pendingPptImportPageIndex]?.body ?? '', rows: 8, disabled: busy, onChange: (event: any) => setPendingPptImport(current => current ? { ...current, slides: current.slides.map((slide, index) => index === pendingPptImportPageIndex ? { ...slide, content: event.target.value, body: event.target.value } : slide) } : current) }))),
          h('label', null, '页面理解备注（布局、视觉层级、图表关系）', h('textarea', { 'aria-label': '待导入页面理解', value: pendingPptImport.slides[pendingPptImportPageIndex]?.visualDescription ?? '', rows: 4, disabled: busy, onChange: (event: any) => {
            setPendingPptImport(current => {
              if (!current) return current
              const slides = [...current.slides]
              slides[pendingPptImportPageIndex] = { ...slides[pendingPptImportPageIndex], visualDescription: event.target.value }
              return { ...current, slides }
            })
          } })),
          h('div', { 'aria-label': '导入页面顺序' },
            h('button', { type: 'button', disabled: busy || pendingPptImport.slides.length <= 1, onClick: () => { if (pendingPptImport.slides.length <= 1) return; const slides = pendingPptImport.slides.filter((_slide, index) => index !== pendingPptImportPageIndex); setPendingPptImport({ ...pendingPptImport, slides }); setPendingPptImportPageIndex(Math.min(pendingPptImportPageIndex, slides.length - 1)) } }, '移除当前导入页'),
            h('button', { type: 'button', disabled: busy || pendingPptImportPageIndex <= 0, onClick: () => { const slides = [...pendingPptImport.slides]; [slides[pendingPptImportPageIndex - 1], slides[pendingPptImportPageIndex]] = [slides[pendingPptImportPageIndex], slides[pendingPptImportPageIndex - 1]]; setPendingPptImport({ ...pendingPptImport, slides }); setPendingPptImportPageIndex(pendingPptImportPageIndex - 1) } }, '将当前导入页上移'),
            h('button', { type: 'button', disabled: busy || pendingPptImportPageIndex >= pendingPptImport.slides.length - 1, onClick: () => { const slides = [...pendingPptImport.slides]; [slides[pendingPptImportPageIndex], slides[pendingPptImportPageIndex + 1]] = [slides[pendingPptImportPageIndex + 1], slides[pendingPptImportPageIndex]]; setPendingPptImport({ ...pendingPptImport, slides }); setPendingPptImportPageIndex(pendingPptImportPageIndex + 1) } }, '将当前导入页下移'),
          ),
        h('button', { type: 'button', disabled: busy, onClick: async () => {
          cancelPptUnderstanding()
          const next = { ...methodState, ppt: { ...pptState, outline: { ...pptState.outline, title: pendingPptImport.title || pptState.outline?.title, slides: pendingPptImport.slides }, visualFeedback: [], outlineStatus: 'needs-review' } }
          updateMethodDraft(selectedTask, next)
          const saved = await saveMethodDraft(next)
          if (!saved) return
          setPptPreviewPageIndex(0)
          setPendingPptImport(null)
          setResult(`已确认导入 ${pendingPptImport.slides.length} 页可编辑草稿；请逐页复核、理解和标注，再生成修改提示词。`)
        } }, '确认并保存替换当前大纲'),
        h('button', { type: 'button', disabled: busy, onClick: () => { setPendingPptImport(null); setResult('已丢弃导入；当前大纲未修改。') } }, '丢弃导入')) : null,
      h('button', { type: 'button', disabled: busy || !pptSlides.length, onClick: () => {
          try {
            const result = downloadPptxPresentation({ title: pptState.outline?.title || selectedTask.title, slides: pptSlides })
            setResult(`可编辑 PPTX 已导出：${result.filename}，${result.slideCount} 页。导出包含可编辑标题/正文文本框、PowerPoint 原生结构化柱形图及 PNG/JPEG 配图；原 HTML/CSS 布局不会保留。`)
          } catch (error) { setResult(`PPTX 导出失败：${error instanceof Error ? error.message : String(error)}`) }
        } }, '导出可编辑 PPTX（文字规划版）')),
      h('section', { 'aria-label': 'PPT 逐页视觉反馈', style: { display: 'grid', gap: 8, minWidth: 0 } },
        h('h4', null, '\u9010\u9875\u6807\u6ce8\u4e0e\u4fee\u6539\u63d0\u793a\u8bcd'),
        h('p', null, '点击页面预览定位标注点，并填写修改意见；标注会关联当前页和现有文字/图像资料。生成提示词只整理文字与页码，不会上传图片；交给外部 AI 时，请附上对应的原始截图或完整页面图。PPTX 内嵌图像可能只是局部配图，不能代替整页视觉参考。'),
        h('label', { style: pptFieldStyle }, '反馈页面 ', h('select', { 'aria-label': '反馈页面', value: pptFeedbackPageIndex, onChange: (event: any) => { cancelPptPageImageRead(); cancelPptUnderstanding(); const pageIndex = Number(event.target.value); setPptFeedbackPageIndex(pageIndex); setPptPreviewPageIndex(pageIndex); setPptFeedbackTarget(null) } }, ...(pptState.outline?.slides ?? []).map((slide, index) => h('option', { key: index, value: index }, '第 ' + (index + 1) + ' 页 · ' + (slide.title ?? '未命名页面'))))),
        h('p', { role: 'status' }, pptFeedbackTarget?.taskId === selectedTask.taskId && pptFeedbackTarget.pageIndex === pptFeedbackPageIndex ? `已定位在页面${pptFeedbackTarget.imageIndex === undefined ? '' : `图像资料 ${pptFeedbackTarget.imageIndex + 1}`} ${pptFeedbackTarget.x}, ${pptFeedbackTarget.y}（0–1 相对坐标）；保存意见后会一并带入提示词。` : '点击上方页面预览可附加画面位置；放大图像资料时点击图片可定位到该图；也可只保存页面级意见。'),
        h('label', { style: pptFieldStyle }, '反馈分类 ', h('select', { 'aria-label': '反馈分类', value: pptFeedbackCategory, onChange: (event: any) => setPptFeedbackCategory(event.target.value) }, ...[['content', '内容'], ['logic', '逻辑'], ['evidence', '证据'], ['style', '风格'], ['layout', '布局'], ['readability', '可读性'], ['other', '其他']].map(([value, label]) => h('option', { key: value, value }, label)))),
        h('label', { style: pptFieldStyle }, '反馈内容 ', h('textarea', { 'aria-label': '新增页面反馈', style: { width: '100%', boxSizing: 'border-box' }, value: pptFeedbackComment, rows: 2, onChange: (event: any) => setPptFeedbackComment(event.target.value) })),
        h('button', { type: 'button', disabled: busy || !(pptState.outline?.slides?.length), onClick: addPptFeedback }, '添加反馈'),
        h('button', { type: 'button', disabled: busy || !hasCurrentPptFeedback || !provider || !model, onClick: () => void generatePptModificationPrompt() }, '保存并生成逐页修改提示词'),
        latestPptModificationPrompt ? h('label', { 'data-testid': 'ppt-modification-prompt-preview', style: pptFieldStyle }, '最近生成的逐页修改提示词（检查后复制给外部工具） ', h('textarea', { 'aria-label': '最近生成的逐页修改提示词', value: latestPptModificationPrompt, rows: 10, readOnly: true }), h('button', { type: 'button', disabled: busy, onClick: async () => {
          const copied = await copyText(latestPptModificationPrompt)
          setResult(copied ? '已复制最近生成的逐页修改提示词。' : '复制失败；提示词仍保留在任务版本中。')
        } }, '复制最近生成的逐页修改提示词')) : null,
        hasCurrentPptFeedback && (!provider || !model) ? h('small', { role: 'status' }, '先在 Agent 模型区域选择提供方和模型，再生成逐页修改提示词。') : null,
        ...(pptState.visualFeedback ?? []).map(item => {
          const stale = item.contentSnapshot !== pptFeedbackSnapshot((pptState.outline?.slides ?? [])[item.pageIndex] ?? {})
          return h('div', { key: item.id, 'aria-label': '已记录页面反馈' },
            h('button', { type: 'button', disabled: busy, onClick: () => { cancelPptPageImageRead(); cancelPptUnderstanding(); setPptExpandedImage(null); setPptPreviewPageIndex(item.pageIndex); setPptFeedbackPageIndex(item.pageIndex); setPptFeedbackTarget(item.target?.kind === 'point' ? { taskId: selectedTask.taskId, pageIndex: item.pageIndex, ...(Number.isSafeInteger(item.target.imageIndex) ? { imageIndex: item.target.imageIndex } : {}), x: item.target.x, y: item.target.y } : null) } }, `定位到第 ${item.pageIndex + 1} 页${item.target?.kind === 'point' ? '标注' : '反馈'}`),
            h('label', null, h('input', { type: 'checkbox', checked: item.selected, disabled: busy || stale, onChange: (event: any) => updatePptFeedback(item.id, { selected: event.target.checked }) }), '第 ' + (item.pageIndex + 1) + ' 页' + (item.target?.kind === 'point' ? ` · ${item.target.imageIndex === undefined ? '页面' : `图像资料 ${item.target.imageIndex + 1}`}位置 ${item.target.x}, ${item.target.y}` : '') + ' · ' + item.category + (stale ? ' · 页面内容已变化，请重新添加反馈' : '')),
            h('textarea', { 'aria-label': '页面反馈内容', value: item.comment, rows: 2, disabled: busy || stale, onChange: (event: any) => updatePptFeedback(item.id, { comment: event.target.value }) }),
            h('button', { type: 'button', disabled: busy, onClick: () => updateMethodDraft(selectedTask, { ...methodState, ppt: { ...pptState, visualFeedback: (pptState.visualFeedback ?? []).filter(feedback => feedback.id !== item.id) } }) }, '删除反馈'))
        })),
      h('p', null, pptState.brief?.constraints?.minSlides && pptState.brief?.constraints?.maxSlides && pptState.brief.constraints.minSlides > pptState.brief.constraints.maxSlides ? '页数范围冲突：原要求已保留，请修订后再生成。' : pptState.route === 'html-final' ? '选择 HTML 成品路线后，可将已保存的逐页内容导出为离线演示；内容尚未校对时请先完成复核。' : '逐页内容为可编辑规划草稿，不代表已生成 PPT 文件。'),
      h('button', { type: 'button', disabled: busy, onClick: () => saveMethodDraft() }, '保存 PPT 状态')) : null,
    selectedTask.domain === 'writing' || selectedTask.domain === 'ppt' ? h('section', { 'aria-label': '任务材料' },
      h('h3', null, selectedTask.domain === 'writing' ? '内容材料与风格样本' : 'PPT 材料'),
      h('p', null, '每行填写：content、style 或 both | 标题 | 摘录 | 来源链接。风格样本只作为表达参考；规划提示词最多采用三条材料。'),
      h('label', null, '材料清单 ', h('textarea', { 'aria-label': '材料清单', value: taskMaterials.map(material => `${material.purpose ?? 'content'}|${material.title ?? ''}|${material.excerpt ?? ''}|${material.url ?? ''}`).join('\n'), rows: 5, onChange: (event: any) => updateMaterialDraft(selectedTask, event.target.value) })),
      h('p', null, `本任务材料：${taskMaterials.filter(material => material.selected !== false).length}/${taskMaterials.length} 条已选；未选择的摘录不会发送。`),
      h('fieldset', { 'aria-label': '导入本地材料' },
        h('legend', null, '导入本地材料'),
        h('p', { role: 'status' }, typeof workspaceFiles?.list === 'function' && typeof workspaceFiles?.read === 'function' ? '可读取当前 DSH Session 已授权工作区中的指定相对目录；每次读取只生成本地未选材料草稿，不开启后台监听。取消或读取失败时，本批次不会改动现有材料。' : '当前 DSH Host 未提供 workspaceFiles；可继续使用下方文件选择器导入材料。'),
        selectedTask.domain === 'writing' ? h('div', { 'aria-label': '从 DSH 工作区读取写作材料' },
          h('label', null, 'DSH 工作区相对目录 ', h('input', { value: workspaceMaterialDirectory, disabled: busy || typeof workspaceFiles?.list !== 'function' || typeof workspaceFiles?.read !== 'function', placeholder: '例如 docs/research 或 .', onChange: (event: any) => setWorkspaceMaterialDirectory(event.target.value) })),
          h('button', { type: 'button', disabled: busy || typeof workspaceFiles?.list !== 'function' || typeof workspaceFiles?.read !== 'function' || !conversationId.trim() || !workspaceMaterialDirectory.trim(), onClick: () => void importWorkspaceDirectoryMaterials() }, '读取并加入未选材料草稿'),
          materialImporting ? h('button', { type: 'button', onClick: cancelMaterialImport }, '取消目录读取') : null,
        ) : null,
        h('p', null, '本地文件只读取本次明确选择的 .txt、.md、.csv、.pdf、.docx、.png、.jpg、.webp 文件；文本每文件最多 512 KiB、每批 2 MiB，解析文件每个最多 20 MiB、每批最多 40 MiB。PDF/DOCX/OCR 摘录最多保留 30,000 字符。目录/文件导入均默认不选用，须逐条核对、勾选并保存。'),
        h('label', null, '材料用途 ', h('select', { value: materialPurpose, disabled: busy, onChange: (event: any) => setMaterialPurpose(event.target.value) }, h('option', { value: 'content' }, '事实/内容'), h('option', { value: 'style' }, '风格参考'), h('option', { value: 'both' }, '内容与风格'))),
        h('input', { type: 'file', 'aria-label': '选择材料文件', accept: '.txt,.md,.csv,.pdf,.docx,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp', multiple: true, disabled: busy, onChange: (event: any) => { const files = event.target.files; event.target.value = ''; return importMaterialFiles(files) } }),
        materialImporting ? h('button', { type: 'button', onClick: cancelMaterialImport }, '取消材料读取') : null,
        materialImportMessage ? h('p', { role: 'status', 'aria-live': 'polite' }, materialImportMessage) : null),      taskMaterials.length ? h('ul', { 'aria-label': '材料外发选择' }, ...taskMaterials.map((material, index) => h('li', { key: material.sourceId ?? material.id ?? `material-${index}` },
        h('label', null, h('input', { type: 'checkbox', 'aria-label': '选用本材料', checked: material.selected !== false, disabled: busy, onChange: (event: any) => updateMaterialSelection(selectedTask, index, event.target.checked) }), ` 选用：${material.title ?? `材料 ${index + 1}`} · ${material.purpose ?? 'content'}`),
        material.contentStatus === 'failed' ? h('p', { role: 'status' }, `材料解析失败：${material.contentError ?? 'read_failed'}。原文件未保存；可重新选择文件，或手动补充摘录。`) : null,
        material.contentStatus === 'parsed' ? h('p', null, `解析来源：${material.sourceType ?? '文件'}${material.sourceLocator ? ` · ${material.sourceLocator}` : ''} · ${material.verificationStatus === 'unverified' ? '尚未核验' : '已核验'}${material.truncated ? ' · 摘录已截断' : ''}`) : null,
        material.excerpt ? h('p', null, `不可信摘录预览：${material.excerpt}`) : null))) : null,
      h('button', { type: 'button', disabled: busy, onClick: () => saveMethodDraft() }, '保存方法与材料状态')) : null,
    h('section', { 'aria-label': '联网研究' },
      h('h3', null, '联网研究确认'),
      h('p', null, `目标：${selectedTask.agent?.research?.scope.objective ?? selectedTask.originalInput}`),
      h('p', null, `查询：${(selectedTask.agent?.research?.scope.queries ?? [selectedTask.originalInput]).join('；')}`),
      h('p', null, `预算：最多 ${selectedTask.agent?.research?.budget.maxQueries ?? 3} 个查询 / ${selectedTask.agent?.research?.budget.maxSources ?? 5} 条来源`),
      researchSearchActive ? h('button', { type: 'button', onClick: () => researchSearchRef.current?.abort(Object.assign(new Error('用户取消联网研究'), { code: 'cancelled' })) }, '取消联网研究') : null,
      selectedTask.agent?.research?.status === 'not-executed' && selectedTask.agent.research.decision === 'approved' ? h('div', null, h('p', { role: 'status' }, selectedTask.agent.research.message ?? '已批准，可执行联网搜索。'), h('button', { type: 'button', disabled: busy, onClick: () => void changeResearch('run') }, '执行联网搜索')) : selectedTask.agent?.research?.status === 'failed' ? h('div', null, h('p', { role: 'status' }, `搜索失败：${selectedTask.agent.research.message ?? '未知错误'}`), h('button', { type: 'button', disabled: busy, onClick: () => void changeResearch('run') }, '重试联网搜索')) : selectedTask.agent?.research?.status === 'completed' ? h('div', null, h('p', { role: 'status' }, selectedTask.agent.research.message), h('ul', null, ...selectedTask.agent.research.results.map((source, index) => h('li', { key: `${source.url}-${index}` }, h('a', { href: source.url, target: '_blank', rel: 'noreferrer' }, source.title || source.url), h('p', null, `不可信来源：${source.summary}`))))) : selectedTask.agent?.research?.status === 'awaiting-confirmation' ? h('div', null,
        h('button', { type: 'button', disabled: busy, onClick: () => void changeResearch('approve') }, '批准研究'),
        h('button', { type: 'button', disabled: busy, onClick: () => void changeResearch('reject') }, '拒绝研究'),
        h('button', { type: 'button', disabled: busy, onClick: () => void changeResearch('cancel') }, '取消研究'))
        : selectedTask.agent?.research && selectedTask.agent.research.status !== 'cancelled' ? h('p', { role: 'status' }, selectedTask.agent.research.message ?? (selectedTask.agent.research.decision === 'rejected' ? '已拒绝；本任务不再申请。' : '尚未执行联网搜索。'))
          : h('button', { type: 'button', disabled: busy, onClick: () => void changeResearch('preview') }, '预览联网研究范围')),
    h('section', { 'aria-label': '外部结果回填' },
      h('h3', null, '外部结果回填'),
      h('label', null, '关联步骤 ', h('select', { 'aria-label': '关联步骤', value: externalStepId, onChange: (event: any) => updateExternalDraft(selectedTask, { ...externalDraft, stepId: event.target.value }) }, ...externalSteps.map(step => h('option', { key: step.id, value: step.id }, step.title || step.id)))),
      h('label', null, '对应提示词版本 ', h('select', { 'aria-label': '对应提示词版本', value: externalPromptVersionId, disabled: promptVersions.length === 0 || busy, onChange: (event: any) => { const version = promptVersions.find(item => item.versionId === event.target.value); updateExternalDraft(selectedTask, { ...externalDraft, promptVersionId: event.target.value, stepId: version?.stepId ?? 'task' }) } }, ...promptVersions.map(version => h('option', { key: version.versionId, value: version.versionId }, `${version.stage}${version.stale ? ' · 需复查' : ''} · ${version.versionId.slice(0, 8)}`)))),
      promptVersions.length ? null : h('small', null, '请先运行一个阶段生成可关联的提示词版本。'),
      h('label', null, '外部 AI 结果 ', h('textarea', { 'aria-label': '外部 AI 结果', value: externalDraft.content, rows: 5, onChange: (event: any) => updateExternalDraft(selectedTask, { ...externalDraft, content: event.target.value }) })),
      h('label', null, '复盘反馈 ', h('textarea', { 'aria-label': '复盘反馈', value: externalDraft.feedback, rows: 2, onChange: (event: any) => updateExternalDraft(selectedTask, { ...externalDraft, feedback: event.target.value }) })),
      draftStorageStatusByTask[selectedTask.taskId] === 'saved' ? h('small', { role: 'status' }, '未提交输入已保存在本机') : draftStorageStatusByTask[selectedTask.taskId] === 'error' ? h('small', { role: 'alert' }, '本机草稿保存失败；当前输入仍保留在面板') : null,
      h('button', { type: 'button', disabled: busy || !externalDraft.content.trim() || !externalPromptVersionId, onClick: saveExternalResult }, '保存外部结果')),
    ...selectedTask.versions.map(version => h('details', { key: version.versionId }, h('summary', null, `${version.kind === 'external-result' ? '外部结果' : version.stage}${version.stale ? ' · 需复查' : ''}${version.memoryRevisionChanged ? ' · 生成期间记忆已变化' : ''} · ${new Date(version.createdAt).toLocaleString()}${version.promptVersionId ? ` · 关联 ${version.promptVersionId.slice(0, 8)}` : ''}`), version.staleReason ? h('small', { role: 'status' }, version.staleReason) : null, version.memoryRevisionChanged ? h('small', { role: 'alert' }, '此版本保留请求开始时的记忆快照；可重新运行对应阶段以采用当前记忆。') : null, version.model ? h('small', null, `模型 ${version.model} · 消息 ${version.sentMessages?.count ?? 0} 条 · 摘要 ${version.sentMessages?.digest ?? ''}`) : null, h('pre', { style: { whiteSpace: 'pre-wrap' } }, version.content))),
    h('section', { 'aria-label': '版本复盘' },
      h('h3', null, '版本复盘记录'),
      externalVersions.length ? h('label', null, '复盘外部结果 ', h('select', { 'aria-label': '复盘外部结果', value: selectedReviewResultId, onChange: (event: any) => setReviewResultIdsByTask(current => ({ ...current, [selectedTask.taskId]: event.target.value })) }, ...externalVersions.map(version => h('option', { key: version.versionId, value: version.versionId }, `${version.stage} · ${version.versionId.slice(0, 8)} ← ${version.promptVersionId?.slice(0, 8) ?? '无提示词关联'}`)))) : h('p', null, '带回外部结果并关联提示词版本后，可记录复盘。'),
      h('label', null, '复盘结论 ', h('select', { 'aria-label': '复盘结论', value: reviewVerdict, onChange: (event: any) => setReviewVerdict(event.target.value) }, ...[['unverified', '待验证'], ['success', '成功（用户确认）'], ['failure', '失败（用户确认）']].map(([value, label]) => h('option', { key: value, value }, label)))),
      selectedTask.currentRequirements.length ? h('fieldset', null,
        h('legend', null, '逐项验收要求'),
        ...selectedTask.currentRequirements.map((requirement, index) => h('label', { key: `${index}:${requirement}` }, requirement, ' ', h('select', {
          'aria-label': `${requirement}验收结果`,
          value: reviewCheckResultsByTask[selectedTask.taskId]?.[requirement] ?? 'not-checked',
          onChange: (event: any) => setReviewCheckResultsByTask(current => ({ ...current, [selectedTask.taskId]: { ...current[selectedTask.taskId], [requirement]: event.target.value } })),
        }, ...[['not-checked', '未检查'], ['pass', '通过'], ['fail', '未通过']].map(([value, label]) => h('option', { key: value, value }, label)))))) : h('p', null, '当前任务没有列出的验收要求。'),
      h('button', { type: 'button', disabled: busy || !selectedReviewResult?.promptVersionId, onClick: saveTaskReview }, '保存复盘记录'),
      ...(selectedTask.reviews ?? []).map(review => h('details', { key: review.reviewId },
        h('summary', null, `${review.verdict}${review.confirmed ? ' · 用户已确认' : ' · 待验证'} · 结果 ${review.resultVersionId.slice(0, 8)} / 提示词 ${review.promptVersionId.slice(0, 8)}`),
        ...(review.checks ?? []).map((check, index) => h('p', { key: `${index}:${check.requirement}` }, `${check.requirement}：${check.result === 'pass' ? '通过' : check.result === 'fail' ? '未通过' : '未检查'}`)),
        review.feedback ? h('p', null, `反馈：${review.feedback}`) : null)))) : null,
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
  h('pre', { 'data-testid': 'forward-step-rpc-result', style: { whiteSpace: 'pre-wrap', marginTop: '12px' } }, result)))
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
    const workspaceFiles = ctx.get('remote.workspaceFiles') as WorkspaceFilesRemote | undefined
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelId }, () => h(Panel, { remote: remoteCtx.remote.forwardStepProbe, workspaceFiles })))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: panelId,
      order: 80,
      label: '向前一步',
    }, PanelIcon))
  })
}

