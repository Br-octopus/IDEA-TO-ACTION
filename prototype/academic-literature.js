(function (root, factory) {
  const schema = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./knowledge-schema.js")
    : root.ForwardStepKnowledgeSchema;
  const api = factory(schema);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepAcademicLiterature = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (schema) {
  const ENTRY_TYPE = "academic-literature";
  let nextId = 0;

  function cleanDoi(value) {
    return String(value || "").trim()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
      .replace(/[.,;\s]+$/g, "")
      .toLowerCase();
  }

  function splitAuthors(value) {
    return String(value || "").split(/\s+and\s+|\s*;\s*/i).map(item => item.trim()).filter(Boolean);
  }

  function makeEntry(fields) {
    const title = String(fields.title || "").trim();
    if (!title) throw new Error("缺少题名");
    const now = new Date().toISOString();
    return schema.normalizeKnowledgeEntry({
      id: `literature-${Date.now()}-${++nextId}`,
      type: ENTRY_TYPE,
      title,
      sourceType: fields.sourceType || "文献题录",
      sourceKind: "reference",
      sourceUrl: "",
      keywords: fields.keywords || [],
      summary: "",
      createdAt: now,
      updatedAt: now,
      literature: {
        authors: fields.authors || [],
        year: fields.year || "",
        publication: fields.publication || "",
        volume: fields.volume || "",
        issue: fields.issue || "",
        pages: fields.pages || "",
        doi: cleanDoi(fields.doi),
        pmid: fields.pmid || "",
        itemType: fields.itemType || "",
        metadataStatus: "unverified",
        readingStatus: "unread",
        claimRelations: []
      }
    });
  }

  function parseRis(content) {
    const records = [];
    const errors = [];
    let current = null;
    let lastTag = "";
    const lines = String(content || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    const finish = () => {
      if (!current) return;
      try {
        records.push(makeEntry({
          title: current.TI?.[0] || current.T1?.[0],
          authors: [...(current.AU || []), ...(current.A1 || [])],
          year: (current.PY?.[0] || current.Y1?.[0] || "").match(/\d{4}/)?.[0] || "",
          publication: current.JO?.[0] || current.JF?.[0] || current.T2?.[0] || "",
          volume: current.VL?.[0] || "",
          issue: current.IS?.[0] || "",
          pages: [current.SP?.[0], current.EP?.[0]].filter(Boolean).join("-"),
          doi: current.DO?.[0] || "",
          pmid: current.PM?.[0] || current.M3?.[0] || "",
          itemType: current.TY?.[0] || ""
        }));
      } catch (error) {
        errors.push({ record: records.length + errors.length + 1, message: `RIS 记录无效：${error.message}` });
      }
      current = null;
      lastTag = "";
    };
    for (const line of lines) {
      const match = line.match(/^\s*([A-Z0-9]{2})\s+-\s?(.*)$/i);
      if (match) {
        const tag = match[1].toUpperCase();
        if (tag === "TY") {
          finish();
          current = {};
        }
        if (tag === "ER") {
          finish();
          continue;
        }
        if (!current) current = {};
        (current[tag] ||= []).push(match[2].trim());
        lastTag = tag;
      } else if (current && /^\s+\S/.test(line) && lastTag) {
        const values = current[lastTag];
        values[values.length - 1] += ` ${line.trim()}`;
      }
    }
    finish();
    if (!records.length && !errors.length) errors.push({ record: 1, message: "没有找到 RIS 文献记录。" });
    return { entries: records, errors };
  }

  function readBibValue(source, start) {
    let index = start;
    while (/\s/.test(source[index] || "")) index++;
    const opening = source[index];
    if (opening === "{" || opening === '"') {
      const closing = opening === "{" ? "}" : '"';
      let depth = opening === "{" ? 1 : 0;
      let value = "";
      for (index++; index < source.length; index++) {
        const character = source[index];
        if (character === "\\" && index + 1 < source.length) {
          value += source[++index];
          continue;
        }
        if (opening === "{" && character === "{") depth++;
        if (character === closing) {
          if (opening === '"' || --depth === 0) return { value: value.trim(), next: index + 1 };
        }
        value += character;
      }
      throw new Error("字段括号或引号未闭合");
    }
    const end = source.indexOf(",", index);
    const braceEnd = source.indexOf("}", index);
    const parenEnd = source.indexOf(")", index);
    const candidates = [end, braceEnd, parenEnd].filter(item => item >= 0);
    const stop = candidates.length ? Math.min(...candidates) : source.length;
    return { value: source.slice(index, stop).trim(), next: stop };
  }

  function parseBibTeX(content) {
    const source = String(content || "").replace(/^\uFEFF/, "");
    const entries = [];
    const errors = [];
    const header = /@([a-z]+)\s*([({])/ig;
    let match;
    while ((match = header.exec(source))) {
      const itemType = match[1].toLowerCase();
      const opener = match[2];
      const closer = opener === "{" ? "}" : ")";
      const bodyStart = header.lastIndex;
      let depth = 1;
      let quote = false;
      let end = -1;
      for (let index = bodyStart; index < source.length; index++) {
        const character = source[index];
        if (character === '"' && source[index - 1] !== "\\") quote = !quote;
        if (quote) continue;
        if (character === opener) depth++;
        if (character === closer && --depth === 0) { end = index; break; }
      }
      if (end < 0) {
        const remaining = source.slice(bodyStart);
        const nextEntry = /(?:^|\n)\s*@([a-z]+)\s*[{(]/i.exec(remaining);
        errors.push({ record: entries.length + errors.length + 1, message: "BibTeX 记录括号未闭合；已跳过此条并继续检查后续记录。" });
        if (!nextEntry) break;
        header.lastIndex = bodyStart + nextEntry.index + nextEntry[0].lastIndexOf("@");
        continue;
      }
      if (["comment", "preamble", "string"].includes(itemType)) {
        header.lastIndex = end + 1;
        continue;
      }
      const record = source.slice(bodyStart, end);
      const firstComma = record.indexOf(",");
      if (firstComma < 0) {
        errors.push({ record: entries.length + errors.length + 1, message: "BibTeX 记录缺少字段。" });
        header.lastIndex = end + 1;
        continue;
      }
      const fieldsText = record.slice(firstComma + 1);
      const fields = {};
      const fieldPattern = /([a-z][\w-]*)\s*=\s*/ig;
      let fieldMatch;
      while ((fieldMatch = fieldPattern.exec(fieldsText))) {
        const fieldName = fieldMatch[1].toLowerCase();
        try {
          const parsed = readBibValue(fieldsText, fieldPattern.lastIndex);
          fields[fieldName] = parsed.value;
          fieldPattern.lastIndex = parsed.next;
          if (fieldsText[fieldPattern.lastIndex] === "#") fieldPattern.lastIndex++;
        } catch (error) {
          errors.push({ record: entries.length + errors.length + 1, message: `BibTeX 字段 ${fieldName} 无效：${error.message}` });
          break;
        }
      }
      try {
        entries.push(makeEntry({
          title: fields.title,
          authors: splitAuthors(fields.author),
          year: fields.year || "",
          publication: fields.journal || fields.booktitle || fields.publisher || "",
          volume: fields.volume || "",
          issue: fields.number || fields.issue || "",
          pages: fields.pages || "",
          doi: fields.doi || "",
          pmid: fields.pmid || "",
          itemType
        }));
      } catch (error) {
        errors.push({ record: entries.length + errors.length + 1, message: `BibTeX 记录无效：${error.message}` });
      }
      header.lastIndex = end + 1;
    }
    if (!entries.length && !errors.length) errors.push({ record: 1, message: "没有找到 BibTeX 文献记录。" });
    return { entries, errors };
  }

  function parseLiteratureImport(content, format) {
    const normalizedFormat = String(format || "").trim().toLowerCase().replace(/^\./, "");
    if (normalizedFormat === "ris") return parseRis(content);
    if (normalizedFormat === "bib" || normalizedFormat === "bibtex") return parseBibTeX(content);
    throw new Error("当前仅支持 RIS 和 BibTeX 子集。 ");
  }

  function deduplicateLiteratureEntries(incoming, existing = []) {
    const known = new Set((existing || []).map(entry => cleanDoi(entry?.literature?.doi)).filter(Boolean));
    const entries = [];
    const duplicates = [];
    for (const entry of incoming || []) {
      const doi = cleanDoi(entry?.literature?.doi);
      if (doi && known.has(doi)) duplicates.push(entry);
      else {
        entries.push(entry);
        if (doi) known.add(doi);
      }
    }
    return { entries, duplicates };
  }

  function risLine(tag, value) {
    const clean = String(value || "").replace(/[\r\n]+/g, " ").trim();
    return clean ? `${tag}  - ${clean}` : "";
  }

  function exportLiteratureRis(entries) {
    return (entries || []).filter(entry => entry?.type === ENTRY_TYPE).map(entry => {
      const literature = entry.literature || {};
      const pages = String(literature.pages || "").split(/[-–]/);
      return [
        risLine("TY", literature.itemType || "JOUR"),
        ...(literature.authors || []).map(author => risLine("AU", author)),
        risLine("TI", entry.title),
        risLine("PY", literature.year),
        risLine("JO", literature.publication),
        risLine("VL", literature.volume),
        risLine("IS", literature.issue),
        risLine("SP", pages[0]),
        risLine("EP", pages[1]),
        risLine("DO", literature.doi),
        risLine("ER", "")
      ].filter(Boolean).join("\n");
    }).join("\n\n");
  }

  function buildReadingPrompt(entries, selectedIds) {
    const ids = [...new Set((selectedIds || []).map(String))];
    if (ids.length > 5) throw new RangeError("一次最多选择 5 条文献生成阅读提示词。");
    const selected = ids.map(id => (entries || []).find(entry => entry?.id === id && entry.type === ENTRY_TYPE)).filter(Boolean);
    if (!selected.length) throw new Error("请先选择至少一条文献。");
    const descriptions = selected.map((entry, index) => {
      const item = entry.literature || {};
      const bibliography = [item.authors.join("、"), item.year, entry.title, item.publication, item.doi && `DOI ${item.doi}`, item.pmid && `PMID ${item.pmid}`].filter(Boolean).join("；");
      const excerpt = item.abstractExcerpt
        ? `用户提供摘录${item.excerptLocation ? `（位置：${item.excerptLocation}）` : ""}：\n${item.abstractExcerpt}`
        : "当前只有题录，没有用户提供的摘要或摘录。";
      return `${index + 1}. ${bibliography}\n阅读范围：${item.readingStatus || "unread"}\n${excerpt}`;
    });
    return [
      "请协助阅读以下用户选定的文献材料。题录、摘要或摘录不等于已阅读全文；不得声称查看了未提供的全文，不得补造研究数据、方法或引文。",
      "逐条区分材料明确写出的内容、基于材料的推断和仍需查看全文的事项；证据不足时明确说明。",
      descriptions.join("\n\n")
    ].join("\n\n");
  }

  return { parseLiteratureImport, deduplicateLiteratureEntries, exportLiteratureRis, buildReadingPrompt };
});
