import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'

export const PLUGIN_BACKUP_ARCHIVE_FORMAT = 'forward-step-dsh-backup-archive'
export const PLUGIN_BACKUP_ARCHIVE_VERSION = 1
export const PLUGIN_BACKUP_ARCHIVE_LIMITS = Object.freeze({
  archiveBytes: 2 * 1024 * 1024 * 1024,
  manifestBytes: 128 * 1024 * 1024,
  attachments: 10_000,
  attachmentBytes: 25 * 1024 * 1024,
  totalAttachmentBytes: 2 * 1024 * 1024 * 1024,
})

const MANIFEST_KEYS = ['format', 'formatVersion', 'backup', 'attachments']
const fail = (code, message, cause) => Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code })
const exactKeys = (value, keys) => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)))

function safeAttachmentId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && !/[\\/\u0000-\u001f]/u.test(value)
}

async function inspectStream(iterable, { signal, maxBytes = PLUGIN_BACKUP_ARCHIVE_LIMITS.attachmentBytes, errorCode = 'attachment_size_limit' } = {}) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of iterable) {
    signal?.throwIfAborted()
    if (!(chunk instanceof Uint8Array)) throw fail('invalid_attachment', '附件存储返回了无效数据块')
    bytes += chunk.byteLength
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes) throw fail(errorCode, '数据超过插件备份限额')
    hash.update(chunk)
  }
  return { bytes, sha256: hash.digest('hex') }
}

function readZip(path) {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error) reject(fail('invalid_archive', '无法读取插件备份 ZIP', error))
      else resolve(zip)
    })
  })
}

function nextEntry(zip) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      zip.removeListener('error', onError)
      zip.removeListener('entry', onEntry)
      zip.removeListener('end', onEnd)
    }
    const onError = error => { cleanup(); reject(fail('invalid_archive', '插件备份 ZIP 目录无效', error)) }
    const onEntry = entry => { cleanup(); resolve(entry) }
    const onEnd = () => { cleanup(); resolve(null) }
    zip.once('error', onError)
    zip.once('entry', onEntry)
    zip.once('end', onEnd)
    zip.readEntry()
  })
}

function readEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(fail('invalid_archive', '无法读取插件备份 ZIP 条目', error))
      else resolve(stream)
    })
  })
}

async function readEntryBuffer(zip, entry, limit) {
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > limit) throw fail('manifest_size_limit', '插件备份清单超过限额')
  const chunks = []
  let size = 0
  for await (const chunk of await readEntry(zip, entry)) {
    size += chunk.byteLength
    if (size > limit) throw fail('manifest_size_limit', '插件备份清单实际大小超过限额')
    chunks.push(chunk)
  }
  if (size !== entry.uncompressedSize) throw fail('size_mismatch', '插件备份清单大小不匹配')
  return Buffer.concat(chunks)
}

function countRecordsAndDepth(value) {
  const stack = [{ value, depth: 1 }]
  let records = 0
  while (stack.length) {
    const current = stack.pop()
    if (current.depth > 64) throw fail('manifest_depth_limit', '插件备份数据嵌套超过 64 层')
    if (!current.value || typeof current.value !== 'object') continue
    if (Array.isArray(current.value)) {
      records += current.value.length
      if (records > 100_000) throw fail('manifest_record_limit', '插件备份记录数超过 100,000 条')
    }
    for (const child of Object.values(current.value)) stack.push({ value: child, depth: current.depth + 1 })
  }
}

function validateBackupAttachments(backup, attachments) {
  const records = backup?.data?.researchAttachments
  if (!Array.isArray(records)) throw fail('invalid_backup', '插件备份缺少附件索引')
  const recordsById = new Map()
  for (const record of records) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || recordsById.has(record.id)) {
      throw fail('invalid_attachment', '插件备份附件索引缺少唯一 ID')
    }
    recordsById.set(record.id, record)
  }
  const descriptorsById = new Map()
  for (const descriptor of attachments) {
    const record = recordsById.get(descriptor.id)
    if (!record?.storageRef || descriptorsById.has(descriptor.id)
      || record.storageRef.attachmentId !== descriptor.attachmentId
      || record.storageRef.bytes !== descriptor.bytes
      || (record.storageSha256 && record.storageSha256 !== descriptor.sha256)) {
      throw fail('invalid_attachment_reference', '插件备份附件清单与附件索引不匹配')
    }
    descriptorsById.set(descriptor.id, descriptor)
  }
  for (const record of records) {
    if (record.storageRef && !descriptorsById.has(record.id)) {
      throw fail('missing_entry', '完整插件备份缺少已保存附件的内容')
    }
  }
  return true
}

