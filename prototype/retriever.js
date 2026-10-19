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
    const seen = new Set();
    return (Array.isArray(results) ? results : []).filter(result => {
      const key = String(result?.url || result?.id || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return { createRetriever, dedupeResearchResults };
});
