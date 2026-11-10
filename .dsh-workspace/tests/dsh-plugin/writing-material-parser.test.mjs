import test from 'node:test'
import assert from 'node:assert/strict'
import yazl from '../../dsh-plugin/forward-step-dsh/node_modules/yazl/index.js'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const packageRoot = resolve('dsh-plugin/forward-step-dsh')
const require = createRequire(resolve(packageRoot, 'package.json'))
const { createWritingMaterialParser } = require(resolve(packageRoot, 'core/writing-material-parser.cjs'))

async function makeDocx(entries = {}) {
  const zip = new yazl.ZipFile()
  const document = entries.document ?? '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>DOCX 摘录</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
  zip.addBuffer(Buffer.from(document), 'word/document.xml')
  if (entries.relationships) zip.addBuffer(Buffer.from(entries.relationships), 'word/_rels/document.xml.rels')
  if (entries.types) zip.addBuffer(Buffer.from(entries.types), '[Content_Types].xml')
  zip.end()
  const chunks = []
  for await (const chunk of zip.outputStream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function fakePdf(text = 'PDF 摘录') {
  return { getDocument() { return {
    promise: Promise.resolve({ numPages: 2, async getPage(page) { return {
      async getTextContent() { return { items: [{ str: `${text}${page}`, transform: [1, 0, 0, 1, 10, 700] }] } }, cleanup() {},
    } }, async destroy() {} }), async destroy() {},
  } } }
}

test('插件解析器本机解析 PDF 并保留页码与输出限额', async () => {
  const parser = createWritingMaterialParser({ pdfjs: fakePdf(), limits: { maxOutputChars: 7 } })
  const result = await parser.parse({ buffer: Buffer.from('%PDF-fixture'), mimeType: 'application/pdf' })
  assert.equal(result.ok, true)
  assert.equal(result.format, 'pdf')
  assert.equal(result.text.length, 7)
  assert.equal(result.truncated, true)
  assert.equal(result.pages[0].page, 1)
})

test('插件解析器抽取 DOCX 段落和表格并拒绝外部关系与宏', async () => {
  const parser = createWritingMaterialParser()
  const result = await parser.parse({ buffer: await makeDocx(), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  assert.equal(result.ok, true)
  assert.match(result.text, /DOCX 摘录/)
  assert.match(result.text, /表格内容/)
  assert.equal(result.format, 'docx')
  const external = await makeDocx({ relationships: '<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>' })
  assert.equal((await parser.parse({ buffer: external, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).error.code, 'PARSE_FAILED')
  const macro = await makeDocx({ types: '<Types>macroEnabled vbaProject</Types>' })
  assert.equal((await parser.parse({ buffer: macro, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).error.code, 'PARSE_FAILED')
})

test('插件解析器对超限、预取消和损坏文件返回安全错误', async () => {
  const parser = createWritingMaterialParser({ pdfjs: fakePdf(), limits: { maxInputBytes: 20 } })
  assert.equal((await parser.parse({ buffer: Buffer.from(`%PDF-${'too-large'.repeat(3)}`), mimeType: 'application/pdf' })).error.code, 'LIMIT_EXCEEDED')
  const controller = new AbortController()
  controller.abort()
  assert.equal((await parser.parse({ buffer: Buffer.from('%PDF-fixture'), mimeType: 'application/pdf', signal: controller.signal })).error.code, 'CANCELLED')
  const corrupt = await parser.parse({ buffer: Buffer.from('secret invalid PDF'), mimeType: 'application/pdf' })
  assert.equal(corrupt.ok, false)
  assert.doesNotMatch(JSON.stringify(corrupt), /secret invalid PDF|stack|[A-Z]:\\/)
})