function validateManifest(manifest) {
  if (!exactKeys(manifest, MANIFEST_KEYS) || manifest.format !== PLUGIN_BACKUP_ARCHIVE_FORMAT
    || manifest.formatVersion !== PLUGIN_BACKUP_ARCHIVE_VERSION || !manifest.backup || typeof manifest.backup !== 'object'
    || Array.isArray(manifest.backup) || !Array.isArray(manifest.attachments)
    || manifest.attachments.length > PLUGIN_BACKUP_ARCHIVE_LIMITS.attachments) {
    throw fail('invalid_manifest', '插件备份清单格式或版本无效')
  }
  countRecordsAndDepth(manifest.backup)
  const paths = new Set(['manifest.json'])
  const ids = new Set()
  let totalBytes = 0
  for (const [index, item] of manifest.attachments.entries()) {
    if (!exactKeys(item, ['id', 'attachmentId', 'name', 'bytes', 'sha256', 'path'])
      || !safeAttachmentId(item.id) || !safeAttachmentId(item.attachmentId)
      || typeof item.name !== 'string' || item.name.length > 240
      || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > PLUGIN_BACKUP_ARCHIVE_LIMITS.attachmentBytes
      || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)
      || item.path !== `attachments/${index}.blob` || paths.has(item.path) || ids.has(item.id)) {
      throw fail('invalid_attachment', '插件备份附件描述无效')
    }
    paths.add(item.path)
    ids.add(item.id)
    totalBytes += item.bytes
    if (!Number.isSafeInteger(totalBytes) || totalBytes > PLUGIN_BACKUP_ARCHIVE_LIMITS.totalAttachmentBytes) {
      throw fail('total_size_limit', '插件备份附件总量超过限额')
    }
  }
  return paths
}

export async function createPluginBackupArchive({ backup, attachmentStore, outputPath, signal } = {}) {
  if (!backup || backup.format !== 'forward-step-dsh-workspace' || !backup.data || typeof backup.data !== 'object'
    || !Array.isArray(backup.data.researchAttachments) || typeof outputPath !== 'string' || !outputPath) {
    throw fail('invalid_backup', '插件备份或输出路径无效')
  }
  countRecordsAndDepth(backup)
  const attachments = []
  for (const item of backup.data.researchAttachments) {
    if (item?.status !== 'verified') continue
    if (!item?.storageRef) continue
    if (!attachmentStore || typeof attachmentStore.readFileStream !== 'function'
      || !safeAttachmentId(item.id) || !safeAttachmentId(item.storageRef.attachmentId)
      || !Number.isSafeInteger(item.storageRef.bytes) || item.storageRef.bytes < 1) {
      throw fail('attachment_unavailable', '插件附件引用无效或宿主不支持附件读取')
    }
    const actual = await inspectStream(attachmentStore.readFileStream(item.storageRef, signal), { signal })
    if (actual.bytes !== item.storageRef.bytes || (item.storageSha256 && actual.sha256 !== item.storageSha256)
      || (item.storageRef.attachmentId.startsWith('sha256:') && actual.sha256 !== item.storageRef.attachmentId.slice(7))) {
      throw fail('attachment_mismatch', '插件附件读回与保存的摘要不匹配')
    }
    attachments.push({
      id: item.id,
      attachmentId: item.storageRef.attachmentId,
      name: typeof item.storageRef.name === 'string' ? item.storageRef.name.slice(0, 240) : item.id,
      bytes: actual.bytes,
      sha256: actual.sha256,
      path: `attachments/${attachments.length}.blob`,
      storageRef: structuredClone(item.storageRef),
    })
  }
  const publicAttachments = attachments.map(({ storageRef, ...item }) => item)
  validateBackupAttachments(backup, publicAttachments)
  const manifest = { format: PLUGIN_BACKUP_ARCHIVE_FORMAT, formatVersion: PLUGIN_BACKUP_ARCHIVE_VERSION, backup, attachments: publicAttachments }
  const encoded = Buffer.from(JSON.stringify(manifest), 'utf8')
  if (encoded.byteLength > PLUGIN_BACKUP_ARCHIVE_LIMITS.manifestBytes) throw fail('manifest_size_limit', '插件备份清单超过 128 MiB')
  const paths = validateManifest(manifest)
  if (paths.size !== attachments.length + 1) throw fail('invalid_manifest', '插件备份附件路径重复')
  const zip = new yazl.ZipFile()
  zip.addBuffer(encoded, 'manifest.json', { compress: false })
  for (const item of attachments) {
    signal?.throwIfAborted()
    zip.addReadStreamLazy(item.path, { compress: false, size: item.bytes }, callback => {
      try { callback(null, Readable.from(attachmentStore.readFileStream(item.storageRef, signal))) }
      catch (error) { callback(error) }
    })
  }
  await mkdir(dirname(outputPath), { recursive: true })
  const output = createWriteStream(outputPath, { flags: 'wx' })
  try {
    const maxBytes = PLUGIN_BACKUP_ARCHIVE_LIMITS.archiveBytes
    let archiveBytes = 0
    const archiveHash = createHash('sha256')
    const counter = new Transform({
      transform(chunk, encoding, callback) {
        archiveBytes += chunk.byteLength
        if (archiveBytes > maxBytes) return callback(fail('archive_size_limit', '插件备份 ZIP 超过 2 GiB'))
        archiveHash.update(chunk)
        callback(null, chunk)
      },
    })
    const writing = pipeline(zip.outputStream, counter, output, { signal })
    zip.end()
    await writing
    return { outputPath, byteLength: archiveBytes, attachmentCount: attachments.length, sha256: archiveHash.digest('hex'), format: PLUGIN_BACKUP_ARCHIVE_FORMAT, formatVersion: PLUGIN_BACKUP_ARCHIVE_VERSION }
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => {})
    if (error?.code) throw error
    throw fail('archive_write_failed', '插件备份归档写入失败', error)
  }
}

