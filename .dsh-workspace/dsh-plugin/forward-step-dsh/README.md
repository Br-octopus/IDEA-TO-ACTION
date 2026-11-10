# 向前一步 DSH 插件

`@local/forward-step-dsh` 是 DeepSeek Harness 原生插件，提供任务隔离的下一步规划、文章/PPT 规划、外部结果回填、复盘与可追溯记忆。

## 运行边界

- 当前验证的 DSH 宿主为 `0.2.0-rc.2`；插件 peer 依赖按该版本声明，不承诺适配未经验证的未来版本。
- 首版生成规划和外部执行提示词；用户在外部工具执行后再粘贴结果，不自动声称已制作文章或 PPT 成品。
- 任务和记忆写入 DSH Storage Domain；卸载插件不等于删除数据。删除任务或记忆由侧栏显式确认并说明影响。
- 本地自动化测试不代表真实 GUI、模型效果或用户反馈已经通过。请依照工作空间中的验收手册分别记录这些结果。
- 社媒采集可使用 DSH Browser 提供的 `policyReport()` / `searchResults()` 服务；插件只检查 profile 的域名覆盖并在运行时尝试采集，不读取或保存 profile 凭据，也不将 profile 配置标记为已登录或已授权。真实平台登录、验证码和页面结构仍需在隔离 DSH GUI 中验收。

## 本地构建

在插件目录运行：

```powershell
pnpm run build:host
node scripts/generate-typert.mjs
pnpm run build:client
pnpm pack --pack-destination ../../build/forward-step-dsh
```

包由 DSH 宿主注入可选 peer 依赖；不要把宿主凭证、profile 数据库或原始对话打进安装包。
