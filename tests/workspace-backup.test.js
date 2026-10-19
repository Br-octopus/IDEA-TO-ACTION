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
      },
      nested: {
        apiKey: 'project-nested-api-key',
        api_key: 'project-nested-api-key-snake',
        API_KEY: 'project-nested-api-key-upper',
        refreshToken: 'project-nested-refresh-token'
      }
    }],
    prompts: [{
      id: 'prompt-1',
      token: '提示词业务 token',
      secret: '提示词业务 secret',
      apiKey: '提示词业务 apiKey',
      text: '提示词正文包含 token、secret 和 apiKey',
      metadata: {
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
      },
      nested: {
        apiKey: 'prompt-nested-api-key',
        api_key: 'prompt-nested-api-key-snake',
        API_KEY: 'prompt-nested-api-key-upper',
        refreshToken: 'prompt-nested-refresh-token'
      }
    }],
    references: [{
      id: 'reference-1',
      title: '公开资料',
      token: '参考业务 token',
      secret: '参考业务 secret',
      apiKey: '参考业务 apiKey',
      authorization: 'reference-authorization',
      config: {
        apiKey: 'reference-config-api-key',
        api_key: 'reference-config-api-key-snake',
        refreshToken: 'reference-refresh-token',
        client_secret: 'reference-client-secret'
      },
      nested: {
        apiKey: 'nested-reference-api-key',
        api_key: 'nested-reference-api-key-snake',
        API_KEY: 'nested-reference-api-key-upper',
        refreshToken: 'nested-reference-refresh-token',
        authorization: 'nested-reference-authorization',
        model_api_key: 'nested-reference-model-api-key'
      }
    }],
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
        },
        nested: {
          apiKey: 'knowledge-nested-api-key',
          api_key: 'knowledge-nested-api-key-snake',
          API_KEY: 'knowledge-nested-api-key-upper',
          refreshToken: 'knowledge-nested-refresh-token'
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
      },
      nested: {
        apiKey: 'case-nested-api-key',
        api_key: 'case-nested-api-key-snake',
        API_KEY: 'case-nested-api-key-upper',
        refreshToken: 'case-nested-refresh-token'
      }
    }],
    knowledgeMetadata: {
      authorization: 'metadata-authorization',
      nested: {
        refresh_token: 'nested-metadata-refresh-token',
        refreshToken: 'nested-metadata-refresh-token-camel',
        client_secret: 'nested-metadata-client-secret-snake',
        model_api_key: 'nested-metadata-model-api-key-snake',
        api_key: 'nested-metadata-api-key-snake',
        apiKey: 'nested-metadata-api-key',
        API_KEY: 'nested-metadata-api-key-upper',
        refreshToken: 'nested-metadata-refresh-token-camel'
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
    'nested-metadata-api-key-snake', 'nested-metadata-api-key', 'nested-metadata-api-key-upper',
    'reference-authorization',
    'reference-config-api-key', 'reference-config-api-key-snake',
    'reference-refresh-token', 'reference-client-secret',
    'nested-reference-authorization', 'nested-reference-model-api-key',
    'project-nested-api-key', 'project-nested-api-key-snake', 'project-nested-api-key-upper',
    'project-nested-refresh-token', 'prompt-nested-api-key', 'prompt-nested-api-key-snake',
    'prompt-nested-api-key-upper', 'prompt-nested-refresh-token', 'nested-reference-api-key',
    'nested-reference-api-key-snake', 'nested-reference-api-key-upper', 'nested-reference-refresh-token',
    'knowledge-nested-api-key', 'knowledge-nested-api-key-snake', 'knowledge-nested-api-key-upper',
    'knowledge-nested-refresh-token', 'case-nested-api-key', 'case-nested-api-key-snake',
    'case-nested-api-key-upper', 'case-nested-refresh-token'
  ];
  for (const credential of credentials) assert.equal(serialized.includes(credential), false, `不应导出 ${credential}`);
  assert.equal(Object.hasOwn(backup.data, 'knowledgeMetadata'), true);
  assert.match(serialized, /项目业务 token/);
  assert.match(serialized, /项目业务 secret/);
  assert.match(serialized, /提示词业务 token/);
  assert.match(serialized, /参考业务 token/);
  assert.match(serialized, /参考业务 secret/);
  assert.equal(serialized.includes('业务 apiKey'), false);
  assert.deepEqual(state.projects[0].apiKey, '项目业务 apiKey');

  const knowledgeBackup = createBackup(state, { scope: 'knowledge-base', now: exportedAt });
  const knowledgeSerialized = JSON.stringify(knowledgeBackup);
  for (const credential of credentials) {
    assert.equal(knowledgeSerialized.includes(credential), false, `资料库不应导出 ${credential}`);
  }
});

