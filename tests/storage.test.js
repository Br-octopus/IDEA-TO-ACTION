const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { startServer } = require('../server.js');
const {
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  createEmptyState,
  migrateState,
  loadState,
  saveState,
  addPromptVersion,
  confirmCase
} = require('../prototype/storage.js');
const { catalog } = require('../prototype/research-catalog.js');

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    values
  };
}

test('将 v1 项目和提示词迁移到 v3，补齐字段并保留资料', () => {
  const oldData = {
    projects: [
      { id: 'p1', idea: '学习摄影', domain: '学习目标', success: '能独立拍出清晰的人像', createdAt: '2026-01-01', custom: '保留的旧字段' },
      { id: 'p2', idea: '其他计划', domain: '其他' }
    ],
    prompts: [{ id: 't1', groupId: 'p1', version: 4, text: '完整的旧提示词正文：请按每周计划学习摄影。' }],
    references: [{ id: 'r1', title: '参考资料' }]
  };
  const storage = memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(oldData) });

  const { state } = loadState(storage);

  assert.equal(state.schemaVersion, 3);
  assert.equal(state.projects[0].idea, '学习摄影');
  assert.equal(state.projects[0].goalSummary, '学习摄影');
  assert.equal(state.projects[0].methodId, '');
  assert.equal(state.projects[0].methodTemporary, false);
  assert.equal(state.projects[0].audience, '');
  assert.equal(state.projects[0].currentState, '');
  assert.equal(state.projects[0].constraints, '');
  assert.deepEqual(state.projects[0].successCriteria, ['能独立拍出清晰的人像']);
  assert.deepEqual(state.projects[0].assumptions, []);
  assert.deepEqual(state.projects[0].missingInfo, []);
  assert.deepEqual(state.projects[0].preserveItems, []);
  assert.deepEqual(state.projects[0].steps, []);
  assert.equal(state.projects[0].currentStepId, '');
  assert.equal(state.projects[0].nextAction, '');
  assert.equal(state.projects[0].reply, '');
  assert.equal(state.projects[0].createdAt, '2026-01-01');
  assert.equal(state.projects[0].custom, '保留的旧字段');
  for (const field of [
    'methodId', 'methodTemporary', 'goalSummary', 'audience', 'currentState', 'constraints',
    'successCriteria', 'assumptions', 'missingInfo', 'preserveItems', 'steps',
    'currentStepId', 'nextAction', 'reply', 'createdAt'
  ]) {
    assert.ok(Object.hasOwn(state.projects[0], field), `迁移项目应包含 ${field}`);
  }
  assert.deepEqual(state.projects[0].completed, []);
  assert.equal(state.projects[1].methodTemporary, true);
  assert.equal(state.prompts[0].text, oldData.prompts[0].text);
  assert.equal(state.prompts[0].version, 4);
  assert.deepEqual(state.references, oldData.references);
  assert.deepEqual(state.cases, []);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), state);
});

