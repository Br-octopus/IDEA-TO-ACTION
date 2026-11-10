import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yazl from '../../dsh-plugin/forward-step-dsh/node_modules/yazl/index.js'
import { ARCHIVE_LIMITS, assertArchiveStagingIntegrity, stageWorkspaceArchive } from '../../dsh-plugin/forward-step-dsh/core/migration/archive.js'

const taskId = 'task-1'
const attachmentId = `${taskId}_${'0123456789abcdef'.repeat(2)}.txt`
const attachmentPath = `attachments/${taskId}/${attachmentId}`
const content = Buffer.from('saved research attachment')
const sha256 = createHash('sha256').update(content).digest('hex')

async function withTemp(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-migration-archive-test-'))
  const stageRoot = join(directory, 'stage-root')
  await mkdir(stageRoot)
  const previousTemp = process.env.TEMP
  const previousTmp = process.env.TMP
  process.env.TEMP = stageRoot
  process.env.TMP = stageRoot
  try { await callback(directory) } finally {
    if (previousTemp === undefined) delete process.env.TEMP
    else process.env.TEMP = previousTemp
    if (previousTmp === undefined) delete process.env.TMP
    else process.env.TMP = previousTmp
    await rm(directory, { recursive: true, force: true })
  }
}

async function writeZip(path, entries) {
  const zip = new yazl.ZipFile()
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.content), entry.name, entry.options)
  await new Promise((resolve, reject) => {
    const output = createWriteStream(path)
    output.once('error', reject)
    zip.once('error', reject)
    output.once('finish', resolve)
    zip.outputStream.pipe(output)
    zip.end()
  })
}

function descriptor(overrides = {}) {
  return { id: attachmentId, taskId, type: 'text/plain', size: content.byteLength, sha256, path: attachmentPath, ...overrides }
}

function manifest({ attachments = [descriptor()], workspace = { researchTasks: [{ id: taskId }] } } = {}) {
  return JSON.stringify({ format: 'forward-step-workspace-archive', formatVersion: 1, workspace, attachments })
}

async function validEntries(overrides = {}) {
  return [
    { name: 'manifest.json', content: manifest(overrides) },
    { name: attachmentPath, content },
  ]
}

async function assertNoNewStageDirectories(before) {
  const remaining = (await readdir(tmpdir())).filter(name => name.startsWith('forward-step-import-'))
  assert.deepEqual(remaining.filter(name => !before.has(name)), [])
}

test('ZIP 附件解析校验摘要并在显式清理时删除暂存目录', async () => {
  await withTemp(async directory => {
    const archivePath = join(directory, 'workspace.zip')
    await writeZip(archivePath, await validEntries())
    const parsed = await stageWorkspaceArchive({ archivePath, sourceName: 'workspace.zip' })
    try {
      assert.equal(parsed.format, 'forward-step-workspace-archive')
      assert.equal(parsed.categories.researchTasks[0].id, taskId)
      assert.equal(parsed.attachments.length, 1)
      assert.equal(await readFile(parsed.attachments[0].stagedPath, 'utf8'), content.toString())
      assert.equal(await assertArchiveStagingIntegrity(parsed), true)
    } finally { await parsed.cleanup() }
    await assert.rejects(readdir(parsed.stageDirectory), { code: 'ENOENT' })
  })
})

test('ZIP 解析拒绝摘要或实际大小不符，并清理失败暂存目录', async t => {
  await withTemp(async directory => {
    const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith('forward-step-import-')))
    for (const item of [
      { name: 'bad-hash', overrides: { attachments: [descriptor({ sha256: '0'.repeat(64) })] }, expected: 'checksum_mismatch' },
      { name: 'bad-size', overrides: { attachments: [descriptor({ size: content.byteLength + 1 })] }, expected: 'size_mismatch' },
    ]) {
      await t.test(item.name, async () => {
        const archivePath = join(directory, `${item.name}.zip`)
        await writeZip(archivePath, await validEntries(item.overrides))
        await assert.rejects(stageWorkspaceArchive({ archivePath }), { code: item.expected })
        await assertNoNewStageDirectories(before)
      })
    }
  })
})

test('ZIP 解析拒绝非首项 manifest、未知条目、缺失附件和路径穿越', async t => {
  await withTemp(async directory => {
    const cases = [
      { name: 'manifest-not-first', entries: [{ name: 'extra', content: 'x' }, ...(await validEntries())], expected: 'invalid_manifest' },
      { name: 'unknown-entry', entries: [...(await validEntries()), { name: 'unexpected', content: 'x' }], expected: 'unknown_entry' },
      { name: 'missing-attachment', entries: [{ name: 'manifest.json', content: manifest() }], expected: 'missing_entry' },
    ]
    for (const item of cases) {
      await t.test(item.name, async () => {
        const archivePath = join(directory, `${item.name}.zip`)
        await writeZip(archivePath, item.entries)
        await assert.rejects(stageWorkspaceArchive({ archivePath }), { code: item.expected })
      })
    }
    await t.test('path-traversal', async () => {
      const archivePath = join(directory, 'path-traversal.zip')
      await writeZip(archivePath, await validEntries())
      const bytes = await import('node:fs/promises').then(fs => fs.readFile(archivePath))
      const marker = Buffer.from('attachments')
      const positions = []
      for (let index = bytes.indexOf(marker); index !== -1; index = bytes.indexOf(marker, index + marker.length)) positions.push(index)
      assert.equal(positions.length, 2)
      for (const index of positions) Buffer.from('../xxxments').copy(bytes, index)
      await import('node:fs/promises').then(fs => fs.writeFile(archivePath, bytes))
      await assert.rejects(stageWorkspaceArchive({ archivePath }), error => ['unsafe_path', 'invalid_archive'].includes(error.code))
    })
    await t.test('absolute-path', async () => {
      const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith('forward-step-import-')))
      const archivePath = join(directory, 'absolute-path.zip')
      await writeZip(archivePath, await validEntries())
      const bytes = await import('node:fs/promises').then(fs => fs.readFile(archivePath))
      const marker = Buffer.from('attachments')
      const positions = []
      for (let index = bytes.indexOf(marker); index !== -1; index = bytes.indexOf(marker, index + marker.length)) positions.push(index)
      assert.equal(positions.length, 2)
      for (const index of positions) Buffer.from('/ttachments').copy(bytes, index)
      await import('node:fs/promises').then(fs => fs.writeFile(archivePath, bytes))
      await assert.rejects(stageWorkspaceArchive({ archivePath }), error => ['unsafe_path', 'invalid_archive'].includes(error.code))
      await assertNoNewStageDirectories(before)
    })
    await t.test('duplicate-entry', async () => {
      const archivePath = join(directory, 'duplicate-entry.zip')
      const entry = { name: attachmentPath, content }
      await writeZip(archivePath, [{ name: 'manifest.json', content: manifest() }, entry, entry])
      await assert.rejects(stageWorkspaceArchive({ archivePath }), { code: 'duplicate_entry' })
    })
  })
})

