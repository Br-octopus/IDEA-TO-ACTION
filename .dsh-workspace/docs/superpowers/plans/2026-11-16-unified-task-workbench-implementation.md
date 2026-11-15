# 统一任务工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将新任务、提示词 Agent、写作工作台合并为一个可恢复的连续任务工作区，支持文档、PPT、PDF、网页、截图和图片素材，多画布组织，以及可追溯的外部 AI 提示词轮次。

**Architecture:** 保留现有 Electron 桌面壳、`prototype/app.js` 工作台布局、`storage.js` 本地状态和 `ppt-feedback-attachment-store.js` 附件存储。新增一个小型工作台数据契约模块，把任务内容、画布节点和提示词轮次以稳定 ID 关联；文本/状态写入现有任务状态，二进制原件继续写入 Electron `userData/ppt-feedback/<taskId>/`，任务清单与批注通过现有备份机制导出恢复。界面仍是左任务列表、中间连续对话、右侧动态预览/画布，不引入第三方无限画布依赖。

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
- `tests/`：只新增或修改受影响的 schema、存储、提示词、画布、备份和工作台 UI 测试；不重跑无关业务套件。

跳过：云同步、协作、专业绘图工具、完整 PPT 编辑器、模型自动调用编排和新的第三方画布框架。它们不属于当前目标。

### Task 1: 建立统一工作台数据契约与旧任务迁移

**Files:**
- Create: `prototype/unified-workbench-schema.js`
- Modify: `prototype/storage.js`
- Modify: `prototype/index.html`
- Test: `tests/unified-workbench-schema.test.js`
- Test: `tests/storage.test.js`

- [ ] **Step 1: 写迁移失败测试和边界测试**

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
  assert.equal(project.workbenchDraftStatus, 'saved');
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

- [ ] **Step 2: 运行测试确认契约尚不存在**

运行：`node --test tests/unified-workbench-schema.test.js`

预期：FAIL，提示 `Cannot find module '../prototype/unified-workbench-schema.js'` 或缺少规范化函数。

- [ ] **Step 3: 实现最小数据契约**

在新模块中实现并导出这些函数：

```js
const WORKBENCH_SCHEMA_VERSION = 1;

function normalizeWorkbenchProject(project = {}) {}
function normalizeWorkbenchContent(content = {}) {}
function normalizeWorkbenchContentVersion(version = {}) {}
function normalizeWorkbenchCanvas(canvas = {}) {}
function normalizeWorkbenchCanvasNode(node = {}) {}
function normalizeWorkbenchPromptRound(round = {}) {}
function migrateWorkbenchProject(project = {}) {}

module.exports = {
  WORKBENCH_SCHEMA_VERSION,
  normalizeWorkbenchProject,
  normalizeWorkbenchContent,
  normalizeWorkbenchContentVersion,
  normalizeWorkbenchCanvas,
  normalizeWorkbenchCanvasNode,
  normalizeWorkbenchPromptRound,
  migrateWorkbenchProject
};
```

规范化结果必须包含：`workbenchContents`、`workbenchCanvases`、`workbenchPromptRounds`、`workbenchDraft`、`workbenchDraftStatus`、`workbenchSaveError`；内容版本保存 `hash`、来源类型、来源定位和用途；画布节点保存 `contentVersionId`、位置、尺寸、分组、`selectedForPrompt` 和局部批注；轮次保存实际提示词正文、素材版本 ID、批注快照和构图意图。未知字段保留在项目对象中，敏感模型字段继续由现有 `stripModelKeys` 处理。

- [ ] **Step 4: 接入存储迁移并补充旧状态往返测试**

在 `prototype/storage.js` 的 `withProjectDefaults` 和 `migrateState` 中调用 `normalizeWorkbenchProject`，不提升现有顶层 schema 版本；旧项目缺字段时补空数组，已有字段逐项规范化。将 `prototype/unified-workbench-schema.js` 以 `<script>` 放在 `storage.js` 前，并在 Node 分支使用 `require`。

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
- Test: `tests/electron-workbench-backup.test.js`
- Test: `tests/electron-ppt-main-annotation.test.js`

