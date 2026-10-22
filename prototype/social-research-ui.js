(function exposeSocialResearchUI(root) {
  const DOMESTIC_PLATFORM_IDS = new Set(["xiaohongshu", "bilibili", "weibo", "zhihu"]);
  const schema = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./social-research-schema.js")
    : root.ForwardStepSocialResearchSchema;
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

  function createSocialResearchUI({ document, desktopApi, coordinator, getState, persistState,
    confirmAction = message => typeof root.confirm === "function" && root.confirm(message) }) {
    if (!document || !desktopApi?.social || !coordinator) throw new TypeError("研究 UI 需要 document、desktopApi.social 和 coordinator");
    const $ = id => document.getElementById(id);
    const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    const names = { xiaohongshu: "小红书", bilibili: "B 站", weibo: "微博", zhihu: "知乎", reddit: "Reddit", youtube: "YouTube" };
    let platforms = [];
    let registeredSocialSource = null;
    let socialSourceCatalog = [];
    let socialSourceVersions = null;
    let sourceVersionOperationRunning = false;
    let socialSourceEnvironment = null;
    let sourceProgress = null;
    let sourceFailure = null;
    let sourceOperationId = "";
    const sourceRuntimeStates = new Map();
    const loginErrors = new Map();
    let sourceEnvironmentChecking = false;
    let sourcePreparationRunning = false;
    let sourceDiagnostics = [];
    let sourceDiagnosticsExpanded = false;
    let sourceProfilePlatform = "bilibili";
    let activeTaskId = (getState()?.researchTasks || []).find(task => task?.status === "searching")?.id || "";
    let checking = new Set();
    let running = false;
    let deepReadRunning = false;
    let paused = false;
    let cancellationRequested = false;
    let reportGenerating = false;
    let liveProgress = null;
    let selectedResultIds = new Set();
    let selectedDeepResultIds = new Set();
    let selectedMaterialIds = new Set();
    let expandedMaterialIds = new Set();
    let materialSaveRunning = false;

    function profileId(platform) { return schema.resolveResearchProfileId(platform, currentTask()?.profileId); }
    function runtimeStateKey(platform, targetProfileId) { return JSON.stringify([platform, targetProfileId]); }
    function selectedRuntimeState(platform = sourceProfilePlatform, targetProfileId = profileId(platform)) {
      return sourceRuntimeStates.get(runtimeStateKey(platform, targetProfileId)) || "unknown";
    }
    function setRuntimeState(platform, targetProfileId, state) {
      sourceRuntimeStates.set(runtimeStateKey(platform, targetProfileId), state);
    }
    function domesticPlatforms() { return platforms.filter(item => item.domestic === true && DOMESTIC_PLATFORM_IDS.has(item.platform)); }
    function selectedPlatforms() { return [...document.querySelectorAll("[data-social-platform]:checked")].map(input => input.value); }
    function currentTask() { return (getState()?.researchTasks || []).find(task => task.id === activeTaskId) || null; }
    function researchIsBusy() {
      const task = currentTask();
      return running || deepReadRunning || reportGenerating
        || task?.status === "searching";
    }
    async function beginResearchLease() {
      const begin = desktopApi.socialSource?.beginResearchOperation;
      if (typeof begin !== "function") return null;
      const result = await begin();
      if (result?.status !== "ok" || typeof result.leaseId !== "string") {
        throw Object.assign(new Error(result?.message || "无法锁定来源版本：研究任务可能正在运行。"), { code: result?.code });
      }
      return result.leaseId;
    }
    async function endResearchLease(leaseId) {
      if (!leaseId || typeof desktopApi.socialSource?.endResearchOperation !== "function") return;
      try { await desktopApi.socialSource.endResearchOperation(leaseId); }
      catch (error) { setStatus(error?.message || "研究占用状态释放失败；关闭或重启应用后会自动清理。"); }
    }
    function browserIsPrepared(connection) {
      return connection?.checked === true && connection?.browserReady === true && connection?.browserPrepared === true;
    }
    function platformIsPrepared(task, platform) {
      const definition = platforms.find(item => item.platform === platform);
      const connection = definition?.connection || {};
      const mode = task?.connectionModes?.[platform] || "auto";
      if (mode === "api") return definition?.apiAvailable === true && connection.apiConfigured === true;
      if (mode === "browser") return browserIsPrepared(connection);
      return (definition?.apiAvailable === true && connection.apiConfigured === true) || browserIsPrepared(connection);
    }
    function allPlatformsPrepared(task) {
      return Boolean(task && Array.isArray(task.platforms) && task.platforms.length
        && task.platforms.every(platform => platformIsPrepared(task, platform)));
    }
    function resetPreparation(connection, overrides = {}) {
      return {
        ...connection,
        status: "needs-recheck",
        browserStatus: "needs-recheck",
        browserReady: false,
        browserPrepared: false,
        checked: false,
        ...overrides
      };
    }
    function loginLabel(loginState) {
      return ({
        "logged-in": "已登录",
        "logged-out": "未登录",
        "login-required": "需要登录",
        restricted: "受限",
        unknown: "未知"
      })[loginState] || "未知";
    }
    function persistConnections() {
      if (typeof persistState !== "function") return;
      const state = getState() || {};
      persistState({ ...state, platformConnections: { ...(state.platformConnections || {}), ...Object.fromEntries(platforms.map(platform => [platform.platform, platform.connection || {}])) } });
    }

    function renderPlatformChoices() {
      $("social-research-platforms").innerHTML = domesticPlatforms().map(item => {
        const available = item.browserSearchRegistered === true && item.supportsSearch === true;
        const verified = item.connection?.profileId === profileId(item.platform) && item.connection?.searchVerified === true;
        return `<label class="social-platform"><span class="social-inline-check"><input type="checkbox" data-social-platform value="${escape(item.platform)}" ${available ? "checked" : "disabled"}> <strong>${escape(item.displayName || names[item.platform] || item.platform)}</strong></span><span class="social-meta">浏览器搜索适配器：${available ? "已注册" : "不可用"} · 实测：${verified ? "已验证" : "待实测"}</span></label>`;
      }).join("");
      const options = `<option value="">全部平台</option>${platforms.map(item => `<option value="${escape(item.platform)}">${escape(item.displayName || names[item.platform] || item.platform)}</option>`).join("")}`;
      $("social-filter-platform").innerHTML = options;
      renderPlatformCards();
    }

    function renderPlatformCards() {
      const task = currentTask();
      $("social-platform-cards").innerHTML = domesticPlatforms().map(item => {
        const connection = item.connection || {};
        const status = connection.browserStatus || connection.status || "needs-recheck";
        const apiStatus = !item.apiAvailable ? "未接入" : connection.apiConfigured ? "已配置" : "支持，未配置";
        const capabilities = connection.capabilities || {};
        const stateText = { ready: "浏览器已打开", "api-available": "API 已配置", "not-ready": "未准备", "needs-recheck": "待检查", expired: "登录已过期", restricted: "访问受限", closed: "浏览器已关闭", failed: "检查失败", "adapter-error": "页面读取失败", "manual-verification": "需人工验证", error: "检查失败", checking: "检查中" }[status] || "待检查";
        const verificationText = connection.profileId === profileId(item.platform) && connection.searchVerified === true ? "已验证" : "待实测";
        const searchAdapter = item.browserSearchRegistered === true ? "已注册" : "不可用";
        const searchSupported = item.browserSearchRegistered === true && item.supportsSearch === true;
        return `<article class="social-platform" data-platform-card="${escape(item.platform)}"><header><div><h3>${escape(item.displayName || names[item.platform] || item.platform)}</h3><div class="social-meta">API：${apiStatus} · 浏览器：${escape(stateText)} · 登录：${escape(loginLabel(connection.loginState))}</div></div><label class="social-muted">连接方式 <select data-connection-mode="${escape(item.platform)}"><option value="auto">自动回退</option>${item.apiAvailable ? '<option value="api">只用 API</option>' : ""}<option value="browser" ${searchSupported ? "" : "disabled"}>真实浏览器</option></select></label></header><div class="social-meta">浏览器搜索适配器：${searchAdapter} · 实测：${verificationText} · 能力：搜索 ${searchSupported ? "已注册" : "不可用"} · 详情 ${capabilities.supportsDetail || connection.supportsDetail ? "可用" : "未知"} · 评论 ${capabilities.supportsComments || connection.supportsComments ? "可用" : "未知"} · 只读</div><div class="social-meta">最近检查：${escape(connection.lastCheckedAt || connection.checkedAt || "无记录")} · 最近成功搜索：${escape(connection.lastSuccessfulSearchAt || "无记录")}</div><div class="social-tools"><button class="button-secondary" type="button" data-social-action="login" data-platform="${escape(item.platform)}">开始登录</button><button class="button-secondary" type="button" data-social-action="check" data-platform="${escape(item.platform)}" ${checking.has(item.platform) ? "disabled" : ""}>重新检查</button><button class="button-quiet" type="button" data-social-action="clear" data-platform="${escape(item.platform)}">清理 profile</button></div><div class="social-meta" data-platform-error="${escape(item.platform)}">${escape(connection.lastErrorCode ? `[${connection.lastErrorCode}] ` : "")}${escape(connection.error || connection.lastError || "最近错误：无")}</div></article>`;
      }).join("");
      domesticPlatforms().forEach(item => { const select = document.querySelector(`[data-connection-mode="${item.platform}"]`); if (select) select.value = task?.connectionModes?.[item.platform] || "auto"; });
    }

    function setStatus(message) { $("social-research-status").textContent = message; }
    function renderPlan(task) {
      if (!task) { $("social-research-plan-detail").textContent = "等待生成计划"; return; }
      const plan = task.plan || {};
      $("social-research-plan-detail").innerHTML = `<h3>${escape(plan.objective || task.topic)}</h3><p>模板：${escape(plan.researchType || task.template)} · 平台：${(task.platforms || []).map(platform => escape(names[platform] || platform)).join("、")}</p><p>平台分工：${(plan.platformRoles || []).map(role => `${escape(names[role.platform] || role.platform)}：${escape(role.role)}（${(role.queries || []).map(escape).join("、")}）`).join("；")}</p><p>查询词：${(plan.queries || task.queries || []).map(escape).join("、") || "待生成"} · 时间：${escape(plan.timeRange?.from || "不限")} 至 ${escape(plan.timeRange?.to || "不限")}</p><p>预算：最多 ${escape(plan.budget?.maxPlatforms)} 个平台、每平台 ${escape(plan.budget?.maxQueriesPerPlatform)} 个查询、每查询 ${escape(plan.budget?.maxResultsPerQuery)} 条结果、${escape(plan.budget?.maxPages)} 页、${escape(plan.budget?.maxDetails)} 条详情。停止条件：${(plan.stopConditions || []).map(escape).join("；")}</p>`;
      const usage = task.usage || {};
      $("social-research-plan-detail").innerHTML += `<p>模型 token：已用 ${escape(usage.analysisTokens || 0)} / ${escape(task.budget?.maxAnalysisTokens || plan.budget?.maxAnalysisTokens || 0)}${usage.analysisTokensEstimated ? "（部分为保守估算）" : "（模型返回用量）"}</p>${task.planError ? `<p class="social-muted">计划生成提醒：${escape(task.planErrorCode ? `[${task.planErrorCode}] ` : "")}${escape(task.planError)}；可继续检查默认计划并自行确认。</p>` : ""}`;
      const operationLabels = { waiting: "等待执行", running: "运行中", completed: "已完成", failed: "失败", skipped: "已跳过", unknown: "结果未知，等待选择" };
      const operations = task.operations || [];
      $("social-research-operations").innerHTML = operations.length
        ? "<strong>操作队列</strong>" + operations.map(operation => {
          const subject = operation.query || operation.contentId?.noteId || operation.contentId?.bvid || operation.contentId?.aid || "";
          const choices = ["unknown", "failed", "waiting"].includes(operation.state)
            ? '<div class="button-row"><button type="button" class="button-secondary" data-research-operation="retry" data-operation-id="' + escape(operation.operationId) + '">' + (operation.state === "waiting" ? "再次尝试" : "重试") + '</button><button type="button" class="button-quiet" data-research-operation="skip" data-operation-id="' + escape(operation.operationId) + '">跳过</button></div>' : "";
          const cursorWarning = operation.cursorInvalid ? '<div class="social-muted">来源游标已失效，重查后顺序可能变化，结果将按平台内容 ID 去重。</div>' : "";
          return '<article class="social-result"><div><strong>' + escape(names[operation.platform] || operation.platform) + " · " + escape(operation.capability || "操作") + '</strong><div class="social-meta">' + escape(subject) + " · 尝试 " + escape(operation.attempt) + " · ID " + escape(operation.operationId) + '</div><div>' + escape(operationLabels[operation.state] || operation.state) + (operation.summary ? " · " + escape(operation.summary) : "") + (operation.errorMessage ? " · " + escape(operation.errorMessage) : "") + '</div>' + cursorWarning + '</div>' + choices + '</article>';
        }).join("")
        : "";
      const ready = allPlatformsPrepared(task);
      $("social-research-plan-confirm").disabled = task.status !== "awaiting-plan-confirmation" || !ready || running;
      $("social-research-pause").disabled = !running || cancellationRequested || reportGenerating;
      $("social-research-pause").textContent = paused ? "继续" : "暂停";
      $("social-research-cancel").disabled = cancellationRequested
        || !(running || deepReadRunning || reportGenerating)
          && !["awaiting-plan-confirmation", "awaiting-platform-preparation", "searching"].includes(task.status);
      if (running && reportGenerating) {
        $("social-research-progress-detail").textContent = "正在生成报告；在途模型请求可能完成并计费，取消后保留已完成材料。";
      } else if (running && liveProgress) {
        const platform = names[liveProgress.platform] || liveProgress.platform || "";
        const mode = { auto: "自动回退", api: "API", browser: "真实浏览器" }[liveProgress.mode] || liveProgress.mode || "待确定";
        $("social-research-progress-detail").textContent = `${paused ? "已暂停" : "执行中"} · ${platform} · ${mode} · 查询：${liveProgress.query || "等待查询"} · 已收集 ${liveProgress.resultCount || 0} 条`;
      } else if (deepReadRunning) {
        $("social-research-progress-detail").textContent = "正在按所选动作深读；已完成材料会保留，取消后不再发起新请求。";
      }
      if (!running && !deepReadRunning && !reportGenerating) $("social-research-progress-detail").textContent = "";
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
      const materialStatus = { running: "读取中", completed: "已完成", failed: "失败，可重试", cancelled: "已取消", skipped: "已跳过", unavailable: "不可用" };
      $("social-research-results-list").innerHTML = filtered.length ? filtered.map(result => {
        const platformCapabilities = registeredSocialSource?.capabilities?.[result.platform];
        const supportedPlatform = Array.isArray(platformCapabilities)
          && platformCapabilities.some(capability => capability === "detail" || capability === "comments");
        const contentId = schema.resolveDomesticContentId(result);
        const sourceReady = sourceReadyFor(result.platform);
        const unavailableReason = !supportedPlatform ? "当前来源未登记该平台深读"
          : !contentId ? "缺少可校验的平台内容 ID"
            : socialSourceEnvironment?.status !== "ok" ? "深读来源未准备，需安装或检查"
              : !sourceReady ? "来源未登记该平台的详情或评论能力" : "";
        const materials = (result.materials || []).map(material => {
          const transient = coordinator.getTransientMaterial?.(material.id);
          const fullText = transient === undefined ? "" : typeof transient === "string" ? transient : JSON.stringify(transient, null, 2);
          const expanded = expandedMaterialIds.has(material.id) && fullText;
          return `<div class="social-material" id="social-material-${escape(material.id)}"><div><strong>${escape(material.kind === "comments" ? "一级评论" : material.kind === "detail" ? "内容详情" : "字幕")}</strong> · ${escape(materialStatus[material.status] || material.status)} · ${escape(material.sourceId || "unknown")} ${escape(material.sourceVersion || "unknown")}</div><div class="social-meta">材料 ${escape(material.id)} · 数量 ${escape(material.itemCount)} · 排序 ${escape(material.sortOrder || "unknown")} · ${material.truncated ? "已截断" : "未标记截断"} · ${escape(material.capturedAt || "时间未知")}</div>${material.summary ? `<p>${escape(material.summary)}</p>` : ""}${material.errorMessage ? `<p class="social-muted">${escape(material.errorCategory || "source-error")} / ${escape(material.errorCode)}：${escape(material.errorMessage)}</p>` : ""}${material.attachmentId ? `<div class="social-meta">已保存附件：${escape(material.attachmentId)}</div>` : ""}${fullText ? `<button type="button" class="button-quiet" data-toggle-material="${escape(material.id)}">${expanded ? "收起全文" : "查看本次运行全文"}</button>${expanded ? `<pre class="social-material-content">${escape(fullText)}</pre>` : ""}` : material.status === "completed" ? `<span class="social-muted">全文仅保存在本次会话内；重启后需要重新获取，会再次消耗任务预算。</span>` : ""}${material.status === "completed" && fullText && !material.attachmentId ? `<label class="social-inline-check"><input type="checkbox" data-save-material="${escape(material.id)}" ${selectedMaterialIds.has(material.id) ? "checked" : ""}> 保存此全文附件</label>` : ""}</div>`;
        }).join("");
        const transcriptUnavailable = result.platform === "bilibili" ? `<div class="social-muted">字幕：不可用（字幕来源尚未登记；不会用视频简介代替）</div>` : "";
        return `<article class="social-result" id="social-result-${escape(result.id)}"><div><h3>${escape(result.title || "无标题")}</h3><div>${escape(result.summary || result.discussionSummary || "无摘要")}</div><div class="social-meta">${escape(names[result.platform] || result.platform)} · ${escape(result.author || "作者未知")} · ${escape(result.publishedAt || "时间未知")} · ${escape(result.retrievalMethod)} · ${escape(result.evidenceStatus || "unverified")} · 营销风险：${escape(result.marketingRisk || "未知")}</div><div class="social-meta">查询：${(result.searchQueries || []).map(escape).join("、")} · 抓取：${escape(result.capturedAt || "未知")}</div>${result.url ? `<a href="${escape(result.url)}" target="_blank" rel="noreferrer">打开原始来源</a>` : "缺少来源链接"}<div class="social-result-actions"><label class="social-inline-check"><input type="checkbox" data-deep-result="${escape(result.id)}" ${selectedDeepResultIds.has(result.id) ? "checked" : ""} ${unavailableReason || task?.status !== "awaiting-save" || !sourceReady ? "disabled" : ""}> 选择深读</label>${unavailableReason ? `<span class="social-muted">${escape(unavailableReason)}</span>` : ""}${transcriptUnavailable}</div>${materials}</div><label class="social-inline-check"><input type="checkbox" data-save-result="${escape(result.id)}" ${selectedResultIds.has(result.id) || task?.selectedResultIds?.includes(result.id) ? "checked" : ""} ${task?.savedResultIds?.includes(result.id) ? "disabled" : ""}> 保存摘要</label></article>`;
      }).join("") : `<p class="social-muted">${results.length ? "没有符合筛选条件的结果" : "尚无研究结果"}</p>`;
      $("social-research-save-selection").disabled = task?.status !== "awaiting-save" || ![...selectedResultIds].some(id => !task.savedResultIds?.includes(id));
      const canDeepRead = action => task?.status === "awaiting-save" && !deepReadRunning && !running
        && [...selectedDeepResultIds].some(id => {
          const result = results.find(item => item.id === id);
          return result && schema.resolveDomesticContentId(result) && sourceReadyFor(result.platform, action);
        });
      $("social-research-read-details").disabled = !canDeepRead("detail");
      $("social-research-read-comments").disabled = !canDeepRead("comments");
      $("social-research-save-materials").disabled = materialSaveRunning || task?.status !== "awaiting-save" || ![...selectedMaterialIds].some(id => coordinator.getTransientMaterial?.(id) !== undefined);
    }

    function sourceReadyFor(platform, action) {
      if (socialSourceEnvironment?.status !== "ok") return false;
      const capabilities = registeredSocialSource?.capabilities?.[platform];
      if (!Array.isArray(capabilities)) return false;
      return action ? capabilities.includes(action) : capabilities.some(item => item === "detail" || item === "comments");
    }

    function renderReport(task) {
      const hasCompletedMaterials = (task?.results || []).some(result => (result.materials || []).some(material => material.status === "completed"));
      $("social-research-regenerate-report").disabled = task?.status !== "awaiting-save" || reportGenerating || deepReadRunning || !hasCompletedMaterials;
      const report = task?.report;
      if (!report) {
        const detail = task?.reportError ? `${task.reportErrorCode ? `${task.reportErrorCode}：` : ""}${task.reportError}` : "报告结论会关联到对应原始结果。";
        $("social-research-report-content").textContent = detail;
        return;
      }
      const findings = [...(report.coreFindings || []), ...(report.commonPoints || []), ...(report.platformDifferences || []), ...(report.painPointsOrPatterns || []), ...(report.representativeCases || []), ...(report.conflicts || []), ...(report.needsVerification || []), ...(report.nextSteps || [])];
      $("social-research-report-content").innerHTML = `<p>${escape(report.summary || "研究报告")}</p>${findings.map((finding, index) => { const citation = (report.citations || []).find(item => item.findingIndex === index); const resultId = citation?.resultId || report.resultIds?.[index] || report.resultIds?.[0]; const result = task.results.find(item => item.id === resultId); const material = citation && result?.materials?.find(item => item.id === citation.materialId); const href = material ? `#social-material-${escape(material.id)}` : result ? `#social-result-${escape(result.id)}` : ""; return `<div class="social-report-item"><span>${escape(finding)}</span>${href ? `<a href="${href}" data-report-result="${escape(resultId)}" ${material ? `data-report-material="${escape(material.id)}"` : ""}>来源：${escape(material ? `${result.title || resultId} · ${material.kind} · ${material.id}` : result.title || resultId)}</a>` : `<span class="social-muted">来源待核验</span>`}</div>`; }).join("")}`;
    }

    function sourceStageLabel(progress) {
      const labels = {
        "checking-lock": "检查固定来源与依赖锁",
        "checking-installer": "检查固定安装器版本",
        "downloading-installer": "安装专用运行时",
        "installing-python": "准备 Python 运行时",
        "creating-environment": "创建来源隔离环境",
        "syncing-dependencies": "准备锁定依赖",
        "installing-browser": "准备专用浏览器",
        "verifying-runtime": "验证运行环境",
        complete: "环境准备完成"
      };
      return labels[progress?.stage] || "准备来源环境";
    }
    function sourceErrorMessage(code) {
      return ({
        RUNTIME_MISSING: "缺少受支持的专用运行时；当前安装器仅支持 Windows x64。",
        RUNTIME_INSTALL_FAILED: "专用运行时准备失败，可以重试。",
        DEPENDENCY_ERROR: "来源依赖或浏览器准备失败，可以重试。",
        LOCK_MISMATCH: "项目中的固定依赖锁与登记摘要不匹配。",
        SOURCE_MISSING: "应用缺少已登记的来源文件。",
        BROWSER_MISSING: "专用浏览器尚未准备完成，可以重试。",
        SESSION_BUSY: "来源正在运行或准备中，结束当前操作后再重试。",
        SOURCE_STATE_WRITE_FAILED: "来源准备状态无法安全保存；操作已停止，可检查磁盘权限后重试。",
        CANCELLED: "准备操作已取消，可以重新开始。",
        TIMEOUT: "环境检查超时，可以重试。",
        PROCESS_CRASHED: "登录浏览器进程意外退出；可重新启动登录 profile。"
      })[code] || "环境检查或准备失败；保留现有用户数据，可检查脱敏诊断后重试。";
    }
    function renderSourceLifecycle() {
      const source = registeredSocialSource;
      const candidate = socialSourceCatalog.find(item => item?.id === "bilibili-mcp-transcript-candidate");
      const environment = socialSourceEnvironment || {};
      const task = currentTask();
      const sourcePlatforms = Array.isArray(source?.platforms) ? source.platforms : [];
      if (sourcePlatforms.length && !sourcePlatforms.includes(sourceProfilePlatform)) sourceProfilePlatform = sourcePlatforms[0];
      const selectedProfileId = schema.resolveResearchProfileId(sourceProfilePlatform, task?.profileId);
      const runtimeState = selectedRuntimeState(sourceProfilePlatform, selectedProfileId);
      const loginError = loginErrors.get(runtimeStateKey(sourceProfilePlatform, selectedProfileId));
      const displayedFailure = sourceFailure || loginError;
      const sourceOperationBusy = sourcePreparationRunning || sourceEnvironmentChecking || sourceProgress?.state === "running";
      const busy = researchIsBusy() || sourceOperationBusy || sourceVersionOperationRunning;
      const progressState = sourceProgress?.state;
      let status = "未安装";
      if (sourceEnvironmentChecking) status = "检查环境";
      else if (["running", "retrying"].includes(progressState)) {
        status = sourceProgress.stage === "verifying-runtime" ? "验证中"
          : ["installing-python", "downloading-installer"].includes(sourceProgress.stage) ? "安装中"
            : "准备依赖";
      } else if (sourceFailure || loginError || ["error", "interrupted"].includes(progressState) || environment.status === "error"
        || environment.installationState === "partial") status = "失败";
      else if (environment.status === "ok") {
        status = runtimeState === "stopped" ? "停止"
          : runtimeState === "running" ? "运行中" : environment.running ? "运行中" : "可用";
      }
      const progress = Number.isFinite(sourceProgress?.progress) ? sourceProgress.progress : status === "可用" ? 100 : 0;
      const operationId = sourceProgress?.operationId || displayedFailure?.operationId || sourceOperationId;
      const destination = environment.targets?.versionDirectory || environment.targets?.rootDirectory || "由应用登记表固定";
      $("social-source-manager-content").innerHTML = source ? `
        <article class="social-result">
          <div>
            <h3>${escape(source.name || "MediaCrawler 固定适配器")} · v${escape(source.version)}</h3>
            <div class="social-meta">登记来源：${escape(source.repository || "应用内固定登记")} · 修订：${escape(source.revision || "固定版本")} · 许可：${escape(source.license || "见随附许可文件")}</div>
            <div class="social-meta">目标目录：${escape(destination)} · 状态：<strong>${escape(status)}</strong></div>
            <div class="social-source-phase" role="status" aria-live="polite">${escape(sourceProgress ? sourceStageLabel(sourceProgress) : displayedFailure ? displayedFailure.message : environment.code ? `${sourceErrorMessage(environment.code)} 错误码：${environment.code}` : "环境状态来自本机固定目录检查；登录态保存在平台独立 profile。")}</div>
            <progress max="100" value="${Math.max(0, Math.min(100, progress))}" aria-label="来源准备进度"></progress>
            <div class="social-meta">${Math.max(0, Math.min(100, progress))}%${operationId ? ` · 操作 ID：${escape(operationId)}` : ""}${sourceProgress?.code ? ` · 错误码：${escape(sourceProgress.code)}` : displayedFailure?.code ? ` · 错误码：${escape(displayedFailure.code)}` : ""}</div>
            ${status === "失败" ? `<p class="social-error" role="alert">${escape(displayedFailure?.message || sourceErrorMessage(environment.code))}${displayedFailure?.recoverable ? "（可重试）" : ""}</p>` : ""}
            <div class="social-source-config">
              <label>登录平台 <select id="social-source-profile-platform" ${busy ? "disabled" : ""}></select></label>
              <span id="social-source-profile-current" class="social-meta">当前研究 profile：${escape(selectedProfileId)}</span>
            </div>
            <div class="button-row social-source-actions">
              <button class="button-primary" type="button" data-source-lifecycle="prepare" ${!source.available || busy || sourcePreparationRunning ? "disabled" : ""}>${environment.installationState === "partial" || status === "失败" ? "修复 / 重试" : "安装 / 准备"}</button>
              <button class="button-secondary" type="button" data-source-lifecycle="check" ${busy || sourceEnvironmentChecking || sourcePreparationRunning ? "disabled" : ""}>检查环境</button>
              <button class="button-secondary" type="button" data-source-lifecycle="login" ${!environment.status || environment.status !== "ok" || busy || sourcePreparationRunning ? "disabled" : ""}>启动独立登录 profile</button>
              <button class="button-secondary" type="button" data-source-lifecycle="stop" ${busy || sourcePreparationRunning || !environment.running && runtimeState !== "running" ? "disabled" : ""}>停止登录进程</button>
              <button class="button-quiet" type="button" data-source-lifecycle="diagnostics">${sourceDiagnosticsExpanded ? "隐藏脱敏诊断" : "查看脱敏诊断"}</button>
            </div>
            <div class="social-source-capabilities">能力：${escape(sourcePlatforms.map(platform => `${names[platform] || platform}（${(source.capabilities?.[platform] || []).filter(item => ["detail", "comments"].includes(item)).join("、")}）`).join("；"))}</div>
            <div class="social-meta">固定环境配置：Python ${escape(source.pythonVersion || "登记版本")} · ${escape(source.browserAutomation?.package || "浏览器自动化")} ${escape(source.browserAutomation?.version || "")} · ${escape(source.browserAutomation?.browser || "专用浏览器")}。没有凭证输入框；登录数据留在独立 profile。</div>
            ${sourceDiagnosticsExpanded ? `<pre class="social-source-diagnostics">${sourceDiagnostics.length ? sourceDiagnostics.map(escape).join("\n") : "暂无诊断记录。仅显示来源管理器已脱敏的本机诊断。"}</pre>` : ""}
            <div class="social-source-versions">
              <strong>来源版本</strong>
              <div>当前生效：v${escape(socialSourceVersions?.activeVersion || source.version)} · 回退版本：${socialSourceVersions?.previousVersion ? `v${escape(socialSourceVersions.previousVersion)}` : "无"}</div>
              ${socialSourceVersions?.candidates?.length ? socialSourceVersions.candidates.map(candidate => `
                <div class="social-meta">候选 v${escape(candidate.versionId)} · ${candidate.status === "prepared" ? "已准备并通过自检" : candidate.status === "active" ? "当前生效" : "待准备"}
                  ${candidate.status === "prepared" ? `<button type="button" data-source-version-action="activate" data-version-id="${escape(candidate.versionId)}" ${busy ? "disabled" : ""}>切换到此版本</button>` : candidate.status === "active" ? "" : `<button type="button" data-source-version-action="prepare" data-version-id="${escape(candidate.versionId)}" ${busy ? "disabled" : ""}>准备候选版本</button>`}
                </div>`).join("") : `<p class="social-meta">暂无已批准的新版本。</p><button type="button" data-source-version-action="prepare" disabled>准备升级（暂无候选）</button>`}
              <div class="button-row">
                <button class="button-secondary" type="button" data-source-version-action="rollback" ${busy || !socialSourceVersions?.previousVersion ? "disabled" : ""}>回退到上一个版本</button>
                <button class="button-secondary" type="button" data-source-version-action="cleanup" ${busy || !socialSourceVersions?.cleanupAvailable ? "disabled" : ""}>清理未保留的旧版本</button>
                <button class="button-secondary" type="button" data-source-version-action="uninstall" ${busy ? "disabled" : ""}>卸载来源运行时</button>
              </div>
              <div class="social-meta">保留当前版本和 1 个回退版本；清理其余版本不会删除共享运行时缓存。卸载会移除来源版本目录并恢复应用内固定版本，不会删除 profile、凭证、研究任务或附件。</div>
            </div>
            <div class="social-source-unavailable">
              <strong>生命周期能力状态</strong>
              <div>候选仅来自应用登记表和随应用打包的固定文件清单；没有远程任意脚本入口。</div>
              <div>清理旧版本不会删除 profile、凭证、研究任务或附件。</div>
            </div>
          </div>
        </article>` : `<p class="social-error" role="alert">固定 MediaCrawler 来源登记不可用；未开放自定义仓库或命令。</p>`;
      const profilePlatform = $("social-source-profile-platform");
      const profileCurrent = $("social-source-profile-current");
      if (profilePlatform && profileCurrent) {
        profilePlatform.innerHTML = sourcePlatforms.map(platform =>
          `<option value="${escape(platform)}" ${platform === sourceProfilePlatform ? "selected" : ""}>${escape(names[platform] || platform)}</option>`
        ).join("");
        profileCurrent.textContent = `${names[sourceProfilePlatform] || sourceProfilePlatform} 当前研究 profile：${selectedProfileId}`;
      }
      $("social-source-candidate").innerHTML = candidate ? `
        <article class="social-result">
          <div>
            <h3>${escape(candidate.name)} · v${escape(candidate.version)} · ${escape(candidate.license)}</h3>
            <div class="social-meta">登记仓库：${escape(candidate.repository)} · 运行环境：${escape(candidate.runtime?.name)} ≥ ${escape(candidate.runtime?.minimumVersion)} · 只读能力：${escape((candidate.capabilities?.bilibili || []).join("、"))}</div>
            <p class="social-error">不可用候选：${escape(candidate.unavailableReason)}</p>
            <div class="social-meta">安全约束：force_asr=${candidate.policy?.force_asr === false ? "禁用" : "未验证"} · fallbacks=${candidate.policy?.fallbacks === false ? "禁用" : "未验证"} · 校验 data_source 与时间戳。</div>
            <button class="button-quiet" type="button" disabled>安装与启动暂不可用</button>
          </div>
        </article>` : `<p class="social-muted">字幕来源未登记；不会用视频简介代替字幕。</p>`;
    }
    function render() { const task = currentTask(); renderPlatformCards(); renderPlan(task); renderResults(task); renderReport(task); renderSourceLifecycle(); }
    function restorePrepareOperation(environment) {
      const operation = environment?.lastPrepareOperation;
      if (!operation || operation.sourceId !== registeredSocialSource?.id) return;
      sourceProgress = operation;
      sourceOperationId = operation.operationId || "";
      if (["error", "interrupted"].includes(operation.state)) {
        sourceFailure = {
          operationId: operation.operationId,
          code: operation.code || (operation.state === "interrupted" ? "CANCELLED" : "DEPENDENCY_ERROR"),
          message: operation.state === "interrupted"
            ? "上次准备在应用退出时中断；不会自动继续，可手动重试。"
            : sourceErrorMessage(operation.code),
          recoverable: operation.recoverable === true
        };
      } else {
        sourceFailure = null;
        const targetProfileId = profileId(sourceProfilePlatform);
        if (operation.state === "complete" && environment.status === "ok"
          && selectedRuntimeState(sourceProfilePlatform, targetProfileId) !== "stopped") {
          setRuntimeState(sourceProfilePlatform, targetProfileId, "available");
        }
      }
    }
    async function refreshSourceEnvironment({ restorePreparation = true } = {}) {
      if (typeof desktopApi.socialSource?.checkEnvironment !== "function") throw new Error("来源环境检查接口不可用");
      sourceEnvironmentChecking = true;
      renderSourceLifecycle();
      try {
        socialSourceEnvironment = await desktopApi.socialSource.checkEnvironment(registeredSocialSource?.id || "mediacrawler-lite");
        if (restorePreparation) restorePrepareOperation(socialSourceEnvironment);
        return socialSourceEnvironment;
      } finally {
        sourceEnvironmentChecking = false;
        renderSourceLifecycle();
      }
    }
    async function prepareRegisteredSource() {
      if (researchIsBusy() || sourcePreparationRunning || sourceEnvironmentChecking || sourceProgress?.state === "running") {
        setStatus("研究运行或来源检查/准备期间不能再次准备来源环境。"); return;
      }
      if (!registeredSocialSource?.available || typeof desktopApi.socialSource?.prepare !== "function") {
        setStatus("固定来源准备接口当前不可用。"); return;
      }
      const platform = sourceProfilePlatform;
      const targetProfileId = profileId(platform);
      sourcePreparationRunning = true;
      sourceOperationId = "";
      sourceFailure = null;
      sourceProgress = { sourceId: registeredSocialSource.id, version: registeredSocialSource.version, stage: "checking-lock", state: "running", progress: 0 };
      renderSourceLifecycle();
      try {
        const result = await desktopApi.socialSource.prepare(registeredSocialSource.id);
        sourceOperationId = result?.operationId || sourceProgress?.operationId || "";
        sourceProgress = result?.phases?.at?.(-1) || sourceProgress;
        if (result?.status !== "ok") {
          sourceFailure = {
            operationId: result?.operationId || sourceOperationId,
            code: result?.code || "DEPENDENCY_ERROR",
            message: result?.message || sourceErrorMessage(result?.code),
            recoverable: result?.recoverable === true
          };
        }
        await refreshSourceEnvironment();
        if (result?.status === "ok") setRuntimeState(platform, targetProfileId, "available");
        setStatus(result?.status === "ok" ? "固定来源环境已准备并通过检查。" : `${sourceFailure.message}${sourceFailure.recoverable ? " 可重试。" : ""}`);
      } catch (error) {
        sourceFailure = { operationId: sourceOperationId, code: error?.code || "REQUEST_FAILED", message: error?.message || "来源准备请求失败", recoverable: true };
        setStatus(sourceFailure.message);
      } finally {
        sourcePreparationRunning = false;
        renderSourceLifecycle();
      }
    }
    async function openSourceLogin() {
      if (researchIsBusy() || sourcePreparationRunning || sourceEnvironmentChecking || sourceProgress?.state === "running") {
        setStatus("研究运行或来源检查/准备期间不能启动登录 profile。"); return;
      }
      if (!registeredSocialSource?.available || socialSourceEnvironment?.status !== "ok") {
        setStatus("固定来源环境尚未通过检查，暂不能启动登录 profile。"); return;
      }
      const platform = sourceProfilePlatform;
      const targetProfile = profileId(platform);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(targetProfile)) {
        setStatus("当前研究 profile ID 无效；请修复研究任务 profile 设置后重试。"); return;
      }
      try {
        const result = await desktopApi.socialSource.openLogin({ sourceId: registeredSocialSource.id, platform, profileId: targetProfile });
        if (result?.status !== "ok") throw Object.assign(new Error(result?.message || sourceErrorMessage(result?.code)), { code: result?.code });
        loginErrors.delete(runtimeStateKey(platform, targetProfile));
        setRuntimeState(platform, targetProfile, "running");
        renderSourceLifecycle();
        setStatus(`${names[platform] || platform} 独立登录 profile 已打开；登录态只保存在应用专用目录。`);
      } catch (error) { setStatus(error.message || "无法打开独立登录 profile"); }
    }
    async function stopSourceLogin() {
      if (researchIsBusy() || sourcePreparationRunning || sourceEnvironmentChecking) {
        setStatus("研究运行或来源检查/准备期间不能停止来源进程；请等待当前操作完成。"); return;
      }
      const platform = sourceProfilePlatform;
      const profile = profileId(platform);
      try {
        const result = await desktopApi.socialSource.stopProfile({ sourceId: registeredSocialSource.id, platform, profileId: profile });
        if (result?.status !== "ok") throw Object.assign(new Error(result?.message || sourceErrorMessage(result?.code)), { code: result?.code });
        setRuntimeState(platform, profile, "stopped");
        await refreshSourceEnvironment({ restorePreparation: false });
        setStatus(result.stopped ? "独立登录进程已停止；登录态与用户材料已保留。" : "当前 profile 没有正在运行的登录进程。");
      } catch (error) { setStatus(error.message || "停止 profile 失败"); }
    }
    async function loadSourceDiagnostics() {
      if (sourceDiagnosticsExpanded) { sourceDiagnosticsExpanded = false; renderSourceLifecycle(); return; }
      try {
        const result = await desktopApi.socialSource.getDiagnostics();
        sourceDiagnostics = result?.status === "ok" && Array.isArray(result.entries) ? result.entries : [];
        sourceDiagnosticsExpanded = true;
        renderSourceLifecycle();
      } catch (error) { setStatus(error.message || "读取脱敏诊断失败"); }
    }
    async function refreshPlatforms() {
      if (typeof desktopApi.social.listPlatforms !== "function") throw new Error("当前桌面 API 不支持平台列表");
      const definitions = await desktopApi.social.listPlatforms();
      platforms = (Array.isArray(definitions) ? definitions : definitions?.platforms || []).map(item => ({ ...item, connection: getState()?.platformConnections?.[item.platform] || {} }));
      const sourceApi = desktopApi.socialSource;
      const [sourcesResult, versionsResult] = await Promise.allSettled([
        typeof sourceApi?.list === "function" ? sourceApi.list() : Promise.resolve(null),
        typeof sourceApi?.listVersions === "function" ? sourceApi.listVersions() : Promise.resolve(null)
      ]);
      const sources = sourcesResult.status === "fulfilled" ? sourcesResult.value : null;
      socialSourceCatalog = Array.isArray(sources) ? sources : [];
      socialSourceVersions = versionsResult.status === "fulfilled" && versionsResult.value?.status === "ok"
        ? versionsResult.value : null;
      registeredSocialSource = Array.isArray(sources)
        ? sources.find(source => source?.id === "mediacrawler-lite" && source.available !== false) || null : null;
      sourceEnvironmentChecking = Boolean(registeredSocialSource);
      renderSourceLifecycle();
      const [environmentResult] = await Promise.allSettled([
        registeredSocialSource && typeof sourceApi?.checkEnvironment === "function"
          ? sourceApi.checkEnvironment(registeredSocialSource.id) : Promise.resolve(null)
      ]);
      socialSourceEnvironment = environmentResult.status === "fulfilled" ? environmentResult.value : null;
      restorePrepareOperation(socialSourceEnvironment);
      sourceEnvironmentChecking = false;
      renderPlatformChoices();
      renderSourceLifecycle();
    }
    async function refreshSourceVersions() {
      if (typeof desktopApi.socialSource?.listVersions !== "function") {
        socialSourceVersions = null;
      } else {
        const result = await desktopApi.socialSource.listVersions();
        socialSourceVersions = result?.status === "ok" ? result : null;
      }
      renderSourceLifecycle();
      return socialSourceVersions;
    }
    async function runSourceVersionAction(action, versionId) {
      if (researchIsBusy() || sourcePreparationRunning || sourceEnvironmentChecking
        || sourceProgress?.state === "running" || sourceVersionOperationRunning) {
        setStatus("研究、登录或来源操作运行期间不能切换、回退或清理来源版本。");
        return;
      }
      const sourceApi = desktopApi.socialSource;
      const sourceId = registeredSocialSource?.id;
      if (!sourceId) return;
      if (action === "activate" && !confirmAction(`确认切换到来源版本 ${versionId}？切换前会再次运行无凭证自检。`)) return;
      if (action === "rollback" && !confirmAction("确认回退到上一个可用来源版本？研究任务、附件、profile 和凭证会保留。")) return;
      if (action === "cleanup" && !confirmAction("确认清理未激活且未保留的来源版本运行目录？研究任务、附件、profile 和凭证不会删除。")) return;
      if (action === "uninstall" && !confirmAction("确认卸载来源运行时？会恢复应用内固定版本，研究任务、附件、profile 和凭证会保留。")) return;
      sourceVersionOperationRunning = true;
      renderSourceLifecycle();
      try {
        let result;
        if (action === "prepare") result = await sourceApi.prepareVersion(sourceId, versionId);
        else if (action === "activate") result = await sourceApi.activateVersion(sourceId, versionId);
        else if (action === "rollback") result = await sourceApi.rollbackVersion(sourceId);
        else if (action === "cleanup") result = await sourceApi.cleanupVersions(sourceId);
        else if (action === "uninstall") result = await sourceApi.uninstall(sourceId);
        if (result?.status !== "ok") {
          setStatus(result?.automaticRollback
            ? `候选版本未能启动，已保留原版本 v${result.activeVersion}：${result.message || result.code || "自检失败"}`
            : `来源版本操作失败：${result?.message || result?.code || "未知错误"}`);
        } else if (action === "prepare") setStatus(`候选版本 v${result.versionId} 已准备并通过自检；需要你明确确认后才会切换。`);
        else if (action === "activate") setStatus(`已切换到来源版本 v${result.activeVersion}；v${result.previousVersion} 保留为回退版本。`);
        else if (action === "rollback") setStatus(`已回退到来源版本 v${result.activeVersion}；原版本仍保留。`);
        else if (action === "cleanup") setStatus(`已清理 ${result.removedVersions?.length || 0} 个未保留版本；profile 和研究材料已保留。`);
        else setStatus(`来源运行时已卸载，恢复到应用内固定版本 v${result.activeVersion}；profile 和研究材料已保留。`);
        if (action === "uninstall" || action === "activate" || action === "rollback") await refreshPlatforms();
        else await refreshSourceVersions();
      } catch (error) {
        setStatus(error.message || "来源版本操作失败");
      } finally {
        sourceVersionOperationRunning = false;
        renderSourceLifecycle();
      }
    }
    async function platformAction(action, platform) {
      const item = platforms.find(entry => entry.platform === platform);
      if (!item) return;
      const id = profileId(platform);
      if (action === "login") {
        const result = await desktopApi.social.openLogin(platform, id);
        if (result?.status !== "ok") throw Object.assign(new Error(result?.message || "无法打开登录窗口"), { code: result?.code });
        item.connection = resetPreparation(item.connection, {
          loginState: "unknown", lastErrorCategory: "", lastErrorCode: "", error: ""
        });
        persistConnections();
        setStatus(`${names[platform] || platform} 登录窗口已打开；登录后点击重新检查。`);
      } else if (action === "check") {
        checking.add(platform); renderPlatformCards();
        try {
          const [statusResult, checkResult] = await Promise.allSettled([
            desktopApi.social.getStatus(platform),
            desktopApi.social.check(platform, id)
          ]);
          const platformStatus = statusResult.status === "fulfilled" ? statusResult.value || {} : {};
          const checkFailure = checkResult.status === "rejected" ? checkResult.reason : null;
          const checked = checkResult.status === "fulfilled" ? checkResult.value || {} : {
            status: "error",
            code: checkFailure?.code || "CHECK_FAILED",
            message: checkFailure?.message || "平台检查请求失败"
          };
          const responseStatus = String(checked.status || "");
          const readable = responseStatus === "ok"
            && typeof checked.ready === "boolean"
            && (!checked.platform || checked.platform === platform)
            && checked.readable !== false
            && checked.pageReadable !== false
            && checked.data?.readable !== false;
          const loginStates = new Set(["unknown", "logged-in", "logged-out", "login-required", "restricted"]);
          const loginState = loginStates.has(checked.loginState) ? checked.loginState : "unknown";
          const errorCode = String(checked.code || checked.errorCode || "").toUpperCase();
          const errorCategory = String(checked.errorCategory || "").toLowerCase();
          const loginBlocked = loginState === "login-required" || checked.loginRequired === true
            || errorCode.includes("LOGIN_REQUIRED") || errorCategory === "login-required";
          const verificationBlocked = responseStatus === "manual-verification"
            || checked.verificationRequired === true || checked.manualVerificationRequired === true
            || errorCode.includes("VERIFICATION") || errorCategory === "manual-verification";
          const rateLimited = errorCode === "RATE_LIMITED" || ["rate-limited", "rate_limited"].includes(errorCategory);
          const restricted = responseStatus === "restricted" || loginState === "restricted"
            || checked.restricted === true || errorCode.includes("RESTRICT") || errorCategory === "restricted" || rateLimited;
          const closed = responseStatus === "closed" || errorCode.includes("CLOSED") || errorCategory === "closed";
          const failedCategory = ["error", "adapter-error", "restricted", "closed", "not-ready"].includes(errorCategory);
          const browserReady = readable && checked.ready === true && !errorCode && !failedCategory && !restricted;
          const browserPrepared = browserReady && !loginBlocked && !verificationBlocked
            && !restricted && !closed && !failedCategory;
          const checkedAt = checked.checkedAt || checked.lastCheckedAt || platformStatus.checkedAt || new Date().toISOString();
          const lastErrorCategory = browserPrepared ? "" : String(
            checked.errorCategory
            || (verificationBlocked ? "manual-verification" : loginBlocked ? "login-required" : restricted ? "restricted" : closed ? "closed" : responseStatus === "ok" ? "not-ready" : responseStatus || "invalid-response")
          );
          const lastErrorCode = String(checked.code || checked.errorCode || (checkFailure?.code || ""));
          const errorMessage = browserPrepared ? "" : String(checked.message || (readable ? "页面已读取，但当前连接尚未准备好。" : "平台检查未通过，需重新检查连接状态。"));
          const reportedBrowserStatus = ["ready", "not-ready", "closed", "busy", "restricted", "manual-verification", "error"].includes(checked.browserStatus)
            ? checked.browserStatus : "";
          const browserStatus = rateLimited ? "restricted" : reportedBrowserStatus || (restricted ? "restricted" : verificationBlocked ? "manual-verification" : closed ? "closed" : browserReady ? "ready" : responseStatus === "ok" ? "not-ready" : responseStatus || "not-ready");
          item.connection = {
            ...item.connection,
            status: browserReady ? "ready" : restricted ? "restricted" : "not-ready",
            browserStatus,
            apiConfigured: platformStatus.apiConfigured === true,
            browserReady,
            browserPrepared,
            checked: true,
            checkedAt,
            lastCheckedAt: checkedAt,
            lastSuccessfulSearchAt: item.connection.lastSuccessfulSearchAt || "",
            loginState,
            searchVerified: item.connection.searchVerified === true,
            supportsSearch: item.browserSearchRegistered === true && item.supportsSearch === true,
            supportsDetail: checked.capabilities?.supportsDetail === true || checked.supportsDetail === true,
            supportsComments: checked.capabilities?.supportsComments === true || checked.supportsComments === true,
            lastErrorCategory,
            lastErrorCode,
            capabilities: checked.capabilities || checked,
            error: errorMessage
          };
          persistConnections();
          setStatus(browserPrepared
            ? `${names[platform] || platform} 页面检查通过，可尝试真实搜索；搜索验收仍待实测。`
            : item.connection.apiConfigured
              ? `${names[platform] || platform} 浏览器检查未通过；API 已配置，可按 API 连接方式继续。`
              : `${names[platform] || platform} 检查已完成，但当前连接尚未准备好。`);
        } finally { checking.delete(platform); }
      } else if (action === "clear") {
        const result = await desktopApi.social.clearProfile(platform, id);
        if (result?.status !== "ok") throw Object.assign(new Error(result?.message || "清理 profile 失败"), { code: result?.code });
        item.connection = resetPreparation(item.connection, {
          loginState: "unknown", lastErrorCategory: "", lastErrorCode: "", error: ""
        });
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
        selectedDeepResultIds.clear();
        selectedMaterialIds.clear();
        expandedMaterialIds.clear();
        render();
        setStatus(task.planError
          ? `未能生成模型计划，已提供默认计划供核对：${task.planError}`
          : "计划已生成。请核对目标、查询词和预算后确认；确认前不会开始搜索。");
      } catch (error) { setStatus(error.message || "研究计划生成失败"); }
    }
    async function confirmAndRun() {
      const task = currentTask();
      if (!allPlatformsPrepared(task)) { setStatus("请按每个平台选择的连接方式完成准备检查。"); return; }
      let researchLease = null;
      try {
        researchLease = await beginResearchLease();
        await coordinator.confirmPlan(task.id);
        running = true; paused = false; cancellationRequested = false; reportGenerating = false; liveProgress = null;
        let completedQueries = 0;
        $("social-research-progress").style.width = "0%";
        $("social-research-progress-detail").textContent = "正在检查平台…";
        render(); setStatus("已确认计划，正在检查平台；取消会保留已完成材料，在途请求可能完成并计费。");
        const result = await coordinator.run(task.id, { onEvent: event => {
          if (event.type === "search-verified") {
            const item = platforms.find(platform => platform.platform === event.platform);
            if (item && event.profileId === profileId(event.platform)) {
              item.connection = {
                ...item.connection,
                profileId: event.profileId,
                searchVerified: true,
                lastSuccessfulSearchAt: event.lastSuccessfulSearchAt
              };
              persistConnections();
            }
          }
          if (event.type === "report-start") {
            reportGenerating = true;
            setStatus("正在生成报告；在途模型请求可能完成并计费，取消后保留已完成材料。");
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
        setStatus(result.status === "cancelled" ? "已取消：保留已完成材料；在途请求可能已完成并计费。" : `研究结束：${result.status} · ${result.results?.length || 0} 条结果${Object.keys(result.platformErrors || {}).length ? " · 部分平台未完成" : ""}`);
      } catch (error) { running = false; paused = false; cancellationRequested = false; reportGenerating = false; render(); setStatus(error.message || "研究执行失败"); }
      finally { await endResearchLease(researchLease); }
    }
    function cancelTask() {
      const task = currentTask();
      if (!task) return;
      try {
        coordinator.cancel(task.id);
        if (running || deepReadRunning || reportGenerating) {
          cancellationRequested = true;
          render();
          setStatus(reportGenerating
            ? "正在生成报告；取消后旧报告和已完成材料保留。"
            : deepReadRunning
              ? "已请求取消深读；停止后续请求并保留已完成材料。"
              : "已请求取消；保留已完成材料，在途请求仍可能完成并计费，其结果不纳入后续研究。");
        }
        else { render(); setStatus("研究计划已取消，未开始搜索。"); }
      }
      catch (error) { setStatus(error.message || "当前阶段不能取消"); }
    }
    function togglePause() {
      const task = currentTask();
      if (!task || !running || cancellationRequested) return;
      try {
        if (paused) { coordinator.resume(task.id); paused = false; setStatus("已继续研究。"); }
        else { coordinator.pause(task.id); paused = true; setStatus("已暂停：停止新增请求；在途请求仍可能完成并计费，完成后等待继续。"); }
        render();
      } catch (error) { setStatus(error.message || "无法更改运行状态"); }
    }
    function saveSelection() {
      const task = currentTask(); if (!task) return;
      const ids = [...selectedResultIds];
      try { coordinator.saveSelected(task.id, ids); render(); setStatus(`已将 ${ids.length} 条勾选结果保存到本地资料库。`); }
      catch (error) { setStatus(error.message || "保存失败"); }
    }

    async function runDeepRead(action) {
      const task = currentTask();
      const resultIds = [...selectedDeepResultIds].filter(id => {
        const result = task?.results?.find(item => item.id === id);
        return result && schema.resolveDomesticContentId(result) && sourceReadyFor(result.platform, action);
      });
      if (!task || !resultIds.length) { setStatus("请选择带有效内容 ID 的小红书或 B 站结果。缺少 ID 的结果不会发送来源请求。"); return; }
      let researchLease = null;
      deepReadRunning = true;
      cancellationRequested = false;
      render();
      setStatus(action === "detail" ? "正在读取所选内容详情……" : "正在读取所选内容的一级评论（最多每条 20 条）……");
      try {
        researchLease = await beginResearchLease();
        await coordinator.deepRead(task.id, resultIds, [action], { onEvent: () => render() });
        setStatus(cancellationRequested ? "深读已取消；搜索结果和已完成材料均已保留。" : "所选深读动作已结束；可查看逐条状态，或基于已完成材料重新生成报告。");
      } catch (error) { setStatus(error.message || "深读动作失败；已有结果和材料已保留。"); }
      finally { await endResearchLease(researchLease); deepReadRunning = false; cancellationRequested = false; render(); }
    }

    async function saveMaterialSelection() {
      const task = currentTask();
      if (!task || materialSaveRunning) return;
      materialSaveRunning = true;
      render();
      setStatus("正在保存所选全文附件……");
      try {
        await coordinator.saveMaterials(task.id, [...selectedMaterialIds]);
        selectedMaterialIds.clear();
        setStatus("已将所选全文写入研究附件，并关联到对应结果和材料。");
      } catch (error) { setStatus(error.message || "附件保存失败；材料和搜索结果仍保留。"); }
      finally { materialSaveRunning = false; render(); }
    }

    async function regenerateReport() {
      const task = currentTask();
      if (!task) return;
      let researchLease = null;
      reportGenerating = true;
      cancellationRequested = false;
      render();
      setStatus("正在根据已完成材料重新生成报告；原报告会在新报告成功后才替换。");
      try {
        researchLease = await beginResearchLease();
        const updated = await coordinator.regenerateReport(task.id);
        render();
        setStatus(updated?.reportError
          ? `重新生成失败，旧报告和材料已保留：${updated.reportErrorCode ? `${updated.reportErrorCode}：` : ""}${updated.reportError}`
          : "已根据已完成材料更新报告。材料引用已校验并回链到具体结果。");
      } catch (error) { setStatus(error.message || "重新生成报告失败；旧报告和材料已保留。"); }
      finally { await endResearchLease(researchLease); reportGenerating = false; cancellationRequested = false; render(); }
    }

    $("social-research-entry").addEventListener("submit", createPlan);
    $("social-platform-refresh").addEventListener("click", () => refreshPlatforms().catch(error => setStatus(error.message)));
    $("social-research-plan-confirm").addEventListener("click", confirmAndRun);
    $("social-research-pause").addEventListener("click", togglePause);
    $("social-research-cancel").addEventListener("click", cancelTask);
    $("social-research-plan").addEventListener("click", async event => {
      const button = event.target.closest("[data-research-operation]");
      if (!button) return;
      const task = currentTask();
      if (!task || typeof coordinator.chooseOperation !== "function") return;
      try {
        if (button.dataset.researchOperation === "retry" && typeof coordinator.retryOperation === "function") {
          await coordinator.retryOperation(task.id, button.dataset.operationId);
        } else {
          coordinator.chooseOperation(task.id, button.dataset.operationId, button.dataset.researchOperation);
        }
        render();
        setStatus(button.dataset.researchOperation === "skip" ? "已跳过该操作；已完成材料和预算记录保留。" : "该操作已重新执行；预算与结果已记入原任务。");
      } catch (error) { setStatus(error.message || "无法更新操作队列"); }
    });
    $("social-research-save-selection").addEventListener("click", saveSelection);
    $("social-research-read-details").addEventListener("click", () => runDeepRead("detail"));
    $("social-research-read-comments").addEventListener("click", () => runDeepRead("comments"));
    $("social-research-save-materials").addEventListener("click", saveMaterialSelection);
    $("social-research-regenerate-report").addEventListener("click", regenerateReport);
    $("social-source-manager-content").addEventListener("click", event => {
      const versionButton = event.target.closest("[data-source-version-action]");
      if (versionButton?.dataset?.sourceVersionAction) {
        runSourceVersionAction(versionButton.dataset.sourceVersionAction, versionButton.dataset.versionId)
          .catch(error => setStatus(error.message || "来源版本操作失败"));
        return;
      }
      const action = event.target.closest("[data-source-lifecycle]")?.dataset.sourceLifecycle;
      if (action === "prepare") prepareRegisteredSource();
      else if (action === "check") {
        if (researchIsBusy() || sourcePreparationRunning || sourceEnvironmentChecking || sourceProgress?.state === "running") {
          setStatus("研究运行或来源检查/准备期间不能检查来源环境。");
          return;
        }
        refreshSourceEnvironment().catch(error => setStatus(error.message || "环境检查失败"));
      }
      else if (action === "login") openSourceLogin();
      else if (action === "stop") stopSourceLogin();
      else if (action === "diagnostics") loadSourceDiagnostics();
    });
    $("social-source-manager-content").addEventListener("change", event => {
      if (event.target.id === "social-source-profile-platform") {
        sourceProfilePlatform = event.target.value;
        renderSourceLifecycle();
      }
    });
    $("social-platform-cards").addEventListener("click", event => {
      const button = event.target.closest("[data-social-action]");
      if (button) platformAction(button.dataset.socialAction, button.dataset.platform).catch(error => { const node = document.querySelector(`[data-platform-error="${button.dataset.platform}"]`); if (node) node.textContent = `最近错误：${error.message}`; });
    });
    ["social-filter-platform", "social-filter-query", "social-filter-evidence", "social-filter-saved", "social-filter-from", "social-filter-to"].forEach(id => $(id).addEventListener("change", () => renderResults(currentTask())));
    $("social-research-results-list").addEventListener("change", event => {
      const task = currentTask(); if (!task) return;
      const target = event.target;
      if (target.matches("[data-save-result]")) {
        const selected = new Set(selectedResultIds);
        if (target.checked) selected.add(target.dataset.saveResult); else selected.delete(target.dataset.saveResult);
        selectedResultIds = selected;
      } else if (target.matches("[data-deep-result]")) {
        if (target.checked) selectedDeepResultIds.add(target.dataset.deepResult); else selectedDeepResultIds.delete(target.dataset.deepResult);
      } else if (target.matches("[data-save-material]")) {
        if (target.checked) selectedMaterialIds.add(target.dataset.saveMaterial); else selectedMaterialIds.delete(target.dataset.saveMaterial);
      }
      renderResults(task);
    });
    $("social-research-results-list").addEventListener("click", event => {
      const button = event.target.closest("[data-toggle-material]");
      if (!button) return;
      const id = button.dataset.toggleMaterial;
      if (expandedMaterialIds.has(id)) expandedMaterialIds.delete(id); else expandedMaterialIds.add(id);
      renderResults(currentTask());
    });
    $("social-research-report-content").addEventListener("click", event => {
      const link = event.target.closest("[data-report-result]");
      if (link) {
        const materialTarget = link.dataset.reportMaterial && document.getElementById(`social-material-${link.dataset.reportMaterial}`);
        const resultTarget = document.getElementById(`social-result-${link.dataset.reportResult}`);
        (materialTarget || resultTarget)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    if (typeof desktopApi.socialSource?.onProgress === "function") {
      desktopApi.socialSource.onProgress(progress => {
        if (progress?.sourceId !== registeredSocialSource?.id) return;
        if (progress.state === "error" && progress.code === "PROCESS_CRASHED") {
          const sourcePlatforms = registeredSocialSource?.platforms;
          if (!Array.isArray(sourcePlatforms) || !sourcePlatforms.includes(progress.platform)
            || typeof progress.profileId !== "string"
            || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(progress.profileId)) return;
          loginErrors.set(runtimeStateKey(progress.platform, progress.profileId), {
            code: "PROCESS_CRASHED",
            message: sourceErrorMessage("PROCESS_CRASHED")
          });
          if (progress.platform === sourceProfilePlatform
            && progress.profileId === profileId(progress.platform)) renderSourceLifecycle();
          return;
        }
        if (progress.state === "stopped") {
          const stoppedTarget = { platform: progress.platform, profileId: progress.profileId };
          if (stoppedTarget.platform !== sourceProfilePlatform
            || stoppedTarget.profileId !== profileId(stoppedTarget.platform)) return;
          setRuntimeState(stoppedTarget.platform, stoppedTarget.profileId, "stopped");
          renderSourceLifecycle();
          refreshSourceEnvironment({ restorePreparation: false }).then(() => {
            if (sourceProfilePlatform === stoppedTarget.platform
              && profileId(stoppedTarget.platform) === stoppedTarget.profileId) {
              setRuntimeState(stoppedTarget.platform, stoppedTarget.profileId, "stopped");
              renderSourceLifecycle();
            }
          }).catch(error => {
            if (sourceProfilePlatform === stoppedTarget.platform
              && profileId(stoppedTarget.platform) === stoppedTarget.profileId) {
              setStatus(error.message || "刷新来源环境失败");
              renderSourceLifecycle();
            }
          });
          return;
        }
        sourceProgress = progress;
        sourceOperationId = progress.operationId || sourceOperationId;
        if (progress.state === "error") sourceFailure = {
          operationId: progress.operationId,
          code: progress.code,
          message: sourceErrorMessage(progress.code),
          recoverable: progress.recoverable === true
        };
        renderSourceLifecycle();
      });
    }
    refreshPlatforms().catch(error => setStatus(`平台列表读取失败：${error.message}`));
    render();
    return {
      refreshPlatforms,
      refreshSources: refreshPlatforms,
      render,
      getActiveTaskId: () => activeTaskId,
      async createPlanFromPromptAgent(input = {}) {
        const requestedPlatforms = Array.isArray(input.platforms) ? input.platforms : [...DOMESTIC_PLATFORM_IDS];
        let domesticPlatformIds = [...new Set(requestedPlatforms
          .map(platform => String(platform || "").trim().toLowerCase())
          .filter(platform => DOMESTIC_PLATFORM_IDS.has(platform)))];
        if (!domesticPlatformIds.length) domesticPlatformIds = [...DOMESTIC_PLATFORM_IDS];
        domesticPlatformIds = domesticPlatformIds.filter(platform => {
          const definition = platforms.find(item => item.platform === platform);
          return definition?.browserSearchRegistered === true && definition.supportsSearch === true;
        });
        if (!domesticPlatformIds.length) throw new Error("当前没有已注册的小红书、B 站、微博或知乎搜索适配器。");
        const task = await coordinator.createPlan({
          topic: String(input.topic || input.objective || '').trim(),
          template: 'fact-check',
          platforms: domesticPlatformIds,
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
