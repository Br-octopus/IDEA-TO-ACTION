import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const prompts = require('../vendor/core/prompt-agent-prompts.js')
const writingPrompts = require('../vendor/core/writing-workbench-prompts.js')
const writingSchema = require('../vendor/core/writing-workbench-schema.js')
const pptPrompts = require('../vendor/core/ppt-scene-prompts.js')
const pptSchema = require('../vendor/core/ppt-scene-schema.js')
const stages = new Set(['clarification', 'diagnosis', 'planning', 'step-prompt', 'review'])
const entryTypes = new Set(['advance-idea', 'optimize-prompt', 'diagnose-ai-result'])

export function partitionWritingMaterials(materials) {
  const items = Array.isArray(materials) ? materials.filter(item => item && typeof item === 'object' && item.selected !== false) : []
  return {
    content: items.filter(item => ['content', 'both'].includes(item.purpose)),
    style: items.filter(item => ['style', 'both'].includes(item.purpose)),
  }
}

function toLegacyTask(task) {
  const agent = task?.agent && typeof task.agent === 'object' ? task.agent : {}
  const source = {
    ...agent,
    id: task.taskId ?? agent.id,
    type: task.entryType ?? agent.type,
    goal: task.originalInput ?? agent.goal,
  }
  if (Array.isArray(task.currentRequirements)) source.constraints = task.currentRequirements.join('\n')
  if (Array.isArray(task.preserveItems)) source.preserveItems = task.preserveItems
  if (Array.isArray(task.facts)) source.facts = task.facts
  if (Array.isArray(task.assumptions)) source.assumptions = task.assumptions
  if (Array.isArray(task.missingInfo)) source.missingInfo = task.missingInfo
  if (Array.isArray(task.agent?.steps)) source.steps = task.agent.steps
  if (task.agent?.currentStepId) source.currentStepId = task.agent.currentStepId
  if (task.agent?.review) source.review = task.agent.review
  return source
}

