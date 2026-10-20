# 通用写作工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [x]) syntax for tracking.

**Goal:** 在现有提示词 Agent 中交付普通文章的统一新建与多轮改稿工作台，支持按篇本地保存、风格档案、分层个人记忆及用户确认后联网研究。

**Architecture:** 继续使用单一提示词 Agent 和当前 Electron/原生前端结构；以白名单 schema 定义写作状态，复用现有存储、发送预览、资料检索和研究交接。新增聚焦的写作规则/提示词模块，并将入口挂入现有提示词 Agent 工作台；不直接改写文章，也不为未来文体预建独立 Agent。

**Tech Stack:** Electron、原生 JavaScript、HTML/CSS、localStorage、Node.js 内置 node:test。

---

## 文件结构与职责

- Create: prototype/writing-workbench-schema.js：普通文章任务、轮次、风格档案、个人偏好的白名单规范化和边界校验。
- Create: prototype/writing-workbench-prompts.js：从目标、样本风格特征、记忆和本轮反馈生成诊断/下一轮提示词；不得生成文章成品。
- Create: prototype/writing-workbench-coordinator.js：协调写作任务阶段、轮次关联、风格依据优先级、记忆晋升/撤销以及用户确认后的搜索调用。
- Create: prototype/writing-workbench-ui.js：同一工作台的新建/继续入口、材料用途、轮次回带、逐篇保存开关、记忆操作和搜索计划确认。
- Modify: prototype/storage.js：新增写作任务和写作记忆状态字段；迁移旧工作区时保留数据并套用 schema。
- Modify: prototype/backup-manager.js、prototype/workspace-backup.js：完整工作区备份纳入已保存文章和记忆；资料库专属备份排除文章正文与记忆。
- Modify: prototype/app.js、prototype/index.html：实例化写作模块、挂接现有导航/工作台及加载脚本。
- Modify: prototype/prompt-agent-ui.js、prototype/prompt-agent-coordinator.js：复用现有入口、模型发送预览和用户确认的研究桥接，不并行维护第二套 Agent 工作区。
- Create: tests/writing-workbench-schema.test.js、tests/writing-workbench-prompts.test.js、tests/writing-workbench-coordinator.test.js、tests/writing-workbench-ui.test.js。
- Modify: tests/storage.test.js、tests/workspace-backup.test.js、tests/backup-manager.test.js、tests/e2e-smoke.test.js、package.json：覆盖迁移、备份、入口和脚本语法检查。
- Modify: docs/PRODUCT_DESIGN.md、docs/MVP_SCOPE.md、README.md：实现完成后同步首版能力与边界。

实现前先核对以上现有文件的实际接口；如现有导航或备份职责与描述不符，沿用代码中的真实所有权，并在提交中保持改动集中。

## Task 1: 定义写作数据契约

**Files:**
- Create: prototype/writing-workbench-schema.js
- Create: tests/writing-workbench-schema.test.js

- [x] **Step 1: 编写 schema 失败测试**

覆盖普通文章类型默认值、文章保存开关、轮次稿件/反馈、材料用途（内容/风格/两者）、风格档案来源和把握度、通用/文体记忆范围、来源文章 ID、撤销信息、长度/数量上限，以及未知字段和凭证字段被拒绝或剔除。

~~~js
test("只允许已知写作字段并限制记忆适用范围", () => {
  const result = schema.normalizeWritingWorkspace({
    genre: "article",
    memory: { scope: "article", preference: "少用空泛总结" },
    apiKey: "never-persist"
  });
  assert.equal(result.genre, "article");
  assert.equal(result.memory.scope, "article");
  assert.equal("apiKey" in result, false);
});
~~~

- [x] **Step 2: 运行专项测试确认失败**

Run: node --test tests/writing-workbench-schema.test.js  
Expected: FAIL，提示 schema 模块尚不存在。

- [x] **Step 3: 实现最小白名单 schema**

实现纯函数 normalizeWritingArticle、normalizeWritingRound、normalizeWritingStyleProfile、normalizeWritingMemory 和 normalizeWritingWorkspace；未知文体不伪装为已支持，所有文本字段限长，轮次/样本/记忆数组限量，凭证字段不得进入持久化结果。

- [x] **Step 4: 运行 schema 测试**

Run: node --test tests/writing-workbench-schema.test.js  
Expected: PASS，所有白名单、边界和默认值断言通过。

- [x] **Step 5: 提交数据契约**

