import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pluginRoot = resolve(workspace, 'dsh-plugin/forward-step-dsh')
const require = createRequire(resolve(pluginRoot, 'package.json'))
const ts = require('typescript')
const panelPath = resolve(pluginRoot, 'src/client/migration-panel.ts')
const panelSource = await readFile(panelPath, 'utf8')

function harness(remote) {
  const state = []
  let cursor = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = initial
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = { current: initial }
      return state[index]
    },
    useEffect() {},
  }
  const compiled = ts.transpileModule(panelSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const context = vm.createContext({
    module, exports: module.exports,
    require(name) { if (name === 'react') return React; throw new Error(`unexpected import: ${name}`) },
    btoa, TextEncoder, Uint8Array, String, Set, Map, Date,
    globalThis: { crypto: { randomUUID: () => 'ui-event' } },
  })
  vm.runInContext(compiled, context, { filename: 'migration-panel.js' })
  const render = () => { cursor = 0; return module.exports.MigrationPanel({ remote }) }
  return { render, state }
}

function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const child of node.children ?? []) { const result = find(child, predicate); if (result) return result }
}
function text(node) { return typeof node === 'string' ? node : node && typeof node === 'object' ? (node.children ?? []).map(text).join(' ') : '' }
const ok = value => ({ ok: true, value })

test('ZIP 面板分块等待 ACK、预览仅读，确认后显示收据与来源映射', async () => {
  const calls = []
  const remote = {
    async listImportReceipts() { return ok({ receipts: [] }) },
    async beginArchiveImport(input) { calls.push(['begin', input.size]); return ok({ uploadId: 'upload-ui', chunkBytes: 72 * 1024 }) },
    async appendArchiveImportChunk(input) { calls.push(['chunk', input.index, Buffer.from(input.dataBase64, 'base64').length]); return ok({ nextChunk: input.index + 1, bytes: 0 }) },
    async previewArchiveImport(input) {
      calls.push(['preview', input.uploadId])
      return ok({ source: { format: 'forward-step-workspace-archive', formatVersion: 1 }, mode: 'workspace', excludedSensitiveCount: 2, settings: { credentials: { count: 2 } }, unsupportedStructures: [{ category: 'researchTasks', reason: 'invalid_fields', count: 1 }], sourceCoverage: [
        { category: 'researchTasks', sourceIncluded: true, supported: true, status: 'included', count: 1 },
        { category: 'knowledgeEntries', sourceIncluded: false, supported: true, status: 'missing_from_source', count: 0 },
        { category: 'writingWorkspaces', sourceIncluded: false, supported: false, status: 'not_exported_by_source_backup', count: 0 },
      ], attachments: { count: 1, payloadIncluded: true }, notIncludedCategories: [{ category: 'writingWorkspaces', reason: 'not_exported_by_source_backup' }], categories: { researchTasks: { status: 'ready', sourceCount: 1, conflict: 0, duplicate: 0, invalid: 0 }, researchAttachments: { status: 'ready', sourceCount: 1, conflict: 0, duplicate: 0, invalid: 0 } } })
    },
    async commitArchiveImport(input) { calls.push(['commit', input.uploadId, ...input.selectedCategories]); return ok({ receipt: { receiptId: 'receipt-ui', status: 'completed', categoryResults: [{ category: 'researchTasks', count: 1, status: 'imported' }], attachmentResults: [{ sourceId: 'a1', status: 'verified', verified: true }], idMappings: [{ sourceId: 't1', targetId: 't1' }] }, revision: 4 }) },
    async cancelArchiveImport(input) { calls.push(['cancel', input.uploadId]); return ok({ cancelled: true }) },
    async deleteImportReceipt() { return ok({ deleted: true, revision: 5 }) },
    async previewImport() { throw new Error('JSON path not expected') },
    async commitImport() { throw new Error('JSON path not expected') },
  }
  const ui = harness(remote)
  let panel = ui.render()
  const input = find(panel, node => node.type === 'input' && node.props.type === 'file')
  const file = new File([new Uint8Array(150_000)], 'workspace.zip', { type: 'application/zip' })
  await input.props.onChange({ target: { files: [file] } })
  panel = ui.render()
  assert.match(text(panel), /尚未写入插件数据/)
  await find(panel, node => node.type === 'button' && text(node) === '生成只读预览').props.onClick()
  panel = ui.render()
  assert.equal(calls.filter(item => item[0] === 'chunk').length, 3)
  assert.deepEqual(calls.map(item => item[0]), ['begin', 'chunk', 'chunk', 'chunk', 'preview'])
  assert.ok(find(panel, node => node.props?.['data-testid'] === 'migration-preview'))
  assert.match(text(panel), /writingWorkspaces：来源备份未包含此数据，本次不会导入。/)
  assert.match(text(panel), /旧应用设置：来源备份不包含/)
  assert.match(text(panel), /插件偏好：由插件管理/)
  assert.match(text(panel), /插件服务配置：由插件管理/)
  assert.match(text(panel), /DSH 宿主配置：由 DSH 管理/)
  assert.match(text(panel), /凭证：排除 2 项/)
  assert.match(text(panel), /来源覆盖情况（1\/3 类含有来源数据）/)
  assert.match(text(panel), /knowledgeEntries · 来源未包含 · 0 项/)
  assert.match(text(panel), /writingWorkspaces · 运行时存在但备份未导出 · 0 项/)
  assert.match(text(panel), /不支持或无效的已知结构（不会导入）：researchTasks 1 项/)
  const indexLabel = find(panel, node => node.type === 'label' && text(node).includes('researchAttachments'))
  const indexControl = find(indexLabel, node => node.type === 'input' && node.props.type === 'checkbox')
  assert.equal(indexControl.props.disabled, true, '附件索引不能与 ZIP 附件拆开选择')
  await find(panel, node => node.type === 'button' && text(node) === '确认导入所选类别').props.onClick()
  panel = ui.render()
  const commit = calls.find(item => item[0] === 'commit')
  assert.deepEqual(commit, ['commit', 'upload-ui', 'researchTasks', 'researchAttachments'])
  assert.match(text(panel), /摘要校验通过/)
  assert.match(text(panel), /来源 ID 映射：1 项/)
})

