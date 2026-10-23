# 写作与 PPT 功能拆分提交、合并和推送计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 每个功能使用独立分支和 PR，先写作、后 PPT；不得将 D 盘主工作区的混合改动整体提交或推送。

**Goal:** 先补齐并验证写作与 PPT 设计稿中可在本机完成的代码和应用路径，再分别提交、上传并合入远端 `main`，最后在不丢失现有工作的前提下让 D 盘主工作区可使用这两项功能。

**Architecture:** D 盘 `main` 是当前本地实现和验收证据来源，但不是可直接整包推送的提交来源；远端 `origin/main` 是交付基线。先建立隔离交付工作树，逐提交、逐文件、逐 hunk 提取并补齐写作代码缺口，完成写作设计矩阵可由本地证明的验收；随后在写作合并后的最新远端主线之上处理 PPT，按三份 PPT 计划和设计稿补齐本地可实现缺口并验证应用路径。写作与 PPT 使用两个 PR；远端合并完成后，再独立、安全地把可验收组合版带入 D 盘应用工作区。

**Tech Stack:** Git、GitHub CLI (`gh`)、pnpm、Node.js `node:test`、Electron。

---

## 当前核对基线（2026-10-22）

- 远端 `main` 经 `git ls-remote` 核实为 `a7a18bd09cb2cbb0981e7f512a5e883ad359388e`，即国内社媒 PR #1 的合并提交。
- D 盘 `main` 为 `cf8904e2f90b693ed0cf733e5c55e54fb74e1cef`；与本地记录的 `origin/main` 共同祖先 `ffd38e4` 相比，D 盘有 30 个本地提交，而远端另有 1 个社媒提交。D 盘工作区同时有大量已跟踪修改和未跟踪文件。
- D 盘本地 30 个提交主要属于写作工作台，但差异触及 `prototype/ppt-scene-*`、社媒 UI、Prompt Agent、Electron 主进程、存储、文档及测试等共享文件，不能仅按提交标题或目录名直接整段推送。
- 写作基础包已有独立历史：`1799857..e6e0ed2`；`writing-foundation-packs-run` 工作树在 `e6e0ed2` 上另有 3 个未提交文件差异。D 盘也有相应未跟踪文件及写作/社媒/PPT混合改动，需比较内容后选定单一来源。
- PPT 隔离工作树当前为 detached `92952bd`，从 `d8ae988` 分叉并包含 19 个后续提交；它与远端 `main` 共享更早的基线，PPT 修改集中在 PPT 模块，但也改动 Electron、应用入口、共享 Prompt Agent、存储、README 与通用测试。
- PPT 最终对话 `codex://threads/01a159ce-9537-7322-8316-4bf2503ef131` 的结论是暂缓直接合并 D 盘主线。此计划把“远端 PR 合并”和“D 盘本地工作区更新”分开处理；后者在完成脏工作区处置前不得执行。
- 本计划只管写作和 PPT。国内社媒已由 PR #1 合入远端，不重复提取或提交社媒功能。

## 文件与职责

| 路径/来源 | 计划中的用途 |
|---|---|
| `docs/superpowers/plans/2026-10-22-writing-change-scope-and-closeout.md` | 写作差异归属、共享文件筛选和现有交付约束的主要依据 |
| `docs/superpowers/plans/2026-10-22-writing-domain-expansion-completion-implementation.md` 及写作验收记录 | 确认写作提交应携带的最新实现、证据和明确待验项 |
| `C:/Users/Alarm/.codex/worktrees/writing-foundation-packs-run/提示词工具` | 写作基础包已提交代码及 3 个后续 UI/测试改动的候选来源 |
| `C:/Users/Alarm/.codex/worktrees/ppt-scene-implementation/提示词工具` | PPT 提交历史和实现来源；保持原工作树不切分支、不覆盖 |
| `docs/superpowers/plans/2026-10-20-ppt-content-planning.md` | PPT 规划功能范围、测试和应用验收清单 |
| `docs/superpowers/plans/2026-10-20-ppt-source-research.md` | 来源搜索、材料解析和授权边界清单 |
| `docs/superpowers/plans/2026-10-20-ppt-visual-feedback.md` | HTML/图片预览、标注、隔离和反馈流程清单 |
| `docs/superpowers/specs/2026-10-20-ppt-scene-design.md` | PPT PR 的最终功能验收基准 |
| 新建的写作与 PPT 功能分支 | 只承载经核对的功能提交；各自从执行时最新的 `origin/main` 建立 |

