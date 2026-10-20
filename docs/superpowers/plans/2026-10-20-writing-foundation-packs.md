# 写作专业基础包与来源管理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each task is assigned to a fresh subagent; the parent performs an independent specification review, then an independent code review before moving to the next task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有写作工作台中提供可追溯来源、可定制和可管理的专业基础包，并让普通文章首版规则通过基础包实际参与提示词生成。

**Architecture:** 沿用现有 UMD、原生 DOM、schema 白名单和本地工作区存储。新增聚焦的包 schema、包注册表/协调器与管理界面；内置包定义和可恢复的内置版本只读分离，用户修改作为带 `basePackId` 的自定义副本保存。普通文章现有行为保持兼容，只有明确选用的已审查包条目参与当前任务。

**Tech Stack:** Node.js 18+、原生 JavaScript/UMD、Electron 现有本地存储、Node `node:test`。

---

## 范围检查与分解

获批蓝图包含多套独立能力，不能在一份实现计划中同时开发材料解析、学术流程和所有文体。此计划只交付蓝图第 16 节“共用核心 A：三层基础包与来源管理”，并建立后续阶段能够依赖的包契约。

本阶段包括：基础包三层数据结构、来源和验证状态、内置普通文章规则迁移、包选择和实际提示词消费、包编辑/复制/导入导出/启停/恢复、保存及工作区备份、真实应用验收。自定义包只保存规则内容和用户提供的来源元数据；本阶段不承诺批量联网抓取 GitHub、自动更新开源内容或自动判定专业有效性。

后续独立规格与计划按获批设计顺序处理：统一材料导入/解析与来源定位；任务单元、问题和版本复核；学术文献处理与参考文献库；综述及覆盖批次；论文和学位论文；核引、审稿与投稿准备；结构化文档、视听社媒、小说和剧本。每份后续计划都必须以本阶段稳定的包接口为基础，不能宣称本计划已经交付这些能力。

## 项目文件职责

| 文件 | 职责 |
| --- | --- |
| `prototype/writing-pack-schema.js` | 安全规范化包、规则条目、来源、验证状态、层级引用和兼容版本 |
| `prototype/writing-pack-catalog.js` | 内置包与内置版本；初始内置普通文章包对应现有 `article` 配置 |
| `prototype/writing-pack-coordinator.js` | 有界的读取、选择、复制、编辑、导入预览、保存、导出、停用和恢复操作 |
| `prototype/writing-pack-ui.js` | 在写作工作台挂载包选择与独立管理区，显示来源、适用范围和验证状态 |
| `prototype/writing-workbench-schema.js` | 保留旧文章/轮次字段，新增实际采用的包与规则引用字段 |
| `prototype/writing-workbench-prompts.js` | 组合本轮明确选用的包规则、来源和提示词，不默认拼接所有规则 |
| `prototype/writing-workbench-coordinator.js` | 为当前轮解析选中包版本；记录实际采用的包和条目快照 |
| `prototype/storage.js` | 写作基础包数据清洗、白名单、迁移和凭证清理 |
| `prototype/workspace-backup.js` | 将自定义包纳入工作区备份；不进入“仅资料库”备份 |
| `prototype/index.html` | 按依赖顺序加载包 schema、catalog、coordinator、UI 脚本 |
| `prototype/app.js` | 创建包协调器、连接工作区 UI；维持原文章入口 |
| `tests/writing-pack-*.test.js` | 包契约、来源、生命周期和管理 UI 的专项测试 |
| `tests/storage.test.js`、`tests/workspace-backup.test.js` | 迁移、清洗、保存暂停兼容和备份往返/冲突测试 |
| `tests/helpers/writing-app.js`、`tests/helpers/writing-dom.js` | 为真实应用接线和实际控件事件补充测试支撑 |

除非测试证明职责边界阻塞本阶段，不重构既有普通文章工作台或整个知识库系统。保留 `writingArticles`、`writingMemories` 的既有字段、默认值、备份行为和文章记忆 ID。

## 固定数据接口

所有对象由 `writing-pack-schema.js` 白名单规范化，未知字段丢弃，任何嵌套层级都不得保留凭证。接口遵循以下字段，不以任意模型返回对象直接进入存储：

