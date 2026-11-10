import { DatabaseSync } from 'node:sqlite'

const [databasePath, mode] = process.argv.slice(2)
if (!databasePath || !['uncommitted', 'committed'].includes(mode)) {
  throw new TypeError('用法: crash-writer.mjs <database> <uncommitted|committed>')
}

const database = new DatabaseSync(databasePath)
database.exec('PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE')
const state = JSON.parse(database.prepare('SELECT body FROM state WHERE id=1').get().body)
state.revision = mode === 'uncommitted' ? 999 : state.revision + 1
state.tasks.push({ taskId: mode === 'uncommitted' ? 'partial-task' : 'committed-task' })
state.changes.push({ eventId: mode, reason: mode === 'uncommitted' ? '未提交崩溃写入' : '已提交写入' })
database.prepare('UPDATE state SET body=? WHERE id=1').run(JSON.stringify(state))

if (mode === 'committed') database.exec('COMMIT')
process.exit(mode === 'uncommitted' ? 17 : 0)
