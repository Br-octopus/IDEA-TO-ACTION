const { createHash, randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const zlib = require('node:zlib');
const defaultRegistry = require(path.join(__dirname, '..', 'server', 'social-source-registry.js'));

const MAX_PROTOCOL_LINE_BYTES = 1024 * 1024;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 4096;
const SUPERVISOR_CONTROL_PREFIX = 'SOCIAL_SOURCE_SUPERVISOR:';
const SUPERVISOR_CLEANUP_TIMEOUT_MS = 15_000;
const JOB_NAME_PREFIX = 'Local\\SocialSourceJob-';
const MAX_RETAINED_PREVIOUS_VERSIONS = 1;
const AUTOMATIC_FALLBACK_CODES = new Set([
  'PROTOCOL_INCOMPATIBLE', 'STARTUP_SELF_CHECK_FAILED'
]);
const RUNTIME_AUTOMATIC_FALLBACK_CODES = new Set([
  'PROTOCOL_ERROR', 'VERSION_INCOMPATIBLE', 'PROTOCOL_INCOMPATIBLE', 'STARTUP_SELF_CHECK_FAILED'
]);
const ALLOWED_ERROR_CODES = new Set([
  'RUNTIME_MISSING', 'RUNTIME_INSTALL_FAILED', 'DEPENDENCY_ERROR', 'LOCK_MISMATCH', 'SOURCE_MISSING',
  'BROWSER_MISSING', 'PROTOCOL_ERROR', 'LOGIN_EXPIRED', 'RATE_LIMITED', 'MANUAL_VERIFICATION_REQUIRED',
  'TIMEOUT', 'CANCELLED', 'BUDGET_EXCEEDED', 'CONTENT_NOT_FOUND', 'INVALID_RESPONSE', 'REQUEST_FAILED',
  'IP_BLOCKED', 'ACCOUNT_RESTRICTED', 'PROCESS_CRASHED', 'SESSION_BUSY', 'UNSUPPORTED_SOURCE',
  'INVALID_REQUEST', 'JOB_COLLISION', 'SOURCE_STATE_WRITE_FAILED', 'VERSION_NOT_APPROVED',
  'VERSION_NOT_PREPARED', 'VERSION_PACKAGE_INVALID', 'VERSION_PACKAGE_MISSING', 'VERSION_LOCK_MISMATCH',
  'VERSION_STATE_WRITE_FAILED', 'VERSION_INCOMPATIBLE', 'PROTOCOL_INCOMPATIBLE',
  'STARTUP_SELF_CHECK_FAILED', ...defaultRegistry.SOCIAL_SOURCE_ERROR_CODES
]);

const ERROR_MESSAGES = Object.freeze({
  RUNTIME_MISSING: '专用 Python 运行时尚未准备完成。',
  RUNTIME_INSTALL_FAILED: '专用 Python 运行时准备失败，可重试。',
  DEPENDENCY_ERROR: '来源依赖安装失败，可重试。',
  LOCK_MISMATCH: '来源依赖锁与登记摘要不匹配。',
  SOURCE_MISSING: '应用中缺少已登记的来源文件。',
  BROWSER_MISSING: '来源专用浏览器尚未安装。',
  PROTOCOL_ERROR: '本地采集进程返回了无效协议数据。',
  LOGIN_EXPIRED: '该平台来源 profile 尚未登录或登录已过期。',
  RATE_LIMITED: '平台暂时限流，请稍后再试。',
  MANUAL_VERIFICATION_REQUIRED: '平台要求用户完成安全验证。',
  TIMEOUT: '采集动作已超时。',
  CANCELLED: '采集动作已取消。',
  BUDGET_EXCEEDED: '采集动作达到请求或内容预算上限。',
  CONTENT_NOT_FOUND: '平台未找到指定内容。',
  INVALID_RESPONSE: '平台返回的数据格式无效，请稍后重试。',
  REQUEST_FAILED: '本地采集请求失败。',
  IP_BLOCKED: '平台拒绝了当前网络来源的访问，请稍后重试。',
  ACCOUNT_RESTRICTED: '平台限制了当前账号访问，请检查账号状态或稍后重试。',
  PROCESS_CRASHED: '本地采集进程意外退出。',
  SESSION_BUSY: '该来源环境或平台 profile 已有操作运行。',
  JOB_COLLISION: '来源进程隔离名称冲突，未启动采集进程，请重试。',
  UNSUPPORTED_SOURCE: '未登记的采集来源。',
  INVALID_REQUEST: '来源请求参数无效。',
  SOURCE_STATE_WRITE_FAILED: '来源准备状态无法安全写入本机；为避免无法恢复，已停止准备。',
  VERSION_NOT_APPROVED: '该来源版本未由当前应用登记批准。',
  VERSION_NOT_PREPARED: '候选版本尚未准备并通过自检。',
  VERSION_PACKAGE_INVALID: '应用内候选来源快照或摘要校验失败。',
  VERSION_PACKAGE_MISSING: '应用安装包缺少已登记的候选来源快照。',
  VERSION_LOCK_MISMATCH: '候选版本依赖锁与应用登记摘要不匹配。',
  VERSION_STATE_WRITE_FAILED: '来源版本状态无法安全保存；当前生效版本保持不变。',
  VERSION_INCOMPATIBLE: '候选版本与当前应用的版本或能力契约不兼容。',
  PROTOCOL_INCOMPATIBLE: '候选来源协议与当前应用不兼容。',
  STARTUP_SELF_CHECK_FAILED: '候选来源启动自检失败；当前生效版本保持不变。',
  ...defaultRegistry.SOCIAL_SOURCE_ERROR_MESSAGES
});

function codedError(code, message = ERROR_MESSAGES[code] || ERROR_MESSAGES.REQUEST_FAILED) {
  return Object.assign(new Error(message), { code });
}

function jobNameForCapability(capability) {
  const digest = createHash('sha256').update(capability, 'utf8').digest('hex');
  return JOB_NAME_PREFIX + digest;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isVersionId(value) {
  return typeof value === 'string'
    && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')
    || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  const parts = value.split('/');
  return parts.every(part => part && part !== '.' && part !== '..');
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function exactObject(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every(key => keys.includes(key));
}

function cleanDiagnostic(value) {
  return String(value || '')
    .replace(/\b(set-cookie|cookie)\s*[:=][^\r\n]*/gi, '$1: [redacted]')
    .replace(/\b(authorization|proxy-authorization)(\s*[:=]\s*)(?:(bearer|basic|token)\s+)?[^\r\n]*/gi,
      (_match, header, separator, scheme) => `${header}${separator}${scheme ? `${scheme} ` : ''}[redacted]`)
    .replace(/\b(sessdata|bili_jct|dedeuserid(?:__ckmd5)?|sid|ac[_-]?time[_-]?value|refresh[_-]?token|access[_-]?token|token|password|secret|api[_-]?key|access[_-]?key|xsec[_-]?token)(["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gi, '$1$2[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, MAX_STDERR_BYTES);
}

function extractUvExecutable(archive, destinationDirectory, fsImpl = fs) {
  const endSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65557); offset -= 1) {
    if (archive.readUInt32LE(offset) === endSignature) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw codedError('RUNTIME_INSTALL_FAILED');
  const entries = archive.readUInt16LE(endOffset + 10);
  let cursor = archive.readUInt32LE(endOffset + 16);
  let selected;
  for (let index = 0; index < entries; index += 1) {
    if (archive.readUInt32LE(cursor) !== centralSignature) throw codedError('RUNTIME_INSTALL_FAILED');
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    if (name === 'uv.exe' || name.endsWith('/uv.exe')) {
      if (selected) throw codedError('RUNTIME_INSTALL_FAILED');
      selected = { method, compressedSize, uncompressedSize, localOffset };
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!selected || selected.uncompressedSize > 64 * 1024 * 1024
    || archive.readUInt32LE(selected.localOffset) !== localSignature) throw codedError('RUNTIME_INSTALL_FAILED');
  const nameLength = archive.readUInt16LE(selected.localOffset + 26);
  const extraLength = archive.readUInt16LE(selected.localOffset + 28);
  const dataOffset = selected.localOffset + 30 + nameLength + extraLength;
  const compressed = archive.subarray(dataOffset, dataOffset + selected.compressedSize);
  let executable;
  if (selected.method === 0) executable = Buffer.from(compressed);
  else if (selected.method === 8) executable = zlib.inflateRawSync(compressed);
  else throw codedError('RUNTIME_INSTALL_FAILED');
  if (executable.length !== selected.uncompressedSize) throw codedError('RUNTIME_INSTALL_FAILED');

  fsImpl.mkdirSync(destinationDirectory, { recursive: true });
  const executablePath = path.join(destinationDirectory, 'uv.exe');
  const temporaryPath = path.join(destinationDirectory, `.uv.exe-${process.pid}-${randomUUID()}.tmp`);
  try {
    fsImpl.writeFileSync(temporaryPath, executable, { flag: 'wx', mode: 0o700 });
    if (fsImpl.statSync(temporaryPath).size !== executable.length) throw codedError('RUNTIME_INSTALL_FAILED');
    fsImpl.renameSync(temporaryPath, executablePath);
    return executablePath;
  } catch {
    try { fsImpl.unlinkSync(temporaryPath); } catch {}
    throw codedError('RUNTIME_INSTALL_FAILED');
  }
}

function downloadUvArchive(url, {
  maxBytes = 64 * 1024 * 1024,
  connectTimeoutMs = 15_000,
  totalTimeoutMs = 120_000,
  signal,
  httpsGet
} = {}) {
  const requestUrl = httpsGet || require('node:https').get;
  return new Promise((resolve, reject) => {
    let redirects = 0;
    let settled = false;
    let currentRequest;
    let connectionTimer;
    const totalTimer = setTimeout(() => {
      const error = codedError('TIMEOUT');
      try { currentRequest?.destroy(error); } catch {}
      finish(error);
    }, totalTimeoutMs);
    const clearConnectionTimer = () => {
      if (connectionTimer) clearTimeout(connectionTimer);
      connectionTimer = null;
    };
    const cleanup = () => {
      clearTimeout(totalTimer);
      clearConnectionTimer();
      signal?.removeEventListener('abort', abort);
    };
    const finish = (error, archive) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(archive);
    };
    const abort = () => {
      const error = codedError('CANCELLED');
      try { currentRequest?.destroy(error); } catch {}
      finish(error);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const read = currentUrl => {
      if (settled) return;
      if (signal?.aborted) { abort(); return; }
      let parsed;
      try { parsed = new URL(currentUrl); }
      catch { finish(codedError('RUNTIME_INSTALL_FAILED')); return; }
      if (parsed.protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com'].includes(parsed.hostname)) {
        finish(codedError('RUNTIME_INSTALL_FAILED'));
        return;
      }
      connectionTimer = setTimeout(() => {
        const error = codedError('TIMEOUT');
        try { currentRequest?.destroy(error); } catch {}
        finish(error);
      }, connectTimeoutMs);
      let request;
      try {
        request = requestUrl(parsed, { headers: { 'User-Agent': 'ForwardStep-social-source' } }, response => {
          clearConnectionTimer();
          if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
            response.resume();
            if (redirects >= 3) { finish(codedError('RUNTIME_INSTALL_FAILED')); return; }
            redirects += 1;
            let redirectUrl;
            try { redirectUrl = new URL(response.headers.location, parsed).href; }
            catch { finish(codedError('RUNTIME_INSTALL_FAILED')); return; }
            read(redirectUrl);
            return;
          }
          if (response.statusCode !== 200) {
            response.resume();
            finish(codedError('RUNTIME_INSTALL_FAILED'));
            return;
          }
          const chunks = [];
          let size = 0;
          response.on('data', chunk => {
            size += chunk.length;
            if (size > maxBytes) {
              const error = codedError('RUNTIME_INSTALL_FAILED');
              try { request.destroy(error); } catch {}
              finish(error);
              return;
            }
            chunks.push(chunk);
          });
          response.once('end', () => finish(null, Buffer.concat(chunks, size)));
          response.once('aborted', () => finish(codedError('RUNTIME_INSTALL_FAILED')));
          response.once('error', () => finish(codedError('RUNTIME_INSTALL_FAILED')));
        });
      } catch {
        clearConnectionTimer();
        finish(codedError('RUNTIME_INSTALL_FAILED'));
        return;
      }
      currentRequest = request;
      request.once('socket', socket => {
        if (socket?.connecting) socket.once('secureConnect', clearConnectionTimer);
        else clearConnectionTimer();
      });
      request.once('close', clearConnectionTimer);
      request.once('error', error => {
        clearConnectionTimer();
        if (error?.code === 'CANCELLED' || error?.code === 'TIMEOUT') finish(error);
        else if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error?.code)) finish(codedError('TIMEOUT'));
        else finish(codedError('RUNTIME_INSTALL_FAILED'));
      });
    };
    if (signal?.aborted) { abort(); return; }
    read(url);
  });
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = (options.spawnProcess || spawn)(executable, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        detached: options.processPlatform !== 'win32' && process.platform !== 'win32',
        stdio: [typeof options.input === 'string' ? 'pipe' : 'ignore', 'pipe', 'pipe']
      });
    } catch {
      reject(codedError(options.failureCode || 'DEPENDENCY_ERROR'));
      return;
    }
    const output = { stdout: '', stderr: '' };
    const keep = (key, chunk, limit) => {
      if (Buffer.byteLength(output[key]) >= limit) return;
      const remaining = limit - Buffer.byteLength(output[key]);
      output[key] += Buffer.from(chunk).subarray(0, remaining).toString('utf8');
    };
    child.stdout?.on('data', chunk => keep('stdout', chunk, 1024 * 1024));
    child.stderr?.on('data', chunk => keep('stderr', chunk, MAX_STDERR_BYTES));
    try { options.onChild?.(child); } catch {}
    let timedOut = false;
    let cancelled = false;
    let processError = false;
    let timer = null;
    const terminate = options.terminateProcessTree
      || (target => killOwnedProcessTree(target, options.processPlatform || process.platform, options.onChild));
    const abort = () => {
      if (child.exitCode != null || child.signalCode != null) return;
      cancelled = true;
      Promise.resolve(terminate(child)).catch(() => {
        try { child.kill(); } catch {}
      });
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        if (child.exitCode != null || child.signalCode != null) return;
        timedOut = true;
        Promise.resolve(terminate(child)).catch(() => {
          try { child.kill(); } catch {}
        });
      }, options.timeoutMs);
    }
    child.once('error', () => { processError = true; });
    child.once('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (processError && code == null && !cancelled && !timedOut) {
        reject(codedError(options.failureCode || 'DEPENDENCY_ERROR'));
      } else {
        resolve({ code, signal, stdout: output.stdout, stderr: cleanDiagnostic(output.stderr), timedOut, cancelled });
      }
    });
    if (typeof options.input === 'string') {
      child.stdin?.on('error', () => {});
      child.stdin?.end(options.input);
    }
  });
}

