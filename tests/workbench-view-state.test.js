const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(process.env.WORKBENCH_APP_SOURCE || path.join(__dirname, '../prototype/app.js'), 'utf8');
const saveView = app.match(/  function saveWorkbenchViewState\(\) \{[\s\S]*?\n  }/)[0];

function fixture() {
  const listeners = new Map();
  const workbenchSessionLayouts = new Map([['task', { mode: 'split', ratio: 0.5, lastSide: 'chat' }]]);
  const scroll = { scrollLeft: 0, scrollTop: 125 };
  const root = {
    querySelector: selector => selector === '.workbench-material-scroll' ? scroll : null,
    addEventListener: (event, listener) => listeners.set(event, listener),
    focus() { this.focused = true; }
  };
  const material = {
    attachments: [{ id: 'old', kind: 'docx' }, { id: 'new', kind: 'html' }],
    annotations: [], officePageCount: 3
  };
  const context = {
    window: { addEventListener() {} },
    state: { projects: [{ id: 'task', workbenchAttachmentId: 'old', workbenchLayout: 'split', workbenchViewerState: { old: { pageIndex: 0, zoom: 1, scrollLeft: 0, scrollTop: 0 } } }] },
    activeProjectId: 'task', workbenchViewerSaveTimer: null, clearTimeout, setTimeout,
    document: { getElementById: () => root, querySelectorAll: () => [], querySelector: () => null },
    activeView: 'project', workbenchSessionLayouts,
    desktopApi: { pptFeedback: {} },
    getWorkbenchLayoutMode(project) { return workbenchSessionLayouts.get(project.id)?.mode || 'chat'; },
    getWorkbenchSessionLayout(project) {
      if (!workbenchSessionLayouts.has(project.id)) workbenchSessionLayouts.set(project.id, { mode: 'chat', ratio: 0.5, lastSide: 'chat' });
      return workbenchSessionLayouts.get(project.id);
    },
    applyWorkbenchLayout() {}, scheduleWorkbenchHtmlPreviewSync() {},
    getWorkbenchViewerState(project, id) { return project.workbenchViewerState[id]; },
    getWorkbenchMaterialState: () => material,
    renderWorkbenchMaterial() {}, renderWorkbench() {}, refreshWorkbenchMaterials: async () => {},
    toast: message => assert.fail(message)
  };
  vm.createContext(context);
  vm.runInContext('function getActiveProject() { return state.projects[0]; } function persist() { state = JSON.parse(JSON.stringify(state)); }', context);
  const previewHelpers = app.indexOf('  function getWorkbenchPreviewState(');
  vm.runInContext(app.slice(previewHelpers, app.indexOf('  function getWorkbenchLayoutMode(', previewHelpers)), context);
  vm.runInContext(saveView, context);
  const helpers = app.indexOf('  function getWorkbenchOpenAttachments(');
  if (helpers >= 0) vm.runInContext(app.slice(helpers, app.indexOf('  function renderWorkbenchMaterial(', helpers)), context);
  return { context, material, listeners };
}

function section(start, end) {
  const index = app.indexOf(start);
  assert.notEqual(index, -1);
  return app.slice(index, app.indexOf(end, index));
}

