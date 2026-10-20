const fsDefault = require('node:fs');
const pathDefault = require('node:path');
const { pathToFileURL } = require('node:url');

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

function createPptPreviewManager({
  BrowserWindow,
  session,
  fs = fsDefault,
  path = pathDefault,
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

  async function openPreview({ attachmentId, source } = {}) {
    if (!attachmentId) return unsupported(source || {});
    const metadata = attachmentStore.getAttachment(attachmentId);
    if (metadata.kind !== 'html' || metadata.mimeType !== 'text/html') {
      throw createPreviewError('UNSUPPORTED_PREVIEW', '当前隔离预览仅支持 HTML 附件。');
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
        activePreviews.delete(attachmentId);
        resolveClosed();
      })();
      return cleanupPromise;
    };

    try {
      const sourceHtml = fs.readFileSync(resolvedOriginal, 'utf8');
      fs.mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
      fs.writeFileSync(previewFile, makeCspMeta(sourceHtml), { flag: 'wx', mode: 0o400 });
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

      window = new BrowserWindow({
        show: false,
        webPreferences: {
          session: previewSession,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false
        }
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const stopNavigation = (event, navigationUrl) => {
        if (navigationUrl !== previewUrl) event.preventDefault();
      };
      window.webContents.on('will-navigate', stopNavigation);
      window.webContents.on('will-redirect', stopNavigation);
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.on('closed', cleanup);
      activePreviews.set(attachmentId, { window, cleanup, closed });
      await window.loadFile(previewFile);
      if (typeof window.show === 'function') window.show();
    } catch (cause) {
      if (window && typeof window.destroy === 'function' && !window.isDestroyed?.()) window.destroy();
      await cleanup();
      if (cause?.code === 'UNSUPPORTED_PREVIEW' || cause?.code === 'INVALID_ATTACHMENT') throw cause;
      throw createPreviewError('PREVIEW_FAILED', 'HTML 预览启动失败；原附件仍保留，可使用截图或文本反馈。');
    }

    return {
      status: 'opened',
      attachmentId,
      close: () => window.close(),
      closed
    };
  }

  async function closePreview(attachmentId) {
    const preview = activePreviews.get(attachmentId);
    if (!preview) return false;
    preview.window.close();
    await preview.closed;
    return true;
  }

  return Object.freeze({ openPreview, closePreview });
}

module.exports = { createPptPreviewManager, CONTENT_SECURITY_POLICY };
