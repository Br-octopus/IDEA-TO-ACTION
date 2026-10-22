const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ui = require('../prototype/social-research-ui.js');
const { createBrowserPlatformAdapters } = require('../electron/social-browser-adapters.js');

const root = path.resolve(__dirname, '..');

function makeUiDocument({ checkedPlatforms = [] } = {}) {
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: '', innerHTML: '', textContent: '', disabled: false, style: {}, dataset: {}, listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; }
    });
    return nodes.get(id);
  };
  return {
    nodes,
    getNode,
    document: {
      getElementById: getNode,
      querySelectorAll(selector) {
        return selector === '[data-social-platform]:checked' ? checkedPlatforms.map(value => ({ value })) : [];
      },
      querySelector() { return null; }
    }
  };
}

async function checkPlatformConnection(checked) {
  const nodes = new Map();
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {
        addEventListener(type, listener) { this.listeners ||= {}; this.listeners[type] = listener; },
        style: {}, value: '', dataset: {}
      });
      return nodes.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  let savedState;
  const state = { platformConnections: {} };
  const uiInstance = ui.createSocialResearchUI({
    document,
    desktopApi: { social: {
      listPlatforms: async () => [{ platform: 'xiaohongshu', domestic: true, supportsSearch: true, browserSearchRegistered: true }],
      getStatus: async () => ({ apiConfigured: false }),
      check: async () => checked
    } },
    coordinator: {},
    getState: () => state,
    persistState: value => { savedState = value; }
  });
  await uiInstance.refreshPlatforms();
  nodes.get('social-platform-cards').listeners.click({
    target: { closest: () => ({ dataset: { socialAction: 'check', platform: 'xiaohongshu' } }) }
  });
  await new Promise(resolve => setImmediate(resolve));
  return savedState.platformConnections.xiaohongshu;
}

test('研究页包含工作流、平台准备、结果和报告入口及明确的只读提示', () => {
  const html = fs.readFileSync(path.join(root, 'prototype/index.html'), 'utf8');
  for (const id of [
    'social-research-entry', 'social-research-template', 'social-research-platforms',
    'social-research-plan', 'social-research-plan-confirm', 'social-platform-preparation',
    'social-research-operations',
    'social-research-status', 'social-research-results', 'social-research-report',
    'social-research-save-selection', 'social-research-read-details', 'social-research-read-comments',
    'social-research-save-materials', 'social-research-regenerate-report', 'social-research-read-transcript'
  ]) assert.ok(html.includes(`id="${id}"`), `缺少研究 UI 入口 ${id}`);
  assert.match(html, /id="social-research-read-transcript"[^>]*disabled/);
  assert.match(html, /读取 B 站字幕（不可用）/);
  for (const copy of ['API', '真实浏览器', '自动回退', '独立 profile', '只读', '登录状态', '未核验', '不会自动发布']) {
    assert.ok(html.includes(copy), `缺少边界说明：${copy}`);
  }
  const schema = html.indexOf('src="/prototype/social-research-schema.js"');
  const workflow = html.indexOf('src="/prototype/social-research-workflow.js"');
  const uiScript = html.indexOf('src="/prototype/social-research-ui.js"');
  const app = html.indexOf('src="/prototype/app.js"');
  assert.ok(schema >= 0 && schema < workflow && workflow < uiScript && uiScript < app, '研究模块必须按 schema、workflow、UI、app 顺序加载');
});

test('来源面板恢复中断操作，展示进度和操作 ID，且字幕候选保持禁用', async () => {
  const { document, nodes, getNode } = makeUiDocument();
  const operationId = '00000000-0000-4000-8000-000000000007';
  const source = {
    id: 'mediacrawler-lite', name: 'MediaCrawler 固定适配器', version: '1.0.0', available: true,
    platforms: ['xiaohongshu', 'bilibili'], capabilities: { xiaohongshu: ['detail'], bilibili: ['detail'] }
  };
  const candidate = {
    id: 'bilibili-mcp-transcript-candidate', name: 'B 站字幕 MCP（候选）', version: '1.14.3',
    license: 'Apache-2.0', repository: 'https://github.com/XZXZZX-Ai/bilibili-mcp',
    runtime: { name: 'Node.js', minimumVersion: '20' }, capabilities: { bilibili: ['get_video_transcript'] },
    unavailableReason: '安全启动与只读工具白名单尚未验证。',
    policy: { force_asr: false, fallbacks: false, validateDataSource: true, validateTimestamps: true }
  };
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: { listPlatforms: async () => [] },
      socialSource: {
        list: async () => [source, candidate],
        checkEnvironment: async () => ({
          status: 'not-ready', code: 'BROWSER_MISSING', installationState: 'partial',
          lastPrepareOperation: {
            operationId, sourceId: source.id, version: source.version,
            stage: 'syncing-dependencies', progress: 65, state: 'interrupted',
            code: 'DEPENDENCY_ERROR', recoverable: true, updatedAt: '2026-10-21T00:00:00.000Z'
          }
        })
      }
    },
    coordinator: {},
    getState: () => ({ researchTasks: [] })
  });
  await instance.refreshPlatforms();

  const panel = getNode('social-source-manager-content').innerHTML;
  assert.match(panel, /value="65"/);
  assert.match(panel, new RegExp(operationId));
  assert.match(panel, /上次准备在应用退出时中断/);
  assert.match(panel, /修复 \/ 重试/);
  assert.doesNotMatch(panel, /social-source-profile-id|新研究默认 profile ID/);
  assert.match(getNode('social-source-profile-current').textContent, /B 站 当前研究 profile：social-research-bilibili/);
  assert.match(getNode('social-source-candidate').innerHTML, /安全启动与只读工具白名单尚未验证/);
  assert.match(getNode('social-source-candidate').innerHTML, /安装与启动暂不可用/);
  assert.match(getNode('social-source-candidate').innerHTML, /<button[^>]*disabled/);
});

