# 分层记忆、自动学习与画像侧栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自动学习有依据的偏好和方法经验，让用户在侧栏看见、纠正、调整范围和撤销，并保证失效记忆不继续影响生成。

**Architecture:** 记忆、来源、变更、抑制和学习任务使用同一事务仓库。画像实时投影有效记忆，不另存自由文本正文；检索先校验范围/领域/来源，再处理冲突及预算。任务保存与异步学习分离，学习本身原子提交。

**Tech Stack:** 阶段 2 SQLite 事务和 HostPort、阶段 3 版本链、Node.js 内置测试、原生侧栏客户端。

---

## 工作目录与文件责任

目录固定为 `D:/VScode/项目/提示词工具/.dsh-workspace`；下列相对路径都在该目录。前置条件：H/A/D 阶段通过。自动提升的“两独立任务”是设计默认值，不写成用户硬性要求。

| 任务 | 创建/修改文件 |
| --- | --- |
| M1 | `dsh-plugin/forward-step-dsh/memory/policy.js`、`core/context.js`；`tests/dsh-plugin/memory-policy.test.mjs` |
| M2 | 插件 `memory/service.js`、`core/agent.js`、`index.js`；`tests/dsh-plugin/learning.test.mjs` |
| M3 | 插件 `memory/policy.js`、`memory/service.js`；`tests/dsh-plugin/memory-promotion.test.mjs` |
| M4 | 插件 `memory/history.js`、`core/tasks.js`；`tests/dsh-plugin/memory-history.test.mjs` |
| M5 | 插件 `memory/profile.js`；`tests/dsh-plugin/profile-view.test.mjs` |
| M6 | 插件 `client/memory.js`、`client/state.js`、`client/panel.js`、`client/panel.css`；`tests/dsh-plugin/memory-view.test.mjs` |
| M7 | 插件 `skills/forward-step/SKILL.md`；副本 `.dsh/skills/forward-step/SKILL.md`（若仍注册）；`tests/forward-step-dsh.test.js` |

共用数据契约沿总计划第 5 节。sourceRefs 为 SourceRef.sourceId 数组，不是把原文复制到每个事件；history 存 before/after 时，删除操作必须同步清理这些正文副本。

## Task M1: 五范围、领域交叉过滤和优先级

