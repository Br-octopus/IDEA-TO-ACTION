# 界面设计自查与开源复用依据

核查日期：2026-11-12（本次复核）。目标：仓库根目录「向前一步」Windows Electron 桌面应用，交付 NSIS 安装包与 portable `.exe`。`prototype/index.html` / `prototype/app.js` 是桌面端共用 renderer；`.dsh-workspace/dsh-plugin/forward-step-dsh` 是另一套 DSH 插件，不是本次目标。当前网页草图只用于评审，不等于应用界面已经实现。

## 结论

设计稿已明确修改对象是 Windows 桌面 EXE，并按工作台、资料库、提示词收藏、写作、研究、记忆与偏好、设置七板块组织。项目已有可复用代码，不需要从零另造查看器：根目录已接入 MIT 许可的 `@silurus/ooxml@0.89.9`，并用它渲染 DOCX/PPTX、读取文字/元素选区；现有批注数据、受控附件读取和提示词拼装也可继续复用。代码接通不等于 Office 批注闭环已验收；选区保存、重开定位和正式安装包仍需单独验证。

本次自查修订了五份实施子计划与实施总计划，使后续任务指向根目录 Electron 产品，而非插件目录。只更新设计、审查和计划文档，不更改产品代码，也不将示例流程、浏览器开发页或局部 PPT 能力说成完整实现。

## 1. 四组要求对照

| 要求 | 设计覆盖 | 根目录应用现状 | 计划落点 |
| --- | --- | --- | --- |
| 七个板块分别设计并说明流程 | 全产品界面设计与功能流程设计分别规定页面、入口、结果和异常 | `prototype/index.html` 目前已有 home、plans、references、library、article、academic-workbench、social-research、prompt-agent、settings 等视图，入口尚未按新版七板块重组 | 阶段 A 先映射现有视图；阶段 C 重排各板块，不另建路由框架 |
| 跨资料批注并生成修改提示词 | 工作台稿定义图片、PPT、文档、HTML、网页、定位、类型、版本与提示词流程 | 已有图片/PDF/HTML 锚点和提示词通路；DOCX/PPTX 已接入 `@silurus/ooxml` 查看与选区回调，主窗口/提示词完整闭环仍待验收 | 阶段 B 复用现有查看器、批注数据、受控 IPC 和提示词组装，只补重开定位、失败边界与真实窗口验证 |
| A＋C 工作台、清爽首页、按需弹出 | 工作台设计稿与流程稿已规定初始首页、任务态双栏、专注态、状态保留及条件提问 | 交互稿可演示部分状态；不能代替 Electron 运行态、多任务隔离和刷新恢复验收 | 阶段 A 与 D，分别实现并在 Electron 窗口验证 |
| 原型与真实资料能力区分 | 文档标出待评审规则、模拟流程和真实样本验收门槛 | `product-flows.html` 是本地演示数据构成的设计草图 | 阶段 B/D 以真实文件、网页快照、IPC、NSIS 与 portable 包验收 |

## 2. 自查发现

### P1：旧实施计划目标仓库错误

五份旧计划把 `.dsh-workspace/dsh-plugin/forward-step-dsh` 写成产品源码，并按 React、TypeScript、DSH Host 和 `tests/dsh-plugin` 安排工作。根目录 `package.json` 的 `main` 是 `electron/main.js`，`README.md` 将 Windows 桌面应用列为交付目标，且 `dist:win` 构建 NSIS 与 portable 两种 EXE。旧计划不可直接执行。

**修订：**计划改为以根目录 `prototype/`、`electron/`、`server/`、`tests/` 为实现边界；明确界面是既有 HTML/CSS/JavaScript renderer，文件访问由 Electron 主进程和受控 preload IPC 承担。DSH 插件目录只作为明确排除项。

### P1：已有批注与 Office 查看器复用范围被低估或写错

根目录已有图片/PDF/HTML 批注流程、Electron 附件持久化与网页隔离预览；`@silurus/ooxml@0.89.9` 已用于 DOCX/PPTX 页面渲染和选区回调。现有能力仍不等同于全部格式的真实窗口闭环：Office 的保存、重开定位、提示词引用及正式包还未完整验证。

**修订：**不再把 DOCX/PPTX 写成“查看器未接入”或一律不支持。计划从真实能力盘点开始，分别标明可直接复用、需补齐、待转换/验证的资料类型；失去定位、损坏附件和旧版记录必须能被用户看见，不能静默错配。`.doc` / `.ppt` 旧二进制格式仍不由该 OOXML 查看器支持。