test('真实登记无候选时明确显示暂无已批准的新版本并禁用升级', async () => {
  const { document, getNode } = makeUiDocument();
  const source = {
    id: 'mediacrawler-lite', name: 'MediaCrawler 固定适配器', version: '1.0.0', available: true,
    platforms: ['bilibili'], capabilities: { bilibili: ['health', 'session', 'detail', 'comments'] }
  };
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: { listPlatforms: async () => [] },
      socialSource: {
        list: async () => [source],
        listVersions: async () => ({
          status: 'ok', sourceId: source.id, activeVersion: '1.0.0', previousVersion: null,
          candidates: [], cleanupAvailable: false, retainedPreviousVersions: 1
        }),
        checkEnvironment: async () => ({ status: 'not-ready', installationState: 'not-installed' })
      }
    },
    coordinator: {}, getState: () => ({ researchTasks: [] })
  });
  await instance.refreshPlatforms();
  const panel = getNode('social-source-manager-content').innerHTML;
  assert.match(panel, /暂无已批准的新版本/);
  assert.match(panel, /data-source-version-action="prepare" disabled/);
  assert.match(panel, /data-source-version-action="rollback" disabled/);
  assert.match(panel, /data-source-version-action="cleanup" disabled/);
  assert.match(panel, /data-source-version-action="uninstall"/);
});

test('来源卸载需要明确确认，成功后刷新来源状态且保留资料提示', async () => {
  const { document, getNode } = makeUiDocument();
  const source = {
    id: 'mediacrawler-lite', version: '1.0.0', available: true, platforms: ['bilibili'],
    capabilities: { bilibili: ['health', 'session', 'detail', 'comments'] }
  };
  const confirmations = [];
  let uninstalls = 0;
  let environmentChecks = 0;
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: { listPlatforms: async () => [] },
      socialSource: {
        list: async () => [source],
        listVersions: async () => ({ status: 'ok', sourceId: source.id, activeVersion: '1.0.0', previousVersion: null, candidates: [], cleanupAvailable: false }),
        checkEnvironment: async () => { environmentChecks += 1; return { status: 'not-ready', installationState: 'not-installed' }; },
        uninstall: async sourceId => { assert.equal(sourceId, source.id); uninstalls += 1; return { status: 'ok', activeVersion: '1.0.0' }; }
      }
    },
    coordinator: {}, getState: () => ({ researchTasks: [] }),
    confirmAction: message => { confirmations.push(message); return true; }
  });
  await instance.refreshPlatforms();
  const button = { dataset: { sourceVersionAction: 'uninstall' } };
  getNode('social-source-manager-content').listeners.click({ target: {
    closest: selector => selector === '[data-source-version-action]' ? button : null
  } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /研究任务、附件、profile 和凭证会保留/);
  assert.equal(uninstalls, 1);
  assert.ok(environmentChecks >= 2, '卸载后应重新检查来源环境');
  assert.match(getNode('social-source-manager-content').innerHTML, /卸载来源运行时/);
});

test('恢复中的研究任务期间禁用版本切换且点击处理器不会发起 IPC', async () => {
  const { document, getNode } = makeUiDocument();
  const source = {
    id: 'mediacrawler-lite', version: '1.0.0', available: true, platforms: ['bilibili'],
    capabilities: { bilibili: ['health', 'session', 'detail', 'comments'] }
  };
  const task = { id: 'running-task', status: 'searching', platforms: ['bilibili'] };
  let activateCalls = 0;
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: { listPlatforms: async () => [] },
      socialSource: {
        list: async () => [source],
        listVersions: async () => ({
          status: 'ok', sourceId: source.id, activeVersion: '1.0.0', previousVersion: null,
          candidates: [{ versionId: '1.1.0', status: 'prepared' }], cleanupAvailable: false
        }),
        checkEnvironment: async () => ({ status: 'ok', installationState: 'available' }),
        activateVersion: async () => { activateCalls += 1; return { status: 'ok' }; }
      }
    },
    coordinator: {}, getState: () => ({ researchTasks: [task] }), confirmAction: () => true
  });
  await instance.refreshPlatforms();
  const panel = getNode('social-source-manager-content').innerHTML;
  assert.match(panel, /data-source-version-action="activate"[^>]*disabled/);
  const button = { dataset: { sourceVersionAction: 'activate', versionId: '1.1.0' } };
  getNode('social-source-manager-content').listeners.click({ target: {
    closest: selector => selector === '[data-source-version-action]' ? button : null
  } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(activateCalls, 0);
});

