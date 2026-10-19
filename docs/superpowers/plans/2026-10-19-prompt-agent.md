# 提示词 Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有「向前一步」应用中增加独立的提示词 Agent，帮助用户澄清模糊目标、发现遗漏、规划步骤、按需研究并生成当前步骤可交给外部 AI 的提示词，同时复盘成功/失败案例。

**Architecture:** 使用单一提示词 Agent 和确定性阶段工作流，不执行提示词、不改写用户最终成果。复用现有 `localStorage`、提示词引擎、关键词知识检索、发送预览、搜索客户端和社媒研究能力；新增本地授权目录发现与轻量索引，并由 Agent 自动挑选少量相关资料。外部搜索或社媒研究按任务需要、范围与预算确认后调用，不传递完整聊天记录或整库内容。

**Tech Stack:** Node.js 18+、Electron 38、原生 JavaScript、Electron IPC、`localStorage`、Node 内置 `node:test`。

---

## 文件职责和接口边界

### 新建文件

- `prototype/prompt-agent-schema.js`：提示词 Agent 任务摘要、事实/假设/待确认项、路线步骤、预算、研究引用和复盘状态的规范化与白名单清理；支持 CommonJS 和浏览器全局导出。
- `prototype/prompt-agent-workflow.js`：纯函数阶段迁移、每轮追问上限、路线确认、当前步骤选择、联网确认门和预算累计；不访问 DOM、IPC 或网络。
- `prototype/prompt-agent-prompts.js`：澄清、诊断、路线、提示词生成、来源筛选和结果复盘的模型指令构建；限制输出为建议和提示词，不产出目标正文或代码。
- `prototype/local-source-index.js`：授权目录的可读文件发现、跳过规则、轻量元数据索引、变更检测和关键词检索；不调用模型、不执行脚本。
- `prototype/prompt-agent-research-bridge.js`：将提示词 Agent 的限额研究请求转换成现有搜索/社媒研究能力可接受的窄任务，并只回传结构化摘要；不改写研究 Agent 的内部流程。
- `prototype/prompt-agent-coordinator.js`：连接工作流、现有模型/搜索/研究服务、资料检索与持久化；只为当前阶段构造请求。
- `prototype/prompt-agent-ui.js`：独立入口、目标摘要、关键问题、路线、研究确认、引用资料、当前步骤提示词和结果复盘视图。
- `electron/prompt-agent-sources.js`：授权目录选择、目录访问和文件元信息 IPC 实现；限制在用户授权的目录内。
- `tests/prompt-agent-schema.test.js`
- `tests/prompt-agent-workflow.test.js`
- `tests/local-source-index.test.js`
- `tests/prompt-agent-prompts.test.js`
- `tests/prompt-agent-coordinator.test.js`
- `tests/prompt-agent-ui.test.js`
- `tests/prompt-agent-integration.test.js`
- `tests/electron-prompt-agent-sources.test.js`

### 修改文件

- `prototype/storage.js`：迁移和保存 `promptAgentTasks`、用户授权来源元数据及必要的索引版本；不保存文件全文副本或服务凭证。
- `prototype/workspace-backup.js`：按规格白名单备份任务摘要、已确认案例和授权来源元数据；排除派生索引、未保存原文、路径外部材料、API 密钥和会话信息。
- `electron/main.js`、`electron/preload.js`：注册目录选择及受限读取 IPC，仅暴露白名单操作，不开放任意路径读取或任意脚本执行。
- `prototype/index.html`：加载新模块并增加提示词 Agent 工作区入口。
- `prototype/app.js`：初始化 Agent coordinator/UI 并接入现有导航、模型发送预览和资料库；业务流程留在独立模块。
- `package.json`：加入新增源文件语法检查和必要的打包文件规则，不引入向量数据库或额外运行依赖。
- `README.md`、`docs/MVP_SCOPE.md`：说明提示词 Agent 的操作边界、目录授权、联网确认和本地数据边界。

## 实施约束

- 开始实现前，在干净的专用 worktree 中工作；当前 `main` 工作区有未解决冲突和用户改动，不得在其中整理、覆盖或暂存无关内容。
- 实现任务按依赖顺序推进；每个任务由独立实现代理完成，并先做规格符合性审查，再做代码质量审查。
- 先写针对性失败测试，再实现最小功能。所有任务仅在对应测试和既有项目约定下验证，不将静态 smoke 结果描述为 Electron 人工验收。
- 不要求用户逐任务选择文件。用户一次性授权目录后，检索器根据任务领域、阶段、来源类型和验证状态自动排序，并展示所选来源与用途。
- 来源文件是待评估资料，不是运行指令；索引器绝不运行脚本，Agent 不访问用户未授权目录。