## 阶段 1：冻结来源清单并建立可回退的交付副本

**Files:** 不改 D 盘产品文件；记录 Git 状态和提交清单。

- [ ] **Step 1: 再核对远端、主工作区与功能工作树。**

运行：

```powershell
git ls-remote origin refs/heads/main
git status --porcelain=v1
git log --reverse --format="%H %s" ffd38e4..main
git -C "C:/Users/Alarm/.codex/worktrees/writing-foundation-packs-run/提示词工具" status --short --branch
git -C "C:/Users/Alarm/.codex/worktrees/ppt-scene-implementation/提示词工具" status --short --branch
```

预期：记下新的远端 SHA；确认 D 盘原始改动仍在；确认写作基础包的 3 个未提交文件和 PPT 来源状态没有被其他操作改变。远端已前进时，所有新功能分支改从最新远端 SHA 建立。

- [ ] **Step 2: 为交付建立独立工作树。**

为写作和 PPT 各建一个基于执行时最新 `origin/main` 的 Git worktree，分支名分别为 `codex/writing-scoped-delivery` 和 `codex/ppt-scoped-delivery`。不要在 D 盘 `main` 执行 `checkout`、`reset`、`stash`、`merge` 或 `pull`。

预期：新工作树干净，D 盘状态与 Step 1 完全一致；若分支名已存在，先检查其提交和工作树归属，续用合适的现有分支或改用新名称，不覆盖旧分支。

- [ ] **Step 3: 对 D 盘工作区和既有验收产物做只读清点。**

逐一记录跟踪文件差异、未跟踪文件和 `release-retry*`、`.codex-acceptance/`、`.playwright-mcp/` 等本地生成目录。只将功能实现、对应测试及必要设计/验收文档列入候选；运行产物、缓存、虚拟环境、临时页面、截图和社媒独有文件列入排除表。

预期：形成写作候选、PPT 候选、共享文件候选和排除项四份清单；不修改或删除来源文件。

## 阶段 2：先完成写作可交付性收口

**Files:** 以 `docs/superpowers/plans/2026-10-22-writing-domain-expansion-completion-implementation.md` 和写作各阶段规格/验收记录为依据；只在隔离写作交付 worktree 修改经确认缺失的写作代码及对应测试。

- [ ] **Step 1: 建立写作设计要求与现有证据矩阵。**

对照总设计 D01–D20、A01–A25、领域规格及最新验收记录，逐项标记“代码有测试”“开发版应用有证据”“部分通过”“外部待验”。以后追加的日期较新的验收记录优先于早期状态；保留真机测试暂缓要求。

预期：矩阵至少覆盖基础包/来源、材料导入与覆盖、学术 A–D、结构化文档、视听社媒和长篇创作，并能定位到实现文件、测试或验收记录；代码存在不自动记为应用通过。

- [ ] **Step 2: 复核并补齐已知可本地实现的基础包缺口。**

先检查 `prototype/writing-pack-schema.js`、`prototype/writing-pack-catalog.js`、`prototype/writing-pack-coordinator.js`、`prototype/writing-pack-ui.js` 与对应 `tests/writing-pack-*.test.js`，逐项核对总补缺计划记录的规则单条编辑/启停、编辑审查后状态降级、内置包版本差异与用户接受更新、来源固定版本/摘要/读取日期/采用理由/审查记录、历史快照，以及至少一个可复用核心包和一个有适用边界的专项包。只对证实缺失的行为补回归并实现。

