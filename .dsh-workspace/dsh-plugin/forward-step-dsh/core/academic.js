import { randomUUID } from 'node:crypto'

const text = (value, limit = 4000) => typeof value === 'string' ? value.trim().slice(0, limit) : ''
const list = (value, limit = 200) => Array.isArray(value) ? value.map(item => text(item, 500)).filter(Boolean).slice(0, limit) : []
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const now = () => new Date().toISOString()
const cleanDoi = value => text(value, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '').replace(/[.,;\s]+$/u, '').toLowerCase()
const relations = new Set(['unassessed', 'supports', 'does-not-support', 'contradicts', 'insufficient'])
const decisions = new Set(['include', 'exclude', 'uncertain', 'duplicate'])

function normalizeLiterature(input = {}) {
  const importedFields = {}
  for (const [key, raw] of Object.entries(input.importedFields ?? {}).slice(0, 50)) {
    const values = (Array.isArray(raw) ? raw : [raw]).map(value => text(value, 1200)).filter(Boolean)
    if (values.length) importedFields[text(key, 80)] = values
  }
  if (typeof input.abstractExcerpt === 'string' && input.abstractExcerpt.trim().length > 1200) fail('invalid_input', '摘要或摘录最多 1200 字')
  return {
    authors: list(input.authors, 100), year: text(input.year, 20), publication: text(input.publication, 500),
    volume: text(input.volume, 80), issue: text(input.issue, 80), pages: text(input.pages, 120), doi: cleanDoi(input.doi),
    pmid: text(input.pmid, 40), abstractExcerpt: text(input.abstractExcerpt, 1200), excerptLocation: text(input.excerptLocation, 240),
    keywords: list(input.keywords, 100), itemType: text(input.itemType, 80),
    metadataStatus: ['unverified', 'registry-returned', 'user-verified'].includes(input.metadataStatus) ? input.metadataStatus : 'unverified',
    readingStatus: ['unread', 'citation-only', 'abstract-only', 'excerpt-only', 'full-text-confirmed'].includes(input.readingStatus) ? input.readingStatus : 'unread',
    claimRelations: (Array.isArray(input.claimRelations) ? input.claimRelations : []).flatMap(item => {
      if (!relations.has(item?.relation) || item.relation === 'unassessed') return []
      const claim = text(item.claim, 1000), location = text(item.location, 240), rationale = text(item.rationale, 1200)
      return claim && location && rationale ? [{ claim, relation: item.relation, location, rationale }] : []
    }), importedFields,
  }
}

function makeEntry(input = {}) {
  const title = text(input.title, 1000)
  if (!title) fail('invalid_input', '文献记录缺少题名')
  const createdAt = text(input.createdAt, 40) || now()
  const literature = normalizeLiterature(input.literature ?? input)
  return {
    id: text(input.id, 160) || randomUUID(), type: 'academic-literature', title, sourceUrl: '',
    sourceType: '文献题录', sourceKind: 'reference', sourceId: '', hiddenAt: '', favorite: false, pinned: false,
    lastUsedAt: '', customAliases: [], domains: [], stages: [], keywords: list(input.keywords ?? literature.keywords, 100),
    summary: '', reusablePatterns: '', limitations: '', licenseNote: '', verificationStatus: 'unverified', userRating: null,
    applicableCases: [], contentExcerpt: '', linkedProjectId: '', linkedCaseId: '', createdAt,
    updatedAt: text(input.updatedAt, 40) || createdAt, literature,
  }
}

function parseRis(content) {
  const entries = [], errors = []; let record = null, tag = ''
  const finish = () => {
    if (!record) return
    const known = new Set(['TY','TI','T1','AU','A1','PY','Y1','JO','JF','T2','VL','IS','SP','EP','DO','PM','AB','KW'])
    const importedFields = Object.fromEntries(Object.entries(record).filter(([key]) => !known.has(key)))
    try { entries.push(makeEntry({
      title: record.TI?.[0] || record.T1?.[0], authors: [...(record.AU || []), ...(record.A1 || [])],
      year: (record.PY?.[0] || record.Y1?.[0] || '').match(/\d{4}/u)?.[0] || '',
      publication: record.JO?.[0] || record.JF?.[0] || record.T2?.[0] || '', volume: record.VL?.[0], issue: record.IS?.[0],
      pages: [record.SP?.[0], record.EP?.[0]].filter(Boolean).join('-'), doi: record.DO?.[0], pmid: record.PM?.[0],
      abstractExcerpt: (record.AB || []).join(' '), keywords: record.KW, itemType: record.TY?.[0], importedFields,
    })) } catch (error) { errors.push({ record: entries.length + errors.length + 1, message: error.message }) }
    record = null; tag = ''
  }
  for (const line of String(content).replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Z0-9]{2})\s+-\s?(.*)$/iu)
    if (match) {
      const key = match[1].toUpperCase()
      if (key === 'TY') { finish(); record = {} }
      if (key === 'ER') { finish(); continue }
      if (!record) record = {}
      ;(record[key] ??= []).push(match[2].trim()); tag = key
    } else if (record && /^\s+\S/u.test(line) && tag) record[tag][record[tag].length - 1] += ` ${line.trim()}`
  }
  finish()
  if (!entries.length && !errors.length) errors.push({ record: 1, message: '没有找到 RIS 文献记录' })
  return { entries, errors }
}

