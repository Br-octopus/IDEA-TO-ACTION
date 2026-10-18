(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepSearchDictionary = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const BUILT_IN_GROUPS = [
    ["提示词", "prompt"],
    ["复核", "review"],
    ["验收", "测试", "完成标准", "test", "testing", "acceptance"],
    ["计划", "方案", "plan"],
    ["案例", "示例", "example", "case"],
    ["失败", "问题", "failure", "issue", "problem"]
  ];
  const CJK_PATTERN = /[\u3400-\u9fff]/u;
  const CJK_RUN_PATTERN = /[\u3400-\u9fff]+/g;
  const WORD_PATTERN = /[a-z0-9]+|[\u3400-\u9fff]+/gi;
  const MAX_SEARCH_QUERY_LENGTH = 240;
  const MAX_SEARCH_TERMS = 128;

  function normalize(value) {
    return String(value == null ? "" : value).trim().toLocaleLowerCase();
  }

  function normalizeQuery(value) {
    return normalize(value).slice(0, MAX_SEARCH_QUERY_LENGTH);
  }

  function addUnique(target, value) {
    const normalized = normalize(value);
    if (normalized && !target.includes(normalized)) target.push(normalized);
  }

  function addChineseSplits(target, value, { includePhrase = true } = {}) {
    const source = normalize(value);
    if (!source) return;
    if (includePhrase) addUnique(target, source);
    if (!CJK_PATTERN.test(source)) return;

    const characters = [...source];
    for (let index = 0; index < characters.length - 1; index += 1) {
      addUnique(target, characters.slice(index, index + 2).join(""));
    }
  }

  function splitChineseTerms(value) {
    const source = normalizeQuery(value);
    if (!source) return [];
    const terms = [];

    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      try {
        const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
        for (const item of segmenter.segment(source)) {
          const segment = normalize(item.segment);
          if (!segment || !(/[a-z0-9]/i.test(segment) || CJK_PATTERN.test(segment))) continue;
          addChineseSplits(terms, segment);
        }
        for (const run of source.match(CJK_RUN_PATTERN) || []) {
          if ([...run].length <= 4) addChineseSplits(terms, run);
        }
        return terms.slice(0, MAX_SEARCH_TERMS);
      } catch {
        // 兼容暴露 Segmenter 但不支持中文分词配置的运行环境。
      }
    }

    for (const word of source.match(WORD_PATTERN) || []) {
      if (CJK_PATTERN.test(word)) {
        addChineseSplits(terms, word, { includePhrase: [...word].length <= 4 });
      }
      else addUnique(terms, word);
    }
    return terms.slice(0, MAX_SEARCH_TERMS);
  }

  function normalizeGroups(options = {}) {
    const groups = BUILT_IN_GROUPS.map(group => group.slice());
    const aliases = options.aliases || options.customAliases;
    if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) return groups;

    for (const [canonical, values] of Object.entries(aliases)) {
      const group = [];
      addUnique(group, canonical);
      for (const value of Array.isArray(values) ? values : [values]) addUnique(group, value);
      if (group.length) groups.push(group);
    }
    return groups;
  }

  function getTermGroup(term, options = {}) {
    const normalized = normalize(term);
    return normalizeGroups(options).find(group => group.includes(normalized)) || [normalized];
  }

  function expandSearchTerms(query, options = {}) {
    const baseTerms = splitChineseTerms(query);
    const terms = baseTerms.slice();
    const groups = normalizeGroups(options);
    for (const term of baseTerms) {
      const group = groups.find(item => item.includes(term));
      if (!group) continue;
      for (const alias of group) addUnique(terms, alias);
    }
    return terms.slice(0, MAX_SEARCH_TERMS);
  }

  function suggestionCandidates(entries) {
    const candidates = [];
    const addCandidate = value => {
      for (const term of splitChineseTerms(value)) {
        if (term.length <= 4) addUnique(candidates, term);
      }
    };
    for (const entry of Array.isArray(entries) ? entries : []) {
      addCandidate(entry && entry.title);
      for (const keyword of Array.isArray(entry?.keywords) ? entry.keywords : []) addCandidate(keyword);
    }
    return candidates;
  }

  function suggestSearchTerms(query, entriesOrOptions, maybeOptions = {}) {
    let entries;
    let options;
    if (Array.isArray(entriesOrOptions)) {
      entries = entriesOrOptions;
      options = maybeOptions && typeof maybeOptions === "object" && !Array.isArray(maybeOptions)
        ? maybeOptions
        : {};
    } else if (entriesOrOptions && typeof entriesOrOptions === "object") {
      if (!Array.isArray(entriesOrOptions.entries)) return [];
      entries = entriesOrOptions.entries;
      options = entriesOrOptions;
    } else {
      return [];
    }
    const sourceTerms = splitChineseTerms(query);
    if (!sourceTerms.length) return [];
    const queryText = normalize(query);
    const candidates = suggestionCandidates(entries);
    const groups = normalizeGroups(options);
    const ranked = [];
    const seen = new Set();
    const add = (term, rank) => {
      const normalized = normalize(term);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      ranked.push({ term: normalized, rank, order: ranked.length });
    };

    for (const candidate of candidates) {
      const directMatch = sourceTerms.some(term => candidate.includes(term) || term.includes(candidate));
      if (!directMatch) continue;
      add(candidate, candidate === queryText ? 0 : candidate.startsWith(sourceTerms[0]) ? 1 : 2);
      const group = groups.find(item => item.includes(candidate));
      if (group) for (const alias of group) add(alias, 3);
    }
    if (!ranked.length) {
      for (const group of groups) {
        if (group.some(term => term.includes(queryText) || queryText.includes(term))) {
          for (const alias of group) add(alias, 3);
        }
      }
    }
    return ranked
      .sort((left, right) => left.rank - right.rank || left.order - right.order)
      .slice(0, 3)
      .map(item => item.term);
  }

  return {
    mode: "dictionary",
    expandSearchTerms,
    splitChineseTerms,
    suggestSearchTerms,
    getTermGroup
  };
});
