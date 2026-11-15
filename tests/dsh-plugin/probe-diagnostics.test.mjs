import test from 'node:test'
import assert from 'node:assert/strict'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'

const storageDomain = { open: async () => { throw new Error('不应访问存储域') } }

test('Agent/Session 探针以受控阶段报告缺失宿主服务', async () => {
  const probe = new ForwardStepProbe(storageDomain, undefined, { registerAdapter() { return () => {} } })
  const result = await probe.agentIsolation(new AbortController().signal)

  assert.equal(result.passed, false)
  assert.equal(result.diagnosticStage, 'service-injection-check')
  assert.equal(result.diagnosticErrorName, 'Error')
  assert.match(result.diagnosticErrorMessage, /Agent\/LLM services are unavailable/)
  assert.equal(result.agentsDisposed, true)
  assert.equal(result.adapterReleased, false)
})

test('Agent/Session 探针保留 Agent 创建阶段的原始错误且不泄露令牌', async () => {
  let adapterReleased = false
  const probe = new ForwardStepProbe(storageDomain, {
    async create() { throw new Error('agent create failed token=sk-abcdefghijk') },
  }, {
    registerAdapter() { return () => { adapterReleased = true } },
  })
  const result = await probe.agentIsolation(new AbortController().signal)

  assert.equal(result.passed, false)
  assert.equal(result.diagnosticStage, 'create-agent-A')
  assert.equal(result.diagnosticErrorName, 'Error')
  assert.match(result.diagnosticErrorMessage, /\[REDACTED\]/)
  assert.doesNotMatch(result.diagnosticErrorMessage, /sk-abcdefghijk/)
  assert.equal(result.adapterReleased, true)
  assert.equal(adapterReleased, true)
})
