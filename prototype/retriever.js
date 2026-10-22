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
      status() {
        return { mode, fallback };
      }
    };
  }

  function dedupeResearchResults(results) {
    const merged = [];
    const byKey = new Map();

    for (const result of Array.isArray(results) ? results : []) {
      if (!result || typeof result !== "object") continue;
      const platform = String(result.platform || "").trim().toLowerCase();
      const contentId = String(result.contentId || "").trim();
      const rawUrl = String(result.url || "").trim();
      let canonicalUrl = "";
      if (rawUrl) {
        try {
          const parsed = new URL(rawUrl);
          if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
            parsed.protocol = parsed.protocol.toLowerCase();
            parsed.hostname = parsed.hostname.toLowerCase();
            canonicalUrl = parsed.href;
          }
        } catch {}
      }

      const id = String(result.id || "").trim();
      const key = contentId
        ? `${platform}:content:${contentId}`
        : canonicalUrl
          ? `${platform}:url:${canonicalUrl}`
          : id ? `${platform}:id:${id}` : "";
      if (!key) continue;

      const existingIndex = byKey.get(key);
      if (existingIndex === undefined) {
        const searchQueries = [...new Set(Array.isArray(result.searchQueries)
          ? result.searchQueries.filter(query => typeof query === "string" && query.trim())
          : [])];
        const normalized = { ...result, searchQueries };
        if (canonicalUrl) normalized.url = canonicalUrl;
        else delete normalized.url;
        byKey.set(key, merged.length);
        merged.push(normalized);
        continue;
      }

      const existing = merged[existingIndex];
      const queries = Array.isArray(result.searchQueries) ? result.searchQueries : [];
      existing.searchQueries = [...new Set([
        ...(Array.isArray(existing.searchQueries) ? existing.searchQueries : []),
        ...queries.filter(query => typeof query === "string" && query.trim())
      ])];
      if (!existing.url && canonicalUrl) existing.url = canonicalUrl;
    }

    return merged;
  }

  return { createRetriever, dedupeResearchResults };
});
