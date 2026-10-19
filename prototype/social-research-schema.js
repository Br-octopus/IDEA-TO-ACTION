(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepSocialResearchSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const TASK_STATUSES = new Set([
    "draft", "awaiting-plan-confirmation", "awaiting-platform-preparation", "searching",
    "awaiting-refinement-confirmation", "report-ready", "awaiting-save", "saved",
    "partial-failure", "cancelled"
  ]);
  const RETRIEVAL_METHODS = new Set(["api", "browser"]);
  const EVIDENCE_STATUSES = new Set([
    "unverified", "source-reviewed", "user-confirmed", "multiple-sources", "conflicting"
  ]);
  const CONNECTION_MODES = new Set(["api", "browser", "auto"]);
  const CONNECTION_STATUSES = new Set([
    "needs-recheck", "not-ready", "checking", "ready", "api-available", "expired",
    "manual-verification", "restricted", "failed", "partial"
  ]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function text(value, fallback = "") {
    return String(value ?? fallback).trim();
  }

  function listValue(value) {
    const values = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[\r\n,，]/)
        : [];
    return [...new Set(values.map(item => text(item)).filter(Boolean))];
  }

  function nonNegativeInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : fallback;
  }

  function positiveInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  }

  function booleanValue(value, fallback = false) {
    return typeof value === "boolean" ? value : fallback;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(prefix, value) {
    const existing = text(value);
    if (existing) return existing;
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `${prefix}-${crypto.randomUUID()}`;
      }
    } catch (error) {
      // 没有可用的随机源时回退到时间戳，数据契约仍然保持可用。
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function isSafeHttpUrl(value) {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
      const url = new URL(value.trim());
      return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch (error) {
      return false;
    }
  }

  function normalizeBudget(input) {
    const source = isObject(input) ? input : {};
    return {
      maxPlatforms: positiveInteger(source.maxPlatforms, 3),
      maxQueriesPerPlatform: positiveInteger(source.maxQueriesPerPlatform, 5),
      maxPages: positiveInteger(source.maxPages, 3),
      maxDetails: positiveInteger(source.maxDetails, 20),
      maxDurationMs: positiveInteger(source.maxDurationMs, 300000),
      maxAttachmentBytes: positiveInteger(source.maxAttachmentBytes, 25 * 1024 * 1024),
      maxAnalysisTokens: positiveInteger(source.maxAnalysisTokens, 10000)
    };
  }

  function normalizeTimeRange(input) {
    const source = isObject(input) ? input : {};
    return {
      from: text(source.from || source.start),
      to: text(source.to || source.end),
      timezone: text(source.timezone)
    };
  }

  function normalizeFilters(input) {
    const source = isObject(input) ? input : {};
    return {
      include: listValue(source.include),
      exclude: listValue(source.exclude),
      contentTypes: listValue(source.contentTypes),
      languages: listValue(source.languages)
    };
  }

  function normalizeResearchPlan(input) {
    const source = isObject(input) ? input : {};
    const platformRoles = Array.isArray(source.platformRoles)
      ? source.platformRoles.map(item => {
        const role = isObject(item) ? item : { platform: item };
        return {
          platform: text(role.platform),
          role: text(role.role),
          queries: listValue(role.queries)
        };
      }).filter(item => item.platform)
      : [];
    return {
      objective: text(source.objective || source.goal),
      researchType: text(source.researchType || source.template),
      platformRoles,
      queries: listValue(source.queries),
      timeRange: normalizeTimeRange(source.timeRange),
      region: text(source.region),
      audience: text(source.audience),
      filters: normalizeFilters(source.filters),
      expectedResultCount: nonNegativeInteger(source.expectedResultCount, 0),
      evidenceRequirements: listValue(source.evidenceRequirements),
      budget: normalizeBudget(source.budget),
      stopConditions: listValue(source.stopConditions)
    };
  }

  function normalizeMetrics(input) {
    const source = isObject(input) ? input : {};
    const fields = ["likes", "comments", "shares", "views", "score", "reposts", "saves", "followers"];
    return fields.reduce((result, field) => {
      const number = Number(source[field]);
      if (Number.isFinite(number) && number >= 0) result[field] = number;
      return result;
    }, {});
  }

  function normalizeSocialResult(input = {}) {
    const source = isObject(input) ? input : {};
    const url = text(source.url || source.sourceUrl);
    if (url && !isSafeHttpUrl(url)) throw new TypeError("结果 URL 必须是 http 或 https 地址");
    const retrievalMethod = RETRIEVAL_METHODS.has(source.retrievalMethod)
      ? source.retrievalMethod
      : "browser";
    const evidenceStatus = EVIDENCE_STATUSES.has(source.evidenceStatus)
      ? source.evidenceStatus
      : "unverified";
    return {
      id: makeId("result", source.id),
      platform: text(source.platform).toLowerCase(),
      url,
      title: text(source.title),
      author: text(source.author),
      publishedAt: text(source.publishedAt),
      capturedAt: text(source.capturedAt, nowIso()),
      searchQueries: listValue(source.searchQueries),
      summary: text(source.summary),
      discussionSummary: text(source.discussionSummary),
      publicMetrics: normalizeMetrics(source.publicMetrics),
      contentType: text(source.contentType),
      retrievalMethod,
      evidenceStatus,
      marketingRisk: text(source.marketingRisk, "unknown") || "unknown",
      needsManualReview: booleanValue(source.needsManualReview),
      attachmentIds: listValue(source.attachmentIds)
    };
  }

  function normalizePlatformCapability(input = {}) {
    const source = isObject(input) ? input : {};
    const status = CONNECTION_STATUSES.has(source.status) ? source.status : "needs-recheck";
    return {
      platform: text(source.platform).toLowerCase(),
      displayName: text(source.displayName),
      status,
      supportsSearch: booleanValue(source.supportsSearch),
      supportsDetail: booleanValue(source.supportsDetail),
      supportsComments: booleanValue(source.supportsComments),
      supportsScreenshots: booleanValue(source.supportsScreenshots),
      apiAvailable: booleanValue(source.apiAvailable),
      browserAvailable: booleanValue(source.browserAvailable),
      connectionModes: listValue(source.connectionModes).filter(mode => CONNECTION_MODES.has(mode)),
      lastCheckedAt: text(source.lastCheckedAt || source.checkedAt),
      notes: text(source.notes)
    };
  }

  function normalizeAttachmentMeta(input = {}) {
    const source = isObject(input) ? input : {};
    return {
      id: text(source.id),
      type: text(source.type, "file") || "file",
      size: nonNegativeInteger(source.size, 0),
      sourceResultId: text(source.sourceResultId),
      relativePath: normalizeRelativePath(source.relativePath),
      savedAt: text(source.savedAt)
    };
  }

  function normalizeRelativePath(value) {
    const path = text(value).replace(/\\/g, "/");
    if (!path || path.startsWith("/") || /^[a-zA-Z]:\//.test(path)) return "";
    if (path.split("/").some(part => part === "..")) return "";
    return path;
  }

  function normalizeReport(input) {
    const source = isObject(input) ? input : {};
    return {
      coreFindings: listValue(source.coreFindings || source.keyFindings),
      commonPoints: listValue(source.commonPoints || source.platformCommonalities),
      platformDifferences: listValue(source.platformDifferences),
      painPointsOrPatterns: listValue(source.painPointsOrPatterns),
      representativeCases: listValue(source.representativeCases),
      conflicts: listValue(source.conflicts),
      needsVerification: listValue(source.needsVerification),
      nextSteps: listValue(source.nextSteps),
      summary: text(source.summary),
      resultIds: listValue(source.resultIds),
      generatedAt: text(source.generatedAt)
    };
  }

  function normalizeConnection(input, platform) {
    const source = isObject(input) ? input : {};
    const capability = normalizePlatformCapability({ ...source, platform: source.platform || platform });
    return {
      ...capability,
      platform: capability.platform || text(platform).toLowerCase(),
      status: "needs-recheck",
      connectionMode: CONNECTION_MODES.has(source.connectionMode) ? source.connectionMode : "auto",
      apiConfigured: booleanValue(source.apiConfigured),
      browserPrepared: booleanValue(source.browserPrepared),
      lastErrorCategory: text(source.lastErrorCategory)
    };
  }

  function normalizeResearchTask(input = {}) {
    const source = isObject(input) ? input : {};
    const rawResults = Array.isArray(source.results) ? source.results : [];
    const results = rawResults.map(item => {
      try {
        return normalizeSocialResult(item);
      } catch (error) {
        return null;
      }
    }).filter(Boolean);
    const resultIds = listValue(source.resultIds || results.map(result => result.id));
    const createdAt = text(source.createdAt, nowIso());
    return {
      id: makeId("research-task", source.id),
      topic: text(source.topic),
      template: text(source.template),
      plan: normalizeResearchPlan(source.plan),
      platforms: listValue(source.platforms),
      connectionModes: isObject(source.connectionModes)
        ? Object.entries(source.connectionModes).reduce((result, [platform, mode]) => {
          if (CONNECTION_MODES.has(mode)) result[text(platform).toLowerCase()] = mode;
          return result;
        }, {})
        : {},
      status: TASK_STATUSES.has(source.status) ? source.status : "draft",
      budget: normalizeBudget(source.budget),
      queries: listValue(source.queries),
      resultIds,
      results,
      reportId: text(source.reportId),
      report: normalizeReport(source.report),
      selectedResultIds: listValue(source.selectedResultIds),
      savedResultIds: listValue(source.savedResultIds),
      excludedResultIds: listValue(source.excludedResultIds),
      createdAt,
      updatedAt: text(source.updatedAt, createdAt)
    };
  }

  function createResearchTask(input = {}) {
    const source = isObject(input) ? input : {};
    return normalizeResearchTask({
      ...source,
      plan: source.plan || {
        objective: source.topic,
        researchType: source.template
      },
      status: source.status || "draft",
      platforms: source.platforms || [],
      results: source.results || []
    });
  }

  function sanitizeResearchState(state) {
    const source = isObject(state) ? state : {};
    const platformConnections = isObject(source.platformConnections)
      ? Object.entries(source.platformConnections).reduce((result, [platform, connection]) => {
        const key = text(platform).toLowerCase();
        if (key) result[key] = normalizeConnection(connection, key);
        return result;
      }, {})
      : {};
    return {
      researchTasks: (Array.isArray(source.researchTasks) ? source.researchTasks : [])
        .map(normalizeResearchTask),
      platformConnections,
      researchAttachments: (Array.isArray(source.researchAttachments) ? source.researchAttachments : [])
        .map(normalizeAttachmentMeta)
        .filter(item => item.id)
    };
  }

  return {
    createResearchTask,
    normalizeResearchPlan,
    normalizeSocialResult,
    normalizePlatformCapability,
    normalizeAttachmentMeta,
    sanitizeResearchState,
    isSafeHttpUrl
  };
});
