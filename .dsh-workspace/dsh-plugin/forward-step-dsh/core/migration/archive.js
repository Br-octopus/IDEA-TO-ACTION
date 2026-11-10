import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { parseSourceBackup } from './source.js'

export const ARCHIVE_FORMAT = 'forward-step-workspace-archive'
export const ARCHIVE_FORMAT_VERSION = 1
export const ARCHIVE_LIMITS = Object.freeze({
  totalBytes: 2 * 1024 * 1024 * 1024,
  manifestBytes: 128 * 1024 * 1024,
  attachments: 10_000,
  attachmentBytes: 25 * 1024 * 1024,
  taskAttachmentBytes: 25 * 1024 * 1024,
})

const TASK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
const ATTACHMENT_ID = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})_([a-f0-9]{32})\.(txt|pdf|png|jpg|webp)$/
const EXTENSION_BY_TYPE = Object.freeze({
  'text/plain': 'txt',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
})
const MANIFEST_KEYS = ['format', 'formatVersion', 'workspace', 'attachments']

function fail(code, message, cause) {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code })
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key))
}

function assertSafeEntryName(name) {
  if (typeof name !== 'string' || name.includes('\\') || name.startsWith('/')
    || /^[a-zA-Z]:/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw fail('unsafe_path', 'ZIP 条目路径不安全')
  }
}

function validateManifest(manifest) {
  if (!exactKeys(manifest, MANIFEST_KEYS) || manifest.format !== ARCHIVE_FORMAT
    || manifest.formatVersion !== ARCHIVE_FORMAT_VERSION || !manifest.workspace
    || typeof manifest.workspace !== 'object' || Array.isArray(manifest.workspace)
    || !Array.isArray(manifest.attachments) || manifest.attachments.length > ARCHIVE_LIMITS.attachments) {
    throw fail('invalid_manifest', '归档清单格式、版本或附件数量无效')
  }
  const paths = new Set(['manifest.json'])
  const ids = new Set()
  const taskSizes = new Map()
  let declaredBytes = 0
  for (const item of manifest.attachments) {
    const keys = ['id', 'taskId', 'type', 'size', 'sha256', 'path']
    if (!exactKeys(item, keys) || typeof item.id !== 'string' || typeof item.taskId !== 'string'
      || !TASK_ID.test(item.taskId) || !Number.isSafeInteger(item.size) || item.size <= 0
      || item.size > ARCHIVE_LIMITS.attachmentBytes || typeof item.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(item.sha256) || !Object.hasOwn(EXTENSION_BY_TYPE, item.type)) {
      throw fail('invalid_manifest', '附件清单字段无效')
    }
    const idMatch = ATTACHMENT_ID.exec(item.id)
    const expectedPath = `attachments/${item.taskId}/${item.id}`
    if (!idMatch || idMatch[1] !== item.taskId || idMatch[3] !== EXTENSION_BY_TYPE[item.type]
      || item.path !== expectedPath || ids.has(item.id) || paths.has(item.path)) {
      throw fail('invalid_attachment', '附件 ID、类型或归档路径无效')
    }
    ids.add(item.id)
    paths.add(item.path)
    const taskSize = (taskSizes.get(item.taskId) ?? 0) + item.size
    if (taskSize > ARCHIVE_LIMITS.taskAttachmentBytes) throw fail('task_attachment_limit', '单个任务附件总量超过 25 MiB')
    taskSizes.set(item.taskId, taskSize)
    declaredBytes += item.size
    if (declaredBytes > ARCHIVE_LIMITS.totalBytes) throw fail('total_size_limit', '归档解压总量超过 2 GiB')
  }
  return { paths, declaredBytes }
}

function openZip(path) {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error) reject(fail('invalid_archive', '无法读取 ZIP 归档', error))
      else resolve(zip)
    })
  })
}

function nextEntry(zip) {
  return new Promise((resolve, reject) => {
    const onError = error => { cleanup(); reject(fail('invalid_archive', 'ZIP 目录读取失败', error)) }
    const onEntry = entry => { cleanup(); resolve(entry) }
    const onEnd = () => { cleanup(); resolve(null) }
    const cleanup = () => {
      zip.removeListener('error', onError)
      zip.removeListener('entry', onEntry)
      zip.removeListener('end', onEnd)
    }
    zip.once('error', onError)
    zip.once('entry', onEntry)
    zip.once('end', onEnd)
    zip.readEntry()
  })
}

function readEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(fail('invalid_archive', '无法读取 ZIP 条目', error))
      else resolve(stream)
    })
  })
}

async function readManifest(stream, limit) {
  const parts = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.byteLength
    if (size > limit) throw fail('manifest_size_limit', 'manifest.json 超过 128 MiB')
    parts.push(chunk)
  }
  return Buffer.concat(parts, size)
}

async function writeAttachment(zip, entry, descriptor, destination, totals) {
  const hash = createHash('sha256')
  let size = 0
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.byteLength
      totals.actualBytes += chunk.byteLength
      if (size > descriptor.size || size > ARCHIVE_LIMITS.attachmentBytes) {
        callback(fail('size_mismatch', '附件实际大小超过清单声明'))
      } else if (totals.actualBytes > ARCHIVE_LIMITS.totalBytes) {
        callback(fail('total_size_limit', 'ZIP 实际解压总量超过 2 GiB'))
      } else {
        hash.update(chunk)
        callback(null, chunk)
      }
    },
  })
  await pipeline(await readEntry(zip, entry), meter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
  if (size !== descriptor.size) throw fail('size_mismatch', '附件实际大小与清单声明不一致')
  if (hash.digest('hex') !== descriptor.sha256) throw fail('checksum_mismatch', '附件 SHA-256 校验失败')
}

