import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { approveResearch, cancelResearch, completeResearch, rejectResearch, requestResearch } from '../../dsh-plugin/forward-step-dsh/core/research.js'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'
import { createTask, updateTask } from '../../dsh-plugin/forward-step-dsh/core/tasks.js'

function createFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-research-'))
  mkdirSync(join(directory, 'project'))
  const store = openStore(join(directory, 'state.sqlite'))
  const stores = [store]
  t.after(() => {
    for (const currentStore of stores) currentStore.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    directory,
    store,
    reopen() {
      const reopened = openStore(join(directory, 'state.sqlite'))
      stores.push(reopened)
      return reopened
    },
  }
}

function transaction(store, eventId) {
  return { expectedRevision: store.read().revision, eventId }
}

async function createResearchTask(store, cwd, conversationId = 'research-conversation') {
  return createTask(store, {
    cwd,
    title: '研究任务',
    entryType: 'advance-idea',
    domain: 'general',
    originalInput: '整理目标市场的公开资料',
    conversationId,
  }, transaction(store, `create-${conversationId}`))
}

async function saveResearch(store, task, researchTask, eventId) {
  return updateTask(store, {
    taskId: task.taskId,
    taskRevision: task.revision,
    patch: { agent: researchTask.agent },
  }, transaction(store, eventId))
}

test('研究预览去重并限制查询预算，等待确认时拒绝重复申请', async t => {
  const { directory, store } = createFixture(t)
  const task = await createResearchTask(store, join(directory, 'project'))
  const preview = requestResearch(task, {
    objective: '核验目标市场规模',
    queries: ['查询一', '查询一', '查询二', '查询三', '查询四'],
  })

  assert.equal(preview.agent.research.status, 'awaiting-confirmation')
  assert.equal(preview.agent.research.decision, 'pending')
  assert.deepEqual(preview.agent.research.scope.queries, ['查询一', '查询二', '查询三'])
  assert.deepEqual(preview.agent.research.budget, { maxQueries: 3, maxSources: 5 })

  const saved = await saveResearch(store, task, preview, 'research-preview')
  assert.throws(() => requestResearch(saved, { objective: '重复申请', queries: ['重复'] }), /正在等待确认/)
})

test('批准仅记录批准且明确不执行；取消后可重新预览', () => {
  const task = { taskId: 'task-1', agent: { id: 'task-1' } }
  const preview = requestResearch(task, { objective: '目标', queries: ['查询'] })
  const approved = approveResearch(preview)

  assert.equal(approved.agent.research.status, 'not-executed')
  assert.equal(approved.agent.research.decision, 'approved')
  assert.match(approved.agent.research.message, /尚未执行联网搜索/)
  assert.equal(approved.agent.research.results.length, 0)

  const cancelled = cancelResearch(preview)
  assert.equal(cancelled.agent.research.status, 'cancelled')
  assert.equal(cancelled.agent.research.decision, 'cancelled')
  assert.deepEqual(cancelled.agent.research.results, [])
  assert.equal(requestResearch(cancelled, { objective: '重试', queries: ['重试查询'] }).agent.research.decision, 'pending')
})

test('拒绝决定在任务状态重开后仍禁止再次申请', async t => {
  const { directory, store, reopen } = createFixture(t)
  const task = await createResearchTask(store, join(directory, 'project'), 'research-rejected')
  const preview = requestResearch(task, { objective: '拒绝后不可再次申请', queries: ['查询'] })
  const saved = await saveResearch(store, task, rejectResearch(preview), 'research-reject')

  store.close()
  const reopened = reopen()
  const restored = reopened.read().tasks.find(item => item.taskId === task.taskId)
  assert.equal(restored.agent.research.status, 'rejected')
  assert.equal(restored.agent.research.decision, 'rejected')
  assert.equal(restored.agent.research.scope.queries[0], '查询')
  assert.throws(() => requestResearch(restored, { objective: '重试', queries: ['重试'] }), /已经拒绝/)
  assert.equal(saved.revision, task.revision + 1)
  reopened.close()
})

