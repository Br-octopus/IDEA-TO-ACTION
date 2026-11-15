(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPptFeedbackSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const MIME_EXTENSIONS = Object.freeze({
    "text/html": new Set([".html", ".htm"]),
    "application/pdf": new Set([".pdf"]),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": new Set([".pptx"]),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": new Set([".docx"]),
    "image/png": new Set([".png"]),
    "image/jpeg": new Set([".jpg", ".jpeg"]),
    "image/webp": new Set([".webp"]),
    "image/gif": new Set([".gif"])
  });
  const SOURCE_TYPES = new Set(["file", "folder", "url", "current-browser-page"]);
  const CATEGORIES = new Set(["content", "logic", "evidence", "style", "layout", "format", "readability", "other"]);
  const ANNOTATION_INTENTS = new Set(["modify", "add", "remove", "keep", "question", "verify"]);

  function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function text(value, limit) { return typeof value === "string" ? value.trim().slice(0, limit) : ""; }
  function bounded(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError("标注坐标必须是有限数字");
    return Math.max(0, Math.min(1, number));
  }
  function normalizeAnnotationSource(value) {
    if (!isObject(value)) throw new TypeError("网页来源版本无效");
    let url;
    try {
      if (typeof value.url !== "string" || value.url.length > 2048) throw new Error('invalid URL');
      url = new URL(value.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid URL');
      url.search = '';
      url.hash = '';
    } catch { throw new TypeError("网页来源网址无效"); }
    const fetchedAt = text(value.fetchedAt, 80);
    const contentHash = text(value.contentHash, 80);
    if (!fetchedAt || !Number.isFinite(Date.parse(fetchedAt)) || !/^sha256:[a-f0-9]{64}$/i.test(contentHash)) {
      throw new TypeError("网页来源版本无效");
    }
    return { url: url.href, fetchedAt, contentHash };
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
    const kind = ["element", "text", "point", "region", "arrow", "path"].includes(targetSource.kind) ? targetSource.kind : "";
    if (!kind) throw new TypeError("标注定位类型无效");
    let target;
    if (kind === "element") {
      const selector = text(targetSource.selector, 500);
      if (!selector || typeof targetSource.selector === "string" && targetSource.selector.length > 500) throw new TypeError("HTML selector 无效或超长");
      const excerpt = text(targetSource.excerpt, 500);
      if (typeof targetSource.excerpt === "string" && targetSource.excerpt.length > 500) throw new TypeError("HTML 摘录超长");
      const source = targetSource.source === undefined ? null : normalizeAnnotationSource(targetSource.source);
      let bounds;
      if (targetSource.bounds !== undefined) {
        const input = isObject(targetSource.bounds) ? targetSource.bounds : {};
        const x = Number(input.x);
        const y = Number(input.y);
        const width = Number(input.width);
        const height = Number(input.height);
        const rotation = input.rotation === undefined ? 0 : Number(input.rotation);
        if (![x, y, width, height, rotation].every(Number.isFinite)
          || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1
          || Math.abs(rotation) > 360) {
          throw new TypeError("元素批注坐标无效");
        }
        bounds = { x, y, width, height, ...(rotation ? { rotation } : {}) };
      }
      target = { kind, selector, excerpt, ...(source ? { source } : {}), ...(bounds ? { bounds } : {}) };
    } else if (kind === "text") {
      const selector = text(targetSource.selector, 500);
      const exact = text(targetSource.exact, 2000);
      if (!selector || typeof targetSource.selector === "string" && targetSource.selector.length > 500) throw new TypeError("文字锚点 selector 无效或超长");
      if (!exact || typeof targetSource.exact === "string" && targetSource.exact.length > 2000) throw new TypeError("文字锚点原文无效或超长");
      const prefix = typeof targetSource.prefix === "string" ? targetSource.prefix : "";
      const suffix = typeof targetSource.suffix === "string" ? targetSource.suffix : "";
      if (typeof targetSource.prefix === "string" && targetSource.prefix.length > 120 || typeof targetSource.suffix === "string" && targetSource.suffix.length > 120) throw new TypeError("文字锚点上下文超长");
      const hasPosition = targetSource.start !== undefined || targetSource.end !== undefined;
      if (hasPosition && (!Number.isSafeInteger(targetSource.start) || !Number.isSafeInteger(targetSource.end)
        || targetSource.start < 0 || targetSource.end <= targetSource.start
        || targetSource.end - targetSource.start !== Array.from(exact).length)) throw new TypeError("文字锚点位置无效");
      const source = targetSource.source === undefined ? null : normalizeAnnotationSource(targetSource.source);
      target = { kind, selector, exact, prefix, suffix, ...(hasPosition ? { start: targetSource.start, end: targetSource.end } : {}), ...(source ? { source } : {}) };
    } else if (kind === "arrow") {
      const x1 = bounded(targetSource.x1);
      const y1 = bounded(targetSource.y1);
      const x2 = bounded(targetSource.x2);
      const y2 = bounded(targetSource.y2);
      if (Math.hypot(x2 - x1, y2 - y1) < 0.005) throw new TypeError("箭头长度无效");
      target = { kind, x1, y1, x2, y2 };
    } else if (kind === "path") {
      const points = Array.isArray(targetSource.points) ? targetSource.points : [];
      if (points.length < 2 || points.length > 128) throw new TypeError("笔迹点数无效");
      const normalizedPoints = points.map(point => {
        if (!isObject(point)) throw new TypeError("笔迹坐标无效");
        return { x: bounded(point.x), y: bounded(point.y) };
      });
      if (normalizedPoints.every(point => point.x === normalizedPoints[0].x && point.y === normalizedPoints[0].y)) throw new TypeError("笔迹长度无效");
      target = { kind, points: normalizedPoints };
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
    const intent = source.intent === undefined ? "modify" : source.intent;
    if (!ANNOTATION_INTENTS.has(intent)) throw new TypeError("标注意图无效");
    const pageIndex = source.pageIndex === undefined ? 0 : Number(source.pageIndex);
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new TypeError("标注页码无效");
    const contentHash = text(source.contentHash, 140);
    if (!contentHash) throw new TypeError("标注 contentHash 不能为空");
    const status = source.status === undefined ? "active" : source.status;
    if (!["active", "stale", "deleted"].includes(status)) throw new TypeError("标注状态无效");
    const selected = source.selected === true;
    if (status === "deleted" && selected) throw new TypeError("已撤销批注不能继续选择");
    const id = text(source.id, 100);
    const reassociatedFromId = text(source.reassociatedFromId, 100);
    if (id && reassociatedFromId === id) throw new TypeError("批注不能重新关联到自身");
    const createdAt = text(source.createdAt, 80);
    const normalized = { id, taskId: text(source.taskId, 100), attachmentId: text(source.attachmentId, 100), contentHash, pageIndex, target, comment, category, intent, createdAt, updatedAt: text(source.updatedAt, 80) || createdAt, status, selected, reassociatedFromId };
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
