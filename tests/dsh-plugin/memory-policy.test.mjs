import test from 'node:test'
import assert from 'node:assert/strict'
import { inScope, selectMemories } from '../../dsh-plugin/forward-step-dsh/memory/policy.js'

const context = { projectId: 'p1', taskId: 't1', conversationId: 'c1', domain: 'ppt' }
const memory = (memoryId, key, value, scope = 'project', extra = {}) => ({
  memoryId, revision: 1, key, value, scope, domains: [], projectId: 'p1', taskId: 't1', conversationId: 'c1',
  status: 'active', sourceRefs: [`s-${memoryId}`], ...extra,
})
const stateWith = memories => ({
  memories,
  sources: memories.flatMap(item => (item.sourceRefs ?? []).map(sourceId => ({ sourceId, active: true, userAuthored: true }))),
  suppressions: [],
})

test('五种范围按项目、任务、对话和领域上下文过滤', () => {
  const cases = [
    [memory('g', 'language', 'zh', 'global'), context, true],
    [memory('d', 'tone', 'formal', 'domain', { domains: ['ppt'] }), context, true],
    [memory('p', 'slideDensity', 'low', 'project'), context, true],
    [memory('t', 'verbosity', 'low', 'task'), context, true],
    [memory('c', 'tone', 'friendly', 'conversation'), context, true],
    [memory('p2', 'x', 'x', 'project', { projectId: 'p2' }), context, false],
    [memory('t2', 'x', 'x', 'task', { taskId: 't2' }), context, false],
    [memory('c2', 'x', 'x', 'conversation', { conversationId: 'c2' }), context, false],
    [memory('other-domain', 'x', 'x', 'global', { domains: ['writing'] }), context, false],
    [memory('unknown', 'x', 'x', 'workspace'), context, false],
  ]
  for (const [item, ctx, expected] of cases) assert.equal(inScope(item, ctx), expected, item.memoryId)
  for (const [item, ctx, expected] of cases) {
    assert.equal(selectMemories(stateWith([item]), ctx).selected.length, expected ? 1 : 0, item.memoryId)
  }
})

test('不适用的范围和领域只返回 id 与原因，不泄漏记忆正文', () => {
  const item = memory('secret-memory', 'private-key', '不应暴露的正文', 'project', { projectId: 'p2', domains: ['writing'] })
  const result = selectMemories(stateWith([item]), context)
  assert.deepEqual(result.selected, [])
  assert.deepEqual(result.excluded, [{ memoryId: 'secret-memory', reason: 'scope' }])
  assert.equal(JSON.stringify(result).includes('不应暴露的正文'), false)
})

test('只选择 active 且有 active 来源的记忆，candidate、disabled、失效来源和抑制项均排除', () => {
  const items = [
    memory('candidate', 'a', 'a', 'global', { status: 'candidate' }),
    memory('disabled', 'b', 'b', 'global', { status: 'disabled' }),
    memory('source-off', 'c', 'c', 'global', { sourceRefs: ['dead'] }),
    memory('suppressed', 'd', 'd', 'global'),
  ]
  const state = stateWith(items)
  state.sources = state.sources.filter(source => source.sourceId !== 'dead')
  state.suppressions = [{ memoryId: 'suppressed', keyDigest: 'd', valueDigest: 'd' }]
  const result = selectMemories(state, context)
  assert.deepEqual(result.selected, [])
  assert.deepEqual(Object.fromEntries(result.excluded.map(item => [item.memoryId, item.reason])), {
    candidate: 'inactive', disabled: 'inactive', 'source-off': 'source', suppressed: 'suppressed',
  })
})

test('范围优先级选择更具体的值，同层冲突则不选', () => {
  const items = [
    memory('g', 'tone', 'general', 'global'),
    memory('d', 'tone', 'domain', 'domain', { domains: ['ppt'] }),
    memory('p', 'tone', 'project', 'project'),
    memory('t', 'tone', 'task', 'task'),
    memory('c', 'tone', 'conversation', 'conversation'),
    memory('c-conflict', 'tone', 'other-conversation', 'conversation'),
    memory('other-key', 'language', 'zh', 'global'),
  ]
  const result = selectMemories(stateWith(items), context)
  assert.deepEqual(result.selected.map(item => item.memoryId), ['other-key'])
  assert.deepEqual(result.excluded.filter(item => item.memoryId !== 'other-key').map(item => [item.memoryId, item.reason]), [
    ['g', 'overridden'], ['d', 'overridden'], ['p', 'overridden'], ['t', 'overridden'],
    ['c', 'conflict'], ['c-conflict', 'conflict'],
  ])
})

test('本次明确的 overrides 高于任何记忆并标记为 overridden', () => {
  const items = [memory('global-tone', 'tone', 'gentle', 'global'), memory('project-density', 'slideDensity', 'dense', 'project')]
  const result = selectMemories(stateWith(items), context, { overrides: [{ key: 'tone', value: 'direct' }] })
  assert.deepEqual(result.selected.map(item => item.memoryId), ['project-density'])
  assert.deepEqual(result.excluded, [{ memoryId: 'global-tone', reason: 'overridden' }])
})

test('最多选择三条，超出项以 budget 原因排除', () => {
  const items = Array.from({ length: 5 }, (_, index) => memory(`m${index}`, `k${index}`, `v${index}`, 'global'))
  const result = selectMemories(stateWith(items), context)
  assert.equal(result.selected.length, 3)
  assert.deepEqual(result.excluded, [
    { memoryId: 'm3', reason: 'budget' }, { memoryId: 'm4', reason: 'budget' },
  ])
  assert.deepEqual(selectMemories(stateWith(items), context, { limit: 99 }).selected.length, 3)
})

test('预算优先保留更具体的范围，而不依赖输入数组顺序', () => {
  const items = [
    memory('global', 'global-pref', 'broad', 'global'),
    memory('task', 'task-pref', 'specific', 'task'),
    memory('project', 'project-pref', 'project', 'project'),
  ]
  const result = selectMemories(stateWith(items), context, { limit: 1 })
  assert.deepEqual(result.selected.map(item => item.memoryId), ['task'])
  assert.deepEqual(result.excluded, [
    { memoryId: 'project', reason: 'budget' },
    { memoryId: 'global', reason: 'budget' },
  ])
})

test('缺少来源状态或非法预算时明确报 invalid_input', () => {
  assert.throws(() => selectMemories({ memories: [] }, context), error => error.code === 'invalid_input')
  assert.throws(() => selectMemories(stateWith([]), context, { limit: -1 }), error => error.code === 'invalid_input')
})
