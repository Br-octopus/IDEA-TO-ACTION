# 全产品界面重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落实第四版七板块设计与跨资料批注生成修改提示词，同时保留既有任务、数据和业务能力。

**Architecture:** 先形成稳定导航和工作台，再接真实内容与批注，随后重排现有领域页面；最终按真实用户路径验收。复用既有 React 面板、任务事务、附件服务、版本与备份，不创建新的路由框架、统一插件平台或第二套存储。

**Tech Stack:** React 18.3.1、TypeScript、原生 DOM/SVG、现有 PDF.js、DSH 0.2.0-rc.2、Node 内置测试、现有浏览器工具。

---

## 计划范围与入口

本计划是“总计划＋四份按依赖执行的子计划”。各子计划均有独立可交付结果；仅第一阶段完成不能宣布整个重设计完成。

2026-11-10二次自查：原计划有8类细节缺口，现已回填各子计划；详见[实施计划自查记录](../specs/2026-11-10-implementation-plan-audit.md)。所有注释功能都有实施和验收落点；Office转换、网站截图与宿主渲染仍需按任务6/8/9取证后锁定，不能把“有计划”写成“能力已经实现”。

| 阶段 | 任务 | 可验收结果 | 依赖 |
| --- | --- | --- | --- |
| A | 1–5，见 [导航与工作台](./2026-11-10-product-redesign-01-workspace.md) | 七导航、简洁首页、按需对话、A/C 和任务隔离的查看状态 | 基线与宿主能力核查 |
| B | 6–14，见 [资料查看与批注](./2026-11-10-product-redesign-02-annotations.md) | 真实资料、多个独立批注、版本定位、可编辑修改提示词 | A；格式和附件能力检查 |
| C | 15–21，见 [七板块业务衔接](./2026-11-10-product-redesign-03-pages.md) | 各页有自己的布局，操作更新真实结果，跨板块传递所选内容 | A；涉及查看批注的任务依赖 B |
| D | 22–24，见 [验收与发布](./2026-11-10-product-redesign-04-acceptance.md) | 数据回归、真样本、隔离宿主、打包与可回退版本 | A/B/C |

执行顺序：1→2→3→4→5→6→7→8→9→10→11→12→13→14；15–21 按板块推进；22–24 收尾。资料转换能力失败只阻断该格式，不阻断其他页面，但整体验收仍记录未通过项。

## 已核对的代码事实

- 应用改动仅在 `D:/VScode/项目/提示词工具/.dsh-workspace`。原应用目录保留，当前大量无关改动不得提交或清理。
- `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts` 约 1800 行，当前通过锚点把多个面板堆到同页；Panel 的业务回调和任务状态应保留。
- SettingsPanel 首次挂载会读取偏好、模型并调用 onSaved。第一阶段保持其控制器挂载，只隐藏展示；不可把默认模型初始化推迟到用户打开设置。
- `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/client/drafts.js` 按项目＋任务保存草稿，可追加 view 字段；不要把源文件二进制或大截图放入 localStorage。
- 当前 PptVisualFeedback 只有单点 target；多形状必须扩展，原批注兼容不可删除。
- 现有材料解析以摘录为主，原始文件未形成统一保真查看链路；任务 6–9 必须先解决来源、字节和真实渲染。
- `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/host-service.ts` 已有当前任务校验、流式上传/下载、取消与附件能力。新资料接口按同样约束做，不把社媒 attachmentId 冒充通用资料 ID。
- 客户端测试读取构建后的 client.js，修改 TS 后先构建再测试；VM React harness 不等于真实浏览器。
- 本轮读取到 Node v24.14.1、pnpm 10.33.3；存在根目录和插件各自 pnpm-lock.yaml。执行时复核，不在计划阶段安装依赖。

## 文件职责图

