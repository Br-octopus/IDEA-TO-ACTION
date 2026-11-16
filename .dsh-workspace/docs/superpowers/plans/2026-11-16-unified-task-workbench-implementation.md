# 统一任务工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将新任务、提示词 Agent、写作工作台合并为一个可恢复的连续任务工作区，支持文档、PPT、PDF、网页、截图和图片素材，多画布组织，以及可追溯的外部 AI 提示词轮次。

**Architecture:** 保留现有 Electron 桌面壳、`prototype/app.js` 工作台布局、`storage.js` 本地状态和 `ppt-feedback-attachment-store.js` 附件存储。统一工作台任务以桌面 `userData/ppt-feedback/<taskId>/workbench.json` 保存可恢复正文及状态，localStorage 保留任务索引和兼容缓存；原件继续存放在同一任务的附件目录。只对接入统一工作台的任务启用该保存流程，不迁移整个应用的数据仓库。界面仍是左任务列表、中间连续对话、右侧动态预览/画布，不引入第三方无限画布依赖。

**Tech Stack:** Electron, vanilla JavaScript, existing DOM/CSS in `prototype/index.html`, Node `node:test`, existing PDF/Office preview modules, existing backup and attachment IPC.

---

## 范围与文件边界

本计划是一个有依赖顺序的总计划，分成四个可独立验证的交付阶段：数据与保存、连续工作区、画布与素材引用、多格式预览与交付。每个阶段都保留旧任务字段和旧入口，避免一次性替换历史数据。

主要文件边界：

- `prototype/unified-workbench-schema.js`：新增。只负责任务内容、文档版本、画布、节点、提示词轮次的规范化和迁移。
- `prototype/storage.js`：接入新 schema，保留 `forward-step.workspace.v2`、旧字段和读取异常保护。
- `prototype/unified-workbench-prompts.js`：新增。只负责把任务目标、文档/素材快照、批注、构图意图和用户意见组合成外部 AI 提示词上下文。
- `prototype/workbench-canvas.js`：新增。只负责画布节点、位置、分组、选择和构图快照的纯数据操作，不处理 DOM。
- `prototype/workbench-dialogue.js`：复用现有对话解析、轮次和建议逻辑；调用统一提示词上下文。
- `prototype/app.js`：接入任务目录、未命名草稿、预览策略、独立文档、画布操作、保存状态和连续对话。
- `prototype/index.html`：接入新增脚本并调整统一工作区的结构、空态、折叠消息、内容目录、画布和保存状态样式。
- `electron/ppt-feedback-attachment-store.js`：复用并扩展任务清单/目录操作，原件仍按任务保存。
- `electron/main.js`：接入任务目录、清单原子写入、备份导入导出和现有预览/批注 IPC。
- `electron/preload.js`：暴露上述最小桌面 API；主进程新增 IPC 必须同步桥接，不能只注册后台处理器。
- `prototype/workspace-backup.js`：扩展字段白名单、单任务导出闭包及恢复映射；不能假定新增项目字段会自动进入备份。
- `tests/`：只新增或修改受影响的 schema、存储、提示词、画布、备份和工作台 UI 测试；不重跑无关业务套件。

跳过：云同步、协作、专业绘图工具、完整 PPT 编辑器、模型自动调用编排和新的第三方画布框架。它们不属于当前目标。

### 自查补齐的共同契约（2026-11-16）

以下字段为本计划的实施约定，尚未实现；后续任务使用同一命名，避免 UI、存储和提示词各维护一份选择或版本。

| 对象 | 必须保存的字段与规则 |
| --- | --- |
| 任务 | `workbenchSchemaVersion`、`workbenchRevision`、`workbenchContents`、`workbenchCanvases`、`workbenchPromptRounds`、`workbenchDraft`、`workbenchSelection`、`workbenchLegacyRefs`；原任务字段保留 |
| 编辑草稿 | `workbenchDraft` 保存目标、意见、提示词编辑稿、未提交批注；文档自己的 `draft` 保存正文和基于哪个 `versionId` 编辑；每次输入更新草稿，明确留版/交付才追加不可变版本 |
| 本轮使用 | `workbenchSelection` 是独立的持久清单，每项保存 `contentVersionId`、可选 `canvasId/nodeId`、页码/区域定位和包含的批注 ID；`layoutIntent` 保存本轮构图范围。节点的普通选中状态只用于编辑，不作为第二份提示词选材数据 |
| 内容 | `id`、`title`、`kind`、`purpose`（`reference/result`）、`purposeReason`、`draft`、`versions`、`sourceRef`；版本保存 `id`、正文或 `attachmentId`、`hash`、来源定位、解析状态、原文批注、可选 `parentVersionId/roundId/deliveryId` |
| 画布 | `id`、`title`、`purpose`、`viewport`、`groups`、`nodes`；节点保存稳定 `id/contentVersionId`、内容坐标、尺寸、叠放顺序、`groupId`、局部批注；复制生成新画布/节点/局部批注 ID，原件和版本 ID 保持 |
| 提示词轮次 | `id`、`draftText`、`contentVersionIds`、`deliveries`；每个交付记录有 `id/text/materials/annotations/layoutIntent/createdAt`，`materials` 固定显示名称、用途、版本、哈希、页码或区域；后续改名、改用途、改正文均不改历史交付 |
| 保存提示 | `workbenchDraftStatus/workbenchSaveError` 只表示当前写入状态；规范化不能凭缺字段就把未保存内容标成 `saved`，重启后依据恢复结果重建提示 |

