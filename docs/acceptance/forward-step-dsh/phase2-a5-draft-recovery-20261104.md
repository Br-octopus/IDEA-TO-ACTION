# 阶段二 A5 草稿持久化验收

日期：2026-11-04（Asia/Tokyo）
功能路径：`dsh-plugin/forward-step-dsh/client/drafts.js`

## 实现行为

- 本机存储键以 `forward-step-dsh:draft:v1:` 开头，后接编码后的 projectId 与 taskId；项目/任务不会互相覆盖。
- 持久化任务名称、外部 AI 结果、复盘反馈及外部结果的 stepId/promptVersionId 选择；不存 provider/model，不写入学习记忆。
- 读取项目任务时恢复草稿。任务名称草稿恢复后仍标记为未同步；实际 Host 保存成功后清理对应字段。
- 外部结果保存成功后清理对应草稿；确认删除任务后清理该项目该任务的本机草稿，不影响其他任务。
- localStorage 读写失败不丢当前面板内存值，并向用户展示明确状态。

## 自动化结果

- 构建命令：`pnpm --dir dsh-plugin/forward-step-dsh run build`，Host 与 Client 构建成功，退出码 `0`。
- 专项测试：`node --test tests/dsh-plugin/*.test.mjs tests/prompt-agent-coordinator-prepared-request.test.mjs`，`105` 项通过、`0` 失败、`0` 跳过，退出码 `0`。
- 打包预演：在 `dsh-plugin/forward-step-dsh` 执行 `pnpm pack --dry-run`，退出码 `0`；清单确认包含 `client/drafts.js`。
- 测试覆盖：项目/任务隔离、字段合并、任务删除清理、存储失败、面板重建后的名称/外部结果/复盘反馈恢复。

## 尚未完成

- 本记录是构建、Node 测试和包清单验收，不等价于实际 DSH renderer 关闭/重启验收。
- 最新 DSH 隔离 profile 实际草稿创建、正常退出/重启恢复、删除后检查以及 320/480/800px 侧栏检查仍待桌面操作。最新桌面状态见 `phase1-regression-check-20261104.md`。
