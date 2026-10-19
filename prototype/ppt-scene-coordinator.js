(function (root, factory) {
  const schema = typeof module === "object" && module.exports ? require("./ppt-scene-schema.js") : root.ForwardStepPptSceneSchema;
  const workflow = typeof module === "object" && module.exports ? require("./ppt-scene-workflow.js") : root.ForwardStepPptSceneWorkflow;
  const prompts = typeof module === "object" && module.exports ? require("./ppt-scene-prompts.js") : root.ForwardStepPptScenePrompts;
  const api = factory(schema, workflow, prompts);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPptSceneCoordinator = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (schema, workflow, prompts) {
  const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};

  function createPptSceneCoordinator({ promptAgentCoordinator, retriever, researchBridge, requestModel } = {}) {
    if (typeof requestModel !== "function") throw new TypeError("PPT 规划需要模型请求函数");
    const approvedResearch = new Set();
    const parse = value => {
      if (value && typeof value === "object") return typeof value.text === "string" ? parse(value.text) : value;
      const text = String(value || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
      if (!text) throw new Error("模型没有返回内容");
      return JSON.parse(text);
    };
    const sceneOf = task => schema.normalizePptScene(task?.pptScene || {});
    const withScene = (task, scene) => ({ ...task, pptScene: schema.normalizePptScene(scene) });
    const sourceIdFromUrl = value => {
      try {
        const url = new URL(String(value || ""));
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        const path = url.pathname.replace(/\/+$/, "") || "/";
        return `web:${url.host.toLowerCase()}${path}`.slice(0, 120);
      } catch { return ""; }
    };
    const callModel = async (task, stage, prompt) => {
      try { return { value: parse(await requestModel({ stage, prompt, task })) }; }
      catch (error) { return { error: { code: "model_failure", message: error?.message || "模型请求失败" } }; }
    };
    const fail = (task, error) => ({ task, error });
    const save = (task, patch) => withScene(task, { ...sceneOf(task), ...patch });

    function createTask(input = {}) {
      const base = { id: input.id || `ppt-${Date.now()}`, goal: String(input.goal || "").trim(), type: "advance-idea", stage: "planning" };
      return withScene(base, { ...object(input.pptScene), brief: { ...object(input.pptScene?.brief), idea: input.pptScene?.brief?.idea || input.goal || "" } });
    }

    async function generateBrief(task) {
      const scene = sceneOf(task);
      const result = await callModel(task, "brief", prompts.buildPptBriefPrompt({ ...task, pptScene: scene }));
      if (result.error) return fail(task, result.error);
      try {
        const brief = schema.createPptBrief({ ...scene.brief, ...object(result.value.brief || result.value), idea: result.value.idea || scene.brief.idea || task.goal });
        return { task: save(task, { brief, stage: "materials", status: "needs-review" }) };
      } catch (error) { return fail(task, { code: "invalid_model_output", message: error.message }); }
    }

    async function gatherMaterials(task) {
      const scene = sceneOf(task);
      let materials = [];
      try {
        materials = await promptAgentCoordinator?.selectMaterials?.({ ...task, goal: scene.brief.idea, target: scene.brief.audience }, { stage: "planning" }) || [];
      } catch (error) { return fail(task, { code: "materials_failure", message: error.message || "本地资料筛选失败" }); }
      const sources = materials.map(item => ({
        id: String(item.id || "").slice(0, 120), title: String(item.title || item.name || "本地资料").slice(0, 200),
        url: String(item.url || item.location || "").slice(0, 1000), summary: String(item.summary || item.excerpt || "").slice(0, 1200),
        verificationStatus: item.verificationStatus || "unverified"
      })).filter(item => item.id);
      return { task: save(task, { sources, brief: { ...scene.brief, sourceIds: sources.map(item => item.id) }, stage: "outline", status: "needs-review" }) };
    }

    const previewResearch = (task, scope) => {
      const bridge = researchBridge || promptAgentCoordinator;
      const preview = bridge?.preview?.(scope) || bridge?.previewExternalResearch?.(scope);
      if (!preview) throw new Error("确认式研究桥接器不可用");
      return preview;
    };
    const approveResearch = (task, id, confirmation = "确认本次研究") => {
      const bridge = researchBridge || promptAgentCoordinator;
      const result = bridge?.approve?.(id, confirmation) || bridge?.approveExternalResearch?.(id, confirmation);
      if (result) approvedResearch.add(id);
      return result;
    };
    async function runResearch(task, id) {
      if (!approvedResearch.has(id)) throw new Error("研究计划必须先经用户确认");
      const bridge = researchBridge || promptAgentCoordinator;
      try {
        const result = bridge?.execute ? await bridge.execute(id) : await bridge?.runExternalResearch?.(id);
        if (!result || result.status !== "complete") return fail(task, { code: "research_incomplete", message: "研究未完成，现有草稿已保留" });
        const scene = sceneOf(task);
        const sources = [...scene.sources, ...(result.results || []).map(item => ({
          id: sourceIdFromUrl(item.url || item.link), title: item.title, url: item.url || item.link,
          summary: item.summary || item.snippet || "", date: item.date || "", verificationStatus: "unverified"
        })).filter(source => source.id)];
        return { task: save(task, { sources, brief: { ...scene.brief, sourceIds: sources.map(item => item.id) } }) };
      } catch (error) { throw error; }
    }

    async function sourceMatches(task, query) {
      if (!retriever?.searchPromptAgentMaterials) return [];
      try { return await retriever.searchPromptAgentMaterials(sceneOf(task).sources, query) || []; }
      catch { return []; }
    }
    async function generateOutline(task) {
      const scene = sceneOf(task);
      const result = await callModel(task, "outline", prompts.buildPptOutlinePrompt({ ...task, pptScene: scene }, scene.sources));
      if (result.error) return fail(task, result.error);
      try {
        const model = object(result.value.outline || result.value);
        const slides = Array.isArray(model.slides) ? await Promise.all(model.slides.map(async slide => {
          const matches = await sourceMatches(task, slide.claim || slide.title);
          const available = new Set(scene.sources.map(source => source.id));
          const sourceIds = (slide.sourceIds || []).filter(id => available.has(id));
          const hasEvidence = sourceIds.length > 0;
          const citedByOutline = scene.outline.slides.flatMap(item => item.sourceIds || []).filter(id => available.has(id));
          const webSourceIds = scene.sources.filter(source => String(source.id).startsWith("web:")).map(source => source.id);
          const suggestedSourceIds = hasEvidence ? [] : [...new Set(citedByOutline.length ? citedByOutline : webSourceIds.length ? webSourceIds : matches.map(item => item.id))].filter(id => available.has(id));
          return { ...slide, sourceIds, evidenceStatus: hasEvidence ? "cited" : "needs-verification", suggestedSourceIds };
        })) : [];
        const outline = { ...model, status: "needs-review", slides };
        return { task: save(task, { outline, outlineStatus: "needs-review", stage: "outline-review", status: "needs-review" }) };
      } catch (error) { return fail(task, { code: "invalid_model_output", message: error.message }); }
    }
    async function reviewOutline(task) {
      const scene = sceneOf(task);
      const prompt = `核对以下 PPT 大纲的逻辑、覆盖与证据缺口，只返回 JSON：{"summary":"...","issues":["..."]}。大纲：${JSON.stringify(scene.outline)}`;
      const result = await callModel(task, "outline-review", prompt);
      if (result.error) return fail(task, result.error);
      const data = object(result.value);
      return { task: save(task, { outline: { ...scene.outline, reviewSummary: data.summary || "", reviewIssues: data.issues || [] }, outlineStatus: "needs-review" }) };
    }
    function approveOutline(task) {
      const scene = sceneOf(task);
      if (!scene.outline.slides.length) throw new Error("请先生成大纲，再确认");
      return save(task, { outlineStatus: "approved", outline: { ...scene.outline, status: "approved" }, stage: "slides", status: "ready" });
    }
    async function generateSlides(task) {
      const scene = sceneOf(task);
      const result = await callModel(task, "slides", prompts.buildPptSlideDraftPrompt({ ...task, pptScene: scene }, { ...scene.outline, status: scene.outlineStatus }, scene.sources));
      if (result.error) return fail(task, result.error);
      try {
        const raw = object(result.value.draft || result.value);
        const outlineByPage = new Map(scene.outline.slides.map(slide => [slide.page, slide]));
        const drafts = schema.normalizePptDraft(raw);
        const slides = drafts.slides.map(slide => {
          const available = new Set(scene.sources.map(source => source.id));
          const sourceIds = slide.sourceIds.filter(id => available.has(id));
          return { ...slide, sourceIds, evidenceStatus: sourceIds.length ? "cited" : "needs-verification", suggestedSourceIds: sourceIds.length ? [] : outlineByPage.get(slide.page)?.sourceIds || [] };
        });
        return { task: save(task, { draft: { ...drafts, slides }, stage: "route-prompt", status: "needs-review" }) };
      } catch (error) { return fail(task, { code: "invalid_model_output", message: error.message }); }
    }
    function chooseRoute(task, route) {
      if (!schema.PPT_ROUTES.includes(route) || route === "undecided") throw new TypeError("请选择有效制作路线");
      const scene = sceneOf(task);
      return save(task, { route: { ...scene.route, selected: route }, brief: { ...scene.brief, route }, stage: "route-prompt" });
    }
    function setSlideDisposition(task, id, disposition, reason = "") {
      if (!["keep", "edit", "deleted"].includes(disposition)) throw new TypeError("页面处理方式无效");
      if (disposition === "deleted" && !String(reason).trim()) throw new TypeError("删除页面必须填写原因");
      const scene = sceneOf(task);
      const slides = scene.draft.slides.map(slide => slide.id === id ? { ...slide, disposition, deleteReason: disposition === "deleted" ? String(reason).trim() : "" } : slide);
      return save(task, { draft: { ...scene.draft, slides } });
    }
    function editSlide(task, id, patch) {
      const scene = sceneOf(task);
      const allowed = ["title", "purpose", "body", "visualDescription", "speakerNotes"];
      const safePatch = Object.fromEntries(Object.entries(object(patch)).filter(([key]) => allowed.includes(key)));
      return save(task, { draft: { ...scene.draft, slides: scene.draft.slides.map(slide => slide.id === id ? { ...slide, ...safePatch, disposition: "edit" } : slide) } });
    }
    function getStagePrompt(task, stage = sceneOf(task).stage) {
      const scene = sceneOf(task);
      if (stage === "brief") return prompts.buildPptBriefPrompt({ ...task, pptScene: scene });
      if (stage === "outline" || stage === "outline-review") return prompts.buildPptOutlinePrompt({ ...task, pptScene: scene }, scene.sources);
      if (stage === "slides") return prompts.buildPptSlideDraftPrompt({ ...task, pptScene: scene }, scene.outline, scene.sources);
      if (stage === "route-prompt") {
        const activeSlides = scene.draft.slides.filter(slide => slide.disposition !== "deleted");
        const pages = activeSlides.length ? `\n\n【保留及待修改页面】\n${JSON.stringify(activeSlides.map(slide => ({ page: slide.page, title: slide.title, purpose: slide.purpose, body: slide.body, visualDescription: slide.visualDescription, sourceIds: slide.sourceIds, evidenceStatus: slide.evidenceStatus })), null, 2)}` : "";
        return prompts.buildPptProductionPrompt({ ...task, pptScene: scene }, scene.route.selected) + pages;
      }
      return "请先完成当前 PPT 规划阶段。";
    }
    return { createTask, generateBrief, gatherMaterials, previewResearch, approveResearch, runResearch, generateOutline, reviewOutline, approveOutline, generateSlides, chooseRoute, setSlideDisposition, editSlide, getStagePrompt };
  }
  return { createPptSceneCoordinator };
});
