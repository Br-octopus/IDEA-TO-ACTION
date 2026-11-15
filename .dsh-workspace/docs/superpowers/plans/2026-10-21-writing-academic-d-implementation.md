# 学术 D：引用证据核验、审稿回复与投稿准备实施计划

对应规格：`docs/superpowers/specs/2026-10-21-writing-academic-d-spec.md`
依赖：共用核心 A/B/C、学术 A/B/C 已验收
执行方式：当前代理串行推进；每项遵循先失败测试、最小实现、定向回归和 D 盘应用验收，不使用子智能体。

## Task 1：学术核验与投稿准备基础包

**Files:**
- Modify: `prototype/writing-pack-catalog.js`
- Test: `tests/writing-pack-catalog.test.js`

- [x] 为包 ID、版本、三种任务类型、原创任务流程、官方来源范围和未验证案例写测试。
- [x] 添加 `builtin-academic-publishing`，引用 Crossref、ICMJE、COPE 元数据和适用边界；不复制指南正文。
- [x] 确认包可由现有包管理器启停，普通文章及论文包提示词不变。

## Task 2：工作区数据契约与备份

**Files:**
- Create: `prototype/academic-publishing.js`
- Modify: `prototype/storage.js`
- Modify: `prototype/workspace-backup.js`
- Modify: `prototype/index.html`
- Test: `tests/academic-publishing.test.js`
- Test: `tests/storage.test.js`
- Test: `tests/workspace-backup.test.js`

- [x] 先测项目三类任务、来源快照、引用关系、审稿动作前置条件、清单状态白名单和长度/数量上限。
- [x] 先测旧状态补空集合、保存开关、删除项目不删文献、完整备份替换/合并和知识库备份排除。
- [x] 实现纯 schema/状态操作；保留用户未确认结果为候选，凭证和绝对路径清理符合现有写作规则。

## Task 3：三类提示词和外部结果版本

**Files:**
- Modify: `prototype/academic-publishing.js`
- Test: `tests/academic-publishing.test.js`

- [x] 为核引、回应意见、投稿清单提示词分别写范围、来源、阅读状态、未解决项和字数边界测试。
- [x] 实现明确选择记录后才进入提示词；超限返回错误而不静默截断。
- [x] 带回的外部结果保留原文、提示词快照和“模拟/外部”来源状态；解析失败不改写用户决定。

## Task 4：项目协调器与题录查询接线

**Files:**
- Create: `prototype/academic-publishing-coordinator.js`
- Modify: `prototype/app.js`
- Test: `tests/academic-publishing-coordinator.test.js`

- [x] 为创建/切换/删除/保存、保存失败回滚、文献快照更新提示和提示词版本写失败测试。
- [x] 复用现有 `/api/academic-literature/lookup`，只发送用户确认的 DOI 或 PMID；查询结果只作为待核对候选。
- [x] 显示登记返回的题录差异，但不自动覆盖文献字段、题录核验状态或支持关系。

## Task 5：核引、审稿回复和投稿准备 UI

**Files:**
- Create: `prototype/academic-publishing-ui.js`
- Modify: `prototype/index.html`
- Modify: `prototype/app.js`
- Modify: `tests/helpers/writing-app.js`
- Test: `tests/academic-publishing-ui.test.js`

- [x] 先覆盖项目创建、文献选择、多来源核引、审稿轮次/意见、要求卡片/清单和关键状态点击路径。
- [x] 提示词可编辑/复制；外部结果可粘贴，候选须人工逐条确认；删除需确认，失败保留表单和既有状态。
- [x] 显示未核验/未解决/仅计划状态、材料范围和保密提示；窄屏和键盘能完成代表操作。

## Task 6：D 盘应用验收和阶段收口

**Files:**
- Create: `docs/superpowers/plans/2026-10-21-writing-academic-d-acceptance.md`
- Modify: `docs/superpowers/plans/2026-10-21-writing-academic-d-implementation.md`
- Modify: `docs/superpowers/specs/2026-10-20-writing-domain-expansion-design.md`

- [x] 运行学术 D、学术 A/B/C、基础包、写作工作台、存储/备份专项和 `pnpm check`；检查 `git diff --check`。
- [x] 在 D 盘浏览器开发版完成三种任务路径、模拟结果边界、刷新恢复和备份边界验收。
- [x] 检查 390×844、键盘可达、页面/控制台错误和材料发送边界；浏览器状态与自动化结果记录在验收记录中。
- [x] 记录真实模型、真机、Electron 桌面壳及安装/便携包的实际验证状态；更新学术 D 蓝图状态。后续结构化文档阶段留待另行开始。
