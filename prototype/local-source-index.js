const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 280;
const privateFileData = new WeakMap();
const privateIndexData = new WeakMap();
const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.text', '.log', '.json', '.yaml', '.yml', '.js', '.cjs', '.mjs', '.jsx',
  '.ts', '.cts', '.mts', '.tsx', '.py', '.sh', '.bash', '.ps1', '.psm1', '.skill', '.workflow'
]);
const EXCLUDED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'target', 'release', 'coverage',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.tox', '.cache', '.turbo', '.parcel-cache', '.pytest_cache', '.pnpm-store'
]);

function isContained(root, candidate, pathImpl = path) {
  const relative = pathImpl.relative(root, candidate);
  return relative === '' || (!pathImpl.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${pathImpl.sep}`));
}

function resolveContainedPath(filePath, rootPath, fileSystem, pathImpl = path) {
  const root = fileSystem.realpathSync(rootPath);
  const candidate = fileSystem.realpathSync(filePath);
  if (!isContained(root, candidate, pathImpl)) throw new Error('文件路径超出授权目录');
  return { root, candidate };
}

function classifyFile(filePath, pathImpl = path) {
  const name = pathImpl.basename(filePath).toLowerCase();
  const extension = pathImpl.extname(name);
  if (name === '.env' || name.startsWith('.env.') || name.startsWith('.env-')
    || /(^|[._-])(id_rsa|id_ed25519|private|secret)([._-]|$)/i.test(name)
    || ['.pem', '.key', '.p12', '.pfx', '.der'].includes(extension)) return null;
  if (!TEXT_EXTENSIONS.has(extension)) return null;
  return extension === '.md' || extension === '.markdown' || extension === '.skill' || extension === '.workflow'
    ? 'document' : 'source';
}

function metadataFromText(relativePath, content, type, pathImpl = path) {
  const lines = content.split(/\r?\n/);
  const heading = lines.find(line => /^\s*#\s+\S/.test(line));
  const title = heading ? heading.replace(/^\s*#\s+/, '').trim().slice(0, 160) : pathImpl.basename(relativePath);
  const nonemptyLines = lines.flatMap((line, index) => {
    const text = line.replace(/\s+/g, ' ').trim();
    if (!text) return [];
    return [{ text, line: index + 1 }];
  });
  const fragments = nonemptyLines.length <= MAX_FRAGMENTS
    ? nonemptyLines
    : Array.from({ length: MAX_FRAGMENTS }, (_, index) => nonemptyLines[Math.round(index * (nonemptyLines.length - 1) / (MAX_FRAGMENTS - 1))]);
  for (const fragment of fragments) fragment.text = fragment.text.slice(0, MAX_FRAGMENT_LENGTH);
  const indexedText = `${title} ${content.replace(/\s+/g, ' ')}`;
  const keywords = [...new Set((indexedText.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []))].slice(0, 40);
  const result = {
    id: relativePath,
    relativePath,
    title,
    type,
    excerpt: fragments.find(fragment => !/^\s*#+\s/.test(fragment.text))?.text || fragments[0]?.text || '',
    fragments,
    fingerprint: crypto.createHash('sha256').update(content).digest('hex')
  };
  privateFileData.set(result, { content, keywords });
  return result;
}

function indexSourceFile(filePath, options = {}) {
  const fileSystem = options.fs || fs;
  const pathImpl = options.path || path;
  const requestedRoot = options.root || pathImpl.dirname(pathImpl.resolve(filePath));
  const { root, candidate } = resolveContainedPath(filePath, requestedRoot, fileSystem, pathImpl);
  const relativePath = pathImpl.relative(root, candidate).split(pathImpl.sep).join('/');
  if (!relativePath || relativePath.split('/').some(part => EXCLUDED_DIRECTORIES.has(part.toLowerCase()))) {
    throw new Error('文件位于不受支持的目录');
  }
  const type = classifyFile(candidate, pathImpl);
  if (!type) return null;
  const stat = fileSystem.statSync(candidate);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  const bytes = fileSystem.readFileSync(candidate);
  if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) return null;
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return null; }
  return metadataFromText(relativePath, content, type, pathImpl);
}

function listSourceFiles(rootPath, options = {}) {
  const fileSystem = options.fs || fs;
  const pathImpl = options.path || path;
  const root = fileSystem.realpathSync(rootPath);
  const results = [];
  function visit(directory) {
    const entries = fileSystem.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (entry.name.toLowerCase() === '.git') continue;
      const fullPath = pathImpl.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) visit(fullPath);
      } else if (entry.isFile()) {
        try {
          const item = indexSourceFile(fullPath, { ...options, fs: fileSystem, root });
          if (item) results.push(item);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }
  }
  visit(root);
  return results;
}

function refreshSourceIndex(root, previousIndex = null, options = {}) {
  const files = listSourceFiles(root, options);
  const previous = new Map((previousIndex?.files || []).map(item => [item.relativePath, item]));
  const current = new Map(files.map(item => [item.relativePath, item]));
  const changes = {
    added: files.filter(item => !previous.has(item.relativePath)),
    modified: files.filter(item => previous.has(item.relativePath) && previous.get(item.relativePath).fingerprint !== item.fingerprint),
    deleted: [...previous.keys()].filter(relativePath => !current.has(relativePath)).sort()
  };
  const index = { version: 1, files, changes };
  privateIndexData.set(index, new Map(files.map(item => [item.relativePath, privateFileData.get(item)])));
  return index;
}

function searchSourceIndex(index, query, filters = {}) {
  const terms = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const files = (index?.files || []).filter(item => {
    if (filters.type && item.type !== filters.type) return false;
    const privateData = privateIndexData.get(index)?.get(item.relativePath);
    const searchable = `${item.title} ${item.relativePath} ${privateData?.content || ''}`.toLowerCase();
    if (filters.keyword && !(privateData?.keywords || []).includes(String(filters.keyword).toLowerCase())) return false;
    return terms.every(term => searchable.includes(term));
  });
  return { files: files.map(item => {
    const content = privateIndexData.get(index)?.get(item.relativePath)?.content || '';
    const lines = content.split(/\r?\n/);
    const matchingLines = lines.flatMap((text, lineIndex) => {
      const normalized = text.toLowerCase();
      return terms.some(term => normalized.includes(term))
        ? [{ text: text.trim().slice(0, MAX_FRAGMENT_LENGTH), line: lineIndex + 1 }]
        : [];
    }).filter(fragment => fragment.text);
    const fragments = matchingLines.slice(0, MAX_FRAGMENTS);
    return {
      id: item.id,
      relativePath: item.relativePath,
      title: item.title,
      type: item.type,
      fingerprint: item.fingerprint,
      fragments,
      excerpt: fragments[0]?.text || ''
    };
  }) };
}

module.exports = { MAX_FILE_BYTES, listSourceFiles, indexSourceFile, refreshSourceIndex, searchSourceIndex };