- [ ] 写 `memory-policy.test.mjs` 的第一个失败用例，直接使用真实数组，不依赖模型判断：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMemories } from '../../dsh-plugin/forward-step-dsh/memory/policy.js';
test('项目范围的PPT偏好不影响其他项目和写作', () => {
  const state = {
    memories:[{memoryId:'m1',revision:1,key:'slideDensity',value:'每页少字',
      scope:'project',domains:['ppt'],projectId:'p1',status:'active',
      manualScope:true,sourceRefs:['s1']}],
    sources:[{sourceId:'s1',active:true,userAuthored:true}], suppressions:[]
  };
  const context = {projectId:'p1',taskId:'t1',conversationId:'c1',domain:'ppt'};
  assert.equal(selectMemories(state, context).selected.length, 1);
  assert.equal(selectMemories(state, {...context,projectId:'p2'}).selected.length, 0);
  assert.equal(selectMemories(state, {...context,domain:'writing'}).selected.length, 0);
});
```

- [ ] `node --test tests/dsh-plugin/memory-policy.test.mjs`，预期模块不存在失败；创建 `selectMemories(state, context, {limit=3,overrides=[]}={}) -> {selected,excluded}`。excluded 记录 memoryId 与枚举原因 `scope|domain|inactive|source|suppressed|conflict|overridden|budget`，不在其他项目面板暴露被过滤记忆正文。

- [ ] 实现范围和领域的交集过滤，任何未知 scope 默认不通过：

```javascript
export function inScope(memory, context) {
  if (memory.domains?.length && !memory.domains.includes(context.domain)) return false;
  switch (memory.scope) {
    case 'global': return true;
    case 'domain': return Boolean(memory.domains?.includes(context.domain));
    case 'project': return memory.projectId === context.projectId;
    case 'task': return memory.projectId === context.projectId && memory.taskId === context.taskId;
    case 'conversation': return memory.projectId === context.projectId && memory.taskId === context.taskId && memory.conversationId === context.conversationId;
    default: return false;
  }
}
```

- [ ] 有效记忆必须 status=active、有至少一个 active 来源，未被抑制。先按 scope/domain 过滤，再同 key 冲突决议：`overrides > conversation > task > project > domain > global`；同层冲突未有明确纠正则不选择，返回 conflict。当前显式要求优先级始终最高，不按记忆创建时间覆盖当前任务。

- [ ] `overrides` 是本次已明确的 `{key,value}` 数组，持久化在 task.methodState.currentOverrides，原要求全文仍保留 currentRequirements。只对能归一为稳定 key 的要求做机器排除；其余要求在最高优先级指令区声明，不假称自动理解全部自然语言矛盾。首次 key 集合从 `verbosity`、`tone`、`language`、`slideDensity` 开始，未知用户偏好仍保留为候选而非乱覆盖。

- [ ] 将 M1 结果交给 A4，预算最多三条；按任务相关性和范围明确度选择，而非全局必注入。保存实际 memoryId/revision；侧栏可看未采用原因，不把所有原始资料跨项目发送。

- [ ] 逐条新增测试：global 跨项目；domain 只在同领域；task 跨对话；conversation 在新对话无效；project+ppt 双过滤；source 失效不选；candidate 不选；显式 verbosity 覆盖全局；同 key 不叠加矛盾指令；超三条有遗漏原因。每条运行红→改→绿。

- [ ] 同一测试文件全部通过，提交 `feat: 实现五范围记忆过滤与当前要求优先`。

## Task M2: 保存后自动学习、持久化队列与原子更新

- [ ] 写 `learning.test.mjs`：任务生成提交成功后，抽取模型抛异常，重开 store 仍读到任务版本；learning job 为 failed；重试成功只产生一条记忆与一个学习事件。先运行 `node --test tests/dsh-plugin/learning.test.mjs`，预期模块/功能缺失失败。

- [ ] 学习来源仅为已绑定任务的新增用户消息、显式反馈、显式提供的材料及任务结果引用。每个 SourceRef 含 sourceId/projectId/taskId/conversationId/locator/kind/excerpt/digest/active/userAuthored；资料观点不等同于用户偏好，模型输出 userAuthored=false，不能作为正确事实的独立证据。

- [ ] `memory/service.js` 导出 `createLearningService({store,extract,now}) -> {drain,retry,setPaused}`；extract 接受 `{jobId,sourceRefs,context,signal}`，返回 `{candidates:[{key,value,sourceRefs,requestedScope,domains,reason,projectSpecific,conflict}],summary}`。响应必须解析 JSON、校验字段类型和来源归属；不存在的 sourceId、材料内命令、凭证及敏感身份推断拒绝保存，不透传原始模型异常。

- [ ] 任务事务中同时追加 queued job，事务后 `onTaskCommitted` 只唤醒 worker，避免崩溃后丢学习意图：

```javascript
// 与任务版本追加处于同一 store.transact 内。
const jobId = `learn:${requestId}`;
if (!state.learning.paused && !state.learning.jobs.some(job => job.jobId === jobId)) {
  state.learning.jobs.push({jobId,taskId,projectId,conversationId,
    sourceRefs:[...newSourceIds],status:'queued',attempts:0,createdAt:new Date().toISOString()});
}
```

requestId/newSourceIds 均来自已捕获并校验的本轮操作；没有新增来源不抽取。修改 task schema 不用旧 normalize 丢弃 job。重启时恢复 queued/中断的 running，worker 领取使用修订校验和 leaseUntil；跨窗口只有租约持有者可提交，过期租约可恢复。

- [ ] `drain` 分三步：原子领取 job → 事务外 extract → 原子验证 job lease、来源仍有效和 paused 状态，再提交 memories/changes/job 完成。模型失败写 job.failed；写学习结果失败不增加半条 memory 或 change。eventId 固定 `apply:${jobId}`，重复完成不重复学习。

- [ ] 暂停开关事务保存；暂停时任务仍保存但不创建新学习 job。已排队 job 保留 paused 状态，正在抽取的结果在提交时再次检查，不落新记忆；恢复时允许处理已有明确 queued job，不重扫暂停期间全部对话。

- [ ] 提取明确且低争议的用户偏好默认 active，并显示撤销；证据不足/矛盾/资料观点为 candidate。此分支不能把所有项都置 candidate 等逐条批准。只有 user-confirmed 外部结果才可形成“用户确认成功案例”标签。

- [ ] 各加一个测试：重复同 source digest 只算一个证据；用户消息重读不再调用模型；另一插件事件忽略；模型结果不是独立用户证据；学习保存失败原任务仍存在；任务删除期间抽取完成被丢弃；来源撤回期间抽取不生效；暂停中止落库；重启接续 job；两个 worker 的 lease 竞争。

- [ ] 自动测试通过，提交 `feat: 增加可恢复的异步自动学习`。

## Task M3: 自动提升、显式范围和人工固定

- [ ] `memory-promotion.test.mjs` 写以下独立断言，运行应先因未实现策略失败：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideScope } from '../../dsh-plugin/forward-step-dsh/memory/policy.js';
test('人工固定不被自动提升覆盖', () => {
  const current = {scope:'task',manualScope:true};
  const evidence = {requestedScope:null,explicitUserScope:false,taskIds:['a','b'],projectSpecific:false,conflict:false,domains:[]};
  assert.equal(decideScope(current,evidence), 'task');
});
test('一次明确全局要求立即生效', () => {
  const evidence = {requestedScope:'global',explicitUserScope:true,taskIds:['a'],projectSpecific:false,conflict:false,domains:[]};
  assert.equal(decideScope(null,evidence), 'global');
});
```

