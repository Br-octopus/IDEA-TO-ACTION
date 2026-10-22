# 导航与创作流程改造实现计划（2026-10-23）

设计稿：docs/superpowers/specs/2026-10-23-navigation-flow-design.md

## 阶段 1：导航分组与移动端底部栏

- prototype/index.html：侧边栏按"开始一件事 / 已有素材 / 资产与配置"三组重排，加组标题样式。
- 移动端底部栏改为 新建、研究、Agent、文章 + "更多"按钮，"更多"弹出包含提示词库、资料库、设置的面板。
- 验证：桌面与移动端样式检查，现有 data-view 点击逻辑不变。

## 阶段 2：引导页（新建规划改造）

- prototype/index.html：view-home 顶部加纵向流程条（想法 → 计划 → 研究 → 提示词 → 复盘），节点显示状态并可点击跳转。
- 流程条下方加 4 张直接开始卡片：社媒研究、提示词 Agent、文章改写、打开最近计划。
- prototype/app.js：渲染流程条状态（基于 activeProjectId 与最近计划），卡片点击调用 go()。

## 阶段 3：阶段间跳转与上下文传递

- go() 增加 article 为独立视图（保留别名到 prompt-agent writing 场景），面包屑支持来源阶段后缀。
- 计划工作台加"用这个目标做社媒研究"按钮：把 goalSummary/研究问题带入 social-research-topic 并 go("social-research")。
- 社媒研究完成后提示词 Agent 可引用研究结论：复用 save-selection 已保存的材料摘要，Agent 本地资料检索已覆盖；在研究报告面板加"带结果去提示词 Agent"按钮，把报告文本写入 Agent 输入。
- Agent 生成的提示词在文章改写场景可选：沿用 savePrompt 存入提示词库，writing 场景材料选择已可引用。

## 阶段 4：错误与边界 + 回归

- 未就绪目标置灰并显示原因；上下文丢失提示"已按独立任务打开"。
- 运行 npm run check 与 node --test 全量回归。
- 更新受影响的 UI 测试（social-research-ui、e2e-smoke、writing-pack-ui 等）。
