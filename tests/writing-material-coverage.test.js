const test = require('node:test');
const assert = require('node:assert/strict');

const coverage = require('../prototype/writing-material-coverage.js');

function fixture(overrides = {}) {
  return coverage.createCoverageSnapshot({
    id: 'coverage-a',
    sourceKind: 'knowledge-library',
    inventoryComplete: true,
    knownTotal: 3,
    items: [
      { id: 'source-a', title: '材料甲', sourceVersion: 'v1', relativePath: 'folder/a.md' },
      { id: 'source-b', title: '材料乙', sourceVersion: 'v1', relativePath: 'folder/b.md' },
      { id: 'source-c', title: '材料丙', sourceVersion: 'v2', relativePath: 'folder/c.md' }
    ],
    ...overrides
  });
}

test('范围快照保留来源相对位置和版本，不保留绝对路径', () => {
  const snapshot = coverage.createCoverageSnapshot({
    id: 'coverage-paths', sourceKind: 'authorized-directory', inventoryComplete: true, knownTotal: 1,
    items: [{ id: 'local:1', title: '材料', sourceVersion: 'sha256:abc', relativePath: 'chapters/a.md', absolutePath: 'D:/private/a.md' }]
  });
  assert.equal(snapshot.items[0].relativePath, 'chapters/a.md');
  assert.equal(snapshot.items[0].sourceVersion, 'sha256:abc');
  assert.equal('absolutePath' in snapshot.items[0], false);
});

test('只生成批次和带回结果都不计为外部已处理', () => {
  const initial = fixture();
  const started = coverage.createNextBatch(initial, { batchSize: 2, promptVersionId: 'prompt-1' });
  assert.equal(coverage.summarizeCoverage(started.snapshot).processed, 0);
  const returned = coverage.recordBatchOutcome(started.snapshot, started.batch.id, {
    kind: 'returned', promptVersionId: 'prompt-1', resultSummary: '已带回合成结果'
  });
  assert.equal(coverage.summarizeCoverage(returned).processed, 0);
  assert.equal(coverage.summarizeCoverage(returned).returned, 2);
});

test('只有显式确认并说明依据才将批次计入完成', () => {
  const started = coverage.createNextBatch(fixture(), { batchSize: 2, promptVersionId: 'prompt-1' });
  const returned = coverage.recordBatchOutcome(started.snapshot, started.batch.id, {
    kind: 'returned', promptVersionId: 'prompt-1', resultSummary: '合成回带'
  });
  assert.throws(() => coverage.confirmBatch(returned, started.batch.id, { evidence: '' }), /依据/);
  const confirmed = coverage.confirmBatch(returned, started.batch.id, { evidence: '用户确认本批材料已交给外部 AI 处理' });
  assert.equal(coverage.summarizeCoverage(confirmed).processed, 2);
  assert.throws(() => coverage.confirmBatch(confirmed, started.batch.id, { evidence: '重复确认' }), /状态/);
});

test('失败批次重试保留历史，但覆盖统计只计当前条目状态一次', () => {
  const started = coverage.createNextBatch(fixture(), { batchSize: 2, promptVersionId: 'prompt-1' });
  const failed = coverage.recordBatchOutcome(started.snapshot, started.batch.id, {
    kind: 'failed', reason: '合成失败'
  });
  assert.equal(coverage.summarizeCoverage(failed).failed, 2);
  const retried = coverage.retryFailedBatch(failed, started.batch.id);
  assert.equal(coverage.summarizeCoverage(retried).pending, 3);
  assert.equal(coverage.summarizeCoverage(retried).failed, 0);
  assert.equal(retried.batches[0].status, 'retry-open');
});

test('范围不完整或来源总数不符时不可显示完整覆盖率', () => {
  const snapshot = coverage.createCoverageSnapshot({
    id: 'coverage-incomplete', sourceKind: 'authorized-directory', inventoryComplete: false,
    knownTotal: 5, items: [{ id: 'source-a', title: '材料甲' }]
  });
  const summary = coverage.summarizeCoverage(snapshot);
  assert.equal(summary.inventoryComplete, false);
  assert.equal(summary.coveragePercent, null);
  assert.equal(summary.knownTotal, 5);
});

test('范围内来源 ID 必须唯一，不能让重复候选造成重复覆盖', () => {
  assert.throws(() => coverage.createCoverageSnapshot({
    id: 'coverage-duplicates', sourceKind: 'knowledge-library', items: [
      { id: 'same', title: '材料甲' }, { id: 'same', title: '材料乙' }
    ]
  }), /重复/);
});

test('范围创建不能伪造处理完成，恢复快照拒绝非法批次状态和悬空引用', () => {
  assert.throws(() => coverage.createCoverageSnapshot({ id: 'forged', sourceKind: 'knowledge-library',
    items: [{ id: 'source-a', status: 'processed' }] }), /状态/);
  const valid = coverage.createNextBatch(fixture(), { batchSize: 1, promptVersionId: 'prompt-1' }).snapshot;
  assert.equal(coverage.normalizeCoverageSnapshot({ ...valid, batches: [{ ...valid.batches[0], status: 'made-up' }] }), null);
  assert.equal(coverage.normalizeCoverageSnapshot({ ...valid, batches: [{ ...valid.batches[0], itemIds: ['missing'] }] }), null);
  assert.equal(coverage.normalizeCoverageSnapshot({ ...valid, items: [{ ...valid.items[0], batchId: '' }] }), null);
  assert.equal(coverage.normalizeCoverageSnapshot({ ...valid, items: [{ ...valid.items[0], status: 'processed' }] }), null);
});