export async function persistPluginBackupAttachments({ backup, attachments, attachmentStore, onAttempt, onVerified, onFailure, signal } = {}) {
  if (!backup?.data || !Array.isArray(backup.data.researchAttachments) || !Array.isArray(attachments)
    || !attachmentStore?.saveFileStream || !attachmentStore?.readFileStream) {
    throw fail('attachment_unavailable', '当前 Host 未提供插件附件读写能力')
  }
  const nextBackup = structuredClone(backup)
  const recordsById = new Map(nextBackup.data.researchAttachments.map(item => [item?.id, item]))
  for (const descriptor of attachments) {
    signal?.throwIfAborted()
    const record = recordsById.get(descriptor.id)
    if (!record || record.storageRef?.attachmentId !== descriptor.attachmentId
      || record.storageRef?.bytes !== descriptor.bytes) {
      throw fail('invalid_attachment_reference', '插件备份附件与索引记录不匹配')
    }
    try {
      await onAttempt?.({ descriptor })
      const ref = await attachmentStore.saveFileStream({
        data: createReadStream(descriptor.stagedPath),
        name: descriptor.id,
        signal,
      })
      if (ref?.attachmentId !== `sha256:${descriptor.sha256}` || ref.bytes !== descriptor.bytes) {
        throw fail('attachment_mismatch', '插件附件存储返回的内容寻址引用不匹配')
      }
      const verified = await inspectStream(attachmentStore.readFileStream(ref, signal), {
        signal,
        maxBytes: descriptor.bytes,
      })
      if (verified.bytes !== descriptor.bytes || verified.sha256 !== descriptor.sha256) {
        throw fail('attachment_mismatch', '插件附件持久化读回校验失败')
      }
      record.storageRef = { attachmentId: ref.attachmentId, name: descriptor.name, bytes: descriptor.bytes }
      record.storageSha256 = descriptor.sha256
      await onVerified?.({ descriptor, ref: record.storageRef })
    } catch (error) {
      await onFailure?.({ descriptor, errorCode: typeof error?.code === 'string' ? error.code : 'attachment_persist_failed' })
      throw error
    }
  }
  return nextBackup
}

