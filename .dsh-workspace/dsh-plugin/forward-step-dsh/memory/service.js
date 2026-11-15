import { createHash, randomUUID } from 'node:crypto'
import { decideScope } from './policy.js'

const SCOPES = new Set(['global', 'domain', 'project', 'task', 'conversation'])
const DOMAIN_RE = /^[a-z][a-z0-9-]{0,31}$/
const LEASE_MS = 30_000
const MAX_TRANSACTION_RETRIES = 8
const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:password|passwd|secret|token|api[_ -]?key)\s*[:=]\s*\S+/i,
]
const MATERIAL_COMMAND_PATTERNS = [
  /忽略(?:此前|以上|之前)(?:的)?(?:指令|规则|提示)/i,
  /(?:读取|访问|泄露|导出)(?:其他|全部|所有)(?:项目|用户|对话|文件)/i,
  /\bignore\s+(?:all\s+)?(?:previous|above)\s+(?:instructions|rules|prompts)\b/i,
  /\b(?:exfiltrate|dump|read)\s+(?:all|other|all other)\s+(?:projects|users|files|conversations)\b/i,
]
const EXPLICIT_PREFERENCE_PATTERNS = [
  /我(?:明确)?(?:偏好|喜欢|更喜欢|习惯|倾向|希望|要求)/,
  /以后(?:请|都|尽量|一律|始终)/,
  /(?:以后|今后|从现在起)(?:改成|改为|采用|使用)/,
  /请(?:尽量|始终|优先|统一|直接)(?:使用|采用|保持|写|做)/,
  /(?:不要|别|避免|请勿)(?:使用|写成|加入|省略|改成)/,
  /\bI\s+(?:prefer|like|want|need)\b/i,
  /\bplease\s+(?:always|use|keep|avoid|do not)\b/i,
]
const SENSITIVE_IDENTITY_PATTERNS = [
  /(?:健康|疾病|诊断|宗教|政治立场|性取向|种族|民族|移民身份|残障|生物识别)/i,
  /\b(?:health condition|diagnosis|religion|political affiliation|sexual orientation|ethnicity|immigration status|disability|biometric)\b/i,
]

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function hasSecret(value) {
  return SECRET_PATTERNS.some(pattern => pattern.test(value))
}

function hasMaterialCommand(value) {
  return MATERIAL_COMMAND_PATTERNS.some(pattern => pattern.test(value))
}

function isExplicitPreference(source) {
  return EXPLICIT_PREFERENCE_PATTERNS.some(pattern => pattern.test(source.excerpt))
}

function explicitScopeFromSources(sources) {
  const text = sources.filter(source => source?.userAuthored === true).map(source => source.excerpt).join('\n')
  if (/(?:所有项目|跨项目|全局|任何项目|all projects|across projects|globally)/i.test(text)) return 'global'
  if (/(?:所有写作(?:任务)?|写作时(?:都|一律)|所有 PPT(?: 任务)?|所有演示文稿|every writing task|all presentations)/i.test(text)) return 'domain'
  if (/(?:仅|只)(?:在)?(?:本|当前|这个)项目|当前项目|这个项目(?:内|中)|this project only|in this project/i.test(text)) return 'project'
  if (/(?:仅|只)(?:在)?(?:本|当前|这个)任务|当前任务|本次任务|this task only|for this task/i.test(text)) return 'task'
  if (/(?:仅|只)(?:在)?(?:本|当前|这个)对话|当前对话|本对话|this conversation only|for this conversation/i.test(text)) return 'conversation'
  return null
}

function isExplicitCorrection(sources) {
  return sources.some(source => source?.userAuthored === true
    && /(?:以后|今后|从现在起)(?:就)?(?:改成|改为|采用|使用)|(?:from now on|instead,? use|change to)/i.test(source.excerpt))
}