### P1：设计草图被误当作桌面产品

可点击的 `product-flows.html` 使用本地演示数据，展示结构和流程，不是 Electron renderer，也不验证 `preload`/IPC、持久化或打包行为。

**修订：**将原型评审和产品验收分开。计划要求以 `pnpm desktop` 或隔离用户目录运行 Electron，并用 `pnpm dist:win` 产物验证最终交付；构建未运行就不宣称安装包通过。

### P2：板块重组容易重复造功能

目前导航和多个业务视图已存在。另起一套路由、任务存储、写作/研究面板会增加状态分叉。

**修订：**沿用现有页面入口、领域模块及持久化契约；七板块是信息架构重组，不要求重写底层业务。记忆与偏好先盘点当前来源，再决定新增视图需要的最小承载方式。

## 3. 七板块与根目录代码映射

| 新板块 | 现有入口/模块 | 计划处理方式 |
| --- | --- | --- |
| 工作台 | `prototype/index.html`、`prototype/app.js`、`prototype/prompt-agent-*`、`prototype/ppt-feedback-*` | 收敛首页、任务态与查看器入口；复用提示词 Agent 与 PPT 反馈基础 |
| 资料库 | 现有 `references` 视图、`prototype/knowledge-search.js`、本地来源索引 | 按资料清单、详情、来源与任务引用组织；保留真实来源与版本 |
| 提示词收藏 | 现有 `library` 视图 | 提示词正文、变量、案例、方法卡采用独立子页/详情，不重复造模板引擎 |
| 写作 | `article` 视图、`prototype/writing-workbench-*`、`prototype/writing-pack-*` | 以稿件和轮次为中心，沿用写作流程和专业包 |
| 研究 | `academic-workbench`、`social-research` 与对应模块 | 页面分区但保留学术/社媒各自的数据与动作 |
| 记忆与偏好 | 现有设置、写作和 Agent 偏好来源需盘点 | 先梳理真实数据来源，再设计用户可查看、确认、停用和撤销的集中入口 |
| 设置 | `settings` 视图、`electron/settings-store.js`、备份/迁移模块 | 分类展示模型、连接、数据、备份与迁移；保留 Electron 安全存储与原备份格式 |

路径以当前根目录代码为准；如模块在实施前移动，计划需同步校准，不得改去插件副本。

## 4. GitHub 复用依据与边界

下列实现按固定提交检查过源码/许可，仅借鉴定位与状态逻辑；不是已添加依赖或已经移植。复制具体代码前仍需核对来源文件、许可证、归属要求、当前依赖和 Windows 打包结果。

