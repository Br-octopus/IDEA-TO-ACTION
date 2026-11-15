import test from 'node:test'
import assert from 'node:assert/strict'
import { decideScope } from '../../dsh-plugin/forward-step-dsh/memory/policy.js'

const evidence = overrides => ({ taskIds: ['task-a', 'task-b'], domains: [], ...overrides })

test('人工固定范围不被自动提升覆盖，用户显式设置可以更改', () => {
  const current = { scope: 'task', manualScope: true }
  assert.equal(decideScope(current, evidence({ taskIds: ['task-a', 'task-b', 'task-c'] })), 'task')
  assert.equal(decideScope(current, evidence({ explicitUserScope: true, requestedScope: 'project' })), 'project')
})

test('用户明确指定的合法范围立即生效', () => {
  for (const scope of ['global', 'domain', 'project', 'task', 'conversation']) {
    assert.equal(decideScope(null, evidence({ explicitUserScope: true, requestedScope: scope, taskIds: ['task-a'] })), scope)
  }
})

test('冲突和项目专属证据不会自动扩大范围', () => {
  assert.equal(decideScope(null, evidence({ conflict: true })), 'task')
  assert.equal(decideScope({ scope: 'project' }, evidence({ projectSpecific: true })), 'project')
})

test('不同任务重复证据可提升，领域证据保留领域范围', () => {
  assert.equal(decideScope(null, evidence({ taskIds: ['task-a', 'task-a'] })), 'task')
  assert.equal(decideScope(null, evidence()), 'global')
  assert.equal(decideScope(null, evidence({ domains: ['writing'] })), 'domain')
  assert.equal(decideScope(null, evidence({ domains: ['writing', 'writing'] })), 'domain')
})

test('未知输入回退到最窄范围', () => {
  assert.equal(decideScope(null, evidence({ taskIds: ['task-a'], explicitUserScope: true, requestedScope: 'unknown' })), 'task')
  assert.equal(decideScope({ scope: 'unknown' }, null), 'task')
})
