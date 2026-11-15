const fs = require('node:fs/promises');
const path = require('node:path');
const yauzl = require('yauzl');
const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256_000;
const MAX_FILES = 10_000;
const MAX_RESOURCE_READ_BYTES = 32_000;
const PRIVATE_PART = /^(?:\.env(?:[.-]|$)|.*(?:secret|private|password|credential|token).*)$/i;
const EXCLUDED_PARTS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'out', 'release', '__pycache__', '.venv', 'venv']);
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.scss', '.sql', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.cs', '.vue', '.svelte', '.docx', '.pdf']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeRelative(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)
    || normalized.split('/').some(part => !part || part === '.' || part === '..')) return '';
  return normalized;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeParts(relativePath) {
  return relativePath.split('/').every(part => !EXCLUDED_PARTS.has(part.toLowerCase()) && !PRIVATE_PART.test(part));
}

async function readResourceFile(root, relativePath, limit = MAX_RESOURCE_READ_BYTES) {
  const relative = safeRelative(relativePath);
  if (!relative || relative.split('/').some(part => part.toLowerCase() === '.git' || part.toLowerCase() === 'node_modules'
    || PRIVATE_PART.test(part))) throw fail('RESOURCE_PATH_FORBIDDEN', '资源路径不在允许范围内');
  const archiveStat = await fs.stat(root).catch(() => null);
  if (archiveStat?.isFile()) return readZipEntry(root, relative, limit);
  if (!archiveStat?.isDirectory()) throw fail('RESOURCE_ARCHIVE_UNAVAILABLE', '资源归档不存在');
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw fail('RESOURCE_PATH_FORBIDDEN', '资源路径越界');
  const stat = await fs.stat(target).catch(() => null);
  if (!stat || !stat.isFile()) throw fail('RESOURCE_READ_FAILED', '资源文件不存在');
  const handle = await fs.open(target, 'r');
  try {
    const length = Math.min(Math.max(Number(limit) || MAX_RESOURCE_READ_BYTES, 1), MAX_RESOURCE_READ_BYTES);
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, 0);
    return { content: buffer.subarray(0, result.bytesRead).toString('utf8'), truncated: stat.size > length };
  } finally {
    await handle.close();
  }
}

function readZipEntry(archivePath, relativePath, limit = MAX_RESOURCE_READ_BYTES) {
  const boundedLimit = Math.min(Math.max(Number(limit) || MAX_RESOURCE_READ_BYTES, 1), MAX_RESOURCE_READ_BYTES);
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(fail('RESOURCE_ARCHIVE_UNAVAILABLE', '资源压缩包无法读取'));
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      zip.on('error', errorEvent => finish(reject, fail('RESOURCE_ARCHIVE_UNAVAILABLE', errorEvent.message || '资源压缩包读取失败')));
      zip.on('end', () => finish(reject, fail('RESOURCE_READ_FAILED', '资源文件不存在')));
      zip.on('entry', entry => {
        const name = String(entry.fileName || '').replace(/\\/g, '/').replace(/\/$/, '');
        if (name !== relativePath) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return finish(reject, fail('RESOURCE_READ_FAILED', '资源文件无法读取'));
          const chunks = [];
          let size = 0;
          stream.on('data', chunk => {
            if (size >= boundedLimit) return;
            const remaining = boundedLimit - size;
            chunks.push(chunk.subarray(0, remaining));
            size += Math.min(chunk.length, remaining);
          });
          stream.on('error', errorEvent => finish(reject, fail('RESOURCE_READ_FAILED', errorEvent.message || '资源文件读取失败')));
          stream.on('end', () => finish(resolve, { content: Buffer.concat(chunks).toString('utf8'), truncated: entry.uncompressedSize > boundedLimit }));
        });
      });
      zip.readEntry();
    });
  });
}

function validateParams(params, schema = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw fail('RESOURCE_PARAMS_INVALID', '脚本参数必须是对象');
  const allowed = new Set(Object.keys(schema.properties || {}));
  for (const key of Object.keys(params)) if (allowed.size && !allowed.has(key)) throw fail('RESOURCE_PARAMS_INVALID', `脚本参数不允许：${key}`);
  for (const [key, rule] of Object.entries(schema.properties || {})) {
    if (rule.required && !Object.hasOwn(params, key)) throw fail('RESOURCE_PARAMS_INVALID', `缺少脚本参数：${key}`);
    if (!Object.hasOwn(params, key)) continue;
    const value = params[key];
    if (rule.type === 'string' && (typeof value !== 'string' || value.length > (rule.maxLength || 500))) throw fail('RESOURCE_PARAMS_INVALID', `参数 ${key} 无效`);
    if (rule.type === 'array' && (!Array.isArray(value) || value.length > (rule.maxItems || 100))) throw fail('RESOURCE_PARAMS_INVALID', `参数 ${key} 无效`);
    if (rule.type === 'integer' && (!Number.isSafeInteger(value) || value < (rule.minimum ?? 0) || value > (rule.maximum ?? 10000))) throw fail('RESOURCE_PARAMS_INVALID', `参数 ${key} 无效`);
  }
  return params;
}

