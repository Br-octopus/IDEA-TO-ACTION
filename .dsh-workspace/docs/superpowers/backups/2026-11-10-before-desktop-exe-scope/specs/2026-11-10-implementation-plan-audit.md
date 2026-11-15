# 实施计划自查与修订记录

核查日期：2026-11-10。依据：用户本轮注释中的四组要求、第四版交互稿对应设计文档、五份实施计划、当前插件源码，以及按固定提交重新读取的GitHub文件。

## 结论

原计划覆盖了功能名称，但有8类执行细节缺口，不能直接说“所有细节已设计完成”。本轮已直接修订五份实施计划，将缺口落入现有24项任务，没有将这些功能移到可选清单。

当前状态：注释中的功能均有任务及验收落点；可以开始阶段A。Office保真转换、自动网站截图、PDF worker与DSH宿主集成仍属于任务6/8/9的能力关口，需要真实取证后锁定最终实现，不以文字视图或示例截图代替完成。这一轮是计划修订，没有实施产品功能或改动第四版交互原型。

## Findings 与已采取的修订

| 级别 / 问题 | 原计划证据与风险 | 本轮修订落点 |
| --- | --- | --- |
| P1：旧提示词引用的批注会丢失 | Task14只保存basedOn的ID/revision，Task11/12会修改或删除annotations；未定义旧revision的实际保存位置 | Task6/12/14增加annotationSnapshots；生成时原子保存完整目标/意见/证据；当前批注删除或重新定位后，旧稿仍回当时内容 |
| P1：区域图没有完整存取协议 | Task7只定义原件和page读取，Task13要求evidence，却没有截图上传/引用/下载的完整字段 | Task7增加purpose与read target分支、幂等提交收据、PNG证据预览与hash读回；Task13正文与实际附件名一致 |
| P1：数据恢复晚于新数据上线，且部分失败含义不准确 | Task7开始产生新结构，完整归档留到22；当前backup-archive在校验失败/附件写失败时抛错，原计划笼统承诺损坏条目局部跳过 | Task7先做最小原件+证据往返；Task22补store/备份白名单/历史引用；损坏归档阻止提交，附件持久化失败收据与业务提交状态分开 |
| P1：新旧资料身份与定位不充分 | positions只按sourceId索引，新旧版本覆盖；locateText保存了offset却不利用；正文直接输出pageId | Task6/8使用sourceId+versionId标签键；Task10同版本先核对offset/exact/上下文，改版重找；Task13输出真实页序。后两项已用新增回归在旧计划复现失败 |
| P2：首页和运行中工作台仍可能堆表单 | Task3主要替换输入框、创建dialog；没有添加资料队列、实际追问条件、归档恢复及进行中分区 | Task3补首页资料队列、历史操作、按当前stage显示动作、nextQuestion；Task4扩大草稿覆盖且以当前内存为准；Task5按容器宽度切单区并补分隔条/回焦点 |
| P2：格式探索缺少明确实施出口 | HTML白名单会改变原站布局；Office只要求评估，未指定负责转换的文件和通过标准 | Task9增加material-rendering.js与格式测试；HTML文字/网站外观分开；Office优先既有能力，再验证本机Office→PDF路线。超时、取消、字体缺失、密码、输出验证均有步骤 |
| P2：工具与生成规则只写原则 | 跨行文字装饰、真实箭头/笔迹、撤销焦点、冲突决定与容量规则缺少约束 | Task10/11补逐行矩形和所有工具保存重载；Task13补冲突pair+revision、明确容量、included/deferred守恒、缺图分支，不能静默漏意见 |
| P2：完成页仍可能没有真实列表变化 | 各板块有保存流程，但未普遍定义“保存成功、刷新失败”的结果和重试 | 阶段C增加七板块结果更新表与写请求计数检查；区分StoredVersion和批注稿ID；Task23从真实按钮进入，验证列表、重载及跨板块传递 |

相关实际源码依据：

