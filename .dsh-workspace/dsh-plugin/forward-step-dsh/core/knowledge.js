import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const schema = require('../vendor/core/knowledge-schema.js')
const search = require('../vendor/core/knowledge-search.js')

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

export async function saveKnowledgeEntry(store, input, { expectedRevision, eventId } = {}) {
  if (!input || typeof input !== 'object' || !Number.isInteger(expectedRevision) || typeof eventId !== 'string' || !eventId.trim()) {
    fail('invalid_input', '资料条目或事务参数无效')
  }
  const entry = schema.normalizeKnowledgeEntry({ ...input, id: input.id || randomUUID() })
  if (!entry.id || !entry.title) fail('invalid_input', '资料标识和标题不能为空')
  const committed = await store.transact(expectedRevision, eventId, state => {
    const index = state.knowledgeEntries.findIndex(item => item.id === entry.id)
    if (index < 0) state.knowledgeEntries.unshift(entry)
    else state.knowledgeEntries[index] = entry
    state.knowledgeMetadata = { ...state.knowledgeMetadata, schemaVersion: 1, indexedAt: new Date().toISOString() }
    state.changes.push({ eventId, reason: '保存资料条目', sourceId: entry.id, createdAt: new Date().toISOString() })
  })
  return structuredClone(committed.knowledgeEntries.find(item => item.id === entry.id))
}

export async function removeKnowledgeEntry(store, entryId, { expectedRevision, eventId } = {}) {
  if (typeof entryId !== 'string' || !entryId.trim()) fail('invalid_input', '资料标识不能为空')
  return store.transact(expectedRevision, eventId, state => {
    const before = state.knowledgeEntries.length
    state.knowledgeEntries = state.knowledgeEntries.filter(item => item.id !== entryId)
    if (state.knowledgeEntries.length === before) fail('not_found', '资料条目不存在')
    state.knowledgeSelection = state.knowledgeSelection.filter(id => id !== entryId)
    state.changes.push({ eventId, reason: '删除资料条目', sourceId: entryId, createdAt: new Date().toISOString() })
  })
}

export async function updateKnowledgeFlags(store, entryId, patch, { expectedRevision, eventId } = {}) {
  if (!patch || Object.keys(patch).some(key => !['favorite', 'pinned', 'hiddenAt'].includes(key))) fail('invalid_input', '资料状态变更字段无效')
  const current = store.read().knowledgeEntries.find(item => item.id === entryId)
  if (!current) fail('not_found', '资料条目不存在')
  return saveKnowledgeEntry(store, { ...current, ...patch, updatedAt: new Date().toISOString() }, { expectedRevision, eventId })
}

export function searchKnowledgeEntries(state, query, filters = {}) {
  const entries = Array.isArray(state?.knowledgeEntries) ? state.knowledgeEntries.filter(item => !item.hiddenAt) : []
  return search.searchKnowledge(entries, String(query ?? ''), {
    domains: filters.domains,
    stages: filters.stages,
    types: filters.types,
    verificationStatus: filters.verificationStatus,
    limit: filters.limit,
  })
}

export async function setKnowledgeFilters(store, filters, { expectedRevision, eventId } = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) fail('invalid_input', '资料筛选条件无效')
  const allowed = new Set(['query', 'type', 'domain', 'stage', 'verificationStatus', 'favoriteOnly', 'pinnedOnly'])
  if (Object.keys(filters).some(key => !allowed.has(key))) fail('invalid_input', '资料筛选条件包含未知字段')
  const text = (value, name, limit = 120) => {
    if (value === undefined || value === '') return ''
    if (typeof value !== 'string' || value.length > limit) fail('invalid_input', `${name}格式无效`)
    return value.trim()
  }
  if (filters.favoriteOnly !== undefined && typeof filters.favoriteOnly !== 'boolean') fail('invalid_input', '收藏筛选值无效')
  if (filters.pinnedOnly !== undefined && typeof filters.pinnedOnly !== 'boolean') fail('invalid_input', '置顶筛选值无效')
  const normalized = {
    query: text(filters.query, '关键词', 200),
    type: text(filters.type, '资料类型'),
    domain: text(filters.domain, '领域'),
    stage: text(filters.stage, '阶段'),
    verificationStatus: text(filters.verificationStatus, '验证状态'),
    favoriteOnly: filters.favoriteOnly === true,
    pinnedOnly: filters.pinnedOnly === true,
  }
  return store.transact(expectedRevision, eventId, state => {
    state.knowledgeFilters = normalized
    state.changes.push({ eventId, reason: '更新资料筛选条件', createdAt: new Date().toISOString() })
  })
}