test('研究运行期间来源准备和登录均被阻止，登录使用研究任务的 profile', async () => {
  const { document, nodes, getNode } = makeUiDocument({ checkedPlatforms: ['bilibili'] });
  const task = {
    id: 'busy-source-task', topic: '来源忙碌保护', template: 'fact-check', status: 'searching',
    platforms: ['bilibili'], queries: [], profileId: 'task-specific-profile',
    plan: { objective: '来源忙碌保护', platformRoles: [], queries: [], budget: {}, stopConditions: [] },
    results: [], savedResultIds: [], selectedResultIds: [], report: null
  };
  const source = {
    id: 'mediacrawler-lite', version: '1.0.0', available: true, platforms: ['bilibili'],
    capabilities: { bilibili: ['detail', 'comments'] }
  };
  let planInput;
  let prepareCalls = 0;
  let environmentChecks = 0;
  const loginRequests = [];
  const state = { researchTasks: [task] };
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: { listPlatforms: async () => [{ platform: 'bilibili', domestic: true, supportsSearch: true, browserSearchRegistered: true }] },
      socialSource: {
        list: async () => [source],
        checkEnvironment: async () => {
          environmentChecks += 1;
          return { status: 'ok', installationState: 'available' };
        },
        prepare: async () => { prepareCalls += 1; return { status: 'ok' }; },
        openLogin: async request => { loginRequests.push(request); return { status: 'ok' }; }
      }
    },
    coordinator: {
      async createPlan(input) { planInput = input; return task; }
    },
    getState: () => state
  });
  await instance.refreshPlatforms();
  const initialEnvironmentChecks = environmentChecks;
  getNode('social-research-topic').value = '来源忙碌保护';
  await getNode('social-research-entry').listeners.submit({ preventDefault() {} });
  assert.equal(Object.hasOwn(planInput, 'profileId'), false, '新任务使用 schema 的平台默认 profile');
  assert.match(getNode('social-source-manager-content').innerHTML, /data-source-lifecycle="prepare" disabled/);
  assert.match(getNode('social-source-manager-content').innerHTML, /data-source-lifecycle="check" disabled/);
  assert.match(getNode('social-source-manager-content').innerHTML, /data-source-lifecycle="login" disabled/);

  const fireSourceAction = action => getNode('social-source-manager-content').listeners.click({
    target: { closest: () => ({ dataset: { sourceLifecycle: action } }) }
  });
  fireSourceAction('prepare');
  fireSourceAction('login');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prepareCalls, 0);
  assert.equal(loginRequests.length, 0);
  fireSourceAction('check');
  assert.equal(environmentChecks, initialEnvironmentChecks, 'searching 状态不得执行来源环境检查');
  assert.match(getNode('social-research-status').textContent, /研究运行或来源检查\/准备期间不能检查来源环境/);

  task.status = 'awaiting-save';
  instance.render();
  fireSourceAction('login');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loginRequests.length, 1);
  assert.equal(loginRequests[0].profileId, 'task-specific-profile');
});

