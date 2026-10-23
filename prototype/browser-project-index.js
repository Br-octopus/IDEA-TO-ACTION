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
      || /(^|[._-])(id_rsa|id_ed25519|private|secret)([._-]|$)/i.test(name)
      || PRIVATE_EXTENSIONS.has(extension(name));
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

  async function indexBrowserProjectFiles(fileList, options = {}) {
    const rawInput = Array.from(fileList || []);
    const rawPaths = rawInput.map(file => String(file.webkitRelativePath || file.name || '').replace(/\\/g, '/').replace(/^\/+/, ''));
    const roots = new Set(rawPaths.map(path => path.split('/')[0]).filter(Boolean));
    const commonRoot = roots.size === 1 && rawPaths.some(path => path.includes('/')) ? [...roots][0] : '';
    const input = rawInput.map((file, index) => ({ file, sourcePath: rawPaths[index], relativePath: commonRoot && rawPaths[index].startsWith(`${commonRoot}/`)
      ? rawPaths[index].slice(commonRoot.length + 1) : rawPaths[index] })).filter(({ sourcePath }) => {
      return !excludedPath(sourcePath);
    });
    const signal = options.signal;
    const inventory = [];
    const files = [];
    const maxFiles = Number.isSafeInteger(options.maxFiles) ? Math.min(Math.max(options.maxFiles, 1), MAX_FILES - 1) : MAX_FILES - 1;
    let inventoryComplete = input.length <= maxFiles;
    const selected = input.slice(0, maxFiles);

    for (let index = 0; index < selected.length; index++) {
      if (signal?.aborted) throw new DOMException('目录读取已取消', 'AbortError');
      const { file, relativePath } = selected[index];
      if (!relativePath || excludedPath(relativePath)) continue;
      const name = fileName(relativePath);
      const base = { id: relativePath, relativePath, title: name };
      if (isPrivateName(name)) {
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
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (signal?.aborted) throw new DOMException('目录读取已取消', 'AbortError');
        if (bytes.length > MAX_FILE_BYTES) {
          inventory.push({ ...base, status: 'too-large' });
          continue;
        }
        if (bytes.includes(0)) {
          inventory.push({ ...base, status: 'binary' });
          continue;
        }
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const fragments = sampleLines(relativePath, text);
        const excerpt = fragments.map(item => `${item.locator}\n${item.text}`).join('\n').slice(0, MAX_EXCERPT_LENGTH);
        if (!excerpt) {
          inventory.push({ ...base, status: 'empty' });
          continue;
        }
        files.push({ id: relativePath, relativePath, title: name, type: /\.(md|markdown|skill|workflow)$/i.test(name) ? 'document' : 'source',
          excerpt, fingerprint: fingerprint(text) });
        inventory.push({ ...base, status: 'indexed' });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        inventory.push({ ...base, status: error instanceof TypeError ? 'unsupported-encoding' : 'unavailable', reason: '文件无法读取' });
      }
    }
    if (!inventoryComplete) inventory.push({ id: 'browser-project-truncated', relativePath: '', title: '其余文件未扫描', status: 'unavailable', reason: `本次最多扫描 ${maxFiles} 个文件` });
    return { files, inventory, inventoryComplete };
  }

  return { MAX_FILES, MAX_FILE_BYTES, indexBrowserProjectFiles };
});
