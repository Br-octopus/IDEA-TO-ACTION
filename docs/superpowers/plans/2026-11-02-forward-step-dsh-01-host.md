# DSH 宿主核验与最小接线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在隔离配置中证明原生侧栏、模型隔离调用、数据往返和插件释放机制成立，再开始业务迁移。

**Architecture:** 以本机安装声明、已运行实例及实际请求为证据，上游案例只作为检索线索。插件内部 HostPort 与真实 DSH 接口分离；不匹配时停止在本阶段，不改宿主安装文件。

**Tech Stack:** pwsh.exe、Node.js 内置测试与哈希、现有 DSH CLI、实际宿主客户端构建工具。

---

## 工作目录和交付

所有命令在 `D:/VScode/项目/提示词工具/.dsh-workspace` 执行。下列精确相对路径均以此目录为根；只读宿主位置为 `D:/deepseek` 和 `C:/Users/Alarm/.dsh/profiles/forward-step-test`。总计划中的 W/P/G 缩写保持一致。

| 文件 | 责任 |
| --- | --- |
| `scripts/dsh-host-check.mjs` | 只读版本、程序哈希和 CLI 帮助采集 |
| `docs/acceptance/forward-step-dsh/host-fingerprint.json` | 可复现的本机程序、CLI、profile 和哈希指纹 |
| `docs/acceptance/forward-step-dsh/host-interface.json` | 能力、签名、出处、调用结果和真实启动方式 |
| `docs/acceptance/forward-step-dsh/host-binding-plan.md` | 根据实际声明生成精确接线补充计划 |
| `dsh-plugin/forward-step-dsh/host/port.js` | 内部接口校验 |
| `dsh-plugin/forward-step-dsh/host/compatibility.js` | 指纹/能力不匹配检查 |
| `dsh-plugin/forward-step-dsh/host/adapter.js` | 唯一 DSH API 调用层 |
| `dsh-plugin/forward-step-dsh/client/panel.js` | 宿主实际支持的客户端入口 |
| `scripts/dsh-test-profile.ps1` | 测试配置备份、安装、恢复 |
| `tests/dsh-plugin/host.test.mjs` | HostPort 与缺失能力测试 |
| `tests/dsh-plugin/profile.test.mjs` | 测试配置目标、恢复及路径检查 |

阶段产物是开发者探针，不冒充完整产品。业务代码尚未开始；本阶段测试数据只含固定字符串 `forward-step-probe`。

## Task H1: 建立与本机匹配的接口证据

- [x] 记录开始菜单快捷方式：目标 `D:/deepseek/DeepSeek Harness.exe`，参数为空，工作目录 `D:/deepseek`；GUI profile 选择不依赖快捷方式参数。
- [x] 执行版本、CLI 帮助、测试 profile config/schema 与程序/asar 哈希。复现收据写入 `docs/acceptance/forward-step-dsh/host-fingerprint.json`；CLI/schema 抽查 profile 为 95 项、0 诊断。
- [ ] 从 GitHub 固定本机 app.asar 构建提交 `04f392c9ddd144fa426da2045178797da6db6c11` 并逐项核对插件、客户端、模型、会话、存储的官方说明。当前 master 可作旁证，但还未证明与构建提交匹配。
- [x] 检查本机 app.asar 对应的 DSH `0.2.0-rc.2` 包 README、模板、profile loader 与 desktop host 入口。以本机证据固定 `dsh.client`、`./client`、`window.__ModuleLoader__.load`、slot 注册方式；`host-interface.json` 仅对已运行通过的 plugin/GUI 改填状态，其余保持未运行。
- [x] 查明桌面启动方式和数据根：设置进程环境变量 `DSH_HOME=<隔离根>`；Electron Desktop Host 使用 `<DSH_HOME>/profiles/desktop`。实机窗口已运行，PID `39180`，当前停在登录/API Key 欢迎页。
- [x] 为真实桌面测试复制必要的 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与副本插件 bundle 到 `.verification/dsh-desktop-isolated-20261102/profiles/desktop`；缺少 web-app 的首轮启动失败已记录，不作为插件失败。
- [x] 完成 `dsh-test-profile.ps1` 的副本安装闭环：工作空间 package/client/export/lockfile 检查通过；原 `forward-step-test` profile 文件恢复哈希通过，node_modules 按备份原 file: 来源重新安装且与原包 hash 相同。
- [x] 写入 `host-binding-plan.md`、`host-probe.md`，记录真实启动入口、程序指纹、profile 路径、GUI 结果和未通过边界。
- [x] 宿主存储候选的隔离包运行时核验：DSH `0.2.0-rc.2` JSON+Domain 单实例 64 次并发更新、文件替换、关闭重开恢复通过；两个独立 backend/domain 共用单元出现内存分叉与后写覆盖。收据：`.verification/storage-domain-contract-20261102/storage-runtime.test.mjs` 与 `runtime-data/` 测试结果；本轮实际测试输出 `tests 2, pass 2, fail 0, exit 0`。当前决策：`storage-domain + json` 为首选宿主集成候选，SQLite 暂留候选；真实桌面 profile 的单写者、插件数据根/隔离与正式路由未验，不切换、不关闭最终决策。

