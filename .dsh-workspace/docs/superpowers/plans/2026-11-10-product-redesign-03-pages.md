# 阶段 C：桌面端七板块业务与交接实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Windows Electron 应用的七个板块各有合适的信息布局，并让每项操作保存到真实目标、跨板块携带正文/来源/版本。

**范围：** 只修改仓库根目录「向前一步」桌面应用，最终交付 NSIS 安装包与 portable `.exe`；不修改 `.dsh-workspace/dsh-plugin` 插件副本。浏览器入口仅用于开发验证。

**Architecture:** 只重排根目录现有 renderer 和领域模块；沿用现有本地存储、Electron 设置和业务接口。对没有单独页面的数据（尤其记忆与偏好）先盘点真实来源，再实现可解释的最小页面，不建立通用页面框架。

**Tech Stack:** 现有 HTML/CSS/JavaScript、Electron 受控 IPC、Node 内置测试与根目录已有领域模块。

---

## 跨板块交接的验收规则

每个保存/采用/导入动作都验证：结果写入真实记录、列表能找到并打开、来源/正文/版本不丢、取消不创建半成品、失败保留输入、归档能恢复。涉及批注时只传递有效版本和用户选择的批注快照。测试均使用根目录 `tests/`，不引用 `tests/dsh-plugin`。

### Task 15：资料库——检索、详情、版本与引用

**Files:**
- Modify: `prototype/index.html`、`prototype/knowledge-search.js`、当前资料列表事件所在模块
- Read/Modify only if needed: `prototype/local-source-index.js`、`server/web-page-reader.js`
- Test: `tests/browser-project-index.test.js`、`tests/web-page-reader.test.js`、相关 e2e smoke

- [x] 将资料库布局分为搜索/筛选、资料列表、详情与来源；详情默认折叠，结果使用唯一列表。
- [x] 补齐资料相对路径、网址、抓取时间、格式、解析方式和已验证能力等来源元数据并展示；不持久化绝对本机路径。通用预览/批注能力仍由阶段 B/D 的格式矩阵与真实样本验收。
- [x] 从资料卡带入当前工作台任务，复用现有快照函数传递资料 ID 与版本，不只传标题。
- [x] 更新/永久删除前列出工作台与提示词依赖；更新保留旧快照，移除可恢复，永久删除前备份并二次确认。

**2026-11-11 实施记录：**移除失效的旧资料表单/详情 DOM 绑定与重复提交监听；添加入口只展开单一表单，取消后重置草稿；资料卡详情按需展开；“带入当前任务”调用 `appendKnowledgeSource` 保存资料 ID、版本与正文快照。通过资料管理、快照去重及写作可选入定向测试和 `pnpm check`。文件路径、网页抓取时间、格式能力标识及 Electron 真窗口复核仍未完成。

**2026-11-12 实施记录：**复用写作材料现有的相对来源位置、URL、访问时间、解析方式、页数和附件要求，将其落到资料条目并在详情展示；本地路径拒绝绝对路径与 `..` 穿越。网页读取 API 返回 MIME 与抓取时间，用户选入网页摘录后随来源快照保存。备份 schema 同步保留新增元数据。资料来源元数据与保存/快照/备份定向测试共 229 项通过，`pnpm check` 与 `git diff --check` 通过。工作区其他既有资料没有自动补造元数据，因此显示“未记录”；这不替代阶段 B/D 的文件预览、批注能力矩阵或真窗口验收。

**2026-11-14 修正：**资料库结果区现在按筛选前总条目数区分“资料库为空”和“当前筛选无匹配”，并在空库提示添加首条资料。`tests/e2e-smoke.test.js` 定向回归与 `node --check prototype/app.js` 均通过。

### Task 16：提示词收藏——正文、变量、版本与案例

**Files:**
- Modify: `prototype/index.html`、现有 `library` 视图及其事件逻辑
- Reuse: 现有提示词 Agent 与写作提示词模块，不新建模板运行时
- Test: `tests/prompt-agent-schema.test.js`、`tests/prompt-agent-workflow.test.js`、相关 e2e smoke

- [x] 列表、正文、变量填写、版本对比和案例/方法卡各自有清晰入口；首页不直接铺满全部编辑字段。
- [x] 保存、复制、收藏与版本切换更新真实提示词记录；缺失变量在应用/复制前提示，不把 `{{变量}}` 静默留给最终用户。
- [x] 被工作台使用时携带完整正文和版本号，并可回看来源。