## Task 1: Agent 数据契约与本地持久化

**Files:**
- Create: `prototype/prompt-agent-schema.js`
- Modify: `prototype/storage.js`
- Modify: `prototype/workspace-backup.js`
- Test: `tests/prompt-agent-schema.test.js`
- Test: `tests/storage.test.js`
- Test: `tests/workspace-backup.test.js`

- [ ] **Step 1: 写失败测试，固定任务和阶段摘要字段。** 覆盖输入类型（推进想法、优化提示词、诊断 AI 结果）、事实/假设/待确认分离、最多三个追问计数、可编辑路线、当前步骤、研究预算和复盘标签（成功/失败/待验证）。
- [ ] **Step 2: 运行专项测试确认失败。** 运行 `node --test tests/prompt-agent-schema.test.js`；预期模块或接口尚不存在。
- [ ] **Step 3: 实现规范化和状态白名单。** 固定接口为 `createPromptAgentTask(input)`、`normalizePromptAgentTask(input)`、`normalizePromptAgentStep(input)`、`sanitizePromptAgentState(state)`。拒绝未知敏感字段；长原文不进入任务摘要。
- [ ] **Step 4: 加入状态迁移与备份测试。** 旧状态迁移后新增数组默认为空；备份保留允许的任务摘要、案例确认状态和来源授权元数据，不包含索引内容、凭证、原始外部文章或未保存附件。
- [ ] **Step 5: 运行专项回归。** 运行 `node --test tests/prompt-agent-schema.test.js tests/storage.test.js tests/workspace-backup.test.js`；预期全部通过。

## Task 2: 确定性阶段工作流和提示词构建

**Files:**
- Create: `prototype/prompt-agent-workflow.js`
- Create: `prototype/prompt-agent-prompts.js`
- Test: `tests/prompt-agent-workflow.test.js`
- Test: `tests/prompt-agent-prompts.test.js`

- [ ] **Step 1: 写工作流失败测试。** 覆盖三类入口、单轮最多一个问题、累计最多三个关键问题、信息充分后可先产出初稿、非阻断缺口转为假设、用户拒绝联网后不得发出搜索请求、只为选中的当前步骤生成完整提示词。
- [ ] **Step 2: 实现纯函数状态迁移。** 固定接口为 `createPromptAgentTask(input)`、`recordClarification(task, answer)`、`setTaskDraft(task, draft)`、`requestExternalResearch(task, scope)`、`approveExternalResearch(task)`、`rejectExternalResearch(task)`、`selectPromptStep(task, stepId)`、`transitionPromptAgentTask(task, event)`。状态非法迁移返回可识别错误，不静默跳转。
- [ ] **Step 3: 测试各提示词输出边界。** 断言澄清/诊断输出目标、对象、现状、约束、成功标准和保留项；路线包含步骤目标、输入、产出和检查；复盘引用具体差异并给出成功/失败/待验证建议及依据；不得直接输出改写后的文章、代码或目标成果。
- [ ] **Step 4: 实现阶段提示词构建函数。** 提供 `buildClarificationPrompt(task)`、`buildDiagnosisPrompt(task)`、`buildRoutePrompt(task, evidence)`、`buildStepPrompt(task, step)`、`buildResultReviewPrompt(task, externalResult, feedback)`。每次只传当前阶段摘要和被选中的引用，不拼接完整聊天历史。
- [ ] **Step 5: 运行专项测试。** 运行 `node --test tests/prompt-agent-workflow.test.js tests/prompt-agent-prompts.test.js`；预期边界测试全部通过。

## Task 3: 授权目录自动发现与轻量资料索引

