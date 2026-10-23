const test = require('node:test');
const assert = require('node:assert/strict');
const { createWritingApp } = require('./helpers/writing-app.js');

let uiModule;
try {
  uiModule = require('../prototype/academic-literature-ui.js');
} catch {
  uiModule = {};
}

function makeHarness(options = {}) {
  const list = { innerHTML: '' };
  const root = {
    innerHTML: '',
    handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    querySelectorAll() { return []; },
    querySelector(selector) { return selector === '[data-literature-list]' ? list : null; }
  };
  let savedState = { knowledgeEntries: options.entries || [], knowledgeSelection: options.selection || [] };
  const saves = [];
  const confirms = [];
  const notices = [];
  const ui = uiModule.createAcademicLiteratureUI({
    root,
    getState: () => savedState,
    saveState: next => { saves.push(next); savedState = next; return true; },
    fetchImpl: options.fetchImpl || (async () => ({ ok: true, json: async () => ({ metadata: { title: '查询题名', authors: [], doi: '10.1234/query', metadataProvider: 'Crossref', queriedAt: '2026-10-21T00:00:00.000Z', metadataStatus: 'registry-returned' } }) })),
    confirmExternal: message => { confirms.push(message); return options.confirmResult !== false; },
    notify: message => notices.push(message),
    clipboard: async () => {}
  });
  return { root, list, ui, saves, confirms, notices, get state() { return savedState; } };
}

test('文献管理区渲染导入预览、DOI/PMID 查询同意、三类状态和提示词操作', () => {
  assert.equal(typeof uiModule.createAcademicLiteratureUI, 'function', '应提供文献管理界面');
  const { root, list } = makeHarness({ entries: [{ id: 'paper', type: 'academic-literature', title: '题录', literature: { claimRelations: [] } }] });
  assert.match(root.innerHTML, /RIS|BibTeX/);
  assert.match(root.innerHTML, /DOI/);
  assert.match(root.innerHTML, /PMID/);
  assert.match(root.innerHTML, /只把.*标识符/);
  assert.match(root.innerHTML, /metadataStatus/);
  assert.match(root.innerHTML, /readingStatus/);
  assert.match(list.innerHTML, /论断关系/);
  assert.match(root.innerHTML, /生成阅读提示词/);
});

