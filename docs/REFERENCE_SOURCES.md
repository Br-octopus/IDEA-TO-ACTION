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

## 国内社媒搜索适配参考

| 来源 | 许可 / 可借鉴内容 | 本项目采用方式与边界 |
| --- | --- | --- |
| [adoresever/bilibili-mcp](https://github.com/adoresever/bilibili-mcp) | 仓库标注 MIT；README 区分视频搜索、详情、评论、字幕等能力，并说明请求间隔控制；需要 Python 3.10+ | 仅参考能力拆分、结果整理和节流意识；本轮不复制代码，不接入凭证文件、写入/互动工具、批量采集或绕过平台访问限制的实现 |
| [huccihuang/bilibili-mcp-server](https://github.com/huccihuang/bilibili-mcp-server) | 仓库标注 MIT；提供按视频、用户等类型区分的搜索入口，运行方式依赖 Python/uv | 仅参考搜索类型和结果字段应清晰声明；本轮维持单一关键词只读搜索，不增加额外运行时依赖 |
| [qinyuanpei/mcp-server-weibo](https://github.com/qinyuanpei/mcp-server-weibo) | 仓库标注 MIT；包含微博搜索、热搜和内容字段组织，并提供 CLI / MCP 入口；其实现使用访客接口和本地会话 | 参考搜索结果字段、工具边界和错误表达；不复制访客接口、签名、Cookie 或扫码登录实现，本应用继续走真实浏览器可见页面 |
| [NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | 覆盖小红书、抖音、快手、B 站、微博、贴吧和知乎；仓库当前 LICENSE 为自定义“非商业学习使用许可证 1.1”；用户于 2026-10-20 明确说明已取得本项目代码复用和修改授权 | 当前尚未导入代码；后续基于用户已取得的授权，固定上游提交，复用并修改四平台所需的采集、登录检查、节流和字段整理代码，保留许可与修改记录；通过应用管理的本地进程按预算调用，不引入代理池、账号轮换、自动验证码处理或无边界采集 |
| [ywleeo/browser-mcp](https://github.com/ywleeo/browser-mcp) | MIT；本地真实 Chrome、可见 DOM 搜索、登录态隔离和固定工具边界 | 参考“通过真实浏览器页面读取，而不是复制站点私有接口”的实现方向；不接入其通用浏览器控制面，不开放点击、发布、点赞、评论或任意脚本能力 |
| [we1005/zhihu-mcp](https://github.com/we1005/zhihu-mcp) | 知乎关键词搜索与回答/文章结果组织；依赖用户 Cookie，仓库当前未列出 LICENSE 文件 | 仅参考搜索结果分类和来源字段；不复制代码、不导入 Cookie 管理方式，不接入直答等超出本应用只读搜索范围的能力 |
| [Kuhakucai/douyin-mcp](https://github.com/Kuhakucai/douyin-mcp) | AGPL-3.0-only；面向个人创作者数据，仓库明确提示平台访问及条款风险 | 用于评估抖音后续适配的浏览器与凭证隔离问题；本轮不复制代码，不调用未公开接口，不处理作品发布或商业数据能力 |
| [wbsu2003/weixin-search-mcp](https://github.com/wbsu2003/weixin-search-mcp) | 仓库标注 MIT；提供微信公众号文章关键词搜索的 MCP / HTTP 服务 | 作为后续内容平台候选；先评估其搜索来源、公开可达性和结果稳定性，不直接接入第三方服务或复制采集实现 |

### 国内平台扩展顺序

1. 当前接入批次：小红书、哔哩哔哩、微博、知乎的关键词只读搜索。微博和知乎在完成真实站点手动验收前，平台状态保持“真实站点待实测”。
2. 后续评估批次：优先比较微信公众号文章搜索、抖音和快手。先确认只读公开搜索是否能通过真实浏览器稳定完成、是否需要用户登录及访问边界，再决定是否接入；不因为第三方项目已实现搜索或采集就默认复制其接口、签名、代理或风控处理。
3. 2026-10-20 采用方式更新：用户明确说明已取得 MediaCrawler 代码复用和修改授权，因此后续可在该授权前提下复用并修改固定版本代码；不再执行此前“仅供参考、不复制”的项目决策。当前能力、四阶段顺序和后续路线图以 [增强总版设计](superpowers/specs/2026-10-20-domestic-social-research-enhancement-design.md) 为准；其他来源的采用方式继续按各自行记录，不把本项目授权扩大为通用许可。

## 产品与知识检索先例

| 来源 | 适合研究的内容 | 采用方式与注意事项 |
| --- | --- | --- |
| [imbajin/goal-prompt](https://github.com/imbajin/goal-prompt) | 目标澄清、边界确认和可复制交接指令 | 最接近的流程先例；参考目标确认后交付指令、不直接执行任务的边界 |
| [Bhargs24/keel](https://github.com/Bhargs24/keel) | 从产品构想到软件交付的阶段推进和下一步建议 | 参考阶段感和持续明确下一步；不假设它的方法适用于所有非软件任务 |
| [ycedrick/socratic](https://github.com/ycedrick/socratic) | 通过少量提问补齐提示词关键信息 | 参考自适应追问；未确认的信息可作为假设继续，不让问答变成门槛 |
| [Dify](https://github.com/langgenius/dify) | 工作流与知识检索的组织方式 | 只研究概念；仓库许可证在 Apache 2.0 基础上带有额外条款，不直接复制代码 |
| [Humanizer-zh](https://github.com/op7418/Humanizer-zh) | 中文文本诊断和编辑原则 | 只借鉴可观察的文本特征，不能用来证明作者身份或给出伪精确的 AI 概率 |

## 资料进入产品的统一规则

1. 每条资料记录来源链接、摘要、可借鉴方法、局限、许可、验证状态和适用案例；可补充标题、来源类型、适用任务/阶段及更新时间。
2. 收录公开仓库不等于拥有复制许可；核对仓库及具体内容的权利来源后，才能决定是否复用。
3. 公开示例/教程和用户实际验证并确认的个人经验共用统一搜索结果，通过类型和验证状态区分；不得因收录或热门就标成有效，新添加资料默认未验证。
4. 研究时按任务与当前步骤筛选少量资料；模型只收到用户选择的必要摘要或片段，不会每次加载整个仓库。
5. 外部内容当作待评估资料，不能覆盖用户目标、隐私设置或产品规则。
6. 对系统提示词泄露库只做受限的安全与设计研究；不要将其原文用于提示词库或运行时上下文。
7. 用户案例、提示词版本和个人经验默认保存在本机；外发前展示将发送内容并允许删减。