```js
{
  id: "writing-pack-academic-literature-review",
  name: "学术写作 / 文献综述",
  layer: "task", // core | genre | task
  genre: "academic",
  taskType: "literature-review",
  version: 1,
  builtin: true,
  basePackId: "",
  enabled: true,
  applicability: { tasks: ["literature-review"], languages: ["zh", "en"], exclusions: ["不用于系统综述筛选"] },
  clarifications: [{ id: "review-type", question: "本次综述属于哪种类型？", required: true, when: "规划综述路线前" }],
  materials: [{ id: "source-corpus", purpose: "研究证据", required: true, acceptedTypes: ["pdf", "docx", "ris", "bibtex"] }],
  requirements: [{ id: "separate-reporting-quality", statement: "报告完整性不等同于研究质量", sourceIds: ["source-1"], verificationStatus: "source-reviewed" }],
  methods: [{ id: "scope", title: "界定综述范围", guidance: "说明研究问题、范围和纳排条件。", applicability: ["系统综述"], sourceIds: ["source-1"], verificationStatus: "source-reviewed" }],
  prompts: [{ id: "review-outline", taskType: "literature-review", content: "根据已确认范围组织综述提纲；未提供的检索结果标为缺失。", sourceIds: ["source-1"], verificationStatus: "unverified" }],
  structures: [{ id: "review-output", taskType: "literature-review", sections: ["研究问题", "文献范围", "主题综合", "局限"] }],
  style: [{ id: "academic-neutral", statement: "保持结论强度与证据一致。", sourceIds: ["source-1"], verificationStatus: "source-reviewed" }],
  terminology: [{ id: "screening", term: "筛选", definition: "按已声明的纳入与排除规则判断文献。", sourceIds: ["source-1"] }],
  evidenceRules: [{ id: "claim-source", statement: "综合性论断应能回指实际处理的来源和位置。", sourceIds: ["source-1"], verificationStatus: "source-reviewed" }],
  routes: [{ id: "review-route", stages: [{ id: "scope", inputs: ["review-question"], outputs: ["scope-record"], checks: ["scope-check"], skippable: false, returnWhenMissing: ["review-question"] }] }],
  checks: [{ id: "scope-check", statement: "范围与纳入/排除条件已记录。", sourceIds: ["source-1"], verificationStatus: "source-reviewed" }],
  repairs: [{ id: "missing-scope", issue: "综述类型或范围未说明", action: "先生成范围澄清提示词，不直接筛选或综合文献。", sourceIds: ["source-1"] }],
  nextSteps: [{ id: "scope-before-screening", when: "范围已确认", action: "进入检索与筛选规划", sourceIds: ["source-1"] }],
  examples: [{ id: "example-1", kind: "positive", taskType: "literature-review", input: "已确认的研究问题与文献范围", prompt: "请按主题比较文献，并为论断保留来源位置。", result: "按主题组织且每项综合观点都有来源位置。", notes: "示例用于解释格式，不证明方法普遍有效。", verificationStatus: "unverified" }],
  sources: [{ id: "source-1", title: "PRISMA 2020", url: "https://www.prisma-statement.org/prisma-2020", locator: "Checklist", version: "2020 statement", license: "逐项核对后填写", checkedAt: "2026-10-20", applicability: "系统综述报告完整性", limitations: "不用于评价方法学质量" }],
  createdAt: "ISO-8601",
  updatedAt: "ISO-8601"
}
```

接口枚举：`layer` 为 `core|genre|task`；`verificationStatus` 为 `unverified|source-reviewed|case-validated`。包须涵盖澄清、材料规则、专业要求、方法、专属提示词、结构、风格、术语、证据规则、路线、检查、修复策略、下一步条件、案例和来源；不适用的项可为空数组，但 schema 必须支持其规范化。`builtin` 由 catalog 决定，导入内容不能通过自报把自定义资料变成内置包。导入的验证状态强制回退至 `unverified`，用户审查来源后才可显式升级。版本为正整数。所有 id 在所属包或来源集合中非空且唯一。文本和数组有明确长度/数量上限，由 schema 导出常量，并在 UI 限制与测试中使用同一常量。

内置包由 catalog 提供不可变原版。用户按“编辑”时创建 `builtin:false`、`basePackId` 指向内置包的自定义副本，不更改内置内容；删除该副本或选择“恢复内置”回到原版。用户启停内置包的覆盖记录属于独立用户设置 `writingPackSettings`，不改内置包定义。

写作历史使用包 ID、包版本、所用条目 ID 及最小内容快照记录当轮依据。快照不含包管理元数据、无关示例或整份未选择包；删除作品时随作品历史删除。包删除不删除历史轮次。