test('等待平台准备期间允许来源管理操作，准备和登录 handler 均可执行', async () => {
  const { document, nodes, getNode } = makeUiDocument({ checkedPlatforms: ['bilibili'] });
  const task = {
    id: 'awaiting-source-task', topic: '等待平台准备', template: 'fact-check',
    status: 'awaiting-platform-preparation', platforms: ['bilibili'], queries: [],
    profileId: 'selected-profile-42',
    plan: { objective: '等待平台准备', platformRoles: [], queries: [], budget: {}, stopConditions: [] },
    results: [], savedResultIds: [], selectedResultIds: [], report: null
  };
  const source = {
    id: 'mediacrawler-lite', version: '1.0.0', available: true, platforms: ['bilibili'],
    capabilities: { bilibili: ['detail', 'comments'] }
  };
  const state = { researchTasks: [] };
  let prepareCalls = 0;
  let environmentChecks = 0;
  const loginRequests = [];
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: {
        listPlatforms: async () => [{
          platform: 'bilibili', domestic: true, supportsSearch: true, browserSearchRegistered: true
        }]
      },
      socialSource: {
        list: async () => [source],
        checkEnvironment: async () => {
          environmentChecks += 1;
          return { status: 'ok', installationState: 'available', running: false };
        },
        prepare: async () => {
          prepareCalls += 1;
          return { status: 'ok', phases: [{ stage: 'complete', progress: 100, state: 'complete', complete: true }] };
        },
        openLogin: async request => { loginRequests.push(request); return { status: 'ok' }; }
      }
    },
    coordinator: { async createPlan() { state.researchTasks = [task]; return task; } },
    getState: () => state
  });
  await instance.refreshPlatforms();
  getNode('social-research-topic').value = '等待平台准备';
  await getNode('social-research-entry').listeners.submit({ preventDefault() {} });

  let panel = getNode('social-source-manager-content').innerHTML;
  assert.doesNotMatch(panel, /data-source-lifecycle=\"prepare\" disabled/);
  assert.doesNotMatch(panel, /data-source-lifecycle=\"check\" disabled/);
  assert.doesNotMatch(panel, /data-source-lifecycle=\"login\" disabled/);
  const fireSourceAction = action => getNode('social-source-manager-content').listeners.click({
    target: { closest: () => ({ dataset: { sourceLifecycle: action } }) }
  });

  fireSourceAction('prepare');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prepareCalls, 1, '平台准备等待状态不得让准备 handler 以忙碌为由拒绝');

  panel = getNode('social-source-manager-content').innerHTML;
  assert.doesNotMatch(panel, /data-source-lifecycle=\"login\" disabled/);
  const checksBeforeHandler = environmentChecks;
  fireSourceAction('check');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(environmentChecks, checksBeforeHandler + 1,
    '平台准备等待状态不得让环境检查 handler 以忙碌为由拒绝');
  assert.doesNotMatch(getNode('social-research-status').textContent, /研究运行或来源检查\/准备期间不能检查来源环境/);

  fireSourceAction('login');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(loginRequests.map(request => request.profileId), ['selected-profile-42'],
    '平台准备等待状态不得让登录 handler 以忙碌为由拒绝');
});

test('停止进度只作用于当前平台和 profile，并覆盖聚合运行状态', async () => {
  const { document, getNode } = makeUiDocument({ checkedPlatforms: ['bilibili'] });
  const task = {
    id: 'profile-stop-task', topic: '登录进程停止', template: 'fact-check',
    status: 'awaiting-platform-preparation', platforms: ['bilibili'], queries: [],
    profileId: 'selected-profile-42',
    plan: { objective: '登录进程停止', platformRoles: [], queries: [], budget: {}, stopConditions: [] },
    results: [], savedResultIds: [], selectedResultIds: [], report: null
  };
  const source = {
    id: 'mediacrawler-lite', version: '1.0.0', available: true, platforms: ['xiaohongshu', 'bilibili'],
    capabilities: { bilibili: ['detail', 'comments'], xiaohongshu: ['detail', 'comments'] }
  };
  const state = { researchTasks: [task] };
  let onProgress;
  let environmentChecks = 0;
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: {
        listPlatforms: async () => [{
          platform: 'bilibili', domestic: true, supportsSearch: true, browserSearchRegistered: true
        }]
      },
      socialSource: {
        list: async () => [source],
        checkEnvironment: async () => {
          environmentChecks += 1;
          return { status: 'ok', installationState: 'available', running: true };
        },
        onProgress: listener => { onProgress = listener; }
      }
    },
    coordinator: { async createPlan() { return task; } },
    getState: () => state
  });
  await instance.refreshPlatforms();
  await instance.createPlanFromPromptAgent({ topic: task.topic, platforms: ['bilibili'] });
  assert.equal(instance.getActiveTaskId(), task.id, '测试需通过 UI 流程选中目标研究任务');
  assert.equal(typeof onProgress, 'function', '来源进度回调需完成订阅');
  const initialChecks = environmentChecks;
  assert.match(getNode('social-source-manager-content').innerHTML, /状态：<strong>运行中<\/strong>/);

  onProgress({
    sourceId: 'another-source', platform: 'bilibili', profileId: 'selected-profile-42', state: 'stopped'
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(environmentChecks, initialChecks, '不匹配的 sourceId 不得刷新来源环境');

  onProgress({
    sourceId: source.id, platform: 'xiaohongshu', profileId: 'social-research-xiaohongshu', state: 'stopped'
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(environmentChecks, initialChecks, '不匹配的 platform 不得刷新来源环境');

  onProgress({
    sourceId: source.id, platform: 'bilibili', profileId: 'another-profile', state: 'stopped'
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(environmentChecks, initialChecks, '不匹配的 profile 事件不得刷新或修改当前状态');
  assert.match(getNode('social-source-manager-content').innerHTML, /状态：<strong>运行中<\/strong>/);

  onProgress({
    sourceId: source.id, platform: 'bilibili', profileId: 'selected-profile-42', state: 'stopped'
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(environmentChecks, initialChecks + 1, '匹配的停止事件应刷新来源环境');
  assert.match(getNode('social-source-manager-content').innerHTML, /状态：<strong>停止<\/strong>/,
    '当前 profile 的停止状态应优先于 environment.running 聚合值');

  onProgress({
    sourceId: source.id, platform: 'bilibili', profileId: 'selected-profile-42',
    state: 'error', code: 'PROCESS_CRASHED'
  });
  assert.match(getNode('social-source-manager-content').innerHTML, /状态：<strong>失败<\/strong>/);
  assert.match(getNode('social-source-manager-content').innerHTML, /登录浏览器进程意外退出/);
  assert.match(getNode('social-source-manager-content').innerHTML, /PROCESS_CRASHED/);
});

test('PROCESS_CRASHED 按合法 platform/profile 隔离，重试登录成功后清除该 profile 错误', async () => {
  const { document, getNode } = makeUiDocument({ checkedPlatforms: ['bilibili'] });
  const makeTask = (id, profileId) => ({
    id, topic: id, template: 'fact-check', status: 'awaiting-platform-preparation',
    platforms: ['bilibili'], queries: [], profileId,
    plan: { objective: id, platformRoles: [], queries: [], budget: {}, stopConditions: [] },
    results: [], savedResultIds: [], selectedResultIds: [], report: null
  });
  const taskA = makeTask('task-profile-a', 'profile-a');
  const taskB = makeTask('task-profile-b', 'profile-b');
  const state = { researchTasks: [taskA, taskB] };
  const source = {
    id: 'mediacrawler-lite', version: '1.0.0', available: true,
    platforms: ['bilibili'], capabilities: { bilibili: ['detail', 'comments'] }
  };
  let onProgress;
  let nextTask = taskA;
  const loginRequests = [];
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: {
        listPlatforms: async () => [{
          platform: 'bilibili', domestic: true, supportsSearch: true, browserSearchRegistered: true
        }]
      },
      socialSource: {
        list: async () => [source],
        checkEnvironment: async () => ({ status: 'ok', installationState: 'available', running: false }),
        openLogin: async request => { loginRequests.push(request); return { status: 'ok' }; },
        onProgress: listener => { onProgress = listener; }
      }
    },
    coordinator: { async createPlan() { return nextTask; } },
    getState: () => state
  });
  await instance.refreshPlatforms();
  await instance.createPlanFromPromptAgent({ topic: taskA.topic, platforms: ['bilibili'] });
  assert.equal(typeof onProgress, 'function');

  const sendError = progress => onProgress({ state: 'error', code: 'PROCESS_CRASHED', ...progress });
  sendError({ sourceId: 'unregistered-source', platform: 'bilibili', profileId: 'profile-a' });
  sendError({ sourceId: source.id, platform: 'reddit', profileId: 'profile-a' });
  sendError({ sourceId: source.id, platform: 'bilibili', profileId: '../profile-a' });
  assert.match(getNode('social-source-manager-content').innerHTML, /状态：<strong>可用<\/strong>/,
    'sourceId、平台或 profile 非法的错误事件应被忽略');
  assert.doesNotMatch(getNode('social-source-manager-content').innerHTML, /PROCESS_CRASHED/);

  sendError({ sourceId: source.id, platform: 'bilibili', profileId: 'profile-a' });
  let panel = getNode('social-source-manager-content').innerHTML;
  assert.match(panel, /状态：<strong>失败<\/strong>/);
  assert.match(panel, /PROCESS_CRASHED/);
  assert.match(panel, /登录浏览器进程意外退出/);

  nextTask = taskB;
  await instance.createPlanFromPromptAgent({ topic: taskB.topic, platforms: ['bilibili'] });
  panel = getNode('social-source-manager-content').innerHTML;
  assert.match(getNode('social-source-profile-current').textContent, /profile-b/);
  assert.match(panel, /状态：<strong>可用<\/strong>/);
  assert.doesNotMatch(panel, /PROCESS_CRASHED|登录浏览器进程意外退出/,
    'profile B 不应显示 profile A 的登录错误');

  nextTask = taskA;
  await instance.createPlanFromPromptAgent({ topic: taskA.topic, platforms: ['bilibili'] });
  assert.match(getNode('social-source-manager-content').innerHTML, /PROCESS_CRASHED/,
    '切回 profile A 后应保留其登录错误');

  getNode('social-source-manager-content').listeners.click({
    target: { closest: () => ({ dataset: { sourceLifecycle: 'login' } }) }
  });
  await new Promise(resolve => setImmediate(resolve));
  panel = getNode('social-source-manager-content').innerHTML;
  assert.deepEqual(loginRequests, [{ sourceId: source.id, platform: 'bilibili', profileId: 'profile-a' }]);
  assert.match(panel, /状态：<strong>运行中<\/strong>/,
    'profile A 登录成功后应显示运行中');
  assert.doesNotMatch(panel, /PROCESS_CRASHED|登录浏览器进程意外退出/,
    'profile A 登录成功后应清除其旧错误');
});

test('停止事件检查延迟期间切换 profile 不污染新选择，旧 profile 仍保持停止', async () => {
  const { document, getNode } = makeUiDocument({ checkedPlatforms: ['bilibili'] });
  const makeTask = (id, profileId) => ({
    id, topic: id, template: 'fact-check', status: 'awaiting-platform-preparation',
    platforms: ['bilibili'], queries: [], profileId,
    plan: { objective: id, platformRoles: [], queries: [], budget: {}, stopConditions: [] },
    results: [], savedResultIds: [], selectedResultIds: [], report: null
  });
  const firstTask = makeTask('first-profile-task', 'first-profile');
  const secondTask = makeTask('second-profile-task', 'second-profile');
  const state = { researchTasks: [firstTask, secondTask] };
  const source = {
    id: 'mediacrawler-lite', version: '1.0.0', available: true,
    platforms: ['xiaohongshu', 'bilibili'], capabilities: { xiaohongshu: ['detail'], bilibili: ['detail'] }
  };
  let onProgress;
  let environmentChecks = 0;
  let resolveDelayedCheck;
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: {
        listPlatforms: async () => [
          { platform: 'xiaohongshu', domestic: true, supportsSearch: true, browserSearchRegistered: true },
          { platform: 'bilibili', domestic: true, supportsSearch: true, browserSearchRegistered: true }
        ]
      },
      socialSource: {
        list: async () => [source],
        checkEnvironment: async () => {
          environmentChecks += 1;
          if (environmentChecks <= 2) return { status: 'ok', installationState: 'available', running: true };
          return new Promise(resolve => { resolveDelayedCheck = resolve; });
        },
        onProgress: listener => { onProgress = listener; }
      }
    },
    coordinator: {
      async createPlan() { return instance.getActiveTaskId() === firstTask.id ? secondTask : firstTask; }
    },
    getState: () => state
  });
  await instance.refreshPlatforms();
  await instance.createPlanFromPromptAgent({ topic: firstTask.topic, platforms: ['bilibili'] });
  assert.equal(instance.getActiveTaskId(), firstTask.id);

  onProgress({
    sourceId: source.id, platform: 'bilibili', profileId: 'first-profile', state: 'stopped'
  });
  assert.equal(environmentChecks, 3, '匹配的停止事件应开始环境检查');

  const platformSelect = getNode('social-source-profile-platform');
  const selectPlatform = platform => {
    platformSelect.value = platform;
    getNode('social-source-manager-content').listeners.change({ target: platformSelect });
  };
  selectPlatform('xiaohongshu');
  await instance.createPlanFromPromptAgent({ topic: secondTask.topic, platforms: ['bilibili'] });
  assert.equal(instance.getActiveTaskId(), secondTask.id);
  assert.match(getNode('social-source-profile-current').textContent, /当前研究 profile：second-profile/);

  resolveDelayedCheck({ status: 'ok', installationState: 'available', running: false });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(getNode('social-source-manager-content').innerHTML, /状态：<strong>可用<\/strong>/,
    '旧 profile 的异步检查不得把新 platform/profile 标成停止');

  selectPlatform('bilibili');
  await instance.createPlanFromPromptAgent({ topic: firstTask.topic, platforms: ['bilibili'] });
  assert.match(getNode('social-source-profile-current').textContent, /当前研究 profile：first-profile/);
  assert.match(getNode('social-source-manager-content').innerHTML, /状态：<strong>停止<\/strong>/,
    '切回原 platform/profile 后仍应显示其停止状态');
});

