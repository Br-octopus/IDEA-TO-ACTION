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
  const VERIFICATION_STATES = Object.freeze(["unverified", "source-reviewed", "user-confirmed"]);
  const TEXT_LIMIT = 500;
  // 沿用正文上限；历史按数组顺序保留最近轮次，避免新改稿被旧记录挤掉。
  const DRAFT_LIMIT = 8000;
  const ROUND_LIMIT = 100;

  const ARTICLE_FIELDS = new Set([
    "id", "title", "genre", "goal", "audience", "platform", "preserveItems", "dimensions", "constraints",
    "successCriteria", "sourceArticleId", "draft", "saveEnabled", "styleProfileId",
    "createdAt", "updatedAt", "research"
  ]);
  const MATERIAL_FIELDS = new Set(["id", "title", "purpose", "excerpt", "sourceArticleId"]);
  const SOURCE_FIELDS = new Set(["title", "url", "excerpt", "purpose", "verificationStatus", "origin"]);
  const ROUND_FIELDS = new Set([
    "id", "articleId", "draft", "feedback", "userFeedback", "revisionNote",
    "parentRoundId", "diagnosis", "prompt", "sources", "materials", "preferences", "undo", "createdAt", "updatedAt"
  ]);
  const UNDO_FIELDS = new Set(["action", "memoryId", "roundId", "undoneAt"]);
  const STYLE_SAMPLE_FIELDS = new Set(["sourceArticleId", "excerpt", "features"]);
  const STYLE_PROFILE_FIELDS = new Set([
    "id", "source", "confidence", "traits", "samples", "userCorrections", "scope", "genre",
    "sourceArticleIds", "createdAt", "updatedAt"
  ]);
  const MEMORY_FIELDS = new Set([
    "id", "scope", "genre", "articleId", "sourceArticleId",
    "preference", "reason", "example", "counterexample", "sourcePreferenceKey", "evidenceArticleIds", "undo",
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
    const article = {
      id: text(source.id, 100),
      title: text(source.title),
      genre: WRITING_GENRES.includes(source.genre) ? source.genre : (source.genre === undefined ? "article" : ""),
      goal: text(source.goal),
      successCriteria: textList(source.successCriteria, 20, 500),
      audience: text(source.audience),
      platform: text(source.platform, 160),
      preserveItems: textList(source.preserveItems, 30),
      dimensions: textList(source.dimensions, 8, 160),
      constraints: text(source.constraints),
      sourceArticleId: text(source.sourceArticleId, 100),
      draft: text(source.draft, DRAFT_LIMIT),
      saveEnabled: source.saveEnabled === true,
      styleProfileId: text(source.styleProfileId, 100),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    // 研究计划只在会话中，持久化仅记录本篇拒绝，导入不能自动授权搜索。
    if (isObject(source.research) && source.research.status === 'rejected') article.research = { status: 'rejected' };
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
    const round = {
      id: text(source.id, 100),
      articleId: text(source.articleId, 100),
      parentRoundId: text(source.parentRoundId, 100),
      draft: text(source.draft, DRAFT_LIMIT),
      diagnosis: text(source.diagnosis, 4000),
      prompt: text(source.prompt, 8000),
      feedback: text(source.feedback, 2000),
      userFeedback: text(source.userFeedback, 2000),
      revisionNote: text(source.revisionNote, 1000),
      sources: Array.isArray(source.sources)
        ? source.sources.slice(0, 20).map(normalizeWritingSource).filter(item => item.title || item.url || item.excerpt)
        : [],
      materials: Array.isArray(source.materials)
        ? source.materials.slice(0, 20).map(normalizeWritingMaterial).filter(item => item.id || item.title || item.excerpt)
        : [],
      undo: normalizeUndo(source.undo),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    if (Object.prototype.hasOwnProperty.call(source, "preferences")) {
      round.preferences = (Array.isArray(source.preferences) ? source.preferences : []).slice(0, 8)
        .filter(isObject).map(item => ({
          preference: text(item.preference),
          ...(Object.prototype.hasOwnProperty.call(item, "example") ? { example: text(item.example) } : {}),
          ...(Object.prototype.hasOwnProperty.call(item, "counterexample") ? { counterexample: text(item.counterexample) } : {})
        })).filter(item => item.preference);
    }
    return Object.fromEntries(Object.entries(round).filter(([key]) => ROUND_FIELDS.has(key)));
  }

  function normalizeWritingSource(input) {
    const source = isObject(input) ? input : {};
    const entry = {
      title: text(source.title, 160),
      url: text(source.url, 2000),
      excerpt: text(source.excerpt, 1200),
      purpose: MATERIAL_PURPOSES.includes(source.purpose) ? source.purpose : "content",
      verificationStatus: VERIFICATION_STATES.includes(source.verificationStatus) ? source.verificationStatus : "unverified"
    };
    if (["local-search", "public-research"].includes(source.origin)) entry.origin = source.origin;
    return Object.fromEntries(Object.entries(entry).filter(([key]) => SOURCE_FIELDS.has(key)));
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
    const profile = {
      id: text(source.id, 100),
      source: STYLE_PROFILE_SOURCES.includes(source.source) ? source.source : "",
      confidence: STYLE_CONFIDENCE.includes(source.confidence) ? source.confidence : "low",
      userCorrections: text(source.userCorrections, 2000),
      scope: MEMORY_SCOPES.includes(source.scope) ? source.scope : "article",
      genre: WRITING_GENRES.includes(source.genre) ? source.genre : "",
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
    for (const field of ["example", "counterexample", "sourcePreferenceKey"]) {
      if (Object.prototype.hasOwnProperty.call(source, field)) memory[field] = text(source[field]);
    }
    return Object.fromEntries(Object.entries(memory).filter(([key]) => MEMORY_FIELDS.has(key)));
  }

  function normalizeWritingWorkspace(input) {
    const source = isObject(input) ? input : {};
    const genre = WRITING_GENRES.includes(source.genre) ? source.genre : (source.genre === undefined ? "article" : "");
    const articleInput = isObject(source.article) ? source.article : {};
    const workspace = {
      id: text(source.id, 100),
      genre,
      article: normalizeWritingArticle({
        ...articleInput,
        genre: articleInput.genre === undefined ? source.genre : articleInput.genre
      }),
      rounds: Array.isArray(source.rounds)
        ? source.rounds.slice(-ROUND_LIMIT).map(normalizeWritingRound).filter(round => round.id || round.draft
          || round.feedback || round.userFeedback || round.revisionNote || round.diagnosis || round.prompt
          || round.sources.length || round.materials.length || round.preferences?.length || Object.keys(round.undo).length)
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
