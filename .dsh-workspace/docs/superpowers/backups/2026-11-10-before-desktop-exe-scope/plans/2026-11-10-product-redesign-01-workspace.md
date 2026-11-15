# 阶段 A：导航与工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付七板块入口、简洁首页和保留状态的 A/C 工作台，不改变现有业务存储。

**Architecture:** 继续由现有 Panel 拥有任务状态。保留访问过的页面实例，避免导航卸载取消任务或清空输入；设置控制器始终挂载以保证模型初始化。

**Tech Stack:** 现有 React.createElement、TypeScript、Node test、DSH 宿主样式变量。

---

工作目录：`D:/VScode/项目/提示词工具/.dsh-workspace`。全部任务只改副本。依赖：第四版设计文档和总计划。此阶段无需新增包。

### Task 1：建立变更前基线与真实宿主入口

**Files:**
- Read: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/README.md`
- Read: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/package.json`
- Create: `D:/VScode/项目/提示词工具/.dsh-workspace/docs/superpowers/acceptance/2026-11-10-redesign-baseline.txt`

- [ ] **Step 1：记录工具链、工作区状态与相关测试实际结果。**

```powershell
Set-Location -LiteralPath 'D:/VScode/项目/提示词工具/.dsh-workspace'
New-Item -ItemType Directory -Force -Path 'docs/superpowers/acceptance' | Out-Null
$baselinePath = Join-Path (Get-Location) 'docs/superpowers/acceptance/2026-11-10-redesign-baseline.txt'
node --version | Set-Content -LiteralPath $baselinePath
pnpm --version | Add-Content -LiteralPath $baselinePath
git status --short | Add-Content -LiteralPath $baselinePath
node --test tests/dsh-plugin/client-state.test.mjs tests/dsh-plugin/drafts.test.mjs tests/dsh-plugin/tasks.test.mjs tests/dsh-plugin/package.test.mjs 2>&1 | Tee-Object -FilePath $baselinePath -Append
if ($LASTEXITCODE -ne 0) { throw '相关基线失败；先定位影响本阶段的原因。' }
```

- [ ] **Step 2：在 forward-step-test 的真实宿主中记录当前面板截图、可用宽度、当前会话/项目来源。** 按既有隔离验收方式打开；检查插件是否只注册一个主面板。自动获得上下文前保留“补充项目/对话”入口，不用假 ID。
- [ ] **Step 3：确认基线没有被误当作全套验收。** 文件仅记录实际执行结果；无需为报告新增应用代码。
- [ ] **Step 4：只提交本次基线记录。**

```powershell
git add -- docs/superpowers/acceptance/2026-11-10-redesign-baseline.txt
git diff --cached --stat
git commit -m "docs: 记录界面重设计实施基线"
```

### Task 2：七导航与稳定页面生命周期

**Files:**
- Create: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/workspace-shell.ts`
- Modify: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts:1217`，锚点导航及面板归属
- Modify/Test: `D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/client.test.mjs`，复用 loadClient/makeContext/findNode

- [ ] **Step 1：先在现有 client.test.mjs 中追加真实注册树测试。**

```javascript
test('七导航默认工作台，设置控制器保持挂载', async () => {
  const client = await loadClient();
  const context = makeContext({});
  await client.module.apply(context.ctx);
  context.injectedSlots.forEach(item => item.factory());
  const element = context.registrations[0].component();
  let tree = client.render(element.type, element.props);
  const library = findNode(tree, n => n.props['data-page'] === 'library');
  assert.ok(library);
  library.props.onClick();
  tree = client.render(element.type, element.props);
  assert.ok(findNode(tree, n => n.props['data-page'] === 'library'
    && n.props['aria-current'] === 'page'));
  assert.ok(findNode(tree, n => n.type.name === 'SettingsPanel'));
});
```

- [ ] **Step 2：构建旧代码并运行该测试，确认失败点是缺少七导航。**

```powershell
pnpm --dir 'D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh' run build:client
node --test --test-name-pattern='七导航默认工作台' tests/dsh-plugin/client.test.mjs
```

预期：导航断言 FAIL；构建必须先成功，不能将依赖错误当作红灯。

- [ ] **Step 3：创建轻量保活容器；不添加路由依赖。**

