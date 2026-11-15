import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REQUIRED_GROUPS = Object.freeze({
  'installation-isolation': 'installation',
  'installation-data-retention': 'installation',
  'three-methods': 'interaction',
  'artifact-boundary': 'installation',
  'multi-task': 'automation',
  'cross-session': 'automation',
  'auto-learning': 'automation',
  'scope-sharing': 'automation',
  'manual-priority': 'automation',
  'visible-learning': 'interaction',
  'undo-correction': 'automation',
  'fault-concurrency': 'automation',
  'real-effects': 'modelEffects',
  'entry-domain': 'interaction',
  'actual-context': 'automation',
  'explicit-global': 'automation',
  'memory-lifecycle': 'automation',
  'manual-loop': 'interaction',
  'request-budget': 'automation',
  'user-feedback': 'userFeedback',
})

const GROUPS = Object.freeze(['automation', 'installation', 'interaction', 'modelEffects', 'userFeedback'])
const REQUIRED_ENVIRONMENT = Object.freeze([
  'exeSha256', 'asarSha256', 'cliVersion', 'launchCommand', 'profile', 'pluginRoot', 'pluginVersion', 'dataPath',
])

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function findMissingEvidencePaths(items, workspaceRoot = process.cwd()) {
  if (!Array.isArray(items)) throw new TypeError('验收项必须是数组')
  const missing = []
  for (const item of items) {
    if (item?.status !== 'pass') continue
    const paths = [
      ...(nonEmpty(item.evidencePath) ? item.evidencePath.split(';') : []),
      ...(Array.isArray(item.evidencePaths) ? item.evidencePaths : []),
      ...(nonEmpty(item.feedbackEvidencePath) ? [item.feedbackEvidencePath] : []),
    ].map(path => typeof path === 'string' ? path.trim() : '').filter(Boolean)

    for (const evidencePath of paths) {
      try {
        if (!statSync(resolve(workspaceRoot, evidencePath)).isFile()) missing.push(`${item.id}:${evidencePath}`)
      } catch {
        missing.push(`${item.id}:${evidencePath}`)
      }
    }
  }
  return missing
}

export function summarizeAcceptance(items) {
  if (!Array.isArray(items)) throw new TypeError('验收项必须是数组')
  const ids = items.map(item => item?.id)
  if (new Set(ids).size !== ids.length || items.some(item => (
    !nonEmpty(item?.id)
    || !GROUPS.includes(item.group)
    || !['pass', 'fail', 'not-run'].includes(item.status)
  ))) throw new TypeError('验收项重复或状态非法')
  for (const [id, group] of Object.entries(REQUIRED_GROUPS)) {
    const item = items.find(candidate => candidate.id === id)
    if (item && item.group !== group) throw new TypeError(`必需验收项 ${id} 必须归入 ${group}`)
  }

  const groups = Object.fromEntries(GROUPS.map(group => [group, items.filter(item => item.group === group)]))
  const remaining = Object.keys(REQUIRED_GROUPS).filter(id => items.find(item => item.id === id)?.status !== 'pass')
  return { status: remaining.length === 0 ? 'complete' : 'incomplete', groups, remaining }
}

export function evaluateAcceptance(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new TypeError('验收报告必须是对象')
  const summary = summarizeAcceptance(report.items)
  const environment = report.environment ?? {}
  const missingEnvironment = REQUIRED_ENVIRONMENT.filter(field => (
    !nonEmpty(environment[field])
    || (['exeSha256', 'asarSha256'].includes(field) && !/^[a-f0-9]{64}$/i.test(environment[field]))
  ))
  const evidenceGaps = []
  for (const item of report.items) {
    if (item.status !== 'pass') continue
    if (
      (item.group === 'interaction' || item.id === 'installation-data-retention')
      && !nonEmpty(item.evidencePath)
    ) evidenceGaps.push(`${item.id}:evidencePath`)
    if (item.id === 'installation-data-retention') {
      const retention = item.retentionEvidence
      const hasRecords = ['before', 'after'].every(period => ['taskCount', 'memoryCount'].every(key => (
        Number.isSafeInteger(retention?.[period]?.[key]) && retention[period][key] > 0
      )))
      if (
        !hasRecords
        || retention.taskListReadAfterReinstall !== true
        || retention.memoryVisibleAfterReinstall !== true
      ) evidenceGaps.push('installation-data-retention:task-and-memory-readback')
    }
    if (item.id === 'real-effects' && (
      !nonEmpty(item.model)
      || !Array.isArray(item.evidencePaths)
      || item.evidencePaths.length === 0
      || item.evidencePaths.some(path => !nonEmpty(path))
    )) evidenceGaps.push('real-effects:model-or-evidence')
    if (item.id === 'user-feedback' && (
      item.feedbackSource !== 'user'
      || !nonEmpty(item.feedbackEvidencePath)
    )) evidenceGaps.push('user-feedback:user-evidence')
  }

  const remaining = [...summary.remaining]
  if (missingEnvironment.length) remaining.push(...missingEnvironment.map(field => `environment:${field}`))
  if (evidenceGaps.length) remaining.push(...evidenceGaps)
  return {
    status: remaining.length === 0 ? 'complete' : 'incomplete',
    groups: summary.groups,
    remaining,
    missingEnvironment,
    evidenceGaps,
  }
}

function parseInput(args) {
  const index = args.indexOf('--input')
  if (index < 0) return resolve('docs/acceptance/forward-step-dsh/acceptance-report.json')
  if (!args[index + 1]) throw new TypeError('--input 后必须提供报告路径')
  return resolve(args[index + 1])
}

async function runCli() {
  const inputPath = parseInput(process.argv.slice(2))
  const report = JSON.parse(await readFile(inputPath, 'utf8'))
  const result = evaluateAcceptance(report)
  for (const missingPath of findMissingEvidencePaths(report.items, process.cwd())) {
    const gap = `evidence-file:${missingPath}`
    result.evidenceGaps.push(gap)
    result.remaining.push(gap)
  }
  if (result.remaining.length) result.status = 'incomplete'
  console.log(JSON.stringify({ inputPath, ...result }, null, 2))
  if (result.status !== 'complete') process.exitCode = 1
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    console.error(error.message)
    process.exitCode = 2
  })
}
