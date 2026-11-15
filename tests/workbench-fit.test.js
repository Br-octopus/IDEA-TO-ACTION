const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const app = fs.readFileSync(process.env.WORKBENCH_APP_SOURCE || path.join(__dirname, '../prototype/app.js'), 'utf8');
test('首次打开资料默认适合窗口，已有缩放状态保持原样', () => {
  const start = app.indexOf('  function getWorkbenchViewerState(');
  assert.notEqual(start, -1);
  const context = {};
  vm.createContext(context);
  vm.runInContext(app.slice(start, app.indexOf('  function scheduleWorkbenchViewStateSave(', start)), context);
  const project = { workbenchLayout: 'split', workbenchViewerState: { manual: { zoom: 1.5, zoomMode: 'manual' }, legacy: { zoom: 1 } } };
  assert.equal(context.getWorkbenchViewerState(project, 'new').zoomMode, 'fit');
  assert.equal(context.getWorkbenchViewerState(project, 'manual').zoom, 1.5);
  assert.equal(context.getWorkbenchViewerState(project, 'manual').zoomMode, 'manual');
  assert.equal(context.getWorkbenchViewerState(project, 'legacy').zoomMode, undefined);
});
function fixture(kind = 'pptx') {
  const start = app.indexOf('  function calculateWorkbenchFitZoom(');
  assert.notEqual(start, -1, '窗口适配实现存在');
  const project = { id: 'task', workbenchAttachmentId: 'file', workbenchViewerState: { file: { zoom: 1, zoomMode: 'fit', pageIndex: 1 } } };
  const attachment = { id: 'file', kind };
  const viewer = project.workbenchViewerState.file;
  const box = { clientWidth: 800, clientHeight: 400, isConnected: true };
  const canvas = { style: { width: '1280px', height: '720px' } };
  const image = { naturalWidth: 1600, naturalHeight: 900, parentElement: { style: {} } };
  const output = {};
  let scale = 1;
  const material = { officeViewer: { getScale: () => scale, async setScale(next) { scale = next; canvas.style.width = `${1280 * next}px`; canvas.style.height = `${720 * next}px`; } } };
  const nodes = { '.workbench-office-page-wrap': box, '#workbench-office-canvas': canvas,
    '.workbench-material-scroll': box, '.workbench-material-image img': image,
    '.workbench-pdf-scroll': box, '.workbench-zoom-control output': output,
    '#workbench-office-status': { getAttribute: () => 'false' } };
  const root = { querySelector: selector => nodes[selector] || null, contains: () => true };
  const context = { getActiveProject: () => project, getWorkbenchMaterialState: () => material,
    getWorkbenchViewerState: () => viewer, document: { getElementById: () => root },
    window: { getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0', paddingTop: '0', paddingBottom: '0' }) },
    state: { projects: [project] }, persist() {}, toast: message => assert.fail(message) };
  vm.createContext(context);
  vm.runInContext(app.slice(start, app.indexOf('  function getWorkbenchOpenAttachments(', start)), context);
  return { context, project, attachment, material, box, canvas, image, viewer, output };
}
test('按整页宽高取较小比例，隐藏或未就绪内容不计算', () => {
  const { context } = fixture();
  assert.equal(context.calculateWorkbenchFitZoom(1600, 900, 800, 450), 0.5);
  assert.equal(context.calculateWorkbenchFitZoom(1280, 720, 800, 180), 0.25);
  assert.equal(context.calculateWorkbenchFitZoom(10, 10, 800, 450), 3);
  assert.equal(context.calculateWorkbenchFitZoom(0, 900, 800, 450), null);
  assert.equal(context.calculateWorkbenchFitZoom(1600, 900, 0, 450), null);
});
for (const kind of ['docx', 'pptx']) {
  test(`${kind} 使用原生缩放且低于 50% 时仍整页适配，重复尺寸不累计缩小`, async () => {
    const f = fixture(kind);
    f.box.clientHeight = 180;
    await f.context.updateWorkbenchFit(f.project, f.attachment);
    assert.ok(f.viewer.zoom < 0.5);
    assert.ok(parseFloat(f.canvas.style.height) <= 180);
    const scale = f.viewer.zoom;
    await f.context.updateWorkbenchFit(f.project, f.attachment);
    assert.equal(f.viewer.zoom, scale);
    assert.equal(f.viewer.pageIndex, 1);
  });
}
test('图片按原始像素尺寸适配，窗口变窄后保持比例', async () => {
  const f = fixture('image');
  await f.context.updateWorkbenchFit(f.project, f.attachment);
  const previous = f.viewer.zoom;
  f.box.clientWidth = 320;
  await f.context.updateWorkbenchFit(f.project, f.attachment);
  assert.ok(f.viewer.zoom < previous);
  assert.ok(f.image.naturalWidth * f.viewer.zoom <= 320);
  assert.equal(Number(f.image.parentElement.style.zoom), f.viewer.zoom);
});
test('PDF 复用 page-fit 公共接口并保存实际比例', async () => {
  const f = fixture('pdf');
  let requested;
  f.material.pdfViewer = { pagesCount: 2, currentScale: 0.3,
    set currentScaleValue(value) { requested = value; } };
  await f.context.updateWorkbenchFit(f.project, f.attachment);
  assert.equal(requested, 'page-fit');
  assert.equal(f.viewer.zoom, 0.3);
});
test('PDF 适合窗口缩放不丢失当前页', async () => {
  const f = fixture('pdf');
  f.material.pdfViewer = { pagesCount: 2, currentScale: 0.3, currentPageNumber: 2,
    set currentScaleValue(value) { this.currentPageNumber = 1; } };
  await f.context.updateWorkbenchFit(f.project, f.attachment);
  assert.equal(f.material.pdfViewer.currentPageNumber, 2);
  assert.equal(f.viewer.pageIndex, 1);
});
test('PDF 后续页面初始化期间延后销毁旧查看器', async () => {
  const f = fixture('pdf');
  const calls = [];
  let finish;
  f.material.pdfViewer = { pagesPromise: new Promise(resolve => { finish = resolve; }), setDocument(value) { calls.push(value); } };
  f.material.pdfViewerHandlers = [];
  f.context.disposeWorkbenchPdfViewer = undefined;
  const start = app.indexOf('  function disposeWorkbenchPdfViewer(');
  vm.runInContext(app.slice(start, app.indexOf('  function loadWorkbenchOfficeModule(', start)), f.context);
  f.context.disposeWorkbenchPdfViewer(f.material);
  assert.equal(calls.length, 0);
  assert.equal(f.material.pdfViewer, null);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0], null);
});
test('手动缩放和隐藏窗口不会被自动适配覆盖', async () => {
  const f = fixture();
  f.viewer.zoomMode = 'manual';
  await f.context.updateWorkbenchFit(f.project, f.attachment);
  assert.equal(f.viewer.zoom, 1);
  f.viewer.zoomMode = 'fit';
  f.box.clientWidth = 0;
  await f.context.updateWorkbenchFit(f.project, f.attachment);
  assert.equal(f.viewer.zoom, 1);
});
test('Office 异步缩放期间窗口再次变化后使用最终尺寸', async () => {
  const f = fixture();
  const original = f.material.officeViewer.setScale;
  let release;
  f.material.officeViewer.setScale = async next => {
    await new Promise(resolve => { release = resolve; });
    await original(next);
    f.material.officeViewer.setScale = original;
  };
  const first = f.context.updateWorkbenchFit(f.project, f.attachment);
  f.box.clientHeight = 160;
  await f.context.updateWorkbenchFit(f.project, f.attachment);
  release(); await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(parseFloat(f.canvas.style.height) <= 160);
});
test('备份恢复保留适合窗口模式和小于 50% 的缩放比例', () => {
  const file = path.join(__dirname, '../prototype/workspace-backup.js');
  const scope = { module: { exports: {} }, require: createRequire(file) };
  vm.runInNewContext(fs.readFileSync(process.env.WORKBENCH_BACKUP_SOURCE || file, 'utf8'), scope);
  const { createBackup, replaceState } = scope.module.exports;
  const backup = createBackup({ projects: [{ id: 'task', workbenchViewerState: { file: { zoom: 0.25, zoomMode: 'fit' } } }] });
  const restored = replaceState({}, JSON.parse(JSON.stringify(backup)));
  assert.equal(restored.projects[0].workbenchViewerState.file.zoomMode, 'fit');
  assert.equal(restored.projects[0].workbenchViewerState.file.zoom, 0.25);
});

