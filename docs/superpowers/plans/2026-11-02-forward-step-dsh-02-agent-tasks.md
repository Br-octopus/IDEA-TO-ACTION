# 通用 Agent 与多任务续接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让真实 Agent 在侧栏推进独立任务，可靠保存原文、步骤、提示词、结果和历史，并跨对话恢复。

**Architecture:** 在旧 Agent task 外加持久化任务外壳，避免旧 schema 丢字段或截断原始输入。采用一次原子状态提交维护实体与历史；模型调用不占用事务，返回时检查原任务及修订。

**Tech Stack:** 原 CommonJS/UMD 核心、ESM 插件、Node.js SQLite、node:test、阶段 1 已验证 HostPort。

---

## 工作目录与文件

根目录固定为 `D:/VScode/项目/提示词工具/.dsh-workspace`；所有相对文件均位于此目录。前置条件：阶段 1 全部通过且 `host-binding-plan.md` 已冻结真实接口。首次实现选择 SQLite；若 H1 已证明宿主存储满足同等条件，应先记录等价实现补充计划。

| 任务 | 创建或修改文件 |
| --- | --- |
| A1 | `dsh-plugin/forward-step-dsh/core/schema.js`、`core/store.js`；`tests/dsh-plugin/store.test.mjs` |
| A2 | `dsh-plugin/forward-step-dsh/core/tasks.js`；`tests/dsh-plugin/tasks.test.mjs` |
| A3 | `scripts/dsh-stage-core.mjs`、插件 `package.json`、`vendor/core/package.json`；`tests/dsh-plugin/package.test.mjs` |
| A4 | 插件 `core/context.js`、`core/agent.js`、`core/methods.js`；副本 `prototype/prompt-agent-coordinator.js`；`tests/dsh-plugin/agent.test.mjs`、`context.test.mjs` |
| A5 | 插件 `index.js`、`client/panel.js`、`client/state.js`、`client/tasks.js`、`client/panel.css`；`tests/dsh-plugin/client-state.test.mjs` |
| A6 | 插件 `core/agent.js`、`client/tasks.js`；`tests/dsh-plugin/research.test.mjs` |

下文 `插件` 均指根目录下 `dsh-plugin/forward-step-dsh/`，不指原应用同名文件。

## Task A1: 原子持久化、修订及幂等

- [x] `store.test.mjs` 先红测：缺少模块时 `ERR_MODULE_NOT_FOUND`、退出 1。
- [x] `core/schema.js` 导出每次独立创建的 `initialState()`；`core/store.js` 通过 Node `node:sqlite` 单状态行实现 revision CAS、幂等 eventId、同步事务、错误回滚、schemaVersion 防误覆盖和 defensive clone。
- [x] `node --test tests/dsh-plugin/store.test.mjs`：9 tests、9 pass、0 fail、退出 0；覆盖重开、幂等、双连接冲突、异常/异步 rollback、schema 拒绝、读副本、参数和关闭状态。
- [ ] Host 启动前把 SQLite 文件限定到隔离 `DSH_HOME` 下插件专属数据目录；当前只验证 Node CLI 24.14.1 的内存 SQLite API。需在 DSH 内嵌 Node 24.18.1 及实际数据根验证后再把宿主持久化标为完成。

## Task A2: 项目、任务外壳与对话绑定

- [x] `tasks.test.mjs` 初始红测：`core/tasks.js` 缺失，`ERR_MODULE_NOT_FOUND`、退出 1。
- [x] 实现 `canonicalProjectId`、`createTask`、`updateTask`、`bindTask`、`getCurrentBinding`、`listTasks`、`archiveTask`、`deleteTask`；写操作使用 A1 状态事务，同一事务追加变更记录。
- [x] `node --test tests/dsh-plugin/tasks.test.mjs`：9 tests、9 pass、0 fail、退出 0；覆盖不同目录隔离、原文完整保留、多对话绑定/切换历史、身份及 revision 校验、领域材料/版本保留、归档恢复、删除确认和影响预览、幂等绑定及重命名历史。
- [ ] 尚需把每个写接口接入正式 Host/Client service，并以隔离 DSH profile 验证保存后重启续接；不得把 Node 单测等同 DSH 验收。
## Task A2: 项目、任务外壳与对话绑定

