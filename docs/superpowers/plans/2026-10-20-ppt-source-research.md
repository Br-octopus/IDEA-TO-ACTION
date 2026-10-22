# PPT 资料搜索与文件解析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 PPT 提示词 Agent 自动查找合适的本地 Skill、工作流、脚本、案例和外部资料，并按用户要求搜索大量资料、限定必查来源或解析指定网页/视频/图片/PDF/PPT/授权文件夹；本机只负责高召回，模型按页/章节结合任务语义做最终复筛。

**Architecture:** 复用通用提示词 Agent 的授权目录索引、知识检索、搜索客户端和社媒研究 Agent；增加 PPT 候选召回、模型语义复筛、扩展研究批次、指定来源清单和解析结果统一格式。先在本机提取所有可读文字并列出候选，再把整批摘要/片段放入发送预览，用户确认后由模型按页/章节判断内容来源、风格参考、两者兼有或无关；视觉内容按需发送，风格默认分析代表页。搜索计划、来源进度、运行依据与失败原因显式记录；超出预算时暂停并可续跑。解析器只处理已授权/指定内容，不执行检出的脚本。

**Tech Stack:** Electron 38、Node.js 18+、现有 search-client / research bridge、本地文件授权 IPC、现有文件解析工具或可用系统能力、Node `node:test`；优先复用已安装解析依赖，不引入向量数据库或新增抓取平台。

---

## 范围与依赖

- 依赖 `docs/superpowers/plans/2026-10-19-prompt-agent.md` 的本地来源索引、搜索确认、研究桥接及任务状态。不得另建第二套全局目录授权或联网搜索器。
- 与 `2026-10-20-ppt-content-planning.md` 配合，为大纲与逐页文稿提供带来源 ID 的片段、验证级别和适用限制。
- 用户要求“全面/大量搜索”或明确列出必查 GitHub 仓库、网站、视频、图片、文件、文件夹时，不重复询问搜索意图；展示查询批次/来源覆盖/预算和工具限制后开始。付费操作或搜索服务硬限制须先明确。
- 用户指定的来源无法访问或解析失败时必须显示失败原因；相似替代来源不得自动采用，必须由用户确认。
- 外部资料和本地知识资料都先展示候选来源、摘要和预计发送内容；助手自动选择的来源要展示用途、采用/舍弃内容，用户可排除后重新生成。
- 用户确认粒度是整批一次：先把本机候选的摘要和片段合并成一份发送预览；确认后内部可以按模型上下文和预算分批处理，但不要求用户逐批确认。每个模型上下文仍只放当前批最多 3 条高相关摘要、约 1,500 tokens；扩展搜索可以搜得多，但不得将全量结果一次塞进上下文。

## 文件职责与接口

| 文件 | 职责 |
|---|---|
| `prototype/ppt-source-research.js` | PPT 查询构造、本机高召回、模型复筛批次、来源覆盖和预算进度纯函数 |
| `prototype/ppt-source-schema.js` | 统一网页/仓库/视频/图片/文档/目录解析结果、页级相关性、材料角色、质量报告及失败状态 |
| `electron/ppt-source-reader.js` | 主进程中调用受限的本地文件解析与网页/媒体读取适配器；路径、类型和大小校验；原文件只保留标识/校验值，不把完整提取文本长期落盘 |
| `electron/main.js`、`electron/preload.js` | 只开放选择来源、读取指定来源、解析状态等窄 IPC |
| `prototype/ppt-scene-coordinator.js` | 注入 PPT 搜索/解析/复筛结果供 brief/temporary plan/outline/slide draft 阶段使用，并支持目标变化后的局部重跑 |
| `prototype/ppt-scene-ui.js` | 显示搜索计划、整批发送预览、来源覆盖、按页/章节相关性、分层解释、引用、解析质量状态与必查来源失败项 |
| `prototype/index.html` | 注册来源计划和来源列表容器及脚本 |
| `prototype/storage.js` | 只保存来源元数据、引用片段、页码、文件标识/校验值、任务状态和模型运行摘要；不保存凭证、完整提取文本或原始大文件，附件备份需用户单独选择 |
| `tests/ppt-source-research.test.js` | 查询策略、预算批次、来源覆盖及来源排序 |
| `tests/ppt-source-schema.test.js` | 统一解析结果和错误字段 |
| `tests/electron-ppt-source-reader.test.js` | IPC、路径边界、解析调用和权限测试 |
| `tests/ppt-source-integration.test.js` | coordinator 与来源/研究桥接集成 |
| `tests/ppt-source-ui.test.js` | 来源清单和失败状态显示 |

固定纯函数接口：

```js
buildPptResearchPlan(request, localCapabilities)
splitResearchBatches(plan, limits)
recordResearchProgress(plan, event)
summarizeSourceCoverage(plan, results)
rankPptSources(results, task)
normalizePptSourceResult(input)
classifyPptMaterial(input, modelSuggestion)
classifyPptPages(input, modelSuggestion)
buildSourceSendPreview(candidates, task)
buildSourceQualityReport(result)
selectSourceRerunScope(request)
```

