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
    "knowledgeEntries", "knowledgeSelection", "cases", "knowledgeFilters", "knowledgeMetadata",
    "researchTasks", "platformConnections", "researchAttachments"
  ];
  const KNOWLEDGE_DATA_FIELDS = [
    "knowledgeEntries", "cases", "knowledgeMetadata"
  ];
  const RESEARCH_COLLECTIONS = ["researchTasks", "researchAttachments"];
  const SCALAR = { kind: "scalar" };
  const SCALAR_OR_LIST = { kind: "scalar-or-list" };
  const LIST = { kind: "list" };

  class BackupSerializationError extends Error {
    constructor(message, cause) {
      super(message, { cause });
      this.name = "BackupSerializationError";
      this.code = "BACKUP_SERIALIZATION_FAILED";
    }
  }

  function object(fields) {
    return { kind: "object", fields };
  }

  function array(item) {
    return { kind: "array", item };
  }

  const PROJECT_STEP_FIELDS = {
    id: SCALAR,
    title: SCALAR,
    description: SCALAR,
    deliverable: SCALAR,
    guidance: SCALAR,
    status: SCALAR,
    prompt: SCALAR,
    result: SCALAR,
    notes: SCALAR,
    order: SCALAR,
    index: SCALAR,
    completed: SCALAR_OR_LIST
  };

  const PROMPT_METADATA_FIELDS = {
    status: SCALAR,
    note: SCALAR,
    result: SCALAR,
    testedAt: SCALAR,
    tags: LIST
  };

  const REFERENCE_VERIFICATION_FIELDS = {
    status: SCALAR,
    note: SCALAR
  };

  const CASE_FIELDS = {
    id: SCALAR,
    projectId: SCALAR,
    domain: SCALAR,
    taskType: SCALAR,
    goal: SCALAR,
    preserveItems: LIST,
    before: SCALAR,
    after: SCALAR,
    externalResult: SCALAR,
    userFeedback: SCALAR,
    feedback: SCALAR,
    dimensions: LIST,
    evidence: LIST,
    suggestedLabel: SCALAR,
    status: SCALAR,
    lessons: SCALAR,
    nextPrompt: SCALAR,
    createdAt: SCALAR,
    currentVersion: SCALAR,
    versionHistory: array(object({})),
    applicableWhen: LIST,
    notApplicableWhen: LIST,
    reviewCount: SCALAR,
    lastReviewedAt: SCALAR,
    changeNote: SCALAR,
    reuseDeferredAt: SCALAR,
    confirmed: SCALAR,
    confirmedAt: SCALAR,
    result: SCALAR
  };

  const CASE_VERSION_FIELDS = {
    ...CASE_FIELDS,
    version: SCALAR
  };
  CASE_FIELDS.versionHistory = array(object(CASE_VERSION_FIELDS));

  const PROJECT_FIELDS = {
    id: SCALAR,
    title: SCALAR,
    idea: SCALAR,
    domain: SCALAR,
    methodId: SCALAR,
    methodTemporary: SCALAR,
    methodGuidance: SCALAR,
    goal: SCALAR,
    goalSummary: SCALAR,
    audience: SCALAR,
    currentState: SCALAR,
    constraints: SCALAR,
    facts: SCALAR_OR_LIST,
    successCriteria: LIST,
    assumptions: LIST,
    missingInfo: LIST,
    preserveItems: LIST,
    steps: array(object(PROJECT_STEP_FIELDS)),
    currentStepId: SCALAR,
    currentStep: SCALAR,
    nextAction: SCALAR,
    reply: SCALAR,
    createdAt: SCALAR,
    materials: SCALAR,
    success: SCALAR,
    time: SCALAR,
    webSearch: SCALAR,
    completed: LIST,
    masterPrompt: SCALAR
  };

  const PROMPT_FIELDS = {
    id: SCALAR,
    groupId: SCALAR,
    version: SCALAR,
    title: SCALAR,
    text: SCALAR,
    createdAt: SCALAR,
    updatedAt: SCALAR,
    verified: SCALAR,
    note: SCALAR,
    domain: SCALAR,
    type: SCALAR,
    sourceUrl: SCALAR,
    sourceType: SCALAR,
    sourceKind: SCALAR,
    sourceId: SCALAR,
    summary: SCALAR,
    reusablePatterns: SCALAR,
    limitations: SCALAR,
    licenseNote: SCALAR,
    verificationStatus: SCALAR,
    domains: LIST,
    stages: LIST,
    keywords: LIST,
    metadata: object(PROMPT_METADATA_FIELDS)
  };

  const REFERENCE_FIELDS = {
    id: SCALAR,
    title: SCALAR,
    url: SCALAR,
    link: SCALAR,
    sourceType: SCALAR,
    licenseNote: SCALAR,
    domains: LIST,
    stages: LIST,
    summary: SCALAR,
    borrowablePatterns: SCALAR,
    limitations: SCALAR,
    updatedAt: SCALAR,
    date: SCALAR,
    verification: object(REFERENCE_VERIFICATION_FIELDS),
    kind: SCALAR
  };

  const KNOWLEDGE_ENTRY_FIELDS = {
    id: SCALAR,
    type: SCALAR,
    title: SCALAR,
    sourceUrl: SCALAR,
    url: SCALAR,
    sourceType: SCALAR,
    sourceKind: SCALAR,
    sourceId: SCALAR,
    hiddenAt: SCALAR,
    favorite: SCALAR,
    pinned: SCALAR,
    lastUsedAt: SCALAR,
    customAliases: LIST,
    domains: LIST,
    stages: LIST,
    keywords: LIST,
    summary: SCALAR,
    reusablePatterns: SCALAR,
    limitations: SCALAR,
    licenseNote: SCALAR,
    verificationStatus: SCALAR,
    userRating: SCALAR,
    applicableCases: LIST,
    contentExcerpt: SCALAR,
    linkedProjectId: SCALAR,
    linkedCaseId: SCALAR,
    createdAt: SCALAR,
    updatedAt: SCALAR
  };

  const KNOWLEDGE_METADATA_FIELDS = {
    version: SCALAR,
    schemaVersion: SCALAR,
    createdAt: SCALAR,
    updatedAt: SCALAR,
    lastUpdatedAt: SCALAR,
    entryCount: SCALAR,
    caseCount: SCALAR,
    sourceCount: SCALAR,
    hiddenCount: SCALAR,
    nested: object({
      version: SCALAR,
      schemaVersion: SCALAR,
      createdAt: SCALAR,
      updatedAt: SCALAR,
      lastUpdatedAt: SCALAR,
      note: SCALAR,
      label: SCALAR
    })
  };

  const KNOWLEDGE_FILTER_FIELDS = {
    query: SCALAR,
    type: SCALAR,
    domain: SCALAR,
    stage: SCALAR,
    verificationStatus: SCALAR
  };

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new TypeError("值无法序列化为 JSON");
      return JSON.parse(serialized);
    } catch (error) {
      if (error && error.code === "BACKUP_SERIALIZATION_FAILED") throw error;
      const detail = error instanceof Error && error.message ? error.message : String(error);
      throw new BackupSerializationError(`备份数据序列化失败：${detail}`, error);
    }
  }

  function isScalar(value) {
    return value === null || ["string", "number", "boolean"].includes(typeof value);
  }

  function sanitizeBySchema(value, schema) {
    if (!schema) return undefined;
    if (schema.kind === "scalar") return isScalar(value) ? clone(value) : undefined;
    if (schema.kind === "scalar-or-list") {
      if (isScalar(value)) return clone(value);
      if (Array.isArray(value)) return value.filter(isScalar).map(clone);
      return undefined;
    }
    if (schema.kind === "list") {
      return Array.isArray(value) ? value.filter(isScalar).map(clone) : undefined;
    }
    if (schema.kind === "array") {
      return Array.isArray(value)
        ? value.map(item => sanitizeBySchema(item, schema.item)).filter(item => item !== undefined)
        : undefined;
    }
    if (schema.kind === "object") {
      if (!isObject(value)) return undefined;
      return Object.entries(value).reduce((result, [key, item]) => {
        if (!Object.hasOwn(schema.fields, key)) return result;
        const sanitized = sanitizeBySchema(item, schema.fields[key]);
        if (sanitized !== undefined) result[key] = sanitized;
        return result;
      }, {});
    }
    return undefined;
  }

  function sanitizeCollection(value, fields) {
    return sanitizeBySchema(value, array(object(fields))) || [];
  }

  function sanitizeState(state) {
    const source = clone(isObject(state) ? state : {});
    const sanitized = clone(source);
    sanitized.projects = sanitizeCollection(source.projects, PROJECT_FIELDS);
    sanitized.prompts = sanitizeCollection(source.prompts, PROMPT_FIELDS);
    sanitized.cases = sanitizeCollection(source.cases, CASE_FIELDS);
    sanitized.knowledgeEntries = sanitizeCollection(source.knowledgeEntries, KNOWLEDGE_ENTRY_FIELDS);
    sanitized.references = sanitizeCollection(source.references, REFERENCE_FIELDS);
    sanitized.knowledgeMetadata = sanitizeBySchema(source.knowledgeMetadata, object(KNOWLEDGE_METADATA_FIELDS)) || {};
    sanitized.knowledgeFilters = sanitizeBySchema(source.knowledgeFilters, object(KNOWLEDGE_FILTER_FIELDS)) || {};
    if (storage && typeof storage.sanitizeResearchState === "function") {
      Object.assign(sanitized, storage.sanitizeResearchState(source));
    }
    return sanitized;
  }

  function sanitizeBackupData(scope, data) {
    const source = isObject(data) ? clone(data) : {};
    const sanitizedState = sanitizeState(source);
    const allowedFields = scope === "workspace" ? WORKSPACE_DATA_FIELDS : KNOWLEDGE_DATA_FIELDS;
    return allowedFields.reduce((result, field) => {
      if (Object.hasOwn(source, field)) result[field] = clone(sanitizedState[field]);
      return result;
    }, {});
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
    data.researchTasks = Array.isArray(state.researchTasks) ? clone(state.researchTasks) : [];
    data.platformConnections = isObject(state.platformConnections) ? clone(state.platformConnections) : {};
    data.researchAttachments = Array.isArray(state.researchAttachments) ? clone(state.researchAttachments) : [];
    return data;
  }

  function countData(data) {
    return ["projects", "prompts", "cases", "knowledgeEntries", "references", ...RESEARCH_COLLECTIONS]
      .filter(field => Array.isArray(data[field]))
      .reduce((counts, field) => {
        // 旧备份摘要不包含新增研究集合的零计数，保持旧调用方的结构兼容。
        if (!RESEARCH_COLLECTIONS.includes(field) || data[field].length > 0) counts[field] = data[field].length;
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
    validateAllowedKeys(value.counts, [...collections, ...RESEARCH_COLLECTIONS], "统计");
    collections.forEach(field => {
      if (!Array.isArray(value.data[field])) throw new TypeError(`备份核心数据无效：${field}`);
    });
    validateCounts(value.data, value.counts, collections);
    if (value.scope === "workspace") {
      validateSelection(value.data, "knowledgeSelection");
      validateSelection(value.data, "researchSelection");
      if (!isObject(value.data.knowledgeFilters)) throw new TypeError("备份筛选状态无效：knowledgeFilters");
      if (Object.hasOwn(value.data, "researchTasks") && !Array.isArray(value.data.researchTasks)) {
        throw new TypeError("备份核心数据无效：researchTasks");
      }
      if (Object.hasOwn(value.data, "researchAttachments") && !Array.isArray(value.data.researchAttachments)) {
        throw new TypeError("备份核心数据无效：researchAttachments");
      }
      if (Object.hasOwn(value.data, "platformConnections") && !isObject(value.data.platformConnections)) {
        throw new TypeError("备份平台连接状态无效：platformConnections");
      }
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
    for (const field of RESEARCH_COLLECTIONS) {
      if (Array.isArray(value.data[field])) validateCollection(value.data, field);
    }
    return true;
  }

  function sanitizeResearchBackupData(data) {
    if (!storage || typeof storage.sanitizeResearchState !== "function") {
      throw new Error("备份依赖的研究数据清洗模块未加载");
    }
    const sanitized = storage.sanitizeResearchState(data);
    const result = { ...data };
    for (const field of ["researchTasks", "platformConnections", "researchAttachments"]) {
      if (Object.hasOwn(data, field)) result[field] = sanitized[field];
    }
    return result;
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
    const data = sanitizeBackupData(backup.scope, backup.data);
    if (backup.scope === "workspace") return data;
    const current = sanitizeState(currentState);
    return { ...current, ...data };
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
    // 先校验备份顶层契约；条目内容复用同一 schema 白名单清洗。
    // 被 schema 判定为非法并丢弃的研究条目不会进入 mergeCollection，也不应被报告为成功新增。
    const collections = validateBackupStructure(backup);
    const state = sanitizeState(currentState);
    const data = sanitizeBackupData(backup.scope, backup.data);
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
    for (const field of RESEARCH_COLLECTIONS) {
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

  return {
    BackupSerializationError,
    createBackup,
    validateBackup,
    getBackupSummary,
    replaceState,
    mergeState
  };
});