test('根路径和嵌套页面路径按顺序加载知识脚本并暴露统一搜索全局', async t => {
  const server = await startServer({ port: 0 });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const paths = [
    '/prototype/knowledge-schema.js',
    '/prototype/method-cards.js',
    '/prototype/research-catalog.js',
    '/prototype/search-dictionary.js',
    '/prototype/knowledge-search.js',
    '/prototype/social-research-schema.js',
    '/prototype/storage.js',
    '/prototype/app.js'
  ];

  for (const pagePath of ['/', '/prototype/index.html']) {
    const pageResponse = await fetch(`http://127.0.0.1:${port}${pagePath}`);
    assert.equal(pageResponse.status, 200, `${pagePath} 应返回 200`);
    const html = await pageResponse.text();
    const schemaScriptIndex = html.indexOf('src="/prototype/knowledge-schema.js"');
    const methodCardsScriptIndex = html.indexOf('src="/prototype/method-cards.js"');
    const researchScriptIndex = html.indexOf('src="/prototype/research-catalog.js"');
    const socialResearchSchemaScriptIndex = html.indexOf('src="/prototype/social-research-schema.js"');
    const knowledgeSearchScriptIndex = html.indexOf('src="/prototype/knowledge-search.js"');
    const storageScriptIndex = html.indexOf('src="/prototype/storage.js"');
    const appScriptIndex = html.indexOf('src="/prototype/app.js"');
    assert.ok(schemaScriptIndex >= 0, `${pagePath} 应先引用 knowledge-schema.js`);
    assert.ok(schemaScriptIndex < methodCardsScriptIndex, `${pagePath} 中 schema 应在 method-cards.js 前加载`);
    assert.ok(methodCardsScriptIndex < researchScriptIndex, `${pagePath} 中 method-cards.js 应在 research-catalog.js 前加载`);
    assert.ok(researchScriptIndex < knowledgeSearchScriptIndex, `${pagePath} 中 research-catalog.js 应在 knowledge-search.js 前加载`);
    assert.ok(knowledgeSearchScriptIndex < socialResearchSchemaScriptIndex, `${pagePath} 中 knowledge-search.js 应在 social-research-schema.js 前加载`);
    assert.ok(socialResearchSchemaScriptIndex < storageScriptIndex, `${pagePath} 中 social-research-schema.js 应在 storage.js 前加载`);
    assert.ok(storageScriptIndex < appScriptIndex, `${pagePath} 中 storage.js 应在 app.js 前加载`);
    for (const scriptPath of paths) {
      assert.ok(html.includes(`src="${scriptPath}"`), `${pagePath} 应引用 ${scriptPath}`);
      const scriptResponse = await fetch(`http://127.0.0.1:${port}${scriptPath}`);
      assert.equal(scriptResponse.status, 200, `${scriptPath} 应返回 200`);
    }

    const context = {};
    for (const scriptPath of paths.slice(0, 7)) {
      const source = fs.readFileSync(require.resolve(`..${scriptPath}`), 'utf8');
      vm.runInNewContext(source, context, { filename: scriptPath });
    }
    assert.equal(typeof context.ForwardStepKnowledgeSearch.collectKnowledgeEntries, 'function');
    assert.equal(typeof context.ForwardStepMethodCards.methodCardsToKnowledgeEntries, 'function');
    const browserState = {
      schemaVersion: 3,
      researchTasks: [{ id: 'browser-task', topic: '浏览器研究数据不能丢失' }]
    };
    const storedState = new Map([['forward-step.workspace.v2', JSON.stringify(browserState)]]);
    context.localStorage = {
      getItem(key) { return storedState.get(key) ?? null; },
      setItem(key, value) { storedState.set(key, String(value)); }
    };
    const loaded = context.ForwardStepStorage.loadState();
    assert.equal(loaded.state.researchTasks.length, 1);
    assert.equal(loaded.state.researchTasks[0].topic, '浏览器研究数据不能丢失');
  }
});

test('资料选择迁移去重并限制为最多五条', () => {
  const state = migrateState({ researchSelection: [catalog[0].id, 'stale-reference', catalog[1].id, catalog[0].id, catalog[2].id, catalog[3].id] });
  assert.deepEqual(state.knowledgeSelection, [catalog[0].id, catalog[1].id, catalog[2].id, catalog[3].id]);
  assert.deepEqual(migrateState({}).researchSelection, []);
});

test('旧版 researchSelection 迁移后并入 knowledgeSelection 并清空', () => {
  const state = migrateState({ researchSelection: [catalog[0].id, catalog[1].id] });
  assert.deepEqual(state.knowledgeSelection, [catalog[0].id, catalog[1].id]);
  assert.deepEqual(state.researchSelection, []);
});

test('旧版状态迁移后拥有知识条目集合', () => {
  const state = migrateState({ schemaVersion: 2, projects: [], prompts: [], cases: [] });
  assert.equal(state.schemaVersion, 3);
  assert.deepEqual(state.knowledgeEntries, []);
});

test('空状态包含研究任务、平台连接和附件集合', () => {
  const state = createEmptyState();

  assert.deepEqual(state.researchTasks, []);
  assert.deepEqual(state.platformConnections, {});
  assert.deepEqual(state.researchAttachments, []);
});

