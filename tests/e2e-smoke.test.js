const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { startServer } = require('../server');
const {
  buildGoalPrompt,
  buildStagePrompt,
  buildCaseReviewPrompt
} = require('../prototype/prompt-engine');
const {
  appendReferenceContext,
  createSearchStub
} = require('../prototype/research-catalog');
const knowledgeSearch = require('../prototype/knowledge-search.js');
const { createEmptyState, confirmCase } = require('../prototype/storage');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'prototype', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'prototype', 'app.js'), 'utf8');

test('统一任务工作台是唯一的新任务入口，旧版入口收纳到更多菜单', () => {
  const nav = html.match(/<nav class="nav"[\s\S]*?<\/nav>/)?.[0] || "";
  const primaryNav = nav.replace(/<details class="mobile-more legacy-tools">[\s\S]*?<\/details>/, "");
  const legacyNav = nav.match(/<details class="mobile-more legacy-tools">([\s\S]*?)<\/details>/)?.[1] || "";
  assert.match(primaryNav, /data-view="home" data-nav-key="workspace-new"/);
  assert.doesNotMatch(primaryNav, /data-nav-key="workspace-prompts"|data-nav-key="writing"/);
  assert.match(legacyNav, /data-view="prompt-agent" data-nav-key="workspace-prompts">旧版提示词 Agent/);
  assert.match(legacyNav, /data-view="article" data-nav-key="writing">旧版写作工作台/);
  const mobileNav = html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  const mobilePrimary = mobileNav.replace(/<details class="mobile-more">[\s\S]*?<\/details>/, "");
  assert.match(mobilePrimary, /data-view="home" data-nav-key="workspace-new"/);
  assert.doesNotMatch(mobilePrimary, /data-nav-key="workspace-prompts"|data-nav-key="writing"/);
  assert.match(app, /\.activity-rail \[data-nav-key\]/);
  assert.match(app, /\.mobile-nav \[data-nav-key\]/);
  assert.match(app, /node\.dataset\.navKey === navKey/);
  assert.match(app, /document\.querySelectorAll\("\[data-view\]"\)\.forEach\(node => node\.addEventListener\("click", \(\) => go\(node\.dataset\.view, node\.dataset\.navKey\)\)\)/);
  assert.match(app, /articleTitle\.textContent = navKey === "memory" \? "记忆与偏好" : "写作工作台"/);
  assert.match(app, /function renderPlans\(\)[\s\S]*?data-open-project/);
});

test('资料库旧详情容器被移除后不会中断 renderer 初始化', () => {
  assert.doesNotMatch(html, /id="knowledge-detail"/);
  assert.match(app, /getElementById\("knowledge-detail"\)\?\.addEventListener/);
  assert.match(app, /root\.querySelectorAll\("\[data-knowledge-writing\]"\)/);
});

test('我的计划可搜索、查看状态、归档并恢复原记录而不截断历史', () => {
  assert.match(html, /id="plan-search"/);
  assert.match(html, /id="all-plans"[^>]*aria-live="polite"/);
  assert.match(html, /归档只会收起记录，不会删除对话、资料、批注或提示词版本/);
  assert.match(app, /const active = matches\.filter\(project => !project\.archivedAt\)/);
  assert.match(app, /const archived = matches\.filter\(project => Boolean\(project\.archivedAt\)\)/);
  assert.match(app, /data-plan-archive/);
  assert.match(app, /data-plan-restore/);
  assert.match(app, /listAttachments\(project\.id\)[\s\S]*?listAnnotations\(project\.id\)/);
  assert.match(app, /不会创建同名副本/);
  assert.match(app, /renderProject\(restored\)/);
  assert.doesNotMatch(app.match(/async function createProjectFromIdea\([\s\S]*?\n  \}/)?.[0] || '', /projects\.slice\(0, 40\)/);
});

