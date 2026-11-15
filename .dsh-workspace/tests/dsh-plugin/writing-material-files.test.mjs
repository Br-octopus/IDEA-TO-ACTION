import test from 'node:test'
import assert from 'node:assert/strict'
import { importSelectedTextMaterials, readSelectedFileBytes, readSelectedFileText, uploadAndParseSelectedFile } from '../../dsh-plugin/forward-step-dsh/client/material-files.js'

function file(name, text) { return { name, size: Buffer.byteLength(text), text } }
const options = overrides => ({
  purpose: 'content',
  async readText(item) { return item.text },
  createId: (() => { let id = 0; return () => `material-${++id}` })(),
  ...overrides,
})

test('单个或多个显式选择的文本文件成为未默认外发的材料记录', async () => {
  const result = await importSelectedTextMaterials([file('事实.txt', '证据内容'), file('风格.md', '表达样本')], options({ purpose: 'both' }))
  assert.deepEqual(result.materials.map(item => [item.title, item.purpose, item.selected, item.verificationStatus]), [
    ['事实.txt', 'both', false, 'unverified'], ['风格.md', 'both', false, 'unverified'],
  ])
  assert.equal(result.failures.length, 0)
})

test('PDF、DOCX 和图片的选中文件保留解析位置及未核验状态', async () => {
  const files = [{ name: '论文.pdf', size: 100 }, { name: '方案.docx', size: 200 }, { name: '截图.png', size: 300 }]
  const result = await importSelectedTextMaterials(files, options({
    async parseFile(item) { return { ok: true, format: item.name.endsWith('.pdf') ? 'pdf' : item.name.endsWith('.docx') ? 'docx' : 'image', text: `摘录：${item.name}`, characterCount: 2000, pageCount: item.name.endsWith('.pdf') ? 7 : 0, pages: [{ page: 3, start: 0, end: 8, method: 'pdf-text' }] } },
  }))
  assert.deepEqual(result.materials.map(item => [item.sourceType, item.contentStatus, item.verificationStatus, item.selected]), [
    ['pdf', 'parsed', 'unverified', false], ['docx', 'parsed', 'unverified', false], ['image', 'parsed', 'unverified', false],
  ])
  assert.equal(result.materials[0].pageCount, 7)
  assert.equal(result.materials[0].sourceLocator, 'page/3')
  assert.equal(result.materials[0].extractedCharacterCount, 2000)
})

test('解析失败保留失败材料卡且同批成功材料不丢失', async () => {
  const result = await importSelectedTextMaterials([{ name: 'ok.pdf', size: 100 }, { name: 'broken.docx', size: 100 }], options({
    async parseFile(item) { return item.name === 'broken.docx' ? { ok: false, error: { code: 'PARSE_FAILED' } } : { ok: true, format: 'pdf', text: '可读取摘录', characterCount: 5, pageCount: 1, pages: [] } },
  }))
  assert.equal(result.materials.length, 2)
  assert.equal(result.materials[0].contentStatus, 'parsed')
  assert.equal(result.materials[1].contentStatus, 'failed')
  assert.equal(result.materials[1].contentError, 'PARSE_FAILED')
  assert.equal(result.materials[1].excerpt, '')
  assert.deepEqual(result.failures, [{ fileName: 'broken.docx', code: 'PARSE_FAILED' }])
})

test('二进制文件超限或缺少解析器时不读取文件', async () => {
  let parses = 0
  const result = await importSelectedTextMaterials([{ name: 'large.pdf', size: 20 * 1024 * 1024 + 1 }, { name: 'unsupported.bin', size: 100 }], options({ async parseFile() { parses += 1; return { ok: true, text: '不得读取' } } }))
  assert.equal(parses, 0)
  assert.deepEqual(result.failures.map(item => item.code), ['file_size_limit', 'unsupported_file_type'])
  assert.equal(result.materials.length, 0)
})

test('二进制材料按 Host 块大小顺序上传并校验每个 ACK', async () => {
  const source = Buffer.alloc(100_000, 0x61)
  const uploaded = []
  let nextChunk = 0
  const remote = {
    async beginWritingMaterialUpload(input) { assert.equal(input.size, source.length); return { uploadId: 'upload-1', chunkBytes: 48 * 1024 } },
    async appendWritingMaterialChunk(input) {
      assert.equal(input.index, nextChunk)
      const bytes = Buffer.from(input.dataBase64, 'base64')
      uploaded.push(bytes)
      nextChunk += 1
      return { nextChunk, bytes: uploaded.reduce((sum, item) => sum + item.length, 0) }
    },
    async parseWritingMaterialUpload(input) { assert.equal(input.uploadId, 'upload-1'); return { ok: true, format: 'pdf', text: '已解析材料', pages: [] } },
    async cancelWritingMaterialUpload() { assert.fail('成功解析不得触发清理 RPC') },
  }
  const arrayBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
  const result = await uploadAndParseSelectedFile({ name: '材料.pdf', arrayBuffer: async () => arrayBuffer }, { mimeType: 'application/pdf', remote })
  assert.equal(result.text, '已解析材料')
  assert.deepEqual(Buffer.concat(uploaded), source)
  assert.equal(uploaded.length, 3)
})

