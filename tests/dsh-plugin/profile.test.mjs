import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const script = 'scripts/dsh-test-profile.ps1';
const workspace = 'D:/VScode/项目/提示词工具/.dsh-workspace';
const run = args => spawnSync('pwsh.exe', ['-NoProfile','-File',script,...args], {cwd:workspace,encoding:'utf8'});

test('Inspect 只读且目标固定为 forward-step-test', () => {
  const result = run(['-Action','Inspect']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.profile, 'forward-step-test');
  assert.equal(report.writes, false);
  assert.ok(report.pluginDependency.includes('提示词工具/'));
  assert.match(report.pluginDependency, /dsh-plugin\/forward-step-dsh$/);
});

test('Backup 拒绝固定备份根目录之外的路径', () => {
  const result = run(['-Action','Backup','-BackupPath','C:/temp/invalid-profile-backup']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /固定目录内/);
});

test('Install 与 Restore 拒绝没有 manifest 的目录', () => {
  for (const action of ['Install','Restore']) {
    const result = run(['-Action',action,'-BackupPath','D:/VScode/项目/提示词工具/.dsh-workspace/docs/acceptance/forward-step-dsh/local-profile-backups/missing']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /清单|manifest/);
  }
});

test('所有写操作都固定到隔离测试 profile，未硬编码用户 profile 参数', () => {
  const source = readFileSync(new URL('../../scripts/dsh-test-profile.ps1', import.meta.url), 'utf8');
  assert.match(source, /forward-step-test/);
  assert.match(source, /D:\/deepseek\/resources\/runtime\/cli\/bin\/dsh\.cmd/);
  assert.doesNotMatch(source, /--profile\s+desktop/i);
  assert.match(source, /profileRoot = \[IO\.Path\]::GetFullPath\('C:\/Users\/Alarm\/.dsh\/profiles\/forward-step-test'\)/);
});



test('Windows 路径校验会把单个反斜杠规范化为正斜杠', () => {
  const source = readFileSync(new URL('../../scripts/dsh-test-profile.ps1', import.meta.url), 'utf8');
  assert.ok(source.includes(String.raw`$normalizedPluginRoot = $pluginRoot.Replace('\','/')`));
  assert.ok(source.includes(String.raw`$lock.Replace('\','/')`));
});

test('Restore 强制刷新实际插件并核对配置备份哈希', () => {
  const source = readFileSync(new URL('../../scripts/dsh-test-profile.ps1', import.meta.url), 'utf8');
  assert.match(source, /'Restore'\s*\{[\s\S]*?'remove'[\s\S]*?'add'[\s\S]*?还原后文件哈希不匹配/);
  assert.match(source, /\$installedHash -ne \$sourceHash/);
});

test('构建后的侧栏显示业务工作区而非过期的探针 profile 标签', () => {
  const client = readFileSync(new URL('../../dsh-plugin/forward-step-dsh/client.js', import.meta.url), 'utf8');
  assert.match(client, /DSH 原生侧栏任务工作区/);
  assert.doesNotMatch(client, /desktop（隔离 DSH_HOME）|测试环境：forward-step-test/);
});
