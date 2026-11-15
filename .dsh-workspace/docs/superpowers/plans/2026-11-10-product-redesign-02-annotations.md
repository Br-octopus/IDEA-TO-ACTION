# 阶段 B：桌面端资料查看、批注与修改提示词实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows Electron 桌面应用中呈现真实资料，保存可定位的多条批注，并据用户选中的批注生成可编辑修改提示词。

**范围：** 只修改仓库根目录「向前一步」桌面应用，最终交付 NSIS 安装包与 portable `.exe`；不修改 `.dsh-workspace/dsh-plugin` 插件副本。浏览器入口仅用于开发验证。

**Architecture:** 以根目录已有 `ppt-feedback` 附件与批注流程为兼容基础，按资料类型复用图片/PDF/HTML/网页/Office 能力。批注关联资料 ID、版本和文字/页面/元素位置；必要文件读写经受控 preload IPC。不得用演示 HTML、页面像素或 DSH 附件服务代替真实产品能力。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Electron IPC、已有 `pdfjs-dist` 6.4.299、已有 `@silurus/ooxml@0.89.9`（MIT，仅支持 DOCX/PPTX）与 Node 内置测试；不另造查看器；网页捕获及 Office/PDF 样本验收按阶段门槛执行。

### 阶段进度（更新至 2026-11-12）

- 2026-11-12 Office 接入前的历史实现：安全文件选择器可识别 `.ppt/.pptx/.doc/.docx`，当时主进程对 Office 返回未支持状态；该状态已由后续 DOCX/PPTX 查看器接入更新，不代表当前能力。

- 2026-11-12 后续代码推进：PDF 继续复用已安装的 `pdfjs-dist` 6.4.299 `PDFViewer`，新增页内文字锚点、选区保存与 DOM Range 恢复；定向回归 82 项通过。该记录当时只有自动化契约；现版 Electron 真窗口渲染、文字选区批注和重启恢复已由 2026-11-13 记录补验。Office 同样复用已安装的 MIT `@silurus/ooxml@0.89.9`：`prototype/app.js` 已通过 `DocxViewer` / `PptxViewer` 渲染 DOCX/PPTX 并启用文字/元素选区回调，`prototype/ppt-feedback.js` 将选区映射为带页码和 OOXML locator 的既有批注目标。两种格式均有 Electron 样本页面截图（路径见能力矩阵）；批注保存、提示词纳入、renderer 重载及回到原处仍待真实操作验收。旧 `.doc` / `.ppt` 不在依赖支持范围内。
- 已在隔离 Electron 窗口中实测合成 PNG 资料、点/区域标记、批注列表及应用重启后的恢复；截图为 `.codex-acceptance/redesign-20261111/stage-b-image-annotation-after-restart.png`。这仅证明当前 PNG 工作台切片，不代表 PDF、PPT、DOCX、HTML 与网站能力完成。
- 2026-11-11 已完成两页 PDF 区域批注真实拖动、保存、renderer 重载后从计划列表重开任务及页级定位验收；第一页恢复区域框，第二页不显示，返回第一页后重新显示。证据见[能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)及 `.codex-acceptance/redesign-20261111/pdf-region-after-reopen.png`。
- 2026-11-11 已在隔离 Electron 中重载 HTML 批注验收任务：文字选区和网页元素两条独立批注均恢复并保持选中；选择消息已进入工作台，意见进入修改提示词。新的工作台截图也确认批注编辑器默认收起，展开后类别细项默认折叠，意见草稿收起后可恢复。证据见[能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)、`.codex-acceptance/redesign-20261111/workbench-dialogue-after-update.png` 和 `.codex-acceptance/redesign-20261111/workbench-annotation-controls-after-update.png`。
- 2026-11-11 已补齐 HTML 文字锚点的受控 IPC 与恢复逻辑：保存 Unicode code point 位置和前后文；原位置仅在原文/上下文匹配时恢复，位置变化后仅接受上下文唯一命中；歧义、缺失或上下文变化时不擅自跳转。预览打开与“回到原处”均核对附件版本 hash；选区消息只接受预览窗口主 frame。单元与真实主进程模块往返测试覆盖上述边界，详细命令见[能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)。
- 修复反馈上下文筛选：仅选择中的 `active` 批注（兼容旧记录缺少状态）进入上下文；`deleted` 与 `stale` 不再占用条数上限。旧反馈 UI 改为传入约定的数组。
- 批注现区分意图与问题类别，支持修改、补充、删除、保留、疑问、核对；旧记录缺少意图时默认为“修改”，意图进入提示词并可编辑。
- 图片/PDF 已增加拖动箭头与画笔：页面归一化端点/笔迹坐标、SVG 拖动预览、取消状态、限量采样和提示词位置描述均已实现；主进程校验及保存重开回归通过。真实 Electron 窗口中的新绘制工具仍待视觉验收。
- Task 13、14 已完成代码闭环：选中且匹配当前附件 ID/hash 的有效批注按资料名、资料 ID、版本、页/文字/区域定位和意见分组进确定性提示词；旧版本、撤销、已移除来源与互斥意见被排除并明确标出。提示词没有有效批注时显示其仅基于对话；引用批注可按条跳回对应资料和意见；编辑、复制、重新整理及覆盖手改前确认均保留。手改稿重新生成/载入历史前有覆盖确认；提示词历史冻结批注引用快照。ZIP 备份往返校验手改稿、版本、批注、附件元数据和内容哈希；导入事务在重启后按已保存状态回滚或保留，附件校验失败报告部分恢复。Task 13/14 相关自动测试及 `pnpm check` 通过；真实窗口来源跳转和提示词覆盖确认交互仍未验收。
- 2026-11-13 静态网页固定样本已完成真实鼠标文字/元素批注、两条独立保存、提示词引用、原文/元素返回定位、取消勾选与 A/C 保留选择、完整进程重启恢复。修复复用了 HTML 主文档监听/定位，并保持脚本与外部资源阻断；不新增查看器依赖。来源 URL、抓取时间、网页 hash 与附件 hash 分别保存。详见桌面 EXE 验收记录的同日静态网页小节。
- 同轮修复滚动保存后旧任务对象导致布局、预览标签、资料、页码、缩放变化未落盘；文件选择/网页读取和移除恢复等待期间重新绑定原任务记录。10 项状态测试基线均失败、修复均通过；相关 154 项回归通过，新增来源栏排除测试在 8 项 HTML 测试中通过，`pnpm check` 通过。
- 尚未完成：动态网站和外链资源、复杂多页 Office、Office 元素与笔迹真实交互、Windows 安装包中的 PDF worker 与 Office 资源验收。完整进程重启已核对单页 Office 批注记录、选中状态与提示词引用；未代替复杂 Office 版式/绘制验收。

