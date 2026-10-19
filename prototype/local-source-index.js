const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILE_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.text', '.log', '.json', '.yaml', '.yml', '.js', '.cjs', '.mjs', '.jsx',
  '.ts', '.cts', '.mts', '.tsx', '.py', '.sh', '.bash', '.ps1', '.psm1', '.skill', '.workflow'
]);
const EXCLUDED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'target', 'release', 'coverage',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.tox', '.cache', '.turbo', '.parcel-cache', '.pytest_cache', '.pnpm-store'
]);

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function resolveContainedPath(filePath, rootPath, fileSystem) {
  const root = fileSystem.realpathSync(rootPath);
  const candidate = fileSystem.realpathSync(filePath);
  if (!isContained(root, candidate)) throw new Error('文件路径超出授权目录');
  return { root, candidate };
}

function classifyFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const extension = path.extname(name);
  if (name === '.env' || name.startsWith('.env.') || name.startsWith('.env-')
    || /(^|[._-])(id_rsa|id_ed25519|private|secret)([._-]|$)/i.test(name)
    || ['.pem', '.key', '.p12', '.pfx', '.der'].includes(extension)) return null;
  if (!TEXT_EXTENSIONS.has(extension)) return null;
  return extension === '.md' || extension === '.markdown' || extension === '.skill' || extension === '.workflow'
    ? 'document' : 'source';
}

function metadataFromText(relativePath, content, type) {
  const lines = content.split(/\r?\n/);
  const heading = lines.find(line => /^\s*#\s+\S/.test(line));
  const title = heading ? heading.replace(/^\s*#\s+/, '').trim().slice(0, 160) : path.basename(relativePath);
  const normalized = content.replace(/\s+/g, ' ').trim();
  const keywords = [...new Set((`${title} ${normalized}`.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []))].slice(0, 40);
  return {
    id: relativePath,
    relativePath,
    title,
    type,
    keywords,
    excerpt: normalized.slice(0, 280),
    fingerprint: crypto.createHash('sha256').update(content).digest('hex')
  };
}

function indexSourceFile(filePath, options = {}) {
  const fileSystem = options.fs || fs;
  const requestedRoot = options.root || path.dirname(path.resolve(filePath));
  const { root, candidate } = resolveContainedPath(filePath, requestedRoot, fileSystem);
  const relativePath = path.relative(root, candidate).split(path.sep).join('/');
  if (!relativePath || relativePath.split('/').some(part => EXCLUDED_DIRECTORIES.has(part.toLowerCase()))) {
    throw new Error('文件位于不受支持的目录');
  }
  const type = classifyFile(candidate);
  if (!type) return null;
  const stat = fileSystem.statSync(candidate);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  const bytes = fileSystem.readFileSync(candidate);
  if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) return null;
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return null; }
  return metadataFromText(relativePath, content, type);
}

function listSourceFiles(rootPath, options = {}) {
  const fileSystem = options.fs || fs;
  const root = fileSystem.realpathSync(rootPath);
  const results = [];
  function visit(directory) {
    const entries = fileSystem.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (entry.name.toLowerCase() === '.git') continue;
      const fullPath = path.join(directory, entry.name);
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

function refreshSourceIndex(root, previousIndex = null) {
  const files = listSourceFiles(root);
  const previous = new Map((previousIndex?.files || []).map(item => [item.relativePath, item]));
  const current = new Map(files.map(item => [item.relativePath, item]));
  const changes = {
    added: files.filter(item => !previous.has(item.relativePath)),
    modified: files.filter(item => previous.has(item.relativePath) && previous.get(item.relativePath).fingerprint !== item.fingerprint),
    deleted: [...previous.keys()].filter(relativePath => !current.has(relativePath)).sort()
  };
  return { version: 1, files, changes };
}

function searchSourceIndex(index, query, filters = {}) {
  const terms = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const files = (index?.files || []).filter(item => {
    if (filters.type && item.type !== filters.type) return false;
    if (filters.keyword && !item.keywords.includes(String(filters.keyword).toLowerCase())) return false;
    const haystack = `${item.title} ${item.relativePath} ${item.keywords.join(' ')} ${item.excerpt}`.toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
  return { files };
}

module.exports = { MAX_FILE_BYTES, listSourceFiles, indexSourceFile, refreshSourceIndex, searchSourceIndex };
