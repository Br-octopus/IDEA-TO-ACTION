(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepSocialResearchWorkflow = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const DEFAULT_BUDGET = Object.freeze({
    maxPlatforms: 3,
    maxQueriesPerPlatform: 5,
    maxPages: 3,
    maxDetails: 20,
    maxDurationMs: 300000,
    maxAttachmentBytes: 25 * 1024 * 1024,
    maxAnalysisTokens: 10000
  });
  const ALLOWED_STATUSES = new Set([
    "awaiting_confirmation", "preparing_platforms", "searching", "paused",
    "awaiting_supplementary_confirmation", "partial_failure", "report_ready",
    "awaiting_save", "saved", "cancelled", "budget_exceeded"
  ]);
  const TERMINAL_STATUSES = new Set(["cancelled", "saved"]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function list(value) {
    const values = Array.isArray(value)
      ? value
      : typeof value === "string" ? value.split(/[\r\n,，]/) : [];
    return [...new Set(values.map(item => text(item)).filter(Boolean))];
  }

  function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  }

  function nonNegativeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(value) {
    if (text(value)) return text(value);
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `research-task-${crypto.randomUUID()}`;
      }
    } catch {
      // 随机源不可用时仍保证任务具有稳定格式的本地 id。
    }
    return `research-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeBudget(input) {
    const source = isObject(input) ? input : {};
    return {
      maxPlatforms: positiveInteger(source.maxPlatforms, DEFAULT_BUDGET.maxPlatforms),
      maxQueriesPerPlatform: positiveInteger(source.maxQueriesPerPlatform, DEFAULT_BUDGET.maxQueriesPerPlatform),
      maxPages: positiveInteger(source.maxPages, DEFAULT_BUDGET.maxPages),
      maxDetails: positiveInteger(source.maxDetails, DEFAULT_BUDGET.maxDetails),
      maxDurationMs: positiveInteger(source.maxDurationMs ?? source.maxTimeMs, DEFAULT_BUDGET.maxDurationMs),
      maxAttachmentBytes: positiveInteger(source.maxAttachmentBytes, DEFAULT_BUDGET.maxAttachmentBytes),
      maxAnalysisTokens: positiveInteger(source.maxAnalysisTokens, DEFAULT_BUDGET.maxAnalysisTokens)
    };
  }

  function normalizeTemplate(value) {
    const normalized = text(value).toLowerCase().replace(/_/g, "-");
    if (normalized === "trend") return "trends";
    if (normalized === "pain-point") return "pain-points";
    if (["competitors", "content-competitor", "content-competitors"].includes(normalized)) {
      return "content-competitors";
    }
    if (normalized === "factcheck" || normalized === "fact-checking") return "fact-check";
    return normalized || "pain-points";
  }

  function normalizePlatform(value) {
    return text(value).toLowerCase();
  }

  function normalizePlatforms(value) {
    return list(value).map(normalizePlatform).filter(Boolean);
  }

  function normalizeTimeRange(value) {
    const source = isObject(value) ? value : {};
    return {
      from: text(source.from ?? source.start),
      to: text(source.to ?? source.end),
      timezone: text(source.timezone)
    };
  }

  function normalizeQueriesByPlatform(value) {
    if (!isObject(value)) return {};
    return Object.entries(value).reduce((result, [platform, queries]) => {
      const count = Array.isArray(queries) ? queries.length : nonNegativeNumber(queries);
      if (count > 0) result[normalizePlatform(platform)] = count;
      return result;
    }, {});
  }

  function emptyBudgetUsage() {
    return {
      platforms: 0,
      queriesByPlatform: {},
      pages: 0,
      details: 0,
      durationMs: 0,
      attachmentBytes: 0,
      analysisTokens: 0
    };
  }

  function normalizeBudgetUsage(value) {
    const source = isObject(value) ? value : {};
    return {
      platforms: nonNegativeNumber(source.platforms),
      queriesByPlatform: normalizeQueriesByPlatform(source.queriesByPlatform || source.queries),
      pages: nonNegativeNumber(source.pages),
      details: nonNegativeNumber(source.details),
      durationMs: nonNegativeNumber(source.durationMs),
      attachmentBytes: nonNegativeNumber(source.attachmentBytes),
      analysisTokens: nonNegativeNumber(source.analysisTokens)
    };
  }

  function normalizeCapabilities(capabilities) {
    if (!isObject(capabilities)) return {};
    const entries = Array.isArray(capabilities)
      ? capabilities.map(item => [item?.platform, item])
      : Object.entries(capabilities);
    return entries.reduce((result, [platform, capability]) => {
      const key = normalizePlatform(platform || capability?.platform);
      if (!key || !isObject(capability)) return result;
      result[key] = {
        platform: key,
        apiAvailable: capability.apiAvailable === true || capability.supportsApi === true,
        apiConfigured: capability.apiConfigured === false
          ? false
          : capability.apiConfigured === true ? true : undefined,
        browserAvailable: capability.browserAvailable !== false,
        supportsSearch: capability.supportsSearch !== false,
        minimumResults: positiveInteger(capability.minimumResults ?? capability.minResults, 0),
        requiredFields: list(capability.requiredFields || capability.fields)
      };
      return result;
    }, {});
  }

  function getPlanPlatforms(source) {
    return normalizePlatforms(source.platforms || source.plan?.platforms);
  }

  function getRequestedQueries(source) {
    return normalizeQueriesByPlatform(source.queriesByPlatform || source.queryBudget || source.queries);
  }

  function inspectPlanBudget(platforms, queriesByPlatform, budget) {
    const exceeded = [];
    if (platforms.length > budget.maxPlatforms) exceeded.push("platforms");
    for (const [platform, count] of Object.entries(queriesByPlatform)) {
      if (count > budget.maxQueriesPerPlatform) exceeded.push(`queries:${platform}`);
    }
    return exceeded;
  }

  function createResearchPlan(input = {}, capabilities = {}) {
    const source = isObject(input) ? input : {};
    const budget = normalizeBudget(source.budget);
    const platforms = getPlanPlatforms(source);
    const queriesByPlatform = getRequestedQueries(source);
    const createdAt = nowIso();
    const budgetExceeded = inspectPlanBudget(platforms, queriesByPlatform, budget);
    const task = {
      id: makeId(source.id),
      topic: text(source.topic || source.objective || source.goal),
      template: normalizeTemplate(source.template || source.researchType),
      platforms,
      queries: list(source.queries),
      queriesByPlatform,
      timeRange: normalizeTimeRange(source.timeRange),
      region: text(source.region),
      audience: text(source.audience),
      budget,
      budgetUsage: emptyBudgetUsage(),
      approved: false,
      status: budgetExceeded.length ? "budget_exceeded" : "awaiting_confirmation",
      budgetCode: budgetExceeded.length ? "budget_exceeded" : "ok",
      budgetExceeded,
      capabilities: normalizeCapabilities(capabilities),
      connectionModes: {},
      results: [],
      resultIds: [],
      incompletePlatforms: platforms.slice(),
      createdAt,
      updatedAt: createdAt
    };
    return task;
  }

  function cloneTask(task) {
    if (!isObject(task)) throw new TypeError("研究任务必须是对象");
    return {
      ...task,
      platforms: normalizePlatforms(task.platforms),
      queries: list(task.queries),
      queriesByPlatform: normalizeQueriesByPlatform(task.queriesByPlatform),
      budget: normalizeBudget(task.budget),
      budgetUsage: normalizeBudgetUsage(task.budgetUsage || task.usage),
      connectionModes: isObject(task.connectionModes) ? { ...task.connectionModes } : {},
      results: Array.isArray(task.results) ? task.results.slice() : [],
      resultIds: list(task.resultIds),
      incompletePlatforms: normalizePlatforms(task.incompletePlatforms),
      capabilities: normalizeCapabilities(task.capabilities)
    };
  }

  function workflowError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function assertNotCancelled(task) {
    if (task.status === "cancelled") throw workflowError("TASK_CANCELLED", "研究任务已取消，不能继续推进");
    if (task.status === "saved") throw workflowError("TASK_COMPLETED", "研究任务已保存，不能继续推进");
  }

  function assertApproved(task) {
    assertNotCancelled(task);
    if (task.approved !== true) {
      throw workflowError("PLAN_NOT_CONFIRMED", "研究计划尚未确认，确认后才能开始搜索");
    }
  }

  function approveResearchPlan(task) {
    const next = cloneTask(task);
    assertNotCancelled(next);
    if (next.status === "budget_exceeded" || next.budgetCode === "budget_exceeded") {
      throw workflowError("BUDGET_EXCEEDED", "研究计划已超出预算，不能批准");
    }
    if (next.status !== "awaiting_confirmation") {
      throw workflowError("INVALID_TRANSITION", "当前状态不能批准研究计划");
    }
    next.approved = true;
    next.status = "preparing_platforms";
    next.approvedAt = nowIso();
    next.updatedAt = nowIso();
    return next;
  }

  function rejectResearchPlan(task, reason = "用户取消") {
    const next = cloneTask(task);
    assertNotCancelled(next);
    if (TERMINAL_STATUSES.has(next.status)) {
      throw workflowError("INVALID_TRANSITION", "当前状态不能取消");
    }
    next.status = "cancelled";
    next.approved = false;
    next.rejectionReason = text(reason) || "用户取消";
    next.updatedAt = nowIso();
    return next;
  }

  function startResearchTask(task) {
    const next = cloneTask(task);
    assertApproved(next);
    if (next.status === "awaiting_supplementary_confirmation") {
      throw workflowError("SUPPLEMENTARY_CONFIRMATION_REQUIRED", "补搜尚未确认，不能直接开始搜索");
    }
    if (!["preparing_platforms", "paused"].includes(next.status)) {
      throw workflowError("INVALID_TRANSITION", "当前状态不能开始搜索");
    }
    next.status = "searching";
    next.updatedAt = nowIso();
    return next;
  }

  function supplementaryRequestSource(request = {}) {
    const source = isObject(request) ? request : {};
    const nestedUsage = isObject(source.usage)
      ? source.usage
      : isObject(source.budgetImpact) ? source.budgetImpact : {};
    const merged = { ...source, ...nestedUsage };
    const requestedPlatforms = normalizePlatforms(merged.platforms || (merged.platform ? [merged.platform] : []));
    if (Number(merged.queries) > 0 && !merged.platform && !merged.queriesByPlatform && requestedPlatforms.length === 1) {
      merged.platform = requestedPlatforms[0];
    }
    return merged;
  }

  function validateSupplementaryRequest(task, request = {}) {
    const source = supplementaryRequestSource(request);
    const requestedPlatforms = normalizePlatforms(source.platforms || (source.platform ? [source.platform] : []));
    const queryUsage = normalizeQueriesByPlatform(source.queriesByPlatform || source.queries);
    const queryPlatforms = Object.keys(queryUsage).filter(platform => platform !== "__all__");
    const allRequestedPlatforms = [...new Set([...requestedPlatforms, ...queryPlatforms])];
    const timeRange = normalizeTimeRange(source.timeRange);
    const currentTimeRange = normalizeTimeRange(task.timeRange);
    const delta = usageToDelta(source);

    if (!allRequestedPlatforms.length || allRequestedPlatforms.some(platform => !task.platforms.includes(platform))) {
      return { ok: false, code: "SUPPLEMENTARY_REQUEST_INVALID", message: "补搜平台必须来自已批准的平台" };
    }
    // 补搜只能复用主任务已批准的平台；平台预算只为新增平台保留，不能重复扣除。
    delta.platforms = 0;
    if ((timeRange.from || timeRange.to || timeRange.timezone)
      && JSON.stringify(timeRange) !== JSON.stringify(currentTimeRange)) {
      return { ok: false, code: "SUPPLEMENTARY_REQUEST_INVALID", message: "补搜时间范围不能超出已批准范围" };
    }
    if (delta.queriesByPlatform.__all__ > 0) {
      return { ok: false, code: "SUPPLEMENTARY_REQUEST_INVALID", message: "补搜查询必须明确目标平台" };
    }
    const hasUsage = delta.platforms > 0
      || Object.values(delta.queriesByPlatform).some(count => count > 0)
      || delta.pages > 0
      || delta.details > 0
      || delta.durationMs > 0
      || delta.attachmentBytes > 0
      || delta.analysisTokens > 0;
    if (!hasUsage) {
      return { ok: false, code: "SUPPLEMENTARY_REQUEST_INVALID", message: "补搜请求必须包含预算消耗" };
    }
    return { ok: true, source, delta };
  }

  function approveSupplementarySearch(task, request = {}) {
    const current = cloneTask(task);
    assertApproved(current);
    if (current.status !== "awaiting_supplementary_confirmation") {
      throw workflowError("INVALID_TRANSITION", "当前状态不能批准补搜");
    }
    const validation = validateSupplementaryRequest(current, request);
    if (!validation.ok) throw workflowError(validation.code, validation.message);

    const nextUsage = addUsage(current.budgetUsage, validation.delta);
    const exceeded = findBudgetViolations(nextUsage, current.budget);
    if (exceeded.length) return budgetResult(current, "budget_exceeded", nextUsage, exceeded);

    const next = {
      ...current,
      budgetUsage: nextUsage,
      supplementaryRequest: validation.source,
      supplementaryApprovedAt: nowIso(),
      status: "searching",
      updatedAt: nowIso()
    };
    return budgetResult(next, "ok", nextUsage, []);
  }

  function transitionResearchTask(task, event) {
    const next = cloneTask(task);
    const eventName = text(isObject(event) ? event.type || event.event || event.name : event).toLowerCase();
    assertNotCancelled(next);
    if (eventName === "cancel" || eventName === "reject") return rejectResearchPlan(next, event.reason);
    if (eventName === "approve" || eventName === "confirm_plan") return approveResearchPlan(next);
    if (["start", "start_search", "search_started"].includes(eventName)) return startResearchTask(next);

    if (eventName === "approve_supplementary") {
      const request = isObject(event)
        ? event.request || event.supplementaryRequest || next.supplementaryRequest
        : next.supplementaryRequest;
      return approveSupplementarySearch(next, request);
    }

    const transitions = {
      pause: { from: ["searching"], to: "paused" },
      resume: { from: ["paused"], to: "searching" },
      platform_ready: { from: ["preparing_platforms"], to: "preparing_platforms" },
      report_ready: { from: ["searching"], to: "report_ready" },
      partial_failure: { from: ["searching"], to: "partial_failure" },
      request_supplementary: { from: ["report_ready", "partial_failure"], to: "awaiting_supplementary_confirmation" },
      save_requested: { from: ["report_ready", "partial_failure"], to: "awaiting_save" },
      saved: { from: ["awaiting_save"], to: "saved" }
    };
    const transition = transitions[eventName];
    if (!transition || !transition.from.includes(next.status)) {
      throw workflowError("INVALID_TRANSITION", `不能从 ${next.status} 执行 ${eventName || "未知事件"}`);
    }
    next.status = transition.to;
    if (eventName === "request_supplementary" && isObject(event)) {
      const request = event.request || event.supplementaryRequest;
      if (request) {
        const validation = validateSupplementaryRequest(next, request);
        if (!validation.ok) throw workflowError(validation.code, validation.message);
        next.supplementaryRequest = validation.source;
      }
    }
    next.updatedAt = nowIso();
    return next;
  }

  function usageToDelta(usage = {}) {
    const source = isObject(usage) ? usage : {};
    const queriesByPlatform = normalizeQueriesByPlatform(
      source.queriesByPlatform || (isObject(source.queries) ? source.queries : null)
    );
    if (!Object.keys(queriesByPlatform).length && Number(source.queries) > 0) {
      const platform = normalizePlatform(source.platform) || "__all__";
      queriesByPlatform[platform] = nonNegativeNumber(source.queries);
    }
    return {
      platforms: Array.isArray(source.platforms) ? source.platforms.length : nonNegativeNumber(source.platforms),
      queriesByPlatform,
      pages: nonNegativeNumber(source.pages),
      details: nonNegativeNumber(source.details),
      durationMs: nonNegativeNumber(source.durationMs ?? source.timeMs),
      attachmentBytes: nonNegativeNumber(source.attachmentBytes ?? source.attachmentsBytes),
      analysisTokens: nonNegativeNumber(source.analysisTokens ?? source.tokens)
    };
  }

  function addUsage(current, delta) {
    const next = normalizeBudgetUsage(current);
    next.platforms += delta.platforms;
    for (const [platform, count] of Object.entries(delta.queriesByPlatform)) {
      next.queriesByPlatform[platform] = (next.queriesByPlatform[platform] || 0) + count;
    }
    next.pages += delta.pages;
    next.details += delta.details;
    next.durationMs += delta.durationMs;
    next.attachmentBytes += delta.attachmentBytes;
    next.analysisTokens += delta.analysisTokens;
    return next;
  }

  function findBudgetViolations(usage, budget) {
    const exceeded = [];
    if (usage.platforms > budget.maxPlatforms) exceeded.push("platforms");
    for (const [platform, count] of Object.entries(usage.queriesByPlatform)) {
      if (count > budget.maxQueriesPerPlatform) exceeded.push(`queries:${platform}`);
    }
    if (usage.pages > budget.maxPages) exceeded.push("pages");
    if (usage.details > budget.maxDetails) exceeded.push("details");
    if (usage.durationMs > budget.maxDurationMs) exceeded.push("durationMs");
    if (usage.attachmentBytes > budget.maxAttachmentBytes) exceeded.push("attachmentBytes");
    if (usage.analysisTokens > budget.maxAnalysisTokens) exceeded.push("analysisTokens");
    return exceeded;
  }

  function budgetResult(task, code, usage, exceeded) {
    const base = { ok: code === "ok", code, errorCode: code, task, usage };
    if (code === "budget_exceeded") {
      base.reason = "研究任务超过已批准预算";
      base.exceeded = exceeded;
    }
    return Object.assign(base, task);
  }

  function consumeResearchBudget(task, usage = {}) {
    const current = cloneTask(task);
    assertApproved(current);
    const delta = usageToDelta(usage);
    const nextUsage = addUsage(current.budgetUsage, delta);
    const exceeded = findBudgetViolations(nextUsage, current.budget);
    if (exceeded.length) return budgetResult(current, "budget_exceeded", nextUsage, exceeded);
    const next = { ...current, budgetUsage: nextUsage, updatedAt: nowIso() };
    return budgetResult(next, "ok", nextUsage, []);
  }

  function decideConnectionMode(platform, connection = {}, preference) {
    const capability = isObject(platform) ? { ...platform, ...connection } : connection;
    const apiAvailable = capability.apiAvailable === true
      || capability.supportsApi === true
      || capability.api?.available === true
      || capability.status === "api-available";
    const requested = text(preference || capability.connectionMode || "auto").toLowerCase();
    if (requested === "browser") return "browser";
    const apiConfigured = capability.apiConfigured !== false
      && capability.api?.configured !== false
      && capability.configured !== false;
    const apiReady = apiAvailable && apiConfigured;
    if (requested === "api") return apiReady ? "api" : "api_unavailable";
    if (!apiReady) return "browser";
    const failure = text(capability.lastErrorCategory || capability.errorCategory).toLowerCase();
    if (["auth_failed", "authentication_failed", "timeout", "rate_limited"].includes(failure)) return "browser";
    return "api";
  }

  function resultItems(apiResult) {
    if (Array.isArray(apiResult?.results)) return apiResult.results;
    if (Array.isArray(apiResult?.items)) return apiResult.items;
    if (Array.isArray(apiResult?.data)) return apiResult.data;
    if (Array.isArray(apiResult?.data?.results)) return apiResult.data.results;
    return null;
  }

  function shouldFallbackToBrowser(apiResult = {}, capability = {}, preference) {
    if (text(preference).toLowerCase() === "api" || text(preference).toLowerCase() === "browser") return false;
    const source = isObject(apiResult) ? apiResult : {};
    const status = Number(source.status || source.statusCode);
    const code = text(source.code || source.errorCode || source.errorCategory || source.status).toLowerCase();
    if (status === 401 || status === 403 || status === 408 || status === 429 || status === 504) return true;
    if (["auth_failed", "authentication_failed", "timeout", "rate_limited", "api_auth_failed", "api_timeout", "api_rate_limited"].some(item => code.includes(item))) return true;
    if (source.ok === false || source.success === false) return true;
    const items = resultItems(source);
    if (items && items.length === 0) return true;
    if (!items && (source.resultCount === 0 || source.count === 0)) return true;
    const minimumResults = positiveInteger(capability.minimumResults ?? capability.minResults, 0);
    if (items && minimumResults > 0 && items.length < minimumResults) return true;
    const requiredFields = list(capability.requiredFields || capability.fields || ["title", "url"]);
    if (items && requiredFields.length && items.some(item => requiredFields.some(field => !text(item?.[field])))) return true;
    return false;
  }

  function canRequestSupplementarySearch(task, request = {}) {
    try {
      const current = cloneTask(task);
      assertApproved(current);
      const hasConsumedBudget = current.budgetUsage.platforms > 0
        || Object.values(current.budgetUsage.queriesByPlatform).some(count => count > 0)
        || current.budgetUsage.pages > 0
        || current.budgetUsage.details > 0;
      const canSupplement = ["searching", "paused", "partial_failure", "report_ready", "awaiting_supplementary_confirmation"].includes(current.status)
        || (current.status === "preparing_platforms" && hasConsumedBudget);
      if (!canSupplement) return false;
      const validation = validateSupplementaryRequest(current, request);
      if (!validation.ok) return false;
      const nextUsage = addUsage(current.budgetUsage, validation.delta);
      return findBudgetViolations(nextUsage, current.budget).length === 0;
    } catch {
      return false;
    }
  }

  return {
    DEFAULT_BUDGET,
    createResearchPlan,
    startResearchTask,
    approveResearchPlan,
    rejectResearchPlan,
    transitionResearchTask,
    consumeResearchBudget,
    approveSupplementarySearch,
    decideConnectionMode,
    shouldFallbackToBrowser,
    canRequestSupplementarySearch,
    ALLOWED_STATUSES
  };
});
