const MAX_SLIDES = 100
const MAX_TEXT_LENGTH = 200000
const MAX_IMAGE_BYTES_PER_SLIDE = 3 * 1024 * 1024
const MAX_IMAGE_BYTES_TOTAL = 20 * 1024 * 1024

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function normalizeSlideStyle(style, index) {
  if (style == null) return { title: {}, body: {} }
  if (typeof style !== 'object' || Array.isArray(style)) throw Object.assign(new Error('页面样式必须是对象'), { code: 'invalid_input' })
  const color = (value, field) => {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string' || !/^[0-9a-f]{6}$/iu.test(value)) throw Object.assign(new Error(`第 ${index + 1} 页${field}颜色无效`), { code: 'invalid_input' })
    return value.toUpperCase()
  }
  const textStyle = (value, field) => {
    if (value === undefined || value === null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error(`第 ${index + 1} 页${field}样式无效`), { code: 'invalid_input' })
    const result = {}
    const textColor = color(value.color, field)
    if (textColor) result.color = textColor
    if (value.fontSize !== undefined) {
      if (!Number.isSafeInteger(value.fontSize) || value.fontSize < 600 || value.fontSize > 7200) throw Object.assign(new Error(`第 ${index + 1} 页${field}字号无效`), { code: 'invalid_input' })
      result.fontSize = value.fontSize
    }
    if (value.align !== undefined) {
      if (!['left', 'center', 'right', 'justify'].includes(value.align)) throw Object.assign(new Error(`第 ${index + 1} 页${field}对齐方式无效`), { code: 'invalid_input' })
      result.align = value.align
    }
    for (const property of ['bold', 'italic']) {
      if (value[property] !== undefined && typeof value[property] !== 'boolean') throw Object.assign(new Error(`第 ${index + 1} 页${field}样式无效`), { code: 'invalid_input' })
      if (value[property]) result[property] = true
    }
    return result
  }
  return { backgroundColor: color(style.backgroundColor, '背景'), title: textStyle(style.title, '标题'), body: textStyle(style.body, '正文') }
}

function htmlTextStyle(style) {
  return [style.color && `color:#${style.color}`, style.fontSize && `font-size:${style.fontSize / 100}pt`, style.bold && 'font-weight:bold', style.italic && 'font-style:italic', style.align && `text-align:${style.align}`].filter(Boolean).join(';')
}

function normalizeParagraphs(slide) {
  const body = slide?.body ?? slide?.content ?? ''
  return (Array.isArray(body) ? body : [body])
    .map(item => String(item ?? '').trim())
    .filter(Boolean)
}

function normalizeChart(chart, index) {
  if (chart == null) return undefined
  if (!chart || typeof chart !== 'object' || !Array.isArray(chart.categories)) {
    throw Object.assign(new Error(`第 ${index + 1} 页图表数据无效`), { code: 'invalid_input' })
  }
  const categories = chart.categories.map(value => String(value ?? '').trim())
  const sourceSeries = Array.isArray(chart.series)
    ? chart.series
    : Array.isArray(chart.values) ? [{ name: '数值', values: chart.values }] : []
  if (!categories.length || categories.length > 8 || sourceSeries.length < 1 || sourceSeries.length > 4
    || categories.some(value => !value || value.length > 40)) {
    throw Object.assign(new Error(`第 ${index + 1} 页图表需要 1 至 8 个类别和 1 至 4 个系列`), { code: 'invalid_input' })
  }
  const names = new Set()
  const series = sourceSeries.map((item, seriesIndex) => {
    const name = String(item?.name ?? `系列 ${seriesIndex + 1}`).trim()
    if (!name || name.length > 40 || names.has(name) || !Array.isArray(item?.values) || item.values.length !== categories.length) {
      throw Object.assign(new Error(`第 ${index + 1} 页图表系列无效`), { code: 'invalid_input' })
    }
    names.add(name)
    const values = item.values.map(Number)
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1_000_000_000)) {
      throw Object.assign(new Error(`第 ${index + 1} 页图表包含无效数值`), { code: 'invalid_input' })
    }
    return { name, values }
  })
  return { title: String(chart.title ?? '数据图表').trim().slice(0, 80) || '数据图表', categories, series }
}

function normalizeImage(dataUrl, index) {
  if (dataUrl == null || dataUrl === '') return undefined
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_IMAGE_BYTES_PER_SLIDE / 3) * 4 + 64) {
    throw Object.assign(new Error(`第 ${index + 1} 页图片超过 3 MiB 上限`), { code: 'budget_exceeded' })
  }
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl)
  if (!match) throw Object.assign(new Error(`第 ${index + 1} 页配图必须为 PNG 或 JPEG 数据`), { code: 'invalid_input' })
  let bytes
  try { bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0)) }
  catch { throw Object.assign(new Error(`第 ${index + 1} 页图片编码无效`), { code: 'invalid_input' }) }
  const validPng = match[1] === 'png' && [137, 80, 78, 71, 13, 10, 26, 10].every((value, byteIndex) => bytes[byteIndex] === value)
  const validJpeg = match[1] === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES_PER_SLIDE) throw Object.assign(new Error(`第 ${index + 1} 页图片超过 3 MiB 上限`), { code: 'budget_exceeded' })
  if (!validPng && !validJpeg) throw Object.assign(new Error(`第 ${index + 1} 页图片内容与 MIME 类型不符`), { code: 'invalid_input' })
  return { dataUrl, byteLength: bytes.length }
}

