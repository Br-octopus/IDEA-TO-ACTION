# 桌面端重设计实施计划自查与修订记录

核查日期：2026-11-10。目标依据：用户要求明确重设计对象为桌面端 EXE；仓库根目录 `package.json`、`README.md`、Electron 入口及现有测试；五份阶段计划与产品设计文档。

## 结论

原五份实施计划误以 `.dsh-workspace/dsh-plugin/forward-step-dsh` 为产品目标，指定 React/TypeScript、DSH Host、插件构建和 `tests/dsh-plugin`。这与仓库根目录实际产品不符，不能直接执行。计划现已改写为根目录 Windows Electron 应用，保留原七板块、A/C 工作台、跨资料批注、提示词生成、资料兼容和发布验收要求。

本轮只修订计划与自查文档，没有实施产品功能、修改 Electron renderer、运行产品测试或生成安装包。开始实施前仍需按阶段 A 建立根目录基线。

## 1. 目标边界与代码依据

- `package.json`：`main` 为 `electron/main.js`；`desktop` 启动 Electron；`dist:win` 目标为 NSIS 与 portable。
- `README.md`：Windows 桌面应用为交付目标；`prototype/index.html` 是浏览器开发和 Electron 共用主界面。
- renderer：`prototype/index.html`、`prototype/app.js` 及现有业务模块，采用 HTML/CSS/JavaScript，不是计划中的 React/TypeScript 应用。
- 桌面桥接：`electron/main.js`、`electron/preload.js`；窗口、文件系统、安全存储、附件和受控 IPC 由现有 Electron 路径负责。
- 测试：根目录 `tests/` 使用 Node 内置测试；相关文件包括 `e2e-smoke.test.js`、`electron-smoke.test.js`、`ppt-feedback*.test.js`、`electron-ppt-*.test.js`、`web-page-reader.test.js`、备份/恢复测试。
- `.dsh-workspace/dsh-plugin/forward-step-dsh` 与 `tests/dsh-plugin` 为插件副本，不纳入本计划，也不作为完成证据。

## 2. 原计划缺陷与修订

| 严重度 | 原缺陷 | 本次修订 |
| --- | --- | --- |
| P1 | 目标代码路径指向 DSH 插件副本 | 五份阶段计划和总计划重锚到仓库根目录 `prototype/`、`electron/`、`server/`、`tests/` |
| P1 | 技术栈写为 React/TypeScript/DSH Host | 改为现有 HTML/CSS/JS、Electron 主进程/受控 preload、Node 内置测试与根目录已有 PDF.js |
| P1 | 将插件构建与 Host 运行当交付 | 改成 Electron 窗口验证、NSIS 与 portable `.exe` 验收；开发网页只作辅助 |
| P1 | 混淆已有 PPT 反馈与通用批注 | 计划保留 `ppt-feedback` 数据兼容，并先审计图像、PPT、文档、HTML、网页的实际支持能力 |
| P2 | 可能重复造导航、存储及业务面板 | 按当前视图和业务模块重排入口，只有缺失的“记忆与偏好”承载方式需先盘点 |
| P2 | 设计草图状态被当产品验证 | 所有阶段以根目录测试和 Electron 真窗口/真文件验收，演示稿状态仅作为交互评审证据 |

## 3. 用户要求覆盖与阶段任务

| 用户要求 | 计划覆盖 | 完成证据 |
| --- | --- | --- |
| 七板块分别设计、各自页面与流程 | 阶段 A、C | 根目录应用中每块有独立信息布局；关键动作真实更新目标记录并可返回 |
| 简洁首页、按需弹选项、工作台 A＋C | 阶段 A | 首页无流程表单堆叠；问题出现条件明确；切换查看/专注模式保留任务、输入与位置 |
| 图片、PPT、文档、HTML、网站等实际内容批注 | 阶段 B、D | 格式能力矩阵、真实样本、定位精度与失败状态；不得用假内容冒充文件预览 |
| 多种批注、可识别批注对象 | 阶段 B | 独立批注 ID、文本/页面/区域/元素定位、意见类别、保存/编辑/撤销/重定位和版本状态 |
| 批注优先生成修改提示词 | 阶段 B、C | 只将所选且定位有效的意见和对应证据带入独立可编辑提示词；不覆盖手改稿 |
| 七板块间结果去向与保存 | 阶段 C | 验证资料、提示词、稿件、证据、计划、偏好、设置数据不会只留在临时完成页 |
| 桌面 EXE 的数据、兼容和发布验收 | 阶段 D | Electron 隔离用户目录回归、NSIS/portable 实测、日志与可回退版本记录 |

