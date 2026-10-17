const fs = require('node:fs');
const path = require('node:path');

const SETTINGS_FILE = 'secure-settings.json';

function emptyConfig() {
  return {
    model: { baseUrl: '', name: '', apiKey: '' },
    search: { baseUrl: '', apiKey: '' }
  };
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readCredential(section, input, previous) {
  const candidates = [
    section?.credential,
    section?.apiKey,
    input?.credential,
    input?.apiKey,
    previous
  ];
  return candidates.map(cleanText).find(Boolean) || '';
}

function encode(safeStorage, value) {
  return safeStorage.encryptString(String(value || '')).toString('base64');
}

function decode(safeStorage, value) {
  return typeof value === 'string' ? safeStorage.decryptString(Buffer.from(value, 'base64')) : '';
}

function hasEncryption(safeStorage) {
  try {
    return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function publicConfig(config, safeStorageAvailable) {
  return {
    safeStorageAvailable,
    model: {
      configured: Boolean(config.model.baseUrl && config.model.name && config.model.apiKey),
      name: config.model.name,
      baseUrl: config.model.baseUrl
    },
    search: {
      configured: Boolean(config.search.baseUrl && config.search.apiKey),
      baseUrl: config.search.baseUrl
    }
  };
}

function createSettingsStore({ safeStorage, getUserDataPath, fsModule = fs } = {}) {
  if (typeof getUserDataPath !== 'function') throw new TypeError('缺少 userData 路径提供函数');

  function filePath() {
    return path.join(getUserDataPath(), SETTINGS_FILE);
  }

  function readRaw() {
    try {
      return JSON.parse(fsModule.readFileSync(filePath(), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      return null;
    }
  }

  function read() {
    const available = hasEncryption(safeStorage);
    if (!available) return { config: emptyConfig(), safeStorageAvailable: false };

    const raw = readRaw();
    if (!raw || typeof raw !== 'object') return { config: emptyConfig(), safeStorageAvailable: true };

    try {
      const config = emptyConfig();
      config.model.baseUrl = decode(safeStorage, raw.model?.baseUrl);
      config.model.name = decode(safeStorage, raw.model?.name);
      config.model.apiKey = decode(safeStorage, raw.model?.apiKey);
      config.search.baseUrl = decode(safeStorage, raw.search?.baseUrl);
      config.search.apiKey = decode(safeStorage, raw.search?.apiKey);
      return { config, safeStorageAvailable: true };
    } catch {
      return { config: emptyConfig(), safeStorageAvailable: true };
    }
  }

  function getPublicConfig() {
    const { config, safeStorageAvailable } = read();
    return publicConfig(config, safeStorageAvailable);
  }

  function getServiceConfig() {
    return read().config;
  }

  function save(input = {}) {
    if (!hasEncryption(safeStorage)) {
      return {
        saved: false,
        code: 'SAFE_STORAGE_UNAVAILABLE',
        message: 'Windows 安全存储不可用，未保存模型或搜索配置。'
      };
    }

    const previous = read().config;
    const sourceModel = input.model || {};
    const sourceSearch = input.search || {};
    const config = {
      model: {
        baseUrl: cleanText(sourceModel.baseUrl ?? input.modelBaseUrl ?? previous.model.baseUrl),
        name: cleanText(sourceModel.name ?? input.modelName ?? previous.model.name),
        apiKey: readCredential(sourceModel, { credential: input.modelCredential, apiKey: input.modelApiKey }, previous.model.apiKey)
      },
      search: {
        baseUrl: cleanText(sourceSearch.baseUrl ?? input.searchBaseUrl ?? previous.search.baseUrl),
        apiKey: readCredential(sourceSearch, { credential: input.searchCredential, apiKey: input.searchApiKey }, previous.search.apiKey)
      }
    };

    try {
      fsModule.mkdirSync(getUserDataPath(), { recursive: true });
      const stored = {
        version: 1,
        model: {
          baseUrl: encode(safeStorage, config.model.baseUrl),
          name: encode(safeStorage, config.model.name),
          apiKey: encode(safeStorage, config.model.apiKey)
        },
        search: {
          baseUrl: encode(safeStorage, config.search.baseUrl),
          apiKey: encode(safeStorage, config.search.apiKey)
        }
      };
      fsModule.writeFileSync(filePath(), JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 });
      return { saved: true, ...publicConfig(config, true) };
    } catch {
      return {
        saved: false,
        code: 'SAFE_SETTINGS_SAVE_FAILED',
        message: '模型或搜索配置无法安全保存，请检查应用数据目录权限。'
      };
    }
  }

  return { filePath, read, getPublicConfig, getServiceConfig, save };
}

module.exports = { SETTINGS_FILE, createSettingsStore, publicConfig };
