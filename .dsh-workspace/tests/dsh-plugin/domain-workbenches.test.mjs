import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ForwardStepProbe } from '../../dsh-plugin/forward-step-dsh/lib/host-service.js'
import { apply as applyForwardStepPlugin } from '../../dsh-plugin/forward-step-dsh/index.js'

function createStorageDomain({ beforeUpdate } = {}) {
  const tables = new Map()
  return {
    async open() {
      return {
        table(name) {
          if (!tables.has(name)) tables.set(name, new Map())
          const rows = tables.get(name)
          return {
            get: key => rows.get(key),
            put: async (key, value) => rows.set(key, structuredClone(value)),
            update: async (key, mutate) => {
              const value = mutate(rows.get(key))
              beforeUpdate?.({ name, key, value: structuredClone(value) })
              rows.set(key, structuredClone(value))
              return value
            },
          }
        },
        async close() {},
      }
    },
  }
}

test('社媒面板提供真实计划动作且明确运行采集控制边界', async () => {
  const source = await readFile(new URL('../../dsh-plugin/forward-step-dsh/src/client/domain-workbenches-panel.ts', import.meta.url), 'utf8')
  assert.match(source, /searchConfirmedSocialPlan\(task: SocialTask\)/u)
  assert.match(source, /setSocialAvailability\(unwrap\(availability\)\.platforms\)/u, '初次加载必须应用实际读取到的平台状态')
  assert.match(source, /renderSocialPlatformRunReceipts\(task\)/u, '社媒任务应显示平台运行收据')
  assert.match(source, /retryOf\?: string/u, '运行收据应暴露重试来源字段')
  assert.match(source, /重试自 \$\{receipt\.retryOf\.slice\(0, 8\)\}/u, '运行收据应显示前次尝试的短 ID')
  assert.match(source, /runRequested[\s\S]*?remote\.listSocialResearchTasks\(\)/u, '采集取消或失败后应刷新已持久化收据')
  assert.match(source, /async function refreshSocialAvailability\(\)[\s\S]*?remote\.listSocialPlatformAvailability\(\)[\s\S]*?setSocialAvailability/u, '用户可重新读取 Host 当前能力/授权状态')
  assert.match(source, /async function runAuthorizedPlatform[\s\S]*?remote\.listSocialPlatformAvailability\(\)[\s\S]*?availability\?\.canRun[\s\S]*?remote\.runAuthorizedSocialResearch/u, '每次授权采集前必须刷新 Host 授权状态，刷新失败或权限撤销时不得调用采集器')
  assert.match(source, /if \(usedRequests >= maxRequests\)[\s\S]*?未发起平台采集/u, '授权采集在请求预算耗尽时必须在调用前停止')
  assert.match(source, /budgetAvailable && socialAvailability\.some/u, '失败平台重试入口必须同时受剩余预算和平台能力约束')
  assert.match(source, /async function runAuthorizedPlatform[\s\S]*?activeSocialSearch\.current = \{ taskId: task\.id, controller, done, operation: 'authorized-platform-collection' \}[\s\S]*?remote\.listSocialPlatformAvailability\(\)[\s\S]*?controller\.signal\.aborted[\s\S]*?globalThis\.confirm[\s\S]*?controller\.signal\.aborted[\s\S]*?remote\.runAuthorizedSocialResearch/u, '授权刷新前先占用运行锁，刷新/确认阶段收到取消后不得启动采集')
  assert.match(source, /刷新 Host 平台状态/u)
  assert.match(source, /profile 已配置不代表当前仍登录/u, '确认提示必须区分 profile 配置和实时登录状态')
  assert.match(source, /没有返回结果；请检查 DSH Browser 当前登录状态/u, '零结果不能被显示为采集成功')
  assert.match(source, /执行已确认计划公开搜索/u)
  assert.match(source, /remote\.searchConfirmedSocialPublicPlan\([\s\S]*?controller\.signal/u)
  assert.match(source, /applySocialTaskAction\(task\.id, 'pause'\)/u)
  assert.match(source, /applySocialTaskAction\(task\.id, 'resume'\)/u)
  assert.match(source, /applySocialTaskAction\(task\.id, 'cancel'\)/u)
  assert.match(source, /applySocialTaskAction\(task\.id, 'skip-platform', item\.platform\)/u)
  assert.match(source, /已跳过 \$\{platform\} 的失败记录；该平台不计为采集成功/u, '跳过后的文案不能把 skipped 状态说成仍然失败')
  assert.match(source, /operation === 'authorized-platform-collection' \? '取消当前平台采集' : '取消公开搜索'/u, '运行中的授权采集和公开搜索应显示准确的中止动作')
  assert.match(source, /await activeSearch\.done/u, '暂停或取消任务等待当前操作及检查点写入收尾后再更新状态')
  assert.match(source, /action === 'pause' && activeSocialSearch\.current\?\.taskId === taskId[\s\S]*?activeSearch\.controller\.abort[\s\S]*?await activeSearch\.done/u, '暂停运行中任务先取消当前操作并等待检查点收尾')
  assert.match(source, /暂停当前操作并保留检查点/u)
  assert.match(source, /当前操作已中止并保存已完成检查点/u)
  assert.match(source, /activeSocialTaskActions\.current\.has\(taskId\)[\s\S]*?activeSocialTaskActions\.current\.add\(taskId\)[\s\S]*?activeSocialTaskActions\.current\.delete\(taskId\)/u, '同一任务的重复控制请求必须串行化')
  assert.ok(source.includes('已保留 ${completed} 次成功、${failed} 次失败的检查点'), '取消结果应准确说明已保存的部分搜索结果')
  assert.match(source, /fetchSocialPublicSource/u)
  assert.match(source, /generateSocialResearchReport\(\{ taskId: selectedSocialTask\.id, resultIds, provider, model \}, controller\.signal\)/u)
  assert.match(source, /取消报告生成/u)
  assert.match(source, /action === 'cancel' && activeSocialReport\.current\?\.taskId === taskId[\s\S]*?controller\.abort/u, '取消任务必须中止同一任务的报告生成')
  assert.match(source, /研究预算（创建后随计划保存）/u)
  assert.match(source, /待确认社媒计划摘要/u, '待确认计划应显示可核对的摘要')
  assert.match(source, /task\.queries\.map\(\(query, index\) => h\('li'/u, '确认前应逐条列出实际查询')
  assert.match(source, /已归档附件（未确认发送）/u, '确认前应列出附件并明确未确认外发')
  assert.match(source, /全任务最多 \$\{task\.budget\?\.maxSourceRequests/u, '确认前应展示完整请求预算')
  assert.match(source, /复制为新计划并重新设预算/u, '已耗尽计划需提供显式新建后续计划入口')
  assert.match(source, /setTopic\(task\.topic\)[\s\S]*?setSelectedPlatforms\(supportedPlatforms\)[\s\S]*?未复制历史\/不支持平台/u, '后续计划复制活动支持的平台，并提示未复制的历史平台')
  assert.match(source, /social-research-plan-form[\s\S]*?scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/u, '复制后续计划后应滚动到新计划表单')
  assert.match(source, /maxQueriesPerPlatform: socialMaxQueries/u)
  assert.match(source, /selectedPlatforms\.length > socialMaxPlatforms/u)
  assert.match(source, /disabled: busy && activeSocialSearchTaskId !== task\.id, onClick: \(\) => void applySocialTaskAction\(task\.id, 'cancel'\)/u, '来源操作进行时仍允许取消整项任务')
  assert.match(source, /确认加入页面摘录/u)
  assert.match(source, /retrySocialAttachmentRecovery\(taskId: string\)/u)
  assert.match(source, /立即重试附件恢复/u)
  assert.match(source, /从任务移除待恢复附件/u)
  assert.match(source, /Host 列表读取会校验并幂等重试待恢复附件/u)
  assert.match(source, /\(action === 'pause' \|\| action === 'cancel'\) && activeSocialSearch\.current\?\.taskId === taskId[\s\S]*?controller\.abort/u, '暂停或取消研究任务必须中止当前操作')
  assert.match(source, /setSocialCandidatePreview\(current => current\?\.taskId === taskId \? null : current\)/u, '取消任务清理未保存的来源预览')
  assert.match(source, /requestsExhausted =/u, '公开搜索重试使用任务总请求预算')
  assert.match(source, /已用 \$\{usedRequests\}\/\$\{maxRequests\} 次请求，剩余/u, '确认弹窗展示剩余请求预算')
  assert.match(source, /不发送已保存的 \$\{task\.results\?\.length/u, '确认弹窗说明本次材料范围')
  assert.match(source, /querySummary = task\.queries\.map/u, '授权采集确认弹窗必须逐条展示实际查询')
  assert.match(source, /attachmentSummary = task\.attachments/u, '授权采集确认弹窗必须列出不会发送的已归档附件')
  assert.match(source, /只发送上述搜索查询/u)
  assert.match(source, /remote\.searchSocialPublicSources\([\s\S]*?controller\.signal/u)
  assert.match(source, /确认并重试：\$\{item\.platform\}/u, '失败平台应在 Host 能力可运行时提供独立重试入口')
  assert.match(source, /待准备计划已暂停；当前没有正在运行的采集/u)
  assert.match(source, /计划已恢复到平台准备状态；不会自动开始采集/u)
  assert.match(source, /selectedSocialTask\?\.id === task\.id && task\.results\?\.length/u, '结果选择仅作用于当前任务，避免跨任务串用 ID')
  const hostSource = await readFile(new URL('../../dsh-plugin/forward-step-dsh/src/host-service.ts', import.meta.url), 'utf8')
  assert.match(hostSource, /@Remote\('applySocialResearchTaskAction'\)/u)
})

test('学术面板提供题录筛选、提取确认、引用核对和审稿准备入口', async () => {
  const source = await readFile(new URL('../../dsh-plugin/forward-step-dsh/src/client/domain-workbenches-panel.ts', import.meta.url), 'utf8')
  assert.match(source, /applyAction\('confirmExtractionValue'/u)
  assert.match(source, /makePrompt\('citation-check', \[claim\.id\]\)/u)
  assert.match(source, /makePrompt\('submission-prep', \[item\.id\]\)/u)
  assert.match(source, /screeningModel\?: 'single-reviewer' \| 'two-reviewers'/u)
  assert.match(source, /导入 RIS \/ BibTeX 题录/u)
  assert.match(source, /确认全文纳入/u)
  assert.match(source, /保存待核对证据提取/u)
  assert.match(source, /保存逐条审稿意见/u)
  assert.match(source, /保存结果与资料关联/u)
  assert.match(source, /生成所选结果的报告提示词/u)
  assert.match(source, /beginSocialResearchAttachmentDownload/u)
  assert.match(source, /readSocialResearchAttachmentChunk/u)
  assert.match(source, /finishSocialResearchAttachmentDownload/u)
  assert.match(source, /下载已校验附件/u)
  assert.match(source, /从任务移除附件/u)
  assert.match(source, /从任务移除来源/u)
  assert.match(source, /DSH Host 附件存储中的内容对象会保留/u)
  assert.match(source, /取消附件下载/u)
  assert.match(source, /remote\.readSocialResearchAttachmentChunk\([\s\S]*?controller\.signal/u)
  assert.match(source, /beginSocialAttachmentUpload/u)
  assert.match(source, /appendSocialAttachmentChunk/u)
  assert.match(source, /保存附件到插件备份/u)
  assert.match(source, /recoveryAttachments\?\.length/u)
  assert.match(source, /尚未完成存储读回校验/u)
  assert.match(source, /存储读回待恢复/u)
  assert.match(source, /待恢复附件会单独标示/u)
  assert.match(source, /报告提示词（可编辑；修改后另存新版本，不会自动发送）/u)
  assert.match(source, /保存编辑并另存新版本/u)
  assert.match(source, /socialReportPrompt === savedSocialReportPrompt/u, '未修改提示词时应禁用另存操作')
  assert.match(source, /remote\.saveSocialResearchReportPrompt/u)
  assert.match(source, /重跑报告提示词（保存新版本）/u)
  assert.match(source, /按此版本的来源重新生成提示词/u)
  assert.match(source, /按此版本的来源重新生成报告/u)
  assert.match(source, /social-report-output/u)
  assert.match(source, /makeSocialReportPrompt\(run\.resultIds\)/u, '历史报告可按原来源集合重新生成提示词版本')
  assert.match(source, /social-report-run-history/u)
  assert.match(source, /历史报告提示词版本/u, '应能读取并选择已保存的报告提示词版本')
  assert.match(source, /setSocialReportPrompt\(task\.reportRuns\?\.at\(-1\)\?\.prompt \?\? ''\)/u, '切换任务时应恢复该任务最新报告提示词')
  assert.match(source, /setSocialReportPrompt\(run\.prompt\)/u, '版本选择只切换已保存提示词预览')
  assert.match(source, /用户选择的社媒结果/u)
  assert.match(source, /关联已保存资料/u)
  assert.match(source, /未启动平台采集/u)
})

test('Host 学术工作区创建/更新经领域规范化并可读回', async () => {
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null)
  try {
    const created = await host.createAcademicWorkspace({ kind: 'review', title: 'Synthetic review', question: 'What changed?', scope: 'Public studies', reviewType: 'narrative-review', screeningModel: 'two-reviewers' })
    assert.equal(created.project.workspaceKind, 'review')
    assert.equal(created.project.screeningModel, 'two-reviewers')
    assert.equal((await host.listAcademicWorkspaces()).projects[0].screeningModel, 'two-reviewers')
    const changed = await host.saveAcademicWorkspace({ project: { ...created.project, title: 'Updated review' } })
    assert.equal(changed.project.title, 'Updated review')
    assert.equal((await host.listAcademicWorkspaces()).projects.length, 1)
    await assert.rejects(host.saveAcademicWorkspace({ project: { id: 'bad', workspaceKind: 'other' } }), { code: 'invalid_input' })
  } finally { await host.dispose() }
})

test('Host 学术题录、筛选证据及提示词动作可往返保存', async () => {
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null)
  try {
    const content = 'TY  - JOUR\nTI  - Synthetic evidence\nAB  - User excerpt\nDO  - 10.1000/synthetic\nN1  - Preserve me\nER  -'
    const preview = await host.previewAcademicBibliography({ text: content, format: 'ris' })
    assert.equal(preview.preview.entries.length, 1)
    assert.equal(preview.preview.unknownFields[0].field, 'N1')
    const imported = await host.importAcademicBibliography({ entries: preview.preview.entries })
    assert.equal(imported.entries[0].literature.importedFields.N1[0], 'Preserve me')

    const created = await host.createAcademicWorkspace({ kind: 'review', title: 'Review', question: 'Question?', scope: 'Scope', reviewType: 'narrative-review' })
    const entryId = imported.entries[0].id
    const added = await host.applyAcademicWorkspaceAction({ projectId: created.project.id, action: 'addLiteratureRecords', args: [[entryId]] })
    const record = added.project.records[0]
    assert.equal(record.snapshot.title, 'Synthetic evidence')
    await host.applyAcademicWorkspaceAction({ projectId: created.project.id, action: 'setNarrativeSelection', args: [record.id, true] })
    await host.applyAcademicWorkspaceAction({ projectId: created.project.id, action: 'updateExtractionFields', args: [[{ id: 'finding', label: 'Finding' }]] })
    const extracted = await host.applyAcademicWorkspaceAction({ projectId: created.project.id, action: 'setExtractionValue', args: [record.id, 'finding', { value: 'Finding', evidence: 'Quoted passage', sourceLocation: 'page 3', confirmed: true }] })
    assert.equal(extracted.project.records[0].extraction.finding.sourceLocation, 'page 3')
    const prompt = await host.buildAcademicPrompt({ projectId: created.project.id, kind: 'review-extraction', ids: [record.id] })
    assert.match(prompt.prompt, /User excerpt/u)
    assert.equal((await host.listAcademicWorkspaces()).literature.length, 1)
  } finally { await host.dispose() }
})

test('Host 投稿要求和逐条审稿回复动作保留轮次及稿件改动证据', async () => {
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null)
  try {
    const created = await host.createAcademicWorkspace({ kind: 'publishing', title: 'Submission', venue: 'Journal X' })
    await host.applyAcademicWorkspaceAction({ projectId: created.project.id, action: 'addRequirementCard', args: [{ id: 'req-1', title: 'Ethics', body: 'Provide ethics statement', sourceUrl: 'https://example.invalid/policy', sourceLocator: 'Ethics section' }] })
    await host.applyAcademicWorkspaceAction({ projectId: created.project.id, action: 'addChecklistItem', args: [{ id: 'check-1', title: 'Ethics statement', requirementId: 'req-1' }] })
    await host.applyAcademicWorkspaceAction({ projectId: created.project.id, action: 'addReviewerRound', args: [{ id: 'round-1', title: 'Round 1' }] })
    await host.applyAcademicWorkspaceAction({ projectId: created.project.id, action: 'addReviewerComment', args: ['round-1', { id: 'comment-1', reviewer: 'Reviewer 1', rawComment: 'Clarify the method.' }] })
    const result = await host.applyAcademicWorkspaceAction({ projectId: created.project.id, action: 'resolveReviewerComment', args: ['round-1', 'comment-1', { status: 'revised', responseDraft: 'Clarified.', changeSummary: 'Added method detail.', changeLocation: 'page 4' }] })
    assert.equal(result.project.requirements[0].sourceLocator, 'Ethics section')
    assert.equal(result.project.checklist[0].requirementId, 'req-1')
    assert.equal(result.project.reviewerRounds[0].comments[0].changeLocation, 'page 4')
    const prompt = await host.buildAcademicPrompt({ projectId: created.project.id, kind: 'reviewer-response', ids: ['comment-1'] })
    assert.match(prompt.prompt, /Added method detail/u)
  } finally { await host.dispose() }
})

test('Host 社媒计划先显式确认，确认后也只进入待准备状态', async () => {
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null)
  try {
    const created = await host.createSocialResearchPlan({ topic: 'Synthetic topic', platforms: ['weibo'], queries: ['query one'], budget: { maxPlatforms: 2, maxQueriesPerPlatform: 1, maxSourceRequests: 7 } })
    assert.equal(created.task.status, 'awaiting-plan-confirmation')
    assert.deepEqual(created.task.budget, { maxPlatforms: 2, maxQueriesPerPlatform: 1, maxResultsPerQuery: 20, maxPages: 24, maxDetails: 10, maxDurationMs: 600000, maxAttachmentBytes: 25 * 1024 * 1024, maxAnalysisTokens: 10000, maxSourceRequests: 7 })
    assert.deepEqual((await host.listSocialResearchTasks()).tasks[0].budget, created.task.budget, '用户预算应在重载后保持')
    assert.equal((await host.listSocialResearchTasks()).tasks.length, 1)
    const confirmed = await host.confirmSocialResearchPlan({ taskId: created.task.id })
    assert.equal(confirmed.task.status, 'awaiting-platform-preparation')
    assert.deepEqual(confirmed.task.platformResults, [])
    await assert.rejects(host.confirmSocialResearchPlan({ taskId: 'missing' }), { code: 'not_found' })
    const pending = await host.createSocialResearchPlan({ topic: 'Second topic', platforms: ['zhihu'], queries: ['query two'] })
    const rejected = await host.rejectSocialResearchPlan({ taskId: pending.task.id, reason: 'not needed' })
    assert.equal(rejected.task.status, 'cancelled')
    assert.equal(rejected.task.rejectionReason, 'not needed')
  } finally { await host.dispose() }
})


test('Host 社媒任务控制动作持久化暂停、恢复与取消', async () => {
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null)
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'Control topic', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const paused = await host.applySocialResearchTaskAction({ taskId: plan.task.id, action: 'pause' })
    assert.equal(paused.task.status, 'paused')
    assert.equal((await host.listSocialResearchTasks()).tasks.find(item => item.id === plan.task.id).status, 'paused')
    const resumed = await host.applySocialResearchTaskAction({ taskId: plan.task.id, action: 'resume' })
    assert.equal(resumed.task.status, 'awaiting-platform-preparation')
    const pending = await host.createSocialResearchPlan({ topic: 'Cancel topic', platforms: ['weibo'], queries: ['query'] })
    const cancelled = await host.applySocialResearchTaskAction({ taskId: pending.task.id, action: 'cancel' })
    assert.equal(cancelled.task.status, 'cancelled')
    assert.equal((await host.listSocialResearchTasks()).tasks.find(item => item.id === pending.task.id).status, 'cancelled')
    await assert.rejects(host.applySocialResearchTaskAction({ taskId: 'missing', action: 'pause' }), { code: 'not_found' })
  } finally { await host.dispose() }
})

test('Host 重启后首次读取任务会持久化恢复遗留采集收据', async () => {
  const storage = createStorageDomain()
  let signalStarted
  const adapterStarted = new Promise(resolve => { signalStarted = resolve })
  const controller = new AbortController()
  const socialResearch = {
    async getPlatformState() {
      return {
        capabilities: [{ platform: 'weibo', status: 'verified', verified: true }],
        connections: { weibo: { status: 'ready', authorized: true } },
      }
    },
    async collectPlatform() {
      signalStarted()
      return new Promise((resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }))
    },
  }
  const host = new ForwardStepProbe(storage, { create: async () => { throw new Error('unused') } }, null, undefined, undefined, socialResearch)
  let restarted
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'Recovery topic', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const running = host.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: true, platforms: ['weibo'] }, controller.signal)
    await adapterStarted

    const active = (await host.listSocialResearchTasks()).tasks.find(task => task.id === plan.task.id)
    assert.equal(active.platformRunReceipts.at(-1).status, 'running', '当前 Host 仍持有运行任务时不可误标中断')

    restarted = new ForwardStepProbe(storage, { create: async () => { throw new Error('unused') } }, null)
    const recovered = (await restarted.listSocialResearchTasks()).tasks.find(task => task.id === plan.task.id)
    assert.equal(recovered.platformRunReceipts.at(-1).status, 'interrupted')
    assert.equal((await restarted.listSocialResearchTasks()).tasks.find(task => task.id === plan.task.id).platformRunReceipts.at(-1).status, 'interrupted', '恢复结果必须写回 Host 持久存储')

    controller.abort(Object.assign(new Error('模拟宿主退出'), { code: 'cancelled' }))
    await assert.rejects(running, { code: 'cancelled' })
  } finally {
    controller.abort()
    await restarted?.dispose()
    await host.dispose()
  }
})