---

### Task 6：建立资料格式与已有能力矩阵

**Files:**
- Read: `prototype/ppt-feedback-schema.js`、`prototype/ppt-feedback-ui.js`、`prototype/ppt-feedback.js`
- Read: `electron/ppt-feedback-attachment-store.js`、`electron/ppt-preview-manager.js`、`electron/ppt-source-reader.js`
- Read: `server/web-page-reader.js`、`package.json`
- Test: `tests/ppt-feedback.test.js`、`tests/electron-ppt-preview.test.js`、`tests/electron-ppt-source-reader.test.js`、`tests/web-page-reader.test.js`
- Create: `.dsh-workspace/docs/superpowers/acceptance/2026-11-10-material-capability-matrix.md`

- [x] 列出图片、PDF、PPT/PPTX、其他 Office、HTML、本地网页/在线网站的选择、读取、预览、定位、保存、恢复和已知限制。
- [x] 用不含真实用户数据的样本运行现有测试；矩阵将能力标为“已有并验证 / 已有但未验证 / 需新增 / 不支持”，不把 PPT 反馈扩大描述成全格式能力。
- [x] 固定待测文件、哈希、软件依赖版本和验收标准；能力不确定的格式保留为显式关口，不阻断其他格式的实现。

能力矩阵及本次 44 项测试结果见：[桌面端资料能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)。本轮只完成 Task 6 盘点；真实统一查看器和批注功能仍未完成。

### Task 7：确保资料与批注引用稳定版本

**Files:**
- Modify if needed: `prototype/ppt-feedback-schema.js`、`prototype/ppt-feedback.js`
- Modify if needed: `electron/ppt-feedback-attachment-store.js`、`electron/preload.js`、`electron/main.js`
- Test: `tests/ppt-feedback-schema.test.js`、`tests/ppt-feedback.test.js`、`tests/backup-store.test.js`