预期：每项有明确测试名与可观察断言；修改规则内容会使该规则验证状态降为 `unverified`，仅改展示元数据不降级；接受内置更新只影响后续新轮，旧轮仍保留原规则快照；自定义副本不会被静默覆盖。

- [ ] **Step 3: 补齐常规材料的任务相关性推荐。**

检查 `prototype/writing-material-coverage.js`、`prototype/writing-workbench-coordinator.js`、`prototype/writing-workbench-ui.js` 与 `tests/writing-material-coverage.test.js`。推荐必须根据任务目标和材料元数据/可用摘要给出可解释理由，保留用户手动改选；无可用材料时明确显示空结果，不能把固定前三项描述成语义相关。

预期：定向回归覆盖相关排序、理由显示、用户覆盖自动推荐以及无摘要/不可用材料状态；不把模型估算的相关度伪装成经核实事实。

- [ ] **Step 4: 修复其他矩阵中证据确认的本地代码缺口。**

对矩阵标为“未实现”的其他项，只在设计条款和当前应用路径能定位具体缺失行为时补充最小回归与实现；“待 Electron 人工操作”“待真实专业审核”“待真实模型/解析服务”归入外部验收，不为消除状态文字而造模拟功能。

预期：每项代码修复都对应至少一条先失败、后通过的定向测试；没有新发现代码缺口时记录审查结论并直接进入验证。

- [ ] **Step 5: 完成写作代表应用路径并更新证据。**

在隔离开发应用中按各阶段验收记录使用合成项目验证未完成的可操作路径，至少覆盖写作任务创建、基础包选择及提示词消费、结果回带与问题复核、保存/刷新恢复、材料用途分流和覆盖状态；复用现有隔离浏览器/Electron验收方式，不触碰用户日常数据。

预期：记录应用版本/入口、输入与操作步骤、提示词关键内容、保存恢复状态、页面/控制台错误和证据文件；系统原生选择器、学术 C/D Electron、完整键盘路径等无法从浏览器证明的项目仍标为待验。

- [ ] **Step 6: 运行写作专项回归并冻结待验边界。**

运行受影响的写作模块测试，以及 `pnpm check` 和 `git diff --check`。更新对应验收记录和总完成矩阵，只把有本轮证据的项目标为通过；保留专业来源许可/案例审阅、原生目录授权完整闭环、真实模型、Electron/Windows 分发版、真机等未验证项。

预期：写作交付 worktree 的工作区仅含可归属的写作实现、测试和必要证据文档；真机仍暂缓；没有以浏览器、模拟 API 或构建成功冒充原生应用/专业验收。

## 阶段 3：整理并交付写作 PR

**Files:** 仅选择写作实现、写作测试、写作规格/验收文档及经过 hunk 审阅的共享文件。

- [ ] **Step 1: 逐提交审阅本地写作历史。**

检查 `ffd38e4..cf8904e` 中每个提交的完整文件清单和差异。为每个提交标注为“写作专属”“共享文件中的写作 hunk”“带入会扩大范围的混合提交”之一。不得仅因 30 个提交此前被概括为写作相关，就跳过逐项审阅。

预期：得到可重放的提交列表；对混合提交只通过 patch/hunk 提取写作改动，保留其余内容在来源工作区。

- [ ] **Step 2: 审阅基础包代码和三处后续工作区改动。**

比较 `1799857..e6e0ed2` 的提交内容、`writing-foundation-packs-run` 工作树的 3 文件差异，以及 D 盘对应未跟踪文件/差异。确认基础包契约、界面接入、备份、测试和 2026-10-22 续验修复均来自同一份最新实现；重复差异只保留一份。

预期：基础包功能在写作交付分支中完整且可追溯；未采纳的工作区内容仍留在原处，不被清理。

