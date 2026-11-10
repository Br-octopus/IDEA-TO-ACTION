import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'

const require = createRequire(import.meta.url)
const schema = require('../vendor/core/writing-workbench-schema.js')

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

export function createWritingArticle(input = {}) {
  const genre = input.genre ?? 'article'
  if (!schema.getWritingGenreConfig(genre)) fail('unsupported_genre', '当前写作文体未配置专属规则')
  if (input.projectId !== undefined && typeof input.projectId !== 'string') fail('invalid_input', '写作项目关联无效')
  if (input.taskId !== undefined && typeof input.taskId !== 'string') fail('invalid_input', '写作任务关联无效')
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : randomUUID()
  const goal = typeof input.goal === 'string' ? input.goal.trim() : ''
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : goal.slice(0, 80)
  const article = { ...input, id, title, genre }
  if (genre === 'academic-paper' && input.domainInputs && typeof input.domainInputs === 'object' && !Array.isArray(input.domainInputs)) {
    article.academicTarget = { ...(input.academicTarget ?? {}), ...input.domainInputs }
    delete article.domainInputs
  }
  return schema.normalizeWritingWorkspace({
    id,
    genre,
    projectId: typeof input.projectId === 'string' ? input.projectId : '',
    taskId: typeof input.taskId === 'string' ? input.taskId : '',
    article,
    rounds: [],
    styleProfile: { scope: 'article', genre, traits: [], samples: [] },
    memories: [],
  })
}

export function appendWritingRound(workspace, input = {}) {
  if (!workspace?.article?.id || !Array.isArray(workspace.rounds)) fail('invalid_input', '写作工作区无效')
  const roundId = input.id || randomUUID()
  if (workspace.rounds.some(round => round.id === roundId)) fail('conflict', '写作轮次标识已存在')
  if (input.articleId && input.articleId !== workspace.article.id) fail('invalid_input', '写作轮次必须关联当前文章')
  if (input.prompt !== undefined && typeof input.prompt !== 'string') fail('invalid_input', '提示词必须是文本')
  for (const field of ['parentRoundId', 'restoredFromRoundId']) {
    if (input[field] && !workspace.rounds.some(round => round.id === input[field])) fail('invalid_input', '写作轮次引用的历史版本不存在')
  }
  if (input.externalResultId !== undefined && (typeof input.externalResultId !== 'string' || input.externalResultId.length > 100)) fail('invalid_input', '外部结果引用无效')
  const normalized = schema.normalizeWritingWorkspace({
    ...workspace,
    rounds: [...workspace.rounds, { ...input, id: roundId, articleId: workspace.article.id }],
  })
  return normalized
}

export async function saveWritingWorkspace(store, workspace, { expectedRevision, eventId } = {}) {
  if (!Number.isInteger(expectedRevision) || typeof eventId !== 'string' || !eventId.trim()) fail('invalid_input', '写作保存事务参数无效')
  const normalized = schema.normalizeWritingWorkspace(workspace)
  if (!normalized.id || !normalized.article.id || normalized.id !== normalized.article.id) fail('invalid_input', '文章和工作区标识必须一致')
  const committed = await store.transact(expectedRevision, eventId, state => {
    const index = state.writingArticles.findIndex(item => item.id === normalized.id)
    if (index < 0) state.writingArticles.push(normalized)
    else {
      const previous = state.writingArticles[index]
      if (previous.projectId !== normalized.projectId || previous.taskId !== normalized.taskId) fail('invalid_input', '写作工作区关联不可修改')
      if (normalized.rounds.length < previous.rounds.length) fail('invalid_input', '历史写作轮次不可删除')
      for (let roundIndex = 0; roundIndex < previous.rounds.length; roundIndex += 1) {
        const before = previous.rounds[roundIndex]
        const after = normalized.rounds[roundIndex]
        if (!after || before.id !== after.id) fail('invalid_input', '历史写作轮次不可重排或替换')
        const beforeContent = { ...before }; const afterContent = { ...after }
        for (const key of ['reviewStatus', 'reviewNote', 'reviewedAt']) { delete beforeContent[key]; delete afterContent[key] }
        if (!isDeepStrictEqual(beforeContent, afterContent)) fail('invalid_input', '历史提示词与稿件不可覆盖，请追加新轮次')
        const beforeStatus = before.reviewStatus ?? 'pending'; const afterStatus = after.reviewStatus ?? 'pending'
        if (beforeStatus !== afterStatus && (beforeStatus !== 'pending' || !['confirmed', 'skipped'].includes(afterStatus))) fail('invalid_input', '复盘状态只能从待处理变为确认或跳过')
      }
      state.writingArticles[index] = normalized
    }
    state.changes.push({ eventId, reason: '保存写作工作区', sourceId: normalized.id, createdAt: new Date().toISOString() })
  })
  return structuredClone(committed.writingArticles.find(item => item.id === normalized.id))
}

