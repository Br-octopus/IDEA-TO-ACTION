const WORKSPACE_FORMAT = 'forward-step-workspace'
const ARCHIVE_FORMAT = 'forward-step-workspace-archive'
const WORKSPACE_FIELDS = Object.freeze([
  'projects', 'prompts', 'cases', 'knowledgeEntries', 'references', 'researchSelection',
  'knowledgeSelection', 'knowledgeFilters', 'knowledgeMetadata', 'researchTasks',
  'platformConnections', 'researchAttachments', 'promptAgentTasks', 'promptAgentSources',
  'writingArticles', 'writingMemories', 'writingPacks', 'writingPackSettings',
  'writingReviews', 'academicResponseProjects',
])
const KNOWLEDGE_FIELDS = Object.freeze(['knowledgeEntries', 'cases', 'knowledgeMetadata'])
const STATE_FIELDS = Object.freeze(['researchSelection', 'knowledgeSelection', 'knowledgeFilters', 'knowledgeMetadata'])
const KNOWLEDGE_METADATA_FIELDS = new Set(['version', 'schemaVersion', 'createdAt', 'updatedAt', 'lastUpdatedAt', 'entryCount', 'caseCount', 'sourceCount', 'hiddenCount', 'nested'])
const KNOWLEDGE_METADATA_NESTED_FIELDS = new Set(['version', 'schemaVersion', 'createdAt', 'updatedAt', 'lastUpdatedAt', 'note', 'label'])
const KNOWLEDGE_FILTER_FIELDS = new Set(['query', 'type', 'domain', 'stage', 'verificationStatus'])
const isScalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value)
const SENSITIVE_KEYS = /(?:api.?key|secret|token|password|cookie|credential|authorization|auth.?header|session|profile.?path)/i
export const SOURCE_JSON_LIMITS = Object.freeze({ bytes: 128 * 1024 * 1024, records: 100_000, depth: 64 })

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function assertNestingDepth(text) {
  const stack = []
  let inString = false
  let escaped = false
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{' || character === '[') {
      stack.push(character)
      if (stack.length > SOURCE_JSON_LIMITS.depth) throw fail('source_depth_limit', '备份嵌套深度超过 64 层')
    } else if (character === '}' || character === ']') {
      const opener = stack.pop()
      if ((character === '}' && opener !== '{') || (character === ']' && opener !== '[')) {
        throw fail('invalid_json', '备份不是有效 JSON')
      }
    }
  }
}

function assertRecordCount(root) {
  let count = 0
  const pending = [root]
  while (pending.length) {
    const value = pending.pop()
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      count += value.length
      if (count > SOURCE_JSON_LIMITS.records) throw fail('source_record_limit', '备份记录数超过 100,000')
      for (const child of value) if (child && typeof child === 'object') pending.push(child)
      continue
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child)
  }
}

function countSensitiveFields(value) {
  if (!value || typeof value !== 'object') return 0
  let count = 0
  const pending = [value]
  while (pending.length) {
    const current = pending.pop()
    if (Array.isArray(current)) {
      for (const child of current) if (child && typeof child === 'object') pending.push(child)
      continue
    }
    for (const [key, child] of Object.entries(current)) {
      if (SENSITIVE_KEYS.test(key)) {
        if (child !== undefined && child !== null && child !== '') count += 1
      } else if (child && typeof child === 'object') pending.push(child)
    }
  }
  return count
}

export function isValidWritingPackSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  if (Object.hasOwn(input, 'acceptedVersion') && (!Number.isSafeInteger(input.acceptedVersion) || input.acceptedVersion < 1)) return false
  if (Object.hasOwn(input, 'history') && (!Array.isArray(input.history) || input.history.length > 50)) return false
  return true
}
function decodeJson(bytes) {
  if (!(bytes instanceof Uint8Array)) throw fail('invalid_input', '备份内容必须是字节')
  if (bytes.byteLength > SOURCE_JSON_LIMITS.bytes) throw fail('source_size_limit', 'JSON 备份超过 128 MiB')
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw fail('invalid_encoding', '备份不是有效 UTF-8')
  }
  try {
    assertNestingDepth(text)
    const parsed = JSON.parse(text)
    assertRecordCount(parsed)
    return parsed
  } catch (error) {
    if (error?.code === 'source_record_limit' || error?.code === 'source_depth_limit' || error?.code === 'invalid_json') throw error
    throw fail('invalid_json', '备份不是有效 JSON')
  }
}

