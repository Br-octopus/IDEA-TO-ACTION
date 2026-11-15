const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWritingResourceRunner } = require('../server/writing-resource-runner.js');

async function tempDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'writing-resource-'));
}

test('受控项目扫描只读取授权根目录并排除敏感路径', async t => {
  const root = await tempDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app.js'), 'export default 1;');
  await fs.writeFile(path.join(root, '.env'), 'TOKEN=secret');
  const runner = createWritingResourceRunner({ resources: [{ id: 'scan', kind: 'script', actionId: 'softcopyright.project-scan', title: '扫描', purpose: '扫描', relativePath: 'scripts/scan.py', allowedRoots: ['project'] }], resourceRoots: { project: root } });
  const result = await runner.execute({ actionId: 'softcopyright.project-scan', resourceId: 'scan', rootId: 'project', params: {} });
  assert.equal(result.status, 'executed');
  assert.equal(result.output.inventory.files.some(item => item.path === 'src/app.js'), true);
  assert.equal(result.output.inventory.files.some(item => item.path === '.env'), false);
});

test('受控执行器拒绝未注册动作、路径穿越和非法参数', async () => {
  const root = await tempDirectory();
  const runner = createWritingResourceRunner({ resources: [{ id: 'scan', kind: 'script', actionId: 'softcopyright.project-scan', title: '扫描', purpose: '扫描', relativePath: 'scripts/scan.py', allowedRoots: ['project'], inputSchema: { properties: { maxFiles: { type: 'integer', maximum: 10 } } } }], resourceRoots: { project: root } });
  await assert.rejects(() => runner.execute({ actionId: 'unknown', rootId: 'project' }), { code: 'RESOURCE_ACTION_NOT_ALLOWED' });
  await assert.rejects(() => runner.execute({ actionId: 'softcopyright.project-scan', rootId: 'project', params: { maxFiles: 11 } }), { code: 'RESOURCE_PARAMS_INVALID' });
  assert.equal(runner.safeRelative('../outside'), '');
  assert.equal(runner.safeRelative('C:/outside'), '');
  await fs.rm(root, { recursive: true, force: true });
});

test('资源归档按需读取目录中的有界片段', async t => {
  const archiveRoot = await tempDirectory();
  t.after(() => fs.rm(archiveRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(archiveRoot, 'references'), { recursive: true });
  await fs.writeFile(path.join(archiveRoot, 'references', 'guide.md'), 'abcdef');
  const runner = createWritingResourceRunner({ resources: [{ id: 'guide', kind: 'reference', title: '指南', purpose: '参考', archive: 'skill', relativePath: 'references/guide.md', enabled: true }], resourceArchives: { skill: archiveRoot } });
  const result = await runner.read({ resourceId: 'guide', limit: 3 });
  assert.equal(result.content, 'abc');
  assert.equal(result.truncated, true);
});