test('Host 深读社媒搜索候选只返回不可信预览，不会自动保存', async () => {
  const requested = []
  const web = {
    async search() { return { sources: [{ url: 'https://weibo.com/post/1', title: '公开帖子', snippet: '搜索摘要' }], truncated: false } },
    async fetch(input) {
      requested.push(input.url)
      return { url: input.url, statusCode: 200, body: { kind: 'html', content: '<h1>正文标题</h1><script>恶意脚本内容</script><p>可核验正文摘录</p>' }, truncated: false }
    },
  }
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null, undefined, web)
  try {
    const plan = await host.createSocialResearchPlan({ topic: '公开页面深读', platforms: ['weibo'], queries: ['关键词'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const search = await host.searchSocialPublicSources({ taskId: plan.task.id, platform: 'weibo', query: '关键词', confirmed: true }, new AbortController().signal)
    const candidate = search.run.candidates[0]
    await assert.rejects(host.fetchSocialPublicSource({ taskId: plan.task.id, platform: 'weibo', sourceUrl: candidate.sourceUrl, confirmed: false }, new AbortController().signal), { code: 'confirmation_required' })
    await assert.rejects(host.fetchSocialPublicSource({ taskId: plan.task.id, platform: 'weibo', sourceUrl: 'https://example.com/post', confirmed: true }, new AbortController().signal), { code: 'unsupported_platform' })
    const preview = await host.fetchSocialPublicSource({ taskId: plan.task.id, platform: 'weibo', sourceUrl: candidate.sourceUrl, confirmed: true }, new AbortController().signal)
    assert.equal(preview.candidateId, candidate.id)
    assert.equal(preview.trust, 'untrusted')
    assert.equal(preview.selected, false)
    assert.match(preview.excerpt, /可核验正文摘录/u)
    assert.doesNotMatch(preview.excerpt, /恶意脚本内容/u)
    assert.deepEqual(requested, [candidate.sourceUrl])
    assert.equal((await host.listSocialResearchTasks()).tasks[0].results.length, 0, '预览必须经用户确认保存后才写入研究结果')
  } finally { await host.dispose() }
})
test('Host 社媒公开搜索复用配置的 SearXNG 端点', async () => {
  let requestedUrl
  const web = {
    async search() { throw new Error('配置端点时不得回退到 WebRuntime.search') },
    async fetch(input) {
      requestedUrl = input.url
      return { url: input.url, statusCode: 200, body: { kind: 'text', content: JSON.stringify({ results: [
        { url: 'https://weibo.com/post/2', title: '公开讨论', content: '可核验摘要' },
      ] }) }, truncated: false }
    },
  }
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null, undefined, web)
  try {
    await host.savePluginServiceConfig({ searchEndpoint: 'https://search.example.test/search', auxiliaryWritingEndpoint: '', auxiliaryWritingModel: '' })
    const plan = await host.createSocialResearchPlan({ topic: '公开讨论', platforms: ['weibo'], queries: ['行业趋势'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const result = await host.searchSocialPublicSources({ taskId: plan.task.id, platform: 'weibo', query: '行业趋势', confirmed: true }, new AbortController().signal)
    const url = new URL(requestedUrl)
    assert.equal(url.origin + url.pathname, 'https://search.example.test/search')
    assert.match(url.searchParams.get('q'), /site:weibo\.com/u)
    assert.equal(url.searchParams.get('format'), 'json')
    assert.equal(result.run.candidates[0].title, '公开讨论')
    assert.equal(result.run.candidates[0].trust, 'untrusted')
  } finally { await host.dispose() }
})

test('Host 公开搜索取消后不持久化失败记录且预算不变', async () => {
  let beginSearch
  const web = { search(_request, signal) {
    return new Promise((_resolve, reject) => {
      beginSearch?.()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  } }
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null, undefined, web)
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'Cancel search', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const controller = new AbortController()
    let started
    const startedPromise = new Promise(resolve => { started = resolve })
    beginSearch = started
    const searching = host.searchSocialPublicSources({ taskId: plan.task.id, platform: 'weibo', query: 'query', confirmed: true }, controller.signal)
    await startedPromise
    controller.abort(Object.assign(new Error('cancelled'), { code: 'cancelled' }))
    await assert.rejects(searching, { code: 'cancelled' })
    const restored = (await host.listSocialResearchTasks()).tasks[0]
    assert.equal(restored.usage.sourceRequests, 0)
    assert.deepEqual(restored.publicSearchRuns ?? [], [])
  } finally { await host.dispose() }
})

test('Host 拒绝同一社媒任务的并发公开搜索以避免请求和预算竞态', async () => {
  let releaseSearch
  let started
  let calls = 0
  const web = { search() {
    calls += 1
    return new Promise(resolve => {
      releaseSearch = resolve
      started?.()
    })
  } }
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null, undefined, web)
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'Concurrent search', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    let signalReady
    const ready = new Promise(resolve => { signalReady = resolve })
    started = signalReady
    const first = host.searchSocialPublicSources({ taskId: plan.task.id, platform: 'weibo', query: 'query', confirmed: true }, new AbortController().signal)
    await ready
    await assert.rejects(host.searchSocialPublicSources({ taskId: plan.task.id, platform: 'weibo', query: 'query', confirmed: true }, new AbortController().signal), { code: 'search_in_progress' })
    releaseSearch({ sources: [{ url: 'https://weibo.com/post/1', title: 'Result', snippet: 'Excerpt' }], truncated: false })
    await first
    assert.equal(calls, 1)
    const restored = (await host.listSocialResearchTasks()).tasks[0]
    assert.equal(restored.usage.sourceRequests, 1)
    assert.equal(restored.publicSearchRuns.length, 1)
  } finally { await host.dispose() }
})

test('Host 社媒用户选择来源与资料库关联可保存，并只为选中结果生成报告提示词', async () => {
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null)
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'Synthetic topic', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const knowledge = await host.saveKnowledgeEntry({ entry: {
      id: 'social-reference-1', title: 'Selected reference', type: 'manual-note',
      sourceUrl: 'https://example.test/reference', contentExcerpt: 'Selected reference excerpt',
    } })
    await assert.rejects(host.saveSocialResearchResult({ taskId: plan.task.id, result: {
      platform: 'weibo', title: 'Stale reference', sourceUrl: 'https://example.test/post',
      excerpt: 'Selected user excerpt', knowledgeEntryIds: [knowledge.entry.id, 'missing'],
    } }), { code: 'missing_knowledge_reference' })
    const saved = await host.saveSocialResearchResult({ taskId: plan.task.id, result: {
      platform: 'weibo', title: 'Selected post', sourceUrl: 'https://example.test/post?token=private',
      excerpt: 'Selected user excerpt', knowledgeEntryIds: [knowledge.entry.id], apiKey: 'secret',
    } })
    assert.equal(saved.task.results.length, 1)
    assert.equal((await host.listSocialResearchTasks()).tasks.find(item => item.id === plan.task.id).results.length, 1, 'Host 读回应保留手动来源结果')
    assert.equal(saved.task.results[0].sourceUrl, 'https://example.test/post')
    assert.deepEqual(saved.task.results[0].knowledgeEntryIds, ['social-reference-1'])
    assert.equal(saved.task.results[0].apiKey, undefined)
    const second = await host.saveSocialResearchResult({ taskId: plan.task.id, result: {
      platform: 'weibo', title: 'Unselected post', sourceUrl: 'https://example.test/other', excerpt: 'Exclude me', knowledgeEntryIds: [],
    } })
    const report = await host.buildSocialResearchReportPrompt({ taskId: plan.task.id, resultIds: [saved.task.results[0].id] })
    assert.match(report.prompt, /Selected user excerpt/u)
    assert.match(report.prompt, /Selected reference excerpt/u)
    assert.doesNotMatch(report.prompt, /Unselected post|Exclude me/u)
    assert.equal(report.task.reportRuns.length, 1)
    assert.equal(report.reportRun.status, 'prompt-ready')
    assert.deepEqual(report.reportRun.resultIds, [saved.task.results[0].id])
    const rerun = await host.buildSocialResearchReportPrompt({ taskId: plan.task.id, resultIds: [saved.task.results[0].id] })
    assert.equal(rerun.task.reportRuns.length, 2)
    assert.notEqual(rerun.reportRun.id, report.reportRun.id)
    const edited = await host.saveSocialResearchReportPrompt({
      taskId: plan.task.id, parentRunId: report.reportRun.id, prompt: `${report.reportRun.prompt}\n\n请补充平台间差异。`,
    })
    assert.equal(edited.reportRun.status, 'edited-prompt')
    assert.equal(edited.reportRun.parentRunId, report.reportRun.id)
    assert.deepEqual(edited.reportRun.resultIds, report.reportRun.resultIds)
    assert.match(edited.reportRun.prompt, /请补充平台间差异/u)
    assert.equal(edited.task.reportRuns.length, 3)
    assert.equal(edited.task.reportRuns.find(item => item.id === report.reportRun.id).prompt, report.reportRun.prompt, '编辑新版本不得覆盖原提示词')
    assert.equal(typeof report.reportRun.prompt, 'string')
    const restored = (await host.listSocialResearchTasks()).tasks.find(item => item.id === plan.task.id)
    assert.equal(restored.reportRuns.length, 3)
    assert.equal(restored.reportRuns[0].prompt, report.reportRun.prompt, 'Host 重读必须恢复第一版提示词全文')
    assert.equal(restored.reportRuns[1].prompt, rerun.reportRun.prompt, 'Host 重读必须恢复重跑提示词全文')
    assert.equal(restored.reportRuns[2].prompt, edited.reportRun.prompt, 'Host 重读必须恢复编辑版本全文')
    assert.equal(restored.reportRuns[2].parentRunId, report.reportRun.id, 'Host 重读必须恢复编辑版本的父版本关联')
    await assert.rejects(host.saveSocialResearchReportPrompt({ taskId: plan.task.id, parentRunId: 'missing', prompt: '编辑内容' }), { code: 'not_found' })
    await assert.rejects(host.saveSocialResearchReportPrompt({ taskId: plan.task.id, parentRunId: report.reportRun.id, prompt: '   ' }), { code: 'invalid_input' })
    await assert.rejects(host.saveSocialResearchReportPrompt({ taskId: plan.task.id, parentRunId: report.reportRun.id, prompt: 'x'.repeat(250_001) }), { code: 'invalid_input' })
    assert.equal(second.task.results.length, 2)
    await assert.rejects(host.saveSocialResearchResult({ taskId: 'missing', result: {} }), { code: 'not_found' })
  } finally { await host.dispose() }
})


