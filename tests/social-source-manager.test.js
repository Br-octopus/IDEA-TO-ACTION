const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const vm = require('node:vm');
const test = require('node:test');

const managerPath = path.resolve(__dirname, '../electron/social-source-manager.js');
const managerModule = fs.existsSync(managerPath) ? require(managerPath) : null;
const projectRoot = path.resolve(__dirname, '..');
const sourceRegistry = require('../server/social-source-registry');

function makeManager(options = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'social-source-user-data-'));
  const app = {
    getPath: name => {
      assert.equal(name, 'userData');
      return userData;
    },
    getAppPath: () => projectRoot
  };
  const manager = managerModule?.createSocialSourceManager({ app, superviseWindowsProcesses: false, ...options });
  return { manager, userData, cleanup: () => fs.rmSync(userData, { recursive: true, force: true }) };
}

test('打包态从 resourcesPath 读取固定来源清单，而开发态继续使用 appPath', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'social-source-packaged-'));
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'social-source-resources-'));
  t.after(() => {
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(resourcesPath, { recursive: true, force: true });
  });
  const source = sourceRegistry.getSocialSource('mediacrawler-lite');
  for (const relativePath of [source.entryPoint, source.requirementsLockPath]) {
    const destination = path.join(resourcesPath, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, relativePath), destination);
  }
  const manager = managerModule.createSocialSourceManager({
    app: { isPackaged: true, getPath: () => userData, getAppPath: () => path.join(userData, 'app.asar') },
    resourcesPath,
    processPlatform: 'win32',
    processArchitecture: 'x64',
    superviseWindowsProcesses: false
  });
  const result = await manager.checkEnvironment(source.id);
  assert.equal(result.code, 'RUNTIME_MISSING');
  assert.equal(result.targets.versionDirectory.startsWith(userData), true);
});

function makeCandidateManager({ versions = ['1.2.0'], prepareResult, prepareRuntime, selfCheck, isSourcePrepared, spawnProcess, killProcessTree } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'social-source-versions-'));
  const appRoot = path.join(userData, 'app');
  const current = sourceRegistry.getSocialSource('mediacrawler-lite');
  for (const relativePath of [current.entryPoint, current.requirementsLockPath]) {
    const destination = path.join(appRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, relativePath), destination);
  }
  const candidates = versions.map(version => {
    const root = path.join(appRoot, 'server', 'social-source-artifacts', `mock-${version}`);
    fs.mkdirSync(root, { recursive: true });
    const files = [
      { path: 'bridge.py', content: `# mock bridge ${version}\n` },
      { path: 'requirements.lock', content: `mock-dependency==${version}\n` }
    ].map(file => {
      const fullPath = path.join(root, file.path);
      fs.writeFileSync(fullPath, file.content);
      return { path: file.path, sha256: createHash('sha256').update(file.content).digest('hex') };
    });
    const candidate = {
      ...current,
      version,
      entryPoint: 'bridge.py',
      requirementsLockPath: 'requirements.lock',
      requirementsLockSha256: files.find(file => file.path === 'requirements.lock').sha256,
      packageArtifact: {
        root: `server/social-source-artifacts/mock-${version}`,
        files,
        snapshotSha256: sourceRegistry.computeSourceSnapshotSha256(files)
      }
    };
    return { source: candidate, root };
  });
  const candidateFor = (sourceId, version) => {
    if (sourceId !== current.id) throw Object.assign(new Error(), { code: 'UNSUPPORTED_SOURCE' });
    const found = candidates.find(item => item.source.version === version);
    if (!found) throw Object.assign(new Error(), { code: 'VERSION_NOT_APPROVED' });
    return found.source;
  };
  const registry = {
    ...sourceRegistry,
    getSocialSource: sourceId => sourceRegistry.getSocialSource(sourceId),
    getSocialSourceVersion: (sourceId, version) => version === current.version
      ? current : candidateFor(sourceId, version),
    listApprovedSocialSourceCandidates: sourceId => {
      if (sourceId !== current.id) throw Object.assign(new Error(), { code: 'UNSUPPORTED_SOURCE' });
      return candidates.map(item => item.source);
    }
  };
  const app = {
    getPath: name => { assert.equal(name, 'userData'); return userData; },
    getAppPath: () => appRoot
  };
  const manager = managerModule.createSocialSourceManager({
    app, registry, processPlatform: 'win32', processArchitecture: 'x64', superviseWindowsProcesses: false,
    ...(spawnProcess ? { spawnProcess } : {}),
    ...(killProcessTree ? { killProcessTree } : {}),
    ...(isSourcePrepared ? { isSourcePrepared } : {}),
    prepareCandidateRuntime: async (source, paths, context) => {
      if (prepareRuntime) return prepareRuntime(source, paths, context);
      if (prepareResult) return prepareResult;
      fs.mkdirSync(path.dirname(paths.pythonExecutable), { recursive: true });
      fs.writeFileSync(paths.pythonExecutable, 'mock python');
      fs.mkdirSync(paths.browsersDirectory, { recursive: true });
      fs.writeFileSync(path.join(paths.browsersDirectory, 'mock-browser'), 'mock');
      return { status: 'ok' };
    },
    candidateSelfCheck: selfCheck || (async () => ({ status: 'ok' }))
  });
  return {
    manager, userData, appRoot, current, candidates,
    cleanup: () => fs.rmSync(userData, { recursive: true, force: true })
  };
}

function validAction(overrides = {}) {
  return {
    sourceId: 'mediacrawler-lite',
    action: 'comments',
    capability: 'comments',
    platform: 'bilibili',
    profileId: 'account_a',
    taskId: 'task_a',
    contentId: { bvid: 'BV1xx411c7mD', cursor: '0' },
    budget: { maxRequests: 2, maxItems: 20, deadlineAt: new Date(Date.now() + 30_000).toISOString() },
    ...overrides
  };
}

test('preload 只暴露固定来源操作并映射到命名 IPC 通道', async () => {
  const preloadPath = path.resolve(__dirname, '../electron/preload.js');
  const calls = [];
  let exposed;
  vm.runInNewContext(fs.readFileSync(preloadPath, 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (globalName, api) => { exposed = { globalName, api }; } },
        ipcRenderer: {
          invoke: (...args) => { calls.push(args); return Promise.resolve({ status: 'ok' }); },
          on() {}, removeListener() {}
        }
      };
    },
    Object, Promise
  }, { filename: preloadPath });

  assert.ok(exposed.api.socialSource);
  await exposed.api.socialSource.list();
  await exposed.api.socialSource.beginResearchOperation();
  await exposed.api.socialSource.endResearchOperation('00000000-0000-4000-8000-000000000001');
  await exposed.api.socialSource.listVersions();
  await exposed.api.socialSource.prepareVersion('mediacrawler-lite', '1.2.0');
  await exposed.api.socialSource.activateVersion('mediacrawler-lite', '1.2.0');
  await exposed.api.socialSource.rollbackVersion('mediacrawler-lite');
  await exposed.api.socialSource.cleanupVersions('mediacrawler-lite');
  await exposed.api.socialSource.uninstall('mediacrawler-lite');
  await exposed.api.socialSource.getDiagnostics();
  await exposed.api.socialSource.checkEnvironment('mediacrawler-lite');
  await exposed.api.socialSource.prepare('mediacrawler-lite');
  await exposed.api.socialSource.openLogin({ sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a' });
  await exposed.api.socialSource.run(validAction());
  await exposed.api.socialSource.cancel({ sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a', taskId: 'task_a' });
  await exposed.api.socialSource.stopProfile({ sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a' });

  assert.deepEqual(calls.map(([channel]) => channel), [
    'social-source:list', 'social-source:research:begin', 'social-source:research:end',
    'social-source:versions:list', 'social-source:version:prepare',
    'social-source:version:activate', 'social-source:version:rollback', 'social-source:version:cleanup', 'social-source:uninstall',
    'social-source:diagnostics', 'social-source:check-environment', 'social-source:prepare',
    'social-source:open-login', 'social-source:run', 'social-source:cancel', 'social-source:stop-profile'
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(3, 9))), [
    ['social-source:versions:list'],
    ['social-source:version:prepare', { sourceId: 'mediacrawler-lite', versionId: '1.2.0' }],
    ['social-source:version:activate', { sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true }],
    ['social-source:version:rollback', { sourceId: 'mediacrawler-lite', confirmed: true }],
    ['social-source:version:cleanup', { sourceId: 'mediacrawler-lite', confirmed: true }],
    ['social-source:uninstall', { sourceId: 'mediacrawler-lite', confirmed: true }]
  ]);
  assert.equal(Object.isFrozen(exposed.api.socialSource), true);
});

test('当前登记没有真实升级候选，版本列表不会伪造新版本', async t => {
  const harness = makeManager();
  t.after(harness.cleanup);
  assert.deepEqual(harness.manager.listVersions(), {
    status: 'ok', sourceId: 'mediacrawler-lite', activeVersion: '1.1.0',
    previousVersion: null, candidates: [], cleanupAvailable: false, retainedPreviousVersions: 1
  });
  await assert.rejects(
    harness.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' }),
    error => error.code === 'VERSION_NOT_APPROVED'
  );
});

test('候选准备失败、文件摘要错误、协议不兼容或自检失败都不改变活动版本', async t => {
  const failedInstall = makeCandidateManager({ prepareResult: { status: 'error', code: 'DEPENDENCY_ERROR' } });
  t.after(failedInstall.cleanup);
  assert.equal((await failedInstall.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' })).code, 'DEPENDENCY_ERROR');
  assert.equal(failedInstall.manager.listVersions().activeVersion, '1.1.0');

  const digestFailure = makeCandidateManager();
  t.after(digestFailure.cleanup);
  fs.appendFileSync(path.join(digestFailure.candidates[0].root, 'bridge.py'), '# tampered\n');
  assert.equal((await digestFailure.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' })).code, 'VERSION_PACKAGE_INVALID');
  assert.equal(digestFailure.manager.listVersions().activeVersion, '1.1.0');

  const protocolFailure = makeCandidateManager();
  t.after(protocolFailure.cleanup);
  protocolFailure.candidates[0].source.protocolVersion = 2;
  assert.equal((await protocolFailure.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' })).code, 'PROTOCOL_INCOMPATIBLE');
  assert.equal(protocolFailure.manager.listVersions().activeVersion, '1.1.0');

  const selfCheckFailure = makeCandidateManager({
    selfCheck: async () => ({ status: 'error', code: 'STARTUP_SELF_CHECK_FAILED' })
  });
  t.after(selfCheckFailure.cleanup);
  assert.equal((await selfCheckFailure.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' })).code, 'STARTUP_SELF_CHECK_FAILED');
  assert.equal(selfCheckFailure.manager.listVersions().activeVersion, '1.1.0');

  const lockFailure = makeCandidateManager();
  t.after(lockFailure.cleanup);
  lockFailure.candidates[0].source.requirementsLockSha256 = 'a'.repeat(64);
  assert.equal((await lockFailure.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' })).code, 'VERSION_LOCK_MISMATCH');
});

test('候选仅在明确确认且再次通过启动自检后切换；失败时保留旧活动版本', async t => {
  let checks = 0;
  const harness = makeCandidateManager({ selfCheck: async () => {
    checks += 1;
    return checks === 1 ? { status: 'ok' } : { status: 'error', code: 'STARTUP_SELF_CHECK_FAILED' };
  } });
  t.after(harness.cleanup);
  assert.equal((await harness.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' })).status, 'ok');
  await assert.rejects(
    harness.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: false }),
    error => error.code === 'INVALID_REQUEST'
  );
  const failed = await harness.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true });
  assert.equal(failed.status, 'error');
  assert.equal(failed.code, 'STARTUP_SELF_CHECK_FAILED');
  assert.equal(failed.automaticRollback, true);
  assert.equal(failed.activeVersion, '1.1.0');
  assert.equal(harness.manager.listVersions().activeVersion, '1.1.0');
});

test('候选版本首次运行遇到协议错误时会真实回退并保留用户数据', async t => {
  const harness = makeCandidateManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => new FakeChild((child, line) => {
      const request = JSON.parse(line);
      child.stdout.write(`${JSON.stringify({
        protocolVersion: 999,
        requestId: request.requestId,
        type: 'result',
        result: {}
      })}\n`);
    }),
    killProcessTree: async child => child.emit('close', 1, null)
  });
  t.after(harness.cleanup);
  assert.equal((await harness.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' })).status, 'ok');
  assert.equal((await harness.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true })).status, 'ok');

  const profile = path.join(harness.manager.getProfileDirectory('bilibili', 'account_a'), 'profile.data');
  const task = path.join(harness.userData, 'research-tasks.json');
  const attachment = path.join(harness.userData, 'research-attachments', 'task_a', 'evidence.txt');
  fs.mkdirSync(path.dirname(profile), { recursive: true });
  fs.mkdirSync(path.dirname(attachment), { recursive: true });
  fs.writeFileSync(profile, 'profile');
  fs.writeFileSync(task, 'task');
  fs.writeFileSync(attachment, 'attachment');

  const result = await harness.manager.executeAction(validAction());
  assert.equal(result.code, 'PROTOCOL_ERROR');
  assert.equal(result.automaticRollback, true);
  assert.equal(result.version, '1.2.0');
  assert.equal(result.activeVersion, '1.1.0');
  assert.equal(harness.manager.listVersions().activeVersion, '1.1.0');
  assert.equal(harness.manager.listVersions().previousVersion, '1.2.0');
  assert.equal(fs.readFileSync(profile, 'utf8'), 'profile');
  assert.equal(fs.readFileSync(task, 'utf8'), 'task');
  assert.equal(fs.readFileSync(attachment, 'utf8'), 'attachment');
});

test('候选版本的有效业务错误不会自动回退，也会确认协议兼容', async t => {
  let launches = 0;
  const harness = makeCandidateManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => new FakeChild((child, line) => {
      const request = JSON.parse(line);
      launches += 1;
      const response = launches === 1 ? {
        protocolVersion: 1,
        requestId: request.requestId,
        type: 'error',
        error: { code: 'LOGIN_EXPIRED' },
        budget: { usedRequests: 0, usedItems: 0, unknownRequests: 0 }
      } : {
        protocolVersion: 999,
        requestId: request.requestId,
        type: 'result',
        result: {}
      };
      child.stdout.write(`${JSON.stringify(response)}\n`);
      setImmediate(() => {
        if (child.closed) return;
        child.closed = true;
        child.emit('close', 0, null);
      });
    }),
    killProcessTree: async child => {
      if (child.closed) return;
      child.closed = true;
      child.emit('close', 1, null);
    }
  });
  t.after(harness.cleanup);
  assert.equal((await harness.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' })).status, 'ok');
  assert.equal((await harness.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true })).status, 'ok');

  const first = await harness.manager.executeAction(validAction());
  assert.equal(first.code, 'LOGIN_EXPIRED');
  assert.notEqual(first.automaticRollback, true);
  assert.equal(harness.manager.listVersions().activeVersion, '1.2.0');

  const second = await harness.manager.executeAction(validAction({ taskId: 'task_b' }));
  assert.equal(second.code, 'PROTOCOL_ERROR');
  assert.notEqual(second.automaticRollback, true);
  assert.equal(harness.manager.listVersions().activeVersion, '1.2.0');
});

test('版本能力不兼容与平台业务错误均不触发自动回退标记', async t => {
  const incompatible = makeCandidateManager();
  t.after(incompatible.cleanup);
  assert.equal((await incompatible.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' })).status, 'ok');
  incompatible.candidates[0].source.platforms = ['bilibili'];
  const incompatibleResult = await incompatible.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true });
  assert.equal(incompatibleResult.code, 'VERSION_INCOMPATIBLE');
  assert.equal(incompatibleResult.automaticRollback, false);
  assert.equal(incompatibleResult.activeVersion, '1.1.0');

  for (const code of ['LOGIN_EXPIRED', 'RATE_LIMITED', 'MANUAL_VERIFICATION_REQUIRED', 'CONTENT_NOT_FOUND']) {
    let checks = 0;
    const harness = makeCandidateManager({ selfCheck: async () => {
      checks += 1;
      return checks === 1 ? { status: 'ok' } : { status: 'error', code };
    } });
    t.after(harness.cleanup);
    await harness.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' });
    const result = await harness.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true });
    assert.equal(result.code, code);
    assert.equal(result.automaticRollback, false, code);
    assert.equal(result.activeVersion, '1.1.0', code);
  }
});

test('回退保留 profile、任务和附件；清理只删除未激活及未保留的来源版本', async t => {
  const harness = makeCandidateManager({ versions: ['1.2.0', '1.3.0'] });
  t.after(harness.cleanup);
  for (const versionId of ['1.2.0', '1.3.0']) {
    assert.equal((await harness.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId })).status, 'ok');
    assert.equal((await harness.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId, confirmed: true })).status, 'ok');
  }
  const profile = path.join(harness.userData, 'social-source', 'profiles', 'bilibili', 'account_a', 'profile.data');
  const task = path.join(harness.userData, 'research-tasks.json');
  const attachment = path.join(harness.userData, 'research-attachments', 'task-a', 'evidence.txt');
  fs.mkdirSync(path.dirname(profile), { recursive: true });
  fs.mkdirSync(path.dirname(attachment), { recursive: true });
  fs.writeFileSync(profile, 'profile');
  fs.writeFileSync(task, 'task');
  fs.writeFileSync(attachment, 'attachment');
  const unretained = path.join(harness.userData, 'social-source', 'sources', 'mediacrawler-lite', '0.9.0');
  const oldCurrent = path.join(harness.userData, 'social-source', 'sources', 'mediacrawler-lite', '1.1.0');
  fs.mkdirSync(unretained, { recursive: true });
  fs.mkdirSync(oldCurrent, { recursive: true });
  fs.writeFileSync(path.join(unretained, 'venv-marker'), 'managed');

  assert.equal((await harness.manager.rollbackVersion({ sourceId: 'mediacrawler-lite', confirmed: true })).activeVersion, '1.2.0');
  const cleaned = await harness.manager.cleanupVersions({ sourceId: 'mediacrawler-lite', confirmed: true });
  assert.deepEqual(cleaned.removedVersions.sort(), ['0.9.0', '1.1.0']);
  assert.equal(fs.existsSync(path.join(harness.userData, 'social-source', 'sources', 'mediacrawler-lite', '1.2.0')), true);
  assert.equal(fs.existsSync(path.join(harness.userData, 'social-source', 'sources', 'mediacrawler-lite', '1.3.0')), true);
  assert.equal(fs.existsSync(unretained), false);
  assert.equal(fs.existsSync(oldCurrent), false);
  assert.equal(fs.readFileSync(profile, 'utf8'), 'profile');
  assert.equal(fs.readFileSync(task, 'utf8'), 'task');
  assert.equal(fs.readFileSync(attachment, 'utf8'), 'attachment');
  assert.equal(harness.manager.listVersions().activeVersion, '1.2.0');
  assert.equal(harness.manager.listVersions().previousVersion, '1.3.0');
});

test('卸载只删除来源版本目录和状态，保留共享运行时、profile、任务与附件', async t => {
  const harness = makeCandidateManager();
  t.after(harness.cleanup);
  assert.equal((await harness.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' })).status, 'ok');
  assert.equal((await harness.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true })).status, 'ok');
  const sourceRoot = path.join(harness.userData, 'social-source', 'sources', 'mediacrawler-lite');
  const profile = path.join(harness.userData, 'social-source', 'profiles', 'bilibili', 'account_a', 'profile.data');
  const sharedRuntime = path.join(harness.userData, 'social-source', 'runtime', 'runtime-marker');
  const task = path.join(harness.userData, 'research-tasks.json');
  const attachment = path.join(harness.userData, 'research-attachments', 'task-a', 'evidence.txt');
  for (const file of [profile, sharedRuntime, task, attachment]) fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const file of [profile, sharedRuntime, task, attachment]) fs.writeFileSync(file, 'keep');
  assert.equal((await harness.manager.uninstallSource({ sourceId: 'mediacrawler-lite', confirmed: true })).activeVersion, '1.1.0');
  assert.equal(fs.existsSync(sourceRoot), false);
  for (const file of [profile, sharedRuntime, task, attachment]) assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
  assert.equal(harness.manager.listVersions().activeVersion, '1.1.0');
});