- [ ] 在 `tasks.test.mjs` 先写：创建同项目 t1/t2，t1 绑定 c1/c2，c1 后续切到 t2；历史绑定保留原 taskId，读取当前绑定为 t2，t1 当前步骤不变。运行 `node --test tests/dsh-plugin/tasks.test.mjs`，先以缺少模块失败。

- [ ] `core/tasks.js` 导出以下函数；所有写入接受 `{expectedRevision,eventId}` 并调用 A1 同一事务，不单独写文件：

```javascript
// canonicalProjectId(cwd) -> string
// createTask(store, {cwd,title,entryType,domain,originalInput,conversationId}, tx) -> Task
// updateTask(store, {taskId,taskRevision,patch}, tx) -> Task
// bindTask(store, {projectId,taskId,conversationId}, tx) -> Binding
// listTasks(store, {projectId,archived}) -> Task[]
// archiveTask(store, {taskId,taskRevision,archived}, tx) -> Task
// deleteTask(store, {taskId,taskRevision,confirmed,clearLearned}, tx) -> State
```

`entryType` 仅为 `advance-idea|optimize-prompt|diagnose-ai-result`；`domain` 仅为 `general|writing|ppt`。未知值报 `invalid_input`，不静默变成通用。`updateTask` 不允许 patch 修改 projectId/taskId/revision；改变要求会将现有提示词版本标记需复查。

- [ ] 项目标识按真实目录规范化并哈希，Windows 大小写等价；目录移动不自动关联：

```javascript
import { realpathSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
export function canonicalProjectId(cwd) {
  const absolute = realpathSync.native(cwd).replaceAll('\\', '/');
  const normalized = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  return createHash('sha256').update(normalized).digest('hex');
}
// createTask 内生成 taskId=randomUUID()，agent.id=taskId；不得按标题生成标识。
```

- [ ] 创建外壳时保存总计划 Task 全字段，`revision:1`、`versions:[]`、`reviews:[]`、`conversations:[conversationId]`；用 `createPromptAgentTask({id:taskId,type:entryType,goal:originalInput})` 仅创建内部摘要。输入 1200 字时断言 `originalInput` 完整，不能从短 goal 反推原文。

- [ ] 绑定使用 `{projectId,taskId,conversationId,eventId,createdAt}` 追加历史，当前绑定取该 project/conversation 的最后一项；不回写旧事件。服务必须检查请求的项目/任务/对话与当前上下文一致，不能只相信客户端传来 taskId。

- [ ] 新增独立用例：同名不同目录不合并；同任务两对话共享进度；新对话无旧对话记忆；重命名/归档/恢复不丢历史；切换 domain 不丢 materials/versions；删除未确认失败；删除时返回明确影响预览。A2 阶段无学习数据时已实现完整清理入口，M4 扩展其记忆证据处理。

- [ ] 同一测试文件通过后提交 `feat: 支持多任务和跨对话绑定`。

## Task A3: 分发真实核心依赖，而非引用工作目录

- [ ] 在 `package.test.mjs` 写打包后移到系统临时目录、隐藏 W/prototype 可见性的导入测试；断言 coordinator、writing、PPT 三根模块均能独立加载。当前包没有核心，应先失败。

- [ ] 新建 `scripts/dsh-stage-core.mjs`，依赖解析使用 Node 解析器而不是正则扫描 require：

```javascript
import { createRequire } from 'node:module';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
const require = createRequire(import.meta.url);
const source = resolve('prototype');
const target = resolve('dsh-plugin/forward-step-dsh/vendor/core');
for (const file of ['prompt-agent-coordinator.js','writing-workbench-prompts.js','ppt-scene-prompts.js']) {
  require(resolve(source, file));
}
const files = Object.keys(require.cache).filter(file => {
  const path = relative(source, file);
  return path && !path.startsWith('..') && !path.startsWith('/');
});
for (const file of files.sort()) {
  const destination = resolve(target, relative(source, file));
  await mkdir(dirname(destination), {recursive:true});
  await copyFile(file, destination);
}
await writeFile(resolve(target, 'package.json'), '{"type":"commonjs"}\n');
console.log(`STAGED_CORE_FILES: ${files.length}`);
```