~~~bash
git add prototype/writing-workbench-schema.js tests/writing-workbench-schema.test.js
git commit -m "feat: 定义写作工作台数据契约"
~~~

## Task 2: 接入本地状态与备份边界

**Files:**
- Modify: prototype/storage.js
- Modify: prototype/backup-manager.js
- Modify: prototype/workspace-backup.js
- Modify: tests/storage.test.js
- Modify: tests/backup-manager.test.js
- Modify: tests/workspace-backup.test.js

- [x] **Step 1: 增加状态迁移与备份失败测试**

测试旧状态读取时新增空的 writingArticles 和 writingMemories；往返保存已启用文章时保留轮次和风格档案；关闭保存后停止写入新轮次但不删除旧记录；资料库专属备份不包含正文或个人记忆，完整备份包含它们；导入仍经过 schema 白名单。

- [x] **Step 2: 运行关联测试确认失败**

Run: node --test tests/storage.test.js tests/backup-manager.test.js tests/workspace-backup.test.js  
Expected: 新增断言失败，旧行为测试保持可运行。

- [x] **Step 3: 实现状态迁移与逐篇保存语义**

在 storage.js 的 state schema 中登记写作字段，使用 Task 1 规范化器；持久化层仅接受保存开关开启的文章新轮次。关闭开关保留已有历史，删除文章由显式删除操作完成。

- [x] **Step 4: 实现两种备份范围**

完整工作区备份包含已保存文章和写作记忆；仅资料库备份明确排除这两类数据。导入预览、合并/替换和敏感字段清理沿用已有规则。

- [x] **Step 5: 运行关联测试**

Run: node --test tests/storage.test.js tests/backup-manager.test.js tests/workspace-backup.test.js  
Expected: PASS，原有备份/迁移行为不回归。

- [x] **Step 6: 提交本地状态与备份边界**

~~~bash
git add prototype/storage.js prototype/backup-manager.js prototype/workspace-backup.js tests/storage.test.js tests/backup-manager.test.js tests/workspace-backup.test.js
git commit -m "feat: 保存文章轮次和写作记忆"
~~~

## Task 3: 建立风格依据和写作提示词

**Files:**
- Create: prototype/writing-workbench-prompts.js
- Create: tests/writing-workbench-prompts.test.js
- Modify: prototype/index.html（脚本加载顺序）

- [x] **Step 1: 编写提示词边界测试**

覆盖：风格样本只传入提炼后的可观察特征和来源，不把样本观点当成目标内容；当前要求优先于样本、记忆和平台基线；无样本时明确临时判断；诊断提示词要求引用具体段落、区分事实问题和偏好、不输出 AI 身份分数、不改写文章；下一轮提示词含保留项和用户反馈。

~~~js
test("无风格样本时标明临时判断且不直接产出文章", () => {
  const prompt = prompts.buildWritingDiagnosisPrompt({
    article: { goal: "解释一个产品概念", audience: "新手" },
    styleProfile: null
  });
  assert.match(prompt, /临时/);
  assert.match(prompt, /不得直接改写文章/);
});
~~~

- [x] **Step 2: 运行测试确认失败**

Run: node --test tests/writing-workbench-prompts.test.js  
Expected: FAIL，提示词模块尚不存在。

- [x] **Step 3: 实现纯提示词构造器**

实现 buildWritingDiagnosisPrompt 和 buildWritingRevisionPrompt；将来源限制为 Task 1 已规范化字段，风格冲突按规格优先级组织，长度超限时按相关性截断。

- [x] **Step 4: 运行提示词测试**

Run: node --test tests/writing-workbench-prompts.test.js  
Expected: PASS，提示词保留约束且不包含被 schema 丢弃的未知字段。

- [x] **Step 5: 提交提示词模块**

~~~bash
git add prototype/writing-workbench-prompts.js tests/writing-workbench-prompts.test.js prototype/index.html
git commit -m "feat: 增加文章风格诊断提示词"
~~~

## Task 4: 实现连续改稿与记忆协调器

**Files:**
- Create: prototype/writing-workbench-coordinator.js
- Create: tests/writing-workbench-coordinator.test.js

- [x] **Step 1: 编写轮次和记忆行为测试**

验证新稿创建唯一文章 ID；外部新稿/反馈作为同一文章的新轮次；保存关闭时不新增持久化记录；“记住这个偏好”可立即选择通用或普通文章范围；相同偏好仅在两篇不同文章中出现才自动提升；同篇重复不能触发晋升；自动保存可撤销；当前要求覆盖冲突记忆但不静默修改记忆；未来文体只加载通用偏好。

