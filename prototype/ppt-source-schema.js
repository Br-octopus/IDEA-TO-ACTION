(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPptSourceSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const SOURCE_KINDS = new Set([
    "github", "web", "video", "image", "pdf", "ppt", "pptx", "local-file", "local-directory"
  ]);
  const SOURCE_STATUSES = new Set([
    "queued", "reading", "partial", "complete", "unavailable", "unsupported", "failed"
  ]);
  const MATERIAL_ROLES = new Set(["content", "style", "both", "irrelevant"]);
  const PAGE_DISPOSITIONS = new Set(["include", "exclude", "uncertain"]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function text(value, limit = 2000) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
  }

  function range(value) {
    if (!isObject(value)) return null;
    const result = {};
    for (const key of ["start", "end"]) {
      const item = value[key];
      if (typeof item === "string" || (typeof item === "number" && Number.isFinite(item))) result[key] = item;
    }
    return Object.keys(result).length ? result : null;
  }

  function textList(value, limit = 100) {
    if (typeof value === "string") return value.trim() ? [value.trim().slice(0, 2000)] : [];
    if (!Array.isArray(value)) return [];
    return value.slice(0, limit).map(item => text(item)).filter(Boolean);
  }

  function normalizeFailure(item) {
    if (typeof item === "string") return { item: "", reason: text(item) };
    if (!isObject(item)) return null;
    const normalized = { item: text(item.item || item.name || item.page, 300), reason: text(item.reason || item.error) };
    return normalized.item || normalized.reason ? normalized : null;
  }

  function normalizePptPageResult(input = {}) {
    if (!isObject(input)) throw new TypeError("PPT 页面结果必须是对象");
    const page = Number(input.page);
    const disposition = PAGE_DISPOSITIONS.has(input.disposition) ? input.disposition : "uncertain";
    return {
      page: Number.isSafeInteger(page) && page > 0 ? page : null,
      title: text(input.title, 300),
      content: text(input.content || input.excerpt || input.readableContent),
      visualFeatures: textList(input.visualFeatures, 30),
      role: MATERIAL_ROLES.has(input.role) ? input.role : null,
      disposition,
      recoverable: input.recoverable !== false,
      reason: text(input.reason, 1000)
    };
  }

  function buildPptQualityReport(input = {}) {
    if (!isObject(input)) throw new TypeError("PPT 质量报告输入必须是对象");
    const failures = Array.isArray(input.failedItems) ? input.failedItems : [];
    const failedItems = failures.slice(0, 100).map(normalizeFailure).filter(Boolean);
    if (input.status === "failed" && failedItems.length === 0) {
      failedItems.push({ item: "", reason: text(input.error) || "解析失败" });
    }
    const visualInput = isObject(input.representativeVisualCheck) ? input.representativeVisualCheck : {};
    const visual = {
      status: ["checked", "failed", "not-checked", "not-applicable"].includes(visualInput.status)
        ? visualInput.status : "not-checked",
      pages: Array.isArray(visualInput.pages)
        ? visualInput.pages.slice(0, 100).filter(page => Number.isSafeInteger(page) && page > 0)
        : []
    };
    const visualError = text(visualInput.error, 1000);
    if (visualError) visual.error = visualError;
    return {
      readableContent: text(input.readableContent || input.content || input.transcript),
      processedRange: range(input.processedRange),
      failedItems,
      representativeVisualCheck: visual,
      unprocessedRange: range(input.unprocessedRange)
    };
  }

  function normalizePptSourceResult(input = {}) {
    if (!isObject(input)) throw new TypeError("PPT 来源结果必须是对象");
    const kind = text(input.kind || input.type, 80);
    if (!SOURCE_KINDS.has(kind)) throw new TypeError("来源类型无效：" + kind);
    const status = input.status === undefined ? "queued" : input.status;
    if (!SOURCE_STATUSES.has(status)) throw new TypeError("来源状态无效：" + status);
    if (status === "failed") {
      if (!text(input.error, 2000) && !text(input.errorCode, 200)) {
        throw new TypeError("失败状态必须提供非空 error 或 errorCode 作为失败原因");
      }
      if (!range(input.unprocessedRange)) {
        throw new TypeError("失败状态必须提供 unprocessedRange 未处理范围");
      }
    }

    const id = text(input.id || input.sourceId || input.url || input.path, 300);
    const evidenceType = text(input.evidenceType, 100) || "unknown";
    const sourceType = text(input.sourceType, 100) || "unknown";
    let verificationStatus = text(input.verificationStatus, 100);
    if (evidenceType === "project-self-report") verificationStatus = "source-claimed";
    else if (!verificationStatus) {
      verificationStatus = evidenceType === "public-example" ? "public-example"
        : evidenceType === "user-confirmed-experience" || sourceType === "user-confirmed-experience" || sourceType === "user-review"
          ? "user-confirmed" : "unverified";
    }

    const result = {
      id,
      sourceId: text(input.sourceId || id, 300),
      title: text(input.title || input.name || input.url || id, 300),
      url: text(input.url, 2000),
      path: text(input.path, 2000),
      kind,
      status,
      role: MATERIAL_ROLES.has(input.role) ? input.role : MATERIAL_ROLES.has(input.purpose) ? input.purpose : "content",
      summary: text(input.summary, 2000),
      readableContent: text(input.readableContent || input.content || input.transcript),
      visualFeatures: textList(input.visualFeatures, 100),
      transcript: text(input.transcript),
      transcriptRange: range(input.transcriptRange),
      keyframeRange: range(input.keyframeRange),
      pages: Array.isArray(input.pages) ? input.pages.slice(0, 500).map(normalizePptPageResult) : [],
      allowedFiles: textList(input.allowedFiles, 1000),
      skippedCount: Number.isSafeInteger(input.skippedCount) && input.skippedCount >= 0 ? input.skippedCount : 0,
      processedRange: range(input.processedRange),
      unprocessedRange: range(input.unprocessedRange),
      errorCode: text(input.errorCode, 200),
      error: text(input.error, 2000),
      evidenceType,
      sourceType,
      verificationStatus,
      license: text(input.license, 300) || "unknown",
      limitations: text(input.limitations, 2000)
    };
    result.qualityReport = buildPptQualityReport({
      ...input,
      status,
      readableContent: result.readableContent,
      processedRange: result.processedRange,
      unprocessedRange: result.unprocessedRange,
      error: result.error
    });
    return result;
  }

  return { normalizePptSourceResult, buildPptQualityReport, normalizePptPageResult };
});