test('候选准备运行期间切换和清理被管理器拒绝', async t => {
  let markStarted;
  let finishPreparation;
  const started = new Promise(resolve => { markStarted = resolve; });
  const harness = makeCandidateManager({ prepareRuntime: async () => {
    markStarted();
    return new Promise(resolve => { finishPreparation = resolve; });
  } });
  t.after(harness.cleanup);
  const preparing = harness.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' });
  await started;
  await assert.rejects(
    harness.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true }),
    error => error.code === 'SESSION_BUSY'
  );
  await assert.rejects(
    harness.manager.cleanupVersions({ sourceId: 'mediacrawler-lite', confirmed: true }),
    error => error.code === 'SESSION_BUSY'
  );
  finishPreparation({ status: 'ok' });
  assert.equal((await preparing).status, 'ok');
});

test('主进程研究租约允许多项研究并存，全部结束或渲染进程退出后才允许版本变更', async t => {
  const harness = makeCandidateManager();
  t.after(harness.cleanup);
  const handlers = new Map();
  harness.manager.registerIpcHandlers({ handle: (channel, handler) => handlers.set(channel, handler) });
  const makeSender = id => {
    const sender = new EventEmitter();
    sender.id = id;
    sender.isDestroyed = () => false;
    return { sender };
  };
  const firstEvent = makeSender(41);
  const secondEvent = makeSender(42);

  const prepared = await harness.manager.prepareVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0' });
  assert.equal(prepared.status, 'ok');
  const lease = await handlers.get('social-source:research:begin')(firstEvent);
  const secondLease = await handlers.get('social-source:research:begin')(secondEvent);
  await assert.rejects(
    harness.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true }),
    error => error.code === 'SESSION_BUSY'
  );
  assert.deepEqual(await handlers.get('social-source:research:end')(firstEvent, { leaseId: lease.leaseId }), { status: 'ok' });
  await assert.rejects(
    harness.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true }),
    error => error.code === 'SESSION_BUSY'
  );
  assert.deepEqual(await handlers.get('social-source:research:end')(secondEvent, { leaseId: secondLease.leaseId }), { status: 'ok' });
  assert.equal((await harness.manager.activateVersion({ sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true })).status, 'ok');

  const crashedLease = await handlers.get('social-source:research:begin')(firstEvent);
  const parallelLease = await handlers.get('social-source:research:begin')(firstEvent);
  const unretained = path.join(harness.userData, 'social-source', 'sources', 'mediacrawler-lite', '1.3.0');
  fs.mkdirSync(unretained, { recursive: true });
  await assert.rejects(
    harness.manager.cleanupVersions({ sourceId: 'mediacrawler-lite', confirmed: true }),
    error => error.code === 'SESSION_BUSY'
  );
  firstEvent.sender.emit('render-process-gone');
  const cleaned = await harness.manager.cleanupVersions({ sourceId: 'mediacrawler-lite', confirmed: true });
  assert.equal(cleaned.status, 'ok');
  assert.equal(fs.existsSync(unretained), false);
  assert.equal((await handlers.get('social-source:research:end')(firstEvent, { leaseId: crashedLease.leaseId })).code, 'INVALID_REQUEST');
  assert.equal((await handlers.get('social-source:research:end')(firstEvent, { leaseId: parallelLease.leaseId })).code, 'INVALID_REQUEST');
});

test('版本 IPC 拒绝额外字段、路径、URL、摘要、环境与未确认清理', async t => {
  const harness = makeManager();
  t.after(harness.cleanup);
  const handlers = new Map();
  harness.manager.registerIpcHandlers({ handle: (channel, handler) => handlers.set(channel, handler) });
  const invoke = (channel, ...args) => handlers.get(channel)({}, ...args);
  assert.equal((await invoke('social-source:versions:list', 'mediacrawler-lite')).code, 'INVALID_REQUEST');
  for (const payload of [
    { sourceId: 'mediacrawler-lite', versionId: '1.2.0', path: 'C:/escape' },
    { sourceId: 'mediacrawler-lite', versionId: '1.2.0', url: 'https://example.invalid' },
    { sourceId: 'mediacrawler-lite', versionId: '1.2.0', sha256: 'a'.repeat(64) },
    { sourceId: 'mediacrawler-lite', versionId: '../escape' },
    { sourceId: 'mediacrawler-lite', versionId: '1.2.0', env: { TOKEN: 'secret' } }
  ]) assert.equal((await invoke('social-source:version:prepare', payload)).code, 'INVALID_REQUEST');
  assert.equal((await invoke('social-source:version:activate', {
    sourceId: 'mediacrawler-lite', versionId: '1.2.0', confirmed: true, command: 'python'
  })).code, 'INVALID_REQUEST');
  assert.equal((await invoke('social-source:version:cleanup', { sourceId: 'mediacrawler-lite', confirmed: false })).code, 'INVALID_REQUEST');
});

class FakeChild extends EventEmitter {
  constructor(onWrite) {
    super();
    this.pid = 48123;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = { write: value => onWrite(this, value) };
    this.killed = false;
  }
}

