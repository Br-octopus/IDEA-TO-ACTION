import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'

function storageDomain() {
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

test('Host 提供受控的内置方法卡目录，且工作台可查看并选用已接入领域卡', async () => {
  const storage = storageDomain()
  let host = new ForwardStepProbe(storage, { create: async () => { throw new Error('unused') } }, null)
  try {
    const { cards } = await host.listMethodCards()
    assert.ok(cards.some(card => card.id === 'method-写作' && card.stages.length > 0))
    assert.ok(cards.some(card => card.id === 'method-PPT'))
    assert.ok(cards.every(card => card.verificationStatus === 'source-reviewed'))
    const created = await host.saveMethodCard({ card: { title: '自建方法', domain: 'writing', summary: '按证据组织结构', stages: ['确认读者', '核对证据'] }, eventId: 'method-card-create' })
    assert.equal(created.card.version, 1)
    const updated = await host.saveMethodCard({ card: { id: created.card.id, title: '自建方法', domain: 'writing', summary: '按证据组织文章结构', stages: ['确认读者', '核对证据', '复核结论'] }, eventId: 'method-card-update' })
    assert.equal(updated.card.version, 2)
    assert.equal(updated.card.history[0].summary, '按证据组织结构')
    const backup = JSON.parse((await host.exportPluginBackup({ includePreferences: false, includeServiceConfig: false })).backupJson)
    const backedUpCard = backup.data.knowledgeEntries.find(card => card.id === created.card.id)
    assert.equal(backedUpCard.history[0].summary, '按证据组织结构', '插件备份包含自建方法卡版本历史')
    assert.ok((await host.listMethodCards()).cards.some(card => card.id === created.card.id && card.editable))
    await assert.rejects(host.deleteMethodCard({ cardId: 'method-写作', eventId: 'method-card-delete-builtin' }), { code: 'invalid_input' })
    await host.dispose()
    host = new ForwardStepProbe(storage, { create: async () => { throw new Error('unused') } }, null)
    const restored = (await host.listMethodCards()).cards.find(card => card.id === created.card.id)
    assert.equal(restored.history[0].summary, '按证据组织结构', 'Host 重启后保留版本快照')
    await host.deleteMethodCard({ cardId: created.card.id, eventId: 'method-card-delete' })
    assert.equal((await host.listMethodCards()).cards.some(card => card.id === created.card.id), false)
  } finally { await host.dispose() }
  const panel = await readFile(new URL('../../dsh-plugin/forward-step-dsh/src/client/assets-panel.ts', import.meta.url), 'utf8')
  assert.match(panel, /方法卡库/u)
  assert.match(panel, /用于新任务领域/u)
  assert.match(panel, /自建方法卡编辑器/u)
  assert.match(panel, /资料库显式选择并预览/u)
  assert.match(panel, /保存方法卡版本/u)
  assert.match(panel, /历史版本/u)
  assert.match(panel, /method-写作': 'writing'/u)
  assert.match(panel, /onSelectDomain\(domain/u)
  assert.match(panel, /内置卡为只读/u)
})