async function walk(root, maxFiles = MAX_FILES) {
  const files = [];
  const skipped = [];
  const queue = [''];
  while (queue.length && files.length + skipped.length < maxFiles) {
    const relativeDir = queue.shift();
    const absoluteDir = path.join(root, relativeDir);
    let entries;
    try { entries = await fs.readdir(absoluteDir, { withFileTypes: true }); }
    catch { skipped.push({ path: relativeDir, reason: '无法读取目录' }); continue; }
    for (const entry of entries) {
      if (files.length + skipped.length >= maxFiles) break;
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (!safeParts(relative)) { skipped.push({ path: relative, reason: '安全排除项' }); continue; }
      if (entry.isDirectory()) { queue.push(relative); continue; }
      if (!entry.isFile()) { skipped.push({ path: relative, reason: '不是普通文件' }); continue; }
      const extension = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(extension)) { skipped.push({ path: relative, reason: '格式不支持' }); continue; }
      try {
        const stat = await fs.stat(path.join(root, relative));
        if (stat.size > 1024 * 1024) { skipped.push({ path: relative, reason: '超过单文件 1 MB 上限' }); continue; }
        files.push({ path: relative, size: stat.size, extension });
      } catch { skipped.push({ path: relative, reason: '无法读取文件属性' }); }
    }
  }
  return { files, skipped, truncated: queue.length > 0 };
}

async function runBuiltin(actionId, root, params) {
  if (actionId === 'softcopyright.project-scan' || actionId === 'softcopyright.project-analyze' || actionId === 'softcopyright.code-selection') {
    const inventory = await walk(root, params.maxFiles || MAX_FILES);
    return { actionId, inventory, summary: `可读文件 ${inventory.files.length} 个，跳过 ${inventory.skipped.length} 个${inventory.truncated ? '，目录达到扫描上限' : ''}` };
  }
  if (actionId === 'softcopyright.manual-outline') {
    const inventory = await walk(root, params.maxFiles || MAX_FILES);
    const chapters = [];
    for (const file of inventory.files.filter(item => ['.md', '.markdown', '.txt'].includes(item.extension))) {
      const content = await fs.readFile(path.join(root, file.path), 'utf8').catch(() => '');
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
        if (match) chapters.push({ title: match[2].slice(0, 240), level: match[1].length, locator: `${file.path}:${index + 1}` });
        if (chapters.length >= 200) break;
      }
    }
    return { actionId, chapters, summary: `提取到 ${chapters.length} 个标题；目录不完整时需要用户手动指定章节范围。` };
  }
  if (actionId === 'softcopyright.code-extract') {
    const paths = Array.isArray(params.paths) ? params.paths : [];
    const files = [];
    for (const value of paths.slice(0, 100)) {
      const relative = safeRelative(value);
      if (!relative || !safeParts(relative)) throw fail('RESOURCE_PATH_FORBIDDEN', '代码文件路径不在允许范围内');
      const target = path.resolve(root, relative);
      if (!inside(root, target)) throw fail('RESOURCE_PATH_FORBIDDEN', '代码文件路径越界');
      const content = await fs.readFile(target, 'utf8').catch(() => null);
      if (content === null) throw fail('RESOURCE_READ_FAILED', `无法读取代码文件：${relative}`);
      files.push({ path: relative, content: content.slice(0, 800_000) });
    }
    return { actionId, files, summary: `已读取用户指定的 ${files.length} 个代码文件；内容仍需人工确认。` };
  }
  if (actionId === 'softcopyright.consistency-check') {
    const facts = params.facts && typeof params.facts === 'object' ? params.facts : {};
    const values = ['softwareName', 'version', 'author'].map(key => [key, String(facts[key] || '').trim()]).filter(([, value]) => value);
    const mismatches = values.filter(([, value]) => value.length > 160).map(([key]) => `${key} 超出长度限制`);
    return { actionId, checks: values.map(([key, value]) => ({ field: key, status: mismatches.includes(`${key} 超出长度限制`) ? 'failed' : 'ready', value })), summary: mismatches.length ? mismatches.join('；') : '已完成字段格式初检，仍需对照真实材料人工确认。' };
  }
  if (actionId === 'softcopyright.docx-verify') {
    const relative = safeRelative(params.path);
    if (!relative || !relative.toLowerCase().endsWith('.docx')) throw fail('RESOURCE_PARAMS_INVALID', '只允许验证相对路径 DOCX 文件');
    const target = path.resolve(root, relative);
    if (!inside(root, target)) throw fail('RESOURCE_PATH_FORBIDDEN', '文档路径越界');
    const stat = await fs.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) throw fail('RESOURCE_READ_FAILED', 'DOCX 文件不存在');
    return { actionId, valid: stat.size > 0 && stat.size <= 20 * 1024 * 1024, summary: `已检查文件大小 ${stat.size} 字节；完整 DOCX 结构校验仍需调用已注册的验证工具。` };
  }
  throw fail('RESOURCE_ACTION_NOT_ALLOWED', '资源动作未注册');
}

