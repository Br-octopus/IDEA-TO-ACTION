# 写作材料导入与长手册改写实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在已完成的写作工作台四步流程上，补齐长原文文件导入、整本/选章提示词，以及清爽、可搜索的代码目录候选材料选择。

**Architecture:** 保留原生 JavaScript、现有写作 coordinator、存储 schema 和本机材料解析 API。新增轻量目录提取逻辑和候选过滤/分页能力；原文文件元数据、有限预览和章节选择随写作轮次保存，不保存浏览器 File 对象。只有用户确认的最多 3 份辅助材料摘录进入任务分析；文件原件由用户在目标 AI 中附加。

**Tech Stack:** Node.js 22、原生 JavaScript、现有 DOM 事件委托、`node:test`、现有 `/api/writing-materials/parse`。

---

> **范围状态：** 写作工作台基础四步流程已完成。本计划只实现设计稿于 2026-10-23 确认的材料导入改进，不重做已有流程，不改学术论文工作台或通用提示词 Agent。

## 实施记录（2026-10-23）

Task 1–5 已完成。最终验证：定向测试 327 项通过；pnpm check 通过；pnpm test 共 1,072 项，1,071 项通过、0 失败、1 项跳过。git diff --check 通过。本次没有创建提交。

## 当前代码结构与边界

| 文件 | 本计划职责 |
| --- | --- |
| `prototype/writing-workbench-ui.js` | 独立的待改原文导入区、整本/选章控件、候选列表分页/过滤/搜索和明确状态文案；保持原文与参考材料分流。 |
| `prototype/browser-project-index.js` | 保留敏感文件与目录安全规则；补充可恢复的生成/临时文件过滤元数据，并支持完整索引上的本地搜索和分页数据。 |
| `prototype/writing-document-outline.js` | 新增纯函数模块，从 TXT/MD、DOCX 段落和 PDF 页文本中提取章节候选；识别不确定时返回空/部分目录，不伪造结构。 |
| `server/writing-material-parser.js`、`server.js` | 复用当前解析 API；DOCX 输出保留标题级别线索，PDF 保留页定位；继续遵循 20 MB、100 页和 30,000 字符上限。现有 API 将解析片段总长限制为 10,000 字符，须同步提高到 30,000，才能完整提取目录候选；明确返回是否触及提取上限。 |
| `prototype/writing-workbench-schema.js` | 清洗并限制轮次中的原文文件元数据、有限预览、目录候选、已选章节和手动范围；拒绝持久化文件句柄或二进制内容。 |
| `prototype/writing-workbench-coordinator.js` | 将有界原文预览/目录传给任务分析；用户确认后创建任务时保存 `sourceDocument` 元数据。 |
| `prototype/writing-workbench-prompts.js` | 对文件型原文生成附原件说明、整本分章节处理或选定章节范围提示；不把整本手册写入复制出的提示词。 |
| `tests/writing-material-parser.test.js`、`tests/server.test.js` | 覆盖 PDF/DOCX 解析定位和 API 返回结构。 |
| `tests/browser-project-index.test.js` | 覆盖生成文件过滤、安全排除、全量搜索及分页数据。 |
| `tests/writing-document-outline.test.js` | 新增目录抽取、位置标注和部分/空目录降级测试。 |
| `tests/writing-workbench-schema.test.js`、`tests/storage.test.js` | 覆盖原文元数据、有限预览、目录/章节状态保存和旧数据兼容。 |
| `tests/writing-workbench-coordinator.test.js`、`tests/writing-workbench-prompts.test.js` | 覆盖分析输入上限和文件型原文提示词。 |
| `tests/writing-workbench-ui.test.js`、`tests/e2e-smoke.test.js` | 覆盖导入/章节选择、材料上限、可恢复过滤、分页/搜索和完整用户流程。 |

