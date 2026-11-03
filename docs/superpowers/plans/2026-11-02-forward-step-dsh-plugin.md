# 向前一步 DSH 插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留原应用，在工作空间内的副本交付包含通用 Agent、写作/PPT 方法、多任务续接、自动学习、分层记忆和可撤销画像侧栏的 DSH 原生插件。

**Architecture:** 复用现有纯 JavaScript 核心，不迁移 Electron 窗口，也不增加常驻服务。业务代码通过插件自己的 HostPort 调用宿主；先验证实际 DSH 接口，再冻结适配实现。任务结果先保存，学习随后独立提交；状态隔离、版本校验和撤销由代码保证。

## 本轮实现进度（更新于 2026-11-03 19:50，Asia/Shanghai）

- 阶段一/H4 已通过本机隔离 DSH `0.2.0-rc.2` 桌面验收：真实模型 A/B 消息隔离两次通过；停用后侧栏/探针入口消失，重新启用后恢复，Host RPC `observed:true`，重新启用后的 A/B 再测仍只有 2 条任务请求与 2 条标题辅助请求，无重复注册或标记串线。机器收据见 `docs/acceptance/forward-step-dsh/phase1-acceptance-status-20261103.md` 与 `.verification/phase1-desktop-probe-20261102/desktop-real-model-ab-isolation-20261103.json`、`desktop-plugin-disabled-20261103.json`、`desktop-plugin-enabled-after-cycle-20261103.json`、`desktop-real-model-ab-after-reenable-20261103.json`。
- 本机 DSH Plugin Manager 的启停语义与 Cordis 异步 effect 释放依据已按用户认可的 `0.2.0-rc.2` 本机源码记录；插件 effect 的 `dispose()` 等待活动 Agent/持久化收尾，自动化卸载测试通过。固定 GitHub commit 精确源码对照及 Windows MCP 专属回执以用户允许的替代依据处理，不作为继续阻塞；桌面交互明确标注为 UI Automation，不冒称 Windows MCP。
- 当前构建对应 Host RPC 14 个，Client bundle 构建成功；最新专项测试 `node --test tests/dsh-plugin/*.test.mjs tests/prompt-agent-coordinator-prepared-request.test.mjs` 为 91/91 通过；在插件目录执行 `pnpm pack --dry-run` 成功，包清单含 39 个运行文件。隔离 profile Junction 指向插件副本，当前隔离 DSH PID `16324`、Host PID `29384` 于本轮构建后启动并完成验收。
- 阶段二现在开始；先按 `2026-11-02-forward-step-dsh-02-agent-tasks.md` 审计实际代码、设计、测试和计划差异。任务/RPC 与侧栏已有实现，不重复造轮子；只补剩余断点。阶段三至五按依赖顺序推进，文章/PPT 首版仍只输出规划和外部 AI 执行提示词，直接调用 DSH 制作成品保留为后续方向。
- 原应用继续保留且本轮未修改；插件副本保持在本计划指定路径。提交仍遵守只选择插件与必要设计、计划、验收文件并推到现有仓库独立分支；不把原应用改造夹入，不拆仓。

## 当前执行状态（更新于 2026-11-03 19:50，Asia/Shanghai）

- 阶段一/H4 已通过并可进入阶段二。已通过项包括真实模型消息 A/B 审计、隔离任务/会话恢复、RPC/取消、存储读写与重启恢复、插件安装卸载/重新启用、停用/启用 UI 差异和重新挂载只注册一次。固定提交源码精确对照按用户明确允许的本机源码/既有验收证据替代口径记录。
- 当前隔离实例路径为 `.verification/dsh-desktop-isolated-20261102/profiles/desktop`，Electron userData 位于同根下 `electron-user-data`；普通 DSH profile 不参与本轮验收。当前 UI 操作使用 Windows UI Automation，Windows MCP 未暴露。
- 文章/PPT 成品首版仍输出规划与外部 AI 执行提示词；“插件直接调用 DSH 生成成品”继续保留为后续设计方向。长期记忆/画像和撤销仍是阶段四待实现/验收范围，未因 H4 通过而标完成。
---
## 1. 执行边界与入口

本计划对应已审查设计：

`D:/VScode/项目/提示词工具/.dsh-workspace/docs/superpowers/specs/2026-11-02-forward-step-dsh-plugin-design.md`

当前目标授权继续按计划实现并验收；桌面操作只允许在明确隔离的 DSH_HOME/profile 内执行。普通日常 DSH profile、安装目录与 app.asar 不作改动。

