# PPT HTML 与图片反馈工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在应用内查看其他 AI 生成的 HTML 或图片，在具体页面元素/区域添加反馈，并与轻量预检并行，再由 PPT 提示词 Agent 澄清意图、诊断问题、逐页验收并生成可复制的下一轮提示词。

**Architecture:** 把导入的 HTML 和图片作为不可变版本附件，通过 Electron 主进程受限读取并在隔离预览容器展示；也支持本地文件/文件夹、开发服务器页面、网页地址和应用内浏览器当前页面转成可标注版本。导入后立即执行轻量预检，用户可以同时标注；提交标注后再结合任务简报、风格规则和用户意图做完整逐页验收。标注以源文件版本、目标定位和用户文字分开存储，替换文件时标记旧标注过期。PPT Agent 只接收用户选中的标注及必要摘要并生成诊断/提示词，不修改导入文件。首版不支持 PPTX 内嵌预览标注，PPT/PPTX 需导出为图片后进入反馈流程。

**Tech Stack:** Electron 38、原生 HTML/CSS/JavaScript、Electron `webview`/独立 `BrowserWindow` 隔离能力（实现前按当前 Electron 版本官方接口核实）、Node `node:test`；图片缩放和点位使用原生 DOM/Pointer Events，不增加图形库。

---

## 安全与依赖边界

- 依赖提示词 Agent 工作台和 `2026-10-20-ppt-content-planning.md` 的 PPT task/brief/source 引用，以及 `2026-10-20-ppt-source-research.md` 的 Electron 附件读取和来源元数据接口。
- HTML 是用户提供的不可信内容。预览不得获得 Node 集成、应用 IPC、用户凭证、任意文件读取或默认网络访问；远程资源应阻止或逐项显示并由用户明确允许。
- HTML/图片标注仅产生反馈数据，不回写源文件。文件版本变化后旧标注显示过期，不自动套到新内容。
- 原文件默认保留在原位置；应用只保存附件标识、校验值、必要预览副本和标注元数据。备份默认不包含原文件或预览副本，用户可单独选择纳入附件副本。
- 仅首版支持 HTML 和图片；PPT/PPTX 逐页预览与直接标注留在后续范围。

## 文件职责与接口

| 文件 | 职责 |
|---|---|
| `prototype/ppt-feedback-schema.js` | 导入附件元数据、文件版本摘要、标注定位和反馈状态规范化 |
| `prototype/ppt-feedback.js` | 纯函数创建、迁移、筛选、失效标注和反馈上下文摘要 |
| `electron/ppt-preview-manager.js` | 安全预览窗口生命周期、临时隔离 profile/CSP/导航策略和安全清理 |
| `electron/ppt-feedback-attachment-store.js` | 仅保存用户导入的 HTML/图片与版本 hash；限定目录、大小和扩展名 |
| `electron/main.js`、`electron/preload.js` | 预览打开/关闭、受限附件元数据和保存反馈的窄 IPC |
| `prototype/ppt-feedback-ui.js` | 文件/文件夹/URL/当前浏览器页面导入、预览导航、图片/HTML 标注、轻量预检、反馈列表、验收入口和提示词生成入口 |
| `prototype/index.html` | 预览/标注容器和样式/脚本加载 |
| `prototype/app.js` | 连接 UI、任务存储、PPT coordinator 和 Electron API |
| `prototype/storage.js` | 迁移和保存标注元数据白名单，不保存 data URL 或附件二进制 |
| `tests/ppt-feedback-schema.test.js` | schema、定位和过期策略 |
| `tests/ppt-feedback.test.js` | 纯函数操作与摘要边界 |
| `tests/electron-ppt-preview.test.js` | 隔离配置、导航、IPC、附件路径和清理 |
| `tests/ppt-feedback-ui.test.js` | HTML/图片标注、来源导入、并行预检、验收分级与降级显示 |
| `tests/ppt-feedback-integration.test.js` | 标注到诊断提示词、逐页验收、重跑版本和运行依据的集成 |

固定标注字段：

```js
{
  id, taskId, attachmentId, contentHash, pageIndex,
  target: { kind: 'element' | 'point' | 'region', selector?, x?, y?, width?, height? },
  comment, category, createdAt, status: 'active' | 'stale', selected: boolean
}
```

## Task 1: 附件版本和标注数据契约

**Files:**
- Create: `prototype/ppt-feedback-schema.js`
- Create: `prototype/ppt-feedback.js`
- Create: `tests/ppt-feedback-schema.test.js`
- Create: `tests/ppt-feedback.test.js`
- Modify: `prototype/storage.js`
- Modify: `tests/storage.test.js`

- [ ] **Step 1: 写失败测试。** 覆盖 HTML 与图片 MIME/扩展名白名单、文件夹/URL/当前浏览器页面来源标识、附件 hash、标注点/区域坐标 0-1 归一化、HTML selector 长度限制、评论长度限制、分类 `content|logic|evidence|style|layout|format|readability|other`；换版本 hash 后旧标注变 `stale`；附件数据 URI、绝对路径和未知敏感字段不进入 localStorage/备份；预检版本与完整验收版本可关联。

