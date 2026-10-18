(function (root, factory) {
  const storage = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./storage.js")
    : root.ForwardStepStorage;
  const api = factory(storage);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepWorkspaceBackup = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (storage) {
  const FORMAT = "forward-step-workspace";
  const SCHEMA_VERSION = 1;
  const SCOPES = new Set(["workspace", "knowledge-base"]);
  const WORKSPACE_COLLECTIONS = ["projects", "prompts", "cases", "knowledgeEntries", "references"];
  const KNOWLEDGE_COLLECTIONS = ["knowledgeEntries", "cases"];
  const WORKSPACE_DATA_FIELDS = [
    "schemaVersion", "projects", "prompts", "references", "researchSelection",
    "knowledgeEntries", "knowledgeSelection", "cases", "knowledgeFilters", "knowledgeMetadata"
  ];
  const KNOWLEDGE_DATA_FIELDS = [
    "knowledgeEntries", "cases", "knowledgeMetadata"
  ];
  const BACKUP_CREDENTIAL_FIELDS = [
    "authorization", "password", "credentials", "accessToken", "refresh_token",
    "clientSecret", "client_secret", "modelKey", "modelApiKey", "model_api_key",
    "searchApiKey", "modelCredential", "searchCredential", "authToken", "bearerToken",
    "privateKey", "secretKey", "apiKey", "api_key", "refreshToken"
  ];

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function sanitizeState(state) {
    if (!storage || typeof storage.stripModelKeys !== "function") {
      throw new Error("备份依赖的凭证过滤模块未加载");
    }
    const source = clone(isObject(state) ? state : {});
    const sanitized = clone(source);
    for (const field of ["projects", "prompts", "cases", "knowledgeEntries", "references", "knowledgeMetadata"]) {
      if (Object.hasOwn(source, field)) {
        sanitized[field] = storage.stripModelKeys(source[field], {
          fields: BACKUP_CREDENTIAL_FIELDS,
          preserveBusinessFields: field !== "knowledgeMetadata"
        });
      }
    }
    return sanitized;
  }

  function selectKnowledgeData(state) {
    const data = {
      knowledgeEntries: Array.isArray(state.knowledgeEntries) ? clone(state.knowledgeEntries) : [],
      cases: Array.isArray(state.cases) ? clone(state.cases) : [],
      knowledgeMetadata: isObject(state.knowledgeMetadata) ? clone(state.knowledgeMetadata) : {}
    };
    return KNOWLEDGE_DATA_FIELDS.reduce((result, field) => {
      if (Object.hasOwn(state, field)) data[field] = clone(state[field]);
      return result;
    }, data);
  }

  function selectWorkspaceData(state) {
    const data = WORKSPACE_DATA_FIELDS.reduce((result, field) => {
      if (Object.hasOwn(state, field)) result[field] = clone(state[field]);
      return result;
    }, {});
    data.projects = Array.isArray(state.projects) ? clone(state.projects) : [];
    data.prompts = Array.isArray(state.prompts) ? clone(state.prompts) : [];
    data.references = Array.isArray(state.references) ? clone(state.references) : [];
    data.researchSelection = Array.isArray(state.researchSelection) ? clone(state.researchSelection) : [];
    data.knowledgeEntries = Array.isArray(state.knowledgeEntries) ? clone(state.knowledgeEntries) : [];
    data.knowledgeSelection = Array.isArray(state.knowledgeSelection) ? clone(state.knowledgeSelection) : [];
    data.cases = Array.isArray(state.cases) ? clone(state.cases) : [];
    data.knowledgeFilters = isObject(state.knowledgeFilters) ? clone(state.knowledgeFilters) : {};
    return data;
  }

  function countData(data) {
    return ["projects", "prompts", "cases", "knowledgeEntries", "references"]
      .filter(field => Array.isArray(data[field]))
      .reduce((counts, field) => {
        counts[field] = data[field].length;
        return counts;
      }, {});
  }

  function createBackup(state, { scope = "workspace", appVersion = "", now } = {}) {
    if (!SCOPES.has(scope)) throw new TypeError("备份范围无效");
    const sanitized = sanitizeState(state);
    const data = scope === "workspace" ? selectWorkspaceData(sanitized) : selectKnowledgeData(sanitized);
    const exportedAt = new Date(now === undefined ? Date.now() : now).toISOString();
    const backup = {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      appVersion: String(appVersion ?? ""),
      exportedAt,
      scope,
      counts: countData(data),
      data
    };
    validateBackup(backup);
    return backup;
  }

  function validateCollection(data, field) {
    if (!Array.isArray(data[field])) throw new TypeError(`备份核心数据无效：${field}`);
    const ids = new Set();
    data[field].forEach((item, index) => {
      if (!isObject(item) || typeof item.id !== "string" || !item.id.trim()) {
        throw new TypeError(`备份集合条目稳定 id 无效：${field}[${index}]`);
      }
      const id = item.id.trim();
      if (ids.has(id)) throw new TypeError(`备份集合 id 重复：${field}[${index}]`);
      ids.add(id);
    });
  }

  function validateSelection(data, field) {
    if (!Array.isArray(data[field]) || data[field].some(id => typeof id !== "string" || !id.trim())) {
      throw new TypeError(`备份选择状态无效：${field}`);
    }
  }

  function validateCounts(data, counts, collections) {
    for (const field of collections) {
      if (!Number.isInteger(counts[field]) || counts[field] < 0 || counts[field] !== data[field].length) {
        throw new TypeError(`备份统计无效：${field}`);
      }
    }
  }

  function validateBackupStructure(value) {
    if (!isObject(value)) throw new TypeError("备份必须是对象");
    if (value.format !== FORMAT) throw new TypeError("备份格式不匹配");
    if (value.schemaVersion !== SCHEMA_VERSION) throw new TypeError("备份版本不受支持");
    if (typeof value.appVersion !== "string") throw new TypeError("备份应用版本无效");
    if (typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) {
      throw new TypeError("备份导出时间无效");
    }
    if (!SCOPES.has(value.scope)) throw new TypeError("备份范围无效");
    if (!isObject(value.counts) || !isObject(value.data)) throw new TypeError("备份统计或数据无效");

    const collections = value.scope === "workspace" ? WORKSPACE_COLLECTIONS : KNOWLEDGE_COLLECTIONS;
    const allowedDataFields = value.scope === "workspace" ? WORKSPACE_DATA_FIELDS : KNOWLEDGE_DATA_FIELDS;
    validateAllowedKeys(value.data, allowedDataFields, "数据");
    validateAllowedKeys(value.counts, collections, "统计");
    collections.forEach(field => {
      if (!Array.isArray(value.data[field])) throw new TypeError(`备份核心数据无效：${field}`);
    });
    validateCounts(value.data, value.counts, collections);
    if (value.scope === "workspace") {
      validateSelection(value.data, "knowledgeSelection");
      validateSelection(value.data, "researchSelection");
      if (!isObject(value.data.knowledgeFilters)) throw new TypeError("备份筛选状态无效：knowledgeFilters");
    } else if (!isObject(value.data.knowledgeMetadata)) {
      throw new TypeError("备份资料元数据无效：knowledgeMetadata");
    }
    return collections;
  }

  function validateAllowedKeys(value, allowedFields, label) {
    const allowed = new Set(allowedFields);
    for (const field of Object.keys(value)) {
      if (!allowed.has(field)) throw new TypeError(`备份${label}字段无效：${field}`);
    }
  }

  function validateBackup(value) {
    const collections = validateBackupStructure(value);
    collections.forEach(field => validateCollection(value.data, field));
    return true;
  }

  function getBackupSummary(backup) {
    validateBackup(backup);
    return {
      scope: backup.scope,
      exportedAt: backup.exportedAt,
      counts: clone(backup.counts)
    };
  }

  function replaceState(currentState, backup) {
    validateBackup(backup);
    const data = clone(backup.data);
    if (backup.scope === "workspace") return data;
    return { ...(isObject(currentState) ? clone(currentState) : {}), ...data };
  }

  function mergeCollection(currentItems, incomingItems, report, collection) {
    const current = Array.isArray(currentItems) ? clone(currentItems) : [];
    const incoming = Array.isArray(incomingItems) ? incomingItems : [];
    const knownIds = new Set();
    current.forEach((item, index) => {
      const id = item && typeof item.id === "string" ? item.id.trim() : "";
      if (!id) {
        addReport(report, "skipped", collection, `current-invalid:${index}`, {
          collection, index, id: getOriginalId(item), reason: "current-invalid-id"
        });
        return;
      }
      if (knownIds.has(id)) {
        addReport(report, "skipped", collection, `current-duplicate:${id}`, {
          collection, index, id, reason: "current-duplicate-id"
        });
        return;
      }
      knownIds.add(id);
    });
    const importedIds = new Set();

    for (const [index, item] of incoming.entries()) {
      const id = item && typeof item.id === "string" ? item.id.trim() : "";
      if (!id) {
        addReport(report, "skipped", collection, `incoming-invalid:${index}`, {
          collection, index, id: getOriginalId(item), reason: "incoming-invalid-id"
        });
        continue;
      }
      if (importedIds.has(id)) {
        addReport(report, "skipped", collection, `duplicate:${id}`, {
          collection, index, id, reason: "duplicate-id"
        });
        continue;
      }
      importedIds.add(id);
      if (knownIds.has(id)) {
        addReport(report, "conflicts", collection, `conflict:${id}`, { collection, id });
        continue;
      }
      current.push(clone(item));
      knownIds.add(id);
      addReport(report, "added", collection, `added:${id}`, { collection, id });
    }
    return current;
  }

  function getOriginalId(item) {
    return isObject(item) && Object.hasOwn(item, "id") ? item.id : null;
  }

  function addReport(report, category, collection, key, value) {
    const reportKey = `${collection}:${key}`;
    if (report.seen[category].has(reportKey)) return;
    report.seen[category].add(reportKey);
    report[category].push(value);
  }

  function mergeState(currentState, backup) {
    const collections = validateBackupStructure(backup);
    const state = isObject(currentState) ? clone(currentState) : {};
    const data = backup.data;
    const report = {
      added: [],
      skipped: [],
      conflicts: [],
      seen: {
        added: new Set(),
        skipped: new Set(),
        conflicts: new Set()
      }
    };

    for (const field of collections) {
      if (Array.isArray(data[field])) {
        state[field] = mergeCollection(state[field], data[field], report, field);
      }
    }

    return {
      state,
      added: report.added,
      skipped: report.skipped,
      conflicts: report.conflicts
    };
  }

  return { createBackup, validateBackup, getBackupSummary, replaceState, mergeState };
});
