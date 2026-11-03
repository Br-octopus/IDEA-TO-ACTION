(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPptSceneSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const PPT_ROUTES = Object.freeze([
    "undecided", "native-ppt", "image-rebuild", "html-final", "html-to-ppt"
  ]);
  const MATERIAL_ROLES = new Set(["content", "style", "both"]);
  const SCENE_STAGES = new Set(["brief", "materials", "outline", "outline-review", "slides", "route-prompt"]);
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

  function normalizeSlide(input, index) {
    if (!isObject(input)) throw new TypeError(`第 ${index + 1} 页必须是对象`);
    const page = input.page === undefined ? index + 1 : positiveSafeInteger(input.page, `第 ${index + 1} 页的页码`);
    const body = input.body === undefined || input.body === null
      ? []
      : Array.isArray(input.body) ? textList(input.body, `第 ${page} 页文案`, 30) : [text(input.body, `第 ${page} 页文案`)];
    return {
      id: text(input.id, `第 ${page} 页 ID`, 120),
      page,
      title: text(input.title, `第 ${page} 页标题`, 200),
      purpose: text(input.purpose, `第 ${page} 页职责`),
      claim: text(input.claim, `第 ${page} 页主张`),
      transition: text(input.transition, `第 ${page} 页承接`),
      body,
      visualDescription: text(input.visualDescription, `第 ${page} 页视觉说明`),
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

  function normalizePptScene(input = {}) {
    if (!isObject(input)) throw new TypeError("PPT 场景必须是对象");
    if (input.stage !== undefined && !SCENE_STAGES.has(input.stage)) throw new TypeError(`阶段无效：${input.stage}`);
    const routeInput = input.route && isObject(input.route) ? input.route : {};
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
    const outlineInput = isObject(input.outline) ? input.outline : {};
    const outlineSlides = Array.isArray(outlineInput.slides) ? outlineInput.slides.slice(0, 100).map(normalizeSlide) : [];
    return {
      brief: createPptBrief(input.brief),
      status: ["draft", "needs-review", "ready", "error"].includes(input.status) ? input.status : "draft",
      stage: input.stage || "brief",
      outlineStatus: ["draft", "needs-review", "approved"].includes(input.outlineStatus) ? input.outlineStatus : "draft",
      route: {
        selected: normalizeRoute(routeInput.selected),
        recommended: normalizeRoute(routeInput.recommended)
      },
      sources,
      outline: {
        title: text(outlineInput.title, "大纲标题", 200),
        storyLine: text(outlineInput.storyLine, "故事线", 2000),
        rationale: text(outlineInput.rationale, "页数估算理由", 2000),
        reviewSummary: text(outlineInput.reviewSummary, "大纲核对总结", 1200),
        reviewIssues: textList(outlineInput.reviewIssues, "大纲问题", 30),
        slides: outlineSlides
      },
      draft: normalizePptDraft(input.draft)
    };
  }

  return { PPT_ROUTES, createPptBrief, normalizePptDraft, normalizePptScene };
});