export async function stageWorkspaceArchive({ archivePath, sourceName = '' } = {}) {
  if (typeof archivePath !== 'string' || !archivePath) throw fail('invalid_input', 'ZIP 文件路径无效')
  let archiveStats
  try { archiveStats = await lstat(archivePath) } catch (error) { throw fail('invalid_archive', 'ZIP 文件不可读取', error) }
  if (!archiveStats.isFile() || archiveStats.isSymbolicLink() || archiveStats.size <= 0 || archiveStats.size > ARCHIVE_LIMITS.totalBytes) {
    throw fail('archive_size_limit', 'ZIP 文件大小无效或超过 2 GiB')
  }

  const stageDirectory = await mkdtemp(join(tmpdir(), 'forward-step-import-'))
  let zip
  try {
    zip = await openZip(archivePath)
    const manifestEntry = await nextEntry(zip)
    if (!manifestEntry) throw fail('invalid_manifest', 'ZIP 缺少 manifest.json')
    assertSafeEntryName(manifestEntry.fileName)
    if (manifestEntry.fileName !== 'manifest.json' || manifestEntry.uncompressedSize > ARCHIVE_LIMITS.manifestBytes) {
      throw fail('invalid_manifest', 'ZIP 第一项必须是大小受限的 manifest.json')
    }
    const manifestBytes = await readManifest(await readEntry(zip, manifestEntry), ARCHIVE_LIMITS.manifestBytes)
    if (manifestBytes.byteLength !== manifestEntry.uncompressedSize) throw fail('size_mismatch', 'manifest.json 实际大小与 ZIP 声明不一致')
    let manifest
    try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) } catch (error) {
      if (error?.code) throw error
      throw fail('invalid_manifest', 'manifest.json 编码或 JSON 无效', error)
    }
    const { paths, declaredBytes } = validateManifest(manifest)
    const parsedSource = parseSourceBackup({ format: 'json', bytes: manifestBytes, sourceName })
    const expected = new Map(manifest.attachments.map(item => [item.path, item]))
    const seen = new Set(['manifest.json'])
    const stagedAttachments = []
    const totals = { actualBytes: manifestBytes.byteLength }
    let compressedBytes = manifestEntry.compressedSize
    let entryCount = 1
    let entry
    while ((entry = await nextEntry(zip))) {
      entryCount += 1
      if (entryCount > ARCHIVE_LIMITS.attachments + 1) throw fail('attachment_count_limit', 'ZIP 条目数量超过限制')
      assertSafeEntryName(entry.fileName)
      if (seen.has(entry.fileName)) throw fail('duplicate_entry', 'ZIP 存在重复条目路径')
      seen.add(entry.fileName)
      const descriptor = expected.get(entry.fileName)
      if (!descriptor) throw fail('unknown_entry', 'ZIP 包含未在 manifest 中声明的条目')
      const fileType = (entry.externalFileAttributes >>> 16) & 0o170000
      if ((fileType !== 0 && fileType !== 0o100000) || entry.uncompressedSize !== descriptor.size
        || !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0) {
        throw fail('size_mismatch', 'ZIP 附件类型或声明大小无效')
      }
      compressedBytes += entry.compressedSize
      if (!Number.isSafeInteger(compressedBytes) || compressedBytes > ARCHIVE_LIMITS.totalBytes) {
        throw fail('archive_size_limit', 'ZIP 压缩数据超过 2 GiB')
      }
      if (totals.actualBytes + entry.uncompressedSize > ARCHIVE_LIMITS.totalBytes) throw fail('total_size_limit', 'ZIP 解压总量超过 2 GiB')
      const stagePath = join(stageDirectory, `${stagedAttachments.length}.blob`)
      await writeAttachment(zip, entry, descriptor, stagePath, totals)
      stagedAttachments.push({ ...descriptor, stagedPath: stagePath })
    }
    if (seen.size !== paths.size || [...paths].some(path => !seen.has(path))) throw fail('missing_entry', 'ZIP 缺少 manifest 声明的附件')
    if (totals.actualBytes !== manifestBytes.byteLength + declaredBytes) throw fail('size_mismatch', 'ZIP 实际解压总量与 manifest 不一致')
    zip.close()
    zip = undefined
    return {
      ...parsedSource,
      format: ARCHIVE_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION,
      attachments: stagedAttachments,
      stageDirectory,
      cleanup: () => rm(stageDirectory, { recursive: true, force: true }),
    }
  } catch (error) {
    try { zip?.close() } catch {}
    await rm(stageDirectory, { recursive: true, force: true }).catch(() => {})
    if (error?.code) throw error
    throw fail('invalid_archive', 'ZIP 导入校验失败', error)
  }
}

export async function assertArchiveStagingIntegrity(parsedSource) {
  for (const item of parsedSource?.attachments ?? []) {
    const stats = await lstat(item.stagedPath)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== item.size) throw fail('invalid_attachment', '暂存附件已变化')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(item.stagedPath)) hash.update(chunk)
    if (hash.digest('hex') !== item.sha256) throw fail('checksum_mismatch', '暂存附件摘要已变化')
  }
  return true
}
