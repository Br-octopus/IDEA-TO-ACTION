(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ForwardStepWritingMaterialCoverage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SOURCE_KINDS = new Set(['knowledge-library', 'authorized-directory', 'project-materials']);
  const ITEM_STATUSES = new Set(['pending', 'in-progress', 'returned', 'processed', 'excluded', 'failed']);
  const BATCH_STATUSES = new Set(['in-progress', 'result-returned', 'confirmed', 'failed', 'retry-open']);
  const MAX_ITEMS = 10000;
  const MAX_BATCH_SIZE = 20;
  const MAX_HISTORY = 10;

  function cleanText(value, max = 500) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
  }

  function cleanRelativePath(value) {
    const path = cleanText(value, 1000).replace(/\\/g, '/');
    if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(part => part === '..')) return '';
    return path;
  }

  function normalizeItem(input, excludedIds, allowExistingStatus = false) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const id = cleanText(source.id, 240);
    if (!id) throw new TypeError('范围内每项材料都必须有稳定来源 ID');
    const allowedInitialStatuses = new Set(['pending', 'excluded', 'failed']);
    if (source.status !== undefined && !(allowExistingStatus ? ITEM_STATUSES : allowedInitialStatuses).has(source.status)) {
      throw new TypeError('资料条目状态无效');
    }
    const requestedStatus = source.status || 'pending';
    const excluded = excludedIds.has(id) || requestedStatus === 'excluded';
    const item = {
      id,
      title: cleanText(source.title, 240) || '未命名材料',
      sourceVersion: cleanText(source.sourceVersion || source.fingerprint, 160),
      relativePath: cleanRelativePath(source.relativePath),
      status: excluded ? 'excluded' : requestedStatus,
      batchId: '',
      reason: excluded ? cleanText(source.exclusionReason || source.reason, 1000) || '用户排除'
        : requestedStatus === 'failed' ? cleanText(source.reason, 1000) || '来源不可用' : '',
      attempts: 0
    };
    return item;
  }

  function createCoverageSnapshot(input = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const id = cleanText(source.id, 100);
    const sourceKind = cleanText(source.sourceKind, 40);
    if (!id) throw new TypeError('资料范围 ID 不能为空');
    if (!SOURCE_KINDS.has(sourceKind)) throw new TypeError('资料来源范围无效');
    const rawItems = Array.isArray(source.items) ? source.items : [];
    if (rawItems.length > MAX_ITEMS) throw new RangeError(`单个资料范围最多记录 ${MAX_ITEMS} 项`);
    const excludedIds = new Set(Array.isArray(source.excludedIds) ? source.excludedIds.map(value => cleanText(value, 240)) : []);
    const items = rawItems.map(item => normalizeItem(item, excludedIds));
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item.id)) throw new TypeError(`范围内存在重复来源 ID：${item.id}`);
      seen.add(item.id);
    }
    const requestedTotal = Number.isSafeInteger(source.knownTotal) && source.knownTotal >= 0
      ? source.knownTotal : items.length;
    const inventoryComplete = source.inventoryComplete === true && requestedTotal === items.length;
    return {
      id,
      sourceKind,
      filters: cleanText(source.filters, 1000),
      createdAt: cleanText(source.createdAt, 80),
      knownTotal: requestedTotal,
      inventoryComplete,
      items,
      batches: [],
      history: []
    };
  }

  function cloneSnapshotCore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.batches)) {
      throw new TypeError('资料覆盖快照无效');
    }
    return {
      id: cleanText(snapshot.id, 100),
      sourceKind: SOURCE_KINDS.has(snapshot.sourceKind) ? snapshot.sourceKind : '',
      filters: cleanText(snapshot.filters, 1000),
      createdAt: cleanText(snapshot.createdAt, 80),
      knownTotal: Number.isSafeInteger(snapshot.knownTotal) && snapshot.knownTotal >= 0 ? snapshot.knownTotal : snapshot.items.length,
      inventoryComplete: snapshot.inventoryComplete === true,
      items: snapshot.items.map(item => {
        const normalized = normalizeItem(item, new Set(), true);
        normalized.status = ITEM_STATUSES.has(item.status) ? item.status : 'pending';
        normalized.batchId = cleanText(item.batchId, 120);
        normalized.reason = cleanText(item.reason, 1000);
        normalized.attempts = Number.isSafeInteger(item.attempts) && item.attempts >= 0 ? item.attempts : 0;
        return normalized;
      }),
      batches: snapshot.batches.map(batch => ({
        id: cleanText(batch.id, 120),
        itemIds: Array.isArray(batch.itemIds) ? batch.itemIds.map(id => cleanText(id, 240)).filter(Boolean) : [],
        status: cleanText(batch.status, 40),
        promptVersionId: cleanText(batch.promptVersionId, 120),
        resultSummary: cleanText(batch.resultSummary, 1000),
        reason: cleanText(batch.reason, 1000),
        confirmation: cleanText(batch.confirmation, 1000),
        confirmedAt: cleanText(batch.confirmedAt, 80)
      })),
      history: []
    };
  }

  function cloneSnapshot(snapshot) {
    const cloned = cloneSnapshotCore(snapshot);
    cloned.history = Array.isArray(snapshot.history)
      ? snapshot.history.slice(-MAX_HISTORY).map(entry => cloneSnapshotCore(entry)) : [];
    return cloned;
  }

  function createNextBatch(input, options = {}) {
    const snapshot = cloneSnapshot(input);
    const batchSize = Number.isSafeInteger(options.batchSize) ? options.batchSize : 5;
    if (batchSize < 1 || batchSize > MAX_BATCH_SIZE) throw new RangeError(`每批数量必须在 1 到 ${MAX_BATCH_SIZE} 之间`);
    const pending = snapshot.items.filter(item => item.status === 'pending' && !item.batchId).slice(0, batchSize);
    if (!pending.length) throw new Error('当前没有待处理材料');
    const batch = {
      id: `batch-${snapshot.batches.length + 1}`,
      itemIds: pending.map(item => item.id),
      status: 'in-progress',
      promptVersionId: cleanText(options.promptVersionId, 120),
      resultSummary: '', reason: '', confirmation: '', confirmedAt: ''
    };
    for (const item of pending) {
      item.status = 'in-progress';
      item.batchId = batch.id;
      item.attempts += 1;
    }
    snapshot.batches.push(batch);
    return { snapshot, batch: { ...batch, itemIds: [...batch.itemIds] } };
  }

  function recordBatchOutcome(input, batchId, outcome = {}) {
    const snapshot = cloneSnapshot(input);
    const batch = snapshot.batches.find(item => item.id === cleanText(batchId, 120));
    if (!batch || batch.status !== 'in-progress') throw new Error('批次状态不允许记录结果');
    const members = snapshot.items.filter(item => batch.itemIds.includes(item.id) && item.batchId === batch.id);
    if (members.length !== batch.itemIds.length) throw new Error('批次材料与范围快照不一致');
    if (outcome.kind === 'returned') {
      const promptVersionId = cleanText(outcome.promptVersionId || batch.promptVersionId, 120);
      const resultSummary = cleanText(outcome.resultSummary, 1000);
      if (!promptVersionId) throw new TypeError('带回结果必须关联实际提示词版本');
      if (!resultSummary) throw new TypeError('请记录带回结果摘要');
      batch.status = 'result-returned';
      batch.promptVersionId = promptVersionId;
      batch.resultSummary = resultSummary;
      for (const item of members) item.status = 'returned';
    } else if (outcome.kind === 'failed') {
      const reason = cleanText(outcome.reason, 1000);
      if (!reason) throw new TypeError('失败批次必须记录原因');
      batch.status = 'failed';
      batch.reason = reason;
      for (const item of members) { item.status = 'failed'; item.reason = reason; }
    } else {
      throw new TypeError('批次结果类型无效');
    }
    return snapshot;
  }

  function confirmBatch(input, batchId, confirmation = {}) {
    const snapshot = cloneSnapshot(input);
    const batch = snapshot.batches.find(item => item.id === cleanText(batchId, 120));
    if (!batch || batch.status !== 'result-returned') throw new Error('批次状态不允许确认完成');
    const evidence = cleanText(confirmation.evidence, 1000);
    if (!evidence) throw new TypeError('请填写确认依据');
    const members = snapshot.items.filter(item => batch.itemIds.includes(item.id) && item.batchId === batch.id);
    if (members.length !== batch.itemIds.length) throw new Error('批次材料与范围快照不一致');
    batch.status = 'confirmed';
    batch.confirmation = evidence;
    batch.confirmedAt = cleanText(confirmation.confirmedAt, 80);
    for (const item of members) { item.status = 'processed'; item.reason = ''; }
    return snapshot;
  }

  function retryFailedBatch(input, batchId) {
    const snapshot = cloneSnapshot(input);
    const batch = snapshot.batches.find(item => item.id === cleanText(batchId, 120));
    if (!batch || batch.status !== 'failed') throw new Error('只有失败批次可以重试');
    const members = snapshot.items.filter(item => batch.itemIds.includes(item.id) && item.batchId === batch.id);
    if (!members.length || members.some(item => item.status !== 'failed')) throw new Error('失败批次材料状态不一致');
    batch.status = 'retry-open';
    for (const item of members) { item.status = 'pending'; item.batchId = ''; item.reason = ''; }
    return snapshot;
  }

  function excludeItem(input, itemId, reason) {
    const snapshot = cloneSnapshot(input);
    const item = snapshot.items.find(entry => entry.id === cleanText(itemId, 240));
    const explanation = cleanText(reason, 1000);
    if (!item || !explanation) throw new TypeError('排除材料及理由必须有效');
    if (['processed', 'in-progress', 'returned'].includes(item.status)) throw new Error('当前材料状态不允许排除');
    item.status = 'excluded';
    item.batchId = '';
    item.reason = explanation;
    return snapshot;
  }

  function summarizeCoverage(input) {
    const snapshot = cloneSnapshot(input);
    const counts = { pending: 0, inProgress: 0, returned: 0, processed: 0, excluded: 0, failed: 0 };
    const keys = { pending: 'pending', 'in-progress': 'inProgress', returned: 'returned', processed: 'processed', excluded: 'excluded', failed: 'failed' };
    snapshot.items.forEach(item => { counts[keys[item.status]] += 1; });
    const complete = snapshot.inventoryComplete && snapshot.knownTotal === snapshot.items.length;
    const denominator = counts.processed + counts.excluded + counts.failed + counts.pending + counts.inProgress + counts.returned;
    const coveragePercent = complete && denominator > 0 ? Math.floor((counts.processed / denominator) * 100) : null;
    return { ...counts, discovered: snapshot.items.length, knownTotal: snapshot.knownTotal,
      inventoryComplete: complete, coveragePercent };
  }

  function normalizeCoverageSnapshot(input) {
    try {
      if (input.items.some(item => !item || !ITEM_STATUSES.has(item.status))
        || input.batches.some(batch => !batch || !BATCH_STATUSES.has(batch.status))) return null;
      const snapshot = cloneSnapshot(input);
      if (!snapshot.id || !SOURCE_KINDS.has(snapshot.sourceKind) || snapshot.items.length > MAX_ITEMS) return null;
      const ids = new Set();
      for (const item of snapshot.items) {
        if (ids.has(item.id)) return null;
        ids.add(item.id);
      }
      const batchIds = new Set();
      for (const batch of snapshot.batches) {
        if (!batch.id || batchIds.has(batch.id) || !Array.isArray(batch.itemIds)
          || new Set(batch.itemIds).size !== batch.itemIds.length || batch.itemIds.some(id => !ids.has(id))) return null;
        batchIds.add(batch.id);
      }
      const batches = new Map(snapshot.batches.map(batch => [batch.id, batch]));
      for (const item of snapshot.items) {
        if (!item.batchId) continue;
        const batch = batches.get(item.batchId);
        if (!batch || !batch.itemIds.includes(item.id)) return null;
        const expected = { 'in-progress': 'in-progress', 'result-returned': 'returned', confirmed: 'processed', failed: 'failed' }[batch.status];
        if (!expected || item.status !== expected) return null;
      }
      for (const batch of snapshot.batches) {
        if (batch.status === 'retry-open') {
          if (snapshot.items.some(item => item.batchId === batch.id || batch.itemIds.includes(item.id) && item.status !== 'pending')) return null;
          continue;
        }
        const expected = { 'in-progress': 'in-progress', 'result-returned': 'returned', confirmed: 'processed', failed: 'failed' }[batch.status];
        if (!expected || batch.itemIds.some(id => {
          const item = snapshot.items.find(entry => entry.id === id);
          return item.batchId !== batch.id || item.status !== expected;
        })) return null;
        if (batch.status === 'result-returned' && (!batch.promptVersionId || !batch.resultSummary)
          || batch.status === 'confirmed' && (!batch.confirmation || !batch.confirmedAt)
          || batch.status === 'failed' && !batch.reason) return null;
      }
      const history = [];
      for (const entry of Array.isArray(input.history) ? input.history.slice(-MAX_HISTORY) : []) {
        const normalizedEntry = normalizeCoverageSnapshot({ ...entry, history: [] });
        if (!normalizedEntry) return null;
        history.push(normalizedEntry);
      }
      snapshot.history = history;
      snapshot.inventoryComplete = snapshot.inventoryComplete && snapshot.knownTotal === snapshot.items.length;
      return snapshot;
    } catch { return null; }
  }

  return { createCoverageSnapshot, normalizeCoverageSnapshot, createNextBatch, recordBatchOutcome, confirmBatch, retryFailedBatch, excludeItem, summarizeCoverage };
});
