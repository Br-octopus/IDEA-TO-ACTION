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
  const OPTIONAL_WORKSPACE_COLLECTIONS = [
    "promptAgentTasks", "promptAgentSources", "writingArticles", "writingMemories", "writingPacks", "writingPackSettings", "writingReviews", "academicResponseProjects", "workbenchAttachments", "workbenchAnnotations"
  ];
  const WRITING_PACK_COLLECTIONS = ["writingPacks", "writingPackSettings"];
  const WRITING_REVIEW_COLLECTION = "writingReviews";
  const ACADEMIC_PUBLISHING_COLLECTION = "academicResponseProjects";
  const KNOWLEDGE_COLLECTIONS = ["knowledgeEntries", "cases"];
  const WORKSPACE_DATA_FIELDS = [
    "schemaVersion", "projects", "prompts", "references", "researchSelection",
    "knowledgeEntries", "knowledgeSelection", "cases", "knowledgeFilters", "knowledgeMetadata",
    "researchTasks", "platformConnections", "researchAttachments", "promptAgentTasks", "promptAgentSources",
    "writingArticles", "writingMemories", "writingPacks", "writingPackSettings", "writingReviews", "academicResponseProjects",
    "workbenchAttachments", "workbenchAnnotations"
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

  function array(item, maxItems) {
    return { kind: "array", item, ...(Number.isSafeInteger(maxItems) ? { maxItems } : {}) };
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

  const WORKBENCH_MESSAGE_FIELDS = {
    id: SCALAR,
    role: SCALAR,
    text: SCALAR,
    kind: SCALAR,
    question: SCALAR,
    resolved: SCALAR,
    retryable: SCALAR,
    recommendedOption: SCALAR,
    optional: SCALAR,
    skipped: SCALAR,
    replyToMessageId: SCALAR,
    selectedOptionIndex: SCALAR,
    confirmedRecommendation: SCALAR,
    annotationConflictKey: SCALAR,
    annotationConflictChoice: SCALAR,
    annotationConflictKeepId: SCALAR,
    recommendation: object({ text: SCALAR, reason: SCALAR }),
    options: LIST
  };

  const WORKBENCH_VIEWER_FIELDS = {
    zoom: SCALAR,
    zoomMode: SCALAR,
    pageIndex: SCALAR,
    scrollLeft: SCALAR,
    scrollTop: SCALAR
  };

  const WORKBENCH_PROMPT_CITATION_FIELDS = {
    annotationId: SCALAR,
    attachmentId: SCALAR,
    attachmentName: SCALAR,
    contentHash: SCALAR,
    pageIndex: SCALAR,
    targetSnapshot: SCALAR,
    comment: SCALAR,
    category: SCALAR,
    intent: SCALAR
  };

  const WORKBENCH_KNOWLEDGE_SOURCE_FIELDS = {
    sourceId: SCALAR,
    version: SCALAR,
    title: SCALAR,
    type: SCALAR,
    sourceType: SCALAR,
    sourceUrl: SCALAR,
    sourceVersion: SCALAR,
    summary: SCALAR,
    reusablePatterns: SCALAR,
    contentExcerpt: SCALAR,
    limitations: SCALAR,
    licenseNote: SCALAR,
    verificationStatus: SCALAR,
    sourceUpdatedAt: SCALAR,
    domains: LIST,
    stages: LIST,
    keywords: LIST,
    importedAt: SCALAR
  };

  const WORKBENCH_PROMPT_VERSION_FIELDS = {
    id: SCALAR,
    version: SCALAR,
    createdAt: SCALAR,
    prompt: SCALAR,
    citations: array(object(WORKBENCH_PROMPT_CITATION_FIELDS), 2000),
    sources: array(object(WORKBENCH_KNOWLEDGE_SOURCE_FIELDS), 500)
  };

  const WORKBENCH_ATTACHMENT_FIELDS = {
    id: SCALAR,
    archiveId: SCALAR,
    taskId: SCALAR,
    displayName: SCALAR,
    kind: SCALAR,
    mimeType: SCALAR,
    size: SCALAR,
    sha256: SCALAR,
    version: SCALAR,
    createdAt: SCALAR,
    deleted: SCALAR
  };

  const WORKBENCH_ANNOTATION_FIELDS = {
    id: SCALAR,
    taskId: SCALAR,
    attachmentId: SCALAR,
    contentHash: SCALAR,
    pageIndex: SCALAR,
    target: object({
      kind: SCALAR, selector: SCALAR, excerpt: SCALAR, exact: SCALAR, prefix: SCALAR, suffix: SCALAR,
      source: object({ url: SCALAR, fetchedAt: SCALAR, contentHash: SCALAR }),
      start: SCALAR, end: SCALAR, x: SCALAR, y: SCALAR, width: SCALAR, height: SCALAR,
      x1: SCALAR, y1: SCALAR, x2: SCALAR, y2: SCALAR, points: array(object({ x: SCALAR, y: SCALAR }), 128)
    }),
    comment: SCALAR,
    category: SCALAR,
    intent: SCALAR,
    createdAt: SCALAR,
    updatedAt: SCALAR,
    status: SCALAR,
    selected: SCALAR,
    reassociatedFromId: SCALAR
  };

  const WORKBENCH_SOURCE_REF_FIELDS = {
    kind: SCALAR, url: SCALAR, title: SCALAR, attachmentId: SCALAR, contentHash: SCALAR, hash: SCALAR,
    fetchedAt: SCALAR, pageIndex: SCALAR, excerpt: SCALAR, sourceId: SCALAR, versionId: SCALAR,
    sourceKind: SCALAR, selector: SCALAR, start: SCALAR, end: SCALAR
  };
  const WORKBENCH_CONTENT_VERSION_FIELDS = {
    id: SCALAR, text: SCALAR, attachmentId: SCALAR, hash: SCALAR, sourceRef: object(WORKBENCH_SOURCE_REF_FIELDS),
    parseStatus: SCALAR, annotations: array(object(WORKBENCH_ANNOTATION_FIELDS)), parentVersionId: SCALAR,
    roundId: SCALAR, deliveryId: SCALAR
  };
  const WORKBENCH_CONTENT_FIELDS = {
    id: SCALAR, title: SCALAR, kind: SCALAR, purpose: SCALAR, purposeReason: SCALAR,
    draft: object({ text: SCALAR, baseVersionId: SCALAR, updatedAt: SCALAR }),
    versions: array(object(WORKBENCH_CONTENT_VERSION_FIELDS)), sourceRef: object(WORKBENCH_SOURCE_REF_FIELDS),
    removedAt: SCALAR, archivedAt: SCALAR
  };
  const WORKBENCH_CANVAS_NODE_FIELDS = {
    id: SCALAR, contentVersionId: SCALAR, position: object({ x: SCALAR, y: SCALAR }),
    size: object({ width: SCALAR, height: SCALAR }), zIndex: SCALAR, groupId: SCALAR,
    annotations: array(object(WORKBENCH_ANNOTATION_FIELDS)), removedAt: SCALAR
  };
  const WORKBENCH_CANVAS_FIELDS = {
    id: SCALAR, title: SCALAR, purpose: SCALAR,
    viewport: object({ x: SCALAR, y: SCALAR, zoom: SCALAR }),
    groups: array(object({ id: SCALAR, title: SCALAR, label: SCALAR, color: SCALAR, removedAt: SCALAR })),
    nodes: array(object(WORKBENCH_CANVAS_NODE_FIELDS)), removedAt: SCALAR
  };
  const WORKBENCH_DELIVERY_MATERIAL_FIELDS = {
    contentVersionId: SCALAR, title: SCALAR, kind: SCALAR, purpose: SCALAR, attachmentId: SCALAR,
    hash: SCALAR, sourceRef: object(WORKBENCH_SOURCE_REF_FIELDS), parseStatus: SCALAR,
    pageIndex: SCALAR, region: object({ x: SCALAR, y: SCALAR, width: SCALAR, height: SCALAR }),
    canvasId: SCALAR, nodeId: SCALAR, annotationIds: LIST
  };
  const WORKBENCH_LAYOUT_INTENT_FIELDS = {
    enabled: SCALAR, canvasId: SCALAR, nodeIds: LIST,
    bounds: object({ x: SCALAR, y: SCALAR, width: SCALAR, height: SCALAR })
  };
  const WORKBENCH_DELIVERY_FIELDS = {
    id: SCALAR, text: SCALAR, materials: array(object(WORKBENCH_DELIVERY_MATERIAL_FIELDS)),
    annotations: array(object(WORKBENCH_ANNOTATION_FIELDS)),
    layoutIntent: object(WORKBENCH_LAYOUT_INTENT_FIELDS), createdAt: SCALAR
  };
  const WORKBENCH_PROMPT_ROUND_FIELDS = {
    id: SCALAR, draftText: SCALAR, contentVersionIds: LIST,
    deliveries: array(object(WORKBENCH_DELIVERY_FIELDS))
  };
  const WORKBENCH_SELECTION_ITEM_FIELDS = {
    contentVersionId: SCALAR, canvasId: SCALAR, nodeId: SCALAR, pageIndex: SCALAR,
    region: object({ x: SCALAR, y: SCALAR, width: SCALAR, height: SCALAR }), annotationIds: LIST
  };
  const WORKBENCH_SELECTION_FIELDS = {
    items: array(object(WORKBENCH_SELECTION_ITEM_FIELDS)), layoutIntent: object(WORKBENCH_LAYOUT_INTENT_FIELDS)
  };
  const WORKBENCH_DRAFT_FIELDS = {
    goal: SCALAR, opinion: SCALAR, promptText: SCALAR, annotations: array(object(WORKBENCH_ANNOTATION_FIELDS)),
    updatedAt: SCALAR
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
    masterPrompt: SCALAR,
    conversation: array(object(WORKBENCH_MESSAGE_FIELDS)),
    conversationDraft: SCALAR,
    workbenchVisitedPreviewModes: LIST,
    workbenchLayout: SCALAR,
    workbenchPreviewMode: SCALAR,
    workbenchAttachmentId: SCALAR,
    workbenchAttachmentIds: LIST,
    workbenchClosedAttachmentIds: LIST,
    workbenchPersistenceEnabled: SCALAR,
    workbenchOpenContentId: SCALAR,
    workbenchActiveCanvasId: SCALAR,
    workbenchMaterialPanel: SCALAR,
    workbenchPreviewState: SCALAR,
    workbenchViewerState: { kind: "record", item: object(WORKBENCH_VIEWER_FIELDS) },
    workbenchGeneratedPrompt: SCALAR,
    workbenchPromptDraft: SCALAR,
    workbenchKnowledgeSources: array(object(WORKBENCH_KNOWLEDGE_SOURCE_FIELDS), 500),
    workbenchPromptVersions: array(object(WORKBENCH_PROMPT_VERSION_FIELDS), 10),
    workbenchSchemaVersion: SCALAR,
    workbenchRevision: SCALAR,
    workbenchContents: array(object(WORKBENCH_CONTENT_FIELDS)),
    workbenchCanvases: array(object(WORKBENCH_CANVAS_FIELDS)),
    workbenchPromptRounds: array(object(WORKBENCH_PROMPT_ROUND_FIELDS)),
    workbenchDraft: object(WORKBENCH_DRAFT_FIELDS),
    workbenchSelection: object(WORKBENCH_SELECTION_FIELDS),
    workbenchLegacyRefs: array(object({ collection: SCALAR, sourceId: SCALAR, contentId: SCALAR })),
    workbenchDraftStatus: SCALAR,
    workbenchSaveError: SCALAR
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
    favorite: SCALAR,
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
    version: SCALAR,
    type: SCALAR,
    title: SCALAR,
    sourceUrl: SCALAR,
    url: SCALAR,
    sourceType: SCALAR,
    sourcePath: SCALAR,
    sourceFetchedAt: SCALAR,
    sourceVersion: SCALAR,
    sourceFormat: SCALAR,
    sourceCapabilities: LIST,
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
    updatedAt: SCALAR,
    literature: object({
      authors: LIST,
      year: SCALAR,
      publication: SCALAR,
      volume: SCALAR,
      issue: SCALAR,
      pages: SCALAR,
      doi: SCALAR,
      pmid: SCALAR,
      itemType: SCALAR,
      metadataProvider: SCALAR,
      queriedAt: SCALAR,
      metadataStatus: SCALAR,
      readingStatus: SCALAR,
      abstractExcerpt: SCALAR,
      excerptLocation: SCALAR,
      claimRelations: array(object({
        claim: SCALAR,
        relation: SCALAR,
        location: SCALAR,
        rationale: SCALAR
      }))
    })
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
      if (!Array.isArray(value)) return undefined;
      const items = Number.isSafeInteger(schema.maxItems) ? value.slice(-schema.maxItems) : value;
      return items.map(item => sanitizeBySchema(item, schema.item)).filter(item => item !== undefined);
    }
    if (schema.kind === "record") {
      if (!isObject(value)) return undefined;
      return Object.entries(value).slice(0, 200).reduce((result, [key, item]) => {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key)) return result;
        const sanitized = sanitizeBySchema(item, schema.item);
        if (sanitized !== undefined) result[key] = sanitized;
        return result;
      }, {});
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
    sanitized.workbenchAttachments = sanitizeCollection(source.workbenchAttachments, WORKBENCH_ATTACHMENT_FIELDS);
    sanitized.workbenchAnnotations = sanitizeCollection(source.workbenchAnnotations, WORKBENCH_ANNOTATION_FIELDS);
    sanitized.knowledgeMetadata = sanitizeBySchema(source.knowledgeMetadata, object(KNOWLEDGE_METADATA_FIELDS)) || {};
    sanitized.knowledgeFilters = sanitizeBySchema(source.knowledgeFilters, object(KNOWLEDGE_FILTER_FIELDS)) || {};
    if (storage && typeof storage.sanitizeResearchState === "function") {
      Object.assign(sanitized, storage.sanitizeResearchState(source));
    }
    if (storage && typeof storage.sanitizePromptAgentState === "function") {
      const promptAgentSource = typeof storage.stripModelKeys === "function"
        ? storage.stripModelKeys(source)
        : source;
      Object.assign(sanitized, storage.sanitizePromptAgentState(promptAgentSource));
    }
    if (!storage || typeof storage.sanitizeWritingState !== "function") {
      throw new Error("备份依赖的写作数据清洗模块未加载");
    }
    Object.assign(sanitized, storage.sanitizeWritingState(source));
    if (typeof storage.sanitizeAcademicPublishingState === "function") {
      Object.assign(sanitized, storage.sanitizeAcademicPublishingState(source));
    }
    return sanitized;
  }

  function sanitizeBackupData(scope, data) {
    const source = isObject(data) ? clone(data) : {};
    const sanitizedState = sanitizeState(scope === "workspace" ? sanitizeResearchBackupData(source) : source);
    const allowedFields = scope === "workspace" ? WORKSPACE_DATA_FIELDS : KNOWLEDGE_DATA_FIELDS;
    return allowedFields.reduce((result, field) => {
      if (Object.hasOwn(source, field)
        || (scope === "workspace" && ["writingArticles", "writingMemories", "writingPacks", "writingPackSettings", WRITING_REVIEW_COLLECTION, ACADEMIC_PUBLISHING_COLLECTION].includes(field))) {
        result[field] = clone(sanitizedState[field]);
      }
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
    data.promptAgentTasks = Array.isArray(state.promptAgentTasks) ? clone(state.promptAgentTasks) : [];
    data.promptAgentSources = Array.isArray(state.promptAgentSources) ? clone(state.promptAgentSources) : [];
    data.writingArticles = Array.isArray(state.writingArticles) ? clone(state.writingArticles) : [];
    data.writingMemories = Array.isArray(state.writingMemories) ? clone(state.writingMemories) : [];
    data.writingPacks = Array.isArray(state.writingPacks) ? clone(state.writingPacks) : [];
    data.writingPackSettings = Array.isArray(state.writingPackSettings) ? clone(state.writingPackSettings) : [];
    data.writingReviews = Array.isArray(state.writingReviews) ? clone(state.writingReviews) : [];
    data.academicResponseProjects = Array.isArray(state.academicResponseProjects) ? clone(state.academicResponseProjects) : [];
    data.workbenchAttachments = Array.isArray(state.workbenchAttachments) ? clone(state.workbenchAttachments) : [];
    data.workbenchAnnotations = Array.isArray(state.workbenchAnnotations) ? clone(state.workbenchAnnotations) : [];
    return sanitizeResearchBackupData(data);
  }

  function countData(data) {
    return ["projects", "prompts", "cases", "knowledgeEntries", "references", ...RESEARCH_COLLECTIONS, ...OPTIONAL_WORKSPACE_COLLECTIONS]
      .filter(field => Array.isArray(data[field]))
      .reduce((counts, field) => {
        // 旧备份摘要不包含新增研究集合的零计数，保持旧调用方的结构兼容。
        if (![...RESEARCH_COLLECTIONS, ...OPTIONAL_WORKSPACE_COLLECTIONS].includes(field) || data[field].length > 0) {
          counts[field] = data[field].length;
        }
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

  function createTaskBackup(state, taskId, options = {}) {
    const backup = createBackup(state, { ...options, scope: "workspace" });
    const project = backup.data.projects.find(item => item.id === taskId);
    if (!project) throw new TypeError("找不到要导出的任务");
    const legacyRefs = Array.isArray(project.workbenchLegacyRefs) ? project.workbenchLegacyRefs : [];
    const promptTaskIds = new Set(legacyRefs.filter(item => item.collection === "promptAgentTasks").map(item => item.sourceId));
    const articleIds = new Set(legacyRefs.filter(item => item.collection === "writingArticles").map(item => item.sourceId));
    backup.data.projects = [project];
    backup.data.prompts = [];
    backup.data.references = [];
    backup.data.cases = [];
    backup.data.knowledgeEntries = [];
    backup.data.knowledgeSelection = [];
    backup.data.knowledgeFilters = {};
    backup.data.knowledgeMetadata = {};
    backup.data.researchSelection = [];
    backup.data.researchTasks = [];
    backup.data.researchAttachments = [];
    backup.data.platformConnections = {};
    backup.data.promptAgentTasks = backup.data.promptAgentTasks.filter(item => promptTaskIds.has(item.id));
    backup.data.promptAgentSources = [];
    backup.data.writingArticles = backup.data.writingArticles.filter(item => articleIds.has(item.id));
    backup.data.writingMemories = [];
    backup.data.writingPacks = [];
    backup.data.writingPackSettings = [];
    backup.data.writingReviews = [];
    backup.data.academicResponseProjects = [];
    backup.data.workbenchAttachments = backup.data.workbenchAttachments.filter(item => item.taskId === taskId);
    backup.data.workbenchAnnotations = backup.data.workbenchAnnotations.filter(item => item.taskId === taskId);
    backup.counts = countData(backup.data);
    validateBackup(backup);
    return backup;
  }

  function validateCollection(data, field) {
    if (!Array.isArray(data[field])) throw new TypeError(`备份核心数据无效：${field}`);
    const ids = new Set();
    data[field].forEach((item, index) => {
      const articleId = field === "writingArticles" && typeof item?.article?.id === "string"
        ? item.article.id.trim().slice(0, 100) : "";
      const outerId = typeof item?.id === "string" ? item.id.trim() : "";
      const id = field === "writingArticles" ? (outerId || articleId).slice(0, 100)
        : WRITING_PACK_COLLECTIONS.includes(field) || field === WRITING_REVIEW_COLLECTION || field === ACADEMIC_PUBLISHING_COLLECTION ? outerId.slice(0, 120) : outerId;
      const requiresExactId = WRITING_PACK_COLLECTIONS.includes(field) || field === WRITING_REVIEW_COLLECTION || field === ACADEMIC_PUBLISHING_COLLECTION;
      if (!isObject(item) || !id || (field === "writingArticles" && id !== articleId)
        || (requiresExactId && id !== outerId)) {
        throw new TypeError(`备份集合条目稳定 id 无效：${field}[${index}]`);
      }
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
    const allowedCountFields = value.scope === "workspace"
      ? [...collections, ...RESEARCH_COLLECTIONS, ...OPTIONAL_WORKSPACE_COLLECTIONS]
      : collections;
    validateAllowedKeys(value.data, allowedDataFields, "数据");
    validateAllowedKeys(value.counts, allowedCountFields, "统计");
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
      for (const field of OPTIONAL_WORKSPACE_COLLECTIONS) {
        if (Object.hasOwn(value.data, field)) {
          validateCollection(value.data, field);
          if ([WRITING_REVIEW_COLLECTION, ACADEMIC_PUBLISHING_COLLECTION].includes(field) && value.data[field].length > 0
            && !Object.hasOwn(value.counts, field)) {
            throw new TypeError(`备份统计无效：${field}`);
          }
          if (Object.hasOwn(value.counts, field)
            && (!Number.isInteger(value.counts[field]) || value.counts[field] !== value.data[field].length)) {
            throw new TypeError(`备份统计无效：${field}`);
          }
        }
      }
      for (const field of [WRITING_REVIEW_COLLECTION, ACADEMIC_PUBLISHING_COLLECTION]) {
        if (!Object.hasOwn(value.data, field)
          && Object.hasOwn(value.counts, field)
          && (!Number.isInteger(value.counts[field]) || value.counts[field] !== 0)) {
          throw new TypeError(`备份统计无效：${field}`);
        }
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
    for (const field of [...RESEARCH_COLLECTIONS, ...OPTIONAL_WORKSPACE_COLLECTIONS]) {
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
    result.researchTasks = (result.researchTasks || []).map(task => ({
      ...task,
      operations: (task.operations || []).map(operation => operation.state === "running" ? {
        ...operation,
        state: "unknown",
        updatedAt: new Date().toISOString(),
        errorCode: "INTERRUPTED",
        errorMessage: "导入的备份中该操作仍在运行，结果未知；请选择重试或跳过。"
      } : operation)
    }));
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

  function toWorkbenchIdMap(value, pattern, label) {
    const entries = value instanceof Map ? [...value.entries()]
      : Array.isArray(value) ? value.map(item => [item?.from, item?.to]) : null;
    if (!entries) throw new TypeError(`${label}映射参数无效`);
    const result = new Map();
    for (const [from, to] of entries) {
      if (typeof from !== "string" || !pattern.test(from) || typeof to !== "string" || !pattern.test(to)
        || result.has(from) || [...result.values()].includes(to)) throw new TypeError(`${label}映射内容无效`);
      result.set(from, to);
    }
    return result;
  }

  function rewriteWorkbenchTaskIds(data, manifests = [], taskIdMapping = [], attachmentIdMapping = []) {
    if (!isObject(data) || !Array.isArray(manifests)) throw new TypeError("工作台任务 ID 重映射参数无效");
    const taskMap = toWorkbenchIdMap(taskIdMapping, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/, "任务 ID");
    const attachmentMap = toWorkbenchIdMap(attachmentIdMapping,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "附件 ID");
    const rewrite = value => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (!isObject(value)) return value;
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        if (["taskId", "projectId"].includes(key) && typeof item === "string") result[key] = taskMap.get(item) || item;
        else if (["attachmentId", "workbenchAttachmentId"].includes(key) && typeof item === "string") result[key] = attachmentMap.get(item) || item;
        else if (["attachmentIds", "workbenchAttachmentIds"].includes(key) && Array.isArray(item)) {
          result[key] = item.map(id => attachmentMap.get(id) || id);
        } else result[key] = rewrite(item);
      }
      return result;
    };
    const resultData = rewrite(data);
    if (Array.isArray(data.projects)) resultData.projects = data.projects.map(project => ({
      ...rewrite(project), id: taskMap.get(project.id) || project.id
    }));
    if (Array.isArray(data.workbenchAttachments)) resultData.workbenchAttachments = data.workbenchAttachments.map(item => {
      const taskId = taskMap.get(item.taskId) || item.taskId;
      const id = attachmentMap.get(item.id) || item.id;
      const extension = typeof item.archiveId === "string" ? /\.(txt|md|pdf|png|jpg|webp|html|pptx|docx)$/i.exec(item.archiveId)?.[1] : "";
      return { ...rewrite(item), taskId, id,
        ...(extension ? { archiveId: `${taskId}_${id}.${extension.toLowerCase()}` } : {}) };
    });
    if (Array.isArray(data.workbenchAnnotations)) resultData.workbenchAnnotations = rewrite(data.workbenchAnnotations);
    const resultManifests = manifests.map(manifest => {
      const sourceTaskId = manifest.taskId;
      const taskId = taskMap.get(sourceTaskId) || sourceTaskId;
      const project = rewrite(manifest.project);
      if (project && typeof project === "object") project.id = taskMap.get(project.id) || taskId;
      return { ...rewrite(manifest), sourceTaskId, taskId, project };
    });
    return { data: resultData, workbenchManifests: resultManifests };
  }

  function remapWorkbenchTaskIds(data, manifests, unavailableTaskIds, unavailableAttachmentIds, createTaskId, createAttachmentId) {
    if (!isObject(data) || !Array.isArray(manifests) || !Array.isArray(unavailableTaskIds)
      || !Array.isArray(unavailableAttachmentIds) || typeof createTaskId !== "function" || typeof createAttachmentId !== "function") {
      throw new TypeError("工作台任务冲突映射参数无效");
    }
    const taskPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
    const attachmentPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const workbenchTasks = new Set();
    const addTask = id => {
      if (typeof id !== "string" || !taskPattern.test(id)) throw new TypeError("工作台任务 ID 无效");
      workbenchTasks.add(id);
    };
    for (const project of data.projects || []) {
      if (project?.workbenchPersistenceEnabled === true || ["workbenchDraft", "workbenchContents", "workbenchCanvases",
        "workbenchPromptRounds", "workbenchAttachmentId", "workbenchAttachmentIds"].some(key => project?.[key] != null)) addTask(project.id);
    }
    for (const item of data.workbenchAttachments || []) addTask(item.taskId);
    for (const item of data.workbenchAnnotations || []) addTask(item.taskId);
    for (const item of manifests) addTask(item.taskId);

    const usedTasks = new Set([...workbenchTasks, ...unavailableTaskIds.filter(id => typeof id === "string" && taskPattern.test(id))]);
    const taskMap = new Map();
    for (const id of workbenchTasks) {
      if (!unavailableTaskIds.includes(id)) continue;
      let target = "";
      for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
        const candidate = createTaskId();
        if (typeof candidate === "string" && taskPattern.test(candidate) && !usedTasks.has(candidate)) target = candidate;
      }
      if (!target) throw new TypeError("无法生成无冲突的任务 ID");
      taskMap.set(id, target);
      usedTasks.add(target);
    }

    const assets = data.workbenchAttachments || [];
    const usedAttachments = new Set([...assets.map(item => item.id), ...unavailableAttachmentIds.filter(id => typeof id === "string" && attachmentPattern.test(id))]);
    const attachmentMap = new Map();
    for (const item of assets) {
      if (!taskMap.has(item.taskId) && !unavailableAttachmentIds.includes(item.id)) continue;
      if (attachmentMap.has(item.id)) continue;
      let target = "";
      for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
        const candidate = createAttachmentId();
        if (typeof candidate === "string" && attachmentPattern.test(candidate) && !usedAttachments.has(candidate)) target = candidate;
      }
      if (!target) throw new TypeError("无法生成无冲突的工作台附件 ID");
      attachmentMap.set(item.id, target);
      usedAttachments.add(target);
    }

    const remapped = rewriteWorkbenchTaskIds(data, manifests, taskMap, attachmentMap);
    const archiveIdMap = assets.map((item, index) => ({ from: item.archiveId, to: remapped.data.workbenchAttachments[index]?.archiveId }))
      .filter(item => typeof item.from === "string" && typeof item.to === "string");
    return {
      ...remapped, taskIdMap: [...taskMap].map(([from, to]) => ({ from, to })),
      attachmentIdMap: [...attachmentMap].map(([from, to]) => ({ from, to })), archiveIdMap
    };
  }

  function remapResearchAttachmentIds(data, attachments, unavailableIds, createId) {
    if (!isObject(data) || !Array.isArray(data.researchAttachments) || !Array.isArray(attachments)
      || !Array.isArray(unavailableIds) || typeof createId !== "function") {
      throw new TypeError("附件 ID 映射参数无效");
    }
    const result = clone(data);
    const originalIds = new Set(result.researchAttachments.map(item => item.id));
    const usedIds = new Set([...unavailableIds, ...originalIds]);
    const idMap = new Map();

    for (const item of result.researchAttachments) {
      if (!unavailableIds.includes(item.id)) continue;
      const match = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})_[a-f0-9]{32}\.(txt|pdf|png|jpg|webp)$/.exec(item.id);
      if (!match) throw new TypeError("冲突附件 ID 无法安全重映射");
      let nextId;
      do {
        const randomId = createId();
        if (typeof randomId !== "string" || !/^[a-f0-9]{32}$/.test(randomId)) {
          throw new TypeError("附件 ID 生成失败");
        }
        nextId = `${match[1]}_${randomId}.${match[2]}`;
      } while (usedIds.has(nextId));
      idMap.set(item.id, nextId);
      usedIds.add(nextId);
    }

    const rewriteReferences = value => {
      if (Array.isArray(value)) return value.map(rewriteReferences);
      if (!isObject(value)) return value;
      const rewritten = {};
      for (const [key, item] of Object.entries(value)) {
        if (key === "attachmentId" && typeof item === "string") rewritten[key] = idMap.get(item) || item;
        else if (key === "attachmentIds" && Array.isArray(item)) rewritten[key] = item.map(id => idMap.get(id) || id);
        else rewritten[key] = rewriteReferences(item);
      }
      return rewritten;
    };

    result.researchTasks = rewriteReferences(result.researchTasks || []);
    result.researchAttachments = result.researchAttachments.map(item => {
      const id = idMap.get(item.id);
      if (!id) return item;
      const taskId = id.slice(0, id.lastIndexOf("_"));
      return { ...item, id, relativePath: `${taskId}/${id}` };
    });
    const mappedAttachments = attachments.map(item => ({ ...item, sourceId: item.id, id: idMap.get(item.id) || item.id }));
    return { data: result, attachments: mappedAttachments, remapped: [...idMap].map(([from, to]) => ({ from, to })) };
  }

  function retainResearchAttachments(data, availableIds) {
    if (!isObject(data) || !Array.isArray(availableIds)) throw new TypeError("附件引用过滤参数无效");
    const result = clone(data);
    const available = new Set(availableIds);
    const indexed = new Set((result.researchAttachments || []).map(item => item.id));
    result.researchAttachments = (result.researchAttachments || []).filter(item => available.has(item.id));
    const rewriteReferences = value => {
      if (Array.isArray(value)) return value.map(rewriteReferences);
      if (!isObject(value)) return value;
      const rewritten = {};
      for (const [key, item] of Object.entries(value)) {
        if (key === "attachmentId" && typeof item === "string") {
          if (available.has(item)) rewritten[key] = item;
        } else if (key === "attachmentIds" && Array.isArray(item)) {
          rewritten[key] = item.filter(id => available.has(id));
        } else rewritten[key] = rewriteReferences(item);
      }
      return rewritten;
    };
    result.researchTasks = rewriteReferences(result.researchTasks || []);
    return { data: result, removed: [...indexed].filter(id => !available.has(id)).length };
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
    for (const field of [...RESEARCH_COLLECTIONS, ...OPTIONAL_WORKSPACE_COLLECTIONS]) {
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
    createTaskBackup,
    validateBackup,
    getBackupSummary,
    replaceState,
    mergeState,
    rewriteWorkbenchTaskIds,
    remapWorkbenchTaskIds,
    remapResearchAttachmentIds,
    retainResearchAttachments
  };
});
