const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createBackup,
  validateBackup,
  getBackupSummary,
  replaceState,
  mergeState
} = require('../prototype/workspace-backup.js');

const exportedAt = '2026-10-19T08:00:00.000Z';

function createState() {
  return {
    schemaVersion: 3,
    projects: [{
      id: 'p1',
      title: '项目',
      token: '项目业务 token',
      secret: '项目业务 secret',
      apiKey: '项目业务 apiKey',
      accessToken: 'project-access-token',
      refresh_token: 'project-refresh-token',
      authorization: 'project-authorization',
      clientSecret: 'project-client-secret',
      modelKey: 'project-model-key',
      password: 'project-password',
      credentials: { accessToken: 'nested-project-access-token' },
      config: {
        apiKey: 'project-config-api-key',
        api_key: 'project-config-api-key-snake',
        refreshToken: 'project-refresh-token-camel',
        refresh_token: 'project-refresh-token-snake',
        clientSecret: 'project-client-secret-camel',
        client_secret: 'project-client-secret-snake',
        modelApiKey: 'project-model-api-key-camel',
        model_api_key: 'project-model-api-key-snake'
      }
    }],
    prompts: [{
      id: 'prompt-1',
      text: '提示词正文包含 token、secret 和 apiKey',
      metadata: {
        token: '提示词业务 token',
        secret: '提示词业务 secret',
        apiKey: '提示词业务 apiKey',
        accessToken: 'prompt-access-token',
        refresh_token: 'prompt-refresh-token',
        authorization: 'prompt-authorization',
        clientSecret: 'prompt-client-secret',
        modelKey: 'prompt-model-key',
        password: 'prompt-password',
        credentials: { accessToken: 'nested-prompt-access-token' },
        settings: {
          apiKey: 'prompt-settings-api-key',
          api_key: 'prompt-settings-api-key-snake',
          refreshToken: 'prompt-refresh-token-camel',
          refresh_token: 'prompt-refresh-token-snake',
          clientSecret: 'prompt-client-secret-camel',
          client_secret: 'prompt-client-secret-snake',
          modelApiKey: 'prompt-model-api-key-camel',
          model_api_key: 'prompt-model-api-key-snake'
        }
      }
    }],
    references: [{ id: 'reference-1', title: '公开资料' }],
    researchSelection: ['reference-1'],
    knowledgeEntries: [{
      id: 'entry-1',
      title: '资料',
      favorite: true,
      metadata: {
        accessToken: 'knowledge-access-token',
        refresh_token: 'knowledge-refresh-token',
        authorization: 'knowledge-authorization',
        clientSecret: 'knowledge-client-secret',
        modelKey: 'knowledge-model-key',
        password: 'knowledge-password',
        credentials: { accessToken: 'nested-knowledge-access-token' },
        configuration: {
          apiKey: 'knowledge-config-api-key',
          api_key: 'knowledge-config-api-key-snake',
          refreshToken: 'knowledge-refresh-token-camel',
          refresh_token: 'knowledge-refresh-token-snake',
          clientSecret: 'knowledge-client-secret-camel',
          client_secret: 'knowledge-client-secret-snake',
          modelApiKey: 'knowledge-model-api-key-camel',
          model_api_key: 'knowledge-model-api-key-snake'
        }
      }
    }],
    knowledgeSelection: ['entry-1'],
    knowledgeFilters: { query: '资料', verificationStatus: 'user-confirmed' },
    cases: [{
      id: 'case-1',
      confirmed: true,
      result: '案例结果',
      token: '案例业务 token',
      secret: '案例业务 secret',
      apiKey: '案例业务 apiKey',
      accessToken: 'case-access-token',
      refresh_token: 'case-refresh-token',
      authorization: 'case-authorization',
      clientSecret: 'case-client-secret',
      modelKey: 'case-model-key',
      password: 'case-password',
      credentials: { accessToken: 'nested-case-access-token' },
      provider: {
        apiKey: 'case-provider-api-key',
        api_key: 'case-provider-api-key-snake',
        refreshToken: 'case-refresh-token-camel',
        refresh_token: 'case-refresh-token-snake',
        clientSecret: 'case-client-secret-camel',
        client_secret: 'case-client-secret-snake',
        modelApiKey: 'case-model-api-key-camel',
        model_api_key: 'case-model-api-key-snake'
      }
    }],
    knowledgeMetadata: {
      authorization: 'metadata-authorization',
      nested: {
        refresh_token: 'nested-metadata-refresh-token',
        refreshToken: 'nested-metadata-refresh-token-camel',
        client_secret: 'nested-metadata-client-secret-snake',
        model_api_key: 'nested-metadata-model-api-key-snake',
        api_key: 'nested-metadata-api-key-snake'
      }
    }
  };
}

