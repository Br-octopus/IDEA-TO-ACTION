import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import yazl from '../../dsh-plugin/forward-step-dsh/node_modules/yazl/index.js'
import { exportPluginBackup, findPluginBackupConflicts, inspectPluginBackup, restorePluginBackup } from '../../dsh-plugin/forward-step-dsh/core/backup.js'
import { initialState } from '../../dsh-plugin/forward-step-dsh/core/schema.js'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'

test('插件备份格式独立、服务配置可选且凭证始终剔除', () => {
  const state = initialState()
  state.projects.push({ id: 'p1', title: 'project' })
  state.preferences = { theme: 'system', apiToken: 'secret' }
  state.serviceConfig = { endpoint: 'https://example.invalid', password: 'secret', clientSecret: 'secret' }
  const { backup, sha256 } = exportPluginBackup({ state })
  assert.match(sha256, /^[a-f0-9]{64}$/)
  assert.equal(backup.format, 'forward-step-dsh-workspace')
  assert.equal(Object.hasOwn(backup.data, 'preferences'), false)
  assert.equal(Object.hasOwn(backup.data, 'serviceConfig'), false)
  const optedIn = exportPluginBackup({ state, includePreferences: true, includeServiceConfig: true }).backup
  assert.equal(Object.hasOwn(optedIn.data.preferences, 'apiToken'), false)
  assert.equal(Object.hasOwn(optedIn.data.serviceConfig, 'password'), false)
  assert.equal(Object.hasOwn(optedIn.data.serviceConfig, 'clientSecret'), false)
})

test('插件备份仅带已验证附件并移除待恢复附件产生的悬空引用', () => {
  const state = initialState()
  state.researchAttachments.push(
    { id: 'verified-file', taskId: 'social-1', resultId: 'result-1', status: 'verified', storageRef: { attachmentId: 'sha256:verified' } },
    { id: 'pending-file', taskId: 'social-1', status: 'pending-recovery', storageRef: { attachmentId: 'sha256:pending' } },
  )
  state.researchTasks.push({ id: 'social-1', attachments: [{ id: 'verified-file' }, { id: 'pending-file' }], results: [{ id: 'result-1', attachmentIds: ['verified-file', 'pending-file'] }] })
  const backup = exportPluginBackup({ state, includeAttachments: true }).backup
  assert.deepEqual(backup.data.researchAttachments.map(item => item.id), ['verified-file'])
  assert.deepEqual(backup.data.researchTasks[0].attachments.map(item => item.id), ['verified-file'])
  assert.deepEqual(backup.data.researchTasks[0].results[0].attachmentIds, ['verified-file'])
  const jsonBackup = exportPluginBackup({ state, includeAttachments: false }).backup
  assert.deepEqual(jsonBackup.data.researchAttachments, [])
  assert.deepEqual(jsonBackup.data.researchTasks[0].results[0].attachmentIds, [])
})

