const ACCEPTED_PURPOSES = new Set(['content', 'style', 'both'])
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv'])
const BINARY_MIME_TYPES = Object.freeze({
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
})
const MAX_FILES = 20
const MAX_TEXT_FILE_BYTES = 512 * 1024
const MAX_TEXT_BATCH_BYTES = 2 * 1024 * 1024
const MAX_BINARY_FILE_BYTES = 20 * 1024 * 1024
const MAX_BINARY_BATCH_BYTES = 40 * 1024 * 1024

function failure(fileName, code) {
  return { fileName, code }
}

function safeTitle(value) {
  return String(value ?? '未命名材料').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || '未命名材料'
}

function extensionOf(name) {
  const normalized = String(name ?? '').toLowerCase()
  const dot = normalized.lastIndexOf('.')
  return dot >= 0 ? normalized.slice(dot) : ''
}

export function readSelectedFileText(file, signal, Reader = globalThis.FileReader) {
  if (typeof Reader !== 'function') {
    return Promise.reject(Object.assign(new Error('当前环境不支持文件读取'), { code: 'unsupported_file_reader' }))
  }
  return new Promise((resolve, reject) => {
    const reader = new Reader()
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const abort = () => {
      try {
        if (reader.readyState === 1 || reader.readyState === undefined) reader.abort()
      } catch {}
      finish(reject, Object.assign(new Error('材料读取已取消'), { code: 'cancelled' }))
    }

    reader.onload = () => finish(resolve, typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => finish(reject, reader.error ?? new Error('文件读取失败'))
    reader.onabort = () => finish(reject, Object.assign(new Error('材料读取已取消'), { code: 'cancelled' }))
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      reader.readAsText(file, 'utf-8')
    } catch (error) {
      finish(reject, error)
    }
  })
}

function encodeBase64(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)))
  }
  if (typeof globalThis.btoa !== 'function') throw Object.assign(new Error('当前环境不支持材料上传编码'), { code: 'unsupported_encoding' })
  return globalThis.btoa(binary)
}

export function readSelectedFileBytes(file, signal, Reader = globalThis.FileReader) {
  if (typeof Reader !== 'function') {
    if (typeof file?.arrayBuffer !== 'function') return Promise.reject(Object.assign(new Error('当前环境不支持二进制文件读取'), { code: 'unsupported_file_reader' }))
    return file.arrayBuffer().then(buffer => {
      if (signal?.aborted) throw Object.assign(new Error('材料读取已取消'), { code: 'cancelled' })
      return new Uint8Array(buffer)
    })
  }
  return new Promise((resolve, reject) => {
    const reader = new Reader()
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const abort = () => {
      try { if (reader.readyState === 1 || reader.readyState === undefined) reader.abort() } catch {}
      finish(reject, Object.assign(new Error('材料读取已取消'), { code: 'cancelled' }))
    }
    reader.onload = () => {
      if (Object.prototype.toString.call(reader.result) !== '[object ArrayBuffer]') return finish(reject, Object.assign(new Error('二进制文件读取结果无效'), { code: 'read_failed' }))
      finish(resolve, new Uint8Array(reader.result))
    }
    reader.onerror = () => finish(reject, reader.error ?? new Error('二进制文件读取失败'))
    reader.onabort = () => finish(reject, Object.assign(new Error('材料读取已取消'), { code: 'cancelled' }))
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    try { reader.readAsArrayBuffer(file) } catch (error) { finish(reject, error) }
  })
}

export async function uploadAndParseSelectedFile(file, { mimeType, signal, remote, readBytes = readSelectedFileBytes }) {
  let uploadId
  let cancelling
  const cancelUpload = () => {
    if (!uploadId || cancelling) return cancelling
    cancelling = Promise.resolve(remote.cancelWritingMaterialUpload({ uploadId })).catch(() => undefined)
    return cancelling
  }
  const cancelOnAbort = () => { void cancelUpload() }
  signal?.addEventListener('abort', cancelOnAbort, { once: true })
  try {
    if (signal?.aborted) throw Object.assign(new Error('材料读取已取消'), { code: 'cancelled' })
    const bytes = await readBytes(file, signal)
    const started = unwrapRemote(await remote.beginWritingMaterialUpload({ sourceName: file.name, mimeType, size: bytes.byteLength }))
    uploadId = started.uploadId
    if (!uploadId || !Number.isSafeInteger(started.chunkBytes) || started.chunkBytes < 1 || started.chunkBytes > 48 * 1024) {
      throw Object.assign(new Error('Host 返回的材料分块配置无效'), { code: 'invalid_response' })
    }
    if (signal?.aborted) throw Object.assign(new Error('材料读取已取消'), { code: 'cancelled' })
    let index = 0
    for (let offset = 0; offset < bytes.length; offset += started.chunkBytes) {
      const dataBase64 = encodeBase64(bytes.subarray(offset, Math.min(offset + started.chunkBytes, bytes.length)))
      const acknowledgement = unwrapRemote(await remote.appendWritingMaterialChunk({ uploadId, index, dataBase64 }))
      index += 1
      if (signal?.aborted) throw Object.assign(new Error('材料读取已取消'), { code: 'cancelled' })
      if (acknowledgement.nextChunk !== index || acknowledgement.bytes !== Math.min(offset + started.chunkBytes, bytes.length)) {
        throw Object.assign(new Error('Host 材料分块确认不匹配'), { code: 'invalid_response' })
      }
    }
    const parsed = unwrapRemote(await remote.parseWritingMaterialUpload({ uploadId }, signal))
    uploadId = null
    return parsed
  } catch (error) {
    if (signal?.aborted || error?.code === 'cancelled') {
      await cancelUpload()
      throw Object.assign(new Error('材料读取已取消'), { code: 'cancelled' })
    }
    if (uploadId) await cancelUpload()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort)
  }
}

