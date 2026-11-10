# 向前一步 DSH 插件全功能迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改动原应用的前提下，把提示词工具的全部面向用户能力按设计稿八阶段迁入 DSH 插件，并以独立数据、显式迁移和可复核证据达到全功能验收。

**Architecture:** 继续使用 `.dsh-workspace` 中的插件副本和现有 JavaScript/TypeScript 结构，先按实测 DSH 接口完善基础层，再把原应用已验证的领域逻辑适配到插件自己的 schema、工作区与 Host 能力。原应用只作为只读代码/备份格式来源；模型、目录、搜索和平台采集只经已核验的 DSH 能力执行。旧实现、自动化测试、真实宿主可用性和迁移支持分别记录，不互相替代。

**Tech Stack:** Windows `pwsh.exe`、Node.js 内置 `node:test`、pnpm、现有 DSH 插件构建工具 TypeScript/tsdown、现有 Electron/JavaScript 领域模块（仅作只读参考）、隔离 DSH profile。

---

## 计划范围、边界和既有计划

- 本计划依据 `.dsh-workspace/docs/superpowers/specs/2026-11-05-forward-step-dsh-full-feature-migration-design.md`；与旧设计或旧计划不一致时，全功能范围及阶段顺序以该设计稿为准。
- 所有产品实现与验收记录限定在 `D:/VScode/项目/提示词工具/.dsh-workspace`，插件源码位于 `dsh-plugin/forward-step-dsh`。原应用代码、运行数据、设置、profile、凭证和用户文件保持只读且不被插件扫描；用户可在插件迁移界面显式选择一个备份文件作为导入输入，插件只读取该文件并将选定数据复制到插件独立存储。
- 新计划是全功能迁移的执行索引；保留 `2026-11-02-forward-step-dsh-plugin.md` 及已有专项计划原样。复用专项计划中的已通过任务和测试证据前，先核对其路径、设计版本和当前源码；不照搬已过时的“首版不导入/仅通用写作 PPT”范围。
- 本文作为八阶段总控与验收门，不替代现有领域专项计划中的细粒度实现步骤。执行某领域前先定位并核验对应专项计划；专项计划提供可独立运行的测试/实现步骤，本计划负责插件边界、跨域集成、迁移和全局验收。专项计划不存在、已过时或未覆盖的内容，才在本计划对应任务内补充，不复制整份旧计划。
- 新设计稿状态为待审阅整合稿；本计划先完成审阅与拆分，产品实现须待用户审阅并确认设计稿后开始。实现开始时，将明确的用户确认决策与“实施前按用户审阅结果冻结”的建议默认值分开登记；未冻结前只实现不依赖该决定的基础测试和隔离接口，不把建议悄然变成已确认行为。
- 不因任务规模自动循环 GUI。自动化与静态检查先行；只有隔离 DSH 窗口/profile 已可用时才进行本阶段必要的 GUI 验收。DSH 未打开或不可交互时记录 `not-run`、下一步入口和原因，继续其它工作，不反复空跑 GUI。
- 插件目录当前没有独立测试 script；从工作空间根执行测试。计划里的命令均以 `.dsh-workspace` 为当前目录，pnpm 使用已有 lockfile。

## 文件职责与执行前现状核对

下表是本计划允许新增/修改的候选边界。执行者先核对文件当前内容和 `git status`；对不存在的候选文件按对应 Task 创建，对已存在文件采用局部扩展，不整体替换。

| 路径（相对 `.dsh-workspace`） | 计划职责 |
| --- | --- |
| `dsh-plugin/forward-step-dsh/core/schema.js`、`core/store.js` | 插件自有版本化状态、输入校验、乐观修订和事务；不得依赖 Electron `localStorage` |
| `dsh-plugin/forward-step-dsh/core/migration/`（新增） | 来源解析、规范化、预览、ID 映射、依赖提交组、可恢复导入和逐类收据；职责拆成 `source.js`、`preview.js`、`commit.js`、`receipt.js` |
| `dsh-plugin/forward-step-dsh/core/backup.js`（新增） | 插件自身工作区备份格式、白名单、附件清单、限额和恢复验证；与原应用输入格式版本分开 |
| `dsh-plugin/forward-step-dsh/index.js`、`host/`、`client/` | 现有插件装配和 DSH Host 能力入口；只按当前宿主证据添加接口，不假设旧计划中的 `host/adapter.js` 已存在 |
| `dsh-plugin/forward-step-dsh/core/`、`memory/`、`client/` | 任务/计划、提示词资产、资料检索、写作/PPT/学术/社媒业务适配；保持领域逻辑与宿主 API 隔离 |
| `dsh-plugin/forward-step-dsh/memory/`、`client/memory.js`、`src/client/memory-panel.ts` | 跨领域记忆/画像的候选、分层范围、来源证据、查看/编辑/删除/撤销及冲突优先级；复用已存在的面板与服务，并与原应用 `writingMemories` 分开映射 |
| `dsh-plugin/forward-step-dsh/vendor/core/`、`scripts/dsh-stage-core.mjs`（新增） | 受控复制经许可且适用的领域核心依赖；新增生成脚本后检查 manifest、过期文件和来源，不复制整套原应用运行时 |
| `tests/dsh-plugin/` | 插件 schema、存储、迁移、领域适配、Host 契约、故障与包内容测试；继续使用 Node 内置测试 |
| `scripts/dsh-full-feature-acceptance.mjs`、`tests/dsh-plugin/full-feature-acceptance.test.mjs`（新增） | 全功能迁移专属必需项和状态汇总；不改变现有 `scripts/dsh-acceptance.mjs` 中已验收的基础插件必需项 |
| `docs/acceptance/forward-step-dsh/`（新增或局部更新） | 入口追踪矩阵、差距状态、每阶段收据、实际备份样本指纹、宿主能力和最终验收报告 |
| `docs/superpowers/plans/2026-11-02-forward-step-dsh-*.md` | 只读复用旧阶段说明；不作为本计划写入目标 |
| `prototype/`、`electron/`、`server/` 及原应用工作区数据 | 只读参考。除非新设计获得单独范围确认，不在这些路径写实现 |

现有相关参考计划：`2026-11-02-forward-step-dsh-01-host.md` 至 `05-acceptance.md`；`2026-10-19-workspace-backup-knowledge-management.md`；`2026-10-19-prompt-agent.md`；`2026-10-20-writing-workbench.md`；`2026-10-20-ppt-content-planning.md`、`2026-10-20-ppt-source-research.md`、`2026-10-20-ppt-visual-feedback.md`；`2026-10-21-writing-academic-a/b/c/d-implementation.md`；`2026-10-20-domestic-social-research-phases-2-4.md`。这些都是参考，不代表插件内已有对应能力。

## 常用验证命令

```powershell
# 工作空间根：插件单测
node --test 'tests/dsh-plugin/*.test.mjs' tests/forward-step-dsh.test.js tests/prompt-agent-coordinator-prepared-request.test.mjs

# 工作空间根：资料、备份、领域及原应用只读参考模块测试
node --test tests/workspace-backup.test.js tests/workspace-backup-archive.test.js tests/knowledge-management.test.js tests/knowledge-schema.test.js tests/knowledge-search.test.js tests/local-source-index.test.js 'tests/prompt-agent-*.test.js' 'tests/ppt-*.test.js' 'tests/writing-*.test.js' 'tests/academic-*.test.js' 'tests/social-*.test.js'

# 工作空间根：全量自动化和现有静态检查
pnpm test
pnpm check

# 插件目录依赖与包检查；构建输出仍仅在本插件目录
pnpm --dir dsh-plugin/forward-step-dsh run build
node --test tests/dsh-plugin/package.test.mjs
```

插件全量测试使用 `node --test 'tests/dsh-plugin/*.test.mjs'`；新增领域测试文件在相应任务建成后自动纳入该模式。所有命令从 `.dsh-workspace` 运行；包验证使用现有 `tests/dsh-plugin/package.test.mjs`，它在临时目录真实打包并检查 tarball 内容。`pnpm test`/`pnpm check` 主要覆盖原应用，不能替代插件测试、Host/Client 构建或包验证。预期定向新增测试先按设计失败、实现后通过；全量 `pnpm test`/`pnpm check` 退出码为 0；插件构建和 package test 成功。测试总数可能随已有用例变化，不固定总数作为通过条件。真实模型输出、DSH UI、安装留存和用户反馈必须引用真实收据；模拟、静态扫描和单元测试不得标为真实通过。

## 阶段 0：基线与覆盖盘点

### Task 0.1：建立本次实现差距矩阵

**Files:**
- Read: `AGENTS.md`、`README.md`、`package.json`、`dsh-plugin/forward-step-dsh/package.json`
- Read: `docs/superpowers/specs/2026-11-05-forward-step-dsh-full-feature-migration-design.md`
- Read: `docs/superpowers/plans/2026-11-02-forward-step-dsh-plugin.md` 与本计划列出的专项计划
- Create: `docs/acceptance/forward-step-dsh/full-feature-gap-matrix.md`
- Test evidence: `docs/acceptance/forward-step-dsh/`

- [x] **Step 1: 对设计稿每项用户动作建立唯一追踪行**

按设计稿 5.1 入口追踪表逐行建立 ID（`FF-001` 起），列固定为：原应用入口/动作、插件目标、相关来源字段、候选插件文件、自动化测试、真实 DSH 验收、迁移状态、证据文件、阻塞原因。把设计稿 5 节功能域、7.2 数据矩阵、8 节阶段门和 10 节总体验收关联到这些 ID，不把一项要求只挂到“集成测试”。

- [x] **Step 2: 对当前实现做证据分类**

逐项用源文件和现有测试定位插件实现，状态只能填 `implemented`、`automation-pass`、`host-pass`、`migration-pass`、`not-started` 或 `blocked`；已有旧验收报告需记录日期和版本，不将旧包结果外推到当前源码。缺证据填 `not-run`，不猜测状态。

- [x] **Step 3: 保存初始差距并复核覆盖**

运行 `node --test 'tests/dsh-plugin/*.test.mjs' tests/forward-step-dsh.test.js tests/prompt-agent-coordinator-prepared-request.test.mjs`，把实际命令、原样摘要、退出码和 git 状态写入差距文件。检查每个 `FF-*` 都关联至少一项测试或明确的外部验收证据；遗漏项先补追踪行，不动实现。

## 阶段 1：基础层、独立模型和迁移框架

### Task 1.1：冻结插件状态和迁移类别契约

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/core/schema.js`
- Modify: `dsh-plugin/forward-step-dsh/core/store.js`
- Create: `dsh-plugin/forward-step-dsh/core/migration/source.js`
- Test: `tests/dsh-plugin/migration-source.test.mjs`
- Test: `tests/dsh-plugin/store.test.mjs`

- [x] **Step 1: 为来源类别、未知字段与版本错误写失败测试**

测试受支持的工作区 JSON `forward-step-workspace`、完整 ZIP manifest `forward-step-workspace-archive`、资料库范围 JSON，以及未知格式、重复来源 ID、错误 schemaVersion 和畸形 UTF-8/JSON。ZIP 负向用例必须覆盖绝对路径/`..` 路径、重复归档路径、符号链接、声明大小与实际解压大小不符、压缩炸弹限额、超大 manifest/附件及摘要不匹配；拒绝时断言正式 store 和插件附件区均无写入。预览解析只接收已读入的字节/对象，不读取原应用路径或用户目录。

- [x] **Step 2: 实现纯解析入口与插件存储隔离断言**

定义内部入口 `parseSourceBackup({ format, bytes, sourceName }) -> { format, formatVersion, categories, attachments, warnings }`。格式字段先按已核验备份实现映射；未在样本中出现的可选字段输出缺失状态，不补造。校验失败抛带稳定 `code` 的错误，不写正式 store。存储测试使用临时目录，断言所有插件数据路径均在传入的插件根目录内。

- [x] **Step 3: 运行定向测试并完成 schema 扩展**

运行：`node --test tests/dsh-plugin/migration-source.test.mjs tests/dsh-plugin/store.test.mjs`。预期新输入边界测试先失败，新增 parser/schema 后通过；现有 store 并发修订、幂等 eventId 和 reopen 测试保持通过。插件状态新增集合必须显式更新 schema、初始状态和迁移测试，不改原应用 storage schema。

### Task 1.2：实现预览、白名单过滤和敏感字段统计

**Files:**
- Create: `dsh-plugin/forward-step-dsh/core/migration/preview.js`
- Create: `dsh-plugin/forward-step-dsh/core/migration/receipt.js`
- Test: `tests/dsh-plugin/migration-preview.test.mjs`
- Test: `tests/dsh-plugin/migration-receipt.test.mjs`

- [x] **Step 1: 编写类别计数与白名单用例**

至少覆盖 projects、tasks、promptAgentTasks、promptAgentSources、prompts、cases、references、knowledgeEntries、knowledgeMetadata、writingArticles、writingMemories、writingPacks、writingPackSettings、writingReviews、academicResponseProjects 及其真实存在的文献快照/筛选/提取子结构、researchTasks、researchAttachments、platformConnections、`researchSelection`、`knowledgeSelection`、`knowledgeFilters`、`knowledgeMetadata`、插件自有偏好/服务配置和凭证。把 `writingWorkspaces` 明确列为运行时存在但当前备份未包含的数据；插件偏好、插件服务配置、DSH Host 配置分列，不互相推断。逐类断言来源含有/未包含、支持/暂不支持、可导入/跳过/冲突/无效的计数。把连接字段中的 API key、Cookie、token、密码、profile/session 路径放入测试样本，断言输出只有排除类别和数量，没有原值。

- [x] **Step 2: 实现可预览的纯计划对象**

定义 `buildImportPreview({ parsedSource, pluginState, selectedCategories }) -> { policyVersion, mode, categories, warnings, excludedSensitiveCount }`。只读比对，不写 store；字段采用允许列表，未知字段和不支持子结构明确列出，不能用敏感词替换代替白名单。

- [x] **Step 3: 测试日志最小化和删除语义**

`createImportReceipt()` 仅保存备份指纹、格式/版本、类别计数、非敏感 ID 映射、状态、错误代码、附件校验结果和时间；测试递归断言不含正文、完整路径、查询材料或凭证。日志默认保留 90 天且占用不超过 10 MiB，任一上限先达到时先清理最旧的已结束收据；进行中收据不自动清理，达到硬上限时停止新增诊断明细并保留必要错误码。支持用户手动删除；删除 receipt 只移除收据，不改变已导入状态。以上为插件日志限额，不改变原应用备份限额。

- [x] **Step 4: 运行定向验证**

运行：`node --test tests/dsh-plugin/migration-preview.test.mjs tests/dsh-plugin/migration-receipt.test.mjs`。预期所有禁止字段断言通过；测试失败消息不得打印敏感样本原值。

### Task 1.3：冲突映射、依赖组与可恢复提交

**Files:**
- Create: `dsh-plugin/forward-step-dsh/core/migration/commit.js`
- Modify: `dsh-plugin/forward-step-dsh/core/store.js`
- Test: `tests/dsh-plugin/migration-commit.test.mjs`

- [x] **Step 1: 写引用完整性失败测试**

构造 source ID 分别映射到新建副本、相同内容已有记录、同 ID 冲突副本的 fixture。覆盖重复内容多候选、来源 ID 重复、跨类别引用、附件目标缺失、依赖类别未选、单独依赖组失败和重复重试；任何成功状态均断言引用可解析，失败组断言没有部分记录/附件。

- [x] **Step 2: 固定导入提交接口**

实现 `commitImport({ preview, selectedCategories, store, receiptStore, attachmentStore }) -> { categoryResults, receiptId }`。先按来源 ID 建立稳定映射，再校验依赖图与附件，最后按无环依赖组提交。内容相同记录映射到现有插件 ID；来源重复 ID 只有在类型/关系唯一消歧后才可继续；相同 ID 不同内容分配新插件 ID。未选择依赖类别的相关组整体暂缓或跳过，写入原因。一个依赖组失败时回滚该组；无依赖组可独立完成；用 receipt 保证同一次导入重试幂等。

- [x] **Step 3: 验证冲突和崩溃恢复**

运行：`node --test tests/dsh-plugin/migration-commit.test.mjs tests/dsh-plugin/faults.test.mjs tests/dsh-plugin/storage-domain.test.mjs`。注入附件落盘失败、store revision 冲突和提交后进程中止；重开后不得有悬空引用、孤儿附件或重复记录。

### Task 1.4：接入已核验 DSH Host 能力与插件入口

**Files:**
- Inspect/Modify: `dsh-plugin/forward-step-dsh/index.js`、`host/port.js`、`host/compatibility.js`、`src/host-service.ts`、`client.js`、`cordis.patch.yml`；`lib/` 是构建产物，只通过构建更新，不手改
- Create/Update: `docs/acceptance/forward-step-dsh/host-interface.json`
- Test: `tests/dsh-plugin/host.test.mjs`、`tests/dsh-plugin/profile.test.mjs`

- [x] **Step 1: 先验证当前宿主接口收据**

沿用 `2026-11-02-forward-step-dsh-01-host.md` 与现有 host fingerprint，先从当前安装声明和静态接口证据确认 DSH 版本、Storage Domain、工作区入口、文件选择器、模型/搜索和 dispose 生命周期。隔离 profile 的运行态 probe 仅在 DSH 已打开且可交互时执行；未打开时将运行态状态记为 `not-run` 并记录复测条件，不循环启动 GUI，也不阻塞可由契约测试完成的工作。只有声明和实际运行证据均通过才标记 `verified`；缺能力登记 `unsupported`，不新增猜测 API。

- [x] **Step 2: 为所需 Host 能力写契约测试**

2026-11-08 续接复核：现有 `tests/dsh-plugin/host.test.mjs` 已覆盖 storage/model/search/file/directory/panel/service/lifecycle 缺失入口、成功透传、宿主拒绝、取消（调用前/调度前/运行中）、订阅释放与 dispose 返回值；`getHostCapabilities()` 覆盖缺失/已注入状态且不执行服务副作用。Host/profile/包边界定向验证 25/25 通过，本 Step 关闭。

分别测试 storage、model、search、file/directory、panel、lifecycle 的缺失/成功/拒绝/取消/释放状态。业务模块只依赖插件内部能力接口，直接调用 DSH 对象的代码集中于现有 adapter/入口模块；若接口仍无证据则只保留 unavailable 状态。

- [x] **Step 3: 运行 Host 与包边界测试**

运行：`node --test tests/dsh-plugin/host.test.mjs tests/dsh-plugin/profile.test.mjs tests/dsh-plugin/package.test.mjs`。预期不支持能力明确返回 `unsupported_host` 或同等稳定错误，不发生外部模型/搜索/文件副作用；GUI 未打开时 profile 的运行态验收单独记 `not-run`，不得把契约测试写成宿主实测通过。

阶段门：原应用读写隔离、独立 schema/store、迁移预览无副作用、白名单与敏感字段过滤、冲突/依赖组恢复，以及逐项 Host 核验均有自动化或真实证据；缺失的 DSH 能力显示为 unavailable，不阻止不依赖该能力的本地功能继续开发。

### Task 1.5：完成显式迁移界面闭环

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/client.js`、`client/state.js`、`src/client/index.ts`、`host/port.js`（仅当该接口已被 Host 收据验证）
- Test: `tests/dsh-plugin/client.test.mjs`、`client-state.test.mjs`、`host.test.mjs`、`migration-preview.test.mjs`、`migration-commit.test.mjs`

- [x] **Step 1: 为导入界面状态转换写失败测试**

测试 empty → source-selected → preview-ready → categories-selected → committing → completed/partial/failed/cancelled 转换；预览/取消不改变 store，确认后才调用提交；错误可重试但同一次导入保持幂等，收据仅显示允许字段。

