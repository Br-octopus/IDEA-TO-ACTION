(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ForwardStepBrowserProjectIndex = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_FILES = 10000;
  const MAX_FILE_BYTES = 1024 * 1024;
  const MAX_EXCERPT_LENGTH = 1200;
  const TEXT_EXTENSIONS = new Set([
    '.md', '.markdown', '.txt', '.text', '.log', '.json', '.yaml', '.yml', '.js', '.cjs', '.mjs', '.jsx',
    '.ts', '.cts', '.mts', '.tsx', '.py', '.sh', '.bash', '.ps1', '.psm1', '.skill', '.workflow',
    '.html', '.css', '.scss', '.sql', '.java', '.kt', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.cs', '.vue', '.svelte'
  ]);
  const EXCLUDED_DIRECTORIES = new Set([
    '.git', 'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'target', 'release', 'coverage',
    '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.tox', '.cache', '.turbo', '.parcel-cache', '.pytest_cache', '.pnpm-store'
  ]);
  const PRIVATE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.der']);

  function fileName(path) { return String(path || '').split('/').at(-1) || ''; }
  function extension(name) { const index = name.lastIndexOf('.'); return index < 0 ? '' : name.slice(index).toLowerCase(); }
  function isPrivateName(name) {
    return /^\.env(?:[.-]|$)/i.test(name)
      || /(^|[._-])(id_rsa|id_ed25519|private|secrets?)([._-]|$)/i.test(name)
      || PRIVATE_EXTENSIONS.has(extension(name));
  }
  function isPrivatePath(relativePath) {
    return relativePath.split('/').some(part => isPrivateName(part));
  }
  function fingerprint(text) {
    // 仅用于识别本次浏览器会话中的文件变化，不作为安全校验摘要。
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return `${text.length}:${(hash >>> 0).toString(16)}`;
  }
  function sampleLines(relativePath, text) {
    const lines = text.split(/\r?\n/).flatMap((line, index) => {
      const value = line.replace(/\s+/g, ' ').trim();
      return value ? [{ text: value.slice(0, 280), line: index + 1 }] : [];
    });
    if (!lines.length) return [];
    const count = Math.min(5, lines.length);
    const selected = count === lines.length ? lines : Array.from({ length: count }, (_, index) =>
      lines[Math.round(index * (lines.length - 1) / (count - 1))]);
    return selected.map(item => ({ locator: `${relativePath}:${item.line}`, text: looksLikeCredential(item.text) ? '〔疑似密钥行已遮蔽〕' : item.text }));
  }
  function looksLikeCredential(line) {
    return /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|private[_-]?key)\s*[:=]\s*['"`]?\S{8,}/i.test(line)
      || /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(line)
      || /\bAKIA[0-9A-Z]{16}\b/.test(line)
      || /\bgh[pousr]_[A-Za-z0-9]{20,}\b/.test(line);
  }
  function excludedPath(relativePath) {
    return relativePath.split('/').some(part => EXCLUDED_DIRECTORIES.has(part.toLowerCase()));
  }

  function normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }
  function relativeProjectPath(file, commonRoot) {
    const sourcePath = normalizePath(file.webkitRelativePath || file.name || '');
    return { sourcePath, relativePath: commonRoot && sourcePath.startsWith(`${commonRoot}/`)
      ? sourcePath.slice(commonRoot.length + 1) : sourcePath };
  }
  function generatedReason(relativePath) {
    const name = fileName(relativePath).toLowerCase();
    if (/\.min\.(?:js|css)$/.test(name) || /^build_v\d+\./.test(name)) return 'generated';
    if (/(?:^|[._-])(?:tmp|temp|bak|backup|old)(?:[._-]|$)/.test(name) || /~$/.test(name)) return 'generated';
    return '';
  }
  function createError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
  async function readCandidate(file, relativePath, signal) {
    const name = fileName(relativePath);
    if (!relativePath || excludedPath(relativePath) || isPrivatePath(relativePath)) {
      throw createError('该文件属于安全排除项，不能恢复', 'NOT_RESTORABLE');
    }
    if (!TEXT_EXTENSIONS.has(extension(name))) throw createError('文件格式不受支持', 'UNSAFE_CANDIDATE');
    if (!Number.isFinite(file.size) || file.size > MAX_FILE_BYTES) throw createError('文件超过 1 MB 上限', 'UNSAFE_CANDIDATE');
    if (signal?.aborted) throw new DOMException('目录读取已取消', 'AbortError');
    let bytes;
    try { bytes = new Uint8Array(await file.arrayBuffer()); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw createError('文件无法读取', 'UNSAFE_CANDIDATE');
    }
    if (signal?.aborted) throw new DOMException('目录读取已取消', 'AbortError');
    if (bytes.length > MAX_FILE_BYTES) throw createError('文件超过 1 MB 上限', 'UNSAFE_CANDIDATE');
    if (bytes.includes(0)) throw createError('检测到二进制内容', 'UNSAFE_CANDIDATE');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw createError('文件编码不受支持', 'UNSAFE_CANDIDATE'); }
    const fragments = sampleLines(relativePath, text);
    const excerpt = fragments.map(item => `${item.locator}\n${item.text}`).join('\n').slice(0, MAX_EXCERPT_LENGTH);
    if (!excerpt) throw createError('文件没有可用文本内容', 'EMPTY_CANDIDATE');
    return { id: relativePath, relativePath, title: name,
      type: /\.(md|markdown|skill|workflow)$/i.test(name) ? 'document' : 'source',
      excerpt, fingerprint: fingerprint(text) };
  }

  async function indexBrowserProjectFiles(fileList, options = {}) {
    const rawInput = Array.from(fileList || []);
    const rawPaths = rawInput.map(file => normalizePath(file.webkitRelativePath || file.name || ''));
    const roots = new Set(rawPaths.map(path => path.split('/')[0]).filter(Boolean));
    const commonRoot = roots.size === 1 && rawPaths.some(path => path.includes('/')) ? [...roots][0] : '';
    const input = rawInput.map(file => ({ file, ...relativeProjectPath(file, commonRoot) }))
      .filter(({ sourcePath }) => !excludedPath(sourcePath));
    const signal = options.signal;
    const inventory = [];
    const files = [];
    const filteredCandidates = [];
    const maxFiles = Number.isSafeInteger(options.maxFiles) ? Math.min(Math.max(options.maxFiles, 1), MAX_FILES) : MAX_FILES;
    let inventoryComplete = input.length <= maxFiles;
    const selected = input.slice(0, maxFiles);

    for (let index = 0; index < selected.length; index++) {
      if (signal?.aborted) throw new DOMException('目录读取已取消', 'AbortError');
      const { file, relativePath } = selected[index];
      if (!relativePath || excludedPath(relativePath)) continue;
      const name = fileName(relativePath);
      const base = { id: relativePath, relativePath, title: name };
      if (isPrivatePath(relativePath)) {
        inventory.push({ id: `private-${index}`, relativePath: '', title: '已排除的敏感文件', status: 'excluded-private' });
        continue;
      }
      if (!TEXT_EXTENSIONS.has(extension(name))) {
        inventory.push({ ...base, status: 'unsupported' });
        continue;
      }
      if (!Number.isFinite(file.size) || file.size > MAX_FILE_BYTES) {
        inventory.push({ ...base, status: 'too-large' });
        continue;
      }
      const reason = generatedReason(relativePath);
      if (reason) {
        filteredCandidates.push({ relativePath, title: name, reason });
        inventory.push({ ...base, status: 'filtered-generated', reason });
        continue;
      }
      try {
        files.push(await readCandidate(file, relativePath, signal));
        inventory.push({ ...base, status: 'indexed' });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        const status = error.code === 'EMPTY_CANDIDATE' ? 'empty' : error.code === 'UNSAFE_CANDIDATE'
          ? (error.message.includes('上限') ? 'too-large' : error.message.includes('二进制') ? 'binary' : 'unsupported-encoding')
          : 'unavailable';
        inventory.push({ ...base, status, reason: error.message || '文件无法读取' });
      }
    }
    if (!inventoryComplete) inventory.push({ id: 'browser-project-truncated', relativePath: '', title: '其余文件未扫描', status: 'unavailable', reason: `本次最多扫描 ${maxFiles} 个文件` });
    return { files, filteredCandidates, filteredCandidateCount: filteredCandidates.length, inventory, inventoryComplete };
  }

  async function restoreBrowserProjectCandidate(fileList, relativePath, options = {}) {
    const requestedPath = normalizePath(relativePath);
    if (!requestedPath || requestedPath.split('/').some(part => !part || part === '.' || part === '..') || excludedPath(requestedPath)
      || isPrivatePath(requestedPath) || !generatedReason(requestedPath)) {
      throw createError('该文件不属于可恢复的生成/临时候选', 'NOT_RESTORABLE');
    }
    const input = Array.from(fileList || []);
    const rawPaths = input.map(file => normalizePath(file.webkitRelativePath || file.name || ''));
    const roots = new Set(rawPaths.map(path => path.split('/')[0]).filter(Boolean));
    const commonRoot = roots.size === 1 && rawPaths.some(path => path.includes('/')) ? [...roots][0] : '';
    const match = input.map(file => ({ file, ...relativeProjectPath(file, commonRoot) }))
      .find(item => item.relativePath === requestedPath && !excludedPath(item.sourcePath));
    if (!match) throw createError('原文件不可用，请重新选择目录后重试', 'CANDIDATE_UNAVAILABLE');
    return { file: await readCandidate(match.file, match.relativePath, options.signal) };
  }

  function filterBrowserProjectCandidates(result, options = {}) {
    const query = String(options.query || '').trim().toLocaleLowerCase();
    const matches = (Array.isArray(result?.files) ? result.files : []).filter(item => !query
      || [item.title, item.relativePath, item.excerpt].some(value => String(value || '').toLocaleLowerCase().includes(query)));
    const pageSize = Math.max(1, Math.min(Number.isSafeInteger(options.pageSize) ? options.pageSize : 20, 20));
    const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
    const page = Math.max(1, Math.min(Number.isSafeInteger(options.page) ? options.page : 1, pageCount));
    const filteredCandidates = Array.isArray(result?.filteredCandidates) ? result.filteredCandidates : [];
    return {
      items: matches.slice((page - 1) * pageSize, page * pageSize), total: matches.length, page, pageSize,
      filteredTotal: Number.isSafeInteger(result?.filteredCandidateCount) ? result.filteredCandidateCount : filteredCandidates.length,
      filteredItems: options.showFiltered ? filteredCandidates : [],
      inventoryComplete: result?.inventoryComplete !== false
    };
  }

  return { MAX_FILES, MAX_FILE_BYTES, indexBrowserProjectFiles, filterBrowserProjectCandidates, restoreBrowserProjectCandidate };
});