function makeStoredZipEntry(name, content) {
  const fileName = Buffer.from(name);
  const local = Buffer.alloc(30 + fileName.length + content.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  fileName.copy(local, 30);
  content.copy(local, 30 + fileName.length);

  const central = Buffer.alloc(46 + fileName.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  fileName.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

test('profile 路径只由来源管理器生成，并按平台和 profile 隔离', t => {
  assert.ok(managerModule, '应提供专用来源管理器');
  const harness = makeManager();
  t.after(harness.cleanup);
  const xhsA = harness.manager.getProfileDirectory('xiaohongshu', 'account_a');
  const xhsB = harness.manager.getProfileDirectory('xiaohongshu', 'account_b');
  const biliA = harness.manager.getProfileDirectory('bilibili', 'account_a');
  assert.notEqual(xhsA, xhsB);
  assert.notEqual(xhsA, biliA);
  for (const profilePath of [xhsA, xhsB, biliA]) assert.ok(profilePath.startsWith(path.join(harness.userData, 'social-source')));
});

test('JSONL 动作使用登记入口和应用生成 profile，返回值必须匹配请求 ID 与协议版本', async t => {
  assert.ok(managerModule, '应提供专用来源管理器');
  let launch;
  let child;
  const harness = makeManager({
    isSourcePrepared: async () => true,
    spawnProcess: (executable, args, options) => {
      launch = { executable, args, options };
      child = new FakeChild((process, line) => {
        const request = JSON.parse(line);
        process.stdout.write(`${JSON.stringify({
          protocolVersion: 1,
          requestId: request.requestId,
          type: 'result',
          result: {
            status: 'ok', action: request.action, platform: request.platform,
            profileId: request.profileId, data: { replies: [] },
            budget: { usedRequests: 2, usedItems: 0, unknownRequests: 0 }
          }
        })}\n`);
        process.emit('close', 0, null);
      });
      return child;
    }
  });
  t.after(harness.cleanup);

  const result = await harness.manager.executeAction(validAction());
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data, { replies: [] });
  assert.equal(path.basename(launch.args[1]), 'bridge.py');
  assert.ok(launch.executable.startsWith(path.join(harness.userData, 'social-source')));
  assert.equal(launch.options.shell, false);
  assert.equal(launch.options.env.SOCIAL_SOURCE_PROFILE_DIR, harness.manager.getProfileDirectory('bilibili', 'account_a'));
  assert.equal(launch.options.env.PLAYWRIGHT_BROWSERS_PATH, path.join(harness.userData, 'social-source', 'browsers'));
  assert.equal(Object.hasOwn(launch.options.env, 'PATH'), false);
});

test('renderer 传入命令、路径、脚本、环境变量或调试端口时不会启动子进程', async t => {
  assert.ok(managerModule, '应提供专用来源管理器');
  let launches = 0;
  const harness = makeManager({ spawnProcess: () => { launches += 1; throw new Error('不应启动'); } });
  t.after(harness.cleanup);
  for (const hostile of [
    { command: 'python evil.py' }, { script: 'import os' }, { path: 'C:/private' },
    { env: { PATH: 'evil' } }, { debugPort: 9222 }
  ]) {
    await assert.rejects(harness.manager.executeAction(validAction(hostile)), { code: 'INVALID_REQUEST' });
  }
  assert.equal(launches, 0);
});

test('取消在途动作只终止该管理器创建的进程，并将未完成请求记为未知消耗', async t => {
  assert.ok(managerModule, '应提供专用来源管理器');
  let child;
  const killedPids = [];
  const harness = makeManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => {
      child = new FakeChild(process => {
        const request = JSON.parse(process.stdin.line);
        process.stdout.write(`${JSON.stringify({ protocolVersion: 1, requestId: request.requestId,
          type: 'budget', usedRequests: 1, usedItems: 0, inFlight: true })}\n`);
      });
      const write = child.stdin.write;
      child.stdin.write = value => { child.stdin.line = value; return write(value); };
      return child;
    },
    killProcessTree: async process => {
      killedPids.push(process.pid);
      process.killed = true;
      process.emit('close', 1, null);
    }
  });
  t.after(harness.cleanup);

  const action = validAction({ budget: { maxRequests: 2, maxItems: 20, deadlineAt: new Date(Date.now() + 30_000).toISOString() } });
  const running = harness.manager.executeAction(action);
  await new Promise(resolve => setImmediate(resolve));
  await harness.manager.cancelAction({
    sourceId: action.sourceId, platform: action.platform, profileId: action.profileId, taskId: action.taskId
  });
  const result = await running;
  assert.deepEqual(killedPids, [48123]);
  assert.equal(result.code, 'CANCELLED');
  assert.equal(result.budget.unknownRequests, 1);
});

test('取消与已写入但尚未处理的 budget 帧交错时保守计入未知请求', async t => {
  let markFrameWritten;
  const frameWritten = new Promise(resolve => { markFrameWritten = resolve; });
  const harness = makeManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => new FakeChild((child, line) => {
      const request = JSON.parse(line);
      const write = child.stdout.write.bind(child.stdout);
      child.stdout.write = value => {
        setImmediate(() => write(value));
        return true;
      };
      child.stdout.write(JSON.stringify({
        protocolVersion: 1, requestId: request.requestId, type: 'budget',
        usedRequests: 1, usedItems: 0, inFlight: true
      }) + '\n');
      markFrameWritten();
    }),
    killProcessTree: async child => child.emit('close', 1, null)
  });
  t.after(harness.cleanup);
  const action = validAction();
  const running = harness.manager.executeAction(action);
  await frameWritten;
  await harness.manager.cancelAction({
    sourceId: action.sourceId, platform: action.platform, profileId: action.profileId, taskId: action.taskId
  });
  const result = await running;
  assert.equal(result.code, 'CANCELLED');
  assert.equal(result.budget.usedRequests, 1);
  assert.equal(result.budget.unknownRequests, 1);
});

test('桥接协议版本错误时拒绝结果并只结束该子进程树', async t => {
  assert.ok(managerModule, '应提供专用来源管理器');
  let child;
  const killedPids = [];
  const harness = makeManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => {
      child = new FakeChild((process, line) => {
        const request = JSON.parse(line);
        process.stdout.write(`${JSON.stringify({ protocolVersion: 999, requestId: request.requestId,
          type: 'result', result: {} })}\n`);
      });
      return child;
    },
    killProcessTree: async process => {
      killedPids.push(process.pid);
      process.emit('close', 1, null);
    }
  });
  t.after(harness.cleanup);
  const result = await harness.manager.executeAction(validAction());
  assert.equal(result.code, 'PROTOCOL_ERROR');
  assert.deepEqual(killedPids, [48123]);
});

test('请求截止时间到达后停止动作并把仍在途的 HTTP 请求记为未知', async t => {
  assert.ok(managerModule, '应提供专用来源管理器');
  let child;
  const killedPids = [];
  const harness = makeManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => {
      child = new FakeChild((process, line) => {
        const request = JSON.parse(line);
        process.stdout.write(`${JSON.stringify({ protocolVersion: 1, requestId: request.requestId,
          type: 'budget', usedRequests: 1, usedItems: 0, inFlight: true })}\n`);
      });
      return child;
    },
    killProcessTree: async process => {
      killedPids.push(process.pid);
      process.emit('close', 1, null);
    }
  });
  t.after(harness.cleanup);
  const action = validAction({ budget: { maxRequests: 2, maxItems: 20, deadlineAt: new Date(Date.now() + 80).toISOString() } });
  const result = await harness.manager.executeAction(action);
  assert.equal(result.code, 'TIMEOUT');
  assert.deepEqual(killedPids, [48123]);
  assert.equal(result.budget.unknownRequests, 1);
});

test('环境预检耗尽请求期限时不启动 worker', async t => {
  const startTime = Date.now();
  let currentTime = startTime;
  let launches = 0;
  const harness = makeManager({
    now: () => currentTime,
    isSourcePrepared: async () => {
      currentTime += 2_000;
      return true;
    },
    spawnProcess: () => {
      launches += 1;
      const child = new FakeChild(() => {});
      setImmediate(() => child.emit('close', 1, null));
      return child;
    }
  });
  t.after(harness.cleanup);
  const result = await harness.manager.executeAction(validAction({
    budget: { maxRequests: 2, maxItems: 20, deadlineAt: new Date(startTime + 1_000).toISOString() }
  }));
  assert.equal(result.code, 'TIMEOUT');
  assert.equal(launches, 0);
});

test('空 userData 可用注入的下载器和执行器准备环境，并返回结构化阶段进度', async t => {
  assert.ok(managerModule, '应提供专用来源管理器');
  const registry = require('../server/social-source-registry');
  const source = registry.getSocialSource('mediacrawler-lite');
  const archive = Buffer.from('mock official uv archive');
  const lockBytes = fs.readFileSync(path.resolve(projectRoot, source.requirementsLockPath));
  const sha256 = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const testRegistry = {
    ...registry,
    getSocialSource: id => ({
      ...source,
      requirementsLockSha256: sha256(lockBytes),
      uvInstaller: { ...source.uvInstaller, windowsX64: { ...source.uvInstaller.windowsX64, sha256: sha256(archive) } }
    })
  };
  const commands = [];
  const progress = [];
  const persistedFrames = [];
  let boundaryRecovery;
  const harness = makeManager({
    registry: testRegistry,
    processPlatform: 'win32',
    downloadUvArchive: async () => archive,
    extractUvExecutable: async (_bytes, directory) => {
      fs.mkdirSync(directory, { recursive: true });
      const executable = path.join(directory, 'uv.exe');
      fs.writeFileSync(executable, 'mock uv');
      return executable;
    },
    runCommand: async (executable, args, options) => {
      commands.push({ executable, args, options });
      const isUv = path.basename(executable).toLowerCase() === 'uv.exe';
      if (args[0] === 'venv') {
        const venvPath = args.at(-1);
        fs.mkdirSync(path.join(venvPath, 'Scripts'), { recursive: true });
        fs.writeFileSync(path.join(venvPath, 'Scripts', 'python.exe'), 'mock python');
      }
      if (args.includes('playwright') && args.includes('install')) {
        const browsers = path.join(harness.userData, 'social-source', 'browsers');
        fs.mkdirSync(browsers, { recursive: true });
        fs.writeFileSync(path.join(browsers, 'chromium.ready'), 'ready');
      }
      const stdout = args[0] === '--version'
        ? isUv ? 'uv 0.13.2' : 'Python 3.11.9'
        : args[0] === '-c' ? JSON.stringify({
          version: '3.11.9',
          basePrefix: path.join(harness.userData, 'social-source', 'runtime', 'python', 'cpython-3.11.9'),
          playwright: '1.64.0'
        }) : '';
      return { code: 0, stdout, stderr: '' };
    }
  });
  t.after(harness.cleanup);
  const statePath = path.join(harness.userData, 'social-source', 'state', 'mediacrawler-lite.json');
  const result = await harness.manager.prepareSource('mediacrawler-lite', { onProgress: item => {
    progress.push(item);
    const savedFrame = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(savedFrame.operationId, item.operationId);
    assert.equal(savedFrame.stage, item.stage, '每次进度回调前都应原子更新最近阶段');
    persistedFrames.push({ stage: item.stage, reportedState: item.state, record: savedFrame });
    if (item.stage === 'installing-python' && item.state === 'complete') {
      const app = {
        getPath: name => { assert.equal(name, 'userData'); return harness.userData; },
        getAppPath: () => projectRoot
      };
      const restartedManager = managerModule.createSocialSourceManager({
        app, registry: testRegistry, processPlatform: 'win32', processArchitecture: 'x64'
      });
      boundaryRecovery = restartedManager.checkEnvironment(source.id);
    }
  } });
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.equal(result.sourceId, 'mediacrawler-lite');
  assert.ok(progress.some(item => item.stage === 'installing-python'));
  assert.ok(progress.some(item => item.stage === 'syncing-dependencies'));
  assert.ok(progress.some(item => item.stage === 'installing-browser'));
  assert.ok(progress.at(-1).complete);
  for (const frame of persistedFrames) {
    assert.equal(frame.record.state, frame.stage === 'complete' && frame.record.progress === 100 ? 'complete' : 'running',
      '每阶段结束后仍保持 running，只有整个 prepare operation 成功后才能 complete');
  }
  assert.ok(persistedFrames.some(frame => frame.stage === 'installing-python'
    && frame.reportedState === 'complete' && frame.record.state === 'running'),
  '应记录阶段边界处可供重启恢复的 running 状态');
  const recoveredAtBoundary = await boundaryRecovery;
  assert.equal(recoveredAtBoundary.lastPrepareOperation.state, 'interrupted');
  assert.equal(recoveredAtBoundary.lastPrepareOperation.stage, 'installing-python');
  assert.equal(commands.some(item => item.options.env.UV_PYTHON_PREFERENCE === 'only-managed'), true);
  const stateDirectory = path.join(harness.userData, 'social-source', 'state');
  const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(persisted.operationId, result.operationId);
  assert.equal(persisted.state, 'complete');
  assert.equal(persisted.stage, 'complete');
  assert.equal(persisted.progress, 100);
  assert.deepEqual(Object.keys(persisted).sort(), [
    'code', 'operationId', 'progress', 'recoverable', 'sourceId', 'stage', 'state', 'updatedAt', 'version'
  ]);
  assert.equal(JSON.stringify(persisted).includes(harness.userData), false);
  assert.equal(fs.readdirSync(stateDirectory).some(name => name.endsWith('.tmp')), false);
  const environment = await harness.manager.checkEnvironment('mediacrawler-lite');
  assert.deepEqual(environment.lastPrepareOperation, persisted);
});

