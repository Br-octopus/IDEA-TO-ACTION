# 桌面工作台布局与对话选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的全窗口工作台、左右调宽、三态图标、主动打开预览及 Agent 对话内选择落实到仓库根目录 Windows Electron 桌面应用。

**Architecture:** 沿用 `prototype/index.html`、`prototype/app.js` 和现有查看器、批注、提示词及持久化逻辑。仅增加一个小型布局计算模块；布局更新直接操作容器，不销毁查看器。模型选项沿用现有对话消息结构，打通解析、展示、回答、后续上下文和备份。

**Tech Stack:** 现有 Electron、原生 HTML/CSS/JavaScript、Pointer Events、ResizeObserver、Node 内置测试、pnpm；不增加运行依赖。

---

## 依据、范围与当前状态

- 日期：2026-11-15。本计划共 7 项顶层任务、29 个步骤；当前实现与自动验证覆盖任务 1–6，任务 7 的桌面流程未完成，详见下方实际记录。
- 正式依据：`../specs/2026-11-10-annotated-workbench-design.md` 第 3.4–3.6、12.1 节，以及 `../specs/assets/2026-11-15-workbench-layout.html` 六态视觉稿。
- 配套依据：`../specs/2026-11-10-product-interface-redesign.md`、`../specs/2026-11-10-product-functional-flows-design.md`。
- 工作位置：`D:/VScode/项目/提示词工具`。沿用本项目 `.dsh-workspace/docs/superpowers/plans/` 文档目录，保留原项目目录，不为文档新建工作树。
- 本轮新增 **7 项实施任务**，只覆盖最新布局和对话交互增量。此前跨格式批注、七板块业务、来源和提示词版本功能继续复用；旧阶段 A–D 的完成记录仍是历史记录，不代表本轮布局完成。
- 不修改 `.dsh-workspace/dsh-plugin/`，不向插件分支合并。此次计划交付不执行 Git 合并、推送或产品打包。
- 实施回退以本轮各任务提交为单位，逆序 `git revert <实际提交号>`；不恢复旧用户数据、不删除新增附件。若任务尚未提交，只撤销该任务对应 diff，保留开始时已有的 `prototype/index.html` 改动。
- 当前 `prototype/index.html` 有未提交布局改动，包含窄导航、图标按钮和侧栏样式。任务 1 以这份工作区内容为起点补齐，不能从 HEAD 覆盖，也不能直接当成完整实现。
- 归档视觉稿是静态参考；不能以它的截图代替真实桌面交互验证。
- 自查修订：补齐原截图逐项对应、全宽样式和 HTML 容器迁移、首次真实输入、过期选择、保存失败、提示词就绪反馈。验证统一为下述两批自动检查和一次桌面连续操作，不再逐任务重复验收。
- 可执行性复核：进一步明确首页按钮的无任务分支、`persist()` 的布尔返回值、自由输入与选项的不同校验、退出任务时的查看器清理、任务详情对原生预览的遮挡。均并入原任务，仍为 6 项实现任务加 1 项收尾，不增加评审/验收任务。

### 验证预算：两批自动检查，一次桌面连续操作

| 时机 | 只运行这些内容 | 停止条件 |
| --- | --- | --- |
| 任务 1–4 完成后 | `node --test tests/workbench-layout.test.js tests/workbench-tabs.test.js tests/workbench-view-state.test.js tests/workbench-viewer-layout.test.js` | 相关行为通过；任务 2、3 不各自重复跑同一批 |
| 任务 5–6 完成后 | `node --test tests/workbench-dialogue.test.js tests/workbench-agent-persistence.test.js` | 动态选择、首次输入与备份往返通过；备份用例追加到现有 persistence 文件 |
| 任务 7 | 一次 Electron 连续操作，见任务 7 的三段流程 | 只补自动检查看不到的真实尺寸、焦点、原生视图遮挡 |

### 实际验证记录（2026-11-15）

- 任务 1–4：`node --test tests/workbench-layout.test.js tests/workbench-tabs.test.js tests/workbench-view-state.test.js tests/workbench-viewer-layout.test.js`，62 项通过、0 项失败。
- 任务 5–6：`node --test tests/workbench-dialogue.test.js`，8 项通过、0 项失败；`node --test tests/workbench-agent-persistence.test.js`，8 项通过、0 项失败，包含动态对话与备份往返。
- `node --check prototype/app.js` 与目标文件 `git diff --check` 均通过；未运行全量测试。
- Electron 临时用户目录中创建了验收任务，实际核到任务栏展开、分隔条吸附到专注对话，以及专注查看按钮切换。670px 模拟视口仍报告为双栏；尝试恢复时调试端口和窗口进程退出，原因未确认。PDF 样本有 1 条有效文本批注和 1 条已撤销点批注，本轮未新增或修改批注。HTML 原生 `WebContentsView` 仍报告 `0×0`；两条针对性路径均未解决，按用户要求停止重复试探，因此任务 7 Step 2 保持未完成。
- 任务 4 Step 5 与任务 6 Step 3 的验证和分组提交已完成；仅剩任务 7 Step 2 的 Electron 三段连续操作未完成。
失败后只重跑受影响文件；若后续确实改到了前一批逻辑，再重跑受影响项。取消“先为了模块不存在运行一次”“每个小任务都提交一次”“末尾再跑全量”的固定动作。不新增验收脚本、独立验收报告、全格式矩阵、重复模型联网调用或重复打包。独立模块由测试加载确认语法；现有 app.js 测试只提取部分源码到 VM，不能证明整文件有效，因此最终仅补一次 `node --check prototype/app.js`。提交按布局（任务 1–4）和对话/保存（任务 5–6）两个完整改动组织，未完成接线的半成品不单独当成交付。

### 已定位的差距

| 当前代码 | 本轮处理 |
| --- | --- |
| `createProjectFromIdea` 仍以 `split` 创建；多处布局默认值也是 `split` | 新任务和重启从 `chat` 开始；旧任务仅在本次会话恢复模式 |
| `openWorkbenchAttachment` 会把 `chat` 改成 `split`；来源定位及三类批注定位会赋值 `preview` | 选对象、定位和打开面板分离，只有模式按钮/明确边缘手势展开 |
| 模式点击调用 `renderWorkbench`，后者调用会销毁 PDF/Office 实例的 `renderWorkbenchMaterial` | 调宽/切模式使用独立布局更新，不重新生成资料 DOM |
| 页面存在 `sidebar-toggle`，当前脚本尚无对应事件；没有双侧拖动逻辑 | 补事件、宽度与返回把手，不新建另一套导航 |
| `requestWorkbenchAgent` 明文禁止选项；`parseAgentResponse` 会过滤“还是”、方案枚举 | 改为当前消息中的少量情境选项，自由输入始终可用 |
| 备份已有 `options: LIST`、`question`、`resolved` | 选项沿用字符串列表；只补必要推荐索引、跳过状态、答复关联字段 |
| HTML 预览使用 Electron `WebContentsView` | 拖动时暂时隐藏原生子视图，结束后同步边界；覆盖批注抽屉时沿用已有裁切 |

## 文件职责与实施顺序