test('Host 使用显式选择的模型生成社媒报告并保存可恢复版本', async () => {
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null)
  host.generate = async (messages, provider, model, { signal }) => {
    assert.equal(provider, 'provider-test')
    assert.equal(model, 'model-test')
    assert.equal(signal.aborted, false)
    assert.match(messages[0].content, /Selected excerpt/u)
    return '基于已选来源的报告正文'
  }
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'Synthetic report', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const result = await host.saveSocialResearchResult({ taskId: plan.task.id, result: {
      platform: 'weibo', title: 'Selected', sourceUrl: 'https://example.test/post', excerpt: 'Selected excerpt', knowledgeEntryIds: [],
    } })
    const generated = await host.generateSocialResearchReport({ taskId: plan.task.id, resultIds: [result.task.results[0].id], provider: 'provider-test', model: 'model-test' }, new AbortController().signal)
    assert.equal(generated.reportRun.status, 'generated-report')
    assert.equal(generated.reportRun.report, '基于已选来源的报告正文')
    assert.match(generated.reportRun.prompt, /Selected excerpt/u)
    const restored = (await host.listSocialResearchTasks()).tasks.find(item => item.id === plan.task.id)
    assert.equal(restored.reportRuns[0].report, generated.reportRun.report)
    assert.deepEqual(restored.reportRuns[0].resultIds, [result.task.results[0].id])
  } finally { await host.dispose() }
})