function sameScopeIdentity(memory, scope, context) {
  if (memory.scope !== scope) return false
  if (scope === 'global') return true
  if (scope === 'domain') return Array.isArray(memory.domains) && memory.domains.includes(context.domain)
  if (scope === 'project') return memory.projectId === context.projectId
  if (scope === 'task') return memory.projectId === context.projectId && memory.taskId === context.taskId
  if (scope === 'conversation') return memory.projectId === context.projectId && memory.taskId === context.taskId && memory.conversationId === context.conversationId
  return false
}

function commonDomainsForSources(state, sources) {
  const domains = sources.map(source => state.tasks.find(task => task.taskId === source.taskId)?.domain).filter(Boolean)
  if (!domains.length) return []
  const first = domains[0]
  return domains.every(domain => domain === first) ? [first] : []
}

function scopeEvidence(state, candidate, current, newSources, context) {
  const requestedScope = explicitScopeFromSources(candidate.sourceRefs.map(id => newSources.find(source => source.sourceId === id)).filter(Boolean))
  const existingSources = Array.isArray(current?.sourceRefs)
    ? state.sources.filter(source => current.sourceRefs.includes(source.sourceId) && source.active === true && source.userAuthored === true && isExplicitPreference(source))
    : []
  const supportingSources = [...existingSources, ...newSources]
    .filter(source => source.active === true && source.userAuthored === true && isExplicitPreference(source))
  const uniqueByDigest = new Map(supportingSources.map(source => [source.digest, source]))
  const independentSources = [...uniqueByDigest.values()]
  return {
    requestedScope,
    explicitUserScope: requestedScope !== null,
    taskIds: [...new Set(independentSources.map(source => source.taskId))],
    domains: commonDomainsForSources(state, independentSources),
    projectSpecific: candidate.projectSpecific === true,
    conflict: candidate.conflict === true,
    fallbackDomain: context.domain,
  }
}

export function isEligibleUserPreferenceSource(excerpt) {
  if (typeof excerpt !== 'string' || !excerpt.trim()) return false
  return !hasSecret(excerpt)
    && !hasMaterialCommand(excerpt)
    && !SENSITIVE_IDENTITY_PATTERNS.some(pattern => pattern.test(excerpt))
    && isExplicitPreference({ excerpt })
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200
}

function stateLearning(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.tasks) || !Array.isArray(state.sources)
    || !Array.isArray(state.memories) || !Array.isArray(state.changes) || !Array.isArray(state.suppressions)
    || !state.learning || typeof state.learning !== 'object' || !Array.isArray(state.learning.jobs)) {
    throw codedError('storage_failure', '学习存储状态结构无效')
  }
  if (!Array.isArray(state.learning.processedSourceDigests)) state.learning.processedSourceDigests = []
  return state.learning
}

function timestamp(now) {
  const value = now()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw codedError('invalid_input', '学习时钟返回了无效时间')
  return date
}

function stateContext(state, job) {
  const task = state.tasks.find(item => item.taskId === job.taskId && item.projectId === job.projectId)
  if (!task || task.archived === true || !validId(task.domain)) return null
  return {
    projectId: job.projectId,
    taskId: job.taskId,
    conversationId: job.conversationId,
    domain: task.domain,
  }
}

function findSources(state, job) {
  if (!Array.isArray(job.sourceRefs) || job.sourceRefs.length === 0 || job.sourceRefs.some(id => !validId(id))) return null
  const byId = new Map(state.sources.filter(source => source && validId(source.sourceId)).map(source => [source.sourceId, source]))
  const result = []
  const seenIds = new Set()
  const seenDigests = new Set()
  for (const sourceId of job.sourceRefs) {
    if (seenIds.has(sourceId)) continue
    seenIds.add(sourceId)
    const source = byId.get(sourceId)
    if (!source || source.active !== true || source.taskId !== job.taskId || source.projectId !== job.projectId
      || source.conversationId !== job.conversationId || typeof source.digest !== 'string' || !source.digest.trim()
      || typeof source.excerpt !== 'string' || !source.excerpt.trim()) return null
    if (seenDigests.has(source.digest)) continue
    seenDigests.add(source.digest)
    result.push(structuredClone(source))
  }
  return result
}