| 文件 | 改动职责 | 任务 |
| --- | --- | --- |
| `prototype/index.html` | 全窗口结构、统一图标、分隔边缘、首页/任务共享工作区、响应式样式 | 1、3、4 |
| `prototype/workbench-layout.js`（新增） | 仅计算可见模式、合法比例与吸附候选，不操作业务数据 | 2 |
| `prototype/app.js` | 接入布局、任务状态、原生预览、空态、选项提交和模型请求 | 1、3、4、5 |
| `prototype/workbench-dialogue.js` | 校验模型回复，保留动态选项和原有提示词能力 | 5 |
| `prototype/workspace-backup.js` | 对话新增字段白名单；维持旧备份兼容 | 6 |
| `tests/workbench-layout.test.js`（新增） | 小尺寸、吸附方向、比例恢复的纯计算测试 | 2 |
| `tests/workbench-dialogue.test.js` | 更新旧“禁止选项”断言、保留提示词防覆盖等测试 | 5 |
| `tests/workbench-agent-persistence.test.js` | 选择防重复、回复落到原任务、请求上下文，以及备份往返；复用同一文件 | 5、6 |
| `tests/workbench-tabs.test.js`、`tests/workbench-view-state.test.js` | 主动打开规则、关闭标签选择、草稿和查看位置 | 4 |
| `tests/workbench-viewer-layout.test.js` | 布局不销毁实例、原生预览遮挡、抽屉关闭/返回焦点 | 3、4 |
| 本计划及 `2026-11-10-product-redesign-implementation.md` | 记录实际完成与最小验证，不能提前勾选 | 7 |

依赖顺序：1 → 2 → 3 → 4 → 5 → 6 → 7。任务内逐步执行，已通过且未受后续修改影响的测试不重复跑。继续使用单会话串行实施即可。

## 固定状态契约

| 状态 | 保存位置 | 行为 |
| --- | --- | --- |
| 任务 ID、正文、对话草稿、提示词手改稿、资料和批注 | 现有任务与附件存储 | 不迁移、不清空 |
| 用户请求模式 `mode`、最近双栏比例 `ratio`、最近查看侧 `lastSide` | `workbenchSessionLayouts: Map<taskId, {mode, ratio, lastSide}>` | 本次会话内按任务隔离；首次打开任务为 `chat` |
| 实际可见模式 | 由可用宽度计算，写回当前任务 `workbenchLayout` 供现有查看器读取 | 窄窗口只改变实际模式，不覆盖会话请求模式 |
| 左侧展开状态 | 内存布尔值，启动为 false | 与右侧独立 |
| 左宽、默认双栏比例 | `localStorage['forward-step:workbench-layout:v1']` | 只存 `{sidebarWidth, splitRatio}`；不存资料或任务正文 |
| 首页布局 | 独立内存对象，结构与会话布局一致 | 不借用上个任务；不为切布局创建空任务 |
| 批注列表/编辑状态 | 现有 `annotationListOpen`、`annotationOpen`、`annotationDrafts` | 关闭抽屉隐藏视图，保留意见草稿 |

`project.workbenchLayout` 继续兼容旧数据，但应用启动不据此自动恢复侧栏。`persist()` 成功会替换内存中的任务对象并返回 `true`，失败会提示并返回 `false`，不会向调用者抛出保存异常。异步操作和保存后必须按 ID 重新取任务；所有“保存成功后继续”的分支必须显式检查布尔值，不能只写 try/catch。

## Task 1：收敛全窗口结构与导航入口

**Files:** 修改 `prototype/index.html`、`prototype/app.js`；参考现有 `go`、`renderProject`、`renderRecent`。

- [x] **Step 1：记录当前界面改动，核对可保留结构。**

```powershell
git diff -- prototype/index.html
rg -n 'recent-list|sidebar-toggle|data-nav-key|workbench-shell|back-home' prototype/index.html prototype/app.js
```

预期：找到现有图标栏、任务列表和三态按钮；保留已有工作区变更。不要使用 `git restore` 清理它。

- [x] **Step 2：把工作台作为首页和任务页共用的全高区域。**

在 `.content` 内新增 `#workbench-surface`，将现有 `.workbench-toolbar` 和 `#workbench-shell` 移入它；保留原 ID 和事件目标。把 `#view-home` 放入 `.workbench-chat-pane`，将消息和输入框包为 `#workbench-task-chat`；`#view-project` 保留任务详情等原有内容。工作台模式的主滚动发生在消息区/查看器内，其他六板块保持自身滚动与布局。

```html
<!-- 放在现有消息列表和消息表单外；不复制原有元素。 -->
<div id="workbench-task-chat" hidden></div>
<!-- 放在对话与预览之间；专注态仍保留这个元素。 -->
<div id="workbench-divider" role="separator" tabindex="0"
     aria-orientation="vertical" aria-label="调整对话与预览宽度"></div>
<!-- 放在 .sidebar 内侧右边缘。 -->
<div id="task-sidebar-divider" role="separator" tabindex="0"
     aria-orientation="vertical" aria-label="调整任务列表宽度"></div>
```

以上空容器用于包裹现有 DOM，最终不得留下重复的消息表单。`go()` 在原路由切换后统一执行：

```js
const inWorkbench = view === "home" || view === "project";
document.getElementById("workbench-surface").hidden = !inWorkbench;
document.querySelector(".main").classList.toggle("workbench-active", inWorkbench);
document.getElementById("workbench-task-chat").hidden = view !== "project";
document.getElementById("view-home").hidden = view !== "home";
```

回首页先按现有逻辑保存旧任务草稿，再将 `activeProjectId` 置空，重置首页的模式为 `chat`；不要删除任务。模式应用和无任务预览由任务 3、4 接入。任务详情仍由现有详情按钮展开，关闭时不占用主工作区。

清空 activeProjectId 前，保存旧任务 ID，复用 `disposeWorkbenchPdfViewer` 和 `disposeWorkbenchOfficeViewer` 清理旧实例；保留 material state 中的意见、页码和草稿，关闭详情覆盖层，调用 `scheduleWorkbenchHtmlPreviewSync` 隐藏/关闭旧 HTML 子视图。否则返回首页后 ID 已清空，下一次 `renderProject` 的旧任务清理分支会被跳过。不要删除 `workbenchSessionLayouts`，同一会话回到旧任务仍应恢复布局。

- [x] **Step 3：替换会把工作台挤成卡片或上下堆叠的样式。**

在原选择器位置修改，删除与其冲突的 `max-width:680px` 工作台上下分栏规则，不在文件末尾不断叠覆盖。

```css
.shell { grid-template-columns:56px var(--task-sidebar-width,260px) minmax(0,1fr); }
.shell.sidebar-collapsed { grid-template-columns:56px 0 minmax(0,1fr); }
.main.workbench-active { height:100dvh; min-height:0; overflow:hidden; }
.main.workbench-active .content { flex:1; min-height:0; width:100%; max-width:none; margin:0; padding:0; overflow:hidden; display:flex; flex-direction:column; }
.main.workbench-active .topbar { flex:none; }
#workbench-surface { flex:1; min-height:0; display:flex; flex-direction:column; }
#workbench-surface[hidden], #workbench-task-chat[hidden] { display:none; }
.workbench-shell { position:relative; flex:1; min-height:0; height:auto; border:0; border-radius:0; display:grid; }
.workbench-shell[data-layout="split"] { grid-template-columns:minmax(0,var(--chat-width,50%)) 8px minmax(0,1fr); }
.workbench-shell[data-layout="chat"], .workbench-shell[data-layout="preview"] { grid-template-columns:minmax(0,1fr); }
.workbench-chat-pane, .workbench-preview-pane { min-width:0; min-height:0; }
#workbench-task-chat { display:flex; flex-direction:column; flex:1; min-height:0; }
.workbench-messages { flex:1; min-height:0; overflow:auto; }
#workbench-divider, #task-sidebar-divider { width:8px; touch-action:none; cursor:col-resize; z-index:20; }
.sidebar { position:relative; }
#task-sidebar-divider { position:absolute; inset:0 0 0 auto; }
.sidebar-collapsed #task-sidebar-divider { display:none; }
.workbench-shell[data-layout="chat"] #workbench-divider { position:absolute; inset:0 0 0 auto; }
.workbench-shell[data-layout="preview"] #workbench-divider { position:absolute; inset:0 auto 0 0; }
#workbench-divider:focus-visible, #task-sidebar-divider:focus-visible { outline:2px solid var(--green); outline-offset:-2px; }
.workbench-resizing, .workbench-resizing * { cursor:col-resize !important; user-select:none !important; }
.workbench-resizing iframe { pointer-events:none; }
```

