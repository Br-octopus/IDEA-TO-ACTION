import test from 'node:test'
import assert from 'node:assert/strict'
import { isCurrentMemoryViewRequest, toMemoryView } from '../../dsh-plugin/forward-step-dsh/client/memory.js'

const context = { projectId: 'p1', taskId: 't1', conversationId: 'c1', domain: 'writing' }
const state = {
  taskId: 't1', visibleMemoryIds: ['m1'], crossTaskMemoryIds: ['m1', 'm2'], currentTaskJobIds: ['j1'], visibleJobIds: ['j1', 'j2'],
  memories: [
    { memoryId: 'm1', taskId: 't1', key: 'tone', value: '简洁', status: 'active', sourceRefs: ['s1'] },
    { memoryId: 'm2', taskId: 't2', key: 'tone', value: '正式', status: 'candidate', sourceRefs: ['s2'] },
  ],
  sources: [
    { sourceId: 's1', kind: 'user-message', projectId: 'p1', taskId: 't1', conversationId: 'c1', locator: 'message:1', excerpt: '简洁表达', active: true },
    { sourceId: 's2', kind: 'material', projectId: 'p1', taskId: 't2', conversationId: 'c2', locator: 'file:deleted.txt', excerpt: '正式表达', active: false },
  ],
  changes: [{ eventId: 'e1', memoryId: 'm1', before: null, after: { value: '简洁' } }, { eventId: 'e2', memoryId: 'm2', before: null, after: { value: '正式' } }],
  jobs: [{ jobId: 'j1', taskId: 't1', status: 'completed' }, { jobId: 'j2', taskId: 't2', status: 'failed' }],
  profile: [{ key: 'tone', value: '简洁', memories: [{ memoryId: 'm1', revision: 2 }] }],
  usedMemories: [{ versionId: 'v1', usedMemories: [{ memoryId: 'm1', revision: 2 }] }], learningPaused: false,
}

test('默认只映射当前任务记录；显式跨任务后才出现跨任务摘要', () => {
  assert.deepEqual(toMemoryView(state, context).memories.map(memory => memory.memoryId), ['m1'])
  const crossTask = toMemoryView(state, context, { crossTask: true })
  assert.deepEqual(crossTask.memories.map(memory => memory.memoryId), ['m1', 'm2'])
  assert.equal(crossTask.jobs.length, 2)
})

test('只允许最新的同任务记忆视图请求提交结果', () => {
  assert.equal(isCurrentMemoryViewRequest(2, 2, 'task-a', 'task-a'), true)
  assert.equal(isCurrentMemoryViewRequest(1, 2, 'task-a', 'task-a'), false)
  assert.equal(isCurrentMemoryViewRequest(2, 2, 'task-a', 'task-b'), false)
})

test('来源失效显示状态而不提供伪定位，before/after 与生效状态保留原样', () => {
  const view = toMemoryView(state, context, { crossTask: true })
  assert.deepEqual(view.sources.find(source => source.sourceId === 's2'), { sourceId: 's2', kind: 'material', projectId: 'p1', taskId: 't2', conversationId: 'c2', locator: null, excerpt: '正式表达', active: false })
  assert.deepEqual(view.changes[0].before, null)
  assert.equal(view.memories.find(memory => memory.memoryId === 'm2').status, 'candidate')
})

test('实际使用记忆精确保留生成版本与 memory revision，旧任务响应不泄漏', () => {
  assert.deepEqual(toMemoryView(state, context).usedMemories, [{ versionId: 'v1', memoryId: 'm1', revision: 2 }])
  assert.deepEqual(toMemoryView(state, { ...context, taskId: 't2' }).memories, [])
})
