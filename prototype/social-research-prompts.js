(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepSocialResearchPrompts = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const TEMPLATE_GUIDANCE = {
    trends: "识别跨来源反复出现的趋势、变化方向、时间范围和平台差异；热度只能作为观察信号，不能直接当作事实或因果证据。",
    "pain-points": "提取用户明确表达的痛点、触发场景、替代方案和未满足需求；区分单个观点、重复模式与待验证假设。",
    "content-competitors": "比较内容主题、受众、表达方式、互动信号和可复用空白；不要把互动量直接等同于内容质量或商业结果。",
    "fact-check": "逐条核对主张、原始来源、发布时间、证据强度和相互矛盾之处；不能以热度、转发量或单一帖子证明事实。"
  };

  function text(value) {
    return String(value ?? "").trim();
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value, (key, item) => {
        if (/token|secret|password|cookie|credential|api[-_]?key|authorization/i.test(key)) return undefined;
        return item;
      }, 2);
    } catch {
      return "{}";
    }
  }

  function normalizeTemplate(value) {
    const normalized = text(value).toLowerCase().replace(/_/g, "-");
    if (normalized === "trend") return "trends";
    if (normalized === "pain-point") return "pain-points";
    if (["competitors", "content-competitor", "content-competitors"].includes(normalized)) return "content-competitors";
    if (["factcheck", "fact-checking"].includes(normalized)) return "fact-check";
    return TEMPLATE_GUIDANCE[normalized] ? normalized : "pain-points";
  }

  function commonRules() {
    return [
      "只输出 JSON 或带有固定标题的可解析区块，不输出无法定位的散文式结论。",
      "每个结论必须关联一个或多个结果 id 和完整的 http/https 结果链接；没有链接的内容只能列为待核验线索，不能写成结论。",
      "不得把高热度、点赞、评论或转发直接等同于事实、质量、因果或效果证明。",
      "明确列出已完成平台、未完成平台、失败原因和证据缺口，不得隐藏未完成平台。",
      "区分原文事实、作者观点、模型推断和待用户确认内容。"
    ].map(rule => `- ${rule}`).join("\n");
  }

  function buildResearchPlanPrompt(input = {}) {
    const template = normalizeTemplate(input.template || input.researchType);
    return [
      "你是社媒研究计划整理器，只负责生成计划，不执行搜索。",
      `研究模板：${template}`,
      `模板要求：${TEMPLATE_GUIDANCE[template]}`,
      "输入：",
      safeJson({
        topic: text(input.topic || input.objective || input.goal),
        template,
        platforms: Array.isArray(input.platforms) ? input.platforms : [],
        queries: Array.isArray(input.queries) ? input.queries : [],
        timeRange: input.timeRange || {},
        budget: input.budget || {}
      }),
      "输出 JSON 字段：objective、template、platformRoles、queries、timeRange、budget、stopConditions、evidenceRequirements、unfinishedPlatforms。",
      "platformRoles 必须说明每个平台查什么；queries 必须可直接执行；budget 不得擅自扩大。",
      "unfinishedPlatforms 初始应包含尚未完成的平台；如果没有结果，不得伪造完成状态。",
      "通用约束：",
      commonRules()
    ].join("\n");
  }

  function buildSupplementarySearchPrompt(task = {}, evidenceGap = "") {
    return [
      "你是社媒研究补搜计划整理器，只能在用户已批准的平台和预算内提出补充查询。",
      "当前任务：",
      safeJson({
        taskId: text(task.id),
        topic: text(task.topic),
        template: normalizeTemplate(task.template),
        platforms: Array.isArray(task.platforms) ? task.platforms : [],
        budget: task.budget || {},
        budgetUsage: task.budgetUsage || {},
        status: text(task.status)
      }),
      `证据缺口：${text(evidenceGap)}`,
      "输出 JSON 字段：evidenceGap、supplementaryQueries、platforms、expectedEvidence、budgetImpact、stopConditions。",
      "如果补搜会增加平台、查询、翻页、详情、执行时间或附件预算，输出 needsConfirmation=true，不得直接批准。",
      "每个补搜查询必须说明目标平台和预期证据；不得把没有结果链接的搜索摘要写成事实。",
      "补搜结果必须记录来源和完整链接，便于后续逐条追溯。",
      "通用约束：",
      commonRules()
    ].join("\n");
  }

  function buildResearchReportPrompt(task = {}, results = []) {
    const normalizedResults = Array.isArray(results) ? results.map(result => ({
      id: text(result?.id),
      platform: text(result?.platform),
      title: text(result?.title),
      url: text(result?.url || result?.sourceUrl),
      summary: text(result?.summary),
      publishedAt: text(result?.publishedAt),
      evidenceStatus: text(result?.evidenceStatus),
      retrievalMethod: text(result?.retrievalMethod)
    })) : [];
    return [
      "你是社媒研究报告整理器，只能基于给定结果生成报告，不得补写未提供的来源。",
      "任务：",
      safeJson({
        taskId: text(task.id),
        topic: text(task.topic),
        template: normalizeTemplate(task.template),
        platforms: Array.isArray(task.platforms) ? task.platforms : [],
        status: text(task.status),
        unfinishedPlatforms: Array.isArray(task.incompletePlatforms) ? task.incompletePlatforms : []
      }),
      "结果：",
      safeJson(normalizedResults),
      "输出 JSON 字段：summary、coreFindings、commonPoints、platformDifferences、painPointsOrPatterns、representativeCases、conflicts、needsVerification、unfinishedPlatforms、sourceTrace。",
      "每条 coreFindings、commonPoints、platformDifferences 和 representativeCases 都必须带 resultIds；sourceTrace 必须包含结果 id、平台和完整 URL。",
      "没有 http/https 链接的结果不得支撑结论，只能放入 needsVerification，并说明缺少链接。",
      "报告必须原样列出未完成平台和失败原因；高热度只能作为信号，不能被表述为事实证明。",
      "通用约束：",
      commonRules()
    ].join("\n");
  }

  return { buildResearchPlanPrompt, buildSupplementarySearchPrompt, buildResearchReportPrompt };
});
