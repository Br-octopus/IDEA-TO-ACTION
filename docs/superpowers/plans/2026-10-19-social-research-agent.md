# 社媒研究工作流 Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Electron + 本地 Node 服务 + `localStorage` 应用中，增加一个支持小红书、Reddit、YouTube 的社媒研究工作流 Agent，统一编排 API 和真实浏览器两种连接方式，输出结构化报告和可追溯原始结果。

**Architecture:** 研究 Agent 只负责理解目标、生成计划和分析；平台适配器负责 API 或真实浏览器搜索；纯函数工作流负责计划确认、预算、状态、失败回退和用户控制。默认有 API 的平台先用 API，失败或结果不足时切换浏览器；无 API 的平台直接使用浏览器。首版不引入多 Agent、数据库或向量检索。

**Tech Stack:** Node.js 18+、Electron 38、现有 `localStorage` 状态迁移、Electron IPC、浏览器 `BrowserWindow`/持久化 session partition、现有模型客户端、Node 内置测试运行器。新增浏览器自动化依赖前先评估；默认路径优先复用 Electron Chromium，避免首版引入完整浏览器运行时。

---

## 文件职责和接口边界

### 新建文件

- `prototype/social-research-schema.js`：跨平台研究任务、计划、结果、能力、附件和报告的纯函数 schema 与边界校验；必须同时支持 CommonJS 和浏览器全局导出。
- `prototype/social-research-workflow.js`：研究计划确认、状态迁移、预算和 API→浏览器回退决策；不访问 DOM、IPC 或网络。
- `prototype/social-research-prompts.js`：四种研究模板的计划提示词、补搜提示词和报告提示词；只输出文本，不直接执行搜索。
- `server/social-api-client.js`：平台 API 请求、超时、认证、限流、结果统一化入口；不保存凭证。
- `server/social-platforms.js`：小红书、Reddit、YouTube 的 API 配置和能力声明；平台差异只放在适配器配置中。
- `electron/social-browser-manager.js`：独立平台 profile、可视化登录窗口、导航、页面读取、关闭、清理和状态检查。
- `electron/social-browser-adapters.js`：浏览器模式下三个平台的固定搜索/详情动作；只读，页面选择器和提取逻辑与 manager 分离。
- `prototype/social-research-ui.js`：研究计划、平台准备卡、任务进度、结果集和报告的渲染/事件绑定，避免继续扩大 `prototype/app.js`。

### 修改文件

- `prototype/storage.js`：加入研究任务、平台连接状态和附件元数据的迁移/保存白名单。
- `prototype/workspace-backup.js`：备份和恢复研究摘要、报告、用户主动保存的附件元数据；明确排除 profile、cookies、session token 和 API key。
- `electron/main.js`：注册社媒 API、浏览器 session、附件文件和平台状态 IPC。
- `electron/preload.js`：只暴露白名单化的社媒研究 API，不暴露 `ipcRenderer`、文件系统或任意执行接口。
- `prototype/index.html`：加入研究入口、平台准备区、研究计划确认区、结果集和报告区域，并按顺序加载新脚本。
- `prototype/app.js`：加载/保存新状态，连接既有导航、模型发送预览和资料库保存入口；不承载平台抓取细节。
- `server.js`：如 API 研究需要本地服务路由，增加受限的社媒 API 请求入口；浏览器操作仍只走 Electron IPC。
- `package.json`：加入新增运行时文件语法检查和必要的构建文件清单；只有确认需要外部 CDP 依赖后才增加依赖。

### 测试文件

- `tests/social-research-schema.test.js`
- `tests/social-research-workflow.test.js`
- `tests/social-api-client.test.js`
- `tests/social-browser-manager.test.js`
- `tests/social-browser-adapters.test.js`
- `tests/social-research-ui.test.js`
- `tests/social-research-integration.test.js`
- 修改 `tests/storage.test.js`、`tests/workspace-backup.test.js`、`tests/e2e-smoke.test.js`、`tests/electron-smoke.test.js`、`tests/package-config.test.js`

### 任务顺序

任务 1→2→3→4 可以形成可测试的基础契约；任务 5 依赖 Electron IPC；任务 6 依赖 schema、workflow 和平台工具；任务 7 依赖所有前置任务；任务 8 负责集成、文档和 Windows 回归。每个任务必须由独立实现代理完成，并按“规格审查→代码质量审查”顺序复核。

## Task 1: 研究数据契约和本地状态迁移