- [x] **Step 2: 运行测试确认失败**

Run: node --test tests/writing-workbench-coordinator.test.js  
Expected: FAIL，协调器模块尚不存在。

- [x] **Step 3: 实现文章与轮次协调**

以 schema 规范化输入，提供新建/打开/追加轮次/启停保存/删除文章/读取轮次操作；持久化失败返回可见错误并保留调用方当前会话数据。

- [x] **Step 4: 实现记忆晋升、撤销与相关选择**

反馈先挂在文章轮次。显式按钮立即保存；自动晋升按规范化偏好和不同文章 ID 计数，达到两篇后写入普通文章记忆并返回可撤销记录。上下文只选择与当前目标和文体相关的少量偏好。

- [x] **Step 5: 运行协调器测试**

Run: node --test tests/writing-workbench-coordinator.test.js  
Expected: PASS，轮次、保存和跨文章记忆门槛符合规格。

- [x] **Step 6: 提交协调器**

~~~bash
git add prototype/writing-workbench-coordinator.js tests/writing-workbench-coordinator.test.js
git commit -m "feat: 管理文章轮次和偏好记忆"
~~~

## Task 5: 接入统一写作工作台界面

**Files:**
- Create: prototype/writing-workbench-ui.js
- Modify: prototype/prompt-agent-ui.js
- Modify: prototype/app.js
- Modify: prototype/index.html
- Create: tests/writing-workbench-ui.test.js
- Modify: tests/e2e-smoke.test.js

- [x] **Step 1: 编写 UI 行为测试**

使用仓库现有 DOM mock 测试约定，覆盖同一入口新建/继续、文章列表切换、稿件用途标记、风格档案纠正、轮次反馈回填、保存开关、记忆按钮/撤销/管理入口、删除整篇历史的明确动作，以及模型发送仍走现有预览。

- [x] **Step 2: 运行测试确认失败**

Run: node --test tests/writing-workbench-ui.test.js tests/e2e-smoke.test.js  
Expected: 新 UI 测试失败；原有 smoke 测试运行通过或明确指出缺失入口。

- [x] **Step 3: 实现写作工作台视图**

创建与现有原生 UI 一致的单页工作区。新建和继续使用同一表单与轮次视图；显示样本用途和提炼的风格特征；保存状态、记忆写入和错误结果必须可见。不给已保存文章默认打开正文持久化。

- [x] **Step 4: 接入提示词 Agent 与应用入口**

在现有 Agent 导航下进入写作视图，复用 requestModel、发送预览、通知和任务状态保存接口；避免同时渲染两套互不关联的“新建/改稿”窗口。

- [x] **Step 5: 运行 UI 与 smoke 测试**

Run: node --test tests/writing-workbench-ui.test.js tests/e2e-smoke.test.js  
Expected: PASS，同一文章的新建/多轮流程可以通过界面入口触达。

- [x] **Step 6: 提交工作台 UI**

~~~bash
git add prototype/writing-workbench-ui.js prototype/prompt-agent-ui.js prototype/app.js prototype/index.html tests/writing-workbench-ui.test.js tests/e2e-smoke.test.js
git commit -m "feat: 合并文章新建与连续修改工作台"
~~~

## Task 6: 接入用户确认后的 GitHub/网页搜索

**Files:**
- Modify: prototype/writing-workbench-coordinator.js
- Modify: prototype/writing-workbench-ui.js
- Modify: prototype/prompt-agent-coordinator.js：复用现有研究 bridge 的 preview/approve/execute 生命周期，将写作查询纳入既有研究计划状态；不改写通用 bridge 的预算和确认规则。
- Modify: tests/writing-workbench-coordinator.test.js
- Modify: tests/writing-workbench-ui.test.js
- Modify: tests/prompt-agent-integration.test.js

- [x] **Step 1: 编写搜索确认门禁测试**

验证点按钮只生成范围/查询/预算预览；未确认时搜索调用次数为 0；确认后只调用现有 web/GitHub 搜索适配器；查询不含整篇正文和敏感字段；拒绝后本文章不再重复申请；结果摘要附来源、适用范围和未验证状态并与本地规则一起进入诊断。

- [x] **Step 2: 运行测试确认失败**

Run: node --test tests/writing-workbench-coordinator.test.js tests/writing-workbench-ui.test.js tests/prompt-agent-integration.test.js  
Expected: 新增搜索门禁断言失败，现有研究工作流回归保持可见。

- [x] **Step 3: 在提示词 Agent 协调器复用研究计划和预算边界**

