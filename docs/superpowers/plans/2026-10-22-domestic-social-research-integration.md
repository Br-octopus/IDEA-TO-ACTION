# 国内社媒研究增强上传与合并计划

> **For agentic workers:** 按任务顺序逐项执行并核对；每步使用复选框记录状态。当前文档只定义后续流程，不代表已提交、上传或合并。

**目标：** 以 D 盘主工作区当前社媒实现为源，只把社媒相关未提交差异集成到最新远端 `main`，验证后通过专用分支和 PR 上传，不带入本地写作/PPT 提交。

**方案：** 远端 `origin/main` 是集成目标；D 盘 `main` 上领先远端的 30 个提交经主对话核对均为写作相关，不 cherry-pick、不推送。先在主工作区外用独立临时 index，从当前 `HEAD` 的工作区差异中选出社媒改动，并生成一个仅用于提取的临时 Git commit；再把这个 commit cherry-pick 到从最新 `origin/main` 创建的隔离分支。共享文件冲突在隔离分支按设计稿手工移植并审查。

**工具：** Git、Git worktree、PowerShell 7、Node.js、pnpm、Python、GitHub PR。

---

## 已知基线与操作边界

截至 2026-10-22 的检查结果：

- 主工作区：`D:/VScode/项目/提示词工具`，分支 `main`，HEAD 为 `cf8904e`，相对 `origin/main` 领先 30 个提交；存在写作、PPT、社媒等混合未提交改动和未跟踪文件。
- 主工作区真实暂存区当时为空；执行前必须重新检查，不能依赖此快照。
- 远端基线：`origin/main` 为 `ffd38e4`。
- 隔离集成工作树：`C:/Users/Alarm/.codex/worktrees/domestic-social-research-final/提示词工具`，分支 `codex/domestic-social-research-final`，当前干净并与 `origin/main` 对齐。
- 旧社媒工作树：`C:/Users/Alarm/.codex/worktrees/social-research-agent/提示词工具`，本地回退点 `d5afc16`；它不是最终代码源，无需为本计划新增提交。
- 本地主工作区的社媒专属文件与混合共享文件，均须以当前工作区实际差异核验；设计与范围依据为 `docs/superpowers/specs/2026-10-20-domestic-social-research-enhancement-design.md`、MediaCrawler manifest 和现有专项验收记录。
- 真实平台登录和采集仍由用户账号环境验收；自动化测试或开发版检查不得记成真实平台通过。

硬性边界：

1. 不在主工作区真实 index 暂存、取消暂存或恢复任何文件；不改主工作区分支、提交和文件内容。
2. 不推送主工作区 `main`，不推送那 30 个写作提交；不强推，不把旧社媒分支作为合并源。
3. 不整目录复制，不使用 `git add -A`；不把 release 产物、虚拟环境、缓存、凭证或 MediaCrawler 清单外文件带入。
4. 任何共享文件只纳入社媒所需改动。若无法证明某段改动属于社媒，先排除并记录，不猜测。
5. 每个验证门禁通过后再进入下一阶段；任一范围检查或验证失败即停止上传流程，在隔离分支修正后重跑相关门禁。

## 文件范围

专属社媒文件按当前工作区与设计稿逐项确认，预期包含：

- `electron/social-content-url.js`、`electron/social-source-manager.js`、`electron/social-attachment-store.js`、`electron/social-browser-adapters.js`、`electron/social-browser-manager.js`、`electron/workspace-backup-archive.js`
- `server/social-source-registry.js`、`server/social-api-client.js`、`server/social-platforms.js`
- `prototype/social-research-prompts.js`、`prototype/social-research-schema.js`、`prototype/social-research-ui.js`、`prototype/social-research-workflow.js`
- `tests/electron-social-research.test.js`、`tests/social-api-client.test.js`、`tests/social-browser-adapters.test.js`、`tests/social-browser-manager.test.js`、`tests/social-content-url.test.js`、`tests/social-research-integration.test.js`、`tests/social-research-schema.test.js`、`tests/social-research-ui.test.js`、`tests/social-research-workflow.test.js`、`tests/social-source-manager.test.js`、`tests/social-source-registry.test.js`、`tests/test_mediacrawler_bridge.py`、`tests/test_mediacrawler_request_budget.py`、`tests/test_windows_job_supervisor.py`、`tests/workspace-backup-archive.test.js`
- 社媒设计稿、实施/稳定性计划、MediaCrawler 来源评估与 manifest、`docs/MEDIACRAWLER_RUNTIME.md`，以及经 manifest 列明的许可文件、裁剪源码、依赖锁和桥接支持文件。

