const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { startServer } = require('../server');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function loadBackupHandler({ channel, filePath, fsModule = fs, importCanceled = false }) {
  const registeredHandlers = new Map();
  const dialogOptions = [];
  const app = {
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    getPath: () => path.dirname(filePath),
    on: () => {},
    quit: () => {}
  };
  class MockBrowserWindow {
    constructor() {}
    isDestroyed() { return false; }
    async loadURL() {}
  }
  MockBrowserWindow.getAllWindows = () => [];
  const dialog = {
    showMessageBox: async () => {},
    showSaveDialog: async (_window, options) => {
      dialogOptions.push(options);
      return { canceled: false, filePath };
    },
    showOpenDialog: async () => importCanceled
      ? { canceled: true, filePaths: [] }
      : { canceled: false, filePaths: [filePath] }
  };
  const context = {
    console,
    __dirname: path.join(root, 'electron'),
    Buffer,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    process: { env: {}, platform: 'win32', pid: 12345 },
    require(request) {
      if (request === 'electron') {
        return {
          app,
          BrowserWindow: MockBrowserWindow,
          dialog,
          ipcMain: { handle: (name, handler) => registeredHandlers.set(name, handler) }
        };
      }
      if (request === 'node:fs') return fsModule;
      return require(request);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8'), context, {
    filename: path.join(root, 'electron', 'main.js')
  });
  return new Promise(resolve => setImmediate(() => resolve({
    handler: registeredHandlers.get(channel),
    dialogOptions
  })));
}

function loadBackupExportHandler(options) {
  return loadBackupHandler({ ...options, channel: 'backup:export' });
}

function loadBackupImportHandler(options) {
  return loadBackupHandler({ ...options, channel: 'backup:import' });
}

function createFsModule(overrides = {}) {
  return {
    ...fs,
    writeFileSync: (...args) => fs.writeFileSync(...args),
    renameSync: (...args) => fs.renameSync(...args),
    unlinkSync: (...args) => fs.unlinkSync(...args),
    ...overrides
  };
}

test('Electron desktop entry and preload exist', () => {
  assert.equal(packageJson.main, 'electron/main.js');
  assert.ok(fs.existsSync(path.join(root, packageJson.main)));
  assert.ok(fs.existsSync(path.join(root, 'electron', 'preload.js')));
});

test('Electron security settings and preload whitelist are present', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');

  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  for (const method of [
    'getConfig', 'saveConfig', 'requestModel', 'requestSearch',
    'exportBackup', 'importBackup', 'listBackups', 'readBackup'
  ]) {
    assert.match(preload, new RegExp(`${method}\\s*:`));
  }
});