test('完整工作区备份包含业务数据但不包含凭证', () => {
  const state = createState();
  const backup = createBackup(state, { scope: 'workspace', appVersion: '0.1.0', now: exportedAt });

  assert.equal(backup.format, 'forward-step-workspace');
  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.appVersion, '0.1.0');
  assert.equal(backup.exportedAt, exportedAt);
  assert.equal(backup.scope, 'workspace');
  assert.equal(backup.data.projects.length, 1);
  assert.equal(backup.data.prompts.length, 1);
  assert.deepEqual(backup.data.knowledgeSelection, ['entry-1']);
  assert.deepEqual(backup.data.knowledgeFilters, state.knowledgeFilters);
  const serialized = JSON.stringify(backup);
  const credentials = [
    'project-access-token', 'project-refresh-token', 'project-authorization', 'project-client-secret',
    'project-model-key', 'project-password', 'nested-project-access-token',
    'prompt-access-token', 'prompt-refresh-token', 'prompt-authorization', 'prompt-client-secret',
    'prompt-model-key', 'prompt-password', 'nested-prompt-access-token',
    'case-access-token', 'case-refresh-token', 'case-authorization', 'case-client-secret',
    'case-model-key', 'case-password', 'nested-case-access-token',
    'knowledge-access-token', 'knowledge-refresh-token', 'knowledge-authorization',
    'knowledge-client-secret', 'knowledge-model-key', 'knowledge-password',
    'nested-knowledge-access-token', 'metadata-authorization', 'nested-metadata-refresh-token',
    'project-config-api-key', 'project-config-api-key-snake', 'project-refresh-token-camel',
    'project-refresh-token-snake', 'project-client-secret-camel', 'project-client-secret-snake',
    'project-model-api-key-camel', 'project-model-api-key-snake', 'prompt-settings-api-key',
    'prompt-settings-api-key-snake', 'prompt-refresh-token-camel', 'prompt-refresh-token-snake',
    'prompt-client-secret-camel', 'prompt-client-secret-snake', 'prompt-model-api-key-camel',
    'prompt-model-api-key-snake', 'knowledge-config-api-key', 'knowledge-config-api-key-snake',
    'knowledge-refresh-token-camel', 'knowledge-refresh-token-snake', 'knowledge-client-secret-camel',
    'knowledge-client-secret-snake', 'knowledge-model-api-key-camel', 'knowledge-model-api-key-snake',
    'case-provider-api-key', 'case-provider-api-key-snake', 'case-refresh-token-camel',
    'case-refresh-token-snake', 'case-client-secret-camel', 'case-client-secret-snake',
    'case-model-api-key-camel', 'case-model-api-key-snake', 'nested-metadata-refresh-token-camel',
    'nested-metadata-client-secret-snake', 'nested-metadata-model-api-key-snake',
    'nested-metadata-api-key-snake'
  ];
  for (const credential of credentials) assert.equal(serialized.includes(credential), false, `不应导出 ${credential}`);
  assert.equal(Object.hasOwn(backup.data, 'knowledgeMetadata'), true);
  assert.match(serialized, /项目业务 token/);
  assert.match(serialized, /项目业务 secret/);
  assert.match(serialized, /项目业务 apiKey/);
  assert.match(serialized, /提示词业务 token/);
  assert.match(serialized, /案例业务 apiKey/);
  assert.deepEqual(state.projects[0].apiKey, '项目业务 apiKey');

  const knowledgeBackup = createBackup(state, { scope: 'knowledge-base', now: exportedAt });
  const knowledgeSerialized = JSON.stringify(knowledgeBackup);
  for (const credential of credentials) {
    assert.equal(knowledgeSerialized.includes(credential), false, `资料库不应导出 ${credential}`);
  }
});