为写作搜索构建有限查询计划，来源限定 GitHub/网页；在 prototype/prompt-agent-coordinator.js 调用现有 researchBridge.preview 生成预览、researchBridge.approve 记录用户批准，再调用 researchBridge.execute。展示计划前后均不得搜索；不新建搜索服务或绕过现有确认逻辑。

- [x] **Step 4: 组合外部摘要与本地写作上下文**

只将少量摘要、来源和适用限制并入本轮诊断；公开 Skill 保持未验证线索，不能覆盖当前用户要求或已确认个人记忆。

- [x] **Step 5: 运行搜索集成测试**

Run: node --test tests/writing-workbench-coordinator.test.js tests/writing-workbench-ui.test.js tests/prompt-agent-integration.test.js  
Expected: PASS，拒绝/失败时仍可走内置规则并复制提示词。

- [x] **Step 6: 提交搜索入口**

~~~bash
git add prototype/writing-workbench-coordinator.js prototype/writing-workbench-ui.js prototype/prompt-agent-coordinator.js tests/writing-workbench-coordinator.test.js tests/writing-workbench-ui.test.js tests/prompt-agent-integration.test.js
git commit -m "feat: 增加可确认的写作资料搜索"
~~~

## Task 7: 文档、全量回归与交付检查

**Files:**
- Modify: docs/PRODUCT_DESIGN.md
- Modify: docs/MVP_SCOPE.md
- Modify: README.md
- Modify: package.json
- Modify: tests/e2e-smoke.test.js（若入口/备份验收还未覆盖）

- [x] **Step 1: 更新功能和边界文档**

只写已实现能力：普通文章首版、未来文体配置边界、风格样本与临时判断、按篇保存、记忆晋升门槛、搜索确认门禁和现有产品不直接代写的定位。

- [x] **Step 2: 注册新增运行时脚本检查**

把 writing-workbench-schema.js、writing-workbench-prompts.js、writing-workbench-coordinator.js、writing-workbench-ui.js 添加到 npm run check。

- [x] **Step 3: 运行全量验证**

Run: npm run check  
Expected: 退出码 0，所有运行时脚本语法检查通过。

Run: npm test  
Expected: 所有 Node 测试通过，无旧工作区迁移、备份、发送预览、研究确认或 PPT 功能回归。

- [x] **Step 4: 检查差异与工作区状态**

Run: git diff --check  
Expected: 无空白错误。检查 git status --short，只将本计划所列相关文件放入功能提交，不纳入现有无关用户改动。

- [x] **Step 5: 提交文档和脚本清单**

~~~bash
git add docs/PRODUCT_DESIGN.md docs/MVP_SCOPE.md README.md package.json tests/e2e-smoke.test.js
git commit -m "docs: 更新写作工作台交付说明"
~~~

## Task 8: 在真实应用界面完成验收

**Files:**
- Modify: tests/writing-workbench-ui.test.js（仅在界面验收发现可复现缺口时补回归）
- Modify: tests/e2e-smoke.test.js（仅在关键工作流缺少自动化边界时补充）

- [x] **Step 1: 启动并确认本地应用服务**

在端口 4173 空闲时运行 npm start；若被占用，使用相邻空闲端口并按 server.js 的端口配置访问。等待服务可访问后再开浏览器，不把进程启动当作页面验收。

- [x] **Step 2: 打开真实工作台并记录首屏证据**

使用 Playwright 打开实际服务 URL，确认页面非空、写作入口可见、无页面错误/控制台异常；保存应用界面截图作为当前验收记录。

- [x] **Step 3: 走通离线连续改稿主流程**

在界面创建普通文章，填写目标、读者、草稿和一段标记为风格参考的样本；查看 Agent 提炼的风格档案并纠正一个特征；生成诊断/提示词；模拟粘贴外部 AI 新稿和反馈，确认仍关联同一文章并生成下一轮提示词。检查工具没有直接替用户改写稿件。

- [x] **Step 4: 验收逐篇保存与记忆操作**

开启当前文章保存，写入至少两轮并加入一条反馈；刷新页面后确认文章和轮次恢复；关闭保存后增加一轮并刷新，确认新轮次不再持久化且旧历史保留；检查逐篇删除能清除该文章所有版本。通过界面显式记忆按钮保存一条偏好，验证相关记忆展示和删除/撤销操作。

- [x] **Step 5: 验收搜索确认门禁与降级**

