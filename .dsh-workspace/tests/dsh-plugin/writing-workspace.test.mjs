import test from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { appendWritingRound, compareWritingRounds, createWritingArticle, getWritingGenreStatus, saveWritingWorkspace, setWritingRoundReview } from '../../dsh-plugin/forward-step-dsh/core/writing.js'

test('所有配置文体有规则任务类型，未知文体明确拒绝', () => {
  const genres = getWritingGenreStatus()
  assert.ok(genres.length >= 19)
  const article = genres.find(item => item.genre === "article")
  assert.equal(article.status, "supported")
  assert.ok(article.reason && article.representativeTask)
  assert.ok(genres.filter(item => item.genre !== "article").every(item => item.status === "partial" && item.reason && item.representativeTask && item.taskTypes.length && Object.keys(item.domainFields).length && ['domainInputs', 'academicTarget'].includes(item.fieldStorage)))
  assert.deepEqual(article.materialPurposes, ['content', 'style', 'requirement'])
  assert.equal(genres.find(item => item.genre === 'academic-paper').fieldStorage, 'academicTarget')
  assert.ok(genres.find(item => item.genre === 'academic-paper').domainFields.discipline)
  assert.throws(() => createWritingArticle({ genre: 'unknown' }), { code: 'unsupported_genre' })
})

test('写作文章、提示词轮次、反馈和版本比较可保存与读回', async () => {
  const store = openStore(':memory:')
  try {
    let workspace = createWritingArticle({ id: 'article-1', genre: 'technical-document', goal: '文档目标', domainInputs: { productVersion: '1.0' } })
    workspace = appendWritingRound(workspace, { id: 'round-1', taskType: 'technical-procedure', prompt: '可复制提示词', draft: '外部 AI 带回初稿', feedback: '补充失败边界', materials: [{ id: 'm1', title: '选定来源', excerpt: '引用摘录', selectedForPrompt: true }] })
    workspace = appendWritingRound(workspace, { id: 'round-2', parentRoundId: 'round-1', taskType: 'technical-procedure', prompt: '修订提示词', draft: '外部 AI 修订稿', feedback: '保留已确认事实' })
    const comparison = compareWritingRounds(workspace, 'round-1', 'round-2')
    assert.equal(comparison.sameDraft, false)
    const saved = await saveWritingWorkspace(store, workspace, { expectedRevision: 0, eventId: 'writing-save' })
    assert.equal(saved.rounds.length, 2)
    assert.equal(saved.rounds[1].parentRoundId, 'round-1')
    assert.equal(saved.rounds[0].materials[0].selectedForPrompt, true)
    assert.equal(store.read().writingArticles[0].article.domainInputs.productVersion, '1.0')
  } finally { store.close() }
})

test('已保存轮次不可覆盖或删除，恢复以追加新版本实现', async () => {
  const store = openStore(':memory:')
  try {
    let workspace = createWritingArticle({ id: 'immutable-rounds', genre: 'article' })
    workspace = appendWritingRound(workspace, { id: 'round-original', prompt: '原提示词', draft: '原稿' })
    await saveWritingWorkspace(store, workspace, { expectedRevision: 0, eventId: 'save-original-round' })
    await assert.rejects(saveWritingWorkspace(store, { ...workspace, rounds: [] }, { expectedRevision: store.read().revision, eventId: 'delete-old-round' }), { code: 'invalid_input' })
    await assert.rejects(saveWritingWorkspace(store, { ...workspace, rounds: [{ ...workspace.rounds[0], draft: '被覆盖的稿件' }] }, { expectedRevision: store.read().revision, eventId: 'overwrite-old-round' }), { code: 'invalid_input' })
    const restored = appendWritingRound(workspace, { id: 'round-restored', parentRoundId: 'round-original', restoredFromRoundId: 'round-original', prompt: '原提示词', draft: '原稿' })
    const saved = await saveWritingWorkspace(store, restored, { expectedRevision: store.read().revision, eventId: 'append-restored-round' })
    assert.deepEqual(saved.rounds.map(round => round.id), ['round-original', 'round-restored'])
    assert.equal(saved.rounds[0].draft, '原稿')
  } finally { store.close() }
})


test('项目/任务关联、外部结果轮次和复盘在存储重开后保持可追溯', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = mkdtempSync(join(tmpdir(), 'dsh-writing-workspace-'))
  const path = join(directory, 'state.sqlite')
  let store = openStore(path)
  try {
    let workspace = createWritingArticle({ id: 'linked-article', genre: 'article', projectId: 'project-source', taskId: 'task-source', title: '可恢复文章', goal: '完成可追溯版本' })
    workspace = appendWritingRound(workspace, { id: 'persisted-round', taskType: 'diagnosis', prompt: '固定提示词', draft: '外部回填结果', externalResultId: 'external-result-1' })
    await saveWritingWorkspace(store, workspace, { expectedRevision: 0, eventId: 'save-linked-writing' })
    workspace = setWritingRoundReview(store.read().writingArticles[0], 'persisted-round', { status: 'confirmed', note: '人工复核' })
    await saveWritingWorkspace(store, workspace, { expectedRevision: 1, eventId: 'review-linked-writing' })
  } finally { store.close() }
  store = openStore(path)
  try {
    const restored = store.read().writingArticles.find(item => item.id === 'linked-article')
    assert.equal(restored.projectId, 'project-source')
    assert.equal(restored.taskId, 'task-source')
    assert.equal(restored.rounds[0].externalResultId, 'external-result-1')
    assert.equal(restored.rounds[0].reviewStatus, 'confirmed')
    assert.equal(restored.rounds[0].reviewNote, '人工复核')
    assert.equal(compareWritingRounds(restored, 'persisted-round', 'persisted-round').sameDraft, true)
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})