test('备份和恢复会递归拒绝所有本地凭证与未知敏感字段', () => {
  const state = {
    projects: [{
      id: 'project-sensitive',
      cookies: ['cookie-secret'],
      sessionToken: 'session-secret',
      profilePath: 'C:/private/profile',
      authBlob: 'unknown-secret',
      nested: { cookie: 'nested-cookie-secret', password: 'nested-password' }
    }],
    knowledgeEntries: [{
      id: 'entry-sensitive',
      title: '已保存资料',
      metadata: { sessionToken: 'knowledge-session-secret', credential: 'knowledge-credential-secret' }
    }]
  };
  const backup = createBackup(state, { scope: 'workspace', now: exportedAt });
  const restored = replaceState({}, backup);
  const knowledgeBackup = createBackup(state, { scope: 'knowledge-base', now: exportedAt });
  const serialized = JSON.stringify({ backup, restored, knowledgeBackup });

  for (const secret of [
    'cookie-secret', 'session-secret', 'C:/private/profile', 'unknown-secret',
    'nested-cookie-secret', 'nested-password', 'knowledge-session-secret',
    'knowledge-credential-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, `不得导出或恢复 ${secret}`);
  }
  assert.equal(restored.projects[0].nested.cookie, undefined);
  assert.equal(restored.projects[0].nested.password, undefined);
});

test('references 凭证清洗后仍可替换和合并', () => {
  const backup = createBackup(createState(), { scope: 'workspace', now: exportedAt });
  const replaced = replaceState({}, backup);
  assert.deepEqual(replaced.references, backup.data.references);
  assert.equal(replaced.references[0].id, 'reference-1');
  assert.equal(replaced.references[0].title, '公开资料');

  const result = mergeState({
    projects: [{ id: 'p1' }],
    prompts: [{ id: 'prompt-1' }],
    cases: [{ id: 'case-1' }],
    knowledgeEntries: [{ id: 'entry-1' }],
    references: []
  }, backup);
  assert.deepEqual(result.state.references, backup.data.references);
  assert.deepEqual(result.added, [{ collection: 'references', id: 'reference-1' }]);
});

test('资料库备份只包含资料、案例和资料相关状态', () => {
  const backup = createBackup(createState(), { scope: 'knowledge-base', now: exportedAt });

  assert.equal(validateBackup(backup), true);
  assert.equal(backup.scope, 'knowledge-base');
  assert.equal(backup.data.knowledgeEntries.length, 1);
  assert.equal(backup.data.cases.length, 1);
  assert.deepEqual(backup.data.knowledgeMetadata, { nested: {} });
  assert.equal(Object.hasOwn(backup.data, 'knowledgeSelection'), false);
  assert.equal(Object.hasOwn(backup.data, 'knowledgeFilters'), false);
  assert.equal(Object.hasOwn(backup.data, 'caseFilters'), false);
  assert.equal(Object.hasOwn(backup.data, 'filterState'), false);
  assert.equal(Object.hasOwn(backup.data, 'projects'), false);
  assert.equal(Object.hasOwn(backup.data, 'prompts'), false);
  assert.equal(Object.hasOwn(backup.data, 'references'), false);
});

test('空 workspace 备份包含合法的选择和筛选状态，knowledge-base 只保留资料字段', () => {
  const workspaceBackup = createBackup({}, { scope: 'workspace', now: exportedAt });
  assert.equal(validateBackup(workspaceBackup), true);
  assert.deepEqual(workspaceBackup.data.knowledgeSelection, []);
  assert.deepEqual(workspaceBackup.data.knowledgeFilters, {});

  const knowledgeBackup = createBackup({}, { scope: 'knowledge-base', now: exportedAt });
  assert.equal(validateBackup(knowledgeBackup), true);
  assert.deepEqual(Object.keys(knowledgeBackup.data).sort(), [
    'cases', 'knowledgeEntries', 'knowledgeMetadata'
  ]);
  assert.deepEqual(knowledgeBackup.data.knowledgeMetadata, {});
});

test('完整工作区备份保留研究任务报告结果选择和附件元数据，但不保留连接凭证', () => {
  const state = {
    researchTasks: [{
      id: 'task-1',
      topic: '独立开发者记账工具',
      status: 'report-ready',
      results: [{ id: 'result-1', url: 'https://example.test/post', summary: '结果摘要' }],
      report: { coreFindings: ['高频痛点'] },
      selectedResultIds: ['result-1'],
      apiKey: 'task-secret'
    }],
    platformConnections: {
      reddit: {
        platform: 'reddit',
        status: 'ready',
        apiKey: 'api-secret',
        credential: 'credential-secret',
        cookies: ['cookie-secret'],
        sessionToken: 'session-secret',
        password: 'password-secret',
        profilePath: 'C:/private/profile'
      }
    },
    researchAttachments: [{
      id: 'attachment-1',
      type: 'screenshot',
      size: 12,
      sourceResultId: 'result-1',
      relativePath: 'research/a.png',
      savedAt: '2026-10-19T08:00:00.000Z',
      password: 'attachment-secret'
    }]
  };

  const backup = createBackup(state, { scope: 'workspace', now: exportedAt });
  const restored = replaceState({}, backup);
  const serialized = JSON.stringify(backup);

  assert.equal(validateBackup(backup), true);
  assert.equal(backup.data.researchTasks[0].report.coreFindings[0], '高频痛点');
  assert.deepEqual(backup.data.researchTasks[0].selectedResultIds, ['result-1']);
  assert.deepEqual(backup.data.researchAttachments[0], {
    id: 'attachment-1',
    type: 'screenshot',
    size: 12,
    sourceResultId: 'result-1',
    relativePath: 'research/a.png',
    savedAt: '2026-10-19T08:00:00.000Z'
  });
  assert.equal(backup.data.platformConnections.reddit.status, 'needs-recheck');
  assert.deepEqual(restored.researchTasks, backup.data.researchTasks);
  for (const secret of [
    'task-secret', 'api-secret', 'credential-secret', 'cookie-secret',
    'session-secret', 'password-secret', 'C:/private/profile', 'attachment-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, `不应备份 ${secret}`);
  }
});

test('资料库备份不带研究任务和平台连接，只保留已保存资料', () => {
  const backup = createBackup({
    researchTasks: [{ id: 'task-1', topic: '临时研究' }],
    platformConnections: { reddit: { status: 'ready', apiKey: 'secret' } },
    researchAttachments: [{
      id: 'attachment-1', type: 'screenshot', size: 1,
      sourceResultId: 'result-1', relativePath: 'research/a.png', savedAt: exportedAt
    }],
    knowledgeEntries: [{ id: 'entry-1', title: '已保存研究资料', sourceKind: 'research' }],
    cases: []
  }, { scope: 'knowledge-base', now: exportedAt });

  assert.equal(Object.hasOwn(backup.data, 'researchTasks'), false);
  assert.equal(Object.hasOwn(backup.data, 'platformConnections'), false);
  assert.equal(Object.hasOwn(backup.data, 'researchAttachments'), false);
  assert.deepEqual(backup.data.knowledgeEntries.map(entry => entry.title), ['已保存研究资料']);
  assert.equal(JSON.stringify(backup).includes('secret'), false);
});

test('恢复和合并现有工作区时也会清洗当前研究连接中的凭证', () => {
  const backup = createBackup({ knowledgeEntries: [], cases: [] }, {
    scope: 'knowledge-base',
    now: exportedAt
  });
  const currentState = {
    platformConnections: {
      reddit: {
        platform: 'reddit',
        apiKey: 'current-api-secret',
        cookies: ['current-cookie-secret'],
        status: 'ready'
      }
    },
    researchTasks: [{ id: 'task-1', topic: '保留任务', password: 'current-password-secret' }]
  };

  const replaced = replaceState(currentState, backup);
  const merged = mergeState(currentState, backup).state;

  for (const result of [replaced, merged]) {
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('current-api-secret'), false);
    assert.equal(serialized.includes('current-cookie-secret'), false);
    assert.equal(serialized.includes('current-password-secret'), false);
    assert.equal(result.platformConnections.reddit.status, 'needs-recheck');
  }
});

test('knowledge-base 拒绝 workspace 选择筛选状态和未知字段', () => {
  for (const field of [
    'knowledgeSelection', 'knowledgeFilters', 'caseFilters', 'filterState',
    'projects', 'prompts', 'references'
  ]) {
    const backup = createBackup(createState(), { scope: 'knowledge-base', now: exportedAt });
    backup.data[field] = field.endsWith('Filters') || field === 'filterState' ? {} : [];
    assert.throws(() => validateBackup(backup), /字段/);
  }
});

test('knowledge-base 缺少资料元数据会被拒绝', () => {
  const backup = createBackup({}, { scope: 'knowledge-base', now: exportedAt });
  delete backup.data.knowledgeMetadata;

  assert.throws(() => validateBackup(backup), /元数据/);
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

test('workspace 缺少选择或筛选状态会被拒绝', () => {
  const backup = createBackup(createState(), { scope: 'workspace', now: exportedAt });
  delete backup.data.knowledgeSelection;
  assert.throws(() => validateBackup(backup), /选择/);

  const backupWithoutFilters = createBackup(createState(), { scope: 'workspace', now: exportedAt });
  delete backupWithoutFilters.data.knowledgeFilters;
  assert.throws(() => validateBackup(backupWithoutFilters), /筛选/);
});

test('核心集合类型错误或 counts 与实际长度不一致会被拒绝', () => {
  const wrongArrayType = createBackup(createState(), { scope: 'workspace', now: exportedAt });
  wrongArrayType.data.projects = {};
  assert.throws(() => validateBackup(wrongArrayType), /核心数据/);

  const wrongMetadataType = createBackup(createState(), { scope: 'knowledge-base', now: exportedAt });
  wrongMetadataType.data.knowledgeMetadata = [];
  assert.throws(() => validateBackup(wrongMetadataType), /元数据/);

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
