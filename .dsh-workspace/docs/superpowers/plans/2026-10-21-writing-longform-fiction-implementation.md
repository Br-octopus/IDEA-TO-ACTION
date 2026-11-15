# 长篇创作：小说、剧本与连续性实施计划

对应规格：`docs/superpowers/specs/2026-10-21-writing-longform-fiction-spec.md`
上位设计：`docs/superpowers/specs/2026-10-20-writing-domain-expansion-design.md` 第 5–17 节
依赖：共用核心 A/B/C、写作基础包管理、相关存储/备份能力已存在；开工前复核实际分支状态。
目标：用现有工作台交付可在 D 盘应用验收的小说/剧本长篇创作提示词与连续性闭环，不实现正文编辑器。

当前状态（2026-10-21）：未完成。已有故事资料 schema、部分 UI 和提示词接线及自动化覆盖，但小说/剧本的完整结果回带、问题复核、跨单元影响、刷新恢复与代表性应用验收尚无阶段记录。真机测试按用户要求暂缓，不提交代码。

**执行备注：** 当前实现优先串行推进。小说与剧本任务共享写作 schema、协调器和 UI，且工作区已有大量并行改动；拆分实现会增加冲突与集成成本。若出现互不依赖的只读资料审查，再按节省的时间是否大于交接成本决定是否委派。

## 实施约束

- 先检查 `git status --short`、上位蓝图和相关验收记录，保留所有既有修改；仅提交本阶段明确文件，不清理他人/其他阶段文件。
- 生产实现遵循仓库 `package.json`、现有原生 JS/DOM/Electron 分层及严格 schema 白名单，不新增数据库、框架或依赖。
- 每阶段先增加能复现缺口的定向测试，再做最小实现；每阶段完成后运行该阶段列出的测试。最终达到 D 盘应用可验收状态后停止。
- 不运行或替用户执行真机测试；不提交代码。需要用户实施的真实模型效果/真机验收记录为待验项。
- 来源审查遵循上位设计第 7 节：实际读取、锁定版本、许可和适用范围；不把来源搜索结果或模拟案例标为验证通过。

## 阶段 0：基线和故事方法资料冻结

**Files:**
- Read: `docs/superpowers/specs/2026-10-20-writing-domain-expansion-design.md`
- Read: `docs/superpowers/specs/2026-10-21-writing-core-c-spec.md`
- Read: `docs/superpowers/specs/2026-10-21-writing-academic-c-spec.md`
- Read: `docs/superpowers/plans/2026-10-21-writing-core-c-implementation.md`
- Read: `docs/superpowers/plans/2026-10-21-writing-core-c-acceptance.md`
- Read: `docs/superpowers/plans/2026-10-21-writing-academic-c-implementation.md`
- Read: `docs/superpowers/plans/2026-10-21-writing-academic-c-acceptance.md`
- Inspect: `prototype/writing-workbench-schema.js`, `prototype/writing-workbench-coordinator.js`, `prototype/writing-workbench-prompts.js`, `prototype/writing-workbench-ui.js`, `prototype/writing-pack-schema.js`, `prototype/writing-pack-catalog.js`, `prototype/writing-pack-ui.js`, `prototype/storage.js`, `prototype/workspace-backup.js` and relevant tests.
- Create: `docs/superpowers/plans/2026-10-21-writing-longform-fiction-acceptance.md`
- If required by actual implementation: create a bounded source/method mapping in this acceptance record or a separately approved artifact; do not copy third-party text before license review.

- [ ] Record current dirty/untracked state and identify already implemented overlap; preserve all existing changes.
- [ ] Check longform task types, unit fields, prompt snapshots, material association, issue linkage, save behavior, backup validation, and browser/Electron launch commands against current source rather than assuming prior acceptance implies current state.
- [ ] Review existing fiction/script source candidates; read specific files, capture source/version/license/applicability/limitations and distinguish practice from evidence. Keep uncertain-license materials as research notes only.
- [ ] Define an original, minimal built-in fiction/script pack mapping: planning, chapter/scene prompts, continuity, revision, check items and provenance. Keep pack case validation `unverified` until a real applicable case is reviewed.
- [ ] Run baseline targeted tests for touched areas and note pre-existing failures without attributing them to this phase.