function bibValue(source, start) {
  let index = start
  while (/\s/u.test(source[index] || '')) index++
  const opening = source[index]
  if (opening === '{' || opening === '"') {
    const closing = opening === '{' ? '}' : '"'; let depth = opening === '{' ? 1 : 0, value = ''
    for (index++; index < source.length; index++) {
      const char = source[index]
      if (char === '\\' && index + 1 < source.length) { value += source[++index]; continue }
      if (opening === '{' && char === '{') depth++
      if (char === closing && (opening === '"' || --depth === 0)) return { value: value.trim(), next: index + 1 }
      value += char
    }
    throw new Error('BibTeX 字段定界符不完整')
  }
  let end = index
  while (end < source.length && !',\n}'.includes(source[end])) end++
  return { value: source.slice(index, end).trim(), next: end }
}

function parseBibtex(content) {
  const entries = [], errors = [], source = String(content).replace(/^\uFEFF/u, ''), starts = [...source.matchAll(/@([A-Za-z]+)\s*\{/gu)]
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].index + starts[i][0].length, to = starts[i + 1]?.index ?? source.length
    const body = source.slice(from, to).replace(/\}\s*$/u, ''), comma = body.indexOf(',')
    if (comma < 0) { errors.push({ record: i + 1, message: 'BibTeX 记录缺少键分隔符' }); continue }
    const fields = {}; let offset = comma + 1
    try {
      while (offset < body.length) {
        const match = body.slice(offset).match(/^\s*,?\s*([A-Za-z][A-Za-z0-9_-]*)\s*=/u)
        if (!match) { offset++; continue }
        const key = match[1].toLowerCase(); offset += match[0].length
        const parsed = bibValue(body, offset); fields[key] = parsed.value; offset = parsed.next
        while (offset < body.length && /[\s,]/u.test(body[offset])) offset++
      }
      const known = new Set(['title','author','editor','year','date','journal','journaltitle','booktitle','publisher','volume','number','issue','pages','doi','pmid','abstract','keywords'])
      const importedFields = Object.fromEntries(Object.entries(fields).filter(([key]) => !known.has(key)))
      entries.push(makeEntry({ title: fields.title, authors: (fields.author || fields.editor || '').split(/\s+and\s+/iu), year: (fields.year || fields.date || '').match(/\d{4}/u)?.[0] || '', publication: fields.journal || fields.journaltitle || fields.booktitle || fields.publisher, volume: fields.volume, issue: fields.number || fields.issue, pages: fields.pages, doi: fields.doi, pmid: fields.pmid, abstractExcerpt: fields.abstract, keywords: (fields.keywords || '').split(/\s*[,;]\s*/u), itemType: starts[i][1].toLowerCase(), importedFields }))
    } catch (error) { errors.push({ record: i + 1, message: error.message }) }
  }
  if (!entries.length && !errors.length) errors.push({ record: 1, message: '没有找到 BibTeX 文献记录' })
  return { entries, errors }
}

export function parseBibliographyImport(input, format) {
  if (typeof input !== 'string' || !input.trim()) fail('invalid_input', '文献导入内容不能为空')
  if (input.length > 2_000_000) fail('invalid_input', '文献导入内容超过 2 MB 限额')
  const type = String(format).toLowerCase()
  if (!['ris', 'bibtex', 'bib'].includes(type)) fail('invalid_input', '仅支持 RIS 和 BibTeX')
  return type === 'ris' ? parseRis(input) : parseBibtex(input)
}

function duplicateKey(entry) { return cleanDoi(entry?.literature?.doi) }
function deduplicate(entries, existing) {
  const accepted = [], duplicates = [], seen = [...existing]
  for (const input of entries) {
    const entry = makeEntry(input), key = duplicateKey(entry), pmid = text(entry.literature.pmid, 40)
    const previous = (key && seen.find(item => duplicateKey(item) === key))
      || (pmid && seen.find(item => text(item?.literature?.pmid, 40) === pmid))
    if (previous) duplicates.push({ id: entry.id, title: entry.title, duplicateOf: previous.id, reason: key && duplicateKey(previous) === key ? 'doi' : 'pmid' })
    else { accepted.push(entry); seen.push(entry) }
  }
  return { entries: accepted, duplicates }
}

export function previewBibliographyImport(input, format, existing = []) {
  const parsed = parseBibliographyImport(input, format), result = deduplicate(parsed.entries, existing)
  return { ...result, errors: parsed.errors, unknownFields: result.entries.flatMap(entry => Object.entries(entry.literature.importedFields).map(([field, values]) => ({ entryId: entry.id, title: entry.title, field, values: structuredClone(values), actionRequired: 'review-before-save' }))) }
}

