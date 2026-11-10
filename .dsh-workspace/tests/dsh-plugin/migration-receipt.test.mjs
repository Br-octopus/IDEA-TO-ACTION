import test from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { createImportReceipt, deleteImportReceipt, pruneImportReceipts, sanitizeReceipt } from '../../dsh-plugin/forward-step-dsh/core/migration/receipt.js'

test('迁移收据仅保留允许字段且支持读回', () => {
  const receipt = createImportReceipt({ fingerprint: 'a'.repeat(64), format: 'forward-step-workspace', formatVersion: 1, categoryResults: [{ category: 'projects', count: 2, status: 'imported', content: 'private', fullPath: 'C:/private' }] })
  const reopened = sanitizeReceipt(receipt)
  assert.equal(reopened.categoryResults[0].count, 2)
  assert.equal(Object.hasOwn(reopened.categoryResults[0], 'content'), false)
  assert.equal(Object.hasOwn(reopened.categoryResults[0], 'fullPath'), false)
  assert.throws(() => createImportReceipt({ fingerprint: 'bad' }), { code: 'invalid_input' })
})

test('收据递归移除正文、查询材料、凭证和完整路径', () => {
  const receipt = createImportReceipt({
    fingerprint: 'b'.repeat(64), format: 'forward-step-workspace-archive', formatVersion: 1,
    categoryResults: [{ category: 'researchTasks', count: 1, status: 'failed', content: 'PRIVATE_BODY', query: 'PRIVATE_QUERY', nested: { excerpt: 'PRIVATE_EXCERPT', apiKey: 'PRIVATE_KEY', fullPath: 'PRIVATE_PATH' } }],
    attachmentResults: [{ sourceId: 'attachment-1', status: 'failed', errorCode: 'storage_failure', path: 'PRIVATE_ATTACHMENT_PATH', password: 'PRIVATE_PASSWORD' }],
    idMappings: [{ category: 'projects', sourceId: 'source-1', targetId: 'target-1', originalText: 'PRIVATE_TEXT', sessionToken: 'PRIVATE_TOKEN' }],
  })
  const serialized = JSON.stringify(sanitizeReceipt(receipt))
  for (const marker of ['PRIVATE_BODY', 'PRIVATE_QUERY', 'PRIVATE_EXCERPT', 'PRIVATE_KEY', 'PRIVATE_PATH', 'PRIVATE_ATTACHMENT_PATH', 'PRIVATE_PASSWORD', 'PRIVATE_TEXT', 'PRIVATE_TOKEN']) {
    assert.equal(serialized.includes(marker), false, `${marker} 不得进入收据`)
  }
})

test('90 天和 10 MiB 清理只移除最旧已结束收据', () => {
  const now = '2026-11-05T00:00:00.000Z'
  const receipts = [
    { receiptId: 'old', status: 'completed', createdAt: '2026-07-01T00:00:00.000Z' },
    { receiptId: 'active', status: 'in-progress', createdAt: '2026-07-01T00:00:00.000Z' },
    { receiptId: 'partial-old', status: 'partial-failure', createdAt: '2026-07-02T00:00:00.000Z' },
    { receiptId: 'partial-recent', status: 'partial-failure', createdAt: '2026-10-29T00:00:00.000Z' },
    { receiptId: 'recent', status: 'failed', createdAt: '2026-10-30T00:00:00.000Z' },
  ]
  assert.deepEqual(pruneImportReceipts(receipts, { now }).map(item => item.receiptId), ['active', 'partial-recent', 'recent'])
  const oversized = [{ receiptId: 'active', status: 'running', createdAt: now, detail: 'x'.repeat(2048) }]
  assert.throws(() => pruneImportReceipts(oversized, { now, maxBytes: 100 }), { code: 'receipt_limit' })
})

test('删除收据不改变已经导入的工作区数据', async () => {
  const store = openStore(':memory:')
  try {
    await store.transact(0, 'seed-imported-data', state => {
      state.projects.push({ id: 'project-1' })
      state.importReceipts.push({ receiptId: 'receipt-1', fingerprint: 'a'.repeat(64), status: 'completed', createdAt: '2026-11-05T00:00:00.000Z', categoryResults: [] })
    })
    const result = await deleteImportReceipt({ store, receiptId: 'receipt-1', eventId: 'delete-receipt-1' })
    assert.equal(result.deleted, true)
    assert.deepEqual(result.state.projects, [{ id: 'project-1' }])
    assert.deepEqual(result.state.importReceipts, [])
  } finally { store.close() }
})