- [ ] **Step 3: 将已审阅的写作提交与补丁应用到写作分支。**

在写作交付 worktree 中按依赖顺序重放写作专属提交，再应用通过审阅的写作共享 hunks。每次只处理一个提交/补丁；冲突文件逐段比较 `origin/main` 社媒版本、D 盘写作版本和 PPT 基线，不能用整文件覆盖解决。

预期：新分支只含写作需求及其必须的通用依赖；`git diff --name-only origin/main...HEAD` 与书面候选清单一致。

- [ ] **Step 4: 选择性暂存并复核写作提交范围。**

用明确路径和交互式 hunk 暂存，只纳入本次审阅通过的内容；暂存后运行：

```powershell
git diff --cached --check
git diff --cached --stat
git diff --cached --name-status
```

预期：没有社媒独有实现、PPT 反馈模块或构建/验收产物；共享文件中的非写作 hunks 没有进入暂存区。发现边界不清的块时先退回候选清单复审，不提交。

- [ ] **Step 5: 在写作分支运行定向回归和静态检查。**

先按最新 `package.json` 运行写作工作台、基础包、资料覆盖/解析、学术与结构化/视听/长篇相关的定向测试，再运行：

```powershell
pnpm check
git diff --check
```

预期：记录每个测试命令的通过/失败/跳过数量；写作功能相关失败必须修复后再继续。完整套件中明确属于远端既有基线的失败要在 PR 描述中引用可复现证据，不得把本地失败静默忽略。

- [ ] **Step 6: 提交写作功能并推送分支。**

提交信息使用中文 Conventional Commit，例如 `feat: 完成写作工作台扩展`。提交前再次核对暂存清单；提交后确认 D 盘及其他工作树状态未变化。然后执行：

```powershell
git push -u origin codex/writing-scoped-delivery
```

预期：只推写作交付分支，不推送本地 `main`，不使用强推。

- [ ] **Step 7: 创建并检查写作 PR。**

创建目标为 `main` 的 PR，正文逐项说明功能范围、主要证据、测试命令、未完成桌面/专业验收边界和排除的混合改动。检查 PR base/head、文件清单、差异、GitHub 检查和 mergeability。

预期：PR diff 只呈现写作功能；远端 `main` 未出现新的并发提交时才继续合并。若 `main` 已更新，先将该 PR 分支基于最新 `origin/main` 更新并重跑受影响验证。

- [ ] **Step 8: 合并写作 PR 并确认远端结果。**

通过所有要求的检查后，以 squash 方式合并；随后 fetch 并确认远端 `main` 包含写作合并提交、PR 状态为 `MERGED`，且提交文件范围与 PR 审阅一致。

预期：写作内容已进入远端主线；不据此宣称 Electron/Windows 安装版、专业来源或真实模型效果已验收。

## 阶段 4：整理并交付 PPT PR

**Files:** PPT schema/workflow/prompts/coordinator/UI、来源研究、反馈与 Electron 安全读取模块、相关测试及 PPT 文档。

- [ ] **Step 1: 从最终 PPT 来源逐提交列出候选。**

检查 PPT worktree `d8ae988..92952bd` 的提交，并以最新远端 `main` 与源分支共同祖先重新计算 PR 差异。将 PPT 专属提交、共享 Prompt Agent/Electron/存储 hunk、已由远端具备的基线和不应重复纳入的写作/社媒内容分别记录。

预期：来源提交均能映射到 `2026-10-20-ppt-scene-design.md` 或三份 PPT 计划的具体条款；公共依赖已由远端主线提供，不复制旧版本覆盖新实现。

- [ ] **Step 2: 先核对曾记录的 5 个资料研究问题。**

在当前 PPT 代码和 `tests/ppt-source-research.test.js` 中逐项核验：必查来源能进入候选；预算中断保留当前未完成批次；默认批次遵守每阶段最多 3 条摘要；发送预览含范围和进度；来源排序因子有回归测试。已修复的缺口注明对应实现与测试；仍复现的缺口先在 PPT 源工作树修复并补回归，再纳入候选补丁。

