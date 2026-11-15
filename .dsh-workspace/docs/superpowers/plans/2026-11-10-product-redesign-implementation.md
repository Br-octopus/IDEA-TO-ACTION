# 全产品界面重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成「向前一步」Windows Electron 桌面端 EXE 的七板块界面重设计，并交付跨资料批注生成修改提示词的可验收工作流。

**Architecture:** 以仓库根目录现有 Electron 窗口和 HTML/CSS/JavaScript renderer 为唯一实施目标。保留当前业务模块、用户数据与 Electron 安全边界；先重组导航/工作台，再统一真实资料定位与批注，随后整理七板块的数据交接，最后在 Windows 安装包和 portable 包中验收。

**Tech Stack:** Electron 38 系列、Node.js、HTML/CSS/JavaScript、Electron preload/IPC、Node 内置测试、已有 `pdfjs-dist` 6.4.299、electron-builder。

---

## 目标边界与入口

本计划修改仓库根目录的「向前一步」。`package.json` 的入口是 `electron/main.js`，`prototype/index.html` / `prototype/app.js` 是浏览器开发与 Electron 共用的 renderer；`electron/main.js`、`electron/preload.js` 管窗口和受控 IPC；`pnpm dist:win` 生成 NSIS 安装包与 portable `.exe`。`.dsh-workspace/dsh-plugin/forward-step-dsh` 是另一套 DSH 插件，不在本计划范围内。

阶段 A–D 的分项记录保留为历史需求/验收索引，不作为当前待办；已通过项不重复验收。

| 记录 | 内容 |
| --- | --- |
| [A 导航与工作台](./2026-11-10-product-redesign-01-workspace.md) | 首页、Agent 对话、A/C 布局 |
| [B 资料查看与批注](./2026-11-10-product-redesign-02-annotations.md) | 文件/网页预览、定位批注、提示词 |
| [C 七板块业务衔接](./2026-11-10-product-redesign-03-pages.md) | 资料库、收藏、写作、研究、记忆、设置 |
| [D Windows 交付](./2026-11-10-product-redesign-04-acceptance.md) | 备份兼容、NSIS 与 portable |


## 当前实施入口（2026-11-15 布局设计补齐后）

**当前进度（2026-11-15）：** 本轮新增计划共 7 项顶层任务。任务 1–6 的实现、针对性测试与计划内分组提交已完成；当前 29 步中 28 步完成，仅剩任务 7 Step 2 的 Electron 三段连续操作。HTML 原生 `WebContentsView` 仍报告 `0×0`，两条针对性路径未解决后已停止重试；该能力保持未完成。具体命令和结果见[桌面工作台布局与对话选择实施计划](./2026-11-15-desktop-workbench-layout.md)。未运行全量回归、重复在线模型验证或打包。

最新计划覆盖下文及旧阶段 A 中关于默认双栏、自动展开预览和禁止选项的旧规则。以正式设计第 3.4、3.5、12.1 节为准：默认专注对话，用户主动打开预览，Agent 必要时在对话中给出少量情境选项。已有跨格式查看、批注和其他板块业务继续复用，不重复实施。

## 本轮布局设计之前的完成记录（2026-11-15）

**此前一轮剩余任务：0 项。** 此结论仅对应以下历史交付，不包含上面的 7 项新增布局与交互任务。

**视觉批注依据已完成：** 对已选、当前版本的点/框/箭头/画笔批注，生成提示词时会列出需附的原图或对应页/幻灯片的区域图与整页图，并说明纯文本没有附带图像；缺图时要求用户补充并确认目标区域的文字描述。

**已完成：** 七板块主要流程、批注保存/定位/冲突处理、提示词生成与版本、数据/备份任务；2026-11-15 已在隔离 Electron 用户目录启动 portable 与 `win-unpacked` EXE，并确认显示工作台及七板块导航。此前默认端口冲突通过隔离用户目录解决，没有停止或连接现有 DSH 服务。

**不计入本次交付待办的能力边界：** 在线动态网站及外链脚本维持受限静态快照；旧版 `.doc` / `.ppt` 不支持；复杂 Office 版式的保真度未作全面承诺。视觉图片不会随纯文本复制自动上传，用户需在目标 AI 中附上清单所列原图/页图；本应用不把文本提示描述成已附图。若以后需要自动图像传输，再单独立项。

**本轮最小验证：** `node --test tests/ppt-feedback.test.js`，19 项通过。未重跑全量测试、全格式矩阵或逐板块走查。后续只对改动直接相关的路径做定向验证；除非改动影响打包内容，否则不重打安装包。

**本轮产物：** `.codex-acceptance/redesign-20261115/html-preview-final/ForwardStep-0.1.0-setup.exe`（SHA-256：`91469A513F88B810360EDE464B00D70DB745C1AE9186AC821984220977389498`）；`ForwardStep-0.1.0-portable.exe`（SHA-256：`3BB6A9B2366A105B2748592CE59DEA1610F78C46881747A979316D01061CB0E1`）。`prototype/app.js` 打包前后 SHA-256 均为 `af572fa4046330bb928aa3274848971c4cfa2700e5737276b553ee0b88f2f8e5`。

