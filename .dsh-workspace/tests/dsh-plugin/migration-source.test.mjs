import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSourceBackup, SOURCE_JSON_LIMITS } from '../../dsh-plugin/forward-step-dsh/core/migration/source.js'

const encode = value => new TextEncoder().encode(JSON.stringify(value))

test('解析完整工作区 JSON 并只保留已知类别', () => {
  const parsed = parseSourceBackup({ bytes: encode({ format: 'forward-step-workspace', schemaVersion: 1, scope: 'workspace', data: { projects: [{ id: 'p1' }], writingWorkspaces: [{ id: 'runtime-only' }], credentialToken: 'secret', customField: 'unsupported' } }) })
  assert.deepEqual(parsed.categories.projects, [{ id: 'p1' }])
  assert.equal(Object.hasOwn(parsed.categories, 'writingWorkspaces'), false)
  assert.deepEqual(parsed.unknownFields, ['customField'])
  assert.equal(parsed.excludedSensitiveCount, 1)
  assert.doesNotMatch(JSON.stringify(parsed), /credentialToken|secret|runtime-only/)
})

test('所有已知与未知字段中的凭证统一排除并只累计数量', () => {
  const parsed = parseSourceBackup({ bytes: encode({
    format: 'forward-step-workspace', schemaVersion: 1, scope: 'workspace',
    data: {
      projects: [{ id: 'p1', apiKey: 'k1', token: 't1', password: 'p1', cookie: 'c1', clientSecret: 's1', authorization: 'a1', authHeader: 'h1', sessionId: 'sid', profilePath: 'C:/private' }],
      credentialToken: 'top-secret',
      extensionData: { nested: { accessToken: 'nested-token', secret: 'nested-secret' }, sessionPath: 'C:/session' },
    },
  }) })
  assert.equal(parsed.excludedSensitiveCount, 13)
  assert.deepEqual(parsed.unknownFields, ['extensionData'])
  assert.doesNotMatch(JSON.stringify(parsed), /apiKey|token|password|cookie|clientSecret|authorization|authHeader|sessionId|profilePath|credentialToken|accessToken|secret|sessionPath|C:\\\\private|nested-token/)
})

test('资料库 JSON 只暴露三类支持数据且不伪称完整工作区', () => {
  const parsed = parseSourceBackup({ bytes: encode({ format: 'forward-step-workspace', schemaVersion: 1, scope: 'knowledge-base', data: { knowledgeEntries: [{ id: 'k1' }], cases: [], knowledgeMetadata: {}, prompts: [{ id: 'no' }] } }) })
  assert.equal(parsed.scope, 'knowledge-base')
  assert.deepEqual(Object.keys(parsed.categories), ['knowledgeEntries', 'cases', 'knowledgeMetadata'])
  assert.equal(parsed.attachments.length, 0)
})

test('拒绝未知格式、版本、畸形 JSON 和无效 UTF-8', () => {
  assert.throws(() => parseSourceBackup({ bytes: encode({ format: 'unknown' }) }), { code: 'unsupported_format' })
  assert.throws(() => parseSourceBackup({ bytes: encode({ format: 'forward-step-workspace', schemaVersion: 9 }) }), { code: 'unsupported_version' })
  assert.throws(() => parseSourceBackup({ bytes: new TextEncoder().encode('{') }), { code: 'invalid_json' })
  assert.throws(() => parseSourceBackup({ bytes: Uint8Array.from([0xff]) }), { code: 'invalid_encoding' })
})

test('拒绝原型污染字段且不产出可导入状态', () => {
  const malicious = '{"format":"forward-step-workspace","schemaVersion":1,"scope":"workspace","data":{"projects":[{"__proto__":{"polluted":true}}]}}'
  assert.throws(() => parseSourceBackup({ bytes: new TextEncoder().encode(malicious) }), { code: 'unsafe_key' })
  assert.equal({}.polluted, undefined)
})

