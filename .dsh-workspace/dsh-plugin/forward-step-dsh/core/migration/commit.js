import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createImportReceipt, pruneImportReceipts } from './receipt.js'
import { isValidWritingPackSettings } from './source.js'

const require = createRequire(import.meta.url)
const writingPackSchema = require('../../vendor/core/writing-pack-schema.js')
const writingPackCatalog = require('../../vendor/core/writing-pack-catalog.js')
const BUILTIN_WRITING_PACK_IDS = new Set(writingPackCatalog.getBuiltinWritingPacks().map(pack => pack.id))

const REFERENCE_TARGETS = Object.freeze({
  taskId: 'researchTasks', projectId: 'projects', promptId: 'prompts', articleId: 'writingArticles',
  writingArticleId: 'writingArticles', knowledgeEntryId: 'knowledgeEntries', referenceId: 'references',
})
const SELECTION_TARGETS = Object.freeze({ researchSelection: { categories: ['references'], limit: 3 }, knowledgeSelection: { categories: ['knowledgeEntries'], limit: 5 } })
const KNOWLEDGE_FILTER_FIELDS = new Set(['query', 'type', 'domain', 'stage', 'verificationStatus'])
const KNOWLEDGE_METADATA_FIELDS = new Set(['version', 'schemaVersion', 'createdAt', 'updatedAt', 'lastUpdatedAt', 'entryCount', 'caseCount', 'sourceCount', 'hiddenCount', 'nested'])
const KNOWLEDGE_METADATA_NESTED_FIELDS = new Set(['version', 'schemaVersion', 'createdAt', 'updatedAt', 'lastUpdatedAt', 'note', 'label'])
const isScalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value)

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex') }
function contentDigest(record) {
  const content = { ...record }
  delete content.id
  delete content.storageRef
  delete content.storageSha256
  return digest(content)
}
function writingPackContentDigest(record) {
  const content = writingPackSchema.normalizeWritingPack(record)
  for (const field of ['id', 'builtin', 'basePackId', 'enabled', 'version', 'createdAt', 'updatedAt']) delete content[field]
  return digest(content)
}
function recordId(record) { return typeof record?.id === 'string' ? record.id : null }
function categoryCount(value) {
  return Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0
}
function fail(code, message) { throw Object.assign(new Error(message), { code }) }

function dependencyGroups(categories, selected) {
  const parent = new Map([...selected].map(category => [category, category]))
  const find = category => {
    let root = category
    while (parent.get(root) !== root) root = parent.get(root)
    while (category !== root) {
      const next = parent.get(category)
      parent.set(category, root)
      category = next
    }
    return root
  }
  const union = (left, right) => {
    if (parent.has(left) && parent.has(right)) parent.set(find(left), find(right))
  }
  for (const [category, selection] of Object.entries(SELECTION_TARGETS)) {
    if (!selected.has(category)) continue
    for (const targetCategory of selection.categories) if (selected.has(targetCategory)) union(category, targetCategory)
  }
  if (selected.has('writingPacks') && selected.has('writingPackSettings')) {
    const packIds = new Set((categories.writingPacks ?? []).map(recordId).filter(Boolean))
    for (const setting of categories.writingPackSettings ?? []) {
      if (packIds.has(recordId(setting))) union('writingPacks', 'writingPackSettings')
    }
  }
  for (const [category, records] of Object.entries(categories)) {
    if (!selected.has(category) || !Array.isArray(records)) continue
    for (const record of records) {
      for (const [field, targetCategory] of Object.entries(REFERENCE_TARGETS)) {
        if (typeof record?.[field] === 'string') union(category, targetCategory)
      }
    }
  }
  const groups = new Map()
  for (const category of selected) {
    const root = find(category)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(category)
  }
  return [...groups.values()]
}