function normalizeRecord(input = {}) {
  const snapshot = input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : {}
  const decision = value => value && decisions.has(value.decision) ? { decision: value.decision, reason: text(value.reason, 1000), evidence: text(value.evidence, 1200), location: text(value.location, 240), decidedAt: text(value.decidedAt, 40) } : { decision: '', reason: '', evidence: '', location: '', decidedAt: '' }
  const screening = input.screening ?? {}, titleAbstract = screening.titleAbstract ?? {}
  const extraction = input.extraction && typeof input.extraction === 'object' ? input.extraction : {}
  return {
    id: text(input.id, 160) || randomUUID(), sourceEntryId: text(input.sourceEntryId, 160),
    snapshot: { title: text(snapshot.title, 1000), authors: list(snapshot.authors, 100), year: text(snapshot.year, 20), publication: text(snapshot.publication, 500), doi: cleanDoi(snapshot.doi), pmid: text(snapshot.pmid, 40), metadataStatus: ['unverified','registry-returned','user-verified'].includes(snapshot.metadataStatus) ? snapshot.metadataStatus : 'unverified', readingStatus: ['unread','citation-only','abstract-only','excerpt-only','full-text-confirmed'].includes(snapshot.readingStatus) ? snapshot.readingStatus : 'unread', excerpt: text(snapshot.excerpt, 1200), excerptLocation: text(snapshot.excerptLocation, 240) },
    screening: { titleAbstract: { reviewerOne: decision(titleAbstract.reviewerOne), reviewerTwo: decision(titleAbstract.reviewerTwo), adjudication: decision(titleAbstract.adjudication) }, fullText: { decision: ['include','exclude','not-retrieved'].includes(screening.fullText?.decision) ? screening.fullText.decision : 'pending', reason: text(screening.fullText?.reason, 1000), location: text(screening.fullText?.location, 240), userConfirmedFullText: screening.fullText?.userConfirmedFullText === true } },
    narrativeSelected: input.narrativeSelected === true,
    extraction: Object.fromEntries(Object.entries(extraction).slice(0, 80).map(([key, value]) => [text(key, 100), { value: text(value?.value, 1200), evidence: text(value?.evidence, 1200), sourceLocation: text(value?.sourceLocation, 240), confirmed: value?.confirmed === true }])),
  }
}

function normalizeReviewProject(input = {}) {
  if (!text(input.id, 160) || !text(input.title, 300) || !text(input.question, 1200) || !text(input.scope, 2000)) fail('invalid_input', '综述项目需要标识、名称、研究问题和范围')
  const reviewType = ['narrative-review','scoping-review','systematic-review'].includes(input.reviewType) ? input.reviewType : 'narrative-review'
  const records = (Array.isArray(input.records) ? input.records : []).slice(0, 2500).map(normalizeRecord)
  if (new Set(records.map(record => record.id)).size !== records.length) fail('invalid_input', '综述文献记录标识重复')
  return { id: text(input.id, 160), workspaceKind: 'review', title: text(input.title, 300), question: text(input.question, 1200), scope: text(input.scope, 2000), reviewType, screeningModel: input.screeningModel === 'two-reviewers' ? 'two-reviewers' : 'single-reviewer', records, extractionFields: (Array.isArray(input.extractionFields) ? input.extractionFields : []).slice(0, 80).map(field => ({ id: text(field.id, 100), label: text(field.label, 300) })).filter(field => field.id && field.label), promptRounds: (Array.isArray(input.promptRounds) ? input.promptRounds : []).slice(0, 200).map(round => ({ id: text(round.id, 160), kind: text(round.kind, 80), selectedIds: list(round.selectedIds, 100), prompt: text(round.prompt, 12000), createdAt: text(round.createdAt, 40) })), createdAt: text(input.createdAt, 40) || now(), updatedAt: now() }
}

