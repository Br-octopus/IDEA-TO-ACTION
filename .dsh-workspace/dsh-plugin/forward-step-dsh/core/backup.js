import { createHash } from 'node:crypto'
import { initialState } from './schema.js'

export const PLUGIN_BACKUP_FORMAT = 'forward-step-dsh-workspace'
export const PLUGIN_BACKUP_FORMAT_VERSION = 1
export const PLUGIN_BACKUP_SCHEMA_VERSION = 1

const COLLECTIONS = Object.freeze([
  'projects', 'tasks', 'prompts', 'cases', 'references', 'knowledgeEntries', 'knowledgeMetadata',
  'researchTasks', 'researchAttachments', 'promptAgentTasks', 'promptAgentSources', 'writingArticles',
  'writingMemories', 'writingPacks', 'writingPackSettings', 'writingReviews', 'academicResponseProjects',
  'researchSelection', 'knowledgeSelection', 'knowledgeFilters', 'memories', 'changes', 'suppressions', 'sources',
])
const SENSITIVE = /(?:api.?key|secret|token|password|cookie|credential|authorization|auth.?header|session|profile.?path)/i
const ID_FIELDS = Object.freeze({
  projects: ['projectId', 'id'], tasks: ['taskId', 'id'], prompts: ['promptId', 'id'], cases: ['caseId', 'id'],
  references: ['referenceId', 'id'], knowledgeEntries: ['id'], researchTasks: ['taskId', 'researchTaskId', 'id'],
  researchAttachments: ['attachmentId', 'id'], promptAgentTasks: ['taskId', 'id'], promptAgentSources: ['sourceId', 'id'],
  writingArticles: ['articleId', 'id'], writingMemories: ['memoryId', 'id'], writingPacks: ['packId', 'id'],
  writingPackSettings: ['packId', 'id'], writingReviews: ['reviewId', 'id'], academicResponseProjects: ['projectId', 'id'],
  memories: ['memoryId', 'id'], changes: ['eventId', 'id'], suppressions: ['suppressionId', 'id'], sources: ['sourceId', 'id'],
})

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE.test(key)).map(([key, child]) => [key, sanitize(child)]))
}

function entityId(collection, item) {
  for (const field of ID_FIELDS[collection] ?? ['id']) {
    if (typeof item?.[field] === 'string' && item[field]) return item[field]
  }
  return null
}

