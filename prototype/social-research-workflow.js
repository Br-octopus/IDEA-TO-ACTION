(function (root, factory) {
  const schema = typeof module === 'object' && module.exports
    ? require('./social-research-schema.js')
    : root.ForwardStepSocialResearchSchema;
  const api = factory(schema);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepSocialResearchWorkflow = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (schema) {
  const EMPTY_USAGE = () => ({
    platforms: 0,
    queriesByPlatform: {},
    pages: 0,
    details: 0,
    durationMs: 0,
    attachmentBytes: 0,
    analysisTokens: 0
  });

  function budgetError(message) {
    const error = new RangeError(`budget_exceeded: ${message}`);
    error.code = 'budget_exceeded';
    return error;
  }

  function assertActive(task) {
    if (!task || task.status === 'cancelled' || task.status === 'saved' || task.status === 'partial-failure') {
      throw new Error('任务已取消或终止，不能继续推进');
    }
  }

  function assertApproved(task) {
    assertActive(task);
    if (task.status === 'awaiting-plan-confirmation' || task.status === 'draft') {
      throw new Error('研究计划尚未确认');
    }
  }

  function createResearchPlan(input = {}, capabilities = []) {
    const source = input && typeof input === 'object' ? input : {};
    const platforms = [...new Set((Array.isArray(source.platforms) ? source.platforms : [])
      .map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
    const queries = [...new Set((Array.isArray(source.queries) ? source.queries : [source.topic])
      .map(value => String(value || '').trim()).filter(Boolean))];
    const normalizedBudget = schema.normalizeResearchPlan({ budget: source.budget }).budget;
    if (platforms.length > normalizedBudget.maxPlatforms) throw budgetError('平台数超出预算');
    if (queries.length > normalizedBudget.maxQueriesPerPlatform) throw budgetError('每平台查询数超出预算');
    const base = schema.createResearchTask({
      id: source.id,
      topic: source.topic,
      template: source.template,
      platforms,
      queries,
      connectionModes: source.connectionModes,
      budget: source.budget,
      status: 'awaiting-plan-confirmation',
      plan: {
        objective: source.topic,
        researchType: source.template,
        platformRoles: platforms.map(platform => ({ platform, role: '收集相关讨论与体验证据', queries })),
        queries,
        timeRange: source.timeRange,
        region: source.region,
        audience: source.audience,
        filters: source.filters,
        expectedResultCount: source.expectedResultCount,
        evidenceRequirements: source.evidenceRequirements || ['保留原始结果链接', '区分事实、观点与推断'],
        budget: source.budget,
        stopConditions: source.stopConditions || ['达到任一预算上限', '用户取消任务']
      }
    });
    const normalizedCapabilities = Array.isArray(capabilities)
      ? capabilities.map(item => schema.normalizePlatformCapability(item))
      : Object.entries(capabilities || {}).map(([platform, value]) => schema.normalizePlatformCapability({ ...value, platform }));
    return {
      ...base,
      capabilities: normalizedCapabilities,
      usage: EMPTY_USAGE()
    };
  }

  function approveResearchPlan(task) {
    assertActive(task);
    if (task.status !== 'awaiting-plan-confirmation') throw new Error('当前任务不在等待计划确认状态');
    return { ...task, status: 'awaiting-platform-preparation' };
  }

  function rejectResearchPlan(task, reason = '') {
    assertActive(task);
    if (task.status !== 'awaiting-plan-confirmation') throw new Error('当前任务不在等待计划确认状态');
    return { ...task, status: 'cancelled', rejectionReason: String(reason || '').trim() };
  }

  function transitionResearchTask(task, event = {}) {
    assertActive(task);
    const type = typeof event === 'string' ? event : event.type;
    const transitions = {
      start: ['awaiting-platform-preparation', 'searching'],
      prepared: ['awaiting-platform-preparation', 'searching'],
      finish: ['searching', 'report-ready'],
      request_refinement: ['report-ready', 'awaiting-refinement-confirmation'],
      confirm_refinement: ['awaiting-refinement-confirmation', 'searching'],
      report_ready: ['searching', 'report-ready'],
      request_save: ['report-ready', 'awaiting-save'],
      save: ['awaiting-save', 'saved'],
      partial_failure: ['searching', 'partial-failure'],
      cancel: [task.status, 'cancelled']
    };
    const transition = transitions[type];
    if (!transition || task.status !== transition[0]) throw new Error(`不允许的研究任务状态迁移: ${task.status} -> ${type}`);
    if (type === 'start' || type === 'confirm_refinement') assertApproved(task);
    return { ...task, status: transition[1] };
  }

  function consumeResearchBudget(task, usage = {}) {
    assertApproved(task);
    const budget = task.budget || {};
    const current = task.usage || EMPTY_USAGE();
    const platform = String(usage.platform || '').trim().toLowerCase();
    const queryCount = Number(usage.queries || 0);
    const nextUsage = {
      platforms: Math.max(Number(current.platforms || 0), Number(usage.platforms || 0),
        platform && !(current.queriesByPlatform || {})[platform] ? Number(current.platforms || 0) + 1 : 0),
      queriesByPlatform: { ...(current.queriesByPlatform || {}) },
      pages: Number(current.pages || 0) + Number(usage.pages || 0),
      details: Number(current.details || 0) + Number(usage.details || 0),
      durationMs: Number(current.durationMs || 0) + Number(usage.durationMs || 0),
      attachmentBytes: Number(current.attachmentBytes || 0) + Number(usage.attachmentBytes || 0),
      analysisTokens: Number(current.analysisTokens || 0) + Number(usage.analysisTokens || 0)
    };
    if (platform && queryCount) nextUsage.queriesByPlatform[platform] = Number(nextUsage.queriesByPlatform[platform] || 0) + queryCount;
    const checks = [
      [nextUsage.platforms, budget.maxPlatforms, '平台数'],
      [platform ? nextUsage.queriesByPlatform[platform] || 0 : Number(usage.queriesPerPlatform || 0), budget.maxQueriesPerPlatform, '每平台查询数'],
      [nextUsage.pages, budget.maxPages, '翻页数'],
      [nextUsage.details, budget.maxDetails, '详情数'],
      [nextUsage.durationMs, budget.maxDurationMs, '执行时间'],
      [nextUsage.attachmentBytes, budget.maxAttachmentBytes, '附件大小'],
      [nextUsage.analysisTokens, budget.maxAnalysisTokens, '模型分析 token 数']
    ];
    for (const [actual, limit, label] of checks) {
      if (Number.isFinite(Number(actual)) && Number(actual) > Number(limit)) throw budgetError(`${label}超出预算`);
    }
    return { ...task, usage: nextUsage };
  }

  function decideConnectionMode(platform, connection = {}, preference = 'auto') {
    const choice = ['api', 'browser', 'auto'].includes(preference) ? preference : 'auto';
    if (choice === 'browser') return 'browser';
    const unavailableStatuses = new Set(['not-ready', 'needs-recheck', 'checking', 'failed', 'expired', 'restricted']);
    const apiAvailable = connection.apiAvailable === true && !unavailableStatuses.has(connection.status);
    if (choice === 'api') {
      if (!apiAvailable) {
        const error = new Error(`API unavailable: ${platform} 的 API 不可用或尚未准备`);
        error.code = 'api_unavailable';
        throw error;
      }
      return 'api';
    }
    return apiAvailable ? 'api' : 'browser';
  }

  function shouldFallbackToBrowser(apiResult = {}, capability = {}) {
    if (capability.preference && capability.preference !== 'auto') return false;
    if (apiResult.ok === false || apiResult.error) return true;
    const results = Array.isArray(apiResult) ? apiResult : Array.isArray(apiResult.results) ? apiResult.results : [];
    if (!results.length) return true;
    const minimum = Number(capability.minimumResults ?? capability.minResults ?? 1);
    if (results.length < minimum) return true;
    const fields = capability.requiredFields || capability.requiredResultFields || [];
    return results.some(result => fields.some(field => result[field] === undefined || result[field] === null || result[field] === ''));
  }

  function canRequestSupplementarySearch(task, request = {}) {
    try {
      assertApproved(task);
      const additionalPlatforms = request.platforms || (request.platform ? [request.platform] : []);
      const currentPlatforms = new Set(task.platforms || []);
      if (additionalPlatforms.some(platform => !currentPlatforms.has(String(platform).toLowerCase()))) {
        return { allowed: false, reason: '补搜不能增加未批准的平台' };
      }
      consumeResearchBudget(task, request);
      return { allowed: true, reason: '' };
    } catch (error) {
      return { allowed: false, reason: error.code === 'budget_exceeded' ? error.code : error.message };
    }
  }

  return {
    createResearchPlan,
    approveResearchPlan,
    rejectResearchPlan,
    transitionResearchTask,
    startResearchTask: task => {
      assertApproved(task);
      if (task.status !== 'awaiting-platform-preparation') throw new Error('任务尚未完成平台准备');
      return { ...task, status: 'searching' };
    },
    consumeResearchBudget,
    decideConnectionMode,
    shouldFallbackToBrowser,
    canRequestSupplementarySearch
  };
});
