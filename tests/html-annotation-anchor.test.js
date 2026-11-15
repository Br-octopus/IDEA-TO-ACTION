const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const preloadPath = process.env.HTML_PRELOAD_SOURCE || path.join(__dirname, '..', 'electron', 'ppt-feedback-preview-preload.js');
const preloadSource = fs.readFileSync(preloadPath, 'utf8');

test('网页快照净化后挂到已有主文档，正文与批注共用同一文档', () => {
  const info = { id: 'forward-step-preview-info' };
  const paragraph = { textContent: '目标原文' };
  const style = { textContent: 'p { color: green }' };
  const removed = [];
  const dangerous = { remove() { removed.push('script'); } };
  const element = { attributes: [{ name: 'onclick' }, { name: 'href' }, { name: 'class' }], removeAttribute(name) { removed.push(name); } };
  let mounted;
  const appended = [];
  const parsed = {
    querySelectorAll: selector => selector === '*' ? [element] : [dangerous],
    createElement: () => ({}),
    head: { childNodes: [style], prepend(node) { this.childNodes.unshift(node); } },
    body: { attributes: [], childNodes: [paragraph] }
  };
  const context = {
    document: {
      getElementById: id => id === 'forward-step-preview-info' ? info : { value: '' },
      head: { append: (...nodes) => appended.push(...nodes) },
      body: { replaceChildren: (...nodes) => { mounted = nodes; } }
    },
    Uint8Array, atob: () => '', TextDecoder,
    DOMParser: class { parseFromString() { return parsed; } },
    showLocationStatus: message => assert.fail(message)
  };
  const source = preloadSource.slice(preloadSource.indexOf('function initializeSnapshotDocument()'), preloadSource.indexOf('\nattachSelectionHandler(document);'));
  vm.runInNewContext(source + '; initializeSnapshotDocument();', context);
  assert.deepEqual(mounted, [info, paragraph]);
  assert.ok(appended.includes(style));
  assert.match(appended[0].content, /script-src 'none'/);
  assert.deepEqual(removed, ['script', 'onclick', 'href']);
  assert.doesNotMatch(preloadSource, /contentDocument|srcdoc/);
});

function makePreview(textParts, selectorAvailable = true) {
  const textNodes = textParts.map(nodeValue => ({ nodeValue }));
  const selectedRanges = [];
  const listeners = new Map();
  const statusNodes = new Map();
  const root = { nodeType: 1, textContent: textParts.join(''), scrolled: false, scrollIntoView() { this.scrolled = true; } };
  const body = { ...root, children: [], appendChild(node) { this.children.push(node); statusNodes.set(node.id, node); } };
  const document = {
    body,
    addEventListener() {},
    querySelector(selector) { return selectorAvailable && selector === 'main > p' ? root : null; },
    querySelectorAll(selector) { return selectorAvailable && selector === 'main > p' ? [root] : []; },
    getElementById(id) { return statusNodes.get(id) || null; },
    createElement() { return { id: '', style: {}, textContent: '' }; },
    createTreeWalker() {
      let index = 0;
      return { nextNode() { return textNodes[index++] || null; } };
    },
    createRange() {
      return {
        setStart(node, offset) { this.start = { node, offset }; },
        setEnd(node, offset) { this.end = { node, offset }; }
      };
    }
  };
  root.ownerDocument = document;
  body.ownerDocument = document;
  textNodes.forEach(node => { node.ownerDocument = document; });
  const selection = {
    removeAllRanges() { selectedRanges.length = 0; },
    addRange(range) { selectedRanges.push(range); }
  };
  vm.runInNewContext(preloadSource, {
    document,
    window: { getSelection: () => selection },
    NodeFilter: { SHOW_TEXT: 4 },
    setTimeout,
    require(name) {
      assert.equal(name, 'electron');
      return { ipcRenderer: { on: (channel, listener) => listeners.set(channel, listener), send() {} } };
    }
  }, { filename: preloadPath });
  return { body, root, textNodes, selectedRanges, listeners, statusNodes };
}

