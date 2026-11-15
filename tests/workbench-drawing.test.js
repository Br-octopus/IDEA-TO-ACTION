const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const feedback = require('../prototype/ppt-feedback.js');
const { normalizePptAnnotation } = require('../prototype/ppt-feedback-schema.js');

const app = fs.readFileSync(process.env.WORKBENCH_APP_SOURCE || path.join(__dirname, '../prototype/app.js'), 'utf8');
const drawingSource = app.slice(app.indexOf('  let workbenchDrawing = null;'), app.indexOf('  ["workbench-open-details"'));
const historyStart = app.indexOf('  async function saveWorkbenchAnnotation(');
const historySource = app.slice(historyStart, app.indexOf('  document.getElementById("workbench-add-material")', historyStart));
const layerSource = app.slice(app.indexOf('  function workbenchOfficeAnnotationLayer('), app.indexOf('  function officeSelectionTarget('));
const notesSource = app.slice(app.indexOf('    const annotationList = currentAnnotations.map('), app.indexOf('    const zoomControl ='));

function renderNote(annotation, kind) {
  const context = {
    currentAnnotations: [annotation], selected: { kind, sha256: 'current-hash' },
    material: {}, conflictingAnnotationIds: new Set(), workbenchAnnotationIntentLabels: {},
    escapeHtml: value => String(value)
  };
  vm.runInNewContext(notesSource + '; this.markup = annotationList;', context);
  return context.markup;
}

function drawingFixture(kind, tool, reassociate = false) {
  const pageIndex = kind === 'image' ? 0 : 1;
  const attachment = { id: 'material', taskId: 'task', sha256: 'current-hash', kind };
  const project = { id: 'task', workbenchAttachmentId: attachment.id };
  const original = normalizePptAnnotation({
    id: 'original', taskId: project.id, attachmentId: 'old-material', contentHash: 'old-hash',
    pageIndex: 0, target: { kind: 'point', x: 0.1, y: 0.2 }, comment: '原意见', selected: true
  });
  const records = new Map(reassociate ? [[original.id, original]] : []);
  const material = {
    attachments: [attachment], annotations: [...records.values()], annotationOpen: true, tool,
    pendingReassociationId: reassociate ? original.id : '', annotationHistory: feedback.createAnnotationHistory()
  };
  const listeners = {};
  const draft = { innerHTML: '', replaceChildren() { this.innerHTML = ''; } };
  const overlay = {
    dataset: { pageIndex: String(pageIndex) },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    closest: () => overlay, querySelector: () => draft, setPointerCapture() {}
  };
  const nodes = {
    'workbench-material-view': { addEventListener: (name, listener) => { listeners[name] = listener; } },
    'workbench-material-comment': { value: '修改第二页，保留其他内容', focus() {} },
    'workbench-material-intent': { value: 'modify' },
    'workbench-material-category': { value: 'layout' }
  };
  let renderedAnnotations;
  const context = {
    document: {
      getElementById: id => nodes[id],
      createElement: () => ({ content: { firstElementChild: {} } })
    },
    desktopApi: { pptFeedback: { saveAnnotation: async input => {
      const annotation = normalizePptAnnotation({ ...input, id: input.id || 'saved' });
      records.set(annotation.id, annotation);
      return { status: 'ok', annotation };
    } } },
    feedback, toast() {}, getActiveProject: () => project,
    getWorkbenchMaterialState: () => material,
    getWorkbenchViewerState: () => ({ pageIndex: 0 }),
    refreshWorkbenchMaterials: async () => { material.annotations = [...records.values()]; },
    workbenchMaterialSvg: annotations => { renderedAnnotations = annotations; return ''; }
  };
  vm.runInNewContext(historySource + drawingSource + layerSource
    + '; this.replay = replayWorkbenchAnnotationHistory; this.renderLayer = workbenchOfficeAnnotationLayer;', context);
  const event = (x, y) => ({ pointerId: 1, button: 0, clientX: x, clientY: y, target: overlay });
  return {
    material, records, original, pageIndex, context,
    async draw(cancel = false) {
      listeners.pointerdown(event(100, 200));
      listeners.pointermove(event(250, 300));
      if (cancel) listeners.pointercancel(event(250, 300));
      await listeners.pointerup(event(500, 600));
    },
    replay: direction => context.replay(project, direction),
    renderPage(index) {
      context.renderLayer(project, attachment, index, { querySelector: () => null, appendChild() {} });
      return renderedAnnotations.map(annotation => annotation.id);
    }
  };
}

for (const kind of ['image', 'pdf', 'docx', 'pptx']) {
  for (const tool of ['point', 'region', 'arrow', 'path']) {
    for (const reassociate of [false, true]) {
      test(`${kind} ${tool} ${reassociate ? '重新关联' : '新增'}保留绘制页，撤销重做及重载不串页`, async () => {
        const fixture = drawingFixture(kind, tool, reassociate);
        await fixture.draw();
        const saved = [...fixture.records.values()].find(annotation => annotation.id !== 'original');
        assert.ok(saved, fixture.material.error);
        assert.equal(saved.target.kind, tool);
        assert.equal(saved.pageIndex, fixture.pageIndex);
        assert.equal(saved.attachmentId, 'material');
        assert.equal(saved.contentHash, 'current-hash');
        assert.ok(renderNote(saved, kind).includes(`data-workbench-locate-annotation="${saved.id}"`), '批注列表提供返回原处入口');
        if (reassociate) {
          assert.equal(saved.reassociatedFromId, 'original');
          assert.deepEqual(fixture.records.get('original'), fixture.original);
        }
        await fixture.replay('undo');
        assert.equal(fixture.records.get(saved.id).status, 'deleted');
        await fixture.replay('redo');
        assert.equal(fixture.records.get(saved.id).status, 'active');
        assert.equal(fixture.records.get(saved.id).pageIndex, fixture.pageIndex);
        fixture.material.annotations = JSON.parse(JSON.stringify([...fixture.records.values()]));
        if (['docx', 'pptx'].includes(kind)) {
          assert.deepEqual(fixture.renderPage(0), []);
          assert.deepEqual(fixture.renderPage(1), [saved.id]);
        }
      });
    }
  }
}

