const test = require('node:test');
const assert = require('node:assert/strict');

let literature;
try {
  literature = require('../prototype/academic-literature.js');
} catch {
  literature = {};
}

test('RIS 导入规范作者、题名、年份和 DOI，且默认状态不越级', () => {
  assert.equal(typeof literature.parseLiteratureImport, 'function', '应提供文献导入解析器');
  const result = literature.parseLiteratureImport([
    'TY  - JOUR',
    'AU  - Doe, Jane',
    'AU  - Roe, John',
    'TI  - A useful study',
    'PY  - 2024',
    'JO  - Journal of Tests',
    'VL  - 12',
    'IS  - 3',
    'SP  - 20',
    'EP  - 29',
    'DO  - https://doi.org/10.1234/ABC',
    'ER  -',
    ''
  ].join('\n'), 'ris');

  assert.equal(result.errors.length, 0);
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0].literature.authors, ['Doe, Jane', 'Roe, John']);
  assert.equal(result.entries[0].title, 'A useful study');
  assert.equal(result.entries[0].literature.year, '2024');
  assert.equal(result.entries[0].literature.publication, 'Journal of Tests');
  assert.equal(result.entries[0].literature.doi, '10.1234/abc');
  assert.equal(result.entries[0].literature.metadataStatus, 'unverified');
  assert.equal(result.entries[0].literature.readingStatus, 'unread');
  assert.equal(result.entries[0].literature.claimRelations[0], undefined);
});

test('BibTeX 子集导入支持作者、期刊与 DOI，并拒绝不完整记录而不导入半条数据', () => {
  assert.equal(typeof literature.parseLiteratureImport, 'function', '应提供文献导入解析器');
  const result = literature.parseLiteratureImport([
    '@article{valid2023,',
    '  author = {Jane Doe and John Roe},',
    '  title = {A BibTeX Study},',
    '  year = {2023},',
    '  journal = {Example Review},',
    '  doi = {10.5555/xyz}',
    '}',
    '@article{invalid, title = {Missing closing brace}',
  ].join('\n'), 'bibtex');

  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0].literature.authors, ['Jane Doe', 'John Roe']);
  assert.equal(result.entries[0].literature.doi, '10.5555/xyz');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /格式|括号|记录/);
});

test('BibTeX 格式错误记录后仍恢复解析后续完整题录', () => {
  const result = literature.parseLiteratureImport([
    '@article{broken,',
    '  title = {没有结束的记录},',
    '@article{valid2024,',
    '  title = {后续完整题录},',
    '  year = {2024}',
    '}'
  ].join('\n'), 'bibtex');
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].title, '后续完整题录');
  assert.equal(result.errors.length, 1);
});

test('相同 DOI 与本地库已有记录去重，但不按相似标题误删', () => {
  assert.equal(typeof literature.deduplicateLiteratureEntries, 'function', '应提供 DOI 去重');
  const current = [{ id: 'existing', literature: { doi: '10.1234/abc' } }];
  const incoming = [
    { id: 'same-doi', literature: { doi: 'https://doi.org/10.1234/ABC' } },
    { id: 'different-doi', title: '相同标题', literature: { doi: '10.1234/other' } }
  ];
  const result = literature.deduplicateLiteratureEntries(incoming, current);
  assert.deepEqual(result.entries.map(entry => entry.id), ['different-doi']);
  assert.deepEqual(result.duplicates.map(entry => entry.id), ['same-doi']);
});

test('阅读状态、元数据状态和论断关系状态各自保存，论断关系必须带核对依据', () => {
  const schema = require('../prototype/knowledge-schema.js');
  assert.equal(typeof schema.normalizeLiteratureMetadata, 'function', '知识 schema 应规范化文献元数据');
  const literatureRecord = schema.normalizeLiteratureMetadata({
    metadataStatus: 'registry-returned',
    readingStatus: 'full-text-user-confirmed',
    claimRelations: [
      { claim: '论断 A', relation: 'supports', location: '第 4 页', rationale: '原文报告了相同结果。' },
      { claim: '缺少依据的论断', relation: 'supports' }
    ]
  });
  assert.equal(literatureRecord.metadataStatus, 'registry-returned');
  assert.equal(literatureRecord.readingStatus, 'full-text-user-confirmed');
  assert.deepEqual(literatureRecord.claimRelations, [
    { claim: '论断 A', relation: 'supports', location: '第 4 页', rationale: '原文报告了相同结果。' }
  ]);
});

test('用户摘要/摘录超过 1200 字时明确拒绝，不静默截断', () => {
  const schema = require('../prototype/knowledge-schema.js');
  assert.equal(typeof schema.normalizeLiteratureMetadata, 'function', '知识 schema 应规范化文献元数据');
  assert.throws(() => schema.normalizeLiteratureMetadata({ abstractExcerpt: '摘'.repeat(1201) }), /1200/);
  assert.equal(schema.normalizeLiteratureMetadata({ abstractExcerpt: '摘'.repeat(1200) }).abstractExcerpt.length, 1200);
});

test('阅读提示词只含所选题录和用户摘录，明确区别题录、摘录与全文阅读', () => {
  assert.equal(typeof literature.buildReadingPrompt, 'function', '应提供阅读提示词生成器');
  const selected = [
    { id: 'chosen', type: 'academic-literature', title: '所选研究', literature: { authors: ['作者甲'], year: '2024', readingStatus: 'excerpt-only', abstractExcerpt: '用户粘贴的摘录', excerptLocation: '第 2 页' } },
    { id: 'unselected', type: 'academic-literature', title: '未选研究', literature: { abstractExcerpt: '不应进入提示词' } }
  ];
  const prompt = literature.buildReadingPrompt(selected, ['chosen']);
  assert.match(prompt, /所选研究/);
  assert.match(prompt, /用户粘贴的摘录/);
  assert.match(prompt, /第 2 页/);
  assert.match(prompt, /未读全文|不得.*全文/);
  assert.doesNotMatch(prompt, /未选研究|不应进入提示词/);
  const sixEntries = Array.from({ length: 6 }, (_, index) => ({
    id: `paper-${index}`,
    type: 'academic-literature',
    title: `研究 ${index}`,
    literature: {}
  }));
  assert.throws(() => literature.buildReadingPrompt(sixEntries, sixEntries.map(entry => entry.id)), /5/);
});

test('RIS 导出往返保留已支持的题录字段，不写入摘要或本机路径', () => {
  assert.equal(typeof literature.exportLiteratureRis, 'function', '应提供 RIS 导出器');
  const exported = literature.exportLiteratureRis([{
    id: 'paper-1',
    type: 'academic-literature',
    title: 'Study title',
    sourceUrl: 'C:/private/source.pdf',
    literature: { authors: ['Jane Doe'], year: '2024', publication: 'Journal X', volume: '7', issue: '2', pages: '10-18', doi: '10.1234/paper', abstractExcerpt: '本地摘录' }
  }]);
  assert.match(exported, /TY  - JOUR/);
  assert.match(exported, /TI  - Study title/);
  assert.match(exported, /AU  - Jane Doe/);
  assert.match(exported, /DO  - 10\.1234\/paper/);
  assert.doesNotMatch(exported, /本地摘录|private|C:\\?/);
});