存储新增两个可选集合：`writingPacks` 保存自定义副本；`writingPackSettings` 保存内置包启停覆盖。使用集合而不是任意对象，以复用现有备份的稳定 ID、合并冲突和结构校验。`writingPackSettings` 每项至少有 `id`（对应内置包 ID）、`enabled`（布尔）、`updatedAt`；同 ID 导入冲突保留当前版本并报告，不静默覆盖。

## 任务 1：基础包 schema 和普通文章内置基线

**Files:**
- Create: `prototype/writing-pack-schema.js`
- Create: `prototype/writing-pack-catalog.js`
- Test: `tests/writing-pack-schema.test.js`
- Test: `tests/writing-pack-catalog.test.js`

- [ ] **Step 1: 先写失败测试**

测试覆盖三层 enum、固定 verification enum、正整数版本、完整内容契约字段、包/条目/来源嵌套白名单、每个集合的唯一 ID、文本/数组上限、异常对象安全处理、来源元数据、`builtin` 不可由输入伪造、自定义 `basePackId`、article 内置包与既有七项配置等价、catalog 深层不可变，以及 UMD 全局导出。

运行：`node --test tests/writing-pack-schema.test.js tests/writing-pack-catalog.test.js`

预期：FAIL，明确指出新模块或规范化函数缺失。

- [ ] **Step 2: 实现最小 schema 与 catalog**

提供 `normalizeWritingPack`、`normalizeWritingPackSettings`、`normalizeWritingPackCollection` 和 `getBuiltinWritingPacks`。用户输入经 catalog 构建时也强制设置 `builtin:false`。catalog 的首个包从当前普通文章配置逐项迁移，输出检查项、风格、风险和提示词指令，确保旧文案/行为保持一致。不要把未核对的候选研究项目预填成 `source-reviewed`。

- [ ] **Step 3: 运行专项测试并确认通过**

运行：`node --test tests/writing-pack-schema.test.js tests/writing-pack-catalog.test.js`

预期：全部通过，未知字段和嵌套凭证不出现在规范化结果中。

- [ ] **Step 4: 检查语法和 diff**

运行：`node --check prototype/writing-pack-schema.js; node --check prototype/writing-pack-catalog.js; git diff --check`

预期：退出码 0，无空白错误。

- [ ] **Step 5: 提交**

```powershell
git add prototype/writing-pack-schema.js prototype/writing-pack-catalog.js tests/writing-pack-schema.test.js tests/writing-pack-catalog.test.js
git commit -m "feat: 增加写作基础包数据契约"
```

Task 1 的实现代理结束后，父任务先做规格符合性审查；通过后由新代理做代码质量审查。发现问题时原代理修复、重跑测试，再按顺序复审。

## 任务 2：本地存储迁移和安全白名单

**Files:**
- Modify: `prototype/storage.js`
- Test: `tests/storage.test.js`
- Test: `tests/writing-pack-schema.test.js`

- [ ] **Step 1: 先写失败测试**

覆盖空状态中两个新集合为 `[]`、旧状态迁移不丢失用户数据、自定义包/设置通过专用 schema 清洗、包条目及来源嵌套 `apiKey/accessToken/password` 被剔除、无 schema 时非空基础包数据显式抛 `WritingSchemaUnavailableError`、空集合无需 schema、文章保存暂停不阻止包/设置保存、`restoreWriting` 导入恢复及未知字段不持久化。

运行：`node --test tests/storage.test.js --test-name-pattern="writing pack|基础包"`

预期：至少新增行为失败；如果 Node 版本参数顺序不支持名称筛选，直接运行 `node --test tests/storage.test.js`，并记录基线失败。

- [ ] **Step 2: 实现存储接线**

将 `writingPacks`、`writingPackSettings` 加入 `STATE_FIELDS` 和 `createEmptyState`。在 `sanitizeWritingState` 同时清洗文章、记忆、包与设置，空数据快捷返回也必须包含两个新集合。非空包数据必须调用 Task 1 schema；沿用外层递归去凭证及内层包白名单。保留现有暂停文章快照逻辑。

- [ ] **Step 3: 运行存储测试**

运行：`node --test tests/storage.test.js`

预期：该文件全部通过；旧版文章/记忆迁移、暂停冻结和恢复相关测试保持通过。

- [ ] **Step 4: 运行语法与差异检查**

运行：`node --check prototype/storage.js; git diff --check`

预期：退出码 0。