- [x] 回归测试确认附件引用保留稳定资料 ID、版本/hash 与任务 ID；同名新版本不会覆盖旧资料或旧批注目标。
- [x] 复用当前附件存储与校验读取；批注保存失败时意见保留并显示失败状态；删除前展示关联批注数量，支持取消及移除后恢复。
- [x] 保留已有 PPT 批注数据兼容；原件、截图和大型二进制不写入普通浏览器存储。
- [x] 运行 `node --test tests/ppt-feedback-schema.test.js tests/ppt-feedback.test.js tests/backup-store.test.js tests/electron-ppt-preview.test.js tests/server.test.js`（45 项通过），并确认附件操作经 `preload` 暴露的窄 API 访问。

### Task 8：在 Electron 查看器展示实际文件

**Files:**
- Modify: `prototype/index.html`、`prototype/ppt-feedback-ui.js`、必要时 `prototype/ppt-feedback.js`
- Modify only when needed: `electron/ppt-preview-manager.js`、`electron/ppt-source-reader.js`、`electron/preload.js`、`electron/main.js`
- Test: `tests/electron-ppt-preview.test.js`、`tests/electron-ppt-source-reader.test.js`、`tests/ppt-feedback.test.js`

- [x] PNG 工作台切片：在隔离 Electron 窗口中选择 `tiny-valid.png`，真实显示资料并显示点/区域批注；应用重启后仍能读取资料和批注。视觉证据见 `.codex-acceptance/redesign-20261111/stage-b-image-annotation-after-restart.png`。
- [x] 按任务选择资料渲染真实单页/两页 PDF；单页完成 100% → 125% → 100% 重绘，两页完成翻页与页码/状态同步，并在附件切换、完整关闭重启 Electron 和从计划列表重开后恢复第 2/2 页与 125%。继续复用项目内已有 `pdfjs-dist` 6.4.299 `PDFViewer`、legacy 主模块和匹配 worker；未新增第二个查看器依赖。真窗口证据、样本 SHA-256 见[资料能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)及 `.codex-acceptance/redesign-20261113/pdf-viewer-page2-125-reopen-20261113.png`。PDF 文字选择批注及定位闭环仍由下一项单独验收。
- [x] 在现版 PDFViewer 真窗口完成文字选区→生成锚点→保存批注→纳入修改提示词→完整重启并从计划列表重开后恢复原文高亮；已验证双栏与专注查看 A/C 切换仍保持第 2/2 页、125% 和高亮。记录见[桌面 EXE 验收记录](../acceptance/2026-11-10-desktop-exe-acceptance.md)。
- [x] 真窗口点击文字批注“回到原处”，并在不同 PDF 附件间往返：两页 PDF 批注跳至第 2/2 页并高亮 `SECOND PAGE`；切到单页 PDF 后当前资料批注为 0 条、文本标记为 0 个；任务级提示词仍以原附件名、ID 与 SHA-256 引用已选意见，不冒充单页 PDF 来源；切回两页 PDF 后恢复第 2 页及高亮。真窗口截图和详细步骤见[桌面 EXE 验收记录](../acceptance/2026-11-10-desktop-exe-acceptance.md)。
- [x] PDF 区域批注经真实鼠标拖动后保存为页级归一化坐标；renderer 重载并从计划列表重开任务后落点恢复，翻页不串标记。样本、坐标、命令与截图见[能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)。
> **合并验收：** Office 复杂样本并入阶段 D Task 24 的唯一最终闭环，使用代表性 DOCX/PPTX 核对真实内容、分页和一条批注定位；不再单独执行缩放、旋转、窗口尺寸组合或失败恢复测试。已通过的拖选、保存、提示词生成、重启定位及旧格式提示直接复用现有证据。
- [x] 只在当前能力可稳定定位时显示对应批注工具；纯文本摘录不得伪装成版式保真的 PPT/Office 预览。`prototype/app.js` 仅对当前图片/PDF/HTML 或附件 ID、哈希、页数一致且无错误的 Office viewer 显示批注工具；不支持格式明确显示无法预览。`tests/workbench-viewer-layout.test.js` 覆盖 Office 就绪、加载失败与重试，`tests/e2e-smoke.test.js` 覆盖不支持格式提示；定向 78 项通过。
- [x] 在 Electron 窗口验证安全文件选择和视图清理；不通过任意文件路径或未经限制的 IPC 暴露本地文件。2026-11-14 在隔离 NSIS 实包中经系统选择器导入 DOCX/PPTX，验证关闭资料标签后视图清理、原附件仍在且可重新打开；完整进程重启后两个附件及页码恢复。哈希和步骤见 `.codex-acceptance/redesign-20261114/nsis-package-import-restart/VERIFICATION.txt`。

