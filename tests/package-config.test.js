const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const build = packageJson.build;

test('Electron 入口和生产包文件清单已锁定', () => {
  assert.equal(packageJson.main, 'electron/main.js');
  assert.deepEqual(build.files, ['electron/**/*', 'prototype/**/*', 'server/**/*', 'server.js', 'package.json']);
  for (const excluded of ['docs/**/*', 'tests/**/*', '.env', 'release/**/*']) {
    assert.equal(build.files.includes(excluded), false, `不应打包：${excluded}`);
  }
});

test('所有社媒研究运行时脚本均纳入 npm run check', () => {
  for (const script of [
    'prototype/social-research-prompts.js',
    'prototype/social-research-schema.js',
    'prototype/social-research-ui.js',
    'prototype/social-research-workflow.js'
  ]) {
    assert.ok(packageJson.scripts.check.includes(`node --check ${script}`), `缺少语法检查：${script}`);
  }
});

test('Windows 构建同时包含 NSIS 和 portable', () => {
  assert.deepEqual(build.win.target, ['nsis', 'portable']);
  assert.equal(build.appId, 'com.forwardstep.app');
});

test('Windows 产品、图标和输出命名已固定', () => {
  assert.equal(build.productName, '向前一步');
  assert.equal(build.directories.output, 'release');
  assert.equal(build.win.icon, 'build/icon.ico');
  assert.equal(build.nsis.artifactName, 'ForwardStep-${version}-setup.${ext}');
  assert.equal(build.portable.artifactName, 'ForwardStep-${version}-portable.${ext}');
});

test('NSIS 安装、快捷方式和卸载入口已配置', () => {
  assert.equal(build.nsis.oneClick, false);
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(build.nsis.createStartMenuShortcut, true);
  assert.equal(build.nsis.createDesktopShortcut, true);
  assert.equal(build.nsis.shortcutName, '向前一步');
  assert.equal(build.nsis.uninstallDisplayName, '向前一步');
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(build.nsis.installerIcon, 'build/icon.ico');
  assert.equal(build.nsis.uninstallerIcon, 'build/icon.ico');
  assert.equal(build.nsis.include, 'build/installer.nsh');
});

test('portable 版本使用用户级运行权限', () => {
  assert.equal(build.portable.requestExecutionLevel, 'user');
});

test('图标是非空且结构基本有效的 ICO 文件', () => {
  const iconPath = path.join(root, 'build', 'icon.ico');
  assert.ok(fs.existsSync(iconPath));
  const icon = fs.readFileSync(iconPath);
  assert.ok(icon.length > 22);
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  const imageCount = icon.readUInt16LE(4);
  assert.ok(imageCount >= 1);

  for (let index = 0; index < imageCount; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = icon[entryOffset] || 256;
    const height = icon[entryOffset + 1] || 256;
    const bytesInResource = icon.readUInt32LE(entryOffset + 8);
    const imageOffset = icon.readUInt32LE(entryOffset + 12);
    assert.ok(width >= 256 && height >= 256, 'Windows 图标至少需要包含 256x256 资源');
    assert.ok(bytesInResource > 0);
    assert.ok(imageOffset >= 6 + imageCount * 16);
    assert.ok(imageOffset + bytesInResource <= icon.length);
  }
});

test('NSIS 自定义脚本保留安装器默认能力', () => {
  const installer = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
  assert.match(installer, /!macro\s+customInstall/);
  assert.match(installer, /!macro\s+customUnInstall/);
  assert.match(installer, /DetailPrint/);
});