**2026-11-11 实施记录：**核实并沿用现有列表/详情、变量预览与必填校验、保存为新版本、收藏、版本比较、案例和方法卡子页。修正“用于工作台”自动调用 Agent 的不一致：现在将变量替换后的完整正文、提示词 ID/分组/版本和本次补充保存到可编辑的 `conversationDraft`，只打开对应任务；用户编辑后手动发送才会触发 Agent，保存失败会恢复原草稿。新增草稿快照单测并扩展 e2e 契约，提示词收藏定向 e2e 2 项、对话/提示词模块测试 20 项、`pnpm check` 通过。真实 Electron 窗口操作未验收；从收藏提示词直接带入独立写作稿件的实现与验证见 Task 17。

### Task 17：写作——稿件、修改轮次和采用

**Files:**
- Modify: `prototype/index.html`、`prototype/app.js`、`prototype/ppt-feedback.js`、`prototype/writing-workbench-schema.js`、`prototype/writing-workbench-prompts.js`、`prototype/writing-workbench-ui.js`
- Reuse: `ForwardStepPptFeedback.buildSelectedAnnotationPrompt`、`prototype/ppt-feedback-schema.js` 的批注规范化、写作工作台既有向导与提示词生成流程、`prototype/writing-pack-*`
- Test: `tests/e2e-smoke.test.js`、`tests/ppt-feedback.test.js`、`tests/writing-workbench-schema.test.js`、`tests/writing-workbench-prompts.test.js`、`tests/writing-workbench-ui.test.js`

- [x] 以稿件详情为中心显示原稿、资料来源、修改轮次、保留要求和专业包；不把多个步骤表单常驻堆叠。
- [x] 采用修改版本时保留前版和来源；撤销采用只恢复目标稿件，不回滚无关记录。
- [x] 从资料库带入已保存摘要/摘录、来源 URL、资料 ID 和版本；材料默认待勾选，用户确认采用范围后再分析/生成。
- [x] 从提示词收藏复用变量填写和实时预览，带入完整变量替换正文、提示词 ID 和版本；材料默认待勾选。
- [x] 从批注工作台转入写作时携带批注来源与意见快照，不提前创建稿件。

**2026-11-11 实施记录：**已有文章默认显示稿件中心，当前稿、当前轮来源、保留要求、专业包快照和轮次入口集中展示；待比较外部新稿可直接采用或保留。大块写作、资料与诊断表单折叠到“展开写作、资料与诊断工具”，保留原字段和协调器行为；引导流程可切换到稿件中心再返回。稿件采用/撤销复用既有事务逻辑，只切换目标稿件并保留来源与其他轮次。

批注交接直接复用根目录桌面应用已有 `ForwardStepPptFeedback.buildSelectedAnnotationPrompt` 和 `ForwardStepPptFeedbackSchema.normalizePptAnnotation`：工作台先排除旧附件版本并拦截互斥意见，再把附件 ID、SHA-256、页码、目标定位、批注 ID/类别/意图/意见交给写作向导；向导取消会保留原草稿，确认前不创建文章。普通、领域和学术提示词共用同一批注格式化结果；原文件仍需单独附加。批注快照超过 8000 字时明确报错，不静默截断。没有新增依赖，也没有复制插件目录或外部仓库代码；外部项目取舍仍以[自查与复用报告](../specs/2026-11-10-design-audit-and-reuse.md)中固定提交和许可证核验为准。

验证：批注格式/版本、提示词交付、超限拒绝、取消保留草稿的定向测试 7 项通过；工作台 CTA 两项静态集成契约测试通过；`pnpm check` 和 `git diff --check` 通过。完整相关套件复跑 259 项，257 项通过、2 项失败；失败均为备份导入测试仍期待“导入成功”，实际现有结果为“导入已替换”和“导入新增 0 条”，本轮未改备份逻辑。未进行真实 Electron 窗口验收。当前分支为 `task-workbench-merge`，HEAD 为 `c9ed378`，与 `codex/dsh-full-feature-migration` 指向相同提交，暂存区无改动；无需切换分支或提交。资料库和提示词收藏到写作稿件的交接仍待实施。

**2026-11-11 跨板块交接补充：**复用既有写作向导和批注交接的草稿保护逻辑，新增 `prepareLibraryDraft` / `preparePromptDraft` 入口；资料库只携带已保存的摘要、内容摘录、文献摘要/摘录和可借鉴方法，不假称已读取原始文件全文，来源 URL、资料 ID 和 V 版本随材料快照保留。收藏提示词沿用既有变量必填校验和实时预览，将变量替换后的完整正文、提示词 ID 与版本作为待确认材料带入。两类材料均默认未勾选，确认前不进入本轮分析；取消覆盖确认保留原写作输入。快照最多 8000 字，超限明确拒绝；普通手工/文件材料仍按原 1200 字摘录限制处理。没有新增依赖，也没有复制外部仓库代码。

