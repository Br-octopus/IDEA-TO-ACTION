# 向前一步 Windows MVP 优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前原型优化成可安装的 Windows `.exe` 个人应用，完成“模糊想法 → 目标补漏 → 任务路线 → 当前步骤提示词 → 外部结果复盘 → 用户确认经验”的闭环，并保留离线复制模式。

**Architecture:** 使用 Electron 桌面壳复用现有原生 HTML/CSS/JavaScript；主进程管理本地服务和安全设置，渲染进程不接触模型密钥。目标、资料索引、提示词版本和案例保存在本机；模型和搜索是可选云服务，发送前显示可编辑内容。使用 electron-builder 生成 Windows NSIS 安装包和 portable `.exe`。

**Tech Stack:** Electron、electron-builder、原生 HTML/CSS/ES Modules、Node.js 18+、`node:test`、Windows `safeStorage`；模型使用 OpenAI 兼容接口，搜索使用可替换 HTTP 适配器。

---

## 产品优化判断

当前设计包含四个独立子系统，必须分阶段实现：

1. 核心目标推进：目标摘要、遗漏/矛盾/错误/不必要项、假设、保留项、成功标准、可编辑路线。
2. 参考资料与研究：公开资料和用户确认经验分层，按任务/阶段只选少量摘要。
3. 提示词与案例复盘：当前步骤指令、外部结果对照、成功/失败/待验证、下一条修正指令。
4. Windows 桌面和模型隐私：安装、设置、密钥安全存储、发送预览、失败降级。

不做：多 Agent、自动改文章/PPT/代码、自动执行现实任务、整库抓取、复杂向量数据库、AI 身份检测分数、账号/云同步和自动提示词进化。

GitHub/社媒参考只转化为方法：`goal-prompt` 的目标确认与交接指令；PromptWizard 的反馈迭代；promptfoo/ChainForge 的案例对照；Dify 的资料分层；Humanizer-zh 的可观察文本诊断。公开提示词库和 Agent 工作流库只保存链接、摘要、许可和适用范围，不把原文当运行指令。

---

## 文件职责

**新增：**

- `electron/main.js`：窗口、应用生命周期、本地 API 和 IPC。
- `electron/preload.js`：白名单 IPC，不暴露 Node 能力。
- `electron/settings-store.js`：使用 `safeStorage` 保存模型/搜索配置。
- `prototype/app.js`：页面事件、视图和渲染。
- `prototype/prompt-engine.js`：纯提示词生成函数。
- `prototype/storage.js`：本地数据结构、迁移和案例确认。
- `prototype/method-cards.js`：写作、PPT、软件、产品/工作、学习和其他方法卡。
- `prototype/research-catalog.js`：参考资料和少量上下文筛选。
- `server/model-client.js`：模型请求、超时和错误归一化。
- `server/search-client.js`：搜索请求和来源归一化。
- `tests/*.test.js`：纯函数、API、打包和冒烟测试。

**修改：**

- `prototype/index.html`：保留视觉结构，加载模块，增加摘要编辑、资料选择、发送预览、复盘确认、设置入口。
- `server.js`：只保留路由和静态服务，不保存密钥、不拼接业务提示词。
- `package.json`：增加 Electron、测试和 Windows 打包脚本。
- `README.md`、`docs/PRODUCT_DESIGN.md`、`docs/MVP_SCOPE.md`：同步 exe、隐私和验收边界。

---

## Task 1：建立 Windows 桌面骨架

**Files:** `electron/main.js`、`electron/preload.js`、`package.json`、`tests/electron-smoke.test.js`

