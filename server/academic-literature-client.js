const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;
const PMID_PATTERN = /^\d{1,10}$/;

function normalizeDoi(value) {
  return String(value || "").trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[.,;\s]+$/g, "")
    .toLowerCase();
}

function publicationYear(value) {
  const parts = value?.["date-parts"]?.[0];
  if (Array.isArray(parts) && parts[0]) return String(parts[0]);
  return "";
}

function normalizeCrossref(message, queriedAt) {
  const title = Array.isArray(message.title) ? message.title[0] : message.title;
  const publicationDate = message["published-print"] || message["published-online"] || message.published || message.issued;
  return {
    title: String(title || "").trim(),
    authors: (Array.isArray(message.author) ? message.author : []).map(author => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean),
    year: publicationYear(publicationDate),
    publication: Array.isArray(message["container-title"]) ? String(message["container-title"][0] || "") : "",
    volume: String(message.volume || ""),
    issue: String(message.issue || ""),
    pages: String(message.page || ""),
    doi: normalizeDoi(message.DOI),
    pmid: "",
    itemType: String(message.type || ""),
    metadataProvider: "Crossref",
    queriedAt,
    metadataStatus: "registry-returned"
  };
}

function normalizePubMed(record, queriedAt, pmid) {
  const doiArticleId = (Array.isArray(record.articleids) ? record.articleids : [])
    .find(item => String(item.idtype || "").toLowerCase() === "doi");
  const doiFromLocation = String(record.elocationid || "").match(/(10\.\d{4,9}\/[^\s\]]+)/i)?.[1] || "";
  return {
    title: String(record.title || "").trim(),
    authors: (Array.isArray(record.authors) ? record.authors : []).map(author => String(author.name || "").trim()).filter(Boolean),
    year: String(record.pubdate || record.sortpubdate || "").match(/\d{4}/)?.[0] || "",
    publication: String(record.fulljournalname || record.source || ""),
    volume: String(record.volume || ""),
    issue: String(record.issue || ""),
    pages: String(record.pages || ""),
    doi: normalizeDoi(doiArticleId?.value || doiFromLocation),
    pmid,
    itemType: String(record.pubtype || ""),
    metadataProvider: "NCBI PubMed",
    queriedAt,
    metadataStatus: "registry-returned"
  };
}

function createAcademicLiteratureClient({ fetchImpl = globalThis.fetch, timeoutMs = 10000, now = () => new Date().toISOString() } = {}) {
  async function requestJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      if (response.status === 404) return { error: { code: "NOT_FOUND", message: "登记机构没有找到这条题录。" } };
      if (!response.ok) return { error: { code: "UPSTREAM_ERROR", message: "登记机构暂时无法查询，请稍后重试。" } };
      return { data: await response.json() };
    } catch (error) {
      return { error: {
        code: error?.name === "AbortError" ? "TIMEOUT" : "UPSTREAM_ERROR",
        message: error?.name === "AbortError" ? "题录查询超时，请稍后重试。" : "登记机构暂时无法连接，请稍后重试。"
      } };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async lookupByDoi(value) {
      const doi = normalizeDoi(value);
      if (!DOI_PATTERN.test(doi)) return { ok: false, code: "INVALID_IDENTIFIER", message: "请输入有效的 DOI。" };
      const outcome = await requestJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
      if (outcome.error) return { ok: false, ...outcome.error };
      const record = outcome.data?.message;
      if (!record || !String(record.DOI || "").trim()) return { ok: false, code: "NOT_FOUND", message: "登记机构没有找到这条题录。" };
      return { ok: true, metadata: normalizeCrossref(record, now()) };
    },

    async lookupByPmid(value) {
      const pmid = String(value || "").trim();
      if (!PMID_PATTERN.test(pmid)) return { ok: false, code: "INVALID_IDENTIFIER", message: "PMID 只能包含数字。" };
      const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
      url.searchParams.set("db", "pubmed");
      url.searchParams.set("id", pmid);
      url.searchParams.set("retmode", "json");
      const outcome = await requestJson(url);
      if (outcome.error) return { ok: false, ...outcome.error };
      const record = outcome.data?.result?.[pmid];
      if (!record || outcome.data?.result?.uids?.includes(pmid) === false) {
        return { ok: false, code: "NOT_FOUND", message: "登记机构没有找到这条题录。" };
      }
      return { ok: true, metadata: normalizePubMed(record, now(), pmid) };
    }
  };
}

module.exports = { createAcademicLiteratureClient, normalizeDoi };