统一解析器接口：

```js
readPptSource({ source, purpose, pageRange, signal })
```

结果至少含 `sourceId`、`kind`、`purpose`、`status`、`title`、`excerpt`、`location`、`retrievedAt`、`verificationStatus`、`license`、`limitations`、`processedRange`、`errorCode`。未处理范围和失败原因不得省略。

## Task 1: 搜索计划、批次预算和资料排序

**Files:**
- Create: `prototype/ppt-source-research.js`
- Create: `tests/ppt-source-research.test.js`

- [ ] **Step 1: 写失败测试。** 覆盖普通请求遵循父 Agent 默认搜索预算；“大量搜索”生成多批查询并显示计划总量；指定来源必须出现在待查清单且优先级最高；必查来源不可访问时保留 `required-but-unavailable` 状态，不能用别的结果伪装完成；可暂停/取消；成功/失败案例与项目自述、公开样例、用户确认经验分别标记；本机候选只做高召回，模型复筛前产生整批发送预览，预算耗尽后暂停并可续跑。

- [ ] **Step 2: 运行测试确认失败。** `node --test tests/ppt-source-research.test.js`；预期模块不存在。

- [ ] **Step 3: 实现纯函数。** 搜索词从演示类型、阶段、目标和明确范围构建；本机先列出支持格式并提取所有可读文字，按文件/页/章节召回候选但不丢弃未入选项；GitHub 结果优先抽取 README/Skill/脚本说明/测试/样例片段，按任务有用性、来源质量、更新日期、可验证产物和适用性排序，许可证和使用限制作为来源信息保留而不是第一版自动筛选门槛；不同查询分批，模型每轮只收当前批摘要/片段。用户明确的大量搜索作为授权输入，不额外弹出确认；展示搜索范围、整批发送预览、已评估/未评估项和用户可暂停/取消。

- [ ] **Step 4: 运行并提交。** `node --test tests/ppt-source-research.test.js`；预期扩展搜索和必查来源覆盖测试通过。提交：`feat: 增加 PPT 研究计划与来源排序`。

## Task 2: 统一各来源与解析结果契约

**Files:**
- Create: `prototype/ppt-source-schema.js`
- Create: `tests/ppt-source-schema.test.js`
- Modify: `prototype/ppt-scene-schema.js`

- [ ] **Step 1: 写 schema 测试。** 覆盖 GitHub 仓库、网页、视频、图片、PDF、`.ppt`、`.pptx`、本地文件/文件夹统一字段；许可未知标记为 unknown；来源自述不标成独立验证；解析失败必须说明原因和未处理页/片段；用户选择“内容”“风格”“两者”“无关”均被保留；页级结果支持纳入、排除、不确定、可恢复和分层解释。

- [ ] **Step 2: 实现规范化。** 区分 `queued`、`reading`、`partial`、`complete`、`unavailable`、`unsupported`、`failed`；对图片输出可读文字及视觉特征，对视频保存字幕/转录范围并记录关键帧抽查范围，对 PDF/`.ppt`/`.pptx` 输出页号范围，对目录输出被允许处理的文件清单和跳过计数。所有格式生成同一套质量报告，至少包含可读取内容、已处理范围、失败项、代表页视觉检查状态和未处理范围。

- [ ] **Step 3: 测试不可信材料边界。** 解析内容里的提示词、命令和脚本均作为引用内容；schema 不产生可执行命令字段，不允许解析结果覆盖任务指令。

- [ ] **Step 4: 运行并提交。** `node --test tests/ppt-source-schema.test.js tests/ppt-scene-schema.test.js`；预期旧 brief 兼容且来源元数据完整。提交：`feat: 统一 PPT 来源解析结果`。

## Task 3: 指定文件、视频、网页和授权目录读取

