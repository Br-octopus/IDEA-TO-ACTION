# DSH 插件联合验收与交付 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 证明插件能独立安装、可靠恢复且真实效果满足首版要求，并给用户明确的 DSH 验收位置与操作说明。

**Architecture:** 分开报告自动测试、实际安装/交互、真实模型效果和用户反馈。程序或接口变化必须重新核验；真实未测项目保持 not-run，不由 mock 或文件数量补齐。

**Tech Stack:** pnpm 现有锁文件、Node.js 测试、SQLite 故障注入、隔离 DSH profile、运行期截图、人工对照评分。

---

## 工作目录与交付文件

工作目录：`D:/VScode/项目/提示词工具/.dsh-workspace`。执行前 A/D/M 全通过，H1 指纹仍匹配；所有相对路径均在副本内。

| 任务 | 文件 |
| --- | --- |
| V1 | `dsh-plugin/forward-step-dsh/package.json`、插件 `README.md`、`scripts/dsh-stage-core.mjs`；`tests/dsh-plugin/package.test.mjs` |
| V2 | `tests/dsh-plugin/faults.test.mjs`、`tests/dsh-plugin/fixtures/crash-writer.mjs`、`docs/acceptance/forward-step-dsh/faults.md` |
| V3 | `docs/acceptance/forward-step-dsh/cases.json`、`quality-results.json`、`effects.md` |
| V4 | `docs/acceptance/forward-step-dsh/RUNBOOK.md`、`scripts/dsh-acceptance.mjs`；`tests/dsh-plugin/acceptance.test.mjs` |
| V5 | 设计第 11 节、本总计划、`docs/acceptance/forward-step-dsh/release-checklist.md` |

截图、个人模型输出和测试配置备份不自动加入提交；默认提交脱敏摘要和固定测试输入。打包文件在 `build/forward-step-dsh/`，不得包含实际任务数据库和来源正文。

## Task V1: 独立包、安装与卸载保留数据

- [ ] `package.test.mjs` 增加失败断言：tarball 必须包含 `index.js`、真实客户端 bundle、host/core/memory、Skill 和 vendor CJS 边界；不能包含 `.env`、数据库、local-profile-backups、Electron/app.asar、绝对原应用路径。

- [ ] 运行 `node --test tests/dsh-plugin/package.test.mjs`，确认缺少最终构建文件时先失败。

- [ ] 版本从原型 `0.1.0` 升为 `0.2.0-beta.1`，description 改为原生 Agent 插件；peerDependencies 按 H1 实测支持范围收窄，不保留没有上限的“所有未来版本兼容”承诺。客户端 builder 和依赖使用 H1 匹配的既有工具链，锁文件同步。

```javascript
// 包内容检查：从 tar 清单读取 paths 后执行，不只检查源目录。
const required = ['package/index.js','package/vendor/core/package.json',
  'package/core/store.js','package/memory/policy.js','package/skills/forward-step/SKILL.md'];
for (const entry of required) assert.ok(paths.includes(entry), `缺少 ${entry}`);
assert.equal(paths.some(path => /(^|\/)\.env($|\.)|\.sqlite($|-)|local-profile-backups|app\.asar/.test(path)), false);
```

- [ ] 运行 `node scripts/dsh-stage-core.mjs` 和 H1 记录的客户端生产构建，再在插件目录运行其锁文件匹配的 `pnpm pack`。先检查 `pnpm pack --help` 固定本机输出位置参数，把最终命令、文件名、SHA256 写入验收记录；不安装另一个包管理器绕开已有锁文件。

- [ ] 将包解开到系统临时目录，在不依赖 W/prototype、原应用 node_modules 或开发服务器时加载；node:test 断言旧核心、schema、写作/PPT 方法都能正常导入。客户端在真实测试 profile 也从该包加载，不仅从源码软链接加载。