async function killOwnedProcessTree(child, processPlatform = process.platform, onChild = () => {}) {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return;
  if (processPlatform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    const taskkill = path.join(systemRoot, 'System32', 'taskkill.exe');
    await new Promise(resolve => {
      let killer;
      try {
        killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
          shell: false, windowsHide: true, stdio: 'ignore'
        });
      } catch {
        try { child.kill(); } catch {}
        resolve();
        return;
      }
      try { onChild(killer); } catch {}
      let timer = setTimeout(() => {
        try { killer.kill(); } catch {}
      }, 5000);
      const done = code => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (code !== 0 && child.exitCode == null && child.signalCode == null) {
          try { child.kill(); } catch {}
        }
        resolve();
      };
      killer.once('error', () => done(1));
      killer.once('close', done);
    });
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch { try { child.kill('SIGKILL'); } catch {} }
}

function makeUserEnvironment(paths, profileId, profileDirectory, mode) {
  const env = {
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONNOUSERSITE: '1',
    PLAYWRIGHT_BROWSERS_PATH: paths.browsersDirectory,
    SOCIAL_SOURCE_ROOT: paths.rootDirectory,
    SOCIAL_SOURCE_PROFILE_ID: profileId,
    SOCIAL_SOURCE_PROFILE_DIR: profileDirectory,
    SOCIAL_SOURCE_PLATFORM: paths.platform || '',
    SOCIAL_SOURCE_MODE: mode,
    TEMP: paths.tempDirectory,
    TMP: paths.tempDirectory
  };
  for (const name of ['SystemRoot', 'WINDIR']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

function validatePublicAction(value) {
  const keys = ['sourceId', 'action', 'capability', 'platform', 'profileId', 'taskId', 'contentId', 'budget'];
  if (!exactObject(value, keys)) throw codedError('INVALID_REQUEST');
  return value;
}

function validateProfileRequest(value, keys) {
  if (!exactObject(value, keys)) throw codedError('INVALID_REQUEST');
  const source = defaultRegistry.getSocialSource(value.sourceId);
  if (!source.platforms.includes(value.platform)
    || typeof value.profileId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value.profileId)) {
    throw codedError('INVALID_REQUEST');
  }
  return source;
}

function readJsonl(child, onMessage, onProtocolError) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let totalBytes = 0;
  let stopped = false;
  const fail = () => {
    if (stopped) return;
    stopped = true;
    onProtocolError();
  };
  child.stdout.on('data', chunk => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_STDOUT_BYTES) { fail(); return; }
    buffer += decoder.write(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_PROTOCOL_LINE_BYTES) { fail(); return; }
      if (!line.trim()) continue;
      try { onMessage(JSON.parse(line)); }
      catch { fail(); return; }
      if (stopped) return;
    }
    if (Buffer.byteLength(buffer) > MAX_PROTOCOL_LINE_BYTES) fail();
  });
  child.stdout.on('end', () => {
    buffer += decoder.end();
    if (buffer.trim()) fail();
  });
  return () => { stopped = true; };
}

