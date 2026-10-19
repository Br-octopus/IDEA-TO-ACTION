# 工作区备份与资料库增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在现有 localStorage 和统一资料索引基础上，增加可恢复的工作区备份、来源感知的资料管理、轻量中文搜索增强、安全发送预览和案例版本历史。

**Architecture:** 保留 prototype/storage.js 的状态迁移入口，新增纯函数模块处理备份、搜索词扩展、发送安全检测和案例版本。Electron 通过 preload 暴露用户数据目录中的备份读写能力，浏览器开发模式使用文件下载/选择。UI 继续由 prototype/index.html 和 prototype/app.js 驱动，所有高风险操作先经过纯函数验证和自动备份。

**Tech Stack:** Electron 38、原生 HTML/CSS/JavaScript、浏览器 localStorage、Node.js node:test、Node 标准库 fs/path；不引入 SQLite、向量数据库、embedding、拼音库或其他运行时依赖。

---

## 0. 范围与交付顺序

1. 数据契约和案例版本。
2. 备份格式、校验、替换、合并和自动备份。
3. Electron/浏览器文件操作边界。
4. 资料库管理界面和导入导出。
5. 中文搜索增强。
6. 发送预览统计和敏感信息检测。
7. 案例版本管理界面。
8. 集成验收、文档和 Windows 回归。

本计划不包含 SQLite 迁移、云同步、账号系统、自动抓取全网、embedding/RAG、自动修改最终成果或多用户协作。

## 1. 文件职责和任务依赖