预期：5 项均有“实现位置+测试名称+结果”或明确的未解决记录；不得把旧审查结论直接当成现状。

- [ ] **Step 3: 核对设计稿、实施计划与现有验收证据，并修复本地代码缺口。**

逐项对照 PPT 设计稿首版验收标准 1–16 及三份计划，检查每条要求是否有实际入口、数据/错误边界、定向测试和应用操作证据。计划复选框仅在证据可定位时更新；发现可本地实现的缺口时，在 PPT 交付 worktree 先补失败回归、实现最小修复并重跑相关测试。无法由自动化证明的 Electron 原生窗口、真实网页权限和人工视觉检查继续标成待桌面验收。

预期：三份计划和设计稿反映真实状态，不把计划落后误报为功能缺失，也不把有代码误报为应用已验收；本地可实现缺口在移植 PR 前已关闭并有回归结果。

- [ ] **Step 4: 将 PPT 专属提交和补丁移植到最新主线分支。**

在 PPT 交付 worktree 中从写作 PR 合并后的最新 `origin/main` 建分支。按提交依赖重放 PPT 独有提交，再选择性移植共享文件 hunk。冲突时保留已合入的社媒和写作行为，仅合入 PPT 必需逻辑；不以 `--ours`/`--theirs` 整文件替代，也不改 D 盘源工作区。

预期：差异只包含 PPT 功能及必要共享接线；写作 PR 已合入内容仍在基线中，PPT 旧分支的通用文件不会倒退远端实现。

- [ ] **Step 5: 运行 PPT 专项和跨模块验证。**

运行 PPT schema、workflow、prompts、coordinator、UI、来源 schema/研究、反馈 schema/UI/integration、Electron source reader/preview、安全 smoke、storage 和 package 配置测试；再运行：

```powershell
pnpm check
git diff --check
```

预期：记录完整计数；修复本 PR 引入的失败并重跑对应范围。浏览器能证明的路径按现有隔离验收方式复验；系统文件选择器、Electron 原生预览、拒绝外网请求和用户授权路径若当前不能操作，只列出准确的待验步骤，不伪造通过。

- [ ] **Step 6: 选择性提交并推送 PPT 分支。**

逐项核对暂存文件不含写作独有差异、社媒实现、release 目录、缓存或验收临时文件。提交中文 Conventional Commit，例如 `feat: 完成 PPT 资料与视觉反馈工作台`，随后执行：

```powershell
git push -u origin codex/ppt-scoped-delivery
```

预期：只推 PPT 分支，无强推。

- [ ] **Step 7: 创建并审核 PPT PR。**

创建目标为 `main` 的独立 PR；正文列出三份计划各自完成的部分、设计矩阵状态、定向测试、Electron/人工验收限制及不包含的写作/社媒内容。确认 PR base 为当前 `main`，没有丢失社媒或刚合入的写作改动。

预期：PR 文件列表和运行时依赖范围均为 PPT 所需；GitHub 检查通过、差异可合并。

- [ ] **Step 8: 合并 PPT PR 并确认远端结果。**

在必需检查通过后 squash 合并；fetch 后确认 PR 为 `MERGED`、远端 `main` 指向包含 PPT 的新提交，并抽查合并差异未覆盖写作或社媒模块。

预期：远端主线包含独立、可审查的 PPT 功能提交；桌面端待验项仍保持待验。

## 阶段 5：安全更新 D 盘应用工作区

**Files:** 仅在确认有安全集成方案后，处理 D 盘 `main`；本阶段开始前不改 D 盘代码或 Git 状态。

- [ ] **Step 1: 再做 D 盘工作区完整快照清点。**

对照本计划阶段 1 的 `git status --porcelain=v1`、未跟踪文件清单、30 个本地提交 SHA 和生成目录，确认期间没有用户新改动。若状态已变化，先补记新差异并按来源分类，不覆盖、不 stash、不清理。