function normalizePublishingProject(input = {}) {
  if (!text(input.id, 160) || !text(input.title, 300)) fail('invalid_input', '投稿项目需要标识和名称')
  const target = input.target && typeof input.target === 'object' ? input.target : {}
  return {
    id: text(input.id, 160), workspaceKind: 'publishing', title: text(input.title, 300),
    target: { venue: text(target.venue, 300), manuscriptVersion: text(target.manuscriptVersion, 120), submissionType: text(target.submissionType, 160) },
    requirements: (Array.isArray(input.requirements) ? input.requirements : []).slice(0, 500).map(item => ({ id: text(item.id, 160), title: text(item.title, 300), body: text(item.body, 2000), issuer: text(item.issuer, 300), version: text(item.version, 120), sourceUrl: text(item.sourceUrl, 1000), sourceLocator: text(item.sourceLocator, 240), verificationStatus: ['unverified','registry-returned','user-verified'].includes(item.verificationStatus) ? item.verificationStatus : 'unverified' })),
    checklist: (Array.isArray(input.checklist) ? input.checklist : []).slice(0, 500).map(item => ({ id: text(item.id, 160), title: text(item.title, 300), requirementId: text(item.requirementId, 160), status: ['todo','in-progress','complete'].includes(item.status) ? item.status : 'todo', evidence: text(item.evidence, 1200), reason: text(item.reason, 1000) })),
    citationClaims: (Array.isArray(input.citationClaims) ? input.citationClaims : []).slice(0, 500).map(item => ({ id: text(item.id, 160), statement: text(item.statement, 2000), manuscriptLocation: text(item.manuscriptLocation, 240), sources: (Array.isArray(item.sources) ? item.sources : []).slice(0, 40).map(source => ({ id: text(source.id, 160) || randomUUID(), knowledgeEntryId: text(source.knowledgeEntryId, 160), relation: relations.has(source.relation) ? source.relation : 'unassessed', snapshot: { title: text(source.snapshot?.title, 1000), ...normalizeLiterature(source.snapshot) }, evidenceExcerpt: text(source.evidenceExcerpt, 1200), evidenceLocation: text(source.evidenceLocation, 240), userNote: text(source.userNote, 1000) })) })),
    reviewerRounds: (Array.isArray(input.reviewerRounds) ? input.reviewerRounds : []).slice(0, 100).map(round => ({ id: text(round.id, 160), title: text(round.title, 300), comments: (Array.isArray(round.comments) ? round.comments : []).slice(0, 2000).map(comment => ({ id: text(comment.id, 160), reviewer: text(comment.reviewer, 160), rawComment: text(comment.rawComment, 3000), status: ['open','planned','revised','no-change','unresolved'].includes(comment.status) ? comment.status : 'open', responseDraft: text(comment.responseDraft, 3000), changeSummary: text(comment.changeSummary, 2000), changeLocation: text(comment.changeLocation, 240), noChangeReason: text(comment.noChangeReason, 2000), afterExcerpt: text(comment.afterExcerpt, 1200) })) })),
    promptRounds: (Array.isArray(input.promptRounds) ? input.promptRounds : []).slice(0, 200).map(round => ({ id: text(round.id, 160), kind: text(round.kind, 80), selectedIds: list(round.selectedIds, 100), prompt: text(round.prompt, 12000), createdAt: text(round.createdAt, 40) })),
    createdAt: text(input.createdAt, 40) || now(), updatedAt: now(),
  }
}

function normalizeProject(input) {
  if (input?.workspaceKind === 'review') return normalizeReviewProject(input)
  if (input?.workspaceKind === 'publishing') return normalizePublishingProject(input)
  fail('invalid_input', '学术工作区类型无效')
}

function preserveUnknown(source, normalized) {
  if (Array.isArray(normalized)) {
    const original = Array.isArray(source) ? source : []
    return normalized.map((item, index) => {
      const match = item && typeof item === 'object' && item.id
        ? original.find(value => value?.id === item.id)
        : original[index]
      return preserveUnknown(match, item)
    })
  }
  if (!normalized || typeof normalized !== 'object') return normalized
  const original = source && typeof source === 'object' && !Array.isArray(source) ? source : {}
  const merged = { ...normalized }
  for (const [key, value] of Object.entries(original)) {
    merged[key] = Object.hasOwn(normalized, key) ? preserveUnknown(value, normalized[key]) : structuredClone(value)
  }
  return merged
}

function collectUnknown(source, normalized, path = '') {
  if (Array.isArray(source)) return source.flatMap((item, index) => collectUnknown(item, normalized?.[index], `${path}[${index}]`))
  if (!source || typeof source !== 'object') return []
  const known = normalized && typeof normalized === 'object' ? normalized : {}
  return Object.entries(source).flatMap(([key, value]) => {
    const itemPath = path ? `${path}.${key}` : key
    if (!Object.hasOwn(known, key)) return [{ path: itemPath, value: structuredClone(value) }]
    return collectUnknown(value, known[key], itemPath)
  })
}

export function previewAcademicProject(input) {
  const project = normalizeProject(input)
  return { project: preserveUnknown(input, project), unknownFields: collectUnknown(input, project) }
}

export function createAcademicProject(input = {}) {
  return normalizePublishingProject({ ...input, id: text(input.id, 160) || randomUUID(), title: text(input.title, 300) || '未命名投稿项目' })
}

export function createAcademicReviewProject(input = {}) {
  return normalizeReviewProject({ ...input, id: text(input.id, 160) || randomUUID(), records: [], promptRounds: [] })
}

function byId(state, id) {
  const project = state.academicResponseProjects.find(item => item?.id === id)
  if (!project) fail('not_found', '学术项目不存在')
  return project
}

function transact(store, transaction, mutate, reason) {
  if (!transaction || !Number.isInteger(transaction.expectedRevision) || typeof transaction.eventId !== 'string' || !transaction.eventId.trim()) fail('invalid_input', '学术事务参数无效')
  return store.transact(transaction.expectedRevision, transaction.eventId, state => {
    mutate(state)
    state.changes.push({ eventId: transaction.eventId, reason, createdAt: now() })
  })
}

export async function saveAcademicProject(store, input, transaction) {
  const next = previewAcademicProject(input).project
  const result = await transact(store, transaction, state => {
    if (next.workspaceKind === 'publishing') {
      for (const claim of next.citationClaims) {
        for (const source of claim.sources) {
          const entry = state.knowledgeEntries.find(item => item.id === source.knowledgeEntryId && item.type === 'academic-literature')
          if (!entry) fail('missing_dependency', `引用关联的插件学术资料不存在：${source.knowledgeEntryId}`)
        }
      }
    }
    const index = state.academicResponseProjects.findIndex(item => item.id === next.id)
    if (index < 0) state.academicResponseProjects.push(next)
    else state.academicResponseProjects[index] = preserveUnknown(next, normalizeProject(next))
  }, '保存学术项目')
  return structuredClone(byId(result, next.id))
}