- [ ] **Step 1：写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('桌面入口存在', () => {
  assert.equal(fs.existsSync('electron/main.js'), true);
  assert.equal(fs.existsSync('electron/preload.js'), true);
});
```

- [ ] **Step 2：运行 `node --test tests/electron-smoke.test.js`，确认入口不存在导致失败。**

- [ ] **Step 3：实现 Electron 入口。** 设置 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；开发模式加载本地服务，生产模式加载打包资源；不把密钥放入 URL、DOM 或 `webPreferences`。

- [ ] **Step 4：实现白名单 IPC。**

```js
contextBridge.exposeInMainWorld('forwardStep', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  requestModel: payload => ipcRenderer.invoke('model:request', payload),
  requestSearch: payload => ipcRenderer.invoke('search:request', payload)
});
```

- [ ] **Step 5：在 `package.json` 添加 `main`、`desktop`、`test`、`check`、`dist:win` 脚本，运行 `npm test` 和 `npm run check`，预期 PASS。**

- [ ] **Step 6：提交：`git commit -m "feat: 增加 Windows 桌面应用骨架"`。**

---

## Task 2：拆分单文件并建立本地状态模型

**Files:** `prototype/app.js`、`prototype/storage.js`、`prototype/method-cards.js`、`prototype/index.html`、`tests/storage.test.js`

- [ ] **Step 1：固定 v2 状态。**

```js
{
  schemaVersion: 2,
  projects: [{
    id, idea, domain, methodId, methodTemporary,
    goalSummary, audience, currentState, constraints,
    successCriteria, assumptions, missingInfo, preserveItems,
    steps, currentStepId, nextAction, reply, createdAt
  }],
  prompts: [], references: [], cases: []
}
```

- [ ] **Step 2：测试旧版状态迁移、未经确认案例不得进入 `cases`、同组提示词版本递增。**

- [ ] **Step 3：实现 `createEmptyState`、`migrateState`、`saveState`、`addPromptVersion`、`confirmCase`。模型密钥不得进入状态对象。**

- [ ] **Step 4：把 `index.html` 的内联事件、视图切换、渲染和复制逻辑移到 `app.js`；保留当前视觉 class 和文案，不在此任务重做视觉。**

- [ ] **Step 5：运行 `npm test`、`npm run check`、`npm run desktop`，确认浏览器和桌面窗口都能打开首页。**

- [ ] **Step 6：提交：`git commit -m "refactor: 拆分前端状态与页面逻辑"`。**

---

## Task 3：实现通用目标推进和领域适配

**Files:** `prototype/prompt-engine.js`、`prototype/method-cards.js`、`prototype/app.js`、`prototype/index.html`、`tests/prompt-engine.test.js`

- [ ] **Step 1：写失败测试。**

```js
test('目标检查包含遗漏、矛盾、错误、不必要和成功标准', () => {
  const text = buildGoalPrompt({ idea: '做学习工具', domain: '软件开发' });
  for (const word of ['遗漏', '矛盾', '错误', '不必要', '成功标准']) {
    assert.match(text, new RegExp(word));
  }
});

test('未知任务使用可调整的临时方法', () => {
  const card = getMethodCard('其他');
  assert.equal(card.temporary, true);
});
```

- [ ] **Step 2：实现方法卡。** 写作检查用词、逻辑、上下文、修辞、句式、格式、观点和事实；PPT 检查受众、主线、页面职责和证据；软件检查用户、范围、技术、测试和发布；产品/工作检查对象、资源、风险和里程碑；学习检查基础、练习、反馈和掌握；其他方法必须标记为临时且可调整。

- [ ] **Step 3：实现并测试 `buildGoalPrompt`、`buildStagePrompt`、`buildFollowupPrompt`、`buildArticleDiagnosticPrompt`、`buildPromptOptimizationPrompt`、`buildCaseReviewPrompt`。每个函数都区分事实/假设/待确认，最多问三个改变方案的问题，并声明不执行最终任务。**

- [ ] **Step 4：页面增加可编辑的目标、成功标准、假设、待确认项、保留项、当前步骤和下一步；AI 结果先作为草稿，用户保存后才写入本地。**

- [ ] **Step 5：运行 `node --test tests/prompt-engine.test.js`，并验收“模糊想法 → 补漏 → 路线 → 当前一步指令”。**

- [ ] **Step 6：提交：`git commit -m "feat: 完成通用目标推进闭环"`。**

---

## Task 4：建立参考资料和 token 最小化流程

**Files:** `prototype/research-catalog.js`、`prototype/app.js`、`prototype/index.html`、`prototype/storage.js`、`tests/research-catalog.test.js`

- [ ] **Step 1：测试资料最多选三条，且上下文只包含摘要。**

```js
test('资料按领域和阶段筛选且最多三条', () => {
  const refs = selectReferences({ domain: '软件开发', stage: 'research' }, { limit: 3 });
  assert.ok(refs.length <= 3);
  assert.ok(refs.every(ref => ref.kind === 'public-reference'));
});

