import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProfile } from '../../dsh-plugin/forward-step-dsh/memory/profile.js'

const context = { projectId: 'p1', taskId: 't1', conversationId: 'c1', domain: 'writing' }

test('画像只展示有效来源支撑的适用 active 记忆，并带可回溯 ID/revision', () => {
  const state = {
    memories: [
      { memoryId: 'active', revision: 4, key: 'tone', value: '先结论', scope: 'global', status: 'active', sourceRefs: ['s1'] },
      { memoryId: 'candidate', revision: 1, key: 'style', value: '长段落', scope: 'global', status: 'candidate', sourceRefs: ['s2'] },
      { memoryId: 'disabled', revision: 2, key: 'format', value: '表格', scope: 'global', status: 'disabled', sourceRefs: ['s3'] },
    ],
    sources: [
      { sourceId: 's1', active: true, userAuthored: true },
      { sourceId: 's2', active: true, userAuthored: true },
      { sourceId: 's3', active: true, userAuthored: true },
    ],
    suppressions: [],
  }
  assert.deepEqual(buildProfile(state, context), [{ key: 'tone', value: '先结论', scope: 'global', domains: [], memories: [{ memoryId: 'active', revision: 4 }], sourceRefs: ['s1'] }])
})

test('失效来源不残留画像，领域和任务范围仍由统一策略隔离', () => {
  const state = {
    memories: [
      { memoryId: 'invalid', revision: 1, key: 'tone', value: '简洁', scope: 'global', status: 'active', sourceRefs: ['dead'] },
      { memoryId: 'other', revision: 1, key: 'tone', value: '正式', scope: 'task', taskId: 't2', projectId: 'p1', status: 'active', sourceRefs: ['live'] },
    ],
    sources: [{ sourceId: 'dead', active: false }, { sourceId: 'live', active: true, userAuthored: true }],
    suppressions: [],
  }
  assert.deepEqual(buildProfile(state, context), [])
})
