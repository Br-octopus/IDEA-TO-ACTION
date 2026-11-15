import test from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { deleteCaseAsset, deletePromptAsset, listCaseAssets, listPromptAssets, saveCaseAsset, savePromptAsset, setPromptArchived, setPromptVerification } from '../../dsh-plugin/forward-step-dsh/core/assets.js'
import { comparePromptVersions } from '../../dsh-plugin/forward-step-dsh/client/prompt-diff.js'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'

function promptInput(patch = {}) { return { title: 'Prompt alpha', text: 'Use only verified facts.', tags: ['writing'], sourceUrl: 'https://example.test/prompt', sourceLicense: 'CC-BY', ...patch } }
function caseInput(patch = {}) { return { title: 'Case alpha', domain: 'writing', promptText: 'Draft from the facts.', resultSummary: 'A synthetic result.', feedback: '', sourceUrl: 'https://example.test/case', sourceLicense: 'User supplied', verificationStatus: 'unverified', ...patch } }

test('提示词新增和编辑通过追加版本保留旧正文，测试记录必须显式确认', async () => {
  const store = openStore(':memory:')
  try {
    const first = await savePromptAsset(store, promptInput(), { expectedRevision: 0, eventId: 'asset-prompt-1' })
    const second = await savePromptAsset(store, { ...promptInput({ text: 'Use cited facts.' }), promptId: first.prompt.id }, { expectedRevision: 1, eventId: 'asset-prompt-2' })
    assert.equal(first.prompt.version, 1)
    assert.equal(second.prompt.version, 2)
    assert.equal(second.prompt.groupId, first.prompt.groupId)
    assert.equal(second.prompt.parentId, first.prompt.id)
    assert.equal(store.read().prompts.find(item => item.id === first.prompt.id).text, 'Use only verified facts.')
    await assert.rejects(setPromptVerification(store, { promptId: second.prompt.id, note: '' }, { expectedRevision: 2, eventId: 'asset-empty-test' }), { code: 'invalid_input' })
    const verified = await setPromptVerification(store, { promptId: second.prompt.id, note: 'Fixture input; expected fact-only output; observed pass.' }, { expectedRevision: 2, eventId: 'asset-verify' })
    assert.equal(verified.prompt.verificationStatus, 'tested')
    assert.equal(verified.prompt.verified, true)
    await setPromptArchived(store, first.prompt.id, true, { expectedRevision: 3, eventId: 'asset-archive' })
    assert.deepEqual(listPromptAssets(store.read()).map(item => item.id), [second.prompt.id])
    await deletePromptAsset(store, first.prompt.id, { expectedRevision: 4, eventId: 'asset-delete-prompt' })
    assert.equal(store.read().prompts.length, 1)
  } finally { store.close() }
})

test('同组提示词版本比较返回未变行、删除行和新增行', async () => {
  const store = openStore(':memory:')
  try {
    const first = await savePromptAsset(store, promptInput({ text: ['Keep this.', 'Remove this.', 'Keep the end.'].join(String.fromCharCode(10)) }), { expectedRevision: 0, eventId: 'compare-first' })
    const second = await savePromptAsset(store, { ...promptInput({ text: ['Keep this.', 'Add this.', 'Keep the end.'].join(String.fromCharCode(10)) }), promptId: first.prompt.id }, { expectedRevision: 1, eventId: 'compare-second' })
    assert.deepEqual(comparePromptVersions(store.read().prompts, first.prompt.id, second.prompt.id), {
      left: { id: first.prompt.id, version: 1, title: 'Prompt alpha' },
      right: { id: second.prompt.id, version: 2, title: 'Prompt alpha' },
      unchangedPrefix: ['Keep this.'],
      removed: ['Remove this.'],
      added: ['Add this.'],
      unchangedSuffix: ['Keep the end.'],
    })
    const other = await savePromptAsset(store, promptInput({ title: 'Other prompt' }), { expectedRevision: 2, eventId: 'compare-other' })
    assert.throws(() => comparePromptVersions(store.read().prompts, first.prompt.id, other.prompt.id), { code: 'invalid_input' })
    assert.throws(() => comparePromptVersions(store.read().prompts, first.prompt.id, 'missing'), { code: 'not_found' })
  } finally { store.close() }
})

test('案例来源、许可与测试状态可维护，编辑保留快照，删除不影响提示词', async () => {
  const store = openStore(':memory:')
  try {
    const prompt = await savePromptAsset(store, promptInput(), { expectedRevision: 0, eventId: 'case-prompt' })
    const created = await saveCaseAsset(store, caseInput(), { expectedRevision: 1, eventId: 'case-create' })
    assert.equal(created.caseItem.sourceLicense, 'User supplied')
    assert.equal(created.caseItem.verificationStatus, 'unverified')
    const edited = await saveCaseAsset(store, { ...caseInput({ caseId: created.caseItem.id, title: 'Case beta', feedback: 'Passed on fixture.' , verificationStatus: 'tested' }) }, { expectedRevision: 2, eventId: 'case-edit' })
    assert.equal(edited.caseItem.version, 2)
    assert.equal(edited.caseItem.history[0].title, 'Case alpha')
    assert.equal(edited.caseItem.verificationStatus, 'tested')
    assert.equal(listCaseAssets(store.read(), 'beta').length, 1)
    await assert.rejects(saveCaseAsset(store, caseInput({ verificationStatus: 'tested' }), { expectedRevision: 3, eventId: 'case-invalid-test' }), { code: 'invalid_input' })
    await deleteCaseAsset(store, edited.caseItem.id, { expectedRevision: 3, eventId: 'case-delete' })
    assert.equal(store.read().cases.length, 0)
    assert.equal(store.read().prompts[0].id, prompt.prompt.id)
  } finally { store.close() }
})

function createStorageDomain() {
  const tables = new Map()
  return {
    async open() {
      return {
        table(name) {
          if (!tables.has(name)) tables.set(name, new Map())
          const rows = tables.get(name)
          return {
            get: key => rows.get(key),
            put: async (key, value) => rows.set(key, structuredClone(value)),
            update: async (key, mutate) => {
              const value = mutate(rows.get(key))
              rows.set(key, structuredClone(value))
              return value
            },
          }
        },
        async close() {},
      }
    },
  }
}

test('Host RPC 将提示词和案例资产写入插件独立存储并可读回', async () => {
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null)
  try {
    const prompt = await host.savePromptAsset({ prompt: promptInput() })
    const edited = await host.savePromptAsset({ prompt: { ...promptInput({ text: 'New prompt revision.' }), promptId: prompt.prompt.id } })
    assert.equal(edited.prompt.version, 2)
    assert.equal((await host.listPromptAssets({})).prompts.length, 2)
    await host.setPromptVerification({ promptId: edited.prompt.id, note: 'Synthetic input; expected result; observed pass.' })
    assert.equal((await host.listPromptAssets({})).prompts[0].verificationStatus, 'tested')

    const createdCase = await host.saveCaseAsset({ caseItem: caseInput() })
    assert.equal((await host.listCaseAssets({})).cases[0].id, createdCase.caseItem.id)
    await host.deleteCaseAsset({ caseId: createdCase.caseItem.id })
    assert.equal((await host.listCaseAssets({})).cases.length, 0)
    await host.setPromptArchived({ promptId: prompt.prompt.id, archived: true })
    assert.equal((await host.listPromptAssets({})).prompts.length, 1)
  } finally { await host.dispose() }
})