**不得改变的边界：** `.env`、密钥文件、`.git`、依赖目录等现有安全排除继续不可浏览、不可恢复；只有构建/临时噪声过滤可由用户展开查看。文件夹最多扫描 10,000 个文件，超过时必须显示截断提示。参考材料“3 份”限制只作用于已选辅助材料，不限制搜索和浏览。DOCX/PDF 单文件最大 20 MB，PDF 最多 100 页，解析文本最多 30,000 字符；API 当前片段上限是 10,000 字符，本计划将其提升至 30,000 并明确标记解析截断。任务分析原文预览不超过 8,000 字符。任务保存文件名、指纹、有限预览和目录/选择状态，不保存 File 对象、绝对路径或原始二进制。

## Task 1：解析原文并提取可核对的章节目录

**Files:**
- Modify: `server/writing-material-parser.js`
- Modify: `server.js`
- Create: `prototype/writing-document-outline.js`
- Test: `tests/writing-material-parser.test.js`
- Test: `tests/server.test.js`
- Create: `tests/writing-document-outline.test.js`

- [x] **Step 1: 先写解析定位测试**

在解析器测试中扩展现有 `makeDocx()` fixture 为带 `w:pStyle w:val="Heading1"` 的标题样式版本，并复用现有 `makePdf()`。断言 DOCX 返回有序段落及标题级别，PDF 返回页文本和页码；触及 30,000 字符输出上限时响应必须标记为截断，不能呈现为完整全文。

```js
test('DOCX 返回标题线索，PDF 保留页定位', async () => {
  const docx = await parser.parse({ buffer: await makeDocxWithHeadings(), mimeType: DOCX_MIME });
  assert.equal(docx.ok, true);
  assert.ok(docx.paragraphs.some(item => item.text === '安装软件' && item.headingLevel === 1));

  const pdf = await parser.parse({ buffer: makePdf('第1章 安装'), mimeType: 'application/pdf' });
  assert.equal(pdf.ok, true);
  assert.equal(pdf.pages[0].page, 1);
});
```

- [x] **Step 2: 运行解析器测试确认新契约失败**

Run: `node --test tests/writing-material-parser.test.js tests/server.test.js`
Expected: DOCX 标题线索断言失败；既有 PDF/OCR/本机访问限制测试保持原状。

- [x] **Step 3: 扩展解析结果并新增目录提取纯函数**

DOCX 解析不能只检查段落里的 `w:pStyle` 是否恰好叫 `HeadingN`：解析 `word/styles.xml` 中 `styleId` 到显示名/`outlineLvl` 的映射，并兼容段落上的 `w:outlineLvl`；标准标题样式、自定义标题样式和普通段落都要有 fixture 覆盖。返回有序 `paragraphs: [{ text, headingLevel }]`，普通段落的 `headingLevel` 为 `null`。PDF 继续以页文本作为定位段，并保留 OCR 标记。把 `server.js` 的解析片段总长上限从 10,000 调到 30,000，并在 parser/API 响应中显式返回 `truncated`；解析片段、段落/页定位和截断标记必须使用同一截断边界，目录不能读取未返回的尾部文本。新增 `prototype/writing-document-outline.js`，导出 `extractWritingOutline({ format, text, segments })`，返回 `{ items: [{ id, title, level, locator }], complete }`，最多 200 项。TXT/MD 只识别 Markdown 标题和明确章节编号；DOCX 优先使用标题样式，再回退明确编号标题；PDF 只从每页文本识别明确编号标题，页定位用“第 N 页”。重复标题用稳定序号生成唯一 ID。普通句子不作为标题；无法可靠识别时返回空或部分目录和 `complete: false`。

- [x] **Step 4: 补齐 API 与目录抽取测试**

