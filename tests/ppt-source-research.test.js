const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPptResearchPlan,
  splitResearchBatches,
  recordResearchProgress,
  summarizeSourceCoverage,
  rankPptSources,
  normalizePptSourceResult,
  classifyPptMaterial,
  classifyPptPages,
  buildSourceSendPreview,
  selectSourceRerunScope
} = require('../prototype/ppt-source-research.js');

test('普通请求沿用最多 3 个查询和 5 个来源的默认预算', () => {
  const plan = buildPptResearchPlan({
    presentationType: '产品介绍',
    stage: 'outline',
    goal: '解释新方案为什么值得采用'
  });

  assert.deepEqual(plan.budget, { maxQueries: 3, maxSources: 5 });
  assert.equal(plan.mode, 'default');
  assert.ok(plan.queries.length <= 3);
  assert.equal(plan.totalSourceLimit, 5);
  assert.equal(plan.requiresConfirmation, false);
});

test('大量搜索生成多批查询并显示计划总量，且作为明确授权不重复确认', () => {
  const plan = buildPptResearchPlan({
    presentationType: '学术报告',
    stage: 'research',
    goal: '比较资料检索、故事线和逐页策划方法',
    scope: {
      searchMode: '大量',
      platforms: ['github', 'web'],
      queries: ['PPT story structure', 'slide research workflow', 'presentation case study', 'visual storytelling', 'evidence mapping']
    }
  });

  const batches = splitResearchBatches(plan, { maxQueriesPerBatch: 2, maxSourcesPerBatch: 3 });

  assert.equal(plan.mode, 'extensive');
  assert.equal(plan.requiresConfirmation, false);
  assert.equal(plan.totalQueryCount, 5);
  assert.equal(plan.totalSourceLimit, 15);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map(batch => batch.queries.length), [2, 2, 1]);
  assert.ok(batches.every(batch => batch.queryLimit === 2 && batch.sourceLimit === 3));
});

test('批次拆分是纯函数，不修改调用方的计划对象', () => {
  const plan = buildPptResearchPlan({ goal: '搜索演示方法', scope: { searchMode: '大量', queries: ['一', '二'] } });
  const before = structuredClone(plan);

  splitResearchBatches(plan, { maxQueriesPerBatch: 1 });

  assert.deepEqual(plan, before);
});

test('批次来源包含必查项和来源队列，并按必查项优先且去重', () => {
  const plan = buildPptResearchPlan({
    goal: '整理演示资料',
    requiredSources: [{ id: 'required-1', title: '指定资料' }],
    localCandidates: [
      { id: 'local-1', title: '本机资料一' },
      { id: 'local-2', title: '本机资料二' }
    ]
  });
  plan.sourceQueue.push({ id: 'queued-1', title: '队列资料', status: 'queued' });

  const batches = splitResearchBatches(plan, { maxSourcesPerBatch: 2 });
  const ids = batches.flatMap(batch => batch.candidates.map(candidate => candidate.id));

  assert.deepEqual(ids, ['required-1', 'local-1', 'local-2', 'queued-1']);
});

test('用户指定来源加入待查清单并具有最高优先级', () => {
  const plan = buildPptResearchPlan({
    presentationType: '路演',
    goal: '准备投资人演示',
    requiredSources: [
      { id: 'repo-1', url: 'https://github.com/example/slides', title: '指定仓库', kind: 'github' },
      { id: 'video-1', url: 'https://example.com/talk', title: '指定演讲', kind: 'video' }
    ],
    scope: { searchMode: '普通' }
  });

  assert.deepEqual(plan.requiredSources.map(source => source.id), ['repo-1', 'video-1']);
  assert.deepEqual(plan.requiredSources.map(source => source.priority), ['required', 'required']);
  assert.equal(plan.sourceQueue[0].id, 'repo-1');
  assert.equal(plan.sourceQueue[1].id, 'video-1');
  assert.ok(plan.sourceQueue.every(source => source.required === true));
});

