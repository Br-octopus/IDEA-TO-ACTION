const test = require('node:test');
const assert = require('node:assert/strict');

let clientModule;
try {
  clientModule = require('../server/academic-literature-client.js');
} catch {
  clientModule = {};
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('DOI 查询只请求固定 Crossref 地址并映射白名单题录，不保留摘要', async () => {
  assert.equal(typeof clientModule.createAcademicLiteratureClient, 'function', '应提供文献元数据客户端');
  const calls = [];
  const client = clientModule.createAcademicLiteratureClient({ fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return response({ message: {
      DOI: '10.1234/example', title: ['A title'], author: [{ given: 'Jane', family: 'Doe' }],
      type: 'journal-article', published: { 'date-parts': [[2024, 2, 1]] }, 'container-title': ['Journal'], volume: '8', issue: '2', page: '1-9', abstract: '<p>copyrighted abstract</p>', secret: 'discard'
    } });
  }, now: () => '2026-10-21T00:00:00.000Z' });
  const result = await client.lookupByDoi('https://doi.org/10.1234/EXAMPLE');
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).origin, 'https://api.crossref.org');
  assert.match(calls[0].url, /\/works\/10\.1234%2Fexample$/i);
  assert.deepEqual(result, { ok: true, metadata: {
    title: 'A title', authors: ['Jane Doe'], year: '2024', publication: 'Journal',
    volume: '8', issue: '2', pages: '1-9', doi: '10.1234/example', pmid: '',
    itemType: 'journal-article', metadataProvider: 'Crossref', queriedAt: '2026-10-21T00:00:00.000Z', metadataStatus: 'registry-returned'
  } });
  assert.doesNotMatch(JSON.stringify(result), /copyrighted abstract|secret/);
});

test('PMID 查询只请求固定 NCBI ESummary 地址并映射题录，不调用摘要接口', async () => {
  assert.equal(typeof clientModule.createAcademicLiteratureClient, 'function', '应提供文献元数据客户端');
  const calls = [];
  const client = clientModule.createAcademicLiteratureClient({ fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return response({ result: { uids: ['12345'], '12345': {
      uid: '12345', title: 'PubMed article', authors: [{ name: 'John Roe' }], pubdate: '2022 Jan',
      fulljournalname: 'PubMed Journal', volume: '3', issue: '1', pages: '5-11',
      articleids: [{ idtype: 'doi', value: '10.4567/pubmed' }], elocationid: '10.4567/pubmed [doi]', sortpubdate: '2022/01/01', abstract: 'must not be requested'
    } } });
  }, now: () => '2026-10-21T00:00:00.000Z' });
  const result = await client.lookupByPmid('12345');
  const url = new URL(calls[0].url);
  assert.equal(url.origin, 'https://eutils.ncbi.nlm.nih.gov');
  assert.equal(url.pathname, '/entrez/eutils/esummary.fcgi');
  assert.equal(url.searchParams.get('db'), 'pubmed');
  assert.equal(url.searchParams.get('id'), '12345');
  assert.equal(url.searchParams.get('retmode'), 'json');
  assert.equal(calls.length, 1);
  assert.equal(result.metadata.title, 'PubMed article');
  assert.equal(result.metadata.doi, '10.4567/pubmed');
  assert.equal(result.metadata.metadataProvider, 'NCBI PubMed');
  assert.equal(result.metadata.metadataStatus, 'registry-returned');
  assert.doesNotMatch(JSON.stringify(result), /must not be requested|abstract/);
});

test('拒绝不规范 DOI/PMID，未找到和上游失败返回稳定错误', async () => {
  assert.equal(typeof clientModule.createAcademicLiteratureClient, 'function', '应提供文献元数据客户端');
  let calls = 0;
  const client = clientModule.createAcademicLiteratureClient({ fetchImpl: async () => { calls++; return response({}, 404); } });
  assert.equal((await client.lookupByDoi('javascript:alert(1)')).code, 'INVALID_IDENTIFIER');
  assert.equal((await client.lookupByPmid('12345 OR *')).code, 'INVALID_IDENTIFIER');
  assert.equal(calls, 0);

  const missing = await client.lookupByDoi('10.1234/missing');
  assert.equal(missing.code, 'NOT_FOUND');
  const failedClient = clientModule.createAcademicLiteratureClient({ fetchImpl: async () => response({}, 503) });
  assert.equal((await failedClient.lookupByPmid('12345')).code, 'UPSTREAM_ERROR');
});