test('取消 ZIP 预览会清理上传会话且不提交', async () => {
  const calls = []
  const remote = {
    async listImportReceipts() { return ok({ receipts: [] }) },
    async beginArchiveImport() { return ok({ uploadId: 'cancel-me', chunkBytes: 72 * 1024 }) },
    async appendArchiveImportChunk(input) { calls.push(['chunk', input.index]); return ok({ nextChunk: input.index + 1, bytes: 4 }) },
    async previewArchiveImport() { return ok({ source: { format: 'forward-step-workspace-archive', formatVersion: 1 }, mode: 'workspace', attachments: { count: 0, payloadIncluded: true }, categories: { projects: { status: 'ready', sourceCount: 1, conflict: 0, duplicate: 0, invalid: 0 } } }) },
    async cancelArchiveImport(input) { calls.push(['cancel', input.uploadId]); return ok({ cancelled: true }) },
    async commitArchiveImport() { calls.push(['commit']); return ok({}) },
    async previewImport() { return ok({}) }, async commitImport() { return ok({}) }, async deleteImportReceipt() { return ok({ deleted: true, revision: 1 }) },
  }
  const ui = harness(remote)
  let panel = ui.render()
  const file = new File([new Uint8Array([1, 2, 3])], 'cancel.zip')
  await find(panel, node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [file] } })
  panel = ui.render()
  await find(panel, node => node.type === 'button' && text(node) === '生成只读预览').props.onClick()
  panel = ui.render()
  await find(panel, node => node.type === 'button' && text(node) === '取消').props.onClick()
  assert.deepEqual(calls, [['chunk', 0], ['cancel', 'cancel-me']])
  assert.equal(find(ui.render(), node => node.props?.['data-testid'] === 'migration-preview'), undefined)
})