test('PDF 查看器重建时保留页内滚动，不被页码复位事件覆盖', async () => {
  const frameCallbacks = [];
  const viewer = { zoom: 1.2, zoomMode: 'manual', pageIndex: 1, pdfScrollTop: 1518, pdfScrollLeft: 0 };
  const container = { scrollLeft: 0, scrollTop: 0 };
  Object.defineProperty(container, 'scrollTop', {
    get() { return this.top; },
    set(top) { this.top = top; viewer.pdfScrollTop = top; }
  });
  const viewerElement = {};
  const root = {
    contains: node => node === viewerElement,
    querySelector: selector => selector === '.workbench-pdf-scroll' ? container
      : selector === '#workbench-pdf-viewer' ? viewerElement : null
  };
  const material = { pdfDocument: {}, pdfAttachmentId: 'pdf', pdfPageCount: 2 };
  class EventBus {
    handlers = new Map();
    on(name, handler) { this.handlers.set(name, handler); }
    dispatch(name, value) { this.handlers.get(name)?.(value); }
  }
  class PDFViewer {
    constructor({ eventBus }) { this.eventBus = eventBus; this.pagesCount = 2; this.page = 1; }
    set currentPageNumber(page) { this.page = page; container.scrollTop = 1288; }
    get currentPageNumber() { return this.page; }
    getPageView() { return { div: {} }; }
    setDocument() { this.eventBus.dispatch('pagesinit'); }
  }
  const context = {
    state: { projects: [{ id: 'task' }] }, AbortController,
    document: { getElementById: () => root }, getWorkbenchMaterialState: () => material,
    disposeWorkbenchPdfViewer() {}, renderWorkbenchPdfAnnotationLayer() {}, updateWorkbenchPdfControls() {},
    window: { ForwardStepPdfjsReady: Promise.resolve({ viewer: {
      EventBus, PDFViewer, PDFLinkService: class { setViewer() {} setDocument() {} }
    } }), requestAnimationFrame: callback => frameCallbacks.push(callback) }
  };
  vm.createContext(context);
  vm.runInContext(section('  function renderWorkbenchPdfPage(', '  function renderWorkbenchOfficePage(') + '; this.renderPdf = renderWorkbenchPdfPage;', context);
  context.renderPdf({ id: 'task' }, { id: 'pdf' }, viewer);
  await new Promise(resolve => setImmediate(resolve));
  for (const callback of frameCallbacks) callback();
  assert.equal(container.scrollTop, 1518);
  assert.equal(viewer.pdfScrollTop, 1518);
});

test('专注对话隐藏资料时不把 PDF 阅读位置覆盖为零', () => {
  const { context } = fixture();
  context.workbenchSessionLayouts.get('task').mode = 'chat';
  context.state.projects[0].workbenchViewerState.old.pdfScrollTop = 1518;
  context.document.getElementById().querySelector = selector => selector === '.workbench-material-scroll'
    ? { scrollLeft: 0, scrollTop: 0 } : selector === '.workbench-pdf-scroll'
      ? { scrollLeft: 0, scrollTop: 0 } : null;
  vm.runInContext(section('  function scheduleWorkbenchViewStateSave(', '  function saveWorkbenchViewState(') + '; this.scheduleSave = scheduleWorkbenchViewStateSave;', context);
  context.scheduleSave({ target: context.document.getElementById().querySelector('.workbench-pdf-scroll') });
  context.saveWorkbenchViewState();
  assert.equal(context.state.projects[0].workbenchViewerState.old.pdfScrollTop, 1518);
});

test('关闭预览后显式选择专注查看会重开并保存预览', () => {
  const { context } = fixture();
  vm.runInContext('state.projects[0].workbenchPreviewState = "closed"; state.projects[0].workbenchAttachmentId = ""', context);
  const button = {
    dataset: { workbenchLayout: 'preview' },
    getAttribute: () => 'false',
    addEventListener(event, listener) { this.listener = listener; }
  };
  context.document.querySelectorAll = selector => selector === '[data-workbench-layout]' ? [button] : [];
  context.persisted = 0;
  vm.runInContext('persist = () => { globalThis.persisted += 1; globalThis.persistedState = state.projects[0].workbenchPreviewState; }', context);
  let appliedPreviewState = '';
  context.applyWorkbenchLayout = current => { appliedPreviewState = current.workbenchPreviewState; };
  vm.runInContext(section(
    '  document.querySelectorAll("[data-workbench-layout]").forEach(button => button.addEventListener("click"',
    '  document.querySelectorAll("[data-workbench-preview]").forEach(button => button.addEventListener("click"'
  ), context);

  button.listener();

  assert.equal(appliedPreviewState, 'open');
  assert.equal(context.persistedState, 'open');
  assert.equal(context.workbenchSessionLayouts.get('task').mode, 'preview');
  assert.equal(context.persisted, 1);
});

