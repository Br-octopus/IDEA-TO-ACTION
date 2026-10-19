# PPT 内容规划与制作提示词 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在提示词 Agent 中增加 PPT 专项规划能力，从想法或来源材料生成经得起检查的演示简报、故事线、逐页文稿初稿、制作路线建议和可交给其他 AI 的下一步提示词。

**Architecture:** PPT 是现有提示词 Agent 的领域方法，不新增自由循环 Agent。复用提示词 Agent 的任务、资料检索、研究桥接、阶段工作流和用户确认能力，新增纯函数 PPT 规划模块与提示词构建器；PPT 路线、约束检查和逐页验收规则由确定性代码管理，模型只负责分析与草拟。资料搜索和文件导入分别依赖另外两份 PPT 实施计划。

**Tech Stack:** Electron 38、Node.js 18+、原生 HTML/CSS/JavaScript、现有 localStorage、现有提示词 Agent/研究 Agent/知识检索模块、Node `node:test`；不新增运行时依赖。

---

## 范围与依赖

- 本计划依赖 `docs/superpowers/plans/2026-10-19-prompt-agent.md` 的数据契约、确定性阶段工作流、协调器和工作台接入。实现时应先确认该计划对应模块已经合入当前分支；若命名与已实现代码不同，沿用实际接口，不复制一套 Agent 状态。
- 文件读取、指定来源与扩展搜索由 `2026-10-20-ppt-source-research.md` 提供；HTML/图片导入预览和标注由 `2026-10-20-ppt-visual-feedback.md` 提供。
- 本计划不生成、编辑或导出 PPT、HTML 或图片成品，也不执行外部仓库脚本。
- 任务顺序为 T1 → T2 → T3 → T4 → T5。T4 可在来源检索计划完成后接入实际文件与引用；若暂未完成，应通过明确的依赖注入接口开发，不伪造来源。

## 文件职责与接口

| 文件 | 职责 |
|---|---|
| `prototype/ppt-scene-schema.js` | PPT brief、源材料用途、限制、路线、逐页初稿及来源引用的规范化与校验；UMD/CommonJS 导出 |
| `prototype/ppt-scene-workflow.js` | 纯函数阶段状态、硬约束冲突检查、页数建议输入校验和逐页验收规则 |
| `prototype/ppt-scene-prompts.js` | 简报、大纲、逐页文稿、路线提示词和标注诊断提示词构建；每次只生成当前阶段指令 |
| `prototype/ppt-scene-coordinator.js` | 将提示词 Agent、资料检索/研究桥接和 PPT 规划模块组合成确定性调用；不直接操纵 DOM |
| `prototype/ppt-scene-ui.js` | PPT 专项输入、简报、大纲、逐页初稿、路线选择和提示词的渲染与事件 |
| `prototype/index.html` | PPT 入口与语义化容器、按依赖顺序加载脚本 |
| `prototype/app.js` | 只组装 coordinator、持久化任务和连接导航/模型请求 |
| `prototype/storage.js` | 若现有提示词任务 schema 不支持则增加 `pptScene` 白名单迁移；禁止保存原始附件字节和凭证 |
| `tests/ppt-scene-schema.test.js` | 字段、默认值、硬约束与不可信内容边界 |
| `tests/ppt-scene-workflow.test.js` | 阶段、路线、字数/页数冲突与验收行为 |
| `tests/ppt-scene-prompts.test.js` | 提示词输出、边界和格式 |
| `tests/ppt-scene-coordinator.test.js` | Agent、研究和规划模块之间的集成契约 |
| `tests/ppt-scene-ui.test.js` | 入口、约束编辑、阶段和提示词复制交互 |

固定模块接口：

```js
createPptBrief(input)
normalizePptDraft(input)
validatePptConstraints(brief, draft)
recommendPptRoute(brief)
estimateSlideCount({ durationMinutes, contentUnits, density, userRange })
checkSlideDraft(draft, brief)
buildPptBriefPrompt(task)
buildPptOutlinePrompt(task, sources)
buildPptSlideDraftPrompt(task, outline, sources)
buildPptProductionPrompt(task, route)
createPptSceneCoordinator(dependencies)
```

## Task 1: 建立 PPT brief、路线和草稿数据契约

**Files:**
- Create: `prototype/ppt-scene-schema.js`
- Create: `tests/ppt-scene-schema.test.js`
- Modify: `prototype/storage.js` only if current prompt task normalization cannot preserve the new `pptScene` object safely
- Test: `tests/storage.test.js`