- 工作目录 W：`D:/VScode/项目/提示词工具/.dsh-workspace`。
- 插件目录 P：`D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh`。
- Git 根目录 G：`D:/VScode/项目/提示词工具`。
- 这是此前确认的独立源码副本，不是独立 Git worktree。继续使用副本，不重新移动目录或复制用户未提交内容。
- 不修改 G 中副本以外的应用文件，不改另一个线程，不写 DSH 安装资源或 `app.asar`。
- 常规安装脚本测试使用 `C:/Users/Alarm/.dsh/profiles/forward-step-test`；真实桌面验收使用工作空间内 `.verification/dsh-desktop-isolated-20261102/profiles/desktop` 与同根隔离 `electron-user-data`。日常 DSH profile 不参与安装、清理或修复。
- PowerShell 使用 `pwsh.exe`。以下代码块中的命令在 W 执行，Git 提交示例使用 `git -C` 明确根目录。
- 首版不直接制作文章/PPT 成品，不自动导入原应用历史，不做完整资料库、备份迁移或社媒研究。

## 2. 已验证基线

2026-11-02 实际读取和执行所得，不是未来验收结果：

| 内容 | 结果 |
| --- | --- |
| 本机命令行 Node | `v24.14.1` |
| DSH 所带 Node / Electron | `24.18.1` / `44.0.0` |
| DSH 运行时 SQLite 内存建表探测 | `SQLITE_PROBE: PASS`，退出 0 |
| 现有插件 | `@local/forward-step-dsh@0.1.0`，只注册 `skills` provider |
| 现有 Agent | `runStage()` 返回 `not-persisted`；没有完整任务仓库 |
| 现有三类方法测试 | 89 通过、0 失败、退出 0 |
| 测试配置依赖 | 仍指向 G 的旧插件路径，不是 P |
| 实际 GUI、侧栏、模型与持久化接口 | 2026-11-03 19:50 阶段一/H4 通过；详见最新验收记录 |

基线命令：

```powershell
node --test tests/forward-step-dsh.test.js tests/prompt-agent-schema.test.js tests/prompt-agent-workflow.test.js tests/prompt-agent-prompts.test.js tests/prompt-agent-coordinator.test.js tests/ppt-scene-prompts.test.js tests/writing-workbench-prompts.test.js
```

预期摘要：`tests 89`、`pass 89`、`fail 0`，退出 0。后续新增测试后总数增加，不硬编码总数作为通过依据。

官方资料入口：`https://github.com/deepseek-ai/deepseek-harness`，已读取 `master/README.md`、`docs/architecture.md` 和 `docs/development.md`。上游描述的是快速变化的开发预览版，不能据此推断本机 rc.2 暴露同一组接口。GitHub API 本轮遇到限流；原始文档访问成功。第一阶段记录实际源码提交或安装资源哈希，再引用与本机匹配的声明和实例。

## 3. 分段计划与依赖

总体需求跨越多个单元，拆成五份顺序执行的计划。每段均有独立可检查产物；不是五个可同时开工的无依赖工程。

| 阶段 | 计划文件，均位于 W/docs/superpowers/plans | 交付与通过条件 |
| --- | --- | --- |
| 1 | `2026-11-02-forward-step-dsh-01-host.md` | 接口证据、隔离测试入口、可读写测试数据的真实侧栏；接口决策通过 |
| 2 | `2026-11-02-forward-step-dsh-02-agent-tasks.md` | 通用流程、多任务、版本、保存与重启恢复；不串任务 |
| 3 | `2026-11-02-forward-step-dsh-03-writing-ppt.md` | 普通文章与连续改稿、PPT 规划、外部结果闭环 |
| 4 | `2026-11-02-forward-step-dsh-04-memory.md` | 自动学习、画像、五种范围、可视化控制和撤销 |
| 5 | `2026-11-02-forward-step-dsh-05-acceptance.md` | 打包安装、故障测试、真实模型对照、明确验收位置及操作说明 |

严格顺序：1 → 2 → 3 → 4 → 5。阶段 1 若发现宿主缺少原生侧栏、可靠存储或上下文隔离，记录实测结果并修订设计后再推进；不把 Skill 成功加载视为通过，不改成外部常驻服务绕过方案选择。

阶段 2 至 5 预先规定业务契约、测试输入和验收结果，但不伪造 DSH API。涉及真实宿主接线的代码，以阶段 1 的接口收据为唯一依据；若签名与这里的插件内部 HostPort 不同，只改适配层。

## 4. 文件职责图

