import { parse } from 'parse5'

const MAX_HTML_BYTES = 10 * 1024 * 1024
const MAX_SLIDES = 100
const MAX_TEXT_LENGTH = 200_000
const MAX_IMAGE_DATA_URL_LENGTH = 4 * 1024 * 1024 + 64
const ACTIVE_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'form', 'video', 'audio', 'math'])
const CHART_SVG_TAGS = new Set(['svg', 'g', 'line', 'text', 'rect'])
const EXTERNAL_ATTRIBUTES = new Set(['src', 'srcset', 'poster', 'action', 'formaction'])

function fail(message, code = 'invalid_input') {
  throw Object.assign(new Error(message), { code })
}

function children(node) {
  return node?.childNodes ?? []
}

function attributes(node) {
  return Object.fromEntries((node?.attrs ?? []).map(attribute => [attribute.name.toLowerCase(), attribute.value]))
}

function hasClass(node, className) {
  return (attributes(node).class ?? '').split(/\s+/u).includes(className)
}

function walk(node, predicate, results = []) {
  for (const child of children(node)) {
    if (predicate(child)) results.push(child)
    walk(child, predicate, results)
  }
  return results
}

function first(node, predicate) {
  return walk(node, predicate)[0]
}

function textContent(node) {
  if (!node) return ''
  if (node.nodeName === '#text') return node.value ?? ''
  if (isElement(node, 'br')) return '\n'
  return children(node).map(textContent).join('').replace(/[ \t\r\f\v]+/gu, ' ').replace(/\n[ \t]*/gu, '\n').trim()
}

function isElement(node, tagName) {
  return node?.tagName === tagName
}

function insideChart(node) {
  for (let parent = node?.parentNode; parent; parent = parent.parentNode) {
    if (isElement(parent, 'figure') && hasClass(parent, 'chart')) return true
  }
  return false
}

function isSlide(node) {
  const attrs = attributes(node)
  return Object.hasOwn(attrs, 'data-slide')
    || hasClass(node, 'slide')
    || ((node.tagName === 'section' || node.tagName === 'article') && hasSlidesAncestor(node))
}

function hasSlidesAncestor(node) {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (hasClass(parent, 'slides')) return true
  }
  return false
}

function cssFontFamily(value) {
  if (typeof value !== 'string') return undefined
  const match = /^(?:"([^"]+)"|'([^']+)'|([^,]+))/u.exec(value.trim())
  const family = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
  return /^[\p{L}\p{N}_ -]{1,80}$/u.test(family) ? family : undefined
}

function cssLineSpacingPct(value) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  const multiplier = /^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(normalized) ? Number(normalized) * 100 : /^(?:\d+(?:\.\d+)?|\.\d+)%$/u.test(normalized) ? Number(normalized.slice(0, -1)) : NaN
  return Number.isFinite(multiplier) && multiplier >= 50 && multiplier <= 300 ? Math.round(multiplier) : undefined
}

function cssTextIndentEmu(value) {
  if (typeof value !== 'string') return undefined
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(px|pt)$/iu.exec(value.trim())
  if (!match) return undefined
  const points = Number(match[1]) * (match[2].toLowerCase() === 'px' ? 0.75 : 1)
  return Number.isFinite(points) && Math.abs(points) <= 144 ? Math.round(points * 12700) : undefined
}

function cssParagraphMarginEmu(value) {
  if (typeof value !== 'string') return undefined
  const match = /^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)(px|pt)$/iu.exec(value.trim())
  if (!match) return undefined
  const points = Number.parseFloat(value) * (match[1].toLowerCase() === 'px' ? 0.75 : 1)
  return Number.isFinite(points) && points <= 144 ? Math.round(points * 12700) : undefined
}

function cssParagraphSpacing(value) {
  if (typeof value !== 'string') return undefined
  const match = /^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)(px|pt)$/iu.exec(value.trim())
  if (!match) return undefined
  const amount = Number.parseFloat(value)
  const points = amount * (match[1].toLowerCase() === 'px' ? 0.75 : 1)
  return Number.isFinite(points) && points >= 0 && points <= 144 ? Math.round(points * 100) : undefined
}

