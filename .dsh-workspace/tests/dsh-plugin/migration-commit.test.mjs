import test from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { commitImport } from '../../dsh-plugin/forward-step-dsh/core/migration/commit.js'
import { buildImportPreview } from '../../dsh-plugin/forward-step-dsh/core/migration/preview.js'

function setup() {
  const store = openStore(':memory:')
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', categories: { projects: [{ id: 'p1', name: 'new' }, { id: 'p2', name: 'same' }], prompts: [{ id: 'prompt-1' }] }, attachments: [], warnings: [], unknownFields: [] }
  const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
  return { store, parsedSource, preview }
}

test('导入按类别提交、相同 ID 不同内容保留为新副本，失败类别整体回滚', async () => {
  const { store, parsedSource, preview } = setup()
  try {
    const before = store.read()
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['projects', 'prompts'], store, eventId: 'import-1' })
    assert.equal(result.state.projects.length, 2)
    assert.equal(result.state.projects[0].id, 'p1')
    assert.equal(result.state.prompts.length, 1)
    assert.equal(result.state.importReceipts.length, 1)
    await assert.rejects(commitImport({ parsedSource, preview, selectedCategories: ['projects', 'unsupported'], store, eventId: 'import-2' }), { code: 'unsupported_category' })
    assert.equal(store.read().revision, result.state.revision)
    assert.equal(store.read().projects.length, 2)
    assert.ok(before.revision < result.state.revision)
  } finally { store.close() }
})

test('同 ID 但内容不同的记录以新 ID 导入，保留现有记录', async () => {
  const { store, parsedSource, preview } = setup()
  try {
    const before = store.read()
    await store.transact(before.revision, 'seed', state => { state.projects.push({ id: 'p1', name: 'existing' }) })
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['projects'], store, eventId: 'conflict-import' })
    assert.equal(result.state.projects.length, 3)
    assert.equal(result.state.projects[0].name, 'existing')
    assert.notEqual(result.state.projects[1].id, 'p1')
  } finally { store.close() }
})

test('专业包 ID 冲突时设置与历史快照跟随重映射 ID', async () => {
  const store = openStore(':memory:')
  const pack = { id: 'pack-source', name: '来源包', layer: 'task', version: 2, builtin: false, basePackId: '', prompts: [] }
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: {
    writingPacks: [pack], writingPackSettings: [{ id: pack.id, enabled: false, updatedAt: 'source-time', acceptedVersion: 3,
      acceptedPack: { ...pack, name: '已接受版本', version: 3 }, history: [{ ...pack, name: '历史版本', version: 1 }] }],
  } }
  try {
    await store.transact(0, 'seed-pack-id-conflict', state => state.writingPacks.push({ ...pack, name: '插件已有包', version: 1 }))
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['writingPacks', 'writingPackSettings'], store, eventId: 'pack-setting-remap' })
    const imported = result.state.writingPacks.find(item => item.name === '来源包')
    const setting = result.state.writingPackSettings.find(item => item.id === imported.id)
    assert.notEqual(imported.id, pack.id)
    assert.ok(setting)
    assert.equal(setting.enabled, false)
    assert.equal(setting.acceptedPack.id, imported.id)
    assert.equal(setting.history[0].id, imported.id)
  } finally { store.close() }
})

test('只导入设置时保留内置包配置并跳过孤立自建包设置', async () => {
  const store = openStore(':memory:')
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: {
    writingPackSettings: [{ id: 'builtin-article', enabled: false }, { id: 'pack-not-imported', enabled: false }],
  } }
  try {
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['writingPackSettings'], store, eventId: 'settings-only' })
    assert.deepEqual(result.state.writingPackSettings, [{ id: 'builtin-article', enabled: false, updatedAt: '' }])
    assert.equal(result.categoryResults[0].invalid, 1)
    assert.equal(result.categoryResults[0].count, 1)
  } finally { store.close() }
})