预期：有可比较的前后清单；无法确认来源的文件保留在 D 盘原地并从集成候选中排除。

- [ ] **Step 2: 在新 worktree 验证远端组合版应用。**

从最终远端 `origin/main` 新建独立验证 worktree，按仓库锁文件安装依赖，在该副本运行完整 `pnpm test`、`pnpm check`、`git diff --check` 和写作/PPT 代表性定向回归，再启动开发服务器并验证浏览器中的两个工作台入口、关键流程和刷新恢复。桌面构建/启动在环境允许时单独执行；成功构建不能替代安装版启动验收。不得用它改写 D 盘 `main`。

预期：组合版工作区的应用入口和功能可验收；安装包未实际启动时明确标为未验收。

- [ ] **Step 3: 判断是否需要把组合版带回 D 盘。**

若用户仍需要 D 盘当前目录直接承载新代码，先计算远端主线与 D 盘 `main` 的共同祖先、提交差异和共享文件冲突；制定仅纳入已合入写作/PPT/社媒提交的本地集成方案。只有能在完整保留所有 D 盘已提交与未提交内容的前提下验证后，才执行集成；否则保持 D 盘原样，提供独立组合版 worktree 路径供验收。

预期：不把 30 个写作提交整体推送，不丢失任何未提交改动，不直接 `git pull` 到脏工作区。

- [ ] **Step 4: 核对最终 GitHub 和本地状态。**

核实两个 PR 的 URL、状态、合并 SHA、远端 `main` SHA、PR 文件范围和检查结果；核对 D 盘状态清单与集成前一致，或逐项解释经授权的变更。

预期：写作与 PPT 分别有清晰合并证据；D 盘没有意外暂存或删除；最终报告分别陈述远端合并、D 盘可用状态和剩余人工验收。

## 停止条件与不可越过边界

- 写作 PR 与 PPT PR 分开，不以一个包含 30 个提交和混合未提交改动的整包 PR 代替。
- 任一暂存区包含无法归属的共享 hunk、社媒独有改动、release 产物或缓存时，停止该次提交并重新做范围审阅。
- PR 检查失败、远端主线发生新变化、GitHub 显示不可合并、文件清单偏离计划时，先更新分支和验证，不强推、不绕过保护。
- PPT 最终对话明确暂缓的是直接合并 D 盘主工作区；远端 PR 合并以此计划中的独立评审与验证为门槛，D 盘回合并是单独阶段。
- 写作设计中仍待 Electron/Windows、专业来源许可或真实模型/真实材料验证的内容不能因代码推送而标记完成；真机测试不在本计划内。
- “符合设计稿可验收”按设计矩阵逐项报告代码、自动化、开发版应用和外部人工验收状态；若设计稿要求原生交互或真实专业判断，必须保留待验结论，不能为了远端合并把整个设计标成全部通过。
- 本计划创建不等于授权现在执行提交、合并或推送。当前请求只完成计划；真正执行 GitHub 写操作时，应以用户当轮明确的执行指令为准。

## 完成定义

- 写作与 PPT 各有一个范围受控的功能分支、可审查 PR、对应测试记录和合并 SHA。
- 两个 PR 依次基于合并时最新远端 `main`，后一个 PR 包含前一个 PR 的主线结果。
- D 盘 `main` 和所有现有未提交改动均被保留；是否把合并后的主线带回 D 盘有独立、可核验的步骤。
- 计划中列出的自动化验证全部有实际结果；不能在当前环境完成的人工/Electron/Windows验收保留为待验，不以推送代替验收。
- 写作与 PPT 的本地可实现缺口已在各自交付分支关闭并有自动化回归；合并后的远端组合版通过完整测试、静态检查和开发版代表路径验收，设计稿中无法在当前环境完成的项目有明确的剩余清单。
