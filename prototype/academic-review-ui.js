(function (root, factory) {
  const review = typeof module === 'object' && module.exports && typeof require === 'function'
    ? require('./academic-review.js')
    : root.ForwardStepAcademicReview;
  const api = factory(review);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepAcademicReviewUI = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (review) {
  'use strict';

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const lines = value => Array.isArray(value) ? value.join('\n') : String(value ?? '');
  const read = (root, id) => root.querySelector(`#${id}`);
  const selected = (root, id) => read(root, id)?.checked === true;
  const value = (root, id) => read(root, id)?.value ?? '';

  function createAcademicReviewUI({
    root, coordinator, getState = () => ({}), getKnowledgeEntries, getPackSnapshot,
    confirm = message => globalThis.confirm(message), notify = () => {}, clipboard = async () => {}
  } = {}) {
    if (!root || !coordinator) throw new TypeError('综述工作台缺少根节点或协调器');
    let activeProjectId = '';
    let selectedLiteratureIds = new Set();
    let pendingRefresh = null;
    let selectedBatchId = '';
    let selectedRoundId = '';
    let generatedPromptRoundId = '';
    let generatedPrompt = '';
    let statusMessage = '项目默认关闭保存；开启后，本机只保存该项目和后续修改。';
    let listenersBound = false;

    function projects() {
      return typeof coordinator.listProjects === 'function' ? coordinator.listProjects() : [];
    }

    function currentProject() {
      return typeof coordinator.getProject === 'function'
        ? coordinator.getProject(activeProjectId)
        : projects().find(project => project.id === activeProjectId) || null;
    }

    function entries() {
      const items = typeof getKnowledgeEntries === 'function'
        ? getKnowledgeEntries() : getState()?.knowledgeEntries;
      return (Array.isArray(items) ? items : []).filter(item => item?.type === 'academic-literature');
    }

    function renderProjectList(allProjects) {
      if (!allProjects.length) return '<p class="library-meta">还没有综述项目。创建项目后再从学术文献库加入题录。</p>';
      return `<div class="academic-review-project-list" aria-label="综述项目">${allProjects.map(project => `
        <button type="button" class="${project.id === activeProjectId ? 'active' : ''}" data-action="review-select-project" data-project-id="${escapeHtml(project.id)}">
          <strong>${escapeHtml(project.title)}</strong><span>${escapeHtml(reviewTypeName(project.reviewType))} · ${project.records.length} 条题录${project.saveEnabled ? ' · 已保存' : ' · 当前会话'}</span>
        </button>`).join('')}</div>`;
    }

    function reviewTypeName(type) {
      return ({ 'narrative-review': '叙述性综述', 'scoping-review': '范围综述', 'systematic-review': '系统综述' })[type] || '综述';
    }

    function renderCreateForm() {
      return `<section class="academic-review-create" aria-labelledby="review-create-heading">
        <h3 id="review-create-heading">新建综述项目</h3>
        <div class="extra-grid">
          <label>项目标题<input id="review-create-title" maxlength="120" required></label>
          <label>综述类型<select id="review-create-type"><option value="narrative-review">叙述性综述</option><option value="scoping-review">范围综述</option><option value="systematic-review">系统综述</option></select></label>
          <label class="wide">研究问题<textarea id="review-create-question" maxlength="1200" required></textarea></label>
          <label class="wide">综述范围<textarea id="review-create-scope" maxlength="1200" required></textarea></label>
          <label>目标读者<input id="review-create-audience" maxlength="500"></label>
          <label>系统综述筛选方式（仅系统综述适用）<select id="review-create-screening"><option value="single-reviewer">单人筛选</option><option value="two-reviewers">双人独立筛选与人工裁定</option></select></label>
          <label class="wide">纳入标准（每行一条）<textarea id="review-create-inclusion" maxlength="1200"></textarea></label>
          <label class="wide">排除标准（每行一条）<textarea id="review-create-exclusion" maxlength="1200"></textarea></label>
        </div>
        <p class="library-meta">叙述性综述不生成系统筛选覆盖；范围综述和系统综述需填写纳入与排除标准。研究检索由你执行并记录。</p>
        <button type="button" class="button-primary" data-action="review-create-project">创建项目</button>
      </section>`;
    }

    function renderSources(project) {
      const pack = project.packSnapshot || {};
      const sourceCatalog = (typeof getPackSnapshot === 'function' ? getPackSnapshot() : null)?.sources || [];
      const ids = new Set(pack.sourceIds || []);
      const sources = [...(pack.sources || []), ...sourceCatalog.filter(source => ids.has(source.id))]
        .filter((source, index, all) => source?.id && all.findIndex(item => item.id === source.id) === index);
      return `<section class="academic-review-sources"><h3>方法包与来源</h3>
        <p>${escapeHtml(pack.name || '未选择')} · 版本 ${escapeHtml(pack.version || '未知')}。包内为原创操作化摘要，不是专业认证。</p>
        ${sources.length ? `<ul>${sources.map(source => `<li><a href="${escapeHtml(source.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.id)}</a> · ${escapeHtml(source.locator || '')} · ${escapeHtml(source.verificationStatus || '未核验')}<br><small>${escapeHtml(source.applicability || source.limitations || '')}</small></li>`).join('')}</ul>` : '<p>来源目录尚未载入；请以官方原文核对方法适用范围。</p>'}
      </section>`;
    }

    function renderCatalogSources() {
      const pack = typeof getPackSnapshot === 'function' ? getPackSnapshot() : null;
      if (!pack) return '';
      const sources = Array.isArray(pack.sources) ? pack.sources : [];
      return `<section class="academic-review-sources"><h3>当前可用方法包：${escapeHtml(pack.name || '学术综述')} v${escapeHtml(pack.version || '未知')}</h3>
        <p>内置内容是原创操作化摘要，不替代指南原文，也不构成方法质量认证。</p>
        ${sources.length ? `<ul>${sources.map(source => `<li><a href="${escapeHtml(source.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.id)}</a> · ${escapeHtml(source.locator || '')} · ${escapeHtml(source.verificationStatus || '未核验')}<br><small>${escapeHtml(source.applicability || source.limitations || '')}</small></li>`).join('')}</ul>` : '<p>来源尚未核验。</p>'}
      </section>`;
    }

    function renderCoverage(project) {
      const coverage = review.getReviewCoverage(project);
      const rows = [
        ['项目快照', `${coverage.totalRecords} 条`],
        ...(coverage.titleAbstractApplicable ? [
          ['题名/摘要待审', coverage.titleAbstractPending], ['题名/摘要纳入', coverage.titleAbstractIncluded],
          ['题名/摘要排除', coverage.titleAbstractExcluded], ['不确定/待裁定', coverage.titleAbstractUncertain + coverage.titleAbstractNeedsAdjudication],
          ['重复', coverage.titleAbstractDuplicates], ['全文待审', coverage.fullTextPending],
          ['全文纳入', coverage.fullTextIncluded], ['全文排除', coverage.fullTextExcluded],
          ['全文未获取', coverage.fullTextNotRetrieved], ['待提取', coverage.extractionPending], ['已提取', coverage.extractionComplete]
        ] : [['叙述性综述已选材料', coverage.narrativeSelected], ['待提取', coverage.extractionPending], ['已提取', coverage.extractionComplete]]),
        ['可进入综合', coverage.synthesisReady], ['失败轮次', coverage.failedRounds]
      ];
      return `<section class="academic-review-coverage" aria-labelledby="review-coverage-heading"><h3 id="review-coverage-heading">阶段覆盖</h3>
        <dl>${rows.map(([label, count]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(count)}</dd></div>`).join('')}</dl>
        <p role="status">${coverage.complete ? '当前适用阶段已完成' : '仍有未处理记录；覆盖统计不代表研究质量评价'}</p>
      </section>`;
    }

    function renderLiteraturePicker(project) {
      const available = entries();
      return `<section class="academic-review-literature"><h3>项目文献快照</h3>
        <p>只加入资料库中明确选择的学术文献。快照固定题录和已保存摘录；移出资料库不会删除项目记录。</p>
        ${available.length ? `<div class="academic-review-literature-list">${available.map(entry => `<label class="check-row"><input type="checkbox" data-action="review-select-literature" data-entry-id="${escapeHtml(entry.id)}" ${selectedLiteratureIds.has(entry.id) ? 'checked' : ''}><span>${escapeHtml(entry.title || '未命名题录')}</span></label>`).join('')}</div>` : '<p class="library-meta">学术文献库当前没有可加入的题录。</p>'}
        <div class="button-row"><button type="button" data-action="review-preview-literature">预览加入与缺失</button><button type="button" data-action="review-confirm-literature" ${pendingRefresh?.additions?.length ? '' : 'disabled'}>确认加入快照</button></div>
        ${pendingRefresh ? `<p role="status">预览：新增 ${pendingRefresh.additions.length} 条、重复 ${pendingRefresh.duplicates.length} 条、资料库缺失 ${pendingRefresh.missing.length} 条。旧快照未改动。</p>` : ''}
      </section>`;
    }

    function renderMetadata(project) {
      return `<section class="academic-review-metadata"><h3>项目方案</h3><div class="extra-grid">
        <label>研究问题<textarea id="review-project-question" maxlength="1200">${escapeHtml(project.question)}</textarea></label>
        <label>范围<textarea id="review-project-scope" maxlength="1200">${escapeHtml(project.scope)}</textarea></label>
        <label>纳入标准<textarea id="review-project-inclusion">${escapeHtml(lines(project.inclusionCriteria))}</textarea></label>
        <label>排除标准<textarea id="review-project-exclusion">${escapeHtml(lines(project.exclusionCriteria))}</textarea></label>
        <label>检索记录<textarea id="review-search-logs" placeholder="每行：数据库｜检索式｜日期｜限制｜命中数">${escapeHtml((project.searchLogs || []).map(log => [log.database, log.query, log.date, log.limits, log.recordsIdentified].join('｜')).join('\n'))}</textarea></label>
        <label>综合路线<select id="review-synthesis-method">${[['descriptive', '描述性'], ['thematic', '主题/概念'], ['narrative', '叙述性'], ['quantitative-plan', '定量方案（只记录，不计算）']].map(([id, label]) => `<option value="${id}" ${project.synthesisMethod === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div><button type="button" data-action="review-save-metadata">保存方案</button></section>`;
    }

    function renderFields(project) {
      return `<section class="academic-review-fields"><h3>提取字段</h3><p>字段可以增删和排序；每个值需由用户确认，并记录原文依据与位置。</p>
        <div>${project.extractionFields.map((field, index) => `<div class="academic-review-field-row"><label>字段名<input id="review-field-label-${escapeHtml(field.id)}" data-field-label="${escapeHtml(field.id)}" value="${escapeHtml(field.label)}"></label><label>必填<input id="review-field-required-${escapeHtml(field.id)}" type="checkbox" data-field-required="${escapeHtml(field.id)}" ${field.required ? 'checked' : ''}></label><span>顺序 ${index + 1}</span><button type="button" data-action="review-field-up" data-field-id="${escapeHtml(field.id)}" ${index === 0 ? 'disabled' : ''}>上移</button><button type="button" data-action="review-field-down" data-field-id="${escapeHtml(field.id)}" ${index === project.extractionFields.length - 1 ? 'disabled' : ''}>下移</button><button type="button" data-action="review-field-delete" data-field-id="${escapeHtml(field.id)}" ${project.extractionFields.length <= 1 ? 'disabled' : ''}>删除</button></div>`).join('')}</div>
        <div class="button-row"><input id="review-new-field-label" aria-label="新提取字段名称" maxlength="120"><button type="button" data-action="review-field-add">新增字段</button><button type="button" data-action="review-fields-save">保存字段</button></div>
      </section>`;
    }

    function renderRecord(record, project) {
      const titleState = record.screening.titleAbstract;
      const reviewers = project.screeningModel === 'two-reviewers' ? ['reviewerOne', 'reviewerTwo'] : ['reviewerOne'];
      const titleDecisions = ['include', 'exclude', 'uncertain', 'duplicate'];
      const fullTextDecisions = ['pending', 'include', 'exclude', 'not-retrieved'];
      const titleDecision = review.getTitleAbstractDecision(project, record);
      const fullTextEligible = ['include', 'uncertain'].includes(titleDecision);
      const extractionEligible = project.reviewType === 'narrative-review'
        ? record.narrativeSelected
        : record.screening.fullText.decision === 'include' && record.screening.fullText.userConfirmedFullText;
      const titleStage = project.reviewType === 'narrative-review' ? '' : `<section class="academic-review-screening"><h4>题名/摘要筛选</h4>
        ${reviewers.map(reviewer => `<div class="extra-grid"><label>${reviewer === 'reviewerOne' ? '审阅者一' : '审阅者二'}决定<select data-action="review-screening-decision" data-record-id="${escapeHtml(record.id)}" data-reviewer="${reviewer}"><option value="">待审</option>${titleDecisions.map(decision => `<option value="${decision}" ${titleState[reviewer].decision === decision ? 'selected' : ''}>${decisionLabel(decision)}</option>`).join('')}</select></label><label>理由<textarea id="review-reason-${escapeHtml(record.id)}-${reviewer}">${escapeHtml(titleState[reviewer].reason)}</textarea></label></div>`).join('')}
        ${project.screeningModel === 'two-reviewers' && titleState.reviewerOne.decision && titleState.reviewerTwo.decision && titleState.reviewerOne.decision !== titleState.reviewerTwo.decision ? `<div class="extra-grid"><label>人工裁定<select data-action="review-adjudication" data-record-id="${escapeHtml(record.id)}"><option value="">待裁定</option>${titleDecisions.map(decision => `<option value="${decision}" ${titleState.adjudication.decision === decision ? 'selected' : ''}>${decisionLabel(decision)}</option>`).join('')}</select></label><label>裁定理由<textarea id="review-adjudication-reason-${escapeHtml(record.id)}">${escapeHtml(titleState.adjudication.reason)}</textarea></label></div>` : ''}
      </section>`;
      const fullTextStage = ['scoping-review', 'systematic-review'].includes(project.reviewType) ? `<section class="academic-review-fulltext"><h4>全文筛选</h4><div class="extra-grid">
        <label>全文决定<select data-action="review-fulltext-decision" data-record-id="${escapeHtml(record.id)}" ${fullTextEligible ? '' : 'disabled'}>${fullTextDecisions.map(decision => `<option value="${decision}" ${record.screening.fullText.decision === decision ? 'selected' : ''}>${fullTextLabel(decision)}</option>`).join('')}</select></label>
        ${fullTextEligible ? '' : '<p class="library-meta">题名/摘要决定纳入或转全文后，才开放全文筛选。</p>'}
        <label>全文排除/无法获取理由<textarea id="review-fulltext-reason-${escapeHtml(record.id)}">${escapeHtml(record.screening.fullText.reason)}</textarea></label>
        <label class="check-row"><input id="review-fulltext-confirmed-${escapeHtml(record.id)}" type="checkbox" ${record.screening.fullText.userConfirmedFullText ? 'checked' : ''}>我已亲自核对全文</label>
        <label class="check-row"><input id="review-fulltext-available-${escapeHtml(record.id)}" type="checkbox" ${record.screening.fullText.availableToUser ? 'checked' : ''}>全文对我可用</label>
      </div></section>` : '';
      const extraction = project.extractionFields.map(field => {
        const item = record.extraction[field.id] || {};
        return `<div class="academic-review-extraction"><strong>${escapeHtml(field.label)}${field.required ? '（必填）' : ''}</strong>
          <label>提取值<textarea id="review-extract-value-${escapeHtml(record.id)}-${escapeHtml(field.id)}" ${extractionEligible ? '' : 'disabled'}>${escapeHtml(item.value || '')}</textarea></label>
          <label>依据摘录<textarea id="review-extract-evidence-${escapeHtml(record.id)}-${escapeHtml(field.id)}" ${extractionEligible ? '' : 'disabled'}>${escapeHtml(item.evidence || '')}</textarea></label>
          <label>原文位置<input id="review-extract-location-${escapeHtml(record.id)}-${escapeHtml(field.id)}" value="${escapeHtml(item.sourceLocation || '')}" ${extractionEligible ? '' : 'disabled'}></label>
          <label class="check-row"><input type="checkbox" disabled ${item.confirmed ? 'checked' : ''}>${item.confirmed ? '已确认' : '待确认'}</label>
          <button type="button" data-action="review-confirm-extraction" data-record-id="${escapeHtml(record.id)}" data-field-id="${escapeHtml(field.id)}" ${extractionEligible ? '' : 'disabled'}>保存并确认提取</button>
        </div>`;
      }).join('');
      return `<article class="academic-review-record"><h4>${escapeHtml(record.snapshot.title || '未命名题录')}</h4>
        <p>${escapeHtml(record.snapshot.authors.join('、'))} ${escapeHtml(record.snapshot.year)} · ${escapeHtml(record.snapshot.publication)} · ${escapeHtml(record.snapshot.doi)}</p>
        <p>题录来源：${escapeHtml(record.snapshot.metadataStatus)}；阅读状态：${escapeHtml(record.snapshot.readingStatus)}；摘录 ${record.snapshot.excerpt.length} 字</p>
        <blockquote>${escapeHtml(record.snapshot.excerpt || '没有用户摘录；不得据此推断全文')}</blockquote>
        ${project.reviewType === 'narrative-review' ? `<label class="check-row"><input type="checkbox" data-action="review-narrative-selection" data-record-id="${escapeHtml(record.id)}" ${record.narrativeSelected ? 'checked' : ''}>选择纳入本次叙述</label>` : ''}
        ${project.reviewType === 'narrative-review' && !extractionEligible ? '<p class="library-meta">先选择这条材料，再录入提取字段。</p>' : ''}
        ${titleStage}${fullTextStage}<details><summary>逐字段提取与确认</summary>${extraction}</details>
      </article>`;
    }

    function decisionLabel(decision) {
      return ({ include: '纳入', exclude: '排除', uncertain: '不确定/转全文', duplicate: '重复' })[decision] || decision;
    }

    function fullTextLabel(decision) {
      return ({ pending: '待处理', include: '全文纳入', exclude: '全文排除', 'not-retrieved': '无法获取全文' })[decision] || decision;
    }

    function renderBatchTools(project) {
      const choices = project.reviewType === 'narrative-review'
        ? [['synthesis', '已确认材料综合']]
        : [['title-abstract', '题名/摘要筛选'], ['full-text', '全文复核'], ['extraction', '字段提取'], ['synthesis', '已确认材料综合']];
      const batches = project.batches || [];
      const batch = batches.find(item => item.id === selectedBatchId) || batches[0];
      if (batch && !selectedBatchId) selectedBatchId = batch.id;
      const rounds = project.rounds || [];
      const currentRound = rounds.find(item => item.id === selectedRoundId) || rounds[rounds.length - 1];
      if (currentRound && !selectedRoundId) selectedRoundId = currentRound.id;
      return `<section class="academic-review-batches"><h3>分批提示词与人工复核</h3>
        <div class="extra-grid"><label>阶段<select id="review-batch-stage">${choices.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
        <label>每批文献（1–5，默认 3）<input id="review-batch-size" type="number" min="1" max="5" value="${project.batchSize}"></label>
        ${project.screeningModel === 'two-reviewers' ? '<label>题名/摘要审阅者<select id="review-batch-reviewer"><option value="reviewerOne">审阅者一</option><option value="reviewerTwo">审阅者二（不显示另一方决定）</option></select></label>' : ''}</div>
        <button type="button" data-action="review-create-batches">生成固定批次</button>
        <label>选择批次<select id="review-batch-select"><option value="">请选择</option>${batches.map(item => `<option value="${escapeHtml(item.id)}" ${batch?.id === item.id ? 'selected' : ''}>${escapeHtml(item.stage)} · ${item.inputCount || item.recordIds.length} 条 · ${escapeHtml(item.id)}</option>`).join('')}</select></label>
        <p class="library-meta">批次固定记录 ID；新加文献需创建新批次。复制提示词不表示外部模型已接收。</p>
        <div class="button-row"><button type="button" data-action="review-generate-prompt" ${batch ? '' : 'disabled'}>生成提示词</button><button type="button" data-action="review-copy-prompt" ${generatedPrompt ? '' : 'disabled'}>复制提示词</button><button type="button" data-action="review-generate-plan">生成方案提示词</button></div>
        <label>提示词（可编辑）<textarea id="review-generated-prompt">${escapeHtml(generatedPrompt)}</textarea></label>
        <label>外部 AI 返回的原始结果<textarea id="review-external-result" maxlength="20000"></textarea></label>
        <button type="button" data-action="review-store-result" ${generatedPromptRoundId || batch ? '' : 'disabled'}>保存原始结果并解析候选</button>
        ${currentRound ? `<div class="academic-review-round"><p>轮次 ${escapeHtml(currentRound.status)} · ${escapeHtml(currentRound.batchId)}${currentRound.error ? ` · ${escapeHtml(currentRound.error)}` : ''}</p>
          <label>轮次原始结果<textarea readonly>${escapeHtml(currentRound.result)}</textarea></label>${renderCandidates(currentRound)}</div>` : ''}
      </section>`;
    }

    function renderCandidates(round) {
      if (!round.candidates?.length) return '<p class="library-meta">没有待确认候选。解析失败时原始结果仍保留在轮次中。</p>';
      const secondReviewerRound = round.stage === 'title-abstract' && round.reviewer === 'reviewerTwo';
      const independentReviewNotice = secondReviewerRound
        ? '<p class="notice">当前是审阅者二的盲审批次。模型候选不能作为独立意见；请由审阅者二本人在上方决定框中录入。接受或修改模型候选不会写入任何审阅者决定。</p>'
        : '';
      return `<div class="academic-review-candidates"><h4>候选结果（必须逐条人工处理）</h4>${independentReviewNotice}${round.candidates.map(candidate => `<article>
        <p>${escapeHtml(candidate.recordId)} ${escapeHtml(candidate.fieldId)} · ${escapeHtml(candidate.decision)} · ${escapeHtml(candidate.status)}</p>
        ${candidate.decision ? `<label>候选决定<select id="review-candidate-decision-${escapeHtml(candidate.id)}">${(round.stage === 'title-abstract' ? ['include', 'exclude', 'uncertain', 'duplicate'] : ['include', 'exclude', 'not-retrieved']).map(decision => `<option value="${decision}" ${candidate.decision === decision ? 'selected' : ''}>${escapeHtml(decisionLabel(decision))}</option>`).join('')}</select></label>` : ''}
        <label>理由<input id="review-candidate-reason-${escapeHtml(candidate.id)}" value="${escapeHtml(candidate.reason)}"></label>
        <label>依据<textarea id="review-candidate-evidence-${escapeHtml(candidate.id)}">${escapeHtml(candidate.evidence)}</textarea></label>
        <label>位置<input id="review-candidate-location-${escapeHtml(candidate.id)}" value="${escapeHtml(candidate.location)}"></label>
        ${round.stage === 'extraction' ? `<label>提取值<textarea id="review-candidate-value-${escapeHtml(candidate.id)}">${escapeHtml(candidate.value)}</textarea></label>` : ''}
        ${round.stage === 'full-text' ? `<label class="check-row"><input id="review-candidate-fulltext-confirm-${escapeHtml(candidate.id)}" type="checkbox">我已亲自核对全文</label><label class="check-row"><input id="review-candidate-fulltext-available-${escapeHtml(candidate.id)}" type="checkbox">全文对我可用</label>` : ''}
        <div class="button-row"><button type="button" data-action="review-candidate-accept" data-round-id="${escapeHtml(round.id)}" data-candidate-id="${escapeHtml(candidate.id)}" ${candidate.status !== 'pending' || secondReviewerRound ? 'disabled' : ''}>人工接受</button><button type="button" data-action="review-candidate-modify" data-round-id="${escapeHtml(round.id)}" data-candidate-id="${escapeHtml(candidate.id)}" ${candidate.status !== 'pending' || secondReviewerRound ? 'disabled' : ''}>编辑后确认</button><button type="button" data-action="review-candidate-reject" data-round-id="${escapeHtml(round.id)}" data-candidate-id="${escapeHtml(candidate.id)}" ${candidate.status !== 'pending' ? 'disabled' : ''}>拒绝</button></div>
      </article>`).join('')}</div>`;
    }

    function renderWorkspace(project) {
      const coverage = renderCoverage(project);
      return `<section class="academic-review-workspace"><div class="block-top"><h3>${escapeHtml(project.title)}</h3><label class="check-row"><input id="review-toggle-save-${escapeHtml(project.id)}" type="checkbox" data-action="review-toggle-save" data-project-id="${escapeHtml(project.id)}" ${project.saveEnabled ? 'checked' : ''}>保存到本机</label><button type="button" data-action="review-delete-project" data-project-id="${escapeHtml(project.id)}">删除项目</button></div>
        <p>保存${project.saveEnabled ? '已开启' : '关闭'}。关闭后保留最近一次已保存快照，后续修改只存在当前会话。</p>
        ${coverage}${renderSources(project)}${renderMetadata(project)}${renderLiteraturePicker(project)}${renderFields(project)}
        <section class="academic-review-records"><h3>逐条记录与决定</h3>${project.records.length ? project.records.map(record => renderRecord(record, project)).join('') : '<p>加入文献后，这里会显示筛选和提取表。</p>'}</section>
        ${renderBatchTools(project)}
      </section>`;
    }

    function render() {
      const allProjects = projects();
      if (activeProjectId && !allProjects.some(project => project.id === activeProjectId)) activeProjectId = '';
      const project = currentProject();
      root.innerHTML = `<section class="academic-review-manager" aria-labelledby="academic-review-heading">
        <div class="block-top"><div><h2 id="academic-review-heading">学术综述工作台</h2><p>管理综述方案、文献快照、筛选与提取覆盖；所有决定由用户核对。</p></div></div>
        <p id="academic-review-status" class="academic-review-status" role="status" aria-live="polite">${escapeHtml(statusMessage)}</p>
        ${renderCreateForm()}${renderCatalogSources()}${renderProjectList(allProjects)}
        ${project ? renderWorkspace(project) : '<p class="library-meta">选择一个项目，或先创建项目。</p>'}
      </section>`;
      bindListeners();
      return root.innerHTML;
    }

    function bindListeners() {
      if (listenersBound) return;
      root.addEventListener('click', event => handleClick(event));
      root.addEventListener('change', event => handleChange(event));
      root.addEventListener('input', event => { handleInput(event); });
      listenersBound = true;
    }

    function actionFrom(event) {
      const target = event.target?.closest?.('[data-action]') || event.target;
      return { target, action: target?.dataset?.action || '', data: target?.dataset || {} };
    }

    async function run(operation, successMessage) {
      try {
        const result = await operation();
        statusMessage = successMessage || '已保存。';
        render();
        return result;
      } catch (error) {
        statusMessage = error?.message || '操作失败；当前项目状态未改变。';
        const status = root.querySelector('#academic-review-status');
        if (status) status.textContent = statusMessage;
        notify(statusMessage);
        return null;
      }
    }

    function createInput() {
      const type = value(root, 'review-create-type');
      return {
        title: value(root, 'review-create-title'), reviewType: type,
        question: value(root, 'review-create-question'), scope: value(root, 'review-create-scope'),
        audience: value(root, 'review-create-audience'),
        screeningModel: type === 'systematic-review' ? value(root, 'review-create-screening') : 'single-reviewer',
        inclusionCriteria: value(root, 'review-create-inclusion').split(/\r?\n/).map(item => item.trim()).filter(Boolean),
        exclusionCriteria: value(root, 'review-create-exclusion').split(/\r?\n/).map(item => item.trim()).filter(Boolean),
        packSnapshot: typeof getPackSnapshot === 'function' ? getPackSnapshot() : {}
      };
    }

    function fieldValues(project) {
      const rows = project.extractionFields.map(field => ({
        ...field, label: value(root, `review-field-label-${field.id}`) || field.label,
        required: read(root, `review-field-required-${field.id}`)?.checked ?? field.required,
        order: Number(value(root, `review-field-order-${field.id}`)) || field.order
      }));
      return rows;
    }

    function candidateChanges(candidate, modified) {
      const confirmation = {
        userConfirmedFullText: selected(root, `review-candidate-fulltext-confirm-${candidate.id}`),
        availableToUser: selected(root, `review-candidate-fulltext-available-${candidate.id}`)
      };
      if (!modified) return confirmation;
      return {
        reason: value(root, `review-candidate-reason-${candidate.id}`),
        evidence: value(root, `review-candidate-evidence-${candidate.id}`),
        location: value(root, `review-candidate-location-${candidate.id}`),
        ...(candidate.fieldId ? { value: value(root, `review-candidate-value-${candidate.id}`) } : {}),
        ...(candidate.decision ? { decision: value(root, `review-candidate-decision-${candidate.id}`) || candidate.decision } : {}),
        ...confirmation
      };
    }

    async function handleClick(event) {
      const { action, data } = actionFrom(event);
      const project = currentProject();
      if (action === 'review-create-project') {
        event.preventDefault?.();
        await run(async () => {
          const created = await coordinator.createProject(createInput());
          activeProjectId = created.id;
          selectedLiteratureIds.clear(); pendingRefresh = null; generatedPrompt = ''; generatedPromptRoundId = ''; selectedBatchId = ''; selectedRoundId = '';
          return created;
        }, '已创建项目；保存仍处于关闭状态。');
      } else if (action === 'review-select-project') {
        activeProjectId = data.projectId || '';
        selectedLiteratureIds.clear(); pendingRefresh = null; generatedPrompt = ''; generatedPromptRoundId = ''; selectedBatchId = ''; selectedRoundId = '';
        const selectedProject = activeProjectId ? coordinator.getProject(activeProjectId) : null;
        const latestRound = selectedProject?.rounds?.at(-1);
        if (latestRound) {
          selectedRoundId = latestRound.id;
          generatedPromptRoundId = latestRound.promptVersionId || latestRound.id;
          generatedPrompt = latestRound.prompt;
          selectedBatchId = latestRound.batchId;
        }
        render();
      } else if (!project) return;
      else if (action === 'review-delete-project') {
        if (confirm(`删除综述项目“${project.title}”及其项目快照和历史？资料库原记录不会删除。`)) {
          await run(() => coordinator.deleteProject(project.id), '项目及其保存历史已删除。');
          activeProjectId = '';
        }
      } else if (action === 'review-save-metadata') {
        const searchLogs = value(root, 'review-search-logs').split(/\r?\n/).filter(Boolean).map((line, index) => {
          const [database = '', query = '', date = '', limits = '', count = '0'] = line.split('｜');
          return { id: `search-${index + 1}`, database, query, date, limits, recordsIdentified: Number(count) || 0 };
        });
        await run(() => coordinator.updateProject(project.id, {
          question: value(root, 'review-project-question'), scope: value(root, 'review-project-scope'),
          inclusionCriteria: value(root, 'review-project-inclusion').split(/\r?\n/).filter(Boolean),
          exclusionCriteria: value(root, 'review-project-exclusion').split(/\r?\n/).filter(Boolean),
          searchLogs, synthesisMethod: value(root, 'review-synthesis-method')
        }), '方案与检索记录已保存。');
      } else if (action === 'review-preview-literature') {
        await run(async () => {
          pendingRefresh = await coordinator.previewLiteratureRefresh(project.id, [...selectedLiteratureIds]);
          return pendingRefresh;
        }, '文献快照预览已更新；尚未更改项目。');
      } else if (action === 'review-confirm-literature' && pendingRefresh) {
        const result = await run(async () => coordinator.confirmLiteratureRefresh(project.id, pendingRefresh), '文献快照已更新。');
        if (result) { pendingRefresh = null; selectedLiteratureIds.clear(); render(); }
      } else if (action === 'review-field-add') {
        const label = value(root, 'review-new-field-label').trim();
        if (!label) return;
        const id = `field-${Date.now().toString(36)}`;
        await run(() => coordinator.updateExtractionFields(project.id, [...project.extractionFields, { id, label, required: true, order: project.extractionFields.length }]), '提取字段已新增。');
      } else if (action.startsWith('review-field-')) {
        const fields = fieldValues(project);
        const index = fields.findIndex(field => field.id === data.fieldId);
        if (action === 'review-field-delete') fields.splice(index, 1);
        if (action === 'review-field-up' && index > 0) [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]];
        if (action === 'review-field-down' && index >= 0 && index < fields.length - 1) [fields[index + 1], fields[index]] = [fields[index], fields[index + 1]];
        fields.forEach((field, order) => { field.order = order; });
        await run(() => coordinator.updateExtractionFields(project.id, fields), action === 'review-field-delete' ? '提取字段已删除。' : '提取字段顺序已更新。');
      } else if (action === 'review-fields-save') {
        await run(() => coordinator.updateExtractionFields(project.id, fieldValues(project)), '提取字段已保存。');
      } else if (action === 'review-confirm-extraction') {
        await run(() => coordinator.setExtractionValue(project.id, data.recordId, data.fieldId, {
          value: value(root, `review-extract-value-${data.recordId}-${data.fieldId}`),
          evidence: value(root, `review-extract-evidence-${data.recordId}-${data.fieldId}`),
          sourceLocation: value(root, `review-extract-location-${data.recordId}-${data.fieldId}`),
          confirmed: true
        }), '提取字段已保存并确认。');
      } else if (action === 'review-create-batches') {
        const stage = value(root, 'review-batch-stage');
        const size = Number(value(root, 'review-batch-size'));
        const reviewer = value(root, 'review-batch-reviewer') || 'reviewerOne';
        await run(async () => {
          const batches = await coordinator.createBatches(project.id, stage, { size, reviewer });
          selectedBatchId = batches[0]?.id || '';
          return batches;
        }, '固定批次已生成。');
      } else if (action === 'review-generate-prompt') {
        const batch = project.batches.find(item => item.id === selectedBatchId) || project.batches[0];
        await run(async () => {
          const result = await coordinator.generatePrompt(project.id, batch.id);
          generatedPrompt = result.prompt;
          generatedPromptRoundId = result.roundId;
          selectedRoundId = result.roundId;
          return result;
        }, '提示词已生成，可检查、编辑后复制。');
      } else if (action === 'review-generate-plan') {
        await run(async () => {
          const result = await coordinator.generatePlanPrompt(project.id);
          generatedPrompt = result.prompt;
          generatedPromptRoundId = result.roundId;
          selectedRoundId = result.roundId;
          return result;
        }, '方案提示词已生成。');
      } else if (action === 'review-copy-prompt') {
        const prompt = value(root, 'review-generated-prompt');
        const copied = await run(async () => {
          if (generatedPromptRoundId) {
            const round = await coordinator.markPromptCopied(project.id, generatedPromptRoundId, prompt);
            generatedPromptRoundId = round.id;
            selectedRoundId = round.id;
          }
          await clipboard(prompt);
          return true;
        }, '提示词已复制；复制不表示外部模型已接收。');
        if (copied) generatedPrompt = prompt;
      } else if (action === 'review-store-result') {
        const batch = project.batches.find(item => item.id === selectedBatchId) || project.batches[0];
        const raw = value(root, 'review-external-result');
        const roundRef = generatedPromptRoundId || batch?.id;
        if (!roundRef) return;
        const result = await run(async () => {
          const round = await coordinator.storeExternalResult(project.id, roundRef, raw, value(root, 'review-generated-prompt'));
          selectedRoundId = round.id;
          return coordinator.parseExternalResult(project.id, round.id);
        }, '外部结果已保存；候选仍待逐条人工确认。');
        if (result?.error) {
          statusMessage = result.error.message || '外部结果解析失败；原文仍保留在轮次中。';
          notify(statusMessage);
          render();
        }
      } else if (action.startsWith('review-candidate-')) {
        const round = project.rounds.find(item => item.id === data.roundId);
        const candidate = round?.candidates.find(item => item.id === data.candidateId);
        if (!candidate) return;
        const resolution = action === 'review-candidate-reject' ? 'reject'
          : action === 'review-candidate-modify' ? 'modify' : 'accept';
        await run(() => coordinator.resolveCandidate(project.id, round.id, candidate.id, resolution, candidateChanges(candidate, resolution === 'modify')),
          resolution === 'reject' ? '候选已拒绝。' : '候选已由用户确认并写入项目。');
      } else if (action === 'review-reparse-round') {
        await run(() => coordinator.parseExternalResult(project.id, data.roundId), '轮次已重新解析。');
      }
    }

    async function handleChange(event) {
      const { target, action, data } = actionFrom(event);
      const project = currentProject();
      if (!project) return;
      if (target.id === 'review-generated-prompt') {
        generatedPrompt = target.value;
        if (generatedPromptRoundId) {
          await run(async () => {
            const round = await coordinator.updatePrompt(project.id, generatedPromptRoundId, generatedPrompt);
            generatedPromptRoundId = round.id;
            selectedRoundId = round.id;
            return round;
          }, '提示词编辑已保存为新版本。');
        }
      } else if (action === 'review-select-literature') {
        if (target.checked) selectedLiteratureIds.add(data.entryId); else selectedLiteratureIds.delete(data.entryId);
      } else if (action === 'review-toggle-save') {
        await run(() => coordinator.setSaveEnabled(project.id, target.checked), target.checked ? '项目已开启本机保存。' : '已暂停后续保存，既有保存快照保留。');
      } else if (action === 'review-select-project') {
        activeProjectId = data.projectId || ''; render();
      } else if (action === 'review-screening-decision') {
        const reason = value(root, `review-reason-${data.recordId}-${data.reviewer}`);
        await run(() => coordinator.setScreeningDecision(project.id, data.recordId, data.reviewer, { decision: target.value, reason }), '筛选决定已记录。');
      } else if (action === 'review-adjudication') {
        await run(() => coordinator.adjudicate(project.id, data.recordId, {
          decision: target.value, reason: value(root, `review-adjudication-reason-${data.recordId}`)
        }), '分歧裁定已记录。');
      } else if (action === 'review-fulltext-decision') {
        if (target.value === 'pending') return;
        await run(() => coordinator.setFullTextDecision(project.id, data.recordId, {
          decision: target.value, reason: value(root, `review-fulltext-reason-${data.recordId}`),
          userConfirmedFullText: selected(root, `review-fulltext-confirmed-${data.recordId}`),
          availableToUser: selected(root, `review-fulltext-available-${data.recordId}`)
        }), '全文状态已记录。');
      } else if (action === 'review-narrative-selection') {
        await run(() => coordinator.setNarrativeSelection(project.id, data.recordId, target.checked), '叙述综述材料选择已更新。');
      } else if (data.entryId) {
        if (target.checked) selectedLiteratureIds.add(data.entryId); else selectedLiteratureIds.delete(data.entryId);
      } else if (target.id === 'review-batch-select') {
        selectedBatchId = target.value;
      }
    }

    function handleInput(event) {
      const { target } = actionFrom(event);
      if (target?.id === 'review-generated-prompt') generatedPrompt = target.value;
      if (target?.id === 'review-batch-select') selectedBatchId = target.value;
    }

    render();
    function refreshFromStorage() {
      coordinator.refreshFromStorage?.();
      activeProjectId = ''; selectedLiteratureIds.clear(); pendingRefresh = null;
      selectedBatchId = ''; selectedRoundId = ''; generatedPromptRoundId = ''; generatedPrompt = '';
      return render();
    }

    return { render, refreshFromStorage, getActiveProjectId: () => activeProjectId, getSelectedBatchId: () => selectedBatchId };
  }

  return { createAcademicReviewUI };
});
