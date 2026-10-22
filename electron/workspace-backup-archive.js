'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const yauzl = require('yauzl');

const FORMAT = 'forward-step-workspace-archive';
const FORMAT_VERSION = 1;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024 * 1024;
const MAX_ATTACHMENTS = 10_000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const TASK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const ATTACHMENT_ID = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})_([a-f0-9]{32})\.(txt|pdf|png|jpg|webp)$/;
const MIME_EXTENSIONS = Object.freeze({
  'text/plain': 'txt',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
});
const MANIFEST_KEYS = ['format', 'formatVersion', 'workspace', 'attachments'];

class WorkspaceArchiveError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'WorkspaceArchiveError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  return new WorkspaceArchiveError(code, message, cause);
}

function zipReadError(error) {
  if (/invalid relative path/i.test(error?.message || '')) return fail('UNSAFE_PATH', 'ZIP 条目路径不安全', error);
  return fail('INVALID_ARCHIVE', 'ZIP 目录读取失败', error);
}

function verifyingStream(expectedSize, expectedHash) {
  const hash = createHash('sha256');
  let bytes = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > expectedSize || bytes > MAX_ATTACHMENT_BYTES) {
        callback(fail('SIZE_MISMATCH', '附件实际大小超过清单声明'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      if (bytes !== expectedSize) callback(fail('SIZE_MISMATCH', '附件实际大小与清单声明不一致'));
      else if (hash.digest('hex') !== expectedHash) callback(fail('CHECKSUM_MISMATCH', '附件 SHA-256 校验失败'));
      else callback();
    }
  });
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function validateAttachment(item, seenIds, seenPaths, taskBytes) {
  const keys = ['id', 'taskId', 'type', 'size', 'sha256', 'path'];
  if (!exactKeys(item, keys) || typeof item.id !== 'string' || typeof item.taskId !== 'string'
    || !TASK_ID.test(item.taskId) || !Number.isSafeInteger(item.size) || item.size <= 0
    || item.size > MAX_ATTACHMENT_BYTES || typeof item.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(item.sha256) || MIME_EXTENSIONS[item.type] === undefined) {
    throw fail('INVALID_MANIFEST', '附件清单字段无效');
  }
  const match = ATTACHMENT_ID.exec(item.id);
  const expectedPath = `attachments/${item.taskId}/${item.id}`;
  if (!match || match[1] !== item.taskId || match[3] !== MIME_EXTENSIONS[item.type]
    || item.path !== expectedPath || seenIds.has(item.id) || seenPaths.has(item.path)) {
    throw fail('INVALID_ATTACHMENT', '附件 ID、类型或归档路径无效');
  }
  seenIds.add(item.id);
  seenPaths.add(item.path);
  const sum = (taskBytes.get(item.taskId) || 0) + item.size;
  if (sum > MAX_ATTACHMENT_BYTES) throw fail('TASK_ATTACHMENT_LIMIT', '单个任务的附件总量超过 25 MiB');
  taskBytes.set(item.taskId, sum);
}

function validateManifest(manifest) {
  if (!exactKeys(manifest, MANIFEST_KEYS) || manifest.format !== FORMAT
    || manifest.formatVersion !== FORMAT_VERSION || !manifest.workspace
    || typeof manifest.workspace !== 'object' || Array.isArray(manifest.workspace)
    || !Array.isArray(manifest.attachments) || manifest.attachments.length > MAX_ATTACHMENTS) {
    throw fail('INVALID_MANIFEST', '归档清单格式或版本无效');
  }
  const ids = new Set();
  const paths = new Set(['manifest.json']);
  const taskBytes = new Map();
  let total = 0;
  for (const item of manifest.attachments) {
    validateAttachment(item, ids, paths, taskBytes);
    total += item.size;
    if (total > MAX_TOTAL_BYTES) {
      throw fail('TOTAL_SIZE_LIMIT', '归档声明的解压总量超过 2 GiB');
    }
  }
  return { paths, totalAttachmentBytes: total };
}

