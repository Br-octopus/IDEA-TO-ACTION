import { randomUUID } from 'node:crypto'

const PROMPT_LIMIT = 100000
const CASE_LIMIT = 500
const CASE_STATUSES = new Set(['unverified', 'tested'])

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

function text(value, max, label, required = false) {
  if (typeof value !== 'string') fail('invalid_input', `${label}必须是文本`)
  const clean = value.trim()
  if (required && !clean) fail('invalid_input', `${label}不能为空`)
  if (clean.length > max) fail('invalid_input', `${label}超过长度限制`)
  return clean
}

function sourceUrl(value, label) {
  const result = typeof value === 'string' ? value.trim().slice(0, 2000) : ''
  if (!result) return ''
  try {
    const url = new URL(result)
    if (!['http:', 'https:'].includes(url.protocol)) fail('invalid_input', `${label}必须是 HTTP(S) 链接`)
    return url.toString()
  } catch (error) {
    if (error?.code === 'invalid_input') throw error
    fail('invalid_input', `${label}格式无效`)
  }
}

function transact(store, tx, reason, mutate) {
  if (!tx || !Number.isInteger(tx.expectedRevision) || typeof tx.eventId !== 'string' || !tx.eventId.trim()) {
    return Promise.reject(Object.assign(new Error('事务参数无效'), { code: 'invalid_input' }))
  }
  return store.transact(tx.expectedRevision, tx.eventId, state => {
    mutate(state)
    state.changes.push({ eventId: tx.eventId, reason, createdAt: new Date().toISOString() })
  })
}

export function listPromptAssets(state, query = '', includeArchived = false) {
  const normalized = typeof query === 'string' ? query.trim().toLocaleLowerCase() : ''
  return (state?.prompts ?? []).filter(item => (includeArchived || !item.archived) && (!normalized || `${item.title} ${item.text} ${item.note} ${item.tags?.join(' ')}`.toLocaleLowerCase().includes(normalized)))
    .slice().sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
}

export function listCaseAssets(state, query = '', includeArchived = false) {
  const normalized = typeof query === 'string' ? query.trim().toLocaleLowerCase() : ''
  return (state?.cases ?? []).filter(item => (includeArchived || !item.archived) && (!normalized || `${item.title} ${item.domain} ${item.promptText} ${item.resultSummary} ${item.sourceUrl}`.toLocaleLowerCase().includes(normalized)))
    .slice().sort((left, right) => String(right.updatedAt ?? right.createdAt ?? '').localeCompare(String(left.updatedAt ?? left.createdAt ?? '')))
}

export async function savePromptAsset(store, input, tx) {
  const state = store.read()
  const source = input ?? {}
  const previous = source.promptId ? state.prompts.find(item => item.id === source.promptId) : null
  if (source.promptId && !previous) fail('not_found', '提示词版本不存在')
  const groupId = previous?.groupId || source.groupId || randomUUID()
  const version = Math.max(0, ...state.prompts.filter(item => item.groupId === groupId).map(item => Number(item.version) || 0)) + 1
  const saved = {
    id: randomUUID(), groupId, version, parentId: previous?.id ?? null,
    title: text(source.title, 200, '标题', true),
    text: text(source.text, PROMPT_LIMIT, '提示词正文', true),
    tags: Array.isArray(source.tags) ? [...new Set(source.tags.map(item => text(item, 40, '标签', true)))].slice(0, 20) : [],
    sourceUrl: sourceUrl(source.sourceUrl, '来源链接'),
    sourceLicense: typeof source.sourceLicense === 'string' ? source.sourceLicense.trim().slice(0, 500) : '',
    verificationStatus: 'unverified', verified: false, note: '', archived: false,
    createdAt: new Date().toISOString(),
  }
  const committed = await transact(store, tx, previous ? '创建提示词新版本' : '创建提示词资产', current => { current.prompts.unshift(saved) })
  return { prompt: structuredClone(committed.prompts.find(item => item.id === saved.id)), revision: committed.revision }
}