test('文件解析失败或取消时清理 Host 临时上传', async () => {
  const source = Buffer.from('cancel me')
  let cancellations = 0
  const controller = new AbortController()
  const remote = {
    async beginWritingMaterialUpload() { return { uploadId: 'upload-cancel', chunkBytes: 48 * 1024 } },
    async appendWritingMaterialChunk() { return { nextChunk: 1, bytes: source.length } },
    async parseWritingMaterialUpload() { controller.abort(); throw Object.assign(new Error('cancelled'), { code: 'cancelled' }) },
    async cancelWritingMaterialUpload() { cancellations += 1; return { cancelled: true } },
  }
  const arrayBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
  await assert.rejects(uploadAndParseSelectedFile({ name: '材料.pdf', arrayBuffer: async () => arrayBuffer }, { mimeType: 'application/pdf', remote, signal: controller.signal }), { code: 'cancelled' })
  assert.equal(cancellations, 1)
})

test('二进制解析期间取消会丢弃本批次临时材料', async () => {
  const controller = new AbortController()
  let parses = 0
  await assert.rejects(importSelectedTextMaterials([{ name: 'first.pdf', size: 100 }, { name: 'second.docx', size: 100 }], options({ signal: controller.signal, async parseFile() { parses += 1; controller.abort(); return { ok: true, text: '临时摘录' } } })), { code: 'cancelled' })
  assert.equal(parses, 1)
})

test('不支持类型和解析失败逐文件报告，其余成功文件仍可保留', async () => {
  const result = await importSelectedTextMaterials([file('ok.txt', '可读取'), file('script.js', 'alert(1)'), file('broken.md', 'broken')], options({
    async readText(item) { if (item.name === 'broken.md') throw new Error('decode failure'); return item.text },
  }))
  assert.deepEqual(result.materials.map(item => item.title), ['ok.txt'])
  assert.deepEqual(result.failures, [
    { fileName: 'script.js', code: 'unsupported_file_type' },
    { fileName: 'broken.md', code: 'read_failed' },
  ])
})

test('超过单文件和批次上限时不读取超限内容', async () => {
  let reads = 0
  const result = await importSelectedTextMaterials([
    { name: 'large.txt', size: 512 * 1024 + 1 },
    { name: 'first.txt', size: 512 * 1024, text: 'a' },
    { name: 'second.txt', size: 512 * 1024, text: 'b' },
    { name: 'third.txt', size: 512 * 1024, text: 'c' },
    { name: 'fourth.txt', size: 512 * 1024, text: 'd' },
    { name: 'fifth.txt', size: 512 * 1024, text: 'e' },
  ], options({ async readText(item) { reads += 1; return item.text } }))
  assert.equal(reads, 4)
  assert.equal(result.materials.length, 4)
  assert.ok(result.failures.some(item => item.fileName === 'large.txt' && item.code === 'file_size_limit'))
  assert.ok(result.failures.some(item => item.fileName === 'fifth.txt' && item.code === 'batch_size_limit'))
})

test('取消时丢弃本批次的临时结果，并停止读取后续文件', async () => {
  const controller = new AbortController()
  let reads = 0
  await assert.rejects(importSelectedTextMaterials([file('first.txt', 'first'), file('second.txt', 'second')], options({
    signal: controller.signal,
    async readText(item) { reads += 1; if (reads === 1) controller.abort(); return item.text },
  })), { code: 'cancelled' })
  assert.equal(reads, 1)
})

test('实际 FileReader 适配器中止活动读取并拒绝为取消', async () => {
  let reader
  class PendingReader {
    constructor() { reader = this; this.readyState = 1 }
    readAsText() {}
    abort() { this.readyState = 2; this.onabort?.() }
  }
  const controller = new AbortController()
  const pending = readSelectedFileText(file('等待.txt', '内容'), controller.signal, PendingReader)
  controller.abort()
  await assert.rejects(pending, { code: 'cancelled' })
  assert.equal(reader.readyState, 2)
})

test('二进制 FileReader 适配器取消时中止活动读取', async () => {
  let reader
  class PendingReader {
    constructor() { reader = this; this.readyState = 1 }
    readAsArrayBuffer() {}
    abort() { this.readyState = 2; this.onabort?.() }
  }
  const controller = new AbortController()
  const pending = readSelectedFileBytes({ name: 'pending.pdf' }, controller.signal, PendingReader)
  controller.abort()
  await assert.rejects(pending, { code: 'cancelled' })
  assert.equal(reader.readyState, 2)
})

test('FileReader 读取错误以失败项返回并保留同批次成功材料', async () => {
  class FailingReader {
    readAsText(input) {
      if (input.name === 'broken.txt') {
        this.error = new Error('decode failure')
        this.onerror?.()
      } else {
        this.result = input.text
        this.onload?.()
      }
    }
    abort() { this.onabort?.() }
  }
  const result = await importSelectedTextMaterials(
    [file('ok.txt', '可保留'), file('broken.txt', '损坏')],
    options({ readText: item => readSelectedFileText(item, undefined, FailingReader) }),
  )
  assert.deepEqual(result.materials.map(item => item.title), ['ok.txt'])
  assert.deepEqual(result.failures, [{ fileName: 'broken.txt', code: 'read_failed' }])
})

test('第二个文件读取时取消会中止当前读取并丢弃已读取的临时材料', async () => {
  let activeReader
  class SecondFilePendingReader {
    readAsText(input) {
      if (input.name === 'first.txt') {
        this.result = input.text
        this.onload?.()
        return
      }
      activeReader = this
      this.readyState = 1
    }
    abort() { this.readyState = 2; this.onabort?.() }
  }
  const controller = new AbortController()
  const pending = importSelectedTextMaterials(
    [file('first.txt', '临时内容'), file('second.txt', '等待读取')],
    options({ signal: controller.signal, readText: item => readSelectedFileText(item, controller.signal, SecondFilePendingReader) }),
  )
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, { code: 'cancelled' })
  assert.equal(activeReader.readyState, 2)
})