旧数据映射不能只给 `projects` 补空数组。现有 `promptAgentTasks` 是独立集合，`writingArticles` 保存 `article/rounds`，`writingWorkspaces` 保存目录来源配置；不能因为 ID 或标题相似就合并。任务 1 在 `workbenchLegacyRefs` 保存 `{ collection, sourceId }`，明确关联或用户选择才接入同一任务，否则列在可访问的历史内容中。保留原集合、历史轮次、专业包和关闭保存的既有设置；不把 `sourceArticleIds` 误当任务归属。迁移前保留旧数据快照，重复运行按来源二元组去重，失败保留旧入口。新任务默认自动保存；旧稿关闭保存时，仅允许用户明确导入已保存版本，不能自动复制其未保存编辑。

回填规则统一为：优先建议最近已交付版本；没有交付时可建议最近准备稿，并标明“未记录交付”；没有可确定对象则独立保存，允许稍后改关联。始终展示可修改的轮次/交付选择，多个结果并列，继续其中一个结果不覆盖其他候选。

### 验证预算与执行约束

每个任务末尾命令表示受影响测试的候选范围，不是每阶段必须全跑的清单。只执行本次实际改动覆盖的文件；通过且未再改动的结果沿用。备份新增数据完整往返只安排在任务 2；任务 6 若仅新增素材包路径，只跑该路径的新用例，不重演备份恢复。任务 1 不为证明文件尚不存在而单独跑一次失败测试。

本轮是文档审查，只检查这两份文档差异，不运行代码测试。实施完成后只做一次连续桌面操作；同等开发记录可直接计入，浏览器操作不替代 Electron 重启与落盘检查。两次连续跨模块修复仍阻塞时说明阻塞和所需决定，不扩大盲目重试。

下方提交命令仅为相关文件和提交信息建议。执行前检查同文件中既有改动，按本任务实际差异暂存；禁止直接整文件夹带用户改动。是否使用子智能体按可独立交付边界决定，不把选择执行方式作为必须再次询问的关卡。

### Task 1: 建立统一工作台数据契约与旧任务迁移

**Files:**
- Create: `prototype/unified-workbench-schema.js`
- Modify: `prototype/storage.js`
- Modify: `prototype/index.html`
- Test: `tests/unified-workbench-schema.test.js`
- Test: `tests/storage.test.js`

- [x] **Step 1: 写迁移失败测试和边界测试**

在 `tests/unified-workbench-schema.test.js` 中加入以下最小契约：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../prototype/unified-workbench-schema.js');

test('旧项目得到空的统一工作台结构且保留原字段', () => {
  const project = schema.normalizeWorkbenchProject({ id: 'p1', idea: '复刻一个 APP' });
  assert.equal(project.id, 'p1');
  assert.equal(project.idea, '复刻一个 APP');
  assert.deepEqual(project.workbenchContents, []);
  assert.deepEqual(project.workbenchCanvases, []);
  assert.deepEqual(project.workbenchPromptRounds, []);
  assert.deepEqual(project.workbenchSelection.items, []);
});

