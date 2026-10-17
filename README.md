# 向前一步

一个帮助用户把模糊想法推进成可执行路线和可复制 AI 指令的个人工具。它负责澄清目标、发现遗漏、按需研究、拆解步骤、生成提示词并复盘外部 AI 的结果；不直接代做文章、PPT、代码或现实任务。

## 当前状态

- 首版交付目标是 Windows 桌面应用：同时提供 NSIS 安装包和 portable `.exe`。
- 已确认产品方向，Electron 桌面壳、本地服务和核心提示词/复盘闭环已完成；当前验收重点是静态/服务级边界和 Windows 打包，真实 Electron UI 仍需在全新用户目录手动验收。
- 已完成 Electron 桌面拆分：`electron/` 管理窗口、内置本地服务和安全设置，`prototype/` 提供静态前端，`server.js` 提供服务入口、模型调用入口和可选搜索适配入口。
- 可编辑发送面板已完成，支持在复制或调用模型前查看和调整实际发送内容。
- 模型和搜索都是可选能力；未配置、断网、请求失败或模型/搜索服务返回错误时，保持“复制指令/手动搜索”的降级，不会伪称已经调用模型或完成联网研究。
- 公开参考资料只作为待评估的方法和案例线索；用户实际使用后确认的经验单独进入本地案例库，两者不会混成“已验证知识”。
- 工具负责澄清目标、规划步骤、生成可复制提示词和复盘外部结果，不直接代做文章、PPT、代码或现实任务。

## 项目资料

- [产品设计](docs/PRODUCT_DESIGN.md)：完整定位、用户流程、隐私边界和验收标准。
- [首版 MVP 范围](docs/MVP_SCOPE.md)：首版做什么、不做什么及验收条件。
- [参考资料清单](docs/REFERENCE_SOURCES.md)：GitHub / 教程 / 截图来源、用途与复用注意事项。
- [静态原型](prototype/index.html)：之前制作的浏览器原型，仅用于交互参考。
- `references/user-screenshots/`：用户提供的三个参考截图。

## 本地运行

```powershell
npm run check
npm start
```

打开 `http://127.0.0.1:4173`。如需连接模型，复制 `.env.example` 的变量到当前终端环境后再运行；真实密钥只放环境变量，不要写入 HTML、`localStorage` 或提交到仓库。当前适配的是 OpenAI 兼容的 `/chat/completions` 接口，搜索服务通过通用 JSON 适配器接入。

## Windows 桌面版

开发模式需要先启动本地服务，再启动 Electron 窗口：

```powershell
npm start
# 另开一个终端
npm run desktop
```

生产构建使用 electron-builder，同时生成 NSIS 安装包和 portable 便携版：

```powershell
npm run check
npm test
npm run dist:win
```

构建产物位于 `release/`：

- `ForwardStep-<version>-setup.exe`：可选安装目录的 NSIS 安装包，包含开始菜单快捷方式、桌面快捷方式和卸载入口。
- `ForwardStep-<version>-portable.exe`：无需安装的便携版，运行时使用自己的用户数据目录。

生产包会把 Electron 主进程、静态页面和本地 Node 服务一起打进应用，不依赖项目目录、PowerShell、npm 或外部 Node 服务。开发模式仍加载 `http://127.0.0.1:4173`；生产模式由应用自行启动随机端口的内置本地服务。

当前打包限制：`npm run dist:win` 依赖已安装的 npm 依赖和 electron-builder；首次构建可能需要下载 Electron/electron-builder 缓存，网络或下载超时会导致本次没有完整产物，不能据此宣称安装包已验收。打包清单只包含运行应用所需的 `electron/`、`prototype/`、`server/`、`server.js` 和 `package.json`，不会把 `docs/`、`tests/`、`.env` 或用户数据打进安装包；用户数据由应用运行时保存到用户数据目录。

首版构建未配置代码签名。Windows SmartScreen 可能对安装包或 portable exe 显示“未知发布者”提示，需要用户选择“仍要运行”；正式分发前应使用组织或发行方证书签名。

模型和搜索都是可选能力。未配置服务、网络不可用、请求失败或模型返回错误时，应用仍保留本地编辑、复制指令和手动搜索流程，不会伪称已经完成联网调用。桌面版设置中的模型密钥和搜索密钥使用 Windows `safeStorage` 加密后保存到 Electron 用户数据目录；安全存储不可用时不会保存密钥。

本地保存不等于“永不外发”：只有用户主动发起模型请求时，发送面板中选定的目标摘要、资料摘要或外部结果才可能发送到配置的第三方服务；发送前应检查并删减实际内容。没有模型或搜索服务时，草稿和本地案例仍可继续使用。

## 当前验收边界

`npm test`、`npm run check` 和 `tests/e2e-smoke.test.js` 只证明代码、静态入口、本地服务和主流程边界；不等同于真实 Electron UI 验收。仍需在全新 Windows 用户目录手动验收安装、卸载、重启、数据保留、无网络降级以及模型和搜索失败降级。每次 `npm run dist:win` 后，应确认 `release/` 同时存在 NSIS 安装包和 portable `.exe`；若依赖未安装或下载超时，应记录失败原因，不把缺少产物写成成功。
