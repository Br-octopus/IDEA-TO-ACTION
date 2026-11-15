# 阶段 A：桌面端导航与工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows Electron 桌面应用中交付七板块入口、简洁首页，以及保留任务状态的 A/C 工作台。

**范围：** 只修改仓库根目录「向前一步」桌面应用，最终交付 NSIS 安装包与 portable `.exe`；不修改 `.dsh-workspace/dsh-plugin` 插件副本。浏览器入口仅用于开发验证。

**Architecture:** 以根目录现有 HTML/CSS/JavaScript renderer 为基础重排侧栏和视图；复用现有任务、写作、研究与 Electron 受控 IPC。仅在需要持久化或受控文件访问时触及主进程/预加载，不新建 React、路由、Host 或第二套存储。

**Tech Stack:** Electron 38 系列、`prototype/index.html` / `prototype/app.js`、Node 内置测试、现有 `electron/main.js` 与 `electron/preload.js`。

---

### Task 1：记录桌面应用基线与边界

**Files:**
- Read: `README.md`、`package.json`、`prototype/index.html`、`prototype/app.js`
- Read: `electron/main.js`、`electron/preload.js`
- Test: `tests/e2e-smoke.test.js`、`tests/electron-smoke.test.js`
- Create: `.dsh-workspace/docs/superpowers/acceptance/2026-11-10-redesign-baseline.txt`

- [x] 记录 `git status --short`、Node/pnpm 版本、主入口和当前视图 ID；保留与本任务无关的工作区修改。
- [x] 在可用依赖环境运行 `pnpm test` 与 `pnpm check`，把命令、退出码、失败测试和版本写入基线文件；若既有测试失败，先记录，不把它算作本阶段新回归。
- [x] 确认后续只修改仓库根目录桌面应用。`.dsh-workspace/dsh-plugin/forward-step-dsh` 和 `tests/dsh-plugin` 不得列入变更。

### Task 2：将既有视图映射到七板块

**Files:**
- Modify: `prototype/index.html`，侧栏、移动端菜单、页面标题/容器
- Modify: `prototype/app.js`，现有视图切换与当前页状态
- Test: `tests/e2e-smoke.test.js`

- [x] 先写覆盖七板块导航映射、当前项高亮及旧业务视图返回的 smoke 断言；实现前运行断言确认发现窄屏共享视图高亮错误后再修复。
- [x] 用现有 `data-view` 入口映射工作台、资料库、提示词收藏、写作、研究、记忆与偏好、设置；记忆与写作复用现有视图，不引入新路由。
- [x] “我的计划”继续作为工作台历史入口，可从列表恢复既有任务。
- [x] 运行 `node --test --test-name-pattern="七板块导航" tests/e2e-smoke.test.js`，并在隔离 Electron renderer 中逐一点击导航映射。

### Task 3：收敛默认首页与对话式建议

当前进度（2026-11-11）：Agent 系统提示要求结合用户完整想法自行取舍，只输出一条建议及理由；不显示独立选项或确认按钮，用户直接在对话中自然语言确认或修正。简短肯定会把对应建议写入已确认方向并进入修改提示词。无模型时显示离线状态，不伪造建议。Edge 与隔离 Electron 已检查简洁首页、资料入口、对话式工作台及任务状态；本轮目标测试 69 项通过。真实模型未配置，在线建议响应和两端完整交互一致性仍待验收，因此本任务尚未完成。

**Files:**
- Modify: `prototype/index.html`，首页内容和短弹层容器
- Modify: `prototype/app.js`，首页到任务态的进入逻辑
- Test: `tests/e2e-smoke.test.js`

- [x] 回归断言覆盖：方向需确认时由 Agent 在当前对话基于用户完整想法自行比较并选出一条推荐及理由；用户在对话内确认后写入当前任务，不把方案比较、多选菜单或字段逐项填写交给用户。
- [x] 首页只保留自然任务输入、必要资料入口和最近任务；不常驻领域/受众/格式清单，也不让用户逐项填通用字段。
- [x] 用户在对话中用自然语言确认单条建议或自由修正后，把确认方向/补充保存在该任务并更新修改提示词；不提供独立选项或确认按钮；未发送草稿按任务隔离；模型不可用时明确状态，不伪造建议或选项。
- [x] 使用真实模型验收 Agent 会依照用户想法给出单条建议；不以静态模拟回复代替在线验收。
- [x] 运行目标回归测试：`pnpm exec node --test tests/e2e-smoke.test.js tests/storage.test.js tests/electron-ppt-main-annotation.test.js`，69 项通过。
- [x] 配置真实模型并验证 Agent 按用户想法给出单条建议；检查 Edge 与 Electron 的完整交互一致性。