test('内容、版本、画布节点和提示词轮次使用稳定 ID', () => {
  const project = schema.normalizeWorkbenchProject({
    id: 'p1',
    workbenchContents: [{ id: 'content-1', versions: [{ id: 'version-1', hash: 'sha256:x' }] }],
    workbenchCanvases: [{ id: 'canvas-1', nodes: [{ id: 'node-1', contentVersionId: 'version-1' }] }],
    workbenchPromptRounds: [{ id: 'round-1', contentVersionIds: ['version-1'] }]
  });
  assert.equal(project.workbenchContents[0].id, 'content-1');
  assert.equal(project.workbenchCanvases[0].nodes[0].contentVersionId, 'version-1');
  assert.deepEqual(project.workbenchPromptRounds[0].contentVersionIds, ['version-1']);
});
```

- [x] **Step 2: 核对迁移样本与备份字段**

同一个迁移用例补入旧稿轮次、独立提示词任务与一次重复迁移；断言来源关联不重复、旧 ID 和正文保留。相关测试在 Step 5 一次运行，不单独执行缺模块检查。

- [x] **Step 3: 实现最小数据契约**

新模块导出 `WORKBENCH_SCHEMA_VERSION = 1`，以及以下有明确输入输出的接口；不将空函数体视为实现：

| 接口 | 输入 → 输出及关键行为 |
| --- | --- |
| `normalizeWorkbenchProject(project)` | 原项目 → 保留旧字段并补齐共同契约的项目；不写磁盘、不制造来源关联 |
| `normalizeWorkbenchContent(content)` / `normalizeWorkbenchContentVersion(version)` | 内容/版本 → 保留稳定 ID、全文、来源与解析状态的规范记录；不截断正文冒充完整内容 |
| `normalizeWorkbenchCanvas(canvas)` / `normalizeWorkbenchCanvasNode(node)` | 画布/节点 → 独立排列、视角和局部批注，版本引用不跟随最新版 |
| `normalizeWorkbenchPromptRound(round)` | 轮次 → 保留准备稿与不可变交付快照；缺失引用报告错误，不静默删素材 |
| `migrateWorkbenchProject(project, legacyRecords)` | 项目及明确关联的原记录 → 带来源映射的项目；保留旧集合，重复迁移结果相同 |

规范化结果按共同契约补齐，`workbenchSelection` 默认 `{ items: [], layoutIntent: { enabled: false } }`。用途属于内容当前状态，交付时写入快照；节点不保存另一份 `selectedForPrompt`。未知字段保留在项目对象中，敏感模型字段继续由现有 `stripModelKeys` 处理。模块沿用现有 UMD 写法，在 Node 导出 `module.exports`，浏览器暴露 `ForwardStepUnifiedWorkbenchSchema`，避免浏览器直接执行裸 `module.exports`。

- [x] **Step 4: 接入存储迁移并补充旧状态往返测试**

在 `prototype/storage.js` 的 `withProjectDefaults` 中调用一次 `normalizeWorkbenchProject`，`migrateState` 沿用该调用路径，不重复规范化、不提升现有顶层 schema 版本。规范化保持纯函数，不在每次读取时创建新 ID 或执行迁移写入；显式接入旧内容时再创建映射。将新模块的 `<script>` 放在 `storage.js` 前，Node 分支使用 `require`。

在 `tests/storage.test.js` 增加一个用例：旧任务、未发送 `conversationDraft`、既有 `workbenchAttachmentIds` 和旧提示词版本保存后再次 `loadState`，新增字段存在且旧字段值不变。

- [ ] **Step 5: 运行阶段测试并提交**

运行：

```powershell
node --test tests/unified-workbench-schema.test.js tests/storage.test.js
git diff --check
git add prototype/unified-workbench-schema.js prototype/storage.js prototype/index.html tests/unified-workbench-schema.test.js tests/storage.test.js
git commit -m "feat: 增加统一工作台数据契约"
```

预期：新增契约和存储往返用例 PASS；不修改旧项目的 ID、对话、附件和提示词版本。

### Task 2: 完成任务内容持久化、原件目录和备份入口

**Files:**
- Modify: `electron/ppt-feedback-attachment-store.js`
- Modify: `electron/main.js`
- Modify: `electron/workspace-backup-archive.js`
- Modify: `electron/preload.js`
- Modify: `prototype/workspace-backup.js`
- Modify: `prototype/app.js`
- Test: `tests/workspace-backup.test.js`
- Test: `tests/electron-workbench-backup.test.js`
- Test: `tests/electron-ppt-main-annotation.test.js`

- [x] **Step 1: 先写任务清单原子写入与恢复测试**

在 `tests/electron-workbench-backup.test.js` 增加一个临时 `userData` 用例，验证：写入任务清单后可读；写入失败时旧清单仍可读；备份导出包含清单和附件；导入 ID 冲突时生成独立任务映射，不覆盖原目录。

测试调用现有 `loadMain({ userData, archivePath })` harness，不启动真实窗口；不要新增第二套 Electron mock。

- [x] **Step 2: 实现 manifest 和目录操作**

在 `electron/ppt-feedback-attachment-store.js` 增加 `saveTaskManifest(taskId, manifest)`（写入后返回 revision）、`readTaskManifest(taskId)`（返回校验后的记录）、`listTaskManifests()`（枚举合法任务目录并分别报告损坏记录）和 `getTaskDirectory(taskId)`（校验 ID 后返回受控目录）。

manifest 写入 `userData/ppt-feedback/<taskId>/workbench.json`，先写同目录临时文件，再使用同目录替换。保存 `{ schemaVersion, taskId, revision, project }`，`project` 包含恢复任务必需的目标、对话、正文、草稿、画布和交付快照，不只存索引；二进制仍以附件 ID 引用。继续复用现有 `saveAttachment`、`listAttachments`、删除恢复和大小/类型校验。

同任务写入串行，旧 revision 不得覆盖新 revision。主进程写入成功后，渲染端才通过已有 `persistWorkbenchState(nextState, options)` 更新 localStorage 兼容缓存，两者完成才显示“已保存”。磁盘成功而缓存失败时保留明确失败提示，重试只补缓存；启动时列出任务 manifest，按 revision 补齐落后的缓存，恢复未进入索引的新任务。坏文件不替换可读缓存，保留文件和恢复提示。任务被删除/归档时同步其 manifest 状态，避免下次扫描复活。新建附件但关联失败时保留待关联附件 ID，重试不重复导入。

- [x] **Step 3: 暴露最小 IPC 并接入备份**

在 `electron/main.js` 注册 `workbench:list-manifests`、`workbench:read-manifest`、`workbench:save-manifest`、`workbench:open-task-folder`，并在 `electron/preload.js` 的 `desktopApi.workbench` 暴露 `listManifests/readManifest/saveManifest/openTaskFolder`。校验任务 ID、revision 和结构；目录由主进程根据任务 ID 计算，渲染端不传任意目录。保存成功返回 `{ status: 'ok', revision }`，失败返回明确错误。打开目录使用现有 Electron shell API；浏览器开发模式不伪造成功。

扩展现有 workspace backup 的 data/attachments 清单，让 `workbench.json` 随任务数据和附件一起导出、导入、回滚；导入时重写任务 ID 和所有内容/画布/轮次引用，恢复失败沿用当前 journal 回滚逻辑。

同步更新 `prototype/workspace-backup.js` 的 `PROJECT_FIELDS` 及相关嵌套字段白名单、创建/校验/合并路径；纳入实际存在的 `writingWorkspaces` 与所引用写作记录，保留凭证清洗。新增字段不能因白名单缺漏而被静默过滤。只针对冲突 ID 生成映射，并重写附件目录、节点、批注、轮次、交付及来源引用；无冲突 ID 保持，未解析引用明确报错。

“导出任务”复用归档机制但只收集当前任务和其引用闭包，不能直接导出整个工作区。恢复沿用已有事务，失败回滚本次安装；素材包另走任务 6 的所选素材范围。一次备份往返同时断言正文、未命名草稿、两画布、独立批注、交付快照和来源映射，避免按格式重复往返。

- [x] **Step 4: 补充写入中断恢复用例并运行**

运行：

```powershell
node --test tests/electron-workbench-backup.test.js tests/workspace-backup.test.js
```

预期：新增清单原子写入、缓存失败补齐、冲突导入和回滚用例 PASS；复用现有 harness 加载 preload 校验桥接，不另建测试框架。中断模拟不称为真实断电验证。

- [ ] **Step 5: 提交**

```powershell
git add electron/ppt-feedback-attachment-store.js electron/main.js electron/preload.js electron/workspace-backup-archive.js prototype/workspace-backup.js prototype/app.js tests/electron-workbench-backup.test.js tests/workspace-backup.test.js
git commit -m "feat: 持久化统一工作台任务清单"
```

### Task 3: 统一提示词上下文与外部结果轮次

**Files:**
- Create: `prototype/unified-workbench-prompts.js`
- Modify: `prototype/workbench-dialogue.js`
- Modify: `prototype/app.js`
- Modify: `prototype/index.html`
- Test: `tests/unified-workbench-prompts.test.js`
- Test: `tests/writing-workbench-prompts.test.js`

- [x] **Step 1: 写提示词快照测试**

在 `tests/unified-workbench-prompts.test.js` 验证同一输入产生稳定快照：

```js
const prompt = prompts.buildUnifiedPrompt({
  goal: '把截图复刻成网页',
  selectedContents: [{ id: 'v1', title: '首页截图', kind: 'image', hash: 'sha256:1' }],
  annotations: [{ id: 'a1', contentVersionId: 'v1', comment: '保留顶部导航' }],
  feedback: '按钮改成绿色',
  layoutIntent: { enabled: false }
});
assert.match(prompt.text, /任务目标：把截图复刻成网页/);
assert.match(prompt.text, /保留顶部导航/);
assert.deepEqual(prompt.contentVersionIds, ['v1']);
assert.equal(prompt.layoutIntent.enabled, false);
```

另测：未选素材显示“本轮未附素材”；启用“按此构图”时快照包含相对位置/比例；未读取文件只写状态，不写成已理解正文。

- [x] **Step 2: 实现统一提示词构建器**

实现并导出 `buildUnifiedPrompt(input)`，返回 `{ text, contentVersionIds, layoutIntent }`；`buildMaterialManifest(selectedContents)` 返回固定版本、哈希、来源定位和可读状态的素材清单；`snapshotPromptRound(input)` 根据共同契约创建包含实际正文与素材/批注副本的交付记录，追加到轮次的 `deliveries`，不保留对可变编辑对象的引用。

构建器只组合任务目标、已确认要求、用户补充、所选内容版本、来源定位、批注和构图意图；不执行外部模型、不把导入资料当系统指令。复制/导出时由 `snapshotPromptRound` 固定正文和素材版本。

- [x] **Step 3: 接入现有对话和写作规则**

让 `workbench-dialogue.js` 的现有建议/追问结果继续进入统一上下文；`app.js` 的 `buildWorkbenchPrompt` 调用新构建器，再把领域规则和现有批注批次作为输入。保留 `buildModificationPrompt` 的旧调用路径，旧项目没有新画布字段时仍生成旧格式提示词。

提示词准备稿、复制版本和外部回填版本分开保存；复制不代表外部模型已执行。回填入口默认关联最近的已交付轮次，无法确定时保存为独立候选。

回填具体优先级遵从共同契约，允许关联未交付准备稿。未配置模型时使用本地构建器输出基础提示词；配置可用时才由现有提示词 Agent/写作规则增强，统一按钮按目标选规则，不按输入格式锁定输出。新增模块均沿用 UMD，浏览器全局分别为 `ForwardStepUnifiedWorkbenchPrompts`、`ForwardStepWorkbenchCanvas`。

按 `contentVersionId + annotationId` 去重原文批注；局部批注按 `canvasId + nodeId + annotationId` 区分，冲突意见带来源保留。仅选中的批注进入交付。编辑后的原文锚点失效时保留旧引文并标记需重新定位，不猜测新位置。

复制/导出前持久化本次正文与素材快照；剪贴板/导出返回成功才登记成功交付，失败保留准备记录并显示原因。实际外发成功但状态记录失败时提示状态未落盘，保留快照并可重试登记，不能宣称外部动作被撤销。后台生成带发起任务 ID、轮次和草稿 revision，完成后落回原任务；草稿已修改则存候选，不覆盖手改稿，不因切任务抢开预览。

- [ ] **Step 4: 运行定向测试并提交**

运行：

```powershell
node --test tests/unified-workbench-prompts.test.js tests/writing-workbench-prompts.test.js
```

预期：新增快照和旧提示词保护测试 PASS，旧领域规则测试不回归。

```powershell
git add prototype/unified-workbench-prompts.js prototype/workbench-dialogue.js prototype/app.js prototype/index.html tests/unified-workbench-prompts.test.js tests/writing-workbench-prompts.test.js
git commit -m "feat: 统一工作台提示词轮次"
```

### Task 4: 接入连续对话、独立文档和保存状态

**Files:**
- Modify: `prototype/app.js`
- Modify: `prototype/index.html`
- Modify: `prototype/workbench-dialogue.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Test: `tests/workbench-dialogue.test.js`
- Test: `tests/workbench-agent-persistence.test.js`
- Test: `tests/workbench-view-state.test.js`

