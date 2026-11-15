const SUPPORTED_KEYS = ['verbosity', 'tone', 'language', 'slideDensity']

const RULES = [
  { key: 'verbosity', value: '简洁', pattern: /^(?:请)?(?:尽量|保持|更)?(?:回答|表达|写作|输出|撰写)?(?:简洁|精炼)(?:一些|一点)?(?:地)?(?:回答|表达|写作|输出|撰写)?$/u },
  { key: 'verbosity', value: '详细', pattern: /^(?:请)?(?:尽量|充分|保持|更)?(?:回答|表达|写作|输出|撰写)?(?:详细|详尽|充分展开)(?:一些|一点)?(?:地)?(?:说明|展开|回答|表达|写作|输出|撰写)?$/u },
  { key: 'tone', value: '正式', pattern: /^(?:请)?(?:(?:使用|采用|保持|用)?(?:语气|风格)?)(正式)(?:的)?(?:语气|风格)?$/u },
  { key: 'tone', value: '中性', pattern: /^(?:请)?(?:(?:使用|采用|保持|用)?(?:语气|风格)?)(中性)(?:的)?(?:语气|风格)?$/u },
  { key: 'tone', value: '轻松口语', pattern: /^(?:请)?(?:(?:使用|采用|保持|用)?(?:语气|风格)?)(?:轻松口语|口语化|轻松)(?:的)?(?:语气|风格)?$/u },
  { key: 'language', value: '中文', pattern: /^(?:请)?(?:(?:使用|用|采用|输出|以)?)(中文)(?:输出|作答|回复|撰写|写作)?$/u },
  { key: 'language', value: '英文', pattern: /^(?:请)?(?:(?:使用|用|采用|输出|以)?)(英文)(?:输出|作答|回复|撰写|写作)?$/u },
  { key: 'slideDensity', value: '少字', pattern: /^(?:请)?(?:(?:PPT|幻灯片))?(?:每页|单页)(?:文字|内容|文字内容)?(?:少字|精简)$/u, domain: 'ppt' },
  { key: 'slideDensity', value: '适中', pattern: /^(?:请)?(?:(?:PPT|幻灯片))?(?:每页|单页)(?:文字|内容|文字内容)?适中$/u, domain: 'ppt' },
  { key: 'slideDensity', value: '信息密集', pattern: /^(?:请)?(?:(?:PPT|幻灯片))?(?:每页|单页)(?:文字|内容|文字内容)?(?:信息密集|密集|详细)$/u, domain: 'ppt' },
]

function normalizeLine(value) {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .replace(/^[\s>*•-]+/u, '')
    .replace(/[。.!！?？；;]+$/u, '')
    .replace(/\s+/gu, '')
}

function taskRequirementLines(task) {
  const lines = Array.isArray(task.currentRequirements) ? [...task.currentRequirements] : []
  const methodState = task.methodState ?? {}
  if (task.domain === 'writing') {
    const constraints = methodState.writing?.article?.constraints
    if (typeof constraints === 'string') lines.push(...constraints.split(/\r?\n/u))
  }
  if (task.domain === 'ppt' && Array.isArray(methodState.ppt?.brief?.hardRequirements)) {
    lines.push(...methodState.ppt.brief.hardRequirements)
  }
  return lines
}

/**
 * 将严格匹配的明确要求归一成记忆键覆盖项。任何不完整、带否定或含多种
 * 意思的句子都保留为原文要求，不参与自动推断。
 */
export function deriveCurrentOverrides(task) {
  if (!task || typeof task !== 'object') return []
  const valuesByKey = new Map()
  for (const line of taskRequirementLines(task)) {
    const text = normalizeLine(line)
    if (!text) continue
    const matches = RULES.filter(rule => (!rule.domain || rule.domain === task.domain) && rule.pattern.test(text))
    if (matches.length !== 1) continue
    const { key, value } = matches[0]
    const values = valuesByKey.get(key) ?? new Set()
    values.add(value)
    valuesByKey.set(key, values)
  }

  return SUPPORTED_KEYS.flatMap(key => {
    const values = valuesByKey.get(key)
    return values?.size === 1 ? [{ key, value: [...values][0] }] : []
  })
}

/** 优先使用任务中已持久化的明确覆盖项；旧任务缺字段时才兼容性地归一原要求。 */
export function currentOverridesForTask(task) {
  const saved = task?.methodState?.currentOverrides
  if (!Array.isArray(saved)) return deriveCurrentOverrides(task)
  const supportedKeys = new Set(SUPPORTED_KEYS)
  return saved.filter(item => item
    && supportedKeys.has(item.key)
    && typeof item.value === 'string'
    && item.value.trim())
}
