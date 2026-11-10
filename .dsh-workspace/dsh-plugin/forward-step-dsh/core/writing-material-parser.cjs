'use strict';

const MIME_TYPES = Object.freeze({
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image'
});
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DEFAULT_LIMITS = Object.freeze({
  maxInputBytes: 20 * 1024 * 1024,
  maxPdfPages: 100,
  maxPdfOcrPages: 10,
  maxPdfOcrPixels: 12_000_000,
  maxExpandedBytes: 30 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxImagePixels: 20_000_000,
  maxOutputChars: 30_000,
  maxDurationMs: 30_000
});
const ERRORS = Object.freeze({
  INVALID_INPUT: '输入格式不受支持。',
  LIMIT_EXCEEDED: '材料超过本地解析限制。',
  CANCELLED: '解析已取消。',
  PARSE_FAILED: '材料无法解析，请检查文件是否完整。',
  OCR_UNAVAILABLE: '本地 OCR 暂不可用。'
});

class ParserError extends Error {
  constructor(code) {
    super(ERRORS[code] || ERRORS.PARSE_FAILED);
    this.code = code;
  }
}

function safeFailure(code) {
  return { ok: false, error: { code, message: ERRORS[code] || ERRORS.PARSE_FAILED } };
}

function decodeXmlText(value) {
  return value.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (match, numeric, named) => {
    if (numeric) {
      const number = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10);
      return Number.isFinite(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[named.toLowerCase()];
  });
}

