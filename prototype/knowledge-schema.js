(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepKnowledgeSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const KNOWLEDGE_TYPES = Object.freeze({
    PROMPT_EXAMPLE: "prompt-example",
    USER_PROMPT: "user-prompt",
    SUCCESS_CASE: "success-case",
    FAILURE_CASE: "failure-case",
    REVIEW_INSIGHT: "review-insight",
    METHOD_CARD: "method-card",
    GITHUB_SUMMARY: "github-summary",
    ARTICLE_SUMMARY: "article-summary",
    MANUAL_NOTE: "manual-note"
  });

  const VERIFICATION_STATES = Object.freeze({
    UNVERIFIED: "unverified",
    SOURCE_REVIEWED: "source-reviewed",
    USER_CONFIRMED: "user-confirmed"
  });

  const SOURCE_KINDS = Object.freeze([
    "manual", "prompt", "case", "method-card", "reference"
  ]);

  function listValue(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    return String(value || "").split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
  }

  function normalizeUserRating(value) {
    if (value === null || value === undefined || typeof value === "boolean") return null;
    if (typeof value === "string" && !value.trim()) return null;
    if (typeof value !== "number" && typeof value !== "string") return null;
    const rating = Number(value);
    if (!Number.isFinite(rating)) return null;
    return Math.min(5, Math.max(1, rating));
  }

  function normalizeKnowledgeEntry(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const type = Object.values(KNOWLEDGE_TYPES).includes(source.type)
      ? source.type
      : KNOWLEDGE_TYPES.MANUAL_NOTE;
    const sourceKind = SOURCE_KINDS.includes(source.sourceKind) ? source.sourceKind : "manual";
    const verificationStatus = Object.values(VERIFICATION_STATES).includes(source.verificationStatus)
      ? source.verificationStatus
      : VERIFICATION_STATES.UNVERIFIED;
    const now = new Date().toISOString();
    return {
      id: String(source.id || "").trim(),
      type,
      title: String(source.title || "").trim(),
      sourceUrl: String(source.sourceUrl || source.url || "").trim(),
      sourceType: String(source.sourceType || "用户添加").trim(),
      sourceKind,
      sourceId: String(source.sourceId || "").trim(),
      hiddenAt: String(source.hiddenAt || "").trim(),
      favorite: source.favorite === true,
      pinned: source.pinned === true,
      lastUsedAt: String(source.lastUsedAt || "").trim(),
      customAliases: listValue(source.customAliases),
      domains: listValue(source.domains),
      stages: listValue(source.stages),
      keywords: listValue(source.keywords),
      summary: String(source.summary || "").trim(),
      reusablePatterns: String(source.reusablePatterns || "").trim(),
      limitations: String(source.limitations || "").trim(),
      licenseNote: String(source.licenseNote || "").trim(),
      verificationStatus,
      userRating: normalizeUserRating(source.userRating),
      applicableCases: listValue(source.applicableCases),
      contentExcerpt: String(source.contentExcerpt || "").trim(),
      linkedProjectId: String(source.linkedProjectId || "").trim(),
      linkedCaseId: String(source.linkedCaseId || "").trim(),
      createdAt: String(source.createdAt || now),
      updatedAt: String(source.updatedAt || now)
    };
  }

  return { KNOWLEDGE_TYPES, VERIFICATION_STATES, normalizeKnowledgeEntry };
});
