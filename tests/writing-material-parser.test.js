'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createWritingMaterialParser } = require('../server/writing-material-parser.js');
const yazl = require('yazl');
const { once } = require('node:events');

function makePng(width = 2, height = 3) {
  function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, content) {
    const payload = Buffer.concat([Buffer.from(type), content]);
    const result = Buffer.alloc(content.length + 12);
    result.writeUInt32BE(content.length, 0);
    payload.copy(result, 4);
    result.writeUInt32BE(crc32(payload), content.length + 8);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

function makePdf(text = 'synthetic page text') {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

function makeScannedPdf() {
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(720, 220);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 720, 220);
  context.fillStyle = '#000';
  context.font = 'bold 56px Arial';
  context.fillText('SCAN PAGE OCR', 36, 140);
  const image = canvas.toBuffer('image/jpeg', 90);
  const pageStream = Buffer.from('q\n720 0 0 220 0 0 cm\n/Im0 Do\nQ');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 220] /Resources << /XObject << /Im0 6 0 R >> >> /Contents 5 0 R >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.concat([Buffer.from(`<< /Length ${pageStream.length} >>\nstream\n`), pageStream, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 720 /Height 220 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from('\nendstream')])
  ];
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  let length = chunks[0].length;
  for (let index = 0; index < objects.length; index++) {
    offsets.push(length);
    const prefix = Buffer.from(`${index + 1} 0 obj\n`);
    const suffix = Buffer.from('\nendobj\n');
    chunks.push(prefix, objects[index], suffix);
    length += prefix.length + objects[index].length + suffix.length;
  }
  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

async function makeDocx() {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from('<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>合成段落</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格单元格</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'), 'word/document.xml');
  const chunks = [];
  zip.outputStream.on('data', chunk => chunks.push(chunk));
  zip.end();
  await once(zip.outputStream, 'end');
  return Buffer.concat(chunks);
}

async function makeStyledDocx() {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from('<w:styles xmlns:w="urn:w"><w:style w:styleId="Heading1" w:type="paragraph"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:styleId="CustomTitle" w:type="paragraph"><w:name w:val="自定义章节"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>'), 'word/styles.xml');
  zip.addBuffer(Buffer.from('<w:document xmlns:w="urn:w"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标准标题</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="CustomTitle"/></w:pPr><w:r><w:t>自定义标题</w:t></w:r></w:p><w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>直接大纲标题</w:t></w:r></w:p><w:p><w:r><w:t>普通段落</w:t></w:r></w:p></w:body></w:document>'), 'word/document.xml');
  const chunks = [];
  zip.outputStream.on('data', chunk => chunks.push(chunk));
  zip.end();
  await once(zip.outputStream, 'end');
  return Buffer.concat(chunks);
}

function parserOptions(overrides = {}) {
  return {
    pdfjs: { getDocument: () => ({ promise: Promise.resolve({ numPages: 2, getPage: async pageNumber => ({ getTextContent: async () => ({ items: [{ str: `页${pageNumber}文字`, transform: [1, 0, 0, 1, 20, 700] }] }) }), destroy: async () => {} }) }) },
    ...overrides
  };
}

test('拒绝路径输入，只接受 Buffer 或 Uint8Array', async () => {
  const parser = createWritingMaterialParser(parserOptions());
  for (const input of [{ path: 'C:/private/a.pdf', mimeType: 'application/pdf' }, { buffer: 'text', mimeType: 'text/plain' }]) {
    const result = await parser.parse(input);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_INPUT');
    assert.doesNotMatch(JSON.stringify(result), /C:\/private|stack|path/i);
  }
});