| 文件 | 职责 | 任务 |
|---|---|---|
| prototype/storage.js | 状态、迁移、保存、案例当前版本 | T1、T7 |
| prototype/knowledge-schema.js | 资料字段和默认值 | T1、T4 |
| prototype/workspace-backup.js | JSON 备份、校验、替换、合并 | T2 |
| prototype/backup-manager.js | 自动备份触发和保留规则 | T2 |
| electron/backup-store.js | 用户数据目录备份读写 | T3 |
| electron/main.js、electron/preload.js | 备份 IPC 和文件对话框 | T3 |
| prototype/search-dictionary.js | 别名、同义词、中文拆分、建议 | T5 |
| prototype/knowledge-search.js | 搜索评分和命中解释 | T5 |
| prototype/send-safety.js | 字符/token 估算和敏感信息检测 | T6 |
| prototype/index.html、prototype/app.js | 资料库、发送预览、案例版本 UI | T4-T7 |
| tests/*.test.js | 纯函数、IPC、静态入口和回归测试 | T1-T8 |

依赖图：

| Task | 名称 | depends_on | 主要写入范围 |
|---|---|---|---|
| T1 | 状态契约和案例版本数据层 | [] | schema、storage、数据层测试 |
| T2 | 备份格式和纯函数合并层 | [T1] | backup 模块、备份测试 |
| T3 | Electron/浏览器备份通道 | [T2] | backup-store、main、preload |
| T4 | 资料库管理和导入导出界面 | [T1,T2,T3] | index、app、管理测试 |
| T5 | 中文搜索增强 | [T1,T4] | search-dictionary、knowledge-search |
| T6 | 发送安全预览 | [T1,T4] | send-safety、index、app |
| T7 | 案例版本界面和资料卡同步 | [T1,T4] | storage、index、app |
| T8 | 集成验收和文档 | [T2,T3,T4,T5,T6,T7] | README、设计文档、smoke |

T4-T7 必须串行执行，因为都会修改 prototype/app.js 和 prototype/index.html。

---

## Task 1: 状态契约和案例版本数据层

**Files:**
- Modify: prototype/knowledge-schema.js
- Modify: prototype/storage.js
- Test: tests/knowledge-schema.test.js
- Test: tests/storage.test.js
- Test: tests/case-review.test.js

- [ ] Step 1: 写资料元数据失败测试

在 knowledge-schema.test.js 增加：

~~~js
test('资料索引元数据有稳定默认值', () => {
  const entry = normalizeKnowledgeEntry({ id: 'manual-1', title: '资料' });
  assert.equal(entry.sourceKind, 'manual');
  assert.equal(entry.sourceId, '');
  assert.equal(entry.hiddenAt, '');
  assert.equal(entry.favorite, false);
  assert.equal(entry.pinned, false);
  assert.equal(entry.lastUsedAt, '');
  assert.deepEqual(entry.customAliases, []);
});
~~~

运行 node --test tests/knowledge-schema.test.js，预期新增测试失败。

- [ ] Step 2: 写案例版本失败测试

在 case-review.test.js 覆盖首次确认生成 v1、修改生成 v2、旧版本仍保留：

~~~js
test('修改案例生成新版本并保留旧版本', () => {
  const first = confirmCase(createEmptyState(), {
    id: 'case-1', status: '失败', goal: '目标',
    evidence: ['旧证据'], lessons: '旧经验'
  }, true);
  const second = updateCase(first, {
    id: 'case-1', status: '成功',
    evidence: ['新证据'], lessons: '新经验',
    changeNote: '补充第二次测试'
  });
  assert.equal(second.cases[0].currentVersion, 2);
  assert.equal(second.cases[0].versionHistory.length, 2);
  assert.equal(second.cases[0].versionHistory[0].status, '失败');
  assert.equal(second.cases[0].versionHistory[1].status, '成功');
});
~~~

运行 node --test tests/case-review.test.js，预期新增测试失败。

- [ ] Step 3: 实现资料元数据规范化

在 normalizeKnowledgeEntry 中增加 sourceKind、sourceId、hiddenAt、favorite、pinned、lastUsedAt、customAliases。sourceKind 只允许 manual、prompt、case、method-card、reference，未知类型回退 manual。旧数据必须保持现有验证状态和评分默认值。

- [ ] Step 4: 实现案例版本迁移和更新

在 normalizeCase 中增加 currentVersion、versionHistory、applicableWhen、notApplicableWhen、reviewCount、lastReviewedAt。confirmCase 首次确认创建 v1；updateCase 将当前字段保存为历史版本后递增版本号和复盘次数，保留 changeNote，不直接覆盖历史。

- [ ] Step 5: 回归并提交

~~~powershell
node --test tests/knowledge-schema.test.js tests/storage.test.js tests/case-review.test.js
npm run check
~~~

预期：新增测试和已有迁移、凭证清洗、案例确认测试全部通过。

~~~powershell
git add prototype/knowledge-schema.js prototype/storage.js tests/knowledge-schema.test.js tests/storage.test.js tests/case-review.test.js
git commit -m "feat: 完善资料元数据和案例版本"
~~~

---

## Task 2: 备份格式和纯函数合并层

**Files:**
- Create: prototype/workspace-backup.js
- Create: prototype/backup-manager.js
- Test: tests/workspace-backup.test.js
- Test: tests/backup-manager.test.js

- [ ] Step 1: 写导出、校验和凭证剔除测试

~~~js
test('完整工作区备份包含业务数据但不包含凭证', () => {
  const backup = createBackup({
    projects: [{ id: 'p1' }], prompts: [{ id: 't1' }],
    cases: [], knowledgeEntries: [], apiKey: 'must-not-export'
  }, { scope: 'workspace', appVersion: '0.1.0' });
  assert.equal(backup.scope, 'workspace');
  assert.equal(backup.data.projects.length, 1);
  assert.equal(JSON.stringify(backup).includes('must-not-export'), false);
});

test('非法备份会被拒绝', () => {
  assert.throws(() => validateBackup({ format: 'unknown' }), /备份格式/);
});
~~~

运行 node --test tests/workspace-backup.test.js，预期失败。

- [ ] Step 2: 实现 workspace-backup.js 接口

导出：

~~~js
createBackup(state, { scope = 'workspace', appVersion = '', now } = {})
validateBackup(value)
getBackupSummary(backup)
replaceState(currentState, backup)
mergeState(currentState, backup)
~~~

备份包含 format、schemaVersion、appVersion、exportedAt、scope、counts、data。workspace 包含项目、提示词、案例、资料、选择和筛选状态；knowledge-base 只包含资料条目、案例和资料相关元数据。复用现有凭证过滤规则，不复制第二套实现。替换和合并不修改入参；合并按稳定 id 去重，当前数据优先，并返回 state、added、skipped、conflicts。

- [ ] Step 3: 写替换和合并测试

测试替换后只保留备份状态；测试合并时冲突保留当前数据、新 id 追加，并返回冲突 id 列表。

- [ ] Step 4: 实现 backup-manager.js

导出：

~~~js
shouldBackupBefore(reason)
shouldBackupOnStartup(lastBackupAt, now)
keepRecentBackups(files, limit = 5)
~~~

只接受 import、replace、merge、clear、bulk-delete。每天首次启动按本地日期判断；保留最近 5 个备份。

- [ ] Step 5: 运行并提交

~~~powershell
node --test tests/workspace-backup.test.js tests/backup-manager.test.js
npm run check
git diff --check
git add prototype/workspace-backup.js prototype/backup-manager.js tests/workspace-backup.test.js tests/backup-manager.test.js
git commit -m "feat: 增加工作区备份和合并导入"
~~~

---

## Task 3: Electron/浏览器备份文件通道

**Files:**
- Create: electron/backup-store.js
- Modify: electron/main.js
- Modify: electron/preload.js
- Test: tests/backup-store.test.js
- Modify: tests/electron-smoke.test.js

- [ ] Step 1: 写文件存储失败测试

覆盖写入用户数据目录、最多保留 5 份、拒绝 ../secret.json 路径穿越。

- [ ] Step 2: 实现 electron/backup-store.js

提供 createBackupStore({ userDataPath, fsModule = fs, pathModule = path })，实例方法 writeAutoBackup(content, reason)、listBackups()、readBackup(filename)、deleteOldBackups(limit = 5)。固定写入用户数据目录的 backups 子目录，只接受 json basename 和原因白名单。

- [ ] Step 3: 增加受限 IPC

preload 暴露 exportBackup、importBackup、listBackups、readBackup。main 注册 backup:export、backup:import、backup:list、backup:read，使用 Electron 文件对话框。渲染器不能获得任意路径读写 API。

- [ ] Step 4: 扩展 Electron smoke 测试

检查 preload API、四个 handler、打包文件清单和路径限制。

- [ ] Step 5: 运行并提交

~~~powershell
node --test tests/backup-store.test.js tests/electron-smoke.test.js
npm run check
git add electron/backup-store.js electron/main.js electron/preload.js tests/backup-store.test.js tests/electron-smoke.test.js
git commit -m "feat: 增加桌面备份文件通道"
~~~

---

## Task 4: 资料库管理和导入导出界面

**Files:**
- Modify: prototype/index.html
- Modify: prototype/app.js
- Test: tests/knowledge-management.test.js
- Modify: tests/e2e-smoke.test.js

- [ ] Step 1: 写资料操作失败测试

提取并测试 hideKnowledgeEntry、restoreKnowledgeEntry、deleteKnowledgeEntries、markKnowledgeUsed、selectKnowledgeEntries。验证隐藏派生资料不删除原始案例，批量删除只允许手动资料，选择/查看会更新最近使用时间。

- [ ] Step 2: 增加资料库控件

增加收藏、最近使用、公开资料、用户案例、未验证筛选；每条资料的收藏/置顶、来源操作和选择框；手动资料编辑入口；派生资料的编辑原始来源和从资料库移除；批量操作栏；备份、导入、导出入口；数据统计和最近备份提示。文案必须区分从资料库移除和删除原始数据。

- [ ] Step 3: 实现资料索引操作

提取以下纯业务函数，返回新状态或 state/changed 结果，不直接修改入参：

~~~js
toggleKnowledgeFavorite(state, id)
toggleKnowledgePinned(state, id)
markKnowledgeUsed(state, id, now)
hideKnowledgeEntry(state, id, now)
restoreKnowledgeEntry(state, id)
deleteKnowledgeEntries(state, ids)
selectKnowledgeEntries(state, ids, limit = 5)
~~~

派生资料只能跳转来源或隐藏索引，不能通过资料库批量操作删除案例或提示词。

- [ ] Step 4: 实现导入导出流程

导出选择完整工作区或仅资料库，调用纯函数生成 JSON；桌面模式使用 desktopApi，浏览器模式使用 Blob 下载。导入先校验并显示统计，选择替换或合并，先自动备份再写入，成功后刷新资料库、项目和发送选择。失败不得清空当前状态。

- [ ] Step 5: 运行并提交

~~~powershell
node --test tests/knowledge-management.test.js tests/e2e-smoke.test.js
npm run check
git add prototype/index.html prototype/app.js tests/knowledge-management.test.js tests/e2e-smoke.test.js
git commit -m "feat: 完善资料库管理和工作区备份界面"
~~~

---

## Task 5: 中文搜索增强

**Files:**
- Create: prototype/search-dictionary.js
- Modify: prototype/knowledge-search.js
- Test: tests/search-dictionary.test.js
- Modify: tests/knowledge-search.test.js

- [ ] Step 1: 写词典和建议测试

~~~js
test('同义词扩展可以命中提示词复核资料', () => {
  const terms = expandSearchTerms('提示词 review');
  assert.ok(terms.includes('提示词'));
  assert.ok(terms.includes('复核'));
  assert.ok(terms.includes('review'));
});
~~~

- [ ] Step 2: 实现 search-dictionary.js

导出 expandSearchTerms、splitChineseTerms、suggestSearchTerms。内置提示词/prompt、复核/review、验收/测试/完成标准、计划/方案、案例/示例、失败/问题别名。中文拆分复用现有 Intl.Segmenter 和正则回退，不引入拼音库。

- [ ] Step 3: 接入 searchKnowledge

保持 searchKnowledge(entries, query, options) 签名不变，返回 matchedTerms、matchedFields 和用于 UI 高亮的字段信息。无结果建议不改变结果数组，只由 UI 调用。

- [ ] Step 4: 增加边界测试

覆盖精确搜索不回归、英文别名命中、重复别名不重复计分、自定义别名不污染全局、空查询/停用词保持现状、建议最多 3 条且稳定排序。

- [ ] Step 5: 运行并提交

~~~powershell
node --test tests/search-dictionary.test.js tests/knowledge-search.test.js
npm test
git add prototype/search-dictionary.js prototype/knowledge-search.js tests/search-dictionary.test.js tests/knowledge-search.test.js
git commit -m "feat: 增强中文资料搜索"
~~~

---

## Task 6: 发送安全预览

**Files:**
- Create: prototype/send-safety.js
- Modify: prototype/index.html
- Modify: prototype/app.js
- Test: tests/send-safety.test.js
- Modify: tests/e2e-smoke.test.js

- [ ] Step 1: 写安全检测测试

~~~js
test('检测 API Key 和邮箱但不修改原文', () => {
  const text = 'key=sk-test-abcdefghijklmnopqrstuvwxyz user@example.com';
  const report = buildSendReport([{ source: '用户原文', text }]);
  assert.equal(report.text, text);
  assert.ok(report.findings.some(item => item.kind === 'api-key'));
  assert.ok(report.findings.some(item => item.kind === 'email'));
});
~~~

- [ ] Step 2: 实现 send-safety.js

导出 estimateTokenCount、detectSensitiveContent、buildSendReport。报告包含原文、分段、字符数、近似 token 数、风险列表、高风险数量和是否需要确认。检测只在本地完成。

- [ ] Step 3: 接入发送面板

显示每段来源、字符数、近似 token 数和风险数量。高风险未确认时禁用发送；用户编辑文本后重新检测；删除资料后同步统计。请求失败保留面板、草稿和资料选择，不自动重试。

- [ ] Step 4: 增加 UI smoke 测试

检查发送统计、来源标签、风险高亮和高风险确认控件存在，并验证用户编辑文本不会被 basePrompt 覆盖。

- [ ] Step 5: 运行并提交

~~~powershell
node --test tests/send-safety.test.js tests/e2e-smoke.test.js
npm test
git add prototype/send-safety.js prototype/index.html prototype/app.js tests/send-safety.test.js tests/e2e-smoke.test.js
git commit -m "feat: 增加发送安全预览"
~~~

---

## Task 7: 案例版本界面和资料卡同步

**Files:**
- Modify: prototype/index.html
- Modify: prototype/app.js
- Modify: prototype/storage.js
- Test: tests/case-review.test.js
- Modify: tests/e2e-smoke.test.js

- [ ] Step 1: 增加版本操作测试

覆盖当前版本、历史版本、适用/不适用场景、版本差异和删除同步。案例资料卡只读取当前版本字段。

- [ ] Step 2: 增加案例详情控件

显示当前版本号、最近复盘时间、复盘次数、证据、适用场景和不适用场景；提供创建新版本、查看历史、对比版本、暂不复用和删除案例。历史版本默认折叠，不进入统一搜索结果。

- [ ] Step 3: 接入版本操作

提取并测试：

~~~js
getCurrentCaseVersion(caseItem)
listCaseVersions(caseItem)
createCaseVersion(state, caseId, patch, changeNote)
compareCaseVersions(caseItem, leftVersion, rightVersion)
deleteCase(state, caseId)
~~~

创建版本只追加历史，不覆盖旧版本。删除案例前自动备份并确认，删除后移除当前资料卡索引。

- [ ] Step 4: 运行并提交

~~~powershell
node --test tests/case-review.test.js tests/e2e-smoke.test.js
npm run check
git add prototype/storage.js prototype/index.html prototype/app.js tests/case-review.test.js tests/e2e-smoke.test.js
git commit -m "feat: 增加案例版本和适用边界"
~~~

---

## Task 8: 集成验收、文档和 Windows 回归

**Files:**
- Modify: README.md
- Modify: docs/MVP_SCOPE.md
- Modify: docs/PRODUCT_DESIGN.md
- Modify: tests/e2e-smoke.test.js
- Modify: package.json

- [ ] Step 1: 更新产品边界文档

明确完整工作区/资料库两种 JSON 导出、普通 JSON 不含凭证、导入预览/替换/合并、关键操作前保留 5 份自动备份、索引移除与原始删除区别、搜索不使用数据库/embedding、发送前统计和风险提示、案例当前版本与历史版本规则。

- [ ] Step 2: 扩展静态 smoke 验收

检查备份入口、导入预览、替换/合并、自动备份、收藏/最近使用、来源编辑、索引移除、搜索命中解释、无结果建议、发送统计、敏感信息确认、案例版本和历史入口。

- [ ] Step 3: 更新语法检查和打包清单

在 package.json 的 check 中加入新增 prototype/workspace-backup.js、prototype/backup-manager.js、prototype/search-dictionary.js、prototype/send-safety.js、electron/backup-store.js 的 node --check，并确认 Electron files 清单包含运行时文件、不包含测试和开发文档。

- [ ] Step 4: 运行完整验证

~~~powershell
npm test
npm run check
git diff --check
npm run dist:win
~~~

预期：测试、语法和差异检查通过，release 同时存在 NSIS 安装包和 portable exe。若打包阻塞，记录具体阶段和错误，不把未生成产物写成成功。

- [ ] Step 5: 手动验收

在全新 Windows 用户目录验证完整导出和替换、资料库合并冲突、重启后数据保留、批量隐藏不删除原始案例、中文别名搜索、高风险内容确认、案例 v2、无模型/无搜索/断网降级。

- [ ] Step 6: 提交

~~~powershell
git add README.md docs/MVP_SCOPE.md docs/PRODUCT_DESIGN.md tests/e2e-smoke.test.js package.json
git commit -m "test: 完成本地资料库增强集成验收"
~~~

## Definition of Done

- [ ] 完整工作区和仅资料库 JSON 导出可用，且不包含凭证。
- [ ] 导入预览、替换、合并、冲突报告和失败回滚有测试。
- [ ] 关键操作前自动备份，最近 5 份可列出和恢复。
- [ ] 资料管理遵守来源边界，派生资料不会被误删。
- [ ] 收藏、置顶、最近使用和批量操作可持久化。
- [ ] 中文别名、短语拆分、命中解释和无结果建议可用。
- [ ] 发送预览显示来源、字符/token 估算和敏感信息风险。
- [ ] 高风险内容未确认时不能发送，模型失败时保留草稿。
- [ ] 案例版本、证据、适用/不适用边界和历史对比可用。
- [ ] npm test、npm run check、git diff --check 通过。
- [ ] Windows NSIS、portable、安装、重启和无网络降级完成验收。

## 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| localStorage 容量不足 | 高 | 先提供导出/备份；规模扩大后再评估 SQLite |
| 导入破坏当前状态 | 高 | 校验、预览、自动备份、失败保持原状态 |
| 派生资料误删原始案例 | 高 | 来源动作分离；批量删除只允许手动资料 |
| 敏感信息误报 | 中 | 本地高亮、不自动修改；高风险才强制确认 |
| 别名导致搜索噪音 | 中 | 小词典、命中字段解释、建议不改变结果集 |
| app.js 冲突 | 中 | T4-T7 串行、每个任务单独提交并全量测试 |
| Windows 构建阻塞 | 中 | 记录具体阶段，自动测试和人工验收分开报告 |

## 计划自检

- 设计稿五个模块均有对应任务：备份 T2/T3，资料管理 T4，搜索 T5，发送安全 T6，案例版本 T1/T7。
- 完整工作区/资料库导出、替换/合并、最近 5 份备份、来源感知删除、收藏/最近使用、中文别名、敏感信息确认和版本历史均有实现步骤及验收点。
- 字段名在任务间统一使用 sourceKind、sourceId、hiddenAt、favorite、pinned、lastUsedAt、customAliases、currentVersion、versionHistory。
- 保持现有 UMD、Node 测试和 searchKnowledge(entries, query, options) 参数契约。
- 计划中没有 TODO、TBD 或未定义接口。