export async function stagePluginBackupArchive({ archivePath, tempRoot = tmpdir() } = {}) {
  if (typeof archivePath !== 'string' || !archivePath) throw fail('invalid_input', '插件备份路径无效')
  const stageDirectory = await mkdtemp(join(tempRoot, 'forward-step-plugin-backup-'))
  let zip
  try {
    const archiveInfo = await stat(archivePath)
    if (!archiveInfo.isFile() || archiveInfo.size < 22 || archiveInfo.size > PLUGIN_BACKUP_ARCHIVE_LIMITS.archiveBytes) {
      throw fail('archive_size_limit', '插件备份 ZIP 文件大小无效或超过 2 GiB')
    }
    zip = await readZip(archivePath)
    const manifestEntry = await nextEntry(zip)
    if (!manifestEntry || manifestEntry.fileName !== 'manifest.json' || manifestEntry.uncompressedSize > PLUGIN_BACKUP_ARCHIVE_LIMITS.manifestBytes) {
      throw fail('invalid_manifest', 'ZIP 第一项必须是受限的 manifest.json')
    }
    const manifestBytes = await readEntryBuffer(zip, manifestEntry, PLUGIN_BACKUP_ARCHIVE_LIMITS.manifestBytes)
    let manifest
    try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) }
    catch (error) { throw fail('invalid_manifest', '插件备份清单不是有效 JSON', error) }
    const expectedPaths = validateManifest(manifest)
    validateBackupAttachments(manifest.backup, manifest.attachments)
    const stageAttachments = []
    const seen = new Set(['manifest.json'])
    let index = 0
    let totalBytes = manifestBytes.byteLength
    let entry
    while ((entry = await nextEntry(zip))) {
      if (index >= manifest.attachments.length || entry.fileName !== manifest.attachments[index].path
        || seen.has(entry.fileName)) throw fail('unexpected_entry', '插件备份包含重复、未知或乱序条目')
      const descriptor = manifest.attachments[index]
      const type = (entry.externalFileAttributes >>> 16) & 0o170000
      if ((type !== 0 && type !== 0o100000) || entry.uncompressedSize !== descriptor.bytes
        || !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize > PLUGIN_BACKUP_ARCHIVE_LIMITS.archiveBytes) {
        throw fail('size_mismatch', '附件类型或归档大小声明不匹配')
      }
      seen.add(entry.fileName)
      const path = join(stageDirectory, `${index}.blob`)
      const stream = await readEntry(zip, entry)
      const hash = createHash('sha256')
      let actualBytes = 0
      const verifier = new Transform({
        transform(chunk, encoding, callback) {
          actualBytes += chunk.byteLength
          totalBytes += chunk.byteLength
          if (actualBytes > descriptor.bytes || totalBytes > PLUGIN_BACKUP_ARCHIVE_LIMITS.archiveBytes) return callback(fail('size_mismatch', '插件备份附件实际大小超过声明'))
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      await pipeline(stream, verifier, createWriteStream(path, { flags: 'wx' }))
      const actualHash = hash.digest('hex')
      if (actualBytes !== descriptor.bytes || actualHash !== descriptor.sha256) throw fail('checksum_mismatch', '插件备份附件摘要校验失败')
      stageAttachments.push({ ...descriptor, stagedPath: path })
      index += 1
    }
    if (seen.size !== expectedPaths.size || index !== manifest.attachments.length) throw fail('missing_entry', '插件备份缺少清单声明的附件')
    zip.close()
    zip = undefined
    return {
      format: PLUGIN_BACKUP_ARCHIVE_FORMAT,
      formatVersion: PLUGIN_BACKUP_ARCHIVE_VERSION,
      backup: manifest.backup,
      attachments: stageAttachments,
      sha256: (await inspectStream(createReadStream(archivePath), {
        maxBytes: PLUGIN_BACKUP_ARCHIVE_LIMITS.archiveBytes,
        errorCode: 'archive_size_limit',
      })).sha256,
      byteLength: archiveInfo.size,
      stageDirectory,
      cleanup: () => rm(stageDirectory, { recursive: true, force: true }),
    }
  } catch (error) {
    try { zip?.close() } catch {}
    await rm(stageDirectory, { recursive: true, force: true }).catch(() => {})
    if (error?.code) throw error
    throw fail('invalid_archive', '插件备份 ZIP 校验失败', error)
  }
}
