import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pluginRoot = resolve(process.cwd(), 'dsh-plugin/forward-step-dsh')
const [domainApi, domainSpecModule, storeModule, zodModule] = await Promise.all([ 
  import(pathToFileURL(resolve(pluginRoot, 'node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js')).href),
  import(pathToFileURL(resolve(pluginRoot, 'lib/storage-domain.js')).href),
  import(pathToFileURL(resolve(pluginRoot, 'core/store.js')).href),
  import(pathToFileURL(resolve(pluginRoot, 'node_modules/zod/index.js')).href),
])
const { z } = zodModule

function createFixture(t, durableTables = new Map()) {
  let failNextWrite = false
  let closeCount = 0
  const unit = {
    async loadAll() {
      const tables = Object.fromEntries([...durableTables].map(([name, records]) => [
        name,
        Object.fromEntries([...records].map(([key, value]) => [key, structuredClone(value)])),
      ]))
      return { tables }
    },
    async putRecord(table, key, value) {
      if (failNextWrite) {
        failNextWrite = false
        throw new Error('injected durable write failure')
      }
      if (!durableTables.has(table)) durableTables.set(table, new Map())
      durableTables.get(table).set(key, structuredClone(value))
    },
    async deleteRecord(table, key) {
      return durableTables.get(table)?.delete(key) ?? false
    },
    async close() { closeCount += 1 },
  }
  const facility = new domainApi.DomainFacility({
    storage: {
      backend: {
        get(name) {
          assert.equal(name, 'forward-step-test-memory')
          return { kv: { open: async () => unit } }
        },
      },
    },
    emit() {},
    logger: { warn() {}, error() {} },
  }, { backend: 'forward-step-test-memory' })

  const openStore = async () => {
    const domain = await facility.open(domainSpecModule.forwardStepDomainSpec)
    const store = storeModule.createDomainStore(domain)
    await store.initialize()
    return store
  }
  const close = async store => {
    if (store) await store.close()
  }
  t.after(async () => {
    await facility.closeAll()
  })
  return {
    durableTables,
    openStore,
    close,
    failNextWrite() { failNextWrite = true },
    get closeCount() { return closeCount },
  }
}

test('生产 Storage Domain 适配器原子提交、冲突、幂等并可重开读取', async t => {
  const fixture = createFixture(t)
  const store = await fixture.openStore()
  let mutateCalls = 0

  await store.transact(0, 'task-result', state => {
    mutateCalls += 1
    state.tasks.push({ taskId: 'task-a', versions: [{ content: '已保存结果' }] })
  })
  const competing = await Promise.allSettled([
    store.transact(1, 'edit-a', state => state.tasks[0].versions.push({ content: '版本 A' })),
    store.transact(1, 'edit-b', state => state.tasks[0].versions.push({ content: '版本 B' })),
  ])
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1)
  const conflict = competing.find(result => result.status === 'rejected')
  assert.equal(conflict.reason.code, 'conflict')

  const committed = store.read()
  await store.transact(0, 'task-result', () => { mutateCalls += 1 })
  assert.equal(mutateCalls, 1, '重复 eventId 不应再次执行 mutate')
  assert.equal(store.read().revision, committed.revision)
  await fixture.close(store)

  const reopened = createFixture(t, fixture.durableTables)
  const restoredStore = await reopened.openStore()
  assert.deepEqual(restoredStore.read(), committed)
  await reopened.close(restoredStore)
  assert.ok(fixture.closeCount >= 1)
})

test('生产 Storage Domain 适配器在 mutation 与持久化写失败时不泄漏部分状态', async t => {
  const fixture = createFixture(t)
  const store = await fixture.openStore()
  const before = store.read()

  await assert.rejects(store.transact(before.revision, 'callback-failure', state => {
    state.tasks.push({ taskId: 'partial-callback' })
    state.changes.push({ eventId: 'partial-callback' })
    throw new Error('injected mutation failure')
  }), { code: 'storage_failure' })
  assert.deepEqual(store.read(), before)

  fixture.failNextWrite()
  await assert.rejects(store.transact(before.revision, 'backend-failure', state => {
    state.tasks.push({ taskId: 'partial-durable' })
    state.changes.push({ eventId: 'partial-durable' })
  }), { code: 'storage_failure' })
  assert.deepEqual(store.read(), before)
  assert.deepEqual(fixture.durableTables.get('state').get('current'), before)
  await fixture.close(store)
})

