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
const source = await readFile(resolve(pluginRoot, 'src/client/backup-panel.ts'), 'utf8')

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
  }
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const downloads = []
  const context = vm.createContext({
    module, exports: module.exports,
    require(name) { if (name === 'react') return React; throw new Error(`unexpected import: ${name}`) },
    btoa, atob, Blob, File, TextEncoder, Uint8Array, String, Set, Map, Date, setTimeout,
    URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:backup' }, revokeObjectURL() {} },
    document: { createElement() { return { click() {} } } },
    globalThis: { crypto: { randomUUID: () => 'backup-ui-event' } },
  })
  vm.runInContext(compiled, context, { filename: 'backup-panel.js' })
  const render = () => { cursor = 0; return module.exports.BackupPanel({ remote }) }
  return { render, downloads }
}

function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const child of node.children ?? []) { const result = find(child, predicate); if (result) return result }
}

function text(node) { return typeof node === 'string' ? node : node && typeof node === 'object' ? (node.children ?? []).map(text).join(' ') : '' }
const ok = value => ({ ok: true, value })

test('完整 ZIP 客户端先分块上传并只读预览，明确确认后才提交恢复', async () => {
  const calls = []
  const remote = {
    async beginPluginBackupImport(input) { calls.push(['begin', input.size]); return ok({ uploadId: 'zip-session', chunkBytes: 8 }) },
    async appendPluginBackupImportChunk(input) {
      const bytes = Buffer.from(input.dataBase64, 'base64').length
      calls.push(['chunk', input.index, bytes])
      const total = calls.filter(call => call[0] === 'chunk').reduce((sum, call) => sum + call[2], 0)
      return ok({ nextChunk: input.index + 1, bytes: total })
    },
    async previewPluginBackupImport(input) { calls.push(['preview', input.uploadId, input.mode]); return ok({ format: 'forward-step-dsh-backup-archive', formatVersion: 1, byteLength: 24, attachmentCount: 2, sha256: 'a'.repeat(64), currentRevision: 3, counts: { projects: 1 }, conflicts: [] }) },
    async restorePluginBackupArchive(input) { calls.push(['restore', input.uploadId, input.expectedRevision, input.confirmed]); return ok({ restored: true, revision: 4, receipt: { receiptId: 'receipt-zip', status: 'completed', attachmentResults: [{ sourceId: 'a', verified: true }] } }) },
    async cancelPluginBackupImport(input) { calls.push(['cancel', input.uploadId]); return ok({ cancelled: true }) },
    async finishPluginBackupImport(input) { calls.push(['finish', input.uploadId]); return ok({ finished: true }) },
  }
  const ui = harness(remote)
  let panel = ui.render()
  const fileInput = find(panel, node => node.type === 'input' && node.props.type === 'file')
  const file = new File([new Uint8Array(24)], 'plugin.zip', { type: 'application/zip' })
  await fileInput.props.onChange({ target: { files: [file] } })
  panel = ui.render()
  await find(panel, node => node.type === 'button' && node.children.includes('生成只读恢复预览')).props.onClick()
  panel = ui.render()
  assert.equal(calls.some(call => call[0] === 'restore'), false)
  assert.match(text(panel), /附件 2/)
  const confirmationLabel = find(panel, node => node.type === 'label' && text(node).includes('我已检查'))
  const confirmation = find(confirmationLabel, node => node.type === 'input' && node.props.type === 'checkbox')
  confirmation.props.onChange({ target: { checked: true } })
  panel = ui.render()
  await find(panel, node => node.type === 'button' && node.children.includes('确认恢复')).props.onClick()
  assert.deepEqual(calls.filter(call => call[0] === 'chunk').map(call => call[1]), [0, 1, 2])
  assert.deepEqual(calls.find(call => call[0] === 'restore'), ['restore', 'zip-session', 3, true])
  assert.match(text(ui.render()), /receipt-zip/)
})

test('完整 ZIP 导出按偏移接收并校验各块后下载', async () => {
  const calls = []
  const payload = [1, 2, 3, 4, 5, 6]
  const base64 = bytes => Buffer.from(bytes).toString('base64')
  const remote = {
    async beginPluginBackupExport() { return ok({ exportId: 'export-session', chunkBytes: 3, byteLength: 6, attachmentCount: 1, sha256: 'f'.repeat(64) }) },
    async readPluginBackupExportChunk(input) {
      calls.push(input.offset)
      const bytes = payload.slice(input.offset, input.offset + input.length)
      return ok({ offset: input.offset, dataBase64: base64(bytes), nextOffset: input.offset + bytes.length, byteLength: 6, sha256: 'f'.repeat(64), done: input.offset + bytes.length === 6 })
    },
    async cancelPluginBackupExport(input) { calls.push(['cancel', input.exportId]); return ok({ cancelled: true }) },
  }
  const ui = harness(remote)
  const panel = ui.render()
  await find(panel, node => node.type === 'button' && node.children.includes('导出完整 ZIP（含附件）')).props.onClick()
  assert.deepEqual(calls.slice(0, 2), [0, 3])
  assert.equal(ui.downloads.length, 1)
  assert.equal(ui.downloads[0].size, 6)
})
