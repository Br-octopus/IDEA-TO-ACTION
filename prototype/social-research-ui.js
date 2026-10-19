(function exposeSocialResearchUI(root) {
  const api = { createSocialResearchUI, filterResearchResults };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepSocialResearchUI = api;

  function filterResearchResults(results, filters = {}, savedIds = []) {
    const saved = new Set(savedIds);
    return (Array.isArray(results) ? results : []).filter(result => {
      if (filters.platform && result.platform !== filters.platform) return false;
      if (filters.query && !(result.searchQueries || []).includes(filters.query)) return false;
      if (filters.evidence && result.evidenceStatus !== filters.evidence) return false;
      if (filters.saved === "saved" && !saved.has(result.id)) return false;
      if (filters.saved === "unsaved" && saved.has(result.id)) return false;
      const published = result.publishedAt ? new Date(result.publishedAt).getTime() : null;
      if (filters.from && published !== null && published < new Date(filters.from).getTime()) return false;
      if (filters.to && published !== null && published > new Date(`${filters.to}T23:59:59.999`).getTime()) return false;
      return true;
    });
  }

  function createSocialResearchUI({ document, desktopApi, coordinator, getState, persistState }) {
    if (!document || !desktopApi?.social || !coordinator) throw new TypeError("研究 UI 需要 document、desktopApi.social 和 coordinator");
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    const names = { xiaohongshu: "小红书", reddit: "Reddit", youtube: "YouTube" };
    let platforms = [];
    let activeTaskId = "";
    let checking = new Set();
    let running = false;
    let paused = false;
    let cancellationRequested = false;
    let reportGenerating = false;
    let liveProgress = null;
    let selectedResultIds = new Set();

    function profileId(platform) { return `social-research-${platform}`; }
    function selectedPlatforms() { return [...document.querySelectorAll("[data-social-platform]:checked")].map(input => input.value); }
    function currentTask() { return (getState()?.researchTasks || []).find(task => task.id === activeTaskId) || null; }
    function persistConnections() {
      if (typeof persistState !== "function") return;
      const state = getState() || {};
      persistState({ ...state, platformConnections: { ...(state.platformConnections || {}), ...Object.fromEntries(platforms.map(platform => [platform.platform, platform.connection || {}])) } });
    }

    function renderPlatformChoices() {
      $("social-research-platforms").innerHTML = platforms.map(item => `<label class="social-platform"><span class="social-inline-check"><input type="checkbox" data-social-platform value="${escape(item.platform)}" checked> <strong>${escape(item.displayName || names[item.platform] || item.platform)}</strong></span><span class="social-meta">${item.apiAvailable ? "API 支持" : "无平台 API，使用浏览器"}</span></label>`).join("");
      const options = `<option value="">全部平台</option>${platforms.map(item => `<option value="${escape(item.platform)}">${escape(item.displayName || names[item.platform] || item.platform)}</option>`).join("")}`;
      $("social-filter-platform").innerHTML = options;
      renderPlatformCards();
    }

    function renderPlatformCards() {
      $("social-platform-cards").innerHTML = platforms.map(item => {
        const connection = item.connection || {};
        const status = connection.browserStatus || connection.status || "needs-recheck";
        const apiStatus = connection.apiConfigured ? "已配置" : item.apiAvailable ? "支持，未配置" : "不支持";
        const capabilities = connection.capabilities || {};
        const stateText = { ready: "已检查，可搜索", "api-available": "API 可用", "not-ready": "未登录或未准备", "needs-recheck": "需要检查", expired: "登录已过期", restricted: "访问受限", failed: "检查失败", checking: "检查中" }[status] || status;
        return `<article class="social-platform" data-platform-card="${escape(item.platform)}"><header><div><h3>${escape(item.displayName || names[item.platform] || item.platform)}</h3><div class="social-meta">API：${apiStatus} · 浏览器：${escape(stateText)}</div></div><label class="social-muted">连接方式 <select data-connection-mode="${escape(item.platform)}"><option value="auto">自动回退</option><option value="api">只用 API</option><option value="browser">真实浏览器</option></select></label></header><div class="social-meta">能力：搜索 ${capabilities.supportsSearch || connection.supportsSearch ? "可用" : "待检查"} · 详情 ${capabilities.supportsDetail || connection.supportsDetail ? "可用" : "未知"} · 评论 ${capabilities.supportsComments || connection.supportsComments ? "可用" : "未知"} · 只读</div><div class="social-tools"><button class="button-secondary" type="button" data-social-action="login" data-platform="${escape(item.platform)}">开始登录</button><button class="button-secondary" type="button" data-social-action="check" data-platform="${escape(item.platform)}" ${checking.has(item.platform) ? "disabled" : ""}>重新检查</button><button class="button-quiet" type="button" data-social-action="clear" data-platform="${escape(item.platform)}">清理 profile</button></div><div class="social-meta" data-platform-error="${escape(item.platform)}">${escape(connection.error || connection.lastError || "最近错误：无")}</div></article>`;
      }).join("");
      const task = currentTask();
      platforms.forEach(item => { const select = document.querySelector(`[data-connection-mode="${item.platform}"]`); if (select) select.value = task?.connectionModes?.[item.platform] || "auto"; });
    }

    function setStatus(message) { $("social-research-status").textContent = message; }
    function renderPlan(task) {
      if (!task) { $("social-research-plan-detail").textContent = "等待生成计划"; return; }
      const plan = task.plan || {};
      $("social-research-plan-detail").innerHTML = `<h3>${escape(plan.objective || task.topic)}</h3><p>模板：${escape(plan.researchType || task.template)} · 平台：${(task.platforms || []).map(platform => escape(names[platform] || platform)).join("、")}</p><p>平台分工：${(plan.platformRoles || []).map(role => `${escape(names[role.platform] || role.platform)}：${escape(role.role)}（${(role.queries || []).map(escape).join("、")}）`).join("；")}</p><p>查询词：${(plan.queries || task.queries || []).map(escape).join("、") || "待生成"} · 时间：${escape(plan.timeRange?.from || "不限")} 至 ${escape(plan.timeRange?.to || "不限")}</p><p>预算：最多 ${escape(plan.budget?.maxPlatforms)} 个平台、每平台 ${escape(plan.budget?.maxQueriesPerPlatform)} 个查询、${escape(plan.budget?.maxPages)} 页、${escape(plan.budget?.maxDetails)} 条详情。停止条件：${(plan.stopConditions || []).map(escape).join("；")}</p>`;
      const ready = (task.platforms || []).every(platform => {
        const item = platforms.find(entry => entry.platform === platform);
        return Boolean((item?.connection?.checked || item?.connection?.browserPrepared || item?.connection?.apiConfigured)
          && (item.connection.browserReady || item.connection.browserPrepared || item.connection.apiConfigured));
      });
      $("social-research-plan-confirm").disabled = task.status !== "awaiting-plan-confirmation" || !ready || running;
      $("social-research-pause").disabled = !running || cancellationRequested || reportGenerating;
      $("social-research-pause").textContent = paused ? "继续" : "暂停";
      $("social-research-cancel").disabled = cancellationRequested || !["awaiting-plan-confirmation", "awaiting-platform-preparation", "searching"].includes(task.status);
      if (running && reportGenerating) {
        $("social-research-progress-detail").textContent = "正在生成报告；取消将在当前模型请求完成后生效";
      } else if (running && liveProgress) {
        const platform = names[liveProgress.platform] || liveProgress.platform || "";
        const mode = { auto: "自动回退", api: "API", browser: "真实浏览器" }[liveProgress.mode] || liveProgress.mode || "待确定";
        $("social-research-progress-detail").textContent = `${paused ? "已暂停" : "执行中"} · ${platform} · ${mode} · 查询：${liveProgress.query || "等待查询"} · 已收集 ${liveProgress.resultCount || 0} 条`;
      }
      if (!running) $("social-research-progress-detail").textContent = "";
      if (task.status === "partial-failure" && task.reportError) setStatus(`研究未完成：${task.reportErrorCode ? `${task.reportErrorCode}：` : ""}${task.reportError}`);
      else if (!running && !["cancelled", "awaiting-save", "partial-failure", "failed"].includes(task.status)) setStatus(`${task.status}${ready ? " · 平台准备完成" : " · 先检查所选平台"}`);
    }

    function renderResults(task) {
      const results = task?.results || [];
      const queryValues = [...new Set(results.flatMap(result => result.searchQueries || []))];
      $("social-filter-query").innerHTML = `<option value="">全部查询</option>${queryValues.map(value => `<option>${escape(value)}</option>`).join("")}`;
      const filtered = filterResearchResults(results, {
        platform: $("social-filter-platform").value, query: $("social-filter-query").value,
        evidence: $("social-filter-evidence").value, saved: $("social-filter-saved").value,
        from: $("social-filter-from").value, to: $("social-filter-to").value
      }, task?.savedResultIds || []);
      $("social-research-results-list").innerHTML = filtered.length ? filtered.map(result => `<article class="social-result"><div><h3>${escape(result.title || "无标题")}</h3><div>${escape(result.summary || result.discussionSummary || "无摘要")}</div><div class="social-meta">${escape(names[result.platform] || result.platform)} · ${escape(result.author || "作者未知")} · ${escape(result.publishedAt || "时间未知")} · ${escape(result.retrievalMethod)} · ${escape(result.evidenceStatus || "unverified")} · 营销风险：${escape(result.marketingRisk || "未知")}</div><div class="social-meta">查询：${(result.searchQueries || []).map(escape).join("、")} · 抓取：${escape(result.capturedAt || "未知")}</div>${result.url ? `<a href="${escape(result.url)}" target="_blank" rel="noreferrer">打开原始来源</a>` : "缺少来源链接"}</div><label class="social-inline-check"><input type="checkbox" data-save-result="${escape(result.id)}" ${selectedResultIds.has(result.id) || task?.selectedResultIds?.includes(result.id) ? "checked" : ""} ${task?.savedResultIds?.includes(result.id) ? "disabled" : ""}> 保存</label></article>`).join("") : `<p class="social-muted">${results.length ? "没有符合筛选条件的结果" : "尚无研究结果"}</p>`;
      $("social-research-save-selection").disabled = task?.status !== "awaiting-save" || ![...selectedResultIds].some(id => !task.savedResultIds?.includes(id));
    }

    function renderReport(task) {
      const report = task?.report;
      if (!report) {
        const detail = task?.reportError ? `${task.reportErrorCode ? `${task.reportErrorCode}：` : ""}${task.reportError}` : "报告结论会关联到对应原始结果。";
        $("social-research-report-content").textContent = detail;
        return;
      }
      const findings = [...(report.coreFindings || []), ...(report.commonPoints || []), ...(report.platformDifferences || []), ...(report.painPointsOrPatterns || []), ...(report.representativeCases || []), ...(report.conflicts || []), ...(report.needsVerification || []), ...(report.nextSteps || [])];
      $("social-research-report-content").innerHTML = `<p>${escape(report.summary || "研究报告")}</p>${findings.map((finding, index) => { const id = report.resultIds?.[index] || report.resultIds?.[0]; const result = task.results.find(item => item.id === id); return `<div class="social-report-item"><span>${escape(finding)}</span>${result?.url ? `<a href="#social-result-${escape(id)}" data-report-result="${escape(id)}">来源：${escape(result.title || id)}</a>` : `<span class="social-muted">来源待核验</span>`}</div>`; }).join("")}`;
      const resultInputs = [...document.querySelectorAll("[data-save-result]")];
      task.results.forEach(result => { const node = resultInputs.find(input => input.dataset.saveResult === result.id); if (node) node.closest(".social-result").id = `social-result-${result.id}`; });
    }

    function render() { const task = currentTask(); renderPlatformCards(); renderPlan(task); renderResults(task); renderReport(task); }
    async function refreshPlatforms() {
      if (typeof desktopApi.social.listPlatforms !== "function") throw new Error("当前桌面 API 不支持平台列表");
      const definitions = await desktopApi.social.listPlatforms();
      platforms = (Array.isArray(definitions) ? definitions : definitions?.platforms || []).map(item => ({ ...item, connection: getState()?.platformConnections?.[item.platform] || {} }));
      renderPlatformChoices();
    }
    async function platformAction(action, platform) {
      const item = platforms.find(entry => entry.platform === platform);
      if (!item) return;
      const id = profileId(platform);
      if (action === "login") {
        const result = await desktopApi.social.openLogin(platform, id);
        if (result?.status === "error") throw new Error(result.message || "无法打开登录窗口");
        item.connection = { ...item.connection, browserStatus: "not-ready", browserReady: false, checked: false };
        setStatus(`${names[platform] || platform} 登录窗口已打开；登录后点击重新检查。`);
      } else if (action === "check") {
        checking.add(platform); renderPlatformCards();
        try {
          const [status, checked] = await Promise.all([desktopApi.social.getStatus(platform), desktopApi.social.check(platform, id)]);
          const browserReady = checked?.ready === true || checked?.status === "ready";
          item.connection = { ...item.connection, status: browserReady ? "ready" : "not-ready", browserStatus: browserReady ? "ready" : "not-ready", apiConfigured: status?.apiConfigured === true, browserReady, browserPrepared: browserReady, checked: true, checkedAt: new Date().toISOString(), capabilities: checked?.capabilities || checked || {}, error: checked?.message || "" };
          persistConnections();
          setStatus(`${names[platform] || platform}：${browserReady ? "检查完成" : "尚未准备好"}${item.connection.apiConfigured ? "，API 可用" : ""}`);
        } finally { checking.delete(platform); }
      } else if (action === "clear") {
        const result = await desktopApi.social.clearProfile(platform, id);
        if (result?.status === "error") throw new Error(result.message || "清理 profile 失败");
        item.connection = { ...item.connection, status: "needs-recheck", browserStatus: "needs-recheck", browserReady: false, browserPrepared: false, checked: false, error: "" };
        persistConnections(); setStatus(`${names[platform] || platform} 独立 profile 已清理。`);
      }
      render();
    }

    async function createPlan(event) {
      event.preventDefault();
      const chosen = selectedPlatforms();
      if (!chosen.length) { setStatus("至少选择一个研究平台。"); return; }
      const topic = $("social-research-topic").value.trim();
      const modes = Object.fromEntries(chosen.map(platform => [platform, document.querySelector(`[data-connection-mode="${platform}"]`)?.value || "auto"]));
      try {
        const task = await coordinator.createPlan({ topic, template: $("social-research-template").value, platforms: chosen, connectionModes: modes });
        activeTaskId = task.id;
        selectedResultIds.clear();
        render();
        setStatus("计划已生成。请核对目标、查询词和预算后确认；确认前不会开始搜索。");
      } catch (error) { setStatus(error.message || "研究计划生成失败"); }
    }
    async function confirmAndRun() {
      const task = currentTask();
      if (!task || !task.platforms.every(platform => {
        const connection = platforms.find(item => item.platform === platform)?.connection;
        return Boolean(connection?.checked || connection?.browserPrepared || connection?.apiConfigured);
      })) { setStatus("请先检查所有所选平台。"); return; }
      try {
        await coordinator.confirmPlan(task.id);
        running = true; paused = false; cancellationRequested = false; reportGenerating = false; liveProgress = null;
        let completedQueries = 0;
        $("social-research-progress").style.width = "0%";
        $("social-research-progress-detail").textContent = "正在检查平台…";
        render(); setStatus("已确认计划，正在检查平台；取消将在当前平台/查询请求完成后生效。");
        const result = await coordinator.run(task.id, { onEvent: event => {
          if (event.type === "report-start") {
            reportGenerating = true;
            setStatus("正在生成报告；取消将在当前模型请求完成后生效");
          }
          liveProgress = { ...liveProgress, ...event };
          if (event.type === "platform-start") liveProgress.query = "等待查询";
          if (event.type === "query-start") liveProgress.query = event.query;
          if (event.type === "platform-finish") liveProgress.query = "平台完成";
          if (event.type === "result-count") completedQueries += 1;
          const plannedQueries = Math.max(1, (task.platforms || []).reduce((sum, platform) => sum + (task.plan.platformRoles.find(role => role.platform === platform)?.queries?.length || 1), 0));
          $("social-research-progress").style.width = `${Math.min(95, Math.round(completedQueries / plannedQueries * 95))}%`;
          render();
        } });
        running = false; paused = false; cancellationRequested = false; reportGenerating = false;
        $("social-research-progress").style.width = result.status === "awaiting-save" ? "100%" : result.status === "cancelled" ? "0%" : "60%";
        render();
        setStatus(result.status === "cancelled" ? "已取消：当前请求结束后停止，未完成结果已丢弃。" : `研究结束：${result.status} · ${result.results?.length || 0} 条结果${Object.keys(result.platformErrors || {}).length ? " · 部分平台未完成" : ""}`);
      } catch (error) { running = false; paused = false; cancellationRequested = false; reportGenerating = false; render(); setStatus(error.message || "研究执行失败"); }
    }
    function cancelTask() {
      const task = currentTask();
      if (!task) return;
      try {
        coordinator.cancel(task.id);
        if (running) { cancellationRequested = true; render(); setStatus(reportGenerating
          ? "正在生成报告；取消将在当前模型请求完成后生效，返回结果将丢弃。"
          : "已请求取消，将在当前平台/查询请求完成后生效；未完成结果不会保留或生成报告。"); }
        else { render(); setStatus("研究计划已取消，未开始搜索。"); }
      }
      catch (error) { setStatus(error.message || "当前阶段不能取消"); }
    }
    function togglePause() {
      const task = currentTask();
      if (!task || !running || cancellationRequested) return;
      try {
        if (paused) { coordinator.resume(task.id); paused = false; setStatus("已继续研究。"); }
        else { coordinator.pause(task.id); paused = true; setStatus("已暂停；当前平台/查询请求完成后等待继续，不会继续消耗预算。"); }
        render();
      } catch (error) { setStatus(error.message || "无法更改运行状态"); }
    }
    function saveSelection() {
      const task = currentTask(); if (!task) return;
      const ids = [...selectedResultIds];
      try { coordinator.saveSelected(task.id, ids); render(); setStatus(`已将 ${ids.length} 条勾选结果保存到本地资料库。`); }
      catch (error) { setStatus(error.message || "保存失败"); }
    }

    $("social-research-entry").addEventListener("submit", createPlan);
    $("social-platform-refresh").addEventListener("click", () => refreshPlatforms().catch(error => setStatus(error.message)));
    $("social-research-plan-confirm").addEventListener("click", confirmAndRun);
    $("social-research-pause").addEventListener("click", togglePause);
    $("social-research-cancel").addEventListener("click", cancelTask);
    $("social-research-save-selection").addEventListener("click", saveSelection);
    $("social-platform-cards").addEventListener("click", event => {
      const button = event.target.closest("[data-social-action]");
      if (button) platformAction(button.dataset.socialAction, button.dataset.platform).catch(error => { const node = document.querySelector(`[data-platform-error="${button.dataset.platform}"]`); if (node) node.textContent = `最近错误：${error.message}`; });
    });
    ["social-filter-platform", "social-filter-query", "social-filter-evidence", "social-filter-saved", "social-filter-from", "social-filter-to"].forEach(id => $(id).addEventListener("change", () => renderResults(currentTask())));
    $("social-research-results-list").addEventListener("change", event => {
      if (!event.target.matches("[data-save-result]")) return;
      const task = currentTask(); if (!task) return;
      const selected = new Set(selectedResultIds);
      if (event.target.checked) selected.add(event.target.dataset.saveResult); else selected.delete(event.target.dataset.saveResult);
      selectedResultIds = selected;
      $("social-research-save-selection").disabled = currentTask()?.status !== "awaiting-save" || selected.size === 0;
    });
    $("social-research-report-content").addEventListener("click", event => {
      const link = event.target.closest("[data-report-result]");
      if (link) { const target = document.getElementById(`social-result-${link.dataset.reportResult}`); target?.scrollIntoView({ behavior: "smooth", block: "center" }); }
    });
    refreshPlatforms().catch(error => setStatus(`平台列表读取失败：${error.message}`));
    render();
    return {
      refreshPlatforms,
      render,
      getActiveTaskId: () => activeTaskId,
      async createPlanFromPromptAgent(input = {}) {
        const task = await coordinator.createPlan({
          topic: String(input.topic || input.objective || '').trim(),
          template: 'fact-check',
          platforms: Array.isArray(input.platforms) ? input.platforms : ['reddit', 'youtube'],
          queries: Array.isArray(input.queries) ? input.queries : [],
          budget: input.budget && typeof input.budget === 'object' ? input.budget : undefined,
          connectionModes: {}
        });
        activeTaskId = task.id;
        selectedResultIds.clear();
        render();
        setStatus('提示词 Agent 已转交研究目标；请检查社媒研究计划和预算并确认。');
        return task;
      }
    };
  }
})(typeof globalThis === "undefined" ? this : globalThis);
