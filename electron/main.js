const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEV_PAGE_URL = process.env.DESKTOP_SERVICE_URL || 'http://127.0.0.1:4173';
const SERVER_SHUTDOWN_TIMEOUT_MS = 2000;
let mainWindow;
let bundledService;
let localServiceUrl = DEV_PAGE_URL;

function isDevelopment() {
  return !app.isPackaged || process.env.NODE_ENV === 'development';
}

async function requestLocalService(endpoint, options = {}) {
  const response = await fetch(`${localServiceUrl}${endpoint}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }

  if (!response.ok) {
    throw new Error(body?.message || `本地服务请求失败（${response.status}）`);
  }
  return body;
}

function getBundledServerPath() {
  return path.join(app.getAppPath(), 'server.js');
}

async function startBundledService() {
  if (bundledService) return localServiceUrl;

  const { startServer } = require(getBundledServerPath());
  bundledService = await startServer({ port: 0, host: '127.0.0.1' });
  const address = bundledService.address();
  if (!address || typeof address === 'string') {
    throw new Error('内置本地服务没有返回有效的监听地址');
  }
  localServiceUrl = `http://127.0.0.1:${address.port}`;
  return localServiceUrl;
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

async function readSavedConfig() {
  try {
    return JSON.parse(await fs.readFile(getConfigPath(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const pageUrl = isDevelopment() ? DEV_PAGE_URL : await startBundledService();
  await mainWindow.loadURL(pageUrl);
}

async function reportStartupError(error) {
  console.error('应用启动失败：', error);
  try {
    const options = {
      type: 'error',
      title: '应用启动失败',
      message: '应用无法正常启动。',
      detail: error.message || String(error)
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, options);
    } else {
      await dialog.showMessageBox(options);
    }
  } catch (dialogError) {
    console.error('显示启动错误提示失败：', dialogError);
  } finally {
    app.quit();
  }
}

ipcMain.handle('config:get', async () => {
  const saved = await readSavedConfig();
  let service = null;
  try {
    service = await requestLocalService('/api/config');
  } catch (error) {
    service = { available: false, message: error.message };
  }
  return { ...saved, service };
});

ipcMain.handle('config:save', async (_event, config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('配置必须是对象');
  }
  await fs.mkdir(path.dirname(getConfigPath()), { recursive: true });
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
  return { saved: true };
});

ipcMain.handle('model:request', async (_event, payload) => {
  return requestLocalService('/api/model', {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });
});

ipcMain.handle('search:request', async (_event, payload) => {
  return requestLocalService('/api/search', {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });
});

app.whenReady().then(() => createWindow()).catch(reportStartupError);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch(reportStartupError);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let shuttingDown = false;
app.on('before-quit', event => {
  if (!bundledService || shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;

  const forceCloseTimer = setTimeout(() => {
    bundledService.closeAllConnections?.();
    app.quit();
  }, SERVER_SHUTDOWN_TIMEOUT_MS);

  try {
    bundledService.close(() => {
      clearTimeout(forceCloseTimer);
      app.quit();
    });
  } catch (error) {
    clearTimeout(forceCloseTimer);
    console.error('关闭本地服务失败：', error);
    bundledService.closeAllConnections?.();
    app.quit();
  }
});