脚本另保存 `vendor/core/manifest.json`：源相对路径、SHA256、构建时间；测试禁止 `electron`、`server`、绝对外部路径、凭证。每次构建先依据上次清单删除已不存在的生成文件，目标必须验证位于 vendor/core；不清理人工文件。

- [ ] 执行 `node scripts/dsh-stage-core.mjs`，当前闭包预期 21 个 JS，数量变化应审查清单而非固定为报错条件。插件内部用 `createRequire(import.meta.url)` 加载 `../vendor/core/` 中 CJS，禁止在已分发代码导入 `../../../prototype`。

- [ ] 插件 package 的 `files` 纳入 `host`、`core`、`memory`、`client` 构建产物、`vendor/core`；具体客户端构建命令沿用 H1。打包测试在阶段 V1 再检查一次完整清单。

- [ ] `node --test tests/dsh-plugin/package.test.mjs` 通过，提交 `build: 打包插件可独立运行的核心依赖`。

## Task A4: 通用流程、上下文预算、取消与保存

- [ ] 写 `agent.test.mjs`：用受控 Promise 模型，先请求 t1、切换 t2、完成 t1；断言 t2 的版本列表没有 t1 结果，t1 旧请求返回 `stale_response`。取消后返回也不保存；相同 requestId 回调两次只保存一次。先运行失败。

- [ ] `core/context.js` 导出 `buildContext({task,stage,methodPrompt,memories,sources,maxChars})`，返回 `{messages,usedMemories,usedSources,omissions}`。methodPrompt 来自 `buildMethodPrompt(task,stage)`，不能只构建却未发送。阶段 4 前 memories 为空数组，仍实现最多三条上限。默认三领域均以 8000 字符为保守上限，H1 若取得更低宿主限制则用两者较小值；写作必须保持不超过 8000。

- [ ] 构建时把 `originalInput`、`currentRequirements`、当前反馈和保留项放入不可静默裁剪区；材料和记忆是独立引用区。先校验强约束总长，再逐条加入可选引用；每次重新序列化测量，不从最终字符串随意 slice：

```javascript
// assemble 为本函数内将固定区和引用区转换为 messages 的纯函数。
const budgetError = () => Object.assign(new Error('必要要求超过请求预算，请缩小材料范围'), {code:'budget_exceeded'});
if (JSON.stringify(assemble([], [])).length > maxChars) throw budgetError();
// 候选先完成范围过滤，再按相关性加入；放不下的记入 omissions，不修改输入。
```

记录每条 usedMemories 的 `{memoryId,revision}`；usedSources 为 sourceId 列表。预算按完整 messages 测量，宿主固定系统提示另由 H1 核对 token 余量；不只统计最后一条 user 消息。

- [ ] `core/agent.js` 导出 `createAgentService({store,host,coordinatorFactory,buildContext,buildMethodPrompt,onTaskCommitted}) -> {run,cancel}`，`run({taskId,conversationId,stage,requestId,expectedTaskRevision,signal})`。coordinatorFactory 使用 vendor 中实际导出的 `createPromptAgentCoordinator`，每次 run 创建独立实例，禁止可变的共享“当前任务”。`onTaskCommitted` 默认空函数，阶段 4 换成学习 worker 唤醒；不能在此回调内改变已经保存的任务结果。

- [ ] 阶段名统一为 `clarification|diagnosis|planning|step-prompt|review`；仅在入口把旧 `route` 映射到 planning，未知名称报 invalid_input。PPT 的 brief/outline/slides/route-prompt 是领域内部阶段，不能代替上述 Agent 阶段。

