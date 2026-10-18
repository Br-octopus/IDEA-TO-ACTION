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
  const KNOWLEDGE_DATA_FIELDS = [
    "knowledgeEntries", "cases", "knowledgeSelection", "knowledgeFilters",
    "knowledgeMetadata", "caseFilters", "filterState"
  ];

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function sanitizeState(state) {
    if (!storage || typeof storage.migrateState !== "function") {
      throw new Error("备份依赖的状态迁移模块未加载");
    }
    // 统一复用现有迁移入口，其中包含递归凭证剔除规则，避免备份层维护第二套规则。
    return clone(storage.migrateState(isObject(state) ? state : {}));
  }

  function selectKnowledgeData(state) {
    const data = {
      knowledgeEntries: Array.isArray(state.knowledgeEntries) ? clone(state.knowledgeEntries) : [],
      cases: Array.isArray(state.cases) ? clone(state.cases) : [],
      knowledgeSelection: Array.isArray(state.knowledgeSelection) ? clone(state.knowledgeSelection) : [],
      knowledgeFilters: isObject(state.knowledgeFilters) ? clone(state.knowledgeFilters) : {}
    };
    return KNOWLEDGE_DATA_FIELDS.reduce((result, field) => {
      if (Object.hasOwn(state, field)) data[field] = clone(state[field]);
      return result;
    }, data);
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
    const data = scope === "workspace"
      ? {
        ...sanitized,
        researchSelection: Array.isArray(sanitized.researchSelection) ? clone(sanitized.researchSelection) : [],
        knowledgeSelection: Array.isArray(sanitized.knowledgeSelection) ? clone(sanitized.knowledgeSelection) : [],
        knowledgeFilters: isObject(sanitized.knowledgeFilters) ? clone(sanitized.knowledgeFilters) : {}
      }
      : selectKnowledgeData(sanitized);
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
    data[field].forEach((item, index) => {
      if (!isObject(item) || typeof item.id !== "string" || !item.id.trim()) {
        throw new TypeError(`备份集合条目稳定 id 无效：${field}[${index}]`);
      }
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

  function validateBackup(value) {
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
    collections.forEach(field => validateCollection(value.data, field));
    validateCounts(value.data, value.counts, collections);
    validateSelection(value.data, "knowledgeSelection");
    if (value.scope === "workspace") validateSelection(value.data, "researchSelection");
    if (!isObject(value.data.knowledgeFilters)) throw new TypeError("备份筛选状态无效：knowledgeFilters");
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
        report.skipped.push({ collection, index, id: null, reason: "current-invalid-id" });
        return;
      }
      knownIds.add(id);
    });
    const importedIds = new Set();

    for (const [index, item] of incoming.entries()) {
      const id = item && typeof item.id === "string" ? item.id.trim() : "";
      if (!id) {
        report.skipped.push({ collection, index, id: null, reason: "incoming-invalid-id" });
        continue;
      }
      if (importedIds.has(id)) {
        report.skipped.push(id);
        continue;
      }
      importedIds.add(id);
      if (knownIds.has(id)) {
        report.conflicts.push(id);
        continue;
      }
      current.push(clone(item));
      knownIds.add(id);
      report.added.push(id);
    }
    return current;
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function mergeState(currentState, backup) {
    validateBackup(backup);
    const state = isObject(currentState) ? clone(currentState) : {};
    const data = backup.data;
    const report = { added: [], skipped: [], conflicts: [] };
    const collections = backup.scope === "workspace" ? WORKSPACE_COLLECTIONS : KNOWLEDGE_COLLECTIONS;

    for (const field of collections) {
      if (Array.isArray(data[field])) {
        state[field] = mergeCollection(state[field], data[field], report, field);
      }
    }

    return {
      state,
      added: unique(report.added),
      skipped: unique(report.skipped),
      conflicts: unique(report.conflicts)
    };
  }

  return { createBackup, validateBackup, getBackupSummary, replaceState, mergeState };
});