test('必查来源不可访问时保留 required-but-unavailable，不能被替代来源冒充完成', () => {
  const plan = buildPptResearchPlan({
    goal: '检查指定方法',
    requiredSources: [{ id: 'required-repo', url: 'https://github.com/example/missing', title: '必查仓库' }]
  });
  const next = recordResearchProgress(plan, {
    type: 'source-result',
    sourceId: 'required-repo',
    status: 'unavailable',
    errorCode: 'network-unavailable',
    error: '网络不可用'
  });

  const coverage = summarizeSourceCoverage(next, [{
    sourceId: 'replacement',
    url: 'https://example.com/similar',
    status: 'complete'
  }]);

  assert.equal(next.sources[0].status, 'required-but-unavailable');
  assert.equal(next.sources[0].errorCode, 'network-unavailable');
  assert.equal(coverage.requiredComplete, false);
  assert.deepEqual(coverage.requiredUnavailable.map(source => source.sourceId), ['required-repo']);
  assert.equal(coverage.substitutesAccepted, false);
});

test('研究任务可暂停和取消，暂停后可从当前进度继续', () => {
  const plan = buildPptResearchPlan({ goal: '整理 PPT 方法', scope: { searchMode: '大量' } });
  const paused = recordResearchProgress(plan, { type: 'pause', reason: '用户暂时停止' });
  const resumed = recordResearchProgress(paused, { type: 'resume' });
  const cancelled = recordResearchProgress(paused, { type: 'cancel', reason: '用户取消' });

  assert.equal(paused.status, 'paused');
  assert.equal(paused.pauseReason, '用户暂时停止');
  assert.equal(resumed.status, 'running');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelReason, '用户取消');
  assert.equal(resumed.progress.evaluated, plan.progress.evaluated);
});

test('成功案例、失败案例、项目自述、公开样例和用户确认经验分别标记', () => {
  const inputs = [
    { id: 'success', evidenceType: 'success-case', sourceType: 'user-confirmed-experience' },
    { id: 'failure', evidenceType: 'failure-case', sourceType: 'user-confirmed-experience' },
    { id: 'claim', evidenceType: 'project-self-report', sourceType: 'project-documentation' },
    { id: 'demo', evidenceType: 'public-example', sourceType: 'public-example' },
    { id: 'confirmed', evidenceType: 'user-confirmed-experience', sourceType: 'user-review' }
  ];

  const normalized = inputs.map(input => normalizePptSourceResult(input));

  assert.deepEqual(normalized.map(item => item.evidenceType), inputs.map(item => item.evidenceType));
  assert.deepEqual(normalized.map(item => item.sourceType), inputs.map(item => item.sourceType));
  assert.equal(normalized[0].verificationStatus, 'user-confirmed');
  assert.equal(normalized[1].verificationStatus, 'user-confirmed');
  assert.equal(normalized[2].verificationStatus, 'source-claimed');
  assert.equal(normalized[3].verificationStatus, 'public-example');
  assert.notEqual(normalized[2].verificationStatus, 'verified');
  assert.notEqual(normalized[3].verificationStatus, 'verified');
});

test('来源排序优先任务有用性和必查项，同时保留许可证与限制信息', () => {
  const results = [
    { id: 'sample', title: '公开样例', usefulness: 0.8, quality: 0.7, hasArtifact: true, updatedAt: '2026-01-01', evidenceType: 'public-example', license: 'MIT', limitations: '仅展示结果' },
    { id: 'required', title: '必查来源', required: true, usefulness: 0.2, quality: 0.4, hasArtifact: false, updatedAt: '2020-01-01', evidenceType: 'project-self-report', license: 'unknown', limitations: '无法独立验证' },
    { id: 'confirmed', title: '用户确认经验', usefulness: 0.9, quality: 0.9, hasArtifact: true, updatedAt: '2025-01-01', evidenceType: 'user-confirmed-experience', verificationStatus: 'user-confirmed', license: 'internal', limitations: '适用范围有限' }
  ];
  const ranked = rankPptSources(results, { goal: '寻找可复用的故事线方法' });

  assert.deepEqual(ranked.map(item => item.id), ['required', 'confirmed', 'sample']);
  assert.equal(ranked[0].license, 'unknown');
  assert.equal(ranked[0].limitations, '无法独立验证');
  assert.ok(ranked.every(item => typeof item.rankScore === 'number'));
});

