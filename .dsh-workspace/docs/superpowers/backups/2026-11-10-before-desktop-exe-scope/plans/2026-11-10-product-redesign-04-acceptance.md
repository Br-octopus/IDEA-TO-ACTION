# 阶段 D：数据、真实验收与交付 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 确认重设计不会丢失旧数据，真实文件与关键流程可用，并交付经过隔离宿主验证、可以回退的插件包。

**Architecture:** 继续使用现有备份/恢复/迁移与插件打包，不建立另一套发布框架。代码版本、数据版本、样本结果分别记录；数据恢复在独立测试存储进行。

**Tech Stack:** Node test、pnpm build/pack、现有DSH隔离宿主、已有浏览器工具、SHA256。

---

工作目录：D:/VScode/项目/提示词工具/.dsh-workspace。依赖A/B/C。所有“通过”均要求实际命令结果或真实交互证据，本计划中的目标不等于已执行结果。

### Task 22：新旧数据、资料附件与恢复

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/schema.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/store.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/backup.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/backup-archive.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/migration/commit.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/host-service.ts
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/store.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/backup.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/backup-archive.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/migration-commit.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/migration-archive-import.test.mjs
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/docs/superpowers/acceptance/2026-11-10-data-compatibility.md

- [ ] **Step 1：准备独立数据夹具。** 使用现有tests临时store：旧任务无新字段、旧PPT点位、新来源两个版本、两条批注、一份手改提示词、知识条目、写作采用历史、收藏来源、未完成上传各一份。故意加一个缺失附件和一个错hash附件。只使用测试资料，不用真实用户存储。
- [ ] **Step 2：新增端到端备份断言并先运行。** 在现有backup-archive.test.mjs用真实附件Map和导入导出夹具，导出→全新store导入→比较结果；关键断言是：

    assert.deepEqual(restoredTask.methodState.materialReview,
      originalTask.methodState.materialReview);
    assert.deepEqual(restoredTask.materials,originalTask.materials);
    assert.equal(restoredBytes.byteLength,originalBytes.byteLength);
    assert.deepEqual(restoredBytes,originalBytes);

originalTask/restoredTask取测试中导出前、导入后同taskId；originalBytes/restoredBytes从实际附件接口读取，不能只检查清单条目存在。额外断言采用历史、来源版本、收藏来源、选择状态均保留。

运行 node --test tests/dsh-plugin/backup.test.mjs tests/dsh-plugin/backup-archive.test.mjs tests/dsh-plugin/migration-archive-import.test.mjs，预期新字段/附件尚未覆盖时失败。

- [ ] **Step 3：扩展既有schema与归档收集。** 任务7新增materialUploads默认空数组；旧schemaVersion=1记录缺字段时兼容初始化，校验materialReview/materialSources与来源引用。收集任务和知识条目的original/pages及批注evidence附件，按sha256去重并保留所有引用；pending-recovery不作为verified显示。维持25MiB/附件、2GiB总限制，超限明确报告。
- [ ] **Step 3a：完整遍历新增资料引用。** 同时收集rendition、promptDrafts.annotationSnapshots的历史evidence和被历史引用的source版本。JSON备份未含附件时明确标“仅元数据”，恢复后外观/附图标缺失，不能因存有storageRef就认定附件存在。materialUploads持久化收据与临时进度分开：未提交临时文件路径/内容不导出，恢复不自动重新执行上传。core/store.js的validateState与backup.js的COLLECTIONS、ID_FIELDS都要覆盖新增结构，任务7已有最小往返，本任务负责全量验证。
- [ ] **Step 4：避免恢复时改指向。** 保留sourceId/versionId/pageId/annotationId及提示词basedOn；冲突合并先建立ID映射再改所有引用。旧归档不要求新字段，不能因为缺新能力丢弃旧记录；未知高版本拒绝覆盖。资料移入回收站仍保留必要附件。
- [ ] **Step 5：验证取消、部分失败与重试。** 预览取消后store revision不变；预览后新写入导致提交冲突；按原eventId重试不重复插入。归档清单或hash损坏在stage校验阶段阻止整个导入，保留原store，不能绕过既有完整性校验。校验已通过、附件持久化中途失败时沿用onAttempt/onVerified/onFailure收据，分开列附件已验证/失败/未处理和业务数据是否提交；停止后重试复用已有验证结果。除非明确实现有独立依赖边界的分组事务，否则不承诺“部分业务数据已恢复”，不把完整事务强行拆成逐条写入。
- [ ] **Step 6：运行相关套件并记录实际结果。**

    node --test tests/dsh-plugin/store.test.mjs tests/dsh-plugin/backup.test.mjs tests/dsh-plugin/backup-archive.test.mjs tests/dsh-plugin/migration-commit.test.mjs tests/dsh-plugin/migration-archive-import.test.mjs tests/dsh-plugin/tasks.test.mjs

