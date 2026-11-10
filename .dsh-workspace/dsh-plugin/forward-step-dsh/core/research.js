const DEFAULT_MAX_QUERIES = 3
const DEFAULT_MAX_SOURCES = 5

function failure(message) {
  return Object.assign(new Error(message), { code: 'invalid_input' })
}

function withResearch(task, research) {
  if (!task || !task.agent || typeof task.agent !== 'object') throw failure('研究请求缺少有效任务')
  return { ...task, agent: { ...task.agent, research } }
}

export function requestResearch(task, input = {}) {
  const previous = task?.agent?.research
  if (previous?.decision === 'rejected') throw failure('用户已经拒绝联网，本任务不能再次申请')
  if (previous?.decision === 'pending') throw failure('当前研究请求正在等待确认')
  const objective = typeof input.objective === 'string' ? input.objective.trim().slice(0, 500) : ''
  const queries = [...new Set((Array.isArray(input.queries) ? input.queries : [])
    .filter(value => typeof value === 'string').map(value => value.trim().slice(0, 240)).filter(Boolean))].slice(0, DEFAULT_MAX_QUERIES)
  if (!objective || !queries.length) throw failure('研究目标和查询不能为空')
  return withResearch(task, {
    status: 'awaiting-confirmation', decision: 'pending',
    scope: { objective, queries, sourceTypes: ['web'] },
    budget: { maxQueries: DEFAULT_MAX_QUERIES, maxSources: DEFAULT_MAX_SOURCES },
    results: [], createdAt: new Date().toISOString(),
  })
}

export function approveResearch(task) {
  const research = task?.agent?.research
  if (research?.status !== 'awaiting-confirmation' || research.decision !== 'pending') throw failure('当前研究请求不在等待确认状态')
  return withResearch(task, {
    ...research, status: 'not-executed', decision: 'approved',
    message: '已批准；尚未执行联网搜索，请点击执行以开始。', approvedAt: new Date().toISOString(),
  })
}

export function cancelResearch(task) {
  const research = task?.agent?.research
  if (research?.status !== 'awaiting-confirmation' || research.decision !== 'pending') throw failure('当前研究请求不在等待确认状态')
  return withResearch(task, { ...research, status: 'cancelled', decision: 'cancelled', results: [], cancelledAt: new Date().toISOString() })
}
export function rejectResearch(task) {
  const research = task?.agent?.research
  if (research?.status !== 'awaiting-confirmation' || research.decision !== 'pending') throw failure('当前研究请求不在等待确认状态')
  return withResearch(task, { ...research, status: 'rejected', decision: 'rejected', results: [], rejectedAt: new Date().toISOString() })
}
export function completeResearch(task, results) {
  const research = task?.agent?.research
  if (!['not-executed', 'failed'].includes(research?.status) || research.decision !== 'approved') throw failure('只有已批准且尚未执行的研究可以搜索')
  if (!Array.isArray(results)) throw failure('研究搜索结果格式无效')
  const sources = results.flatMap(source => {
    if (!source || typeof source.url !== 'string') return []
    try {
      const url = new URL(source.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return []
      return [{
        url: url.toString().slice(0, 2000),
        title: typeof source.title === 'string' ? source.title.trim().slice(0, 300) : '',
        summary: typeof source.summary === 'string' ? source.summary.trim().slice(0, 2000) : '',
        trust: 'untrusted',
      }]
    } catch { return [] }
  }).slice(0, research.budget.maxSources)
  return withResearch(task, { ...research, status: 'completed', results: sources, message: `搜索完成：获得 ${sources.length} 条待核验来源。`, completedAt: new Date().toISOString() })
}