test('Host 在模型忽略取消后仍阻止社媒报告写入版本', async () => {
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null)
  let finishGeneration
  host.generate = async () => new Promise(resolve => { finishGeneration = resolve })
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'Cancelled report', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const result = await host.saveSocialResearchResult({ taskId: plan.task.id, result: {
      platform: 'weibo', title: 'Selected', sourceUrl: 'https://example.test/post', excerpt: 'Selected excerpt', knowledgeEntryIds: [],
    } })
    const controller = new AbortController()
    const pending = host.generateSocialResearchReport({ taskId: plan.task.id, resultIds: [result.task.results[0].id], provider: 'provider-test', model: 'model-test' }, controller.signal)
    while (!finishGeneration) await new Promise(resolve => setImmediate(resolve))
    controller.abort()
    assert.equal(controller.signal.aborted, true)
    finishGeneration('此结果不得保存')
    await assert.rejects(pending, { code: 'cancelled' })
    const restored = (await host.listSocialResearchTasks()).tasks.find(item => item.id === plan.task.id)
    assert.equal(restored.reportRuns?.length ?? 0, 0)
  } finally { await host.dispose() }
})

test('Host 社媒附件按序分块上传、持久化读回校验并关联到选中结果', async () => {
  const stored = new Map()
  const attachments = {
    async saveFileStream({ data, name }) {
      const chunks = []
      for await (const chunk of data) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
      stored.set(`sha256:${sha256}`, bytes)
      return { attachmentId: `sha256:${sha256}`, bytes: bytes.length, name }
    },
    async *readFileStream(ref) { yield stored.get(ref.attachmentId) },
  }
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null, attachments)
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'Attachment topic', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const result = await host.saveSocialResearchResult({ taskId: plan.task.id, result: {
      platform: 'weibo', title: 'Selected result', sourceUrl: 'https://example.test/post', excerpt: 'Excerpt', knowledgeEntryIds: [],
    } })
    const body = Buffer.alloc(100 * 1024 + 17, 0x41)
    const upload = await host.beginSocialAttachmentUpload({ taskId: plan.task.id, resultId: result.task.results[0].id, name: 'proof.txt', mimeType: 'text/plain', size: body.length })
    await assert.rejects(host.appendSocialAttachmentChunk({ uploadId: upload.uploadId, index: 1, dataBase64: body.toString('base64') }), { code: 'invalid_input' })
    let appended
    for (let offset = 0, index = 0; offset < body.length; offset += 48 * 1024, index += 1) {
      appended = await host.appendSocialAttachmentChunk({ uploadId: upload.uploadId, index, dataBase64: body.subarray(offset, Math.min(body.length, offset + 48 * 1024)).toString('base64') })
    }
    assert.equal(appended.bytes, body.length)
    const committed = await host.commitSocialAttachmentUpload({ uploadId: upload.uploadId })
    assert.equal(committed.attachment.status, 'verified')
    assert.equal(committed.task.attachments.length, 1)
    assert.deepEqual(committed.task.results[0].attachmentIds, [committed.task.attachments[0].id])
    const download = await host.beginSocialResearchAttachmentDownload({ taskId: plan.task.id, attachmentId: committed.attachment.id })
    await assert.rejects(host.beginSocialResearchAttachmentDownload({ taskId: 'other-task', attachmentId: committed.attachment.id }), { code: 'not_found' })
    await assert.rejects(host.readSocialResearchAttachmentChunk({ downloadId: download.downloadId, taskId: 'other-task', offset: 0 }), { code: 'not_found' })
    await assert.rejects(host.readSocialResearchAttachmentChunk({ downloadId: download.downloadId, taskId: plan.task.id, offset: 1 }), { code: 'invalid_input' })
    const cancelledDownload = new AbortController()
    cancelledDownload.abort(Object.assign(new Error('cancel download'), { code: 'cancelled' }))
    await assert.rejects(host.readSocialResearchAttachmentChunk({ downloadId: download.downloadId, taskId: plan.task.id, offset: 0 }, cancelledDownload.signal), { code: 'cancelled' })
    const downloadedChunks = []
    for (let offset = 0; offset < body.length;) {
      const chunk = await host.readSocialResearchAttachmentChunk({ downloadId: download.downloadId, taskId: plan.task.id, offset })
      assert.equal(chunk.offset, offset)
      assert.equal(chunk.done, chunk.nextOffset === body.length)
      downloadedChunks.push(Buffer.from(chunk.dataBase64, 'base64'))
      offset = chunk.nextOffset
    }
    assert.deepEqual(Buffer.concat(downloadedChunks), body)
    assert.deepEqual(await host.finishSocialResearchAttachmentDownload({ downloadId: download.downloadId }), { finished: true })
    assert.deepEqual(await host.finishSocialResearchAttachmentDownload({ downloadId: download.downloadId }), { finished: false })
    await assert.rejects(host.readSocialResearchAttachmentChunk({ downloadId: download.downloadId, taskId: plan.task.id, offset: 0 }), { code: 'not_found' })
    await assert.rejects(host.readSocialResearchAttachmentChunk({ downloadId: download.downloadId, taskId: plan.task.id, offset: body.length }), { code: 'not_found' })
    const reportBeforeRemoval = await host.buildSocialResearchReportPrompt({ taskId: plan.task.id, resultIds: [result.task.results[0].id] })
    assert.match(reportBeforeRemoval.prompt, /proof\.txt/u)
    assert.match(reportBeforeRemoval.prompt, /untrusted/u)
    assert.match(reportBeforeRemoval.prompt, /A{1000}/u, '所选附件解析文本必须进入报告提示词')
    let modelMessages
    host.generate = async messages => { modelMessages = messages; return '附件内容报告' }
    const generatedWithAttachment = await host.generateSocialResearchReport({ taskId: plan.task.id, resultIds: [result.task.results[0].id], provider: 'provider-test', model: 'model-test' }, new AbortController().signal)
    assert.match(modelMessages[0].content, /A{1000}/u, '模型请求必须包含选中附件文本')
    assert.match(generatedWithAttachment.reportRun.prompt, /A{1000}/u)
    const storedAttachmentId = `sha256:${committed.attachment.sha256}`
    const storedBytes = stored.get(storedAttachmentId)
    stored.set(storedAttachmentId, Buffer.from('tampered'))
    await assert.rejects(host.buildSocialResearchReportPrompt({ taskId: plan.task.id, resultIds: [result.task.results[0].id] }), { code: 'attachment_mismatch' })
    stored.set(storedAttachmentId, storedBytes)
    const removed = await host.removeSocialResearchAttachment({ taskId: plan.task.id, attachmentId: committed.attachment.id })
    assert.equal(removed.storageObjectRetained, true)
    assert.deepEqual(removed.task.attachments, [])
    assert.deepEqual(removed.task.results[0].attachmentIds, [])
    await assert.rejects(host.beginSocialResearchAttachmentDownload({ taskId: plan.task.id, attachmentId: committed.attachment.id }), { code: 'not_found' })
    const reportAfterRemoval = await host.buildSocialResearchReportPrompt({ taskId: plan.task.id, resultIds: [result.task.results[0].id] })
    assert.doesNotMatch(reportAfterRemoval.prompt, /proof\.txt/u)
    const cancelled = await host.beginSocialAttachmentUpload({ taskId: plan.task.id, resultId: result.task.results[0].id, name: 'cancel.csv', mimeType: 'text/csv', size: 4 })
    assert.deepEqual(await host.cancelSocialAttachmentUpload({ uploadId: cancelled.uploadId }), { cancelled: true })
    await assert.rejects(host.commitSocialAttachmentUpload({ uploadId: cancelled.uploadId }), { code: 'invalid_input' })
    const attachedResult = await host.saveSocialResearchResult({ taskId: plan.task.id, result: { platform: 'weibo', title: 'Attached result', sourceUrl: 'https://example.test/attached', excerpt: 'Attached excerpt', knowledgeEntryIds: [] } })
    const attachedId = attachedResult.task.results[0].id
    const attachedUpload = await host.beginSocialAttachmentUpload({ taskId: plan.task.id, resultId: attachedId, name: 'retained.txt', mimeType: 'text/plain', size: 4 })
    await host.appendSocialAttachmentChunk({ uploadId: attachedUpload.uploadId, index: 0, dataBase64: Buffer.from('data').toString('base64') })
    const attached = await host.commitSocialAttachmentUpload({ uploadId: attachedUpload.uploadId })
    assert.equal(attached.attachment.status, 'verified')
    const reportRunCountBeforeRemoval = reportAfterRemoval.task.reportRuns.length
    const removedResult = await host.removeSocialResearchResult({ taskId: plan.task.id, resultId: attachedId })
    assert.equal(removedResult.task.results.some(item => item.id === attachedId), false)
    assert.equal(removedResult.task.reportRuns.length, reportRunCountBeforeRemoval, '已有报告快照留作历史记录')
    assert.equal(removedResult.removedAttachmentCount, 1, '移除来源时同步解除附件关联')
    assert.equal(removedResult.storageObjectsRetained, true, 'Host 内容对象不由任务移除操作删除')
    assert.equal(removedResult.task.attachments.some(item => item.id === attached.attachment.id), false)
    await assert.rejects(host.beginSocialResearchAttachmentDownload({ taskId: plan.task.id, attachmentId: attached.attachment.id }), { code: 'not_found' })
    await assert.rejects(host.removeSocialResearchResult({ taskId: plan.task.id, resultId: attachedId }), { code: 'not_found' })
  } finally { await host.dispose() }
})