| 文件或文件组 | 职责及变化 |
| --- | --- |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts` | 保留任务控制器，接七导航、首页、资料打开及保存；逐块移出显示结构，不同时重写业务 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/workspace-shell.ts`（新） | 导航页生命周期、A/C 展示及局部样式，复用 DSH 宿主变量 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/client/workspace-view.js`（新） | 小型查看状态转换，复用 drafts.js 持久化 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/material-viewer.ts`（新） | 当前资料的真实呈现、页码/缩放、文字与区域选择 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/material-rendering.js`（新） | Office转换/固定快照的受控入口、取消、超时与输出核验；真实取证后锁定适配 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/client/material-target.js`（新） | 原图坐标、文本引用定位；不执行远端 HTML |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/material-review.js`（新） | 批注验证、确定性提示词、旧点位迁移、版本失效 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/annotation-panel.ts`（新） | 多批注意见、独立勾选、编辑/撤销和生成前问题 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/types.ts`、core/tasks.js、src/host-service.ts | 持久化元数据、任务归属校验与 Remote 接口；生成代码由脚本生成 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/schema.js`、core/backup.js、core/backup-archive.js | 新资料上传恢复注册表、旧数据兼容和原件/批注附件往返恢复 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/knowledge-panel.ts`、external-references-panel.ts | 资料检索/详情/导入/引用和查看器入口 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/assets-panel.ts` | 提示词、案例、方法卡独立子页和实际正文复用 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/client/prompt-variables.js`（新） | 只处理双花括号变量与缺失项，不引入模板框架 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/writing-workspace-panel.ts`、writing-packs-panel.ts | 稿件、轮次、采用、规则快照 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/writing.js`、vendor/core/writing-workbench-schema.js | 采用稿件引用、采用历史与撤销；与已有轮次复盘状态分开 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/domain-workbenches-panel.ts` | 学术/社媒页分区，保留既有远端动作与取消 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/memory-panel.ts`、settings-panel.ts、backup-panel.ts、migration-panel.ts | 独立入口、清晰状态、数据影响和恢复路径 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin` | 复用同名领域测试；新 helper 测试和真实路径回归 |
| `D:/VScode/项目/提示词工具/.dsh-workspace/docs/superpowers/acceptance` | 样本清单、逐项证据、宿主/模型验收记录 |

仅在确实减少 index.ts 耦合时提取显示组件；不复制七套状态框架。新纯函数保持短小，行为已存在时直接调用原实现。

## 设计要求与任务覆盖

| 设计要求 | 落点 |
| --- | --- |
| 七板块独立页面、统一视觉、初始干净 | 2、3、15–21 |
| 按需弹出问题、可稍后/返回 | 3、13、17–21 |
| A/C、窄屏、页码/草稿/缩放保留 | 4、5、8、23 |
| 首页添加资料、运行中按阶段呈现、历史归档恢复、真实追问触发 | 3、4、23 |
| 图片/PDF/PPT/Word/HTML/网站真实内容 | 6–9；真实样本关口 23 |
| 文字、高亮、下划线、删除线、框、圈、箭头、笔、便签、整页/整份 | 10–12 |
| 来源版本、重复原文、改版重新定位 | 6、10、12 |
| 同资料新旧版本并列、区域图存取、旧提示词批注快照 | 6–8、12–14、22 |
| 选择批注、冲突与缺图、可编辑提示词、旧稿保护 | 13、14 |
| 资料筛选交集、详情、重复、版本、移除与引用 | 15、22 |
| 收藏正文、变量、版本、案例、方法卡 | 16 |
| 写作轮次、新稿比较采用、专业包 | 17 |
| 学术证据、题录、投稿与回应；社媒计划、取消、结果 | 18、19 |
| 偏好来源/范围、建议、撤销；无任务状态 | 20 |
| 配置/连通区分，备份/恢复/迁移与部分失败 | 21、22 |
| 键盘焦点、保存失败、取消、跨任务竞争 | 5、12–14、23 |
| 旧任务/旧批注、附件备份、发布回退 | 12、22、24 |

## 统一执行与检查约定

所有命令使用 pwsh.exe；每份子计划开头给出工作目录。每个任务按“失败用例→确认失败原因→最小改动→通过→提交”推进；纯文档/样式调整只做对应静态或视觉检查，不强行添加镜像测试。

构建顺序（修改 Host/types 时三步全做；仅前端改动只做第三步）：

```powershell
Set-Location -LiteralPath 'D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh'
pnpm run build:host
if ($LASTEXITCODE -ne 0) { throw 'Host构建失败' }
node scripts/generate-typert.mjs
if ($LASTEXITCODE -ne 0) { throw 'Remote生成失败' }
pnpm run build:client
if ($LASTEXITCODE -ne 0) { throw '客户端构建失败' }
```

