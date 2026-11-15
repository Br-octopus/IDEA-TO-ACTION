const fsDefault = require('node:fs');
const pathDefault = require('node:path');
const cryptoDefault = require('node:crypto');
const yauzlDefault = require('yauzl');

const DEFAULT_LIMITS = Object.freeze({
  maxHtmlBytes: 5 * 1024 * 1024,
  maxImageBytes: 20 * 1024 * 1024,
  maxPdfBytes: 50 * 1024 * 1024,
  maxOfficeBytes: 50 * 1024 * 1024,
  maxOfficeEntries: 2_000,
  maxOfficeEntryBytes: 50 * 1024 * 1024,
  maxOfficeExpandedBytes: 250 * 1024 * 1024,
  maxOfficeCompressionRatio: 200
});

const FORMATS = Object.freeze({
  '.html': { mimeType: 'text/html', kind: 'html' },
  '.htm': { mimeType: 'text/html', kind: 'html' },
  '.png': { mimeType: 'image/png', kind: 'image' },
  '.jpg': { mimeType: 'image/jpeg', kind: 'image' },
  '.jpeg': { mimeType: 'image/jpeg', kind: 'image' },
  '.webp': { mimeType: 'image/webp', kind: 'image' },
  '.pdf': { mimeType: 'application/pdf', kind: 'pdf' },
  '.pptx': { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'pptx' },
  '.docx': { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'docx' }
});

function attachmentSizeLimit(format, limits) {
  if (format.kind === 'html') return limits.maxHtmlBytes;
  if (format.kind === 'pdf') return limits.maxPdfBytes;
  if (format.kind === 'pptx' || format.kind === 'docx') return limits.maxOfficeBytes;
  return limits.maxImageBytes;
}

function validateOfficePackage(content, kind, limits, yauzl = yauzlDefault) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(content, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (error, archive) => {
      if (error) {
        reject(createAttachmentError('INVALID_ATTACHMENT', 'Office 文件不是有效的 ZIP 文档。'));
        return;
      }
      let entryCount = 0;
      let expandedBytes = 0;
      let failed = false;
      const names = new Set();
      const required = new Set(kind === 'pptx'
        ? ['[Content_Types].xml', 'ppt/presentation.xml', 'ppt/slides/slide1.xml']
        : ['[Content_Types].xml', 'word/document.xml']);
      const fail = message => {
        if (failed) return;
        failed = true;
        archive.close();
        reject(createAttachmentError('INVALID_ATTACHMENT', message));
      };
      archive.on('error', () => fail('Office ZIP 结构读取失败。'));
      archive.on('end', () => {
        if (failed) return;
        if (required.size) {
          fail('Office 文件缺少必要的文档结构。');
          return;
        }
        resolve();
      });
      archive.on('entry', entry => {
        const name = entry.fileName;
        entryCount += 1;
        expandedBytes += entry.uncompressedSize;
        const unixMode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (entryCount > limits.maxOfficeEntries || !name || name.startsWith('/') || name.includes('\\')
          || name.split('/').includes('..') || names.has(name) || unixMode === 0o120000
          || /(?:^|\/)vbaProject\.bin$/i.test(name)
          || entry.uncompressedSize > limits.maxOfficeEntryBytes
          || expandedBytes > limits.maxOfficeExpandedBytes
          || entry.uncompressedSize > 0 && entry.uncompressedSize / Math.max(entry.compressedSize, 1) > limits.maxOfficeCompressionRatio) {
          fail('Office 文件超过安全限制或包含不安全 ZIP 条目。');
          return;
        }
        names.add(name);
        required.delete(name);
        archive.readEntry();
      });
      archive.readEntry();
    });
  });
}

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