- [x] **Step 2: 在现有 Client 中实现文件到收据的闭环**

按 Host 收据实现文件选择或拖入（不自行调用猜测 API）；界面显示格式/版本、附件缺失、类别计数、跳过原因和冲突选项，用户确认后显示进度、取消结果、逐类状态和收据删除入口。不可用的宿主能力显示 unavailable；不得扫描原应用目录。

- [x] **Step 3: 运行界面控制器与 Host 契约测试**

运行：`node --test tests/dsh-plugin/client.test.mjs tests/dsh-plugin/client-state.test.mjs tests/dsh-plugin/host.test.mjs tests/dsh-plugin/migration-preview.test.mjs tests/dsh-plugin/migration-commit.test.mjs`。预期取消/预览无写入，成功提交可读回，失败状态/错误码明确；真实 DSH 文件选择器另在隔离 profile 留收据。

## 阶段 2：规划与资产

### Task 2.1：打通工作区导航、计划列表和领域任务入口

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/client.js`、`client/state.js`、`core/schema.js`、`core/tasks.js`、`core/context.js`
- Test: `tests/dsh-plugin/client-state.test.mjs`、`tasks.test.mjs`、`context.test.mjs`

- [x] **Step 1: 写导航与切换隔离测试**

一个项目创建多个任务，切换任务、归档、删除和重新打开后逐项断言当前 taskId、草稿、路线、历史、结果和材料不串项。所有入口分别记录入口类型和领域方法，防止把 planning/optimize/diagnose 当成互斥领域。

- [x] **Step 2: 实现最小工作区路由和恢复行为**

沿用现有 DSH panel 实例，不重复创建宿主框架；UI 按设计领域清单提供工作区入口和当前项目/任务切换。状态恢复来自插件 store；任务删除同步移除绑定、引用草稿和可清理审计快照。

- [x] **Step 3: 验证状态、语法和构建**

运行：`node --test tests/dsh-plugin/client-state.test.mjs tests/dsh-plugin/tasks.test.mjs tests/dsh-plugin/context.test.mjs`，然后执行插件 Host/Client build。预期定向测试通过、无跨任务残留，旧入口及 Skill provider 未回归。

### Task 2.2：迁移提示词 Agent、优化、结果诊断与计划资产

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/core/agent.js`、`core/methods.js`、`core/versions.js`、`core/domain-spec.js`、`client.js`
- Create: `scripts/dsh-stage-core.mjs`（当前不存在；实现受控复制、来源/许可校验、哈希清单与过期文件检查）
- Modify generated sources only through: `scripts/dsh-stage-core.mjs` and source manifest
- Test: `tests/dsh-plugin/agent.test.mjs`、`methods.test.mjs`、`versions.test.mjs`、`real-model-isolation.test.mjs`

- [x] **Step 1: 为三类入口与提示词案例资产写行为测试**

固定三个不同 fixture：模糊想法、已有提示词优化、外部 AI 结果诊断。断言澄清问题、路线、当前步骤提示词、编辑/复制、外部结果回填、撤销/重试、提示词版本/案例来源和验证状态。相同领域方法可由三种入口发起，历史方法输出不变。

- [x] **Step 2: 适配原应用领域函数而不搬入原运行时**

用 `scripts/dsh-stage-core.mjs` 只复制实际依赖闭包；检查 `vendor/core/manifest.json` 的路径、hash、来源和许可。Agent 仍通过当前 HostPort；请求上下文必须先经过用户可见预览，外部回填必须关联本次 prompt version，不以复制动作推断外部 AI 成功。

- [x] **Step 3: 运行三入口联合回归**

运行：`node --test tests/dsh-plugin/agent.test.mjs tests/dsh-plugin/methods.test.mjs tests/dsh-plugin/versions.test.mjs tests/dsh-plugin/real-model-isolation.test.mjs tests/prompt-agent-coordinator-prepared-request.test.mjs`。预期隔离测试证明只发送 prepared request；真实模型效果留到隔离 DSH 验收阶段。

### Task 2.3：管理提示词资产与跨领域记忆/画像

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/core/schema.js`、`core/methods.js`、`core/versions.js`、`client.js`、`client/memory.js`、`memory/profile.js`、`memory/policy.js`、`memory/history.js`、`src/client/index.ts`
- Test: `tests/dsh-plugin/agent.test.mjs`、`methods.test.mjs`、`memory-policy.test.mjs`、`memory-view.test.mjs`、`memory-history.test.mjs`、`memory-promotion.test.mjs`
- Reference: `docs/superpowers/plans/2026-11-02-forward-step-dsh-04-memory.md`；原应用 `writingMemories` 只作写作记忆迁移来源

- [x] **Step 1: 为提示词、案例与方法资产生命周期写测试**

覆盖提示词新建/编辑/版本比较/归档、案例来源和许可信息、验证状态、方法卡和专业基础包查看/选择；断言社区内容不会被误记为已同步，案例从导入到插件库需要显式用户动作。

- [x] **Step 2: 为分层记忆、冲突和撤销写测试**

用两个项目和不同领域的合成记录测试全局/项目/任务/对话范围、来源证据、人工本轮要求优先、历史冲突提示、编辑/删除/撤销、派生画像一致性及重启恢复。断言撤销不删除 DSH 原始对话，删除来源后已撤销记忆不会自动复活。

- [x] **Step 3: 复用现有确定性记忆策略并保持数据分离**

复用 `memory/policy.js`、`profile.js`、`history.js`、`service.js` 和 `client/memory.js`，仅按失败测试增加最小接口。原应用 `writingMemories` 只进入写作记忆域；不得自动提升为跨项目 Agent 记忆或画像。

- [x] **Step 4: 运行资产与记忆定向回归**

运行：`node --test tests/dsh-plugin/agent.test.mjs tests/dsh-plugin/methods.test.mjs tests/dsh-plugin/memory-policy.test.mjs tests/dsh-plugin/memory-view.test.mjs tests/dsh-plugin/memory-history.test.mjs tests/dsh-plugin/memory-promotion.test.mjs tests/dsh-plugin/assets.test.mjs`，43/43 通过；`pnpm --dir dsh-plugin/forward-step-dsh run build` 的 Host/Client 构建通过。资产存储与 Host RPC 已验证，资产 Client 已挂入侧栏。阶段门：真实 DSH 侧栏与跨会话行为仍需 Host 收据；提示词版本比较及方法卡/专业基础包统一管理仍未完成。

### Task 2.4：承接社区提示词、公开资料、手动搜索和研究样本入口

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/client.js`、`core/context.js`、`src/client/index.ts`
- No new module by default; keep external-link metadata in existing Client/domain state. Create `core/external-references.js` only if a failing test proves persistent domain logic cannot fit current modules.
- Test: `tests/dsh-plugin/external-references.test.mjs`、`tests/dsh-plugin/context.test.mjs`
- Read-only reference: 设计稿 5.1 对应入口行和原应用实现；不复制无明确许可的社区内容

- [x] **Step 1: 为外链、搜索指引和样本隔离写测试**

逐项测试社区提示词/公开资料链接及来源提示、手动搜索指引不伪造本地结果、Agent/写作/规划研究样本可查看但默认不进入任务上下文。样本 fixture 包含指令文本，断言未选择时 prepared request 不含该文本。

- [x] **Step 2: 实现最小入口承接并尊重来源许可**

优先提供外链、用途说明和手动搜索路径；用户主动导入的许可内容才进入插件资料库并沿用不可信资料预览规则。宿主不支持打开链接或搜索时显示 unavailable 和可复制地址，不造出虚构搜索结果。

- [x] **Step 3: 运行入口和上下文隔离回归**

运行：`node --test tests/dsh-plugin/external-references.test.mjs tests/dsh-plugin/context.test.mjs tests/send-safety.test.js`。阶段门：设计稿 5.1 对应入口均链接到插件动作，或记录准确的外链/不可用说明；研究样本不被隐式注入。

## 阶段 3：资料与检索

### Task 3.1：适配资料条目、题录、收藏/筛选和来源索引

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/core/research.js`、`core/context.js`、`core/schema.js`、`client.js`、`vendor/core/manifest.json`
- Create only if a failing test proves a separate responsibility is needed: `dsh-plugin/forward-step-dsh/core/knowledge.js` or `core/retrieval.js`
- Test: `tests/dsh-plugin/knowledge.test.mjs`、`retrieval.test.mjs`
- Read-only source references: `prototype/knowledge-schema.js`、`prototype/knowledge-search.js`、`prototype/local-source-index.js`、`prototype/academic-literature.js`

- [x] **Step 1: 添加资料检索失败测试**

测试新增/编辑/删除、收藏/置顶/筛选、来源链接、题录、知识条目和任务引用的持久化；覆盖 `researchSelection`、`knowledgeSelection`、`knowledgeFilters`、`knowledgeMetadata` 在有字段、缺字段和无效引用时的迁移/恢复规则。旧备份缺字段对应空选择和默认筛选，必须在预览中说明。

- [x] **Step 2: 实现可重建本地索引和显式材料选择**

索引只针对插件工作区及用户授权目录；保存源 ID、用途、摘要、解析状态和索引版本。只有用户在当前任务明确选择并通过发送预览的资料才能进入模型请求；不使用隐式全库检索越权补充内容。取消授权后停止读取目录并清理/标记不可用索引。

- [x] **Step 3: 加入不可信资料测试并运行**

fixture 含“忽略上文指令”等提示文本；断言附件文本只作为隔离、标注来源的用户资料进入上下文，不会执行脚本/命令或覆盖系统、开发及用户当前指令。运行：`node --test tests/dsh-plugin/knowledge.test.mjs tests/dsh-plugin/retrieval.test.mjs tests/knowledge-search.test.js tests/local-source-index.test.js tests/send-safety.test.js`。阶段门：迁移字段恢复、来源可追溯、选择前不外发、索引可重建、授权撤销和不可信资料处理均通过。

## 阶段 4：写作工作台

### Task 4.1：实现写作项目、文章轮次与复盘状态

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/core/schema.js`、`core/versions.js`、`core/tasks.js`、`core/context.js`、`src/host-service.ts`、`src/client/index.ts`
- Create/Modify: `dsh-plugin/forward-step-dsh/core/writing.js`、`src/client/writing-workspace-panel.ts`
- Test: `tests/dsh-plugin/writing.test.mjs`、`tests/dsh-plugin/writing-workspace.test.mjs`、`tests/dsh-plugin/writing-host.test.mjs`、`tests/dsh-plugin/client.test.mjs`
- Reference: `docs/superpowers/plans/2026-10-20-writing-workbench.md`

- [x] **Step 1: 为新建/改写及文章轮次写失败测试**

覆盖新建文章、基于已有文章改写、任务绑定、阶段/轮次保存、版本比较、回退、重试、复盘确认/跳过和重启读回；每个对象的 projectId/taskId/版本关系均可解析。

- [x] **Step 2: 实现最小插件写作工作区模型**

只在插件 schema/store 保存文章元数据、轮次、提示词版本、外部结果引用和复盘状态；沿用现有领域模块，不改原应用数据。失败保存不覆盖上一成功版本，不把复制提示词当作外部写作成功。

- [x] **Step 3: 运行写作状态定向回归**

运行：`node --test tests/dsh-plugin/writing.test.mjs tests/dsh-plugin/versions.test.mjs tests/dsh-plugin/tasks.test.mjs`。预期轮次/复盘可恢复，跨任务状态不串项，失败保留上一版本。

### Task 4.2：迁移材料、授权工作空间与覆盖报告

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/core/schema.js`、`core/context.js`、`client.js` 和 Task 1 已验证的文件/附件 HostPort 接口；本阶段只保存材料引用与授权状态，不依赖后续阶段才创建的备份编码器
- Create: `dsh-plugin/forward-step-dsh/core/writing-materials.js`（仅当现有知识/检索接口不能表达用途与覆盖状态）
- Test: `tests/dsh-plugin/writing-materials.test.mjs`、`tests/dsh-plugin/writing-material-files.test.mjs`、`tests/dsh-plugin/writing-material-host.test.mjs`、`tests/dsh-plugin/writing-material-parser.test.mjs`、`tests/dsh-plugin/writing.test.mjs`、`tests/dsh-plugin/client.test.mjs`
- Read-only reference: `docs/superpowers/plans/2026-10-21-writing-materials-implementation.md`、`2026-10-21-writing-material-parsing-implementation.md`

- [x] **Step 1: 为材料用途、解析状态和覆盖范围写测试**

区分事实材料、来源材料和风格参考；测试单文件/多文件解析成功、部分失败、取消授权、文件缺失和附件不可恢复。断言只读取用户选择或授权的路径，`writingWorkspaces` 未在来源备份出现时预览为缺失，不伪报迁移成功。

- [x] **Step 2: 为内容预览和不可信材料边界写测试**

准备包含“忽略上文指令”和伪造命令的材料，断言未选择内容不进入请求、选中内容显示实际外发预览并保持不可信来源标签，不执行其中脚本或命令。

- [x] **Step 3: 实现材料用途、权限和失败保留**

以插件内稳定 sourceId 和用途标记关联文章/task；目录访问使用已核验 DSH 授权能力，取消后停止读取并清除或标记失效索引。解析/覆盖失败保留原文和上一成功版本，报告指出失败文件/范围。

- [x] **Step 4: 运行材料定向回归**

运行：`node --test tests/dsh-plugin/writing-materials.test.mjs tests/dsh-plugin/writing.test.mjs tests/knowledge-search.test.js tests/writing-material-parser.test.js tests/writing-material-coverage.test.js`。阶段门：显式选择、授权边界、失败保留和不可信内容路径均通过。

### Task 4.3：完成专业基础包及全部规划文体覆盖

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/core/schema.js`、`core/methods.js`、`core/domain-spec.js`、`client.js`
- Create: `dsh-plugin/forward-step-dsh/core/writing-packs.js`（仅当现有方法/领域结构无法承接包版本与维护）
- Test: `tests/dsh-plugin/writing-packs.test.mjs`、`tests/dsh-plugin/writing-genres.test.mjs`
- Reference: `docs/superpowers/plans/2026-10-22-writing-domain-expansion-completion-implementation.md` 及其链接的文体专项计划

- [x] **Step 1: 建立设计稿文体到能力状态的矩阵测试**

至少逐项列出普通文章、长篇研究文章、学术/学位论文、文献综述、审稿/投稿、商务营销、新闻/机构新闻稿、技术/产品文档、社交短内容、影视/口播/播客/演讲、小说、剧本、教程/课程、简历/求职、邮件、公文、法律文书。每项指定来源计划、专业包、材料用途和代表任务；状态只允许 supported/partial/unsupported 并附原因。不得用空白模板通过。

当前源码的文体矩阵由 `tests/dsh-plugin/writing-genres.test.mjs` 覆盖，2026-11-07 插件全量测试复核通过；这只证明状态/入口配置，不等同于每种文体的真实模型效果。

- [x] **Step 2: 测试专业包版本、来源与维护操作**

2026-11-07 全量及定向回归覆盖专业包来源/状态、历史比较、启停/导入/恢复/删除，以及来源迁移中 `writingPackSettings` 的 ID 映射、冲突保留与未知/非法版本报告；自动化通过。

2026-11-07 已补专业包内容差异比较、历史版本选择、Host 异步写入等待，以及启停/导入/恢复/删除回归；来源迁移恢复 `writingPackSettings` 与未知版本语义仍待有依据的格式契约和专门测试，不将本步骤标完成。

- [x] **Step 3: 逐类完成代表任务并运行写作回归**

对每个承诺 supported 的文体运行从入口、材料选择、提示词生成/编辑/复制、结果回填到版本/复盘恢复的代表任务测试。运行：`node --test tests/dsh-plugin/writing-packs.test.mjs tests/dsh-plugin/writing-genres.test.mjs tests/dsh-plugin/writing.test.mjs tests/writing-workbench-schema.test.js tests/writing-workbench-prompts.test.js tests/writing-workbench-coordinator.test.js tests/writing-pack-schema.test.js tests/writing-pack-coordinator.test.js`。阶段门：所有文体均有状态与证据，未支持项有原因，整体不以菜单入口或模板占位冒充全功能。

## 阶段 5：PPT

### Task 5.1：迁移 PPT 规划、来源研究与视觉反馈

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/core/methods.js`、`core/domain-spec.js`、`core/versions.js`、`client.js`
- Modify existing: `dsh-plugin/forward-step-dsh/core/methods.js`、`core/domain-spec.js`、`core/versions.js`、`src/client/index.ts`；只有测试证明领域逻辑需拆分时才新建 `core/ppt.js`，不另建 panel bundle
- Test: `tests/dsh-plugin/ppt.test.mjs`
- Reference: `docs/superpowers/plans/2026-10-20-ppt-content-planning.md`、`2026-10-20-ppt-source-research.md`、`2026-10-20-ppt-visual-feedback.md`

- [x] **Step 1: 为简报到逐页规划的任务链编写测试**

覆盖场景、受众、时长、页数/约束、路线、资料研究确认、逐页内容、制作提示词、预览、标注、反馈、版本对比和局部重跑。数据应绑定 taskId 和 source IDs；来源解析失败要保留失败范围与原计划。

- [x] **Step 2: 接入已核验的 PPTX/截图导入、逐页理解与提示词闭环**

按用户 2026-11-08 确认的范围，本步骤只验收 PPTX/截图导入、逐页理解与标注、生成修改提示词：未支持或缺失的图像资源保留为待补视觉素材并提示补整页截图；页面理解可结合确认提交给所选模型的图像和本页 OCR/正文，但 OCR/图中文字均标为不可信；反馈只作用于已选且未过期的页标注。不得执行附件脚本/命令，不得把草稿/提示词冒称成品。本次自动化与 r6 隔离安装/恢复通过；不扩展 PPT 成品导出，既有导出代码保留不变。DSH GUI 与真实模型视觉效果另列未验收项。

2026-11-07 续接实现：新增插件本地 Office Open XML PPTX 导出，逐页标题/正文以可编辑文本框输出；Client 可逐页选取 PNG/JPEG 并嵌入 PPTX，校验签名与大小。ZIP/OOXML 检查和 LibreOffice headless 打开带图 PPTX 并转 PDF 均通过。HTML/CSS 自动转换、图表对象重建、真实 DSH 网页能力和桌面视觉验收仍未完成，因此本 Step 保持未完成。详见 `docs/acceptance/forward-step-dsh/continuation-verification-20261107.md`。

2026-11-07 续接：PPT 静态 HTML 导入现识别任意元素上的 `.slide`、多层 `.slides` 容器与 `body` 统一背景；正文保留副标题、引用、段落和清单，Client 明示仅转换安全白名单与可映射样式。定向测试 34/34、插件 Host/Client 构建通过。复杂 CSS/任意布局、PPTX 输入直接渲染和真实 DSH 视觉验收仍未完成，Task 5.1 Step 2 继续未勾选。

2026-11-07 续接追加：社媒公开网页搜索现在将 AbortSignal 从 Client 传到 Host/WebRuntime；用户取消或组件卸载后不新增失败记录、不消耗预算。Host 同时拒绝同一任务并发公开搜索，避免多窗口基于旧预算重复请求。Task 7.1 Step 2 仍未完成，因四平台真实授权采集适配器尚未核验。

2026-11-07 续接追加：社媒报告提示词可编辑并另存为新版本；编辑版本保留父版本与原结果 ID，限制 250,000 字符并在历史上限内优先保留父版本。见 `docs/acceptance/forward-step-dsh/continuation-verification-20261107.md`。真实平台授权采集适配器仍未核验，Task 7.1 Step 2 不勾选。

- [x] **Step 3: 执行 PPT 定向测试**

运行：`node --test tests/dsh-plugin/ppt.test.mjs tests/ppt-scene-schema.test.js tests/ppt-scene-workflow.test.js tests/ppt-scene-prompts.test.js tests/ppt-scene-coordinator.test.js tests/ppt-feedback-schema.test.js tests/ppt-feedback.test.js tests/ppt-source-research.test.js`。阶段门：代表任务从简报到逐页规划、来源/反馈版本可读回、局部重跑只改变选中内容、导入指令不执行、未生成成品的状态准确显示。

## 阶段 6：学术工作流

### Task 6.1：迁移学术项目、文献综述、投稿和审稿回应

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/core/schema.js`、`core/versions.js`、`src/client/index.ts`；如 Task 3.1 已创建 `core/knowledge.js`，仅扩展其学术引用接口
- Create: `dsh-plugin/forward-step-dsh/core/academic.js`（仅当测试证明现有模块不能清晰承接学术工作流；不另建 panel bundle）
- Test: `tests/dsh-plugin/academic.test.mjs`
- Reference: `docs/superpowers/plans/2026-10-21-writing-academic-a-implementation.md`、`docs/superpowers/plans/2026-10-21-writing-academic-b-implementation.md`、`docs/superpowers/plans/2026-10-21-writing-academic-c-implementation.md`、`docs/superpowers/plans/2026-10-21-writing-academic-d-implementation.md`
- Read-only source: `prototype/academic-literature.js`、`academic-review.js`、`academic-publishing.js` 及协调器/UI 配套文件

