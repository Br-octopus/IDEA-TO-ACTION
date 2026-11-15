const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveLayout, dragLayout } = require('../prototype/workbench-layout.js');
const app = fs.readFileSync(path.join(__dirname, '../prototype/app.js'), 'utf8');

test('原始指针决定吸附，最小栏宽不截断吸附判定', () => {
  const initial = { mode: 'split', ratio: 0.55, lastSide: 'chat' };
  assert.equal(dragLayout(initial, 20, 1000, true).mode, 'preview');
  assert.equal(dragLayout(initial, 980, 1000, true).mode, 'chat');
  const middle = dragLayout(initial, 80, 1000, true);
  assert.equal(middle.mode, 'split');
  assert.equal(Math.round(middle.ratio * 992), 360);
});

test('专注把手点击不切换，向内拖动恢复双栏', () => {
  const initial = { mode: 'chat', ratio: 0.6, lastSide: 'chat' };
  assert.deepEqual(dragLayout(initial, 999, 1000, false), initial);
  assert.deepEqual(dragLayout(initial, 980, 1000, true), initial);
  assert.equal(dragLayout(initial, 600, 1000, true).mode, 'split');
  assert.deepEqual(dragLayout(initial, 300, 600, true), initial);
});

test('窄屏临时单区不污染原比例，扩大后恢复双栏', () => {
  const saved = { mode: 'split', ratio: 0.6, lastSide: 'preview' };
  assert.equal(resolveLayout(saved, 600).mode, 'preview');
  assert.equal(resolveLayout(saved, 1000).mode, 'split');
  assert.equal(saved.ratio, 0.6);
  assert.equal(resolveLayout(saved, 688).chatWidth, 360);
});

test('窄屏分隔条的键盘调整不切换模式或污染恢复比例', () => {
  const start = app.indexOf('  function resizeWorkbenchByKeyboard(kind, event) {');
  const end = app.indexOf('  const navKeyByView', start);
  assert.ok(start >= 0 && end > start);
  const layout = { mode: 'chat', ratio: 0.6, lastSide: 'chat' };
  const context = {
    activeView: 'home',
    workbenchPreferences: { sidebarWidth: 260, splitRatio: 0.5 },
    document: { getElementById: () => ({ clientWidth: 600 }) },
    window: { ForwardStepWorkbenchLayout: { resolveLayout } },
    getActiveProject: () => null,
    getWorkbenchSessionLayout: () => layout,
    saveWorkbenchViewState() { this.viewSaved = true; },
    applyWorkbenchLayout() { this.layoutApplied = true; },
    saveWorkbenchLayoutPreferences() { this.preferenceSaved = true; }
  };
  const resize = vm.runInNewContext(`(function(){ ${app.slice(start, end)}; return resizeWorkbenchByKeyboard; })()`, context);
  let prevented = false;
  resize('content', { key: 'ArrowLeft', shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(layout.mode, 'chat');
  assert.equal(layout.ratio, 0.6);
  assert.equal(context.layoutApplied, undefined);
  assert.equal(context.preferenceSaved, undefined);
});
