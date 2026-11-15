const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(process.env.WORKBENCH_APP_SOURCE || path.join(__dirname, '../prototype/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../prototype/index.html'), 'utf8');
function section(start, end) {
  const index = app.indexOf(start);
  assert.notEqual(index, -1);
  return app.slice(index, app.indexOf(end, index));
}
function projectSwitchFixture(activeView) {
  const calls = [];
  const previousMaterial = {};
  const context = {
    activeProjectId: 'old-task', activeView,
    state: { knowledgeSelection: [], researchSelection: [] },
    workbenchMaterialStates: new Map([['old-task', previousMaterial]]),
    selectedSearchIds: new Set(), remoteSearchResults: [], sendDraft: null,
    saveWorkbenchDraft: () => calls.push('save-draft'),
    saveWorkbenchViewState: () => calls.push('save-view'),
    disposeWorkbenchPdfViewer: material => { assert.equal(material, previousMaterial); calls.push('dispose-pdf'); },
    disposeWorkbenchOfficeViewer: material => { assert.equal(material, previousMaterial); calls.push('dispose-office'); },
    persist: () => calls.push('persist'), renderSearchResults: () => calls.push('render-search'),
    document: { getElementById: () => ({ hidden: false }) }
  };
  vm.createContext(context);
  vm.runInContext('let workbenchDrag = null; let workbenchDetailsTrigger = null;', context);
  const start = app.indexOf('  function renderProject(project) {');
  const end = app.indexOf('    const method = getMethodCard(project.domain);', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  vm.runInContext(`${app.slice(start, end)}\n  }`, context);
  context.renderProject({ id: 'new-task' });
  return { calls, context };
}
function fixture() {
  const listeners = {};
  const panel = { hidden: true, focus() { this.focused = true; } };
  const toggle = { setAttribute(name, value) { this[name] = value; }, focus() { this.focused = true; } };
  const scroll = { scrollLeft: 0, scrollTop: 0 };
  const retryOffice = { addEventListener: (name, fn) => { listeners[`retry-office-${name}`] = fn; } };
  const root = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    querySelector(selector) {
      if (selector === '.workbench-material-scroll') return scroll;
      if (selector === '[data-workbench-retry-office]' && this.innerHTML?.includes('data-workbench-retry-office')) return retryOffice;
      return null;
    }
  };
  const nodes = { 'workbench-material-view': root, 'workbench-annotation-list': panel, 'workbench-annotation-list-toggle': toggle };
  const project = { id: 'task', workbenchAttachmentId: 'file-0' };
  const material = {
    attachments: Array.from({ length: 7 }, (_, i) => ({ id: `file-${i}`, kind: 'image', displayName: `参考资料-${i}.png`, sha256: 'hash' })),
    annotations: [], deletedAttachments: [], annotationOpen: false, annotationListOpen: false, webUrl: '',
    annotationHistory: { canUndo: () => false, canRedo: () => false }
  };
  let renderCount = 0;
  const context = {
    window: { addEventListener: (name, fn) => { listeners[`window-${name}`] = fn; } },
    document: { getElementById: id => nodes[id], querySelectorAll: () => [] },
    workbenchAnnotationIntentLabels: { modify: '修改' },
    workbenchAnnotationCategoryLabels: { other: '其他' },
    desktopApi: { pptFeedback: { saveWebSnapshot() {} } }, getActiveProject: () => project,
    getWorkbenchMaterialState: () => material, getWorkbenchViewerState: () => ({ zoom: 1, pageIndex: 0 }),
    disposeWorkbenchPdfViewer() {}, disposeWorkbenchOfficeViewer() {},
    renderWorkbenchOfficePage() {}, watchWorkbenchFit() {},
    feedback: {
      findSelectedAnnotationConflicts: () => [],
      resolveSelectedAnnotationConflicts: () => ({ selectedAnnotations: [], pendingConflicts: [], deferredConflicts: [], conflictedIds: new Set(), promptSources: [] })
    }, escapeHtml: value => String(value),
    renderWorkbenchMaterial() { renderCount++; }, toast: message => assert.fail(message)
  };
  vm.createContext(context);
  vm.runInContext(section('  function workbenchOfficeErrorMessage(error, prefix = "Office 预览失败") {', '  async function loadWorkbenchOfficeModel('), context);
  const helpers = app.indexOf('  function syncWorkbenchAnnotationDraft(');
  if (helpers >= 0) vm.runInContext(app.slice(helpers, app.indexOf('  function renderWorkbenchMaterial(', helpers)), context);
  return { context, project, material, nodes, listeners, root, panel, toggle, scroll, renders: () => renderCount };
}
test('七份资料标签与查看器操作共用紧凑工具栏，默认收起批注列表', () => {
  const f = fixture();
  vm.runInContext(section('  function renderWorkbenchMaterial(project) {', '  async function refreshWorkbenchMaterials('), f.context);
  f.context.renderWorkbenchMaterial(f.project);
  assert.match(f.root.innerHTML, /class="workbench-material-tabs"/);
  assert.equal((f.root.innerHTML.match(/data-workbench-attachment=/g) || []).length, 7);
  assert.match(f.root.innerHTML, /id="workbench-annotation-list"[^>]*hidden/);
  const toolbar = f.root.innerHTML.slice(f.root.innerHTML.indexOf('class="workbench-material-toolbar"'), f.root.innerHTML.indexOf('class="workbench-material-body"'));
  assert.match(toolbar, /class="workbench-material-tabs"/);
  assert.match(toolbar, /data-workbench-attachment=/);
  assert.match(toolbar, /class="workbench-material-more"/);
  assert.match(toolbar, /添加网页/);
});
test('新增批注编辑器与预览并列，不占用文档纵向空间', () => {
  const f = fixture();
  f.material.annotationOpen = true;
  vm.runInContext(section('  function renderWorkbenchMaterial(project) {', '  async function refreshWorkbenchMaterials('), f.context);
  f.context.renderWorkbenchMaterial(f.project);
  const body = f.root.innerHTML.slice(f.root.innerHTML.indexOf('<div class="workbench-material-body">'));
  const scrollStart = body.indexOf('<div class="workbench-material-scroll">');
  const editorStart = body.indexOf('<section class="workbench-annotation-editor"');
  assert.ok(scrollStart >= 0 && editorStart > scrollStart);
  assert.ok(body.indexOf('</div><section class="workbench-annotation-editor"', scrollStart) >= 0);
  assert.match(html, /\.workbench-annotation-editor \{[^}]*flex:0 0 min\(320px,34%\)/);
  assert.match(html, /@container \(max-width:760px\)[\s\S]*?\.workbench-annotation-editor \{[^}]*position:absolute/);
});
test('展开资料管理菜单时占用工具栏布局，不覆盖查看器内容', () => {
  assert.match(html, /\.workbench-material-more\[open\]\s*\{[^}]*flex:\s*1\s+0\s+100%/);
  assert.match(html, /\.workbench-material-menu\s*\{[^}]*position:\s*static/);
});
test('切换任务前先保存并销毁旧资料查看器，避免遗留选区监听', () => {
  const { calls, context } = projectSwitchFixture('project');
  assert.equal(calls.join(','), 'save-draft,save-view,dispose-pdf,dispose-office,persist,render-search');
  assert.equal(context.activeProjectId, 'new-task');
});
test('从其他板块切换任务也会销毁隐藏工作台的查看器', () => {
  const { calls, context } = projectSwitchFixture('home');
  assert.equal(calls.join(','), 'save-draft,dispose-pdf,dispose-office,persist,render-search');
  assert.equal(context.activeProjectId, 'new-task');
});
test('展开和收起批注只改变面板状态，不重建正在查看的文档', async () => {
  const f = fixture();
  vm.runInContext(section('  document.getElementById("workbench-material-view").addEventListener("click", async event => {', '  document.getElementById("workbench-material-view").addEventListener("input", event => {'), f.context);
  const click = () => f.listeners.click({ target: { closest: selector => selector === '[data-workbench-toggle-notes]' ? {} : null } });
  await click();
  assert.equal(f.material.annotationListOpen, true);
  assert.equal(f.panel.hidden, false);
  assert.equal(f.toggle['aria-expanded'], 'true');
  await click();
  assert.equal(f.panel.hidden, true);
  assert.equal(f.toggle.focused, true);
  assert.equal(f.renders(), 0);
});
test('打开文字类资料的批注面板默认选择文字，并保留绘制工具', async () => {
  const clickHandler = section('  document.getElementById(\"workbench-material-view\").addEventListener(\"click\", async event => {', '  document.getElementById(\"workbench-material-view\").addEventListener(\"input\", event => {');
  const clickAnnotation = f => f.listeners.click({ target: { closest: selector => selector === '[data-workbench-toggle-annotation]' ? {} : null } });

  for (const kind of ['pdf', 'docx', 'pptx']) {
    const f = fixture();
    f.material.attachments = [{ id: 'file', kind, displayName: 'sample', sha256: 'hash' }];
    f.project.workbenchAttachmentId = 'file';
    f.material.tool = 'point';
    vm.runInContext(clickHandler, f.context);
    await clickAnnotation(f);
    assert.equal(f.material.annotationOpen, true);
    assert.equal(f.material.tool, 'text');
  }

  for (const tool of ['region', 'arrow', 'path']) {
    const f = fixture();
    f.material.attachments = [{ id: 'file', kind: 'docx', displayName: 'sample', sha256: 'hash' }];
    f.project.workbenchAttachmentId = 'file';
    f.material.tool = tool;
    vm.runInContext(clickHandler, f.context);
    await clickAnnotation(f);
    assert.equal(f.material.tool, tool);
  }

  const image = fixture();
  image.material.tool = 'point';
  vm.runInContext(clickHandler, image.context);
  await clickAnnotation(image);
  assert.equal(image.material.tool, 'point');
});
test('Escape 关闭批注面板并返回入口，意见草稿和资料滚动保持', () => {
  const f = fixture();
  f.material.annotationListOpen = true;
  f.material.newAnnotationDraft = '保留这一段';
  f.panel.hidden = false;
  f.scroll.scrollTop = 125;
  vm.runInContext(section('  document.getElementById("workbench-material-view").addEventListener("keydown", event => {', '  document.getElementById("workbench-material-view").addEventListener("click", async event => {'), f.context);
  let prevented = false;
  f.listeners.keydown({ key: 'Escape', target: { closest: () => null }, preventDefault() { prevented = true; } });
  assert.equal(f.material.annotationListOpen, false);
  assert.equal(f.panel.hidden, true);
  assert.equal(f.toggle.focused, true);
  assert.equal(f.material.newAnnotationDraft, '保留这一段');
  assert.equal(f.scroll.scrollTop, 125);
  assert.equal(prevented, true);
});

