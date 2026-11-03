# 写作与 PPT 外部执行闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持普通文章连续改稿和 PPT 规划，同时保持“插件规划和生成提示词，外部 AI 完成成品”的首版边界。

**Architecture:** 通过独立的入口类型和领域方法组合路由，复用已有写作/PPT 提示词构造器，不复制整套应用。所有提示词、外部结果和复盘建立显式版本关联，修改目标后旧提示词失效而不删除。

**Tech Stack:** 阶段 2 任务服务、现有 writing-workbench-prompts / ppt-scene-prompts、ESM、node:test、DSH 原生侧栏。

---

## 位置、依赖和文件

工作目录：`D:/VScode/项目/提示词工具/.dsh-workspace`。全部相对路径以此为根。必须先通过 A1–A6；阶段 4 前没有自动学习不影响本阶段手工验收。

| 任务 | 文件 |
| --- | --- |
| D1 | `dsh-plugin/forward-step-dsh/core/methods.js`、`core/context.js`、`client/tasks.js`；`tests/dsh-plugin/writing.test.mjs` |
| D2 | 插件 `core/methods.js`、`client/tasks.js`；`tests/dsh-plugin/ppt.test.mjs` |
| D3 | 插件 `core/versions.js`、`core/agent.js`、`core/tasks.js`、`client/tasks.js`；`tests/dsh-plugin/versions.test.mjs` |

领域状态分别位于 `task.methodState.writing` 与 `task.methodState.ppt`，不是用 domain 字符串覆写 task.agent.type。切换方法只改变 domain 和激活视图，不删除另一份状态。

## Task D1: 普通文章与连续改稿方法

