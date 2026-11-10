const references = Object.freeze([
  { id: 'github-prompts', title: 'GitHub 提示词与 Agent 项目', url: 'https://github.com/search', purpose: '查找公开仓库和实现案例', license: '逐仓库核对许可证与来源；插件不自动导入内容。' },
  { id: 'github-skills', title: 'GitHub Skills 社区', url: 'https://github.com/topics/agent-skills', purpose: '浏览社区维护的 Agent Skills', license: '社区内容仅作参考，适用前核对原仓库许可。' },
  { id: 'arxiv', title: 'arXiv 学术论文', url: 'https://arxiv.org/search/', purpose: '手动检索公开学术论文', license: '论文使用遵循各文章声明；开放获取不等于可任意复用。' },
])

const samples = Object.freeze([
  { id: 'agent', title: 'Agent 规划样例', text: '目标：为合成的图书馆活动设计报名流程。缺少预算和日期时先提问；路线包含需求澄清、方案草拟、人工核验。' },
  { id: 'writing', title: '写作复盘样例', text: '合成稿件反馈：读者对象清楚，但行动信息不完整。下一轮补充时间与地点字段，并保留未知项，不补造事实。' },
  { id: 'research', title: '研究样例', text: '合成研究问题：比较两种公开文档导航方式。记录查询式、来源日期、纳入理由和限制；样例结果不是实际检索结果。' },
])

export function listExternalReferences() { return references.map(item => ({ ...item })) }
export function listResearchSamples() { return samples.map(item => ({ ...item })) }

export function buildManualSearchUrl(referenceId, query = '') {
  const reference = references.find(item => item.id === referenceId)
  if (!reference) throw Object.assign(new Error('未知的外部参考入口'), { code: 'not_found' })
  const normalized = typeof query === 'string' ? query.trim().slice(0, 240) : ''
  if (!normalized) return reference.url
  const url = new URL(reference.url)
  if (referenceId === 'github-prompts') {
    url.searchParams.set('q', normalized)
    url.searchParams.set('type', 'repositories')
  } else if (referenceId === 'arxiv') {
    url.searchParams.set('query', normalized)
    url.searchParams.set('searchtype', 'all')
  }
  return url.toString()
}
