const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const app = fs.readFileSync(process.env.WORKBENCH_APP_SOURCE || path.join(__dirname, '../prototype/app.js'), 'utf8');
const saveSource = app.match(/  async function saveWorkbenchAnnotation\(project, annotation,[\s\S]*?\n  }/)[0];

test('其他资料上的有效批注保持原定位，只有过期或移除的来源提示重新标记', () => {
  const current = { id: 'html', kind: 'html', sha256: 'html-hash' };
  const original = { id: 'pdf', kind: 'pdf', sha256: 'pdf-hash', displayName: '原 PDF' };
  const context = {
    selected: current,
    attachments: [current, original],
    removedAttachments: [{ id: 'removed', sha256: 'old-hash', displayName: '已移除资料' }],
    material: { annotations: [
      { id: 'valid', attachmentId: 'pdf', contentHash: 'pdf-hash', status: 'active', comment: '有效意见' },
      { id: 'stale', attachmentId: 'pdf', contentHash: 'old-hash', status: 'stale', comment: '旧版意见' },
      { id: 'missing', attachmentId: 'removed', contentHash: 'old-hash', status: 'active', comment: '已移除意见' },
      { id: 'deleted', attachmentId: 'pdf', contentHash: 'pdf-hash', status: 'deleted', comment: '撤销意见' }
    ] },
    feedback: require('../prototype/ppt-feedback.js'),
    workbenchAnnotationIntentLabels: { modify: '修改' },
    escapeHtml: value => String(value)
  };
  const start = app.indexOf('    const inheritedAnnotations =');
  const end = app.indexOf('    const conflictingAnnotationIds =', start);
  vm.runInNewContext(app.slice(start, end) + '; this.markup = inheritedAnnotationList;', context);
  const rows = context.markup.split('<div class="workbench-material-note-row">').slice(1);
  assert.match(rows[0], /原资料定位有效/);
  assert.match(rows[0], /data-workbench-attachment="pdf"/);
  assert.doesNotMatch(rows[0], /版本不同|原资料不可用/);
  assert.match(rows[1], /重新标记/);
  assert.doesNotMatch(rows[1], /原资料定位有效|data-workbench-attachment=/);
  assert.match(rows[2], /重新标记/);
  assert.doesNotMatch(rows[2], /原资料定位有效|data-workbench-attachment=/);
  assert.doesNotMatch(context.markup, /撤销意见/);
});

test('资料刷新在保存替换状态对象后，把附件与提示词更新写入当前任务', async () => {
  const refreshSource = app.slice(app.indexOf('  async function refreshWorkbenchMaterials('), app.indexOf('  function scheduleWorkbenchDraftSave('));
  const material = { attachments: [], annotations: [] };
  const context = {
    window: { addEventListener() {} },
    document: { addEventListener() {} },
    state: { projects: [{ id: 'task', workbenchAttachmentId: '' }] },
    activeProjectId: 'task',
    getWorkbenchMaterialState: () => material,
    desktopApi: { pptFeedback: {
      listAttachments: async () => ({ attachments: [{ id: 'office', kind: 'docx', sha256: 'hash' }] }),
      listAnnotations: async () => ({ annotations: [{ id: 'note', comment: '保留上下文' }] }),
      listDeletedAttachments: async () => ({ attachments: [] })
    } },
    loadWorkbenchOfficeModel: async () => {},
    disposeWorkbenchOfficeModel() {},
    renderWorkbench: () => {}
  };
  vm.createContext(context);
  vm.runInContext('function persist() { state = JSON.parse(JSON.stringify(state)); }', context);
  const helpers = app.indexOf('  function getWorkbenchOpenAttachments(');
  if (helpers >= 0) vm.runInContext(app.slice(helpers, app.indexOf('  function renderWorkbenchMaterial(', helpers)), context);
  vm.runInContext(refreshSource + '; this.refresh = refreshWorkbenchMaterials;', context);
  const stale = { id: 'task', workbenchAttachmentId: 'removed' };
  await context.refresh(stale);
  assert.equal(context.state.projects[0].workbenchAttachmentId, 'office');
  assert.deepEqual(Array.from(context.state.projects[0].workbenchAttachmentIds || []), ['office']);
  assert.match(app.slice(app.indexOf('  function renderWorkbench(project)'), app.indexOf('  function renderWorkbench(project)') + 220), /project = state\.projects\.find/);
});

