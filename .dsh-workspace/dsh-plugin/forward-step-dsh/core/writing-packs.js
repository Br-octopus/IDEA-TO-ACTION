import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { initialState } from './schema.js'

const require = createRequire(import.meta.url)
const schema = require('../vendor/core/writing-pack-schema.js')
const workspaceSchema = require('../vendor/core/writing-workbench-schema.js')
const writingPrompts = require('../vendor/core/writing-workbench-prompts.js')
const catalog = require('../vendor/core/writing-pack-catalog.js')
const builtins = catalog.getBuiltinWritingPacks()
const historyLimit = 50
const clone = value => structuredClone(value)
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const contentFields = [
  'name', 'layer', 'genre', 'taskType', 'applicability', 'targetFields', 'memoryNamespace', 'checkDimensions',
  'outputRequirements', 'riskReminders', 'styleBaseline', 'clarifications', 'materials', 'requirements', 'methods',
  'prompts', 'structures', 'style', 'terminology', 'evidenceRules', 'routes', 'checks', 'repairs', 'nextSteps',
  'examples', 'resources', 'sources',
]
const settingsOf = state => (state.writingPackSettings || []).map(schema.normalizeWritingPackSettings)
const settingOf = (state, id) => settingsOf(state).find(item => item.id === id)
const customOf = (state, id) => schema.normalizeWritingPackCollection(state.writingPacks).find(item => item.id === id)

function downgrade(value) {
  if (Array.isArray(value)) return value.map(downgrade)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === 'verificationStatus' ? 'unverified' : downgrade(child)]))
}

export function listWritingPacks(state = initialState()) {
  const settings = settingsOf(state)
  const builtin = builtins.map(base => {
    const saved = settings.find(item => item.id === base.id)
    const active = saved?.acceptedPack ?? base
    return { ...clone(active), id: base.id, builtin: true, basePackId: '', enabled: saved?.enabled ?? base.enabled !== false,
      history: clone(saved?.history ?? []), sourcePackVersion: base.version }
  })
  const custom = schema.normalizeWritingPackCollection(state.writingPacks).map(pack => {
    const saved = settings.find(item => item.id === pack.id)
    return { ...pack, enabled: saved?.enabled ?? pack.enabled !== false, history: clone(saved?.history ?? []) }
  })
  return [...builtin, ...custom]
}

export function diffWritingPackVersions(left, right) {
  if (!left || typeof left !== 'object' || Array.isArray(left) || !right || typeof right !== 'object' || Array.isArray(right)) {
    fail('invalid_input', '版本比较需要两个专业包快照')
  }
  const changes = []
  const visit = (before, after, path) => {
    if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      for (const key of keys) visit(before[key], after[key], path ? `${path}.${key}` : key)
      return
    }
    if (Array.isArray(before) && Array.isArray(after)) {
      const keyed = [...before, ...after].every(item => item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string')
        && new Set(before.map(item => item.id)).size === before.length
        && new Set(after.map(item => item.id)).size === after.length
      if (keyed) {
        const beforeById = new Map(before.map(item => [item.id, item]))
        const afterById = new Map(after.map(item => [item.id, item]))
        for (const id of [...new Set([...beforeById.keys(), ...afterById.keys()])].sort()) {
          visit(beforeById.get(id), afterById.get(id), `${path}[${id}]`)
        }
        return
      }
      for (let index = 0; index < Math.max(before.length, after.length); index++) {
        visit(before[index], after[index], `${path}.${index}`)
      }
      return
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({
        path,
        before: before === undefined ? null : clone(before),
        after: after === undefined ? null : clone(after),
        beforeExists: before !== undefined,
        afterExists: after !== undefined,
      })
    }
  }
  for (const field of contentFields) visit(left[field], right[field], field)
  return changes
}

export function compareWritingPackVersions(state, { packId, leftVersion, rightVersion } = {}) {
  const pack = listWritingPacks(state).find(item => item.id === packId)
  if (!pack) fail('not_found', '专业包不存在')
  const versions = [...(pack.history ?? []), pack]
  const left = versions.find(item => item.version === leftVersion)
  const right = versions.find(item => item.version === rightVersion)
  if (!left || !right) fail('not_found', '指定的专业包版本不存在')
  return { packId, leftVersion, rightVersion, changes: diffWritingPackVersions(left, right) }
}

export function createWritingPackSnapshot(state, { genre, taskType, selectedIds = [] } = {}) {
  const config = workspaceSchema.getWritingGenreConfig(genre)
  if (!config) fail('invalid_input', '写作文体无效')
  const selectedTaskType = taskType && config.taskTypes?.includes(taskType)
    ? taskType : config.taskTypes?.[0] ?? 'revision'
  const workspace = { genre, article: { genre }, rounds: [] }
  return writingPrompts.selectWritingPacks({
    workspace,
    packs: listWritingPacks(state),
    packSettings: [],
    selectedIds,
    taskType: selectedTaskType,
  }).snapshot
}

function commit(store, tx, reason, mutate) {
  if (!store || typeof store.read !== 'function' || typeof store.transact !== 'function'
    || !tx || !Number.isInteger(tx.expectedRevision) || !tx.eventId?.trim()) fail('invalid_input', '写作包事务参数无效')
  return store.transact(tx.expectedRevision, tx.eventId, state => {
    mutate(state)
    state.changes.push({ eventId: tx.eventId, reason, createdAt: new Date().toISOString() })
  })
}

function afterCommit(result, project) {
  return result && typeof result.then === 'function' ? result.then(project) : project(result)
}

