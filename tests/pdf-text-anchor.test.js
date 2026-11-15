const assert = require('node:assert/strict');
const test = require('node:test');
const { createTextAnchor, resolveTextAnchor, createRange } = require('../prototype/pdf-text-anchor.js');

test('PDF 文字锚点记录页内 Unicode 位置与前后文', () => {
  const target = createTextAnchor({
    text: '前😀 原文目标 后', before: '前😀 ', selected: '原文目标', after: ' 后'
  });
  assert.deepEqual(target, {
    kind: 'text', selector: '.textLayer', exact: '原文目标', prefix: '前😀 ', suffix: ' 后', start: 3, end: 7
  });
  assert.deepEqual(resolveTextAnchor('前😀 原文目标 后', target), { status: 'found', start: 3, end: 7 });
});

test('PDF 文字锚点只在上下文唯一时允许偏移后重新定位', () => {
  const target = { kind: 'text', selector: '.textLayer', exact: '目标', prefix: '左侧', suffix: '右侧', start: 0, end: 2 };
  assert.deepEqual(resolveTextAnchor('新增；左侧目标右侧', target), { status: 'found', start: 5, end: 7 });
  assert.equal(resolveTextAnchor('左侧目标右侧；其他目标结尾', { ...target, start: undefined, end: undefined }).status, 'found');
  assert.equal(resolveTextAnchor('左侧目标右侧；左侧目标右侧', { ...target, start: undefined, end: undefined }).status, 'ambiguous');
  assert.equal(resolveTextAnchor('新上下文目标不符', target).status, 'context-mismatch');
  assert.equal(resolveTextAnchor('原文已删除', target).status, 'missing');
});

test('PDF 文字锚点可跨 text node 恢复 Unicode DOM Range', () => {
  const nodes = [{ nodeValue: '前😀目' }, { nodeValue: '标词后' }];
  const root = { ownerDocument: null };
  const document = {
    defaultView: { NodeFilter: { SHOW_TEXT: 4 } },
    createTreeWalker() {
      let index = 0;
      return { nextNode() { return nodes[index++] || null; } };
    },
    createRange() {
      return {
        setStart(node, offset) { this.start = { node, offset }; },
        setEnd(node, offset) { this.end = { node, offset }; }
      };
    }
  };
  root.ownerDocument = document;
  const range = createRange(root, 2, 5);
  assert.deepEqual(range.start, { node: nodes[0], offset: 3 });
  assert.deepEqual(range.end, { node: nodes[1], offset: 2 });
});

test('PDF 文字锚点限制原文长度并截断上下文且不拆开代理项', () => {
  const target = createTextAnchor({
    text: `${'前😀'.repeat(100)}目标${'后😀'.repeat(100)}`,
    before: '前😀'.repeat(100), selected: '目标', after: '后😀'.repeat(100)
  });
  assert.ok(target.prefix.length <= 120);
  assert.ok(target.suffix.length <= 120);
  assert.equal(target.prefix.includes('\uFFFD'), false);
  assert.equal(target.suffix.includes('\uFFFD'), false);
  assert.throws(() => createTextAnchor({ selected: 'x'.repeat(2001) }), /超长/);
});