- [ ] **Step 1: 先写任务清单原子写入与恢复测试**

在 `tests/electron-workbench-backup.test.js` 增加一个临时 `userData` 用例，验证：写入任务清单后可读；写入失败时旧清单仍可读；备份导出包含清单和附件；导入 ID 冲突时生成独立任务映射，不覆盖原目录。

测试调用现有 `loadMain({ userData, archivePath })` harness，不启动真实窗口；不要新增第二套 Electron mock。

- [ ] **Step 2: 实现 manifest 和目录操作**

在 `electron/ppt-feedback-attachment-store.js` 增加：

```js
async function saveTaskManifest(taskId, manifest) {}
function readTaskManifest(taskId) {}
function getTaskDirectory(taskId) {}
```

manifest 写入 `userData/ppt-feedback/<taskId>/workbench.json`，先写同目录临时文件，再使用同目录替换；内容只含规范化的文档/版本/画布/轮次索引，不嵌入二进制原件。继续复用现有 `saveAttachment`、`listAttachments`、删除恢复和大小/类型校验。

- [ ] **Step 3: 暴露最小 IPC 并接入备份**

在 `electron/main.js` 注册 `workbench:read-manifest`、`workbench:save-manifest`、`workbench:open-task-folder`，保存成功才返回 `{ status: 'ok' }`，失败返回明确错误。打开目录使用现有 Electron shell API；浏览器开发模式不伪造成功。

扩展现有 workspace backup 的 data/attachments 清单，让 `workbench.json` 随任务数据和附件一起导出、导入、回滚；导入时重写任务 ID 和所有内容/画布/轮次引用，恢复失败沿用当前 journal 回滚逻辑。

- [ ] **Step 4: 补充断电/重启恢复测试并运行**

运行：

```powershell
node --test tests/electron-workbench-backup.test.js tests/electron-ppt-main-annotation.test.js
```

预期：现有附件、批注和备份测试保持 PASS；新增清单原子写入、冲突导入和回滚用例 PASS。

- [ ] **Step 5: 提交**

