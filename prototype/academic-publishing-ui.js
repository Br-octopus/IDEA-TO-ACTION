(function (root, factory) {
  const publishing = typeof module === 'object' && module.exports && typeof require === 'function'
    ? require('./academic-publishing.js')
    : root.ForwardStepAcademicPublishing;
  const api = factory(publishing);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepAcademicPublishingUI = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (publishing) {
  'use strict';

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const read = (root, id) => root.querySelector?.(`#${id}`) || null;
  const value = (root, id) => read(root, id)?.value ?? '';
  const checked = (root, id) => read(root, id)?.checked === true;
  const optionList = (items, selected) => items.map(([key, label]) => `<option value="${escapeHtml(key)}"${key === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const CLAIM_LABELS = [
    ['unassessed', '未核对'], ['supports', '支持'], ['partially-supports', '部分支持'],
    ['does-not-support', '不支持'], ['contradicts', '相冲突'], ['insufficient', '证据不足']
  ];
  const METADATA_LABELS = [['unverified', '未核验'], ['registry-returned', '登记机构返回'], ['user-verified', '用户已核对']];
  const READING_LABELS = [
    ['unread', '未读'], ['title-only', '仅看题名'], ['abstract-only', '仅看摘要'],
    ['excerpt-only', '仅看摘录'], ['full-text-user-confirmed', '用户确认看过全文']
  ];
  const REVIEW_LABELS = [['unresolved', '未解决'], ['planned', '仅计划修改'], ['revised', '已实际修改'], ['no-change', '决定不修改']];
  const CHECKLIST_LABELS = [['todo', '待核对'], ['complete', '用户已核对'], ['not-applicable', '不适用'], ['blocked', '受阻']];
  const TASK_LABELS = [['citation-check', '引用证据核验'], ['reviewer-response', '审稿回复'], ['submission-prep', '投稿准备']];

  function createAcademicPublishingUI({
    root, coordinator, getKnowledgeEntries = () => [], lookup = async () => { throw new Error('题录查询不可用'); },
    confirm = message => globalThis.confirm?.(message) ?? false, clipboard = async () => {}, notify = () => {}
  } = {}) {
    if (!root || !coordinator) throw new TypeError('学术核验工作台缺少根节点或协调器');
    let activeProjectId = '';
    let activeHistoryId = '';
    let selectedLiteratureIds = new Set();
    let lookupDiffs = new Map();
    let statusMessage = '项目默认仅保存在当前会话；开启本机保存后才写入磁盘。';
    let listenersBound = false;

    function projects() { return coordinator.listProjects?.() || []; }
    function project() { return coordinator.getProject?.(activeProjectId) || null; }
    function literatureEntries() {
      return (getKnowledgeEntries() || []).filter(entry => entry?.type === 'academic-literature');
    }
    function renderCreate() {
      return `<section class="academic-publishing-card"><h3>新建任务</h3><div class="extra-grid">
        <label>项目标题<input id="publishing-create-title" maxlength="300" placeholder="例如：第二轮审稿与投稿核对"></label>
        <label>目标期刊/机构<input id="publishing-create-venue" maxlength="300" placeholder="未确定可留空"></label>
      </div><button type="button" class="button-primary" data-action="publishing-create-project">创建学术任务</button></section>`;
    }
    function renderProjects(all) {
      if (!all.length) return '<p class="library-meta">还没有学术核验项目。可按任务单独建立引用核验、审稿回复或投稿准备项目。</p>';
      return `<div class="academic-publishing-projects">${all.map(item => `<button type="button" data-action="publishing-select-project" data-project-id="${escapeHtml(item.id)}" class="${item.id === activeProjectId ? 'active' : ''}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.target.venue || '目标未填写')} · ${item.saveEnabled ? '已保存' : '当前会话'}</span></button>`).join('')}</div>`;
    }
    function renderProjectHead(current) {
      return `<section class="academic-publishing-card"><div class="block-top"><div><h3>${escapeHtml(current.title)}</h3><p class="library-meta">基础包 ${escapeHtml(current.packSnapshot.name || '学术核验与投稿准备')} v${current.packSnapshot.version} · 来源状态保留在项目快照中</p></div>
        <label class="check-row"><input type="checkbox" data-action="publishing-toggle-save"${current.saveEnabled ? ' checked' : ''}>保存到本机</label><button type="button" class="button-secondary" data-action="publishing-delete-project">删除项目</button></div>
        <div class="extra-grid"><label>当前任务<select id="publishing-task-type" data-action="publishing-task-type">${optionList(TASK_LABELS, current.taskType)}</select></label>
        <label>目标期刊/机构<input id="publishing-target-venue" value="${escapeHtml(current.target.venue)}" maxlength="300"></label>
        <label>投稿类型<input id="publishing-target-submission-type" value="${escapeHtml(current.target.submissionType)}" maxlength="200"></label>
        <label>稿件版本<input id="publishing-target-manuscript-version" value="${escapeHtml(current.target.manuscriptVersion)}" maxlength="160"></label>
        <label>要求版本/日期<input id="publishing-target-requirement-version" value="${escapeHtml(current.target.requirementVersion || current.target.effectiveDate)}" maxlength="160"></label>
        <label class="wide">项目备注<textarea id="publishing-target-note" maxlength="2000">${escapeHtml(current.target.note)}</textarea></label></div>
        <button type="button" class="button-secondary" data-action="publishing-save-target">保存目标信息</button></section>`;
    }
    function renderLiteraturePicker() {
      const entries = literatureEntries();
      if (!entries.length) return '<p class="library-meta">文献库里还没有学术文献；可先到“学术文献库”导入 RIS/BibTeX 或手动添加题录。</p>';
      return `<div class="academic-publishing-literature">${entries.map(entry => `<label class="check-row"><input type="checkbox" data-action="publishing-select-literature" data-entry-id="${escapeHtml(entry.id)}"${selectedLiteratureIds.has(entry.id) ? ' checked' : ''}><span>${escapeHtml(entry.title)} · ${escapeHtml(entry.literature?.year || '年份未填写')} · ${escapeHtml(entry.literature?.metadataStatus || 'unverified')}</span></label>`).join('')}</div>`;
    }
    function renderCitationClaims(current) {
      const claims = current.citationClaims.map(claim => `<article class="academic-publishing-item"><label class="check-row"><input type="checkbox" data-action="publishing-select-claim" data-pub-select="${escapeHtml(claim.id)}"><strong>${escapeHtml(claim.statement)}</strong></label>
        <p class="library-meta">稿件位置：${escapeHtml(claim.manuscriptLocation || '未提供')} · 来源 ${claim.sources.length}</p>
        ${claim.sources.length ? claim.sources.map(source => {
          const key = `${claim.id}:${source.id}`;
          const differences = lookupDiffs.get(key) || [];
          return `<div class="academic-publishing-source"><strong>${escapeHtml(source.snapshot.title || source.knowledgeEntryId || '未命名文献')}</strong>
            <p class="library-meta">${escapeHtml(source.snapshot.authors.join('；'))} · ${escapeHtml(source.snapshot.year)} · DOI ${escapeHtml(source.snapshot.doi || '—')} · PMID ${escapeHtml(source.snapshot.pmid || '—')}</p>
            <div class="extra-grid"><label>题录状态<select data-pub-metadata="${escapeHtml(source.id)}" data-claim-id="${escapeHtml(claim.id)}">${optionList(METADATA_LABELS, source.metadataStatus)}</select></label>
              <label>本人阅读范围<select data-pub-reading="${escapeHtml(source.id)}" data-claim-id="${escapeHtml(claim.id)}">${optionList(READING_LABELS, source.readingStatus)}</select></label>
              <label>论断关系<select data-pub-relation="${escapeHtml(source.id)}" data-claim-id="${escapeHtml(claim.id)}">${optionList(CLAIM_LABELS, source.relation)}</select></label>
              <label>证据位置<input id="pub-evidence-location-${escapeHtml(source.id)}" value="${escapeHtml(source.evidenceLocation)}" maxlength="300"></label>
              <label class="wide">用户提供的证据摘录<textarea id="pub-evidence-excerpt-${escapeHtml(source.id)}" maxlength="1200">${escapeHtml(source.evidenceExcerpt)}</textarea></label>
              <label class="wide">核验备注<textarea id="pub-source-note-${escapeHtml(source.id)}" maxlength="2000">${escapeHtml(source.userNote)}</textarea></label></div>
            <div class="button-row"><button type="button" class="button-secondary" data-action="publishing-save-source" data-claim-id="${escapeHtml(claim.id)}" data-source-id="${escapeHtml(source.id)}">保存核验记录</button>
              ${source.snapshot.doi || source.snapshot.pmid ? `<button type="button" class="button-secondary" data-action="publishing-lookup-metadata" data-claim-id="${escapeHtml(claim.id)}" data-source-id="${escapeHtml(source.id)}">查询登记题录差异</button>` : ''}
              <button type="button" class="button-secondary" data-action="publishing-confirm-metadata" data-claim-id="${escapeHtml(claim.id)}" data-source-id="${escapeHtml(source.id)}">我已人工核对题录</button></div>
            ${differences.length ? `<div class="notice"><strong>登记结果与本地题录存在差异（未自动写入）</strong><ul>${differences.map(item => `<li>${escapeHtml(item.label)}：本地“${escapeHtml(item.existing)}” / 登记“${escapeHtml(item.returned)}”</li>`).join('')}</ul></div>` : ''}</div>`;
        }).join('') : '<p class="library-meta">尚未关联文献。关联来源后再判断，不要仅凭题名推定支持关系。</p>'}</article>`).join('');
      const coverage = coordinator.getCitationCoverage(current.id);
      return `<section class="academic-publishing-card"><h3>引用证据核验</h3><p>已建 ${coverage.claims} 条论断 · ${coverage.unassessed} 个来源关系待核对 · ${coverage.conflicts} 条存在相反来源。这里不计算“引用正确率”。</p>
        <label>稿件论断<textarea id="publishing-claim-text" maxlength="5000" placeholder="粘贴需要核对的具体论断"></textarea></label>
        <label>稿件位置<input id="publishing-claim-location" maxlength="500" placeholder="页码、章节或段落"></label>
        <details><summary>关联文献库中的来源</summary>${renderLiteraturePicker()}</details>
        <button type="button" class="button-primary" data-action="publishing-add-claim">添加论断与来源</button>
        <button type="button" class="button-secondary" data-action="publishing-generate-prompt">为勾选论断生成核验提示词</button>
        <div class="academic-publishing-list">${claims || '<p class="library-meta">还没有论断记录。</p>'}</div>
        <p class="library-meta">登记题录、题名或摘要不证明正文支持论断；请记录你实际查看的摘录/全文范围和原文位置。</p></section>`;
    }
    function renderReviewer(current) {
      const rounds = current.reviewerRounds;
      const comments = rounds.flatMap(round => round.comments.map(comment => ({ ...comment, roundTitle: round.title, roundId: round.id })));
      const coverage = coordinator.getReviewerCoverage(current.id);
      return `<section class="academic-publishing-card"><h3>逐条回应审稿意见</h3><p>意见 ${coverage.total} 条 · 已有实际处理依据 ${coverage.completed} 条 · 仅计划 ${coverage.planned} 条 · 未解决 ${coverage.unresolved} 条。</p>
        <div class="extra-grid"><label>审稿轮次<input id="publishing-review-round-title" maxlength="240" placeholder="例如：第一轮修回"></label><label>编辑决定<input id="publishing-review-round-decision" maxlength="500"></label>
          <label>审稿人/编辑<input id="publishing-reviewer" maxlength="160" placeholder="审稿人 1"></label><label>意见对应稿件位置<input id="publishing-review-comment-location" maxlength="500"></label>
          <label class="wide">审稿意见原文<textarea id="publishing-review-comment" maxlength="5000" placeholder="粘贴一条意见；原文可能受保密要求约束"></textarea></label></div>
        <button type="button" class="button-primary" data-action="publishing-add-review-comment">建立轮次并添加意见</button>
        <button type="button" class="button-secondary" data-action="publishing-generate-prompt">为勾选意见生成回应提示词</button>
        ${comments.map(comment => `<article class="academic-publishing-item"><label class="check-row"><input type="checkbox" data-pub-select="${escapeHtml(comment.id)}"><strong>${escapeHtml(comment.reviewer || '审稿意见')} · ${escapeHtml(comment.roundTitle)}</strong></label>
          <blockquote>${escapeHtml(comment.rawComment)}</blockquote><p class="library-meta">意见位置：${escapeHtml(comment.manuscriptLocation || '未提供')}</p>
          <div class="extra-grid"><label>回应草稿<textarea id="pub-response-${escapeHtml(comment.id)}" maxlength="5000">${escapeHtml(comment.responseDraft)}</textarea></label>
            <label>处理状态<select data-pub-review-status="${escapeHtml(comment.id)}">${optionList(REVIEW_LABELS, comment.status)}</select></label>
            <label>实际改动摘要<input id="pub-change-summary-${escapeHtml(comment.id)}" value="${escapeHtml(comment.changeSummary)}" maxlength="2000"></label>
            <label>实际改动位置<input id="pub-change-location-${escapeHtml(comment.id)}" value="${escapeHtml(comment.changeLocation)}" maxlength="500"></label>
            <label>改动后摘录<textarea id="pub-after-excerpt-${escapeHtml(comment.id)}" maxlength="1200">${escapeHtml(comment.afterExcerpt)}</textarea></label>
            <label>不修改理由<textarea id="pub-no-change-reason-${escapeHtml(comment.id)}" maxlength="2000">${escapeHtml(comment.noChangeReason)}</textarea></label></div>
          <button type="button" class="button-secondary" data-action="publishing-save-review-comment" data-round-id="${escapeHtml(comment.roundId)}" data-comment-id="${escapeHtml(comment.id)}">保存回应与实际动作</button></article>`).join('') || '<p class="library-meta">添加审稿轮次和意见后逐条记录。</p>'}
        <p class="academic-publishing-confidentiality">审稿材料可能保密。复制到外部模型前，请先核对目标期刊许可和保密条件。</p></section>`;
    }
    function renderSubmission(current) {
      const requirements = current.requirements;
      const coverage = coordinator.getChecklistCoverage(current.id);
      return `<section class="academic-publishing-card"><h3>目标要求与投稿清单</h3><p>检查项 ${coverage.total} 条 · 用户标记完成 ${coverage.complete} 条 · 待核对 ${coverage.todo} 条 · 受阻 ${coverage.blocked} 条。</p>
        <p class="academic-publishing-confidentiality">清单状态只记录用户核对进度，不代表投稿合规通过。</p>
        <details><summary>添加目标期刊/机构的要求来源</summary><div class="extra-grid">
          <label>要求标题<input id="publishing-requirement-title" maxlength="300"></label><label>发布机构<input id="publishing-requirement-issuer" maxlength="300"></label>
          <label>版本/日期<input id="publishing-requirement-version" maxlength="160"></label><label>来源链接<input id="publishing-requirement-url" maxlength="1000"></label>
          <label class="wide">用户提供的要求原文/摘录<textarea id="publishing-requirement-body" maxlength="5000"></textarea></label>
          <label>适用性说明<input id="publishing-requirement-applicability" maxlength="1000"></label>
        </div><button type="button" class="button-secondary" data-action="publishing-add-requirement">保存要求来源</button></details>
        ${requirements.length ? `<div class="academic-publishing-list">${requirements.map(item => `<article class="academic-publishing-item"><strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(item.issuer || '发布机构未填写')} · ${escapeHtml(item.version || '版本未填写')}<p>${escapeHtml(item.body || '未提供要求原文')}<br>${escapeHtml(item.sourceUrl || '来源链接未提供')}</p>
          <div class="extra-grid"><label>用户核对状态<select data-pub-requirement-status="${escapeHtml(item.id)}">${optionList([['unverified', '未核对'], ['source-reviewed', '已查看来源'], ['user-confirmed', '用户已确认适用']], item.verificationStatus)}</select></label>
            <label>核对的来源位置<input data-pub-requirement-locator="${escapeHtml(item.id)}" value="${escapeHtml(item.sourceLocator)}" maxlength="500" placeholder="网页标题、章节或条款"></label></div>
          <button type="button" class="button-secondary" data-action="publishing-save-requirement" data-requirement-id="${escapeHtml(item.id)}">保存要求核对记录</button>
          <p class="library-meta">此状态只记录你查看来源的进度和判断，不构成投稿合规认证。</p></article>`).join('')}</div>` : '<p class="library-meta">没有目标要求来源；请先从期刊/机构官方页面核对当前版本。</p>'}
        <div class="extra-grid"><label>清单项<input id="publishing-check-title" maxlength="300" placeholder="例如：匿名稿未包含作者信息"></label>
          <label>关联要求来源<select id="publishing-check-requirement"><option value="">选择来源或标记自定义</option>${requirements.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('')}</select></label>
          <label>预期内容<input id="publishing-check-expected" maxlength="2000"></label><label class="check-row"><input type="checkbox" id="publishing-check-custom">这是我自定义的检查项</label></div>
        <button type="button" class="button-primary" data-action="publishing-add-check">添加清单项</button>
        <button type="button" class="button-secondary" data-action="publishing-generate-prompt">为勾选检查项生成投稿准备提示词</button>
        <div class="academic-publishing-list">${current.checklist.map(item => `<article class="academic-publishing-item"><strong>${escapeHtml(item.title)}</strong><p class="library-meta">${escapeHtml(requirements.find(req => req.id === item.requirementId)?.title || (item.custom ? '用户自定义项' : '来源缺失'))}</p>
          <div class="extra-grid"><label>状态<select data-pub-check-status="${escapeHtml(item.id)}">${optionList(CHECKLIST_LABELS, item.status)}</select></label>
            <label>核对证据<input id="pub-check-evidence-${escapeHtml(item.id)}" value="${escapeHtml(item.evidence)}" maxlength="2000"></label>
            <label>理由<input id="pub-check-reason-${escapeHtml(item.id)}" value="${escapeHtml(item.reason)}" maxlength="2000"></label></div>
          <button type="button" class="button-secondary" data-action="publishing-save-check" data-check-id="${escapeHtml(item.id)}">保存用户核对状态</button>
          <label class="check-row"><input type="checkbox" data-pub-select="${escapeHtml(item.id)}">选入投稿准备提示词</label></article>`).join('') || '<p class="library-meta">添加目标要求并建立逐项核对清单。</p>'}</div></section>`;
    }
    function renderHistory(current) {
      const active = current.history.find(item => item.id === activeHistoryId) || current.history[0];
      if (active && !activeHistoryId) activeHistoryId = active.id;
      return `<section class="academic-publishing-card"><h3>本轮提示词与外部结果</h3>
        ${current.history.length ? `<label>提示词版本<select id="publishing-history-select" data-action="publishing-select-history">${current.history.map(item => `<option value="${escapeHtml(item.id)}"${item.id === active?.id ? ' selected' : ''}>${escapeHtml(TASK_LABELS.find(([key]) => key === item.taskType)?.[1] || item.taskType)} · ${escapeHtml(item.createdAt || '未标时间')} · ${escapeHtml(item.status)}</option>`).join('')}</select></label>
          <label>可编辑提示词<textarea id="publishing-prompt" maxlength="8000">${escapeHtml(active?.prompt || '')}</textarea></label>
          <div class="button-row"><button type="button" class="button-secondary" data-action="publishing-save-prompt">保存为新版本</button><button type="button" class="button-secondary" data-action="publishing-copy-prompt">复制提示词</button></div>
          <label>外部结果（模拟结果请明确选择“模拟”）<textarea id="publishing-result" maxlength="20000" placeholder="粘贴外部 AI 或人工检查结果；不会自动改变核验结论"></textarea></label>
          <label>结果来源<select id="publishing-result-source"><option value="external-copy">外部复制结果</option><option value="simulation">模拟结果</option><option value="manual">人工记录</option></select></label>
          <button type="button" class="button-secondary" data-action="publishing-store-result" data-history-id="${escapeHtml(active?.id || '')}">保存为待复核结果</button>
          ${active?.result ? `<div class="academic-publishing-result"><strong>结果状态：待用户逐条复核 · 来源：${escapeHtml(active.resultSource)}</strong><p>${escapeHtml(active.result)}</p></div>` : ''}` : '<p class="library-meta">选择记录后再生成提示词；结果仅保存在明确开启本机保存的项目中。</p>'}
      </section>`;
    }
    function render() {
      const all = projects();
      let current = all.find(item => item.id === activeProjectId) || null;
      if (!current && activeProjectId) activeProjectId = '';
      const taskSection = current ? current.taskType === 'citation-check' ? renderCitationClaims(current)
        : current.taskType === 'reviewer-response' ? renderReviewer(current) : renderSubmission(current) : '';
      root.innerHTML = `<section class="academic-publishing-manager" aria-labelledby="academic-publishing-heading">
        <div class="block-top"><div><h2 id="academic-publishing-heading">学术核引、审稿回复与投稿准备</h2><p>记录可追溯证据和用户实际处理；登记结果、模型建议与通用清单都不等于专业核验。</p></div></div>
        <p class="academic-publishing-status" role="status" aria-live="polite">${escapeHtml(statusMessage)}</p>
        ${renderProjects(all)}${renderCreate()}
        ${current ? `${renderProjectHead(current)}${taskSection}${renderHistory(current)}` : ''}
      </section>`;
      bindListeners();
      return root.innerHTML;
    }
    async function run(operation, successMessage) {
      try {
        await operation();
        statusMessage = successMessage;
        notify(successMessage);
        render();
        return true;
      } catch (error) {
        statusMessage = error.message || '操作失败。已保留当前表单和项目记录。';
        notify(statusMessage);
        const status = root.querySelector?.('.academic-publishing-status');
        if (status) status.textContent = statusMessage;
        return false;
      }
    }
    function actionFrom(event) {
      const target = event.target?.closest?.('[data-action]') || event.target;
      return { target, action: target?.dataset?.action || '', data: target?.dataset || {} };
    }
    function selectedIds() {
      return [...(root.querySelectorAll?.('[data-pub-select]') || [])].filter(item => item.checked).map(item => item.dataset.pubSelect);
    }
    function sourceFor(projectId, claimId, sourceId) {
      const claim = coordinator.getProject(projectId)?.citationClaims.find(item => item.id === claimId);
      return claim?.sources.find(item => item.id === sourceId) || null;
    }
    async function handleClick(event) {
      const { target, action, data } = actionFrom(event);
      // 复选框的默认切换由浏览器完成；取消点击会阻止随后产生 change。
      if (target?.type === 'checkbox') return;
      if (!action) return;
      event.preventDefault?.();
      const current = project();
      if (action === 'publishing-create-project') {
        await run(async () => {
          const created = await coordinator.createProject({ title: value(root, 'publishing-create-title') || '学术核验项目', target: { venue: value(root, 'publishing-create-venue') } });
          activeProjectId = created.id; activeHistoryId = ''; selectedLiteratureIds.clear();
        }, '学术任务已创建，仅保存在当前会话。');
      } else if (action === 'publishing-select-project') {
        activeProjectId = data.projectId || ''; activeHistoryId = ''; selectedLiteratureIds.clear(); lookupDiffs.clear(); render();
      } else if (!current) return;
      else if (action === 'publishing-delete-project') {
        if (!confirm(`删除“${current.title}”项目？文献库中的记录不会删除。`)) return;
        await run(async () => { await coordinator.deleteProject(current.id); activeProjectId = ''; activeHistoryId = ''; }, '项目已删除，文献库记录保留。');
      } else if (action === 'publishing-save-target') {
        await run(() => coordinator.updateProject(current.id, { target: {
          venue: value(root, 'publishing-target-venue'),
          submissionType: value(root, 'publishing-target-submission-type'),
          manuscriptVersion: value(root, 'publishing-target-manuscript-version'),
          requirementVersion: value(root, 'publishing-target-requirement-version'),
          note: value(root, 'publishing-target-note')
        } }), '目标信息已保存。');
      } else if (action === 'publishing-add-claim') {
        const ids = [...selectedLiteratureIds];
        await run(() => coordinator.addCitationClaim(current.id, {
          statement: value(root, 'publishing-claim-text'), manuscriptLocation: value(root, 'publishing-claim-location')
        }, ids), '论断与文献来源已记录；关系仍需依据原文核对。');
        selectedLiteratureIds.clear();
      } else if (action === 'publishing-save-source') {
        const relation = root.querySelector?.(`[data-pub-relation="${data.sourceId}"][data-claim-id="${data.claimId}"]`)?.value || 'unassessed';
        const metadataStatus = root.querySelector?.(`[data-pub-metadata="${data.sourceId}"][data-claim-id="${data.claimId}"]`)?.value || 'unverified';
        const readingStatus = root.querySelector?.(`[data-pub-reading="${data.sourceId}"][data-claim-id="${data.claimId}"]`)?.value || 'unread';
        await run(() => coordinator.updateCitationSource(current.id, data.claimId, data.sourceId, {
          relation, metadataStatus, readingStatus,
          evidenceLocation: value(root, `pub-evidence-location-${data.sourceId}`),
          evidenceExcerpt: value(root, `pub-evidence-excerpt-${data.sourceId}`),
          userNote: value(root, `pub-source-note-${data.sourceId}`)
        }), '核验记录已保存。');
      } else if (action === 'publishing-confirm-metadata') {
        await run(() => coordinator.updateCitationSource(current.id, data.claimId, data.sourceId, { metadataStatus: 'user-verified' }), '已记录为用户人工核对题录；论断关系保持原状态。');
      } else if (action === 'publishing-lookup-metadata') {
        const source = sourceFor(current.id, data.claimId, data.sourceId);
        if (!source) return;
        const type = source.snapshot.doi ? 'doi' : 'pmid';
        const identifier = source.snapshot.doi || source.snapshot.pmid;
        if (!confirm(`本次只向登记机构发送单个 ${type.toUpperCase()} 标识符（${identifier}），不发送稿件论断、摘录或审稿意见。是否继续？`)) return;
        await run(async () => {
          const returned = await lookup(type, identifier);
          const differences = coordinator.compareBibliography(current.id, data.claimId, data.sourceId, returned);
          lookupDiffs.set(`${data.claimId}:${data.sourceId}`, differences);
          if (!differences.length) statusMessage = '登记题录查询完成，未发现已填写字段差异；状态未自动提升。';
        }, '登记题录已取得；请人工比较字段，系统未自动更改状态。');
      } else if (action === 'publishing-add-review-comment') {
        await run(async () => {
          const rounds = current.reviewerRounds;
          let round = rounds.at(-1);
          const roundTitle = value(root, 'publishing-review-round-title').trim();
          if (!round || (roundTitle && round.title !== roundTitle)) round = (await coordinator.addReviewerRound(current.id, {
            title: roundTitle || `第 ${rounds.length + 1} 轮`, decision: value(root, 'publishing-review-round-decision')
          })).reviewerRounds.find(item => item.title === (roundTitle || `第 ${rounds.length + 1} 轮`));
          await coordinator.addReviewerComment(current.id, round.id, {
            reviewer: value(root, 'publishing-reviewer'), rawComment: value(root, 'publishing-review-comment'),
            manuscriptLocation: value(root, 'publishing-review-comment-location')
          });
        }, '审稿意见已逐条记录；尚未登记的修改不会写成已完成。');
      } else if (action === 'publishing-save-review-comment') {
        const status = root.querySelector?.(`[data-pub-review-status="${data.commentId}"]`)?.value || 'unresolved';
        await run(() => coordinator.resolveReviewerComment(current.id, data.roundId, data.commentId, {
          status,
          responseDraft: value(root, `pub-response-${data.commentId}`),
          changeSummary: value(root, `pub-change-summary-${data.commentId}`),
          changeLocation: value(root, `pub-change-location-${data.commentId}`),
          afterExcerpt: value(root, `pub-after-excerpt-${data.commentId}`),
          noChangeReason: value(root, `pub-no-change-reason-${data.commentId}`)
        }), '回应与实际动作已保存。');
      } else if (action === 'publishing-add-requirement') {
        await run(() => coordinator.addRequirementCard(current.id, {
          title: value(root, 'publishing-requirement-title'), issuer: value(root, 'publishing-requirement-issuer'),
          version: value(root, 'publishing-requirement-version'), sourceUrl: value(root, 'publishing-requirement-url'),
          body: value(root, 'publishing-requirement-body'), applicability: value(root, 'publishing-requirement-applicability')
        }), '目标要求来源已记录，适用性仍需按本项目核对。');
      } else if (action === 'publishing-save-requirement') {
        const status = root.querySelector?.(`[data-pub-requirement-status="${data.requirementId}"]`)?.value || 'unverified';
        const sourceLocator = root.querySelector?.(`[data-pub-requirement-locator="${data.requirementId}"]`)?.value || '';
        await run(() => coordinator.updateRequirementCard(current.id, data.requirementId, { verificationStatus: status, sourceLocator }), '要求来源核对记录已保存；不代表投稿合规通过。');
      } else if (action === 'publishing-add-check') {
        await run(() => coordinator.addChecklistItem(current.id, {
          title: value(root, 'publishing-check-title'), requirementId: value(root, 'publishing-check-requirement'),
          expected: value(root, 'publishing-check-expected'), custom: checked(root, 'publishing-check-custom')
        }), '投稿清单项已添加，尚未标记为完成。');
      } else if (action === 'publishing-save-check') {
        const status = root.querySelector?.(`[data-pub-check-status="${data.checkId}"]`)?.value || 'todo';
        await run(() => coordinator.updateChecklistItem(current.id, data.checkId, {
          status, evidence: value(root, `pub-check-evidence-${data.checkId}`), reason: value(root, `pub-check-reason-${data.checkId}`)
        }), '用户核对状态已保存；不代表自动合规认证。');
      } else if (action === 'publishing-generate-prompt') {
        await run(async () => {
          const item = await coordinator.generatePrompt(current.id, current.taskType, selectedIds());
          activeHistoryId = item.id;
        }, '提示词已生成并保存为独立版本。');
      } else if (action === 'publishing-save-prompt') {
        const active = current.history.find(item => item.id === activeHistoryId) || current.history[0];
        if (!active) return;
        await run(async () => { const next = await coordinator.updatePrompt(current.id, active.id, value(root, 'publishing-prompt')); activeHistoryId = next.id; }, '编辑后的提示词已另存为新版本。');
      } else if (action === 'publishing-copy-prompt') {
        const active = current.history.find(item => item.id === activeHistoryId) || current.history[0];
        if (!active) return;
        const actualPrompt = value(root, 'publishing-prompt');
        await run(async () => {
          await clipboard(actualPrompt);
          const copied = await coordinator.markPromptCopied(current.id, active.id, actualPrompt);
          activeHistoryId = copied.id;
        }, '提示词已复制，并记录实际复制版本。');
      } else if (action === 'publishing-store-result') {
        const raw = value(root, 'publishing-result');
        const source = value(root, 'publishing-result-source') || 'external-copy';
        await run(async () => {
          const result = await coordinator.storeExternalResult(current.id, data.historyId, raw, source);
          activeHistoryId = result.id;
        }, '结果已保存为待用户复核记录；不会自动更改证据关系。');
      }
    }
    async function handleChange(event) {
      const { target, action, data } = actionFrom(event);
      if (action === 'publishing-toggle-save' && project()) {
        await run(() => coordinator.setSaveEnabled(activeProjectId, target.checked), target.checked ? '项目已开启本机保存。' : '已暂停后续保存，既有快照保留。');
      } else if (action === 'publishing-task-type' && project()) {
        await run(() => coordinator.updateProject(activeProjectId, { taskType: target.value }), '任务类型已切换。');
      } else if (action === 'publishing-select-literature') {
        if (target.checked) selectedLiteratureIds.add(data.entryId); else selectedLiteratureIds.delete(data.entryId);
      } else if (action === 'publishing-select-history') {
        activeHistoryId = target.value;
        render();
      }
    }
    function bindListeners() {
      if (listenersBound) return;
      listenersBound = true;
      root.addEventListener('click', event => handleClick(event).catch(error => { statusMessage = error.message || '操作失败'; render(); }));
      root.addEventListener('change', event => handleChange(event).catch(error => { statusMessage = error.message || '操作失败'; render(); }));
    }
    render();
    return {
      render,
      refreshFromStorage() {
        coordinator.refreshFromStorage?.();
        activeProjectId = ''; activeHistoryId = ''; selectedLiteratureIds.clear(); lookupDiffs.clear();
        statusMessage = '已从本机存储重新载入学术核验项目。';
        return render();
      },
      getActiveProjectId: () => activeProjectId
    };
  }

  return { createAcademicPublishingUI };
});
