# 向前一步 DSH 插件阶段一验收状态

日期：2026-11-03（Asia/Shanghai）
DSH：`0.2.0-rc.2`
插件：`@local/forward-step-dsh@0.1.0`
隔离 profile：`.dsh-workspace/.verification/dsh-desktop-isolated-20261102/profiles/desktop`

## 最新结论（2026-11-03 19:50）

阶段一/H4 **通过**。隔离 DSH 中用真实 `deepseek-account/deepseek-flash`（UI 标签 `DeepSeek-V41-Flash`）进行两次 A/B 探针；每次均为两条任务请求、两条标题辅助请求，A/B marker 与 Session 相互隔离，两个 Agent turn 完成且资源释放。Plugin Manager 停用后侧栏与探针按钮消失；重新启用后侧栏恢复且 Host RPC 返回 `observed:true`；重新启用后的模型复测仍为 2+2 请求，没有重复注册。

生命周期判断同时依据本机 DSH `0.2.0-rc.2` Loader/Cordis fiber dispose 语义、插件 `ctx.effect` 异步 cleanup 及自动卸载等待测试。用户已允许以本机安装包源码/接口指纹与 Desktop 验收证据替代固定 GitHub 构建 commit 的精确源码和 Windows MCP 专属回执；固定 commit `04f392c9ddd144fa426da2045178797da6db6c11` 未逐行核对，未使用其他 tag 冒充。桌面交互本轮使用 Windows UI Automation，不标为 Windows MCP。

## 本轮最新自动化与运行状态

- `pnpm --dir dsh-plugin/forward-step-dsh run build`：Host RPC 14 个，Client bundle 构建成功，退出码 0。
- `node --test tests/dsh-plugin/*.test.mjs tests/prompt-agent-coordinator-prepared-request.test.mjs`：91/91 通过，0 失败，退出码 0。
- 在 `dsh-plugin/forward-step-dsh` 目录执行 `pnpm pack --dry-run`：成功，tarball 预演包含 39 个运行文件；仓库根目录 `pnpm --dir ... pack` 的 7 文件结果不作为包验收。
- 实际隔离 Desktop PID `16324`，Host PID `29384`；启动时间均晚于本轮构建，命令行指向隔离 `electron-user-data` 与 `profiles/desktop`。普通 DSH profile 未参与。
- 真实模型回执：`desktop-real-model-ab-isolation-20261103.json` 与 `desktop-real-model-ab-after-reenable-20261103.json`；生命周期回执：`desktop-plugin-disabled-20261103.json`、`desktop-plugin-enabled-after-cycle-20261103.json`。对应截图与哈希写入收据。

## 后续范围

阶段一已通过，可以进入阶段二。阶段二至五功能、故障/真实效果验收与用户反馈仍未完成；文章/PPT 首版仍只生成规划和外部 AI 执行提示词，直接调用 DSH 制作成品保留为后续方向。原应用与插件副本继续并行保留。

## 历史自动化/桌面记录（本轮 19:50 前）

### 自动化结果

| 检查 | 命令/位置 | 结果 |
|---|---|---|
| 构建 | `pnpm --dir dsh-plugin/forward-step-dsh run build`（工作目录 `.dsh-workspace`） | 通过；Host RPC 13 个，Client bundle 构建成功 |
| 专项回归 | `node --test tests/dsh-plugin/*.test.mjs tests/prompt-agent-coordinator-prepared-request.test.mjs`（工作目录 `.dsh-workspace`） | 89 通过，0 失败 |
| 打包预演 | `pnpm --dir dsh-plugin/forward-step-dsh pack --dry-run` | 成功；清单包含 `vendor/core/manifest.json`、memory、写作和 PPT 核心 |
| 差异检查 | `git diff --check`（仓库根目录） | 退出码 0；仅有既有 LF/CRLF 提示 |

## 隔离 Desktop 收据

- `.verification/phase1-desktop-probe-20261102/desktop-post-restart-restored-task-and-storage-20261103.json`：PID `17496` 正常退出后由 PID `31784` 重启；读取恢复 2 个任务、修订 3、当前会话任务绑定，并读回 marker `forward-step-probe` / `stored:true`。
- `.verification/phase1-desktop-probe-20261102/desktop-plugin-uninstall-after-store-fix-20261103.json`：真实卸载后 `dependencyPresent=false`、`bundlePresent=false`、`packageDirectoryPresent=false`、`sidebarEntryPresent=false`。
- `.verification/phase1-desktop-probe-20261102/desktop-plugin-reinstall-activate-20261103.json`：由本地插件副本重装并启用，bundle 与侧栏入口恢复。
- `.verification/phase1-desktop-probe-20261102/desktop-plugin-reinstall-functional-after-20261103.json`：重装后项目任务读取、RPC `observed:true`、测试适配器 Agent/Session 隔离 `passed:true`、持久化读取 `stored:true`。
- 所有桌面交互使用 Windows UI Automation；这些记录不是 Windows MCP 收据。Agent/Session 探针使用临时固定响应适配器，不代表真实模型调用或模型输出质量。

### 尚未通过的 H4 门槛（本轮 19:50 之前的历史记录）

- 真实模型 A/B 隔离：现有 `passed:true` 是固定响应适配器结果，不是模型适配器实际收到的完整消息审计。
- 生命周期释放：已有禁用/卸载/重装 UI 状态证据，但缺少停用/关闭后 Host service、订阅、Agent 资源确实释放且重新启用只注册一份的运行态证据。
- 当前隔离 DSH 主进程已退出；普通 DSH profile 的实例仍在运行。为避免误用默认 profile，不在该实例中继续 H4。隔离 profile 的 `package.json` 当前包含 `@local/forward-step-dsh` bundle，并指向工作空间副本；下次以隔离启动脚本重启后继续。