对话消息内部可设阅读行宽；工作区和预览不设小卡片宽度。窄窗口导航不消失到无入口状态：保留现有移动导航或窄图标栏其中一套，避免重复显示。

原 `.content` 使用 `width:min(1160px,100%)`，仅改 `max-width:none` 不会取消这个宽度限制，因此必须同时写 `width:100%`。任务详情不能被工作台 flex 高度挤到不可滚动的屏幕外：复用 `#project-details`，打开时作为工作台内可关闭的滚动覆盖层，关闭恢复原按钮焦点；不另开任务、不重建资料 DOM。

- [x] **Step 4：统一纯图标及入口。**

三态按钮依次使用“双栏／专注对话／专注查看”的 `title`、`aria-label`、`aria-pressed`。复用当前线性 SVG，SVG 增加 `aria-hidden="true"`、`focusable="false"`；不安装图标框架。示例按钮：

```html
<button type="button" data-workbench-layout="split" title="双栏"
        aria-label="双栏" aria-pressed="false">
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>
</button>
```

左任务列表图标初始 `aria-expanded="false"`，名称为“展开任务列表”。沿用 `recent-list`；搜索、重命名、归档通过“我的计划”的现有入口可到达，首页不新增管理表单。导航保持七板块及既有必要子页，修改 `go()` 的选中态选择器同时覆盖图标栏。

对应原截图删除项：不再显示“先把目标和步骤理清”“当前任务工作台”及对话/资料两段重复介绍。`renderProject` 当前仍将 `project-title` 写成旧标题，需要同时改成紧凑任务名，不能只缩小旧标题：

```js
document.getElementById('project-title').textContent =
  String(project.goalSummary || project.idea || '新任务').trim().slice(0, 60);
```

`project-domain`、`project-subtitle` 若仍被原流程写入，可保留为非占位的隐藏辅助节点；不恢复成介绍块。右侧“放大”落实为查看器占用剩余高度/宽度，fit 按实际内容区计算；不固定旧截图里的 14.4% 缩放值，不强制覆盖用户手动缩放。

- [x] **Step 5：保留改动，随任务 4 一起核对。**

此处不单独运行验收或提交。任务 4 完成时一并确认工作区满宽、没有重复 DOM ID，以及任务详情可打开/关闭。

## Task 2：明确拖动计算与三态边界

**Files:** 新建 `prototype/workbench-layout.js`、`tests/workbench-layout.test.js`；修改 `prototype/index.html` 的脚本加载顺序。

- [x] **Step 1：先添加一个参数化边界测试。**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLayout, dragLayout } = require('../prototype/workbench-layout.js');

