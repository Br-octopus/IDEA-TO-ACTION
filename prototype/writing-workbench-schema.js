(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WritingWorkbenchSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const WRITING_GENRES = Object.freeze(["article"]);
  const MATERIAL_PURPOSES = Object.freeze(["content", "style", "both"]);
  const STYLE_PROFILE_SOURCES = Object.freeze(["sample", "user", "user-corrected", "mixed", "temporary"]);
  const STYLE_CONFIDENCE = Object.freeze(["low", "medium", "high"]);
  const MEMORY_SCOPES = Object.freeze(["general", "genre", "article"]);
  const SENSITIVE_KEY = /(?:password|credential|authorization|cookie|session|(?:api|access|refresh|client|bearer|private|model|search)?(?:key|token|secret)|profilepath|absolute.?path)/i;
  const TEXT_LIMIT = 500;

  const ARTICLE_FIELDS = new Set([
    "id", "title", "genre", "goal", "audience", "constraints",
    "sourceArticleId", "draft", "saveEnabled", "styleProfileId",
    "createdAt", "updatedAt"
  ]);
  const MATERIAL_FIELDS = new Set(["id", "title", "purpose", "excerpt", "sourceArticleId"]);
  const ROUND_FIELDS = new Set([
    "id", "articleId", "draft", "feedback", "userFeedback", "revisionNote",
    "materials", "undo", "createdAt", "updatedAt"
  ]);
  const UNDO_FIELDS = new Set(["action", "memoryId", "roundId", "undoneAt"]);
  const STYLE_SAMPLE_FIELDS = new Set(["sourceArticleId", "excerpt", "features"]);
  const STYLE_PROFILE_FIELDS = new Set([
    "id", "source", "confidence", "traits", "samples",
    "sourceArticleIds", "createdAt", "updatedAt"
  ]);
  const MEMORY_FIELDS = new Set([
    "id", "scope", "genre", "articleId", "sourceArticleId",
    "preference", "reason", "evidenceArticleIds", "undo",
    "createdAt", "updatedAt"
  ]);
  const WORKSPACE_FIELDS = new Set([
    "id", "genre", "article", "rounds", "styleProfile",
    "styleProfiles", "memory", "memories", "sourceArticleIds",
    "createdAt", "updatedAt"
  ]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function rejectSensitiveFields(value, path = "") {
    if (Array.isArray(value)) {
      value.forEach((item, index) => rejectSensitiveFields(item, `${path}[${index}]`));
      return;
    }
    if (!isObject(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key.replace(/[^a-z0-9]/gi, ""))) {
        throw new TypeError(`包含敏感字段：${path ? `${path}.` : ""}${key}`);
      }
      rejectSensitiveFields(item, path ? `${path}.${key}` : key);
    }
  }

  function text(value, limit = TEXT_LIMIT) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
  }

  function textList(value, limit = 30, itemLimit = TEXT_LIMIT) {
    if (!Array.isArray(value)) return [];
    return value.map(item => text(item, itemLimit)).filter(Boolean).slice(0, limit);
  }

  function count(value, maximum, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(maximum, Math.floor(number))) : fallback;
  }

  function normalizeUndo(input) {
    const source = isObject(input) ? input : {};
    const undo = {
      action: text(source.action, 100),
      memoryId: text(source.memoryId, 100),
      roundId: text(source.roundId, 100),
      undoneAt: text(source.undoneAt, 80)
    };
    return Object.fromEntries(Object.entries(undo).filter(([key, value]) => UNDO_FIELDS.has(key) && value));
  }

  function normalizeWritingArticle(input) {
    const source = isObject(input) ? input : {};
    rejectSensitiveFields(source);
    const article = {
      id: text(source.id, 100),
      title: text(source.title),
      genre: WRITING_GENRES.includes(source.genre) ? source.genre : (source.genre === undefined ? "article" : ""),
      goal: text(source.goal),
      audience: text(source.audience),
      constraints: text(source.constraints),
      sourceArticleId: text(source.sourceArticleId, 100),
      draft: text(source.draft, 8000),
      saveEnabled: source.saveEnabled !== false,
      styleProfileId: text(source.styleProfileId, 100),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    return Object.fromEntries(Object.entries(article).filter(([key]) => ARTICLE_FIELDS.has(key)));
  }

  function normalizeWritingMaterial(input) {
    const source = isObject(input) ? input : {};
    const material = {
      id: text(source.id, 100),
      title: text(source.title, 160),
      purpose: MATERIAL_PURPOSES.includes(source.purpose) ? source.purpose : "content",
      excerpt: text(source.excerpt, 1200),
      sourceArticleId: text(source.sourceArticleId, 100)
    };
    return Object.fromEntries(Object.entries(material).filter(([key]) => MATERIAL_FIELDS.has(key)));
  }

  function normalizeWritingRound(input) {
    const source = isObject(input) ? input : {};
    rejectSensitiveFields(source);
    const round = {
      id: text(source.id, 100),
      articleId: text(source.articleId, 100),
      draft: text(source.draft, 8000),
      feedback: text(source.feedback, 2000),
      userFeedback: text(source.userFeedback, 2000),
      revisionNote: text(source.revisionNote, 1000),
      materials: Array.isArray(source.materials)
        ? source.materials.slice(0, 20).map(normalizeWritingMaterial).filter(item => item.id || item.title || item.excerpt)
        : [],
      undo: normalizeUndo(source.undo),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    return Object.fromEntries(Object.entries(round).filter(([key]) => ROUND_FIELDS.has(key)));
  }

  function normalizeWritingStyleSample(input) {
    const source = isObject(input) ? input : {};
    const sample = {
      sourceArticleId: text(source.sourceArticleId, 100),
      excerpt: text(source.excerpt, 1200),
      features: textList(source.features, 12, 160)
    };
    return Object.fromEntries(Object.entries(sample).filter(([key]) => STYLE_SAMPLE_FIELDS.has(key)));
  }

  function normalizeWritingStyleProfile(input) {
    const source = isObject(input) ? input : {};
    rejectSensitiveFields(source);
    const profile = {
      id: text(source.id, 100),
      source: STYLE_PROFILE_SOURCES.includes(source.source) ? source.source : "",
      confidence: STYLE_CONFIDENCE.includes(source.confidence) ? source.confidence : "low",
      traits: textList(source.traits, 20, 160),
      samples: Array.isArray(source.samples)
        ? source.samples.slice(0, 5).map(normalizeWritingStyleSample).filter(item => item.sourceArticleId || item.excerpt || item.features.length)
        : [],
      sourceArticleIds: textList(source.sourceArticleIds, 20, 100),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    return Object.fromEntries(Object.entries(profile).filter(([key]) => STYLE_PROFILE_FIELDS.has(key)));
  }

  function normalizeWritingMemory(input) {
    const source = isObject(input) ? input : {};
    rejectSensitiveFields(source);
    const memory = {
      id: text(source.id, 100),
      scope: MEMORY_SCOPES.includes(source.scope) ? source.scope : "general",
      genre: WRITING_GENRES.includes(source.genre) ? source.genre : "",
      articleId: text(source.articleId, 100),
      sourceArticleId: text(source.sourceArticleId, 100),
      preference: text(source.preference),
      reason: text(source.reason, 1000),
      evidenceArticleIds: textList(source.evidenceArticleIds, 20, 100),
      undo: normalizeUndo(source.undo),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    return Object.fromEntries(Object.entries(memory).filter(([key]) => MEMORY_FIELDS.has(key)));
  }

  function normalizeWritingWorkspace(input) {
    const source = isObject(input) ? input : {};
    rejectSensitiveFields(source);
    const workspace = {
      id: text(source.id, 100),
      genre: WRITING_GENRES.includes(source.genre) ? source.genre : (source.genre === undefined ? "article" : ""),
      article: normalizeWritingArticle(source.article),
      rounds: Array.isArray(source.rounds)
        ? source.rounds.slice(0, 10).map(normalizeWritingRound).filter(round => round.id || round.draft || round.feedback)
        : [],
      styleProfile: normalizeWritingStyleProfile(source.styleProfile),
      styleProfiles: Array.isArray(source.styleProfiles)
        ? source.styleProfiles.slice(0, 3).map(normalizeWritingStyleProfile)
        : [],
      memory: normalizeWritingMemory(source.memory),
      memories: Array.isArray(source.memories)
        ? source.memories.slice(0, 30).map(normalizeWritingMemory).filter(memory => memory.id || memory.preference)
        : [],
      sourceArticleIds: textList(source.sourceArticleIds, 20, 100),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    return Object.fromEntries(Object.entries(workspace).filter(([key]) => WORKSPACE_FIELDS.has(key)));
  }

  return {
    WRITING_GENRES,
    MATERIAL_PURPOSES,
    STYLE_PROFILE_SOURCES,
    STYLE_CONFIDENCE,
    MEMORY_SCOPES,
    normalizeWritingArticle,
    normalizeWritingRound,
    normalizeWritingStyleProfile,
    normalizeWritingMemory,
    normalizeWritingWorkspace
  };
});