export function saveWritingPack(store, { packId, pack: input } = {}, tx) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_input', '专业包内容无效')
  const state = store.read()
  const base = builtins.find(item => item.id === packId)
  const existing = packId && !base ? customOf(state, packId) : undefined
  if (packId && !base && !existing) fail('not_found', '要编辑的专业包不存在')
  const now = new Date().toISOString()
  if (!packId) {
    const id = input.id?.trim() || randomUUID()
    if (builtins.some(item => item.id === id) || customOf(state, id)) fail('conflict', '专业包 ID 已存在')
    const pack = schema.normalizeWritingPack({ ...input, id, version: 1, builtin: false, basePackId: '', createdAt: now, updatedAt: now })
    const saved = commit(store, tx, '创建专业包', current => current.writingPacks.push(pack))
    return afterCommit(saved, state => ({ pack: listWritingPacks(state).find(item => item.id === id), revision: state.revision }))
  }
  const previous = base ? settingOf(state, base.id)?.acceptedPack ?? base : existing
  const pack = schema.normalizeWritingPack({ ...previous, ...input, id: previous.id, version: previous.version + 1,
    builtin: false, basePackId: base ? base.id : previous.basePackId, createdAt: previous.createdAt || now, updatedAt: now })
  const oldSetting = settingOf(state, previous.id)
  const history = [...(oldSetting?.history ?? []), previous].slice(-historyLimit)
  const saved = commit(store, tx, '更新专业包版本', current => {
    current.writingPackSettings = settingsOf(current).filter(item => item.id !== previous.id)
    current.writingPackSettings.push({ id: previous.id, enabled: oldSetting?.enabled ?? previous.enabled !== false,
      ...(base ? { acceptedVersion: pack.version, acceptedPack: pack } : {}), history, updatedAt: now })
    if (!base) current.writingPacks = current.writingPacks.map(item => item.id === existing.id ? pack : item)
  })
  return afterCommit(saved, state => ({ pack: listWritingPacks(state).find(item => item.id === pack.id), revision: state.revision }))
}

export function setWritingPackEnabled(store, { packId, enabled } = {}, tx) {
  if (typeof enabled !== 'boolean') fail('invalid_input', '启用状态必须是布尔值')
  const state = store.read()
  const pack = listWritingPacks(state).find(item => item.id === packId)
  if (!pack) fail('not_found', '专业包不存在')
  const old = settingOf(state, packId)
  const now = new Date().toISOString()
  const saved = commit(store, tx, enabled ? '启用专业包' : '停用专业包', current => {
    current.writingPackSettings = settingsOf(current).filter(item => item.id !== packId)
    current.writingPackSettings.push({ id: packId, enabled,
      ...(old?.acceptedPack ? { acceptedVersion: old.acceptedVersion, acceptedPack: old.acceptedPack } : {}),
      ...(old?.history ? { history: old.history } : {}), updatedAt: now })
  })
  return afterCommit(saved, state => ({ pack: listWritingPacks(state).find(item => item.id === packId), revision: state.revision }))
}

export function deleteWritingPack(store, { packId } = {}, tx) {
  const pack = listWritingPacks(store.read()).find(item => item.id === packId)
  if (!pack) fail('not_found', '专业包不存在')
  if (pack.builtin) fail('invalid_input', '内置包不能删除；可停用或恢复默认')
  const saved = commit(store, tx, '删除自建专业包', state => {
    state.writingPacks = state.writingPacks.filter(item => item.id !== packId)
    state.writingPackSettings = state.writingPackSettings.filter(item => item.id !== packId)
  })
  return afterCommit(saved, state => ({ deleted: true, packId, revision: state.revision }))
}

export function restoreBuiltinWritingPack(store, { packId } = {}, tx) {
  if (!builtins.some(item => item.id === packId)) fail('not_found', '内置专业包不存在')
  const saved = commit(store, tx, '恢复内置专业包默认版本', state => {
    state.writingPacks = state.writingPacks.filter(item => item.basePackId !== packId)
    state.writingPackSettings = state.writingPackSettings.filter(item => item.id !== packId)
  })
  return afterCommit(saved, state => ({ pack: listWritingPacks(state).find(item => item.id === packId), revision: state.revision }))
}

export function previewImportWritingPacks(input, state = initialState()) {
  if (!Array.isArray(input) || !input.length || input.length > schema.WRITING_PACK_LIMITS.packs) fail('invalid_input', '导入专业包数量无效')
  const packs = input.map(item => schema.normalizeWritingPack(downgrade(item)))
  const existing = new Set(listWritingPacks(state).map(item => item.id))
  const seen = new Set()
  const collisions = packs.filter(pack => { const duplicate = existing.has(pack.id) || seen.has(pack.id); seen.add(pack.id); return duplicate }).map(pack => pack.id)
  return { packs, collisions }
}

export function confirmImportWritingPacks(store, preview, tx) {
  if (!preview || !Array.isArray(preview.packs) || !preview.packs.length) fail('invalid_input', '专业包导入预览无效')
  const current = previewImportWritingPacks(preview.packs, store.read())
  if (preview.collisions?.length || current.collisions.length) fail('conflict', '专业包 ID 冲突；请重新预览并解决冲突')
  const packs = current.packs.map(pack => ({ ...pack, builtin: false, basePackId: '' }))
  const saved = commit(store, tx, '导入自建专业包', state => state.writingPacks.push(...packs))
  return afterCommit(saved, state => ({ packs: packs.map(pack => listWritingPacks(state).find(item => item.id === pack.id)), revision: state.revision }))
}

export function exportWritingPacks(state, ids) {
  if (!Array.isArray(ids) || !ids.length) fail('invalid_input', '请至少选择一个专业包')
  const packs = listWritingPacks(state)
  return ids.map(id => {
    const pack = packs.find(item => item.id === id)
    if (!pack) fail('not_found', `专业包不存在：${id}`)
    return clone(pack)
  })
}
