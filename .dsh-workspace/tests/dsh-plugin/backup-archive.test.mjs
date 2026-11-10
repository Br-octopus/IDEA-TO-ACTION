import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yazl from '../../dsh-plugin/forward-step-dsh/node_modules/yazl/index.js'
import { createPluginBackupArchive, persistPluginBackupAttachments, PLUGIN_BACKUP_ARCHIVE_FORMAT, stagePluginBackupArchive } from '../../dsh-plugin/forward-step-dsh/core/backup-archive.js'

const payload = Buffer.from('plugin attachment fixture')
const sha256 = createHash('sha256').update(payload).digest('hex')
const ref = { attachmentId: `sha256:${sha256}`, name: 'report.pdf', bytes: payload.length }
const sourceBackup = () => ({ format: 'forward-step-dsh-workspace', formatVersion: 1, schemaVersion: 1, data: { researchAttachments: [{ id: 'attachment-1', taskId: 'task-1', status: 'verified', storageRef: ref, storageSha256: sha256 }] } })
const attachmentStore = {
  readFileStream(input) {
    assert.equal(input.attachmentId, ref.attachmentId)
    return Readable.from([payload])
  },
}

async function withTemp(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-plugin-backup-archive-test-'))
  try { await callback(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

async function writeZip(path, entries) {
  const zip = new yazl.ZipFile()
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.content), entry.name)
  const writing = pipeline(zip.outputStream, createWriteStream(path))
  zip.end()
  await writing
}

async function validArchive(directory) {
  const path = join(directory, 'backup.zip')
  const result = await createPluginBackupArchive({ backup: sourceBackup(), attachmentStore, outputPath: path })
  assert.equal(result.format, PLUGIN_BACKUP_ARCHIVE_FORMAT)
  assert.equal(result.attachmentCount, 1)
  return path
}

test('插件专属 ZIP 备份导出并暂存后保留数据和附件摘要', async () => {
  await withTemp(async directory => {
    const archivePath = await validArchive(directory)
    const staged = await stagePluginBackupArchive({ archivePath, tempRoot: directory })
    try {
      assert.equal(staged.format, PLUGIN_BACKUP_ARCHIVE_FORMAT)
      assert.deepEqual(staged.backup.data.researchAttachments, sourceBackup().data.researchAttachments)
      assert.equal(staged.attachments.length, 1)
      assert.equal(staged.attachments[0].sha256, sha256)
      assert.equal((await readFile(staged.attachments[0].stagedPath)).toString(), payload.toString())
    } finally { await staged.cleanup() }
  })
})

test('插件备份 ZIP 缺附件或包含未知条目时拒绝', async t => {
  await withTemp(async directory => {
    const manifest = JSON.stringify({ format: PLUGIN_BACKUP_ARCHIVE_FORMAT, formatVersion: 1, backup: sourceBackup(), attachments: [{ id: 'attachment-1', attachmentId: ref.attachmentId, name: ref.name, bytes: payload.length, sha256, path: 'attachments/0.blob' }] })
    for (const item of [
      { name: 'missing', entries: [{ name: 'manifest.json', content: manifest }], code: 'missing_entry' },
      { name: 'unknown', entries: [{ name: 'manifest.json', content: manifest }, { name: 'unexpected.bin', content: 'x' }], code: 'unexpected_entry' },
    ]) await t.test(item.name, async () => {
      const archivePath = join(directory, `${item.name}.zip`)
      await writeZip(archivePath, item.entries)
      await assert.rejects(stagePluginBackupArchive({ archivePath, tempRoot: directory }), { code: item.code })
    })
  })
})

test('插件备份 ZIP 内容摘要不符时清理暂存文件', async () => {
  await withTemp(async directory => {
    const archivePath = join(directory, 'tampered.zip')
    const manifest = JSON.stringify({ format: PLUGIN_BACKUP_ARCHIVE_FORMAT, formatVersion: 1, backup: sourceBackup(), attachments: [{ id: 'attachment-1', attachmentId: ref.attachmentId, name: ref.name, bytes: payload.length, sha256, path: 'attachments/0.blob' }] })
    await writeZip(archivePath, [{ name: 'manifest.json', content: manifest }, { name: 'attachments/0.blob', content: Buffer.alloc(payload.length, 0x61) }])
    await assert.rejects(stagePluginBackupArchive({ archivePath, tempRoot: directory }), { code: 'checksum_mismatch' })
  })
})

test('附件恢复逐项回调尝试、验证和失败，且失败时不返回不完整备份', async () => {
  await withTemp(async directory => {
    const path = join(directory, 'attachment.blob')
    await import('node:fs/promises').then(({ writeFile }) => writeFile(path, payload))
    const backup = sourceBackup()
    const descriptor = { id: 'attachment-1', attachmentId: ref.attachmentId, name: ref.name, bytes: payload.length, sha256, stagedPath: path }
    const events = []
    const attachmentStore = {
      async saveFileStream({ data }) {
        for await (const _chunk of data) {}
        throw Object.assign(new Error('fixture failure'), { code: 'storage_failure' })
      },
      readFileStream() { throw new Error('must not read after failed write') },
    }
    await assert.rejects(persistPluginBackupAttachments({
      backup, attachments: [descriptor], attachmentStore,
      async onAttempt() { events.push('attempt') },
      async onVerified() { events.push('verified') },
      async onFailure(value) { events.push(`failed:${value.errorCode}`) },
    }), { code: 'storage_failure' })
    assert.deepEqual(events, ['attempt', 'failed:storage_failure'])
    assert.equal(backup.data.researchAttachments[0].storageRef.attachmentId, ref.attachmentId)
  })
})
