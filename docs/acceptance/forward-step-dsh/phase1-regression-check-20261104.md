# 阶段一/H4 最新构建复核

日期：2026-11-04（Asia/Tokyo）
隔离 profile：`.dsh-workspace/.verification/dsh-desktop-isolated-20261102/profiles/desktop`

## 已核验

- 隔离 DSH 主进程 PID `15748` 仍在运行，启动参数指向隔离 `electron-user-data`；Host 命令行指向同一隔离 profile。
- 隔离 profile 的 `node_modules/@local/forward-step-dsh` 是工作区插件目录的 Junction。最新 A5 构建后重新核对 `index.js`、`client.js`、`client/drafts.js`、`lib/host-service.js`、`lib/typert.host.js`、`lib/typert.remote-client.js`，6/6 SHA256 与工作区一致；`client.js` SHA256 为 `3351BA60F180CF2D2A02513B9401DA7428B366AD3AA3FDA5E60A93E4ABDA0448`。
- 最新插件构建：`pnpm --dir dsh-plugin/forward-step-dsh run build`，Host 与 Client 构建成功，退出码 `0`。
- 最新专项回归（包含 A5 草稿持久化）：`node --test tests/dsh-plugin/*.test.mjs tests/prompt-agent-coordinator-prepared-request.test.mjs`，`105` 项通过、`0` 失败、`0` 跳过，退出码 `0`。
- 最新包预演：在 `dsh-plugin/forward-step-dsh` 执行 `pnpm pack --dry-run`，成功；清单包含 `client/drafts.js`、Client、Host、Agent、memory、vendor/core 与 Skill 文件。

## 当前桌面复验状态

- 2026-11-03 的真实模型 A/B、插件停用/重新启用和重启恢复收据仍可证明当时被测构建通过，详见 `phase1-acceptance-status-20261103.md` 及 `.verification/phase1-desktop-probe-20261102/` 下对应 JSON/截图。
- 当前 DSH 主进程 PID `15748` 启动于 2026-11-03 21:24，早于当前 `client.js`、Host bundle 与草稿模块构建。profile 磁盘 Junction 文件与最新源 6/6 一致，但不证明运行中的 renderer/Host 已加载该版本。因此本记录不把旧进程结果冒充为最新构建的桌面验收。
- Windows MCP 显示 DSH 窗口最小化。尝试切换后，前台窗口仍为 `StudentGrowthApp – build.gradle.kts (StudentGrowthApp)`；`WaitFor(active_window=DeepSeek Harness)` 超时，点击任务栏返回 `USER_CONTROL`。未关闭、强制终止或重启该进程，也未运行最新构建的真实模型探针。
- 结论：历史 H4 收据保持通过；最新构建的运行态复核待完成。此差异不影响上述构建、自动回归和打包结果，也不作为阶段一最新构建闭环通过的证据。

## 下一步桌面验收

1. 在隔离 DSH 窗口前台确认插件版本与侧栏“向前一步”入口。
2. 在“向前一步”侧栏选定 `deepseek-account/deepseek-flash`，运行“验证真实模型 A/B 消息隔离”，保存消息数、marker 隔离、Session 差异和 Agent 释放结果。
3. 在 Plugin Manager 停用插件，确认侧栏入口及探针按钮消失；重新启用后确认 RPC 成功且入口只注册一次，再运行一次真实模型 A/B。
4. 新收据记录隔离 profile、主/Host PID、启动时间、插件关键文件 SHA256、模型/探针结果及截图哈希；全部通过后再把 H4 最新构建复核标为完成。
