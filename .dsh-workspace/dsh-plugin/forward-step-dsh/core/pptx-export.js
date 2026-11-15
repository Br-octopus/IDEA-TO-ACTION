const MAX_SLIDES = 100
const MAX_TEXT_LENGTH = 200000
const MAX_IMAGE_BYTES_PER_SLIDE = 3 * 1024 * 1024
const MAX_IMAGE_BYTES_TOTAL = 20 * 1024 * 1024
const encoder = new TextEncoder()

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character])
}

function normalizeChart(chart, index) {
  if (chart == null) return undefined
  if (!chart || typeof chart !== 'object' || !Array.isArray(chart.categories)) {
    throw Object.assign(new Error(`第 ${index + 1} 页图表必须包含 categories 数组和 series 数据`), { code: 'invalid_input' })
  }
  const categories = chart.categories.map(value => String(value ?? '').trim())
  const inputSeries = Array.isArray(chart.series)
    ? chart.series
    : Array.isArray(chart.values) ? [{ name: '数值', values: chart.values }] : []
  if (categories.length < 1 || categories.length > 8 || inputSeries.length < 1 || inputSeries.length > 4) {
    throw Object.assign(new Error(`第 ${index + 1} 页图表需要 1 至 8 个类别和 1 至 4 个系列`), { code: 'invalid_input' })
  }
  if (categories.some(value => !value || value.length > 40)) {
    throw Object.assign(new Error(`第 ${index + 1} 页图表类别无效`), { code: 'invalid_input' })
  }
  const names = new Set()
  const series = inputSeries.map((item, seriesIndex) => {
    const name = String(item?.name ?? `系列 ${seriesIndex + 1}`).trim()
    if (!name || name.length > 40 || names.has(name) || !Array.isArray(item?.values) || item.values.length !== categories.length) {
      throw Object.assign(new Error(`第 ${index + 1} 页图表系列必须有唯一名称及与类别等长的数据`), { code: 'invalid_input' })
    }
    names.add(name)
    const values = item.values.map(Number)
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1_000_000_000)) {
      throw Object.assign(new Error(`第 ${index + 1} 页图表数值无效`), { code: 'invalid_input' })
    }
    return { name, values }
  })
  return { title: String(chart.title ?? '数据图表').trim().slice(0, 80) || '数据图表', categories, series }
}

function normalizeTable(table, index) {
  if (table == null) return undefined
  if (!table || !Array.isArray(table.rows) || table.rows.length < 1 || table.rows.length > 20) throw Object.assign(new Error(`第 ${index + 1} 页表格需要 1 至 20 行`), { code: 'invalid_input' })
  const rows = table.rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length < 1 || row.length > 8) throw Object.assign(new Error(`第 ${index + 1} 页表格第 ${rowIndex + 1} 行需要 1 至 8 列`), { code: 'invalid_input' })
    return row.map(cell => typeof cell === 'string' ? cell.slice(0, 1000) : ({ text: String(cell?.text ?? '').slice(0, 1000), ...(cell?.bold === true ? { bold: true } : {}), ...(typeof cell?.color === 'string' && /^[0-9A-F]{6}$/iu.test(cell.color) ? { color: cell.color.toUpperCase() } : {}), ...(typeof cell?.fillColor === 'string' && /^[0-9A-F]{6}$/iu.test(cell.fillColor) ? { fillColor: cell.fillColor.toUpperCase() } : {}) }))
  })
  if (new Set(rows.map(row => row.length)).size !== 1) throw Object.assign(new Error(`第 ${index + 1} 页表格每行列数必须一致`), { code: 'invalid_input' })
  return { rows }
}