test('Electron 备份 IPC 使用受限通道和文件对话框', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  const backupStore = fs.readFileSync(path.join(root, 'electron', 'backup-store.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  for (const channel of ['backup:export', 'backup:import', 'backup:list', 'backup:read']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\(['"]${channel}['"]`));
  }
  assert.match(main, /showSaveDialog/);
  assert.match(main, /showOpenDialog/);
  assert.match(preload, /ipcRenderer\.invoke\(['"]backup:export['"]/);
  assert.match(preload, /ipcRenderer\.invoke\(['"]backup:import['"]/);
  assert.match(preload, /ipcRenderer\.invoke\(['"]backup:list['"]/);
  assert.match(preload, /ipcRenderer\.invoke\(['"]backup:read['"]/);
  assert.match(main, /createBackupStore/);
  assert.doesNotMatch(preload, /require\(['"]node:fs['"]\)/);
  assert.doesNotMatch(preload, /userData/);
  assert.match(backupStore, /BACKUP_DIRECTORY\s*=\s*['"]backups['"]/);
  assert.match(backupStore, /path\.basename|pathModule\.basename/);
  assert.ok(packageJson.build.files.includes('electron/**/*'));
});

test('backup:export 拒绝非 JSON 路径并开启覆盖确认', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-export-'));
  const filePath = path.join(tempDirectory, 'backup.txt');
  fs.writeFileSync(filePath, '原文件', 'utf8');

  try {
    const { handler, dialogOptions } = await loadBackupExportHandler({ filePath });
    await assert.rejects(() => handler({}, '{}'), error => {
      assert.equal(error.name, 'TypeError');
      assert.match(error.message, /JSON/);
      return true;
    });
    assert.equal(fs.readFileSync(filePath, 'utf8'), '原文件');
    assert.equal(dialogOptions[0].showOverwriteConfirmation, true);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('backup:export 临时写入失败时保留原文件并清理临时文件', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-export-'));
  const filePath = path.join(tempDirectory, 'backup.json');
  fs.writeFileSync(filePath, '原文件', 'utf8');
  const tempPaths = [];
  const cleanedPaths = [];
  const fsModule = createFsModule({
    writeFileSync: (targetPath, ...args) => {
      tempPaths.push(targetPath);
      if (targetPath.endsWith('.tmp')) throw new Error('模拟临时文件写入失败');
      return fs.writeFileSync(targetPath, ...args);
    },
    unlinkSync: targetPath => {
      cleanedPaths.push(targetPath);
      try {
        return fs.unlinkSync(targetPath);
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
    }
  });

  try {
    const { handler } = await loadBackupExportHandler({ filePath, fsModule });
    await assert.rejects(() => handler({}, '{}'), error => error.code === 'BACKUP_EXPORT_WRITE_FAILED');
    assert.equal(fs.readFileSync(filePath, 'utf8'), '原文件');
    assert.equal(cleanedPaths.length, 1);
    assert.equal(fs.existsSync(cleanedPaths[0]), false);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('backup:export 替换失败时保留原文件并清理临时文件', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-export-'));
  const filePath = path.join(tempDirectory, 'backup.json');
  fs.writeFileSync(filePath, '原文件', 'utf8');
  const tempPaths = [];
  const fsModule = createFsModule({
    writeFileSync: (targetPath, ...args) => {
      tempPaths.push(targetPath);
      return fs.writeFileSync(targetPath, ...args);
    },
    renameSync: () => {
      throw new Error('模拟原子替换失败');
    },
    unlinkSync: targetPath => {
      fs.unlinkSync(targetPath);
    }
  });

  try {
    const { handler } = await loadBackupExportHandler({ filePath, fsModule });
    await assert.rejects(() => handler({}, '{}'), error => error.code === 'BACKUP_EXPORT_WRITE_FAILED');
    assert.equal(fs.readFileSync(filePath, 'utf8'), '原文件');
    assert.equal(tempPaths.length, 1);
    assert.equal(fs.existsSync(tempPaths[0]), false);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('backup:import 用户取消时保持稳定取消结果', async () => {
  const { handler } = await loadBackupImportHandler({
    filePath: path.join(os.tmpdir(), 'forward-step-cancelled.json'),
    importCanceled: true
  });

  const result = await handler();
  assert.equal(result.canceled, true);
});

test('backup:import 非 JSON 扩展名保持明确错误', async () => {
  const { handler } = await loadBackupImportHandler({
    filePath: path.join(os.tmpdir(), 'forward-step-invalid.txt')
  });

  await assert.rejects(() => handler(), error => {
    assert.equal(error.name, 'TypeError');
    assert.equal(error.code, 'BACKUP_IMPORT_INVALID_EXTENSION');
    assert.match(error.message, /JSON/);
    return true;
  });
});

test('backup:import 文件不存在时返回稳定错误码且不泄露路径', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-import-'));
  const filePath = path.join(tempDirectory, 'missing.json');

  try {
    const { handler } = await loadBackupImportHandler({ filePath });
    await assert.rejects(() => handler(), error => {
      assert.equal(error.code, 'BACKUP_IMPORT_READ_FAILED');
      assert.match(error.message, /备份文件读取失败/);
      assert.equal(error.message.includes(filePath), false);
      assert.equal(error.cause.code, 'ENOENT');
      return true;
    });
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('backup:import 无权限时返回稳定错误码且不泄露路径', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-import-'));
  const filePath = path.join(tempDirectory, 'forbidden.json');
  const cause = Object.assign(new Error(`EACCES: ${filePath}`), { code: 'EACCES' });
  const fsModule = createFsModule({
    readFileSync: () => {
      throw cause;
    }
  });

  try {
    const { handler } = await loadBackupImportHandler({ filePath, fsModule });
    await assert.rejects(() => handler(), error => {
      assert.equal(error.code, 'BACKUP_IMPORT_READ_FAILED');
      assert.match(error.message, /备份文件读取失败/);
      assert.equal(error.message.includes(filePath), false);
      assert.equal(error.cause, cause);
      return true;
    });
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('真实服务支持随机端口，首页和配置接口可访问', async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.equal(typeof address.port, 'number');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const homeResponse = await fetch(baseUrl);
  assert.equal(homeResponse.status, 200);
  assert.match(await homeResponse.text(), /<!doctype html/i);

  const configResponse = await fetch(`${baseUrl}/api/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(typeof config.model.configured, 'boolean');
  assert.equal(typeof config.search.configured, 'boolean');
});

test('非法 HTTP URL 返回 JSON 错误，服务运行期错误会记录', async t => {
  const originalConsoleError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args);
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(async () => {
    console.error = originalConsoleError;
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  const response = await new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: '/',
      headers: { host: '[' }
    }, resolve);
    request.on('error', reject);
    request.end();
  });
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  assert.equal(response.statusCode, 500);
  assert.match(Buffer.concat(chunks).toString(), /"error"/);

  const runtimeError = new Error('模拟运行期错误');
  server.emit('error', runtimeError);
  assert.equal(loggedErrors.at(-1)[0], '本地服务运行错误：');
  assert.equal(loggedErrors.at(-1)[1], runtimeError);
});

