
// 最小可用反馈工作台：选择 HTML/图片附件 -> 打开隔离预览 -> 点选标注 -> 保存
window.ForwardStepPptFeedbackUI = (function () {
  async function createPptFeedbackUI({ document, sceneSchema, feedbackSchema, feedback, taskSchema, getState, persistState, notify } = {}) {
    const root = document?.getElementById("ppt-feedback-root");
    if (!root || typeof getState !== "function" || typeof persistState !== "function") {
      throw new TypeError("PPT 反馈工作台缺少必要依赖");
    }
    const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    let taskId = "";
    let status = "";
    let attachments = [];
    let annotations = [];
    let selectedAttachmentId = "";
    let bound = false;
    taskId = (getState()?.promptAgentTasks || []).find(task => task.pptScene)?.id || "";
    const getTask = () => (getState()?.promptAgentTasks || []).find(task => task.id === taskId);
    function saveFeedback(next) {
      const task = getTask();
      if (!task) return;
      const normalized = { ...taskSchema.normalizePromptAgentTask(task), pptScene: sceneSchema.normalizePptScene(task.pptScene) };
      const tasks = (getState()?.promptAgentTasks || []).map(item => item.id === taskId ? normalized : item);
      persistState({ ...getState(), promptAgentTasks: tasks });
    }
    function show(message) { status = message || ""; if (notify && message) notify(message); }
    async function refresh() {
      if (!window.desktopApi?.pptFeedback || !taskId) { attachments = []; annotations = (getTask()?.pptFeedback?.annotations || []); return; }
      const result = await window.desktopApi.pptFeedback.listAttachments(taskId);
      attachments = result?.attachments || result || [];
      annotations = getTask()?.pptFeedback?.annotations || [];
    }
    function render() {
      if (!window.desktopApi?.pptFeedback) {
        root.innerHTML = '<section class="social-panel"><h2>视觉反馈</h2><p>反馈附件与预览只在 Windows 桌面版可用。</p></section>';
        return;
      }
      if (!getTask()) {
        root.innerHTML = '<section class="social-panel"><h2>视觉反馈</h2><p>请先在上方创建 PPT 规划，再添加反馈附件。</p></section>';
        return;
      }
      const current = attachments.find(item => item.id === selectedAttachmentId) || attachments[0];
      root.innerHTML = '<section class="social-panel"><h2>视觉反馈工作台</h2>' +
        '<p>' + escape(status || "添加 HTML 或图片附件，在隔离预览中点选标注，再把选中评论交给下一轮提示词。") + '</p>' +
        '<div class="social-tools"><button class="button-secondary" type="button" data-ppt-fb-action="choose">选择 HTML / 图片附件</button></div>' +
        (attachments.length ? '<h3>附件</h3><ul>' + attachments.map(item =>
          '<li><button class="button-secondary" type="button" data-ppt-fb-open="' + escape(item.id) + '">' + escape(item.displayName || item.fileName || item.id) + '</button> ' +
          escape(item.mimeType || "") + (item.stale ? " · 版本已过期" : "") +
          ' <button class="button-secondary" type="button" data-ppt-fb-delete="' + escape(item.id) + '">删除</button></li>').join("") + '</ul>' : "") +
        (current ? '<h3>标注</h3><p>点击预览中的位置即可添加标注；此处先维护已有标注评论。</p>' +
          '<div id="ppt-fb-annotations">' + annotations.filter(item => item.attachmentId === current.id).map(item =>
            '<div class="field"><label class="field-label">标注 ' + escape(item.id) + '（' + escape(item.category || "other") + (item.status === "stale" ? " · 过期" : "") + '）</label>' +
            '<textarea data-ppt-fb-comment="' + escape(item.id) + '">' + escape(item.comment || "") + '</textarea>' +
            '<div class="social-tools"><button class="button-secondary" type="button" data-ppt-fb-save-annotation="' + escape(item.id) + '">保存评论</button>' +
            '<button class="button-secondary" type="button" data-ppt-fb-delete-annotation="' + escape(item.id) + '">删除标注</button></div></div>').join("") +
          '<button class="button-primary" type="button" data-ppt-fb-action="annotate">在预览中新增标注</button>' +
          '<button class="button-secondary" type="button" data-ppt-fb-action="copy-context">复制选中反馈给下一轮提示词</button></div>' : "") +
        '</section>';
    }
    async function run(action, value) {
      const api = window.desktopApi?.pptFeedback;
      if (!api || !taskId) return;
      if (action === "choose") {
        const result = await api.chooseFile(taskId);
        if (result && !result.canceled) { selectedAttachmentId = result.attachment?.id || ""; show("附件已加入，可打开预览标注。"); }
        await refresh();
      } else if (action === "open-preview") {
        const result = await api.openPreview(value);
        if (result?.error) show(result.error.message || result.error);
      } else if (action === "delete") {
        await api.deleteAttachment(value);
        if (selectedAttachmentId === value) selectedAttachmentId = "";
        await refresh();
      } else if (action === "annotate") {
        const current = attachments.find(item => item.id === selectedAttachmentId) || attachments[0];
        if (!current) return;
        const result = await api.saveAnnotation({ taskId, attachmentId: current.id, target: { kind: "point", x: 0.5, y: 0.5 }, comment: "请补充这条反馈的具体问题", category: "other" });
        if (result?.error) show(result.error.message || result.error);
        await refresh();
      } else if (action === "save-annotation") {
        const node = root.querySelector('[data-ppt-fb-comment="' + value + '"]');
        const existing = annotations.find(item => item.id === value);
        if (node && existing) {
          const result = await api.saveAnnotation({ ...existing, comment: node.value });
          if (result?.error) show(result.error.message || result.error);
          await refresh();
        }
      } else if (action === "delete-annotation") {
        const task = getTask();
        const nextAnnotations = (task?.pptFeedback?.annotations || []).filter(item => item.id !== value);
        saveFeedback({ ...task, pptFeedback: { ...(task.pptFeedback || { attachments: [] }), annotations: nextAnnotations } });
        await refresh();
      } else if (action === "copy-context") {
        const context = feedback.buildSelectedFeedbackContext({ annotations: annotations.filter(item => item.selected === true || item.attachmentId === selectedAttachmentId) });
        const text = JSON.stringify(context.groups || context, null, 2);
        try { await navigator.clipboard.writeText(text); show("选中反馈已复制。"); } catch { show("复制失败，请手动复制。"); }
      }
      render();
    }
    function bind() {
      if (bound) return;
      bound = true;
      root.addEventListener("click", async event => {
        const button = event.target.closest?.("[data-ppt-fb-action],[data-ppt-fb-open],[data-ppt-fb-delete],[data-ppt-fb-save-annotation],[data-ppt-fb-delete-annotation]");
        if (!button) return;
        const action = button.dataset.pptFbAction || (button.dataset.pptFbOpen ? "open-preview" : button.dataset.pptFbDelete ? "delete" : button.dataset.pptFbSaveAnnotation ? "save-annotation" : "delete-annotation");
        const value = button.dataset.pptFbOpen || button.dataset.pptFbDelete || button.dataset.pptFbSaveAnnotation || button.dataset.pptFbDeleteAnnotation || "";
        try { await run(action, value); }
        catch (error) { show(error.message || String(error)); render(); }
      });
    }
    await refresh();
    bind();
    render();
    return { render, openTask(id) { taskId = id; refresh().then(render); } };
  }
  return { createPptFeedbackUI };
})();
