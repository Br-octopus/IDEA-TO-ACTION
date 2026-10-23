# 国内四平台研究第一阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复现有小红书、B 站、微博、知乎搜索中的状态、会话、结果链接和任务控制问题，为后续深度能力提供可靠入口。

**Architecture:** 沿用 Electron 浏览器、固定页面读取脚本、前端研究协调器。会话默认标识统一为 `social-research-${platform}`；浏览器打开、登录、能力验证分别表示；运行状态只在当前进程内有效，恢复的连接必须重新检查。

**Tech Stack:** Electron、Node.js、原生 JavaScript、现有 localStorage 状态迁移。

**设计依据：** `docs/superpowers/specs/2026-10-20-domestic-social-research-enhancement-design.md`。

**最终实现与验收目录：** `D:/VScode/项目/提示词工具`。阶段一实现曾在隔离工作树完成，整合前需对照 D 盘当前代码逐文件合并；不得覆盖 D 盘已有写作/PPT 改动。

本计划是四阶段中的第一阶段。后三阶段按主设计在 `2026-10-20-domestic-social-research-phases-2-4.md` 拆分。用户已授权复用与修改 MediaCrawler，并选择子代理流程；无需再次询问授权或执行方式。不将未接入能力显示为可用。

**验收边界：** 为交付可验收应用，执行必要的自动化检查、桌面构建和本地界面核对；四平台真实登录及站点结果核对由用户完成前保持 `searchVerified: false`，本地验证不替代真站验收。

## 任务 1：统一会话和平台准备状态

**修改文件：**

- `prototype/social-research-schema.js`：连接状态字段和恢复清洗。
- `prototype/social-research-ui.js`：平台卡片、准备检查和确认门槛。
- `server/social-platforms.js`：国内平台能力声明。

- [x] 平台定义新增小红书、哔哩哔哩、微博、知乎四个国内平台，声明浏览器搜索、API 未接入和 `searchVerified: false`；保留 Reddit/YouTube 定义供历史数据和旧结果兼容，但新建研究平台选择与准备卡片仅显示四个国内平台。
- [x] 修复 `renderPlatformCards()` 的未定义变量：在函数开头声明 `const task = currentTask()`。
- [x] schema 导出默认 profile 解析函数，供 UI 使用并兼容已有明确指定的 `profileId`；协调器实际检查与搜索接入在任务 3。

```js
function resolveResearchProfileId(platform, profileId) {
  return String(profileId || "").trim() || `social-research-${platform}`;
}
```

- [x] 修复默认勾选四平台但默认预算只允许三平台的冲突：新任务默认最多四平台、每平台三查询、每查询二十结果、二十四页、十条详情、十分钟。保留历史显式预算，并让 schema 保留协调器已使用的 `maxResultsPerQuery`。

- [x] 连接保存最近检查时间、最近实际搜索成功时间、登录状态、搜索验证结果及错误分类。清洗恢复时 `status: "needs-recheck"`、`browserReady: false`、`browserPrepared: false`、`checked: false`；不能将历史检查恢复为当前准备完成。
- [x] 平台卡片分别显示浏览器与登录状态。只有 `searchVerified === true` 可以显示已验证，缺字段与 false 都显示待实测。未知登录状态不得显示已登录；不再承诺“公开搜索可直接使用”。
- [x] UI 检查只接受明确成功且可读取的响应；`error/adapter-error/restricted/closed/not-ready` 均不可准备。区分检查完成与准备完成，保留错误码、检查时间。
- [x] 页面可读取且没有登录/验证拦截时可让用户启动真实搜索；这仍不表示搜索已经验收通过。确认按钮与 `confirmAndRun()` 复用相同准备条件，并依据用户选择的连接方式判断，API 模式不可借浏览器准备状态放行。
- [x] 切换历史任务使用该任务显式 profile（若有），打开登录、检查、清理均使用相同解析函数。打开和清理后立即清除旧准备状态并保存；清理后登录变为未知。
- [x] 暂停文案说明停止新增请求、在途可能完成并计费；取消文案说明保留已完成材料。
- [x] 只读语法检查上述三个文件；先规格审查通过，再代码质量审查。