## 后续边界（本轮之前历史记录）

已通过的子项只表示 DSH 插件接入、隔离运行态、RPC/取消、存储重启恢复及安装生命周期具备继续验证基础；阶段一整体仍未通过。真实模型端到端效果与阶段二至五的产品功能仍待验收。原应用与插件副本继续分开保留；交付点到达后，只选择插件相关文件及必要设计、计划、验收记录提交到现有仓库独立分支。



## 2026-11-03 19:18:42 本轮重建与专项核验

- 构建命令：`pnpm --dir dsh-plugin/forward-step-dsh run build`（工作目录 `.dsh-workspace`）；Host RPC 14 个、Typert 产物生成，Client bundle 构建成功，退出码 0。
- 专项回归命令：`node --test tests/dsh-plugin/*.test.mjs tests/prompt-agent-coordinator-prepared-request.test.mjs`（工作目录 `.dsh-workspace`）；91 通过、0 失败、0 取消，退出码 0。
- 探针代码复核：真实模型隔离探针分别创建 A/B Session，并在 `llm/stream` 边界捕获角色、消息数量、文本长度、指纹和 marker 命中；结果不回传正文。卸载会取消活动探针并等待结束后关闭存储。代码及自动化契约已验证，未等同于真实模型或运行态生命周期通过。
- 隔离 profile 插件目录是指向工作空间副本的 Junction；`index.js`、`client.js`、`lib/host-service.js`、`lib/typert.host.js`、`lib/typert.remote-client.js` 均与刚构建的工作区文件哈希一致。
- 隔离 DSH 主进程 PID `35360` 于 2026-11-03 18:25:11 启动；本轮产物于其启动后生成（Client `19:16:10`，Host `18:53:54`）。因此当前进程不能作为已加载最新产物的证据。本轮未运行真实模型 A/B 探针，也未声称运行态资源释放验收通过；待隔离实例以本轮产物重启后再测。
- 阶段一/H4 仍未通过；原应用修改与插件副本保持并存，不在本轮混合提交。

### 打包预演调用方式复核

- 从仓库根目录使用 `pnpm --dir dsh-plugin/forward-step-dsh pack --dry-run` 时，pnpm 预演输出只有 7 个文件，属于该调用方式没有在目标包目录执行的误导性结果；该结果不作为插件包验收。
- 改为在 `.dsh-workspace/dsh-plugin/forward-step-dsh` 目录执行 `pnpm pack --dry-run` 后，预演清单包含 `client.js`、`lib/*`、`core/*`、`memory/*`、`vendor/core/*` 及 Skill/locale/manifest 等 39 个文件，命令成功。没有包过滤缺陷，无需代码改动。

## 2026-11-03 19:50 H4 最新闭环

- 隔离 DSH 由 `launch-isolated-dsh.ps1` 正常启动：Electron PID `16324`，Host PID `29384`；命令行指向 `.verification/dsh-desktop-isolated-20261102/electron-user-data`，Host profile 指向 `.verification/dsh-desktop-isolated-20261102/profiles/desktop`。运行 profile 的插件包 Junction 直接指向 `dsh-plugin/forward-step-dsh`；入口产物哈希见 `latest-plugin-build-sha256-20261103.txt`。
- Host/Client RPC 桌面往返：`{"ok":true,"value":{"marker":"dsh-sidebar-probe","observed":true}}`。收据 `desktop-plugin-enabled-after-cycle-20261103.json`，截图 `desktop-plugin-enabled-after-cycle-20261103.png`。
- 真实模型第一次 A/B 结果 `passed:true`：`taskRequestCount=2`、`auxiliaryRequestCount=2`、`sessionsDistinct=true`、`requestAIsolated=true`、`requestBIsolated=true`、`agentsDisposed=true`；两个 Turn 均 `completed`，Agent 均 `idle`。收据 `desktop-real-model-ab-isolation-20261103.json` 与截图 `desktop-real-model-ab-isolation-20261103.png`。
- Plugin Manager 停用后实际 `toggle=Off`、侧栏入口不存在、真实模型探针按钮不存在；收据/截图 `desktop-plugin-disabled-20261103.json` / `.png`。重新启用后 `toggle=On`、侧栏入口恢复，RPC `observed:true`；收据/截图 `desktop-plugin-enabled-after-cycle-20261103.json` / `.png`。
- 在一次完整停用→启用之后再次真实模型 A/B：仍为 2 条任务请求与 2 条标题辅助请求、A/B 互斥、不同 Session、Agent disposed；未出现重复 `llm/stream` 捕获。收据 `desktop-real-model-ab-after-reenable-20261103.json`。
- 构建 `pnpm --dir dsh-plugin/forward-step-dsh run build`：14 Host RPC/descriptor，Client bundle 成功，退出码 0；专项回归 `node --test tests/dsh-plugin/*.test.mjs tests/prompt-agent-coordinator-prepared-request.test.mjs`：91/91 通过；在插件包目录运行 `pnpm pack --dry-run`：含 39 个运行文件并成功。隔离实例在最新构建后启动并加载该构建。
- 启动时间更正历史记录：此前 PID `35360` 对应旧实例；当前有效收据使用 PID `16324`/`29384`。Windows MCP 本轮未暴露，桌面交互准确标注为 Windows UI Automation。