点击查找写作案例/Skill，确认先显示范围和预算；拒绝时验证没有触发网络请求且仍能继续本地诊断。若搜索服务已配置，再确认批准后请求仅带查询词而非整篇正文，并展示来源和验证状态；未配置时核对明确错误提示及复制提示词仍可用。

- [x] **Step 6: 验收界面布局与可操作性**

在桌面宽度和窄屏宽度检查输入、轮次、记忆和保存/删除控件不重叠、不被截断；所有关键按钮可见、可聚焦、可点击，状态和错误提示可读。出现问题先修复并重跑相关 UI 用例及此验收流程。

- [x] **Step 7: 收束运行进程并记录结果**

关闭本轮启动的浏览器页和服务进程；保留已有服务进程不动。最终报告写明访问 URL、实际走过的流程、截图/控制台结果、搜索服务是否配置以及任何未完成的验收项。

## 规格覆盖自检

- 统一入口与连续文章轮次：Task 4、Task 5。
- 普通文章维度诊断、AI 味具体证据、风格样本提炼、无样本临时判断和冲突优先级：Task 1、Task 3、Task 5。
- 文体配置扩展边界：Task 1、Task 3、Task 7；首版不实现后续文体专用工作流。
- 按篇保存、关闭保存保留旧历史、逐篇删除、备份范围与迁移：Task 1、Task 2、Task 5。
- 通用/文体/单篇记忆，显式保存、跨文章重复晋升、撤销和新文体继承：Task 1、Task 2、Task 4、Task 5。
- 默认本地知识与确认后 GitHub/网页搜索、预算、拒绝/失败降级：Task 5、Task 6。
- 发送预览、隐私、模型/搜索/存储失败和无服务降级：Task 2、Task 5、Task 6、Task 7。
- 测试、脚本检查和用户文档：各模块专项测试及 Task 7。
- 真实界面操作、刷新持久化、窄屏检查和可访问错误状态：Task 8；静态 smoke 或 DOM mock 不替代此项。

边界说明：本计划是一条共用数据契约和同一写作任务流程的端到端交付，存储、提示词、记忆、界面和搜索不是可独立交付的多 Agent/多产品，因此暂合并为一份有顺序的计划；每个任务仍能单独测试和提交。

## 续接执行记录（2026-10-20）

- 沿用 `codex/writing-workbench` 分支；设计稿优先，已纠正旧实现把逐篇保存默认设为开启的问题。
- Task 1 已通过独立规格及代码质量审查；数据契约专项测试 20 项通过。
- Task 2 存储、备份和数据契约相关测试 92 项通过；备份恢复通过显式 `restoreWriting` 选项保留关闭保存的历史，应用导入入口在 Task 5 接入。
- Task 3 已通过独立规格与代码复审；风格适用范围先于样本和更正选择，来源统一对应最多三条资料，用户强约束超限明确报错而不静默截断。
- 记忆候选采用有限白名单字段：未保存文章的候选仅保留于会话；两篇不同文章重复后可保存偏好及必要例子，不要求开启正文保存，也不暗存正文或完整反馈。
- 续接时原有非写作测试基线为 417 项：410 通过、6 失败、1 因 Windows 符号链接权限跳过。失败涉及旧 IPC 白名单/计数断言、资料引用数量上限和发送预览静态断言，交付前复核处理。
- 真实页面基线已在 `http://127.0.0.1:4173/` 打开；发现浏览器误加载 Node 专用 `local-source-index.js` 导致 `require is not defined`，由 Task 3 修复脚本入口。
- 主工作区有无关的 PPT 文档和打包目录改动，实施保持隔离，不清理这些改动。

- Task 4 已完成独立规格与代码质量复审，提交 1b43efc；真实存储及异步失败边界相关测试 107 项通过，进入 Task 5 统一界面接入。

- Task 5 已通过独立规格及质量复审，最终提交17200cf，相关219项测试通过；真实界面发现的备份、资料入口、导入会话和追加保存失败问题已补回归修复，开始Task 6搜索。

- Task 6 最终提交529b655已通过独立规格和代码质量审查；真实Electron/Chrome搜索确认、拒绝、取消、失败降级与模拟成功来源展示通过。
- Task 7 提交8aca9c6已通过独立规格和质量审查；pnpm check通过，全量550项549通过0失败1项Windows权限跳过；最终整体审查独立171项通过，无P1/P2。
- Task 8 已完成真实Electron/Chrome主验收、独立新页核心复验和390px关键控件焦点补证；本轮进程已关闭。结果、模拟成功边界及剪贴板限制见同目录验收记录。