- [ ] **Step 2: 实现纯函数。** 固定 `normalizePptFeedbackAttachment`、`normalizePptAnnotation`、`createPptAnnotation`、`markStaleAnnotations`、`buildSelectedFeedbackContext`、`buildPreflightReport` 和 `buildAcceptanceReport`。上下文只包含用户选中的标注，按文件/页分组并限制条数、字符数；保留用户原话，不由分类自动改写意图；验收报告区分通用基础标准和任务专属标准，并将问题分为必须修复、建议优化、可接受差异。

- [ ] **Step 3: 运行并提交。** `node --test tests/ppt-feedback-schema.test.js tests/ppt-feedback.test.js tests/storage.test.js`；预期数据白名单和失效规则通过。提交：`feat: 增加 PPT 视觉反馈数据契约`。

## Task 2: 安全附件存储与隔离 HTML 预览

**Files:**
- Create: `electron/ppt-feedback-attachment-store.js`
- Create: `electron/ppt-preview-manager.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Create: `tests/electron-ppt-preview.test.js`
- Modify: `tests/electron-smoke.test.js`

- [ ] **Step 1: 写 Electron 安全测试。** 拒绝非 HTML/图片 MIME、双扩展伪装、超限文件、路径穿越和用户数据目录外读取；预览窗口配置断言 Node integration 关闭、context isolation 开启、sandbox 开启、无通用应用 preload/IPC；拦截顶层导航、弹窗、权限请求及默认网络请求；关闭窗口清除临时会话与临时副本。

- [ ] **Step 2: 实现附件存储。** 使用 `app.getPath('userData')/ppt-feedback/<taskId>/<generatedId>/`，以应用生成的文件名存储；原始文件仍保留在原位置，HTML 与图片大小分别设定常量上限并在 UI 显示；本地文件/文件夹、开发服务器页面、网页地址和当前浏览器页面分别保存来源类型与版本校验值；计算内容摘要用于版本比较。保存失败保留原文件且向用户返回明确错误。

- [ ] **Step 3: 实现预览窗口。** HTML 使用隔离、无 Node 的专用窗口或等价安全容器，以 CSP 禁止脚本、连接和外部资源；本地只读副本可加载受限静态资源。URL、开发服务器和当前浏览器页面必须经过来源确认，并保存页面版本/抓取时间；无法安全捕获时退化为静态截图/文本预览并说明，不降级为带 Node 权限的 webview。图片以应用自有查看器展示，不打开系统任意路径。

- [ ] **Step 4: 暴露窄 IPC 并提交。** preload 只暴露 `choosePptFeedbackFile()`、`listPptFeedbackAttachments(taskId)`、`openPptPreview(attachmentId)`、`closePptPreview(attachmentId)`、`savePptAnnotation(annotation)`、`deletePptFeedbackAttachment(attachmentId)`；主进程重新校验参数。运行 `node --test tests/electron-ppt-preview.test.js tests/electron-smoke.test.js`，预期附件权限、预览隔离和关闭清理测试通过。提交：`feat: 增加安全 PPT 预览附件通道`。

## Task 3: 图片与 HTML 点位/区域标注

**Files:**
- Create: `prototype/ppt-feedback-ui.js`
- Modify: `prototype/index.html`
- Modify: `prototype/app.js`
- Create: `tests/ppt-feedback-ui.test.js`
- Modify: `tests/e2e-smoke.test.js`

- [ ] **Step 1: 写 UI 契约测试。** 图片支持缩放与点位/矩形区域标注，坐标存原图归一化比例且缩放不改变锚点；HTML 支持用户点击页面元素生成元素标注，selector 无法稳定生成时退化为视口坐标；预览滚动、缩放、窗口尺寸变化后标注仍定位正确；键盘可创建、编辑、删除评论；屏幕阅读器可读到标注序号和评论；导入后轻量预检与标注可并行；提交标注后完整验收读取任务简报、风格规则、路线、来源和用户反馈。

- [ ] **Step 2: 实现预览工作台。** 提供文件/页面列表、上一/下一页（图片集合或 HTML 页面）、缩放、标注工具、评论/分类、标注选择、预检状态、验收等级、过期提示、删除确认和重新定位入口。HTML 预览内容不可编辑；标注 UI 位于可信应用壳层，不注入 HTML 原页面执行环境。

- [ ] **Step 3: 持久化用户明确操作。** 每次保存/删除经过 coordinator 和 Electron 窄接口；替换附件生成新 hash 并批量标记旧 annotation 为 stale；提供“重新检查并定位”操作，由用户确认后生成新标注，不自动复制旧坐标。

- [ ] **Step 4: 运行 UI 测试并提交。** `node --test tests/ppt-feedback-ui.test.js tests/e2e-smoke.test.js`；预期图像坐标、HTML selector 回退、过期提示和键盘操作通过。提交：`feat: 增加 HTML 与图片反馈标注`。

## Task 4: 标注诊断与下一轮提示词

**Files:**
- Modify: `prototype/ppt-scene-prompts.js`
- Modify: `prototype/ppt-scene-coordinator.js`
- Modify: `prototype/ppt-feedback-ui.js`
- Create: `tests/ppt-feedback-integration.test.js`
- Modify: `tests/prompt-agent-integration.test.js`

- [ ] **Step 1: 写集成测试。** 输入用户目标、选中标注、对应页面/HTML 元素或图片区域摘要、风格参考、制作路线、上一版约束和轻量预检结果后，诊断应输出观察、可能意图、影响、最多 3 个会改变方向的澄清问题和修改建议；界面一次只提出 1 个，前一个答案使后续问题失去意义时停止；同时给出下一条提示词。不选中的评论不发送；无模型时仍可查看原始标注并复制手写评论；不调用文件写入或成品生成接口。

- [ ] **Step 2: 构造最小反馈上下文。** 使用版本 hash、页/元素定位、用户评论和必要 brief/来源摘要，不发送完整 HTML、整份 PPT/PDF 或无关历史。材料与评论视为不可信文本；默认只发送选中的标注和必要预检摘要；最多提出 3 个会改变修改方向的关键问题，但界面一次只显示 1 个，其他可能意图列为假设。记录本次任务要求、候选视觉内容、参考资料、提示词版本和时间。

- [ ] **Step 3: 接入用户复盘。** 让用户可将反馈诊断标记为有效/无效/待确认并提供依据；未经用户确认的经验只保留本任务状态，不升级为已验证案例。
- [ ] **Step 4: 接入重跑和版本管理。** 支持重跑选中页面/文件、当前验收阶段或从相关性判断开始的全部流程；用户可附带不满意原因。每次重跑保留旧结果，支持新旧差异查看和任一版本恢复；只有用户点击保存时才把诊断、资料或规则沉淀为个人偏好或成功/失败案例。

- [ ] **Step 5: 运行并提交。** `node --test tests/ppt-feedback-integration.test.js tests/prompt-agent-integration.test.js`；预期只传选中反馈、模型失败可恢复、建议不改写原文件，重跑可对比和恢复。提交：`feat: 将 PPT 标注转为修改提示词`。

## Task 5: 安全文档、备份和应用回归

**Files:**
- Modify: `README.md`
- Modify: `docs/MVP_SCOPE.md`
- Modify: `docs/PRODUCT_DESIGN.md`
- Modify: `docs/superpowers/specs/2026-10-20-ppt-scene-design.md`
- Modify: `prototype/workspace-backup.js`
- Modify: `package.json`
- Modify: `tests/workspace-backup.test.js`
- Modify: `tests/package-config.test.js`

- [ ] **Step 1: 明确备份与隐私边界。** 备份默认只含任务摘要、标注元数据和引用；附件原文件仍在原位置且默认不备份，用户单独选择纳入附件副本后才随备份导出；不包含临时预览 profile、缓存截图、凭证、完整 HTML/PPT 原文或模型请求日志。恢复附件后重算 hash，缺文件时标记附件缺失并保留标注记录。

- [ ] **Step 2: 扩展自动化检查。** 检查 CSP/隔离配置、preload 白名单、源文件只读、文件 hash 失效提示、大小限制和备份排除；新增运行时脚本加入 `npm run check`，但媒体样例不进入安装包。

- [ ] **Step 3: 运行完整验证与人工验收。** `npm test`、`npm run check`、`git diff --check`。Windows Electron 手动打开不含脚本的 HTML、含脚本与远程资源的 HTML、PNG/JPEG/WebP 图片、本地开发页面和受控网页；确认脚本/网络被阻止或按权限处理、轻量预检和标注可并行、提交后完整验收分级、可标注/删除、换版后标注过期、局部重跑与版本恢复、备份恢复行为正确。记录键盘操作路径。

- [ ] **Step 4: 提交。** 仅添加反馈模块及相关文档，提交 `test: 完成 PPT 视觉反馈集成验收`。

## 完成标准

- 用户可以在应用内查看外部 AI 生成的 HTML 或图片并标出具体位置、评论与反馈类别。
- 导入内容在隔离环境预览，无应用权限、任意文件访问或默认外网请求；源文件不被修改。
- 标注绑定附件 hash，源文件替换后旧标注不会错误覆盖新版。
- 导入后轻量预检与用户标注并行，提交标注后执行通用基础标准与任务专属标准结合的逐页验收，问题按必须修复、建议优化、可接受差异分级。
- 支持本地 HTML/图片、文件夹、本地开发页面、网页地址和应用内浏览器当前页面；PPT/PPTX 可导出图片进入同一反馈流程。
- 可按页面/文件、当前阶段或全流程重跑，保留版本、差异和运行依据，并可恢复旧版。
- PPT Agent 可将选中标注转成证据化诊断与下一轮提示词，并只询问会改变修改方向的问题。
- 本地附件、备份和模型上下文边界明确；失败时源文件与用户评论仍可恢复。
- 自动化测试、语法检查和 Windows Electron 手动验收通过。
