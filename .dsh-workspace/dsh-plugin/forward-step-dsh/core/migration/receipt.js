import { randomUUID } from 'node:crypto'

const ALLOWED = new Set(['id', 'sourceId', 'targetId', 'status', 'errorCode', 'count', 'invalid', 'createdAt', 'category', 'sha256', 'verified', 'skipped', 'conflicts', 'duplicates', 'idMappings'])
export const RECEIPT_RETENTION_DAYS = 90
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024

function project(value) {
  if (Array.isArray(value)) return value.map(project)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => ALLOWED.has(key)).map(([key, child]) => [key, project(child)]))
}

export function createImportReceipt({ fingerprint, format, formatVersion, categoryResults = [], attachmentResults = [], idMappings = [], status = 'completed', errorCode, receiptId = randomUUID(), now = new Date().toISOString() } = {}) {
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(fingerprint)) {
    throw Object.assign(new Error('备份指纹无效'), { code: 'invalid_input' })
  }
  return {
    receiptId, fingerprint: fingerprint.toLowerCase(), format, formatVersion,
    status, ...(typeof errorCode === 'string' ? { errorCode } : {}), categoryResults: project(categoryResults), attachmentResults: project(attachmentResults), idMappings: project(idMappings), createdAt: now,
  }
}

export function pruneImportReceipts(receipts, { now = new Date().toISOString(), maxAgeDays = RECEIPT_RETENTION_DAYS, maxBytes = RECEIPT_MAX_BYTES } = {}) {
  if (!Array.isArray(receipts) || !Number.isFinite(Date.parse(now)) || !Number.isFinite(maxAgeDays) || maxAgeDays < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw Object.assign(new Error('收据清理参数无效'), { code: 'invalid_input' })
  }
  const cutoff = Date.parse(now) - maxAgeDays * 24 * 60 * 60 * 1000
  const active = receipts.filter(item => ['in-progress', 'running', 'pending'].includes(item?.status))
  const ended = receipts.filter(item => !['in-progress', 'running', 'pending'].includes(item?.status)
    && Number.isFinite(Date.parse(item?.createdAt)) && Date.parse(item.createdAt) >= cutoff)
  const kept = [...active, ...ended]
  const bytesOf = items => Buffer.byteLength(JSON.stringify(items), 'utf8')
  ended.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  while (bytesOf(kept) > maxBytes && ended.length) {
    const oldest = ended.shift()
    kept.splice(kept.indexOf(oldest), 1)
  }
  if (bytesOf(kept) > maxBytes) throw Object.assign(new Error('进行中的导入收据已达到存储上限'), { code: 'receipt_limit' })
  return kept
}

export async function deleteImportReceipt({ store, receiptId, eventId } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.transact !== 'function'
    || typeof receiptId !== 'string' || !receiptId.trim() || typeof eventId !== 'string' || !eventId.trim()) {
    throw Object.assign(new Error('删除收据参数无效'), { code: 'invalid_input' })
  }
  const before = store.read()
  const committed = await store.transact(before.revision, eventId, state => {
    state.importReceipts = state.importReceipts.filter(item => item.receiptId !== receiptId)
  })
  return { deleted: committed.importReceipts.length < before.importReceipts.length, state: committed }
}

export function sanitizeReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') throw Object.assign(new Error('收据无效'), { code: 'invalid_input' })
  return {
    receiptId: receipt.receiptId,
    fingerprint: receipt.fingerprint,
    format: receipt.format,
    formatVersion: receipt.formatVersion,
    status: receipt.status,
    ...(typeof receipt.errorCode === 'string' ? { errorCode: receipt.errorCode } : {}),
    categoryResults: project(receipt.categoryResults ?? []),
    attachmentResults: project(receipt.attachmentResults ?? []),
    idMappings: project(receipt.idMappings ?? []),
    createdAt: receipt.createdAt,
  }
}
