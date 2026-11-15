import test from 'node:test'
import assert from 'node:assert/strict'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'

const storageDomain = { open: async () => { throw new Error('不应访问存储域') } }

test('真实模型探针审计实际 llm/stream 消息且只返回脱敏的隔离事实', async () => {
  let probe
  const disposed = []
  const agents = {
    async create({ sessionId }) {
      const events = []
      return {
        agent: {
          session: {
            id: sessionId,
            snapshotEvents: () => events,
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
            // 宿主将 assistant 消息与 turn 结束事件标成不同 turn 时，仍从独立会话读回文本。
            events.push({ type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '收到' }] } } })
            events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
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
  assert.deepEqual(result.assistantResponses, [
    { label: 'A', textReturned: true, textCharacters: 2 },
    { label: 'B', textReturned: true, textCharacters: 2 },
  ])
  assert.equal(result.requests.length, 2)
  assert.equal(result.requests.every(request => request.messageDigest && request.messageCount === 1), true)
  assert.doesNotMatch(JSON.stringify(result), /REAL_TASK_[AB]_/)
  assert.equal(disposed.length, 2)
})

test('真实模型探针不会把 completed 但没有文本的空响应判为通过', async () => {
  let probe
  const agents = {
    async create({ sessionId }) {
      return {
        agent: {
          session: { id: sessionId, snapshotEvents: () => [{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }] },
          status: 'idle',
          followup(message) {
            probe.captureRealModelRequest({ sessionId, provider: 'p', model: 'm', messages: [{ role: 'user', content: message.content }] })
          },
          whenIdle: async () => {},
          cancel() {},
        },
        async dispose() {},
      }
    },
  }
  probe = new ForwardStepProbe(storageDomain, agents, { listProviders: () => [{ id: 'p' }], listModels: async () => [{ provider: 'p', id: 'm' }] })
  const result = await probe.realModelIsolation({ provider: 'p', model: 'm' }, new AbortController().signal)

  assert.equal(result.passed, false)
  assert.match(result.reason, /未返回文本/)
  assert.deepEqual(result.assistantResponses, [
    { label: 'A', textReturned: false, textCharacters: 0 },
    { label: 'B', textReturned: false, textCharacters: 0 },
  ])
})

test('真实模型探针拒绝未选模型且不创建 Agent', async () => {
  let created = false
  const probe = new ForwardStepProbe(storageDomain, { async create() { created = true; throw new Error('unexpected') } }, { listProviders: () => [], listModels: async () => [] })
  const result = await probe.realModelIsolation({ provider: '', model: '' }, new AbortController().signal)
  assert.equal(result.passed, false)
  assert.match(result.reason, /请选择/)
  assert.equal(created, false)
})