- [ ] 实现 `decideScope(current,evidence)`，不把模型提议 scope 当作用户显式指定：

```javascript
export function decideScope(current, evidence) {
  const allowed = ['global','domain','project','task','conversation'];
  if (evidence.explicitUserScope && allowed.includes(evidence.requestedScope)) return evidence.requestedScope;
  if (current?.manualScope) return current.scope;
  if (evidence.conflict || evidence.projectSpecific) return current?.scope || 'task';
  if (new Set(evidence.taskIds).size >= 2) return evidence.domains.length ? 'domain' : 'global';
  return current?.scope || 'task';
}
```

explicitUserScope 来自可定位用户原话或侧栏操作，不来自被引用文档；人工明确新范围可解除/改变原固定，自动学习没有此权力。新建人工编辑项同样有 SourceRef 指向该操作。

- [ ] 给 service 的 candidate validator 增加 requestedScope 与 source 原话相符检查。两个任务的证据必须独立 userAuthored/sourceId，单条消息复制到两个任务不算两个独立证据；项目专属事实不推广全局。范围变化追加 Change 前后和 sourceRefs；旧同源内容重读不创建新 Change。

- [ ] 同 key 已有历史偏好时，用户明确“以后改成”产生有来源的替换；本次要求只保存 task/conversation override，不默改全局。未解决冲突保持 candidate 并展示两方来源。

- [ ] 新增测试：显式 project/task/conversation/domain 五种范围；同 source 复制跨任务不提升；两个独立任务可提升；projectSpecific 阻断；人工 scope 后重复证据不扩大；人工值纠正不被模型再次覆盖；提升事件可由 M4 撤销。

