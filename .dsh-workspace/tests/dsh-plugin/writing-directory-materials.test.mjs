import { webcrypto } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceFilesToWritingMaterials } from '../../dsh-plugin/forward-step-dsh/client/writing-directory-materials.js'

const snapshot = { directoryPath: 'docs/research', bytes: 5, files: [{ relativePath: 'source.md', text: '事实摘录' }] }

test('DSH 目录快照生成稳定 ID、默认未选且保留来源定位', async () => {
  const [first] = await workspaceFilesToWritingMaterials(snapshot, { purpose: 'content', cryptoObject: webcrypto })
  const [second] = await workspaceFilesToWritingMaterials(snapshot, { purpose: 'content', cryptoObject: webcrypto })
  assert.equal(first.id, second.id)
  assert.equal(first.sourceId, first.id)
  assert.equal(first.selected, false)
  assert.equal(first.sourceLocator, 'docs/research/source.md')
  assert.equal(first.sourceType, 'dsh-workspace-directory')
  assert.equal(first.verificationStatus, 'unverified')
  assert.equal(first.excerpt, '事实摘录')
})

test('超长目录材料保留字符计数并截断摘录，路径哈希不随正文改动', async () => {
  const long = '字'.repeat(30_010)
  const [before] = await workspaceFilesToWritingMaterials({ directoryPath: '.', files: [{ relativePath: 'a.md', text: long }] }, { cryptoObject: webcrypto })
  const [after] = await workspaceFilesToWritingMaterials({ directoryPath: '.', files: [{ relativePath: 'a.md', text: '已更新正文' }] }, { cryptoObject: webcrypto })
  assert.equal(before.excerpt.length, 30_000)
  assert.equal(before.extractedCharacterCount, long.length)
  assert.equal(before.truncated, true)
  assert.equal(before.id, after.id)
})

test('拒绝越界路径、重复路径、错误用途和超限文件数', async () => {
  await assert.rejects(workspaceFilesToWritingMaterials({ directoryPath: '.', files: [{ relativePath: '../secret.md', text: 'x' }] }, { cryptoObject: webcrypto }), { code: 'invalid_directory_snapshot' })
  await assert.rejects(workspaceFilesToWritingMaterials({ directoryPath: '.', files: [{ relativePath: 'a.md', text: 'x' }, { relativePath: 'a.md', text: 'y' }] }, { cryptoObject: webcrypto }), { code: 'invalid_directory_snapshot' })
  await assert.rejects(workspaceFilesToWritingMaterials(snapshot, { purpose: 'unknown', cryptoObject: webcrypto }), { code: 'invalid_material_purpose' })
  await assert.rejects(workspaceFilesToWritingMaterials({ directoryPath: '.', files: Array(101).fill({ relativePath: 'a.md', text: 'x' }) }, { cryptoObject: webcrypto }), { code: 'invalid_directory_snapshot' })
})
