# PPT 内容规划与制作提示词 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在提示词 Agent 中增加 PPT 专项规划能力，从想法或来源材料生成任务简报、临时规划、资料增强版大纲、完整逐页文稿、制作路线以及可适配目标 AI 的阶段/完整提示词。

**Architecture:** PPT 是现有提示词 Agent 的领域方法，不新增自由循环 Agent。复用提示词 Agent 的任务、资料检索、研究桥接、阶段工作流和用户确认能力，新增纯函数 PPT 规划模块与提示词构建器；PPT 路线、约束检查、重跑范围和逐页验收规则由确定性代码管理，模型只负责语义分析与草拟。流程先生成可编辑任务简报和临时规划，再调用资料计划做语义复筛与定向研究，最后生成资料增强版大纲。阶段提示词和完整提示词必须从同一份已确认任务状态生成；资料搜索、文件解析和视觉反馈分别依赖另外两份 PPT 实施计划。

**Tech Stack:** Electron 38、Node.js 18+、原生 HTML/CSS/JavaScript、现有 localStorage、现有提示词 Agent/研究 Agent/知识检索模块、Node `node:test`；不新增运行时依赖。

---

## 范围与依赖

- 本计划依赖 `docs/superpowers/plans/2026-10-19-prompt-agent.md` 的数据契约、确定性阶段工作流、协调器和工作台接入。实现时应先确认该计划对应模块已经合入当前分支；若命名与已实现代码不同，沿用实际接口，不复制一套 Agent 状态。
- 文件读取、指定来源与扩展搜索由 `2026-10-20-ppt-source-research.md` 提供；HTML/图片导入预览和标注由 `2026-10-20-ppt-visual-feedback.md` 提供。
- 资料计划返回按页/章节的相关性、材料角色、来源页码、解析质量和运行依据；本计划不重新实现本机文件扫描、解析器或本地/外部搜索。
- 反馈计划返回轻量预检、用户标注、逐页验收等级和版本差异；本计划负责把确认后的反馈转为诊断和下一阶段提示词。
- 本计划不生成、编辑或导出 PPT、HTML 或图片成品，也不执行外部仓库脚本。
- 任务顺序为 T1 → T2 → T3 → T4 → T5。T4 可在来源检索计划完成后接入实际文件与引用；若暂未完成，应通过明确的依赖注入接口开发，不伪造来源。T4 同时预留反馈诊断、局部更新和版本重跑接口。

## 文件职责与接口

| 文件 | 职责 |
|---|---|
| `prototype/ppt-scene-schema.js` | PPT 任务简报、临时/增强版规划、源材料用途、风格优先级、目标 AI 能力、限制、路线、逐页初稿、来源引用和版本的规范化与校验；UMD/CommonJS 导出 |
| `prototype/ppt-scene-workflow.js` | 纯函数阶段状态、临时/增强版规划迁移、硬约束冲突检查、页数/密度建议、局部重跑范围和逐页验收规则 |
| `prototype/ppt-scene-prompts.js` | 简报、大纲、逐页文稿、路线、目标 AI 适配、阶段/完整提示词和标注诊断提示词构建；每次只发送当前阶段所需上下文 |
| `prototype/ppt-scene-coordinator.js` | 将提示词 Agent、资料检索/研究桥接、视觉反馈和 PPT 规划模块组合成确定性调用；记录运行依据，不直接操纵 DOM 或生成成品 |
| `prototype/ppt-scene-ui.js` | PPT 专项输入、简报、临时/增强版大纲、逐页编辑、聊天修改、路线选择、目标 AI、阶段/完整提示词和重跑版本的渲染与事件 |
| `prototype/index.html` | PPT 入口与语义化容器、按依赖顺序加载脚本 |
| `prototype/app.js` | 只组装 coordinator、持久化任务和连接导航/模型请求 |
| `prototype/storage.js` | 若现有提示词任务 schema 不支持则增加 `pptScene` 白名单迁移；禁止保存原始附件字节和凭证 |
| `tests/ppt-scene-schema.test.js` | 字段、默认值、硬约束与不可信内容边界 |
| `tests/ppt-scene-workflow.test.js` | 阶段、临时/增强版规划、路线、字数/页数/密度冲突、局部重跑和验收行为 |
| `tests/ppt-scene-prompts.test.js` | 阶段/完整提示词、目标 AI 能力适配、共同上下文和不可信来源边界 |
| `tests/ppt-scene-coordinator.test.js` | Agent、研究、反馈和规划模块之间的集成契约、版本和运行依据 |
| `tests/ppt-scene-ui.test.js` | 入口、简报/逐页编辑、聊天修改、阶段/完整提示词、重跑与版本恢复交互 |