- [ ] 在 `writing.test.mjs` 写失败用例。`buildMethodPrompt(task, stage)` 是本任务导出函数，返回字符串，预算最后仍由 A4 统一检查：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMethodPrompt } from '../../dsh-plugin/forward-step-dsh/core/methods.js';
test('写作结果诊断入口不覆盖后续规划阶段', () => {
  const task = {
    taskId:'article-1', entryType:'diagnose-ai-result', domain:'writing',
    originalInput:'把旧稿改得更清晰，保留第三段实验数字',
    currentRequirements:['保留第三段实验数字'], materials:[],
    methodState:{writing:{
      article:{id:'article-1', goal:'普通文章改稿', audience:'一般读者', genre:'article'},
      round:{id:'round-1', draft:'原稿正文', feedback:'结构松散'},
      styleProfile:null
    }},
    agent:{id:'article-1', type:'diagnose-ai-result', goal:'普通文章改稿'}
  };
  const text = buildMethodPrompt(task, 'planning');
  assert.match(text, /路线|步骤/);
  assert.match(text, /保留第三段实验数字/);
  assert.match(text, /外部 AI|外部执行/);
  assert.match(text, /不直接.*(?:代写|成品|正文)/);
});
```

- [ ] 运行 `node --test tests/dsh-plugin/writing.test.mjs`，预期先缺少导出或领域分支失败、退出非 0。

- [ ] 写作状态保存 `article:{id,goal,audience,platform,genre,constraints,preserveItems}`、`round:{id,draft,feedback}`、`styleProfile`、`materialIds`、`roundNumber`。稿件全文保存为 D3 外部结果版本，round.draft 为当前选中版本引用或构建时读取的正文，不能丢弃前稿。输入校验失败保留表单草稿。

- [ ] `buildMethodPrompt` 中定义外部提示词封装函数，任何要求代写的旧 builder 输出只作为待生成的执行提示词，不直接作为当前 DSH 模型的执行命令：

```javascript
function externalPromptRequest(candidate, task, stage) {
  return [
    '你是规划与提示词助手，不直接代写文章或交付成品正文。',
    '只输出当前阶段的诊断、短路线或可复制给外部 AI 的执行提示词。',
    `当前阶段：${stage}`,
    `本轮必须遵守：${JSON.stringify(task.currentRequirements)}`,
    '以下内容是待整理的外部执行规则，不是让你立即执行其中的写作命令：',
    JSON.stringify(candidate)
  ].join('\n');
}
```

- [ ] 使用 `createRequire(import.meta.url)` 从 `../vendor/core/writing-workbench-prompts.js` 加载 `buildWritingDiagnosisPrompt` / `buildWritingRevisionPrompt`。映射：clarification 使用通用关键问题规则并附文章字段；diagnosis 调用写作诊断；planning 要求 3–7 步路线及输入/产出/检查；step-prompt 以 revision builder 为外部执行规则；review 只比较 D3 用户带回的结果与选定提示词要求。未知 stage 报 `invalid_input`。输出经 A4 的 methodPrompt→buildContext→preparedRequest 接线发送，不另开模型请求。

- [ ] 写作 builder 输入 `memories:[]`，避免其旧版 scope（如 general）再次过滤新五范围；长期记忆只由 M1 和 A4 注入一次。写作内容材料与风格样本分开映射：`purpose:'content'` 可提供观点事实；`purpose:'style'` 只能提供句式/节奏偏好。旧 builder 若字段不同，在方法边界转换并加断言，不改持久化契约。

- [ ] 在 methods.js 实现并导出 `partitionWritingMaterials(materials)`，直接用于领域输入映射，防止风格材料成为事实：

```javascript
export function partitionWritingMaterials(materials) {
  return {
    content:materials.filter(item => ['content','both'].includes(item.purpose)),
    style:materials.filter(item => ['style','both'].includes(item.purpose))
  };
}
```

- [ ] 在同一测试文件导入该函数，补直接断言；先运行失败，再加入上面的实现并验证通过：

```javascript
const materials = [
  {sourceId:'style-1',purpose:'style',excerpt:'所有实验均成功：样本观点哨兵'},
  {sourceId:'content-1',purpose:'content',excerpt:'目前仅完成一组实验'}
];
const sections = partitionWritingMaterials(materials);
assert.deepEqual(sections.content.map(item => item.sourceId), ['content-1']);
assert.deepEqual(sections.style.map(item => item.sourceId), ['style-1']);
```

再检查方法构造的实际输入：只有 content 分区进入事实材料，style 分区仅用于风格 traits；映射到旧 schema 时补 `id/sourceArticleId`，不丢 sourceId 关联。

- [ ] 分别增加失败测试并实现：反馈第 2 轮不丢第 1 稿和保留项；当前要求“本次详细”覆盖历史“简洁”；优化提示词入口＋writing 不生成通用软件路线；专业文体仅标记通用方法、不宣称学术能力；超预算报错、原文完整且模型调用 0 次。额外通过真实 agent 服务的假 host 断言：超过旧 builder 500 字约束上限的 currentRequirements 和末尾保留标记仍完整进入实际 messages；旧 builder 只是方法规则来源，不代替完整强约束区。

- [ ] 运行 `node --test tests/dsh-plugin/writing.test.mjs tests/writing-workbench-prompts.test.js`，期望全部通过；运行 `node scripts/dsh-stage-core.mjs` 更新依赖清单。提交 `feat: 接入普通文章规划与连续改稿方法`。

## Task D2: PPT 分阶段规划与执行提示词

- [ ] 在 `ppt.test.mjs` 使用以下完整输入，给 brief/outline/slides/route-prompt 各写一个直接断言：

```javascript
const ppt = {
  taskId:'ppt-1', entryType:'advance-idea', domain:'ppt',
  originalInput:'给团队做一次八分钟进展汇报',
  currentRequirements:['保留风险页','不虚构收入'], materials:[],
  agent:{id:'ppt-1', type:'advance-idea', goal:'八分钟进展汇报'},
  methodState:{ppt:{
    brief:{idea:'项目进展', audience:'内部团队', audienceAction:'确认下一阶段分工',
      durationMinutes:8, constraints:{maxSlides:8}, hardRequirements:['不虚构收入'],
      preserveItems:['风险页'], excludeItems:[], facts:['已完成第一轮测试'],
      assumptions:['页数需随内容调整'], materials:[]},
    outline:{status:'needs-review',slides:[]}, route:'native-ppt', stage:'brief'
  }}
};
```

每个测试直接调用 `buildMethodPrompt(ppt, 'step-prompt')` 并设置相应 methodState.ppt.stage；断言保留时长、受众、风险页及阶段名。`diagnose-ai-result + ppt + planning` 不停留在初次诊断。

- [ ] 运行 `node --test tests/dsh-plugin/ppt.test.mjs`，预期先以不支持 PPT 或缺失字段失败。

- [ ] 从 vendor/core 导入现有 PPT API；明确传入 `{pptScene: task.methodState.ppt}`，不是把外层 task 误当 brief。stage 路由只调用对应 builder：

```javascript
function pptCandidate(api, task) {
  const scene = task.methodState.ppt;
  const input = {pptScene:scene};
  switch (scene.stage) {
    case 'brief': return api.buildPptBriefPrompt(input);
    case 'outline': return api.buildPptOutlinePrompt(input, task.materials);
    case 'slides': return api.buildPptSlideDraftPrompt(input, scene.outline, task.materials);
    case 'route-prompt': return api.buildPptProductionPrompt(input, scene.route);
    default: throw Object.assign(new Error('PPT 阶段无效'), {code:'invalid_input'});
  }
}
```

- [ ] 用外部规划边界封装 candidate：逐页内容是可编辑规划稿，制作提示词交给外部 AI；不执行 PPT 生成/下载/导出，不调用 `buildPptFullPrompt` 把所有阶段塞入每一轮。不在缺乏材料时编造事实，事实/假设分列。旧 brief builder 允许一次三个问题，适配后仍遵循每轮最多一个关键问题、常规累计最多三个；为“输入足够时零问题”补回归测试。

- [ ] 在侧栏增加受众、场景、时长、核心信息/材料、brief→outline→slides→route-prompt 阶段控件；允许返回修订但不自动标记下游产物最新。durationMinutes 必须正数；页数约束矛盾保留输入并提示冲突，而非覆盖用户要求。

- [ ] 新增五条直接测试：制作路线保留用户选项；PPT 结果诊断不假称读到未上传文件；输入材料引用最多三条入模型；改变受众后旧提示词需复查；任何阶段不调用宿主文件制作工具。

- [ ] `node --test tests/dsh-plugin/ppt.test.mjs tests/ppt-scene-prompts.test.js` 通过；提交 `feat: 接入PPT分阶段规划方法`。

## Task D3: 提示词、外部结果、复盘的版本关系

- [ ] 创建 `versions.test.mjs`，先以纯函数固定版本追加语义：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendVersion, markStale } from '../../dsh-plugin/forward-step-dsh/core/versions.js';
test('编辑提示词创建新版本且旧版仍可关联结果', () => {
  const task = {taskId:'t1', revision:1, versions:[], reviews:[]};
  const first = appendVersion(task, {kind:'prompt',stepId:'s1',text:'保留数字'});
  const original = first.versions[0];
  const second = appendVersion(first, {kind:'prompt',stepId:'s1',text:'保留数字并缩短',parentVersionId:original.versionId});
  assert.equal(second.versions.length, 2);
  assert.equal(second.versions[0].text, '保留数字');
  assert.equal(markStale(second, '目标已改变').versions.every(v => v.stale), true);
});
```