2026-11-13 补验：测试模型实际 ID 为 `gpt-6-sol`。Edge 和隔离打包 EXE 分别从简洁首页输入“让每周项目汇报更清楚、减少填表时间，本周五试行”，均收到一条与目标相关的“一页式周报”建议和理由；用户在对话里确认后，修改提示词包含已确认方向。两端均保留 4 条对话（用户、带单条建议的 Agent、带确认的用户、Agent 继续回复），Edge 刷新与 EXE 完整退出重启后仍能恢复。EXE 使用独立 `--user-data-dir`，测试完成后移除该目录的安全设置文件；证据见桌面 EXE 验收记录及 `.codex-acceptance/redesign-20261113/model-live-20261113/exe-confirmed.png`。本项仅完成 Task 3；不推断 Task 4/5 或阶段 B/C/D 已验收。

### Task 4：落实 A/C 查看状态与任务草稿保留

当前进度（2026-11-11）：同一任务的双栏/专注对话/专注查看布局和“资料/修改提示词/任务摘要”页签按任务保存。Edge 实测 A/C 切换保留未发送草稿；任务 A 的 125% 缩放与 234px 滚动在切换到任务 B 后再返回 A 仍恢复，任务 B 独立保持 100%。已修复切到首页时隐藏查看器把滚动位置覆盖为 0 的问题。隔离 Electron 真实窗口在关闭重开并从“我的计划”恢复后，草稿、布局和预览页签仍保留；自动化测试覆盖任务/附件状态往返及批注选中状态重开。真实 PDF 窗口中的页码、缩放、滚动和选中批注跨模式/跨重启仍待验收，因此本任务尚未完成。

截图复核与修正（2026-11-11）：旧 Electron 截图 `.codex-acceptance/redesign-20261111/pdf-window-after-restart.png` 显示资料容器恢复到较深滚动位置时，翻页/缩放/批注工具栏也滚出视口。当时先以 sticky 工具栏修复；该布局已由 2026-11-12 的独立滚动区实现替代，见下方补充记录。

**Files:**
- Modify: `prototype/index.html`、`prototype/app.js`，工作台分栏与视图切换
- Modify only if necessary: `electron/preload.js`、`electron/main.js`，持久化/文件能力须走现有白名单 IPC
- Test: `tests/e2e-smoke.test.js`、`tests/electron-smoke.test.js`

- [x] 回归覆盖任务/附件隔离、页码/缩放/滚动状态往返，以及 Electron 批注重开后选中状态；目标测试 69 项通过。
- [x] 同一工作台实现 A「对话＋预览」和 C「仅看资料/仅看对话」；切换视图不得创建新任务，不卸载并丢失任务态。
- [x] Electron 隔离用户目录实测关闭重开并恢复任务后，草稿、布局和预览页签仍保留；证据：`.codex-acceptance/redesign-20261111/stage-a-electron-restart-restored.png`。
- [x] 在真实 PDF 窗口执行 A↔C、切换资料及关闭重开，逐项确认页码、缩放、滚动位置和已选批注恢复。
- [x] 不把原始文件或大截图写入普通 `localStorage`；沿用 Electron 用户数据和附件存储。
- [x] 运行目标测试并在隔离 Electron 用户目录验证 A/C 草稿和任务重开恢复；`pnpm exec node --test tests/e2e-smoke.test.js tests/storage.test.js tests/electron-ppt-main-annotation.test.js` 69 项通过。

2026-11-12 Electron 窗口补验 A/C 布局：在现有任务中切到“专注查看”后，对话区隐藏、查看器扩展；返回“双栏”后对话和资料区域恢复，任务标题和输入区仍在。截图见 `.codex-acceptance/redesign-20261111/stage-a-live-20261112.png`、`stage-a-focus-preview-20261112.png`、`stage-a-dual-restored-20261112.png`。本次没有加载 PDF，也未核验页码、缩放、滚动、草稿和批注跨窗口重启；Task 4/5 仍未完成。

2026-11-12 PDF 查看器补验与修正：将 `.workbench-material-toolbar` 与 `.workbench-material-scroll` 拆为并列区域；工具栏不随正文滚动，资料状态按正文容器保存，PDF 页码状态行纵向显示在页面下方。为避免视口高度变化把原位置覆盖，附件滚动位置按 `split`、`chat`、`preview` 分别保存；旧的 `scrollTop`/`scrollLeft` 标量仍作为迁移回退，翻页和“适合窗口”会清空布局位置。