- [ ] 依次实现可单测的执行段：捕获绑定和修订 → 只使用当前任务组装 → coordinator.runStage → 检查 signal/绑定/任务修订 → 事务保存版本及实际请求快照 → 返回已保存结果 → 事务外唤醒学习。每次保存读取最新仓库 revision，并在事务内重新检查捕获的任务 revision；仅其他任务或学习导致仓库 revision 冲突时最多重试三次，不因此覆盖原任务修改。耗尽返回 conflict 并保留草稿，真正存储异常返回 storage_failure。唤醒学习失败单独记录，不把已保存任务改成保存失败；model 返回异常保留任务原文和旧版本。

- [ ] 先扩展副本 coordinator 的 `runStage` 可选参数 `preparedRequest:{messages,selectedSources}`：存在时校验 messages 数组与 sourceId、深复制后直接采用，跳过内部 selectMaterials、mergeSelectedSources、buildStageBase、inputExcerpt 及 sourceContext 拼接；不存在时完全保留旧路径。该分支仍复用原有取消、超时和返回结构。先写测试证明提供预构建请求时 retriever 调用为 0、requestModel 收到逐字相同 messages、返回的 selectedSources 与实际采用来源一致；旧路径的原有测试仍通过。

- [ ] 请求模型适配到旧 coordinator 的字符串返回值，同时审计 HostPort 实际消息。以下代码位于一次 run 内；bound 是捕获并深复制的任务绑定，snapshot 是任务快照，eligibleSources 是仅当前任务校验通过的材料数组，selectedMemories 在阶段 4 前为空，maxChars 来自宿主预算。新请求先按 requestId 在服务内部登记独立 requestController=new AbortController()，将外部 signal 的 abort 单向转发到它，随后执行：

```javascript
const methodPrompt = buildMethodPrompt(snapshot, stage);
const context = buildContext({task:snapshot,stage,methodPrompt,
  memories:selectedMemories,sources:eligibleSources,maxChars});
const selectedSources = eligibleSources.filter(source => context.usedSources.includes(source.sourceId));
let actualResponse;
const coordinator = coordinatorFactory({
  requestModel: async ({messages,signal}) => {
    actualResponse = await host.requestModel({
      messages,signal,projectId:bound.projectId,taskId:bound.taskId,
      conversationId:bound.conversationId,requestId:bound.requestId
    });
    if (!Array.isArray(actualResponse.sentMessages)) {
      throw Object.assign(new Error('缺少实际请求快照'), {code:'unsupported_host'});
    }
    return actualResponse.text;
  }
});
const result = await coordinator.runStage(snapshot.agent, {
  stage,runId:bound.requestId,signal:requestController.signal,
  preparedRequest:{messages:context.messages,selectedSources}
});
```

模型回调必须转发 coordinator 给出的 signal，否则其内部超时不会中止宿主请求。`cancel(requestId)` 通过该请求独有的 AbortController 中止，外部 signal 已 aborted 时也立即转发；finally 从请求表释放监听和实例。保存 actualResponse.sentMessages 的受限快照属于任务生成版本，用于跨任务泄漏测试，不存入跨项目学习日志。不重复将 coordinator 摘要与新的长上下文各发送一次；仅从 context.usedSources 生成采用记录。

- [ ] coordinator 返回 `.error` 不会抛出，服务必须显式处理：timeout/model_unavailable 映射 model_failure，cancelled 保留；扩展 coordinator catch 保留已知插件错误码 unsupported_host/budget_exceeded，未知异常归 model_failure。错误分支不保存旧 draft 为新版本。旧 `persistence.status:'not-persisted'` 不是成功依据，只有外壳事务完成才返回已保存。任务绑定/修订校验失败丢弃本轮持久化，finally 清理请求；重复 requestId 复用正在执行的 Promise 或已提交记录，不新发模型请求。

- [ ] 在副本 coordinator 的 `buildStageBase` 修复结果诊断入口永久覆盖后续 stage 的风险：`stage==='diagnosis'` 才直接选择诊断 prompt；入口用于默认初始阶段，不覆盖显式 planning/step-prompt/review。为 `diagnose-ai-result + planning`、`diagnose-ai-result + review` 各加断言，再重新 stage 核心。