function requestLocate(preview, target) {
  const listener = preview.listeners.get('ppt-feedback:preview-locate');
  assert.equal(typeof listener, 'function', '预览 preload 应订阅受控定位消息');
  listener(null, target);
}

function makeSelectablePreview(textParts, selectionRange) {
  const listeners = new Map();
  const sent = [];
  const statusNodes = new Map();
  const textNodes = textParts.map(nodeValue => ({ nodeType: 3, nodeValue, parentElement: null }));
  const text = textParts.join('');
  const body = { nodeType: 1, localName: 'body', children: [], contains: node => node === body || node?.parentElement === paragraph || node?.parentElement === main, appendChild(node) { statusNodes.set(node.id, node); } };
  const main = { nodeType: 1, localName: 'main', parentElement: body, children: [], closest() { return this; } };
  const paragraph = {
    nodeType: 1, localName: 'p', parentElement: main, children: textNodes,
    textContent: text, scrolled: false, scrollIntoView() { this.scrolled = true; },
    closest(selector) { return selector.startsWith('#') ? null : this; }
  };
  body.children.push(main);
  main.children.push(paragraph);
  textNodes.forEach(node => { node.parentElement = paragraph; });
  const absoluteOffset = (node, offset) => textNodes.slice(0, textNodes.indexOf(node)).reduce((sum, item) => sum + item.nodeValue.length, 0) + offset;
  class FakeRange {
    setStart(node, offset) { this.start = { node, offset }; this.startContainer = node; this.startOffset = offset; this.startPosition = absoluteOffset(node, offset); }
    setEnd(node, offset) { this.end = { node, offset }; this.endContainer = node; this.endOffset = offset; this.endPosition = absoluteOffset(node, offset); }
    selectNodeContents() { this.startPosition = 0; this.endPosition = text.length; }
    toString() { return text.slice(this.startPosition, this.endPosition); }
  }
  const initialRange = new FakeRange();
  initialRange.commonAncestorContainer = paragraph;
  initialRange.setStart(textNodes[selectionRange.startNode], selectionRange.startOffset);
  initialRange.setEnd(textNodes[selectionRange.endNode], selectionRange.endOffset);
  const selectedRanges = [initialRange];
  const selection = {
    get rangeCount() { return selectedRanges.length; },
    getRangeAt() { return selectedRanges[0]; },
    removeAllRanges() { selectedRanges.length = 0; },
    addRange(range) { selectedRanges.push(range); }
  };
  const document = {
    body,
    addEventListener: (name, listener) => listeners.set(name, listener),
    querySelectorAll: selector => selector === 'body > main > p' ? [paragraph] : [],
    getElementById: id => statusNodes.get(id) || null,
    createElement: () => ({ id: '', style: {}, textContent: '' }),
    createTreeWalker(root) {
      let index = 0;
      const nodes = root === paragraph ? textNodes : [];
      return { nextNode() { return nodes[index++] || null; } };
    },
    createRange: () => new FakeRange()
  };
  [body, main, paragraph, ...textNodes].forEach(node => { node.ownerDocument = document; });
  vm.runInNewContext(preloadSource, {
    document,
    window: { getSelection: () => selection },
    NodeFilter: { SHOW_TEXT: 4 },
    setTimeout,
    require(name) {
      assert.equal(name, 'electron');
      return { ipcRenderer: { on: (channel, listener) => listeners.set(channel, listener), send: (...args) => sent.push(args) } };
    }
  }, { filename: preloadPath });
  return { paragraph, textNodes, selectedRanges, listeners, sent };
}

test('HTML 文字锚点优先按 code point 位置恢复并滚动到原文', () => {
  const preview = makePreview(['前😀', '目标词后']);
  requestLocate(preview, { kind: 'text', selector: 'main > p', exact: '目标词', prefix: '前😀', suffix: '后', start: 2, end: 5 });

  assert.equal(preview.selectedRanges.length, 1);
  assert.deepEqual(preview.selectedRanges[0].start, { node: preview.textNodes[0], offset: 3 });
  assert.deepEqual(preview.selectedRanges[0].end, { node: preview.textNodes[1], offset: 3 });
  assert.equal(preview.root.scrolled, true);
  assert.match([...preview.statusNodes.values()][0].textContent, /已定位/);
});