export async function importBibliographyEntries(store, entries, transaction) {
  if (!Array.isArray(entries) || !entries.length) fail('invalid_input', '没有可导入的文献题录')
  const preview = deduplicate(entries, store.read().knowledgeEntries)
  if (!preview.entries.length) return { entries: [], duplicates: preview.duplicates, revision: store.read().revision }
  const result = await transact(store, transaction, state => {
    const ids = new Set(state.knowledgeEntries.map(entry => entry.id))
    if (preview.entries.some(entry => ids.has(entry.id))) fail('conflict', '题录标识已存在，请重新预览')
    state.knowledgeEntries.push(...preview.entries.map(makeEntry))
  }, '导入学术题录')
  const ids = new Set(preview.entries.map(entry => entry.id))
  return { entries: structuredClone(result.knowledgeEntries.filter(entry => ids.has(entry.id))), duplicates: preview.duplicates, revision: result.revision }
}

function assertKnowledge(state, id) {
  const entry = state.knowledgeEntries.find(item => item.id === id && item.type === 'academic-literature')
  if (!entry) fail('missing_dependency', `引用的插件学术资料不存在：${id}`)
  return entry
}

function updateList(project, key, id, update) {
  let found = false
  const items = project[key].map(item => { if (item.id !== id) return item; found = true; return update(structuredClone(item)) })
  if (!found) fail('not_found', `项目记录不存在：${id}`)
  return { ...project, [key]: items, updatedAt: now() }
}

function applyReviewAction(project, state, action, args) {
  if (action === 'addLiteratureRecords') {
    const existing = new Set(project.records.map(record => record.sourceEntryId)), records = []
    for (const id of list(args[0], 2500)) {
      const entry = assertKnowledge(state, id)
      if (existing.has(id)) continue
      existing.add(id)
      records.push(normalizeRecord({ id, sourceEntryId: id, snapshot: { ...entry.literature, title: entry.title, excerpt: entry.literature.abstractExcerpt } }))
    }
    if (project.records.length + records.length > 2500) fail('invalid_input', '综述项目文献数量超过上限')
    return { ...project, records: [...project.records, ...records], updatedAt: now() }
  }
  if (action === 'updateExtractionFields') {
    const fields = (Array.isArray(args[0]) ? args[0] : []).slice(0, 80).map(field => ({ id: text(field.id, 100), label: text(field.label, 300) })).filter(field => field.id && field.label)
    if (!fields.length || new Set(fields.map(field => field.id)).size !== fields.length) fail('invalid_input', '提取字段不能为空且标识不能重复')
    return { ...project, extractionFields: fields, records: project.records.map(record => ({ ...record, extraction: Object.fromEntries(fields.map(field => [field.id, record.extraction[field.id] ?? { value: '', evidence: '', sourceLocation: '', confirmed: false }])) })), updatedAt: now() }
  }
  if (action === 'addPromptRound') {
    const input = args[0]
    if (!text(input?.prompt, 12000)) fail('invalid_input', '提示词轮次内容不能为空')
    return { ...project, promptRounds: [...project.promptRounds, { id: text(input.id, 160) || randomUUID(), kind: text(input.kind, 80), selectedIds: list(input.selectedIds, 100), prompt: text(input.prompt, 12000), createdAt: now() }], updatedAt: now() }
  }
  const [recordId, ...rest] = args
  const record = project.records.find(item => item.id === recordId)
  if (!record) fail('not_found', `综述文献记录不存在：${recordId}`)
  if (action === 'setScreeningDecision') {
    const [stage, reviewer, input] = rest
    if (stage !== 'title-abstract' || !['reviewerOne','reviewerTwo'].includes(reviewer) || (reviewer === 'reviewerTwo' && project.screeningModel !== 'two-reviewers') || !decisions.has(input?.decision)) fail('invalid_input', '筛选阶段、审阅者或决定无效')
    if (['exclude','duplicate'].includes(input.decision) && !text(input.reason)) fail('invalid_input', '排除或重复决定需要填写理由')
    record.screening.titleAbstract[reviewer] = { decision: input.decision, reason: text(input.reason, 1000), evidence: text(input.evidence, 1200), location: text(input.location, 240), decidedAt: now() }
    record.screening.titleAbstract.adjudication = { decision: '', reason: '', evidence: '', location: '', decidedAt: '' }
    record.screening.fullText = { decision: 'pending', reason: '', location: '', userConfirmedFullText: false }
    return { ...project, updatedAt: now() }
  }
  if (action === 'adjudicateScreeningDecision') {
    const [input] = rest
    if (project.screeningModel !== 'two-reviewers' || !decisions.has(input?.decision) || !text(input.reason)) fail('invalid_input', '双人筛选裁定需要有效决定和理由')
    record.screening.titleAbstract.adjudication = { decision: input.decision, reason: text(input.reason, 1000), evidence: text(input.evidence, 1200), location: text(input.location, 240), decidedAt: now() }
    record.screening.fullText = { decision: 'pending', reason: '', location: '', userConfirmedFullText: false }
    return { ...project, updatedAt: now() }
  }
  if (action === 'setFullTextDecision') {
    const [input] = rest, screening = record.screening.titleAbstract
    const reviewerOne = screening.reviewerOne.decision, reviewerTwo = screening.reviewerTwo.decision
    const consensus = reviewerOne && reviewerTwo && reviewerOne === reviewerTwo ? reviewerOne : ''
    const prior = screening.adjudication.decision || (project.screeningModel === 'two-reviewers' ? consensus : reviewerOne)
    if (!['systematic-review','scoping-review'].includes(project.reviewType) || !['include','uncertain'].includes(prior) || !['include','exclude','not-retrieved'].includes(input?.decision)) fail('invalid_input', '该文献尚未进入有效全文筛选阶段')
    if (['include','exclude'].includes(input.decision) && input.userConfirmedFullText !== true) fail('invalid_input', '全文纳入或排除前需要用户确认已核对全文')
    if (input.decision !== 'include' && !text(input.reason)) fail('invalid_input', '全文排除或无法获取需要说明理由')
    record.screening.fullText = { decision: input.decision, reason: text(input.reason, 1000), location: text(input.location, 240), userConfirmedFullText: input.userConfirmedFullText === true }
    return { ...project, updatedAt: now() }
  }
  if (action === 'setNarrativeSelection') {
    if (project.reviewType !== 'narrative-review' || typeof rest[0] !== 'boolean') fail('invalid_input', '叙述性综述选择参数无效')
    record.narrativeSelected = rest[0]
    return { ...project, updatedAt: now() }
  }
  if (action === 'setExtractionValue') {
    const [fieldId, input] = rest
    if (!project.extractionFields.some(field => field.id === fieldId)) fail('not_found', `提取字段不存在：${fieldId}`)
    const eligible = project.reviewType === 'narrative-review' ? record.narrativeSelected : record.screening.fullText.decision === 'include' && record.screening.fullText.userConfirmedFullText
    if (!eligible) fail('invalid_input', '请先确认纳入全文或选择叙述材料，再记录证据提取')
    record.extraction[fieldId] = { value: text(input?.value, 1200), evidence: text(input?.evidence, 1200), sourceLocation: text(input?.sourceLocation, 240), confirmed: false }
    return { ...project, updatedAt: now() }
  }
  if (action === 'confirmExtractionValue') {
    const [fieldId] = rest
    if (!project.extractionFields.some(field => field.id === fieldId)) fail('not_found', `提取字段不存在：${fieldId}`)
    const extraction = record.extraction[fieldId]
    if (!extraction?.value || !extraction.evidence || !extraction.sourceLocation) fail('invalid_input', '确认前需要填写提取值、原文证据和来源位置')
    extraction.confirmed = true
    return { ...project, updatedAt: now() }
  }
  fail('unsupported_action', '不支持的综述操作')
}