test('结果筛选覆盖平台、查询、日期、证据和保存状态', () => {
  const results = [
    { id: 'a', platform: 'reddit', searchQueries: ['账本'], publishedAt: '2026-10-01', evidenceStatus: 'unverified' },
    { id: 'b', platform: 'youtube', searchQueries: ['预算'], publishedAt: '2026-10-19', evidenceStatus: 'source-reviewed' },
    { id: 'c', platform: 'reddit', searchQueries: ['账本'], publishedAt: '', evidenceStatus: 'unverified' }
  ];
  assert.deepEqual(ui.filterResearchResults(results, { platform: 'reddit', query: '账本', from: '2026-10-02', saved: 'unsaved' }, ['b']).map(item => item.id), ['c']);
  assert.deepEqual(ui.filterResearchResults(results, { evidence: 'source-reviewed', saved: 'saved' }, ['b']).map(item => item.id), ['b']);
});

test('结果卡独立渲染深读选择，缺少内容 ID 禁用深读，B 站字幕显示不可用', async () => {
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: '', innerHTML: '', textContent: '', disabled: false, style: {}, listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; }
    });
    return nodes.get(id);
  };
  const task = {
    id: 'ui-task', topic: 'UI 深读', template: 'pain-points', status: 'awaiting-save',
    platforms: ['xiaohongshu'], queries: ['q'], plan: { objective: 'UI 深读', platformRoles: [], queries: ['q'], budget: {} },
    results: [
      { id: 'missing-id', platform: 'xiaohongshu', url: 'https://www.xiaohongshu.com/search', title: '缺 ID', summary: '摘要', materials: [] },
      { id: 'bili-result', platform: 'bilibili', contentId: 'BV1Q541167Qg', url: 'https://www.bilibili.com/video/BV1Q541167Qg', title: '视频', summary: '视频摘要', materials: [] }
    ], savedResultIds: [], selectedResultIds: [], report: null
  };
  const state = { researchTasks: [] };
  const document = {
    getElementById: getNode,
    querySelectorAll(selector) {
      if (selector === '[data-social-platform]:checked') return [{ value: 'xiaohongshu' }];
      return [];
    },
    querySelector() { return null; },
    getElementByIdById: getNode
  };
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: { listPlatforms: async () => [{ platform: 'xiaohongshu', domestic: true, supportsSearch: true, browserSearchRegistered: true }] },
      socialSource: {
        list: async () => [{ id: 'mediacrawler-lite', version: '1.1.0', platforms: ['xiaohongshu', 'bilibili', 'weibo', 'zhihu'], capabilities: { xiaohongshu: ['detail', 'comments'], bilibili: ['detail', 'comments'], weibo: ['detail', 'comments'], zhihu: ['detail'] } }],
        checkEnvironment: async sourceId => ({ status: 'ok', sourceId })
      }
    },
    coordinator: {
      async createPlan() { state.researchTasks = [task]; return task; },
      getTransientMaterial() { return undefined; }
    },
    getState: () => state
  });
  await instance.refreshPlatforms();
  getNode('social-research-entry').listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const rendered = getNode('social-research-results-list').innerHTML;
  assert.match(rendered, /data-deep-result="missing-id"[^>]*disabled/);
  assert.match(rendered, /缺少可校验的平台内容 ID/);
  assert.match(rendered, /data-deep-result="bili-result"/);
  assert.match(rendered, /字幕：不可用（字幕来源尚未登记；不会用视频简介代替）/);
  assert.match(rendered, /data-save-result="bili-result"/);
  assert.match(rendered, /data-deep-result="bili-result"/);
});