function importGroup(state, categories, group) {
  const selected = new Set(group)
  const idMaps = new Map()
  const insertedRecords = []
  const idMappings = []
  const invalidByCategory = {}
  const duplicateByCategory = {}
  const conflictByCategory = {}
  const importedCounts = {}
  const orderedGroup = [...group].sort((left, right) => {
    const selectionOrder = Number(Object.hasOwn(SELECTION_TARGETS, left)) - Number(Object.hasOwn(SELECTION_TARGETS, right))
    if (selectionOrder) return selectionOrder
    if (left === 'writingPacks') return -1
    if (right === 'writingPacks') return 1
    if (left === 'writingPackSettings') return 1
    if (right === 'writingPackSettings') return -1
    return 0
  })
  let invalidSelections = 0
  for (const category of orderedGroup) {
    const records = categories[category]
    if (category === 'writingPackSettings') {
      if (!Array.isArray(records) || !Array.isArray(state.writingPackSettings) || !Array.isArray(state.writingPacks)) fail('unsupported_category', '插件状态不支持此导入类别')
      const sourceIds = new Set()
      let invalid = 0
      let imported = 0
      for (const sourceSetting of records) {
        if (!sourceSetting || typeof sourceSetting !== 'object' || Array.isArray(sourceSetting) || typeof sourceSetting.id !== 'string' || !sourceSetting.id.trim()) {
          invalid += 1
          continue
        }
        if (sourceIds.has(sourceSetting.id)) fail('duplicate_source_id', '所选类别包含重复来源标识')
        sourceIds.add(sourceSetting.id)
        const mappedId = idMaps.get('writingPacks')?.get(sourceSetting.id)
        const hasTargetPack = mappedId
          ? true
          : BUILTIN_WRITING_PACK_IDS.has(sourceSetting.id) || state.writingPacks.some(pack => recordId(pack) === sourceSetting.id)
        if (!hasTargetPack) {
          invalid += 1
          continue
        }
        if (!isValidWritingPackSettings(sourceSetting)) { invalid += 1; continue }
        let setting
        try {
          setting = writingPackSchema.normalizeWritingPackSettings({ ...sourceSetting, id: mappedId ?? sourceSetting.id })
        } catch {
          invalid += 1
          continue
        }
        const rewriteSnapshotId = snapshot => {
          if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && snapshot.id === sourceSetting.id) snapshot.id = setting.id
        }
        rewriteSnapshotId(setting.acceptedPack)
        for (const snapshot of setting.history ?? []) rewriteSnapshotId(snapshot)
        const existing = state.writingPackSettings.find(item => recordId(item) === setting.id)
        if (existing) {
          if (canonical(existing) === canonical(setting)) duplicateByCategory[category] = (duplicateByCategory[category] ?? 0) + 1
          else conflictByCategory[category] = (conflictByCategory[category] ?? 0) + 1
          continue
        }
        state.writingPackSettings.push(setting)
        if (setting.id !== sourceSetting.id || idMaps.get('writingPacks')?.has(sourceSetting.id)) {
          idMappings.push({ category, sourceId: sourceSetting.id, targetId: setting.id })
        }
        imported += 1
      }
      invalidByCategory[category] = invalid
      importedCounts[category] = imported
      continue
    }
    if (Object.hasOwn(SELECTION_TARGETS, category)) {
      if (!Array.isArray(records) || !Array.isArray(state[category])) fail('unsupported_category', '插件状态不支持此导入类别')
      const { categories: targetCategories, limit } = SELECTION_TARGETS[category]
      const idMap = new Map(targetCategories.flatMap(targetCategory => [...(idMaps.get(targetCategory) ?? new Map())]))
      const selectedIds = []
      let invalid = 0
      let duplicates = 0
      for (const sourceId of records) {
        if (typeof sourceId !== 'string') { invalid += 1; continue }
        const targetId = idMap.get(sourceId) ?? null
        if (!targetId) { invalid += 1; continue }
        if (selectedIds.includes(targetId)) { duplicates += 1; continue }
        if (selectedIds.length < limit) selectedIds.push(targetId)
        else invalid += 1
      }
      state[category] = selectedIds
      invalidByCategory[category] = invalid
      duplicateByCategory[category] = duplicates
      importedCounts[category] = selectedIds.length
      continue
    }
    const objectCategory = records && typeof records === 'object' && !Array.isArray(records)
    if (objectCategory) {
      const target = state[category]
      if (!target || typeof target !== 'object' || Array.isArray(target)) fail('unsupported_category', '插件状态不支持此导入类别')
      let supported = records
      if (category === 'knowledgeFilters') supported = Object.fromEntries(Object.entries(records).filter(([key, value]) => KNOWLEDGE_FILTER_FIELDS.has(key) && isScalar(value)))
      if (category === 'knowledgeMetadata') {
        supported = Object.fromEntries(Object.entries(records).filter(([key, value]) => KNOWLEDGE_METADATA_FIELDS.has(key) && (key === 'nested' ? value && typeof value === 'object' && !Array.isArray(value) : isScalar(value))))
        if (supported.nested) supported.nested = Object.fromEntries(Object.entries(supported.nested).filter(([key, value]) => KNOWLEDGE_METADATA_NESTED_FIELDS.has(key) && isScalar(value)))
      }
      const invalid = Object.keys(records).length - Object.keys(supported).length
      invalidByCategory[category] = invalid
      importedCounts[category] = Object.keys(supported).length
      for (const [key, value] of Object.entries(supported)) if (!Object.hasOwn(target, key)) target[key] = structuredClone(value)
      continue
    }
    if (!Array.isArray(records) || !Array.isArray(state[category])) fail('unsupported_category', '插件状态不支持此导入类别')
    const target = state[category]
    const idMap = new Map()
    const sourceIds = new Set()
    idMaps.set(category, idMap)
    for (const item of records) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail('invalid_source_record', '导入记录结构无效')
      const id = recordId(item)
      if (id && sourceIds.has(id)) fail('duplicate_source_id', '所选类别包含重复来源标识')
      if (id) sourceIds.add(id)
      let importItem = item
      if (category === 'writingPacks') {
        try {
          const hasKnownVersion = !Object.hasOwn(item, 'version') || (Number.isSafeInteger(item.version) && item.version > 0)
          if (!hasKnownVersion) throw new TypeError('专业包版本无效')
          importItem = { ...writingPackSchema.normalizeWritingPack(item), builtin: false }
        } catch {
          fail('invalid_source_record', '来源专业包结构或修订号无效；其关联设置未导入')
        }
      }
      const sameContent = category === 'writingPacks'
        ? target.filter(existing => writingPackContentDigest(existing) === writingPackContentDigest(importItem))
        : target.filter(existing => contentDigest(existing) === contentDigest(importItem))
      if (sameContent.length > 1) fail('ambiguous_duplicate_content', '相同内容对应多个插件记录，无法安全确定引用目标')
      if (sameContent.length === 1) {
        const targetId = recordId(sameContent[0])
        if (id && targetId) { idMap.set(id, targetId); idMappings.push({ category, sourceId: id, targetId }) }
        continue
      }
      const sameId = id && (target.find(existing => recordId(existing) === id) || (category === 'writingPacks' && BUILTIN_WRITING_PACK_IDS.has(id)))
      const next = structuredClone(importItem)
      if (sameId) {
        do { next.id = `import:${randomUUID()}` } while (target.some(existing => recordId(existing) === next.id))
      }
      target.push(next)
      insertedRecords.push({ category, record: next })
      if (id && recordId(next)) { idMap.set(id, recordId(next)); idMappings.push({ category, sourceId: id, targetId: recordId(next) }) }
    }
  }
  // 每个依赖连通组在一个状态事务内映射，失败就不会留下半组数据。
  for (const { category, record } of insertedRecords) {
    for (const [field, targetCategory] of Object.entries(REFERENCE_TARGETS)) {
      const sourceId = record[field]
      if (typeof sourceId !== 'string') continue
      const mapped = idMaps.get(targetCategory)?.get(sourceId)
      if (mapped) record[field] = mapped
      else if (!Array.isArray(state[targetCategory]) || !state[targetCategory].some(item => recordId(item) === sourceId)) {
        fail('missing_dependency', '导入记录引用的依赖类别未选择或目标记录不存在')
      }
    }
    const sourceId = record.sourceId
    if (typeof sourceId === 'string') {
      const mapped = idMaps.get(category)?.get(sourceId)
      if (mapped) record.sourceId = mapped
    }
  }
  return { idMappings, invalidByCategory, duplicateByCategory, conflictByCategory, importedCounts }
}

