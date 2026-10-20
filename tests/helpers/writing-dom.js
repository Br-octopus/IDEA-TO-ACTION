// 原生 DOM 的最小测试替身：解析真实渲染控件，并通过委托事件操作界面。
function createWritingDOM() {
  const dispatch = async (type, event) => { for (const handler of handlers[type] || []) await handler(event); };
  const nodes = new Map();
  const handlers = {};
  const decode = value => String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  let html = '';
  const mount = {
    addEventListener(type, handler) { (handlers[type] = handlers[type] || []).push(handler); },
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      nodes.clear();
      for (const match of value.matchAll(/<(input|textarea|select|button)\b([^>]*)(?:>([\s\S]*?)<\/\1>)?/g)) {
        const [, tag, attributes, body = ''] = match;
        const attrs = Object.fromEntries([...attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m => [m[1], decode(m[2] ?? '')]));
        const dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, val]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), val]));
        const selected = tag === 'select' ? [...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].find(m => /\bselected\b/.test(m[1])) || [...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)][0] : null;
        const node = { id: attrs.id, dataset, attrs, value: tag === 'textarea' ? decode(body) : selected ? decode(selected[1].match(/value="([^"]*)"/)?.[1] ?? selected[2]) : attrs.value || '', checked: Object.hasOwn(attrs, 'checked'), disabled: Object.hasOwn(attrs, 'disabled'), readOnly: Object.hasOwn(attrs, 'readonly'), closest(selector) { return this.matches(selector) ? this : null; }, matches(selector) { if (selector.startsWith('#')) return this.id === selector.slice(1); const m = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/); return !!m && Object.hasOwn(attrs, m[1]) && (m[2] === undefined || attrs[m[1]] === m[2]); } };
        nodes.set(attrs.id || `node-${nodes.size}`, node);
      }
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) { return [...nodes.values()].filter(node => node.matches(selector)); }
  };
  const document = { getElementById(id) { return id === 'writing-workbench-root' ? mount : nodes.get(id) || null; } };
  return {
    document, mount,
    node: id => nodes.get(id),
    async input(id, value, type = 'input') { const target = nodes.get(id); if (!target) throw new Error(`控件不存在：${id}`); target.value = value; await dispatch(type, { target }); },
    async click(action, data = {}) { const target = [...nodes.values()].find(n => (n.dataset.writingAction === action || n.dataset.action === action) && Object.entries(data).every(([key, value]) => n.dataset[key] === value)); if (!target) throw new Error(`操作不存在：${action}`); if (target.disabled) throw new Error(`操作已禁用：${action}`); await dispatch('click', { target, preventDefault() {} }); },
    async change(id, value) { const target = nodes.get(id); if (!target) throw new Error(`控件不存在：${id}`); if (typeof value === 'boolean') target.checked = value; else target.value = value; await dispatch('change', { target }); }
  };
}
module.exports = { createWritingDOM };
