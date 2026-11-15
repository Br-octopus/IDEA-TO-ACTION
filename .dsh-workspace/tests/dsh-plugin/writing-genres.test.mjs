import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { buildMethodPrompt } from '../../dsh-plugin/forward-step-dsh/core/methods.js'
import { getWritingGenreStatus } from '../../dsh-plugin/forward-step-dsh/core/writing.js'
import { listWritingPacks } from '../../dsh-plugin/forward-step-dsh/core/writing-packs.js'

const require = createRequire(import.meta.url)
const schema = require('../../dsh-plugin/forward-step-dsh/vendor/core/writing-workbench-schema.js')

test('每个已定义文体均走其专属诊断与规划流程，不降级成普通文章或通用提示', () => {
  const genres = schema.WRITING_GENRES.filter(genre => genre !== 'article')
  for (const genre of genres) {
    const task = {
      taskId: `genre-${genre}`, entryType: 'advance-idea', domain: 'writing', originalInput: `目标-${genre}`,
      currentRequirements: ['保留矩阵要求'], materials: [], versions: [], reviews: [],
      methodState: { writing: { article: { id: `article-${genre}`, genre, goal: `目标-${genre}`, domainInputs: {} }, round: {} } },
      agent: { id: `genre-${genre}`, type: 'advance-idea', goal: `目标-${genre}` },
    }
    const plan = buildMethodPrompt(task, 'planning')
    const diagnosis = buildMethodPrompt(task, 'diagnosis')
    assert.ok(plan.includes(genre), `${genre} plan retains genre`)
    assert.match(diagnosis, /诊断|检查|审阅|问题/u, `${genre} uses a diagnostic prompt`)
    assert.doesNotMatch(plan, /当前首版只覆盖普通文章/u, `${genre} does not claim generic fallback`)
  }
})

test('学术论文规划与修订使用学术专属提示词', () => {
  const task = {
    taskId: 'academic-writing', entryType: 'advance-idea', domain: 'writing', originalInput: '学术论文目标',
    currentRequirements: ['明确引用证据'], materials: [], versions: [], reviews: [],
    methodState: { writing: { article: { id: 'academic-article', genre: 'academic-paper', goal: '学术论文目标', academicTarget: { discipline: 'computer science' } }, round: {} } },
    agent: { id: 'academic-writing', type: 'advance-idea', goal: '学术论文目标' },
  }
  assert.match(buildMethodPrompt(task, 'planning'), /研究与写作规划|学术包|研究问题/u)
  assert.match(buildMethodPrompt(task, 'step-prompt'), /定向修改提示词|研究证据|修改/u)
})


const coverageMatrix = [
  { genre: 'article', packId: 'builtin-article', sourcePlans: ['2026-10-20-writing-workbench.md'], task: 'diagnosis', materialPurposes: ['content', 'style', 'requirement'] },
  { genre: 'academic-paper', packId: 'builtin-academic-paper', sourcePlans: ['2026-10-21-writing-academic-a-implementation.md', '2026-10-21-writing-academic-b-implementation.md', '2026-10-21-writing-academic-c-implementation.md', '2026-10-21-writing-academic-d-implementation.md'], task: 'academic-planning', materialPurposes: ['content', 'requirement'] },
  { genre: 'longform-research-article', packId: 'builtin-longform-research-article', sourcePlans: ['2026-10-22-writing-domain-expansion-completion-implementation.md'], task: 'research-brief', materialPurposes: ['content', 'requirement'] },
  { genre: 'technical-document', packId: 'builtin-technical-document', sourcePlans: ['2026-10-21-writing-structured-documents-implementation.md'], task: 'technical-procedure', materialPurposes: ['content', 'requirement'] },
  { genre: 'business-document', packId: 'builtin-business-document', sourcePlans: ['2026-10-22-writing-domain-expansion-completion-implementation.md'], task: 'business-report', materialPurposes: ['content', 'requirement'] },
  { genre: 'news', packId: 'builtin-news', sourcePlans: ['2026-10-21-writing-structured-documents-implementation.md'], task: 'news-fact-organization', materialPurposes: ['content', 'requirement'] },
  { genre: 'tutorial-course', packId: 'builtin-tutorial-course', sourcePlans: ['2026-10-22-writing-domain-expansion-completion-implementation.md'], task: 'course-plan', materialPurposes: ['content', 'requirement'] },
  { genre: 'resume-job-search', packId: 'builtin-resume-job-search', sourcePlans: ['2026-10-22-writing-domain-expansion-completion-implementation.md'], task: 'resume-experience-map', materialPurposes: ['content', 'requirement'] },
  { genre: 'email', packId: 'builtin-email', sourcePlans: ['2026-10-21-writing-structured-documents-implementation.md'], task: 'email-draft', materialPurposes: ['content', 'requirement'] },
  { genre: 'official-document', packId: 'builtin-official-document', sourcePlans: ['2026-10-21-writing-structured-documents-implementation.md'], task: 'official-document-plan', materialPurposes: ['content', 'requirement'] },
  { genre: 'legal-document', packId: 'builtin-legal-document', sourcePlans: ['2026-10-21-writing-structured-documents-implementation.md'], task: 'legal-fact-organization', materialPurposes: ['content', 'requirement'] },
  { genre: 'social-post', packId: 'builtin-social-post', sourcePlans: ['2026-10-21-writing-audiovisual-implementation.md'], task: 'social-post-draft', materialPurposes: ['content', 'style', 'requirement'] },
  { genre: 'short-video', packId: 'builtin-short-video', sourcePlans: ['2026-10-21-writing-audiovisual-implementation.md'], task: 'video-plan', materialPurposes: ['content', 'style', 'requirement'] },
  { genre: 'spoken-script', packId: 'builtin-spoken-script', sourcePlans: ['2026-10-21-writing-audiovisual-implementation.md'], task: 'spoken-draft', materialPurposes: ['content', 'style', 'requirement'] },
  { genre: 'podcast', packId: 'builtin-podcast', sourcePlans: ['2026-10-21-writing-audiovisual-implementation.md'], task: 'podcast-plan', materialPurposes: ['content', 'style', 'requirement'] },
  { genre: 'speech', packId: 'builtin-speech', sourcePlans: ['2026-10-21-writing-audiovisual-implementation.md'], task: 'speech-plan', materialPurposes: ['content', 'style', 'requirement'] },
  { genre: 'fiction', packId: 'builtin-fiction', sourcePlans: ['2026-10-21-writing-longform-fiction-implementation.md'], task: 'longform-planning', materialPurposes: ['content', 'style', 'requirement'] },
  { genre: 'script', packId: 'builtin-script', sourcePlans: ['2026-10-21-writing-longform-fiction-implementation.md'], task: 'longform-planning', materialPurposes: ['content', 'style', 'requirement'] },
  { genre: 'longform-general', packId: 'builtin-longform-general', sourcePlans: ['2026-10-21-writing-longform-fiction-implementation.md'], task: 'longform-planning', materialPurposes: ['content', 'style', 'requirement'] },
]