function parseCssDeclarations(value) {
  const declarations = new Map()
  for (const declaration of value.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator < 1) continue
    let property = declaration.slice(0, separator).trim().toLowerCase()
    const rawValue = declaration.slice(separator + 1).trim()
    const value = rawValue.replace(/\s*!important\s*$/iu, '').trim()
    if (property === 'margin') {
      const parts = value.split(/\s+/u)
      if (parts.length < 1 || parts.length > 4 || parts.some(part => cssParagraphSpacing(part) === undefined || cssParagraphMarginEmu(part) === undefined)) continue
      const [top, right = top, bottom = top, left = right] = parts
      const important = /\s*!important\s*$/iu.test(rawValue)
      for (const [side, margin] of [['top', top], ['right', right], ['bottom', bottom], ['left', left]]) {
        declarations.set(`margin-${side}`, { value: margin, important })
      }
      continue
    }
    if (property === 'text-decoration') {
      const decorations = value.toLowerCase().split(/\s+/u)
      if (decorations.includes('none') ? decorations.length !== 1 : decorations.some(item => !['underline', 'line-through'].includes(item))) continue
    }
    if (property === 'font-family' && !cssFontFamily(value)) continue
    if (property === 'line-height' && cssLineSpacingPct(value) === undefined) continue
    if (property === 'text-indent' && cssTextIndentEmu(value) === undefined) continue
    if (['margin-top', 'margin-bottom'].includes(property) && cssParagraphSpacing(value) === undefined) continue
    if (['margin-left', 'margin-right'].includes(property) && cssParagraphMarginEmu(value) === undefined) continue
    if (property === 'background') {
      if (!cssColor(value)) continue
      property = 'background-color'
    }
    if (['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'font-family', 'line-height', 'text-align', 'text-decoration', 'text-indent', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right'].includes(property)) {
      const important = /\s*!important\s*$/iu.test(rawValue)
      declarations.set(property, { value, important })
    }
  }
  return declarations
}