- [ ] **Step 5: 提交**

```powershell
git add prototype/storage.js tests/storage.test.js tests/writing-pack-schema.test.js
git commit -m "feat: 持久化写作基础包"
```

完成后依序做规格审查与代码审查；重点检查旧数据不被改写、包停用不影响文章历史、任何凭证字段无法进入包快照或备份。

## 任务 3：基础包备份与冲突恢复

**Files:**
- Modify: `prototype/workspace-backup.js`
- Test: `tests/workspace-backup.test.js`

- [ ] **Step 1: 先写失败测试**

覆盖工作区备份包含两个新集合和正确计数；知识库专属备份不包含包；替换导入保留有效包并清洗凭证；合并导入追加不同 ID、相同 ID 冲突保留当前版本并报告；重复/空 ID 拒绝；旧备份缺少新增字段时可迁移到空数组；备份摘要显示包数量；替换空集合可明确清空目标包数据。

运行：`node --test tests/workspace-backup.test.js`

预期：新增断言因导出字段/集合校验未支持而失败。

- [ ] **Step 2: 接入两个可选集合**

把 `writingPacks`、`writingPackSettings` 加入 `OPTIONAL_WORKSPACE_COLLECTIONS` 和 `WORKSPACE_DATA_FIELDS`；将其纳入空值默认、摘要计数、允许键、id 唯一性、清洗、替换和 `mergeCollection`。只复用 storage 的规范化结果，不引入对象专属合并策略。

- [ ] **Step 3: 验证备份专项**

运行：`node --test tests/workspace-backup.test.js`

预期：全部通过，包括旧备份兼容和已存在的凭证深层清洗测试。

- [ ] **Step 4: 检查并提交**

运行：`node --check prototype/workspace-backup.js; git diff --check`

```powershell
git add prototype/workspace-backup.js tests/workspace-backup.test.js
git commit -m "feat: 在工作区备份中包含写作基础包"
```

完成后依序做规格审查与代码审查；确认库范围备份不泄漏包或写作文章，合并冲突没有静默覆盖用户版本。

## 任务 4：基础包选择、编辑与提示词实际消费

**Files:**
- Modify: `prototype/writing-workbench-schema.js`
- Modify: `prototype/writing-workbench-prompts.js`
- Modify: `prototype/writing-workbench-coordinator.js`
- Test: `tests/writing-workbench-schema.test.js`
- Test: `tests/writing-workbench-prompts.test.js`
- Test: `tests/writing-workbench-coordinator.test.js`

- [ ] **Step 1: 先写红灯测试**

覆盖默认 article 使用内置基线时，现有生成提示词仍包含原检查和风险要求；显式选取额外包后只注入被选中的 enabled 条目和来源；停用、未知 ID、不同任务类型和不适用领域条目不进入提示词；用户临时修正规则优先且不改内置版本；一轮生成后记录稳定 pack ID/版本/条目 ID/必要快照；重新打开历史轮使用旧快照而非当前新版本。

运行：`node --test tests/writing-workbench-schema.test.js tests/writing-workbench-prompts.test.js tests/writing-workbench-coordinator.test.js`

预期：新增行为失败；原 article 专项测试继续通过。

- [ ] **Step 2: 增加兼容字段和纯函数选择**

在文章/轮次的严格白名单中添加可选 `packSelections` 和 `packSnapshot`。写一个无副作用 selector：输入标准化 workspace、所有可用包、选择 ID 和任务类型；输出适用启用的条目、来源、被跳过条目的原因。未知包降级为既有 article 默认包，不把未知 genre 伪装成 article 专用验证结论。

- [ ] **Step 3: 消费包条目并保留旧行为**

将当前 article 硬编码输出要求映射为内置 article 包内容；提示词只添加本轮明确采用的包规则和来源元数据，设置固定上下文预算。记录包快照只包含实际采用项。旧文章缺少 pack 字段时按内置 article 默认值读取，存盘格式不得要求批量迁移旧文章。

- [ ] **Step 4: 跑专项并验证文章回归**

运行：`node --test tests/writing-workbench-schema.test.js tests/writing-workbench-prompts.test.js tests/writing-workbench-coordinator.test.js`

预期：全部通过；既有普通文章提示词、未知文体隔离和文章保存行为不回归。

- [ ] **Step 5: 语法检查并提交**

运行：`node --check prototype/writing-workbench-schema.js; node --check prototype/writing-workbench-prompts.js; node --check prototype/writing-workbench-coordinator.js; git diff --check`