function pickCategories(data, allowed) {
  const categories = {}
  const warnings = []
  let excludedSensitiveCount = 0
  const clean = value => {
    if (Array.isArray(value)) return value.map(clean)
    if (!value || typeof value !== 'object') return value
    const result = {}
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw fail('unsafe_key', '备份包含不允许的对象字段')
      if (SENSITIVE_KEYS.test(key) && child !== undefined && child !== null && child !== '') {
        excludedSensitiveCount += 1
        continue
      }
      result[key] = clean(child)
    }
    return result
  }
  for (const field of allowed) {
    if (Object.hasOwn(data, field)) {
      const validShape = field === 'knowledgeFilters' || field === 'knowledgeMetadata'
        ? Boolean(data[field] && typeof data[field] === 'object' && !Array.isArray(data[field]))
        : Array.isArray(data[field])
      if (!validShape) {
        warnings.push({ code: 'invalid_category', category: field })
        continue
      }
      const value = clean(data[field])
      if (field === 'knowledgeSelection' || field === 'researchSelection') {
        categories[field] = value.filter(item => typeof item === 'string')
        if (categories[field].length !== value.length) warnings.push({ code: 'invalid_items', category: field, count: value.length - categories[field].length })
      } else if (field === 'knowledgeFilters') {
        categories[field] = Object.fromEntries(Object.entries(value).filter(([key, item]) => KNOWLEDGE_FILTER_FIELDS.has(key) && isScalar(item)))
        const invalid = Object.keys(value).length - Object.keys(categories[field]).length
        if (invalid) warnings.push({ code: 'invalid_fields', category: field, count: invalid })
      } else if (field === 'knowledgeMetadata') {
        categories[field] = Object.fromEntries(Object.entries(value).filter(([key, item]) => KNOWLEDGE_METADATA_FIELDS.has(key) && (key === 'nested' || isScalar(item))))
        const nested = categories[field].nested
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          const cleanedNested = Object.fromEntries(Object.entries(nested).filter(([key]) => KNOWLEDGE_METADATA_NESTED_FIELDS.has(key) && isScalar(nested[key])))
          const invalidNested = Object.keys(nested).length - Object.keys(cleanedNested).length
          categories[field].nested = cleanedNested
          if (invalidNested) warnings.push({ code: 'invalid_fields', category: field, count: invalidNested })
        }
        const invalid = Object.keys(value).length - Object.keys(categories[field]).length
        if (invalid) warnings.push({ code: 'invalid_fields', category: field, count: invalid })
      } else categories[field] = value
    }
  }
  for (const [category, records] of Object.entries(categories)) {
    if (!Array.isArray(records)) continue
    const ids = new Set()
    for (const record of records) {
      const id = typeof record?.id === 'string' ? record.id
        : typeof record?.taskId === 'string' ? record.taskId
          : typeof record?.projectId === 'string' ? record.projectId : null
      if (!id) continue
      if (ids.has(id)) throw fail('duplicate_source_id', `来源类别存在重复标识: ${category}`)
      ids.add(id)
    }
  }
  const supported = new Set([...allowed, 'format', 'schemaVersion', 'appVersion', 'exportedAt', 'scope', 'counts', 'data', 'writingWorkspaces'])
  const unknownFields = []
  for (const key of Object.keys(data)) {
    if (supported.has(key)) continue
    const value = data[key]
    if (SENSITIVE_KEYS.test(key)) {
      if (value !== undefined && value !== null && value !== '') excludedSensitiveCount += 1
      continue
    }
    excludedSensitiveCount += countSensitiveFields(value)
    unknownFields.push(key)
  }
  return { categories, warnings, unknownFields, excludedSensitiveCount }
}

function applyMissingFieldDefaults(picked, scope) {
  const defaultFields = scope === 'knowledge-base' ? ['knowledgeMetadata'] : STATE_FIELDS
  for (const field of defaultFields) {
    if (Object.hasOwn(picked.categories, field)) continue
    picked.categories[field] = field === 'knowledgeFilters' || field === 'knowledgeMetadata' ? {} : []
  }
  return picked
}

export function parseSourceBackup({ format = 'json', bytes, sourceName = '' } = {}) {
  if (format !== 'json') throw fail('unsupported_format', '当前解析入口仅接受 JSON 字节；ZIP 需先经安全归档解析器校验')
  const backup = decodeJson(bytes)
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw fail('invalid_backup', '备份根节点必须是对象')

  if (backup.format === ARCHIVE_FORMAT) {
    if (backup.formatVersion !== 1 || !backup.workspace || typeof backup.workspace !== 'object' || Array.isArray(backup.workspace) || !Array.isArray(backup.attachments)) {
      throw fail('unsupported_version', '完整工作区归档 manifest 格式或版本无效')
    }
    const missingFields = STATE_FIELDS.filter(field => !Object.hasOwn(backup.workspace, field))
    const picked = applyMissingFieldDefaults(pickCategories(backup.workspace, WORKSPACE_FIELDS), 'workspace')
    return {
      format: ARCHIVE_FORMAT,
      formatVersion: 1,
      scope: 'workspace',
      categories: picked.categories,
      missingFields,
      attachments: structuredClone(backup.attachments),
      warnings: picked.warnings,
      unknownFields: picked.unknownFields,
      excludedSensitiveCount: picked.excludedSensitiveCount,
      sourceName,
    }
  }

  if (backup.format !== WORKSPACE_FORMAT) throw fail('unsupported_format', '不支持的备份格式')
  if (backup.schemaVersion !== 1) throw fail('unsupported_version', '工作区备份 schemaVersion 不受支持')
  if (!backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) throw fail('invalid_backup', '备份 data 必须是对象')
  const scope = backup.scope
  if (!['workspace', 'knowledge-base'].includes(scope)) throw fail('invalid_backup', '备份范围无效')
  const defaultFields = scope === 'knowledge-base' ? ['knowledgeMetadata'] : STATE_FIELDS
  const missingFields = defaultFields.filter(field => !Object.hasOwn(backup.data, field))
  const picked = applyMissingFieldDefaults(pickCategories(backup.data, scope === 'knowledge-base' ? KNOWLEDGE_FIELDS : WORKSPACE_FIELDS), scope)
  return {
    format: WORKSPACE_FORMAT,
    formatVersion: backup.schemaVersion,
    scope,
    categories: picked.categories,
    missingFields,
    attachments: [],
    warnings: picked.warnings,
    unknownFields: picked.unknownFields,
    excludedSensitiveCount: picked.excludedSensitiveCount,
    sourceName,
  }
}

export const sourceCategories = Object.freeze([...WORKSPACE_FIELDS])