test('Host 未提供附件存储接口时拒绝上传，且不改变任务附件状态', async () => {
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null)
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'No attachment host', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const result = await host.saveSocialResearchResult({ taskId: plan.task.id, result: {
      platform: 'weibo', title: 'Selected', sourceUrl: 'https://example.test/post', excerpt: 'Excerpt', knowledgeEntryIds: [],
    } })
    await assert.rejects(host.beginSocialAttachmentUpload({ taskId: plan.task.id, resultId: result.task.results[0].id, name: 'proof.txt', mimeType: 'text/plain', size: 1 }), { code: 'attachment_unavailable' })
    const restored = (await host.listSocialResearchTasks()).tasks[0]
    assert.deepEqual(restored.attachments ?? [], [])
    assert.deepEqual(restored.results[0].attachmentIds ?? [], [])
    assert.deepEqual(restored.recoveryAttachments, [])
  } finally { await host.dispose() }
})

test('Host 附件最终关联事务失败后保留恢复记录，并在列表读取时幂等补全', async () => {
  let updates = 0
  let failFinalCommit = true
  const domain = createStorageDomain({ beforeUpdate() {
    updates += 1
    if (updates === 6 && failFinalCommit) {
      failFinalCommit = false
      throw Object.assign(new Error('transient state failure'), { code: 'storage_failure' })
    }
  } })
  const stored = new Map()
  const attachments = {
    async saveFileStream({ data }) {
      const chunks = []
      for await (const chunk of data) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
      stored.set(`sha256:${sha256}`, bytes)
      return { attachmentId: `sha256:${sha256}`, bytes: bytes.length }
    },
    async *readFileStream(ref) { const bytes = stored.get(ref.attachmentId); if (bytes) yield bytes },
  }
  let host = new ForwardStepProbe(domain, { create: async () => { throw new Error('unused') } }, null, attachments)
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'Recovery topic', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const result = await host.saveSocialResearchResult({ taskId: plan.task.id, result: {
      platform: 'weibo', title: 'Selected', sourceUrl: 'https://example.test/post', excerpt: 'Excerpt', knowledgeEntryIds: [],
    } })
    const body = Buffer.from('recover after final transaction failure')
    const upload = await host.beginSocialAttachmentUpload({ taskId: plan.task.id, resultId: result.task.results[0].id, name: 'recovery.txt', mimeType: 'text/plain', size: body.length })
    await host.appendSocialAttachmentChunk({ uploadId: upload.uploadId, index: 0, dataBase64: body.toString('base64') })
    await assert.rejects(host.commitSocialAttachmentUpload({ uploadId: upload.uploadId }), { code: 'storage_failure' })
    await host.dispose()
    host = new ForwardStepProbe(domain, { create: async () => { throw new Error('unused') } }, null, attachments)
    const pending = (await host.listSocialResearchTasks()).tasks[0]
    assert.deepEqual(pending.recoveryAttachments, [])
    assert.equal(pending.attachments.length, 1)
    assert.equal(pending.attachments[0].id, pending.results[0].attachmentIds[0])
    const revision = (await host.listSocialResearchTasks()).revision
    const repeated = await host.listSocialResearchTasks()
    assert.equal(repeated.revision, revision, '重复列表恢复不得重复写入关联')
    assert.equal(repeated.tasks[0].results[0].attachmentIds.length, 1)
    assert.equal(repeated.tasks[0].attachments.length, 1)
  } finally { await host.dispose() }
})

