const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSettingsStore } = require('../electron/settings-store');

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString(value) { return Buffer.from(`encrypted:${value}`, 'utf8'); },
    decryptString(value) { return Buffer.from(value).toString('utf8').replace(/^encrypted:/, ''); }
  };
}

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-settings-'));
}

test('安全存储保存配置但公开状态不包含凭证', () => {
  const userData = tempUserData();
  const store = createSettingsStore({ safeStorage: fakeSafeStorage(), getUserDataPath: () => userData });
  const saved = store.save({
    model: { baseUrl: 'https://model.example/v1', name: 'demo-model', credential: 'model-secret' },
    search: { baseUrl: 'https://search.example/query', credential: 'search-secret' }
  });

  assert.equal(saved.saved, true);
  assert.equal(saved.model.configured, true);
  assert.equal(saved.model.name, 'demo-model');
  assert.equal(saved.search.configured, true);
  assert.doesNotMatch(JSON.stringify(saved), /model-secret|search-secret/);
  assert.doesNotMatch(fs.readFileSync(store.filePath(), 'utf8'), /model-secret|search-secret/);
  assert.deepEqual(store.getServiceConfig(), {
    model: { baseUrl: 'https://model.example/v1', name: 'demo-model', apiKey: 'model-secret' },
    search: { baseUrl: 'https://search.example/query', apiKey: 'search-secret' }
  });
  fs.rmSync(userData, { recursive: true, force: true });
});

test('safeStorage 不可用时明确不保存并返回稳定错误码', () => {
  const userData = tempUserData();
  const store = createSettingsStore({ safeStorage: fakeSafeStorage(false), getUserDataPath: () => userData });
  const result = store.save({ model: { baseUrl: 'https://model.example', name: 'demo', credential: 'secret' } });

  assert.deepEqual(result, {
    saved: false,
    code: 'SAFE_STORAGE_UNAVAILABLE',
    message: 'Windows 安全存储不可用，未保存模型或搜索配置。'
  });
  assert.equal(store.getPublicConfig().safeStorageAvailable, false);
  assert.equal(store.getPublicConfig().model.configured, false);
  assert.equal(fs.existsSync(store.filePath()), false);
  fs.rmSync(userData, { recursive: true, force: true });
});

test('配置文件损坏时按未配置处理，不泄露文件内容', () => {
  const userData = tempUserData();
  const filePath = path.join(userData, 'secure-settings.json');
  fs.writeFileSync(filePath, '{broken', 'utf8');
  const store = createSettingsStore({ safeStorage: fakeSafeStorage(), getUserDataPath: () => userData });

  assert.equal(store.getPublicConfig().model.configured, false);
  assert.equal(store.getServiceConfig().model.apiKey, '');
  fs.rmSync(userData, { recursive: true, force: true });
});

test('credential 是设置输入的统一别名，保存后主进程 service config 可读回', () => {
  const userData = tempUserData();
  const store = createSettingsStore({ safeStorage: fakeSafeStorage(), getUserDataPath: () => userData });
  store.save({
    model: { baseUrl: 'https://model.example/v1', name: 'demo-model', credential: 'model-credential' },
    search: { baseUrl: 'https://search.example/query', credential: 'search-credential' }
  });

  const serviceConfig = store.getServiceConfig();
  assert.equal(serviceConfig.model.apiKey, 'model-credential');
  assert.equal(serviceConfig.search.apiKey, 'search-credential');
  assert.equal(store.getPublicConfig().model.configured, true);
  assert.equal(store.getPublicConfig().search.configured, true);
  fs.rmSync(userData, { recursive: true, force: true });
});

test('credential 顶层别名也能兼容旧式配置提交', () => {
  const userData = tempUserData();
  const store = createSettingsStore({ safeStorage: fakeSafeStorage(), getUserDataPath: () => userData });
  store.save({
    modelBaseUrl: 'https://model.example/v1',
    modelName: 'demo-model',
    modelCredential: 'model-credential',
    searchBaseUrl: 'https://search.example/query',
    searchCredential: 'search-credential'
  });

  assert.equal(store.getServiceConfig().model.apiKey, 'model-credential');
  assert.equal(store.getServiceConfig().search.apiKey, 'search-credential');
  fs.rmSync(userData, { recursive: true, force: true });
});