for (const kind of ['Html', 'Pdf', 'Office']) {
  test(kind + ' 批注保存确认后先清理草稿再刷新，避免重复保存', async () => {
    const material = {
      annotations: [], pendingHtmlTarget: { exact: 'HTML' }, pendingPdfTarget: { exact: 'PDF' },
      pendingOfficeTarget: { exact: 'Office' }, pendingReassociationId: 'old-note', newAnnotationDraft: '保留表格',
      annotationHistory: { record() {} }
    };
    let rendered;
    const context = {
      getWorkbenchMaterialState: () => material,
      desktopApi: { pptFeedback: { saveAnnotation: async annotation => ({ status: 'ok', annotation: { ...annotation, id: 'saved' } }) } },
      refreshWorkbenchMaterials: async () => { rendered = JSON.parse(JSON.stringify(material)); }
    };
    vm.runInNewContext(saveSource + '; this.save = saveWorkbenchAnnotation;', context);
    await context.save({ id: 'task' }, { comment: '保留表格' }, { completeDraft: true });
    assert.equal(rendered['pending' + kind + 'Target'], null);
    assert.equal(rendered.newAnnotationDraft, '');
    assert.equal(rendered.pendingReassociationId, '');
  });
}

test('批注保存失败保留选区和意见，不推进历史或刷新', async () => {
  const pending = { exact: '选中文字' };
  const material = { annotations: [], pendingOfficeTarget: pending, newAnnotationDraft: '意见', annotationHistory: { record() { assert.fail('失败时不应写历史'); } } };
  const context = {
    getWorkbenchMaterialState: () => material,
    desktopApi: { pptFeedback: { saveAnnotation: async () => ({ status: 'error' }) } },
    refreshWorkbenchMaterials: async () => assert.fail('失败时不应刷新')
  };
  vm.runInNewContext(saveSource + '; this.save = saveWorkbenchAnnotation;', context);
  await assert.rejects(context.save({ id: 'task' }, {}, { completeDraft: true }), /批注保存未确认成功/);
  assert.equal(material.pendingOfficeTarget, pending);
  assert.equal(material.newAnnotationDraft, '意见');
});