- [x] **Step 1: 为学术数据 schema 与来源快照写测试**

覆盖 RIS/BibTeX/题录导入、来源去重、文献快照、筛选/纳排决定、证据提取、投稿要求、审稿轮次、意见逐条映射、修改计划和回复草稿。未知字段列入预览不静默丢弃；引用仍指向插件资料记录。

- [x] **Step 2: 接入已实现领域流程，不扩成新参考文献产品**

复用专项计划与 vendor 核心中经验证的流程，学术记录及工作区保存在插件数据。提示词引用、证据和来源可追溯；不声称自动验证引用真实性、不自动投稿、不自动发表、不默认做 Zotero 同步。

- [x] **Step 3: 运行学术回归**

运行：`node --test tests/dsh-plugin/academic.test.mjs tests/academic-literature.test.js tests/academic-literature-client.test.js tests/academic-literature-ui.test.js tests/academic-review.test.js tests/academic-review-app.test.js tests/academic-review-coordinator.test.js tests/academic-review-ui.test.js tests/academic-publishing.test.js tests/academic-publishing-coordinator.test.js tests/academic-publishing-ui.test.js`。阶段门：论文优化、综述筛选/证据提取和逐条审稿回复三条代表链可保存/恢复，引用、筛选范围、轮次及不可信材料处理一致；不扩展为自动投稿或引用真实性认证。

## 阶段 7：社媒研究

### Task 7.1：按平台状态矩阵迁移任务、附件和报告

**Files:**
- Modify: `dsh-plugin/forward-step-dsh/core/schema.js`、`core/research.js`、`core/context.js`、`src/client/index.ts`；附件持久化只调用 Task 1 建立并验证的插件附件接口，不依赖 Task 8.1 的备份编码器
- Create: `dsh-plugin/forward-step-dsh/core/social-research.js`（仅当测试证明现有 research 模块不能清晰承接平台任务；不另建 panel bundle）
- Test: `tests/dsh-plugin/social-research.test.mjs`
- Reference: `docs/superpowers/plans/2026-10-20-domestic-social-research-phases-2-4.md`、`2026-10-20-domestic-social-research-stability.md`、`2026-10-20-social-research-wizard-plan.md`
- Read-only source: `prototype/social-research-schema.js`、`social-research-workflow.js`、`social-research-ui.js`、`electron/social-attachment-store.js`

- [x] **Step 1: 固定平台能力状态用例**

小红书、哔哩哔哩、微博、知乎分别测试新建、运行、重跑、未授权、适配不可用和部分失败；Reddit、YouTube 仅测试可识别历史任务查看/迁移，不提供新建/重跑按钮。未知平台作为不支持项报告。

- [x] **Step 2: 接入任务计划、来源、附件和恢复**（插件侧实现完成；真实平台登录/采集运行态仍按 Host/GUI 验收记录为 not-run）

调用前展示平台、查询、预算和材料并要求确认；任务支持暂停、取消、重试、跳过和报告重跑。附件必须用户显式保存后进入插件备份，引用和附件摘要经校验。凭证/登录态不导入，平台须在 DSH 侧重新授权。历史帖子或附件里的指令文本只作为不可信材料。

- [x] **Step 3: 测试平台与故障边界**

运行：`node --test tests/dsh-plugin/social-research.test.mjs tests/social-research-schema.test.js tests/social-research-workflow.test.js tests/social-research-ui.test.js tests/social-research-integration.test.js tests/social-browser-adapters.test.js tests/social-source-manager.test.js tests/social-api-client.test.js tests/workspace-backup-archive.test.js`。阶段门：小红书、哔哩哔哩、微博、知乎分别记录授权后新建/运行状态；未授权不产生网络调用；单平台失败保留其它结果；Reddit/YouTube 只读历史兼容且不会伪装为可重跑。

## 阶段 8：设置、插件备份/恢复和完整验收

### Task 8.1：实现插件设置分类及独立备份恢复

**Files:**
- Create: `dsh-plugin/forward-step-dsh/core/backup.js`（若阶段 1 尚未创建）
- Modify: plugin `core/schema.js`、`core/store.js`、`index.js`、`client.js`、`package.json`
- Test: `tests/dsh-plugin/backup.test.mjs`、`tests/dsh-plugin/package.test.mjs`
- Test/source references: `tests/workspace-backup-archive.test.js`、`electron/workspace-backup-archive.js`（只读）

- [x] **Step 1: 写插件格式的导出/恢复契约测试**

插件格式有独立 formatVersion/schemaVersion；导出只包含用户选择的插件数据和主动保存附件。非敏感偏好默认可选；插件端点/模型标识单独列项、默认不导出；DSH Host 配置和所有凭证排除。恢复空工作区与合并工作区使用不同确认并都先做预览。

- [x] **Step 2: 实现来源格式和插件格式分离的备份操作**

来源 ZIP 按当前已验证限额检查：manifest 128 MiB、附件最多 10,000、单附件 25 MiB、单任务附件合计 25 MiB、解压总量 2 GiB。直接 JSON 在插件导入策略 v1 中限制文件 128 MiB、记录 100,000、深度 64；在备份样本和目标存储基准测试后记录冻结结果。插件自有备份不能拿这些来源格式数字替代其自身格式版本与限额。

- [x] **Step 3: 运行备份和泄漏测试**

运行：`node --test tests/dsh-plugin/backup.test.mjs 'tests/dsh-plugin/migration-*.test.mjs' tests/workspace-backup.test.js tests/workspace-backup-archive.test.js tests/dsh-plugin/package.test.mjs`。对导出包执行路径穿越、重复附件、缺摘要、超限、敏感字段扫描和恢复读回测试。

### Task 8.2：逐入口集成验收和交付收尾

**Files:**
- Create: `tests/dsh-plugin/full-feature-acceptance.test.mjs`、`scripts/dsh-full-feature-acceptance.mjs`
- Preserve unchanged: `tests/dsh-plugin/acceptance.test.mjs`、`scripts/dsh-acceptance.mjs` 的基础插件 REQUIRED_GROUPS；若抽取共用工具，新增兼容测试证明旧报告语义不变
- Create/Update: `docs/acceptance/forward-step-dsh/full-feature-gap-matrix.md`、`full-feature-results.json`、`FULL-FEATURE-RUNBOOK.md`
- Test: 全部 `tests/dsh-plugin/` 与阶段专项测试

- [x] **Step 1: 固定需求必需项和状态机**

为每个 `FF-*` 定义不可由报告输入删除的必需项清单，并关联自动化、真实宿主、真实能力、迁移四类证据。全功能状态只能为 `pass`、`fail` 或 `not-run`；任何必需项非 `pass` 时总报告为 `incomplete`。测试拒绝未知 ID、重复 ID、漏项、空数组和单靠自动化证据的 complete。新增脚本不得改变现有基础验收的必需项或语义。

- [x] **Step 2: 执行自动化、构建、包和隔离安装验证**

按“常用验证命令”运行插件全测、工作空间全测、`pnpm check`、Host/Client 构建和 `tests/dsh-plugin/package.test.mjs`；该包测试在临时目录打包 tarball 并检查文件边界。然后只在隔离 profile 安装包测试生成的候选 tarball。安装/重装/卸载不得修改日常 profile，数据留存按设计收据验证，用户数据使用合成 fixture，不把真实私密资料写入验收文件。

- [ ] **Step 3: 真实 DSH GUI 按需验收并留收据**

若隔离 DSH 当前打开且可交互，按 runbook 验证导航、三类 Agent、资料选择预览、代表写作/PPT/学术/社媒链、备份恢复和状态恢复；未打开时不循环启动/操作 GUI，记录 `not-run` 与真实复测步骤，继续完成其余检查。

- [ ] **Step 4: 完成真实效果和最终差距复核**

使用事先固定的合成样本和同一模型能力比较代表任务；保存模型/Host 版本、请求快照、结果、评分理由和用户反馈状态。缺真实模型、GUI 或用户反馈时保留 `not-run`，不得以模型自评补全。最终逐项复查设计稿 4、5、5.1、5.2、7.1–7.4、8、9、10 节及每行入口映射。

最终追踪逐项核验：跨领域记忆的跨项目冲突/人工优先/撤销/删除来源；公开提示词、公开资料、手动搜索、研究样本入口；每一规划文体的支持状态；四项资料选择/筛选字段及旧版缺字段默认；完整 ZIP、无附件 JSON、资料库 JSON；插件偏好、插件服务配置、DSH Host 设置和凭证边界；四个活动社媒平台与两个历史只读平台。每项分别记录自动化、DSH 实测、真实外部能力和迁移支持；不适用须说明理由，未运行不得标为通过。

## 全计划完成门槛

- 八个阶段的产物、测试和依赖关系全部有收据；既有实现只在当前源码与当前包上重新验证后复用。
- 入口追踪表每行有明确插件模块、数据/迁移映射、自动化用例、真实宿主状态和证据路径。
- 原应用代码和运行数据未被插件访问或写入；所有插件存储、附件、索引、设置和备份自成边界。
- 同内容去重建立 source ID 到已有插件 ID 的映射；歧义 ID、未选择依赖、附件失败和组提交失败都不产生悬空引用或孤儿文件。
- 四项资料选择/筛选字段、旧版缺字段默认、JSON/ZIP/资料库 JSON 区分、敏感字段过滤、限额和日志删除均测试通过。
- 四个活动社媒平台分别有授权后真实能力证据；Reddit/YouTube 仅历史查看/迁移；未知能力明确不可用。
- 不可信导入文本不会执行脚本/命令或覆盖当前指令；内容只有被任务显式选择并经外发预览才进入模型上下文。
- 插件构建、安装和隔离 profile 验收通过；完整报告不以自动化绿色替代 DSH UI、真实能力和用户反馈。
- 所有未通过/未运行项目都有责任任务、原因、复测条件和操作入口；报告状态如实保持 `incomplete`。

## 自审

- [x] 设计稿 5/5.1/5.2 的入口、动作、资料引用和平台状态均映射到阶段 2–7 及最终验收。
- [x] 设计稿 5 节长期记忆/画像与 5.1 外部参考入口有独立任务、路径、用例和阶段门；写作记忆未与跨领域记忆混同。
- [x] 设计稿 7.1–7.4 的独立存储、完整数据矩阵（含 `writingPackSettings`、`writingWorkspaces` 与四项资料选择状态）、限额、白名单、冲突、依赖组、幂等、收据/日志限额及删除均映射到阶段 1/8。
- [x] 设计稿 8 的八阶段顺序在本计划中保持一致；未将后续阶段提前成为并行依赖。
- [x] 显式选择备份文件导入与禁止扫描原应用运行目录的边界一致；插件独立存储不变。
- [x] 全功能验收状态机独立于既有基础验收脚本，基础 REQUIRED_GROUPS 和报告语义未被覆盖或删减。
- [x] 设计稿 9/10 的恢复、失败保留、真实证据等级和最终验收状态映射到 Task 8.2，并将宿主未打开时的 `not-run` 与 GUI 不循环规则写入 Host/交付任务。
- [x] 对照当前实际源码修正候选路径；新增文件均标明 Create，条件创建仅用于测试证明有独立职责的模块；未将旧计划里的 API 当成既成接口。学术计划使用四个实际存在的独立文件，领域扩展计划更正为 2026-10-22。
- [x] 以独立扫描核对无未解决占位：跳过本自审清单中的扫描说明行后，`TODO`、`TBD`、`implement later`、`add appropriate`、`similar to Task` 均无匹配。
- [x] Markdown 阶段/任务顺序、checkbox 格式、具体测试文件和工作目录已核验；新增测试明确作为 Create，命令从 `.dsh-workspace` 根目录执行。本轮仅修改本计划文件。

## 执行交接

用户已确认继续实施；2026-11-07 自动化复测收据：`docs/acceptance/forward-step-dsh/automation-rerun-2026-11-07.md`。社媒手工来源、明确附件上传/归档、报告提示词版本持久化已有自动化证据；新增待平台准备队列暂停/恢复、取消及失败平台跳过 Host RPC，并修正结果选择跨任务串用。2026-11-08 又接入运行中暂停：中止同任务当前请求、等待其检查点收尾后持久化暂停，恢复仍不自动重启。失败平台真实重试仍需已核验适配器，Task 7.1 Step 2 仍未完成；附件写入与状态事务间仍需真实附件服务恢复验收。隔离 profile 安装尝试因 DSH pnpm 忽略 `tesseract.js` 构建脚本而失败；同次配置回退哈希已验证，但回退报告 `installedClient:false`，故 Task 8.2 Step 2 继续未勾选。真实 DSH GUI、真实模型/外部能力与用户反馈未运行的步骤保持未勾选。最新复测：插件联测 410/410、工作区全测 1520 通过/0 失败/1 跳过、`pnpm check`、Host/Client build、包边界 3/3 通过；总验收仍 `incomplete: 0/14`。

2026-11-07 本轮继续接入 PPT 网页来源：Host 使用可选 `ctx.get('web')`，新增 `searchPptSources`/`fetchPptSource`；Client 增加逐次确认、按 taskId 隔离候选、取消、来源摘录预览和明确材料选择/保存。URL 凭证参数与锚点被清理，HTML script/style 等区域剔除，抓取摘要默认 `selected:false`，仅经勾选并保存进入任务。Host/Client/Typert 自动化与构建通过；`host-interface.json` 将 `web-search`、`web-fetch` 标为静态支持、`runtimeProbed:false`。真实 DSH provider/网络认证/结果、桌面 GUI 与渲染仍未运行，因此 Task 1.4 Step 2、Task 5.1 Step 2 不勾选；PPT 成品渲染仍未接入。


本计划是八阶段总控计划；各领域阶段先按现有专项计划核对并复用已验证部分，再在同一阶段内按“失败测试 → 确认失败 → 最小实现 → 定向回归 → 阶段门收据”推进。每次只提交本任务范围内文件，计划本身不授权修改原应用，也不授权覆盖现有用户改动。阶段实现开始前须先取得设计稿审阅确认。

2026-11-07 续接：PPTX 导出已加入结构化 `chart: { title, categories, values }` 到可编辑柱形/标签形状的重建路径，并在场景规范化中保留与校验图表数据。该项覆盖明确结构化数据输入，不代表任意 HTML/CSS 或图片自动识别；HTML/CSS 转换及真实 DSH GUI 视觉验收仍未完成，本 Step 保持未完成。

2026-11-07 续接增强：结构化图表导出支持最多 4 个命名数据系列与 8 个类别，输出为可编辑图形、数值/类别标签及图例；旧单系列结构兼容。该功能通过插件 PPT/包边界测试和构建，但不等同任意图形自动识别；HTML/CSS 转换及真实 DSH GUI 验收保持未完成。

2026-11-07 续接：PPT 逐页规划预览现展示结构化多系列图表，并与 PPTX 导出共享场景数据；此预览仍是本地规划草稿，不替代 Office 成品或真实 DSH GUI 视觉验收。

2026-11-07 续接：`getHostCapabilities` 已由 Host RPC 提供并接入侧栏能力列表，状态根据真实注入对象逐项计算，报告不触发模型、网络或存储调用；重新生成 Typert 契约并更新测试到 114 个 RPC。目录授权仍为 unavailable；GUI panel/unload、真实 Web provider 和桌面状态未验，Task 1.4 Step 2 继续保持未完成。

2026-11-07 续接：写作材料现在可从当前 DSH Session 的用户指定相对目录导入，只读生成未选草稿，稳定路径 ID 支持刷新去重，用户核验并保存后才进入任务；缺失 workspaceFiles 时保留本地文件入口并显示不可用。目录读取真实 Desktop Session 权限/取消及 GUI 尚未验收。

2026-11-07 续接：PPTX 图表已经从可编辑形状组合升级为 Office 原生图表部件，包含内嵌类别/系列/数值缓存、原生图表关系与多系列样式。LibreOffice headless 导出 PDF 并检查渲染图通过；不能替代真机 DSH GUI 的页面交互验收。

2026-11-07 续接：离线 HTML 成品导出已支持已选 PNG/JPEG 和结构化单/多系列柱形图，不止文字；其输入仍是插件已保存的结构化逐页规划，不代表任意 HTML/CSS 自动转换。真实 GUI/浏览器视觉验收仍留待代码实现阶段完成后执行。

2026-11-07 续接增强：离线 HTML 图表同时包含视觉 SVG 与屏幕阅读器可读的数据表，便于键盘/辅助技术用户核对结构化数据；不改变任意 HTML/CSS 转换缺口状态。

2026-11-07 续接：静态 HTML 演示导入新增通用 `.slide`/多层 `.slides`、纯色背景继承、副标题/引用/列表提取；PPT 逐页反馈新增可鼠标/键盘定位的归一化点位并进入下一轮提示词，临时点位按 taskId 隔离。PPT 定向 35/35、社媒+PPT 联测 51/51、Host/Client build 通过。独立插件 lockfile 已重生成覆盖 package.json 运行/构建依赖。复杂 CSS、PPTX 直接渲染、真实服务及 GUI 未验证，Task 5.1 Step 2 不勾选；四平台真实采集未验，Task 7.1 Step 2 不勾选。全插件/包最终复验继续进行。
2026-11-07 续接：修复社媒公开搜索重试预算错误：每平台上限按不同查询计算，失败查询可在任务总公开搜索请求预算内重试；客户端显示已用请求数并以总预算禁用超额搜索。新增重试后预算回归，社媒核心与 Host/Client 定向测试 30/30 通过，插件 Host/Client 构建通过。真实平台采集适配器仍未核验，Task 7.1 Step 2 继续未完成。
## 2026-11-07 继续接入：社媒公开来源深读与预算重试

