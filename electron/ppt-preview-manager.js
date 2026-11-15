const fsDefault = require('node:fs');
const pathDefault = require('node:path');
const { pathToFileURL } = require('node:url');
const cryptoDefault = require('node:crypto');

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "img-src 'self'",
  "style-src 'unsafe-inline'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

function createPreviewError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function makeCspMeta(html) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`;
  return /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, match => `${match}${meta}`)
    : `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

function isInside(pathModule, root, target) {
  const relative = pathModule.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${pathModule.sep}`) && !pathModule.isAbsolute(relative));
}

function sanitizeSourceUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function cleanTargetText(value, maxLength, required = false, trim = true) {
  if (typeof value !== 'string') return null;
  const text = trim ? value.trim() : value;
  if (text.length > maxLength || required && !text) return null;
  return text;
}

function normalizePreviewSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.url !== 'string' || value.url.length > 2048) return null;
  const url = sanitizeSourceUrl(value.url);
  if (!url || typeof value.fetchedAt !== 'string' || value.fetchedAt.length > 80
    || !Number.isFinite(Date.parse(value.fetchedAt)) || typeof value.contentHash !== 'string'
    || !/^sha256:[a-f0-9]{64}$/i.test(value.contentHash)) return null;
  return { url, fetchedAt: value.fetchedAt, contentHash: value.contentHash };
}

function readWebSnapshotSource(html) {
  const normalizeSnapshot = value => {
    const source = normalizePreviewSource(value);
    return source ? { ...source, incomplete: value.incomplete === true } : null;
  };
  const marker = html.match(/^<!--forward-step-source:([A-Za-z0-9+/=]+)-->\r?\n?/);
  if (marker && marker[1].length <= 4096) {
    try { return normalizeSnapshot(JSON.parse(Buffer.from(marker[1], 'base64').toString('utf8'))); }
    catch {}
  }
  const match = html.match(/<meta name="forward-step-source" content="([A-Za-z0-9+/=]+)">/i);
  if (!match || match[1].length > 4096) return null;
  try { return normalizeSnapshot(JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))); }
  catch { return null; }
}

function makeWebSnapshotPreview(sourceHtml, metadata) {
  const pageHtml = sourceHtml.replace(/^<!--forward-step-source:[A-Za-z0-9+/=]+-->\r?\n?/, '');
  const pageBase64 = Buffer.from(pageHtml, 'utf8').toString('base64');
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const policy = [
    "default-src 'none'", "script-src 'none'", "connect-src 'none'", "img-src 'none'",
    "style-src 'unsafe-inline'", "font-src 'none'", "media-src 'none'", "object-src 'none'",
    "frame-src 'none'", "base-uri 'none'", "form-action 'none'"
  ].join('; ');
  const incomplete = metadata.source.incomplete ? ' · 正文提取不完整' : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${escapeHtml(metadata.displayName || '网页快照')}</title></head><body><aside id="forward-step-preview-info" style="all:initial;display:block;position:sticky;top:0;z-index:2147483646;padding:12px;background:#fff;color:#202522;border-bottom:1px solid #d7ddd8;font:13px/1.5 system-ui,sans-serif;overflow-wrap:anywhere"><strong>${escapeHtml(metadata.displayName || '网页快照')}</strong><br>静态页面 · 脚本和外部资源已禁用${incomplete}<br>${escapeHtml(metadata.source.contentHash)} · ${escapeHtml(metadata.source.fetchedAt)}<br>${escapeHtml(metadata.source.url)}</aside><textarea hidden id="forward-step-preview-source">${pageBase64}</textarea></body></html>`;
}

function normalizePreviewTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const selector = cleanTargetText(value.selector, 500, true);
  if (!selector) return null;
  if (value.kind === 'text') {
    const exact = cleanTargetText(value.exact, 2000, true);
    const prefix = cleanTargetText(value.prefix || '', 120, false, false);
    const suffix = cleanTargetText(value.suffix || '', 120, false, false);
    if (!exact || prefix === null || suffix === null) return null;
    const hasPosition = value.start !== undefined || value.end !== undefined;
    if (hasPosition && (!Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end)
      || value.start < 0 || value.end <= value.start || value.end - value.start !== Array.from(exact).length)) return null;
    const source = value.source === undefined ? null : normalizePreviewSource(value.source);
    if (value.source !== undefined && !source) return null;
    return { kind: 'text', selector, exact, prefix, suffix, ...(hasPosition ? { start: value.start, end: value.end } : {}), ...(source ? { source } : {}) };
  }
  if (value.kind === 'element') {
    const excerpt = cleanTargetText(value.excerpt || '', 500);
    const source = value.source === undefined ? null : normalizePreviewSource(value.source);
    if (excerpt === null || value.source !== undefined && !source) return null;
    return { kind: 'element', selector, excerpt, ...(source ? { source } : {}) };
  }
  return null;
}