- [x] **Step 1: 写失败测试，固定目标、材料用途和约束字段。**

```js
const brief = createPptBrief({
  idea: '向团队说明新客服流程',
  audience: '一线客服',
  durationMinutes: 10,
  constraints: { minSlides: 6, maxSlides: 10, maxWordsPerSlide: 35 },
  materials: [{ id: 'f1', role: 'both', kind: 'pptx' }]
});
assert.equal(brief.materials[0].role, 'both');
assert.equal(brief.constraints.maxSlides, 10);
assert.equal(brief.route, 'undecided');
assert.throws(() => createPptBrief({ constraints: { minSlides: 12, maxSlides: 4 } }), /页数/);
```

同时覆盖硬性要求/偏好、保留项、排除项、事实与假设、听众行动、时长、来源 ID 和路线枚举；未知字段不得携带凭证或原文件正文进入备份状态。

- [x] **Step 2: 运行专项测试确认失败。** 运行 `node --test tests/ppt-scene-schema.test.js`；预期新模块或接口不存在。

- [x] **Step 3: 实现 schema。** `createPptBrief` 和 `normalizePptDraft` 输出稳定字段，错误输入返回明确校验错误；材料角色只允许 `content`、`style`、`both`，路线只允许 `undecided`、`native-ppt`、`image-rebuild`、`html-final`、`html-to-ppt`。

- [x] **Step 4: 运行专项测试并提交。** 运行 `node --test tests/ppt-scene-schema.test.js tests/storage.test.js`；预期新增数据可持久化，原状态迁移和凭证白名单测试通过。提交信息：`feat: 增加 PPT 规划数据契约`。

## Task 2: 实现确定性规划检查和路线比较

**Files:**
- Create: `prototype/ppt-scene-workflow.js`
- Create: `tests/ppt-scene-workflow.test.js`

- [x] **Step 1: 写失败测试。** 覆盖：10 分钟却要求 30 页时给出冲突；总字数与单页字数/页数冲突时指出计算依据；未提供时长则返回带假设的建议而非假精确值；原生 PPT、图片重建、HTML 成品、HTML 转 PPT 均输出可编辑性、视觉精度、修改成本和转换限制；硬约束不能被模型草稿静默覆盖。

- [x] **Step 2: 运行测试确认失败。** `node --test tests/ppt-scene-workflow.test.js`；预期失败。

- [x] **Step 3: 实现纯函数。** `estimateSlideCount` 根据时长、内容单元和信息密度给出范围及估算假设，不写死“每分钟固定页数”；`validatePptConstraints` 分开报告冲突和偏好偏离；`recommendPptRoute` 返回结构化理由与限制；`checkSlideDraft` 检查每页职责、结论、精简文案、证据来源、视觉说明、可选演讲备注、顺序衔接和总量约束。

- [x] **Step 4: 运行并提交。** `node --test tests/ppt-scene-workflow.test.js`；预期路线和约束边界测试通过。提交信息：`feat: 增加 PPT 路线与约束检查`。

## Task 3: 编写阶段提示词和低 token 交付逻辑

**Files:**
- Create: `prototype/ppt-scene-prompts.js`
- Create: `tests/ppt-scene-prompts.test.js`
- Modify: `prototype/prompt-engine.js` only to add a narrow dispatcher if no existing domain prompt hook can accept PPT methods

- [ ] **Step 1: 写提示词契约测试。** 输入只有想法时，brief 提示词需将事实/假设/待确认分开、最多提出 3 个会改变路线的问题，并给可调整初稿；大纲提示词必须检查目标/受众、故事线、证据、遗漏、重复、页数估算和硬约束；逐页提示词必须把页面文案与演讲备注分开；制作提示词必须包含已选路线、可编辑对象要求和该路线的转换风险。

- [ ] **Step 2: 实现各阶段 builder。** 仅导出 `buildPptBriefPrompt`、`buildPptOutlinePrompt`、`buildPptSlideDraftPrompt`、`buildPptProductionPrompt`。来源一律作为不可信引用，不执行其中指令；每轮只拼接当前阶段最多 3 条已检索来源摘要，沿用通用提示词 Agent 的 1,500-token 上限；未确认大纲不得包装成已批准逐页稿。