test('Office 鼠标拖选完成前不重建查看器，松开后接收完整原文', async () => {
  const renderSource = app.slice(app.indexOf('  function renderWorkbenchOfficePage('), app.indexOf('  function updateWorkbenchOfficeControls('));
  const host = new EventTarget();
  const document = new EventTarget();
  const canvas = { parentElement: host };
  const material = { officeModel: {}, officeAttachmentId: 'office', officeContentHash: 'hash', officePageCount: 1, annotationOpen: false };
  const attachment = { id: 'office', sha256: 'hash', kind: 'pptx' };
  const project = { id: 'task', workbenchAttachmentId: 'office' };
  const fullSelection = { pageIndex: 0, target: { kind: 'text', exact: '表格兼容性验收' } };
  let renders = 0;
  let options;
  let selectedModel;
  const viewer = { canvasElement: canvas, setScale: async () => {}, goToSlide: async () => {}, getSelectionContext: () => fullSelection };
  document.getElementById = id => id === 'workbench-material-view' ? { querySelector: selector => selector === '#workbench-office-canvas' ? canvas : { setAttribute() {} } } : { focus() {} };
  const context = {
    document, AbortController,
    getWorkbenchMaterialState: () => material,
    getActiveProject: () => project,
    disposeWorkbenchOfficeViewer: () => {},
    window: { ForwardStepOoxmlModules: { pptx: { PptxViewer: { fromPresentation: (canvas, model, opts) => { options = opts; return viewer; } } } } },
    officeSelectionTarget: (attachment, viewer, selection, model) => { selectedModel = model; return selection; },
    renderWorkbenchMaterial: () => { renders++; },
    getWorkbenchViewerState: () => ({ pageIndex: 0 }),
    workbenchOfficeAnnotationLayer() {}, updateWorkbenchOfficeControls() {}, updateWorkbenchFit: async () => {}, persist() {}, toast() {}
  };
  vm.runInNewContext(renderSource + '; this.render = renderWorkbenchOfficePage;', context);
  context.render(project, attachment, { pageIndex: 0, zoom: 1 });
  host.dispatchEvent(new Event('pointerdown'));
  options.onSelectionContextChange({ pageIndex: 0, target: { kind: 'text', exact: '表' } });
  assert.equal(renders, 0);
  document.dispatchEvent(new Event('pointerup'));
  assert.equal(renders, 1);
  assert.equal(selectedModel, material.officeModel, 'Office 元素框按当前模型页尺寸归一化');
  assert.equal(material.pendingOfficeTarget.target.exact, '表格兼容性验收');
  assert.equal(material.tool, 'text');
  const elementSelection = { pageIndex: 0, target: { kind: 'element', selector: 'ooxml:pptx:page:1:shape:shape-7:table', excerpt: '季度收入', bounds: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 } } };
  options.onSelectionContextChange(elementSelection);
  assert.equal(renders, 2);
  assert.equal(material.pendingOfficeTarget.target, elementSelection.target);
  material.officeSelectionAbortController.abort();
  host.dispatchEvent(new Event('pointerdown'));
  document.dispatchEvent(new Event('pointerup'));
  assert.equal(renders, 2, '销毁查看器后不再响应原来的鼠标监听');
  material.tool = 'path';
  options.onSelectionContextChange(fullSelection);
  assert.equal(renders, 2, '绘制模式不被 Office 文字选区抢走');
  await new Promise(resolve => setImmediate(resolve));
});
test('Office SVG 批注层覆盖时仍恢复文字拖选，普通点击和原生选区不覆盖', async () => {
  const renderSource = app.slice(app.indexOf('  function renderWorkbenchOfficePage('), app.indexOf('  function updateWorkbenchOfficeControls('));
  const host = new EventTarget();
  const document = new EventTarget();
  const node = { textContent: 'SECOND ' };
  const run = { contains: item => item === node };
  node.parentElement = { closest: () => run };
  host.closest = () => null;
  const canvas = { parentElement: host };
  const material = { officeModel: {}, officeAttachmentId: 'office', officeContentHash: 'hash', officePageCount: 1, annotationOpen: false };
  const project = { id: 'task', workbenchAttachmentId: 'office' };
  const attachment = { id: 'office', sha256: 'hash', kind: 'docx' };
  const selection = { text: '' };
  const window = { getSelection: () => ({ toString: () => selection.text, removeAllRanges() { selection.text = ''; }, addRange(range) {
    selection.text = range.first.textContent.slice(range.start, range.first === range.last ? range.end : undefined)
      + (range.first === range.last ? '' : range.last.textContent.slice(0, range.end));
  } }),
    ForwardStepOoxmlModules: { docx: { DocxViewer: { fromDocument: () => viewer } } } };
  const viewer = { canvasElement: canvas, setScale: async () => {}, goToPage: async () => {},
    getSelectionContext: () => selection.text ? { pageIndex: 0, target: { kind: 'text', exact: selection.text } } : null };
  document.caretPositionFromPoint = x => ({ offsetNode: node, offset: Math.floor(x / 5) });
  document.createRange = () => ({ setStart(item, offset) { this.first = item; this.start = offset; }, setEnd(item, offset) { this.last = item; this.end = offset; } });
  document.getElementById = id => id === 'workbench-material-view'
    ? { querySelector: selector => selector === '#workbench-office-canvas' ? canvas : { setAttribute() {} } }
    : { focus() {} };
  let renders = 0;
  const context = { document, window, AbortController, Node: { DOCUMENT_POSITION_PRECEDING: 2 }, getWorkbenchMaterialState: () => material,
    disposeWorkbenchOfficeViewer() {}, getActiveProject: () => null, officeSelectionTarget: (item, currentViewer, value) => value,
    renderWorkbenchMaterial() { renders++; }, getWorkbenchViewerState: () => ({ pageIndex: 0 }),
    workbenchOfficeAnnotationLayer() {}, updateWorkbenchOfficeControls() {}, updateWorkbenchFit: async () => {}, persist() {}, toast() {} };
  vm.runInNewContext(renderSource + '; this.render = renderWorkbenchOfficePage;', context);
  context.render(project, attachment, { pageIndex: 0, zoom: 1 });
  const pointer = (type, x) => Object.assign(new Event(type), { clientX: x, clientY: 5 });
  host.dispatchEvent(pointer('pointerdown', 0));
  document.dispatchEvent(pointer('pointerup', 0));
  assert.equal(renders, 0, '同点点击不补建文字选区');
  host.dispatchEvent(pointer('pointerdown', 0));
  document.dispatchEvent(pointer('pointerup', 16));
  assert.equal(material.pendingOfficeTarget.target.exact, 'SEC');
  assert.equal(renders, 1);
  selection.text = 'native';
  host.dispatchEvent(pointer('pointerdown', 0));
  document.dispatchEvent(pointer('pointerup', 16));
  assert.equal(material.pendingOfficeTarget.target.exact, 'native');
  assert.equal(renders, 2);
  selection.text = '';
  const surface = {};
  const otherSurface = {};
  const secondRun = { closest: () => surface, contains: item => item === secondNode };
  const secondNode = { textContent: 'PAGE', parentElement: { closest: () => secondRun }, compareDocumentPosition: () => 2 };
  node.compareDocumentPosition = () => 4;
  run.closest = () => surface;
  node.parentElement = { closest: () => run };
  document.caretPositionFromPoint = x => x >= 20
    ? { offsetNode: secondNode, offset: Math.floor((x - 20) / 5) }
    : { offsetNode: node, offset: Math.floor(x / 5) };
  host.dispatchEvent(pointer('pointerdown', 0));
  document.dispatchEvent(pointer('pointerup', 30));
  assert.equal(material.pendingOfficeTarget.target.exact, 'SECOND PA');
  assert.equal(renders, 3);
  selection.text = '';
  host.closest = () => secondRun;
  host.dispatchEvent(pointer('pointerdown', 30));
  document.dispatchEvent(pointer('pointerup', 0));
  assert.equal(material.pendingOfficeTarget.target.exact, 'SECOND PA');
  assert.equal(renders, 4, '反向拖选须保留文档顺序');
  selection.text = '';
  secondRun.closest = () => otherSurface;
  host.closest = () => run;
  host.dispatchEvent(pointer('pointerdown', 0));
  document.dispatchEvent(pointer('pointerup', 30));
  assert.equal(renders, 4, '跨页文字不可补建选区');
  material.officeSelectionAbortController.abort();
});