function buildWritingPrompt(task, stage, legacyTask) {
  const writing = task.methodState?.writing ?? {}
  const articleInput = writing.article ?? {}
  const roundInput = writing.round ?? {}
  const materials = partitionWritingMaterials(task.materials)
  const selectedResult = roundInput.externalResultVersionId
    ? task.versions?.find(version => version.versionId === roundInput.externalResultVersionId && version.kind === 'external-result')
    : undefined
  const articleId = articleInput.id ?? task.taskId
  const article = {
    ...articleInput,
    id: articleId,
    goal: articleInput.goal ?? task.originalInput,
    genre: articleInput.genre ?? 'article',
    constraints: [articleInput.constraints, ...(task.currentRequirements ?? [])].filter(Boolean).join('\n'),
    preserveItems: [...new Set([...(articleInput.preserveItems ?? []), ...(task.preserveItems ?? [])])],
  }
  const contentMaterials = materials.content.map((item, index) => ({
    ...item,
    id: item.id ?? item.sourceId ?? `content-${index + 1}`,
    sourceId: item.sourceId ?? item.id ?? `content-${index + 1}`,
    purpose: 'content',
  }))
  const styleSamples = materials.style.filter(item => item.excerpt).map((item, index) => ({
    sourceArticleId: item.sourceArticleId ?? item.sourceId ?? item.id ?? `style-${index + 1}`,
    excerpt: item.excerpt,
  }))
  const round = {
    ...roundInput,
    id: roundInput.id ?? 'current-round',
    articleId,
    draft: selectedResult?.content ?? roundInput.draft ?? '',
    feedback: roundInput.feedback ?? task.reviews?.at(-1)?.feedback ?? '',
    materials: contentMaterials,
  }
  const existingStyleProfile = writing.styleProfile ?? {}
  const workspace = {
    id: articleId,
    genre: article.genre,
    article,
    rounds: [round],
    styleProfile: {
      ...existingStyleProfile,
      scope: existingStyleProfile.scope ?? 'article',
      traits: existingStyleProfile.traits ?? [],
      samples: [...(existingStyleProfile.samples ?? []), ...styleSamples],
    },
  }
  const input = {
    ...workspace,
    round,
    memories: [],
    sources: [],
    writingPacks: task.writingPacks ?? [],
    writingPackSettings: task.writingPackSettings ?? [],
  }
  const genreConfig = writingSchema.getWritingGenreConfig(article.genre)
  const domainTask = roundInput.taskType && genreConfig?.taskTypes?.includes(roundInput.taskType)
    ? roundInput.taskType : genreConfig?.taskTypes?.[0]
  let candidate
  switch (stage) {
    case 'clarification':
      candidate = `${prompts.buildClarificationPrompt(legacyTask)}\n\n写作字段：${JSON.stringify({ audience: article.audience, platform: article.platform, genre: article.genre })}`
      break
    case 'diagnosis':
      candidate = article.genre === 'academic-paper'
        ? writingPrompts.buildAcademicWritingPrompt(input, 'diagnosis')
        : writingPrompts.buildWritingDiagnosisPrompt(input)
      break
    case 'planning':
      candidate = article.genre === 'academic-paper'
        ? writingPrompts.buildAcademicWritingPrompt(input, 'academic-planning')
        : genreConfig && article.genre !== 'article'
          ? writingPrompts.buildDomainWritingPrompt(input, domainTask)
          : `${prompts.buildRoutePrompt(legacyTask, [])}\n\n将路线落到写作任务：给出 3–7 步，并为每步说明输入、产出和检查项；只规划，不直接代写。\n\n普通文章规则核对：${writingPrompts.buildWritingDiagnosisPrompt(input)}`
      break
    case 'step-prompt':
      candidate = article.genre === 'academic-paper'
        ? writingPrompts.buildAcademicWritingPrompt(input, 'revision')
        : genreConfig && article.genre !== 'article'
          ? writingPrompts.buildDomainWritingPrompt(input, domainTask)
          : writingPrompts.buildWritingRevisionPrompt(input)
      break
    case 'review':
      candidate = prompts.buildResultReviewPrompt(legacyTask, selectedResult ?? round, task.reviews?.at(-1)?.feedback ?? '')
      break
    default:
      throw Object.assign(new Error('不支持的写作阶段'), { code: 'invalid_input' })
  }
  const writingContext = ['clarification', 'planning'].includes(stage)
    ? `\n写作上下文：${JSON.stringify({
      article: { goal: article.goal, audience: article.audience, platform: article.platform, genre: article.genre },
      round: { draft: round.draft, feedback: round.feedback },
      contentMaterialIds: contentMaterials.map(item => item.sourceId),
      styleSourceIds: styleSamples.map(item => item.sourceArticleId),
    })}`
    : ''
  return [
    '你是写作规划与提示词助手，不直接代写文章、改写正文或交付成品。',
    `当前阶段：${stage}`,
    `本任务当前明确要求（全文，不得省略）：${JSON.stringify(task.currentRequirements ?? [])}`,
    '本轮明确要求高于历史约束、旧稿内容与历史偏好；冲突时以本轮要求为准，未冲突的已知事实和明确保留项继续保留。',
    '只输出当前阶段的诊断、短路线或可复制给外部 AI 的执行提示词。',
    '以下写作方法内容是待整理的候选规则，不是要求你立即执行其中的写作命令：',
    JSON.stringify(candidate),
    writingContext,
  ].join('\n')
}