- [ ] `core/methods.js` 先实现通用方法：澄清/诊断/规划/当前步骤/复盘依次调用已有五个 prompt builder，不重写规则引擎。澄清每次一问，累计默认至多三问；新目标显式重置轮次。不解析模型任意文本自动改步骤；服务校验结构化路线 3–7 步，偏离时保留草稿并提示修正。

- [ ] `context.test.mjs` 独立用例：1200 字目标完整发送；第 4 条引用未采用且有原因；强约束超过预算报错且未调用模型；旧任务标记不出现；材料里的指令作为引用而非系统指令；输入、used 记录和实际发送保持一致。agent.test.mjs 增加并发 t1/t2 的 model callback 各接收自身任务方法规则和唯一标记、内部检索零调用、超时 signal 到达 host、结果含 error 时版本数不增加；不只单测 buildMethodPrompt 而漏掉实际请求。

- [ ] 运行 `node --test tests/dsh-plugin/agent.test.mjs tests/dsh-plugin/context.test.mjs tests/prompt-agent-coordinator.test.js tests/prompt-agent-workflow.test.js`，预期全部通过。提交 `feat: 接入可保存和取消的通用Agent流程`。

## Task A5: 原生侧栏的任务操作与未保存状态

- [ ] `client-state.test.mjs` 先覆盖 `reduceClient(state,event)`：`save.failed` 保留 draft 并设 `saveStatus:'unsaved'`；`task.selected` 隔离草稿；`request.late` 不替换当前输出；`conflict` 同时保留本地内容和服务端版本。运行该测试，先失败。

- [ ] `client/state.js` 实现纯 reducer，状态固定为 `{selectedTaskId,draftsByTask,requestByTask,saveStatusByTask,conflictsByTask}`。保存成功只能来自服务事务确认；浏览器组件状态不算成功：

```javascript
export function reduceClient(state, event) {
  if (event.type === 'save.failed') return {
    ...state,
    draftsByTask: {...state.draftsByTask, [event.taskId]:event.draft},
    saveStatusByTask: {...state.saveStatusByTask, [event.taskId]:'unsaved'}
  };
  if (event.type === 'task.selected') return {...state, selectedTaskId:event.taskId};
  return state;
}
```

继续以测试驱动增加其余事件，组件只发送服务请求，不直接改 store。所有服务请求包括 taskId、预期 taskRevision 和幂等 eventId。

- [ ] `client/tasks.js` 实现新建/重命名/切换/归档/恢复、删除确认及进度/版本视图。入口类型与 domain 分开选，纠正分类不清空原文。提示词区域可编辑、复制；外部结果区域可粘贴，选择 stepId 和 promptVersionId。取消、重试、上一步、切步均保留已保存版本。

- [ ] 使用 H1 确认的客户端框架与现有图标库，不增加独立 UI 平台。`panel.css` 固定工具按钮尺寸、紧凑分栏，侧栏 320/480/800px 宽度检查文本、滚动、焦点和长任务名；不加入功能宣传文字。

- [ ] 在 `index.js` 保留原 Skill provider，装配 adapter/store/tasks/agent，注册实际服务和面板。卸载处理按逆序 dispose，关闭数据库；更新原 `forward-step-dsh.test.js` 的 inject 断言为 H1 实际依赖，不保留只注入 skills 的旧断言。

- [ ] 自动测试通过后，在真实侧栏创建两篇文章和一份 PPT，填入不同唯一标记，依次切换、新对话、重启；核对草稿/步骤/历史/实际上下文全部归属正确。保存失败时当前输入仍可复制。

- [ ] 提交 `feat: 增加侧栏多任务和进度操作`。

## Task A6: 联网研究保留原确认流程

- [ ] `research.test.mjs` 用假 searchWeb 计数：批准前调用数必须为 0；默认最多 3 个查询/5 个来源；拒绝后同任务再次申请不弹确认。`node --test tests/dsh-plugin/research.test.mjs` 先失败。

- [ ] 沿用 coordinator 的 preview/approve/reject/execute 流程；侧栏展示目标、查询、预算及批准/拒绝操作。研究状态保存在 task.agent，不放全局变量。把仅当前任务已批准的查询交给 HostPort 适配层中 H1 已核验工具；接口未提供时显示未执行，保留本地路线。