test('无效专业包 acceptedVersion 在预览和提交中都显式报告，不静默导入', async () => {
  const store = openStore(':memory:')
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: {
    writingPackSettings: [{ id: 'builtin-article', enabled: true, acceptedVersion: 0 }],
  } }
  try {
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    assert.equal(preview.categories.writingPackSettings.invalid, 1)
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['writingPackSettings'], store, eventId: 'invalid-pack-setting-version' })
    assert.equal(result.categoryResults[0].invalid, 1)
    assert.equal(result.categoryResults[0].count, 0)
    assert.equal(result.state.writingPackSettings.length, 0)
  } finally { store.close() }
})

test('超过专业包历史上限的来源设置预览和提交均显式拒绝', async () => {
  const store = openStore(':memory:')
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: {
    writingPackSettings: [{ id: 'builtin-article', enabled: true, history: Array.from({ length: 51 }, (_, index) => ({ id: 'builtin-article', name: '历史 ' + index, layer: 'task', version: index + 1 })) }],
  } }
  try {
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    assert.equal(preview.categories.writingPackSettings.invalid, 1)
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['writingPackSettings'], store, eventId: 'oversized-pack-history' })
    assert.equal(result.categoryResults[0].invalid, 1)
    assert.equal(result.categoryResults[0].count, 0)
    assert.equal(result.state.writingPackSettings.length, 0)
  } finally { store.close() }
})

test('已有专业包设置冲突时保持插件值并在结果中报告冲突', async () => {
  const store = openStore(':memory:')
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: {
    writingPackSettings: [{ id: 'builtin-article', enabled: false, updatedAt: 'source-time' }],
  } }
  try {
    await store.transact(0, 'seed-builtin-setting', state => state.writingPackSettings.push({ id: 'builtin-article', enabled: true, updatedAt: 'plugin-time' }))
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    assert.equal(preview.categories.writingPackSettings.conflict, 1)
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['writingPackSettings'], store, eventId: 'setting-conflict' })
    assert.deepEqual(result.state.writingPackSettings, [{ id: 'builtin-article', enabled: true, updatedAt: 'plugin-time' }])
    assert.equal(result.categoryResults[0].conflicts, 1)
    assert.equal(result.categoryResults[0].count, 0)
  } finally { store.close() }
})

test('有效的较高专业包修订号可迁移且保留内置副本关联', async () => {
  const store = openStore(':memory:')
  const pack = { id: 'future-revision', name: '未来修订内容', layer: 'task', version: 999, builtin: false, basePackId: 'builtin-article', prompts: [] }
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: { writingPacks: [pack] } }
  try {
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    assert.equal(preview.categories.writingPacks.invalid, 0)
    assert.equal(preview.warnings.some(item => item.code === 'unknown_pack_version'), false)
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['writingPacks'], store, eventId: 'high-pack-revision' })
    assert.equal(result.state.writingPacks[0].version, 999)
    assert.equal(result.state.writingPacks[0].basePackId, 'builtin-article')
  } finally { store.close() }
})

test('对象型知识元数据按键合并且保留插件已有冲突值', async () => {
  const store = openStore(':memory:')
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'knowledge-base', categories: { knowledgeMetadata: { schemaVersion: 2, sourceCount: 3, unknownField: 'ignored' } }, attachments: [], warnings: [], unknownFields: [] }
  try {
    await store.transact(0, 'seed-metadata', state => { state.knowledgeMetadata.schemaVersion = 1 })
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['knowledgeMetadata'], store, eventId: 'metadata-import' })
    assert.equal(result.state.knowledgeMetadata.schemaVersion, 1, '已有字段冲突保留插件值')
    assert.equal(result.state.knowledgeMetadata.sourceCount, 3)
    assert.equal(Object.hasOwn(result.state.knowledgeMetadata, 'unknownField'), false)
    assert.equal(result.categoryResults[0].count, 2)
  } finally { store.close() }
})

