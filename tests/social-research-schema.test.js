const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  createResearchTask,
  normalizeResearchPlan,
  normalizeSocialResult,
  normalizePlatformCapability,
  normalizeAttachmentMeta,
  sanitizeResearchState,
  isSafeHttpUrl
} = require('../prototype/social-research-schema.js');

test('研究任务默认是草稿且不预填平台和结果', () => {
  const task = createResearchTask({ topic: '独立开发者记账工具', template: 'pain-points' });

  assert.equal(task.topic, '独立开发者记账工具');
  assert.equal(task.template, 'pain-points');
  assert.equal(task.status, 'draft');
  assert.deepEqual(task.platforms, []);
  assert.deepEqual(task.results, []);
  assert.deepEqual(task.resultIds, []);
});

test('研究计划、结果和平台能力只保留契约字段', () => {
  const plan = normalizeResearchPlan({
    objective: '找出高频痛点',
    researchType: 'pain-points',
    queries: ['记账工具', '账单同步'],
    budget: { maxPlatforms: 3, apiKey: '不应保留' },
    unknownField: '不应保留'
  });
  const result = normalizeSocialResult({
    platform: 'reddit',
    url: 'https://example.test/post',
    title: '体验',
    publishedAt: '2026-10-19',
    retrievalMethod: 'browser',
    unknownField: '不应保留'
  });
  const capability = normalizePlatformCapability({
    platform: 'reddit',
    supportsSearch: true,
    supportsDetail: true,
    apiKey: '不应保留',
    unknownField: '不应保留'
  });

  assert.deepEqual(plan.queries, ['记账工具', '账单同步']);
  assert.equal(plan.budget.maxPlatforms, 3);
  assert.equal(plan.budget.apiKey, undefined);
  assert.equal(plan.unknownField, undefined);
  assert.equal(result.evidenceStatus, 'unverified');
  assert.equal(result.retrievalMethod, 'browser');
  assert.equal(result.unknownField, undefined);
  assert.equal(capability.platform, 'reddit');
  assert.equal(capability.supportsSearch, true);
  assert.equal(capability.apiKey, undefined);
  assert.equal(capability.unknownField, undefined);
});

test('结果拒绝非 HTTP(S) 地址并接受安全 HTTP 地址', () => {
  assert.equal(isSafeHttpUrl('https://example.test/post'), true);
  assert.equal(isSafeHttpUrl('http://example.test/post'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('data:text/plain,hello'), false);
  assert.throws(
    () => normalizeSocialResult({ url: 'javascript:alert(1)' }),
    /http/
  );
});

test('附件元数据只保留六个可备份字段', () => {
  const attachment = normalizeAttachmentMeta({
    id: 'attachment-1',
    type: 'screenshot',
    size: 1024,
    sourceResultId: 'result-1',
    relativePath: 'research/attachment-1.png',
    savedAt: '2026-10-19T08:00:00.000Z',
    content: '不应保留',
    cookie: '不应保留'
  });

  assert.deepEqual(Object.keys(attachment).sort(), [
    'id', 'relativePath', 'savedAt', 'size', 'sourceResultId', 'type'
  ]);
  assert.equal(attachment.content, undefined);
  assert.equal(attachment.cookie, undefined);
});

test('研究状态清洗会移除平台凭证、会话字段和未知字段', () => {
  const sanitized = sanitizeResearchState({
    researchTasks: [{
      id: 'task-1',
      topic: '研究主题',
      results: [{ id: 'result-1', url: 'https://example.test', summary: '摘要' }],
      report: { coreFindings: ['发现'] },
      selectedResultIds: ['result-1'],
      apiKey: 'task-secret',
      browserSession: 'task-session'
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
        profilePath: 'C:/private/profile',
        futureSecretField: 'unknown-secret'
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
    }],
    unknownResearchField: '不应保留'
  });
  const serialized = JSON.stringify(sanitized);

  assert.deepEqual(Object.keys(sanitized).sort(), [
    'platformConnections', 'researchAttachments', 'researchTasks'
  ]);
  assert.equal(serialized.includes('api-secret'), false);
  assert.equal(serialized.includes('credential-secret'), false);
  assert.equal(serialized.includes('cookie-secret'), false);
  assert.equal(serialized.includes('session-secret'), false);
  assert.equal(serialized.includes('password-secret'), false);
  assert.equal(serialized.includes('C:/private/profile'), false);
  assert.equal(serialized.includes('unknown-secret'), false);
  assert.equal(sanitized.platformConnections.reddit.status, 'needs-recheck');
  assert.deepEqual(Object.keys(sanitized.researchAttachments[0]).sort(), [
    'id', 'relativePath', 'savedAt', 'size', 'sourceResultId', 'type'
  ]);
});

test('schema 同时支持 CommonJS 和浏览器全局导出', () => {
  const context = {};
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../prototype/social-research-schema.js'), 'utf8'),
    context
  );

  assert.equal(typeof context.ForwardStepSocialResearchSchema.createResearchTask, 'function');
  assert.equal(typeof context.ForwardStepSocialResearchSchema.isSafeHttpUrl, 'function');
  assert.equal(typeof createResearchTask, 'function');
});
