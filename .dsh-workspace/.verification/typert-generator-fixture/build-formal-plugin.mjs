import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)))
const workspaceRoot = join(toolRoot, 'formal-plugin-workspace')
const packageRoot = join(workspaceRoot, 'packages', 'forward-step-dsh')
const pluginRoot = resolve(toolRoot, '../../dsh-plugin/forward-step-dsh')

await mkdir(packageRoot, { recursive: true })
await cp(join(toolRoot, 'packages', 'dsh-typert-protocol'), join(workspaceRoot, 'packages', 'dsh-typert-protocol'), { recursive: true, force: true })
await cp(join(pluginRoot, 'src'), join(packageRoot, 'src'), { recursive: true, force: true })
await cp(join(pluginRoot, 'package.json'), join(packageRoot, 'package.json'), { force: true })
const stagedManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
stagedManifest.exports = { '.': stagedManifest.exports['.'], './types': stagedManifest.exports['./types'], './typert': stagedManifest.exports['./typert'], './remote': stagedManifest.exports['./remote'] }
stagedManifest.files = ['lib/typert.host.js', 'lib/typert.host.d.ts', 'lib/typert.remote-client.js', 'lib/typert.remote-client.d.ts']
await writeFile(join(packageRoot, 'package.json'), JSON.stringify(stagedManifest, null, 2) + '\n')
await cp(join(pluginRoot, 'tsconfig.host.project.json'), join(packageRoot, 'tsconfig.host.project.json'), { force: true })
const projectConfig = JSON.parse(await readFile(join(packageRoot, 'tsconfig.host.project.json'), 'utf8'))
projectConfig.compilerOptions.paths = { '@deepseek-ai/dsh-typert-protocol': ['../dsh-typert-protocol/lib/types/index.d.ts'] }
await writeFile(join(packageRoot, 'tsconfig.host.project.json'), JSON.stringify(projectConfig, null, 2) + '\n')
await writeFile(join(packageRoot, 'tsconfig.json'), JSON.stringify({ extends: './tsconfig.host.project.json' }, null, 2) + '\n')
await writeFile(join(workspaceRoot, 'tsconfig.host.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: true, paths: { '@deepseek-ai/dsh-typert-protocol': ['packages/dsh-typert-protocol/lib/types/index.d.ts'] } }, files: [], references: [{ path: './packages/dsh-typert-protocol/tsconfig.json' }, { path: './packages/forward-step-dsh/tsconfig.json' }] }, null, 2) + '\n')
await writeFile(join(workspaceRoot, 'client-stub.ts'), 'export {}\n')
await writeFile(join(workspaceRoot, 'tsconfig.client.json'), JSON.stringify({ files: ['./client-stub.ts'], references: [] }, null, 2) + '\n')

const tsc = join(toolRoot, 'node_modules', 'typescript', 'bin', 'tsc')
const compiled = spawnSync(process.execPath, [tsc, '-b', join(packageRoot, 'tsconfig.json')], { cwd: toolRoot, encoding: 'utf8' })
if (compiled.status !== 0) throw new Error(`TypeScript 编译失败：\n${compiled.stdout}\n${compiled.stderr}`)

const artifacts = new WorkspaceTypertGenerator(workspaceRoot).generate(['@local/forward-step-dsh'], ['host'])
if (artifacts.length !== 1 || !artifacts[0].remote) throw new Error('未产生唯一的 Host 与 Client Remote 产物')
const artifact = artifacts[0]
const output = join(packageRoot, 'lib')
await mkdir(output, { recursive: true })
await writeFile(join(output, 'typert.host.js'), artifact.js)
await writeFile(join(output, 'typert.host.d.ts'), artifact.dts)
await writeFile(join(output, 'typert.remote-client.js'), artifact.remote.js)
await writeFile(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts)

const destination = join(pluginRoot, 'lib')
await mkdir(destination, { recursive: true })
const emitted = await readdir(output)
for (const file of emitted.filter((name) => name.endsWith('.js') || name.endsWith('.d.ts'))) {
  await cp(join(output, file), join(destination, file), { force: true })
}
const manifest = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8'))
const receipt = {
  package: artifact.package,
  face: artifact.face,
  hostInvocations: [...artifact.js.matchAll(/id: ['"]/g)].length,
  remoteDescriptorCount: [...artifact.remote.js.matchAll(/id: ['"]/g)].length,
  generatedFiles: emitted.filter((name) => name.endsWith('.js') || name.endsWith('.d.ts')),
  exportsValidatedByGenerator: manifest.exports['./typert'].default === './lib/typert.host.js' && manifest.exports['./remote'].default === './lib/typert.remote-client.js',
  generatorVersion: JSON.parse(await readFile(join(toolRoot, 'node_modules/@deepseek-ai/dsh-typert-generator/package.json'), 'utf8')).version,
  status: 'generated; Web Host RPC/storage/cancellation verified; Desktop Host/Client, model isolation, and lifecycle remain unverified',
}
await writeFile(join(toolRoot, 'formal-plugin-build-result.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt, null, 2))


