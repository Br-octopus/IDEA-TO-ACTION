import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { evaluateAcceptance, findMissingEvidencePaths, REQUIRED_GROUPS, summarizeAcceptance } from '../../scripts/dsh-acceptance.mjs'

const completeReport = () => ({
  environment: {
    exeSha256: 'a'.repeat(64), asarSha256: 'b'.repeat(64), cliVersion: '0.2.0-rc.2',
    launchCommand: 'pwsh.exe -File launch-isolated-dsh.ps1', profile: 'forward-step-test',
    pluginRoot: 'D:/workspace/dsh-plugin/forward-step-dsh', pluginVersion: '0.2.0-beta.1',
    dataPath: 'D:/workspace/profile/storages/forward_step_dsh.json',
  },
  items: Object.entries(REQUIRED_GROUPS).map(([id, group]) => ({
    id,
    group,
    status: 'pass',
    ...(group === 'interaction' || id === 'installation-data-retention'
      ? { evidencePath: `screenshots/${id}.png` }
      : {}),
    ...(id === 'real-effects' ? { model: 'test-model', evidencePaths: ['effects.md'] } : {}),
    ...(id === 'installation-data-retention' ? {
      retentionEvidence: {
        before: { taskCount: 1, memoryCount: 1 },
        after: { taskCount: 1, memoryCount: 1 },
        taskListReadAfterReinstall: true,
        memoryVisibleAfterReinstall: true,
      },
    } : {}),
    ...(id === 'user-feedback' ? { feedbackSource: 'user', feedbackEvidencePath: 'feedback.md' } : {}),
  })),
})

test('缺少真实 GUI、模型或用户反馈时不能宣告 complete', () => {
  const report = completeReport()
  report.items.find(item => item.id === 'three-methods').status = 'not-run'
  report.items.find(item => item.id === 'real-effects').status = 'not-run'
  report.items.find(item => item.id === 'user-feedback').status = 'not-run'
  const result = evaluateAcceptance(report)
  assert.equal(result.status, 'incomplete')
  assert.ok(result.remaining.includes('three-methods'))
  assert.ok(result.remaining.includes('real-effects'))
  assert.ok(result.remaining.includes('user-feedback'))
})

test('缺少宿主指纹、启动命令、插件路径或数据路径时仍为 incomplete', () => {
  const report = completeReport()
  report.environment.exeSha256 = ''
  report.environment.launchCommand = null
  report.environment.pluginRoot = ''
  report.environment.dataPath = null
  const result = evaluateAcceptance(report)
  assert.equal(result.status, 'incomplete')
  assert.deepEqual(result.missingEnvironment, ['exeSha256', 'launchCommand', 'pluginRoot', 'dataPath'])
})

test('宿主 SHA256 必须为完整十六进制指纹', () => {
  const report = completeReport()
  report.environment.asarSha256 = 'not-a-hash'
  const result = evaluateAcceptance(report)
  assert.equal(result.status, 'incomplete')
  assert.ok(result.missingEnvironment.includes('asarSha256'))
})

test('required 标志不能把 fail 或 not-run 降为非必需项', () => {
  const items = completeReport().items
  const target = items.find(item => item.id === 'fault-concurrency')
  target.status = 'fail'
  target.required = false
  assert.equal(summarizeAcceptance(items).status, 'incomplete')
  assert.ok(summarizeAcceptance(items).remaining.includes('fault-concurrency'))
})

test('空报告或漏报任一必需项都保持 incomplete', () => {
  const empty = summarizeAcceptance([])
  assert.equal(empty.status, 'incomplete')
  assert.deepEqual(empty.remaining, Object.keys(REQUIRED_GROUPS))

  const items = completeReport().items.filter(item => item.id !== 'fault-concurrency')
  const missing = summarizeAcceptance(items)
  assert.equal(missing.status, 'incomplete')
  assert.ok(missing.remaining.includes('fault-concurrency'))
})

test('导入汇总器模块不会自动运行 CLI', () => {
  const moduleUrl = pathToFileURL(resolve('scripts/dsh-acceptance.mjs')).href
  const child = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `await import(${JSON.stringify(moduleUrl)})`,
  ], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stdout, '')
})

test('user-feedback 只有真实用户来源并附证据后才可通过', () => {
  const report = completeReport()
  const feedback = report.items.find(item => item.id === 'user-feedback')
  feedback.feedbackSource = 'model-self-review'
  feedback.feedbackEvidencePath = null
  const result = evaluateAcceptance(report)
  assert.equal(result.status, 'incomplete')
  assert.ok(result.evidenceGaps.includes('user-feedback:user-evidence'))
})

test('真实效果通过必须带模型与输出证据', () => {
  const report = completeReport()
  const effects = report.items.find(item => item.id === 'real-effects')
  delete effects.model
  effects.evidencePaths = []
  const result = evaluateAcceptance(report)
  assert.equal(result.status, 'incomplete')
  assert.ok(result.evidenceGaps.includes('real-effects:model-or-evidence'))
})

test('卸载/重装数据保留通过必须附有可追溯证据', () => {
  const report = completeReport()
  const item = report.items.find(candidate => candidate.id === 'installation-data-retention')
  item.evidencePath = null
  const result = evaluateAcceptance(report)
  assert.equal(result.status, 'incomplete')
  assert.ok(result.evidenceGaps.includes('installation-data-retention:evidencePath'))
})

test('卸载/重装数据保留需要前后任务、记忆和 UI 读回', () => {
  const invalidEvidence = [
    evidence => { evidence.before.memoryCount = 0 },
    evidence => { evidence.after.taskCount = 0 },
    evidence => { evidence.taskListReadAfterReinstall = false },
    evidence => { evidence.memoryVisibleAfterReinstall = false },
  ]
  for (const invalidate of invalidEvidence) {
    const report = completeReport()
    const item = report.items.find(candidate => candidate.id === 'installation-data-retention')
    invalidate(item.retentionEvidence)
    const result = evaluateAcceptance(report)
    assert.equal(result.status, 'incomplete')
    assert.ok(result.evidenceGaps.includes('installation-data-retention:task-and-memory-readback'))
  }
})

test('通过项引用的本地证据路径必须指向真实文件', () => {
  const items = [{ id: 'evidence-check', status: 'pass', evidencePath: 'scripts/dsh-acceptance.mjs; missing-evidence.md' }]
  assert.deepEqual(findMissingEvidencePaths(items, process.cwd()), ['evidence-check:missing-evidence.md'])
  items[0].evidencePath = 'scripts/dsh-acceptance.mjs'
  assert.deepEqual(findMissingEvidencePaths(items, process.cwd()), [])
})

test('重复项、非法状态或错误分组明确报错', () => {
  const items = completeReport().items
  assert.throws(() => summarizeAcceptance([...items, items[0]]), TypeError)
  assert.throws(() => summarizeAcceptance([{ id: 'arbitrary', group: 'automation', status: 'pending' }]), TypeError)
  assert.throws(() => summarizeAcceptance([{ id: 'real-effects', group: 'automation', status: 'pass' }]), /必须归入 modelEffects/)
})

test('全部必需项、环境事实与用户/模型证据齐备时才 complete', () => {
  assert.equal(evaluateAcceptance(completeReport()).status, 'complete')
})