| 项目与固定提交 | 可借鉴点 | 对本项目的取舍 |
| --- | --- | --- |
| [Hypothesis anchoring/html.ts](https://github.com/hypothesis/client/blob/a7b7400d0d706d4357ec37c2a3610b25dcca89d5/src/annotator/anchoring/html.ts)、[types.ts](https://github.com/hypothesis/client/blob/a7b7400d0d706d4357ec37c2a3610b25dcca89d5/src/annotator/anchoring/types.ts)；[BSD 两条款 LICENSE](https://github.com/hypothesis/client/blob/a7b7400d0d706d4357ec37c2a3610b25dcca89d5/LICENSE) | Range、位置、引文逐级定位；核对 exact、保存上下文 | 根目录原生前端可先实现最小引文锚点；重复匹配或版本变化时要求用户确认，不搬入账号/服务端体系 |
| [Annotorious Annotorious.ts](https://github.com/annotorious/annotorious/blob/f780879410ff4f2d4fd0b2cb1ae1bd596a40fe65/packages/annotorious/src/Annotorious.ts)、[package.json](https://github.com/annotorious/annotorious/blob/f780879410ff4f2d4fd0b2cb1ae1bd596a40fe65/packages/annotorious/package.json)；3.9.5、BSD-3-Clause | 图片注释状态、选择、撤销栈与创建/销毁生命周期分离 | 先用真实图像验证现有依赖/原生 SVG 是否足够；不因 React 生态而引入整包，不假设开箱即有全部工具 |
| [PDF.js ink.js](https://github.com/mozilla/pdf.js/blob/b600aecd1801b6a924adc85bb8d6b8b170bae107/src/display/editor/ink.js)；[Apache-2.0 LICENSE](https://github.com/mozilla/pdf.js/blob/b600aecd1801b6a924adc85bb8d6b8b170bae107/LICENSE) | 页面坐标变换、缩放下笔迹稳定性、笔迹数据序列化 | 根目录已声明 `pdfjs-dist` 6.4.299；优先用项目版本。内部源码仅作思路，不当作稳定公共 API，也不混用其他版本 worker |
| [react-pdf-highlighter-extended coordinates.ts](https://github.com/DanielArnould/react-pdf-highlighter-extended/blob/b58a3b387d870a44051a7d032e5f67ecabeb7909/src/lib/coordinates.ts)；[MIT package.json](https://github.com/DanielArnould/react-pdf-highlighter-extended/blob/b58a3b387d870a44051a7d032e5f67ecabeb7909/package.json) | 视口与固定页面坐标互转、多个文字矩形和页码 | 只借鉴坐标契约；不引入依赖，避免其 React/PDF.js 4 与根目录 PDF.js 6 的组合风险 |

### 主应用已可复用的实现

| 已有代码 | 可直接复用的能力 | 当前处理 |
| --- | --- | --- |
| `@silurus/ooxml@0.89.9`（MIT；上游 [office-open-xml-viewer](https://github.com/yukiyokotani/office-open-xml-viewer)）、`prototype/app.js` 的 `loadWorkbenchOfficeModule()` / `renderWorkbenchOfficePage()` | DOCX/PPTX 页面查看、页码/缩放、文字与元素选区上下文及来源定位 | 已直接作为依赖并接入工作台；应用负责将选区映射为自己的批注记录。它是只读查看/选区组件，不负责本项目的批注持久化、重开恢复或提示词生成；不支持旧 `.doc` / `.ppt` |
| `prototype/workbench-dialogue.js`、`prototype/app.js`、`tests/e2e-smoke.test.js` | 对话回复解析、抑制选项清单、按上下文给建议并只在关键信息缺失时提问 | 已用于工作台任务对话；自动测试确认首页只保留自然输入、Agent 在对话中按需给出选择方向，不需要新增静态选项表单 |
| `pdfjs-dist` 6.4.299、`prototype/pdfjs-loader.js`、`renderWorkbenchPdfPage()` | PDF 页面渲染、匹配版本 worker、按页导航和缩放重绘 | 已在桌面工作台使用，不再引入第二个 PDF 查看器 |
| `prototype/ppt-feedback.js`、`prototype/ppt-feedback-schema.js`、`prototype/app.js` 批注函数 | 图片/PDF 区域定位、Office 文字/元素锚点归一化、附件版本校验、多条批注、选择状态、冲突检查、撤销重做与修改提示词拼装 | 继续沿用现有数据结构与任务上下文；Office 重开时文字/元素锚点的可视定位及完整 Electron 操作仍需补验 |
| `electron/ppt-feedback-preview-preload.js` 与 `tests/html-annotation-anchor.test.js` | HTML 选区跨文本节点、Unicode code point 定位、exact/prefix/suffix 上下文核对；重复或失配时不擅自跳到首个结果 | 已作为 HTML 批注定位实现；与 Hypothesis 的设计思路相近，但不是复制其整套客户端 |
| `electron/preload.js`、`electron/main.js` 的 PPT feedback IPC | 附件与批注的白名单访问、按任务保存、受控网页快照读取 | 继续复用，避免把原文件或凭证写入 renderer 普通存储 |

因此本项目已经直接复用 `@silurus/ooxml` 这个 MIT 开源查看器依赖；它处理 DOCX/PPTX 只读解析、画布显示与选区上下文，项目自有代码负责批注保存、版本关系、返回定位和修改提示词。Hypothesis、Annotorious、PDF.js 等仍是锚点/坐标/撤销细节参考，不代表已复制它们的源码；暂不另加 React 查看器或账号/服务端体系。

## 5. 验证与定稿门槛

- 文档范围检查：主设计、功能流程、五份阶段计划与总计划均明确 Windows Electron EXE；只在排除项中提及 DSH 插件。
- 行为验收：按现有主应用真实路径检查七板块入口、任务/资料/版本传递、批注定位与提示词去向；不以静态流程稿代替。
- 文件验收：图片、PDF、PPT/Office、HTML 与网页按格式登记真实支持状态；不支持或无法重新定位时给出明确状态和可恢复操作。
- 桌面验收：在 Electron 窗口检查最小/常用尺寸、文件选择、受控 IPC、关闭/重开后的数据；NSIS 与 portable 包分别验证。
- 当前核查没有运行产品回归、真实资料解析或生产打包。下一步实施须按总计划从阶段 A 开始，且每阶段更新实际完成状态。

入口：[全产品重设计实施总计划](../plans/2026-11-10-product-redesign-implementation.md)。