test('设计稿中的全部规划文体均有来源计划、专业包、材料用途和代表任务', () => {
  const statuses = getWritingGenreStatus()
  const packs = listWritingPacks()
  assert.deepEqual(new Set(statuses.map(item => item.genre)), new Set(coverageMatrix.map(item => item.genre)))
  for (const row of coverageMatrix) {
    const status = statuses.find(item => item.genre === row.genre)
    const pack = packs.find(item => item.id === row.packId)
    assert.ok(status, `${row.genre} has a declared capability state`)
    assert.ok(['supported', 'partial', 'unsupported'].includes(status.status), `${row.genre} has an explicit status`)
    assert.ok(status.name && status.applicability && status.reason, `${row.genre} explains its boundary`)
    assert.ok(status.taskTypes.includes(row.task), `${row.genre} exposes representative task ${row.task}`)
    assert.ok(row.sourcePlans.every(file => existsSync(new URL(`../../docs/superpowers/plans/${file}`, import.meta.url))), `${row.genre} source plans exist`)
    assert.ok(pack, `${row.genre} has a professional pack`)
    assert.ok(pack.sources.length > 0 && pack.sources.every(source => source.title && source.verificationStatus), `${row.genre} pack preserves source and verification state`)
    assert.ok(row.materialPurposes.every(purpose => ['content', 'style', 'requirement'].includes(purpose)), `${row.genre} declares supported material purposes`)
    if (row.genre === 'article') assert.equal(status.status, 'supported')
    else assert.equal(status.status, 'partial', `${row.genre} remains partial until full integrated-path evidence exists`)
    if (row.genre !== 'article') assert.ok(Object.keys(status.domainFields).length > 0, `${row.genre} exposes genre-specific fields`)
  }
  for (const [packId, sourcePlan, task] of [
    ['builtin-academic-review', '2026-10-21-writing-academic-b-implementation.md', 'review'],
    ['builtin-academic-publishing', '2026-10-21-writing-academic-d-implementation.md', 'academic-publishing'],
  ]) {
    const pack = packs.find(item => item.id === packId)
    assert.ok(pack && pack.taskType === task, `${packId} covers its separate academic workflow`)
    assert.ok(existsSync(new URL(`../../docs/superpowers/plans/${sourcePlan}`, import.meta.url)))
    assert.ok(pack.sources.length > 0)
  }
})

test('文体领域字段进入对应代表任务提示词，而不是只显示在菜单', () => {
  for (const status of getWritingGenreStatus().filter(item => item.genre !== 'article')) {
    const firstField = Object.keys(status.domainFields)[0]
    const fieldValue = `矩阵字段-${status.genre}`
    const article = { id: `article-${status.genre}`, genre: status.genre, goal: `目标-${status.genre}` }
    if (status.fieldStorage === 'academicTarget') article.academicTarget = { [firstField]: fieldValue }
    else article.domainInputs = { [firstField]: fieldValue }
    const task = {
      taskId: `genre-field-${status.genre}`, entryType: 'advance-idea', domain: 'writing', originalInput: article.goal,
      currentRequirements: [], materials: [], versions: [], reviews: [],
      methodState: { writing: { article, round: { taskType: status.representativeTask } } },
      agent: { id: `genre-field-${status.genre}`, type: 'advance-idea', goal: article.goal },
    }
    const prompt = buildMethodPrompt(task, 'planning')
    assert.ok(prompt.includes(fieldValue), `${status.genre}.${firstField} reaches the generated prompt`)
  }
})
