import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareSelectedKnowledgeFiles } from '../../dsh-plugin/forward-step-dsh/client/knowledge-files.js'

function file(name, text, relativePath = name) {
  return { name, size: Buffer.byteLength(text), webkitRelativePath: relativePath, async text() { return text } }
}

test('目录选择生成稳定、未验证且有大小上限的资料快照', async () => {
  const first = await prepareSelectedKnowledgeFiles([file('guide.md', '# 指南\n内容', '资料/guide.md')])
  const again = await prepareSelectedKnowledgeFiles([file('guide.md', '# 指南\n更新', '资料/guide.md')])
  assert.equal(first.entries.length, 1)
  assert.equal(first.entries[0].id, again.entries[0].id)
  assert.equal(first.entries[0].sourceId, 'local-folder:资料/guide.md')
  assert.equal(first.entries[0].verificationStatus, 'unverified')
  assert.match(first.entries[0].limitations, /不可信资料/)
  assert.equal(again.entries[0].contentExcerpt, '# 指南\n更新')
})

test('目录索引拒绝越界路径、二进制类型、重复路径与过大文件并逐项报告', async () => {
  const result = await prepareSelectedKnowledgeFiles([
    file('escape.md', 'secret', '../escape.md'),
    file('image.png', 'not-text'),
    file('same.txt', 'first', 'folder/same.txt'),
    file('same.txt', 'second', 'folder/same.txt'),
    file('large.txt', 'x'.repeat(512 * 1024 + 1)),
  ])
  assert.equal(result.entries.length, 1)
  assert.deepEqual(result.failures.map(item => item.code), ['unsupported_file', 'unsupported_file', 'duplicate_path', 'file_size_limit'])
  assert.equal(result.entries[0].title, 'same.txt')
})

test('目录索引限制单次最多 100 个文件且截断模型资料摘录', async () => {
  const result = await prepareSelectedKnowledgeFiles(Array.from({ length: 101 }, (_, index) => file(`${index}.txt`, 'a'.repeat(2000))))
  assert.equal(result.entries.length, 100)
  assert.equal(result.entries[0].contentExcerpt.length, 1200)
  assert.equal(result.failures.at(-1).code, 'file_count_limit')
})