预期退出码0；故障注入用例本身通过，不能留下未解释失败。提交 fix: 保证新资料批注与历史数据可恢复。

### Task 23：真样本、跨板块路径和可访问性

**Files:**
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/docs/superpowers/acceptance/2026-11-10-redesign-acceptance.md
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/docs/superpowers/acceptance/2026-11-10-redesign-samples.json
- Modify when test detects a regression: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/client.test.mjs
- Modify when test detects a regression: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/full-feature-acceptance.test.mjs
- Modify when test detects a regression: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/real-model-isolation.test.mjs

- [ ] **Step 1：样本登记。** 每份登记相对样本路径、SHA256、格式、来源/可分发性、页数、预期文字层及能力。图片、文字PDF、扫描PDF、含文字与图片PPTX、重排DOCX、长网页各一个，另加重复原文和页面改序版本。样本不含私人资料；不把生成截图冒充Office真样本。样本文件实际出现后再填写摘要，不写假值。
- [ ] **Step 2：构建后执行一次完整插件回归。**

    pnpm --dir dsh-plugin/forward-step-dsh run build:host
    if ($LASTEXITCODE -ne 0) { throw 'Host构建失败' }
    node dsh-plugin/forward-step-dsh/scripts/generate-typert.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Remote生成失败' }
    pnpm --dir dsh-plugin/forward-step-dsh run build:client
    if ($LASTEXITCODE -ne 0) { throw '客户端构建失败' }
    $testPaths = @(Get-ChildItem -LiteralPath 'tests/dsh-plugin' -File |
      Where-Object { $_.Name -like '*.test.mjs' -or $_.Name -like 'test_*.mjs' } |
      ForEach-Object { $_.FullName })
    node --test @testPaths
    if ($LASTEXITCODE -ne 0) { throw '插件回归未通过' }

已核对生成脚本通过import.meta.url定位插件目录；以上根目录调用有效。记录测试数、跳过原因和exit status；未配置真实模型导致的skip不能当模型验收成功。

- [ ] **Step 3：在真实隔离宿主逐条记录下面矩阵。** 结果使用通过/失败/未验证，证据保存截图或可重放动作及实际值。

| 路径 | 必须观察到的结果 |
| --- | --- |
| 空首页→输入→开始 | 首页简洁；已明确条件不再追问；未完成输入保留 |
| 任务→A双栏→C预览→C对话→返回 | 页码/缩放/滚动/选择/输入均保留；可拖双栏宽度 |
| 两资料标签→关闭当前→全部关闭 | 选邻近标签；最后回对话；源资料未删除 |
| 每种真格式：两批注→取消一条→生成 | 只含所选意见；来源/版本/原文或区域正确 |
| 200%/90度/长页/局部滚动→回批注 | 定位仍在同一内容；无相邻页漂移 |
| 重复句/改版/页面改序 | 不默认选第一个；区域需确认；旧证据保留 |
| 画笔→Escape→切页→返回 | 草稿可续；显式丢弃才清除 |
| 保存失败→重试；两任务并行请求 | 保留输入、无重复、迟到响应不串任务 |
| 圈画无意图/冲突/缺图/超量 | 仅出现当前问题；暂缓可见；不静默省略 |
| 手改提示词→意见变化→再整理 | 旧稿不覆盖；新旧可比；复制说明附件 |
| 资料→任务；收藏→任务；稿件/证据→任务 | 实际内容与固定版本传递，返回原处正确 |
| 收藏恢复旧版、案例、方法卡 | 新版本追加；结果依据与适用边界保留 |
| 新稿→比较→采用→撤销 | 未采用不替换；撤销不删历史 |
| 社媒取消/失败/部分结果→报告提示词 | 真实结果保留；原预算不扩大；提示词不自动执行 |
| 候选偏好→确认/忽略→停用→撤销 | 作用范围与历史正确，未确认不生效 |
| 设置测试→取消；恢复预览→取消/部分失败 | 不报假成功；数据与凭据保持边界 |
| 首页加资料→任务创建失败→重试；历史归档→恢复 | 输入与文件选择保留，任务ID恢复正确，旧草稿仍在 |
| 批注区域→截图→下载→备份恢复 | 图像正确且hash一致，包含明确批注编号，旧提示词附件仍可读 |
| 同资料v1/v2同时打开→旧批注改版/删除→回旧稿 | 两个标签位置独立，旧稿回当时的版本和批注快照 |
| 跨三行高亮/下划线/删除线；箭头/画笔多条保存 | 图层实际绘制并重载，文本矩形不覆盖无关行 |
| 保存成功但列表刷新失败→重试 | 显示已保存，写请求计数仍为1，列表定位同一条目 |
| 真宿主窄面板、隐藏恢复、输入框Ctrl+Z | 按容器宽度切单区，零尺寸不渲染错误，撤销不串到批注 |