隔离 Electron 实测使用两页 PDF：从“我的计划”重开后为第 2/2 页、125%、1 条已选批注，双栏正文滚动位置为 1102px。切到“专注查看”时受更高视口限制为 132px，返回双栏后恢复 1102px；刷新 renderer 并重新打开任务后仍恢复第 2 页、125%、选中批注和 1102px。运行态 DOM 确认工具栏是滚动区的同级元素、正文 `overflow:auto`、外层 `overflow:hidden`、PDF 状态行位于页面之后。截图：`.codex-acceptance/redesign-20261111/material-layout-pdf-live-20261112.png`。

本轮验证：`pnpm exec node --test tests/e2e-smoke.test.js` 33/33 通过；`pnpm check` 通过；`git diff --check -- prototype/index.html prototype/app.js tests/e2e-smoke.test.js` 通过。仍未完成：在同一 Electron 会话切换到另一份附件并返回；关闭并重新启动 Electron 进程后核验 PDF 状态。故 Task 4 整体及 Task 5 仍保持未完成。

2026-11-12 当前源码 Electron 复核：renderer 首次重载曾因资料库旧 `#knowledge-detail` 容器已删除、但 `app.js` 仍无条件绑定其事件而中断初始化。已将旧监听改为可选绑定；当前资料卡“用于写作”交接仍由资料列表处理器承接，并在 `tests/e2e-smoke.test.js` 增加回归断言。定向 smoke 34/34 通过，`pnpm check` 通过。修复后 Electron renderer 重载、从“我的计划”恢复任务没有新增运行时异常；双栏→专注查看→双栏实测保留第 2/2 页、125% 缩放、已选批注，并分别恢复 132px/1102px 滚动位置。切换附件再返回也恢复原视图状态。

当前源码的 PDF 绘制仍未通过：附件 SHA-256 与固定两页样本一致，PDF.js 6.4.299 legacy 的 `getDocument` 和 `getPage` 均返回；但 `page.render()` 持续未完成，画布像素仍为白色，状态文案一直显示“正在渲染 PDF 页面…”。因此本次只通过了任务/A-C 状态恢复，不把 PDF 实际查看记为通过；Task 4 的进程级关闭重启、Task 5 与 PDF 绘制问题继续未完成。

2026-11-13 后续实现复核已替代上段旧渲染结论：现版切换到复用依赖的 `PDFViewer` 后，固定单页与两页样本均在 Electron 真窗口生成 canvas；单页与两页均完成 100%→125%→100% 重绘，两页前后翻页、状态栏、附件切换及关闭并重启 Electron 后重新打开任务恢复第 2/2 页和 125% 已验证。截图与逐项结果见[资料能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)。本次没有重新验收 A/C 中选中批注与滚动位置的全组合，也没有完成文字锚点批注闭环、正式包 worker 和阶段 A Task 5，因此相关任务不据此勾选完成。

### Task 5：完成阶段 A 视觉与窗口验收

**Files:**
- Modify: `prototype/index.html`、必要时 `prototype/app.js`
- Test: `tests/e2e-smoke.test.js`、`tests/electron-smoke.test.js`

- [x] 检查常用桌面窗口缩放、窄窗、键盘焦点、弹窗关闭、空白首页和任务进行中状态；不以移动端网页布局替代桌面窗口检查。
- [x] 在 Electron 开发窗口确认七个入口、A/C 互切、文件选取入口可见，且开发者工具无新增错误。
- [x] 运行 `pnpm check` 与相关 smoke 测试；写入阶段验收结果后才开始阶段 B。

2026-11-13 查看器局部实现：独立横向文件标签、按需展开批注面板、宽区并排/窄区覆盖、Escape 焦点返回、A/C 面板状态保留与来源跳转已实现。添加/网页/移除/恢复集中于“更多”，删除重复可见添加入口。Office canvas 保持原始比例，正文使用单层文件滚动。Electron 1267×799 和 900×799 真窗口通过，相关 135 项回归通过；见 `.codex-acceptance/redesign-20261113/viewer-layout-fix/VERIFICATION.txt`。标签关闭/重开、真实适合窗口缩放和全量状态/正式包验收尚未完成，Task 4/5 保持原验收状态。