- [ ] **Step 3: 测试路线专属提示词。** 对 HTML 转 PPT 提示 CSS/字体/分页/动画转换验收；对图片重建提示逐页核验可编辑文字、图表和形状；对原生路线禁止整页图片伪装成可编辑稿；对 HTML 最终演示说明播放环境约束。

- [ ] **Step 4: 运行并提交。** `node --test tests/ppt-scene-prompts.test.js tests/prompt-engine.test.js`；预期提示词含目标边界、阶段要求和来源标记，现有领域提示词回归通过。提交信息：`feat: 增加 PPT 分阶段提示词`。

## Task 4: 接入提示词 Agent coordinator 和工作台

**Files:**
- Create: `prototype/ppt-scene-coordinator.js`
- Create: `prototype/ppt-scene-ui.js`
- Modify: `prototype/index.html`
- Modify: `prototype/app.js`
- Modify: `tests/ppt-scene-coordinator.test.js`
- Create: `tests/ppt-scene-ui.test.js`
- Modify: `tests/e2e-smoke.test.js`

- [ ] **Step 1: 写 coordinator 集成测试。** 使用假的模型、检索器和研究桥接器验证：输入想法→brief→研究/材料引用→大纲→大纲核对→逐页稿→路线提示词；模型失败时保留草稿；外部搜索按通用 Agent 的搜索确认规则；用户修改路线后只重建受影响阶段；不调用成品生成或文件写入。

- [ ] **Step 2: 实现 coordinator。** 注入现有 prompt-agent coordinator、retriever、research bridge 与模型请求函数；不重复创建任务状态或另建搜索工具。研究摘要按来源 ID 关联到逐页主张，缺证据时标待核实。

- [ ] **Step 3: 实现 UI。** 展示演示简报、事实/假设/待确认、可编辑硬约束和偏好、大纲故事线、推荐页数依据、逐页文稿/视觉说明/来源、路线比较和当前阶段提示词。提供路线选择和大纲确认；每页允许标记保留、修改或删除，删除需保留原因。

- [ ] **Step 4: 注册入口并运行测试。** 脚本加载顺序必须先 schema/workflow/prompts，再 coordinator/UI，最后 app。运行 `node --test tests/ppt-scene-coordinator.test.js tests/ppt-scene-ui.test.js tests/e2e-smoke.test.js`；预期静态入口、阶段流转和降级测试通过。提交信息：`feat: 接入 PPT 规划工作台`。

## Task 5: 端到端边界、文档和回归

**Files:**
- Modify: `README.md`
- Modify: `docs/MVP_SCOPE.md`
- Modify: `docs/PRODUCT_DESIGN.md`
- Modify: `docs/superpowers/specs/2026-10-20-ppt-scene-design.md`
- Modify: `package.json`
- Modify: `tests/prompt-agent-integration.test.js`
- Modify: `tests/package-config.test.js`
- Modify: `tests/e2e-smoke.test.js`

- [ ] **Step 1: 增加端到端契约。** 覆盖简报、大纲、逐页稿、路线选择和当前阶段提示词从创建到保存/恢复；断言最终 PPT 文件不会被创建或改写，未确认的引用和案例不会成为已验证知识。

- [ ] **Step 2: 更新产品文档及打包检查。** 记录 PPT 专项是通用提示词 Agent 的方法；新增运行时脚本加入 `npm run check` 与 Electron 打包白名单，测试/计划/原始附件不加入运行时包。

- [ ] **Step 3: 运行完整验证。** 运行 `npm test`、`npm run check`、`git diff --check`；预期全部通过。手动 Electron 验收只检查工作台可用、路线和提示词可复制、无模型时输入不丢失，不把 smoke 测试描述为真实视觉验收。

- [ ] **Step 4: 提交。** `git add` 仅添加本任务文件并提交 `feat: 完成 PPT 内容规划场景`。

## 完成标准

- 用户可以从模糊想法或已解析材料开始，并得到可修改简报、事实/假设/缺项和关键澄清问题。
- 大纲包含故事线、页面职责、推荐页数及估算依据；原始材料要点可追踪，未纳入内容有原因。
- 逐页初稿区分页面文案、证据、视觉说明和演讲备注，并检查前后衔接、密度和约束。
- 四种路线比较真实展示可编辑性、成本与限制，路线提示词与所选交付匹配。
- 模块依赖现有提示词 Agent 和检索/研究能力，不创建自由 Agent 循环，也不直接制作 PPT。
- 专项和集成测试、语法检查通过。