test('来源排序使用有用性、质量、附件、时效、用户确认和任务命中作为排序因子', () => {
  const cases = [
    [{ id: 'useful', usefulness: 0.9 }, { id: 'less-useful', usefulness: 0.1 }],
    [{ id: 'quality', quality: 0.9 }, { id: 'lower-quality', quality: 0.1 }],
    [{ id: 'artifact', hasArtifact: true }, { id: 'no-artifact', hasArtifact: false }],
    [{ id: 'recent', updatedAt: '2026-10-20' }, { id: 'old', updatedAt: '2020-01-01' }],
    [{ id: 'confirmed', verificationStatus: 'user-confirmed' }, { id: 'unconfirmed', verificationStatus: 'unverified' }],
    [{ id: 'task-hit', summary: '适合目标任务' }, { id: 'no-hit', summary: '其他内容' }]
  ];

  for (const [preferred, other] of cases) {
    const ranked = rankPptSources([other, preferred], { goal: '目标任务' });
    assert.equal(ranked[0].id, preferred.id);
  }
});

test('本机候选保持高召回，不因低分丢弃文件，模型复筛前生成整批发送预览', () => {
  const candidates = [
    { id: 'local-1', kind: 'local-file', title: '高相关', excerpt: '故事线方法', relevanceScore: 0.95, selected: true },
    { id: 'local-2', kind: 'local-file', title: '低相关但可能有用', excerpt: '演讲案例', relevanceScore: 0.1, selected: false }
  ];
  const preview = buildSourceSendPreview(candidates, { goal: '找故事线方法' });

  assert.equal(preview.candidates.length, 2);
  assert.deepEqual(preview.candidates.map(item => item.id), ['local-1', 'local-2']);
  assert.equal(preview.stage, 'before-model-review');
  assert.equal(preview.confirmationScope, 'whole-batch');
  assert.ok(preview.text.includes('低相关但可能有用'));
  assert.equal(preview.discardedCount, 0);
});

test('默认模型批次和预览最多包含 3 条来源摘要', () => {
  const candidates = Array.from({ length: 6 }, (_, index) => ({ id: 'local-' + index, title: '资料 ' + index, excerpt: '摘要 ' + index }));
  const batches = splitResearchBatches({ queries: ['query'], candidates });
  const preview = buildSourceSendPreview(candidates, { goal: '研究目标' });

  assert.ok(batches.every(batch => batch.candidates.length <= 3));
  assert.equal(preview.candidates.length, 3);
  assert.equal(preview.discardedCount, 0);
});

test('发送预览包含搜索范围、已评估与未评估计数及当前批次信息', () => {
  const preview = buildSourceSendPreview(
    [{ id: 'source-1', title: '候选资料' }],
    {
      goal: '研究目标',
      scope: { platforms: ['官方文档'], keywords: ['案例'] },
      evaluatedSourceIds: ['source-0'],
      totalSourceCount: 4,
      batch: { id: 'batch-2', index: 1 },
      totalBatches: 3
    }
  );

  assert.deepEqual(preview.searchScope, { platforms: ['官方文档'], keywords: ['案例'] });
  assert.equal(preview.evaluatedCount, 1);
  assert.equal(preview.unevaluatedCount, 3);
  assert.deepEqual(preview.batchInfo, { id: 'batch-2', index: 1, total: 3 });
  assert.match(preview.text, /官方文档/);
  assert.match(preview.text, /已评估：1/);
  assert.match(preview.text, /未评估：3/);
  assert.match(preview.text, /batch-2/);
});