`gpt-6-sol` 在线对话与其他阶段沿用既有记录；本轮不重跑相关验收。

## 现有实现事实与文件职责

| 位置 | 职责 / 计划约束 |
| --- | --- |
| `prototype/index.html`、`prototype/app.js` | 现有页面、导航、renderer 行为；按七板块重组，不创建另一套应用 shell |
| `prototype/ppt-feedback-schema.js`、`ppt-feedback-ui.js`、`ppt-feedback.js` | 现有 PPT/附件反馈数据与 UI；先保持兼容，再扩展通用资料批注生命周期 |
| `prototype/writing-workbench-*`、`writing-pack-*` | 既有写作工作台与专业包；新布局继续使用原流程/数据 |
| `prototype/academic-*`、`social-research-*` | 既有研究领域逻辑；整理呈现，不混并领域数据 |
| `prototype/knowledge-search.js`、`local-source-index.js`、现有 `references` 视图 | 资料查找与来源能力；新资料库传递稳定 ID/版本 |
| `prototype/workspace-backup.js`、`backup-manager.js`；`electron/backup-store.js`、`workspace-backup-archive.js` | 现有备份、恢复与附件数据路径；不另建存储格式 |
| `electron/main.js`、`electron/preload.js`、`electron/settings-store.js` | Electron 窗口、受控 IPC 与设置/安全存储；renderer 不直连任意本地文件系统 |
| `server/web-page-reader.js` | 网页读取边界；网站快照、来源版本和失败信息需真实验证 |
| 根目录 `tests/` | Node 内置测试及 Electron/资料/流程 smoke；按功能选择最小相关套件 |

具体目标文件以各阶段当前代码校准。只在新增契约需要时修改共享模块；不把计划扩散到插件副本或引入重复的路由/状态框架。

## 用户要求的验收映射

| 设计要求 | 阶段与关键验收 |
| --- | --- |
| 首页干净，Agent 在对话中按想法给单条建议 | A Task 3：首页不常驻字段；Agent 自行比较、按用户目标与约束取舍后，只给一条推荐，用户自然语言确认或修正；缺少关键上下文时只追问一个问题，不把候选方案比较或逐项填写交给用户 |
| 同一工作台 A＋C | A Task 4：双栏/资料专注/对话专注互切且任务状态不重置 |
| 文件查看器呈现真实资料 | B Task 6–9：图片、PPT、文档、HTML、网页逐格式验证和标示限制 |
| 多类型、多条批注能定位对象 | B Task 10–12：文本/页面/区域/元素锚点、版本状态、保存、编辑、撤销、重定位 |
| 批注主要用于生成修改提示词 | B Task 13–14：只选择有效批注，输出可编辑、可复制且不覆盖手改稿 |
| 七个板块各自布局与业务流程 | A Task 2、C Task 15–21：既有 view 映射到七板块并保留业务操作 |
| 跨板块结果不丢 | C Task 15–21：资料 ID、正文、来源、版本和批注快照随交接传递 |
| Windows 桌面 EXE 可交付 | D Task 22–24：隔离数据、真窗口、NSIS/portable 产物及回退均有证据 |

## 执行与验证约定

1. 保留已有工作区改动，只修改当前未完成项涉及的文件。
2. 默认只跑本次改动直接相关的定向测试；纯文档修改不跑代码测试。通过且代码未再变化的检查不重复执行。
3. Windows 交付只在代码变化后构建 NSIS/portable，并核对产物与包内关键文件；不为已验收阶段重跑全量测试或逐页走查。
4. 真实格式/网站能力按已验证边界描述；静态网页快照不代表动态网站支持。
5. 破坏性操作仅使用副本和隔离用户目录，保留原始数据与回退包。
## 开源复用和能力关口

