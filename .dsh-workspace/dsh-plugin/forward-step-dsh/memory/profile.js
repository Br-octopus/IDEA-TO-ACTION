import { selectMemories } from './policy.js'

/** 画像只投影当前适用且有有效来源的记忆，不保存第二份自由文本状态。 */
export function buildProfile(state, context) {
  const { selected } = selectMemories(state, context, { limit: Number.MAX_SAFE_INTEGER })
  return selected.map(memory => ({
    key: memory.key,
    value: structuredClone(memory.value),
    scope: memory.scope,
    domains: [...(memory.domains ?? [])],
    memories: [{ memoryId: memory.memoryId, revision: memory.revision }],
    sourceRefs: [...(memory.sourceRefs ?? [])],
  }))
}
