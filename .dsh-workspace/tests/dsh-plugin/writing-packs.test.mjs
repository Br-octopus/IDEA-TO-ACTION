import test from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import {
  confirmImportWritingPacks,
  compareWritingPackVersions,
  createWritingPackSnapshot,
  diffWritingPackVersions,
  deleteWritingPack,
  exportWritingPacks,
  listWritingPacks,
  previewImportWritingPacks,
  restoreBuiltinWritingPack,
  saveWritingPack,
  setWritingPackEnabled,
} from '../../dsh-plugin/forward-step-dsh/core/writing-packs.js'

const tx = (store, eventId) => ({ expectedRevision: store.read().revision, eventId })
const packInput = (overrides = {}) => ({
  name: 'Fixture article pack', layer: 'task', genre: 'article', taskType: '', version: 1,
  requirements: [{ id: 'fact-check', statement: 'Check each factual claim against a source.', sourceIds: [], verificationStatus: 'unverified' }],
  sources: [{ id: 'source-fixture', title: 'Fixture source', url: 'https://example.test/rules', version: '1', license: 'CC0', verificationStatus: 'source-reviewed' }],
  ...overrides,
})

test("任务类型和所选专业包会生成带版本的本轮快照", () => {
  const store = openStore(":memory:")
  try {
    const created = saveWritingPack(store, { pack: packInput({ id: "snapshot-article-pack" }) }, tx(store, "create-snapshot-pack"))
    const snapshot = createWritingPackSnapshot(store.read(), { genre: "article", taskType: "revision", selectedIds: [created.pack.id] })
    assert.deepEqual(snapshot.selectedIds, [created.pack.id])
    assert.equal(snapshot.packs.find(pack => pack.id === created.pack.id).version, 1)
    assert.ok(snapshot.entries.some(entry => entry.packId === created.pack.id))
  } finally { store.close() }
})
 
test('写作包列表包含内置与自建版本，并保留来源和启用状态', () => {
  const store = openStore(':memory:')
  try {
    const listed = listWritingPacks(store.read())
    assert.ok(listed.some(pack => pack.id === 'builtin-article' && pack.builtin))
    const created = saveWritingPack(store, { pack: packInput() }, tx(store, 'create-pack'))
    const updated = saveWritingPack(store, { packId: created.pack.id, pack: packInput({ name: 'Fixture article pack v2' }) }, tx(store, 'update-pack'))
    const history = updated.pack.history
    assert.equal(updated.pack.version, 2)
    assert.equal(history.length, 1)
    assert.equal(history[0].name, 'Fixture article pack')
    assert.equal(updated.pack.sources[0].license, 'CC0')
  } finally { store.close() }
})

test('pack version diff compares content and ignores management metadata', () => {
  const first = packInput({ id: 'versioned-pack', name: 'Old name', requirements: [{ id: 'r1', statement: 'Old requirement' }] })
  const second = {
    ...first,
    name: 'New name',
    requirements: [{ id: 'r1', statement: 'New requirement' }, { id: 'r2', statement: 'Added requirement' }],
    version: 2,
    enabled: false,
    history: [{ version: 1 }],
    updatedAt: '2026-11-07T00:00:00.000Z',
  }
  const changes = diffWritingPackVersions(first, second)
  assert.deepEqual(changes.map(change => change.path), ['name', 'requirements[r1].statement', 'requirements[r2]'])
  assert.deepEqual(changes[2], {
    path: 'requirements[r2]', before: null, after: second.requirements[1], beforeExists: false, afterExists: true,
  })
  assert.deepEqual(diffWritingPackVersions(first, { ...first, version: 99, enabled: false, updatedAt: 'later' }), [])
  assert.throws(() => diffWritingPackVersions([], second), { code: 'invalid_input' })
})

test('pack versions compare history against current and reject missing versions', () => {
  const store = openStore(':memory:')
  try {
    const created = saveWritingPack(store, { pack: packInput({ id: 'compare-pack', name: 'V1' }) }, tx(store, 'compare-create'))
    saveWritingPack(store, { packId: created.pack.id, pack: packInput({ name: 'V2' }) }, tx(store, 'compare-update'))
    const compared = compareWritingPackVersions(store.read(), { packId: 'compare-pack', leftVersion: 1, rightVersion: 2 })
    assert.equal(compared.changes.find(change => change.path === 'name').before, 'V1')
    assert.equal(compared.changes.find(change => change.path === 'name').after, 'V2')
    assert.throws(() => compareWritingPackVersions(store.read(), { packId: 'compare-pack', leftVersion: 4, rightVersion: 2 }), { code: 'not_found' })
  } finally { store.close() }
})

test('写作包可停用、重新启用、导出及删除而不碰内置包', () => {
  const store = openStore(':memory:')
  try {
    const created = saveWritingPack(store, { pack: packInput() }, tx(store, 'create-pack'))
    setWritingPackEnabled(store, { packId: created.pack.id, enabled: false }, tx(store, 'disable-pack'))
    assert.equal(listWritingPacks(store.read()).find(pack => pack.id === created.pack.id).enabled, false)
    setWritingPackEnabled(store, { packId: created.pack.id, enabled: true }, tx(store, 'enable-pack'))
    assert.equal(exportWritingPacks(store.read(), [created.pack.id])[0].id, created.pack.id)
    deleteWritingPack(store, { packId: created.pack.id }, tx(store, 'delete-pack'))
    assert.equal(listWritingPacks(store.read()).some(pack => pack.id === created.pack.id), false)
    assert.ok(listWritingPacks(store.read()).some(pack => pack.id === 'builtin-article'))
    assert.throws(() => deleteWritingPack(store, { packId: 'builtin-article' }, tx(store, 'delete-builtin')), { code: 'invalid_input' })
  } finally { store.close() }
})

test('内置包可停用并恢复默认，自建包导入先预览并降级验证状态', () => {
  const store = openStore(':memory:')
  try {
    setWritingPackEnabled(store, { packId: 'builtin-article', enabled: false }, tx(store, 'disable-builtin'))
    assert.equal(listWritingPacks(store.read()).find(pack => pack.id === 'builtin-article').enabled, false)
    restoreBuiltinWritingPack(store, { packId: 'builtin-article' }, tx(store, 'restore-builtin'))
    assert.equal(listWritingPacks(store.read()).find(pack => pack.id === 'builtin-article').enabled, true)

    const preview = previewImportWritingPacks([packInput({ id: 'imported-pack', verificationStatus: 'case-validated' })], store.read())
    assert.deepEqual(preview.collisions, [])
    assert.equal(preview.packs[0].sources[0].verificationStatus, 'unverified')
    const imported = confirmImportWritingPacks(store, preview, tx(store, 'import-pack'))
    assert.equal(imported.packs[0].id, 'imported-pack')
    assert.equal(exportWritingPacks(store.read(), ['imported-pack'])[0].sources[0].license, 'CC0')
  } finally { store.close() }
})

test('导入预览报告 ID 冲突且确认阶段再次拒绝旧预览', () => {
  const store = openStore(':memory:')
  try {
    const preview = previewImportWritingPacks([packInput({ id: 'builtin-article' })], store.read())
    assert.deepEqual(preview.collisions, ['builtin-article'])
    assert.throws(() => confirmImportWritingPacks(store, preview, tx(store, 'import-collision')), { code: 'conflict' })
  } finally { store.close() }
})