function normalizeExtractResult(result) {
  let parsed = result
  if (typeof result === 'string') {
    try { parsed = JSON.parse(result) } catch { throw codedError('invalid_output', '学习抽取结果格式无效') }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.candidates)
    || (parsed.summary !== undefined && typeof parsed.summary !== 'string')) {
    throw codedError('invalid_output', '学习抽取结果结构无效')
  }
  return parsed
}

function validCandidate(candidate, sources) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
    || typeof candidate.key !== 'string' || !/^[\p{L}\p{N}_./-]{1,80}$/u.test(candidate.key)
    || typeof candidate.value !== 'string' || !candidate.value.trim() || candidate.value.length > 500
    || !Array.isArray(candidate.sourceRefs) || candidate.sourceRefs.length === 0
    || typeof candidate.reason !== 'string' || !candidate.reason.trim() || candidate.reason.length > 300
    || (candidate.requestedScope !== undefined && !SCOPES.has(candidate.requestedScope))
    || (candidate.domains !== undefined && (!Array.isArray(candidate.domains) || candidate.domains.some(domain => typeof domain !== 'string' || !DOMAIN_RE.test(domain))))
    || (candidate.projectSpecific !== undefined && typeof candidate.projectSpecific !== 'boolean')
    || (candidate.conflict !== undefined && typeof candidate.conflict !== 'boolean')) return false

  const sourceIds = new Set(sources.map(source => source.sourceId))
  if (candidate.sourceRefs.some(id => !validId(id) || !sourceIds.has(id))) return false
  const referencedSources = candidate.sourceRefs.map(id => sources.find(source => source.sourceId === id))
  const explicitScope = explicitScopeFromSources(referencedSources)
  if (candidate.requestedScope !== undefined && candidate.requestedScope !== explicitScope) return false
  if (hasSecret(candidate.key) || hasSecret(candidate.value) || hasSecret(candidate.reason)) return false
  if (hasMaterialCommand(candidate.key) || hasMaterialCommand(candidate.value) || hasMaterialCommand(candidate.reason)) return false
  if (SENSITIVE_IDENTITY_PATTERNS.some(pattern => pattern.test(candidate.key) || pattern.test(candidate.value) || pattern.test(candidate.reason))) return false
  const support = candidate.sourceRefs.map(id => sources.find(source => source.sourceId === id))
  if (support.some(source => source?.kind === 'material' && hasMaterialCommand(source.excerpt))) return false
  return true
}

function scopeFor(state, candidate, current, sources, context) {
  return decideScope(current, scopeEvidence(state, candidate, current, sources, context))
}

function suppressionMatches(state, key, value, sources = []) {
  const keyDigest = digest(key)
  const valueDigest = digest(value)
  const item = state.suppressions.find(record => record && (
    (typeof record.keyDigest === 'string' && record.keyDigest === keyDigest && record.valueDigest === valueDigest)
    || (typeof record.key === 'string' && record.key === key && record.value === value)
  ))
  if (!item) return null
  const suppressedDigests = new Set(item.sourceDigests ?? [])
  const sameSources = sources.length > 0 && sources.every(source => typeof source.digest === 'string' && suppressedDigests.has(source.digest))
  return { item, sameSources }
}

function activeFor(candidate, sources, existing) {
  if (candidate.conflict === true) return false
  const support = candidate.sourceRefs.map(id => sources.find(source => source.sourceId === id))
  if (!support.length || support.some(source => source?.active !== true || source.userAuthored !== true || !isExplicitPreference(source))) return false
  if (existing.some(memory => memory.key === candidate.key && memory.status === 'active'
    && JSON.stringify(memory.value) !== JSON.stringify(candidate.value))) return false
  return true
}

async function transact(store, mutate) {
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    const current = store.read()
    try {
      return await store.transact(current.revision, `learning:${randomUUID()}`, mutate)
    } catch (error) {
      if (error?.code !== 'conflict' || attempt === MAX_TRANSACTION_RETRIES - 1) throw error
    }
  }
  throw codedError('conflict', '学习存储持续变化，请稍后重试')
}

