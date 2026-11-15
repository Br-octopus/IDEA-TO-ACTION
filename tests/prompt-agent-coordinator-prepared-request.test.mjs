import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createPromptAgentCoordinator } = require('../dsh-plugin/forward-step-dsh/vendor/core/prompt-agent-coordinator.js')

test('coordinator preparedRequest 原样发送消息并跳过内部检索和重复拼装', async () => {
  let searches = 0
  let captured
  const coordinator = createPromptAgentCoordinator({
    requestModel: async options => { captured = options; return 'ready' },
    searchLocalSources: async () => { searches += 1; return [{ sourceId: 'internal-source', text: 'must-not-appear' }] },
  })
  const preparedRequest = { messages: [{ role: 'user', content: 'PREPARED_CONTEXT_ONLY' }], selectedSources: [{ sourceId: 'selected-1' }] }
  const result = await coordinator.runStage({ id: 'task-1', type: 'advance-idea', goal: 'legacy task must not appear', selectedSources: [] }, { stage: 'planning', runId: 'prepared-run', preparedRequest })
  assert.equal(result.draft, 'ready')
  assert.deepEqual(captured.messages, preparedRequest.messages)
  assert.equal(searches, 0)
  assert.deepEqual(result.selectedSources, preparedRequest.selectedSources)
})

test('coordinator preparedRequest 格式无效时拒绝调用模型', async () => {
  let calls = 0
  const coordinator = createPromptAgentCoordinator({ requestModel: async () => { calls += 1; return 'no' } })
  await assert.rejects(coordinator.runStage({ id: 'task-2', type: 'advance-idea', goal: 'test' }, { stage: 'planning', preparedRequest: { messages: ['invalid'] } }), { code: 'invalid_input' })
  assert.equal(calls, 0)
})

test('结果诊断入口显式规划时不覆盖成初次诊断', async () => {
  let captured
  const coordinator = createPromptAgentCoordinator({ requestModel: async options => { captured = options; return 'ok' } })
  await coordinator.runStage({ id: 'task-3', type: 'diagnose-ai-result', goal: '诊断结果' }, { stage: 'planning', runId: 'diagnose-planning' })
  assert.match(captured.messages[0].content, /路线|步骤/)
})
