import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'

test('历史与任务一次提交，重开可读', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'state.sqlite')
  const first = openStore(path)
  first.transact(0, 'create-1', state => {
    state.tasks.push({ taskId: 't1', revision: 1 })
    state.changes.push({ eventId: 'create-1', reason: '创建任务' })
  })
  first.close()
  const reopened = openStore(path)
  const state = reopened.read()
  assert.equal(state.tasks[0].taskId, 't1')
  assert.equal(state.changes.length, 1)
  assert.equal(state.revision, 1)
  reopened.close()
})

test('initialState 每次返回互不共享的集合', async () => {
  const { initialState } = await import('../../dsh-plugin/forward-step-dsh/core/schema.js')
  const first = initialState()
  first.tasks.push({ taskId: 'only-first' })
  first.learning.jobs.push({ id: 'only-first' })
  const second = initialState()
  assert.deepEqual(second.tasks, [])
  assert.deepEqual(second.learning.jobs, [])
})

test('重复 eventId 是幂等的，不重复执行 mutate', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = openStore(join(dir, 'state.sqlite'))
  let calls = 0
  store.transact(0, 'same-event', state => { calls += 1; state.tasks.push({ taskId: 't1' }) })
  const replay = store.transact(0, 'same-event', state => { calls += 1; state.tasks.push({ taskId: 't2' }) })
  assert.equal(calls, 1)
  assert.equal(replay.revision, 1)
  assert.deepEqual(replay.tasks.map(task => task.taskId), ['t1'])
  store.close()
})

test('两个连接以相同预期版本写入时仅一个成功', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'state.sqlite')
  const first = openStore(path)
  const second = openStore(path)
  first.transact(0, 'first', state => state.tasks.push({ taskId: 'first' }))
  assert.throws(() => second.transact(0, 'second', state => state.tasks.push({ taskId: 'second' })), { code: 'conflict' })
  assert.deepEqual(first.read().tasks.map(task => task.taskId), ['first'])
  first.close()
  second.close()
})

test('mutate 抛错时任务和历史一起回滚', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = openStore(join(dir, 'state.sqlite'))
  assert.throws(() => store.transact(0, 'failed', state => {
    state.tasks.push({ taskId: 'partial' })
    state.changes.push({ eventId: 'failed' })
    throw new Error('模拟失败')
  }), { code: 'storage_failure' })
  assert.equal(store.read().revision, 0)
  assert.deepEqual(store.read().tasks, [])
  assert.deepEqual(store.read().changes, [])
  store.close()
})

test('异步 mutate 被拒绝且不提交', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = openStore(join(dir, 'state.sqlite'))
  assert.throws(() => store.transact(0, 'async', async state => { state.tasks.push({ taskId: 'partial' }) }), { code: 'invalid_input' })
  assert.equal(store.read().revision, 0)
  assert.deepEqual(store.read().tasks, [])
  store.close()
})

test('不支持的 schemaVersion 不覆盖原状态', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'state.sqlite')
  const seed = openStore(path)
  seed.close()
  const db = new DatabaseSync(path)
  const original = JSON.stringify({ schemaVersion: 2, revision: 7, preserved: true })
  db.prepare('UPDATE state SET body=? WHERE id=1').run(original)
  db.close()
  assert.throws(() => openStore(path), { code: 'invalid_input' })
  const verify = new DatabaseSync(path)
  assert.equal(verify.prepare('SELECT body FROM state WHERE id=1').get().body, original)
  verify.close()
})

test('read 返回副本，调用方修改不影响后续读取', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = openStore(join(dir, 'state.sqlite'))
  const state = store.read()
  state.tasks.push({ taskId: 'outside' })
  state.learning.jobs.push({ id: 'outside' })
  assert.deepEqual(store.read().tasks, [])
  assert.deepEqual(store.read().learning.jobs, [])
  store.close()
})

test('非法事务参数和已关闭存储明确返回错误', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = openStore(join(dir, 'state.sqlite'))
  assert.throws(() => store.transact(-1, '', () => {}), { code: 'invalid_input' })
  store.close()
  assert.throws(() => store.read(), { code: 'storage_failure' })
})