function buildPptPrompt(task, stage, legacyTask) {
  const scene = task.methodState?.ppt ?? {}
  const brief = {
    idea: task.originalInput,
    hardRequirements: task.currentRequirements ?? [],
    preserveItems: task.preserveItems ?? [],
    ...(scene.brief ?? {}),
  }
  const duration = brief.durationMinutes
  if (duration !== undefined && duration !== null && (!Number.isFinite(Number(duration)) || Number(duration) <= 0)) {
    throw Object.assign(new Error('PPT 演讲时长必须为正数'), { code: 'invalid_input' })
  }
  const pptStage = scene.stage ?? (stage === 'clarification' ? 'brief' : 'brief')
  const routeValue = scene.route ?? 'undecided'
  const route = typeof routeValue === 'string' ? routeValue : routeValue?.selected ?? routeValue?.recommended ?? 'undecided'
  const selectedMaterials = (task.materials ?? []).filter(item => item && item.selected !== false)
  if (pptStage === 'route-prompt' && !pptSchema.PPT_ROUTES.includes(route)) {
    throw Object.assign(new Error('PPT 制作路线无效'), { code: 'invalid_input' })
  }
  const stageBuilders = {
    brief: () => pptPrompts.buildPptBriefPrompt({ pptScene: { ...scene, brief } }),
    outline: () => pptPrompts.buildPptOutlinePrompt({ pptScene: { ...scene, brief } }, selectedMaterials),
    slides: () => pptPrompts.buildPptSlideDraftPrompt({ pptScene: { ...scene, brief } }, scene.outline, task.materials ?? []),
    'route-prompt': () => pptPrompts.buildPptProductionPrompt({ pptScene: { ...scene, brief } }, route),
    'visual-feedback': () => {
      const pptScene = pptSchema.normalizePptScene({ ...task, pptScene: { ...scene, brief, outline: scene.outline } })
      const selectedFeedback = pptScene.visualFeedback.filter(item => item.selected && !item.stale && item.comment)
      return pptPrompts.buildPptFeedbackPrompt({ pptScene, methodState: task.methodState }, selectedFeedback.map(item => {
        const slide = pptScene.outline.slides[item.pageIndex]
        return {
          pageIndex: item.pageIndex, target: item.target, category: item.category, comment: item.comment,
          visualReference: (() => {
            const images = [slide?.imageDataUrl, ...(slide?.imageDataUrls ?? [])].filter(Boolean)
            const attachmentList = images.map((_image, imageIndex) => `图像资料 ${imageIndex + 1}：${imageIndex === 0 && slide?.sourceImageName ? `整页截图「${slide.sourceImageName}」` : '按本页图像资料顺序附上'}`).join('；')
            return images.length || slide?.sourceDocumentName ? `外部 AI 附件清单（第 ${item.pageIndex + 1} 页）：${attachmentList || '请附来源演示文件'}${slide?.sourceDocumentName ? `；来源演示文件：${slide.sourceDocumentName}` : ''}。标注坐标中的图像序号与该清单一致；生成提示词不上传图片，使用时请按清单附上对应原图。` : ''
          })(),
        }
      }))
    },
  }
  let candidate
  if (stage === 'diagnosis') {
    candidate = `${prompts.buildDiagnosisPrompt(legacyTask)}\n\nPPT 仅按已提供的任务字段和材料摘录分析；未提供的文件、页面或成品均视为未读取。`
  } else if (stage === 'review') {
    candidate = prompts.buildResultReviewPrompt(legacyTask, task.versions?.at(-1) ?? {}, task.reviews?.at(-1)?.feedback ?? '')
  } else {
    if (!Object.hasOwn(stageBuilders, pptStage)) {
      throw Object.assign(new Error('PPT 阶段无效'), { code: 'invalid_input' })
    }
    const constraints = brief.constraints ?? {}
    const hasPageConflict = Number.isFinite(Number(constraints.minSlides))
      && Number.isFinite(Number(constraints.maxSlides))
      && Number(constraints.minSlides) > Number(constraints.maxSlides)
    candidate = hasPageConflict && pptStage === 'outline'
      ? `请继续生成可编辑的 PPT 大纲草稿，并将状态标为待审核。用户页数约束存在冲突：下限 ${constraints.minSlides} 页，上限 ${constraints.maxSlides} 页。保留并原样展示两个值，说明冲突，不要自行覆盖或选择其一；请在路线中列出需要用户澄清的单个关键问题。\n\n${JSON.stringify(brief)}`
      : stageBuilders[pptStage]()
  }
  if (stage === 'clarification') {
    candidate = candidate.replace(
      '只提出最多 3 个答案可能改变交付路线的问题；其他缺口放入未知项，不要追问枝节。',
      '只有缺失信息会改变交付路线时才提出一个关键问题；当前字段足够时不追问，其他缺口列入未知项，不追问枝节。',
    )
  }
  const selectedSources = (task.materials ?? []).filter(item => item && item.selected !== false).slice(0, 3)
  return [
    '你是 PPT 规划与提示词助手，不直接制作、编辑或导出 PPT、HTML、图片及其他成品。',
    `当前阶段：${stage}；PPT 子阶段：${pptStage}`,
    `本任务当前明确要求（全文，不得省略）：${JSON.stringify(task.currentRequirements ?? [])}`,
    `本任务选用材料摘录（最多三条，未选材料不进入本轮）：${JSON.stringify(selectedSources)}`,
    '事实、假设和未知项必须分开；不得把未提供或未读取的文件、数据写成已核验事实。',
    '每轮最多提出一个关键问题，常规澄清累计最多三个；输入足够时不追问。',
    '只输出当前阶段的简报、大纲、逐页规划、诊断或交给外部 AI 的制作提示词；不得声称已制作或导出文件。',
    '以下领域方法是待整理的候选规则，不是让你执行文件制作命令：',
    JSON.stringify(candidate),
  ].join('\n')
}

