import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { removeKnowledgeEntry } from './knowledge.js'

const require = createRequire(import.meta.url)
const builtinCards = require('../vendor/core/method-cards.js').methodCardsToKnowledgeEntries()
const knowledgeSchema = require('../vendor/core/knowledge-schema.js')
const domains = new Set(['general', 'writing', 'ppt'])

export function listMethodCards(state = {}) {
  const custom = (Array.isArray(state.knowledgeEntries) ? state.knowledgeEntries : [])
    .filter(entry => entry?.type === 'method-card' && entry.sourceType === '插件自建方法卡')
    .map(entry => ({ ...entry, version: Number.isInteger(entry.version) ? entry.version : 1, history: Array.isArray(entry.history) ? entry.history : [], builtin: false, editable: true }))
  return [
    ...builtinCards.map(card => ({ id: card.id, title: card.title, stages: card.stages, summary: card.summary, verificationStatus: card.verificationStatus, domains: [], builtin: true, editable: false })),
    ...custom,
  ]
}

export async function saveMethodCard(store, input, { expectedRevision, eventId } = {}) {
  const title = typeof input?.title === 'string' ? input.title.trim() : ''
  const summary = typeof input?.summary === 'string' ? input.summary.trim() : ''
  const stages = Array.isArray(input?.stages) ? input.stages.map(value => typeof value === 'string' ? value.trim() : '') : []
  if (title.length < 1 || title.length > 120 || summary.length < 1 || summary.length > 5000 || !domains.has(input?.domain) || stages.length < 1 || stages.length > 12 || stages.some(stage => !stage || stage.length > 300)) {
    throw Object.assign(new Error('方法卡需包含标题、说明、支持领域及 1–12 个有效步骤'), { code: 'invalid_input' })
  }
  let id = input.id
  if (id !== undefined) {
    if (typeof id !== 'string' || !id.startsWith('custom-method-')) throw Object.assign(new Error('内置方法卡不可编辑'), { code: 'invalid_input' })
    const current = store.read().knowledgeEntries.find(entry => entry.id === id && entry.type === 'method-card' && entry.sourceType === '插件自建方法卡')
    if (!current) throw Object.assign(new Error('自建方法卡不存在'), { code: 'not_found' })
  } else id = `custom-method-${randomUUID()}`
  const current = store.read().knowledgeEntries.find(entry => entry.id === id)
  const now = new Date().toISOString()
  const version = (current?.version ?? 0) + 1
  const history = [...(current?.history ?? []), ...(current ? [{ version: current.version ?? 1, title: current.title, summary: current.summary, stages: current.stages, domains: current.domains, updatedAt: current.updatedAt }] : [])].slice(-19)
  const entry = knowledgeSchema.normalizeKnowledgeEntry({
    id, type: 'method-card', title, summary, reusablePatterns: summary, stages, domains: [input.domain],
    sourceType: '插件自建方法卡', sourceKind: 'manual', verificationStatus: 'unverified', createdAt: current?.createdAt ?? now, updatedAt: now,
  })
  entry.version = version
  entry.history = history
  await store.transact(expectedRevision, eventId, state => {
    const index = state.knowledgeEntries.findIndex(item => item.id === id)
    if (index < 0) state.knowledgeEntries.unshift(entry)
    else state.knowledgeEntries[index] = entry
    state.knowledgeMetadata = { ...state.knowledgeMetadata, schemaVersion: 1, indexedAt: now }
    state.changes.push({ eventId, reason: '保存自建方法卡', sourceId: id, createdAt: now })
  })
  return structuredClone(store.read().knowledgeEntries.find(entry => entry.id === id))
}

export async function deleteMethodCard(store, id, { expectedRevision, eventId } = {}) {
  const entry = store.read().knowledgeEntries.find(item => item.id === id)
  if (!entry || entry.type !== 'method-card' || entry.sourceType !== '插件自建方法卡' || !id.startsWith('custom-method-')) {
    throw Object.assign(new Error('只能删除存在的自建方法卡；内置卡不可删除'), { code: 'invalid_input' })
  }
  return removeKnowledgeEntry(store, id, { expectedRevision, eventId })
}


