const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'prototype', 'app.js'), 'utf8');
const start = app.indexOf('  async function addWorkbenchWebSnapshot(project) {');
const end = app.indexOf('  async function saveWorkbenchAnnotation(project, annotation,', start);
assert.ok(start >= 0 && end > start);
const source = app.slice(start, end);

function createHarness({ confirmChange = true, failUpdate = false, sameVersion = false } = {}) {
  const url = 'https://example.com/article';
  const html = '<main>新版本的公开网页内容。</main>';
  const newHash = `sha256:${crypto.createHash('sha256').update(html).digest('hex')}`;
  const old = {
    id: 'note-1', selected: true, status: 'active',
    target: { source: { url, contentHash: sameVersion ? newHash : `sha256:${'a'.repeat(64)}` } }
  };
  const material = { webUrl: url, webBusy: false, webError: '', annotations: [old] };
  const project = { id: 'task-1' };
  const calls = { confirms: [], snapshots: 0, updates: 0, refreshes: 0, opened: 0 };
  const snapshot = { renderMode: 'static-html', title: '新版网页', finalUrl: url, fetchedAt: '2026-11-13T00:00:00.000Z',
    contentHash: newHash, html, text: '新版本的公开网页内容。', incomplete: false };
  const context = {
    URL, TextEncoder, state: { projects: [project] }, activeProjectId: null,
    window: { confirm(message) { calls.confirms.push(message); return calls.confirms.length === 1 || confirmChange; } },
    globalThis: { fetch: async () => ({ ok: true, json: async () => snapshot }) },
    desktopApi: { pptFeedback: {
      saveWebSnapshot: async () => { calls.snapshots++; return { status: 'ok', attachment: { id: 'new-attachment' } }; },
      saveAnnotation: async updated => {
        calls.updates++;
        if (failUpdate) throw new Error('offline');
        Object.assign(old, updated);
        return { status: 'ok', annotation: updated };
      }
    } },
    getWorkbenchMaterialState: () => material, renderWorkbenchMaterial() {},
    openWorkbenchAttachment() { calls.opened++; }, persist() {},
    async refreshWorkbenchMaterials() { calls.refreshes++; }, toast() {}
  };
  const add = vm.runInNewContext(`${source}; addWorkbenchWebSnapshot`, context);
  return { add: () => add(project), calls, material, old };
}

test('网页内容变化时，取消操作保留旧批注；确认后才保存新版本并停用旧引用', async () => {
  const cancelled = createHarness({ confirmChange: false });
  await cancelled.add();
  assert.equal(cancelled.calls.snapshots, 0);
  assert.equal(cancelled.old.selected, true);
  assert.match(cancelled.calls.confirms[1], /内容版本已变化/);

  const accepted = createHarness();
  await accepted.add();
  assert.equal(accepted.calls.snapshots, 1);
  assert.equal(accepted.calls.updates, 1);
  assert.equal(accepted.old.selected, false);
  assert.equal(accepted.calls.opened, 1);
  assert.equal(accepted.material.webError, '');
});

test('内容未变不触发旧批注停用，停用失败明确告知并刷新批注状态', async () => {
  const same = createHarness({ sameVersion: true });
  await same.add();
  assert.equal(same.calls.confirms.length, 1);
  assert.equal(same.calls.updates, 0);
  assert.equal(same.old.selected, true);

  const failed = createHarness({ failUpdate: true });
  await failed.add();
  assert.equal(failed.calls.snapshots, 1);
  assert.equal(failed.calls.opened, 0);
  assert.equal(failed.old.selected, true);
  assert.equal(failed.calls.refreshes, 1);
  assert.match(failed.material.webError, /旧版批注未全部取消勾选/);
});
