(function (root, factory) {
  const workflow = typeof module === "object" && module.exports ? require("./ppt-scene-workflow.js") : root.ForwardStepPptSceneWorkflow;
  const api = factory(workflow);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPptSceneUI = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (workflow) {
  function createPptSceneUI({ document, coordinator, sceneSchema, taskSchema, getState, persistState, copyText, notify } = {}) {
    const root = document?.getElementById("ppt-scene-root");
    if (!root || !coordinator || typeof getState !== "function" || typeof persistState !== "function") throw new TypeError("PPT 工作台缺少必要依赖");
    const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    let taskId = "";
    let status = "";
    let bound = false;
    let pendingResearchId = "";
    taskId = (getState()?.promptAgentTasks || []).find(task => task.pptScene)?.id || "";
    const getTask = () => (getState()?.promptAgentTasks || []).find(task => task.id === taskId);
    function save(task) {
      const normalized = { ...taskSchema.normalizePromptAgentTask(task), pptScene: sceneSchema.normalizePptScene(task.pptScene) };
      const tasks = (getState()?.promptAgentTasks || []).map(item => item.id === taskId ? normalized : item);
      persistState({ ...getState(), promptAgentTasks: tasks });
      return normalized;
    }
    function show(message) { status = message || ""; if (notify && message) notify(message); }
    function list(items) { return items?.length ? `<ul>${items.map(item => `<li>${escape(item)}</li>`).join("")}</ul>` : "<p>未填写</p>"; }
    function render() {
      const task = getTask();
      if (!task) {
        root.innerHTML = `<section class="social-panel"><h2>PPT 规划工作台</h2><p>从一个想法开始，先梳理简报，再确认大纲并生成逐页草稿。</p><label class="field"><span class="field-label" for="ppt-idea">想法</span><textarea id="ppt-idea" placeholder="例如：向新员工说明客服分流流程"></textarea></label><button class="button-primary" type="button" data-ppt-action="start">创建 PPT 规划</button></section>`;
        bind(); return;
      }
      const scene = sceneSchema.normalizePptScene(task.pptScene || {});
      const estimate = workflow.estimateSlideCount({ durationMinutes: scene.brief.durationMinutes, userRange: scene.brief.constraints });
      const prompt = coordinator.getStagePrompt(task);
      root.innerHTML = `<section class="social-panel"><div class="block-top"><div><h2>PPT 规划工作台</h2><p>当前阶段：${escape(scene.stage)} · ${escape(status)}</p></div><button class="button-secondary" type="button" data-ppt-action="new">新建规划</button></div>
        <h3>演示简报</h3><div class="social-form-grid"><label class="field">目标<textarea data-brief="idea">${escape(scene.brief.idea)}</textarea></label><label class="field">受众<textarea data-brief="audience">${escape(scene.brief.audience)}</textarea></label><label class="field">受众行动<textarea data-brief="audienceAction">${escape(scene.brief.audienceAction)}</textarea></label><label class="field">待确认<textarea data-brief="assumptions">${escape(scene.brief.assumptions.join("\n"))}</textarea></label><label class="field">硬性要求<textarea data-brief="hardRequirements">${escape(scene.brief.hardRequirements.join("\n"))}</textarea></label><label class="field">偏好<textarea data-brief="preferences">${escape(scene.brief.preferences.join("\n"))}</textarea></label></div>
        <h3>硬性约束</h3><div class="social-form-grid"><label class="field">最少页数<input type="number" min="1" step="1" data-ppt-constraint="minSlides" value="${escape(scene.brief.constraints.minSlides ?? "")}"></label><label class="field">最多页数<input type="number" min="1" step="1" data-ppt-constraint="maxSlides" value="${escape(scene.brief.constraints.maxSlides ?? "")}"></label><label class="field">每页最多字数<input type="number" min="1" step="1" data-ppt-constraint="maxWordsPerSlide" value="${escape(scene.brief.constraints.maxWordsPerSlide ?? "")}"></label></div>
        <h3>简报核对</h3><div class="social-form-grid"><div class="field"><strong>已知事实</strong>${list(scene.brief.facts)}</div><div class="field"><strong>当前假设</strong>${list(scene.brief.assumptions)}</div><div class="field"><strong>待确认</strong>${list(scene.outline.reviewIssues)}</div></div>
        <div class="social-tools"><button class="button-secondary" data-ppt-action="save-brief">保存简报</button><button class="button-primary" data-ppt-action="generate-brief">生成简报草稿</button><button class="button-secondary" data-ppt-action="materials">筛选本地资料</button><button class="button-secondary" data-ppt-action="research-preview">预览联网研究</button>${pendingResearchId ? `<button class="button-secondary" data-ppt-action="research-approve">确认联网研究</button><button class="button-primary" data-ppt-action="research-run">运行已确认研究</button>` : ""}</div>
        <h3>资料与来源</h3>${scene.sources.length ? `<ul>${scene.sources.map(source => `<li><strong>${escape(source.title)}</strong> · ID ${escape(source.id)} · ${escape(source.summary)} ${escape(source.url)}</li>`).join("")}</ul>` : "<p>尚无来源；联网研究必须先预览并确认。</p>"}
        <h3>故事线与页数估算</h3><p>${escape(scene.outline.storyLine || "尚未生成大纲")}</p><p>推荐页数依据：${escape(scene.outline.rationale || `${estimate.range.min}-${estimate.range.max} 页。${estimate.assumptions.join(" ")}`)}</p>
        <div class="social-tools"><button class="button-primary" data-ppt-action="generate-outline">生成大纲草稿</button><button class="button-secondary" data-ppt-action="review-outline">核对大纲</button><button class="button-primary" data-ppt-action="approve-outline" ${scene.outline.slides.length ? "" : "disabled"}>确认大纲</button></div>
        ${scene.outline.slides.map(slide => `<article class="social-panel"><h4>大纲第 ${slide.page} 页：${escape(slide.title)}</h4><p>${escape(slide.purpose)} · ${escape(slide.claim)}</p><p>来源：${escape(slide.sourceIds.join(", ") || "无；待核实")}</p></article>`).join("")}
        <h3>逐页文稿</h3>${scene.draft.slides.map(slide => `<article class="social-panel"><h4>第 ${slide.page} 页：${escape(slide.title)}</h4><label class="field">页面标题<input data-slide-edit="title" data-slide-id="${escape(slide.id)}" value="${escape(slide.title)}"></label><label class="field">页面文案<textarea data-slide-edit="body" data-slide-id="${escape(slide.id)}">${escape(slide.body.join("\n"))}</textarea></label><label class="field">视觉说明<textarea data-slide-edit="visualDescription" data-slide-id="${escape(slide.id)}">${escape(slide.visualDescription)}</textarea></label><label class="field">演讲备注<textarea data-slide-edit="speakerNotes" data-slide-id="${escape(slide.id)}">${escape(slide.speakerNotes)}</textarea></label><p>来源：${escape(slide.sourceIds.join(", ") || "无；待核实")} · ${escape(slide.evidenceStatus)}</p><div class="social-tools"><button class="button-secondary" data-ppt-action="keep-slide" data-slide-id="${escape(slide.id)}">保留</button><button class="button-secondary" data-ppt-action="edit-slide" data-slide-id="${escape(slide.id)}">保存修改</button><input data-ppt-delete-reason="${escape(slide.id)}" placeholder="删除原因"><button class="button-secondary" data-ppt-action="delete-slide" data-slide-id="${escape(slide.id)}">删除页面</button></div>${slide.disposition === "deleted" ? `<p>已删除：${escape(slide.deleteReason)}</p>` : ""}</article>`).join("")}
        <div class="social-tools"><button class="button-primary" data-ppt-action="generate-slides" ${scene.outlineStatus === "approved" ? "" : "disabled"}>生成逐页草稿</button></div>
        <h3>路线比较</h3><div class="social-tools">${workflow.recommendPptRoute(scene.brief).options.map(route => `<button class="button-secondary" data-ppt-action="choose-route" data-route="${escape(route.id)}">${escape(route.title)}${route.recommended ? " · 推荐" : ""}${scene.route.selected === route.id ? " · 已选" : ""}</button>`).join("")}</div>
        <h3>当前阶段提示词</h3><textarea readonly>${escape(prompt)}</textarea><button class="button-secondary" data-ppt-action="copy-prompt">复制提示词</button><p>本工作台只生成规划草稿和制作提示词，不写入最终 PPT、HTML 或图片。</p></section>`;
      bind();
    }
    function setScene(task, scene) { save({ ...task, pptScene: scene }); render(); }
    async function run(action, value, payload = {}) {
      const task = getTask();
      if (action === "start") {
        const created = coordinator.createTask({ goal: root.querySelector("#ppt-idea")?.value || "" });
        taskId = created.id;
        const tasks = [created, ...(getState()?.promptAgentTasks || [])].slice(0, 30);
        persistState({ ...getState(), promptAgentTasks: tasks }); render(); return;
      }
      if (action === "new") { taskId = ""; render(); return; }
      if (!task) return;
      if (action === "save-brief") {
        const brief = { ...task.pptScene.brief };
        root.querySelectorAll("[data-brief]").forEach(node => { const key = node.dataset.brief; brief[key] = ["assumptions", "hardRequirements", "preferences"].includes(key) ? node.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean) : node.value; });
        brief.constraints = { ...task.pptScene.brief.constraints };
        root.querySelectorAll("[data-ppt-constraint]").forEach(node => {
          const value = node.value.trim();
          brief.constraints[node.dataset.pptConstraint] = value ? Number(value) : null;
        });
        setScene(task, { ...task.pptScene, brief }); return;
      }
      if (action === "approve-outline") setScene(task, coordinator.approveOutline(task));
      else if (action === "choose-route") setScene(task, coordinator.chooseRoute(task, value).pptScene);
      else if (action === "keep-slide" || action === "delete-slide") {
        const id = value; const reason = payload.reason || [...(root.querySelectorAll?.("[data-ppt-delete-reason]") || [])].find(node => node.dataset.pptDeleteReason === id)?.value || "";
        setScene(task, coordinator.setSlideDisposition(task, id, action === "keep-slide" ? "keep" : "deleted", reason));
      } else if (action === "edit-slide") {
        const id = value;
        const edits = [...(root.querySelectorAll?.("[data-slide-edit]") || [])].filter(item => item.dataset.slideId === id);
        const patch = Object.fromEntries(edits.map(node => [node.dataset.slideEdit, node.dataset.slideEdit === "body"
          ? node.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
          : node.value]));
        if (payload.field) patch[payload.field] = payload.value;
        setScene(task, coordinator.editSlide(task, id, patch));
      } else if (action === "copy-prompt") await copyText?.(coordinator.getStagePrompt(task));
      else if (action === "research-preview") {
        const preview = coordinator.previewResearch(task, { objective: task.pptScene.brief.idea, queries: [task.pptScene.brief.idea], sourceTypes: ["web"], platforms: [], budget: { maxQueries: 3, maxSources: 5 } });
        pendingResearchId = preview.id;
        show(`研究预览 ${preview.id || "已创建"}；确认后才能运行。`);
      } else if (action === "research-approve") {
        coordinator.approveResearch(task, pendingResearchId, "用户确认 PPT 联网研究"); show("联网研究已确认，可显式运行。");
      } else if (action === "research-run") {
        const result = await coordinator.runResearch(task, pendingResearchId);
        if (result.error) show(result.error.message); else { pendingResearchId = ""; save(result.task); show("研究来源已关联到 PPT 计划。"); }
      } else {
        const result = action === "generate-brief" ? await coordinator.generateBrief(task)
          : action === "materials" ? await coordinator.gatherMaterials(task)
            : action === "generate-outline" ? await coordinator.generateOutline(task)
              : action === "review-outline" ? await coordinator.reviewOutline(task)
                : action === "generate-slides" ? await coordinator.generateSlides(task) : null;
        if (result?.error) show(`模型/阶段失败：${result.error.message}；已有草稿已保留。`);
        else if (result?.task) { save(result.task); show("阶段草稿已保存。 "); }
      }
      render();
    }
    function bind() {
      if (bound) return;
      bound = true;
      root.addEventListener("click", async event => {
        const button = event.target.closest?.("[data-ppt-action]"); if (!button) return;
        try { await run(button.dataset.pptAction, button.dataset.route || button.dataset.slideId, button.dataset); render(); }
        catch (error) { show(error.message); render(); }
      });
    }
    render();
    return { render, openTask(id) { taskId = id; render(); } };
  }
  return { createPptSceneUI };
});