- [ ] 运行 `node --test tests/dsh-plugin/memory-policy.test.mjs tests/dsh-plugin/memory-promotion.test.mjs tests/dsh-plugin/learning.test.mjs` 全绿，提交 `feat: 支持有证据的记忆提升和人工固定`。

## Task M4: 字段级撤销、停用、删除与防复活

- [ ] `memory-history.test.mjs` 写最重要的失败案例：scope 从 task→global，之后 value 被用户独立纠正，再撤销范围提升；期望 scope=task 且新 value 保留。另一案例在 scope 又被改为 project 后撤销旧事件，返回 scope 冲突，不覆写 project。

- [ ] `memory/history.js` 导出 `planUndo(memory,change)`，返回 `{patch,conflicts}`；用深比较检查字段仍等于当时 after，而非只按整条 memory revision 决定可否撤销：

```javascript
import { isDeepStrictEqual } from 'node:util';
export function planUndo(memory, change) {
  const patch = {}, conflicts = [];
  for (const field of change.changedFields) {
    if (isDeepStrictEqual(memory[field], change.after?.[field])) {
      patch[field] = structuredClone(change.before?.[field]);
    } else {
      conflicts.push({field,current:memory[field],before:change.before?.[field],after:change.after?.[field]});
    }
  }
  return {patch, conflicts};
}
```

- [ ] 实现 `undoChange(store,{memoryId,eventId,memoryRevision,resolve},tx)`：先校验 memoryRevision；无冲突原子补偿并追加新事件；有冲突先只返回预览、不部分悄悄保存，用户可选择保留现值或恢复指定旧字段，提交时重新校验 revision。ids/revision/createdAt 不列入 changedFields。重复撤销返回原结果，不反复改变。

- [ ] 撤销初次创建不是写入一条空 active memory，而是停用该项并保留抑制。`setMemoryStatus` 支持 active/disabled，手工启用需显式操作。撤销不改历史 prompt/external-result/sentMessages；这些属于生成历史，不继续进入未来上下文。

- [ ] 抑制保存 `{suppressionId,memoryId,keyDigest,valueDigest,sourceDigests,reason,createdAt}`，不存正文。自动抽取先查抑制：同源/同内容不恢复；新证据只产生可见 candidate，不直接 active；只有用户明确恢复/纠正可解除对应抑制。

- [ ] 实现 `deleteMemory(store,{memoryId,memoryRevision,confirmed},tx)`：预览确认 → 删除正文 → 清理变化历史 before/after 中该项正文及证据摘要副本 → 清理 sourceRefs 专用摘录/内存缓存 → 删除画像投影（M5 无独立正文）→ 保留无正文抑制标识。若 source 同时被其他合法记忆使用，保留那些引用及其合法摘录，但不保留被删项专用正文。

- [ ] SQLite 使用 `PRAGMA secure_delete=ON`；journal_mode=DELETE 沿 A1。含被删记忆正文的请求审计快照一并移除，保留请求标识/摘要哈希和 `auditRedacted:true`，侧栏显示已因删除清理，不能继续展示旧正文。用户保存的文章、外部结果等任务成果不按关键词擅自改写，但它们不再作为恢复该记忆的隐式证据。清理边界在确认页说明：插件记忆正文、记忆历史副本和缓存，不包括 DSH 原始对话、原始资料和用户外部备份；不承诺存储介质层不可恢复。

- [ ] 实现 `invalidateSource(store,{sourceId,confirmed},tx)`，将 source.active=false；失去全部有效证据的记忆停用，剩余证据重新评估 scope；不保留已失效的自动全局提升资格。收窄 scope 也重新跑派生选择。

- [ ] 扩展 A2 的 deleteTask：预览“同时清理学习记录和证据”；clearLearned=true 清理仅属本任务的记忆/证据，有其他来源的记忆移除此来源并重新评估；false 保留有标识的来源摘录但 locator 标为任务已移除。两种选择均不假装删除 DSH 对话或原文件。学习 job 同事务取消，迟到任务不重建记忆。