**Gate:** no product edits until data/extension points and a compatible source plan are identified. If an existing path already satisfies a requirement, cite its test and app evidence instead of duplicating it.

## 阶段 1：长篇 schema、迁移与持久化

**Files:**
- Modify: `prototype/writing-workbench-schema.js`
- Modify: `tests/writing-workbench-schema.test.js`
- Modify: `tests/storage.test.js`
- Modify: `tests/workspace-backup.test.js`

- [ ] Add failing tests for `fiction`/`script`/`longform-general` project metadata and bounded story entries: world facts, characters, timeline events, foreshadowing, and unit context.
- [ ] Add stable-ID relationship validation/normalization, enum/state constraints, order/array/text limits, dangling references, archive handling, path and credential sanitization.
- [ ] Add project change records and per-item impact review status/reason with explicit user-confirmed state; reject unsupported status transitions without overwriting historical snapshots.
- [ ] Extend round/unit snapshots only with whitelisted data needed to show actual historical context and task type; preserve current `unitSnapshot`, `promptVersions`, `routeSnapshot`, `sourcePromptVersionId` contracts.
- [ ] Verify old article/academic workspace and backup fixtures normalize unchanged; longform fields survive complete workspace backup roundtrip and remain excluded from library-only backup where appropriate.
- [ ] Run: `node --test tests/writing-workbench-schema.test.js tests/storage.test.js tests/workspace-backup.test.js`.

**Exit:** schema and persistence tests pass; legacy compatibility, deletion/archive behavior, and save-pause semantics are evidenced.

## 阶段 2：长篇项目、单元关系和变更影响协调器

**Files:**
- Modify: `prototype/writing-workbench-coordinator.js`
- Modify: `tests/writing-workbench-coordinator.test.js`

- [ ] Add tests for creating/updating fiction and script projects without article/academic fallback; reject unknown modes and preserve existing genre behavior.
- [ ] Implement minimal CRUD/order/archive operations for world facts, characters, timeline events and foreshadowing using stable IDs; validate associations to existing units/materials/issues.
- [ ] Add scene/chapter context update and snapshot behavior on prompt generation; archived units or references must remain readable in old rounds but unavailable to new selection.
- [ ] Implement deterministic impact listing from explicit IDs and registered unit/material/issue/foreshadowing relations. Record user review status and reason; never infer “no impact” from missing text matches or edit old rounds.
- [ ] Test adding/updating/copying prompt versions and returning results against selected or unlinked source prompt version; reuse core C mechanisms where they already work.
- [ ] Test save enabled/disabled/paused, failed persistence, branch-from-old-round and preservation of later rounds.
- [ ] Run: `node --test tests/writing-workbench-coordinator.test.js`.

**Exit:** core operations enforce stable relations and do not mutate historical records; deterministic impact output is test-covered.

## 阶段 3：故事包和任务提示词

**Files:**
- Modify: `prototype/writing-pack-catalog.js`
- Modify: `prototype/writing-workbench-schema.js` (task enum only if still needed)
- Modify: `prototype/writing-workbench-prompts.js`
- Modify: `tests/writing-pack-catalog.test.js`
- Modify: `tests/writing-workbench-prompts.test.js`

- [ ] Add tests first for supported task types and genre isolation: planning, outline, worldbuilding, character, chapter draft, scene draft, continuity and revision.
- [ ] Add an original `builtin-longform-fiction` pack with versioned task templates, route/check items and provenance; separate novel and script applicability. Mark unreviewed material and cases honestly.
- [ ] Build prompts from only current task inputs, selected story items, current unit, explicit prior/next summaries, linked materials and unresolved issues; render omissions, stale relations, unconfirmed facts and conflicts visibly.
- [ ] Ensure script prompts carry scene purpose, cast entrances/exits, medium/format and performable action requirements without leaking into novel prompts.
- [ ] Continuity prompt asks for located candidate findings on setting, timeline, character knowledge/state, cause/effect, viewpoint, foreshadowing and scene function; no automatic canon updates and no full-work claims from partial context.
- [ ] Revision prompts specify change scope, preserved details, linked issues and review criteria; diagnosis prompts request findings without replacement prose.
- [ ] Test context budgets/overflow and truncation reporting so the prompt never claims omitted chapters or attachments were reviewed; verify deterministic text generation and provenance snapshots.
- [ ] Run: `node --test tests/writing-pack-catalog.test.js tests/writing-workbench-prompts.test.js`.