每条命令退出码应为 0；生成远端契约后运行 typert.test.mjs。不得手改 lib/typert.* 和 client.js 来绕开 TS 源码。每条后续任务的预期结果都是验收目标，不代表本轮已执行。

测试目录命令统一从 `D:/VScode/项目/提示词工具/.dsh-workspace` 运行。新增文件可使用 test_ 前缀；既有领域测试继续原命名。失败先判断是本次回归还是基线问题，不借机重构无关模块。

提交使用路径清单和中文 Conventional Commits；检查暂存差异后再提交，不使用 git add .。既有文件含无关修改时按块暂存。本轮不替实施阶段提交任何产品改动。

## 开源复用与能力关口

引用来源、提交和许可见[原设计自查报告](../specs/2026-11-10-design-audit-and-reuse.md)及[本轮源码复核](../specs/2026-11-10-implementation-plan-audit.md)。任务8直接复用本地PDF.js；任务10借鉴Hypothesis的原文核对和多种定位；任务11默认现有React+SVG，借鉴Annotorious的生命周期和撤销清理，整包保留为取证候选。暂不添加依赖PDF.js4的react-pdf-highlighter-extended。计划明确区分已有依赖复用、独立实现借鉴和实际复制源码；后者提交前记录源文件/commit/许可证/本地差异并随任务24打包。新增安装按用户约定确认。

任务 6–9 的能力报告必须包含实际值：DSH 能否读取/保存原文件字节，PDF worker 能否载入，网站能否得到固定快照，Office 是否有可靠转换能力。结果写“支持/受限/未通过”及证据，不用示例截图填成功。没有可靠 Office 转换时保留原文件、文本视图和用户提供的整页图入口；PPT/Word 原始预览这项验收保持未通过，不能据此关闭整个需求。

## 执行方式

推荐使用已存在的 `C:/Users/Alarm/.codex/skills/subagent-driven-development/SKILL.md` 按任务实施与复核；每次委派只给明确文件和验收条件，共享 index.ts 与 types.ts 的任务串行处理。可在当前会话顺序执行；开始前再核对 executing-plans 技能的实际入口，本轮未调用实施技能或创建子 Agent。

建议先实施阶段 A；每阶段交付后检查实际页面，再进入下一阶段。阶段 B 的格式能力取证是技术关口，不承诺未经验证的 Office 或网站转换。任务内已列操作顺序；实际执行时每完成一个测试、一个接口或一个页面接线就更新复选框，不能把整个阶段作为一个大提交。

可复用的实施入口提示词：

```text
按 docs/superpowers/plans/2026-11-10-product-redesign-implementation.md 实施，先执行阶段 A。
仅在 .dsh-workspace 副本修改，保留已有无关改动。
读取对应子计划与实际源码后逐任务推进；业务接口优先复用，按需保留页面草稿。
每项先确认失败用例，再做最小改动并验证；构建客户端后再运行读取bundle的测试。
真实预览与批注必须通过真样本；遇未验证格式记录证据，不用示例页冒充完成。
更新任务复选框，交付实际变化、验证结果、未完成项与下一任务。
```

## 计划自审记录

- 四组引用与七板块均已映射到任务；真实查看、多批注和数据恢复分别有独立验收项。
- 区分当前已存在 API 与本计划新增接口，新增接口在子计划定义，不将草图函数当生产 API。
- 对不能凭当前环境确认的转换能力设置取证任务及通过标准，没有把未知支持状态写成成功。
- 实施完成必须提供真实样本与宿主证据；仅单测或可点击原型不够。
- 首次计划检查为12个示例通过。二次自查新增回归复现2个原计划逻辑问题，修订后13个文档示例和4个专项回归通过；记录与复跑脚本见自查报告。检查仅验证计划代码片段，不等于产品代码已实现或产品测试已通过。
- 自审修正了首页选项受控状态、React children类型、上传恢复注册表的schema/备份落点，以及“确认轮次”和“采用正文”的区别。对新建文件的后续Modify引用按前置任务核对。
- 二次修订还补齐：任务3的真实追问/添加资料/进行中界面、失败时以内存草稿为准、版本标签键、批注快照、证据上传读取、早期附件往返、格式关口出口、跨行文字标记、冲突和容量决定、列表刷新失败，以及归档完整性校验和业务提交状态的区别。