function applyPublishingAction(project, state, action, args) {
  if (action === 'addCitationClaim') {
    const input = args[0]
    if (!text(input?.statement) || project.citationClaims.length >= 500) fail('invalid_input', '论断内容无效或数量已达上限')
    const claim = { id: text(input.id, 160) || randomUUID(), statement: text(input.statement, 2000), manuscriptLocation: text(input.manuscriptLocation, 240), sources: (Array.isArray(input.sources) ? input.sources : []).slice(0, 40).map(source => {
      const entry = assertKnowledge(state, text(source.knowledgeEntryId, 160))
      const relation = relations.has(source.relation) ? source.relation : 'unassessed'
      if (relation !== 'unassessed' && (!text(source.evidenceExcerpt, 1200) || !text(source.evidenceLocation, 240))) fail('invalid_input', '有方向的引用关系必须记录证据摘录和位置')
      return { id: text(source.id, 160) || randomUUID(), knowledgeEntryId: entry.id, relation, snapshot: { title: entry.title, ...normalizeLiterature(entry.literature) }, evidenceExcerpt: text(source.evidenceExcerpt, 1200), evidenceLocation: text(source.evidenceLocation, 240), userNote: text(source.userNote, 1000) }
    }) }
    return { ...project, citationClaims: [...project.citationClaims, claim], updatedAt: now() }
  }
  if (action === 'updateCitationSource') {
    const [claimId, sourceId, changes] = args
    const claim = project.citationClaims.find(item => item.id === claimId)
    if (!claim) fail('not_found', '待更新论断不存在')
    return { ...project, citationClaims: project.citationClaims.map(item => item.id !== claimId ? item : { ...item, sources: item.sources.map(source => {
      if (source.id !== sourceId) return source
      const next = { ...source, ...changes, relation: relations.has(changes?.relation) ? changes.relation : source.relation }
      const entry = assertKnowledge(state, next.knowledgeEntryId)
      if (next.relation !== 'unassessed' && (!text(next.evidenceExcerpt, 1200) || !text(next.evidenceLocation, 240))) fail('invalid_input', '有方向的引用关系必须记录证据摘录和位置')
      return { ...next, snapshot: { title: entry.title, ...normalizeLiterature(entry.literature) } }
    }) }), updatedAt: now() }
  }
  if (action === 'addReviewerRound') {
    const input = args[0]
    if (!text(input?.title) || project.reviewerRounds.length >= 100) fail('invalid_input', '审稿轮次标题无效或数量已达上限')
    return { ...project, reviewerRounds: [...project.reviewerRounds, { id: text(input.id, 160) || randomUUID(), title: text(input.title, 300), comments: [] }], updatedAt: now() }
  }
  if (action === 'addReviewerComment') {
    const [roundId, input] = args
    if (!text(input?.rawComment, 3000)) fail('invalid_input', '审稿意见不能为空')
    return updateList(project, 'reviewerRounds', roundId, round => ({ ...round, comments: [...round.comments, { id: text(input.id, 160) || randomUUID(), reviewer: text(input.reviewer, 160), rawComment: text(input.rawComment, 3000), status: 'open', responseDraft: '', changeSummary: '', changeLocation: '', noChangeReason: '', afterExcerpt: '' }] }))
  }
  if (action === 'resolveReviewerComment') {
    const [roundId, commentId, changes] = args
    return updateList(project, 'reviewerRounds', roundId, round => {
      const old = round.comments.find(item => item.id === commentId)
      if (!old) fail('not_found', '审稿意见不存在')
      const status = ['open','planned','revised','no-change','unresolved'].includes(changes?.status) ? changes.status : old.status
      const comment = { ...old, ...changes, status, responseDraft: text(changes?.responseDraft, 3000), changeSummary: text(changes?.changeSummary, 2000), changeLocation: text(changes?.changeLocation, 240), noChangeReason: text(changes?.noChangeReason, 2000), afterExcerpt: text(changes?.afterExcerpt, 1200) }
      if (status === 'revised' && (!comment.changeSummary || !comment.changeLocation)) fail('invalid_input', '标为已修改需要填写实际改动摘要和位置')
      if (status === 'no-change' && !comment.noChangeReason) fail('invalid_input', '不修改需要填写理由')
      return { ...round, comments: round.comments.map(item => item.id === commentId ? comment : item) }
    })
  }
  if (action === 'addRequirementCard') {
    const input = args[0]
    if (!text(input?.title) || !text(input?.body)) fail('invalid_input', '投稿要求标题和内容不能为空')
    return { ...project, requirements: [...project.requirements, { id: text(input.id, 160) || randomUUID(), title: text(input.title, 300), body: text(input.body, 2000), issuer: text(input.issuer, 300), version: text(input.version, 120), sourceUrl: text(input.sourceUrl, 1000), sourceLocator: text(input.sourceLocator, 240), verificationStatus: 'unverified' }], updatedAt: now() }
  }
  if (action === 'updateRequirementCard') {
    const [id, changes] = args
    return updateList(project, 'requirements', id, item => ({ ...item, ...changes, verificationStatus: ['unverified','registry-returned','user-verified'].includes(changes?.verificationStatus) ? changes.verificationStatus : item.verificationStatus }))
  }
  if (action === 'addChecklistItem') {
    const input = args[0]
    if (!text(input?.title)) fail('invalid_input', '投稿检查项标题不能为空')
    if (input.requirementId && !project.requirements.some(item => item.id === input.requirementId)) fail('missing_dependency', '关联投稿要求不存在')
    return { ...project, checklist: [...project.checklist, { id: text(input.id, 160) || randomUUID(), title: text(input.title, 300), requirementId: text(input.requirementId, 160), status: 'todo', evidence: '', reason: '' }], updatedAt: now() }
  }
  if (action === 'updateChecklistItem') {
    const [id, changes] = args
    return updateList(project, 'checklist', id, item => ({ ...item, ...changes, status: ['todo','in-progress','complete'].includes(changes?.status) ? changes.status : item.status, evidence: text(changes?.evidence ?? item.evidence, 1200), reason: text(changes?.reason ?? item.reason, 1000) }))
  }
  if (action === 'addPromptRound') {
    const input = args[0]
    if (!text(input?.prompt, 12000)) fail('invalid_input', '提示词轮次内容不能为空')
    return { ...project, promptRounds: [...project.promptRounds, { id: text(input.id, 160) || randomUUID(), prompt: text(input.prompt, 12000), createdAt: now() }], updatedAt: now() }
  }
  fail('unsupported_action', '不支持的投稿操作')
}