test('PDF 初始化首屏事件不覆盖保存页码，后续翻页写入最新任务', async () => {
  const f = fixture('pdf');
  const handlers = new Map();
  let pdf;
  const frames = [];
  let resolveFit;
  const container = { scrollLeft: 0, scrollTop: 250 };
  const element = {};
  const root = { contains: () => true, querySelector: selector => selector === '.workbench-pdf-scroll' ? container : element };
  class PDFViewer {
    constructor() { pdf = this; this.currentPageNumber = 1; this.pagesCount = 2; }
    set currentScaleValue(value) { this.scaleValue = value; handlers.get('pagechanging')({ pageNumber: 1 }); }
    getPageView() { return {}; }
    setDocument() {
      handlers.get('pagechanging')({ pageNumber: 1 });
      handlers.get('pagesinit')();
    }
  }
  Object.assign(f.material, { pdfDocument: {}, pdfAttachmentId: 'file', pdfPageCount: 2 });
  Object.assign(f.context, {
    AbortController,
    document: { getElementById: () => root },
    window: { ForwardStepPdfjsReady: Promise.resolve({ viewer: {
      PDFViewer, EventBus: class { on(name, handler) { handlers.set(name, handler); } },
      PDFLinkService: class { setViewer() {} setDocument() {} }
    } }), requestAnimationFrame: callback => { frames.push(callback); } },
    disposeWorkbenchPdfViewer() {}, updateWorkbenchPdfControls() {},
    renderWorkbenchPdfAnnotationLayer() {}, renderWorkbenchPdfTextMarks() {},
    updateWorkbenchFit: () => new Promise(resolve => { resolveFit = resolve; }),
    getWorkbenchViewerState: project => project.workbenchViewerState.file,
    persist() { f.context.state.projects = JSON.parse(JSON.stringify(f.context.state.projects)); }
  });
  const start = app.indexOf('  function renderWorkbenchPdfPage(');
  vm.runInContext(app.slice(start, app.indexOf('  function renderWorkbenchOfficePage(', start)), f.context);
  f.context.renderWorkbenchPdfPage(f.project, f.attachment, f.viewer);
  await new Promise(resolve => setImmediate(resolve));
  handlers.get('pagechanging')({ pageNumber: 1 });
  assert.equal(f.viewer.pageIndex, 1, '适配期间的默认页事件不覆盖已保存页码');
  resolveFit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pdf.currentPageNumber, 2);
  assert.equal(f.viewer.pageIndex, 1);
  for (const frame of frames) frame();
  assert.equal(container.scrollTop, 250, 'fit 模式不写回旧滚动偏移');
  f.material.fitting = true;
  handlers.get('pagechanging')({ pageNumber: 1 });
  assert.equal(f.viewer.pageIndex, 1, '缩放引发的中间页事件不覆盖当前页');
  f.material.fitting = false;
  f.context.state.projects = JSON.parse(JSON.stringify([f.project]));
  handlers.get('pagechanging')({ pageNumber: 1 });
  assert.equal(f.context.state.projects[0].workbenchViewerState.file.pageIndex, 0);
  handlers.get('pagechanging')({ pageNumber: 2 });
  assert.equal(f.context.state.projects[0].workbenchViewerState.file.pageIndex, 1);
});