2026-11-13 Office 失败态局部实现：工作台仅在当前 DOCX/PPTX 的解析模型、附件 ID/hash 和页数匹配且无渲染错误时显示批注、翻页与缩放工具；加载失败显示错误和“重试预览”，异步页面渲染报错后卸载失败 viewer 并隐藏这些工具。新增 `tests/workbench-viewer-layout.test.js` 覆盖 Office 加载中、解析失败/重试入口与就绪态。定向 `pnpm exec node --test tests/workbench-viewer-layout.test.js tests/e2e-smoke.test.js tests/workbench-drawing.test.js` 为 76/76 通过，`pnpm check` 通过。该增量没有实测 Electron 真窗口错误回调；Office 样本翻页/缩放、旧版格式提示、原生选择器及视图清理仍须依 Task 8 固定样本验收，因此本任务三项保持未勾选。

2026-11-13 Office 同步初始化失败态补强：新增回归先在旧代码复现查看器构造器同步抛错会逃出 renderer 且不进入重试提示态；现捕获构造错误、清理该次选区监听，并复用现有 Office 渲染错误 UI。另为 `.doc/.ppt` 添加 IPC 回归，确认返回不支持状态、不复制附件且原文件不变。`pnpm exec node --test tests/workbench-viewer-layout.test.js tests/electron-ppt-main-annotation.test.js tests/electron-ppt-preview.test.js tests/e2e-smoke.test.js` 为 63/63 通过，`pnpm check` 通过。没有因此补勾 Task 8：真窗口故障回调、安全文件选择/关闭清理及复杂 Office 样本仍待验收。

**2026-11-12 前一版本窗口复验（后续源码更新后仅作历史记录）：**修复资料库旧详情容器的启动异常后，工作台任务可正常恢复；A/C 布局、PDF 页码/缩放/滚动和已选批注的状态恢复通过。该版本使用手工 `page.render()` 时，同一固定 PDF 的 canvas 为白色且渲染超过 7 秒未完成。后续源码改为 `PDFViewer` 并增加文字锚点；其自动化测试通过。2026-11-13 现版 Electron 已补验真窗口 PDF 渲染、点击“回到原处”和跨附件批注/提示词隔离；较早的未验收结论不再代表当前状态。

2026-11-13 Office 选区部分补验：复用现有 `@silurus/ooxml` 和两页固定样本，在隔离 Electron 开发进程从 DOCX/PPTX 实际文字层形成选区、保存独立批注、纳入修改提示词，并在渲染器刷新及完整进程重启后恢复；来源和“回到原处”返回第 2 页。发现 DOCX 无段落 ID 时原定位符为空，已复用查看器来源路径修复新建批注，独立进程实测 `p:source:body:body:[2]:r0`；历史批注不迁移。六组相关测试 90/90 通过，证据见[资料能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)及 `.codex-acceptance/redesign-20261113/office-selection-20261113/VERIFICATION.txt`。鼠标拖选尚未稳定复现；重复原文只按唯一匹配核对；失败状态、复杂版式/字体与正式发布包未完成，Task 8 保持未勾完。

### Task 9：完成 HTML、网站与 Office 的能力关口

**Files:**
- Inspect/Modify only after evidence: `prototype/app.js`（DOCX/PPTX viewer 与工作台接线）、`prototype/ppt-feedback.js`（Office 锚点与共用批注/提示词），只在真实样本发现缺口时修改；网页部分再检查 `server/web-page-reader.js`、`electron/ppt-preview-manager.js`。
- Test: `tests/ppt-feedback.test.js`、`tests/electron-ppt-main-annotation.test.js`、`tests/e2e-smoke.test.js`、`tests/web-page-reader.test.js`、`tests/electron-ppt-preview.test.js`
- Update: `.dsh-workspace/docs/superpowers/acceptance/2026-11-10-material-capability-matrix.md`

