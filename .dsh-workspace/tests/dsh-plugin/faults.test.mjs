import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'

const crashWriter = resolve('tests/dsh-plugin/fixtures/crash-writer.mjs')

test('SQLite 崩溃只保留完整事务，提交后立即退出仍可恢复新版本', t => {
  const directory = mkdtempSync(join(tmpdir(), 'forward-step-crash-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const databasePath = join(directory, 'state.sqlite')
  const seeded = openStore(databasePath)
  seeded.transact(0, 'seed', state => {
    state.tasks.push({ taskId: 'baseline-task' })
    state.changes.push({ eventId: 'seed', reason: '完整基线事务' })
  })
  seeded.close()

  const crashed = spawnSync(process.execPath, [crashWriter, databasePath, 'uncommitted'], { encoding: 'utf8' })
  assert.equal(crashed.status, 17, `故障子进程退出码应为 17；stderr=${crashed.stderr}`)
  const afterCrash = openStore(databasePath)
  assert.equal(afterCrash.read().revision, 1)
  assert.deepEqual(afterCrash.read().tasks.map(task => task.taskId), ['baseline-task'])
  assert.deepEqual(afterCrash.read().changes.map(change => change.eventId), ['seed'])
  afterCrash.close()

  const committed = spawnSync(process.execPath, [crashWriter, databasePath, 'committed'], { encoding: 'utf8' })
  assert.equal(committed.status, 0, `已提交后正常退出应为 0；stderr=${committed.stderr}`)
  const afterCommit = openStore(databasePath)
  assert.equal(afterCommit.read().revision, 2)
  assert.deepEqual(afterCommit.read().tasks.map(task => task.taskId), ['baseline-task', 'committed-task'])
  assert.deepEqual(afterCommit.read().changes.map(change => change.eventId), ['seed', 'committed'])
  afterCommit.close()
})
