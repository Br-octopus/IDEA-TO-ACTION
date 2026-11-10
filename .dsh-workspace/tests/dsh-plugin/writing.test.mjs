import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMethodPrompt, partitionWritingMaterials } from '../../dsh-plugin/forward-step-dsh/core/methods.js'

const articleTask = {
  taskId: 'article-1',
  entryType: 'diagnose-ai-result',
  domain: 'writing',
  originalInput: '把旧稿改得更清晰，保留第三段实验数字',
  currentRequirements: ['保留第三段实验数字'],
  materials: [
    { sourceId: 'style-1', purpose: 'style', excerpt: '风格哨兵：短句、克制' },
    { sourceId: 'content-1', purpose: 'content', excerpt: '事实哨兵：目前仅完成一组实验' },
  ],
  methodState: {
    writing: {
      article: { id: 'article-1', goal: '普通文章改稿', audience: '一般读者', genre: 'article' },
      round: { id: 'round-1', draft: '原稿正文哨兵', feedback: '结构松散' },
      styleProfile: null,
    },
  },
  agent: { id: 'article-1', type: 'diagnose-ai-result', goal: '普通文章改稿' },
  versions: [],
  reviews: [],
}

test('写作结果诊断入口可继续规划，并保留约束、稿件和外部执行边界', () => {
  const prompt = buildMethodPrompt(articleTask, 'planning')
  assert.match(prompt, /路线|步骤/)
  assert.match(prompt, /保留第三段实验数字/)
  assert.match(prompt, /原稿正文哨兵/)
  assert.match(prompt, /外部 AI|外部执行/)
  assert.match(prompt, /不直接.*(?:代写|成品|正文)/)
})

test('写作诊断调用现有领域规则并分开内容事实与风格材料', () => {
  const prompt = buildMethodPrompt(articleTask, 'diagnosis')
  assert.match(prompt, /事实哨兵：目前仅完成一组实验/)
  assert.match(prompt, /风格样本来源/)
  assert.doesNotMatch(prompt, /风格哨兵：短句、克制/)
  assert.match(prompt, /保留第三段实验数字/)
  assert.match(prompt, /不得.*(?:直接|自行).*(?:代写|正文|成品)/)
})

test('写作材料按 purpose 分区，both 同时作为事实材料与风格样本', () => {
  const sections = partitionWritingMaterials([
    { sourceId: 'style-1', purpose: 'style' },
    { sourceId: 'content-1', purpose: 'content' },
    { sourceId: 'both-1', purpose: 'both' },
    { sourceId: 'unknown-1', purpose: 'unknown' },
    { sourceId: 'unselected-1', purpose: 'both', selected: false },
  ])
  assert.deepEqual(sections.content.map(item => item.sourceId), ['content-1', 'both-1'])
  assert.deepEqual(sections.style.map(item => item.sourceId), ['style-1', 'both-1'])
})

test('只读取当前轮明确引用的外部结果，未选择的较新版本不覆盖旧稿', () => {
  const task = {
    ...articleTask,
    versions: [
      { versionId: 'selected-result-v1', kind: 'external-result', content: '当前选定第一稿哨兵' },
      { versionId: 'newer-result-v2', kind: 'external-result', content: '列表最新第二稿哨兵' },
    ],
  }
  const prompt = buildMethodPrompt(task, 'diagnosis')
  assert.match(prompt, /原稿正文哨兵/)
  assert.doesNotMatch(prompt, /当前选定第一稿哨兵|列表最新第二稿哨兵/)

  task.methodState = {
    ...task.methodState,
    writing: { ...task.methodState.writing, round: { ...task.methodState.writing.round, externalResultVersionId: 'selected-result-v1' } },
  }
  const selectedPrompt = buildMethodPrompt(task, 'diagnosis')
  assert.match(selectedPrompt, /当前选定第一稿哨兵/)
  assert.doesNotMatch(selectedPrompt, /列表最新第二稿哨兵/)
})

test('学术论文体裁使用学术专属诊断提示词', () => {
  const task = {
    ...articleTask,
    methodState: {
      ...articleTask.methodState,
      writing: { ...articleTask.methodState.writing, article: { ...articleTask.methodState.writing.article, genre: 'academic-paper' } },
    },
  }
  const prompt = buildMethodPrompt(task, 'diagnosis')
  assert.match(prompt, /论文诊断|目标与范围|证据与引用/u)
  assert.doesNotMatch(prompt, /仅使用通用规划\/提示词规则/)
})

test('本轮写作要求覆盖相冲突的历史偏好并保留未冲突事实', () => {
  const task = {
    ...articleTask,
    entryType: 'optimize-prompt',
    currentRequirements: ['本次必须详细展开每个论点'],
    methodState: {
      ...articleTask.methodState,
      writing: {
        ...articleTask.methodState.writing,
        article: { ...articleTask.methodState.writing.article, constraints: '历史偏好：简洁表达', preserveItems: ['第三段实验数字'] },
      },
    },
  }
  const prompt = buildMethodPrompt(task, 'step-prompt')
  assert.match(prompt, /本次必须详细展开每个论点/)
  assert.match(prompt, /本轮明确要求高于历史约束/)
  assert.match(prompt, /第三段实验数字/)
})

test('优化提示词入口在写作领域生成写作路线而非通用软件路线', () => {
  const task = { ...articleTask, entryType: 'optimize-prompt' }
  const prompt = buildMethodPrompt(task, 'planning')
  assert.match(prompt, /写作任务/)
  assert.match(prompt, /3–7 步/)
  assert.doesNotMatch(prompt, /软件开发|API 接口|代码仓库/)
})
