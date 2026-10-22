const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const TASK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const ID_PATTERN = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})_([a-f0-9]{32})\.(txt|pdf|png|jpg|webp)$/;
const MIME_TYPES = Object.freeze({
  'text/plain': 'txt',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
});

function createSocialAttachmentStore({ userDataPath, fsModule = fs, pathModule = path, now = () => new Date().toISOString(), createId = () => randomUUID().replace(/-/g, '') } = {}) {
  if (typeof userDataPath !== 'string' || !userDataPath) throw new TypeError('缺少 userData 路径');
  const root = pathModule.resolve(userDataPath, 'research-attachments');

  function withinRoot(target) {
    const relative = pathModule.relative(root, target);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${pathModule.sep}`) && !pathModule.isAbsolute(relative);
  }

  function assertSafeDirectory(directory) {
    if (!withinRoot(directory)) throw new TypeError('附件路径无效');
    const relative = pathModule.relative(root, directory);
    const parts = relative.split(pathModule.sep);
    let current = root;
    for (const part of ['', ...parts]) {
      if (part) current = pathModule.join(current, part);
      try {
        const stats = fsModule.lstatSync(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw new TypeError('附件目录不安全');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        fsModule.mkdirSync(current, { mode: 0o700 });
      }
    }
    const realRoot = fsModule.realpathSync(root);
    const realDirectory = fsModule.realpathSync(directory);
    if (!withinRoot(realDirectory)) throw new TypeError('附件路径超出存储目录');
  }

  function decodeContent(payload) {
    let content;
    if (Buffer.isBuffer(payload.content)) content = Buffer.from(payload.content);
    else if (payload.encoding === 'base64' && typeof payload.content === 'string'
      && payload.content.length <= Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4
      && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.content)) {
      content = Buffer.from(payload.content, 'base64');
      if (content.toString('base64') !== payload.content) throw new TypeError('附件 base64 格式无效');
    } else throw new TypeError('附件内容必须是 Buffer 或 base64');
    if (!content.length || content.length > MAX_ATTACHMENT_BYTES) throw new RangeError('附件大小超出限制');
    return content;
  }

  function fileForId(id) {
    if (typeof id !== 'string') throw new TypeError('附件 ID 无效');
    const match = ID_PATTERN.exec(id);
    if (!match) throw new TypeError('附件 ID 无效');
    const directory = pathModule.resolve(root, match[1]);
    const filePath = pathModule.resolve(directory, id);
    if (!withinRoot(directory) || !withinRoot(filePath)) throw new TypeError('附件 ID 无效');
    assertSafeDirectory(directory);
    const stats = fsModule.lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new TypeError('附件文件不安全');
    const realPath = fsModule.realpathSync(filePath);
    if (!withinRoot(realPath)) throw new TypeError('附件路径超出存储目录');
    return { filePath, taskId: match[1], stats };
  }

  function save(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some(key => !['taskId', 'content', 'encoding', 'mimeType', 'sourceResultId'].includes(key))) {
      throw new TypeError('附件请求格式无效');
    }
    const { taskId, mimeType, sourceResultId = '' } = payload;
    if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) throw new TypeError('taskId 无效');
    const extension = MIME_TYPES[mimeType];
    if (!extension) throw new TypeError('附件类型不受支持');
    if (typeof sourceResultId !== 'string' || sourceResultId.length > 256) throw new TypeError('来源结果 ID 无效');
    const content = decodeContent(payload);
    const directory = pathModule.resolve(root, taskId);
    assertSafeDirectory(directory);
    const randomPart = createId();
    if (!/^[a-f0-9]{32}$/.test(randomPart)) throw new TypeError('附件 ID 生成失败');
    const id = `${taskId}_${randomPart}.${extension}`;
    const filePath = pathModule.resolve(directory, id);
    if (!withinRoot(filePath)) throw new TypeError('附件路径无效');
    fsModule.writeFileSync(filePath, content, { flag: 'wx', mode: 0o600 });
    return { id, type: mimeType, size: content.length, sourceResultId, relativePath: `${taskId}/${id}`, savedAt: now() };
  }

  function read(id) {
    const { filePath } = fileForId(id);
    return fsModule.readFileSync(filePath);
  }

  function createReadStream(id) {
    const { filePath } = fileForId(id);
    return fsModule.createReadStream(filePath);
  }

  function has(id) {
    try {
      fileForId(id);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function importFile({ id, type, size, sha256, sourcePath } = {}) {
    if (typeof id !== 'string' || typeof type !== 'string' || !Number.isSafeInteger(size)
      || size <= 0 || size > MAX_ATTACHMENT_BYTES || !/^[a-f0-9]{64}$/.test(sha256 || '')
      || typeof sourcePath !== 'string') throw new TypeError('导入附件描述无效');
    const match = ID_PATTERN.exec(id);
    if (!match || MIME_TYPES[type] !== match[3]) throw new TypeError('导入附件 ID 与类型不匹配');
    const sourceStats = fsModule.lstatSync(sourcePath);
    if (sourceStats.isSymbolicLink() || !sourceStats.isFile() || sourceStats.size !== size) {
      throw new TypeError('导入附件暂存文件无效');
    }
    const directory = pathModule.resolve(root, match[1]);
    assertSafeDirectory(directory);
    const destination = pathModule.resolve(directory, id);
    if (!withinRoot(destination)) throw new TypeError('附件路径无效');
    if (fsModule.existsSync(destination)) throw Object.assign(new Error('目标附件 ID 已存在'), { code: 'ATTACHMENT_CONFLICT' });
    const temporary = `${destination}.import-${randomUUID()}`;
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      await pipeline(
        fsModule.createReadStream(sourcePath),
        new Transform({
          transform(chunk, encoding, callback) {
            bytes += chunk.length;
            if (bytes > size || bytes > MAX_ATTACHMENT_BYTES) return callback(new RangeError('附件实际大小超过限制'));
            hash.update(chunk);
            callback(null, chunk);
          }
        }),
        fsModule.createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
      );
      if (bytes !== size || hash.digest('hex') !== sha256) throw new TypeError('导入附件校验失败');
      fsModule.renameSync(temporary, destination);
      return { id, imported: true };
    } catch (error) {
      try { fsModule.unlinkSync(temporary); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
      throw error;
    }
  }

  function remove(id) {
    const { filePath } = fileForId(id);
    if (!withinRoot(pathModule.resolve(filePath))) throw new TypeError('附件路径无效');
    fsModule.unlinkSync(filePath);
    return { id, deleted: true };
  }

  return Object.freeze({ save, read, createReadStream, has, importFile, delete: remove });
}

module.exports = { MAX_ATTACHMENT_BYTES, MIME_TYPES, createSocialAttachmentStore };
