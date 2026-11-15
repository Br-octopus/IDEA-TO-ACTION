import test from 'node:test'
import assert from 'node:assert/strict'
import { currentOverridesForTask, deriveCurrentOverrides } from '../../dsh-plugin/forward-step-dsh/core/current-overrides.js'

test('明确且稳定的任务要求归一化为覆盖项并保留原文数组', () => {
  const currentRequirements = ['请保持简洁', '语气正式', '使用中文']
  const task = {
    domain: 'writing',
    currentRequirements,
    methodState: { writing: { article: { constraints: '简洁表达' } } },
  }

  assert.deepEqual(deriveCurrentOverrides(task), [
    { key: 'verbosity', value: '简洁' },
    { key: 'tone', value: '正式' },
    { key: 'language', value: '中文' },
  ])
  assert.deepEqual(currentRequirements, ['请保持简洁', '语气正式', '使用中文'])
})

test('相同键的当前要求互相冲突时不猜测该键', () => {
  assert.deepEqual(deriveCurrentOverrides({
    domain: 'writing',
    currentRequirements: ['请保持简洁', '请详细展开', '使用中文'],
  }), [{ key: 'language', value: '中文' }])
})

test('否定句、含糊表达及未支持表达不转成覆盖项', () => {
  assert.deepEqual(deriveCurrentOverrides({
    domain: 'writing',
    currentRequirements: ['不要简洁', '语气大概正式一些', '语言自然一点'],
  }), [])
})

test('PPT 每页密度只从 PPT 硬要求映射，写作领域不解释为幻灯片偏好', () => {
  const pptTask = {
    domain: 'ppt',
    currentRequirements: [],
    methodState: { ppt: { brief: { hardRequirements: ['每页少字'] } } },
  }
  const writingTask = { ...pptTask, domain: 'writing' }

  assert.deepEqual(deriveCurrentOverrides(pptTask), [{ key: 'slideDensity', value: '少字' }])
  assert.deepEqual(deriveCurrentOverrides(writingTask), [])
})

test('运行时优先读取持久化覆盖项，旧任务才从明确原文兼容导出', () => {
  const saved = [{ key: 'tone', value: '轻松口语' }]
  assert.deepEqual(currentOverridesForTask({
    domain: 'writing',
    currentRequirements: ['请保持简洁'],
    methodState: { currentOverrides: saved },
  }), saved)
  assert.deepEqual(currentOverridesForTask({ domain: 'writing', currentRequirements: ['请保持简洁'] }), [
    { key: 'verbosity', value: '简洁' },
  ])
})