```typescript
import * as React from 'react';

export function RoutePage({ id, active, eager = false, children }: {
  id: string; active: boolean; eager?: boolean; children?: React.ReactNode;
}) {
  const visited = React.useRef(eager || active);
  if (active) visited.current = true;
  return visited.current
    ? React.createElement('section', {
        id, hidden: !active, 'data-route-page': id,
        'aria-label': id
      }, children)
    : null;
}
```

在 Panel 的 hooks 顶部增加下面状态，在旧导航位置使用下面完整表达式：

```typescript
const [activePage, setActivePage] = useState('workbench');
const pages = [
  ['workbench', '工作台'], ['library', '资料库'], ['prompts', '提示词收藏'],
  ['writing', '写作'], ['research', '研究'], ['memory', '记忆与偏好'],
  ['settings', '设置']
];

h('nav', { 'aria-label': '工作区导航' },
  ...pages.map(([id, label]) => h('button', {
    key: id, type: 'button', 'data-page': id,
    'aria-current': activePage === id ? 'page' : undefined,
    onClick: () => setActivePage(id)
  }, label)));
```

- [ ] **Step 4：逐个移动既有 h(Panel) 调用到对应 RoutePage，保留原 props 和 key。** 对应表：Knowledge＋ExternalReferences→library；Assets→prompts；WritingWorkspace＋WritingPacks→writing；DomainWorkbenches→research；Memory→memory；Settings＋Backup＋Migration→settings。工作台原业务 div 保留，只新增 hidden。RoutePage props 使用以下完整对象，依每行 id 替换字面值：

```typescript
{ id: 'library', active: activePage === 'library' }
{ id: 'prompts', active: activePage === 'prompts' }
{ id: 'writing', active: activePage === 'writing' }
{ id: 'research', active: activePage === 'research' }
{ id: 'memory', active: activePage === 'memory' }
{ id: 'settings', active: activePage === 'settings', eager: true }
```

SettingsPanel 的 onSaved 原回调不改；MemoryPanel 无 selectedTask 时显示选任务说明。给原 main 增加 className='forward-step-workspace'；将原 main 全局样式收窄到该类，并加入以下规则，避免 hidden 被既有 inline display 覆盖：

```css
.forward-step-workspace [hidden] { display: none !important; }
.forward-step-workspace { height:100%; min-width:0; overflow:auto; }
.forward-step-workspace button:focus-visible {
  outline:2px solid currentColor; outline-offset:3px;
}
```

- [ ] **Step 5：重新构建，跑 client.test.mjs；更新旧测试“所有文本常驻”断言为导航可达，保留原任务/保存/模型断言。** 真实宿主验证输入资料草稿→切导航→返回仍保留；未打开设置也能读取已配置模型。
- [ ] **Step 6：检查只暂存上述文件后提交。** 命令：`git commit -m "feat: 拆分七个导航页面并保留面板状态"`。

### Task 3：干净首页和情境对话框

