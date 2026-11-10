import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateFullFeatureAcceptance, REQUIRED_FEATURE_IDS } from '../../scripts/dsh-full-feature-acceptance.mjs'

const makeReport = (patch = {}) => ({ items: REQUIRED_FEATURE_IDS.map(id => ({
  id,
  status: 'not-run',
  evidence: Object.fromEntries(['automation', 'host', 'capability', 'migration'].map(type => [type, { status: 'not-run', paths: [] }])),
  ...patch[id],
})) })

test('必须包含固定清单，不能由报告省略需求项', () => {
  const report = makeReport()
  report.items.pop()
  assert.throws(() => evaluateFullFeatureAcceptance(report), /缺少必需项/)
})

test('拒绝未知或重复 ID 以及状态不一致', () => {
  const unknown = makeReport()
  unknown.items[0].id = 'FF-999'
  assert.throws(() => evaluateFullFeatureAcceptance(unknown), /未知 ID/)
  const duplicate = makeReport()
  duplicate.items[1].id = duplicate.items[0].id
  assert.throws(() => evaluateFullFeatureAcceptance(duplicate), /重复/)
  const inconsistent = makeReport({ 'FF-001': { status: 'pass' } })
  assert.throws(() => evaluateFullFeatureAcceptance(inconsistent), /总状态必须/)
})

test('只有每项四类证据全 pass 才能 complete', () => {
  const report = makeReport()
  const first = report.items[0]
  for (const evidence of Object.values(first.evidence)) {
    evidence.status = 'pass'
    evidence.paths = ['docs/evidence.json']
  }
  first.status = 'pass'
  const result = evaluateFullFeatureAcceptance(report)
  assert.equal(result.status, 'incomplete')
  assert.equal(result.passed, 1)
})
