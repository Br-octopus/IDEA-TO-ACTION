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
    projects: [{ id: 'p1', title: '项目', apiKey: 'project-secret' }],
    prompts: [{ id: 'prompt-1', text: '提示词', token: 'prompt-secret' }],
    references: [{ id: 'reference-1', title: '公开资料' }],
    researchSelection: ['reference-1'],
    knowledgeEntries: [{
      id: 'entry-1',
      title: '资料',
      favorite: true,
      metadata: { accessToken: 'entry-secret' }
    }],
    knowledgeSelection: ['entry-1'],
    knowledgeFilters: { query: '资料', verificationStatus: 'user-confirmed' },
    cases: [{ id: 'case-1', confirmed: true, result: '案例结果', password: 'case-secret' }]
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
  assert.equal(JSON.stringify(backup).includes('secret'), false);
  assert.deepEqual(state.projects[0].apiKey, 'project-secret');
});

test('资料库备份只包含资料、案例和资料相关状态', () => {
  const backup = createBackup(createState(), { scope: 'knowledge-base', now: exportedAt });

  assert.equal(backup.scope, 'knowledge-base');
  assert.equal(backup.data.knowledgeEntries.length, 1);
  assert.equal(backup.data.cases.length, 1);
  assert.deepEqual(backup.data.knowledgeSelection, ['entry-1']);
  assert.deepEqual(backup.data.knowledgeFilters.query, '资料');
  assert.equal(Object.hasOwn(backup.data, 'projects'), false);
  assert.equal(Object.hasOwn(backup.data, 'prompts'), false);
  assert.equal(Object.hasOwn(backup.data, 'references'), false);
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
  assert.deepEqual(result.added, ['p2', 'prompt-2']);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.conflicts, ['p1', 'prompt-1']);
  assert.deepEqual(currentState, JSON.parse(currentBefore));
});