test('导入资料选择时按成功 ID 映射过滤无效项并报告数量', async () => {
  const store = openStore(':memory:')
  const parsedSource = {
    format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [],
    categories: { knowledgeEntries: [{ id: 'source-entry', title: '迁移资料' }], knowledgeSelection: ['source-entry', 'missing-entry', 'source-entry'] },
  }
  try {
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['knowledgeEntries', 'knowledgeSelection'], store, eventId: 'selection-map-import' })
    const targetId = result.state.knowledgeEntries[0].id
    assert.deepEqual(result.state.knowledgeSelection, [targetId])
    assert.equal(result.categoryResults.find(item => item.category === 'knowledgeSelection').invalid, 1)
    assert.equal(result.categoryResults.find(item => item.category === 'knowledgeSelection').duplicates, 1)
  } finally { store.close() }
})

test('没有一并导入所选资料类别时不沿用旧选择 ID', async () => {
  const store = openStore(':memory:')
  const parsedSource = {
    format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [],
    categories: { knowledgeEntries: [{ id: 'entry-existing', title: '已有' }], knowledgeSelection: ['entry-existing'] },
  }
  try {
    await store.transact(0, 'seed-selection-target', state => { state.knowledgeEntries.push({ id: 'entry-existing', title: '已有' }) })
    const preview = buildImportPreview({ parsedSource, pluginState: store.read(), selectedCategories: ['knowledgeSelection'] })
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['knowledgeSelection'], store, eventId: 'selection-without-entry-import' })
    assert.deepEqual(result.state.knowledgeSelection, [])
    assert.equal(result.categoryResults[0].invalid, 1)
  } finally { store.close() }
})

test('导入资料筛选只恢复受支持字段，未知值计入无效项', async () => {
  const store = openStore(':memory:')
  const parsedSource = {
    format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [],
    categories: { knowledgeFilters: { query: '检索词', domain: 'writing', unknownFilter: 'ignored' } },
  }
  try {
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['knowledgeFilters'], store, eventId: 'filter-import' })
    assert.equal(result.state.knowledgeFilters.query, '检索词')
    assert.equal(result.state.knowledgeFilters.domain, 'writing')
    assert.equal(Object.hasOwn(result.state.knowledgeFilters, 'unknownFilter'), false)
    assert.equal(result.categoryResults[0].invalid, 1)
  } finally { store.close() }
})

test('同一备份可分批补导不同类别，类别组合分别保持幂等', async () => {
  const { store, parsedSource } = setup()
  try {
    const firstPreview = buildImportPreview({ parsedSource, pluginState: store.read(), selectedCategories: ['projects'] })
    const first = await commitImport({ parsedSource, preview: firstPreview, selectedCategories: ['projects'], store, eventId: 'partial-a' })
    const secondPreview = buildImportPreview({ parsedSource, pluginState: store.read(), selectedCategories: ['prompts'] })
    const second = await commitImport({ parsedSource, preview: secondPreview, selectedCategories: ['prompts'], store, eventId: 'partial-b' })
    assert.equal(second.state.projects.length, 2)
    assert.equal(second.state.prompts.length, 1)
    assert.equal(second.state.importReceipts.length, 2)
    assert.ok(second.state.revision > first.state.revision)
  } finally { store.close() }
})

test('相同事件/来源重试幂等', async () => {
  const { store, parsedSource, preview } = setup()
  try {
    const first = await commitImport({ parsedSource, preview, selectedCategories: ['projects', 'prompts'], store, eventId: 'same-event' })
    const second = await commitImport({ parsedSource, preview, selectedCategories: ['projects', 'prompts'], store, eventId: 'same-event' })
    assert.equal(second.state.revision, first.state.revision)
    assert.equal(second.state.projects.length, 2)
    assert.equal(second.receiptId, first.receiptId)
  } finally { store.close() }
})

