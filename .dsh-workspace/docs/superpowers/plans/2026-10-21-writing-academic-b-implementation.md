# 学术 B：综述项目与批次覆盖实施计划

对应规格：`docs/superpowers/specs/2026-10-21-writing-academic-b-spec.md`
依赖：共用核心 A/B/C、学术 A  通过。
执行方式：当前代理串行推进；每项按失败测试、最小实现、定向回归和 D 盘应用验收执行，不使用子智能体。

## Task 1：学术综述内置包与来源映射

**Files:**
- Modify: `prototype/writing-pack-catalog.js`
- Test: `tests/writing-pack-catalog.test.js`

- [x] 先为包标识、版本、三种综述类型路线、来源章节、适用边界及未验证状态写失败测试。
- [x] 将 PRISMA 2020、PRISMA-ScR、PRISMA-S、Cochrane Handbook、JBI Manual 映射到自拟方法卡；不复制原文段落。
- [x] 确认包可在现有包管理器中停用/恢复，且普通文章包与提示词不受影响。

## Task 2：综述项目、文献快照与决定 schema

**Files:**
- Create: `prototype/academic-review.js`
- Modify: `tests/helpers/writing-app.js`
- Test: `tests/academic-review.test.js`

- [x] 先测综述类型、项目必填项、记录稳定 ID、题录快照、纳排/全文状态、双人分歧、裁定和提取字段。
- [x] 为叙述/范围/系统综述实现各自的必填数据和覆盖计算；不适用阶段不计为已完成筛选。
- [x] 限制每项目记录 1000 条、每批 1–5 条、每个摘录 1200 字；超限明确拒绝，不静默截断。
- [x] 测试项目刷新快照的新增/删除/重复预览，旧快照不因文献库更新而改变。

## Task 3：本机存储、迁移和备份边界

**Files:**
- Modify: `prototype/storage.js`
- Modify: `prototype/workspace-backup.js`
- Modify: `prototype/index.html`
- Test: `tests/storage.test.js`
- Test: `tests/workspace-backup.test.js`

- [x] 先测试旧工作区读取到空 `writingReviews`、保存失败时原状态不变以及 schema 缺失时非空数据拒绝写入。
- [x] 完整工作区备份保留已保存综述项目与快照；资料库备份排除；替换/合并、计数和未知字段白名单通过测试。
- [x] 只在项目显式开启保存后持久化；暂停保留既有历史，不写入后续修改。

## Task 4：综述协调器、筛选和批次

**Files:**
- Modify: `prototype/academic-review.js`
- Test: `tests/academic-review.test.js`

- [x] 先测新建、继续、暂停保存、删除、创建/刷新项目文献快照和按适用阶段生成批次。
- [x] 实现纳排理由、题名/摘要、全文获取、全文排除、双人决定及显式裁定状态转换。
- [x] 实现逐阶段覆盖统计；批次绑定固定记录 ID，新的文献只能进入预览后的新批次。
- [x] 所有项目操作保存失败都保留原状态并返回明确错误。

## Task 5：提示词、候选解析和人工确认

**Files:**
- Modify: `prototype/academic-review.js`
- Test: `tests/academic-review.test.js`

- [x] 为方案、筛选、提取和综合提示词写范围/来源/字数测试；综合只能取已确认纳入与已确认提取记录。
- [x] 为结构化候选 JSON 编写 schema 测试；拒绝未知文献 ID、重复 ID、非法决定、超长字段和超出批次的数据。
- [x] 候选进入待确认状态；逐条接受、修改或拒绝后才变更人工决定/提取状态；解析失败保留原始外部结果。
- [x] 超过 8000 字或来源预算时返回可读错误和建议拆分批次，不截断提示词。

## Task 6：资料库中的综述工作台 UI

**Files:**
- Create: `prototype/academic-review-ui.js`
- Modify: `prototype/index.html`
- Modify: `prototype/app.js`
- Modify: `tests/helpers/writing-app.js`
- Test: `tests/academic-review-ui.test.js`

- [x] 先覆盖资料库入口、新建/切换项目、类型专属字段、保存开关、文献快照预览、筛选决定和覆盖看板的点击路径。
- [x] 显示适用内置包、来源/许可和未核验边界；生成与编辑的提示词可复制，外部结果可粘贴并逐条复核。
- [x] 失败时保留表单和原决定；删除需确认；键盘焦点、窄屏和提示状态可见。

## Task 7：D 盘 Electron 验收和阶段收口

**Files:**
- Create: `docs/superpowers/plans/2026-10-21-writing-academic-b-acceptance.md`
- Modify: `docs/superpowers/plans/2026-10-21-writing-academic-b-implementation.md`
- Modify: `docs/superpowers/specs/2026-10-20-writing-domain-expansion-design.md`
- Modify: `package.json`

- [x] 运行学术 B 专项、知识库、写作包、存储/备份、应用页面测试、`pnpm check` 和 `git diff --check`。
- [x] 在独立 Electron 配置中完成叙述/范围/系统综述入口、模拟文献筛选、提取候选确认、未完成覆盖显示、保存重载和备份边界核对。
- [x] 检查 390×844、键盘、无页面/控制台错误；真实模型、真机及分发包状态如实记录。
- [x] 记录整仓失败与本阶段失败的边界；更新蓝图学术 B 状态后进入学术 C。