export async function applyAcademicAction(store, projectId, action, args, transaction) {
  if (!Array.isArray(args)) fail('invalid_input', '学术操作参数必须为数组')
  const initial = byId(store.read(), projectId)
  const allowed = initial.workspaceKind === 'review'
    ? new Set(['addLiteratureRecords','setScreeningDecision','adjudicateScreeningDecision','setFullTextDecision','setNarrativeSelection','setExtractionValue','confirmExtractionValue','updateExtractionFields','addPromptRound'])
    : new Set(['addCitationClaim','updateCitationSource','addReviewerRound','addReviewerComment','resolveReviewerComment','addRequirementCard','updateRequirementCard','addChecklistItem','updateChecklistItem','addPromptRound'])
  if (!allowed.has(action)) fail('unsupported_action', '学术操作不支持')
  const result = await transact(store, transaction, state => {
    const current = byId(state, projectId)
    if (current.workspaceKind !== initial.workspaceKind) fail('conflict', '学术工作区类型已变化')
    const project = normalizeProject(current)
    const next = current.workspaceKind === 'review'
      ? applyReviewAction(project, state, action, args)
      : applyPublishingAction(project, state, action, args)
    const index = state.academicResponseProjects.findIndex(item => item.id === projectId)
    state.academicResponseProjects[index] = preserveUnknown(current, normalizeProject(next))
  }, `学术操作：${action}`)
  return { project: structuredClone(byId(result, projectId)), revision: result.revision }
}

