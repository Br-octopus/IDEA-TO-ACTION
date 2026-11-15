const MAX_FILE_BYTES = 128 * 1024 * 1024
const MAX_ENTRIES = 5_000
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
const MAX_SLIDES = 100
const MAX_SLIDE_XML_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const MAX_IMAGES_BYTES_TOTAL = 20 * 1024 * 1024
const MAX_TEXT_LENGTH = 200_000
const decoder = new TextDecoder('utf-8', { fatal: true })

function fail(message, code = 'invalid_input') {
  throw Object.assign(new Error(message), { code })
}

function safePath(value) {
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some(part => part === '..')) fail('PPTX 包含不安全路径')
  return value
}

async function inflateRaw(bytes, expectedBytes) {
  if (typeof DecompressionStream !== 'function') fail('当前运行环境不支持 PPTX 压缩解码', 'unsupported_host')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > expectedBytes || length > MAX_UNCOMPRESSED_BYTES) {
      await reader.cancel()
      fail('PPTX 实际解压长度超过目录声明或总量上限', 'budget_exceeded')
    }
    chunks.push(value)
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
async function readZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) fail('PPTX 文件为空或超过 128 MiB 上限', 'budget_exceeded')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset += 1) {
    if (view.getUint32(offset, true) === 0x06054b50) end = offset
  }
  if (end < 0) fail('PPTX ZIP 目录缺失或文件损坏')
  const disk = view.getUint16(end + 4, true)
  const directoryDisk = view.getUint16(end + 6, true)
  const entriesOnDisk = view.getUint16(end + 8, true)
  const entriesCount = view.getUint16(end + 10, true)
  const directoryBytes = view.getUint32(end + 12, true)
  const directoryOffset = view.getUint32(end + 16, true)
  if (disk || directoryDisk || entriesOnDisk !== entriesCount || entriesCount > MAX_ENTRIES || entriesCount === 0xffff || directoryOffset + directoryBytes > end) fail('PPTX ZIP 目录格式不受支持或超出限额', 'budget_exceeded')

  const files = new Map()
  let cursor = directoryOffset
  let totalBytes = 0
  for (let index = 0; index < entriesCount; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) fail('PPTX ZIP 目录项损坏')
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const expectedCrc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const nameStart = cursor + 46
    const next = nameStart + nameLength + extraLength + commentLength
    if (next > directoryOffset + directoryBytes || next > bytes.length || flags & 1 || ![0, 8].includes(method)) fail('PPTX 含加密或不支持的 ZIP 条目')
    const name = safePath(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)))
    if (files.has(name)) fail('PPTX ZIP 中存在重复路径')
    totalBytes += uncompressedSize
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) fail('PPTX 解压内容超过 50 MiB 上限', 'budget_exceeded')
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) fail('PPTX ZIP 本地目录项损坏')
    const localFlags = view.getUint16(localOffset + 6, true)
    const localMethod = view.getUint16(localOffset + 8, true)
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const localNameStart = localOffset + 30
    const localName = decoder.decode(bytes.subarray(localNameStart, localNameStart + localNameLength))
    if (localFlags !== flags || localMethod !== method || localName !== name || localNameStart + localNameLength + localExtraLength > bytes.length) fail('PPTX ZIP 本地目录与中央目录不匹配')
    if (method === 0 && compressedSize !== uncompressedSize) fail('PPTX ZIP 存储条目长度不匹配')
    const dataStart = localNameStart + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) fail('PPTX ZIP 数据区损坏')
    files.set(name, async () => {
      const content = bytes.subarray(dataStart, dataEnd)
      const expanded = method === 0 ? new Uint8Array(content) : await inflateRaw(content, uncompressedSize)
      if (expanded.byteLength !== uncompressedSize || crc32(expanded) !== expectedCrc) fail('PPTX ZIP 解压长度或 CRC 校验不匹配')
      return expanded
    })
    cursor = next
  }
  if (!files.has('ppt/presentation.xml') || [...files.keys()].some(name => /(?:^|\/)vbaProject\.bin$/iu.test(name))) fail('文件不是受支持的普通 PPTX 演示文稿')
  return files
}

function decodeXml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_all, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x'
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : ''
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity.toLowerCase()] ?? ''
  })
}

function xmlAttribute(tag, name) {
  const match = new RegExp('(?:^|\\s)' + name + '="([^"]*)"', 'u').exec(tag)
  return match ? decodeXml(match[1]) : ''
}

function relsFromXml(xml) {
  const rels = new Map()
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/gu)) {
    const id = xmlAttribute(match[0], 'Id')
    const target = xmlAttribute(match[0], 'Target')
    const mode = xmlAttribute(match[0], 'TargetMode')
    if (id && target && mode.toLowerCase() !== 'external') rels.set(id, target)
  }
  return rels
}

