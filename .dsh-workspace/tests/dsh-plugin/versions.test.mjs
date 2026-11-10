import test from 'node:test'
import assert from 'node:assert/strict'
import { appendReview, appendVersion, markStale } from '../../dsh-plugin/forward-step-dsh/core/versions.js'

function task() {
  return { taskId: 'task-a', currentRequirements: ['保留数字 12'], versions: [], reviews: [] }
}

test('版本追加保持旧正文不变，陈旧标记不修改外部结果正文', () => {
  const originalTask = task()
  const first = appendVersion(originalTask, { kind: 'prompt', stage: 'step-prompt', stepId: 'step-a', content: '保留数字 12' })
  const originalPrompt = first.versions[0]
  const second = appendVersion(first, { kind: 'prompt', stage: 'step-prompt', stepId: 'step-a', parentVersionId: originalPrompt.versionId, content: '保留数字 12 并精简' })
  const result = appendVersion(second, { kind: 'external-result', stage: 'external-result', stepId: 'step-a', promptVersionId: originalPrompt.versionId, source: 'user-pasted', content: '外部结果 12' })
  const stale = markStale(result, '目标已调整')

  assert.equal(originalTask.versions.length, 0)
  assert.equal(second.versions[0].content, '保留数字 12')
  assert.equal(stale.versions[0].stale, true)
  assert.equal(stale.versions[1].stale, true)
  assert.equal(stale.versions[2].stale, false)
  assert.equal(stale.versions[2].content, '外部结果 12')
})

test('复盘必须关联同一任务、同一步骤且被结果引用的提示词版本', () => {
  const prompt = { versionId: 'prompt-v1', taskId: 'task-a', kind: 'prompt', stepId: 'step-a', stage: 'step-prompt', content: '任务提示', usedMemories: [], usedSources: [], omissions: [] }
  const result = { versionId: 'result-v1', taskId: 'task-a', kind: 'external-result', stepId: 'step-a', promptVersionId: 'prompt-v1', source: 'user-pasted', stage: 'external-result', content: '用户带回的结果', usedMemories: [], usedSources: [], omissions: [] }
  const value = { ...task(), versions: [prompt, result] }
  const reviewed = appendReview(value, {
    resultVersionId: result.versionId,
    promptVersionId: prompt.versionId,
    verdict: 'success',
    checks: [{ requirement: '保留数字 12', result: 'pass' }],
    feedback: '确认本轮结果',
    confirmed: true,
  })
  assert.equal(value.reviews.length, 0)
  assert.equal(reviewed.reviews.length, 1)
  assert.equal(reviewed.reviews[0].confirmed, true)
  assert.deepEqual(reviewed.reviews[0].requirementsSnapshot, ['保留数字 12'])
  assert.equal(reviewed.versions.find(version => version.versionId === result.versionId).content, '用户带回的结果')
  assert.throws(() => appendReview(value, { resultVersionId: result.versionId, promptVersionId: 'another-prompt', verdict: 'success' }), { code: 'invalid_input' })
  assert.throws(() => appendReview(value, { resultVersionId: 'foreign-task-result', promptVersionId: prompt.versionId, verdict: 'success', checks: [{ requirement: '保留数字 12', result: 'pass' }], confirmed: true }), { code: 'invalid_input' })
  assert.throws(() => appendReview({ ...value, versions: [prompt, { ...result, stepId: 'step-b' }] }, { resultVersionId: result.versionId, promptVersionId: prompt.versionId, verdict: 'success' }), { code: 'invalid_input' })
})

test('未验证 verdict 不得变成用户确认的成功标签', () => {
  const prompt = { versionId: 'prompt-v1', kind: 'agent-output', stepId: 'task', stage: 'planning', content: '提示', usedMemories: [], usedSources: [], omissions: [] }
  const result = { versionId: 'result-v1', kind: 'external-result', stepId: 'task', promptVersionId: prompt.versionId, stage: 'external-result', content: '结果', source: 'user-pasted', usedMemories: [], usedSources: [], omissions: [] }
  const reviewed = appendReview({ ...task(), versions: [prompt, result] }, { resultVersionId: result.versionId, promptVersionId: prompt.versionId, verdict: 'unverified', checks: [{ requirement: '保留数字 12', result: 'not-checked' }], confirmed: true })
  assert.equal(reviewed.reviews[0].confirmed, false)
})

test('确认成功必须将所有适用要求标记为通过', () => {
  const prompt = { versionId: 'prompt-v1', kind: 'prompt', stepId: 'task', stage: 'step-prompt', content: '提示' }
  const result = { versionId: 'result-v1', kind: 'external-result', stepId: 'task', promptVersionId: prompt.versionId, stage: 'external-result', content: '结果' }
  const value = { ...task(), currentRequirements: ['要求一', '要求二'], versions: [prompt, result] }
  assert.throws(() => appendReview(value, {
    resultVersionId: result.versionId,
    promptVersionId: prompt.versionId,
    verdict: 'success',
    checks: [{ requirement: '要求一', result: 'pass' }, { requirement: '要求二', result: 'not-checked' }],
    confirmed: true,
  }), { code: 'invalid_input' })
})

test('确认失败至少要有一条适用要求未通过', () => {
  const prompt = { versionId: 'prompt-v1', kind: 'prompt', stepId: 'task', stage: 'step-prompt', content: '提示' }
  const result = { versionId: 'result-v1', kind: 'external-result', stepId: 'task', promptVersionId: prompt.versionId, stage: 'external-result', content: '结果' }
  const value = { ...task(), currentRequirements: ['要求一'], versions: [prompt, result] }
  assert.throws(() => appendReview(value, {
    resultVersionId: result.versionId,
    promptVersionId: prompt.versionId,
    verdict: 'failure',
    checks: [{ requirement: '要求一', result: 'pass' }],
    confirmed: true,
  }), { code: 'invalid_input' })
})

test('复盘检查项不能遗漏、重复或添加到当前要求之外', () => {
  const prompt = { versionId: 'prompt-v1', kind: 'prompt', stepId: 'task', stage: 'step-prompt', content: '提示' }
  const result = { versionId: 'result-v1', kind: 'external-result', stepId: 'task', promptVersionId: prompt.versionId, stage: 'external-result', content: '结果' }
  const value = { ...task(), currentRequirements: ['要求一', '要求二'], versions: [prompt, result] }
  const review = { resultVersionId: result.versionId, promptVersionId: prompt.versionId, verdict: 'unverified', confirmed: false }
  assert.throws(() => appendReview(value, { ...review, checks: [{ requirement: '要求一', result: 'not-checked' }] }), { code: 'invalid_input' })
  assert.throws(() => appendReview(value, { ...review, checks: [{ requirement: '要求一', result: 'not-checked' }, { requirement: '要求一', result: 'not-checked' }] }), { code: 'invalid_input' })
  assert.throws(() => appendReview(value, { ...review, checks: [{ requirement: '要求一', result: 'not-checked' }, { requirement: '伪造要求', result: 'not-checked' }] }), { code: 'invalid_input' })
})