export function listWritingWorkspaces(state, { projectId, taskId } = {}) {
  let workspaces = Array.isArray(state?.writingArticles) ? state.writingArticles : []
  if (projectId) workspaces = workspaces.filter(item => item.projectId === projectId)
  if (taskId) workspaces = workspaces.filter(item => item.taskId === taskId)
  return structuredClone(workspaces)
}

export function setWritingRoundReview(workspace, roundId, { status, note = '' } = {}) {
  if (!workspace?.article?.id || !Array.isArray(workspace.rounds) || !['confirmed', 'skipped'].includes(status)
    || typeof note !== 'string' || note.length > 2000) fail('invalid_input', '写作复盘状态无效')
  const index = workspace.rounds.findIndex(round => round.id === roundId)
  if (index < 0) fail('not_found', '待复盘的写作轮次不存在')
  const rounds = workspace.rounds.map((round, roundIndex) => roundIndex === index
    ? { ...round, reviewStatus: status, reviewNote: note.trim(), reviewedAt: new Date().toISOString() }
    : round)
  return schema.normalizeWritingWorkspace({ ...workspace, rounds, updatedAt: new Date().toISOString() })
}

// 回退通过新增一轮实现，历史正文和提示词保持不可变。
export function restoreWritingRound(workspace, roundId) {
  const source = workspace?.rounds?.find(round => round.id === roundId)
  if (!source) fail('not_found', '待恢复的写作轮次不存在')
  const latest = workspace.rounds.at(-1)
  return appendWritingRound(workspace, {
    taskType: source.taskType, prompt: source.prompt, draft: source.draft, diagnosis: source.diagnosis,
    feedback: source.feedback, userFeedback: source.userFeedback, revisionNote: `从轮次 ${roundId} 恢复`,
    materials: source.materials, sources: source.sources, preferences: source.preferences,
    packSelections: source.packSelections, packSnapshot: source.packSnapshot,
    externalResultId: source.externalResultId, parentRoundId: latest?.id, restoredFromRoundId: roundId,
  })
}

export function compareWritingRounds(workspace, leftRoundId, rightRoundId) {
  const left = workspace?.rounds?.find(item => item.id === leftRoundId)
  const right = workspace?.rounds?.find(item => item.id === rightRoundId)
  if (!left || !right) fail('not_found', '比较轮次不存在')
  return {
    articleId: workspace.article.id,
    left: { id: left.id, draft: left.draft, prompt: left.prompt, feedback: left.feedback },
    right: { id: right.id, draft: right.draft, prompt: right.prompt, feedback: right.feedback },
    sameDraft: left.draft === right.draft,
  }
}

export function getWritingGenreStatus() {
  return schema.WRITING_GENRES.map(genre => {
    const config = schema.getWritingGenreConfig(genre)
    const taskTypes = genre === 'article' ? ['diagnosis', 'revision']
      : genre === 'academic-paper' ? ['academic-planning', 'academic-outline', 'academic-chapter-draft', 'diagnosis', 'revision']
        : [...(config.taskTypes ?? [])]
    const status = genre === "article" ? "supported" : "partial"
    const academicFields = genre === 'academic-paper'
      ? Object.fromEntries(Object.entries(config.targetFields ?? {}).filter(([field]) => ![
        'title', 'goal', 'audience', 'platform', 'successCriteria', 'preserveItems', 'constraints', 'requirements',
      ].includes(field)))
      : {}
    const domainFields = genre === 'academic-paper' ? academicFields : config.domainFields ?? {}
    return {
      genre, name: config.name, applicability: config.applicability ?? '',
      domainFields: structuredClone(domainFields), fieldStorage: genre === 'academic-paper' ? 'academicTarget' : 'domainInputs',
      materialPurposes: ['content', 'style', 'requirement'], taskTypes,
      representativeTask: taskTypes[0] ?? 'diagnosis', status,
      reason: status === 'supported'
        ? '目标、受众、约束、稿件、反馈与轮次保存均已接入主工作台。'
        : '已提供该文体的专属任务提示、字段和专业包；工作区保存外部 AI 回填稿及版本，生成与执行仍需用户通过主任务流程和外部模型完成。',
    }
  })
}

export const writingSchema = schema