function chartMarkup(chart) {
  if (!chart) return ''
  const width = 960
  const top = 40
  const plotHeight = 350
  const baseline = top + plotHeight
  const left = 55
  const plotWidth = 850
  const maxValue = Math.max(1, ...chart.series.flatMap(series => series.values))
  const colors = ['#4472c4', '#ed7d31', '#70ad47', '#a5a5a5']
  const slotWidth = plotWidth / chart.categories.length
  const groupWidth = Math.min(slotWidth * 0.72, 180)
  const barWidth = groupWidth / chart.series.length
  const grid = [0, 0.25, 0.5, 0.75, 1].map(fraction => {
    const y = baseline - fraction * plotHeight
    return `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}" stroke="#d8dee5"/><text x="${left - 10}" y="${y + 5}" text-anchor="end" class="axis-label">${Math.round(maxValue * fraction)}</text>`
  }).join('')
  const bars = chart.categories.map((category, categoryIndex) => {
    const groupStart = left + slotWidth * categoryIndex + (slotWidth - groupWidth) / 2
    const categoryBars = chart.series.map((series, seriesIndex) => {
      const value = series.values[categoryIndex]
      const height = Math.max(1, value / maxValue * plotHeight)
      const x = groupStart + barWidth * seriesIndex
      const y = baseline - height
      return `<g><rect x="${x}" y="${y}" width="${Math.max(1, barWidth - 3)}" height="${height}" rx="2" fill="${colors[seriesIndex]}"/><text x="${x + (barWidth - 3) / 2}" y="${Math.max(top + 14, y - 7)}" text-anchor="middle" class="value-label">${value}</text></g>`
    }).join('')
    return `${categoryBars}<text x="${left + slotWidth * categoryIndex + slotWidth / 2}" y="${baseline + 24}" text-anchor="middle" class="axis-label">${escapeHtml(category)}</text>`
  }).join('')
  const legend = chart.series.map((series, index) => `<span class="legend-item"><i style="background:${colors[index]}"></i>${escapeHtml(series.name)}</span>`).join('')
  const accessibleTable = `<table class="sr-only"><caption>${escapeHtml(chart.title)} 数据表</caption><thead><tr><th scope="col">类别</th>${chart.series.map(series => `<th scope="col">${escapeHtml(series.name)}</th>`).join('')}</tr></thead><tbody>${chart.categories.map((category, categoryIndex) => `<tr><th scope="row">${escapeHtml(category)}</th>${chart.series.map(series => `<td>${series.values[categoryIndex]}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  return `<figure class="chart"><figcaption>${escapeHtml(chart.title)}</figcaption><svg viewBox="0 0 ${width} 460" role="img" aria-label="${escapeHtml(chart.title)}">${grid}${bars}</svg><div class="legend" aria-label="图例">${legend}</div>${accessibleTable}</figure>`
}

export function buildPptHtmlPresentation({ title, slides } = {}) {
  if (!Array.isArray(slides) || slides.length === 0 || slides.length > MAX_SLIDES) {
    throw Object.assign(new Error('HTML 演示需要 1 至 100 页逐页规划'), { code: 'invalid_input' })
  }

  let imageBytesTotal = 0
  const normalizedSlides = slides.map((slide, index) => {
    const heading = String(slide?.title ?? '').trim()
    const paragraphs = normalizeParagraphs(slide)
    const image = normalizeImage(slide?.imageDataUrl, index)
    const chart = normalizeChart(slide?.chart, index)
    const style = normalizeSlideStyle(slide?.style, index)
    imageBytesTotal += image?.byteLength ?? 0
    if (imageBytesTotal > MAX_IMAGE_BYTES_TOTAL) throw Object.assign(new Error('HTML 演示图片总量超过 20 MiB 上限'), { code: 'budget_exceeded' })
    if (!heading && paragraphs.length === 0 && !image && !chart) {
      throw Object.assign(new Error(`第 ${index + 1} 页没有标题、内容或视觉元素`), { code: 'invalid_input' })
    }
    return { heading: heading || `第 ${index + 1} 页`, paragraphs, image, chart, style }
  })
  const textLength = normalizedSlides.reduce((total, slide) => total + slide.heading.length + slide.paragraphs.join('').length
    + (slide.chart?.title.length ?? 0) + (slide.chart?.categories.join('').length ?? 0)
    + (slide.chart?.series.reduce((sum, series) => sum + series.name.length + series.values.join('').length, 0) ?? 0), 0)
  if (textLength > MAX_TEXT_LENGTH) throw Object.assign(new Error('HTML 演示内容超过 200,000 字符上限'), { code: 'budget_exceeded' })

  const safeTitle = escapeHtml(String(title ?? '').trim() || normalizedSlides[0].heading)
  const pageMarkup = normalizedSlides.map((slide, index) => `
    <section class="slide" id="slide-${index + 1}" aria-label="第 ${index + 1} 页，共 ${normalizedSlides.length} 页"${slide.style.backgroundColor ? ` style="background-color:#${slide.style.backgroundColor}"` : ''}>
      <header><span>${String(index + 1).padStart(2, '0')} / ${String(normalizedSlides.length).padStart(2, '0')}</span><span>${safeTitle}</span></header>
      <main><h1${htmlTextStyle(slide.style.title) ? ` style="${htmlTextStyle(slide.style.title)}"` : ''}>${escapeHtml(slide.heading)}</h1><div class="slide-content">${slide.paragraphs.map(paragraph => `<p${htmlTextStyle(slide.style.body) ? ` style="${htmlTextStyle(slide.style.body)}"` : ''}>${escapeHtml(paragraph)}</p>`).join('')}${slide.image ? `<img class="slide-image" src="${slide.image.dataUrl}" alt="第 ${index + 1} 页用户配图">` : ''}${chartMarkup(slide.chart)}</div></main>
      <footer>${index > 0 ? `<a href="#slide-${index}">上一页</a>` : '<span></span>'}<a href="#slide-${index + 2}" ${index + 1 === normalizedSlides.length ? 'hidden' : ''}>下一页</a></footer>
    </section>`).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="向前一步 PPT HTML 导出">
<title>${safeTitle}</title>
<style>
:root{color-scheme:light;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#17212b;background:#e9edf0}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-snap-type:y mandatory}.slide{width:min(100vw,calc(100vh * 16 / 9));min-height:min(100vh,calc(100vw * 9 / 16));aspect-ratio:16/9;margin:0 auto 1rem;padding:4.5% 6%;display:flex;flex-direction:column;justify-content:space-between;background:#fff;scroll-snap-align:start;overflow:hidden;box-shadow:0 8px 32px #17212b22}header,footer{display:flex;justify-content:space-between;gap:1rem;color:#586775;font-size:clamp(.75rem,1.2vw,1rem)}main{width:100%;max-height:78%;overflow:auto}.slide-content{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));align-items:center;gap:1.5rem}h1{font-size:clamp(2rem,5vw,4.6rem);line-height:1.12;margin:0 0 .5em;overflow-wrap:anywhere}p{font-size:clamp(1rem,2vw,1.8rem);line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.slide-image{display:block;max-width:100%;max-height:52vh;object-fit:contain;margin:auto}.chart{min-width:0;margin:0;padding:1rem;border:1px solid #d8dee5;border-radius:.5rem;background:#fff}.chart figcaption{font-size:1.2rem;font-weight:700;margin-bottom:.4rem}.chart svg{display:block;width:100%;max-height:48vh}.axis-label{font:14px system-ui,"Microsoft YaHei",sans-serif;fill:#586775}.value-label{font:12px system-ui,"Microsoft YaHei",sans-serif;fill:#17212b}.legend{display:flex;justify-content:center;gap:1rem;flex-wrap:wrap}.legend-item{display:inline-flex;align-items:center;gap:.35rem}.legend-item i{width:.75rem;height:.75rem;border-radius:2px}.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}a{color:#155eef;text-decoration:none}a:hover{text-decoration:underline}@media(max-aspect-ratio:4/5){.slide{width:100vw;min-height:100svh;aspect-ratio:auto;margin:0;padding:8vw 7vw}.slide-content{grid-template-columns:1fr}main{max-height:82%}}@media print{@page{size:13.333in 7.5in;margin:0}html{scroll-snap-type:none}.slide{width:13.333in;height:7.5in;min-height:0;aspect-ratio:auto;margin:0;box-shadow:none;break-after:page;page-break-after:always}.slide:last-child{break-after:auto;page-break-after:auto}footer a{color:#17212b}}
</style>
</head>
<body>
${pageMarkup}
</body>
</html>
`
}

export function downloadPptHtmlPresentation({ title, slides }, documentObject = globalThis.document, urlApi = globalThis.URL) {
  if (!documentObject?.createElement || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL) {
    throw Object.assign(new Error('当前环境不支持下载 HTML 文件'), { code: 'download_unavailable' })
  }
  const html = buildPptHtmlPresentation({ title, slides })
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = urlApi.createObjectURL(blob)
  const link = documentObject.createElement('a')
  const filename = String(title ?? 'presentation').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-').slice(0, 80) || 'presentation'
  link.href = url
  link.download = `${filename}.html`
  link.hidden = true
  documentObject.body.append(link)
  try { link.click() } finally {
    link.remove()
    setTimeout(() => urlApi.revokeObjectURL(url), 0)
  }
  return { filename: link.download, byteLength: new TextEncoder().encode(html).byteLength, slideCount: slides.length }
}