验证 `/api/writing-materials/parse` 返回 DOCX 标题线索和 PDF 页定位；分别用超过 10,000 与 30,000 字符的 DOCX/PDF 输入验证 API 片段边界，最多保留 30,000 字符且 `truncated` 与实际丢失内容一致。目录提取只使用 API 实际返回的解析范围。覆盖 Markdown、标准/自定义 DOCX 标题样式、段落 `w:outlineLvl`、PDF 编号标题、重复标题 ID、无标题和截断输入。扫描版 PDF 使用 OCR 时保留现有 warning，目录仍可标记为不完整。

Run: `node --test tests/writing-material-parser.test.js tests/server.test.js tests/writing-document-outline.test.js`
Expected: 解析结果和目录候选断言全部通过；解析限制及本机 API 安全测试通过。

- [x] **Step 5: 完成解析与目录模块阶段实现与验证（本次不提交）**

本次按用户要求完成实现与验收，不执行 Git 提交。

## Task 2：整理代码目录候选与本地筛选

**Files:**
- Modify: `prototype/browser-project-index.js`
- Test: `tests/browser-project-index.test.js`

- [x] **Step 1: 编写噪声过滤及候选浏览测试**

构造含操作手册、源代码、`build_v8.js`、`.min.js`、临时文件、`.env`、`node_modules` 的目录。断言生成/临时文件标记为可恢复的 `filtered-generated`，手册与有用源码可索引；敏感文件和安全排除目录仍不出现在可恢复清单。再验证搜索查找全量候选、分页仅切片显示结果而不改变总数。

```js
test('候选搜索分页覆盖完整索引且安全排除不可恢复', async () => {
  const result = await indexBrowserProjectFiles(files);
  const matches = filterBrowserProjectCandidates(result, { query: '操作手册', page: 1, pageSize: 20 });
  assert.equal(matches.total, 1);
  assert.match(matches.items[0].relativePath, /操作手册/);
  assert.ok(result.filteredCandidates.some(item => item.reason === 'generated'));
  assert.ok(!JSON.stringify(result.filteredCandidates).includes('.env'));
});
```

- [x] **Step 2: 运行索引测试确认新 API 不存在**

Run: `node --test tests/browser-project-index.test.js`
Expected: 新增过滤/分页测试因候选辅助函数或过滤状态尚未实现而失败。

- [x] **Step 3: 增加可恢复的噪声过滤元数据和候选分页函数**

明确并测试索引数据契约：`files` 是已读取且可用的候选，`filteredCandidates` 只含相对路径、显示名和过滤原因（不含正文、绝对路径或敏感路径），`inventory`/`inventoryComplete` 描述扫描清单和是否触及 10,000 项上限。敏感文件及安全排除目录不进入任何可恢复集合。生成/临时项初次索引时不读正文；用户点击“恢复”后，对该单项执行与普通候选相同的格式、大小、密钥和二进制保护，成功才转入 `files`；失败时说明原因并保留重试入口。只允许恢复明确非敏感的过滤项，安全排除不能通过搜索、分页或手工路径绕过。

导出 `filterBrowserProjectCandidates(result, { query, page, pageSize, showFiltered })`：只对完整的 `files` 候选集按名称/路径/已读取摘录搜索，再分页；`showFiltered` 仅控制可恢复过滤项是否作为恢复操作行展示，不把未读取项混作可勾选候选或参与摘录搜索。返回至少 `{ items, total, page, pageSize, filteredTotal, inventoryComplete }`。默认页大小 20。目录输入仍最多处理 10,000 项，并沿用超限状态；UI 不依赖未经契约定义的 `result.filtered`。

```js
function filterBrowserProjectCandidates(result, options = {}) {
  const pageSize = Math.max(1, Math.min(options.pageSize || 20, 100));
  const query = String(options.query || '').trim().toLocaleLowerCase();
  const matches = result.files.filter(item => !query ||
    [item.title, item.relativePath, item.excerpt].some(value =>
      String(value || '').toLocaleLowerCase().includes(query)));
  const page = Math.max(1, options.page || 1);
  return { total: matches.length, page, pageSize,
    filteredTotal: options.showFiltered ? result.filteredCandidates.length : 0,
    inventoryComplete: result.inventoryComplete,
    items: matches.slice((page - 1) * pageSize, page * pageSize),
    filteredItems: options.showFiltered ? result.filteredCandidates : [] };
}
```

