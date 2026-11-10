/** 将 Host 已完成范围校验的数据映射为侧栏视图；客户端不自行判断记忆是否生效。 */
export function isCurrentMemoryViewRequest(requestId, latestRequestId, responseTaskId, expectedTaskId) {
  return requestId === latestRequestId && responseTaskId === expectedTaskId
}

export function toMemoryView(state, context, { crossTask = false } = {}) {
  if (!state || !context || state.taskId !== context.taskId) {
    return { taskId: context?.taskId ?? '', crossTask, memories: [], changes: [], sources: [], jobs: [], profile: [], usedMemories: [], learningPaused: false }
  }
  const allowedIds = new Set(crossTask ? (state.crossTaskMemoryIds ?? state.visibleMemoryIds ?? []) : (state.visibleMemoryIds ?? []))
  const memories = (state.memories ?? []).filter(memory => allowedIds.has(memory.memoryId))
  const memoryIds = new Set(memories.map(memory => memory.memoryId))
  const sourceIds = new Set(memories.flatMap(memory => memory.sourceRefs ?? []))
  const sourceById = new Map((state.sources ?? []).map(source => [source.sourceId, source]))
  const sources = [...sourceIds].map(sourceId => {
    const source = sourceById.get(sourceId)
    return source
      ? { sourceId, kind: source.kind, projectId: source.projectId, taskId: source.taskId, conversationId: source.conversationId, locator: source.active ? source.locator : null, excerpt: source.excerpt, active: source.active === true }
      : { sourceId, kind: 'unknown', locator: null, excerpt: '', active: false }
  })
  const allowedJobs = new Set(crossTask ? (state.visibleJobIds ?? []) : (state.currentTaskJobIds ?? []))
  const jobs = (state.jobs ?? []).filter(job => allowedJobs.has(job.jobId))
  const changes = (state.changes ?? []).filter(change => memoryIds.has(change.memoryId))
  const usedMemories = (state.usedMemories ?? []).flatMap(version => (version.usedMemories ?? []).map(memory => ({ versionId: version.versionId, memoryId: memory.memoryId, revision: memory.revision })))
  return {
    taskId: context.taskId, crossTask, memories, changes, sources, jobs,
    profile: [...(state.profile ?? [])], usedMemories, learningPaused: state.learningPaused === true,
  }
}