test('静态登记了深读能力但运行环境未准备时禁用深读并提示安装或检查', async () => {
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: '', innerHTML: '', textContent: '', disabled: false, style: {}, listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; }
    });
    return nodes.get(id);
  };
  const task = {
    id: 'not-ready-task', topic: '来源环境检查', template: 'pain-points', status: 'awaiting-save',
    platforms: ['xiaohongshu'], queries: ['q'], plan: { objective: '来源环境检查', platformRoles: [], queries: ['q'], budget: {} },
    results: [{ id: 'static-only', platform: 'xiaohongshu', contentId: 'note_123',
      url: 'https://www.xiaohongshu.com/explore/note_123', title: '结果', summary: '摘要', materials: [] }],
    savedResultIds: [], selectedResultIds: [], report: null
  };
  const state = { researchTasks: [] };
  const sourceChecks = [];
  const document = {
    getElementById: getNode,
    querySelectorAll(selector) { return selector === '[data-social-platform]:checked' ? [{ value: 'xiaohongshu' }] : []; },
    querySelector() { return null; }
  };
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: { listPlatforms: async () => [{ platform: 'xiaohongshu', domestic: true, supportsSearch: true, browserSearchRegistered: true }] },
      socialSource: {
        list: async () => [{ id: 'mediacrawler-lite', capabilities: { xiaohongshu: ['detail', 'comments'] } }],
        checkEnvironment: async sourceId => {
          sourceChecks.push(sourceId);
          return { status: 'not-ready', sourceId, code: 'BROWSER_MISSING' };
        }
      }
    },
    coordinator: { async createPlan() { state.researchTasks = [task]; return task; } },
    getState: () => state
  });
  await instance.refreshPlatforms();
  getNode('social-research-entry').listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));

  const rendered = getNode('social-research-results-list').innerHTML;
  assert.ok(sourceChecks.length > 0);
  assert.ok(sourceChecks.every(sourceId => sourceId === 'mediacrawler-lite'));
  assert.match(rendered, /data-deep-result="static-only"[^>]*disabled/);
  assert.match(rendered, /深读来源未准备，需安装或检查/);
});