- `core/social-research.js`：公开搜索按每平台“不同查询”计数；失败查询可重试，所有尝试仍受总请求预算约束。新增候选深读校验，只接受当前已确认任务中的候选及对应平台域名。
- `src/host-service.ts`：新增可取消的 `fetchSocialPublicSource` Host RPC，接入可选 DSH `web.fetch`；只返回经来源域名复核、去除脚本/样式/模板后的不可信摘录，不持久化。
- `src/client/domain-workbenches-panel.ts`：每次读取前显示确认，呈现摘录预览，用户可确认保存或丢弃；展示不同查询和总请求额度并允许预算内重试。
- `tests/dsh-plugin/domain-workbenches.test.mjs`、`social-research.test.mjs`、`typert.test.mjs`：覆盖平台域名、确认门、脚本剔除、不自动落盘、预算重试和新 RPC 取消契约。
- 验证：社媒/工作台/Typert 定向测试 46/46；Host/Client 构建、包边界测试 3/3、`pnpm check` 通过；工作区全测最终复跑 1581 通过、0 失败、1 跳过（在此轮来源深读接入前执行，新增逻辑另经定向验证）。真实 DSH Web provider/GUI 尚未运行；四平台授权采集适配器仍未核验，Task 7.1 Step 2 保持未完成。
2026-11-07 续接：社媒任务取消现在可中止该任务正在运行的公开搜索/来源深读，且清除未保存的来源预览；来源读取期间“取消计划/任务”按钮保持可用。工作台、社媒核心及 Host 契约定向测试 46/46 通过，插件 Host/Client build 通过。
2026-11-07 续接：社媒研究计划表单新增可配置预算（平台数、每平台不同查询数、公开搜索总请求数），预算传入创建 RPC 并随任务保存；输入值限制在插件支持上限，超出平台/查询预算时禁止创建计划。工作台定向测试增补预算展示/传参/拒绝超额契约，Host 测试覆盖预算持久化。
2026-11-07 续接：社媒公开搜索确认弹窗现逐项显示平台、查询、每平台不同查询用量、最大结果数、任务总请求用量/剩余请求数，并明确本次只发送查询、不发送任务内已保存结果或附件；新增静态契约断言。社媒/工作台定向测试 31/31 通过，插件 Host/Client 构建通过。
2026-11-07 续接：待恢复社媒附件卡片新增“立即重试附件恢复”入口；点击后调用 Host 已有任务读取/存储读回校验流程，刷新该任务最新附件状态，成功时解除待恢复状态，持续失败时保留结果与可见记录。社媒/工作台及附件 Host 恢复定向测试 31/31 通过，插件 Host/Client 构建通过。
2026-11-07 续接：接入 PPTX 安全导入，转换页面顺序、标题/正文和引用的 PNG/JPEG 为可编辑草稿；ZIP 解压、页数、文件大小、图片签名和文本均有上限，不读外部关系、不执行包内内容。PPT 定向测试 39/39、Host/Client 构建通过。图表数据、动画、主题、复杂版式及真实 DSH 视觉验收仍未完成，Step 2 不勾选。
2026-11-08 续接：PPTX 导入入口接入现有工作台，安全解析按演示顺序排列的标题/正文及 PPT 内部 PNG/JPEG 引用，导入后进入待复核的可编辑草稿；外部关系不读取，宏包、加密包、重复/越界路径和超限输入拒绝。PPT 定向测试 40/40、包边界测试 3/3、插件 Host/Client 构建通过。图表/复杂布局转换、真实 DSH 渲染及 GUI 验收仍未完成，Step 2 不勾选。

2026-11-08 续接：PPTX 导入现解析插件导出的原生 clustered column 图表，恢复标题、类别及 1–4 个系列数值为可编辑图表；保留页面标题/正文，并将不支持图表类型标记到 limitations。往返测试及 PPT 定向测试、Host/Client 构建、包边界测试验证中。主题/动画/复杂版式及真实 DSH GUI 验收仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 续接：PPTX 原生图表导入约束现与导出端一致（类别/系列名长度、系列名唯一性、数值上限），图表字段纳入 200,000 字符总预算。PPT 定向测试 41/41、Host/Client 构建通过、包边界测试 3/3 通过。复杂版式/非柱形图保真与真实 DSH GUI 仍待验，Task 5.1 Step 2 不勾选。

2026-11-08 续接：社媒历史报告版本新增“按此版本的来源重新生成提示词”入口，使用该版本固定的 resultIds 再建新提示词版本，避免用户改选来源而误覆盖历史语义。工作台与学术/社媒 Host 定向测试 17/17、Host/Client 构建通过。该能力仍为可审阅提示词，不自动调用模型；真实平台采集/GUI 尚未验收。

2026-11-08 续接：社媒报告生成新增前端 AbortController、可见取消入口和卸载中止；Host 在模型返回后、写入新报告版本前再次检查中止信号，避免宿主忽略取消或响应竞态时产生落盘。新增 Host 竞态回归测试并补充 Client RPC signal/取消入口契约；社媒工作台定向测试 19/19、Host/Client build 成功。该改动不代表四平台授权采集适配器已验收，Task 7.1 Step 2 继续未完成。
2026-11-08 补充：社媒任务级取消现在也会中止该任务当前报告生成，取消按钮仅在对应任务执行报告时显示；定向测试增加 taskId 隔离契约。

2026-11-08 续接：新增 `getPluginPreferences`/`savePluginPreferences` Host RPC 与工作区设置面板，允许用户保存插件内默认任务入口/领域；读取后同步到新建任务控件。Host 只接受白名单值并沿用插件 Storage Domain 事务；模型、搜索服务与凭证仍明确由 DSH 宿主管理。新增设置持久化/非法输入/面板接线测试 2 项，Typert Host/Client 契约测试与构建通过。此项补齐 FF-010/FF-013 的插件偏好 UI 部分，真实 DSH 设置恢复与隔离安装仍待验。
2026-11-08 续接：扩展插件设置：可将当前 DSH 的模型提供方/模型 ID 作为偏好保存并在面板重载时恢复；Host 保存时重新向已注入的 LLM 列表核验，拒绝不存在的提供方/模型，未选默认模型时保留主工作台即时选择。未保存 API Key、搜索凭证或登录态。
2026-11-08 续接补充：恢复默认模型时同时将已核验的提供方/模型选项同步回主工作台下拉框；若历史备份中的模型 ID 已失效，设置面板保留其他偏好并提示重新选择，不把失效模型设为当前默认。Host/Client build 与设置/Host 契约测试通过。
2026-11-08 续接：`listMethodCards` Host RPC 从插件内置方法卡目录读取受控字段，资产面板可浏览阶段/说明，并可将“通用计划/写作/PPT”设为新任务领域；未接入执行流程的其余卡标注只读，不伪称可用。Host/Client 构建、方法卡 Host 直调及 Typert 契约测试通过。方法卡自定义维护仍待实现。
2026-11-08 续接补充：完成自建方法卡 CRUD：标题、说明、适用领域和步骤写入插件 knowledgeEntries；编辑保留最多 20 个版本快照，内置卡不能修改/删除，自建卡跨 Host 重开可恢复。资产面板支持编辑、历史浏览、删除。

2026-11-08 续接：社媒公开搜索和 PPT 网页搜索/读取均新增可取消等待；Web provider 若忽略 AbortSignal，插件仍及时返回取消，社媒不记失败且不扣预算。PPT/社媒定向联合测试 56/56、Host/Client build 通过。此项仅补足取消闭环，不代表真实 DSH Web provider 已验证；Task 5.1 Step 2、Task 7.1 Step 2 及 GUI/平台能力验收保持未完成。

2026-11-08 续接：Task 8.2 隔离包安装修复并通过。`scripts/dsh-test-profile.ps1` 对 DSH CLI add 明确传递 `--allow-build=tesseract.js`，只允许其捐赠提示 postinstall；候选 tarball 在 `forward-step-test` 安装后版本/Client/lockfile/schema 检查成功，Restore 后配置哈希一致且源码依赖恢复。详见 `docs/acceptance/forward-step-dsh/package-install.json.latestAttempt`。插件全测 479/479、工作区 `pnpm test` 1593 通过/0 失败/1 跳过、`pnpm check`、Host/Client build、包边界 3/3 通过。Task 8.2 Step 2 仍待合成业务数据卸载/重装读回；GUI 与真实平台能力未运行。

2026-11-08 继续接入：社媒任务现在逐平台持久化适配器能力状态，并在详情中显示“未核验/已核验”和授权边界；新建计划默认为未核验，未核验适配器即使收到 ready 连接字段也不能进入采集。定向社媒/工作台测试 35/35、Host/Client build 通过。该状态改进不替代四平台真实 adapter 与重新授权运行证据，Task 7.1 Step 2 保持未完成。
2026-11-08 继续接入：HTML 与 PPTX 导入统一进入任务级待确认草稿；用户可逐页预览标题、正文、原生图表和 PNG/JPEG 配图，确认前不覆盖当前大纲，丢弃明确保留原内容。客户端回归同时验证 HTML 丢弃和 PPTX 确认替换；`node --test tests/dsh-plugin/client.test.mjs tests/dsh-plugin/ppt.test.mjs` 70/70 通过。Task 5.1 Step 2 仍因真实 DSH 搜索/解析/渲染能力及 GUI 验收未完成而保持未勾选。
2026-11-08 继续接入：社媒核心 `runSocialResearchTask` 增加 AbortSignal 输入，运行前拒绝已取消任务，并将信号透传到每个平台适配器；即使适配器忽略中止，调用方也会及时收到 `cancelled`，取消不会返回部分任务结果。新增社媒核心回归；社媒/工作台定向测试 36/36、Host/Client build、包边界测试 3/3 通过。当前 Host 尚无可核验的平台采集适配器，故此改动完善未来已授权执行契约，不代表四平台采集可用；Task 7.1 Step 2 仍未完成。
2026-11-08 继续接入：为社媒已归档附件增加 Host 校验下载闭环。Host 仅允许读取当前任务中状态为 verified、且仍关联有效结果的附件；开始下载时将 Host 附件流写入私有临时目录并再次校验 SHA-256/字节数，随后以 48 KiB 严格顺序分块传给 Client。下载会话限制并发数、五分钟过期、支持显式结束和 Host dispose 清理；客户端校验偏移/长度后生成浏览器下载。Host 集成测试使用大于 48 KiB 合成附件验证多块读回、错误偏移/跨任务拒绝和会话结束。`node --test tests/dsh-plugin/domain-workbenches.test.mjs` 19/19 通过，Host/Client 构建通过。真实 DSH GUI 下载体验尚未运行，不影响 Host 契约自动化；Task 7.1 的真实平台适配器仍未完成。
2026-11-08 继续接入补充：正式 Typert 生成链此前未包含源码新建的下载 RPC；已运行 `node dsh-plugin/forward-step-dsh/scripts/generate-typert.mjs` 重生成 Host/Remote（125 invocations/descriptors），并更新契约测试检查三个下载 RPC 确实存在。分块读取改为每块 48 KiB，Host 并发预留槽阻止创建阶段竞态；读取完成后复核 Host 未卸载，分块偏移拒绝 EOF 及越界，客户端校验附件/分块上限。`typert/domain-workbenches/social-research/package` 联合测试 54/54 通过，Host/Client build、包边界 3/3、`pnpm check` 通过。
2026-11-08 继续接入：社媒归档附件下载增加主动取消。Client 现在把 AbortSignal 传入分块 Remote、提供“取消附件下载”按钮并在组件卸载时中止；Host 分块读取使用 awaitAbortable，取消/卸载时不推进偏移，Client finally 结束下载会话并清理临时文件。正式 Typert 取消元数据通过生成脚本更新，契约测试要求 signal cancellation 描述符。工作台、Typert、包边界联合测试 37/37 通过；Host/Client build 成功。GUI 体验待最后真实 DSH 验收。
2026-11-08 继续接入：社媒附件新增从插件任务移除的完整操作。Host 校验任务、结果和附件记录关系后，在单个 storage transaction 中移除附件元数据及结果引用，使后续报告提示词和插件备份不再包含该附件；不调用不存在的 Host blob 删除 API，并明确告知 DSH 内容寻址对象仍保留。Client 增加带说明的确认步骤。生成 Typert Host/Remote 合约增至 126 项。工作台/Host 集成、Typert、包边界联合测试 37/37 通过，Host/Client build 通过。
2026-11-08 继续接入：待恢复的社媒附件记录现在也可从恢复列表直接移除。UI 复用 Host 原子解除关联操作，明确说明 DSH 内容对象仍保留，避免读回失败的附件永久挂在任务与插件备份中；保留“立即重试附件恢复”入口。工作台源码回归 19/19、Host/Client build 通过。真实 GUI 和 DSH 附件存储中的底层对象回收仍未验收。

2026-11-08 继续接入：社媒来源结果移除回归已覆盖“来源仍关联已验证附件”的事务路径。移除后任务结果、附件索引和下载授权同步消失，历史报告快照计数不变，并明确保留 Host 内容对象。工作台/Host 集成、Typert、包边界测试 37/37 通过，Host/Client build 通过；本项仅有自动化与构建证据。Task 7.1 Step 2 仍未完成：四个平台真实授权采集适配器与恢复闭环的真实 Host 证据不足。

2026-11-08 继续接入：PPT HTML 导入的安全 CSS 颜色映射支持百分比 RGB 通道，并以红色/灰色百分比用例验证；PPT 定向测试 42/42、Host/Client build 通过。复杂 CSS 布局及真实 DSH 渲染验收仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 继续接入：PPT HTML 导入现在将 `<br>` 映射为正文显式换行，覆盖段落与列表项；PPT 定向测试 43/43、Host/Client build 通过。复杂 CSS 布局及真实 DSH 渲染验收仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 继续接入：PPT HTML 导入将 `<br>` 转换为正文显式换行并覆盖段落、列表项；定向测试 43/43 和 Host/Client 构建通过。复杂 CSS 版式、真实 DSH 渲染仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 继续接入：PPT HTML 导入新增 px/pt/em/rem/% 字号解析与祖先继承换算，仅写入显式可解析字号；未声明字号保留主题默认。PPT 测试 44/44、Host/Client 构建通过；复杂 CSS 版式与真实 DSH 渲染仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 继续接入：PPT HTML CSS 颜色导入增加不透明逗号语法 HSL/HSLA 转换，并忽略透明 HSLA；定向测试 45/45、Host/Client build 通过。CSS 任意布局和真实 DSH 渲染仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 继续接入：PPT HTML 导入保留内联 b/strong、i/em 的段落级强调，并以显式 CSS 样式覆盖；PPT 定向测试 46/46、Host/Client build 通过。单段局部富文本、复杂 CSS 和真实 DSH 渲染仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 继续接入：PPT HTML 导入的 HSL/HSLA 颜色解析新增 CSS Color 4 空格分隔及斜杠 alpha 写法；只映射完全不透明颜色。定向测试 46/46、Host/Client build 通过，真实 DSH 渲染仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 继续接入：PPT HTML 导入的 RGB/RGBA 颜色支持整数/百分比通道、CSS Color 4 空格分隔和斜杠 alpha；只映射不透明颜色。PPT 定向测试 47/47、Host/Client build 通过。布局与真实 DSH 渲染仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 继续接入：PPT HTML 导入→场景规范化→PPTX 导出链现保留不同正文段落各自的白名单样式，OOXML 按段写入字号、颜色、对齐、粗体和斜体；未声明值不继承其它段落的粗体/斜体。集成回归及 PPT 定向测试 48/48、Host/Client build 通过。段内局部富文本、任意 CSS 布局和真实 DSH 渲染仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 继续接入：PPT HTML 正文段现保留段内语义/白名单 CSS 文本片段；Scene schema 校验并持久化片段，PPTX OOXML 写入独立可编辑 runs，strong/em 只作用于对应文本并保留片段空格。集成测试覆盖 HTML→Scene→PPTX，PPT 定向测试 49/49、Host/Client build 通过。更广泛 CSS 装饰和真实 DSH 渲染仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 继续接入：PPT HTML 导入将 `<u>/<ins>` 与 CSS underline 转换为段内可编辑 run 属性，`text-decoration:none` 可取消语义下划线；Scene schema 和 PPTX DrawingML 已贯通，49/49 定向测试及 Host/Client build 通过。删除线、链接和真实 DSH 渲染仍未完成，Task 5.1 Step 2 不勾选。

2026-11-08 续接记录：PPT HTML 删除线样式已贯通 HTML → scene → 可编辑 PPTX，支持 `<s>/<del>/<strike>`、CSS `text-decoration: line-through` 与 CSS `none` 覆盖；定向测试 49/49、Host/Client 构建通过。超链接、任意 CSS 布局和真实 DSH GUI 尚未验收；Task 5.1 Step 2 仍因 Host 搜索/解析/渲染能力缺少完成的真实能力收据而未关闭。

2026-11-08 续接：PPT HTML 导入现接受 CSS `text-decoration: underline line-through` 组合样式，并保留两个独立可编辑 run 格式；CSS `none` 取消语义装饰、无效值忽略。PPT 定向测试 49/49，插件 Host/Client 构建通过。

2026-11-08 续接：社媒附件上传新增 Host 分块预算校验（1 至 48 KiB），防止错误分块值导致上传循环无法前进；编码改为 32 KiB 有界批次处理。社媒面板/领域测试 36/36，Host/Client 构建通过。平台授权采集的真实宿主能力收据及 GUI 验收未完成，Task 7.1 Step 2 继续未关闭。

2026-11-08 续接：设置面板显示并可刷新 Host 能力注入状态，标注其不等于真实请求成功；辅助写作服务明确显示未接入独立适配。设置/Host 测试 16/16、Host/Client 构建通过。非敏感插件自有服务端点配置、搜索实测和真实 DSH GUI 未完成，FF-010 不关闭。

2026-11-08 续接：新增非敏感插件服务设置 RPC/UI，保存搜索端点、辅助写作端点与模型标识；Host 拒绝凭证字段及带认证信息/查询/片段的 URL，并要求辅助端点/模型成对。更新 vendor overlay manifest 修正 package 测试证实的 PPT scene schema v2 哈希。定向设置/备份/RPC/包测试 30/30，Host/Client build 与工作区 `pnpm check` 通过。端点仍未接入请求调用、无真实连通性证据，辅助写作无独立适配；FF-010 继续未关闭。

2026-11-08 续接：设置页新增搜索/辅助写作端点的明确确认式只读 GET 探测，通过 DSH WebRuntime 返回 HTTP 状态，不发送查询、提示词或凭证；Host 支持取消。相关 Host、设置、Typert、备份与 tarball 包验收 45/45，插件构建和 `pnpm check` 通过。该探测仅证明端点可通过 WebRuntime 读取，不是搜索 API 协议或辅助模型调用验收；未配置真实端点、未运行 GUI，FF-010 不关闭。

2026-11-08 继续接入：PPT HTML 超链接已从安全 HTTP(S) href 经场景 schema 写入可编辑 PPTX DrawingML 超链接及外部关系；拒绝非 HTTP(S)/凭证链接并清理敏感查询参数和片段。同步 vendor manifest schema SHA-256 与 overlay v3 及 package test 期望。包与 PPT 定向测试 53/53、Host/Client build 通过。任意 CSS 布局和真实 DSH GUI/Host 能力凭据未验收，Task 5.1 Step 2 不勾选；搜索 API 调用及辅助写作独立适配仍未接入，FF-010 不关闭。

2026-11-08 继续接入：PPT 来源搜索现优先调用配置的搜索端点，按 SearXNG GET JSON 协议附加 q/format=json 并解析 results，最多保留 8 条；未配置时回退 DSH WebRuntime.search，保持既有确认与取消路径。设置 UI 标明端点用途与协议。新增端到端 Host 用例；Host/Client build 及 PPT/设置/包测试 58/58 通过。未配置真实端点，外部服务兼容和连通性、GUI 尚未验收；辅助写作适配仍未接入，FF-010 不关闭。

2026-11-08 继续接入：新增辅助写作独立调用闭环。设置页录入文字并在发送前明确确认目标端点，Host 按已保存模型使用 OpenAI Chat Completions POST，支持取消/30 秒超时，拒绝重定向、禁用凭证携带并限制输入/输出，不持久化请求及结果；用户可取消，结果仅显示于设置面板。Host/Client build 成功，PPT/设置/Typert/包验收 74/74 通过。真实服务兼容与连通、GUI 尚未验收，结果未自动回写工作任务。

