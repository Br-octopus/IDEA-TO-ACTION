import { randomUUID } from 'node:crypto'

const promptKinds = new Set(['prompt', 'agent-output'])
const reviewVerdicts = new Set(['success', 'failure', 'unverified'])

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

export function appendVersion(task, input) {
  if (!task || typeof task.taskId !== 'string' || !Array.isArray(task.versions)) {
    throw fail('invalid_input', '版本所属任务无效')
  }
  const { kind, stage, stepId, content } = input ?? {}
  if (!['prompt', 'agent-output', 'external-result'].includes(kind)
    || typeof stage !== 'string' || !stage.trim()
    || typeof stepId !== 'string' || !stepId.trim()
    || typeof content !== 'string') {
    throw fail('invalid_input', '版本输入无效')
  }
  if (kind === 'external-result' && (input.source !== 'user-pasted' || typeof input.promptVersionId !== 'string' || !input.promptVersionId.trim())) {
    throw fail('invalid_input', '外部结果必须标记来源并关联提示词版本')
  }
  const version = {
    ...input,
    versionId: randomUUID(),
    taskId: task.taskId,
    createdAt: new Date().toISOString(),
    stale: false,
    usedMemories: input.usedMemories ?? [],
    usedSources: input.usedSources ?? [],
    omissions: input.omissions ?? [],
  }
  return { ...task, versions: [...task.versions, version] }
}

export function markStale(task, reason) {
  if (!task || !Array.isArray(task.versions) || typeof reason !== 'string' || !reason.trim()) {
    throw fail('invalid_input', '陈旧版本标记参数无效')
  }
  return {
    ...task,
    versions: task.versions.map(version => promptKinds.has(version.kind)
      ? { ...version, stale: true, staleReason: reason }
      : version),
  }
}

export function appendReview(task, input) {
  if (!task || typeof task.taskId !== 'string' || !Array.isArray(task.versions) || !Array.isArray(task.reviews)) {
    throw fail('invalid_input', '复盘所属任务无效')
  }
  const { resultVersionId, promptVersionId, verdict, checks = [], feedback = '', confirmed = false } = input ?? {}
  if (typeof resultVersionId !== 'string' || typeof promptVersionId !== 'string'
    || !reviewVerdicts.has(verdict) || !Array.isArray(checks)
    || checks.some(item => !item || typeof item.requirement !== 'string' || !item.requirement.trim()
      || !['pass', 'fail', 'not-checked'].includes(item.result)
      || (item.note !== undefined && typeof item.note !== 'string')) || typeof feedback !== 'string'
    || typeof confirmed !== 'boolean') {
    throw fail('invalid_input', '复盘输入无效')
  }
  const requirements = Array.isArray(task.currentRequirements) ? task.currentRequirements : []
  if (checks.length !== requirements.length || checks.some((item, index) => item.requirement !== requirements[index])) {
    throw fail('invalid_input', '复盘检查项必须按顺序完整覆盖当前任务要求')
  }
  if (confirmed && verdict === 'success' && checks.some(item => item.result !== 'pass')) {
    throw fail('invalid_input', '确认成功前必须将每条适用要求标记为通过')
  }
  if (confirmed && verdict === 'failure' && checks.length > 0 && !checks.some(item => item.result === 'fail')) {
    throw fail('invalid_input', '确认失败时至少需要一条明确未通过的要求')
  }
  const result = task.versions.find(version => version.versionId === resultVersionId && version.kind === 'external-result')
  const prompt = task.versions.find(version => version.versionId === promptVersionId && promptKinds.has(version.kind))
  if (!result || !prompt || result.promptVersionId !== prompt.versionId
    || result.stepId !== prompt.stepId) {
    throw fail('invalid_input', '复盘必须关联同任务、同步骤且互相匹配的提示词与外部结果版本')
  }
  const review = {
    reviewId: randomUUID(),
    resultVersionId,
    promptVersionId,
    stepId: result.stepId,
    verdict,
    checks: checks.map(item => ({ ...item })),
    feedback,
    confirmed: confirmed && verdict !== 'unverified',
    requirementsSnapshot: [...(task.currentRequirements ?? [])],
    createdAt: new Date().toISOString(),
  }
  return { ...task, reviews: [...task.reviews, review] }
}