H1 已用隔离 DSH Web Host 证明副本 client 进入真实启动图并提供 combo bundle；随后使用本机 Chrome DevTools Protocol 对真实 Host 页面执行 renderer 与侧栏交互探针，标题、面板文案和隔离环境标记均可见（收据 browser-render-probe.json，截图 dsh-sidepanel-render.png）。Web renderer/UI 子项通过。本机提取的 DSH `0.2.0-rc.2` JSON+Domain 运行包也通过单实例并发写入和关闭重开恢复，并证实独立实例冲突；该夹具不证明桌面插件数据目录或 Host 注入。桌面 GUI 仍停在初始化页，GitHub 精确提交对照、桌面 HostPort/模型隔离、正式 Typert 往返、桌面存储路由与重启、插件 unload/dispose 探针未完成，H1/H4 总门槛未通过，禁止进入阶段 2。下一步需在隔离桌面窗口完成初始化后复核桌面侧栏。
## Task H2: 固定内部接口与兼容性门槛

- [x] 新建 `tests/dsh-plugin/host.test.mjs`，先写失败测试：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHostPort } from '../../dsh-plugin/forward-step-dsh/host/port.js';
test('缺少模型隔离能力时不启用业务', () => {
  assert.throws(() => validateHostPort({}), {code:'unsupported_host'});
});
test('完整内部端口可被接受', () => {
  const port = Object.fromEntries(['requestModel','registerPanel','exposeService','getContext','subscribe'].map(key => [key, () => {}]));
  assert.equal(validateHostPort(port), port);
});
```

- [x] 运行 `node --test tests/dsh-plugin/host.test.mjs`；预期先以缺少模块失败，退出非 0。

- [x] 新建 `host/port.js`，实现本插件内部契约校验：

```javascript
export function validateHostPort(port) {
  for (const name of ['requestModel','registerPanel','exposeService','getContext','subscribe']) {
    if (typeof port?.[name] !== 'function') {
      throw Object.assign(new Error(`宿主能力缺失: ${name}`), {code:'unsupported_host'});
    }
  }
  return port;
}
```

- [x] 给 `host/compatibility.js` 定义 `checkCompatibility(expected, actual)`：返回 `{ok, differences}`。比较 `exeSha256`、`cliVersion`、`profile`、`pluginRoot`；不一致返回字段名与前后值。补充哈希相同通过、程序变化阻断、旧插件路径阻断三个直接断言。

```javascript
export function checkCompatibility(expected, actual) {
  const differences = ['exeSha256','cliVersion','profile','pluginRoot']
    .filter(key => expected[key] !== actual[key])
    .map(key => ({field:key, expected:expected[key], actual:actual[key]}));
  return {ok:differences.length === 0, differences};
}
```

- [x] 再运行同一测试文件，预期 `fail 0`、退出 0。

- [x] H2 方向校正：以本机 DSH Typert/Gateway 为真实 Host/Client 接线，不伪造 `createHostAdapter` 五方法为宿主 API；正式插件提供 `./typert` 与 `./remote`，后续业务 HostPort 仍须在阶段二前用实际能力适配。
- H2 证据：Typert Generator 正式构建与本机 Registry/Gateway 契约通过；Web Host/headless Chrome 实测侧栏、RPC 和取消成功。真实 Desktop transport、模型隔离、持久化及 unload/dispose 仍未验。

- [ ] 已有 probe `echo`/`wait` 的构建与契约测试、Web Host RPC/取消实测；真实 Desktop 方法接线、业务模型/订阅调用和宿主资源释放仍需补齐并在 Desktop 验证。

## Task H3: 测试配置安装与可验证恢复

- [x] 固定 `forward-step-test` 的只读 Inspect、受根目录约束的 Backup/Install/Restore 命令，并记录 profile 原文件哈希清单。
- [x] 安装副本时以 CLI `remove` + `add file:<副本>` 刷新本地包；回读实际 package、client export、client 文件、lockfile 和 schema。
- [x] Restore 时按备份依赖重新 remove/add，以免 pnpm “Already up to date” 沿用旧 node_modules；随后恢复清单文件字节、逐项验证 SHA256、比对已安装包与原来源。
- [x] 通过 `node --test tests/dsh-plugin/profile.test.mjs`：当前 7 tests、7 pass、0 fail。
- [x] H2 正式接线前检查插件源码目录 hardlink：脱离工作区内 8 个硬链接源文件且 SHA256 不变，既有 3 个隔离 profile 副本哈希保持，原应用根路径未参与链接；记录见 .verification/plugin-source-hardlink-detach.json。
- [x] 在一次性临时 profile `forward-step-profile-cycle-20261102` 上完成 Backup → Install 副本 → Restore 原来源；profile 配置 5 项文件哈希一致，副本 client 安装及原包 SHA256 回滚均通过。收据见 `docs/acceptance/forward-step-dsh/profile-cycle-install.json` 和 `profile-cycle-restore.json`。
## Task H4: 真实侧栏、模型与存储往返
- Web UI 子项已通过真实 DSH Web Host/headless Chrome：侧栏图标与面板正文可见；以下项目仍要求桌面隔离 profile、真实模型及服务往返，不能由该子项代替。

- [x] 隔离 Desktop 真侧栏与正式 Host/Client RPC 实测通过；Host RPC 返回 `dsh-sidebar-probe` / `observed:true`。临时 `echo`/`wait` 只作为连通/取消证据，真实模型验收另见下项。

- [x] 隔离 profile 插件存储写入、重读及正常退出/重启恢复两个任务和会话绑定通过；记录见 `phase1-acceptance-status-20261103.md` 的历史收据。

- [x] 用隔离启动脚本启动并确认 Electron/Host PID、DSH 版本、隔离 profile、插件解析 Junction 及 SHA256；普通日常 profile 未参与。

- [x] 真实模型 A/B 探针在 DSH `llm/stream` 实际请求边界核验消息摘要/标记/Session，A/B 互斥且真实模型调用完成；首轮及停用重启后复测收据见 phase1 状态文件。

- [x] Desktop Plugin Manager 实测停用后侧栏/探针入口消失，启用后恢复并 RPC 成功；真实 A/B 在启用后再次运行仍恰好 2 条任务与 2 条辅助请求。Cordis async effect cleanup、插件 `dispose()` 等待测试与运行态结果一起证明活动 Agent/资源释放及单次重注册；详见 H4 回执。

- [x] 启动命令、位置、输入、模型、PID、profile、hash、输出、时间、截图和 UI Automation 方法写入 `docs/acceptance/forward-step-dsh/host-probe.md` 及 phase1 状态收据；未编造 GUI 退出码。

- [x] 当前阶段一回归 `node --test tests/forward-step-dsh.test.js tests/dsh-plugin/host.test.mjs tests/dsh-plugin/profile.test.mjs tests/dsh-plugin/typert.test.mjs`：21 tests、21 pass、0 fail、退出 0；完整工作区 `pnpm test`：1134 tests、1133 pass、0 fail、1 skipped、退出 0。

## 提交与阶段检查点

每个 H 任务通过后只暂存其“文件”表中实际改动的文件；`git -C 'D:/VScode/项目/提示词工具' diff --cached --name-only` 逐项核对。提交消息依次使用 `docs: 记录本机DSH接口证据`、`feat: 建立插件宿主适配边界`、`feat: 增加隔离配置安装恢复脚本`、`test: 验证DSH侧栏和上下文隔离`。原型和无关暂存不加入提交。

- [x] 2026-11-03 19:50 核对：真实 GUI 接线、模型隔离、插件释放/重启、存储恢复及数据根目录均有通过证据；固定 commit 源码对照按用户允许的本机 `0.2.0-rc.2` 证据替代。可以进入阶段 2。
- [ ] 若接口不成立，只交付核验结果、失败输入和设计修订；不把剩余业务功能标记已完成。
- [ ] 重开本阶段收据、补充计划、探针记录，并把真实启动位置同步总计划。









### H2 补充：Typert 双侧契约验证

- [x] 创建仅用于 `.verification/typert-generator-fixture/` 的最小 TypeScript Cordis 插件夹具；确认 `0.2.0-rc.1` 是使用 `dsh-typert-protocol` 的适配版本，不将生成器添加到正式插件依赖。
- [x] 产物匹配本机参考形态：Host 包导出 `./typert`，Client 包导出 `./remote`；Host TYPERT manifest 已由 `dsh-typert-registry@0.2.0-rc.2` 注册/撤回，Client `TYPERT_REMOTE` 已由 `dsh-api-gateway@0.2.0-rc.2` 的 `ctx.remote.$mount()` 装载/撤回。连接使用桩，不代表真实 DSH Host transport。
- [x] Client manifest 声明已核对 `external: [@deepseek-ai/dsh-api-gateway/client]` 与 `inject: [@deepseek-ai/dsh-api-gateway, @deepseek-ai/dsh-client-connection]`；严格 codec 合法/非法输入分别接受/拒绝；Remote 挂载后注册方法，卸载后撤回。结果见 `.verification/typert-generator-fixture/result.json`。
- [x] 将生成器接入正式插件 `build:host`；生成器/TypeScript/Cordis/协议仅列为开发依赖，生产依赖保留 `zod`；`pnpm pack --dry-run` 确认正式包包含 Host/Remote 产物且不包含开发依赖。
- [x] 2026-11-02 14:28 历史记录：正式插件 20 项测试通过；该时点 Client Connection 仍由桩覆盖，不能作为真实 DSH transport 证据。
- [ ] 在隔离桌面 profile 完成真实 Host/Client RPC、模型消息隔离、持久化重启与 unload/dispose；全部有证据前阶段 1 不通过，不开始阶段 2。




### 当前会话复核（2026-11-02 13:14:08 +08:00）

- 实测没有匹配 `D:\deepseek\` 或隔离 `DSH_HOME` 的 DSH/Electron 进程，端口 `19387` 无监听；之前 PID `39180`、欢迎页为历史快照，当前 GUI 状态记为 `not-running`。重新启动隔离 GUI 后再验，不把进程/端口单独当作插件通过证据。
- `node --test tests/forward-step-dsh.test.js tests/dsh-plugin/host.test.mjs tests/dsh-plugin/profile.test.mjs`：14 tests、14 pass、0 fail、退出码 0。
- 正式插件目录尚无 Host adapter、Typert `./typert`/`./remote` 产物或其构建脚本；`.verification/typert-generator-fixture/` 的 transport 是桩。阶段一仍未通过，阶段二保持禁止启动。
### 当前会话隔离桌面启动（2026-11-02 13:15 +08:00）

- 启动脚本退出 0，主 PID `52092`；Desktop Host PID `8460` 的参数指向 `.verification/dsh-desktop-isolated-20261102/profiles/desktop`，`127.0.0.1:19387` 由该 Host 监听。
- 当前可验位置：启动的 `DeepSeek Harness` 窗口；用户完成隔离实例登录/API Key 初始化后点侧栏“向前一步”。侧栏、真实 RPC、模型隔离、存储恢复及释放仍需实际交互，不因启动成功勾选 H4。
### Electron 用户数据目录隔离门槛（2026-11-02）

- 当前启动脚本虽设置隔离 `DSH_HOME`，但 Electron 主进程仍使用默认 `%APPDATA%\@deepseek-ai\dsh-desktop`；本机 `app.asar` 通过 Electron 默认 session cookies 连接 Desktop Host。故登录态隔离尚未证明，禁止在现有窗口输入凭证。
- 启动脚本需增加隔离 `--user-data-dir`，在重启后验证进程命令行指向工作空间隔离目录，且不触碰默认 userData；通过该门槛后再继续 H4。
### Electron 隔离修正已运行（2026-11-02 13:20 +08:00）

- 启动脚本增加 `$DSH_HOME/electron-user-data` 并向 Electron 传入 `--user-data-dir`；实际脚本退出 0，主 PID `47636`，全部 Electron 子进程命令行均指向该隔离目录。
- Desktop Host PID `46724` 指向隔离 `profiles/desktop`，`127.0.0.1:19387` 监听归属该 PID。修正前 PID `52092` 已正常关闭。
- 当前可验入口为 PID `47636` 的 `DeepSeek Harness` 窗口。登录/API Key 仍需用户在隔离实例完成；认证后继续 H4，以上启动证据不等于 H4 通过。

### 复核补记（2026-11-02 14:28 +08:00）

- 正式插件入口只注入 `skills` 并 `ctx.provide('forwardStepProbe', …)`；Host `TYPERT` contribution 由本机 DSH `./typert` loader 注册，插件不重复 `ctx.typert.register()`，以免与 loader 重复注册。Host service 在插件 Fiber 中跟随加载/卸载。
- 正式包开发构建命令 `pnpm run build:host` 退出码 0，输出 Host invocation 2、Client descriptor 2；`pnpm pack --dry-run` 退出码 0。
- `node --test tests/forward-step-dsh.test.js tests/dsh-plugin/host.test.mjs tests/dsh-plugin/profile.test.mjs tests/dsh-plugin/typert.test.mjs`：`tests 20, pass 20, fail 0`，退出码 0。
- 同步到隔离 Desktop profile 的 package、index、client、Host/Remote 产物、Skill 等 6 个核对文件哈希均与工作区副本一致。桌面重启主 PID `41500`，Host PID `29468`，监听 `127.0.0.1:19387`；userData 与 profile 均在 `.verification/dsh-desktop-isolated-20261102/` 下。
- 本次重启后尚未完成 GUI 交互；隔离窗口需用户在 DSH 内初始化登录/API Key，再从左侧栏选“向前一步”。桌面 UI、真实 Host/Client transport、模型消息隔离、持久化重启及真实卸载仍是 `not-run`，阶段 1 继续未通过。

### 当前自查更新（2026-11-02 15:26:52 +08:00）

- 正式插件 `pnpm run build` 退出码 0；阶段一回归命令 `node --test tests/forward-step-dsh.test.js tests/dsh-plugin/host.test.mjs tests/dsh-plugin/profile.test.mjs tests/dsh-plugin/typert.test.mjs`：21 tests、21 pass、0 fail、退出码 0。`pnpm pack --dry-run` 退出码 0，打包清单含 client、Host/Remote 产物、Skill 与必要运行文件，不含开发依赖。
- 隔离 Desktop profile 安装副本 6/6 核心文件与当前工作区构建哈希一致；主进程 PID `46288` 使用隔离 `electron-user-data`，Host PID `31180` 指向 `.verification/dsh-desktop-isolated-20261102/profiles/desktop` 并监听 `127.0.0.1:19387`。
- `browser-render-probe.json` 的真实 Web Host/headless Chrome 交互收据显示侧栏渲染、Host RPC 返回 `{"ok":true,"value":{"marker":"dsh-sidebar-probe","observed":true}}`、取消结果 `取消结果：gateway/cancelled`，控制台诊断为空；截图 SHA256 `B71E8A850C4163B2585E658AEF236E72E86AAD402609D840DD6F5979729B1A9E`。该证据仅覆盖 Web Host，不替代 Desktop UI/Host transport。
- 未完成项：固定本机 app.asar 对应 GitHub 提交的逐项官方契约对照；Desktop GUI 面板交互；桌面真实 Client↔Host RPC；任务/消息模型隔离；桌面数据根、持久化与重启恢复；真实 unload/dispose。阶段 1 仍未通过，阶段 2 不启动。
- 用户验收位置：当前已运行的隔离 `DeepSeek Harness` 窗口（主 PID `46288`），初始化此隔离实例后，从左侧栏点击“向前一步”，再依次点击“验证 Host / Client RPC”和“验证 Host / Client 取消”；凭证只在 DSH GUI 内处理，不写入验收记录。


### 最新复核（2026-11-02 15:37 +08:00）

- 更正旧 `client.test.mjs` 的过时 slot 断言后，完整工作区 `pnpm test` 当前结果为 `tests 1134 / pass 1133 / fail 0 / skipped 1 / exit 0`。
- 已再次核对隔离 profile：六项核心文件哈希 `6/6` 与工作区插件一致；隔离 Desktop 主 PID `46288`、Host PID `31180` 仍运行，Host 监听 `127.0.0.1:19387` 且参数指向隔离 profile。
- 本机 GitHub API 对精确 commit `04f392c9ddd144fa426da2045178797da6db6c11` 的复核返回 HTTP `403`，未取得该 commit 元数据；H1 固定提交对照仍保持未完成，不用 master 代替。
- 当前仍需在隔离 Desktop 窗口手动完成登录/API Key 初始化并检查侧栏与两个验证按钮；随后继续模型消息隔离、持久化重启及 dispose/unload 验收。

### 当前 Web Host 持久化实测更新（2026-11-02）

- [x] 在真实 DSH Web Host profile 接入 `ctx.storageDomain` 探针，Host RPC 可写入/读取 `forward-step-probe`；关闭 Host 后新进程只读仍恢复相同值，收据为 `browser-render-probe-storage-write.json`（PID `28308`）与 `browser-render-probe-storage-restart.json`（PID `36132`）。文件位于隔离 Web DSH_HOME `storages/forward_step_dsh_probe.json`。
- [ ] Web Host 的结果不替代 Desktop profile；仍需在当前 Desktop 窗口检查新版侧栏和 RPC，执行写入后关闭并重启隔离 Desktop，再只读验证；模型/任务消息隔离和 dispose/unload 仍未完成。
- 插件现依赖本机 DSH peer `@deepseek-ai/dsh-storage-domain@0.2.0-rc.2`；Host service 只导入实际 DSH Storage Domain API，`peerDependencies`、开发锁与隔离 profile lock 均包含该契约版本。

### 本轮阶段一源码补强

- `src/host-service.ts` 现在会在插件 dispose 时中止活动 `wait` 并清理 timer/AbortSignal listener；集成测试覆盖活动 Gateway 请求下卸载。
- `build`、21 项阶段一专项测试、`pack --dry-run` 及完整 1134 项回归通过，详见 `docs/acceptance/forward-step-dsh/host-probe.md`。
- `lib/host-service.js` 已同步隔离 Desktop 插件副本，运行中进程需要重启后才会加载。
- 当前隔离 DSH 窗口仍显示登录/API Key 欢迎页；Desktop GUI、真实 RPC、模型隔离、桌面重启恢复和真实 unload/re-enable 仍未验收，阶段 2 不启动。

### 卸载与重新启用回归扩展（2026-11-02 17:51）

- 进一步覆盖活动 Gateway wait 下卸载、Skill provider 撤销、插件重新挂载只注册一份 provider、RPC 再调用及 Storage Domain 二次关闭；21/21 阶段一专项测试、1134 项完整回归（1133 通过、1 跳过、0 失败）和 check 均通过。GUI 综合验收仍未运行，阶段 2 维持关闭。


## 阶段一补充：Agent / Session 隔离探针（2026-11-02）

- [x] 在插件面板加入临时测试适配器探针：创建两个独立 DSH Agent/session，捕获两条请求并核对 session ID 与 A/B marker 无交叉；完成后释放 Agent 与临时 provider。
- [x] 本地模拟运行时专项测试、Typert schema 和插件构建通过；测试结果只说明代码路径与模拟运行时行为，不算真实 DSH Desktop 验收。
- [x] 在隔离 Desktop 窗口的侧栏执行真实 Agent/Session 与真实模型 A/B 探针；测试适配器结果单独记录、不冒充真实模型结果。实际运行回执见 `desktop-real-model-ab-isolation-20261103.json`。
- [x] 2026-11-03 19:50：Desktop 侧栏/RPC/取消/存储重启、真实模型消息隔离、停用/启用和异步资源释放已通过；固定构建 commit 源码对照按用户允许的本机源码/既有 Desktop 证据替代，阶段一/H4 通过。
- 历史实例 PID `54944`/`55728` 已由后续隔离实例替代；当前有效验收实例 PID `16324`/`29384`，详见 2026-11-03 19:50 收据。
- 最新本地回归证据：`.verification/phase1-agent-isolation-probe-20261102/MODIFIED-targeted-tests.log`（21/21）；`MODIFIED-full-tests.log`（1134，1133 pass、1 skipped、0 fail）；build、check、pack dry-run 日志均退出 0。`VERIFICATION.txt` 汇总基线、修改后结果和未验收门槛。
- 隔离 Desktop 安装副本的 5 个新增/生成运行文件已逐项哈希同步，收据 `desktop-plugin-refresh.json`；旧文件在 `desktop-profile-before-refresh/`。当前运行中的进程仍需正常重启才能加载。


### 当前会话真实 Web Host Agent/Session 验收进展（2026-11-02）

- [x] Agent `cwd` 从 Node `process.cwd()` 读取；Web probe 以 OS 临时目录作为 CLI 工作目录，隔离父仓库 workspace-changes 快照。
- [x] 真实 DSH Web Host Agent/Session 测试适配器运行通过：两条任务请求、两条 `session-title` 辅助请求按 session/marker 无交叉；两个 turn completed，资源释放通过。收据 `.verification/phase1-agent-isolation-probe-20261102/dsh-web-agent-isolation.json`。
- [ ] Desktop GUI、Desktop RPC/取消、Desktop Agent probe、Desktop 存储关闭重启恢复、真实 unload/re-enable 与固定构建 commit 上游源码对照未完成；阶段 1 仍未通过，不能进入阶段 2。


### 当前会话最后回归（2026-11-02）

- 最新 build 成功；阶段一专项 25/25 通过；完整 `pnpm test` 为 1135 项（1134 pass、1 skip、0 fail）；`pnpm check` 与 pack dry-run 均退出 0。
- 重跑隔离 DSH Web Host Agent/Session probe：`status=pass`，2 个 task 请求和 2 个 `session-title` 辅助请求均按 session 隔离，取消、存储重读及普通 RPC 通过。
- 当前 Desktop profile 所需 6 个文件（含 client.js）哈希已与工作区构建匹配，收据 `.verification/phase1-agent-isolation-probe-20261102/desktop-profile-refresh-20261102-latest.json`；运行中 PID `54944`/`55728` 必须正常关闭并重启才能加载，不自动关闭用户窗口。
- 尚缺 Desktop GUI 初始化与交互、桌面存储关闭重启、实际插件停用/重新启用、固定构建 commit 源码对照。阶段 1 未通过，阶段 2 不启动。

### 最新隔离 Desktop UI 补充验收（2026-11-03 07:57 +08:00）

- [x] Host/Client 构建均成功；专项测试 15/15 通过；`host-service.js` 最新哈希同步至隔离 profile，见 `docs/acceptance/forward-step-dsh/desktop-acceptance-20261103.json`。
- [x] Desktop 侧栏和 Agent/Session 测试适配器实测通过：`passed:true`，两个 Agent idle、session/marker 无交叉、两个 turn completed、无错误、Agent 与 adapter 均释放。该探针不调用真实模型。
- [x] Desktop Host/Client RPC、取消、隔离存储写入与跨 DSH 进程重启读取通过；输出和截图按机器回执登记。
- [x] Desktop 插件组合包禁用时“向前一步”入口消失；重新启用后入口恢复，RPC 再次成功。
- [ ] 未验证安装包卸载/重新安装，也未直接观测 Desktop Host service 内部 dispose；组合包 UI 开关不等于安装包卸载。
- [ ] 固定构建 commit `04f392c9ddd144fa426da2045178797da6db6c11` 官方源码逐项对照仍未完成。该项与上项完成前阶段 1 保持未通过，阶段 2 不启动。
- 本次使用 PowerShell UI Automation/Win32 输入和截图，不是 Windows MCP 调用；UI 验收不取代构建/专项测试，也不承担 gateway/internal 根因定位。


### 2026-11-03 Host service dispose 并发收尾补测

- [x] Host service 现在把 dispose 收敛为单一清理 Promise；先拒绝新存储调用，取消活动任务和探针，等待活动 Agent/隔离探针收尾后再关闭存储 Domain。
- [x] 新增并运行并发卸载测试：活动 Agent 被取消，任务 Domain 只关闭一次，重复 dispose 返回相同 Promise，卸载后读操作返回 `service_disposed`。
- [x] 完整插件专项和 Agent coordinator 回归 63/63 通过，Host+Client 构建退出码 0。
- [ ] 仍需将最新 Host 构建同步至隔离 profile 并重启 DSH 后做运行态 UI/RPC 检查；不能把自动化测试当 Desktop unload 直接观察。
- [ ] 固定构建提交源码核对仍未取得：2026-11-03 GitHub upload-pack 返回 `not our ref`；阶段 1 整体保持未通过，阶段 2 门槛未关闭。


### 2026-11-03 第二轮 Host/Session 生命周期修复

- [x] dispose 幂等，并在关闭 Domain 前等待活动 Agent、隔离探针及正在提交的任务创建/绑定写入。
- [x] 覆盖 Host 卸载时域初始化尚未完成的竞态：晚到打开的 Domain 会自行关闭；卸载后拒绝新存储操作。
- [x] 正式 RPC 增加 `getCurrentBinding`；客户端项目/会话切换时清掉旧选项，重读任务恢复当前对话绑定，绑定读取前不能误运行项目首任务。
- [x] 最新插件构建及 66 项插件/coordinator 回归通过，`git diff --check` 无错误。
- [ ] 最新构建已同步至 profile 目录，但打开的 DSH 主进程 `36536` 在正常关闭请求后仍存活且无可见窗口；未强制结束。本次未观察新 bundle 运行效果。
- [ ] 精确构建 commit 官方源码仍不可取，阶段 1 保持未通过。

### 2026-11-03 19:50 H4 完成更新

- H4 的真实模型、隔离 profile 启动与存储恢复、停用/启用资源生命周期门槛均已依据隔离 Desktop 收据通过。真实模型 A/B 结果包括实际 `llm/stream` 摘要、独立 session、marker 互斥和 agent dispose；插件停用后 UI 消失、再启用后恢复且 Host RPC 通过，复测请求数仍仅 2+2。
- 固定 GitHub commit 源码精确对照与 Windows MCP 专属记录由用户明确同意的本机安装源码/既有及本轮 Desktop 证据替代；不得误写为已检查 commit 或调用 Windows MCP。
- 阶段 2 已开放；继续执行 `2026-11-02-forward-step-dsh-02-agent-tasks.md`，先审计代码/测试/计划的真实差距，复用现有任务、RPC、记忆筛选和 agent 接线，不重复实现已完成部分。