test('Office 预览就绪前隐藏批注和视图工具，失败状态提供重试', () => {
  const f = fixture();
  f.material.attachments = [{ id: 'office-1', kind: 'docx', displayName: 'sample.docx', sha256: 'hash' }];
  f.project.workbenchAttachmentId = 'office-1';
  vm.runInContext(section('  function renderWorkbenchMaterial(project) {', '  async function refreshWorkbenchMaterials('), f.context);

  f.material.loading = true;
  f.context.renderWorkbenchMaterial(f.project);
  assert.match(f.root.innerHTML, /正在读取Word 文档/);
  assert.doesNotMatch(f.root.innerHTML, /data-workbench-toggle-annotation|workbench-zoom-control|workbench-office-navigation/);

  f.material.loading = false;
  f.material.error = 'Office 附件解析失败';
  f.context.renderWorkbenchMaterial(f.project);
  assert.match(f.root.innerHTML, /role="alert"/);
  assert.match(f.root.innerHTML, /Office 附件解析失败/);
  assert.match(f.root.innerHTML, /data-workbench-retry-office/);
  assert.doesNotMatch(f.root.innerHTML, /data-workbench-toggle-annotation|workbench-zoom-control|workbench-office-navigation/);

  let retryCount = 0;
  f.context.refreshWorkbenchMaterials = project => {
    assert.equal(project, f.project);
    retryCount++;
  };
  f.listeners['retry-office-click']();
  assert.equal(retryCount, 1);
  assert.equal(f.material.error, '');

  f.material.officeModel = {};
  f.material.officeAttachmentId = 'office-1';
  f.material.officeContentHash = 'hash';
  f.material.officePageCount = 2;
  f.context.renderWorkbenchMaterial(f.project);
  assert.match(f.root.innerHTML, /data-workbench-toggle-annotation/);
  assert.match(f.root.innerHTML, /workbench-zoom-control/);
  assert.match(f.root.innerHTML, /workbench-office-navigation/);
});