export async function setKnowledgeSelection(store, ids, { expectedRevision, eventId } = {}) {
  if (!Array.isArray(ids) || ids.length > 5 || ids.some(id => typeof id !== 'string')) fail('invalid_input', '资料选择最多五条且必须提供标识')
  const unique = [...new Set(ids)]
  return store.transact(expectedRevision, eventId, state => {
    const known = new Set(state.knowledgeEntries.filter(item => !item.hiddenAt).map(item => item.id))
    if (unique.some(id => !known.has(id))) fail('invalid_input', '选择中包含不可用资料')
    state.knowledgeSelection = unique
    state.changes.push({ eventId, reason: '更新资料选择', createdAt: new Date().toISOString() })
  })
}

export function buildSelectedKnowledgeContext(state, { maxItems = 5, maxChars = 12000 } = {}) {
  const allowed = new Set((state?.knowledgeSelection ?? []).slice(0, Math.min(5, maxItems)))
  const selected = (state?.knowledgeEntries ?? []).filter(item => allowed.has(item.id) && !item.hiddenAt)
  const sources = selected.map(item => ({
    sourceId: item.id,
    kind: 'knowledge',
    locator: item.sourceUrl || item.sourceType || 'plugin-knowledge',
    excerpt: item.contentExcerpt || item.summary || '',
  }))
  const digest = createHash('sha256').update(JSON.stringify({ sourceIds: selected.map(item => item.id), sources }), 'utf8').digest('hex')
  return { sourceIds: selected.map(item => item.id), sources, digest, text: search.buildKnowledgeContext(selected, selected.length, maxChars) }
}

export const knowledgeEntrySchema = schema

const WORKSPACE_KNOWLEDGE_SOURCE_TYPE = 'DSH workspaceFiles 授权目录快照'
const WORKSPACE_KNOWLEDGE_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rst', '.adoc', '.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.log',
  '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.ini', '.cfg', '.conf', '.properties',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.css', '.scss', '.less',
  '.py', '.pyi', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.php', '.swift', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.graphql',
  '.gql', '.proto',
])
const WORKSPACE_KNOWLEDGE_MAX_FILES = 100
const WORKSPACE_KNOWLEDGE_MAX_FILE_BYTES = 512 * 1024
const WORKSPACE_KNOWLEDGE_MAX_BATCH_BYTES = 8 * 1024 * 1024

function normalizeWorkspaceDirectoryPath(value) {
  if (typeof value !== 'string') fail('invalid_directory', '目录路径必须是相对路径')
  const path = value.trim().replaceAll('\\', '/').replace(/\/+$/u, '')
  if (path === '.') return path
  if (!path || path.length > 320 || path.startsWith('/') || /^[a-z]:/iu.test(path) || path.includes('\0')) fail('invalid_directory', '目录路径必须是当前 DSH 工作区内的相对路径')
  const segments = path.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) fail('invalid_directory', '目录路径不能包含空路径段、当前目录或上级目录')
  return segments.join('/')
}

function workspaceSourcePrefix(sessionId, directoryPath) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200 || sessionId.includes('\0')) fail('invalid_session', 'DSH Session 标识无效')
  const sessionHash = createHash('sha256').update(sessionId, 'utf8').digest('hex')
  return `dsh-workspace:${sessionHash}:${encodeURIComponent(normalizeWorkspaceDirectoryPath(directoryPath))}:`
}