以下路径相对于 W；绝对前缀均为 `D:/VScode/项目/提示词工具/.dsh-workspace/`。各分段任务另外列出绝对工作目录和精确文件名。

| 文件或固定文件组 | 职责 |
| --- | --- |
| `dsh-plugin/forward-step-dsh/index.js` | 保留 Skill provider，装配服务与释放资源 |
| `dsh-plugin/forward-step-dsh/host/port.js` | 插件内部宿主契约校验，不声称是 DSH 官方 API |
| `dsh-plugin/forward-step-dsh/host/adapter.js` | 唯一直接使用经核验宿主调用的地方 |
| `dsh-plugin/forward-step-dsh/host/compatibility.js` | 宿主指纹、接口收据和能力不匹配检查 |
| `dsh-plugin/forward-step-dsh/core/schema.js` | 持久化外壳与输入校验，保留长原文而不交给旧摘要 schema 截断 |
| `dsh-plugin/forward-step-dsh/core/store.js` | 事务、修订号、完整历史、去重、关闭资源 |
| `dsh-plugin/forward-step-dsh/core/tasks.js` | 项目标识、任务增删改、归档和对话绑定 |
| `dsh-plugin/forward-step-dsh/core/context.js` | 范围及预算通过后的实际请求快照 |
| `dsh-plugin/forward-step-dsh/core/agent.js` | 复用通用流程、取消、迟到结果、结果保存后排队学习 |
| `dsh-plugin/forward-step-dsh/core/methods.js` | 通用/写作/PPT 的阶段提示词路由 |
| `dsh-plugin/forward-step-dsh/core/versions.js` | 外部结果、提示词及复盘的关联与失效标记 |
| `dsh-plugin/forward-step-dsh/memory/policy.js` | 范围、领域、证据、人工固定和冲突规则 |
| `dsh-plugin/forward-step-dsh/memory/service.js` | 学习队列、同源去重、事务更新及暂停 |
| `dsh-plugin/forward-step-dsh/memory/history.js` | 字段级撤销、停用、正文清理与抑制 |
| `dsh-plugin/forward-step-dsh/memory/profile.js` | 从生效且证据有效的记忆派生画像，不复制独立正文 |
| `dsh-plugin/forward-step-dsh/client/panel.js` | 宿主客户端入口；具体注册方式由接口收据固定 |
| `dsh-plugin/forward-step-dsh/client/state.js` | 任务选择、草稿、请求状态、错误和版本冲突 |
| `dsh-plugin/forward-step-dsh/client/panel.css` | 宿主风格、紧凑侧栏、自适应与焦点状态 |
| `dsh-plugin/forward-step-dsh/client/tasks.js` | 任务列表、进度、版本及外部结果交互 |
| `dsh-plugin/forward-step-dsh/client/memory.js` | 学习动态、差异、范围选择、画像与撤销交互 |
| `scripts/dsh-stage-core.mjs` | 将实际依赖闭包复制进插件，保持 CommonJS 边界 |
| `scripts/dsh-host-check.mjs` | 只读采样程序哈希、帮助、版本和能力证据 |
| `scripts/dsh-test-profile.ps1` | 测试配置备份、安装、解析校验和恢复 |
| `scripts/dsh-acceptance.mjs` | 汇总结果与产物，不凭检查数量宣称效果通过 |
| `docs/acceptance/forward-step-dsh/host-interface.json` | 经实测填写的宿主收据 |
| `docs/acceptance/forward-step-dsh/RUNBOOK.md` | 用户验收所需的真实程序、入口、位置与步骤 |

只新增必要文件；任务中代码片段定义的是本插件内部签名。客户端构建依赖、图标库、远程服务注册语法在阶段 1 对照本机实例确定后加入插件包，不套用未经验证的框架。

## 5. 统一内部契约

以下是实施目标，不表示现有代码已导出这些函数。方法在对应任务中实现并测试。