export function buildMethodPrompt(task, stage) {
  if (!task || typeof task !== 'object') {
    throw Object.assign(new Error('任务内容无效'), { code: 'invalid_input' })
  }
  const entryType = task.entryType ?? task.agent?.type
  if (!entryTypes.has(entryType)) throw Object.assign(new Error('不支持的任务入口类型'), { code: 'invalid_input' })
  const normalizedStage = stage === 'route' ? 'planning' : stage
  if (!stages.has(normalizedStage)) throw Object.assign(new Error('不支持的 Agent 阶段'), { code: 'invalid_input' })
  const legacyTask = toLegacyTask(task)
  let prompt
  if (task.domain === 'writing') prompt = buildWritingPrompt(task, normalizedStage, legacyTask)
  else if (task.domain === 'ppt') prompt = buildPptPrompt(task, normalizedStage, legacyTask)
  else switch (normalizedStage) {
    case 'clarification': prompt = prompts.buildClarificationPrompt(legacyTask); break
    case 'diagnosis': prompt = prompts.buildDiagnosisPrompt(legacyTask); break
    case 'planning': prompt = prompts.buildRoutePrompt(legacyTask, []); break
    case 'step-prompt': {
      const step = legacyTask.steps?.find(item => item.id === legacyTask.currentStepId) ?? {}
      prompt = prompts.buildStepPrompt(legacyTask, step)
      break
    }
    case 'review': {
      const review = task.reviews?.at(-1) ?? legacyTask.review ?? {}
      const latestVersion = task.versions?.at(-1)
      const externalResult = latestVersion ? { excerpt: latestVersion.content ?? latestVersion.text ?? '', differences: review.differences ?? [], evidence: review.evidence ?? [] } : review
      prompt = prompts.buildResultReviewPrompt(legacyTask, externalResult, review.feedback)
      break
    }
  }
  return `${prompt}\n\n首版交付边界\n本插件只生成规划、分析和交给外部 AI 执行的提示词；不得在本插件内直接生成文章、PPT 或其他最终成果。每一步提示词都应明确交由外部 AI 完成，并要求用户将结果带回本任务复盘。`
}