test('首页只保留自然输入；需要选择时由 Agent 在任务对话中按需给出', () => {
  const home = html.match(/<section class="view active" id="view-home">([\s\S]*?)<\/section>/)?.[1] || "";
  assert.ok(home);
  assert.match(home, /id="idea"/);
  assert.match(home, /data-start-with-material/);
  assert.match(home, /添加资料后开始/);
  assert.doesNotMatch(home, /id="audience"|id="time"|id="success"|id="materials"|id="constraints"|example-chip/);
  assert.doesNotMatch(html, /domain-choice-dialog|data-domain-choice/);
  assert.match(app, /const domain = candidates\.length === 1 \? candidates\[0\] : "通用计划";/);
  assert.match(app, /void requestWorkbenchAgent\(persistedProject\)/);
  assert.match(app, /ideaForm\.querySelector\("\[data-start-with-material\]"\)\.addEventListener\("click"/);
  assert.match(app, /reportValidity\(\)[\s\S]*?startIdeaFromForm\(true\)/);
  assert.doesNotMatch(app, /event\.submitter\?\.dataset\.startWithMaterial/);
  assert.match(app, /await chooseWorkbenchMaterial\(persistedProject\)/);
  assert.match(app, /desktopApi\.pptFeedback\.chooseFile\(project\.id\)/);
  assert.match(app, /const feedback = window\.ForwardStepPptFeedback/);
  assert.match(html, /id="workbench-message-form"/);
  assert.match(app, /你是向前一步桌面应用中的任务协作 Agent/);
  assert.match(app, /workbench-recommendation/);
  assert.match(app, /结合你的想法，我建议/);
  assert.match(app, /你可以直接在对话中确认，也可以补充或修正这个方向/);
  assert.match(html, /直接说你的想法即可；Agent 会结合上下文给出一个建议，只有关键信息不足时才追问/);
  assert.match(app, /由你根据用户想法提出一个最推荐的具体做法/);
  assert.match(app, /方案之间的比较与取舍由你先完成，不把候选方案或逐项填写的工作交给用户/);
  assert.match(app, /workbenchDialogue\.confirmsRecommendation\(text\)/);
  assert.doesNotMatch(app, /data-workbench-recommendation/);
  assert.doesNotMatch(app, /message\.options\.forEach/);
  assert.doesNotMatch(html, /选项只在对话里按需出现/);
  assert.match(app, /Agent 建议：\$\{message\.recommendation\.text\}/);
  assert.match(app, /data-workbench-locate-annotation/);
  assert.match(app, /openPreview\(annotation\.attachmentId, annotation\.target, annotation\.contentHash\)/);
  assert.match(app, /pendingWorkbenchProjects/);
});

test('提示词收藏按提示词、案例、方法卡分区，并支持变量检查、版本比较和完整来源交接', () => {
  for (const section of ['prompts', 'cases', 'methods']) {
    assert.match(html, new RegExp(`data-prompt-library-section="${section}"`));
  }
  assert.match(html, /id="prompt-library-detail"/);
  assert.match(html, /id="prompt-edit-dialog"/);
  assert.match(html, /id="prompt-use-dialog"/);
  assert.match(app, /listPromptGroups\(state\.prompts\)/);
  assert.match(app, /togglePromptFavorite\(state, button\.dataset\.promptFavorite\)/);
  assert.match(app, /fillPromptTemplate\(prompt\.text, values\)/);
  assert.match(app, /data-prompt-write="\$\{escapeHtml\(selected\.id\)\}"/);
  assert.match(app, /preparePromptDraft\(\{ promptId: preview\.prompt\.id, title: preview\.prompt\.title,[\s\S]*version: preview\.prompt\.version \|\| 1, text \}\)/);
  assert.match(app, /action === "write" \? "检查并带入写作"/);
  assert.match(app, /comparePromptTexts\(left\.text, right\.text\)/);
  assert.match(app, /buildPromptTransferDraft\(prompt, preview\.result\.text, preview\.context/);
  assert.match(app, /project\.conversationDraft = draft/);
  const dialogue = fs.readFileSync(path.join(root, 'prototype', 'workbench-dialogue.js'), 'utf8');
  assert.match(dialogue, /【带入收藏提示词】[\s\S]*来源 ID：[\$]?\{prompt\.id\}[\s\S]*版本：V[\$]?\{prompt\.version/);
  const promptUseHandler = app.slice(app.indexOf('document.getElementById("prompt-use-form").addEventListener("submit"'), app.indexOf("function getKnowledgeFilters()"));
  assert.doesNotMatch(promptUseHandler, /requestWorkbenchAgent\(/, '收藏提示词只进入可编辑草稿，不自动发送或调用模型');
  assert.match(app, /不修改收藏版本/);
});

test('工作台按内容变化保存有上限的提示词历史，并可在确认后恢复草稿', () => {
  assert.match(html, /id="workbench-prompt-history"/);
  assert.match(html, /提示词历史版本（最近 10 版）/);
  assert.match(app, /workbenchDialogue\.appendPromptVersion\(current/);
  assert.match(app, /promptReplacementNeedsConfirmation\(project\.workbenchPromptDraft, project\.workbenchGeneratedPrompt\)/);
  assert.match(app, /promptReplacementNeedsConfirmation\(draft, generated, version\.prompt\)/);
  assert.match(app, /data-workbench-prompt-restore/);
  assert.match(app, /载入历史版本会替换编辑区内容，是否继续/);
  assert.match(app, /重新生成会替换这些修改，是否继续/);
  assert.match(app, /recordWorkbenchPromptVersion\(project, next, promptSources\.filter/);
  assert.match(app, /当前批注和历史引用快照未被更改/);
});

test('打开任务时先显示工作台再恢复资料滚动位置', () => {
  const projectRenderer = app.match(/function renderProject\(project\) \{([\s\S]*?)\n  function getActiveProject\(\)/)?.[1] || "";
  const showWorkbench = projectRenderer.indexOf('go("project")');
  const restoreWorkbench = projectRenderer.indexOf("renderWorkbench(project)");
  assert.ok(showWorkbench >= 0 && restoreWorkbench > showWorkbench, "隐藏视图中设置 scrollTop 会被浏览器清零");
  assert.match(projectRenderer, /if \(activeView === "project"\) saveWorkbenchViewState\(\)/);
  assert.match(app, /scroll\.scrollTop = viewer\?\.scrollTop \|\| 0/);
});

test('资料操作栏独立固定，正文滚动位置按附件保存恢复', () => {
  const toolbar = html.match(/\.workbench-material-toolbar \{([^}]+)\}/)?.[1] || "";
  const viewer = html.match(/\.workbench-material-view \{([^}]+)\}/)?.[1] || "";
  const scroll = html.match(/\.workbench-material-scroll \{([^}]+)\}/)?.[1] || "";
  assert.match(viewer, /display:\s*flex/);
  assert.match(viewer, /overflow:\s*hidden/);
  assert.doesNotMatch(toolbar, /position:\s*sticky/);
  assert.match(scroll, /overflow:\s*auto/);
  assert.match(app, /workbench-material-scroll/);
  assert.match(app, /addEventListener\("scroll", scheduleWorkbenchViewStateSave, \{ capture: true, passive: true \}\)/);
  assert.match(app, /viewer\.scrollTop = scroll\.scrollTop/);
});

test('PDF 状态行显示在页面下方', () => {
  const pdfHost = html.match(/\.workbench-pdf-viewer-host \{([^}]+)\}/)?.[1] || "";
  const status = html.match(/#workbench-pdf-status \{([^}]+)\}/)?.[1] || "";
  assert.match(pdfHost, /position:\s*relative/);
  assert.match(status, /inset:\s*auto 0 0/);
  assert.match(status, /height:\s*26px/);
});

test('工作台布局和资料查看状态按任务及附件隔离并持久化', () => {
  const viewerState = app.match(/function getWorkbenchViewerState\(project, attachmentId\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(viewerState, /project\.workbenchViewerState\[attachmentId\] \|\|= \{ zoomMode: "fit" \}/);
  assert.match(viewerState, /viewer\.scrollByLayout\?\.\[layout\]/);
  const saveView = app.match(/function saveWorkbenchViewState\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(saveView, /getWorkbenchViewerState\(project, project\.workbenchAttachmentId\)/);
  assert.match(saveView, /viewer\.scrollByLayout\[layout\] = \{ left: scroll\.scrollLeft, top: scroll\.scrollTop \}/);
  assert.match(saveView, /viewer\.scrollLeft = scroll\.scrollLeft/);
  assert.match(saveView, /viewer\.scrollTop = scroll\.scrollTop/);
  const layoutStart = app.indexOf('document.querySelectorAll("[data-workbench-layout]").forEach(button => button.addEventListener("click"');
  const previewStart = app.indexOf('document.querySelectorAll("[data-workbench-preview]").forEach(button => button.addEventListener("click"', layoutStart);
  const layoutClick = layoutStart >= 0 && previewStart > layoutStart ? app.slice(layoutStart, previewStart) : '';
  assert.ok(layoutClick.indexOf('saveWorkbenchViewState()') < layoutClick.indexOf('project.workbenchLayout ='));
  assert.ok(layoutClick.indexOf('project.workbenchLayout =') < layoutClick.indexOf('persist()'));
  assert.match(app, /const layout = \["split", "chat", "preview"\]\.includes\(project\.workbenchLayout\)/);
  assert.match(app, /project\.workbenchPreviewMode = \["material", "prompt", "task"\]/);
  assert.match(app, /viewer\.scrollByLayout = \{\}/);
});

test('工作台通过受控附件读取实际 PDF 页面并按页保存批注', () => {
  assert.match(html, /pdfjs-loader\.js/);
  assert.match(html, /pdf_viewer\.css/);
  assert.match(html, /pdf-text-anchor\.js/);
  assert.match(html, /\.workbench-pdf-scroll \{[^}]*position:absolute/);
  assert.match(app, /class="workbench-pdf-viewer-host"><div id="workbench-pdf-scroll" class="workbench-pdf-scroll"><div id="workbench-pdf-viewer" class="pdfViewer"/);
  assert.match(app, /ForwardStepPdfjsReady/);
  assert.match(app, /new pdfjsViewer\.PDFViewer\(\{ container, viewer: viewerElement, eventBus, linkService, textLayerMode: 1, abortSignal: abortController\.signal \}\)/);
  assert.match(app, /pdfViewer\.setDocument\(material\.pdfDocument\)/);
  assert.match(app, /updateWorkbenchPdfControls\(root, pageNumber, material\.pdfPageCount\)/);
  assert.match(app, /if \(material\.pdfViewer !== pdfViewer \|\| restoringPage \|\| material\.fitting \|\| !Number\.isSafeInteger\(pageNumber\)\) return/);
  assert.match(app, /material\.pdfViewer\.currentPageNumber = nextPage \+ 1/);
  assert.match(app, /if \(viewerState\.zoomMode !== "fit" && \(restoredPageIndex === 0 \|\| restoredPdfScrollTop > 0\)\) \{\s*container\.scrollTop = restoredPdfScrollTop;\s*\}/);
  assert.match(app, /else if \(pageNumber === pdfViewer\.currentPageNumber\) \{\s*const status = root\.querySelector\("#workbench-pdf-status"\)/);
  assert.match(app, /第 \$\{pageNumber\} 页已就绪 \/ 共 \$\{material\.pdfPageCount\} 页/);
  assert.match(app, /const zoomOutput = document\.querySelector\("#workbench-material-view \.workbench-zoom-control output"\)/);
  assert.match(app, /getPageView\(pageNumber - 1\)/);
  assert.match(app, /viewer\.pdfScrollTop/);
  assert.match(app, /pdfViewerAbortController\?\.abort\(\)/);
  assert.match(app, /ForwardStepPdfTextAnchor\.createTextAnchor/);
  assert.match(app, /ForwardStepPdfTextAnchor\.resolveTextAnchor/);
  assert.match(app, /function renderWorkbenchPdfTextMarks\(/);
  assert.match(app, /\["textlayerrendered", onTextLayerRendered\]/);
  assert.match(app, /data-workbench-save-pdf-text-selection/);
  assert.match(app, /selected\?\.kind === "pdf" && item\.target\?\.kind === "text" && item\.target\.selector === "\.textLayer"/);
  assert.match(app, /pending\.pageIndex/);
  const pdfSaveFlow = app.match(/else if \(savePdfTextSelectionButton\) \{([\s\S]*?)\} else if \(clearPdfTextSelectionButton\)/)?.[1] || '';
  assert.match(pdfSaveFlow, /await saveWorkbenchAnnotation\(project, annotation, \{ completeDraft: true \}\)/, 'PDF 批注保存确认后走统一草稿清理与刷新');
  assert.doesNotMatch(app, /page\.render\(/);
  assert.match(app, /data-workbench-page-step/);
  assert.match(app, /desktopApi\.pptFeedback\.readPdf\(selected\.id\)/);
  assert.match(app, /pageIndex: current\.kind === "image" \? 0 : \(drawing\?\.pageIndex \?\? pageIndex\)/);
  assert.match(fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8'), /'ppt-feedback:read-pdf'/);
});

test('工作台真实资料查看与批注通过受控附件 IPC，不持久化图片二进制', () => {
  assert.match(html, /data-workbench-preview="material"/);
  assert.match(html, /id="workbench-material-view"/);
  assert.match(app, /id="workbench-material-tool"[\s\S]*?value="region"/);
  assert.match(app, /desktopApi\.pptFeedback\.readImage/);
  assert.match(app, /desktopApi\.pptFeedback\.listAnnotations/);
  assert.match(app, /desktopApi\.pptFeedback\.listDeletedAttachments/);
  assert.match(app, /function getWorkbenchViewerState\(project, attachmentId\)/);
  assert.match(app, /data-workbench-zoom="in"/);
  assert.match(app, /project\.workbenchViewerState/);
  assert.match(app, /data-workbench-confirm-remove/);
  assert.match(app, /const referencedPromptVersions = removalPending \? \(project\.workbenchPromptVersions \|\| \[\]\)\.filter/);
  assert.match(app, /引用此资料的已生成提示词/);
  assert.match(app, /历史提示词快照不会被改写/);
  assert.match(app, /data-workbench-cancel-remove/);
  assert.match(app, /\$\{referencedAnnotationCount\} 条关联批注将保留/);
  assert.match(app, /data-workbench-restore-material/);
  assert.match(app, /data-workbench-reassociate/);
  assert.match(app, /其他资料与旧版本 · 有效且勾选的意见也会纳入提示词/);
  assert.match(app, /版本相同，可直接关联原定位/);
  assert.match(app, /版本不同，需在当前资料重新标记/);
  assert.match(app, /feedback\.createReassociatedAnnotation\(source, target\)/);
  assert.match(app, /createReassociatedAnnotation\(reassociatedFrom, current, target/);
  const feedback = fs.readFileSync(path.join(root, 'prototype', 'ppt-feedback.js'), 'utf8');
  assert.match(feedback, /reassociatedFromId: source\.id/);
  assert.match(app, /旧批注及其原始定位会保留/);
  assert.match(app, /desktopApi\.pptFeedback\.deleteAttachment\(project\.id, attachmentId\)/);
  assert.match(app, /desktopApi\.pptFeedback\.restoreAttachment\(project\.id, attachmentId\)/);
  assert.match(app, /desktopApi\.pptFeedback\.saveAnnotation/);
  assert.match(app, /批注未保存，意见仍在输入框中：\$\{material\.error\}/);
  assert.match(app, /material\.annotations\.filter/);
  assert.match(app, /data-workbench-edit-annotation/);
  assert.match(app, /data-workbench-delete-annotation/);
  assert.match(app, /data-workbench-restore-annotation/);
  assert.match(app, /status: "deleted", selected: false/);
  assert.match(app, /data-workbench-save-edit/);
  assert.match(app, /data-workbench-confirm-delete/);
  assert.doesNotMatch(app, /window\.confirm\("移除资料/);
  assert.doesNotMatch(app, /window\.prompt\("编辑这条批注意见"|window\.confirm\("撤销这条批注/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*(?:dataUrl|imageData|base64)/i);
  assert.match(app, /id="workbench-material-intent" aria-label="批注意图"/);
  assert.match(app, /workbenchAnnotationIntentLabels\[item\.intent\]/);
  assert.match(app, /workbenchAnnotationIntentLabels\[item\.intent\] \|\| "修改"/);
  assert.match(app, /feedback\.buildSelectedAnnotationPromptBatches\(annotations, material\.attachments \|\| \[\], \{/);
  assert.match(app, /promptBatchState\.batchCount/);
  assert.match(html, /data-workbench-next-prompt-batch/);
  assert.match(app, /document\.querySelector\("\[data-workbench-next-prompt-batch\]"\)/);
  assert.match(app, /feedback\.findSelectedAnnotationConflicts\(material\.annotations, attachments\)/);
  assert.match(html, /id="workbench-prompt-status" role="status"/);
  assert.match(html, /id="workbench-prompt-source-list"/);
  assert.match(app, /data-workbench-prompt-source/);
  assert.match(app, /checkbox\?\.closest\("\.workbench-material-note-row"\)\?\.scrollIntoView/);
  assert.match(app, /intent: document\.getElementById\("workbench-material-intent"\)\.value/);
  assert.match(app, /saveWorkbenchAnnotation\(project, \{ \.\.\.annotation, comment, intent \}\)/);
  assert.match(fs.readFileSync(path.join(root, 'prototype', 'ppt-feedback.js'), 'utf8'), /item\.status === "active"[\s\S]*?item\.attachmentId === attachmentId[\s\S]*?item\.contentHash === contentHash/);
});

test('网页读取器扩展返回字段不会越过快照 IPC 白名单', () => {
  const saveSnapshot = app.match(/desktopApi\.pptFeedback\.saveWebSnapshot\(project\.id,\s*\{([\s\S]*?)\}\)/)?.[1] || '';
  const fields = [...saveSnapshot.matchAll(/^\s*(title|finalUrl|fetchedAt|contentHash|html|text|incomplete):\s*snapshot\.\1,?\s*$/gm)]
    .map(match => match[1]);
  assert.deepEqual(fields, ['title', 'finalUrl', 'fetchedAt', 'contentHash', 'html', 'text', 'incomplete']);
  assert.doesNotMatch(saveSnapshot, /snapshot\s*[,}]/);
});

test('网页不可访问、疑似脚本渲染和内容换版均有明确状态', () => {
  const reader = fs.readFileSync(path.join(root, 'server', 'web-page-reader.js'), 'utf8');
  assert.match(reader, /CONTENT_TOO_SHORT[\s\S]*?可能依赖脚本渲染/);
  assert.match(app, /if \(!response\.ok\) throw new Error\(snapshot\.message \|\| '网页读取失败。'\)/);
  assert.match(app, /material\.webError \? `<p role="alert">\$\{escapeHtml\(material\.webError\)\}<\/p>`/);
  assert.match(app, /该网页的内容版本已变化[\s\S]*?旧版批注将取消勾选/);
  assert.match(app, /snapshot\.incomplete \? '已添加网页静态快照；提取文本有截断/);
});

test('完整工作区 ZIP 备份收集工作台正文和批注，导入报告附件校验失败', () => {
  assert.match(app, /async function addWorkbenchBackupAssets\(backup\)/);
  assert.match(app, /listBackupAttachments\(taskId\)/);
  assert.match(app, /listAnnotations\(taskId\)/);
  assert.match(app, /backup\.data\.workbenchAttachments = attachments/);
  assert.match(app, /backup\.data\.workbenchAnnotations = annotations/);
  assert.match(app, /workbenchAttachments \|\| \[\]\)\.map\(item => item\.archiveId\)/);
  assert.match(app, /workbenchAttachmentIds: \(state\.projects \|\| \[\]\)\.flatMap/);
  assert.match(app, /attachmentErrors/);
  assert.match(app, /JSON 缺少工作台正文/);
  assert.match(app, /工作台附件校验失败或未恢复/);
  assert.match(app, /workbenchAssets/);
  assert.match(app, /rollbackBackupImport\(transactionId\)/);
});

test('图片与 PDF 批注支持多种工具、取消绘制和事务式撤销重做', () => {
  assert.match(app, /option value="arrow"/);
  assert.match(app, /option value="path"/);
  assert.match(app, /function renderWorkbenchMaterialMarks\(annotations\)/);
  assert.match(app, /target\?\.kind === "arrow"[\s\S]*?marker-end=/);
  assert.match(app, /target\?\.kind === "path"[\s\S]*?points\.map/);
  assert.match(app, /addEventListener\("pointermove"/);
  assert.match(app, /data-workbench-draft/);
  assert.match(app, /pointercancel/);
  assert.match(app, /rawPoints\.length <= 128/);
  assert.match(app, /if \(event\.target\.id === "workbench-material-tool"\)[\s\S]*?material\.tool = \["point", "region", "arrow", "path"\]/);
  assert.match(app, /addEventListener\("pointercancel", event => \{[\s\S]*?replaceChildren\(\);\s*workbenchDrawing = null/);
  assert.match(app, /data-workbench-annotation-undo/);
  assert.match(app, /data-workbench-annotation-redo/);
  assert.match(app, /annotationHistory\.record\(previous, result\.annotation\)/);
  const saveFlow = app.match(/async function saveWorkbenchAnnotation\(project, annotation, \{ recordHistory = true, completeDraft = false \} = \{\}\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(saveFlow.indexOf('await desktopApi.pptFeedback.saveAnnotation(annotation)') < saveFlow.indexOf('material.annotationHistory.record(previous, result.annotation)'), '只有保存成功后才记入撤销历史');
  const replayFlow = app.match(/async function replayWorkbenchAnnotationHistory\(project, direction\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(replayFlow.indexOf('await desktopApi.pptFeedback.saveAnnotation(annotation)') < replayFlow.indexOf('history.commit(direction)'), '只有回放保存成功后才移动历史栈');
  const drawingSaveFlow = app.match(/addEventListener\("pointerup", async event => \{([\s\S]*?)\n  \}\);/)?.[1] || '';
  assert.match(drawingSaveFlow, /await saveWorkbenchAnnotation\(project, annotation, \{ completeDraft: true \}\)/, '绘制完成走保存确认后的统一草稿清理');
  assert.ok(saveFlow.indexOf('await desktopApi.pptFeedback.saveAnnotation(annotation)') < saveFlow.indexOf('material.newAnnotationDraft = ""'), '保存确认前保留批注意见草稿');
  assert.match(app, /replayWorkbenchAnnotationHistory\(project, "undo"\)/);
  assert.match(app, /replayWorkbenchAnnotationHistory\(project, "redo"\)/);
  assert.match(app, /data-workbench-confirm-delete/);
  assert.match(app, /data-workbench-cancel-delete/);
  assert.match(app, /批注未保存，意见仍在输入框中/);
});

test('批注工具默认收起，用户开始批注或选中 HTML 内容后按需展开', () => {
  const materialRenderer = app.match(/function renderWorkbenchMaterial\(project\) \{([\s\S]*?)\n  async function refreshWorkbenchMaterials/)?.[1] || '';
  assert.match(materialRenderer, /annotationSupported && !material\.pendingHtmlTarget/);
  assert.match(materialRenderer, /annotationSupported && material\.annotationOpen/);
  assert.match(materialRenderer, /<details class="workbench-annotation-options">/);
  assert.doesNotMatch(materialRenderer, /<details class="workbench-annotation-options" open/);
  assert.match(app, /material\.annotationOpen = !material\.annotationOpen/);
  assert.match(app, /material\.pendingHtmlTarget = selection;\s*material\.annotationOpen = true/);
  assert.match(html, /\.workbench-annotation-editor \{ display:grid/);
});

test('工作台批注按钮把当前有效意见交给写作向导，而非另造批注格式', () => {
  assert.match(html, /data-workbench-carry-writing/);
  const handoff = app.match(/document\.getElementById\("workbench-prompt-actions"\)\.addEventListener\("click", async event => \{([\s\S]*?)\n  \}\);/)?.[1] || '';
  assert.match(handoff, /getWorkbenchPromptSourceState\(material\)/);
  assert.match(handoff, /if \(promptConflicts\.length\)/);
  assert.match(handoff, /window\.WritingWorkbenchUIController\.prepareAnnotationDraft\(\{ goal, sources \}\)/);
  assert.match(handoff, /annotationSnapshot/);
});

test('旧反馈 UI 按反馈上下文函数约定传入批注数组', () => {
  const feedbackUI = fs.readFileSync(path.join(root, 'prototype', 'ppt-feedback-ui.js'), 'utf8');
  assert.match(feedbackUI, /feedback\.buildSelectedFeedbackContext\(annotations\)/);
  assert.match(feedbackUI, /const batches = context\.batches \|\| \[context\]/);
  assert.match(feedbackUI, /还剩 \$\{remaining\} 条/);
  assert.doesNotMatch(feedbackUI, /buildSelectedFeedbackContext\(\{\s*annotations/);
  assert.match(feedbackUI, /saveAnnotation\(\{ \.\.\.existing, status: "deleted", selected: false \}\)/);
  assert.match(feedbackUI, /saveAnnotation\(\{ \.\.\.existing, status: "active", selected: false \}\)/);
  assert.doesNotMatch(feedbackUI, /annotations \|\| \[\]\)\.filter\(item => item\.id !== value\)/);
  assert.doesNotMatch(feedbackUI, /typeof persistState/);
});

test('首页添加资料按钮先校验输入，再以资料模式创建任务', () => {
  const start = app.indexOf('  const ideaForm = document.getElementById("idea-form");');
  const end = app.indexOf('  function renderWorkbench(', start);
  assert.ok(start >= 0 && end > start);

  const listeners = new Map();
  const calls = [];
  let valid = false;
  let prevented = false;
  const ideaField = { value: '归纳这份资料', reportValidity: () => valid };
  const button = { addEventListener: (name, handler) => listeners.set(`button:${name}`, handler) };
  const ideaForm = {
    addEventListener: (name, handler) => listeners.set(`form:${name}`, handler),
    querySelector: selector => {
      assert.equal(selector, '[data-start-with-material]');
      return button;
    }
  };
  const context = {
    document: { getElementById: id => id === 'idea-form' ? ideaForm : ideaField },
    createProjectFromIdea: (idea, options) => calls.push({ idea, options })
  };
  vm.runInNewContext(app.slice(start, end), context);

  listeners.get('button:click')({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(calls.length, 0, '无效输入不创建任务');

  valid = true;
  prevented = false;
  listeners.get('button:click')({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(calls[0].idea, '归纳这份资料');
  assert.equal(calls[0].options.addMaterial, true);

  listeners.get('form:submit')({ preventDefault() {} });
  assert.equal(calls[1].options.addMaterial, false, '普通提交继续走对话流程');
});

test('新工作台任务在持久化后使用全局状态中的任务对象接收 Agent 回复', () => {
  const createTask = app.match(/async function createProjectFromIdea\(idea, \{ addMaterial = false \} = \{\}\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(createTask, /persist\(\);\s*const persistedProject = state\.projects\.find\(item => item\.id === project\.id\) \|\| project;\s*renderProject\(persistedProject\);\s*if \(addMaterial\) await chooseWorkbenchMaterial\(persistedProject\);\s*void requestWorkbenchAgent\(persistedProject\);/);
});

test('工作台预览页签保存在各自任务中，切换任务不串状态', () => {
  assert.match(app, /const previewMode = \["material", "prompt", "task"\]\.includes\(project\.workbenchPreviewMode\)/);
  assert.match(app, /project\.workbenchPreviewMode = \["material", "prompt", "task"\]\.includes\(button\.dataset\.workbenchPreview\) \? button\.dataset\.workbenchPreview : "material";\s*persist\(\);\s*renderWorkbench\(project\);/);
  assert.doesNotMatch(app, /let workbenchPreviewMode =/);
});

test('Office 预览不可用时说明文件未添加并允许继续对话', () => {
  const start = app.indexOf('async function chooseWorkbenchMaterial(project)');
  const end = app.indexOf('async function addWorkbenchWebSnapshot(project)', start);
  const chooseFlow = app.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(chooseFlow.indexOf('unsupported-preview') < chooseFlow.indexOf('if (!result?.attachment?.id)'));
  assert.match(chooseFlow, /文件未添加/);
  assert.match(chooseFlow, /仍可继续在对话中描述修改目标/);
});

test('Office 预览每次资料渲染只初始化一个查看器', () => {
  const start = app.indexOf('function renderWorkbenchMaterial(project)');
  const end = app.indexOf('async function refreshWorkbenchMaterials(project)', start);
  const renderFlow = app.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal((renderFlow.match(/renderWorkbenchOfficePage\(project, selected, viewer\)/g) || []).length, 1);
});

test('Office 文字批注返回原处时仅高亮唯一且页码一致的原文', () => {
  const locateFlow = app.slice(app.indexOf('const matches = await officeViewer.findText(annotation.target.exact)'), app.indexOf('} else if (editAnnotationButton)', app.indexOf('const matches = await officeViewer.findText(annotation.target.exact)')));
  assert.match(locateFlow, /matches\.length === 1 && matches\[0\]\.location\?\.\[locationKey\] === annotation\.pageIndex/);
  assert.match(locateFlow, /officeViewer\.clearFind\(\)/);
  assert.match(locateFlow, /未自动高亮，请核对/);
});

test('旧公开资料取消选择和切换项目会清理模型上下文', () => {
  assert.match(app, /state\.researchSelection = \[\.\.\.\(state\.researchSelection \|\| \[\]\), id\];\s*state\.knowledgeSelection = \[\.\.\.\(state\.knowledgeSelection \|\| \[\]\), id\];/);
  assert.match(app, /state\.researchSelection = \(state\.researchSelection \|\| \[\]\)\.filter\(selected => selected !== id\);\s*state\.knowledgeSelection = \(state\.knowledgeSelection \|\| \[\]\)\.filter\(selected => selected !== id\);/);
  assert.match(app, /if \(activeProjectId && activeProjectId !== project\.id\) \{\s*state\.knowledgeSelection = \[\];\s*selectedSearchIds\.clear\(\);\s*remoteSearchResults = \[\];\s*sendDraft = null;\s*persist\(\);\s*document\.getElementById\("send-preview"\)\.hidden = true;\s*renderSearchResults\(\);/);
});

test('资料库包含搜索、类型筛选和新增资料入口', () => {
  for (const id of [
    'knowledge-query',
    'knowledge-type',
    'knowledge-domain',
    'knowledge-stage',
    'knowledge-verification',
    'knowledge-search',
    'knowledge-search-status',
    'knowledge-entry-form',
    'knowledge-add-open',
    'knowledge-entry-type',
    'knowledge-entry-title',
    'knowledge-entry-url',
    'knowledge-entry-domains',
    'knowledge-entry-stages',
    'knowledge-entry-keywords',
    'knowledge-entry-summary',
    'knowledge-entry-patterns',
    'knowledge-entry-limitations',
    'knowledge-entry-license',
    'knowledge-entry-cancel',
    'knowledge-results',
  ]) {
    assert.match(html, new RegExp("id=[\\\"']" + id + "[\\\"']"));
  }
  assert.match(html, /本地资料库/);
  assert.match(html, /搜索本地资料/);
  assert.match(html, /公开资料入口/);
  assert.match(html, /只保存摘要、可借鉴方法和必要摘录/);

  for (const functionName of [
    'renderKnowledgeResults',
    'getKnowledgeFilters',
    'saveKnowledgeEntry',
    'selectKnowledgeEntry',
    'refreshKnowledgeView'
  ]) {
    assert.match(app, new RegExp(`function ${functionName}\\(`));
  }
  assert.match(app, /getElementById\("knowledge-search"\)\.addEventListener\("click", refreshKnowledgeView\)/);
  assert.match(app, /getElementById\("knowledge-add-open"\)\.addEventListener\("click"/);
  assert.match(app, /getElementById\("knowledge-entry-cancel"\)\.addEventListener\("click"/);
  assert.match(app, /knowledgeForm\.addEventListener\("submit", saveKnowledgeEntry\)/);
  assert.doesNotMatch(app, /getElementById\("open-knowledge-entry"\)|getElementById\("cancel-knowledge-entry"\)/);
  assert.equal([...app.matchAll(/knowledgeForm\.addEventListener\("submit", saveKnowledgeEntry\)/g)].length, 1, '资料表单只能绑定一次提交');
  assert.ok(app.includes('data-knowledge-bring="${escapeHtml(item.id)}"'), '资料应能按 ID/版本快照带入当前任务');
  assert.ok(app.includes('data-knowledge-writing="${escapeHtml(item.id)}"'), '资料详情和列表应提供带入写作入口');
  assert.match(app, /prepareLibraryDraft\(\{ source: \{ id: entry\.id, title: entry\.title, version: entry\.version \|\| 1,[\s\S]*excerpt, verificationStatus: entry\.verificationStatus/);
  assert.match(app, /entry\.contentExcerpt && `已保存摘录：[\s\S]*entry\.literature\?\.abstractExcerpt/);
});

test('资料库空态区分无资料与筛选无匹配', () => {
  assert.ok(app.includes('function renderKnowledgeResults(entries, totalCount = entries.length)'));
  assert.ok(app.includes('renderKnowledgeResults(results, entries.length)'));
  assert.ok(app.includes('const hasUnfilteredEntries = totalCount > 0'));
  assert.ok(app.includes('没有匹配的资料；换个搜索词或清空筛选。'));
  assert.ok(app.includes('资料库暂时为空；点击上方“添加资料”创建第一条资料。'));
});

test('资料库页面包含搜索、筛选和新增摘要的界面骨架', () => {
  const html = fs.readFileSync(path.join(root, 'prototype', 'index.html'), 'utf8');
  const dictionaryScriptIndex = html.indexOf('<script src="/prototype/search-dictionary.js"></script>');
  const knowledgeSearchScriptIndex = html.indexOf('<script src="/prototype/knowledge-search.js"></script>');
  assert.ok(
    dictionaryScriptIndex >= 0 && dictionaryScriptIndex < knowledgeSearchScriptIndex,
    '正式入口必须先加载 search-dictionary.js 再加载 knowledge-search.js'
  );
  for (const id of [
    'knowledge-query',
    'knowledge-type',
    'knowledge-domain',
    'knowledge-stage',
    'knowledge-search',
    'knowledge-entry-form',
    'knowledge-results',
    'knowledge-scope',
    'knowledge-export-open',
    'knowledge-import-open',
    'knowledge-bulk-actions',
    'knowledge-stats'
  ]) {
    assert.ok(html.includes('id="' + id + '"'), 'index.html 缺少 id: ' + id);
  }
  assert.ok(html.includes('资料库'), '应包含资料库入口');
  const referencesStart = html.indexOf('id="view-references"');
  const settingsStart = html.indexOf('id="view-settings"');
  const referencesView = html.slice(referencesStart, settingsStart);
  assert.equal(referencesView.includes('id="knowledge-export-open"'), false, '工作区备份入口应归入设置，而非资料库');
  assert.equal(referencesView.includes('id="knowledge-import-open"'), false, '数据恢复入口应归入设置，而非资料库');
  assert.ok(settingsStart > referencesStart, '设置应作为独立页面');
  const settingsView = html.slice(settingsStart);
  assert.ok(settingsView.includes('id="knowledge-export-open"'), '设置应提供备份导出入口');
  assert.ok(settingsView.includes('id="knowledge-import-open"'), '设置应提供备份恢复/迁移入口');
  assert.ok(settingsView.includes('id="knowledge-backup-result"'), '导入/导出结果应独立显示，不覆盖上次成功备份时间');
  for (const category of ['常用', '模型与连接', '备份与恢复', '迁移']) assert.ok(settingsView.includes(`<summary>${category}</summary>`), `设置缺少 ${category} 分类`);
  assert.ok(settingsView.includes('data-settings-open="settings-connections"'), '常用面板应可直达连接设置');
  assert.ok(html.includes('最近备份'), '设置应显示最近备份状态');
  assert.ok(html.includes('从资料库移除'), '必须区分移除资料库与删除原始数据');
  assert.ok(html.includes('删除手动资料'), '批量删除必须明确限于手动资料');
  assert.ok(html.includes('<option value="favorite">收藏</option>'), '应提供收藏筛选');
  assert.ok(html.includes('<option value="recent">最近使用</option>'), '应提供最近使用筛选');
  assert.ok(html.includes('<option value="pinned">置顶</option>'), '应提供置顶筛选');
  for (const id of ['knowledge-query', 'knowledge-type', 'knowledge-domain', 'knowledge-stage', 'knowledge-verification', 'knowledge-scope', 'knowledge-search', 'knowledge-search-status', 'knowledge-results']) {
    assert.equal([...html.matchAll(new RegExp(`id=["']${id}["']`, 'g'))].length, 1, `资料库界面不得重复渲染 ${id}`);
  }
  const app = fs.readFileSync(path.join(root, 'prototype', 'app.js'), 'utf8');
  assert.ok(app.includes('<details class="knowledge-card-details">'), '资料卡详情应默认收起');
  for (const phrase of ['当前版本', '最近复盘', '复盘次数', '适用场景', '不适用场景', '查看历史', '对比版本', '暂不复用', '删除案例']) {
    assert.match(app, new RegExp(phrase), '案例资料卡缺少版本或适用边界能力: ' + phrase);
  }
  assert.match(app, /<details class="case-history">/, '案例历史默认应折叠');
  assert.match(app, /data-case-compare/, '案例应提供版本对比入口');
  assert.match(app, /data-case-delete/, '案例应提供删除入口');
  assert.match(app, /createSafetyBackup\(\)/, '删除案例前必须创建安全备份');
  assert.match(app, /deleteCase\(state, caseId\)/, '删除案例必须调用 storage.deleteCase');
  assert.match(app, /deferCaseReuseState\(state, caseId\)/, '暂不复用必须更新案例持久化状态');
  assert.match(app, /filter\(item => !item\.hiddenAt\)/, '发送上下文必须排除已隐藏资料卡');
  assert.match(app, /\["knowledge-scope", "knowledge-type", "knowledge-domain", "knowledge-stage", "knowledge-verification", "case-filter", "case-domain", "case-project"\]\.forEach\(id => document\.getElementById\(id\)\.addEventListener\("change", refreshKnowledgeView\)\)/, '资料范围筛选变更必须立即刷新资料视图');
  assert.ok(app.includes('data-knowledge-edit'), '手动资料应提供编辑入口');
  assert.ok(app.includes('data-knowledge-source'), '派生资料应提供编辑原始来源入口');
  assert.ok(app.includes('data-knowledge-edit'), '手动资料编辑按钮必须存在');
  assert.ok(app.includes('beginKnowledgeEntryEdit(entry)'), '手动资料编辑按钮必须绑定可执行事件');
  assert.ok(app.includes('getKnowledgeEntryDependencies(state, entry.id)'), '编辑/删除前必须列出工作台和提示词历史的引用');
  assert.match(app, /const manualEntry = !item\.linkedCaseId && \(item\.sourceKind \|\| "manual"\) === "manual"/, '资料库里的手动条目必须能编辑，即使来源索引没有附加 source 字段');
  assert.ok(app.includes('deleteKnowledgeEntriesWithConfirmation([button.dataset.knowledgeDelete])'), '手动资料永久删除必须经过依赖确认与安全备份');
  assert.ok(app.includes('data-knowledge-restore'), '最近移除的资料必须提供恢复入口');
  assert.ok(app.includes('data-knowledge-source'), '派生资料来源按钮必须存在');
  assert.ok(app.includes('handleKnowledgeSourceAction(entry)'), '派生资料来源按钮必须绑定可执行事件');
  const searchResult = knowledgeSearch.searchKnowledge([
    { id: 'smoke-entry', title: '提示词复核', summary: '检查验收标准', keywords: ['review', '验收'] }
  ], 'review');
  assert.deepEqual(searchResult.map(item => item.id), ['smoke-entry']);
  assert.ok(searchResult[0].matchedFields.includes('keywords'), '搜索结果应保留命中字段解释');
  assert.ok(knowledgeSearch.suggestSearchTerms('不存在的复核词', [{ title: '提示词复核', keywords: ['review'] }]).length <= 3, '无结果搜索应提供有界建议');
  assert.ok(app.includes('knowledgeForm.dataset.editId = entry.id'), '手动资料编辑必须设置 edit id');
  assert.match(app, /当前来源暂不支持直接编辑，资料卡和原始项目均未删除/, '不可编辑来源必须给出明确提示');
  assert.ok(html.includes('不要粘贴完整仓库'), '应提示不要粘贴完整仓库');
  for (const copy of [
    '本地资料库',
    '已确认案例',
    '搜索本地资料',
    '选择的资料只会以摘要、可借鉴方法和来源进入当前提示词',
    '热门或被收录不代表已验证',
  ]) {
    assert.ok(html.includes(copy), '资料库页面缺少用户可见文案: ' + copy);
  }
});

test('发送面板接入安全预览并保留编辑与失败状态契约', () => {
  const html = fs.readFileSync(path.join(root, 'prototype', 'index.html'), 'utf8');
  const safetyScriptIndex = html.indexOf('<script src="/prototype/send-safety.js"></script>');
  const appScriptIndex = html.indexOf('<script src="/prototype/app.js"></script>');
  assert.ok(safetyScriptIndex >= 0 && safetyScriptIndex < appScriptIndex, 'send-safety.js 必须在 app.js 前加载');
  for (const id of [
    'send-preview-stats',
    'send-preview-segments',
    'send-preview-findings',
    'send-preview-confirmation'
  ]) {
    assert.ok(html.includes('id="' + id + '"'), '发送面板缺少安全预览控件: ' + id);
  }
  assert.match(html, /本地规则检测明显敏感信息.*不能保证识别所有凭证/);
  const app = fs.readFileSync(path.join(root, 'prototype', 'app.js'), 'utf8');
  assert.ok(app.includes('window.ForwardStepSendSafety'), 'app.js 必须读取正式安全预览模块');
  assert.ok(app.includes('buildSendReport'), '发送面板必须生成安全报告');
  assert.ok(app.includes('sendDraft.renderedText = event.target.value'), '编辑文本必须保留为实际发送文本');
  assert.ok(app.includes('renderSendPanel()'), '编辑和删除资料后必须重新渲染安全统计');
  assert.match(app, /function buildSendContent\(\)[\s\S]*return \{ text: fullText, segments \}/, '安全报告和发送文本必须来自同一分段构造');
  assert.match(app, /syncUneditedSendText\(\)/, '资料变更后必须同步重建未编辑文本');
  assert.match(app, /getElementById\("send-preview-confirm"\)/);
  assert.match(app, /sendButton\.disabled\s*=\s*!serviceConfig\.model\?\.configured\s*\|\|/);
  assert.match(app, /sendDraft\.confirmedRisk/);
  assert.match(app, /if \(succeeded\) closeSendPanel\(\{ cancelled: false \}\);/);
  assert.match(app, /近似 token/);
  assert.match(app, /高风险/);
  assert.match(app, /确认高风险内容后再发送/);
});

test('MVP 主流程可在静态边界串联，不等同于真实 Electron UI 验收', () => {
  const project = {
    idea: '把团队周报整理成可复用的工作流程',
    goalSummary: '形成一套可检查、可交接的周报流程',
    domain: '产品与工作',
    currentState: '已有零散周报和会议记录',
    successCriteria: ['新成员能按流程完成周报', '关键事实和待办不丢失'],
    preserveItems: ['事实依据', '未完成事项', '负责人和截止时间'],
    assumptions: ['先用一周样例验证'],
    missingInfo: ['团队是否已有固定模板'],
    methodGuidance: '先确认目标、输入、限制和验收标准，再按步骤交接',
    currentStep: '确定周报字段和验收方式',
    nextAction: '列出最小字段并找一份真实样例核对'
  };

  const goalPrompt = buildGoalPrompt(project);
  assert.match(goalPrompt, /目标摘要草稿/);
  assert.match(goalPrompt, /暂时假设/);
  assert.match(goalPrompt, /遗漏、相互矛盾、可能错误/);
  assert.match(goalPrompt, /不要直接改文章、做 PPT、写代码/);

  const stagePrompt = buildStagePrompt(project, {
    title: '确定周报字段和验收方式',
    description: '把已有材料压缩成最小可执行字段',
    deliverable: '字段清单和检查方式'
  });
  assert.match(stagePrompt, /当前步骤/);
  assert.match(stagePrompt, /只生成一条我可以复制给其他 AI 的本步指令提示词/);

  const referenceSummary = appendReferenceContext(stagePrompt, [{
    title: '公开流程参考',
    url: 'https://example.com/reference',
    summary: '只借鉴字段组织方式。',
    borrowablePatterns: '先定义输入和验收，再做小样本验证。',
    fullText: '这段不应进入发送上下文的长篇原文。'
  }]);
  assert.match(referenceSummary, /公开流程参考/);
  assert.match(referenceSummary, /只借鉴字段组织方式/);
  assert.doesNotMatch(referenceSummary, /这段不应进入发送上下文的长篇原文/);

  const reviewPrompt = buildCaseReviewPrompt(project, {
    before: '周报格式不统一，待办常被遗漏。',
    externalResult: '外部 AI 给出统一模板，但删除了负责人字段。',
    userFeedback: '希望保留负责人和截止时间。',
    dimensions: ['字段完整性', '事实保留']
  });
  assert.match(reviewPrompt, /前后对照/);
  assert.match(reviewPrompt, /具体片段、变化、数据或可观察行为/);
  assert.match(reviewPrompt, /成功”“失败”或“待验证/);
  assert.match(reviewPrompt, /下一条修正提示词/);

  const caseData = {
    id: 'smoke-case-1',
    projectId: 'smoke-project-1',
    domain: project.domain,
    taskType: '流程整理',
    goal: project.goalSummary,
    preserveItems: project.preserveItems,
    before: '格式不统一',
    after: '统一模板但缺少负责人字段',
    externalResult: '统一模板但缺少负责人字段',
    userFeedback: '必须保留负责人和截止时间',
    dimensions: ['字段完整性'],
    evidence: ['模板字段列表中没有负责人'],
    suggestedLabel: '待验证',
    status: '待验证',
    lessons: '先核对保留项再确认模板',
    nextPrompt: '保留负责人和截止时间后重新生成模板建议'
  };
  assert.equal(confirmCase(createEmptyState(), caseData, false).cases.length, 0);
  assert.equal(confirmCase(createEmptyState(), caseData, true).cases.length, 1);

  const manualSearch = createSearchStub('周报字段验收方法');
  assert.equal(manualSearch.completed, false);
  assert.match(manualSearch.instruction, /手动搜索/);
});

test('入口文件和本地服务的无模型/无搜索降级可验证', async t => {
  assert.ok(fs.existsSync(path.join(root, 'prototype', 'index.html')));
  assert.ok(fs.existsSync(path.join(root, 'electron', 'main.js')));
  assert.ok(fs.existsSync(path.join(root, 'electron', 'preload.js')));

  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    config: { model: {}, search: {} }
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const pageResponse = await fetch(`${baseUrl}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /向前一步/);

  const config = await (await fetch(`${baseUrl}/api/config`)).json();
  assert.equal(config.model.configured, false);
  assert.equal(config.search.configured, false);

  const modelResponse = await fetch(`${baseUrl}/api/model`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'smoke' }] })
  });
  const model = await modelResponse.json();
  assert.equal(modelResponse.status, 200);
  assert.equal(model.code, 'MODEL_NOT_CONFIGURED');
  assert.match(model.message, /复制提示词/);

  const searchResponse = await fetch(`${baseUrl}/api/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'smoke' })
  });
  const search = await searchResponse.json();
  assert.equal(searchResponse.status, 200);
  assert.equal(search.code, 'SEARCH_NOT_CONFIGURED');
  assert.deepEqual(search.results, []);
  assert.match(search.message, /复制搜索指令/);
});


test('浏览器导入入口先确认安全备份，再打开文件选择并导入', () => {
  const app = fs.readFileSync(path.join(root, 'prototype', 'app.js'), 'utf8');
  const importStart = app.indexOf('async function importKnowledgeBackup()');
  const changeStart = app.indexOf('document.getElementById("knowledge-import-file").addEventListener');
  const importBlock = app.slice(importStart, changeStart);
  assert.ok(importBlock.indexOf('await createSafetyBackup();') < importBlock.indexOf('.click();'), '必须先完成安全备份确认再打开文件选择器');
  assert.ok(importBlock.includes('browserImportGate.confirmed = true;'), '确认成功后必须显式放行');
  assert.ok(importBlock.includes('document.getElementById("knowledge-import-file").click();'), '确认后才打开文件选择器');
  assert.ok(importBlock.indexOf('if (!desktopApi)') < importBlock.indexOf('await createSafetyBackup();'), '桌面模式不应走浏览器安全门禁');
  assert.ok(app.includes('consumeBrowserImportGate(importGate);'), '文件 change 入口必须保留令牌防御检查');
  assert.match(app, /下载已触发，请确认你已看到并保存安全备份文件/);
  assert.match(app, /未确认已保存安全备份/);
  assert.ok(app.includes('browserImportGate = null;'), '令牌必须在 change 前后清理，防止重复导入');
  assert.ok(app.indexOf('consumeBrowserImportGate(importGate);') < app.indexOf('await importBackupContent(await file.text());'), '未通过令牌检查不能读取文件或调用导入');
  assert.match(app, /await showBackupImportPreview\(backup, summary, mergePreview, archiveStage\)/, '写入前必须展示备份影响预览');
  assert.ok(app.includes('取消导入'), '导入预览应提供真实取消动作');
  assert.ok(app.includes('discardBackupImport?.(archiveStage.stageId)'), '取消 ZIP 预览时清理暂存数据');
  assert.doesNotMatch(app, /点击“确定”替换，取消则合并/, '取消不能被当成合并确认');
});

test('社媒研究入口加载 UI 并贯通计划、平台准备、结果和报告区域', () => {
  const html = fs.readFileSync(path.join(root, 'prototype', 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'prototype', 'social-research-ui.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'prototype', 'app.js'), 'utf8');
  for (const id of [
    'view-social-research', 'social-research-entry', 'social-research-plan-confirm',
    'social-platform-preparation', 'social-research-status', 'social-research-results',
    'social-research-save-selection', 'social-research-report'
  ]) assert.ok(html.includes(`id="${id}"`), `研究工作台缺少 ${id}`);
  assert.ok(html.indexOf('src="/prototype/social-research-ui.js"') < html.indexOf('src="/prototype/app.js"'));
  assert.match(app, /createSocialResearchCoordinator\(/);
  assert.match(app, /ForwardStepSocialResearchUI\.createSocialResearchUI\(/);
  assert.match(ui, /data-report-result/);
  assert.match(ui, /data-save-result/);
});

test('社媒研究工作区备份可恢复摘要报告和附件元数据且不带凭证', () => {
  const { createBackup, replaceState } = require('../prototype/workspace-backup.js');
  const state = {
    researchTasks: [{
      id: 'smoke-research-task',
      topic: '用户对产品的反馈',
      results: [{ id: 'smoke-result', summary: '用户普遍反馈上手困难。', url: 'https://example.test/post' }],
      report: { coreFindings: ['上手成本是主要问题。'], resultIds: ['smoke-result'] },
      apiKey: 'task-secret'
    }],
    platformConnections: {
      reddit: {
        platform: 'reddit', status: 'ready', profilePath: 'C:/private/profile',
        storagePath: 'C:/private/storage', profileDirectory: 'C:/private/profile-directory',
        cookies: ['cookie-secret'], sessionToken: 'session-secret', apiKey: 'api-secret', password: 'password-secret'
      }
    },
    researchAttachments: [{
      id: 'smoke-attachment', type: 'document', size: 128, sourceResultId: 'smoke-result',
      relativePath: 'research/smoke.pdf', savedAt: '2026-10-19T08:00:00.000Z', password: 'attachment-secret'
    }]
  };

  const backup = createBackup(state, { scope: 'workspace', now: '2026-10-19T08:00:00.000Z' });
  const restored = replaceState({}, JSON.parse(JSON.stringify(backup)));
  const serialized = JSON.stringify(backup);

  assert.equal(restored.researchTasks[0].results[0].summary, '用户普遍反馈上手困难。');
  assert.deepEqual(restored.researchTasks[0].report.coreFindings, ['上手成本是主要问题。']);
  assert.deepEqual(restored.researchTasks[0].report.resultIds, ['smoke-result']);
  assert.deepEqual(restored.researchAttachments[0], {
    id: 'smoke-attachment', type: 'document', size: 128, sourceResultId: 'smoke-result',
    relativePath: 'research/smoke.pdf', savedAt: '2026-10-19T08:00:00.000Z'
  });
  assert.equal(restored.platformConnections.reddit.status, 'needs-recheck');
  const connectionMetadata = restored.platformConnections.reddit;
  for (const pathField of ['profilePath', 'storagePath', 'profileDirectory']) {
    assert.equal(Object.hasOwn(connectionMetadata, pathField), false, `连接备份不应包含 ${pathField}`);
    assert.equal(serialized.includes(pathField), false, `序列化备份不应包含 ${pathField}`);
  }
  for (const secret of ['task-secret', 'C:/private/profile', 'C:/private/storage', 'C:/private/profile-directory', 'cookie-secret', 'session-secret', 'api-secret', 'password-secret', 'attachment-secret']) {
    assert.equal(serialized.includes(secret), false, `备份不应包含 ${secret}`);
  }
});

test('PPT 规划工作台从提示词 Agent 入口加载并保持文件输出边界', () => {
  const sceneUi = fs.readFileSync(path.join(root, 'prototype', 'ppt-scene-ui.js'), 'utf8');
  const retrieverIndex = html.indexOf('src="/prototype/retriever.js"');
  const schemaIndex = html.indexOf('src="/prototype/ppt-scene-schema.js"');
  const workflowIndex = html.indexOf('src="/prototype/ppt-scene-workflow.js"');
  const promptsIndex = html.indexOf('src="/prototype/ppt-scene-prompts.js"');
  const coordinatorIndex = html.indexOf('src="/prototype/ppt-scene-coordinator.js"');
  const uiIndex = html.indexOf('src="/prototype/ppt-scene-ui.js"');
  const appIndex = html.indexOf('src="/prototype/app.js"');
  assert.ok(schemaIndex >= 0 && schemaIndex < coordinatorIndex, 'PPT schema 必须先于 coordinator 加载');
  assert.ok(retrieverIndex >= 0 && retrieverIndex < coordinatorIndex, '资料检索器必须先于 coordinator 加载');
  assert.ok(workflowIndex >= 0 && workflowIndex < coordinatorIndex, 'PPT workflow 必须先于 coordinator 加载');
  assert.ok(promptsIndex >= 0 && promptsIndex < coordinatorIndex, 'PPT prompts 必须先于 coordinator 加载');
  assert.ok(coordinatorIndex < uiIndex && uiIndex < appIndex, 'coordinator、UI、app 必须按顺序加载');
  assert.match(html, /id="ppt-scene-root"/);
  assert.match(app, /createPptSceneCoordinator\(/);
  assert.match(app, /createPptSceneUI\(/);
  assert.match(app, /searchWeb/);
  assert.match(app, /searchLocalSources/);
  assert.match(app, /createSocialResearchPlan/);
  assert.match(sceneUi, /normalizePptScene/);
  assert.doesNotMatch(app, /writeFile|saveAs\(|createPresentation|pptxgen/i, '规划工作台不能写入最终演示文稿或成品文件');
});


test('写作、提示词Agent与学术论文分别挂载到独立页面', () => {
  assert.equal((html.match(/id="writing-workbench-root"/g) || []).length, 1);
  const promptView = html.indexOf('id="view-prompt-agent"');
  const writingView = html.indexOf('id="view-article"');
  const academicView = html.indexOf('id="view-academic-workbench"');
  const promptRoot = html.indexOf('id="prompt-agent-root"');
  const writingRoot = html.indexOf('id="writing-workbench-root"');
  const academicRoot = html.indexOf('id="academic-literature-root"');
  const academicReviewRoot = html.indexOf('id="academic-review-root"');
  const academicPublishingRoot = html.indexOf('id="academic-publishing-root"');
  assert.ok(promptView < promptRoot && promptRoot < writingView);
  assert.ok(writingView < writingRoot && writingRoot < academicView);
  assert.ok(academicView < academicRoot && academicRoot < academicReviewRoot && academicReviewRoot < academicPublishingRoot);
  assert.doesNotMatch(html, /id="article-form"/);
  assert.doesNotMatch(app, /currentArticleReviewCase|resetArticleReviewResult|article-original|article-revised/);
  const scripts = ['writing-workbench-schema', 'writing-workbench-prompts', 'writing-workbench-coordinator', 'writing-workbench-ui', 'app'];
  const positions = scripts.map(name => html.indexOf('src="/prototype/' + name + '.js"'));
  assert.ok(positions.every((pos, i) => pos >= 0 && (i === 0 || pos > positions[i - 1])));
  for (const scene of ['task', 'ppt']) assert.ok(html.includes('data-agent-scene="' + scene + '"'));
  assert.doesNotMatch(html, /data-agent-scene="writing"/);
  assert.match(html, /#view-prompt-agent \[hidden\]\s*\{\s*display:\s*none/);
});

test('写作工作台独立于提示词Agent的任务与PPT场景', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  await f.event('nav-article');
  assert.notEqual(f.mount.hidden, true);
  assert.match(f.element('breadcrumb').textContent, /写作工作台/);
  await f.event('scene-ppt');
  assert.equal(f.element('ppt-scene-root').hidden, false);
  await f.event('scene-task');
  assert.equal(f.element('prompt-agent-root').hidden, false);
  assert.equal(f.element('ppt-scene-root').hidden, true);
  assert.notEqual(f.mount.hidden, true, 'Agent 场景切换不隐藏独立写作页内容');
});

test('长手册改写闭环将原文与多份辅助材料分开并生成附原件的选章提示词', async () => {
  const { createWritingApp } = require('./helpers/writing-app.js');
  const f = createWritingApp();
  await f.change('writing-wizard-mode-rewrite', 'rewrite');
  await f.input('writing-goal', '保留事实，优化操作手册表达');
  await f.change('writing-source-file', [{ name: '操作手册.md', size: 100, lastModified: 1,
    text: async () => '# 安装步骤\n全文唯一原文哨兵。\n'.repeat(3) }]);
  await f.change('writing-source-processing-scope', 'sections');
  const sectionId = f.mount.querySelectorAll('[data-source-section]')[0]?.id;
  assert.ok(sectionId, '应提取出可选章节');
  await f.change(sectionId, true);

  const files = Array.from({ length: 4 }, (_, index) => {
    const content = `export const reference${index} = '参考摘录${index}';`;
    const bytes = Uint8Array.from(Buffer.from(content));
    return { name: `reference-${index}.js`, webkitRelativePath: `repo/src/reference-${index}.js`, size: bytes.length,
      arrayBuffer: async () => bytes.buffer };
  });
  await f.change('writing-material-folder', files);
  const candidates = f.mount.querySelectorAll('[data-wizard-material]');
  assert.equal(candidates.length, 4);
  for (let index = 0; index < 4; index++) await f.changeData('wizardMaterial', index, true);
  assert.equal(f.mount.querySelectorAll('[data-wizard-material]').filter(item => item.disabled).length, 0,
    '材料不按文件份数禁用');

  let analyzedInput;
  f.coordinator.analyzeTask = async input => {
    analyzedInput = input;
    return { genre: 'article', taskType: 'revision', reason: '按章节改写手册' };
  };
  await f.click('wizard-analyze');
  assert.equal(analyzedInput.sourceDocument.preview.length <= 8000, true);
  assert.equal(analyzedInput.materials.length, 4);
  assert.ok(analyzedInput.materials.every(item => item.excerpt));
  await f.change('writing-wizard-genre', 'article');
  await f.change('writing-wizard-task-type', 'revision');
  await f.click('wizard-confirm');
  const round = f.coordinator.getWorkspace(f.coordinator.listArticles()[0].id).rounds.at(-1);
  assert.match(round.prompt, /请在当前 AI 对话中附上该文件/);
  assert.match(round.prompt, /只处理以下章节/);
  assert.match(round.prompt, /安装步骤/);
  assert.doesNotMatch(round.prompt, /全文唯一原文哨兵/);
  assert.equal(round.sourceDocument.selectedSectionIds.length, 1);
});
