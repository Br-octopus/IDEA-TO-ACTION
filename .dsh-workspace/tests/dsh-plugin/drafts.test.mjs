import test from 'node:test'
import assert from 'node:assert/strict'
import { deleteTaskDraft, readTaskDraft, writeTaskDraft } from '../../dsh-plugin/forward-step-dsh/client/drafts.js'

function createStorage() {
  const values = new Map()
  return {
    values,
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
  }
}

test('草稿按项目和任务隔离，并合并任务名与外部结果字段', () => {
  const storage = createStorage()
  writeTaskDraft(storage, 'project-a', 'task-a', { title: '文章草稿' })
  writeTaskDraft(storage, 'project-a', 'task-a', { externalResult: { content: '正文草稿', feedback: '补充案例' } })
  writeTaskDraft(storage, 'project-a', 'task-b', { title: 'PPT 草稿' })
  writeTaskDraft(storage, 'project-b', 'task-a', { title: '另一个项目' })

  assert.deepEqual(readTaskDraft(storage, 'project-a', 'task-a'), {
    title: '文章草稿',
    externalResult: { content: '正文草稿', feedback: '补充案例' },
  })
  assert.deepEqual(readTaskDraft(storage, 'project-a', 'task-b'), { title: 'PPT 草稿' })
  assert.deepEqual(readTaskDraft(storage, 'project-b', 'task-a'), { title: '另一个项目' })
})

test('删除一个任务仅清理该项目该任务的草稿', () => {
  const storage = createStorage()
  writeTaskDraft(storage, 'project-a', 'task-a', { title: '待删除' })
  writeTaskDraft(storage, 'project-a', 'task-b', { title: '保留' })

  deleteTaskDraft(storage, 'project-a', 'task-a')

  assert.equal(readTaskDraft(storage, 'project-a', 'task-a'), null)
  assert.deepEqual(readTaskDraft(storage, 'project-a', 'task-b'), { title: '保留' })
})

test('清空最后一个草稿字段时移除本机条目，存储写入错误会向调用方报告', () => {
  const storage = createStorage()
  writeTaskDraft(storage, 'project-a', 'task-a', { title: '未保存名称' })
  writeTaskDraft(storage, 'project-a', 'task-a', { title: '' })
  assert.equal(readTaskDraft(storage, 'project-a', 'task-a'), null)

  const failingStorage = { ...storage, setItem() { throw new Error('quota exceeded') } }
  assert.throws(() => writeTaskDraft(failingStorage, 'project-a', 'task-b', { title: '本地草稿' }), /quota exceeded/)
})
