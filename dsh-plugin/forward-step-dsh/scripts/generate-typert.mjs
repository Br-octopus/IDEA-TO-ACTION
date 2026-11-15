import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const generatorBuild = resolve(packageRoot, '../../.verification/typert-generator-fixture/build-formal-plugin.mjs')
const result = spawnSync(process.execPath, [generatorBuild], { cwd: packageRoot, stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
