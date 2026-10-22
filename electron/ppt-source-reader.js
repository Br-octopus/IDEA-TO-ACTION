const fsDefault = require('node:fs');
const pathDefault = require('node:path');
const crypto = require('node:crypto');

const CHANNELS = Object.freeze({
  selectFile: 'ppt-source:select-file',
  selectDirectory: 'ppt-source:select-directory',
  listDirectory: 'ppt-source:list-directory',
  read: 'ppt-source:read',
  cancel: 'ppt-source:cancel'
});

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rst', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml',
  '.html', '.htm', '.css', '.js', '.ts', '.jsx', '.tsx'
]);
const UNSUPPORTED_EXTENSIONS = new Set(['.pdf', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov', '.avi', '.mkv', '.webm']);
const SENSITIVE_DIRECTORY_NAMES = new Set(['.git', 'node_modules', 'build', 'release', 'dist', 'out', 'coverage']);
const SENSITIVE_FILE_NAMES = new Set(['id_rsa', 'id_dsa', 'credentials', 'credentials.json', 'secrets', 'secrets.json', 'token', 'token.json']);
const DEFAULT_LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxPages: 100 });

function createReaderError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createReaderError('INVALID_REQUEST', message);
}

function assertAbort(signal) {
  if (signal?.aborted) throw createReaderError('CANCELED', '读取已取消。');
}

function normalizeExtension(pathModule, filePath) {
  return pathModule.extname(filePath).toLowerCase();
}

function isSensitiveName(pathModule, filePath) {
  const parts = filePath.split(/[\\/]+/).filter(Boolean).map(part => part.toLowerCase());
  if (parts.some(part => SENSITIVE_DIRECTORY_NAMES.has(part))) return true;
  const name = parts.at(-1) || '';
  return name === '.env'
    || name.startsWith('.env.')
    || SENSITIVE_FILE_NAMES.has(name)
    || /\.(pem|key|p12|pfx|crt|cer)$/i.test(name);
}

function isSupportedText(pathModule, filePath) {
  return TEXT_EXTENSIONS.has(normalizeExtension(pathModule, filePath));
}

function isKnownUnsupported(pathModule, filePath) {
  return UNSUPPORTED_EXTENSIONS.has(normalizeExtension(pathModule, filePath));
}

