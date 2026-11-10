import test from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { createWritingArticle, saveWritingWorkspace } from '../../dsh-plugin/forward-step-dsh/core/writing.js'
import { createWritingMaterialCoverage, createNextWritingMaterialBatch, recordWritingMaterialBatchOutcome, confirmWritingMaterialBatch, retryWritingMaterialBatch, excludeWritingMaterial, summarizeWritingMaterialCoverage } from '../../dsh-plugin/forward-step-dsh/core/writing-materials.js'

test('材料覆盖仅在人工确认后计完成，失败可重试并支持排除', () => {
  const base = createWritingArticle({ id: 'coverage-test', genre: 'article' })
  let workspace = createWritingMaterialCoverage(base, { sourceKind: 'knowledge-library', items: [{ id: 'source-a', title: '资料 A' }, { id: 'source-b', title: '资料 B' }, { id: 'source-c', title: '资料 C' }], knownTotal: 4, inventoryComplete: false })
  assert.equal(summarizeWritingMaterialCoverage(workspace).coveragePercent, null)
  const started = createNextWritingMaterialBatch(workspace, { batchSize: 1, promptVersionId: 'prompt-v1' })
  workspace = started.workspace
  assert.equal(summarizeWritingMaterialCoverage(workspace).inProgress, 1)
  assert.equal(summarizeWritingMaterialCoverage(workspace).processed, 0)
  workspace = recordWritingMaterialBatchOutcome(workspace, started.batch.id, { kind: 'returned', resultSummary: '已带回结果' })
  assert.equal(summarizeWritingMaterialCoverage(workspace).returned, 1)
  assert.equal(summarizeWritingMaterialCoverage(workspace).processed, 0)
  workspace = confirmWritingMaterialBatch(workspace, started.batch.id, { evidence: '人工核对通过' })
  assert.equal(summarizeWritingMaterialCoverage(workspace).processed, 1)
  assert.ok(workspace.materialCoverage.batches[0].confirmedAt)
  assert.equal(summarizeWritingMaterialCoverage(workspace).coveragePercent, null)
  const failedStart = createNextWritingMaterialBatch(workspace, { batchSize: 1, promptVersionId: 'prompt-v2' })
  workspace = recordWritingMaterialBatchOutcome(failedStart.workspace, failedStart.batch.id, { kind: 'failed', reason: '来源不可用' })
  workspace = retryWritingMaterialBatch(workspace, failedStart.batch.id)
  workspace = excludeWritingMaterial(workspace, 'source-c', '不属于本轮范围')
  assert.equal(workspace.materialCoverage.items.find(item => item.id === 'source-c').reason, '不属于本轮范围')
  assert.throws(() => createWritingMaterialCoverage(base, { sourceKind: 'authorized-directory', items: [] }), { code: 'unsupported_host' })
})

test('材料覆盖快照写入插件 SQLite 后关闭重开仍可恢复', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = mkdtempSync(join(tmpdir(), 'dsh-writing-coverage-'))
  const path = join(directory, 'state.sqlite')
  let store = openStore(path)
  try {
    const base = createWritingArticle({ id: 'persisted-coverage', genre: 'article' })
    let workspace = createWritingMaterialCoverage(base, { sourceKind: 'project-materials', items: [{ id: 'source-a', title: '资料 A' }], knownTotal: 1, inventoryComplete: true })
    const started = createNextWritingMaterialBatch(workspace, { promptVersionId: 'prompt-v1' })
    workspace = recordWritingMaterialBatchOutcome(started.workspace, started.batch.id, { kind: 'returned', resultSummary: '人工回带' })
    await saveWritingWorkspace(store, workspace, { expectedRevision: 0, eventId: 'save-coverage' })
  } finally { store.close() }
  store = openStore(path)
  try {
    const restored = store.read().writingArticles.find(item => item.id === 'persisted-coverage')
    assert.equal(restored.materialCoverage.batches[0].status, 'result-returned')
    assert.equal(restored.materialCoverage.items[0].status, 'returned')
    assert.equal(summarizeWritingMaterialCoverage(restored).processed, 0)
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})