验证：资料库、收藏提示词、批注 UI 交接定向测试 3 项通过；对应 schema 48 项、提示词 50 项、e2e-smoke 29 项均通过；`pnpm check`、`git diff --check` 通过。完整写作 UI 套件仍有 2 项既有备份导入状态文案断言不匹配（实际为“导入已替换”和“导入新增 0 条”），与本次交接无关。资料库与提示词收藏的真实 Electron 窗口操作仍待验收。

### Task 18：研究——学术证据与社媒结果

**Files:**
- Modify: `prototype/index.html`、现有学术/社媒 UI 模块
- Reuse: `prototype/academic-literature*`、`prototype/academic-review*`、`prototype/academic-publishing*`、`prototype/social-research-*`
- Test: `tests/academic-literature.test.js`、`tests/academic-literature-ui.test.js`、`tests/academic-review.test.js`、`tests/academic-review-coordinator.test.js`、`tests/academic-review-ui.test.js`、`tests/academic-publishing.test.js`、`tests/academic-publishing-coordinator.test.js`、`tests/academic-publishing-ui.test.js`、`tests/social-research-schema.test.js`、`tests/social-research-workflow.test.js`、`tests/social-research-ui.test.js`、`tests/social-research-integration.test.js`、`tests/electron-social-research.test.js`

- [x] 研究页按学术与社媒区分布局，不混淆文献证据表、投稿工作与社媒执行结果。
- [x] 学术路径保留题录核对、证据来源、审稿回应和导出；社媒路径保留平台、来源、任务阶段、取消和部分结果。
- [x] 取消只停止当前可取消步骤并保留输入/已收结果；数据源或模型失败需显示真实状态，不能显示成功占位。

**2026-11-12 实施记录：**复用现有学术文献、审稿回应、投稿核验和社媒研究模块；社媒入口只接受自然语言目标，由 Agent 从可用平台候选中给建议，不要求用户逐项选择。模型计划失败时保留输入并阻止采集；运行中取消、暂停/继续、部分结果、数据源错误码、来源配置和受限登录状态均按真实状态显示。未增加依赖或引入插件副本。

验证：计划列出的 13 个学术/社媒测试文件共 199 项，198 项通过、1 项按环境条件跳过、0 项失败；`pnpm check` 与 `git diff --check` 通过。测试覆盖入口分区、题录导入核验、来源追溯、审稿/投稿流程、社媒计划批准、预算/取消/部分结果和失败状态；本轮未完成 Electron 真窗口视觉走查。

### Task 19：任务与历史回到工作台

**Files:**
- Modify: `prototype/index.html`、`prototype/app.js`、现有 `plans` 视图逻辑
- Test: `tests/e2e-smoke.test.js`、相关计划持久化测试

- [x] “我的计划”不丢失：在工作台最近任务/历史中仍可检索、查看状态、恢复或归档。
- [x] 恢复任务回到原任务与最后有效资料/批注位置；资料失效时提示重新关联。
- [x] 归档与删除区分；恢复前提供影响检查，不重复创建同名任务。

**2026-11-12 实施记录：**“我的计划”增加关键词搜索、进行中/已归档分区与状态显示；归档只设置 `archivedAt`，不删除原记录，首页最近任务排除归档项。恢复前在桌面端读取当前附件、最近移除附件与批注数量，确认后清除同一任务的归档标记并直接回到该任务；恢复不会创建新 ID。移除新建计划时最多保留 40 条的静默截断，存储往返保留任务草稿、附件引用、查看位置和提示词版本。

验证：`tests/storage.test.js` 与 `tests/e2e-smoke.test.js` 共 74 项全部通过；额外 45 条计划存储往返测试通过；`pnpm check` 与 `git diff --check` 通过。Electron 真窗口中的归档/恢复确认对话框仍待操作验收。

### Task 20：记忆与偏好——先盘点，再集中管理

**Files:**
- Inspect: `prototype/` 的既有偏好读写位置、Agent/写作上下文生成路径
- Modify: 实际读写偏好模块与 `prototype/index.html`
- Test: 对应现有 Node 测试
- Create/Test: `tests/user-preferences.test.js`，当前无偏好专用测试时新增

