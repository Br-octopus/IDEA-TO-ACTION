const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { startServer } = require('../server');

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
  assert.equal(registeredHandlers.size, 4);
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