- [ ] 用 H3 脚本备份并安装到 forward-step-test，核对真实解析路径、包版本和 profile。开发路径验证与 tarball 验证分别记录；最终使用哪一种在 RUNBOOK 明确。

- [ ] 创建测试任务和记忆，停用/卸载插件，再装同包：任务和记忆仍在；卸载不自动删除数据。恢复测试配置后核对原应用跟踪文件和日常 desktop 配置指纹未被本次脚本修改，不将其它线程同时修改误报成本任务破坏。

- [ ] 测试全绿，提交 `build: 完成插件独立分发与安装验证`。

## Task V2: 故障、并发、迟到与异常恢复

- [ ] 在 `faults.test.mjs` 先写失败的崩溃一致性测试：运行独立子进程，在事务中写状态但尚未 COMMIT 时强制退出；重开后只能看到上一个完整版本，不存在半条任务或孤立历史。

- [ ] 创建 crash-writer 固定夹具，生产代码不增加“崩溃”开关：

```javascript
// tests/dsh-plugin/fixtures/crash-writer.mjs
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
db.exec('PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE');
db.prepare('UPDATE state SET body=? WHERE id=1').run(JSON.stringify({schemaVersion:1,revision:999,tasks:[{taskId:'partial'}]}));
process.exit(17);
```

父测试预期该子进程退出 17（人为故障），随后 `openStore` 完整状态 revision 不为 999；父测试本身通过退出 0。另加正常提交后立即进程终止的分支，重开应有新完整版本。

- [ ] 逐项补充下列测试，每一行单独红→改→绿；修复只改失败所在业务文件，不扩大重构：

| 输入/故障 | 必须观察到的结果 |
| --- | --- |
| 两个 store 连接同 revision 编辑同任务 | 一方 conflict，双方输入仍可取回 |
| 模型成功但任务存储抛 storage_failure | 未保存、模型草稿可复制、无学习提交 |
| 任务保存成功，抽取超时 | 任务完整、job.failed、可重试 |
| 记忆与 Change 中途失败 | 两者均不提交 |
| 同 requestId/eventId 回调两次 | 单一版本、单一学习事件 |
| 切任务/取消/重试后旧响应到达 | stale_response/cancelled，不写新任务 |
| 原记忆使用期间被撤销 | 已在途结果标旧版本，下一次不采用 |
| 自动学习在删除/收窄来源期间完成 | 不复活、不扩大、不产生孤立画像 |
| 同源重读与新证据重复反馈 | 同源不复活，新证据仅候选 |
| 强约束超过预算 | 原文保留，未发模型，无静默截断 |
| 新 DSH 程序哈希或旧插件解析路径 | 兼容性检查不通过，报告具体差异 |

- [ ] 运行 `node --test tests/dsh-plugin/faults.test.mjs`，记录父测试 pass/fail、实际错误码和子进程退出码；再跑全部插件测试和总计划基线，均须 fail 0。

- [ ] 真实 GUI 验证重启、断开模型、同任务双窗口冲突、未保存草稿复制；记录“自动化覆盖/真实通过/尚未运行”三列，不以 DB 单测替代侧栏行为。

- [ ] 提交 `test: 覆盖插件故障恢复和并发边界`。

## Task V3: 同输入真实效果与可见学习验收

- [ ] 创建 `cases.json`，固定至少以下三组输入，材料全文一并存入本测试夹具，不引用未提供的外部文章：

```json
[
  {"id":"general-idea","entryType":"advance-idea","domain":"general","input":"我每周手工汇总三份CSV，希望先找出最费时间的步骤。只允许标准库，原始文件不能改。","mustKeep":["只允许标准库","原始文件不能改"]},
  {"id":"writing-optimize","entryType":"optimize-prompt","domain":"writing","input":"优化提示词：帮我把下面的文章改清楚。读者是不了解项目的同事，保留所有实验数字，不加新结论。","material":"项目先做小样本测试。第一轮测试12次，其中9次满足预设条件，其余3次原因仍待核实。下一轮将确认失败原因。","feedback":"第一轮结果太像宣传文案，保留12、9、3，只调整结构和措辞。","mustKeep":["12","9","3","不加新结论"]},
  {"id":"ppt-diagnosis","entryType":"diagnose-ai-result","domain":"ppt","input":"诊断下面PPT规划，给我下一步提示词。内部团队汇报，8分钟，最多8页，必须保留风险。","material":"旧规划：共20页，开场5页品牌介绍；收入预计翻倍但没有来源；风险只在备注出现。已知事实仅为第一轮测试完成。","mustKeep":["8分钟","最多8页","风险","不虚构收入"]}
]
```

