import test from 'node:test'
import assert from 'node:assert/strict'
import { buildImportPreview } from '../../dsh-plugin/forward-step-dsh/core/migration/preview.js'
import { sourceCategories } from '../../dsh-plugin/forward-step-dsh/core/migration/source.js'

test('对象型知识元数据和筛选也进入预览计数', () => {
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'knowledge-base', categories: { knowledgeMetadata: { 'entry-1': { favorite: true }, 'entry-2': { pinned: true } }, knowledgeFilters: { status: 'reviewed' } }, attachments: [], warnings: [], unknownFields: [] }
  const preview = buildImportPreview({ parsedSource, pluginState: { knowledgeMetadata: { 'entry-1': { favorite: true } }, knowledgeFilters: {} } })
  assert.equal(preview.categories.knowledgeMetadata.sourceCount, 2)
  assert.equal(preview.categories.knowledgeMetadata.duplicate, 1)
  assert.equal(preview.categories.knowledgeFilters.sourceCount, 1)
})

test('预览按类别计数冲突、重复、选择与敏感字段且不返回样本值', () => {
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', categories: { projects: [{ id: 'same', token: 'secret' }, { id: 'same' }, {}] }, attachments: [], warnings: [], unknownFields: [] }
  const preview = buildImportPreview({ parsedSource, pluginState: { projects: [{ id: 'same' }] }, selectedCategories: [] })
  assert.deepEqual(preview.categories.projects, { sourceCount: 3, selected: false, status: 'skipped', duplicate: 1, conflict: 1, invalid: 0 })
  assert.equal(preview.excludedSensitiveCount, 1)
  assert.doesNotMatch(JSON.stringify(preview), /secret|same/)
})

test('专业包预览按内容去重并让设置跟随冲突后的目标 ID', () => {
  const existingPack = { id: 'plugin-pack', name: '相同内容', layer: 'task', version: 1, builtin: false, basePackId: '', enabled: true, prompts: [] }
  const sourcePack = { ...existingPack, id: 'source-pack', version: 4, enabled: false, createdAt: 'source-time', updatedAt: 'source-time' }
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: {
    writingPacks: [sourcePack], writingPackSettings: [{ id: 'source-pack', enabled: false }],
  } }
  const preview = buildImportPreview({ parsedSource, pluginState: { writingPacks: [existingPack], writingPackSettings: [{ id: 'source-pack', enabled: true }] } })
  assert.equal(preview.categories.writingPacks.duplicate, 1)
  assert.equal(preview.categories.writingPacks.conflict, 0)
  assert.equal(preview.categories.writingPackSettings.conflict, 0, '设置目标是匹配内容的已有包 ID')
})

test('专业包 ID 冲突将设置映射到新副本，预览不误报设置冲突', () => {
  const sourcePack = { id: 'same-pack', name: '来源内容', layer: 'task', version: 1, builtin: false, basePackId: '', prompts: [] }
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: {
    writingPacks: [sourcePack], writingPackSettings: [{ id: sourcePack.id, enabled: false }],
  } }
  const preview = buildImportPreview({ parsedSource, pluginState: {
    writingPacks: [{ ...sourcePack, name: '插件内容' }],
    writingPackSettings: [{ id: sourcePack.id, enabled: true }],
  } })
  assert.equal(preview.categories.writingPacks.conflict, 1)
  assert.equal(preview.categories.writingPackSettings.conflict, 0)
})

test('专业包非法修订号在预览中报告，合法高修订只标记格式兼容未核验', () => {
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', attachments: [], warnings: [], unknownFields: [], categories: {
    writingPacks: [
      { id: 'invalid-pack', name: '非法修订', layer: 'task', version: 0 },
      { id: 'high-pack', name: '高修订', layer: 'task', version: 999 },
    ],
  } }
  const preview = buildImportPreview({ parsedSource, pluginState: { writingPacks: [] } })
  assert.equal(preview.categories.writingPacks.invalid, 1)
  assert.ok(preview.warnings.some(item => item.code === 'invalid_pack_revision' && item.count === 1))
  assert.ok(preview.warnings.some(item => item.code === 'pack_compatibility_unverified' && item.count === 1))
})

test('预览明确指出当前来源备份不包含运行时写作工作区', () => {
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', categories: { writingArticles: [] }, attachments: [], warnings: [], unknownFields: [] }
  const preview = buildImportPreview({ parsedSource, pluginState: { writingArticles: [], writingWorkspaces: [{ id: 'local-only' }] } })
  assert.deepEqual(preview.notIncludedCategories, [{ category: 'writingWorkspaces', reason: 'not_exported_by_source_backup' }])
  assert.equal(preview.categories.writingWorkspaces, undefined)
  assert.doesNotMatch(JSON.stringify(preview), /local-only/)
})