- [x] HTML 附件隔离预览的文字/元素选区可回传工作台并保存为独立批注；所选批注纳入修改提示词，Electron renderer 重载后恢复原任务、附件和内容版本关联。固定验收证据见[资料能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)。
- [x] HTML/网页使用明确来源、抓取时间和页面内容版本；网页不可访问、脚本渲染缺失或内容变化时展示状态，不能静默引用旧页。实现证据：`server/web-page-reader.js` 返回来源版本及不可访问/正文过短状态；工作台以 `role="alert"` 显示读取错误，换版前要求确认并取消旧版批注默认选择。`tests/web-page-reader.test.js`、`tests/web-snapshot-update.test.js`、`tests/e2e-smoke.test.js` 覆盖相关分支；静态网页真实样本与重启定位见资料能力矩阵。动态脚本执行和外链资源不在当前静态快照能力内，仍由复杂网页验收项跟踪。
- [x] DOCX/PPTX 直接复用现有 `@silurus/ooxml@0.89.9` 依赖；固定样本页显示、页码/缩放、中文内容和选区定位均已有 NSIS 实包证据，未新增重复查看器依赖。记录见[桌面 EXE 验收记录](../acceptance/2026-11-10-desktop-exe-acceptance.md)与 `.codex-acceptance/redesign-20261114/office-selection-pointer-01/VERIFICATION.txt`。复杂版式、Office 元素和失败文件由 Task 8/11 跟踪，仍未完成；不重复本项标准样本验收。
- [x] 每项能力提供固定文件/网址、预期画面与定位、运行命令和结果；未验证格式留在矩阵中标为未完成。当前状态与证据见[资料能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)。

**2026-11-12 部分推进：**在线读取与隔离附件流程已接通静态 HTML 本体、来源 URL、抓取时间和 HTML SHA-256；不可访问、超限、短正文/可能依赖脚本等状态由读取结果返回。预览窗口移除脚本、危险属性并阻断外部资源；HTML 文本/元素选区可回传并按来源版本保存，进入修改提示词。HTML IPC/锚点/批注定向测试 37 项通过；全套 `pnpm test` 为 1217 项通过、1 项环境跳过，`pnpm check` 与目标 `git diff --check` 通过。修复 IPC 可克隆返回值后的真实 Electron 窗口尚未复验；历史 IANA 截图早于修复，不作为新版本证据。静态快照不包含脚本渲染或外链资源。Office 已复用 `@silurus/ooxml@0.89.9` 接通 DOCX/PPTX 页渲染和选区回调，并有真实窗口页面截图；批注保存、提示词纳入、重开定位全链路仍未验收，因此 Task 9 整体保持未完成。

**2026-11-13 网站静态快照补验：**固定 IANA 网址经桌面应用打开预览并真实鼠标划选、保存批注与生成修改提示词；当前源码隔离 Electron 完整重启后任务、批注及定位恢复。网页版本变化时确认后取消旧版批注勾选，取消确认不影响旧版，历史引用保留；定向 51 项通过。发布包仍为早于固定来源端口修复的旧版本，正式 EXE 重打后的重开恢复、动态网站/外链资源、复杂长页面及全部失败状态仍待验收，Task 9 保持未完成；以[能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)最新记录为准。

### Task 10：建立文本锚点与页面坐标契约

**Files:**
- Modify: `prototype/ppt-feedback-schema.js`、`prototype/ppt-feedback.js`、`prototype/app.js`
- Modify: `electron/main.js`、`electron/preload.js`、`electron/ppt-preview-manager.js`、`electron/ppt-feedback-preview-preload.js`
- Test: `tests/html-annotation-anchor.test.js`、`tests/pdf-text-anchor.test.js`、`tests/electron-ppt-main-annotation.test.js`、`tests/electron-ppt-preview.test.js`、`tests/ppt-feedback-schema.test.js`、`tests/ppt-feedback.test.js`