2026-11-13 后续标签实现已替代上段“标签关闭/重开未完成”的结论：标签关闭只更新任务查看状态，关闭当前选相邻，全部关闭回到对话和输入焦点；对话资料卡、更多菜单与提示词来源可重开，保留页码/缩放/滚动，旧任务兼容。新字段随存储和备份往返。206 项相关测试与 Electron 7 份附件/11 条批注不变、全关闭→重载→对话重开 PPT→来源重开 DOCX 均通过。记录 `.codex-acceptance/redesign-20261113/viewer-tabs-fix/VERIFICATION.txt`。批注编辑中未保存选区跨标签与本轮标签主进程完整重启仍未验收，Task 4/5 不整体勾完。

2026-11-13 适合窗口复核：`fit` 模式已改为按当前资料真实尺寸和正文可用区域计算比例，允许小于 50%；手动缩放保留用户比例，`zoomMode` 随备份恢复。Office 复用现有 `@silurus/ooxml` 缩放接口，PDF 复用现有 `pdfjs-dist` `page-fit`，图片按原始像素尺寸适配。补充修复 PDF 初始化首屏事件覆盖已保存第 2 页的问题。隔离 Electron 四格式、A/C 切换、900×799 窄窗、批注标记与手动缩放均通过；65 项定向回归、`pnpm check` 和差异检查通过。记录 `.codex-acceptance/redesign-20261113/viewer-fit-fix/VERIFICATION.txt`。Task 5 仍不整体勾完，复杂格式、七板块全量、在线模型和 NSIS/portable 包继续待验收。

2026-11-13 Task 4 发布包复验：真实双页 PDF 在专注查看→双栏时，PDF.js 重复设置同一页使滚动从 1554px 回到 1288px；专注对话隐藏资料时，零位置滚动事件也会覆盖已保存位置。现保存重建前 PDF 滚动快照、避免重复翻到同页，并在专注对话期间忽略隐藏资料区的滚动保存。两项回归在旧版均失败、修改后均通过，相关测试 68/68、`pnpm check` 通过。隔离 `win-unpacked` EXE 实测第 2/2 页、120%、1542px 和选中批注/文字标记在两种专注模式、跨附件切换与完整进程重启后保持一致；Task 4 剩余 PDF 组合项已勾选。截图和详细步骤见 `.codex-acceptance/redesign-20261113/task4-pdf-20261113/VERIFICATION.txt`；Task 5 与阶段 D 正式 NSIS/portable 全流程仍未验收。

2026-11-13 Task 5 继续：隔离 Electron 开发页已逐项打开七板块/十个导航入口，空白首页只露自然语言输入，运行时错误 0。工作台在 960×720 与 1280×800 页面视口模拟下无横向溢出；A/C 三态与页签可切换，资料菜单的本地文件入口及提示词页签的添加资料入口可见。修正窄窗“复制提示词”换行、发送预览缺少焦点接管和 Escape 关闭；相关测试 54→55 项、`pnpm check` 通过，回退在隔离副本验证。此处为 Electron 渲染页视口模拟，不是原生窗口改变尺寸或系统缩放；当前桌面会话未枚举到原生窗口，Task 5 保持未勾选。记录见 `.codex-acceptance/redesign-20261113/task5-desktop-20261113/VERIFICATION.txt`。

2026-11-13 Task 5 原生 Electron 补验完成：在 3200×2000、Windows 显示缩放 200% 的桌面上，用同一个隔离 Electron 原生窗口实际调整到 1280×860 与 960×700 窗口逻辑尺寸，独立窗口边界读回分别为 2538×1709 与 1898×1389 屏幕像素；两种尺寸均实测布局和滚动，窄窗无横向溢出。原生窗口真实走完双栏→专注对话→专注查看→双栏，UIA 树分别确认对话/预览组隐藏与恢复，任务不变。新任务页仅保留自然语言输入、资料入口和最近计划。实际打开 Windows 资料选择器（HTML/PDF/Office/图片过滤）后按 Esc 取消，未导入文件；更多菜单也由 Esc 关闭。既有焦点测试确认发送预览聚焦文本框、Shift+Tab 回到复制按钮、Esc 关闭并还焦；本次实际 Electron DevTools 复核显示 `0 messages in console`。`pnpm check` 退出码 0；`pnpm exec node --test tests/e2e-smoke.test.js tests/electron-smoke.test.js` 为 53/53 通过、0 失败；输出仅有既有 `buildKnowledgeContext` 循环依赖警告。详见 `.codex-acceptance/redesign-20261113/task5-desktop-20261113/VERIFICATION.txt`。本机只验证了当前 200% Windows 显示缩放，未改系统设置比较其他缩放档位；阶段 A Task 5 的窗口尺寸与界面验收完成，阶段 D 安装/portable 全流程仍独立待验收。