function validateResearchAttachmentReferences(state) {
  const attachments = new Map((state.researchAttachments ?? []).map(item => [item.id, item]))
  for (const task of state.researchTasks ?? []) {
    for (const attachmentId of task.attachments?.map(item => item.id) ?? []) {
      const attachment = attachments.get(attachmentId)
      if (!attachment || attachment.taskId !== task.id || attachment.status !== 'verified') fail('missing_attachment_reference', '社媒任务引用的附件缺失或未验证')
    }
    for (const result of task.results ?? []) {
      for (const attachmentId of result.attachmentIds ?? []) {
        const attachment = attachments.get(attachmentId)
        if (!attachment || attachment.taskId !== task.id || attachment.resultId !== result.id || attachment.status !== 'verified') fail('missing_attachment_reference', '社媒来源引用的附件缺失或未验证')
      }
    }
  }
}
export function exportPluginBackup({ state, includePreferences = false, includeServiceConfig = false, includeAttachments = false } = {}) {
  if (!state || typeof state !== 'object' || state.schemaVersion !== PLUGIN_BACKUP_SCHEMA_VERSION) fail('invalid_state', '插件状态无效')
  const data = {}
  for (const key of COLLECTIONS) {
    const value = state[key]
    if (Array.isArray(value)) data[key] = sanitize(value)
    else if (value && typeof value === 'object' && !Array.isArray(value)) data[key] = sanitize(value)
  }
  data.researchAttachments = includeAttachments ? (data.researchAttachments ?? []).filter(item => item.status === 'verified') : []
  const exportedAttachmentIds = new Set(data.researchAttachments.map(item => item.id))
  data.researchTasks = (data.researchTasks ?? []).map(task => ({
    ...task,
    attachments: (task.attachments ?? []).filter(item => exportedAttachmentIds.has(item.id)),
    results: (task.results ?? []).map(result => ({
      ...result,
      attachmentIds: (result.attachmentIds ?? []).filter(id => exportedAttachmentIds.has(id)),
    })),
  }))
  if (includeAttachments) validateResearchAttachmentReferences(data)
  if (includePreferences) data.preferences = sanitize(state.preferences ?? {})
  if (includeServiceConfig) data.serviceConfig = sanitize(state.serviceConfig ?? {})
  const backup = { format: PLUGIN_BACKUP_FORMAT, formatVersion: PLUGIN_BACKUP_FORMAT_VERSION, schemaVersion: PLUGIN_BACKUP_SCHEMA_VERSION, data }
  const bytes = Buffer.from(JSON.stringify(backup), 'utf8')
  return { backup, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export function inspectPluginBackup({ input, currentState = initialState(), mode = 'replace' } = {}) {
  const conflicts = mode === 'merge' ? findPluginBackupConflicts({ input, currentState }) : []
  const restored = conflicts.length ? structuredClone(currentState) : restorePluginBackup({ input, mode, currentState })
  const counts = {}
  for (const key of COLLECTIONS) {
    const incoming = input.data[key]
    if (Array.isArray(incoming)) counts[key] = incoming.length
    else if (incoming && typeof incoming === 'object') counts[key] = Object.keys(incoming).length
  }
  return {
    format: input.format,
    formatVersion: input.formatVersion,
    schemaVersion: input.schemaVersion,
    mode,
    counts,
    conflicts,
    preferencesIncluded: Object.hasOwn(input.data, 'preferences'),
    serviceConfigIncluded: Object.hasOwn(input.data, 'serviceConfig'),
    resultingCounts: Object.fromEntries(COLLECTIONS.map(key => [key, Array.isArray(restored[key]) ? restored[key].length : Object.keys(restored[key] ?? {}).length])),
  }
}

export function findPluginBackupConflicts({ input, currentState = initialState() } = {}) {
  if (!input || input.format !== PLUGIN_BACKUP_FORMAT || input.formatVersion !== PLUGIN_BACKUP_FORMAT_VERSION || input.schemaVersion !== PLUGIN_BACKUP_SCHEMA_VERSION || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) {
    fail('invalid_backup', '插件备份格式或版本无效')
  }
  const conflicts = []
  for (const key of COLLECTIONS) {
    const incoming = input.data[key]
    const current = currentState[key]
    if (incoming && typeof incoming === 'object' && !Array.isArray(incoming) && current && typeof current === 'object' && !Array.isArray(current)) {
      for (const [field, value] of Object.entries(incoming)) {
        if (Object.hasOwn(current, field) && JSON.stringify(current[field]) !== JSON.stringify(sanitize(value))) conflicts.push({ collection: key, key: field })
      }
      continue
    }
    if (!Array.isArray(incoming) || !Array.isArray(current)) continue
    const currentById = new Map(current.map(item => [entityId(key, item), item]).filter(([id]) => id))
    for (const item of incoming) {
      const id = entityId(key, item)
      if (!id) continue
      const existing = currentById.get(id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(sanitize(item))) conflicts.push({ collection: key, id })
    }
  }
  return conflicts
}

export function restorePluginBackup({ input, mode = 'replace', currentState = initialState() } = {}) {
  if (!input || input.format !== PLUGIN_BACKUP_FORMAT || input.formatVersion !== PLUGIN_BACKUP_FORMAT_VERSION || input.schemaVersion !== PLUGIN_BACKUP_SCHEMA_VERSION || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) {
    fail('invalid_backup', '插件备份格式或版本无效')
  }
  if (!['replace', 'merge'].includes(mode)) fail('invalid_mode', '恢复方式无效')
  const next = mode === 'replace' ? initialState() : structuredClone(currentState)
  for (const key of COLLECTIONS) {
    if (!Object.hasOwn(input.data, key)) continue
    const value = input.data[key]
    if (Array.isArray(next[key]) && Array.isArray(value)) {
      const incoming = sanitize(value)
      if (mode === 'replace') next[key] = incoming
      else {
        const current = next[key]
        for (const item of incoming) {
          const id = entityId(key, item)
          const existing = id ? current.find(candidate => entityId(key, candidate) === id) : null
          if (!existing) current.push(item)
          else if (JSON.stringify(existing) !== JSON.stringify(item)) fail('merge_conflict', `插件备份存在 ID 冲突: ${key}`)
        }
      }
    }
    else if (value && typeof value === 'object' && !Array.isArray(value)) next[key] = mode === 'merge' ? { ...next[key], ...sanitize(value) } : sanitize(value)
    else fail('invalid_backup', `插件备份类别无效: ${key}`)
  }
  if (input.data.preferences && typeof input.data.preferences === 'object') next.preferences = sanitize(input.data.preferences)
  if (input.data.serviceConfig && typeof input.data.serviceConfig === 'object') next.serviceConfig = sanitize(input.data.serviceConfig)
  validateResearchAttachmentReferences(next)
  next.revision = currentState.revision ?? 0
  return next
}
