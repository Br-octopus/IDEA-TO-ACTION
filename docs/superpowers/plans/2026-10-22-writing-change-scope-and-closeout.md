# 写作改动隔离与验收收口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不覆盖主工作区现有改动的前提下，整理出可独立审阅的写作功能改动范围，并按现有设计与验收记录准确收口。

**Architecture:** 以 `D:\VScode\项目\提示词工具` 当前主工作区为本地代码准据；先按文件和 diff 块清点写作、非写作及混合改动，再只对写作范围做差异审阅和对应验证。沿用已有分领域实施计划与验收记录，不复制或覆盖历史证据；原生桌面、专业审查和分发版等需外部操作的缺口继续标为未验收。

**Tech Stack:** Git for Windows、PowerShell 7 (`pwsh.exe`)、Node.js、pnpm、原生 JavaScript、Electron、仓库现有测试和构建脚本。

---

## 范围与约束

- 代码来源准据：`D:\VScode\项目\提示词工具` 当前工作区文件。它位于本地 `main`，但远端未 fetch；本计划不声称本地为远端最新。
- 本计划只整理写作改动，不合并、不提交、不推送、不做真机测试。
- 不重置、不覆盖、不清理当前 tracked 或 untracked 改动；不改 Git index，不执行 `git add`。
- `docs/superpowers/plans/2026-10-22-writing-domain-expansion-completion-implementation.md` 是已有总补缺计划。本文件只规定写作差异的隔离审阅与阶段收口，具体领域行为继续以已有规格、实施计划及验收记录为准。
- 社媒研究、PPT 和其他功能改动不纳入写作交付范围。共享文件必须逐个 diff 块审查，不能因为其中含写作代码就整文件纳入。
- “浏览器开发版路径已通过”不代表 Electron、Windows 安装/便携版、真实来源专业性或模型效果已通过。

## 文件范围图

### 写作专属实现与测试

- `prototype/writing-workbench-coordinator.js`：写作任务协调、提示词和项目流程。
- `prototype/writing-workbench-prompts.js`：通用写作提示词组织。
- `prototype/writing-workbench-schema.js`：写作数据结构与兼容归一化。
- `prototype/writing-workbench-ui.js`：写作工作台交互。
- `prototype/writing-pack-catalog.js`、`prototype/writing-pack-coordinator.js`、`prototype/writing-pack-schema.js`、`prototype/writing-pack-ui.js`：专业基础包目录、业务逻辑、数据结构和管理界面。
- `prototype/writing-material-coverage.js`：写作资料覆盖、范围和批次状态。
- `prototype/academic-literature.js`、`prototype/academic-literature-ui.js`：学术文献工作台能力。
- `prototype/academic-publishing.js`、`prototype/academic-publishing-coordinator.js`、`prototype/academic-publishing-ui.js`：投稿和发表准备流程。
- `prototype/academic-review.js`、`prototype/academic-review-coordinator.js`、`prototype/academic-review-ui.js`：学术审查与问题复核流程。
- `server/writing-material-parser.js`：写作材料解析服务。
- 对应测试：`tests/writing-*`、`tests/academic-*.test.js`、`tests/writing-material-parser.test.js` 及明确仅服务于这些模块的 helper。

### 需要逐块审查的共享文件

