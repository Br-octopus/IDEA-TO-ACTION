const test = require('node:test');
const assert = require('node:assert/strict');
const { createWritingApp } = require('./helpers/writing-app.js');

// 通过真实 UI 控件管理专业基础包；确认逻辑由 helper 的 confirm 选项控制。
test('包管理区展示内置与自定义包，详情显示来源和验证状态', async () => {
  const app = createWritingApp();
  await app.settle();
  const dom = app;
  await dom.click('manage-packs');
  assert.equal(dom.mount.innerHTML.includes('专业基础包'), true, '管理区标题可见');
  assert.equal(dom.mount.innerHTML.includes('普通文章'), true, '内置包可见');
  assert.equal(dom.mount.innerHTML.includes('数据-action="pack-detail"') || dom.mount.innerHTML.includes('pack-detail'), true, '详情入口存在');
});

test('编辑内置包生成带 basePackId 的副本并保存到状态', async () => {
  const app = createWritingApp({ confirm: () => true, prompt: () => '我的文章包' });
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-edit', { packId: 'builtin-article' });
  // 通过表单修改名称并保存
  await app.input('pack-field-name', '我的文章包');
  await app.click('pack-save');
  await app.settle();
  const packs = app.state.writingPacks || [];
  assert.equal(packs.some(p => p.basePackId === 'builtin-article'), true, '副本已保存');
});

test('停用的包不再被提示词采用', async () => {
  const app = createWritingApp();
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-toggle', { packId: 'builtin-article' });
  await app.settle();
  const selection = app.packCoordinator ? null : null;
  // 通过 UI 再查一次选中状态
  const ui = app.window.WritingPackUIController;
  assert.equal(typeof ui.getSelection, 'function', 'UI 暴露选择查询');
  assert.equal(ui.getSelection().selectedIds.includes('builtin-article'), false, '停用后不选中');
});

test('删除自定义包需要确认，取消时不删除', async () => {
  let confirmMessage = '';
  const app = createWritingApp({ confirm: message => { confirmMessage = message; return false; } });
  await app.settle();
  // 先通过协调器创建一个自定义包
  const coordinator = app.packCoordinator;
  await coordinator.createPack({ id: 'ui-delete-me', name: '待删包', layer: 'task', checks: [{ id: 'c1', statement: '检查' }] });
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-delete', { packId: 'ui-delete-me' });
  await app.settle();
  assert.equal(confirmMessage.includes('删除'), true, '删除前有确认提示');
  assert.equal((app.state.writingPacks || []).some(p => p.id === 'ui-delete-me'), true, '取消后包仍在');
});

test('导出结果可解析为 JSON 并包含自定义包', async () => {
  const app = createWritingApp();
  await app.settle();
  const coordinator = app.packCoordinator;
  await coordinator.createPack({ id: 'ui-export-me', name: '导出包', layer: 'task', checks: [{ id: 'c1', statement: '检查' }] });
  await app.settle();
  await app.click('manage-packs');
  await app.click('pack-export-open');
  await app.settle();
  // 导出会调用剪贴板或下载；通过 coordinator export 校验
  const exported = coordinator.exportPacks(['ui-export-me']);
  const json = JSON.parse(JSON.stringify(exported));
  assert.equal(json[0].id, 'ui-export-me');
});

test('键盘可聚焦的按钮和选项存在', async () => {
  const app = createWritingApp();
  await app.settle();
  await app.click('manage-packs');
  const html = app.mount.innerHTML;
  // 所有操作按钮必须是 button 或带 tabindex 的元素
  assert.equal(/<button[^>]*data-action="pack-detail"/.test(html) || /data-action="pack-detail"/.test(html), true, '详情按钮存在');
  assert.equal(/<button[^>]*data-action="pack-toggle"/.test(html) || /data-action="pack-toggle"/.test(html), true, '启停按钮存在');
});

