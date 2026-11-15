const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const app = fs.readFileSync(process.env.WORKBENCH_APP_SOURCE || path.join(__dirname, '../prototype/app.js'), 'utf8');
const start = app.indexOf('  function getWorkbenchOpenAttachments(');
const draftStart = app.indexOf('  function syncWorkbenchAnnotationDraft(');
for (const kind of ['Pdf', 'Html']) test(`${kind} 未保存批注按资料保存选区与意见，返回原标签恢复且不串到其他资料`, () => {
  assert.notEqual(draftStart, -1);
  const context = { window: { addEventListener() {} }, document: { addEventListener() {} } };
  vm.createContext(context);
  vm.runInContext(app.slice(draftStart, start), context);
  const project = { workbenchAttachmentId: 'a' };
  const selected = { attachmentId: 'a', contentHash: 'v1', target: { exact: '原文' } };
  const material = { annotationAttachmentId: null, annotationDrafts: new Map(), attachments: [
    { id: 'a', sha256: 'v1' }, { id: 'b', sha256: 'v2' }
  ], pendingPdfTarget: kind === 'Pdf' ? selected : null, pendingHtmlTarget: kind === 'Html' ? selected : null, pendingOfficeTarget: null,
  newAnnotationDraft: '修改原文', pendingReassociationId: '', annotationOpen: true,
  tool: 'text', intent: 'modify', category: 'other' };
  context.syncWorkbenchAnnotationDraft(project, material);
  project.workbenchAttachmentId = 'b';
  context.syncWorkbenchAnnotationDraft(project, material);
  assert.equal(material[`pending${kind}Target`], null);
  assert.equal(material.newAnnotationDraft, '');
  material.newAnnotationDraft = '另一份意见';
  project.workbenchAttachmentId = 'a';
  context.syncWorkbenchAnnotationDraft(project, material);
  assert.equal(material[`pending${kind}Target`], selected);
  assert.equal(material.newAnnotationDraft, '修改原文');
  assert.equal(material.tool, 'text');
  assert.equal(material.annotationOpen, true);
  project.workbenchAttachmentId = 'b';
  context.syncWorkbenchAnnotationDraft(project, material);
  assert.equal(material.newAnnotationDraft, '另一份意见');
});
for (const kind of ['Pdf', 'Html']) test(`${kind} 当前资料版本变化时不再显示旧选区，保留意见`, () => {
  const context = { window: { addEventListener() {} }, document: { addEventListener() {} } };
  vm.createContext(context);
  vm.runInContext(app.slice(draftStart, start), context);
  const project = { workbenchAttachmentId: 'a' };
  const selected = { attachmentId: 'a', contentHash: 'v1', target: { exact: '旧原文' } };
  const material = { annotationAttachmentId: null, annotationDrafts: new Map(), attachments: [{ id: 'a', sha256: 'v1' }],
    pendingPdfTarget: kind === 'Pdf' ? selected : null, pendingHtmlTarget: kind === 'Html' ? selected : null,
    newAnnotationDraft: '核对新版原文', annotationOpen: true, tool: 'text' };
  context.syncWorkbenchAnnotationDraft(project, material);
  material.attachments[0].sha256 = 'v2';
  context.syncWorkbenchAnnotationDraft(project, material);
  assert.equal(material[`pending${kind}Target`], null);
  assert.equal(material.newAnnotationDraft, '核对新版原文');
});
test('全部标签关闭后恢复原资料草稿，版本变化时不恢复旧选区', () => {
  const context = { window: { addEventListener() {} }, document: { addEventListener() {} } };
  vm.createContext(context);
  vm.runInContext(app.slice(draftStart, start), context);
  const project = { workbenchAttachmentId: 'a' };
  const material = { annotationAttachmentId: null, annotationDrafts: new Map(), attachments: [{ id: 'a', sha256: 'v1' }],
    pendingOfficeTarget: { attachmentId: 'a', contentHash: 'v1', target: { exact: '旧文' } },
    newAnnotationDraft: '核对旧文', annotationOpen: true, tool: 'text' };
  context.syncWorkbenchAnnotationDraft(project, material);
  project.workbenchAttachmentId = '';
  context.syncWorkbenchAnnotationDraft(project, material);
  assert.equal(material.pendingOfficeTarget, null);
  material.attachments[0].sha256 = 'v2';
  project.workbenchAttachmentId = 'a';
  context.syncWorkbenchAnnotationDraft(project, material);
  assert.equal(material.newAnnotationDraft, '核对旧文');
  assert.equal(material.pendingOfficeTarget, null);
});
function fixture() {
  assert.notEqual(start, -1, '标签开关实现存在');
  const layouts = new Map();
  const context = {
    window: { addEventListener() {} }, document: { addEventListener() {} },
    getWorkbenchSessionLayout(project) {
      if (!layouts.has(project.id)) layouts.set(project.id, { mode: 'chat', ratio: 0.5, lastSide: 'chat' });
      return layouts.get(project.id);
    }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, app.indexOf('  function renderWorkbenchMaterial(', start)), context);
  const attachments = ['a', 'b', 'c'].map(id => ({ id }));
  const project = { id: 'task', workbenchAttachmentId: 'b',
    conversationDraft: '未发送的想法', workbenchViewerState: { b: { pageIndex: 1, zoom: 1.25, scrollTop: 125 } } };
  return { context, project, attachments, layouts };
}
test('关闭当前资料选右侧相邻标签，原资料、意见草稿和查看位置仍保留', () => {
  const { context, project, attachments } = fixture();
  context.closeWorkbenchAttachment(project, 'b', attachments);
  assert.equal(project.workbenchAttachmentId, 'c');
  assert.deepEqual(Array.from(project.workbenchClosedAttachmentIds), ['b']);
  assert.equal(attachments.length, 3);
  assert.equal(project.conversationDraft, '未发送的想法');
  assert.deepEqual(project.workbenchViewerState.b, { pageIndex: 1, zoom: 1.25, scrollTop: 125 });
});
test('关闭末尾当前标签改选左侧，关闭非当前标签保持当前资料', () => {
  const { context, project, attachments } = fixture();
  context.closeWorkbenchAttachment(project, 'a', attachments);
  assert.equal(project.workbenchAttachmentId, 'b');
  context.openWorkbenchAttachment(project, 'c');
  context.closeWorkbenchAttachment(project, 'c', attachments);
  assert.equal(project.workbenchAttachmentId, 'b');
});
test('关闭最后资料回到对话；主动重开资料不改变布局', () => {
  const { context, project, attachments, layouts } = fixture();
  for (const attachment of attachments) context.closeWorkbenchAttachment(project, attachment.id, attachments);
  assert.equal(project.workbenchAttachmentId, '');
  assert.equal(layouts.get(project.id).mode, 'chat');
  const restored = JSON.parse(JSON.stringify(project));
  assert.equal(context.getWorkbenchOpenAttachments(restored, attachments).length, 0);
  context.openWorkbenchAttachment(restored, 'b');
  assert.equal(layouts.get(project.id).mode, 'chat');
  assert.equal(restored.workbenchPreviewMode, 'material');
  assert.equal(restored.workbenchViewerState.b.pageIndex, 1);
  assert.equal(context.getWorkbenchOpenAttachments(restored, attachments)[0].id, 'b');
});
test('关闭最后资料时优先返回最近实际查看且仍有效的内容', () => {
  const { context, project, attachments, layouts } = fixture();
  context.getWorkbenchSessionLayout(project);
  project.idea = '整理周报';
  project.workbenchGeneratedPrompt = '已有提示词';
  project.workbenchVisitedPreviewModes = ['task', 'prompt'];
  layouts.get(project.id).mode = 'preview';
  context.closeWorkbenchAttachment(project, 'b', attachments);
  context.closeWorkbenchAttachment(project, 'c', attachments);
  context.closeWorkbenchAttachment(project, 'a', attachments);
  assert.equal(project.workbenchPreviewMode, 'prompt');
  assert.equal(layouts.get(project.id).mode, 'preview');
});
test('已关闭资料由来源跳转重开时不清除其他资料的关闭状态', () => {
  const { context, project, attachments } = fixture();
  project.workbenchClosedAttachmentIds = ['a', 'b'];
  context.openWorkbenchAttachment(project, 'b');
  assert.deepEqual(Array.from(project.workbenchClosedAttachmentIds), ['a']);
  assert.equal(project.workbenchAttachmentId, 'b');
  assert.deepEqual(Array.from(context.getWorkbenchOpenAttachments(project, attachments), item => item.id), ['b', 'c']);
});
test('旧任务没有关闭列表时保持全部标签，其他任务状态不受影响', () => {
  const { context, project, attachments } = fixture();
  const other = { id: 'other', workbenchAttachmentId: 'a' };
  assert.equal(context.getWorkbenchOpenAttachments(project, attachments).length, 3);
  context.closeWorkbenchAttachment(project, 'b', attachments);
  assert.equal(context.getWorkbenchOpenAttachments(other, attachments).length, 3);
  assert.equal(other.workbenchAttachmentId, 'a');
});
test('重复关闭和未知标签不改变当前查看与关闭列表', () => {
  const { context, project, attachments } = fixture();
  context.closeWorkbenchAttachment(project, 'b', attachments);
  const previous = JSON.stringify(project);
  context.closeWorkbenchAttachment(project, 'b', attachments);
  context.closeWorkbenchAttachment(project, 'missing', attachments);
  assert.equal(JSON.stringify(project), previous);
});
test('工作区备份恢复保留关闭标签、页码和批注来源关系', () => {
  const file = path.join(__dirname, '../prototype/workspace-backup.js');
  const scope = { module: { exports: {} }, require: createRequire(file) };
  vm.runInNewContext(fs.readFileSync(process.env.WORKBENCH_BACKUP_SOURCE || file, 'utf8'), scope);
  const { createBackup, replaceState } = scope.module.exports;
  const state = { projects: [{ id: 'task', workbenchAttachmentId: '', workbenchClosedAttachmentIds: ['a', 'b'],
    workbenchAttachmentIds: ['a', 'b'], workbenchLayout: 'chat', workbenchViewerState: { b: { zoom: 1.25, pageIndex: 1 } } }] };
  const restored = replaceState({}, JSON.parse(JSON.stringify(createBackup(state))));
  assert.deepEqual(Array.from(restored.projects[0].workbenchClosedAttachmentIds || []), ['a', 'b']);
  assert.equal(restored.projects[0].workbenchViewerState.b.pageIndex, 1);
  assert.deepEqual(Array.from(restored.projects[0].workbenchAttachmentIds), ['a', 'b']);
});
test('异步刷新附件清单不自动打开已关闭的全部标签', async () => {
  const { context, project, attachments } = fixture();
  Object.assign(project, { workbenchClosedAttachmentIds: ['a', 'b', 'c'], workbenchAttachmentId: '', workbenchLayout: 'chat' });
  const material = { attachments: [], annotations: [] };
  Object.assign(context, {
    state: { projects: [project] }, activeProjectId: project.id, getWorkbenchMaterialState: () => material,
    renderWorkbench() {}, desktopApi: { pptFeedback: {
      listAttachments: async () => ({ attachments }), listAnnotations: async () => ({ annotations: [] }),
      listDeletedAttachments: async () => ({ attachments: [] })
    } }
  });
  vm.runInContext('function persist() { state = JSON.parse(JSON.stringify(state)); }', context);
  vm.runInContext(app.slice(app.indexOf('  async function refreshWorkbenchMaterials('), app.indexOf('  function scheduleWorkbenchDraftSave(')), context);
  await context.refreshWorkbenchMaterials(project);
  assert.equal(context.state.projects[0].workbenchAttachmentId, '');
  assert.equal(context.state.projects[0].workbenchLayout, 'chat');
  assert.equal(context.getWorkbenchOpenAttachments(context.state.projects[0], material.attachments).length, 0);
});