- [ ] **Step 4：布局和键盘检查。** 1440、960、390px；左导航不遮主动作；窄屏对话/资料单区切换；无整页横向溢出。Tab顺序、Escape、关闭后回焦点、对话框可访问名称、缩放200%仍可操作；批注颜色以外也有编号/类型。加载、空、无结果、权限受限、失败均提供正确下一步。
- [ ] **Step 5：真实外部能力单独取证。** 模型、Office转换、网站捕获、社媒平台各记录配置/实际请求/结果，未具备条件写未验证和受影响验收项。仅通过模拟的功能不能写完整完成。console和网络错误定位到具体资源，不只截图首页。
- [ ] **Step 6：修复验收发现后只重跑受影响项；提交 test: 验证重设计真实路径与任务隔离。** 所有设计必需项通过后方可进入最终交付，受限分支仍在报告中保留。

### Task 24：隔离安装、打包与回退验证

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/package.json
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/README.md
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/package.test.mjs
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/docs/superpowers/acceptance/2026-11-10-redesign-release.md
- Output directory: D:/VScode/项目/提示词工具/.dsh-workspace/build/forward-step-dsh

- [ ] **Step 1：核查新增运行文件的打包范围。** 新core文件已受core/**/*.js包含；client helper是否仅被bundle引用与是否需直接发布分开核对。worker/字体/样式资源有实际引用就必须进入包；许可证NOTICE随实际移植代码入包。不能靠开发机node_modules里的偶然路径运行。
- [ ] **Step 2：构建并打包。**

    Set-Location -LiteralPath 'D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh'
    pnpm run build:host
    node scripts/generate-typert.mjs
    pnpm run build:client
    pnpm pack --pack-destination ../../build/forward-step-dsh

每步退出码必须0。包名使用命令实际输出，不在计划中假定；更新README写真实安装/启动步骤和格式支持矩阵。package版本遵循现有发布约定，不无依据升级宿主版本。

- [ ] **Step 3：记录包清单与摘要。**

    Set-Location -LiteralPath 'D:/VScode/项目/提示词工具/.dsh-workspace'
    Get-ChildItem -LiteralPath 'build/forward-step-dsh' -Filter '*.tgz' |
      Get-FileHash -Algorithm SHA256
    node --test tests/dsh-plugin/package.test.mjs tests/dsh-plugin/typert.test.mjs
    git diff --check
    git status --short

检查实际新包，不从目录“最后修改时间”猜本次产物。检查无凭据/用户数据；测试解包后的资源路径。记录源commit、包hash、构建环境、数据备份和验收报告位置。

- [ ] **Step 4：使用已有forward-step-test隔离宿主安装本次包。** 安装入口沿用该宿主已验证方式；记录实际命令或UI步骤。打开七页，运行真资料/批注最短路径；停止开发服务后再试，确认没有依赖localhost原型或源码目录资源。正式宿主更新单列为发布动作，本计划阶段不执行。
- [ ] **Step 5：在第二份测试存储验证回退。** 先保存旧包与升级前真实备份→安装新包并新增批注→导出新数据→卸载新包并装回旧包→恢复升级前备份→验证旧任务/原点位可用。旧包未必理解新schema，不直接让旧包写新数据；升级后新增工作单独保留新格式导出，回退不承诺旧版可编辑新批注。记录每一步实际结果、退出状态和恢复数据量。
- [ ] **Step 6：按文件列表暂存并提交 chore: 完成重设计插件包与回退验收。** 交付新包、checksum、真实支持矩阵、已知限制和回退记录。最终说明分别写“界面已完成”“真实格式通过范围”“尚未验证外部能力”，不笼统宣称全部完成。

阶段D完成标准：新包在隔离宿主可独立运行；旧数据和新附件往返恢复通过；设计必需路径有真样本证据；回退在副本中实际演练。任何失败都保留具体阻塞项，不用原型检查数替代产品验收。