**Files:**
- Create: `prototype/social-research-schema.js`
- Modify: `prototype/storage.js`
- Modify: `prototype/workspace-backup.js`
- Test: `tests/social-research-schema.test.js`
- Test: `tests/storage.test.js`
- Test: `tests/workspace-backup.test.js`

- [ ] **Step 1: 写失败测试，固定统一字段和拒绝规则。**

测试必须覆盖：

```js
const task = createResearchTask({ topic: '独立开发者记账工具', template: 'pain-points' });
assert.equal(task.status, 'draft');
assert.deepEqual(task.platforms, []);
assert.deepEqual(task.results, []);

const result = normalizeSocialResult({
  platform: 'reddit', url: 'https://example.test/post', title: '体验',
  publishedAt: '2026-10-19', retrievalMethod: 'browser'
});
assert.equal(result.evidenceStatus, 'unverified');
assert.equal(result.retrievalMethod, 'browser');
assert.throws(() => normalizeSocialResult({ url: 'javascript:alert(1)' }), /http/);
```

同时测试：凭证字段、cookies、session token、密码和任意未知敏感字段不会进入可备份状态；附件元数据只保留 `id/type/size/sourceResultId/relativePath/savedAt`。

- [ ] **Step 2: 运行专项测试，确认当前实现失败。**

运行：`node --test tests/social-research-schema.test.js`  
预期：因模块不存在或接口不存在而失败。

- [ ] **Step 3: 实现 schema 和状态字段。**

固定接口：

```js
createResearchTask(input = {})
normalizeResearchPlan(input)
normalizeSocialResult(input)
normalizePlatformCapability(input)
normalizeAttachmentMeta(input)
sanitizeResearchState(state)
isSafeHttpUrl(value)
```

在 `createEmptyState()` 增加：

```js
researchTasks: [],
platformConnections: {},
researchAttachments: []
```

迁移和保存都必须使用白名单，不能把平台配置中的 API key 写入工作区状态。

- [ ] **Step 4: 实现备份边界并运行测试。**

完整工作区备份保留研究任务、报告、结果摘要、用户选择和附件元数据；资料库备份只保留已保存的研究资料。导出和恢复后断言不存在 `apiKey`、`credential`、`cookie`、`sessionToken`、`password`、`profilePath` 等字段。

运行：`node --test tests/social-research-schema.test.js tests/storage.test.js tests/workspace-backup.test.js`  
预期：全部通过。

- [ ] **Step 5: 提交。**

```powershell
git add prototype/social-research-schema.js prototype/storage.js prototype/workspace-backup.js tests/social-research-schema.test.js tests/storage.test.js tests/workspace-backup.test.js
git commit -m "feat: 增加社媒研究数据契约"
```

## Task 2: 确定性研究计划和预算工作流

**Files:**
- Create: `prototype/social-research-workflow.js`
- Create: `prototype/social-research-prompts.js`
- Test: `tests/social-research-workflow.test.js`

- [ ] **Step 1: 写失败测试，固定计划确认和状态迁移。**

覆盖以下行为：

```js
const planned = createResearchPlan({
  topic: '小红书上的独立开发工具体验',
  template: 'pain-points',
  platforms: ['xiaohongshu', 'reddit', 'youtube']
});
assert.equal(planned.status, 'awaiting_confirmation');

assert.throws(() => startResearchTask(planned), /确认/);
const approved = approveResearchPlan(planned);
assert.equal(approved.status, 'preparing_platforms');
```

覆盖：未批准不能搜索、超出平台/查询/翻页/详情/时间/附件预算必须返回 `budget_exceeded`、用户取消后不能推进、补搜只能在已批准预算内执行。

- [ ] **Step 2: 实现纯函数工作流。**

固定接口：

```js
createResearchPlan(input, capabilities)
approveResearchPlan(task)
rejectResearchPlan(task, reason)
transitionResearchTask(task, event)
consumeResearchBudget(task, usage)
decideConnectionMode(platform, connection, preference)
shouldFallbackToBrowser(apiResult, capability)
canRequestSupplementarySearch(task, request)
```

连接策略固定为：平台无 API 时返回 `browser`；有可用 API 且用户选择 `auto` 时先返回 `api`；API 认证失败、超时、限流、空结果、低于最低结果数或字段不完整时返回 `browser`；用户指定 `api` 时不自动切换，用户指定 `browser` 时不调用 API。

- [ ] **Step 3: 实现四种模板提示词。**

`social-research-prompts.js` 必须提供：

```js
buildResearchPlanPrompt(input)
buildSupplementarySearchPrompt(task, evidenceGap)
buildResearchReportPrompt(task, results)
```

