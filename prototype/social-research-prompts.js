(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepSocialResearchPrompts = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const TEMPLATES = {
    trends: '趋势与热点：关注时间范围、讨论频率和平台差异；热度只能表示传播或互动，不能证明事实。',
    'pain-points': '用户痛点与口碑：识别真实体验、抱怨、失败经历及重复问题；区分个案、共性与推测。',
    'content-competitors': '内容与竞品研究：分析标题、结构、卖点、评论反馈和平台差异；概括模式，不复刻原文。',
    'fact-check': '事实与方案核查：跨来源寻找支持与反对证据，区分事实、观点、营销表达和推断，并标出冲突。'
  };

  function serialize(value) {
    return JSON.stringify(value || {}, null, 2);
  }

  function requirements() {
    return [
      '请输出严格 JSON，或使用带固定字段名的明确可解析区块；不得输出无法解析的散文。',
      '热度、点赞数、转发数和推荐位置不等于事实或可靠性。',
      '必须明确列出未完成平台、失败平台或未覆盖平台，不得隐藏研究缺口。',
      '结论应回链到真实原始结果或材料；不得编造来源链接或标识。',
      '报告只能引用输入中提供的 resultId 和 materialId，不得编造标识。',
      '每条核心发现使用 citations 数组回链，字段为 findingIndex、resultId、materialId；resultId 必须是该材料所属结果。',
      '仅搜索摘要可用时保留 resultIds；只有提供了材料时才填写 materialId。',
      '区分事实、用户观点、营销表达、推断和待核验事项，不足以判断时明确写明。'
    ].join('\n');
  }

  function buildResearchPlanPrompt(input = {}) {
    const template = TEMPLATES[input.template] || '用户痛点与口碑：区分个案、共性与未经证实的推测。';
    return `为以下研究目标生成可执行计划。\n模板要求：${template}\n${requirements()}\n计划 JSON 字段：objective、researchType、platformRoles、queries、timeRange、region、audience、filters、expectedResultCount、evidenceRequirements、budget、stopConditions。\n输入：\n${serialize(input)}`;
  }

  function buildSupplementarySearchPrompt(task = {}, evidenceGap = '') {
    return `根据当前任务的证据缺口提出最小补搜方案。只能使用已批准的平台、查询数和其他剩余预算，不得扩大时间/地区范围。\n${requirements()}\n输出 JSON 字段：reason、platform、queries、expectedEvidence、budgetUsage。\n证据缺口：${String(evidenceGap || '')}\n当前任务：\n${serialize(task)}`;
  }

  function buildResearchReportPrompt(task = {}, results = []) {
    const template = TEMPLATES[(task.plan && task.plan.researchType) || task.template] || TEMPLATES['pain-points'];
    return `依据研究结果撰写报告。模板分析重点：${template}\n${requirements()}\n报告 JSON 字段：summary、coreFindings、commonPoints、platformDifferences、painPointsOrPatterns、representativeCases、conflicts、needsVerification、nextSteps、resultIds、sourceUrls、citations、incompletePlatforms。citations 中 findingIndex 从 0 开始并对应 coreFindings；只引用真实已完成材料。\n任务与可用材料：\n${serialize(task)}\n搜索结果：\n${serialize(results)}`;
  }

  return { buildResearchPlanPrompt, buildSupplementarySearchPrompt, buildResearchReportPrompt };
});