test('研究状态迁移和保存使用白名单并剔除平台敏感字段', () => {
  const storage = memoryStorage();
  const state = saveState(storage, {
    ...createEmptyState(),
    researchTasks: [{
      id: 'task-1',
      topic: '研究主题',
      status: 'draft',
      results: [{ id: 'result-1', url: 'https://example.test', summary: '摘要' }],
      apiKey: 'task-secret',
      unknownField: 'task-unknown'
    }],
    platformConnections: {
      reddit: {
        platform: 'reddit',
        status: 'ready',
        apiKey: 'api-secret',
        credential: 'credential-secret',
        cookie: 'cookie-secret',
        cookies: ['cookies-secret'],
        sessionToken: 'session-secret',
        password: 'password-secret',
        profilePath: 'C:/private/profile',
        unknownField: 'unknown-secret'
      }
    },
    researchAttachments: [{
      id: 'attachment-1',
      type: 'screenshot',
      size: 12,
      sourceResultId: 'result-1',
      relativePath: 'research/a.png',
      savedAt: '2026-10-19T08:00:00.000Z',
      extra: '不应保留'
    }]
  });
  const serialized = storage.getItem(STORAGE_KEY);

  assert.equal(state.researchTasks[0].unknownField, undefined);
  assert.equal(state.platformConnections.reddit.status, 'needs-recheck');
  assert.equal(state.platformConnections.reddit.apiKey, undefined);
  assert.equal(state.researchAttachments[0].extra, undefined);
  for (const secret of [
    'task-secret', 'api-secret', 'credential-secret', 'cookie-secret',
    'cookies-secret', 'session-secret', 'password-secret', 'C:/private/profile',
    'unknown-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, `不应持久化 ${secret}`);
  }
});

test('旧的已确认案例迁移后补齐 v1 版本元数据', () => {
  const before = Date.now();
  const state = migrateState({
    cases: [
      {
        id: 'legacy-case',
        confirmed: true,
        status: '失败',
        evidence: ['旧证据'],
        lessons: '旧经验',
        createdAt: '2026-10-10T00:00:00.000Z',
        confirmedAt: '2026-10-11T00:00:00.000Z'
      },
      {
        id: 'created-at-case',
        confirmed: true,
        status: '成功',
        createdAt: '2026-10-12T00:00:00.000Z'
      },
      {
        id: 'current-time-case',
        confirmed: true,
        status: '待验证'
      }
    ]
  });
  const after = Date.now();
  const migrated = state.cases[0];

  assert.equal(migrated.currentVersion, 1);
  assert.equal(migrated.versionHistory.length, 1);
  assert.equal(migrated.versionHistory[0].version, 1);
  assert.equal(migrated.versionHistory[0].status, '失败');
  assert.deepEqual(migrated.versionHistory[0].evidence, ['旧证据']);
  assert.equal(migrated.reviewCount, 1);
  assert.equal(migrated.lastReviewedAt, '2026-10-11T00:00:00.000Z');

  assert.equal(state.cases[1].lastReviewedAt, '2026-10-12T00:00:00.000Z');
  const currentTime = Date.parse(state.cases[2].lastReviewedAt);
  assert.equal(Number.isNaN(currentTime), false);
  assert.ok(currentTime >= before && currentTime <= after);
});

test('已有有效案例版本历史的迁移不会重复覆盖版本元数据', () => {
  const versionHistory = [
    {
      version: 1,
      status: '失败',
      suggestedLabel: '初始结论',
      evidence: ['初始证据'],
      lessons: '初始经验',
      nextPrompt: '初始下一条提示词',
      applicableWhen: ['初始适用场景'],
      notApplicableWhen: ['初始不适用场景'],
      changeNote: '初始版本'
    },
    {
      version: 2,
      status: '成功',
      suggestedLabel: '当前结论',
      evidence: ['补充证据'],
      lessons: '当前经验',
      nextPrompt: '当前下一条提示词',
      applicableWhen: ['当前适用场景'],
      notApplicableWhen: ['当前不适用场景'],
      changeNote: '补充版本'
    }
  ];
  const state = migrateState({
    cases: [{
      id: 'versioned-case',
      confirmed: true,
      status: '成功',
      suggestedLabel: '当前结论',
      evidence: ['补充证据'],
      lessons: '当前经验',
      nextPrompt: '当前下一条提示词',
      applicableWhen: ['当前适用场景'],
      notApplicableWhen: ['当前不适用场景'],
      currentVersion: 2,
      versionHistory,
      reviewCount: 3,
      lastReviewedAt: '2026-10-12T00:00:00.000Z',
      createdAt: '2026-10-10T00:00:00.000Z'
    }]
  });
  const migrated = state.cases[0];

  assert.equal(migrated.currentVersion, 2);
  assert.deepEqual(migrated.versionHistory, versionHistory);
  assert.equal(migrated.reviewCount, 3);
  assert.equal(migrated.lastReviewedAt, '2026-10-12T00:00:00.000Z');
});

test('最新版本快照业务字段与当前案例不一致时迁移为一致的 v1', () => {
  const state = migrateState({
    cases: [{
      id: 'stale-latest-version',
      confirmed: true,
      currentVersion: 2,
      status: '成功',
      suggestedLabel: '当前结论',
      evidence: ['当前证据'],
      lessons: '当前经验',
      nextPrompt: '当前下一条提示词',
      applicableWhen: ['当前适用场景'],
      notApplicableWhen: ['当前不适用场景'],
      versionHistory: [
        {
          version: 1,
          status: '失败',
          suggestedLabel: '初始结论',
          evidence: ['初始证据'],
          lessons: '初始经验',
          nextPrompt: '初始下一条提示词',
          applicableWhen: ['初始适用场景'],
          notApplicableWhen: ['初始不适用场景']
        },
        {
          version: 2,
          status: '失败',
          suggestedLabel: '过期结论',
          evidence: ['过期证据'],
          lessons: '过期经验',
          nextPrompt: '过期下一条提示词',
          applicableWhen: ['过期适用场景'],
          notApplicableWhen: ['过期不适用场景']
        }
      ],
      reviewCount: 2,
      lastReviewedAt: '2026-10-12T00:00:00.000Z',
      confirmedAt: '2026-10-13T00:00:00.000Z'
    }]
  });
  const migrated = state.cases[0];

  assert.equal(migrated.currentVersion, 1);
  assert.equal(migrated.versionHistory.length, 1);
  for (const field of [
    'status', 'suggestedLabel', 'evidence', 'lessons', 'nextPrompt',
    'applicableWhen', 'notApplicableWhen'
  ]) {
    assert.deepEqual(migrated.versionHistory[0][field], migrated[field], field);
  }
  assert.equal(migrated.reviewCount, 1);
  assert.equal(migrated.lastReviewedAt, '2026-10-13T00:00:00.000Z');
});

test('不完整或不一致的案例版本历史迁移为一致的 v1 元数据', () => {
  const state = migrateState({
    cases: [
      {
        id: 'wrong-current-version',
        confirmed: true,
        currentVersion: 3,
        versionHistory: [{ version: 1, status: '失败' }],
        reviewCount: 2,
        lastReviewedAt: '2026-10-12T00:00:00.000Z',
        status: '成功',
        lessons: '保留当前经验',
        confirmedAt: '2026-10-13T00:00:00.000Z'
      },
      {
        id: 'non-contiguous-history',
        confirmed: true,
        currentVersion: 3,
        versionHistory: [
          { version: 1, status: '失败' },
          { version: 3, status: '成功' }
        ],
        reviewCount: 2,
        lastReviewedAt: '2026-10-12T00:00:00.000Z',
        status: '成功',
        confirmedAt: '2026-10-14T00:00:00.000Z'
      },
      {
        id: 'empty-review-count',
        confirmed: true,
        currentVersion: 2,
        versionHistory: [
          { version: 1, status: '失败' },
          { version: 2, status: '成功' }
        ],
        reviewCount: 0,
        lastReviewedAt: '2026-10-12T00:00:00.000Z',
        status: '成功',
        createdAt: '2026-10-15T00:00:00.000Z'
      },
      {
        id: 'empty-last-reviewed-at',
        confirmed: true,
        currentVersion: 2,
        versionHistory: [
          { version: 1, status: '失败' },
          { version: 2, status: '成功' }
        ],
        reviewCount: 2,
        lastReviewedAt: '',
        status: '成功',
        createdAt: '2026-10-16T00:00:00.000Z'
      }
    ]
  });

  for (const migrated of state.cases) {
    assert.equal(migrated.currentVersion, 1, migrated.id);
    assert.equal(migrated.versionHistory.length, 1, migrated.id);
    assert.equal(migrated.versionHistory[0].version, 1, migrated.id);
    assert.equal(migrated.versionHistory[0].status, migrated.status, migrated.id);
    assert.equal(migrated.reviewCount, 1, migrated.id);
    assert.ok(migrated.lastReviewedAt, migrated.id);
  }
  assert.equal(state.cases[0].lastReviewedAt, '2026-10-13T00:00:00.000Z');
  assert.equal(state.cases[2].lastReviewedAt, '2026-10-15T00:00:00.000Z');
  assert.equal(state.cases[3].lastReviewedAt, '2026-10-16T00:00:00.000Z');
});

test('知识条目不会保留模型凭证字段', () => {
  const state = migrateState({
    knowledgeEntries: [{ id: 'x', title: '资料', apiKey: 'secret', token: 'secret' }]
  });
  assert.equal(state.knowledgeEntries[0].apiKey, undefined);
  assert.equal(state.knowledgeEntries[0].token, undefined);
});

test('知识条目迁移只保留有效 id', () => {
  const state = migrateState({
    knowledgeEntries: [
      { id: ' valid-entry ', title: '有效条目' },
      { id: '   ', title: '空 id 条目' },
      { title: '缺失 id 条目' }
    ]
  });

  assert.deepEqual(state.knowledgeEntries.map(entry => entry.id), ['valid-entry']);
});

test('浏览器 VM 缺少知识 schema 时拒绝迁移并且不写回原数据', () => {
  const context = { console };
  vm.runInNewContext(fs.readFileSync(require.resolve('../prototype/storage.js'), 'utf8'), context);
  const raw = JSON.stringify({ knowledgeEntries: [{ id: 'keep-me', title: '保留条目' }] });
  let writeCalls = 0;
  const storage = {
    getItem() { return raw; },
    setItem() { writeCalls += 1; }
  };

  assert.throws(
    () => context.ForwardStepStorage.loadState(storage),
    error => error.name === 'KnowledgeSchemaUnavailableError'
      && error.code === 'KNOWLEDGE_SCHEMA_UNAVAILABLE'
  );
  assert.equal(writeCalls, 0);
});

test('普通提示词和未确认复盘不会自动写入已验证案例', () => {
  const initial = createEmptyState();
  const withPrompt = addPromptVersion(initial, { id: 't1', text: '普通提示词' }).state;
  const unchanged = confirmCase(withPrompt, { promptId: 't1', result: '成功' }, false);

  assert.deepEqual(unchanged.cases, []);
  assert.equal(unchanged.prompts.length, 1);
});

test('仅显式确认的案例才会进入案例库', () => {
  const state = confirmCase(createEmptyState(), { id: 'c1', result: '复核通过' }, true);
  assert.equal(state.cases.length, 1);
  assert.equal(state.cases[0].confirmed, true);
  assert.ok(state.cases[0].confirmedAt);
});

test('提示词版本按同组最大版本递增', () => {
  const initial = { ...createEmptyState(), prompts: [
    { groupId: 'manual', version: 1 },
    { groupId: 'manual', version: 3 },
    { groupId: 'project-1', version: 8 }
  ] };
  const first = addPromptVersion(initial, { id: 't2', groupId: 'manual', text: '第二条' });
  const second = addPromptVersion(first.state, { id: 't3', groupId: 'project-1', text: '项目提示词' });

  assert.equal(first.prompt.version, 4);
  assert.equal(second.prompt.version, 9);
  assert.equal(second.prompt.verified, false);
});

test('模型密钥不会被迁移或保存到本地状态', () => {
  const storage = memoryStorage();
  const source = {
    ...createEmptyState(),
    modelApiKey: 'secret-top',
    settings: { apiKey: 'secret-nested', model: 'demo' },
    projects: [{ id: 'p1', idea: 'test', modelKey: 'secret-project' }]
  };

  const state = saveState(storage, source);
  const serialized = storage.getItem(STORAGE_KEY);

  assert.equal(serialized.includes('secret-top'), false);
  assert.equal(serialized.includes('secret-nested'), false);
  assert.equal(serialized.includes('secret-project'), false);
  assert.equal(state.settings.model, 'demo');
});

test('迁移写回失败会返回内存状态和告警，后续保存可重试且告警不持久化', () => {
  const source = { projects: [{ id: 'p1', idea: '保留内存计划' }] };
  const storage = {
    getItem(key) { return key === STORAGE_KEY ? JSON.stringify(source) : null; },
    setItem() { throw new Error('quota exceeded'); }
  };

  const loaded = loadState(storage);
  const state = loaded.state;
  assert.equal(state.projects[0].goalSummary, '保留内存计划');
  assert.equal(loaded.warning.code, 'STORAGE_MIGRATION_WRITE_FAILED');
  assert.match(loaded.warning.message, /quota exceeded/);
  assert.equal(Object.hasOwn(state, 'warning'), false);
  assert.equal(JSON.stringify(state).includes('STORAGE_MIGRATION_WRITE_FAILED'), false);

  const retryStorage = memoryStorage();
  saveState(retryStorage, state);
  assert.equal(JSON.parse(retryStorage.getItem(STORAGE_KEY)).projects[0].goalSummary, '保留内存计划');
  assert.throws(() => saveState({ setItem() { throw new Error('quota exceeded'); } }, source), /quota exceeded/);
});

test('本地存储 getter、getItem 和 JSON 解析异常均抛出可识别错误', () => {
  assert.throws(
    () => loadState({ getItem() { throw new Error('read denied'); } }),
    error => error.name === 'StorageReadError' && error.code === 'STORAGE_READ_FAILED'
  );
  assert.throws(
    () => loadState(memoryStorage({ [STORAGE_KEY]: '{broken json' })),
    error => error.name === 'StorageReadError' && error.code === 'STORAGE_PARSE_FAILED'
  );

  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('getter denied'); }
  });
  try {
    assert.throws(
      () => loadState(),
      error => error.name === 'StorageReadError' && error.code === 'STORAGE_READ_FAILED'
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('应用读取异常后仍可继续使用，但提交计划不会调用保存接口', () => {
  const listeners = new Map();
  const elements = new Map();
  const makeElement = id => ({
    id,
    value: id === 'idea' ? '保留原数据' : '',
    checked: false,
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    addEventListener(type, callback) { listeners.set(`${id}:${type}`, callback); },
    querySelectorAll() { return []; },
    scrollIntoView() {}
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; }
  };
  let saveCalls = 0;
  const memoryState = createEmptyState();
  const window = {
    ForwardStepPromptEngine: require('../prototype/prompt-engine.js'),
    ForwardStepResearchCatalog: require('../prototype/research-catalog.js'),
    ForwardStepStorage: {
      STORAGE_KEY,
      createEmptyState() { return memoryState; },
      loadState() { const error = new Error('读取失败'); error.code = 'STORAGE_READ_FAILED'; throw error; },
      saveState() { saveCalls += 1; throw new Error('不应触发保存'); },
      addPromptVersion
    },
    ForwardStepMethodCards: {
      getMethodCard(domain) { return { id: domain, temporary: domain === '其他', stages: ['阶段一', '阶段二', '阶段三', '阶段四'], stageDetails: Array.from({ length: 4 }, () => ({ description: '', deliverable: '' })), guidance: '' }; },
    },
    scrollTo() {},
    confirm() { return false; }
  };
  const context = {
    window,
    document,
    navigator: { clipboard: { writeText: async () => {} } },
    crypto: { randomUUID: () => 'new-project' },
    fetch: async () => ({ json: async () => ({}) }),
    setTimeout: () => 1,
    clearTimeout() {},
    Date,
    console
  };
  Object.defineProperty(context, 'localStorage', { get() { throw new Error('getter must not be reached'); } });
  vm.runInNewContext(fs.readFileSync(require.resolve('../prototype/app.js'), 'utf8'), context);

  listeners.get('idea-form:submit')({ preventDefault() {} });

  assert.equal(saveCalls, 0);
  assert.equal(memoryState.projects.length, 1);
  assert.equal(memoryState.projects[0].idea, '保留原数据');
});

test('迁移和保存都会剔除未确认案例', () => {
  const source = {
    ...createEmptyState(),
    cases: [
      { id: 'confirmed', confirmed: true, result: '保留' },
      { id: 'pending', confirmed: false, result: '剔除' },
      { id: 'missing-flag', result: '剔除' }
    ]
  };
  const migrated = migrateState(source);
  const saved = saveState(memoryStorage(), source);

  assert.deepEqual(migrated.cases.map(item => item.id), ['confirmed']);
  assert.deepEqual(saved.cases.map(item => item.id), ['confirmed']);
});

test('项目和确认案例中的凭证字段会递归剔除', () => {
  const storage = memoryStorage();
  const source = {
    ...createEmptyState(),
    projects: [{ id: 'p1', accessToken: 'a', nested: { refresh_token: 'b', authorization: 'c', clientSecret: 'd', apiKey: 'e', modelKey: 'f', password: 'g', credentials: ['h'] } }],
    cases: [{ id: 'c1', confirmed: true, credentials: { apiKey: 'case-secret', nested: { accessToken: 'case-token' } } }]
  };

  const saved = saveState(storage, source);
  const serialized = storage.getItem(STORAGE_KEY);
  for (const secret of ['"a"', '"b"', '"c"', '"d"', '"e"', '"f"', '"g"', '"h"', 'case-secret', 'case-token']) {
    assert.equal(serialized.includes(secret), false, `不应持久化 ${secret}`);
  }
  assert.equal(saved.projects[0].id, 'p1');
  assert.equal(saved.cases[0].id, 'c1');

  const confirmed = confirmCase(createEmptyState(), {
    id: 'c2', result: 'ok', nested: { clientSecret: 'review-secret', refreshToken: 'review-token' }
  }, true);
  assert.equal(JSON.stringify(confirmed).includes('review-secret'), false);
  assert.equal(JSON.stringify(confirmed).includes('review-token'), false);
});

test('迁移和保存会递归剔除 cookie、会话、配置路径及未知凭证字段', () => {
  const input = {
    projects: [{
      id: 'p-sensitive',
      cookies: ['cookie-secret'],
      sessionToken: 'session-secret',
      profilePath: 'C:/private/profile',
      authBlob: 'unknown-secret',
      nested: { cookie: 'nested-cookie-secret', password: 'nested-password' }
    }]
  };
  const migrated = migrateState(input);
  const storage = memoryStorage();
  const saved = saveState(storage, input);
  const serialized = storage.getItem(STORAGE_KEY);

  for (const state of [migrated, saved]) {
    assert.equal(state.projects[0].cookies, undefined);
    assert.equal(state.projects[0].sessionToken, undefined);
    assert.equal(state.projects[0].profilePath, undefined);
    assert.equal(state.projects[0].authBlob, undefined);
    assert.equal(state.projects[0].nested.cookie, undefined);
    assert.equal(state.projects[0].nested.password, undefined);
  }
  for (const secret of ['cookie-secret', 'session-secret', 'C:/private/profile', 'unknown-secret', 'nested-cookie-secret', 'nested-password']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('迁移和保存会递归剔除 OAuth token 变体', () => {
  const input = {
    projects: [{
      id: 'oauth-project',
      oauthToken: 'oauth-token-secret',
      nested: {
        oauth_access_token: 'oauth-access-secret',
        oauthRefreshToken: 'oauth-refresh-secret'
      }
    }]
  };
  const storage = memoryStorage();
  const migrated = migrateState(input);
  const saved = saveState(storage, input);

  for (const state of [migrated, saved]) {
    assert.equal(state.projects[0].oauthToken, undefined);
    assert.equal(state.projects[0].nested.oauth_access_token, undefined);
    assert.equal(state.projects[0].nested.oauthRefreshToken, undefined);
  }
  const serialized = storage.getItem(STORAGE_KEY);
  for (const secret of ['oauth-token-secret', 'oauth-access-secret', 'oauth-refresh-secret']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('按案例 id 去重重复确认', () => {
  const once = confirmCase(createEmptyState(), { id: 'same-id', result: '首次' }, true);
  const twice = confirmCase(once, { id: 'same-id', result: '重复' }, true);

  assert.equal(twice.cases.length, 1);
  assert.equal(twice.cases[0].result, '首次');
});

test('确认案例缺少 id 或 id 为空时抛出 TypeError', () => {
  for (const reviewedCase of [{ result: '缺少 id' }, { id: '', result: '空 id' }, { id: '   ', result: '空白 id' }]) {
    assert.throws(
      () => confirmCase(createEmptyState(), reviewedCase, true),
      error => error instanceof TypeError && /非空 id/.test(error.message)
    );
  }
});
