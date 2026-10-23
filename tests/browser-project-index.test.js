const test = require('node:test');
const assert = require('node:assert/strict');
const {
  indexBrowserProjectFiles,
  filterBrowserProjectCandidates,
  restoreBrowserProjectCandidate
} = require('../prototype/browser-project-index.js');

function projectFile(relativePath, content) {
  const bytes = Buffer.from(content, 'utf8');
  return {
    name: relativePath.split('/').at(-1),
    webkitRelativePath: `demo/${relativePath}`,
    size: bytes.length,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
  };
}

test('浏览器项目索引读取代码与文档，跳过依赖目录和敏感文件', async () => {
  const result = await indexBrowserProjectFiles([
    projectFile('src/feature.ts', 'export function runFeature() {\n  return "本机读取的功能逻辑";\n}'),
    projectFile('src/config.js', "const API_KEY = 'not-a-real-secret-value';\nexport const enabled = true;"),
    projectFile('docs/guide.md', '# 操作手册\n第一步：打开工作台。'),
    projectFile('node_modules/pkg/index.js', '不应被读取'),
    projectFile('.env', 'API_KEY=secret'),
    projectFile('image.png', 'binary')
  ]);

  assert.equal(result.inventoryComplete, true);
  assert.deepEqual(result.files.map(file => file.relativePath), ['src/feature.ts', 'src/config.js', 'docs/guide.md']);
  assert.match(result.files[0].excerpt, /本机读取的功能逻辑/);
  assert.equal(result.inventory.find(item => item.title === '已排除的敏感文件').relativePath, '');
  assert.ok(result.inventory.some(item => item.relativePath === 'image.png' && item.status === 'unsupported'));
  assert.ok(!JSON.stringify(result).includes('API_KEY=secret'));
  assert.ok(!JSON.stringify(result).includes('not-a-real-secret-value'));
  assert.match(result.files[1].excerpt, /疑似密钥行已遮蔽/);
  assert.ok(!JSON.stringify(result).includes('不应被读取'));
});

test('浏览器项目索引拒绝超过单文件上限并可响应取消', async () => {
  const oversized = { name: 'large.js', webkitRelativePath: 'demo/large.js', size: 1024 * 1024 + 1,
    async arrayBuffer() { throw new Error('不应读取超限文件'); } };
  const result = await indexBrowserProjectFiles([oversized]);
  assert.equal(result.inventory[0].status, 'too-large');

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(indexBrowserProjectFiles([projectFile('src/app.js', '内容')], { signal: controller.signal }), { name: 'AbortError' });
});

test('生成和临时噪声不读取正文，且仅可恢复非敏感生成项', async () => {
  const generated = projectFile('build_v8.js', '应在恢复前不读取');
  const minified = projectFile('vendor.min.js', 'minified content');
  const temporary = projectFile('src/feature.tmp.js', 'temporary content');
  const sensitive = projectFile('.env', 'SECRET=value');
  const sensitiveDirectory = projectFile('secrets/config.tmp.js', 'private data');
  const excluded = projectFile('node_modules/pkg/index.js', '依赖内容');
  let generatedReads = 0;
  for (const file of [generated, minified, temporary]) {
    const read = file.arrayBuffer;
    file.arrayBuffer = async () => { generatedReads++; return read(); };
  }

  const result = await indexBrowserProjectFiles([
    projectFile('docs/操作手册.md', '# 操作手册\n正常候选'),
    projectFile('src/feature.js', 'export const useful = true;'),
    generated, minified, temporary, sensitive, sensitiveDirectory, excluded
  ]);

  assert.equal(generatedReads, 0);
  assert.deepEqual(result.files.map(file => file.relativePath), ['docs/操作手册.md', 'src/feature.js']);
  assert.deepEqual(result.filteredCandidates.map(({ relativePath, title, reason }) => ({ relativePath, title, reason })), [
    { relativePath: 'build_v8.js', title: 'build_v8.js', reason: 'generated' },
    { relativePath: 'vendor.min.js', title: 'vendor.min.js', reason: 'generated' },
    { relativePath: 'src/feature.tmp.js', title: 'feature.tmp.js', reason: 'generated' }
  ]);
  assert.ok(result.filteredCandidates.every(item => Object.keys(item).sort().join(',') === 'reason,relativePath,title'));
  assert.ok(!JSON.stringify(result.filteredCandidates).includes('.env'));
  assert.ok(!JSON.stringify(result.filteredCandidates).includes('secrets'));
  assert.ok(!JSON.stringify(result.filteredCandidates).includes('node_modules'));
  assert.ok(!result.files.some(file => file.relativePath.includes('secrets')));
  assert.equal(result.filteredCandidateCount, 3);

  const restored = await restoreBrowserProjectCandidate([generated], result.filteredCandidates[0].relativePath);
  assert.equal(restored.file.relativePath, 'build_v8.js');
  assert.equal(generatedReads, 1);

  await assert.rejects(restoreBrowserProjectCandidate([sensitive], '.env'), { code: 'NOT_RESTORABLE' });
  await assert.rejects(restoreBrowserProjectCandidate([excluded], 'node_modules/pkg/index.js'), { code: 'NOT_RESTORABLE' });
});