function resolvePart(base, target) {
  if (!target || target.startsWith('/') || target.includes('\\')) return ''
  const parts = base.split('/')
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') { if (!parts.length) return ''; parts.pop() }
    else parts.push(segment)
  }
  const value = parts.join('/')
  return value.startsWith('ppt/') && !value.split('/').includes('..') ? value : ''
}

function xmlText(xml) {
  return [...xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gu)].map(match => decodeXml(match[1])).join('')
}

function parseTableCell(xml) {
  const text = xmlText(xml)
  const run = xml.match(/<a:rPr\b([^>]*)>([\s\S]*?)<\/a:rPr>/u)
  const attrs = run?.[1] ?? ''
  const color = run?.[2].match(/<a:srgbClr\s+val="([0-9A-F]{6})"\s*\/>/iu)?.[1]?.toUpperCase()
  const fillColor = xml.match(/<a:tcPr\b[\s\S]*?<a:solidFill>\s*<a:srgbClr\s+val="([0-9A-F]{6})"\s*\/>/iu)?.[1]?.toUpperCase()
  const effectiveFill = fillColor === 'FFFFFF' ? undefined : fillColor
  const style = { ...(/\bb="(?:1|true)"/iu.test(attrs) ? { bold: true } : {}), ...(color ? { color } : {}), ...(effectiveFill ? { fillColor: effectiveFill } : {}) }
  return Object.keys(style).length ? { text, ...style } : text
}

function slideText(xml) {
  const paragraphs = []
  let hasAutoNumbering = false
  let chartTitle = ''
  let table
  for (const shape of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/gu)) {
    const body = shape[0]
    const shapeName = decodeXml(body.match(/<p:cNvPr\b[^>]*\bname="([^"]*)"/u)?.[1] ?? '')
    if (/^图表标题$/u.test(shapeName)) { chartTitle = xmlText(body); continue }
    if (/^(?:页码|演示标题|slide\s*number|presentation\s*title)$/iu.test(shapeName)) continue
    const shapeText = [...body.matchAll(/<a:p\b[\s\S]*?<\/a:p>/gu)].map(match => {
      const paragraph = match[0]
      const text = xmlText(paragraph)
      if (!text) return ''
      const bullet = paragraph.match(/<a:buChar\b[^>]*\bchar="([^"]+)"/u)?.[1]
      if (bullet) return `${decodeXml(bullet)} ${text}`
      if (/<a:buAutoNum\b/u.test(paragraph)) {
        hasAutoNumbering = true
        return `• ${text}`
      }
      return text
    }).filter(Boolean).join('\n')
    if (shapeText) paragraphs.push({ text: shapeText, title: /<p:ph\b[^>]*type="(?:title|ctrTitle)"/u.test(body) || /(?:页面标题|title)/iu.test(shapeName) })
  }
  for (const frame of xml.matchAll(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/gu)) {
    const tableXml = frame[0].match(/<a:tbl\b[\s\S]*?<\/a:tbl>/u)?.[0]
    if (!tableXml) continue
    const rows = [...tableXml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/gu)].map(row =>
      [...row[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/gu)].map(cell => parseTableCell(cell[0])),
    ).filter(row => row.length && row.some(cell => (typeof cell === 'string' ? cell : cell.text).trim()))
    if (rows.length > 20 || rows.some(row => row.length > 8) || new Set(rows.map(row => row.length)).size > 1) {
      fail('PPTX 原生表格超出导入范围（最多 20 行、8 列且每行列数须一致）', 'budget_exceeded')
    }
    if (rows.length) {
      if (table) fail('每页最多导入一个原生表格')
      table = { rows }
    }
  }
  const titleIndex = paragraphs.findIndex(item => item.title)
  const title = titleIndex >= 0 ? paragraphs[titleIndex].text : paragraphs[0]?.text
  const content = paragraphs.filter((_item, index) => index !== (titleIndex >= 0 ? titleIndex : 0)).map(item => item.text).join('\n')
  return { title: title || '', content, chartTitle, table, hasAutoNumbering }
}

