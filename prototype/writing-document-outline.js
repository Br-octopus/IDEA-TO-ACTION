(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ForwardStepWritingDocumentOutline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

const MAX_ITEMS = 200;

function headingFromNumberedLine(line) {
  const chapter = line.match(/^(第[一二三四五六七八九十百零〇\d]+[章节篇部卷])\s*(.+)$/);
  if (chapter) return { title: line.trim(), level: 1 };
  const dotted = line.match(/^((?:\d+\.)+\d+)[、.．]?\s+(.+)$/);
  if (dotted) return { title: line.trim(), level: Math.min(6, dotted[1].split('.').length) };
  const numbered = line.match(/^([0-9一二三四五六七八九十]+)[、.．]\s*(.+)$/);
  return numbered ? { title: line.trim(), level: 1 } : null;
}

function outlineRows(format, text, segments) {
  if (Array.isArray(segments) && segments.length) {
    return segments.flatMap(segment => String(segment?.text || '').split(/\r?\n/).map(line => ({
      line: line.trim(), locator: segment.locator || null, headingLevel: segment.headingLevel
    })).filter(row => row.line));
  }
  return String(text || '').split(/\r?\n/).map(line => ({ line: line.trim(), locator: null, headingLevel: null })).filter(row => row.line);
}

function extractWritingOutline({ format = '', text = '', segments = [], truncated = false } = {}) {
  const normalizedFormat = String(format).toLowerCase();
  const rows = outlineRows(normalizedFormat, text, segments);
  const items = [];
  let count = 0;
  for (const row of rows) {
    let heading = null;
    const markdown = ['md', 'markdown', 'txt', 'text/plain'].includes(normalizedFormat)
      ? row.line.match(/^(#{1,6})\s+(.+?)\s*#*$/) : null;
    if (markdown) heading = { title: markdown[2].trim(), level: markdown[1].length };
    else if (normalizedFormat === 'docx' && Number.isInteger(row.headingLevel) && row.headingLevel >= 1 && row.headingLevel <= 9) {
      heading = { title: row.line, level: Math.min(6, row.headingLevel) };
    } else heading = headingFromNumberedLine(row.line);
    if (!heading) continue;
    count++;
    if (items.length < MAX_ITEMS) items.push({ id: `section-${String(count).padStart(3, '0')}`, title: heading.title, level: heading.level, locator: row.locator });
  }
  return { items, complete: !truncated && count <= MAX_ITEMS && items.length > 0 };
}

  return { extractWritingOutline };
});
