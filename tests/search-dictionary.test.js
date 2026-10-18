const test = require('node:test');
const assert = require('node:assert/strict');
const {
  expandSearchTerms,
  splitChineseTerms,
  suggestSearchTerms
} = require('../prototype/search-dictionary.js');

test('同义词扩展包含中文、英文和短语别名', () => {
  const terms = expandSearchTerms('提示词 review 完成标准');

  assert.ok(terms.includes('提示词'));
  assert.ok(terms.includes('prompt'));
  assert.ok(terms.includes('复核'));
  assert.ok(terms.includes('review'));
  assert.ok(terms.includes('完成标准'));
  assert.ok(terms.includes('验收'));
  assert.ok(terms.includes('测试'));
});

test('中文短语保留原词并补充双字词', () => {
  const terms = splitChineseTerms('完成标准');

  assert.ok(terms.includes('完成标准'));
  assert.ok(terms.includes('完成'));
  assert.ok(terms.includes('标准'));
});

test('自定义别名只影响当前调用，不污染内置词典', () => {
  const customTerms = expandSearchTerms('交付门槛', {
    aliases: { 验收: ['交付门槛'] }
  });

  assert.ok(customTerms.includes('验收'));
  assert.ok(customTerms.includes('交付门槛'));
  assert.equal(expandSearchTerms('交付门槛').includes('验收'), false);
});

test('搜索建议最多三条且排序稳定', () => {
  const entries = [
    { title: '测试计划', keywords: ['验收'] },
    { title: '提示词案例', keywords: ['示例'] },
    { title: '复核问题', keywords: ['失败'] },
    { title: '无关资料', keywords: ['其他'] }
  ];

  const first = suggestSearchTerms('案', entries);
  const second = suggestSearchTerms('案', entries);

  assert.ok(first.length <= 3);
  assert.deepEqual(first, second);
  assert.deepEqual(first.slice(0, 2), ['案例', '示例']);
});

test('超长输入的拆词和扩展词数量保持有界', () => {
  const query = '中文'.repeat(200);

  assert.ok(splitChineseTerms(query).length <= 128);
  assert.ok(expandSearchTerms(query).length <= 128);
});

