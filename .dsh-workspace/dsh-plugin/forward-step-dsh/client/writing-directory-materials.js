const purposes = new Set(['content', 'style', 'both'])
const MAX_EXCERPT_CHARACTERS = 30_000

export async function workspaceFilesToWritingMaterials(snapshot, { purpose = 'content', cryptoObject = globalThis.crypto } = {}) {
  if (!snapshot || typeof snapshot.directoryPath !== 'string' || !Array.isArray(snapshot.files) || snapshot.files.length > 100) {
    throw Object.assign(new Error('DSH 工作区目录快照格式无效'), { code: 'invalid_directory_snapshot' })
  }
  if (!purposes.has(purpose)) throw Object.assign(new Error('材料用途无效'), { code: 'invalid_material_purpose' })
  if (!cryptoObject?.subtle?.digest) throw Object.assign(new Error('当前浏览器不支持稳定材料 ID 所需的 Web Crypto'), { code: 'crypto_unavailable' })
  const namespace = `${snapshot.directoryPath.replaceAll('\\', '/')}/`
  const seenPaths = new Set()
  return Promise.all(snapshot.files.map(async file => {
    if (!file || typeof file.relativePath !== 'string' || !file.relativePath || typeof file.text !== 'string'
      || file.relativePath.startsWith('/') || file.relativePath.split('/').some(segment => !segment || segment === '.' || segment === '..') || file.relativePath.includes('\\')) {
      throw Object.assign(new Error('DSH 工作区目录快照包含无效文件路径或内容'), { code: 'invalid_directory_snapshot' })
    }
    if (seenPaths.has(file.relativePath)) throw Object.assign(new Error('DSH 工作区目录快照包含重复文件路径'), { code: 'invalid_directory_snapshot' })
    seenPaths.add(file.relativePath)
    const digest = await cryptoObject.subtle.digest('SHA-256', new TextEncoder().encode(namespace + file.relativePath))
    const stableId = `dsh-workspace-${Array.from(new Uint8Array(digest).slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('')}`
    const excerpt = file.text.slice(0, MAX_EXCERPT_CHARACTERS)
    return {
      id: stableId,
      sourceId: stableId,
      title: file.relativePath,
      kind: 'content',
      purpose,
      sourceType: 'dsh-workspace-directory',
      sourceLocator: `${snapshot.directoryPath}/${file.relativePath}`,
      excerpt,
      selected: false,
      contentStatus: 'parsed',
      verificationStatus: 'unverified',
      extractedCharacterCount: file.text.length,
      truncated: file.text.length > excerpt.length,
      extractionMethod: 'dsh-workspaceFiles',
    }
  }))
}
