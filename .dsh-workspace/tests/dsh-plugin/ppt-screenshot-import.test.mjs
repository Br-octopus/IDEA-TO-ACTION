import test from 'node:test'
import assert from 'node:assert/strict'
import { importPptScreenshots } from '../../dsh-plugin/forward-step-dsh/client/ppt-screenshot-import.js'

class FakeReader {
  readAsDataURL(file) { const signature = file.spoofed ? '/9j/' : file.type === 'image/png' ? 'iVBORw0KGgo=' : '/9j/'; this.result = 'data:' + file.type + ';base64,' + signature; this.onload() }
}

function file(name, type = 'image/png', size = 10, spoofed = false) { return { name, type, size, spoofed } }

test('截图导入保留逐页原图并把 OCR 文字作为待校对页面内容', async () => {
  const parsed = []
  const result = await importPptScreenshots([file('01.png'), file('02.jpg', 'image/jpeg')], {
    Reader: FakeReader,
    async parseImage(input, options) { parsed.push([input.name, options.mimeType]); return { ok: true, text: `第 ${parsed.length} 页文字`, confidence: parsed.length === 1 ? 54 : 91 } },
  })
  assert.equal(result.title, '截图导入（2 页）')
  assert.deepEqual(parsed, [['01.png', 'image/png'], ['02.jpg', 'image/jpeg']])
  assert.equal(result.slides[0].content, 'OCR 识别文字（待人工校对；置信度 54/100，建议重点校对）：\n第 1 页文字')
  assert.equal(result.slides[0].sourceImageName, '01.png')
  assert.match(result.slides[1].content, /置信度 91\/100，仍需校对/u)
  assert.match(result.limitations.join(' '), /1 张截图 OCR 置信度低于 70/u)
  assert.match(result.slides[0].imageDataUrl, /^data:image\/png;base64,/u)
  assert.match(result.slides[1].imageDataUrl, /^data:image\/jpeg;base64,/u)
  assert.match(result.limitations[0], /需同时附上对应原图/u)
  await assert.rejects(importPptScreenshots(Array.from({ length: 7 }, (_, index) => file(`${index}.png`, 'image/png', 3 * 1024 * 1024)), { Reader: FakeReader }), { code: 'invalid_input' })
})

test('OCR 失败保留截图并报告未提取页数', async () => {
  const progress = []
  const result = await importPptScreenshots([file('no-text.png')], { Reader: FakeReader, onProgress: value => progress.push(value), async parseImage() { return { ok: false } } })
  assert.match(result.slides[0].imageDataUrl, /^data:image\/png;base64,/u)
  assert.equal(result.slides[0].content, '')
  assert.match(result.limitations[1], /1 张截图未能提取文字/u)
  assert.deepEqual(progress, [{ completedImages: 1, totalImages: 1, pageNumber: 1 }])
})

test('screenshot OCR reports progress after successful and failed pages', async () => {
  const progress = []
  await importPptScreenshots([file('01.png'), file('02.png'), file('03.png')], {
    Reader: FakeReader,
    onProgress: value => progress.push(value),
    async parseImage(input) { return input.name === '02.png' ? { ok: false } : { ok: true, text: input.name } },
  })
  assert.deepEqual(progress, [
    { completedImages: 1, totalImages: 3, pageNumber: 1 },
    { completedImages: 2, totalImages: 3, pageNumber: 2 },
    { completedImages: 3, totalImages: 3, pageNumber: 3 },
  ])
})

test('截图导入拒绝越界批次、MIME 与真实文件签名不符并响应取消', async () => {
  await assert.rejects(importPptScreenshots([file('too-big.png', 'image/png', 3 * 1024 * 1024 + 1)], { Reader: FakeReader }), { code: 'invalid_input' })
  let ocrCalls = 0
  await assert.rejects(importPptScreenshots([file('spoofed.png', 'image/png', 10, true)], { Reader: FakeReader, async parseImage() { ocrCalls += 1 } }), { code: 'invalid_input' })
  assert.equal(ocrCalls, 0, '签名不匹配时不得调用 OCR')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(importPptScreenshots([file('cancelled.png')], { Reader: FakeReader, signal: controller.signal }), { code: 'cancelled' })
})


test('取消活动的截图 FileReader 会中止读取并立即结束导入', async () => {
  let reader
  class PendingReader {
    constructor() { reader = this }
    readAsDataURL() {}
    abort() { this.aborted = true; this.onabort?.() }
  }
  const controller = new AbortController()
  const pending = importPptScreenshots([file('pending.png')], { Reader: PendingReader, signal: controller.signal })
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, { code: 'cancelled' })
  assert.equal(reader.aborted, true)
})

test('截图 OCR 每页保留最多 3,000 字符并明确标记截断', async () => {
  const result = await importPptScreenshots([file('long.png')], { Reader: FakeReader, async parseImage() { return { ok: true, text: '字'.repeat(3200), confidence: 88 } } })
  assert.equal(result.slides[0].content.split('\n')[1].length, 3000)
  assert.match(result.slides[0].content, /识别文字已截断至每页 3,000 字符/u)
  assert.match(result.slides[0].content, /置信度 88\/100，仍需校对/u)
})