- `prototype/app.js`、`prototype/index.html`：写作工作台接线与其他产品功能共处，按 diff 块筛选。
- `electron/main.js`、`electron/preload.js`：包含写作目录/材料能力，也包含社媒等桌面能力，按 IPC 与调用链逐块筛选。
- `server.js`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`：可能包含写作解析端点、依赖和工作区改动，也包含其他功能；逐项确认引用方。
- `prototype/storage.js`、`prototype/workspace-backup.js`、`electron/workspace-backup-archive.js`：写作持久化与备份字段可能和其他工作区数据同时演进，必须核对白名单和兼容行为。
- `tests/e2e-smoke.test.js`、`tests/electron-smoke.test.js`、`tests/storage.test.js`、`tests/workspace-backup.test.js` 及通用 helper：只选择能明确归因于写作需求的 diff 块。
- README 与写作设计/计划/验收文档只纳入写作专属章节或文件；社媒、PPT 文档排除。

### 明确排除

- 社媒研究实现、MediaCrawler、平台浏览器适配、社媒 API 与注册表文件及其专属测试。
- PPT 场景实现与 PPT 专属设计、测试。
- `.codex-acceptance/`、`.playwright-mcp/`、`release-*`、`vendor/` 等本地验收或构建目录，除非某个被跟踪的源文件本身明确属于写作且计划要求随代码交付。
- 任何未能从调用关系、设计条款和测试用途确认归属的共享改动；先列为“待判定”，不得猜测纳入。

## Task 1：建立不改工作区的差异清单

**Files:**
- Read: Git 当前分支、HEAD、tracked diff 与 untracked 文件列表。
- Create: `docs/superpowers/plans/2026-10-22-writing-change-scope-and-closeout.md`（本计划）。

- [ ] **Step 1: 记录工作区基线**

运行：

```powershell
git status --short --branch
git rev-parse --show-toplevel
git log -1 --oneline
```

预期：确认仓库根目录、当前分支和 HEAD；只记录结果，不切换分支或改写文件。

- [ ] **Step 2: 导出 tracked 改动路径供审阅**

运行：

```powershell
git diff --name-only
git diff --cached --name-only
```

预期：列出工作区和暂存区路径；本任务不执行暂存操作，若原先已有 staged 文件，保持原样并单独标注。

- [ ] **Step 3: 单独盘点 untracked 文件**

运行：

```powershell
git ls-files --others --exclude-standard
```

预期：将写作源码、写作测试、写作计划/验收记录、非写作文件和生成物分组；不移动或删除任何文件。

- [ ] **Step 4: 为混合文件记录逐块归属**

运行：

```powershell
git diff -- prototype/app.js prototype/index.html electron/main.js electron/preload.js server.js package.json pnpm-lock.yaml prototype/storage.js prototype/workspace-backup.js
```

预期：每个 diff 块记录对应设计/计划条目、调用方和测试；无法确认的块标记“待判定”，不将整文件视作写作改动。

## Task 2：核对写作交付项和当前证据

**Files:**
- Read: `docs/superpowers/specs/2026-10-20-writing-domain-expansion-design.md`
- Read: `docs/superpowers/plans/2026-10-22-writing-domain-expansion-completion-implementation.md`
- Read: 各领域 `*-implementation.md`、`*-acceptance.md`、`*-spec.md`。
- Modify: `docs/superpowers/plans/2026-10-22-writing-change-scope-and-closeout.md`。

- [ ] **Step 1: 以总补缺计划“当前状态”和最新续验条目为索引**

运行：

```powershell
Select-String -Path docs/superpowers/plans/2026-10-22-writing-domain-expansion-completion-implementation.md -Pattern '^## 当前状态','^### 续作状态修订','^### 当前交付判定','未完成','仍需','待补'
```

预期：建立明确的待办清单；较早记录若与后续续验冲突，以带日期的后续证据为准，不改写历史段落。

- [ ] **Step 2: 对照总设计要求，不用代码存在替代行为证据**

核对设计稿 D01–D20、A01–A25 与相应领域规格；每项标记为“代码已具备”“开发版应用有证据”“部分”“待验证”之一，并引用对应验收记录的小节。

预期：至少显式保留以下未验收边界：学术 C/D Electron 路径、原生授权目录资料批处理完整路径、基础包来源/许可/案例专业审查、Windows 安装/便携版运行、真实模型效果。真机维持暂缓。

- [ ] **Step 3: 核对可在本地继续实施的未完成代码项**

从总补缺计划“续作：基础包契约与版本生命周期”逐项复核基础包单条规则编辑/启停、方法卡字段、修改后验证状态降级、内置包版本差异/接受更新、来源追溯字段、包历史快照，以及常规材料相关性推荐。

预期：每项必须由当前代码和对应定向测试证明；若未满足，记录精确模块、函数/DOM 入口和所需回归；若已满足，保留证据，不重复实现。

## Task 3：形成可独立审阅的写作差异

**Files:**
- Read: Task 1 分类后的 tracked/untracked 清单与 diff 块归属。
- Create: 工作区外的审阅清单或 patch 文件；不得覆盖项目内已有文件。
- Modify: `docs/superpowers/plans/2026-10-22-writing-change-scope-and-closeout.md`。

- [ ] **Step 1: 输出文件级写作清单**

清单逐项包含路径、状态（tracked 修改 / untracked 新增）、职责、对应设计或阶段、验证文件。共享文件必须标记“仅部分 diff 块”。

预期：审阅者能据清单定位写作交付，不会把社媒、PPT、构建缓存或本地验收数据误当成写作源代码。

- [ ] **Step 2: 为混合文件建立逐块选择依据**

对 `prototype/app.js`、`electron/main.js`、`server.js`、依赖文件、存储/备份和通用测试，逐块写出写作归属依据；对依赖变更注明写作调用点和锁文件对应项。

预期：无依据的差异仍标“待判定”；不以整文件路径匹配代替内容审阅。

- [ ] **Step 3: 保持源工作区与 index 原样**

检查：

```powershell
git status --short --branch
git diff --cached --name-status
```

预期：与 Task 1 基线对比，无文件被覆盖/删除，无新增暂存项；本步骤不执行 `git add`、`git reset`、`git checkout` 或 `git clean`。

## Task 4：完成剩余可本地验证的写作代码闭环

**Files:**
- Modify only after Task 2 confirms a failing requirement: `prototype/writing-pack-catalog.js`、`prototype/writing-pack-coordinator.js`、`prototype/writing-pack-schema.js`、`prototype/writing-pack-ui.js`、`prototype/writing-material-coverage.js` 及其对应模块。
- Test: `tests/writing-pack-*.test.js`、`tests/writing-material-coverage.test.js`、对应写作工作台测试。
- Read: 根目录 `package.json` 中现有验证脚本。

- [ ] **Step 1: 对每个未满足行为先添加对应回归**

测试必须覆盖用户可观察结果和历史兼容性。例如停用包内单条规则后，新提示词不含该规则，而既有轮次快照仍能引用原条目；更新内置包前显示差异，用户确认后只影响新轮；相关材料推荐记录理由并允许手动改选。

预期：运行对应单测时，新回归先失败在缺少的行为上，而不是因测试环境或 fixture 错误失败。

- [ ] **Step 2: 只实现已由设计要求且回归失败证明的最小缺口**

遵循现有 schema/coordinator/UI 分工和原生 JavaScript 实现方式；不新建通用插件框架，不顺手重构与缺口无关的模块。

预期：实现仅改变对应行为，旧项目/旧轮次兼容测试仍通过。

- [ ] **Step 3: 运行本阶段定向验证**

运行对应写作测试文件，例如：

```powershell
node --test tests/writing-pack-schema.test.js tests/writing-pack-catalog.test.js tests/writing-pack-coordinator.test.js tests/writing-pack-ui.test.js tests/writing-material-coverage.test.js
```

预期：全部通过；若仓库脚本或测试运行器与示例不符，先依据 `package.json` 选用现有脚本，不新增工具链。

- [ ] **Step 4: 运行阶段静态检查**

运行：

```powershell
pnpm check
git diff --check
```

预期：检查通过；行尾提示如来自既有改动需如实记录，不通过全文件换行转换制造额外差异。

## Task 5：应用与外部验收收口

**Files:**
- Read and update only with new evidence: 对应领域 `*-acceptance.md` 与总补缺计划。
- No product-code changes unless an observed defect maps to a requirement and is fixed in Task 4.

- [ ] **Step 1: 执行当前可用的隔离浏览器验收**

按各阶段验收记录中的既有地址、隔离上下文和合成数据流程复验尚缺的浏览器路径；不得触碰用户其他浏览器上下文项目。

预期：记录操作路径、关键 UI 状态、保存/恢复行为、页面错误和证据文件；浏览器证据只支持浏览器开发版结论。

- [ ] **Step 2: 将依赖系统模态框的 Electron 项目标为需桌面交互**

授权目录原生选择器、学术 C/D Electron 主路径、当前 Windows 安装版/便携版运行，分别列出用户可执行步骤和预期状态；不以模拟 `desktopApi` 或成功构建代替实际运行证据。

预期：无桌面控制能力时保持“待用户桌面验收”，不启动冲突服务，不把该项改成通过。

- [ ] **Step 3: 记录专业审查所需逐项证据**

对每个基础包来源列出具体来源文件/规范条款、固定版本或摘要、访问日期、许可、适用范围、限制、采用理由与验证状态；没有确认的字段保持未核验，真实案例未审阅时不标成案例验证。

预期：只更新实际检查过的条目，不批量提升状态字段。

- [ ] **Step 4: 复核真机限制和阶段结论**

真机测试保持暂缓；更新验收记录时写明开发版/Electron/分发版层级、真实与合成材料边界、模型是否实际调用。

预期：只有本轮确有新证据的项目才更新状态；未完成项仍留在总矩阵中。

## Task 6：最终审阅与停点

**Files:**
- Review: 本计划中列出的写作专属文件和混合文件写作 diff 块。
- Update: 对应写作验收记录、总补缺计划；不修改非写作验收记录。

- [ ] **Step 1: 运行最终写作回归与静态检查**

运行所有本轮改动所影响的写作测试文件，再运行 `pnpm check` 和 `git diff --check`。

预期：报告准确的通过/失败/跳过数量；本轮未触碰的无关领域不宣称已回归。

- [ ] **Step 2: 审阅写作差异边界**

逐项比对 Task 1 基线和最终差异清单；确认非写作内容未混入写作交付清单，混合文件只列已审阅的写作块，所有原有改动仍存在。

预期：Git index 未因本计划改变；无提交、合并、推送或真机测试。

- [ ] **Step 3: 到应用可验收点停止**

当本机可完成的写作实现、相应定向验证与浏览器开发版关键路径达到验收范围，并把桌面/专业/分发版剩余项写清后停止。不得为了消除外部验收缺口而虚报完成。

预期：最终结论分别说明“本机代码”“浏览器开发版应用验收”“Electron/Windows/专业审查”；并说明远端状态未核验，当前计划没有上传动作。

## 依赖顺序

`Task 1` → `Task 2` → `Task 3` → `Task 4` → `Task 5` → `Task 6`。Task 4 只处理现状核对后证实仍缺失的代码项；Task 5 中依赖系统桌面交互或专业人员判断的项目可并行整理用户验收清单，但不能阻塞已可完成的本地工作。

## 本计划明确不代表

- 不表示当前所有写作设计要求均已实现或验收通过。
- 不表示当前本地 `main` 与远端 `origin/main` 同步；远端需在未来明确安排上传时再 fetch 核对。
- 不表示写作改动已从共享文件中物理拆出、暂存、提交或推送。
- 不包含真机测试；按用户要求暂缓。
