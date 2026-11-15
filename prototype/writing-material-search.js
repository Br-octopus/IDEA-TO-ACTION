(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepWritingMaterialSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_FILE_BYTES = 1024 * 1024;
  const MAX_QUERY_TERMS = 5;
  const MAX_FRAGMENT_CHARS = 1000;
  const YIELD_BATCH_SIZE = 32;
  const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.log', '.json', '.yaml', '.yml', '.js', '.cjs', '.mjs', '.jsx',
    '.ts', '.cts', '.mts', '.tsx', '.py', '.sh', '.bash', '.ps1', '.psm1', '.skill', '.workflow', '.html', '.css', '.scss', '.sql',
    '.java', '.kt', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.cs', '.vue', '.svelte']);
  const PRIVATE_SEGMENT = /^\.env(?:[.-]|$)|(^|[._-])(id_rsa|id_ed25519|private|secrets?)([._-]|$)/i;
  const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'target', 'release', 'coverage', '.next', '.nuxt', '.venv', 'venv', '__pycache__']);
  const CREDENTIAL_LINE = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|private[_-]?key)\s*[:=]/i;
  const TOKEN_PATTERNS = [
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    /\bsk-[A-Za-z0-9_-]{20,}\b/g
  ];

  function normalizePath(path) { return String(path || '').replace(/\\/g, '/').replace(/^\/+/, ''); }
  function yieldToBrowser() { return new Promise(resolve => setTimeout(resolve, 0)); }
  function credentialSafeText(text) {
    const masked = String(text || '').split(/\r?\n/).map(line => CREDENTIAL_LINE.test(line)
      ? '〔疑似凭证行已遮蔽〕'
      : TOKEN_PATTERNS.reduce((value, pattern) => value.replace(pattern, '〔疑似凭证已遮蔽〕'), line)).join('\n');
    return TOKEN_PATTERNS.some(pattern => pattern.test(masked)) ? '' : masked;
  }
  function queryTerms(value) {
    const raw = String(value || '').normalize('NFKC').toLocaleLowerCase();
    const words = raw.match(/[\p{L}\p{N}_-]{2,}/gu) || [];
    const stop = new Set(['请帮我', '希望能够', '如何进行', '相关材料', '写作任务', '文章改写', '操作手册', '资料内容', '以及', '这个', '那个', '可以', '需要', '进行', '希望', '请帮', '帮我', '关于', '材料', '文件', '改写', '优化', '撰写', '生成', '整理', '检查', '完善']);
    const terms = [];
    for (const word of words) {
      if (stop.has(word) || terms.includes(word)) continue;
      if (/^[\p{Script=Han}]+$/u.test(word) && word.length > 4) {
        const chunks = word.match(/[\p{Script=Han}]{2,4}/gu) || [];
        for (const chunk of chunks) if (!stop.has(chunk) && !terms.includes(chunk)) terms.push(chunk);
      } else terms.push(word);
    }
    return terms.slice(0, MAX_QUERY_TERMS);
  }
  function locateLine(text, offset) { return text.slice(0, offset).split('\n').length; }
  function excerptAround(text, offset, length = MAX_FRAGMENT_CHARS) {
    const start = Math.max(0, offset - Math.floor(length * 0.35));
    const end = Math.min(text.length, start + length);
    return { start, end, text: text.slice(start, end) };
  }
  function commonRoot(paths) {
    const roots = new Set(paths.map(path => path.split('/')[0]).filter(Boolean));
    return roots.size === 1 && paths.some(path => path.includes('/')) ? [...roots][0] : '';
  }

  function createWritingMaterialSearch(options = {}) {
    const files = new Map();
    const observedHits = new Map();
    const onProgress = options.onProgress || (() => {});

    function registerSource(sourceId, fileList, candidates = []) {
      const raw = Array.from(fileList || []);
      const paths = raw.map(file => normalizePath(file.webkitRelativePath || file.name || ''));
      const root = commonRoot(paths);
      const byPath = new Map(raw.map((file, index) => {
        const sourcePath = paths[index];
        const relativePath = root && sourcePath.startsWith(`${root}/`) ? sourcePath.slice(root.length + 1) : sourcePath;
        return [relativePath, file];
      }));
      const registered = [];
      for (const candidate of candidates) {
        const relativePath = normalizePath(candidate.relativePath || candidate.title || '');
        const file = byPath.get(relativePath);
        const segments = relativePath.split('/');
        const extension = `.${String(relativePath.split('/').at(-1) || '').split('.').at(-1)}`.toLowerCase();
        if (!file || !relativePath || file.size > MAX_FILE_BYTES || !TEXT_EXTENSIONS.has(extension)
          || segments.some(segment => PRIVATE_SEGMENT.test(segment) || EXCLUDED_DIRECTORIES.has(segment.toLowerCase()))) continue;
        const id = `search:${String(sourceId)}:${relativePath}`;
        files.set(id, { file, relativePath, materialId: String(candidate.id || id), title: String(candidate.title || relativePath) });
        registered.push({ id, materialId: String(candidate.id || id), title: String(candidate.title || relativePath), relativePath });
      }
      return registered;
    }

    function removeSource(sourceId) {
      const prefix = `search:${String(sourceId)}:`;
      for (const id of files.keys()) if (id.startsWith(prefix)) { files.delete(id); observedHits.delete(id); }
    }

    function clear() { files.clear(); observedHits.clear(); }

    async function readText(entry, signal) {
      if (signal?.aborted) throw new DOMException('全文检索已取消', 'AbortError');
      if (!entry.file || entry.file.size > MAX_FILE_BYTES || typeof entry.file.arrayBuffer !== 'function') {
        throw new Error('文件不可读或超过 1 MB');
      }
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      if (signal?.aborted) throw new DOMException('全文检索已取消', 'AbortError');
      if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) throw new Error('文件不是受支持的文本');
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }

    async function search(query, searchOptions = {}) {
      const signal = searchOptions.signal;
      const queries = (Array.isArray(query) ? query : queryTerms(query)).map(value => String(value || '').trim().toLocaleLowerCase()).filter(Boolean).slice(0, MAX_QUERY_TERMS);
      const entries = [...files.entries()];
      const results = [];
      const errors = [];
      let scanned = 0;
      for (const [id, entry] of entries) {
        if (signal?.aborted) throw new DOMException('全文检索已取消', 'AbortError');
        try {
          const text = await readText(entry, signal);
          const haystack = text.toLocaleLowerCase();
          const pathText = `${entry.title} ${entry.relativePath}`.toLocaleLowerCase();
          const hits = [];
          for (const term of queries) {
            let index = -1;
            while ((index = haystack.indexOf(term, index + 1)) >= 0) {
              hits.push({ term, offset: index });
              if (!observedHits.has(id)) observedHits.set(id, new Set());
              observedHits.get(id).add(index);
            }
          }
          const pathMatches = queries.filter(term => pathText.includes(term));
          if (hits.length || pathMatches.length) {
            const score = hits.reduce((total, hit) => total + (hit.term.length > 2 ? 2 : 1), 0) + pathMatches.length;
            const seen = new Set();
            for (const hit of hits) {
              const fragment = excerptAround(text, hit.offset);
              const identity = `${fragment.start}:${fragment.end}`;
              if (seen.has(identity)) continue;
              seen.add(identity);
              const safeExcerpt = credentialSafeText(fragment.text);
              if (!safeExcerpt) { errors.push({ id, status: 'withheld-credential', reason: '命中片段无法可靠遮蔽疑似凭证，未发送' }); continue; }
              results.push({ id, materialId: entry.materialId, title: entry.title, relativePath: entry.relativePath,
                excerpt: safeExcerpt, offset: hit.offset, start: fragment.start, end: fragment.end,
                locator: `第 ${locateLine(text, hit.offset)} 行`, score, matchedTerms: [...new Set(hits.map(item => item.term))] });
            }
            if (!hits.length) results.push({ id, materialId: entry.materialId, title: entry.title, relativePath: entry.relativePath,
              excerpt: '', offset: 0, start: 0, end: 0, locator: '路径/文件名命中', score, matchedTerms: pathMatches });
          }
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          errors.push({ id, status: 'unavailable', reason: String(error.message || error).slice(0, 180) });
        }
        scanned++;
        searchOptions.onProgress?.({ scanned, total: entries.length, relativePath: entry.relativePath });
        if (scanned % YIELD_BATCH_SIZE === 0 || scanned === entries.length) {
          await (options.yieldControl || yieldToBrowser)();
        }
      }
      const unique = new Map();
      for (const result of results.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))) {
        const identity = result.id;
        if (!unique.has(identity)) unique.set(identity, result);
      }
      const budgetTokens = Number.isFinite(searchOptions.budgetTokens) ? Math.max(0, searchOptions.budgetTokens) : 6000;
      let remaining = budgetTokens;
      const bounded = [];
      for (const item of unique.values()) {
        const estimate = item.excerpt ? item.excerpt.length : 40;
        if (estimate > remaining) continue;
        bounded.push(item);
        remaining -= estimate;
      }
      return { results: bounded, errors, scanned, total: entries.length, complete: scanned === entries.length, queries };
    }

    async function read(id, offset, options = {}) {
      const entry = files.get(String(id));
      if (!entry) throw new Error('文件 ID 未授权或已失效');
      const position = Number(offset);
      if (!Number.isSafeInteger(position) || position < 0) throw new Error('读取位置无效');
      if (!observedHits.get(String(id))?.has(position)) throw new Error('读取位置不是本机检索命中，已拒绝读取');
      const text = await readText(entry, options.signal);
      if (position > text.length) throw new Error('读取位置超出文件范围');
      const fragment = excerptAround(text, position, Math.min(MAX_FRAGMENT_CHARS, options.length || MAX_FRAGMENT_CHARS));
      const excerpt = credentialSafeText(fragment.text);
      if (!excerpt) throw new Error('命中片段包含无法可靠遮蔽的凭证，已拒绝发送');
      return { id, materialId: entry.materialId, title: entry.title, relativePath: entry.relativePath,
        excerpt, offset: position, start: fragment.start, end: fragment.end, locator: `第 ${locateLine(text, position)} 行` };
    }

    return { registerSource, removeSource, clear, search, read, size: () => files.size };
  }

  return { MAX_FILE_BYTES, MAX_QUERY_TERMS, MAX_FRAGMENT_CHARS, queryTerms, credentialSafeText, createWritingMaterialSearch };
});