## 4. GitHub 复用对计划的影响

此前已按固定提交核对 Hypothesis、Annotorious、PDF.js 与 react-pdf-highlighter-extended 的定位逻辑、源码和许可证；详细来源、SHA 固定链接、许可证及版本冲突见[设计自查与复用依据](./2026-11-10-design-audit-and-reuse.md#4-github-复用依据与边界)。

实施决策保持克制：借鉴 Hypothesis 的多级文本定位、Annotorious 的批注生命周期与撤销、PDF.js 的页面坐标/笔迹思路；优先复用根目录已声明的 `pdfjs-dist` 6.4.299，不默认新增 React 包或另一版 PDF.js。直接复制代码前需确认许可、归属、NOTICE、依赖和 Windows 打包内容。引用逻辑是方案依据，不代表已经移植或许可自动覆盖。

## 5. 阶段入口和执行顺序

1. **A：导航与工作台**（任务 1–5）——先锁定应用边界、重组入口和任务态 A/C。
2. **B：真实资料与批注**（任务 6–14）——按格式验证真实查看能力，建立位置、意见、版本与提示词闭环。
3. **C：七板块业务衔接**（任务 15–21）——沿用现有业务模块，补真实保存、返回和跨页携带。
4. **D：数据、真样本与交付**（任务 22–24）——回归现有数据、验证 Electron 窗口与 Windows 包。

每阶段只在所列检查通过后勾选；Office 转换、网页捕获、PDF worker 或定位能力若被格式关口阻挡，应记录具体不支持项，不得把模拟流程记为完成。

入口：[全产品重设计实施总计划](../plans/2026-11-10-product-redesign-implementation.md)。

## 实施进度补记（2026-11-11）

阶段 B Task 13 已实现：有效批注按多资料来源分组；结构性互斥意见明确排除；无有效批注提示、逐条返回批注来源与手改覆盖确认已接入。相关 49 项测试、`pnpm check` 与定向 `git diff --check` 均通过。Task 14 版本快照/备份、真实窗口的提示词来源跳转，以及网站、Office、七板块交接和安装包验收仍未完成；详见[阶段 B 计划](../plans/2026-11-10-product-redesign-02-annotations.md)。

阶段 C Task 17 补齐资料库与提示词收藏到写作稿件的来源交接：复用已有批注草稿保护、写作向导、材料规范化、提示词变量填写/预览，不增加新依赖或复制外部代码。资料库传递已保存摘要/摘录、来源 URL、ID 和版本；提示词传递变量替换后的完整正文、ID 和版本。材料默认待用户勾选；取消保留原输入；快照超过 8000 字明确拒绝。UI 三类交接用例、schema 48 项、提示词 50 项、e2e-smoke 29 项通过，`pnpm check` 与 diff 检查通过。写作 UI 全套仍有 2 项备份导入文案旧断言失败；真实 Electron 窗口验收仍待完成。

## 实施进度补记（2026-11-12）

阶段 C Task 15 已补齐资料条目的相对路径、来源 URL、网页抓取时间、格式/解析方式及可用摘录能力元数据，并进入详情与备份字段白名单。复用 `writing-workbench-schema` 现有来源位置规范化和 `server/web-page-reader` 安全读取链路；未保存绝对本机路径，未引入新的查看器依赖。资料/写作/网页读取/备份/e2e 定向测试 229 项通过，`pnpm check`、`git diff --check` 通过。该能力仅表明来源元数据可回看，不代表网站 DOM 批注或 Office 保真预览已实现。

阶段 C Task 20–21 复核通过：偏好管理继续复用 `writingMemories` 和任务级快照/跳过；模型凭证继续经 Electron `safeStorage`；设置导入继续使用本应用 JSON/ZIP 的预览与事务回滚。工作台/e2e 112 项、设置与备份 63 项通过。迁移尚不支持 DSH 插件数据或未定义的第三方格式；七板块 Electron 真窗口走查与阶段 D 安装包验收仍待完成。

阶段 D Task 22 已补充完整隔离工作区 ZIP 往返和 Electron IPC 取消验收：旧任务、两份附件、点/区域批注、手改提示词、引用快照、写作稿件与偏好均核对恢复；取消时原附件、批注和设置文件字节不变。归档/IPC 18 项、备份/设置 53 项、导入预览 1 项通过，`pnpm check` 与目标 diff 检查通过。设置文件使用测试用 safeStorage 替身；真实 Windows safeStorage、Electron 窗口全流程与安装包仍待验收，详见[桌面 EXE 验收记录](../acceptance/2026-11-10-desktop-exe-acceptance.md)。