- [ ] 每条独立测试并修复：创建撤销；范围撤销保留新 value；冲突不部分写；重复撤销；同源不复活；新依据 candidate；删除搜索不到正文的记忆/changes/cache；来源撤回同步画像；任务删除两种分支；多窗口撤销冲突；学习正在运行时删除不能复活。

- [ ] 运行 `node --test tests/dsh-plugin/memory-history.test.mjs tests/dsh-plugin/learning.test.mjs tests/dsh-plugin/tasks.test.mjs`，全绿提交 `feat: 实现记忆撤销删除与同源抑制`。

## Task M5: 可回溯、可编辑的派生画像

- [ ] `profile-view.test.mjs` 先构造 active/candidate/disabled 三项及失效来源，断言 `buildProfile(state,context)` 仅展示适用 active 项；返回项含组成 memoryId/revision/sourceRefs，不产生无来源自由文本。

- [ ] 新建 `memory/profile.js`，不把 profile 再写一份正文：

```javascript
import { selectMemories } from './policy.js';
export function buildProfile(state, context) {
  const {selected} = selectMemories(state, context, {limit:Number.MAX_SAFE_INTEGER});
  return selected.map(memory => ({
    key:memory.key, value:memory.value, scope:memory.scope, domains:[...memory.domains],
    memories:[{memoryId:memory.memoryId,revision:memory.revision}],
    sourceRefs:[...memory.sourceRefs]
  }));
}
```

- [ ] 画像编辑复用 `editMemory(store,{memoryId,memoryRevision,patch},tx)`，该函数在 history.js 中实现：白名单字段、来源操作事件、修订检查、抑制旧值、manualScope 固定与 Change 一并提交。画像删除走 deleteMemory；多个组成项先让用户选择实际记忆，不一次无提示删除所有来源。

- [ ] 新增测试：撤销后画像不残留；删除后下次查询为空；来源失效立即消失；编辑后下一次生成采用新版本；其他项目/profile 不可串入；新建任务不把旧任务特性误当用户身份。

- [ ] `node --test tests/dsh-plugin/profile-view.test.mjs tests/dsh-plugin/memory-history.test.mjs` 全绿，提交 `feat: 增加可回溯的用户画像视图`。

## Task M6: 学习动态、范围控制与实际使用面板

- [ ] `memory-view.test.mjs` 先测试 `toMemoryView(state,context,{crossTask:false})`（client/memory.js 纯导出）：当前任务默认过滤；crossTask 显式开启后列跨任务摘要；source inactive 显示失效而不是伪链接；usedMemories 精确到版本；before/after 和候选/生效状态不混淆。

- [ ] 实现此纯映射函数，不在客户端重新决定 scope 生效；模型内部推理不作为学习说明。数据来源是服务返回的 Change/SourceRef/Memory 与生成版本 usedMemories，只展示简短 reason 和可核验摘录。

```javascript
// 纯视图字段在服务端先按当前用户/profile和请求范围校验后返回。
const scopeOptions = [
  {value:'global',label:'全局'}, {value:'domain',label:'领域'},
  {value:'project',label:'项目'}, {value:'task',label:'任务'},
  {value:'conversation',label:'当前对话'}
];
```

- [ ] 侧栏三个视图：任务、学习动态、用户画像。学习视图逐项显示内容、来源类型/项目/任务/对话或资料定位、简短依据、前后差异、范围/领域、状态、时间；当前结果可展开“本次采用”及未采用原因。跨任务模式显式开启，不默认发送所有原文到模型。

- [ ] 范围用菜单，领域单独多选；更改带 expected memoryRevision，成功才刷新状态。编辑、停用、撤销、删除用符合宿主的图标与 tooltip；删除带影响确认；冲突展示双方字段值供选择，不吞掉本地修改。

- [ ] 自动学习暂停用开关，显示 queued/running/failed/paused 和重试；任务已保存/学习失败分开显示。用户没有逐条预批准按钮作为唯一生效途径；candidate 冲突项才需要用户纠正或明确采纳。