test('原始指针决定吸附，最小栏宽不截断吸附判定', () => {
  const initial = { mode:'split', ratio:0.55, lastSide:'chat' };
  assert.equal(dragLayout(initial, 20, 1000, true).mode, 'preview');
  assert.equal(dragLayout(initial, 980, 1000, true).mode, 'chat');
  const middle = dragLayout(initial, 80, 1000, true);
  assert.equal(middle.mode, 'split');
  assert.equal(Math.round(middle.ratio * 992), 360);
});
test('专注把手点击不切换，向内拖动恢复双栏', () => {
  const initial = { mode:'chat', ratio:0.6, lastSide:'chat' };
  assert.deepEqual(dragLayout(initial, 999, 1000, false), initial);
  assert.deepEqual(dragLayout(initial, 980, 1000, true), initial);
  assert.equal(dragLayout(initial, 600, 1000, true).mode, 'split');
  assert.deepEqual(dragLayout(initial, 300, 600, true), initial);
});
test('窄屏临时单区不污染原比例，扩大后恢复双栏', () => {
  const saved = { mode:'split', ratio:0.6, lastSide:'preview' };
  assert.equal(resolveLayout(saved, 600).mode, 'preview');
  assert.equal(resolveLayout(saved, 1000).mode, 'split');
  assert.equal(saved.ratio, 0.6);
  assert.equal(resolveLayout(saved, 688).chatWidth, 360);
});
```

该文件随任务 4 的第一批检查运行，预期 3 项通过；不为确认模块尚未创建而额外跑一次失败命令。

- [x] **Step 2：添加唯一的布局计算模块。**

```js
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ForwardStepWorkbenchLayout = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function() {
  const GAP = 8, CHAT_MIN = 360, PREVIEW_MIN = 320, SNAP = 32;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function resolveLayout(saved, width) {
    const canSplit = width >= CHAT_MIN + PREVIEW_MIN + GAP;
    const mode = saved.mode === 'split' && !canSplit ? saved.lastSide : saved.mode;
    const available = Math.max(0, width - GAP);
    return { mode, canSplit, chatWidth: canSplit
      ? clamp(available * saved.ratio, CHAT_MIN, available - PREVIEW_MIN) : width };
  }
  function dragLayout(initial, rawX, width, moved) {
    if (!moved || width < CHAT_MIN + PREVIEW_MIN + GAP) return { ...initial };
    if (initial.mode !== 'split' && (rawX <= SNAP || rawX >= width - SNAP)) return { ...initial };
    if (rawX <= SNAP) return { ...initial, mode:'preview', lastSide:'preview' };
    if (rawX >= width - SNAP) return { ...initial, mode:'chat', lastSide:'chat' };
    const available = width - GAP;
    return { ...initial, mode:'split', ratio:clamp(rawX, CHAT_MIN, available - PREVIEW_MIN) / available };
  }
  return { resolveLayout, dragLayout };
});
```

`rawX` 为 `event.clientX - shell.getBoundingClientRect().left`，不能用已经夹紧的栏宽代替。`moved` 表示横向位移至少 4 CSS px。候选模式只用来显示释放提示，`pointerup` 才提交。

- [x] **Step 3：接入脚本。**

在 `app.js` 之前插入 `<script src="/prototype/workbench-layout.js"></script>`。检查与提交并入任务 4。

## Task 3：接入双侧拖动、模式恢复和原生预览

**Files:** 修改 `prototype/app.js`、`prototype/index.html`、`tests/workbench-viewer-layout.test.js`。

- [x] **Step 1：建立会话布局与宽度偏好。**

放在工作台相关状态定义附近；读取偏好只接收有限数字，失败保持视图可用，不改任务数据。

```js
const workbenchSessionLayouts = new Map();
let homeWorkbenchLayout = { mode:'chat', ratio:0.5, lastSide:'chat' };
let workbenchPreferences = { sidebarWidth:260, splitRatio:0.5 };
let workbenchDrag = null;
try {
  const stored = JSON.parse(localStorage.getItem('forward-step:workbench-layout:v1') || 'null');
  if (Number.isFinite(stored?.sidebarWidth)) workbenchPreferences.sidebarWidth = Math.max(220, Math.min(360, stored.sidebarWidth));
  if (Number.isFinite(stored?.splitRatio)) workbenchPreferences.splitRatio = Math.max(0.05, Math.min(0.95, stored.splitRatio));
} catch (error) { console.warn('布局偏好读取失败，使用默认宽度', error); }
homeWorkbenchLayout.ratio = workbenchPreferences.splitRatio;
function getWorkbenchSessionLayout(project) {
  if (!project) return homeWorkbenchLayout;
  if (!workbenchSessionLayouts.has(project.id)) workbenchSessionLayouts.set(project.id,
    { mode:'chat', ratio:workbenchPreferences.splitRatio, lastSide:'chat' });
  return workbenchSessionLayouts.get(project.id);
}
function saveWorkbenchLayoutPreferences() {
  try { localStorage.setItem('forward-step:workbench-layout:v1', JSON.stringify(workbenchPreferences)); }
  catch (error) { console.warn('布局偏好保存失败', error); toast('本次布局仍可使用，宽度偏好未保存'); }
}
function applyWorkbenchLayout(project = getActiveProject()) {
  if (project) project = state.projects.find(item => item.id === project.id);
  const shell = document.getElementById('workbench-shell');
  if (shell.clientWidth === 0) return;
  const saved = getWorkbenchSessionLayout(project);
  const result = window.ForwardStepWorkbenchLayout.resolveLayout(saved, shell.clientWidth);
  if (project) project.workbenchLayout = result.mode;
  shell.dataset.layout = result.mode;
  shell.style.setProperty('--chat-width', `${result.chatWidth}px`);
  document.querySelectorAll('[data-workbench-layout]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.workbenchLayout === result.mode));
    const unavailable = button.dataset.workbenchLayout === 'split' && !result.canSplit;
    button.setAttribute('aria-disabled', String(unavailable));
    button.title = unavailable ? '窗口较窄，请放大后使用双栏' : button.getAttribute('aria-label');
  });
  const separator = document.getElementById('workbench-divider');
  separator.setAttribute('aria-valuemin', '0');
  separator.setAttribute('aria-valuemax', '100');
  separator.setAttribute('aria-valuenow', String(result.mode === 'chat' ? 100 : result.mode === 'preview' ? 0 : Math.round(saved.ratio * 100)));
  scheduleWorkbenchHtmlPreviewSync();
}
```

首次进入任务，在 `renderWorkbenchMaterial` 之前应用会话布局；`renderWorkbench` 内重复设置 `shell.dataset.layout` 的旧段改为 `applyWorkbenchLayout(project)`。模式按钮只保存当前查看状态、修改会话模式、应用容器，不调用全量渲染。点击 `chat`/`preview` 更新 `lastSide`，点击 `split` 保留最近有效比例。

模式按钮点击先检查 `aria-disabled="true"` 并返回；保留键盘焦点才能读到不可用原因。所有图标在 hover 和 focus-visible 时显示同一名称提示，不能只依赖浏览器通常仅鼠标显示的 `title`。回首页重置 mode/lastSide，ratio 使用保存的偏好。

- [x] **Step 2：为两条分隔边缘绑定同一组指针生命周期。**

在 `app.js` 内定义 `beginWorkbenchResize(event, kind)`、`moveWorkbenchResize(event)`、`finishWorkbenchResize(cancelled)`，`kind` 只取 `sidebar`/`content`。具体行为固定如下，不引入通用拖拽框架：

| 事件 | 必须执行的内容 |
| --- | --- |
| pointerdown | 仅主指针、左键；`preventDefault/stopPropagation`；先保存草稿和查看位置，重新取得任务；记录任务 ID、指针 ID、起始 clientX、模式/ratio/lastSide 副本、左宽、两栏滚动位置；`setPointerCapture`；设置 `.workbench-resizing` |
| pointermove | 只接受本次 pointerId；左宽按起始左宽+横向位移夹紧到 220–360；右分隔用任务 2 的 `dragLayout` 计算候选。当前保持起始模式，仅更新可见双栏宽度；显示候选吸附提示，不销毁资料 DOM |
| pointerup | 仅接受本次 pointerId，按释放事件坐标再算一次候选；只有内容分隔的候选为 split 才更新 `ratio` 和默认比例。左栏拖动只提交 sidebarWidth，不回写内容比例；分别保存宽度偏好一次并清理捕获、class 和提示 |
| Escape / pointercancel / 意外 lostpointercapture | 恢复起始模式、ratio、lastSide、左宽及查看位置；不写宽度偏好；清理捕获和提示 |
| 切任务 / 切板块 / 窗口宽度在拖动中变化 | 先取消未完成拖动，再完成切换或窄屏计算，不能把前任务的候选写入后任务；左栏主动调宽导致主区变窄不算外部 resize，可正常提交左宽并临时单区显示 |

事件接线代码：

```js
for (const [id, kind] of [['task-sidebar-divider','sidebar'], ['workbench-divider','content']]) {
  const handle = document.getElementById(id);
  handle.addEventListener('pointerdown', event => beginWorkbenchResize(event, kind));
  handle.addEventListener('pointermove', moveWorkbenchResize);
  handle.addEventListener('pointerup', event => {
    if (event.pointerId !== workbenchDrag?.pointerId) return;
    moveWorkbenchResize(event);
    finishWorkbenchResize(false);
  });
  handle.addEventListener('pointercancel', event => {
    if (event.pointerId === workbenchDrag?.pointerId) finishWorkbenchResize(true);
  });
  handle.addEventListener('lostpointercapture', () => { if (workbenchDrag) finishWorkbenchResize(true); });
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && workbenchDrag) { event.preventDefault(); finishWorkbenchResize(true); }
});
```

`finishWorkbenchResize` 先保存局部快照并置 `workbenchDrag = null` 再释放捕获，避免 `lostpointercapture` 二次撤销。吸附提示通过单个 `role="status"` 节点输出“松开后专注查看／对话／返回双栏”，候选未变化不重复播报。

- [x] **Step 3：补齐键盘、左栏、窄窗口。**

左图标切换 `.sidebar-collapsed`，同步名称、`aria-expanded`、左分隔 `tabIndex`；折叠不覆盖宽度。分隔线左右键每次 16 px、Shift 每次 48 px，双栏始终夹紧到最小宽度；专注态向内方向键可恢复双栏，向外不变。模式按钮提供直接三态选择。

观察 `#workbench-shell` 的宽度而非整个 window。`ResizeObserver` 回调仅在宽度变化后使用 `requestAnimationFrame` 合并布局更新；忽略宽度为 0 的隐藏工作台，不从零宽生成比例。预览和对话 `focusin`/`pointerdown` 记录 `lastSide`。临时窄屏不写入会话 mode 或比例；扩大后自动恢复。左栏过宽导致主区不足时按同一规则单区显示。

- [x] **Step 4：保持 HTML、PDF、Office 实例与批注锚点。**

`syncWorkbenchHtmlPreview()` 的隐藏条件新增 `workbenchDrag !== null`、实际模式为 `chat`、任务详情覆盖层打开、host 尺寸为零。拖动开始立即调用既有 `setPreviewBounds(id,{visible:false})`，结束恢复边界，不能关闭重建子视图。普通 iframe 使用 `.workbench-resizing iframe`；原生子视图不受该 CSS 控制，所以两条路径都要处理。

```js
if (workbenchDrag || document.getElementById('project-details').open
    || document.getElementById('workbench-shell').dataset.layout === 'chat') {
  if (activeWorkbenchHtmlPreview) api.setPreviewBounds(activeWorkbenchHtmlPreview.attachmentId, { visible:false });
  return;
}
```

此段放在 `syncWorkbenchHtmlPreview` 取得 `api` 并检查其可用之后。继续沿用函数里对 `workbench-annotation-editor/list` 的覆盖裁切，不改 Electron IPC 权限。

任务 1 将查看器移出了 `#view-project`。现有 `host.closest('#view-project')` 条件也必须替换，否则 HTML 永久被判为隐藏。在原 hidden 表达式中只替换祖先判断，其余菜单、删除确认和错误条件照旧：

```js
const surface = document.getElementById('workbench-surface');
const outsideWorkbench = activeView !== 'project' || surface.hidden || !surface.contains(host);
// 原 hidden 表达式中的祖先判断换成 outsideWorkbench。
```

本轮搜索 `#view-project` 的 DOM 祖先依赖和相关测试 fixture，跟随这个移动一起更新；不要只修改新 helper。