test('PDF 按页抽取并保留页码和有界字符范围', async () => {
  const parser = createWritingMaterialParser(parserOptions());
  const result = await parser.parse({ buffer: makePdf(), mimeType: 'application/pdf' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.pages.map(page => page.page), [1, 2]);
  assert.match(result.text, /页1文字/);
  assert.match(result.text, /页2文字/);
  assert.ok(result.text.length <= result.characterCount);
  const limited = createWritingMaterialParser(parserOptions({ limits: { maxOutputChars: 4 } }));
  const limitedResult = await limited.parse({ buffer: makePdf(), mimeType: 'application/pdf' });
  assert.equal(limitedResult.text.length, 4);
  assert.equal(limitedResult.truncated, true);
  assert.equal(limitedResult.pages[0].text.length, 4);
});

test('默认 PDF.js 读取器可离线解析合成 PDF', async () => {
  const parser = createWritingMaterialParser();
  const result = await parser.parse({ buffer: makePdf(), mimeType: 'application/pdf' });
  assert.equal(result.ok, true);
  assert.match(result.text, /synthetic page text/);
  assert.equal(result.pages[0].page, 1);
});

test('PDF 按文本基线换行保留页内章节标题边界', async () => {
  const pdfjs = { getDocument: () => ({ promise: Promise.resolve({ numPages: 1,
    getPage: async () => ({ getTextContent: async () => ({ items: [
      { str: '第一章 设备安装', transform: [1, 0, 0, 1, 20, 700] },
      { str: '安装前确认电源关闭。', transform: [1, 0, 0, 1, 20, 660] }
    ] }), cleanup() {} }), destroy: async () => {} }) }) };
  const result = await createWritingMaterialParser({ pdfjs }).parse({ buffer: makePdf(), mimeType: 'application/pdf' });
  assert.equal(result.pages[0].text, '第一章 设备安装\n安装前确认电源关闭。');
});

test('扫描版 PDF 逐页渲染后本机 OCR 并保留 OCR 页来源和未核验状态', async () => {
  const recognized = [];
  const pdfjs = { getDocument: () => ({ promise: Promise.resolve({ numPages: 1,
    getPage: async () => ({ getTextContent: async () => ({ items: [] }),
      getViewport: ({ scale }) => ({ width: 120 * scale, height: 160 * scale }),
      render: () => ({ promise: Promise.resolve() }), cleanup() {} }), destroy: async () => {} }) }) };
  const parser = createWritingMaterialParser({ pdfjs, canvas: { createCanvas: () => ({ getContext: () => ({}), toBuffer: () => Buffer.from('rendered page') }) },
    createOcrWorker: async () => ({ recognize: async image => { recognized.push(image.toString()); return { data: { text: '合成扫描页', confidence: 87 } }; }, terminate: async () => {} }) });
  const result = await parser.parse({ buffer: makePdf(), mimeType: 'application/pdf' });
  assert.equal(result.ok, true);
  assert.equal(result.pages[0].method, 'pdf-ocr');
  assert.equal(result.pageCount, 1);
  assert.match(result.text, /合成扫描页/);
  assert.equal(result.confidence, 87);
  assert.match(result.warnings.join(''), /本机 OCR/);
  assert.deepEqual(recognized, ['rendered page']);
});

test('真实 PDF.js 与本机 Canvas/OCR 可从合成扫描 PDF 识别文字', async () => {
  const parser = createWritingMaterialParser({ limits: { maxDurationMs: 30_000 } });
  const result = await parser.parse({ buffer: makeScannedPdf(), mimeType: 'application/pdf' });
  assert.equal(result.ok, true, JSON.stringify(result.error || {}));
  assert.match(result.text, /SCAN PAGE OCR/i);
  assert.equal(result.pages[0].method, 'pdf-ocr');
  assert.equal(result.pageCount, 1);
  assert.equal(result.warnings.length, 1);
});

test('DOCX 从合成 ZIP 文档抽取段落和表格文本，不读取外部关系', async () => {
  const parser = createWritingMaterialParser(parserOptions());
  const result = await parser.parse({ buffer: await makeDocx(), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(result.ok, true);
  assert.match(result.text, /合成段落/);
  assert.match(result.text, /表格单元格/);
  assert.equal(result.format, 'docx');
});

test('DOCX styles.xml 标题映射和段落 outlineLvl 保留有序段落级别', async () => {
  const parser = createWritingMaterialParser(parserOptions());
  const result = await parser.parse({ buffer: await makeStyledDocx(), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.paragraphs.map(item => [item.text, item.headingLevel]), [
    ['标准标题', 1], ['自定义标题', 2], ['直接大纲标题', 3], ['普通段落', null]
  ]);
  assert.equal(result.truncated, false);
});

test('DOCX 超过解析上限时段落和文本共用截断边界并标记 truncated', async () => {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(`<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>${'甲'.repeat(12)}</w:t></w:r></w:p><w:p><w:r><w:t>${'乙'.repeat(12)}</w:t></w:r></w:p></w:body></w:document>`), 'word/document.xml');
  const chunks = [];
  zip.outputStream.on('data', chunk => chunks.push(chunk));
  zip.end();
  await once(zip.outputStream, 'end');
  const parser = createWritingMaterialParser(parserOptions({ limits: { maxOutputChars: 15 } }));
  const result = await parser.parse({ buffer: Buffer.concat(chunks), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(result.text.length, 15);
  assert.equal(result.truncated, true);
  assert.equal(result.paragraphs.map(item => item.text).join('\n'), result.text);
});

test('图片 OCR 注入 worker，限制尺寸和识别字符且标明来源', async () => {
  let recognized;
  const parser = createWritingMaterialParser(parserOptions({
    createOcrWorker: async languages => {
      assert.deepEqual(languages, ['chi_sim', 'eng']);
      return { recognize: async image => { recognized = image; return { data: { text: '合成 OCR 文本' } }; }, terminate: async () => {} };
    },
    limits: { maxImagePixels: 20, maxOutputChars: 7 }
  }));
  const result = await parser.parse({ buffer: makePng(), mimeType: 'image/png' });
  assert.equal(result.ok, true);
  assert.deepEqual([...recognized.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(result.text, '合成 OCR');
  assert.deepEqual(result.warnings, ['OCR 结果可能有误，需人工核对。']);
});

test('限制 PDF 页数、输入大小、DOCX 解压总量和压缩比例', async () => {
  const pdfjs = { getDocument: () => ({ promise: Promise.resolve({ numPages: 3, destroy: async () => {} }) }) };
  const pageLimited = createWritingMaterialParser(parserOptions({ pdfjs, limits: { maxPdfPages: 2 } }));
  assert.equal((await pageLimited.parse({ buffer: makePdf(), mimeType: 'application/pdf' })).error.code, 'LIMIT_EXCEEDED');
  const byteLimited = createWritingMaterialParser(parserOptions({ limits: { maxInputBytes: 8 } }));
  assert.equal((await byteLimited.parse({ buffer: makePdf(), mimeType: 'application/pdf' })).error.code, 'LIMIT_EXCEEDED');
  const docx = await makeDocx();
  const zipLimited = createWritingMaterialParser(parserOptions({ limits: { maxExpandedBytes: 10 } }));
  assert.equal((await zipLimited.parse({ buffer: docx, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).error.code, 'LIMIT_EXCEEDED');
  const ratioLimited = createWritingMaterialParser(parserOptions({ limits: { maxCompressionRatio: 1 } }));
  assert.equal((await ratioLimited.parse({ buffer: docx, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).error.code, 'LIMIT_EXCEEDED');
  const imageLimited = createWritingMaterialParser(parserOptions({ limits: { maxImagePixels: 20 } }));
  assert.equal((await imageLimited.parse({ buffer: makePng(5, 5), mimeType: 'image/png' })).error.code, 'LIMIT_EXCEEDED');
});

test('损坏 PDF、DOCX 和图片返回无路径、全文或堆栈的稳定错误', async () => {
  const parser = createWritingMaterialParser(parserOptions());
  for (const [buffer, mimeType] of [[Buffer.from('bad'), 'application/pdf'], [Buffer.from('bad'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], [Buffer.from('bad'), 'image/png']]) {
    const result = await parser.parse({ buffer, mimeType });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /stack|node_modules|bad/);
  }
  const corruptPng = makePng();
  corruptPng[corruptPng.length - 5] ^= 0xff;
  assert.equal((await parser.parse({ buffer: corruptPng, mimeType: 'image/png' })).error.code, 'PARSE_FAILED');
});

test('支持读取器注入，并将异常映射为不泄漏详情的错误', async () => {
  const parser = createWritingMaterialParser(parserOptions({ pdfjs: { getDocument: () => { throw new Error('C:/secret/full text'); } } }));
  const result = await parser.parse({ buffer: makePdf(), mimeType: 'application/pdf' });
  assert.equal(result.error.code, 'PARSE_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /secret|full text|stack/);
});

test('接受预取消信号，且取消后停止 OCR/解析循环', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const parser = createWritingMaterialParser(parserOptions({ createOcrWorker: async () => { calls++; return { recognize: async () => ({ data: { text: 'x' } }), terminate: async () => {} }; } }));
  const result = await parser.parse({ buffer: makePng(), mimeType: 'image/png', signal: controller.signal });
  assert.equal(result.error.code, 'CANCELLED');
  assert.equal(calls, 0);
});

test('解析处理中收到取消信号会尽快结束并清理 OCR worker', async () => {
  const controller = new AbortController();
  let terminated = 0;
  const parser = createWritingMaterialParser(parserOptions({
    createOcrWorker: async () => ({
      recognize: () => new Promise(() => {}),
      terminate: async () => { terminated++; }
    })
  }));
  const pending = parser.parse({ buffer: makePng(), mimeType: 'image/png', signal: controller.signal });
  setImmediate(() => controller.abort());
  const result = await pending;
  assert.equal(result.error.code, 'CANCELLED');
  assert.equal(terminated, 1);
});