- [x] **Step 1: 写连续工作区行为测试**

在现有 UI/状态测试中补最小断言：非空目标在首次发送前写入未命名任务草稿；长粘贴提供“转为文档”且不覆盖意见；前轮折叠后可展开；引用文本带来源/版本；保存失败保持编辑内容和 `workbenchSaveError`。

- [x] **Step 2: 实现任务草稿与保存指示**

在 `app.js` 维护共同契约中的草稿和保存状态。输入后 500 ms 合并保存，连续输入最长 2 s 提交一次，使用按任务串行的保存队列和任务 2 的落盘顺序；不把现有仅写 localStorage 的 `persistWorkbenchState` 返回视为桌面保存完成。失败保留内存/编辑内容，停止自动重试并提供重试、导出。切任务、关闭编辑器、正常退出前提交待保存内容；失败可留在当前编辑、导出或明确放弃，不静默清空。退出接入主进程窗口关闭事件及 preload 确认，不依赖异步 `beforeunload` 写入必定完成。空白新任务不创建记录，首次非空目标创建未命名项目。

- [x] **Step 3: 实现连续消息与预览策略**

保留同一 composer 接收短回复/修改意见；长正文通过“添加内容 → 新建粘贴文档”编辑。前轮消息使用 `<details>` 或现有折叠模式保存，不删除内容。实现预览规则：已展开且未固定时导入/准备完成自动切换；固定、主动关闭或窄屏输入时不抢占；内容卡片显式点击可重新打开。

