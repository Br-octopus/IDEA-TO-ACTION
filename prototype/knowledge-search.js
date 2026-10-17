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
  function prefixId(prefix, id) {
    const sourceId = String(id || "").trim();
    if (!sourceId) return "";
    return sourceId.startsWith(prefix) ? sourceId : `${prefix}${sourceId}`;
  }

  function fromReference(reference = {}) {
    return researchCatalog.toKnowledgeEntry(reference);
  }

  function fromMethodCard(card = {}) {
    if (!methodCardsApi || typeof methodCardsApi.methodCardsToKnowledgeEntries !== "function") {
      throw new TypeError("方法卡转换器不可用");
    }
    return methodCardsApi.methodCardsToKnowledgeEntries([card])[0];
  }

  function fromPrompt(prompt = {}) {
    return knowledgeSchema.normalizeKnowledgeEntry({
      id: prefixId("prompt-", prompt.id),
      type: "user-prompt",
      title: prompt.title,
      domains: prompt.domains || prompt.domain,
      stages: prompt.stages,
      keywords: prompt.keywords,
      summary: prompt.note || "用户保存的提示词版本",
      reusablePatterns: prompt.note,
      contentExcerpt: String(prompt.text || "").slice(0, 240),
      verificationStatus: prompt.verified === true ? "user-confirmed" : "unverified",
      sourceType: "用户提示词"
    });
  }

  function fromCase(reviewedCase = {}) {
    const type = reviewedCase.status === "成功"
      ? "success-case"
      : reviewedCase.status === "失败" ? "failure-case" : "review-insight";
    return knowledgeSchema.normalizeKnowledgeEntry({
      id: prefixId("case-", reviewedCase.id),
      type,
      title: `${reviewedCase.taskType || "任务"}复盘`,
      domains: reviewedCase.domain,
      keywords: reviewedCase.dimensions,
      summary: reviewedCase.goal,
      reusablePatterns: reviewedCase.lessons,
      limitations: reviewedCase.evidence,
      contentExcerpt: String(reviewedCase.nextPrompt || "").slice(0, 240),
      linkedCaseId: reviewedCase.id,
      verificationStatus: reviewedCase.status === "待验证" ? "unverified" : "user-confirmed",
      sourceType: "用户确认案例"
    });
  }

  function normalizeSourceUrl(value) {
    const sourceUrl = String(value || "").trim();
    if (!sourceUrl) return "";
    try {
      const url = new URL(sourceUrl);
      url.hash = "";
      return url.toString();
    } catch {
      return sourceUrl;
    }
  }

  function getEntryKey(source, entry) {
    const sourceUrl = normalizeSourceUrl(entry.sourceUrl);
    if (source === "reference") {
      return sourceUrl
        ? [source, entry.id, sourceUrl].join("\u001f")
        : [source, entry.id].join("\u001f");
    }
    const origin = sourceUrl
      ? `url:${sourceUrl}`
      : `source-type:${String(entry.sourceType || source).trim()}`;
    return [source, entry.id, origin].join("\u001f");
  }

  function collectKnowledgeEntries(state = {}, { references = [], methodCards = [] } = {}) {
    const entries = [
      ...references.map(reference => ({ source: "reference", entry: fromReference(reference) })),
      ...methodCards.map(card => ({ source: "method-card", entry: fromMethodCard(card) })),
      ...(Array.isArray(state.knowledgeEntries)
        ? state.knowledgeEntries.map(entry => ({
          source: "knowledge-entry",
          entry: knowledgeSchema.normalizeKnowledgeEntry(entry)
        }))
        : []),
      ...(Array.isArray(state.prompts)
        ? state.prompts.map(prompt => ({ source: "prompt", entry: fromPrompt(prompt) }))
        : []),
      ...(Array.isArray(state.cases)
        ? state.cases
          .filter(item => item && item.confirmed === true)
          .map(reviewedCase => ({ source: "case", entry: fromCase(reviewedCase) }))
        : [])
    ].filter(item => item.entry.id);

    const byId = new Map();
    for (const item of entries) {
      const key = getEntryKey(item.source, item.entry);
      if (!byId.has(key)) byId.set(key, item.entry);
    }
    return [...byId.values()];
  }

  return { collectKnowledgeEntries };
});