test('Host 文件存储暂时不可读时保留待恢复记录，同一附件重传后完成关联', async () => {
  const stored = new Map()
  let failedReads = 2
  const attachments = {
    async saveFileStream({ data }) {
      const chunks = []
      for await (const chunk of data) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
      stored.set(`sha256:${sha256}`, bytes)
      return { attachmentId: `sha256:${sha256}`, bytes: bytes.length }
    },
    async *readFileStream(ref) {
      if (failedReads > 0) { failedReads -= 1; throw Object.assign(new Error('temporary read failure'), { code: 'storage_failure' }) }
      const bytes = stored.get(ref.attachmentId)
      if (bytes) yield bytes
    },
  }
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null, attachments)
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'Retry topic', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const result = await host.saveSocialResearchResult({ taskId: plan.task.id, result: {
      platform: 'weibo', title: 'Selected', sourceUrl: 'https://example.test/post', excerpt: 'Excerpt', knowledgeEntryIds: [],
    } })
    const body = Buffer.from('retry same attachment bytes')
    const upload = await host.beginSocialAttachmentUpload({ taskId: plan.task.id, resultId: result.task.results[0].id, name: 'retry.txt', mimeType: 'text/plain', size: body.length })
    await host.appendSocialAttachmentChunk({ uploadId: upload.uploadId, index: 0, dataBase64: body.toString('base64') })
    const pending = await host.commitSocialAttachmentUpload({ uploadId: upload.uploadId })
    assert.equal(pending.attachment.status, 'pending-recovery')
    const listed = (await host.listSocialResearchTasks()).tasks[0]
    assert.equal(listed.recoveryAttachments.length, 1)
    assert.equal((listed.attachments ?? []).length, 0)
    const retry = await host.beginSocialAttachmentUpload({ taskId: plan.task.id, resultId: result.task.results[0].id, name: 'retry.txt', mimeType: 'text/plain', size: body.length })
    await host.appendSocialAttachmentChunk({ uploadId: retry.uploadId, index: 0, dataBase64: body.toString('base64') })
    const recovered = await host.commitSocialAttachmentUpload({ uploadId: retry.uploadId })
    assert.equal(recovered.attachment.status, 'verified')
    assert.equal(recovered.task.attachments.length, 1)
    assert.equal((await host.listSocialResearchTasks()).tasks[0].recoveryAttachments.length, 0)
  } finally { await host.dispose() }
})