test('真实应用入口把文献管理接入资料库，并保留知识库检索和写作工作台的共用状态', () => {
  const app = createWritingApp();
  const root = app.element('academic-literature-root');
  assert.match(root.innerHTML, /学术文献库/);
  assert.match(app.pageHTML, /id="academic-literature-root"/);
  assert.match(app.pageHTML, /src="\/prototype\/academic-literature\.js"/);
  assert.match(app.pageHTML, /src="\/prototype\/academic-literature-ui\.js"/);
  assert.match(app.pageHTML, /\.academic-literature-manager label\.check-row\s*\{\s*display:\s*flex;/);
  assert.match(app.pageHTML, /\.academic-literature-manager label\.check-row input\[type="checkbox"\]\s*\{\s*width:\s*auto;/);
});

test('RIS/BibTeX 预览逐条报告无效项和重复 DOI，只导入用户勾选的有效题录', async () => {
  assert.equal(typeof uiModule.createAcademicLiteratureUI, 'function', '应提供文献管理界面');
  const existing = [{ id: 'old', type: 'academic-literature', title: '既有', literature: { doi: '10.1111/exists' } }];
  const harness = makeHarness({ entries: existing });
  const preview = harness.ui.previewImport([
    'TY  - JOUR', 'TI  - 新文献', 'DO  - 10.1111/new', 'ER  -',
    'TY  - JOUR', 'TI  - 重复文献', 'DO  - 10.1111/exists', 'ER  -',
    'TY  - JOUR', 'AU  - 作者缺题名', 'ER  -'
  ].join('\n'), 'ris');
  assert.equal(preview.entries.length, 1);
  assert.equal(preview.duplicates.length, 1);
  assert.equal(preview.errors.length, 1);
  const result = await harness.ui.commitImport([preview.entries[0].id]);
  assert.equal(result.imported, 1);
  assert.equal(harness.state.knowledgeEntries.length, 2);
  assert.equal(harness.state.knowledgeEntries[0].title, '新文献');
});

test('题录查询未勾选外发范围或未二次确认时不发网络请求', async () => {
  assert.equal(typeof uiModule.createAcademicLiteratureUI, 'function', '应提供文献管理界面');
  let requests = 0;
  const harness = makeHarness({ confirmResult: false, fetchImpl: async () => { requests++; throw new Error('不应请求'); } });
  assert.equal((await harness.ui.lookup('doi', '10.1234/example', { externalScopeConfirmed: false })).code, 'SCOPE_NOT_CONFIRMED');
  assert.equal(requests, 0);
  harness.ui.setExternalScopeConfirmed(true);
  assert.equal((await harness.ui.lookup('doi', '10.1234/example')).code, 'CANCELLED');
  assert.equal(requests, 0);
  assert.match(harness.confirms[0], /只会.*DOI/);
});

test('确认题录查询后请求体只有一个规范化 DOI，结果待用户填入并保存', async () => {
  assert.equal(typeof uiModule.createAcademicLiteratureUI, 'function', '应提供文献管理界面');
  let request;
  const harness = makeHarness({ fetchImpl: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ metadata: { title: '查到题名', authors: ['Jane Doe'], year: '2024', publication: '期刊', doi: '10.1234/example', metadataProvider: 'Crossref', queriedAt: '2026-10-21T00:00:00.000Z', metadataStatus: 'registry-returned' } }) };
  } });
  harness.ui.setExternalScopeConfirmed(true);
  const result = await harness.ui.lookup('doi', 'https://doi.org/10.1234/EXAMPLE');
  assert.equal(result.ok, true);
  assert.deepEqual(request.body, { doi: '10.1234/example' });
  assert.equal(Object.keys(request.body).length, 1);
  assert.equal(harness.state.knowledgeEntries.length, 0);
  harness.ui.applyLookupMetadata();
  await harness.ui.saveManual({ title: '查到题名', literature: harness.ui.getDraft().literature });
  assert.equal(harness.state.knowledgeEntries[0].literature.metadataStatus, 'registry-returned');
  assert.equal(harness.state.knowledgeEntries[0].literature.readingStatus, 'unread');
});

test('新题录查询失败时清除旧结果并保留本次标识符', async () => {
  assert.equal(typeof uiModule.createAcademicLiteratureUI, 'function', '应提供文献管理界面');
  let calls = 0;
  const harness = makeHarness({ fetchImpl: async () => {
    calls++;
    if (calls === 1) return { ok: true, json: async () => ({ metadata: { title: '上一条题录', authors: [], doi: '10.1234/previous', metadataProvider: 'Crossref', queriedAt: '2026-10-21T00:00:00.000Z', metadataStatus: 'registry-returned' } }) };
    return { ok: false, json: async () => ({ code: 'NOT_FOUND', message: '登记机构没有找到这条题录。' }) };
  } });
  harness.ui.setExternalScopeConfirmed(true);
  assert.equal((await harness.ui.lookup('doi', '10.1234/previous')).ok, true);
  assert.match(harness.root.innerHTML, /上一条题录/);
  const doiInput = { value: '10.1234/missing', matches: selector => selector === '[data-lit-doi]' };
  harness.root.handlers.input({ target: doiInput });
  const failed = await harness.ui.lookup('doi', '10.1234/missing');
  assert.equal(failed.code, 'LOOKUP_FAILED');
  assert.doesNotMatch(harness.root.innerHTML, /上一条题录/);
  assert.match(harness.root.innerHTML, /value="10\.1234\/missing"/);
});

