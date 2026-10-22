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
  const promptAgentSchema = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./prompt-agent-schema.js")
    : typeof globalThis === "undefined"
      ? null
      : globalThis.ForwardStepPromptAgentSchema;
  const pptSceneSchema = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./ppt-scene-schema.js")
    : typeof globalThis === "undefined"
      ? null
      : globalThis.ForwardStepPptSceneSchema;
  const STORAGE_KEY = "forward-step.workspace.v2";
  const writingSchema = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./writing-workbench-schema.js")
    : typeof globalThis === "undefined" ? null : globalThis.WritingWorkbenchSchema;
  const writingPackSchema = typeof module === "object" && typeof require === "function"
    ? require("./writing-pack-schema.js")
    : typeof globalThis === "undefined" ? null : globalThis.WritingPackSchema;
  const academicReviewSchema = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./academic-review.js")
    : typeof globalThis === "undefined" ? null : globalThis.ForwardStepAcademicReview;
  const academicPublishingSchema = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./academic-publishing.js")
    : typeof globalThis === "undefined" ? null : globalThis.ForwardStepAcademicPublishing;
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
    "knowledgeMetadata", "researchTasks", "platformConnections", "researchAttachments", "settings",
    "promptAgentTasks", "promptAgentSources", "writingArticles", "writingMemories",
    "writingPacks", "writingPackSettings", "writingReviews", "academicResponseProjects"
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
      researchAttachments: [],
      promptAgentTasks: [],
      promptAgentSources: [],
      writingArticles: [],
      writingMemories: [],
      writingPacks: [],
      writingPackSettings: [],
      writingReviews: [],
      academicResponseProjects: []
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

  class WritingSchemaUnavailableError extends Error {
    constructor() {
      super("写作 schema 未加载，无法安全清洗已有写作数据");
      this.name = "WritingSchemaUnavailableError";
      this.code = "WRITING_SCHEMA_UNAVAILABLE";
    }
  }

  class StorageWriteError extends Error {
    constructor(message, cause) {
      super(message, { cause });
      this.name = "StorageWriteError";
      this.code = "STORAGE_WRITE_FAILED";
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

  function sanitizePromptAgentState(state) {
    if (!promptAgentSchema || typeof promptAgentSchema.sanitizePromptAgentState !== "function") {
      return { promptAgentTasks: [], promptAgentSources: [] };
    }
    const sanitized = promptAgentSchema.sanitizePromptAgentState(state);
    const sceneSchema = pptSceneSchema || globalThis.ForwardStepPptSceneSchema;
    if (!sceneSchema || typeof sceneSchema.normalizePptScene !== "function" || !Array.isArray(state?.promptAgentTasks)) {
      return sanitized;
    }
    const scenesById = new Map();
    for (const task of state.promptAgentTasks) {
      if (!task || typeof task.id !== "string" || !task.pptScene) continue;
      const normalizedId = task.id.trim().slice(0, 100);
      if (!scenesById.has(normalizedId)) scenesById.set(normalizedId, []);
      scenesById.get(normalizedId).push(sceneSchema.normalizePptScene(task.pptScene));
    }
    return {
      ...sanitized,
      promptAgentTasks: sanitized.promptAgentTasks.map(task => {
        const scenes = scenesById.get(task.id);
        return scenes?.length ? { ...task, pptScene: scenes.shift() } : task;
      })
    };
  }

  function sanitizeWritingState(state) {
    const articles = Array.isArray(state?.writingArticles) ? state.writingArticles : [];
    const memories = Array.isArray(state?.writingMemories) ? state.writingMemories : [];
    const packs = Array.isArray(state?.writingPacks) ? state.writingPacks : [];
    const packSettings = Array.isArray(state?.writingPackSettings) ? state.writingPackSettings : [];
    const reviews = Array.isArray(state?.writingReviews) ? state.writingReviews : [];
    if (!articles.length && !memories.length && !packs.length && !packSettings.length && !reviews.length) {
      return { writingArticles: [], writingMemories: [], writingPacks: [], writingPackSettings: [], writingReviews: [] };
    }
    const schema = writingSchema || (typeof globalThis === "undefined" ? null : globalThis.WritingWorkbenchSchema);
    if ((articles.length || memories.length) && (!schema || typeof schema.normalizeWritingWorkspace !== "function"
      || typeof schema.normalizeWritingMemory !== "function")) {
      throw new WritingSchemaUnavailableError();
    }
    const packSchema = writingPackSchema || (typeof globalThis === "undefined" ? null : globalThis.WritingPackSchema);
    if ((packs.length || packSettings.length) && (!packSchema
      || typeof packSchema.normalizeWritingPackCollection !== "function"
      || typeof packSchema.normalizeWritingPackSettings !== "function")) {
      throw new WritingSchemaUnavailableError();
    }
    const reviewSchema = academicReviewSchema || (typeof globalThis === "undefined" ? null : globalThis.ForwardStepAcademicReview);
    if (reviews.length && (!reviewSchema || typeof reviewSchema.normalizeReviewProject !== "function")) {
      throw new WritingSchemaUnavailableError();
    }
    // 清洗与保存授权分开：迁移和导入必须保留关闭保存后的历史快照。
    return {
      writingArticles: articles.length ? stripModelKeys(articles).map(item => {
        const snapshot = schema.normalizeWritingWorkspace(item);
        if (!snapshot.id) snapshot.id = snapshot.article.id;
        return snapshot;
      }).filter(item => item.id && item.id === item.article.id) : [],
      writingMemories: memories.length ? stripModelKeys(memories).map(schema.normalizeWritingMemory).filter(item => item.id) : [],
      writingPacks: packs.length
        ? packSchema.normalizeWritingPackCollection(stripModelKeys(packs))
        : [],
      writingPackSettings: packSettings.length
        ? normalizeWritingPackSettings(packSchema, stripModelKeys(packSettings))
        : [],
      writingReviews: reviews.length
        ? normalizeWritingReviewCollection(reviewSchema, stripModelKeys(reviews))
        : []
    };
  }

  function sanitizeAcademicPublishingState(state) {
    const projects = Array.isArray(state?.academicResponseProjects) ? state.academicResponseProjects : [];
    if (!projects.length) return { academicResponseProjects: [] };
    const schema = academicPublishingSchema || (typeof globalThis === "undefined" ? null : globalThis.ForwardStepAcademicPublishing);
    if (!schema || typeof schema.normalizeProject !== "function") {
      throw new WritingSchemaUnavailableError();
    }
    const normalized = projects.map(item => schema.normalizeProject(stripModelKeys(item)));
    const ids = new Set();
    for (const project of normalized) {
      if (!project.id) throw new TypeError("academicResponseProjects 存在空 ID");
      if (ids.has(project.id)) throw new TypeError(`academicResponseProjects 存在重复 ID：${project.id}`);
      ids.add(project.id);
    }
    return { academicResponseProjects: normalized };
  }

  function normalizeWritingReviewCollection(schema, reviews) {
    const normalized = reviews.map(schema.normalizeReviewProject);
    const ids = new Set();
    for (const review of normalized) {
      if (ids.has(review.id)) throw new TypeError(`writingReviews 存在重复 ID：${review.id}`);
      ids.add(review.id);
    }
    return normalized;
  }

  function normalizeWritingPackSettings(schema, settings) {
    const normalized = settings.map(schema.normalizeWritingPackSettings);
    const ids = new Set();
    for (const setting of normalized) {
      if (ids.has(setting.id)) throw new TypeError(`writingPackSettings 存在重复 ID：${setting.id}`);
      ids.add(setting.id);
    }
    return normalized;
  }

  function migrateState(input) {
    const source = input && typeof input === "object" ? input : {};
    const knowledgeEntries = normalizeKnowledgeEntries(source.knowledgeEntries);
    const researchSelection = sanitizeResearchSelection(source.researchSelection);
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
      researchSelection,
      // 仅在旧状态缺少 knowledgeSelection 时迁移公开资料选择；之后两套选择可独立清理。
      knowledgeSelection: sanitizeKnowledgeSelection(
        Array.isArray(source.knowledgeSelection) ? source.knowledgeSelection : researchSelection,
        knowledgeEntries
      ),
      knowledgeEntries,
      cases: Array.isArray(source.cases)
        ? stripModelKeys(source.cases)
          .filter(item => item && item.confirmed === true)
          .map(migrateConfirmedCase)
        : [],
      ...sanitizePromptAgentState(stripModelKeys(source)),
      ...sanitizeWritingState(source),
      ...sanitizeAcademicPublishingState(source),
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
      if (error && ["KNOWLEDGE_SCHEMA_UNAVAILABLE", "WRITING_SCHEMA_UNAVAILABLE"].includes(error.code)) throw error;
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

  function saveState(storage, state, options = {}) {
    const store = resolveStorage(storage);
    if (!store) return createEmptyState();
    try {
      const sanitized = migrateState(state);
      // 仅已校验的显式导入/恢复可写入关闭保存的历史；普通编辑不能携带此选项。
      if (options.restoreWriting !== true && (sanitized.writingArticles.some(item => !item.article.saveEnabled)
        || sanitized.writingReviews.some(item => !item.saveEnabled)
        || sanitized.academicResponseProjects.some(item => !item.saveEnabled))) {
        const raw = store.getItem(STORAGE_KEY) || store.getItem(LEGACY_STORAGE_KEY);
        const previousData = raw ? JSON.parse(raw) : {};
        const previous = sanitizeWritingState(previousData);
        const previousAcademicPublishing = sanitizeAcademicPublishingState(previousData);
        const previousById = new Map(previous.writingArticles.map(item => [item.id, item]));
        // 只遍历本次数组，确保显式删除的 id 不会从旧存储被重新并回。
        sanitized.writingArticles = sanitized.writingArticles.flatMap(item => {
          if (item.article.saveEnabled) return [item];
          const saved = previousById.get(item.id);
          return saved ? [{ ...saved, article: { ...saved.article, saveEnabled: false } }] : [];
        });
        const previousReviewsById = new Map(previous.writingReviews.map(item => [item.id, item]));
        sanitized.writingReviews = sanitized.writingReviews.flatMap(item => {
          if (item.saveEnabled) return [item];
          const saved = previousReviewsById.get(item.id);
          return saved ? [{ ...saved, saveEnabled: false }] : [];
        });
        const previousAcademicProjectsById = new Map(previousAcademicPublishing.academicResponseProjects.map(item => [item.id, item]));
        sanitized.academicResponseProjects = sanitized.academicResponseProjects.flatMap(item => {
          if (item.saveEnabled) return [item];
          const saved = previousAcademicProjectsById.get(item.id);
          return saved ? [{ ...saved, saveEnabled: false }] : [];
        });
      }
      store.setItem(STORAGE_KEY, JSON.stringify(sanitized));
      return sanitized;
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : String(error);
      throw new StorageWriteError(`本地数据写入失败：${detail}`, error);
    }
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

  function buildResearchKnowledgeEntry(result, task = {}) {
    if (!knowledgeSchema || typeof knowledgeSchema.normalizeKnowledgeEntry !== "function") {
      throw new KnowledgeSchemaUnavailableError();
    }
    const source = result && typeof result === "object" ? result : {};
    const id = String(source.id || "").trim();
    if (!id) throw new TypeError("研究结果必须提供非空 id");
    return knowledgeSchema.normalizeKnowledgeEntry({
      id: `research-${id}`,
      type: "manual-note",
      title: source.title || `${source.platform || "社媒"} 研究结果`,
      sourceUrl: source.url,
      sourceType: "社媒研究",
      sourceKind: "manual",
      sourceId: id,
      domains: [source.platform].filter(Boolean),
      keywords: task.plan?.queries || task.queries || [],
      summary: source.summary,
      contentExcerpt: source.discussionSummary,
      limitations: source.evidenceStatus === "unverified" ? "来源尚未由用户逐条核验" : "",
      verificationStatus: source.evidenceStatus || "unverified"
    });
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


  return { STORAGE_KEY, LEGACY_STORAGE_KEY, CASE_FIELDS, createEmptyState, stripModelKeys, sanitizeResearchState, sanitizePromptAgentState, sanitizeWritingState, sanitizeAcademicPublishingState, migrateState, loadState, saveState, addPromptVersion, confirmCase, updateCase, upsertKnowledgeEntry, buildResearchKnowledgeEntry, getCurrentCaseVersion, listCaseVersions, compareCaseVersions, deleteCase, deferCaseReuse };
});