function parseChartData(xml, title) {
  const chartKinds = [...xml.matchAll(/<c:([A-Za-z]+)Chart\b/gu)].map(match => match[1])
  const family = chartKinds.length === 1 ? chartKinds[0] : ''
  if (!['bar', 'line', 'area', 'pie', 'doughnut'].includes(family)) return null
  const barDir = xml.match(/<c:barDir\s+val="(col|bar)"\s*\/>/u)?.[1]
  const grouping = xml.match(/<c:grouping\s+val="(clustered|standard|stacked|percentStacked)"\s*\/>/u)?.[1]
  if (!family || (family === 'bar' ? !barDir || !grouping || grouping === 'standard' : ['line', 'area'].includes(family) ? barDir !== undefined || !grouping || grouping === 'clustered' : barDir !== undefined || grouping !== undefined)) return null
  const series = [...xml.matchAll(/<c:ser\b[\s\S]*?<\/c:ser>/gu)].map(match => {
    const body = match[0]
    const titleCache = body.match(/<c:tx>([\s\S]*?)<\/c:tx>/u)?.[1] ?? ''
    const name = decodeXml(titleCache.match(/<c:v>([\s\S]*?)<\/c:v>/u)?.[1] ?? titleCache.match(/<c:pt\b[^>]*><c:v>([\s\S]*?)<\/c:v><\/c:pt>/u)?.[1] ?? '') || (['pie', 'doughnut'].includes(family) ? '系列 1' : '')
    const categories = [...(body.match(/<c:cat>[\s\S]*?<\/c:cat>/u)?.[0] ?? '').matchAll(/<c:pt\s+idx="(\d+)"><c:v>([\s\S]*?)<\/c:v><\/c:pt>/gu)].map(item => [Number(item[1]), decodeXml(item[2])])
    const values = [...(body.match(/<c:val>[\s\S]*?<\/c:val>/u)?.[0] ?? '').matchAll(/<c:pt\s+idx="(\d+)"><c:v>([\s\S]*?)<\/c:v><\/c:pt>/gu)].map(item => [Number(item[1]), Number(item[2])])
    return { name, categories, values }
  })
  if (!series.length || series.length > 4 || (['pie', 'doughnut'].includes(family) && series.length !== 1)) return null
  const categories = series[0].categories
  if (categories.length < 1 || categories.length > 8 || categories.some(([index, value], position) => index !== position || !value || value.length > 40)) return null
  const names = new Set()
  if (series.some(item => {
    if (!item.name || item.name.length > 40 || names.has(item.name) || item.categories.length !== categories.length
      || item.categories.some(([index, value], position) => index !== position || value !== categories[position][1])
      || item.values.length !== categories.length
      || item.values.some(([index, value], position) => index !== position || !Number.isFinite(value) || value < 0 || value > 1_000_000_000)) return true
    names.add(item.name)
    return false
  })) return null
  return { title: String(title || '数据图表').slice(0, 80), categories: categories.map(([, value]) => value), series: series.map(item => ({ name: item.name, values: item.values.map(([, value]) => value) })), ...(barDir === 'bar' ? { sourceDirection: 'bar' } : {}), ...(family !== 'bar' ? { sourceFamily: family } : {}), ...(grouping !== 'clustered' && grouping !== 'standard' ? { sourceGrouping: grouping } : {}) }
}

function imageDataUrl(bytes) {
  let mime
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) mime = 'image/png'
  else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = 'image/jpeg'
  else return ''
  if (bytes.byteLength > MAX_IMAGE_BYTES) fail('PPTX 页面配图超过 3 MiB 上限', 'budget_exceeded')
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return `data:${mime};base64,${btoa(binary)}`
}