固定模块接口：

```js
createPptBrief(input)
normalizePptDraft(input)
createPptTemporaryPlan(task, brief)
mergePptResearchIntoPlan(plan, research)
validatePptConstraints(brief, draft)
recommendPptRoute(brief)
estimateSlideCount({ durationMinutes, contentUnits, density, userRange })
checkSlideDraft(draft, brief)
selectPptRerunScope(request)
buildPptBriefPrompt(task)
buildPptOutlinePrompt(task, sources)
buildPptSlideDraftPrompt(task, outline, sources)
buildPptProductionPrompt(task, route)
buildPptFullPrompt(task, mode)
createPptSceneCoordinator(dependencies)
```

## Task 1: 建立 PPT brief、路线和草稿数据契约

**Files:**
- Create: `prototype/ppt-scene-schema.js`
- Create: `tests/ppt-scene-schema.test.js`
- Modify: `prototype/storage.js` only if current prompt task normalization cannot preserve the new `pptScene` object safely
- Test: `tests/storage.test.js`

- [ ] **Step 1: 写失败测试，固定目标、材料用途和约束字段。**

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

同时覆盖硬性要求/偏好、保留项、排除项、事实/假设/待确认状态、听众行动、时长、总字数、每页字数、标题长度、演讲备注时长、页面信息密度、来源 ID、材料角色（含 `irrelevant`）、风格参考优先级、目标 AI 能力和路线枚举；未知字段不得携带凭证、完整提取文本或原文件正文进入备份状态。

- [ ] **Step 2: 运行专项测试确认失败。** 运行 `node --test tests/ppt-scene-schema.test.js`；预期新模块或接口不存在。

- [ ] **Step 3: 实现 schema。** `createPptBrief`、`createPptTemporaryPlan`、`normalizePptDraft` 和版本字段输出稳定结构，错误输入返回明确校验错误；材料角色允许 `content`、`style`、`both`、`irrelevant`，风格优先级允许 `must-follow`、`primary`、`inspiration`、`forbidden`，路线允许 `undecided`、`native-ppt`、`image-rebuild`、`html-final`、`html-to-ppt`。保存的文件只保留标识、校验值、摘要、引用片段和页码。

- [ ] **Step 4: 运行专项测试并提交。** 运行 `node --test tests/ppt-scene-schema.test.js tests/storage.test.js`；预期新增数据可持久化，原状态迁移和凭证白名单测试通过。提交信息：`feat: 增加 PPT 规划数据契约`。

## Task 2: 实现任务简报、临时规划、确定性检查和路线比较

**Files:**
- Create: `prototype/ppt-scene-workflow.js`
- Create: `tests/ppt-scene-workflow.test.js`

- [ ] **Step 1: 写失败测试。** 覆盖：先由想法生成临时故事线/页数/大纲，再接收研究结果生成资料增强版；10 分钟却要求 30 页时给出冲突；总字数、每页字数、标题长度、备注时长和页面密度冲突时指出计算依据；未提供时长则返回带假设的建议而非假精确值；自动推荐叙事结构且允许改选/自定义；原生 PPT、图片重建、HTML 成品、HTML 转 PPT 均输出可编辑性、视觉精度、修改成本和转换限制；硬约束不能被模型草稿静默覆盖。