function matchesPdfSignature(buffer) {
  return buffer.subarray(0, 1024).includes(Buffer.from('%PDF-', 'ascii'));
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
  yauzl = yauzlDefault,
  createId = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
  limits = {}
} = {}) {
  if (!app || typeof app.getPath !== 'function') throw new TypeError('必须提供 Electron app');
  const maxHtmlBytes = Number.isInteger(limits.maxHtmlBytes) ? limits.maxHtmlBytes : DEFAULT_LIMITS.maxHtmlBytes;
  const maxImageBytes = Number.isInteger(limits.maxImageBytes) ? limits.maxImageBytes : DEFAULT_LIMITS.maxImageBytes;
  const maxPdfBytes = Number.isInteger(limits.maxPdfBytes) ? limits.maxPdfBytes : DEFAULT_LIMITS.maxPdfBytes;
  const officeLimits = {
    maxOfficeBytes: Number.isInteger(limits.maxOfficeBytes) ? limits.maxOfficeBytes : DEFAULT_LIMITS.maxOfficeBytes,
    maxOfficeEntries: Number.isInteger(limits.maxOfficeEntries) ? limits.maxOfficeEntries : DEFAULT_LIMITS.maxOfficeEntries,
    maxOfficeEntryBytes: Number.isInteger(limits.maxOfficeEntryBytes) ? limits.maxOfficeEntryBytes : DEFAULT_LIMITS.maxOfficeEntryBytes,
    maxOfficeExpandedBytes: Number.isInteger(limits.maxOfficeExpandedBytes) ? limits.maxOfficeExpandedBytes : DEFAULT_LIMITS.maxOfficeExpandedBytes,
    maxOfficeCompressionRatio: Number.isFinite(limits.maxOfficeCompressionRatio) ? limits.maxOfficeCompressionRatio : DEFAULT_LIMITS.maxOfficeCompressionRatio
  };
  if (maxHtmlBytes < 1 || maxImageBytes < 1 || maxPdfBytes < 1
    || Object.values(officeLimits).some(value => !Number.isFinite(value) || value < 1)) throw new TypeError('附件大小限制必须为正数');

  const userDataPath = path.resolve(app.getPath('userData'));
  const records = new Map();
  let recordsLoaded = false;

  function getRecordPath(record) {
    const target = path.resolve(record.directory, record.fileName);
    const relative = path.relative(userDataPath, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件路径无效。');
    }
    return target;
  }

  function ensureSafeDirectory(directory) {
    const target = path.resolve(directory);
    const relative = path.relative(userDataPath, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw createAttachmentError('ATTACHMENT_MOVE_FAILED', '附件目录无效。');
    }
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw createAttachmentError('ATTACHMENT_MOVE_FAILED', '附件目录无效。');
    return target;
  }

  function loadStoredRecords() {
    if (recordsLoaded) return;
    recordsLoaded = true;
    const root = path.join(userDataPath, 'ppt-feedback');
    const storageRoots = [
      { directory: root, deleted: false },
      { directory: path.join(root, '.trash'), deleted: true }
    ];
    for (const storage of storageRoots) {
      let taskEntries;
      try {
        const rootStat = fs.lstatSync(storage.directory);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) continue;
        taskEntries = fs.readdirSync(storage.directory, { withFileTypes: true });
      } catch { continue; }

      for (const taskEntry of taskEntries) {
        if (!isSafeId(taskEntry.name) || !taskEntry.isDirectory() || taskEntry.isSymbolicLink()) continue;
        const taskDirectory = path.join(storage.directory, taskEntry.name);
        let attachmentEntries;
        try { attachmentEntries = fs.readdirSync(taskDirectory, { withFileTypes: true }); } catch { continue; }
        for (const attachmentEntry of attachmentEntries) {
          if (!isSafeId(attachmentEntry.name) || !attachmentEntry.isDirectory() || attachmentEntry.isSymbolicLink()) continue;
          const directory = path.join(taskDirectory, attachmentEntry.name);
          let files;
          try { files = fs.readdirSync(directory); } catch { continue; }
          const fileName = files.find(name => {
            const extension = path.extname(name).toLowerCase();
            return name === `attachment${extension}` && Object.hasOwn(FORMATS, extension);
          });
          if (!fileName) continue;
          const format = FORMATS[path.extname(fileName).toLowerCase()];
          const filePath = path.join(directory, fileName);
          try {
            const fileStat = fs.lstatSync(filePath);
            if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
            const realPath = fs.realpathSync(filePath);
            const relativePath = path.relative(userDataPath, realPath);
            if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) continue;
            const content = fs.readFileSync(realPath);
            if (content.length > attachmentSizeLimit(format, { maxHtmlBytes, maxImageBytes, maxPdfBytes, ...officeLimits })) continue;
            if (format.kind === 'image' && !matchesImageSignature(content, path.extname(fileName).toLowerCase())) continue;
            if ((format.kind === 'pptx' || format.kind === 'docx') && content.subarray(0, 2).toString('hex') !== '504b') continue;
            const sha256 = crypto.createHash('sha256').update(content).digest('hex');
            const metadataPath = path.join(directory, 'metadata.json');
            let manifest;
            try { manifest = JSON.parse(fs.readFileSync(metadataPath, 'utf8')); } catch {}
            if (manifest && (manifest.id !== attachmentEntry.name || manifest.taskId !== taskEntry.name
              || manifest.sha256 !== sha256 || manifest.size !== content.length || manifest.version !== sha256
              || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)))) continue;
            const metadata = Object.freeze({
              id: attachmentEntry.name,
              taskId: taskEntry.name,
              kind: format.kind,
              mimeType: format.mimeType,
              displayName: typeof manifest?.displayName === 'string' ? manifest.displayName.slice(0, 180) : `资料${path.extname(fileName).toLowerCase()}`,
              size: content.length,
              sha256,
              version: sha256,
              createdAt: manifest?.createdAt || fileStat.mtime.toISOString()
            });
            if (!records.has(metadata.id)) records.set(metadata.id, { metadata, directory, fileName, taskId: taskEntry.name, deleted: storage.deleted });
          } catch {}
        }
      }
    }
  }

  async function saveAttachment({ taskId, sourcePath, mimeType, displayName: requestedDisplayName } = {}) {
    if (!isSafeId(taskId)) throw createAttachmentError('INVALID_TASK_ID', '任务标识无效。');
    if (typeof sourcePath !== 'string' || !sourcePath) throw createAttachmentError('INVALID_ATTACHMENT', '附件来源路径无效。');
    loadStoredRecords();

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
    const formatLimits = { maxHtmlBytes, maxImageBytes, maxPdfBytes, ...officeLimits };
    const sizeLimit = attachmentSizeLimit(format, formatLimits);
    if (stat.size > sizeLimit) throw createAttachmentError('FILE_TOO_LARGE', '附件超过大小限制。');

    let content;
    try { content = fs.readFileSync(resolvedSource); }
    catch { throw createAttachmentError('INVALID_ATTACHMENT', '附件来源不可读取。'); }
    if (content.length > sizeLimit) throw createAttachmentError('FILE_TOO_LARGE', '附件超过大小限制。');
    if (format.kind === 'image' && !matchesImageSignature(content, extension)) {
      throw createAttachmentError('INVALID_ATTACHMENT', '图片内容与声明的格式不匹配。');
    }
    if (format.kind === 'pdf' && !matchesPdfSignature(content)) {
      throw createAttachmentError('INVALID_ATTACHMENT', '文件内容与 PDF 格式不匹配。');
    }
    if (format.kind === 'pptx' || format.kind === 'docx') await validateOfficePackage(content, format.kind, officeLimits, yauzl);

    const id = String(createId());
    if (!isSafeId(id) || records.has(id)) throw createAttachmentError('ATTACHMENT_SAVE_FAILED', '无法生成安全的附件标识。');
    const taskDirectory = path.join(userDataPath, 'ppt-feedback', taskId);
    const directory = path.join(taskDirectory, id);
    const fileName = `attachment${extension}`;
    const targetPath = path.join(directory, fileName);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const createdAt = now();
    const displayName = path.basename(String(requestedDisplayName || resolvedSource))
      .replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || `资料${extension}`;
    let createdDirectory = false;

    try {
      const storageRoot = path.join(userDataPath, 'ppt-feedback');
      fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
      const rootStat = fs.lstatSync(storageRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Attachment root is not a real directory');
      try { fs.mkdirSync(taskDirectory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const taskStat = fs.lstatSync(taskDirectory);
      if (!taskStat.isDirectory() || taskStat.isSymbolicLink()) throw new Error('Task directory is not a real directory');
      fs.mkdirSync(directory, { mode: 0o700 });
      createdDirectory = true;
      fs.writeFileSync(targetPath, content, { flag: 'wx', mode: 0o600 });
      if (typeof fs.chmodSync === 'function') fs.chmodSync(targetPath, 0o400);
      const metadata = { id, taskId, displayName, size: content.length, sha256, version: sha256, createdAt };
      const metadataPath = path.join(directory, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata), { flag: 'wx', mode: 0o600 });
      if (typeof fs.chmodSync === 'function') fs.chmodSync(metadataPath, 0o400);
    } catch {
      if (createdDirectory) try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
      throw createAttachmentError('ATTACHMENT_SAVE_FAILED', '附件副本保存失败；原文件未修改。');
    }

    const metadata = Object.freeze({
      id,
      taskId,
      kind: format.kind,
      mimeType: format.mimeType,
      displayName,
      size: content.length,
      sha256,
      version: sha256,
      createdAt
    });
    records.set(id, { metadata, directory, fileName, taskId, deleted: false });
    return { ...metadata };
  }

  async function saveHtmlSnapshot({ taskId, title, sourceUrl, fetchedAt, sourceContentHash, html, text, incomplete = false } = {}) {
    if (!isSafeId(taskId) || typeof title !== 'string' || !title.trim() || title.length > 240
      || typeof text !== 'string' || !text.trim() || text.length > 20_000
      || typeof html !== 'string' || !html.trim() || Buffer.byteLength(html, 'utf8') > 1_048_576
      || typeof fetchedAt !== 'string' || fetchedAt.length > 80 || !Number.isFinite(Date.parse(fetchedAt))
      || typeof sourceContentHash !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(sourceContentHash)
      || typeof incomplete !== 'boolean') {
      throw createAttachmentError('INVALID_ATTACHMENT', '网页快照信息无效。');
    }
    let url;
    try {
      url = new URL(sourceUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid URL');
      url.search = '';
      url.hash = '';
    } catch {
      throw createAttachmentError('INVALID_ATTACHMENT', '网页来源网址无效。');
    }
    const sourceBytes = Buffer.from(html, 'utf8');
    const actualSourceHash = `sha256:${crypto.createHash('sha256').update(sourceBytes).digest('hex')}`;
    if (actualSourceHash.toLowerCase() !== sourceContentHash.toLowerCase()) {
      throw createAttachmentError('CHECKSUM_MISMATCH', '网页内容版本与快照 HTML 不匹配。');
    }
    const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
    const source = { url: url.href, fetchedAt, contentHash: sourceContentHash, incomplete };
    const sourceData = Buffer.from(JSON.stringify(source)).toString('base64');
    const storedHtml = `<!--forward-step-source:${sourceData}-->\n${html}`;
    fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
    const temporaryDirectory = fs.mkdtempSync(path.join(userDataPath, '.web-snapshot-'));
    try {
      const sourcePath = path.join(temporaryDirectory, 'snapshot.html');
      fs.writeFileSync(sourcePath, storedHtml, { flag: 'wx', mode: 0o600 });
      const displayName = `${title.trim().slice(0, 120)} · ${fetchedAt.slice(0, 10)} · ${sourceContentHash.slice(-8)}.html`;
      return await saveAttachment({ taskId, sourcePath, mimeType: 'text/html', displayName });
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  function getAttachment(attachmentId) {
    if (!isSafeId(attachmentId)) throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件不存在或标识无效。');
    loadStoredRecords();
    if (!records.has(attachmentId) || records.get(attachmentId).deleted) {
      throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件不存在或标识无效。');
    }
    return { ...records.get(attachmentId).metadata };
  }

  function getAttachmentPath(attachmentId, { includeDeleted = false } = {}) {
    if (!isSafeId(attachmentId)) throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件不存在或标识无效。');
    loadStoredRecords();
    const record = records.get(attachmentId);
    if (!record || record.deleted && !includeDeleted) {
      throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件不存在或标识无效。');
    }
    return getRecordPath(record);
  }

  function createReadStream(attachmentId, { includeDeleted = false } = {}) {
    if (!isSafeId(attachmentId)) throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件不存在或标识无效。');
    loadStoredRecords();
    const record = records.get(attachmentId);
    if (!record || record.deleted && !includeDeleted) {
      throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件不存在或标识无效。');
    }
    const filePath = getAttachmentPath(attachmentId, { includeDeleted });
    try {
      const directoryStat = fs.lstatSync(record.directory);
      const fileStat = fs.lstatSync(filePath);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || !fileStat.isFile() || fileStat.isSymbolicLink()) {
        throw new Error('Attachment path is not a regular file');
      }
      const realPath = fs.realpathSync(filePath);
      const relativePath = path.relative(fs.realpathSync(record.directory), realPath);
      if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error('Attachment path escapes its directory');
      }
      return fs.createReadStream(realPath);
    } catch (error) {
      if (error?.code === 'INVALID_ATTACHMENT_ID') throw error;
      throw createAttachmentError('ATTACHMENT_READ_FAILED', '资料读取失败；原文件和已有批注仍保留。');
    }
  }

  async function importAttachment({ taskId, id, mimeType, displayName, size, sha256, sourcePath, createdAt, deleted = false } = {}) {
    if (!isSafeId(taskId) || !isSafeId(id)) throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件或任务标识无效。');
    if (typeof sourcePath !== 'string' || !sourcePath || !Number.isSafeInteger(size) || size < 1
      || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || typeof deleted !== 'boolean') {
      throw createAttachmentError('INVALID_ATTACHMENT', '导入附件描述无效。');
    }
    if (createdAt !== undefined && (typeof createdAt !== 'string' || createdAt.length > 80)) {
      throw createAttachmentError('INVALID_ATTACHMENT', '导入附件时间无效。');
    }
    const formatEntry = Object.entries(FORMATS).find(([, format]) => format.mimeType === mimeType);
    if (!formatEntry) throw createAttachmentError('INVALID_ATTACHMENT', '导入附件类型不受支持。');
    const [extension, format] = formatEntry;
    const formatLimits = { maxHtmlBytes, maxImageBytes, maxPdfBytes, ...officeLimits };
    const sizeLimit = attachmentSizeLimit(format, formatLimits);
    if (size > sizeLimit) throw createAttachmentError('FILE_TOO_LARGE', '附件超过大小限制。');
    loadStoredRecords();
    const existing = records.get(id);
    if (existing) {
      const matches = existing.taskId === taskId && existing.deleted === deleted
        && existing.metadata.mimeType === mimeType && existing.metadata.size === size && existing.metadata.sha256 === sha256;
      if (!matches) throw createAttachmentError('ATTACHMENT_CONFLICT', '目标附件标识已用于其他资料。');
      const current = fs.readFileSync(getRecordPath(existing));
      if (current.length !== size || crypto.createHash('sha256').update(current).digest('hex') !== sha256) {
        throw createAttachmentError('ATTACHMENT_VERSION_MISMATCH', '目标附件内容与備份版本不一致。');
      }
      return { ...existing.metadata, imported: false };
    }

    let sourceStat;
    let content;
    try {
      sourceStat = fs.lstatSync(sourcePath);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size !== size) throw new Error('Invalid staged file');
      content = fs.readFileSync(sourcePath);
    } catch {
      throw createAttachmentError('INVALID_ATTACHMENT', '附件暂存文件不可读取。');
    }
    if (content.length !== size || crypto.createHash('sha256').update(content).digest('hex') !== sha256) {
      throw createAttachmentError('CHECKSUM_MISMATCH', '附件暂存文件校验失败。');
    }
    if (format.kind === 'image' && !matchesImageSignature(content, extension)
      || format.kind === 'pdf' && !matchesPdfSignature(content)) {
      throw createAttachmentError('INVALID_ATTACHMENT', '附件内容与声明格式不匹配。');
    }
    if (format.kind === 'pptx' || format.kind === 'docx') await validateOfficePackage(content, format.kind, officeLimits, yauzl);

    const storageRoot = ensureSafeDirectory(path.join(userDataPath, 'ppt-feedback'));
    const taskRoot = deleted
      ? ensureSafeDirectory(path.join(ensureSafeDirectory(path.join(storageRoot, '.trash')), taskId))
      : ensureSafeDirectory(path.join(storageRoot, taskId));
    const directory = path.join(taskRoot, id);
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (error) {
      if (error?.code === 'EEXIST') throw createAttachmentError('ATTACHMENT_CONFLICT', '目标附件目录已存在。');
      throw createAttachmentError('ATTACHMENT_SAVE_FAILED', '附件导入目录创建失败。');
    }
    const fileName = `attachment${extension}`;
    const filePath = path.join(directory, fileName);
    const cleanDisplayName = path.basename(String(displayName || `资料${extension}`))
      .replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || `资料${extension}`;
    const metadata = {
      id, taskId, displayName: cleanDisplayName, size, sha256, version: sha256,
      createdAt: createdAt || now(), mimeType, kind: format.kind
    };
    try {
      fs.writeFileSync(filePath, content, { flag: 'wx', mode: 0o600 });
      if (typeof fs.chmodSync === 'function') fs.chmodSync(filePath, 0o400);
      const metadataPath = path.join(directory, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata), { flag: 'wx', mode: 0o600 });
      if (typeof fs.chmodSync === 'function') fs.chmodSync(metadataPath, 0o400);
    } catch {
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
      throw createAttachmentError('ATTACHMENT_SAVE_FAILED', '附件副本导入失败。');
    }
    const stored = Object.freeze({ ...metadata });
    records.set(id, { metadata: stored, directory, fileName, taskId, deleted });
    return { ...stored, imported: true };
  }

  function removeImportedAttachment(attachmentId) {
    if (!isSafeId(attachmentId)) throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件标识无效。');
    loadStoredRecords();
    const record = records.get(attachmentId);
    if (!record) return false;
    const directoryStat = fs.lstatSync(record.directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw createAttachmentError('ATTACHMENT_MOVE_FAILED', '导入附件目录无效。');
    }
    fs.rmSync(record.directory, { recursive: true, force: true });
    records.delete(attachmentId);
    return true;
  }

  function readPreviewDataUrl(attachmentId, expectedKind) {
    const metadata = getAttachment(attachmentId);
    if (metadata.kind !== expectedKind) throw createAttachmentError('UNSUPPORTED_PREVIEW', '附件类型与预览请求不匹配。');
    const record = records.get(attachmentId);
    const filePath = getRecordPath(record);
    try {
      const directoryStat = fs.lstatSync(record.directory);
      const fileStat = fs.lstatSync(filePath);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || !fileStat.isFile() || fileStat.isSymbolicLink()) {
        throw new Error('Attachment path is not a regular file');
      }
      const realPath = fs.realpathSync(filePath);
      const relativePath = path.relative(fs.realpathSync(record.directory), realPath);
      if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error('Attachment path escapes its directory');
      }
      const content = fs.readFileSync(realPath);
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      if (content.length !== metadata.size || sha256 !== metadata.sha256) {
        throw createAttachmentError('ATTACHMENT_VERSION_MISMATCH', '资料内容已变化，请重新添加后再查看。');
      }
      return `data:${metadata.mimeType};base64,${content.toString('base64')}`;
    } catch (error) {
      if (error?.code === 'ATTACHMENT_VERSION_MISMATCH') throw error;
      throw createAttachmentError('ATTACHMENT_READ_FAILED', '资料读取失败；原文件和已有批注仍保留。');
    }
  }

  function readImageDataUrl(attachmentId) { return readPreviewDataUrl(attachmentId, 'image'); }
  function readPdfDataUrl(attachmentId) { return readPreviewDataUrl(attachmentId, 'pdf'); }

  function readOfficeBuffer(attachmentId, expectedHash) {
    const metadata = getAttachment(attachmentId);
    if (!['pptx', 'docx'].includes(metadata.kind)) throw createAttachmentError('UNSUPPORTED_PREVIEW', '附件类型与 Office 预览请求不匹配。');
    if (typeof expectedHash !== 'string' || expectedHash !== metadata.sha256) {
      throw createAttachmentError('ATTACHMENT_VERSION_MISMATCH', 'Office 资料版本已变化，请刷新资料后重试。');
    }
    const content = fs.readFileSync(getRecordPath(records.get(attachmentId)));
    if (content.length !== metadata.size || crypto.createHash('sha256').update(content).digest('hex') !== metadata.sha256) {
      throw createAttachmentError('ATTACHMENT_VERSION_MISMATCH', 'Office 资料内容与已保存版本不一致。');
    }
    return content;
  }

  function listAttachments(taskId) {
    if (!isSafeId(taskId)) throw createAttachmentError('INVALID_TASK_ID', '任务标识无效。');
    loadStoredRecords();
    return [...records.values()]
      .filter(record => record.taskId === taskId && !record.deleted)
      .map(record => ({ ...record.metadata }));
  }

  function listDeletedAttachments(taskId) {
    if (!isSafeId(taskId)) throw createAttachmentError('INVALID_TASK_ID', '任务标识无效。');
    loadStoredRecords();
    return [...records.values()]
      .filter(record => record.taskId === taskId && record.deleted)
      .map(record => ({ ...record.metadata }));
  }

  function listBackupAttachments(taskId) {
    if (taskId !== undefined && !isSafeId(taskId)) throw createAttachmentError('INVALID_TASK_ID', '任务标识无效。');
    loadStoredRecords();
    return [...records.values()]
      .filter(record => taskId === undefined || record.taskId === taskId)
      .map(record => ({ ...record.metadata, deleted: record.deleted }));
  }

  function deleteAttachment(attachmentId) {
    if (!isSafeId(attachmentId)) throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件不存在或标识无效。');
    loadStoredRecords();
    const record = records.get(attachmentId);
    if (!record || record.deleted) throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件不存在或标识无效。');
    const sourceStat = fs.lstatSync(record.directory);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw createAttachmentError('ATTACHMENT_MOVE_FAILED', '附件目录无效。');
    const root = ensureSafeDirectory(path.join(userDataPath, 'ppt-feedback'));
    const trashRoot = ensureSafeDirectory(path.join(root, '.trash'));
    const trashTaskDirectory = ensureSafeDirectory(path.join(trashRoot, record.taskId));
    const targetDirectory = path.join(trashTaskDirectory, attachmentId);
    try { fs.lstatSync(targetDirectory); throw createAttachmentError('ATTACHMENT_MOVE_FAILED', '恢复区中已存在同一附件。'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    try { fs.renameSync(record.directory, targetDirectory); }
    catch { throw createAttachmentError('ATTACHMENT_MOVE_FAILED', '资料未移除；原文件与批注均保留。'); }
    record.directory = targetDirectory;
    record.deleted = true;
    return { ...record.metadata };
  }

  function restoreAttachment(attachmentId) {
    if (!isSafeId(attachmentId)) throw createAttachmentError('INVALID_ATTACHMENT_ID', '附件不存在或标识无效。');
    loadStoredRecords();
    const record = records.get(attachmentId);
    if (!record || !record.deleted) throw createAttachmentError('INVALID_ATTACHMENT_ID', '已移除附件不存在或标识无效。');
    const root = ensureSafeDirectory(path.join(userDataPath, 'ppt-feedback'));
    const taskDirectory = ensureSafeDirectory(path.join(root, record.taskId));
    const targetDirectory = path.join(taskDirectory, attachmentId);
    try { fs.lstatSync(targetDirectory); throw createAttachmentError('ATTACHMENT_MOVE_FAILED', '当前任务中已存在同一附件。'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const sourceStat = fs.lstatSync(record.directory);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw createAttachmentError('ATTACHMENT_MOVE_FAILED', '已移除附件目录无效。');
    try { fs.renameSync(record.directory, targetDirectory); }
    catch { throw createAttachmentError('ATTACHMENT_MOVE_FAILED', '资料未恢复；恢复记录仍保留。'); }
    record.directory = targetDirectory;
    record.deleted = false;
    return { ...record.metadata };
  }

  return Object.freeze({ saveAttachment, saveHtmlSnapshot, importAttachment, removeImportedAttachment, getAttachment, getAttachmentPath, createReadStream, readImageDataUrl, readPdfDataUrl, readOfficeBuffer, listAttachments, listDeletedAttachments, listBackupAttachments, deleteAttachment, restoreAttachment });
}

module.exports = { createPptFeedbackAttachmentStore };