- [x] 第一步列出用户确认偏好、模型设置、临时任务要求和候选建议的当前数据来源；不把候选模型记忆误当用户确认。
- [x] 集中页面显示偏好内容、来源、适用范围、更新时间和启停/撤销；只修改本项偏好。
- [x] 使用偏好时可在任务中查看实际影响并跳过不相关建议；不自动将整仓库数据发给模型。

**2026-11-12 复核记录：**复用 `writingMemories` 已确认记录、写作轮次的临时偏好快照和 `electron/settings-store.js` 中独立的模型/连接设置；待确认候选不会自动成为有效偏好。现有管理页支持查看来源与适用范围、编辑、启停、恢复/撤销；任务页显示本篇实际采用项并可只对此篇跳过。`tests/e2e-smoke.test.js` 与 `tests/writing-workbench-ui.test.js` 共 112 项通过，包含候选确认、启停/恢复、任务影响和跳过；真实 Electron 窗口走查仍待阶段 C 验收。

### Task 21：设置——连接、数据、备份与迁移

**Files:**
- Modify: `prototype/index.html`、`electron/settings-store.js`、`electron/preload.js` only where existing contracts require it
- Reuse: `prototype/backup-manager.js`、`prototype/workspace-backup.js`、`electron/backup-store.js`、`electron/workspace-backup-archive.js`
- Test: `tests/settings-store.test.js`、`tests/backup-manager.test.js`、`tests/workspace-backup.test.js`、`tests/workspace-backup-archive.test.js`

- [x] 设置按常用、模型/连接、数据与备份分类；普通设置直接保存，迁移/覆盖先展示将改变的数据。
- [x] 密钥仍通过 Electron `safeStorage`；renderer 不直接访问 Node 或任意本地文件。
- [x] 保留导出、导入、格式校验、冲突预览、回滚与错误摘要；执行失败不得清空原数据。

**2026-11-12 复核记录：**设置页复用 Electron `safeStorage`、现有 workspace JSON/ZIP 备份与归档导入事务；导入前显示范围、数量、冲突与缺失附件，用户选择合并、替换或取消。当前“迁移”仅指本应用自身支持的 JSON/ZIP 备份恢复，不表示已支持插件数据或其他旧格式。`settings-store`、备份管理、工作区备份与 ZIP 归档定向测试共 63 项通过；界面测试已包含在上述 112 项中；真实 Electron 窗口走查仍待阶段 C 验收。

## 阶段 C 完成检查

- [x] 七板块入口、空/有数据/失败状态分别可辨认。
- [x] 至少完成一条真实跨板块路径：资料 → 工作台批注 → 修改提示词 → 写作/收藏；记录每步生成的实际对象 ID 和版本。2026-11-13 在隔离 Electron 中走通静态网页 → 工作台两类批注 → 排除一条意见 → 修改提示词 → 写作向导 → 开启本机保存 → renderer 重载重开同一任务，详情如下。
- [x] 运行本阶段触及的根目录测试及 `pnpm check`；在 Electron 开发窗口走查主要页面。2026-11-14：全量 `pnpm test -- --test-reporter=dot` 与 `pnpm check` 均退出 0；隔离 Electron renderer 中 10 个导航入口全部映射到预期 view 并显示标题。走查方法与空态/数据态观察见 `.codex-acceptance/redesign-20261114/stage-c-walkthrough-01/VERIFICATION.txt`。此项仅证明主要页面可打开；各板块有数据/失败状态与真实操作仍由 Task 129 跟踪。

**2026-11-14 桌面包页面补验：**同版本 portable `.exe` 逐项切换提示词工作台、资料库、收藏提示词、写作、学术研究、社媒研究、记忆与偏好、设置，均渲染独立标题与内容且没有可见页面错误。该证据只覆盖页面可打开，不覆盖有数据/失败状态、板块内真实操作、保存/返回及跨板块结果去向；阶段 C 完成检查继续未勾选。

**2026-11-14 记忆与偏好有数据/失败态补验：**隔离 Electron renderer 中，记忆页空态可见；写作分析未配置模型时显示明确失败原因并允许手动确认。显式保存一条临时偏好后，记忆页显示 1 条已确认记录；renderer 重载后同一记录与内容仍在。实测详情见 `.codex-acceptance/redesign-20261114/stage-c-memory-route-02/VERIFICATION.txt`。这只覆盖记忆板块的数据态，以及写作流程中的一种失败态，不关闭“七板块空/有数据/失败态”检查。

