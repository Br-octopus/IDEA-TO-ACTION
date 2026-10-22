(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./knowledge-search.js"));
  } else {
    root.ForwardStepRetriever = factory(root.ForwardStepKnowledgeSearch);
  }
})(typeof globalThis === "undefined" ? this : globalThis, function (knowledgeSearch) {
  function createRetriever({ mode = "keyword", semanticProvider = null } = {}) {
    let fallback = false;

    return {
      async search(entries, query, options = {}) {
        if (mode === "semantic" && typeof semanticProvider?.search === "function") {
          try {
            return await semanticProvider.search(entries, query, options);
          } catch {
            fallback = true;
          }
        }
        return knowledgeSearch.searchKnowledge(entries, query, options);
      },
      async searchPromptAgentMaterials(entries, query, options = {}) {
        if (typeof knowledgeSearch.selectPromptAgentEntries === "function") {
          return knowledgeSearch.selectPromptAgentEntries(entries, query, options);
        }
        return this.search(entries, query, options);
      },
      status() {
        return { mode, fallback };
      }
    };
  }

  function dedupeResearchResults(results) {
    const merged = [];
    const byContent = new Map();
    const byUrl = new Map();

    for (const result of Array.isArray(results) ? results : []) {
      if (!result || typeof result !== "object") continue;
      const platform = String(result.platform || "").trim().toLowerCase();
      const contentId = String(result.contentId || "").trim();
      const url = String(result.url || "").trim();
      const contentKey = platform && contentId ? `${platform}:${contentId}` : "";
      const urlKey = platform && url ? `${platform}:${exactUrlKey(url)}` : "";
      const existingIndex = contentKey && byContent.has(contentKey) ? byContent.get(contentKey)
        : urlKey && byUrl.has(urlKey) ? byUrl.get(urlKey) : undefined;

      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];
        const accessUrl = isValidAccessUrl(existing.url) ? existing.url
          : isValidAccessUrl(url) ? url : existing.url;
        const combined = {
          ...existing,
          ...result,
          id: existing.id,
          url: accessUrl,
          contentId: existing.contentId || contentId,
          searchQueries: [...new Set([...(existing.searchQueries || []), ...(result.searchQueries || [])])]
        };
        merged[existingIndex] = combined;
        if (combined.contentId) byContent.set(`${platform}:${combined.contentId}`, existingIndex);
        if (isValidAccessUrl(combined.url)) byUrl.set(`${platform}:${exactUrlKey(combined.url)}`, existingIndex);
        continue;
      }

      const index = merged.push({ ...result, searchQueries: [...new Set(result.searchQueries || [])] }) - 1;
      if (contentKey) byContent.set(contentKey, index);
      if (urlKey && exactUrlKey(url)) byUrl.set(urlKey, index);
    }
    return merged;
  }

  function exactUrlKey(value) {
    try {
      const url = new URL(value);
      return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "";
    }
  }

  function isValidAccessUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  return { createRetriever, dedupeResearchResults };
});