2026-11-08 续接：已使用正式 Typert 生成器把 `runAuxiliaryWriting` 纳入 Host/Client 远程契约与取消元数据，生成的 descriptor 总数为 131；同步 Client Remote 类型和契约测试后，Host/Client build 与 PPT/设置/Typert/包验收 74/74 通过。真实服务兼容、网络连通、GUI 验收仍未完成。

2026-11-08 继续接入：将配置的 SearXNG 兼容搜索端点接入社媒公开网页搜索，与此前 PPT 来源搜索共用；沿用社媒平台限定查询、预算、显式确认、取消及不可信候选标记，配置端点故障不会静默切回 DSH 搜索。设置文案同步注明覆盖 PPT/社媒公开搜索。Host/Client build 与社媒领域/PPT/设置/包测试 79/79 通过。真实搜索服务与网络连通及 GUI 尚未验收。

2026-11-08 继续接入：写作轮次工作区现可调用已配置辅助写作服务，发送文章标题/目标、文体、任务类型、提示词、稿件与反馈前显示真实端点并明确确认；结果先独立预览，用户点击后才填入本轮草稿，保存依旧新增轮次不覆盖历史。提供取消，输入维持 30000 字符限额。插件 Host/Client build 通过，Client UI 测试 30/30 通过。真实模型质量、服务连通及 GUI 尚待验证。

2026-11-08 继续接入：辅助写作在当前编辑框为空时复用工作区最近保存轮次的任务类型、提示词、稿件及反馈作为新请求输入；当前编辑内容优先。仍需显式确认，输出仍由用户手动采纳。Host/Client build 与 Client/写作工作区测试 34/34 通过；真实服务与 GUI 未验收。

2026-11-08 继续接入：PPT HTML 导入新增 CSS `font-family` 首选字体提取及继承，样式进入场景白名单，PPTX 将字体写入可编辑文本的 DrawingML Latin 字体声明并安全转义；东亚字体保留 Microsoft YaHei fallback。vendor scene schema overlay 升至 v4 并校准 hash。Host/Client build 与 PPT/包验收 56/56 通过。字体嵌入、目标机可用性、复杂布局及 GUI 渲染尚未验收，Task 5.1 Step 2 继续未关闭。

2026-11-08 继续接入：PPT HTML CSS 首行缩进新增白名单映射：绝对 px/pt 转 EMU，限幅 ±144pt；scene schema 与 PPTX DrawingML 段落缩进贯通，相对单位/越界拒绝。新增 HTML→scene→PPTX 测试及边界断言，vendor manifest 升至 `ppt-html-style-import-v6` 并同步 SHA-256。PPT/包定向测试 58/58、Host/Client build 通过。复杂 CSS 布局、真实 DSH GUI 与 Host 运行态仍未验收，Task 5.1 Step 2 不勾选。


2026-11-08 继续接入：社媒公开搜索对重复执行的失败查询新增 `retryOf` 关联，指向同平台同查询最近失败尝试；新查询和成功重复不误标，预算计数与取消语义保持不变。社媒专项、Host 领域工作台和包测试 41/41，Host/Client build 通过。真实平台授权采集与 GUI 仍未验收，Task 7.1 Step 2 不勾选。


2026-11-08 继续接入：社媒报告生成现在校验所选结果的每个附件引用；缺失引用以 `missing_attachment_reference` 显式失败，不再由列表过滤静默丢弃。新增缺失引用回归测试；社媒领域/Host 工作台测试 39/39、包测试 3/3，Host/Client build 通过。真实平台授权采集与 GUI 尚未验收，Task 7.1 Step 2 继续未关闭。

2026-11-08 继续接入：社媒 `runSocialResearchTask` 现在支持 `partial-failure`/`failed` 任务重试，可限定失败平台，不重复采集已成功平台；合并重试结果并保留原成功数据，查询/请求预算累计，失败项授权和能力仍逐次校验。新增部分失败恢复与拒绝重跑成功平台用例。社媒/Host 工作台/包测试 43/43，Host/Client build 通过。DSH 真实平台采集适配器和 GUI 尚未验收，Task 7.1 Step 2 不关闭。

2026-11-08 继续接入：PPT HTML 导入支持段前/段后 CSS `margin-top`/`margin-bottom` 的 px/pt 值，限制 0–144pt 并分别映射为 DrawingML `spcBef`/`spcAft`；场景 schema 校验边界。修复段落样式压缩条件，保留与正文默认样式不同的空覆盖，避免间距串用。同步用户可见转换限制、vendor overlay v7/hash。PPT/包定向测试 59/59、Host/Client build 通过。复杂 CSS/GUI 仍未验收，Task 5.1 Step 2 不关闭。

2026-11-08 继续接入：PPT HTML `margin-left`/`margin-right` px/pt 转为 DrawingML 段落左右边距，限幅 0–144pt，场景 schema 同步校验；PPTX 导出器将正文默认段落样式应用至各段并允许逐段覆盖，避免单段/同样式段间距被省略。转换限制说明、vendor overlay v8 与 schema SHA-256 已更新。PPT/包定向测试 60/60、Host/Client build 通过。复杂 CSS 与真实 GUI/宿主渲染仍未验收，Task 5.1 Step 2 不关闭。

2026-11-08 继续接入：专业包设置 schema 现拒绝非布尔 `enabled` 与非正安全整数 `acceptedVersion`，迁移预览/提交将无效设置显式计入无效项，不再静默丢字段后导入。新增来源设置迁移回归用例；迁移预览/提交/写作包/包边界测试 42/42、Host/Client build 通过，vendor overlay v2 SHA-256 匹配。真实来源备份样本和 GUI 尚待验收。

2026-11-08 继续接入：专业包设置历史版本超过 50 条时，插件 schema 与来源迁移均显式拒绝，不再由设置正常化静默截断；预览/提交报告无效设置，插件自身历史保留现有 50 条业务上限。新增 51 条历史迁移用例；迁移/写作包/包边界测试 43/43、Host/Client build 通过，vendor overlay v3 与 SHA-256 匹配。


### 2026-11-08 PPT HTML 导入边距简写

- HTML→PPT 导入现在解析 `margin` 的 1–4 项 px/pt 简写并映射到段前/段后与左右段落边距；超出支持单位、负值及非法值仍按白名单忽略，不扩大为通用 CSS 布局引擎。
- 新增 `tests/dsh-plugin/ppt.test.mjs` 回归，确认 `margin:8px 12pt` 映射上下各 6pt、左右各 12pt。命令 `pnpm exec node --test tests/dsh-plugin/ppt.test.mjs`：58/58 通过。
- 命令 `pnpm --dir dsh-plugin/forward-step-dsh run build`：Host TypeScript 与 Client bundle 构建通过。复杂 CSS/任意布局、PPTX 输入直接渲染及真实 DSH GUI 仍未验收；Task 5.1 Step 2 保持未完成。


### 2026-11-08 PPTX 原生表格导入

- `core/pptx-import.js` 现在提取 `<p:graphicFrame>` 中的原生表格，按单元格列顺序转换成可编辑草稿文本（单元格用 ` | ` 分隔、行用换行分隔），不再把表格内容静默丢弃；不执行或读取表格外部关系。
- `tests/dsh-plugin/ppt.test.mjs` 增加真实 ZIP/OOXML 表格 fixture，验证标题、原正文与表格行列文本一起读回。命令 `pnpm exec node --test tests/dsh-plugin/ppt.test.mjs`：59/59 通过。
- 命令 `pnpm --dir dsh-plugin/forward-step-dsh run build`：Host TypeScript 与 Client bundle 构建通过。表格目前转为行列文本而非可编辑 PowerPoint 表格对象；真实 DSH GUI、复杂版式及真实网页服务仍未验收，Task 5.1 Step 2 保持未完成。


### 2026-11-08 PPTX 表格转换状态提示

- `core/pptx-import.js` 在转换含原生表格的页面时，现把“表格转为行列文本、不能继续作为表格对象编辑”的限制加入导入报告；避免用户把文本化误认为保留了表格结构。
- `tests/dsh-plugin/ppt.test.mjs` 验证表格行列文字读回及限制说明同时出现。命令 `pnpm exec node --test tests/dsh-plugin/ppt.test.mjs`：59/59 通过；`pnpm --dir dsh-plugin/forward-step-dsh run build`：Host/Client 构建通过。
- 表格仍非原生可编辑对象，PPTX 布局与真实 DSH 宿主/GUI 未验收，Task 5.1 Step 2 继续未完成。


### 2026-11-08 PPTX 表格导入报告补齐

- `core/pptx-import.js` 现在在含原生表格的页面导入结果中明确加入结构转换限制，提示导入后的行列文本不再是可编辑表格对象；调用方可在导入报告中展示这一结果。
- `tests/dsh-plugin/ppt.test.mjs` 的 OOXML 表格样本验证内容与限制信息一起读回。命令 `pnpm exec node --test tests/dsh-plugin/ppt.test.mjs`：59/59 通过；命令 `pnpm --dir dsh-plugin/forward-step-dsh run build`：Host/Client 构建通过。
- 当前实现尚未保留表格对象/样式和真实页面布局；真实 DSH Host 与 GUI 仍待验收。


### 2026-11-08 PPTX 原生表格对象往返接入（更新此前文本化限制）

- 将原生表格从纯文本转换升级为端到端对象：`vendor/core/ppt-scene-schema.js` 校验 1–20 行、每行 1–8 列、列数一致及单元格长度；`core/pptx-export.js` 生成可编辑 DrawingML 表格；`core/pptx-import.js` 读回表格行列并进入场景字段，超限表格明确拒绝。旧版导入“表格文本化”限制记录描述的是当时状态，本实现已将其升级为表格对象往返。
- 视觉反馈内容快照现在包含表格数据，修改表格单元格后旧反馈标记为过期，避免按旧数据继续执行反馈。
- `tests/dsh-plugin/ppt.test.mjs` 验证 PPTX→场景校验→PPTX 的对象往返、行列校验和表格修改导致反馈过期；`vendor/core/manifest.json` 更新 `ppt-scene-schema.js` SHA-256 与 overlay `ppt-native-table-v1`。命令 `pnpm exec node --test tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/package.test.mjs`：64/64 通过；命令 `pnpm --dir dsh-plugin/forward-step-dsh run build`：Host/Client 构建通过；LibreOffice headless 成功打开含表格 PPTX 并导出 PDF（59,732 字节）；manifest SHA-256 核对一致。
- 此实现保持表格结构与文字内容，但没有迁移任意 PowerPoint 单元格样式、合并单元格或复杂表格布局；真实 DSH GUI/Host 与全域验收仍待完成。


### 2026-11-08 PPTX 原生表格单元格样式往返

- 在既有表格对象上补充单元格粗体、文字颜色和填充色；`vendor/core/ppt-scene-schema.js` 对颜色字段执行 6 位十六进制校验，`core/pptx-import.js` 从 DrawingML 读取首段文字样式与单元格填充，`core/pptx-export.js` 写回可编辑单元格样式。无样式单元格仍使用兼容的字符串形式，默认白底不制造额外样式字段。
- `tests/dsh-plugin/ppt.test.mjs` 覆盖样式的导入→场景→导出往返、非法填充色拒绝；`tests/dsh-plugin/package.test.mjs` 覆盖 vendor overlay 与包边界。命令 `pnpm exec node --test tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/package.test.mjs`：64/64 通过。Host/Client 构建通过。LibreOffice headless 成功解析含单元格粗体、文字色和填充色的 PPTX 并导出 PDF（56,482 字节）。`ppt-scene-schema.js` manifest SHA-256 核对一致（`daa5a326e2aa106c5d6b6dc361f7e08500fd733a28be992ab0c1ab9d066c6bf9`，overlay `ppt-native-table-v1`）。
- 尚未支持合并单元格、复杂表格主题/边框样式及真实 DSH GUI/Host；表格布局范围仍需真实用户文件样本和桌面视觉验收。


### 2026-11-08 PPT 工作台表格创建与编辑入口

- `src/client/index.ts` 在逐页规划预览中增加结构化表格渲染和 TSV（Tab 分列、换行分行）编辑入口；支持新建、修改和清空当前页表格，实施 1–20 行、1–8 列、列数一致及每格 1,000 字符限制。修改现有表格时按相同行列保留单元格粗体/文字色/填充色；场景快照机制会让表格修改后的旧视觉反馈过期。
- `tests/dsh-plugin/client.test.mjs` 覆盖工作台显示已有表格、追加行后保存状态读回及原单元格填充色保留。命令 `pnpm exec node --test tests/dsh-plugin/client.test.mjs tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/package.test.mjs`：94/94 通过；`pnpm --dir dsh-plugin/forward-step-dsh run build`：Host 与 Client 构建通过。
- 表格布局和样式编辑目前通过 TSV 内容编辑保留既有单元格样式，暂不支持 GUI 中逐格设置样式或合并单元格；真实 DSH GUI 仍未验收。


### 2026-11-08 宿主指纹缺失字段拒绝兼容

- `host/compatibility.js` 不再把预期与实际同时缺失的字段视为相等兼容；程序哈希、CLI 版本、profile、插件根路径任一缺失、空白或非字符串都会登记为差异并阻止兼容通过。
- `tests/dsh-plugin/host.test.mjs` 增加双方字段均缺失、空白及错误类型回归。命令 `pnpm exec node --test tests/dsh-plugin/host.test.mjs tests/dsh-plugin/profile.test.mjs tests/dsh-plugin/package.test.mjs`：25/25 通过；`pnpm --dir dsh-plugin/forward-step-dsh run build`：Host/Client 构建通过。
- Host能力矩阵的实际桌面运行态、存储/文件/目录/模型/搜索等宿主接口矩阵仍须根据隔离 DSH GUI 实测；本次只修复静态指纹兼容门，不代表桌面运行态验收完成。


### 2026-11-08 PPTX 表格字符预算按真实文本计数

- `core/pptx-import.js` 修正表格总文本预算：带样式单元格此前以对象表示，数组 `join` 会按 `[object Object]` 计数而低估内容；现按单元格实际 `text` 字符累加，并沿用 200,000 字符导入上限。
- `tests/dsh-plugin/ppt.test.mjs` 增加 200,001 字符的带样式单元格 OOXML 压缩样本，确认导入返回 `budget_exceeded`。命令 `pnpm exec node --test tests/dsh-plugin/ppt.test.mjs`：62/62 通过；`pnpm --dir dsh-plugin/forward-step-dsh run build`：Host/Client 构建通过。
- 导入器已正确按字符限额拒绝超限样本；复杂真实 PPTX 页面布局和真实 DSH GUI 仍未验收。

### 2026-11-08 通用研究批准后搜索接入

- 修复已批准通用研究仅记录状态、不执行搜索的断点。新增 `runApprovedResearch` Host RPC：仅处理用户批准任务，复用插件搜索端点（SearXNG GET JSON）或 DSH WebRuntime 搜索，遵守每任务最多 3 个查询/5 条来源预算，过滤非 HTTP(S)、凭证 URL 及敏感查询参数；搜索失败保留可重试状态，搜索取消不写入半成品。搜索结果明确标记为不可信，Client 展示来源并提供执行/重试入口。
- `tests/dsh-plugin/research.test.mjs` 覆盖批准状态门、来源预算/净化、配置端点 Host 端到端读回。命令 `node --test tests/dsh-plugin/research.test.mjs`：5/5 通过；`node dsh-plugin/forward-step-dsh/scripts/generate-typert.mjs` 完成 RPC 契约生成，Host/Client build 通过；Client 用例验证批准后调用 RPC 并传递取消信号。
- 尚未完成真实搜索/辅助写作服务连通性与隔离 DSH GUI 验收，因此 FF-010 仍不关闭；辅助写作独立调用本身已有 Host/Client 及自动化覆盖，本次不重复实现。自动化搜索证据仅确认 Host 桩环境内调用与持久化闭环。




### 2026-11-08 已确认社媒计划批量公开搜索

- 新增核心 `searchConfirmedSocialPublicPlan`、Host RPC 和社媒工作台“执行已确认计划公开搜索”按钮：按用户确认的平台与查询顺序调用现有公开网页搜索，不使用平台登录态或官方 API；成功/失败运行记录按预算保存，候选仍未选中，用户逐条核对后才能加入研究结果。Host 串行执行并一次持久化；单任务并发仍被拒绝；AbortSignal 取消后不写入本批部分结果。
- 当计划搜索数量高于剩余总请求预算时，执行前后均以预算门控制，最多运行剩余次数，并保留已完成和失败记录、返回截断状态。`tests/dsh-plugin/social-research.test.mjs`、`tests/dsh-plugin/domain-workbenches.test.mjs`：43/43 通过；Typert 契约生成与插件 Host/Client build 通过。
- 此项补足“确认计划后按计划批量搜索公开候选”的插件链路，但不等同四个平台登录授权后的原生采集；真实平台适配/授权和 DSH GUI 尚未验证，Task 7.1 Step 2 保持未勾选。

### 2026-11-08 设置端点探测改为真实协议校验

- `testPluginServiceEndpoint` 不再把两类服务都当作 GET 可达性探测：搜索服务按配置端点发出固定查询并要求 SearXNG JSON `results` 数组；辅助写作服务在 UI 显式确认后发一条固定合成提示，复用 OpenAI 兼容 Chat Completions 请求并校验响应正文。确认文案分别说明查询/提示内容，均不发送任务数据或凭证。
- `tests/dsh-plugin/plugin-settings.test.mjs` 覆盖搜索协议参数与 JSON 响应、辅助端点合成 POST 请求和确认门；命令 `node --test tests/dsh-plugin/plugin-settings.test.mjs tests/dsh-plugin/host.test.mjs`：20/20 通过；Typert 生成及 Host/Client build 通过。
- 真实外部服务连通性、服务端模型质量及 DSH GUI 仍未验证，FF-010 不关闭。


### 2026-11-08 PPTX 横向条形图导入与社媒批量搜索续跑

- `dsh-plugin/forward-step-dsh/core/pptx-import.js` 现支持 clustered 横向条形图数据导入为现有通用多系列图表结构，并在限制中说明视觉方向标准化；不支持图表系列/类别等原有预算边界不变。`tests/dsh-plugin/ppt.test.mjs` 增加横向图 OOXML 导入映射用例。
- `dsh-plugin/forward-step-dsh/core/social-research.js` 的已确认计划批量搜索现跳过已成功的平台/查询组合，仅重试失败项；已完成计划重复执行不发请求；预算耗尽且仍有待重试项时继续返回 `budget_exceeded`。`tests/dsh-plugin/social-research.test.mjs` 增加失败续跑和幂等用例。
- 验证：`node --test tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/social-research.test.mjs tests/dsh-plugin/domain-workbenches.test.mjs tests/dsh-plugin/host.test.mjs tests/dsh-plugin/client.test.mjs`：153/153 通过；插件 `pnpm run build`：Host/Client 构建通过；`node --check` 两个修改模块通过；基础插件契约测试 1/1 通过。
- 横向条形图方向不保存在当前通用图表 schema，导入后会标准化；PPT 复杂版式/真实 DSH GUI、四平台原生授权采集及真实外部搜索/模型效果仍未验收。Task 5.1 Step 2、Task 7.1 Step 2 和最终 GUI/真实效果验收保持未完成。


### 2026-11-08 PPTX 堆叠图表数据导入

