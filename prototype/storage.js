(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepStorage = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const STORAGE_KEY = "forward-step.workspace.v2";
  const LEGACY_STORAGE_KEY = "forward-step.workspace.v1";

  function createEmptyState() {
    return { schemaVersion: 2, projects: [], prompts: [], references: [], researchSelection: [], cases: [] };
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

  function migrateState(input) {
    const source = input && typeof input === "object" ? input : {};
    const state = {
      ...createEmptyState(),
      ...stripModelKeys(source),
      schemaVersion: 2,
      projects: Array.isArray(source.projects) ? stripModelKeys(source.projects).map(withProjectDefaults) : [],
      prompts: Array.isArray(source.prompts) ? stripModelKeys(source.prompts) : [],
      references: Array.isArray(source.references) ? stripModelKeys(source.references) : [],
      researchSelection: sanitizeResearchSelection(source.researchSelection),
      cases: Array.isArray(source.cases)
        ? stripModelKeys(source.cases).filter(item => item && item.confirmed === true)
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
    const sanitizedCase = stripModelKeys(reviewedCase);
    next.cases.unshift({ ...sanitizedCase, id: caseId, confirmed: true, confirmedAt: sanitizedCase.confirmedAt || new Date().toISOString() });
    return next;
  }

  return { STORAGE_KEY, LEGACY_STORAGE_KEY, createEmptyState, migrateState, loadState, saveState, addPromptVersion, confirmCase };
});
