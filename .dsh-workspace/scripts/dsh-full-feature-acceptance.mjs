import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REQUIRED_FEATURE_IDS = Object.freeze([
  'FF-001', 'FF-002', 'FF-003', 'FF-004', 'FF-005', 'FF-006', 'FF-007',
  'FF-008', 'FF-009', 'FF-010', 'FF-011', 'FF-012', 'FF-013', 'FF-014',
])
const EVIDENCE_TYPES = Object.freeze(['automation', 'host', 'capability', 'migration'])
const VALID_STATES = new Set(['pass', 'fail', 'not-run'])

export function evaluateFullFeatureAcceptance(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report) || !Array.isArray(report.items)) {
    throw new TypeError('全功能验收报告必须包含 items 数组')
  }
  const ids = report.items.map(item => item?.id)
  if (new Set(ids).size !== ids.length) throw new TypeError('全功能验收项 ID 重复')
  if (ids.some(id => !REQUIRED_FEATURE_IDS.includes(id))) throw new TypeError('全功能验收报告包含未知 ID')
  if (REQUIRED_FEATURE_IDS.some(id => !ids.includes(id))) throw new TypeError('全功能验收报告缺少必需项')
  for (const item of report.items) {
    if (!VALID_STATES.has(item.status)) throw new TypeError(`全功能验收状态非法: ${item.id}`)
    if (!item.evidence || typeof item.evidence !== 'object' || Array.isArray(item.evidence)) throw new TypeError(`验收证据结构无效: ${item.id}`)
    for (const type of EVIDENCE_TYPES) {
      const evidence = item.evidence[type]
      if (!evidence || !VALID_STATES.has(evidence.status)) throw new TypeError(`${item.id} 缺少 ${type} 状态`)
      if (evidence.status === 'pass' && (!Array.isArray(evidence.paths) || evidence.paths.length === 0 || evidence.paths.some(path => typeof path !== 'string' || !path.trim()))) {
        throw new TypeError(`${item.id} 的 ${type} 通过项必须附证据路径`)
      }
    }
    const evidencePass = EVIDENCE_TYPES.every(type => item.evidence[type].status === 'pass')
    const derived = evidencePass ? 'pass' : EVIDENCE_TYPES.some(type => item.evidence[type].status === 'fail') ? 'fail' : 'not-run'
    if (item.status !== derived) throw new TypeError(`${item.id} 总状态必须与分项证据一致`)
  }
  const complete = report.items.every(item => item.status === 'pass')
  return {
    status: complete ? 'complete' : 'incomplete',
    required: REQUIRED_FEATURE_IDS.length,
    passed: report.items.filter(item => item.status === 'pass').length,
    remaining: report.items.filter(item => item.status !== 'pass').map(item => item.id),
    items: report.items,
  }
}

async function main() {
  const input = resolve(process.argv[2] ?? 'docs/acceptance/forward-step-dsh/full-feature-results.json')
  const output = resolve(process.argv[3] ?? input)
  const source = JSON.parse(await readFile(input, 'utf8'))
  const result = evaluateFullFeatureAcceptance(source)
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  process.stdout.write(`${result.status}: ${result.passed}/${result.required} required features passed\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
