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

  const DOMESTIC_PLATFORM_GUIDANCE = {
    xiaohongshu: '小红书：根据研究目标选择自然的中文搜索词；可按需考虑“真实体验、踩坑、避雷、吐槽、求推荐、复购”等表达，不要把词表机械拼成查询。',
    bilibili: '哔哩哔哩：根据研究目标选择中文搜索词；可按需考虑“测评、实测、横评、体验、教程、优缺点”等视频标题表达。首期只采集搜索结果元数据和摘要，不假设已读取视频字幕、评论或弹幕。',
    weibo: '微博：按研究对象组合具体关键词与“体验、吐槽、投诉、售后、对比、复购”等用户表达；可拆分不同说法分别检索，避免把热搜排名当作代表性结论。',
    zhihu: '知乎：优先使用问题式中文查询，例如“关键词 + 怎么样/值得买吗/使用体验/优缺点/原理/避坑/替代方案”；按研究目标分别寻找经验、解释和反例。'
  };

  function serialize(value) {
    return JSON.stringify(value || {}, null, 2);
  }

  function requirements() {
    return [
      '请输出严格 JSON，或使用带固定字段名的明确可解析区块；不得输出无法解析的散文。',
      '本轮只研究输入中已选的国内社媒平台；platformRoles.platform 只能使用输入中已选的平台，不能新增或替换平台。',
      '每个平台的查询词数量不得超过 budget.maxQueriesPerPlatform；查询必须能解释与研究目标的关联，不要只靠堆砌热词扩大结果。',
      '热度、点赞数、转发数和推荐位置不等于事实或可靠性。',
      '必须明确列出未完成平台、失败平台或未覆盖平台，不得隐藏研究缺口。',
      '每条发现和结论都必须附至少一个对应结果的原始 URL；没有链接的结论不得输出。',
      '区分事实、用户观点、营销表达、推断和待核验事项，不足以判断时明确写明。',
      '只能基于本次实际采集到的标题、作者、发布时间、摘要和公开指标分析；未采集到的评论、字幕、弹幕和正文不得当作证据。'
    ].join('\n');
  }

  function platformGuidance(platforms) {
    const selected = Array.isArray(platforms) ? [...new Set(platforms.map(value => String(value || '').trim().toLowerCase()).filter(Boolean))] : [];
    return selected.map(platform => DOMESTIC_PLATFORM_GUIDANCE[platform] || `${platform}：按已声明的平台能力设计查询，不推断未支持的采集能力。`).join('\n');
  }

  function buildResearchPlanPrompt(input = {}) {
    const template = TEMPLATES[input.template] || '用户痛点与口碑：区分个案、共性与未经证实的推测。';
    return `为以下研究目标生成可执行计划。\n模板要求：${template}\n国内平台检索建议：\n${platformGuidance(input.platforms)}\n${requirements()}\n计划 JSON 字段：objective、researchType、platformRoles、queries、timeRange、region、audience、filters、expectedResultCount、evidenceRequirements、budget、stopConditions。\n输入：\n${serialize(input)}`;
  }

  function buildSupplementarySearchPrompt(task = {}, evidenceGap = '') {
    return `根据当前任务的证据缺口提出最小补搜方案。只能使用已批准的平台、查询数和其他剩余预算，不得扩大时间/地区范围。\n${requirements()}\n输出 JSON 字段：reason、platform、queries、expectedEvidence、budgetUsage。\n证据缺口：${String(evidenceGap || '')}\n当前任务：\n${serialize(task)}`;
  }

  function buildResearchReportPrompt(task = {}, results = []) {
    const template = TEMPLATES[(task.plan && task.plan.researchType) || task.template] || TEMPLATES['pain-points'];
    return `依据研究结果撰写报告。模板分析重点：${template}\n${requirements()}\n报告 JSON 字段：summary、coreFindings、commonPoints、platformDifferences、painPointsOrPatterns、representativeCases、conflicts、needsVerification、nextSteps、resultIds、incompletePlatforms。每条 coreFindings 必须包含 finding、resultIds、sourceUrls。\n任务：\n${serialize(task)}\n结果：\n${serialize(results)}`;
  }

  return { buildResearchPlanPrompt, buildSupplementarySearchPrompt, buildResearchReportPrompt, platformGuidance };
});