test('DSH Storage Domain 保留迁移、资料、学术、社媒和写作新增集合', async t => {
  const fixture = createFixture(t)
  let store = await fixture.openStore()
  await store.transact(0, 'feature-state', state => {
    state.knowledgeEntries.push({ id: 'knowledge-1' })
    state.academicResponseProjects.push({ id: 'academic-1' })
    state.researchTasks.push({ id: 'research-1' })
    state.writingArticles.push({ id: 'writing-1' })
    state.importReceipts.push({ receiptId: 'receipt-1' })
  })
  await fixture.close(store)
  store = await fixture.openStore()
  const state = store.read()
  assert.equal(state.knowledgeEntries[0].id, 'knowledge-1')
  assert.equal(state.academicResponseProjects[0].id, 'academic-1')
  assert.equal(state.researchTasks[0].id, 'research-1')
  assert.equal(state.writingArticles[0].id, 'writing-1')
  assert.equal(state.importReceipts[0].receiptId, 'receipt-1')
  await fixture.close(store)
})


test('Storage Domain 事务保留可识别的导入业务错误码并回滚', async t => {
  const fixture = createFixture(t)
  const store = await fixture.openStore()
  const before = store.read()
  await assert.rejects(store.transact(before.revision, 'domain-business-error', state => {
    state.projects.push({ id: 'must-roll-back' })
    throw Object.assign(new Error('duplicate content target'), { code: 'ambiguous_duplicate_content' })
  }), { code: 'ambiguous_duplicate_content' })
  assert.deepEqual(store.read(), before)
  await fixture.close(store)
})
test('插件 Storage Domain 与同一后端的其它域按域名隔离', async t => {
  const recordsByDomain = new Map()
  const unitByDomain = new Map()
  const facility = new domainApi.DomainFacility({
    storage: {
      backend: {
        get(name) {
          assert.equal(name, 'forward-step-test-memory')
          return { kv: { open: async descriptor => {
            const domainName = descriptor.name
            if (!recordsByDomain.has(domainName)) recordsByDomain.set(domainName, new Map())
            const records = recordsByDomain.get(domainName)
            if (!unitByDomain.has(domainName)) unitByDomain.set(domainName, {
              async loadAll() {
                return { tables: Object.fromEntries([...records].map(([table, values]) => [table, Object.fromEntries(values)])) }
              },
              async putRecord(table, key, value) {
                if (!records.has(table)) records.set(table, new Map())
                records.get(table).set(key, structuredClone(value))
              },
              async deleteRecord(table, key) { return records.get(table)?.delete(key) ?? false },
              async close() {},
            })
            return unitByDomain.get(domainName)
          } } }
        },
      },
    },
    emit() {},
    logger: { warn() {}, error() {} },
  }, { backend: 'forward-step-test-memory' })
  t.after(() => facility.closeAll())

  const unrelatedSpec = domainApi.defineDomain({
    name: 'unrelated_application_domain',
    version: 1,
    layout: 'single',
    tables: { state: domainApi.domainTable(z.object({ marker: z.string() })) },
  })
  const pluginDomain = await facility.open(domainSpecModule.forwardStepDomainSpec)
  const unrelatedDomain = await facility.open(unrelatedSpec)
  const pluginStore = storeModule.createDomainStore(pluginDomain)
  await pluginStore.initialize()

  await pluginStore.transact(0, 'plugin-only', state => { state.projects.push({ id: 'plugin-record' }) })
  await unrelatedDomain.table('state').put('current', { marker: 'unrelated-record' })

  assert.deepEqual(pluginStore.read().projects, [{ id: 'plugin-record' }])
  assert.deepEqual(unrelatedDomain.table('state').get('current'), { marker: 'unrelated-record' })
  assert.notEqual(domainSpecModule.forwardStepDomainSpec.name, unrelatedSpec.name)
  assert.deepEqual([...recordsByDomain.keys()].sort(), ['forward_step_dsh_tasks', 'unrelated_application_domain'])
})