- [x] HTML 文字批注保存 exact、前后文、Unicode code point 位置和附件版本；按原位置及上下文核对，原位置失效后只接受唯一上下文命中，歧义/缺失时不静默跳转。
- [x] PDF 文字层代码保存 exact、前后文和 Unicode code point 页内位置，可从文本层选区生成锚点，并在原文/上下文匹配后恢复 DOM Range 与高亮；`tests/pdf-text-anchor.test.js` 覆盖定位边界。现版查看器仍须通过 Task 8 的 Electron 真窗口渲染验收，代码完成不代表 PDF 产品流程验收完成。
- [x] 图片/PDF 点与区域批注保存页标识和归一化坐标；缩放/翻页及任务重开恢复已有固定样本证据。窗口尺寸变化的独立视觉验收仍待补。
- [x] 网页元素锚点同时保存网址、捕获时间、短文本和必要上下文；资料版本改变后进入待确认状态。来源元数据由隔离预览主进程注入；`tests/electron-ppt-main-annotation.test.js` 覆盖元素批注保存、重启恢复和重新定位，`tests/web-snapshot-update.test.js` 覆盖版本变化确认。
- [x] 自动测试覆盖 HTML 重复文本、文字缺失、Unicode 位置与上下文变化，以及批注坐标校验；Electron 样本已覆盖 PDF 缩放、页码变化与重开。在线来源版本变化和正式包路径仍未验收。

### Task 11：实现多条独立批注和类型

2026-11-13 多页绘制补验：修复 DOCX/PPTX 新增与重新关联绘制批注被写入第 1 页、绘制批注缺少“回到原处”入口、图片/PDF/Office 绘制定位误走 HTML 隔离预览、Office 初始化第一页回调覆盖恢复页码，以及提示词来源入口未恢复批注页码。继续复用原生 SVG、既有批注历史和 @silurus/ooxml 查看器，没有新增产品依赖。

- [x] 两页 DOCX/PPTX 合成真实 OOXML 文件经系统文件选择器导入：DOCX 第 2 页区域＋画笔、PPTX 第 2 页箭头＋画笔由真实鼠标绘制并保存；第 1 页无标记；批注列表和提示词来源均能回到第 2 页。
- [x] PPTX 真实窗口撤销/重做、两种 Office 的双栏/专注对话/专注查看切换、renderer 重载及完整隔离 Electron 进程重启后恢复通过。自动化行为测试覆盖四格式、四绘制工具的新增/重新关联、撤销重做与页层过滤。
> 此处复杂真实文件分页/版式、Office 对象定位及旋转/窗口尺寸变化组合验收已合并到 Task 8 的单一剩余项；已有对象框/旋转自动用例和两页合成样本保留作证据，不再重复列测试。

本轮 132 项定向回归通过，pnpm check 和目标 diff 检查通过；存在既有 buildKnowledgeContext 循环依赖警告。样本哈希、命令和基线/修复/副本回退证据见 acceptance/2026-11-10-desktop-exe-acceptance.md 的“多页绘制”补记与 .codex-acceptance/redesign-20261113/office-drawing-fix/。Task 9/B 阶段不整体勾完。

**Files:**
- Modify: `prototype/app.js`、`prototype/ppt-feedback-schema.js`、`prototype/ppt-feedback.js`、`electron/main.js`
- Test: `tests/ppt-feedback-schema.test.js`、`tests/ppt-feedback.test.js`、`tests/electron-ppt-main-annotation.test.js`、`tests/e2e-smoke.test.js`

- [x] 每条批注有独立 ID、资料/版本/定位、用户原话、意见类型、创建/更新时间和状态；新增/编辑一条不得覆盖其他批注。Electron IPC 回归验证独立 ID、编辑不改创建时间、更新更新时间且不覆盖其他批注。
- [x] 图片/PDF 支持点、区域、高亮式矩形、箭头、画笔，HTML 支持文字/元素选区；无法定位文字时不造出不存在的锚点。
- [x] 批注意图包括修改、补充、删除、保留、疑问/核对；意图只表达用户要求，测试覆盖提示词保留类型与批注原话。
- [x] 工具切换、指针取消、撤销/重做、删除确认和保存状态均由 smoke/单元测试覆盖；历史栈仅在对应保存成功后推进，失败时不消耗操作。

Task 11 验证：`pnpm exec node --test tests/ppt-feedback.test.js tests/ppt-feedback-schema.test.js tests/electron-ppt-main-annotation.test.js tests/electron-workbench-backup.test.js tests/workspace-backup.test.js tests/workspace-backup-archive.test.js tests/e2e-smoke.test.js`（99 项通过，退出码 0）；`pnpm check`、目标文件 `node --check` 与目标文件 `git diff --check` 均通过。这些检查不替代真实 Electron 窗口的操作验收。

### Task 12：处理保存失败、重新定位和旧意见

**Files:**
- Modify: `prototype/ppt-feedback.js`、`prototype/ppt-feedback-ui.js`
- Modify only if needed: `electron/ppt-feedback-attachment-store.js`
- Test: `tests/ppt-feedback.test.js`、`tests/backup-store.test.js`