test('上下文包不包含整篇原文', () => {
  const context = buildContextPack([{ summary: '短摘要', content: '长原文' }]);
  assert.match(context, /短摘要/);
  assert.equal(context.includes('长原文'), false);
});
```

- [ ] **Step 2：资料字段固定为 `id/title/url/sourceType/licenseNote/domains/stages/summary/borrowablePatterns/limitations/updatedAt/verification/kind`。热门或被收录不等于验证。**

- [ ] **Step 3：资料页支持领域/阶段筛选，展示链接、许可、适用范围和局限；默认只把摘要、可借鉴方法和来源加入发送预览。**

- [ ] **Step 4：搜索结果显示标题、链接、摘要、日期和局限；用户选择后才进入模型请求。搜索不可用时仍生成可复制搜索指令并显示“未完成研究”。**

- [ ] **Step 5：运行 `node --test tests/research-catalog.test.js`，提交：`git commit -m "feat: 增加分层资料与按需研究"`。**

---

## Task 5：实现写作和跨领域结果复盘

**Files:** `prototype/prompt-engine.js`、`prototype/app.js`、`prototype/index.html`、`prototype/storage.js`、`tests/case-review.test.js`

- [ ] **Step 1：测试复盘必须包含前后对照、证据和下一条指令。**

```js
test('复盘包含前后对照、证据和下一条提示词', () => {
  const text = buildCaseReviewPrompt({
    goal: '保留观点和事实，减少模板化句式',
    preserveItems: ['观点', '事实', '句式'],
    before: '原文', after: '改写后',
    userFeedback: '观点被改掉了'
  });
  assert.match(text, /前后对照/);
  assert.match(text, /证据/);
  assert.match(text, /下一条/);
});
```

- [ ] **Step 2：统一案例字段：`id/projectId/domain/taskType/goal/preserveItems/before/after/externalResult/userFeedback/dimensions/evidence/suggestedLabel/status/lessons/nextPrompt/createdAt`。**

- [ ] **Step 3：页面展示目标、保留项、外部结果、用户意见、逐项证据、成功/失败/待验证建议和下一条修正指令；提供“确认记录/修改判断/暂不记录”。不显示 AI 概率，不直接产出替代成果。**

- [ ] **Step 4：验收写作观点被改掉、软件方案过度复杂两个案例；运行 `node --test tests/case-review.test.js`。**

- [ ] **Step 5：提交：`git commit -m "feat: 增加证据化结果复盘"`。**

---

## Task 6：安全接入模型、搜索和 Windows 设置

**Files:** `electron/settings-store.js`、`server/model-client.js`、`server/search-client.js`、`electron/main.js`、`electron/preload.js`、`prototype/app.js`、`prototype/index.html`、`tests/settings-store.test.js`、`tests/server.test.js`

- [ ] **Step 1：测试未配置模型的降级和密钥不进入前端状态。**

```js
test('未配置模型返回稳定错误码', () => {
  assert.deepEqual(normalizeModelError(new Error('MODEL_NOT_CONFIGURED')), {
    code: 'MODEL_NOT_CONFIGURED', retryable: false
  });
});
```

- [ ] **Step 2：使用 Electron `safeStorage` 将模型地址、模型名和 API key 存入 `app.getPath('userData')`；读取失败返回未配置，不把密钥写入 DOM、localStorage、URL、日志或错误消息。**

- [ ] **Step 3：模型请求超时 30 秒并归一化 401、429、5xx、超时、无内容；搜索最多返回 5 条，统一标题/链接/摘要/日期。**

- [ ] **Step 4：把确认框升级为可编辑发送面板：显示实际发送文本、已选资料摘要、目标模型、删除片段、取消和确认发送。未配置时只显示复制按钮。**

- [ ] **Step 5：运行 `npm test`，并用 `rg -n "MODEL_API_KEY|SEARCH_API_KEY|apiKey" prototype` 检查前端无真实凭证。**

- [ ] **Step 6：提交：`git commit -m "feat: 增加安全模型接入与发送预览"`。**

---

## Task 7：生成 Windows 安装包和 portable exe

**Files:** `package.json`、`build/icon.ico`、`build/installer.nsh`、`README.md`、`tests/package-config.test.js`

- [ ] **Step 1：测试 Windows 构建配置。**

```js
test('Windows 构建包含 NSIS 和 portable', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.deepEqual(pkg.build.win.target, ['nsis', 'portable']);
  assert.equal(pkg.build.appId, 'com.forwardstep.app');
});
```

- [ ] **Step 2：配置真实 `.ico`、安装包名称、开始菜单快捷方式、卸载入口和便携版；不使用空图标占位。**

- [ ] **Step 3：确认生产包不依赖项目目录、PowerShell、npm 或外部 Node 服务；开发模式和生产模式使用不同加载路径。**

- [ ] **Step 4：运行 `npm run check`、`npm test`、`npm run dist:win`。预期同时生成 NSIS 安装包和 portable `.exe`。**

- [ ] **Step 5：在全新 Windows 用户目录验收安装、卸载、重启、数据保留、无网络降级、模型失败降级和设置安全。未签名 exe 可能触发 SmartScreen，README 必须说明。**

- [ ] **Step 6：提交：`git commit -m "build: 生成 Windows 安装包和便携版"`。**

---

## Task 8：最终验收和文档收口

**Files:** `README.md`、`docs/PRODUCT_DESIGN.md`、`docs/MVP_SCOPE.md`、`tests/e2e-smoke.test.js`

- [ ] **Step 1：执行 `npm run check`、`npm test`、`npm run dist:win`，确认测试通过且 `dist` 同时有安装包和 portable exe。**

- [ ] **Step 2：执行主流程：**

```text
输入想法
→ 目标摘要、假设、遗漏、矛盾、错误风险、不必要项
→ 编辑成功标准和保留项
→ 选择领域方法
→ 选择当前步骤
→ 选择少量资料
→ 编辑发送内容
→ 复制或调用模型
→ 粘贴外部结果
→ 证据化复盘
→ 用户确认经验
→ 重启后本地数据仍在
```

- [ ] **Step 3：验收无模型、无搜索、断网、401/429/超时、删除发送片段、未确认案例和重启应用场景。**

- [ ] **Step 4：文档明确 Windows exe 是首版交付目标；模型/搜索可选；本地保存不代表永不外发；密钥使用 Windows 安全存储；公开参考和验证经验分层；工具不代做成果。**

- [ ] **Step 5：提交：`git commit -m "docs: 收口 Windows 首版验收标准"`。**

---

## 首版完成标准

```text
Windows 安装包
→ 打开本地应用
→ 输入模糊想法
→ 目标摘要和可编辑保留项
→ 领域适配路线
→ 当前步骤提示词
→ 少量资料和发送预览
→ 外部结果复盘
→ 用户确认经验
→ 重启后本地数据仍在
```

如果时间有限，优先完成 Task 1、Task 2、Task 3、Task 5、Task 7；这组任务先确保 exe 能启动、核心逻辑成立、复盘闭环存在，再接入真实模型和搜索。

---

## 自审结果

- 需求覆盖：跨领域任务、目标优化、遗漏/错误/不必要内容、写作参考特征、保留项、研究、token 控制、复盘、经验确认、模型隐私和 Windows exe 均有任务。
- 技术判断：Electron 是当前最务实选择，能复用 Node 和原生页面；Tauri 体积更小，但引入 Rust 工具链，当前不推荐。
- 安全判断：密钥不进前端状态、DOM、localStorage、URL 或日志；服务缺失时保持复制模式。
- 过度设计控制：不加入多 Agent、向量数据库、云同步、完整项目管理或自动执行器。
- 已知限制：未签名安装包可能触发 SmartScreen；个人本地使用不阻塞，正式分发再做代码签名。

