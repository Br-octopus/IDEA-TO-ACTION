import test from 'node:test'
import assert from 'node:assert/strict'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'

const storageDomain = { open: async () => { throw new Error('不应访问存储域') } }

test('真实模型探针审计实际 llm/stream 消息且只返回脱敏的隔离事实', async () => {
  let probe
  const disposed = []
  const agents = {
    async create({ sessionId }) {
      return {
        agent: {
          session: {
            id: sessionId,
            snapshotEvents: () => [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }],
          },
          status: 'idle',
          followup(message) {
            // 模拟 DSH LLM runtime 在真实适配器调用前发出的 llm/stream 事件。
            probe.captureRealModelRequest({
              sessionId,
              provider: 'p',
              model: 'm',
              messages: [{ role: 'user', content: message.content }],
            })
          },
          whenIdle: async () => {},
          cancel() {},
        },
        async dispose() { disposed.push(sessionId) },
      }
    },
  }
  const llm = { listProviders: () => [{ id: 'p' }], listModels: async () => [{ provider: 'p', id: 'm' }] }
  probe = new ForwardStepProbe(storageDomain, agents, llm)
  const result = await probe.realModelIsolation({ provider: 'p', model: 'm' }, new AbortController().signal)

  assert.equal(result.passed, true)
  assert.equal(result.taskRequestCount, 2)
  assert.equal(result.requestAIsolated, true)
  assert.equal(result.requestBIsolated, true)
  assert.equal(result.sessionsDistinct, true)
  assert.equal(result.agentsDisposed, true)
  assert.equal(result.requests.length, 2)
  assert.equal(result.requests.every(request => request.messageDigest && request.messageCount === 1), true)
  assert.doesNotMatch(JSON.stringify(result), /REAL_TASK_[AB]_/)
  assert.equal(disposed.length, 2)
})

test('真实模型探针拒绝未选模型且不创建 Agent', async () => {
  let created = false
  const probe = new ForwardStepProbe(storageDomain, { async create() { created = true; throw new Error('unexpected') } }, { listProviders: () => [], listModels: async () => [] })
  const result = await probe.realModelIsolation({ provider: '', model: '' }, new AbortController().signal)
  assert.equal(result.passed, false)
  assert.match(result.reason, /请选择/)
  assert.equal(created, false)
})
