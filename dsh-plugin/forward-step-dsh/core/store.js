import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { initialState } from './schema.js'

function codedError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.code = code
  return error
}

function validateState(state) {
  if (!state || typeof state !== 'object' || state.schemaVersion !== 1) {
    throw codedError('invalid_input', '存储 schemaVersion 不受支持；原文件已保留')
  }
  if (!Number.isInteger(state.revision) || !Array.isArray(state.processedEvents)) {
    throw codedError('storage_failure', '持久化状态结构无效')
  }
  return state
}

function cloneState(state) {
  return structuredClone(state)
}

export function openStore(filename) {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw codedError('invalid_input', '存储路径不能为空')
  }
  const databasePath = filename === ':memory:' ? filename : resolve(filename)
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })

  let db
  try {
    db = new DatabaseSync(databasePath)
    db.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL')
    db.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)')
    db.prepare('INSERT OR IGNORE INTO state (id, body) VALUES (1, ?)').run(JSON.stringify(initialState()))
  } catch (cause) {
    try { db?.close() } catch {}
    if (cause?.code === 'invalid_input') throw cause
    throw codedError('storage_failure', '无法打开插件持久化存储', cause)
  }

  let closed = false
  const assertOpen = () => {
    if (closed) throw codedError('storage_failure', '插件存储已关闭')
  }
  const read = () => {
    assertOpen()
    try {
      const row = db.prepare('SELECT body FROM state WHERE id=1').get()
      if (!row) throw codedError('storage_failure', '持久化状态记录缺失')
      return cloneState(validateState(JSON.parse(row.body)))
    } catch (cause) {
      if (cause?.code === 'invalid_input' || cause?.code === 'storage_failure') throw cause
      throw codedError('storage_failure', '无法读取插件持久化状态', cause)
    }
  }
  const transact = (expectedRevision, eventId, mutate) => {
    assertOpen()
    if (!eventId || typeof eventId !== 'string' || !Number.isInteger(expectedRevision) || typeof mutate !== 'function') {
      throw codedError('invalid_input', '事务参数无效')
    }
    try {
      db.exec('BEGIN IMMEDIATE')
      const state = validateState(JSON.parse(db.prepare('SELECT body FROM state WHERE id=1').get().body))
      if (state.processedEvents.includes(eventId)) {
        db.exec('COMMIT')
        return cloneState(state)
      }
      if (state.revision !== expectedRevision) throw codedError('conflict', '存储版本已变化')
      const result = mutate(state)
      if (result && typeof result.then === 'function') throw codedError('invalid_input', '事务内禁止异步操作')
      state.revision += 1
      state.processedEvents.push(eventId)
      db.prepare('UPDATE state SET body=? WHERE id=1').run(JSON.stringify(state))
      db.exec('COMMIT')
      return cloneState(state)
    } catch (cause) {
      try { db.exec('ROLLBACK') } catch {}
      if (cause?.code === 'conflict' || cause?.code === 'invalid_input') throw cause
      throw codedError('storage_failure', '插件状态事务失败', cause)
    }
  }
  const close = () => {
    if (closed) return
    try {
      db.close()
      closed = true
    } catch (cause) {
      throw codedError('storage_failure', '关闭插件存储失败', cause)
    }
  }

  try {
    read()
  } catch (error) {
    close()
    throw error
  }
  return { read, transact, close }
}


export function createDomainStore(domain) {
  if (!domain || typeof domain.table !== 'function') throw codedError('invalid_input', 'DSH Storage Domain 无效')
  const table = domain.table('state')
  const key = 'current'
  let initialized = false
  const read = () => {
    if (!initialized) throw codedError('storage_failure', 'DSH 插件状态存储尚未初始化')
    const state = table.get(key)
    return cloneState(validateState(state ?? initialState()))
  }
  const transact = async (expectedRevision, eventId, mutate) => {
    if (!eventId || typeof eventId !== 'string' || !Number.isInteger(expectedRevision) || typeof mutate !== 'function') {
      throw codedError('invalid_input', '事务参数无效')
    }
    try {
      const next = await table.update(key, currentValue => {
        const current = cloneState(validateState(currentValue))
        if (current.processedEvents.includes(eventId)) return current
        if (current.revision !== expectedRevision) throw codedError('conflict', '存储版本已变化')
        const result = mutate(current)
        if (result && typeof result.then === 'function') throw codedError('invalid_input', '事务内禁止异步操作')
        current.revision += 1
        current.processedEvents.push(eventId)
        return validateState(current)
      })
      return cloneState(next)
    } catch (cause) {
      if (cause?.code === 'conflict' || cause?.code === 'invalid_input') throw cause
      throw codedError('storage_failure', '插件状态事务失败', cause)
    }
  }
  const initialize = async () => {
    if (initialized) return
    if (table.get(key) === undefined) await table.put(key, initialState())
    validateState(table.get(key))
    initialized = true
  }
  return { read, transact, initialize, close: () => domain.close() }
}