test('部分失败收据允许同一备份重试并更新为完成', async () => {
  const { store, parsedSource } = setup()
  let failOnce = true
  const transientFailureStore = {
    read: () => store.read(),
    async transact(revision, eventId, mutate) {
      if (failOnce && eventId.includes(':group:')) {
        failOnce = false
        throw Object.assign(new Error('模拟一次性事务故障'), { code: 'storage_failure' })
      }
      return store.transact(revision, eventId, mutate)
    },
  }
  try {
    const selectedCategories = ['projects', 'prompts']
    const preview = buildImportPreview({ parsedSource, pluginState: store.read(), selectedCategories })
    const partial = await commitImport({ parsedSource, preview, selectedCategories, store: transientFailureStore, eventId: 'retry-partial' })
    assert.equal(partial.state.importReceipts[0].status, 'partial-failure')
    assert.equal(partial.state.projects.length + partial.state.prompts.length, 1)

    const retryPreview = buildImportPreview({ parsedSource, pluginState: store.read(), selectedCategories })
    const retried = await commitImport({ parsedSource, preview: retryPreview, selectedCategories, store, eventId: 'retry-complete' })
    assert.equal(retried.state.importReceipts.length, 1)
    assert.equal(retried.state.importReceipts[0].status, 'completed')
    assert.equal(retried.state.projects.length, 2)
    assert.equal(retried.state.prompts.length, 1)
  } finally { store.close() }
})

test('跨类别引用跟随同内容目标 ID 与 ID 冲突副本重映射', async () => {
  const store = openStore(':memory:')
  const sourceAttachment = { id: 'attachment-1', taskId: 'task-source', type: 'text/plain', size: 1 }
  const parsedSource = {
    format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [],
    categories: {
      researchTasks: [{ id: 'task-source', title: 'same content' }, { id: 'task-conflict', title: 'import this' }],
      researchAttachments: [sourceAttachment],
    },
  }
  try {
    await store.transact(0, 'seed-migration-targets', state => {
      state.researchTasks.push({ id: 'task-plugin', title: 'same content' }, { id: 'task-conflict', title: 'existing different content' })
    })
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['researchTasks', 'researchAttachments'], store, eventId: 'reference-map-import' })
    assert.equal(result.state.researchTasks.length, 3)
    const reusedId = result.state.researchTasks.find(item => item.title === 'same content').id
    const copiedId = result.state.researchTasks.find(item => item.title === 'import this').id
    assert.equal(reusedId, 'task-plugin')
    assert.notEqual(copiedId, 'task-conflict')
    assert.equal(result.state.researchAttachments[0].taskId, reusedId)
    const receipt = result.state.importReceipts.find(item => item.receiptId === result.receiptId)
    assert.deepEqual(receipt.idMappings.find(item => item.sourceId === 'task-source'), { category: 'researchTasks', sourceId: 'task-source', targetId: reusedId })
    assert.deepEqual(receipt.idMappings.find(item => item.sourceId === 'task-conflict'), { category: 'researchTasks', sourceId: 'task-conflict', targetId: copiedId })
  } finally { store.close() }
})

test('歧义内容候选拒绝该依赖组且独立组仍可完成', async () => {
  const store = openStore(':memory:')
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: { projects: [{ id: 'source-id', name: 'duplicate' }], prompts: [{ id: 'prompt-independent' }] } }
  try {
    await store.transact(0, 'seed-ambiguous-duplicates', state => { state.projects.push({ id: 'target-a', name: 'duplicate' }, { id: 'target-b', name: 'duplicate' }) })
    const before = store.read()
    const preview = buildImportPreview({ parsedSource, pluginState: before })
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['projects', 'prompts'], store, eventId: 'ambiguous-import' })
    assert.equal(result.state.importReceipts[0].status, 'partial-failure')
    assert.equal(result.categoryResults[0].status, 'failed')
    assert.equal(result.categoryResults[0].errorCode, 'ambiguous_duplicate_content')
    assert.equal(store.read().projects.length, 2)
    assert.equal(store.read().prompts.length, 1, '独立依赖组应在项目组失败时仍成功导入')
    assert.ok(store.read().revision > before.revision, '失败收据应记录可恢复状态')
  } finally { store.close() }
})