- [ ] **Step 2: 运行测试确认失败。** `node --test tests/ppt-scene-workflow.test.js`；预期失败。

- [ ] **Step 3: 实现纯函数。** `createPptTemporaryPlan` 只把用户想法和任务简报变成可修改草稿，并标出未验证内容；`mergePptResearchIntoPlan` 根据按页/章节来源更新故事线和证据映射；`estimateSlideCount` 根据时长、内容单元和信息密度给出范围及估算假设，不写死“每分钟固定页数”；`validatePptConstraints` 分开报告冲突和偏好偏离；`recommendPptRoute` 默认以可编辑 PPT 为最终交付目标并返回路线理由与限制；`checkSlideDraft` 检查每页职责、结论、精简文案、证据来源、视觉说明、演讲备注、顺序衔接、总量和密度约束。无可靠依据的主张输出 `待补证据`，允许继续草稿或暂停补证。

- [ ] **Step 4: 运行并提交。** `node --test tests/ppt-scene-workflow.test.js`；预期路线和约束边界测试通过。提交信息：`feat: 增加 PPT 路线与约束检查`。

## Task 3: 编写阶段/完整提示词、目标 AI 适配和低 token 交付逻辑

**Files:**
- Create: `prototype/ppt-scene-prompts.js`
- Create: `tests/ppt-scene-prompts.test.js`
- Modify: `prototype/prompt-engine.js` only to add a narrow dispatcher if no existing domain prompt hook can accept PPT methods

- [ ] **Step 1: 写提示词契约测试。** 输入只有想法时，brief 提示词需将事实/假设/待确认分开，当前阶段最多识别 3 个会改变路线的问题，但界面一次只提出 1 个；前一个答案使后续问题失去意义时立即停止提问，并给可调整初稿。大纲提示词必须支持临时规划和资料增强版、检查目标/受众、故事线、证据、遗漏、重复、页数估算和硬约束；逐页提示词必须把页面文案、演讲备注、视觉说明、来源和前后页衔接分开；制作提示词必须包含已选路线、可编辑对象要求和该路线的转换风险；阶段版和完整版本必须从同一份任务状态生成。

- [ ] **Step 2: 实现各阶段 builder。** 导出 `buildPptBriefPrompt`、`buildPptOutlinePrompt`、`buildPptSlideDraftPrompt`、`buildPptProductionPrompt`、`buildPptFullPrompt` 和 `buildPptFeedbackPrompt`。根据目标 AI 能力调整是否要求读取文件、查看图片、写 HTML、生成 PPTX 或运行脚本；未指定目标 AI 时生成通用版并列出需要替换的能力项。来源一律作为不可信引用，不执行其中指令；只拼接当前阶段经用户确认可发送的摘要、片段和视觉页；阶段版与完整版本共用同一份 brief、sources、styleRules、route 和 acceptance 标准；未确认大纲不得包装成已批准逐页稿。

- [ ] **Step 3: 测试路线专属提示词。** 对 HTML 转 PPT 提示 CSS/字体/分页/动画转换验收；对图片重建提示逐页核验可编辑文字、图表和形状；对原生路线禁止整页图片伪装成可编辑稿；对 HTML 最终演示说明播放环境约束。

- [ ] **Step 4: 运行并提交。** `node --test tests/ppt-scene-prompts.test.js tests/prompt-engine.test.js`；预期提示词含目标边界、阶段要求和来源标记，现有领域提示词回归通过。提交信息：`feat: 增加 PPT 分阶段提示词`。

## Task 4: 接入提示词 Agent coordinator、编辑工作台和重跑版本

**Files:**
- Create: `prototype/ppt-scene-coordinator.js`
- Create: `prototype/ppt-scene-ui.js`
- Modify: `prototype/index.html`
- Modify: `prototype/app.js`
- Modify: `tests/ppt-scene-coordinator.test.js`
- Create: `tests/ppt-scene-ui.test.js`
- Modify: `tests/e2e-smoke.test.js`