**2026-11-14 提示词收藏页有数据补验：**隔离 Electron 中从空列表通过页面编辑器创建一条带 `{{主题}}` 必填变量的提示词；列表显示 V1、详情显示完整正文和变量提示。renderer 重载后提示词和正文保留。记录见 `.codex-acceptance/redesign-20261114/stage-c-memory-route-02/PROMPT-FAVORITES-VERIFICATION.txt`。这只覆盖提示词收藏的数据态和持久化，不验证使用/写作交接、失败分支或其他板块，不关闭 Task 129。

**2026-11-14 七板块状态矩阵复核：**

| 板块 | 当前状态证据 |
| --- | --- |
| 工作台 | Electron 入口 10/10 映射；首页/计划空态及新建、恢复流程有测试；共享持久化失败提示可见。 |
| 资料库 | 空库与筛选无匹配有不同提示；资料管理/筛选有测试；保存失败走共享可见提示。 |
| 提示词收藏 | 隔离 Electron 记录覆盖空态、创建 V1、正文/变量详情和重载保持；保存错误走共享可见提示。 |
| 写作 | 空、部分、成功结果，以及模型未配置、模型失败、写入失败都有 UI 测试；未配置模型的真实窗口降级已有记录。 |
| 研究 | 学术文献无匹配/查询失败、综述与投稿空项目、社媒无结果/部分失败均有对应 UI 测试。 |
| 记忆与偏好 | 隔离 Electron 记录覆盖空态、保存一条已确认偏好和重载保持。 |
| 设置 | Electron 走查显示连接未配置；设置测试覆盖成功保存与 safeStorage 不可用失败。 |

工作台、资料库、收藏、写作、研究和记忆的 renderer 工作区数据共享 persist() 写入失败提示，表单输入不会因失败而清空；提示节点带 role=status。设置凭证/备份使用 Electron IPC 与 safeStorage 的独立失败提示。入口详情见 stage-c-walkthrough-01/VERIFICATION.txt，记忆和收藏实窗记录见 stage-c-memory-route-02/VERIFICATION.txt 与 PROMPT-FAVORITES-VERIFICATION.txt。

本轮定向命令 pnpm exec node --test --test-reporter=dot tests/e2e-smoke.test.js tests/knowledge-management.test.js tests/knowledge-search.test.js tests/social-research-ui.test.js tests/academic-literature-ui.test.js tests/academic-review-ui.test.js tests/academic-publishing-ui.test.js tests/settings-store.test.js 退出码 0。已有 writing-workbench-ui.test.js 覆盖写作分析无模型、空/部分结果、保存和模型失败，本轮未重复运行。此项只确认状态可辨认，不表示每种故障都已在打包 EXE 中逐项诱发；复杂 Office 样本、完整七板块跨页操作和发布包缺口仍由阶段 B/D 跟踪。

状态说明：以上便携包、记忆和提示词收藏记录中的“仍未关闭”是各自记录时的结论；此后补齐的状态矩阵现已关闭本阶段第一项检查，不扩大其他验收范围。

### 2026-11-13 真实跨板块交接记录

- 工作台任务 `356fbc65-0a47-4de5-9f4f-d5ac6ad5179b`，网页附件 `f6027449-8a27-4d8d-bd98-5304772c9b41`，SHA-256 `d1ca610eff71045e1d8e120d91d05cdfeb8cfdf983186610e8e79cc44a8c02a6`。当前有效且选中的 4 份资料共 6 条批注带入写作向导，其中网页只携带文字批注 `ba4636ce-8654-4d5a-9a7d-dbd16c53ca80`；已取消勾选的元素批注不带入。
- 隔离环境未配置模型，任务分析如实报错，未作为在线模型成功证据。沿用已有手动确认入口生成本地提示词，再通过“开启本机保存”控件显式保存；没有改变默认仅会话的存储行为。
- 写作任务 `article-5beb1721-ccc5-48ed-8a17-e4d287ad245e`，第 1 轮 `round-b35441f5-40a4-4756-9811-4a516ba597f1`，提示词版本 `prompt-version-4eebb92f-c889-4a58-98ee-2ffed47933db`。网页来源的 `sourceId/sourceVersion/annotationSnapshot` 保留 URL、抓取时间、网页 hash、原文、意见、批注 ID；`attachmentRequired=true` 明示原附件需另行附加，未把快照当成原文件复制成功。
- 重载 renderer 后，从写作导航和已保存任务列表重开同一任务，显示 `1/1 轮已保存到本机。当前轮已保存到本机。`；4 份资料与 6 条批注快照仍在，提示词包含网页文字意见并排除未选元素意见。截图 `.codex-acceptance/redesign-20261113/web-to-writing-after-reload.png`。
- 只勾选这一条实际走通路径；七板块完整主路径、在线模型与其他跨板块组合仍待验收。