test('选区保存和绘制保存共用保存后清理，编辑旧批注不清理新意见', async () => {
  for (const [start, end] of [
    ['} else if (saveHtmlSelectionButton)', '} else if (clearHtmlSelectionButton)'],
    ['} else if (savePdfTextSelectionButton)', '} else if (clearPdfTextSelectionButton)'],
    ['} else if (saveOfficeSelectionButton)', '} else if (clearOfficeSelectionButton)'],
    ['addEventListener("pointerup", async event => {', 'addEventListener("pointercancel"']
  ]) {
    const flow = app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
    assert.match(flow, /await saveWorkbenchAnnotation\(project, annotation, \{ completeDraft: true \}\)/);
  }
  const material = { annotations: [], newAnnotationDraft: '另一条新意见', annotationHistory: { record() {} } };
  const context = {
    getWorkbenchMaterialState: () => material,
    desktopApi: { pptFeedback: { saveAnnotation: async annotation => ({ status: 'ok', annotation }) } },
    refreshWorkbenchMaterials: async () => {}
  };
  vm.runInNewContext(saveSource + '; this.save = saveWorkbenchAnnotation;', context);
  await context.save({ id: 'task' }, { id: 'existing', comment: '编辑旧批注' });
  assert.equal(material.newAnnotationDraft, '另一条新意见');
});

test('Office 恢复第二页时忽略初始化第一页回调，后续翻页写入当前任务对象', async () => {
  const renderSource = app.slice(app.indexOf('  function renderWorkbenchOfficePage('), app.indexOf('  function updateWorkbenchOfficeControls('));
  const host = new EventTarget();
  const canvas = { parentElement: host };
  const material = { officeModel: {}, officeAttachmentId: 'office', officeContentHash: 'hash', officePageCount: 2 };
  const attachment = { id: 'office', sha256: 'hash', kind: 'docx' };
  const project = { id: 'task', workbenchAttachmentId: 'office', viewer: { pageIndex: 1, zoom: 1 } };
  const document = new EventTarget();
  document.getElementById = () => ({ querySelector: selector => selector === '#workbench-office-canvas' ? canvas : null });
  let options;
  let initialized;
  const ready = new Promise(resolve => { initialized = resolve; });
  const viewer = {
    canvasElement: canvas,
    setScale: async () => { options.onPageChange(0, 2); },
    goToPage: async index => { assert.equal(index, 1); options.onPageChange(index, 2); },
    getSelectionContext: () => null
  };
  const context = {
    state: { projects: [project] }, document, AbortController,
    getWorkbenchMaterialState: () => material, disposeWorkbenchOfficeViewer() {},
    getWorkbenchViewerState: project => project.viewer,
    workbenchOfficeAnnotationLayer() {},
    updateWorkbenchFit() {},
    updateWorkbenchOfficeControls(root, attachment, index) { if (index === 1) initialized(); },
    window: { ForwardStepOoxmlModules: { docx: { DocxViewer: { fromDocument: (canvas, model, opts) => { options = opts; return viewer; } } } } }
  };
  vm.createContext(context);
  vm.runInContext('function persist() { state = JSON.parse(JSON.stringify(state)); }', context);
  vm.runInContext(renderSource + '; this.render = renderWorkbenchOfficePage;', context);
  context.render(project, attachment, project.viewer);
  await ready;
  assert.equal(context.state.projects[0].viewer.pageIndex, 1);
  options.onPageChange(0, 2);
  assert.equal(context.state.projects[0].viewer.pageIndex, 0);
  options.onPageChange(1, 2);
  assert.equal(context.state.projects[0].viewer.pageIndex, 1);
  material.officeSelectionAbortController.abort();
});