function normalizeExportAttachment(item) {
  if (!item || typeof item !== 'object') throw fail('INVALID_ATTACHMENT', '导出附件描述无效');
  const { id, taskId, type } = item;
  const filePath = item.path;
  const streamFactory = item.openStream;
  const size = item.size;
  if (typeof id !== 'string' || typeof taskId !== 'string' || typeof type !== 'string'
    || !Number.isSafeInteger(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES
    || (typeof filePath !== 'string' && typeof streamFactory !== 'function')
    || (filePath !== undefined && streamFactory !== undefined)) {
    throw fail('INVALID_ATTACHMENT', '导出附件必须提供安全路径或流工厂及其大小');
  }
  return { id, taskId, type, size, path: `attachments/${taskId}/${id}`, filePath, streamFactory };
}

function writeArchive(output, zip) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = error => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    output.once('error', error => done(fail('ARCHIVE_WRITE_FAILED', '写入 ZIP 归档失败', error)));
    output.once('finish', () => done());
    zip.once('error', error => done(fail('ARCHIVE_WRITE_FAILED', '生成 ZIP 归档失败', error)));
    zip.outputStream.pipe(output);
    zip.end();
  });
}

async function exportWorkspaceArchive({ output, workspace, attachments = [] } = {}) {
  if (!output || typeof output.write !== 'function' || !workspace || typeof workspace !== 'object'
    || Array.isArray(workspace) || !Array.isArray(attachments)) {
    throw fail('INVALID_ARGUMENT', '导出参数无效');
  }
  if (attachments.length > MAX_ATTACHMENTS) throw fail('ATTACHMENT_COUNT_LIMIT', '附件数量超过 10,000');
  const normalized = attachments.map(normalizeExportAttachment);
  const manifest = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    workspace,
    attachments: normalized.map(({ id, taskId, type, size, path: archivePath }) => ({
      id, taskId, type, size, sha256: '0'.repeat(64), path: archivePath
    }))
  };
  validateManifest(manifest);
  for (let index = 0; index < normalized.length; index += 1) {
    const attachment = normalized[index];
    const input = attachment.filePath
      ? await openSafeFile(attachment.filePath, attachment.size)
      : await attachment.streamFactory();
    if (!input || typeof input.pipe !== 'function') throw fail('INVALID_ATTACHMENT', '附件流无效');
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > attachment.size || bytes > MAX_ATTACHMENT_BYTES) {
          callback(fail('SIZE_MISMATCH', '附件实际大小超过清单声明'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    await pipeline(input, meter, new Writable({ write(chunk, encoding, callback) { callback(); } }));
    if (bytes !== attachment.size) throw fail('SIZE_MISMATCH', '附件实际大小与清单声明不一致');
    manifest.attachments[index].sha256 = hash.digest('hex');
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  if (manifestBytes.length > MAX_MANIFEST_BYTES) throw fail('MANIFEST_SIZE_LIMIT', '清单超过 128 MiB');
  if (manifestBytes.length + normalized.reduce((sum, item) => sum + item.size, 0) > MAX_TOTAL_BYTES) {
    throw fail('TOTAL_SIZE_LIMIT', '归档声明的解压总量超过 2 GiB');
  }
  validateManifest(manifest);
  const zip = new yazl.ZipFile();
  zip.addBuffer(manifestBytes, 'manifest.json');
  for (let index = 0; index < normalized.length; index += 1) {
    const attachment = normalized[index];
    const input = attachment.filePath
      ? await openSafeFile(attachment.filePath, attachment.size)
      : await attachment.streamFactory();
    if (!input || typeof input.pipe !== 'function') throw fail('INVALID_ATTACHMENT', '附件流无效');
    const verified = verifyingStream(attachment.size, manifest.attachments[index].sha256);
    zip.addReadStream(verified, attachment.path, { size: attachment.size });
    input.pipe(verified);
  }
  await writeArchive(output, zip);
  return { format: FORMAT, formatVersion: FORMAT_VERSION, attachmentCount: normalized.length };
}

async function openSafeFile(filePath, expectedSize) {
  let stats;
  try { stats = await fs.promises.lstat(filePath); } catch (error) {
    throw fail('INVALID_ATTACHMENT', '附件文件不可读取', error);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== expectedSize) {
    throw fail('INVALID_ATTACHMENT', '附件路径必须指向大小匹配的普通文件');
  }
  return fs.createReadStream(filePath);
}

function openZip(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error) reject(fail('INVALID_ARCHIVE', '无法读取 ZIP 归档', error));
      else resolve(zip);
    });
  });
}

function readEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(fail('INVALID_ARCHIVE', '无法读取 ZIP 条目', error));
      else resolve(stream);
    });
  });
}

