
// 最小可用反馈工作台：选择 HTML/图片附件 -> 打开隔离预览 -> 点选标注 -> 保存
window.ForwardStepPptFeedbackUI = (function () {
  async function createPptFeedbackUI({ document, feedback, getState, notify } = {}) {
    const root = document?.getElementById("ppt-feedback-root");
    if (!root || typeof getState !== "function") {
      throw new TypeError("PPT 反馈工作台缺少必要依赖");
    }
    const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    let taskId = "";
    let status = "";
    let attachments = [];
    let deletedAttachments = [];
    let annotations = [];
    let contextBatchIndex = 0;
    let selectedAttachmentId = "";
    let pendingDeleteAttachmentId = "";
    let bound = false;
    taskId = (getState()?.promptAgentTasks || []).find(task => task.pptScene)?.id || "";
    const getTask = () => (getState()?.promptAgentTasks || []).find(task => task.id === taskId);
    function show(message) { status = message || ""; if (notify && message) notify(message); }
    async function refresh() {
      contextBatchIndex = 0;
      if (!window.desktopApi?.pptFeedback || !taskId) { attachments = []; deletedAttachments = []; annotations = (getTask()?.pptFeedback?.annotations || []); return; }
      const [result, deletedResult] = await Promise.all([
        window.desktopApi.pptFeedback.listAttachments(taskId),
        window.desktopApi.pptFeedback.listDeletedAttachments(taskId)
      ]);
      attachments = result?.attachments || result || [];
      deletedAttachments = deletedResult?.attachments || [];
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
      const pendingDelete = attachments.find(item => item.id === pendingDeleteAttachmentId);
      const referencedCount = pendingDelete ? annotations.filter(item => item.attachmentId === pendingDelete.id).length : 0;
      root.innerHTML = '<section class="social-panel"><h2>视觉反馈工作台</h2>' +
        '<p>' + escape(status || "添加 HTML 或图片附件，在隔离预览中点选标注，再把选中评论交给下一轮提示词。") + '</p>' +
        '<div class="social-tools"><button class="button-secondary" type="button" data-ppt-fb-action="choose">选择 HTML / 图片附件</button></div>' +
        (pendingDelete ? '<div class="field"><strong>确认移除“' + escape(pendingDelete.displayName || pendingDelete.id) + '”？</strong><p>此资料将从当前列表移除；' + referencedCount + ' 条关联批注与提示词文本会保留，并可从“最近移除”恢复。</p><div class="social-tools"><button class="button-secondary" type="button" data-ppt-fb-confirm-delete="' + escape(pendingDelete.id) + '">确认移除</button><button class="button-secondary" type="button" data-ppt-fb-cancel-delete>取消</button></div></div>' : '') +
        (attachments.length ? '<h3>附件</h3><ul>' + attachments.map(item =>
          '<li><button class="button-secondary" type="button" data-ppt-fb-open="' + escape(item.id) + '">' + escape(item.displayName || item.fileName || item.id) + '</button> ' +
          escape(item.mimeType || "") + (item.stale ? " · 版本已过期" : "") +
          ' <button class="button-secondary" type="button" data-ppt-fb-delete="' + escape(item.id) + '">移除</button></li>').join("") + '</ul>' : "") +
        (deletedAttachments.length ? '<h3>最近移除</h3><ul>' + deletedAttachments.map(item =>
          '<li>' + escape(item.displayName || item.id) + ' · ' + escape(item.mimeType || '') +
          ' <button class="button-secondary" type="button" data-ppt-fb-restore="' + escape(item.id) + '">恢复</button></li>').join("") + '</ul>' : '') +
        (current ? '<h3>标注</h3><p>点击预览中的位置即可添加标注；此处先维护已有标注评论。</p>' +
          '<div id="ppt-fb-annotations">' + annotations.filter(item => item.attachmentId === current.id).map(item => {
            const deleted = item.status === "deleted";
            const stale = item.status === "stale";
            const action = deleted
              ? '<button class="button-secondary" type="button" data-ppt-fb-restore-annotation="' + escape(item.id) + '" ' + (stale ? 'disabled' : '') + '>恢复标注</button>'
              : '<button class="button-secondary" type="button" data-ppt-fb-delete-annotation="' + escape(item.id) + '" ' + (stale ? 'disabled' : '') + '>撤销标注</button>';
            const state = deleted ? " · 已撤销" : stale ? " · 版本已过期" : "";
            return '<div class="field"><label class="field-label">标注 ' + escape(item.id) + '（' + escape(item.category || "other") + state + '）</label>' +
              '<textarea data-ppt-fb-comment="' + escape(item.id) + '" ' + (deleted ? 'disabled' : '') + '>' + escape(item.comment || "") + '</textarea>' +
              '<div class="social-tools"><button class="button-secondary" type="button" data-ppt-fb-save-annotation="' + escape(item.id) + '" ' + (deleted || stale ? 'disabled' : '') + '>保存评论</button>' + action + '</div></div>';
          }).join("") +
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
        pendingDeleteAttachmentId = value;
      } else if (action === "cancel-delete") {
        pendingDeleteAttachmentId = "";
      } else if (action === "confirm-delete") {
        const count = annotations.filter(item => item.attachmentId === value).length;
        await api.deleteAttachment(taskId, value);
        if (selectedAttachmentId === value) selectedAttachmentId = "";
        pendingDeleteAttachmentId = "";
        show(`资料已移除；${count} 条批注保留，可从最近移除恢复。`);
        await refresh();
      } else if (action === "restore-attachment") {
        await api.restoreAttachment(taskId, value);
        selectedAttachmentId = value;
        show("资料已恢复，原批注继续关联原版本。");
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
        const existing = annotations.find(item => item.id === value);
        if (!existing || existing.status !== "active") return;
        await api.saveAnnotation({ ...existing, status: "deleted", selected: false });
        show("批注已撤销，原记录可恢复。");
        await refresh();
      } else if (action === "restore-annotation") {
        const existing = annotations.find(item => item.id === value);
        if (!existing || existing.status !== "deleted") return;
        await api.saveAnnotation({ ...existing, status: "active", selected: false });
        show("批注已恢复；确认后可重新纳入提示词。");
        await refresh();
      } else if (action === "copy-context") {
        const context = feedback.buildSelectedFeedbackContext(annotations);
        const batches = context.batches || [context];
        if (!batches.length) { show("没有可复制的已选批注。"); render(); return; }
        const index = contextBatchIndex % batches.length;
        const batch = batches[index];
        try {
          await navigator.clipboard.writeText(JSON.stringify(batch.groups || batch, null, 2));
          contextBatchIndex = (index + 1) % batches.length;
          const remaining = batches.slice(index + 1).reduce((sum, item) => sum + item.itemCount, 0);
          show(batches.length > 1
            ? remaining ? `已复制第 ${index + 1}/${batches.length} 批（${batch.itemCount} 条），还剩 ${remaining} 条。` : `已复制第 ${index + 1}/${batches.length} 批（${batch.itemCount} 条），全部意见已复制。`
            : `已复制 ${batch.itemCount} 条选中反馈。`);
        } catch { show("复制失败，请手动复制。"); }
      }
      render();
    }
    function bind() {
      if (bound) return;
      bound = true;
      root.addEventListener("click", async event => {
        const button = event.target.closest?.("[data-ppt-fb-action],[data-ppt-fb-open],[data-ppt-fb-delete],[data-ppt-fb-save-annotation],[data-ppt-fb-delete-annotation],[data-ppt-fb-restore-annotation],[data-ppt-fb-confirm-delete],[data-ppt-fb-cancel-delete],[data-ppt-fb-restore]");
        if (!button) return;
        const action = button.dataset.pptFbAction || (button.dataset.pptFbOpen ? "open-preview" : button.dataset.pptFbDelete ? "delete" : button.dataset.pptFbConfirmDelete ? "confirm-delete" : button.dataset.pptFbCancelDelete !== undefined ? "cancel-delete" : button.dataset.pptFbRestoreAnnotation ? "restore-annotation" : button.dataset.pptFbRestore ? "restore-attachment" : button.dataset.pptFbSaveAnnotation ? "save-annotation" : "delete-annotation");
        const value = button.dataset.pptFbOpen || button.dataset.pptFbDelete || button.dataset.pptFbConfirmDelete || button.dataset.pptFbRestoreAnnotation || button.dataset.pptFbRestore || button.dataset.pptFbSaveAnnotation || button.dataset.pptFbDeleteAnnotation || "";
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