export async function commitImport({ parsedSource, preview, selectedCategories, store, eventId, now, fingerprintOverride, attachmentResults, receiptId } = {}) {
  if (!parsedSource?.categories || !preview?.categories || !store || typeof store.read !== 'function' || typeof store.transact !== 'function' || typeof eventId !== 'string' || !eventId.trim()) {
    fail('invalid_input', '导入提交参数无效')
  }
  const selected = new Set(selectedCategories ?? Object.entries(preview.categories).filter(([, value]) => value.selected).map(([key]) => key))
  for (const category of selected) if (!Object.hasOwn(parsedSource.categories, category) || !Object.hasOwn(preview.categories, category)) fail('unsupported_category', '所选类别不在来源预览中')
  const fingerprint = fingerprintOverride ?? digest({ format: parsedSource.format, formatVersion: parsedSource.formatVersion, categories: parsedSource.categories, selectedCategories: [...selected].sort() })
  let current = store.read()
  const existing = current.importReceipts.find(item => item.fingerprint === fingerprint && item.status === 'completed')
  if (existing) return { categoryResults: existing.categoryResults, receiptId: existing.receiptId, state: current }

  const sourceCategories = Object.entries(parsedSource.categories).filter(([category]) => selected.has(category))
  const resultByCategory = new Map(sourceCategories.map(([category, records]) => [category, { category, count: categoryCount(records), status: 'pending', invalid: (parsedSource.warnings ?? []).filter(item => item.category === category && ['invalid_fields', 'invalid_items'].includes(item.code)).reduce((sum, item) => sum + (Number.isSafeInteger(item.count) ? item.count : 1), 0) }]))
  const mappings = []
  let failed = false
  for (const group of dependencyGroups(parsedSource.categories, selected)) {
    current = store.read()
    try {
      let groupOutcome = { idMappings: [], invalidByCategory: {}, duplicateByCategory: {}, conflictByCategory: {}, importedCounts: {} }
      current = await store.transact(current.revision, `${eventId}:group:${randomUUID()}`, state => {
        groupOutcome = importGroup(state, parsedSource.categories, group)
      })
      mappings.push(...groupOutcome.idMappings)
      for (const category of group) {
        const result = resultByCategory.get(category)
        result.status = 'imported'
        result.invalid = Math.max(result.invalid, groupOutcome.invalidByCategory[category] ?? 0)
        result.duplicates = groupOutcome.duplicateByCategory[category] ?? 0
        result.conflicts = groupOutcome.conflictByCategory[category] ?? 0
        if (Object.hasOwn(groupOutcome.importedCounts, category)) result.count = groupOutcome.importedCounts[category]
      }
    } catch (error) {
      failed = true
      for (const category of group) {
        const result = resultByCategory.get(category)
        result.status = 'failed'
        result.errorCode = typeof error?.code === 'string' ? error.code : 'storage_failure'
      }
    }
  }

  const createdAt = now ?? new Date().toISOString()
  const results = [...resultByCategory.values()]
  const receipt = createImportReceipt({
    fingerprint, format: parsedSource.format, formatVersion: parsedSource.formatVersion,
    categoryResults: results, attachmentResults, idMappings: mappings,
    receiptId: receiptId ?? current.importReceipts.find(item => item.fingerprint === fingerprint)?.receiptId,
    status: failed ? 'partial-failure' : 'completed',
    now: current.importReceipts.find(item => item.fingerprint === fingerprint)?.createdAt ?? createdAt,
  })
  current = store.read()
  const committed = await store.transact(current.revision, `${eventId}:receipt:${randomUUID()}`, state => {
    const index = state.importReceipts.findIndex(item => item.fingerprint === fingerprint || (receiptId && item.receiptId === receiptId))
    if (index >= 0) state.importReceipts[index] = receipt
    else state.importReceipts.push(receipt)
    state.importReceipts = pruneImportReceipts(state.importReceipts, { now: createdAt })
  })
  const savedReceipt = committed.importReceipts.find(item => item.fingerprint === fingerprint)
  return { categoryResults: savedReceipt?.categoryResults ?? results, receiptId: savedReceipt?.receiptId ?? receipt.receiptId, state: committed }
}