test('预算耗尽后暂停当前批次并可续跑，预览只包含当前模型批次', () => {
  const plan = buildPptResearchPlan({
    goal: '研究 PPT 资料',
    localCandidates: Array.from({ length: 7 }, (_, index) => ({ id: 'source-' + index, title: '资料 ' + index })),
    scope: { searchMode: '大量', queries: ['a', 'b', 'c', 'd'] }
  });
  const batches = splitResearchBatches(plan, { maxQueriesPerBatch: 1, maxSourcesPerBatch: 2 });
  const firstBatch = batches[0];
  const preview = buildSourceSendPreview(firstBatch.candidates, { goal: plan.goal, batch: firstBatch });
  const paused = recordResearchProgress(plan, {
    type: 'budget-exhausted',
    batchId: firstBatch.id,
    evaluated: [firstBatch.candidates[0].id],
    batch: firstBatch
  });
  const rerun = selectSourceRerunScope({ plan: paused, scope: 'remaining' });

  assert.equal(preview.batchId, firstBatch.id);
  assert.ok(preview.candidates.length <= 2);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pauseReason, 'budget-exhausted');
  assert.equal(paused.progress.pausedBatchId, firstBatch.id);
  assert.deepEqual(paused.progress.pausedBatch, firstBatch);
  assert.deepEqual(paused.progress.completedBatches, []);
  assert.deepEqual(rerun.batchIds, batches.map(batch => batch.id));
  assert.deepEqual(rerun.evaluatedSourceIds, [firstBatch.candidates[0].id]);
  assert.deepEqual(rerun.remainingSourceIds, [firstBatch.candidates[1].id, ...batches.slice(1).flatMap(batch => batch.candidates.map(candidate => candidate.id))]);
  assert.equal(new Set(rerun.remainingSourceIds).size, rerun.remainingSourceIds.length);
});

test('当前续跑默认使用预算耗尽时持久化的暂停批次快照', () => {
  const plan = buildPptResearchPlan({
    goal: '研究 PPT 资料',
    localCandidates: Array.from({ length: 6 }, (_, index) => ({ id: 'source-' + index, title: '资料 ' + index })),
    scope: { searchMode: '大量', queries: ['a', 'b', 'c'] }
  });
  const batches = splitResearchBatches(plan, { maxQueriesPerBatch: 1, maxSourcesPerBatch: 2 });
  const paused = recordResearchProgress(plan, {
    type: 'budget-exhausted',
    batchId: batches[1].id,
    evaluated: [batches[1].candidates[0].id],
    batch: batches[1]
  });

  const rerun = selectSourceRerunScope({ plan: paused, scope: 'current' });

  assert.deepEqual(rerun.batchIds, ['batch-2']);
  assert.deepEqual(rerun.remainingSourceIds, [batches[1].candidates[1].id]);
});

test('普通暂停带批次时保存快照，当前续跑只返回该批次剩余来源', () => {
  const plan = buildPptResearchPlan({
    goal: '研究 PPT 资料',
    localCandidates: Array.from({ length: 6 }, (_, index) => ({ id: 'source-' + index, title: '资料 ' + index })),
    scope: { searchMode: '大量', queries: ['a', 'b', 'c'] }
  });
  const batches = splitResearchBatches(plan, { maxQueriesPerBatch: 1, maxSourcesPerBatch: 2 });
  const paused = recordResearchProgress(plan, {
    type: 'pause',
    reason: '用户暂时停止',
    batchId: batches[1].id,
    batch: batches[1]
  });

  const rerun = selectSourceRerunScope({ plan: paused, scope: 'current' });

  assert.equal(paused.progress.pausedBatchId, batches[1].id);
  assert.deepEqual(paused.progress.pausedBatch, batches[1]);
  assert.deepEqual(rerun.batchIds, [batches[1].id]);
  assert.deepEqual(rerun.remainingSourceIds, batches[1].candidates.map(candidate => candidate.id));
});

test('当前续跑传入原始批次时只筛选指定批次，不因重新切批串入其它来源', () => {
  const plan = buildPptResearchPlan({
    goal: '研究 PPT 资料',
    localCandidates: Array.from({ length: 6 }, (_, index) => ({ id: 'source-' + index, title: '资料 ' + index })),
    scope: { searchMode: '大量', queries: ['a', 'b', 'c'] }
  });
  const batches = splitResearchBatches(plan, { maxQueriesPerBatch: 1, maxSourcesPerBatch: 2 });
  const rerun = selectSourceRerunScope({
    plan,
    scope: 'current',
    currentBatchId: 'batch-2',
    batches
  });

  assert.deepEqual(rerun.batchIds, ['batch-2']);
  assert.deepEqual(rerun.remainingSourceIds, batches[1].candidates.map(candidate => candidate.id));
});

