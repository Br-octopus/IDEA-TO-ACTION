'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const yazl = require('yazl');
const { sanitizeLocalPaths } = require('../prototype/unified-workbench-prompts.js');

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_RENDER_PIXELS = 16 * 1024 * 1024;
const EXTENSIONS = {
  'text/plain': '.txt', 'text/markdown': '.md', 'text/html': '.html', 'application/pdf': '.pdf',
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
};

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function asSafeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw fail('WORKBENCH_EXPORT_INVALID_SNAPSHOT', `${label}无效`);
  return value;
}

function safeName(value, fallback) {
  const leaf = String(value || '').replace(/\\/g, '/').split('/').at(-1) || fallback;
  const cleaned = leaf.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 150);
  return cleaned || fallback;
}

function validateRegion(region) {
  if (!region || typeof region !== 'object' || Array.isArray(region)
    || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key]))
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > 1.000001 || region.y + region.height > 1.000001) {
    throw fail('WORKBENCH_EXPORT_INVALID_SCOPE', '素材区域坐标无效，素材包未导出');
  }
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, region[key]]));
}

function normalizedHash(value) {
  return typeof value === 'string' ? value.replace(/^sha256:/i, '').toLowerCase() : '';
}

function safeSourceRef(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  if (typeof source.sourceName === 'string' && source.sourceName.trim()) result.sourceName = safeName(source.sourceName, '来源');
  if (Object.hasOwn(source, 'pageIndex')) {
    if (!Number.isSafeInteger(source.pageIndex) || source.pageIndex < 0) {
      throw fail('WORKBENCH_EXPORT_INVALID_SCOPE', '素材页码无效，素材包未导出');
    }
    result.pageIndex = source.pageIndex;
  }
  if (source.region != null) result.region = validateRegion(source.region);
  return Object.keys(result).length ? result : null;
}

function cropCanvas(source, region) {
  const x = Math.floor(region.x * source.width);
  const y = Math.floor(region.y * source.height);
  const right = Math.min(source.width, Math.ceil((region.x + region.width) * source.width));
  const bottom = Math.min(source.height, Math.ceil((region.y + region.height) * source.height));
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0 || width * height > MAX_RENDER_PIXELS) {
    throw fail('WORKBENCH_EXPORT_RENDER_FAILED', '素材选区尺寸无效或过大，素材包未导出');
  }
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(source, x, y, width, height, 0, 0, width, height);
  return canvas;
}

async function readCheckedAttachment(attachmentStore, file) {
  const hash = crypto.createHash('sha256');
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of attachmentStore.createReadStream(file.attachmentId)) {
      size += chunk.length;
      hash.update(chunk);
      chunks.push(chunk);
    }
  } catch (cause) {
    throw fail('WORKBENCH_EXPORT_ATTACHMENT_MISSING', '范围素材原件不可读取，素材包未导出');
  }
  if (size !== file.size || hash.digest('hex') !== file.sha256) {
    throw fail('WORKBENCH_EXPORT_ATTACHMENT_MISMATCH', '范围素材与固定版本不一致，素材包未导出');
  }
  return Buffer.concat(chunks, size);
}

async function renderScopedAttachment(file, bytes) {
  if (file.mimeType === 'application/pdf') {
    const canvasTypes = require('@napi-rs/canvas');
    // PDF.js uses browser canvas constructors while rendering in Node.
    for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
      if (typeof globalThis[name] === 'undefined' && canvasTypes[name]) globalThis[name] = canvasTypes[name];
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false });
    try {
      const document = await loadingTask.promise;
      if (file.pageIndex >= document.numPages) throw fail('WORKBENCH_EXPORT_INVALID_SCOPE', '所选 PDF 页码不存在，素材包未导出');
      const page = await document.getPage(file.pageIndex + 1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1800 / Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      if (width <= 0 || height <= 0 || width * height > MAX_RENDER_PIXELS) {
        throw fail('WORKBENCH_EXPORT_RENDER_FAILED', 'PDF 页面尺寸无效或过大，素材包未导出');
      }
      const canvas = createCanvas(width, height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return (file.region ? cropCanvas(canvas, file.region) : canvas).toBuffer('image/png');
    } catch (error) {
      if (error.code) throw error;
      throw fail('WORKBENCH_EXPORT_RENDER_FAILED', 'PDF 页面或区域图生成失败，素材包未导出');
    } finally {
      await loadingTask.destroy();
    }
  }
  try {
    const image = await loadImage(bytes);
    if (image.width * image.height > MAX_RENDER_PIXELS) {
      throw fail('WORKBENCH_EXPORT_RENDER_FAILED', '图片尺寸过大，素材包未导出');
    }
    return cropCanvas(image, file.region).toBuffer('image/png');
  } catch (error) {
    if (error.code) throw error;
    throw fail('WORKBENCH_EXPORT_RENDER_FAILED', '图片区域图生成失败，素材包未导出');
  }
}

