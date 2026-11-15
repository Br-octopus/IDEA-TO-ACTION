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
  function createOfficeSelectionTarget(attachment, context, model) {
    const format = attachment?.kind;
    if (!context || !["docx", "pptx"].includes(format) || context.format !== format || context.truncated) return null;
    if (context.kind === "text") {
      const exact = cleanText(context.text, 2000);
      const runs = (Array.isArray(context.runs) ? context.runs : []).slice(0, 16).filter(run => Number.isSafeInteger(run?.runIndex) && run.runIndex >= 0);
      const locators = runs.map(run => {
        if (format !== "docx") return `s:${String(run.shapeId || run.elementIndex || "").slice(0, 48)}:r${run.runIndex}`;
        const paragraph = cleanText(run.paragraphId, 48);
        if (paragraph) return `p:${paragraph}:r${run.runIndex}`;
        const source = run.source;
        if (!["body", "header", "footer", "footnote", "endnote", "textbox"].includes(source?.story)
          || !cleanText(source.storyInstance, 48) || !Array.isArray(source.path) || !source.path.length
          || source.path.length > 32 || !source.path.every(index => Number.isSafeInteger(index) && index >= 0)) return null;
        return `p:source:${source.story}:${cleanText(source.storyInstance, 48)}:${JSON.stringify(source.path)}:r${run.runIndex}`;
      });
      const pageIndex = format === "docx"
        ? (context.pageIndexes?.[0] ?? runs[0]?.pageIndex)
        : (context.slideIndexes?.[0] ?? runs[0]?.slideIndex);
      const selector = `ooxml:${format}:page:${pageIndex + 1}:${locators.join(",")}`;
      if (!exact || !Number.isSafeInteger(pageIndex) || pageIndex < 0 || !locators.length || locators.some(locator => !locator) || selector.length > 500) return null;
      return { pageIndex, target: { kind: "text", selector, exact, prefix: "", suffix: "" } };
    }
    if (context.kind === "element") {
      const pageIndex = format === "docx" ? context.pageIndex : context.slideIndex;
      if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) return null;
      const pageSize = format === "docx"
        ? model?.pageSize?.(pageIndex)
        : { widthPt: model?.slideWidth, heightPt: model?.slideHeight };
      const bounds = context.bounds;
      const width = Number(pageSize?.widthPt);
      const height = Number(pageSize?.heightPt);
      const x = Number(format === "docx" ? bounds?.xPt : bounds?.x);
      const y = Number(format === "docx" ? bounds?.yPt : bounds?.y);
      const elementWidth = Number(format === "docx" ? bounds?.widthPt : bounds?.width);
      const elementHeight = Number(format === "docx" ? bounds?.heightPt : bounds?.height);
      if (![width, height, x, y, elementWidth, elementHeight].every(Number.isFinite)
        || width <= 0 || height <= 0 || elementWidth <= 0 || elementHeight <= 0) return null;
      const normalize = value => Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
      const left = normalize(x / width);
      const top = normalize(y / height);
      const right = normalize((x + elementWidth) / width);
      const bottom = normalize((y + elementHeight) / height);
      if (right <= left || bottom <= top) return null;
      const normalizedWidth = normalize(right - left);
      const normalizedHeight = normalize(bottom - top);
      if (normalizedWidth <= 0 || normalizedHeight <= 0) return null;
      const rotation = format === "pptx" ? Number(bounds.rotation ?? 0) : 0;
      if (!Number.isFinite(rotation) || Math.abs(rotation) > 360) return null;
      const identity = format === "docx"
        ? `index:${context.elementIndex}:${context.elementType}:${JSON.stringify(context.source?.path || [])}`
        : `shape:${context.shapeId || context.elementIndex}:${context.origin || "unknown"}:${context.name || context.elementType}`;
      return { pageIndex, target: {
        kind: "element", selector: `ooxml:${format}:page:${pageIndex + 1}:${identity}`.slice(0, 500),
        excerpt: cleanText(context.text, 500),
        bounds: { x: left, y: top, width: normalizedWidth, height: normalizedHeight, ...(rotation ? { rotation } : {}) }
      } };
    }
    return null;
  }
  function getOfficeSelectionInvalidReason(pending, { taskId, attachmentId, attachments } = {}) {
    if (!isObject(pending)) return "missing";
    if (pending.taskId !== taskId) return "task-changed";
    if (pending.attachmentId !== attachmentId) return "attachment-changed";
    const attachment = (Array.isArray(attachments) ? attachments : []).find(item => item?.id === pending.attachmentId);
    if (!attachment || !["docx", "pptx"].includes(attachment.kind)) return "attachment-unavailable";
    if (attachment.sha256 !== pending.contentHash) return "version-changed";
    if (!Number.isSafeInteger(pending.pageIndex) || pending.pageIndex < 0
      || !isObject(pending.target) || !["text", "element"].includes(pending.target.kind) || !pending.target.selector) return "location-invalid";
    if (pending.target.kind === "text" && !pending.target.exact) return "location-invalid";
    return "";
  }
  function createPptAnnotation(input = {}) {
    const source = isObject(input) ? input : {};
    const createdAt = source.createdAt || new Date().toISOString();
    return normalizePptAnnotation({ ...source, id: source.id || makeId("ppt-note"), createdAt, updatedAt: source.updatedAt || createdAt, status: "active" });
  }
  function createReassociatedAnnotation(source, attachment, target, overrides = {}) {
    if (!isObject(source) || !source.id || source.status === "deleted" || !isObject(attachment) || !attachment.id || !attachment.sha256) {
      throw new TypeError("重新关联批注或目标资料无效");
    }
    if (source.contentHash !== attachment.sha256 && !target) throw new Error("资料版本不同，必须先重新定位批注");
    return createPptAnnotation({
      taskId: attachment.taskId || source.taskId,
      attachmentId: attachment.id,
      contentHash: attachment.sha256,
      pageIndex: overrides.pageIndex ?? source.pageIndex,
      target: target || source.target,
      comment: overrides.comment ?? source.comment,
      category: overrides.category ?? source.category,
      intent: overrides.intent ?? source.intent,
      reassociatedFromId: source.id,
      selected: false
    });
  }
  function getAnnotationLocationStatus(annotation, targetAttachment, sourceAttachment) {
    if (!annotation || !targetAttachment || annotation.status === "deleted") return "invalid";
    if (annotation.status !== "stale" && annotation.contentHash === targetAttachment.sha256) return "matched";
    return sourceAttachment ? "needs-confirmation" : "invalid";
  }
  function createAnnotationHistory() {
    const undo = [];
    const redo = [];
    const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
    const source = direction => direction === "undo" ? undo : redo;
    const destination = direction => direction === "undo" ? redo : undo;
    return {
      canUndo: () => undo.length > 0,
      canRedo: () => redo.length > 0,
      record(before, after) {
        undo.push({ before: clone(before), after: clone(after) });
        if (undo.length > 20) undo.shift();
        redo.length = 0;
      },
      peek(direction) {
        const entry = source(direction).at(-1);
        return entry ? { before: clone(entry.before), after: clone(entry.after) } : null;
      },
      commit(direction) {
        const entry = source(direction).pop();
        if (!entry) return false;
        destination(direction).push(entry);
        return true;
      }
    };
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
    const selected = (Array.isArray(annotations) ? annotations : []).filter(item => item && item.selected === true && (item.status === undefined || item.status === "active"));
    const batches = [];
    let groups = [];
    let groupByKey = new Map();
    let itemCount = 0;
    let characterCount = 0;
    const flush = () => {
      if (!itemCount) return;
      batches.push({ groups: groups.map(({ key, ...group }) => group), itemCount, characterCount });
      groups = [];
      groupByKey = new Map();
      itemCount = 0;
      characterCount = 0;
    };
    for (const item of selected) {
      const comment = cleanText(item.comment, 2000);
      if (!comment) continue;
      if (itemCount && (itemCount >= maxItems || characterCount + comment.length > maxCharacters)) flush();
      const key = `${item.attachmentId || ""}:${Number.isSafeInteger(item.pageIndex) ? item.pageIndex : 0}`;
      let group = groupByKey.get(key);
      if (!group) { group = { key, attachmentId: cleanText(item.attachmentId, 100), pageIndex: Number.isSafeInteger(item.pageIndex) ? item.pageIndex : 0, comments: [] }; groups.push(group); groupByKey.set(key, group); }
      group.comments.push({ id: cleanText(item.id, 100), category: cleanText(item.category, 40), intent: item.intent || "modify", comment });
      itemCount += 1;
      characterCount += comment.length;
    }
    flush();
    const firstBatch = batches[0] || { groups: [], itemCount: 0, characterCount: 0 };
    return { ...firstBatch, batches, batchCount: batches.length, totalItemCount: batches.reduce((sum, batch) => sum + batch.itemCount, 0) };
  }
  function buildSelectedAnnotationPrompt(annotations, attachment) {
    const attachmentId = cleanText(attachment?.id, 100);
    const contentHash = cleanText(attachment?.sha256, 140);
    if (!attachmentId || !contentHash) return "";
    const intentLabels = { modify: "修改", add: "补充", remove: "删除", keep: "保留", question: "疑问", verify: "核对" };
    const targetLabels = { point: "位置", region: "区域", arrow: "箭头", path: "画笔", element: "网页元素", text: "文字选区" };
    const pathDescription = points => {
      const xs = points.map(point => point.x);
      const ys = points.map(point => point.y);
      const first = points[0], last = points[points.length - 1];
      const percent = value => Math.round(value * 100);
      return `手绘线条 ${points.length} 个定位点，起点 (${percent(first.x)}%, ${percent(first.y)}%)，终点 (${percent(last.x)}%, ${percent(last.y)}%)，覆盖范围 (${percent(Math.min(...xs))}%, ${percent(Math.min(...ys))}%) 至 (${percent(Math.max(...xs))}%, ${percent(Math.max(...ys))}%)`;
    };
    const selected = (Array.isArray(annotations) ? annotations : []).filter(item => item
      && item.selected === true
      && item.status === "active"
      && item.attachmentId === attachmentId
      && item.contentHash === contentHash
      && cleanText(item.comment, 2000));
    if (!selected.length) return "";
    const isVisualTarget = item => ["point", "region", "arrow", "path"].includes(item.target?.kind)
      || item.target?.kind === "element" && Boolean(item.target.bounds);
    const pageLabel = pageIndex => {
      if (attachment.kind === "pptx") return `第 ${pageIndex + 1} 张幻灯片`;
      if (["pdf", "docx"].includes(attachment.kind)) return `第 ${pageIndex + 1} 页`;
      if (attachment.kind === "html") return "固定网页快照";
      return pageIndex > 0 ? `第 ${pageIndex + 1} 页` : "当前页";
    };
    const lines = selected.map((item, index) => {
      const pageIndex = Number.isSafeInteger(item.pageIndex) && item.pageIndex >= 0 ? item.pageIndex : 0;
      const page = ["pdf", "docx", "pptx"].includes(attachment.kind) || pageIndex > 0
        ? `${pageLabel(pageIndex)}，` : attachment.kind === "html" ? "固定网页快照，" : "";
      const target = item.target?.kind === "text"
        ? `段落定位 ${cleanText(item.target.selector, 500)}，原文“${cleanText(item.target.exact, 2000)}”${item.target.prefix || item.target.suffix ? `（上下文：${String(item.target.prefix || "").slice(0, 120)}｜${String(item.target.suffix || "").slice(0, 120)}）` : ""}`
        : item.target?.kind === "element"
          ? `网页元素 ${cleanText(item.target.selector, 500)}${item.target.excerpt ? `，内容“${cleanText(item.target.excerpt, 500)}”` : ""}`
          : item.target?.kind === "point"
            ? `位置 (${Math.round(item.target.x * 100)}%, ${Math.round(item.target.y * 100)}%)`
            : item.target?.kind === "region"
              ? `区域 (${Math.round(item.target.x * 100)}%, ${Math.round(item.target.y * 100)}%，宽 ${Math.round(item.target.width * 100)}%，高 ${Math.round(item.target.height * 100)}%)`
              : item.target?.kind === "arrow"
                ? `从 (${Math.round(item.target.x1 * 100)}%, ${Math.round(item.target.y1 * 100)}%) 指向 (${Math.round(item.target.x2 * 100)}%, ${Math.round(item.target.y2 * 100)}%)`
                : item.target?.kind === "path"
                  ? pathDescription(item.target.points)
              : "未识别位置";
      const source = item.target?.source;
      const sourceDescription = source ? `；网页来源 ${cleanText(source.url, 2048)}；抓取时间 ${cleanText(source.fetchedAt, 80)}；网页版本 ${cleanText(source.contentHash, 80)}` : "";
      return `${index + 1}. [批注 ID：${cleanText(item.id, 100) || "未提供"}；${intentLabels[item.intent] || "修改"}；${cleanText(item.category, 40) || "other"}；${targetLabels[item.target?.kind] || "位置"}] ${page}${target}${sourceDescription}：${cleanText(item.comment, item.mergedConflict === true ? 8000 : 2000)}`;
    });
    const visualAnnotations = selected.filter(isVisualTarget);
    let visualEvidence = "";
    if (visualAnnotations.length) {
      const name = cleanText(attachment.displayName, 180) || attachmentId;
      let requiredEvidence;
      if (attachment.kind === "image") {
        requiredEvidence = `请随提示词附上该版本的完整原图；如模型仍无法辨认圈选细节，再附批注区域裁图。`;
      } else if (attachment.kind === "html") {
        requiredEvidence = `请随提示词附上该固定网页快照的批注区域截图和整页截图。`;
      } else {
        const pages = [...new Set(visualAnnotations.map(item => Number.isSafeInteger(item.pageIndex) && item.pageIndex >= 0 ? item.pageIndex : 0))]
          .sort((left, right) => left - right).map(pageLabel);
        requiredEvidence = `请随提示词附上${pages.join("、")}的批注区域截图和对应整页截图。`;
      }
      visualEvidence = `\n\n【需附视觉依据】\n资料：${name}\n${requiredEvidence}\n当前提示词是纯文本，未包含图像附件。若暂时不能附图，请先补充并确认目标区域的文字描述；不能仅凭坐标猜测。`;
    }
    return `【用户选择的资料批注】\n资料 ID：${attachmentId}\n资料版本 SHA-256：${contentHash}\n${lines.join("\n")}${visualEvidence}\n请只按以上用户意见修改，并保留未提及内容。`;
  }
  function findSelectedAnnotationConflicts(annotations, attachments) {
    const current = new Map((Array.isArray(attachments) ? attachments : [])
      .filter(item => item?.id && item?.sha256)
      .map(item => [item.id, item]));
    const grouped = new Map();
    for (const item of Array.isArray(annotations) ? annotations : []) {
      const attachment = current.get(item?.attachmentId);
      if (!attachment || attachment.sha256 !== item.contentHash || item.selected !== true
        || ![undefined, "active"].includes(item.status) || !["modify", "add", "remove", "keep"].includes(item.intent)) continue;
      const key = JSON.stringify([item.attachmentId, item.contentHash, item.pageIndex || 0, item.target]);
      if (!grouped.has(key)) grouped.set(key, { attachment, items: [] });
      grouped.get(key).items.push(item);
    }
    const conflicts = [];
    for (const { attachment, items } of grouped.values()) {
      const conflictingIds = new Set();
      for (let left = 0; left < items.length; left++) {
        for (let right = left + 1; right < items.length; right++) {
          const a = items[left].intent, b = items[right].intent;
          const conflict = a !== b && (a === "keep" || b === "keep" || a === "remove" || b === "remove");
          if (conflict) { conflictingIds.add(items[left].id); conflictingIds.add(items[right].id); }
        }
      }
      if (conflictingIds.size) conflicts.push({
        attachmentId: attachment.id,
        displayName: cleanText(attachment.displayName, 180) || attachment.id,
        annotationIds: [...conflictingIds]
      });
    }
    return conflicts;
  }
  function getSelectedAnnotationConflictKey(conflict, annotations) {
    const items = new Map((Array.isArray(annotations) ? annotations : []).map(item => [item?.id, item]));
    const ids = (Array.isArray(conflict?.annotationIds) ? conflict.annotationIds : []).slice().sort();
    const signature = JSON.stringify(ids.map(id => {
      const item = items.get(id);
      return [id, item?.updatedAt || "", item?.comment || "", item?.intent || "", item?.contentHash || "", item?.pageIndex || 0, item?.target || null];
    }));
    let hash = 14695981039346656037n;
    for (let index = 0; index < signature.length; index++) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(signature.charCodeAt(index))) * 1099511628211n);
    }
    return `${ids.join(",")}:${hash.toString(16)}`;
  }
  function resolveSelectedAnnotationConflicts(annotations, attachments, decisions = []) {
    const source = Array.isArray(annotations) ? annotations : [];
    const selectedAnnotations = source.filter(item => item?.selected === true && [undefined, "active"].includes(item.status)
      && (Array.isArray(attachments) ? attachments : []).some(attachment => attachment.id === item.attachmentId && attachment.sha256 === item.contentHash));
    const conflicts = findSelectedAnnotationConflicts(selectedAnnotations, attachments);
    const conflictedIds = new Set(conflicts.flatMap(item => item.annotationIds));
    const promptSources = selectedAnnotations.filter(item => !conflictedIds.has(item.id));
    const decisionByKey = new Map((Array.isArray(decisions) ? decisions : [])
      .filter(item => item?.kind === "annotation-conflict-resolution" && typeof item.annotationConflictKey === "string")
      .map(item => [item.annotationConflictKey, item]));
    const pendingConflicts = [];
    const deferredConflicts = [];
    const intentLabels = { modify: "修改", add: "新增", remove: "删除", keep: "保留" };
    for (const conflict of conflicts) {
      const key = getSelectedAnnotationConflictKey(conflict, selectedAnnotations);
      const decision = decisionByKey.get(key);
      const items = conflict.annotationIds.map(id => selectedAnnotations.find(item => item.id === id)).filter(Boolean);
      const mergedComment = `【已合并互斥意见；如动作仍冲突，先提出建议，不要擅自执行】\n${items.map(item => `${intentLabels[item.intent] || "修改"}：${item.comment}`).join("\n")}`;
      if (decision?.annotationConflictChoice === "keep" && items.some(item => item.id === decision.annotationConflictKeepId)) {
        promptSources.push(items.find(item => item.id === decision.annotationConflictKeepId));
      } else if (decision?.annotationConflictChoice === "merge" && items.length > 1) {
        if (mergedComment.length <= 8000) promptSources.push({ ...items[0], intent: "modify", mergedConflict: true, comment: mergedComment });
        else pendingConflicts.push({ ...conflict, key, mergeAllowed: false });
      } else if (decision?.annotationConflictChoice === "defer") {
        deferredConflicts.push(conflict);
      } else {
        pendingConflicts.push({ ...conflict, key, mergeAllowed: mergedComment.length <= 8000 });
      }
    }
    return { selectedAnnotations, conflicts, pendingConflicts, deferredConflicts, conflictedIds: new Set(pendingConflicts.flatMap(item => item.annotationIds)), promptSources };
  }
  function buildSelectedAnnotationPrompts(annotations, attachments) {
    const available = Array.isArray(attachments) ? attachments : [];
    const conflicts = findSelectedAnnotationConflicts(annotations, available);
    const conflictedIds = new Set(conflicts.flatMap(item => item.annotationIds));
    const prompts = available.map(attachment => {
      const prompt = buildSelectedAnnotationPrompt(
        (Array.isArray(annotations) ? annotations : []).filter(item => !conflictedIds.has(item?.id)),
        attachment
      );
      return prompt ? `【资料来源：${cleanText(attachment.displayName, 180) || attachment.id}】\n${prompt}` : "";
    }).filter(Boolean);
    if (conflicts.length) prompts.push(`【未纳入的冲突批注】\n${conflicts.map(item => `${item.displayName}（资料 ${item.attachmentId}）：批注 ${item.annotationIds.join("、")} 指向同一位置但意见互斥，已从提示词排除。请取消选择其中冲突意见后重新生成。`).join("\n")}`);
    return prompts.join("\n\n");
  }
  function buildSelectedAnnotationPromptBatches(annotations, attachments, options = {}) {
    const maxCharacters = boundedInteger(options.maxCharacters, 8000, 1, 50000);
    const available = Array.isArray(attachments) ? attachments : [];
    const conflicts = findSelectedAnnotationConflicts(annotations, available);
    const conflictedIds = new Set(conflicts.flatMap(item => item.annotationIds));
    const batches = [];
    let current = [];
    const render = groups => groups.map(({ attachment, items }) => {
      const prompt = buildSelectedAnnotationPrompt(items, attachment);
      return prompt ? `【资料来源：${cleanText(attachment.displayName, 180) || attachment.id}】\n${prompt}` : "";
    }).filter(Boolean).join("\n\n");
    const flush = () => {
      if (!current.length) return;
      const prompt = render(current);
      batches.push({
        prompt,
        annotationIds: current.flatMap(group => group.items.map(item => cleanText(item.id, 100)).filter(Boolean)),
        itemCount: current.reduce((sum, group) => sum + group.items.length, 0),
        characterCount: prompt.length,
        oversized: prompt.length > maxCharacters
      });
      current = [];
    };
    for (const attachment of available) {
      const selected = (Array.isArray(annotations) ? annotations : []).filter(item => item
        && !conflictedIds.has(item.id)
        && item.selected === true
        && item.status === "active"
        && item.attachmentId === attachment.id
        && item.contentHash === attachment.sha256
        && cleanText(item.comment, 2000));
      for (const item of selected) {
        const add = groups => {
          const index = groups.findIndex(group => group.attachment.id === attachment.id);
          return index === -1
            ? [...groups, { attachment, items: [item] }]
            : groups.map((group, groupIndex) => groupIndex === index ? { ...group, items: [...group.items, item] } : group);
        };
        const candidate = add(current);
        if (current.length && render(candidate).length > maxCharacters) flush();
        current = add(current);
        if (render(current).length > maxCharacters) flush();
      }
    }
    flush();
    return { batches, batchCount: batches.length, totalItemCount: batches.reduce((sum, batch) => sum + batch.itemCount, 0), conflicts };
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
  return { normalizePptFeedbackAttachment, normalizePptAnnotation, createOfficeSelectionTarget, getOfficeSelectionInvalidReason, createPptAnnotation, createReassociatedAnnotation, getAnnotationLocationStatus, createAnnotationHistory, markStaleAnnotations, buildSelectedFeedbackContext, buildSelectedAnnotationPrompt, findSelectedAnnotationConflicts, getSelectedAnnotationConflictKey, resolveSelectedAnnotationConflicts, buildSelectedAnnotationPrompts, buildSelectedAnnotationPromptBatches, buildPreflightReport, buildAcceptanceReport };
});