test('画布焦点节点支持键盘删除、撤销和重做', () => {
  const { context, listeners } = fixture();
  const history = { undo: { disabled: false, clicks: 0, click() { this.clicks += 1; } }, redo: { disabled: false, clicks: 0, click() { this.clicks += 1; } } };
  const remove = { disabled: false, clicks: 0, click() { this.clicks += 1; } };
  const node = {
    matches: selector => selector === '[data-workbench-canvas-node]',
    closest: selector => selector === '[data-workbench-canvas-node]' ? node : null,
    querySelector: selector => selector === '[data-workbench-canvas-remove]' ? remove : null
  };
  context.document.querySelector = selector => selector === '[data-workbench-canvas-undo]' ? history.undo
    : selector === '[data-workbench-canvas-redo]' ? history.redo : null;
  vm.runInContext('state.projects[0].workbenchMaterialPanel = "canvas"', context);
  vm.runInContext(section(
    '  document.getElementById("workbench-material-view").addEventListener("keydown", event => {',
    '  document.getElementById("workbench-material-view").addEventListener("click", async event => {'
  ), context);

  const sendKey = (key, modifiers = {}) => {
    let prevented = false;
    listeners.get('keydown')({ key, target: node, ...modifiers, preventDefault() { prevented = true; } });
    return prevented;
  };

  assert.equal(sendKey('Delete'), true);
  assert.equal(remove.clicks, 1);
  assert.equal(sendKey('z', { ctrlKey: true }), true);
  assert.equal(history.undo.clicks, 1);
  assert.equal(sendKey('z', { ctrlKey: true, shiftKey: true }), true);
  assert.equal(history.redo.clicks, 1);
  assert.equal(sendKey('y', { metaKey: true }), true);
  assert.equal(history.redo.clicks, 2);
});

test('首页在异步恢复任务清单后回填未发送目标草稿', async () => {
  const draft = {
    id: 'restored-draft', title: '重启草稿', idea: '',
    workbenchDraft: { goal: '恢复后的未发送目标' }, workbenchRevision: 1
  };
  const fields = { idea: { value: '' }, 'project-title': { textContent: '' } };
  const context = {
    state: { projects: [] }, activeView: 'home', homeWorkbenchGoalDraftId: '',
    desktopApi: { workbench: { listManifests: async () => ({ manifests: [{ taskId: draft.id, revision: 1, project: draft }], errors: [] }) } },
    workbenchManifestRevisions: new Map(), workbenchManifestSignatures: new Map(), localStorage: {},
    document: { getElementById: id => fields[id] || null },
    migrateState: value => value,
    isUnifiedWorkbenchProject: project => Boolean(project.workbenchDraft?.goal),
    getWorkbenchManifestSignature: project => JSON.stringify(project),
    prepareWorkbenchManifestState: state => ({ state, signatures: [] }),
    saveState: (_storage, state) => state,
    scheduleWorkbenchManifestSave() {}, renderRecent() {}, getActiveProject: () => null,
    renderWorkbench() {}, toast: message => assert.fail(message)
  };
  vm.createContext(context);
  vm.runInContext(section('  async function restoreWorkbenchManifests()', '  function getWorkbenchSessionLayout(')
    + '; this.restoreWorkbenchManifests = restoreWorkbenchManifests;', context);

  await context.restoreWorkbenchManifests();

  assert.equal(context.state.projects[0].workbenchDraft.goal, fields.idea.value);
  assert.equal(fields.idea.value, '恢复后的未发送目标');
  assert.equal(fields['project-title'].textContent, fields.idea.value);
  assert.equal(context.homeWorkbenchGoalDraftId, draft.id);
});