- [x] 保存失败时保留待提交意见并展示失败状态；图片/PDF 保存路径的 smoke 断言确认仅在成功保存后清空意见草稿。
- [x] 附件丢失/哈希变化时说明影响，并可从其他资料的批注入口重新关联；同哈希复用原定位，异哈希必须在当前资料重新标记。
- [x] 资料版本改变时按哈希与来源附件判断匹配、需确认、失效三种显示状态；重新关联建立带 `reassociatedFromId` 的新记录，原批注与定位保持不变，关联元数据进入 ZIP 备份。
- [x] 编辑、删除、撤销和恢复只影响指定批注；删除资料前列出当前关联任务、批注数和引用该资料的提示词版本摘要，确认后仅移除指定附件。

Task 12 本轮验证：`pnpm exec node --test tests/ppt-feedback.test.js tests/ppt-feedback-schema.test.js tests/electron-ppt-main-annotation.test.js tests/workspace-backup.test.js tests/workspace-backup-archive.test.js tests/e2e-smoke.test.js`（100 项通过，退出码 0）；`pnpm check` 与 `git diff --check` 通过。代码与自动测试闭环已完成；真实 Electron 窗口中的重新关联和移除确认操作仍待验收。

### Task 13：只依据有效选项生成修改提示词

**Files:**
- Modify: `prototype/ppt-feedback.js` 或现有工作台模块中最贴近的提示词组装位置
- Modify: `prototype/ppt-feedback-ui.js`、`prototype/index.html`
- Test: `tests/ppt-feedback.test.js`、必要时 `tests/e2e-smoke.test.js`

- [x] 图片批注进入提示词前要求已选、状态有效、关联当前附件 ID 与 SHA-256；撤销/过期项被排除，回归测试覆盖删除/过期过滤。
- [x] 对 HTML 文字/元素、图片/PDF 页面定位加入有效版本过滤；同位置互斥的修改/补充/删除/保留意见明确排除并提供取消选择处理指引，过期/撤销/已移除资料不得静默带入。
- [x] 生成稿包含任务目标、资料名称/ID/版本、原文或页面区域、用户意见与类型、未提及内容保留要求；多份资料按来源分组。
- [x] 结果在独立可编辑区域呈现，支持复制、按条返回对应批注和重新整理；无有效选中批注时说明提示词仅基于任务对话。
- [x] 默认确定性拼接，不调用模型加工；用户手改稿在再次整理前要求明确确认。

Task 13 验证：`pnpm exec node --test tests/ppt-feedback.test.js tests/ppt-feedback-schema.test.js tests/e2e-smoke.test.js tests/workbench-dialogue.test.js tests/electron-ppt-main-annotation.test.js tests/html-annotation-anchor.test.js`（49 项通过，退出码 0）；`pnpm check`（退出码 0）；`git diff --check`（退出码 0）。上述自动证据未替代 Electron 窗口中的逐条来源跳转验收。

2026-11-15 冲突处理补充：互斥批注现在只在工作台对话中出现一张即时决策卡，Agent 建议暂缓，用户可选择保留某条、合并意见或暂缓；合并意见按原批注定位进入提示词，过长时禁用合并而不截断。决定作为任务对话消息保存并纳入备份白名单；`tests/ppt-feedback.test.js` 中新增的决策用例通过。HTML/网站仍使用隔离独立窗口，收进 A/C 工作台预览尚未实现。

### Task 14：保护手改稿、历史版本与备份

2026-11-13 Office 局部推进：复用现有 @silurus/ooxml 的 viewer/选区/查找 API，修复拖选中途重建、保存后残留草稿，以及异步刷新持有旧任务导致提示词引用未落盘。新增 tests/workbench-annotation-save.test.js；连同 e2e/批注/对话/存储共 107 项通过。真实 Electron 中以鼠标拖选 DOCX fixture、PPTX 季度收入，保存、提示词纳入、renderer 重载重开、回到原处唯一高亮及引用快照已核验。详见桌面 EXE 验收记录 2026-11-13 Office 小节。复杂多页 Office、完整进程重启、网站闭环及正式包资源仍待验收，Task 9 不整体勾完。