- `dsh-plugin/forward-step-dsh/core/pptx-import.js` 将导入支持从 clustered 扩展到 stacked 与 percentStacked；导入时保留分类和系列原始缓存数值，并分别提示堆叠/百分比堆叠的视觉语义会标准化。没有改变现有系列数、类别数、文本和数值限额。
- `tests/dsh-plugin/ppt.test.mjs` 增加 stacked 与 percentStacked 两类压缩 OOXML 样本，验证原始数据可读回及限制说明存在。`node --test tests/dsh-plugin/ppt.test.mjs`：64/64 通过；`pnpm run build`（插件目录）：Host TypeScript 与 Client bundle 构建通过。
- 图表数据导入能力已扩展，但 PowerPoint 原始布局/堆叠显示不会被通用 schema 保留；复杂布局、DSH GUI 与宿主渲染仍需最后验收，Task 5.1 Step 2 保持未完成。


### 2026-11-08 PPTX 折线、面积、饼图与圆环图数据导入

- `core/pptx-import.js` 将 OOXML 解析扩展到 lineChart、areaChart、pieChart、doughnutChart，统一恢复分类和系列缓存数据；拒绝混合图表/未知图表组合，并校验饼/圆环图恰为单系列。图表类型、横向方向与堆叠语义不在通用图表 schema 中伪保留，导入结果附带标准化限制说明。
- `tests/dsh-plugin/ppt.test.mjs` 增加折线/面积和饼/圆环的合成压缩 OOXML 覆盖。`node --test tests/dsh-plugin/ppt.test.mjs`：66/66 通过；插件 `pnpm run build`：Host TypeScript 与 Client bundle 构建通过。修复并覆盖内部来源类型元数据未清除的断言失败。
- 仍未覆盖散点、雷达、股价、3D 或混合图表及图表视觉还原；复杂 PPTX 样式和真实 DSH 宿主/GUI 验收留在最后阶段，Task 5.1 Step 2 仍未关闭。


### 2026-11-08 PPTX 系列名称缓存兼容

- `core/pptx-import.js` 现从 `<c:tx><c:strRef><c:strCache>` 的 `<c:pt>` 缓存读取系列名，同时兼容原有直接 `<c:v>` 形式；不执行或跟随缓存中的工作表公式。
- `tests/dsh-plugin/ppt.test.mjs` 增加真实形态的 `strRef/strCache` XML 样本。PPT 定向回归 67/67 通过；插件 Host/Client build 通过。

### 2026-11-08：截图导入、逐页标注与修改提示词（按用户调整的 PPT 优先级）

按用户最新要求，PPT 工作以 PPTX/截图导入、逐页标注理解和生成修改提示词为核心；停止扩展 PPT 成品导出。

- Client 支持一次导入多张 PNG/JPEG 截图，逐张限制 3 MiB（与 PPT 页面图片存储契约一致）、每批最多 50 张且总计不超过 64 MiB；读取后先逐页复核，确认前不替换现有大纲。
- 截图在待导入和当前页面预览中显示；页面点击位置和分类/文本意见沿用既有逐页标注状态。
- 有截图的反馈提示词标明对应页的截图需随提示词手动附加；明确不上传/不伪称读取图片，提示外部 AI 需结合用户实际附上的原图。
- 本轮文件：`dsh-plugin/forward-step-dsh/src/client/index.ts`、`core/methods.js`、`vendor/core/ppt-scene-prompts.js`、`tests/dsh-plugin/ppt.test.mjs`。
- 验证：`pnpm --dir .dsh-workspace/dsh-plugin/forward-step-dsh build` 通过；`node --test .dsh-workspace/tests/dsh-plugin/ppt.test.mjs` 67/67 通过；定向 `git diff --check` 通过。
- 尚未完成：DSH GUI 真实导入/交互验收；当前插件不执行截图 OCR/自动视觉识别，截图的视觉理解依赖用户标注及外部 AI 实际收到截图。

### 2026-11-08：更换截图后使旧标注失效

- 修复逐页标注快照未纳入页面截图的问题；现在截图变化会让关联的旧意见标为过期，避免旧标注误入后续提示词。场景规范化和 Client 使用相同的紧凑双哈希指纹，不把整张图片复制进快照。
- 修改：`dsh-plugin/forward-step-dsh/vendor/core/ppt-scene-schema.js`、`dsh-plugin/forward-step-dsh/src/client/index.ts`、`tests/dsh-plugin/ppt.test.mjs`。
- 验证：插件 Host/Client build 通过；PPT 定向测试 68/68 通过；Host 与 workspace-files 契约测试 20/20 通过；相关 `git diff --check` 通过。
- DSH GUI 真实截图导入、标注状态跨会话恢复仍未实测；本地契约和构建结果不替代宿主验收。

### 2026-11-08：PPT 截图本地 OCR 与可重复 vendor 适配

- 多张 PNG/JPEG 截图导入复用现有材料文件上传与本地 OCR Host；每页同时保留原图和有限 OCR 文本，OCR 文本明确为待人工校对，OCR 失败保留原图，导入取消可中止 Host 上传；超限时不替换现有大纲。
- 为使能力进入最终包并避免 vendor 重生成覆盖适配，`scripts/dsh-stage-core.mjs` 对 PPT schema/prompt 的 overlay 增加截图指纹快照、标注坐标、样式/表格/图表/段落片段验证及截图提示词上下文；manifest 和 package test 同步登记 overlay 版本及截图导入器。
- 修改：`dsh-plugin/forward-step-dsh/client/ppt-screenshot-import.js`、`src/client/index.ts`、`package.json`、`scripts/dsh-stage-core.mjs`、`vendor/core/ppt-scene-schema.js`、`vendor/core/ppt-scene-prompts.js`、`tests/dsh-plugin/ppt-screenshot-import.test.mjs`、`tests/dsh-plugin/ppt.test.mjs`、`tests/dsh-plugin/package.test.mjs`。
- 验证：Host/Client build 通过；PPT+截图 OCR 定向测试 71/71 通过；Host、workspace-files、tarball 包边界测试 23/23 通过；新导入模块已通过 tarball 收录核验。
- GUI 导入/标注及真实模型视觉理解仍 not-run；OCR 使用现有本地识别能力，识别文本需用户校对，外部 AI 需要用户同时附原图。

### 2026-11-08：截图导入前逐页校对

- 按用户确认的 PPT 优先级补齐待确认导入页：用户现在可逐页编辑页面标题与 OCR 文本，再决定确认替换或丢弃；OCR 文字在确认前不会写入当前大纲。删除了待导入页重复显示同一截图的第二个预览。
- 修改：`dsh-plugin/forward-step-dsh/src/client/index.ts`。
- 验证：插件 Host/Client build 成功；`node --test tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/ppt-screenshot-import.test.mjs` 71/71 通过。
- 后续聚焦 PPTX/截图导入、逐页理解/标注与修改提示词；本增量不改成品导出路径。待确认导入的真实 DSH GUI 交互仍未实测。

### 2026-11-08：区分页面截图与导入配图语义

- PPTX 导入的页面可能包含单独配图，旧修改提示词把所有页面图像都称作截图，容易让外部模型把局部配图误当整页。现改为“导入图像资料”，要求附上对应原始图像或页面截图，并继续明确未附图不得声称已读取。
- Client 页面预览状态与图片替代文本同步改为图像资料表述；PPT 提示词测试锁定该文案。
- 修改：`dsh-plugin/forward-step-dsh/core/methods.js`、`vendor/core/ppt-scene-prompts.js`、`src/client/index.ts`、`tests/dsh-plugin/ppt.test.mjs`。
- 验证：`node --test tests/dsh-plugin/ppt.test.mjs` 68/68 通过；插件 Host/Client build 通过。尚未进行 DSH GUI 验收。

### 2026-11-08：逐页反馈提示词纳入校对文本

- 视觉反馈提示词现在会按被标注页面附上页面标题与已校对正文/OCR（每页最多 3,000 字符），并标记该文本为不可信、需要核对；只携带实际有选中有效标注的页面上下文，不把其它页文本误带入反馈段。
- 修改：`dsh-plugin/forward-step-dsh/vendor/core/ppt-scene-prompts.js`、`tests/dsh-plugin/ppt.test.mjs`。
- 验证：PPT 定向测试 68/68 通过；插件 Host/Client build 与差异检查通过。真实 DSH GUI 和附图后的模型视觉理解仍待验收。

### 2026-11-08：导入后当前页标题与 OCR 可编辑

- 当前 PPT 页面预览新增标题和正文/OCR 编辑控件，修改即更新当前任务的大纲；现有逐页内容快照会使对应旧反馈自动过期，需按新页面重新标注后才会进入后续修改提示词。
- Client 集成测试覆盖 HTML/PPTX 导入待确认预览字段，以及确认 PPTX 导入后修改标题与 OCR 正文。
- 修改：`dsh-plugin/forward-step-dsh/src/client/index.ts`、`tests/dsh-plugin/client.test.mjs`。
- 验证：Host/Client build 通过；`node --test tests/dsh-plugin/client.test.mjs tests/dsh-plugin/ppt.test.mjs` 98/98 通过。DSH GUI 仍未实测。

### 2026-11-08：视觉反馈带入结构化页面数据

- 逐页修改提示词现除标题与已校对文字外，还携带当前标注页的表格和图表 JSON 摘要（各自最多 3,000 字符），并明确标记为不可信、需要核对；未标注页的数据不进入反馈清单。
- 修改：`dsh-plugin/forward-step-dsh/vendor/core/ppt-scene-prompts.js`、`tests/dsh-plugin/ppt.test.mjs`。
- 验证：PPT 定向测试 68/68 通过；插件 Host/Client build 通过。真实 DSH GUI 与附图后的模型效果仍待验证。

### 2026-11-08：PPTX 同页多图保留与提示词复核

- PPTX 导入现在收集每页全部 PNG/JPEG 图片关系，单张仍限制 3 MiB，整个演示图片总量限制 20 MiB；页面状态保留 `imageDataUrls`，预览可逐张显示，图片集合变化会使旧视觉意见过期。
- 场景 schema 的可重复 vendor overlay 增至 v4，校验并保存多图列表；修改提示词 overlay 纳入被标注页面的标题、OCR/正文、表格与图表摘要，单项各限 3,000 字符并标明为不可信待核对。修正 package test 要求 overlay 来源哈希准确登记，避免打包继续使用脱节 vendor 文件。
- 修改：`core/pptx-import.js`、`src/client/index.ts`、`core/methods.js`、`scripts/dsh-stage-core.mjs`、`vendor/core/ppt-scene-schema.js`、`vendor/core/ppt-scene-prompts.js`、`tests/dsh-plugin/ppt.test.mjs`、`tests/dsh-plugin/package.test.mjs`。
- 验证：PPT/Client/package 定向测试 101/101 通过；PPT 单测复跑 69/69 通过；Host/Client build 通过；两个 vendor 文件由 stage 脚本重生成且 `node --check` 通过。真实 DSH GUI 和外部模型视觉效果仍待验收。

### 2026-11-08：图表变化使旧页面标注过期

- 将页面图表数据纳入 Client 与 vendor schema 的标注快照；图表数值、系列或分类变化后，原有视觉反馈会失效，不再被用于生成修改提示词。
- 可重复 schema overlay 升至 v5，包验收同步版本登记。
- 修改：`dsh-plugin/forward-step-dsh/src/client/index.ts`、`scripts/dsh-stage-core.mjs`、`dsh-plugin/forward-step-dsh/vendor/core/ppt-scene-schema.js`、`tests/dsh-plugin/ppt.test.mjs`、`tests/dsh-plugin/package.test.mjs`。
- 验证：PPT 定向测试 70/70、包边界测试 3/3 通过；Host/Client build 与差异检查通过。真实 DSH GUI 未验收。

### 2026-11-08：PPTX 项目符号导入保真

- PPTX 文字抽取保留显式 `buChar` 项目符号字符；对 `buAutoNum` 自动编号列表导入为项目符号，并在导入限制中明确告知编号外观已标准化，不伪称保留了原编号样式。
- 修改：`dsh-plugin/forward-step-dsh/core/pptx-import.js`、`tests/dsh-plugin/ppt.test.mjs`。
- 验证：PPT 定向测试 71/71 通过；插件 Host/Client build 通过。GUI 和真实 Office 样本尚待验收。

2026-11-08 继续接入：确认导入后可逐张移除当前 PPT 页内嵌图像，覆盖单图字段与多图列表合并后的页面图像集合；删除会改变页面图像快照，旧视觉反馈自动失效并要求重新标注，避免旧意见进入修改提示词。Client 集成测试覆盖真实确认导入、移除图像和意见过期。PPT/Client/截图导入定向测试 104/104、Host/Client build、包边界 3/3 通过。未扩展成品导出；DSH GUI 与外部模型视觉理解仍 not-run。

2026-11-08 补充：逐图移除按钮已阻止点击冒泡，避免删除图片时误触页面预览并移动标注定位点；Client 集成测试验证该按钮隔离事件。Client 构建与 Client 30/30 通过。

2026-11-08 继续接入：新增 `src/client/ppt-page-images.ts` 统一管理页面单图/多图集合的读取与移除，待确认导入预览、确认后页面预览、反馈快照共用一致的显示顺序；移除后仅保留有效的 `imageDataUrls`，空集合不写入状态。新增多图混合字段、首项移除、越界不变测试。PPT/Client 定向测试 102/102、截图导入 3/3、Host/Client build、包边界 3/3 通过；未扩展成品导出。真实 DSH GUI 和外部模型附图效果仍 not-run。

2026-11-08 继续接入：PPTX 导入现对每页内嵌 PNG/JPEG 复用已接入的本地图片解析/OCR 流程；文字以“内嵌图片 OCR（待人工校对）”追加到该页正文，单页最多 3,000 字符。OCR 失败保留图像并显示失败页数；识别可取消，取消时不产生待确认导入草稿且不覆盖原大纲。新增 `src/client/pptx-image-ocr.ts` 并接入 PPTX 待确认流程；测试覆盖多图、失败保图、字符上限和取消。PPT/Client/截图导入/包联合测试 110/110 通过，Host/Client build 通过。真实 DSH GUI、OCR 真实图片精度及外部模型附图效果仍未验收；未扩展 PPT 成品导出。

2026-11-08 补充：PPTX 图片 OCR 现使用现有解析器返回的置信度（0–100）；低于 70 时在对应图片摘录旁标注“建议重点校对”，并汇总低置信度图像数。缺少置信度时仍保留通用人工校对说明，不将缺失值推断为低质量。更新测试覆盖低置信度标记与计数。Host/Client build 和 PPT/Client/截图导入/包联合回归 110/110 通过；阈值仅用于复核提示，不代表 OCR 正确率保证。

2026-11-08 继续接入：截图导入现在与 PPTX 内嵌图片 OCR 一样读取解析器置信度；低于 70/100 时在该页识别文本上明确提示优先校对，并在导入限制中统计数量。未提供置信度时不推断；OCR 失败仍保留截图。截图回归覆盖高/低置信度显示，Host/Client build 和截图/PPT/Client/包联合测试 110/110 通过。阈值仅是人工复核提示，真实截图准确率与 DSH GUI 仍未验收。

2026-11-08 继续接入：截图 OCR 原每页 450 字符上限现提高到 3,000 字符，与 PPTX 内嵌图片 OCR 一致；超限继续显式标记截断。逐页标题、截图、置信度及人工校对提示不变。截图测试新增 3,200 字符输入校验保留长度、截断说明与置信度。截图/PPT/Client/包联合回归 111/111，Host/Client build 通过。

2026-11-08 继续接入：PPTX 内嵌图片 OCR 现在逐图回报完成数、总数和当前页码；待确认导入界面的状态区动态显示进度，OCR 失败图片也计入完成数，取消语义保持不变。新增进度回归覆盖跨页成功与失败。PPT/Client/截图导入/包联合测试 112/112，Host/Client build 通过。

2026-11-08 继续接入：截图批量 OCR 现在逐页回报完成数、总数及页码，界面显示实时识别进度，成功与 OCR 失败页面均计入完成数。测试覆盖三页成功/失败交错进度。截图/PPT/Client 定向测试 110/110，Host/Client build 通过。真实截图 OCR 精度和 DSH GUI 仍未验收；未扩展 PPT 成品导出。

2026-11-08 继续实施：截图导入逐页保留原始文件名，待确认页面显示对应文件，逐页修改提示词列出页码/原图文件名/图像数量，减少外部 AI 附图与页面错配。文件名限制长度并折叠换行符。测试：PPT/Client/截图导入定向测试 110/110；Host/Client build 通过。真实 DSH GUI 与附图模型理解未验收；未扩展 PPT 成品导出。

2026-11-08 继续实施：PPTX 导入逐页保存原始演示文稿文件名并在待确认页面显示；视觉修改提示词将原稿文件名、页码及内嵌图像数量关联，纯文字页也提示附上来源演示文稿。文件名限 240 字符并折叠换行/制表符。Client/截图/PPT 定向测试 110/110，Host/Client build，包边界 3/3 通过；同步 vendor overlay/hash。真实 DSH GUI 和外部模型附图理解未验收，未扩展成品导出。


2026-11-08 继续实施（PPT 逐页理解）：待确认导入页与确认后预览页均新增独立的“页面理解备注”，与 OCR/校对正文分离；视觉修改提示词按页带入该备注，并明确它是用户观察、仍需结合附图核对。页面快照纳入理解备注，修改备注后原标注自动过期，避免提示词引用旧上下文。源码仅改 `.dsh-workspace/dsh-plugin/forward-step-dsh` 与核心 vendor overlay 登记：`src/client/index.ts`、`vendor/core/ppt-scene-schema.js`、`vendor/core/ppt-scene-prompts.js`、`vendor/core/manifest.json`；overlay 生成与哈希维护见 `scripts/dsh-stage-core.mjs`，包验收同步 `tests/dsh-plugin/package.test.mjs`。验证：插件 Host/Client build 成功；`node --test tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/client.test.mjs tests/dsh-plugin/ppt-screenshot-import.test.mjs tests/dsh-plugin/package.test.mjs` 114/114 通过。未扩展 PPT 成品导出；DSH GUI 与真实外部模型图像理解仍未验收。


2026-11-08 Host 契约增量：修复 `invokeHostCapability` 的取消竞态。若 AbortSignal 在调用排队后、Host 方法微任务执行前触发，适配器现会在调用宿主前复查并返回 `cancelled`，避免“调用方已取消但 Host 副作用仍开始”。新增同轮次取消测试，断言 Host 方法调用次数为 0。文件：`dsh-plugin/forward-step-dsh/host/port.js`、`tests/dsh-plugin/host.test.mjs`。验证：Host/Profile/包边界 25/25；插件 Host/Client build 成功。此项只关闭排队取消边界，不代表 storage/model/search/file/directory/panel/lifecycle 的完整拒绝/取消/释放矩阵已闭合；Task 1.4 Step 2 继续未完成。


### 2026-11-08 PPT 导入取消状态修正与范围收敛

- 2026-11-08 继续实施：截图导入用户主动取消时，Client 现在显示“截图导入已取消；当前大纲未修改”，与实际取消语义一致，不再误报导入失败。PPTX/截图导入、逐页理解与标注作为后续 PPT 工作核心；本次不扩展 PPT 成品导出。


### 2026-11-08 PPT 反馈页与预览页联动

- “反馈页面”和“PPT 预览页面”现双向同步，切页时清除旧定位点；切换/新建/重新读取任务或清空当前任务时，两项页码均回到第一页，避免旧任务页码遗留。Client 集成回归覆盖双向切页及从第二页切换到新 PPT 任务后索引归零。Client build 通过；`node --test tests/dsh-plugin/client.test.mjs` 30/30 通过。真实 DSH GUI 仍 not-run；未扩展成品导出。


### 2026-11-08 PPT 逐页修改提示词一键生成