export async function setPromptVerification(store, input, tx) {
  const note = text(input?.note ?? '', 4000, '测试记录')
  if (!note) fail('invalid_input', '请记录测试案例与结果后再标记已验证')
  const committed = await transact(store, tx, '更新提示词验证记录', state => {
    const item = state.prompts.find(prompt => prompt.id === input?.promptId)
    if (!item) fail('not_found', '提示词版本不存在')
    item.note = note
    item.verified = true
    item.verificationStatus = 'tested'
    item.verifiedAt = new Date().toISOString()
  })
  return { prompt: structuredClone(committed.prompts.find(item => item.id === input.promptId)), revision: committed.revision }
}

export async function setPromptArchived(store, promptId, archived, tx) {
  if (typeof archived !== 'boolean') fail('invalid_input', '归档状态无效')
  const committed = await transact(store, tx, archived ? '归档提示词版本' : '恢复提示词版本', state => {
    const item = state.prompts.find(prompt => prompt.id === promptId)
    if (!item) fail('not_found', '提示词版本不存在')
    item.archived = archived
  })
  return { archived, revision: committed.revision }
}

export async function deletePromptAsset(store, promptId, tx) {
  const committed = await transact(store, tx, '删除提示词版本', state => {
    const index = state.prompts.findIndex(prompt => prompt.id === promptId)
    if (index < 0) fail('not_found', '提示词版本不存在')
    state.prompts.splice(index, 1)
  })
  return { deleted: true, revision: committed.revision }
}

export async function saveCaseAsset(store, input, tx) {
  const source = input ?? {}
  const state = store.read()
  const previous = source.caseId ? state.cases.find(item => item.id === source.caseId) : null
  if (source.caseId && !previous) fail('not_found', '案例不存在')
  if (!previous && state.cases.length >= CASE_LIMIT) fail('invalid_input', `案例库最多保存 ${CASE_LIMIT} 项`)
  const now = new Date().toISOString()
  const snapshot = {
    title: text(source.title, 200, '案例标题', true),
    domain: text(source.domain ?? '', 80, '适用领域'),
    promptText: text(source.promptText, PROMPT_LIMIT, '提示词', true),
    resultSummary: text(source.resultSummary, 12000, '结果摘要', true),
    feedback: text(source.feedback ?? '', 4000, '反馈'),
    sourceUrl: sourceUrl(source.sourceUrl, '来源链接'),
    sourceLicense: typeof source.sourceLicense === 'string' ? source.sourceLicense.trim().slice(0, 500) : '',
    verificationStatus: CASE_STATUSES.has(source.verificationStatus) ? source.verificationStatus : 'unverified',
  }
  if (snapshot.verificationStatus === 'tested' && !snapshot.feedback) fail('invalid_input', '标记已测试的案例必须记录测试反馈')
  const saved = {
    ...previous,
    ...snapshot,
    id: previous?.id ?? randomUUID(),
    version: (previous?.version ?? 0) + 1,
    history: [...(previous?.history ?? []), ...(previous ? [{ version: previous.version, ...Object.fromEntries(Object.keys(snapshot).map(key => [key, previous[key]])), savedAt: previous.updatedAt ?? previous.createdAt }] : [])],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
  const committed = await transact(store, tx, previous ? '更新提示词案例' : '创建提示词案例', current => {
    const index = current.cases.findIndex(item => item.id === saved.id)
    if (index < 0) current.cases.unshift(saved)
    else current.cases[index] = saved
  })
  return { caseItem: structuredClone(committed.cases.find(item => item.id === saved.id)), revision: committed.revision }
}

export async function deleteCaseAsset(store, caseId, tx) {
  const committed = await transact(store, tx, '删除提示词案例', state => {
    const index = state.cases.findIndex(item => item.id === caseId)
    if (index < 0) fail('not_found', '案例不存在')
    state.cases.splice(index, 1)
  })
  return { deleted: true, revision: committed.revision }
}
