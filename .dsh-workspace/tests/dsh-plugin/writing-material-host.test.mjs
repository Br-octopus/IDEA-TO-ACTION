import test from 'node:test'
import assert from 'node:assert/strict'
import yazl from '../../dsh-plugin/forward-step-dsh/node_modules/yazl/index.js'
import { readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'

const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function makeDocx() {
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from('<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Host 已解析的材料内容</w:t></w:r></w:p></w:body></w:document>'), 'word/document.xml')
  zip.end()
  const chunks = []
  for await (const chunk of zip.outputStream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function activeUploads() {
  const names = await readdir(tmpdir())
  const matches = names.filter(name => name.startsWith('forward-step-material-'))
  return new Map(await Promise.all(matches.map(async name => [join(tmpdir(), name), (await stat(join(tmpdir(), name))).mtimeMs])))
}

function host() {
  return new ForwardStepProbe({ open: async () => { throw new Error('存储不应被调用') } })
}

test('Host 验证解析文件类型、块顺序并解析完整 DOCX', async () => {
  const service = host()
  try {
    await assert.rejects(service.beginWritingMaterialUpload({ sourceName: '材料.pdf', mimeType: docxMime, size: 10 }), { code: 'unsupported_file_type' })
    const bytes = await makeDocx()
    const started = await service.beginWritingMaterialUpload({ sourceName: '材料.docx', mimeType: docxMime, size: bytes.length })
    await assert.rejects(service.appendWritingMaterialChunk({ uploadId: started.uploadId, index: 1, dataBase64: bytes.toString('base64') }), { code: 'invalid_input' })
    const acknowledgement = await service.appendWritingMaterialChunk({ uploadId: started.uploadId, index: 0, dataBase64: bytes.toString('base64') })
    assert.deepEqual(acknowledgement, { nextChunk: 1, bytes: bytes.length })
    const parsed = await service.parseWritingMaterialUpload({ uploadId: started.uploadId })
    assert.equal(parsed.ok, true)
    assert.match(parsed.text, /Host 已解析的材料内容/)
    assert.deepEqual(await service.cancelWritingMaterialUpload({ uploadId: started.uploadId }), { cancelled: false })
  } finally { await service.dispose() }
})

test('Host 主动取消和卸载均清理材料临时文件', async () => {
  const before = await activeUploads()
  const service = host()
  const cancelled = await service.beginWritingMaterialUpload({ sourceName: '取消.docx', mimeType: docxMime, size: 12 })
  await service.appendWritingMaterialChunk({ uploadId: cancelled.uploadId, index: 0, dataBase64: Buffer.from('partial data').toString('base64') })
  assert.deepEqual(await service.cancelWritingMaterialUpload({ uploadId: cancelled.uploadId }), { cancelled: true })

  const pending = await service.beginWritingMaterialUpload({ sourceName: '卸载.docx', mimeType: docxMime, size: 12 })
  await service.appendWritingMaterialChunk({ uploadId: pending.uploadId, index: 0, dataBase64: Buffer.from('partial data').toString('base64') })
  await service.dispose()
  const after = await activeUploads()
  for (const path of after.keys()) if (!before.has(path)) assert.fail(`Host 未清理临时材料文件：${path}`)
})