```powershell
git add electron/ppt-feedback-attachment-store.js electron/main.js electron/workspace-backup-archive.js tests/electron-workbench-backup.test.js tests/electron-ppt-main-annotation.test.js
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

- [ ] **Step 1: 写提示词快照测试**

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

- [ ] **Step 2: 实现统一提示词构建器**

实现并导出：

```js
function buildUnifiedPrompt(input = {}) {}
function snapshotPromptRound(input = {}) {}
function buildMaterialManifest(selectedContents = []) {}
```

构建器只组合任务目标、已确认要求、用户补充、所选内容版本、来源定位、批注和构图意图；不执行外部模型、不把导入资料当系统指令。复制/导出时由 `snapshotPromptRound` 固定正文和素材版本。

- [ ] **Step 3: 接入现有对话和写作规则**

让 `workbench-dialogue.js` 的现有建议/追问结果继续进入统一上下文；`app.js` 的 `buildWorkbenchPrompt` 调用新构建器，再把领域规则和现有批注批次作为输入。保留 `buildModificationPrompt` 的旧调用路径，旧项目没有新画布字段时仍生成旧格式提示词。

提示词准备稿、复制版本和外部回填版本分开保存；复制不代表外部模型已执行。回填入口默认关联最近的已交付轮次，无法确定时保存为独立候选。

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
- Test: `tests/workbench-dialogue.test.js`
- Test: `tests/workbench-agent-persistence.test.js`
- Test: `tests/workbench-view-state.test.js`

- [ ] **Step 1: 写连续工作区行为测试**

在现有 UI/状态测试中补最小断言：非空目标在首次发送前写入未命名任务草稿；长粘贴提供“转为文档”且不覆盖意见；前轮折叠后可展开；引用文本带来源/版本；保存失败保持编辑内容和 `workbenchSaveError`。

- [ ] **Step 2: 实现任务草稿与保存指示**

在 `app.js` 为当前项目维护 `workbenchDraft`、`workbenchDraftStatus`、`workbenchSaveError`；输入事件使用短延迟合并保存和最迟保存间隔，保存调用现有 `persistWorkbenchState`。保存失败只更新状态并保留 DOM 输入，切换任务时先等待或明确显示待保存状态。空白新任务不创建记录，首次非空目标创建未命名项目。

- [ ] **Step 3: 实现连续消息与预览策略**

保留同一 composer 接收短回复/修改意见；长正文通过“添加内容 → 新建粘贴文档”编辑。前轮消息使用 `<details>` 或现有折叠模式保存，不删除内容。实现预览规则：已展开且未固定时导入/准备完成自动切换；固定、主动关闭或窄屏输入时不抢占；内容卡片显式点击可重新打开。

- [ ] **Step 4: 实现双入口内容目录**

在 `renderWorkbench` 中增加“本任务内容”目录，按文档、文件、画布、提示词筛选；对话内卡片和目录都只引用同一稳定 ID。移除重复“你的任务/计划工作台/从第一步开始”说明，已有任务显示任务名，布局切换保持工具栏最右侧；空预览只保留一个说明和“添加内容”。浏览器批注蓝色编号不渲染为产品控件。

- [ ] **Step 5: 实现独立粘贴文档和用途切换**

文档编辑器在首次输入时创建可恢复未命名文档，支持命名、选文批注、取消/保存和关闭后恢复；正文不混入修改意见。导入后卡片显示“参考资料/外部结果”及默认原因，一键切换只改变用途字段；原件、正文、批注、版本不变。直接长粘贴到 composer 时提供转文档操作，成功后才移除转移文本。

- [ ] **Step 6: 运行定向测试并提交**

运行：

```powershell
node --test tests/workbench-dialogue.test.js tests/workbench-agent-persistence.test.js tests/workbench-view-state.test.js
```

预期：旧对话、布局、草稿和提示词保存测试 PASS；新增未命名草稿、折叠消息、用途切换和预览固定规则 PASS。

```powershell
git add prototype/app.js prototype/index.html prototype/workbench-dialogue.js tests/workbench-dialogue.test.js tests/workbench-agent-persistence.test.js tests/workbench-view-state.test.js
git commit -m "feat: 合并任务对话与内容预览"
```

### Task 5: 实现多画布纯数据操作与画布界面

**Files:**
- Create: `prototype/workbench-canvas.js`
- Modify: `prototype/app.js`
- Modify: `prototype/index.html`
- Test: `tests/workbench-canvas.test.js`
- Test: `tests/workbench-drawing.test.js`

- [ ] **Step 1: 写画布操作测试**

覆盖以下纯函数行为：新建空画布会保存；同一内容版本可被两张画布引用；移动/缩放/分组只改变当前画布；移除节点不删除任务内容；复制画布复制排列和批注但保持原件/版本 ID；`captureLayoutIntent` 只在显式启用时返回相对位置、比例和叠放顺序。

- [ ] **Step 2: 实现 `workbench-canvas.js`**

导出以下无 DOM 函数：

```js
function createCanvas(input = {}) {}
function addCanvasNode(canvas, node = {}) {}
function updateCanvasNode(canvas, nodeId, patch = {}) {}
function removeCanvasNode(canvas, nodeId) {}
function copyCanvas(canvas, input = {}) {}
function toggleCanvasNodeSelection(canvas, nodeId, selected) {}
function captureLayoutIntent(canvas, nodeIds = [], enabled = false) {}
```

所有位置统一保存为画布坐标；节点局部批注归画布节点，原文档批注仍归内容版本。函数返回新对象，不直接修改任务全局状态。

- [ ] **Step 3: 接入画布 UI**

在右侧预览中增加画布切换、新建、重命名、复制、拖入/文件选择、移动缩放、框选批注、分组、对比和本轮素材选择。画布不铺成永久页签；选中素材进入“本轮使用”清单，普通点击/拖动/切换画布不改变清单。加入撤销/重做、移除节点、取消分组和键盘操作；触屏或窄屏提供放大查看与返回对话入口。

- [ ] **Step 4: 接入构图和跨画布引用**

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
- Test: `tests/electron-ppt-main-annotation.test.js`
- Test: `tests/electron-workbench-backup.test.js`
- Test: `tests/workbench-viewer-layout.test.js`

- [ ] **Step 1: 接入类型状态与预览入口**

沿用现有 HTML、PDF、DOCX、PPTX、PNG/JPG/JPEG/WebP 预览和批注逻辑。内容卡片显示 `已读正文 / 仅预览 / 仅原件 / 解析失败`，解析失败保留原件和重试。网址生成静态快照并显示来源；不把静态 HTML 当成可运行 APP。PPT 使用页缩略图/当前页，PDF 使用文字层或区域批注，图片/截图使用单图或画布。

- [ ] **Step 2: 实现素材包导出**

在任务内容菜单增加“导出本轮素材包”。导出包括：已固定的提示词正文、文件对应表、实际选中的原件/页面区域图、构图参考图（启用时）和来源版本；不写入本机绝对路径或模型凭证。若当前能力只能导出完整原件，导出前明确范围并允许排除，不悄悄扩大材料范围。

- [ ] **Step 3: 接入保存位置和导出状态**

对桌面环境调用 `workbench:open-task-folder`，浏览器/草图显示“临时演示，未接入桌面保存”而不是伪造成功。任务导出沿用现有 workspace backup；文件、画布、批注和提示词清单都在同一稳定 ID 图中。

- [ ] **Step 4: 运行唯一连续界面复核**

只启动一次现有开发桌面/浏览器入口，完成：输入目标但不发送 → 新建未命名文档 → 导入一张图片 → 新建两张画布并跨画布引用 → 生成/复制提示词 → 导入外部结果 → 切换用途 → 关闭并重启恢复。顺手检查固定预览、窄屏返回和键盘撤销；不重新走全部历史业务、不重新测试每种文件格式。

- [ ] **Step 5: 运行受影响测试并提交**

运行：

```powershell
node --test tests/electron-ppt-main-annotation.test.js tests/electron-workbench-backup.test.js tests/workbench-viewer-layout.test.js
git diff --check
git status --short
```

预期：受影响测试 PASS；`git status` 只显示本任务改动与用户已有未提交改动，不回滚、不混入无关文件。

```powershell
git add prototype/app.js prototype/index.html electron/ppt-feedback-attachment-store.js electron/main.js tests/electron-ppt-main-annotation.test.js tests/electron-workbench-backup.test.js tests/workbench-viewer-layout.test.js
git commit -m "feat: 完成统一任务工作台交付"
```

## 自审清单

- **设计覆盖：**第 1 任务覆盖稳定 ID、旧任务兼容和本机保存基础；第 2 任务覆盖原件目录、原子写入、打开位置、备份和恢复；第 3 任务覆盖统一提示词、选材快照、构图意图和外部结果轮次；第 4 任务覆盖连续对话、双入口、独立文档、用途默认、空态和预览固定；第 5 任务覆盖多画布、共享原件、独立批注、构图和键盘/窄屏；第 6 任务覆盖六类内容预览、素材包和一次连续界面复核。
- **历史批注覆盖：**连续工作区、同一输入框短回复、长正文独立文档、导入后用途默认、两入口、轻量画布、六类内容、生图/UI 复刻、跨类型转换、多画布、旧任务接入、手改保护和失败重试均有对应任务；浏览器蓝色批注标记作为审阅标记处理，不实现为产品控件。
- **测试控制：**每个阶段只运行受影响测试；最终只做一次连续界面操作。已有测试未受改动时沿用结果，不执行全量测试、重复格式验收、重复付费模型调用或重新打包。
- **未完成能力：**计划完成前，云同步、协作、专业绘图、完整 PPT 编辑、模型自动执行和真实格式保真仍不属于交付范围；PPT/Office 复杂内容和外部模型实际执行结果需要在交付中单独标注。

## 执行交接

Plan complete and saved to `.dsh-workspace/docs/superpowers/plans/2026-11-16-unified-task-workbench-implementation.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** - execute tasks in this session with checkpoints.

当前用户明确要求的是计划，未选择执行方式；实现前需要选择其中一种。
