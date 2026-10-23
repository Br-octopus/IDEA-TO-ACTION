# 共用核心 C：任务单元、问题、版本与路线实施计划

> 执行方式：当前代理串行推进；每项先写失败测试，再写最小实现、复跑相关测试并检查变更。不得用子智能体。

**Goal:** 在现有普通文章工作台中建立任务单元、证据问题、可比较版本和来源可追溯路线，并保持旧数据、保存开关与备份兼容。

**Architecture:** 继续把作品保存在现有 `writingArticles` 工作区中，扩展其严格 schema 和轮次关系。专业路线只从所选基础包读取；问题、路线进度和提示词副本均保留稳定 ID，并由当前任务单元和轮次关联。

**Tech Stack:** 原生 JavaScript、现有 Electron/DOM、Node `node:test`、现有本地存储和工作区备份。

规格：`docs/superpowers/specs/2026-10-21-writing-core-c-spec.md`。

---

## Task 1：定义并测试核心 C 数据契约

**Files:**
- Modify: `prototype/writing-workbench-schema.js`
- Modify: `prototype/writing-pack-schema.js`
- Test: `tests/writing-workbench-schema.test.js`
- Test: `tests/writing-pack-schema.test.js`

- [x] 先为单元、问题、提示词版本、路线来源/步骤核验字段和旧记录默认值各写最小失败断言。
- [x] 运行对应测试，确认失败源于字段被白名单剔除或校验缺失。
- [x] 增加有限长度、稳定 ID、枚举、引用 ID、路径清理和数组上限规范化；旧数据字段及默认值不变。
- [x] 重跑两份 schema 测试，覆盖未知字段、凭证和绝对路径被拒/清理。`node --test tests/writing-workbench-schema.test.js tests/writing-pack-schema.test.js`：44 项通过。

## Task 2：存储、迁移和备份兼容

**Files:**
- Modify: `prototype/storage.js`
- Modify: `prototype/workspace-backup.js`
- Test: `tests/storage.test.js`
- Test: `tests/workspace-backup.test.js`

- [x] 先断言带核心 C 关系的新工作区可以保存/恢复，旧工作区仍可读取，资料库备份不带正文/问题/历史。
- [x] 确认现有存储和备份已复用工作区 schema；关系字段由新增 schema 测试验证失败后接入，无需另加迁移层。
- [x] 验证保存暂停时历史不追加、不删除旧版本；工作区备份往返保留引用关系且不增加路径/凭证。`storage.test.js` 38 项、`workspace-backup.test.js` 39 项通过。

## Task 3：任务单元、材料范围和提示词实际消费

**Files:**
- Modify: `prototype/writing-workbench-coordinator.js`
- Modify: `prototype/writing-workbench-prompts.js`
- Modify: `prototype/writing-workbench-schema.js`
- Test: `tests/writing-workbench-coordinator.test.js`
- Test: `tests/writing-workbench-prompts.test.js`

- [x] 先写测试：选中单元的目标、完成条件和全文材料进入提示词；其他单元材料不进入；没有单元时保持旧全文行为。
- [x] 写失败测试并确认跨单元材料污染确实被检测。
- [x] 实现单元创建/编辑/排序/归档、轮次绑定、材料单元关联、实际字数和超限状态。
- [x] 运行协调器与提示词测试，确认 3 份/1200 字现有限额及来源核验状态不变。

## Task 4：来源路线与显式进度

**Files:**
- Modify: `prototype/writing-pack-schema.js`
- Modify: `prototype/writing-workbench-schema.js`
- Modify: `prototype/writing-workbench-coordinator.js`
- Test: `tests/writing-pack-schema.test.js`
- Test: `tests/writing-workbench-coordinator.test.js`
- Test: `tests/writing-workbench-prompts.test.js`

- [x] 先断言只显示已选且适用基础包的路线，并保留包/路线/步骤来源和版本。
- [x] 先断言不可跳过步骤不能跳过、缺失输入可退回、用户确认完成不会被记作专业认证。
- [x] 以失败测试确认当前路线未被工作台读取，再加入路线选择、版本快照、状态转换和提示词中的当前步骤。
- [x] 验证无适用路线时为直接模式，不能由模型补造一条专业路线。

