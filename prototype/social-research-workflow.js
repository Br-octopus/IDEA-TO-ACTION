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
    usedPlatforms: [],
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
    if (!task || task.status === 'cancelled' || task.status === 'saved' || task.status === 'partial-failure' || task.status === 'failed') {
      throw new Error('任务已取消或终止，不能继续推进');
    }
  }

  function assertApproved(task) {
    assertActive(task);
    if (task.status === 'awaiting-plan-confirmation' || task.status === 'draft') {
      throw new Error('研究计划尚未确认');
    }
  }

  function normalizePlatformList(values) {
    return [...new Set(values.map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
  }

  function assertAtLeastOnePlatformReady(task, readyPlatforms) {
    const planned = normalizePlatformList(task.platforms || []);
    const ready = normalizePlatformList(readyPlatforms || []);
    assertPreparedPlatformsBelongToPlan(planned, ready);
    if (!ready.length) throw new Error('至少需要一个已准备的平台');
    return ready;
  }

  function assertPreparedPlatformsBelongToPlan(plannedPlatforms, readyPlatforms) {
    if (readyPlatforms.some(platform => !plannedPlatforms.includes(platform))) {
      throw new Error('准备的平台不在已批准计划中');
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
    const details = typeof event === 'object' && event ? event : {};
    if (type === 'preparation_failed') {
      if (task.status !== 'awaiting-platform-preparation') {
        throw new Error(`不允许的研究任务状态迁移: ${task.status} -> ${type}`);
      }
      if ((task.preparedPlatforms || []).length) throw new Error('已有可用平台时不能标记准备失败');
      return { ...task, status: 'failed' };
    }
    if (type === 'prepared') {
      if (task.status !== 'awaiting-platform-preparation') {
        throw new Error(`不允许的研究任务状态迁移: ${task.status} -> ${type}`);
      }
      const newlyReady = details.platforms || details.readyPlatforms || (details.platform ? [details.platform] : []);
      if (!Array.isArray(newlyReady) || newlyReady.length === 0) throw new Error('prepared 事件必须提供已准备的平台');
      const preparedPlatforms = normalizePlatformList([...(task.preparedPlatforms || []), ...newlyReady]);
      assertPreparedPlatformsBelongToPlan(normalizePlatformList(task.platforms || []), preparedPlatforms);
      return { ...task, preparedPlatforms };
    }
    if (type === 'start') {
      if (task.status !== 'awaiting-platform-preparation') {
        throw new Error(`不允许的研究任务状态迁移: ${task.status} -> ${type}`);
      }
      assertApproved(task);
      assertAtLeastOnePlatformReady(task, task.preparedPlatforms || []);
      return { ...task, status: 'searching' };
    }
    if (type === 'cancel') {
      const cancellableStatuses = new Set([
        'awaiting-plan-confirmation', 'awaiting-platform-preparation', 'searching',
        'report-ready', 'awaiting-refinement-confirmation', 'awaiting-save'
      ]);
      if (!cancellableStatuses.has(task.status)) throw new Error(`不允许的研究任务状态迁移: ${task.status} -> ${type}`);
      return { ...task, status: 'cancelled' };
    }
    const transitions = {
      finish: ['searching', 'report-ready'],
      request_refinement: ['report-ready', 'awaiting-refinement-confirmation'],
      confirm_refinement: ['awaiting-refinement-confirmation', 'searching'],
      report_ready: ['searching', 'report-ready'],
      request_save: ['report-ready', 'awaiting-save'],
      save: ['awaiting-save', 'saved'],
      partial_failure: ['searching', 'partial-failure']
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
    const integerMetrics = new Set(['platforms', 'queries', 'queriesPerPlatform', 'pages', 'details', 'attachmentBytes', 'analysisTokens']);
    const metricFields = [...integerMetrics, 'durationMs'];
    for (const field of metricFields) {
      if (!Object.prototype.hasOwnProperty.call(usage, field)) continue;
      const value = usage[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integerMetrics.has(field) && !Number.isInteger(value))) {
        throw new TypeError(`${field} 必须是有限的非负${integerMetrics.has(field) ? '整数' : '数值'}`);
      }
    }
    if (usage.queries !== undefined && usage.queriesPerPlatform !== undefined && usage.queries !== usage.queriesPerPlatform) {
      throw new TypeError('queries 与 queriesPerPlatform 必须一致');
    }
    const queryMap = usage.queriesByPlatform ?? {};
    if (!queryMap || typeof queryMap !== 'object' || Array.isArray(queryMap)) {
      throw new TypeError('queriesByPlatform 必须是平台到查询数量的对象');
    }
    for (const [name, count] of Object.entries(queryMap)) {
      if (!name.trim() || typeof count !== 'number' || !Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
        throw new TypeError('queriesByPlatform 的平台和查询数量无效');
      }
    }
    const platform = String(usage.platform || '').trim().toLowerCase();
    const queryCount = usage.queries ?? usage.queriesPerPlatform ?? 0;
    const queryMapEntries = Object.entries(queryMap).map(([name, count]) => [name.trim().toLowerCase(), count]);
    if (queryCount > 0 && !platform) {
      throw new TypeError('非零 queries 或 queriesPerPlatform 必须指定 platform；多平台查询请使用 queriesByPlatform');
    }
    if (usage.usedPlatforms !== undefined && !Array.isArray(usage.usedPlatforms)) {
      throw new TypeError('usedPlatforms 必须是平台数组');
    }
    const usedPlatforms = normalizePlatformList([
      ...(current.usedPlatforms || Object.keys(current.queriesByPlatform || {})),
      ...(usage.usedPlatforms || []),
      ...(platform ? [platform] : []),
      ...queryMapEntries.map(([name]) => name)
    ]);
    const nextUsage = {
      platforms: Math.max(Number(current.platforms || 0), usage.platforms || 0, usedPlatforms.length),
      usedPlatforms,
      queriesByPlatform: { ...(current.queriesByPlatform || {}) },
      pages: Number(current.pages || 0) + Number(usage.pages || 0),
      details: Number(current.details || 0) + Number(usage.details || 0),
      durationMs: Number(current.durationMs || 0) + Number(usage.durationMs || 0),
      attachmentBytes: Number(current.attachmentBytes || 0) + Number(usage.attachmentBytes || 0),
      analysisTokens: Number(current.analysisTokens || 0) + Number(usage.analysisTokens || 0)
    };
    if (platform && queryCount) nextUsage.queriesByPlatform[platform] = Number(nextUsage.queriesByPlatform[platform] || 0) + queryCount;
    for (const [name, count] of queryMapEntries) {
      if (count) nextUsage.queriesByPlatform[name] = Number(nextUsage.queriesByPlatform[name] || 0) + count;
    }
    const checks = [
      [nextUsage.platforms, budget.maxPlatforms, '平台数'],
      [nextUsage.pages, budget.maxPages, '翻页数'],
      [nextUsage.details, budget.maxDetails, '详情数'],
      [nextUsage.durationMs, budget.maxDurationMs, '执行时间'],
      [nextUsage.attachmentBytes, budget.maxAttachmentBytes, '附件大小'],
      [nextUsage.analysisTokens, budget.maxAnalysisTokens, '模型分析 token 数']
    ];
    for (const [actual, limit, label] of checks) {
      if (Number.isFinite(Number(actual)) && Number(actual) > Number(limit)) throw budgetError(`${label}超出预算`);
    }
    for (const [name, count] of Object.entries(nextUsage.queriesByPlatform)) {
      if (count > Number(budget.maxQueriesPerPlatform)) throw budgetError(`平台 ${name} 的查询数超出预算`);
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
      assertActive(task);
      if (task.status !== 'searching') return { allowed: false, reason: '补搜仅允许在 searching 状态申请' };
      const hasPlatformArray = Object.prototype.hasOwnProperty.call(request, 'platforms');
      if (hasPlatformArray && !Array.isArray(request.platforms)) throw new TypeError('platforms 必须是平台数组');
      const requestedPlatforms = normalizePlatformList(hasPlatformArray
        ? request.platforms
        : request.platform ? [request.platform] : Object.keys(request.queriesByPlatform || {}));
      const approvedPlatforms = new Set(normalizePlatformList(task.platforms || []));
      if (requestedPlatforms.some(platform => !approvedPlatforms.has(platform))) {
        return { allowed: false, reason: '补搜不能增加未批准的平台' };
      }
      if (request.platform && (requestedPlatforms.length !== 1 || String(request.platform).trim().toLowerCase() !== requestedPlatforms[0])) {
        throw new TypeError('platform 必须与单平台请求一致');
      }
      const queryMap = request.queriesByPlatform;
      if (queryMap !== undefined && (!queryMap || typeof queryMap !== 'object' || Array.isArray(queryMap))) {
        throw new TypeError('queriesByPlatform 必须是平台到查询数量的对象');
      }
      const normalizedQueryMap = queryMap && Object.entries(queryMap).reduce((result, [name, count]) => {
        const normalizedName = String(name).trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(result, normalizedName)) throw new TypeError('queriesByPlatform 存在重复平台');
        result[normalizedName] = count;
        return result;
      }, {});
      if (requestedPlatforms.length > 1) {
        if (!normalizedQueryMap || requestedPlatforms.some(platform => !Object.prototype.hasOwnProperty.call(normalizedQueryMap, platform)) ||
          Object.keys(normalizedQueryMap).some(platform => !requestedPlatforms.includes(platform))) {
          throw new TypeError('多平台补搜必须为每个平台提供 queriesByPlatform');
        }
      } else if (normalizedQueryMap && Object.keys(normalizedQueryMap).some(platform => !requestedPlatforms.includes(platform))) {
        throw new TypeError('queriesByPlatform 包含未请求的平台');
      }
      const { platforms: ignoredPlatforms, ...requestedUsage } = request;
      const normalizedUsage = {
        ...requestedUsage,
        usedPlatforms: requestedPlatforms,
        ...(requestedPlatforms.length === 1 ? { platform: requestedPlatforms[0] } : {}),
        ...(normalizedQueryMap ? { queriesByPlatform: normalizedQueryMap } : {})
      };
      const updated = consumeResearchBudget(task, normalizedUsage);
      return { allowed: true, reason: '', usage: normalizedUsage, task: updated };
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
      assertAtLeastOnePlatformReady(task, task.preparedPlatforms || []);
      return { ...task, status: 'searching' };
    },
    consumeResearchBudget,
    decideConnectionMode,
    shouldFallbackToBrowser,
    canRequestSupplementarySearch
  };
});