/** Parse bounded OOXML text and embedded PNG/JPEG only; never executes package parts or external relationships. */
export async function importPptxPresentation(input) {
  const files = await readZip(input)
  const loadText = async (name, maxBytes = MAX_SLIDE_XML_BYTES) => {
    const load = files.get(name)
    if (!load) return ''
    const bytes = await load()
    if (bytes.byteLength > maxBytes) fail(`PPTX 条目超过 ${maxBytes} 字节上限`, 'budget_exceeded')
    return decoder.decode(bytes)
  }
  const presentation = await loadText('ppt/presentation.xml')
  const presentationRels = relsFromXml(await loadText('ppt/_rels/presentation.xml.rels'))
  const slidePaths = []
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/gu)) {
    const target = presentationRels.get(decodeXml(match[1]))
    const path = resolvePart('ppt', target ?? '')
    if (path && path.startsWith('ppt/slides/')) slidePaths.push(path)
  }
  if (!slidePaths.length || slidePaths.length > MAX_SLIDES) fail('PPTX 演示需要 1 至 100 页', slidePaths.length > MAX_SLIDES ? 'budget_exceeded' : 'invalid_input')
  const slides = []
  const limitations = new Set()
  let totalText = 0
  let totalImageBytes = 0
  for (const path of slidePaths) {
    const xml = await loadText(path)
    if (!xml) fail('PPTX 页面引用缺失')
    const slide = slideText(xml)
    if (slide.hasAutoNumbering) limitations.add('PPTX 自动编号列表以项目符号导入，编号样式会标准化。')
    if (slide.table) totalText += slide.table.rows.flat().reduce((sum, cell) => sum + (typeof cell === 'string' ? cell : cell.text).length, 0)
    const relPath = path.replace(/\/([^/]+)$/u, '/_rels/$1.rels')
    const rels = relsFromXml(await loadText(relPath))
    const chartId = xml.match(/<c:chart\b[^>]*\br:id="([^"]+)"/u)?.[1]
    const chartPath = chartId ? resolvePart(path.split('/').slice(0, -1).join('/'), rels.get(decodeXml(chartId)) ?? '') : ''
    let chart
    if (chartPath) {
      chart = parseChartData(await loadText(chartPath), slide.chartTitle)
      if (!chart) limitations.add('部分 PPTX 图表类型或数据格式不受支持，未转换。')
      else if (chart.sourceDirection || chart.sourceFamily || chart.sourceGrouping) {
        if (chart.sourceDirection) limitations.add('横向条形图已按通用图表数据导入，视觉方向将标准化。')
        if (chart.sourceFamily) limitations.add(`${({ line: '折线', area: '面积', pie: '饼', doughnut: '圆环' })[chart.sourceFamily]}图已按通用图表数据导入，图表类型将标准化。`)
        if (chart.sourceGrouping) limitations.add(`${chart.sourceGrouping === 'percentStacked' ? '百分比堆叠' : '堆叠'}图已按通用图表数据导入，堆叠视觉语义将标准化。`)
        delete chart.sourceDirection
        delete chart.sourceFamily
        delete chart.sourceGrouping
      }
    }
    totalText += slide.title.length + slide.content.length
    if (chart) totalText += chart.title.length + chart.categories.join('').length + chart.series.reduce((sum, item) => sum + item.name.length + item.values.join('').length, 0)
    if (totalText > MAX_TEXT_LENGTH) fail('PPTX 文本超过 200,000 字符上限', 'budget_exceeded')
    const imagePaths = [...xml.matchAll(/<a:blip\b[^>]*\br:embed="([^"]+)"/gu)].map(match =>
      resolvePart(path.split('/').slice(0, -1).join('/'), rels.get(decodeXml(match[1])) ?? '')).filter(Boolean)
    const images = []
    let unsupportedImageCount = [...xml.matchAll(/<a:blip\b[^>]*\br:link="[^"]+"/gu)].length
    let imageBudgetOmittedCount = 0
    for (const imagePath of imagePaths) {
      const load = files.get(imagePath)
      if (!load) { unsupportedImageCount += 1; continue }
      const bytes = await load()
      totalImageBytes += bytes.byteLength
      if (totalImageBytes > MAX_IMAGES_BYTES_TOTAL) {
        unsupportedImageCount += 1
        imageBudgetOmittedCount += 1
        continue
      }
      if (bytes.byteLength > MAX_IMAGE_BYTES) { unsupportedImageCount += 1; continue }
      const image = imageDataUrl(bytes)
      if (image) images.push(image)
      else unsupportedImageCount += 1
    }
    if (unsupportedImageCount) limitations.add(`第 ${slides.length + 1} 页有 ${unsupportedImageCount} 张内嵌图片因外部链接、格式不受支持或资源缺失而未导入；目前只保留内嵌 PNG/JPEG。`)
    if (imageBudgetOmittedCount) limitations.add(`第 ${slides.length + 1} 页有 ${imageBudgetOmittedCount} 张图片因演示图片总量超过 20 MiB 预算而未导入。`)
    if (!slide.title && !slide.content && !slide.table && !chart && !images.length && !unsupportedImageCount) fail('PPTX 中存在没有可读内容或可恢复视觉素材的空白页')
    if (!slide.title && images.length) limitations.add('图片页面未包含可读标题；已保留原图，可通过 OCR 和逐页理解补全。')
    const pageNumber = slides.length + 1
    const pageTitle = slide.title || (images.length ? `第 ${pageNumber} 页（图片页）` : `第 ${pageNumber} 页（待补视觉素材）`)
    const visualDescription = unsupportedImageCount
      ? `原 PPTX 本页有 ${unsupportedImageCount} 张图片因外部链接、格式不受支持或资源缺失而未导入；视觉内容不完整，请补充整页截图后再理解或生成修改提示词。`
      : ''
    slides.push({ title: pageTitle, content: slide.content, ...(visualDescription ? { visualDescription } : {}), ...(slide.table ? { table: slide.table } : {}), ...(chart ? { chart } : {}), ...(images.length ? { imageDataUrls: images } : {}), style: { title: {}, body: {} } })
  }
  const props = await loadText('docProps/core.xml')
  const title = props.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/u)?.[1]
  limitations.add('不支持的图表数据、主题、动画及复杂版式不会转换。外部关系不读取。')
  return { title: title ? decodeXml(title) : '', slides, limitations: [...limitations] }
}