- [ ] reducer 加入 memory.updated/memory.conflict/learning.failed；逐条测试本地草稿与错误状态，切换 task 时学习视图刷新，不把旧任务正文短暂显示到新任务。

- [ ] 真实 DSH 测试 320/480/800px 侧栏、长中文记忆、长来源路径、空/加载/失败/冲突状态；检查可滚动、键盘聚焦、文字不遮挡、范围菜单可操作。保存至少三张运行期截图到验收目录，不制作设计演示页。

- [ ] `node --test tests/dsh-plugin/memory-view.test.mjs tests/dsh-plugin/client-state.test.mjs` 全绿，提交 `feat: 在侧栏可视化学习来源和可撤销控制`。

## Task M7: Skill 与真实服务保持同一规则

- [ ] 在 `tests/forward-step-dsh.test.js` 增加实际 provider 正文断言：包含自动学习、五范围、可撤销、先保存后学习及首版外部执行；不能仍要求“每条记忆用户确认后才沉淀”。成功案例标签仍要求真实反馈。

- [ ] 修改实际注册的插件 Skill，对应段落正文使用：

```text
任务结果先保存，再异步学习本任务本轮新增或变更内容。
明确且低争议的偏好可自动生效，不逐条事前审批；证据不足或冲突项保持候选。
全局、领域、项目、任务和当前对话范围由服务校验，用户在侧栏的人工选择优先。
所有学习展示来源、差异、状态和撤销；暂停不停止任务保存。
首版只输出规划和外部执行提示词，外部结果由用户带回，不声称已自动制作文章或PPT。
“用户确认成功案例”必须有用户真实反馈，不能由模型自行确认。
```

- [ ] 先用 `rg --files .dsh dsh-plugin` 确认保留入口。若项目级 Skill 仍可加载，同步自动学习段并用测试比较行为要求；若不再注册，在加载配置移除重复注册并写入 RUNBOOK，不留互相矛盾的双入口。

- [ ] 运行 `node --test tests/forward-step-dsh.test.js tests/dsh-plugin/*.test.mjs`，全部通过；真实侧栏学习一次明确偏好，立刻看见、撤销、重新生成确认不采用。

- [ ] 提交 `fix: 统一插件Skill与自动学习规则`，只纳入实际修改的入口和测试。

## 阶段检查点

- [ ] 五范围、领域交叉、当前要求、显式全局、人工固定、撤销冲突、来源失效、删除、暂停、学习失败和重启均有直接测试。
- [ ] 数据库中有任务成果不等于学习已成功；面板状态与事务结果一致。
- [ ] 新任务实际上下文不含被撤销/停用/删除的记忆版本；历史生成记录仍明确显示当时采用旧版。
- [ ] 本阶段完成后进入故障和真实效果验收，尚不能宣称首版 B 已交付。

## 本轮进度补充（2026-11-03）

- 已有 `memory/policy.js` 与 8 个策略测试覆盖范围、领域、来源、候选/停用/抑制、具体范围优先、同层冲突、当前 overrides、三条预算及排除原因；策略只向排除清单返回 ID/原因，不泄漏正文。
- `core/context.js`/`core/agent.js` 已接上当前任务运行路径；当存在对话标识时从 store 状态调用策略，提示词只含筛选结果，版本记录 `usedMemories` 和排除原因。打包测试确认 `memory/policy.js` 进入插件 tarball。
- 构建与完整插件/预备请求测试 77/77 通过（2026-11-03）。
- **M1 仍未整体完成**：当前 overrides 尚无完整的自然语言 key 归一化和持久化 UI；策略没有独立画像/侧栏呈现。M2 自动学习、M3 证据提升、M4 撤销删除、M5 派生画像、M6 记忆面板、M7 文档规则均未完成。未在 DSH 最新运行时验证。
