'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { extractWritingOutline } = require('../prototype/writing-document-outline.js');

test('从 Markdown 与明确编号标题提取层级，普通句子不作为目录', () => {
  const result = extractWritingOutline({ format: 'md', text: '# 总则\n正文是一段普通说明。\n## 1.2 操作流程\n3、故障处理' });
  assert.deepEqual(result.items.map(item => [item.title, item.level]), [['总则', 1], ['1.2 操作流程', 2], ['3、故障处理', 1]]);
  assert.equal(result.complete, true);
  assert.equal(extractWritingOutline({ format: 'txt', text: '# TXT 标题' }).items[0].title, 'TXT 标题');
});

test('DOCX 优先使用标题级别线索，PDF 编号标题保留页定位', () => {
  const docx = extractWritingOutline({ format: 'docx', segments: [
    { text: '自定义标题', headingLevel: 2, locator: '第1段' },
    { text: '普通句子。', locator: '第2段' },
    { text: '1.3 明确编号标题', locator: '第3段' }
  ] });
  assert.deepEqual(docx.items.map(item => [item.title, item.level]), [['自定义标题', 2], ['1.3 明确编号标题', 2]]);
  const pdf = extractWritingOutline({ format: 'pdf', segments: [
    { text: '第一章 设备安装', locator: '第4页' }, { text: '请确认电源已关闭。', locator: '第4页' }
  ] });
  assert.equal(pdf.items[0].title, '第一章 设备安装');
  assert.equal(pdf.items[0].locator, '第4页');
});

test('重复标题使用唯一稳定 ID，截断输入标记目录不完整并限制 200 项', () => {
  const input = { format: 'md', text: '# 重复\n# 重复', truncated: true };
  const first = extractWritingOutline(input);
  assert.notEqual(first.items[0].id, first.items[1].id);
  assert.deepEqual(first.items.map(item => item.id), extractWritingOutline(input).items.map(item => item.id));
  assert.equal(first.complete, false);
  const many = Array.from({ length: 205 }, (_, index) => `# 第${index}章`).join('\n');
  assert.equal(extractWritingOutline({ format: 'md', text: many }).items.length, 200);
  assert.equal(extractWritingOutline({ format: 'md', text: many }).complete, false);
});

test('没有可识别标题时返回空目录并标记不完整', () => {
  const result = extractWritingOutline({ format: 'txt', text: '普通正文，没有章节标题。' });
  assert.deepEqual(result.items, []);
  assert.equal(result.complete, false);
});

test('浏览器脚本全局导出目录提取函数', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../prototype/writing-document-outline.js'), 'utf8'), context);
  assert.equal(typeof context.ForwardStepWritingDocumentOutline.extractWritingOutline, 'function');
});
