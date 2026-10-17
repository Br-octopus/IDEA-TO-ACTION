(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./knowledge-schema.js")
      : root.ForwardStepKnowledgeSchema,
    typeof module === "object" && module.exports
      ? require("./research-catalog.js")
      : root.ForwardStepResearchCatalog,
    typeof module === "object" && module.exports
      ? require("./method-cards.js")
      : root.ForwardStepMethodCards
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepKnowledgeSearch = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (knowledgeSchema, researchCatalog, methodCardsApi) {
  function fromReference(reference = {}) {
    return researchCatalog.toKnowledgeEntry(reference);
  }

  function fromMethodCard(card = {}) {
    if (methodCardsApi && typeof methodCardsApi.methodCardsToKnowledgeEntries === "function") {
      return methodCardsApi.methodCardsToKnowledgeEntries([card])[0];
    }
    return knowledgeSchema.normalizeKnowledgeEntry({
      id: card.id,
      type: "method-card",
      title: card.title || card.name,
      domains: card.domains || card.domain,
      stages: card.stages,
      keywords: card.checks || card.keywords,
      summary: card.description || card.guidance,
      reusablePatterns: card.guidance,
      verificationStatus: "source-reviewed",
      sourceType: "内置方法卡"
    });
  }

  function fromPrompt(prompt = {}) {
    return knowledgeSchema.normalizeKnowledgeEntry({
      id: prompt.id,
      type: "user-prompt",
      title: prompt.title,
      domains: prompt.domains || prompt.domain,
      stages: prompt.stages,
      keywords: prompt.keywords,
      summary: prompt.note || "用户保存的提示词版本",
      reusablePatterns: prompt.note,
      contentExcerpt: String(prompt.text || "").slice(0, 240),
      verificationStatus: prompt.verified ? "user-confirmed" : "unverified",
      sourceType: "用户提示词"
    });
  }

  function fromCase(reviewedCase = {}) {
    const type = reviewedCase.status === "成功"
      ? "success-case"
      : reviewedCase.status === "失败" ? "failure-case" : "review-insight";
    return knowledgeSchema.normalizeKnowledgeEntry({
      id: reviewedCase.id,
      type,
      title: `${reviewedCase.taskType || "任务"}复盘`,
      domains: reviewedCase.domain,
      keywords: reviewedCase.dimensions,
      summary: reviewedCase.goal,
      reusablePatterns: reviewedCase.lessons,
      limitations: reviewedCase.evidence,
      contentExcerpt: reviewedCase.nextPrompt,
      linkedCaseId: reviewedCase.id,
      verificationStatus: reviewedCase.status === "待验证" ? "unverified" : "user-confirmed",
      sourceType: "用户确认案例"
    });
  }

  function collectKnowledgeEntries(state = {}, { references = [], methodCards = [] } = {}) {
    const entries = [
      ...references.map(fromReference),
      ...methodCards.map(fromMethodCard),
      ...(Array.isArray(state.knowledgeEntries)
        ? state.knowledgeEntries.map(entry => knowledgeSchema.normalizeKnowledgeEntry(entry))
        : []),
      ...(Array.isArray(state.prompts) ? state.prompts.map(fromPrompt) : []),
      ...(Array.isArray(state.cases)
        ? state.cases.filter(item => item && item.confirmed === true).map(fromCase)
        : [])
    ].filter(item => item.id);

    const byId = new Map();
    for (const item of entries) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return [...byId.values()];
  }

  return { collectKnowledgeEntries };
});
