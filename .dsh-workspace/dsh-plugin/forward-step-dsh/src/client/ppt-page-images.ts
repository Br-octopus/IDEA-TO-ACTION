export type PptPageImages = {
  imageDataUrl?: string
  imageDataUrls?: string[]
  [field: string]: unknown
}

export function listPptPageImages(slide?: PptPageImages | null): string[] {
  return [slide?.imageDataUrl, ...(slide?.imageDataUrls ?? [])].filter((image): image is string => typeof image === 'string' && image.length > 0)
}

export function removePptPageImage<T extends PptPageImages>(slide: T, index: number): T {
  const images = listPptPageImages(slide)
  if (!Number.isSafeInteger(index) || index < 0 || index >= images.length) return slide
  images.splice(index, 1)
  const { imageDataUrl: _image, imageDataUrls: _images, ...content } = slide
  return { ...content, ...(images.length ? { imageDataUrls: images } : {}) } as T
}
