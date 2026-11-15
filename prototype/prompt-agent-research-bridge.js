(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPromptAgentResearchBridge = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const DEFAULT_MAX_QUERIES = 3;
  const DEFAULT_MAX_SOURCES = 5;
  const HARD_MAX_QUERIES = 10;
  const HARD_MAX_SOURCES = 20;
  const PLATFORMS = new Set(["xiaohongshu", "reddit", "youtube"]);
  const SOURCE_TYPES = new Set(["web", "social", "official-docs", "官方文档", "community", "github", "评测", "案例"]);

  function usesWebSearch(sourceTypes) {
    return sourceTypes.some(type => type !== "social");
  }

  function cleanText(value, maximum = 300) {
    return typeof value === "string" ? value.trim().slice(0, maximum) : "";
  }

  function normalizeScope(input = {}) {
    const objective = cleanText(input.objective);
    const queries = [...new Set((Array.isArray(input.queries) ? input.queries : [])
      .map(query => cleanText(query, 240)).filter(Boolean))].slice(0, HARD_MAX_QUERIES);
    const sourceTypes = [...new Set((Array.isArray(input.sourceTypes) ? input.sourceTypes : [])
      .filter(type => SOURCE_TYPES.has(type)))];
    const platforms = [...new Set((Array.isArray(input.platforms) ? input.platforms : [])
      .map(platform => String(platform || "").trim().toLowerCase()).filter(platform => PLATFORMS.has(platform)))];
    if (!objective) throw new TypeError("研究范围必须包含明确目标");
    if (!queries.length) throw new TypeError("研究范围必须包含至少一个查询");
    if (!sourceTypes.length) throw new TypeError("研究范围必须指定网页或社媒来源");
    if (sourceTypes.includes("social") && !platforms.length) throw new TypeError("社媒研究必须指定支持的平台");
    const requestedQueries = Math.max(DEFAULT_MAX_QUERIES, queries.length, Math.floor(Number(input.budget?.maxQueries) || 0));
    const requestedSources = Math.max(1, Math.floor(Number(input.budget?.maxSources) || DEFAULT_MAX_SOURCES));
    return {
      objective,
      queries,
      sourceTypes,
      platforms,
      requestedBudget: {
        maxQueries: Math.min(HARD_MAX_QUERIES, requestedQueries || DEFAULT_MAX_QUERIES),
        maxSources: Math.min(HARD_MAX_SOURCES, requestedSources)
      }
    };
  }

  function normalizeSource(source = {}) {
    const url = cleanText(source.url || source.link, 1000);
    if (!/^https?:\/\//i.test(url)) return null;
    return {
      platform: cleanText(source.platform, 60).toLowerCase(),
      queries: (Array.isArray(source.searchQueries) ? source.searchQueries : Array.isArray(source.queries) ? source.queries : [])
        .map(query => cleanText(query, 240)).filter(Boolean).slice(0, 5),
      title: cleanText(source.title, 180) || "未命名来源",
      url,
      date: cleanText(source.date || source.publishedAt || source.published_at, 80) || "未提供",
      summary: cleanText(source.summary || source.snippet || source.description, 600),
      applicability: cleanText(source.applicability || source.relevance, 240) || "与研究目标相关，需结合原文判断",
      limitations: cleanText(source.limitations, 240) || "搜索摘要未经过本工具独立核验"
    };
  }

  function normalizeSocialResearchResult(task = {}, maximum = DEFAULT_MAX_SOURCES) {
    const report = task.report && typeof task.report === "object" ? task.report : {};
    const sources = (Array.isArray(task.results) ? task.results : [])
      .map(item => normalizeSource(item))
      .filter(Boolean)
      .slice(0, Math.min(DEFAULT_MAX_SOURCES, Math.max(0, Number(maximum) || DEFAULT_MAX_SOURCES)));
    const status = String(task.status || "unknown");
    const errors = Object.entries(task.platformErrors || {}).map(([platform, error]) => ({
      type: platform,
      message: cleanText(error?.message, 240)
    })).filter(item => item.message);
    if (task.failureReason || task.reportError) {
      errors.push({ type: "research", message: cleanText(task.failureReason || task.reportError, 240) });
    }
    return {
      status,
      summary: cleanText(report.summary, 1200),
      sources,
      limitations: (Array.isArray(report.needsVerification) ? report.needsVerification : [])
        .map(item => cleanText(item, 240)).filter(Boolean).slice(0, 10),
      errors: errors.slice(0, 10),
      budget: {
        maxPlatforms: Number(task.budget?.maxPlatforms || 0),
        maxQueriesPerPlatform: Number(task.budget?.maxQueriesPerPlatform || 0),
        maxDetails: Number(task.budget?.maxDetails || 0),
        maxQueries: Number(task.budget?.maxQueriesPerPlatform || 0) * (Array.isArray(task.platforms) ? task.platforms.length : 0),
        usedQueries: Object.values(task.usage?.queriesByPlatform || {}).reduce((total, count) => total + (Number(count) || 0), 0),
        maxSources: Number(task.budget?.maxDetails || 0),
        usedSources: Number(task.usage?.details || 0)
      },
      queries: Array.isArray(task.queries) ? task.queries.map(query => cleanText(query, 240)).filter(Boolean).slice(0, 10) : [],
      incomplete: !["awaiting-save", "saved", "complete", "completed"].includes(status)
    };
  }

  function createPromptAgentResearchBridge({ searchWeb, createSocialResearchPlan } = {}) {
    const requests = new Map();

    function preview(input) {
      const scope = normalizeScope(input);
      const runsPerQuery = (usesWebSearch(scope.sourceTypes) ? 1 : 0)
        + (scope.sourceTypes.includes("social") ? scope.platforms.length : 0);
      const executableQueries = scope.queries.slice(0, Math.floor(HARD_MAX_QUERIES / Math.max(1, runsPerQuery)));
      const requiredQueries = executableQueries.length * runsPerQuery;
      const budget = {
        maxQueries: Math.min(DEFAULT_MAX_QUERIES, scope.requestedBudget.maxQueries),
        maxSources: Math.min(DEFAULT_MAX_SOURCES, scope.requestedBudget.maxSources)
      };
      const requiresBudgetConfirmation = executableQueries.length < scope.queries.length
        || requiredQueries > budget.maxQueries
        || scope.requestedBudget.maxSources > DEFAULT_MAX_SOURCES;
      const id = `prompt-research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const request = {
        id,
        status: "awaiting-confirmation",
        objective: scope.objective,
        queries: executableQueries,
        omittedQueryCount: scope.queries.length - executableQueries.length,
        sourceTypes: scope.sourceTypes,
        platforms: scope.platforms,
        requestedBudget: scope.requestedBudget,
        estimatedQueryRuns: requiredQueries,
        budget,
        requiresBudgetConfirmation,
        budgetAdjustmentConfirmed: false
      };
      requests.set(id, request);
      return structuredClone(request);
    }

    function approve(id, { confirmBudget = false, budget: approvedBudget } = {}) {
      const request = requests.get(String(id));
      if (!request || request.status !== "awaiting-confirmation") throw new Error("研究请求不在等待确认状态");
      if (request.requiresBudgetConfirmation && confirmBudget !== true) throw new Error("预算超出默认上限，需确认调整后的预算");
      const budget = {
        maxQueries: Math.min(HARD_MAX_QUERIES, Math.max(request.budget.maxQueries, Math.floor(Number(approvedBudget?.maxQueries) || request.estimatedQueryRuns))),
        maxSources: Math.min(HARD_MAX_SOURCES, Math.max(request.budget.maxSources, Math.floor(Number(approvedBudget?.maxSources) || request.requestedBudget.maxSources)))
      };
      if (request.estimatedQueryRuns > budget.maxQueries) throw new RangeError("批准的查询预算不足以覆盖预览范围");
      request.status = "approved";
      request.budget = budget;
      request.budgetAdjustmentConfirmed = request.requiresBudgetConfirmation;
      return structuredClone(request);
    }

    function reject(id) {
      const request = requests.get(String(id));
      if (!request || request.status !== "awaiting-confirmation") throw new Error("研究请求不在等待确认状态");
      request.status = "rejected";
      return structuredClone(request);
    }

    async function execute(id, { signal } = {}) {
      const request = requests.get(String(id));
      if (!request || request.status !== "approved") throw new Error("执行研究前必须先确认研究计划和预算");
      request.status = "running";
      const results = [];
      const errors = [];
      const manualQueries = [];
      let usedQueries = 0;
      const queries = request.queries.slice(0, Math.min(request.queries.length, request.budget.maxQueries));

      for (const query of usesWebSearch(request.sourceTypes) ? queries : []) {
        if (signal?.aborted) {
          request.status = "cancelled";
          return { status: "cancelled", results, errors, usedQueries, usedSources: results.length };
        }
        usedQueries += 1;
        try {
          if (typeof searchWeb !== "function") throw new Error("搜索服务不可用");
          const response = await searchWeb(query, { maxResults: request.budget.maxSources, signal });
          if (response?.configured === false || response?.code || response?.error) {
            throw new Error(response.message || response.code || "搜索服务不可用");
          }
          const items = Array.isArray(response) ? response : response?.results || [];
          for (const item of items) {
            const source = normalizeSource(item);
            if (source && !results.some(existing => existing.url === source.url)) results.push(source);
            if (results.length >= request.budget.maxSources) break;
          }
        } catch (error) {
          errors.push({ type: "web-search", query, message: cleanText(error?.message, 200) || "搜索失败" });
          manualQueries.push(query);
        }
        if (results.length >= request.budget.maxSources) break;
      }

      let socialHandoff = null;
      if (request.sourceTypes.includes("social") && usedQueries < request.budget.maxQueries && !signal?.aborted) {
        const remainingRuns = request.budget.maxQueries - usedQueries;
        const perPlatformLimit = Math.floor(remainingRuns / request.platforms.length);
        const socialQueries = queries.slice(0, Math.min(queries.length, perPlatformLimit));
        if (results.length >= request.budget.maxSources) {
          errors.push({ type: "social-research", message: "来源预算已耗尽，未创建社媒研究计划" });
        } else if (typeof createSocialResearchPlan !== "function") {
          errors.push({ type: "social-research", message: "社媒研究 Agent 不可用" });
        } else if (!socialQueries.length) {
          errors.push({ type: "social-research", message: "查询预算已耗尽，未创建社媒研究计划" });
        } else {
          try {
            socialHandoff = await createSocialResearchPlan({
              topic: request.objective,
              objective: request.objective,
              template: "fact-check",
              platforms: request.platforms,
              queries: socialQueries,
              budget: {
                maxPlatforms: request.platforms.length,
                maxQueriesPerPlatform: socialQueries.length,
                maxDetails: request.budget.maxSources - results.length
              }
            });
            usedQueries += socialQueries.length * request.platforms.length;
          } catch (error) {
            errors.push({ type: "social-research", message: cleanText(error?.message, 200) || "社媒研究计划创建失败" });
          }
        }
      }
      if (signal?.aborted) request.status = "cancelled";
      else if (socialHandoff) request.status = "awaiting-social-plan-confirmation";
      else if (errors.length) request.status = results.length ? "partial" : "failed";
      else if (usesWebSearch(request.sourceTypes) && !results.length) request.status = "failed";
      else request.status = "complete";
      if (!results.length && !socialHandoff && usesWebSearch(request.sourceTypes)) manualQueries.push(...queries);
      return {
        status: request.status,
        objective: request.objective,
        results: results.slice(0, request.budget.maxSources),
        socialHandoff,
        errors,
        manualQueries: [...new Set(manualQueries)],
        usedQueries,
        usedSources: results.length,
        budget: request.budget,
        incomplete: request.status !== "complete"
      };
    }

    return { preview, approve, reject, execute, collectSocialResearchResult: normalizeSocialResearchResult };
  }

  return { DEFAULT_MAX_QUERIES, DEFAULT_MAX_SOURCES, normalizeScope, normalizeSource, normalizeSocialResearchResult, createPromptAgentResearchBridge };
});
