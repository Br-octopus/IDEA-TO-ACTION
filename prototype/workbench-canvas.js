(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./unified-workbench-schema.js'), root);
  else root.ForwardStepWorkbenchCanvas = factory(root.ForwardStepUnifiedWorkbenchSchema, root);
})(typeof globalThis === 'undefined' ? this : globalThis, function (schema, root) {
  'use strict';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const list = value => Array.isArray(value) ? value : [];
  const text = value => typeof value === 'string' ? value.trim() : '';
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function createId(idFactory) {
    if (typeof idFactory === 'function') return text(idFactory()) || createId();
    if (typeof root?.crypto?.randomUUID !== 'function') throw new Error('当前环境不支持稳定 ID');
    return root.crypto.randomUUID();
  }

  function normalize(canvas) {
    if (!schema?.normalizeWorkbenchCanvas) throw new Error('工作台 schema 未加载');
    return clone(schema.normalizeWorkbenchCanvas(object(canvas)));
  }

  function createCanvas(input = {}) {
    const source = object(input);
    const { idFactory, ...fields } = source;
    return normalize({
      ...fields, id: text(source.id) || createId(idFactory), title: text(source.title) || '未命名画布',
      purpose: ['reference', 'result'].includes(source.purpose) ? source.purpose : 'reference',
      viewport: object(source.viewport), groups: list(source.groups), nodes: list(source.nodes)
    });
  }

  function addCanvasNode(canvas, node = {}) {
    const current = normalize(canvas);
    const source = object(node);
    const { idFactory, ...fields } = source;
    const id = text(source.id) || createId(idFactory);
    if (current.nodes.some(item => item.id === id)) throw new TypeError(`画布节点 ID 重复：${id}`);
    return normalize({ ...current, nodes: [...current.nodes, { ...fields, id }] });
  }

  function updateCanvasNode(canvas, nodeId, patch = {}) {
    const current = normalize(canvas);
    const id = text(nodeId);
    const index = current.nodes.findIndex(item => item.id === id);
    if (index < 0) throw new TypeError(`画布节点不存在：${id}`);
    const source = object(patch);
    const nodes = current.nodes.slice();
    const node = nodes[index];
    nodes[index] = { ...node, ...clone(source), id,
      position: source.position ? { ...node.position, ...source.position } : node.position,
      size: source.size ? { ...node.size, ...source.size } : node.size };
    return normalize({ ...current, nodes });
  }

  function removeCanvasNode(canvas, nodeId) {
    const current = normalize(canvas);
    const id = text(nodeId);
    if (!current.nodes.some(item => item.id === id)) throw new TypeError(`画布节点不存在：${id}`);
    return normalize({ ...current, nodes: current.nodes.filter(item => item.id !== id) });
  }

  function copyCanvas(canvas, input = {}) {
    const source = normalize(canvas);
    const { idFactory, ...options } = object(input);
    const groups = source.groups.map(group => ({ ...group, id: createId(idFactory) }));
    const groupIds = new Map(source.groups.map((group, index) => [group.id, groups[index].id]));
    const nodes = source.nodes.map(node => ({
      ...node, id: createId(idFactory), groupId: groupIds.get(node.groupId) || '',
      annotations: node.annotations.map(annotation => ({
        ...annotation, id: createId(idFactory),
        ...(annotation.annotationId ? { annotationId: createId(idFactory) } : {})
      }))
    }));
    return normalize({
      ...source, ...options, id: text(options.id) || createId(idFactory),
      title: text(options.title) || `${source.title || '未命名画布'}（副本）`,
      sourceCanvasId: source.id, groups, nodes, createdAt: new Date().toISOString()
    });
  }

  function sameSelection(left, right) {
    return left.contentVersionId === right.contentVersionId
      && (left.canvasId || '') === (right.canvasId || '')
      && (left.nodeId || '') === (right.nodeId || '')
      && (left.pageIndex ?? null) === (right.pageIndex ?? null)
      && JSON.stringify(left.region ?? null) === JSON.stringify(right.region ?? null);
  }

  function setPromptSelection(selection, item, selected) {
    const current = object(selection);
    const source = object(item);
    const contentVersionId = text(source.contentVersionId);
    if (!contentVersionId) throw new TypeError('本轮素材必须包含内容版本 ID');
    const candidate = { ...clone(source), contentVersionId };
    const items = list(current.items).map(clone);
    const index = items.findIndex(existing => sameSelection(existing, candidate));
    if (selected === true) {
      if (index >= 0) items[index] = candidate;
      else items.push(candidate);
    } else if (index >= 0) {
      items.splice(index, 1);
    }
    return { ...clone(current), items, layoutIntent: clone(current.layoutIntent || { enabled: false }) };
  }

  function captureLayoutIntent(canvas, nodeIds, enabled) {
    if (enabled !== true) return { enabled: false };
    const current = normalize(canvas);
    const ids = [...new Set(list(nodeIds).map(text).filter(Boolean))];
    if (!ids.length) throw new TypeError('启用构图意图时必须选择至少一个节点');
    const nodes = ids.map(id => {
      const node = current.nodes.find(item => item.id === id);
      if (!node) throw new TypeError(`画布节点不存在：${id}`);
      return node;
    });
    const left = Math.min(...nodes.map(node => node.position.x));
    const top = Math.min(...nodes.map(node => node.position.y));
    const right = Math.max(...nodes.map(node => node.position.x + node.size.width));
    const bottom = Math.max(...nodes.map(node => node.position.y + node.size.height));
    const width = right - left;
    const height = bottom - top;
    const widthBase = width || 1;
    const heightBase = height || 1;
    return {
      enabled: true, canvasId: current.id, bounds: { x: left, y: top, width, height },
      nodes: nodes.map(node => ({
        nodeId: node.id, contentVersionId: node.contentVersionId,
        x: (node.position.x - left) / widthBase, y: (node.position.y - top) / heightBase,
        width: node.size.width / widthBase, height: node.size.height / heightBase, zIndex: node.zIndex
      }))
    };
  }

  return { createCanvas, addCanvasNode, updateCanvasNode, removeCanvasNode, copyCanvas, setPromptSelection, captureLayoutIntent };
});
