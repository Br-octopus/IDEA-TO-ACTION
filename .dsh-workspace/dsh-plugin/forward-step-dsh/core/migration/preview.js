import { createRequire } from 'node:module'
import { isValidWritingPackSettings, sourceCategories } from './source.js'

const require = createRequire(import.meta.url)
const writingPackSchema = require('../../vendor/core/writing-pack-schema.js')
const writingPackCatalog = require('../../vendor/core/writing-pack-catalog.js')
const BUILTIN_WRITING_PACK_IDS = new Set(writingPackCatalog.getBuiltinWritingPacks().map(pack => pack.id))
const SENSITIVE_KEYS = /(?:api.?key|token|password|cookie|credential|session|profile.?path)/i

function idOf(record) {
  return typeof record?.id === 'string' ? record.id
    : typeof record?.taskId === 'string' ? record.taskId
      : typeof record?.projectId === 'string' ? record.projectId : null
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function packContentKey(pack) {
  const content = writingPackSchema.normalizeWritingPack(pack)
  for (const field of ['id', 'builtin', 'enabled', 'version', 'createdAt', 'updatedAt']) delete content[field]
  return canonical(content)
}

function analyzeWritingPacks(records, pluginState) {
  const targets = Array.isArray(pluginState.writingPacks) ? pluginState.writingPacks : []
  const mappings = new Map()
  const invalidIndices = new Set()
  const duplicateIndices = new Set()
  let duplicate = 0
  let conflict = 0
  let invalid = 0
  let invalidRevision = 0
  let ambiguous = 0
  for (const [index, record] of records.entries()) {
    let normalized
    try {
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('专业包结构无效')
      if (Object.hasOwn(record, 'version') && (!Number.isSafeInteger(record.version) || record.version < 1)) {
        invalidRevision += 1
        throw new TypeError('专业包修订号无效')
      }
      normalized = writingPackSchema.normalizeWritingPack(record)
    } catch {
      invalidIndices.add(index)
      invalid += 1
      continue
    }
    const sourceId = idOf(normalized)
    const sameContent = targets.filter(target => {
      try { return packContentKey(target) === packContentKey(normalized) } catch { return false }
    })
    if (sameContent.length > 1) {
      ambiguous += 1
      invalid += 1
      invalidIndices.add(index)
      continue
    }
    if (sameContent.length === 1) {
      duplicate += 1
      duplicateIndices.add(index)
      mappings.set(sourceId, idOf(sameContent[0]))
      continue
    }
    const idCollision = targets.some(target => idOf(target) === sourceId) || BUILTIN_WRITING_PACK_IDS.has(sourceId)
    if (idCollision) {
      conflict += 1
      mappings.set(sourceId, `import:pending:${sourceId}`)
    } else mappings.set(sourceId, sourceId)
  }
  return { mappings, invalidIndices, duplicateIndices, duplicate, conflict, invalid, invalidRevision, ambiguous }
}

export function buildImportPreview({ parsedSource, pluginState, selectedCategories } = {}) {
  if (!parsedSource?.categories || !pluginState || typeof pluginState !== 'object') {
    throw Object.assign(new Error('导入预览参数无效'), { code: 'invalid_input' })
  }
  const selected = new Set(selectedCategories ?? Object.keys(parsedSource.categories))
  const categories = {}
  const warnings = structuredClone(parsedSource.warnings ?? [])
  let excludedSensitiveCount = parsedSource.excludedSensitiveCount ?? 0
  for (const name of sourceCategories) {
    const value = parsedSource.categories[name]
    if (value === undefined) continue
    const objectCategory = value && typeof value === 'object' && !Array.isArray(value)
    const records = Array.isArray(value) ? value : objectCategory ? Object.entries(value).map(([key, item]) => ({ key, value: item })) : []
    if (!Array.isArray(value) && !objectCategory) continue
    const existingValue = pluginState[name]
    const existing = Array.isArray(value) ? (Array.isArray(existingValue) ? existingValue : [])
      : (existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue) ? Object.entries(existingValue).map(([key, item]) => ({ key, value: item })) : [])
    const existingIds = new Set((name === 'researchSelection' || name === 'knowledgeSelection'
      ? (Array.isArray(existingValue) ? existingValue.filter(id => typeof id === 'string') : [])
      : existing.map(idOf).filter(Boolean)))
    const existingKeys = new Map(existing.map(item => [item.key, item.value]))
    const importedIds = new Set()
    let duplicate = 0
    let conflict = 0
    let invalid = 0
    if (name === 'writingPackSettings') {
      const seen = new Set()
      const packAnalysis = selected.has('writingPacks') && Array.isArray(parsedSource.categories.writingPacks)
        ? analyzeWritingPacks(parsedSource.categories.writingPacks, pluginState)
        : null
      const sourcePacks = selected.has('writingPacks') && Array.isArray(parsedSource.categories.writingPacks) ? parsedSource.categories.writingPacks : []
      for (const record of records) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) { invalid += 1; continue }
        const id = idOf(record)
        if (!id) { invalid += 1; continue }
        if (seen.has(id)) { duplicate += 1; continue }
        seen.add(id)
        const sourcePackIndex = sourcePacks.findIndex(pack => idOf(pack) === id)
        const mappedId = packAnalysis?.mappings.get(id)
        if (sourcePackIndex >= 0 && packAnalysis?.invalidIndices.has(sourcePackIndex)) { invalid += 1; continue }
        const pendingNewId = typeof mappedId === 'string' && mappedId.startsWith('import:pending:')
        const targetId = mappedId && !pendingNewId ? mappedId : id
        const knownTarget = (sourcePackIndex >= 0 && Boolean(mappedId)) || BUILTIN_WRITING_PACK_IDS.has(targetId)
          || (Array.isArray(pluginState.writingPacks) && pluginState.writingPacks.some(pack => idOf(pack) === targetId))
        if (!knownTarget) { invalid += 1; continue }
        if (!isValidWritingPackSettings(record)) { invalid += 1; continue }
        let normalized
        try { normalized = writingPackSchema.normalizeWritingPackSettings({ ...record, id: targetId }) } catch { invalid += 1; continue }
        const existingSetting = pendingNewId ? null : existing.find(item => idOf(item) === targetId)
        if (existingSetting) {
          try {
            if (canonical(writingPackSchema.normalizeWritingPackSettings(existingSetting)) === canonical(normalized)) duplicate += 1
            else conflict += 1
          } catch { conflict += 1 }
        }
      }
      categories[name] = { sourceCount: records.length, selected: selected.has(name), status: selected.has(name) ? 'ready' : 'skipped', duplicate, conflict, invalid }
      continue
    }
    let packAnalysis = null
    const invalidPackRecords = new Set()
    if (name === 'writingPacks') {
      packAnalysis = analyzeWritingPacks(records, pluginState)
      for (const index of packAnalysis.invalidIndices) invalidPackRecords.add(index)
      duplicate = packAnalysis.duplicate
      conflict = packAnalysis.conflict
      invalid += packAnalysis.invalid
      if (packAnalysis.invalidRevision) warnings.push({ code: 'invalid_pack_revision', category: name, count: packAnalysis.invalidRevision })
      const compatibleCandidates = records.filter((record, index) => !invalidPackRecords.has(index) && !packAnalysis.duplicateIndices.has(index) && record)
      if (compatibleCandidates.length) warnings.push({ code: 'pack_compatibility_unverified', category: name, count: compatibleCandidates.length })
      if (packAnalysis.ambiguous) warnings.push({ code: 'ambiguous_pack_content', category: name, count: packAnalysis.ambiguous })
    }
    if (name === 'researchSelection' || name === 'knowledgeSelection') {
      const seen = new Set()
      for (const id of records) {
        if (typeof id !== 'string' || !id.trim()) { invalid += 1; continue }
        if (seen.has(id)) { duplicate += 1; continue }
        seen.add(id)
        if (existingIds.has(id)) conflict += 1
      }
      invalid += (parsedSource.warnings ?? []).filter(item => item.category === name && item.code === 'invalid_items').reduce((sum, item) => sum + (Number.isSafeInteger(item.count) ? item.count : 1), 0)
      categories[name] = { sourceCount: records.length, selected: selected.has(name), status: selected.has(name) ? 'ready' : 'skipped', duplicate, conflict, invalid }
      continue
    }
    for (const [index, record] of records.entries()) {
      if (name === 'writingPacks' && invalidPackRecords.has(index)) continue
      if (!record || typeof record !== 'object' || Array.isArray(record)) { invalid += 1; continue }
      const id = idOf(record)
      if (id && importedIds.has(id)) { duplicate += 1; continue }
      if (id) importedIds.add(id)
      if (id && existingIds.has(id) && name !== 'writingPacks') conflict += 1
      if (objectCategory && existingKeys.has(record.key)) {
        if (JSON.stringify(existingKeys.get(record.key)) === JSON.stringify(record.value)) duplicate += 1
        else conflict += 1
      }
      const inspect = value => {
        if (!value || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) {
          if (SENSITIVE_KEYS.test(key) && child !== undefined && child !== null && child !== '') excludedSensitiveCount += 1
          else if (child && typeof child === 'object') inspect(child)
        }
      }
      inspect(record)
    }
    invalid += (parsedSource.warnings ?? []).filter(item => item.category === name && ['invalid_fields', 'invalid_items'].includes(item.code)).reduce((sum, item) => sum + (Number.isSafeInteger(item.count) ? item.count : 1), 0)
    categories[name] = {
      sourceCount: records.length,
      selected: selected.has(name),
      status: selected.has(name) ? 'ready' : 'skipped',
      duplicate,
      conflict,
      invalid,
    }
  }
  const mode = parsedSource.scope === 'knowledge-base' ? 'knowledge-only' : 'workspace'
  const unsupportedStructures = (parsedSource.warnings ?? [])
    .filter(item => ['invalid_category', 'invalid_fields', 'invalid_items'].includes(item?.code)
      && typeof item.category === 'string')
    .map(item => ({
      category: item.category,
      reason: item.code,
      count: Number.isSafeInteger(item.count) && item.count >= 0 ? item.count : 1,
    }))
  const missingFields = new Set(parsedSource.missingFields ?? [])
  const knowledgeCategories = new Set(['knowledgeEntries', 'cases', 'knowledgeMetadata'])
  const sourceCoverage = sourceCategories.map(category => {
    const inScope = mode !== 'knowledge-only' || knowledgeCategories.has(category)
    const sourceIncluded = inScope && Object.hasOwn(parsedSource.categories, category) && !missingFields.has(category)
    const value = parsedSource.categories[category]
    const count = Array.isArray(value) ? value.length
      : value && typeof value === 'object' ? Object.keys(value).length
        : 0
    return {
      category,
      sourceIncluded,
      supported: inScope,
      status: !inScope ? 'not_in_scope' : sourceIncluded ? 'included' : 'missing_from_source',
      count: sourceIncluded ? count : 0,
    }
  })
  if (mode === 'workspace') sourceCoverage.push({
    category: 'writingWorkspaces', sourceIncluded: false, supported: false,
    status: 'not_exported_by_source_backup', count: 0,
  })
  return {
    policyVersion: 1,
    mode,
    source: { format: parsedSource.format, formatVersion: parsedSource.formatVersion, scope: parsedSource.scope },
    categories,
    sourceCoverage,
    defaultedFields: (parsedSource.missingFields ?? []).filter(field => ['researchSelection', 'knowledgeSelection', 'knowledgeFilters', 'knowledgeMetadata'].includes(field)).map(field => ({
      field,
      value: field === 'knowledgeFilters' ? 'default' : field === 'knowledgeMetadata' ? 'empty_object' : 'empty',
      reason: 'missing_from_source',
    })),
    notIncludedCategories: mode === 'workspace'
      ? [{ category: 'writingWorkspaces', reason: 'not_exported_by_source_backup' }]
      : [],
    settings: {
      legacyApplication: { sourceIncluded: false, status: 'not_in_source_backup', reason: 'stored_separately' },
      pluginPreferences: { sourceIncluded: false, status: 'preserved', reason: 'plugin_owned_configuration' },
      pluginServiceConfig: { sourceIncluded: false, status: 'preserved', reason: 'plugin_owned_configuration', exportRequiresExplicitOptIn: true },
      dshHost: { sourceIncluded: false, status: 'host_managed', reason: 'managed_by_dsh' },
      credentials: { sourceIncluded: false, status: 'excluded', count: excludedSensitiveCount },
    },
    attachments: { count: parsedSource.attachments?.length ?? 0, payloadIncluded: parsedSource.format === 'forward-step-workspace-archive' },
    warnings,
    unsupportedFields: [...(parsedSource.unknownFields ?? [])],
    unsupportedStructures,
    excludedSensitiveCount,
  }
}