function locateDelivery(project, roundId, deliveryId) {
  asSafeId(project?.id, '任务标识');
  asSafeId(roundId, '提示词轮次标识');
  asSafeId(deliveryId, '提示词交付标识');
  const round = (Array.isArray(project.workbenchPromptRounds) ? project.workbenchPromptRounds : []).find(item => item.id === roundId);
  const delivery = (round?.deliveries || []).find(item => item.id === deliveryId);
  if (!round || !delivery || typeof delivery.text !== 'string' || !delivery.text.trim()) {
    throw fail('WORKBENCH_EXPORT_INVALID_SNAPSHOT', '找不到已固定的提示词交付');
  }
  return { round, delivery };
}

function versionIndex(project) {
  const versions = new Map();
  for (const content of Array.isArray(project.workbenchContents) ? project.workbenchContents : []) {
    for (const version of Array.isArray(content.versions) ? content.versions : []) versions.set(version.id, { content, version });
  }
  return versions;
}

function buildLayoutReference(layoutIntent, materials) {
  if (layoutIntent?.enabled !== true) return null;
  const nodes = Array.isArray(layoutIntent.nodes) ? layoutIntent.nodes : [];
  const bounds = layoutIntent.bounds || {};
  if (!nodes.length || nodes.length > 200 || !Number.isFinite(bounds.width) || bounds.width <= 0 || !Number.isFinite(bounds.height) || bounds.height <= 0) {
    throw fail('WORKBENCH_EXPORT_LAYOUT_FAILED', '本轮构图数据不完整，素材包未导出');
  }
  const byVersion = new Map(materials.map(item => [item.contentVersionId, item]));
  for (const node of nodes) {
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite)
      || node.x < 0 || node.y < 0 || node.width <= 0 || node.height <= 0
      || node.x + node.width > 1.001 || node.y + node.height > 1.001) {
      throw fail('WORKBENCH_EXPORT_LAYOUT_FAILED', '本轮构图坐标无效，素材包未导出');
    }
  }
  const canvas = createCanvas(1440, 960);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 1440, 960);
  context.fillStyle = '#18231d';
  context.font = '600 28px sans-serif';
  context.fillText('本轮构图参考', 48, 54);
  context.fillStyle = '#65736a';
  context.font = '16px sans-serif';
  context.fillText('节点位置与尺寸按选区内容坐标绘制；此图仅表示构图关系。', 48, 82);

  const area = { x: 48, y: 118, width: 1344, height: 790 };
  const ratio = bounds.width / bounds.height;
  let width = area.width;
  let height = width / ratio;
  if (height > area.height) { height = area.height; width = height * ratio; }
  const offsetX = area.x + (area.width - width) / 2;
  const offsetY = area.y + (area.height - height) / 2;
  context.fillStyle = '#f7faf7';
  context.fillRect(offsetX, offsetY, width, height);
  context.strokeStyle = '#bac8bd';
  context.lineWidth = 2;
  context.strokeRect(offsetX, offsetY, width, height);

  const ordered = nodes.slice().sort((left, right) => (Number(left.zIndex) || 0) - (Number(right.zIndex) || 0));
  ordered.forEach((node, index) => {
    const item = byVersion.get(node.contentVersionId);
    const x = offsetX + node.x * width;
    const y = offsetY + node.y * height;
    const nodeWidth = node.width * width;
    const nodeHeight = node.height * height;
    const number = item?.number || index + 1;
    context.fillStyle = index % 2 ? '#eaf1ec' : '#e8f0f7';
    context.fillRect(x, y, nodeWidth, nodeHeight);
    context.strokeStyle = '#496455';
    context.lineWidth = 2;
    context.strokeRect(x, y, nodeWidth, nodeHeight);
    context.save();
    context.beginPath();
    context.rect(x + 6, y + 4, Math.max(0, nodeWidth - 12), Math.max(0, nodeHeight - 8));
    context.clip();
    context.fillStyle = '#18231d';
    context.font = '600 16px sans-serif';
    context.fillText(`素材 ${number} · ${safeName(item?.title, '内容').slice(0, 48)}`, x + 10, y + 26);
    context.restore();
  });
  return canvas.toBuffer('image/png');
}

