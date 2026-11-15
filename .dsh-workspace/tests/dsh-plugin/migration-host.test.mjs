import test from 'node:test'
import assert from 'node:assert/strict'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'
import yazl from '../../dsh-plugin/forward-step-dsh/node_modules/yazl/index.js'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

function createStorageDomain() {
  const tables = new Map()
  return {
    async open() {
      return {
        table(name) {
          if (!tables.has(name)) tables.set(name, new Map())
          const values = tables.get(name)
          return {
            get: key => values.get(key),
            put: async (key, value) => values.set(key, structuredClone(value)),
            update: async (key, mutate) => {
              const next = mutate(values.get(key))
              values.set(key, structuredClone(next))
              return next
            },
          }
        },
        async close() {},
      }
    },
  }
}

const backup = JSON.stringify({
  format: 'forward-step-workspace',
  schemaVersion: 1,
  scope: 'workspace',
  data: { projects: [{ id: 'project-1', name: 'Migrated' }], prompts: [{ id: 'prompt-1', content: 'kept' }] },
})

test('Host 迁移预览只读，显式提交后返回可复核收据', async () => {
  const host = new ForwardStepProbe(createStorageDomain())
  try {
    const preview = await host.previewImport({ backupJson: backup, sourceName: 'workspace.json' })
    assert.equal(preview.categories.projects.sourceCount, 1)
    assert.equal(preview.sourceName, 'workspace.json')
    assert.equal(preview.categories.projects.status, 'ready')

    const result = await host.commitImport({ backupJson: backup, selectedCategories: ['projects'], eventId: 'host-import-1' })
    assert.equal(result.categoryResults.length, 1)
    assert.equal(result.categoryResults[0].category, 'projects')
    assert.equal(result.receipt.status, 'completed')
    assert.equal(result.receipt.categoryResults[0].count, 1)
    assert.equal(Object.hasOwn(result.receipt, 'content'), false)

    const retried = await host.commitImport({ backupJson: backup, selectedCategories: ['projects'], eventId: 'host-import-1' })
    assert.equal(retried.revision, result.revision)
    assert.equal((await host.listImportReceipts()).receipts.length, 1)
    const deleted = await host.deleteImportReceipt({ receiptId: result.receipt.receiptId, eventId: 'delete-host-receipt' })
    assert.equal(deleted.deleted, true)
    assert.equal((await host.listImportReceipts()).receipts.length, 0)
  } finally {
    await host.dispose()
  }
})

test('Host 迁移拒绝超限和未支持输入，不产生导入记录', async () => {
  const host = new ForwardStepProbe(createStorageDomain())
  try {
    await assert.rejects(host.previewImport({ backupJson: 'x'.repeat(20 * 1024 * 1024 + 1) }), { code: 'invalid_input' })
    await assert.rejects(host.commitImport({ backupJson: '{"format":"wrong"}', selectedCategories: ['projects'], eventId: 'bad-import' }), { code: 'unsupported_format' })
  } finally {
    await host.dispose()
  }
})
async function buildArchive() {
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(JSON.stringify({ format: 'forward-step-workspace-archive', formatVersion: 1, workspace: { projects: [{ id: 'zip-project', name: 'ZIP imported' }] }, attachments: [] })), 'manifest.json')
  zip.end()
  const chunks = []
  for await (const chunk of zip.outputStream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

test('Host ZIP 分块按序接收、只读预览并在确认后提交', async () => {
  const host = new ForwardStepProbe(createStorageDomain())
  try {
    const archive = await buildArchive()
    const { uploadId, chunkBytes } = await host.beginArchiveImport({ sourceName: 'workspace.zip', size: archive.length })
    await assert.rejects(host.appendArchiveImportChunk({ uploadId, index: 1, dataBase64: archive.subarray(0, 4).toString('base64') }), { code: 'invalid_input' })
    let index = 0
    for (let offset = 0; offset < archive.length; offset += chunkBytes) {
      const chunk = archive.subarray(offset, Math.min(offset + chunkBytes, archive.length))
      const ack = await host.appendArchiveImportChunk({ uploadId, index, dataBase64: chunk.toString('base64') })
      index += 1
      assert.equal(ack.nextChunk, index)
    }
    const preview = await host.previewArchiveImport({ uploadId, size: archive.length })
    assert.equal(preview.source.format, 'forward-step-workspace-archive')
    assert.equal(preview.categories.projects.sourceCount, 1)
    const committed = await host.commitArchiveImport({ uploadId, selectedCategories: ['projects'], eventId: 'zip-host-commit' })
    assert.equal(committed.receipt.status, 'completed')
    assert.equal(committed.receipt.categoryResults[0].count, 1)
    assert.equal((await host.listImportReceipts()).receipts.length, 1)
  } finally { await host.dispose() }
})
test('Host ZIP 持久化附件、读回摘要后再提交附件索引', async () => {
  const payload = Buffer.from('host attachment round-trip')
  const sha256 = createHash('sha256').update(payload).digest('hex')
  const id = `task-1_${'0123456789abcdef'.repeat(2)}.txt`
  const attachmentPath = `attachments/task-1/${id}`
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(JSON.stringify({
    format: 'forward-step-workspace-archive', formatVersion: 1,
    workspace: { researchTasks: [{ id: 'task-1' }], researchAttachments: [{ id, taskId: 'task-1', type: 'text/plain', size: payload.length }] },
    attachments: [{ id, taskId: 'task-1', type: 'text/plain', size: payload.length, sha256, path: attachmentPath }],
  })), 'manifest.json')
  zip.addBuffer(payload, attachmentPath)
  zip.end()
  const chunks = []
  for await (const chunk of zip.outputStream) chunks.push(chunk)
  const archive = Buffer.concat(chunks)
  const files = new Map()
  const attachments = {
    async saveFileStream({ data }) {
      const parts = []
      for await (const chunk of data) parts.push(chunk)
      const bytes = Buffer.concat(parts)
      const attachmentId = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
      files.set(attachmentId, bytes)
      return { attachmentId, bytes: bytes.length }
    },
    readFileStream(ref) { return Readable.from([files.get(ref.attachmentId)]) },
  }
  const host = new ForwardStepProbe(createStorageDomain(), undefined, undefined, attachments)
  try {
    const upload = await host.beginArchiveImport({ sourceName: 'with-attachment.zip', size: archive.length })
    for (let offset = 0, index = 0; offset < archive.length; offset += upload.chunkBytes, index++) {
      await host.appendArchiveImportChunk({ uploadId: upload.uploadId, index, dataBase64: archive.subarray(offset, Math.min(offset + upload.chunkBytes, archive.length)).toString('base64') })
    }
    await host.previewArchiveImport({ uploadId: upload.uploadId, size: archive.length })
    const result = await host.commitArchiveImport({ uploadId: upload.uploadId, selectedCategories: ['researchTasks', 'researchAttachments'], eventId: 'host-attachment-import' })
    assert.equal(result.receipt.status, 'completed')
    assert.equal(result.receipt.attachmentResults[0].verified, true)
    assert.equal(files.get(`sha256:${sha256}`).toString(), payload.toString())
  } finally { await host.dispose() }
})