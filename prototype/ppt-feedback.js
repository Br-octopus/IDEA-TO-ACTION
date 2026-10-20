(function (root, factory) {
  const schema = typeof module === "object" && module.exports && typeof require === "function" ? require("./ppt-feedback-schema.js") : root.ForwardStepPptFeedbackSchema;
  const api = factory(schema);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPptFeedback = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (schema) {
  function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function makeId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
  function cleanText(value, limit = 1000) { return typeof value === "string" ? value.trim().slice(0, limit) : ""; }
  function normalizePptFeedbackAttachment(input) { return schema.normalizePptFeedbackAttachment(input); }
  function normalizePptAnnotation(input) { return schema.normalizePptAnnotation(input); }
  function createPptAnnotation(input = {}) {
    const source = isObject(input) ? input : {};
    return normalizePptAnnotation({ ...source, id: source.id || makeId("ppt-note"), createdAt: source.createdAt || new Date().toISOString(), status: "active" });
  }
  function markStaleAnnotations(annotations, currentHashes = {}) {
    return (Array.isArray(annotations) ? annotations : []).map(item => {
      const annotation = normalizePptAnnotation(item);
      const hash = currentHashes instanceof Map ? currentHashes.get(annotation.attachmentId) : currentHashes[annotation.attachmentId];
      return { ...annotation, status: hash && hash !== annotation.contentHash ? "stale" : annotation.status };
    });
  }
  function buildSelectedFeedbackContext(annotations, options = {}) {
    const maxItems = boundedInteger(options.maxItems, 40, 1, 200);
    const maxCharacters = boundedInteger(options.maxCharacters, 8000, 1, 50000);
    const selected = (Array.isArray(annotations) ? annotations : []).filter(item => item && item.selected === true && item.status !== "stale").slice(0, maxItems);
    const groups = [];
    let characterCount = 0;
    for (const item of selected) {
      const comment = cleanText(item.comment, 2000);
      if (!comment) continue;
      const remaining = maxCharacters - characterCount;
      if (remaining <= 0) break;
      const keptComment = comment.slice(0, remaining);
      const key = `${item.attachmentId || ""}:${Number.isSafeInteger(item.pageIndex) ? item.pageIndex : 0}`;
      let group = groups.find(candidate => candidate.key === key);
      if (!group) { group = { key, attachmentId: cleanText(item.attachmentId, 100), pageIndex: Number.isSafeInteger(item.pageIndex) ? item.pageIndex : 0, comments: [] }; groups.push(group); }
      group.comments.push({ id: cleanText(item.id, 100), category: cleanText(item.category, 40), comment: keptComment });
      characterCount += keptComment.length;
    }
    return { groups: groups.map(({ key, ...group }) => group), itemCount: groups.reduce((sum, group) => sum + group.comments.length, 0), characterCount };
  }
  function buildPreflightReport(input = {}) {
    const source = isObject(input) ? input : {};
    const attachmentId = cleanText(source.attachmentId, 100);
    const contentHash = cleanText(source.contentHash, 140);
    if (!attachmentId || !contentHash) throw new TypeError("预检报告必须关联附件版本");
    return { id: cleanText(source.id, 100) || makeId("ppt-preflight"), type: "preflight", attachmentId, contentHash, createdAt: cleanText(source.createdAt, 80) || new Date().toISOString(), issues: normalizeIssues(source.issues, "recommended") };
  }
  function buildAcceptanceReport(input = {}) {
    const source = isObject(input) ? input : {};
    const attachmentId = cleanText(source.attachmentId, 100);
    const contentHash = cleanText(source.contentHash, 140);
    if (!attachmentId || !contentHash) throw new TypeError("验收报告必须关联附件版本");
    return { id: cleanText(source.id, 100) || makeId("ppt-acceptance"), type: "acceptance", attachmentId, contentHash, preflightReportId: cleanText(source.preflightReportId, 100), createdAt: cleanText(source.createdAt, 80) || new Date().toISOString(), criteria: { general: normalizeTextList(source.generalCriteria), taskSpecific: normalizeTextList(source.taskCriteria) }, issues: normalizeIssues(source.issues, "recommended") };
  }
  function normalizeIssues(items, fallback) {
    const groups = { mustFix: [], recommended: [], acceptable: [] };
    const severityMap = { "must-fix": "mustFix", recommended: "recommended", acceptable: "acceptable", "必须修复": "mustFix", "建议优化": "recommended", "可接受差异": "acceptable" };
    for (const item of Array.isArray(items) ? items.slice(0, 200) : []) {
      const source = isObject(item) ? item : { message: item };
      const group = severityMap[source.severity] || severityMap[fallback] || "recommended";
      const message = cleanText(source.message, 1000);
      if (message) groups[group].push({ message, pageIndex: Number.isSafeInteger(source.pageIndex) && source.pageIndex >= 0 ? source.pageIndex : null, basis: cleanText(source.basis, 500) });
    }
    return groups;
  }
  function normalizeTextList(value) { return Array.isArray(value) ? value.slice(0, 100).map(item => cleanText(item, 500)).filter(Boolean) : []; }
  function boundedInteger(value, fallback, minimum, maximum) { const number = Number(value); return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback; }
  return { normalizePptFeedbackAttachment, normalizePptAnnotation, createPptAnnotation, markStaleAnnotations, buildSelectedFeedbackContext, buildPreflightReport, buildAcceptanceReport };
});