提示词要求模型输出结构化 JSON 或明确的可解析区块，禁止把高热度等同于事实、禁止隐藏未完成平台、禁止生成没有结果链接的结论。

- [ ] **Step 4: 运行专项测试并提交。**

运行：`node --test tests/social-research-workflow.test.js`  
预期：计划、批准、预算、回退和四种模板测试全部通过。

```powershell
git add prototype/social-research-workflow.js prototype/social-research-prompts.js tests/social-research-workflow.test.js
git commit -m "feat: 增加社媒研究确定性工作流"
```

## Task 3: API 平台适配和结果标准化

**Files:**
- Create: `server/social-api-client.js`
- Create: `server/social-platforms.js`
- Test: `tests/social-api-client.test.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: 写 API 客户端失败测试。**

用注入的 `fetchImpl` 测试：成功响应、非 JSON、401、429、5xx、超时、空结果、字段不完整和来源平台不匹配。断言错误码稳定，响应体不包含 API key。

- [ ] **Step 2: 实现平台配置和客户端。**

固定接口：

```js
createSocialApiClient({ platform, config, fetchImpl, timeoutMs })
listSocialPlatformDefinitions()
normalizeApiSocialResult(platform, item)
normalizeSocialApiError(error)
```

平台定义必须明确：是否有 API、需要的配置字段、最大结果数、支持的字段、是否支持详情和评论。没有 API 的平台不能因为存在通用搜索配置而误标为 API 可用。

- [ ] **Step 3: 接入本地服务但隔离凭证。**

在 `server.js` 增加受限的内部调用入口或复用现有请求结构，要求平台名称为白名单值，结果经过 `normalizeSocialResult()`。禁止把凭证、完整请求头或原始 API 错误传回渲染进程。

- [ ] **Step 4: 运行测试并提交。**

运行：`node --test tests/social-api-client.test.js tests/server.test.js`  
预期：API 成功、失败和不配置降级全部通过。

```powershell
git add server/social-api-client.js server/social-platforms.js server.js tests/social-api-client.test.js tests/server.test.js
git commit -m "feat: 增加社媒 API 适配器"
```

## Task 4: Electron 真实浏览器会话和平台浏览器工具

**Files:**
- Create: `electron/social-browser-manager.js`
- Create: `electron/social-browser-adapters.js`
- Test: `tests/social-browser-manager.test.js`
- Test: `tests/social-browser-adapters.test.js`

- [ ] **Step 1: 写 manager 的注入测试。**

使用假的 `BrowserWindow`、`session`、`app.getPath()` 和时钟，覆盖：按平台和 profile 创建独立 persistent partition、重复打开复用、关闭、清理、状态检查、导航超时和非白名单 URL 拒绝。断言 profile 标识只保存为稳定 ID，不进入研究备份。

- [ ] **Step 2: 实现独立 profile manager。**

固定接口：

```js
createSocialBrowserManager({ BrowserWindow, session, app, now })
openPlatformSession({ platform, profileId, startUrl })
navigateSession(sessionId, url)
getSessionStatus(sessionId)
executeReadOnlyScript(sessionId, scriptName, args)
closeSession(sessionId)
clearPlatformProfile(platform, profileId)
```

使用 `session.fromPartition('persist:forward-step-social-' + platform + '-' + profileId)`；只允许平台白名单 URL。`executeReadOnlyScript` 不接受任意来自渲染进程的 JavaScript 字符串，只接受 adapter 注册的脚本名。

- [ ] **Step 3: 实现浏览器适配器。**

每个平台定义：登录检测、搜索 URL、搜索输入动作、结果提取、详情提取和能力声明。适配器返回统一结果，不把 DOM 节点或完整页面 HTML 直接写入工作区。

固定接口：

```js
createBrowserPlatformAdapters({ manager, waitForNavigation, now })
adapter.checkReady()
adapter.search(query, options)
adapter.fetchDetail(result)
adapter.captureEvidence(result, options)
```

小红书、Reddit、YouTube 首版都必须支持登录状态检查和只读搜索；详情、评论或截图不支持时返回 `unsupported`，不伪造字段。

- [ ] **Step 4: 明确高级会话导入边界。**

第一版不复制 cookies 数据库，也不解析系统浏览器密码。高级导入只允许用户明确提供本机 Chromium 调试连接或选择由应用启动的独立 Chromium profile；仅保存 profile ID 和能力状态。非 loopback 调试地址直接拒绝。

- [ ] **Step 5: 运行测试并提交。**

运行：`node --test tests/social-browser-manager.test.js tests/social-browser-adapters.test.js`  
预期：profile 隔离、只读脚本、登录状态和平台适配器测试通过。

```powershell
git add electron/social-browser-manager.js electron/social-browser-adapters.js tests/social-browser-manager.test.js tests/social-browser-adapters.test.js
git commit -m "feat: 增加社媒真实浏览器工具"
```

## Task 5: IPC、平台准备中心和附件通道

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Create: `electron/social-attachment-store.js`
- Test: `tests/electron-social-research.test.js`
- Test: `tests/electron-smoke.test.js`

- [ ] **Step 1: 写 IPC 白名单测试。**

断言 preload 只暴露以下窄接口：

```js
social.listPlatforms()
social.getStatus(platform)
social.openLogin(platform, profileId)
social.check(platform, profileId)
social.search(platform, payload)
social.fetchDetail(platform, payload)
social.captureEvidence(platform, payload)
social.close(platform, profileId)
social.clearProfile(platform, profileId)
research.saveAttachment(payload)
research.readAttachment(id)
research.deleteAttachment(id)
```

不暴露 `ipcRenderer`、任意脚本执行、任意文件路径读写或凭证读取接口。

- [ ] **Step 2: 实现主进程 IPC。**

API 搜索从主进程安全存储读取配置后调用 `social-api-client.js`；浏览器搜索调用 `social-browser-manager.js` 和已注册 adapter；渲染进程只收到标准化结果和能力状态。

- [ ] **Step 3: 实现附件存储。**

附件写入 `app.getPath('userData')/research-attachments/<taskId>/`，文件名必须由应用生成，不能接受 `..`、绝对路径或任意扩展名。读取、删除和大小限制全部由主进程执行。

- [ ] **Step 4: 运行 Electron 相关测试并提交。**

运行：`node --test tests/electron-social-research.test.js tests/electron-smoke.test.js`  
预期：IPC 白名单、凭证隔离、附件路径安全和取消行为通过。

```powershell
git add electron/main.js electron/preload.js electron/social-attachment-store.js tests/electron-social-research.test.js tests/electron-smoke.test.js
git commit -m "feat: 接入社媒准备和附件 IPC"
```

## Task 6: 研究协调器和模型分析闭环

**Files:**
- Modify: `prototype/app.js`
- Modify: `prototype/storage.js`
- Modify: `prototype/retriever.js`
- Test: `tests/social-research-integration.test.js`

- [ ] **Step 1: 写端到端契约测试。**

使用假的 `social` 工具、假的模型客户端和固定结果，验证：

```text
输入目标 → 生成计划 → 用户确认 → 检查平台 → API/浏览器执行
→ 结果标准化 → 预算判断 → 报告生成 → 用户选择保存
```

必须测试 API 无配置直接用浏览器、API 返回空结果后切换浏览器、API 失败但用户指定 API 时不回退、单平台失败继续其他平台、用户取消后不保存结果。

- [ ] **Step 2: 实现协调器。**

在 `app.js` 中只增加任务协调入口，不直接写平台 DOM 逻辑。协调器调用 `socialResearchWorkflow` 决定状态和连接方式，调用 `desktopApi.social` 执行工具，调用现有 `desktopApi.requestModel` 生成计划和报告，所有状态变化通过 `saveState()` 持久化。

- [ ] **Step 3: 接入资料库保存。**

把用户勾选的研究结果转换为现有 `knowledgeEntries` schema，设置来源平台、来源链接、抓取时间、验证状态和 `sourceType`；不把未确认的整批结果自动写入统一资料库。

- [ ] **Step 4: 运行集成测试并提交。**

运行：`node --test tests/social-research-integration.test.js tests/retriever.test.js tests/storage.test.js`  
预期：研究状态、API 回退、资料保存和恢复行为全部通过。

```powershell
git add prototype/app.js prototype/storage.js prototype/retriever.js tests/social-research-integration.test.js
git commit -m "feat: 接入社媒研究协调器"
```

## Task 7: 研究页面、平台准备 UI、结果集和报告 UI

**Files:**
- Modify: `prototype/index.html`
- Create: `prototype/social-research-ui.js`
- Modify: `prototype/app.js`
- Test: `tests/social-research-ui.test.js`
- Test: `tests/e2e-smoke.test.js`

- [ ] **Step 1: 写静态入口和文案测试。**

断言页面存在：

```text
social-research-entry
social-research-template
social-research-platforms
social-research-plan
social-research-plan-confirm
social-platform-preparation
social-research-status
social-research-results
social-research-report
social-research-save-selection
```

同时断言文案明确：API、真实浏览器、自动回退、独立 profile、只读、登录状态、未核验结果和不会自动发布内容。

- [ ] **Step 2: 实现平台准备 UI。**

每张平台卡提供：API 配置状态、浏览器 profile 状态、连接方式选择、开始登录、重新检查、清除 profile、能力矩阵和最近错误。用户看到“准备完成”前不能确认研究计划。

- [ ] **Step 3: 实现研究计划确认和任务进度。**

显示目标、模板、平台分工、查询词、时间范围、预算和停止条件；用户确认后禁用重复启动，执行中显示当前平台、连接方式、查询词、结果数量和暂停/取消按钮。

- [ ] **Step 4: 实现结果集和报告。**

结果集支持平台、查询词、时间、证据状态、保存状态筛选；每条结果显示标题、摘要、作者、时间、链接、来源方式、抓取时间、营销风险和保存复选框。报告结论必须有结果引用入口。

- [ ] **Step 5: 运行 UI 测试并提交。**

运行：`node --test tests/social-research-ui.test.js tests/e2e-smoke.test.js`  
预期：静态入口、关键文案和任务状态 UI 通过。

```powershell
git add prototype/index.html prototype/social-research-ui.js prototype/app.js tests/social-research-ui.test.js tests/e2e-smoke.test.js
git commit -m "feat: 增加社媒研究工作台"
```

## Task 8: 文档、备份、打包清单和完整回归

**Files:**
- Modify: `README.md`
- Modify: `docs/MVP_SCOPE.md`
- Modify: `docs/PRODUCT_DESIGN.md`
- Modify: `prototype/workspace-backup.js`
- Modify: `package.json`
- Modify: `tests/package-config.test.js`
- Modify: `tests/e2e-smoke.test.js`

- [ ] **Step 1: 补齐产品边界文档。**

明确三平台、四模板、API/浏览器双模式、API 失败回退、独立 profile、只读边界、摘要优先保存、附件保存、凭证排除和未来拆分多 Agent 的提醒条件。

- [ ] **Step 2: 扩展备份测试和构建清单测试。**

断言研究任务、报告、结果摘要和附件元数据可备份恢复；断言浏览器 profile、cookies、session token、API key 和密码不会出现。将新 JS 文件加入 `npm run check`，确认 `package.json` files 只包含运行时目录和入口。

- [ ] **Step 3: 运行完整验证。**

```powershell
npm test
npm run check
git diff --check
```

预期：所有测试通过，语法检查通过，差异检查无输出。

- [ ] **Step 4: 执行 Windows 打包和手动验收。**

```powershell
npm run dist:win
```

确认 `release/` 生成 NSIS 和 portable 文件；在全新 Windows 用户目录验证三平台准备、API/浏览器回退、研究计划确认、暂停/取消、报告引用、附件保存、重启恢复、无网络降级和凭证不进备份。如果构建因下载或签名环境失败，记录具体阶段和错误，不把未生成产物写成成功。

- [ ] **Step 5: 提交集成收口。**

```powershell
git add README.md docs/MVP_SCOPE.md docs/PRODUCT_DESIGN.md prototype/workspace-backup.js package.json tests/package-config.test.js tests/e2e-smoke.test.js
git commit -m "test: 完成社媒研究工作流集成验收"
```

## Definition of Done

- [ ] 单研究 Agent 能生成四种研究模板的计划，并等待用户确认。
- [ ] 小红书、Reddit、YouTube 有统一的平台能力和结果契约。
- [ ] 有 API 的平台默认 API 优先，API 失败或结果不足时可切换浏览器。
- [ ] 没有 API 的平台可直接使用真实浏览器。
- [ ] 用户可以在可视化准备中心登录、检查能力、清除 profile 和查看错误。
- [ ] 浏览器操作只读，不发布、不互动、不绕过验证码或风控。
- [ ] 研究工作流有预算、停止条件、暂停、取消和部分失败状态。
- [ ] 报告与原始结果集同时存在，结论可追溯到来源。
- [ ] 默认只保存摘要，正文、截图和附件需用户主动勾选。
- [ ] 研究结果不会未经确认自动进入资料库。
- [ ] 备份不包含 API key、cookies、session token、密码或浏览器 profile。
- [ ] `npm test`、`npm run check`、`git diff --check` 通过。
- [ ] Windows 打包和手动验收结果真实记录。
