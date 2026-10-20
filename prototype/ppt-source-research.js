(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPptSourceResearch = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const DEFAULT_BUDGET = Object.freeze({ maxQueries: 3, maxSources: 5 });
  const SOURCE_STATUSES = new Set(["queued", "reading", "complete", "partial", "failed", "unavailable", "required-but-unavailable"]);
  const ROLES = new Set(["content", "style", "both", "irrelevant"]);
  const DISPOSITIONS = new Set(["include", "exclude", "uncertain"]);

  function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function text(value, fallback) { return String(value == null ? (fallback || "") : value).trim(); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function unique(values) { return [...new Set(list(values).map(value => text(value)).filter(Boolean))]; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function number(value, fallback) {
    const result = Number(value == null ? fallback : value);
    return Number.isFinite(result) ? Math.max(0, Math.min(1, result)) : 0;
  }
  function positiveInteger(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new TypeError("批次限制必须是正安全整数");
    return Number(value);
  }
  function modeOf(scope) {
    const value = text(scope && (scope.searchMode || scope.mode)).toLowerCase();
    return ["大量", "全面", "extensive", "large", "broad"].includes(value) ? "extensive" : "default";
  }
  function normalizeRequiredSource(source, index) {
    if (typeof source === "string") return { id: source, title: source, url: source, kind: "unknown", priority: "required", required: true, status: "queued" };
    if (!isObject(source)) throw new TypeError("必查来源[" + index + "]必须是对象或 URL");
    const id = text(source.id || source.url || source.title);
    if (!id) throw new TypeError("必查来源[" + index + "]缺少 id、url 或 title");
    return { id, title: text(source.title || source.url || source.id), url: text(source.url), kind: text(source.kind, "unknown"), priority: "required", required: true, status: "queued", license: text(source.license, "unknown"), limitations: text(source.limitations) };
  }
  function normalizeCandidate(candidate, index) {
    if (!isObject(candidate)) throw new TypeError("本机候选[" + index + "]必须是对象");
    const id = text(candidate.id || candidate.sourceId || candidate.path || candidate.url);
    if (!id) throw new TypeError("本机候选[" + index + "]缺少 id");
    return { ...clone(candidate), id, sourceId: text(candidate.sourceId || id), kind: text(candidate.kind, "local-file"), title: text(candidate.title || candidate.relativePath || id), excerpt: text(candidate.excerpt || candidate.text || candidate.summary), status: text(candidate.status, "queued"), selected: candidate.selected === true };
  }
  function buildQueries(request, mode) {
    const scope = isObject(request.scope) ? request.scope : {};
    const explicit = unique([...list(scope.queries), ...list(request.queries)]);
    if (explicit.length) return explicit.slice(0, mode === "default" ? 3 : 50);
    const parts = unique([request.presentationType, request.stage, request.goal, ...list(scope.platforms), ...list(scope.sources), ...list(scope.keywords)]);
    if (!parts.length) return [];
    const base = parts.join(" ");
    return unique([base, request.presentationType && request.goal ? request.presentationType + " " + request.goal : "", request.stage && request.goal ? request.stage + " " + request.goal + " 方法 案例" : ""]).slice(0, mode === "default" ? 3 : 50);
  }
  function buildPptResearchPlan(request, localCapabilities) {
    if (!isObject(request)) throw new TypeError("PPT 研究请求必须是对象");
    const scope = isObject(request.scope) ? request.scope : {};
    const mode = modeOf(scope);
    const queries = buildQueries(request, mode);
    const platforms = unique(scope.platforms || request.platforms);
    const requiredSources = list(request.requiredSources || request.mustCheckSources).map(normalizeRequiredSource);
    const capabilities = localCapabilities || {};
    const candidates = list(request.localCandidates || capabilities.candidates || capabilities.localCandidates).map(normalizeCandidate);
    const budget = mode === "extensive" ? { maxQueries: queries.length, maxSources: Math.max(5 * Math.max(platforms.length, 1), queries.length * 3) } : { ...DEFAULT_BUDGET };
    const sourceQueue = [...requiredSources, ...candidates.filter(candidate => !requiredSources.some(source => source.id === candidate.id))];
    return { id: text(request.id, "ppt-research-" + Date.now()), status: "running", mode, presentationType: text(request.presentationType), stage: text(request.stage), goal: text(request.goal), scope: clone(scope), platforms, queries, totalQueryCount: queries.length, budget, totalSourceLimit: budget.maxSources, requiresConfirmation: false, requiredSources, sourceQueue, candidates, supportedFormats: unique(capabilities.supportedFormats || capabilities.formats), progress: { evaluated: 0, evaluatedSourceIds: [], completedBatches: [], totalBatches: null }, sources: requiredSources.map(source => ({ ...source })) };
  }
  function splitResearchBatches(plan, limits) {
    if (!isObject(plan)) throw new TypeError("研究计划必须是对象");
    const options = limits || {};
    const queryLimit = positiveInteger(options.maxQueriesPerBatch, 3);
    const sourceLimit = positiveInteger(options.maxSourcesPerBatch, 3);
    const queries = list(plan.queries);
    const required = list(plan.requiredSources);
    const queued = list(plan.sourceQueue);
    const candidates = [];
    const candidateIds = new Set();
    for (const candidate of [...required, ...queued, ...list(plan.candidates)]) {
      const id = text(candidate && (candidate.id || candidate.sourceId || candidate.url));
      if (!id || candidateIds.has(id)) continue;
      candidateIds.add(id);
      candidates.push(candidate);
    }
    const count = Math.max(1, Math.ceil(Math.max(queries.length, 1) / queryLimit), Math.ceil(candidates.length / sourceLimit));
    const batches = [];
    for (let index = 0; index < count; index += 1) batches.push({ id: "batch-" + (index + 1), index, queries: queries.slice(index * queryLimit, (index + 1) * queryLimit), queryLimit, sourceLimit, candidates: candidates.slice(index * sourceLimit, (index + 1) * sourceLimit), status: "queued" });
    return batches;
  }
  function normalizePptSourceResult(input) {
    if (!isObject(input)) throw new TypeError("PPT 来源结果必须是对象");
    const evidenceType = text(input.evidenceType, "unknown");
    const sourceType = text(input.sourceType, "unknown");
    const verificationStatus = text(input.verificationStatus, evidenceType === "user-confirmed-experience" || sourceType === "user-confirmed-experience" || sourceType === "user-review" ? "user-confirmed" : evidenceType === "project-self-report" ? "source-claimed" : evidenceType === "public-example" ? "public-example" : "unverified");
    const status = text(input.status, "queued");
    if (!SOURCE_STATUSES.has(status)) throw new TypeError("来源状态无效：" + status);
    return { ...clone(input), sourceId: text(input.sourceId || input.id), id: text(input.id || input.sourceId), title: text(input.title || input.url || input.sourceId), status, evidenceType, sourceType, verificationStatus, license: text(input.license, "unknown"), limitations: text(input.limitations), error: text(input.error), errorCode: text(input.errorCode) };
  }
  function recordResearchProgress(plan, event) {
    if (!isObject(plan) || !isObject(event)) throw new TypeError("研究计划和进度事件必须是对象");
    const next = clone(plan);
    next.progress = next.progress || { evaluated: 0, evaluatedSourceIds: [], completedBatches: [], totalBatches: null };
    if (event.type === "pause") { next.status = "paused"; next.pauseReason = text(event.reason, "user-paused"); next.progress.pausedBatchId = text(event.batchId || event.batch && event.batch.id); if (isObject(event.batch)) next.progress.pausedBatch = clone(event.batch); return next; }
    if (event.type === "resume") { if (next.status !== "paused") throw new Error("只有暂停中的研究计划可以继续"); next.status = "running"; delete next.pauseReason; return next; }
    if (event.type === "cancel") { next.status = "cancelled"; next.cancelReason = text(event.reason, "user-cancelled"); return next; }
    if (event.type === "budget-exhausted") { next.status = "paused"; next.pauseReason = "budget-exhausted"; next.progress.evaluatedSourceIds = unique([...next.progress.evaluatedSourceIds, ...list(event.evaluated)]); next.progress.evaluated = next.progress.evaluatedSourceIds.length; next.progress.pausedBatchId = text(event.batchId || event.batch && event.batch.id); if (isObject(event.batch)) next.progress.pausedBatch = clone(event.batch); return next; }
    if (event.type === "batch-complete") { if (event.batchId && !next.progress.completedBatches.includes(event.batchId)) next.progress.completedBatches.push(event.batchId); return next; }
    if (event.type === "source-result") {
      const sourceId = text(event.sourceId);
      if (!sourceId) throw new TypeError("来源结果缺少 sourceId");
      const required = next.requiredSources.some(source => source.id === sourceId);
      const status = text(event.status, "complete");
      const result = normalizePptSourceResult({ ...event, sourceId, status: status === "unavailable" && required ? "required-but-unavailable" : status, required });
      const index = next.sources.findIndex(source => source.sourceId === sourceId || source.id === sourceId);
      if (index >= 0) next.sources[index] = result; else next.sources.push(result);
      if (["complete", "partial", "failed", "unavailable", "required-but-unavailable"].includes(result.status)) { next.progress.evaluatedSourceIds = unique([...next.progress.evaluatedSourceIds, sourceId]); next.progress.evaluated = next.progress.evaluatedSourceIds.length; }
      return next;
    }
    throw new TypeError("不支持的研究进度事件：" + text(event.type));
  }
  function rankPptSources(results, task) {
    const goal = text(task && task.goal).toLowerCase();
    return list(results).map((item, index) => {
      const result = normalizePptSourceResult(item);
      const recency = Date.parse(text(result.updatedAt));
      const dateScore = Number.isFinite(recency) ? Math.max(0, 1 - Math.max(0, Date.now() - recency) / (1000 * 60 * 60 * 24 * 365 * 5)) : 0;
      const taskBoost = goal && text(result.summary || result.excerpt).toLowerCase().includes(goal) ? 0.1 : 0;
      return { ...result, rankScore: (result.required === true ? 100000 : 0) + number(result.usefulness, result.relevanceScore) * 0.45 + number(result.quality, result.sourceQuality) * 0.25 + (result.hasArtifact === true ? 0.08 : 0) + (result.verificationStatus === "user-confirmed" ? 0.12 : 0) + dateScore * 0.12 + taskBoost, originalIndex: index };
    }).sort((left, right) => right.rankScore - left.rankScore || left.originalIndex - right.originalIndex).map(({ originalIndex, ...item }) => item);
  }
  function summarizeSourceCoverage(plan, results) {
    const map = new Map();
    for (const source of [...list(plan && plan.sources), ...list(results).map(normalizePptSourceResult)]) { const id = text(source.sourceId || source.id); if (id) map.set(id, source); }
    const required = list(plan && plan.requiredSources).map(source => map.get(source.id) || source);
    const requiredUnavailable = required.filter(source => ["required-but-unavailable", "unavailable", "failed"].includes(source.status));
    return { total: map.size, complete: [...map.values()].filter(source => source.status === "complete").length, partial: [...map.values()].filter(source => source.status === "partial").length, failed: [...map.values()].filter(source => source.status === "failed").length, required, requiredComplete: required.every(source => ["complete", "partial"].includes(source.status)), requiredUnavailable, substitutesAccepted: false };
  }
  function buildSourceSendPreview(candidates, task) {
    const normalized = list(candidates).map(normalizeCandidate);
    const options = task || {};
    const previewCandidates = normalized.slice(0, positiveInteger(options.maxCandidates, 3));
    const scope = isObject(options.scope) ? clone(options.scope) : {};
    const evaluatedSourceIds = unique(options.evaluatedSourceIds);
    const totalSourceCount = Math.max(evaluatedSourceIds.length, Number(options.totalSourceCount) || normalized.length);
    const batchId = text(options.batch && options.batch.id);
    const batchInfo = { id: batchId, index: options.batch && Number.isInteger(options.batch.index) ? options.batch.index : null, total: Number(options.totalBatches) || null };
    const scopeText = unique([...list(scope.platforms), ...list(scope.sources), ...list(scope.keywords), ...list(scope.queries)]).join("、") || "未指定";
    const lines = previewCandidates.map((candidate, index) => (index + 1) + ". " + candidate.title + (candidate.excerpt ? "：" + candidate.excerpt.slice(0, 300) : ""));
    return { stage: "before-model-review", confirmationScope: "whole-batch", batchId, batchInfo, goal: text(options.goal), searchScope: scope, evaluatedCount: evaluatedSourceIds.length, unevaluatedCount: Math.max(0, totalSourceCount - evaluatedSourceIds.length), candidates: previewCandidates, text: "研究目标：" + text(options.goal) + "\n搜索范围：" + scopeText + "\n已评估：" + evaluatedSourceIds.length + "\n未评估：" + Math.max(0, totalSourceCount - evaluatedSourceIds.length) + "\n当前批次：" + (batchId || "未指定") + (batchInfo.total ? "（第 " + (batchInfo.index + 1) + " / " + batchInfo.total + " 批）" : "") + "\n本批候选（发送模型前预览）：\n" + lines.join("\n"), discardedCount: 0 };
  }
  function classifyPptMaterial(input, modelSuggestion) { const suggestion = modelSuggestion || {}; return { ...clone(input), role: ROLES.has(input && input.purpose) ? input.purpose : "content", modelSuggestion: { role: ROLES.has(suggestion.role) ? suggestion.role : null, reason: text(suggestion.reason) }, verificationStatus: "needs-verification" }; }
  function classifyPptPages(input, modelSuggestion) {
    const suggestions = new Map(list(modelSuggestion && modelSuggestion.pages).map(page => [Number(page.page), page]));
    return { ...clone(input), pages: list(input && input.pages).map(page => { const suggestion = suggestions.get(Number(page.page)) || {}; return { ...clone(page), disposition: DISPOSITIONS.has(suggestion.disposition) ? suggestion.disposition : "uncertain", reason: text(suggestion.reason, "模型复筛前未确认"), recoverable: true }; }) };
  }
  function selectSourceRerunScope(request) {
    const input = request || {};
    const plan = input.plan || {};
    const evaluatedSourceIds = unique([...list(plan.progress && plan.progress.evaluatedSourceIds), ...list(input.evaluatedSourceIds)]);
    const batches = list(input.batches || plan.batches);
    const batchLimits = isObject(plan.batchLimits) ? plan.batchLimits : {};
    const queryLimit = positiveInteger(plan.maxQueriesPerBatch || batchLimits.maxQueriesPerBatch, 1);
    const sourceLimit = positiveInteger(batchLimits.maxSourcesPerBatch || plan.maxSourcesPerBatch, 3);
    const pausedBatch = plan.progress && isObject(plan.progress.pausedBatch) ? plan.progress.pausedBatch : null;
    const availableBatches = input.scope === "current" && pausedBatch ? [pausedBatch] : batches.length ? batches : splitResearchBatches(plan, { maxQueriesPerBatch: queryLimit, maxSourcesPerBatch: sourceLimit });
    const completed = list(plan.progress && plan.progress.completedBatches);
    let pendingBatches = availableBatches.filter(batch => !completed.includes(batch.id));
    if (input.scope === "current") {
      const currentBatchId = text(input.currentBatchId || pausedBatch && pausedBatch.id || plan.progress && plan.progress.pausedBatchId);
      pendingBatches = currentBatchId ? pendingBatches.filter(batch => batch.id === currentBatchId) : [];
    }
    const remainingSourceIds = unique(pendingBatches.flatMap(batch => list(batch.candidates).map(candidate => text(candidate && (candidate.id || candidate.sourceId)))).filter(id => !evaluatedSourceIds.includes(id)));
    return { scope: text(input.scope, "remaining"), batchIds: pendingBatches.map(batch => batch.id), evaluatedSourceIds, remainingSourceIds };
  }
  return { DEFAULT_BUDGET, buildPptResearchPlan, splitResearchBatches, recordResearchProgress, summarizeSourceCoverage, rankPptSources, normalizePptSourceResult, classifyPptMaterial, classifyPptPages, buildSourceSendPreview, selectSourceRerunScope };
});