function workspaceKnowledgeEntry(prefix, file) {
  if (!file || typeof file !== 'object' || typeof file.relativePath !== 'string' || typeof file.text !== 'string') fail('invalid_input', '目录文件快照格式无效')
  const relativePath = file.relativePath.replaceAll('\\', '/')
  const segments = relativePath.split('/')
  const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase()
  if (!relativePath || relativePath.length > 320 || segments.some(segment => !segment || segment === '.' || segment === '..') || relativePath.startsWith('/') || /^[a-z]:/iu.test(relativePath) || relativePath.includes('\0') || segments.some(segment => segment.includes(':')) || !WORKSPACE_KNOWLEDGE_EXTENSIONS.has(extension)) {
    fail('invalid_file_path', '目录文件路径无效或类型不受支持')
  }
  const text = file.text.trim()
  if (!text || text.includes('\0')) fail('invalid_file_content', '目录文件内容为空或含无效字符')
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > WORKSPACE_KNOWLEDGE_MAX_FILE_BYTES) fail('file_size_limit', '目录文件超过单文件索引上限')
  const sourceId = `${prefix}${encodeURIComponent(relativePath)}`
  const id = `dsh-workspace-${createHash('sha256').update(sourceId, 'utf8').digest('hex')}`
  const title = segments.at(-1)
  return {
    id,
    type: 'manual-note',
    title,
    sourceType: WORKSPACE_KNOWLEDGE_SOURCE_TYPE,
    sourceKind: 'reference',
    sourceId,
    verificationStatus: 'unverified',
    summary: text.slice(0, 400),
    contentExcerpt: text.slice(0, 1200),
    limitations: '用户为当前 DSH Session 明确选择的只读目录快照；按不可信资料处理。刷新会更新快照，撤销会删除本目录索引。',
    keywords: [title, relativePath],
  }
}

export function listWorkspaceKnowledgeDirectories(state, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200) return []
  const sessionHash = createHash('sha256').update(sessionId, 'utf8').digest('hex')
  const prefix = `dsh-workspace:${sessionHash}:`
  const counts = new Map()
  for (const entry of state?.knowledgeEntries ?? []) {
    if (entry?.sourceType !== WORKSPACE_KNOWLEDGE_SOURCE_TYPE || typeof entry.sourceId !== 'string' || !entry.sourceId.startsWith(prefix)) continue
    const remainder = entry.sourceId.slice(prefix.length)
    const separator = remainder.indexOf(':')
    if (separator < 1) continue
    let directoryPath
    try { directoryPath = decodeURIComponent(remainder.slice(0, separator)) } catch { continue }
    if (directoryPath) counts.set(directoryPath, (counts.get(directoryPath) ?? 0) + 1)
  }
  return [...counts].map(([directoryPath, count]) => ({ directoryPath, count })).sort((a, b) => a.directoryPath.localeCompare(b.directoryPath))
}