## Task 5：问题记录、结构化诊断与跨轮复核

**Files:**
- Modify: `prototype/writing-workbench-prompts.js`
- Modify: `prototype/writing-workbench-coordinator.js`
- Modify: `prototype/writing-workbench-schema.js`
- Test: `tests/writing-workbench-prompts.test.js`
- Test: `tests/writing-workbench-coordinator.test.js`

- [x] 先测试诊断提示词要求带位置、原文摘录、表现、影响、依据、建议、优先级和候选状态。
- [x] 先测试有效 JSON 产生待用户判断的问题、无效 JSON 保留原始诊断且不丢输入。
- [x] 实现手动问题录入、判断/状态流转、处理理由和新轮复核关联。
- [x] 验证新稿不会自动关闭问题，个人偏好不会伪装成专业问题。

## Task 6：提示词版本、带回结果关联、比较和恢复分支

**Files:**
- Modify: `prototype/writing-workbench-coordinator.js`
- Modify: `prototype/writing-workbench-schema.js`
- Test: `tests/writing-workbench-coordinator.test.js`
- Test: `tests/writing-workbench-ui.test.js`

- [x] 先断言用户编辑并复制的提示词有独立 ID，复制状态不等于已发送。
- [x] 先断言带回结果可关联到确切提示词版本；未知来源保持未关联。
- [x] 先断言恢复历史轮创建子轮次且原轮和后续轮不变，再实现协调器接口。
- [x] 增加两轮提示词/结果对照及行级变化显示；保存旧轮关联快照。

## Task 7：真实工作台 UI 和可访问操作

**Files:**
- Modify: `prototype/writing-workbench-ui.js`
- Modify: `prototype/index.html`
- Test: `tests/writing-workbench-ui.test.js`
- Test: `tests/helpers/writing-app.js`（仅当测试挂载需要）
- Test: `tests/helpers/writing-dom.js`（仅当当前 DOM 桩缺少真实行为）

- [x] 先写真实点击路径测试覆盖单元切换、材料关联、问题状态、路线推进、比较与从旧轮继续。
- [x] 确认测试因 UI 缺少控件/事件失败，再实现可键盘操作的表单和状态提示。
- [x] 检查窄屏无横向溢出、错误状态保留输入、切换版本不覆盖当前表单。

## Task 8：D 盘应用验收与阶段记录

**Files:**
- Create: `docs/superpowers/plans/2026-10-21-writing-core-c-acceptance.md`
- Modify: `docs/superpowers/plans/2026-10-21-writing-core-c-implementation.md`
- Modify: `docs/superpowers/specs/2026-10-20-writing-domain-expansion-design.md`

- [x] 重跑核心 C 相关测试、写作/存储/备份回归、`pnpm check` 和 `git diff --check`。
- [x] 在隔离 Electron 数据完成规格中的代表任务，并检查刷新恢复。
- [x] 在 390×844 和键盘操作下验收；真实模型与真机测试如实标注为未验证。
- [x] 记录与并行 PPT/社媒失败分开的测试结果，再把蓝图核心 C 状态改为已验收。

## 执行状态（2026-10-21）

核心 C 任务 1–8 已完成。专项串行回归覆盖写作工作台、基础包、存储与备份测试文件：281 项通过、0 失败；`pnpm check` 与 `git diff --check` 通过。

隔离 Electron 应用数据目录为 `.codex-acceptance/electron-profile-core-c-route-20261021`，调试端口 9223。此前在同一阶段已完成单元/材料范围、问题显式复核、提示词版本比较、旧轮分支、390×844 与键盘路径验收。本轮通过应用内导入一个仅供验收的自定义路线包，创建并保存普通文章，选用两步路线，逐步开始、填写结果与定位并显式确认；当前步骤进入提示词，步骤状态在刷新后恢复，路线/来源仍显示“未核验”，完成状态明确不代表专业认证。

模型服务未配置，未验证真实模型输出质量；未执行真机、Windows 安装包或便携版测试。验收路线包只证明实际 UI 接线、进度、提示词消费和恢复行为，不代表该示例方法已经过专业审查。

阶段验收详见 `2026-10-21-writing-core-c-acceptance.md`。
