
const MAX_FILES = 100
const MAX_FILE_BYTES = 512 * 1024
const MAX_BATCH_BYTES = 8 * 1024 * 1024
const MAX_EXCERPT_CHARS = 1200
const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rst', '.adoc', '.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.log',
  '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.ini', '.cfg', '.conf', '.properties',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.css', '.scss', '.less',
  '.py', '.pyi', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.php', '.swift', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.graphql',
  '.gql', '.proto',
])

export async function prepareSelectedKnowledgeFiles(files) {
  const selected = Array.from(files ?? [])
  const entries = []
  const failures = []
  if (selected.length > MAX_FILES) {
    for (const file of selected.slice(MAX_FILES)) failures.push({ fileName: file.name || '未知文件', code: 'file_count_limit' })
  }
  let totalBytes = 0
  const seenPaths = new Set()
  for (const file of selected.slice(0, MAX_FILES)) {
    const relativePath = String(file.webkitRelativePath || file.name || '').replaceAll('\\', '/')
    const segments = relativePath.split('/')
    const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase()
    if (!relativePath || relativePath.length > 320 || segments.some(part => !part || part === '.' || part === '..') || !ALLOWED_EXTENSIONS.has(extension)) {
      failures.push({ fileName: file.name || '未知文件', code: 'unsupported_file' })
      continue
    }
    if (seenPaths.has(relativePath)) {
      failures.push({ fileName: file.name, code: 'duplicate_path' })
      continue
    }
    seenPaths.add(relativePath)
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES || totalBytes + file.size > MAX_BATCH_BYTES) {
      failures.push({ fileName: file.name, code: file.size > MAX_FILE_BYTES ? 'file_size_limit' : 'batch_size_limit' })
      continue
    }
    totalBytes += file.size
    try {
      const text = (await file.text()).replaceAll('\0', '').trim()
      if (!text) {
        failures.push({ fileName: file.name, code: 'empty_file' })
        continue
      }
      const title = relativePath.slice(relativePath.lastIndexOf('/') + 1)
      entries.push({
        id: `local-file:${encodeURIComponent(relativePath)}`,
        type: 'manual-note',
        title,
        sourceType: '用户明确选择的本地目录文件',
        sourceKind: 'reference',
        sourceId: `local-folder:${relativePath}`,
        verificationStatus: 'unverified',
        summary: text.slice(0, 400),
        contentExcerpt: text.slice(0, MAX_EXCERPT_CHARS),
        limitations: '本地文件索引快照；按不可信资料处理，更新文件后需重新选择目录刷新。',
        keywords: [title, relativePath],
      })
    } catch {
      failures.push({ fileName: file.name, code: 'read_failed' })
    }
  }
  return { entries, failures, totalBytes }
}

