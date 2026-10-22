(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPptFeedbackSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const MIME_EXTENSIONS = Object.freeze({
    "text/html": new Set([".html", ".htm"]),
    "image/png": new Set([".png"]),
    "image/jpeg": new Set([".jpg", ".jpeg"]),
    "image/webp": new Set([".webp"]),
    "image/gif": new Set([".gif"])
  });
  const SOURCE_TYPES = new Set(["file", "folder", "url", "current-browser-page"]);
  const CATEGORIES = new Set(["content", "logic", "evidence", "style", "layout", "format", "readability", "other"]);

  function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function text(value, limit) { return typeof value === "string" ? value.trim().slice(0, limit) : ""; }
  function bounded(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError("标注坐标必须是有限数字");
    return Math.max(0, Math.min(1, number));
  }
  function safeId(value, label) {
    const result = text(value, 100);
    if (!result) throw new TypeError(`${label}不能为空`);
    return result;
  }
  function normalizePptFeedbackAttachment(input = {}) {
    const source = isObject(input) ? input : {};
    const id = safeId(source.id, "附件 id");
    const mimeType = text(source.mimeType, 80).toLowerCase();
    const extension = `.${text(source.extension, 12).replace(/^\./, "").toLowerCase()}`;
    if (!Object.hasOwn(MIME_EXTENSIONS, mimeType)) throw new TypeError("附件 MIME 不在白名单");
    if (!MIME_EXTENSIONS[mimeType].has(extension)) throw new TypeError("附件扩展名与 MIME 不匹配");
    const sourceType = SOURCE_TYPES.has(source.sourceType) ? source.sourceType : "";
    if (!sourceType) throw new TypeError("附件来源类型无效");
    const contentHash = text(source.contentHash, 140);
    if (!contentHash) throw new TypeError("附件 contentHash 不能为空");
    const normalized = { id, taskId: text(source.taskId, 100), sourceType, mimeType, extension, contentHash };
    return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== ""));
  }

  function normalizePptAnnotation(input = {}) {
    const source = isObject(input) ? input : {};
    const targetSource = isObject(source.target) ? source.target : {};
    const kind = ["element", "point", "region"].includes(targetSource.kind) ? targetSource.kind : "";
    if (!kind) throw new TypeError("标注定位类型无效");
    let target;
    if (kind === "element") {
      const selector = text(targetSource.selector, 500);
      if (!selector || typeof targetSource.selector === "string" && targetSource.selector.length > 500) throw new TypeError("HTML selector 无效或超长");
      target = { kind, selector };
    } else if (kind === "point") {
      target = { kind, x: bounded(targetSource.x), y: bounded(targetSource.y) };
    } else {
      const x = bounded(targetSource.x);
      const y = bounded(targetSource.y);
      const right = bounded(Number(targetSource.x) + Number(targetSource.width));
      const bottom = bounded(Number(targetSource.y) + Number(targetSource.height));
      if (!Number.isFinite(Number(targetSource.width)) || !Number.isFinite(Number(targetSource.height)) || right <= x || bottom <= y) throw new TypeError("标注区域尺寸无效");
      target = { kind, x, y, width: right - x, height: bottom - y };
    }
    const comment = typeof source.comment === "string" ? source.comment.trim() : "";
    if (!comment || comment.length > 2000) throw new TypeError("标注评论不能为空或超长");
    const category = source.category === undefined ? "other" : source.category;
    if (!CATEGORIES.has(category)) throw new TypeError("标注分类无效");
    const pageIndex = source.pageIndex === undefined ? 0 : Number(source.pageIndex);
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new TypeError("标注页码无效");
    const contentHash = text(source.contentHash, 140);
    if (!contentHash) throw new TypeError("标注 contentHash 不能为空");
    const status = source.status === undefined ? "active" : source.status;
    if (!["active", "stale"].includes(status)) throw new TypeError("标注状态无效");
    const normalized = { id: text(source.id, 100), taskId: text(source.taskId, 100), attachmentId: text(source.attachmentId, 100), contentHash, pageIndex, target, comment, category, createdAt: text(source.createdAt, 80), status, selected: source.selected === true };
    return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== ""));
  }

  function normalizePptFeedbackState(input = {}) {
    const source = isObject(input) ? input : {};
    const attachments = Array.isArray(source.attachments) ? source.attachments.slice(0, 200).map(normalizePptFeedbackAttachment) : [];
    const annotations = Array.isArray(source.annotations) ? source.annotations.slice(0, 2000).map(normalizePptAnnotation) : [];
    const reports = Array.isArray(source.reports) ? source.reports.slice(0, 100).map(item => {
      const report = isObject(item) ? item : {};
      const result = { id: text(report.id, 100), type: ["preflight", "acceptance"].includes(report.type) ? report.type : "", attachmentId: text(report.attachmentId, 100), contentHash: text(report.contentHash, 140), preflightReportId: text(report.preflightReportId, 100), createdAt: text(report.createdAt, 80) };
      return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== ""));
    }).filter(report => report.id && report.type && report.attachmentId && report.contentHash) : [];
    return { attachments, annotations, reports };
  }

  return { normalizePptFeedbackAttachment, normalizePptAnnotation, normalizePptFeedbackState };
});
