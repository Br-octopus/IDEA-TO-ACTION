(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepSocialResearchSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const TASK_STATUSES = new Set([
    "draft", "awaiting-plan-confirmation", "awaiting-platform-preparation", "searching",
    "awaiting-refinement-confirmation", "report-ready", "awaiting-save", "saved",
    "partial-failure", "failed", "cancelled"
  ]);
  const RETRIEVAL_METHODS = new Set(["api", "browser"]);
  const EVIDENCE_STATUSES = new Set([
    "unverified", "source-reviewed", "user-confirmed", "multiple-sources", "conflicting"
  ]);
  const XSEC_TOKEN_PARAM_NAMES = new Set(["xsec_token", "xsectoken"]);
  const CONNECTION_MODES = new Set(["api", "browser", "auto"]);
  const CONNECTION_STATUSES = new Set([
    "needs-recheck", "not-ready", "checking", "ready", "api-available", "expired",
    "manual-verification", "restricted", "failed", "partial"
  ]);
  const LOGIN_STATES = new Set(["unknown", "logged-in", "logged-out", "login-required", "restricted"]);
  const OPERATION_STATES = new Set(["waiting", "running", "completed", "failed", "skipped", "unknown"]);

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
      maxPlatforms: positiveInteger(source.maxPlatforms, 4),
      maxQueriesPerPlatform: positiveInteger(source.maxQueriesPerPlatform, 3),
      maxResultsPerQuery: positiveInteger(source.maxResultsPerQuery, 20),
      maxPages: positiveInteger(source.maxPages, 24),
      maxDetails: positiveInteger(source.maxDetails, 10),
      maxDurationMs: positiveInteger(source.maxDurationMs, 600000),
      maxAttachmentBytes: positiveInteger(source.maxAttachmentBytes, 25 * 1024 * 1024),
      maxAnalysisTokens: positiveInteger(source.maxAnalysisTokens, 10000),
      maxSourceRequests: Math.min(100, positiveInteger(source.maxSourceRequests, 100))
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

  function normalizeResearchMaterial(input = {}, resultId = "") {
    const source = isObject(input) ? input : {};
    const sourceTypes = new Set(["platform-caption", "human-caption", "automatic-caption", "local-transcription", "unknown"]);
    return {
      id: makeId("material", source.id),
      resultId: text(source.resultId || resultId),
      kind: ["detail", "comments", "transcript"].includes(source.kind) ? source.kind : "detail",
      contentId: text(source.contentId),
      sourceId: text(source.sourceId, "unknown") || "unknown",
      sourceVersion: text(source.sourceVersion, "unknown") || "unknown",
      operationId: text(source.operationId),
      connectionMethod: text(source.connectionMethod, "unknown") || "unknown",
      acquisitionMethod: text(source.acquisitionMethod, "unknown") || "unknown",
      capturedAt: text(source.capturedAt, nowIso()),
      itemCount: nonNegativeInteger(source.itemCount),
      sortOrder: text(source.sortOrder, "unknown") || "unknown",
      totalCount: source.totalCount === null || source.totalCount === undefined || source.totalCount === ""
        ? null
        : Number.isSafeInteger(Number(source.totalCount)) && Number(source.totalCount) >= 0
          ? Number(source.totalCount)
          : null,
      sourceType: sourceTypes.has(source.sourceType) ? source.sourceType : "unknown",
      language: text(source.language, "unknown") || "unknown",
      status: ["running", "completed", "failed", "cancelled", "skipped", "unavailable"].includes(source.status)
        ? source.status : "failed",
      summary: text(source.summary).slice(0, 1000),
      truncated: booleanValue(source.truncated),
      truncationReason: text(source.truncationReason),
      errorCategory: text(source.errorCategory),
      errorCode: text(source.errorCode),
      errorMessage: text(source.errorMessage).slice(0, 500),
      budgetReserved: booleanValue(source.budgetReserved),
      attachmentId: text(source.attachmentId)
    };
  }

  function resolveDomesticContentId(result = {}) {
    const source = isObject(result) ? result : {};
    const platform = text(source.platform).toLowerCase();
    const rawId = text(source.contentId);
    let url;
    try { url = new URL(text(source.url)); } catch (error) { url = null; }
    if (platform === "xiaohongshu") {
      const pathId = url?.pathname.match(/\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]{1,64})(?:\/|$)/)?.[1];
      const noteId = /^[A-Za-z0-9_-]{1,64}$/.test(rawId) ? rawId : pathId;
      if (!noteId) return null;
      const xsecSource = url?.searchParams.get("xsec_source") || "";
      const xsecToken = url
        ? [...url.searchParams.entries()].find(([name, value]) => XSEC_TOKEN_PARAM_NAMES.has(name.toLowerCase()) && value)?.[1] || ""
        : "";
      return {
        noteId,
        ...(xsecSource && xsecSource.length <= 512 ? { xsecSource } : {}),
        ...(xsecToken && xsecToken.length <= 512 ? { xsecToken } : {})
      };
    }
    if (platform === "bilibili") {
      const bvid = rawId.match(/^BV[0-9A-Za-z]{10}$/)?.[0]
        || url?.href.match(/\b(BV[0-9A-Za-z]{10})\b/)?.[1];
      if (bvid) return { bvid };
      const aid = rawId.match(/^(?:av)?([1-9][0-9]{0,19})$/i)?.[1]
        || url?.pathname.match(/\/video\/av([1-9][0-9]{0,19})(?:\/|$)/i)?.[1];
      return aid ? { aid } : null;
    }
    if (platform === "weibo") {
      if (url && !["weibo.com", "www.weibo.com"].includes(url.hostname.toLowerCase())) return null;
      const postId = url?.pathname.match(/^\/(?:\d{1,20}\/([A-Za-z0-9]+)|detail\/(\d{1,30})|status\/([A-Za-z0-9]+))\/?$/);
      const id = postId?.[1] || postId?.[2] || postId?.[3]
        || rawId.match(/^[A-Za-z0-9]{1,32}$/)?.[0];
      return id ? { postId: id } : null;
    }
    if (platform === "zhihu") {
      const answer = url?.pathname.match(/^\/question\/(\d{1,30})\/answer\/(\d{1,30})\/?$/);
      if (answer && url.hostname === "www.zhihu.com") return { questionId: answer[1], answerId: answer[2] };
      const article = url?.hostname === "zhuanlan.zhihu.com"
        ? url.pathname.match(/^\/p\/(\d{1,30})\/?$/) : null;
      if (article) return { articleId: article[1] };
      return null;
    }
    return null;
  }

  function normalizeSocialResult(input = {}) {
    const source = isObject(input) ? input : {};
    const sourceUrl = text(source.url || source.sourceUrl);
    if (sourceUrl && !isSafeHttpUrl(sourceUrl)) throw new TypeError("结果 URL 必须是 http 或 https 地址");
    const url = removeXsecTokenParams(sourceUrl);
    const retrievalMethod = RETRIEVAL_METHODS.has(source.retrievalMethod)
      ? source.retrievalMethod
      : "browser";
    const evidenceStatus = EVIDENCE_STATUSES.has(source.evidenceStatus)
      ? source.evidenceStatus
      : "unverified";
    return {
      id: makeId("result", source.id),
      platform: text(source.platform).toLowerCase(),
      contentId: text(source.contentId),
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
      attachmentIds: listValue(source.attachmentIds),
      materials: Array.isArray(source.materials)
        ? source.materials.map(item => normalizeResearchMaterial(item, source.id))
        : []
    };
  }

  function removeXsecTokenParams(value) {
    let url;
    try { url = new URL(value); } catch (error) { return value; }
    const tokenParamNames = [...new Set([...url.searchParams.keys()]
      .filter(name => XSEC_TOKEN_PARAM_NAMES.has(name.toLowerCase())))];
    if (!tokenParamNames.length) return value;
    for (const name of tokenParamNames) url.searchParams.delete(name);
    return url.toString();
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
    const findings = value => (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
      .map(item => text(isObject(item) ? item.finding : item)).filter(Boolean);
    const citations = Array.isArray(source.citations) ? source.citations.map(item => {
      const citation = isObject(item) ? item : {};
      return {
        findingIndex: Number.isInteger(citation.findingIndex) && citation.findingIndex >= 0 ? citation.findingIndex : -1,
        resultId: text(citation.resultId),
        materialId: text(citation.materialId)
      };
    }).filter(item => item.findingIndex >= 0 && item.resultId && item.materialId) : [];
    return {
      coreFindings: findings(source.coreFindings || source.keyFindings),
      commonPoints: listValue(source.commonPoints || source.platformCommonalities),
      platformDifferences: listValue(source.platformDifferences),
      painPointsOrPatterns: listValue(source.painPointsOrPatterns),
      representativeCases: listValue(source.representativeCases),
      conflicts: listValue(source.conflicts),
      needsVerification: listValue(source.needsVerification),
      nextSteps: listValue(source.nextSteps),
      summary: text(source.summary),
      resultIds: listValue(source.resultIds),
      sourceUrls: listValue(source.sourceUrls),
      citations,
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
      browserStatus: "needs-recheck",
      browserReady: false,
      connectionMode: CONNECTION_MODES.has(source.connectionMode) ? source.connectionMode : "auto",
      apiConfigured: booleanValue(source.apiConfigured),
      browserPrepared: false,
      checked: false,
      checkedAt: text(source.checkedAt || source.lastCheckedAt),
      lastCheckedAt: text(source.lastCheckedAt || source.checkedAt),
      lastSuccessfulSearchAt: text(source.lastSuccessfulSearchAt),
      loginState: LOGIN_STATES.has(source.loginState) ? source.loginState : "unknown",
      searchVerified: source.searchVerified === true,
      capabilities: isObject(source.capabilities) ? {
        supportsSearch: booleanValue(source.capabilities.supportsSearch),
        supportsDetail: booleanValue(source.capabilities.supportsDetail),
        supportsComments: booleanValue(source.capabilities.supportsComments),
        supportsScreenshots: booleanValue(source.capabilities.supportsScreenshots)
      } : {},
      lastErrorCategory: text(source.lastErrorCategory),
      lastErrorCode: text(source.lastErrorCode || source.errorCode),
      error: text(source.error || source.lastError)
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
    const operations = (Array.isArray(source.operations) ? source.operations : []).map(item => normalizeResearchOperation(item));
    return {
      id: makeId("research-task", source.id),
      topic: text(source.topic),
      template: text(source.template),
      plan: normalizeResearchPlan(source.plan),
      planVersion: positiveInteger(source.planVersion, 1),
      operations,
      platforms: listValue(source.platforms),
      preparedPlatforms: listValue(source.preparedPlatforms),
      profileId: text(source.profileId),
      connectionModes: isObject(source.connectionModes)
        ? Object.entries(source.connectionModes).reduce((result, [platform, mode]) => {
          if (CONNECTION_MODES.has(mode)) result[text(platform).toLowerCase()] = mode;
          return result;
        }, {})
        : {},
      status: TASK_STATUSES.has(source.status) ? source.status : "draft",
      platformErrors: isObject(source.platformErrors)
        ? Object.entries(source.platformErrors).reduce((result, [platform, error]) => {
          const key = text(platform).toLowerCase();
          if (key && isObject(error)) {
            result[key] = { message: text(error.message), ...(text(error.code) ? { code: text(error.code) } : {}) };
          }
          return result;
        }, {})
        : {},
      failureReason: text(source.failureReason),
      rejectionReason: text(source.rejectionReason),
      planError: text(source.planError),
      planErrorCode: text(source.planErrorCode),
      reportError: text(source.reportError),
      reportErrorCode: text(source.reportErrorCode),
      budget: normalizeBudget(source.budget),
      usage: isObject(source.usage) ? {
        platforms: nonNegativeInteger(source.usage.platforms),
        usedPlatforms: listValue(source.usage.usedPlatforms),
        queriesByPlatform: isObject(source.usage.queriesByPlatform)
          ? Object.fromEntries(Object.entries(source.usage.queriesByPlatform).map(([platform, count]) => [text(platform).toLowerCase(), nonNegativeInteger(count)]).filter(([platform]) => platform))
          : {},
        pages: nonNegativeInteger(source.usage.pages),
        details: nonNegativeInteger(source.usage.details),
        durationMs: Math.max(0, Number.isFinite(Number(source.usage.durationMs)) ? Number(source.usage.durationMs) : 0),
        attachmentBytes: nonNegativeInteger(source.usage.attachmentBytes),
        analysisTokens: nonNegativeInteger(source.usage.analysisTokens),
        analysisTokensEstimated: booleanValue(source.usage.analysisTokensEstimated),
        sourceRequests: nonNegativeInteger(source.usage.sourceRequests)
      } : { platforms: 0, usedPlatforms: [], queriesByPlatform: {}, pages: 0, details: 0, durationMs: 0, attachmentBytes: 0, analysisTokens: 0, analysisTokensEstimated: false, sourceRequests: 0 },
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

  function normalizeResearchOperation(input = {}) {
    const source = isObject(input) ? input : {};
    const state = OPERATION_STATES.has(source.state) ? source.state : "waiting";
    return {
      operationId: text(source.operationId) || makeId("operation"),
      parentOperationId: text(source.parentOperationId),
      planVersion: positiveInteger(source.planVersion, 1),
      platform: text(source.platform).toLowerCase(),
      profileId: text(source.profileId),
      sourceId: text(source.sourceId),
      sourceVersion: text(source.sourceVersion),
      capability: text(source.capability),
      contentId: isObject(source.contentId) ? Object.fromEntries(Object.entries(source.contentId).filter(([key, value]) => ["noteId", "bvid", "aid", "cursor"].includes(key) && (typeof value === "string" || key === "cursor" && Number.isSafeInteger(value))).map(([key, value]) => [key, String(value)])) : {},
      query: text(source.query).slice(0, 500),
      pageCursor: text(source.pageCursor).slice(0, 500),
      budget: isObject(source.budget) ? Object.fromEntries(Object.entries(source.budget).filter(([, value]) => Number.isSafeInteger(value) && value >= 0)) : {},
      state,
      attempt: positiveInteger(source.attempt, 1),
      createdAt: text(source.createdAt, nowIso()),
      updatedAt: text(source.updatedAt, nowIso()),
      resultIds: listValue(source.resultIds),
      summary: text(source.summary).slice(0, 1000),
      errorCode: text(source.errorCode),
      errorMessage: text(source.errorMessage).slice(0, 500),
      cursorInvalid: booleanValue(source.cursorInvalid)
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

  function hasStableId(value) {
    return isObject(value) && typeof value.id === "string" && Boolean(value.id.trim());
  }

  function resolveResearchProfileId(platform, profileId) {
    return text(profileId) || `social-research-${text(platform)}`;
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
        .filter(hasStableId)
        .map(normalizeResearchTask),
      platformConnections,
      researchAttachments: (Array.isArray(source.researchAttachments) ? source.researchAttachments : [])
        .filter(hasStableId)
        .map(normalizeAttachmentMeta)
        .filter(item => item.id)
    };
  }

  return {
    createResearchTask,
    normalizeResearchPlan,
    normalizeSocialResult,
    normalizeResearchMaterial,
    normalizeResearchOperation,
    resolveDomesticContentId,
    normalizePlatformCapability,
    normalizeAttachmentMeta,
    resolveResearchProfileId,
    sanitizeResearchState,
    isSafeHttpUrl
  };
});
