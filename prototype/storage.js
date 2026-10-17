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
  const STORAGE_KEY = "forward-step.workspace.v2";
  const LEGACY_STORAGE_KEY = "forward-step.workspace.v1";
  const CASE_FIELDS = [
    "id", "projectId", "domain", "taskType", "goal", "preserveItems", "before", "after",
    "externalResult", "userFeedback", "dimensions", "evidence", "suggestedLabel", "status",
    "lessons", "nextPrompt", "createdAt"
  ];

  function createEmptyState() {
    return {
      schemaVersion: 3,
      projects: [],
      prompts: [],
      references: [],
      researchSelection: [],
      knowledgeSelection: [],
      knowledgeEntries: [],
      cases: []
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

  function stripModelKeys(value) {
    if (Array.isArray(value)) return value.map(stripModelKeys);
    if (!value || typeof value !== "object") return value;
    const credentialFields = new Set([
      "authorization", "password", "credentials", "credential", "token", "secret"
    ]);
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        return !credentialFields.has(normalized)
          && !/(?:api|model|access|refresh|client|auth|bearer|private|secret)(?:key|token|secret|credential)$/.test(normalized);
      })
      .map(([key, item]) => [key, stripModelKeys(item)]));
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

  function getKnowledgeSelectionIds(knowledgeEntries) {
    const ids = new Set((knowledgeEntries || []).map(item => item.id));
    getReferenceCatalog().forEach(item => ids.add(item.id));

    try {
      const methodCards = typeof module === "object" && module.exports && typeof require === "function"
        ? require("./method-cards.js")
        : typeof globalThis === "undefined"
          ? null
          : globalThis.ForwardStepMethodCards;
      if (methodCards && typeof methodCards.methodCardsToKnowledgeEntries === "function") {
        methodCards.methodCardsToKnowledgeEntries().forEach(item => ids.add(item.id));
      }
    } catch {
      // 方法卡不可用时仍保留可确认的公开资料和本地条目选择。
    }
    return ids;
  }

  function sanitizeKnowledgeSelection(selection, knowledgeEntries) {
    const knownIds = getKnowledgeSelectionIds(knowledgeEntries);
    return [...new Set(Array.isArray(selection) ? selection : [])]
      .filter(id => typeof id === "string" && knownIds.has(id))
      .slice(0, 5);
  }

  function listValue(value) {
    if (Array.isArray(value)) return value.filter(item => item !== null && item !== undefined && String(item).trim());
    if (typeof value === "string") return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    return [];
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
      createdAt: String(source.createdAt ?? "").trim() || new Date().toISOString()
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

  function migrateState(input) {
    const source = input && typeof input === "object" ? input : {};
    const knowledgeEntries = normalizeKnowledgeEntries(source.knowledgeEntries);
    const researchSelection = sanitizeResearchSelection(source.researchSelection);
    const state = {
      ...createEmptyState(),
      ...stripModelKeys(source),
      schemaVersion: 3,
      projects: Array.isArray(source.projects) ? stripModelKeys(source.projects).map(withProjectDefaults) : [],
      prompts: Array.isArray(source.prompts) ? stripModelKeys(source.prompts) : [],
      references: Array.isArray(source.references) ? stripModelKeys(source.references) : [],
      researchSelection,
      knowledgeSelection: sanitizeKnowledgeSelection(
        [...(Array.isArray(source.knowledgeSelection) ? source.knowledgeSelection : []), ...researchSelection],
        knowledgeEntries
      ),
      knowledgeEntries,
      cases: Array.isArray(source.cases)
        ? stripModelKeys(source.cases)
          .filter(item => item && item.confirmed === true)
          .map(item => ({ ...normalizeCase(item), confirmed: true, confirmedAt: item.confirmedAt || item.createdAt || new Date().toISOString() }))
        : []
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
    next.cases.unshift({ ...sanitizedCase, confirmed: true, confirmedAt: new Date().toISOString() });
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
    const merged = normalizeCase({ ...existing, ...reviewedCase, id: caseId, createdAt: existing.createdAt });
    next.cases[index] = { ...merged, confirmed: true, confirmedAt: existing.confirmedAt || new Date().toISOString() };
    return next;
  }

  return { STORAGE_KEY, LEGACY_STORAGE_KEY, CASE_FIELDS, createEmptyState, migrateState, loadState, saveState, addPromptVersion, confirmCase, updateCase };
});