function extractDocxText(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ParserError('PARSE_FAILED');
  const texts = [];
  const tokenPattern = /<\/w:p\s*>|<w:t\b[^>]*>([\s\S]*?)<\/w:t\s*>/gi;
  let match;
  let lastParagraphHadText = false;
  while ((match = tokenPattern.exec(xml))) {
    if (match[0].startsWith('</')) {
      if (lastParagraphHadText) texts.push('\n');
      lastParagraphHadText = false;
    } else {
      texts.push(decodeXmlText(match[1]));
      lastParagraphHadText = true;
    }
  }
  return texts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function xmlAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`(?:^|\\s)w:${escaped}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || '';
}

function extractDocxParagraphs(documentXml, stylesXml = '') {
  if (/<!DOCTYPE|<!ENTITY/i.test(stylesXml)) throw new ParserError('PARSE_FAILED');
  const styles = new Map();
  const stylePattern = /<w:style\b([^>]*)>([\s\S]*?)<\/w:style\s*>/gi;
  let styleMatch;
  while ((styleMatch = stylePattern.exec(stylesXml))) {
    const styleId = xmlAttribute(styleMatch[1], 'styleId');
    if (!styleId) continue;
    const nameTag = styleMatch[2].match(/<w:name\b[^>]*\/?\s*>/i)?.[0] || '';
    const outlineTag = styleMatch[2].match(/<w:outlineLvl\b[^>]*\/?\s*>/i)?.[0] || '';
    const outlineValue = xmlAttribute(outlineTag, 'val');
    styles.set(styleId, {
      name: decodeXmlText(xmlAttribute(nameTag, 'val')),
      level: /^\d+$/.test(outlineValue) ? Number(outlineValue) + 1 : null
    });
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(documentXml)) throw new ParserError('PARSE_FAILED');
  const paragraphs = [];
  const paragraphPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p\s*>/gi;
  let paragraphMatch;
  while ((paragraphMatch = paragraphPattern.exec(documentXml))) {
    const content = paragraphMatch[1];
    const text = [...content.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t\s*>/gi)].map(match => decodeXmlText(match[1])).join('').trim();
    if (!text) continue;
    const properties = content.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr\s*>/i)?.[1] || '';
    const styleTag = properties.match(/<w:pStyle\b[^>]*\/?\s*>/i)?.[0] || '';
    const styleId = xmlAttribute(styleTag, 'val');
    const style = styles.get(styleId);
    const directOutlineTag = properties.match(/<w:outlineLvl\b[^>]*\/?\s*>/i)?.[0] || '';
    const directOutline = xmlAttribute(directOutlineTag, 'val');
    const namedHeading = (style?.name || styleId).match(/heading\s*([1-9])/i)?.[1];
    const headingLevel = /^\d+$/.test(directOutline) ? Number(directOutline) + 1
      : style?.level || (namedHeading ? Number(namedHeading) : null);
    paragraphs.push({ text, headingLevel });
  }
  return paragraphs;
}

function boundParagraphs(paragraphs, maxChars) {
  let used = 0;
  let truncated = false;
  const bounded = [];
  for (const paragraph of paragraphs) {
    const separatorLength = bounded.length ? 1 : 0;
    const available = Math.max(0, maxChars - used - separatorLength);
    if (available === 0) { truncated = true; break; }
    const text = paragraph.text.slice(0, available);
    bounded.push({ ...paragraph, text });
    used += separatorLength + text.length;
    if (text.length < paragraph.text.length) { truncated = true; break; }
  }
  return { paragraphs: bounded, text: bounded.map(item => item.text).join('\n'), truncated };
}

function imageDimensions(buffer, mimeType) {
  if (mimeType === 'image/png' && buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mimeType === 'image/jpeg' && buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  if (mimeType === 'image/webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buffer.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (kind === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (kind === 'VP8L' && buffer[20] === 0x2f) {
      return { width: 1 + buffer[21] + ((buffer[22] & 0x3f) << 8), height: 1 + (buffer[22] >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10) };
    }
  }
  return null;
}

function isValidPng(buffer) {
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) return false;
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (!sawHeader && (type !== 'IHDR' || length !== 13)) return false;
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(buffer.subarray(offset + 4, offset + 8 + length));
    if (expectedCrc !== actualCrc) return false;
    if (type === 'IHDR') sawHeader = true;
    if (type === 'IDAT') sawData = true;
    offset = end;
    if (type === 'IEND') return length === 0 && sawHeader && sawData && offset === buffer.length;
  }
  return false;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createWritingMaterialParser(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const pdfjs = options.pdfjs || null;
  const yauzl = options.yauzl || require('yauzl');
  const createOcrWorker = options.createOcrWorker || null;
  const canvasModule = options.canvas || null;
  const pdfModuleLoader = options.loadPdfjs || (() => import('pdfjs-dist/legacy/build/pdf.mjs'));

  function checkCancelled(signal) {
    if (signal?.aborted) throw new ParserError('CANCELLED');
  }

  function collectZip(buffer, signal) {
    return new Promise((resolve, reject) => {
      const entries = new Map();
      let expanded = 0;
      let totalEntries = 0;
      let settled = false;
      const onAbort = () => fail('CANCELLED');
      const fail = code => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        try { zip?.close(); } catch {}
        reject(new ParserError(code));
      };
      let zip;
      try {
        yauzl.fromBuffer(buffer, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (error, opened) => {
          if (error || !opened) return reject(new ParserError('PARSE_FAILED'));
          zip = opened;
          zip.on('error', () => fail('PARSE_FAILED'));
          zip.on('entry', entry => {
            if (signal?.aborted) return fail('CANCELLED');
            totalEntries++;
            if (totalEntries > 2000 || entry.fileName.startsWith('/') || entry.fileName.includes('\\') || entry.fileName.split('/').includes('..')) return fail('LIMIT_EXCEEDED');
            if (/vbaProject\.bin$/i.test(entry.fileName)) return fail('PARSE_FAILED');
            if (/\.rels$/i.test(entry.fileName) && /TargetMode\s*=\s*["']External["']/i.test(entries.get(entry.fileName) || '')) return fail('PARSE_FAILED');
            expanded += entry.uncompressedSize;
            if (expanded > limits.maxExpandedBytes || (entry.uncompressedSize > 0 && entry.uncompressedSize / Math.max(entry.compressedSize, 1) > limits.maxCompressionRatio)) return fail('LIMIT_EXCEEDED');
            if (entry.fileName === 'word/document.xml' || entry.fileName === 'word/styles.xml' || entry.fileName === 'word/_rels/document.xml.rels' || entry.fileName === '[Content_Types].xml') {
              zip.openReadStream(entry, (streamError, stream) => {
                if (streamError || !stream) return fail('PARSE_FAILED');
                const chunks = [];
                let size = 0;
                stream.on('data', chunk => {
                  size += chunk.length;
                  if (size > limits.maxExpandedBytes) return fail('LIMIT_EXCEEDED');
                  chunks.push(chunk);
                });
                stream.on('error', () => fail('PARSE_FAILED'));
                stream.on('end', () => {
                  entries.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
                  if (!settled) zip.readEntry();
                });
              });
            } else {
              zip.readEntry();
            }
          });
          zip.on('end', () => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            resolve(entries);
          });
          signal?.addEventListener('abort', onAbort, { once: true });
          if (signal?.aborted) return fail('CANCELLED');
          zip.readEntry();
        });
      } catch {
        reject(new ParserError('PARSE_FAILED'));
      }
    });
  }

  async function parsePdf(buffer, signal) {
    const module = pdfjs || await pdfModuleLoader();
    checkCancelled(signal);
    const task = module.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
    const abortTask = () => { try { task.destroy?.(); } catch {} };
    signal?.addEventListener('abort', abortTask, { once: true });
    let document;
    let ocrSession;
    let ocrPages = 0;
    let confidenceTotal = 0;
    try {
      document = await task.promise;
      checkCancelled(signal);
      if (!Number.isInteger(document.numPages) || document.numPages < 1) throw new ParserError('PARSE_FAILED');
      if (document.numPages > limits.maxPdfPages) throw new ParserError('LIMIT_EXCEEDED');
      const pages = [];
      let text = '';
      let truncated = false;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        checkCancelled(signal);
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        let previousY = null;
        let pageText = content.items.reduce((joined, item) => {
          const value = String(item.str || '').trim();
          if (!value) return joined;
          const y = Number.isFinite(item.transform?.[5]) ? item.transform[5] : null;
          const separator = !joined ? '' : y !== null && previousY !== null && Math.abs(y - previousY) > 2 ? '\n' : ' ';
          previousY = y;
          return joined + separator + value;
        }, '').trim();
        let extractionMethod = 'pdf-text';
        if (!pageText) {
          ocrPages++;
          if (ocrPages > limits.maxPdfOcrPages) throw new ParserError('LIMIT_EXCEEDED');
          checkCancelled(signal);
          const canvasApi = canvasModule || require('@napi-rs/canvas');
          const initialViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(1.5, Math.sqrt(limits.maxPdfOcrPixels / Math.max(1, initialViewport.width * initialViewport.height)));
          const viewport = page.getViewport({ scale });
          const width = Math.max(1, Math.floor(viewport.width));
          const height = Math.max(1, Math.floor(viewport.height));
          if (width * height > limits.maxPdfOcrPixels) throw new ParserError('LIMIT_EXCEEDED');
          ocrSession ||= await createOcrSession(signal);
          const canvas = canvasApi.createCanvas(width, height);
          const renderTask = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
          const onAbortRender = () => { try { renderTask.cancel?.(); } catch {} };
          signal?.addEventListener('abort', onAbortRender, { once: true });
          let ocr;
          try {
            await renderTask.promise;
            checkCancelled(signal);
            ocr = await ocrSession.recognize(canvas.toBuffer('image/png'));
          } finally {
            signal?.removeEventListener('abort', onAbortRender);
            canvas.width = 0;
            canvas.height = 0;
          }
          pageText = String(ocr.data?.text || '').trim();
          extractionMethod = 'pdf-ocr';
          if (Number.isFinite(ocr.data?.confidence)) confidenceTotal += Math.max(0, Math.min(100, ocr.data.confidence));
        }
        const separator = text ? '\n' : '';
        const start = text.length + separator.length;
        const remaining = Math.max(0, limits.maxOutputChars - start);
        const bounded = pageText.slice(0, remaining);
        if (bounded) {
          pages.push({ page: pageNumber, start, end: start + bounded.length, text: bounded, method: extractionMethod });
          text += `${separator}${bounded}`;
        }
        page.cleanup?.();
        if (pageText.length > bounded.length || text.length >= limits.maxOutputChars && pageNumber < document.numPages) truncated = true;
        if (text.length >= limits.maxOutputChars) break;
      }
      const usedOcr = ocrPages > 0;
      const warnings = usedOcr ? ['扫描页通过本机 OCR 识别，结果可能有误；手写、公式和版面结构需人工核对。'] : [];
      return { format: 'pdf', text, characterCount: text.length, pageCount: document.numPages, pages, truncated, warnings,
        confidence: ocrPages ? confidenceTotal / ocrPages : null, usedOcr };
    } finally {
      signal?.removeEventListener('abort', abortTask);
      await ocrSession?.close();
      try { await (document?.destroy?.() || task.destroy?.()); } catch {}
    }
  }

  async function parseDocx(buffer, signal) {
    const entries = await collectZip(buffer, signal);
    checkCancelled(signal);
    if (!entries.has('word/document.xml')) throw new ParserError('PARSE_FAILED');
    const relationships = entries.get('word/_rels/document.xml.rels') || '';
    if (/TargetMode\s*=\s*["']External["']/i.test(relationships)) throw new ParserError('PARSE_FAILED');
    const types = entries.get('[Content_Types].xml') || '';
    if (/macroEnabled|vbaProject/i.test(types)) throw new ParserError('PARSE_FAILED');
    const paragraphs = extractDocxParagraphs(entries.get('word/document.xml'), entries.get('word/styles.xml') || '');
    const bounded = boundParagraphs(paragraphs, limits.maxOutputChars);
    return { format: 'docx', text: bounded.text, characterCount: bounded.text.length, paragraphs: bounded.paragraphs, truncated: bounded.truncated, pages: [] };
  }

  async function parseImage(buffer, mimeType, signal) {
    let dimensions = imageDimensions(buffer, mimeType);
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw new ParserError('PARSE_FAILED');
    if (dimensions.width * dimensions.height > limits.maxImagePixels) throw new ParserError('LIMIT_EXCEEDED');
    if (mimeType === 'image/png' && !isValidPng(buffer)) throw new ParserError('PARSE_FAILED');
    checkCancelled(signal);
    let normalizedImage;
    let imageCanvas;
    try {
      const canvasApi = canvasModule || require('@napi-rs/canvas');
      const image = await canvasApi.loadImage(buffer);
      dimensions = { width: image.width, height: image.height };
      if (!dimensions.width || !dimensions.height) throw new ParserError('PARSE_FAILED');
      if (dimensions.width * dimensions.height > limits.maxImagePixels) throw new ParserError('LIMIT_EXCEEDED');
      imageCanvas = canvasApi.createCanvas(dimensions.width, dimensions.height);
      imageCanvas.getContext('2d').drawImage(image, 0, 0);
      normalizedImage = imageCanvas.toBuffer('image/png');
      image.close?.();
    } catch (error) {
      if (error instanceof ParserError) throw error;
      throw new ParserError('PARSE_FAILED');
    } finally {
      if (imageCanvas) { imageCanvas.width = 0; imageCanvas.height = 0; }
    }
    let session;
    try {
      session = await createOcrSession(signal);
      const result = await session.recognize(normalizedImage);
      const text = String(result?.data?.text || '').slice(0, limits.maxOutputChars).trim();
      const confidence = Number.isFinite(result?.data?.confidence) ? Math.max(0, Math.min(100, result.data.confidence)) : null;
      return { format: 'image', text, characterCount: text.length, pages: [], warnings: ['OCR 结果可能有误，需人工核对。'], confidence, dimensions };
    } catch (error) {
      if (error instanceof ParserError) throw error;
      throw new ParserError(createOcrWorker ? 'PARSE_FAILED' : 'OCR_UNAVAILABLE');
    } finally {
      await session?.close();
    }
  }

  async function createOcrSession(signal) {
    let temporaryLanguageDirectory = '';
    const workerFactory = createOcrWorker || (async languages => {
      const fs = require('node:fs');
      const path = require('node:path');
      const os = require('node:os');
      const { createWorker } = require('tesseract.js');
      temporaryLanguageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-ocr-'));
      try {
        for (const code of languages) {
          const pack = require(`@tesseract.js-data/${code}`);
          fs.copyFileSync(path.join(pack.langPath, `${code}.traineddata.gz`), path.join(temporaryLanguageDirectory, `${code}.traineddata.gz`));
        }
        return await createWorker(languages.join('+'), 1, { langPath: temporaryLanguageDirectory, gzip: true, cacheMethod: 'none', logging: false });
      } catch (error) {
        fs.rmSync(temporaryLanguageDirectory, { recursive: true, force: true });
        temporaryLanguageDirectory = '';
        throw error;
      }
    });
    let worker;
    let abortHandler;
    let workerTermination;
    const terminateWorker = () => {
      if (!workerTermination) workerTermination = Promise.resolve(worker?.terminate?.()).catch(() => {});
      return workerTermination;
    };
    try {
      worker = await workerFactory(['chi_sim', 'eng']);
      checkCancelled(signal);
      return {
        async recognize(image) {
          checkCancelled(signal);
          const recognition = Promise.resolve().then(() => worker.recognize(image));
          const cancelled = new Promise((_, reject) => {
            abortHandler = () => { terminateWorker(); reject(new ParserError('CANCELLED')); };
            signal?.addEventListener('abort', abortHandler, { once: true });
          });
          try {
            const result = signal ? await Promise.race([recognition, cancelled]) : await recognition;
            checkCancelled(signal);
            return result;
          } finally {
            signal?.removeEventListener('abort', abortHandler);
            abortHandler = null;
          }
        },
        close: async () => {
          await terminateWorker();
          if (temporaryLanguageDirectory) {
            try { require('node:fs').rmSync(temporaryLanguageDirectory, { recursive: true, force: true }); } catch {}
            temporaryLanguageDirectory = '';
          }
        }
      };
    } catch (error) {
      await terminateWorker();
      if (temporaryLanguageDirectory) {
        try { require('node:fs').rmSync(temporaryLanguageDirectory, { recursive: true, force: true }); } catch {}
      }
      if (error instanceof ParserError) throw error;
      throw new ParserError(createOcrWorker ? 'PARSE_FAILED' : 'OCR_UNAVAILABLE');
    } finally {
      signal?.removeEventListener('abort', abortHandler);
    }
  }

  async function parse(input = {}) {
    if (!input || typeof input !== 'object' || !(Buffer.isBuffer(input.buffer) || input.buffer instanceof Uint8Array) || !MIME_TYPES[input.mimeType]) return safeFailure('INVALID_INPUT');
    const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer.buffer, input.buffer.byteOffset, input.buffer.byteLength);
    if (buffer.length === 0) return safeFailure('PARSE_FAILED');
    if (buffer.length > limits.maxInputBytes) return safeFailure('LIMIT_EXCEEDED');
    if (input.mimeType === 'application/pdf' && buffer.toString('ascii', 0, 5) !== '%PDF-') return safeFailure('PARSE_FAILED');
    if (input.mimeType === DOCX_MIME && (buffer[0] !== 0x50 || buffer[1] !== 0x4b)) return safeFailure('PARSE_FAILED');
    const { signal: inputSignal } = input;
    if (inputSignal?.aborted) return safeFailure('CANCELLED');
    const controller = new AbortController();
    let interruptionCode = 'CANCELLED';
    const forwardAbort = () => controller.abort();
    inputSignal?.addEventListener('abort', forwardAbort, { once: true });
    const signal = controller.signal;
    let timeout;
    let abortHandler;
    const work = (async () => {
      switch (MIME_TYPES[input.mimeType]) {
        case 'pdf': return parsePdf(buffer, signal);
        case 'docx': return parseDocx(buffer, signal);
        default: return parseImage(buffer, input.mimeType, signal);
      }
    })();
    const abort = new Promise((_, reject) => {
      abortHandler = () => reject(new ParserError(interruptionCode));
      signal?.addEventListener('abort', abortHandler, { once: true });
      timeout = setTimeout(() => {
        interruptionCode = 'LIMIT_EXCEEDED';
        controller.abort();
      }, limits.maxDurationMs);
      timeout.unref?.();
    });
    try {
      const result = await Promise.race([work, abort]);
      return { ok: true, truncated: Boolean(result.truncated), ...result };
    } catch (error) {
      return safeFailure(error instanceof ParserError ? error.code : 'PARSE_FAILED');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortHandler);
      inputSignal?.removeEventListener('abort', forwardAbort);
    }
  }

  return { parse };
}

module.exports = { createWritingMaterialParser };
