import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { buildSelectedKnowledgeContext, saveKnowledgeEntry, searchKnowledgeEntries, setKnowledgeSelection } from '../../dsh-plugin/forward-step-dsh/core/knowledge.js'

const require = createRequire(import.meta.url)
const index = require('../../dsh-plugin/forward-step-dsh/vendor/core/knowledge-search.js')

test('本地资料索引由插件状态重建并保留来源信息', async () => {
  const store = openStore(':memory:')
  try {
    let state = store.read()
    await saveKnowledgeEntry(store, { id: 'source-one', title: '检索测试资料', summary: '用于验证来源追溯的合成摘要', sourceUrl: 'https://example.test/source-one' }, { expectedRevision: state.revision, eventId: 'retrieval-add-one' })
    state = store.read()
    await saveKnowledgeEntry(store, { id: 'source-two', title: '其他资料', summary: '不得隐式进入模型上下文' }, { expectedRevision: state.revision, eventId: 'retrieval-add-two' })

    const firstIndex = index.collectKnowledgeEntries(store.read())
    const rebuiltIndex = index.collectKnowledgeEntries(store.read())
    assert.deepEqual(rebuiltIndex, firstIndex)
    const matches = searchKnowledgeEntries(state, '来源追溯')
    assert.equal(matches[0].id, 'source-one')
    assert.equal(matches[0].sourceUrl, 'https://example.test/source-one')

    state = store.read()
    await setKnowledgeSelection(store, ['source-one'], { expectedRevision: state.revision, eventId: 'retrieval-select-one' })
    const context = buildSelectedKnowledgeContext(store.read())
    assert.deepEqual(context.sourceIds, ['source-one'])
    assert.ok(JSON.stringify(context.sources).includes('https://example.test/source-one'))
    assert.doesNotMatch(context.text, /不得隐式进入模型上下文/)
  } finally { store.close() }
})
