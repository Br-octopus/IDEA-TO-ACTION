export type PptxImageOcrResult = {
  slides: Array<{ content?: string; imageDataUrl?: string; imageDataUrls?: string[]; [field: string]: unknown }>
  recognizedImages: number
  failedImages: number
  truncatedImages: number
  lowConfidenceImages: number
  limitations: string[]
}

const MAX_OCR_CHARS_PER_SLIDE = 3000

export async function addPptxImageOcr(
  slides: PptxImageOcrResult['slides'],
  { parseImage, signal, onProgress, FileClass = globalThis.File }: {
    parseImage: (file: File, options: { mimeType: string; signal?: AbortSignal }) => Promise<{ text?: string; confidence?: number }>
    signal?: AbortSignal
    onProgress?: (progress: { completedImages: number; totalImages: number; pageNumber: number }) => void
    FileClass?: typeof File
  },
): Promise<PptxImageOcrResult> {
  const limitations: string[] = []
  let recognizedImages = 0
  let failedImages = 0
  let truncatedImages = 0
  let lowConfidenceImages = 0
  const updatedSlides = []
  const totalImages = slides.reduce((total, slide) => total + [slide.imageDataUrl, ...(slide.imageDataUrls ?? [])].filter(image => typeof image === 'string' && image.length > 0).length, 0)
  let completedImages = 0

  for (let pageIndex = 0; pageIndex < slides.length; pageIndex += 1) {
    const slide = slides[pageIndex]
    const images = [slide.imageDataUrl, ...(slide.imageDataUrls ?? [])].filter((image): image is string => typeof image === 'string' && image.length > 0)
    const texts: string[] = []
    let remainingChars = MAX_OCR_CHARS_PER_SLIDE

    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      if (signal?.aborted) throw Object.assign(new Error('PPTX 图像 OCR 已取消'), { code: 'cancelled' })
      const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(images[imageIndex])
      if (!match) {
        failedImages += 1
        completedImages += 1
        onProgress?.({ completedImages, totalImages, pageNumber: pageIndex + 1 })
        continue
      }
      try {
        const binary = atob(match[2])
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        const extension = match[1] === 'image/png' ? 'png' : 'jpg'
        const file = new FileClass([bytes], `pptx-page-${pageIndex + 1}-image-${imageIndex + 1}.${extension}`, { type: match[1] })
        const parsed = await parseImage(file, { mimeType: match[1], signal })
        if (signal?.aborted) throw Object.assign(new Error('PPTX 图像 OCR 已取消'), { code: 'cancelled' })
        const text = typeof parsed?.text === 'string' ? parsed.text.trim() : ''
        if (!text) { failedImages += 1; continue }
        recognizedImages += 1
        const excerpt = text.slice(0, remainingChars)
        const confidence = Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(100, parsed.confidence)) : null
        const confidenceNote = confidence === null ? '' : confidence < 70 ? `（OCR 置信度 ${Math.round(confidence)}/100，建议重点校对）` : `（OCR 置信度 ${Math.round(confidence)}/100，仍需校对）`
        if (confidence !== null && confidence < 70) lowConfidenceImages += 1
        if (remainingChars <= 0) { truncatedImages += 1; continue }
        texts.push(`图片 ${imageIndex + 1}${confidenceNote}：${excerpt}`)
        remainingChars -= excerpt.length
        if (excerpt.length < text.length) { truncatedImages += 1; remainingChars = 0 }
      } catch (error) {
        if (signal?.aborted || (error as any)?.code === 'cancelled') throw Object.assign(new Error('PPTX 图像 OCR 已取消'), { code: 'cancelled' })
        failedImages += 1
      } finally {
        completedImages += 1
        onProgress?.({ completedImages, totalImages, pageNumber: pageIndex + 1 })
      }
    }

    updatedSlides.push(texts.length
      ? { ...slide, content: [slide.content?.trim(), `内嵌图片 OCR（待人工校对）：\n${texts.join('\n')}`].filter(Boolean).join('\n\n') }
      : slide)
  }

  if (failedImages) limitations.push(`${failedImages} 张内嵌图片未能提取文字；图片仍保留，可手工核对。`)
  if (truncatedImages) limitations.push(`${truncatedImages} 张图片的 OCR 摘录达到每页 3,000 字符上限。`)
  if (lowConfidenceImages) limitations.push(`${lowConfidenceImages} 张图片 OCR 置信度低于 70/100，请优先人工校对。`)
  return { slides: updatedSlides, recognizedImages, failedImages, truncatedImages, lowConfidenceImages, limitations }
}