- [x] **Step 4: 运行索引回归测试**

Run: `node --test tests/browser-project-index.test.js`
Expected: 恢复过滤项会实际读取单文件并经过安全校验；完整候选搜索、20 项分页、过滤计数、10,000 项截断、密钥脱敏和既有安全排除全部通过。

- [x] **Step 5: 完成目录索引变化阶段实现与验证（本次不提交）**

本次按用户要求完成实现与验收，不执行 Git 提交。

## Task 3：保存原文来源并生成整本/选章提示词

**Files:**
- Modify: `prototype/writing-workbench-schema.js`
- Modify: `prototype/writing-workbench-coordinator.js`
- Modify: `prototype/writing-workbench-prompts.js`
- Test: `tests/writing-workbench-schema.test.js`
- Test: `tests/storage.test.js`
- Test: `tests/writing-workbench-coordinator.test.js`
- Test: `tests/writing-workbench-prompts.test.js`

- [x] **Step 1: 为 `sourceDocument` 编写 schema、存储与分析测试**

定义轮次内文件型原文结构：`{ name, format, fingerprint, parseStatus, extractedCharacterCount, pageCount, preview, outline, selectedSectionIds, manualSectionRange, processingScope, attachmentRequired }`。同时覆盖短文粘贴模式：不强制导入文件或选择目录；目录无法识别时允许手动填写章节范围。测试要求 `preview` 最多 8,000 字符、目录最多 200 项、章节选择只接受目录中存在的 ID；清洗后不保留绝对路径、File 对象、二进制或完整 30,000 字符文档。任务分析收到原文预览、目录和已选参考摘录，但仍不创建文章。

```js
const sourceDocument = schema.normalizeWritingSourceDocument({
  name: '操作手册.docx', format: 'docx', fingerprint: '12000:abcd',
  preview: '预览'.repeat(5000),
  outline: [{ id: 's1', title: '安装', level: 1, locator: '第1段' }],
  selectedSectionIds: ['s1', 'unknown'], processingScope: 'sections',
  absolutePath: 'D:/private/操作手册.docx', file: { bytes: 'secret' }
});
assert.ok(sourceDocument.preview.length <= 8000);
assert.deepEqual(sourceDocument.selectedSectionIds, ['s1']);
assert.equal(Object.hasOwn(sourceDocument, 'absolutePath'), false);
assert.equal(Object.hasOwn(sourceDocument, 'file'), false);
```

- [x] **Step 2: 运行 schema/coordinator/prompt 测试确认新字段未支持**

Run: `node --test tests/writing-workbench-schema.test.js tests/storage.test.js tests/writing-workbench-coordinator.test.js tests/writing-workbench-prompts.test.js`
Expected: 新增 `sourceDocument` 测试失败；旧任务迁移和原有文本改写测试保持通过。

- [x] **Step 3: 实现受限原文来源结构和 prompt 分支**

在 round normalizer 中加入 `normalizeWritingSourceDocument`，在旧任务迁移中默认省略该字段。`analyzeTask` 仅接收 8,000 字符预览、最多 200 个标题和用户确认的辅助摘录；新建任务保存源文件名、格式、指纹、解析状态、预览、章节候选、选择及有界手动范围，不保存文件句柄或绝对路径。任务分析 prompt 明确预览可能不完整，不得据此断言全手册事实。文件型改写提示词显示“请附上原文件”，整本模式要求逐章处理并等待用户继续，选章模式只要求修改已选标题/位置；未识别位置显示“位置未识别”。若原文以粘贴方式提供，保持现有短文改写提示词行为；粘贴或文件原文切换时清理互斥的旧来源状态。文件型提示词不拼入整本原文。