**Files:**
- Create: `prototype/local-source-index.js`
- Create: `electron/prompt-agent-sources.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Test: `tests/local-source-index.test.js`
- Test: `tests/electron-prompt-agent-sources.test.js`

- [ ] **Step 1: 写索引器失败测试。** 使用临时目录覆盖 Markdown、纯文本、JSON/YAML、Skill、工作流及 JS/TS/Python/Shell/PowerShell 源码的发现；覆盖文件更新/删除、路径越界、超过 1 MiB、`.git`、依赖目录、构建产物、二进制和 `.env`/私钥排除。
- [ ] **Step 2: 实现纯本地发现和索引。** 固定接口为 `listSourceFiles(root, options)`、`indexSourceFile(path, options)`、`refreshSourceIndex(root, previousIndex)`、`searchSourceIndex(index, query, filters)`。只生成文件元信息、标题、关键词与片段，不调用模型或执行文件内容。
- [ ] **Step 3: 写 Electron 授权测试。** 验证选择目录后只允许该目录内读取，拒绝未授权绝对路径和路径穿越；renderer 仅能调用目录选择、授权列表、索引刷新、索引移除等明确 API。
- [ ] **Step 4: 接入安全 IPC。** 目录选择由主进程原生对话框完成；授权来源使用稳定 ID 和用户选择的目录，不向模型发送本地绝对路径；preload 不暴露通用 filesystem 或 shell 能力。
- [ ] **Step 5: 运行索引和 IPC 专项测试。** 运行 `node --test tests/local-source-index.test.js tests/electron-prompt-agent-sources.test.js`；预期授权边界和排除规则全部通过。

## Task 4: 自动选材、案例权重和模型协调器

**Files:**
- Create: `prototype/prompt-agent-coordinator.js`
- Modify: `prototype/knowledge-search.js`
- Modify: `prototype/retriever.js`
- Modify: `prototype/prompt-engine.js`
- Test: `tests/prompt-agent-coordinator.test.js`
- Test: `tests/knowledge-search.test.js`
- Test: `tests/prompt-engine.test.js`

- [ ] **Step 1: 写自动选材测试。** 准备提示词、成功案例、失败案例、待验证案例、Skill、工作流、脚本和无关资料；验证按任务领域、当前阶段、关键词、验证状态和适用边界排序。成功案例不能只因标为成功就泛化，失败案例必须展示触发条件与失效原因。
- [ ] **Step 2: 实现相关性选择和预算限制。** 复用现有 `collectKnowledgeEntries`/`searchKnowledge` 能力，扩展任务阶段和来源类别筛选；默认最多 3 条来源、模型上下文合计约 1,500 tokens。来源片段始终带标题、路径/链接、用途、验证状态和局限。
- [ ] **Step 3: 写协调器失败测试。** 注入模型、资料检索、持久化和研究服务，验证每一阶段只发必要摘要；来源指令不会覆盖用户要求；取消、超时和模型失败保留当前草稿与已有来源。
- [ ] **Step 4: 实现 coordinator。** 提供 `createPromptAgentCoordinator(dependencies)`，其阶段方法调用 schema/workflow/prompt/index/retriever 的窄接口；禁止自由循环、隐式多模型评审或自动保存案例。
- [ ] **Step 5: 运行知识检索和协调器回归。** 运行 `node --test tests/prompt-agent-coordinator.test.js tests/knowledge-search.test.js tests/prompt-engine.test.js`；预期自动选材顺序、来源引用和上下文上限通过。

## Task 5: 联网搜索与研究 Agent 的确认式交接

**Files:**
- Create: `prototype/prompt-agent-research-bridge.js`
- Modify: `prototype/prompt-agent-coordinator.js`
- Modify: `server/search-client.js` only if the existing search response lacks required source metadata
- Test: `tests/prompt-agent-workflow.test.js`
- Test: `tests/prompt-agent-coordinator.test.js`
- Test: `tests/prompt-agent-integration.test.js`

- [ ] **Step 1: 写确认与预算测试。** 外部研究请求先产生查询目标、来源类型和预算预览；未确认不能调用搜索/研究服务。默认上限为 3 个查询、5 个来源；超限必须重新确认。搜索不包含用户粘贴的完整文章或个人敏感原文。
- [ ] **Step 2: 实现通用网页搜索接入。** 复用现有 `server/search-client.js` 和发送安全预览，结果结构保留标题、URL、可得日期、摘要、适用性和局限；来源数量与实际查询次数计入预算。
- [ ] **Step 3: 实现社媒研究窄交接。** 仅当任务确需小红书、Reddit、YouTube 等平台资料时，通过 `prompt-agent-research-bridge.js` 提交带明确问题、平台范围、查询/结果预算的研究任务；复用既有研究 Agent 的计划确认流程。只接收结构化摘要、来源和研究局限，不传递聊天记录，也不触发 Agent 间循环调用。保持研究 Agent 自身工作流不变。
- [ ] **Step 4: 测试降级和取消。** 搜索不可用时提供手动查询指令并标注未完成；研究部分失败时保留已有来源并标明缺口；用户取消或预算耗尽后不得继续调用。
- [ ] **Step 5: 运行跨能力专项测试。** 运行 `node --test tests/prompt-agent-integration.test.js tests/prompt-agent-coordinator.test.js`；预期确认门、预算、引用和失败降级通过。

## Task 6: 提示词 Agent 工作台和用户确认交互

**Files:**
- Create: `prototype/prompt-agent-ui.js`
- Modify: `prototype/index.html`
- Modify: `prototype/app.js`
- Test: `tests/prompt-agent-ui.test.js`
- Test: `tests/e2e-smoke.test.js`

- [ ] **Step 1: 写 UI 行为测试。** 验证三类任务入口、逐个问题、事实/假设/待确认分区、可编辑路线、研究确认面板、自动选择来源展开/排除、所选步骤提示词复制和外部结果复盘入口。
- [ ] **Step 2: 实现独立工作区视图。** 展示当前阶段和任务摘要；来源引用显示标题、来源路径/链接、相关原因、适用条件和验证状态。默认折叠长材料与非当前步骤细节，不显示系统实现说明。
- [ ] **Step 3: 接入发送预览和复制操作。** 任何模型外发继续经过现有发送预览；复制当前提示词无需调用模型。生成/更新草稿不自动保存为已确认案例。
- [ ] **Step 4: 接入应用导航和页面加载。** 在 `prototype/app.js` 只负责组装依赖和导航事件，Agent 的状态迁移和检索逻辑保留在专用模块。
- [ ] **Step 5: 运行 UI 与 smoke 测试。** 运行 `node --test tests/prompt-agent-ui.test.js tests/e2e-smoke.test.js`；预期页面脚本加载、关键控件事件和提示词复制链路通过。

## Task 7: 成功/失败复盘、备份边界和完整回归

**Files:**
- Modify: `prototype/storage.js`
- Modify: `prototype/workspace-backup.js`
- Modify: `prototype/app.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/MVP_SCOPE.md`
- Test: `tests/prompt-agent-integration.test.js`
- Test: `tests/storage.test.js`
- Test: `tests/workspace-backup.test.js`
- Test: `tests/package-config.test.js`
- Test: `tests/electron-smoke.test.js`

- [ ] **Step 1: 写案例确认测试。** 外部 AI 结果复盘需包含用户目标、成功标准、保留项、外部结果片段、偏差证据和用户反馈；Agent 只能建议成功/失败/待验证。未经用户明确确认不得进入已验证案例，更新已确认案例须产生新版本并保留旧版。
- [ ] **Step 2: 接入案例版本管理。** 复用现有 `confirmCase`、`updateCase`、版本快照和知识条目映射；将适用条件与失效边界作为案例摘要字段，自动检索只读当前版本摘要。
- [ ] **Step 3: 验证存储和备份边界。** 增加确认式保存、删除和版本恢复覆盖；索引可重建且不进入普通备份。断言 API key、cookie、session token、未保存原文、截图和未授权目录信息不会导出。
- [ ] **Step 4: 更新产品文档和打包检查。** 描述独立提示词 Agent 与研究 Agent 的职责、自动本地选材、联网预算确认、用户保存成功/失败案例和不执行目标任务的边界；把新 JS 文件纳入 `package.json` 的语法检查/构建清单。
- [ ] **Step 5: 运行完整必要回归。** 运行 `pnpm test` 与 `pnpm check`；若现存合并冲突导致命令或文件状态不可用，先在隔离 worktree 按任务解决必要冲突并记录，不修改主工作区用户内容。预期既有测试无回归，新 Agent 套件通过。
- [ ] **Step 6: 完成 Electron 手工验收清单。** 验证目录授权与撤销、跨重启任务摘要、联网确认和取消、模型发送预览、复制提示词、案例确认/版本回溯、备份排除项；分别记录开发模式和 Windows 打包模式结果，不把自动测试代替真实浏览器/安装器检查。

## 依赖顺序

Task 1 → Task 2；Task 3 与 Task 1 可并行；Task 4 依赖 Task 1–3；Task 5 依赖 Task 2 和 Task 4；Task 6 依赖 Task 1–5；Task 7 收尾并验证所有模块。核心交付顺序是先固定状态与授权边界，再接入自动选材和确认式研究，最后提供工作台与案例沉淀。
