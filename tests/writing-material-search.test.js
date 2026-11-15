const test = require('node:test');
const assert = require('node:assert/strict');
const { createWritingMaterialSearch } = require('../prototype/writing-material-search');

function makeFile(name, text, relativePath = name) {
  const bytes = new TextEncoder().encode(text);
  return { name, webkitRelativePath: relativePath, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer };
}

test('全文检索命中样本摘录之外的内容并保留路径和行号', async () => {
  const search = createWritingMaterialSearch();
  const body = `开头说明\n${'无关内容\n'.repeat(30)}数据库迁移回滚步骤必须先备份`;
  const file = makeFile('guide.md', body, 'project/docs/guide.md');
  search.registerSource('project-1', [file], [{ id: 'material-guide', title: 'guide.md', relativePath: 'docs/guide.md' }]);

  const result = await search.search(['数据库迁移回滚']);
  assert.equal(result.complete, true);
  assert.equal(result.scanned, 1);
  assert.equal(result.results[0].materialId, 'material-guide');
  assert.equal(result.results[0].relativePath, 'docs/guide.md');
  assert.match(result.results[0].excerpt, /数据库迁移回滚步骤/);
  assert.match(result.results[0].locator, /第 32 行/);
});

test('读取只接受先前搜索命中的文件位置', async () => {
  const search = createWritingMaterialSearch();
  const file = makeFile('manual.txt', `保留范围\n${'普通说明\n'.repeat(10)}异常恢复流程`);
  search.registerSource('project-2', [file], [{ id: 'material-manual', title: file.name, relativePath: file.name }]);
  const { results } = await search.search(['异常恢复']);
  const hit = results[0];

  await assert.rejects(search.read(hit.id, 0), /不是本机检索命中/);
  const read = await search.read(hit.id, hit.offset);
  assert.equal(read.materialId, 'material-manual');
  assert.match(read.excerpt, /异常恢复流程/);
});

test('凭证行和常见令牌在片段离开本机前遮蔽', async () => {
  const search = createWritingMaterialSearch();
  const file = makeFile('config.md', '部署配置\napi_key = "super-secret-value-123456"\n下一步检查服务');
  search.registerSource('project-3', [file], [{ id: 'material-config', title: file.name, relativePath: file.name }]);
  const { results } = await search.search(['api_key']);

  assert.equal(results.length, 1);
  assert.doesNotMatch(results[0].excerpt, /super-secret-value/);
  assert.match(results[0].excerpt, /疑似凭证行已遮蔽/);
});

test('移除来源后文件句柄和检索授权同时失效', async () => {
  const search = createWritingMaterialSearch();
  const file = makeFile('steps.txt', '发布流程先检查配置');
  search.registerSource('project-4', [file], [{ id: 'material-steps', title: file.name, relativePath: file.name }]);
  const { results } = await search.search(['发布流程']);
  search.removeSource('project-4');

  assert.equal(search.size(), 0);
  await assert.rejects(search.read(results[0].id, results[0].offset), /未授权或已失效/);
});

test('取消扫描会中止后续文件读取', async () => {
  const search = createWritingMaterialSearch();
  const files = [makeFile('one.txt', '查询目标'), makeFile('two.txt', '查询目标')];
  search.registerSource('project-5', files, files.map(file => ({ id: file.name, title: file.name, relativePath: file.name })));
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(search.search(['查询目标'], { signal: controller.signal }), { name: 'AbortError' });
});