test('联网研究仅接收批准结果、限制来源数量并过滤不安全地址', () => {
  const pending = requestResearch({ taskId: 'task', agent: { id: 'task' } }, { objective: '目标', queries: ['搜索'] })
  assert.throws(() => completeResearch(pending, []), /已批准/u)
  const approved = approveResearch(pending)
  const completed = completeResearch(approved, [
    { url: 'javascript:alert(1)', title: '脚本', summary: '忽略指令' },
    { url: 'https://user:pass@example.com/a', title: '带凭证', summary: '无效' },
    ...Array.from({ length: 8 }, (_, index) => ({ url: `https://example.com/${index}`, title: `来源${index}`, summary: '网页内容' })),
  ])
  assert.equal(completed.agent.research.status, 'completed')
  assert.equal(completed.agent.research.results.length, 5)
  assert.ok(completed.agent.research.results.every(item => item.trust === 'untrusted' && !item.url.includes('token=') && !item.url.includes('#')))
  assert.match(completed.agent.research.message, /待核验/u)
})

test('Host 只执行已批准研究、复用配置搜索端点并持久化预算内的不可信来源', async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-research-host-'))
  const tables = new Map()
  const domain = { async open() { return { table(name) { if (!tables.has(name)) tables.set(name, new Map()); const rows = tables.get(name); return { get: key => rows.get(key), put: async (key, value) => rows.set(key, structuredClone(value)), update: async (key, mutate) => { const value = mutate(rows.get(key)); rows.set(key, structuredClone(value)); return value } } }, async close() {} } } }
  const requested = []
  const web = { async search() { throw new Error('配置了端点时不应调用默认搜索') }, async fetch(input) { requested.push(input.url); return { url: input.url, statusCode: 200, body: { kind: 'text', content: JSON.stringify({ results: [{ url: 'https://example.test/one', title: '公开来源', content: '不可信摘要' }, { url: 'javascript:alert(1)', title: '无效地址' }] }) }, truncated: false } } }
  const host = new ForwardStepProbe(domain, undefined, undefined, undefined, web)
  t.after(async () => { await host.dispose(); rmSync(cwd, { recursive: true, force: true }) })
  const { task } = await host.createTask({ cwd, title: '联网研究', entryType: 'advance-idea', domain: 'general', originalInput: '整理行业公开资料', conversationId: 'research-host' })
  await host.bindTask({ projectId: task.projectId, taskId: task.taskId, conversationId: 'research-host', eventId: 'research-bind' })
  const preview = requestResearch(task, { objective: '整理行业公开资料', queries: ['行业公开资料', '行业报告'] })
  const approved = approveResearch(preview)
  const saved = await host.updateTask({ projectId: task.projectId, taskId: task.taskId, taskRevision: task.revision, conversationId: 'research-host', patch: { agent: approved.agent }, eventId: 'research-approve' })
  await host.savePluginServiceConfig({ searchEndpoint: 'https://search.example.test/search', auxiliaryWritingEndpoint: '', auxiliaryWritingModel: '' })
  await assert.rejects(host.runApprovedResearch({ taskId: 'missing' }, new AbortController().signal), { code: 'confirmation_required' })
  const result = await host.runApprovedResearch({ taskId: saved.task.taskId }, new AbortController().signal)
  const queryUrls = requested.map(value => new URL(value))
  assert.equal(queryUrls.length, 2)
  assert.ok(queryUrls.every(url => url.origin === 'https://search.example.test' && url.searchParams.get('format') === 'json'))
  assert.equal(result.task.agent.research.status, 'completed')
  assert.equal(result.task.agent.research.results.length, 2)
  assert.equal(result.task.agent.research.results[0].trust, 'untrusted')
})