function unwrapRemote(result) {
  if (result?.ok === false) throw result.error
  return result?.ok === true && Object.hasOwn(result, 'value') ? result.value : result
}

export async function importSelectedTextMaterials(files, { purpose = 'content', readText, parseFile, signal, createId } = {}) {
  if (!ACCEPTED_PURPOSES.has(purpose) || typeof readText !== 'function' || typeof createId !== 'function') {
    throw Object.assign(new Error('材料导入参数无效'), { code: 'invalid_input' })
  }
  const selectedFiles = Array.from(files ?? [])
  const failures = []
  const materials = []
  let totalBytes = 0
  let binaryBytes = 0

  for (let index = 0; index < selectedFiles.length; index += 1) {
    if (signal?.aborted) throw Object.assign(new Error('材料导入已取消'), { code: 'cancelled' })
    const file = selectedFiles[index]
    const fileName = safeTitle(file?.name)
    if (index >= MAX_FILES) {
      failures.push(failure(fileName, 'file_count_limit'))
      continue
    }
    const extension = extensionOf(fileName)
    if (!file || (!TEXT_EXTENSIONS.has(extension) && !BINARY_MIME_TYPES[extension])) {
      failures.push(failure(fileName, 'unsupported_file_type'))
      continue
    }
    const isText = TEXT_EXTENSIONS.has(extension)
    const maxFileBytes = isText ? MAX_TEXT_FILE_BYTES : MAX_BINARY_FILE_BYTES
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > maxFileBytes) {
      failures.push(failure(fileName, 'file_size_limit'))
      continue
    }
    if (isText && totalBytes + file.size > MAX_TEXT_BATCH_BYTES) {
      failures.push(failure(fileName, 'batch_size_limit'))
      continue
    }
    if (!isText && binaryBytes + file.size > MAX_BINARY_BATCH_BYTES) {
      failures.push(failure(fileName, 'batch_size_limit'))
      continue
    }
    if (isText) totalBytes += file.size
    else binaryBytes += file.size

    if (!isText) {
      const id = createId()
      const mimeType = BINARY_MIME_TYPES[extension]
      let parsed
      let errorCode = 'parser_unavailable'
      try {
        if (typeof parseFile === 'function') {
          parsed = await parseFile(file, { mimeType, signal })
          if (signal?.aborted) throw Object.assign(new Error('材料读取已取消'), { code: 'cancelled' })
          if (!parsed?.ok) errorCode = parsed?.error?.code || 'read_failed'
        }
      } catch (error) {
        if (signal?.aborted || error?.code === 'cancelled') {
          throw Object.assign(new Error('材料导入已取消'), { code: 'cancelled' })
        }
        errorCode = error?.code || 'read_failed'
      }
      const excerpt = parsed?.ok && typeof parsed.text === 'string' ? parsed.text.slice(0, 30_000) : ''
      const successful = Boolean(parsed?.ok && excerpt.trim())
      const truncated = Boolean(parsed?.truncated || (typeof parsed?.text === 'string' && parsed.text.length > excerpt.length))
      const page = parsed?.pages?.find(item => Number.isInteger(item?.page) && item.page > 0)?.page
      materials.push({
        id, sourceId: id, kind: 'user-selected-parsed-file', sourceType: parsed?.format || (extension === '.docx' ? 'docx' : extension === '.pdf' ? 'pdf' : 'image'),
        title: fileName, purpose, excerpt: successful ? excerpt : '', selected: false, verificationStatus: 'unverified',
        contentStatus: successful ? 'parsed' : 'failed',
        ...(successful ? {
          extractedCharacterCount: Number.isSafeInteger(parsed.characterCount) ? parsed.characterCount : excerpt.length,
          pageCount: Number.isSafeInteger(parsed.pageCount) ? parsed.pageCount : 0,
          ...(page ? { sourceLocator: `page/${page}` } : {}),
          extractionMethod: parsed.pages?.[0]?.method || ({ docx: 'docx-text', image: 'image-ocr' }[parsed.format] ?? parsed.format),
          ...(Number.isFinite(parsed.confidence) ? { recognitionConfidence: parsed.confidence } : {}),
          ...(truncated ? { truncated: true } : {}),
          ...(Array.isArray(parsed.warnings) && parsed.warnings.length ? { extractionWarnings: parsed.warnings.slice(0, 5) } : {}),
        } : { contentError: errorCode }),
      })
      if (!successful) failures.push(failure(fileName, errorCode))
      continue
    }

    try {
      const excerpt = await readText(file, signal)
      if (signal?.aborted) throw Object.assign(new Error('材料导入已取消'), { code: 'cancelled' })
      if (typeof excerpt !== 'string' || !excerpt.trim()) {
        failures.push(failure(fileName, 'empty_or_invalid_text'))
        continue
      }
      const byteLength = new TextEncoder().encode(excerpt).byteLength
      if (byteLength > MAX_TEXT_FILE_BYTES) {
        failures.push(failure(fileName, 'file_size_limit'))
        continue
      }
      const id = createId()
      materials.push({
        id,
        sourceId: id,
        kind: 'user-selected-text-file',
        title: fileName,
        purpose,
        excerpt: excerpt.replace(/^\uFEFF/, ''),
        selected: false,
        verificationStatus: 'unverified',
      })
    } catch (error) {
      if (signal?.aborted || error?.code === 'cancelled') {
        throw Object.assign(new Error('材料导入已取消'), { code: 'cancelled' })
      }
      failures.push(failure(fileName, 'read_failed'))
    }
  }

  return { materials, failures, totalBytes }
}