test('checkEnvironment 将重启遗留 running 改为 interrupted 并清洗不安全字段', async t => {
  const registry = require('../server/social-source-registry');
  const source = registry.getSocialSource('mediacrawler-lite');
  const harness = makeManager();
  t.after(harness.cleanup);
  const stateDirectory = path.join(harness.userData, 'social-source', 'state');
  const statePath = path.join(stateDirectory, `${source.id}.json`);
  fs.mkdirSync(stateDirectory, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    operationId: require('node:crypto').randomUUID(),
    sourceId: source.id,
    version: source.version,
    stage: 'syncing-dependencies',
    progress: 65,
    state: 'running',
    code: null,
    recoverable: false,
    updatedAt: new Date(Date.now() - 1000).toISOString(),
    stderr: 'Cookie: private-cookie-value',
    token: 'private-token-value',
    profilePath: 'C:\\private\\profile',
    environment: { SECRET: 'private-environment-value' },
    absolutePath: harness.userData
  }));
  let commandCalls = 0;
  const app = {
    getPath: name => { assert.equal(name, 'userData'); return harness.userData; },
    getAppPath: () => projectRoot
  };
  const restartedManager = managerModule.createSocialSourceManager({
    app,
    processPlatform: 'win32',
    processArchitecture: 'x64',
    runCommand: async () => { commandCalls += 1; return { code: 0, stdout: '', stderr: '' }; }
  });

  const environment = await restartedManager.checkEnvironment(source.id);
  const recovered = environment.lastPrepareOperation;
  assert.ok(recovered, JSON.stringify(environment));
  assert.equal(recovered.state, 'interrupted');
  assert.equal(recovered.stage, 'syncing-dependencies');
  assert.equal(recovered.progress, 65);
  assert.equal(recovered.recoverable, true);
  assert.equal(recovered.sourceId, source.id);
  assert.equal(recovered.version, source.version);
  assert.equal(environment.status, 'not-ready');
  assert.equal(commandCalls, 0, '环境检查不会自动继续安装或运行安装命令');
  assert.deepEqual(Object.keys(recovered).sort(), [
    'code', 'operationId', 'progress', 'recoverable', 'sourceId', 'stage', 'state', 'updatedAt', 'version'
  ]);
  const persisted = fs.readFileSync(statePath, 'utf8');
  for (const secret of ['private-cookie-value', 'private-token-value', 'C:\\private\\profile', 'private-environment-value', harness.userData]) {
    assert.equal(persisted.includes(secret), false, `持久化元数据不应包含 ${secret}`);
  }
  assert.equal(JSON.parse(persisted).state, 'interrupted');
  assert.equal((await restartedManager.checkEnvironment(source.id)).lastPrepareOperation.state, 'interrupted');
});

test('同一 sourceId 的来源环境准备互斥，第二次调用返回 SESSION_BUSY', async t => {
  const registry = require('../server/social-source-registry');
  const source = registry.getSocialSource('mediacrawler-lite');
  const archive = Buffer.from('mock serialized uv archive');
  const lockBytes = fs.readFileSync(path.resolve(projectRoot, source.requirementsLockPath));
  const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const testRegistry = {
    ...registry,
    getSocialSource: id => ({
      ...source,
      requirementsLockSha256: digest(lockBytes),
      uvInstaller: { ...source.uvInstaller, windowsX64: { ...source.uvInstaller.windowsX64, sha256: digest(archive) } }
    })
  };
  let downloadCalls = 0;
  let extractions = 0;
  let markDownloadStarted;
  const downloadStarted = new Promise(resolve => { markDownloadStarted = resolve; });
  const harness = makeManager({
    registry: testRegistry,
    processPlatform: 'win32',
    processArchitecture: 'x64',
    downloadUvArchive: (_url, { signal }) => {
      downloadCalls += 1;
      if (downloadCalls === 1) {
        markDownloadStarted();
        return new Promise(resolve => signal.addEventListener('abort', () => resolve(archive), { once: true }));
      }
      return archive;
    },
    extractUvExecutable: async () => {
      extractions += 1;
      throw new Error('不应并发写入 installer 目录');
    }
  });
  t.after(harness.cleanup);

  const first = harness.manager.prepareSource('mediacrawler-lite');
  await downloadStarted;
  const second = await harness.manager.prepareSource('mediacrawler-lite');
  await harness.manager.stopAll();
  const firstResult = await first;

  assert.equal(second.code, 'SESSION_BUSY');
  assert.equal(firstResult.code, 'CANCELLED');
  assert.equal(downloadCalls, 1);
  assert.equal(extractions, 0);
});

test('checkEnvironment 不把残缺的非空 Chromium 缓存目录当作已安装', async t => {
  const registry = require('../server/social-source-registry');
  const source = registry.getSocialSource('mediacrawler-lite');
  let chromiumVersion = 'Chrome for Testing 123.0.6312.4';
  const harness = makeManager({
    processPlatform: 'win32',
    processArchitecture: 'x64',
    runCommand: async (executable, args, options) => {
      if (path.basename(executable).toLowerCase() === 'chrome.exe') {
        return { code: 0, stdout: chromiumVersion, stderr: '' };
      }
      if (args[0] === '--version') return { code: 0, stdout: 'Python 3.11.9', stderr: '' };
      if (args[0] === '-c') {
        assert.equal(options.env.PLAYWRIGHT_BROWSERS_PATH, path.join(harness.userData, 'social-source', 'browsers'));
        return { code: 0, stdout: JSON.stringify({
          basePrefix: path.join(harness.userData, 'social-source', 'runtime', 'python', 'cpython-3.11.9'),
          playwright: source.browserAutomation.version,
          chromiumExecutable: path.join(harness.userData, 'social-source', 'browsers', 'chromium-1234', 'chrome-win', 'chrome.exe')
        }), stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
  });
  t.after(harness.cleanup);
  const sourceRoot = path.join(harness.userData, 'social-source');
  const uvExecutable = path.join(sourceRoot, 'runtime', 'uv', source.uvInstaller.version, 'uv.exe');
  const pythonExecutable = path.join(sourceRoot, 'sources', source.id, source.version, 'venv', 'Scripts', 'python.exe');
  const browserCache = path.join(sourceRoot, 'browsers');
  const partialChromium = path.join(browserCache, 'chromium-partial');
  fs.mkdirSync(path.dirname(uvExecutable), { recursive: true });
  fs.mkdirSync(path.dirname(pythonExecutable), { recursive: true });
  fs.mkdirSync(partialChromium, { recursive: true });
  fs.writeFileSync(uvExecutable, 'mock uv');
  fs.writeFileSync(pythonExecutable, 'mock python');
  fs.writeFileSync(path.join(partialChromium, 'README.txt'), 'incomplete browser cache');

  const result = await harness.manager.checkEnvironment(source.id);
  assert.equal(result.status, 'not-ready');
  assert.equal(result.code, 'BROWSER_MISSING');

  const chromiumExecutable = path.join(browserCache, 'chromium-1234', 'chrome-win', 'chrome.exe');
  fs.mkdirSync(path.dirname(chromiumExecutable), { recursive: true });
  fs.writeFileSync(chromiumExecutable, 'mock chromium executable');
  chromiumVersion = 'not a browser version';
  const invalidVersion = await harness.manager.checkEnvironment(source.id);
  assert.equal(invalidVersion.status, 'not-ready');
  assert.equal(invalidVersion.code, 'BROWSER_MISSING');

  chromiumVersion = 'Chrome for Testing 123.0.6312.4';
  const ready = await harness.manager.checkEnvironment(source.id);
  assert.equal(ready.status, 'ok');
  assert.equal(ready.chromiumVersion, chromiumVersion);
});

test('uv 下载的连接超时返回结构化 TIMEOUT', async () => {
  assert.equal(typeof managerModule.downloadUvArchive, 'function');
  const request = new EventEmitter();
  request.destroy = error => request.emit('error', error);
  await assert.rejects(managerModule.downloadUvArchive(
    'https://github.com/astral-sh/uv/releases/download/test/uv.zip',
    { connectTimeoutMs: 10, totalTimeoutMs: 100, httpsGet: () => request }
  ), { code: 'TIMEOUT' });
});

test('uv 下载的总超时覆盖已连接但没有响应体的请求', async () => {
  assert.equal(typeof managerModule.downloadUvArchive, 'function');
  const request = new EventEmitter();
  request.destroy = error => request.emit('error', error);
  const httpsGet = (_url, _options, onResponse) => {
    setImmediate(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = {};
      response.resume = () => {};
      onResponse(response);
    });
    return request;
  };
  await assert.rejects(managerModule.downloadUvArchive(
    'https://github.com/astral-sh/uv/releases/download/test/uv.zip',
    { connectTimeoutMs: 100, totalTimeoutMs: 15, httpsGet }
  ), { code: 'TIMEOUT' });
});

test('uv 下载捕获畸形 redirect Location 并返回可恢复安装错误', async () => {
  assert.equal(typeof managerModule.downloadUvArchive, 'function');
  const request = new EventEmitter();
  request.destroy = error => request.emit('error', error);
  const httpsGet = (_url, _options, onResponse) => {
    const response = new EventEmitter();
    response.statusCode = 302;
    response.headers = { location: 'https://[' };
    response.resume = () => {};
    onResponse(response);
    return request;
  };
  await assert.rejects(managerModule.downloadUvArchive(
    'https://github.com/astral-sh/uv/releases/download/test/uv.zip',
    { connectTimeoutMs: 100, totalTimeoutMs: 100, httpsGet }
  ), { code: 'RUNTIME_INSTALL_FAILED' });
});

test('同一 platform/profile 在环境检查前同步占用，同 task 和不同 task 均返回 SESSION_BUSY', async t => {
  for (const secondTaskId of ['task_a', 'task_b']) {
    let releaseReadiness;
    const readiness = new Promise(resolve => { releaseReadiness = resolve; });
    const harness = makeManager({ isSourcePrepared: () => readiness });
    t.after(harness.cleanup);
    const first = harness.manager.executeAction(validAction({ taskId: 'task_a' }));
    let secondResult;
    const second = harness.manager.executeAction(validAction({ taskId: secondTaskId })).then(result => {
      secondResult = result;
      return result;
    });
    await new Promise(resolve => setImmediate(resolve));
    releaseReadiness(false);
    await Promise.all([first, second]);
    assert.equal(secondResult.code, 'SESSION_BUSY');
  }
});

test('登录与数据动作共享 platform/profile 锁并在首个 await 前拒绝竞争方', async t => {
  for (const loginFirst of [false, true]) {
    let releaseReadiness;
    const readiness = new Promise(resolve => { releaseReadiness = resolve; });
    const harness = makeManager({ isSourcePrepared: () => readiness });
    t.after(harness.cleanup);
    const loginRequest = { sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a' };
    const first = loginFirst
      ? harness.manager.openLogin(loginRequest)
      : harness.manager.executeAction(validAction());
    let competingResult;
    const second = (loginFirst
      ? harness.manager.executeAction(validAction())
      : harness.manager.openLogin(loginRequest)).then(result => {
      competingResult = result;
      return result;
    });
    await new Promise(resolve => setImmediate(resolve));
    releaseReadiness(false);
    await Promise.all([first, second]);
    assert.equal(competingResult.code, 'SESSION_BUSY');
  }
});

test('环境预检期间 cancelAction 可见操作并阻止随后启动子进程', async t => {
  let releaseReadiness;
  let markReadinessStarted;
  const readiness = new Promise(resolve => { releaseReadiness = resolve; });
  const readinessStarted = new Promise(resolve => { markReadinessStarted = resolve; });
  let launches = 0;
  const harness = makeManager({
    isSourcePrepared: () => { markReadinessStarted(); return readiness; },
    spawnProcess: () => {
      launches += 1;
      return new FakeChild(child => child.emit('close', 1, null));
    }
  });
  t.after(harness.cleanup);
  const action = validAction();
  const running = harness.manager.executeAction(action);
  await readinessStarted;
  const cancelling = harness.manager.cancelAction({
    sourceId: action.sourceId, platform: action.platform, profileId: action.profileId, taskId: action.taskId
  });
  releaseReadiness(true);
  const cancelResult = await cancelling;
  const result = await running;
  assert.equal(cancelResult.cancelled, true);
  assert.equal(result.code, 'CANCELLED');
  assert.equal(launches, 0);
});

test('stopAll 在等待中的动作预检取消后等待调用收尾且不启动子进程', async t => {
  let releaseReadiness;
  let markReadinessStarted;
  const readiness = new Promise(resolve => { releaseReadiness = resolve; });
  const readinessStarted = new Promise(resolve => { markReadinessStarted = resolve; });
  let launches = 0;
  const harness = makeManager({
    isSourcePrepared: () => { markReadinessStarted(); return readiness; },
    spawnProcess: () => { launches += 1; throw new Error('取消后不应启动'); }
  });
  t.after(harness.cleanup);
  const running = harness.manager.executeAction(validAction());
  await readinessStarted;
  let stopFinished = false;
  const stopping = harness.manager.stopAll().then(() => { stopFinished = true; });
  await new Promise(resolve => setImmediate(resolve));
  const returnedBeforeReadiness = stopFinished;
  releaseReadiness(true);
  const result = await running;
  await stopping;
  assert.equal(returnedBeforeReadiness, false);
  assert.equal(result.code, 'CANCELLED');
  assert.equal(launches, 0);
});

test('stopProfile 在 openLogin 环境预检期间取消登录且阻止随后启动子进程', async t => {
  let releaseReadiness;
  let markReadinessStarted;
  const readiness = new Promise(resolve => { releaseReadiness = resolve; });
  const readinessStarted = new Promise(resolve => { markReadinessStarted = resolve; });
  let launches = 0;
  const harness = makeManager({
    isSourcePrepared: () => { markReadinessStarted(); return readiness; },
    spawnProcess: () => {
      launches += 1;
      const child = new FakeChild(() => {});
      setImmediate(() => child.emit('close', 1, null));
      return child;
    }
  });
  t.after(harness.cleanup);
  const request = { sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a' };
  const opening = harness.manager.openLogin(request);
  await readinessStarted;
  const stopping = harness.manager.stopProfile(request);
  releaseReadiness(true);
  const stopResult = await stopping;
  const openResult = await opening;
  assert.equal(stopResult.stopped, true);
  assert.equal(openResult.code, 'CANCELLED');
  assert.equal(launches, 0);
});

test('stopAll 终止已返回 login-ready 的浏览器进程并等待 close 清理 profile 锁', async t => {
  let child;
  let closed = false;
  const killedPids = [];
  const harness = makeManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => {
      child = new FakeChild(() => {});
      setImmediate(() => child.stdout.write(`${JSON.stringify({
        protocolVersion: 1, type: 'login-ready', platform: 'bilibili', profileId: 'account_a'
      })}\n`));
      return child;
    },
    killProcessTree: async target => {
      killedPids.push(target.pid);
      await new Promise(resolve => setImmediate(resolve));
      target.emit('close', 1, null);
      closed = true;
    }
  });
  t.after(harness.cleanup);
  const request = { sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a' };

  const opened = await harness.manager.openLogin(request);
  assert.equal(opened.status, 'ok');
  assert.equal((await harness.manager.executeAction(validAction())).code, 'SESSION_BUSY');

  const stopped = await harness.manager.stopAll();
  assert.deepEqual(killedPids, [child.pid]);
  assert.equal(closed, true);
  assert.equal(stopped.stopped, 1);
  assert.equal((await harness.manager.stopProfile(request)).stopped, false);
});

test('stopAll 回收正在准备来源环境时由管理器启动的子进程', async t => {
  const archive = Buffer.from('mock pinned uv archive');
  const registry = require('../server/social-source-registry');
  const source = registry.getSocialSource('mediacrawler-lite');
  const lockBytes = fs.readFileSync(path.resolve(projectRoot, source.requirementsLockPath));
  const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const testRegistry = {
    ...registry,
    getSocialSource: id => ({
      ...source,
      requirementsLockSha256: digest(lockBytes),
      uvInstaller: { ...source.uvInstaller, windowsX64: { ...source.uvInstaller.windowsX64, sha256: digest(archive) } }
    })
  };
  let releaseCommand;
  let commandChild;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const killedPids = [];
  const harness = makeManager({
    registry: testRegistry,
    processPlatform: 'win32',
    processArchitecture: 'x64',
    downloadUvArchive: async () => archive,
    extractUvExecutable: async (_bytes, directory) => {
      fs.mkdirSync(directory, { recursive: true });
      const executable = path.join(directory, 'uv.exe');
      fs.writeFileSync(executable, 'mock uv');
      return executable;
    },
    runCommand: (_executable, _args, options) => {
      commandChild = new FakeChild(() => {});
      options.onChild?.(commandChild);
      markStarted();
      return new Promise(resolve => { releaseCommand = resolve; });
    },
    killProcessTree: async child => {
      killedPids.push(child.pid);
      child.emit('close', 1, null);
      releaseCommand?.({ code: 1, stdout: '', stderr: '' });
    }
  });
  t.after(harness.cleanup);

  const preparing = harness.manager.prepareSource('mediacrawler-lite');
  await started;
  const stopped = await harness.manager.stopAll();
  releaseCommand?.({ code: 1, stdout: '', stderr: '' });
  const result = await preparing;
  assert.equal(stopped.stopped, 1);
  assert.deepEqual(killedPids, [commandChild.pid]);
  assert.equal(result.code, 'CANCELLED');
});

test('命令超时会终止本进程树并保留超时状态', async () => {
  const child = new FakeChild(() => {});
  let terminationTarget;
  const result = await managerModule.runProcess('uv.exe', ['python', 'install'], {
    timeoutMs: 10,
    processPlatform: 'win32',
    spawnProcess: () => child,
    terminateProcessTree: async target => {
      terminationTarget = target;
      target.emit('close', 1, null);
    }
  });
  assert.equal(terminationTarget, child);
  assert.equal(result.timedOut, true);
});

test('health/session/detail/comments 分别拒绝不符合动作结构的响应数据', async t => {
  const cases = [
    { action: 'health', contentId: null, data: {} },
    { action: 'session', contentId: null, data: { loggedIn: 'yes' } },
    { action: 'detail', contentId: { bvid: 'BV1xx411c7mD' }, data: { View: 'malformed' } },
    { action: 'comments', data: { replies: 'malformed' } }
  ];
  for (const item of cases) {
    const harness = makeManager({
      isSourcePrepared: async () => true,
      killProcessTree: async child => child.emit('close', 1, null),
      spawnProcess: () => new FakeChild((process, line) => {
        const request = JSON.parse(line);
        process.stdout.write(JSON.stringify({
          protocolVersion: 1,
          requestId: request.requestId,
          type: 'result',
          result: {
            status: 'ok', action: request.action, platform: request.platform,
            profileId: request.profileId, data: item.data,
            budget: { usedRequests: 0, usedItems: 0, unknownRequests: 0 }
          }
        }) + '\n');
        process.emit('close', 0, null);
      })
    });
    t.after(harness.cleanup);
    const { data, ...overrides } = item;
    const action = validAction({ action: item.action, capability: item.action, ...overrides });
    const result = await harness.manager.executeAction(action);
    assert.equal(result.code, 'PROTOCOL_ERROR', item.action);
  }
});

test('session 未登录是合法成功响应', async t => {
  const harness = makeManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => new FakeChild((process, line) => {
      const request = JSON.parse(line);
      process.stdout.write(JSON.stringify({
        protocolVersion: 1,
        requestId: request.requestId,
        type: 'result',
        result: {
          status: 'ok', action: 'session', platform: request.platform,
          profileId: request.profileId, data: { loggedIn: false },
          budget: { usedRequests: 0, usedItems: 0, unknownRequests: 0 }
        }
      }) + '\n');
      process.emit('close', 0, null);
    })
  });
  t.after(harness.cleanup);
  const result = await harness.manager.executeAction(validAction({
    action: 'session', capability: 'session', contentId: null
  }));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data, { loggedIn: false });
});

