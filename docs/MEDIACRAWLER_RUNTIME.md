# MediaCrawler 本地运行环境

来源登记位于 `server/social-source-registry.js`：固定 ID `mediacrawler-lite`、版本 `1.1.0`、协议版本 `1`；平台为小红书、B 站、微博和知乎。知乎只开放健康检查与指定回答/文章详情；微博另支持单页一级评论。微博/知乎由本项目桥接层提供有限 HTTP/HTML 适配，尚未进行真实网络验证。桥接入口为 `vendor/mediacrawler-bridge/bridge.py`，依赖锁为 `vendor/mediacrawler/requirements.lock`，当前锁文件 SHA-256 为 `b68744b29e4843cce729531935ee8253a59d6292abf6ae21776d95daaaae6e45`，与来源登记一致。当前专用安装器目标为 Windows x64。

## 应用管理目录

所有运行时数据都放在 Electron `app.getPath('userData')/social-source/` 下：

```text
runtime/uv/0.13.2/                 固定 uv 安装器
runtime/python/                    uv 管理的 Python 3.11
cache/uv/                          uv 下载缓存
sources/mediacrawler-lite/1.1.0/venv/  来源版本独立虚拟环境
browsers/                          Playwright Chromium
profiles/<platform>/<profileId>/   独立登录 profile
tmp/                               安装器临时目录
```

uv 从固定的官方 Windows x64 发布包安装，登记 SHA-256 为 `9cfb447a4027550f134753253fdffbcd35b79a66dd888260bf6776891916069e`。`UV_PYTHON_INSTALL_DIR`、`UV_CACHE_DIR`、浏览器目录和临时目录都指向上述 `userData`；uv 只选择其管理的 Python，且禁用 uv 配置文件。它不修改系统 Python，也不依赖用户 shell 的 `PATH` 或 pip 配置。

首次准备会校验 `requirements.lock` 摘要，安装 Python 3.11，创建来源版本 venv，同步锁定依赖，安装 Playwright Chromium，最后核验 Python、依赖和 Chromium 实际可执行文件及版本。浏览器自动化依赖固定为 Playwright 1.64.0（Apache-2.0，来源为 PyPI），其依赖锁定为 pyee 13.0.0 和 greenlet 3.5.6；`python -m playwright install chromium` 将浏览器文件写入 `PLAYWRIGHT_BROWSERS_PATH` 指定的应用目录。uv 下载连接超时为 15 秒、总超时为 120 秒；安装命令按阶段设有 1 至 15 分钟超时。同一来源同一时间只允许一次准备，重复调用返回 `SESSION_BUSY`。应用退出时 `stopAll()` 会取消准备并回收其子进程；当前没有单独的 renderer 取消准备 IPC。阶段进度和可恢复错误通过 `socialSource.onProgress` 与准备结果返回。

## 登录与隔离

登录通过 `desktopApi.socialSource.openLogin({ sourceId, platform, profileId })` 打开独立的可见 Chromium。profile 以平台和 profile ID 分目录，动作进程只读取对应的 Playwright profile。不会读取、复制或复用 Electron `session`、Cookie 或 BrowserWindow profile；同一 profile 登录窗口打开时不执行采集动作。

Windows x64 的动作与登录都由 `vendor/mediacrawler-bridge/windows_job_supervisor.py` 启动。helper 使用标准库 `ctypes` 创建带 `KILL_ON_JOB_CLOSE` 的 Job Object；bridge worker 在 Job 绑定成功前停在 gate，不会执行请求或打开浏览器。绑定失败时不放行 worker。worker stdout 原样专用于 bridge JSONL，manager 到 helper 的 start/stop 控制只走 helper stdin；清理确认使用 stderr 上独立的 `SOCIAL_SOURCE_SUPERVISOR:` 帧，worker stderr 会加 `WORKER:` 前缀，不能伪造确认。worker 结束或收到取消后，helper 终止 Job 并等 `ActiveProcesses == 0`，再发送含本次随机 nonce 的确认。主进程同时收到有效确认并观察 helper `close` 后才释放 profile 锁；超时、异常退出或缺少确认会返回进程错误并保留锁。helper 自身崩溃时，Windows 关闭 Job 句柄会自动结束 worker 及其浏览器后代。非 Windows 平台使用原有本地子进程生命周期。该原生路径由 Windows Job Object 子进程测试覆盖；真实 Chromium 和平台登录仍未验收。

## JSONL 动作协议

renderer 只能调用 `desktopApi.socialSource` 暴露的固定 IPC：`list()`（`social-source:list`）、`getDiagnostics()`（`social-source:diagnostics`）、`checkEnvironment()`、`prepare()`、`openLogin()`、`run()`、`cancel()` 和 `stopProfile()`。`getDiagnostics()` 仅用于本机排查运行时安装/启动问题，返回有数量与长度上限、已脱敏的 stderr 诊断；诊断不进入动作结果或准备报告。动作请求需精确符合 registry schema，字段包括 `requestId`、`protocolVersion`、固定 `sourceId`、动作/能力、平台、profile/task ID、白名单内容 ID 和预算；不接受命令、脚本、路径、环境变量或调试端口。

每个桥接进程通过 stdin 接收一行 JSON，请求完成后通过 stdout 返回 JSONL 消息。stdout 只包含 `budget`、`result` 或 `error` 协议帧；诊断只写 stderr，主进程最多保留 4 KiB 并脱敏。主进程校验消息类型、请求 ID、协议版本、字段和预算范围。动作限于健康检查、登录状态、单条详情和单页评论；不开放搜索、自动翻页/重试循环、写入互动或媒体下载。

每个请求由主进程传入最多 10 次 HTTP 请求、最多 20 条内容和不超过 15 分钟的截止时间。两个平台客户端都在每次 `AsyncClient` HTTP send 前调用预算回调；B 站 WBI 键请求和详情/评论数据请求分别计费。取消或截止时间到达后不发起下一次请求；无法确认是否完成的在途请求标为未知并计入预算。

当前来源管理器在开发态从应用目录读取 bridge 和 lock；Electron Builder 的来源资源映射由后续打包任务负责，本说明不代表已完成打包验收。真实平台登录和采集未在本任务中测试。