共享文件必须逐段审查：`README.md`、`electron/main.js`、`electron/preload.js`、`prototype/app.js`、`prototype/index.html`、`prototype/retriever.js`、`prototype/storage.js`、`prototype/workspace-backup.js`、`server.js`、`server/model-client.js`、`tests/retriever.test.js`、`tests/server.test.js`、`package.json`、`pnpm-lock.yaml`、`.gitignore`。只纳入社媒 IPC/页面接线、API 与预算、备份附件边界、社媒依赖/运行文件等必要差异；排除写作、学术、PPT、通用 Prompt Agent 及无关工具链变更。

MediaCrawler 文件以 `docs/superpowers/specs/2026-10-20-mediacrawler-import-manifest.json` 的 `files`、`localSupportFiles` 为准，并审查 `vendor/mediacrawler-bridge/bridge.py`、`windows_job_supervisor.py`、`vendor/mediacrawler/requirements.lock` 是否属于被记录的本地桥接闭包。排除 `.venv`、`__pycache__`、`.pyc`、构建产物及未登记的上游源码。

## Task 1：冻结输入状态并确认唯一基线

**Files:** 不修改文件；检查主工作区、隔离集成工作树与远端引用。

- [ ] 在主工作区执行 `git fetch origin --prune`，记录 `git rev-parse HEAD`、`git rev-parse origin/main`、`git rev-list --count origin/main..main`。
- [ ] 保存只读基线：`git status --short --branch`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`。若真实暂存区非空，记录路径及 staged diff 摘要；后续不得触碰它。
- [ ] 确认 30 个领先提交仍全部属于写作/PPT之外的社媒功能之外的写作工作；若出现社媒提交或远端基线变化，暂停并重新界定提取来源。
- [ ] 确认隔离集成工作树分支为 `codex/domestic-social-research-final`、工作树干净，且 HEAD 等于最新 `origin/main`。若不等，先在该隔离工作树以最新远端重建集成基线；不重建或清理其他 worktree。
- [ ] 记录任务开始时主工作区状态，后续逐项对照；任何路径新增或内容变化都先判断是否为外部并发改动，不覆盖它。

## Task 2：用临时 index 从主工作区提取社媒专属改动

**Files:** 只读主工作区工作树；临时 index、提取 commit 均写入 Git 对象库，不移动分支、不写真实 index。

- [ ] 在主工作区外创建唯一临时 index 路径；若同名文件已存在则换新名称，不覆盖。初始化必须以主工作区当前 `HEAD` 为比较基准：

```powershell
$indexPath = Join-Path $env:TEMP 'social-integration-extract-<unique>.index'
$env:GIT_INDEX_FILE = $indexPath
git -C 'D:/VScode/项目/提示词工具' read-tree HEAD
```

- [ ] 先对照“文件范围”检查当前实际改动。把确认属于社媒的专属新增文件和 manifest 文件明确加入临时 index；对已跟踪的社媒专属文件，比较 HEAD 与工作区差异，整文件仅在文件职责确属社媒时加入。
- [ ] 对共享文件先用 `git diff --no-ext-diff --no-color --unified=0 HEAD -- <path>` 浏览完整差异，记录纳入的 hunk 序号与理由；用脚本把选中的 hunk 组成补丁，在临时 index 上运行 `git apply --cached --unidiff-zero --check <patch>`，通过后再应用。不要使用 `git add -p`；若 hunk 数与审阅记录不符、补丁检查失败，或社媒与写作逻辑在同一 hunk 内不可分，就不纳入该 hunk，并在隔离分支单独移植最小社媒改动。
- [ ] 检查临时 index 相对 HEAD 的清单和完整补丁：`git diff --cached --stat`、`git diff --cached --name-status`、`git diff --cached --check`、`git diff --cached`。确认没有删除写作文件，没有写作/PPT/学术专属路径，没有凭证、缓存或清单外 vendor 文件。
- [ ] 用 `git write-tree` 和 `git commit-tree` 创建一个以主工作区当前 HEAD 为 parent 的临时提取 commit；不要运行 `git commit`，不改主工作区分支或真实 index。保存提取 commit SHA 与完整路径清单。
- [ ] 验证提取 commit 的 parent 正是记录的主工作区 HEAD，且 `git diff-tree --no-commit-id --name-status -r <extract-sha>` 只含审过的社媒路径。清除当前 PowerShell 会话中的 `GIT_INDEX_FILE` 环境变量；临时 index 先保留到最终核查结束，不删除用户已有文件。
- [ ] 重新检查主工作区真实 index、HEAD、tracked/untracked 状态与 Task 1 基线。除了计划文件本身在本次任务被编辑外，不应出现由提取操作造成的变化；若有差异立即停止并恢复操作前状态，不用覆盖式命令。

## Task 3：把提取 commit 移植到干净远端分支

**Files:** 只修改隔离集成工作树；主工作区仍只读。

- [ ] 在集成工作树确认 `git status --porcelain` 为空，且当前 HEAD 等于 Task 1 记录的最新 `origin/main` SHA。
- [ ] 在集成分支执行 `git cherry-pick --no-commit <extract-sha>`，只应用改动、不提前创建正式功能提交。预期可能因提取 commit 的 parent 含有本地写作历史而产生冲突；冲突只在隔离工作树处理。
- [ ] 对冲突路径，分别查看远端基线、提取 commit 的父版本、提取版本和设计稿。只把社媒行为移植到远端现有结构；不得接受整文件覆盖。若冲突无法安全分离，执行 `git cherry-pick --abort` 并将该路径列为待决，不做上传。
- [ ] cherry-pick 完成后查看 `git diff origin/main...HEAD --stat`、`git diff origin/main...HEAD --name-status` 和完整 diff。逐路径确认只有国内社媒相关变化；特别审阅所有共享文件、依赖/锁文件和 vendor manifest。
- [ ] 将最终集成分支的社媒差异与主工作区当前社媒目标行为逐项对照设计稿及既有验收记录；提取 commit 仅是搬运工具，不作为远端分支历史基线。

## Task 4：隔离分支验证与本地应用验收

**Files:** 隔离工作树中的社媒源代码、测试、文档和打包配置。

- [x] 在集成工作树安装依赖前检查 `package.json`、pnpm lockfile 与 Node/pnpm 版本；使用项目锁文件对应的现有依赖，不切换包管理器。
- [ ] 运行 Node 社媒专项与集成回归：

```powershell
node --test tests/electron-social-research.test.js tests/server.test.js tests/social-api-client.test.js tests/social-browser-adapters.test.js tests/social-browser-manager.test.js tests/social-content-url.test.js tests/social-research-integration.test.js tests/social-research-schema.test.js tests/social-research-ui.test.js tests/social-research-workflow.test.js tests/social-source-manager.test.js tests/social-source-registry.test.js tests/workspace-backup-archive.test.js
```

- [x] 单独运行 MediaCrawler Python 单元测试：

```powershell
python -m unittest discover -s tests -p 'test_*.py'
```

预期发现并运行 `test_mediacrawler_bridge.py`、`test_mediacrawler_request_budget.py`、`test_windows_job_supervisor.py`。若项目锁定 Python 环境不可用，先按 `vendor/mediacrawler/requirements.lock` 准备隔离环境；每个实际跳过项单独记录，不把未执行写成通过。
- [x] 执行 `pnpm check`、`git diff origin/main...HEAD --check`；检查 manifest 中被纳入文件的 SHA-256 与清单记录一致，单独说明清单注明本地裁剪的例外。
- [ ] 按项目已有 Windows 打包脚本构建隔离版，在独立用户数据目录检查社媒入口、来源管理、研究任务、附件备份/恢复。不要触碰 4174/4175 服务进程或现有用户数据；真实平台登录/采集留待用户账号验收。
- [ ] 如修改导致验证失败，只在隔离分支修复并重跑受影响检查及跨模块回归；记录实际通过、跳过及未覆盖项。通过前不得创建上传 PR。

## Task 5：提交专属分支并上传评审

**Files:** 仅隔离集成分支中的已审查社媒差异。

- [ ] 提交前再次执行 `git status --short`、`git diff --cached --name-status`、`git diff origin/main...HEAD --name-status` 和完整 diff 审阅；确认没有主工作区那 30 个本地提交、写作/PPT/学术文件或清单外 vendor 内容。
- [ ] 在隔离分支提交中文 Conventional Commit 信息：`feat: 完成国内社媒研究增强`。提交文件仅来自本计划审核范围。
- [ ] 推送专用分支 `codex/domestic-social-research-final`，禁止推送主工作区 `main`。如果远端同名分支已前进，先 fetch 并审阅差异，不强推。
- [ ] 创建面向 `main` 的 PR，正文说明功能范围、验证结果、Windows 环境限制、MediaCrawler 来源/许可记录及真实平台待用户验收边界。
- [ ] 检查 PR 文件列表、提交列表和 CI。发现非社媒文件、额外提交或验证失败时停止合并，先修正专用分支。
- [ ] PR 门禁通过后再合并；合并后 fetch 并确认远端 `main` 包含 PR 变更。只核查 D 盘主工作区状态，不重置、不更新或覆盖其本地写作/PPT改动。

## Task 6：收尾与证据记录

**Files:** 本计划的验收记录；不改写主工作区产品代码。

- [ ] 记录源 HEAD、远端起点 SHA、提取 commit SHA、最终社媒提交 SHA、PR/合并标识和实际验证结果。
- [ ] 确认旧社媒回退点仍为本地参考且未推送；隔离分支包含预期社媒功能；主工作区原有暂存区和未提交修改仍在。
- [ ] 仅删除本任务实际新建且已确认路径的临时 index 文件；不删除其他临时文件、缓存、release 目录或 worktree 数据。
- [ ] 把真实平台登录与采集结果明确记为待用户侧验收；不因 PR 合并或本地测试通过而标记为通过。

## 计划自审

- 设计覆盖：保留四平台搜索/深读、来源管理、MediaCrawler 固定来源、预算/恢复、附件备份边界；通过专项测试、依赖来源校验和隔离版 UI 验收核查。
- 范围保护：30 个本地提交不会进入专用提取 commit；共享文件逐 hunk 审查；临时 index 基于其 parent `HEAD`，避免前一方案的比较基准混用。
- 已知限制：若社媒 hunk 必须依赖本地写作提交中的代码，计划要求在远端隔离分支重写为最小社媒改动或停止，不允许连带上传写作功能。
- 本次进展：已在隔离集成分支修复并验证社媒 Electron 主进程接线、来源生命周期清理、ZIP 备份依赖与 MediaCrawler 打包资源；未触碰 D 盘主工作区、未提交或推送。

## 本次执行记录（2026-10-22）

- `electron/main.js` 已从共同基线重新移植社媒 IPC、来源管理、URL 校验与附件 ZIP 导入导出；排除错位 patch 中混入的 PPT 反馈代码。`node --check` 与 `pnpm check` 通过。
- `package.json` 已声明运行时依赖 `yauzl`、`yazl`，并将 MediaCrawler 源码、桥接程序及许可文件配置到 `extraResources`。
- 新增 `.gitattributes` 固定 vendor 文本为 LF。manifest 的 10 个上游文件 SHA-256 全部匹配；登记的 requirements.lock 摘要与包内字节一致。
- Node 专项回归：261 项中 258 通过、2 失败、1 跳过。两项失败是 `origin/main` 已有的写作发送面板断言；基线 `prototype/app.js` 不含相应实现，本任务不引入写作提交。符号链接测试因当前 Windows 权限无法创建链接而跳过。
- MediaCrawler Python 单元测试：38 项通过。`pnpm check`、暂存与未暂存 diff whitespace 检查通过。
- Windows `dir` 目标打包成功，`release/win-unpacked` 已包含 33 个 MediaCrawler 运行文件，requirements.lock 摘要匹配。NSIS/便携版打包遇到工具下载 `ETIMEDOUT`；用缓存重试后仍未完成。打包 GUI 启动命令被当前执行策略拒绝，因此没有记录为运行验收通过。
- 未进行真实平台登录/采集；这仍需用户账号侧验收。当前为可运行目录候选，启动验证、安装版/便携版和 PR 门禁仍未完成。

- 授权范围：本次只在隔离集成分支实现并验证到 Windows `dir` 包候选；未提交、推送、创建 PR 或合并。后续发布步骤须在本地验收边界解除后继续。