test('附件保存期间禁用保存按钮并显示保存中，失败后恢复重试按钮', async () => {
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: '', innerHTML: '', textContent: '', disabled: false, style: {}, listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; }
    });
    return nodes.get(id);
  };
  const material = { id: 'saving-material', kind: 'detail', status: 'completed', itemCount: 1 };
  const task = {
    id: 'saving-task', topic: '附件保存状态', template: 'pain-points', status: 'awaiting-save',
    platforms: ['xiaohongshu'], queries: ['q'], plan: { objective: '附件保存状态', platformRoles: [], queries: ['q'], budget: {} },
    results: [{ id: 'saving-result', platform: 'xiaohongshu', title: '结果', summary: '摘要', materials: [material] }],
    savedResultIds: [], selectedResultIds: [], report: null
  };
  const state = { researchTasks: [] };
  let failSave;
  const document = {
    getElementById: getNode,
    querySelectorAll(selector) { return selector === '[data-social-platform]:checked' ? [{ value: 'xiaohongshu' }] : []; },
    querySelector() { return null; }
  };
  const instance = ui.createSocialResearchUI({
    document,
    desktopApi: {
      social: { listPlatforms: async () => [{ platform: 'xiaohongshu', domestic: true, supportsSearch: true, browserSearchRegistered: true }] },
      socialSource: { list: async () => [], checkEnvironment: async () => null }
    },
    coordinator: {
      async createPlan() { state.researchTasks = [task]; return task; },
      getTransientMaterial(id) { return id === material.id ? '完整原文' : undefined; },
      saveMaterials() { return new Promise((_resolve, reject) => { failSave = reject; }); }
    },
    getState: () => state
  });
  await instance.refreshPlatforms();
  await getNode('social-research-entry').listeners.submit({ preventDefault() {} });
  getNode('social-research-results-list').listeners.change({ target: {
    checked: true, dataset: { saveMaterial: material.id }, matches: selector => selector === '[data-save-material]'
  } });

  const saveButton = getNode('social-research-save-materials');
  assert.equal(saveButton.disabled, false);
  const savePromise = saveButton.listeners.click();
  assert.equal(saveButton.disabled, true);
  assert.match(getNode('social-research-status').textContent, /正在保存/);

  failSave(new Error('临时保存失败'));
  await savePromise;
  assert.equal(saveButton.disabled, false);
  assert.match(getNode('social-research-status').textContent, /临时保存失败/);
});

test('UI 调用与 preload 一致的平台 API 签名，并把计划生命周期交给 coordinator', () => {
  const source = fs.readFileSync(path.join(root, 'prototype/social-research-ui.js'), 'utf8');
  for (const signature of [
    'desktopApi.social.listPlatforms()',
    'desktopApi.social.getStatus(platform)',
    'desktopApi.social.openLogin(platform, id)',
    'desktopApi.social.check(platform, id)',
    'desktopApi.social.clearProfile(platform, id)',
    'coordinator.createPlan(', 'coordinator.confirmPlan(task.id)', 'coordinator.run(task.id, { onEvent:',
    'coordinator.cancel(task.id)', 'coordinator.saveSelected(task.id, ids)'
  ]) assert.ok(source.includes(signature), `缺少 UI 事件接线 ${signature}`);
});