未保存/正在编辑的旧轮次不折叠；批量导入只打开首份可预览内容。显式点击可替换固定内容并保持固定；窄屏返回恢复草稿、滚动与焦点。文稿/PPT/PDF/网页回填独立预览；图片结果推荐当前结果画布，用户可改选或新建。异步解析捕获发起任务及内容版本，迟到结果不写入当前别的任务。

- [x] **Step 4: 实现双入口内容目录**

在 `renderWorkbench` 中增加“本任务内容”目录，按文档、文件、画布、提示词筛选；对话内卡片和目录都只引用同一稳定 ID。移除重复“你的任务/计划工作台/从第一步开始”说明，已有任务显示任务名，布局切换保持工具栏最右侧；空预览只保留一个说明和“添加内容”。浏览器批注蓝色编号不渲染为产品控件。

- [x] **Step 5: 实现独立粘贴文档和用途切换**

文档编辑器在首次输入时创建可恢复未命名文档，支持命名、选文批注、取消/保存和关闭后恢复；正文不混入修改意见。导入后卡片显示“参考资料/外部结果”及默认原因，一键切换只改变用途字段；原件、正文、批注、版本不变。直接长粘贴到 composer 时提供转文档操作，成功后才移除转移文本。

关闭/取消编辑只关闭视图并保留自动保存草稿；明确删除是独立操作。新建第二份文档不覆盖第一份，移除对话卡片不删除正文。整理阶段默认参考资料，准备交付后默认外部结果并展示依据；改用途不修改历史快照。已确认创作条件沿任务保存，下一轮只追问缺失且影响输出的条件。