```javascript
// 研究执行入口前的业务校验，默认预算不放大。
if (task.agent.researchDecision !== 'approved') {
  throw Object.assign(new Error('联网研究尚未确认'), {code:'invalid_input'});
}
const queries = task.agent.researchScope.queries;
if (!Array.isArray(queries) || queries.length > 3) {
  throw Object.assign(new Error('查询超出本轮预算'), {code:'invalid_input'});
}
```

H1 未提供研究工具时不得凭空增加端口方法；若要支持新的宿主工具能力，先补 host 收据、HostPort 契约及适配测试。来源最多五条存档，最多三条摘要入上下文；失败不伪造研究结论。

- [ ] 再测研究失败、请求重复、取消、用户拒绝后重启，确保输入及拒绝状态保留。测试通过提交 `feat: 保留联网研究预览确认和预算限制`。

## 阶段完成检查

- [ ] 每次提交仅 `git add --` 明确相对 G 的本任务文件；核对暂存清单，消息不夹带原应用改动。
- [ ] `node --test tests/dsh-plugin/*.test.mjs` 与总计划 89 项基线均通过；命令在 pwsh 中由 Node 展开通配符，若运行时不支持则列出实际文件参数。
- [ ] 真实 GUI 重启与新对话恢复通过，保存失败、取消、迟到、重复回调和同任务冲突均有记录。
- [ ] 普通通用任务完成到手动外部结果回填；版本关联与领域连续改稿在阶段 3 完成，不提前宣布首版完成。



## 2026-11-03 阶段二续做记录（未完成）

- [x] `core/methods.js` 五阶段均追加首版边界：插件只产出规划、分析及外部 AI 执行提示词，不在插件内直接生成文章/PPT 成品；`methods.test.mjs`、`context.test.mjs` 共 8 项通过。
- [x] 新建 `core/agent.js` 最小运行闭环：校验任务修订和当前对话绑定、组装实际任务上下文、传播取消信号、结果以版本原子保存、拒绝迟到结果、requestId 幂等。
- [x] 新建 `tests/dsh-plugin/agent.test.mjs`，覆盖持久化、重复请求、过期修订、切换绑定、并发迟到结果和取消；4 项通过。
- [x] 阶段一/阶段二现有专项测试集合：46 tests、46 pass、0 fail；插件 build（stage:core、Host 生成、Client bundle）通过。
- [ ] 当前 `core/agent.js` 仍是可测核心模块，尚未接入副本 coordinator 的 `preparedRequest` 分支，也未注册为正式 Host RPC/侧栏任务操作；阶段二未完成。
- [ ] 当前仅 Node CLI SQLite 通过，尚未在 DSH 内嵌 Node 24.18.1/插件专属数据根验证；不得据此宣布持久化宿主验收完成。
- [ ] 本轮未调用 Windows MCP。等 Host+Client 业务接线完成并将最新构建同步至隔离 profile 后，再按约定用 Windows MCP 验证侧栏、重启恢复并保存 UI 证据；此验收不替代构建、专项测试或结构化根因诊断。


### 2026-11-03 Host RPC 与当前任务自动恢复补记

- [x] Host/Client 新增 `getCurrentBinding(projectId, conversationId)`；侧栏读取项目任务时恢复当前 DSH 对话的显式绑定，不以项目首个任务覆盖当前任务；无绑定的新对话保持未选中，等待用户显式选择/创建后再绑定。
- [x] 新增 Client 测试，验证两任务项目中恢复当前对话绑定 B；新增 Host service 持久化 RPC 测试，验证 A/B 对话绑定和新对话返回 null。Host/Client 构建通过，Typert invocation 数量为 13。
- [x] 回归修复：任务列表加载时不再为无绑定的新对话自动选择/绑定最近任务；显式选择仍绑定。`tests/dsh-plugin/client.test.mjs` 覆盖空绑定与无写操作；Client 构建及该测试文件 5/5 通过。
- [ ] 最新变更尚未在 Desktop 运行态验收；隔离 DSH 主进程请求正常退出后仍运行，未强制终止。


