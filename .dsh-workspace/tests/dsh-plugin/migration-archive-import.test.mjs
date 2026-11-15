import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { buildImportPreview } from '../../dsh-plugin/forward-step-dsh/core/migration/preview.js'
import { commitArchiveImport } from '../../dsh-plugin/forward-step-dsh/core/migration/archive-import.js'

const bytes = Buffer.from('archive attachment fixture')
const sha256 = createHash('sha256').update(bytes).digest('hex')

async function setup({ persistent = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-archive-import-test-'))
  const stagedPath = join(directory, 'payload.txt')
  await writeFile(stagedPath, bytes)
  const id = `task-1_${'0123456789abcdef'.repeat(2)}.txt`
  const parsedSource = {
    format: 'forward-step-workspace-archive', formatVersion: 1,
    categories: { researchTasks: [{ id: 'task-1' }], researchAttachments: [{ id, taskId: 'task-1', type: 'text/plain', size: bytes.length }] },
    attachments: [{ id, taskId: 'task-1', type: 'text/plain', size: bytes.length, sha256, stagedPath }],
  }
  const store = openStore(persistent ? join(directory, 'state.sqlite') : ':memory:')
  const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
  const content = new Map()
  let corruptRead = false
  const attachmentStore = {
    async saveFileStream({ data }) {
      const chunks = []
      for await (const chunk of data) chunks.push(chunk)
      const value = Buffer.concat(chunks)
      const attachmentId = `sha256:${createHash('sha256').update(value).digest('hex')}`
      content.set(attachmentId, value)
      return { attachmentId, bytes: value.length }
    },
    readFileStream(ref) {
      const value = content.get(ref.attachmentId)
      assert.ok(value)
      if (corruptRead) { corruptRead = false; return Readable.from([Buffer.from('corrupt')]) }
      return Readable.from([value])
    },
  }
  return { directory, parsedSource, preview, store, content, attachmentStore, corrupt: () => { corruptRead = true } }
}

test('ZIP 附件未选择索引时拒绝且不写附件或收据', async () => {
  const fixture = await setup()
  try {
    await assert.rejects(commitArchiveImport({ ...fixture, selectedCategories: ['researchTasks'], eventId: 'no-index' }), { code: 'dependency_required' })
    assert.equal(fixture.content.size, 0)
    assert.equal(fixture.store.read().importReceipts.length, 0)
  } finally { fixture.store.close(); await rm(fixture.directory, { recursive: true, force: true }) }
})

test('附件读回校验失败保留可恢复收据，重试复用收据并完成一次状态提交', async () => {
  const fixture = await setup({ persistent: true })
  try {
    fixture.corrupt()
    await assert.rejects(commitArchiveImport({ ...fixture, selectedCategories: ['researchTasks', 'researchAttachments'], eventId: 'archive-first' }), { code: 'attachment_mismatch' })
    const failed = fixture.store.read()
    assert.equal(failed.importReceipts.length, 1)
    assert.equal(failed.importReceipts[0].status, 'partial-failure')
    assert.equal(failed.importReceipts[0].attachmentResults[0].targetId, `sha256:${sha256}`)
    assert.equal(failed.researchAttachments.length, 0)

    fixture.store.close()
    fixture.store = openStore(join(fixture.directory, 'state.sqlite'))
    assert.equal(fixture.store.read().importReceipts[0].receiptId, failed.importReceipts[0].receiptId, 'Host/Store 重开后保留可续传收据')
    const result = await commitArchiveImport({ ...fixture, selectedCategories: ['researchTasks', 'researchAttachments'], eventId: 'archive-retry' })
    assert.equal(result.receiptId, failed.importReceipts[0].receiptId)
    assert.equal(result.state.importReceipts.length, 1)
    assert.equal(result.state.importReceipts[0].status, 'completed')
    assert.equal(result.state.importReceipts[0].attachmentResults[0].verified, true)
    assert.equal(result.state.researchTasks.length, 1)
    assert.equal(result.state.researchAttachments[0].storageRef.attachmentId, `sha256:${sha256}`)
    assert.equal(result.state.researchAttachments[0].storageSha256, sha256)
  } finally { fixture.store.close(); await rm(fixture.directory, { recursive: true, force: true }) }
})


test('附件写入失败先保留完整来源/目标收据，恢复后可继续导入', async () => {
  const fixture = await setup({ persistent: true })
  try {
    const save = fixture.attachmentStore.saveFileStream
    fixture.attachmentStore.saveFileStream = async () => { throw Object.assign(new Error('injected attachment write failure'), { code: 'attachment_write_failed' }) }
    await assert.rejects(commitArchiveImport({ ...fixture, selectedCategories: ['researchTasks', 'researchAttachments'], eventId: 'archive-save-failed' }), { code: 'attachment_write_failed' })
    const failedReceipt = fixture.store.read().importReceipts[0]
    assert.equal(failedReceipt.status, 'partial-failure')
    assert.equal(failedReceipt.attachmentResults[0].sourceId, fixture.parsedSource.attachments[0].id)
    assert.equal(failedReceipt.attachmentResults[0].targetId, 'sha256:' + sha256)
    assert.equal(fixture.store.read().researchAttachments.length, 0)

    fixture.attachmentStore.saveFileStream = save
    const resumed = await commitArchiveImport({ ...fixture, selectedCategories: ['researchTasks', 'researchAttachments'], eventId: 'archive-save-retry' })
    assert.equal(resumed.state.importReceipts.find(item => item.receiptId === failedReceipt.receiptId).status, 'completed')
    assert.equal(resumed.state.researchAttachments.length, 1)
  } finally { fixture.store.close(); await rm(fixture.directory, { recursive: true, force: true }) }
})