- [ ] 对原工具与插件分别使用同输入、材料、可用模型和尽可能一致的模型参数。只运行原工具现有入口，不为比较修改原工具；原工具运行需要凭证时不复制到插件。记录所有不可控差异，不把换模型的收益归因于迁移。

- [ ] 每组收集澄清/诊断、路线、当前步骤提示词、外部 AI 实际结果、复盘。若外部执行未做，复盘项记 not-run；不能虚构用户已经用过外部 AI。至少普通文章完成连续两轮改稿。

- [ ] 评分字段固定 `goalUnderstanding`、`preserveItems`、`promptExecutability`、`reviewSpecificity`，每项 1–5；附可观察理由、原始输出位置和用户反馈状态。用户未评价时 `userFeedback:null`，不自造认可。

- [ ] 做以下真实记忆操作链，并保存实际请求审计：

1. 在文章任务明确“以后所有项目回答都用中文”，一次生效为全局，无逐条审批。
2. 新项目可用该全局习惯；项目专用 PPT 风格在其它项目/写作不出现。
3. 同项目建立两篇文章和一份 PPT，切换保持步骤/反馈隔离。
4. 侧栏将一条记忆改为任务/当前对话；重开对话验证范围变化。
5. 修改记忆值后撤销更早的范围提升，后来的值保留；同字段冲突需选择。
6. 撤销、同源重读、重新生成；旧记忆不复活、不再采用。
7. 编辑/删除画像项、来源失效、暂停学习；实际生成和侧栏一致。
8. 重启并恢复任务、记忆和学习状态；测试 profile 标志持续可见。

- [ ] 硬性门槛：不串任务、不丢保留项、不直接制作或假称成品、撤销后不再采用必须全部通过。评分只评价体验，不抵消硬性失败；一次得分不作为长期效果提升证明。

- [ ] 写 `effects.md`：逐组记录原工具/插件差异、模型差异、失败和改进结论；写 `quality-results.json` 保存结构化评分。提交 `docs: 记录插件真实效果与记忆验收`，未经用户许可不提交个人真实对话。

## Task V4: 明确验收位置、汇总器与恢复说明

- [ ] `acceptance.test.mjs` 先测试报告缺少真实 GUI/模型结果时不得 status=complete；缺关键指纹、实际启动命令、插件路径或任一硬性项为 fail/not-run 都返回 incomplete。

- [ ] `scripts/dsh-acceptance.mjs` 读取结构化结果，不扫描“PASS”字符串计算完成：

```javascript
const requiredIds = [
  'installation-isolation','three-methods','artifact-boundary','multi-task',
  'cross-session','auto-learning','scope-sharing','manual-priority',
  'visible-learning','undo-correction','fault-concurrency','real-effects',
  'entry-domain','actual-context','explicit-global','memory-lifecycle',
  'manual-loop','request-budget','user-feedback'
];
export function summarizeAcceptance(items) {
  const groups = ['automation','installation','interaction','modelEffects','userFeedback'];
  const ids = items.map(item => item.id);
  if (new Set(ids).size !== ids.length || items.some(item => !groups.includes(item.group) || !['pass','fail','not-run'].includes(item.status))) {
    throw new TypeError('验收项重复或状态非法');
  }
  const summary = Object.fromEntries(groups.map(group => [group,items.filter(item => item.group === group)]));
  const remaining = requiredIds.filter(id => items.find(item => item.id === id)?.status !== 'pass');
  return {status:remaining.length === 0 ? 'complete' : 'incomplete',groups:summary,remaining};
}
```