function tableFrame(table) {
  if (!table) return ''
  const columns = table.rows[0].length
  const x = 6500000, y = 2900000, width = 5000000, height = 3300000
  const columnWidths = Array(columns).fill(Math.floor(width / columns))
  columnWidths[columns - 1] += width - columnWidths.reduce((sum, value) => sum + value, 0)
  const grid = columnWidths.map(value => `<a:gridCol w="${value}"/>`).join('')
  const rows = table.rows.map((row, rowIndex) => {
    const cells = row.map(value => {
      const cell = typeof value === 'string' ? { text: value } : value
      const textFill = cell.color ? `<a:solidFill><a:srgbClr val="${cell.color}"/></a:solidFill>` : ''
      const cellFill = cell.fillColor ? `<a:solidFill><a:srgbClr val="${cell.fillColor}"/></a:solidFill>` : '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>'
      const bold = cell.bold || rowIndex === 0 ? 1 : 0
      return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="${rowIndex === 0 ? 1200 : 1100}" b="${bold}">${textFill}</a:rPr><a:t xml:space="preserve">${escapeXml(cell.text)}</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p></a:txBody><a:tcPr marL="45720" marR="45720" marT="22860" marB="22860">${cellFill}<a:lnL w="6350"><a:solidFill><a:srgbClr val="D9E1F2"/></a:solidFill></a:lnL><a:lnR w="6350"><a:solidFill><a:srgbClr val="D9E1F2"/></a:solidFill></a:lnR><a:lnT w="6350"><a:solidFill><a:srgbClr val="D9E1F2"/></a:solidFill></a:lnT><a:lnB w="6350"><a:solidFill><a:srgbClr val="D9E1F2"/></a:solidFill></a:lnB></a:tcPr></a:tc>`
    }).join('')
    return `<a:tr h="${Math.floor(height / table.rows.length)}">${cells}</a:tr>`
  }).join('')
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="91" name="可编辑表格"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="0"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

function normalizeSlideStyle(style, index) {
  if (style == null) return { title: {}, body: {} }
  if (typeof style !== 'object' || Array.isArray(style)) throw Object.assign(new Error('PPT 页面样式必须是对象'), { code: 'invalid_input' })
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
    if (value.fontFamily !== undefined) {
      if (typeof value.fontFamily !== 'string' || !/^[\p{L}\p{N}_ -]{1,80}$/u.test(value.fontFamily)) throw Object.assign(new Error(`第 ${index + 1} 页${field}字体名称无效`), { code: 'invalid_input' })
      result.fontFamily = value.fontFamily
    }
    if (value.lineSpacingPct !== undefined) {
      if (!Number.isSafeInteger(value.lineSpacingPct) || value.lineSpacingPct < 50 || value.lineSpacingPct > 300) throw Object.assign(new Error(`第 ${index + 1} 页${field}行距无效`), { code: 'invalid_input' })
      result.lineSpacingPct = value.lineSpacingPct
    }
    if (value.textIndentEmu !== undefined) {
      if (!Number.isSafeInteger(value.textIndentEmu) || Math.abs(value.textIndentEmu) > 1828800) throw Object.assign(new Error('Invalid paragraph indent'), { code: 'invalid_input' })
      result.textIndentEmu = value.textIndentEmu
    }
    for (const property of ['leftMarginEmu', 'rightMarginEmu']) {
      if (value[property] !== undefined) {
        if (!Number.isSafeInteger(value[property]) || value[property] < 0 || value[property] > 1828800) throw Object.assign(new Error('Invalid paragraph margin'), { code: 'invalid_input' })
        result[property] = value[property]
      }
    }
    for (const property of ['spaceBeforePt', 'spaceAfterPt']) {
      if (value[property] !== undefined) {
        if (!Number.isSafeInteger(value[property]) || value[property] < 0 || value[property] > 14400) throw Object.assign(new Error('Invalid paragraph spacing'), { code: 'invalid_input' })
        result[property] = value[property]
      }
    }
    if (value.align !== undefined) {
      if (!['left', 'center', 'right', 'justify'].includes(value.align)) throw Object.assign(new Error(`第 ${index + 1} 页${field}对齐方式无效`), { code: 'invalid_input' })
      result.align = value.align
    }
    for (const property of ['bold', 'italic', 'underline', 'strikethrough']) {
      if (value[property] !== undefined && typeof value[property] !== 'boolean') throw Object.assign(new Error(`第 ${index + 1} 页${field}${property}无效`), { code: 'invalid_input' })
      if (value[property] === true || (['underline', 'strikethrough'].includes(property) && value[property] === false)) result[property] = value[property]
    }
    if (value.href !== undefined) {
      if (typeof value.href !== 'string' || value.href.length > 2048) throw Object.assign(new Error(`第 ${index + 1} 页${field}超链接无效`), { code: 'invalid_input' })
      let url
      try { url = new URL(value.href) } catch { throw Object.assign(new Error(`第 ${index + 1} 页${field}超链接无效`), { code: 'invalid_input' }) }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Object.assign(new Error(`第 ${index + 1} 页${field}超链接仅支持无凭证 HTTP(S)`), { code: 'invalid_input' })
      for (const key of [...url.searchParams.keys()]) if (/(?:token|key|auth|session|credential|password|cookie)/iu.test(key)) url.searchParams.delete(key)
      url.hash = ''
      result.href = url.toString()
    }
    return result
  }
  return {
    backgroundColor: color(style.backgroundColor, '背景'),
    title: textStyle(style.title, '标题'),
    body: textStyle(style.body, '正文'),
  }
}

function normalizeSlides(slides) {
  if (!Array.isArray(slides) || slides.length === 0 || slides.length > MAX_SLIDES) {
    throw Object.assign(new Error('PPTX 导出需要 1 至 100 页逐页规划'), { code: 'invalid_input' })
  }
  let total = 0
  let imageBytesTotal = 0
  const normalized = slides.map((slide, index) => {
    const title = String(slide?.title ?? '').trim() || `第 ${index + 1} 页`
    const body = slide?.body ?? slide?.content ?? ''
    const paragraphs = (Array.isArray(body) ? body : [body]).flatMap(value => String(value ?? '').split(/\r?\n/u)).map(value => value.trim()).filter(Boolean)
    total += title.length + paragraphs.join('').length
    let image
    if (slide?.imageDataUrl) {
      if (typeof slide.imageDataUrl !== 'string' || slide.imageDataUrl.length > Math.ceil(MAX_IMAGE_BYTES_PER_SLIDE / 3) * 4 + 64) {
        throw Object.assign(new Error(`第 ${index + 1} 页图片超过 3 MiB 上限`), { code: 'budget_exceeded' })
      }
      const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(slide.imageDataUrl)
      if (!match) throw Object.assign(new Error(`第 ${index + 1} 页图片必须为 PNG 或 JPEG 数据`), { code: 'invalid_input' })
      let binary
      try { binary = atob(match[2]) } catch { throw Object.assign(new Error(`第 ${index + 1} 页图片编码无效`), { code: 'invalid_input' }) }
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES_PER_SLIDE) throw Object.assign(new Error(`第 ${index + 1} 页图片超过 3 MiB 上限`), { code: 'budget_exceeded' })
      const isPng = match[1] === 'png' && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, byteIndex) => bytes[byteIndex] === byte)
      const isJpeg = match[1] === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
      if (!isPng && !isJpeg) throw Object.assign(new Error(`第 ${index + 1} 页图片内容与其 MIME 类型不符`), { code: 'invalid_input' })
      imageBytesTotal += bytes.length
      if (imageBytesTotal > MAX_IMAGE_BYTES_TOTAL) throw Object.assign(new Error('PPTX 图片总量超过 20 MiB 上限'), { code: 'budget_exceeded' })
      image = { extension: match[1] === 'jpeg' ? 'jpg' : 'png', bytes }
    }
    const chart = normalizeChart(slide?.chart, index)
    const table = normalizeTable(slide?.table, index)
    const style = normalizeSlideStyle(slide?.style, index)
    if (table) total += table.rows.flat().join('').length
    if (chart) total += chart.title.length + chart.categories.join('').length + chart.series.reduce((sum, item) => sum + item.name.length + item.values.join('').length, 0)
    const paragraphStyles = Array.isArray(slide?.paragraphStyles) ? slide.paragraphStyles.slice(0, paragraphs.length).map(item => normalizeSlideStyle({ body: item }, index).body) : []
    const paragraphRuns = Array.isArray(slide?.paragraphRuns) ? slide.paragraphRuns.slice(0, paragraphs.length).map(paragraph => Array.isArray(paragraph) ? paragraph.slice(0, 200).map(run => ({ text: String(run?.text ?? ''), style: normalizeSlideStyle({ body: run?.style ?? {} }, index).body })) : []) : []
    return { title, paragraphs, paragraphStyles, paragraphRuns, image, chart, table, style }
  })
  if (normalized.every(slide => !slide.paragraphs.length && /^第 \d+ 页$/u.test(slide.title))) {
    throw Object.assign(new Error('PPTX 导出内容不能为空'), { code: 'invalid_input' })
  }
  if (total > MAX_TEXT_LENGTH) throw Object.assign(new Error('PPTX 导出内容超过 200,000 字符上限'), { code: 'budget_exceeded' })
  return normalized
}

function textShape(id, name, text, { x, y, cx, cy, fontSize, fontFamily = 'Aptos', bold = false, italic = false, align = 'left', color = '17212B', lineSpacingPct, textIndentEmu, leftMarginEmu, rightMarginEmu, spaceBeforePt, spaceAfterPt, paragraphStyles = [], paragraphRuns = [], hyperlinkRelationships = new Map() }) {
  const inheritedBold = bold
  const inheritedItalic = italic
  const paragraphs = text.split(/\r?\n/u).map((line, index) => {
    const hasParagraphStyle = index < paragraphStyles.length
    const style = paragraphStyles[index] ?? {}
    const bold = hasParagraphStyle ? style.bold === true : (style.bold ?? inheritedBold)
    const italic = hasParagraphStyle ? style.italic === true : (style.italic ?? inheritedItalic)
    const alignment = { left: 'l', center: 'ctr', right: 'r', justify: 'just' }[style.align ?? align] ?? 'l'
    const runs = paragraphRuns[index]?.length ? paragraphRuns[index].map(run => {
      const runStyle = run.style ?? {}
      const hyperlink = runStyle.href ? `<a:hlinkClick r:id="${hyperlinkRelationships.get(runStyle.href)}"/>` : ''
      return '<a:r><a:rPr lang="zh-CN" sz="' + (runStyle.fontSize ?? style.fontSize ?? fontSize) + '" b="' + ((runStyle.bold ?? style.bold ?? bold) ? 1 : 0) + '" i="' + ((runStyle.italic ?? style.italic ?? italic) ? 1 : 0) + '" u="' + ((runStyle.underline ?? style.underline) === true ? 'sng' : 'none') + '" strike="' + ((runStyle.strikethrough ?? style.strikethrough) === true ? 'sngStrike' : 'noStrike') + '" dirty="0">' + hyperlink + '<a:solidFill><a:srgbClr val="' + (runStyle.color ?? style.color ?? color) + '"/></a:solidFill><a:latin typeface="' + escapeXml(runStyle.fontFamily ?? style.fontFamily ?? fontFamily) + '"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t xml:space="preserve">' + escapeXml(run.text) + '</a:t></a:r>'
    }).join('') : '<a:r><a:rPr lang="zh-CN" sz="' + (style.fontSize ?? fontSize) + '" b="' + (bold ? 1 : 0) + '" i="' + (italic ? 1 : 0) + '" u="' + (style.underline === true ? 'sng' : 'none') + '" strike="' + (style.strikethrough === true ? 'sngStrike' : 'noStrike') + '" dirty="0"><a:solidFill><a:srgbClr val="' + (style.color ?? color) + '"/></a:solidFill><a:latin typeface="' + escapeXml(style.fontFamily ?? fontFamily) + '"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t xml:space="preserve">' + escapeXml(line) + '</a:t></a:r>'
    const paragraphAttributes = ' algn="' + alignment + '"'
      + ((style.leftMarginEmu ?? leftMarginEmu) !== undefined ? ' marL="' + (style.leftMarginEmu ?? leftMarginEmu) + '"' : '')
      + ((style.rightMarginEmu ?? rightMarginEmu) !== undefined ? ' marR="' + (style.rightMarginEmu ?? rightMarginEmu) + '"' : '')
      + ((style.textIndentEmu ?? textIndentEmu) !== undefined ? ' indent="' + (style.textIndentEmu ?? textIndentEmu) + '"' : '')
    const paragraphSpacing = [
      (style.lineSpacingPct ?? lineSpacingPct) ? '<a:lnSpc><a:spcPct val="' + (style.lineSpacingPct ?? lineSpacingPct) * 1000 + '"/></a:lnSpc>' : '',
      (style.spaceBeforePt ?? spaceBeforePt) !== undefined ? '<a:spcBef><a:spcPts val="' + (style.spaceBeforePt ?? spaceBeforePt) + '"/></a:spcBef>' : '',
      (style.spaceAfterPt ?? spaceAfterPt) !== undefined ? '<a:spcAft><a:spcPts val="' + (style.spaceAfterPt ?? spaceAfterPt) + '"/></a:spcAft>' : '',
    ].join('')
    const paragraphProperties = paragraphSpacing
      ? '<a:pPr' + paragraphAttributes + '>' + paragraphSpacing + '</a:pPr>'
      : '<a:pPr' + paragraphAttributes + '/>'
    return '<a:p>' + paragraphProperties + runs + '<a:endParaRPr lang="zh-CN"/></a:p>'
  }).join('')
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + escapeXml(name) + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t" lIns="0" tIns="0" rIns="0" bIns="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>' + paragraphs + '</p:txBody></p:sp>'
}

function chartFrame(chart) {
  if (!chart) return ''
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="原生数据图表"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="6500000" y="3200000"/><a:ext cx="5000000" cy="2700000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame>`
}

function chartXml(chart) {
  const series = chart.series.map((item, seriesIndex) => {
    const categories = chart.categories.map((category, index) => `<c:pt idx="${index}"><c:v>${escapeXml(category)}</c:v></c:pt>`).join('')
    const values = item.values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('')
    const colors = ['4472C4', 'ED7D31', '70AD47', 'A5A5A5']
    return `<c:ser><c:idx val="${seriesIndex}"/><c:order val="${seriesIndex}"/><c:tx><c:v>${escapeXml(item.name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${colors[seriesIndex]}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:cat><c:strLit><c:ptCount val="${chart.categories.length}"/>${categories}</c:strLit></c:cat><c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${item.values.length}"/>${values}</c:numLit></c:val><c:invertIfNegative val="0"/></c:ser>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:lang val="zh-CN"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/></c:dLbls><c:gapWidth val="90"/><c:overlap val="0"/><c:axId val="48650112"/><c:axId val="48672768"/></c:barChart><c:catAx><c:axId val="48650112"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="48672768"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="48672768"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="48650112"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr></c:chartSpace>`
}

function slideXml(slide, index, total, presentationTitle, hyperlinkRelationships = new Map()) {
  const titleStyle = slide.style.title
  const bodyStyle = slide.style.body
  const background = /^[0-9A-F]{6}$/u.test(slide.style.backgroundColor ?? '') ? '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + slide.style.backgroundColor + '"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' : ''
  const picture = slide.image ? '<p:pic><p:nvPicPr><p:cNvPr id="6" name="用户图片"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="6500000" y="2900000"/><a:ext cx="5000000" cy="3000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' : ''
  const shapes = [
    textShape(2, '页码', `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, { x: 650000, y: 260000, cx: 2500000, cy: 260000, fontSize: 1200, color: '586775' }),
    textShape(3, '演示标题', presentationTitle, { x: 8500000, y: 260000, cx: 3000000, cy: 260000, fontSize: 1000, color: '586775' }),
    textShape(4, '页面标题', slide.title, { x: 850000, y: 1150000, cx: 10500000, cy: 1350000, fontSize: titleStyle.fontSize ?? 3000, fontFamily: titleStyle.fontFamily, bold: titleStyle.bold ?? true, italic: titleStyle.italic, align: titleStyle.align, color: titleStyle.color ?? '17212B' }),
    textShape(5, '页面正文', slide.paragraphs.join('\n'), { x: 900000, y: 2900000, cx: slide.image || slide.chart ? 5000000 : 10400000, cy: 3300000, fontSize: bodyStyle.fontSize ?? 1800, fontFamily: bodyStyle.fontFamily, bold: bodyStyle.bold, italic: bodyStyle.italic, align: bodyStyle.align, color: bodyStyle.color ?? '17212B', lineSpacingPct: bodyStyle.lineSpacingPct, textIndentEmu: bodyStyle.textIndentEmu, leftMarginEmu: bodyStyle.leftMarginEmu, rightMarginEmu: bodyStyle.rightMarginEmu, spaceBeforePt: bodyStyle.spaceBeforePt, spaceAfterPt: bodyStyle.spaceAfterPt, paragraphStyles: slide.paragraphStyles, paragraphRuns: slide.paragraphRuns, hyperlinkRelationships }),
  ].join('') + (slide.table ? tableFrame(slide.table) : '') + (slide.chart ? textShape(90, '图表标题', slide.chart.title, { x: 6500000, y: 2750000, cx: 5000000, cy: 350000, fontSize: 1600, bold: true }) + chartFrame(slide.chart) : '') + picture
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="第 ${index + 1} 页">${background}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function concat(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  return output
}

function zipStore(entries) {
  const localChunks = []
  const centralChunks = []
  let localOffset = 0
  for (const [path, content] of entries) {
    const name = encoder.encode(path)
    const data = content instanceof Uint8Array ? content : encoder.encode(content)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length + data.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true)
    view.setUint16(8, 0, true); view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true)
    view.setUint16(26, name.length, true); local.set(name, 30); local.set(data, 30 + name.length)
    localChunks.push(local)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true); centralView.setUint16(10, 0, true); centralView.setUint32(16, crc, true)
    centralView.setUint32(20, data.length, true); centralView.setUint32(24, data.length, true); centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, localOffset, true); central.set(name, 46)
    centralChunks.push(central)
    localOffset += local.length
  }
  const centralDirectory = concat(centralChunks)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralDirectory.length, true); endView.setUint32(16, localOffset, true)
  return concat([...localChunks, centralDirectory, end])
}

function packageEntries(title, slides) {
  const slideOverrides = slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
  const chartOverrides = slides.flatMap((slide, index) => slide.chart ? [`<Override PartName="/ppt/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`] : []).join('')
  const slideIds = slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')
  const slideRels = slides.map((_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')
  const entries = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}${chartOverrides}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`],
    ['ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slideRels}</Relationships>`],
    ['ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="4472C4" accent2="ED7D31" accent3="A5A5A5" accent4="FFC000" accent5="5B9BD5" accent6="70AD47" bg1="lt1" bg2="lt2" tx1="dk1" tx2="dk2" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`],
    ['ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="空白"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`],
    ['ppt/theme/theme1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="向前一步"><a:themeElements><a:clrScheme name="清晰"><a:dk1><a:srgbClr val="17212B"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="586775"/></a:dk2><a:lt2><a:srgbClr val="F2F4F7"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="通用"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`],
  ]
  slides.forEach((slide, index) => {
    const hyperlinkTargets = [...new Set(slide.paragraphRuns.flatMap(paragraph => paragraph.map(run => run.style?.href).filter(Boolean)))]
    const hyperlinkRelationships = new Map(hyperlinkTargets.map((url, linkIndex) => [url, `rId${linkIndex + 4}`]))
    entries.push([`ppt/slides/slide${index + 1}.xml`, slideXml(slide, index, slides.length, title, hyperlinkRelationships)])
    const hyperlinkRelations = hyperlinkTargets.map((url, linkIndex) => `<Relationship Id="rId${linkIndex + 4}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(url)}" TargetMode="External"/>`).join('')
    const imageRelation = slide.image ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image' + (index + 1) + '.' + slide.image.extension + '"/>' : ''
    const chartRelation = slide.chart ? `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${index + 1}.xml"/>` : ''
    entries.push([`ppt/slides/_rels/slide${index + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${imageRelation}${chartRelation}${hyperlinkRelations}</Relationships>`])
    if (slide.chart) entries.push([`ppt/charts/chart${index + 1}.xml`, chartXml(slide.chart)])
    if (slide.image) entries.push([`ppt/media/image${index + 1}.${slide.image.extension}`, slide.image.bytes])
  })
  return entries
}

export function buildPptxPresentation({ title, slides } = {}) {
  const normalized = normalizeSlides(slides)
  const presentationTitle = String(title ?? '').trim().slice(0, 240) || normalized[0].title
  const bytes = zipStore(packageEntries(presentationTitle, normalized))
  return { bytes, slideCount: normalized.length, byteLength: bytes.byteLength }
}

export function downloadPptxPresentation({ title, slides }, documentObject = globalThis.document, urlApi = globalThis.URL) {
  if (!documentObject?.createElement || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL) {
    throw Object.assign(new Error('当前环境不支持下载 PPTX 文件'), { code: 'download_unavailable' })
  }
  const result = buildPptxPresentation({ title, slides })
  const filename = String(title ?? 'presentation').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-').slice(0, 80) || 'presentation'
  const link = documentObject.createElement('a')
  const url = urlApi.createObjectURL(new Blob([result.bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))
  link.href = url
  link.download = `${filename}.pptx`
  link.hidden = true
  documentObject.body.append(link)
  try { link.click() } finally { link.remove(); setTimeout(() => urlApi.revokeObjectURL(url), 0) }
  return { filename: link.download, slideCount: result.slideCount, byteLength: result.byteLength }
}