源码固定提交、许可证及适配判断见[界面设计自查与开源复用依据](../specs/2026-11-10-design-audit-and-reuse.md#4-github-复用依据与边界)。实施中可借鉴 Hypothesis 的多级文本定位、Annotorious 的批注生命周期/撤销、PDF.js 的坐标和笔迹保存思路。优先用根目录已有 `pdfjs-dist`；不默认加入 React 整包或第二份 PDF.js。直接复制代码前须核查许可证、保留署名、依赖和打包清单。

办公室格式转换、网站捕获、PDF worker 和跨版本锚点均为能力关口：记录真实输入、结果和失效行为；未过关的格式如实标示，不能以空白页、抽取文本或示例页面宣称已支持。

## 自查记录

- 本次依据根目录真实 Electron 工程修订目标、技术栈、文件路径、测试命令与 Windows 交付方式。
- 本次没有实施产品代码，也没有运行 Electron/真实文件/安装包验收。
- 设计方案和完整缺口映射见：[全产品页面设计](../specs/2026-11-10-product-interface-redesign.md)、[跨资料批注工作台](../specs/2026-11-10-annotated-workbench-design.md)、[功能流程](../specs/2026-11-10-product-functional-flows-design.md)、[实施计划自查](../specs/2026-11-10-implementation-plan-audit.md)。

## 当前实施进展（2026-11-11）

- 2026-11-11 阶段 C Task 15 资料库：修复旧控件绑定与重复表单提交，资料详情折叠显示，并打通资料 ID/版本快照到当前工作台任务；恢复/删除依赖确认沿用现有实现。18 项资料/快照/写作交接定向测试、2 项资料库 e2e 结构测试与 `pnpm check` 通过。文件路径、网页抓取时间、格式能力元数据仍未建模，且尚未完成 Electron 真窗口验收；阶段 C 后续任务与阶段 D 未完成。
- 2026-11-11 阶段 C Task 16 提示词收藏：确认并复用已有收藏列表、完整正文、变量填写与缺失拦截、版本对比、案例/方法卡子页及提示词来源快照。修复提示词带入工作台时自动请求模型的问题，改为保存包含 ID/版本/替换后正文的可编辑会话草稿，需用户手动发送才调用 Agent。收藏 e2e 2 项、对话/提示词 20 项、`pnpm check` 通过；Electron 真窗口验收仍待完成。详见[阶段 C 页面计划](./2026-11-10-product-redesign-03-pages.md)。
- 2026-11-11 阶段 C Task 17 写作页：新增稿件中心默认布局，集中显示当前稿、来源、保留要求、专业包和修改轮次；待比较新稿提供直接采用/保留操作，完整编辑工具折叠但保留原交互；引导流程与稿件中心可双向切换。后续复用同一写作向导打通资料库与提示词收藏交接：来源正文、ID、版本和 URL 有界快照传递，用户显式勾选材料，提示词仍走既有变量预览。批注、资料库、收藏三类交接 UI 定向测试 3 项通过；schema 49 项、提示词 50 项、e2e-smoke 29 项及 `pnpm check` 通过。完整写作 UI 套件的 2 项备份导入状态断言仍不匹配当前真实文案，Electron 真窗口走查未完成。详见[阶段 C 页面计划](./2026-11-10-product-redesign-03-pages.md)。

- 阶段 A 的工作台对话、首页资料入口和 A/C 任务布局已有代码及 Edge/Electron 隔离窗口验证。2026-11-11 补验确认 Electron 关闭重开并从“我的计划”恢复后，草稿、布局和预览页签保留；目标回归测试 69 项通过，`pnpm check` 与 `git diff --check` 通过。真实模型在线建议响应、真实 PDF 页面状态跨模式/重启，以及完整桌面视觉验收仍未完成，详见[阶段 A 计划](./2026-11-10-product-redesign-01-workspace.md)。
- Edge 实测发现并修复任务切换时隐藏查看器覆盖滚动位置的问题；任务 A 的缩放与滚动在切换至 B 后返回可恢复，A/C 切换保留对话草稿。
- 本轮针对性验证：`node --test tests/storage.test.js tests/workbench-dialogue.test.js`（44 项通过）；`node --test --test-name-pattern="打开任务时先显示工作台再恢复资料滚动位置" tests/e2e-smoke.test.js`（1 项通过）；浏览器通过 Edge + 模拟模型/附件 API 验证交互，没有用模拟结果代替真实模型验收。
- 阶段 B 的 Task 6、7 已有能力盘点和针对性测试证据；Task 8 在隔离 Electron 中验证 PNG 重启恢复、单页 PDF 渲染/缩放、两页 PDF 翻页与点批注恢复，以及真实区域拖动、renderer 重载后重开任务和区域落点恢复。PDF.js 使用现有 6.4.299 legacy 主模块/worker 兼容 Electron 38.8.6 / Chromium 140。
- 阶段 B 新增 HTML 文字锚点恢复/IPC 往返及图片/PDF 箭头、画笔批注：锚点上下文保护、附件 hash 与主 frame 校验、绘制坐标校验/保存重开及提示词定位均有自动测试；当前相关 63 项测试与 `pnpm check` 通过。HTML“回到原处”按钮和新绘制工具仍缺真实窗口操作验收。DOCX/PPTX 已复用 MIT `@silurus/ooxml@0.89.9` 接入页面渲染与文字/元素选区回调；真实窗口批注保存、提示词纳入、重开定位及正式包仍未验收。阶段 B 仍缺网站完整闭环和正式包 PDF worker 验收；阶段 C/D、NSIS/portable 实包验收及阶段 A 真实模型在线响应仍未完成。详见[阶段 B 计划](./2026-11-10-product-redesign-02-annotations.md)与[能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)。
- 2026-11-11 完成阶段 B Task 14：手改稿覆盖确认与提示词引用快照已锁定；工作区 ZIP 往返校验资料引用、正文哈希、批注、手改稿和历史；Electron 导入事务的重启恢复按已持久化状态回滚或保留。Task 14 定向测试 60 项、Electron/e2e smoke 59 项、`pnpm check` 与 `git diff --check` 通过。阶段 B 仍有网站完整闭环、Office 批注重开定位及正式包 PDF worker 等未完成项；真实窗口中的 HTML 跳转、批注绘制/撤销、提示词覆盖确认和重新关联仍待验收。阶段 C/D 与 NSIS/portable 实包验收仍未完成。
- 2026-11-11 完成阶段 B Task 11 的批注元数据与历史操作自动验收：编辑保留创建时间并更新更新时间；撤销/重做最多保留最近 20 步，批注保存失败不推进历史；工具切换、指针取消、删除确认及保存失败提示均有 smoke 覆盖。Task 11 目标测试、`pnpm check` 和 diff 检查通过；真实 Electron 窗口中的工具与撤销/重做仍待验收。
- 2026-11-11 阶段 B Task 12 完成批注保存失败保留草稿、版本状态提示及重新关联/移除主流程：同哈希新建来源关联并沿用原定位；异哈希或原资料缺失时必须在当前资料重新定位，原批注和锚点不覆盖；关联来源 ID 随工作区 ZIP 往返；移除确认列出当前任务、批注数及引用该资料的提示词版本摘要。100 项定向测试、`pnpm check` 与 diff 检查通过。重新关联与移除确认仍待真实 Electron 窗口操作验收。
- 2026-11-12 阶段 C Task 18 学术/社媒流程复核：复用现有领域模块与 Agent 推荐路径；失败时阻止采集并保留输入，取消/部分结果与来源状态有真实 UI 映射。定向 199 项测试中 198 通过、1 项环境跳过，`pnpm check` 与 diff 检查通过；Electron 真窗口视觉走查仍待完成。
- 2026-11-12 阶段 C Task 19 “我的计划”：补计划搜索、状态、可恢复归档、影响预览和原 ID 恢复；首页最近任务排除归档项，并取消创建第 41 个计划时截断旧记录。定向测试 74 项通过，包含 45 条计划的存储往返，`pnpm check` 通过；真窗口确认框操作仍待验收。阶段 C Task 20–21 与阶段 D 未完成。

## 当前实施进展（2026-11-12 补记）

2026-11-13 多页 Office 绘制补验：根目录 renderer 修复绘制批注保存页码、绘制批注定位入口、Office 初始化覆盖恢复页码和修改提示词来源页码跳转。两页 DOCX/PPTX 通过系统文件选择器导入、真实鼠标绘制、第 1/2 页隔离、PPTX 撤销重做、A/C 切换、renderer 重载与完整隔离 Electron 重启恢复。132 项定向回归与 pnpm check 通过；基线/修复/副本回退及真实窗口证据位于 .codex-acceptance/redesign-20261113/office-drawing-fix/。未扩大为复杂 Office 或正式包通过。窗口走查仍观察到多资料按钮和网页入口占用预览高度，工作台视觉收敛继续待做；阶段 C/D、在线模型和完整格式验收继续保持未完成。

2026-11-13 Office 补验：继续直接复用 PDF.js / @silurus/ooxml，修复拖选中途重建、保存后待提交草稿残留及异步资料刷新持有旧任务对象的问题。DOCX/PPTX 单页样本已完成鼠标拖选→保存→提示词→renderer 重载重开→原文唯一高亮；持久化引用快照已核对。107 项定向回归、pnpm check 通过。阶段 B/D、复杂多页真实样本、Office 元素/绘制、完整进程重启与正式包资源验收仍未完成，完整目标不变。具体样本、hash、操作、证据和回滚见桌面 EXE 验收记录的 Office 补验小节。

- 阶段 B 后续 PDF 源码更新：继续复用项目已有 PDF.js，渲染入口切换为 `PDFViewer`，并增加 PDF 文本锚点与选区批注代码；定向 82 项自动测试通过。旧 `page.render()` 白屏是前一版证据；现版尚未重新进行 Electron 真窗口渲染/选区验收，阶段 B Task 8 仍未完成。Office 已接入 `@silurus/ooxml@0.89.9` 的 DOCX/PPTX viewer 与选区回调，DOCX/PPTX 样本页面窗口截图已有；保存/提示词/重开定位闭环和正式包路径仍待验收。
- 阶段 C Task 15 资料库来源元数据：复用写作材料现有的相对路径、来源 URL、访问时间、格式/解析方式、页数及附件要求，落入资料条目详情与备份 schema；本地路径拒绝绝对路径和目录穿越。网页读取成功返回 MIME 与抓取时间，用户选入摘录后才随资料保存。资料/写作/网页读取/备份/e2e 定向测试共 229 项通过，`pnpm check` 和 `git diff --check` 通过。原有条目未补造历史信息；完整预览/批注能力矩阵仍在阶段 B/D 验收。
- 阶段 C Task 20 记忆与偏好：复核用户确认的 `writingMemories`、候选状态、任务轮次临时偏好和 Electron 模型连接设置的分界；复用现有管理页与任务级影响/跳过流程。工作台/e2e 112 项通过，覆盖候选需确认、编辑/启停/恢复、任务实际采用及单篇跳过。
- 阶段 C Task 21 设置：复用 `safeStorage` 与现有 JSON/ZIP 导出导入事务，补全设置分类、冲突预览和取消/恢复检查。设置、备份/归档 63 项通过；“迁移”现阶段仅支持本应用自身备份格式，不支持插件数据或未定义旧格式。
- 阶段 B Task 9 静态网页快照/DOM 批注已有代码与自动化覆盖：受限读取 HTML 并绑定 URL、抓取时间、HTML SHA-256；隔离预览静态呈现并阻断脚本/外部资源；文字/元素定位、保存、提示词纳入和版本绑定由 37 项定向测试覆盖。全套 `pnpm test` 为 1217 项通过、1 项环境跳过。修复 IPC 可克隆返回值后的真实 Electron 窗口尚未复验；IANA 旧截图不作为修复后证据。动态网站/外链资源未完成；Office 查看与选区代码已复用依赖接入，但端到端批注/打包验收未完成，Task 9 保持未完成。
- 阶段 D Task 22 已用临时目录夹具验证旧任务、多附件、点/区域批注、提示词手改与历史、写作稿件/偏好、凭证剔除及 ZIP 往返；Electron IPC 暂存后取消会逐字节保留现有附件、批注和设置文件。相关归档/IPC 18 项、备份/设置 53 项、导入预览 1 项通过，`pnpm check` 和目标 `git diff --check` 通过。证据见[桌面 EXE 验收记录](../acceptance/2026-11-10-desktop-exe-acceptance.md)；测试用 safeStorage 替身不代表 Windows 原生加密。
- 上述自动化与 `pnpm check` 不能替代 Electron 真窗口验收。阶段 C 主路径记录、复杂多页 Office、阶段 A 在线模型响应以及阶段 D 真实样本和 NSIS/portable 包仍未完成。静态网页和单页 Office 最新局部证据见下方补记，不扩大为全部格式通过。

### 2026-11-13：静态网页闭环与工作台状态修复

- 阶段 B Task 9 的公开静态网页样本已走通：读取 Example Domain → 隔离预览中真实鼠标选择文字/元素 → 两条独立批注 → 修改提示词引用 → 返回原处 → 完整 Electron 进程重启后恢复与原文定位。取消元素批注勾选后，提示词只纳入仍选中的文字意见，A/C 切换保持选择。
- 复用已有 HTML 主文档批注监听和定位，移除快照预览中的嵌套 iframe；继续净化脚本/事件属性并阻断外部资源。没有新增依赖。修复保存滚动后持有旧任务对象的问题，覆盖资料、布局、页码、缩放、PDF 定位，以及文件选择/网页读取/移除恢复等待期间的结果落盘。
- 定向回归 154 项通过；随后新增来源栏不创建正文批注的测试，8 项 HTML 测试通过；10 项状态回归在基线全部复现失败、修复后全部通过。`pnpm check` 通过。副本回滚哈希与基线一致，产品保留修复，命令和输出见 `.codex-acceptance/redesign-20261113/web-snapshot-fix/VERIFICATION.txt`。
- 完整进程重启也核对了既有 DOCX/PPTX 批注记录、选中状态和提示词引用；DOCX 缩放 125% 恢复。复杂多页 Office、Office 元素/笔迹真窗口、动态网页/外链资源、七板块完整路径、在线模型与正式安装包保持未完成。对话继续遵循阶段 A 的单条推荐设计，本轮没有引入 React 交互框架或多选菜单。
- 继续修复其他资料有效批注被误标为版本失效的界面提示，并复用资料切换入口提供“查看原资料”；新增行为测试与状态/e2e 共 54 项通过，真实窗口点击可打开原 DOCX。阶段 C 已完成一条网页 → 批注 → 提示词 → 写作 → 显式开启本机保存 → 重载重开路径，4 份来源/6 条快照及未选项排除均核对；实际对象 ID 见阶段 C 计划。没有把未配置模型的任务分析失败算作在线成功。

## 2026-11-13 查看器布局收敛

- 继续复用已有 PDF.js、Office viewer、批注和 IPC，不增加依赖。`prototype/app.js` / `prototype/index.html` 将资料移到独立横向标签行，添加网页与移除/恢复放入“更多”；批注列表默认收起、独立滚动，宽查看区并排显示、窄查看区按需覆盖。
- 展开批注列表保留现有文档 viewer；A/C 互切保留面板状态；提示词来源入口先打开面板并恢复页码。Escape 返回入口焦点；关闭菜单后不会因旧 DOM 的延迟 toggle 事件再次打开。
- 修复 Office canvas 的 CSS 横向压缩，以及文档正文内外两层竖向滚动；新增布局测试 3 项，相关回归 135 项、`pnpm check` 与相关 `git diff --check` 通过。
- Electron 隔离窗口 1267×799 / 900×799 实测：工具栏约 227→52px，正文约 169→284px；七标签横向滚动、菜单不越界、批注来源定位、Office 页面比例均通过。证据 `.codex-acceptance/redesign-20261113/viewer-layout-fix/VERIFICATION.txt`，原始文件、副本差异及可执行回退脚本同目录。
- 标签关闭/重开、真正适合窗口缩放、全格式及七板块完整验收、在线模型和正式包仍未完成；本轮不据此整体勾完阶段 A/B/D。

## 2026-11-13 标签关闭与重开

- 已补齐前一轮的标签关闭缺口：关闭当前标签优先切右侧、末尾切左侧；全部关闭回到对话。关闭只保存 `workbenchClosedAttachmentIds`，附件、批注、提示词和查看状态不删除。异步刷新不会自动重开全部已关闭资料。
- 对话内“任务资料”与查看器“更多→已关闭的资料”可重开；提示词来源、批注定位、添加资料和移除恢复复用同一打开逻辑，保留其他资料关闭状态。备份白名单保留新字段，旧任务默认全部打开。
- `tests/workbench-tabs.test.js` 8 项；相关状态/绘制/批注/存储/备份/界面共 206 项通过；`pnpm check`、相关 `git diff --check` 通过。副本基线 8 项失败、修改 8 项通过、回退恢复原哈希并重现基线。
- Electron 实测 7 份附件全部关闭、回到对话、renderer 重载后保持关闭与未发送草稿、从对话重开 PPT 恢复第 2 页、从提示词来源重开 DOCX 恢复第 2 页。7 份附件与 11 条批注前后 JSON 一致。证据 `.codex-acceptance/redesign-20261113/viewer-tabs-fix/VERIFICATION.txt`。
- 未保存批注选区跨标签、真正适合窗口缩放、本轮标签完整主进程重启、复杂格式、全七板块、在线模型与正式包仍未验收，不整体勾完阶段任务。

### 2026-11-13：适合窗口与 PDF 第 2 页修复

- 工作台沿用现有 Office viewer 与 PDF.js：DOCX、PPTX、PDF、图片按实际窗口适配；PDF 在缩放事件期间保留第 2 页，并在 PDF.js 后续页面初始化完成后才销毁旧查看器。隔离可见 Electron 窗口完成四格式预览→双栏→对话→预览、窄窗口和手动缩放检查，PDF `pageIndex: 1`、运行时错误为 0；原始数据见 `.codex-acceptance/redesign-20261113/viewer-fit-fix/LIVE_VERIFICATION.json`。
- 定向 66/66 与后续 43/43 测试通过；全量 `pnpm test` 为 1327 通过、1 环境跳过、0 失败，`pnpm check` 通过。修改副本 11/11、回退副本 0/11（预期）及差异见同目录 `VERIFICATION.txt`。七板块完整路径、在线模型、复杂文件和 NSIS/portable 正式包仍待验收。

### 2026-11-13：未保存批注跨资料标签

- `prototype/app.js` 按当前任务的资料 ID 暂存未保存批注意见、工具与 HTML/PDF/Office 选区；切换标签或关闭后返回原资料时恢复，不把意见带到另一份资料。选区只在来源 ID 与内容哈希仍匹配时恢复；版本变化保留可编辑意见，但需要重新选择内容。此草稿仅在本次运行内保留，不纳入已保存批注或跨进程恢复。
- 两份 Office 样本的 Electron 窗口输入并来回切换意见通过；进一步以真实鼠标在 PPTX 第 2 页划选“表格兼容性验收”，切到 DOCX 不串选区，返回 PPTX 原文与意见恢复。版本变化仍由定向测试覆盖，DOCX/PDF/HTML 的真实跨标签选区尚待验收。定向 87/87；全量 `pnpm test` 为 1329 通过、1 跳过、0 失败；`pnpm check` 通过。原始副本 8/10、修改副本 10/10、回退副本 8/10，证据见 `.codex-acceptance/redesign-20261113/annotation-tabs-fix/VERIFICATION.txt`。

### 2026-11-13：DOCX 同节点文字拖选补验

- DOCX 第 2 页拖选指针事件能到达原文节点，但旧查看器未建立原生 Selection；从现有 Office 回调处最小补偿同节点跨字符拖选，普通点击和已有原生选区仍沿用原行为。真实 Electron 窗口通过 DOCX `SE` 及 PPTX “表格兼容性验收”拖选、切换附件与返回恢复。`pnpm test` 为 1330 通过、1 环境跳过、0 失败，`pnpm check` 通过；10 项定向测试通过，副本 9/10 失败→10/10 通过→回退恢复 9/10。完整证据见 `.codex-acceptance/redesign-20261113/office-drag-fix/VERIFICATION.txt`。跨文字节点拖选、PDF/HTML 跨标签、正式 EXE 等不据此标记通过。

### 2026-11-13：DOCX 同页跨片段拖选

- 在 Office 现有文字选区补偿中，增加同页文字层跨节点正向/反向定位，跨页和空白端点不自动建立选区。隔离 Electron 实测 DOCX `SECOND PA` 正向与 `OND PA` 反向拖选，切换到 PPTX 再返回后原文恢复；PPTX 原有选区回归通过。10 项定向测试通过；全量 `pnpm test` 为 1330 通过、1 环境跳过、0 失败，`pnpm check` 通过。副本基线 9/10、修改 10/10、回退 9/10；证据见 `.codex-acceptance/redesign-20261113/office-cross-run-fix/VERIFICATION.txt`。复杂多段 DOCX、PDF/HTML 真实跨标签和正式包仍需验收。

### 2026-11-13：PDF/HTML 未保存选区跨标签与版本边界

- 复用已有的资料 ID/哈希和 per-attachment 草稿缓存；修复同一标签附件版本变化时旧 PDF/HTML/Office 选区仍保留到点击保存的问题，清理失效定位但不清理未提交意见。PDF 与 HTML 各新增跨资料恢复、版本变化回归测试。测试副本基线 11/13、修改 13/13、回退 11/13；PDF/HTML 锚点及工作台相关共 35 项通过，全量 `pnpm test` 1333 通过、1 环境跳过、0 失败，`pnpm check` 通过。隔离 Electron 真窗口用鼠标实际拖选 PDF `Synthetic` 与网页静态快照 `This doma`；切换资料后二者各自保留选区和意见，不串稿。证据见 `.codex-acceptance/redesign-20261113/pdf-html-cross-tab-fix/VERIFICATION.txt`。真实窗口没有模拟文件版本替换；该边界仅由自动回归证明。复杂网站、在线模型、七板块全流程和正式 NSIS/portable 包仍待验收。

### 2026-11-13：阶段 A Task 3 真实模型验收

- Edge 与独立用户目录启动的打包 EXE 均用真实 `gpt-6-sol` 完成首页发起任务→Agent 单条建议及理由→用户在对话中确认→修改提示词纳入确认方向→Agent 继续回复。Edge 刷新和 EXE 完整退出重启后均保留 4 条对话及提示词；EXE 进程与隔离测试凭证已清理。Task 3 的两条在线验收已勾选；不据此补勾 Task 4/5、复杂资料或阶段 D 全流程。证据见[桌面 EXE 验收记录](../acceptance/2026-11-10-desktop-exe-acceptance.md)。

### 2026-11-13：阶段 A Task 4 真实 PDF 组合验收

- 修复 PDF.js 重建时重复翻到同一页、以及专注对话隐藏资料时的零滚动覆盖；不改附件/批注存储。两条新增回归在原版均失败、修复后均通过，相关 68 项与 `pnpm check` 通过。隔离发布包验证第 2 页、120%、正文位置和已选批注跨两种专注模式、另一份附件及完整进程重启保持；Task 4 的剩余 PDF 项已勾选。Task 5 和阶段 D 保持未完成，详见[桌面 EXE 验收记录](../acceptance/2026-11-10-desktop-exe-acceptance.md)。

### 2026-11-13：阶段 A Task 5 原生窗口验收

- 完成 Task 5：真实 Electron 窗口在当前 Windows 200% 显示缩放下调整为 1280×860 与 960×700，窄窗无横向溢出；新任务页保持简洁；原生窗口完成 A/C 三态往返；实际资料选择器可打开并安全取消；更多菜单可用 Esc 收起；Electron DevTools Console 为 `0 messages in console`。焦点回归保留先前 CDP 结果（输入框聚焦、Shift+Tab 回触发按钮、Escape 关闭并还焦）。`pnpm check` 通过，`tests/e2e-smoke.test.js` 与 `tests/electron-smoke.test.js` 共 53/53 通过。完整原生窗口记录见 `.codex-acceptance/redesign-20261113/task5-desktop-20261113/VERIFICATION.txt`。现可进入阶段 B；未改系统缩放档位，阶段 D NSIS/portable 与全产品完整验收仍未完成。

### 2026-11-13：Office 查看器同步初始化失败态

- `prototype/app.js` 捕获 DOCX/PPTX 查看器构造器同步抛错，清理该次选区监听并进入现有可重试错误提示；`.doc/.ppt` IPC 回归确认不受支持文件不入库且原文件不变。针对性 Electron IPC、查看器及工作台测试 63/63 通过，`pnpm check` 通过。此为代码级失败态覆盖，不代表真实 Electron 中的损坏 Office 文件、原生选择器及 viewer 关闭清理验收通过；阶段 B 对应项保持未完成。

### 2026-11-13：Office 失败态修复版桌面包

- 全量 `pnpm test -- --test-reporter=dot` 与 `pnpm check` 退出 0；以隔离输出目录构建 NSIS 与 portable，避免覆盖已有 `release/`。`app.asar` 内 renderer 的 SHA-256 与当前 `prototype/app.js` 均为 `0370a74a355b2d07dde0655c11449dc134f2fe930530b3dbe4571fbafe1f524d`；检查确认 Electron/主进程/preload/server、PDF worker、Office viewer、Windows canvas 原生模块和网页转换资源齐备，根目录 tests/docs/.env 未打包。两个 EXE 的 SHA-256 与安装验收限制见桌面 EXE 验收记录；该新版包尚未安装或启动，阶段 D Task 24 不整体完成。

### 2026-11-14：NSIS/portable 新版实包补验

- 之前“该新版包尚未安装或启动”仅代表 11-13 构建后的当时状态；本轮已对同一 SHA-256 的 NSIS 与 portable 做隔离实包补验。NSIS 安装/启动/卸载成功并保留隔离用户数据；portable 启动成功，8 个板块内容均可渲染。页面/Electron/批注/备份定向回归 112 项与 `pnpm check` 通过。
- 桌面自动化未可靠观察 NSIS 原生文件选择器的后置状态；本轮没有验证该包的文件导入、备份往返、关闭重开、完整批注提示词、原生安全存储，也没有跑七板块完整业务路径。阶段 D Task 23/24 仍未完成；具体哈希与验收范围以[桌面 EXE 验收记录](../acceptance/2026-11-10-desktop-exe-acceptance.md)为准。

### 2026-11-14：工作台预览区收敛

- 资料标签并入分页、缩放和批注操作栏，减少一整行固定占高；新增批注编辑器移出资料滚动区，宽窗口下与预览并列，窄窗口改为可收起浮层。修改 `prototype/app.js` 与 `prototype/index.html`，新增布局回归断言 `tests/workbench-viewer-layout.test.js`。
- `pnpm exec node --test --test-reporter=spec tests/workbench-viewer-layout.test.js tests/workbench-tabs.test.js tests/workbench-fit.test.js tests/workbench-drawing.test.js tests/e2e-smoke.test.js`：108/108 通过；`pnpm check` 退出 0。现有开发服务 `http://127.0.0.1:4173/` 返回 HTTP 200，服务响应包含新版工具栏和侧栏 CSS。
- 使用独立用户目录启动 Electron，通过真实 Chromium renderer 核对新版 CSS：1280×860 时工具栏 46px、预览 960px、批注侧栏 320px；680×720 视口下批注编辑器变为 320px 浮层。验证使用代表性 DOM 夹具和 CDP 视口模拟，没有触碰已有任务窗口或工作区数据；记录见 `.codex-acceptance/redesign-20261114/workbench-layout-runtime/VERIFICATION.txt`。
- 真实 PDF/图片/Office 文件在新布局下的预览与批注组合、实际 BrowserWindow resize 和安装包视觉验收仍待执行；本次不据此关闭阶段 B 或 D 的资料/发布包验收项。

### 2026-11-14：提示词来源自动回到批注原文

- 提示词来源跳转到批注行后，自动触发该行现有的“回到原处”操作，保留此前的资料页码、批注行滚动和工作台布局。`tests/workbench-view-state.test.js` 覆盖 PDF、DOCX、PPTX，定向测试 32/32 通过。
- 本次仅完成代码级回归，未在包含此修改的真实 EXE 中验证原文高亮；相关真实窗口和发布包验收仍保持未完成。

### 2026-11-14：NSIS 提示词备份往返部分补验

- 同一 NSIS 实包从隔离源目录导出 1 条提示词，在全新隔离用户目录导入并读回标题与 `{{验收对象}}` 变量；导入预览为新增 1 条、无冲突、无附件错误。证据：`.codex-acceptance/redesign-20261114/stage-d-backup-roundtrip-01/VERIFICATION.txt`。
- 本次仅通过无附件提示词样本往返；含附件 ZIP 往返、portable 资料选择/备份及七板块全流程仍未完成。卸载保留用户数据的策略已由 NSIS 配置、设置存储位置及隔离卸载记录确认；阶段 D Task 24 仍未完成。详见阶段 D 验收计划。

### 2026-11-14：NSIS Office 文字选区补验

- 隔离 NSIS 实包中分别对一份 DOCX 和一份 PPTX 做真实文字拖选、保存批注与提示词纳入；PPTX 另点击“回到原处”并确认第 1 张幻灯片唯一匹配高亮。样本哈希、意见文本和运行结果见[详细批注计划](./2026-11-10-product-redesign-02-annotations.md)与 `.codex-acceptance/redesign-20261114/office-selection-pointer-01/VERIFICATION.txt`。
- 只覆盖一份 DOCX 与一份 PPTX 的局部流程；两种格式均已验证完整进程重启后的任务恢复和唯一匹配定位高亮，复杂版式、失败文件、七板块全流程和 NSIS/portable 全量验收仍未完成，不据此关闭阶段 B 或 D。
### 2026-11-15：HTML 工作台预览交付与任务收敛

- 定向预览用例、IPC 通道断言、改动文件语法检查通过；隔离 Electron 流程确认 HTML 打开、选区回传及关闭清理，窄栏批注浮层不会遮挡预览。
- NSIS 与 portable 包均生成于 `.codex-acceptance/redesign-20261115/html-preview-final/`。包内 `prototype/app.js` 与源码 SHA-256 一致：`af572fa4046330bb928aa3274848971c4cfa2700e5737276b553ee0b88f2f8e5`。具体 EXE 哈希见上方“当前剩余任务”。
- 未运行全量测试或重复阶段验收。随后在隔离 Electron 用户目录分别启动 portable 与 `win-unpacked` EXE，主窗口加载成功并显示七板块导航；相关测试进程已退出。动态网站脚本/外链资源的实时预览仍是明确能力边界，不计入当前待办。





