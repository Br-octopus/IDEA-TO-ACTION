import { ForwardStepProbe } from './lib/host-service.js'
import { createDshBrowserSocialResearch } from './core/dsh-browser-social-research.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const skillName = 'forward-step'
const providerName = 'forward-step-dsh'
const description = '将模糊想法、现有提示词或不满意的 AI 结果推进成可执行的下一步，并在执行后复盘结果。'
const whenToUse = '当用户需要梳理想法、优化提示词、诊断 AI 结果、规划路线、生成当前步骤提示词，或复盘外部 AI 输出时使用。'
const skillUrl = new URL('./skills/forward-step/SKILL.md', import.meta.url)
const resourceBase = { kind: 'directory', path: fileURLToPath(new URL('./skills/forward-step/', import.meta.url)) }
const invocation = { modelInvocable: true, userInvocable: true }
const candidate = { name: skillName, description, whenToUse, invocation, provider: providerName, source: 'bundled', resourceBase, rank: 600, locator: skillUrl }
const provider = {
  name: providerName,
  list: () => Promise.resolve([candidate]),
  async get(candidate) {
    return { name: candidate.name, description: candidate.description, whenToUse: candidate.whenToUse, invocation: candidate.invocation, provider: candidate.provider, source: candidate.source, resourceBase, content: await readFile(skillUrl, 'utf8') }
  },
}
export const name = 'forward-step-dsh'
export const inject = ['skills', 'storageDomain', 'agents', 'llm']
export function apply(ctx) {
  const socialResearch = typeof ctx.get === 'function' ? ctx.get('socialResearch') : undefined
  const browser = typeof ctx.get === 'function' ? ctx.get('browser', false) : undefined
  const probe = new ForwardStepProbe(ctx.storageDomain, ctx.agents, ctx.llm, typeof ctx.get === 'function' ? ctx.get('attachments') : undefined, typeof ctx.get === 'function' ? ctx.get('web') : undefined, socialResearch ?? createDshBrowserSocialResearch(browser))
  ctx.provide('forwardStepProbe', probe)
  ctx.on('llm/stream', (options, next) => {
    probe.captureRealModelRequest(options)
    return next()
  }, { global: true })
  ctx.effect(() => async () => { await probe.dispose() }, 'forward-step: host probe resources')
  ctx.skills.registerProvider(() => provider)
}