test('error JSONL 帧校验预算并把 bridge unknownRequests 传回结果', async t => {
  for (const unknownRequests of [1, 1.5]) {
    const harness = makeManager({
      isSourcePrepared: async () => true,
      killProcessTree: async child => child.emit('close', 1, null),
      spawnProcess: () => new FakeChild((process, line) => {
        const request = JSON.parse(line);
        process.stdout.write(JSON.stringify({
          protocolVersion: 1,
          requestId: request.requestId,
          type: 'error',
          error: { code: 'REQUEST_FAILED' },
          budget: { usedRequests: 1, usedItems: 0, unknownRequests }
        }) + '\n');
        process.emit('close', 1, null);
      })
    });
    t.after(harness.cleanup);
    const result = await harness.manager.executeAction(validAction());
    if (Number.isInteger(unknownRequests)) {
      assert.equal(result.code, 'REQUEST_FAILED');
      assert.equal(result.budget.unknownRequests, 1);
    } else {
      assert.equal(result.code, 'PROTOCOL_ERROR');
    }
  }
});

test('manager 接受 bridge 的数据错误帧并保留稳定错误码', async t => {
  for (const code of ['INVALID_RESPONSE', 'IP_BLOCKED', 'ACCOUNT_RESTRICTED', 'PERMISSION_DENIED', 'PAGE_STRUCTURE_CHANGED']) {
    const harness = makeManager({
      isSourcePrepared: async () => true,
      spawnProcess: () => new FakeChild((process, line) => {
        const request = JSON.parse(line);
        process.stdout.write(`${JSON.stringify({
          protocolVersion: 1,
          requestId: request.requestId,
          type: 'error',
          error: { code },
          budget: { usedRequests: 0, usedItems: 0, unknownRequests: 0 }
        })}\n`);
        process.emit('close', 1, null);
      })
    });
    t.after(harness.cleanup);
    const result = await harness.manager.executeAction(validAction());
    assert.equal(result.code, code);
    assert.ok(result.message);
    if (code === 'PERMISSION_DENIED') assert.match(result.message, /没有访问该内容的权限/);
    if (code === 'PAGE_STRUCTURE_CHANGED') assert.match(result.message, /页面或响应结构已变化/);
  }
});

test('诊断 IPC 单独返回限量脱敏 stderr，环境错误正文不包含诊断内容', async t => {
  const registry = require('../server/social-source-registry');
  const source = registry.getSocialSource('mediacrawler-lite');
  const archive = Buffer.from('mock pinned uv archive');
  const lockBytes = fs.readFileSync(path.resolve(projectRoot, source.requirementsLockPath));
  const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const testRegistry = {
    ...registry,
    getSocialSource: id => ({
      ...source,
      requirementsLockSha256: digest(lockBytes),
      uvInstaller: { ...source.uvInstaller, windowsX64: { ...source.uvInstaller.windowsX64, sha256: digest(archive) } }
    })
  };
  const harness = makeManager({
    registry: testRegistry,
    processPlatform: 'win32',
    processArchitecture: 'x64',
    downloadUvArchive: async () => archive,
    extractUvExecutable: async (_bytes, directory) => {
      fs.mkdirSync(directory, { recursive: true });
      const executable = path.join(directory, 'uv.exe');
      fs.writeFileSync(executable, 'mock uv');
      return executable;
    },
    runCommand: async () => ({
      code: 1, stdout: '',
      stderr: 'Cookie: a=fake-marker-cookie-a; b=fake-marker-cookie-b\nSet-Cookie: c=fake-marker-set-cookie-a; d=fake-marker-set-cookie-b\nAuthorization: Bearer fake-marker-bearer\nProxy-Authorization: Basic fake-marker-basic\nX-Api-Key: fake-marker-api-key\ntoken=fake-marker-token\npassword=fake-marker-password\nsecret="fake-marker-secret"\nSESSDATA=fake-marker-sessdata\nbili_jct=fake-marker-bili-jct\nDedeUserID=fake-marker-dede-user-id\nDedeUserID__ckMd5=fake-marker-dede-user-md5\nxsec_token=fake-marker-xsec-token\nsid=fake-marker-sid\nSID=fake-marker-sid-upper\nac_time_value=fake-marker-ac-time\nAc_Time_Value=fake-marker-ac-time-upper\nrefresh_token=fake-marker-refresh-token\nRefresh_Token=fake-marker-refresh-token-upper\naccess_token=fake-marker-access-token\nACCESS_TOKEN=fake-marker-access-token-upper\nhttps://private.example/session'
    })
  });
  t.after(harness.cleanup);
  const preparation = await harness.manager.prepareSource('mediacrawler-lite');
  assert.equal(preparation.code, 'RUNTIME_INSTALL_FAILED');
  assert.equal(JSON.stringify(preparation).includes('fake-marker-'), false);
  assert.equal(JSON.stringify(preparation).includes('private.example'), false);
  const statePath = path.join(harness.userData, 'social-source', 'state', 'mediacrawler-lite.json');
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).state, 'error');

  const handlers = new Map();
  harness.manager.registerIpcHandlers({ handle: (channel, handler) => handlers.set(channel, handler) });
  const diagnostics = await handlers.get('social-source:diagnostics')({});
  assert.equal(diagnostics.status, 'ok');
  assert.equal(diagnostics.entries.length, 1);
  assert.match(diagnostics.entries[0], /Cookie: \[redacted\]/);
  assert.match(diagnostics.entries[0], /Set-Cookie: \[redacted\]/);
  assert.match(diagnostics.entries[0], /Authorization: Bearer \[redacted\]/i);
  assert.match(diagnostics.entries[0], /Proxy-Authorization: Basic \[redacted\]/i);
  assert.match(diagnostics.entries[0], /\[url\]/);
  assert.equal(diagnostics.entries[0].includes('fake-marker-'), false);
  for (const secret of [
    'fake-marker-cookie-a', 'fake-marker-cookie-b', 'fake-marker-set-cookie-a', 'fake-marker-set-cookie-b',
    'fake-marker-bearer', 'fake-marker-basic', 'fake-marker-api-key', 'fake-marker-token',
    'fake-marker-password', 'fake-marker-secret', 'fake-marker-sessdata', 'fake-marker-bili-jct',
    'fake-marker-dede-user-id', 'fake-marker-dede-user-md5', 'fake-marker-xsec-token',
    'fake-marker-sid', 'fake-marker-sid-upper', 'fake-marker-ac-time', 'fake-marker-ac-time-upper',
    'fake-marker-refresh-token', 'fake-marker-refresh-token-upper',
    'fake-marker-access-token', 'fake-marker-access-token-upper'
  ]) {
    assert.equal(diagnostics.entries[0].includes(secret), false, '诊断 IPC 不得返回凭证值');
  }
  const invalid = await handlers.get('social-source:diagnostics')({}, 'renderer-input');
  assert.equal(invalid.code, 'INVALID_REQUEST');
});

test('登录子进程自然退出时只发送固定 stopped 进度字段', async t => {
  const events = [];
  const harness = makeManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => {
      const child = new FakeChild(() => {});
      setImmediate(() => {
        child.stderr.write('Cookie: login-cookie-fixture\nAuthorization: Bearer login-auth-fixture\nProfile: C:\\private\\login-profile-fixture\n');
        child.stdout.write(JSON.stringify({
          protocolVersion: 1, type: 'login-ready', platform: 'bilibili', profileId: 'account_a'
        }) + '\n');
        setImmediate(() => child.emit('close', 0, null));
      });
      return child;
    }
  });
  t.after(harness.cleanup);
  const handlers = new Map();
  harness.manager.registerIpcHandlers({ handle: (channel, handler) => handlers.set(channel, handler) });

  const result = await handlers.get('social-source:open-login')({
    sender: { send: (channel, progress) => {
      events.push({ channel, progress });
    } }
  }, { sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a' });
  assert.equal(result.status, 'ok');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(events, [{
    channel: 'social-source:progress',
    progress: {
      sourceId: 'mediacrawler-lite', platform: 'bilibili',
      profileId: 'account_a', state: 'stopped'
    }
  }]);
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('login-cookie-fixture'), false);
  assert.equal(serialized.includes('login-auth-fixture'), false);
  assert.equal(serialized.includes('login-profile-fixture'), false);
});