test('恢复候选仍执行格式、大小、密钥和二进制安全检查', async () => {
  const candidates = [
    projectFile('large.tmp.js', 'x'.repeat(1024 * 1024 + 1)),
    projectFile('image.tmp.png', 'image'),
    projectFile('binary.tmp.js', '\u0000binary')
  ];
  for (const file of candidates) file.size = file.webkitRelativePath.includes('large') ? 1024 * 1024 + 1 : file.size;
  for (const file of candidates) {
    await assert.rejects(restoreBrowserProjectCandidate([file], file.webkitRelativePath.replace(/^demo\//, '')), error =>
      error.code === 'UNSAFE_CANDIDATE');
  }

  const masked = projectFile('config.tmp.js', "const API_KEY = 'not-a-real-secret-value';\nexport const enabled = true;");
  const restoredSecret = await restoreBrowserProjectCandidate([masked], 'config.tmp.js');
  assert.match(restoredSecret.file.excerpt, /疑似密钥行已遮蔽/);
  assert.ok(!JSON.stringify(restoredSecret).includes('not-a-real-secret-value'));
});

test('候选搜索覆盖完整可用集合并按最多20项分页', async () => {
  const input = Array.from({ length: 25 }, (_, index) => projectFile(`src/file-${String(index).padStart(2, '0')}.js`, `export const marker${index} = true;`));
  input.push(projectFile('docs/操作手册.md', '# 操作手册\n流程说明'));
  input.push(projectFile('vendor.min.js', 'filtered bundle'));
  const result = await indexBrowserProjectFiles(input);

  const all = filterBrowserProjectCandidates(result, { page: 1 });
  const secondPage = filterBrowserProjectCandidates(result, { page: 2 });
  const search = filterBrowserProjectCandidates(result, { query: '操作手册' });
  const excerptSearch = filterBrowserProjectCandidates(result, { query: 'marker24' });
  const withFiltered = filterBrowserProjectCandidates(result, { showFiltered: true });
  const hiddenNoiseSearch = filterBrowserProjectCandidates(result, { query: 'vendor.min.js', showFiltered: true });

  assert.equal(all.total, 26);
  assert.equal(all.items.length, 20);
  assert.equal(all.filteredTotal, 1);
  assert.equal(all.inventoryComplete, true);
  assert.equal(secondPage.total, 26);
  assert.equal(secondPage.items.length, 6);
  assert.equal(secondPage.page, 2);
  assert.equal(secondPage.items[0].relativePath, 'src/file-20.js');
  assert.equal(search.total, 1);
  assert.equal(search.items[0].relativePath, 'docs/操作手册.md');
  assert.equal(excerptSearch.total, 1);
  assert.equal(withFiltered.filteredTotal, 1);
  assert.equal(withFiltered.filteredItems[0].relativePath, 'vendor.min.js');
  assert.equal(hiddenNoiseSearch.total, 0);
});

test('目录最多扫描10000项并报告扫描完整性与过滤数量', async () => {
  const input = Array.from({ length: 10001 }, (_, index) => projectFile(`src/file-${index}.js`, 'export const value = true;'));
  const result = await indexBrowserProjectFiles(input);
  const page = filterBrowserProjectCandidates(result);

  assert.equal(result.files.length, 10000);
  assert.equal(result.inventoryComplete, false);
  assert.equal(result.inventory.filter(item => item.status === 'indexed').length, 10000);
  assert.equal(page.total, 10000);
  assert.equal(page.filteredTotal, 0);
  assert.equal(page.inventoryComplete, false);
});
