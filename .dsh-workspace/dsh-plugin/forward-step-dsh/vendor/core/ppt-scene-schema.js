(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPptSceneSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const PPT_ROUTES = Object.freeze([
    "undecided", "native-ppt", "image-rebuild", "html-final", "html-to-ppt"
  ]);
  const MATERIAL_ROLES = new Set(["content", "style", "both"]);
  const SCENE_STAGES = new Set(["brief", "materials", "outline", "outline-review", "slides", "route-prompt", "visual-feedback"]);
  const EVIDENCE_STATUSES = new Set(["cited", "needs-verification", "inference"]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function text(value, field, limit = 500) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new TypeError(`${field}必须是文本`);
    return value.trim().slice(0, limit);
  }

  function textList(value, field, limit = 30) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new TypeError(`${field}必须是列表`);
    return value.slice(0, limit).map((item, index) => text(item, `${field}[${index}]`)).filter(Boolean);
  }

  function sourceIdList(value, field, limit) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new TypeError(`${field}必须是列表`);
    const ids = value.slice(0, limit).map((item, index) => text(item, `${field}[${index}]`, 120));
    if (ids.some(id => !id)) throw new TypeError(`${field}不能包含空来源 ID`);
    return [...new Set(ids)];
  }

  function positiveSafeInteger(value, field) {
    const number = typeof value === "boolean" ? NaN : Number(value);
    if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${field}必须是正安全整数`);
    return number;
  }

  function normalizeConstraints(input) {
    if (input !== undefined && !isObject(input)) throw new TypeError("约束必须是对象");
    const source = input || {};
    const constraints = {};
    for (const field of ["minSlides", "maxSlides", "maxWordsPerSlide"]) {
      if (source[field] === undefined || source[field] === null || source[field] === "") continue;
      constraints[field] = positiveSafeInteger(source[field], field);
    }
    if (constraints.minSlides !== undefined && constraints.maxSlides !== undefined
      && constraints.minSlides > constraints.maxSlides) {
      throw new TypeError("页数下限不能大于页数上限");
    }
    return {
      minSlides: constraints.minSlides ?? null,
      maxSlides: constraints.maxSlides ?? null,
      maxWordsPerSlide: constraints.maxWordsPerSlide ?? null
    };
  }

  function normalizeMaterials(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new TypeError("材料必须是列表");
    return value.slice(0, 30).map((item, index) => {
      if (!isObject(item)) throw new TypeError(`材料[${index}]必须是对象`);
      const role = item.role ?? "content";
      if (!MATERIAL_ROLES.has(role)) throw new TypeError(`材料用途无效：${role}`);
      return {
        id: text(item.id, `材料[${index}].id`, 120),
        role,
        kind: text(item.kind, `材料[${index}].kind`, 60)
      };
    });
  }

  function normalizeRoute(value) {
    const route = value ?? "undecided";
    if (!PPT_ROUTES.includes(route)) throw new TypeError(`路线无效：${route}`);
    return route;
  }

  function createPptBrief(input = {}) {
    if (!isObject(input)) throw new TypeError("PPT 简报必须是对象");
    let durationMinutes = null;
    if (input.durationMinutes !== undefined && input.durationMinutes !== null && input.durationMinutes !== "") {
      if (typeof input.durationMinutes === "boolean") throw new TypeError("时长必须是有效分钟数");
      durationMinutes = Number(input.durationMinutes);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > Number.MAX_SAFE_INTEGER) {
        throw new TypeError("时长必须是有效分钟数且不超过安全范围");
      }
    }
    return {
      idea: text(input.idea, "目标"),
      audience: text(input.audience, "受众"),
      audienceAction: text(input.audienceAction, "听众行动"),
      durationMinutes,
      constraints: normalizeConstraints(input.constraints),
      hardRequirements: textList(input.hardRequirements, "硬性要求"),
      preferences: textList(input.preferences, "偏好"),
      preserveItems: textList(input.preserveItems, "保留项"),
      excludeItems: textList(input.excludeItems, "排除项"),
      facts: textList(input.facts, "事实"),
      assumptions: textList(input.assumptions, "假设"),
      sourceIds: sourceIdList(input.sourceIds, "来源 ID", 50),
      materials: normalizeMaterials(input.materials),
      route: normalizeRoute(input.route)
    };
  }

  function normalizeSlideStyle(input, page) {
    if (input == null) return undefined;
    if (!isObject(input)) throw new TypeError(`第 ${page} 页样式必须是对象`);
    const color = (value, field) => {
      if (value === undefined || value === null || value === "") return undefined;
      if (typeof value !== "string" || !/^[0-9a-f]{6}$/iu.test(value)) throw new TypeError(`第 ${page} 页${field}颜色无效`);
      return value.toUpperCase();
    };
    const textStyle = (value, field) => {
      if (value == null) return {};
      if (!isObject(value)) throw new TypeError(`第 ${page} 页${field}样式无效`);
      const result = {};
      const textColor = color(value.color, field);
      if (textColor) result.color = textColor;
      if (value.fontSize !== undefined) { if (!Number.isSafeInteger(value.fontSize) || value.fontSize < 600 || value.fontSize > 7200) throw new TypeError(`第 ${page} 页${field}字号无效`); result.fontSize = value.fontSize; }
      if (value.fontFamily !== undefined) { if (typeof value.fontFamily !== "string" || !/^[\p{L}\p{N}_ -]{1,80}$/u.test(value.fontFamily)) throw new TypeError(`第 ${page} 页${field}字体名称无效`); result.fontFamily = value.fontFamily; }
      if (value.lineSpacingPct !== undefined) { if (!Number.isSafeInteger(value.lineSpacingPct) || value.lineSpacingPct < 50 || value.lineSpacingPct > 300) throw new TypeError(`第 ${page} 页${field}行距需为 50% 至 300%`); result.lineSpacingPct = value.lineSpacingPct; }
      if (value.textIndentEmu !== undefined) { if (!Number.isSafeInteger(value.textIndentEmu) || Math.abs(value.textIndentEmu) > 1828800) throw new TypeError("首行缩进无效"); result.textIndentEmu = value.textIndentEmu; }
      for (const property of ["leftMarginEmu", "rightMarginEmu"]) if (value[property] !== undefined) { if (!Number.isSafeInteger(value[property]) || value[property] < 0 || value[property] > 1828800) throw new TypeError("左右边距无效"); result[property] = value[property]; }
      for (const property of ["spaceBeforePt", "spaceAfterPt"]) if (value[property] !== undefined) { if (!Number.isSafeInteger(value[property]) || value[property] < 0 || value[property] > 14400) throw new TypeError("段落间距无效"); result[property] = value[property]; }
      if (value.align !== undefined) { if (!["left", "center", "right", "justify"].includes(value.align)) throw new TypeError(`第 ${page} 页${field}对齐方式无效`); result.align = value.align; }
      for (const property of ["bold", "italic", "underline", "strikethrough"]) if (value[property] !== undefined) { if (typeof value[property] !== "boolean") throw new TypeError(`第 ${page} 页${field}${property}无效`); if (value[property] || ["underline", "strikethrough"].includes(property)) result[property] = value[property]; }
      if (value.href !== undefined) { let url; try { url = new URL(value.href); } catch { throw new TypeError(`第 ${page} 页${field}超链接无效`); } if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new TypeError(`第 ${page} 页超链接仅支持 HTTP(S)`); url.hash = ""; result.href = url.toString(); }
      return result;
    };
    const backgroundColor = color(input.backgroundColor, "背景");
    const title = textStyle(input.title, "标题");
    const body = textStyle(input.body, "正文");
    return backgroundColor || Object.keys(title).length || Object.keys(body).length ? { ...(backgroundColor ? { backgroundColor } : {}), title, body } : undefined;
  }

  function normalizeSlide(input, index) {
    if (!isObject(input)) throw new TypeError(`第 ${index + 1} 页必须是对象`);
    const page = input.page === undefined ? index + 1 : positiveSafeInteger(input.page, `第 ${index + 1} 页的页码`);
    const bodyValue = input.body ?? input.content;
    const body = bodyValue === undefined || bodyValue === null
      ? []
      : Array.isArray(bodyValue) ? textList(bodyValue, `第 ${page} 页文案`, 30) : [text(bodyValue, `第 ${page} 页文案`)];
    const imageDataUrl = text(input.imageDataUrl, `第 ${page} 页配图`, 4194400);
    if (imageDataUrl.length > Math.ceil(3 * 1024 * 1024 / 3) * 4 + 64) throw new TypeError(`第 ${page} 页配图不能超过 3 MiB`);
    if (imageDataUrl && !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/u.test(imageDataUrl)) throw new TypeError(`第 ${page} 页配图必须为 PNG/JPEG 数据`);
    const imageDataUrls = (input.imageDataUrls ?? []).map((value, imageIndex) => {
      const image = text(value, `image ${imageIndex + 1}`, 4194400);
      if (image.length > Math.ceil(3 * 1024 * 1024 / 3) * 4 + 64 || !(image.startsWith("data:" + "image/png;base64,") || image.startsWith("data:" + "image/jpeg;base64,"))) throw new TypeError("PPT image must be PNG/JPEG and no larger than 3 MiB");
      return image;
    });
    if (imageDataUrls.reduce((total, image) => total + image.length, imageDataUrl.length) > Math.ceil(20 * 1024 * 1024 / 3) * 4 + 256) throw new TypeError("PPT page images exceed 20 MiB");
    const chart = input.chart == null ? undefined : (() => {
      if (!isObject(input.chart) || !Array.isArray(input.chart.categories)) throw new TypeError(`第 ${page} 页图表无效`);
      const categories = input.chart.categories.map((value, item) => text(value, `类别 ${item + 1}`, 40));
      const seriesInput = input.chart.series ?? (Array.isArray(input.chart.values) ? [{ name: "数值", values: input.chart.values }] : []);
      if (!categories.length || categories.length > 8 || !seriesInput.length || seriesInput.length > 4) throw new TypeError(`第 ${page} 页图表超限`);
      const names = new Set();
      const series = seriesInput.map((item, itemIndex) => { const name = text(item?.name, `系列 ${itemIndex + 1}`, 40) || `系列 ${itemIndex + 1}`; if (names.has(name) || !Array.isArray(item?.values) || item.values.length !== categories.length) throw new TypeError("图表数据长度或名称无效"); names.add(name); return { name, values: item.values.map(value => { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1000000000) throw new TypeError("图表数值必须是有限数字且不为负数"); return value; }) }; });
      return { title: text(input.chart.title, "图表标题", 80) || "数据图表", categories, series };
    })();
    const table = input.table == null ? undefined : (() => {
      if (!isObject(input.table) || !Array.isArray(input.table.rows) || input.table.rows.length < 1 || input.table.rows.length > 20) throw new TypeError(`第 ${page} 页表格需要 1 至 20 行`);
      const rows = input.table.rows.map((row, rowIndex) => { if (!Array.isArray(row) || row.length < 1 || row.length > 8) throw new TypeError(`第 ${page} 页表格第 ${rowIndex + 1} 行列数无效`); return row.map((cell, columnIndex) => { const label = `第 ${page} 页表格第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`; if (typeof cell === "string") return text(cell, label, 1000); if (!isObject(cell)) throw new TypeError(`${label}无效`); if (cell.fillColor !== undefined && (typeof cell.fillColor !== "string" || !/^[0-9a-f]{6}$/iu.test(cell.fillColor))) throw new TypeError("填充颜色无效"); if (cell.color !== undefined && (typeof cell.color !== "string" || !/^[0-9a-f]{6}$/iu.test(cell.color))) throw new TypeError("文字颜色无效"); const cellColor = cell.color?.toUpperCase(); const fillColor = cell.fillColor?.toUpperCase(); if (cell.bold !== undefined && typeof cell.bold !== "boolean") throw new TypeError(`${label}粗体无效`); return { text: text(cell.text, label, 1000), ...(cell.bold ? { bold: true } : {}), ...(cellColor ? { color: cellColor } : {}), ...(fillColor ? { fillColor } : {}) }; }); });
      if (new Set(rows.map(row => row.length)).size !== 1) throw new TypeError(`第 ${page} 页表格每行列数必须一致`); return { rows };
    })();
    const style = normalizeSlideStyle(input.style, page);
    const paragraphStyles = Array.isArray(input.paragraphStyles) ? input.paragraphStyles.slice(0, 100).map(value => normalizeSlideStyle({ body: value }, page)?.body ?? {}) : [];
    const paragraphRuns = Array.isArray(input.paragraphRuns) ? input.paragraphRuns.slice(0, 100).map(paragraph => { if (!Array.isArray(paragraph)) throw new TypeError("文本片段必须是列表"); return paragraph.slice(0, 200).map(run => { if (!isObject(run) || typeof run.text !== "string" || run.text.length > 20000) throw new TypeError("文本片段无效"); return { text: run.text, style: normalizeSlideStyle({ body: run.style ?? {} }, page)?.body ?? {} }; }); }) : [];
    return {
      id: text(input.id, `第 ${page} 页 ID`, 120),
      page,
      title: text(input.title, `第 ${page} 页标题`, 200),
      purpose: text(input.purpose, `第 ${page} 页职责`),
      claim: text(input.claim, `第 ${page} 页主张`),
      transition: text(input.transition, `第 ${page} 页承接`),
      body,
      ...(imageDataUrl ? { imageDataUrl } : {}), ...(imageDataUrls.length ? { imageDataUrls } : {}), ...(input.sourceImageName ? { sourceImageName: text(input.sourceImageName, `第 ${page} 页原始图像文件名`, 240).replaceAll(String.fromCharCode(10), " ").replaceAll(String.fromCharCode(13), " ").replaceAll(String.fromCharCode(9), " ") } : {}), ...(input.sourceDocumentName ? { sourceDocumentName: text(input.sourceDocumentName, `第 ${page} 页来源演示文件名`, 240).replaceAll(String.fromCharCode(10), " ").replaceAll(String.fromCharCode(13), " ").replaceAll(String.fromCharCode(9), " ") } : {}), chart, table, style, paragraphStyles, paragraphRuns,
      visualDescription: text(input.visualDescription, `第 ${page} 页视觉说明`),
      modelVisualDescription: text(input.modelVisualDescription, `第 ${page} 页模型视觉理解`),
      speakerNotes: text(input.speakerNotes, `第 ${page} 页演讲备注`, 2000),
      sourceIds: sourceIdList(input.sourceIds, `第 ${page} 页来源 ID`, 30),
      suggestedSourceIds: sourceIdList(input.suggestedSourceIds, `第 ${page} 页建议来源 ID`, 30),
      evidenceStatus: EVIDENCE_STATUSES.has(input.evidenceStatus) ? input.evidenceStatus : "needs-verification",
      disposition: ["keep", "edit", "deleted"].includes(input.disposition) ? input.disposition : "keep",
      deleteReason: text(input.deleteReason, `第 ${page} 页删除原因`, 500)
    };
  }

  function normalizePptDraft(input = {}) {
    if (!isObject(input)) throw new TypeError("PPT 草稿必须是对象");
    if (input.slides !== undefined && !Array.isArray(input.slides)) throw new TypeError("草稿页必须是列表");
    return {
      title: text(input.title, "草稿标题", 200),
      slides: (input.slides || []).slice(0, 100).map(normalizeSlide)
    };
  }

  function imageFingerprint(value) {
    if (typeof value !== "string" || !value) return "";
    let first = 2166136261;
    let second = 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ (code + index), 2246822519);
    }
    return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
  }

  function pptSlideSnapshot(slide) {
    const source = isObject(slide) ? slide : {};
    const body = Array.isArray(source.body) ? source.body.join("\n") : source.body;
    return JSON.stringify({ title: String(source.title ?? ""), content: String(source.content ?? body ?? ""), visualDescription: String(source.visualDescription ?? ""), ...(String(source.modelVisualDescription ?? "") ? { modelVisualDescription: String(source.modelVisualDescription) } : {}), table: source.table ?? null, chart: source.chart ?? null, imageFingerprint: imageFingerprint([source.imageDataUrl, ...(source.imageDataUrls ?? [])].join("\n")) });
  }

  function normalizeVisualFeedback(value, slides) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new TypeError("视觉反馈必须是列表");
    return value.slice(0, 200).filter(isObject).map((item, index) => {
      const pageIndex = Number(item.pageIndex);
      if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new TypeError(`视觉反馈[${index}]页码无效`);
      const slide = slides[pageIndex];
      let target;
      if (item.target !== undefined && item.target !== null) {
        if (!isObject(item.target) || item.target.kind !== "point" || !Number.isFinite(item.target.x) || !Number.isFinite(item.target.y) || item.target.x < 0 || item.target.x > 1 || item.target.y < 0 || item.target.y > 1) throw new TypeError("视觉反馈坐标无效");
        const imageIndex = item.target.imageIndex;
        const imageCount = slide ? [slide.imageDataUrl, ...(slide.imageDataUrls ?? [])].filter(Boolean).length : 0;
        if (imageIndex !== undefined && (!Number.isSafeInteger(imageIndex) || imageIndex < 0 || imageIndex >= imageCount)) throw new TypeError("视觉反馈图像索引无效");
        target = { kind: "point", x: Math.round(item.target.x * 1000) / 1000, y: Math.round(item.target.y * 1000) / 1000, ...(imageIndex === undefined ? {} : { imageIndex }) };
      }
      return {
        id: text(item.id, `视觉反馈[${index}].id`, 120), pageIndex, ...(target ? { target } : {}),
        category: ["content", "logic", "evidence", "style", "layout", "readability", "other"].includes(item.category) ? item.category : "other",
        comment: text(item.comment, `视觉反馈[${index}].comment`, 2000),
        contentSnapshot: text(item.contentSnapshot, `视觉反馈[${index}].contentSnapshot`, 10000),
        selected: item.selected !== false, createdAt: text(item.createdAt, `视觉反馈[${index}].createdAt`, 80),
        stale: !slide || pptSlideSnapshot(slide) !== item.contentSnapshot
      };
    });
  }

  function normalizePptScene(input = {}) {
    if (!isObject(input)) throw new TypeError("PPT 场景必须是对象");
    const source = isObject(input.pptScene) ? input.pptScene : isObject(input.methodState?.ppt) ? input.methodState.ppt : input;
    if (source.stage !== undefined && !SCENE_STAGES.has(source.stage)) throw new TypeError(`阶段无效：${source.stage}`);
    const routeInput = isObject(source.route) ? source.route : typeof source.route === "string" ? { selected: source.route } : {};
    if (routeInput.selected !== undefined) normalizeRoute(routeInput.selected);
    if (routeInput.recommended !== undefined) normalizeRoute(routeInput.recommended);
    const sources = Array.isArray(input.sources) ? input.sources.slice(0, 50).filter(isObject).map((source, index) => ({
      id: text(source.id, `来源[${index}].id`, 120),
      title: text(source.title, `来源[${index}].title`, 200),
      url: text(source.url, `来源[${index}].url`, 1000),
      summary: text(source.summary, `来源[${index}].summary`, 1200),
      date: text(source.date, `来源[${index}].date`, 80),
      verificationStatus: text(source.verificationStatus, `来源[${index}].verificationStatus`, 80)
    })) : [];
    const outlineInput = isObject(source.outline) ? source.outline : {};
    const outlineSlides = Array.isArray(outlineInput.slides) ? outlineInput.slides.slice(0, 100).map(normalizeSlide) : [];
    const visualFeedback = normalizeVisualFeedback(source.visualFeedback, outlineSlides);
    return {
      brief: createPptBrief(source.brief),
      status: ["draft", "needs-review", "ready", "error"].includes(source.status) ? source.status : "draft",
      stage: source.stage || "brief",
      outlineStatus: ["draft", "needs-review", "approved"].includes(source.outlineStatus) ? source.outlineStatus : "draft",
      route: {
        selected: normalizeRoute(routeInput.selected),
        recommended: normalizeRoute(routeInput.recommended)
      },
      visualFeedback,
      sources,
      outline: {
        title: text(outlineInput.title, "大纲标题", 200),
        storyLine: text(outlineInput.storyLine, "故事线", 2000),
        rationale: text(outlineInput.rationale, "页数估算理由", 2000),
        reviewSummary: text(outlineInput.reviewSummary, "大纲核对总结", 1200),
        reviewIssues: textList(outlineInput.reviewIssues, "大纲问题", 30),
        slides: outlineSlides
      },
      draft: normalizePptDraft(source.draft)
    };
  }

  return { PPT_ROUTES, createPptBrief, normalizePptDraft, normalizePptScene, pptSlideSnapshot };
});