test('资料库备份只包含资料、案例和资料相关状态', () => {
  const backup = createBackup(createState(), { scope: 'knowledge-base', now: exportedAt });

  assert.equal(validateBackup(backup), true);
  assert.equal(backup.scope, 'knowledge-base');
  assert.equal(backup.data.knowledgeEntries.length, 1);
  assert.equal(backup.data.cases.length, 1);
  assert.deepEqual(backup.data.knowledgeSelection, ['entry-1']);
  assert.deepEqual(backup.data.knowledgeFilters.query, '资料');
  assert.equal(Object.hasOwn(backup.data, 'projects'), false);
  assert.equal(Object.hasOwn(backup.data, 'prompts'), false);
  assert.equal(Object.hasOwn(backup.data, 'references'), false);
});

test('空 workspace 和 knowledge-base 备份包含合法的选择和筛选状态', () => {
  for (const scope of ['workspace', 'knowledge-base']) {
    const backup = createBackup({}, { scope, now: exportedAt });

    assert.equal(validateBackup(backup), true);
    assert.deepEqual(backup.data.knowledgeSelection, []);
    assert.deepEqual(backup.data.knowledgeFilters, {});
  }
});

test('非法备份会被拒绝', () => {
  assert.throws(() => validateBackup({ format: 'unknown' }), /备份格式/);
  assert.throws(() => validateBackup({
    format: 'forward-step-workspace',
    schemaVersion: 1,
    appVersion: '',
    exportedAt,
    scope: 'workspace',
    counts: {},
    data: { projects: [] }
  }), /核心数据/);
});

test('缺少 workspace 或 knowledge-base 的选择和筛选状态会被拒绝', () => {
  for (const scope of ['workspace', 'knowledge-base']) {
    const backup = createBackup(createState(), { scope, now: exportedAt });
    delete backup.data.knowledgeSelection;
    assert.throws(() => validateBackup(backup), /选择/);

    const backupWithoutFilters = createBackup(createState(), { scope, now: exportedAt });
    delete backupWithoutFilters.data.knowledgeFilters;
    assert.throws(() => validateBackup(backupWithoutFilters), /筛选/);
  }
});

test('核心集合类型错误或 counts 与实际长度不一致会被拒绝', () => {
  const wrongArrayType = createBackup(createState(), { scope: 'workspace', now: exportedAt });
  wrongArrayType.data.projects = {};
  assert.throws(() => validateBackup(wrongArrayType), /核心数据/);

  const wrongFilterType = createBackup(createState(), { scope: 'knowledge-base', now: exportedAt });
  wrongFilterType.data.knowledgeFilters = [];
  assert.throws(() => validateBackup(wrongFilterType), /筛选/);

  const wrongCounts = createBackup(createState(), { scope: 'workspace', now: exportedAt });
  wrongCounts.counts.projects = 99;
  assert.throws(() => validateBackup(wrongCounts), /统计/);
});

test('备份按 scope 严格限制 data 和 counts 字段白名单', () => {
  const knowledgeBackup = createBackup(createState(), { scope: 'knowledge-base', now: exportedAt });
  knowledgeBackup.data.projects = [];
  assert.throws(() => validateBackup(knowledgeBackup), /字段/);

  const extraKnowledgeField = createBackup(createState(), { scope: 'knowledge-base', now: exportedAt });
  extraKnowledgeField.data.extra = true;
  assert.throws(() => validateBackup(extraKnowledgeField), /字段/);

  const workspaceBackup = createBackup(createState(), { scope: 'workspace', now: exportedAt });
  workspaceBackup.data.extra = true;
  assert.throws(() => validateBackup(workspaceBackup), /字段/);

  const extraCount = createBackup(createState(), { scope: 'workspace', now: exportedAt });
  extraCount.counts.extra = 0;
  assert.throws(() => validateBackup(extraCount), /统计字段/);
});