function preparePackage({ taskId, manifest, roundId, deliveryId, attachmentStore, now = () => new Date().toISOString() } = {}) {
  const project = manifest?.project;
  if (manifest?.taskId !== taskId || project?.id !== taskId) throw fail('WORKBENCH_EXPORT_INVALID_SNAPSHOT', '工作台任务清单与请求不匹配');
  const { round, delivery } = locateDelivery(project, roundId, deliveryId);
  const versions = versionIndex(project);
  const sourceMaterials = Array.isArray(delivery.materials) ? delivery.materials : [];
  const seenVersions = new Set();
  const materialRows = [];
  const attachmentRows = [];
  const renderedFiles = [];
  const scopeWarnings = [];
  const virtualFiles = [];
  const attachmentFileByIdentity = new Map();
  const renderedFileByIdentity = new Map();
  let attachmentNumber = 0;

  for (const material of sourceMaterials) {
    const contentVersionId = asSafeId(material.contentVersionId, '素材版本标识');
    if (seenVersions.has(contentVersionId)) throw fail('WORKBENCH_EXPORT_INVALID_SNAPSHOT', '提示词素材清单包含重复版本');
    seenVersions.add(contentVersionId);
    const indexed = versions.get(contentVersionId);
    if (!indexed) throw fail('WORKBENCH_EXPORT_INVALID_SNAPSHOT', '提示词引用的素材版本已不存在');
    const title = safeName(material.title || indexed.content.title, '未命名素材');
    const row = {
      number: materialRows.length + 1, contentVersionId, title,
      kind: typeof material.kind === 'string' ? material.kind : indexed.content.kind || 'unknown',
      purpose: material.purpose === 'result' ? 'result' : 'reference',
      hash: typeof material.hash === 'string' ? material.hash : '',
      sourceRef: safeSourceRef(material.sourceRef || indexed.version.sourceRef),
      file: null
    };
    if (material.attachmentId) {
      asSafeId(material.attachmentId, '附件标识');
      if (indexed.version.attachmentId !== material.attachmentId
        || normalizedHash(indexed.version.hash) !== normalizedHash(material.hash)) {
        throw fail('WORKBENCH_EXPORT_ATTACHMENT_MISMATCH', `素材“${title}”与已固定版本不一致，素材包未导出`);
      }
      let metadata;
      try { metadata = attachmentStore.getAttachment(material.attachmentId); }
      catch (cause) { throw fail('WORKBENCH_EXPORT_ATTACHMENT_MISSING', `素材“${title}”的原件不可读取，素材包未导出`); }
      if (metadata.taskId !== taskId || metadata.id !== material.attachmentId
        || normalizedHash(metadata.sha256) !== normalizedHash(material.hash)
        || !Number.isSafeInteger(metadata.size) || metadata.size < 0) {
        throw fail('WORKBENCH_EXPORT_ATTACHMENT_MISMATCH', `素材“${title}”的原件版本已变化，素材包未导出`);
      }
      const identity = `${metadata.id}:${metadata.sha256}`;
      row.hash = metadata.sha256;
      const sourceRef = row.sourceRef;
      const hasScope = sourceRef?.pageIndex != null || sourceRef?.region;
      const canRenderPdf = metadata.mimeType === 'application/pdf';
      const canRenderImageRegion = metadata.mimeType?.startsWith('image/') && Boolean(sourceRef?.region);
      if (hasScope && (canRenderPdf || canRenderImageRegion)) {
        const pageIndex = sourceRef.pageIndex ?? 0;
        if (!canRenderPdf && pageIndex > 0) {
          throw fail('WORKBENCH_EXPORT_INVALID_SCOPE', '所选图片页码不存在，素材包未导出');
        }
        const selection = { pageIndex, region: sourceRef.region || null };
        const renderIdentity = `${identity}:${JSON.stringify(selection)}`;
        let file = renderedFileByIdentity.get(renderIdentity);
        if (!file) {
          file = {
            archivePath: `materials/${String(row.number).padStart(3, '0')}-${safeName(title.replace(/\.[^.]+$/, ''), '素材')}-scope.png`,
            attachmentId: metadata.id, size: metadata.size, sha256: metadata.sha256,
            mimeType: metadata.mimeType, ...selection
          };
          renderedFileByIdentity.set(renderIdentity, file);
          renderedFiles.push(file);
        }
        row.file = file.archivePath;
        row.scopeNote = canRenderPdf
          ? `仅附第 ${pageIndex + 1} 页${sourceRef.region ? '选区图' : '页面图'}`
          : '仅附所选区域裁剪图';
      } else if (hasScope && metadata.mimeType?.startsWith('image/')) {
        if (sourceRef.pageIndex > 0) throw fail('WORKBENCH_EXPORT_INVALID_SCOPE', '所选图片页码不存在，素材包未导出');
      } else if (hasScope) {
        row.scopeNote = `当前格式仅能附带完整原件${sourceRef.pageIndex != null ? `（第 ${sourceRef.pageIndex + 1} 页` : '（'}${sourceRef.region ? '所选区域' : ''}）`;
        scopeWarnings.push({ contentVersionId, title: row.title, scopeNote: row.scopeNote });
      }
      if (!row.file) {
        let file = attachmentFileByIdentity.get(identity);
        if (!file) {
          attachmentNumber += 1;
          const displayName = safeName(metadata.displayName, title);
          const extension = path.posix.extname(displayName) || EXTENSIONS[metadata.mimeType] || '.bin';
          const base = path.posix.extname(displayName) ? displayName.slice(0, -path.posix.extname(displayName).length) : displayName;
          file = {
            archivePath: `materials/${String(attachmentNumber).padStart(3, '0')}-${safeName(base, '素材')}${extension}`,
            attachmentId: metadata.id, size: metadata.size, sha256: metadata.sha256, createdAt: metadata.createdAt
          };
          attachmentFileByIdentity.set(identity, file);
          attachmentRows.push(file);
        }
        row.file = file.archivePath;
      }
    } else if (typeof material.text === 'string' && material.text.length) {
      const extension = row.kind === 'markdown' ? '.md' : '.txt';
      const archivePath = `materials/${String(row.number).padStart(3, '0')}-${safeName(title.replace(/\.[^.]+$/, ''), '素材')}${extension}`;
      const bytes = Buffer.from(material.text, 'utf8');
      row.file = archivePath;
      row.hash = crypto.createHash('sha256').update(bytes).digest('hex');
      virtualFiles.push({ archivePath, bytes });
    }
    materialRows.push(row);
  }

  const layoutBuffer = buildLayoutReference(delivery.layoutIntent, materialRows);
  const layoutReference = layoutBuffer ? 'layout-reference.png' : null;
  const excludedMaterials = (Array.isArray(delivery.excludedMaterials) ? delivery.excludedMaterials : []).map(item => ({
    contentVersionId: asSafeId(item.contentVersionId, '已排除素材版本标识'),
    title: safeName(item.title, '未命名素材')
  }));
  const hasFullOriginalOnly = scopeWarnings.length > 0;
  const exportedAt = now();
  const exportedDeliveryId = deliveryId;
  const sourceDeliveryId = asSafeId(delivery.sourceDeliveryId || deliveryId, '来源交付标识');
  const prompt = sanitizeLocalPaths(delivery.text);
  const promptHash = crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');
  const packageManifest = {
    format: 'forward-step-workbench-materials', schemaVersion: 1,
    taskId, roundId, sourceDeliveryId, parentDeliveryId: delivery.parentDeliveryId || deliveryId,
    deliveryId, exportedDeliveryId, exportedAt,
    prompt: { file: 'prompt.txt', sha256: promptHash },
    materials: materialRows.map(({ number, contentVersionId, title, kind, purpose, hash, sourceRef, file, scopeNote }) => ({
      number, contentVersionId, title, kind, purpose, hash, sourceRef, file, ...(scopeNote ? { scopeNote } : {})
    })),
    excludedMaterials,
    layoutReference,
    ...(hasFullOriginalOnly ? { scopeNotice: '以下素材格式暂不能生成页面或区域图；导出时按确认附带完整原件。' } : {})
  };
  const fileMap = [
    '# 本轮素材清单', '',
    ...materialRows.map(item => `- 素材 ${item.number}（版本 ${item.contentVersionId}）：${item.title}；${item.file ? `文件：${item.file}` : '未附原件'}${item.scopeNote ? `；范围：${item.scopeNote}` : ''}`),
    ...(excludedMaterials.length ? ['', '## 已排除', ...excludedMaterials.map(item => `- ${item.title}（版本 ${item.contentVersionId}）：未随包提供`)] : []),
    ...(layoutReference ? ['', `构图参考图：${layoutReference}`] : []),
    ...(hasFullOriginalOnly ? ['', '范围说明：以下素材将附带完整原件；如不希望扩大范围，可取消导出并返回工作台排除对应素材。'] : [])
  ].join('\n');
  return { round, delivery, packageManifest, fileMap, prompt, layoutBuffer, attachmentRows, renderedFiles, virtualFiles, scopeWarnings,
    summary: { exportedDeliveryId, materialCount: materialRows.length, fileCount: attachmentRows.length + renderedFiles.length + virtualFiles.length + 3 + (layoutBuffer ? 1 : 0), excludedCount: excludedMaterials.length } };
}