**Files:**
- Create: `electron/ppt-source-reader.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Create: `tests/electron-ppt-source-reader.test.js`
- Modify: `tests/electron-smoke.test.js`

- [ ] **Step 1: 写边界失败测试。** 使用临时目录覆盖用户明确选择的文件和文件夹；拒绝越出授权根目录的路径、路径穿越、凭证文件、`.git`、依赖/构建目录、二进制和不支持扩展；覆盖文件大小和页数限制、取消信号及部分失败。

- [ ] **Step 2: 接入现有文档解析能力。** 先检查应用已配置的解析工具/依赖，按 `kind` 调用适配器：PDF/`.ppt`/`.pptx` 提取所有可读文字与页结构，需要时渲染代表页或指定页；图片执行 OCR/视觉分析；视频优先读取字幕/转录并按预算抽查关键画面；网页和 GitHub 只读取指定或研究计划允许的内容。缺少工具时返回 `unsupported` 并提供粘贴文本/上传可解析副本的替代方式，不伪造解析成功。原始文件保留原位置，默认只保存标识、校验值、摘要、引用片段和页码。

- [ ] **Step 3: 暴露最小权限 IPC。** 只提供文件对话框选取、授权目录内列举和解析被选文件的接口；preload 不暴露任意路径读取、任意脚本执行或通用 shell。文件名由应用内部校验，读取过程可取消。

- [ ] **Step 4: 运行 Electron 测试并提交。** `node --test tests/electron-ppt-source-reader.test.js tests/electron-smoke.test.js`；预期权限、路径、大小、未支持解析器和取消测试通过。提交：`feat: 增加 PPT 指定来源解析通道`。

## Task 4: 接入研究 Agent、PPT 大纲和工作台

**Files:**
- Modify: `prototype/ppt-scene-coordinator.js`
- Modify: `prototype/ppt-scene-ui.js`
- Modify: `prototype/index.html`
- Modify: `prototype/storage.js`
- Create: `tests/ppt-source-integration.test.js`
- Create: `tests/ppt-source-ui.test.js`
- Modify: `tests/prompt-agent-integration.test.js`

- [ ] **Step 1: 写集成测试。** 验证自动选材、用户必查仓库/网址/视频/图片/文件/PPT/文件夹、GitHub 课程与 Skill 检索、社媒方法案例搜索及大纲引用；访问失败时工作流继续但明确显示缺口，替代来源需确认；只给当前阶段最多 3 条摘要；整批发送前展示摘要/片段预览；引用可展开至来源位置；按页/章节纳入、排除、不确定和恢复可用；未解析完整时不能显示“已全面检查”。

- [ ] **Step 2: 接入 coordinator。** 来源搜索复用 prompt-agent research bridge；指定来源在计划中逐项跟踪；扩展计划按批次执行和记录使用量；研究结论保存来源 ID、页码/章节、材料角色、验证等级和模型判断依据，逐页主张可引用多个来源；单一来源自述不得被转换为确定事实；任务目标变化时只重跑受影响的模型判断，保留本机解析结果。

- [ ] **Step 3: 接入 UI 和任务存储。** 显示预计查询/来源类别、批次进度、整批发送预览、必查项状态、解析页数/片段、页级纳入/排除/不确定理由、许可证、未覆盖原因和暂停/取消。用户可移除、恢复单项、改材料角色、排除来源和调整范围；应用只持久化摘要、来源元数据、文件标识/校验值、引用片段和运行摘要。长材料通过选页/片段引用，不自动全量发送模型。

- [ ] **Step 4: 运行并提交。** `node --test tests/ppt-source-integration.test.js tests/ppt-source-ui.test.js tests/prompt-agent-integration.test.js`；预期搜索、解析、证据引用与退化行为通过。提交：`feat: 接入 PPT 资料搜索与解析`。

## Task 5: 文档、配额和 Windows 回归

**Files:**
- Modify: `README.md`
- Modify: `docs/MVP_SCOPE.md`
- Modify: `docs/PRODUCT_DESIGN.md`
- Modify: `package.json`
- Modify: `tests/package-config.test.js`
- Modify: `tests/e2e-smoke.test.js`

- [ ] **Step 1: 文档说明解析能力矩阵。** 逐格式记录可解析内容、依赖、大小/页数/时长限制、无工具时降级方式和本机/外部服务处理边界；不声称支持实际不可用的解析器。

- [ ] **Step 2: 加入脚本检查与构建清单。** 将新运行时代码加入 `npm run check`；确认解析适配器随 Electron 构建，测试、计划和用户原文件不打包。

- [ ] **Step 3: 运行完整验证。** `npm test`、`npm run check`、`git diff --check`；Electron 手动验收使用测试文件夹、图片、PDF、`.ppt`、`.pptx` 和视频样例，记录每种格式的统一质量报告、代表页视觉检查、成功/部分/失败状态以及必查来源不可访问时的展示。验证文件移动/修改后只重处理受影响文件，并在用户确认后更新引用。

- [ ] **Step 4: 提交。** `git add` 仅添加本计划相关代码和文档，提交 `test: 完成 PPT 资料研究集成验收`。

## 完成标准

- Agent 能自动决定是否需要本地/外部资料；不要求用户自己找 Skill、仓库、工作流或案例。
- 用户要求大量搜索或限定必查来源时会执行并显示范围、进度、缺失项和限制。
- 指定文件/媒体/授权目录按格式解析，记录支持范围、页/片段和失败原因；不越过用户授权路径。
- 对来源自述、公开展示和用户确认经验分级，不将来源数量误作结论可靠度。
- 模型上下文保持阶段化、摘要化；不执行外部脚本，不上传完整私有材料。
- 本机排序只做高召回；模型按页/章节结合任务简报语义复筛，用户可查看依据、修改分类、恢复页面并按范围重跑。
- `.ppt`、`.pptx`、PDF 和图片共用一套质量报告；原文件默认保留原位置，完整提取文本不长期保存，附件备份需用户单独选择。
- 自动化测试、语法检查和 Electron 手动验收结论如实记录。