test('集合条目缺少或包含非法稳定 id 会被拒绝', () => {
  const missingId = createBackup(createState(), { scope: 'workspace', now: exportedAt });
  missingId.data.prompts[0].id = '';
  assert.throws(() => validateBackup(missingId), /id/);

  const invalidId = createBackup(createState(), { scope: 'knowledge-base', now: exportedAt });
  invalidId.data.knowledgeEntries[0].id = 42;
  assert.throws(() => validateBackup(invalidId), /id/);
});

test('备份摘要返回范围和各类数量', () => {
  const backup = createBackup(createState(), { scope: 'workspace', now: exportedAt });
  assert.deepEqual(getBackupSummary(backup), {
    scope: 'workspace',
    exportedAt,
    counts: {
      projects: 1,
      prompts: 1,
      cases: 1,
      knowledgeEntries: 1,
      references: 1
    }
  });
});

test('替换只保留备份状态且不修改入参', () => {
  const currentState = { projects: [{ id: 'current' }], prompts: [{ id: 'old-prompt' }] };
  const backup = createBackup({ projects: [{ id: 'backup' }], prompts: [{ id: 'new-prompt' }] }, {
    scope: 'workspace',
    now: exportedAt
  });
  const currentBefore = JSON.stringify(currentState);
  const backupBefore = JSON.stringify(backup);

  const result = replaceState(currentState, backup);

  assert.deepEqual(result, backup.data);
  assert.deepEqual(currentState, JSON.parse(currentBefore));
  assert.deepEqual(backup, JSON.parse(backupBefore));
  assert.notEqual(result, backup.data);
});

test('workspace 备份替换后同时保留 researchSelection 和 knowledgeSelection', () => {
  const state = createState();
  const backup = createBackup(state, { scope: 'workspace', now: exportedAt });
  const restored = replaceState({}, backup);

  assert.deepEqual(restored.researchSelection, ['reference-1']);
  assert.deepEqual(restored.knowledgeSelection, ['entry-1']);
});

test('合并按 id 去重，保留当前数据并报告新增、跳过和冲突', () => {
  const currentState = {
    projects: [{ id: 'p1', title: '当前项目' }],
    prompts: [{ id: 'prompt-1', text: '当前提示词' }],
    cases: [],
    knowledgeEntries: []
  };
  const backup = createBackup({
    projects: [{ id: 'p1', title: '备份项目' }, { id: 'p2', title: '新项目' }],
    prompts: [{ id: 'prompt-1', text: '备份提示词' }, { id: 'prompt-2', text: '新提示词' }],
    cases: [],
    knowledgeEntries: []
  }, { scope: 'workspace', now: exportedAt });
  const currentBefore = JSON.stringify(currentState);

  const result = mergeState(currentState, backup);

  assert.equal(result.state.projects.length, 2);
  assert.equal(result.state.projects[0].title, '当前项目');
  assert.equal(result.state.projects[1].id, 'p2');
  assert.equal(result.state.prompts.length, 2);
  assert.deepEqual(result.added, [
    { collection: 'projects', id: 'p2' },
    { collection: 'prompts', id: 'prompt-2' }
  ]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.conflicts, [
    { collection: 'projects', id: 'p1' },
    { collection: 'prompts', id: 'prompt-1' }
  ]);
  assert.deepEqual(currentState, JSON.parse(currentBefore));
});

test('合并兼容旧状态时保留无效当前条目并报告可追踪的 skipped', () => {
  const currentState = {
    projects: [{ title: '旧项目，没有 id' }],
    prompts: [],
    cases: [],
    knowledgeEntries: []
  };
  const backup = createBackup({
    projects: [{ id: 'p2', title: '新项目' }],
    prompts: [],
    cases: [],
    knowledgeEntries: []
  }, { scope: 'workspace', now: exportedAt });

  const result = mergeState(currentState, backup);

  assert.equal(result.state.projects.length, 2);
  assert.equal(result.state.projects[0].title, '旧项目，没有 id');
  assert.deepEqual(result.skipped, [{
    collection: 'projects',
    index: 0,
    id: null,
    reason: 'current-invalid-id'
  }]);
  assert.deepEqual(result.added, [{ collection: 'projects', id: 'p2' }]);
});