test('login-ready 后非正常退出发送仅含白名单字段的 PROCESS_CRASHED 事件', async t => {
  for (const scenario of [
    { name: '非零退出码', code: 17, signal: null },
    { name: 'signal 退出', code: null, signal: 'SIGKILL' }
  ]) {
    await t.test(scenario.name, async t => {
      const events = [];
      const request = { sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a' };
      const harness = makeManager({
        isSourcePrepared: async () => true,
        spawnProcess: () => {
          const child = new FakeChild(() => {});
          setImmediate(() => {
            child.stderr.write('Cookie: fake-marker-crash-cookie\nC:\\private\\fake-marker-profile');
            child.stdout.write(`${JSON.stringify({
              protocolVersion: 1, type: 'login-ready', platform: request.platform, profileId: request.profileId
            })}\n`);
            setImmediate(() => child.emit('close', scenario.code, scenario.signal));
          });
          return child;
        }
      });
      t.after(harness.cleanup);
      const handlers = new Map();
      harness.manager.registerIpcHandlers({ handle: (channel, handler) => handlers.set(channel, handler) });

      const result = await handlers.get('social-source:open-login')({
        sender: { send: (channel, progress) => events.push({ channel, progress }) }
      }, request);
      assert.equal(result.status, 'ok', 'login-ready 仍代表窗口已成功启动');
      await new Promise(resolve => setImmediate(resolve));

      assert.deepEqual(events, [{
        channel: 'social-source:progress',
        progress: {
          sourceId: request.sourceId,
          platform: request.platform,
          profileId: request.profileId,
          state: 'error',
          code: 'PROCESS_CRASHED'
        }
      }]);
      assert.equal(JSON.stringify(events).includes('fake-marker'), false);
      assert.equal(JSON.stringify(events).includes('private'), false);
    });
  }
});

test('管理器主动停止已 ready 的登录进程时不发送自然退出通知', async t => {
  const events = [];
  const request = { sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a' };
  const harness = makeManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => {
      const child = new FakeChild(() => {});
      setImmediate(() => child.stdout.write(`${JSON.stringify({
        protocolVersion: 1, type: 'login-ready', platform: request.platform, profileId: request.profileId
      })}\n`));
      return child;
    },
    killProcessTree: async child => child.emit('close', null, 'SIGTERM')
  });
  t.after(harness.cleanup);
  const handlers = new Map();
  harness.manager.registerIpcHandlers({ handle: (channel, handler) => handlers.set(channel, handler) });

  const opened = await handlers.get('social-source:open-login')({
    sender: { send: (channel, progress) => events.push({ channel, progress }) }
  }, request);
  assert.equal(opened.status, 'ok');
  assert.deepEqual(await harness.manager.stopProfile(request), { status: 'ok', stopped: true });
  assert.deepEqual(events, []);
});