for (const kind of ['image', 'pdf', 'docx', 'pptx']) {
  for (const targetKind of ['point', 'region', 'arrow', 'path']) {
    test(`${kind} ${targetKind} 批注回到内嵌资料页，不调用 HTML 预览`, async () => {
      const { context, material, listeners } = fixture();
      const pageIndex = kind === 'image' ? 0 : 1;
      Object.assign(material.attachments[0], { kind, sha256: 'hash' });
      material.annotations = [{ id: 'drawing', attachmentId: 'old', contentHash: 'hash', pageIndex, target: { kind: targetKind } }];
      let navigated;
      material.officeViewer = {
        goToPage: async index => { navigated = index; },
        goToSlide: async index => { navigated = index; }
      };
      context.desktopApi.pptFeedback.openPreview = async () => assert.fail('绘制批注应在工作台内定位');
      context.toast = () => {};
      vm.runInContext(section('  document.getElementById("workbench-material-view").addEventListener("click", async event => {', '  document.getElementById("workbench-material-view").addEventListener("input", event => {'), context);
      await listeners.get('click')({ target: { closest: selector => selector === '[data-workbench-locate-annotation]'
        ? { dataset: { workbenchLocateAnnotation: 'drawing' } } : null } });
      const project = context.state.projects[0];
      assert.equal(project.workbenchPreviewMode, 'material');
      assert.equal(context.getWorkbenchLayoutMode(project), 'split');
      assert.equal(project.workbenchViewerState.old.pageIndex, pageIndex);
      if (['docx', 'pptx'].includes(kind)) assert.equal(navigated, pageIndex);
    });
  }
}

for (const kind of ['pdf', 'docx', 'pptx']) {
  test(`${kind} 修改提示词的来源入口恢复批注页码并保留原资料滚动`, async () => {
    const { context, material, listeners } = fixture();
    context.state.projects[0].workbenchClosedAttachmentIds = ['old', 'new'];
    Object.assign(material.attachments[0], { kind, sha256: 'hash' });
    material.annotations = [{ id: 'note', attachmentId: 'old', contentHash: 'hash', status: 'active', pageIndex: 1 }];
    let locatedAnnotationId = '';
    context.document.querySelectorAll = selector => selector === '[data-workbench-locate-annotation]'
      ? [{ dataset: { workbenchLocateAnnotation: 'note' }, click() { locatedAnnotationId = this.dataset.workbenchLocateAnnotation; } }]
      : [];
    vm.runInContext(section('  document.getElementById("workbench-prompt-actions").addEventListener', '  document.getElementById("workbench-prompt-history-list")'), context);
    await listeners.get('click')({ target: { closest: selector => selector === '[data-workbench-prompt-source]'
      ? { dataset: { workbenchPromptSource: 'note' } } : null } });
    const project = context.state.projects[0];
    assert.equal(project.workbenchViewerState.old.pageIndex, 1);
    assert.equal(project.workbenchViewerState.old.scrollTop, 125);
    assert.equal(project.workbenchPreviewMode, 'material');
    assert.equal(context.getWorkbenchLayoutMode(project), 'split');
    assert.deepEqual(Array.from(project.workbenchClosedAttachmentIds), ['new']);
    assert.equal(locatedAnnotationId, 'note');
  });
}

for (const [attribute, field, value, next] of [
  ['layout', 'mode', 'preview', '  document.querySelectorAll("[data-workbench-preview]")'],
  ['preview', 'workbenchPreviewMode', 'prompt', '  document.getElementById("workbench-copy-prompt")']
]) {
  test('保存滚动后切换 ' + attribute + ' 写入当前任务并可重载', () => {
    const { context } = fixture();
    context.getActiveProject = () => context.state.projects[0];
    context.persist = () => {};
    const button = {
      dataset: { [attribute === 'layout' ? 'workbenchLayout' : 'workbenchPreview']: value },
      getAttribute: name => name === 'aria-disabled' ? 'false' : null,
      addEventListener(event, handler) { this.click = handler; }
    };
    context.document.querySelectorAll = () => [button];
    vm.runInContext(section('  document.querySelectorAll("[data-workbench-' + attribute + ']").forEach(button => button.addEventListener', next), context);
    button.click();
    assert.equal(attribute === 'layout' ? context.workbenchSessionLayouts.get('task')[field] : context.state.projects[0][field], value);
    assert.equal(context.state.projects[0].workbenchViewerState.old.scrollTop, 125);
  });
}