test('合并外部备份时跳过非法 id 并继续处理合法条目，严格校验仍然拒绝', () => {
  const backup = createBackup({
    projects: [{ id: 'p1', title: '问题项目' }, { id: 'p2', title: '合法项目' }],
    prompts: [],
    cases: [],
    knowledgeEntries: []
  }, { scope: 'workspace', now: exportedAt });
  backup.data.projects[0].id = '';

  assert.throws(() => validateBackup(backup), /id/);

  const result = mergeState({ projects: [], prompts: [], cases: [], knowledgeEntries: [] }, backup);

  assert.equal(result.state.projects.length, 1);
  assert.equal(result.state.projects[0].id, 'p2');
  assert.equal(result.state.projects[0].title, '合法项目');
  assert.deepEqual(result.added, [{ collection: 'projects', id: 'p2' }]);
  assert.deepEqual(result.skipped, [{
    collection: 'projects',
    index: 0,
    id: '',
    reason: 'incoming-invalid-id'
  }]);
  assert.deepEqual(result.conflicts, []);
});

test('合并外部备份时报告非法 id 的原始值', () => {
  const backup = createBackup({
    projects: [{ id: 'p1' }],
    prompts: [],
    cases: [],
    knowledgeEntries: []
  }, { scope: 'workspace', now: exportedAt });
  backup.data.projects[0].id = 42;

  const result = mergeState({ projects: [], prompts: [], cases: [], knowledgeEntries: [] }, backup);

  assert.deepEqual(result.skipped, [{
    collection: 'projects',
    index: 0,
    id: 42,
    reason: 'incoming-invalid-id'
  }]);
});

test('合并报告按集合和 id 去重，不丢失跨集合相同 id', () => {
  const incoming = createBackup({
    projects: [{ id: 'same', title: '项目' }],
    prompts: [{ id: 'same', text: '提示词' }],
    cases: [],
    knowledgeEntries: []
  }, { scope: 'workspace', now: exportedAt });
  incoming.data.projects.push({ ...incoming.data.projects[0], title: '项目重复' });
  incoming.counts.projects = 2;
  const added = mergeState({ projects: [], prompts: [], cases: [], knowledgeEntries: [] }, incoming);

  assert.deepEqual(added.added, [
    { collection: 'projects', id: 'same' },
    { collection: 'prompts', id: 'same' }
  ]);
  assert.deepEqual(added.skipped, [{
    collection: 'projects',
    index: 1,
    id: 'same',
    reason: 'duplicate-id'
  }]);

  const conflict = mergeState({
    projects: [{ id: 'same', title: '当前项目' }],
    prompts: [{ id: 'same', text: '当前提示词' }],
    cases: [],
    knowledgeEntries: []
  }, incoming);
  assert.deepEqual(conflict.added, []);
  assert.deepEqual(conflict.conflicts, [
    { collection: 'projects', id: 'same' },
    { collection: 'prompts', id: 'same' }
  ]);
});

test('严格校验和替换拒绝集合内重复 id，合并则报告重复条目', () => {
  const duplicate = createBackup({
    projects: [{ id: 'same', title: '项目' }],
    prompts: [],
    cases: [],
    knowledgeEntries: []
  }, { scope: 'workspace', now: exportedAt });
  duplicate.data.projects.push({ ...duplicate.data.projects[0] });
  duplicate.counts.projects = 2;

  assert.throws(() => validateBackup(duplicate), /重复/);
  assert.throws(() => replaceState({}, duplicate), /重复/);

  const result = mergeState({ projects: [], prompts: [], cases: [], knowledgeEntries: [] }, duplicate);

  assert.equal(result.state.projects.length, 1);
  assert.deepEqual(result.added, [{ collection: 'projects', id: 'same' }]);
  assert.deepEqual(result.skipped, [{
    collection: 'projects',
    index: 1,
    id: 'same',
    reason: 'duplicate-id'
  }]);
});