test('登录启动失败或未收到 login-ready 时保留错误结果且不发送 stopped', async t => {
  for (const scenario of [
    {
      name: '启动失败',
      spawnProcess: () => { throw new Error('fixture spawn failure'); },
      expectedCode: 'RUNTIME_MISSING'
    },
    {
      name: '未 ready 自然退出',
      spawnProcess: () => {
        const child = new FakeChild(() => {});
        setImmediate(() => child.emit('close', 0, null));
        return child;
      },
      expectedCode: 'PROTOCOL_ERROR'
    }
  ]) {
    await t.test(scenario.name, async t => {
      const events = [];
      const harness = makeManager({ isSourcePrepared: async () => true, spawnProcess: scenario.spawnProcess });
      t.after(harness.cleanup);
      const handlers = new Map();
      harness.manager.registerIpcHandlers({ handle: (channel, handler) => handlers.set(channel, handler) });

      const result = await handlers.get('social-source:open-login')({
        sender: { send: (channel, progress) => events.push({ channel, progress }) }
      }, { sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a' });

      assert.equal(result.status, 'error');
      assert.equal(result.code, scenario.expectedCode);
      assert.deepEqual(events, []);
    });
  }
});

test('stopAll 中止 installer 下载且 prepare 不会进入安装阶段', async t => {
  const registry = require('../server/social-source-registry');
  const source = registry.getSocialSource('mediacrawler-lite');
  const archive = Buffer.from('mock pinned uv archive');
  const lockBytes = fs.readFileSync(path.resolve(projectRoot, source.requirementsLockPath));
  const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const testRegistry = {
    ...registry,
    getSocialSource: id => ({
      ...source,
      requirementsLockSha256: digest(lockBytes),
      uvInstaller: { ...source.uvInstaller, windowsX64: { ...source.uvInstaller.windowsX64, sha256: digest(archive) } }
    })
  };
  let signal;
  let markDownloadStarted;
  const downloadStarted = new Promise(resolve => { markDownloadStarted = resolve; });
  let commandCount = 0;
  const harness = makeManager({
    registry: testRegistry,
    processPlatform: 'win32',
    processArchitecture: 'x64',
    downloadUvArchive: (_url, options) => {
      signal = options.signal;
      markDownloadStarted();
      return new Promise(resolve => signal.addEventListener('abort', () => resolve(archive), { once: true }));
    },
    extractUvExecutable: async () => {
      throw new Error('取消后不得解包或安装');
    },
    runCommand: async () => { commandCount += 1; return { code: 0, stdout: '', stderr: '' }; }
  });
  t.after(harness.cleanup);
  const preparing = harness.manager.prepareSource('mediacrawler-lite');
  await downloadStarted;
  await harness.manager.stopAll();
  const result = await preparing;
  assert.equal(signal.aborted, true);
  assert.equal(commandCount, 0);
  assert.equal(result.code, 'CANCELLED');
});

test('stopAll 等待不可立即响应取消的 installer 下载与 prepare 收尾', async t => {
  const registry = require('../server/social-source-registry');
  const source = registry.getSocialSource('mediacrawler-lite');
  const archive = Buffer.from('mock pinned uv archive');
  const lockBytes = fs.readFileSync(path.resolve(projectRoot, source.requirementsLockPath));
  const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const testRegistry = {
    ...registry,
    getSocialSource: id => ({
      ...source,
      requirementsLockSha256: digest(lockBytes),
      uvInstaller: { ...source.uvInstaller, windowsX64: { ...source.uvInstaller.windowsX64, sha256: digest(archive) } }
    })
  };
  let releaseDownload;
  let markDownloadStarted;
  const downloadStarted = new Promise(resolve => { markDownloadStarted = resolve; });
  const harness = makeManager({
    registry: testRegistry,
    processPlatform: 'win32',
    processArchitecture: 'x64',
    downloadUvArchive: () => {
      markDownloadStarted();
      return new Promise(resolve => { releaseDownload = resolve; });
    },
    extractUvExecutable: async () => { throw new Error('取消后不得解包'); },
    runCommand: async () => { throw new Error('取消后不得启动安装命令'); }
  });
  t.after(harness.cleanup);
  const preparing = harness.manager.prepareSource('mediacrawler-lite');
  await downloadStarted;
  let stopFinished = false;
  const stopping = harness.manager.stopAll().then(() => { stopFinished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopFinished, false);
  releaseDownload(archive);
  const result = await preparing;
  await stopping;
  assert.equal(result.code, 'CANCELLED');
  assert.equal(stopFinished, true);
});

test('取消动作必须等进程 close 后才完成并释放 profile 锁', async t => {
  let child;
  let releaseTermination;
  let markTerminationStarted;
  let markChildSpawned;
  const terminationStarted = new Promise(resolve => { markTerminationStarted = resolve; });
  const childSpawned = new Promise(resolve => { markChildSpawned = resolve; });
  const terminationGate = new Promise(resolve => { releaseTermination = resolve; });
  let launches = 0;
  const harness = makeManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => {
      launches += 1;
      child = new FakeChild(() => {});
      markChildSpawned();
      if (launches > 1) setImmediate(() => child.emit('close', 1, null));
      return child;
    },
    killProcessTree: async () => {
      markTerminationStarted();
      await terminationGate;
    }
  });
  t.after(harness.cleanup);

  const action = validAction();
  const running = harness.manager.executeAction(action);
  await childSpawned;
  const cancelling = harness.manager.cancelAction({
    sourceId: action.sourceId, platform: action.platform, profileId: action.profileId, taskId: action.taskId
  });
  await terminationStarted;
  releaseTermination();
  await new Promise(resolve => setTimeout(resolve, 1550));

  const whileChildOpen = await harness.manager.executeAction(validAction({ taskId: 'task_competing' }));
  assert.equal(whileChildOpen.code, 'SESSION_BUSY');

  child.emit('close', 1, null);
  const [cancelResult, actionResult] = await Promise.all([cancelling, running]);
  assert.equal(cancelResult.cancelled, true);
  assert.equal(actionResult.code, 'CANCELLED');

  const afterClose = await harness.manager.executeAction(validAction({ taskId: 'task_after_close' }));
  assert.notEqual(afterClose.code, 'SESSION_BUSY');
});

test('stopAll 等待动作进程实际 close，而不只等待终止命令返回', async t => {
  let child;
  let markTerminationFinished;
  const terminationFinished = new Promise(resolve => { markTerminationFinished = resolve; });
  const harness = makeManager({
    isSourcePrepared: async () => true,
    spawnProcess: () => {
      child = new FakeChild(() => {});
      return child;
    },
    killProcessTree: async () => { markTerminationFinished(); }
  });
  t.after(harness.cleanup);

  const running = harness.manager.executeAction(validAction());
  await new Promise(resolve => setImmediate(resolve));
  let stopFinished = false;
  const stopping = harness.manager.stopAll().then(() => { stopFinished = true; });
  await terminationFinished;
  await new Promise(resolve => setTimeout(resolve, 1550));
  assert.equal(stopFinished, false);

  child.emit('close', 1, null);
  await Promise.all([running, stopping]);
  assert.equal(stopFinished, true);
});

test('来源准备期间动作和登录都返回 SESSION_BUSY', async t => {
  const registry = require('../server/social-source-registry');
  const source = registry.getSocialSource('mediacrawler-lite');
  const archive = Buffer.from('mock uv archive for maintenance lock');
  const lockBytes = fs.readFileSync(path.resolve(projectRoot, source.requirementsLockPath));
  const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const testRegistry = {
    ...registry,
    getSocialSource: id => ({
      ...source,
      requirementsLockSha256: digest(lockBytes),
      uvInstaller: { ...source.uvInstaller, windowsX64: { ...source.uvInstaller.windowsX64, sha256: digest(archive) } }
    })
  };
  let releaseDownload;
  let markDownloadStarted;
  const downloadStarted = new Promise(resolve => { markDownloadStarted = resolve; });
  let launches = 0;
  const harness = makeManager({
    registry: testRegistry,
    processPlatform: 'win32',
    processArchitecture: 'x64',
    isSourcePrepared: async () => true,
    downloadUvArchive: (_url, { signal }) => {
      markDownloadStarted();
      return new Promise(resolve => {
        releaseDownload = () => resolve(archive);
        signal.addEventListener('abort', releaseDownload, { once: true });
      });
    },
    spawnProcess: (_executable, args) => {
      launches += 1;
      const child = new FakeChild((process, line) => {
        const request = JSON.parse(line);
        process.stdout.write(JSON.stringify({
          protocolVersion: 1, requestId: request.requestId, type: 'result',
          result: { status: 'ok', action: request.action, platform: request.platform,
            profileId: request.profileId, data: { replies: [] },
            budget: { usedRequests: 0, usedItems: 0, unknownRequests: 0 } }
        }) + '\n');
        process.emit('close', 0, null);
      });
      if (args.includes('--open-login')) setImmediate(() => {
        child.stdout.write(JSON.stringify({ protocolVersion: 1, type: 'login-ready',
          platform: 'bilibili', profileId: 'account_a' }) + '\n');
        child.emit('close', 0, null);
      });
      return child;
    }
  });
  t.after(async () => { await harness.manager.stopAll(); harness.cleanup(); });

  const preparing = harness.manager.prepareSource('mediacrawler-lite');
  await downloadStarted;
  const actionResult = await harness.manager.executeAction(validAction());
  const loginResult = await harness.manager.openLogin({
    sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a'
  });
  assert.equal(actionResult.code, 'SESSION_BUSY');
  assert.equal(loginResult.code, 'SESSION_BUSY');
  assert.equal(launches, 0);

  await harness.manager.stopAll();
  releaseDownload();
  const prepareResult = await preparing;
  assert.equal(prepareResult.code, 'CANCELLED');
});

test('执行动作或登录期间来源准备返回 SESSION_BUSY', async t => {
  for (const operationType of ['action', 'login']) {
    let releaseReadiness;
    let markReadinessStarted;
    const readiness = new Promise(resolve => { releaseReadiness = resolve; });
    const readinessStarted = new Promise(resolve => { markReadinessStarted = resolve; });
    const harness = makeManager({
      processPlatform: 'linux',
      isSourcePrepared: () => { markReadinessStarted(); return readiness; }
    });
    t.after(harness.cleanup);
    const operation = operationType === 'action'
      ? harness.manager.executeAction(validAction())
      : harness.manager.openLogin({ sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a' });
    await readinessStarted;
    const prepareResult = await harness.manager.prepareSource('mediacrawler-lite');
    releaseReadiness(false);
    await operation;
    assert.equal(prepareResult.code, 'SESSION_BUSY', operationType);
  }
});

test('uv 解包部分写入失败时不会留下最终 uv.exe', t => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'social-source-uv-atomic-'));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  const archive = makeStoredZipEntry('uv.exe', Buffer.from('pinned uv executable'));
  const fsWithPartialWrite = new Proxy(fs, {
    get(target, property) {
      if (property === 'writeFileSync') {
        return (filePath, data, options) => {
          target.writeFileSync(filePath, data.subarray(0, 4), options);
          throw new Error('simulated partial write');
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

  assert.throws(() => managerModule.extractUvExecutable(archive, destination, fsWithPartialWrite), {
    code: 'RUNTIME_INSTALL_FAILED'
  });
  assert.equal(fs.existsSync(path.join(destination, 'uv.exe')), false);
  assert.deepEqual(fs.readdirSync(destination), []);
});

test('已有损坏 uv.exe 版本检查失败后会删除并重新安装', async t => {
  const registry = require('../server/social-source-registry');
  const source = registry.getSocialSource('mediacrawler-lite');
  const archive = Buffer.from('mock pinned uv archive for recovery');
  const lockBytes = fs.readFileSync(path.resolve(projectRoot, source.requirementsLockPath));
  const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const testRegistry = {
    ...registry,
    getSocialSource: id => ({
      ...source,
      requirementsLockSha256: digest(lockBytes),
      uvInstaller: { ...source.uvInstaller, windowsX64: { ...source.uvInstaller.windowsX64, sha256: digest(archive) } }
    })
  };
  let downloadCount = 0;
  let extractionCount = 0;
  let uvChecks = 0;
  const harness = makeManager({
    registry: testRegistry,
    processPlatform: 'win32',
    processArchitecture: 'x64',
    downloadUvArchive: async () => { downloadCount += 1; return archive; },
    extractUvExecutable: async (_bytes, directory) => {
      extractionCount += 1;
      fs.mkdirSync(directory, { recursive: true });
      const executable = path.join(directory, 'uv.exe');
      fs.writeFileSync(executable, 'valid uv executable');
      return executable;
    },
    runCommand: async (executable, args) => {
      if (path.basename(executable).toLowerCase() === 'uv.exe' && args[0] === '--version') {
        uvChecks += 1;
        if (fs.readFileSync(executable, 'utf8') === 'corrupt uv') {
          return { code: 1, stdout: '', stderr: 'bad uv binary' };
        }
        return { code: 0, stdout: 'uv 0.13.2', stderr: '' };
      }
      if (args[0] === 'venv') {
        const venvPath = args.at(-1);
        fs.mkdirSync(path.join(venvPath, 'Scripts'), { recursive: true });
        fs.writeFileSync(path.join(venvPath, 'Scripts', 'python.exe'), 'mock python');
      }
      if (args.includes('playwright') && args.includes('install')) {
        fs.mkdirSync(path.join(harness.userData, 'social-source', 'browsers'), { recursive: true });
      }
      if (args[0] === '-c') {
        return { code: 0, stdout: JSON.stringify({
          version: '3.11.9',
          basePrefix: path.join(harness.userData, 'social-source', 'runtime', 'python', 'cpython-3.11.9'),
          playwright: '1.64.0'
        }), stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
  });
  t.after(harness.cleanup);
  const uvPath = path.join(harness.userData, 'social-source', 'runtime', 'uv', source.uvInstaller.version, 'uv.exe');
  fs.mkdirSync(path.dirname(uvPath), { recursive: true });
  fs.writeFileSync(uvPath, 'corrupt uv');

  const result = await harness.manager.prepareSource('mediacrawler-lite');
  assert.equal(result.status, 'ok');
  assert.equal(downloadCount, 1);
  assert.equal(extractionCount, 1);
  assert.ok(uvChecks >= 2);
  assert.equal(fs.readFileSync(uvPath, 'utf8'), 'valid uv executable');
});

test('Windows Job capability 只走 stdin，命名碰撞不触发 recovery 并释放 profile 锁', async t => {
  const supervisorPath = path.join(projectRoot, 'vendor', 'mediacrawler-bridge', 'windows_job_supervisor.py');
  let workerStarts = 0;
  let recoveryCalls = 0;
  let processTreeKills = 0;
  const harness = makeManager({
    processPlatform: 'win32', processArchitecture: 'x64', superviseWindowsProcesses: true,
    isSourcePrepared: async () => true,
    killProcessTree: async () => { processTreeKills += 1; },
    runCommand: async () => {
      recoveryCalls += 1;
      return { code: 1, stdout: '', stderr: '', timedOut: false, cancelled: false };
    },
    spawnProcess: (_executable, args) => {
      workerStarts += 1;
      assert.equal(path.resolve(args[1]), supervisorPath);
      assert.ok(!args.includes('--nonce'));
      assert.ok(!args.includes('--job-name'));
      assert.ok(!args.includes('--cleanup-job-name'));
      assert.ok(args.every(value => !String(value).startsWith('Local\\SocialSourceJob-')));
      return new FakeChild((child, line) => {
        const start = JSON.parse(line);
        assert.equal(start.type, 'start');
        assert.equal(start.protocolVersion, 1);
        assert.match(start.nonce, /^[A-Za-z0-9_-]{16,64}$/);
        assert.match(start.capability, /^[A-Za-z0-9_-]{43}$/);
        assert.match(start.jobName, /^Local\\SocialSourceJob-[a-f0-9]{64}$/);
        assert.ok(args.every(value => ![start.nonce, start.capability, start.jobName]
          .some(secret => String(value).includes(secret))));
        if (workerStarts === 1) {
          child.stderr.write(`SOCIAL_SOURCE_SUPERVISOR:${JSON.stringify({
            type: 'job-collision', protocolVersion: 1, nonce: start.nonce, jobName: start.jobName
          })}\n`);
          setImmediate(() => child.emit('close', 73, null));
          return;
        }
        const request = start.request;
        child.stdout.write(`${JSON.stringify({
          protocolVersion: 1, requestId: request.requestId, type: 'result',
          result: { status: 'ok', action: request.action, platform: request.platform,
            profileId: request.profileId, data: { replies: [] },
            budget: { usedRequests: 0, usedItems: 0, unknownRequests: 0 } }
        })}\n`);
        child.stderr.write(`SOCIAL_SOURCE_SUPERVISOR:${JSON.stringify({
          type: 'tree-clean', protocolVersion: 1, nonce: start.nonce, activeProcesses: 0
        })}\n`);
        setImmediate(() => child.emit('close', 0, null));
      });
    }
  });
  t.after(harness.cleanup);

  const action = validAction({ profileId: 'collision_profile' });
  const collision = await harness.manager.executeAction(action);
  assert.equal(collision.code, 'JOB_COLLISION');
  assert.equal(recoveryCalls, 0, '碰撞的同名 Job 不得交给 cleanup helper');
  const retry = await harness.manager.executeAction(action);
  assert.equal(retry.status, 'ok', '未启动 worker 的碰撞应释放 profile 锁');
  assert.equal(workerStarts, 2);
  assert.equal(recoveryCalls, 0);
  assert.equal(processTreeKills, 0, '碰撞不能触发对同名 Job 的进程树清理');
});

test('Windows login Job collision 返回失败、不恢复对方 Job 且释放 profile 锁', async t => {
  let workerStarts = 0;
  let recoveryCalls = 0;
  let nonce;
  let child;
  const harness = makeManager({
    processPlatform: 'win32', processArchitecture: 'x64', superviseWindowsProcesses: true,
    isSourcePrepared: async () => true,
    killProcessTree: async () => assert.fail('collision must not terminate the foreign Job'),
    runCommand: async () => { recoveryCalls += 1; throw new Error('collision must not run cleanup'); },
    spawnProcess: () => {
      workerStarts += 1;
      child = new FakeChild((process, line) => {
        const frame = JSON.parse(line);
        if (frame.type === 'start') {
          nonce = frame.nonce;
          if (workerStarts === 1) {
            process.stderr.write(`SOCIAL_SOURCE_SUPERVISOR:${JSON.stringify({
              type: 'job-collision', protocolVersion: 1, nonce, jobName: frame.jobName
            })}\n`);
            setImmediate(() => process.emit('close', 73, null));
            return;
          }
          process.stdout.write(`${JSON.stringify({ protocolVersion: 1, type: 'login-ready',
            platform: 'bilibili', profileId: 'account_a' })}\n`);
          return;
        }
        assert.deepEqual(frame, { type: 'stop', nonce });
        process.stderr.write(`SOCIAL_SOURCE_SUPERVISOR:${JSON.stringify({
          type: 'tree-clean', protocolVersion: 1, nonce, activeProcesses: 0
        })}\n`);
        setImmediate(() => process.emit('close', 0, null));
      });
      return child;
    }
  });
  t.after(harness.cleanup);

  const request = { sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a' };
  const collision = await harness.manager.openLogin(request);
  assert.equal(collision.code, 'JOB_COLLISION');
  assert.equal(recoveryCalls, 0);
  const retry = await harness.manager.openLogin(request);
  assert.equal(retry.status, 'ok', '碰撞后 profile 锁应已释放');
  assert.deepEqual(await harness.manager.stopProfile(request), { status: 'ok', stopped: true });
  assert.equal(workerStarts, 2);
  assert.equal(recoveryCalls, 0);
});

test('Windows cleanup helper 的授权身份只通过 stdin 传递', async t => {
  const supervisorPath = path.join(projectRoot, 'vendor', 'mediacrawler-bridge', 'windows_job_supervisor.py');
  let startFrame;
  let cleanupArgs;
  let cleanupOptions;
  const harness = makeManager({
    processPlatform: 'win32', processArchitecture: 'x64', superviseWindowsProcesses: true,
    isSourcePrepared: async () => true,
    runCommand: async (_executable, args, options) => {
      cleanupArgs = args;
      cleanupOptions = options;
      const cleanup = JSON.parse(options.input);
      return { code: 0, stdout: `${JSON.stringify({
        type: 'job-cleanup', protocolVersion: 1, nonce: cleanup.nonce,
        jobName: cleanup.jobName, jobFound: true, activeProcesses: 0, jobClosed: true
      })}\n`, stderr: '', timedOut: false, cancelled: false };
    },
    spawnProcess: (_executable, args) => new FakeChild((child, line) => {
      startFrame = JSON.parse(line);
      assert.equal(path.resolve(args[1]), supervisorPath);
      assert.ok(!args.includes('--nonce'));
      assert.ok(!args.includes('--job-name'));
      assert.ok(args.every(value => ![startFrame.nonce, startFrame.capability, startFrame.jobName]
        .some(secret => String(value).includes(secret))));
      setImmediate(() => child.emit('close', 1, null));
    })
  });
  t.after(harness.cleanup);

  const result = await harness.manager.executeAction(validAction({ profileId: 'stdin_cleanup' }));
  assert.equal(result.code, 'PROCESS_CRASHED');
  assert.deepEqual(cleanupArgs, ['-u', supervisorPath, '--cleanup']);
  assert.deepEqual(JSON.parse(cleanupOptions.input), {
    type: 'cleanup', protocolVersion: 1, nonce: startFrame.nonce,
    capability: startFrame.capability, jobName: startFrame.jobName
  });
  assert.ok(!Object.values(cleanupOptions.env).some(value => [startFrame.nonce, startFrame.capability, startFrame.jobName]
    .some(secret => String(value).includes(secret))));
});

test('Windows worker 只有收到 cleanup helper 的 Job 清理确认才释放 profile 锁', async t => {
  for (const cleanConfirmed of [false, true]) {
    const supervisorPath = path.join(projectRoot, 'vendor', 'mediacrawler-bridge', 'windows_job_supervisor.py');
    const harness = makeManager({
      processPlatform: 'win32',
      processArchitecture: 'x64',
      superviseWindowsProcesses: true,
      isSourcePrepared: async () => true,
      spawnProcess: (_executable, args) => {
        assert.equal(path.resolve(args[1]), supervisorPath);
        return new FakeChild((child, line) => {
          const control = JSON.parse(line);
          assert.equal(control.type, 'start');
          const nonce = control.nonce;
          assert.match(control.capability, /^[A-Za-z0-9_-]{43}$/);
          assert.match(control.jobName, /^Local\\SocialSourceJob-[a-f0-9]{64}$/);
          assert.ok(!args.some(value => [nonce, control.capability, control.jobName].some(secret => String(value).includes(secret))));
          const request = control.request;
          child.stdout.write(JSON.stringify({
            protocolVersion: 1, requestId: request.requestId, type: 'result',
            result: { status: 'ok', action: request.action, platform: request.platform,
              profileId: request.profileId, data: { replies: [] },
              budget: { usedRequests: 0, usedItems: 0, unknownRequests: 0 } }
          }) + '\n');
          if (cleanConfirmed) child.stderr.write(`SOCIAL_SOURCE_SUPERVISOR:${JSON.stringify({
            type: 'tree-clean', protocolVersion: 1, nonce, activeProcesses: 0
          })}\n`);
          child.emit('close', 0, null);
        });
      }
    });
    t.after(harness.cleanup);

    const action = validAction({ profileId: cleanConfirmed ? 'clean_profile' : 'uncertain_profile' });
    const result = await harness.manager.executeAction(action);
    if (cleanConfirmed) {
      assert.equal(result.status, 'ok');
    } else {
      assert.equal(result.code, 'PROCESS_CRASHED');
      const repeated = await harness.manager.executeAction(action);
      assert.equal(repeated.code, 'SESSION_BUSY');
    }
  }
});

test('Windows login 使用 Job supervisor，停止时控制帧不进入桥接 stdout', async t => {
  const supervisorPath = path.join(projectRoot, 'vendor', 'mediacrawler-bridge', 'windows_job_supervisor.py');
  let child;
  let nonce;
  const workerStdout = [];
  const harness = makeManager({
    processPlatform: 'win32',
    processArchitecture: 'x64',
    superviseWindowsProcesses: true,
    isSourcePrepared: async () => true,
    spawnProcess: (_executable, args) => {
      assert.equal(path.resolve(args[1]), supervisorPath);
      child = new FakeChild((process, line) => {
        const control = JSON.parse(line);
        if (control.type === 'start') {
          nonce = control.nonce;
          process.stdout.write(JSON.stringify({ protocolVersion: 1, type: 'login-ready',
            platform: 'bilibili', profileId: 'account_a' }) + '\n');
          return;
        }
        assert.deepEqual(control, { type: 'stop', nonce });
        process.stderr.write(`SOCIAL_SOURCE_SUPERVISOR:${JSON.stringify({
          type: 'tree-clean', protocolVersion: 1, nonce, activeProcesses: 0
        })}\n`);
        setImmediate(() => process.emit('close', 0, null));
      });
      const writeStdout = child.stdout.write.bind(child.stdout);
      child.stdout.write = chunk => { workerStdout.push(String(chunk)); return writeStdout(chunk); };
      return child;
    }
  });
  t.after(harness.cleanup);

  const opened = await harness.manager.openLogin({
    sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a'
  });
  assert.equal(opened.status, 'ok');
  assert.ok(nonce);
  assert.deepEqual(workerStdout.map(line => JSON.parse(line).type), ['login-ready']);
  const stopped = await harness.manager.stopProfile({
    sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a'
  });
  assert.equal(stopped.stopped, true);
  assert.equal(child.killed, false);
});

test('Windows login 清理未获 Job 确认时保留 profile 锁并返回失败', async t => {
  let child;
  let nonce;
  const harness = makeManager({
    processPlatform: 'win32',
    processArchitecture: 'x64',
    superviseWindowsProcesses: true,
    isSourcePrepared: async () => true,
    spawnProcess: (_executable, args) => {
      child = new FakeChild((process, line) => {
        const control = JSON.parse(line);
        if (control.type === 'start') {
          nonce = control.nonce;
          process.stdout.write(JSON.stringify({ protocolVersion: 1, type: 'login-ready',
            platform: 'bilibili', profileId: 'account_a' }) + '\n');
        } else {
          setImmediate(() => process.emit('close', 1, null));
        }
      });
      return child;
    }
  });
  t.after(harness.cleanup);

  const opened = await harness.manager.openLogin({
    sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a'
  });
  assert.equal(opened.status, 'ok');
  assert.ok(nonce);
  const stopped = await harness.manager.stopProfile({
    sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a'
  });
  assert.equal(stopped.code, 'PROCESS_CRASHED');
  const retry = await harness.manager.openLogin({
    sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a'
  });
  assert.equal(retry.code, 'SESSION_BUSY');
});

test('Windows supervisor 异常退出后固定 cleanup helper 确认清理并恢复 profile 锁', async t => {
  let recoveryCalls = 0;
  let workerStarts = 0;
  const harness = makeManager({
    processPlatform: 'win32', processArchitecture: 'x64', superviseWindowsProcesses: true,
    isSourcePrepared: async () => true,
    runCommand: async (_executable, args, options) => {
      recoveryCalls += 1;
      const cleanup = JSON.parse(options.input);
      const { nonce, jobName } = cleanup;
      assert.deepEqual(args, ['-u', path.join(projectRoot, 'vendor', 'mediacrawler-bridge', 'windows_job_supervisor.py'), '--cleanup']);
      assert.ok(!args.includes(nonce) && !args.includes(jobName) && !args.includes(cleanup.capability));
      return { code: 0, stdout: `${JSON.stringify({
        type: 'job-cleanup', protocolVersion: 1, nonce, jobName,
        jobFound: true, activeProcesses: 0, jobClosed: true
      })}\n`, stderr: '', timedOut: false, cancelled: false };
    },
    spawnProcess: (_executable, args) => {
      workerStarts += 1;
      return new FakeChild((process, line) => {
        const start = JSON.parse(line);
        if (start.type !== 'start') return;
        const { nonce, jobName, capability } = start;
        assert.ok(!args.includes('--nonce') && !args.includes('--job-name'));
        assert.ok(args.every(value => ![nonce, jobName, capability].some(secret => String(value).includes(secret))));
        const request = start.request;
        process.stdout.write(`${JSON.stringify({
          protocolVersion: 1, requestId: request.requestId, type: 'result',
          result: { status: 'ok', action: request.action, platform: request.platform,
            profileId: request.profileId, data: { replies: [] },
            budget: { usedRequests: 0, usedItems: 0, unknownRequests: 0 } }
        })}\n`);
        if (workerStarts > 1) process.stderr.write(`SOCIAL_SOURCE_SUPERVISOR:${JSON.stringify({
          type: 'tree-clean', protocolVersion: 1, nonce, activeProcesses: 0
        })}\n`);
        setImmediate(() => process.emit('close', workerStarts > 1 ? 0 : 1, null));
      });
    }
  });
  t.after(harness.cleanup);

  const first = await harness.manager.executeAction(validAction());
  assert.equal(first.code, 'PROCESS_CRASHED');
  assert.equal(recoveryCalls, 1);
  const second = await harness.manager.executeAction(validAction());
  assert.equal(second.status, 'ok');
  assert.equal(workerStarts, 2);
});

test('cleanup helper 失败时 profile 锁保留，stopProfile 重试成功后解锁', async t => {
  let recoveryCalls = 0;
  let workerStarts = 0;
  const harness = makeManager({
    processPlatform: 'win32', processArchitecture: 'x64', superviseWindowsProcesses: true,
    isSourcePrepared: async () => true,
    runCommand: async (_executable, args, options) => {
      recoveryCalls += 1;
      if (recoveryCalls === 1) return { code: 1, stdout: '', stderr: '', timedOut: false, cancelled: false };
      const cleanup = JSON.parse(options.input);
      const { nonce, jobName } = cleanup;
      assert.ok(!args.includes(nonce) && !args.includes(jobName) && !args.includes(cleanup.capability));
      return { code: 0, stdout: `${JSON.stringify({
        type: 'job-cleanup', protocolVersion: 1, nonce, jobName,
        jobFound: false, activeProcesses: 0, jobClosed: true
      })}\n`, stderr: '', timedOut: false, cancelled: false };
    },
    spawnProcess: (_executable, args) => {
      workerStarts += 1;
      return new FakeChild((process, line) => {
        const start = JSON.parse(line);
        if (start.type !== 'start') return;
        const nonce = start.nonce;
        assert.ok(!args.includes('--nonce') && !args.includes('--job-name'));
        assert.ok(args.every(value => ![start.nonce, start.jobName, start.capability]
          .some(secret => String(value).includes(secret))));
        const request = start.request;
        process.stdout.write(`${JSON.stringify({
          protocolVersion: 1, requestId: request.requestId, type: 'result',
          result: { status: 'ok', action: request.action, platform: request.platform,
            profileId: request.profileId, data: { replies: [] },
            budget: { usedRequests: 0, usedItems: 0, unknownRequests: 0 } }
        })}\n`);
        if (workerStarts > 1) process.stderr.write(`SOCIAL_SOURCE_SUPERVISOR:${JSON.stringify({
          type: 'tree-clean', protocolVersion: 1, nonce, activeProcesses: 0
        })}\n`);
        setImmediate(() => process.emit('close', workerStarts > 1 ? 0 : 1, null));
      });
    }
  });
  t.after(harness.cleanup);

  assert.equal((await harness.manager.executeAction(validAction())).code, 'PROCESS_CRASHED');
  assert.equal(recoveryCalls, 1);
  assert.equal((await harness.manager.executeAction(validAction())).code, 'SESSION_BUSY');
  const recovered = await harness.manager.stopProfile({
    sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a'
  });
  assert.equal(recovered.status, 'ok');
  assert.equal(recovered.stopped, true);
  assert.equal(recoveryCalls, 2);
  assert.equal((await harness.manager.executeAction(validAction())).status, 'ok');
  assert.equal(workerStarts, 2);
});

test('cleanup helper 缺少任一精确清理证明时都保留 profile 锁', async t => {
  const invalidProofs = [
    { name: 'invalid JSON', corrupt: () => null, stdout: 'not-json\n' },
    { name: 'nonzero exit', exitCode: 1 },
    { name: 'wrong nonce', corrupt: frame => { frame.nonce = 'other-nonce-value-123456'; } },
    { name: 'wrong job name', corrupt: frame => { frame.jobName = 'Local\\OtherJob'; } },
    { name: 'active processes remain', corrupt: frame => { frame.activeProcesses = 1; } },
    { name: 'non-integer process count', corrupt: frame => { frame.activeProcesses = '0'; } },
    { name: 'job handle not closed', corrupt: frame => { frame.jobClosed = false; } },
    { name: 'invalid jobFound type', corrupt: frame => { frame.jobFound = 'false'; } }
  ];
  for (const [index, invalid] of invalidProofs.entries()) {
    const profileId = `invalid_proof_${index}`;
    const harness = makeManager({
      processPlatform: 'win32', processArchitecture: 'x64', superviseWindowsProcesses: true,
      isSourcePrepared: async () => true,
      runCommand: async (_executable, args, options) => {
        const cleanup = JSON.parse(options.input);
        const { nonce, jobName } = cleanup;
        assert.ok(!args.includes(nonce) && !args.includes(jobName) && !args.includes(cleanup.capability));
        const frame = {
          type: 'job-cleanup', protocolVersion: 1, nonce, jobName,
          jobFound: false, activeProcesses: 0, jobClosed: true
        };
        invalid.corrupt?.(frame);
        return {
          code: invalid.exitCode ?? 0,
          stdout: invalid.stdout ?? `${JSON.stringify(frame)}\n`,
          stderr: '', timedOut: false, cancelled: false
        };
      },
      spawnProcess: () => new FakeChild((process, line) => {
        const start = JSON.parse(line);
        if (start.type !== 'start') return;
        const request = start.request;
        process.stdout.write(`${JSON.stringify({
          protocolVersion: 1, requestId: request.requestId, type: 'result',
          result: { status: 'ok', action: request.action, platform: request.platform,
            profileId: request.profileId, data: { replies: [] },
            budget: { usedRequests: 0, usedItems: 0, unknownRequests: 0 } }
        })}\n`);
        setImmediate(() => process.emit('close', 1, null));
      })
    });
    t.after(harness.cleanup);

    const action = validAction({ profileId });
    assert.equal((await harness.manager.executeAction(action)).code, 'PROCESS_CRASHED', invalid.name);
    assert.equal((await harness.manager.executeAction(action)).code, 'SESSION_BUSY', invalid.name);
  }
});

test('login stop 缺少 supervisor 确认但 cleanup helper 成功时返回成功并释放锁', async t => {
  let child;
  let nonce;
  let cleanupCalls = 0;
  const harness = makeManager({
    processPlatform: 'win32', processArchitecture: 'x64', superviseWindowsProcesses: true,
    isSourcePrepared: async () => true,
    runCommand: async (_executable, args, options) => {
      cleanupCalls += 1;
      const cleanup = JSON.parse(options.input);
      const { nonce, jobName } = cleanup;
      assert.ok(!args.includes(nonce) && !args.includes(jobName) && !args.includes(cleanup.capability));
      return { code: 0, stdout: `${JSON.stringify({
        type: 'job-cleanup', protocolVersion: 1, nonce, jobName,
        jobFound: true, activeProcesses: 0, jobClosed: true
      })}\n`, stderr: '', timedOut: false, cancelled: false };
    },
    spawnProcess: (_executable, args) => {
      child = new FakeChild((process, line) => {
        const control = JSON.parse(line);
        if (control.type === 'start') {
          nonce = control.nonce;
          assert.ok(args.every(value => ![control.nonce, control.jobName, control.capability]
            .some(secret => String(value).includes(secret))));
          process.stdout.write(`${JSON.stringify({ protocolVersion: 1, type: 'login-ready',
            platform: 'bilibili', profileId: 'account_a' })}\n`);
          return;
        }
        assert.deepEqual(control, { type: 'stop', nonce });
        setImmediate(() => process.emit('close', 1, null));
      });
      return child;
    }
  });
  t.after(harness.cleanup);

  const opened = await harness.manager.openLogin({
    sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a'
  });
  assert.equal(opened.status, 'ok');
  const stopped = await harness.manager.stopProfile({
    sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a'
  });
  assert.deepEqual(stopped, { status: 'ok', stopped: true });
  assert.equal(cleanupCalls, 1);
  const nextLogin = await harness.manager.openLogin({
    sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a'
  });
  assert.equal(nextLogin.status, 'ok', '清理确认成功后应释放 profile 锁');
  const stoppedAgain = await harness.manager.stopProfile({
    sourceId: 'mediacrawler-lite', platform: 'bilibili', profileId: 'account_a'
  });
  assert.deepEqual(stoppedAgain, { status: 'ok', stopped: true });
  assert.equal(cleanupCalls, 2);
});