function checkedAttachmentStream(attachmentStore, file) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  const verifier = new Transform({
    transform(chunk, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); },
    flush(callback) {
      if (size !== file.size || hash.digest('hex') !== file.sha256) {
        callback(fail('WORKBENCH_EXPORT_ATTACHMENT_MISMATCH', '附件内容与固定版本不一致，素材包未导出'));
        return;
      }
      callback();
    }
  });
  const source = attachmentStore.createReadStream(file.attachmentId);
  source.once('error', error => verifier.destroy(error));
  source.pipe(verifier);
  return verifier;
}

async function writeWorkbenchMaterialArchive({ outputPath, taskId, manifest, roundId, deliveryId, attachmentStore, now } = {}) {
  const snapshot = preparePackage({ taskId, manifest, roundId, deliveryId, attachmentStore, now });
  const zip = new yazl.ZipFile();
  const output = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  const archiveDone = pipeline(zip.outputStream, output);
  zip.on('error', error => zip.outputStream.destroy(error));
  try {
    zip.addBuffer(Buffer.from(snapshot.prompt, 'utf8'), 'prompt.txt', { mode: 0o600 });
    zip.addBuffer(Buffer.from(snapshot.fileMap, 'utf8'), 'MATERIALS.md', { mode: 0o600 });
    zip.addBuffer(Buffer.from(`${JSON.stringify(snapshot.packageManifest, null, 2)}\n`, 'utf8'), 'manifest.json', { mode: 0o600 });
    if (snapshot.layoutBuffer) zip.addBuffer(snapshot.layoutBuffer, 'layout-reference.png', { mode: 0o600 });
    for (const file of snapshot.virtualFiles) zip.addBuffer(file.bytes, file.archivePath, { mode: 0o600 });
    for (const file of snapshot.renderedFiles) {
      const source = await readCheckedAttachment(attachmentStore, file);
      const rendered = await renderScopedAttachment(file, source);
      zip.addBuffer(rendered, file.archivePath, { mode: 0o600 });
    }
    for (const file of snapshot.attachmentRows) {
      zip.addReadStreamLazy(file.archivePath, { size: file.size, mode: 0o600 }, callback => {
        try { callback(null, checkedAttachmentStream(attachmentStore, file)); }
        catch (error) { callback(error); }
      });
    }
    zip.end();
    await archiveDone;
    return snapshot.summary;
  } catch (error) {
    zip.outputStream.destroy();
    output.destroy();
    await archiveDone.catch(() => {});
    throw error;
  }
}

module.exports = { preparePackage, writeWorkbenchMaterialArchive };
