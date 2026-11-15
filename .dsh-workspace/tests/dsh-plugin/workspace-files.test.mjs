import test from 'node:test'
import assert from 'node:assert/strict'
import { browseWorkspaceDirectory } from '../../dsh-plugin/forward-step-dsh/client/workspace-files.js'

function makeWorkspace(files, { truncated = new Set(), readOverride } = {}) {
  const calls = []
  const entriesByDirectory = new Map()
  for (const [path, file] of Object.entries(files)) {
    const parts = path.split('/')
    const name = parts.pop()
    const directory = parts.join('/')
    if (!entriesByDirectory.has(directory)) entriesByDirectory.set(directory, [])
    entriesByDirectory.get(directory).push({ name, type: 'file', size: Buffer.byteLength(file.text) })
    for (let index = 0; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/')
      const child = parts[index]
      if (!entriesByDirectory.has(parent)) entriesByDirectory.set(parent, [])
      if (!entriesByDirectory.get(parent).some(entry => entry.name === child)) entriesByDirectory.get(parent).push({ name: child, type: 'directory' })
    }
  }
  const remote = {
    async list(sessionId, path, signal) {
      calls.push({ kind: 'list', sessionId, path })
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const directory = path === '.' ? '' : path
      return { path: directory, entries: entriesByDirectory.get(directory) ?? [], truncated: truncated.has(directory) }
    },
    async read(sessionId, path, range, signal) {
      calls.push({ kind: 'read', sessionId, path, offset: range.offset })
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (readOverride) return readOverride({ sessionId, path, range, calls })
      const file = files[path]
      if (!file) throw Object.assign(new Error('missing'), { code: 'not_found' })
      const allLines = file.text.split('\n')
      const offset = range.offset ?? 1
      const limit = range.limit ?? 200
      const lines = allLines.slice(offset - 1, offset - 1 + limit)
      return {
        absolutePath: `/workspace/${path}`,
        version: file.version ?? 'v1',
        bytes: Buffer.byteLength(file.text),
        offset,
        text: lines.join('\n'),
        lines: lines.length,
        eof: offset - 1 + lines.length >= allLines.length,
      }
    },
  }
  return { remote, calls }
}

test('DSH 工作区浏览仅按给定 Session 和相对目录递归读取支持的文本文件', async () => {
  const { remote, calls } = makeWorkspace({
    'project/notes/a.md': { text: 'alpha\nbeta' },
    'project/data.json': { text: '{"ok":true}' },
    'project/image.png': { text: 'binary' },
  })
  const result = await browseWorkspaceDirectory(remote, { sessionId: 'session-1', directoryPath: 'project' })
  assert.equal(result.files.length, 2)
  assert.deepEqual(result.files.map(file => file.relativePath).sort(), ['data.json', 'notes/a.md'])
  assert.ok(calls.every(call => call.sessionId === 'session-1'))
  assert.ok(calls.every(call => call.path === 'project' || call.path.startsWith('project/')))
  assert.equal(result.bytes, Buffer.byteLength('alpha\nbeta') + Buffer.byteLength('{"ok":true}'))
})

test('工作区根目录使用 DSH 的空列表路径并支持常见文本、配置和源码', async () => {
  const { remote, calls } = makeWorkspace({
    'README.md': { text: '# 项目' },
    'src/main.ts': { text: 'export const ready = true' },
    'settings.yaml': { text: 'mode: test' },
    'image.png': { text: 'binary' },
  })
  const result = await browseWorkspaceDirectory(remote, { sessionId: 'session-root', directoryPath: '.' })
  assert.deepEqual(result.files.map(file => file.relativePath), ['README.md', 'settings.yaml', 'src/main.ts'])
  assert.ok(calls.some(call => call.kind === 'list' && call.path === '.'))
  assert.ok(calls.every(call => call.path === '.' || !call.path.startsWith('../')))
})

test('DSH 工作区分页读取固定文件版本并中止版本变化', async () => {
  const text = Array.from({ length: 205 }, (_, index) => `line-${index + 1}`).join('\n')
  const { remote, calls } = makeWorkspace({ 'notes.txt': { text } })
  const result = await browseWorkspaceDirectory(remote, { sessionId: 's', directoryPath: 'docs' })
  assert.equal(result.files.length, 0)
  const fixture = makeWorkspace({ 'docs/notes.txt': { text } })
  const paged = await browseWorkspaceDirectory(fixture.remote, { sessionId: 's', directoryPath: 'docs' })
  assert.equal(paged.files[0].text, text)
  assert.deepEqual(fixture.calls.filter(call => call.kind === 'read').map(call => call.offset), [1, 201])

  const changing = makeWorkspace({ 'docs/notes.txt': { text } }, { readOverride: ({ range }) => ({
    version: range.offset === 1 ? 'v1' : 'v2', bytes: Buffer.byteLength(text), offset: range.offset,
    text: 'page', lines: 200, eof: false,
  }) })
  await assert.rejects(browseWorkspaceDirectory(changing.remote, { sessionId: 's', directoryPath: 'docs' }), { code: 'source_changed' })
  assert.ok(calls.every(call => call.sessionId === 's'))
})

test('拒绝工作区外路径、越界目录和被截断的目录列表', async () => {
  const { remote } = makeWorkspace({ 'docs/a.md': { text: 'ok' } }, { truncated: new Set(['docs']) })
  await assert.rejects(browseWorkspaceDirectory(remote, { sessionId: 's', directoryPath: '../outside' }), { code: 'invalid_directory' })
  await assert.rejects(browseWorkspaceDirectory(remote, { sessionId: 's', directoryPath: 'docs' }), { code: 'directory_listing_truncated' })
})

test('已取消的目录浏览不会继续发起远端读取', async () => {
  const controller = new AbortController()
  controller.abort()
  const { remote, calls } = makeWorkspace({ 'docs/a.md': { text: 'ok' } })
  await assert.rejects(browseWorkspaceDirectory(remote, { sessionId: 's', directoryPath: 'docs', signal: controller.signal }), { name: 'AbortError' })
  assert.deepEqual(calls, [])
})