**Files:**
- Modify: `prototype/ppt-feedback.js`、`prototype/workspace-backup.js` 或现有备份模块
- Modify only if needed: `electron/backup-store.js`、`electron/workspace-backup-archive.js`
- Test: `tests/ppt-feedback.test.js`、`tests/workspace-backup.test.js`、`tests/workspace-backup-archive.test.js`

- [x] 手改提示词后再次生成或载入会覆盖草稿的历史版本前要求确认；每版保存所引用批注的不可变快照。
- [x] 备份导出/恢复后比较附件引用、版本、批注及手改稿；ZIP 校验失败的附件报告为部分恢复，不伪称成功。
- [x] 独立临时数据上验证 ZIP 导出 → 空白目标导入 → 比较工作区字段和附件哈希；Electron 事务重启后按状态回滚或保留，再运行相关回归测试。

Task 14 验证：`pnpm exec node --test tests/workbench-dialogue.test.js tests/electron-workbench-backup.test.js tests/workspace-backup.test.js tests/workspace-backup-archive.test.js`（60 项通过，退出码 0）；`pnpm exec node --test tests/e2e-smoke.test.js tests/electron-smoke.test.js tests/electron-ppt-preview.test.js`（59 项通过，退出码 0）；`pnpm check`、`node --check prototype/workbench-dialogue.js`、`git diff --check` 均通过。真实 Electron 窗口中的提示词覆盖确认和导入对话框尚未操作验收。

2026-11-14 Office 选区入口补进展：打开 PDF/DOCX/PPTX 批注面板时默认切换到文字/元素选择；已选区域、箭头、画笔不被覆盖，图片仍保留点批注。`tests/workbench-viewer-layout.test.js` 10 项、`tests/workbench-annotation-save.test.js` 与 `tests/ppt-feedback.test.js` 27 项通过，`pnpm check` 与目标 `git diff --check -- prototype/app.js` 通过。自动回归覆盖 Office 元素定位目标进入待保存批注，但不代表实包鼠标操作通过；NSIS 包选区回调、复杂 Office 版式/元素批注和完整 Task 9 流程仍待验收。

2026-11-14 NSIS DOCX 批注提示词闭环补验：隔离 EXE 中已有的双页 `two-page-drawing.docx`、1 条选中批注和可编辑提示词，提示词保留附件 SHA-256、批注 ID、原文、修改意见及 OOXML 段落定位。完整关闭并用相同隔离用户目录重启后，重新打开任务，附件、批注 1 条、提示词正文（583 字符）和查看器位置均恢复。此项只关闭该样本的提示词与进程重启检查；不代表来源跳转、复杂版式、网站批注、备份导入对话框或 Task 9 全项通过。详见桌面 EXE 验收记录“2026-11-14 NSIS Office 批注提示词与模型补验”。

2026-11-14 Office 元素选区草稿预览：`prototype/app.js` 在同一任务、资料 ID/SHA-256、页码与有效 OOXML 元素边界匹配时，将未保存的元素选区绘制为虚线框；已保存批注样式不变。`pnpm exec node --test tests/workbench-drawing.test.js` 38/38 通过，`git diff --check -- prototype/app.js prototype/index.html` 通过。尚未在 Electron/NSIS 真窗口检查重绘后的视觉呈现，不据此关闭 Task 11 或安装包验收。

2026-11-14 NSIS DOCX 鼠标选区补验：隔离实包中真实拖选第 1 页 `fixture`，工作台显示“文档页 1 已选文字”；批注数由 2 增至 3，修改提示词编辑框包含原文和意见 `Replace fixture with verified example.`。实包哈希、任务/附件 ID、样本哈希与操作记录见 `.codex-acceptance/redesign-20261114/office-selection-pointer-01/VERIFICATION.txt`。这是单一样本的拖选、保存和提示词证据；未验重启定位高亮或 PPTX 实包拖选，Task 8/9 不整体勾选。本轮只补记既有 GUI 结果，未运行新测试。

2026-11-14 NSIS PPTX 鼠标选区补验：使用附件 SHA-256 `d7b05e29d8b397089bf09bb992f3e2961c2c662a8a7837f32d989217b3fbfb5f`，真实指针拖选第 1 张幻灯片 `季度收入`，保存意见后确认其进入提示词。完整退出并重启同一隔离实包，从最近计划恢复任务后，PPTX 与 DOCX 的“回到原处”均显示各自页码上的唯一匹配高亮。复杂版式、失败文件和 Task 8/9 整体仍未完成。