```js
function buildSourceDocumentInstructions(sourceDocument) {
  if (!sourceDocument) return '';
  const selected = sourceDocument.outline
    .filter(item => sourceDocument.selectedSectionIds.includes(item.id));
  const scope = sourceDocument.processingScope === 'sections'
    ? `只处理以下章节：${selected.map(item => `${item.title}（${item.locator || '位置未识别'}）`).join('、')}`
    : '请先检查原文件目录，再按章节逐次改写；每次完成一章后等待用户确认再继续。';
  return `待改原文件：${sourceDocument.name}。请用户在当前 AI 对话中附上该文件。${scope}`;
}
```

- [x] **Step 4: 运行 schema、存储、coordinator 和 prompt 回归**

Run: `node --test tests/writing-workbench-schema.test.js tests/storage.test.js tests/writing-workbench-coordinator.test.js tests/writing-workbench-prompts.test.js`
Expected: 文件元数据在保存/重载后可用；原文件正文不进入整本处理 prompt；选章范围与附件说明准确；旧的粘贴文本提示词无回归。

- [x] **Step 5: 完成来源契约与提示词变化阶段实现与验证（本次不提交）**

本次按用户要求完成实现与验收，不执行 Git 提交。

## Task 4：改造第一步材料界面

**Files:**
- Modify: `prototype/writing-workbench-ui.js`
- Modify: `prototype/index.html`（仅新增写作导入区/候选列表所需的局部样式）
- Modify: `prototype/writing-workbench-schema.js`（仅在 round/sourceDocument 状态接线需要时）
- Test: `tests/writing-workbench-ui.test.js`

- [x] **Step 1: 编写首屏界面与交互失败测试**

测试新写作不显示原文导入；改写可粘贴短文或导入长文，分别能继续到任务分析。导入长文后出现解析状态及章节候选；选章后确认的 ID 或手动范围进入任务来源。替换/移除原文件后清空旧目录、章节 ID 和解析状态。异步解析时连续换文件、取消/移除文件或先后完成两次解析，旧请求不得覆盖当前文件状态。参考材料区显示“已选 N/3 份辅助资料，待改原文不计入”，每页 20 项，搜索能命中非当前页文件；勾选 3 份后尝试第 4 份应被明确阻止并说明上限，不得静默替换已有选择。构建/临时文件默认折叠，恢复后确实读取并通过安全校验，安全排除文件不能恢复。单文件、多文件导入与文件夹/工作空间候选合并、去重且不互相替换；移除导入来源后只移除该来源独有项，仍由其他来源提供的候选保留。测试候选总量超过 100 时仍可通过全索引搜索找到未渲染项。模型失败、解析失败、恢复失败、没有可读候选、扫描未完成均保留目标和文件名并显示准确状态/可恢复操作。补充空列表、加载中、搜索无匹配、过滤项数量、解析不完整、被选章节归零等状态断言，并验证文件路径窄屏截断但完整路径可通过可访问名称/提示读取。

```js
const markup = fixture().mount.innerHTML;
assert.match(markup, /待改原文/);
assert.match(markup, /整本处理/);
assert.match(markup, /选择章节/);
assert.match(markup, /待改原文不计入/);
assert.match(markup, /每页 20 项/);
```

- [x] **Step 2: 运行 UI 测试确认新导入/呈现断言失败**

Run: `node --test tests/writing-workbench-ui.test.js`
Expected: 新增原文文件区、章节处理、候选分页/过滤状态断言失败。

- [x] **Step 3: 实现独立原文导入和清爽候选视图**

