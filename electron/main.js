const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const LOCAL_SERVICE_URL = process.env.DESKTOP_SERVICE_URL || 'http://127.0.0.1:4173';
const DEV_PAGE_URL = LOCAL_SERVICE_URL;
let mainWindow;
let bundledServiceStarted = false;

function isDevelopment() {
  return !app.isPackaged || process.env.NODE_ENV === 'development';
}

async function requestLocalService(endpoint, options = {}) {
  const response = await fetch(`${LOCAL_SERVICE_URL}${endpoint}`, {
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

function startBundledService() {
  if (bundledServiceStarted) return;

  require(getBundledServerPath());
  bundledServiceStarted = true;
}

async function waitForLocalService({ timeoutMs = 10000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(LOCAL_SERVICE_URL);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`本地服务未在 ${timeoutMs} 毫秒内就绪${lastError ? `：${lastError.message}` : ''}`);
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

  if (isDevelopment()) {
    await mainWindow.loadURL(DEV_PAGE_URL);
    return;
  }

  try {
    startBundledService();
    await waitForLocalService();
    await mainWindow.loadURL(LOCAL_SERVICE_URL);
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: '应用启动失败',
      message: '无法启动内置本地服务。',
      detail: error.message
    });
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

app.whenReady().then(async () => {
  await createWindow();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