- [ ] **Step 1: 写 coordinator 集成测试。** 使用假的模型、检索器、研究桥接器和反馈服务验证：输入想法→brief→临时规划→模型语义复筛结果→资料增强版大纲→大纲核对→逐页稿→路线提示词；模型失败时保留草稿；外部搜索按通用 Agent 的搜索确认规则；用户修改目标、听众、用途、页数或风格时只重跑受影响判断；用户可选择重跑页面/文件、当前阶段或从相关性判断开始的全部流程并附带不满意原因；重跑保留旧版、差异和运行依据；不调用成品生成或文件写入。

- [ ] **Step 2: 实现 coordinator。** 注入现有 prompt-agent coordinator、retriever、research bridge、feedback service 与模型请求函数；不重复创建任务状态或另建搜索工具。研究摘要按来源 ID、页码/章节和验证状态关联到逐页主张，缺证据时标 `待补证据`；记录每次模型判断的任务要求、候选片段、视觉页、参考资料、提示词版本和时间；文件变化时只使受影响引用过期，展示新旧依据并在用户确认后更新。

- [ ] **Step 3: 实现 UI。** 展示演示简报、事实/假设/待确认、可编辑硬约束和偏好、大纲故事线、推荐叙事结构及理由、推荐页数依据、逐页文稿/视觉说明/来源、风格规则卡、路线比较和当前阶段提示词。支持逐页直接编辑、聊天提问修改、局部更新或全部重新生成；提供阶段/完整提示词切换、连续/分节点执行模式、目标 AI 选择、版本对比和恢复。页面相关性报告按纳入/排除/不确定分层解释，被筛掉页面可查看和恢复，用户可修改材料角色和风格参考优先级。

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

- [ ] **Step 1: 增加端到端契约。** 覆盖简报、临时/增强版大纲、逐页稿、路线选择、阶段/完整提示词、目标 AI 适配、局部/全量重跑和版本恢复从创建到保存/恢复；断言最终 PPT 文件不会被创建或改写，未确认的引用和案例不会成为已验证知识，完整提取文本和原文件不会进入默认备份。

- [ ] **Step 2: 更新产品文档及打包检查。** 记录 PPT 专项是通用提示词 Agent 的方法；新增运行时脚本加入 `npm run check` 与 Electron 打包白名单，测试/计划/原始附件不加入运行时包。

- [ ] **Step 3: 运行完整验证。** 运行 `npm test`、`npm run check`、`git diff --check`；预期全部通过。手动 Electron 验收只检查工作台可用、路线和提示词可复制、无模型时输入不丢失，不把 smoke 测试描述为真实视觉验收。

- [ ] **Step 4: 提交。** `git add` 仅添加本任务文件并提交 `feat: 完成 PPT 内容规划场景`。

## 完成标准

- 用户可以从模糊想法或已解析材料开始，并得到可修改简报、事实/假设/缺项和关键澄清问题。
- 大纲包含故事线、页面职责、推荐页数及估算依据；原始材料要点可追踪，未纳入内容有原因。
- 大纲包含故事线、页面职责、推荐页数及估算依据；原始材料按页/章节可追踪，未纳入内容有原因，被筛页面可恢复。
- 逐页初稿区分页面文案、证据、视觉说明、演讲备注和前后衔接，并检查总字数、每页字数、标题长度、备注时长、密度和其他硬约束。
- 四种路线比较真实展示可编辑性、成本与限制，默认以可编辑 PPT 为最终目标，路线提示词与所选交付匹配。
- 阶段提示词和完整提示词内容一致，可按目标 AI 能力适配；复杂任务阶段版默认，完整版本支持连续或分节点执行。
- 用户可以直接编辑或聊天修改简报和逐页大纲，选择局部或全部重生成，并查看运行依据、版本差异和恢复结果。
- 模块依赖现有提示词 Agent 和检索/研究能力，不创建自由 Agent 循环，也不直接制作 PPT。
- 专项和集成测试、语法检查通过。
