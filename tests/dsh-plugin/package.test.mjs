import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const workspace = process.cwd()
const pluginRoot = resolve(workspace, 'dsh-plugin/forward-step-dsh')

test('打包后的插件核心可脱离 prototype 和工作区独立加载', t => {
  const temp = mkdtempSync(join(tmpdir(), 'forward-step-package-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const command = 'npm.cmd pack --pack-destination ' + temp
  execFileSync('cmd.exe', ['/d', '/c', command], { cwd: pluginRoot, stdio: 'pipe' })
  const archive = join(temp, 'local-forward-step-dsh-0.1.0.tgz')
  execFileSync('tar', ['-xzf', archive, '-C', temp])
  const unpackedRoot = join(temp, 'package')
  const manifest = JSON.parse(readFileSync(join(unpackedRoot, 'vendor/core/manifest.json'), 'utf8'))
  assert.ok(manifest.files.length >= 1)
  assert.ok(manifest.files.every(file => !file.path.includes('prototype') && !file.path.match(/^[A-Za-z]:/)))
  assert.ok(existsSync(join(unpackedRoot, 'memory/policy.js')), '记忆范围策略必须包含在安装包中')
  assert.ok(existsSync(join(unpackedRoot, 'client/state.js')), '侧栏草稿/冲突 reducer 必须包含在安装包中')
  const require = createRequire(join(unpackedRoot, 'vendor/core/package.json'))
  for (const moduleName of ['prompt-agent-coordinator.js', 'writing-workbench-prompts.js', 'ppt-scene-prompts.js']) {
    assert.doesNotThrow(() => require(join(unpackedRoot, 'vendor/core', moduleName)), moduleName)
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
})