现有详情按钮处理器只做 `details.open = true` 和 `scrollIntoView`；任务 1 改成覆盖层后，同步移除滚动页面操作，打开/关闭均调用 `scheduleWorkbenchHtmlPreviewSync()`。在 `#project-details` 的 `toggle` 事件中同步预览，可同时覆盖按钮和原生 summary 关闭。首页隐藏详情入口，避免显示上个任务的内容；关闭后恢复触发按钮焦点。

在切模式前保存页码、滚动与输入；返回可见后恢复对应 `scrollByLayout`。拖动仅调容器，现有 fit observer 负责适应内容，手动 zoom 不变；禁止把 CSS 像素写回内容坐标。切任务仍保留现有 dispose 流程。

- [x] **Step 5：补充行为断言，随任务 4 运行。**

复用 `tests/workbench-viewer-layout.test.js` 的 VM fixture，将布局不 dispose、HTML 在新容器可见且拖动时隐藏、取消恢复起点合并为一个连续操作用例。它随任务 4 的第一批执行，不在此重复运行或另写一套浏览器测试。

## Task 4：统一主动打开、空态与批注抽屉

**Files:** 修改 `prototype/app.js`、`prototype/index.html`、`tests/workbench-tabs.test.js`、`tests/workbench-view-state.test.js`、`tests/workbench-viewer-layout.test.js`。

- [x] **Step 1：清除隐式展开入口。**

```powershell
rg -n 'workbenchLayout\s*=|workbenchLayout:|openWorkbenchAttachment\(' prototype/app.js
```

`createProjectFromIdea` 默认改为 `chat`；`getWorkbenchViewerState`、`scheduleWorkbenchViewStateSave`、`saveWorkbenchViewState` 和 `renderWorkbench` 的无效布局回退也统一为 `chat`。`openWorkbenchAttachment` 删除自动赋值 `split` 的行；来源按钮以及 image/pdf、docx/pptx、html 的定位分支删除强制 `preview`。保留资料 ID、页码、版本校验和 pending 定位对象；隐藏状态下暂存目标，等用户打开后执行定位。预览已经展开时，在当前模式内定位，不强制放大。

更新 `tests/workbench-tabs.test.js` 原“重新打开资料自动 split”断言：重开后仍 `chat`。更新 `tests/workbench-view-state.test.js` 原“定位 PDF 进入 preview”断言：初始 chat 仍 chat，初始 split 仍 split，页码依然更新。

- [x] **Step 2：明确关闭最后资料后的去向。**

主标签仍为 `material/prompt/task`。不把批注变成主标签。新增任务字段 `workbenchVisitedPreviewModes`，只记录用户实际查看过的主标签并保持顺序；仅生成内容不加入。关闭最后一个资料时，选最近访问且仍有有效内容的 `prompt` 或 `task`；从未查看过提示词/摘要的不应因它们能自动生成而阻止回 chat。

```js
const visited = project.workbenchVisitedPreviewModes || [];
const nextMode = [...visited].reverse().find(mode =>
  mode === 'prompt' ? Boolean(project.workbenchPromptDraft || project.workbenchGeneratedPrompt)
  : mode === 'task' && Boolean(project.idea));
if (!project.workbenchAttachmentId) {
  if (nextMode) project.workbenchPreviewMode = nextMode;
  else getWorkbenchSessionLayout(project).mode = 'chat';
}
```

在调用关闭 helper 的处理器内同步应用布局；关闭 helper 单元测试保留对附件数组、批注草稿和关闭 ID 列表的检查。再次主动打开 material 允许空态；不是重新打开所有已关闭附件。

- [x] **Step 3：补全有任务和无任务的空预览。**

任务存在但无资料时，在 `renderWorkbenchMaterial` 的 `selected` 空分支显示真实空态：

```html
<div class="workbench-material-hint">
  <p>还没有资料</p>
  <button type="button" data-workbench-choose-material>添加资料</button>
</div>
```

隐藏页码、缩放、批注工具和复制按钮；取消不变，错误保留原因并提供原导入入口重试。prompt 标签不受 material 空态限制，未生成时只显示说明和“返回对话”，不调用模型。task 标签无任务时显示“尚未开始”。

首页点击模式按钮也可打开空预览：新增 `renderWorkbenchHomePreview(mode)`，只更新三个主标签对应的空内容、标题及按钮状态，不调用 `renderWorkbench(null)`。它使用 `homeWorkbenchLayout`，不读取上个任务。

首页另存 `homeWorkbenchPreviewMode = 'material'`，与布局的 chat/split/preview 分开。当前事件处理器有 `if (!project) return`，必须替换而不是再追加第二个监听器。接线清单：

| 现有入口 | 无任务首页 | 已有任务 |
| --- | --- | --- |
| `[data-workbench-layout]` | 修改 homeWorkbenchLayout，再应用容器和首页空态 | 修改对应会话布局；保持资料实例 |
| `[data-workbench-preview]` | 修改 homeWorkbenchPreviewMode，再渲染对应空态 | 保存查看位置、更新任务标签及已访问顺序，继续原渲染 |
| `#workbench-add-material`、空态 `[data-workbench-choose-material]`、首页添加按钮 | 共用任务 4 的待建任务导入流程，取消留在首页 | 调用原 `chooseWorkbenchMaterial(project)` |
| `#workbench-copy-prompt`、任务详情入口、批注工具 | 隐藏；不能读取上次任务内容 | 仅在对应内容存在时启用 |
| 首页“开始对话” | 使用真实输入创建任务并请求 Agent | 不复用旧任务 ID |

这里 `renderWorkbenchHomePreview(mode)` 的 mode 仅取 material/prompt/task；三态布局统一由 `applyWorkbenchLayout(null)` 处理，禁止混用两组值。回首页先清理旧 DOM 中的资料、提示词正文/历史/来源与任务摘要，再填入空态；只是清理共享展示节点，不删原任务数据。

现有 `desktopApi.pptFeedback.chooseFile(taskId)` 在成功选文件时已经按任务 ID 保存附件，不能先省略 ID 选完再另造任务 ID。首页导入先分配一个合法 `crypto.randomUUID()` 作为待建任务 ID，在内存保留；调用 `chooseFile(id)`。取消不持久化任务；成功用相同 ID 创建任务并关联附件，名称取当前首页输入或附件名，不二次弹文件框。将 `createProjectFromIdea` 的参数扩展为 `{addMaterial=false, id, attachment, requestAgent=true}`，默认调用保持原行为；首页仅添加资料时 `requestAgent:false`，不能因点添加就发起模型请求。创建后的首个用户消息待用户发送目标时再形成，不能将附件名伪装成已发送指令。添加资料后的首帧继承用户主动选定的首页模式，后续任务按会话规则恢复。

选择期间禁用同一导入入口；保存任务失败则保留这个内存 ID、附件结果和首页输入，显示“资料已导入，任务保存失败”并重试关联，不能再选文件或丢弃已存附件。选择期间切到其他页面，完成后只写入新任务/就地通知，不把当前页面抢回；页面仍为首页才打开新任务。取消和不支持格式不留下任务记录。

资料先行的任务初始 `idea` 留空，`conversation:[]`，文件名只作任务标题回退，输入草稿保持原文。第一次实际发送时将这条文本写为 `idea` 和首条 user 消息，再调用模型。所有“有目标”判断均看真实 idea/消息，不把文件名作为目标。同步修改 `buildModificationPrompt` 的固定 `index > 0` 过滤，防止首条真实输入被遗漏，见任务 5。

`renderWorkbench` 当前会同步构建本地修改提示词；已有任务保留这一行为和手改保护，不能用“无资料”来隐藏它。无任务首页才走独立空态，不创建生成版本。纯布局操作不调用该生成路径。

资料先行、尚无真实目标且无有效批注意见的任务也走“尚未生成”提示词空态。资料解析完成或提示词正文确实生成/更新时，在对话区的状态行提示一次“资料已就绪／修改提示词已更新”；关联当前任务与内容版本去重，不能每次 render 都插入消息。手改稿未覆盖时提示“依据已变化，当前手改稿已保留”，不假称稿件已更新；不抢焦点或自动展开预览。

