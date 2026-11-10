import test from 'node:test'
import assert from 'node:assert/strict'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'

function createStorageDomain() {
  const tables = new Map()
  return {
    async open() {
      return {
        table(name) {
          if (!tables.has(name)) tables.set(name, new Map())
          const values = tables.get(name)
          return {
            get: key => values.get(key),
            put: async (key, value) => values.set(key, structuredClone(value)),
            update: async (key, mutate) => {
              const next = mutate(values.get(key))
              values.set(key, structuredClone(next))
              return next
            },
          }
        },
        async close() {},
      }
    },
  }
}

test('Host exposes professional-pack history comparison', async () => {
  const host = new ForwardStepProbe(createStorageDomain())
  try {
    const first = await host.saveWritingPack({ pack: { name: 'Host V1', layer: 'task', genre: 'article', version: 1, requirements: [{ id: 'rule', statement: 'Old rule' }] } })
    await host.saveWritingPack({ packId: first.pack.id, pack: { ...first.pack, name: 'Host V2', requirements: [{ id: 'rule', statement: 'New rule' }] } })
    const result = await host.compareWritingPackVersions({ packId: first.pack.id, leftVersion: 1, rightVersion: 2 })
    assert.equal(result.changes.find(item => item.path === 'name').before, 'Host V1')
    assert.equal(result.changes.find(item => item.path === 'name').after, 'Host V2')
    assert.equal(result.changes.some(item => item.path === 'version' || item.path === 'updatedAt'), false)
  } finally { await host.dispose() }
})

test('Host awaits professional-pack enable, import, delete, and builtin restore writes', async () => {
  const host = new ForwardStepProbe(createStorageDomain())
  try {
    const created = await host.saveWritingPack({ pack: { name: 'Host managed pack', layer: 'task', genre: 'article', version: 1, requirements: [] } })
    assert.equal(created.pack.version, 1)
    const disabled = await host.setWritingPackEnabled({ packId: created.pack.id, enabled: false })
    assert.equal(disabled.pack.enabled, false)
    assert.ok(Number.isInteger(disabled.revision))

    const preview = await host.previewImportWritingPacks({ packs: [{ id: 'host-import-pack', name: 'Imported host pack', layer: 'task', genre: 'article', version: 1, requirements: [] }] })
    const imported = await host.confirmImportWritingPacks({ preview: preview.preview })
    assert.equal(imported.packs[0].id, 'host-import-pack')
    assert.ok(Number.isInteger(imported.revision))

    const builtin = (await host.listWritingPacks()).packs.find(item => item.id === 'builtin-article')
    const customized = await host.saveWritingPack({ packId: builtin.id, pack: { ...builtin, name: 'Customized builtin' } })
    assert.equal(customized.pack.name, 'Customized builtin')
    const restored = await host.restoreBuiltinWritingPack({ packId: builtin.id })
    assert.equal(restored.pack.name, builtin.name)
    assert.ok(Number.isInteger(restored.revision))

    const deleted = await host.deleteWritingPack({ packId: created.pack.id })
    assert.equal(deleted.deleted, true)
    assert.ok(Number.isInteger(deleted.revision))
    assert.equal((await host.listWritingPacks()).packs.some(item => item.id === created.pack.id), false)
  } finally { await host.dispose() }
})

