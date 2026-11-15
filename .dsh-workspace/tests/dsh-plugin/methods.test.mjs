import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMethodPrompt } from '../../dsh-plugin/forward-step-dsh/core/methods.js'

test('入口为结果诊断时仍可明确进入规划和复盘阶段', () => {
  const task = { taskId: 't1', entryType: 'diagnose-ai-result', domain: 'general', originalInput: '分析这份结果并规划下一步', agent: { id: 't1', type: 'diagnose-ai-result', goal: '分析这份结果' }, currentRequirements: ['不得改写原文'], steps: [{ id: 's1', title: '验证' }], currentStepId: 's1', versions: [], reviews: [] }
  assert.match(buildMethodPrompt(task, 'planning'), /路线|步骤/)
  assert.match(buildMethodPrompt(task, 'review'), /复盘|成功|失败|待验证/)
})

test('五个通用阶段均生成方法提示并保留外部执行边界', () => {
  const task = { taskId: 't2', entryType: 'advance-idea', domain: 'general', originalInput: '做一个小工具', agent: { id: 't2', type: 'advance-idea', goal: '做一个小工具' }, currentRequirements: [], steps: [{ id: 's1', title: '实现' }], currentStepId: 's1', review: { excerpt: '结果摘要' } }
  for (const stage of ['clarification', 'diagnosis', 'planning', 'step-prompt', 'review']) {
    const prompt = buildMethodPrompt(task, stage)
    assert.equal(typeof prompt, 'string')
    assert.ok(prompt.length > 20, stage)
    assert.match(prompt, /外部 AI|外部执行|不.*(?:直接|自行).*(?:成果|完成|生成)/, stage)
  }
})

test('未知阶段与未知任务入口明确拒绝', () => {
  assert.throws(() => buildMethodPrompt({ originalInput: 'x', entryType: 'unknown' }, 'planning'), { code: 'invalid_input' })
  assert.throws(() => buildMethodPrompt({ originalInput: 'x', entryType: 'advance-idea' }, 'unknown'), { code: 'invalid_input' })
})

test('三个入口与三个领域的九种组合均命中当前任务路由', () => {
  const entries = ['advance-idea', 'optimize-prompt', 'diagnose-ai-result']
  const domains = ['general', 'writing', 'ppt']
  for (const entryType of entries) {
    for (const domain of domains) {
      const task = {
        taskId: `${entryType}-${domain}`,
        entryType,
        domain,
        originalInput: `九路由目标-${entryType}-${domain}`,
        currentRequirements: ['路由保留项-DO-NOT-DROP'],
        materials: [],
        methodState: {},
        agent: { id: `${entryType}-${domain}`, type: entryType, goal: '九路由目标' },
        steps: [{ id: 'step-current', title: '当前步骤' }],
        currentStepId: 'step-current',
        versions: [],
        reviews: [],
      }
      const prompt = buildMethodPrompt(task, 'planning')
      assert.match(prompt, new RegExp(`九路由目标-${entryType}-${domain}`), `${entryType}/${domain}`)
      assert.match(prompt, /路由保留项-DO-NOT-DROP/, `${entryType}/${domain}`)
      assert.match(prompt, /外部 AI|外部执行/, `${entryType}/${domain}`)
    }
  }
})
