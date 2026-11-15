import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const workspace = process.cwd()
const pluginRoot = resolve(workspace, 'dsh-plugin/forward-step-dsh')
const requiredPackageEntries = [
  'package/index.js', 'package/client.js', 'package/client/workspace-files.js', 'package/client/ppt-screenshot-import.js', 'package/lib/host-service.js',
  'package/core/store.js', 'package/core/current-overrides.js', 'package/core/pptx-import.js', 'package/memory/policy.js',
  'package/skills/forward-step/SKILL.md', 'package/vendor/core/package.json',
  'package/vendor/core/manifest.json',
]

function assertRequiredPackageEntries(paths) {
  for (const entry of requiredPackageEntries) assert.ok(paths.includes(entry), `tarball 缺少 ${entry}`)
}

test('包验收在最终 Client 构建产物缺失时失败关闭', () => {
  const paths = requiredPackageEntries.filter(entry => entry !== 'package/client.js')
  assert.throws(() => assertRequiredPackageEntries(paths), /tarball 缺少 package\/client\.js/)
})

test('tarball 包含完整插件运行边界且不夹带本地配置或原应用路径', async t => {
  const temp = mkdtempSync(join(tmpdir(), 'forward-step-package-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const manifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
  if (process.platform === 'win32') {
    const quotedTemp = temp.replaceAll("'", "''")
    execFileSync('pwsh.exe', ['-NoProfile', '-Command', `pnpm pack --pack-destination '${quotedTemp}'`], { cwd: pluginRoot, stdio: 'pipe' })
  } else {
    execFileSync('pnpm', ['pack', '--pack-destination', temp], { cwd: pluginRoot, stdio: 'pipe' })
  }
  const archiveName = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`
  const archive = join(temp, archiveName)
  assert.ok(existsSync(archive), 'pnpm pack 必须生成版本匹配的 tarball')
  const paths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/)
  assertRequiredPackageEntries(paths)
  assert.equal(paths.some(path => /(^|\/)(?:\.env(?:$|\.)|[^/]*\.sqlite(?:$|[-.])|local-profile-backups|app\.asar)(?:\/|$)/i.test(path)), false)
  assert.equal(paths.some(path => /(^|\/)(?:electron|node_modules\/\.pnpm)(?:\/|$)/i.test(path)), false)
  assert.equal(paths.some(path => /(^|\/)[A-Z]:[\\/]/.test(path)), false, 'tarball 路径不能是绝对路径')
  execFileSync('tar', ['-xzf', archive, '-C', temp])
  const unpackedRoot = join(temp, 'package')
  const coreManifest = JSON.parse(readFileSync(join(unpackedRoot, 'vendor/core/manifest.json'), 'utf8'))
  assert.ok(coreManifest.files.length >= 1)
  assert.ok(coreManifest.files.every(file => !file.path.includes('prototype') && !file.path.match(/^[A-Za-z]:/)))
  assert.ok(existsSync(join(unpackedRoot, 'memory/policy.js')), '记忆范围策略必须包含在安装包中')
  assert.ok(existsSync(join(unpackedRoot, 'client/drafts.js')), '侧栏草稿能力必须包含在安装包中')
  assert.ok(existsSync(join(unpackedRoot, 'client/state.js')), '侧栏草稿/冲突 reducer 必须包含在安装包中')
  assert.ok(existsSync(join(unpackedRoot, 'client/material-files.js')), '显式材料文件导入器必须包含在安装包中')
  assert.ok(existsSync(join(unpackedRoot, 'core/writing-material-parser.cjs')), 'PDF、DOCX 与图像解析器必须包含在安装包中')
  for (const entry of [
    'core/academic.js', 'core/social-research.js', 'core/knowledge.js', 'core/backup.js',
    'core/migration/source.js', 'core/migration/preview.js', 'core/migration/commit.js', 'core/migration/receipt.js',
    'vendor/core/academic-literature.js', 'vendor/core/academic-review.js', 'vendor/core/academic-publishing.js',
    'vendor/core/social-research-schema.js', 'vendor/core/social-research-workflow.js',
  ]) assert.ok(existsSync(join(unpackedRoot, entry)), `tarball 缺少 ${entry}`)
  for (const entry of coreManifest.files) {
    const content = readFileSync(join(unpackedRoot, 'vendor/core', entry.path))
    assert.equal(createHash('sha256').update(content).digest('hex'), entry.sha256, `vendor 来源哈希不匹配: ${entry.path}`)
    if (entry.sourceSha256) {
      const expectedOverlay = {
        'ppt-scene-schema.js': 'ppt-annotated-image-target-v10',
        'ppt-scene-prompts.js': 'ppt-annotated-image-target-v9',
        'academic-literature.js': 'academic-import-preservation-v1',
        'knowledge-schema.js': 'knowledge-imported-fields-v1',
        'writing-pack-schema.js': 'writing-pack-settings-history-v3',
        'writing-workbench-schema.js': 'writing-pack-snapshot-selections-v1',
        'writing-workbench-prompts.js': 'writing-pack-snapshot-selections-v1',
      }[entry.path]
      assert.equal(entry.overlay, expectedOverlay, `vendor 适配没有对应登记: ${entry.path}`)
      assert.equal(createHash('sha256').update(readFileSync(join(workspace, 'prototype', entry.path))).digest('hex'), entry.sourceSha256,
        `vendor 适配来源哈希不匹配: ${entry.path}`)
    }
  }
  const require = createRequire(join(unpackedRoot, 'vendor/core/package.json'))
  for (const moduleName of [
    'prompt-agent-coordinator.js', 'writing-workbench-prompts.js', 'ppt-scene-prompts.js',
    'academic-literature.js', 'academic-review.js', 'academic-publishing.js', 'social-research-workflow.js',
  ]) {
    assert.doesNotThrow(() => require(join(unpackedRoot, 'vendor/core', moduleName)), moduleName)
  }
  const { initialState } = await import(pathToFileURL(join(unpackedRoot, 'core/schema.js')).href)
  const { deriveCurrentOverrides } = await import(pathToFileURL(join(unpackedRoot, 'core/current-overrides.js')).href)
  const { decideScope } = await import(pathToFileURL(join(unpackedRoot, 'memory/policy.js')).href)
  assert.equal(initialState().schemaVersion, 1)
  assert.deepEqual(deriveCurrentOverrides({ domain: 'writing', currentRequirements: ['请保持简洁'] }), [
    { key: 'verbosity', value: '简洁' },
  ])
  assert.equal(decideScope(null, { explicitUserScope: true, requestedScope: 'domain', conflict: false, projectSpecific: false, taskIds: ['task-a'], domains: ['writing'] }), 'domain')
  const packageFiles = []
  const walk = directory => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) walk(path)
      else packageFiles.push(path)
    }
  }
  walk(unpackedRoot)
  const sourceRootMarker = /D:[\\/]VScode[\\/]项目[\\/]提示词工具/i
  for (const path of packageFiles.filter(path => /\.(?:js|json|md|yml|yaml|svg|d\.ts)$/i.test(path))) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), sourceRootMarker, `安装包不得嵌入原工作区路径: ${path}`)
  }
})




test('宿主注入的 peer 依赖必须保持可选', () => {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
  const injectedPeers = [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-storage-domain',
    '@deepseek-ai/dsh-typert-protocol',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-agent',
  ]

  for (const peerName of injectedPeers) {
    assert.ok(manifest.peerDependencies[peerName], `${peerName} 必须声明为 peer dependency`)
    assert.equal(
      manifest.peerDependenciesMeta?.[peerName]?.optional,
      true,
      `${peerName} 由 DSH 宿主注入，安装时必须标记为 optional`,
    )
  }
  assert.equal(manifest.version, '0.2.0-beta.1')
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '4.0.4', 'Cordis peer 范围应锁定到本机已验证版本')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh'], '0.2.0-rc.2', 'DSH peer 范围应锁定到本机已验证版本')
  assert.equal(manifest.dependencies.yazl, '3.3.1', '插件 ZIP 导出使用的 yazl 必须作为运行时依赖打包')
  assert.equal(manifest.devDependencies.yazl, undefined, '运行时归档器不能只在开发依赖中声明')
})