**Files:**
- Modify: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts:1254`，创建任务区域
- Modify: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/workspace-shell.ts`
- Create: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/client/workspace-view.js`，先放询问触发函数，任务4追加查看状态
- Create/Test: `D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/test_workspace_view.mjs`
- Test: `D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/client.test.mjs`

- [ ] **Step 1：追加完整入口约束测试。** 每项是独立可观察行为：

```javascript
test('首页入口只保留想法与开始，选项默认收起', async () => {
  const client = await loadClient();
  const context = makeContext({});
  await client.module.apply(context.ctx);
  context.injectedSlots.forEach(item => item.factory());
  const element = context.registrations[0].component();
  const tree = client.render(element.type, element.props);
  assert.ok(findNode(tree, n => n.props['aria-label'] === '新任务想法'));
  assert.equal(findNode(tree, n => n.props['data-task-options'] === true).props.open, false);
  const start = findNode(tree, n => n.props['data-start-task'] === true);
  assert.equal(start.props.disabled, true);
});
```

- [ ] **Step 2：构建并运行入口测试，预期上述新入口缺失。**
- [ ] **Step 3：将原“新任务内容”textarea 换成以下入口，直接复用 input、setInput、createTask、busy、cwd、conversationId。** 项目、会话、领域、模型配置原控件移动到默认关闭的 details；仅缺上下文或用户点击时展开。

```typescript
h('form', {
  onSubmit: (event: React.FormEvent) => {
    event.preventDefault();
    if (!busy && cwd.trim() && conversationId.trim() && input.trim()) void createTask();
  }
},
  h('textarea', {
    'aria-label': '新任务想法', value: input, rows: 4,
    placeholder: '说说你想完成什么…',
    onChange: (event: any) => setInput(event.target.value)
  }),
  h('button', {
    type: 'submit', 'data-start-task': true,
    disabled: busy || !cwd.trim() || !conversationId.trim() || !input.trim()
  }, '开始')
);
```

增加 `const [optionsOpen, setOptionsOpen] = useState(false)`。原配置容器元素类型改为 details，并加 summary“任务与模型选项”，props 使用下面表达式，用户填写时不因重绘收起：

```typescript
{
  'data-task-options': true,
  open: optionsOpen,
  onToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) =>
    setOptionsOpen(event.currentTarget.open)
}
```

缺少项目/会话时，开始按钮保留禁用原因和“补充任务信息”按钮，其 onClick 为 `() => setOptionsOpen(true)`；不能让用户面对禁用按钮却找不到所缺字段。

- [ ] **Step 3a：补首页添加资料及历史操作，均列为本任务必做。** 首页在输入框旁保留“添加资料”一个入口，类型选择在弹层里出现；文件/粘贴/网页待处理项先放首页草稿。阶段A复用现有上传/解析；阶段B完成后切到统一原件入口。没有任务ID时不启动依赖task owner的上传；开始任务成功后按新taskId处理队列，创建失败保留文件选择与想法。文件对象只在内存保留；刷新后提示重新选择文件，不能显示已上传。任务更多菜单接原rename/updateTask、archiveTask；历史列表支持搜索、查看归档、恢复，并继续原taskId。归档不清任务草稿，删除使用现有影响预览。

- [ ] **Step 3b：同步重排任务进行中页面。** 不仅隐藏其他导航面板：当前任务内部也将阶段控件、PPT导入/导出/规划、外部结果回填、复盘、模型配置分为按需入口。复用stage的clarification/diagnosis/planning/step-prompt/review及原动作，当前阶段只显示一个主动作和取消；任务目标、已确认要求、短资料卡与输入框常驻。PPT入口仅在对应任务/资料存在时出现，保留旧功能。最近任务、重命名、归档通过任务菜单，已有结果通过轮次卡展开。验收截图必须包含任务运行中和PPT任务，不能仅凭干净空首页判通过。

- [ ] **Step 4：新增通用但局部使用的原生 dialog 展示组件。** 只为当前未解决的问题传 children，不渲染完整设置表；以下代码追加 workspace-shell.ts：

```typescript
export function QuestionDialog({ open, onClose, children }: {
  open: boolean; onClose: () => void; children?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return React.createElement('dialog', {
    ref, 'aria-label': '确认当前问题',
    onCancel: (event: React.SyntheticEvent) => {
      event.preventDefault(); onClose();
    }
  }, children);
}
```

onClose 只改变显示状态，问题回答草稿放在父级。关键问题需有效选择后继续；非关键问题提供“稍后决定”，不强迫选默认项。任务已知受众时不得固定重问一次。
- [ ] **Step 4a：补询问触发条件，不只造一个dialog壳。** 在本文件所用的 `client/workspace-view.js`（任务4负责创建，执行此步时可提前创建）中加入下面纯函数，并在 `tests/dsh-plugin/test_workspace_view.mjs` 新建或追加用例。保存/生成失败属于反馈，不自动混入问题队列；候选问题由当前操作明确产生，返回草稿或重试不清已回答项。

```javascript
export function nextQuestion(questions, answers, deferredIds = []) {
  return questions.find(question =>
    !Object.hasOwn(answers, question.id) &&
    !(question.optional && deferredIds.includes(question.id))) ?? null;
}
```

工作台候选字段为 `{id:string, optional:boolean, reason:string}`，回答保存在任务草稿的questionAnswers，按操作ID分组。关闭弹窗只暂停操作；继续按钮仅在必需问题解决后可用。dialog打开时记录触发按钮，关闭后恢复焦点；离开所属导航时关闭顶层dialog但保留草稿，防止隐藏面板的模态框挡住其他页面。下面测试先运行确认缺失导出，再写上面函数并重跑：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextQuestion } from '../../dsh-plugin/forward-step-dsh/client/workspace-view.js';
test('已回答不重复追问，必需项不能被暂缓绕过', () => {
  const questions = [{id:'audience',optional:false},{id:'evidence',optional:false},{id:'style',optional:true}];
  assert.equal(nextQuestion(questions, {audience:'读者'}, ['evidence','style']).id, 'evidence');
  assert.equal(nextQuestion(questions, {audience:'读者',evidence:'已附图'}, ['style']), null);
});
```
- [ ] **Step 5：构建→client.test.mjs；浏览器键盘检查 Tab、Escape、关闭后焦点回原按钮，输入保留。**
- [ ] **Step 6：提交 `feat: 简化任务首页并按需询问选项`，仅暂存本任务文件。**

### Task 4：任务隔离的 A/C 查看状态

**Files:**
- Modify: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/client/workspace-view.js`，任务3已创建
- Modify: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts`
- Test/Create: `D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/test_workspace_view.mjs`
- Reuse: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/client/drafts.js`

- [ ] **Step 1：追加确定性测试，不测试静态 HTML 字符串。** 合并任务3已有的test/assert及模块import，保留nextQuestion测试；以下块包含本任务所需完整依赖，不重复声明同名import。

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { changeView } from '../../dsh-plugin/forward-step-dsh/client/workspace-view.js';
import { readTaskDraft, writeTaskDraft } from '../../dsh-plugin/forward-step-dsh/client/drafts.js';

test('专注切换保留页码与缩放，两个任务独立', () => {
  const records = new Map();
  const storage = {
    getItem: k => records.get(k) ?? null,
    setItem: (k, v) => records.set(k, v),
    removeItem: k => records.delete(k)
  };
  const view = { mode:'split', sourceId:'s1', pageIndex:2, zoom:2, scrollTop:170 };
  writeTaskDraft(storage, 'p', 'a', { view: changeView(view, 'focus-preview') });
  writeTaskDraft(storage, 'p', 'b', { view: { ...view, pageIndex:0 } });
  assert.equal(readTaskDraft(storage, 'p', 'a').view.pageIndex, 2);
  assert.equal(readTaskDraft(storage, 'p', 'a').view.zoom, 2);
  assert.equal(readTaskDraft(storage, 'p', 'b').view.pageIndex, 0);
});
test('未知模式明确拒绝', () => {
  assert.throws(() => changeView({}, 'other'), TypeError);
});
```

- [ ] **Step 2：运行 `node --test tests/dsh-plugin/test_workspace_view.mjs`；预期新模块缺失。**
- [ ] **Step 3：追加完整状态函数，保留任务3的nextQuestion。**

```javascript
export function changeView(current, mode) {
  if (!['conversation', 'split', 'focus-preview', 'focus-conversation'].includes(mode)) {
    throw new TypeError('查看模式无效');
  }
  return { ...current, mode };
}
```

- [ ] **Step 4：Panel 读取当前 task draft 的 view；通过现有 persistTaskDraft 保存 view；导航不能改 sourceId 或 pageIndex。** 具体写入表达式：

```typescript
persistTaskDraft(selectedTask.taskId, {
  view: changeView(readTaskDraft(window.localStorage, selectedTask.projectId, selectedTask.taskId)?.view ?? {
    mode: 'conversation', sourceId: '', pageIndex: 0, zoom: 1, scrollTop: 0
  }, 'focus-preview')
});
```

将 persistTaskDraft 参数类型增加 `view?: {mode:string;sourceId:string;pageIndex:number;zoom:number;scrollTop:number}`，与上述测试保持一致。上述readTaskDraft仅用于首次载入；模式切换调用changeView时必须传当前内存view，不能每次从localStorage重读，否则存储失败后会覆盖刚才的页码。使用独立React state触发渲染；写本地失败显示“未保存”，内存值保留。切到别的任务时按projectId/taskId读取，不共用一个全局草稿。原文档字节与批注证据不写入view。

- [ ] **Step 4a：扩大草稿实际覆盖范围。** 在index.ts的persistTaskDraft patch类型及恢复逻辑中，明确增加conversationInput、promptEditor、annotationDrafts、questionAnswers、deferredQuestionIds；已有externalResult/title仍用原字段。结构化的批注草稿按annotationId保存，意见正文和选择在此保留，二进制不进localStorage。切任务前保存发起任务的草稿，异步回调捕获projectId/taskId，禁止用回调执行时的当前任务ID。任务3的新任务草稿单独用项目级new-task键，不制造任务ID。仅退出并重进导航的保活不等于刷新持久化；两种场景分别验证。

- [ ] **Step 4b：补存储故障验收。** 让storage.setItem抛错→内存中翻到第3页并改提示词→切C再回A，仍为第3页且正文不变；恢复存储后重试写入同一份内存稿。任务甲和乙各改草稿，刷新后分别恢复；本地记录损坏时保留原记录并显示恢复失败，不自动覆盖为默认值。
- [ ] **Step 5：运行新测试和 drafts.test.mjs；构建后跑 client.test.mjs。**
- [ ] **Step 6：提交 `feat: 保存任务独立的查看状态与专注模式`。**

### Task 5：响应式双栏、局部样式和 A 阶段验收

**Files:**
- Modify: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/workspace-shell.ts`
- Modify: `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts`
- Create: `D:/VScode/项目/提示词工具/.dsh-workspace/docs/superpowers/acceptance/2026-11-10-redesign-workspace.md`

- [ ] **Step 1：记录现有真实宿主在 1440/960/390px 下首页、任务和输入状态；用同一任务作为对照。**
- [ ] **Step 2：为对话和查看器容器分别加 className='fs-conversation' 与 'fs-viewer'，共同父节点加 fs-stage 和 data-mode。** 样式只放局部作用域：

```css
.forward-step-workspace .fs-stage { display:grid; min-width:0; min-height:0; }
.forward-step-workspace .fs-stage[data-mode="split"] {
  grid-template-columns:minmax(280px, 1fr) minmax(320px, 1.25fr);
}
.forward-step-workspace .fs-conversation,
.forward-step-workspace .fs-viewer { min-width:0; overflow:auto; }
.forward-step-workspace .fs-stage[data-mode="focus-preview"] .fs-conversation { display:none; }
.forward-step-workspace .fs-stage[data-mode="focus-conversation"] .fs-viewer,
.forward-step-workspace .fs-stage[data-mode="conversation"] .fs-viewer { display:none; }
@media (max-width:760px) {
  .forward-step-workspace .fs-stage[data-mode="split"] { grid-template-columns:1fr; }
}
```

窄屏 split 映射成当前激活区域，提供“对话/资料”切换；不是纵向堆两块长内容。未打开资料时只 conversation。拖宽度、旋转等最终状态由任务 8 的真实查看器验证。

- [ ] **Step 2a：补实际窄屏规则和可访问分隔条。** fs-stage增加data-narrow-pane，view保存narrowPane:'conversation'|'preview'和splitRatio，模式还原不重置它们；CSS通过容器宽度而非整个浏览器宽度判定。只在工作区宽度大于760px时双栏；给宿主工作区加container-type:inline-size，并将上面的media规则替换为下面的局部容器规则：

```css
@container (max-width:760px) {
  .fs-stage[data-mode="split"] { grid-template-columns:1fr; }
  .fs-stage[data-mode="split"][data-narrow-pane="conversation"] .fs-viewer,
  .fs-stage[data-mode="split"][data-narrow-pane="preview"] .fs-conversation { display:none; }
}
```

分隔条使用role=separator、tabIndex=0、aria-orientation=vertical和当前比例；pointer拖动及左右方向键均可调整，左右内容保持最小可读宽度，窄屏隐藏分隔条。组件隐藏后恢复可见时重新量取真实宽高再渲染PDF/SVG，避免hidden下测出0尺寸。
- [ ] **Step 3：执行浏览器行为检查。** 输入草稿、翻页、改变缩放→专注预览→双栏→专注对话→资料库→返回；逐项对照状态。未知资料能力不显示假预览。
- [ ] **Step 4：重跑 Task 4 和 client.test.mjs，查看 console、键盘焦点与窄屏滚动。** 预期无运行错误、无整页横向溢出，所有功能入口可达；记录截图及未通过项。
- [ ] **Step 5：提交 `style: 完成工作台双栏与专注布局`。** 阶段 A 完成标准是已有任务仍能保存/运行并拥有新导航；资料批注完整能力在阶段 B 验收。