三入口融合需要同时修改导航和事件：新建任务、提示词 Agent 新建、写作工作台新建均进入同一连续工作区；原有领域规则仍由现有模块调用，历史入口保留到对应内容可在新目录访问。统一入口可用后收起重复的新建入口，而不是保留三个并行工作流程。

- [ ] **Step 6: 运行定向测试并提交**

运行：

```powershell
node --test tests/workbench-dialogue.test.js tests/workbench-agent-persistence.test.js tests/workbench-view-state.test.js
```

预期：旧对话、布局、草稿和提示词保存测试 PASS；新增未命名草稿、折叠消息、用途切换和预览固定规则 PASS。

```powershell
git add prototype/app.js prototype/index.html prototype/workbench-dialogue.js electron/main.js electron/preload.js tests/workbench-dialogue.test.js tests/workbench-agent-persistence.test.js tests/workbench-view-state.test.js
git commit -m "feat: 合并任务对话与内容预览"
```

### Task 5: 实现多画布纯数据操作与画布界面

**Files:**
- Create: `prototype/workbench-canvas.js`
- Modify: `prototype/app.js`
- Modify: `prototype/index.html`
- Test: `tests/workbench-canvas.test.js`
- Test: `tests/workbench-drawing.test.js`

- [x] **Step 1: 写画布操作测试**

覆盖以下纯函数行为：新建空画布会保存；同一内容版本可被两张画布引用；移动/缩放/分组只改变当前画布；移除节点不删除任务内容；复制画布复制排列和批注但保持原件/版本 ID；`captureLayoutIntent` 只在显式启用时返回相对位置、比例和叠放顺序。

- [x] **Step 2: 实现 `workbench-canvas.js`**

导出以下无 DOM 操作，返回新对象供既有保存入口提交：

| 接口 | 返回与行为 |
| --- | --- |
| `createCanvas(input)` | 带稳定 ID 的空画布，主动新建即进入保存队列 |
| `addCanvasNode(canvas, node)` / `updateCanvasNode(canvas, nodeId, patch)` | 更新后的画布；仅修改指定节点的位置、尺寸、分组或局部批注，不改原件 |
| `removeCanvasNode(canvas, nodeId)` | 移除该引用后的画布，不删除内容版本 |
| `copyCanvas(canvas, input)` | 新画布及新节点/局部批注 ID，保持原件版本引用 |
| `setPromptSelection(selection, item, selected)` | 勾选/移除后的持久选材清单，不改变普通节点选中状态 |
| `captureLayoutIntent(canvas, nodeIds, enabled)` | 未启用返回 `{ enabled: false }`；启用返回范围边界、相对位置/比例和叠放顺序，忽略视角平移缩放 |

所有位置统一保存为画布坐标；节点局部批注归画布节点，原文档批注仍归内容版本。函数返回新对象，不直接修改任务全局状态。

`setPromptSelection` 的输入输出是 `workbenchSelection`，不是临时节点选中状态。原件在任务内共用，跨画布同原件去重导出；来自不同节点的局部意见仍各自保留。删除内容/画布采用保留历史引用的移除标记，已交付版本仍可回看；升级素材版本必须显式替换节点引用。

- [x] **Step 3: 接入画布 UI**

在右侧预览中增加画布切换、新建、重命名、复制、拖入/文件选择、移动缩放、框选批注、分组、对比和本轮素材选择。画布不铺成永久页签；选中素材进入“本轮使用”清单，普通点击/拖动/切换画布不改变清单。加入撤销/重做、移除节点、取消分组和键盘操作；触屏或窄屏提供放大查看与返回对话入口。