test('拒绝重复来源 ID，且未知集合不会进入可导入类别', () => {
  assert.throws(() => parseSourceBackup({ bytes: encode({ format: 'forward-step-workspace', schemaVersion: 1, scope: 'workspace', data: { projects: [{ id: '1' }, { id: '1' }] } }) }), { code: 'duplicate_source_id' })
  const parsed = parseSourceBackup({ bytes: encode({ format: 'forward-step-workspace', schemaVersion: 1, scope: 'workspace', data: { tasks: [{ id: 't1' }] } }) })
  assert.deepEqual(parsed.categories, { researchSelection: [], knowledgeSelection: [], knowledgeFilters: {}, knowledgeMetadata: {} })
  assert.deepEqual(parsed.unknownFields, ['tasks'])
})

test('记录旧工作区备份缺少的选择与筛选字段', () => {
  const parsed = parseSourceBackup({ bytes: encode({ format: 'forward-step-workspace', schemaVersion: 1, scope: 'workspace', data: { knowledgeEntries: [] } }) })
  assert.deepEqual(parsed.missingFields, ['researchSelection', 'knowledgeSelection', 'knowledgeFilters', 'knowledgeMetadata'])
  assert.deepEqual(parsed.categories.researchSelection, [])
  assert.deepEqual(parsed.categories.knowledgeSelection, [])
  assert.deepEqual(parsed.categories.knowledgeFilters, {})
  assert.deepEqual(parsed.categories.knowledgeMetadata, {})

  const knowledge = parseSourceBackup({ bytes: encode({ format: 'forward-step-workspace', schemaVersion: 1, scope: 'knowledge-base', data: { knowledgeEntries: [] } }) })
  assert.deepEqual(knowledge.missingFields, ['knowledgeMetadata'])
  assert.deepEqual(knowledge.categories.knowledgeMetadata, {})
  assert.equal(Object.hasOwn(knowledge.categories, 'knowledgeSelection'), false, '资料库范围不应推断工作区选择字段')
  assert.equal(Object.hasOwn(knowledge.categories, 'knowledgeFilters'), false, '资料库范围不应推断工作区筛选字段')
})


test('JSON 导入在解析前执行文件大小、业务记录数和嵌套深度限制', () => {
  assert.equal(SOURCE_JSON_LIMITS.bytes, 128 * 1024 * 1024)
  assert.equal(SOURCE_JSON_LIMITS.records, 100_000)
  assert.equal(SOURCE_JSON_LIMITS.depth, 64)
  assert.throws(() => parseSourceBackup({ bytes: new Uint8Array(SOURCE_JSON_LIMITS.bytes + 1) }), { code: 'source_size_limit' })
  assert.throws(() => parseSourceBackup({ bytes: new TextEncoder().encode(JSON.stringify({ format: 'forward-step-workspace', schemaVersion: 1, scope: 'workspace', data: { projects: Array(SOURCE_JSON_LIMITS.records + 1).fill({ id: 'p' }) } })) }), { code: 'source_record_limit' })
  const deepValue = '['.repeat(SOURCE_JSON_LIMITS.depth + 1) + '0' + ']'.repeat(SOURCE_JSON_LIMITS.depth + 1)
  assert.throws(() => parseSourceBackup({ bytes: new TextEncoder().encode(deepValue) }), { code: 'source_depth_limit' })
  const stringBrackets = encode({ format: 'forward-step-workspace', schemaVersion: 1, scope: 'workspace', data: { projects: [{ id: 'quoted', note: 'brackets ] } and escaped quote \\" [' }] } })
  assert.equal(parseSourceBackup({ bytes: stringBrackets }).categories.projects[0].id, 'quoted')
})


test('JSON 深度扫描忽略字符串并拒绝不配对的括号', () => {
  const valid = encode({ format: 'forward-step-workspace', schemaVersion: 1, scope: 'workspace', data: { projects: [{ id: 'quoted', note: 'brackets ] } and escaped quote \\" [' }] } })
  assert.equal(parseSourceBackup({ bytes: valid }).categories.projects[0].id, 'quoted')
  for (const malformed of ['{]', '[}', '{[]}', '{"format":"forward-step-workspace"}}']) {
    assert.throws(() => parseSourceBackup({ bytes: new TextEncoder().encode(malformed) }), { code: 'invalid_json' })
  }
})
