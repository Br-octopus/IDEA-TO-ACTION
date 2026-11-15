import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPptHtmlPresentation, downloadPptHtmlPresentation } from '../../dsh-plugin/forward-step-dsh/core/ppt-html-export.js'

test('HTML 成品导出生成离线可播放且可打印的逐页演示', () => {
  const html = buildPptHtmlPresentation({
    title: '季度回顾',
    slides: [
      { title: '目标进展', body: ['完成三项交付', '待完成两项复盘'] },
      { title: '下一步', content: '确定负责人和时间表' },
    ],
  })
  assert.match(html, /<title>季度回顾<\/title>/u)
  assert.match(html, /id="slide-2"/u)
  assert.match(html, /scroll-snap-type:y mandatory/u)
  assert.match(html, /@media print/u)
  assert.match(html, /break-after:page/u)
  assert.match(html, /完成三项交付/u)
})

test('HTML 成品导出转义不可信标题和正文，不解释标签', () => {
  const html = buildPptHtmlPresentation({ title: '<script>alert(1)</script>', slides: [{ title: '<img src=x onerror=alert(2)>', body: ['<svg onload=alert(3)> & 注入'] }] })
  assert.doesNotMatch(html, /<script>alert/u)
  assert.doesNotMatch(html, /<img src=x/u)
  assert.doesNotMatch(html, /<svg onload/u)
  assert.match(html, /&lt;script&gt;/u)
  assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/u)
})

test('HTML 成品导出拒绝空页、空白页和超出页数/字符预算的数据', () => {
  assert.throws(() => buildPptHtmlPresentation({ slides: [] }), { code: 'invalid_input' })
  assert.throws(() => buildPptHtmlPresentation({ slides: [{ title: ' ', body: [] }] }), { code: 'invalid_input' })
  assert.throws(() => buildPptHtmlPresentation({ slides: Array.from({ length: 101 }, (_, index) => ({ title: String(index) })) }), { code: 'invalid_input' })
  assert.throws(() => buildPptHtmlPresentation({ slides: [{ title: 'title', body: 'x'.repeat(200001) }] }), { code: 'budget_exceeded' })
})

test('下载文件名清理路径和保留字符，并释放临时下载资源', () => {
  const appended = []
  const revoked = []
  const link = { click() { this.clicked = true }, remove() { this.removed = true } }
  const documentObject = { body: { append(node) { appended.push(node) } }, createElement: () => link }
  const urlApi = { createObjectURL: () => 'blob:test', revokeObjectURL: value => revoked.push(value) }
  const result = downloadPptHtmlPresentation({ title: '../报告:Q1?', slides: [{ title: '概览', body: '正文' }] }, documentObject, urlApi)
  assert.equal(result.filename, '..-报告-Q1-.html')
  assert.equal(result.slideCount, 1)
  assert.equal(link.clicked, true)
  assert.equal(link.removed, true)
  assert.deepEqual(appended, [link])
  return new Promise(resolve => setTimeout(() => { assert.deepEqual(revoked, ['blob:test']); resolve() }, 0))
})
