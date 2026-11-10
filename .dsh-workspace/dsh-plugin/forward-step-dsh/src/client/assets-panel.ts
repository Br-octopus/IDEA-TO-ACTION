import * as React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { comparePromptVersions } from '../../client/prompt-diff.js'

type PromptAsset = { id: string; groupId: string; parentId: string | null; version: number; title: string; text: string; tags: string[]; sourceUrl: string; sourceLicense: string; verificationStatus: 'unverified' | 'tested'; verified: boolean; note: string; archived: boolean; createdAt: string }
type CaseAsset = { id: string; title: string; domain: string; promptText: string; resultSummary: string; feedback: string; sourceUrl: string; sourceLicense: string; verificationStatus: 'unverified' | 'tested'; version: number; history: any[]; createdAt: string; updatedAt: string }
type MethodCard = { id: string; title: string; stages: string[]; summary: string; verificationStatus: string; domains?: string[]; builtin: boolean; editable: boolean }
export type AssetsRemote = {
  listMethodCards(): Promise<RemoteResult<{ cards: MethodCard[]; revision: number }>>
  saveMethodCard(input: { card: { id?: string; title: string; domain: string; summary: string; stages: string[] }; eventId: string }): Promise<RemoteResult<{ card: MethodCard; revision: number }>>
  deleteMethodCard(input: { cardId: string; eventId: string }): Promise<RemoteResult<{ deleted: boolean; revision: number }>>
  listPromptAssets(input: { query?: string; includeArchived?: boolean }): Promise<RemoteResult<{ prompts: PromptAsset[]; revision: number }>>
  savePromptAsset(input: { prompt: Partial<PromptAsset> & { title: string; text: string } }): Promise<RemoteResult<{ prompt: PromptAsset; revision: number }>>
  setPromptVerification(input: { promptId: string; note: string }): Promise<RemoteResult<{ prompt: PromptAsset; revision: number }>>
  setPromptArchived(input: { promptId: string; archived: boolean }): Promise<RemoteResult<{ archived: boolean; revision: number }>>
  deletePromptAsset(input: { promptId: string }): Promise<RemoteResult<{ deleted: boolean; revision: number }>>
  listCaseAssets(input: { query?: string; includeArchived?: boolean }): Promise<RemoteResult<{ cases: CaseAsset[]; revision: number }>>
  saveCaseAsset(input: { caseItem: Partial<CaseAsset> & { title: string; promptText: string; resultSummary: string } }): Promise<RemoteResult<{ caseItem: CaseAsset; revision: number }>>
  deleteCaseAsset(input: { caseId: string }): Promise<RemoteResult<{ deleted: boolean; revision: number }>>
}

const { createElement: h, useState } = React
function unwrap<T>(result: RemoteResult<T>): T { if (result.ok) return result.value; throw result.error }
function emptyPrompt() { return { title: '', text: '', tags: '', sourceUrl: '', sourceLicense: '' } }
function emptyCase() { return { title: '', domain: '', promptText: '', resultSummary: '', feedback: '', sourceUrl: '', sourceLicense: '', verificationStatus: 'unverified' as const } }