test('来源迁移预览分列旧应用设置、插件设置、DSH 配置与凭证排除', () => {
  const parsedSource = {
    format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace',
    categories: { projects: [] }, attachments: [], warnings: [], unknownFields: [], excludedSensitiveCount: 4,
  }
  const preview = buildImportPreview({ parsedSource, pluginState: {} })
  assert.deepEqual(preview.settings, {
    legacyApplication: { sourceIncluded: false, status: 'not_in_source_backup', reason: 'stored_separately' },
    pluginPreferences: { sourceIncluded: false, status: 'preserved', reason: 'plugin_owned_configuration' },
    pluginServiceConfig: { sourceIncluded: false, status: 'preserved', reason: 'plugin_owned_configuration', exportRequiresExplicitOptIn: true },
    dshHost: { sourceIncluded: false, status: 'host_managed', reason: 'managed_by_dsh' },
    credentials: { sourceIncluded: false, status: 'excluded', count: 4 },
  })
  assert.doesNotMatch(JSON.stringify(preview), /apiKey|secret|password|cookie|token|C:\\\\Users/)
})

test('来源覆盖表逐类区分存在、缺失、范围外和运行时未导出类别', () => {
  const known = [...sourceCategories]
  const categories = Object.fromEntries(known.map(category => [category, []]))
  delete categories.prompts
  const preview = buildImportPreview({ parsedSource: {
    format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', categories,
    missingFields: ['researchSelection', 'knowledgeSelection', 'knowledgeFilters', 'knowledgeMetadata'],
    attachments: [], warnings: [], unknownFields: [],
  }, pluginState: {} })
  const coverage = Object.fromEntries(preview.sourceCoverage.map(item => [item.category, item]))
  assert.equal(preview.sourceCoverage.length, known.length + 1)
  assert.equal(coverage.projects.status, 'included')
  assert.equal(coverage.prompts.status, 'missing_from_source')
  assert.equal(coverage.knowledgeMetadata.status, 'missing_from_source')
  assert.equal(coverage.writingWorkspaces.status, 'not_exported_by_source_backup')
  assert.equal(coverage.writingWorkspaces.supported, false)

  const knowledgeOnly = buildImportPreview({ parsedSource: {
    format: 'forward-step-workspace', formatVersion: 1, scope: 'knowledge-base',
    categories: { knowledgeEntries: [{ id: 'k1' }] }, attachments: [], warnings: [], unknownFields: [],
  }, pluginState: {} })
  const knowledgeCoverage = Object.fromEntries(knowledgeOnly.sourceCoverage.map(item => [item.category, item]))
  assert.equal(knowledgeCoverage.knowledgeEntries.status, 'included')
  assert.equal(knowledgeCoverage.projects.status, 'not_in_scope')
  assert.equal(knowledgeOnly.categories.projects, undefined, '范围外类别不得进入可提交列表')
})

test('预览说明旧备份缺失的资料状态将使用空选择、默认筛选和空元数据', () => {
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', categories: {}, missingFields: ['researchSelection', 'knowledgeSelection', 'knowledgeFilters', 'knowledgeMetadata'], attachments: [], warnings: [], unknownFields: [] }
  const preview = buildImportPreview({ parsedSource, pluginState: {} })
  assert.deepEqual(preview.defaultedFields, [
    { field: 'researchSelection', value: 'empty', reason: 'missing_from_source' },
    { field: 'knowledgeSelection', value: 'empty', reason: 'missing_from_source' },
    { field: 'knowledgeFilters', value: 'default', reason: 'missing_from_source' },
    { field: 'knowledgeMetadata', value: 'empty_object', reason: 'missing_from_source' },
  ])
})

test('预览暴露畸形资料状态字段的无效告警', () => {
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', categories: {}, missingFields: [], attachments: [], warnings: [{ code: 'invalid_category', category: 'knowledgeSelection' }], unknownFields: [] }
  const preview = buildImportPreview({ parsedSource, pluginState: {} })
  assert.deepEqual(preview.warnings, [{ code: 'invalid_category', category: 'knowledgeSelection' }])
  assert.deepEqual(preview.unsupportedStructures, [{ category: 'knowledgeSelection', reason: 'invalid_category', count: 1 }])
})

test('白名单过滤的已知类别子结构仅以类别和数量展示', () => {
  const parsedSource = {
    format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace',
    categories: { knowledgeMetadata: {} }, attachments: [], unknownFields: [], excludedSensitiveCount: 1,
    warnings: [{ code: 'invalid_fields', category: 'knowledgeMetadata', count: 2 }],
  }
  const preview = buildImportPreview({ parsedSource, pluginState: {} })
  assert.deepEqual(preview.unsupportedStructures, [{ category: 'knowledgeMetadata', reason: 'invalid_fields', count: 2 }])
  assert.doesNotMatch(JSON.stringify(preview), /providerPayload|privateValue|apiToken/)
})

test('选择字段按 ID 列表计数而不是按对象记录误报无效', () => {
  const parsedSource = { format: 'forward-step-workspace', formatVersion: 1, scope: 'workspace', categories: { knowledgeSelection: ['k1', 'k1', 'missing'] }, attachments: [], warnings: [], unknownFields: [] }
  const preview = buildImportPreview({ parsedSource, pluginState: { knowledgeSelection: ['k1'] } })
  assert.deepEqual(preview.categories.knowledgeSelection, { sourceCount: 3, selected: true, status: 'ready', duplicate: 1, conflict: 1, invalid: 0 })
})