- client/index.ts的persistTaskDraft当前仅明确title/externalResult；methodDraftsByTask与promptEditorDraftsByTask是内存状态。新增view字段不能自动解决全部草稿持久化。
- core/store.js的validateState只补缺省集合，新增结构的引用约束需要在写入边界及备份恢复补上。
- core/backup.js使用固定COLLECTIONS和ID_FIELDS；新增记录未登记会漏导出。
- core/backup-archive.js的persistPluginBackupAttachments在onFailure后抛错；不应把“部分附件已保存”写成“部分业务数据已提交”。
- 本地node_modules/pdfjs-dist/package.json实际为6.4.299；兼容性判断依据本地包，不只看声明。

## 用户注释逐项覆盖

| 用户要求 | 实施任务 | 验收证据要求 |
| --- | --- | --- |
| 图片/PPT/Word/PDF/HTML/网站真实预览 | 6–9 | 真实格式样本、原件hash、转换记录；文本视图/固定快照能力分开 |
| 文字、高亮/下划线/删除线、框圈箭头画笔、点/整页/整份 | 10–12 | 每种工具实际建立两条独立记录，编辑/删除/撤销/重载，不只弹意见框 |
| 批注定位、资料更新与重新定位 | 6、8、10、12 | 重复句、改序、新旧版本同时打开、200%缩放/90°旋转 |
| 所选批注→主要生成修改提示词 | 13、14 | 来源、页、意图、保留项、附件、验收项；无自动改文件或自动发送模型 |
| 意见冲突、缺图、缺意图、超容量 | 3、7、13 | 单问题弹窗、可暂缓清单、未选意见不混入、无静默省略 |
| 手改提示词、旧版与原处返回 | 6、12、14 | 旧批注改动或删除后仍可回旧稿目标/图片 |
| A双栏/C专注预览/C专注对话 | 4、5、8 | 输入/选择/标签/页码/缩放/滚动/宽度保持；窄屏单区 |
| 简洁首页、按需选项、新任务恢复 | 2、3 | 空首页及任务进行中两类截图；已知信息不重问；资料队列失败可续 |
| 历史、改名、归档、恢复 | 3、4、23 | 继续原taskId，归档不清草稿 |
| 七板块独立布局 | 2、5、15–21 | 列表/正文/轮次/证据/阶段/偏好/设置各自页面，真实宿主验证 |
| 收藏旧版、案例/方法卡、写作新稿采用、研究取消、偏好撤销 | 16–20 | 各自独立数据状态、旧版保留、部分结果和冲突处理 |
| 流程完成更新实际列表及跨板块交接 | 15–21、23 | 实际正文、ID、版本和范围传递；刷新后可读；失败重试不重复写 |
| 备份恢复、迁移、打包与回退 | 7、21–24 | 原件/转换件/截图/历史批注齐全，损坏归档不改store，隔离宿主演练 |

上述内容均属于必做项。“未验证格式”不是取消范围，相关任务保持未完成；其他独立任务可以继续。

## GitHub 复用决策：由建议变成任务

本轮web检索未返回可用正文，raw读取部分出现ECONNRESET；随后GitHub连接器按固定提交成功读取下表源码与元数据。不是对最新版本或活跃度的判断。读取结果的Git blob摘要保存在 .verification/redesign-plan-audit-2026-11-10/github-evidence.json。

