import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const prompts = require('../vendor/core/prompt-agent-prompts.js')
const stages = new Set(['clarification', 'diagnosis', 'planning', 'step-prompt', 'review'])
const entryTypes = new Set(['advance-idea', 'optimize-prompt', 'diagnose-ai-result'])

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
  switch (normalizedStage) {
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