### 2026-11-03 任务会话恢复及 Host 竞态回归

- [x] 增加 `getCurrentBinding` Host RPC；Client 重载项目任务先恢复当前 DSH 对话绑定，项目或对话标识改变后清理旧选择并等待显式读取/绑定。
- [x] 新增测试覆盖绑定读取、跨对话隔离、无绑定返回空、Client 恢复正确任务，以及卸载期间 Agent、Domain 初始化和持久化事务清理。
- [x] Host/Client 构建与插件/准备请求回归 66/66 通过。
- [ ] 当前实现尚未在真实 Desktop 最新 Host 进程验证；更广泛的 A5 管理、A6 联网研究及计划剩余项仍需继续。


## 2026-11-03 A5 任务管理接线进度（部分完成）

- [x] Host 新增 `updateTask`、`archiveTask`、`previewDeleteTask`、`deleteTask` RPC；校验项目 ID、当前对话绑定和 taskRevision。更新/归档/删除请求携带 eventId；核心新增只读删除影响预览。
- [x] 侧栏增加入口类型与领域分别选择、归档列表切换、任务重命名、归档/恢复、先预览再二次确认删除。加载已绑定任务时恢复名称草稿。
- [x] `tasks.test.mjs` 覆盖删除预览只读和旧修订冲突；Host RPC 集成测试覆盖重命名、跨对话拒绝、陈旧修订拒绝、归档、预览与删除；Client 测试覆盖重命名事件及确认删除交互。
- [x] 构建生成 Host/Remote descriptor 共 18 项；完整专项集合 93/93 通过。
- [ ] A5 仍未完成：未保存草稿/reducer 冲突状态、外部结果粘贴/编辑及 step/promptVersion 关联、按钮布局/320-480-800px 可用性、隔离 DSH Desktop 实际 CRUD 与重启验收待完成。
- [x] 增加 `client/state.js` 纯 reducer 与独立测试：保存失败保留草稿/标记 unsaved；不同任务草稿隔离；冲突保留本地与服务器版本；迟到事件不覆盖当前任务结果。侧栏重命名路径使用该 reducer，冲突时重新读取服务器任务并保留本地草稿。
- [ ] 草稿目前只在 Client 面板内存态保存，关闭/重启后的未保存草稿恢复仍未实现；Agent request 的 reducer 事件目前未全量接入运行按钮。

### 2026-11-03 Desktop 验收补记（A5 部分项）

- 已通过隔离 DSH UI 完成三类任务的切换、删除影响预览与确认，以及唯一标记任务退出/重启后的任务和对话绑定恢复；记录见 `docs/acceptance/forward-step-dsh/phase2-a5-desktop-crud-restart-20261103.json`。
- 此项只关闭任务 CRUD 与基础任务持久化子验证；本计划的草稿/步骤/版本/外部结果上下文以及侧栏宽度完整验收仍为未完成，因此不勾选阶段二整项。

### 2026-11-04 A5 本机草稿持久化实现

- [x] 新增 `client/drafts.js`，使用 DSH renderer 的本机 `localStorage`，按编码后的 `{projectId, taskId}` 独立存储名称、外部结果、复盘反馈及其 step/promptVersion 选择；不保存 provider/model，也不进入学习记忆。
- [x] 读取任务时恢复草稿；恢复的任务名仍标记为未同步。输入存储失败时保留面板内存值并显示错误；Host 成功保存名称/外部结果后清理相应草稿；任务删除成功后只清理该任务的本机草稿。
- [x] `drafts.test.mjs` 覆盖跨项目/任务隔离、字段合并、按任务删除及存储失败；`client.test.mjs` 覆盖面板重开后的名称/外部结果/复盘反馈恢复，并验证删除任务会清理本机草稿。
- [x] 最新 Host/Client 构建成功；全量专项回归 105/105 通过；`pnpm pack --dry-run` 清单包含 `client/drafts.js`。
- [ ] A5 仍未完成：320/480/800px 侧栏可用性与隔离 DSH 实际编辑草稿、正常退出/重启恢复、保存失败和删除清理尚待桌面验收；Agent request reducer 全量接入仍是计划项。