## 任务 2：收紧页面读取、内容链接和搜索结果

- [x] 尚无对应只读页面适配器的平台不能显示为已接通或允许进入准备完成态；集成 Prompt Agent 时默认只传四个国内平台，不能继续传 Reddit/YouTube 并导致新任务创建失败。历史国际结果继续可查看和筛选。
- [x] 页面检查不得更新搜索实测标记；若页面无法可靠识别登录状态，明确保留“未知”，不能用页面可读/ready 推断已登录。成功搜索状态写入由任务 3 协调器完成。

**修改文件：**

- `electron/social-browser-manager.js`：固定脚本执行边界和会话状态。
- `electron/social-browser-adapters.js`：页面检查、有界等待、链接筛选。
- `electron/main.js`：IPC 错误与结果校验。
- `prototype/social-research-ui.js`、`prototype/prompt-agent-ui.js`：四个平台状态展示及 Agent 入口兼容。
- `prototype/retriever.js`：跨查询去重并保留来源查询。
- `prototype/app.js`：仅在搜索结果合并点将累计结果与当前查询一起去重，不扩展其他协调器流程。
- `prototype/social-research-schema.js`：保存内容 ID。

- [x] 页面打开状态与登录状态分开返回；移除 B 站 `document.readyState` 代表已登录的判断。检查响应采用：

```js
// ready 表示当前页面可用于尝试只读搜索，不代表登录或真站验收完成。
{ status: "ok", ready: true, browserStatus: "ready", loginState: "unknown",
  searchVerified: false, checkedAt: new Date().toISOString() }
```

- [x] 固定脚本识别明确登录阻断、人工验证和限流；分别返回 `LOGIN_REQUIRED`、`MANUAL_VERIFICATION_REQUIRED`、`RATE_LIMITED`，未知页面返回 `UNSUPPORTED_PAGE`，已关闭返回 `SESSION_CLOSED`。不能将所有失败转换为空结果。
- [x] 导航完成后短时有界轮询固定搜索脚本，直到取得卡片、明确空状态或明确受限；上限到期报告页面未就绪。禁止任意代码执行、无限轮询和使用模糊的全页“空”字判断无结果。
- [x] 会话执行脚本前校验脚本属于当前平台，校验真实当前 URL；只允许 HTTPS、精确白名单主机、默认端口、无用户名密码。知乎加入 `zhuanlan.zhihu.com`。
- [x] 搜索只接收真实内容链接：小红书 `/explore/<id>` 或 `/discovery/item/<id>`；B 站 `/video/BV...` 或 `/video/av数字`；微博 `/<数字作者>/<帖子id>`、`/detail/<数字id>`、`/status/<帖子id>`；知乎 `/question/<id>/answer/<id>` 与 `zhuanlan.zhihu.com/p/<id>`。拒绝作者主页、人物、用户视频与伪造域名；相对链接按平台 URL 解析。小红书访问链接保留安全参数。
- [x] 归一化结果保存 `contentId`。先过滤合法链接再截断数量；去重使用平台 + 内容 ID，回退精确 URL（只规范协议/主机，不能小写路径）。合并查询词但保留首个结果 ID 和有效访问链接。
- [x] 协调器合并每次查询结果时，将累计结果与新结果一起去重；不能只对单个查询去重后继续保留跨查询重复项。

```js
const key = result.contentId
  ? `${result.platform}:${result.contentId}`
  : `${result.platform}:${result.url || result.id}`;
// 命中已有项时合并 searchQueries；返回稳定顺序。
```

- [x] 相同会话的导航和读取避免互相覆盖，冲突返回 `SESSION_BUSY`；不会关闭用户其他浏览器。若已使用适配器层动作锁，主进程不再重复加会死锁的锁。
- [x] 为 URL 解析、页面状态识别、会话锁、结果过滤/去重及 Prompt Agent 国内范围补充或更新单元测试；运行相关定向测试与所有变更 JS 的语法检查，不访问真实平台；规格审查、质量审查依序执行。

