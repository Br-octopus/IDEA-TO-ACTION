const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

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
  for (const method of ['getConfig', 'saveConfig', 'requestModel', 'requestSearch']) {
    assert.match(preload, new RegExp(`${method}\\s*:`));
  }
});

test('生产模式启动内置服务后通过本地 URL 加载页面', async () => {
  const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const events = [];
  const registeredHandlers = new Map();
  const app = {
    isPackaged: true,
    whenReady: () => Promise.resolve(),
    getAppPath: () => root,
    getPath: () => root,
    on: () => {}
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
    setTimeout,
    clearTimeout,
    process: { env: {}, platform: 'win32' },
    fetch: async () => {
      events.push('service-ready');
      return { ok: true };
    },
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
        events.push('start-bundled-service');
        return {};
      }
      return require(request);
    }
  };
  vm.runInNewContext(mainSource, context, { filename: path.join(root, 'electron', 'main.js') });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(events, [
    'create-window',
    'start-bundled-service',
    'service-ready',
    'load-url:http://127.0.0.1:4173'
  ]);
  assert.equal(registeredHandlers.size, 4);
  assert.doesNotMatch(mainSource, /loadFile\(/);
});

test('package scripts and Windows build targets are configured', () => {
  for (const script of ['desktop', 'test', 'check', 'dist:win']) {
    assert.equal(typeof packageJson.scripts[script], 'string');
  }
  assert.deepEqual(packageJson.build.win.target, ['nsis', 'portable']);
  assert.equal(packageJson.build.nsis.oneClick, false);
});