export function buildAcademicPrompt(input, kind, ids) {
  const project = normalizeProject(input)
  const choose = (items, selectedIds, label) => {
    if (!Array.isArray(selectedIds) || !selectedIds.length) fail('invalid_input', `请至少选择一条${label}`)
    const index = new Map(items.map(item => [item.id, item]))
    return [...new Set(selectedIds)].map(id => {
      const item = index.get(id)
      if (!item) fail('not_found', `所选${label}不存在：${id}`)
      return item
    })
  }
  if (project.workspaceKind === 'review') {
    if (!['review-screening','review-extraction'].includes(kind)) fail('invalid_input', '综述提示词类型无效')
    const records = choose(project.records, ids, '文献')
    const task = kind === 'review-screening'
      ? '按用户纳入标准提出题名摘要筛选候选意见，解释依据与不确定性。题录和摘要不是全文，最终决定由用户作出。'
      : '仅依据用户提供的摘录和定位提出证据提取候选。区分原文、推断和缺失信息；不得补造全文内容，结果待用户核对。'
    const content = records.map((record, index) => `${index + 1}. ${record.snapshot.title}\n作者：${record.snapshot.authors.join('；') || '未提供'}；年份：${record.snapshot.year || '未提供'}\n阅读范围：${record.snapshot.readingStatus}\n用户摘录：${record.snapshot.excerpt || '无'}\n筛选记录：${JSON.stringify(record.screening)}\n已记录提取：${JSON.stringify(record.extraction)}`).join('\n\n')
    return `任务：${task}\n研究问题：${project.question}\n范围：${project.scope}\n\n${content}`.slice(0, 24000)
  }
  let instruction, content
  if (kind === 'reviewer-response') {
    const comments = project.reviewerRounds.flatMap(round => round.comments.map(comment => ({ ...comment, roundTitle: round.title })))
    content = choose(comments, ids, '审稿意见').map((comment, index) => `${index + 1}. 轮次：${comment.roundTitle}；审稿人：${comment.reviewer || '未标注'}\n意见：${comment.rawComment}\n状态：${comment.status}\n回复草稿：${comment.responseDraft || '未填写'}\n实际改动：${comment.changeSummary || '未记录'}；位置：${comment.changeLocation || '未提供'}\n不修改理由：${comment.noChangeReason || '无'}`).join('\n\n')
    instruction = '整理逐条回复草稿；区分已完成修改、计划修改、未解决和不修改。只有已记录的实际改动摘要与位置才能称为已修改，不得编造实验、结果、引文、页码或改稿行为。外发前由用户确认审稿保密要求。'
  } else if (kind === 'citation-check') {
    content = choose(project.citationClaims, ids, '论断').map((claim, index) => `${index + 1}. 论断：${claim.statement}（位置：${claim.manuscriptLocation || '未提供'}）\n${claim.sources.map(source => `来源：${source.snapshot.title || source.knowledgeEntryId}；关系：${source.relation}；用户证据：${source.evidenceExcerpt || '无'}；证据位置：${source.evidenceLocation || '未提供'}`).join('\n') || '未关联来源'}`).join('\n\n')
    instruction = '仅检查用户选定的材料。题录或摘要不能证明全文支持论断；区分证据类型，不可见全文时明确说明。判断仅供用户复核，不执行引用真实性认证。'
  } else if (kind === 'submission-prep') {
    content = choose(project.checklist, ids, '投稿检查项').map((item, index) => `${index + 1}. ${item.title}；状态：${item.status}；要求：${project.requirements.find(requirement => requirement.id === item.requirementId)?.body || '未提供'}；用户证据：${item.evidence || '无'}`).join('\n')
    instruction = '只按用户选定的要求整理检查建议。来源或证据缺失时标为待核对；不把通用建议说成期刊现行规则，不给出自动合规结论，不代用户投稿。'
  } else fail('invalid_input', '投稿提示词类型无效')
  return `${instruction}\n目标：${project.target.venue || '未提供'}；稿件版本：${project.target.manuscriptVersion || '未提供'}\n\n${content}`.slice(0, 24000)
}

export const academicDomains = Object.freeze({ createReviewProject: createAcademicReviewProject, createPublishingProject: createAcademicProject })