function isPathInside(pathModule, root, target) {
  const relative = pathModule.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${pathModule.sep}`) && !pathModule.isAbsolute(relative));
}

function cleanHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function getHtmlTitle(html, fallback) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanHtml(match[1]).slice(0, 200) || fallback : fallback;
}

function createPptSourceReader({
  fs = fsDefault,
  path = pathDefault,
  dialog,
  ipcMain,
  createId = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
  limits = {}
} = {}) {
  if (!fs || !path) throw new TypeError('必须提供 fs 和 path');
  const sourceLimits = {
    maxBytes: Number.isInteger(limits.maxBytes) ? limits.maxBytes : DEFAULT_LIMITS.maxBytes,
    maxPages: Number.isInteger(limits.maxPages) ? limits.maxPages : DEFAULT_LIMITS.maxPages
  };
  if (sourceLimits.maxBytes < 1 || sourceLimits.maxPages < 1) throw new TypeError('读取限制必须为正整数');

  const sources = new Map();
  const activeRequests = new Map();

  function registerSource(kind, filePath) {
    const realPath = fs.realpathSync(filePath);
    if (isSensitiveName(path, realPath)) throw createReaderError('INVALID_SOURCE', '凭证或受保护路径不允许读取。');
    const stat = fs.statSync(realPath);
    if (kind === 'local-file' && !stat.isFile()) throw createReaderError('INVALID_SOURCE', '所选来源不是文件。');
    if (kind === 'local-directory' && !stat.isDirectory()) throw createReaderError('INVALID_SOURCE', '所选来源不是目录。');
    const sourceId = String(createId());
    const source = {
      sourceId,
      kind,
      root: kind === 'local-directory' ? realPath : null,
      path: kind === 'local-file' ? realPath : null,
      title: path.basename(realPath) || '本地来源',
      extension: normalizeExtension(path, realPath),
      size: stat.isFile() ? stat.size : null
    };
    sources.set(sourceId, source);
    return {
      sourceId,
      kind,
      title: source.title,
      extension: source.extension || null,
      size: source.size
    };
  }

  function getSource(sourceId) {
    if (typeof sourceId !== 'string' || !sourceId || !sources.has(sourceId)) {
      throw createReaderError('INVALID_SOURCE', '来源未选择或已失效。');
    }
    return sources.get(sourceId);
  }

  function validateRelativePath(root, relativePath) {
    if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
      throw createReaderError('INVALID_SOURCE', '只能读取授权目录内的相对路径。');
    }
    const normalized = path.normalize(relativePath);
    if (normalized === '..' || normalized.startsWith(`..${path.sep}`) || isSensitiveName(path, normalized)) {
      throw createReaderError('INVALID_SOURCE', '来源路径不在允许范围内。');
    }
    const candidate = path.resolve(root, normalized);
    if (!isPathInside(path, root, candidate)) throw createReaderError('INVALID_SOURCE', '来源路径不在允许范围内。');
    let realPath;
    try { realPath = fs.realpathSync(candidate); }
    catch { throw createReaderError('INVALID_SOURCE', '来源路径不可用。'); }
    if (!isPathInside(path, root, realPath) || isSensitiveName(path, path.relative(root, realPath))) {
      throw createReaderError('INVALID_SOURCE', '来源路径不在允许范围内。');
    }
    return realPath;
  }

  function resolveSourcePath(source, request) {
    assertObject(request, '来源读取请求无效。');
    if (source.kind === 'local-file') {
      if (request.relativePath !== undefined || request.path !== undefined) {
        throw createReaderError('INVALID_SOURCE', '文件来源不接受路径参数。');
      }
      return source.path;
    }
    if (request.path !== undefined) throw createReaderError('INVALID_SOURCE', '只能使用授权目录内的相对路径。');
    return validateRelativePath(source.root, request.relativePath);
  }

  function assertFileAllowed(filePath) {
    if (isSensitiveName(path, filePath)) throw createReaderError('INVALID_SOURCE', '凭证或受保护路径不允许读取。');
    const extension = normalizeExtension(path, filePath);
    if (!isSupportedText(path, filePath) && !isKnownUnsupported(path, filePath)) {
      throw createReaderError('UNSUPPORTED_EXTENSION', '不支持该文件扩展名。');
    }
    return extension;
  }

  function readBuffer(filePath, signal) {
    assertAbort(signal);
    let stat;
    try { stat = fs.statSync(filePath); }
    catch (cause) { throw createReaderError('SOURCE_READ_FAILED', '来源文件无法读取。'); }
    if (!stat.isFile()) throw createReaderError('INVALID_SOURCE', '来源不是文件。');
    if (stat.size > sourceLimits.maxBytes) throw createReaderError('FILE_TOO_LARGE', '来源文件超过大小限制。');
    assertAbort(signal);
    let bytes;
    try { bytes = fs.readFileSync(filePath); }
    catch { throw createReaderError('SOURCE_READ_FAILED', '来源文件无法读取。'); }
    assertAbort(signal);
    if (bytes.includes(0)) throw createReaderError('BINARY_FILE', '二进制文件不允许按文本读取。');
    return bytes;
  }

  function unsupportedResult(sourceId, filePath, purpose, extension) {
    return {
      sourceId,
      kind: 'local-file',
      purpose: purpose || 'content',
      status: 'unsupported',
      title: path.basename(filePath),
      excerpt: '',
      location: { relativePath: path.basename(filePath), extension },
      retrievedAt: now(),
      verificationStatus: 'unverified',
      license: 'unknown',
      limitations: '当前未配置该格式解析器。请粘贴文本，或上传可解析副本。',
      processedRange: { pages: 0, start: null, end: null },
      unprocessedRange: { reason: 'parser-unavailable' },
      errorCode: 'PARSER_UNAVAILABLE'
    };
  }

  function validatePageRange(pageRange) {
    if (pageRange === undefined) return { start: 1, end: 1 };
    assertObject(pageRange, '页范围无效。');
    const start = pageRange.start;
    const end = pageRange.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > sourceLimits.maxPages) {
      throw createReaderError('PAGE_RANGE_EXCEEDED', '请求页范围超过限制。');
    }
    if (start !== 1 || end !== 1) throw createReaderError('PAGE_RANGE_EXCEEDED', '文本和 HTML 来源目前只有第 1 页可读取。');
    return { start, end };
  }

  async function readPptSource({ source, purpose = 'content', pageRange, signal } = {}) {
    assertObject(source, '来源无效。');
    const sourceId = typeof source.sourceId === 'string' ? source.sourceId : null;
    const sourceRecord = sourceId ? getSource(sourceId) : source;
    const filePath = sourceId ? resolveSourcePath(sourceRecord, { relativePath: source.relativePath, path: source.path }) : source.path;
    if (typeof filePath !== 'string' || !filePath) throw createReaderError('INVALID_SOURCE', '来源路径无效。');
    assertAbort(signal);
    const extension = assertFileAllowed(filePath);
    const resultSourceId = sourceId || String(source.sourceId || createId());
    if (isKnownUnsupported(path, filePath)) return unsupportedResult(resultSourceId, filePath, purpose, extension);
    const page = validatePageRange(pageRange);
    const bytes = readBuffer(filePath, signal);
    const raw = bytes.toString('utf8');
    const content = extension === '.html' || extension === '.htm' ? cleanHtml(raw) : raw;
    const title = extension === '.html' || extension === '.htm' ? getHtmlTitle(raw, path.basename(filePath)) : path.basename(filePath);
    return {
      sourceId: resultSourceId,
      kind: sourceRecord.kind || 'local-file',
      purpose,
      status: 'complete',
      title,
      excerpt: content.slice(0, 2000),
      content,
      location: { relativePath: sourceRecord.root ? path.relative(sourceRecord.root, filePath).split(path.sep).join('/') : path.basename(filePath), extension },
      retrievedAt: now(),
      verificationStatus: 'unverified',
      license: 'unknown',
      limitations: '',
      processedRange: { pages: 1, start: page.start, end: page.end },
      unprocessedRange: null,
      errorCode: null
    };
  }

  function listDirectory(source) {
    const files = [];
    const skipped = [];
    function visit(directory) {
      let entries;
      try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
      catch { skipped.push({ relativePath: path.relative(source.root, directory), reason: 'read-failed' }); return; }
      for (const entry of entries) {
        const relativePath = path.relative(source.root, path.join(directory, entry.name)).split(path.sep).join('/');
        const candidate = path.join(directory, entry.name);
        if (isSensitiveName(path, relativePath)) {
          skipped.push({ relativePath, reason: 'sensitive-path' });
          continue;
        }
        if (entry.isDirectory()) {
          visit(candidate);
          continue;
        }
        if (!entry.isFile()) {
          skipped.push({ relativePath, reason: 'unsupported-entry' });
          continue;
        }
        const extension = normalizeExtension(path, candidate);
        if (!isSupportedText(path, candidate)) {
          skipped.push({ relativePath, reason: isKnownUnsupported(path, candidate) ? 'unsupported-parser' : 'unsupported-extension' });
          continue;
        }
        try {
          const stat = fs.statSync(candidate);
          if (stat.size > sourceLimits.maxBytes) {
            skipped.push({ relativePath, reason: 'file-too-large' });
            continue;
          }
          readBuffer(candidate);
          files.push({ sourceId: source.sourceId, kind: 'local-file', relativePath, title: path.basename(candidate), extension, size: stat.size });
        } catch (error) {
          skipped.push({ relativePath, reason: error.code === 'BINARY_FILE' ? 'binary-file' : 'read-failed' });
        }
      }
    }
    visit(source.root);
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return { sourceId: source.sourceId, kind: 'local-directory', files, skipped, limits: { ...sourceLimits } };
  }

  async function selectFile() {
    if (!dialog?.showOpenDialog) throw new TypeError('未提供文件选择对话框');
    const result = await dialog.showOpenDialog({ title: '选择 PPT 来源文件', properties: ['openFile'] });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const filePath = fs.realpathSync(result.filePaths[0]);
    if (isSensitiveName(path, filePath)) throw createReaderError('INVALID_SOURCE', '凭证或受保护路径不允许读取。');
    return registerSource('local-file', filePath);
  }

  async function selectDirectory() {
    if (!dialog?.showOpenDialog) throw new TypeError('未提供目录选择对话框');
    const result = await dialog.showOpenDialog({ title: '选择 PPT 来源目录', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const directoryPath = fs.realpathSync(result.filePaths[0]);
    return registerSource('local-directory', directoryPath);
  }

  function registerIpc() {
    if (!ipcMain?.handle) return;
    ipcMain.handle(CHANNELS.selectFile, async (_event, ...args) => {
      if (args.length) throw createReaderError('INVALID_REQUEST', '请求参数无效。');
      return selectFile();
    });
    ipcMain.handle(CHANNELS.selectDirectory, async (_event, ...args) => {
      if (args.length) throw createReaderError('INVALID_REQUEST', '请求参数无效。');
      return selectDirectory();
    });
    ipcMain.handle(CHANNELS.listDirectory, async (_event, request) => {
      assertObject(request, '目录读取请求无效。');
      if (Object.keys(request).some(key => key !== 'sourceId')) throw createReaderError('INVALID_REQUEST', '请求参数无效。');
      const source = getSource(request.sourceId);
      if (source.kind !== 'local-directory') throw createReaderError('INVALID_SOURCE', '来源不是授权目录。');
      return listDirectory(source);
    });
    ipcMain.handle(CHANNELS.read, async (_event, request) => {
      assertObject(request, '来源读取请求无效。');
      const allowedKeys = new Set(['sourceId', 'relativePath', 'path', 'purpose', 'pageRange', 'requestId']);
      if (Object.keys(request).some(key => !allowedKeys.has(key))) throw createReaderError('INVALID_REQUEST', '请求参数无效。');
      const controller = new AbortController();
      if (request.requestId !== undefined) {
        if (typeof request.requestId !== 'string' || !request.requestId) throw createReaderError('INVALID_REQUEST', '请求 ID 无效。');
        activeRequests.set(request.requestId, controller);
      }
      try {
        return await readPptSource({ source: { sourceId: request.sourceId, relativePath: request.relativePath, path: request.path }, purpose: request.purpose, pageRange: request.pageRange, signal: controller.signal });
      } finally {
        if (request.requestId) activeRequests.delete(request.requestId);
      }
    });
    ipcMain.handle(CHANNELS.cancel, async (_event, request) => {
      assertObject(request, '取消请求无效。');
      if (Object.keys(request).some(key => key !== 'requestId') || typeof request.requestId !== 'string') throw createReaderError('INVALID_REQUEST', '取消请求无效。');
      const controller = activeRequests.get(request.requestId);
      if (!controller) return { canceled: false };
      controller.abort();
      return { canceled: true };
    });
  }

  registerIpc();
  return { channels: CHANNELS, selectFile, selectDirectory, listDirectory: request => listDirectory(getSource(request.sourceId)), readPptSource, cancel: requestId => activeRequests.get(requestId)?.abort() };
}

module.exports = { CHANNELS, createPptSourceReader };