**Exit:** each story task produces distinct, bounded prompts with no cross-genre leakage, fabricated canon or silent context omission.

## 阶段 4：工作台界面与可访问交互

**Files:**
- Modify: `prototype/writing-workbench-ui.js`
- Modify: `prototype/index.html`
- Modify: `tests/writing-workbench-ui.test.js`
- Modify only if required by actual test gaps: `tests/helpers/writing-app.js`, `tests/helpers/writing-dom.js`

- [ ] Add realistic UI tests for project mode selection, story-bible CRUD, timeline/foreshadowing state, chapter/scene metadata and relations.
- [ ] Present task context with explicit included/excluded story items, materials and unit summaries; allow editing current prompt without losing unsaved input.
- [ ] Add deterministic impact review panel with per-item status/reason and links to affected unit/issue; distinguish no registered links from proof of no impact.
- [ ] Add novel and script task entry buttons, continuity check, revision prompt and actual prompt-version result return/unlinked option; reuse existing issue judgment/review and version compare/branch controls.
- [ ] Cover keyboard access, 390px layout, focus order, escaped user content, error states, save failures and pending form preservation.
- [ ] Run: `node --test tests/writing-workbench-ui.test.js`.

**Exit:** representative actions are possible through visible controls, not only coordinator calls; the UI reports the exact prompt and relation state.

## 阶段 5：集成回归和 D 盘应用验收

**Files:**
- Create: `docs/superpowers/plans/2026-10-21-writing-longform-fiction-acceptance.md`
- Update: this plan's execution checklist/results
- Update: `docs/superpowers/specs/2026-10-20-writing-domain-expansion-design.md` only if the user authorizes that scope in the implementation task; otherwise report the phase evidence without modifying the blueprint.

- [ ] Run longform targeted suites, then relevant writing pack/workbench/schema/coordinator/storage/backup regressions and the repository's `pnpm check` script.
- [ ] Run `git diff --check`; inspect diff and `git status` to confirm no unrelated work was overwritten or swept into changes.
- [ ] Launch the actual D drive development application using its documented script, isolated acceptance profile/data if supported; verify service/page is reachable before claiming app acceptance.
- [ ] Complete a novel path: create story data, three linked units, selected material and prompt; bring back simulated output, create candidate continuity issues, review one on a later round, change a referenced fact, and process the impact list.
- [ ] Complete a script path: create scene/cast/time/format metadata, generate scene prompt, check script-only constraints do not contaminate a novel task.
- [ ] Enable local save, reload application, verify story bible, relations, impact state, prompt/result versions and unresolved issues restore; compare versions and branch from an older round without overwriting newer history.
- [ ] Check 390×844 viewport, keyboard path, actual prompt preview/copy parity, and browser console. If Electron-specific functionality is touched and desktop control is available, verify the Electron shell separately; never label browser evidence as Electron evidence.
- [ ] Record test commands/counts, app environment, screenshots or machine-readable evidence, simulated vs real model use, unresolved limitations and any user-run tests deferred. Keep true model quality, distribution package and real-device checks explicitly unverified when not performed.
- [ ] Stop when the D drive application path is acceptance-ready; do not continue to another expansion phase or commit.

**Exit:** specification representative tasks can be completed in the D drive application, persistence/version boundaries hold, automated/static checks pass, and all deferred checks are listed without overstating them.

## 最小交付与不做事项

首版只交付结构化故事资料、显式章节/场景关系、基于登记关系的变更影响清单、可检查的任务提示词、连续性候选问题、版本/结果回带和本地保存/备份兼容。暂不引入全文语义索引、自动故事事实抽取/正典判断、多代理平台、完整剧本排版工具、多人协作或正文编辑器。

本计划完成不等于验证外部 AI 写作质量；模拟结果仅验收提示词生成、关联、复核和持久化路径。

### 2026-10-22 续作记录

