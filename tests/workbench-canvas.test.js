const test = require('node:test');
const assert = require('node:assert/strict');
const canvasOps = require('../prototype/workbench-canvas.js');

test('画布操作返回新状态并允许多个画布引用同一内容版本', () => {
  const first = canvasOps.createCanvas({ id: 'c1', title: '参考' });
  const second = canvasOps.createCanvas({ id: 'c2', title: '结果', purpose: 'result' });
  const withNode = canvasOps.addCanvasNode(first, { id: 'n1', contentVersionId: 'v1', position: { x: 10, y: 20 }, size: { width: 100, height: 80 } });
  const secondWithNode = canvasOps.addCanvasNode(second, { id: 'n2', contentVersionId: 'v1' });
  assert.equal(first.nodes.length, 0);
  assert.equal(withNode.nodes[0].contentVersionId, secondWithNode.nodes[0].contentVersionId);
  assert.deepEqual(first.viewport, { x: 0, y: 0, zoom: 1 });
});

test('移动缩放和分组只影响目标节点，移除节点不触碰原件引用方', () => {
  const original = canvasOps.createCanvas({ id: 'c1', nodes: [{ id: 'n1', contentVersionId: 'v1' }, { id: 'n2', contentVersionId: 'v2' }] });
  const updated = canvasOps.updateCanvasNode(original, 'n1', { position: { x: 24 }, size: { width: 300 }, groupId: 'g1' });
  const removed = canvasOps.removeCanvasNode(updated, 'n2');
  assert.equal(original.nodes[0].position.x, 0);
  assert.equal(updated.nodes[0].position.x, 24);
  assert.equal(updated.nodes[0].position.y, 0);
  assert.equal(updated.nodes[0].size.width, 300);
  assert.equal(removed.nodes.length, 1);
  assert.equal(removed.nodes[0].contentVersionId, 'v1');
});

test('复制画布重建节点、分组与局部批注 ID 但保持版本引用', () => {
  const source = canvasOps.createCanvas({ id: 'c1', title: '布局', groups: [{ id: 'g1', title: '组' }], nodes: [{
    id: 'n1', contentVersionId: 'v1', groupId: 'g1', annotations: [{ id: 'a1', annotationId: 'a1', comment: '保留主体' }]
  }] });
  let next = 0;
  const copy = canvasOps.copyCanvas(source, { id: 'c2', idFactory: () => `new-${++next}` });
  assert.notEqual(copy.nodes[0].id, source.nodes[0].id);
  assert.notEqual(copy.groups[0].id, source.groups[0].id);
  assert.equal(Object.prototype.hasOwnProperty.call(copy, 'idFactory'), false);
  assert.equal(copy.nodes[0].groupId, copy.groups[0].id);
  assert.notEqual(copy.nodes[0].annotations[0].id, source.nodes[0].annotations[0].id);
  assert.notEqual(copy.nodes[0].annotations[0].annotationId, source.nodes[0].annotations[0].annotationId);
  assert.equal(copy.nodes[0].contentVersionId, source.nodes[0].contentVersionId);
  assert.equal(source.nodes[0].id, 'n1');
});

test('本轮素材清单与普通画布选择分离并保留跨画布局部引用', () => {
  const empty = { items: [], layoutIntent: { enabled: false } };
  const first = canvasOps.setPromptSelection(empty, { contentVersionId: 'v1', canvasId: 'c1', nodeId: 'n1' }, true);
  const second = canvasOps.setPromptSelection(first, { contentVersionId: 'v1', canvasId: 'c2', nodeId: 'n2' }, true);
  const removed = canvasOps.setPromptSelection(second, { contentVersionId: 'v1', canvasId: 'c1', nodeId: 'n1' }, false);
  assert.equal(empty.items.length, 0);
  assert.equal(second.items.length, 2);
  assert.deepEqual(removed.items.map(item => item.nodeId), ['n2']);
});

test('构图意图只记录选择节点的内容坐标、比例和叠放顺序', () => {
  const canvas = canvasOps.createCanvas({ id: 'c1', viewport: { x: 500, y: 700, zoom: 4 }, nodes: [
    { id: 'n1', contentVersionId: 'v1', position: { x: 100, y: 200 }, size: { width: 200, height: 100 }, zIndex: 1 },
    { id: 'n2', contentVersionId: 'v2', position: { x: 400, y: 250 }, size: { width: 100, height: 50 }, zIndex: 3 }
  ] });
  assert.deepEqual(canvasOps.captureLayoutIntent(canvas, ['n1'], false), { enabled: false });
  const layout = canvasOps.captureLayoutIntent(canvas, ['n1', 'n2'], true);
  assert.deepEqual(layout.bounds, { x: 100, y: 200, width: 400, height: 100 });
  assert.deepEqual(layout.nodes.map(node => [node.x, node.y, node.width, node.height, node.zIndex]), [[0, 0, 0.5, 1, 1], [0.75, 0.5, 0.25, 0.5, 3]]);
  assert.equal(layout.nodes[1].x, 0.75);
  assert.throws(() => canvasOps.captureLayoutIntent(canvas, [], true), /至少一个节点/);
});