export async function syncWorkspaceKnowledgeDirectory(store, { sessionId, directoryPath, files, expectedRevision, eventId } = {}) {
  if (!Array.isArray(files) || files.length > WORKSPACE_KNOWLEDGE_MAX_FILES) fail('file_count_limit', `一次最多索引 ${WORKSPACE_KNOWLEDGE_MAX_FILES} 个文本文件`)
  if (!Number.isInteger(expectedRevision) || typeof eventId !== 'string' || !eventId.trim()) fail('invalid_input', '目录索引事务参数无效')
  const prefix = workspaceSourcePrefix(sessionId, directoryPath)
  const entries = files.map(file => workspaceKnowledgeEntry(prefix, file))
  const uniquePaths = new Set(entries.map(entry => entry.sourceId))
  if (uniquePaths.size !== entries.length) fail('duplicate_path', '目录快照包含重复文件路径')
  const totalBytes = files.reduce((total, file) => total + Buffer.byteLength(String(file?.text ?? '').trim(), 'utf8'), 0)
  if (totalBytes > WORKSPACE_KNOWLEDGE_MAX_BATCH_BYTES) fail('batch_size_limit', '目录文本总量超过索引上限')
  let removedCount = 0
  const committed = await store.transact(expectedRevision, eventId, state => {
    const previous = state.knowledgeEntries.filter(entry => entry?.sourceType === WORKSPACE_KNOWLEDGE_SOURCE_TYPE && typeof entry.sourceId === 'string' && entry.sourceId.startsWith(prefix))
    const previousBySourceId = new Map(previous.map(entry => [entry.sourceId, entry]))
    const targetIds = new Set(entries.map(entry => entry.id))
    const collision = state.knowledgeEntries.find(entry => targetIds.has(entry.id) && (entry.sourceType !== WORKSPACE_KNOWLEDGE_SOURCE_TYPE || !entry.sourceId?.startsWith(prefix)))
    if (collision) fail('id_conflict', '目录快照标识与现有资料冲突')
    const normalized = entries.map(entry => {
      const old = previousBySourceId.get(entry.sourceId)
      return schema.normalizeKnowledgeEntry({
        ...old,
        ...entry,
        ...(old ? { favorite: old.favorite, pinned: old.pinned, domains: old.domains, stages: old.stages, userRating: old.userRating, customAliases: old.customAliases } : {}),
        updatedAt: new Date().toISOString(),
      })
    })
    const kept = state.knowledgeEntries.filter(entry => entry?.sourceType !== WORKSPACE_KNOWLEDGE_SOURCE_TYPE || typeof entry.sourceId !== 'string' || !entry.sourceId.startsWith(prefix))
    state.knowledgeEntries = [...normalized, ...kept]
    const indexedIds = new Set(normalized.map(entry => entry.id))
    const removedIds = new Set(previous.filter(entry => !indexedIds.has(entry.id)).map(entry => entry.id))
    removedCount = removedIds.size
    state.knowledgeSelection = state.knowledgeSelection.filter(id => !removedIds.has(id))
    state.knowledgeMetadata = { ...state.knowledgeMetadata, schemaVersion: 1, indexedAt: new Date().toISOString() }
    state.changes.push({ eventId, reason: '刷新 DSH 授权目录资料快照', sourceId: createHash('sha256').update(prefix, 'utf8').digest('hex'), createdAt: new Date().toISOString() })
  })
  return { indexed: entries.length, removed: removedCount, revision: committed.revision }
}

export async function revokeWorkspaceKnowledgeDirectory(store, { sessionId, directoryPath, expectedRevision, eventId } = {}) {
  if (!Number.isInteger(expectedRevision) || typeof eventId !== 'string' || !eventId.trim()) fail('invalid_input', '撤销目录事务参数无效')
  const prefix = workspaceSourcePrefix(sessionId, directoryPath)
  let removedCount = 0
  const committed = await store.transact(expectedRevision, eventId, state => {
    const removed = state.knowledgeEntries.filter(entry => entry?.sourceType === WORKSPACE_KNOWLEDGE_SOURCE_TYPE && typeof entry.sourceId === 'string' && entry.sourceId.startsWith(prefix))
    const removedIds = new Set(removed.map(entry => entry.id))
    removedCount = removedIds.size
    state.knowledgeEntries = state.knowledgeEntries.filter(entry => !removedIds.has(entry.id))
    state.knowledgeSelection = state.knowledgeSelection.filter(id => !removedIds.has(id))
    state.changes.push({ eventId, reason: '撤销 DSH 授权目录快照', sourceId: createHash('sha256').update(prefix, 'utf8').digest('hex'), createdAt: new Date().toISOString() })
  })
  return { removed: removedCount, revision: committed.revision }
}