```javascript
// HostPort：adapter.js 返回，port.js 校验；不在业务代码访问 ctx。
// requestModel 必须仅发送给定 messages，并返回实际发送的可审计快照。
// 不能保证这一点时能力检查失败，不启用任务切换生成。
// requestModel({messages, signal, projectId, taskId, conversationId, requestId})
//   -> Promise<{text, model, sentMessages}>
// registerPanel({id, title, entry, environment, version}) -> dispose()
// exposeService({id, handlers}) -> dispose()
// getContext() -> {cwd, conversationId, profileName, dataRoot}
// subscribe(listener) -> dispose()；只订阅已绑定任务的新增事件。

// Repository（core/store.js）
// openStore(filename) -> {read, transact, close}
// read() -> structuredClone(State)
// transact(expectedRevision, eventId, mutate) -> State
// mutate 在事务内只操作一个快照，不运行网络和 await。

// State：仅插件命名空间，schemaVersion 固定为 1，升级时显式迁移。
const initialState = {
  schemaVersion: 1, revision: 0,
  projects: [], tasks: [], bindings: [],
  memories: [], changes: [], suppressions: [], sources: [],
  learning: {paused: false, jobs: []}, processedEvents: []
};
// Task 与旧 Agent task 分开；旧 task 保存在 agent 字段内。
// {projectId, taskId, revision, title, entryType, domain, archived,
//  agent, originalInput, currentRequirements, materials, methodState,
//  versions, reviews, conversations, updatedAt}
// Memory：scope 为 global/domain/project/task/conversation；领域另存 domains。
// {memoryId, revision, key, value, scope, domains, projectId, taskId,
//  conversationId, status, manualScope, sourceRefs, updatedAt}
// SourceRef：{sourceId, projectId, taskId, conversationId, locator,
//  kind, excerpt, digest, active, userAuthored}
// Change：{eventId, memoryId, before, after, sourceRefs, reason,
//  changedFields, undoneBy, createdAt}
```

错误码统一为 `invalid_input`、`conflict`、`cancelled`、`stale_response`、`budget_exceeded`、`model_failure`、`storage_failure`、`unsupported_host`。服务返回 `{ok:false,error:{code,message},draft}`，不以空列表伪装失败；异常中的凭证不得透传。

## 6. 提交与测试纪律

- 每任务按红测试 → 运行失败 → 最小实现 → 运行通过 → 相关回归 → 指定文件提交执行。
- 表格中一个测试用例代表一条独立复选步骤，不把整个矩阵塞成一个“两分钟任务”。每个新增导出函数都有直接断言。
- 代码任务的接口、数据和关键算法由分段计划规定；宿主相关代码必须使用阶段 1 实测声明，不照抄上游新版本示例。
- 只提交当前任务文件。副本大量文件未跟踪，禁止 `git add .`、`git add -A` 或整目录暂存。
- 提交前 `git -C 'D:/VScode/项目/提示词工具' diff --cached --name-only`，检查未夹带原应用；若已有别人暂存文件，使用 `git commit --only --` 后逐个写明本任务文件，不取消别人暂存。
- 生成的依赖闭包和客户端 bundle 在打包任务统一纳入 `files`，不带 `.env`、数据库、日志、原材料和凭证。

## 7. 需求覆盖追踪

| 设计需求 | 实施任务 |
| --- | --- |
| R01 原应用保留/副本在工作空间 | H1、H3、A1、V1 |
| R02 复用真实 Agent 而非仅 Skill | A3、A4、V1 |
| R03 通用＋写作/PPT | A4、D1、D2 |
| R04 后续 C | V5；不列入首版完成项 |
| R05 仅规划和提示词 | A4、D1、D2、V3 |
| R06 后续直接 DSH 完成成品 | V5，设计第 11 节 C4 |
| R07 跨会话保存与继续 | A1、A2、H4、V2 |
| R08 同项目多独立任务 | A2、A5、V2 |
| R09 长期记忆与画像 | M1、M2、M5 |
| R10 自动学习不逐条审批 | M2、M3、M6 |
| R11 学习可视化 | M6 |
| R12 来源/差异/实际使用 | A4、M2、M6 |
| R13 记忆画像编辑删除撤销 | M4、M5、M6 |
| R14 分层共享 | M1、M3 |
| R15 侧栏范围调整＋领域规则 | M1、M6 |
| R16 人工固定/字段级撤销/防复活 | M3、M4 |
| R17 当前要求优先 | D1、M1、M3 |
| R18 保存/学习失败/迟到响应 | A1、A4、M2、V2 |
| R19 真实 DSH 效果验收 | H4、V3、V4 |
| R20 明确 DSH 验收位置 | H1、H3、H4、V4 |
| R21 不做设计浏览器辅助 | 计划仅文档；H4/M6 的运行期侧栏验收仍保留 |
| R22 先设计计划后实现 | 本计划及阶段检查点 |

额外核对设计正文：联网搜索确认和 3 查询/5 来源见 A6；上下文预算见 A4/D1/M1；任务删除与来源同步见 A2/M4；多窗口冲突见 A1/M4/V2；Skill 双入口一致见 M7；完整包装与卸载保数据见 V1/V4。

## 8. 自查与交接