function createPptPreviewManager({
  BrowserWindow,
  WebContentsView,
  session,
  fs = fsDefault,
  path = pathDefault,
  crypto = cryptoDefault,
  app,
  attachmentStore,
  createId,
  now = () => new Date().toISOString()
} = {}) {
  if (!BrowserWindow || !session || !app || !attachmentStore) {
    throw new TypeError('必须提供 BrowserWindow、session、app 和附件存储');
  }
  const activePreviews = new Map();

  function unsupported(source) {
    const kind = ['url', 'development-page', 'browser-page'].includes(source?.kind) ? source.kind : 'url';
    const url = sanitizeSourceUrl(source?.url);
    const version = typeof source?.version === 'string' ? source.version : null;
    return {
      status: 'unsupported',
      source: { kind, url, version, fetchedAt: now() },
      fallback: ['screenshot', 'text'],
      reason: '无法在不访问外部页面或扩大本机文件权限的条件下安全捕获此来源。请提供静态截图或复制页面文本。'
    };
  }

  async function openPreview({ attachmentId, source, target: requestedTarget, expectedHash, embedded = false, parentWindow } = {}) {
    if (!attachmentId) return unsupported(source || {});
    const metadata = attachmentStore.getAttachment(attachmentId);
    if (metadata.kind !== 'html' || metadata.mimeType !== 'text/html') {
      throw createPreviewError('UNSUPPORTED_PREVIEW', '当前隔离预览仅支持 HTML 附件。');
    }
    if (expectedHash !== undefined && expectedHash !== metadata.sha256) {
      throw createPreviewError('ATTACHMENT_VERSION_MISMATCH', '批注引用的资料版本已变化，请检查资料后重新定位。');
    }
    const target = requestedTarget === undefined ? null : normalizePreviewTarget(requestedTarget);
    if (requestedTarget !== undefined && !target) {
      throw createPreviewError('INVALID_ANNOTATION_TARGET', '批注定位信息无效或不完整。');
    }
    if (embedded && (!WebContentsView || !parentWindow?.contentView)) {
      throw createPreviewError('PREVIEW_FAILED', '工作台内嵌 HTML 预览不可用。');
    }
    if (activePreviews.has(attachmentId)) await closePreview(attachmentId);
    if (embedded) {
      for (const [activeId, activePreview] of activePreviews) {
        if (activePreview.embedded && activePreview.parentWindow === parentWindow) await closePreview(activeId);
      }
    }

    const originalPath = path.resolve(attachmentStore.getAttachmentPath(attachmentId));
    const attachmentRoot = path.dirname(originalPath);
    const resolvedOriginal = fs.realpathSync(originalPath);
    if (!isInside(path, attachmentRoot, resolvedOriginal) || !fs.statSync(resolvedOriginal).isFile()) {
      throw createPreviewError('INVALID_ATTACHMENT', '附件路径无效。');
    }

    const previewId = String(createId());
    const temporaryRoot = path.join(app.getPath('userData'), 'ppt-feedback-preview', previewId);
    const previewFile = path.join(temporaryRoot, 'attachment.html');
    const partition = `ppt-feedback-preview-${previewId}`;
    const previewUrl = pathToFileURL(previewFile).href;
    let previewSession;
    let window;
    let view;
    let webContents;
    let previewEntry;
    let resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });
    let cleanupPromise;

    const cleanup = () => {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        try { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } catch {}
        if (previewSession) {
          try { await previewSession.clearStorageData(); } catch {}
          try { await previewSession.clearCache(); } catch {}
        }
        if (activePreviews.get(attachmentId) === previewEntry) activePreviews.delete(attachmentId);
        resolveClosed();
      })();
      return cleanupPromise;
    };

    try {
      const sourceContent = fs.readFileSync(resolvedOriginal);
      const sourceHash = crypto.createHash('sha256').update(sourceContent).digest('hex');
      if (sourceContent.length !== metadata.size || sourceHash !== metadata.sha256) {
        throw createPreviewError('ATTACHMENT_VERSION_MISMATCH', 'HTML 附件内容与保存的版本摘要不一致，预览已停止。');
      }
      const sourceHtml = sourceContent.toString('utf8');
      metadata.source = readWebSnapshotSource(sourceHtml);
      fs.mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
      const previewHtml = metadata.source
        ? makeWebSnapshotPreview(sourceHtml, metadata)
        : makeCspMeta(sourceHtml);
      fs.writeFileSync(previewFile, previewHtml, { flag: 'wx', mode: 0o400 });
      if (typeof fs.chmodSync === 'function') fs.chmodSync(previewFile, 0o400);

      previewSession = session.fromPartition(partition, { cache: false });
      previewSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      if (typeof previewSession.setPermissionCheckHandler === 'function') {
        previewSession.setPermissionCheckHandler(() => false);
      }
      previewSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        const allowedMainDocument = details.resourceType === 'mainFrame' && details.url === previewUrl;
        callback({ cancel: !allowedMainDocument });
      });
      previewSession.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
        const responseHeaders = { ...(details.responseHeaders || {}) };
        for (const headerName of Object.keys(responseHeaders)) {
          if (headerName.toLowerCase() === 'content-security-policy') delete responseHeaders[headerName];
        }
        responseHeaders['Content-Security-Policy'] = [CONTENT_SECURITY_POLICY];
        callback({ responseHeaders });
      });

      const webPreferences = {
        preload: path.join(__dirname, 'ppt-feedback-preview-preload.js'),
        session: previewSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false
      };
      if (embedded) {
        view = new WebContentsView({ webPreferences });
        parentWindow.contentView.addChildView(view);
        view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
        view.setVisible(false);
        webContents = view.webContents;
      } else {
        window = new BrowserWindow({ show: false, webPreferences });
        webContents = window.webContents;
      }
      webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const stopNavigation = (event, navigationUrl) => {
        if (navigationUrl !== previewUrl) event.preventDefault();
      };
      webContents.on('will-navigate', stopNavigation);
      webContents.on('will-redirect', stopNavigation);
      webContents.on('will-attach-webview', event => event.preventDefault());
      if (window) window.on('closed', cleanup);
      previewEntry = { window, view, parentWindow, webContents, embedded, cleanup, closed, metadata };
      activePreviews.set(attachmentId, previewEntry);
      webContents.on('destroyed', cleanup);
      if (embedded) await webContents.loadURL(previewUrl);
      else await window.loadFile(previewFile);
      if (target) webContents.send('ppt-feedback:preview-locate', target);
      if (window && typeof window.show === 'function') window.show();
    } catch (cause) {
      if (window && typeof window.destroy === 'function' && !window.isDestroyed?.()) window.destroy();
      if (view) {
        try { parentWindow.contentView.removeChildView(view); } catch {}
        if (!view.webContents.isDestroyed?.()) view.webContents.destroy();
      }
      await cleanup();
      if (cause?.code === 'UNSUPPORTED_PREVIEW' || cause?.code === 'INVALID_ATTACHMENT' || cause?.code === 'ATTACHMENT_VERSION_MISMATCH') throw cause;
      throw createPreviewError('PREVIEW_FAILED', 'HTML 预览启动失败；原附件仍保留，可使用截图或文本反馈。');
    }

    return {
      status: 'opened',
      attachmentId,
      close: () => window ? window.close() : closePreview(attachmentId),
      closed
    };
  }

  function setPreviewBounds(attachmentId, bounds) {
    const preview = activePreviews.get(attachmentId);
    if (!preview?.view || !bounds || typeof bounds !== 'object' || Array.isArray(bounds)
      || Object.keys(bounds).some(key => !['x', 'y', 'width', 'height', 'visible'].includes(key))) return false;
    if (bounds.visible !== true) {
      preview.view.setVisible(false);
      return true;
    }
    const values = [bounds.x, bounds.y, bounds.width, bounds.height].map(Number);
    if (!values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) {
      preview.view.setVisible(false);
      return false;
    }
    const [x, y, width, height] = values;
    const [parentWidth, parentHeight] = preview.parentWindow.getContentSize();
    const left = Math.max(0, Math.min(parentWidth, x));
    const top = Math.max(0, Math.min(parentHeight, y));
    const right = Math.max(left, Math.min(parentWidth, x + width));
    const bottom = Math.max(top, Math.min(parentHeight, y + height));
    if (right <= left || bottom <= top) {
      preview.view.setVisible(false);
      return false;
    }
    preview.view.setBounds({ x: left, y: top, width: right - left, height: bottom - top });
    preview.view.setVisible(true);
    return true;
  }

  async function closePreview(attachmentId) {
    const preview = activePreviews.get(attachmentId);
    if (!preview) return false;
    if (preview.window) preview.window.close();
    else {
      try { preview.parentWindow.contentView.removeChildView(preview.view); } catch {}
      if (!preview.webContents.isDestroyed?.()) preview.webContents.destroy();
      await preview.cleanup();
    }
    await preview.closed;
    return true;
  }

  function acceptSelection(event, value) {
    const sender = event?.sender;
    if (!sender?.mainFrame || event.senderFrame !== sender.mainFrame) return null;
    const entry = [...activePreviews.entries()].find(([, preview]) => preview.webContents === sender);
    const target = normalizePreviewTarget(value);
    if (!entry || !target) return null;
    const [attachmentId, preview] = entry;
    const sourceTarget = preview.metadata.source ? normalizePreviewTarget({ ...target, source: preview.metadata.source }) : target;
    if (!sourceTarget) return null;
    return {
      taskId: preview.metadata.taskId,
      attachmentId,
      contentHash: preview.metadata.sha256,
      target: sourceTarget
    };
  }

  return Object.freeze({ openPreview, closePreview, setPreviewBounds, acceptSelection });
}

module.exports = { createPptPreviewManager, CONTENT_SECURITY_POLICY };
