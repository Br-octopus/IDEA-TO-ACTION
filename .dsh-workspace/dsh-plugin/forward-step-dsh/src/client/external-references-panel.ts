import * as React from 'react'
import { buildManualSearchUrl, listExternalReferences, listResearchSamples } from '../../core/external-references.js'

const { createElement: h, useState } = React

export function ExternalReferencesPanel() {
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('外部网站由你手动打开和核验；插件不会声称已完成搜索。')
  const [sampleId, setSampleId] = useState('agent')
  const sample = listResearchSamples().find(item => item.id === sampleId)!

  async function copyQuery() {
    const value = query.trim()
    if (!value) return setMessage('先输入检索主题。')
    try {
      await navigator.clipboard.writeText(value)
      setMessage('检索式已复制；插件未执行搜索。')
    } catch (error) {
      setMessage(`复制失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return h('section', { 'aria-label': '外部参考与研究样本' },
    h('h2', { style: { fontSize: '17px', margin: 0 } }, '外部参考与研究样本'),
    h('p', null, '外部内容仅供你查看和核验，不会自动进入提示词库、资料库或模型请求。'),
    h('label', null, '检索主题 ', h('input', { value: query, maxLength: 240, onChange: (event: any) => setQuery(event.target.value), placeholder: '例如：长文写作 Agent' })),
    h('div', null,
      ...listExternalReferences().map(reference => h('article', { key: reference.id, style: { minWidth: 0, borderTop: '1px solid var(--dsw-alias-border-secondary)', padding: '8px 0' } },
        h('h3', { style: { fontSize: '14px', margin: '4px 0' } }, reference.title),
        h('p', null, reference.purpose),
        h('small', null, reference.license),
        h('p', null, h('a', { href: buildManualSearchUrl(reference.id, query), target: '_blank', rel: 'noopener noreferrer' }, '手动打开参考入口')))),
      h('button', { type: 'button', onClick: () => void copyQuery() }, '复制检索主题')),
    h('label', null, '只读样例 ', h('select', { value: sampleId, onChange: (event: any) => setSampleId(event.target.value) }, ...listResearchSamples().map(item => h('option', { key: item.id, value: item.id }, item.title)))),
    h('blockquote', { style: { margin: 0, padding: '8px 12px', borderLeft: '3px solid var(--dsw-alias-border-secondary)' } }, sample.text),
    h('small', null, '合成示例，不代表真实检索、模型效果或平台验证。'),
    h('p', { role: 'status', 'aria-live': 'polite' }, message))
}
