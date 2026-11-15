# 阶段 D：桌面端数据、真实验收与 Windows 交付计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 确认重设计保留根目录应用现有数据，关键资料/批注流程在 Electron 真窗口可用，并分别验收 NSIS 与 portable `.exe`。

> **阶段 D 当前剩余（2026-11-15）：0 项数据/备份功能任务。** portable 含附件 ZIP 导入、重启恢复及两份附件哈希核对均已完成；不重复跑已通过的测试和验收。2026-11-15 新构建包的单次启动确认另见[总计划当前剩余任务](./2026-11-10-product-redesign-implementation.md#当前剩余任务精简版2026-11-15)。

**范围：** 交付对象是仓库根目录「向前一步」Windows Electron 桌面应用；验收 NSIS 安装包与 portable `.exe`。不把浏览器开发入口或 `.dsh-workspace/dsh-plugin` 插件作为交付对象。

**Architecture:** 使用现有 Electron 用户数据目录、附件存储、备份/恢复与 electron-builder 配置；测试和恢复均在独立副本/用户目录进行。浏览器开发入口不能代替 Electron IPC 或 Windows 包验收。

**Tech Stack:** Electron、Node 内置测试、pnpm、electron-builder、SHA-256、现有 Playwright/浏览器 smoke 方案（仅作辅助）。

---

### Task 22：旧数据、批注附件与备份往返

**Files:**
- Read/Modify only if regression found: `prototype/workspace-backup.js`、`prototype/backup-manager.js`
- Read/Modify only if needed: `electron/backup-store.js`、`electron/workspace-backup-archive.js`、`electron/ppt-feedback-attachment-store.js`
- Test: `tests/workspace-backup.test.js`、`tests/workspace-backup-archive.test.js`、`tests/backup-store.test.js`、`tests/backup-manager.test.js`

- [x] 构造隔离用户数据夹具：旧任务、旧 PPT 点/区域批注、多个附件、提示词手改版本、写作稿件、设置和偏好；不读取真实用户目录。
- [x] 在副本验证导出 → 新副本导入 → 字段/附件哈希比较；损坏或缺失附件报告逐项结果，不静默跳过。
- [x] 验证恢复冲突预览与取消；取消或失败前后原数据字节/记录一致。

**2026-11-12 验收记录：**阶段 D Task 22 在系统临时目录完成隔离验证，没有读取真实用户目录。ZIP 夹具含旧任务、两份图片/PDF 附件、旧式点/区域批注、手改提示词与引用历史、写作稿件、写作偏好和专业包设置；导入到新的附件用户数据目录后逐项比较工作区字段与附件 SHA-256。已有 ZIP 测试覆盖损坏/缺失附件明细；已有合并测试覆盖冲突报告；新增 Electron IPC 取消测试在导入暂存后执行取消，并递归比较现有附件、批注和安全设置文件，确认路径列表与文件字节均不变。安全设置夹具使用测试用 `safeStorage` 替身，不能代替 Windows 原生加密验收。

验证：

- `pnpm exec node --test tests/workspace-backup-archive.test.js tests/electron-workbench-backup.test.js`：18 项通过，0 失败。
- `pnpm exec node --test tests/workspace-backup.test.js tests/settings-store.test.js tests/backup-store.test.js tests/backup-manager.test.js`：53 项通过，0 失败。
- `pnpm exec node --test --test-name-pattern="浏览器导入入口先确认安全备份" tests/e2e-smoke.test.js`：1 项通过，0 失败。
- `pnpm check`：退出码 0。
- `git diff --check -- tests/workspace-backup-archive.test.js tests/electron-workbench-backup.test.js`：退出码 0。

证据文件：`tests/workspace-backup-archive.test.js`、`tests/electron-workbench-backup.test.js`、`tests/workspace-backup.test.js`、`tests/settings-store.test.js`、`tests/e2e-smoke.test.js`。截至 2026-11-12，当时 Task 23 的真实样本和 Electron 真窗口验收、Task 24 的 NSIS/portable 构建与启动尚未完成；后续进展见下方记录，当前剩余项以 Task 24 的唯一待办为准。

### Task 23：真实样本、全流程与可访问性验收

**Files:**
- Test: `tests/e2e-smoke.test.js`、`tests/electron-smoke.test.js`、`tests/ppt-feedback-schema.test.js`、`tests/ppt-feedback.test.js`、`tests/electron-ppt-preview.test.js`、`tests/electron-ppt-source-reader.test.js`、`tests/web-page-reader.test.js`
- Evidence: `.dsh-workspace/docs/superpowers/acceptance/2026-11-10-desktop-exe-acceptance.md`

> **合并验收：** 桌面端批注闭环并入 Task 24 的唯一最终验收；阶段 C 已有跨板块保存证据，已有 A/C、批注、提示词与重启证据不重复走查。
- [x] 将未验证格式逐项列出；不得以示例文档或开发网页通过代替真实样本通过。矩阵逐格式记录能力状态与缺口，见[资料能力矩阵](../acceptance/2026-11-10-material-capability-matrix.md)。

| 路径 | 通过条件 |
| --- | --- |
| 工作台首页 → 新任务 → 按需问题 | 首页只见必要入口；跳过不相关问题，任务草稿不丢 |
| A 双栏 → C 资料/对话专注 → 返回 A | 资料、页码、缩放、滚动、输入和已选批注保持当前任务状态 |
| 图片/PDF/PPTX/HTML/网页 → 批注 → 提示词 | 提示词指回真实资料/版本和目标；无效定位不被带入 |
| 提示词 → 手改 → 再生成 | 手改版保留为单独版本，原意见快照可追溯 |
| 资料库 → 写作/研究/收藏 | 传递真实正文/来源/版本，保存后能从目标板块打开 |

### Task 24：Windows 桌面包、安装与回退

**Files:**
- Read: `package.json`、`electron-builder` 配置、`build/installer.nsh`、`README.md`
- Test/Build: `pnpm check`、`pnpm test`、`pnpm dist:win`
- Evidence: `.dsh-workspace/docs/superpowers/acceptance/2026-11-10-desktop-exe-acceptance.md`

- [x] 运行 `pnpm check` 和 `pnpm test`；记录现有失败、通过情况和运行环境。本轮 `pnpm check` 与全量 `pnpm test -- --test-reporter=dot` 均退出 0。
- [x] 构建 NSIS setup 与 portable `.exe` 并记录版本和 SHA-256；为保留现有 `release/`，本轮使用等价 electron-builder 命令并输出至隔离目录，而非覆盖 `release/`。完整命令和哈希见[桌面 EXE 验收记录](../acceptance/2026-11-10-desktop-exe-acceptance.md)。
- [x] NSIS 在隔离目录安装/启动；使用原生文件选择器导入 DOCX/PPTX；完整关闭/重启后恢复同一任务、两份附件及 PPTX 第 2 张；静默卸载后安装文件移除，隔离用户数据和附件哈希保持不变。证据见 `.codex-acceptance/redesign-20261114/nsis-package-import-restart/VERIFICATION.txt`。
- [x] portable 在独立目录启动，8 个板块均渲染独立标题/内容且无可见页面错误；证据见本文件后文 2026-11-14 同版本记录。
- [x] portable 含附件备份导入恢复。2026-11-15 在全新隔离数据目录导入含附件 ZIP，预览/导入成功；重启后恢复 1 个任务、2 个附件引用。两份附件各 5435 字节，SHA-256 均为 `0E547763060E903A490233C0260F6BF8E2994DE60D8440E21612B007B6C294D2`，与备份一致。详见 `.codex-acceptance/redesign-20261114/portable-final-closure-01/VERIFICATION.txt`。
- [x] 卸载数据策略明确为保留。NSIS 配置设置 `deleteAppDataOnUninstall: false`，`electron/settings-store.js` 将安全设置写入 Electron `userData`，卸载脚本不删除该目录；隔离 NSIS 卸载记录确认用户数据仍在。本项记录的是保留策略，不代表另行验证过重装后的密文解读。
- [x] 检查打包清单包含 renderer、Electron 主进程/preload、server、PDF.js worker、Office viewer、Windows canvas 原生模块与网页转换资源；仓库顶层测试/文档及 `.env` 均未进入 `app.asar`。
> 原“保留旧 EXE/安装包和数据备份”已并入以上回退前置条件，不另设重复任务；未实际完成的包操作仍标为未验收。

**2026-11-13 部分补验：**修复 Agent 回复持久化后，隔离构建 NSIS 与 portable 正式产物，记录两个 EXE 的 SHA-256；NSIS 在工作区隔离目录安装/启动/卸载，卸载前后的隔离用户数据标记字节哈希相同；portable 在独立目录启动。包清单包含主界面/主进程/本地服务、PDF.js worker 和 Office worker，不含仓库顶层测试、设计文档、环境文件及用户安全设置。详情见桌面 EXE 验收记录。新分发包尚未完成文件选择、备份、重开与完整资料流程，整项保持未勾选。

**2026-11-13 Office 失败态修复版部分补验：**本轮全量测试、语法检查、隔离 NSIS/portable 构建及 `app.asar` 清单检查通过，应用主界面哈希与当前源码一致。新版产物已生成但本轮未安装或启动；文件选择、备份、重开、卸载数据保留及完整资料流程仍未验收，因此 Task 24 继续保持未完成。

**2026-11-14 同一版本补验：**已在独立目录安装并启动上述 NSIS 版本，主界面正常打开；卸载退出码 0，隔离安装目录 EXE/卸载器删除，外置用户数据端口文件哈希卸载前后相同。portable 同版本独立启动成功，8 个页面均实测渲染独立标题与内容、无可见页面错误。定向页面/Electron/批注/备份回归 112 项通过，`pnpm check` 通过。原生文件选择器操作未能可靠观察，备份往返、重开任务、完整批注路径及七板块完整业务流程未验收；Task 23/24 保持未完成，见[桌面 EXE 验收记录](../acceptance/2026-11-10-desktop-exe-acceptance.md)。

**2026-11-14 NSIS 提示词备份往返部分补验：**同一 NSIS 版本从隔离源配置导出 1 条含变量的提示词；在全新隔离用户目录导入后，预览显示新增 1 条、无冲突、无附件错误。完整关闭并重启同一隔离目录后，renderer 存储仍读回提示词标题及 `{{验收对象}}`。记录见 `.codex-acceptance/redesign-20261114/stage-d-backup-roundtrip-01/VERIFICATION.txt`。这是无附件样本的局部通过，不覆盖 portable、附件或卸载设置策略；上方组合验收项仍保持未勾选。