- [x] 设计的 22 项确认需求均映射到任务。
- [x] 五段均定义交付、停止条件、测试输入和验收结果。
- [x] 内部字段统一使用 `taskId`/`memoryId`/`revision`；旧 Agent 的 `id` 只在边界显式映射。
- [x] 区分本轮实测基线、未来预期与真实效果结果。
- [x] 无依赖未验证 DSH 方法的可执行承诺；接口变更回到适配层及设计检查点。
- [x] 25 个任务均有定义；阶段 1 的真实宿主接线由接口证据生成补充计划，不以虚构 API 代替查证。
- [x] 已核对旧 PPT 的一次三问规则、写作材料类型、旧 Agent 截断及诊断阶段覆盖风险，安排适配与回归。
- [x] 删除同步清理含记忆正文的请求审计快照；完整验收必须覆盖固定必需项，漏报不算通过。
- [x] 模型请求按 run 创建独立 coordinator，以 preparedRequest 单路发送领域规则和预算后的上下文；统一 step-prompt 阶段名，并显式处理旧 coordinator 返回的 error/not-persisted。
- [ ] 实施阶段 1 至 5 尚未执行，不能将本表作为功能完成证明。

继续执行提示词：

```text
在 D:/VScode/项目/提示词工具/.dsh-workspace 内执行插件总计划。
先读 AGENTS.md、总计划和第 1 阶段计划；保留原应用和其他线程改动。
逐项更新复选框，每项先测试后实现，提交时仅指定本次文件。
先核验本机 DSH、隔离 profile、侧栏及模型上下文，再推进其余阶段。
不以 Skill 加载或模拟测试宣布首版完成；最终提供实际验收入口。
```
















## 本轮阶段一复核（2026-11-02 17:57 +08:00）

- 当前会话重新运行阶段一专项 21/21、全量回归 1134 项（1133 通过、1 跳过、0 失败）、`pnpm check`、插件构建与打包预演，全部退出码 0；证据见 `.verification/phase1-current-session-20261102/post-doc-update-rerun-20261102-175909.log`。
- 固定构建 commit 的新增 GitHub 搜索无结果；`git ls-remote` 没有匹配 ref 输出。精确提交源仍 unavailable，不以 release/master 代替。
- 隔离 Desktop 窗口仍在欢迎页；侧栏/RPC/模型请求隔离/存储重启/真实 unload 尚未验收。RUNBOOK 已注明当前面板缺少 Agent/session 与真实 unload 控件，用户初始化只能完成现有 GUI 子集，不能独自关闭整阶段门槛。
- 状态不变：阶段一未通过，阶段二不启动；下一步先完成隔离 DSH 初始化后的手册子集，再补齐真实模型隔离和 Desktop unload 验收路径。


## 当前会话阶段一补充复核（2026-11-02）

- 新增 Agent / Session 消息隔离探针：两个 DSH Agent/session 经过临时测试适配器捕获实际请求上下文；该适配器仅固定回复，不触发真实模型或网络。模拟运行时测试不代表 Desktop 真实接口验收。
- 自查并修正 RUNBOOK 与 `host-interface.json`：准确列出新增按钮，保留 `runtimeProbed: false`，明确 GUI 实测、Desktop 持久化重启、Desktop unload/re-enable 和固定构建 commit 来源对照仍未完成。
- 真实验收窗口位置：隔离 `DeepSeek Harness`（主 PID `54944`，Host PID `55728`，Host 监听 `127.0.0.1:19387`）→ 左侧栏 → “向前一步” → “验证 Agent / Session 消息隔离（测试适配器）”。当前窗口须正常关闭并由隔离启动脚本重开以加载新构建；初始化与点击实测尚未运行。五个更新文件的哈希已与工作区一致，旧版在验收目录中留有备份。
- 阶段一继续未通过；阶段二不启动。见 `docs/acceptance/forward-step-dsh/RUNBOOK.md` 与 `host-probe.md`。

## 当前会话补充核验（2026-11-02）

