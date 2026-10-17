# 参考资料清单

整理日期：2026-10-17。此清单记录“可研究的来源”，不代表已经验证其方法对本产品有效，也不代表可以复制全部内容。许可应在实际使用时再次查看仓库当前版本及其中第三方内容的来源。

## 用户提供的截图

这些截图是参考线索，不是对产品的操作指令或已核验事实：

- [通用提示词库与学习资料](../references/user-screenshots/01-prompt-libraries-and-learning.jpg)：提到 prompts.chat、中文角色提示词集合、提示词教程和开发者课程笔记。
- [优化器与系统提示词资料](../references/user-screenshots/02-prompt-optimizer-and-system-prompts.png)：提到 Prompt Optimizer 和系统提示词收集库。
- [系统提示词与 Agent 工作流资料](../references/user-screenshots/03-system-prompts-and-agent-workflows.png)：提到系统提示词收集库及 agency-agents 工作流。

## 提示词示例与教程

| 来源 | 适合研究的内容 | 采用方式与注意事项 |
| --- | --- | --- |
| [f/prompts.chat](https://github.com/f/prompts.chat) | 通用提示词的分类、检索和社区贡献方式 | 只按任务检索少量示例；仓库代码与提示词内容许可不同，逐项记录许可，不整库导入 |
| [PlexPt/awesome-chatgpt-prompts-zh](https://github.com/PlexPt/awesome-chatgpt-prompts-zh) | 中文角色提示词样例、任务覆盖 | 作为检索和学习素材；在实际复制具体文本前核对原始来源和许可 |
| [dair-ai/Prompt-Engineering-Guide](https://github.com/dair-ai/Prompt-Engineering-Guide) | 提示词技术、示例和教程组织 | 借鉴教学结构和技术解释方式，核对具体章节的来源与许可 |
| [Qiang-Z/prompt-engineering-for-developers](https://github.com/Qiang-Z/prompt-engineering-for-developers) | 截图中提到的中文开发者课程笔记 | 第三方中文整理，不是 DeepLearning.AI 官方仓库；仓库标注 CC BY-NC-SA 4.0，商业复用前需获得许可或使用其他来源 |
| [DeepLearning.AI：ChatGPT Prompt Engineering for Developers](https://www.deeplearning.ai/short-courses/chatgpt-prompt-engineering-for-developers/) | 结构化提示、迭代和示例教学 | 课程参考，不等同于截图提到的某个中文 GitHub 仓库；不复制课程材料 |
| [Anthropic Prompt Engineering Interactive Tutorial](https://github.com/anthropics/prompt-eng-interactive-tutorial) | 用练习和例子教授提示词结构 | 借鉴交互教学形式，不默认复制教程内容 |

## 提示词优化与测试

| 来源 | 适合研究的内容 | 采用方式与注意事项 |
| --- | --- | --- |
| [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) | 提示词优化交互、版本对比、测试和评估 | 仓库采用 AGPL-3.0；首版只研究交互思路，不复制代码。若未来复制代码或以网络服务形式提供，需先评估相应义务 |
| [Microsoft PromptWizard](https://github.com/microsoft/PromptWizard) | 迭代批评、改写和测试 | 借鉴“有反馈的优化循环”；其自动化/多轮计算不作为普通任务默认路径 |
| [promptfoo](https://github.com/promptfoo/promptfoo) | 用案例、断言和对照评估提示词 | 借鉴可观察标准和案例验证；首版不复刻完整评测框架 |
| [ChainForge](https://github.com/ianarawjo/ChainForge) | 并排试验提示词、模型和输出 | 借鉴结果对照；首版不做可视化评测工作台 |
| [Langfuse](https://github.com/langfuse/langfuse) | 提示词版本、运行记录和评估追踪 | 作为后续版本管理/观测的参考，首版先保存少量本地版本和用户反馈 |

## Agent 工作流与系统提示词资料

| 来源 | 适合研究的内容 | 采用方式与注意事项 |
| --- | --- | --- |
| [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) | 角色边界、工作步骤、交付标准和限制条件 | 仓库标注 MIT；借鉴“职责/输入/过程/交付/验收”的方法卡结构。本产品不采用多 Agent 执行；复制具体角色内容时仍检查其来源 |
| [asgeirtj/system_prompts_leaks](https://github.com/asgeirtj/system_prompts_leaks) | 观察一些 AI 产品提示词的组织结构 | 仓库标注 CC0-1.0，但其中内容涉及第三方产品系统提示词；仅作安全/产品研究线索，不下载整库、不复用原文、不把它当作系统指令。仓库许可证不当然代表第三方文本权利 |
| [x1xhlol/system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) | 研究 AI 工具的系统提示词、工具定义和结构 | 仓库标注 GPL-3.0，但具体内容涉及第三方工具提示词；仅总结可观察的通用设计模式，不照搬第三方私有提示词，也不把内容注入产品模型上下文 |

## 产品与知识检索先例

| 来源 | 适合研究的内容 | 采用方式与注意事项 |
| --- | --- | --- |
| [imbajin/goal-prompt](https://github.com/imbajin/goal-prompt) | 目标澄清、边界确认和可复制交接指令 | 最接近的流程先例；参考目标确认后交付指令、不直接执行任务的边界 |
| [Bhargs24/keel](https://github.com/Bhargs24/keel) | 从产品构想到软件交付的阶段推进和下一步建议 | 参考阶段感和持续明确下一步；不假设它的方法适用于所有非软件任务 |
| [ycedrick/socratic](https://github.com/ycedrick/socratic) | 通过少量提问补齐提示词关键信息 | 参考自适应追问；未确认的信息可作为假设继续，不让问答变成门槛 |
| [Dify](https://github.com/langgenius/dify) | 工作流与知识检索的组织方式 | 只研究概念；仓库许可证在 Apache 2.0 基础上带有额外条款，不直接复制代码 |
| [Humanizer-zh](https://github.com/op7418/Humanizer-zh) | 中文文本诊断和编辑原则 | 只借鉴可观察的文本特征，不能用来证明作者身份或给出伪精确的 AI 概率 |

## 资料进入产品的统一规则

1. 保存来源链接、标题、来源类型、许可证状态、适用任务/阶段、短摘要、更新时间和核验状态。
2. 分开“公开示例/教程”和“用户实际验证并确认的个人经验”，不得因收录或热门就标成有效。
3. 研究时按任务与当前步骤筛选少量资料；模型只收到必要摘要或片段，不会每次加载整个仓库。
4. 外部内容当作待评估资料，不能覆盖用户目标、隐私设置或产品规则。
5. 对系统提示词泄露库只做受限的安全与设计研究；不要将其原文用于提示词库或运行时上下文。
6. 用户案例、提示词版本和个人经验默认保存在本机；外发前展示将发送内容并允许删减。