async function collectLimited(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw fail('MANIFEST_SIZE_LIMIT', '清单实际大小超过 128 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function assertSafeArchivePath(name) {
  if (typeof name !== 'string' || name.includes('\\') || name.startsWith('/')
    || /^[a-zA-Z]:/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw fail('UNSAFE_PATH', 'ZIP 条目路径不安全');
  }
}

async function ensureOutputDirectory(tempDirectory) {
  const resolved = path.resolve(tempDirectory);
  let stats;
  try { stats = await fs.promises.lstat(resolved); } catch (error) {
    throw fail('INVALID_ARGUMENT', '临时目录必须预先存在', error);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw fail('INVALID_ARGUMENT', '临时路径必须是普通目录');
  return await fs.promises.realpath(resolved);
}

async function ensureTaskDirectory(root, taskId, createdDirectories) {
  const attachmentsRoot = path.join(root, 'attachments');
  const taskDirectory = path.join(attachmentsRoot, taskId);
  for (const directory of [attachmentsRoot, taskDirectory]) {
    try {
      const stats = await fs.promises.lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw fail('UNSAFE_PATH', '附件目标目录不安全');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.promises.mkdir(directory, { mode: 0o700 });
      createdDirectories.push(directory);
    }
    const realDirectory = await fs.promises.realpath(directory);
    const relative = path.relative(root, realDirectory);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw fail('UNSAFE_PATH', '附件目标目录越界');
    }
  }
  return taskDirectory;
}

async function importWorkspaceArchive({ archivePath, tempDirectory } = {}) {
  if (typeof archivePath !== 'string' || typeof tempDirectory !== 'string') {
    throw fail('INVALID_ARGUMENT', '导入参数无效');
  }
  const root = await ensureOutputDirectory(tempDirectory);
  let archiveStats;
  try { archiveStats = await fs.promises.lstat(archivePath); } catch (error) {
    throw fail('INVALID_ARCHIVE', '无法读取 ZIP 归档', error);
  }
  if (!archiveStats.isFile() || archiveStats.isSymbolicLink() || archiveStats.size <= 0
    || archiveStats.size > MAX_TOTAL_BYTES) {
    throw fail('ARCHIVE_SIZE_LIMIT', 'ZIP 文件大小无效或超过 2 GiB');
  }
  const zip = await openZip(archivePath);
  const createdFiles = [];
  const createdDirectories = [];
  try {
    const first = await new Promise((resolve, reject) => {
      zip.once('error', error => reject(fail('INVALID_ARCHIVE', 'ZIP 目录读取失败', error)));
      zip.once('entry', resolve);
      zip.once('end', () => reject(fail('INVALID_ARCHIVE', 'ZIP 缺少 manifest.json')));
      zip.readEntry();
    });
    assertSafeArchivePath(first.fileName);
    if (first.fileName !== 'manifest.json' || first.uncompressedSize > MAX_MANIFEST_BYTES) {
      throw fail('INVALID_MANIFEST', 'ZIP 第一项必须是受限大小的 manifest.json');
    }
    const manifestBytes = await collectLimited(await readEntry(zip, first), MAX_MANIFEST_BYTES);
    if (manifestBytes.length !== first.uncompressedSize) throw fail('SIZE_MISMATCH', '清单实际大小与 ZIP 声明不一致');
    let manifest;
    try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch (error) {
      throw fail('INVALID_MANIFEST', 'manifest.json 不是有效 JSON', error);
    }
    const { paths } = validateManifest(manifest);
    const requiredBytes = manifestBytes.length + manifest.attachments.reduce((sum, item) => sum + item.size, 0);
    if (typeof fs.promises.statfs !== 'function') throw fail('DISK_SPACE_UNAVAILABLE', '无法检查目标磁盘剩余空间');
    let disk;
    try { disk = await fs.promises.statfs(root); } catch (error) {
      throw fail('DISK_SPACE_UNAVAILABLE', '无法检查目标磁盘剩余空间', error);
    }
    if (disk.bavail * disk.bsize < requiredBytes) throw fail('INSUFFICIENT_DISK_SPACE', '目标磁盘空间不足，未导入附件');
    const expected = new Map(manifest.attachments.map(item => [item.path, item]));
    const seen = new Set(['manifest.json']);
    let actualTotal = manifestBytes.length;
    let compressedTotal = first.compressedSize;
    let entryCount = 1;

    while (true) {
      const entry = await new Promise((resolve, reject) => {
        const onError = error => reject(zipReadError(error));
        zip.once('error', onError);
        zip.once('entry', item => { zip.removeListener('error', onError); resolve(item); });
        zip.once('end', () => { zip.removeListener('error', onError); resolve(null); });
        zip.readEntry();
      });
      if (!entry) break;
      entryCount += 1;
      if (entryCount > MAX_ATTACHMENTS + 1) throw fail('ATTACHMENT_COUNT_LIMIT', 'ZIP 条目数量超过限制');
      assertSafeArchivePath(entry.fileName);
      if (seen.has(entry.fileName)) throw fail('DUPLICATE_ENTRY', 'ZIP 中存在重复条目');
      seen.add(entry.fileName);
      const descriptor = expected.get(entry.fileName);
      if (!descriptor) throw fail('UNKNOWN_ENTRY', 'ZIP 包含未在清单声明的条目');
      const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
      if ((fileType !== 0 && fileType !== 0o100000)
        || entry.uncompressedSize !== descriptor.size || entry.uncompressedSize > MAX_ATTACHMENT_BYTES
        || !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0) {
        throw fail('SIZE_MISMATCH', '附件 ZIP 声明大小无效');
      }
      compressedTotal += entry.compressedSize;
      if (!Number.isSafeInteger(compressedTotal) || compressedTotal > MAX_TOTAL_BYTES) {
        throw fail('ARCHIVE_SIZE_LIMIT', 'ZIP 条目压缩总量超过 2 GiB');
      }
      if (actualTotal + entry.uncompressedSize > MAX_TOTAL_BYTES) throw fail('TOTAL_SIZE_LIMIT', 'ZIP 解压总量超过 2 GiB');
      const relative = entry.fileName.split('/');
      const taskDirectory = await ensureTaskDirectory(root, relative[1], createdDirectories);
      const destination = path.resolve(taskDirectory, relative[2]);
      const relativeDestination = path.relative(root, destination);
      if (relativeDestination.startsWith('..') || path.isAbsolute(relativeDestination)) throw fail('UNSAFE_PATH', '附件目标路径越界');
      const hash = createHash('sha256');
      let entryBytes = 0;
      const meter = new Transform({
        transform(chunk, encoding, callback) {
          entryBytes += chunk.length;
          actualTotal += chunk.length;
          if (entryBytes > descriptor.size || entryBytes > MAX_ATTACHMENT_BYTES) {
            callback(fail('SIZE_MISMATCH', '附件实际大小超过清单声明'));
          } else if (actualTotal > MAX_TOTAL_BYTES) {
            callback(fail('TOTAL_SIZE_LIMIT', 'ZIP 实际解压总量超过 2 GiB'));
          } else {
            hash.update(chunk);
            callback(null, chunk);
          }
        }
      });
      let fileHandle;
      try { fileHandle = await fs.promises.open(destination, 'wx', 0o600); } catch (error) {
        throw fail('OUTPUT_WRITE_FAILED', '附件临时文件无法创建', error);
      }
      createdFiles.push(destination);
      await pipeline(await readEntry(zip, entry), meter, fileHandle.createWriteStream());
      if (entryBytes !== descriptor.size || hash.digest('hex') !== descriptor.sha256) {
        throw fail('CHECKSUM_MISMATCH', '附件大小或 SHA-256 校验失败');
      }
    }
    if (seen.size !== paths.size || [...paths].some(name => !seen.has(name))) {
      throw fail('MISSING_ENTRY', 'ZIP 缺少清单声明的附件');
    }
    zip.close();
    return {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      workspace: manifest.workspace,
      attachments: manifest.attachments.map(item => ({ ...item, path: path.resolve(root, ...item.path.split('/')) }))
    };
  } catch (error) {
    try { zip.close(); } catch {}
    await Promise.all(createdFiles.map(file => fs.promises.unlink(file).catch(() => {})));
    for (const directory of createdDirectories.reverse()) await fs.promises.rmdir(directory).catch(() => {});
    if (error instanceof WorkspaceArchiveError) throw error;
    throw fail('INVALID_ARCHIVE', '导入 ZIP 归档失败', error);
  }
}

module.exports = {
  FORMAT,
  FORMAT_VERSION,
  LIMITS: Object.freeze({
    totalBytes: MAX_TOTAL_BYTES,
    manifestBytes: MAX_MANIFEST_BYTES,
    attachments: MAX_ATTACHMENTS,
    attachmentBytes: MAX_ATTACHMENT_BYTES,
    perTaskAttachmentBytes: MAX_ATTACHMENT_BYTES
  }),
  WorkspaceArchiveError,
  exportWorkspaceArchive,
  importWorkspaceArchive
};