- Client 在逐页反馈区新增“保存并生成逐页修改提示词”：仅当前页快照仍有效且模型已选时启用；先持久化 `visual-feedback` 阶段和标注，再用保存后的任务修订运行 `step-prompt`。生成完成后页面理解备注变化会使旧反馈过期并禁用再次生成，需重新标注。统一页面快照纳入 visualDescription，防止旧理解备注被继续采用。
- 验证：Client build 通过；PPTX 导入/逐页标注/保存并生成集成用例通过；`node --test tests/dsh-plugin/client.test.mjs` 30/30 通过。未扩展 PPT 成品导出；真实 DSH GUI 和真实模型效果未验收。

### 2026-11-08 PPTX 待确认页关联整页截图

- 待确认 PPTX/截图导入页现可按当前页补入 PNG/JPEG 整页参考截图，并在该页即时预览；确认前仍不改正式大纲。确认后整页截图沿用既有页面图像存储、预览及视觉反馈快照，原始演示文件名与关联截图文件名分别保留。校验维持单张 3 MiB、全部导入页图像总量 20 MiB，并校验浏览器读取所得 data URL MIME；PPTX 内嵌局部配图继续独立显示。
- 测试 `tests/dsh-plugin/client.test.mjs` 覆盖当前页关联、原 PPTX 来源保留、确认后预览延续。验证：插件 Host/Client build 通过；`node --test tests/dsh-plugin/client.test.mjs tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/ppt-screenshot-import.test.mjs tests/dsh-plugin/package.test.mjs` 114/114 通过。未扩展 PPT 成品导出；真实 DSH GUI 和外部模型整页图像理解效果尚未验收。

### 2026-11-08 PPTX 待确认页批量关联整页截图

- 待确认 PPTX/截图导入页支持从当前页起按多选顺序，将整页 PNG/JPEG 原子关联到连续页面；截图数量超过剩余页数、单张大小/MIME 越界、批次图像总量超限或任一读取失败时不写入部分页面。页面换序时截图随页面数据移动，来源文件名继续逐页保留。
- `tests/dsh-plugin/client.test.mjs` 覆盖超页拒绝无部分写入、两张截图按顺序关联及页面换序后映射不漂移。插件 Host/Client build 通过；PPTX/截图/Client/包专项回归继续验证中。未扩展 PPT 成品导出；DSH GUI 与外部模型实际多图理解仍待验收。

- 追加边界：批量关联复用截图导入器的 PNG/JPEG 二进制签名校验；即使文件声明 MIME 与 Data URL 一致，内容签名不符时整批拒绝。测试补入伪装 PNG 与有效 PNG 混批，验证失败不落部分结果。
- 最终复验：Host/Client build 成功；`node --test tests/dsh-plugin/client.test.mjs tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/ppt-screenshot-import.test.mjs tests/dsh-plugin/package.test.mjs` 114/114 通过。批量图片读取期间锁定操作并在成功/失败后释放，防止导入状态被并发 UI 操作覆盖。

### 2026-11-08 逐页原图放大查看

- 确认后的 PPT 页面图像资料现有逐图“放大查看”入口，打开带页码/图像序号的模态预览，原始 Data URL 不重编码；关闭按钮自动聚焦。仅当预览仍处于对应任务、页码且图像仍在当前页时显示，切页、切任务或移除图片后不会继续展示旧图。
- `tests/dsh-plugin/client.test.mjs` 覆盖原图来源一致与关闭弹层；Host/Client build 成功，Client 30/30 通过。真实 DSH GUI、外部模型视觉理解仍未验收；未扩展 PPT 成品导出。

### 2026-11-08 原图放大查看中直接定位反馈

- 原图预览画布现支持鼠标按真实缩放后的图像内容区域定位反馈点，并排除 `object-fit: contain` 留白；方向键按 0.02 微调、Shift+方向键按 0.1 微调。定位结果回填既有逐页反馈状态，随后添加意见即可生成逐页修改提示词。
- `tests/dsh-plugin/client.test.mjs` 覆盖带留白截图的中心坐标映射及键盘微调。Host/Client build 通过，Client 30/30 通过；真实 DSH GUI 的焦点/键盘行为仍待验收。未扩展 PPT 成品导出。

### 2026-11-08 多图页面标注定位闭环续接

- 原图放大预览中的方向键处理已修复为完整 Client 回调；新建定位时默认落在所选图像中心，已有同页同图定位则继续微调，标注状态明确显示关联图像序号。逐页提示词使用“第 N 张关联图像位置”，避免多图页面坐标指向不明。
- `tests/dsh-plugin/package.test.mjs` 的 vendor overlay 登记同步至 `ppt-annotated-image-target-v9` / `ppt-annotated-image-target-v6`；PPT schema 已有测试覆盖合法关联图像与越界/非整数索引拒绝，Client 测试覆盖原图定位与键盘微调。
- 验证：`pnpm --dir dsh-plugin/forward-step-dsh run build`（Host TypeScript 与 Client 构建通过）；`node --test tests/dsh-plugin/client.test.mjs tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/ppt-screenshot-import.test.mjs tests/dsh-plugin/package.test.mjs`（115/115 通过）。真实 DSH GUI 焦点/键盘体验与真实多模态模型理解效果仍待验收；未扩展 PPT 成品导出。

### 2026-11-08 图像级标注在原图坐标系显示

- 图像级反馈点（带 `imageIndex`）不再叠加到整页预览；对应图像在放大预览时显示标记，使用图像自身的 0–1 坐标。页面级反馈点仍显示在整页预览，消除多图页面坐标系混淆。
- `tests/dsh-plugin/client.test.mjs` 新增断言：键盘微调后的图像级标记位置为 52%/50%，且该标记不出现在整页预览。
- 验证：插件 Host/Client build 成功；`node --test tests/dsh-plugin/client.test.mjs tests/dsh-plugin/ppt.test.mjs` 107/107 通过。GUI 与真实多模态模型效果仍待最终验收；未扩展 PPT 成品导出。

### 2026-11-08 Host 能力矩阵补入必需 Service 入口

- `host/port.js` 原先在 `validateHostPort` 要求 `exposeService`，但 `inspectHostCapabilities` 未报告该能力；现新增 `service: ['exposeService']`，使报告与实际必需端口契约一致。
- `tests/dsh-plugin/host.test.mjs` 增加 service 缺失状态、成功参数调用及各能力缺失入口检查；当前仍未为每种能力完整枚举拒绝/取消/释放矩阵，Task 1.4 Step 2 不关闭。
- 验证：`node --test tests/dsh-plugin/host.test.mjs tests/dsh-plugin/profile.test.mjs tests/dsh-plugin/package.test.mjs` 25/25 通过；`pnpm --dir dsh-plugin/forward-step-dsh run build` Host/Client 成功。该能力矩阵为插件内部契约，不构成真实 DSH GUI 或 runtime 实测。

### 2026-11-08 运行态 Host 能力报告补齐插件 Service

- 内部 `HostPort` 能力矩阵已纳入 `exposeService`，本次进一步让 Host RPC 的 `getHostCapabilities` 明确报告当前已响应的插件 Service 入口；侧栏能力矩阵由实际 RPC 状态反映，不把内部服务暴露能力遗漏。
- 文件：`dsh-plugin/forward-step-dsh/src/host-service.ts`、`tests/dsh-plugin/host.test.mjs`。测试断言运行态报告包含 `service: available`。
- 验证：Host/Client 构建成功；`node --test tests/dsh-plugin/host.test.mjs tests/dsh-plugin/profile.test.mjs tests/dsh-plugin/client.test.mjs` 52/52 通过。该报告是插件 RPC 运行态证据，不等于桌面 GUI/profile 卸载生命周期已实测；Task 1.4 Step 2 仍因逐能力拒绝/取消/释放组合未齐而保持未关闭。

### 2026-11-08 PPT 逐页提示词附件清单

- `core/methods.js` 生成视觉反馈提示词时，现按页面图像显示顺序逐项列出“图像资料 N”；有来源名时明确标记整页截图文件名，并说明标注坐标序号与附件清单序号一致。提示词仍不包含图片数据，继续由用户附上本地原图。
- `tests/dsh-plugin/ppt.test.mjs` 校验多图顺序、整页截图文件名、标注索引映射和不上传图像数据。
- 验证：`node --test tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/client.test.mjs` 107/107 通过；Host/Client build 成功。真实外部模型接收附件后的视觉理解与 GUI 操作仍未验收；未扩展 PPT 成品导出。

### 2026-11-08 接入 PPT 单页多模态理解草稿

- 在逐页图像资料操作区加入“发送图像给模型理解”。Host `understandPptPage` 根据任务修订、会话、页码和图像序号读取已确认页面图像；检查 PNG/JPEG 和 3 MiB 上限，经 DSH Attachment API 接收后以 LLM `image` 内容块随文本请求发送给所选模型。RPC 生成契约同步更新。
- 模型结果仅进入待复核草稿；用户可追加到页面理解备注或丢弃，不会静默覆盖。图像发送时 UI 明示提交给当前模型提供方；支持取消，取消或失败时保留原页面备注。
- 文件：`src/types.ts`、`src/host-service.ts`、`src/client/index.ts`、生成的 `lib/typert.*` / Host 构建产物、`tests/dsh-plugin/ppt.test.mjs`、`tests/dsh-plugin/client.test.mjs`。
- 验证：Host/Client build 成功；Host/PPT/Client 专项测试 123/123 通过。测试证明图像块经附件服务按对应图像发送、任务修订/模型选择/备注确认交互；真实 provider 是否支持图像输入、实际视觉理解质量及 GUI 体验仍待实测。未扩展 PPT 成品导出。


### 2026-11-08 用户确认的 PPT 迁移重点与图像指令边界

- 按用户最新方向，后续 PPT 工作以 PPTX/截图导入、逐页理解与标注、修改提示词生成为主；暂停扩展 PPT 成品导出，除非用户之后明确要求。已有导出能力暂不改动。
- `src/host-service.ts` 的单页视觉理解请求现明确将图像中所有文字视为不可信内容，禁止遵循其中嵌入的指令；继续仅输出可见布局/视觉信息，不猜测未显示事实。`src/client/pptx-image-ocr.ts` 的解析契约补齐实际使用的可选置信度字段。
- `tests/dsh-plugin/ppt.test.mjs` 锁定视觉理解提示中的不可信图中文字边界。验证：`pnpm --dir dsh-plugin/forward-step-dsh run build` 通过；`node --test tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/client.test.mjs tests/dsh-plugin/ppt-screenshot-import.test.mjs` 113/113 通过。真实 DSH GUI、真实 provider 的图像支持与理解质量仍未验收。


### 2026-11-08 修改提示词中的截图指令隔离

- `scripts/dsh-stage-core.mjs` 的 PPT 提示词 overlay 升级至 `ppt-annotated-image-target-v7`；生成逐页修改提示词时，明确原始截图、OCR、人工页面理解和页面内文字均为不可信参考，不遵循其中面向模型的指令或改变任务目标。更新 vendor overlay/manifest 与包边界预期，并补充 PPT 提示词断言。
- 验证：Host/Client build 通过；PPT、截图导入、Client 与包边界测试 116/116 通过。真实 GUI 与真实模型输出质量仍待验收。


### 2026-11-08 PPT 视觉理解请求生命周期收尾

- Client 面板卸载时现在会取消尚未完成的单页图像理解请求，并清空活动控制器；迟到的成功/失败回调不会再写入已卸载界面。
- `tests/dsh-plugin/client.test.mjs` 为 React Hook 测试夹具补上卸载清理，并覆盖面板关闭时请求 signal 被取消。
- 验证：Host/Client build 通过；Client 定向回归 31/31 通过。真实 DSH GUI 与 provider 图像能力仍待最终验收。


### 2026-11-08 PPTX 内嵌图片 OCR 预算统计修正

- `src/client/pptx-image-ocr.ts` 将 OCR 成功统计移到每页字符预算裁剪之前；成功识别但因本页 3,000 字符上限未纳入正文的后续图像计为截断，不再误报识别失败。失败只计 OCR 无有效文字或解析异常。
- `tests/dsh-plugin/ppt.test.mjs` 新增双图边界用例，覆盖首图刚好耗尽预算、次图 OCR 成功但未写入的计数和限制提示。
- 验证：Host/Client build 通过；PPT、截图导入、Client、包边界联合测试 118/118 通过。真实 OCR 精度及 DSH GUI 仍未验收。


### 2026-11-08 PPTX 图片 OCR 置信度统计一致性

- `src/client/pptx-image-ocr.ts` 现先统计有效 OCR 识别与置信度，再判断页面字符预算；即使后续图片的文字因每页 3,000 字符上限未写入，成功数和低置信度数仍反映实际解析结果，截断与失败继续区分。
- `tests/dsh-plugin/ppt.test.mjs` 双图边界用例覆盖预算外图片同时低置信度的统计与提示。
- 验证：Host/Client build 通过；PPT、截图导入、Client、包边界联合测试 118/118 通过。


### 2026-11-08 PPT 图像理解 Host 能力显式化

- Host 运行态能力矩阵新增 `image-understanding`，同时要求模型 API 与 `AttachmentAPI.admitPromptContent`；图像理解 RPC 在读图校验后、调用模型前检查图像附件接口，缺失时返回 `forward-step/capability-unavailable`。RemoteError 类型映射已登记。
- 更新 Host 能力报告成功/缺失测试，并新增 PPT RPC 缺图像接口时的明确拒绝用例。
- 验证：Host/Client 构建通过；`node --test tests/dsh-plugin/host.test.mjs tests/dsh-plugin/ppt.test.mjs` 95/95 通过。该契约不证明真实 DSH Host/Provider 已实现或支持视觉输入；GUI 与实际模型仍待验收。


### 2026-11-08 社媒公开计划逐项检查点恢复

- `core/social-research.js` 的 `searchConfirmedSocialPublicPlan` 新增可选异步 `onCheckpoint`；每完成一个平台×查询组合后先等待检查点写入，再继续下一次搜索。
- Host 在回调中读取最新 revision 并逐项保存；批量操作结束时读回最终任务，不再以启动时的旧 revision 整批覆盖。取消后已完成组合留在任务中，续跑跳过成功组合且只请求剩余组合。
- 回归覆盖核心检查点顺序、Host 中途取消后的持久化读回和续跑。验证：插件 Host/Client build 通过；插件全量测试 547/547、包边界测试 3/3；工作区 `pnpm test` 1661 通过/0 失败/1 跳过，`pnpm check` 通过。
- 仍未验收四个平台真实授权采集适配器、真实 DSH GUI 与外部服务效果；Task 7.1 Step 2、Task 8.2 Step 3/4 保持未完成。PPT 本轮不扩展成品导出。


### 2026-11-08 PPT 同页多图综合理解

- `UnderstandPptPageInput` 支持传入多个 `imageIndices`，旧 `imageIndex` 单图参数继续可用；Host 对输入序号做列表、唯一性、范围和 1–8 张限制校验，并将全部图片一次性送入附件 API 和同一个无工具模型请求。
- PPT 页面图像区新增“综合理解本页全部图像”入口（超过 8 张时禁用），生成的理解仍作为待复核草稿；原有单图理解和用户显式采纳流程保留。
- 回归覆盖两张图进入同一模型请求、Client 入口和草稿显示。验证：Host/Client build 通过；PPT 与 Client 测试 111/111 通过。包边界验证见本次续接结果。
- 真实 DSH Host 的多图附件与 Provider 视觉效果仍待隔离 GUI 实测；Task 5.1 Step 2 与最终 GUI 门不提前标记完成。


### 2026-11-08 社媒报告附件进入模型上下文

- 已验证并关联至用户所选结果的附件现由 Host 流式读回并重验 SHA-256；TXT/CSV/PDF/图片解析文本进入报告提示词，图片可随模型请求发送，即使 OCR 无结果也不会丢弃原图。解析失败、校验失败不会保存报告；附件总字数和图像数按界限裁剪/拒绝。
- 定向 Host/社媒测试 47/47、插件 Host/Client build 通过。Task 7.1 Step 2 仍未关闭：真实平台授权采集、恢复和 GUI 证据仍待完成。

## 2026-11-08 当前续接状态校正

- Task 1.4 Step 2 已在本轮按 `host.test.mjs`、`profile.test.mjs` 与包边界实际覆盖关闭；同日较早续接记录中“能力矩阵仍未闭合”的表述均为当时状态，以本条和勾选项为当前状态。
- PPT 按用户确认聚焦 PPTX/截图导入、逐页理解与标注、修改提示词生成；停止新增成品导出能力。现有导出保持，不纳入本轮扩展。
- 尚未关闭：Task 5.1 Step 2 的真实 DSH Web/图像能力与界面证据；Task 7.1 Step 2 的平台真实授权适配及恢复证据；Task 8.2 的最终自动化/隔离安装复核、GUI 实测与最终差距审计。继续优先完成可自动化和非 GUI 项，最后再安排真机 GUI。

### 2026-11-08 PPTX 仅外链图页面恢复

- `core/pptx-import.js` 现在把仅有外链/不支持/缺失图片关系的页面保留为“待补视觉素材”页，方便后续逐页补入整页截图；不读取外链目标；真正没有任何可读内容或图片关系的空白页仍拒绝。
- `tests/dsh-plugin/ppt.test.mjs` 新增回归；PPT 83/83，PPT/Client/截图导入/包边界联合 122/122，Host/Client build 与差异检查通过。该项归属 PPT 输入与复核链路，不关闭真实 DSH Web/图像能力验收门。

### 2026-11-08 Task 8.2 自动化/隔离安装门当前状态

- Task 8.2 Step 2 已按当前源代码版本重新生成 tarball 并执行隔离 profile Backup → Install → Restore，安装与恢复均验证通过；同步关闭计划 Step 2。
- 插件全测 550/550；工作区全测第二次 1664 通过、0 失败、1 跳过；`pnpm check`、Host/Client build、包边界测试通过。首次工作区全测出现 1 项 OCR worker 取消时序失败，隔离单测与全量重跑通过，记录为一次未复现失败。
- Task 8.2 Step 3/4 仍未完成：真实 DSH GUI、真实 Provider 效果、用户反馈和全功能最终差距审计都留待最后阶段。

### 2026-11-08 截图导入读取取消与最新候选复验

- 截图导入器现将 AbortSignal 接入 FileReader，用户取消会中止正在进行的读取，不再等待当前文件结束；新增活动 FileReader 取消回归，截图/Client 测试 37/37 通过。
- Host/Client build 通过，工作区全量 1665 通过、0 失败、1 跳过。最新 r4 候选包完成测试 profile Backup → Install → Restore，安装/恢复验证通过；因此此前关闭的 Task 8.2 Step 2 在新增代码后又以当前源码重新验证。
- Task 8.2 Step 3/4 仍未运行；真实 GUI、模型效果和平台授权证据保持 not-run。


### 2026-11-08 社媒能力状态与执行入口一致性

- 修复 Host 能力状态可能“已授权且已核验”但未注入 `collectPlatform` 时仍显示可运行的问题。现在平台可运行状态必须同时满足 Host 状态服务可读、平台能力与授权通过、采集入口实际存在；缺采集函数时界面明确提示当前 DSH Host 未提供适配器。
- 修改：`dsh-plugin/forward-step-dsh/src/host-service.ts`、`tests/dsh-plugin/domain-workbenches.test.mjs`。
- 验证：社媒/学术工作台 Host 定向测试 28/28 通过；插件 Host/Client build 通过。真实 DSH Host 中的 `socialResearch` 注入、平台授权与采集仍未验证，因此 Task 7.1 Step 2 与最终 GUI/真实能力验收保持未完成。
- PPT 继续限于 PPTX/截图导入、逐页理解与标注、修改提示词生成；本增量未改动 PPT 成品导出。

### 2026-11-08 PPT 页面切换取消过期图像理解