test('ZIP 清单在分配附件暂存前执行数量与单附件限额', async t => {
  assert.equal(ARCHIVE_LIMITS.totalBytes, 2 * 1024 * 1024 * 1024)
  assert.equal(ARCHIVE_LIMITS.manifestBytes, 128 * 1024 * 1024)
  assert.equal(ARCHIVE_LIMITS.attachments, 10_000)
  assert.equal(ARCHIVE_LIMITS.attachmentBytes, 25 * 1024 * 1024)
  await withTemp(async directory => {
    const cases = [
      { name: 'too-many-attachments', attachments: Array(10_001).fill(descriptor()), expected: 'invalid_manifest' },
      { name: 'oversized-attachment', attachments: [descriptor({ size: ARCHIVE_LIMITS.attachmentBytes + 1 })], expected: 'invalid_manifest' },
    ]
    for (const item of cases) {
      await t.test(item.name, async () => {
        const archivePath = join(directory, `${item.name}.zip`)
        await writeZip(archivePath, [{ name: 'manifest.json', content: manifest({ attachments: item.attachments }) }])
        await assert.rejects(stageWorkspaceArchive({ archivePath }), { code: item.expected })
      })
    }
    await t.test('declared-total-size', async () => {
      const attachments = Array.from({ length: 82 }, (_, index) => {
        const id = `t${index}_${index.toString(16).padStart(32, '0')}.txt`
        const idTask = `t${index}`
        return descriptor({ id, taskId: idTask, path: `attachments/${idTask}/${id}`, size: ARCHIVE_LIMITS.attachmentBytes })
      })
      const archivePath = join(directory, 'declared-total-size.zip')
      await writeZip(archivePath, [{ name: 'manifest.json', content: manifest({ attachments }) }])
      await assert.rejects(stageWorkspaceArchive({ archivePath }), { code: 'total_size_limit' })
    })
    await t.test('oversized-manifest-declaration', async () => {
      const archivePath = join(directory, 'oversized-manifest.zip')
      await writeZip(archivePath, [{ name: 'manifest.json', content: manifest({ attachments: [] }) }])
      const fs = await import('node:fs/promises')
      const bytes = await fs.readFile(archivePath)
      const localHeader = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      const centralHeader = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
      assert.notEqual(localHeader, -1)
      assert.notEqual(centralHeader, -1)
      bytes.writeUInt32LE(ARCHIVE_LIMITS.manifestBytes + 1, localHeader + 22)
      bytes.writeUInt32LE(ARCHIVE_LIMITS.manifestBytes + 1, centralHeader + 24)
      await fs.writeFile(archivePath, bytes)
      await assert.rejects(stageWorkspaceArchive({ archivePath }), { code: 'invalid_manifest' })
    })
  })
})

test('ZIP 拒绝符号链接、重复 manifest 路径和单任务附件总量超限并清理暂存', async t => {
  await withTemp(async directory => {
    const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith('forward-step-import-')))
    const cases = [
      {
        name: 'symlink-entry',
        entries: [
          { name: 'manifest.json', content: manifest() },
          { name: attachmentPath, content, options: { mode: 0o120777 } },
        ],
        expected: 'size_mismatch',
      },
      {
        name: 'duplicate-manifest-path',
        entries: [
          { name: 'manifest.json', content: manifest() },
          { name: 'manifest.json', content: manifest() },
        ],
        expected: 'duplicate_entry',
      },
      {
        name: 'per-task-attachment-total',
        entries: [{
          name: 'manifest.json',
          content: manifest({ attachments: [
            descriptor({ size: 13 * 1024 * 1024 }),
            descriptor({ id: `${taskId}_${'f'.repeat(32)}.txt`, path: `attachments/${taskId}/${taskId}_${'f'.repeat(32)}.txt`, size: 13 * 1024 * 1024 }),
          ] }),
        }],
        expected: 'task_attachment_limit',
      },
    ]
    for (const item of cases) {
      await t.test(item.name, async () => {
        const archivePath = join(directory, `${item.name}.zip`)
        await writeZip(archivePath, item.entries)
        await assert.rejects(stageWorkspaceArchive({ archivePath }), { code: item.expected })
        await assertNoNewStageDirectories(before)
      })
    }
  })
})