function runProcess({ command, args, cwd, input, timeoutMs, maxOutputBytes, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = ''; let stderr = ''; let bytes = 0; let settled = false;
    const timer = setTimeout(() => { child.kill(); reject(fail('RESOURCE_TIMEOUT', '资源脚本执行超时')); }, timeoutMs);
    const append = (target, chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > maxOutputBytes) { child.kill(); throw fail('RESOURCE_OUTPUT_TOO_LARGE', '资源脚本输出超过上限'); } return target + chunk; };
    child.stdout?.on('data', chunk => { try { stdout = append(stdout, chunk.toString()); } catch (error) { if (!settled) { settled = true; clearTimeout(timer); reject(error); } } });
    child.stderr?.on('data', chunk => { try { stderr = append(stderr, chunk.toString()); } catch (error) { if (!settled) { settled = true; clearTimeout(timer); reject(error); } } });
    child.on('error', error => { if (settled) return; settled = true; clearTimeout(timer); reject(fail('RESOURCE_EXEC_FAILED', error.message)); });
    child.on('close', code => { if (settled) return; settled = true; clearTimeout(timer); if (code !== 0) return reject(fail('RESOURCE_EXEC_FAILED', stderr.slice(0, 1000) || `脚本退出码 ${code}`)); resolve({ stdout, stderr }); });
    if (child.stdin) { child.stdin.end(JSON.stringify(input || {})); }
  });
}

function createWritingResourceRunner({ resources = [], resourceRoots = {}, resourceArchives = {}, spawnImpl = spawn, pythonCommand = 'python' } = {}) {
  const byAction = new Map(resources.filter(item => item?.kind === 'script' && item.actionId).map(item => [item.actionId, item]));
  const byResource = new Map(resources.filter(item => item?.id).map(item => [item.id, item]));
  async function read({ resourceId, relativePath, limit = MAX_RESOURCE_READ_BYTES } = {}) {
    const resource = byResource.get(String(resourceId || ''));
    if (!resource || !resource.enabled) throw fail('RESOURCE_NOT_AVAILABLE', '资源未注册或已禁用');
    if (relativePath && relativePath !== resource.relativePath) throw fail('RESOURCE_PATH_FORBIDDEN', '资源路径与注册信息不匹配');
    const root = resourceArchives[resource.archive];
    if (!root || !path.isAbsolute(root)) throw fail('RESOURCE_ARCHIVE_UNAVAILABLE', '资源归档未配置或不可用');
    return { status: 'used', resourceId: resource.id, ...(await readResourceFile(root, resource.relativePath, limit)) };
  }
  async function execute({ actionId, resourceId, rootId, params = {}, mode = 'builtin' } = {}) {
    const resource = byAction.get(String(actionId || ''));
    if (!resource || (resourceId && resource.id !== resourceId)) throw fail('RESOURCE_ACTION_NOT_ALLOWED', '资源动作未注册或资源不匹配');
    const root = resourceRoots[rootId || resource.allowedRoots?.[0]];
    if (!root || !path.isAbsolute(root)) throw fail('RESOURCE_ROOT_NOT_AUTHORIZED', '没有授权的项目根目录');
    const safeParams = validateParams(params, resource.inputSchema || {});
    if (mode === 'python') {
      const scriptPath = path.resolve(root, resource.relativePath);
      if (!inside(root, scriptPath) || !scriptPath.toLowerCase().endsWith('.py')) throw fail('RESOURCE_PATH_FORBIDDEN', '脚本路径不在授权资源根目录内');
      const result = await runProcess({ command: pythonCommand, args: [scriptPath], cwd: root, input: safeParams,
        timeoutMs: resource.timeoutMs || DEFAULT_TIMEOUT_MS, maxOutputBytes: resource.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES, spawnImpl });
      return { status: 'executed', actionId, resourceId: resource.id, output: result.stdout.slice(0, resource.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES), outputSummary: result.stderr.slice(0, 1000) };
    }
    const result = await runBuiltin(actionId, root, safeParams);
    return { status: 'executed', actionId, resourceId: resource.id, output: result, outputSummary: result.summary || '受控动作已完成' };
  }
  return { execute, read, validateParams, safeRelative };
}

module.exports = { createWritingResourceRunner, validateParams, safeRelative, readResourceFile, runProcess, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_OUTPUT_BYTES, MAX_RESOURCE_READ_BYTES };
