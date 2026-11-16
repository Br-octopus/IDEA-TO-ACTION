const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../prototype/app.js'), 'utf8');
const start = app.indexOf('  let workbenchLongPaste = null;');
const end = app.indexOf('  function createWorkbenchCanvas(project) {', start);
assert.ok(start >= 0 && end > start);
const conversionSource = app.slice(start, end);

function fixture(persistResult = true) {
  const pastedText = '正文'.repeat(420);
  const originalText = `补充意见：保留这句\n${pastedText}\n后续意见：也保留`;
  const project = {
    id: 'task-1', conversationDraft: originalText, workbenchContents: [],
    workbenchOpenContentId: 'previous', workbenchMaterialPanel: 'chat', workbenchPreviewMode: 'chat'
  };
  const input = {
    value: originalText, selectionStart: 0, selectionEnd: 0,
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.selectionStart = this.selectionEnd = start + text.length;
    },
    dispatchEvent() { context.updateWorkbenchPasteAction(); }
  };
  const button = { hidden: false };
  const calls = { persist: 0, render: 0, clearTimeout: 0 };
  const context = {
    Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    document: {
      getElementById: id => id === 'workbench-message-input' ? input : null,
      querySelector: selector => selector === '[data-workbench-convert-paste]' ? button : { focus() {} }
    },
    getActiveProject: () => project,
    ensureWorkbenchProjectData: current => { current.workbenchContents ||= []; },
    workbenchId: () => 'document-1',
    setWorkbenchPreviewMode: (current, mode) => { current.workbenchPreviewMode = mode; return true; },
    workbenchDraftSaveTimer: 1,
    clearTimeout: () => { calls.clearTimeout++; },
    persist: () => { calls.persist++; return persistResult; },
    renderWorkbench: current => { calls.render++; input.value = current.conversationDraft; }
  };
  vm.createContext(context);
  vm.runInContext(conversionSource, context);
  vm.runInContext(`workbenchLongPaste = ${JSON.stringify({ projectId: project.id, text: pastedText })}`, context);
  return { context, project, input, button, calls, pastedText, originalText };
}

test('长粘贴转文档后保留前后意见并一次保存', () => {
  const state = fixture();
  assert.equal(state.context.transferWorkbenchPasteToDocument(), true);
  assert.equal(state.project.workbenchContents.length, 1);
  assert.equal(state.project.workbenchContents[0].draft.text, state.pastedText);
  assert.equal(state.project.conversationDraft, '补充意见：保留这句\n\n后续意见：也保留');
  assert.equal(state.input.value, state.project.conversationDraft);
  assert.equal(state.button.hidden, true);
  assert.equal(state.calls.persist, 1);
  assert.equal(state.calls.clearTimeout, 1);
});

test('文档保存失败时保留原输入且撤回未保存文档', () => {
  const state = fixture(false);
  assert.equal(state.context.transferWorkbenchPasteToDocument(), false);
  assert.equal(state.project.workbenchContents.length, 0);
  assert.equal(state.project.conversationDraft, state.originalText);
  assert.equal(state.input.value, state.originalText);
  assert.equal(state.project.workbenchOpenContentId, 'previous');
  assert.equal(state.project.workbenchPreviewMode, 'chat');
  assert.equal(state.button.hidden, false);
  assert.equal(state.calls.persist, 1);
  assert.equal(state.calls.render, 0);
});

test('长粘贴保留原输入并显示转文档按钮', () => {
  const state = fixture();
  vm.runInContext('workbenchLongPaste = null', state.context);
  const body = '粘贴正文'.repeat(240);
  state.input.value = '已有意见\n结尾意见';
  state.input.selectionStart = state.input.selectionEnd = '已有意见\n'.length;
  let prevented = false;
  state.context.handleWorkbenchPaste({
    currentTarget: state.input,
    clipboardData: { getData: type => type === 'text/plain' ? body : '' },
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(state.input.value, `已有意见\n${body}结尾意见`);
  assert.equal(state.button.hidden, false);
});

test('短粘贴不显示转文档按钮，长正文阈值按字符数或行数判断', () => {
  const state = fixture();
  state.button.hidden = false;
  state.context.handleWorkbenchPaste({
    currentTarget: state.input,
    clipboardData: { getData: () => '短回复' },
    preventDefault() { assert.fail('短粘贴应保留浏览器默认处理'); }
  });
  assert.equal(state.button.hidden, true);
  assert.equal(state.context.isWorkbenchLongPaste('字'.repeat(799)), false);
  assert.equal(state.context.isWorkbenchLongPaste('字'.repeat(800)), true);
  assert.equal(state.context.isWorkbenchLongPaste(Array(7).fill('行').join('\n')), false);
  assert.equal(state.context.isWorkbenchLongPaste(Array(8).fill('行').join('\n')), true);
});