export function AssetsPanel({ remote, onSelectDomain }: { remote: AssetsRemote; onSelectDomain: (domain: string) => void }) {
  const [methodCards, setMethodCards] = useState<MethodCard[]>([])
  const [methodDraft, setMethodDraft] = useState({ id: '', title: '', domain: 'general', summary: '', stages: '' })
  const [prompts, setPrompts] = useState<PromptAsset[]>([])
  const [cases, setCases] = useState<CaseAsset[]>([])
  const [promptDraft, setPromptDraft] = useState(emptyPrompt())
  const [caseDraft, setCaseDraft] = useState(emptyCase())
  const [promptBaseId, setPromptBaseId] = useState('')
  const [caseEditId, setCaseEditId] = useState('')
  const [testPromptId, setTestPromptId] = useState('')
  const [testNote, setTestNote] = useState('')
  const [compareLeftId, setCompareLeftId] = useState('')
  const [compareRightId, setCompareRightId] = useState('')
  const [comparison, setComparison] = useState<any>(null)
  const [query, setQuery] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('提示词版本与案例独立保存在插件资料中。')

  async function load() {
    setBusy(true)
    try {
      const [methodResult, promptResult, caseResult] = await Promise.all([
        remote.listMethodCards(),
        remote.listPromptAssets({ query, includeArchived }),
        remote.listCaseAssets({ query, includeArchived }),
      ])
      setMethodCards(unwrap(methodResult).cards)
      setPrompts(unwrap(promptResult).prompts)
      setCases(unwrap(caseResult).cases)
      setMessage('资产库已读取。')
    } catch (error) {
      setMessage(`读取资产失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function saveMethodCard(event: any) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = unwrap(await remote.saveMethodCard({ card: { ...(methodDraft.id ? { id: methodDraft.id } : {}), title: methodDraft.title, domain: methodDraft.domain, summary: methodDraft.summary, stages: methodDraft.stages.split(/\r?\n/u).map(value => value.trim()).filter(Boolean) }, eventId: globalThis.crypto.randomUUID() }))
      setMethodDraft({ id: '', title: '', domain: 'general', summary: '', stages: '' })
      await load()
      setMessage('方法卡“' + result.card.title + '”已保存为自建资产。')
    } catch (error) { setMessage('保存方法卡失败：' + (error instanceof Error ? error.message : String(error))) }
    finally { setBusy(false) }
  }

  async function deleteMethodCard(card: MethodCard) {
    if (!card.editable || !window.confirm('删除自建方法卡“' + card.title + '”？')) return
    setBusy(true)
    try {
      unwrap(await remote.deleteMethodCard({ cardId: card.id, eventId: globalThis.crypto.randomUUID() }))
      await load()
      setMessage('自建方法卡已删除。')
    } catch (error) { setMessage('删除方法卡失败：' + (error instanceof Error ? error.message : String(error))) }
    finally { setBusy(false) }
  }

  async function savePrompt(event: any) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = unwrap(await remote.savePromptAsset({ prompt: {
        ...(promptBaseId ? { promptId: promptBaseId } : {}),
        title: promptDraft.title, text: promptDraft.text,
        tags: promptDraft.tags.split(/[,，\n]/u).map(item => item.trim()).filter(Boolean),
        sourceUrl: promptDraft.sourceUrl, sourceLicense: promptDraft.sourceLicense,
      } }))
      setPromptDraft(emptyPrompt())
      setPromptBaseId('')
      await load()
      setMessage(`已保存 V${result.prompt.version}；旧版本仍保留，当前版本待测试。`)
    } catch (error) {
      setMessage(`保存提示词失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  function compareVersions() {
    try {
      setComparison(comparePromptVersions(prompts, compareLeftId, compareRightId))
      setMessage('版本差异已生成。')
    } catch (error) {
      setComparison(null)
      setMessage(`版本比较失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function verifyPrompt() {
    if (!testPromptId) return
    setBusy(true)
    try {
      unwrap(await remote.setPromptVerification({ promptId: testPromptId, note: testNote }))
      setTestNote('')
      setTestPromptId('')
      await load()
      setMessage('测试记录已保存，所选版本标记为已验证。')
    } catch (error) {
      setMessage(`保存测试记录失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function toggleArchive(prompt: PromptAsset) {
    setBusy(true)
    try {
      unwrap(await remote.setPromptArchived({ promptId: prompt.id, archived: !prompt.archived }))
      await load()
      setMessage(prompt.archived ? '提示词版本已恢复。' : '提示词版本已归档。')
    } catch (error) {
      setMessage(`更新归档状态失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function removePrompt(prompt: PromptAsset) {
    if (!window.confirm(`永久删除“${prompt.title}”V${prompt.version}？此操作不会删除同组其他版本。`)) return
    setBusy(true)
    try {
      unwrap(await remote.deletePromptAsset({ promptId: prompt.id }))
      await load()
      setMessage('提示词版本已删除。')
    } catch (error) {
      setMessage(`删除提示词版本失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  function editPromptAsNewVersion(prompt: PromptAsset) {
    setPromptBaseId(prompt.id)
    setPromptDraft({ title: prompt.title, text: prompt.text, tags: prompt.tags.join(', '), sourceUrl: prompt.sourceUrl, sourceLicense: prompt.sourceLicense })
  }

  async function saveCase(event: any) {
    event.preventDefault()
    setBusy(true)
    try {
      unwrap(await remote.saveCaseAsset({ caseItem: { ...(caseEditId ? { caseId: caseEditId } : {}), ...caseDraft } }))
      setCaseDraft(emptyCase())
      setCaseEditId('')
      await load()
      setMessage(caseEditId ? '案例已更新并留存版本快照。' : '案例已保存到提示词案例库。')
    } catch (error) {
      setMessage(`保存案例失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  function editCase(item: CaseAsset) {
    setCaseEditId(item.id)
    setCaseDraft({ title: item.title, domain: item.domain, promptText: item.promptText, resultSummary: item.resultSummary, feedback: item.feedback, sourceUrl: item.sourceUrl, sourceLicense: item.sourceLicense, verificationStatus: item.verificationStatus })
  }

  async function removeCase(item: CaseAsset) {
    if (!window.confirm(`永久删除案例“${item.title}”？`)) return
    setBusy(true)
    try {
      unwrap(await remote.deleteCaseAsset({ caseId: item.id }))
      await load()
      setMessage('提示词案例已删除。')
    } catch (error) {
      setMessage(`删除案例失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  const methodDomain: Record<string, string> = { 'method-通用计划': 'general', 'method-写作': 'writing', 'method-PPT': 'ppt' }
  return h('section', { 'aria-label': '提示词与案例资产' },
    h('h2', { style: { fontSize: '17px', margin: 0 } }, '提示词与案例资产'),
    h('div', null,
      h('label', null, '搜索 ', h('input', { value: query, onChange: (event: any) => setQuery(event.target.value), onKeyDown: (event: any) => { if (event.key === 'Enter') void load() } })),
      h('label', null, h('input', { type: 'checkbox', checked: includeArchived, onChange: (event: any) => setIncludeArchived(event.target.checked) }), ' 包含归档版本'),
      h('button', { type: 'button', disabled: busy, onClick: () => void load() }, '读取资产')),
    h('section', { 'aria-label': '方法卡库', 'data-testid': 'method-card-library' }, h('h3', null, '方法卡库'),
      h('p', null, '自建方法卡作为资料库条目保存；如需随提示词发给模型，请到资料库显式选择并预览。'),
      methodCards.map(card => { const domain = methodDomain[card.id] ?? card.domains?.find(value => ['general', 'writing', 'ppt'].includes(value)); return h('details', { key: card.id }, h('summary', null, card.title + ' · ' + (card.builtin ? '内置' : '自建 V' + card.version) + ' · ' + card.verificationStatus), h('p', null, card.summary), h('ol', null, ...card.stages.map((stage, index) => h('li', { key: card.id + '-' + index }, stage))),
        domain ? h('button', { type: 'button', disabled: busy, onClick: () => { onSelectDomain(domain); setMessage('已选择“' + card.title + '”方法卡的适用领域；新任务将使用该领域流程。') } }, '用于新任务领域') : null,
        card.editable ? h('button', { type: 'button', disabled: busy, onClick: () => setMethodDraft({ id: card.id, title: card.title, domain: card.domains?.[0] ?? 'general', summary: card.summary, stages: card.stages.join('\n') }) }, '编辑自建方法卡') : null,
        card.editable && card.history?.length ? h('details', null, h('summary', null, '历史版本（' + card.history.length + '）'), ...card.history.map(item => h('details', { key: card.id + '-v' + item.version }, h('summary', null, 'V' + item.version + ' · ' + item.updatedAt), h('p', null, item.summary), h('ol', null, ...item.stages.map((stage: string, index: number) => h('li', { key: index }, stage)))))) : null,
        card.editable ? h('button', { type: 'button', disabled: busy, onClick: () => void deleteMethodCard(card) }, '删除自建方法卡') : h('p', null, '内置卡为只读；如需调整，请另存为自建方法卡。')) }),
      h('form', { onSubmit: saveMethodCard, 'aria-label': '自建方法卡编辑器' }, h('h4', null, methodDraft.id ? '编辑自建方法卡' : '新建自建方法卡'),
        h('label', null, '名称 ', h('input', { required: true, maxLength: 120, value: methodDraft.title, onChange: (event: any) => setMethodDraft({ ...methodDraft, title: event.target.value }) })),
        h('label', null, '适用领域 ', h('select', { value: methodDraft.domain, onChange: (event: any) => setMethodDraft({ ...methodDraft, domain: event.target.value }) }, ...[['general','通用'],['writing','写作'],['ppt','PPT']].map(([value,label]) => h('option', { key: value, value }, label)))),
        h('label', null, '方法说明 ', h('textarea', { required: true, maxLength: 5000, rows: 3, value: methodDraft.summary, onChange: (event: any) => setMethodDraft({ ...methodDraft, summary: event.target.value }) })),
        h('label', null, '步骤（每行一项，最多 12 项） ', h('textarea', { required: true, maxLength: 3600, rows: 4, value: methodDraft.stages, onChange: (event: any) => setMethodDraft({ ...methodDraft, stages: event.target.value }) })),
        h('button', { type: 'submit', disabled: busy }, methodDraft.id ? '保存方法卡版本' : '保存自建方法卡'),
        methodDraft.id ? h('button', { type: 'button', disabled: busy, onClick: () => setMethodDraft({ id: '', title: '', domain: 'general', summary: '', stages: '' }) }, '取消编辑') : null)),
    h('form', { onSubmit: savePrompt, 'aria-label': '提示词版本编辑器' },
      h('h3', null, promptBaseId ? '编辑并另存新版本' : '新建提示词'),
      h('label', null, '名称 ', h('input', { required: true, maxLength: 200, value: promptDraft.title, onChange: (event: any) => setPromptDraft({ ...promptDraft, title: event.target.value }) })),
      h('label', null, '提示词正文 ', h('textarea', { required: true, maxLength: 100000, rows: 6, value: promptDraft.text, onChange: (event: any) => setPromptDraft({ ...promptDraft, text: event.target.value }) })),
      h('label', null, '标签 ', h('input', { value: promptDraft.tags, onChange: (event: any) => setPromptDraft({ ...promptDraft, tags: event.target.value }) })),
      h('label', null, '来源链接 ', h('input', { type: 'url', value: promptDraft.sourceUrl, onChange: (event: any) => setPromptDraft({ ...promptDraft, sourceUrl: event.target.value }) })),
      h('label', null, '来源许可/说明 ', h('input', { maxLength: 500, value: promptDraft.sourceLicense, onChange: (event: any) => setPromptDraft({ ...promptDraft, sourceLicense: event.target.value }) })),
      h('button', { type: 'submit', disabled: busy }, promptBaseId ? '保存新版本' : '保存提示词')),
    prompts.length ? h('div', null,
      h('section', { 'aria-label': '提示词版本比较' },
        h('h3', null, '比较两个版本'),
        h('label', null, '版本 A ', h('select', { value: compareLeftId, onChange: (event: any) => { setCompareLeftId(event.target.value); setComparison(null) } }, h('option', { value: '' }, '选择版本'), ...prompts.map(item => h('option', { key: item.id, value: item.id }, `${item.title} · V${item.version}${item.archived ? ' · 已归档' : ''}`)))),
        h('label', null, '版本 B ', h('select', { value: compareRightId, onChange: (event: any) => { setCompareRightId(event.target.value); setComparison(null) } }, h('option', { value: '' }, '选择版本'), ...prompts.map(item => h('option', { key: item.id, value: item.id }, `${item.title} · V${item.version}${item.archived ? ' · 已归档' : ''}`)))),
        h('button', { type: 'button', disabled: busy || !compareLeftId || !compareRightId, onClick: compareVersions }, '比较版本'),
        comparison ? h('div', { 'data-testid': 'prompt-version-comparison' },
          h('p', null, `${comparison.left.title} V${comparison.left.version} → ${comparison.right.title} V${comparison.right.version}`),
          ...comparison.unchangedPrefix.map((line: string, index: number) => h('div', { key: `before-${index}` }, `  ${line}`)),
          ...comparison.removed.map((line: string, index: number) => h('div', { key: `removed-${index}`, style: { color: 'var(--dsw-alias-text-danger, #b42318)' } }, `− ${line}`)),
          ...comparison.added.map((line: string, index: number) => h('div', { key: `added-${index}`, style: { color: 'var(--dsw-alias-text-success, #067647)' } }, `+ ${line}`)),
          ...comparison.unchangedSuffix.map((line: string, index: number) => h('div', { key: `after-${index}` }, `  ${line}`))) : null),
      ...prompts.map(prompt => h('article', { key: prompt.id, style: { borderTop: '1px solid var(--dsw-alias-border-secondary)', padding: '8px 0' } },
      h('div', null, h('strong', null, `${prompt.title} · V${prompt.version}`), ` · ${prompt.verificationStatus === 'tested' ? '已验证' : '待测试'}${prompt.archived ? ' · 已归档' : ''}`),
      h('p', null, prompt.tags.join(' · ') || '无标签'),
      prompt.sourceUrl ? h('p', null, h('a', { href: prompt.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, '查看来源'), ` · ${prompt.sourceLicense || '许可待核对'}`) : h('p', null, '未记录外部来源'),
      h('details', null, h('summary', null, '查看正文与同组版本'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, prompt.text),
        ...prompts.filter(item => item.groupId === prompt.groupId).sort((a, b) => a.version - b.version).map(item => h('details', { key: item.id }, h('summary', null, `V${item.version} · ${item.verificationStatus}`), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, item.text)))),
      h('div', null,
        h('button', { type: 'button', disabled: busy, onClick: () => editPromptAsNewVersion(prompt) }, '编辑为新版本'),
        h('button', { type: 'button', disabled: busy, onClick: () => { setTestPromptId(prompt.id); setTestNote(prompt.note ?? '') } }, '记录测试'),
        h('button', { type: 'button', disabled: busy, onClick: () => void toggleArchive(prompt) }, prompt.archived ? '恢复' : '归档'),
        h('button', { type: 'button', disabled: busy, onClick: () => void removePrompt(prompt) }, '删除版本')),
      testPromptId === prompt.id ? h('div', null, h('label', null, '测试案例与结果 ', h('textarea', { rows: 3, value: testNote, onChange: (event: any) => setTestNote(event.target.value) })), h('button', { type: 'button', disabled: busy || !testNote.trim(), onClick: () => void verifyPrompt() }, '确认测试记录'), h('button', { type: 'button', disabled: busy, onClick: () => setTestPromptId('') }, '取消')) : null))) : h('p', null, '暂无提示词资产；点击“读取资产”加载已有记录。'),
    h('form', { onSubmit: saveCase, 'aria-label': '提示词案例编辑器' },
      h('h3', null, caseEditId ? '编辑案例' : '新增案例'),
      h('label', null, '案例名称 ', h('input', { required: true, maxLength: 200, value: caseDraft.title, onChange: (event: any) => setCaseDraft({ ...caseDraft, title: event.target.value }) })),
      h('label', null, '适用领域 ', h('input', { maxLength: 80, value: caseDraft.domain, onChange: (event: any) => setCaseDraft({ ...caseDraft, domain: event.target.value }) })),
      h('label', null, '提示词 ', h('textarea', { required: true, rows: 3, value: caseDraft.promptText, onChange: (event: any) => setCaseDraft({ ...caseDraft, promptText: event.target.value }) })),
      h('label', null, '结果摘要 ', h('textarea', { required: true, rows: 3, value: caseDraft.resultSummary, onChange: (event: any) => setCaseDraft({ ...caseDraft, resultSummary: event.target.value }) })),
      h('label', null, '反馈/测试依据 ', h('textarea', { rows: 2, value: caseDraft.feedback, onChange: (event: any) => setCaseDraft({ ...caseDraft, feedback: event.target.value }) })),
      h('label', null, '来源链接 ', h('input', { type: 'url', value: caseDraft.sourceUrl, onChange: (event: any) => setCaseDraft({ ...caseDraft, sourceUrl: event.target.value }) })),
      h('label', null, '来源许可/说明 ', h('input', { maxLength: 500, value: caseDraft.sourceLicense, onChange: (event: any) => setCaseDraft({ ...caseDraft, sourceLicense: event.target.value }) })),
      h('label', null, '验证状态 ', h('select', { value: caseDraft.verificationStatus, onChange: (event: any) => setCaseDraft({ ...caseDraft, verificationStatus: event.target.value }) }, h('option', { value: 'unverified' }, '待验证'), h('option', { value: 'tested' }, '已测试'))),
      h('button', { type: 'submit', disabled: busy }, caseEditId ? '保存案例版本' : '保存案例'),
      caseEditId ? h('button', { type: 'button', disabled: busy, onClick: () => { setCaseEditId(''); setCaseDraft(emptyCase()) } }, '取消编辑') : null),
    cases.length ? h('ul', null, ...cases.map(item => h('li', { key: item.id }, h('details', null, h('summary', null, `${item.title} · V${item.version} · ${item.verificationStatus}`), h('p', null, `${item.domain || '未分类'} · ${item.sourceLicense || '许可待核对'}`), h('p', null, item.resultSummary), item.sourceUrl ? h('a', { href: item.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, '查看来源') : null), h('button', { type: 'button', disabled: busy, onClick: () => editCase(item) }, '编辑'), h('button', { type: 'button', disabled: busy, onClick: () => void removeCase(item) }, '删除')))) : h('p', null, '暂无提示词案例。'),
    h('p', { role: 'status', 'aria-live': 'polite' }, message))
}
