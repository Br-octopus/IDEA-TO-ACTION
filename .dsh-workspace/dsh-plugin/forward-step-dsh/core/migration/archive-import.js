import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { assertArchiveStagingIntegrity } from './archive.js'
import { commitImport } from './commit.js'
import { createImportReceipt, pruneImportReceipts } from './receipt.js'

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

function categoryCount(value) {
  return Array.isArray(value) ? value.length
    : value && typeof value === 'object' ? Object.keys(value).length : 0
}

async function saveReceipt(store, receipt) {
  const before = store.read()
  return store.transact(before.revision, `archive-receipt:${randomUUID()}`, state => {
    const index = state.importReceipts.findIndex(item => item.receiptId === receipt.receiptId)
    if (index < 0) state.importReceipts.push(structuredClone(receipt))
    else state.importReceipts[index] = structuredClone(receipt)
    state.importReceipts = pruneImportReceipts(state.importReceipts)
  })
}

async function hashStoredAttachment(attachmentStore, ref, signal) {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of attachmentStore.readFileStream(ref, signal)) {
    signal?.throwIfAborted()
    size += chunk.byteLength
    hash.update(chunk)
  }
  return { size, sha256: hash.digest('hex') }
}

/**
 * Persist archive attachments under a resumable receipt, verify their durable
 * references, and only then commit workspace records that refer to them.
 */
export async function commitArchiveImport({ parsedSource, preview, selectedCategories, store, attachmentStore, eventId, signal, now } = {}) {
  if (!parsedSource?.categories || !preview?.categories || !store || typeof store.read !== 'function'
    || typeof store.transact !== 'function' || typeof eventId !== 'string' || !eventId.trim()
    || parsedSource.format !== 'forward-step-workspace-archive') {
    fail('invalid_input', 'ZIP 导入提交参数无效')
  }
  signal?.throwIfAborted()
  const selected = new Set(selectedCategories ?? [])
  const descriptors = parsedSource.attachments ?? []
  if (descriptors.length && (!attachmentStore || typeof attachmentStore.saveFileStream !== 'function' || typeof attachmentStore.readFileStream !== 'function')) fail('attachment_unavailable', '当前 Host 未提供附件持久化能力')
  if (descriptors.length && !selected.has('researchAttachments')) fail('dependency_required', 'ZIP 附件与附件索引必须一起导入')
  if (descriptors.some(item => !selected.has('researchTasks') && !store.read().researchTasks.some(task => task?.id === item.taskId))) {
    fail('dependency_required', '附件关联任务未选择导入，且插件中不存在对应任务')
  }
  for (const category of selected) {
    if (!Object.hasOwn(parsedSource.categories, category) || !Object.hasOwn(preview.categories, category)) {
      fail('unsupported_category', '所选类别不在来源预览中')
    }
  }
  const metadata = parsedSource.categories.researchAttachments ?? []
  const metadataById = new Map(metadata.map(item => [item?.id, item]))
  if (metadataById.size !== metadata.length) fail('duplicate_source_id', '附件索引存在重复标识')
  for (const item of descriptors) {
    const record = metadataById.get(item.id)
    if (!record || record.type !== item.type || record.size !== item.size) {
      fail('invalid_attachment_reference', 'ZIP 附件与工作区附件索引不匹配')
    }
  }
  if (metadata.length !== descriptors.length) fail('missing_entry', '工作区附件索引与 ZIP 附件清单不完整匹配')
  await assertArchiveStagingIntegrity(parsedSource)

  const fingerprint = digest({
    format: parsedSource.format,
    formatVersion: parsedSource.formatVersion,
    categories: parsedSource.categories,
    attachments: descriptors.map(({ id, taskId, type, size, sha256, path }) => ({ id, taskId, type, size, sha256, path })),
    selectedCategories: [...selected].sort(),
  })
  const current = store.read()
  const previous = current.importReceipts.find(item => item.fingerprint === fingerprint)
  if (previous?.status === 'completed') {
    return { categoryResults: previous.categoryResults, receiptId: previous.receiptId, state: current }
  }

  const categoryResults = Object.entries(parsedSource.categories)
    .filter(([category]) => selected.has(category))
    .map(([category, records]) => ({ category, count: categoryCount(records), status: 'imported' }))
  const attachmentResults = descriptors.map(item => ({
    sourceId: item.id,
    targetId: `sha256:${item.sha256}`,
    category: 'researchAttachments',
    sha256: item.sha256,
    status: previous?.attachmentResults?.find(result => result.sourceId === item.id)?.status === 'verified' ? 'verified' : 'pending',
    verified: previous?.attachmentResults?.find(result => result.sourceId === item.id)?.verified === true,
  }))
  let receipt = createImportReceipt({
    fingerprint,
    format: parsedSource.format,
    formatVersion: parsedSource.formatVersion,
    receiptId: previous?.receiptId,
    categoryResults,
    attachmentResults,
    idMappings: previous?.idMappings ?? [],
    status: 'in-progress',
    now: previous?.createdAt ?? now ?? new Date().toISOString(),
  })
  await saveReceipt(store, receipt)

  try {
    for (const [index, item] of descriptors.entries()) {
      signal?.throwIfAborted()
      const prior = receipt.attachmentResults[index]
      const ref = await attachmentStore.saveFileStream({
        data: createReadStream(item.stagedPath),
        name: item.id,
        signal,
      })
      if (ref.attachmentId !== `sha256:${item.sha256}` || ref.bytes !== item.size) {
        fail('attachment_mismatch', 'DSH 附件存储返回的引用与 ZIP 清单不匹配')
      }
      const verified = await hashStoredAttachment(attachmentStore, ref, signal)
      if (verified.size !== item.size || verified.sha256 !== item.sha256) {
        fail('attachment_mismatch', 'DSH 附件读回校验失败')
      }
      const results = [...receipt.attachmentResults]
      results[index] = { ...prior, status: 'verified', verified: true }
      receipt = { ...receipt, attachmentResults: results, status: 'in-progress' }
      await saveReceipt(store, receipt)
    }

    const imported = { ...parsedSource, categories: structuredClone(parsedSource.categories), attachments: [] }
    imported.categories.researchAttachments = metadata.map(item => {
      const descriptor = descriptors.find(candidate => candidate.id === item.id)
      if (!descriptor) return structuredClone(item)
      const result = receipt.attachmentResults.find(candidate => candidate.sourceId === item.id)
      return {
        ...structuredClone(item),
        storageRef: { attachmentId: result.targetId, name: descriptor.id, bytes: descriptor.size },
        storageSha256: descriptor.sha256,
      }
    })
    return await commitImport({
      parsedSource: imported,
      preview,
      selectedCategories: [...selected],
      store,
      eventId,
      fingerprintOverride: fingerprint,
      attachmentResults: receipt.attachmentResults,
      receiptId: receipt.receiptId,
      now,
    })
  } catch (error) {
    const failureCode = typeof error?.code === 'string' ? error.code : 'archive_import_failed'
    receipt = { ...receipt, status: 'partial-failure', attachmentResults: receipt.attachmentResults.map(item => ({ ...item, errorCode: item.status === 'verified' ? undefined : failureCode })) }
    await saveReceipt(store, receipt)
    throw error
  }
}