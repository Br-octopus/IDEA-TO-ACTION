import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const schema = require('../vendor/core/writing-workbench-schema.js')
const coverage = require('../vendor/core/writing-material-coverage.js')

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

function normalizeWorkspace(input) {
  const workspace = schema.normalizeWritingWorkspace(input)
  if (!workspace?.id || !workspace.article?.id || workspace.id !== workspace.article.id) {
    fail('invalid_input', '写作工作区无效')
  }
  return workspace
}

function withCoverage(input, materialCoverage) {
  return normalizeWorkspace({ ...input, materialCoverage })
}

function requireCoverage(workspace) {
  const snapshot = workspace.materialCoverage
  if (!snapshot) fail('not_found', '当前写作工作区尚无材料覆盖快照')
  return snapshot
}

export function createWritingMaterialCoverage(input, options = {}) {
  const workspace = normalizeWorkspace(input)
  if (options.sourceKind === 'authorized-directory') {
    fail('unsupported_host', '尚无经验证的 DSH 目录授权能力，不能创建授权目录覆盖快照')
  }
  if (!['knowledge-library', 'project-materials'].includes(options.sourceKind)) {
    fail('invalid_input', '材料覆盖来源类型无效')
  }
  return withCoverage(workspace, coverage.createCoverageSnapshot({
    ...options,
    id: options.id || `coverage-${workspace.id}`,
  }))
}

export function createNextWritingMaterialBatch(input, options = {}) {
  const workspace = normalizeWorkspace(input)
  const result = coverage.createNextBatch(requireCoverage(workspace), options)
  return { workspace: withCoverage(workspace, result.snapshot), batch: result.batch }
}

export function recordWritingMaterialBatchOutcome(input, batchId, outcome) {
  const workspace = normalizeWorkspace(input)
  const snapshot = coverage.recordBatchOutcome(requireCoverage(workspace), batchId, outcome)
  return withCoverage(workspace, snapshot)
}

export function confirmWritingMaterialBatch(input, batchId, confirmation) {
  const workspace = normalizeWorkspace(input)
  const snapshot = coverage.confirmBatch(requireCoverage(workspace), batchId, {
    ...confirmation,
    confirmedAt: confirmation?.confirmedAt || new Date().toISOString(),
  })
  return withCoverage(workspace, snapshot)
}

export function retryWritingMaterialBatch(input, batchId) {
  const workspace = normalizeWorkspace(input)
  const snapshot = coverage.retryFailedBatch(requireCoverage(workspace), batchId)
  return withCoverage(workspace, snapshot)
}

export function excludeWritingMaterial(input, itemId, reason) {
  const workspace = normalizeWorkspace(input)
  const snapshot = coverage.excludeItem(requireCoverage(workspace), itemId, reason)
  return withCoverage(workspace, snapshot)
}

export function summarizeWritingMaterialCoverage(input) {
  const workspace = normalizeWorkspace(input)
  return coverage.summarizeCoverage(requireCoverage(workspace))
}
