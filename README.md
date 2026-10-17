# 向前一步

一个帮助用户把模糊想法推进成可执行路线和可复制 AI 指令的个人工具。它负责澄清目标、发现遗漏、按需研究、拆解步骤、生成提示词并复盘外部 AI 的结果；不直接代做文章、PPT、代码或现实任务。

## 当前状态

- 已确认产品方向，首版本地服务骨架已完成。
- 已完成 Electron 桌面拆分：`electron/` 管理窗口、内置本地服务和安全设置，`prototype/` 提供静态前端，`server.js` 提供服务入口、模型调用入口和可选搜索适配入口。
- 可编辑发送面板已完成，支持在复制或调用模型前查看和调整实际发送内容。
- 未配置密钥时保持“复制指令给其他 AI”的离线降级，不会伪称已经调用模型或完成联网研究。
- 参考仓库用于学习设计和方法，不会自动整库复制或塞进模型上下文。

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

首版构建未配置代码签名。Windows SmartScreen 可能对安装包或 portable exe 显示“未知发布者”提示，需要用户选择“仍要运行”；正式分发前应使用组织或发行方证书签名。

模型和搜索都是可选能力。未配置服务、网络不可用、请求失败或模型返回错误时，应用仍保留本地编辑、复制指令和手动搜索流程，不会伪称已经完成联网调用。桌面版设置中的模型密钥和搜索密钥使用 Windows `safeStorage` 加密后保存到 Electron 用户数据目录；安全存储不可用时不会保存密钥。

## 下一步

实际 Windows 安装包和 portable exe 仍待依赖可用时验证；之后需要在全新 Windows 用户目录验收安装、卸载、重启、数据保留、无网络降级以及模型和搜索失败降级。
