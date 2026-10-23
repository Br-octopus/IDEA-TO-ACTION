# 学术 C：论文与学位论文规划、章节起草和优化实施计划

对应规格：`docs/superpowers/specs/2026-10-21-writing-academic-c-spec.md`
依赖：共用核心 A/B/C、学术 A/B 已验收。
执行方式：当前代理串行推进；不使用子智能体。生产代码按失败测试、最小实现、定向回归和 D 盘应用验收推进。

## Task 1：学术论文内置包与官方来源映射

**Files:**
- Modify: `prototype/writing-pack-catalog.js`
- Test: `tests/writing-pack-catalog.test.js`

- [x] 学术文体包身份、版本、任务模板、章节路线、报告指南边界与来源状态均有测试。
- [x] 增加 `builtin-academic-paper`，覆盖规划、提纲、章节起草、诊断、定向优化；使用已核对的 EQUATOR 官方入口并保留按类型选择指南的边界。
- [x] 包案例保持未验证；未复制第三方指南/期刊模板正文。

## Task 2：文体数据、学术目标要求和材料用途

**Files:**
- Modify: `prototype/writing-workbench-schema.js`
- Modify: `tests/writing-workbench-schema.test.js`
- Modify: `tests/storage.test.js`
- Modify: `tests/workspace-backup.test.js`

- [x] `academic-paper` 规范化保存、旧工作区兼容、无效/未知字段剔除和目标元数据边界有测试。
- [x] `requirement` 材料用途独立，普通文章的 content/style/both 行为保持通过。
- [x] 目标要求使用白名单文本与来源字段，清理凭证、绝对路径并限制条数/长度。
- [x] 完整工作区备份保留学术目标；资料库备份排除写作记录。

## Task 3：协调器支持学术工作区和任务版本

**Files:**
- Modify: `prototype/writing-workbench-coordinator.js`
- Test: `tests/writing-workbench-coordinator.test.js`

- [x] 学术工作区创建、更新、保存暂停/恢复和文体专属记忆隔离有回归测试。
- [x] 学术任务接受显式目标要求和任务类型；未知文体拒绝且普通文章 API 回归通过。
- [x] 提示词版本快照记录任务类型、章节单元和选用包；旧轮续写保留历史。
- [x] 失败保存保留会话与磁盘中已保存快照。

## Task 4：学术提示词实际消费与章节上下文

**Files:**
- Modify: `prototype/writing-workbench-prompts.js`
- Test: `tests/writing-workbench-prompts.test.js`
- Test: `tests/writing-workbench-coordinator.test.js`

- [x] 学术规划、提纲、章节起草、诊断和定向改稿均有独立任务覆盖。
- [x] 目标要求、研究证据和风格特征分开；报告指南保持按研究类型适用的条件边界并保留来源状态。
- [x] 当前单元优先并过滤未关联的章节材料；全文材料可用，不虚构相邻章节。
- [x] 诊断要求位置与依据；定向修改保留结论强度、未解决问题和用户边界。
- [x] 输出限长，不静默丢弃来源、不声称读过未提供的附件全文。
- [x] 提示词特征去重，避免同一份风格摘录被重复计入。

## Task 5：写作工作台学术目标与章节操作 UI

**Files:**
- Modify: `prototype/writing-workbench-ui.js`
- Modify: `prototype/writing-pack-ui.js`
- Modify: `tests/writing-workbench-ui.test.js`
- Modify: `tests/helpers/writing-app.js`

- [x] 学术论文/学位论文创建不触发普通文章确认；普通文章回归通过。
- [x] 目标类型、学科、研究类型、目标机构/期刊、引用格式和要求卡片可用；缺项不自动补齐。
- [x] 章节单元支持增删编辑/排序/归档；材料和问题关联单元；学术任务按钮可用。
- [x] `requirement` 用途和来源状态可核对；诊断、优化提示词可编辑、复制和回带。
- [x] 窄屏、键盘、表单状态和错误保留均有自动化覆盖。

## Task 6：D 盘应用验收与阶段收口

**Files:**
- Create: `docs/superpowers/plans/2026-10-21-writing-academic-c-acceptance.md`
- Modify: `docs/superpowers/plans/2026-10-21-writing-academic-c-implementation.md`
- Modify: `docs/superpowers/specs/2026-10-20-writing-domain-expansion-design.md`

- [x] 学术写作包、schema、提示词、协调器、UI、存储/备份、普通文章回归和 `pnpm check` 通过。
- [x] D 盘浏览器开发版走通完整学位论文任务路径；结果明确标记为模拟并在重载后恢复。
- [ ] Electron 桌面壳专项目验收待具备桌面窗口控制的环境；浏览器开发版证据不替代 Electron 实测。
- [x] 验证历史提示词/包快照、完整工作区与资料库备份边界、390×844、键盘和控制台状态。
- [x] 记录模型、真机和安装/便携版未验证项；模拟案例未标记为已验证。
- [x] 更新学术 C 阶段状态并进入学术 D；Electron 专项保留待补。
