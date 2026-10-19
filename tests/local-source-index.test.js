const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { listSourceFiles, indexSourceFile, refreshSourceIndex, searchSourceIndex } = require('../prototype/local-source-index.js');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'local-source-index-'));
}

test('发现受支持文本文件并排除私密、二进制、超限和构建目录', t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, 'guide.md'), '# 发布工作流\n自动化部署步骤');
  fs.writeFileSync(path.join(root, 'config.yaml'), 'name: deploy');
  fs.writeFileSync(path.join(root, 'script.ts'), 'export function deploy() {}');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=value');
  fs.writeFileSync(path.join(root, 'id_rsa'), 'PRIVATE KEY');
  fs.writeFileSync(path.join(root, 'image.png'), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(root, 'large.txt'), 'x'.repeat(1024 * 1024 + 1));
  fs.writeFileSync(path.join(root, 'node_modules', 'dependency.js'), 'ignored');
  fs.writeFileSync(path.join(root, 'dist', 'bundle.js'), 'ignored');
  fs.writeFileSync(path.join(root, '.git', 'config'), 'ignored');

  const entries = listSourceFiles(root);
  assert.deepEqual(entries.map(item => item.relativePath), ['config.yaml', 'guide.md', 'script.ts']);
  assert.equal(entries[1].title, '发布工作流');
  assert.ok(entries[1].excerpt.includes('自动化部署步骤'));
  assert.ok(entries[1].fragments.length <= 5);
  assert.ok(entries[1].fragments.reduce((size, fragment) => size + fragment.text.length, 0) <= 1400);
  assert.ok(entries.every(item => !('content' in item) && !('absolutePath' in item)));
  assert.equal(indexSourceFile(path.join(root, 'guide.md')).relativePath, 'guide.md');
});

test('遍历顺序稳定，搜索可按关键词匹配，刷新检测修改和删除', t => {
  const root = tempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'b.md'), '# Beta\n缓存刷新策略');
  fs.writeFileSync(path.join(root, 'a.md'), '# Alpha\n本地工作流');
  fs.writeFileSync(path.join(root, 'long.md'), `# Long\n${Array.from({ length: 18 }, (_, index) => `行${index + 1}`).join('\n')}\n后半段专属检索词`);
  const first = refreshSourceIndex(root);
  assert.deepEqual(first.files.map(item => item.relativePath), ['a.md', 'b.md', 'long.md']);
  assert.equal(searchSourceIndex(first, '缓存').files[0].relativePath, 'b.md');
  const lateMatch = searchSourceIndex(first, '后半段专属检索词').files[0];
  assert.ok(lateMatch.excerpt.includes('后半段专属检索词'));
  assert.ok(lateMatch.fragments[0].line > 10);
  assert.ok(!('content' in lateMatch));
  fs.writeFileSync(path.join(root, 'a.md'), '# Alpha\n更新后的工作流');
  fs.unlinkSync(path.join(root, 'b.md'));
  fs.writeFileSync(path.join(root, 'c.md'), '# Gamma\n新增文档');
  const next = refreshSourceIndex(root, first);
  assert.deepEqual(next.changes.added.map(item => item.relativePath), ['c.md']);
  assert.deepEqual(next.changes.modified.map(item => item.relativePath), ['a.md']);
  assert.deepEqual(next.changes.deleted, ['b.md']);
});

test('不跟随逃出授权根目录的符号链接', t => {
  const root = tempDirectory();
  const outside = tempDirectory();
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(outside, 'secret.md'), '# secret');
  try { fs.symlinkSync(outside, path.join(root, 'linked'), 'junction'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) return t.skip(`当前环境无法创建符号链接：${error.code}`);
    throw error;
  }
  assert.deepEqual(listSourceFiles(root), []);
  assert.throws(() => indexSourceFile(path.join(root, 'linked', 'secret.md'), { root }));
});
