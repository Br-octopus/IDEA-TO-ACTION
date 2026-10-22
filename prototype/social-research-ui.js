(function exposeSocialResearchUI(root) {
  const schema = typeof module === "object" && module.exports
    ? require("./social-research-schema.js")
    : root.ForwardStepSocialResearchSchema;
  const api = { createSocialResearchUI, filterResearchResults, getPlatformSearchLabel, getPlatformBrowserStatusLabel, isPlatformConnectionReady, listSelectableResearchPlatforms, listVisiblePlatformCards, usesOnlyDomesticPlatforms };
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

  function listSelectableResearchPlatforms(platforms) {
    return (Array.isArray(platforms) ? platforms : []).filter(platform => platform?.market === "domestic");
  }

  function listVisiblePlatformCards(platforms) {
    return listSelectableResearchPlatforms(platforms);
  }

  function usesOnlyDomesticPlatforms(task, platforms) {
    const selected = Array.isArray(task?.platforms) ? task.platforms : [];
    return selected.length > 0 && selected.every(platform =>
      (Array.isArray(platforms) ? platforms : []).some(item => item?.platform === platform && item.market === "domestic")
    );
  }

  function getPlatformSearchLabel(platform) {
    if (platform?.supportsSearch !== true) return "待检查";
    return platform.searchVerified === true ? "可用" : "已接入，真实站点待实测";
  }

  function getPlatformBrowserStatusLabel(platform, status) {
    return ({ ready: "页面可读取，可尝试搜索", "api-available": "API 可用", "not-ready": "尚未准备", "needs-recheck": "需要检查", expired: "会话已过期", restricted: "访问受限", closed: "浏览器已关闭", failed: "检查失败", error: "检查失败", "adapter-error": "页面读取失败", "manual-verification": "等待人工验证", checking: "检查中" })[status] || status || "需要检查";
  }

  function isPlatformConnectionReady(connection, mode, profileId) {
    const apiReady = connection?.apiConfigured === true;
    const browserReady = connection?.profileId === profileId
      && connection?.checked === true && connection?.browserReady === true
      && connection?.status === "ready" && connection?.browserStatus === "ready";
    if (mode === "api") return apiReady;
    if (mode === "browser") return browserReady;
    return mode === "auto" && (apiReady || browserReady);
  }

  function createSocialResearchUI({ document, desktopApi, coordinator, getState, persistState }) {
    if (!document || !desktopApi?.social || !coordinator) throw new TypeError("研究 UI 需要 document、desktopApi.social 和 coordinator");
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    const names = { xiaohongshu: "小红书", bilibili: "哔哩哔哩", weibo: "微博", zhihu: "知乎", reddit: "Reddit", youtube: "YouTube" };
    let platforms = [];
    const connectionSlots = new Map();
    let activeTaskId = "";
    let checking = new Set();
    let running = false;
    let paused = false;
    let cancellationRequested = false;
    let reportGenerating = false;
    let liveProgress = null;
    let selectedResultIds = new Set();
    const newConnectionModes = {};

    function profileId(platform, task = currentTask()) { return schema.resolveResearchProfileId(platform, task?.profileId); }
    function connectionSlotKey(platform, id) { return platform + "\u0000" + id; }
    function persistedConnectionKey(platform, id) {
      const encodedId = [...String(id)].map(character => character.charCodeAt(0).toString(16).padStart(4, "0")).join("");
      return platform + "::profile-" + encodedId;
    }
    function connectionForProfile(item, id) {
      const saved = connectionSlots.get(connectionSlotKey(item.platform, id));
      if (saved) return saved;
      const legacy = item.connection || {};
      const defaultId = schema.resolveResearchProfileId(item.platform, "");
      if (id === defaultId && (!legacy.profileId || legacy.profileId === id)) {
        return {
          ...legacy, profileId: id, status: "needs-recheck", browserStatus: "needs-recheck",
          browserReady: false, browserPrepared: false
        };
      }
      return {
        profileId: id, apiConfigured: legacy.apiConfigured === true, status: "needs-recheck", browserStatus: "needs-recheck",
        loginState: "unknown", searchVerified: false, checked: false,
        browserReady: false, browserPrepared: false
      };
    }
    function storeConnection(item, id, connection) {
      const stored = { ...connection, platform: item.platform, profileId: id };
      connectionSlots.set(connectionSlotKey(item.platform, id), stored);
      return stored;
    }
    function connectionForTask(item, task = currentTask()) {
      return connectionForProfile(item, profileId(item.platform, task));
    }
    function selectedConnectionMode(platform, task = currentTask()) {
      return document.querySelector(`[data-connection-mode="${platform}"]`)?.value
        || task?.connectionModes?.[platform] || newConnectionModes[platform] || "auto";
    }
    function areTaskPlatformsReady(task) {
      return Boolean(task?.platforms?.length) && task.platforms.every(platform => {
        const item = platforms.find(entry => entry.platform === platform);
        return isPlatformConnectionReady(item && connectionForTask(item, task), selectedConnectionMode(platform, task), profileId(platform, task));
      });
    }
    function selectedPlatforms() { return [...document.querySelectorAll("[data-social-platform]:checked")].map(input => input.value); }
    function currentTask() { return (getState()?.researchTasks || []).find(task => task.id === activeTaskId) || null; }
    function renderResearchHistory() {
      const history = $("social-research-history");
      if (!history) return;
      const tasks = [...(getState()?.researchTasks || [])].sort((left, right) =>
        String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
      );
      history.innerHTML = `<option value="">开始新研究</option>${tasks.map(task => {
        const created = task.createdAt ? new Date(task.createdAt).toLocaleDateString("zh-CN") : "日期未知";
        return `<option value="${escape(task.id)}">${escape(task.topic || "未命名研究")} · ${escape(created)} · ${escape(task.status || "未知状态")}</option>`;
      }).join("")}`;
      history.value = activeTaskId;
      history.disabled = running;
    }
    function persistConnections() {
      if (typeof persistState !== "function") return;
      const state = getState() || {};
      const platformConnections = { ...(state.platformConnections || {}) };
      for (const [key, connection] of connectionSlots) {
        const separator = key.indexOf("\u0000");
        const platform = key.slice(0, separator);
        const id = key.slice(separator + 1);
        const defaultId = schema.resolveResearchProfileId(platform, "");
        const saved = { ...connection, platform, profileId: id };
        if (id === defaultId) platformConnections[platform] = saved;
        else platformConnections[persistedConnectionKey(platform, id)] = saved;
      }
      persistState({ ...state, platformConnections });
    }
    function renderPlatformChoices() {
      const domesticPlatforms = listSelectableResearchPlatforms(platforms);
      $("social-research-platforms").innerHTML = domesticPlatforms.map(item => `<label class="social-platform"><span class="social-inline-check"><input type="checkbox" data-social-platform value="${escape(item.platform)}" checked> <strong>${escape(item.displayName || names[item.platform] || item.platform)}</strong></span><span class="social-meta">${item.apiAvailable ? "API 支持" : "浏览器搜索 · 登录要求以站点为准"}</span></label>`).join("");
      const knownPlatforms = [...new Set([
        ...platforms.map(item => item.platform),
        ...(getState()?.researchTasks || []).flatMap(task => (task.results || []).map(result => result.platform))
      ].filter(Boolean))];
      const options = `<option value="">全部平台</option>${knownPlatforms.map(platform => `<option value="${escape(platform)}">${escape(names[platform] || platforms.find(item => item.platform === platform)?.displayName || platform)}</option>`).join("")}`;
      $("social-filter-platform").innerHTML = options;
      renderPlatformCards();
    }

    function renderPlatformCards() {
      const task = currentTask();
      const visiblePlatforms = listVisiblePlatformCards(platforms);
      $("social-platform-cards").innerHTML = visiblePlatforms.map(item => {
        const connection = connectionForTask(item, task);
        const status = checking.has(connectionSlotKey(item.platform, profileId(item.platform, task))) ? "checking"
          : connection.checked === true ? connection.browserStatus || connection.status : "needs-recheck";
        const apiStatus = connection.apiConfigured === true ? "已配置" : item.apiAvailable ? "支持，未配置" : "不支持";
        const capabilities = { ...item, searchVerified: item.searchVerified === true && connection.searchVerified === true };
        const loginState = ({ "logged-in": "已登录", authenticated: "已登录", "logged-out": "未登录", "login-required": "需要登录", required: "需要登录", expired: "登录已过期", unknown: "未知" })[connection.loginState] || "未知";
        const lastError = connection.error || connection.lastError || "";
        const errorCode = connection.code || connection.lastErrorCode || "";
        const checkHistory = connection.lastCheckedAt || connection.checkedAt || "尚未检查";
        const searchHistory = connection.lastSuccessfulSearchAt || "尚无成功记录";
        const stateText = getPlatformBrowserStatusLabel(item, status);
        const loginLabel = "打开浏览器 / 登录";
        const actionDisabled = running || checking.has(connectionSlotKey(item.platform, profileId(item.platform, task)));
        return `<article class="social-platform" data-platform-card="${escape(item.platform)}"><header><div><h3>${escape(item.displayName || names[item.platform] || item.platform)}</h3><div class="social-meta">API：${apiStatus} · 浏览器：${escape(stateText)} · 登录：${escape(loginState)}</div></div><label class="social-muted">连接方式 <select data-connection-mode="${escape(item.platform)}" ${task || running ? "disabled" : ""}><option value="auto">自动选择</option><option value="api" ${item.apiAvailable ? "" : "disabled"}>只用 API</option><option value="browser">真实浏览器</option></select></label></header><div class="social-meta">能力：搜索 ${escape(getPlatformSearchLabel(capabilities))} · 详情 ${capabilities.supportsDetail ? "可用" : "不支持"} · 评论 ${capabilities.supportsComments ? "可用" : "不支持"} · 只读</div><div class="social-tools"><button class="button-secondary" type="button" data-social-action="login" data-platform="${escape(item.platform)}" ${actionDisabled ? "disabled" : ""}>${loginLabel}</button><button class="button-secondary" type="button" data-social-action="check" data-platform="${escape(item.platform)}" ${actionDisabled ? "disabled" : ""}>检查平台</button><button class="button-quiet" type="button" data-social-action="clear" data-platform="${escape(item.platform)}" ${actionDisabled ? "disabled" : ""}>清理 profile</button></div><div class="social-meta" data-platform-error="${escape(item.platform)}">${escape(lastError ? `最近错误：${errorCode ? `${errorCode}：` : ""}${lastError}` : "最近错误：无")}</div><div class="social-meta">最近检查：${escape(checkHistory)} · 最近搜索成功：${escape(searchHistory)}${connection.message ? ` · 检查说明：${escape(connection.message)}` : ""}</div></article>`;
      }).join("");
      visiblePlatforms.forEach(item => { const select = document.querySelector(`[data-connection-mode="${item.platform}"]`); if (select) select.value = task?.connectionModes?.[item.platform] || newConnectionModes[item.platform] || "auto"; });
    }

    function setStatus(message) { $("social-research-status").textContent = message; }
    function renderPlan(task) {
      if (!task) {
        $("social-research-plan-detail").textContent = "等待生成计划";
        $("social-research-plan-confirm").disabled = true;
        $("social-research-pause").disabled = true;
        $("social-research-cancel").disabled = true;
        return;
      }
      const plan = task.plan || {};
      $("social-research-plan-detail").innerHTML = `<h3>${escape(plan.objective || task.topic)}</h3><p>模板：${escape(plan.researchType || task.template)} · 平台：${(task.platforms || []).map(platform => escape(names[platform] || platform)).join("、")}</p><p>平台分工：${(plan.platformRoles || []).map(role => `${escape(names[role.platform] || role.platform)}：${escape(role.role)}（${(role.queries || []).map(escape).join("、")}）`).join("；")}</p><p>查询词：${(plan.queries || task.queries || []).map(escape).join("、") || "待生成"} · 时间：${escape(plan.timeRange?.from || "不限")} 至 ${escape(plan.timeRange?.to || "不限")}</p><p>预算：最多 ${escape(plan.budget?.maxPlatforms)} 个平台、每平台 ${escape(plan.budget?.maxQueriesPerPlatform)} 个查询、${escape(plan.budget?.maxPages)} 页、${escape(plan.budget?.maxDetails)} 条详情。停止条件：${(plan.stopConditions || []).map(escape).join("；")}</p>`;
      const ready = areTaskPlatformsReady(task);
      const domesticTask = usesOnlyDomesticPlatforms(task, platforms);
      $("social-research-plan-confirm").disabled = task.status !== "awaiting-plan-confirmation" || !ready || !domesticTask || running;
      $("social-research-pause").disabled = !running || cancellationRequested || reportGenerating;
      $("social-research-pause").textContent = paused ? "继续" : "暂停";
      $("social-research-cancel").disabled = cancellationRequested || !["awaiting-plan-confirmation", "awaiting-platform-preparation", "searching"].includes(task.status);
      if (running && reportGenerating) {
        $("social-research-progress-detail").textContent = "正在生成报告；取消将在当前模型请求完成后生效";
      } else if (running && liveProgress) {
        const platform = names[liveProgress.platform] || liveProgress.platform || "";
        const mode = { auto: "自动回退", api: "API", browser: "真实浏览器" }[liveProgress.mode] || liveProgress.mode || "待确定";
        $("social-research-progress-detail").textContent = `${paused ? "已暂停新增请求；在途请求可能完成并计入预算" : "执行中"} · ${platform} · ${mode} · 查询：${liveProgress.query || "等待查询"} · 已收集 ${liveProgress.resultCount || 0} 条`;
      }
      if (!running) $("social-research-progress-detail").textContent = "";
      if (!domesticTask && !running) setStatus("该历史任务的平台目前仅保留查看；新建研究仅提供国内社媒平台。");
      else if (task.status === "partial-failure" && task.reportError) setStatus(`研究未完成：${task.reportErrorCode ? `${task.reportErrorCode}：` : ""}${task.reportError}`);
      else if (!running && !["cancelled", "awaiting-save", "partial-failure", "failed"].includes(task.status)) setStatus(`${task.status}${ready ? " · 可尝试搜索，搜索能力仍以实测为准" : " · 先检查所选平台"}`);
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

    function render() { const task = currentTask(); renderResearchHistory(); renderPlatformCards(); renderPlan(task); renderResults(task); renderReport(task); }
    async function refreshPlatforms() {
      if (typeof desktopApi.social.listPlatforms !== "function") throw new Error("当前桌面 API 不支持平台列表");
      const definitions = await desktopApi.social.listPlatforms();
      const restored = schema.sanitizeResearchState({ platformConnections: getState()?.platformConnections }).platformConnections;
      const restoredSlots = new Map();
      for (const [savedKey, connection] of Object.entries(restored)) {
        const separator = savedKey.indexOf("::");
        const platform = separator < 0 ? savedKey : savedKey.slice(0, separator);
        const defaultId = schema.resolveResearchProfileId(platform, "");
        const id = connection.profileId || defaultId;
        if (separator >= 0 && !connection.profileId) continue;
        const restoredConnection = {
          ...connection, platform, profileId: id,
          status: "needs-recheck", browserStatus: "needs-recheck",
          checked: false, browserReady: false, browserPrepared: false
        };
        restoredSlots.set(connectionSlotKey(platform, id), restoredConnection);
      }
      for (const [key, connection] of restoredSlots) {
        if (!connectionSlots.has(key)) connectionSlots.set(key, connection);
      }
      platforms = (Array.isArray(definitions) ? definitions : definitions?.platforms || []).map(item => {
        const live = platforms.find(entry => entry.platform === item.platform);
        return live ? Object.assign(live, item) : { ...item, connection: {} };
      });
      renderPlatformChoices();
      renderPlan(currentTask());
    }
    async function platformAction(action, platform) {
      const item = platforms.find(entry => entry.platform === platform);
      if (!item || !["login", "check", "clear"].includes(action)) return;
      const id = profileId(platform);
      const slotKey = connectionSlotKey(platform, id);
      if (checking.has(slotKey)) return;
      const isCurrentProfile = () => id === profileId(platform);
      checking.add(slotKey);
      // 动作开始时只清理当前 profile 的准备状态，异步结果也只写回这个槽位。
      const previousConnection = connectionForProfile(item, id);
      storeConnection(item, id, {
        ...previousConnection,
        status: action === "check" ? "checking" : "needs-recheck",
        browserStatus: action === "check" ? "checking" : "needs-recheck",
        browserReady: false, browserPrepared: false, checked: false,
        loginState: "unknown", searchVerified: false, error: "", message: "", code: ""
      });
      try {
        persistConnections();
        render();
        if (action === "login") {
          const result = await desktopApi.social.openLogin(platform, id);
          if (!["ok", "ready", "opening", "opened"].includes(result?.status)) {
            throw Object.assign(new Error(result?.message || "无法打开浏览器窗口"), { code: result?.code, category: result?.status });
          }
          storeConnection(item, id, { ...connectionForProfile(item, id), browserStatus: "not-ready" });
          persistConnections();
          if (isCurrentProfile()) setStatus((names[platform] || platform) + " 浏览器已打开；请按站点要求完成登录或验证，再点击检查平台。");
        } else if (action === "check") {
          const [status, checked] = await Promise.all([desktopApi.social.getStatus(platform), desktopApi.social.check(platform, id)]);
          const browserReady = ["ok", "ready"].includes(checked?.status) && checked?.ready === true
            && (!checked.browserStatus || checked.browserStatus === "ready");
          const checkedAt = checked?.checkedAt || new Date().toISOString();
          const code = checked?.code || "";
          const message = checked?.message || "";
          const failedStatus = checked?.browserStatus && checked.browserStatus !== "ready"
            ? checked.browserStatus
            : checked?.status && !["ok", "ready"].includes(checked.status)
              ? checked.status
              : checked?.errorCategory || checked?.lastErrorCategory || "not-ready";
          const connectionStatus = browserReady ? "ready" : failedStatus;
          const currentConnection = connectionForProfile(item, id);
          storeConnection(item, id, {
            ...currentConnection, status: connectionStatus, browserStatus: connectionStatus,
            apiConfigured: status?.apiConfigured === true,
            browserReady, browserPrepared: browserReady, checked: true,
            loginState: typeof checked?.loginState === "string" ? checked.loginState : "unknown",
            searchVerified: item.searchVerified === true && checked?.searchVerified === true,
            checkedAt, lastCheckedAt: checkedAt,
            lastSuccessfulSearchAt: checked?.lastSuccessfulSearchAt || currentConnection.lastSuccessfulSearchAt || "",
            message, code, lastErrorCode: code,
            lastErrorCategory: browserReady ? "" : checked?.lastErrorCategory || checked?.errorCategory || code || failedStatus,
            error: browserReady ? "" : message || "平台尚未准备好",
            lastError: browserReady ? "" : message || "平台尚未准备好"
          });
          persistConnections();
          if (isCurrentProfile()) {
            const detail = browserReady ? "页面可读取，可尝试搜索；真实搜索仍待实测" : message || "尚未准备好";
            setStatus((names[platform] || platform) + "：" + detail + (code ? "（" + code + "）" : "") + (status?.apiConfigured === true ? "，API 已配置" : ""));
          }
        } else {
          const result = await desktopApi.social.clearProfile(platform, id);
          if (!["ok", "cleared"].includes(result?.status)) {
            throw Object.assign(new Error(result?.message || "清理 profile 失败"), { code: result?.code, category: result?.status });
          }
          storeConnection(item, id, { ...connectionForProfile(item, id), browserStatus: "needs-recheck" });
          persistConnections();
          if (isCurrentProfile()) setStatus((names[platform] || platform) + " 独立 profile 已清理，需要重新检查。");
        }
      } catch (error) {
        const checkedAt = new Date().toISOString();
        const failureStatus = error.category || error.status || "error";
        storeConnection(item, id, {
          ...connectionForProfile(item, id), status: failureStatus, browserStatus: failureStatus,
          browserReady: false, browserPrepared: false, checked: action === "check",
          loginState: "unknown", searchVerified: false,
          ...(action === "check" ? { checkedAt, lastCheckedAt: checkedAt } : {}),
          message: error.message || "平台操作失败", error: error.message || "平台操作失败",
          lastError: error.message || "平台操作失败", code: error.code || "", lastErrorCode: error.code || "",
          lastErrorCategory: error.category || error.code || failureStatus
        });
        persistConnections();
        if (isCurrentProfile()) setStatus((names[platform] || platform) + "：" + (error.code ? error.code + "：" : "") + (error.message || "平台操作失败"));
      } finally {
        checking.delete(slotKey);
        render();
      }
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
      if (!usesOnlyDomesticPlatforms(task, platforms)) { setStatus("该历史任务仅保留查看；新建研究仅提供国内社媒平台。"); return; }
      if (!task || task.status !== "awaiting-plan-confirmation" || running || !areTaskPlatformsReady(task)) {
        setStatus("请先按所选连接方式检查所有平台；API 模式需要已配置 API，浏览器模式需要当前 profile 检查通过。"); return;
      }
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
        setStatus(result.status === "cancelled" ? "已取消：已停止新增请求，保留已完成材料和已用预算。" : `研究结束：${result.status} · ${result.results?.length || 0} 条结果${Object.keys(result.platformErrors || {}).length ? " · 部分平台未完成" : ""}`);
      } catch (error) { running = false; paused = false; cancellationRequested = false; reportGenerating = false; render(); setStatus(error.message || "研究执行失败"); }
    }
    function cancelTask() {
      const task = currentTask();
      if (!task) return;
      try {
        coordinator.cancel(task.id);
        if (running) { cancellationRequested = true; render(); setStatus(reportGenerating
          ? "正在生成报告；取消将在当前模型请求完成后生效，保留已完成材料和已用预算，当前报告返回后丢弃。"
          : "已请求取消，将在当前平台/查询请求完成后生效；保留已完成材料和已用预算，当前请求晚到结果将丢弃。"); }
        else { render(); setStatus("研究计划已取消，未开始搜索。"); }
      }
      catch (error) { setStatus(error.message || "当前阶段不能取消"); }
    }
    function togglePause() {
      const task = currentTask();
      if (!task || !running || cancellationRequested) return;
      try {
        if (paused) { coordinator.resume(task.id); paused = false; setStatus("已继续研究。"); }
        else { coordinator.pause(task.id); paused = true; setStatus("已暂停新增请求；在途请求可能完成并计入预算，随后等待继续。"); }
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
    $("social-research-history")?.addEventListener("change", event => {
      if (running) { event.target.value = activeTaskId; return; }
      activeTaskId = event.target.value;
      const task = currentTask();
      selectedResultIds = new Set(task?.selectedResultIds || []);
      render();
    });
    $("social-platform-refresh").addEventListener("click", () => refreshPlatforms().catch(error => setStatus(error.message)));
    $("social-research-plan-confirm").addEventListener("click", confirmAndRun);
    $("social-research-pause").addEventListener("click", togglePause);
    $("social-research-cancel").addEventListener("click", cancelTask);
    $("social-research-save-selection").addEventListener("click", saveSelection);
    $("social-platform-cards").addEventListener("change", event => {
      if (!event.target.matches("[data-connection-mode]")) return;
      if (!currentTask()) newConnectionModes[event.target.dataset.connectionMode] = event.target.value;
      renderPlan(currentTask());
    });
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
    return { refreshPlatforms, render, getActiveTaskId: () => activeTaskId };
  }
})(typeof globalThis === "undefined" ? this : globalThis);