- [x] **Step 4：完成抽屉行为与焦点。**

保留 `annotationListOpen` 和 `annotationDrafts`，把“开始批注／批注列表／关闭”改为同系列图标+可访问名称。资料宽度足够时并排；不足时覆盖。覆盖态点击批注定位后先记录目标，再隐藏抽屉、同步原生 HTML 边界、把焦点交还资料容器；不隐藏编辑中的未保存意见。Escape 关闭最上层浮层并回到触发图标，未保存草稿留在原资料。弹出的编辑浮层限制键盘焦点；并排抽屉不限制整页焦点。

现有未保存选区同步函数 `syncWorkbenchAnnotationDraft` 继续负责跨资料切换；布局切换不调用清空意见逻辑。

- [x] **Step 5：定向验证并提交。**

执行验证预算中的第一批命令一次，预期全部通过。旧断言改成主动打开规则，原有草稿/批注用例继续复用；不为每种格式重复加一组相同布局测试。提交完整的任务 1–4 相关改动：`feat: 完成桌面工作台全窗口布局与主动预览`。

## Task 5：打通 Agent 动态选择完整链路

**Files:** 修改 `prototype/workbench-dialogue.js`、`prototype/app.js`、`tests/workbench-dialogue.test.js`、`tests/workbench-agent-persistence.test.js`。

- [x] **Step 1：用情境选项替换旧禁止菜单契约。**

返回结构继续使用 `question: string|null`、`options: string[]`；新增 `recommendedOption: number|null`（从 0 开始）、`optional: boolean`。推荐理由使用现有 `recommendation.reason`。没有关键问题时 options 为空；单个确认按钮也允许，普通选择通常 2–3 项，最多 3 项。外部文本只用 `textContent` 显示。

```js
test('解析当前问题的选项和推荐索引，同时保留自由追问', () => {
  const result = parseAgentResponse(JSON.stringify({
    reply:'我理解你要压缩周报整理时间。', question:'先统一哪个团队的周报？',
    options:['产品团队','研发团队'], recommendedOption:1,
    recommendation:{text:'先从研发团队开始',reason:'你提到这部分重复工作最多。'}, optional:false
  }));
  assert.deepEqual(result.options, ['产品团队','研发团队']);
  assert.equal(result.recommendedOption, 1);
  assert.equal(result.optional, false);
});
test('模型空值、非法索引和非结构化文本不产生可执行选项', () => {
  assert.deepEqual(parseAgentResponse('null').options, []);
  assert.deepEqual(parseAgentResponse('普通回复').options, []);
  assert.equal(parseAgentResponse('{"question":"选一个","options":["甲"],"recommendedOption":9}').recommendedOption, null);
});
```

保留原测试中建议确认、手改稿保护、提示词只汇总用户答复、来源版本等用例；只替换与新设计相反的“禁止菜单”部分。

- [x] **Step 2：替换 `parseAgentResponse`，其余导出不变。**

```js
function parseAgentResponse(raw) {
  const text = String(raw || '').trim();
  let value;
  try { value = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { value = { reply:text }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const read = (input, limit) => typeof input === 'string' ? input.trim().slice(0, limit) : '';
  const reply = read(value.reply, 2000);
  const question = read(typeof value.question === 'object' ? value.question?.text : value.question, 300) || null;
  const supplied = Array.isArray(value.options) ? value.options : value.question?.options;
  const normalized = Array.isArray(supplied) ? supplied.map(item => read(item, 180)) : [];
  const validOptions = question && normalized.length >= 1 && normalized.length <= 3
    && normalized.every(Boolean) && new Set(normalized).size === normalized.length;
  const options = validOptions ? normalized : [];
  const sourceIndex = value.recommendedOption;
  const selected = Number.isInteger(sourceIndex) && sourceIndex >= 0 && Array.isArray(supplied)
    ? read(supplied[sourceIndex], 180) : '';
  const recommendedOption = selected && options.includes(selected) ? options.indexOf(selected) : null;
  const recommendationText = read(value.recommendation?.text, 500);
  const recommendation = recommendationText
    ? { text:recommendationText, reason:read(value.recommendation?.reason, 500) } : null;
  return { reply, question, recommendation, options, recommendedOption,
    optional: value.optional === true,
    text:[reply, question].filter(Boolean).join('\n\n') };
}
```

删除仅由旧 parser 使用的 `hasChoiceMenu`，不要继续用“或／还是”等正则删除用户需要的比较。非结构化模型回复作为普通文本显示，不猜测生成按钮；空回复沿用现有错误/空响应说明，不编造方案。

超过 3 项、空标签或重复标签的结构不渲染选项按钮，保留问题和自由输入；不能静默截去第四项导致用户只见一部分方案。无推荐理由时不显示“推荐”徽标，普通选项和自由输入仍可使用。

- [x] **Step 3：同步模型指令、存储和后续上下文。**

将 `requestWorkbenchAgent` system 文本换为：

```text
你是向前一步桌面应用中的任务协作 Agent。先理解用户目标，自己比较可行做法并给出推荐和简短理由。只有缺失信息会实质改变方案时才提一个关键问题；需要用户选择时，给出与当前描述相关的 1–3 个简短选项，推荐项用索引标记。不要在首页生成固定问卷，也不要每轮都强行提问。用户可以自由输入修改、组合或否定选项；确认后继续推进，不重复问已回答内容。非关键追问标 optional=true。选择只记录任务方向，不授权外发、执行文件修改或覆盖手动稿。只输出 JSON：{"reply":"回应","recommendation":null,"question":null,"options":[],"recommendedOption":null,"optional":false}。recommendation 非空时包含 text 和 reason；question 非空时是一个字符串；options 为字符串数组；recommendedOption 为 options 的从 0 开始的索引或 null。
```

将 parser 返回的 options/recommendedOption/optional 写入 assistant 消息。请求历史除了消息 text 和 recommendation，还带上本轮问题、编号选项与已回答状态，使“第二项”“两者都要”有可解释上下文。用固定模板拼成文本，不把回复内容提升为 system 指令。

- [x] **Step 4：渲染最新未回答问题，统一答复入口。**

`renderWorkbench` 只为最后一条正常 assistant 回复里的未 resolved 问题显示选项；不能倒序查找任意未 resolved 问题，否则回答新问题后旧问题会重新冒出。模型失败的 `agent-status` 不替代正常回复，也不重新激活已回答问题。新问题替代旧问题时，旧问题显示“已由后续问题替代”，但不标成用户已回答。每个按钮携带 `data-workbench-answer-message` 与 `data-workbench-answer-index`，推荐项加可见“推荐”标记和已有 reason。`optional` 才显示“跳过”；自由输入框始终存在，不放固定“其他”选项。

把表单当前提交主体移入 `submitWorkbenchReply(text, {messageId, optionIndex, skip=false, fromComposer=false}={})`，统一完成以下步骤：