## 任务 3：修复协调器执行边界、预算和取消

**修改文件：**

- `prototype/app.js`：仅文件开头的社媒协调器模块。
- `prototype/social-research-workflow.js`：自动切换判断。
- `prototype/social-research-ui.js`：接收真实搜索成功状态并更新连接历史。
- `electron/main.js`：保留已登记 API 的错误类别，并将明确空结果规范为成功空结果。
- `README.md`：当前交付边界。

- [x] 新建计划在调用模型前校验显式选择的平台；模型生成的平台再次校验。确认与运行均只接受四个国内平台；国际历史任务仍可读取，不可执行。

```js
const DOMESTIC_PLATFORMS = new Set(["xiaohongshu", "bilibili", "weibo", "zhihu"]);
// 空平台、未知平台、国际平台均抛出明确错误，并且不调用模型或平台。
```

- [x] 检查与搜索均调用 schema 的 `resolveResearchProfileId(platform, task.profileId)`，不再使用 `task.id` 作为默认 profile。
- [x] 首次真实搜索成功后（成功返回零结果也算），按平台和实际 profile 记录 `searchVerified: true` 与 `lastSuccessfulSearchAt`，并同步 UI；仅打开浏览器、登录或检查页面不得标为搜索已验证。手动连接失败/受限时不更新此记录。
- [x] 准备检查须是明确成功且 `ready === true`（或明确已配置 API），所有其他结果记录 `{message, code}` 并排除，不能放行 IPC 的 `status: "error"`。
- [x] 每次真正发出搜索前预占预算并持久化：`consumeResearchBudget(task, { platform, queries: 1, pages: 1 })`。失败不退还，超额不发请求。搜索摘要不消耗 `details`。源切换也预占请求预算，不能免费重试。
- [x] 自动切换最多一次；用户指定连接不切换。明确成功零结果保持正常空结果；限流、验证码、登录受限暂停该平台，不切换共享账号来源。其余平台仍可继续。
- [x] 所有非成功搜索响应均按错误处理并保留具体错误码；成功结果与此前已完成结果合并去重，记录最新 task 引用，避免下一次持久化覆盖已有结果。
- [x] 取消以最新已持久化任务为准，保留已完成结果、结果 ID 和预算，丢弃当前请求晚到结果；报告晚到同理不写入。取消搜索、准备和生成报告均删除 activeRun 并唤醒暂停等待。
- [x] 更新 README，说明第一阶段修复、仍待真实平台验收、深度能力与采集进程尚未上线。执行 `npm run check` 与变更文件 `node --check`，再审阅差异；不运行测试。
- [x] 完成规格审查、代码质量审查和全链路静态审查，更新本计划进度。保留既有未提交改动，不整批提交或回滚。

## 后续阶段衔接

第一阶段完成后依照增强总版设计继续，顺序不变：

1. **阶段二：小红书、B 站深度能力。** 固定 MediaCrawler 提交和裁剪清单，保留许可与修改说明；以专用虚拟环境和本地子进程协议接入按需正文与有限评论。B 站字幕独立评估已登记 MCP，不把字幕缺失伪装成可用。补主题/内容链接入口、选择结果深入读取、预算与来源记录。先完成最小环境检查与进程管理，再开放按钮。
2. **阶段三：安装更新、任务恢复。** 对登记的采集源提供环境准备、版本检查、升级和回退；更新需协议兼容、失败回到原版本。保存待完成项目和已用预算；重启等待用户恢复，检查会话后继续，不自动联网，不复原未选择持久化的全文。会话、凭证、环境和本机绝对路径不进备份。
3. **阶段四：微博、知乎深度能力。** 在相同协议上增加微博正文/有限评论、知乎回答/文章正文。小红书二级回复与创作者、B 站弹幕/转写/章节、微博热点跟踪、知乎评论/多回答比较继续作为明确的后续评估项目，逐项验收后开放。