- Client 在切换任务、逐页预览或反馈页时取消进行中的图像理解请求并清除该页理解草稿，防止迟到响应被误用于新页面；单图/多图理解和原有用户采纳流程不变。
- 新增交互回归：图像理解请求等待期间切换预览页，断言 AbortSignal 已中止且旧草稿不再显示。
- 修改：`dsh-plugin/forward-step-dsh/src/client/index.ts`、构建产物 `dsh-plugin/forward-step-dsh/client.js`、`tests/dsh-plugin/client.test.mjs`。
- 验证：`pnpm -C dsh-plugin/forward-step-dsh run build` 成功；`node --test tests/dsh-plugin/client.test.mjs` 32/32 通过。
- PPT 成品导出未扩展；真实 DSH GUI 与真实模型视觉效果仍未验收，留待自动化工作完成后统一进行。

### 2026-11-08 PPT 导入替换时清理旧理解草稿

- 确认以新 PPTX/HTML 草稿替换当前大纲时，Client 现取消尚未完成的页面理解请求并清除已返回的理解草稿，防止同任务相同页码导致旧演示文稿的理解备注被追加到新稿。
- 集成回归先为旧页生成理解草稿，再导入并确认另一份 PPTX，断言替换后旧草稿消失。
- 修改：`dsh-plugin/forward-step-dsh/src/client/index.ts`、构建产物 `dsh-plugin/forward-step-dsh/client.js`、`tests/dsh-plugin/client.test.mjs`。
- 验证：插件 Host/Client build 成功；`node --test tests/dsh-plugin/client.test.mjs tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/ppt-screenshot-import.test.mjs tests/dsh-plugin/package.test.mjs` 126/126 通过。
- 不扩展 PPT 成品导出；真实 DSH GUI 与真实模型视觉效果仍待验收。

### 2026-11-08 社媒授权采集取消与检查点提交修正

- 授权采集适配器收到取消/AbortError 时立即以 `cancelled` 结束当前平台，不生成伪失败结果、不增加该平台查询预算；此前成功的平台检查点仍已独立持久化。
- 修复多平台检查点写入后最终提交仍引用启动时 revision 的冲突；结束提交现在读取最新存储 revision。已核对未核验的平台仍保持待准备状态，不误报整项报告就绪。
- 修改：`dsh-plugin/forward-step-dsh/core/social-research.js`、`dsh-plugin/forward-step-dsh/src/host-service.ts`、`tests/dsh-plugin/social-research.test.mjs`、`tests/dsh-plugin/domain-workbenches.test.mjs`。
- 验证：插件 Host/Client build 成功；社媒核心与 Host 工作台定向测试 56/56 通过。
- Task 7.1 Step 2 仍待真实 DSH Host 四平台授权采集适配器和恢复能力核验；不得以合成 Host 测试替代。PPT 成品导出仍冻结。


### 2026-11-08 PPT 理解草稿绑定输入快照

- Client 的图像理解草稿现在绑定发起请求时的标题、实际发送的正文/OCR 与图像序号/内容指纹；等待期间输入改变时丢弃迟到理解，编辑标题/OCR、替换/补充/移除图片时立即清空草稿，展示和采纳时也校验快照。
- 修改：`dsh-plugin/forward-step-dsh/src/client/index.ts`、构建产物 `dsh-plugin/forward-step-dsh/client.js`、`tests/dsh-plugin/client.test.mjs`。
- 回归覆盖正文/OCR 修改及图片替换后旧草稿不再展示；插件 Host/Client build 通过；Client、PPT、截图导入与包边界联合测试 126/126；插件相关套件 567/567；工作区 `pnpm test` 1677 通过、0 失败、1 跳过；`pnpm check` 与 `git diff --check` 通过。细节见 `docs/acceptance/forward-step-dsh/automation-rerun-2026-11-08.md`。
- 2026-11-08 后续增量：社媒运行时暂停已实现中止当前操作、等待收尾并保留已提交检查点；恢复不会自动采集。社媒/Host 定向测试 56/56、Host/Client build 与差异检查通过，详情见同一验收记录。真实平台适配及 GUI 未验收。
- PPT 成品导出保持冻结；真实 DSH GUI 与 Provider 效果仍待 Task 8.2 最终 GUI 验收。

### 2026-11-08 社媒运行中暂停与控制防重入补充

- `applySocialTaskAction` 对同一 taskId 的 pause/resume/cancel/skip-platform 动作串行化，防止快速重复点击造成 Host 状态竞态。暂停运行中搜索时中止当前请求并等待收尾，再保存 paused 状态；已完成检查点保留，恢复不自动采集。
- 验证：插件 Host/Client build 成功；`node --test tests/dsh-plugin/domain-workbenches.test.mjs tests/dsh-plugin/social-research.test.mjs` 56/56 通过；git diff --check 通过。
- Task 7.1 Step 2 保持未关闭：真实四平台授权采集/Host 运行态及 GUI 收据仍需补齐；平台 API 内部任意断点续传未实现。

### 2026-11-08 社媒中止按钮与操作类型对齐

- `domain-workbenches-panel.ts` 为运行中的任务动作记录操作类型；授权平台采集显示“取消当前平台采集”，公开网页搜索显示“取消公开搜索”，避免误把平台采集标成网页读取。同步更新契约测试。
- 插件 Host/Client build 成功；社媒/工作台定向测试 56/56 通过；`git diff --check` 通过。真实 DSH GUI 仍未验收。

### 2026-11-08 授权采集前刷新 Host 平台状态

- 授权平台采集入口每次运行前重新读取 Host 平台可用性；状态刷新失败时明确提示并停止，平台已不可运行时不调用采集器。同步更新工作台契约测试。
- 验证：插件 Host/Client build 成功；社媒/工作台定向测试 56/56 通过；`git diff --check` 通过。此逻辑强化插件侧状态校验，不替代 Host 运行时授权复核或真实四平台验收。

### 2026-11-08 授权刷新阶段并发/取消闭环

- 将授权采集运行锁和 AbortController 前移到 Host 授权状态刷新之前；刷新、确认和采集共享同一生命周期。暂停/取消若在刷新或确认期间到达，会等待当前操作清理完成，且不会在取消后启动采集。
- 验证：插件 Host/Client build 成功；社媒/工作台定向测试 56/56 通过；`git diff --check` 通过。真实 DSH GUI 与四平台授权运行态仍待验收。

### 2026-11-08 社媒失败平台重试入口

- 失败平台现在根据 Host 报告的可运行状态显示“确认并重试”；重试调用单平台授权采集入口，因此会刷新授权状态、展示本次预算与材料确认，并支持取消。未核验/未授权平台继续显示原因并保留跳过操作。
- 修改：`dsh-plugin/forward-step-dsh/src/client/domain-workbenches-panel.ts`、构建产物、`tests/dsh-plugin/domain-workbenches.test.mjs`。
- 验证：Host/Client build 成功；社媒/工作台定向测试 56/56 通过；`git diff --check` 通过。真实四平台授权采集仍须在 DSH Host/GUI 单独验收。

### 2026-11-08 PPT 图像变更时清理临时标注点

- 替换当前页配图、移除当前页配图或移除导入图片时，清除尚未保存的临时反馈定位点；替换/移除图片也会丢弃依赖旧画面的理解草稿，已保存反馈仍由内容快照标记过期。
- 修改：`dsh-plugin/forward-step-dsh/src/client/index.ts`、构建产物 `dsh-plugin/forward-step-dsh/client.js`。
- 验证：Host/Client build 成功；Client/PPT/截图导入测试 123/123 通过；`git diff --check` 通过。GUI 下临时定位点清除仍需最终手工复核。

### 2026-11-08 社媒授权采集预算耗尽保护

- 授权采集入口在刷新平台状态后检查剩余来源请求预算；预算耗尽时显示明确原因并在发起采集前返回。待准备页面隐藏超预算的直采按钮并显示预算状态；失败平台重试也要求预算仍有余量。
- 修改：`dsh-plugin/forward-step-dsh/src/client/domain-workbenches-panel.ts`、构建产物、`tests/dsh-plugin/domain-workbenches.test.mjs`。
- 验证：Host/Client build 成功；社媒/工作台定向测试 56/56 通过；`git diff --check` 通过。Host 核心仍执行权威预算校验；真实授权平台与 DSH GUI 仍待验收。

### 2026-11-08 已耗尽社媒计划的后续计划入口

- 已耗尽来源请求预算的任务现在可将主题、受支持平台、查询和现有预算复制到新计划表单；用户可检查/调整上限后创建独立待确认计划，旧任务、结果和预算不变。修正预算耗尽提示，指向实际可用的“复制为新计划并重新设预算”动作。
- 修改：`dsh-plugin/forward-step-dsh/src/client/domain-workbenches-panel.ts`、构建产物、`tests/dsh-plugin/domain-workbenches.test.mjs`。
- 验证：Host/Client build 成功；社媒/工作台定向测试 56/56 通过；`git diff --check` 通过。

### 2026-11-08 后续计划复制时说明未迁移的平台

- 预算耗尽计划复制到新计划表单时，新增明确提示列出未复制的历史/不支持平台；仅活动支持平台进入新计划选择，避免 Reddit/YouTube 等历史平台被误认为可运行。
- 修改：`dsh-plugin/forward-step-dsh/src/client/domain-workbenches-panel.ts`、构建产物、`tests/dsh-plugin/domain-workbenches.test.mjs`。
- 验证：Host/Client build 成功；社媒/工作台定向测试 56/56 通过；`git diff --check` 通过。

### 2026-11-08 后续计划复制后的表单定位

- 点击预算耗尽任务的“复制为新计划并重新设预算”后，工作台将自动平滑滚动到新计划表单；用户可立即复核主题、活动平台、查询和预算。
- 修改：`dsh-plugin/forward-step-dsh/src/client/domain-workbenches-panel.ts`、构建产物、`tests/dsh-plugin/domain-workbenches.test.mjs`。
- 验证：Host/Client build 成功；社媒/工作台定向测试 56/56 通过；`git diff --check` 通过。实际 DSH GUI 的滚动及焦点效果尚待最终验收。

### 2026-11-08 社媒跳过失败平台后的状态归并

- `skip-platform` 将失败平台标记为 `skipped` 后，按剩余失败/未运行平台重算任务状态：仍有失败时保留失败状态；无失败但有未运行平台时回到 `awaiting-platform-preparation`；所有平台均完成或跳过时进入 `report-ready`。跳过平台仍不计为采集成功。
- 验证：社媒核心与工作台定向测试 57/57 通过；插件 Host/Client build 通过。
- Task 7.1 Step 2 仍未关闭：四个平台真实授权采集适配、运行收据、恢复与真实 GUI 仍待核验。

### 2026-11-08 社媒授权批次完整性校验

- 核心在启动采集前一次性核验本次明确请求的全部平台；任一平台未核验或授权失效时整批拒绝，不先调用已可运行平台。Host/Client 仍支持用户明确选择单个平台运行。
- 回归覆盖混合状态下适配器调用数为 0，并将 Host 单平台集成用例改为显式传入 `platforms: ['weibo']`，与 Client 实际调用契约一致。
- 验证：社媒核心与工作台定向测试 58/58 通过；插件 Host/Client build 通过；`node --check` 与 `git diff --check` 通过。
- 真实四平台授权/采集适配、运行收据、恢复流程及 DSH GUI 仍未验收；Task 7.1 Step 2 不关闭。PPT 范围仍聚焦 PPTX/截图导入、逐页理解/标注和修改提示词，不扩展成品导出。

### 2026-11-09 PPT 模型理解与人工备注分离

- 页面模型理解改存独立的 `modelVisualDescription` 字段；“页面理解备注”继续只表示人工观察。逐页修改提示词分别标明两类来源，模型理解明确仍需用户核对；模型理解变化会让旧页面标注过期。
- 空模型字段不进入快照，保持旧数据快照字节结构不变；旧页面标注不会仅因升级被误判过期。
- 修改：插件副本的 `prototype/ppt-scene-schema.js`、`scripts/dsh-stage-core.mjs`、PPT Client 与 vendor 生成文件、PPT/Client/package 回归测试。同步修正已有 writing-pack history overlay 版本登记，使 staging 与包契约保持一致。
- 验证：`node scripts/dsh-stage-core.mjs` 生成 26 个核心文件；插件 Host/Client build 成功；`node --test tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/client.test.mjs tests/dsh-plugin/package.test.mjs` 122/122 通过。
- DSH GUI 和真实模型视觉效果本轮未运行；未扩展 PPT 成品导出。

### 2026-11-09 社媒遗留运行收据在任务列表即时恢复

- 新增纯函数 `recoverInterruptedSocialResearchTask`，统一把遗留 `running` 收据标记为 `interrupted`；授权采集续跑继续复用该逻辑。
- Host 首次读取社媒任务时，对当前 Host 未运行的计划执行并持久化恢复；同一 Host 仍在执行的任务保持 `running`，避免列表刷新误标。
- 修改：`dsh-plugin/forward-step-dsh/core/social-research.js`、`src/host-service.ts`、`lib/host-service.js`、`tests/dsh-plugin/domain-workbenches.test.mjs`。
- 验证：Host build 通过；社媒核心与工作台测试 60/60 通过；包边界测试 3/3 通过。
- Task 7.1 Step 2 仍不关闭：原应用采集适配依赖 Electron `BrowserWindow` 页面会话，已核验 DSH Host 当前只提供通用 Web 搜索/读取，尚无可迁移的授权浏览器服务。不得以公开搜索替代授权采集。真实 DSH GUI 与真实模型效果依旧留在 Task 8.2 Step 3/4。

### 2026-11-09 修正社媒跳过平台反馈文案

- 工作台跳过失败平台后，文案改为“该平台不计为采集成功”，与核心 `skipped` 状态及任务状态归并行为一致，不再错误显示仍失败。
- 修改：`dsh-plugin/forward-step-dsh/src/client/domain-workbenches-panel.ts`、构建产物 `client.js`、`tests/dsh-plugin/domain-workbenches.test.mjs`。
- 验证：Client build 通过；工作台与包边界测试 33/33 通过。

### 2026-11-09 PPT 逐页理解先保存当前页面草稿

- 点击“发送图像给模型理解”前，先将当前 PPT 页面、文字/OCR 和图像草稿保存到 Host；随后使用保存返回的任务修订号及同一份页面数据发起理解，避免 Host 读取旧图片或报图像缺失。
- 修改：`dsh-plugin/forward-step-dsh/src/client/index.ts`、生成产物 `client.js`、`tests/dsh-plugin/client.test.mjs`。
- 验证：Client build 通过；Client 与 PPT 定向测试 119/119 通过；包边界测试 3/3 通过；测试确认 Host 已先持久化对应图像且请求修订号匹配。

### 2026-11-09 限定 PPT 视觉理解的任务领域

- Host 的 `understandPptPage` 现在只接受 PPT 领域任务；即使其他领域任务意外带有 `methodState.ppt` 数据，也会在读取页面图像和调用模型前拒绝。
- 修改：`dsh-plugin/forward-step-dsh/src/host-service.ts`、生成产物 `lib/host-service.js`、`tests/dsh-plugin/ppt.test.mjs`。
- 验证：Host build 通过；PPT 定向测试 88/88 通过；包边界测试 3/3 通过。
### 2026-11-09 社媒采集时长预算闭环

- `core/social-research.js` 开始授权采集后按任务 `budget.maxDurationMs` 建立截止计时；到时后通过内部 AbortSignal 中止适配器，即使适配器忽略中止也会结束等待，并把当前平台记为 `failed/duration_limit_exceeded`。用户主动取消仍记为 `cancelled`，不会混淆为预算超时。
- 实际运行耗时累计写回 `usage.durationMs`；回归覆盖适配器忽略超时信号、失败收据、累计耗时及用户取消透传。
- 修改：`dsh-plugin/forward-step-dsh/core/social-research.js`、`tests/dsh-plugin/social-research.test.mjs`。
- 验证：社媒核心测试 31/31 通过；社媒核心、工作台与包边界联合测试 64/64 通过；插件 Host/Client build 通过；`node --check core/social-research.js` 通过。
- 此代码补齐预算执行，不代表四平台真实授权采集适配已接通；Task 7.1 Step 2 仍待真实 DSH 采集服务与授权运行证据。


### 2026-11-09 自动化门修复与真机验收交接

- 修复 Host 视觉理解能力状态漏报，以及迁移预览/提交未拒绝无效 `acceptedVersion` 和超限历史的问题；详细改动、命令、结果与退出码见 `docs/acceptance/forward-step-dsh/continuation-verification-20261109.md`。
- 验证：Host/迁移定向测试 36/36；插件全测 571/571；计划集成测试 575/575；工作区 `pnpm check` 通过；工作区 `pnpm test` 1685 通过、1 跳过、0 失败；插件 Host/Client build 通过。
- 可自动化验收已完成。Task 7.1 Step 2 的真实授权采集适配与恢复证据、Task 8.2 Step 3/4 的真实 DSH GUI/Provider 效果和最终差距审计仍未完成；进入真机 GUI 验收前需具备隔离 DSH 会话，不能以自动化结果代替运行态验收。

### 2026-11-09 社媒附件备份恢复引用校验

- 插件备份恢复现在校验社媒任务和来源结果引用的附件都存在于同一任务的已验证附件索引；来源结果引用还必须与附件记录的 `resultId` 一致。悬空、跨任务、跨结果或未验证引用在预览/恢复前拒绝，避免恢复出不可读附件。
- 修改：`dsh-plugin/forward-step-dsh/core/backup.js`、`tests/dsh-plugin/backup.test.mjs`。
- 验证：插件 Host/Client build 通过；`node --test tests/dsh-plugin/backup.test.mjs` 10/10 通过；`git diff --check` 通过。
- Task 7.1 Step 2 仍未关闭：真实平台授权采集适配及真实运行收据尚缺；Task 8.2 Step 3/4 仍待真机 GUI 和真实 Provider 效果验收。

### 2026-11-09 插件备份导出附件归属校验

- 插件 ZIP 导出前复用恢复端附件引用校验；附件必须是已验证记录，属于同一社媒任务，且结果引用必须对应同一来源，防止导出损坏附件归档。
- 修改：`dsh-plugin/forward-step-dsh/core/backup.js`、`tests/dsh-plugin/backup.test.mjs`。
- 验证：插件 Host/Client build 成功；备份测试 10/10 通过；`git diff --check` 通过。
- 剩余 GUI/真实 Provider 项按计划保持未运行；真实社媒授权采集仍缺 DSH Host 运行态适配证据。

### 2026-11-10 接通 DSH Browser 四平台采集适配器

- 插件入口现在优先使用既有 `socialResearch` Host 服务；未注入时从可选 `browser` 服务创建 DSH Browser 适配器，支持小红书、哔哩哔哩、微博和知乎。Host 状态归一化保留适配器可用性及唯一 profile 配置状态，使查询、运行门和 Host 状态一致。
- profile 配置只代表域名授权配置存在，不标记已登录、已授权或适配已核验；采集前仍要求明确确认，运行时检查站点状态，失败及零结果不再反馈为成功。Browser 不可用时沿用旧 Host 兼容行为。
- 修改：插件副本的 `dsh-plugin/forward-step-dsh/index.js`、`core/dsh-browser-social-research.js`、`core/social-research.js`、`src/host-service.ts`、`src/client/domain-workbenches-panel.ts`、生成产物 `lib/host-service.js` / `client.js`、社媒与 Host 接入测试、插件 README。
- 验证：Host/Client build 成功；插件入口装配 DSH Browser 并完成微博合成查询及运行结果持久化回读；全插件测试 581/581 通过，最终变更后社媒/Host/Browser 定向测试 69/69 通过，打包边界测试通过。
- 尚未完成：四个平台的隔离 DSH GUI 登录、验证码/限流处理及真实页面结果验收；自动化合成结果不代表真实平台运行已通过。本记录更新并取代此前“采集适配尚未接通”的实施缺口判断。