- 找到本机已缓存的官方源码 tag `dsh-v0.2.0-rc.2`，HEAD 为 `639ed015397290b3745d163aafe02ffee4aa3f84`；精确安装构建 commit `04f392c9ddd144fa426da2045178797da6db6c11` 不在该 checkout 对象库内，仍不能完成精确 commit 对照。
- 官方同版本源码说明通过 DSH 主侧栏“插件”页管理组合包；`dsh-base` 包含 Plugin Manager 与 HMR，`dsh-web-app` 包含侧栏管理页；本机提取的同版本 bundle manifest/patch 显示相同组件。已将正确的隔离 GUI 卸载/重启用入口和步骤补入 RUNBOOK；实际 Desktop 点击仍 not-run。
- 本机 `dsh.cmd --help` 仅确认 profile 包管理子命令形式 `dsh plugin --profile <name> <pnpm-args...>`，该 CLI 不能替代 Desktop GUI HMR 生命周期验收。当前隔离 Desktop 仍需正常重启后才加载最新插件文件。
- 阶段一未通过；须完成隔离 GUI 实测及固定构建提交证据后再进入阶段二。
- 继续核验隔离 Desktop 当前 UI Automation 可见控件仅有“登录”和“添加 API Key”，主界面尚未打开；未读取任何凭证字段。隔离主/Host PID 仍为 `54944`/`55728`，创建时间分别为 2026-11-02 16:10:07/16:10:08，启动参数指向隔离 `electron-user-data` 与隔离 profile；未观察到新版本重启。Desktop 手册状态行已记录此结果，仍须用户在隔离 GUI 完成初始化。
- 2026-11-02 再次对官方 `origin` 执行 `git fetch --no-tags origin 04f392c9ddd144fa426da2045178797da6db6c11`，退出码 128，返回 `upload-pack: not our ref`；目标 commit 仍不在可获取对象内。版本 tag 只保留为接口参考，不作为精确源码验收通过。

## 当前 Desktop 交互核验（2026-11-02 21:54 +08:00）

- 用户提供的 DSH 截图显示隔离 Desktop 已进入“向前一步”探针；UI Automation 确认侧栏和版本文案后，真实点击 Desktop 控件完成 RPC、取消、隔离存储写入/读取：均通过。原始结果在 `.verification/phase1-desktop-probe-20261102/desktop-probe.json`，手册状态表已同步。
- Desktop Agent/Session 隔离探针失败，Host 返回 `gateway/internal`；测试适配器未调用真实模型。Web Host 同一探针仍通过；两者差异尚未定位，不能按 Web 结果判 Desktop 通过。
- Plugin Manager 关闭/重新启用操作确实将 `@local/forward-step-dsh` 从隔离 profile `dsh.profile.bundles` 移除并恢复；重启用后 RPC 再次通过。但关闭期间未确认 Host service 和侧栏入口真正卸载，因此生命周期项记录 fail/partial，不冒充 pass。
- Desktop 存储重启恢复仍待关闭隔离应用并重新启动。当前尝试 UI 关闭后 DSH 转入后台/托盘，主进程与 Host 仍存活；未强制结束进程，避免把非正常退出冒充重启验收。
- 阶段 2–5 业务功能仍未实施；阶段 1 也因 Agent/Session Desktop 失败、重启恢复与卸载证据不足、目标提交源码不可获取而未通过。文章/PPT 直接生成维持后续设计，不属于首版。


## 本轮继续推进（2026-11-03）

- 发现并修复新对话任务串线：读取项目任务时，无当前绑定的新对话保持空选择，不再自动绑定最近任务；显式选择/创建仍写入绑定。Client 回归用例证明未触发 `bindTask`。
- 记忆范围 M1 开始落地：新增 `memory/policy.js` 五范围/领域筛选、来源状态、抑制、同 key 优先级/冲突、显式 override 和三条预算；`core/context.js` 与 `core/agent.js` 现在从事务状态筛选后才向模型发送，并将使用版本/排除原因存入结果版本；插件 npm 包显式包含策略模块。
- 验证：`pnpm --dir dsh-plugin/forward-step-dsh run build` 退出 0；`node --test tests/dsh-plugin/*.test.mjs tests/prompt-agent-coordinator-prepared-request.test.mjs` 77/77 通过；`git diff --check` 通过。该结果是自动化证据，不代表 DSH 重启后的新 bundle/UI/真实模型验收。
- 隔离 DSH 用户数据目录进程仍在，但本轮进程枚举未发现其可见顶层窗口；未据此操作或声称它已加载新构建。阶段一仍因固定 commit 对照、Host 生命周期新构建运行态观察和安装包卸装重装验收未过门；写作/PPT、自动学习队列、撤销/画像侧栏、真实模型与最终验收仍未完成。

### 2026-11-03 执行口径补充

隔离 Desktop UI 验收限定为补充证据：Windows MCP 负责可重复的启用/卸载、侧栏变化、存储写入与重启恢复，并保存截图/记录；构建和插件专项测试仍为独立门槛。Gateway/internal 根因仍依赖 Host/Agent 结构化诊断与日志。当前会话未暴露 Windows MCP，因此阶段一保持未通过；历史 PowerShell UI Automation 结果不冒充 Windows MCP 验收。