- [x] **Step 4: 接入构图和跨画布引用**

实现“按此构图”开关；只对选定分组/选区写入提示词。画布普通缩放为视角变化，节点尺寸调整为内容变化；区域批注使用内容坐标，缩放后重新渲染不漂移。跨画布引用只复用原件，不删除其他画布节点。

- [ ] **Step 5: 运行定向测试并提交**

运行：

```powershell
node --test tests/workbench-canvas.test.js tests/workbench-drawing.test.js
```

预期：画布纯数据测试 PASS，既有批注绘制测试保持 PASS。

```powershell
git add prototype/workbench-canvas.js prototype/app.js prototype/index.html tests/workbench-canvas.test.js tests/workbench-drawing.test.js
git commit -m "feat: 增加统一工作台多画布"
```

### Task 6: 接入多格式成果预览、素材包和最终定向复核

**Files:**
- Modify: `prototype/app.js`
- Modify: `prototype/index.html`
- Modify: `electron/ppt-feedback-attachment-store.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `prototype/workspace-backup.js`
- Test: `tests/electron-ppt-main-annotation.test.js`
- Test: `tests/electron-workbench-backup.test.js`
- Test: `tests/workbench-viewer-layout.test.js`

- [x] **Step 1: 接入类型状态与预览入口**

沿用现有 HTML、PDF、DOCX、PPTX、PNG/JPG/JPEG/WebP 预览和批注逻辑。内容卡片显示 `已读正文 / 仅预览 / 仅原件 / 解析失败`，解析失败保留原件和重试。网址生成静态快照并显示来源；不把静态 HTML 当成可运行 APP。PPT 使用页缩略图/当前页，PDF 使用文字层或区域批注，图片/截图使用单图或画布。

现有附件 `FORMATS` 尚无 TXT/MD；本任务明确补文件选择、类型/大小限制、UTF-8 文本读取和正文预览，原字节仍保留。图片拖放/粘贴复用受控导入流程，新增接收字节 IPC 必须同步 preload，主进程校验长度与真实图片类型，不接受任意源路径。PPT/PDF 页与文字片段放入画布时保存版本/页码/片段并可返回原内容。扫描 PDF 保留图像引用；网址抓取失败保留 URL 和可重试状态。

- [x] **Step 2: 实现素材包导出**

在任务内容菜单增加“导出本轮素材包”。导出包括：已固定的提示词正文、文件对应表、实际选中的原件/页面区域图、构图参考图（启用时）和来源版本；不写入本机绝对路径或模型凭证。若当前能力只能导出完整原件，导出前明确范围并允许排除，不悄悄扩大材料范围。

主进程导出入口与 `desktopApi.workbench` 同步添加。构图参考图由本轮选区的内容坐标渲染，文件以稳定编号区分同名素材，清单对应提示词中的编号。缺原件或构图图生成失败时停止完整成功提示，保留已准备快照并允许只重试失败导出；排除素材会形成新的交付快照，不能改变旧清单。

- [x] **Step 3: 接入保存位置和导出状态**

对桌面环境调用 `workbench:open-task-folder`，浏览器/草图显示“临时演示，未接入桌面保存”而不是伪造成功。任务导出沿用现有 workspace backup；文件、画布、批注和提示词清单都在同一稳定 ID 图中。

- [x] **Step 4: 运行唯一连续界面复核**

只启动一次现有开发桌面/浏览器入口，完成：输入目标但不发送 → 新建未命名文档 → 导入一张图片 → 新建两张画布并跨画布引用 → 生成/复制提示词 → 导入外部结果 → 切换用途 → 关闭并重启恢复。顺手检查固定预览、窄屏返回和键盘撤销；不重新走全部历史业务、不重新测试每种文件格式。

- [ ] **Step 5: 运行受影响测试并提交**（定向测试与差异检查已完成；提交暂缓）

运行：

```powershell
node --test tests/electron-ppt-main-annotation.test.js tests/workbench-viewer-layout.test.js
git diff --check
git status --short
```

预期：受影响测试 PASS；素材包用例只在对应改动后运行，任务 2 已通过的备份往返不重复执行。`git status` 保留本任务及用户已有改动，不回滚、不混入无关文件。

```powershell
git add prototype/app.js prototype/index.html prototype/workspace-backup.js electron/ppt-feedback-attachment-store.js electron/main.js electron/preload.js tests/electron-ppt-main-annotation.test.js tests/workbench-viewer-layout.test.js
git commit -m "feat: 完成统一任务工作台交付"
```

## 自审清单

- **设计覆盖：**第 1 任务覆盖稳定 ID、旧任务兼容和本机保存基础；第 2 任务覆盖原件目录、原子写入、打开位置、备份和恢复；第 3 任务覆盖统一提示词、选材快照、构图意图和外部结果轮次；第 4 任务覆盖连续对话、双入口、独立文档、用途默认、空态和预览固定；第 5 任务覆盖多画布、共享原件、独立批注、构图和键盘/窄屏；第 6 任务覆盖六类内容预览、素材包和一次连续界面复核。
- **历史批注覆盖：**连续工作区、同一输入框短回复、长正文独立文档、导入后用途默认、两入口、轻量画布、六类内容、生图/UI 复刻、跨类型转换、多画布、旧任务接入、手改保护和失败重试均有对应任务；浏览器蓝色批注标记作为审阅标记处理，不实现为产品控件。
- **测试控制：**每个阶段只运行受影响测试；最终只做一次连续界面操作。已有测试未受改动时沿用结果，不执行全量测试、重复格式验收、重复付费模型调用或重新打包。
- **未完成能力：**计划完成前，云同步、协作、专业绘图、完整 PPT 编辑、模型自动执行和真实格式保真仍不属于交付范围；PPT/Office 复杂内容和外部模型实际执行结果需要在交付中单独标注。

## 执行交接

实现已在 D:/VScode/项目/提示词工具接入统一数据契约、任务内容/草稿持久化、附件 manifest、提示词快照、多画布、预览和备份桥接。
本轮最终定向验证：`node --test tests/electron-ppt-main-annotation.test.js tests/workbench-viewer-layout.test.js` 通过，17 项通过、0 失败；`git diff --check` 通过。先前记录的 14 个相关测试文件及页面布局结果未重复运行。
连续桌面流程已完成并在 D 盘 4175 实例重启后恢复：保存文档、导入一张测试 PNG、建立两张共享内容版本的画布、生成并复制提示词、保存外部结果版本并切换用途；恢复后任务为 saved、revision 36，含 3 项内容、2 张画布、1 轮提示词。此流程未覆盖真实系统文件选择器。
未覆盖：真实文件选择器路径、外部模型实际执行（桌面模型未配置）、复杂 Office 格式保真；云同步、协作、专业绘图和完整 PPT 编辑仍不属于本次范围。
未提交：D 盘目标工作树位于 main 且已有未提交改动，未执行 add/commit，避免混入既有修改。C 盘 task-workbench-merge 是不同工作树，`prototype/app.js` 与 D 盘版本不同，本次不做跨树覆盖或同步。

入口复核补记（2026-11-16）：统一任务首页已存在，但桌面与窄屏主导航仍把“提示词 Agent”和“写作工作台”作为并列入口，未满足三入口融合。现将二者从主导航收起并放入“旧版工作台/更多”作为兼容访问，不删除旧页面或数据。旧版页面内容迁入统一任务目录、旧建任务事件全部重接到统一工作区仍未完成，不能据此标记融合工作全部完成。

## 最新批注核对（545e9bd0-c249-4998-8f32-d91866b2a57e）

| 批注关注点 | 设计位置 | 实施落点与本次补齐 |
| --- | --- | --- |
| 回填保持独立预览、不抢固定预览 | 3、4.2 | Task 4 Step 3：补批量导入、图片结果推荐去向和异步归属 |
| 本轮使用独立保存、切画布不误改 | 4.1、4.4 | 共同契约、Task 1/5：独立 `workbenchSelection`，去掉节点重复选材字段 |
| 原文/画布局部批注区分且不重复覆盖 | 4.4、5 | Task 3/5：明确去重键、失效锚点、复制后的新 ID 和历史保护 |
| 实际交付版本、保存失败、任务切换、备份冲突 | 5、8 | Task 2/3/4：补桥接、正文落盘、revision、备份白名单及可修改的回填关联 |
| 重复标题、布局靠右、任务名、侧栏空态 | 3 | Task 4 Step 4：保留；无需新增视觉验收关卡 |
| 精简测试与验收 | 7 | 验证预算、Task 1/2/6：去掉缺模块失败检查和最终重复备份往返，保留一次连续桌面操作 |

续跑复核更新（2026-11-16）：`electron/preload.js` 已桥接工作台任务清单与素材包 API，`prototype/workspace-backup.js` 使用显式字段白名单；桌面任务清单按 revision 串行写入，确认 manifest 后回写本地缓存并更新保存状态。TXT/MD 已接入附件类型与大小校验、桌面文件选择导入、UTF-8 版本校验和正文预览；`node --test tests/electron-ppt-preview.test.js tests/electron-workbench-backup.test.js` 33 项通过。回归曾发现长粘贴转换按钮缺失时工作台初始化崩溃，`prototype/app.js` 已改为可选监听；`node --test tests/storage.test.js tests/workbench-long-paste.test.js` 51 项通过。真实系统文件选择器、外部模型实际执行与复杂 Office 格式保真仍未验证；本轮未提交，保留 D 盘工作树既有改动。