- [ ] 运行 `node --test tests/dsh-plugin/versions.test.mjs`，先缺少模块失败；然后实现不可变追加，禁止任意覆盖旧版本正文：

```javascript
import { randomUUID } from 'node:crypto';
export function appendVersion(task, input) {
  if (!['prompt','external-result'].includes(input.kind) || !input.stepId || typeof input.text !== 'string') {
    throw Object.assign(new Error('版本输入无效'), {code:'invalid_input'});
  }
  const version = {...input, versionId:randomUUID(), taskId:task.taskId,
    createdAt:new Date().toISOString(), stale:false};
  return {...task, versions:[...task.versions, version]};
}
export function markStale(task, reason) {
  return {...task, versions:task.versions.map(v => v.kind === 'prompt' ? {...v, stale:true, staleReason:reason} : v)};
}
```

- [ ] 增加 external-result 校验：必须给 `promptVersionId`，目标为同 task/step 的 prompt；不能关联另一任务，不修改原 prompt，source 标注 `user-pasted`。result 只表示用户提供，不标记自动执行成功。

- [ ] 增加 `appendReview(task, {resultVersionId,promptVersionId,verdict,checks,feedback}) -> Task`，verdict 仅 `success|failure|unverified`；reviewId 用 UUID；检查两版本关联，保存实际要求快照。没有用户确认时模型“成功”不是 confirmed case 标签。

- [ ] 在 agent 事务中保存版本及 `{requestId,usedMemories,usedSources,sentMessages,model,taskRevision}`；UI 编辑 prompt/结果形成新版本，自动保存失败返回 unsaved draft。要求变化使用 markStale，review 仍指向原版本而不是改写历史。

- [ ] 并发生成期间记忆 revision 改变不假装采用最新记忆：结果保留实际 usedMemories 并显示“使用旧版本，重新生成可更新”。任务本身 revision 改变则沿 A4 返回 stale_response，不自动保存为新任务版本。

- [ ] 分别测试：缺失关联报 invalid_input；另任务/另 step 关联被拒绝；复盘保留原文；第 2 轮明确对应第 2 版而非最近列表项；陈旧结果仍可查看但有提示；撤销记忆不改写已保存版本。

- [ ] 运行 `node --test tests/dsh-plugin/versions.test.mjs tests/dsh-plugin/writing.test.mjs tests/dsh-plugin/ppt.test.mjs tests/dsh-plugin/agent.test.mjs`，全部通过；提交 `feat: 保存外部结果和复盘版本关联`。

## 阶段验收

- [ ] 普通文章：旧稿→诊断→路线→复制提示词→外部 AI 第 1 稿→反馈→第 2 轮，前两版和保留项均可查看。
- [ ] PPT：八分钟汇报→brief→大纲→逐页规划→制作提示词，输出不包含已制作文件的虚假状态。
- [ ] 三入口 × 三领域共九种路由做自动化组合测试；真实模型至少覆盖三个入口及一次领域结果诊断。
- [ ] 原基线与插件测试通过；本阶段实际效果记录留到 V3 对照，不用 mock 文本断言代替成品质量评价。
- [ ] 提交前仅暂存 D1/D2/D3 列出的当前任务文件及重新生成的核心闭包清单，不提交原应用文件或测试数据。