- 修复领域任务按钮直接读取旧工作区字段的问题；长篇 UI 增加故事资料归档/恢复及影响单元/问题导航。定向真实 DOM 回归覆盖上述行为。
- 新提示词快照排除已归档的设定、人物、时间线与伏笔；恢复后可重新选入后续提示词。
- 写作工作台、包、存储、备份回归 330 项通过，`pnpm check` 与 `git diff --check` 通过。阶段验收记录见 `2026-10-22-writing-longform-fiction-acceptance.md`。
- 续验中小说已有三个章节单元并在刷新后恢复；剧本独立工作区也恢复为 3/3 轮。第三章连续性提示词明确显示未选入设定、已登记材料为 0，故不能视作满足多章节材料范围要求。
- 小说三章关系/材料/伏笔/跨轮复核、剧本与小说提示词隔离专项、版本比较与旧轮分支的组合应用证据仍缺；本阶段和上位蓝图保持未完成。
- 追加开发版会话验收：在不启用本机保存的模拟小说项目中，新增三章并填写用户摘要、显式前后单元 ID；选中第三章生成连续性提示词，确认当前单元摘要及前序关系进入章节上下文。该演练仅证明本次会话中的 UI 字段和提示词接线，不作为刷新恢复或创作质量证据。
- 新增/编辑单元的摘要与前后关系表单回归通过；`pnpm exec node --test tests/writing-workbench-ui.test.js`：54/54 通过。键盘完整路径、关联材料/伏笔、候选问题后续复核、持久化恢复及版本分支组合仍未完成。
- 随后完成同一合成项目的第 2 轮模拟回带与问题复核；保存开启后刷新开发版并重新进入工作台，确认 2/2 轮、三章、第三章提示词摘要及“复核通过”状态恢复。演练项目已删除，未保留在用户资料中；关联材料、伏笔/设定影响、版本比较/旧轮分支和键盘完整路径仍待补验。
- 续验发现影响审查下拉框原先在待审状态下视觉默认到“已检查”；现增加空选占位和显式选择门槛，未选择时不写入状态。长篇 UI、e2e smoke、知识检索相关回归 115/115 通过；390px 开发页无重复 ID，写作控件均有可访问名称。
- 最新共用工作台/基础包/存储/备份回归覆盖 11 个测试文件，346/346 通过；`pnpm check` 通过。阶段整体仍未完成。
- 2026-10-22 路线应用续验：小说专属路线可采用，下一步建议显示输入/检查依据、当前缺口和优先理由；来源维持未核验。真实浏览器键盘已验证采用路线→Enter 启动→Tab 结果→Tab 证据→Tab 确认；确认后第二步骤成为建议，焦点落到第二步按钮。启用本机保存并刷新后，步骤状态和目标恢复；验收后删除合成项目。发现并修复重绘后焦点丢失及确认按钮排在输入字段之前的问题。
- 修复后的写作 UI 定向测试 55/55 通过；工作台、基础包、存储和备份十个测试文件 338/338 通过，`pnpm check` 与 `git diff --check` 通过。该路径使用390px浏览器视口、模拟结果和未核验来源，不替代全工作台/小说剧本各任务键盘验收。
- 包来源只读审查确认：非学术扩展包以项目自拟内容交付并保持 `unverified`；学术包仅部分外部来源有来源核对记录，包内流程/案例仍需逐项审查。来源状态不因合成应用演练而升级。

### 2026-10-22 续作记录：相邻章节材料范围和备份

- 已在隔离开发版项目确认第一章关联材料只进入第一章/相邻章节任务范围，第二章提示词排除该材料；全文任务包含材料符合预期全项目范围。详情和准确限制见 `2026-10-22-writing-longform-fiction-acceptance.md`。
- 同一隔离项目刷新恢复 5/5 轮；资料库应用导出工作区备份成功。完整工作区导入/替换恢复已有结构化文档阶段应用记录及备份回归覆盖。
- 写作工作台、基础包、存储和备份相关 8 个测试文件 321/321 通过；`pnpm check`、`git diff --check` 通过。
- 上述证据关闭了此前“长篇关联材料范围”和“本阶段未做应用级备份边界”的记录缺口；不代表全文正文/附件已被读取。全工作台键盘覆盖、来源审查和 Electron/分发包仍是未完成项；真机按要求暂缓。阶段保持部分通过，不修改上位设计稿状态、不提交代码。