test('Office 稳定错误码给出修复指引，未知错误保留原文', () => {
  const f = fixture();
  assert.match(f.context.workbenchOfficeErrorMessage({ code: 'encrypted' }), /移除密码保护/);
  assert.match(f.context.workbenchOfficeErrorMessage({ code: 'legacy-binary-format' }), /另存为 \.docx\/\.pptx/);
  assert.equal(f.context.workbenchOfficeErrorMessage(new Error('viewer constructor failed')), 'Office 预览失败：viewer constructor failed');
});

test('Office 查看器同步初始化失败进入可重试错误态', () => {
  const f = fixture();
  const querySelector = f.root.querySelector.bind(f.root);
  f.root.querySelector = selector => selector === '#workbench-office-canvas' ? {} : querySelector(selector);
  f.context.AbortController = AbortController;
  f.context.state = { projects: [f.project] };
  f.context.window = { ForwardStepOoxmlModules: { docx: { DocxViewer: { fromDocument() { throw new Error('viewer constructor failed'); } } } } };
  f.project.workbenchAttachmentId = 'office-1';
  Object.assign(f.material, { officeModel: { mode: 'worker' }, officeAttachmentId: 'office-1', officeContentHash: 'hash', officePageCount: 2 });
  vm.runInContext(section('  function renderWorkbenchOfficePage(project, attachment, viewerState) {', '  function updateWorkbenchOfficeControls(root, attachment, pageIndex, pageCount) {'), f.context);

  assert.doesNotThrow(() => f.context.renderWorkbenchOfficePage(f.project, { id: 'office-1', kind: 'docx', sha256: 'hash' }, { pageIndex: 0, zoom: 1 }));
  assert.match(f.material.officeRenderError, /viewer constructor failed/);
  assert.equal(f.material.error, f.material.officeRenderError);
  assert.equal(f.renders(), 1);
});