test('写作工作区通过 Host 与项目/任务关联，轮次和复盘可续接', async () => {
  const host = new ForwardStepProbe(createStorageDomain())
  try {
    const task = await host.createTask({
      cwd: process.cwd(), entryType: 'advance-idea', domain: 'writing',
      originalInput: '创建关联写作项目', conversationId: 'writing-workspace-host', eventId: 'writing-task-create',
    })
    const created = await host.createWritingWorkspace({
      genre: 'technical-document', title: '关联技术文档', goal: '完成可追溯写作', projectId: task.task.projectId, taskId: task.task.taskId,
      domainInputs: { productVersion: '2.4', environment: 'forward-step-test' },
    })
    assert.equal(created.workspace.projectId, task.task.projectId)
    assert.equal(created.workspace.taskId, task.task.taskId)
    assert.equal(created.workspace.article.domainInputs.productVersion, '2.4')
    assert.equal(created.workspace.article.domainInputs.environment, 'forward-step-test')

    const academic = await host.createWritingWorkspace({
      genre: 'academic-paper', title: '学术稿', goal: '明确研究问题',
      domainInputs: { discipline: '计算机科学', degreeLevel: '硕士' },
    })
    assert.equal(academic.workspace.article.academicTarget.discipline, '计算机科学')
    assert.equal(academic.workspace.article.academicTarget.degreeLevel, '硕士')
    const academicReadback = await host.listWritingWorkspaces({})
    assert.equal(academicReadback.workspaces.find(item => item.id === academic.workspace.id).article.academicTarget.discipline, '计算机科学')

    const first = await host.appendWritingRound({ articleId: created.workspace.id, round: {
      id: 'round-host-1', taskType: 'diagnosis', prompt: '首轮提示词', draft: '初稿', externalResultId: 'result-host-1',
    } })
    const reviewed = await host.setWritingRoundReview({
      articleId: created.workspace.id, roundId: 'round-host-1', status: 'confirmed', note: '已核对关键要求',
    })
    assert.equal(reviewed.workspace.rounds[0].reviewStatus, 'confirmed')
    const second = await host.appendWritingRound({ articleId: created.workspace.id, round: {
      id: 'round-host-2', parentRoundId: 'round-host-1', restoredFromRoundId: 'round-host-1',
      taskType: 'revision', prompt: '修订提示词', draft: '修订稿', externalResultId: 'result-host-2',
    } })
    const comparison = await host.compareWritingRounds({ articleId: created.workspace.id, leftRoundId: 'round-host-1', rightRoundId: 'round-host-2' })
    assert.equal(comparison.comparison.sameDraft, false)
    assert.equal(comparison.workspace.rounds[1].restoredFromRoundId, 'round-host-1')
    const skipped = await host.setWritingRoundReview({ articleId: created.workspace.id, roundId: 'round-host-2', status: 'skipped', note: '稍后再复盘' })
    assert.equal(skipped.workspace.rounds[1].reviewStatus, 'skipped')
    const listed = await host.listWritingWorkspaces({ projectId: task.task.projectId, taskId: task.task.taskId })
    assert.deepEqual(listed.workspaces.map(item => item.id), [created.workspace.id])
    assert.equal(listed.workspaces[0].rounds.length, 2)
    assert.ok(second.revision > first.revision)
    const restored = await host.restoreWritingRound({ articleId: created.workspace.id, roundId: 'round-host-1' })
    assert.equal(restored.workspace.rounds.length, 3)
    assert.equal(restored.workspace.rounds[0].draft, '初稿', '恢复不能覆盖原轮次')
    assert.equal(restored.workspace.rounds[2].restoredFromRoundId, 'round-host-1')
    assert.equal((await host.getWritingMaterialCoverage({ articleId: created.workspace.id })).workspace.id, created.workspace.id)
  } finally { await host.dispose() }
})

test('写作工作区拒绝无效关联、重复轮次和未完成复盘状态', async () => {
  const host = new ForwardStepProbe(createStorageDomain())
  try {
    await assert.rejects(host.createWritingWorkspace({ genre: 'unknown', title: '无效文体', goal: 'x' }), { code: 'unsupported_genre' })
    await assert.rejects(host.createWritingWorkspace({ genre: 'article', title: '悬空任务', goal: 'x', taskId: 'missing' }), { code: 'not_found' })
    await assert.rejects(host.createWritingWorkspace({ genre: 'article', title: '悬空项目', goal: 'x', projectId: 'missing' }), { code: 'not_found' })
    const created = await host.createWritingWorkspace({ genre: 'article', title: '无关联文章', goal: 'x' })
    await host.appendWritingRound({ articleId: created.workspace.id, round: { id: 'only-round', draft: '版本' } })
    await assert.rejects(host.appendWritingRound({ articleId: created.workspace.id, round: { id: 'only-round', draft: '重复' } }), { code: 'conflict' })
    await assert.rejects(host.setWritingRoundReview({ articleId: created.workspace.id, roundId: 'only-round', status: 'unknown', note: '' }), { code: 'invalid_input' })
    await assert.rejects(host.setWritingRoundReview({ articleId: created.workspace.id, roundId: 'missing-round', status: 'skipped', note: '' }), { code: 'not_found' })
  } finally { await host.dispose() }
})