for (const [selector, dataset, field, expected] of [
  ['[data-workbench-zoom]', { workbenchZoom: 'in' }, 'zoom', 1.25],
  ['[data-workbench-page-step]', { workbenchPageStep: '1' }, 'pageIndex', 1]
]) {
  test('保存滚动后' + field + ' 仍写入当前资料', () => {
    const { context, listeners } = fixture();
    const source = section('  document.getElementById("workbench-material-view").addEventListener("click", event => {', '  async function createProjectFromIdea(');
    vm.runInContext(source, context);
    listeners.get('click')({ target: { closest: candidate => candidate === selector ? { dataset } : null } });
    assert.equal(context.state.projects[0].workbenchViewerState.old[field], expected);
  });
}

test('保存滚动后切换资料同时保留新资料选择和原资料查看位置', async () => {
  const { context, listeners } = fixture();
  const source = section('  document.getElementById("workbench-material-view").addEventListener("click", async event => {', '  document.getElementById("workbench-material-view").addEventListener("input", event => {');
  vm.runInContext(source, context);
  await listeners.get('click')({ target: { closest: selector => selector === '[data-workbench-attachment]' ? { dataset: { workbenchAttachment: 'new' } } : null } });
  assert.equal(context.state.projects[0].workbenchAttachmentId, 'new');
  assert.equal(context.state.projects[0].workbenchViewerState.old.scrollTop, 125);
});

test('文件选择等待期间保存或切换任务后，新资料仍关联原任务', async () => {
  const { context } = fixture();
  context.desktopApi.pptFeedback.chooseFile = async () => {
    vm.runInContext('persist(); state.projects.unshift({ id: "other" }); activeProjectId = "other";', context);
    return { attachment: { id: 'new' } };
  };
  vm.runInContext(section('  async function chooseWorkbenchMaterial(', '  async function addWorkbenchWebSnapshot(') + '; this.choose = chooseWorkbenchMaterial;', context);
  await context.choose(context.state.projects[0]);
  assert.equal(context.state.projects.find(item => item.id === 'task').workbenchAttachmentId, 'new');
  assert.equal(context.state.projects[0].id, 'other');
  assert.equal(context.state.projects[0].workbenchAttachmentId, undefined);
});

for (const operation of ['remove', 'restore']) {
  test('资料' + operation + ' 等待期间保存任务后，结果仍更新当前记录', async () => {
    const { context, listeners } = fixture();
    context.toast = () => {};
    context.desktopApi.pptFeedback[operation === 'remove' ? 'deleteAttachment' : 'restoreAttachment'] = async () => vm.runInContext('persist()', context);
    if (operation === 'restore') context.state.projects[0].workbenchAttachmentId = 'missing';
    const selector = operation === 'remove' ? '[data-workbench-confirm-remove]' : '[data-workbench-restore-material]';
    const dataset = operation === 'remove' ? { workbenchConfirmRemove: 'old' } : { workbenchRestoreMaterial: 'new' };
    vm.runInContext(section('  document.getElementById("workbench-material-view").addEventListener("click", async event => {', '  document.getElementById("workbench-material-view").addEventListener("input", event => {'), context);
    await listeners.get('click')({ target: { closest: candidate => candidate === selector ? { dataset } : null } });
    assert.equal(context.state.projects[0].workbenchAttachmentId, operation === 'remove' ? '' : 'new');
  });
}