test('Office 元素批注重开后在原页恢复对象框，且不串到其他页', () => {
  const material = { annotations: [
    { id: 'object', attachmentId: 'office', contentHash: 'hash', pageIndex: 1, status: 'active', target: {
      kind: 'element', selector: 'ooxml:pptx:page:2:shape:shape-7', excerpt: '标题',
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, rotation: 15 }
    } },
    { id: 'other-page', attachmentId: 'office', contentHash: 'hash', pageIndex: 0, status: 'active', target: {
      kind: 'element', selector: 'ooxml:pptx:page:1:shape:shape-2', bounds: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 }
    } },
    { id: 'old-version', attachmentId: 'office', contentHash: 'old-hash', pageIndex: 1, status: 'active', target: {
      kind: 'element', selector: 'ooxml:pptx:page:2:shape:shape-3', bounds: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 }
    } }
  ] };
  let markup = '';
  const template = { content: { firstElementChild: {} }, set innerHTML(value) { markup = value; } };
  const context = {
    getWorkbenchMaterialState: () => material,
    document: { createElement: () => template },
    workbenchMaterialSvg: annotations => renderWorkbenchMaterialMarks(annotations),
    escapeHtml: value => String(value)
  };
  vm.runInNewContext(app.slice(app.indexOf('  function renderWorkbenchMaterialMarks('), app.indexOf('  function disposeWorkbenchPdfViewer('))
    + layerSource + '; this.renderLayer = workbenchOfficeAnnotationLayer;', context);
  const appended = [];
  context.renderLayer({ id: 'task' }, { id: 'office', kind: 'pptx', sha256: 'hash' }, 1, {
    querySelector: () => null, appendChild: node => appended.push(node)
  });
  assert.equal(appended.length, 1);
  assert.match(markup, /class="workbench-material-mark" x="100" y="200" width="300" height="400" transform="rotate\(15 250 400\)"/);
  assert.equal((markup.match(/class="workbench-material-mark"/g) || []).length, 1, '其他页和旧版本的对象框不显示');
});

test('待保存的 Office 元素选区仅在当前任务、资料版本和页码显示虚线框', () => {
  const attachment = { id: 'office', kind: 'pptx', sha256: 'hash' };
  const project = { id: 'task', workbenchAttachmentId: attachment.id };
  const material = { annotations: [], pendingOfficeTarget: null };
  const template = { content: { firstElementChild: {} }, set innerHTML(value) { this.markup = value; } };
  const context = {
    getWorkbenchMaterialState: () => material,
    document: { createElement: () => template },
    workbenchMaterialSvg: annotations => renderWorkbenchMaterialMarks(annotations),
    escapeHtml: value => String(value)
  };
  vm.runInNewContext(app.slice(app.indexOf('  function renderWorkbenchMaterialMarks('), app.indexOf('  function disposeWorkbenchPdfViewer('))
    + layerSource + '; this.renderLayer = workbenchOfficeAnnotationLayer;', context);
  const pending = { taskId: 'task', attachmentId: 'office', contentHash: 'hash', pageIndex: 1, target: {
    kind: 'element', selector: 'ooxml:pptx:page:2:shape:shape-8',
    bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
  } };
  const render = (selection, pageIndex = 1) => {
    material.pendingOfficeTarget = selection;
    context.renderLayer(project, attachment, pageIndex, { querySelector: () => null, appendChild() {} });
    return template.markup;
  };

  assert.match(render(pending), /class="workbench-material-mark workbench-material-mark-draft" x="100" y="200" width="300" height="400"/);
  for (const changed of [
    { ...pending, taskId: 'other' },
    { ...pending, attachmentId: 'other' },
    { ...pending, contentHash: 'old-hash' },
    { ...pending, target: { ...pending.target, selector: 'ooxml:docx:page:2:shape:shape-8' } },
    { ...pending, target: { ...pending.target, bounds: { ...pending.target.bounds, width: 0 } } }
  ]) assert.doesNotMatch(render(changed), /workbench-material-mark-draft/);
  assert.doesNotMatch(render(pending, 0), /workbench-material-mark-draft/);
});

test('过期或撤销的绘制批注保留定位入口但禁止跳转', () => {
  for (const status of ['stale', 'deleted']) {
    const markup = renderNote({ id: 'old', contentHash: 'current-hash', status, target: { kind: 'arrow' } }, 'pptx');
    assert.match(markup, /data-workbench-locate-annotation="old" disabled/);
  }
});

for (const tool of ['region', 'arrow', 'path']) {
  test(`${tool} 指针取消后松开不新增批注`, async () => {
    const fixture = drawingFixture('pptx', tool);
    await fixture.draw(true);
    assert.equal(fixture.records.size, 0);
    assert.equal(fixture.material.annotationHistory.canUndo(), false);
  });
}
