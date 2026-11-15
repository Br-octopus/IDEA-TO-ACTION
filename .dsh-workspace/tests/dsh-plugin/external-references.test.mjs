import test from 'node:test'
import assert from 'node:assert/strict'
import { buildManualSearchUrl, listExternalReferences, listResearchSamples } from '../../dsh-plugin/forward-step-dsh/core/external-references.js'
import { buildContext } from '../../dsh-plugin/forward-step-dsh/core/context.js'

test('外部参考入口带用途和许可提示，检索跳转明确使用用户输入', () => {
  const references = listExternalReferences()
  assert.ok(references.length >= 3)
  assert.ok(references.every(item => item.url.startsWith('https://') && item.purpose && item.license))
  const url = new URL(buildManualSearchUrl('github-prompts', '写作 Agent'))
  assert.equal(url.hostname, 'github.com')
  assert.equal(url.searchParams.get('q'), '写作 Agent')
  assert.throws(() => buildManualSearchUrl('unknown'), { code: 'not_found' })
})

test('研究样本是只读合成内容，未显式加入来源时不进入任务上下文', () => {
  const samples = listResearchSamples()
  assert.deepEqual(samples.map(sample => sample.id), ['agent', 'writing', 'research'])
  const sampleText = samples.map(sample => sample.text).join('\n')
  const context = buildContext({ task: { taskId: 't1', originalInput: '推进一个任务' }, stage: 'planning', methodPrompt: '先列计划' })
  assert.doesNotMatch(JSON.stringify(context.messages), /合成研究问题|合成稿件反馈|合成的图书馆活动/)
  assert.match(sampleText, /合成/)
})