test('Host 社媒附件提交期间拒绝重复提交和取消，避免竞争读取暂存文件', async () => {
  let signalSaveStarted
  let releaseSave
  const saveStarted = new Promise(resolve => { signalSaveStarted = resolve })
  const saveGate = new Promise(resolve => { releaseSave = resolve })
  const stored = new Map()
  const attachments = {
    async saveFileStream({ data }) {
      signalSaveStarted()
      await saveGate
      const chunks = []
      for await (const chunk of data) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
      stored.set(`sha256:${sha256}`, bytes)
      return { attachmentId: `sha256:${sha256}`, bytes: bytes.length }
    },
    async *readFileStream(ref) { yield stored.get(ref.attachmentId) },
  }
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null, attachments)
  try {
    const plan = await host.createSocialResearchPlan({ topic: 'Concurrency topic', platforms: ['weibo'], queries: ['query'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const result = await host.saveSocialResearchResult({ taskId: plan.task.id, result: {
      platform: 'weibo', title: 'Selected', sourceUrl: 'https://example.test/post', excerpt: 'Excerpt', knowledgeEntryIds: [],
    } })
    const body = Buffer.from('race test')
    const upload = await host.beginSocialAttachmentUpload({ taskId: plan.task.id, resultId: result.task.results[0].id, name: 'race.txt', mimeType: 'text/plain', size: body.length })
    await host.appendSocialAttachmentChunk({ uploadId: upload.uploadId, index: 0, dataBase64: body.toString('base64') })
    const committing = host.commitSocialAttachmentUpload({ uploadId: upload.uploadId })
    await saveStarted
    await assert.rejects(host.commitSocialAttachmentUpload({ uploadId: upload.uploadId }), { code: 'invalid_input' })
    await assert.rejects(host.cancelSocialAttachmentUpload({ uploadId: upload.uploadId }), { code: 'upload_in_progress' })
    let disposed = false
    const disposing = host.dispose().then(() => { disposed = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(disposed, false, 'Host 卸载应等待活动附件提交')
    releaseSave()
    assert.equal((await committing).attachment.status, 'verified')
    await disposing
    assert.equal(disposed, true)
  } finally { releaseSave(); await host.dispose() }
})

test('Host 写作材料覆盖范围和批次状态可持久化读回', async () => {
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null)
  try {
    const created = await host.initializeWritingMaterialCoverage({
      articleId: 'writing-task-coverage', genre: 'article', goal: 'Synthetic writing task',
      items: [{ id: 'selected-source', title: 'Selected source' }],
    })
    assert.equal(created.workspace.materialCoverage.items.length, 1)
    assert.equal(created.summary.pending, 1)
    const started = await host.applyWritingMaterialCoverageAction({
      articleId: 'writing-task-coverage', action: 'start-batch', promptVersionId: 'prompt-version-1',
    })
    const batchId = started.workspace.materialCoverage.batches[0].id
    const returned = await host.applyWritingMaterialCoverageAction({
      articleId: 'writing-task-coverage', action: 'record-outcome', batchId, kind: 'returned', resultSummary: 'Reviewed manually',
    })
    assert.equal(returned.summary.processed, 0)
    const confirmed = await host.applyWritingMaterialCoverageAction({
      articleId: 'writing-task-coverage', action: 'confirm-batch', batchId, evidence: 'Human review passed',
    })
    assert.equal(confirmed.summary.processed, 1)
    const restored = await host.getWritingMaterialCoverage({ articleId: 'writing-task-coverage' })
    assert.equal(restored.workspace.materialCoverage.batches[0].status, 'confirmed')
    await assert.rejects(host.getWritingMaterialCoverage({ articleId: 'missing' }), { code: 'not_found' })
  } finally { await host.dispose() }
})



test('Host 执行已确认社媒计划并逐项持久化公开搜索检查点', async () => {
  const requests = []
  const web = { async search(request) {
    requests.push(request.query)
    const host = request.query.includes('zhihu.com') ? 'zhihu.com' : 'weibo.com'
    return { sources: [{ url: `https://${host}/question/1`, title: '公开候选', snippet: '不可信摘要' }], truncated: false }
  } }
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null, undefined, web)
  try {
    const plan = await host.createSocialResearchPlan({ topic: '行业讨论', platforms: ['weibo', 'zhihu'], queries: ['趋势', '变化'], budget: { maxPlatforms: 2, maxQueriesPerPlatform: 2, maxSourceRequests: 4 } })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    await assert.rejects(host.searchConfirmedSocialPublicPlan({ taskId: plan.task.id, confirmed: false }, new AbortController().signal), { code: 'confirmation_required' })
    const result = await host.searchConfirmedSocialPublicPlan({ taskId: plan.task.id, confirmed: true }, new AbortController().signal)
    assert.equal(requests.length, 4)
    assert.equal(result.runs.length, 4)
    const restored = (await host.listSocialResearchTasks()).tasks.find(task => task.id === plan.task.id)
    assert.equal(restored.publicSearchRuns.length, 4)
    assert.equal(restored.usage.sourceRequests, 4)
    assert.ok(restored.publicSearchRuns.flatMap(run => run.candidates).every(candidate => candidate.trust === 'untrusted'))
  } finally { await host.dispose() }
})

test('Host 在批量搜索中途取消后保留检查点并允许续跑', async () => {
  const firstController = new AbortController()
  let requests = 0
  const web = { async search() {
    requests += 1
    if (requests === 2) firstController.abort()
    return { sources: [{ url: `https://weibo.com/post/${requests}`, title: '公开候选' }], truncated: false }
  } }
  const host = new ForwardStepProbe(createStorageDomain(), { create: async () => { throw new Error('unused') } }, null, undefined, web)
  try {
    const plan = await host.createSocialResearchPlan({ topic: '中途恢复', platforms: ['weibo'], queries: ['查询一', '查询二', '查询三'] })
    await host.confirmSocialResearchPlan({ taskId: plan.task.id })
    const interrupted = await host.searchConfirmedSocialPublicPlan({ taskId: plan.task.id, confirmed: true }, firstController.signal)
    assert.equal(interrupted.cancelled, true)
    assert.equal(interrupted.task.publicSearchRuns.length, 1)
    const restored = (await host.listSocialResearchTasks()).tasks.find(task => task.id === plan.task.id)
    assert.equal(restored.publicSearchRuns.length, 1)
    assert.equal(restored.usage.sourceRequests, 1)
    const resumed = await host.searchConfirmedSocialPublicPlan({ taskId: plan.task.id, confirmed: true }, new AbortController().signal)
    assert.equal(resumed.cancelled, false)
    assert.equal(resumed.task.publicSearchRuns.filter(run => run.status === 'completed').length, 3)
    assert.equal(resumed.task.usage.sourceRequests, 3)
  } finally { await host.dispose() }
})



test('Host 只对已核验且已授权平台开放社媒采集，并保存运行结果', async t => {
  let collected
  const runtime = {
    async getPlatformState() { return { capabilities: [{ platform: 'weibo', status: 'verified', verified: true }, { platform: 'zhihu', status: 'unverified', verified: false }], connections: { weibo: { status: 'ready', authorized: true }, zhihu: { status: 'ready', authorized: true } } } },
    async collectPlatform(input) { collected = input; return [{ title: '已采集结果', sourceUrl: 'https://weibo.com/post/1', excerpt: '合成测试内容' }] },
  }
  const host = new ForwardStepProbe(createStorageDomain(), undefined, undefined, undefined, undefined, runtime)
  t.after(() => host.dispose())
  const availability = await host.listSocialPlatformAvailability()
  assert.equal(availability.platforms.find(item => item.platform === 'weibo').canRun, true)
  assert.equal(availability.platforms.find(item => item.platform === 'zhihu').canRun, false)
  const plan = await host.createSocialResearchPlan({ topic: '合成验收', platforms: ['weibo', 'zhihu'], queries: ['合成查询'] })
  assert.equal(plan.task.capabilities.find(item => item.platform === 'weibo').verified, true)
  assert.equal(plan.task.capabilities.find(item => item.platform === 'zhihu').verified, false)
  await assert.rejects(host.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: false }, new AbortController().signal), { code: 'confirmation_required' })
  const confirmed = await host.confirmSocialResearchPlan({ taskId: plan.task.id })
  const run = await host.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: true, platforms: ['weibo'] }, new AbortController().signal)
  assert.equal(collected.platform, 'weibo')
  assert.equal(run.task.status, 'awaiting-platform-preparation')
  assert.equal(run.task.platformResults[0].results[0].title, '已采集结果')
  assert.equal(run.revision > confirmed.revision, true)
})

test('插件入口自动将 DSH Browser 接入 Host 社媒采集服务', async t => {
  const calls = []
  const browser = {
    policyReport: async () => ({ authProfiles: [{ id: 'private-profile-id', allowedDomains: ['.weibo.com'] }] }),
    async searchResults(url, spec, options) {
      calls.push({ url, profile: options.authProfile, count: options.count })
      return [{ url: 'https://weibo.com/post/42', title: '站内结果', snippet: '待人工核验' }]
    },
  }
  let probe
  const ctx = {
    storageDomain: createStorageDomain(),
    get(name) { return name === 'browser' ? browser : undefined },
    provide(name, value) { if (name === 'forwardStepProbe') probe = value },
    on() {},
    effect() {},
    skills: { registerProvider() {} },
  }
  applyForwardStepPlugin(ctx)
  t.after(() => probe.dispose())

  const availability = await probe.listSocialPlatformAvailability()
  const weiboAvailability = availability.platforms.find(item => item.platform === 'weibo')
  assert.equal(weiboAvailability.canRun, true)
  assert.equal(weiboAvailability.profileConfigured, true)
  assert.doesNotMatch(JSON.stringify(availability), /private-profile-id/u)

  const plan = await probe.createSocialResearchPlan({ topic: '插件入口接入验收', platforms: ['weibo'], queries: ['验收查询'] })
  assert.deepEqual(plan.task.capabilities, [{ platform: 'weibo', status: 'unverified', verified: false }])
  await probe.confirmSocialResearchPlan({ taskId: plan.task.id })
  const result = await probe.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: true }, new AbortController().signal)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].profile, 'private-profile-id')
  assert.equal(calls[0].url, 'https://s.weibo.com/weibo?q=%E9%AA%8C%E6%94%B6%E6%9F%A5%E8%AF%A2')
  assert.equal(result.task.platformRunReceipts.at(-1).resultCount, 1)
  assert.equal(result.task.platformResults[0].results[0].title, '站内结果')
  assert.doesNotMatch(JSON.stringify(result.task), /private-profile-id/u)
})