新增 `writing-source-file` 文件输入，仅接受 TXT、MD、DOCX、PDF。TXT/MD 本机读取，有限保存最多 30,000 字符并记录是否被截断；DOCX/PDF 调用现有本机解析 API，并显示 20 MB、100 页和 30,000 字符限制。PDF OCR 明确提示识别结果需要人工核对。预解析 `sourceDocument` 保存在向导临时状态中；每次导入递增请求序号或使用等效取消机制，只有当前文件对应的最新结果可更新状态，失败时保留文件名和目标，移除/换文件时清空旧目录与章节选择。候选引用材料维持来源集合、统一去重后的 `allCandidates` 与 `selectedMaterialIds`：额外导入的单/多文件累加到文件夹/工作空间候选，不覆盖已有来源；重复项按来源 ID/相对路径或规范化文件指纹合并；移除某来源时仅删除没有其他来源引用的候选。所有候选参与全量搜索，无论 UI 暂存规模；每次只渲染 20 项，不以 100 项暂存上限截断索引或搜索。通过 `filterBrowserProjectCandidates` 渲染可用候选，并将可恢复过滤项作为独立恢复操作行显示。默认先展示本机推荐项，噪声项分组折叠且恢复时才单文件读取并执行普通候选安全校验，安全排除项不可恢复。纵向分区显示原文卡片与辅助材料卡片；候选行只显示勾选框、文件名、路径、短状态和可展开摘录；扫描/空结果/无匹配/截断信息用汇总状态呈现。只有用户确认的最多 3 份材料调用 `analyzeTask`；成功后创建文章并把 `sourceDocument` 绑定到首轮。原文任务创建后保存有限预览和章节选择；刷新后不假设文件对象可恢复，仍允许用已保存的信息编辑提示词。

```js
const visible = browserIndex.filterBrowserProjectCandidates(indexResult, {
  query: form.wizardMaterialSearch,
  page: form.wizardMaterialPage,
  pageSize: 20,
  showFiltered: form.showFilteredCandidates
});
```

- [x] **Step 4: 运行 UI 与索引回归**

Run: `node --test tests/writing-workbench-ui.test.js tests/browser-project-index.test.js tests/writing-workbench-schema.test.js`
Expected: 原文、任务目标和已选材料在回退/失败时保留；旧解析结果不会覆盖新文件；粘贴与文件导入均可继续；候选可跨页及跨来源搜索、去重与移除；恢复过滤项会读取且失败有反馈；最多勾选 3 份参考材料；原文和规则包不占上限；安全排除和历史任务兼容。

- [x] **Step 5: 完成向导界面阶段实现与验证（本次不提交）**

本次按用户要求完成实现与验收，不执行 Git 提交。

## Task 5：完成端到端验收与项目回归

**Files:**
- Modify: `tests/e2e-smoke.test.js`
- Modify: `tests/writing-workbench-ui.test.js`
- Modify: `docs/superpowers/specs/2026-10-23-writing-workbench-guided-flow-design.md`（仅记录实际实现边界或差异）

- [x] **Step 1: 编写完整的新用户验收场景**

端到端走通：文章改写分别以粘贴短文和导入操作手册开始；文件模式覆盖 TXT/MD、DOCX、PDF，查看解析状态和目录后选择章节或整本模式并输入改写目标；添加代码文件夹及额外参考文件，确认候选合并去重、每页 20 项、全量搜索和一个生成过滤项恢复后实际读取；选择 3 份参考材料，确认分析请求仅包含这 3 份材料摘录及有界原文预览；生成提示词并验证只含附件要求/选定章节范围、不含整本手册；刷新或重开已保存任务，确认元数据/预览可恢复但 File 对象需重新选择。另验证文件快速切换时旧解析响应不覆盖新状态、解析/恢复超限或失败、30,000 字符截断、扫描版 OCR 低可信、目录无法提取、模型失败、搜索无结果、候选超过 100 条和目录达到 10,000 项上限时，任务输入保留且降级入口可用。

```js
assert.equal(analyzeRequest.sourceDocument.preview.length <= 8000, true);
assert.equal(analyzeRequest.materials.length, 3);
assert.doesNotMatch(generatedPrompt, /整本手册的唯一段落标记/);
assert.match(generatedPrompt, /请在当前 AI 对话中附上该文件/);
assert.match(generatedPrompt, /只处理以下章节/);
```