test('缺少暂停快照时 currentBatchId fallback 只返回指定批次', () => {
  const plan = buildPptResearchPlan({
    goal: '研究 PPT 资料',
    localCandidates: Array.from({ length: 6 }, (_, index) => ({ id: 'source-' + index, title: '资料 ' + index })),
    scope: { searchMode: '大量', queries: ['a', 'b', 'c'] }
  });

  const rerun = selectSourceRerunScope({ plan, scope: 'current', currentBatchId: 'batch-2' });

  assert.deepEqual(rerun.batchIds, ['batch-2']);
});

test('currentBatchId fallback 使用计划来源批次上限保持原批次边界', () => {
  const plan = buildPptResearchPlan({
    goal: '研究 PPT 资料',
    localCandidates: Array.from({ length: 6 }, (_, index) => ({ id: 'source-' + index, title: '资料 ' + index })),
    scope: { searchMode: '大量', queries: ['a', 'b', 'c'] }
  });
  plan.batchLimits = { maxQueriesPerBatch: 1, maxSourcesPerBatch: 2 };

  const rerun = selectSourceRerunScope({ plan, scope: 'current', currentBatchId: 'batch-2' });

  assert.deepEqual(rerun.batchIds, ['batch-2']);
  assert.deepEqual(rerun.remainingSourceIds, ['source-2', 'source-3']);
});

test('必查来源不可用后计入已处理，续跑只保留其它未评估来源', () => {
  const plan = buildPptResearchPlan({
    goal: '研究指定 PPT 资料',
    requiredSources: [{ id: 'required-unavailable', title: '必查但不可访问的资料' }],
    localCandidates: [{ id: 'candidate-pending', title: '仍待评估的候选资料' }]
  });
  const batches = splitResearchBatches(plan, { maxSourcesPerBatch: 1 });
  const unavailable = recordResearchProgress(plan, {
    type: 'source-result',
    sourceId: 'required-unavailable',
    status: 'unavailable',
    errorCode: 'network-unavailable',
    error: '网络不可用'
  });
  const paused = recordResearchProgress(unavailable, {
    type: 'budget-exhausted',
    batchId: batches[0].id
  });
  const rerun = selectSourceRerunScope({ plan: paused, scope: 'remaining' });
  const coverage = summarizeSourceCoverage(paused);

  assert.deepEqual(coverage.requiredUnavailable.map(source => source.sourceId), ['required-unavailable']);
  assert.deepEqual(rerun.evaluatedSourceIds, ['required-unavailable']);
  assert.equal(paused.progress.evaluated, 1);
  assert.deepEqual(rerun.remainingSourceIds, ['candidate-pending']);
  assert.equal(rerun.remainingSourceIds.includes('required-unavailable'), false);
  assert.equal(unavailable.sources[0].errorCode, 'network-unavailable');
  assert.equal(unavailable.sources[0].error, '网络不可用');
});

test('本机候选与页面材料分类保留用户角色和模型建议，未确认不升级为事实', () => {
  const material = classifyPptMaterial(
    { sourceId: 'local-1', purpose: 'style', title: '参考稿' },
    { role: 'both', reason: '同时含有布局与内容信息' }
  );
  const pages = classifyPptPages(
    { sourceId: 'local-1', pages: [{ page: 1, excerpt: '结论' }, { page: 2, excerpt: '不确定' }] },
    { pages: [{ page: 1, disposition: 'include', reason: '与目标相关' }, { page: 2, disposition: 'uncertain', reason: '片段不足' }] }
  );

  assert.equal(material.role, 'style');
  assert.equal(material.modelSuggestion.role, 'both');
  assert.equal(material.verificationStatus, 'needs-verification');
  assert.equal(pages.pages[0].disposition, 'include');
  assert.equal(pages.pages[1].disposition, 'uncertain');
  assert.equal(pages.pages[1].recoverable, true);
});