## 当前会话最新构建与同步复核（2026-11-03 14:15 +08:00）

- 按计划目录中的当前正式源码执行 `pnpm --dir dsh-plugin/forward-step-dsh run build`：Host、Client 和 core stage 均退出 0；日志：`.verification/phase1-desktop-probe-20261102/build-20261103-141507.log`。
- 执行 `node --test tests/dsh-plugin/*.test.mjs tests/prompt-agent-coordinator-prepared-request.test.mjs`：89/89 通过、0 失败；`git diff --check` 退出 0。日志：`.verification/phase1-desktop-probe-20261102/tests-20261103-141507.log`。`pnpm --dir dsh-plugin/forward-step-dsh pack --dry-run` 成功，包内含写作/PPT 核心模块、Agent、记忆策略与 Skill。
- 隔离 profile `node_modules/@local/forward-step-dsh` 中 7 个 Client/Host 产物与最新工作区构建 SHA256 一致，机器回执：`.verification/phase1-desktop-probe-20261102/desktop-build-sync-20261103-141507.json`。这证明文件层同步，不单独证明运行中 DSH 已重载这些字节。
- 隔离 DSH 主进程/Host PID `17496`/`35888` 当前仍存活。H4 修复后界面截图 `.verification/phase1-desktop-probe-20261102/desktop-task-read-after-envelope-fix-20261103.png`（14:01:39）显示任务读取完成且无白屏；该截图早于 14:15 构建，本轮未取得构建后的新 UI 截图，也未调用 Windows MCP。
- 阶段 1 继续未通过：需在当前隔离 DSH 窗口用 Windows MCP 验证最新 bundle 的侧栏/任务读取与重启恢复，并补齐组合包完整卸载/安装生命周期；固定构建 commit 精确源码对照仍未完成。上述自动化结果和文件哈希不替代桌面运行态验收；阶段 2 暂不启动。

## 2026-11-03 14:25 隔离 Desktop 构建后 UIA 补充核验

- 在运行中的隔离实例（主进程 `17496`、Host `35888`）确认 `node_modules/@local/forward-step-dsh` 的正式包文件与 14:15 构建一致后，调用当前面板按钮进行只读任务读取：UI 返回“已读取 2 个任务；修订 3；已恢复当前对话任务”，任务 A 的唯一标记仍在当前选中任务中；未出现白屏。证据：`.verification/phase1-desktop-probe-20261102/desktop-task-read-after-1415-build-uia-20261103.json` 与 `.png`。
- “验证 Agent / Session 消息隔离（测试适配器）”桌面探针通过：`passed:true`，A/B sessions 与 marker 互不交叉，两个 turn completed，无错误，Agent disposed 且 adapter released；使用测试适配器，不调用真实模型。证据：`desktop-agent-session-after-1415-build-uia-20261103.json` 与 `.png`。
- 当前隔离面板的 Host/Client RPC `observed:true`、取消 `gateway/cancelled`、持久化探针写入与读取 `stored:true`；完整操作结果在 `desktop-rpc-cancel-storage-after-1415-build-uia-20261103.json` 与 `.png`。
- 本轮 UI 操作为 PowerShell Windows UI Automation `InvokePattern`，不是 Windows MCP。后构建 UI 子项由此补充通过，但不能替代指定的 MCP 复测；持久化跨进程重启、真实组合包 unload/install、固定构建 commit 源码对照仍未闭合，阶段一仍未通过。结构化回执及新增截图/输出 SHA256 已写入 `desktop-build-sync-20261103-141507.json`。

## 2026-11-03 15:08 隔离 Desktop 重启与安装生命周期闭环补记