test('插件入口继续优先使用显式注册的社媒服务', async t => {
  let browserCalls = 0
  let probe
  const socialResearch = {
    async getPlatformState() {
      return { capabilities: [{ platform: 'weibo', status: 'verified', verified: true }], connections: { weibo: { status: 'ready', authorized: true } } }
    },
    async collectPlatform() { return [] },
  }
  applyForwardStepPlugin({
    storageDomain: createStorageDomain(),
    get(name) {
      if (name === 'socialResearch') return socialResearch
      if (name === 'browser') return { policyReport: async () => { browserCalls += 1; return { authProfiles: [] } }, searchResults: async () => [] }
      return undefined
    },
    provide(name, value) { if (name === 'forwardStepProbe') probe = value },
    on() {},
    effect() {},
    skills: { registerProvider() {} },
  })
  t.after(() => probe.dispose())

  const availability = await probe.listSocialPlatformAvailability()
  assert.equal(availability.platforms.find(item => item.platform === 'weibo').canRun, true)
  assert.equal(browserCalls, 0)
})


test('社媒状态服务暂时失败时工作台仍可列状态并保存未核验计划，运行仍被拒绝', async t => {
  let collectionCalls = 0
  const runtime = {
    async getPlatformState() { throw new Error('temporary status failure') },
    async collectPlatform() { collectionCalls += 1; return [] },
  }
  const host = new ForwardStepProbe(createStorageDomain(), undefined, undefined, undefined, undefined, runtime)
  t.after(() => host.dispose())
  const availability = await host.listSocialPlatformAvailability()
  assert.ok(availability.platforms.every(item => item.canRun === false && item.reason.includes('无法读取')))
  const plan = await host.createSocialResearchPlan({ topic: '状态暂不可用', platforms: ['weibo'], queries: ['查询'] })
  assert.equal(plan.task.capabilities.find(item => item.platform === 'weibo').verified, false)
  await host.confirmSocialResearchPlan({ taskId: plan.task.id })
  await assert.rejects(
    host.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: true }, new AbortController().signal),
    { code: 'platform_state_unavailable' },
  )
  assert.equal(collectionCalls, 0)
})

test('Host 拒绝同一社媒计划并发运行并在完成后释放占用', async t => {
  let releaseCollection
  let markCollectionStarted
  const collectionStarted = new Promise(resolve => { markCollectionStarted = resolve })
  let calls = 0
  const runtime = {
    async getPlatformState() {
      return {
        capabilities: [{ platform: 'weibo', status: 'verified', verified: true }],
        connections: { weibo: { status: 'ready', authorized: true } },
      }
    },
    async collectPlatform() {
      calls += 1
      markCollectionStarted()
      return new Promise(resolve => { releaseCollection = resolve })
    },
  }
  const host = new ForwardStepProbe(createStorageDomain(), undefined, undefined, undefined, undefined, runtime)
  t.after(() => host.dispose())
  const plan = await host.createSocialResearchPlan({ topic: '并发保护', platforms: ['weibo'], queries: ['查询'] })
  await host.confirmSocialResearchPlan({ taskId: plan.task.id })
  const controller = new AbortController()
  const running = host.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: true }, controller.signal)
  await collectionStarted
  await assert.rejects(
    host.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: true }, new AbortController().signal),
    { code: 'task_busy' },
  )
  assert.equal(calls, 1)
  releaseCollection([{ title: '只采集一次' }])
  const result = await running
  assert.equal(result.task.status, 'report-ready')
  assert.equal(calls, 1)
})

test('授权采集中途取消不保存失败记录或消耗预算', async t => {
  let started
  const collectionStarted = new Promise(resolve => { started = resolve })
  const runtime = {
    async getPlatformState() {
      return {
        capabilities: [{ platform: 'weibo', status: 'verified', verified: true }],
        connections: { weibo: { status: 'ready', authorized: true } },
      }
    },
    async collectPlatform({ signal }) {
      started()
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })), { once: true }))
    },
  }
  const host = new ForwardStepProbe(createStorageDomain(), undefined, undefined, undefined, undefined, runtime)
  t.after(() => host.dispose())
  const plan = await host.createSocialResearchPlan({ topic: '取消采集', platforms: ['weibo'], queries: ['查询'] })
  await host.confirmSocialResearchPlan({ taskId: plan.task.id })
  const controller = new AbortController()
  const running = host.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: true }, controller.signal)
  await collectionStarted
  controller.abort()
  await assert.rejects(running, { code: 'cancelled' })
  const restored = (await host.listSocialResearchTasks()).tasks.find(item => item.id === plan.task.id)
  assert.equal(restored.status, 'awaiting-platform-preparation')
  assert.deepEqual(restored.platformResults, [])
  assert.equal(restored.usage.sourceRequests, 0)
})

test('社媒运行时缺失时保持兼容且不开放采集', async t => {
  const host = new ForwardStepProbe(createStorageDomain())
  t.after(() => host.dispose())
  const availability = await host.listSocialPlatformAvailability()
  assert.ok(availability.platforms.every(item => item.canRun === false))
  const plan = await host.createSocialResearchPlan({ topic: '无适配器兼容', platforms: ['weibo'], queries: ['查询'] })
  assert.equal(plan.task.capabilities.find(item => item.platform === 'weibo').verified, false)
  await host.confirmSocialResearchPlan({ taskId: plan.task.id })
  await assert.rejects(
    host.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: true }, new AbortController().signal),
    { code: 'unsupported_host' },
  )
})

test('已核验平台但缺少采集函数时仍显示不可运行', async t => {
  const host = new ForwardStepProbe(createStorageDomain(), undefined, undefined, undefined, undefined, {
    async getPlatformState() {
      return {
        capabilities: [{ platform: 'weibo', status: 'verified', verified: true }],
        connections: { weibo: { status: 'ready', authorized: true } },
      }
    },
  })
  t.after(() => host.dispose())
  const availability = await host.listSocialPlatformAvailability()
  const weibo = availability.platforms.find(item => item.platform === 'weibo')
  assert.equal(weibo.canRun, false)
  assert.match(weibo.reason, /未提供社媒采集适配器/u)
})

test('社媒运行时按最新授权状态重试失败平台并持久化部分结果', async t => {
  let zhihuAuthorized = true
  let zhihuFailed = true
  const runtime = {
    async getPlatformState() {
      return {
        capabilities: ['weibo', 'zhihu'].map(platform => ({ platform, status: 'verified', verified: true })),
        connections: {
          weibo: { status: 'ready', authorized: true },
          zhihu: { status: zhihuAuthorized ? 'ready' : 'revoked', authorized: zhihuAuthorized },
        },
      }
    },
    async collectPlatform({ platform }) {
      if (platform === 'zhihu' && zhihuFailed) throw Object.assign(new Error('临时失败'), { code: 'temporary_failure' })
      return [{ title: `${platform} 采集结果`, sourceUrl: `https://${platform}.example/item/1` }]
    },
  }
  const host = new ForwardStepProbe(createStorageDomain(), undefined, undefined, undefined, undefined, runtime)
  t.after(() => host.dispose())
  const plan = await host.createSocialResearchPlan({ topic: '失败后续跑', platforms: ['weibo', 'zhihu'], queries: ['查询'] })
  await host.confirmSocialResearchPlan({ taskId: plan.task.id })
  const firstRun = await host.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: true }, new AbortController().signal)
  assert.equal(firstRun.task.status, 'partial-failure')
  assert.deepEqual(firstRun.task.platformResults.map(item => [item.platform, item.status]), [['weibo', 'completed'], ['zhihu', 'failed']])

  zhihuAuthorized = false
  await assert.rejects(
    host.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: true, platforms: ['zhihu'] }, new AbortController().signal),
    { code: 'unsupported_host' },
  )
  zhihuAuthorized = true
  zhihuFailed = false
  const retried = await host.runAuthorizedSocialResearch({ taskId: plan.task.id, confirmed: true, platforms: ['zhihu'] }, new AbortController().signal)
  assert.equal(retried.task.status, 'report-ready')
  assert.deepEqual(retried.task.platformResults.map(item => [item.platform, item.status]), [['weibo', 'completed'], ['zhihu', 'completed']])
  assert.equal(retried.task.platformResults.find(item => item.platform === 'weibo').results[0].title, 'weibo 采集结果')
  assert.equal(retried.task.usage.sourceRequests, 3)
  assert.deepEqual(retried.task.usage.usedPlatforms, ['weibo', 'zhihu'])
  const restored = (await host.listSocialResearchTasks()).tasks.find(item => item.id === plan.task.id)
  assert.equal(restored.status, 'report-ready')
  assert.equal(restored.platformResults.length, 2)
})



