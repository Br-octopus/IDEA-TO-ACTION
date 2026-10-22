const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  createResearchTask,
  normalizeResearchPlan,
  normalizeSocialResult,
  normalizeResearchMaterial,
  resolveDomesticContentId,
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

test('操作队列持久化恢复所需字段并清洗未知字段和敏感信息', () => {
  const [task] = sanitizeResearchState({ researchTasks: [{ id: 'queue-task', operations: [{
    operationId: 'op-1', planVersion: 3, platform: 'bilibili', profileId: 'profile-a', sourceId: 'source-a',
    capability: 'comments', contentId: { bvid: 'BV1234567890', cursor: 0, token: 'secret' }, query: 'query',
    pageCursor: '0', budget: { pages: 2, sourceRequests: 2, token: 'secret' }, state: 'running', attempt: 2,
    apiKey: 'secret'
  }] }] }).researchTasks;
  assert.equal(task.planVersion, 1);
  assert.equal(task.operations[0].state, 'running');
  assert.deepEqual(task.operations[0].contentId, { bvid: 'BV1234567890', cursor: '0' });
  assert.deepEqual(task.operations[0].budget, { pages: 2, sourceRequests: 2 });
  assert.equal(JSON.stringify(task).includes('secret'), false);
});

test('研究任务清洗会保留取消原因，供调用方展示取消结果', () => {
  const task = createResearchTask({ status: 'cancelled', rejectionReason: '用户取消' });
  assert.equal(task.rejectionReason, '用户取消');
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
    contentId: 'post-123',
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
  assert.equal(result.contentId, 'post-123');
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

test('研究材料只保留摘要和来源元数据，未知枚举不猜测且原文不会进入状态', () => {
  const material = normalizeResearchMaterial({
    id: 'material-1', kind: 'comments', contentId: 'note-1', sourceId: 'mediacrawler-lite',
    sourceVersion: '1.0.0', operationId: 'operation-1', connectionMethod: 'local-process',
    acquisitionMethod: 'browser', itemCount: 20, sortOrder: '', sourceType: 'platform-original',
    language: '', status: 'completed', truncated: true, summary: '20 条一级评论',
    content: 'FULL_TEXT_SENTINEL', comments: ['FULL_TEXT_SENTINEL']
  }, 'result-1');
  assert.equal(material.resultId, 'result-1');
  assert.equal(material.sortOrder, 'unknown');
  assert.equal(material.sourceType, 'unknown');
  assert.equal(material.language, 'unknown');
  assert.equal(material.itemCount, 20);
  assert.equal(material.totalCount, null, '旧材料缺少总数时保持 unknown/null');
  assert.equal(material.truncated, true);
  assert.equal(JSON.stringify(material).includes('FULL_TEXT_SENTINEL'), false);
});

test('研究来源请求用量会持久化并保持旧任务兼容', () => {
  const oldTask = createResearchTask({ id: 'old-task', status: 'awaiting-save' });
  const newTask = createResearchTask({
    id: 'new-task', status: 'awaiting-save', budget: { maxSourceRequests: 7 }, usage: { sourceRequests: 4 }
  });
  assert.equal(oldTask.budget.maxSourceRequests, 100);
  assert.equal(oldTask.usage.sourceRequests, 0);
  assert.equal(newTask.budget.maxSourceRequests, 7);
  assert.equal(newTask.usage.sourceRequests, 4);
});

test('平台内容 ID 解析只返回 manager 接受的结构，缺失 ID 时返回 null', () => {
  assert.deepEqual(resolveDomesticContentId({
    platform: 'xiaohongshu', url: 'https://www.xiaohongshu.com/explore/note_123?xsec_source=pc&xsec_token=t'
  }), { noteId: 'note_123', xsecSource: 'pc', xsecToken: 't' });
  assert.deepEqual(resolveDomesticContentId({
    platform: 'xiaohongshu', url: 'https://www.xiaohongshu.com/explore/note_123?XSEC_SOURCE=pc&XSeCToken=t'
  }), { noteId: 'note_123', xsecToken: 't' });
  assert.deepEqual(resolveDomesticContentId({
    platform: 'bilibili', url: 'https://www.bilibili.com/video/BV1Q541167Qg'
  }), { bvid: 'BV1Q541167Qg' });
  assert.deepEqual(resolveDomesticContentId({ platform: 'bilibili', contentId: 'av12345' }), { aid: '12345' });
  assert.deepEqual(resolveDomesticContentId({
    platform: 'weibo', url: 'https://weibo.com/123456/AbC987'
  }), { postId: 'AbC987' });
  assert.deepEqual(resolveDomesticContentId({
    platform: 'weibo', url: 'https://weibo.com/detail/1234567890123456'
  }), { postId: '1234567890123456' });
  assert.equal(resolveDomesticContentId({
    platform: 'weibo', url: 'https://evil.example/123456/AbC987'
  }), null);
  assert.deepEqual(resolveDomesticContentId({
    platform: 'zhihu', url: 'https://www.zhihu.com/question/123/answer/456'
  }), { questionId: '123', answerId: '456' });
  assert.deepEqual(resolveDomesticContentId({
    platform: 'zhihu', url: 'https://zhuanlan.zhihu.com/p/789'
  }), { articleId: '789' });
  assert.equal(resolveDomesticContentId({
    platform: 'zhihu', url: 'https://www.zhihu.com/question/123'
  }), null);
  assert.equal(resolveDomesticContentId({ platform: 'xiaohongshu', url: 'https://example.test/search' }), null);
});

test('小红书持久化结果和清洗状态移除各种大小写的访问 token 参数', () => {
  const result = normalizeSocialResult({
    id: 'xhs-result', platform: 'xiaohongshu',
    url: 'https://www.xiaohongshu.com/explore/note_123?xsec_source=pc&keep=one&XSeCToken=secret-one&xsec_token=secret-two&tail=two'
  });
  const persistedUrl = new URL(result.url);
  assert.equal(persistedUrl.searchParams.get('xsec_source'), 'pc');
  assert.equal(persistedUrl.searchParams.get('keep'), 'one');
  assert.equal(persistedUrl.searchParams.get('tail'), 'two');
  assert.deepEqual([...persistedUrl.searchParams.keys()], ['xsec_source', 'keep', 'tail']);

  const state = sanitizeResearchState({ researchTasks: [{
    id: 'task-xhs', status: 'awaiting-save', results: [result]
  }] });
  assert.equal(state.researchTasks[0].results[0].url, result.url);
  assert.equal(JSON.stringify(state).includes('secret-one'), false);
  assert.equal(JSON.stringify(state).includes('secret-two'), false);
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
