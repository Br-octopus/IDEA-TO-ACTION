import { defineConfig } from 'tsdown'

const pluginName = '@local/forward-step-dsh'
const external = ['react', '@deepseek-ai/dsh-api-gateway/client']

export default defineConfig({
  name: `${pluginName}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: '.',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: external,
    alwaysBundle: ['zod'],
    onlyBundle: false,
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginName)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