- 在隔离 profile 对齐 pnpm：DSH 自带 `11.7.0`，原 `node_modules` 链接到系统 pnpm `10.33.3` 的 store，导致 GUI 首次卸载报 `ERR_PNPM_UNEXPECTED_STORE`。只删除已校验位于隔离 profile 内的 `node_modules` 并用 DSH 内置 pnpm 重建；依赖锁文件验证通过，未改日常 profile。
- 完成隔离 Desktop 正常退出（PID `17496`，退出后隔离进程数 0）并由 `docs/acceptance/forward-step-dsh/launch-isolated-dsh.ps1` 重开（PID `31784`）。新进程中侧栏恢复；指定测试项目/会话后重新读取 2 个任务、修订 3、当前任务绑定恢复；存储 marker `forward-step-probe` 返回 `stored:true`。证据：`desktop-graceful-exit-20261103.json`、`desktop-relaunch-20261103.json`、`desktop-post-restart-restored-task-and-storage-20261103.json` 与截图。
- 当前构建下实际关闭已安装插件：侧栏入口与 `dsh.profile.bundles` 项消失。修复 pnpm store 环境后，DSH Plugin Manager 卸载令 profile dependency、bundle、安装目录均移除；从本地工作区插件目录重新安装并点“立即启用”，三者恢复。重装后任务恢复、RPC `observed:true`、Agent/Session 测试适配器 `passed:true`、持久化 marker `stored:true`。完整机器记录与 SHA256 在 `desktop-build-sync-20261103-141507.json` 的 `postBuildArtifacts`。
- 本轮 UI 操作均用 Windows UI Automation，不是 Windows MCP；MCP 专属验收证据仍未取得。固定安装构建 commit `04f392c9ddd144fa426da2045178797da6db6c11` 仍不在本机官方源码对象库，且上游 fetch 返回 `not our ref`，不能拿 tag commit 替代精确对照。因此按总门槛阶段 1 仍未通过，阶段 2 尚未开启。真实模型请求也未测试；本轮只读取 provider 列表，不接触凭证。

## 2026-11-03 15:43 隔离 Desktop 当前运行态复核

- 隔离 DSH 当前主进程 `26872`、Desktop Host `32984` 存活，Host 监听 `127.0.0.1:19387`；进程命令行指向 `.verification/dsh-desktop-isolated-20261102/profiles/desktop`，Electron userData 指向同一隔离根。
- 当前桌面截图 `.verification/dsh-click-sidebar-20261103.png` 显示插件管理页中的“向前一步 Prompt Agent”已安装并启用；截图 SHA256 `85F239174E7152BC8EACD080D95245380FA4B19E7F77CE389C4A9B326C5CEDD4`。运行收据 `.verification/desktop-runtime-resume-20261103.json` 记录了进程、profile 与本轮边界。
- 本轮窗口检查由 PowerShell 桌面输入与截图完成，不是 Windows MCP；本轮没有重新执行业务面板 RPC/Agent/Session/真实模型调用。既有 89/89 专项测试、构建、pack dry-run 与 profile 产物 4/4 哈希匹配继续作为独立证据。
- 对 `.verification/dsh-upstream-commit-check.git`、`dsh-upstream-v0.2.0-rc.2`、`upstream-dsh-source-20261103`、`dsh-runtime-source-20261103` 检查后，固定构建 commit `04f392c9ddd144fa426da2045178797da6db6c11` 均无本地对象；此前 GitHub 精确 revision 请求也未取得源码。未用 tag/master 替代精确对照。
- 阶段 1 仍保持未通过；下一步仍需取得 Windows MCP 桌面交互记录、完成固定提交源码对照，并用最新运行态补齐业务面板核验及真实模型验收。阶段 2–5 按原计划顺序推进，不因本补记提前开启。

## 2026-11-03 15:49:40 +08:00 隔离 Desktop 关窗行为复核

- 对隔离实例主窗口请求正常关闭后，15 秒及随后 20 秒内主进程 26872 和 Host 32984 仍运行，Host 仍监听 127.0.0.1:19387；主窗口变为隐藏而非进程退出，未强制终止。
- 使用原窗口句柄恢复后，DeepSeek Harness 窗口再次可见；截图 .verification/dsh-restored-window-20261103.png，SHA256 2050A55DE71F6FA4C3DC93C719702F251A841B1A303E940EBD004058F3B5B619。当前保持同一隔离 profile 与已启用插件状态。
- 由于主进程未退出，本轮没有尝试以额外启动参数重开实例或开启调试端口；避免在同一 profile 并发启动第二个 Desktop Host。后续运行态操作继续使用当前隔离窗口及既有验收路径。

## 2026-11-03 16:00:24 +08:00 隔离 Desktop renderer 直连探查

- 隔离 Host 127.0.0.1:19387 的只读 HTTP 探查：GET /json/version 超时、GET /json/list 返回 404、GET / 返回 401；该端口是 DSH Host 服务，不是 Chromium DevTools/CDP 入口。
- 当前 UI 仍停在插件管理页，向前一步 Prompt Agent 显示已安装并启用；本轮桌面输入未成功切换到业务面板，因此不新增 RPC 或真实模型通过结论。
- 当前进程未完整退出且 Host 仍运行；不并发启动同一 profile 的第二个 Desktop Host。后续继续使用既有 UI Automation 方式或等待可调用的 Windows MCP 工具，不把 Host API 端口误当作 renderer 调试接口。
