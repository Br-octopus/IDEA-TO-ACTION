const MAX_FILES = 100
const MAX_DIRECTORIES = 100
const MAX_DEPTH = 4
const MAX_FILE_BYTES = 512 * 1024
const MAX_BATCH_BYTES = 8 * 1024 * 1024
const PAGE_LINES = 200
const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rst', '.adoc', '.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.log',
  '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.ini', '.cfg', '.conf', '.properties',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.css', '.scss', '.less',
  '.py', '.pyi', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.php', '.swift', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.graphql',
  '.gql', '.proto',
])

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

export function normalizeWorkspaceDirectoryPath(value) {
  if (typeof value !== 'string') fail('invalid_directory', '目录路径必须是相对路径')
  const path = value.trim().replaceAll('\\', '/').replace(/\/+$/u, '')
  if (path === '.') return path
  if (!path || path.length > 320 || path.startsWith('/') || /^[a-z]:/iu.test(path) || path.includes('\0')) {
    fail('invalid_directory', '请输入当前 DSH 工作区内的相对目录路径')
  }
  const segments = path.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    fail('invalid_directory', '目录路径不能包含空路径段、当前目录或上级目录')
  }
  return segments.join('/')
}

function relativeFilePath(root, path) {
  if (root !== '.' && !path.startsWith(`${root}/`)) fail('directory_escape', 'Host 返回的文件路径超出所选目录')
  const relative = root === '.' ? path : path.slice(root.length + 1)
  const segments = relative.split('/')
  if (!relative || relative.length > 320 || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    fail('invalid_file_path', 'Host 返回了无效文件路径')
  }
  return relative
}

function joinWorkspacePath(directory, name) {
  return directory === '.' ? name : `${directory}/${name}`
}

function extensionOf(path) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('操作已取消', 'AbortError')
}

async function readWorkspaceTextFile(remote, sessionId, path, signal) {
  const pages = []
  let offset = 1
  let version
  let totalBytes = 0
  let declaredBytes
  for (;;) {
    assertNotAborted(signal)
    const page = await remote.read(sessionId, path, { offset, limit: PAGE_LINES }, signal)
    if (!page || !Number.isSafeInteger(page.offset) || page.offset !== offset || !Number.isSafeInteger(page.lines) || page.lines < 0 || typeof page.text !== 'string' || typeof page.eof !== 'boolean' || typeof page.version !== 'string') {
      fail('invalid_file_response', 'DSH 返回的文件页格式无效')
    }
    if (version === undefined) {
      version = page.version
      declaredBytes = page.bytes
      if (Number.isSafeInteger(declaredBytes) && declaredBytes > MAX_FILE_BYTES) fail('file_size_limit', `文件超过 ${MAX_FILE_BYTES} 字节限制：${path}`)
    } else if (version !== page.version) {
      fail('source_changed', `读取期间文件已变化：${path}`)
    }
    const pageBytes = new TextEncoder().encode(page.text).byteLength
    totalBytes += pageBytes + (pages.length > 0 && page.lines > 0 ? 1 : 0)
    if (totalBytes > MAX_FILE_BYTES) fail('file_size_limit', `文件超过 ${MAX_FILE_BYTES} 字节限制：${path}`)
    if (page.lines === 0 && !page.eof) fail('invalid_file_response', `文件分页未前进：${path}`)
    pages.push(page.text)
    if (page.eof) break
    offset += page.lines
  }
  const text = pages.join('\n').trim()
  const bytes = new TextEncoder().encode(text).byteLength
  if (!text || !bytes) fail('empty_file', `文件为空：${path}`)
  if (bytes > MAX_FILE_BYTES) fail('file_size_limit', `文件超过 ${MAX_FILE_BYTES} 字节限制：${path}`)
  if (Number.isSafeInteger(declaredBytes) && declaredBytes > MAX_FILE_BYTES) fail('file_size_limit', `文件超过 ${MAX_FILE_BYTES} 字节限制：${path}`)
  return { text, bytes }
}

/** Read a user-selected directory through the current DSH Session's read-only workspaceFiles Remote. */
export async function browseWorkspaceDirectory(remote, { sessionId, directoryPath, signal } = {}) {
  if (!remote || typeof remote.list !== 'function' || typeof remote.read !== 'function') fail('workspace_files_unavailable', '当前 DSH Host 未提供 workspaceFiles 目录读取能力')
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200) fail('invalid_session', '请先提供有效的当前 DSH Session 标识')
  const root = normalizeWorkspaceDirectoryPath(directoryPath)
  const directories = [{ path: root, depth: 0 }]
  const visitedDirectories = new Set()
  const candidates = []
  while (directories.length) {
    assertNotAborted(signal)
    const current = directories.shift()
    if (visitedDirectories.has(current.path)) continue
    visitedDirectories.add(current.path)
    if (visitedDirectories.size > MAX_DIRECTORIES) fail('directory_count_limit', `所选目录超过 ${MAX_DIRECTORIES} 个子目录限制，请选择更小范围`)
    const listing = await remote.list(sessionId, current.path, signal)
    assertNotAborted(signal)
    const listedPath = listing?.path === '' && current.path === '.' ? '.' : listing?.path
    if (!listing || listedPath !== current.path || !Array.isArray(listing.entries)) fail('invalid_directory_response', 'DSH 返回的目录列表格式无效')
    if (listing.truncated) fail('directory_listing_truncated', `目录条目过多，无法完整索引：${current.path}`)
    for (const entry of listing.entries) {
      if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name.includes('/') || entry.name.includes('\\') || entry.name === '.' || entry.name === '..') {
        fail('invalid_directory_response', 'DSH 返回了无效目录项')
      }
      const path = joinWorkspacePath(current.path, entry.name)
      if (entry.type === 'directory') {
        if (current.depth >= MAX_DEPTH) fail('directory_depth_limit', `子目录深度超过 ${MAX_DEPTH} 层：${path}`)
        directories.push({ path, depth: current.depth + 1 })
      } else if (entry.type === 'file' && ALLOWED_EXTENSIONS.has(extensionOf(path))) {
        if (candidates.length >= MAX_FILES) fail('file_count_limit', `所选目录超过 ${MAX_FILES} 个文本文件限制`)
        if (Number.isSafeInteger(entry.size) && entry.size > MAX_FILE_BYTES) fail('file_size_limit', `文件超过 ${MAX_FILE_BYTES} 字节限制：${path}`)
        candidates.push(path)
      }
    }
  }
  const files = []
  let totalBytes = 0
  for (const path of candidates.sort()) {
    assertNotAborted(signal)
    const relativePath = relativeFilePath(root, path)
    const file = await readWorkspaceTextFile(remote, sessionId, path, signal)
    totalBytes += file.bytes
    if (totalBytes > MAX_BATCH_BYTES) fail('batch_size_limit', `目录文本总量超过 ${MAX_BATCH_BYTES} 字节限制`)
    files.push({ relativePath, text: file.text })
  }
  return { directoryPath: root, files, bytes: totalBytes, directories: visitedDirectories.size }
}
