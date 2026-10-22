(function (root, factory) {
  const schema = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./knowledge-schema.js")
    : root.ForwardStepKnowledgeSchema;
  const literature = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./academic-literature.js")
    : root.ForwardStepAcademicLiterature;
  const api = factory(schema, literature);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepAcademicLiteratureUI = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (schema, literature) {
  const METADATA_LABELS = { unverified: "未核验", "registry-returned": "注册表返回", "user-verified": "用户已核对" };
  const READING_LABELS = {
    unread: "未读", "title-only": "仅查看题录", "abstract-only": "仅查看摘要",
    "excerpt-only": "查看指定摘录", "full-text-user-confirmed": "用户确认读过全文"
  };
  const RELATION_LABELS = { unassessed: "未评估", supports: "支持", "does-not-support": "不支持", contradicts: "相反", insufficient: "证据不足" };
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const splitAuthors = value => Array.isArray(value) ? value : String(value || "").split(/[;\n]+/).map(item => item.trim()).filter(Boolean);

  function createAcademicLiteratureUI({ root, getState, saveState, fetchImpl = globalThis.fetch, confirmExternal = () => false, notify = () => {}, clipboard = async () => {}, download } = {}) {
    if (!root || typeof root.addEventListener !== "function" || typeof getState !== "function" || typeof saveState !== "function") {
      throw new TypeError("文献管理界面缺少根节点或状态接口");
    }
    let importPreview = null;
    let pendingLookup = null;
    let appliedLookup = null;
    let externalScopeConfirmed = false;
    let searchQuery = "";
    let lookupDoi = "";
    let lookupPmid = "";
    let previewPrompt = "";
    let importText = "";
    let importFormat = "ris";
    let draft = {};
    let saveStateImpl = saveState;

    const state = () => getState() || { knowledgeEntries: [], knowledgeSelection: [] };
    const entries = () => (Array.isArray(state().knowledgeEntries) ? state().knowledgeEntries : []);
    const literatureEntries = () => entries().filter(entry => entry.type === "academic-literature");
    const selectedIds = () => Array.isArray(state().knowledgeSelection) ? state().knowledgeSelection : [];
    const save = async next => {
      try {
        const accepted = await saveStateImpl(next);
        if (accepted === false) throw new Error("保存失败，原有资料保持不变。");
        return true;
      } catch (error) {
        throw new Error(`文献未保存：${error.message || "本地存储不可用"}`);
      }
    };
    const nextState = patch => ({ ...state(), ...patch });
    const valueList = (values, selected) => Object.entries(values).map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
    const option = (values, selected) => valueList(values, selected);

    function filteredEntries() {
      const query = searchQuery.trim().toLocaleLowerCase();
      if (!query) return literatureEntries();
      return literatureEntries().filter(entry => {
        const item = entry.literature || {};
        return [entry.title, ...(item.authors || []), item.doi, item.pmid, ...(entry.keywords || [])]
          .some(value => String(value || "").toLocaleLowerCase().includes(query));
      });
    }

    function renderEntryList() {
      const list = root.querySelector?.("[data-literature-list]");
      if (!list) return;
      list.innerHTML = filteredEntries().map(entry => {
        const item = entry.literature || {};
        const relation = item.claimRelations?.[0];
        return `<article class="reference academic-literature-card"><div class="library-item-head"><label><input type="checkbox" data-lit-select="${escapeHtml(entry.id)}"${selectedIds().includes(entry.id) ? " checked" : ""}> 选入阅读任务/写作材料</label><h3>${escapeHtml(entry.title)}</h3></div>`
          + `<p>${escapeHtml((item.authors || []).join("；") || "作者未填写")} · ${escapeHtml(item.year || "年份未填写")} · ${escapeHtml(item.publication || "刊物未填写")}</p>`
          + `<p class="library-meta">DOI：${escapeHtml(item.doi || "—")} · PMID：${escapeHtml(item.pmid || "—")}</p>`
          + `<div class="extra-grid"><label>题录核验<select data-lit-entry="${escapeHtml(entry.id)}" data-lit-field="metadataStatus">${option(METADATA_LABELS, item.metadataStatus || "unverified")}</select></label>`
          + `<label>本人阅读范围<select data-lit-entry="${escapeHtml(entry.id)}" data-lit-field="readingStatus">${option(READING_LABELS, item.readingStatus || "unread")}</select></label>`
          + `<label>论断关系<select data-lit-entry="${escapeHtml(entry.id)}" data-lit-field="claimRelation">${option(RELATION_LABELS, relation?.relation || "unassessed")}</select></label></div>`
          + `<p><strong>摘要/摘录：</strong>${escapeHtml(item.abstractExcerpt || "未提供；当前只有题录。")}${item.excerptLocation ? `（${escapeHtml(item.excerptLocation)}）` : ""}</p>`
          + `<p class="library-meta">来源：${escapeHtml(item.metadataProvider || entry.sourceType || "用户录入")} · 查询时间：${escapeHtml(item.queriedAt || "未查询")}</p>`
          + `<button class="button-secondary" type="button" data-lit-edit="${escapeHtml(entry.id)}">编辑题录与摘录</button>`
          + `<div class="extra-grid"><input aria-label="待核对论断" data-lit-claim="${escapeHtml(entry.id)}" value="${escapeHtml(relation?.claim || "")}" placeholder="待核对论断"><input aria-label="原文位置" data-lit-location="${escapeHtml(entry.id)}" value="${escapeHtml(relation?.location || "")}" placeholder="原文位置"><input aria-label="用户记录的依据" data-lit-rationale="${escapeHtml(entry.id)}" value="${escapeHtml(relation?.rationale || "")}" placeholder="你记录的依据"><button type="button" class="button-secondary" data-lit-action="save-claim" data-lit-id="${escapeHtml(entry.id)}">保存论断关系</button></div></article>`;
      }).join("") || '<p class="library-meta">没有匹配的文献。</p>';
    }

    function render() {
      const currentDraft = draft;
      root.innerHTML = `<section class="content-block academic-literature-manager" aria-label="文献管理">
        <h2>学术文献库</h2><p class="block-desc">在本地管理题录、用户摘录和独立状态。导入或登记查询不会标记已读，也不会证明论断成立。</p>
        <div class="extra-grid"><label>本地检索<input type="search" data-lit-search value="${escapeHtml(searchQuery)}" placeholder="题名、作者、DOI、PMID 或关键词"></label><button type="button" class="button-secondary" data-lit-action="export-ris">导出 RIS</button></div>
        <section class="content-block"><h3>导入题录</h3><label>格式<select data-lit-import-format><option value="ris"${importFormat === "ris" ? " selected" : ""}>RIS</option><option value="bibtex"${importFormat === "bibtex" ? " selected" : ""}>BibTeX</option></select></label><label>粘贴 RIS/BibTeX 或选择文件<textarea data-lit-import-text placeholder="粘贴题录文本；支持 .ris、.bib、.bibtex">${escapeHtml(importText)}</textarea></label><input type="file" accept=".ris,.bib,.bibtex" data-lit-file><button type="button" class="button-secondary" data-lit-action="preview-import">预览并检查重复</button>
        ${importPreview ? `<div class="notice"><strong>导入预览：</strong>${importPreview.entries.length} 条可导入，${importPreview.duplicates.length} 条 DOI 重复，${importPreview.errors.length} 条无效。${importPreview.errors.map(error => `<p>${escapeHtml(error.message)}</p>`).join("")}${importPreview.entries.map(entry => `<label class="check-row"><input type="checkbox" data-lit-import-id="${escapeHtml(entry.id)}" checked>${escapeHtml(entry.title)} · ${escapeHtml(entry.literature.doi || "无 DOI")}</label>`).join("")}<button type="button" class="button-primary" data-lit-action="commit-import">导入勾选项</button></div>` : ""}</section>
        <section class="content-block"><h3>按 DOI 或 PMID 登记题录</h3><p>查询前勾选范围并确认。只把规范化 DOI 或 PMID 发送给 Crossref/NCBI；不发送标题、摘要、摘录、正文、项目或本机路径。查询仅取题录，不保存提供方摘要。</p><label class="check-row"><input type="checkbox" data-lit-external-scope${externalScopeConfirmed ? " checked" : ""}>我确认向登记机构发送下面填写的单个标识符</label><div class="extra-grid"><label>DOI<input data-lit-doi value="${escapeHtml(lookupDoi)}" placeholder="10.xxxx/xxxx"></label><label>PMID<input data-lit-pmid value="${escapeHtml(lookupPmid)}" inputmode="numeric" placeholder="仅数字"></label></div><button type="button" class="button-secondary" data-lit-action="lookup">查询所填标识符</button>${pendingLookup ? `<div class="notice">已查到题录：${escapeHtml(pendingLookup.title)} · ${escapeHtml(pendingLookup.metadataProvider)}。此结果尚未保存。<button type="button" class="button-secondary" data-lit-action="apply-lookup">填入编辑表单</button></div>` : ""}</section>
        <section class="content-block"><h3>${currentDraft.id ? "编辑文献" : "手动添加文献"}</h3><form data-lit-form><div class="extra-grid">
          <label>题名<input required data-lit-draft="title" value="${escapeHtml(currentDraft.title || "")}"></label><label>作者（每行或用分号分隔）<textarea data-lit-draft="authors">${escapeHtml((currentDraft.literature?.authors || []).join("\n"))}</textarea></label>
          <label>年份<input data-lit-draft="year" value="${escapeHtml(currentDraft.literature?.year || "")}"></label><label>刊物/出版物<input data-lit-draft="publication" value="${escapeHtml(currentDraft.literature?.publication || "")}"></label>
          <label>卷<input data-lit-draft="volume" value="${escapeHtml(currentDraft.literature?.volume || "")}"></label><label>期<input data-lit-draft="issue" value="${escapeHtml(currentDraft.literature?.issue || "")}"></label><label>页码<input data-lit-draft="pages" value="${escapeHtml(currentDraft.literature?.pages || "")}"></label>
          <label>DOI<input data-lit-draft="doi" value="${escapeHtml(currentDraft.literature?.doi || "")}"></label><label>PMID<input data-lit-draft="pmid" value="${escapeHtml(currentDraft.literature?.pmid || "")}"></label>
          <label class="wide">用户主动提供的摘要/摘录（最多 1200 字）<textarea maxlength="1200" data-lit-draft="abstractExcerpt">${escapeHtml(currentDraft.literature?.abstractExcerpt || "")}</textarea></label><label>摘录位置<input data-lit-draft="excerptLocation" value="${escapeHtml(currentDraft.literature?.excerptLocation || "")}"></label>
          <label>题录核验状态<select data-lit-draft="metadataStatus">${option(METADATA_LABELS, currentDraft.literature?.metadataStatus || "unverified")}</select></label><label>本人阅读范围<select data-lit-draft="readingStatus">${option(READING_LABELS, currentDraft.literature?.readingStatus || "unread")}</select></label>
        </div><div class="button-row"><button class="button-primary" type="submit">保存文献</button><button class="button-secondary" type="button" data-lit-action="new-entry">清空表单</button></div></form></section>
        <section class="content-block"><div class="block-top"><h3>文献记录（${literatureEntries().length}）</h3><button type="button" class="button-secondary" data-lit-action="build-prompt">生成阅读提示词</button></div><div data-literature-list class="reference-grid"></div><label>阅读提示词（仅含已选题录和用户摘录）<textarea readonly data-lit-prompt>${escapeHtml(previewPrompt)}</textarea></label><div class="button-row"><button type="button" class="button-secondary" data-lit-action="copy-prompt">复制阅读提示词</button></div></section>
      </section>`;
      renderEntryList();
    }

    function previewImport(text = importText, format = importFormat) {
      importText = String(text || "");
      importFormat = String(format || "ris");
      const parsed = literature.parseLiteratureImport(importText, importFormat);
      const unique = literature.deduplicateLiteratureEntries(parsed.entries, literatureEntries());
      importPreview = { ...parsed, entries: unique.entries, duplicates: unique.duplicates };
      render();
      return importPreview;
    }

    async function commitImport(ids) {
      if (!importPreview) throw new Error("请先生成导入预览。");
      const selected = new Set((ids || []).map(String));
      const imported = importPreview.entries.filter(entry => selected.has(entry.id));
      if (!imported.length) throw new Error("请勾选至少一条有效文献。");
      const next = nextState({ knowledgeEntries: [...imported, ...entries()] });
      await save(next);
      importPreview = null;
      render();
      notify(`已导入 ${imported.length} 条文献；无效和重复项目未写入。`);
      return { imported: imported.length };
    }

    function setExternalScopeConfirmed(value) {
      externalScopeConfirmed = value === true;
      render();
    }

    async function lookup(kind, rawValue, options = {}) {
      const type = String(kind || "").toLowerCase();
      if (!['doi', 'pmid'].includes(type)) return { ok: false, code: "INVALID_IDENTIFIER" };
      if (!(options.externalScopeConfirmed === true || externalScopeConfirmed)) return { ok: false, code: "SCOPE_NOT_CONFIRMED" };
      const identifier = type === "doi" ? String(rawValue || "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/[.,;\s]+$/g, "").toLowerCase() : String(rawValue || "").trim();
      if (!identifier) return { ok: false, code: "INVALID_IDENTIFIER" };
      if (!confirmExternal(`本次只会向 ${type === "doi" ? "Crossref" : "NCBI"} 发送一个 ${type.toUpperCase()} 标识符（${identifier}）；不会发送其他表单或本地内容。是否继续？`)) {
        return { ok: false, code: "CANCELLED" };
      }
      // 新请求开始后旧结果不再能代表当前查询；失败时仍保留本次输入供修正或重试。
      pendingLookup = null;
      try {
        const response = await fetchImpl("/api/academic-literature/lookup", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [type]: identifier })
        });
        const payload = await response.json();
        if (!response.ok || !payload?.metadata) throw new Error(payload?.message || "登记查询失败");
        pendingLookup = schema.normalizeLiteratureMetadata(payload.metadata);
        pendingLookup.title = String(payload.metadata.title || "");
        if (type === "doi") lookupDoi = "";
        else lookupPmid = "";
        render();
        notify("已取得登记题录；请核对后手动填入并保存。阅读状态仍为未读。");
        return { ok: true, metadata: pendingLookup };
      } catch (error) {
        render();
        notify(`查询失败，题录和已有状态未改变：${error.message || "网络不可用"}`);
        return { ok: false, code: "LOOKUP_FAILED", message: error.message || "查询失败" };
      }
    }

    function applyLookupMetadata() {
      if (!pendingLookup) throw new Error("没有待应用的登记题录。");
      appliedLookup = { ...pendingLookup };
      draft = { ...draft, title: pendingLookup.title || draft.title || "", literature: { ...pendingLookup } };
      render();
      return getDraft();
    }

    function getDraft() {
      return JSON.parse(JSON.stringify(draft || {}));
    }

    function editLiterature(id) {
      const entry = literatureEntries().find(item => item.id === id);
      if (!entry) throw new Error("找不到该文献。");
      draft = JSON.parse(JSON.stringify(entry));
      appliedLookup = null;
      render();
      return getDraft();
    }

    async function saveManual(fields = {}) {
      const previous = fields.id ? literatureEntries().find(entry => entry.id === fields.id) : null;
      const id = previous?.id || fields.id || `literature-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const inputLiterature = fields.literature || {};
      const fromLookup = appliedLookup || {};
      const metadata = schema.normalizeLiteratureMetadata({
        ...fromLookup,
        ...inputLiterature,
        authors: inputLiterature.authors ?? splitAuthors(fields.authors ?? fromLookup.authors),
        year: inputLiterature.year ?? fields.year ?? fromLookup.year,
        publication: inputLiterature.publication ?? fields.publication ?? fromLookup.publication,
        volume: inputLiterature.volume ?? fields.volume ?? fromLookup.volume,
        issue: inputLiterature.issue ?? fields.issue ?? fromLookup.issue,
        pages: inputLiterature.pages ?? fields.pages ?? fromLookup.pages,
        doi: inputLiterature.doi ?? fields.doi ?? fromLookup.doi,
        pmid: inputLiterature.pmid ?? fields.pmid ?? fromLookup.pmid,
        abstractExcerpt: inputLiterature.abstractExcerpt ?? fields.abstractExcerpt ?? previous?.literature?.abstractExcerpt,
        excerptLocation: inputLiterature.excerptLocation ?? fields.excerptLocation ?? previous?.literature?.excerptLocation,
        metadataProvider: fromLookup.metadataProvider || inputLiterature.metadataProvider || previous?.literature?.metadataProvider || "",
        queriedAt: fromLookup.queriedAt || inputLiterature.queriedAt || previous?.literature?.queriedAt || "",
        metadataStatus: inputLiterature.metadataStatus || fields.metadataStatus || fromLookup.metadataStatus || previous?.literature?.metadataStatus || "unverified",
        readingStatus: inputLiterature.readingStatus || fields.readingStatus || previous?.literature?.readingStatus || "unread",
        claimRelations: inputLiterature.claimRelations || previous?.literature?.claimRelations || []
      });
      const entry = schema.normalizeKnowledgeEntry({
        ...(previous || {}), id, type: "academic-literature", title: fields.title || draft.title || "",
        sourceKind: "reference", sourceType: metadata.metadataProvider || previous?.sourceType || "用户录入文献",
        keywords: fields.keywords || previous?.keywords || [], summary: "", literature: metadata,
        createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
      });
      if (!entry.title) throw new Error("请填写文献题名。");
      const doi = entry.literature.doi;
      if (doi && literatureEntries().some(item => item.id !== entry.id && item.literature?.doi === doi)) {
        throw new Error("本地文献库已存在相同 DOI，请编辑现有记录，避免重复保存。");
      }
      const knowledgeEntries = previous ? entries().map(item => item.id === entry.id ? entry : item) : [entry, ...entries()];
      await save(nextState({ knowledgeEntries }));
      draft = {};
      pendingLookup = null;
      appliedLookup = null;
      render();
      notify("文献已保存在本机；题录核验和阅读状态仍按表单记录。 ");
      return entry;
    }

    async function updateStatus(id, field, value) {
      const allowed = field === "metadataStatus" ? Object.keys(METADATA_LABELS)
        : field === "readingStatus" ? Object.keys(READING_LABELS) : [];
      if (!allowed.includes(value)) throw new Error("文献状态值无效。");
      const target = literatureEntries().find(entry => entry.id === id);
      if (!target) throw new Error("找不到该文献。");
      const updated = schema.normalizeKnowledgeEntry({ ...target, updatedAt: new Date().toISOString(), literature: { ...target.literature, [field]: value } });
      await save(nextState({ knowledgeEntries: entries().map(entry => entry.id === id ? updated : entry) }));
      render();
      return updated;
    }

    async function updateClaimRelation(id, claim, relation, location, rationale) {
      const target = literatureEntries().find(entry => entry.id === id);
      if (!target) throw new Error("找不到该文献。");
      const relations = schema.normalizeLiteratureMetadata({
        ...target.literature,
        claimRelations: [...(target.literature.claimRelations || []), { claim, relation, location, rationale }]
      }).claimRelations;
      if (relations.length === (target.literature.claimRelations || []).length) throw new Error("论断关系必须填写论断、原文位置和你记录的依据。");
      const updated = schema.normalizeKnowledgeEntry({ ...target, updatedAt: new Date().toISOString(), literature: { ...target.literature, claimRelations: relations } });
      await save(nextState({ knowledgeEntries: entries().map(entry => entry.id === id ? updated : entry) }));
      render();
      return updated;
    }

    function search(query) {
      searchQuery = String(query || "");
      return filteredEntries();
    }

    async function selectForWriting(id, selected) {
      const available = new Set(entries().filter(entry => !entry.hiddenAt).map(entry => entry.id));
      if (!available.has(id)) throw new Error("该文献不可选用。");
      const previousSelection = [...new Set(selectedIds())];
      let selection = [...previousSelection];
      if (selected && !selection.includes(id)) {
        if (selection.length >= 5) { render(); notify("当前资料选择已达五条上限，请先取消一项。"); return false; }
        selection.push(id);
      } else if (!selected) selection = selection.filter(item => item !== id);
      const selectionChanged = selection.length !== previousSelection.length || selection.some((item, index) => item !== previousSelection[index]);
      try {
        await save(nextState({ knowledgeSelection: selection }));
      } catch (error) {
        render();
        throw error;
      }
      if (selectionChanged) previewPrompt = "";
      render();
      return true;
    }

    function generateReadingPrompt(ids = selectedIds()) {
      const prompt = literature.buildReadingPrompt(entries(), ids.filter(id => literatureEntries().some(item => item.id === id)));
      previewPrompt = prompt;
      render();
      return prompt;
    }

    function exportRis() {
      const value = literature.exportLiteratureRis(literatureEntries());
      if (!value) throw new Error("当前没有可导出的文献题录。");
      if (typeof download === "function") download(value, "literature.ris", "application/x-research-info-systems");
      else if (typeof Blob !== "undefined" && typeof document !== "undefined" && URL?.createObjectURL) {
        const url = URL.createObjectURL(new Blob([value], { type: "application/x-research-info-systems;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "literature.ris";
        link.click();
        URL.revokeObjectURL(url);
      }
      return value;
    }

    async function handleClick(event) {
      const target = event.target?.closest?.("[data-lit-action], [data-lit-select], [data-lit-edit]");
      if (!target) return;
      const action = target.dataset.litAction;
      if (target.dataset.litSelect) return selectForWriting(target.dataset.litSelect, target.checked);
      if (target.dataset.litEdit) return editLiterature(target.dataset.litEdit);
      if (action === "preview-import") return previewImport(root.querySelector("[data-lit-import-text]")?.value, root.querySelector("[data-lit-import-format]")?.value);
      if (action === "commit-import") return commitImport([...root.querySelectorAll("[data-lit-import-id]:checked")].map(item => item.dataset.litImportId));
      if (action === "lookup") {
        const doi = root.querySelector("[data-lit-doi]")?.value.trim();
        const pmid = root.querySelector("[data-lit-pmid]")?.value.trim();
        if (Boolean(doi) === Boolean(pmid)) { notify("每次只填写 DOI 或 PMID 中的一项。"); return; }
        return lookup(doi ? "doi" : "pmid", doi || pmid);
      }
      if (action === "apply-lookup") return applyLookupMetadata();
      if (action === "build-prompt") return generateReadingPrompt();
      if (action === "copy-prompt") return clipboard(previewPrompt || generateReadingPrompt());
      if (action === "export-ris") return exportRis();
      if (action === "new-entry") { draft = {}; appliedLookup = null; pendingLookup = null; return render(); }
      if (action === "save-claim") {
        const id = target.dataset.litId;
        const card = target.closest(".academic-literature-card");
        const get = selector => card?.querySelector(selector)?.value || "";
        return updateClaimRelation(id, get(`[data-lit-claim="${id}"]`), get(`[data-lit-entry="${id}"][data-lit-field="claimRelation"]`), get(`[data-lit-location="${id}"]`), get(`[data-lit-rationale="${id}"]`));
      }
    }

    root.addEventListener("click", event => { Promise.resolve().then(() => handleClick(event)).catch(error => notify(error.message)); });
    root.addEventListener("change", event => {
      const target = event.target;
      if (target?.matches?.("[data-lit-external-scope]")) { externalScopeConfirmed = target.checked; return; }
      if (target?.matches?.("[data-lit-entry][data-lit-field]")) {
        const field = target.dataset.litField;
        if (field !== "claimRelation") updateStatus(target.dataset.litEntry, field, target.value).catch(error => { render(); notify(error.message); });
        return;
      }
      if (target?.matches?.("[data-lit-file]")) {
        const file = target.files?.[0];
        if (!file) return;
        const extension = file.name.toLowerCase().split(".").pop();
        importFormat = extension === "bib" || extension === "bibtex" ? "bibtex" : "ris";
        file.text().then(text => { importText = text; importPreview = null; render(); }).catch(error => notify(`读取文件失败：${error.message}`));
      }
    });
    root.addEventListener("input", event => {
      const target = event.target;
      if (target?.matches?.("[data-lit-search]")) { searchQuery = target.value; renderEntryList(); return; }
      if (target?.matches?.("[data-lit-import-text]")) { importText = target.value; return; }
      if (target?.matches?.("[data-lit-doi]")) { lookupDoi = target.value; return; }
      if (target?.matches?.("[data-lit-pmid]")) { lookupPmid = target.value; return; }
      if (target?.matches?.("[data-lit-draft]")) {
        const field = target.dataset.litDraft;
        draft = { ...draft, literature: { ...(draft.literature || {}), [field]: field === "authors" ? splitAuthors(target.value) : target.value }, ...(field === "title" ? { title: target.value } : {}) };
      }
    });
    root.addEventListener("submit", event => {
      if (!event.target?.matches?.("[data-lit-form]")) return;
      event.preventDefault();
      const formFields = {};
      for (const input of root.querySelectorAll("[data-lit-draft]")) {
        const key = input.dataset.litDraft;
        if (key === "title") formFields.title = input.value;
        else formFields.literature = { ...(formFields.literature || {}), [key]: key === "authors" ? splitAuthors(input.value) : input.value };
      }
      formFields.id = draft.id;
      saveManual(formFields).catch(error => notify(error.message));
    });

    render();
    return {
      render, previewImport, commitImport, lookup, setExternalScopeConfirmed, applyLookupMetadata, getDraft,
      editLiterature, saveManual, updateStatus, updateClaimRelation, search, selectForWriting,
      generateReadingPrompt, exportRis, replaceSaveState(nextSaveState) { saveStateImpl = nextSaveState; }
    };
  }

  return { createAcademicLiteratureUI };
});
