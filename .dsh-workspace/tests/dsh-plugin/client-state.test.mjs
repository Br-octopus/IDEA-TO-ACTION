import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientState, reduceClient } from '../../dsh-plugin/forward-step-dsh/client/state.js'

test('保存失败保留草稿并标记未保存，成功仅在确认后清理草稿', () => {
  const initial = createClientState()
  const changed = reduceClient(initial, { type: 'draft.changed', taskId: 'task-a', draft: '本地修订' })
  const failed = reduceClient(changed, { type: 'save.failed', taskId: 'task-a', draft: '本地修订' })
  assert.equal(failed.draftsByTask['task-a'], '本地修订')
  assert.equal(failed.saveStatusByTask['task-a'], 'unsaved')
  const saved = reduceClient(failed, { type: 'save.succeeded', taskId: 'task-a' })
  assert.equal(saved.draftsByTask['task-a'], undefined)
  assert.equal(saved.saveStatusByTask['task-a'], 'saved')
})

test('切换任务保留各自草稿，迟到请求不覆盖当前输出', () => {
  let state = reduceClient(createClientState(), { type: 'draft.changed', taskId: 'task-a', draft: 'A 草稿' })
  state = reduceClient(state, { type: 'draft.changed', taskId: 'task-b', draft: 'B 草稿' })
  state = reduceClient(state, { type: 'task.selected', taskId: 'task-b' })
  state = reduceClient(state, { type: 'request.started', taskId: 'task-a', requestId: 'req-old' })
  state = reduceClient(state, { type: 'request.started', taskId: 'task-b', requestId: 'req-current' })
  state = reduceClient(state, { type: 'request.completed', taskId: 'task-b', requestId: 'req-current', output: 'B 结果' })
  const afterLate = reduceClient(state, { type: 'request.late', taskId: 'task-a', requestId: 'req-old', output: 'A 迟到结果' })
  assert.equal(afterLate.outputByTask['task-b'], 'B 结果')
  assert.equal(afterLate.draftsByTask['task-a'], 'A 草稿')
  assert.equal(afterLate.draftsByTask['task-b'], 'B 草稿')
})

test('运行失败与取消只结束匹配请求，并保留本任务可见结果', () => {
  let state = reduceClient(createClientState(), { type: 'request.started', taskId: 'task-a', requestId: 'req-a' })
  state = reduceClient(state, { type: 'request.failed', taskId: 'task-a', requestId: 'req-old', output: '旧错误' })
  assert.equal(state.requestByTask['task-a'], 'req-a', '迟到错误不能清掉当前请求')
  state = reduceClient(state, { type: 'request.failed', taskId: 'task-a', requestId: 'req-a', output: '运行失败：网络不可用' })
  assert.equal(state.requestByTask['task-a'], null)
  assert.equal(state.outputByTask['task-a'], '运行失败：网络不可用')

  state = reduceClient(state, { type: 'request.started', taskId: 'task-a', requestId: 'req-b' })
  state = reduceClient(state, { type: 'request.cancelled', taskId: 'task-a', requestId: 'req-b', output: '当前任务已取消。' })
  assert.equal(state.requestByTask['task-a'], null)
  assert.equal(state.outputByTask['task-a'], '当前任务已取消。')
})

test('从持久化状态恢复名称草稿后仍标记为未同步', () => {
  const restored = reduceClient(createClientState(), { type: 'draft.restored', taskId: 'task-a', draft: '恢复的名称' })
  assert.equal(restored.draftsByTask['task-a'], '恢复的名称')
  assert.equal(restored.saveStatusByTask['task-a'], 'unsaved')
})

test('冲突同时保留本地草稿和服务器版本供用户处理', () => {
  const state = reduceClient(createClientState(), { type: 'conflict', taskId: 'task-a', localDraft: '本地内容', serverVersion: { revision: 9, title: '服务器标题' } })
  assert.equal(state.saveStatusByTask['task-a'], 'conflict')
  assert.equal(state.draftsByTask['task-a'], '本地内容')
  assert.deepEqual(state.conflictsByTask['task-a'].serverVersion, { revision: 9, title: '服务器标题' })
})

test('切换任务立即清空旧记忆视图，迟到的旧任务响应不覆盖新任务', () => {
  let state = reduceClient(createClientState(), { type: 'task.selected', taskId: 'task-a' })
  state = reduceClient(state, { type: 'memory.loaded', taskId: 'task-a', view: { taskId: 'task-a', memories: [{ value: 'A 私密内容' }] } })
  state = reduceClient(state, { type: 'task.selected', taskId: 'task-b' })
  assert.equal(state.memoryView, null)
  const late = reduceClient(state, { type: 'memory.loaded', taskId: 'task-a', view: { taskId: 'task-a', memories: [{ value: 'A 私密内容' }] } })
  assert.equal(late.memoryView, null)
})

test('记忆版本冲突和学习失败进入可见状态', () => {
  let state = reduceClient({ ...createClientState(), selectedTaskId: 'task-a' }, { type: 'memory.conflict', taskId: 'task-a', detail: { memoryId: 'm1' } })
  assert.deepEqual(state.memoryError, { kind: 'conflict', detail: { memoryId: 'm1' } })
  state = reduceClient(state, { type: 'learning.failed', taskId: 'task-a', jobId: 'j1', message: '网络暂不可用' })
  assert.deepEqual(state.memoryError, { kind: 'learning', jobId: 'j1', message: '网络暂不可用' })
})