test('生产模式先启动随机端口服务，再使用实际地址加载页面', async () => {
  const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const events = [];
  const registeredHandlers = new Map();
  const appEvents = new Map();
  const app = {
    isPackaged: true,
    whenReady: () => Promise.resolve(),
    getAppPath: () => root,
    getPath: () => root,
    on: (name, handler) => appEvents.set(name, handler),
    quit: () => events.push('quit')
  };
  const browserWindow = class {
    constructor() {
      events.push('create-window');
    }

    async loadURL(url) {
      events.push(`load-url:${url}`);
    }
  };
  browserWindow.getAllWindows = () => [];

  const context = {
    console,
    __dirname: path.join(root, 'electron'),
    Date,
    Promise,
    setTimeout(callback, delay) {
      events.push(`schedule-shutdown-timeout:${delay}`);
      context.shutdownTimeout = callback;
      return 1;
    },
    clearTimeout: () => events.push('clear-shutdown-timeout'),
    process: { env: {}, platform: 'win32' },
    require(request) {
      if (request === 'electron') {
        return {
          app,
          BrowserWindow: browserWindow,
          dialog: { showMessageBox: async () => {} },
          ipcMain: { handle: (name, handler) => registeredHandlers.set(name, handler) }
        };
      }
      if (request === path.join(root, 'server.js')) {
        return {
          startServer: async options => {
            events.push(`start-bundled-service:${options.host}:${options.port}`);
            return {
              address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 50987 }),
              close: () => events.push('close-service'),
              closeAllConnections: () => events.push('force-close-connections')
            };
          }
        };
      }
      return require(request);
    }
  };
  vm.runInNewContext(mainSource, context, { filename: path.join(root, 'electron', 'main.js') });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(events, [
    'create-window',
    'start-bundled-service:127.0.0.1:0',
    'load-url:http://127.0.0.1:50987'
  ]);
  assert.equal(registeredHandlers.size, 8);
  for (const channel of ['backup:export', 'backup:import', 'backup:list', 'backup:read']) {
    assert.equal(registeredHandlers.has(channel), true);
  }
  assert.doesNotMatch(mainSource, /loadFile\(/);

  let prevented = false;
  appEvents.get('before-quit')({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(events.at(-1), 'close-service');
  assert.ok(events.includes('schedule-shutdown-timeout:2000'));
  context.shutdownTimeout();
  assert.deepEqual(events.slice(-2), ['force-close-connections', 'quit']);
});

test('Electron 初始化和窗口加载失败会显示错误并退出', async () => {
  const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');

  async function runFailure({ readyPromise = Promise.resolve(), createWindow } = {}) {
    const events = [];
    const app = {
      isPackaged: false,
      whenReady: () => readyPromise,
      getPath: () => root,
      on: () => {},
      quit: () => events.push('quit')
    };
    class MockBrowserWindow {
      constructor() {
        if (createWindow) createWindow();
      }
      loadURL() { return Promise.reject(new Error('页面加载失败')); }
      isDestroyed() { return false; }
    }
    MockBrowserWindow.getAllWindows = () => [];
    const context = {
      console: { error: () => {} },
      __dirname: path.join(root, 'electron'),
      process: { env: {}, platform: 'win32' },
      setTimeout,
      clearTimeout,
      require(request) {
        if (request === 'electron') {
          return {
            app,
            BrowserWindow: MockBrowserWindow,
            dialog: { showMessageBox: async () => events.push('show-error') },
            ipcMain: { handle: () => {} }
          };
        }
        return require(request);
      }
    };
    vm.runInNewContext(mainSource, context, { filename: path.join(root, 'electron', 'main.js') });
    await new Promise(resolve => setImmediate(resolve));
    return events;
  }

  assert.deepEqual(await runFailure({ createWindow: () => { throw new Error('窗口创建失败'); } }), ['show-error', 'quit']);
  assert.deepEqual(await runFailure(), ['show-error', 'quit']);
  assert.deepEqual(await runFailure({ readyPromise: Promise.reject(new Error('Electron 初始化失败')) }), ['show-error', 'quit']);
});

test('package scripts and Windows build targets are configured', () => {
  for (const script of ['desktop', 'test', 'check', 'dist:win']) {
    assert.equal(typeof packageJson.scripts[script], 'string');
  }
  assert.deepEqual(packageJson.build.win.target, ['nsis', 'portable']);
  assert.equal(packageJson.build.nsis.oneClick, false);
});