test('文献选择变化时清除旧阅读提示词，避免复制已取消的材料', async () => {
  assert.equal(typeof uiModule.createAcademicLiteratureUI, 'function', '应提供文献管理界面');
  const harness = makeHarness({
    entries: [{ id: 'paper', type: 'academic-literature', title: '只选时可见的题录', literature: { authors: [], doi: '10.1234/selected', abstractExcerpt: '仅当前选择可使用', metadataStatus: 'unverified', readingStatus: 'unread', claimRelations: [] } }],
    selection: ['paper']
  });
  assert.match(harness.ui.generateReadingPrompt(), /只选时可见的题录/);
  await harness.ui.selectForWriting('paper', false);
  const promptMarkup = harness.root.innerHTML.match(/<textarea readonly data-lit-prompt>([\s\S]*?)<\/textarea>/);
  assert.equal(promptMarkup?.[1], '');
});

test('本地搜索覆盖题名作者 DOI PMID；状态修改独立保存且选择最多五条', async () => {
  assert.equal(typeof uiModule.createAcademicLiteratureUI, 'function', '应提供文献管理界面');
  const entries = Array.from({ length: 7 }, (_, index) => ({
    id: `paper-${index}`, type: 'academic-literature', title: `研究 ${index}`,
    literature: { authors: [`作者 ${index}`], doi: `10.1234/${index}`, pmid: String(1000 + index), metadataStatus: 'unverified', readingStatus: 'unread', claimRelations: [] }
  }));
  const harness = makeHarness({ entries });
  assert.equal(harness.ui.search('作者 3')[0].id, 'paper-3');
  assert.equal(harness.ui.search('10.1234/4')[0].id, 'paper-4');
  assert.equal(harness.ui.search('1005')[0].id, 'paper-5');
  await harness.ui.updateStatus('paper-0', 'metadataStatus', 'user-verified');
  await harness.ui.updateStatus('paper-0', 'readingStatus', 'full-text-user-confirmed');
  assert.equal(harness.state.knowledgeEntries[0].literature.metadataStatus, 'user-verified');
  assert.equal(harness.state.knowledgeEntries[0].literature.readingStatus, 'full-text-user-confirmed');
  for (const entry of entries.slice(0, 6)) await harness.ui.selectForWriting(entry.id, true);
  assert.equal(harness.state.knowledgeSelection.length, 5);
  assert.match(harness.notices.at(-1), /五条上限/);
});

test('保存失败时保留当前状态；阅读提示词限制五篇并只引用所选文献', async () => {
  assert.equal(typeof uiModule.createAcademicLiteratureUI, 'function', '应提供文献管理界面');
  const entries = [
    { id: 'selected', type: 'academic-literature', title: '选中的文献', literature: { authors: ['作者'], abstractExcerpt: '用户摘录', readingStatus: 'excerpt-only' } },
    { id: 'other', type: 'academic-literature', title: '未选文献', literature: { abstractExcerpt: '不能泄漏' } }
  ];
  const harness = makeHarness({ entries });
  const prompt = harness.ui.generateReadingPrompt(['selected']);
  assert.match(prompt, /选中的文献/);
  assert.match(prompt, /用户摘录/);
  assert.doesNotMatch(prompt, /未选文献|不能泄漏/);
  const before = harness.state;
  // 明确模拟保存拒绝，确保内存状态仍指向原对象。
  const failing = makeHarness({ entries, fetchImpl: async () => ({ ok: false, json: async () => ({ message: '服务失败' }) }) });
  failing.ui.replaceSaveState(() => false);
  await assert.rejects(() => failing.ui.updateStatus('selected', 'readingStatus', 'title-only'), /保存/);
  assert.equal(failing.state.knowledgeEntries[0].literature.readingStatus, 'excerpt-only');
  assert.match(failing.list.innerHTML, /value="excerpt-only" selected/);
  assert.equal(before.knowledgeEntries[0].id, 'selected');
});
