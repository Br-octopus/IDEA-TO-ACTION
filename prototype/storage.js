(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepStorage = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const knowledgeSchema = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./knowledge-schema.js")
    : typeof globalThis === "undefined"
      ? null
      : globalThis.ForwardStepKnowledgeSchema;
  const socialResearchSchema = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./social-research-schema.js")
    : typeof globalThis === "undefined"
      ? null
      : globalThis.ForwardStepSocialResearchSchema;
  const STORAGE_KEY = "forward-step.workspace.v2";
  const LEGACY_STORAGE_KEY = "forward-step.workspace.v1";
  const CASE_FIELDS = [
    "id", "projectId", "domain", "taskType", "goal", "preserveItems", "before", "after",
    "externalResult", "userFeedback", "dimensions", "evidence", "suggestedLabel", "status",
    "lessons", "nextPrompt", "createdAt", "currentVersion", "versionHistory",
    "applicableWhen", "notApplicableWhen", "reviewCount", "lastReviewedAt", "changeNote", "reuseDeferredAt"
  ];
  const CASE_VERSION_FIELDS = [
    "status", "suggestedLabel", "evidence", "lessons", "nextPrompt",
    "applicableWhen", "notApplicableWhen"
  ];
  const STATE_FIELDS = [
    "schemaVersion", "projects", "prompts", "references", "researchSelection",
    "knowledgeEntries", "knowledgeSelection", "cases", "knowledgeFilters",
    "knowledgeMetadata", "researchTasks", "platformConnections", "researchAttachments", "settings"
  ];

  function createEmptyState() {
    return {
      schemaVersion: 3,
      projects: [],
      prompts: [],
      references: [],
      researchSelection: [],
      knowledgeEntries: [],
      knowledgeSelection: [],
      cases: [],
      researchTasks: [],
      platformConnections: {},
      researchAttachments: []
    };
  }

  class KnowledgeSchemaUnavailableError extends Error {
    constructor() {
      super("知识条目 schema 未加载，无法安全迁移已有知识条目");
      this.name = "KnowledgeSchemaUnavailableError";
      this.code = "KNOWLEDGE_SCHEMA_UNAVAILABLE";
    }
  }

  class StorageReadError extends Error {
    constructor(message, cause, code = "STORAGE_READ_FAILED") {
      super(message, { cause });
      this.name = "StorageReadError";
      this.code = code;
    }
  }

  function resolveStorage(storage) {
    if (storage !== undefined) return storage;
    try {
      return typeof globalThis === "undefined" ? null : globalThis.localStorage ?? null;
    } catch (error) {
      throw new StorageReadError("无法访问浏览器本地存储", error);
    }
  }

  function stripModelKeys(value, options = {}, path = []) {
    const hasExplicitFields = Array.isArray(options.fields);
    const credentialFields = new Set((hasExplicitFields
      ? options.fields
      : ["authorization", "password", "credentials", "credential", "token", "secret"])
      .map(key => String(key).toLowerCase().replace(/[^a-z0-9]/g, "")));
    if (Array.isArray(value)) return value.map(item => stripModelKeys(item, options, path));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        const currentIsBusinessField = options.preserveBusinessFields === true
          && path.length === 0
          && ["token", "secret"].includes(normalized);
        const currentMatchesPattern = /^(?:api|model|search|access|refresh|client|auth|bearer|private)(?:api)?(?:key|token|secret|credential)$/.test(normalized);
        const currentIsOAuthCredential = /^oauth(?:[a-z0-9]+)?(?:token|key|secret|credential)$/.test(normalized);
        const currentIsSensitive = /(?:cookie|session|password|credential|authorization|profilepath|authblob)/.test(normalized)
          || /(?:api|access|refresh|session|auth|bearer|client|private|model|search)(?:key|token|secret|credential)$/.test(normalized);
        return currentIsBusinessField
          || (!credentialFields.has(normalized) && !currentMatchesPattern && !currentIsOAuthCredential && !currentIsSensitive);
      })
      .map(([key, item]) => [key, stripModelKeys(item, options, [...path, key])]));
  }

  function withProjectDefaults(project) {
    const source = project && typeof project === "object" ? project : {};
    const legacySuccess = Array.isArray(source.success)
      ? source.success
      : typeof source.success === "string" && source.success.trim()
        ? [source.success]
        : [];
    return {
      ...source,
      methodId: source.methodId ?? "",
      methodTemporary: source.methodTemporary ?? source.domain === "其他",
      goalSummary: source.goalSummary ?? source.idea ?? "",
      audience: source.audience ?? "",
      currentState: source.currentState ?? "",
      constraints: source.constraints ?? "",
      successCriteria: Array.isArray(source.successCriteria) ? source.successCriteria : legacySuccess,
      assumptions: Array.isArray(source.assumptions) ? source.assumptions : [],
      missingInfo: Array.isArray(source.missingInfo) ? source.missingInfo : [],
      preserveItems: Array.isArray(source.preserveItems) ? source.preserveItems : [],
      steps: Array.isArray(source.steps) ? source.steps : [],
      currentStepId: source.currentStepId ?? "",
      nextAction: source.nextAction ?? "",
      reply: source.reply ?? "",
      createdAt: source.createdAt ?? "",
      materials: source.materials ?? "",
      success: source.success ?? "",
      time: source.time ?? "",
      webSearch: source.webSearch ?? false,
      completed: Array.isArray(source.completed) ? source.completed : []
    };
  }

  function getReferenceCatalog() {
    if (typeof module === "object" && module.exports && typeof require === "function") {
      return require("./research-catalog.js").catalog;
    }
    return typeof globalThis === "undefined"
      ? []
      : globalThis.ForwardStepResearchCatalog?.catalog || [];
  }

  function sanitizeResearchSelection(selection) {
    const knownIds = new Set(getReferenceCatalog().map(item => item.id));
    return [...new Set(Array.isArray(selection) ? selection : [])]
      .filter(id => typeof id === "string" && knownIds.has(id))
      .slice(0, 3);
  }

  // 知识选择只保存资料 id，最多 5 条，且必须指向统一索引里已有的条目
  // 统一索引包含本地知识条目和公开资料，公开资料 id 也算合法选择
  function sanitizeKnowledgeSelection(selection, entries) {
    const knownIds = new Set([...(Array.isArray(entries) ? entries : [])
      .map(item => item && item.id)
      .filter(Boolean), ...getReferenceCatalog().map(item => item.id)]);
    return [...new Set(Array.isArray(selection) ? selection : [])]
      .filter(id => typeof id === "string" && knownIds.has(id))
      .slice(0, 5);
  }

  function listValue(value) {
    if (Array.isArray(value)) return value.filter(item => item !== null && item !== undefined && String(item).trim());
    if (typeof value === "string") return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    return [];
  }

  function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  }

  function nonNegativeInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : fallback;
  }

  function createCaseVersionSnapshot(caseItem, version, changeNote = "") {
    const {
      versionHistory,
      currentVersion,
      reviewCount,
      lastReviewedAt,
      confirmed,
      confirmedAt,
      ...snapshot
    } = caseItem;
    return {
      ...snapshot,
      version,
      changeNote: String(changeNote || "").trim()
    };
  }

  function hasCaseVersionChange(previousCase, nextCase) {
    return CASE_VERSION_FIELDS.some(field => (
      !sameCaseValue(previousCase[field], nextCase[field])
    ));
  }

  function sameCaseValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function hasValidCaseVersionHistory(caseItem) {
    const { versionHistory, currentVersion, reviewCount, lastReviewedAt } = caseItem;
    const targetVersion = positiveInteger(currentVersion, 0);
    if (!Array.isArray(versionHistory) || versionHistory.length === 0 || versionHistory.length !== targetVersion) {
      return false;
    }
    if (positiveInteger(reviewCount, 0) <= 0 || !String(lastReviewedAt ?? "").trim()) return false;
    const hasContinuousVersions = versionHistory.every((version, index) => (
      version
      && typeof version === "object"
      && positiveInteger(version.version, 0) === index + 1
    ));
    if (!hasContinuousVersions) return false;

    const latestVersion = versionHistory[versionHistory.length - 1];
    return CASE_VERSION_FIELDS.every(field => sameCaseValue(latestVersion[field], caseItem[field]));
  }

  function migrateConfirmedCase(reviewedCase) {
    const normalized = normalizeCase(reviewedCase);
    const confirmedAt = String(reviewedCase.confirmedAt ?? "").trim();
    const createdAt = String(reviewedCase.createdAt ?? normalized.createdAt ?? "").trim();
    const reviewedAt = confirmedAt || createdAt || new Date().toISOString();

    if (hasValidCaseVersionHistory(normalized)) {
      return {
        ...normalized,
        confirmed: true,
        confirmedAt: reviewedAt
      };
    }

    return {
      ...normalized,
      currentVersion: 1,
      versionHistory: [createCaseVersionSnapshot(normalized, 1, normalized.changeNote)],
      reviewCount: 1,
      lastReviewedAt: reviewedAt,
      confirmed: true,
      confirmedAt: reviewedAt
    };
  }

  function normalizeCase(reviewedCase = {}) {
    const source = stripModelKeys(reviewedCase);
    const after = source.after ?? source.externalResult ?? "";
    const externalResult = source.externalResult ?? after;
    const rawStatus = String(source.status ?? "待验证").trim();
    const status = ["成功", "失败", "待验证"].includes(rawStatus) ? rawStatus : "待验证";
    return {
      ...source,
      id: typeof source.id === "string" ? source.id.trim() : "",
      projectId: String(source.projectId ?? "").trim(),
      domain: String(source.domain ?? "").trim(),
      taskType: String(source.taskType ?? "").trim(),
      goal: String(source.goal ?? "").trim(),
      preserveItems: listValue(source.preserveItems),
      before: String(source.before ?? "").trim(),
      after: String(after).trim(),
      externalResult: String(externalResult).trim(),
      userFeedback: String(source.userFeedback ?? source.feedback ?? "").trim(),
      dimensions: listValue(source.dimensions),
      evidence: listValue(source.evidence),
      suggestedLabel: String(source.suggestedLabel ?? "").trim(),
      status,
      lessons: String(source.lessons ?? "").trim(),
      nextPrompt: String(source.nextPrompt ?? "").trim(),
      createdAt: String(source.createdAt ?? "").trim() || new Date().toISOString(),
      currentVersion: positiveInteger(source.currentVersion, 1),
      versionHistory: Array.isArray(source.versionHistory) ? source.versionHistory : [],
      applicableWhen: listValue(source.applicableWhen),
      notApplicableWhen: listValue(source.notApplicableWhen),
      reviewCount: nonNegativeInteger(source.reviewCount, 0),
      lastReviewedAt: String(source.lastReviewedAt ?? "").trim(),
      changeNote: String(source.changeNote ?? "").trim(),
      reuseDeferredAt: String(source.reuseDeferredAt ?? "").trim()
    };
  }

  function normalizeKnowledgeEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    if (!knowledgeSchema || typeof knowledgeSchema.normalizeKnowledgeEntry !== "function") {
      throw new KnowledgeSchemaUnavailableError();
    }
    return stripModelKeys(entries)
      .map(knowledgeSchema.normalizeKnowledgeEntry)
      .filter(item => item.id);
  }

  function sanitizeResearchState(state) {
    if (!socialResearchSchema || typeof socialResearchSchema.sanitizeResearchState !== "function") {
      return {
        researchTasks: [],
        platformConnections: {},
        researchAttachments: []
      };
    }
    return socialResearchSchema.sanitizeResearchState(state);
  }

  function migrateState(input) {
    const source = input && typeof input === "object" ? input : {};
    const entries = normalizeKnowledgeEntries(source.knowledgeEntries);
    const researchState = sanitizeResearchState(source);
    const knownState = stripModelKeys(source);
    const state = {
      ...createEmptyState(),
      ...Object.fromEntries(STATE_FIELDS
        .filter(field => Object.hasOwn(knownState, field))
        .map(field => [field, knownState[field]])),
      schemaVersion: 3,
      projects: Array.isArray(source.projects) ? stripModelKeys(source.projects).map(withProjectDefaults) : [],
      prompts: Array.isArray(source.prompts) ? stripModelKeys(source.prompts) : [],
      references: Array.isArray(source.references) ? stripModelKeys(source.references) : [],
      // 旧版 researchSelection 的公开资料 id 已全部并入 knowledgeSelection，
      // 这里必须清空，保证发送路径只有 knowledgeSelection 一条注入通道
      researchSelection: [],
      knowledgeEntries: entries,
      // 旧版 researchSelection 存的就是公开资料 id，且与统一索引里的公开资料 id 一致，
      // 所以这里映射进 knowledgeSelection 合并去重。合并时本地资料优先、公开资料按原顺序补位，
      // 最后由 sanitize 校验合法 id 并统一截断到 5 条
      knowledgeSelection: sanitizeKnowledgeSelection(
        [
          ...(Array.isArray(source.knowledgeSelection) ? source.knowledgeSelection : []),
          ...(Array.isArray(source.researchSelection) ? source.researchSelection : [])
        ],
        entries
      ),
      cases: Array.isArray(source.cases)
        ? stripModelKeys(source.cases)
          .filter(item => item && item.confirmed === true)
          .map(migrateConfirmedCase)
        : [],
      ...researchState
    };
    return state;
  }

  function loadState(storage) {
    const store = resolveStorage(storage);
    if (!store) return { state: createEmptyState(), warning: null };
    let raw;
    try {
      raw = store.getItem(STORAGE_KEY);
      if (!raw) raw = store.getItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      throw new StorageReadError("读取本地数据失败", error);
    }
    if (!raw) return { state: createEmptyState(), warning: null };

    let migrated;
    try {
      migrated = migrateState(JSON.parse(raw));
    } catch (error) {
      if (error && error.code === "KNOWLEDGE_SCHEMA_UNAVAILABLE") throw error;
      throw new StorageReadError("本地数据格式无效，未加载任何数据", error, "STORAGE_PARSE_FAILED");
    }

    try {
      store.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return { state: migrated, warning: null };
    } catch (error) {
      return {
        state: migrated,
        warning: { code: "STORAGE_MIGRATION_WRITE_FAILED", message: error.message || "本地存储写入失败" }
      };
    }
  }

  function saveState(storage, state) {
    const store = resolveStorage(storage);
    if (!store) return createEmptyState();
    const sanitized = migrateState(state);
    store.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    return sanitized;
  }

  function addPromptVersion(state, prompt) {
    const next = migrateState(state);
    const groupId = prompt.groupId || "manual";
    const version = next.prompts
      .filter(item => (item.groupId || "manual") === groupId)
      .reduce((max, item) => Math.max(max, Number(item.version) || 0), 0) + 1;
    const saved = { ...prompt, groupId, version, verified: false, note: "" };
    next.prompts.unshift(saved);
    return { state: next, prompt: saved };
  }

  function confirmCase(state, reviewedCase, confirmed) {
    const next = migrateState(state);
    if (confirmed !== true) return next;
    if (!reviewedCase || typeof reviewedCase !== "object") throw new TypeError("需要提供已复核的案例");
    if (typeof reviewedCase.id !== "string" || !reviewedCase.id.trim()) throw new TypeError("已复核案例必须提供非空 id");
    const caseId = reviewedCase.id.trim();
    if (next.cases.some(item => typeof item.id === "string" && item.id.trim() === caseId)) return next;
    const sanitizedCase = normalizeCase({ ...reviewedCase, id: caseId });
    const confirmedAt = new Date().toISOString();
    const versionOne = createCaseVersionSnapshot(sanitizedCase, 1, sanitizedCase.changeNote);
    next.cases.unshift({
      ...sanitizedCase,
      currentVersion: 1,
      versionHistory: [versionOne],
      reviewCount: 1,
      lastReviewedAt: confirmedAt,
      confirmed: true,
      confirmedAt
    });
    return next;
  }

  function updateCase(state, reviewedCase) {
    const next = migrateState(state);
    if (!reviewedCase || typeof reviewedCase !== "object") throw new TypeError("需要提供要修改的案例");
    if (typeof reviewedCase.id !== "string" || !reviewedCase.id.trim()) throw new TypeError("要修改的案例必须提供非空 id");
    const caseId = reviewedCase.id.trim();
    const index = next.cases.findIndex(item => item.id === caseId);
    if (index < 0) return next;
    const existing = next.cases[index];
    const currentVersion = positiveInteger(existing.currentVersion, 1);
    const nextVersion = currentVersion + 1;
    const changeNote = String(reviewedCase.changeNote ?? "").trim();
    const merged = normalizeCase({
      ...existing,
      ...reviewedCase,
      id: caseId,
      createdAt: existing.createdAt,
      changeNote
    });
    if (!hasCaseVersionChange(existing, merged)) {
      next.cases[index] = {
        ...merged,
        currentVersion,
        versionHistory: existing.versionHistory,
        reviewCount: existing.reviewCount,
        lastReviewedAt: existing.lastReviewedAt,
        confirmed: true,
        confirmedAt: existing.confirmedAt
      };
      return next;
    }
    const versionHistory = Array.isArray(existing.versionHistory) && existing.versionHistory.length > 0
      ? existing.versionHistory.slice()
      : [createCaseVersionSnapshot(existing, currentVersion, existing.changeNote)];
    versionHistory.push(createCaseVersionSnapshot(merged, nextVersion, changeNote));
    const lastReviewedAt = new Date().toISOString();
    next.cases[index] = {
      ...merged,
      currentVersion: nextVersion,
      versionHistory,
      reviewCount: nonNegativeInteger(existing.reviewCount, 0) + 1,
      lastReviewedAt,
      confirmed: true,
      confirmedAt: existing.confirmedAt || lastReviewedAt
    };
    return next;
  }

  function upsertKnowledgeEntry(state, entry) {
    const next = migrateState(state);
    if (!knowledgeSchema || typeof knowledgeSchema.normalizeKnowledgeEntry !== "function") {
      throw new KnowledgeSchemaUnavailableError();
    }
    const normalized = knowledgeSchema.normalizeKnowledgeEntry(entry);
    if (!normalized.id) throw new TypeError("知识条目必须提供非空 id");

    const linkedCaseId = normalized.linkedCaseId;
    const existingIndex = linkedCaseId
      ? next.knowledgeEntries.findIndex(item => item.linkedCaseId === linkedCaseId)
      : next.knowledgeEntries.findIndex(item => item.id === normalized.id);
    const now = new Date().toISOString();

    if (existingIndex < 0) {
      const saved = { ...normalized, updatedAt: now };
      next.knowledgeEntries.unshift(saved);
      return { state: next, entry: saved, updated: false };
    }

    const existing = next.knowledgeEntries[existingIndex];
    const saved = {
      ...existing,
      ...normalized,
      id: existing.id || normalized.id,
      createdAt: existing.createdAt || normalized.createdAt,
      updatedAt: now
    };
    next.knowledgeEntries[existingIndex] = saved;
    next.knowledgeEntries = next.knowledgeEntries.filter((item, index) => (
      index === existingIndex || !linkedCaseId || item.linkedCaseId !== linkedCaseId
    ));
    return { state: next, entry: saved, updated: true };
  }

  function listCaseVersions(caseItem) {
    if (!caseItem || typeof caseItem !== "object") return [];
    if (Array.isArray(caseItem.versionHistory) && caseItem.versionHistory.length) {
      return caseItem.versionHistory.map(version => ({ ...version }));
    }
    const version = positiveInteger(caseItem.currentVersion, 1);
    return [createCaseVersionSnapshot(caseItem, version, caseItem.changeNote)];
  }

  function getCurrentCaseVersion(caseItem) {
    const versions = listCaseVersions(caseItem);
    return versions[versions.length - 1] || null;
  }

  function compareCaseVersions(caseItem, leftVersion, rightVersion) {
    const versions = listCaseVersions(caseItem);
    const left = versions.find(version => version.version === Number(leftVersion));
    const right = versions.find(version => version.version === Number(rightVersion));
    if (!left || !right || left.version === right.version) return [];
    return ["status", "evidence", "lessons", "nextPrompt", "applicableWhen", "notApplicableWhen", "changeNote"]
      .filter(field => !sameCaseValue(left[field], right[field]))
      .map(field => ({ field, before: left[field], after: right[field] }));
  }

  function deleteCase(state, caseId) {
    const next = migrateState(state);
    const id = String(caseId ?? "").trim();
    if (!id) return next;
    const removedEntryIds = new Set(next.knowledgeEntries
      .filter(entry => String(entry?.linkedCaseId || "").trim() === id)
      .map(entry => entry.id));
    next.cases = next.cases.filter(item => item.id !== id);
    next.knowledgeEntries = next.knowledgeEntries.filter(item => !removedEntryIds.has(item.id));
    next.knowledgeSelection = next.knowledgeSelection.filter(itemId => !removedEntryIds.has(itemId));
    return next;
  }

  function deferCaseReuse(state, caseId, now = new Date().toISOString()) {
    const next = migrateState(state);
    const id = String(caseId ?? "").trim();
    if (!id) return next;
    const deferredAt = new Date(now).toISOString();
    const linkedEntryIds = new Set(next.knowledgeEntries
      .filter(entry => String(entry?.linkedCaseId || "").trim() === id)
      .map(entry => entry.id));
    next.cases = next.cases.map(item => item.id === id ? { ...item, reuseDeferredAt: deferredAt } : item);
    next.knowledgeEntries = next.knowledgeEntries.map(item => linkedEntryIds.has(item.id)
      ? { ...item, hiddenAt: deferredAt }
      : item);
    next.knowledgeSelection = next.knowledgeSelection.filter(itemId => !linkedEntryIds.has(itemId));
    return next;
  }

  return { STORAGE_KEY, LEGACY_STORAGE_KEY, CASE_FIELDS, createEmptyState, stripModelKeys, sanitizeResearchState, migrateState, loadState, saveState, addPromptVersion, confirmCase, updateCase, upsertKnowledgeEntry, getCurrentCaseVersion, listCaseVersions, compareCaseVersions, deleteCase, deferCaseReuse };
});