```powershell
git add prototype/writing-workbench-schema.js prototype/writing-workbench-prompts.js prototype/writing-workbench-coordinator.js tests/writing-workbench-schema.test.js tests/writing-workbench-prompts.test.js tests/writing-workbench-coordinator.test.js
git commit -m "feat: 按所选基础包生成写作提示词"
```

完成后依序做规格审查与代码审查；重点复核包来源确实进入提示词，未选中/停用包确实不进入，历史快照不会因后续更新改写。

## 任务 5：基础包管理协调器

**Files:**
- Create: `prototype/writing-pack-coordinator.js`
- Test: `tests/writing-pack-coordinator.test.js`

- [ ] **Step 1: 先写行为测试**

测试读取返回防御性副本；列出内置、用户自定义和选中状态；内置不可原地改写；基于内置包编辑会生成带 `basePackId` 的副本；自定义包可新建、编辑、复制、启用/停用、删除；恢复内置移除覆盖；导入只校验和预览，不自动保存；用户确认后再保存；导出只导出用户明确选择的自定义包；碰撞 ID 返回明确冲突；持久化失败保留内存表单/原数据且报错；无持久化依赖时只读操作可用而写操作明确失败。

运行：`node --test tests/writing-pack-coordinator.test.js`

预期：FAIL，协调器模块/接口不存在。

- [ ] **Step 2: 实现无 UI 的纯协调器 API**

导出 `createWritingPackCoordinator({ getState, persistState, builtinCatalog, now, newId })`，至少提供 `listPacks`、`getPack`、`getSelection`、`selectPacks`、`createPack`、`duplicatePack`、`updatePack`、`setPackEnabled`、`deletePack`、`restoreBuiltin`、`previewImport`、`confirmImport`、`exportPacks`。所有返回值为规范化副本；所有持久化写入走串行状态写入并检查错误，与写作协调器一致。

- [ ] **Step 3: 验证 coordinator 专项**

运行：`node --test tests/writing-pack-coordinator.test.js`

预期：全部通过；模拟磁盘失败测试确认现有自定义包不丢失。

- [ ] **Step 4: 检查并提交**

运行：`node --check prototype/writing-pack-coordinator.js; git diff --check`

```powershell
git add prototype/writing-pack-coordinator.js tests/writing-pack-coordinator.test.js
git commit -m "feat: 管理写作专业基础包"
```

完成后依序做规格审查与代码审查；重点检查内置包不可变、导入确认、冲突处理和写入失败保护。

## 任务 6：工作台包管理 UI 和浏览器加载

**Files:**
- Create: `prototype/writing-pack-ui.js`
- Modify: `prototype/index.html`
- Modify: `prototype/app.js`
- Modify: `prototype/writing-workbench-ui.js`
- Modify: `tests/helpers/writing-dom.js`
- Modify: `tests/helpers/writing-app.js`
- Test: `tests/writing-pack-ui.test.js`
- Test: `tests/storage.test.js`

- [ ] **Step 1: 写真实控件行为测试**

通过 DOM helper 渲染/操作真实生成的控件，覆盖三层筛选、适用范围/来源/验证状态展示、查看具体来源、选中包后确实改变实际提示词、内置编辑生成副本、复制/新增、停用不再采用、恢复内置、删除二次确认、导入预览拒绝时不写入/确认后写入、导出结果可解析，以及键盘可聚焦的按钮和选项。

运行：`node --test tests/writing-pack-ui.test.js`

预期：FAIL，UI 模块及控件不存在。

- [ ] **Step 2: 实现简明管理区**

新增独立的可展开“专业基础包”管理区，不改变首版普通文章主表单基本路径。列表显示名称、层级、文体/任务、来源和验证状态；详情显示具体文件/版本/许可/适用范围/限制。提供图标/文字语义清楚的新增、编辑、复制、停用、恢复、导入、导出和删除操作；危险删除要求确认，导入先预览。

- [ ] **Step 3: 接入实际选择和运行时脚本**

使用 `app.js` 创建 coordinator，并将 UI controller 接入同一写作工作台。HTML 加载顺序必须为 knowledge/schema 依赖之后、storage 之前/之后按 UMD 依赖保证 schema 可用，coordinator 在 UI 之前，app 最后。普通文章新建/修改、模型预览、复制均读取同一明确选择。

- [ ] **Step 4: 跑 UI 与脚本加载测试**