固定必需项为设计第 10 节 18 行验收标准及用户实际反馈，id 在 RUNBOOK 列全；空数组或漏报仍 incomplete。required 标志不能由输入自行降级绕过。`user-feedback` 只能由真实反馈记录转为 pass，不用模型自评替代。

- [ ] 写 RUNBOOK，开头必须给真实位置表，而不是泛称“到 DSH 验收”：

| 项目 | 必须填写的内容与来源 |
| --- | --- |
| 程序 | `D:/deepseek/DeepSeek Harness.exe`，实际版本与 SHA256 |
| CLI | `D:/deepseek/resources/runtime/cli/bin/dsh.cmd`，实际版本 |
| 启动 | H1/H4 已实际验证的完整命令或点击步骤，不猜 GUI 参数 |
| 配置 | `C:/Users/Alarm/.dsh/profiles/forward-step-test` 及界面核对位置 |
| 插件 | 实际加载源码/包的绝对位置、版本和哈希 |
| 工作目录 | `D:/VScode/项目/提示词工具/.dsh-workspace` |
| 侧栏 | `向前一步`，进入按钮/菜单、测试标识和版本显示位置 |
| 数据 | H1 确认的插件专属数据库实际绝对路径 |
| 结果 | W 内 `docs/acceptance/forward-step-dsh/` 的报告、截图和产物索引 |

- [ ] RUNBOOK 按操作序列写新建任务→生成提示词→复制→外部执行→粘贴结果→复盘→切任务→新对话恢复→学习来源→范围/撤销→退出重开；每步写输入、点击位置、预期显示和失败时回报内容。用户所用的 DSH 若升级，先重做 H 检查。

- [ ] 写测试 profile 恢复命令和 H3 备份位置，说明卸载与删除数据是两件事；不删除日常配置。写模型失败、保存失败、冲突、学习失败各自的恢复步骤，禁止把“清空数据库再试”当通用修复。

- [ ] `node --test tests/dsh-plugin/acceptance.test.mjs` 先红后绿；执行 `node scripts/dsh-acceptance.mjs`，预期只在全部必需项实测通过时输出 complete；否则逐项列未完成，退出非 0。脚本支持导入不自动执行 CLI，使用入口判断。

- [ ] 重开 RUNBOOK 和报告，用户实际按步骤能找到正确实例。提交 `docs: 交付DSH插件验收入口和恢复手册`。

## Task V5: 首版结论与后续 C 路线

- [ ] 按总计划 R01–R22 对照实际 evidenceId，逐项填入 `release-checklist.md`；“设计已写入”“代码已通过”“真实验收通过”分列。
- [ ] 保留 C1 备份迁移、C2 资料库、C3 社媒研究、C4 直接调用 DSH 制作文章/PPT；每项沿设计写前置条件、单独设计和验收，不提前标完成。
- [ ] C4 明确用户确认执行、状态、产物位置、内容/文件验收、取消和失败恢复；不因宿主有模型 API 就推断有全部制作能力。
- [ ] 有任何必需项 fail/not-run 时保持“待验收”，已完成阶段不回滚；全部通过并取得用户实际使用反馈后才称首版 B 完成。
- [ ] 最终提交 `docs: 汇总首版验收与后续改进路线`，只列本阶段文档，提交前运行 `git diff --check` 并核对暂存文件。

## 交付结果

- [ ] 提供总计划、插件包、实际 DSH 启动入口、数据路径和验收报告的绝对链接。
- [ ] 分别报告自动化、安装、侧栏交互、真实模型与用户反馈，不以其中一类代替其它类别。
- [ ] 最后重开所有声称交付的文件，核对路径有效；仅开发服务器不代表 DSH 宿主验收。