function eventTransact(store, eventId, mutate) {
  const state = store.read()
  return store.transact(state.revision, eventId, mutate)
}

function eligibleJob(job, paused, currentTime) {
  if (paused) return false
  if (job.status === 'queued') return true
  const leaseExpiry = Date.parse(job.leaseUntil ?? '')
  return job.status === 'running' && (!Number.isFinite(leaseExpiry) || leaseExpiry <= currentTime.getTime())
}

function clearLease(job) {
  delete job.leaseId
  delete job.leaseUntil
}

export function createLearningService({ store, extract, now = () => new Date() } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.transact !== 'function' || typeof extract !== 'function' || typeof now !== 'function') {
    throw codedError('invalid_input', '学习服务需要 store、extract 和 now')
  }
  let disposed = false
  let activeDrain
  const activeExtracts = new Map()

  async function claimNext() {
    for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
      if (disposed) return null
      const state = store.read()
      const learning = stateLearning(state)
      const currentTime = timestamp(now)
      if (learning.paused) return null
      const selected = learning.jobs.find(item => eligibleJob(item, false, currentTime))
      if (!selected) return null
      const leaseId = randomUUID()
      const leaseUntil = new Date(currentTime.getTime() + LEASE_MS).toISOString()
      try {
        const next = await store.transact(state.revision, `claim:${selected.jobId}:${leaseId}`, current => {
          const currentLearning = stateLearning(current)
          if (currentLearning.paused) return
          const item = currentLearning.jobs.find(job => job.jobId === selected.jobId)
          if (!item || !eligibleJob(item, false, currentTime)) return
          item.status = 'running'
          item.attempts = (Number.isInteger(item.attempts) ? item.attempts : 0) + 1
          item.leaseId = leaseId
          item.leaseUntil = leaseUntil
          delete item.errorCode
        })
        const claimed = next.learning.jobs.find(item => item.jobId === selected.jobId)
        if (claimed?.leaseId === leaseId && claimed.status === 'running') return structuredClone(claimed)
        return null
      } catch (error) {
        if (error?.code !== 'conflict' || attempt === MAX_TRANSACTION_RETRIES - 1) throw error
      }
    }
    return null
  }

  async function setJobState(jobId, status, errorCode) {
    return transact(store, current => {
      const learning = stateLearning(current)
      const item = learning.jobs.find(job => job.jobId === jobId)
      if (!item) throw codedError('invalid_input', '学习任务不存在')
      item.status = status
      clearLease(item)
      if (errorCode) item.errorCode = errorCode
      else delete item.errorCode
    })
  }

  async function failExtract(jobId, leaseId, errorCode = 'learning_failed') {
    try {
      await transact(store, current => {
        const learning = stateLearning(current)
        const item = learning.jobs.find(job => job.jobId === jobId)
        if (!item || item.status !== 'running' || item.leaseId !== leaseId) return
        item.status = learning.paused ? 'paused' : 'failed'
        clearLease(item)
        if (item.status === 'failed') item.errorCode = errorCode
      })
    } catch {
      // Leave the lease intact: another worker may reclaim it after expiration.
    }
  }

  async function releaseExtract(jobId, leaseId) {
    try {
      await transact(store, current => {
        const learning = stateLearning(current)
        const item = learning.jobs.find(job => job.jobId === jobId)
        if (!item || item.status !== 'running' || item.leaseId !== leaseId) return
        item.status = learning.paused ? 'paused' : 'queued'
        clearLease(item)
        delete item.errorCode
      })
    } catch {
      // 保留租约，由过期回收路径在后续 drain 中恢复。
    }
  }

  async function applyResult(jobId, leaseId, sources, context, output) {
    const eventId = `apply:${jobId}`
    for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
      const state = store.read()
      const learning = stateLearning(state)
      const currentTime = timestamp(now)
      const currentJob = learning.jobs.find(item => item.jobId === jobId)
      if (!currentJob) return 'obsolete'
      if (currentJob.status === 'completed') return 'completed'
      if (currentJob.status !== 'running' || currentJob.leaseId !== leaseId
        || Date.parse(currentJob.leaseUntil ?? '') <= currentTime.getTime()) return 'obsolete'
      if (learning.paused) {
        await eventTransact(store, `pause-result:${jobId}:${leaseId}`, current => {
          const active = stateLearning(current)
          const item = active.jobs.find(job => job.jobId === jobId)
          if (item?.status === 'running' && item.leaseId === leaseId) {
            item.status = 'paused'
            clearLease(item)
          }
        })
        return 'paused'
      }
      const validContext = stateContext(state, currentJob)
      const currentSources = findSources(state, currentJob)
      if (!validContext || !currentSources || currentSources.some(source => source.active !== true)) {
        await eventTransact(store, `discard:${jobId}:${leaseId}`, current => {
          const item = stateLearning(current).jobs.find(job => job.jobId === jobId)
          if (item?.status === 'running' && item.leaseId === leaseId) {
            item.status = 'discarded'
            item.errorCode = 'source_unavailable'
            clearLease(item)
          }
        })
        return 'discarded'
      }
      try {
        const next = await store.transact(state.revision, eventId, current => {
          const currentLearning = stateLearning(current)
          const item = currentLearning.jobs.find(job => job.jobId === jobId)
          const currentNow = timestamp(now)
          if (!item || item.status !== 'running' || item.leaseId !== leaseId
            || Date.parse(item.leaseUntil ?? '') <= currentNow.getTime() || currentLearning.paused) {
            throw codedError('conflict', '学习租约或暂停状态已变化')
          }
          const currentTaskContext = stateContext(current, item)
          const latestSources = findSources(current, item)
          if (!currentTaskContext || !latestSources) throw codedError('conflict', '学习来源已失效')

          const processed = new Set(currentLearning.processedSourceDigests)
          const acceptedSources = latestSources.filter(source => !processed.has(source.digest))
          const acceptedIds = new Set(acceptedSources.map(source => source.sourceId))
          const candidates = output.candidates.filter(candidate => validCandidate(candidate, acceptedSources)
            && candidate.sourceRefs.every(sourceId => acceptedIds.has(sourceId)))
          const candidateDigestSet = new Set()

          for (const candidate of candidates) {
            const identity = `${digest(candidate.key)}:${digest(candidate.value)}`
            if (candidateDigestSet.has(identity)) continue
            candidateDigestSet.add(identity)
            const existing = current.memories.filter(memory => memory.key === candidate.key)
            const sourceRefs = [...new Set(candidate.sourceRefs)]
            const referencedSources = sourceRefs.map(sourceId => acceptedSources.find(source => source.sourceId === sourceId)).filter(Boolean)
            const explicitCorrection = candidate.conflict !== true && isExplicitCorrection(referencedSources)
            const suppression = suppressionMatches(current, candidate.key, candidate.value, referencedSources)
            if (suppression?.sameSources && !explicitCorrection) continue
            if (explicitCorrection && suppression) {
              current.suppressions = current.suppressions.filter(item => item !== suppression.item)
            }
            const suppressedCandidate = Boolean(suppression && !explicitCorrection)
            const same = suppressedCandidate ? undefined : existing.find(memory => JSON.stringify(memory.value) === JSON.stringify(candidate.value))
            const scope = scopeFor(current, candidate, same, acceptedSources, currentTaskContext)
            const replaced = explicitCorrection
              ? existing.filter(memory => memory.status === 'active' && JSON.stringify(memory.value) !== JSON.stringify(candidate.value)
                && sameScopeIdentity(memory, scope, currentTaskContext))
              : []
            const status = suppressedCandidate ? 'candidate' : explicitCorrection || activeFor(candidate, acceptedSources, existing.filter(memory => !replaced.includes(memory))) ? 'active' : 'candidate'
            for (const previous of replaced) {
              const before = { revision: previous.revision, status: previous.status, value: previous.value, scope: previous.scope, sourceRefs: structuredClone(previous.sourceRefs ?? []) }
              previous.status = 'disabled'
              previous.revision = (Number.isInteger(previous.revision) ? previous.revision : 0) + 1
              previous.updatedAt = currentNow.toISOString()
              current.changes.push({ eventId, jobId, memoryId: previous.memoryId, before, after: { revision: previous.revision, status: previous.status, value: previous.value, scope: previous.scope, sourceRefs: structuredClone(previous.sourceRefs ?? []) }, reason: 'user_correction', changedFields: ['status'], createdAt: currentNow.toISOString() })
            }
            if (same) {
              const oldSources = Array.isArray(same.sourceRefs) ? same.sourceRefs : []
              const merged = [...new Set([...oldSources, ...sourceRefs])]
              if (merged.length === oldSources.length) continue
              const before = { revision: same.revision, status: same.status, sourceRefs: oldSources, scope: same.scope, domains: structuredClone(same.domains ?? []) }
              same.sourceRefs = merged
              if (!same.manualScope) {
                same.scope = scope
                same.domains = scope === 'domain' ? (commonDomainsForSources(current, [...current.sources.filter(source => merged.includes(source.sourceId)), ...acceptedSources]) || [currentTaskContext.domain]) : []
              }
              same.revision = (Number.isInteger(same.revision) ? same.revision : 0) + 1
              same.updatedAt = currentNow.toISOString()
              if (same.status !== 'active' && status === 'active') same.status = 'active'
              const after = { revision: same.revision, status: same.status, sourceRefs: merged, scope: same.scope, domains: structuredClone(same.domains) }
              const changedFields = Object.keys(after).filter(field => !['revision'].includes(field) && JSON.stringify(before[field]) !== JSON.stringify(after[field]))
              current.changes.push({ eventId, jobId, memoryId: same.memoryId, before, after, reason: 'automatic_learning', changedFields, createdAt: currentNow.toISOString() })
              continue
            }
            const memory = {
              memoryId: randomUUID(), revision: 1, key: candidate.key, value: candidate.value,
              scope, projectId: item.projectId, taskId: item.taskId, conversationId: item.conversationId,
              domains: scope === 'domain' ? (commonDomainsForSources(current, acceptedSources).length ? commonDomainsForSources(current, acceptedSources) : [currentTaskContext.domain]) : [],
              status, sourceRefs, reason: candidate.reason, manualScope: false,
              createdAt: currentNow.toISOString(), updatedAt: currentNow.toISOString(),
            }
            current.memories.push(memory)
            current.changes.push({ eventId, jobId, memoryId: memory.memoryId, before: null, after: structuredClone(memory), reason: 'automatic_learning', changedFields: ['key', 'value', 'scope', 'domains', 'status', 'sourceRefs', 'reason', 'manualScope'], createdAt: currentNow.toISOString() })
          }
          for (const source of acceptedSources) processed.add(source.digest)
          currentLearning.processedSourceDigests = [...processed]
          item.status = 'completed'
          item.completedAt = currentNow.toISOString()
          if (typeof output.summary === 'string' && output.summary.trim() && !hasSecret(output.summary)
            && !hasMaterialCommand(output.summary) && !SENSITIVE_IDENTITY_PATTERNS.some(pattern => pattern.test(output.summary))) {
            item.summary = output.summary.trim().slice(0, 300)
          }
          clearLease(item)
        })
        return next.learning.jobs.find(item => item.jobId === jobId)?.status === 'completed' ? 'completed' : 'obsolete'
      } catch (error) {
        if (error?.code === 'conflict' && attempt < MAX_TRANSACTION_RETRIES - 1) continue
        throw error
      }
    }
    return 'obsolete'
  }

  async function process(job) {
    const state = store.read()
    const context = stateContext(state, job)
    const sources = context ? findSources(state, job) : null
    if (!context || !sources) {
      await failExtract(job.jobId, job.leaseId, 'invalid_source')
      return 'failed'
    }
    const learning = stateLearning(state)
    const processed = new Set(learning.processedSourceDigests)
    const freshSources = sources.filter(source => !processed.has(source.digest))
    if (!freshSources.length) {
      const output = { candidates: [], summary: '' }
      try { return await applyResult(job.jobId, job.leaseId, sources, context, output) } catch { return 'pending' }
    }
    const controller = new AbortController()
    activeExtracts.set(job.jobId, { taskId: job.taskId, controller })
    let output
    try {
      const extracted = await extract({ jobId: job.jobId, sourceRefs: structuredClone(freshSources), context: structuredClone(context), signal: controller.signal })
      if (controller.signal.aborted) {
        await releaseExtract(job.jobId, job.leaseId)
        return 'obsolete'
      }
      output = normalizeExtractResult(extracted)
    } catch {
      if (controller.signal.aborted) {
        await releaseExtract(job.jobId, job.leaseId)
        return 'obsolete'
      }
      await failExtract(job.jobId, job.leaseId)
      return 'failed'
    } finally {
      if (activeExtracts.get(job.jobId)?.controller === controller) activeExtracts.delete(job.jobId)
    }
    try { return await applyResult(job.jobId, job.leaseId, freshSources, context, output) } catch {
      // Do not mark a result failed when persistence itself failed. The running lease is recoverable.
      return 'pending'
    }
  }

  async function drainJobs() {
    let processed = 0
    let failed = 0
    while (!disposed) {
      const claimed = await claimNext()
      if (!claimed) break
      const result = await process(claimed)
      if (result === 'completed') processed += 1
      else if (result === 'failed' || result === 'discarded') failed += 1
      if (result === 'pending' || result === 'obsolete' || result === 'paused') break
    }
    return { processed, failed, paused: Boolean(stateLearning(store.read()).paused) }
  }

  function drain() {
    if (activeDrain) return activeDrain
    if (disposed) return Promise.resolve({ processed: 0, failed: 0, paused: Boolean(stateLearning(store.read()).paused) })
    const operation = drainJobs()
    activeDrain = operation
    void operation.then(
      () => { if (activeDrain === operation) activeDrain = undefined },
      () => { if (activeDrain === operation) activeDrain = undefined },
    )
    return operation
  }

  async function retry(jobId) {
    if (!validId(jobId)) throw codedError('invalid_input', '学习任务标识无效')
    const result = await transact(store, state => {
      const learning = stateLearning(state)
      const item = learning.jobs.find(job => job.jobId === jobId)
      if (!item) throw codedError('invalid_input', '学习任务不存在')
      if (item.status === 'completed') return
      if (item.status !== 'failed' && item.status !== 'paused') throw codedError('conflict', '只有失败或暂停的学习任务可以重试')
      item.status = learning.paused ? 'paused' : 'queued'
      delete item.errorCode
      clearLease(item)
      delete item.summary
    })
    return structuredClone(result.learning.jobs.find(item => item.jobId === jobId))
  }

  async function setPaused(paused) {
    if (typeof paused !== 'boolean') throw codedError('invalid_input', '暂停状态必须为布尔值')
    const result = await transact(store, state => {
      const learning = stateLearning(state)
      learning.paused = paused
      for (const job of learning.jobs) {
        if (paused && job.status === 'queued') job.status = 'paused'
        if (!paused && job.status === 'paused') job.status = 'queued'
      }
    })
    return Boolean(stateLearning(result).paused)
  }

  function cancelTask(taskId) {
    let cancelled = 0
    for (const item of activeExtracts.values()) {
      if (item.taskId !== taskId || item.controller.signal.aborted) continue
      item.controller.abort(codedError('cancelled', '任务已删除，取消对应学习请求'))
      cancelled += 1
    }
    return cancelled
  }

  async function dispose() {
    if (!disposed) {
      disposed = true
      for (const { controller } of activeExtracts.values()) {
        if (!controller.signal.aborted) controller.abort(codedError('cancelled', '插件卸载，保留学习任务以便重启后续做'))
      }
    }
    await activeDrain
  }

  return { drain, retry, setPaused, cancelTask, dispose }
}