test('已有任务可单独导入附件索引，缺失依赖时仅记录失败收据', async () => {
  const store = openStore(':memory:')
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: { researchAttachments: [{ id: 'attachment-1', taskId: 'task-existing', type: 'text/plain', size: 10 }] } }
  try {
    await store.transact(0, 'seed-existing-task', state => { state.researchTasks.push({ id: 'task-existing', title: 'existing' }) })
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    const imported = await commitImport({ parsedSource, preview, selectedCategories: ['researchAttachments'], store, eventId: 'attachment-only-import' })
    assert.equal(imported.state.researchAttachments[0].taskId, 'task-existing')

    const missing = structuredClone(parsedSource)
    missing.categories.researchAttachments[0].taskId = 'task-missing'
    const missingPreview = buildImportPreview({ parsedSource: missing, pluginState: store.read() })
    const before = store.read()
    const result = await commitImport({ parsedSource: missing, preview: missingPreview, selectedCategories: ['researchAttachments'], store, eventId: 'missing-dependency-import' })
    assert.equal(result.state.importReceipts.find(item => item.receiptId === result.receiptId).status, 'partial-failure')
    assert.equal(result.categoryResults[0].errorCode, 'missing_dependency')
    assert.equal(store.read().revision, before.revision + 1, '仅失败收据新增修订，数据事务保持回滚')
    assert.equal(store.read().researchAttachments.length, 1)
  } finally { store.close() }
})


test('依赖组失败时不提交半组记录，但独立提示词组仍可成功', async () => {
  const store = openStore(':memory:')
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: {
    researchTasks: [{ id: 'task-group' }],
    researchAttachments: [{ id: 'attachment-group', taskId: 'task-not-in-source', type: 'text/plain', size: 3 }],
    prompts: [{ id: 'prompt-independent' }],
  } }
  try {
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    const result = await commitImport({ parsedSource, preview, selectedCategories: Object.keys(parsedSource.categories), store, eventId: 'atomic-dependency-group' })
    const receipt = result.state.importReceipts.find(item => item.receiptId === result.receiptId)
    assert.equal(receipt.status, 'partial-failure')
    assert.equal(result.state.researchTasks.length, 0, '同组任务在附件引用失败时回滚')
    assert.equal(result.state.researchAttachments.length, 0, '同组附件索引不留悬空记录')
    assert.equal(result.state.prompts.length, 1, '独立类别继续完成')
    assert.equal(receipt.categoryResults.find(item => item.category === 'researchTasks').errorCode, 'missing_dependency')
  } finally { store.close() }
})

test('提交层防御性拒绝类别内重复来源 ID', async () => {
  const store = openStore(':memory:')
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: { projects: [{ id: 'duplicate-id' }, { id: 'duplicate-id' }] } }
  try {
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['projects'], store, eventId: 'duplicate-id-commit' })
    assert.equal(result.state.projects.length, 0)
    assert.equal(result.state.importReceipts.find(item => item.receiptId === result.receiptId).categoryResults[0].errorCode, 'duplicate_source_id')
  } finally { store.close() }
})


test('提交期间版本变化返回部分冲突收据且不覆盖并发状态', async () => {
  const store = openStore(':memory:')
  let raceOnce = true
  const racingStore = {
    read: () => store.read(),
    async transact(revision, eventId, mutate) {
      if (raceOnce) {
        raceOnce = false
        await store.transact(revision, 'concurrent-write', state => { state.projects.push({ id: 'concurrent-project' }) })
      }
      return store.transact(revision, eventId, mutate)
    },
  }
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: { projects: [{ id: 'import-project' }] } }
  try {
    const preview = buildImportPreview({ parsedSource, pluginState: store.read() })
    const result = await commitImport({ parsedSource, preview, selectedCategories: ['projects'], store: racingStore, eventId: 'race-import' })
    const receipt = result.state.importReceipts.find(item => item.receiptId === result.receiptId)
    assert.equal(receipt.status, 'partial-failure')
    assert.equal(receipt.categoryResults[0].errorCode, 'conflict')
    assert.deepEqual(result.state.projects.map(item => item.id), ['concurrent-project'])
  } finally { store.close() }
})