test('分块上传过程中可立即取消 Host 会话并停止后续分块', async () => {
  const calls = []
  let finishChunk
  let startedChunk
  const firstChunk = new Promise(resolve => { finishChunk = resolve })
  const started = new Promise(resolve => { startedChunk = resolve })
  const remote = {
    async listImportReceipts() { return ok({ receipts: [] }) },
    async beginArchiveImport() { return ok({ uploadId: 'upload-active', chunkBytes: 72 * 1024 }) },
    async appendArchiveImportChunk(input) { calls.push(['chunk', input.index]); startedChunk(); return firstChunk },
    async previewArchiveImport() { calls.push(['preview']); return ok({}) },
    async cancelArchiveImport(input) { calls.push(['cancel', input.uploadId]); return ok({ cancelled: true }) },
    async commitArchiveImport() { calls.push(['commit']); return ok({}) },
    async previewImport() { return ok({}) }, async commitImport() { return ok({}) }, async deleteImportReceipt() { return ok({ deleted: true, revision: 1 }) },
  }
  const ui = harness(remote)
  let panel = ui.render()
  await find(panel, node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [new File([new Uint8Array(180_000)], 'active.zip')] } })
  panel = ui.render()
  const previewPromise = find(panel, node => node.type === 'button' && text(node) === '生成只读预览').props.onClick()
  await started
  panel = ui.render()
  await find(panel, node => node.type === 'button' && text(node) === '取消上传').props.onClick()
  finishChunk(ok({ nextChunk: 1, bytes: 72 * 1024 }))
  await previewPromise
  assert.deepEqual(calls, [['chunk', 0], ['cancel', 'upload-active']])
  assert.equal(find(ui.render(), node => node.props?.['data-testid'] === 'migration-preview'), undefined)
})


test('部分失败保留 ZIP 预览与收据错误码，允许用户检查后重试', async () => {
  const remote = {
    async listImportReceipts() { return ok({ receipts: [] }) },
    async beginArchiveImport() { return ok({ uploadId: 'partial-upload', chunkBytes: 72 * 1024 }) },
    async appendArchiveImportChunk(input) { return ok({ nextChunk: input.index + 1, bytes: 8 }) },
    async previewArchiveImport() { return ok({ source: { format: 'forward-step-workspace-archive', formatVersion: 1 }, mode: 'workspace', attachments: { count: 0, payloadIncluded: true }, categories: { projects: { status: 'ready', sourceCount: 1, conflict: 0, duplicate: 0, invalid: 0 } } }) },
    async commitArchiveImport() { return ok({ receipt: { receiptId: 'partial-receipt', status: 'partial-failure', categoryResults: [{ category: 'projects', count: 1, status: 'failed', errorCode: 'storage_failure' }], attachmentResults: [], idMappings: [] }, revision: 2 }) },
    async cancelArchiveImport() { return ok({ cancelled: true }) }, async deleteImportReceipt() { return ok({ deleted: true, revision: 3 }) },
    async previewImport() { return ok({}) }, async commitImport() { return ok({}) },
  }
  const ui = harness(remote)
  let panel = ui.render()
  await find(panel, node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [new File([new Uint8Array([1, 2])], 'partial.zip')] } })
  panel = ui.render()
  await find(panel, node => node.type === 'button' && text(node) === '生成只读预览').props.onClick()
  panel = ui.render()
  await find(panel, node => node.type === 'button' && text(node) === '确认导入所选类别').props.onClick()
  panel = ui.render()
  assert.match(text(panel), /部分类别未提交/)
  assert.match(text(panel), /storage_failure/)
  assert.ok(find(panel, node => node.props?.['data-testid'] === 'migration-preview'), '保留预览以便用户检查并重试')
  assert.match(text(panel), /partial-failure/)
})
