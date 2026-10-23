(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPromptAgentUI = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  function createPromptAgentUI({ document, coordinator, getState, persistState, requestModel, searchSources, addSource, listSources, setSourceEnabled, removeSource, saveCase, copyText, navigate, notify } = {}) {
    const mount = document?.getElementById("prompt-agent-root");
    if (!mount || !coordinator || typeof getState !== "function" || typeof persistState !== "function") {
      throw new TypeError("提示词 Agent 工作台缺少必要依赖");
    }
    const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
    let taskId = "";
    let pendingResearchId = "";
    let busy = false;
    let reviewResultDraft = "";
    let reviewFeedbackDraft = "";
    let researchStatusText = "";
    let currentRawInput = "";
    let incomingContext = null;

    function state() { return getState() || {}; }
    function currentTask() { return (state().promptAgentTasks || []).find(item => item.id === taskId) || null; }
    function saveTask(task) {
      const normalized = window.ForwardStepPromptAgentSchema.normalizePromptAgentTask({ ...task, updatedAt: new Date().toISOString() });
      const tasks = (state().promptAgentTasks || []).filter(item => item.id !== normalized.id);
      tasks.unshift(normalized);
      persistState({ ...state(), promptAgentTasks: tasks.slice(0, 30) });
      taskId = normalized.id;
      return currentTask() || normalized;
    }
    function setStatus(message) {
      const node = mount.querySelector("#prompt-agent-status");
      if (node) node.textContent = message;
      if (message && notify) notify(message);
    }
    function stageLabel(stage) {
      return ({ clarification: "梳理目标", diagnosis: "诊断问题", planning: "制定路线", "step-prompt": "生成当前步骤提示词", review: "复盘外部结果" })[stage] || stage || "尚未开始";
    }
    function renderTaskList() {
      const tasks = state().promptAgentTasks || [];
      return tasks.length ? `<label class="field"><span class="field-label" for="prompt-agent-history">最近任务</span><select id="prompt-agent-history"><option value="">新任务</option>${tasks.map(item => `<option value="${escape(item.id)}" ${item.id === taskId ? "selected" : ""}>${escape(item.goal.slice(0, 72) || "未命名任务")} · ${escape(stageLabel(item.stage))}</option>`).join("")}</select></label>` : "";
    }
    function render() {
      const task = currentTask();
      mount.innerHTML = `
        <section class="social-panel">
          ${renderTaskList()}
          <div class="social-form-grid">
            <div class="field"><label class="field-label" for="prompt-agent-type">从哪里开始</label><select id="prompt-agent-type"><option value="advance-idea" ${task?.type === "advance-idea" ? "selected" : ""}>我有个想法，不知道怎么推进</option><option value="optimize-prompt" ${task?.type === "optimize-prompt" ? "selected" : ""}>我有提示词，想检查和优化</option><option value="diagnose-ai-result" ${task?.type === "diagnose-ai-result" ? "selected" : ""}>AI 结果不理想，想知道怎么调整</option></select></div>
            <div class="field"><label class="field-label" for="prompt-agent-target">领域或对象</label><input id="prompt-agent-target" value="${escape(task?.target || "")}" placeholder="例如：公众号文章、学习计划、产品方案"></div>
          </div>
          <div class="field"><label class="field-label" for="prompt-agent-goal">你想解决什么？</label><textarea id="prompt-agent-goal" placeholder="用你自己的话写就行，例如：这段文章有 AI 味，但我不知道该怎么要求 AI 改。">${escape(task?.goal || incomingContext?.topic || "")}</textarea></div>
          <div class="social-form-grid">
            <div class="field"><label class="field-label" for="prompt-agent-current">${task?.type === "optimize-prompt" ? "要检查的现有提示词" : task?.type === "diagnose-ai-result" ? "不满意的 AI 结果或片段" : "已有内容或当前情况"}</label><textarea id="prompt-agent-current" maxlength="8000" placeholder="${task?.type === "optimize-prompt" ? "粘贴你现在使用的提示词" : task?.type === "diagnose-ai-result" ? "粘贴 AI 生成的结果或关键片段" : "可粘贴现有材料或补充背景"}">${escape(currentRawInput || task?.currentState || "")}</textarea><small class="social-muted">原文只在本次应用会话中暂存；发送前会显示预览，任务记录只保存摘要。</small></div>
            <div class="field"><label class="field-label" for="prompt-agent-success">怎样算做好？</label><textarea id="prompt-agent-success" placeholder="写下你希望达到的效果，暂时不确定也可以留空">${escape((task?.successCriteria || []).join("\n"))}</textarea></div>
          </div>
          <div class="social-form-grid"><div class="field"><label class="field-label" for="prompt-agent-constraints">限制条件</label><textarea id="prompt-agent-constraints" placeholder="例如：不编造事实、不要直接改写">${escape(task?.constraints || "")}</textarea></div><div class="field"><label class="field-label" for="prompt-agent-preserve">必须保留</label><textarea id="prompt-agent-preserve" placeholder="例如：作者语气、关键观点、事实和数字">${escape((task?.preserveItems || []).join("\n"))}</textarea></div></div>
          <div class="social-tools"><button class="button-primary" id="prompt-agent-start" type="button" ${busy ? "disabled" : ""}>${task ? "更新目标并梳理" : "开始梳理"}</button><button class="button-secondary" id="prompt-agent-authorize" type="button">授权本地资料目录</button><span class="social-muted" id="prompt-agent-status" role="status" aria-live="polite">${task ? `当前阶段：${escape(stageLabel(task.stage))}` : ""}</span></div>
          ${renderSources(task)}
        </section>
        ${task ? renderWorkspace(task) : ""}
        ${renderResearch(task)}
        ${task ? renderReview(task) : ""}`;
      bind(task);
    }
    function renderSources(task) {
      const sources = task?.selectedSources || [];
      const authorized = state().promptAgentSources || [];
      return `<section class="social-panel"><div class="block-top"><div><h2>自动参考资料</h2><p class="social-muted">按任务从已授权目录、提示词库、成功/失败案例和方法卡中挑选；可取消不想纳入的资料。</p></div></div>${sources.length ? sources.map((item, index) => `<label class="social-result"><span><strong>${escape(item.title)}</strong><br><span class="social-muted">${escape(item.type)} · ${escape(item.location)}<br>${escape(item.useReason)} · ${escape(item.verificationStatus)}<br>${escape(item.excerpt)}</span></span><input type="checkbox" data-agent-source="${index}" ${item.selected === false ? "" : "checked"}></label>`).join("") : `<p class="social-muted">开始梳理后会自动寻找少量相关资料。</p>`}<h3>已授权目录</h3>${authorized.length ? authorized.map(source => `<div class="social-result"><span><strong>${escape(source.label)}</strong><br><span class="social-muted">${source.enabled ? "检索已启用" : "已暂停"} · 只读</span></span><span class="social-tools"><button class="button-quiet" type="button" data-source-action="toggle" data-source-id="${escape(source.id)}">${source.enabled ? "暂停" : "恢复"}</button><button class="button-quiet" type="button" data-source-action="remove" data-source-id="${escape(source.id)}">移除</button></span></div>`).join("") : `<p class="social-muted">尚未授权本地资料目录。</p>`}</section>`;
    }
    function renderWorkspace(task) {
      const steps = task.steps || [];
      return `<section class="social-panel"><div class="block-top"><div><h2>任务梳理</h2><p class="social-muted">${escape(stageLabel(task.stage))} · 关键追问 ${task.clarificationCount || 0}/3</p></div><div class="social-tools"><button class="button-secondary" data-run-stage="clarification" type="button">继续梳理</button><button class="button-secondary" data-run-stage="diagnosis" type="button">检查遗漏</button><button class="button-secondary" data-run-stage="planning" type="button">生成推进路线</button></div></div>
        <div class="social-grid"><div><h3>已知事实</h3><p>${escape((task.facts || []).join("\n") || "尚未整理")}</p></div><div><h3>当前假设</h3><p>${escape((task.assumptions || []).join("\n") || "暂无")}</p></div><div><h3>待确认</h3><p>${escape((task.missingInfo || []).join("\n") || "暂无")}</p></div></div>
        <div class="field"><label class="field-label" for="prompt-agent-draft">Agent 建议和分析</label><textarea class="reply-area" id="prompt-agent-draft" placeholder="模型返回的梳理结果会显示在这里；也可以自行补充">${escape(task.draft || "")}</textarea></div>
        <div class="social-form-grid"><div class="field"><label class="field-label" for="prompt-agent-answer">补充信息或回答</label><textarea id="prompt-agent-answer" placeholder="根据上面的分析补充信息；每轮只需回答一个关键问题"></textarea></div><div class="field"><label class="field-label" for="prompt-agent-step-title">当前要推进的步骤</label><input id="prompt-agent-step-title" value="${escape(steps.find(item => item.id === task.currentStepId)?.title || steps[0]?.title || "")}" placeholder="例如：确认文章要保留的事实和观点"></div></div>
        <div class="social-tools"><button class="button-secondary" id="prompt-agent-add-answer" type="button">记录补充并继续</button><button class="button-secondary" id="prompt-agent-make-step" type="button">生成当前步骤提示词</button><button class="button-secondary" id="prompt-agent-copy-draft" type="button">复制当前结果</button></div>
        ${steps.length ? `<div class="field"><label class="field-label" for="prompt-agent-step-select">路线步骤</label><select id="prompt-agent-step-select">${steps.map(step => `<option value="${escape(step.id)}" ${step.id === task.currentStepId ? "selected" : ""}>${escape(step.title)}</option>`).join("")}</select></div>` : ""}
        <div class="social-tools"><button class="button-secondary" id="prompt-agent-send-draft" type="button">通过发送预览让模型继续分析</button></div>
      </section>`;
    }
    function renderResearch(task) {
      return `<section class="social-panel"><div class="block-top"><div><h2>外部资料研究</h2><p class="social-muted">默认最多 3 个查询、5 个来源；联网前先检查目标和预算。</p></div></div>
        <div class="field"><label class="field-label" for="prompt-agent-research-objective">研究目标</label><input id="prompt-agent-research-objective" value="${escape(task?.researchScope?.objective || "")}" placeholder="例如：查找改善中文文章自然度的可验证方法"></div>
        <div class="social-form-grid"><label class="field"><span class="field-label">来源类型</span><select id="prompt-agent-research-source"><option value="web">网页、教程和 GitHub</option><option value="social">社交平台</option><option value="mixed">网页和社交平台</option></select></label><label class="field"><span class="field-label">研究预算</span><span class="social-muted">3 个查询 · 5 个来源</span></label></div>
        <div class="social-tools"><button class="button-secondary" id="prompt-agent-research-preview" type="button" ${task?.researchDecision === "rejected" || task?.researchDecision === "approved" ? "disabled" : ""}>查看研究范围并请求确认</button><button class="button-primary" id="prompt-agent-research-approve" type="button" ${pendingResearchId ? "" : "disabled"}>确认并开始研究</button><button class="button-quiet" id="prompt-agent-research-reject" type="button" ${pendingResearchId ? "" : "disabled"}>拒绝联网</button><button class="button-secondary" id="prompt-agent-research-collect" type="button" ${task?.researchReturn?.socialTaskId && !task.researchReturn.collected ? "" : "disabled"}>取回社媒研究结果</button></div>
        <div id="prompt-agent-research-detail" class="social-muted" role="status">${escape(researchStatusText || (task?.researchDecision === "rejected" ? "本任务已拒绝联网；如仍需外部资料，请新建任务。" : ""))}</div></section>`;
    }
    function renderReview(task) {
      return `<section class="social-panel"><h2>带回结果复盘</h2><p class="social-muted">Agent 只判断成功、失败或待验证，并给下一条提示词；不会改写你的结果。复盘案例只有你明确确认后才会保存。</p><div class="field"><label class="field-label" for="prompt-agent-external-result">外部 AI 结果</label><textarea id="prompt-agent-external-result" placeholder="粘贴 AI 的结果或关键片段">${escape(reviewResultDraft)}</textarea></div><div class="field"><label class="field-label" for="prompt-agent-feedback">你的反馈</label><textarea id="prompt-agent-feedback" placeholder="哪些地方满意或不满意？">${escape(reviewFeedbackDraft)}</textarea></div><div class="social-tools"><label class="field"><span class="field-label" for="prompt-agent-review-label">复盘结论</span><select id="prompt-agent-review-label"><option>待验证</option><option>成功</option><option>失败</option></select></label><button class="button-secondary" id="prompt-agent-review" type="button">分析结果并给下一步提示词</button><button class="button-primary" id="prompt-agent-save-case" type="button">确认保存为案例</button></div></section>`;
    }
    function taskFromForm(existing) {
      const type = mount.querySelector("#prompt-agent-type").value;
      const goal = mount.querySelector("#prompt-agent-goal").value.trim() || String(incomingContext?.topic || "").slice(0, 300);
      if (!goal) throw new Error("先写下你想解决的问题");
      const currentState = mount.querySelector("#prompt-agent-current").value.trim();
      if (type !== "advance-idea" && !currentState) throw new Error("请粘贴要检查的提示词或 AI 结果");
      const raw = {
        ...(existing || {}), type, goal,
        target: mount.querySelector("#prompt-agent-target").value.trim(),
        currentState,
        constraints: mount.querySelector("#prompt-agent-constraints").value.trim(),
        successCriteria: mount.querySelector("#prompt-agent-success").value.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
        preserveItems: mount.querySelector("#prompt-agent-preserve").value.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
        facts: existing?.facts || [], assumptions: existing?.assumptions || [], missingInfo: existing?.missingInfo || [],
        stage: type === "advance-idea" ? "clarification" : "diagnosis",
        status: "clarifying", updatedAt: new Date().toISOString()
      };
      return window.ForwardStepPromptAgentWorkflow.createPromptAgentFlow(window.ForwardStepPromptAgentSchema.createPromptAgentTask(raw));
    }
    function extractSection(text, heading) {
      const lines = String(text || "").split(/\r?\n/);
      const start = lines.findIndex(line => new RegExp(`^\\s*(?:#{1,4}\\s*)?(?:\\*\\*)?${heading}(?:\\*\\*)?\\s*[:：]?\\s*$`, "i").test(line.trim()));
      if (start < 0) return [];
      const values = [];
      for (const line of lines.slice(start + 1)) {
        if (/^\s*(?:#{1,4}\s*|(?:\*\*)?(?:目标理解|已知事实|事实|当前假设|假设|待确认信息|待确认|本轮关键问题|遗漏与矛盾|必须保留|建议)(?:\*\*)?\s*[:：]?\s*)$/.test(line)) break;
        const value = line.replace(/^\s*(?:[-*•]|\d+[.、)）])\s*/, "").trim();
        if (value) values.push(value);
      }
      return values.slice(0, 12);
    }
    async function runStage(stage, taskOverride) {
      if (busy) return;
      let task = currentTask();
      if (taskOverride) task = { ...task, ...taskOverride };
      else if (!task) task = taskFromForm(null);
      else task = taskFromForm(task);
      task.stage = stage;
      task.status = stage === "planning" ? "planning" : stage === "step-prompt" ? "ready" : stage === "review" ? "reviewing" : "clarifying";
      const requestTask = { ...task };
      task = saveTask(task);
      busy = true; render(); setStatus("正在准备当前阶段提示词…");
      try {
        const result = await coordinator.runStage(requestTask, { stage, runId: task.id, inputExcerpt: currentRawInput });
        const analysis = stage === "clarification" || stage === "diagnosis" ? {
          facts: extractSection(result.draft, "(?:已知事实|事实)"),
          assumptions: extractSection(result.draft, "(?:当前假设|假设)"),
          missingInfo: extractSection(result.draft, "(?:待确认信息|待确认)")
        } : {};
        const updated = { ...result.task, ...task, ...Object.fromEntries(Object.entries(analysis).filter(([, values]) => values.length)), draft: result.draft || result.error?.message || task.draft, selectedSources: result.selectedSources || task.selectedSources, stage, status: result.error ? task.status : stage === "planning" ? "ready" : task.status };
        saveTask(updated);
        setStatus(result.error ? `暂时无法完成模型分析：${result.error.message}。可以直接复制提示词或稍后重试。` : "已完成本轮分析；核对来源和结论后再继续。");
      } catch (error) { setStatus(error.message || "本轮未能完成"); }
      finally { busy = false; render(); }
    }
    async function prepareResearch() {
      const task = currentTask();
      if (!task) throw new Error("先开始一个任务");
      const objective = mount.querySelector("#prompt-agent-research-objective").value.trim();
      if (!objective) throw new Error("请写清楚要查什么");
      const sourceType = mount.querySelector("#prompt-agent-research-source").value;
      const scope = {
        objective,
        queries: [objective],
        sourceTypes: sourceType === "mixed" ? ["web", "social"] : [sourceType],
        platforms: sourceType === "social" || sourceType === "mixed" ? ["xiaohongshu", "bilibili", "weibo", "zhihu"] : [],
        budget: { maxQueries: 3, maxSources: 5 }
      };
      const request = coordinator.previewExternalResearch(scope);
      const nextTask = window.ForwardStepPromptAgentWorkflow.requestExternalResearch(task, scope);
      saveTask(nextTask);
      pendingResearchId = request.id;
      researchStatusText = `待确认：${request.objective}；查询 ${request.estimatedQueryRuns} 次，最多收集 ${request.budget.maxSources} 个来源。社媒研究会转到独立研究工作台再次确认平台计划。`;
      render();
    }
    async function approveResearch() {
      if (!pendingResearchId) return;
      let task = currentTask();
      const id = pendingResearchId;
      coordinator.approveExternalResearch(id);
      task = saveTask(window.ForwardStepPromptAgentWorkflow.approveExternalResearch(task));
      pendingResearchId = "";
      researchStatusText = "正在按批准范围搜索…";
      render();
      try {
        const result = await coordinator.runExternalResearch(id);
        if (result.socialHandoff) {
          const socialTask = result.socialHandoff;
          saveTask({ ...task, researchReturn: { status: "awaiting-social-research", stage: task.stage, socialTaskId: socialTask.id, collected: false } });
          researchStatusText = "社媒研究计划已转交到独立研究 Agent，请在研究工作台检查并确认。";
        } else {
          const summary = result.results.map(item => `${item.title}\n${item.url}\n${item.summary}`).join("\n\n");
          const researchReturn = {
            status: result.status,
            stage: task.stage,
            collected: true,
            summary,
            sources: result.results,
            limitations: result.results.map(item => item.limitations).filter(Boolean),
            errors: result.errors,
            budget: { maxQueries: result.budget.maxQueries, usedQueries: result.usedQueries, maxSources: result.budget.maxSources, usedSources: result.usedSources }
          };
          saveTask({ ...task, researchDecision: "approved", researchBudget: { ...task.researchBudget, usedQueries: result.usedQueries, usedSources: result.usedSources }, draft: [task.draft, summary].filter(Boolean).join("\n\n外部研究摘要\n"), researchReturn, stage: task.stage });
          researchStatusText = result.incomplete ? `研究未完整完成：${result.errors.map(item => item.message).join("；") || "预算或服务受限"}` : `研究完成：${result.usedQueries} 个查询，${result.usedSources} 个来源。摘要已加入任务草稿。`;
        }
      } catch (error) { researchStatusText = `研究未完成：${error.message}`; }
      render();
    }
    function bind(task) {
      mount.querySelector("#prompt-agent-history")?.addEventListener("change", event => { taskId = event.target.value; currentRawInput = ""; reviewResultDraft = ""; reviewFeedbackDraft = ""; researchStatusText = ""; pendingResearchId = ""; render(); });
      mount.querySelector("#prompt-agent-type").addEventListener("change", event => {
        const type = event.target.value;
        mount.querySelector('label[for="prompt-agent-current"]').textContent = type === "optimize-prompt" ? "要检查的现有提示词" : type === "diagnose-ai-result" ? "不满意的 AI 结果或片段" : "已有内容或当前情况";
        mount.querySelector("#prompt-agent-current").placeholder = type === "optimize-prompt" ? "粘贴你现在使用的提示词" : type === "diagnose-ai-result" ? "粘贴 AI 生成的结果或关键片段" : "可粘贴现有材料或补充背景";
      });
      mount.querySelector("#prompt-agent-current").addEventListener("input", event => { currentRawInput = event.target.value.slice(0, 8000); });
      mount.querySelector("#prompt-agent-start").addEventListener("click", async () => {
        try { currentRawInput = mount.querySelector("#prompt-agent-current").value.slice(0, 8000); const next = taskFromForm(task); taskId = next.id; saveTask(next); await runStage(next.stage, next); }
        catch (error) { setStatus(error.message); }
      });
      mount.querySelector("#prompt-agent-authorize").addEventListener("click", async () => {
        try { await addSource?.(); setStatus("本地资料授权已更新；Agent 会按任务自动检索相关内容。"); }
        catch (error) { setStatus(error.message || "授权目录未添加"); }
      });
      mount.querySelectorAll("[data-source-action]").forEach(button => button.addEventListener("click", async () => {
        try {
          if (button.dataset.sourceAction === "toggle") await setSourceEnabled?.(button.dataset.sourceId, !(state().promptAgentSources || []).find(item => item.id === button.dataset.sourceId)?.enabled);
          else await removeSource?.(button.dataset.sourceId);
          render();
        } catch (error) { setStatus(error.message || "本地目录设置未能更新"); }
      }));
      mount.querySelectorAll("[data-run-stage]").forEach(button => button.addEventListener("click", () => runStage(button.dataset.runStage).catch(error => setStatus(error.message))));
      mount.querySelectorAll("[data-agent-source]").forEach(input => input.addEventListener("change", () => {
        const current = currentTask();
        const source = current.selectedSources?.[Number(input.dataset.agentSource)];
        const selectedSources = (current.selectedSources || []).map((item, index) => index === Number(input.dataset.agentSource) ? { ...item, selected: input.checked } : item);
        const excluded = new Set(current.excludedSourceIds || []);
        if (source?.id) input.checked ? excluded.delete(source.id) : excluded.add(source.id);
        saveTask({ ...current, selectedSources, excludedSourceIds: [...excluded] });
      }));
      mount.querySelector("#prompt-agent-draft")?.addEventListener("input", event => saveTask({ ...currentTask(), draft: event.target.value }));
      mount.querySelector("#prompt-agent-add-answer")?.addEventListener("click", () => {
        const current = currentTask(); const answer = mount.querySelector("#prompt-agent-answer").value.trim();
        if (!answer) { setStatus("先填写补充信息"); return; }
        let clarified = { ...current, status: "clarifying" };
        if (current.draft && (current.clarificationCount || 0) < 3) {
          try { clarified = window.ForwardStepPromptAgentWorkflow.recordClarification(clarified, { question: current.draft.slice(0, 500), answer }); }
          catch { /* 用户补充仍会进入上下文，未能作为关键追问记录时不阻断。 */ }
        }
        const updated = { ...clarified, currentState: [current.currentState, `用户补充：${answer}`].filter(Boolean).join("\n"), status: "clarifying", stage: "clarification" };
        saveTask(updated); runStage("clarification", updated).catch(error => setStatus(error.message));
      });
      mount.querySelector("#prompt-agent-make-step")?.addEventListener("click", () => {
        const current = currentTask(); const title = mount.querySelector("#prompt-agent-step-title").value.trim();
        if (!title) { setStatus("先写下当前要完成的步骤"); return; }
        const id = `step-${Date.now()}`;
        const steps = [...(current.steps || []), { id, title, goal: title, inputs: [current.currentState].filter(Boolean), deliverable: "当前步骤的阶段性结果", checklist: current.successCriteria || [], status: "current", order: (current.steps || []).length + 1 }];
        saveTask({ ...current, steps, currentStepId: id, stage: "step-prompt", status: "ready" });
        runStage("step-prompt").catch(error => setStatus(error.message));
      });
      mount.querySelector("#prompt-agent-step-select")?.addEventListener("change", event => saveTask(window.ForwardStepPromptAgentWorkflow.selectPromptStep(currentTask(), event.target.value)));
      mount.querySelector("#prompt-agent-copy-draft")?.addEventListener("click", () => copyText?.(currentTask()?.draft || ""));
      mount.querySelector("#prompt-agent-send-draft")?.addEventListener("click", () => requestModel?.(currentTask()?.draft || "").catch(error => setStatus(error.message)));
      mount.querySelector("#prompt-agent-research-preview").addEventListener("click", () => prepareResearch().catch(error => setStatus(error.message)));
      mount.querySelector("#prompt-agent-research-approve").addEventListener("click", () => approveResearch().catch(error => setStatus(error.message)));
      mount.querySelector("#prompt-agent-research-reject").addEventListener("click", () => {
        const task = currentTask();
        if (pendingResearchId) coordinator.rejectExternalResearch(pendingResearchId);
        pendingResearchId = "";
        if (task) saveTask(window.ForwardStepPromptAgentWorkflow.rejectExternalResearch(task));
        researchStatusText = "本任务已拒绝联网；如仍需外部资料，请新建任务。";
        render();
      });
      mount.querySelector("#prompt-agent-research-collect").addEventListener("click", () => {
        const current = currentTask();
        const socialTask = (state().researchTasks || []).find(item => item.id === current?.researchReturn?.socialTaskId);
        if (!socialTask) {
          researchStatusText = "尚未找到对应的社媒研究任务；请先在社媒研究工作台完成计划。";
          saveTask({ ...current, researchReturn: { ...current.researchReturn, status: "unavailable", collected: false, errors: [{ type: "social-research", message: researchStatusText }] } });
          render();
          return;
        }
        if (!["awaiting-save", "saved", "partial-failure", "failed", "cancelled"].includes(socialTask.status)) {
          researchStatusText = "社媒研究仍在确认、准备或运行中；完成后再取回结果。";
          setStatus(researchStatusText);
          return;
        }
        const result = coordinator.collectSocialResearchResult(socialTask, 5);
        const evidence = [result.summary, ...result.sources.map(source => `${source.title}：${source.summary} ${source.url}`), ...result.limitations, ...result.errors.map(error => `未完成：${error.message}`)].filter(Boolean).join("\n");
        const status = result.incomplete ? `社媒研究${result.status}，结果可能不完整。` : "社媒研究结果已回到当前任务。";
        saveTask({ ...current, draft: [current.draft, evidence].filter(Boolean).join("\n\n社媒研究摘要\n"), researchReturn: { ...current.researchReturn, ...result, socialTaskId: socialTask.id, collected: true } });
        researchStatusText = status;
        render();
      });
      mount.querySelector("#prompt-agent-review")?.addEventListener("click", () => {
        const current = currentTask();
        const result = mount.querySelector("#prompt-agent-external-result").value.trim();
        const feedback = mount.querySelector("#prompt-agent-feedback").value.trim();
        if (!result) { setStatus("先粘贴外部 AI 的结果"); return; }
        reviewResultDraft = result;
        reviewFeedbackDraft = feedback;
        saveTask({ ...current, review: { ...current.review, feedback, label: "待验证" }, stage: "review", status: "reviewing" });
        runStage("review", { review: { ...current.review, excerpt: result.slice(0, 1200), feedback } }).catch(error => setStatus(error.message));
      });
      mount.querySelector("#prompt-agent-external-result")?.addEventListener("input", event => { reviewResultDraft = event.target.value; });
      mount.querySelector("#prompt-agent-feedback")?.addEventListener("input", event => { reviewFeedbackDraft = event.target.value; });
      mount.querySelector("#prompt-agent-save-case")?.addEventListener("click", async () => {
        let current = currentTask();
        if (!reviewResultDraft.trim()) { setStatus("先粘贴需要复盘的外部结果"); return; }
        if (current.stage !== "review" || !current.draft) { setStatus("先完成复盘分析，再确认保存"); return; }
        if (!reviewFeedbackDraft.trim()) { setStatus("请补充你对结果的反馈，再保存复盘案例"); return; }
        current = taskFromForm(current);
        current.stage = "review";
        current.status = "reviewing";
        if (!current.successCriteria.length) { setStatus("请先补充至少一条成功标准，再保存复盘案例"); return; }
        saveTask(current);
        try {
          if (typeof saveCase !== "function") throw new Error("案例保存服务尚未就绪");
          await saveCase({ task: current, externalResult: reviewResultDraft, feedback: reviewFeedbackDraft, label: mount.querySelector("#prompt-agent-review-label").value, lessons: current.draft });
          setStatus("复盘案例已由你确认并保存；之后会按相关性参与本地检索。");
        } catch (error) { setStatus(error.message || "案例保存失败"); }
      });
    }
    render();
    if (typeof listSources === "function") listSources().then(sources => {
      persistState({ ...state(), promptAgentSources: sources });
      render();
    }).catch(error => setStatus(`本地授权目录读取失败：${error.message}`));
    return {
      render,
      openTask(id) { taskId = id; render(); },
      applyIncomingContext(context) {
        if (!context || typeof context !== "object") return;
        incomingContext = context;
        taskId = "";
        currentRawInput = String(context.summary || "").slice(0, 8000);
        reviewResultDraft = "";
        reviewFeedbackDraft = "";
        researchStatusText = "";
        render();
        setStatus(context.summary
          ? "已带入研究报告摘要；请补充任务目标后开始梳理。"
          : "已按独立任务打开；未找到可带入的研究结论。");
      }
    };
  }
  function createPromptAgentScenes({ document, onSceneChange } = {}) {
    const roots = { task: 'prompt-agent-root', writing: 'writing-workbench-root', ppt: 'ppt-scene-root' };
    const labels = { task: '任务梳理', writing: '写作工作台', ppt: 'PPT 规划' };
    let current = 'task';
    function selectScene(scene) {
      if (!Object.hasOwn(roots, scene)) scene = 'task';
      current = scene;
      for (const [key, id] of Object.entries(roots)) {
        const panel = document.getElementById(id);
        if (panel) panel.hidden = key !== scene;
      }
      document.querySelectorAll('[data-agent-scene]').forEach(button => {
        const selected = button.dataset.agentScene === scene;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('active', selected);
      });
      onSceneChange?.(scene, labels[scene]);
      return scene;
    }
    document.querySelectorAll('[data-agent-scene]').forEach(button => button.addEventListener('click', () => selectScene(button.dataset.agentScene)));
    selectScene(current);
    return { selectScene, getScene: () => current };
  }
  return { createPromptAgentUI, createPromptAgentScenes };
});