1. 根据当前任务 ID 取最新对象；pending 时返回。自由输入只要求非空，不强制 messageId 或 optionIndex；选项点击才要求 messageId 匹配当前问题和 optionIndex 合法；跳过只要求匹配当前问题且 optional=true。不存在待回答问题时，仍可自由输入发起下一轮。
2. 文本点击只取存储的选项值，不信任 DOM 传入正文；skip 文本为“本轮先跳过这个问题”。将问题同步标 resolved 并记录 skipped，随后立即追加一条 user 消息。
3. user 消息新增 `replyToMessageId`，选项点击另存 `selectedOptionIndex`；跳过消息加 `skipped:true`。普通自由输入也关联当前问题；不能把“都要”强制改成单选。保留 `confirmsRecommendation` 对自然语言确认的现有处理。
4. 仅 fromComposer=true 清理 textarea 和 conversationDraft；点击选项不丢弃已经输入但未发送的草稿。清理旧定时保存后持久化，成功后才重新渲染该任务、发起一次既有模型请求。保存失败恢复本次追加前的 conversation、resolved 和草稿，显示保存失败，不发请求；不能留下“界面已回答但数据未保存”的半状态。
5. 连点因 resolved/pending 检查只记录一次。选择过程中切任务，异步回复仍按发起任务 ID 保存，不抢回界面。
6. 生成的修改提示词沿用现有用户消息汇总与手改稿保护；跳过记录只进入对话上下文，不成为修改要求。模型失败保留答复及自由输入，不恢复成“未回答”再次提交同一选择。模型请求失败的重试只重新请求同一轮，不重复追加 user 消息。

`buildModificationPrompt` 的 additions 替换为以下按内容识别首条目标的过滤，兼容原来的“首条就是 idea”和资料先行的空对话。confirmedRecommendations 同时排除 skipped：

```js
const additions = conversation
  .filter((message, index) => message?.role === 'user' && !message.skipped
    && !(index === 0 && String(message.text || '').trim() === idea))
  .map(message => String(message.text || '').trim())
  .filter(Boolean);
const confirmedRecommendations = conversation
  .filter(message => message?.role === 'user' && !message.skipped
    && typeof message.confirmedRecommendation === 'string')
  .map(message => message.confirmedRecommendation.trim())
  .filter(Boolean);
```

事件分支放在现有 `workbench-messages` 点击监听器中，处理完动态选择立即 return；原批注意见冲突按钮逻辑保留。

为避免渲染和提交各自寻找不同的“当前问题”，只增加下面这个共享 helper。正常模型回复当前没有 kind；本地批注冲突记录和 agent-status 不参与寻找，不能把它们当成新的模型问题：

```js
function getWorkbenchPendingQuestion(project) {
  const latest = [...(project.conversation || [])].reverse()
    .find(message => message?.role === 'assistant' && !message.kind);
  return latest && !latest.resolved
    && (latest.question || latest.recommendation || latest.options?.length) ? latest : null;
}
```

在 `submitWorkbenchReply` 的入口明确分支，不把自由输入误当成选项点击：

```js
const pendingQuestion = getWorkbenchPendingQuestion(project);
if (fromComposer) {
  text = String(text || '').trim();
  if (!text) return;
} else {
  if (!pendingQuestion || messageId !== pendingQuestion.id) return;
  if (skip) {
    if (!pendingQuestion.optional || !pendingQuestion.question) return;
    text = '本轮先跳过这个问题';
  } else {
    if (!Number.isInteger(optionIndex) || optionIndex < 0
        || optionIndex >= (pendingQuestion.options?.length || 0)) return;
    text = pendingQuestion.options[optionIndex];
  }
}
```

保存边界：追加消息之前保存 `structuredClone(project)` 作为本次同步修改的恢复点。完成修改后检查 `if (!persist())`；失败按该 ID 替回本任务恢复点、恢复输入显示并 return，不回滚其他任务，不调用模型。成功重新按 ID 取任务再调用 `requestWorkbenchAgent`。同一布尔结果检查也用于任务 4 的待建任务导入：保存失败保留待关联附件，不能进入正常任务或报告导入流程全部完成。

- [x] **Step 5：补齐选择闭环断言，随任务 6 一起运行。**

复用现有异步 fixture，集中覆盖一次提交防重复、未发送输入保留、回复落到原任务、保存失败不外发。parser 用例同时包含非法/超量选项；提示词用例包含首次真实输入和跳过不成为要求；旧问题不复活纳入同一个对话轮次用例。没有改动的建议确认、手改保护和来源测试保留，不重新写一份。运行与提交并入任务 6。

## Task 6：补齐新状态的保存与备份兼容

**Files:** 修改 `prototype/workspace-backup.js`、`tests/workbench-agent-persistence.test.js`。

- [x] **Step 1：先写备份往返用例。**

```js
// 追加到现有文件，复用已有 test、assert 导入。
const { createBackup, replaceState } = require('../prototype/workspace-backup.js');
test('备份保留动态问题及答复关联，旧对话仍可恢复', () => {
  const state = { projects:[{ id:'task', idea:'周报',
    workbenchVisitedPreviewModes:['material','prompt'],
    conversation:[
      {id:'old',role:'user',text:'减少整理时间'},
      {id:'q',role:'assistant',text:'先改善哪个团队？',question:'先改善哪个团队？',
       options:['产品','研发'],recommendedOption:1,optional:false,resolved:true,skipped:false},
      {id:'a',role:'user',text:'研发',replyToMessageId:'q',selectedOptionIndex:1}
    ] }] };
  const restored = replaceState({}, JSON.parse(JSON.stringify(createBackup(state))));
  const task = restored.projects[0];
  assert.deepEqual(task.workbenchVisitedPreviewModes, ['material','prompt']);
  assert.equal(task.conversation[0].text, '减少整理时间');
  assert.equal(task.conversation[1].recommendedOption, 1);
  assert.equal(task.conversation[1].resolved, true);
  assert.equal(task.conversation[2].replyToMessageId, 'q');
  assert.equal(task.conversation[2].selectedOptionIndex, 1);
});
```

这个用例直接追加到现有 persistence 测试文件，随字段实现后一起执行，不新增测试文件或单独跑一次已知失败。

- [x] **Step 2：只扩展现有白名单。**

`WORKBENCH_MESSAGE_FIELDS` 增加：

```js
recommendedOption: SCALAR,
optional: SCALAR,
skipped: SCALAR,
replyToMessageId: SCALAR,
selectedOptionIndex: SCALAR,
```

任务字段增加 `workbenchVisitedPreviewModes: LIST`。保留 `options: LIST`，不迁移成对象数组；无上述字段的旧对话按原文本呈现。不把会话 Map、拖动快照和全局布局偏好加进任务正文/附件备份。

`prototype/storage.js` 的 `migrateState` 对 projects 使用 `stripModelKeys(...).map(withProjectDefaults)`，没有消息字段白名单；沿用其原有保存流程。本任务不修改该文件、不改 schemaVersion，也不丢弃旧业务数据。

- [x] **Step 3：运行该用例并提交。**

执行验证预算中的第二批命令一次，预期全部通过，包括备份往返用例。提交完整的任务 5–6 相关改动：`feat: 完成对话动态选择及记录保存`。

## Task 7：一次桌面核对与交付记录

**Files:** 更新本计划和 `2026-11-10-product-redesign-implementation.md` 的进度；必要的修复只限任务 1–6 文件。

- [x] **Step 1：做最后一次改动范围与语法检查。**

```powershell
git diff --check
node --check prototype/app.js
git status --short
```

预期前两条无输出且退出码 0；状态中没有本轮误改的插件文件。app.js 的完整语法检查弥补现有 VM 仅提取片段的缺口，只运行一次；其他模块沿用两批检查结果，不再额外跑全量 `pnpm test`。

- [ ] **Step 2：启动一次真实桌面窗口完成三段连续操作。**

优先检查当前正在运行的开发窗口；无可用窗口再执行 `pnpm desktop`，不为了验收重建 NSIS/portable。使用一个新验收任务和已有小样本，不改用户真实任务内容。

