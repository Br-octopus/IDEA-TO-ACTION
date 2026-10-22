# 社媒研究分步向导实施计划

日期：2026-10-20
依据：docs/superpowers/specs/2026-10-20-social-research-wizard-design.md
状态：待实施（本回合只产出计划，不改代码）

## 阶段 1：步骤状态推导（纯逻辑，先测后改）

1. 在 social-research-ui.js 新增 `deriveWizardStage(task, platformStatus)` 纯函数：
   - 输入：现有 task 对象（status、results、report）与平台状态数组。
   - 输出：`{ stage: 1|2|3|4, reachable: {1,2,3,4}, reportReady: boolean }`。
   - 推导规则：无 plan → 1；有 plan 未确认/运行中 → 2；结果产出（results 非空）→ 3；report 存在 → 4 可达。
2. 单元测试（tests/social-research-ui.test.js）覆盖：空状态、仅有计划、运行中、有结果、有报告、平台异常共 6 个用例。
3. 验证：node --test tests/social-research-ui.test.js。

## 阶段 2：向导容器与显示切换（index.html + UI 渲染）

1. index.html：social-research 视图顶部加步骤条 DOM（4 个 button + aria-current），平台准备面板外包一个折叠容器（<details> 或等价按钮控制），现有五个 panel 的 ID 全部保留。
2. social-research-ui.js：
   - renderTask 入口改为按 deriveWizardStage 结果只渲染当前步骤容器，其余容器 hidden。
   - 平台准备渲染为摘要行（"N 个平台就绪 / M 个平台异常"），点击展开原面板；平台异常时自动展开。
   - 平台登录失效时第 3 步顶部渲染提示条。
3. 验证：impeccable detect 无反模式；手动/测试确认四步切换。

## 阶段 3：自动流转与按钮归属

1. social-research-ui.js 内新增模块级变量 `wizardAutoSwitched`（会话内，不持久化）：
   - 生成计划成功回调 → 跳第 2 步。
   - 确认运行后首次 results 产出 → 自动切第 3 步，随后置位 wizardAutoSwitched，不再自动切。
   - 报告生成 → 第 4 步步骤条加 badge，不跳转。
2. 暂停/取消按钮保留在第 2 步面板（现有 ID 不动）。
3. 第 4 步入口在 report 不存在时 disabled。
4. 测试：补 3 个用例（自动切第 3 步只发生一次、报告 badge、第 4 步置灰）。

## 阶段 4：回归与提交

1. npm run check（全量语法）。
2. node --test 全量，确认 0 失败。
3. impeccable detect prototype/index.html 与 social-research-ui 相关页面。
4. 每阶段单独 commit；最后在浏览器目检四步流程。

## 风险与回退

- 全部改动限于 prototype/index.html、prototype/social-research-ui.js、tests/social-research-ui.test.js；不动后端与 schema。
- 若自动流转与现有事件时序冲突，回退为手动"下一步"按钮（spec 允许的最小降级，需在 commit message 标注）。