运行：`node --test tests/writing-pack-ui.test.js tests/storage.test.js`

预期：全部通过；现有页面 `/` 和 `/prototype/index.html` 的所有新脚本返回 200、UMD 全局可实例化，加载顺序通过现有真实 HTTP/VM 测试。

- [ ] **Step 5: 验证全量测试与语法**

运行：`pnpm check`

运行：`pnpm test`

预期：两个命令退出码均为 0。若有失败，先定位本次回归并修复，不把环境/权限跳过计为通过。

- [ ] **Step 6: 提交 UI 和接线**

```powershell
git add prototype/writing-pack-ui.js prototype/index.html prototype/app.js prototype/writing-workbench-ui.js tests/helpers/writing-dom.js tests/helpers/writing-app.js tests/writing-pack-ui.test.js tests/storage.test.js
git commit -m "feat: 在写作工作台管理专业基础包"
```

完成后依序做规格审查与代码审查；只有通过后才开始真实应用验收。

## 任务 7：真实应用端到端验收与兼容审计

**Files:**
- Modify: `docs/superpowers/specs/2026-10-20-writing-domain-expansion-design.md`（仅更新阶段状态，不改设计决策）
- Create: `docs/superpowers/plans/2026-10-20-writing-foundation-packs-acceptance.md`
- No implementation files unless验收发现有缺陷；修复须回到所属任务并重新双审

- [ ] **Step 1: 启动真实应用并记录环境**

使用项目 `pnpm start` 和 `pnpm desktop` 入口，在独立 Electron 用户目录运行，确认测试基础包与真实用户数据隔离。若默认端口占用，选临近可用端口并验证 HTTP 可达。

- [ ] **Step 2: 验收真实 UI 流程**

实测普通文章旧流程；打开包管理；查看 article 内置规则来源；编辑产生副本并修改一条检查项；选用该副本生成提示词并确认来源实际出现；停用后确认不再使用；恢复内置后确认旧基线回归；创建、复制、导入预览拒绝/批准、导出、删除各操作符合确认与保存行为。

- [ ] **Step 3: 验收持久化与备份**

刷新和重启后确认用户自定义包、启停设置、文章历史和内置包版本正确；模拟导入同 ID 冲突确认当前数据保留；工作区备份恢复自定义包，知识库备份不含包；暂停文章历史保存不影响包管理写入。

- [ ] **Step 4: 验收窄屏、键盘和错误状态**

至少检查 390px 视口无横向滚动、列表内容换行、所有操作可键盘聚焦和操作、删除/导入/保存错误有可见反馈，导入取消/失败不改变原数据。

- [ ] **Step 5: 保存证据与交付记录**

记录浏览器/应用操作、关键截图、Console 错误、HTTP 结果、持久化/备份结果和未验证边界到 acceptance 文档。生产安装器未重打时只报告真实 Electron 开发应用验收，不声称安装版包含新包。

- [ ] **Step 6: 完成性提交**

```powershell
git add docs/superpowers/specs/2026-10-20-writing-domain-expansion-design.md docs/superpowers/plans/2026-10-20-writing-foundation-packs-acceptance.md
git commit -m "docs: 记录写作基础包应用验收"
```

## 计划自审

- **规格覆盖：** 本计划交付蓝图的可管理三层包、专业来源元数据、验证状态、用户编辑副本、提示词实际消费、选择/停用、导入确认、恢复内置、历史快照、持久化、备份、UI 和真实验收。文件/链接/图片/目录解析、文献引用关系、全库覆盖、专业评判及全部领域内容留给独立后续计划。
- **范围：** 仅第一共用基础包子项目，能独立运行并由当前文章规则验证。学术和其他文体在数据契约可承载，但没有具体专业包或专用工作流时不宣称已经支持。
- **兼容：** 旧 article 配置、记忆 namespace、保存开关、历史和两个备份范围均有回归覆盖；新包字段通过显式 schema 安全迁移。
- **无占位：** 所有任务给出具体文件、行为、测试命令和预期；运行时限制、实际模型调用与安装版验收如实记录。
- **接口一致：** 统一使用 `writingPacks`、`writingPackSettings`、`normalizeWritingPack`、`normalizeWritingPackSettings`、`normalizeWritingPackCollection` 与固定的 coordinator API。
- **独立审查门禁：** 每任务实现代理之后先规格审查，之后才做独立代码审查；发现问题先修复并复审，最后才进入下一任务；总集成后再由真实应用验收。