function createSocialSourceManager({
  app,
  resourcesPath,
  registry = defaultRegistry,
  spawnProcess = spawn,
  runCommand = runProcess,
  downloadUvArchive: downloadArchive = downloadUvArchive,
  extractUvExecutable: extractExecutable = (archive, directory) => extractUvExecutable(archive, directory),
  killProcessTree,
  processPlatform = process.platform,
  processArchitecture = process.arch,
  superviseWindowsProcesses = processPlatform === 'win32',
  now = Date.now,
  schedule = setTimeout,
  unschedule = clearTimeout,
  isSourcePrepared,
  prepareCandidateRuntime,
  candidateSelfCheck
} = {}) {
  if (!app || typeof app.getPath !== 'function' || typeof app.getAppPath !== 'function') {
    throw new TypeError('app.getPath/getAppPath are required');
  }

  const userDataPath = path.resolve(app.getPath('userData'));
  const appRoot = path.resolve(app.isPackaged && typeof resourcesPath === 'string'
    ? resourcesPath : app.getAppPath());
  const baseDirectory = path.join(userDataPath, 'social-source');
  const prepareStateDirectory = path.join(baseDirectory, 'state');
  const activeActions = new Map();
  const loginProcesses = new Map();
  const activeLoginOperations = new Map();
  const profileLocks = new Map();
  const orphanJobs = new Map();
  const loginStopCodes = new WeakMap();
  const ownedProcesses = new Set();
  const trackedProcesses = new WeakSet();
  const closedProcesses = new WeakSet();
  const processClosePromises = new WeakMap();
  const supervisorStates = new WeakMap();
  const activePreparations = new Set();
  const activePreparationSources = new Set();
  const activeVersionOperations = new Set();
  const activeResearchLeases = new Map();
  const diagnostics = [];
  let shuttingDown = false;

  function getSourceForVersion(sourceId, version) {
    if (typeof registry.getSocialSourceVersion === 'function') {
      return registry.getSocialSourceVersion(sourceId, version);
    }
    const current = registry.getSocialSource(sourceId);
    if (current.version === version) return current;
    const candidate = (registry.listApprovedSocialSourceCandidates?.(sourceId) || [])
      .find(item => (item.source || item).version === version);
    if (!candidate) throw codedError('VERSION_NOT_APPROVED');
    return candidate.source || candidate;
  }

  function getApprovedCandidates(sourceId) {
    return (registry.listApprovedSocialSourceCandidates?.(sourceId) || [])
      .map(item => item.source || item)
      .filter(source => source.packageArtifact);
  }

  function getApprovedCandidate(sourceId, versionId) {
    const approved = (registry.listApprovedSocialSourceCandidates?.(sourceId) || [])
      .find(item => (item.source || item).version === versionId);
    if (!approved) throw codedError('VERSION_NOT_APPROVED');
    const source = approved.source || approved;
    if (!source.packageArtifact) throw codedError('VERSION_PACKAGE_MISSING');
    return { source, artifact: source.packageArtifact };
  }

  function versionStatePath(sourceId) {
    return path.join(prepareStateDirectory, `${sourceId}-versions.json`);
  }

  function sanitizeVersionState(value, sourceId) {
    const hasPreparedVersions = exactObject(value, ['sourceId', 'activeVersion', 'previousVersions', 'preparedVersions']);
    const hasFirstRunVersion = exactObject(value, ['sourceId', 'activeVersion', 'previousVersions', 'preparedVersions', 'firstRunVersion']);
    if ((!hasPreparedVersions && !exactObject(value, ['sourceId', 'activeVersion', 'previousVersions']) && !hasFirstRunVersion)
      || value.sourceId !== sourceId || typeof value.activeVersion !== 'string'
      || !Array.isArray(value.previousVersions) || value.previousVersions.length > MAX_RETAINED_PREVIOUS_VERSIONS) return null;
    const firstRunVersion = hasFirstRunVersion ? value.firstRunVersion : null;
    if (firstRunVersion !== null && (typeof firstRunVersion !== 'string' || firstRunVersion !== value.activeVersion)) return null;
    try { getSourceForVersion(sourceId, value.activeVersion); }
    catch { return null; }
    const previousVersions = [];
    for (const version of value.previousVersions) {
      if (typeof version !== 'string' || version === value.activeVersion || previousVersions.includes(version)) return null;
      try { getSourceForVersion(sourceId, version); }
      catch { return null; }
      previousVersions.push(version);
    }
    const preparedVersions = [];
    if ((hasPreparedVersions || hasFirstRunVersion) && !Array.isArray(value.preparedVersions)) return null;
    for (const version of hasPreparedVersions || hasFirstRunVersion ? value.preparedVersions : []) {
      if (!isVersionId(version) || preparedVersions.includes(version)) return null;
      try { getSourceForVersion(sourceId, version); }
      catch { return null; }
      preparedVersions.push(version);
    }
    if (!preparedVersions.includes(value.activeVersion)) preparedVersions.push(value.activeVersion);
    for (const version of previousVersions) {
      if (!preparedVersions.includes(version)) preparedVersions.push(version);
    }
    return { sourceId, activeVersion: value.activeVersion, previousVersions, preparedVersions, firstRunVersion };
  }

  function readVersionState(sourceId) {
    const current = registry.getSocialSource(sourceId);
    try {
      const saved = sanitizeVersionState(JSON.parse(fs.readFileSync(versionStatePath(sourceId), 'utf8')), sourceId);
      if (saved) return saved;
    } catch {}
    return { sourceId, activeVersion: current.version, previousVersions: [], preparedVersions: [current.version], firstRunVersion: null };
  }

  function writeVersionState(state) {
    const safeState = sanitizeVersionState(state, state.sourceId);
    if (!safeState) throw codedError('VERSION_STATE_WRITE_FAILED');
    fs.mkdirSync(prepareStateDirectory, { recursive: true });
    const destination = versionStatePath(safeState.sourceId);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(safeState)}\n`, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, destination);
    } catch {
      try { fs.unlinkSync(temporary); } catch {}
      throw codedError('VERSION_STATE_WRITE_FAILED');
    }
    return safeState;
  }

  function getActiveSource(sourceId) {
    const current = registry.getSocialSource(sourceId);
    const activeVersion = readVersionState(sourceId).activeVersion;
    return activeVersion === current.version ? current : getSourceForVersion(sourceId, activeVersion);
  }

  function hasRunningSourceWork() {
    return activeActions.size > 0 || loginProcesses.size > 0 || activeLoginOperations.size > 0
      || activePreparations.size > 0 || profileLocks.size > 0 || activeVersionOperations.size > 0;
  }

  function sourceManagementBusy(sourceId) {
    return shuttingDown || activePreparationSources.has(sourceId) || activeVersionOperations.has(sourceId)
      || activeActions.size > 0 || loginProcesses.size > 0 || activeLoginOperations.size > 0
      || profileLocks.size > 0 || activePreparations.size > 0 || activeResearchLeases.size > 0;
  }

  function releaseResearchLease(senderId, leaseId) {
    const senderLeases = activeResearchLeases.get(senderId);
    const lease = senderLeases?.get(leaseId);
    if (!lease) return false;
    senderLeases.delete(leaseId);
    if (senderLeases.size === 0) {
      activeResearchLeases.delete(senderId);
      lease.sender.removeListener?.('destroyed', lease.releaseAll);
      lease.sender.removeListener?.('render-process-gone', lease.releaseAll);
    }
    return true;
  }

  function releaseSenderResearchLeases(senderId) {
    const senderLeases = activeResearchLeases.get(senderId);
    if (!senderLeases) return;
    for (const leaseId of senderLeases.keys()) releaseResearchLease(senderId, leaseId);
  }

  function beginResearchOperation(event) {
    const sender = event?.sender;
    if (!sender || !Number.isSafeInteger(sender.id) || sender.id < 0
      || sender.isDestroyed?.() === true) throw codedError('INVALID_REQUEST');
    if (shuttingDown || hasRunningSourceWork()) {
      throw codedError('SESSION_BUSY');
    }
    const leaseId = randomUUID();
    const release = () => releaseResearchLease(sender.id, leaseId);
    let senderLeases = activeResearchLeases.get(sender.id);
    let releaseAll = senderLeases?.values().next().value?.releaseAll;
    if (!senderLeases) {
      senderLeases = new Map();
      activeResearchLeases.set(sender.id, senderLeases);
      releaseAll = () => releaseSenderResearchLeases(sender.id);
      sender.once?.('destroyed', releaseAll);
      sender.once?.('render-process-gone', releaseAll);
    }
    senderLeases.set(leaseId, { sender, release, releaseAll });
    return { status: 'ok', leaseId };
  }

  function endResearchOperation(event, request) {
    const senderId = event?.sender?.id;
    if (!Number.isSafeInteger(senderId) || !exactObject(request, ['leaseId'])
      || typeof request.leaseId !== 'string' || !/^[0-9a-f-]{36}$/i.test(request.leaseId)
      || !activeResearchLeases.get(senderId)?.has(request.leaseId)
      || !releaseResearchLease(senderId, request.leaseId)) throw codedError('INVALID_REQUEST');
    return { status: 'ok' };
  }

  function resolveSourceFile(source, field) {
    const paths = getPaths(source);
    const packaged = Boolean(source.packageArtifact);
    const root = packaged ? path.join(paths.versionDirectory, 'source') : appRoot;
    const resolved = path.resolve(root, source[field]);
    if (!safeRelativePath(source[field]) || !isWithin(root, resolved)) {
      throw codedError(packaged ? 'VERSION_PACKAGE_INVALID' : 'SOURCE_MISSING');
    }
    return resolved;
  }

  function resolveSourceLock(source, versionDirectory) {
    const root = source.packageArtifact
      ? path.join(versionDirectory || getPaths(source).versionDirectory, 'source')
      : appRoot;
    const lockPath = path.resolve(root, source.requirementsLockPath);
    if (!safeRelativePath(source.requirementsLockPath) || !isWithin(root, lockPath)) {
      throw codedError(source.packageArtifact ? 'VERSION_PACKAGE_INVALID' : 'SOURCE_MISSING');
    }
    return lockPath;
  }

  function prepareStatePath(source) {
    return path.join(prepareStateDirectory, `${source.id}.json`);
  }

  function sanitizePrepareOperation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.sourceId !== 'string' || typeof value.version !== 'string'
      || typeof value.operationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.operationId)
      || typeof value.stage !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.stage)
      || !Number.isFinite(value.progress) || !['running', 'complete', 'error', 'interrupted'].includes(value.state)
      || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null;
    let source;
    try {
      source = getSourceForVersion(value.sourceId, value.version);
      if (value.sourceId !== source.id) return null;
    } catch { return null; }
    const errorCode = typeof value.code === 'string' && ALLOWED_ERROR_CODES.has(value.code) ? value.code : null;
    return {
      operationId: value.operationId,
      sourceId: source.id,
      version: source.version,
      stage: value.stage,
      progress: Math.max(0, Math.min(100, Math.round(value.progress))),
      state: value.state,
      code: errorCode,
      recoverable: value.recoverable === true,
      updatedAt: new Date(value.updatedAt).toISOString()
    };
  }

  function persistPrepareOperation(record) {
    const safeRecord = sanitizePrepareOperation(record);
    if (!safeRecord) throw codedError('SOURCE_STATE_WRITE_FAILED');
    fs.mkdirSync(prepareStateDirectory, { recursive: true });
    const destination = prepareStatePath({ id: safeRecord.sourceId });
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(safeRecord)}\n`, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, destination);
    } catch {
      try { fs.unlinkSync(temporary); } catch {}
      throw codedError('SOURCE_STATE_WRITE_FAILED');
    }
    return safeRecord;
  }

  function readPrepareOperation(source) {
    let record;
    try {
      record = sanitizePrepareOperation(JSON.parse(fs.readFileSync(prepareStatePath(source), 'utf8')));
    } catch { return null; }
    if (!record) return null;
    if (record.state === 'running' && !activePreparationSources.has(source.id)) {
      record.state = 'interrupted';
      record.recoverable = true;
      record.updatedAt = new Date(now()).toISOString();
      try { record = persistPrepareOperation(record); }
      catch { /* 内存中仍返回安全的中断状态；下次启动会再次识别旧记录。 */ }
    }
    return record;
  }

  function trackOwnedProcess(child) {
    if (!child || (typeof child !== 'object' && typeof child !== 'function')) return;
    ownedProcesses.add(child);
    if (trackedProcesses.has(child)) return;
    trackedProcesses.add(child);
    let resolveClosed;
    const closePromise = new Promise(resolve => { resolveClosed = resolve; });
    processClosePromises.set(child, closePromise);
    child.once?.('close', () => {
      closedProcesses.add(child);
      ownedProcesses.delete(child);
      resolveClosed();
    });
    child.once?.('error', () => ownedProcesses.delete(child));
  }

  function waitForLoginProcessClose(key, child) {
    if (loginProcesses.get(key) !== child) return Promise.resolve();
    return waitForProcessClose(child);
  }

  function waitForProcessClose(child) {
    if (!child || closedProcesses.has(child)) return Promise.resolve();
    const existing = processClosePromises.get(child);
    if (existing) return existing;
    return new Promise(resolve => {
      child.once?.('close', () => {
        closedProcesses.add(child);
        ownedProcesses.delete(child);
        resolve();
      });
    });
  }

  function makeWorkerLaunch(paths, entryPoint, mode) {
    if (!superviseWindowsProcesses) {
      return {
        executable: paths.pythonExecutable,
        args: mode === 'login' ? ['-u', entryPoint, '--open-login'] : ['-u', entryPoint],
        supervised: false
      };
    }
    if (processPlatform !== 'win32' || processArchitecture !== 'x64') throw codedError('RUNTIME_MISSING');
    const supervisorPath = path.resolve(appRoot, 'vendor', 'mediacrawler-bridge', 'windows_job_supervisor.py');
    if (!isWithin(appRoot, supervisorPath) || !fs.existsSync(supervisorPath)) throw codedError('SOURCE_MISSING');
    const nonce = randomUUID();
    const capability = randomBytes(32).toString('base64url');
    const jobName = jobNameForCapability(capability);
    return {
      executable: paths.pythonExecutable,
      args: ['-u', supervisorPath, '--python', paths.pythonExecutable, '--worker', entryPoint,
        '--mode', mode, '--cwd', appRoot],
      supervised: true,
      nonce,
      capability,
      jobName,
      supervisorPath,
      cleanupEnvironment: uvEnvironment(paths)
    };
  }

  function attachStderr(child, { nonce, jobName, onControlError = () => {} } = {}) {
    let pending = '';
    let diagnostic = '';
    let ended = false;
    const state = { nonce, jobName, required: Boolean(nonce), confirmed: false, collision: false, stopSent: false };
    supervisorStates.set(child, state);
    const addDiagnostic = value => {
      if (Buffer.byteLength(diagnostic) >= MAX_STDERR_BYTES) return;
      const remaining = MAX_STDERR_BYTES - Buffer.byteLength(diagnostic);
      diagnostic += Buffer.from(value).subarray(0, remaining).toString('utf8');
    };
    const consumeLine = line => {
      if (!nonce || !line.startsWith(SUPERVISOR_CONTROL_PREFIX)) {
        addDiagnostic(line + '\n');
        return;
      }
      try {
        const frame = JSON.parse(line.slice(SUPERVISOR_CONTROL_PREFIX.length));
        if (exactObject(frame, ['type', 'protocolVersion', 'nonce', 'activeProcesses'])
          && frame.type === 'tree-clean' && frame.protocolVersion === 1
          && frame.nonce === nonce && frame.activeProcesses === 0 && !state.collision) {
          state.confirmed = true;
          return;
        }
        if (exactObject(frame, ['type', 'protocolVersion', 'nonce', 'jobName'])
          && frame.type === 'job-collision' && frame.protocolVersion === 1
          && frame.nonce === nonce && frame.jobName === jobName && !state.confirmed) {
          state.collision = true;
          return;
        }
        throw new Error('invalid supervisor confirmation');
      } catch {
        addDiagnostic('[invalid supervisor control frame]\n');
        onControlError();
      }
    };
    const flush = () => {
      if (ended) return diagnostic;
      ended = true;
      if (pending) consumeLine(pending);
      pending = '';
      return diagnostic;
    };
    child.stderr?.on('data', chunk => {
      pending += Buffer.from(chunk).toString('utf8');
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        consumeLine(pending.slice(0, newline).replace(/\r$/, ''));
        pending = pending.slice(newline + 1);
      }
      if (Buffer.byteLength(pending) > MAX_STDERR_BYTES) {
        addDiagnostic(pending);
        pending = '';
      }
    });
    child.stderr?.on('end', flush);
    return { state, flush, getDiagnostic: () => diagnostic };
  }

  function writeSupervisorStart(child, launch, mode, request) {
    if (!launch.supervised) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
      return;
    }
    const frame = {
      type: 'start', protocolVersion: 1, nonce: launch.nonce,
      capability: launch.capability, jobName: launch.jobName, mode
    };
    if (mode === 'action') frame.request = request;
    child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  function requestSupervisorStop(child) {
    const state = supervisorStates.get(child);
    if (!state?.required || closedProcesses.has(child)) return;
    if (!state.stopSent) {
      state.stopSent = true;
      try { child.stdin.write(`${JSON.stringify({ type: 'stop', nonce: state.nonce })}\n`); }
      catch { /* close/timeout path below still enforces fail-closed behavior */ }
    }
  }

  async function stopManagedProcess(child) {
    if (!child || closedProcesses.has(child)) return;
    const state = supervisorStates.get(child);
    if (!state?.required) {
      await terminateProcessTree(child);
      await waitForProcessClose(child);
      return;
    }
    let cleanupTimer;
    const close = waitForProcessClose(child);
    const fallback = new Promise(resolve => {
      cleanupTimer = setTimeout(async () => {
        try { await terminateProcessTree(child); }
        catch { try { child.kill(); } catch {} }
        resolve();
      }, SUPERVISOR_CLEANUP_TIMEOUT_MS);
    });
    requestSupervisorStop(child);
    await Promise.race([close, fallback]);
    if (cleanupTimer) clearTimeout(cleanupTimer);
    await waitForProcessClose(child);
  }

  const terminateProcessTree = killProcessTree
    || (child => killOwnedProcessTree(child, processPlatform, trackOwnedProcess));

  function validateJobCleanupFrame(result, launch) {
    if (!result || result.code !== 0 || result.timedOut || result.cancelled
      || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > 4096) return false;
    let frame;
    try { frame = JSON.parse(result.stdout.trim()); }
    catch { return false; }
    return exactObject(frame, [
      'type', 'protocolVersion', 'nonce', 'jobName', 'jobFound', 'activeProcesses', 'jobClosed'
    ]) && frame.type === 'job-cleanup' && frame.protocolVersion === 1
      && frame.nonce === launch.nonce && frame.jobName === launch.jobName
      && typeof frame.jobFound === 'boolean' && Number.isInteger(frame.activeProcesses)
      && frame.activeProcesses === 0 && frame.jobClosed === true;
  }

  function startOrphanRecovery(record) {
    if (record.recoveryPromise) return record.recoveryPromise;
    const launch = record.launch;
    const expectedSupervisor = path.resolve(appRoot, 'vendor', 'mediacrawler-bridge', 'windows_job_supervisor.py');
    if (!launch?.supervised || !/^[A-Za-z0-9_-]{16,64}$/.test(launch.nonce || '')
      || !/^[A-Za-z0-9_-]{43}$/.test(launch.capability || '')
      || launch.jobName !== jobNameForCapability(launch.capability)
      || path.resolve(launch.supervisorPath || '') !== expectedSupervisor
      || !isWithin(appRoot, expectedSupervisor) || !fs.existsSync(expectedSupervisor)
      || !isWithin(baseDirectory, path.resolve(launch.executable || ''))) {
      record.recoveryAttempts = (record.recoveryAttempts || 0) + 1;
      record.lastRecoveryResult = false;
      return Promise.resolve(false);
    }
    const args = ['-u', expectedSupervisor, '--cleanup'];
    const input = `${JSON.stringify({
      type: 'cleanup', protocolVersion: 1, nonce: launch.nonce,
      capability: launch.capability, jobName: launch.jobName
    })}\n`;
    record.recoveryAttempts = (record.recoveryAttempts || 0) + 1;
    const recovery = (async () => {
      let result;
      try {
        result = await runCommand(launch.executable, args, {
          cwd: appRoot,
          env: launch.cleanupEnvironment,
          input,
          timeoutMs: SUPERVISOR_CLEANUP_TIMEOUT_MS,
          failureCode: 'PROCESS_CRASHED',
          processPlatform,
          terminateProcessTree,
          onChild: child => trackOwnedProcess(child)
        });
      } catch {
        return false;
      }
      if (result?.stderr) {
        diagnostics.push(cleanDiagnostic(result.stderr));
        while (diagnostics.length > 20) diagnostics.shift();
      }
      if (!validateJobCleanupFrame(result, launch)) return false;
      if (orphanJobs.get(record.key) !== record) return false;
      record.reservation.release();
      orphanJobs.delete(record.key);
      return true;
    })();
    const wrappedRecovery = recovery.then(result => {
      record.lastRecoveryResult = result;
      return result;
    }, () => {
      record.lastRecoveryResult = false;
      return false;
    }).finally(() => {
      if (record.recoveryPromise === wrappedRecovery) record.recoveryPromise = null;
    });
    record.recoveryPromise = wrappedRecovery;
    return wrappedRecovery;
  }

  function registerOrphanJob(reservation, launch) {
    if (!launch?.supervised) return null;
    let record = orphanJobs.get(reservation.key);
    if (!record) {
      record = {
        key: reservation.key,
        reservation,
        launch: {
          ...launch,
          cleanupEnvironment: launch.cleanupEnvironment
        },
        recoveryPromise: null,
        recoveryAttempts: 0,
        lastRecoveryResult: null
      };
      orphanJobs.set(reservation.key, record);
    }
    startOrphanRecovery(record);
    return record;
  }

  function reserveProfile(platform, profileId, sourceId) {
    if (shuttingDown) return { error: codedError('CANCELLED') };
    if (activePreparationSources.has(sourceId) || activeVersionOperations.has(sourceId)) return { error: codedError('SESSION_BUSY') };
    const key = platform + ':' + profileId;
    if (profileLocks.has(key)) return { error: codedError('SESSION_BUSY') };
    const token = { sourceId };
    profileLocks.set(key, token);
    return {
      key,
      release() {
        if (profileLocks.get(key) === token) profileLocks.delete(key);
      }
    };
  }

  function assertRunning() {
    if (shuttingDown) throw codedError('CANCELLED');
  }

  function getPaths(source, platform, versionDirectoryOverride) {
    const runtimeDirectory = path.join(baseDirectory, 'runtime');
    const versionDirectory = versionDirectoryOverride
      ? path.resolve(versionDirectoryOverride)
      : path.join(baseDirectory, 'sources', source.id, source.version);
    if (!isWithin(path.resolve(baseDirectory, 'sources', source.id), versionDirectory)) {
      throw codedError(source.packageArtifact ? 'VERSION_PACKAGE_INVALID' : 'INVALID_REQUEST');
    }
    const pythonEnvironmentDirectory = path.join(versionDirectory, 'venv');
    const pythonExecutable = processPlatform === 'win32'
      ? path.join(pythonEnvironmentDirectory, 'Scripts', 'python.exe')
      : path.join(pythonEnvironmentDirectory, 'bin', 'python');
    return {
      rootDirectory: baseDirectory,
      runtimeDirectory,
      uvDirectory: path.join(runtimeDirectory, 'uv', source.uvInstaller.version),
      uvExecutable: path.join(runtimeDirectory, 'uv', source.uvInstaller.version, processPlatform === 'win32' ? 'uv.exe' : 'uv'),
      pythonInstallDirectory: path.join(runtimeDirectory, 'python'),
      uvCacheDirectory: path.join(baseDirectory, 'cache', 'uv'),
      tempDirectory: path.join(baseDirectory, 'tmp'),
      versionDirectory,
      pythonEnvironmentDirectory,
      pythonExecutable,
      browsersDirectory: source.packageArtifact
        ? path.join(versionDirectory, 'browsers')
        : path.join(baseDirectory, source.browserAutomation.installDirectory.replace(/^social-source[\\/]/, '')),
      profilesDirectory: path.join(baseDirectory, 'profiles'),
      platform
    };
  }

  function getProfileDirectory(platform, profileId) {
    const source = getActiveSource('mediacrawler-lite');
    if (!source.platforms.includes(platform) || typeof profileId !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profileId)) throw codedError('INVALID_REQUEST');
    const profileDirectory = path.resolve(baseDirectory, 'profiles', platform, profileId);
    if (!isWithin(baseDirectory, profileDirectory)) throw codedError('INVALID_REQUEST');
    return profileDirectory;
  }

  function uvEnvironment(paths) {
    return {
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      UV_PYTHON_INSTALL_DIR: paths.pythonInstallDirectory,
      UV_CACHE_DIR: paths.uvCacheDirectory,
      UV_PYTHON_PREFERENCE: 'only-managed',
      UV_NO_CONFIG: '1',
      TEMP: paths.tempDirectory,
      TMP: paths.tempDirectory,
      ...(['SystemRoot', 'WINDIR'].reduce((values, key) => {
        if (process.env[key]) values[key] = process.env[key];
        return values;
      }, {}))
    };
  }

  async function runChecked(executable, args, options, failureCode) {
    assertRunning();
    if (options.signal?.aborted) throw codedError('CANCELLED');
    let result;
    const { recordDiagnostics = true, ...runOptions } = options;
    try {
      result = await runCommand(executable, args, {
        ...runOptions,
        failureCode,
        processPlatform,
        terminateProcessTree,
        onChild: child => {
          trackOwnedProcess(child);
          try { options.onChild?.(child); } catch {}
        }
      });
    }
    catch (error) { throw codedError(error?.code && ALLOWED_ERROR_CODES.has(error.code) ? error.code : failureCode); }
    if (recordDiagnostics && result?.stderr) {
      diagnostics.push(cleanDiagnostic(result.stderr));
      while (diagnostics.length > 20) diagnostics.shift();
    }
    if (options.signal?.aborted || result?.cancelled) throw codedError('CANCELLED');
    assertRunning();
    if (result?.timedOut) throw codedError('TIMEOUT');
    if (!result || result.code !== 0) throw codedError(failureCode);
    return result;
  }

  async function checkEnvironment(sourceId, { signal } = {}) {
    const source = getActiveSource(sourceId);
    const paths = getPaths(source);
    const hasInstallationArtifacts = [paths.uvExecutable, paths.pythonExecutable, paths.versionDirectory,
      paths.pythonInstallDirectory, paths.browsersDirectory].some(target => fs.existsSync(target));
    const response = {
      status: 'not-ready', sourceId, version: source.version, userDataPath, targets: paths,
      installationState: hasInstallationArtifacts ? 'partial' : 'not-installed',
      running: activeActions.size > 0 || loginProcesses.size > 0,
      lastPrepareOperation: readPrepareOperation(source)
    };
    if (processPlatform !== 'win32' || processArchitecture !== 'x64') {
      return { ...response, code: 'RUNTIME_MISSING' };
    }
    const lockPath = resolveSourceLock(source);
    if (!fs.existsSync(lockPath)) {
      return { ...response, code: 'SOURCE_MISSING' };
    }
    let lockDigest;
    try { lockDigest = sha256(fs.readFileSync(lockPath)); }
    catch { return { ...response, code: 'DEPENDENCY_ERROR' }; }
    if (lockDigest !== source.requirementsLockSha256) return { ...response, status: 'error', code: 'LOCK_MISMATCH' };
    if (!fs.existsSync(paths.uvExecutable)) return { ...response, code: 'RUNTIME_MISSING' };
    if (!fs.existsSync(paths.pythonExecutable)) return { ...response, code: 'DEPENDENCY_ERROR' };
    if (!fs.existsSync(paths.browsersDirectory) || fs.readdirSync(paths.browsersDirectory).length === 0) {
      return { ...response, code: 'BROWSER_MISSING' };
    }
    const env = { ...uvEnvironment(paths), PLAYWRIGHT_BROWSERS_PATH: paths.browsersDirectory };
    try {
      const version = await runChecked(paths.pythonExecutable, ['--version'], { cwd: appRoot, env, timeoutMs: 5000, signal }, 'RUNTIME_MISSING');
      if (!/^Python 3\.11\./.test(version.stdout.trim())) return { ...response, status: 'error', code: 'RUNTIME_MISSING' };
      await runChecked(paths.uvExecutable, ['pip', 'check', '--python', paths.pythonExecutable], {
        cwd: appRoot, env, timeoutMs: 30_000, signal
      }, 'DEPENDENCY_ERROR');
      const details = await runChecked(paths.pythonExecutable, ['-c',
        'import importlib.metadata as m, json, sys; from playwright.sync_api import sync_playwright; p=sync_playwright().start(); executable=p.chromium.executable_path; p.stop(); print(json.dumps({"basePrefix": sys.base_prefix, "playwright": m.version("playwright"), "chromiumExecutable": executable}))'], {
        cwd: appRoot, env, timeoutMs: 10_000, signal
      }, 'DEPENDENCY_ERROR');
      let runtime;
      try { runtime = JSON.parse(details.stdout.trim()); }
      catch { return { ...response, status: 'error', code: 'DEPENDENCY_ERROR' }; }
      if (runtime.playwright !== source.browserAutomation.version
        || !isWithin(paths.pythonInstallDirectory, path.resolve(runtime.basePrefix || ''))) {
        return { ...response, status: 'error', code: 'DEPENDENCY_ERROR' };
      }
      if (typeof runtime.chromiumExecutable !== 'string') return { ...response, code: 'BROWSER_MISSING' };
      const chromiumExecutable = path.resolve(runtime.chromiumExecutable);
      let chromiumIsFile = false;
      try {
        chromiumIsFile = isWithin(paths.browsersDirectory, chromiumExecutable)
          && fs.statSync(chromiumExecutable).isFile();
      } catch {}
      if (!chromiumIsFile) return { ...response, code: 'BROWSER_MISSING' };
      let chromiumVersion;
      try {
        const result = await runChecked(chromiumExecutable, ['--version'], {
          cwd: appRoot, env, timeoutMs: 10_000, signal
        }, 'BROWSER_MISSING');
        chromiumVersion = result.stdout.trim();
      } catch (error) {
        if (error.code === 'CANCELLED') throw error;
        return { ...response, code: error.code === 'TIMEOUT' ? 'TIMEOUT' : 'BROWSER_MISSING' };
      }
      if (!/^(?:Chromium|Chrome)(?: for Testing)?\s+\d+\.\d+\.\d+\.\d+/i.test(chromiumVersion)) {
        return { ...response, code: 'BROWSER_MISSING' };
      }
      return {
        ...response, status: 'ok', code: null, pythonVersion: version.stdout.trim(),
        installationState: 'available', chromiumVersion, lockSha256: lockDigest
      };
    } catch (error) {
      return { ...response, status: 'error', code: error.code || 'RUNTIME_MISSING' };
    }
  }

  function getVersionDirectory(sourceId, versionId) {
    if (sourceId !== defaultRegistry.SOCIAL_SOURCE_ID || !isVersionId(versionId)) {
      throw codedError('INVALID_REQUEST');
    }
    const sourceRoot = path.resolve(baseDirectory, 'sources', sourceId);
    const versionDirectory = path.resolve(sourceRoot, versionId);
    if (!isWithin(path.resolve(baseDirectory), sourceRoot) || !isWithin(sourceRoot, versionDirectory)) {
      throw codedError('INVALID_REQUEST');
    }
    return versionDirectory;
  }

  function validateCandidateContract(source) {
    const current = registry.getSocialSource(source.id);
    if (source.protocolVersion !== current.protocolVersion) throw codedError('PROTOCOL_INCOMPATIBLE');
    if (!Array.isArray(source.platforms) || current.platforms.some(platform => !source.platforms.includes(platform))) {
      throw codedError('VERSION_INCOMPATIBLE');
    }
    for (const platform of current.platforms) {
      const currentCapabilities = current.capabilities?.[platform];
      const candidateCapabilities = source.capabilities?.[platform];
      if (!Array.isArray(currentCapabilities) || !Array.isArray(candidateCapabilities)
        || currentCapabilities.some(capability => !candidateCapabilities.includes(capability))) {
        throw codedError('VERSION_INCOMPATIBLE');
      }
    }
    if (!isVersionId(source.version) || source.id !== defaultRegistry.SOCIAL_SOURCE_ID
      || !source.uvInstaller?.windowsX64 || !source.browserAutomation?.version
      || typeof source.pythonVersion !== 'string') throw codedError('VERSION_INCOMPATIBLE');
  }

  function verifyCandidateArtifact(source, artifact) {
    const artifactRootPrefix = registry.SOCIAL_SOURCE_ARTIFACT_ROOT || defaultRegistry.SOCIAL_SOURCE_ARTIFACT_ROOT;
    if (!exactObject(artifact, ['root', 'files', 'snapshotSha256'])
      || !safeRelativePath(artifact.root) || !artifact.root.startsWith(`${artifactRootPrefix}/`)
      || !Array.isArray(artifact.files) || artifact.files.length < 2 || artifact.files.length > 1000
      || !/^[a-f0-9]{64}$/.test(artifact.snapshotSha256)) throw codedError('VERSION_PACKAGE_INVALID');
    const artifactRoot = path.resolve(appRoot, artifact.root);
    if (!isWithin(appRoot, artifactRoot)) throw codedError('VERSION_PACKAGE_INVALID');
    let realArtifactRoot;
    try { realArtifactRoot = fs.realpathSync(artifactRoot); }
    catch { throw codedError('VERSION_PACKAGE_MISSING'); }
    if (!isWithin(fs.realpathSync(appRoot), realArtifactRoot)) throw codedError('VERSION_PACKAGE_INVALID');
    const seen = new Set();
    const files = [];
    for (const file of artifact.files) {
      if (!exactObject(file, ['path', 'sha256']) || !safeRelativePath(file.path)
        || !/^[a-f0-9]{64}$/.test(file.sha256) || seen.has(file.path)) {
        throw codedError('VERSION_PACKAGE_INVALID');
      }
      seen.add(file.path);
      const filePath = path.resolve(artifactRoot, file.path);
      if (!isWithin(artifactRoot, filePath)) throw codedError('VERSION_PACKAGE_INVALID');
      let realPath;
      try { realPath = fs.realpathSync(filePath); }
      catch { throw codedError('VERSION_PACKAGE_MISSING'); }
      if (!isWithin(realArtifactRoot, realPath) || !fs.statSync(realPath).isFile()) {
        throw codedError('VERSION_PACKAGE_INVALID');
      }
      const actualDigest = sha256(fs.readFileSync(realPath));
      if (actualDigest !== file.sha256) throw codedError('VERSION_PACKAGE_INVALID');
      files.push({ path: file.path, sha256: file.sha256, sourcePath: realPath });
    }
    const snapshot = typeof registry.computeSourceSnapshotSha256 === 'function'
      ? registry.computeSourceSnapshotSha256(files)
      : sha256(files.map(file => ({ path: file.path, sha256: file.sha256 }))
        .sort((left, right) => left.path.localeCompare(right.path, 'en'))
        .map(file => `${file.path}\0${file.sha256.toLowerCase()}\n`).join(''));
    if (snapshot !== artifact.snapshotSha256
      || !seen.has(source.entryPoint) || !seen.has(source.requirementsLockPath)) {
      throw codedError('VERSION_PACKAGE_INVALID');
    }
    const lock = files.find(file => file.path === source.requirementsLockPath);
    if (!lock || lock.sha256 !== source.requirementsLockSha256) throw codedError('VERSION_LOCK_MISMATCH');
    return files;
  }

  function verifyPreparedCandidate(source, artifact, versionDirectory) {
    const files = verifyCandidateArtifact(source, artifact);
    const sourceRoot = path.join(versionDirectory, 'source');
    for (const file of files) {
      const installedPath = path.resolve(sourceRoot, file.path);
      if (!isWithin(sourceRoot, installedPath) || !fs.existsSync(installedPath)
        || !fs.statSync(installedPath).isFile()
        || sha256(fs.readFileSync(installedPath)) !== file.sha256) {
        throw codedError('VERSION_PACKAGE_INVALID');
      }
    }
  }

  async function installCandidateRuntime(source, paths, { lockPath, signal }) {
    if (processPlatform !== 'win32' || processArchitecture !== 'x64') throw codedError('RUNTIME_MISSING');
    await fs.promises.mkdir(paths.runtimeDirectory, { recursive: true });
    await fs.promises.mkdir(paths.tempDirectory, { recursive: true });
    await fs.promises.mkdir(paths.versionDirectory, { recursive: true });
    const env = uvEnvironment(paths);
    let uvExecutable = paths.uvExecutable;
    const expectedUvVersion = new RegExp(`\\b${source.uvInstaller.version.replaceAll('.', '\\.')}\\b`);
    let uvReady = false;
    if (fs.existsSync(uvExecutable)) {
      try {
        const result = await runChecked(uvExecutable, ['--version'], {
          cwd: appRoot, env, timeoutMs: 10_000, signal, recordDiagnostics: false
        }, 'RUNTIME_INSTALL_FAILED');
        uvReady = expectedUvVersion.test(result.stdout);
      } catch (error) {
        if (error.code === 'CANCELLED') throw error;
      }
      if (!uvReady) await fs.promises.rm(uvExecutable, { force: true });
    }
    if (!uvReady) {
      const installer = source.uvInstaller.windowsX64;
      const archive = await downloadArchive(installer.url, { signal });
      if (!Buffer.isBuffer(archive) || sha256(archive) !== installer.sha256) throw codedError('RUNTIME_INSTALL_FAILED');
      uvExecutable = await extractExecutable(archive, paths.uvDirectory);
      const result = await runChecked(uvExecutable, ['--version'], {
        cwd: appRoot, env, timeoutMs: 10_000, signal, recordDiagnostics: false
      }, 'RUNTIME_INSTALL_FAILED');
      if (!expectedUvVersion.test(result.stdout)) throw codedError('RUNTIME_INSTALL_FAILED');
    }
    await runChecked(uvExecutable, ['python', 'install', source.pythonVersion], {
      cwd: appRoot, env, timeoutMs: 10 * 60_000, signal, recordDiagnostics: false
    }, 'RUNTIME_INSTALL_FAILED');
    await runChecked(uvExecutable, ['venv', '--python', source.pythonVersion, '--managed-python', paths.pythonEnvironmentDirectory], {
      cwd: appRoot, env, timeoutMs: 60_000, signal, recordDiagnostics: false
    }, 'DEPENDENCY_ERROR');
    await fs.promises.mkdir(paths.browsersDirectory, { recursive: true });
    await runChecked(uvExecutable, ['pip', 'sync', lockPath, '--python', paths.pythonExecutable], {
      cwd: appRoot, env, timeoutMs: 10 * 60_000, signal, recordDiagnostics: false
    }, 'DEPENDENCY_ERROR');
    await runChecked(uvExecutable, ['pip', 'check', '--python', paths.pythonExecutable], {
      cwd: appRoot, env, timeoutMs: 60_000, signal, recordDiagnostics: false
    }, 'DEPENDENCY_ERROR');
    const browserEnv = {
      PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONNOUSERSITE: '1',
      PLAYWRIGHT_BROWSERS_PATH: paths.browsersDirectory,
      TEMP: paths.tempDirectory, TMP: paths.tempDirectory,
      ...(['SystemRoot', 'WINDIR'].reduce((values, key) => {
        if (process.env[key]) values[key] = process.env[key];
        return values;
      }, {}))
    };
    await runChecked(paths.pythonExecutable, ['-m', 'playwright', 'install', source.browserAutomation.browser], {
      cwd: appRoot, env: browserEnv, timeoutMs: 15 * 60_000, signal, recordDiagnostics: false
    }, 'DEPENDENCY_ERROR');
  }

  async function runCandidateSelfCheck(source, paths, entryPoint, lockPath, signal) {
    if (sha256(fs.readFileSync(lockPath)) !== source.requirementsLockSha256) {
      throw codedError('VERSION_LOCK_MISMATCH');
    }
    const env = { ...uvEnvironment(paths), PLAYWRIGHT_BROWSERS_PATH: paths.browsersDirectory };
    const check = await runChecked(paths.pythonExecutable, ['-c',
      'import importlib.metadata as m, json, sys; import playwright.sync_api; print(json.dumps({"pythonVersion": ".".join(map(str, sys.version_info[:3])), "basePrefix": sys.base_prefix, "playwrightVersion": m.version("playwright")}))'], {
      cwd: appRoot, env, timeoutMs: 10_000, signal, recordDiagnostics: false
    }, 'STARTUP_SELF_CHECK_FAILED');
    let runtime;
    try { runtime = JSON.parse(check.stdout.trim()); }
    catch { throw codedError('STARTUP_SELF_CHECK_FAILED'); }
    if (!new RegExp(`^${source.pythonVersion.replaceAll('.', '\\.')}\\.`).test(runtime.pythonVersion || '')
      || runtime.playwrightVersion !== source.browserAutomation.version
      || !isWithin(paths.pythonInstallDirectory, path.resolve(runtime.basePrefix || ''))) {
      throw codedError('STARTUP_SELF_CHECK_FAILED');
    }

    const platform = source.platforms[0];
    const request = {
      requestId: randomUUID(), protocolVersion: source.protocolVersion,
      sourceId: source.id, action: 'health', capability: 'health', platform,
      profileId: 'startup-check', taskId: 'startup-check', contentId: null,
      budget: { maxRequests: 1, maxItems: 1, deadlineAt: new Date(now() + 30_000).toISOString() }
    };
    let result;
    try {
      result = await runChecked(paths.pythonExecutable, ['-u', entryPoint], {
        cwd: appRoot, env, timeoutMs: 15_000, signal, input: `${JSON.stringify(request)}\n`, recordDiagnostics: false
      }, 'STARTUP_SELF_CHECK_FAILED');
    } catch (error) {
      if (error.code === 'CANCELLED') throw error;
      throw codedError('STARTUP_SELF_CHECK_FAILED');
    }
    let frame;
    try { frame = JSON.parse(result.stdout.trim()); }
    catch { throw codedError('PROTOCOL_INCOMPATIBLE'); }
    try {
      const validated = validateResultMessage(frame, request, source);
      if (validated.data.healthy !== true || validated.data.sourceVersion !== source.version
        || validated.budget.usedRequests !== 0) throw codedError('STARTUP_SELF_CHECK_FAILED');
    } catch (error) {
      if (error.code === 'PROTOCOL_ERROR') throw codedError('PROTOCOL_INCOMPATIBLE');
      throw error;
    }
    return { status: 'ok' };
  }

  async function prepareVersion(request) {
    if (!exactObject(request, ['sourceId', 'versionId'])
      || request.sourceId !== defaultRegistry.SOCIAL_SOURCE_ID || !isVersionId(request.versionId)) {
      throw codedError('INVALID_REQUEST');
    }
    const { source, artifact } = getApprovedCandidate(request.sourceId, request.versionId);
    if (!artifact) throw codedError('VERSION_PACKAGE_MISSING');
    if (source.version === getActiveSource(source.id).version) throw codedError('VERSION_NOT_APPROVED');
    if (sourceManagementBusy(source.id)) throw codedError('SESSION_BUSY');
    activeVersionOperations.add(source.id);
    activePreparationSources.add(source.id);
    const controller = new AbortController();
    let complete;
    const preparation = { controller, completion: new Promise(resolve => { complete = resolve; }) };
    activePreparations.add(preparation);
    const versionDirectory = getVersionDirectory(source.id, source.version);
    const state = readVersionState(source.id);
    try {
      validateCandidateContract(source);
      if (state.previousVersions.includes(source.version)) throw codedError('VERSION_NOT_APPROVED');
      const files = verifyCandidateArtifact(source, artifact);
      if (fs.existsSync(versionDirectory)) {
        const details = fs.lstatSync(versionDirectory);
        if (details.isSymbolicLink() || !details.isDirectory()) throw codedError('VERSION_PACKAGE_INVALID');
        fs.rmSync(versionDirectory, { recursive: true, force: true });
      }
      const paths = getPaths(source, undefined, versionDirectory);
      const sourceRoot = path.join(versionDirectory, 'source');
      fs.mkdirSync(sourceRoot, { recursive: true });
      for (const file of files) {
        const destination = path.resolve(sourceRoot, file.path);
        if (!isWithin(sourceRoot, destination)) throw codedError('VERSION_PACKAGE_INVALID');
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(file.sourcePath, destination, fs.constants.COPYFILE_EXCL);
        if (sha256(fs.readFileSync(destination)) !== file.sha256) throw codedError('VERSION_PACKAGE_INVALID');
      }
      const entryPoint = resolveSourceFile(source, 'entryPoint');
      const lockPath = resolveSourceLock(source, versionDirectory);
      if (!fs.existsSync(entryPoint) || !fs.existsSync(lockPath)) throw codedError('VERSION_PACKAGE_MISSING');
      if (sha256(fs.readFileSync(lockPath)) !== source.requirementsLockSha256) throw codedError('VERSION_LOCK_MISMATCH');
      if (typeof prepareCandidateRuntime === 'function') {
        const result = await prepareCandidateRuntime(source, paths, { lockPath, signal: controller.signal });
        if (result === false || result?.status === 'error') throw codedError(result?.code || 'DEPENDENCY_ERROR');
      } else {
        await installCandidateRuntime(source, paths, { lockPath, signal: controller.signal });
      }
      if (controller.signal.aborted) throw codedError('CANCELLED');
      const selfCheck = typeof candidateSelfCheck === 'function'
        ? await candidateSelfCheck(source, { paths, entryPoint, lockPath, signal: controller.signal })
        : await runCandidateSelfCheck(source, paths, entryPoint, lockPath, controller.signal);
      if (selfCheck === false || selfCheck?.status === 'error') {
        throw codedError(selfCheck?.code || 'STARTUP_SELF_CHECK_FAILED');
      }
      if (selfCheck !== true && selfCheck?.status !== 'ok') throw codedError('STARTUP_SELF_CHECK_FAILED');
      const preparedVersions = [...new Set([...state.preparedVersions, source.version])];
      writeVersionState({ ...state, preparedVersions });
      return { status: 'ok', sourceId: source.id, versionId: source.version, state: 'prepared' };
    } catch (error) {
      if (fs.existsSync(versionDirectory) && state.activeVersion !== source.version
        && !state.previousVersions.includes(source.version)) {
        try { fs.rmSync(versionDirectory, { recursive: true, force: true }); } catch {}
      }
      const code = ALLOWED_ERROR_CODES.has(error?.code) ? error.code : 'DEPENDENCY_ERROR';
      return { status: 'error', sourceId: source.id, versionId: source.version, code, message: ERROR_MESSAGES[code] };
    } finally {
      activePreparations.delete(preparation);
      activePreparationSources.delete(source.id);
      activeVersionOperations.delete(source.id);
      complete();
    }
  }

  function listVersions() {
    const source = registry.getSocialSource(defaultRegistry.SOCIAL_SOURCE_ID);
    const state = readVersionState(source.id);
    const candidates = getApprovedCandidates(source.id).map(candidate => ({
      versionId: candidate.version,
      status: candidate.version === state.activeVersion ? 'active'
        : state.preparedVersions.includes(candidate.version) ? 'prepared' : 'available'
    }));
    const versionRoot = path.resolve(baseDirectory, 'sources', source.id);
    let installedVersions = [];
    try {
      installedVersions = fs.readdirSync(versionRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && isVersionId(entry.name))
        .map(entry => entry.name);
    } catch {}
    const cleanableVersions = installedVersions.filter(version => version !== state.activeVersion
      && !state.previousVersions.includes(version));
    return {
      status: 'ok', sourceId: source.id, activeVersion: state.activeVersion,
      previousVersion: state.previousVersions[0] || null, candidates,
      cleanupAvailable: cleanableVersions.length > 0,
      retainedPreviousVersions: MAX_RETAINED_PREVIOUS_VERSIONS
    };
  }

  function isAutomaticFallbackCode(code) {
    return AUTOMATIC_FALLBACK_CODES.has(code);
  }

  async function activateVersion(request) {
    if (!exactObject(request, ['sourceId', 'versionId', 'confirmed'])
      || request.sourceId !== defaultRegistry.SOCIAL_SOURCE_ID || !isVersionId(request.versionId)
      || request.confirmed !== true) throw codedError('INVALID_REQUEST');
    if (sourceManagementBusy(request.sourceId)) throw codedError('SESSION_BUSY');
    const { source, artifact } = getApprovedCandidate(request.sourceId, request.versionId);
    const state = readVersionState(source.id);
    if (!state.preparedVersions.includes(source.version) || !artifact) throw codedError('VERSION_NOT_PREPARED');
    activeVersionOperations.add(source.id);
    try {
      validateCandidateContract(source);
      const versionDirectory = getVersionDirectory(source.id, source.version);
      verifyPreparedCandidate(source, artifact, versionDirectory);
      const paths = getPaths(source, undefined, versionDirectory);
      const entryPoint = resolveSourceFile(source, 'entryPoint');
      const lockPath = resolveSourceLock(source, versionDirectory);
      if (!fs.existsSync(entryPoint) || !fs.existsSync(lockPath)
        || sha256(fs.readFileSync(lockPath)) !== source.requirementsLockSha256) {
        throw codedError('VERSION_LOCK_MISMATCH');
      }
      const selfCheck = typeof candidateSelfCheck === 'function'
        ? await candidateSelfCheck(source, { paths, entryPoint, lockPath })
        : await runCandidateSelfCheck(source, paths, entryPoint, lockPath);
      if (selfCheck === false || selfCheck?.status === 'error') {
        throw codedError(selfCheck?.code || 'STARTUP_SELF_CHECK_FAILED');
      }
      if (selfCheck !== true && selfCheck?.status !== 'ok') throw codedError('STARTUP_SELF_CHECK_FAILED');
      const previousVersions = state.activeVersion === source.version ? state.previousVersions : [state.activeVersion];
      writeVersionState({
        sourceId: source.id, activeVersion: source.version, previousVersions,
        preparedVersions: [...new Set([...state.preparedVersions, source.version])],
        firstRunVersion: state.activeVersion === source.version ? state.firstRunVersion : source.version
      });
      return { status: 'ok', sourceId: source.id, activeVersion: source.version, previousVersion: previousVersions[0] || null };
    } catch (error) {
      const code = ALLOWED_ERROR_CODES.has(error?.code) ? error.code : 'STARTUP_SELF_CHECK_FAILED';
      return {
        status: 'error', sourceId: request.sourceId, activeVersion: state.activeVersion,
        code, message: ERROR_MESSAGES[code], automaticRollback: isAutomaticFallbackCode(code)
      };
    } finally {
      activeVersionOperations.delete(request.sourceId);
    }
  }

  async function rollbackVersion(request) {
    if (!exactObject(request, ['sourceId', 'confirmed'])
      || request.sourceId !== defaultRegistry.SOCIAL_SOURCE_ID || request.confirmed !== true) {
      throw codedError('INVALID_REQUEST');
    }
    if (sourceManagementBusy(request.sourceId)) throw codedError('SESSION_BUSY');
    const state = readVersionState(request.sourceId);
    const previousVersion = state.previousVersions[0];
    if (!previousVersion || !state.preparedVersions.includes(previousVersion)) throw codedError('VERSION_NOT_PREPARED');
    activeVersionOperations.add(request.sourceId);
    try {
      const source = getSourceForVersion(request.sourceId, previousVersion);
      validateCandidateContract(source);
      const versionDirectory = getVersionDirectory(source.id, source.version);
      if (source.packageArtifact) verifyPreparedCandidate(source, source.packageArtifact, versionDirectory);
      const paths = getPaths(source, undefined, versionDirectory);
      const entryPoint = resolveSourceFile(source, 'entryPoint');
      const lockPath = resolveSourceLock(source, versionDirectory);
      if (!fs.existsSync(entryPoint) || !fs.existsSync(lockPath)
        || sha256(fs.readFileSync(lockPath)) !== source.requirementsLockSha256) throw codedError('VERSION_NOT_PREPARED');
      const selfCheck = typeof candidateSelfCheck === 'function'
        ? await candidateSelfCheck(source, { paths, entryPoint, lockPath })
        : await runCandidateSelfCheck(source, paths, entryPoint, lockPath);
      if (selfCheck === false || selfCheck?.status === 'error') throw codedError(selfCheck?.code || 'STARTUP_SELF_CHECK_FAILED');
      if (selfCheck !== true && selfCheck?.status !== 'ok') throw codedError('STARTUP_SELF_CHECK_FAILED');
      writeVersionState({ ...state, activeVersion: previousVersion, previousVersions: [state.activeVersion], firstRunVersion: null });
      return { status: 'ok', sourceId: source.id, activeVersion: previousVersion, previousVersion: state.activeVersion };
    } finally {
      activeVersionOperations.delete(request.sourceId);
    }
  }

  async function cleanupVersions(request) {
    if (!exactObject(request, ['sourceId', 'confirmed'])
      || request.sourceId !== defaultRegistry.SOCIAL_SOURCE_ID || request.confirmed !== true) {
      throw codedError('INVALID_REQUEST');
    }
    if (sourceManagementBusy(request.sourceId)) throw codedError('SESSION_BUSY');
    activeVersionOperations.add(request.sourceId);
    try {
      const state = readVersionState(request.sourceId);
      const versionRoot = path.resolve(baseDirectory, 'sources', request.sourceId);
      const removedVersions = [];
      let entries = [];
      try { entries = fs.readdirSync(versionRoot, { withFileTypes: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !isVersionId(entry.name)
          || entry.name === state.activeVersion || state.previousVersions.includes(entry.name)) continue;
        const target = getVersionDirectory(request.sourceId, entry.name);
        fs.rmSync(target, { recursive: true, force: true });
        removedVersions.push(entry.name);
      }
      const preparedVersions = state.preparedVersions.filter(version =>
        version === state.activeVersion || state.previousVersions.includes(version) || !removedVersions.includes(version));
      writeVersionState({ ...state, preparedVersions });
      return { status: 'ok', sourceId: request.sourceId, removedVersions };
    } finally {
      activeVersionOperations.delete(request.sourceId);
    }
  }

  async function uninstallSource(request) {
    if (!exactObject(request, ['sourceId', 'confirmed'])
      || request.sourceId !== defaultRegistry.SOCIAL_SOURCE_ID || request.confirmed !== true) {
      throw codedError('INVALID_REQUEST');
    }
    if (sourceManagementBusy(request.sourceId)) throw codedError('SESSION_BUSY');
    activeVersionOperations.add(request.sourceId);
    try {
      const source = registry.getSocialSource(request.sourceId);
      const sourceRoot = path.resolve(baseDirectory, 'sources', request.sourceId);
      const baseRealPath = fs.existsSync(sourceRoot) ? fs.realpathSync(baseDirectory) : null;
      let parent = baseDirectory;
      for (const segment of ['sources', request.sourceId]) {
        parent = path.join(parent, segment);
        try {
          const details = fs.lstatSync(parent);
          if (details.isSymbolicLink() || !details.isDirectory()
            || baseRealPath && !isWithin(baseRealPath, fs.realpathSync(parent))) throw codedError('VERSION_PACKAGE_INVALID');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          break;
        }
      }
      if (fs.existsSync(sourceRoot)) fs.rmSync(sourceRoot, { recursive: true, force: true });
      try { fs.unlinkSync(versionStatePath(request.sourceId)); }
      catch (error) { if (error.code !== 'ENOENT') throw codedError('VERSION_STATE_WRITE_FAILED'); }
      try { fs.unlinkSync(prepareStatePath(source)); }
      catch (error) { if (error.code !== 'ENOENT') throw codedError('SOURCE_STATE_WRITE_FAILED'); }
      return { status: 'ok', sourceId: request.sourceId, activeVersion: source.version };
    } finally {
      activeVersionOperations.delete(request.sourceId);
    }
  }

  async function prepareSource(sourceId, { onProgress = () => {} } = {}) {
    const source = getActiveSource(sourceId);
    const operationId = randomUUID();
    if (shuttingDown) {
      return { status: 'error', sourceId, version: source.version, userDataPath,
        operationId, code: 'CANCELLED', message: ERROR_MESSAGES.CANCELLED, recoverable: true, phases: [] };
    }
    if (activePreparationSources.has(source.id) || activeVersionOperations.has(source.id)
      || [...profileLocks.values()].some(reservation => reservation.sourceId === source.id)) {
      return { status: 'error', sourceId, version: source.version, userDataPath,
        operationId, code: 'SESSION_BUSY', message: ERROR_MESSAGES.SESSION_BUSY, recoverable: true, phases: [] };
    }
    activePreparationSources.add(source.id);
    const preparationController = new AbortController();
    let markPreparationComplete;
    const preparation = {
      controller: preparationController,
      completion: new Promise(resolve => { markPreparationComplete = resolve; })
    };
    activePreparations.add(preparation);
    const paths = getPaths(source);
    const lockPath = resolveSourceLock(source);
    const phases = [];
    let currentStage = 'checking-lock';
    let prepareStateWriteFailed = false;
    const report = (stage, progress, detail = {}) => {
      const value = Object.freeze({ operationId, sourceId, version: source.version, userDataPath, stage, progress, ...detail });
      phases.push(value);
      try {
        persistPrepareOperation({
          operationId,
          sourceId,
          version: source.version,
          stage,
          progress,
          state: detail.state === 'error' ? 'error' : detail.complete === true ? 'complete' : 'running',
          code: detail.code || null,
          recoverable: detail.recoverable === true,
          updatedAt: new Date(now()).toISOString()
        });
      } catch { prepareStateWriteFailed = true; }
      try { onProgress(value); } catch {}
      if (prepareStateWriteFailed && detail.state !== 'error') throw codedError('SOURCE_STATE_WRITE_FAILED');
    };
    const stage = async (name, progress, action) => {
      assertRunning();
      currentStage = name;
      report(name, progress, { state: 'running' });
      await action();
      assertRunning();
      report(name, progress, { state: 'complete' });
    };
    try {
      assertRunning();
      if (processPlatform !== 'win32' || processArchitecture !== 'x64') throw codedError('RUNTIME_MISSING');
      if (!fs.existsSync(lockPath)) throw codedError('DEPENDENCY_ERROR');
      const lockBytes = fs.readFileSync(lockPath);
      if (sha256(lockBytes) !== source.requirementsLockSha256) throw codedError('LOCK_MISMATCH');
      const entryPoint = resolveSourceFile(source, 'entryPoint');
      if (!fs.existsSync(entryPoint)) throw codedError('SOURCE_MISSING');

      await fs.promises.mkdir(paths.runtimeDirectory, { recursive: true });
      await fs.promises.mkdir(paths.tempDirectory, { recursive: true });
      const env = uvEnvironment(paths);
      let uvExecutable = paths.uvExecutable;
      let uvVersionVerified = false;
      const expectedUvVersion = new RegExp(`\\b${source.uvInstaller.version.replaceAll('.', '\\.')}\\b`);
      if (fs.existsSync(uvExecutable)) {
        currentStage = 'checking-installer';
        report(currentStage, 8, { state: 'running' });
        try {
          const installedVersion = await runChecked(uvExecutable, ['--version'], {
            cwd: appRoot, env, timeoutMs: 10_000
          }, 'RUNTIME_INSTALL_FAILED');
          uvVersionVerified = expectedUvVersion.test(installedVersion.stdout);
        } catch (error) {
          if (error.code === 'CANCELLED') throw error;
        }
        if (!uvVersionVerified) {
          await fs.promises.rm(uvExecutable, { force: true, recursive: true });
          uvExecutable = null;
          report(currentStage, 9, { state: 'retrying', code: 'RUNTIME_INSTALL_FAILED', recoverable: true });
        } else {
          report(currentStage, 10, { state: 'complete' });
        }
      }
      if (!uvExecutable || !fs.existsSync(uvExecutable)) {
        currentStage = 'downloading-installer';
        report(currentStage, 10, { state: 'running' });
        const installer = source.uvInstaller.windowsX64;
        const archive = await downloadArchive(installer.url, { signal: preparationController.signal });
        assertRunning();
        if (!Buffer.isBuffer(archive) || sha256(archive) !== installer.sha256) throw codedError('RUNTIME_INSTALL_FAILED');
        uvExecutable = await extractExecutable(archive, paths.uvDirectory);
        assertRunning();
        if (!path.isAbsolute(uvExecutable) || !isWithin(paths.uvDirectory, path.resolve(uvExecutable))
          || !fs.existsSync(uvExecutable)) throw codedError('RUNTIME_INSTALL_FAILED');
        report(currentStage, 15, { state: 'complete' });
      }

      await stage('checking-installer', 20, async () => {
        if (!uvVersionVerified) {
          let result;
          try {
            result = await runChecked(uvExecutable, ['--version'], {
              cwd: appRoot, env, timeoutMs: 10_000
            }, 'RUNTIME_INSTALL_FAILED');
          } catch (error) {
            await fs.promises.rm(uvExecutable, { force: true, recursive: true });
            if (error.code === 'CANCELLED' || error.code === 'TIMEOUT') throw error;
            throw codedError('RUNTIME_INSTALL_FAILED');
          }
          if (!expectedUvVersion.test(result.stdout)) {
            await fs.promises.rm(uvExecutable, { force: true, recursive: true });
            throw codedError('RUNTIME_INSTALL_FAILED');
          }
        }
      });
      await stage('installing-python', 35, async () => {
        await runChecked(uvExecutable, ['python', 'install', source.pythonVersion], { cwd: appRoot, env, timeoutMs: 10 * 60_000 }, 'RUNTIME_INSTALL_FAILED');
      });
      await fs.promises.mkdir(paths.versionDirectory, { recursive: true });
      await stage('creating-environment', 50, async () => {
        await runChecked(uvExecutable, ['venv', '--python', source.pythonVersion, '--managed-python', paths.pythonEnvironmentDirectory], {
          cwd: appRoot, env, timeoutMs: 60_000
        }, 'DEPENDENCY_ERROR');
      });
      await stage('syncing-dependencies', 65, async () => {
        if (sha256(fs.readFileSync(lockPath)) !== source.requirementsLockSha256) throw codedError('LOCK_MISMATCH');
        await runChecked(uvExecutable, ['pip', 'sync', lockPath, '--python', paths.pythonExecutable], {
          cwd: appRoot, env, timeoutMs: 10 * 60_000
        }, 'DEPENDENCY_ERROR');
      });
      await stage('installing-browser', 80, async () => {
        const browserEnv = makeUserEnvironment(paths, 'installer', getProfileDirectory('xiaohongshu', 'installer'), 'install');
        await runChecked(paths.pythonExecutable, ['-m', 'playwright', 'install', source.browserAutomation.browser], {
          cwd: appRoot, env: { ...env, ...browserEnv }, timeoutMs: 15 * 60_000
        }, 'DEPENDENCY_ERROR');
      });
      await stage('verifying-runtime', 93, async () => {
        if (sha256(fs.readFileSync(lockPath)) !== source.requirementsLockSha256) throw codedError('LOCK_MISMATCH');
        await runChecked(uvExecutable, ['pip', 'check', '--python', paths.pythonExecutable], {
          cwd: appRoot, env, timeoutMs: 60_000
        }, 'DEPENDENCY_ERROR');
        const verification = await runChecked(paths.pythonExecutable, ['-c',
          'import importlib.metadata as m, json, sys; print(json.dumps({"version": ".".join(map(str, sys.version_info[:3])), "basePrefix": sys.base_prefix, "playwright": m.version("playwright")}))'], {
          cwd: appRoot, env, timeoutMs: 10_000
        }, 'DEPENDENCY_ERROR');
        let runtime;
        try { runtime = JSON.parse(verification.stdout.trim()); }
        catch { throw codedError('DEPENDENCY_ERROR'); }
        if (!/^3\.11\./.test(runtime.version || '') || runtime.playwright !== source.browserAutomation.version
          || !isWithin(paths.pythonInstallDirectory, path.resolve(runtime.basePrefix || ''))) throw codedError('RUNTIME_INSTALL_FAILED');
      });
      report('complete', 100, { state: 'complete', complete: true });
      return { status: 'ok', operationId, sourceId, version: source.version, userDataPath, targets: paths, phases };
    } catch (error) {
      const code = ALLOWED_ERROR_CODES.has(error?.code) ? error.code
        : currentStage.includes('python') || currentStage.includes('installer') ? 'RUNTIME_INSTALL_FAILED' : 'DEPENDENCY_ERROR';
      report(currentStage, Math.min(99, phases.at(-1)?.progress || 0), { state: 'error', code, recoverable: true });
      return { status: 'error', operationId, sourceId, version: source.version, userDataPath, code, message: ERROR_MESSAGES[code], recoverable: true, phases };
    } finally {
      activePreparations.delete(preparation);
      activePreparationSources.delete(source.id);
      markPreparationComplete();
    }
  }

  function checkPrepared(sourceId, signal) {
    return typeof isSourcePrepared === 'function'
      ? Promise.resolve(isSourcePrepared(sourceId, { signal }))
      : checkEnvironment(sourceId, { signal }).then(result => result.status === 'ok');
  }

  function getWorkerEnvironment(source, platform, profileId, mode) {
    const paths = getPaths(source, platform);
    const profileDirectory = getProfileDirectory(platform, profileId);
    const env = makeUserEnvironment(paths, profileId, profileDirectory, mode);
    return { paths, profileDirectory, env };
  }

  function errorResult(error, request, budget = {}) {
    const code = ALLOWED_ERROR_CODES.has(error?.code) ? error.code : 'REQUEST_FAILED';
    return {
      status: 'error', code, message: ERROR_MESSAGES[code], sourceId: request?.sourceId,
      version: request ? getActiveSource(request.sourceId).version : undefined,
      taskId: request?.taskId, platform: request?.platform, profileId: request?.profileId,
      budget: {
        usedRequests: Number.isInteger(budget.usedRequests) ? budget.usedRequests : 0,
        usedItems: Number.isInteger(budget.usedItems) ? budget.usedItems : 0,
        unknownRequests: Number.isInteger(budget.unknownRequests)
          ? budget.unknownRequests
          : budget.inFlight ? 1 : 0
      }
    };
  }

  function validateBudgetSummary(value, request) {
    if (!exactObject(value, ['usedRequests', 'usedItems', 'unknownRequests'])
      || !Number.isInteger(value.usedRequests) || value.usedRequests < 0
      || value.usedRequests > request.budget.maxRequests
      || !Number.isInteger(value.usedItems) || value.usedItems < 0
      || value.usedItems > request.budget.maxItems
      || !Number.isInteger(value.unknownRequests) || value.unknownRequests < 0
      || value.unknownRequests > value.usedRequests) throw codedError('PROTOCOL_ERROR');
    return value;
  }

  function validateActionData(action, platform, data, source) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw codedError('PROTOCOL_ERROR');
    if (action === 'health') {
      if (!exactObject(data, ['healthy', 'sourceVersion', 'pythonVersion'])
        || data.healthy !== true || data.sourceVersion !== source.version
        || typeof data.pythonVersion !== 'string' || !/^3\.11\.\d+$/.test(data.pythonVersion)) {
        throw codedError('PROTOCOL_ERROR');
      }
      return;
    }
    if (action === 'session') {
      if (!exactObject(data, ['loggedIn']) || typeof data.loggedIn !== 'boolean') throw codedError('PROTOCOL_ERROR');
      return;
    }
    if (action === 'detail') {
      if (platform === 'bilibili') {
        const view = data.View || data.view;
        if (!view || typeof view !== 'object' || Array.isArray(view)) throw codedError('PROTOCOL_ERROR');
      } else if (Object.keys(data).length === 0) {
        throw codedError('PROTOCOL_ERROR');
      }
      return;
    }
    const candidates = [
      data.comments, data.replies, data.items,
      data.data && typeof data.data === 'object' ? data.data.comments : undefined,
      data.data && typeof data.data === 'object' ? data.data.replies : undefined,
      data.data && typeof data.data === 'object' ? data.data.items : undefined
    ];
    const entries = candidates.find(Array.isArray);
    if (!entries || entries.some(item => !item || typeof item !== 'object' || Array.isArray(item))
      || data.truncated != null && typeof data.truncated !== 'boolean') throw codedError('PROTOCOL_ERROR');
  }

  function validateBudgetMessage(message, request, previous) {
    const keys = ['protocolVersion', 'requestId', 'type', 'usedRequests', 'usedItems', 'inFlight'];
    if (!exactObject(message, keys) || message.protocolVersion !== request.protocolVersion
      || message.requestId !== request.requestId || message.type !== 'budget'
      || !Number.isInteger(message.usedRequests) || message.usedRequests < previous.usedRequests
      || message.usedRequests > request.budget.maxRequests || !Number.isInteger(message.usedItems)
      || message.usedItems < previous.usedItems || message.usedItems > request.budget.maxItems
      || typeof message.inFlight !== 'boolean') throw codedError('PROTOCOL_ERROR');
    return { usedRequests: message.usedRequests, usedItems: message.usedItems, inFlight: message.inFlight };
  }

  function validateResultMessage(message, request, source = getActiveSource(request.sourceId)) {
    const keys = ['protocolVersion', 'requestId', 'type', 'result'];
    if (!exactObject(message, keys) || message.protocolVersion !== request.protocolVersion
      || message.requestId !== request.requestId || message.type !== 'result'
      || !message.result || typeof message.result !== 'object' || Array.isArray(message.result)) throw codedError('PROTOCOL_ERROR');
    const resultKeys = ['status', 'action', 'platform', 'profileId', 'data', 'budget'];
    const result = message.result;
    if (!exactObject(result, resultKeys) || result.status !== 'ok' || result.action !== request.action
      || result.platform !== request.platform || result.profileId !== request.profileId
      || !result.data || typeof result.data !== 'object') throw codedError('PROTOCOL_ERROR');
    validateActionData(request.action, request.platform, result.data, source);
    const budget = validateBudgetSummary(result.budget, request);
    if (budget.unknownRequests !== 0) throw codedError('PROTOCOL_ERROR');
    return result;
  }

  async function executeAction(value) {
    validatePublicAction(value);
    const source = getActiveSource(value.sourceId);
    const request = registry.validateSourceRequest({ ...value, requestId: randomUUID(), protocolVersion: source.protocolVersion }, { now: now() });
    const reservation = reserveProfile(request.platform, request.profileId, source.id);
    if (reservation.error) return Promise.resolve(errorResult(reservation.error, request));
    const actionKey = request.taskId + ':' + request.platform + ':' + request.profileId;
    const record = {
      child: null,
      request,
      reservationKey: reservation.key,
      budget: { usedRequests: 0, usedItems: 0, inFlight: false },
      settled: false,
      stopCode: null,
      stopAction: null,
      cleanupRequired: false,
      cleanupConfirmed: false,
      closeReceived: false,
      controller: new AbortController()
    };
    let resolveCancellation;
    const cancellation = new Promise(resolve => { resolveCancellation = resolve; });
    record.stop = code => {
      if (record.settled) return record.completion;
      if (!record.stopCode) {
        record.stopCode = code;
        record.controller.abort();
        resolveCancellation(code);
      }
      if (record.stopAction) Promise.resolve(record.stopAction(record.stopCode)).catch(() => {});
      return record.completion;
    };
    activeActions.set(actionKey, record);

    const prepared = Promise.resolve().then(() => {
      if (record.stopCode || shuttingDown) throw codedError(record.stopCode || 'CANCELLED');
      return checkPrepared(request.sourceId, record.controller.signal);
    });
    const readiness = prepared.then(
      isReady => ({ type: 'ready', isReady }),
      error => ({ type: 'error', error })
    );
    const operation = (async () => {
      const outcome = await Promise.race([
        readiness,
        cancellation.then(code => ({ type: 'cancelled', code }))
      ]);
      if (outcome.type === 'cancelled') return errorResult(codedError(outcome.code), request, record.budget);
      if (record.stopCode) throw codedError(record.stopCode);
      if (outcome.type === 'error') throw outcome.error;
      assertRunning();
      if (!outcome.isReady) throw codedError('RUNTIME_MISSING');
      if (Date.parse(request.budget.deadlineAt) <= now()) throw codedError('TIMEOUT');
      const { paths, profileDirectory, env } = getWorkerEnvironment(source, request.platform, request.profileId, 'action');
      const entryPoint = resolveSourceFile(source, 'entryPoint');
      if (!fs.existsSync(entryPoint)) throw codedError('SOURCE_MISSING');
      fs.mkdirSync(profileDirectory, { recursive: true });

      return new Promise(resolve => {
        let protocolError = false;
        let pendingResult = null;
        let timer;
        let stopReader = () => {};
        let childStartError = false;
        const finish = result => {
          if (record.settled) return;
          record.settled = true;
          if (timer) unschedule(timer);
          stopReader();
          resolve(result);
        };
        let resolveClosed;
        const closed = new Promise(resolveClosedPromise => { resolveClosed = resolveClosedPromise; });
        let closeReceived = false;
        let closeCode = null;
        let closeFinalizationQueued = false;
        const finalizeClosed = () => {
          if (record.settled) {
            resolveClosed();
            return;
          }
          stderrReader.flush();
          record.cleanupConfirmed = stderrReader.state.confirmed;
          if (record.stopCode && record.budget.inFlight && !Number.isInteger(record.budget.unknownRequests)) {
            record.budget = { ...record.budget, unknownRequests: 1 };
          }
          if (stderrReader.state.collision) {
            reservation.release();
            finish(errorResult(codedError('JOB_COLLISION'), request, record.budget));
          }
          else if (record.cleanupRequired && !record.cleanupConfirmed) {
            registerOrphanJob(reservation, launch);
            finish(errorResult(codedError('PROCESS_CRASHED'), request, record.budget));
          }
          else if (record.stopCode) finish(errorResult(codedError(record.stopCode), request, record.budget));
          else if (childStartError) finish(errorResult(codedError('RUNTIME_MISSING'), request, record.budget));
          else if (protocolError) {
            record.protocolValidated = false;
            finish(errorResult(codedError('PROTOCOL_ERROR'), request, record.budget));
          }
          else if (pendingResult?.errorCode) finish(errorResult(codedError(pendingResult.errorCode), request, pendingResult.budget));
          else if (pendingResult && closeCode === 0) finish({
            status: 'ok', sourceId: request.sourceId, version: source.version, taskId: request.taskId,
            action: pendingResult.action, platform: request.platform, profileId: request.profileId,
            data: pendingResult.data, budget: pendingResult.budget
          });
          else finish(errorResult(codedError('PROCESS_CRASHED'), request, record.budget));
          const stderr = stderrReader.getDiagnostic();
          if (stderr) diagnostics.push(cleanDiagnostic(stderr));
          while (diagnostics.length > 20) diagnostics.shift();
          resolveClosed();
        };
        const queueCloseFinalization = () => {
          if (closeFinalizationQueued) return;
          closeFinalizationQueued = true;
          // Drain stdout data already queued before close (notably the final in-flight budget frame).
          setImmediate(finalizeClosed);
        };
        const failAndStop = code => {
          if (record.settled) return Promise.resolve();
          if (record.stopPromise) return record.stopPromise;
          record.stopCode = code;
          record.stopPromise = (async () => {
            try { await stopManagedProcess(record.child); } catch {}
            await closed;
          })();
          return record.stopPromise;
        };
        record.stopAction = failAndStop;
        let child;
        let launch;
        let stderrReader = { state: { confirmed: false }, flush: () => '', getDiagnostic: () => '' };
        try {
          launch = makeWorkerLaunch(paths, entryPoint, 'action');
          child = spawnProcess(launch.executable, launch.args, {
            cwd: appRoot, env, shell: false, windowsHide: true,
            detached: processPlatform !== 'win32' && !launch.supervised, stdio: ['pipe', 'pipe', 'pipe']
          });
          record.child = child;
          record.cleanupRequired = launch.supervised;
          trackOwnedProcess(child);
          stderrReader = attachStderr(child, {
            nonce: launch.nonce,
            jobName: launch.jobName,
            onControlError: () => { protocolError = true; record.protocolValidated = false; failAndStop('PROTOCOL_ERROR'); }
          });
        } catch {
          finish(errorResult(codedError('RUNTIME_MISSING'), request));
          return;
        }
        stopReader = readJsonl(child, message => {
          try {
            if (!message || message.requestId !== request.requestId || message.protocolVersion !== request.protocolVersion) {
              throw codedError('PROTOCOL_ERROR');
            }
            if (message.type === 'budget') {
              record.budget = validateBudgetMessage(message, request, record.budget);
              return;
            }
            if (message.type === 'result') {
              pendingResult = validateResultMessage(message, request);
              record.protocolValidated = true;
              return;
            }
            if (message.type === 'error') {
              const keys = ['protocolVersion', 'requestId', 'type', 'error', 'budget'];
              if (!exactObject(message, keys) || !exactObject(message.error, ['code'])
                || !ALLOWED_ERROR_CODES.has(message.error.code)) throw codedError('PROTOCOL_ERROR');
              const budget = validateBudgetSummary(message.budget, request);
              record.budget = { ...budget, inFlight: budget.unknownRequests > 0 };
              pendingResult = { errorCode: message.error.code, budget };
              record.protocolValidated = true;
              return;
            }
            throw codedError('PROTOCOL_ERROR');
          } catch {
            protocolError = true;
            record.protocolValidated = false;
            failAndStop('PROTOCOL_ERROR');
          }
        }, () => {
          protocolError = true;
          record.protocolValidated = false;
          failAndStop('PROTOCOL_ERROR');
        });
        child.once('error', () => { childStartError = true; });
        child.once('close', code => {
          closeReceived = true;
          record.closeReceived = true;
          closeCode = code;
          queueCloseFinalization();
        });
        const remainingMs = Date.parse(request.budget.deadlineAt) - now();
        timer = schedule(() => failAndStop('TIMEOUT'), Math.max(1, remainingMs));
        try { writeSupervisorStart(child, launch, 'action', request); }
        catch { failAndStop('PROCESS_CRASHED'); }
      });
    })().catch(error => errorResult(error, request, record.budget));
    record.completion = (async () => {
      try {
        const result = await operation;
        await prepared.catch(() => {});
        return await handleFirstRunResult(request, result, record.protocolValidated === true, record);
      } finally {
        record.settled = true;
        if (activeActions.get(actionKey) === record) activeActions.delete(actionKey);
        if (!record.cleanupRequired || (record.cleanupConfirmed && record.closeReceived)) reservation.release();
      }
    })();
    return record.completion;
  }

  async function handleFirstRunResult(request, result, protocolValidated = false, currentRecord = null) {
    const state = readVersionState(request.sourceId);
    if (state.firstRunVersion !== state.activeVersion || state.activeVersion !== result.version) return result;
    // 合法业务响应已证明新版本协议可用，后续平台错误不再触发首次运行回退。
    if (result.status === 'ok' || protocolValidated) {
      try { writeVersionState({ ...state, firstRunVersion: null }); }
      catch { return { ...result, versionStateCode: 'VERSION_STATE_WRITE_FAILED' }; }
      return result;
    }
    if (result.status !== 'error' || !RUNTIME_AUTOMATIC_FALLBACK_CODES.has(result.code)) return result;
    const activeVersion = state.activeVersion;
    const previousVersion = state.previousVersions[0];
    activeVersionOperations.add(request.sourceId);
    try {
      const hasOtherWork = [...activeActions.values()].some(record => record !== currentRecord && record.request.sourceId === request.sourceId)
        || activeLoginOperations.size > 0 || loginProcesses.size > 0 || activePreparations.size > 0
        || [...profileLocks.entries()].some(([key, lock]) => key !== currentRecord?.reservationKey && lock.sourceId === request.sourceId);
      if (hasOtherWork) {
        return { ...result, automaticRollback: false, rollbackCode: 'SESSION_BUSY', activeVersion };
      }
    if (!previousVersion || !state.preparedVersions.includes(previousVersion)) {
      return { ...result, automaticRollback: false, rollbackCode: 'VERSION_NOT_PREPARED', activeVersion };
    }
    try {
      const previousSource = getSourceForVersion(request.sourceId, previousVersion);
      validateCandidateContract(previousSource);
      const versionDirectory = getVersionDirectory(request.sourceId, previousVersion);
      if (previousSource.packageArtifact) verifyPreparedCandidate(previousSource, previousSource.packageArtifact, versionDirectory);
      const paths = getPaths(previousSource, undefined, versionDirectory);
      const entryPoint = resolveSourceFile(previousSource, 'entryPoint');
      const lockPath = resolveSourceLock(previousSource, versionDirectory);
      if (!fs.existsSync(entryPoint) || !fs.existsSync(lockPath)
        || sha256(fs.readFileSync(lockPath)) !== previousSource.requirementsLockSha256) {
        throw codedError('VERSION_NOT_PREPARED');
      }
      const selfCheck = typeof candidateSelfCheck === 'function'
        ? await candidateSelfCheck(previousSource, { paths, entryPoint, lockPath })
        : await runCandidateSelfCheck(previousSource, paths, entryPoint, lockPath);
      if (selfCheck === false || selfCheck?.status === 'error') {
        throw codedError(selfCheck?.code || 'STARTUP_SELF_CHECK_FAILED');
      }
      if (selfCheck !== true && selfCheck?.status !== 'ok') throw codedError('STARTUP_SELF_CHECK_FAILED');
      writeVersionState({
        ...state,
        activeVersion: previousVersion,
        previousVersions: [activeVersion],
        firstRunVersion: null
      });
      return {
        ...result,
        activeVersion: previousVersion,
        automaticRollback: true,
        rollbackCode: result.code,
        message: `${result.message} 已自动回退到可用版本 v${previousVersion}。`
      };
    } catch (error) {
      const rollbackCode = ALLOWED_ERROR_CODES.has(error?.code) ? error.code : 'STARTUP_SELF_CHECK_FAILED';
      return { ...result, automaticRollback: false, rollbackCode, activeVersion };
    }
    } finally {
      activeVersionOperations.delete(request.sourceId);
    }
  }

  function validateControlRequest(value, keys) {
    if (!exactObject(value, keys)) throw codedError('INVALID_REQUEST');
    validateProfileRequest(value, keys);
    const source = getActiveSource(value.sourceId);
    if (!source.platforms.includes(value.platform)) throw codedError('INVALID_REQUEST');
    return source;
  }

  async function openLogin(value, { onProgress } = {}) {
    const keys = ['sourceId', 'platform', 'profileId'];
    const source = validateControlRequest(value, keys);
    const reservation = reserveProfile(value.platform, value.profileId, source.id);
    if (reservation.error) {
      return { status: 'error', code: reservation.error.code, message: ERROR_MESSAGES[reservation.error.code] };
    }

    let child;
    let processClosed = false;
    let reservationTransferred = false;
    let resolveCancellation;
    let resolveOperationComplete;
    const cancellation = new Promise(resolve => { resolveCancellation = resolve; });
    const operation = {
      child: null,
      stopCode: null,
      controller: new AbortController(),
      completion: new Promise(resolve => { resolveOperationComplete = resolve; }),
      stop(code) {
        if (!operation.stopCode) {
          operation.stopCode = code;
          operation.controller.abort();
          resolveCancellation(code);
        }
        if (child && !processClosed) {
          loginStopCodes.set(child, operation.stopCode);
          Promise.resolve(stopManagedProcess(child)).catch(() => {});
        }
        return operation.completion;
      }
    };
    activeLoginOperations.set(reservation.key, operation);
    const prepared = Promise.resolve().then(() => {
      if (operation.stopCode || shuttingDown) throw codedError(operation.stopCode || 'CANCELLED');
      return checkPrepared(source.id, operation.controller.signal);
    });
    const readiness = prepared.then(
      isReady => ({ type: 'ready', isReady }),
      error => ({ type: 'error', error })
    );
    try {
      const outcome = await Promise.race([
        readiness,
        cancellation.then(code => ({ type: 'cancelled', code }))
      ]);
      if (outcome.type === 'cancelled') {
        if (child && !processClosed) await waitForProcessClose(child);
        return { status: 'error', code: outcome.code, message: ERROR_MESSAGES[outcome.code] };
      }
      if (operation.stopCode) throw codedError(operation.stopCode);
      if (outcome.type === 'error') throw outcome.error;
      if (!outcome.isReady) throw codedError('RUNTIME_MISSING');
      assertRunning();
      const paths = getPaths(source, value.platform);
      const profileDirectory = getProfileDirectory(value.platform, value.profileId);
      const entryPoint = resolveSourceFile(source, 'entryPoint');
      if (!fs.existsSync(entryPoint)) throw codedError('SOURCE_MISSING');
      fs.mkdirSync(profileDirectory, { recursive: true });
      const env = makeUserEnvironment(paths, value.profileId, profileDirectory, 'login');

      const result = await new Promise(resolve => {
        let ready = false;
        let settled = false;
        let stdoutBuffer = '';
        let stderr = '';
        let timer;
        let childStartError = false;
        let launch;
        let stderrReader = { state: { confirmed: false }, flush: () => '', getDiagnostic: () => '' };
        const complete = value => {
          if (settled) return;
          settled = true;
          if (timer) unschedule(timer);
          resolve(value);
        };
        try {
          launch = makeWorkerLaunch(paths, entryPoint, 'login');
          child = spawnProcess(launch.executable, launch.args, {
            cwd: appRoot, env, shell: false, windowsHide: true,
            detached: processPlatform !== 'win32' && !launch.supervised, stdio: ['pipe', 'pipe', 'pipe']
          });
        } catch {
          complete({ status: 'error', code: 'RUNTIME_MISSING', message: ERROR_MESSAGES.RUNTIME_MISSING });
          return;
        }

        trackOwnedProcess(child);
        stderrReader = attachStderr(child, {
          nonce: launch.nonce,
          jobName: launch.jobName,
          onControlError: () => operation.stop('PROTOCOL_ERROR')
        });
        operation.child = child;
        loginProcesses.set(reservation.key, child);
        child.stdout?.setEncoding?.('utf8');
        child.stdout?.on('data', chunk => {
          stdoutBuffer += chunk;
          if (Buffer.byteLength(stdoutBuffer) > MAX_PROTOCOL_LINE_BYTES) {
            operation.stop('PROTOCOL_ERROR');
            return;
          }
          let newline;
          while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
            const line = stdoutBuffer.slice(0, newline).trim();
            stdoutBuffer = stdoutBuffer.slice(newline + 1);
            try {
              const message = JSON.parse(line);
              if (!exactObject(message, ['protocolVersion', 'type', 'platform', 'profileId'])
                || message.protocolVersion !== source.protocolVersion || message.type !== 'login-ready'
                || message.platform !== value.platform || message.profileId !== value.profileId) throw new Error('bad protocol');
              ready = true;
              complete({ status: 'ok', sourceId: source.id, version: source.version, platform: value.platform,
                profileId: value.profileId, profilePath: profileDirectory, opened: true, userDataPath });
            } catch {
              operation.stop('PROTOCOL_ERROR');
            }
          }
        });
        child.once('close', (code, signal) => {
          processClosed = true;
          stderrReader.flush();
          if (loginProcesses.get(reservation.key) === child) loginProcesses.delete(reservation.key);
          const cleanupConfirmed = !launch.supervised || stderrReader.state.confirmed;
          if (stderrReader.state.collision) {
            loginStopCodes.set(child, 'JOB_COLLISION');
            reservation.release();
          }
          else if (cleanupConfirmed) reservation.release();
          else {
            loginStopCodes.set(child, 'PROCESS_CRASHED');
            const orphan = registerOrphanJob(reservation, launch);
            const state = supervisorStates.get(child);
            if (state) state.orphanRecord = orphan;
          }
          const stderr = stderrReader.getDiagnostic();
          if (stderr) {
            diagnostics.push(cleanDiagnostic(stderr));
            while (diagnostics.length > 20) diagnostics.shift();
          }
          if (!ready) {
            const failureCode = loginStopCodes.get(child)
              || (!cleanupConfirmed ? 'PROCESS_CRASHED'
                : childStartError ? 'RUNTIME_MISSING' : code === 0 ? 'PROTOCOL_ERROR' : 'PROCESS_CRASHED');
            complete({ status: 'error', code: failureCode, message: ERROR_MESSAGES[failureCode] });
          } else if (operation.stopCode !== 'CANCELLED' && loginStopCodes.get(child) !== 'CANCELLED') {
            const normalExit = code === 0 && signal === null && !childStartError
              && cleanupConfirmed && !operation.stopCode && !loginStopCodes.has(child);
            try {
              onProgress?.({
                sourceId: source.id,
                platform: value.platform,
                profileId: value.profileId,
                state: normalExit ? 'stopped' : 'error',
                ...(normalExit ? {} : { code: 'PROCESS_CRASHED' })
              });
            } catch {
              // Renderer 关闭时无法投递进度，不应影响进程清理。
            }
          }
        });
        child.once('error', () => {
          childStartError = true;
        });
        timer = schedule(() => {
          operation.stop('TIMEOUT');
        }, 30_000);
        try { writeSupervisorStart(child, launch, 'login', null); }
        catch { operation.stop('PROCESS_CRASHED'); }
      });

      if (child && !processClosed) reservationTransferred = true;
      return result;
    } catch (error) {
      const code = ALLOWED_ERROR_CODES.has(error?.code) ? error.code : 'REQUEST_FAILED';
      return { status: 'error', code, message: ERROR_MESSAGES[code] };
    } finally {
      await prepared.catch(() => {});
      if (activeLoginOperations.get(reservation.key) === operation) activeLoginOperations.delete(reservation.key);
      if (!reservationTransferred && !orphanJobs.has(reservation.key)) reservation.release();
      resolveOperationComplete();
    }
  }
  async function cancelAction(value) {
    const keys = ['sourceId', 'platform', 'profileId', 'taskId'];
    validateControlRequest(value, keys);
    const key = `${value.taskId}:${value.platform}:${value.profileId}`;
    const record = activeActions.get(key);
    if (!record) return { status: 'ok', cancelled: false };
    await record.stop('CANCELLED');
    return { status: 'ok', cancelled: true };
  }

  async function stopProfile(value) {
    const keys = ['sourceId', 'platform', 'profileId'];
    validateControlRequest(value, keys);
    const key = `${value.platform}:${value.profileId}`;
    const orphanAtStart = orphanJobs.get(key);
    const attemptsAtStart = orphanAtStart?.recoveryAttempts || 0;
    const operation = activeLoginOperations.get(key);
    if (operation) await operation.stop('CANCELLED');
    const child = loginProcesses.get(key) || operation?.child;
    let cleanupFailed = false;
    let jobCollision = false;
    if (child) {
      loginStopCodes.set(child, 'CANCELLED');
      await stopManagedProcess(child);
      const state = supervisorStates.get(child);
      jobCollision = Boolean(state?.collision);
      cleanupFailed = Boolean(state?.required && !state.confirmed && !state.collision);
    }
    const childState = child ? supervisorStates.get(child) : null;
    const orphan = orphanAtStart || orphanJobs.get(key) || childState?.orphanRecord;
    if (orphan) {
      let recovered;
      if (!orphanJobs.has(key) && orphan.lastRecoveryResult === true) recovered = true;
      else if (orphan.recoveryPromise) recovered = await orphan.recoveryPromise;
      else if (orphan === orphanAtStart || (orphan.recoveryAttempts || 0) === attemptsAtStart) {
        recovered = await startOrphanRecovery(orphan);
      } else recovered = orphan.lastRecoveryResult === true;
      cleanupFailed = !recovered;
    }
    if (jobCollision) {
      return { status: 'error', code: 'JOB_COLLISION', message: ERROR_MESSAGES.JOB_COLLISION };
    }
    if (cleanupFailed) {
      return { status: 'error', code: 'PROCESS_CRASHED', message: ERROR_MESSAGES.PROCESS_CRASHED };
    }
    return { status: 'ok', stopped: Boolean(operation || child || orphan) };
  }

  async function stopAll() {
    shuttingDown = true;
    const preparations = [...activePreparations];
    for (const preparation of preparations) preparation.controller.abort();
    const initialProcesses = [...ownedProcesses];
    const actionChildren = new Set([...activeActions.values()].map(record => record.child).filter(Boolean));
    const records = [...activeActions.values()].filter(record => typeof record.stop === 'function');
    const loginOperations = [...activeLoginOperations.values()];
    const loginChildren = new Set([...loginProcesses.values(), ...loginOperations.map(operation => operation.child)].filter(Boolean));
    const activeLoginChildren = new Set(loginOperations.map(operation => operation.child).filter(Boolean));
    for (const child of loginChildren) loginStopCodes.set(child, 'CANCELLED');
    const stoppingActions = records.map(record => record.stop('CANCELLED'));
    const stoppingLogins = loginOperations.map(operation => operation.stop('CANCELLED'));
    const terminatingLoginProcesses = [...loginChildren]
      .filter(child => !activeLoginChildren.has(child))
      .map(child => Promise.resolve(stopManagedProcess(child)).catch(() => {
        try { child.kill(); } catch {}
      }));
    const remaining = initialProcesses.filter(child => !actionChildren.has(child) && !loginChildren.has(child));
    const killingRemaining = Promise.allSettled(remaining.map(child => terminateProcessTree(child)));
    const waitingInitialProcesses = Promise.all(initialProcesses.map(child => waitForProcessClose(child)));
    const waitingLoginProcesses = Promise.all(
      [...loginProcesses.entries()].map(([key, child]) => waitForLoginProcessClose(key, child))
    );
    await Promise.allSettled([
      ...stoppingActions,
      ...stoppingLogins,
      killingRemaining,
      ...terminatingLoginProcesses,
      waitingInitialProcesses,
      waitingLoginProcesses
    ]);
    await Promise.allSettled([...orphanJobs.values()].map(record => startOrphanRecovery(record)));
    await Promise.allSettled(preparations.map(preparation => preparation.completion));
    return { stopped: new Set([...initialProcesses, ...remaining]).size };
  }

  function registerIpcHandlers(ipcMain) {
    if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required');
    const safe = handler => async (event, ...args) => {
      try { return await handler(event, ...args); }
      catch (error) {
        const code = ALLOWED_ERROR_CODES.has(error?.code) ? error.code : 'REQUEST_FAILED';
        return { status: 'error', code, message: ERROR_MESSAGES[code] };
      }
    };
    ipcMain.handle('social-source:research:begin', safe(async (event, ...args) => {
      if (args.length) throw codedError('INVALID_REQUEST');
      return beginResearchOperation(event);
    }));
    ipcMain.handle('social-source:research:end', safe(async (event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return endResearchOperation(event, args[0]);
    }));
    ipcMain.handle('social-source:list', safe(async (_event, ...args) => {
      if (args.length) throw codedError('INVALID_REQUEST');
      return registry.listSocialSources().map(source => source.id === defaultRegistry.SOCIAL_SOURCE_ID
        ? getActiveSource(source.id) : source);
    }));
    ipcMain.handle('social-source:versions:list', safe(async (_event, ...args) => {
      if (args.length) throw codedError('INVALID_REQUEST');
      return listVersions();
    }));
    ipcMain.handle('social-source:version:prepare', safe(async (_event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return prepareVersion(args[0]);
    }));
    ipcMain.handle('social-source:version:activate', safe(async (_event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return activateVersion(args[0]);
    }));
    ipcMain.handle('social-source:version:rollback', safe(async (_event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return rollbackVersion(args[0]);
    }));
    ipcMain.handle('social-source:version:cleanup', safe(async (_event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return cleanupVersions(args[0]);
    }));
    ipcMain.handle('social-source:uninstall', safe(async (_event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return uninstallSource(args[0]);
    }));
    ipcMain.handle('social-source:diagnostics', safe(async (_event, ...args) => {
      if (args.length) throw codedError('INVALID_REQUEST');
      return { status: 'ok', entries: diagnostics.slice(-20) };
    }));
    ipcMain.handle('social-source:check-environment', safe(async (_event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return checkEnvironment(args[0]);
    }));
    ipcMain.handle('social-source:prepare', safe(async (event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return prepareSource(args[0], { onProgress: progress => event.sender?.send?.('social-source:progress', progress) });
    }));
    ipcMain.handle('social-source:open-login', safe(async (event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return openLogin(args[0], {
        onProgress: progress => event.sender?.send?.('social-source:progress', progress)
      });
    }));
    ipcMain.handle('social-source:run', safe(async (_event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return executeAction(args[0]);
    }));
    ipcMain.handle('social-source:cancel', safe(async (_event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return cancelAction(args[0]);
    }));
    ipcMain.handle('social-source:stop-profile', safe(async (_event, ...args) => {
      if (args.length !== 1) throw codedError('INVALID_REQUEST');
      return stopProfile(args[0]);
    }));
  }

  return Object.freeze({
    listVersions,
    prepareVersion,
    activateVersion,
    rollbackVersion,
    cleanupVersions,
    uninstallSource,
    checkEnvironment,
    prepareSource,
    getProfileDirectory,
    openLogin,
    executeAction,
    cancelAction,
    stopProfile,
    stopAll,
    registerIpcHandlers,
    getDiagnostics: () => diagnostics.slice(-20)
  });
}

module.exports = { createSocialSourceManager, downloadUvArchive, extractUvExecutable, runProcess };