| 一次检查流程 | 通过标准 |
| --- | --- |
| 1. 首页和导航→任务栏开关/调宽→三图标/边缘拖动→缩窄和恢复 | 主区满宽；图标可认；左右独立；拖动、取消及专注返回正常；窄屏不挤压。Tab、方向键、Escape 在本段顺手检查，不另走键盘矩阵 |
| 2. 从空预览导入一份 PDF→加一条批注和草稿→临时放大/切任务返回→看一轮本地情境选择 | 实际内容可读、不缩成小纸片；页码和意见位置正确；草稿保持；对话选项在当前消息内且不抢开预览。关闭标签、空态返回和手改稿提示在这条路径顺手确认 |
| 3. 切到一份 HTML→跨原生预览拖动→打开覆盖抽屉并定位 | 原生视图在新容器显示，拖动连续，抽屉不被盖住，关闭后焦点/显示恢复。只补浏览器或纯计算测试覆盖不到的 Electron 行为 |

第 2 段复用测试工具注入的一轮本地回复，只核对选项呈现，不重复自动测试中的全部错误组合，也不添加产品内假模型/演示按钮。沿用既有在线模型记录，不重复付费 API 验收，不把本地回复算作在线验证。其他板块只确认入口和原有页面仍能显示，不重新走完 22 条业务流程。

- [x] **Step 3：按实际结果更新进度。**

勾选完成任务并记录实际测试命令、通过/失败、桌面检查结果；未解决项保留未勾选和具体表现。当前总入口链接本计划，不再显示“当前剩余 0 项”覆盖本轮未实现设计。只有 1–7 全部完成才能将本轮剩余置 0；不沿用旧 EXE 哈希声称新布局已交付安装包。

将这段简短实际结果随最近的相关实现提交保存；不为验收另建报告、截图合集或单独提交门槛。

## 覆盖自审

| 正式设计要求 | 实施位置 | 验证位置 |
| --- | --- | --- |
| EXE、原项目目录、七板块导航、全窗口、简洁首页 | 任务 1 | 桌面第 1 段 |
| 左侧收放/调宽、与右侧独立 | 任务 1、3 | 桌面第 1 段 |
| 三态纯图标、名称提示、按下态、顶部始终可达 | 任务 1、3 | 桌面第 1 段的键盘操作 |
| 原始指针吸附、释放切态、返回把手、取消恢复 | 任务 2、3 | 第一批测试、桌面第 1 段 |
| 最小栏宽、窄屏暂时单区、恢复比例 | 任务 2、3 | 第一批测试、桌面第 1 段 |
| 跨 iframe/原生 HTML 连续拖动、避免误批注 | 任务 3 | 第一批测试、桌面第 3 段 |
| 新任务/重启简洁、会话内任务隔离、仅保存宽度偏好 | 状态契约、任务 3、4 | 桌面第 1–2 段 |
| 添加/解析/引用/生成不自动展开 | 任务 4 | 第一批测试、桌面第 2 段 |
| 资料/提示词/摘要；批注为抽屉；空态和错误重试 | 任务 4 | 第一批测试、桌面第 2–3 段 |
| 关闭最后标签、状态保留、内容坐标不漂移 | 任务 3、4、6 | 第一批测试、桌面第 2 段 |
| 动态建议与选择、每次一个问题、自由回答/跳过/防重复 | 任务 5 | 第二批测试、桌面第 2 段 |
| 回答进入任务及修改提示词，不覆盖手改稿、不额外外发 | 任务 5 | 原有提示词保护测试及新增提交测试 |
| 字段保存、备份兼容，不因视图重置清数据 | 任务 6 | 第二批 agent-persistence 中的往返用例 |
| 原有跨格式批注、来源版本、冲突、提示词版本 | 继续复用旧阶段 B 的实现，任务 3–5 修改其入口时保持契约 | 受影响测试+一个实际带批注样本；不重新全格式验收 |
| 其他六板块完整业务流程 | 继续沿用旧阶段 C，本轮只调整公共导航/工作区布局 | 入口可达核对；不重新实施其内部业务 |

## 历次批注追踪与当前实施状态

以下按用户原话与原截图核对。原截图为 `codex-clipboard-30bf8dd9-d965-409b-9e67-0fdeabf97a62.png`，本次已重新查看；坐标是该图中的批注位置，不是最终像素布局约束。当前验证状态见上方“实际验证记录”。

| 用户批注或明确要求 | 设计落点 | 计划落点 / 当前结论 |
| --- | --- | --- |
| 图像 1 第 1、2 点“不需要”：大标题、当前任务工作台介绍 | 工作台设计 3.5，六态视觉稿的紧凑标题栏 | 任务 1 已实现；自动布局测试通过，桌面全流程仍待验收 |
| 图像 1 第 6、7 点“不需要”：对话和资料说明块 | 工作台设计 3.5，视觉稿对话/资料主体 | 任务 1 已实现并纳入布局测试；桌面全流程仍待验收 |
| 图像 1 第 3 点“放大整个工作台”、第 5 点预览“放大” | 工作台设计 3.5 全窗口、3.3 专注查看 | 任务 1、3 已实现；自动布局/视图测试通过，完整桌面流程仍待验收 |
| 图像 1 第 4 点“缩小成图标”，后续“三个按钮保留、里面不要文字” | 工作台设计 3.5 三个模式按钮 | 任务 1、3 已实现；桌面只核到布局模式切换 |
| “右侧侧边栏点击图标后才出现” | 工作台设计 3.2、3.5 主动打开 | 任务 3–4；后来明确的边缘拉回是另一个用户主动动作，不把导入/回复当打开动作 |
| “A 和 C 都要”以及后续“A 和 B 都要” | 工作台设计 3.5 对两组字母作了消歧 | 分别对应查看模式和左任务栏收放；任务 1–3 均保留 |
| “两边拉边缘调整”“拖动切换三种面板” | 工作台设计 3.5 拖动规则 | 任务 2–3，一条左栏边缘、一条对话/预览边缘；没有增加第三条宽度边缘 |
| “像 DSH 的对话”“Agent 根据想法给选择，不是填一堆表” | 工作台设计 3.4 | 任务 5；最新问题、推荐理由、自由回答、跳过、重复提交与过期问题规则均明确 |
| “类似文件查看器”“图片、PPT、文档、HTML、网站都可批注” | 工作台设计 4、4.1、5、6、12.2 | 复用旧阶段 B：`2026-11-10-product-redesign-02-annotations.md`；任务 3–4 保留实际内容、工具能力和来源锚点 |
| “工作台知道批注指的什么”“主要生成修改提示词” | 工作台设计 6、7、12.3–12.4 | 旧阶段 B 的定位/来源/冲突/版本，任务 4–6 保留闭环；不把坐标或纯文本复制假称附带图片 |
| “每个导航板块独立设计、功能与流程补齐” | 界面设计 4–9 节、功能流程 2–7 节及跨板块补充 | 旧阶段 C：`2026-11-10-product-redesign-03-pages.md` 的 Task 15–21；本轮保留入口，不把六态工作台视觉稿当成七板块全部视觉稿 |
| “修改桌面 exe，别合入插件；main 回原目录” | 工作台设计实施对象说明 | 本轮使用根目录 Electron 和原项目目录；合并及上传不是本次文档自查动作 |

结论：任务 1–6 的实现已覆盖并通过对应自动测试；任务 7 的 Step 1 与进度记录已完成。29 个步骤中 28 个已勾选，仅剩任务 7 Step 2 的完整 Electron 三段流程。HTML 原生 `WebContentsView` 持续为 `0×0`，两条针对性路径未解决后停止重试；该能力明确保持未完成。旧设计中的“当时待评审/待做原型”保留其历史含义，不能据此宣称所有次级页面已有可交互视觉稿或功能均已完成。

## 实施完成后的简短交付格式

```text
本轮 7 项任务：已完成 X 项，剩余 Y 项。
实际改动：列出本轮文件与用户可见效果。
最小验证：列出实际执行的命令和结果、一次 Electron 窗口检查结果。
未执行：全量回归、重复在线模型验收和重新打包；如未做真实桌面检查，明确写出。
```

本计划自查只核对需求覆盖、实际调用点和字段一致性，不表示产品功能或测试已经执行。