test('保存滚动后跳转 PDF 批注保留页码和专注模式', async () => {
  const { context, material, listeners } = fixture();
  material.attachments.push({ id: 'pdf', kind: 'pdf', sha256: 'hash' });
  material.annotations.push({ id: 'note', attachmentId: 'pdf', contentHash: 'hash', pageIndex: 1, target: { kind: 'text', selector: '.textLayer' } });
  context.state.projects[0].workbenchViewerState.pdf = {};
  context.toast = () => {};
  vm.runInContext(section('  document.getElementById("workbench-material-view").addEventListener("click", async event => {', '  document.getElementById("workbench-material-view").addEventListener("input", event => {'), context);
  await listeners.get('click')({ target: { closest: selector => selector === '[data-workbench-locate-annotation]' ? { dataset: { workbenchLocateAnnotation: 'note' } } : null } });
  const project = context.state.projects[0];
  assert.equal(project.workbenchAttachmentId, 'pdf');
  assert.equal(context.getWorkbenchLayoutMode(project), 'split');
  assert.equal(project.workbenchPreviewMode, 'material');
  assert.equal(project.workbenchViewerState.pdf.pageIndex, 1);
});

test('网页读取等待期间保存任务后，新快照关联原任务并清理网址草稿', async () => {
  const { context, material } = fixture();
  material.webUrl = 'https://example.com/';
  context.window = { confirm: () => true };
  context.URL = URL;
  context.TextEncoder = TextEncoder;
  context.fetch = async () => ({ ok: true, json: async () => ({
    renderMode: 'static-html', contentHash: 'sha256:' + 'a'.repeat(64), finalUrl: 'https://example.com/',
    fetchedAt: '2026-11-13T00:00:00Z', title: 'Example', html: '<p>Example</p>', text: 'Example'
  }) });
  context.desktopApi.pptFeedback.saveWebSnapshot = async () => {
    vm.runInContext('persist(); state.projects.unshift({ id: "other" }); activeProjectId = "other";', context);
    return { status: 'ok', attachment: { id: 'new' } };
  };
  context.toast = () => {};
  vm.runInContext(section('  async function addWorkbenchWebSnapshot(', '  async function saveWorkbenchAnnotation(') + '; this.addWeb = addWorkbenchWebSnapshot;', context);
  await context.addWeb(context.state.projects[0]);
  assert.equal(material.webError, '');
  assert.equal(context.state.projects.find(item => item.id === 'task').workbenchAttachmentId, 'new');
  assert.equal(context.state.projects[0].workbenchAttachmentId, undefined);
  assert.equal(material.webUrl, '');
  assert.equal(material.webBusy, false);
});

test('自动添加资料尊重固定和关闭状态，用户主动选择仍可切换', () => {
  const { context } = fixture();
  const project = context.state.projects[0];
  project.workbenchPreviewMode = 'prompt';
  project.workbenchMaterialPanel = 'canvas';

  for (const previewState of ['pinned', 'closed']) {
    project.workbenchPreviewState = previewState;
    assert.equal(context.addWorkbenchAttachment(project, 'new'), false);
    assert.equal(project.workbenchAttachmentId, 'old');
    assert.equal(project.workbenchPreviewMode, 'prompt');
    assert.equal(project.workbenchMaterialPanel, 'canvas');
  }

  project.workbenchPreviewState = 'open';
  assert.equal(context.addWorkbenchAttachment(project, 'new'), true);
  assert.equal(project.workbenchAttachmentId, 'new');
  assert.equal(project.workbenchPreviewMode, 'material');
  assert.equal(project.workbenchMaterialPanel, 'viewer');

  project.workbenchPreviewState = 'pinned';
  assert.equal(context.openWorkbenchAttachment(project, 'old'), true);
  assert.equal(project.workbenchAttachmentId, 'old');
});

