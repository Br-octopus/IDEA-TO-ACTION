const fsDefault = require('node:fs');
const pathDefault = require('node:path');
const cryptoDefault = require('node:crypto');

const DEFAULT_LIMITS = Object.freeze({
  maxHtmlBytes: 5 * 1024 * 1024,
  maxImageBytes: 20 * 1024 * 1024
});

const FORMATS = Object.freeze({
  '.html': { mimeType: 'text/html', kind: 'html' },
  '.htm': { mimeType: 'text/html', kind: 'html' },
  '.png': { mimeType: 'image/png', kind: 'image' },
  '.jpg': { mimeType: 'image/jpeg', kind: 'image' },
  '.jpeg': { mimeType: 'image/jpeg', kind: 'image' },
  '.webp': { mimeType: 'image/webp', kind: 'image' }
});

function createAttachmentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isSafeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function matchesImageSignature(buffer, extension) {
  if (extension === '.png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === '.webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function hasMisleadingDoubleExtension(pathModule, filePath) {
  const baseName = pathModule.basename(filePath).toLowerCase();
  return /\.(?:html?|png|jpe?g|webp)\.(?:html?|png|jpe?g|webp)$/.test(baseName);
}

function createPptFeedbackAttachmentStore({
  app,
  fs = fsDefault,
  path = pathDefault,
  crypto = cryptoDefault,
  createId = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
  limits = {}
} = {}) {
  if (!app || typeof app.getPath !== 'function') throw new TypeError('必须提供 Electron app');
  const maxHtmlBytes = Number.isInteger(limits.maxHtmlBytes) ? limits.maxHtmlBytes : DEFAULT_LIMITS.maxHtmlBytes;
  const maxImageBytes = Number.isInteger(limits.maxImageBytes) ? limits.maxImageBytes : DEFAULT_LIMITS.maxImageBytes;
  if (maxHtmlBytes < 1 || maxImageBytes < 1) throw new TypeError('附件大小限制必须为正整数');

  const userDataPath = path.resolve(app.getPath('userData'));
  const records = new Map();

  function getRecordPath(record) {
    const target = path.resolve(record.directory, record.fileName);
    const relative = path.relative(userDataPath, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件路径无效。');
    }
    return target;
  }

  async function saveAttachment({ taskId, sourcePath, mimeType } = {}) {
    if (!isSafeId(taskId)) throw createAttachmentError('INVALID_TASK_ID', '任务标识无效。');
    if (typeof sourcePath !== 'string' || !sourcePath) throw createAttachmentError('INVALID_ATTACHMENT', '附件来源路径无效。');

    let resolvedSource;
    let stat;
    try {
      resolvedSource = fs.realpathSync(sourcePath);
      stat = fs.statSync(resolvedSource);
    } catch {
      throw createAttachmentError('INVALID_ATTACHMENT', '附件来源不可读取。');
    }
    if (!stat.isFile()) throw createAttachmentError('INVALID_ATTACHMENT', '附件来源必须是普通文件。');

    const extension = path.extname(resolvedSource).toLowerCase();
    const format = FORMATS[extension];
    if (!format || format.mimeType !== mimeType || hasMisleadingDoubleExtension(path, resolvedSource)) {
      throw createAttachmentError('INVALID_ATTACHMENT', '附件 MIME 类型与扩展名不匹配或不受支持。');
    }
    const sizeLimit = format.kind === 'html' ? maxHtmlBytes : maxImageBytes;
    if (stat.size > sizeLimit) throw createAttachmentError('FILE_TOO_LARGE', '附件超过大小限制。');

    let content;
    try { content = fs.readFileSync(resolvedSource); }
    catch { throw createAttachmentError('INVALID_ATTACHMENT', '附件来源不可读取。'); }
    if (content.length > sizeLimit) throw createAttachmentError('FILE_TOO_LARGE', '附件超过大小限制。');
    if (format.kind === 'image' && !matchesImageSignature(content, extension)) {
      throw createAttachmentError('INVALID_ATTACHMENT', '图片内容与声明的格式不匹配。');
    }

    const id = String(createId());
    if (!isSafeId(id) || records.has(id)) throw createAttachmentError('ATTACHMENT_SAVE_FAILED', '无法生成安全的附件标识。');
    const directory = path.join(userDataPath, 'ppt-feedback', taskId, id);
    const fileName = `attachment${extension}`;
    const targetPath = path.join(directory, fileName);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');

    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(targetPath, content, { flag: 'wx', mode: 0o600 });
      if (typeof fs.chmodSync === 'function') fs.chmodSync(targetPath, 0o400);
    } catch {
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
      throw createAttachmentError('ATTACHMENT_SAVE_FAILED', '附件副本保存失败；原文件未修改。');
    }

    const metadata = Object.freeze({
      id,
      kind: format.kind,
      mimeType: format.mimeType,
      size: content.length,
      sha256,
      version: sha256,
      createdAt: now()
    });
    records.set(id, { metadata, directory, fileName, taskId });
    return { ...metadata };
  }

  function getAttachment(attachmentId) {
    if (!isSafeId(attachmentId) || !records.has(attachmentId)) {
      throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件不存在或标识无效。');
    }
    return { ...records.get(attachmentId).metadata };
  }

  function getAttachmentPath(attachmentId) {
    if (!isSafeId(attachmentId) || !records.has(attachmentId)) {
      throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件不存在或标识无效。');
    }
    return getRecordPath(records.get(attachmentId));
  }

  function listAttachments(taskId) {
    if (!isSafeId(taskId)) throw createAttachmentError('INVALID_TASK_ID', '任务标识无效。');
    return [...records.values()]
      .filter(record => record.taskId === taskId)
      .map(record => ({ ...record.metadata }));
  }

  return Object.freeze({ saveAttachment, getAttachment, getAttachmentPath, listAttachments });
}

module.exports = { createPptFeedbackAttachmentStore };