| 来源（固定提交） | 本轮确认 | 决策与落点 |
| --- | --- | --- |
| [Hypothesis html.ts](https://github.com/hypothesis/client/blob/a7b7400d0d706d4357ec37c2a3610b25dcca89d5/src/annotator/anchoring/html.ts)，[LICENSE](https://github.com/hypothesis/client/blob/a7b7400d0d706d4357ec37c2a3610b25dcca89d5/LICENSE) | 顺序尝试Range、position、quote，命中后核对exact；许可主体BSD两条款，并列子组件条款 | Task10借鉴定位次序；同版本用核对后的offset，跨版本重复匹配要求确认。当前计划函数是本项目最小实现，不宣称已移植上游整套锚定 |
| [Annotorious.ts](https://github.com/annotorious/annotorious/blob/f780879410ff4f2d4fd0b2cb1ae1bd596a40fe65/packages/annotorious/src/Annotorious.ts)，[package.json](https://github.com/annotorious/annotorious/blob/f780879410ff4f2d4fd0b2cb1ae1bd596a40fe65/packages/annotorious/package.json) | 3.9.5，BSD-3-Clause；store/selection、undoStack、lifecycle分离；初始化改变图像外层DOM，destroy清理图层和键盘监听；含Svelte构建部分 | Task11以现有React+SVG完成所需工具，借鉴独立ID与撤销/清理方式。整包只作候选，先验证React DOM所有权、CSS、实际工具清单及宿主打包；不能保证箭头/笔迹开箱即用 |
| [PDF.js ink.js](https://github.com/mozilla/pdf.js/blob/b600aecd1801b6a924adc85bb8d6b8b170bae107/src/display/editor/ink.js) | 文件标Apache-2.0；笔迹跟随页面缩放、序列化points和样式，内部依赖DrawingEditor等类 | Task8直接复用本地6.4.299；Task10/11参考页变换与序列化。不上游HEAD与本地版本混搭，不把内部InkEditor当稳定公共接口 |
| [highlighter coordinates.ts](https://github.com/DanielArnould/react-pdf-highlighter-extended/blob/b58a3b387d870a44051a7d032e5f67ecabeb7909/src/lib/coordinates.ts)，[package.json](https://github.com/DanielArnould/react-pdf-highlighter-extended/blob/b58a3b387d870a44051a7d032e5f67ecabeb7909/package.json) | MIT；按viewport转换坐标，保留多个文字矩形；依赖pdfjs-dist ^4.4.168、React ^18.3.1 | Task10借鉴多矩形/页尺度思想；不新增该包，避免与本地PDF.js6形成双版本/worker问题 |

实际采用规则：已有依赖直接复用；少量逻辑可独立实现；若确需移植代码，任务10/11提交前记录源路径/commit/许可证/修改点并带入NOTICE，任务24检查发布包。没有证据支持的整包替换或新增框架不进入默认路径。

## 实施顺序与完成判定

- A任务1–5：导航、首页、运行中工作台、草稿与A/C；先看到可用界面。
- B任务6–14：资料身份/原件/最小恢复→格式呈现→定位与批注→所选意见与提示词。任务9的转换关口可以提前取证，受阻不阻断无关页面，但不得标全格式完成。
- C任务15–21：分别重排现有板块，完成真实保存、列表定位和交接。
- D任务22–24：完整数据回归、真样本、隔离宿主、包与回退。

每个勾选步骤按实际完成更新；纯函数示例通过不意味着Host/React/转换器已实现。复杂格式关口产出真实命令、样本与适配决定后才关闭任务；没有自行降低原功能要求。

## 本轮实际验证

只验证计划与其中的纯逻辑片段，没有运行产品回归或真实格式验收。

工作目录：D:/VScode/项目/提示词工具/.dsh-workspace。

- 原文保存：.verification/redesign-plan-audit-2026-11-10/baseline.json，含5份原文路径及SHA256。
- 基线命令：node .verification/redesign-plan-audit-2026-11-10/check-plan.mjs baseline。
  12个原示例通过；2个新回归失败，分别为同版本重复句位置和可读页码；退出码1。这是发现缺口的预期结果。
- 修订命令：node .verification/redesign-plan-audit-2026-11-10/check-plan.mjs modified。
  13个文档示例＋4个专项回归通过；退出码0。结构检查覆盖24个任务、文件路径（含前置创建）、相对链接、标准头部与占位扫描。
- 逐项结果：.verification/redesign-plan-audit-2026-11-10/baseline-result.txt 与 modified-result.txt；最终文件摘要：modified-hashes.json。
- 这不是原型22条流程/160项检查的重跑，也不是产品能力通过。既存应用源码、原型和依赖均未修改。

入口：[修订后的实施总计划](../plans/2026-11-10-product-redesign-implementation.md)。

