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
    ACADEMIC_LITERATURE: "academic-literature",
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

  const LITERATURE_METADATA_STATES = Object.freeze(["unverified", "registry-returned", "user-verified"]);
  const LITERATURE_READING_STATES = Object.freeze([
    "unread", "title-only", "abstract-only", "excerpt-only", "full-text-user-confirmed"
  ]);
  const LITERATURE_CLAIM_RELATIONS = Object.freeze(["unassessed", "supports", "does-not-support", "contradicts", "insufficient"]);

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

  function normalizeLiteratureMetadata(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const metadataStatus = LITERATURE_METADATA_STATES.includes(source.metadataStatus) ? source.metadataStatus : "unverified";
    const readingStatus = LITERATURE_READING_STATES.includes(source.readingStatus) ? source.readingStatus : "unread";
    const abstractExcerpt = String(source.abstractExcerpt || "").trim();
    if (abstractExcerpt.length > 1200) throw new RangeError("用户摘要或摘录最多 1200 字，请先缩短内容再保存。");
    const claimRelations = (Array.isArray(source.claimRelations) ? source.claimRelations : []).map(item => {
      const relation = item && typeof item === "object" ? item : {};
      const status = LITERATURE_CLAIM_RELATIONS.includes(relation.relation) ? relation.relation : "unassessed";
      const record = {
        claim: String(relation.claim || "").trim(),
        relation: status,
        location: String(relation.location || "").trim(),
        rationale: String(relation.rationale || "").trim()
      };
      return status !== "unassessed" && record.claim && record.location && record.rationale ? record : null;
    }).filter(Boolean);
    const doi = String(source.doi || "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/[.,;\s]+$/g, "").toLowerCase();
    return {
      authors: listValue(source.authors), year: String(source.year || "").trim(),
      publication: String(source.publication || "").trim(), volume: String(source.volume || "").trim(),
      issue: String(source.issue || "").trim(), pages: String(source.pages || "").trim(), doi,
      pmid: String(source.pmid || "").trim(), itemType: String(source.itemType || "").trim(),
      metadataProvider: String(source.metadataProvider || "").trim(), queriedAt: String(source.queriedAt || "").trim(),
      metadataStatus, readingStatus, abstractExcerpt, excerptLocation: String(source.excerptLocation || "").trim(), claimRelations
    };
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
    const entry = {
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
    if (type === KNOWLEDGE_TYPES.ACADEMIC_LITERATURE) entry.literature = normalizeLiteratureMetadata(source.literature);
    return entry;
  }

  return {
    KNOWLEDGE_TYPES, VERIFICATION_STATES, LITERATURE_METADATA_STATES,
    LITERATURE_READING_STATES, LITERATURE_CLAIM_RELATIONS,
    normalizeLiteratureMetadata, normalizeKnowledgeEntry
  };
});
