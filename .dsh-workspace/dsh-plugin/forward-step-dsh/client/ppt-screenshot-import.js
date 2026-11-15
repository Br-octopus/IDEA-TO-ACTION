const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const MAX_BATCH_FILES = 50
const MAX_BATCH_BYTES = 20 * 1024 * 1024
const MAX_OCR_CHARS_PER_SLIDE = 3000

export function hasExpectedImageSignature(dataUrl, mimeType) {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1)
  let bytes
  try { bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0)) } catch { return false }
  if (mimeType === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  return mimeType === 'image/jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}
function readDataUrl(file, Reader, signal) {
  return new Promise((resolve, reject) => {
    const reader = new Reader()
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      callback(value)
    }
    const cancelError = () => Object.assign(new Error('截图读取已取消'), { code: 'cancelled' })
    const abort = () => {
      try { reader.abort() } finally { finish(reject, cancelError()) }
    }
    reader.onerror = () => finish(reject, reader.error ?? new Error('截图读取失败'))
    reader.onabort = () => finish(reject, cancelError())
    reader.onload = () => typeof reader.result === 'string' ? finish(resolve, reader.result) : finish(reject, new Error('截图数据格式无效'))
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try { reader.readAsDataURL(file) } catch (error) { finish(reject, error) }
  })
}
export async function importPptScreenshots(files, { parseImage, signal, onProgress, Reader = globalThis.FileReader } = {}) {
  const selected = Array.from(files ?? [])
  if (!selected.length || selected.length > MAX_BATCH_FILES
    || selected.some(file => !['image/png', 'image/jpeg'].includes(file.type) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES)
    || selected.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) {
    throw Object.assign(new Error('截图仅支持 PNG/JPEG；每张 3 MiB 以内、每批最多 50 张且总计不超过 20 MiB。'), { code: 'invalid_input' })
  }
  if (typeof Reader !== 'function') throw Object.assign(new Error('当前环境不支持截图读取'), { code: 'unsupported_file_reader' })

  const slides = []
  const limitations = ['OCR 文字只作识别草稿，请逐页校对；将提示词交给外部 AI 时仍需同时附上对应原图。']
  let ocrFailures = 0
  let lowConfidenceImages = 0
  for (const [index, file] of selected.entries()) {
    if (signal?.aborted) throw Object.assign(new Error('截图导入已取消'), { code: 'cancelled' })
    const imageDataUrl = await readDataUrl(file, Reader, signal)
    if (!hasExpectedImageSignature(imageDataUrl, file.type)) throw Object.assign(new Error(`${file.name} 的文件内容与声明的 PNG/JPEG 格式不符`), { code: 'invalid_input' })
    let content = ''
    try {
      const parsed = await parseImage?.(file, { mimeType: file.type, signal })
      if (signal?.aborted) throw Object.assign(new Error('截图导入已取消'), { code: 'cancelled' })
      if (parsed?.ok && typeof parsed.text === 'string' && parsed.text.trim()) {
        const confidence = Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(100, parsed.confidence)) : null
        const confidenceNote = confidence === null ? '' : confidence < 70 ? `；置信度 ${Math.round(confidence)}/100，建议重点校对` : `；置信度 ${Math.round(confidence)}/100，仍需校对`
        if (confidence !== null && confidence < 70) lowConfidenceImages += 1
        const recognizedText = parsed.text.trim()
        content = `OCR 识别文字（待人工校对${confidenceNote}）：\n${recognizedText.slice(0, MAX_OCR_CHARS_PER_SLIDE)}${recognizedText.length > MAX_OCR_CHARS_PER_SLIDE ? '\n（识别文字已截断至每页 3,000 字符）' : ''}`
      } else ocrFailures += 1
    } catch (error) {
      if (signal?.aborted || error?.code === 'cancelled') throw Object.assign(new Error('截图导入已取消'), { code: 'cancelled' })
      ocrFailures += 1
    }
    const title = file.name.replace(/\.(png|jpe?g)$/iu, '').slice(0, 200) || '截图页面'
    slides.push({ title, content, imageDataUrl, sourceImageName: file.name.replace(/[\r\n\t]/gu, ' ').slice(0, 240) })
    onProgress?.({ completedImages: index + 1, totalImages: selected.length, pageNumber: index + 1 })
  }
  if (ocrFailures) limitations.push(`${ocrFailures} 张截图未能提取文字；原图仍保留，可继续手动标注。`)
  if (lowConfidenceImages) limitations.push(`${lowConfidenceImages} 张截图 OCR 置信度低于 70/100，请优先人工校对。`)
  return { slides, title: slides.length === 1 ? slides[0].title : `截图导入（${slides.length} 页）`, limitations }
}
