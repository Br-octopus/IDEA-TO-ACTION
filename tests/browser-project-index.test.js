const test = require('node:test');
const assert = require('node:assert/strict');
const { indexBrowserProjectFiles } = require('../prototype/browser-project-index.js');

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