- [x] **Step 2: 运行与本次变更直接相关的测试**

Run: `node --test tests/writing-document-outline.test.js tests/writing-material-parser.test.js tests/server.test.js tests/browser-project-index.test.js tests/writing-workbench-schema.test.js tests/storage.test.js tests/writing-workbench-coordinator.test.js tests/writing-workbench-prompts.test.js tests/writing-workbench-ui.test.js tests/e2e-smoke.test.js`
Expected: 所有本次覆盖用例通过；旧工作台四步流程、学术写作、软著规则包、已有文章历史和资料覆盖回归通过。

- [x] **Step 3: 运行项目检查**

Run: `pnpm check`
Expected: 项目脚本语法/静态检查通过。

Run: `pnpm test`
Expected: 项目测试通过；若出现与本次变更无关的既有失败，记录失败项，不通过改无关模块掩盖。

- [x] **Step 4: 检查最终改动范围并记录验收**

本次已完成工作区差异检查；按用户要求不执行 Git 提交。

## 计划自审：设计覆盖映射

| 设计要求 | 任务 | 验证 |
| --- | --- | --- |
| 文件原文与最多 3 份参考材料分开 | Task 3、Task 4、Task 5 | Schema、UI、E2E 断言 |
| TXT/MD/DOCX/PDF 导入与大小/页数/文本限制 | Task 1、Task 4、Task 5 | Parser、API 和 UI 限制/失败测试 |
| 整本提示词逐章处理并附原件 | Task 3、Task 4、Task 5 | Prompt 和 E2E 检查 |
| 提取目录、选章范围、位置缺失降级 | Task 1、Task 3、Task 4、Task 5 | 目录纯函数、解析和提示词测试 |
| 原件句柄不持久化，任务预览/章节选择可恢复 | Task 3、Task 4、Task 5 | Schema、storage 和重开流程测试 |
| 短文粘贴与文件导入并行支持；章节目录缺失时可手动指定范围 | Task 3、Task 4、Task 5 | Schema、提示词和 UI/E2E 测试 |
| DOCX 标准/自定义标题映射、页/段定位与 30,000 字符端到端截断 | Task 1、Task 5 | Parser/API/outline 测试，超过 10,000 与 30,000 的边界用例 |
| 代码/生成文件过滤项恢复后读取，安全排除始终不可恢复 | Task 2、Task 4、Task 5 | Index 恢复、失败、安全与 UI 测试 |
| 全索引本地搜索、每页 20 项、10,000 项截断提示 | Task 2、Task 4、Task 5 | 分页、跨页搜索、截断及 UI 状态测试 |
| 文件夹/工作空间和额外参考文件合并、去重、按来源移除 | Task 4、Task 5 | 多来源索引与 UI/E2E 测试 |
| 候选数不受 100 项渲染暂存限制，已选辅助材料严格最多 3 份 | Task 4、Task 5 | 大候选搜索与第 4 项拒绝测试 |
| 异步换文件/取消时不被过期解析响应覆盖 | Task 4、Task 5 | UI 快速切换和移除竞态测试 |
| 简洁、分区且不堆重复错误卡片 | Task 4、Task 5 | UI 结构和状态呈现测试 |
| 只有用户确认材料进入任务分析 | Task 3、Task 4、Task 5 | Coordinator 与端到端请求内容测试 |

## 执行说明

- 依次完成 Task 1→Task 2→Task 3→Task 4→Task 5；Task 1 的解析/目录输出和 Task 2 的候选索引接口是 UI 实现前置条件。
- 沿用现有原生 DOM 与测试 fixture，不引入新的 UI 框架、虚拟列表依赖或独立上传服务。
- 实现时沿用用户当前工作区的既有改动，不重置或覆盖与本计划无关的文件。