test('固定或关闭预览刷新时不自动选择首份资料', async () => {
  const { context, material } = fixture();
  material.attachments = [];
  context.desktopApi.pptFeedback = {
    listAttachments: async () => ({ attachments: [{ id: 'new', kind: 'html', sha256: 'hash' }] }),
    listAnnotations: async () => ({ annotations: [] }),
    listDeletedAttachments: async () => ({ attachments: [] })
  };
  context.ensureWorkbenchAttachmentContents = () => false;
  context.showWorkbenchReadiness = () => {};
  vm.runInContext(section('  async function refreshWorkbenchMaterials(', '  function workbenchId(')
    + '; this.refresh = refreshWorkbenchMaterials;', context);

  context.state.projects[0].workbenchAttachmentId = '';
  for (const previewState of ['pinned', 'closed']) {
    context.state.projects[0].workbenchPreviewState = previewState;
    await context.refresh(context.state.projects[0]);
    assert.equal(context.state.projects[0].workbenchAttachmentId, '');
  }

  context.state.projects[0].workbenchPreviewState = 'open';
  await context.refresh(context.state.projects[0]);
  assert.equal(context.state.projects[0].workbenchAttachmentId, 'new');
});

test('仅资料库来源也能查看引用和按来源更新提示词', () => {
  const assignments = app.match(/document\.getElementById\("workbench-prompt-actions"\)\.hidden = [^;]*(?:previewMode|promptUnavailable)[^;]*;/g);
  assert.ok(assignments?.length);
  for (const [previewMode, annotated, knowledgeCount, expectedHidden] of [
    ['prompt', false, 1, false],
    ['prompt', true, 0, false],
    ['prompt', false, 0, true],
    ['material', false, 1, true]
  ]) {
    const actions = { hidden: null };
    vm.runInNewContext(assignments.at(-1), {
      document: { getElementById: () => actions }, previewMode,
      promptUnavailable: false,
      material: { annotations: [], attachments: [] },
      knowledgeSources: Array(knowledgeCount),
      hasSelectedWorkbenchAnnotations: () => annotated
    });
    assert.equal(actions.hidden, expectedHidden, `${previewMode} / 批注 ${annotated} / 资料 ${knowledgeCount}`);
  }
  assert.equal(assignments.length, 1, '仅保留一次可见性赋值，避免覆盖资料来源判断');
});

test('HTML 原生预览随工作台三态拖动隐藏、恢复，详情覆盖层关闭后重新显示', () => {
  const bounds = [];
  const project = { id: 'task', workbenchAttachmentId: 'html', workbenchPreviewMode: 'material' };
  const material = { attachments: [{ id: 'html', kind: 'html', sha256: 'v1' }] };
  const host = { isConnected: true, getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600, right: 810, bottom: 620 }) };
  const elements = {
    'workbench-html-viewer': host,
    'workbench-surface': { hidden: false },
    'project-details': { open: false },
    'workbench-material-view': { hidden: false }
  };
  const context = {
    activeView: 'project',
    currentLayoutMode: 'split',
    desktopApi: { pptFeedback: {
      setPreviewBounds: (_id, value) => bounds.push(value),
      openPreview: async () => ({ status: 'opened' }),
      closePreview: async () => {}
    } },
    document: { getElementById: id => elements[id] || null },
    window: { getComputedStyle: () => ({ position: 'static' }) },
    getActiveProject: () => project,
    getWorkbenchMaterialState: () => material,
    getWorkbenchLayoutMode: () => context.currentLayoutMode
  };
  vm.createContext(context);
  vm.runInContext('let activeWorkbenchHtmlPreview = { taskId: "task", attachmentId: "html", opened: true }; let workbenchDrag = null;', context);
  vm.runInContext(section('  function syncWorkbenchHtmlPreview()', '  window.addEventListener?.("resize"'), context);

  context.syncWorkbenchHtmlPreview();
  context.currentLayoutMode = 'chat';
  context.syncWorkbenchHtmlPreview();
  context.currentLayoutMode = 'preview';
  context.syncWorkbenchHtmlPreview();
  elements['project-details'].open = true;
  context.syncWorkbenchHtmlPreview();
  elements['project-details'].open = false;
  context.currentLayoutMode = 'split';
  context.syncWorkbenchHtmlPreview();

  assert.deepEqual(bounds.map(value => value.visible), [true, false, true, false, true]);
  assert.ok(bounds.filter(value => value.visible).every(value => value.width === 800 && value.height === 600));
});