test('位置不匹配时只接受带上下文唯一命中的原文', () => {
  const preview = makePreview(['左侧目标右侧；其他目标结尾']);
  requestLocate(preview, { kind: 'text', selector: 'main > p', exact: '目标', prefix: '左侧', suffix: '右侧', start: 0, end: 2 });

  assert.equal(preview.selectedRanges.length, 1);
  assert.equal(preview.root.scrolled, true);
  assert.match([...preview.statusNodes.values()][0].textContent, /已定位/);
});

test('重复原文无唯一上下文或原文缺失时不擅自选择第一处', () => {
  const ambiguous = makePreview(['同句和同句']);
  requestLocate(ambiguous, { kind: 'text', selector: 'main > p', exact: '同句', prefix: '', suffix: '' });
  assert.equal(ambiguous.selectedRanges.length, 0);
  assert.match([...ambiguous.statusNodes.values()][0].textContent, /多处/);

  const missing = makePreview(['页面已改动']);
  requestLocate(missing, { kind: 'text', selector: 'main > p', exact: '旧原文', prefix: '', suffix: '' });
  assert.equal(missing.selectedRanges.length, 0);
  assert.match([...missing.statusNodes.values()][0].textContent, /未找到/);
});

test('真实 preload 选择跨文本节点、含 emoji 与首尾空白时生成一致的 code point 锚点', async () => {
  const preview = makeSelectablePreview(['前😀 ', ' 目标', '句🙂 ', '后'], {
    startNode: 1, startOffset: 0, endNode: 2, endOffset: 4
  });
  preview.listeners.get('pointerup')({ button: 0, target: preview.paragraph });
  await new Promise(resolve => setTimeout(resolve, 0));

  const [channel, target] = preview.sent[0];
  assert.equal(channel, 'ppt-feedback:preview-target');
  assert.deepEqual(JSON.parse(JSON.stringify(target)), {
    kind: 'text', selector: 'body > main > p', exact: '目标句🙂', prefix: '前😀  ', suffix: ' 后', start: 4, end: 8
  });

  requestLocate(preview, target);
  assert.equal(preview.selectedRanges.length, 1);
  assert.deepEqual(preview.selectedRanges[0].start, { node: preview.textNodes[1], offset: 1 });
  assert.deepEqual(preview.selectedRanges[0].end, { node: preview.textNodes[2], offset: 3 });
});

test('超长选区按完整 Unicode 字符裁剪，剩余文字仍作为尾部上下文', async () => {
  const longText = `${'a'.repeat(1999)}😀尾`;
  const preview = makeSelectablePreview([longText], { startNode: 0, startOffset: 0, endNode: 0, endOffset: longText.length });
  preview.listeners.get('pointerup')({ button: 0, target: preview.paragraph });
  await new Promise(resolve => setTimeout(resolve, 0));

  const target = preview.sent[0][1];
  assert.equal(target.exact.length, 1999);
  assert.equal(target.suffix, '😀尾');
  assert.equal(target.end - target.start, Array.from(target.exact).length);
});

test('来源信息栏不作为网页正文创建批注', async () => {
  const preview = makeSelectablePreview(['来源说明'], { startNode: 0, startOffset: 0, endNode: 0, endOffset: 4 });
  preview.paragraph.closest = selector => selector === '#forward-step-preview-info' ? { id: 'forward-step-preview-info' } : preview.paragraph;
  preview.listeners.get('pointerup')({ button: 0, target: preview.paragraph });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(preview.sent.length, 0);
});

test('保存位置的原文相同但上下文变化时不得直接跳到旧位置', () => {
  const preview = makePreview(['新前文目标新后文']);
  requestLocate(preview, { kind: 'text', selector: 'main > p', exact: '目标', prefix: '旧前文', suffix: '旧后文', start: 3, end: 5 });

  assert.equal(preview.selectedRanges.length, 0);
  assert.match([...preview.statusNodes.values()][0].textContent, /上下文已变化/);
});