test('运行控制包含暂停/继续、运行中取消和实时执行上下文', () => {
  const html = fs.readFileSync(path.join(root, 'prototype/index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'prototype/social-research-ui.js'), 'utf8');
  for (const id of ['social-research-pause', 'social-research-progress-detail']) {
    assert.ok(html.includes(`id="${id}"`), `缺少运行控制入口 ${id}`);
  }
  for (const signature of ['coordinator.pause(task.id)', 'coordinator.resume(task.id)', 'onEvent:', 'platform-start', 'query-start', 'result-count', 'platform-finish']) {
    assert.ok(source.includes(signature), `缺少实时控制或进度接线 ${signature}`);
  }
  assert.ok(source.includes('["awaiting-plan-confirmation", "awaiting-platform-preparation", "searching"]'), '运行中应允许请求取消');
});

test('报告生成期间明确说明取消边界，禁用暂停并保留取消入口', () => {
  const source = fs.readFileSync(path.join(root, 'prototype/social-research-ui.js'), 'utf8');
  assert.ok(source.includes('event.type === "report-start"'), '收到报告开始事件后应切换报告生成状态');
  assert.ok(source.includes('正在生成报告；在途模型请求可能完成并计费，取消后保留已完成材料。'), '报告阶段应说明在途请求可能完成并计费');
  assert.ok(source.includes('|| reportGenerating'), '模型请求期间应禁用暂停');
  assert.ok(source.includes('coordinator.cancel(task.id)'), '报告生成期间仍通过现有入口允许取消');
});

test('partial-failure 的报告区和状态栏展示真实错误详情及错误码', () => {
  const source = fs.readFileSync(path.join(root, 'prototype/social-research-ui.js'), 'utf8');
  assert.ok(source.includes('task.reportErrorCode'), '错误码应展示在状态栏或报告区');
  assert.ok(source.includes('task.reportError'), '错误详情应展示在状态栏或报告区');
  assert.ok(source.includes('研究未完成：'), '状态栏应明确指出研究未完成');
});

test('平台检查不伪造搜索验证或沿用过期登录状态，搜索实测文案按状态动态显示', () => {
  const source = fs.readFileSync(path.join(root, 'prototype/social-research-ui.js'), 'utf8');
  assert.ok(source.includes('connection.profileId === profileId(item.platform) && connection.searchVerified === true ? "已验证" : "待实测"'));
  assert.ok(!source.includes('浏览器搜索：待实测 · 搜索验证：'));
  assert.ok(source.includes('loginStates.has(checked.loginState) ? checked.loginState : "unknown"'));
  assert.ok(source.includes('searchVerified: item.connection.searchVerified === true'));
  assert.ok(source.includes('event.type === "search-verified"'));
  assert.ok(source.includes('event.profileId === profileId(event.platform)'));
  assert.ok(source.includes('lastSuccessfulSearchAt: event.lastSuccessfulSearchAt'));
});

test('RATE_LIMITED 检查即使 ready 为 true 也标记受限且不准备浏览器连接', async () => {
  const connection = await checkPlatformConnection({
    status: 'ok', ready: true, platform: 'xiaohongshu', code: 'RATE_LIMITED',
    message: '访问频率受限，请稍后重试。'
  });
  assert.equal(connection.status, 'restricted');
  assert.equal(connection.browserStatus, 'restricted');
  assert.equal(connection.browserReady, false);
  assert.equal(connection.browserPrepared, false);
  assert.equal(connection.lastErrorCode, 'RATE_LIMITED');
  assert.equal(connection.error, '访问频率受限，请稍后重试。');
});

test('显式 loginState restricted 即使 status ok 且 ready 也阻断浏览器准备', async () => {
  const connection = await checkPlatformConnection({
    status: 'ok', ready: true, platform: 'xiaohongshu', loginState: 'restricted',
    message: '平台限制了当前连接。'
  });
  assert.equal(connection.loginState, 'restricted');
  assert.equal(connection.status, 'restricted');
  assert.equal(connection.browserStatus, 'restricted');
  assert.equal(connection.browserReady, false);
  assert.equal(connection.browserPrepared, false);
  assert.equal(connection.lastErrorCategory, 'restricted');
  assert.equal(connection.error, '平台限制了当前连接。');
});

test('适配器的 restricted 检查响应传入研究 UI 后仍不准备浏览器连接', async () => {
  const manager = {
    runSessionAction: (_sessionId, action) => action({
      executeReadOnlyScript: async () => ({ supported: true, loginState: 'restricted' })
    })
  };
  const adapter = createBrowserPlatformAdapters({ manager }).xiaohongshu;
  adapter.attachSession('xiaohongshu:restricted');
  const response = await adapter.checkReady();
  const connection = await checkPlatformConnection(response);

  assert.equal(response.loginState, 'restricted');
  assert.equal(response.browserStatus, 'restricted');
  assert.equal(response.ready, false);
  assert.equal(response.code, 'RESTRICTED');
  assert.equal(connection.loginState, 'restricted');
  assert.equal(connection.status, 'restricted');
  assert.equal(connection.browserStatus, 'restricted');
  assert.equal(connection.browserPrepared, false);
});

test('Prompt Agent 新社媒入口只发送四个国内平台 ID，非法旧平台输入回退国内列表', () => {
  const promptSource = fs.readFileSync(path.join(root, 'prototype/prompt-agent-ui.js'), 'utf8');
  const socialUiSource = fs.readFileSync(path.join(root, 'prototype/social-research-ui.js'), 'utf8');
  assert.match(promptSource, /platforms: sourceType === "social" \|\| sourceType === "mixed" \? \["xiaohongshu", "bilibili", "weibo", "zhihu"\] : \[\]/);
  assert.ok(socialUiSource.includes('if (!domesticPlatformIds.length) domesticPlatformIds = [...DOMESTIC_PLATFORM_IDS]'));
  assert.ok(socialUiSource.includes('definition?.browserSearchRegistered === true && definition.supportsSearch === true'));
});