test('插件 ZIP 备份跳过待恢复附件且不读取其存储对象', async () => {
  const { createPluginBackupArchive } = await import('../../dsh-plugin/forward-step-dsh/core/backup-archive.js')
  const directory = await mkdtemp(join(tmpdir(), 'forward-step-backup-test-'))
  const outputPath = join(directory, 'pending.zip')
  try {
    const backup = exportPluginBackup({ state: {
      ...initialState(),
      researchAttachments: [{ id: 'pending-file', taskId: 'social-1', status: 'pending-recovery', storageRef: { attachmentId: 'sha256:pending', bytes: 1 } }],
    }, includeAttachments: true }).backup
    let reads = 0
    const result = await createPluginBackupArchive({ backup, attachmentStore: { readFileStream() { reads += 1; throw new Error('must not read') } }, outputPath })
    assert.equal(result.attachmentCount, 0)
    assert.equal(reads, 0)
    assert.ok((await readFile(outputPath)).byteLength > 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('插件备份恢复拒绝悬空或跨任务的社媒附件引用', () => {
  const backup = exportPluginBackup({ state: {
    ...initialState(),
    researchTasks: [{ id: 'task-1', attachments: [{ id: 'attachment-1' }], results: [{ id: 'result-1', attachmentIds: ['attachment-1'] }] }],
    researchAttachments: [{ id: 'attachment-1', taskId: 'task-1', resultId: 'result-1', status: 'verified' }],
  }, includeAttachments: true }).backup
  assert.equal(restorePluginBackup({ input: backup }).researchAttachments[0].id, 'attachment-1')
  const missing = structuredClone(backup)
  missing.data.researchAttachments = []
  assert.throws(() => restorePluginBackup({ input: missing }), { code: 'missing_attachment_reference' })
  const crossTask = structuredClone(backup)
  crossTask.data.researchAttachments[0].taskId = 'task-2'
  assert.throws(() => restorePluginBackup({ input: crossTask }), { code: 'missing_attachment_reference' })
  const invalidExportState = initialState()
  invalidExportState.researchTasks = [{ id: 'task-1', attachments: [{ id: 'attachment-1' }], results: [{ id: 'result-1', attachmentIds: ['attachment-1'] }] }]
  invalidExportState.researchAttachments = [{ id: 'attachment-1', taskId: 'task-2', resultId: 'result-1', status: 'verified' }]
  assert.throws(() => exportPluginBackup({ state: invalidExportState, includeAttachments: true }), { code: 'missing_attachment_reference' })
})
test('插件备份可预览数据并恢复到空状态或合并状态', () => {
  const state = initialState()
  state.projects.push({ id: 'p1' })
  const backup = exportPluginBackup({ state }).backup
  const replaced = restorePluginBackup({ input: backup })
  assert.deepEqual(replaced.projects, [{ id: 'p1' }])
  const current = initialState()
  current.projects.push({ id: 'p2' })
  const merged = restorePluginBackup({ input: backup, mode: 'merge', currentState: current })
  assert.deepEqual(merged.projects, [{ id: 'p2' }, { id: 'p1' }])
  assert.throws(() => restorePluginBackup({ input: { ...backup, formatVersion: 9 } }), { code: 'invalid_backup' })
})

test('插件备份恢复预览返回分类计数并检测跨实体 ID 冲突', () => {
  const source = initialState()
  source.tasks.push({ taskId: 'task-a', title: '备份任务' })
  const backup = exportPluginBackup({ state: source }).backup
  const current = initialState()
  current.tasks.push({ taskId: 'task-a', title: '当前任务' })
  const preview = inspectPluginBackup({ input: backup, currentState: current, mode: 'replace' })
  assert.equal(preview.counts.tasks, 1)
  assert.equal(preview.resultingCounts.tasks, 1)
  assert.deepEqual(findPluginBackupConflicts({ input: backup, currentState: current }), [{ collection: 'tasks', id: 'task-a' }])
  assert.throws(() => restorePluginBackup({ input: backup, currentState: current, mode: 'merge' }), { code: 'merge_conflict' })
  assert.deepEqual(findPluginBackupConflicts({
    input: { ...backup, data: { ...backup.data, projects: [{ id: 'same', title: 'backup' }] } },
    currentState: { ...current, projects: [{ id: 'same', title: 'current' }] },
  }), [{ collection: 'projects', id: 'same' }, { collection: 'tasks', id: 'task-a' }])
  const mergePreview = inspectPluginBackup({ input: backup, currentState: current, mode: 'merge' })
  assert.equal(mergePreview.conflicts[0].collection, 'tasks')
  const metadataBackup = { ...backup, data: { knowledgeMetadata: { incoming: { pinned: true } } } }
  const metadataCurrent = { ...current, knowledgeMetadata: { existing: { pinned: false } } }
  const merged = restorePluginBackup({ input: metadataBackup, currentState: metadataCurrent, mode: 'merge' })
  assert.deepEqual(merged.knowledgeMetadata, { existing: { pinned: false }, incoming: { pinned: true } })
  assert.deepEqual(findPluginBackupConflicts({ input: { ...metadataBackup, data: { knowledgeMetadata: { existing: { pinned: true } } } }, currentState: metadataCurrent }), [{ collection: 'knowledgeMetadata', key: 'existing' }])
})

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

test('Host 导出、恢复预览和显式确认形成插件备份闭环', async () => {
  const host = new ForwardStepProbe(createStorageDomain())
  try {
    const source = JSON.stringify({ format: 'forward-step-dsh-workspace', formatVersion: 1, schemaVersion: 1, data: { projects: [{ id: 'project-1', title: '恢复项目' }] } })
    const preview = await host.previewPluginRestore({ backupJson: source, mode: 'replace' })
    assert.equal(preview.counts.projects, 1)
    await assert.rejects(host.restorePluginBackup({ backupJson: source, mode: 'replace', expectedSha256: 'wrong', expectedRevision: preview.currentRevision, confirmed: true, eventId: 'restore-bad-hash' }), { code: 'conflict' })
    await assert.rejects(host.restorePluginBackup({ backupJson: source, mode: 'replace', expectedSha256: preview.sha256, expectedRevision: preview.currentRevision, confirmed: false, eventId: 'restore-unconfirmed' }), { code: 'invalid_input' })
    const restored = await host.restorePluginBackup({ backupJson: source, mode: 'replace', expectedSha256: preview.sha256, expectedRevision: preview.currentRevision, confirmed: true, eventId: 'restore-confirmed' })
    assert.equal(restored.restored, true)
    const exported = await host.exportPluginBackup({ includePreferences: false, includeServiceConfig: false })
    assert.deepEqual(JSON.parse(exported.backupJson).data.projects, [{ id: 'project-1', title: '恢复项目' }])
    assert.equal(exported.sha256.length, 64)
    await assert.rejects(host.restorePluginBackup({ backupJson: source, mode: 'replace', expectedSha256: preview.sha256, expectedRevision: preview.currentRevision, confirmed: true, eventId: 'restore-stale-preview' }), { code: 'conflict' })
  } finally { await host.dispose() }
})

async function createPluginBackupZip(backup) {
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(JSON.stringify({ format: 'forward-step-dsh-backup-archive', formatVersion: 1, backup, attachments: [] })), 'manifest.json')
  zip.end()
  const chunks = []
  for await (const chunk of zip.outputStream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function uploadPluginBackup(host, archive, name = 'plugin.zip') {
  const started = await host.beginPluginBackupImport({ sourceName: name, size: archive.length })
  for (let offset = 0, index = 0; offset < archive.length; offset += started.chunkBytes, index += 1) {
    await host.appendPluginBackupImportChunk({ uploadId: started.uploadId, index, dataBase64: archive.subarray(offset, Math.min(offset + started.chunkBytes, archive.length)).toString('base64') })
  }
  return started.uploadId
}

test('Host 完整插件 ZIP 分块导出/导入、预览只读、确认后恢复并生成可复核收据', async () => {
  const host = new ForwardStepProbe(createStorageDomain())
  try {
    const seed = JSON.stringify({ format: 'forward-step-dsh-workspace', formatVersion: 1, schemaVersion: 1, data: { projects: [{ id: 'archive-project', title: 'ZIP 数据' }] } })
    const initial = await host.previewPluginRestore({ backupJson: seed, mode: 'replace' })
    await host.restorePluginBackup({ backupJson: seed, mode: 'replace', expectedSha256: initial.sha256, expectedRevision: initial.currentRevision, confirmed: true, eventId: 'seed-archive-project' })

    const exported = await host.beginPluginBackupExport({ includePreferences: false, includeServiceConfig: false })
    const chunks = []
    for (let offset = 0; offset < exported.byteLength;) {
      const chunk = await host.readPluginBackupExportChunk({ exportId: exported.exportId, offset, length: exported.chunkBytes })
      assert.equal(chunk.offset, offset)
      chunks.push(Buffer.from(chunk.dataBase64, 'base64'))
      offset = chunk.nextOffset
      assert.equal(chunk.done, offset === exported.byteLength)
    }
    const archive = Buffer.concat(chunks)
    assert.equal(createHash('sha256').update(archive).digest('hex'), exported.sha256)
    await assert.rejects(host.readPluginBackupExportChunk({ exportId: exported.exportId, offset: 0, length: 10 }), { code: 'invalid_input' })

    const importedHost = new ForwardStepProbe(createStorageDomain())
    try {
      const uploadId = await uploadPluginBackup(importedHost, archive)
      const preview = await importedHost.previewPluginBackupImport({ uploadId, mode: 'replace' })
      assert.equal(preview.attachmentCount, 0)
      assert.equal(preview.counts.projects, 1)
      assert.equal(preview.currentRevision, 0, '只读预览不得更改插件状态修订')
      const restored = await importedHost.restorePluginBackupArchive({ uploadId, mode: 'replace', expectedSha256: preview.sha256, expectedRevision: preview.currentRevision, confirmed: true, eventId: 'plugin-zip-restore' })
      assert.equal(restored.restored, true)
      assert.equal(restored.receipt.status, 'completed')
      assert.equal(restored.receipt.fingerprint, exported.sha256)
      const after = await importedHost.exportPluginBackup({ includePreferences: false, includeServiceConfig: false })
      assert.deepEqual(JSON.parse(after.backupJson).data.projects, [{ id: 'archive-project', title: 'ZIP 数据' }])
    } finally { await importedHost.dispose() }
  } finally { await host.dispose() }
})

test('Host 插件 ZIP 拒绝未完整上传，取消清理会话且不创建失败状态', async () => {
  const host = new ForwardStepProbe(createStorageDomain())
  try {
    const backup = exportPluginBackup({ state: initialState() }).backup
    const archive = await createPluginBackupZip(backup)
    const started = await host.beginPluginBackupImport({ sourceName: 'incomplete.zip', size: archive.length })
    await host.appendPluginBackupImportChunk({ uploadId: started.uploadId, index: 0, dataBase64: archive.subarray(0, 4).toString('base64') })
    await assert.rejects(host.previewPluginBackupImport({ uploadId: started.uploadId, mode: 'replace' }), { code: 'invalid_input' })
    assert.deepEqual(await host.cancelPluginBackupImport({ uploadId: started.uploadId }), { cancelled: true })
    assert.deepEqual(await host.cancelPluginBackupImport({ uploadId: started.uploadId }), { cancelled: false })
  } finally { await host.dispose() }
})

test('Host 附件保存失败时保留同一失败收据并支持内容寻址重试', async () => {
  const payload = Buffer.from('restore attachment')
  const sha256 = createHash('sha256').update(payload).digest('hex')
  const attachmentId = `sha256:${sha256}`
  const files = new Map()
  let failSave = true
  const attachmentStore = {
    async saveFileStream({ data }) {
      const parts = []
      for await (const chunk of data) parts.push(chunk)
      if (failSave) throw Object.assign(new Error('temporary host failure'), { code: 'storage_failure' })
      const bytes = Buffer.concat(parts)
      files.set(attachmentId, bytes)
      return { attachmentId, bytes: bytes.length }
    },
    readFileStream(ref) { return Readable.from([files.get(ref.attachmentId)]) },
  }
  const host = new ForwardStepProbe(createStorageDomain(), undefined, undefined, attachmentStore)
  try {
    const backup = exportPluginBackup({ state: { ...initialState(), researchAttachments: [{ id: 'attachment-restore', taskId: 'task-1', status: 'verified', storageRef: { attachmentId, name: 'file.txt', bytes: payload.length }, storageSha256: sha256 }] }, includeAttachments: true }).backup
    const zip = new yazl.ZipFile()
    zip.addBuffer(Buffer.from(JSON.stringify({ format: 'forward-step-dsh-backup-archive', formatVersion: 1, backup, attachments: [{ id: 'attachment-restore', attachmentId, name: 'file.txt', bytes: payload.length, sha256, path: 'attachments/0.blob' }] })), 'manifest.json')
    zip.addBuffer(payload, 'attachments/0.blob')
    zip.end()
    const chunks = []
    for await (const chunk of zip.outputStream) chunks.push(chunk)
    const archive = Buffer.concat(chunks)
    const uploadId = await uploadPluginBackup(host, archive)
    const preview = await host.previewPluginBackupImport({ uploadId, mode: 'replace' })
    const failed = await host.restorePluginBackupArchive({ uploadId, mode: 'replace', expectedSha256: preview.sha256, expectedRevision: preview.currentRevision, confirmed: true, eventId: 'failed-attachment-attempt' })
    assert.equal(failed.restored, false)
    assert.equal(failed.errorCode, 'storage_failure')
    const receiptId = failed.receipt.receiptId
    assert.equal(failed.receipt.attachmentResults[0].status, 'failed')
    assert.equal((await host.exportPluginBackup({ includePreferences: false, includeServiceConfig: false })).backupJson.includes('attachment-restore'), false)

    failSave = false
    const retryPreview = await host.previewPluginBackupImport({ uploadId, mode: 'replace' })
    const retried = await host.restorePluginBackupArchive({ uploadId, mode: 'replace', expectedSha256: retryPreview.sha256, expectedRevision: retryPreview.currentRevision, confirmed: true, eventId: 'successful-attachment-retry' })
    assert.equal(retried.restored, true)
    assert.equal(retried.receipt.receiptId, receiptId)
    assert.equal(retried.receipt.attachmentResults[0].verified, true)
    assert.equal(files.get(attachmentId).toString(), payload.toString())
  } finally { await host.dispose() }
})