function parseCssRules(document) {
  const rules = []
  for (const styleNode of walk(document, node => isElement(node, 'style'))) {
    const css = textContent(styleNode)
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const selectors = match[1].split(',').map(value => value.trim()).filter(value => /^(?:[a-z][\w-]*)?(?:\.[\w-]+)*(?:#[\w-]+)?(?:\s+(?:[a-z][\w-]*)?(?:\.[\w-]+)*(?:#[\w-]+)?)*$/iu.test(value))
      if (selectors.length) rules.push({ selectors, declarations: parseCssDeclarations(match[2]) })
    }
  }
  return rules
}

function matchesSimpleSelector(node, selector) {
  const parts = selector.split(/\s+/u)
  let current = node
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const match = /^([a-z][\w-]*)?((?:\.[\w-]+)*)(?:#([\w-]+))?$/iu.exec(parts[index])
    if (!match || (!match[1] && !match[2] && !match[3])) return false
    while (current && match[1] && current.tagName !== match[1].toLowerCase()) current = current.parentNode
    if (!current) return false
    const attrs = attributes(current)
    if (match[2].split('.').filter(Boolean).some(className => !hasClass(current, className))) return false
    if (match[3] && attrs.id !== match[3]) return false
    if (index > 0) current = current.parentNode
  }
  return true
}

function selectorSpecificity(selector) {
  const ids = (selector.match(/#[\w-]+/gu) ?? []).length
  const classes = (selector.match(/\.[\w-]+/gu) ?? []).length
  const tags = (selector.match(/(?:^|\s)[a-z][\w-]*/giu) ?? []).length
  return [ids, classes, tags]
}

function localCssDeclarations(node, rules) {
  const winners = new Map()
  const consider = (declarations, specificity, order, inline = false) => {
    for (const [property, declaration] of declarations) {
      const priority = [Number(declaration.important), Number(inline), ...specificity, order]
      const previous = winners.get(property)
      if (!previous || priority.some((value, index) => value !== previous.priority[index]
        && priority.slice(0, index).every((item, priorIndex) => item === previous.priority[priorIndex])
        && value > previous.priority[index])) {
        winners.set(property, { value: declaration.value, priority })
      }
    }
  }
  rules.forEach((rule, order) => {
    const matching = rule.selectors.filter(selector => matchesSimpleSelector(node, selector))
    for (const selector of matching) consider(rule.declarations, selectorSpecificity(selector), order)
  })
  consider(parseCssDeclarations(attributes(node).style ?? ''), [0, 0, 0], rules.length, true)
  return new Map([...winners].map(([property, item]) => [property, item.value]))
}

function computedTextStyle(node, rules) {
  const inheritable = new Set(['color', 'font-size', 'font-weight', 'font-style', 'font-family', 'line-height', 'text-align', 'text-decoration', 'text-indent'])
  const ancestors = []
  for (let current = node; current && current.tagName; current = current.parentNode) ancestors.push(current)
  const result = {}
  let fontSizePixels = 16
  let hasFontSize = false
  let semanticBold = false
  let semanticItalic = false
  for (const current of ancestors.reverse()) {
    if (['b', 'strong'].includes(current.tagName)) semanticBold = true
    if (['i', 'em'].includes(current.tagName)) semanticItalic = true
    if (['u', 'ins'].includes(current.tagName)) result['semantic-underline'] = 'underline'
    if (['s', 'del', 'strike'].includes(current.tagName)) result['semantic-strikethrough'] = 'line-through'
    if (current.tagName === 'a') {
      const href = safeHyperlink(attributes(current).href)
      if (href) result.href = href
    }
    const declarations = localCssDeclarations(current, rules)
    for (const [property, value] of declarations) {
      if (property === 'font-size') {
        const parsedPixels = cssFontSizePixels(value, fontSizePixels)
        if (parsedPixels !== undefined) { fontSizePixels = parsedPixels; hasFontSize = true }
      }
      if (current === node || inheritable.has(property)) result[property] = value
    }
  }
  const color = cssColor(result.color)
  const backgroundColor = cssColor(result['background-color'])
  const fontSize = Math.round(Math.min(72, Math.max(6, fontSizePixels * 0.75)) * 100)
  const align = ['left', 'center', 'right', 'justify'].includes(result['text-align']) ? result['text-align'] : undefined
  const fontFamily = cssFontFamily(result['font-family'])
  const lineSpacingPct = cssLineSpacingPct(result['line-height'])
  const textIndentEmu = cssTextIndentEmu(result['text-indent'])
  const spaceBeforePt = cssParagraphSpacing(result['margin-top'])
  const spaceAfterPt = cssParagraphSpacing(result['margin-bottom'])
  const leftMarginEmu = cssParagraphMarginEmu(result['margin-left'])
  const rightMarginEmu = cssParagraphMarginEmu(result['margin-right'])
  const weight = result['font-weight']
  const decoration = result['text-decoration']?.toLowerCase().split(/\s+/u) ?? []
  return {
    ...(color ? { color } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(hasFontSize ? { fontSize } : {}),
    ...(align ? { align } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(lineSpacingPct ? { lineSpacingPct } : {}),
    ...(textIndentEmu !== undefined ? { textIndentEmu } : {}),
    ...(spaceBeforePt !== undefined ? { spaceBeforePt } : {}),
    ...(spaceAfterPt !== undefined ? { spaceAfterPt } : {}),
    ...(leftMarginEmu !== undefined ? { leftMarginEmu } : {}),
    ...(rightMarginEmu !== undefined ? { rightMarginEmu } : {}),
    ...((weight === 'bold' || Number(weight) >= 600 || (weight === undefined && semanticBold)) ? { bold: true } : {}),
    ...((result['font-style'] === 'italic' || (result['font-style'] === undefined && semanticItalic)) ? { italic: true } : {}),
    ...(decoration.includes('underline') ? { underline: true } : decoration.includes('none') ? { underline: false } : result['semantic-underline'] === 'underline' ? { underline: true } : {}),
    ...(decoration.includes('line-through') ? { strikethrough: true } : decoration.includes('none') ? { strikethrough: false } : result['semantic-strikethrough'] === 'line-through' ? { strikethrough: true } : {}),
    ...(result.href ? { href: result.href } : {}),
  }
}

function safeHyperlink(value) {
  if (typeof value !== 'string' || value.length > 2048) return ''
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    for (const key of [...url.searchParams.keys()]) if (/(?:token|key|auth|session|credential|password|cookie)/iu.test(key)) url.searchParams.delete(key)
    url.hash = ''
    return url.toString()
  } catch { return '' }
}

function cssColor(value) {
  const input = String(value ?? '').trim().toLowerCase()
  const named = { black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000', gray: '808080', grey: '808080', navy: '000080' }
  if (named[input]) return named[input]
  let match = /^#([0-9a-f]{6})$/iu.exec(input)
  if (match) return match[1].toUpperCase()
  match = /^#([0-9a-f]{3})$/iu.exec(input)
  if (match) return [...match[1]].map(character => character + character).join('').toUpperCase()
  match = /^hsla?\(\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:deg)?(?:\s*,\s*|\s+)(\d+(?:\.\d+)?)%(?:\s*,\s*|\s+)(\d+(?:\.\d+)?)%(?:\s*(?:,|\/)\s*(\d+(?:\.\d+)?)\s*)?\)$/iu.exec(input)
  if (match) {
    const hueValue = Number(match[1])
    const saturation = Number(match[2]) / 100
    const lightness = Number(match[3]) / 100
    const alpha = match[4] === undefined ? 1 : Number(match[4])
    if (saturation <= 1 && lightness <= 1 && alpha === 1) {
      const hue = ((hueValue % 360) + 360) % 360 / 360
      const channel = offset => {
        const k = (offset + hue * 12) % 12
        const amplitude = saturation * Math.min(lightness, 1 - lightness)
        return Math.round((lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
      }
      return [channel(0), channel(8), channel(4)].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()
    }
  }
  match = /^rgba?\(\s*(\d+(?:\.\d+)?%?)(?:\s*,\s*|\s+)(\d+(?:\.\d+)?%?)(?:\s*,\s*|\s+)(\d+(?:\.\d+)?%?)(?:\s*(?:,|\/)\s*(\d+(?:\.\d+)?)\s*)?\)$/iu.exec(input)
  if (match && (match[4] === undefined || Number(match[4]) === 1)) {
    const channels = match.slice(1, 4).map(channel => {
      if (channel.endsWith('%')) {
        const percent = Number(channel.slice(0, -1))
        return percent <= 100 ? Math.round(percent * 255 / 100) : undefined
      }
      const value = Number(channel)
      return value <= 255 ? Math.round(value) : undefined
    })
    if (channels.every(Number.isInteger)) return channels.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()
  }
  match = /^rgb\(\s*(\d+(?:\.\d+)?%?)\s*,\s*(\d+(?:\.\d+)?%?)\s*,\s*(\d+(?:\.\d+)?%?)\s*\)$/iu.exec(input)
  if (match) {
    const channels = match.slice(1).map(channel => {
      if (channel.endsWith('%')) {
        const percent = Number(channel.slice(0, -1))
        return percent <= 100 ? Math.round(percent * 255 / 100) : undefined
      }
      const value = Number(channel)
      return value <= 255 ? Math.round(value) : undefined
    })
    if (channels.every(Number.isInteger)) return channels.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()
  }
  return undefined
}

function cssFontSizePixels(value, parentPixels) {
  const match = /^(\d+(?:\.\d+)?)(px|pt|em|rem|%)$/iu.exec(String(value ?? '').trim())
  if (!match) return undefined
  const size = Number(match[1])
  const unit = match[2].toLowerCase()
  const pixels = unit === 'px' ? size
    : unit === 'pt' ? size * 96 / 72
      : unit === 'rem' ? size * 16
        : unit === '%' ? size * parentPixels / 100
          : size * parentPixels
  return Number.isFinite(pixels) ? pixels : undefined
}
function readChart(slide, slideIndex) {
  const figure = first(slide, node => isElement(node, 'figure') && hasClass(node, 'chart'))
  if (!figure) return undefined
  const title = textContent(first(figure, node => isElement(node, 'figcaption')))
  const table = first(figure, node => isElement(node, 'table'))
  if (!title || !table) fail(`第 ${slideIndex + 1} 页图表缺少标题或可读数据表`)
  const header = first(table, node => isElement(node, 'thead'))
  const seriesNames = (header ? walk(header, node => isElement(node, 'th')) : []).slice(1).map(textContent)
  const body = first(table, node => isElement(node, 'tbody'))
  const rows = body ? walk(body, node => isElement(node, 'tr')) : []
  if (!seriesNames.length || seriesNames.length > 4 || !rows.length || rows.length > 8) {
    fail(`第 ${slideIndex + 1} 页图表超出可编辑范围（最多 8 个类别、4 个系列）`)
  }
  const categories = []
  const valuesBySeries = seriesNames.map(() => [])
  for (const row of rows) {
    const cells = children(row).filter(node => isElement(node, 'th') || isElement(node, 'td'))
    const category = textContent(cells.find(node => attributes(node).scope === 'row'))
    const values = cells.filter(node => isElement(node, 'td')).map(cell => Number(textContent(cell)))
    if (!category || values.length !== seriesNames.length || values.some(value => !Number.isFinite(value) || value < 0 || value > 1_000_000_000)) {
      fail(`第 ${slideIndex + 1} 页图表数据无效`)
    }
    categories.push(category)
    values.forEach((value, index) => valuesBySeries[index].push(value))
  }
  return { title, categories, series: seriesNames.map((name, index) => ({ name, values: valuesBySeries[index] })) }
}

function listInteger(value) {
  if (typeof value !== 'string' || !/^[+-]?\d+$/u.test(value.trim())) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}
function listItemPrefixes(nodes) {
  const lists = new Set()
  const prefixes = new Map()
  for (const node of nodes) {
    const list = node.parentNode
    if (!isElement(list, 'ol') || lists.has(list)) continue
    lists.add(list)
    const siblings = children(list).filter(child => isElement(child, 'li'))
    const listAttributes = attributes(list)
    const reversed = Object.hasOwn(listAttributes, 'reversed')
    const fallback = reversed ? siblings.length : 1
    let number = listInteger(listAttributes.start) ?? fallback
    for (const sibling of siblings) {
      const itemNumber = listInteger(attributes(sibling).value)
      if (itemNumber !== undefined) number = itemNumber
      prefixes.set(sibling, `${number}. `)
      number += reversed ? -1 : 1
    }
  }
  return prefixes
}
function listItemDepth(node) {
  let depth = 0
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (isElement(parent, 'li')) depth += 1
  }
  return depth
}

function listItemText(node) {
  return children(node)
    .filter(child => !isElement(child, 'ul') && !isElement(child, 'ol'))
    .map(textContent)
    .join('')
    .replace(/[ \t\r\f\v]+/gu, ' ')
    .replace(/\n[ \t]*/gu, '\n')
    .trim()
}

function inlineRuns(node, rules) {
  const runs = []
  const append = (text, style) => {
    if (!text) return
    const previous = runs.at(-1)
    if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) previous.text += text
    else runs.push({ text, style })
  }
  const visit = current => {
    if (current.nodeName === '#text') {
      append(current.value ?? '', computedTextStyle(current.parentNode, rules))
      return
    }
    if (isElement(current, 'br')) { append('\n', computedTextStyle(current.parentNode, rules)); return }
    if (isElement(current, 'ul') || isElement(current, 'ol')) return
    for (const child of children(current)) visit(child)
  }
  visit(node)
  const normalized = runs.map(run => ({ ...run, text: run.text.replace(/[ \t\r\f\v]+/gu, ' ').replace(/\n[ \t]*/gu, '\n') }))
  const combined = normalized.map(run => run.text).join('').trim()
  if (!combined) return []
  let leading = true
  let trailingIndex = normalized.length - 1
  while (trailingIndex >= 0 && !normalized[trailingIndex].text) trailingIndex -= 1
  return normalized.flatMap((run, index) => {
    let value = run.text
    if (leading) { value = value.replace(/^\s+/u, ''); if (value) leading = false }
    if (index === trailingIndex) value = value.replace(/\s+$/u, '')
    return value ? [{ text: value, style: run.style }] : []
  })
}

function readSlide(slide, index, rules, bodyBackgroundColor) {
  const heading = first(slide, node => /^h[1-6]$/u.test(node.tagName))
  const title = textContent(heading)
  if (!title) fail(`第 ${index + 1} 页缺少标题`)
  if (title.length > 200) fail(`第 ${index + 1} 页标题超过 200 字符`)
  const body = first(slide, node => isElement(node, 'main')) ?? slide
  const blocks = walk(body, node => ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(node.tagName))
    .filter(node => node !== heading && (!hasSemanticTextParent(node, body) || node.tagName === 'li'))
    .map(node => ({ node, text: node.tagName === 'li' ? listItemText(node) : textContent(node), kind: node.tagName }))
    .filter(item => item.text)
  const listPrefixes = listItemPrefixes(blocks.filter(({ kind }) => kind === 'li').map(({ node }) => node))
  const content = blocks.map(({ node, kind, text }) => kind === 'li' ? `${'  '.repeat(listItemDepth(node))}${listPrefixes.get(node) ?? '- '}${text}` : kind === 'blockquote' ? `引用：${text}` : text).join(String.fromCharCode(10))
  const paragraphRuns = blocks.flatMap(({ node, kind, text }) => {
    const prefix = kind === 'li' ? `${'  '.repeat(listItemDepth(node))}${listPrefixes.get(node) ?? '- '}` : kind === 'blockquote' ? '引用：' : ''
    const runs = inlineRuns(node, rules)
    if (prefix) runs.unshift({ text: prefix, style: {} })
    const lineRuns = [[]]
    for (const run of runs) {
      const pieces = run.text.split('\n')
      pieces.forEach((piece, index) => {
        if (piece) lineRuns.at(-1).push({ text: piece, style: run.style })
        if (index < pieces.length - 1) lineRuns.push([])
      })
    }
    return lineRuns
  })
  const paragraphStyles = blocks.flatMap(({ node, kind, text }) => {
    const blockText = kind === 'li' ? `${'  '.repeat(listItemDepth(node))}${listPrefixes.get(node) ?? '- '}${text}` : kind === 'blockquote' ? `引用：${text}` : text
    return blockText.split(/\r?\n/u).map(() => computedTextStyle(node, rules))
  })
  const images = walk(slide, node => isElement(node, 'img'))
  if (images.length > 1) fail(`第 ${index + 1} 页有多张图片；请在导入后逐页补充配图`)
  let imageDataUrl
  if (images.length) {
    imageDataUrl = attributes(images[0]).src ?? ''
    if (imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/u.test(imageDataUrl)) {
      fail(`第 ${index + 1} 页配图必须是 PNG/JPEG 内嵌数据`)
    }
  }
  const chart = readChart(slide, index)
  const titleStyle = computedTextStyle(heading, rules)
  const bodyStyle = computedTextStyle(blocks.find(({ kind }) => ['p', 'li', 'blockquote'].includes(kind))?.node ?? heading, rules)
  const backgroundColor = computedTextStyle(slide, rules).backgroundColor ?? bodyBackgroundColor
  const style = {
    ...(backgroundColor ? { backgroundColor } : {}),
    title: titleStyle,
    body: bodyStyle,
  }
  return { title, content, ...(paragraphStyles.some(item => JSON.stringify(item) !== JSON.stringify(bodyStyle)) ? { paragraphStyles } : {}), ...(paragraphRuns.some(paragraph => paragraph.some(run => Object.keys(run.style).length && JSON.stringify(run.style) !== JSON.stringify(bodyStyle))) ? { paragraphRuns } : {}), ...(imageDataUrl ? { imageDataUrl } : {}), ...(chart ? { chart } : {}), style }
}

/** Convert static HTML slide structure to the plugin's editable slide model. */
export function importPptHtmlPresentation(html) {
  if (typeof html !== 'string' || !html.trim()) fail('请选择非空 HTML 演示文件')
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) fail('HTML 演示超过 10 MiB 上限', 'budget_exceeded')
  const document = parse(html)
  const allElements = walk(document, node => typeof node.tagName === 'string')
  if (allElements.some(node => ACTIVE_TAGS.has(node.tagName)
    || (node.tagName === 'svg' && (!insideChart(node) || [...node.childNodes ?? []].some(child => child.tagName && !CHART_SVG_TAGS.has(child.tagName))))
    || Object.keys(attributes(node)).some(name => name.startsWith('on')))) {
    fail('HTML 含脚本或活动内容，已拒绝导入')
  }
  if (allElements.some(node => {
    const attrs = attributes(node)
    if (node.tagName === 'link' && /stylesheet/iu.test(attrs.rel ?? '')) return true
    if (node.namespaceURI?.includes('svg') && !CHART_SVG_TAGS.has(node.tagName)) return true
    return Object.entries(attrs).some(([name, value]) => {
      if (name === 'href') return value !== '' && !value.startsWith('#') && !(node.tagName === 'a' && safeHyperlink(value))
      if (EXTERNAL_ATTRIBUTES.has(name)) return !(name === 'src' && /^data:image\/(?:png|jpeg);base64,/iu.test(value))
      return name === 'style' && /url\s*\(|@import|expression\s*\(/iu.test(value)
    })
  }) || /<style\b[^>]*>[\s\S]*?(?:@import\b|url\s*\(|expression\s*\()[\s\S]*?<\/style\s*>/iu.test(html)) {
    fail('HTML 含外部链接、资源或可执行 CSS 引用，已拒绝导入')
  }
  const rules = parseCssRules(document)
  const body = first(document, node => isElement(node, 'body'))
  const bodyBackgroundColor = body ? computedTextStyle(body, rules).backgroundColor : undefined
  const candidates = walk(document, isSlide)
  const slides = candidates.filter(node => !candidates.some(parent => parent !== node && contains(parent, node)))
  if (!slides.length || slides.length > MAX_SLIDES) fail('HTML 演示需要 1 至 100 页', slides.length > MAX_SLIDES ? 'budget_exceeded' : 'invalid_input')
  const title = textContent(first(document, node => isElement(node, 'title'))).slice(0, 200)
  const parsedSlides = slides.map((slide, index) => readSlide(slide, index, rules, bodyBackgroundColor))
  const totalText = parsedSlides.reduce((total, slide) => total + slide.title.length + slide.content.length, 0)
  if (totalText > MAX_TEXT_LENGTH) fail('HTML 演示文本超过 200,000 字符上限', 'budget_exceeded')
  return {
    title,
    slides: parsedSlides,
    limitations: ['已映射白名单中的颜色、字号、字体族、行距、段落边距、首行缩进、粗体、斜体和对齐；副标题层级会并入正文，复杂 CSS 版式、字体替换和动画不会转换为 PowerPoint 样式。'],
  }
}

function hasSemanticTextParent(node, boundary) {
  for (let parent = node.parentNode; parent && parent !== boundary; parent = parent.parentNode) {
    if (isElement(parent, 'p') || isElement(parent, 'li') || isElement(parent, 'blockquote')) return true
  }
  return false
}

function contains(parent, target) {
  for (const child of children(parent)) {
    if (child === target || contains(child, target)) return true
  }
  return false
}






