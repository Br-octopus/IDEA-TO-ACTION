(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./writing-workbench-schema.js'), globalThis,
    require('./writing-material-coverage.js'), require('./writing-workbench-prompts.js'), require('./writing-document-outline.js'), require('./browser-project-index.js'));
  else root.WritingWorkbenchUI = factory(root.WritingWorkbenchSchema, root, root.ForwardStepWritingMaterialCoverage,
    root.WritingWorkbenchPrompts, root.ForwardStepWritingDocumentOutline, root.ForwardStepBrowserProjectIndex);
})(typeof globalThis === 'undefined' ? this : globalThis, function (schema, root, coverageApi, prompts, outlineApi, browserIndex) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const lines = value => String(value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const newMaterialId = () => `material-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`;
  const articleConfig = schema.getWritingGenreConfig('article');
  const scopeLabels = { general: '通用', genre: articleConfig.name, project: '仅当前项目', article: '仅本篇（旧范围）' };
  const GENRE_NAMES = Object.fromEntries(schema.WRITING_GENRES.map(genre => {
    const config = schema.getWritingGenreConfig(genre);
    return config?.name ? [config.name, genre] : null;
  }).filter(Boolean));
  const sourceLabels = { temporary: '临时判断', sample: '样本提炼', user: '用户指定', 'user-corrected': '用户纠正', mixed: '样本与用户要求' };
  const confidenceLabels = { low: '低', medium: '中', high: '高' };
  const verificationLabels = { unverified: '未核验', 'source-reviewed': '已核对来源', 'user-confirmed': '用户确认', 'case-validated': '案例验证' };

  function createWritingWorkbenchUI({ document, coordinator, packUI, getState, persistState, navigate, copyText, downloadText, desktopApi = root?.desktopApi,
    fetch: fetchImpl = root?.fetch || globalThis.fetch,
    saveMaterialToLibrary, confirm = message => globalThis.confirm(message), notify } = {}) {
    const mount = document?.getElementById('writing-workbench-root');
    if (!mount || !coordinator || typeof getState !== 'function') throw new TypeError('写作工作台缺少必要依赖');
    const drafts = new Map();
    const webReadResults = new Map();
    const coverageCandidates = new Map();
    const coveragePreview = new Map();
    const busy = new Set();
    let processingMaterials = false;
    let activeMaterialJob = null;
    let sourceImportJob = null;
    let filteredCandidatesOpen = false;
    let candidatePage = 1;
    const projectSources = new Map();
    let articleId = '';
    let managerOpen = false;
    let focusAfterRenderId = '';
    const memoryDrafts = new Map();
    const state = () => getState() || {};
    const workspace = id => id ? coordinator.getWorkspace(id) : null;
    function promptLimitGuidance(message, id, submitted) {
      if (!/8000\s*字/.test(message) || !/超|超过/.test(message)) return message;
      const activeUnits = (workspace(id)?.units || []).filter(unit => !unit.archived);
      const currentUnit = activeUnits.find(unit => unit.id === submitted.unitId);
      const materials = Array.isArray(submitted.materials) ? submitted.materials : [];
      const includedMaterials = materials.filter(material => !material.unitIds?.length
        || !currentUnit || material.unitIds.includes(currentUnit.id));
      const omittedMaterials = materials.filter(material => !includedMaterials.includes(material));
      const body = String(submitted.newDraft || submitted.draft || '');
      const selectedInputLength = [submitted.title, submitted.goal, submitted.audience, submitted.platform,
        submitted.success, submitted.preserve, submitted.constraints, body, submitted.feedback,
        submitted.userFeedback, submitted.diagnosis, submitted.revisionNote,
        ...Object.values(submitted.domainInputs || {})]
        .reduce((total, value) => total + String(value || '').length, 0);
      const materialLength = includedMaterials.reduce((total, material) => total + String(material.excerpt || '').length, 0);
      const range = currentUnit ? `单元“${currentUnit.title || currentUnit.id}”` : '全文';
      const batches = currentUnit ? `其他可单独处理的单元：${activeUnits.filter(unit => unit.id !== currentUnit.id).map(unit => unit.title || unit.id).join('、') || '无'}`
        : activeUnits.length ? `可分批单元：${activeUnits.map(unit => unit.title || unit.id).join('、')}` : '可先新增章节/任务单元，再逐项生成';
      const materialState = `当前范围为${range}，适用材料${includedMaterials.length}份${omittedMaterials.length
        ? `；其他单元材料${omittedMaterials.map(item => item.title || item.id).join('、')}未纳入` : ''}`;
      return `${message}。原稿和材料已保留。${materialState}。已选输入约${selectedInputLength}字（正文${body.length}字）；适用材料摘录共${materialLength}字。此数值是原始字段字符数估算，不是最终提示词长度或模型 token 数。可在“本轮任务范围”逐单元生成，或调整“材料适用范围”后重试；${batches}。每批只覆盖当前选定范围，未纳入内容不会被标记为已阅读或已审核。`;
    }
    const academicTaskTypes = ['academic-planning', 'academic-outline', 'academic-chapter-draft', 'diagnosis', 'revision'];
    function genreId(value) {
      const candidate = String(value || '').trim();
      return schema.getWritingGenreConfig(candidate) ? candidate : GENRE_NAMES[candidate] || '';
    }
    function isSelectablePack(pack, genre) {
      const tasks = genre === 'academic-paper' ? academicTaskTypes
        : genre === 'article' ? ['article', 'diagnosis', 'revision'] : schema.getWritingGenreConfig(genre)?.taskTypes || [];
      return (pack.layer === 'core' || pack.genre === genre || pack.applicability?.genres?.includes(genre))
        && (!pack.taskType || tasks.includes(pack.taskType) || genre === 'academic-paper' && pack.taskType === 'academic-writing');
    }

    function form(id = articleId) {
      if (!drafts.has(id)) {
        const w = workspace(id);
        const a = w?.article || {};
        const round = w?.rounds.at(-1);
        const savedSelections = Array.isArray(round?.packSelections) ? round.packSelections
          : Array.isArray(a.packSelections) ? a.packSelections : null;
        const availablePacks = packUI?.getAvailablePacks?.() || [];
        const enabledIds = new Set(packUI?.getSelection?.().selectedIds || []);
        const genre = w?.article.genre || 'article';
        const academicTarget = a.academicTarget || {};
        const recommendedSelections = availablePacks
          .filter(pack => !['builtin-article', 'builtin-academic-paper', 'builtin-softcopyright-content'].includes(pack.id) && isSelectablePack(pack, genre) && enabledIds.has(pack.id))
          .map(pack => pack.id);
        drafts.set(id, {
          title: a.title || '', genre: w ? schema.getWritingGenreConfig(a.genre)?.name || a.genre || '未支持文体' : articleConfig.name,
          taskType: round?.taskType || (genre === 'academic-paper' ? 'academic-planning'
            : genre === 'article' ? 'revision' : schema.getWritingGenreConfig(genre)?.taskTypes?.[0] || 'revision'),
          domainInputs: clone(a.domainInputs || {}),
          longformDraft: clone(w?.longform || { mode: genre }),
          academicPaperType: academicTarget.paperType || '', academicDiscipline: academicTarget.discipline || '',
          academicResearchType: academicTarget.researchType || '', academicInstitution: academicTarget.institution || '',
          academicProgram: academicTarget.program || '', academicDegreeLevel: academicTarget.degreeLevel || '',
          academicJournal: academicTarget.journal || '', academicSection: academicTarget.section || '',
          academicCitationStyle: academicTarget.citationStyle || '', academicRequirements: clone(academicTarget.requirements || []),
          goal: a.goal || '', audience: a.audience || '', platform: a.platform || '',
          success: (a.successCriteria || []).join('\n'), preserve: (a.preserveItems || []).join('\n'), constraints: a.constraints || '',
          dimensions: a.dimensions || [], draft: round?.draft || '', newDraft: '', feedback: '', preference: '', example: '', counterexample: '',
          scope: 'general', corrections: w?.styleProfile.userCorrections || '', materials: round ? references(round) : [],
          linkTitle: '', linkUrl: '',
          packSelections: savedSelections || recommendedSelections,
          prompt: round?.prompt || '', diagnosis: round?.diagnosis || '', saveEnabled: a.saveEnabled === true,
          historyId: '', historyCompareId: '', sourcePromptVersionId: '', forkContexts: ['draft'],
          unitId: round?.unitId || '', unitTitle: '', unitType: 'task', unitGoal: '', unitCriteria: '',
          issueExcerpt: '', issueLocation: '', issueObservation: '', issueImpact: '', issueEvidenceCategory: 'source',
          issueEvidence: '', issueSuggestion: '', issuePriority: 'medium', routeResult: '', routeEvidence: '',
          routeBlockReason: '', routeReturnToStageId: '',
          error: '', promptNotice: '', notifications: [], dirty: [],
          wizardStage: 1, wizardMode: 'new', wizardSuggestion: null, wizardError: '', wizardMaterialIds: [], wizardMaterialSearch: '', wizardIssueIds: [], wizardPromptEdited: false, wizardUsedPrompt: '', wizardWorkspaceId: '', wizardWorkspaceName: '',
          wizardSourceDocument: round?.sourceDocument ? clone(round.sourceDocument) : null,
          wizardSourceBusy: false, wizardSourceError: '', wizardShowFiltered: false,
          wizardFilteredCandidates: [], wizardInventoryComplete: true,
          researchMethod: '普通文章如何减少空泛总结并保留具体证据', researchKeywords: ''
        });
      }
      return drafts.get(id);
    }
    function references(round) {
      return [...(round.materials || []).map(m => ({ ...m, kind: 'material' })), ...(round.sources || []).map(m => ({ ...m, kind: 'source' }))].slice(0, 3);
    }
    function field(key, label, value, options = {}) {
      const id = `writing-${key}`;
      return `<label class="field" for="${id}"><span class="field-label">${label}</span>${options.input
        ? `<input id="${id}" data-writing-field="${options.name || key}" value="${escape(value)}">`
        : `<textarea id="${id}" data-writing-field="${options.name || key}" ${options.readOnly ? 'readonly' : ''}>${escape(value)}</textarea>`}</label>`;
    }
    function button(action, label, extra = '', disabled = false) {
      return `<button type="button" class="button-secondary" data-writing-action="${action}" ${extra} ${disabled ? 'disabled' : ''}>${label}</button>`;
    }
    function articlePatch(f) {
      // 更新目标不携带 draft，否则协调器会把它当作新轮次。
      const genre = genreId(f.genre) || 'article';
      return { genre, title: f.title, goal: f.goal, audience: f.audience, platform: f.platform,
        successCriteria: lines(f.success), preserveItems: lines(f.preserve), constraints: f.constraints, dimensions: f.dimensions,
        packSelections: f.packSelections,
        ...(schema.getWritingGenreConfig(genre)?.domainFields ? { domainInputs: f.domainInputs || {} } : {}),
        ...(genre === 'academic-paper' ? { academicTarget: {
          paperType: f.academicPaperType, discipline: f.academicDiscipline, researchType: f.academicResearchType,
          institution: f.academicInstitution, program: f.academicProgram, degreeLevel: f.academicDegreeLevel,
          journal: f.academicJournal, section: f.academicSection, citationStyle: f.academicCitationStyle,
          requirements: f.academicRequirements
        } } : {}) };
    }
    function roundInput(f, draft, id) {
      const previousCorrections = id ? workspace(id).styleProfile.userCorrections : '';
      return { draft, feedback: f.feedback, packSelections: f.packSelections, unitId: f.unitId, taskType: f.taskType, sourcePromptVersionId: f.sourcePromptVersionId,
        ...(f.corrections || previousCorrections ? { userCorrections: f.corrections } : {}),
        materials: f.materials.filter(m => m.kind !== 'source'), sources: f.materials.filter(m => m.kind === 'source'),
        preferences: f.preference.trim() ? [{ preference: f.preference, example: f.example, counterexample: f.counterexample }] : [] };
    }
    function updateOutputs(f, round, submitted) {
      // 请求期间用户仍可输入；迟到结果只更新未被重新编辑的结果框。
      for (const key of ['diagnosis', 'prompt']) if (f[key] === submitted[key]) {
        f[key] = round[key]; f.dirty = f.dirty.filter(field => field !== key);
      }
    }
    function acknowledge(f, submitted, keys) {
      f.dirty = f.dirty.filter(key => !keys.includes(key) || JSON.stringify(f[key]) !== JSON.stringify(submitted[key]));
    }
    function syncResearch(f, round, submitted) {
      updateOutputs(f, round, submitted);
      if (JSON.stringify(f.materials) === JSON.stringify(submitted.materials) && !f.dirty.includes('materials')) {
        f.materials = references(round);
      }
    }
    function persistenceStatus(w) {
      if (!w) return '默认仅本次会话；尚未保存到本机';
      const saved = (state().writingArticles || []).find(a => a.id === w.id);
      const ids = new Set(saved?.rounds.map(r => r.id) || []);
      const count = w.rounds.filter(r => ids.has(r.id)).length;
      const latest = w.rounds.at(-1);
      const snapshot = saved?.rounds.find(r => r.id === latest?.id);
      const fields = ['draft', 'feedback', 'userFeedback', 'diagnosis', 'prompt'];
      const matches = snapshot && fields.every(key => snapshot[key] === latest[key])
        && ['title', 'goal', 'audience', 'platform', 'constraints'].every(key => saved.article[key] === w.article[key])
        && saved.styleProfile.userCorrections === w.styleProfile.userCorrections;
      return `${count}/${w.rounds.length} 轮已保存到本机。${!w.article.saveEnabled ? '保存已暂停，旧历史冻结；新轮仅本次会话。' : matches ? '当前轮已保存到本机。' : '当前轮或更改尚未保存，仅在会话中。'}`;
    }
    function renderAcademicTarget(f, genre, locked) {
      if (genre !== 'academic-paper') return '';
      const fields = [
        ['paperType', '论文类型', 'academicPaperType'], ['discipline', '学科/领域', 'academicDiscipline'],
        ['researchType', '研究类型', 'academicResearchType'], ['institution', '目标学校', 'academicInstitution'],
        ['program', '项目/院系', 'academicProgram'], ['degreeLevel', '学位层级', 'academicDegreeLevel'],
        ['journal', '目标期刊', 'academicJournal'], ['section', '投稿栏目', 'academicSection'],
        ['citationStyle', '引用格式', 'academicCitationStyle']
      ];
      const requirements = f.academicRequirements.map((item, index) => `<article class="writing-academic-requirement">
        <h4>目标要求 ${index + 1}</h4>
        ${['title', 'issuer', 'target', 'version', 'sourceUrl', 'locator', 'text'].map(key => {
          const labels = { title: '要求标题', issuer: '发布机构', target: '适用目标', version: '版本/生效时间', sourceUrl: '来源链接', locator: '来源位置', text: '要求原文或摘录' };
          const id = `writing-academic-requirement-${index}-${key}`;
          const multiline = key === 'text';
          return `<label class="field" for="${id}"><span class="field-label">${labels[key]}</span>${multiline
            ? `<textarea id="${id}" data-academic-requirement-index="${index}" data-academic-requirement-field="${key}">${escape(item[key] || '')}</textarea>`
            : `<input id="${id}" data-academic-requirement-index="${index}" data-academic-requirement-field="${key}" value="${escape(item[key] || '')}">`}</label>`;
        }).join('')}
        <label class="field" for="writing-academic-requirement-${index}-verificationStatus"><span class="field-label">核对状态</span><select id="writing-academic-requirement-${index}-verificationStatus" data-academic-requirement-index="${index}" data-academic-requirement-field="verificationStatus">${[['unverified', '待核对'], ['source-reviewed', '来源已审阅'], ['user-confirmed', '用户确认']].map(([value, label]) => `<option value="${value}" ${item.verificationStatus === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        ${button('academic-remove-requirement', '移除此要求', `data-index="${index}"`, locked)}</article>`).join('');
      return `<section class="writing-academic-target"><h3>学术目标与要求</h3>
        <p class="social-muted">缺失的学校/期刊要求会标为未提供；只使用你录入或选定的版本。</p>
        <div class="social-form-grid">${fields.map(([key, label, name]) => field(`academic-${key}`, label, f[name], { input: true, name })).join('')}</div>
        ${requirements || '<p>尚未添加目标机构要求。</p>'}${button('academic-add-requirement', '添加目标要求', '', locked || f.academicRequirements.length >= 20)}</section>`;
    }
    function renderAcademicTasks(w, f, genre, locked) {
      if (!w || genre !== 'academic-paper') return '';
      const labels = {
        'academic-planning': '研究规划', 'academic-outline': '生成提纲',
        'academic-chapter-draft': '章节起草提示词', diagnosis: '诊断提示词', revision: '定向改稿提示词'
      };
      return `<section class="social-panel" id="writing-academic-tasks"><h2>学术任务</h2>
        <p class="social-muted">先在任务单元选择当前章节；每次生成会新增一条带任务类型和基础包版本的提示词记录。</p>
        <div class="social-tools">${academicTaskTypes.map(taskType => button('academic-task', labels[taskType], `data-task-type="${taskType}"`, locked)).join('')}</div></section>`;
    }
    function renderWritingSourceDocument(f) {
      const source = f.wizardSourceDocument;
      const statusLabels = { parsed: '解析完成', truncated: '已解析，但触及 30,000 字符提取上限', partial: '目录未完整识别', empty: '没有提取到可用文字', failed: '解析失败', unsupported: '格式不支持' };
      const outline = source?.outline?.length && source.processingScope === 'sections' ? `<fieldset><legend>选择要改写的章节</legend>${source.outline.map(item =>
        `<label class="writing-source-section"><input id="writing-source-section-${escape(item.id)}" type="checkbox" data-source-section="${escape(item.id)}" ${source.selectedSectionIds.includes(item.id) ? 'checked' : ''}>${escape(item.title)} <small>${escape(item.locator || '位置未识别')}</small></label>`).join('')}</fieldset>` : '';
      return `<section class="writing-source-document" aria-label="待改原文文件">
        <h3>长原文文件（可选）</h3><p>手册可从文件导入；短文也可以直接粘贴。原文不计入 3 份辅助参考材料。支持 TXT、MD、DOCX、PDF；DOCX/PDF 不超过 20 MB，PDF 不超过 100 页，解析文本最多 30,000 字符。</p>
        <input id="writing-source-file" type="file" accept=".txt,.md,.docx,.pdf" aria-label="导入待改原文文件" hidden>
        <button type="button" data-writing-action="import-source-file" ${f.wizardSourceBusy ? 'disabled' : ''}>${source ? '更换原文文件' : '导入原文文件'}</button>
        ${f.wizardSourceBusy ? '<p role="status">正在读取原文文件…</p>' : ''}
        ${f.wizardSourceError ? `<p role="alert">${escape(f.wizardSourceError)}</p>` : ''}
        ${source ? `<article class="writing-source-summary"><strong>${escape(source.name)}</strong><span>${escape(statusLabels[source.parseStatus] || '待解析')} · ${source.extractedCharacterCount} 字${source.pageCount ? ` · ${source.pageCount} 页` : ''}</span>
          ${source.parseStatus === 'truncated' ? '<p>目录和预览仅基于已提取部分；请在外部 AI 中附上原文件。</p>' : ''}
          ${source.parseStatus === 'failed' || source.parseStatus === 'empty' ? '<p>保留文件名和改写目标；可重试、粘贴短文或手动填写章节范围。</p>' : ''}
          <label class="field"><span class="field-label">处理范围</span><select id="writing-source-processing-scope" data-writing-field="wizardSourceScope"><option value="whole" ${source.processingScope === 'whole' ? 'selected' : ''}>整本处理（按章节分批）</option><option value="sections" ${source.processingScope === 'sections' ? 'selected' : ''}>选择章节/范围</option></select></label>
          ${outline}
          ${source.processingScope === 'sections' ? `<label class="field"><span class="field-label">手动指定章节或范围（目录缺失/不完整时）</span><textarea id="writing-source-manual-range" data-writing-field="wizardSourceManualRange">${escape(source.manualSectionRange || '')}</textarea></label>` : ''}
          <button type="button" data-writing-action="remove-source-file">移除原文文件</button></article>` : ''}
      </section>`;
    }
    const DOMAIN_TASK_LABELS = {
      'longform-research-article': '规划并检查长篇研究文章', 'technical-document': '生成技术文档提示词',
      'business-document': '生成商务文档提示词', news: '生成新闻任务提示词',
      'tutorial-course': '设计教程/课程提示词', 'resume-job-search': '整理简历与求职提示词',
      email: '起草或检查邮件提示词', 'official-document': '整理公文任务提示词', 'legal-document': '整理法律文书审校提示词',
      'research-brief': '研究文章规划', 'section-plan': '分节规划', 'section-diagnosis': '分节诊断', 'section-revision': '分节改稿', 'cross-section-review': '跨节复核',
      'technical-procedure': '操作说明', 'technical-api': 'API说明', 'technical-design': '技术设计说明', 'technical-troubleshooting': '故障排查',
      'business-report': '商务报告', 'business-proposal': '方案/计划', 'business-marketing': '营销内容',
      'news-fact-organization': '事实材料整理', 'news-release': '新闻稿', 'news-review': '新闻稿检查',
      'course-plan': '课程规划', 'lesson-plan': '课节/教程设计', 'learning-check': '学习检查',
      'resume-experience-map': '经历盘点', 'resume-target-fit': '岗位适配', 'resume-revision': '简历/求职信改进',
      'email-draft': '起草邮件', 'email-revision': '修改邮件', 'email-review': '发送前检查',
      'official-document-plan': '公文材料规划', 'official-document-review': '公文要求检查',
      'legal-fact-organization': '事实材料整理', 'legal-document-outline': '文书结构辅助', 'legal-document-review': '专业审校清单',
      'social-post-draft': '撰写社媒图文', 'social-carousel': '设计轮播内容', 'social-series': '规划系列内容', 'social-adaptation': '跨平台改编',
      'video-plan': '短视频规划', 'video-script': '分段视频脚本', 'video-revision': '短视频复核',
      'spoken-draft': '口播稿', 'spoken-revision': '口播稿复核',
      'podcast-plan': '播客规划', 'podcast-interview': '采访提纲', 'podcast-script': '播客脚本', 'podcast-revision': '播客复核',
      'speech-plan': '演讲规划', 'speech-outline': '演讲提纲', 'speech-draft': '演讲稿', 'speech-revision': '演讲复核',
      'longform-planning': '项目规划', 'longform-outline': '结构提纲', 'longform-worldbuilding': '故事设定',
      'longform-character': '人物设计', 'longform-chapter-draft': '章节/单元创作', 'longform-scene-draft': '剧本场景创作',
      'longform-continuity': '连续性核对', 'longform-revision': '定向修改'
    };
    function renderDomainTasks(w, f, genre, locked) {
      const config = schema.getWritingGenreConfig(genre);
      if (!w || !config?.taskTypes?.length || genre === 'academic-paper' || genre === 'article') return '';
      return `<section class="social-panel" id="writing-domain-tasks"><h2>${escape(config.name)}任务</h2>
        <p class="social-muted">选择本轮具体任务。每次生成保存独立提示词版本；包内专业方法和材料状态会随提示词显示。</p>
        <div class="social-tools">${config.taskTypes.map(taskType => button('domain-task', DOMAIN_TASK_LABELS[taskType] || taskType,
          `data-task-type="${escape(taskType)}"`, locked)).join('')}</div></section>`;
    }
    function renderLongform(w, f, genre, locked) {
      if (!w || !['fiction', 'script', 'longform-general'].includes(genre)) return '';
      const data = w.longform || { mode: genre };
      const projectFields = [['medium', '媒介/体裁'], ['viewpoint', '叙事视角'], ['tense', '时态'],
        ['audience', '目标读者'], ['scope', '篇幅/集数'], ['constraints', '创作边界']];
      const specs = {
        canon: { label: '设定', name: '名称', text: '事实/规则内容', unit: '关联单元 ID（逗号分隔）' },
        character: { label: '人物', name: '姓名/称谓', text: '目标与动机', unit: '关联单元 ID（逗号分隔）' },
        timeline: { label: '时间线', name: '事件内容', text: '故事内时间', unit: '关联单元 ID（逗号分隔）' },
        foreshadowing: { label: '伏笔', name: '铺设内容', text: '预期回收/作用', unit: '关联单元 ID（逗号分隔）' }
      };
      const itemStatuses = type => type === 'character' ? [] : type === 'foreshadowing'
        ? [['planned', '计划'], ['planted', '已铺设'], ['pending-payoff', '待回收'], ['paid-off', '已回收'], ['abandoned', '放弃'], ['unconfirmed', '未确认']]
        : [['tentative', '暂定'], ['confirmed', '已确认'], ['deprecated', '废弃']];
      const extras = {
        character: [['identity', '身份/关系'], ['relationships', '关系'], ['known', '已知信息'], ['unknown', '未知信息'], ['state', '当前状态'], ['arc', '人物弧线'], ['firstUnitId', '首次出现单元 ID'], ['lastUnitId', '最近出现单元 ID'], ['notes', '补充备注']],
        timeline: [['characterIds', '相关人物 ID（逗号分隔）'], ['canonIds', '相关设定 ID（逗号分隔）'], ['order', '与关联事件的先后关系']],
        foreshadowing: [['characterIds', '相关人物 ID（逗号分隔）'], ['canonIds', '相关设定 ID（逗号分隔）'], ['confirmation', '用户确认说明']]
      };
      const extraFields = (type, itemId = '') => (extras[type] || []).map(([key, label]) => {
        const value = itemId ? collections[type].find(item => item.id === itemId)?.[key] : '';
        const id = `writing-story-${type}${itemId ? `-item-${itemId}` : ''}-${key}`;
        if (key === 'order') return `<label class="field"><span class="field-label">${label}</span><select id="${escape(id)}">${[['before', '早于'], ['after', '晚于'], ['simultaneous', '同时'], ['unknown', '未确定']].map(([option, title]) => `<option value="${option}" ${value === option ? 'selected' : ''}>${title}</option>`).join('')}</select></label>`;
        const text = Array.isArray(value) ? value.join(', ') : value || '';
        const textarea = ['identity', 'relationships', 'known', 'unknown', 'state', 'arc', 'notes', 'confirmation'].includes(key);
        return `<label class="field"><span class="field-label">${label}</span>${textarea ? `<textarea id="${escape(id)}">${escape(text)}</textarea>` : `<input id="${escape(id)}" value="${escape(text)}">`}</label>`;
      }).join('');
      const collections = { canon: data.canon || [], character: data.characters || [], timeline: data.timeline || [], foreshadowing: data.foreshadowing || [] };
      const editor = type => {
        const spec = specs[type];
        return `<article class="writing-story-editor"><h3>新增${spec.label}</h3>
          <label class="field"><span class="field-label">${spec.name}</span><input id="writing-story-${type}-name"></label>
          <label class="field"><span class="field-label">${spec.text}</span><textarea id="writing-story-${type}-text"></textarea></label>
          <label class="field"><span class="field-label">${spec.unit}</span><input id="writing-story-${type}-units" placeholder="留空表示尚未关联"></label>
          ${extraFields(type)}
          ${button('add-longform-item', `添加${spec.label}`, `data-longform-type="${type}"`, locked)}</article>`;
      };
      const itemList = Object.entries(collections).map(([type, items]) => `<section><h3>${specs[type].label}记录</h3>${items.length ? items.map(item => {
        const primary = item.name || item.planted || item.text || item.id;
        const primaryByType = { canon: item.name, character: item.name, timeline: item.text, foreshadowing: item.planted };
        const contentByType = { canon: item.text, character: item.goals, timeline: item.storyTime, foreshadowing: item.expectedPayoff };
        return `<article class="writing-story-editor"><h4>${escape(primary)} · ${escape(item.status || '未确认')}${item.archived ? ' · 已归档' : ''}</h4><p class="social-muted">关联 ID：${escape(item.id)}</p>
          <label class="field"><span class="field-label">${specs[type].name}</span><input id="writing-story-item-${escape(item.id)}-name" value="${escape(primaryByType[type] || '')}"></label>
          <label class="field"><span class="field-label">${specs[type].text}</span><textarea id="writing-story-item-${escape(item.id)}-value">${escape(contentByType[type] || '')}</textarea></label>
          <label class="field"><span class="field-label">${specs[type].unit}</span><input id="writing-story-item-${escape(item.id)}-units" value="${escape((item.unitIds || []).join(', '))}"></label>
          ${extraFields(type, item.id)}
          ${itemStatuses(type).length ? `<label class="field"><span class="field-label">资料状态</span><select id="writing-story-item-${escape(item.id)}-status">${itemStatuses(type).map(([value, label]) => `<option value="${value}" ${item.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>` : ''}
          <label class="field"><span class="field-label">本次变更原因</span><input id="writing-story-item-${escape(item.id)}-reason"></label>
          ${button('update-longform-item', '保存变更', `data-longform-type="${type}" data-item-id="${escape(item.id)}"`, locked)}
          ${button(item.archived ? 'restore-longform-item' : 'archive-longform-item', item.archived ? '恢复故事资料' : '归档故事资料', `data-longform-type="${type}" data-item-id="${escape(item.id)}"`, locked)}</article>`;
      }).join('') : '<p>暂无记录。</p>'}</section>`).join('');
      const impact = (data.changes || []).flatMap(change => (change.impacts || []).map(item => {
        const target = item.type === 'unit' ? `writing-unit-${item.id}` : item.type === 'issue' ? `writing-issue-${item.id}` : '';
        const label = item.type === 'unit' ? '查看受影响单元' : item.type === 'issue' ? '查看受影响问题' : '';
        return `<article class="writing-story-editor">
        <p>资料变更：${escape(change.itemType)} · ${escape(change.reason || '原因未提供')}；影响对象：${escape(item.type)} ${escape(item.id)}${target ? ` · <a href="#${escape(target)}">${label}</a>` : ''}</p>
        <label class="field"><span class="field-label">审查理由</span><input id="writing-story-impact-${escape(change.id)}-${escape(item.id)}"></label>
        <label class="field"><span class="field-label">审查结论</span><select required id="writing-story-impact-status-${escape(change.id)}-${escape(item.id)}"><option value="" selected disabled>请选择审查结论</option><option value="reviewed">已检查</option><option value="no-change">无需修改</option><option value="deferred">暂缓处理</option></select></label>
        ${button('review-longform-impact', '保存审查结论', `data-change-id="${escape(change.id)}" data-item-id="${escape(item.id)}"`, locked || item.status !== 'pending')}
        <span>${escape(({ pending: '待审查', reviewed: '已检查', 'no-change': '无需修改', deferred: '暂缓处理' })[item.status] || item.status)}${item.reason ? ` · ${escape(item.reason)}` : ''}</span></article>`;
      })).join('');
      return `<section class="social-panel" id="writing-longform"><h2>长篇项目资料</h2>
        <p class="social-muted">提示词按当前单元 ID 选取已登记资料并保存本轮快照；未关联的章节、正文和附件不视为已检查。变更影响只依据显式登记关系。</p>
        <div class="social-form-grid">${projectFields.map(([key, label]) => `<label class="field"><span class="field-label">${label}</span><input data-longform-project="${key}" value="${escape(data[key] || '')}"></label>`).join('')}</div>
        ${button('save-longform-project', '保存项目设定', '', locked)}
        <div class="social-form-grid">${Object.keys(specs).map(editor).join('')}</div>${itemList}
        <h3>设定变更影响清单</h3>${impact || '<p>尚无待检查的显式关联。</p>'}</section>`;
    }
    function render() {
      const f = form();
      const w = workspace(articleId);
      const genre = w?.article.genre || genreId(f.genre) || 'article';
      const config = schema.getWritingGenreConfig(genre);
      const dimensions = config?.checkDimensions || [];
      const labels = config?.targetFields || articleConfig.targetFields;
      const locked = busy.has(articleId) || processingMaterials;
      const articles = coordinator.listArticles();
      const guidedToolbar = `<div class="social-tools"><button type="button" class="button-secondary" data-writing-action="new">新建写作任务</button><label>已保存任务 <select id="writing-article-list"><option value="">新写作</option>${articles.map(item => `<option value="${escape(item.id)}" ${item.id === articleId ? 'selected' : ''}>${escape(item.title || item.goal || '未命名任务')}</option>`).join('')}</select></label><button type="button" class="button-secondary" data-writing-action="manage-memories">管理写作记忆</button><button type="button" class="button-secondary" data-writing-action="manage-packs">管理专业规则包</button></div>`;
      const isGuided = !w || [2, 3, 4].includes(f.wizardStage);
      const guidedMarkup = isGuided ? (() => {
        const stage = Math.max(1, Math.min(4, f.wizardStage || 1));
        const titles = ['描述任务', '确认方向', '生成提示词', '带回结果'];
        const progress = `<nav aria-label="写作步骤" class="writing-wizard-progress">${titles.map((title, index) => `<button type="button" data-writing-action="wizard-stage" data-stage="${index + 1}" ${index + 1 === stage ? 'aria-current="step"' : ''} ${index + 1 >= stage ? 'disabled' : ''}>${index + 1}. ${title}</button>`).join('')}</nav>`;
        const localRecommendations = prompts?.recommendMaterials?.(f.materials, { goal: f.goal }, f.taskType) || [];
        const recommendationIds = new Set(localRecommendations.map(item => item.id));
        const materialQuery = String(f.wizardMaterialSearch || '').trim().toLocaleLowerCase();
        const fallbackMatches = f.materials.filter(material => !materialQuery
          || [material.title, material.relativePath, material.excerpt].some(value => String(value || '').toLocaleLowerCase().includes(materialQuery)));
        const visibleResult = browserIndex?.filterBrowserProjectCandidates?.({ files: f.materials,
          filteredCandidates: f.wizardFilteredCandidates || [], filteredCandidateCount: (f.wizardFilteredCandidates || []).length,
          inventoryComplete: f.wizardInventoryComplete }, { query: materialQuery, page: candidatePage, pageSize: 20 })
          || { items: fallbackMatches.slice((candidatePage - 1) * 20, candidatePage * 20), total: fallbackMatches.length, page: candidatePage, pageSize: 20 };
        const visibleMaterials = visibleResult.items.map(material => ({ material, index: f.materials.indexOf(material) }));
        const materialPageSize = 20;
        const materialPageCount = Math.max(1, Math.ceil(visibleResult.total / materialPageSize));
        candidatePage = Math.max(1, Math.min(candidatePage, materialPageCount));
        const candidateMaterials = visibleMaterials.map(({ material, index }) => `<article class="writing-wizard-material"><label><input type="checkbox" data-wizard-material="${index}" ${f.wizardMaterialIds.includes(material.id) ? 'checked' : ''} ${f.wizardMaterialIds.length >= 3 && !f.wizardMaterialIds.includes(material.id) ? 'disabled' : ''}>${escape(material.title || `材料 ${index + 1}`)}</label><p title="${escape(material.relativePath || '')}" aria-label="文件路径：${escape(material.relativePath || material.title || '')}">${escape(material.relativePath || material.contentError || '可读取参考材料')}</p><details><summary>查看摘录</summary><p>${escape(material.contentError || material.excerpt || '没有可用摘录')}</p></details><p>${recommendationIds.has(material.id) ? escape(localRecommendations.find(item => item.id === material.id)?.selectionReason || '本机关键词初筛建议') : '本机初筛未推荐，可手动选择'}</p><button type="button" data-writing-action="wizard-remove-material" data-index="${index}">移除</button></article>`).join('') || '<p role="status">没有匹配的候选文件。</p>';
        const candidatePagination = visibleResult.total > materialPageSize
          ? `<nav aria-label="参考材料候选分页"><button type="button" data-writing-action="wizard-candidate-page" data-page="${candidatePage - 1}" ${candidatePage <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${candidatePage}/${materialPageCount} 页 · 每页 20 项</span><button type="button" data-writing-action="wizard-candidate-page" data-page="${candidatePage + 1}" ${candidatePage >= materialPageCount ? 'disabled' : ''}>下一页</button></nav>` : '';
        const filteredMatches = (f.wizardFilteredCandidates || []).filter(item => !materialQuery
          || [item.title, item.relativePath, item.reason].some(value => String(value || '').toLocaleLowerCase().includes(materialQuery)));
        const projectSourceMarkup = [...projectSources.values()].map(source => `<p class="writing-project-source">当前目录：${escape(source.rootLabel)} · ${source.result.files.length} 份可读候选 · 过滤 ${source.result.filteredCandidateCount} 份 <button type="button" data-writing-action="wizard-remove-project-source" data-project-source="${escape(source.sourceId)}">移除此来源</button></p>`).join('');
        const filteredMarkup = `${projectSourceMarkup}<section class="writing-filtered-candidates"><button type="button" data-writing-action="wizard-filtered-toggle">${f.wizardShowFiltered ? '收起' : '显示'}已过滤文件（${filteredMatches.length}）</button>${f.wizardShowFiltered
          ? filteredMatches.map(item => `<article class="writing-wizard-material"><strong>${escape(item.title)}</strong><p title="${escape(item.relativePath)}">${escape(item.relativePath)}</p><p>${escape(item.reason || '默认过滤')}</p><button type="button" data-writing-action="wizard-restore-filtered" data-project-source="${escape(item.projectSourceId)}" data-relative-path="${escape(item.relativePath)}">恢复并读取</button></article>`).join('') || '<p role="status">没有可恢复的过滤项。</p>' : ''}</section>`;
        const sourceMarkup = f.wizardMode === 'rewrite' ? `${field('draft', '待改原文（可粘贴短文）', f.draft)}${renderWritingSourceDocument(f)}` : '';
        let body = '';
        if (stage === 1) body = `<fieldset><legend>你要做什么？</legend><label><input id="writing-wizard-mode-new" type="radio" name="writing-wizard-mode" data-writing-field="wizardMode" value="new" ${f.wizardMode !== 'rewrite' ? 'checked' : ''}>新写作：从目标开始，准备写作提示词</label><label><input id="writing-wizard-mode-rewrite" type="radio" name="writing-wizard-mode" data-writing-field="wizardMode" value="rewrite" ${f.wizardMode === 'rewrite' ? 'checked' : ''}>文章改写：基于已有原文定向修改</label></fieldset>${sourceMarkup}${field('goal', f.wizardMode === 'rewrite' ? '希望怎么改' : '你想写什么', f.goal)}<section><h3>辅助参考材料（可选）</h3><p>已选 ${f.wizardMaterialIds.length}/3 份辅助资料${f.wizardMode === 'rewrite' ? '；待改原文不计入此上限' : ''}。</p><button type="button" data-writing-action="wizard-import-files">选择文件</button><button type="button" data-writing-action="wizard-import-folder">临时添加文件夹</button><label>常用工作空间 <select data-writing-field="wizardWorkspaceId"><option value="">不使用</option>${(state().writingWorkspaces || []).map(item => `<option value="${escape(item.id)}" ${f.wizardWorkspaceId === item.id ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select></label><input id="writing-material-files" type="file" multiple hidden><input id="writing-material-folder" type="file" multiple webkitdirectory directory hidden><label>工作空间名称<input data-writing-field="wizardWorkspaceName" value="${escape(f.wizardWorkspaceName || '')}"></label><button type="button" data-writing-action="wizard-save-workspace" ${!f.materials.some(item => item.relativePath && f.wizardMaterialIds.includes(item.id)) || !f.wizardWorkspaceName?.trim() ? 'disabled' : ''}>保存已选文件夹材料为常用工作空间</button><label>搜索候选文件<input id="writing-wizard-material-search" data-writing-field="wizardMaterialSearch" value="${escape(f.wizardMaterialSearch)}" placeholder="按文件名、路径或摘录搜索"></label><button type="button" data-writing-action="wizard-clear-material-search">清除搜索</button><div>${candidateMaterials}${candidatePagination}${filteredMarkup}</div>${visibleMaterials.length > 3 ? '<p role="status">可查看和搜索全部候选；直接参考材料最多 3 份。</p>' : ''}${!f.materials.length ? `<p role="status">${f.wizardInventoryComplete ? '还没有可读的候选材料。' : '目录扫描未完成；已显示扫描到的范围。'}</p>` : ''}<p>目录只在本机初筛；只有你确认的摘录会用于任务分析。</p></section><button type="button" class="button-primary" data-writing-action="wizard-analyze" ${processingMaterials || f.wizardSourceBusy ? 'disabled' : ''}>确认材料并分析任务</button>`;
        if (stage === 2) {
          const suggestion = f.wizardSuggestion || {};
          const confirmedGenre = f.wizardManualGenre || suggestion.genre || 'article';
          const selectable = (packUI?.getAvailablePacks?.() || []).filter(pack => pack.id === 'builtin-softcopyright-content' && ['article', 'technical-document'].includes(confirmedGenre));
          const missingInfo = Array.isArray(suggestion.missingInfo) ? suggestion.missingInfo.filter(Boolean) : [];
          body = `<p>任务理解：${escape(f.goal)}</p>${f.wizardError ? `<p role="alert">${escape(f.wizardError)} 可手动选择后继续。</p>` : ''}<label class="field"><span class="field-label">推荐文体</span><select id="writing-wizard-genre" data-writing-field="wizardGenre">${schema.WRITING_GENRES.map(id => `<option value="${id}" ${(confirmedGenre) === id ? 'selected' : ''}>${escape(schema.getWritingGenreConfig(id)?.name || id)}</option>`).join('')}</select></label><label class="field"><span class="field-label">任务类型</span><select id="writing-wizard-task-type" data-writing-field="wizardTaskType"><option value="revision" ${f.wizardTaskType === 'revision' || !f.wizardTaskType && suggestion.taskType === 'revision' ? 'selected' : ''}>改写/优化</option><option value="diagnosis" ${f.wizardTaskType === 'diagnosis' || !f.wizardTaskType && suggestion.taskType === 'diagnosis' ? 'selected' : ''}>检查/诊断</option>${(schema.getWritingGenreConfig(confirmedGenre)?.taskTypes || []).map(task => `<option value="${escape(task)}" ${f.wizardTaskType === task || !f.wizardTaskType && suggestion.taskType === task ? 'selected' : ''}>${escape(task)}</option>`).join('')}</select></label><p>推荐依据：${escape(suggestion.reason || '模型不可用，请手动确认。')}</p>${missingInfo.length ? `<section aria-label="还需要确认的信息"><h3>还需要确认</h3><ul>${missingInfo.map(item => `<li>${escape(item)}</li>`).join('')}</ul><p>这些信息目前不阻断流程；可以在下方补充，或直接继续。</p></section>` : ''}<details><summary>更多设置（可选）</summary>${Object.entries(schema.getWritingGenreConfig(confirmedGenre)?.domainFields || {}).map(([key,label]) => `<label class="field"><span>${escape(label)}</span><textarea data-writing-domain-field="${escape(key)}">${escape(f.domainInputs?.[key] || suggestion.suggestedFields?.[key] || '')}</textarea></label>`).join('')}</details><fieldset><legend>专业规则包（与参考材料分开，可同时使用）</legend>${selectable.map(pack => `<label><input type="checkbox" data-writing-pack-selection="${escape(pack.id)}" ${f.packSelections.includes(pack.id) ? 'checked' : ''}>${escape(pack.name)}：普通文章或操作/技术文档适用</label>`).join('')||'当前文体没有兼容的规则包'}</fieldset><p>已确认材料：${f.wizardMaterialIds.length}份 ${f.wizardMaterialIds.map(id => escape(f.materials.find(m=>m.id===id)?.title)).join('、')}</p><button type="button" data-writing-action="wizard-back">返回修改目标</button><button type="button" class="button-primary" data-writing-action="wizard-confirm">确认并生成提示词</button>`;
        }
        const latestRound = w?.rounds?.at(-1);
        const roundIssues = (w?.issues || []).filter(issue => issue.roundId === latestRound?.id);
        if (stage >= 3) body = `<p>已确认：${escape(schema.getWritingGenreConfig(w.article.genre)?.name || w.article.genre)} · ${escape(w.rounds.at(-1)?.taskType || '')}</p><button type="button" data-writing-action="wizard-stage" data-stage="2">修改任务设置</button><label class="field"><span>可编辑提示词</span><textarea id="writing-prompt" data-writing-field="prompt">${escape(f.prompt)}</textarea></label><button type="button" data-writing-action="copy-prompt">复制提示词</button><button type="button" data-writing-action="save-prompt-version">保存提示词版本</button>${stage === 3 ? `<button type="button" data-writing-action="wizard-used">我已在其他 AI 中使用</button>` : `<p>任务：${escape(w.article.goal)}</p><label class="field"><span>外部 AI 结果</span><textarea id="writing-newDraft" data-writing-field="newDraft">${escape(f.newDraft)}</textarea></label>${field('feedback','这次结果哪里不满意（可选）',f.feedback)}<button type="button" data-writing-action="wizard-check">检查这份结果</button>${f.diagnosis ? `<h3>检查结果</h3><pre>${escape(f.diagnosis)}</pre><fieldset><legend>选择需要处理的问题（可选）</legend>${roundIssues.length ? roundIssues.map(issue => `<label><input id="writing-wizard-issue-${escape(issue.id)}" type="checkbox" data-wizard-issue="${escape(issue.id)}" ${f.wizardIssueIds.includes(issue.id) ? 'checked' : ''}>${escape(issue.observation || issue.excerpt || issue.suggestion)}</label>`).join('') : '<p>没有可单独选择的问题；可按完整诊断生成下一轮提示词。</p>'}</fieldset><button type="button" data-writing-action="wizard-next">生成下一轮修改提示词</button><button type="button" data-writing-action="wizard-finish">本轮完成</button>` : ''}`}`;
        const advanced = w ? `<details class="writing-wizard-advanced"><summary>更多写作工具</summary>${renderHistory(w, f)}${renderMemories(w)}${renderRoute(w, f, locked)}</details>` : '';
        return `<section class="social-panel"><h2>写作工作台</h2>${guidedToolbar}${progress}<h1>${titles[stage - 1]}</h1>${body}<p role="alert">${escape(f.error)}</p><p role="status">${escape(f.promptNotice)}</p>${advanced}</section>`;
      })() : '';
      const builtinId = genre === 'academic-paper' ? 'builtin-academic-paper' : 'builtin-article';
      const selectablePacks = (packUI?.getAvailablePacks?.() || []).filter(pack => pack.id !== builtinId
        && isSelectablePack(pack, genre));
      const promptVersionOptions = (w?.rounds || []).flatMap((round, index) => (round.promptVersions || []).map(version =>
        `<option value="${escape(version.id)}" ${f.sourcePromptVersionId === version.id ? 'selected' : ''}>第${index + 1}轮 · ${escape(version.content.slice(0, 48))}${version.copied ? ' · 已复制' : version.generated ? ' · 自动生成' : ' · 已保存'}</option>`)).join('');
      const enabledPackIds = new Set(packUI?.getSelection?.().selectedIds || []);
      const packSelectionSection = `<fieldset class="writing-pack-selection"><legend>本任务使用的专业基础包</legend>
        <p class="social-muted">${genre === 'academic-paper' ? '学术文体包自动加入。' : '普通文章内置基线默认加入。'}勾选的自定义包会按当前任务筛选规则与来源；停用包不会进入提示词。</p>
        ${selectablePacks.length ? selectablePacks.map(pack => `<label class="check-row"><input id="writing-pack-selection-${escape(pack.id)}" type="checkbox" data-writing-pack-selection="${escape(pack.id)}" ${f.packSelections.includes(pack.id) ? 'checked' : ''} ${!enabledPackIds.has(pack.id) ? 'disabled' : ''}>${escape(pack.name || pack.id)} · ${escape(pack.layer === 'core' ? '通用' : pack.layer === 'genre' ? '文体' : '专项')}${pack.enabled === false ? '（已停用）' : ''}</label>`).join('')
          : `<p>暂无适用于${escape(config?.name || '当前文体')}的自定义包，可在专业基础包管理中新增或启用。</p>`}
      </fieldset>`;
      const packManager = packUI?.renderManager?.() || '';
      const domainFields = Object.entries(config?.domainFields || {});
      const domainInputs = domainFields.length ? `<details class="writing-domain-inputs"><summary>${escape(config.name)}专属信息（可选）</summary>
        <p class="social-muted">只填写当前任务需要的信息；空项会在提示词中标为“未提供”。</p>
        ${domainFields.map(([key, label]) => `<label class="field" for="writing-domain-${escape(key)}"><span class="field-label">${escape(label)}</span>
          <textarea id="writing-domain-${escape(key)}" aria-label="${escape(label)}" data-writing-domain-field="${escape(key)}">${escape(f.domainInputs?.[key] || '')}</textarea></label>`).join('')}</details>` : '';
      packUI?.connectWorkbenchRenderer?.(render);
      const legacyMarkup = `<section class="social-panel">
        <div class="social-tools"><h2>写作工作台</h2>${button('new', '新建文章')}${button('manage-memories', managerOpen ? '收起记忆管理' : '管理全部写作记忆')}${button('manage-packs', '专业基础包')}</div>
        <label class="field" for="writing-article-list"><span class="field-label">文章列表</span><select id="writing-article-list"><option value="">新文章</option>${articles.map(a => `<option value="${escape(a.id)}" ${a.id === articleId ? 'selected' : ''}>${escape(a.title || a.goal || '未命名文章')}</option>`).join('')}</select></label>
        <div class="social-form-grid">${field('title', escape(labels.title), f.title, { input: true })}<label class="field" for="writing-genre"><span class="field-label">文体</span><input id="writing-genre" data-writing-field="genre" list="writing-genre-options" value="${escape(f.genre)}" ${w ? 'disabled' : ''}><datalist id="writing-genre-options">${schema.WRITING_GENRES.map(id => `<option value="${escape(schema.getWritingGenreConfig(id)?.name || id)}">`).join('')}</datalist></label></div>
        ${renderAcademicTarget(f, genre, locked)}
        ${domainInputs}
        ${field('goal', escape(labels.goal), f.goal)}<div class="social-form-grid">${field('audience', escape(labels.audience), f.audience, { input: true })}${field('platform', escape(labels.platform), f.platform, { input: true })}</div>
        <div class="social-form-grid">${field('success', `${escape(labels.successCriteria)}（每行一项）`, f.success)}${field('preserve', `${escape(labels.preserveItems)}（每行一项）`, f.preserve)}</div>${field('constraints', `${escape(labels.constraints)}（最多500字）`, f.constraints)}
        ${config ? `<details><summary>${escape(config.name)}检查依据</summary><p>适用：${escape(config.applicability)}</p><p>风险：${escape(config.riskReminders.join('；'))}</p><p>风格建议（低于当前要求、样本/用户更正和适用记忆）：${escape(config.styleBaseline.join('；'))}</p></details>` : '<p>当前文体暂不支持；新建时可确认按普通文章处理。</p>'}
        <fieldset class="writing-dimensions"><legend>诊断维度（可选；不选按全部${dimensions.length}项初检）</legend>${dimensions.map((d, i) => `<label><input id="writing-dimension-${i}" type="checkbox" data-writing-dimension="${escape(d)}" ${f.dimensions.includes(d) ? 'checked' : ''}>${escape(d)}</label>`).join('')}</fieldset>
        ${packSelectionSection}
        ${renderUnits(w, f, locked)}
        ${renderLongform(w, f, genre, locked)}
      ${renderMaterialCoverage(w, locked)}
        ${field('draft', w ? '当前稿件（只读；新稿从下方带回）' : '初稿（可选）', f.draft, { readOnly: !!w })}
        <div class="social-tools">${button(w ? 'update' : 'create', w ? '更新目标并本地初检' : '新建并本地初检', '', locked)}${w ? button('build', '重新本地初检', '', locked) : ''}</div>
        <label class="check-row"><input id="writing-save" type="checkbox" ${f.saveEnabled ? 'checked' : ''} ${!w || locked ? 'disabled' : ''}>开启本机保存</label>
        <p class="social-muted">默认不保存正文。开启后稿件、反馈和轮次保存在本机；发送模型仍须查看发送预览并确认。</p>
        <p id="writing-save-status" role="status">${escape(persistenceStatus(w))}</p>${processingMaterials ? `<p role="status">正在读取材料，结果只暂存在当前页面。</p>${button('cancel-material-parse', '取消读取')}` : ''}
        <p id="writing-error" role="alert" tabindex="-1">${escape(f.error)}</p>${processingMaterials ? '<p role="status">正在读取所选材料，请稍候…</p>' : busy.has(articleId) ? '<p role="status">正在处理当前文章…</p>' : ''}
        ${w ? button('delete-article', '删除整篇及所有轮次', '', locked) : ''}
      </section>
      ${renderAcademicTasks(w, f, genre, locked)}
        ${renderDomainTasks(w, f, genre, locked)}
      <section class="social-panel"><h2>参考材料与风格</h2><p class="social-muted">内容 / 风格 / 要求合计最多3份。学术项目会把三种用途分开展示；风格样本不作事实证据。材料编辑在新建或下一轮时应用。</p>
        ${renderMaterials(f, w, genre)}<div class="social-tools">${button('add-material', '粘贴/填写材料', '', f.materials.length >= 3 || processingMaterials)}${button('import-material-files', '导入文件', '', f.materials.length >= 3 || processingMaterials)}${button('select-materials', '从资料库/授权目录选择', '', !w || locked)}</div>
        <input id="writing-material-files" type="file" aria-label="导入写作参考材料" accept=".txt,.md,.csv,.json,.pdf,.docx,.png,.jpg,.jpeg,.webp" multiple hidden __COND__>
        <details><summary>添加公开链接并按需读取正文</summary>
          <label class="field" for="writing-material-link-title"><span class="field-label">来源标题（可选）</span><input id="writing-material-link-title" data-writing-field="linkTitle" value="${escape(f.linkTitle)}"></label>
          <label class="field" for="writing-material-link-url"><span class="field-label">HTTP 或 HTTPS 链接</span><input id="writing-material-link-url" type="url" data-writing-field="linkUrl" value="${escape(f.linkUrl)}"></label>
          ${button('add-material-link', '加入链接', '', f.materials.length >= 3 || processingMaterials)}
        </details>
        <p class="social-muted">读取公开网页会向该网站发送链接请求并暴露你的网络地址；含查询参数的链接也会发送给该网站。不会携带登录状态或工作区内容。读取文本只暂存在当前页面，选摘后才进入本轮提示词；来源仍未核验。不可访问或需要登录时，请粘贴可读摘录。目录需先在本地资料设置中授权。</p>
        ${renderStyle(w)}${field('style-corrections', '用户纠正（最多2000字）', f.corrections, { name: 'corrections' })}${button('correct-style', '应用风格纠正', '', !w || locked)}
        ${renderResearch(w, f, locked)}
      </section>
      ${renderRoute(w, f, locked)}
      <section class="social-panel"><h2>本轮初检与下一轮提示词</h2><p class="social-muted">可编辑后保存为版本或复制；复制记录只表示本机复制操作，不表示外部模型已接收。模型诊断只分析并给提示词，不直接改写文章。正文和反馈可能离开本机，发送前仍需确认。</p>
        ${field('diagnosis', '具体诊断（本地初检不等于模型判断）', f.diagnosis)}${button('copy-diagnosis', '复制诊断')}
        ${field('prompt', '下一轮提示词', f.prompt)}<div class="social-tools">${button('save-prompt-version', '保存提示词版本', '', !w || locked)}${button('copy-prompt', '复制并记录提示词版本', '', processingMaterials)}${button('export-prompt-history', '导出本轮提示词历史')}${button('model', '预览并请求模型诊断', '', !w || locked)}</div>${(w?.rounds.at(-1)?.promptVersions?.length || 0) >= 80 ? '<p role="status">本轮提示词历史已接近100条。历史会继续完整保留；建议导出备份。</p>' : ''}<p role="status">${escape(f.promptNotice)}</p>
      </section>
      ${renderIssues(w, f, locked)}
      <section class="social-panel"><h2>带回外部新稿与反馈</h2>${field('new-draft', '外部 AI 新稿', f.newDraft, { name: 'newDraft' })}<label class="field" for="writing-source-prompt-version"><span class="field-label">此结果使用的提示词版本</span><select id="writing-source-prompt-version" data-writing-field="sourcePromptVersionId"><option value="" ${f.sourcePromptVersionId ? '' : 'selected'}>来源提示词未关联</option>${promptVersionOptions}</select></label>${field('feedback', '本轮反馈（不会自动变成长久偏好）', f.feedback)}
        <h3>可选偏好候选</h3><p class="social-muted">只统计你在下方明确填写的候选；两篇不同文章重复时可晋升，并提供撤销。</p>
        ${field('preference', '偏好候选（可编辑）', f.preference)}<div class="social-form-grid">${field('example', '例句', f.example)}${field('counterexample', '反例', f.counterexample)}</div>
        ${button('append', '回带并新增同篇一轮', '', !w || locked)}
        <label class="field" for="writing-memory-scope"><span class="field-label">显式记忆范围</span><select id="writing-memory-scope" data-writing-field="scope">${Object.entries(scopeLabels).map(([value, label]) => `<option value="${value}" ${f.scope === value ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select></label>
        ${button('remember', '记住这个偏好', '', !w || locked)}${renderNotifications(f)}
      </section>
      ${renderHistory(w, f)}${renderMemories(w)}${packManager}`;
      mount.innerHTML = isGuided ? `${guidedMarkup}<div hidden>${legacyMarkup}</div>` : legacyMarkup;
      if (focusAfterRenderId) {
        document.getElementById(focusAfterRenderId)?.focus?.();
        focusAfterRenderId = '';
      }
    }
    function renderMaterialCoverage(w, locked) {
      if (!w) return '';
      const saved = w.materialCoverage;
      const preview = coveragePreview.get(articleId);
      const summary = saved ? coverageApi?.summarizeCoverage(saved) : null;
      const statusLabels = { pending: '待处理', 'in-progress': '处理中', returned: '已带回待确认', processed: '已确认处理', excluded: '已排除', failed: '失败/不可用' };
      const itemRows = saved?.items?.map(item => `<li><strong>${escape(item.title)}</strong> · ${escape(item.relativePath || '资料库条目')} · ${escape(statusLabels[item.status] || item.status)}${item.reason ? ` · ${escape(item.reason)}` : ''}${['pending', 'failed'].includes(item.status) ? `<label>排除理由<input id="writing-coverage-reason-${escape(item.id)}" aria-label="${escape(item.title)}排除理由"></label>${button('coverage-exclude', '排除', `data-source-id="${escape(item.id)}"`)}` : ''}</li>`).join('') || '';
      const batchRows = saved?.batches?.map(batch => `<article class="writing-coverage-batch"><h4>${escape(batch.id)} · ${escape(batch.status)}</h4><p>${batch.itemIds.length} 项${batch.reason ? ` · ${escape(batch.reason)}` : ''}${batch.confirmation ? ` · 确认：${escape(batch.confirmation)}` : ''}</p>
        ${batch.status === 'in-progress' ? `<label class="field">失败原因<input id="writing-coverage-failure-${escape(batch.id)}"></label>${button('coverage-fail', '记录本批失败', `data-batch-id="${escape(batch.id)}"`)}<label class="field">回带结果摘要<textarea id="writing-coverage-result-${escape(batch.id)}"></textarea></label>${button('coverage-return', '记录外部结果已带回', `data-batch-id="${escape(batch.id)}"`)}` : ''}
        ${batch.status === 'result-returned' ? `<label class="field">确认依据<input id="writing-coverage-confirmation-${escape(batch.id)}" placeholder="例如：已逐项核对外部结果"></label>${button('coverage-confirm', '确认本批已处理', `data-batch-id="${escape(batch.id)}"`)}` : ''}
        ${batch.status === 'failed' ? button('coverage-retry', '重试失败材料', `data-batch-id="${escape(batch.id)}"`) : ''}</article>`).join('') || '';
      const historicalRanges = saved?.history?.length ? `<details><summary>历史资料范围（${saved.history.length}）</summary>${saved.history.map(previous => {
        const previousSummary = coverageApi.summarizeCoverage(previous);
        return `<article class="writing-coverage-batch"><h4>${escape(previous.filters || previous.sourceKind)} · ${escape(previous.id)}</h4><p>发现 ${previousSummary.discovered} · 完成 ${previousSummary.processed} · 排除 ${previousSummary.excluded} · 失败 ${previousSummary.failed}${previousSummary.inventoryComplete ? ` · 覆盖率 ${previousSummary.coveragePercent ?? 0}%` : ' · 范围不完整'}</p><ul>${previous.items.map(item => `<li>${escape(item.title)} · ${escape(statusLabels[item.status] || item.status)}${item.reason ? ` · ${escape(item.reason)}` : ''}</li>`).join('')}</ul>${previous.batches.map(batch => `<p>${escape(batch.id)} · ${escape(batch.status)} · ${batch.itemIds.length} 项${batch.confirmation ? ` · ${escape(batch.confirmation)}` : ''}</p>`).join('')}</article>`;
      }).join('')}</details>` : '';
      const sourceItems = preview?.items || [];
      const previewRows = sourceItems.map(item => `<li><label><input id="writing-coverage-include-${escape(item.id)}" type="checkbox" data-coverage-include="${escape(item.id)}" aria-label="纳入 ${escape(item.title)}" ${item.included === false ? '' : 'checked'} ${item.status !== 'pending' ? 'disabled' : ''}>纳入本次范围</label> ${escape(item.title)} · ${escape(item.relativePath || '资料库条目')} · ${item.status === 'pending' ? '可处理' : `不可用：${escape(item.reason || item.status)}`}</li>`).join('');
      const dirs = (state().promptAgentSources || []).filter(source => source.enabled && !source.unavailable);
      const promptVersion = (w.rounds.at(-1)?.promptVersions || []).find(version => version.id === saved?.batches?.at(-1)?.promptVersionId);
      return `<section class="social-panel writing-material-coverage" aria-labelledby="writing-coverage-heading"><h2 id="writing-coverage-heading">资料全范围批处理</h2>
        <p class="social-muted">确认一个完整资料范围后，逐批生成可复制提示词。复制不代表外部 AI 已处理；只有带回结果并填写确认依据后才计入完成。</p>
        <div class="social-tools">${button('coverage-preview-library', '预览全部资料库条目', '', locked || !(state().knowledgeEntries || []).some(item => !item.hiddenAt))}${dirs.map(source => button('coverage-preview-directory', `刷新并预览目录：${source.label || source.id}`, `data-source-id="${escape(source.id)}"`, locked)).join('')}</div>
        ${dirs.length ? '<label class="field" for="writing-coverage-directory-filter">授权目录子目录（可选，相对路径）<input id="writing-coverage-directory-filter" placeholder="例如：资料/项目A"></label>' : ''}
        ${preview ? `<h3>范围预览：${escape(preview.label)}</h3><p role="status">发现 ${preview.items.length} 项${preview.inventoryComplete ? ' · 枚举完整' : ' · 范围不完整，未知项不能计为完成'}；可用 ${preview.items.filter(item => item.status === 'pending').length} 项；不可用 ${preview.items.filter(item => item.status === 'failed').length} 项。筛选：${escape(preview.filters || '全部')}</p><ul>${previewRows}</ul>${button('coverage-confirm-range', '确认此资料范围', '', locked || sourceItems.length === 0)}` : ''}
        ${saved ? `<h3>覆盖进度</h3><p role="status">发现 ${summary.discovered} / ${summary.knownTotal} · 待处理 ${summary.pending} · 处理中 ${summary.inProgress} · 已带回 ${summary.returned} · 已完成 ${summary.processed} · 排除 ${summary.excluded} · 失败 ${summary.failed} · ${summary.inventoryComplete ? `覆盖率 ${summary.coveragePercent ?? 0}%` : '范围不完整，覆盖率不可计算'}</p><ul>${itemRows}</ul>
          <div class="social-tools">${button('coverage-start-batch', '生成下一批提示词', '', locked || !summary.pending)}<label>每批数量 <select id="writing-coverage-batch-size"><option value="1">1</option><option value="3" selected>3</option><option value="5">5</option></select></label></div>
          ${promptVersion ? `<label class="field">当前批次提示词<textarea readonly>${escape(promptVersion.content)}</textarea></label>${button('coverage-copy-batch', '复制当前批次提示词')}` : ''}${batchRows}${historicalRanges}</section>`
        : '<p>尚未确认资料范围。</p>'}
      </section>`;
    }
    function renderMaterials(f, w, genre) {
      const target = w?.article || { goal: f.goal, successCriteria: f.successCriteria, dimensions: f.dimensions };
      const taskType = w?.rounds.at(-1)?.taskType || f.taskType || schema.getWritingGenreConfig(genre)?.taskTypes?.[0] || 'revision';
      const recommendations = typeof prompts?.recommendMaterials === 'function'
        ? prompts.recommendMaterials(f.materials, target, taskType)
        : f.materials.filter(item => item.excerpt && !['failed', 'unsupported', 'pending'].includes(item.contentStatus))
          .slice(0, 3).map(item => ({ ...item, selectionReason: '当前任务未提供可用关键词，按顺序保留；请人工调整。' }));
      const recommendedIds = new Set(recommendations.map(item => item.id));
      return f.materials.map((m, i) => {
        const latestRound = w?.rounds.at(-1);
        const savedInLatestRound = !!m.id && !!latestRound
          && [...latestRound.materials, ...latestRound.sources].some(item => item.id === m.id);
        const recommended = recommendedIds.has(m.id);
        const selected = m.selectedForPrompt === true || m.selectedForPrompt !== false && recommended;
        const recommendation = recommendations.find(item => item.id === m.id);
        return `<div class="writing-material"><h3>材料 ${i + 1}</h3>
        <p class="social-muted">${escape(materialStatus(m))}</p>
        <label class="check-row"><input id="writing-material-${i}-selection" type="checkbox" data-material-index="${i}" data-material-field="selectedForPrompt" ${selected ? 'checked' : ''}>${selected ? '本轮选用' : '本轮不采用'}${recommendation ? ` · ${escape(recommendation.selectionReason)}` : ' · 无可用摘录或读取未完成'}</label>
        <label class="field">标题<input id="writing-material-${i}-title" data-material-index="${i}" data-material-field="title" value="${escape(m.title)}"></label>
        ${m.kind === 'source' ? `<label class="field">链接<input id="writing-material-${i}-url" data-material-index="${i}" data-material-field="url" value="${escape(m.url)}"></label>` : ''}
        <label class="field">用途<select id="writing-material-${i}-purpose" data-material-index="${i}" data-material-field="purpose" data-material-purpose="${i}">${[['content', '研究内容/证据'], ['style', '风格参考'], ['both', '内容与风格'], ...(genre === 'academic-paper' ? [['requirement', '目标要求']] : [])].map(([value, label]) => `<option value="${value}" ${m.purpose === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="field">摘要或样本（最多1200字）<textarea id="writing-material-${i}-excerpt" data-material-index="${i}" data-material-field="excerpt">${escape(m.excerpt)}</textarea></label>
        ${[['provider', '提供方/发布方'], ['accessedAt', '访问/提供日期'], ['license', '许可/授权说明'], ['applicability', '适用范围'], ['limitations', '限制']].map(([key, label]) => `<label class="field">${label}<input id="writing-material-${i}-${key}" aria-label="${label}" data-material-index="${i}" data-material-field="${key}" value="${escape(m[key] || '')}"></label>`).join('')}
        ${(w?.units || []).length ? `<fieldset class="writing-material-units"><legend>材料适用范围</legend><label class="check-row"><input type="checkbox" data-material-index="${i}" data-material-unit-id="" ${m.unitIds?.length ? '' : 'checked'}>全文材料</label>${w.units.map(unit => `<label class="check-row"><input id="writing-material-${i}-unit-${escape(unit.id)}" type="checkbox" data-material-index="${i}" data-material-unit-id="${escape(unit.id)}" ${m.unitIds?.includes(unit.id) ? 'checked' : ''}>${escape(unit.title)}${unit.archived ? ' · 已归档' : ''}</label>`).join('')}${button('apply-material-units', '应用材料范围', `data-index="${i}"`, !savedInLatestRound)}</fieldset>` : ''}
        ${m.url && /^https?:\/\//i.test(m.url) ? `<a href="${escape(m.url)}" target="_blank" rel="noreferrer">来源</a>` : ''}
        <p>来源核验：${escape(verificationLabels[m.verificationStatus] || '未核验')}</p>
        ${m.sourceLocator ? `<p>来源位置：${escape(m.sourceLocator)}</p>` : ''}${m.sourceVersion ? `<p>来源版本：${escape(m.sourceVersion)}</p>` : ''}
        ${m.excerptLocator ? `<p>摘录位置：${escape(m.excerptLocator)}</p>` : ''}${m.selectionReason ? `<p>选用理由：${escape(m.selectionReason)}</p>` : ''}
        ${m.extractionMethod ? `<p>解析方式：${escape({ 'pdf-text': 'PDF 文本抽取', 'pdf-ocr': 'PDF 本机 OCR', 'docx-text': 'Word 文本抽取', 'image-ocr': '本机 OCR' }[m.extractionMethod] || m.extractionMethod)} · 共${Number(m.extractedCharacterCount) || 0}字${m.pageCount ? ` · ${Number(m.pageCount)}页` : ''} · 未核验</p>` : ''}
        ${m.sourceType === 'link' ? `<p role="status">${escape(webReadResults.get(m.id)?.error || (webReadResults.get(m.id) ? `已读取${webReadResults.get(m.id).characterCount}字 · ${webReadResults.get(m.id).incomplete ? '内容不完整' : '正文未核验'}` : '网页正文尚未读取'))}</p>${button('read-web-material', '读取网页', `data-index="${i}"`, processingMaterials)}${webReadResults.get(m.id)?.ok ? `<p>页面标题：${escape(webReadResults.get(m.id).title)}</p><p>最终来源：${escape(webReadResults.get(m.id).finalUrl)}</p>${webReadResults.get(m.id).incomplete ? '<p role="status">只提供部分正文，内容长度受限。</p>' : ''}<fieldset><legend>网页正文（仅当前页面暂存）</legend><p>${escape(webReadResults.get(m.id).text.slice(0, 1000))}${webReadResults.get(m.id).text.length > 1000 ? '…' : ''}</p>${button('use-web-segment', '选入摘录', `data-index="${i}"`, processingMaterials)}</fieldset>` : ''}` : ''}
        ${m.parseWarnings?.length ? `<p role="status">${m.parseWarnings.map(escape).join('；')}</p>` : ['image-ocr', 'pdf-ocr'].includes(m.extractionMethod) ? `<p role="status">OCR 结果可能有误${Number.isFinite(m.recognitionConfidence) ? ` · 置信度 ${Math.round(m.recognitionConfidence)}%` : ''}；手写、公式和版面结构需人工核对。</p>` : ''}
        ${m.parsedSegments?.length ? `<fieldset><legend>本机解析片段（仅当前页面暂存）</legend>${m.parsedSegments.map((segment, segmentIndex) => `<div><p>${escape(segment.locator)} · ${segment.text.length}字</p><p>${escape(segment.text.slice(0, 180))}${segment.text.length > 180 ? '…' : ''}</p>${button('use-material-segment', '选入摘录', `data-index="${i}" data-segment-index="${segmentIndex}"`, processingMaterials)}</div>`).join('')}</fieldset>` : ''}
        ${m.attachmentRequired ? '<p>原附件需另行提供；本轮提示词只包含卡片中的可见摘录。</p>' : ''}
        ${m.contentError ? `<p role="alert">${escape(m.contentError)}</p>` : ''}
        ${m.excerpt?.trim() && !m.savedToLibrary ? button('save-material-to-library', '保存到资料库', `data-index="${i}"`) : m.savedToLibrary ? '<p role="status">已保存到资料库</p>' : ''}
        ${button('remove-material', '移除材料', `data-index="${i}"`)}</div>`;
      }).join('');
    }
    function materialStatus(material) {
      if (material.contentStatus === 'parsed') return `本机解析完成，${Number(material.extractedCharacterCount) || 0}字，尚未选入摘录`;
      if (material.contentStatus === 'truncated') return `仅读取前1200字符，共${material.originalLength || '未知'}字符`;
      if (material.contentStatus === 'reference-only') return '只保留引用，未读取正文';
      if (material.contentStatus === 'failed') return `读取失败：${material.contentError || '原因未提供，仍保留材料卡片'}`;
      if (material.contentStatus === 'unsupported') return `格式不支持：${material.contentError || '可粘贴需要使用的摘录'}`;
      if (material.contentStatus === 'embedded' || material.sourceType === 'text-file') return '已读取卡片中的摘录，可在下方核对';
      return '本轮材料';
    }
    function renderResearch(w, f, locked) {
      const research = w ? coordinator.getResearchState(w.id) : { status: 'idle' };
      const status = { idle: '尚未搜索', 'awaiting-confirmation': '等待批准搜索计划', running: '正在搜索', rejected: '本篇已拒绝搜索，不再重复申请',
        cancelled: '搜索已取消，保留本地初检', failed: '搜索失败或无结果，仍可离线初检并复制提示词', partial: '搜索部分完成，来源仍待核验', complete: '搜索完成，公开线索仍待核验' };
      const waiting = research.status === 'awaiting-confirmation';
      const methods = ['普通文章如何减少空泛总结并保留具体证据', '普通文章如何组织清晰结构和段落推进', '普通文章如何保持自然表达并避免模板化语气'];
      return `<h3>查找写作案例/Skill</h3><p class="social-muted">仅用下方固定问题和单独填写的短关键词构造查询，不自动读取正文、完整反馈、记忆或私有目录。关键词最多40字，仅限文字、数字、空格和短横线；请自行核对敏感信息，本工具不保证识别所有敏感信息。</p>
        <label class="field" for="writing-research-method"><span class="field-label">写作方法问题</span><select id="writing-research-method" data-writing-field="researchMethod">${methods.map(m => `<option value="${escape(m)}" ${m === f.researchMethod ? 'selected' : ''}>${escape(m)}</option>`).join('')}</select></label>
        ${field('research-keywords', '独立搜索关键词（可选，最多40字）', f.researchKeywords, { input: true, name: 'researchKeywords' })}
        ${button('preview-research', '查找写作案例/Skill：预览计划', '', !w || locked || research.status === 'rejected')}
        <p id="writing-research-status" role="status">${escape(status[research.status] || '计划已失效，请重新预览')}${research.error ? `：${escape(research.error)}` : ''}</p>
        ${research.contextNote ? `<p role="status">${escape(research.contextNote)}</p>` : ''}
        ${research.queries?.length ? `<p>目标：${escape(research.objective)}<br>来源范围：GitHub / 公开网页<br>预算：最多3次查询 / 5个来源<br>预期用途：${escape(research.expectedUse)}</p><ol>${research.queries.map(q => `<li>${escape(q)}</li>`).join('')}</ol>` : ''}
        ${waiting ? `<div class="social-tools">${button('approve-research', '批准以上精确查询并搜索', '', locked)}${button('reject-research', '本篇拒绝搜索', '', locked)}</div>` : ''}
        ${research.status === 'running' ? button('cancel-research', '取消本次搜索') : ''}
        ${research.results?.length ? `<p>本轮最多合并3份上下文，手工材料和已有风格样本优先；其余来源仅展示。公开Skill仅作线索，不会自动升级记忆。</p>${research.results.map(s => `<p>${escape(s.title)} · 未验证<br>${/^https?:\/\//i.test(s.url) ? `<a href="${escape(s.url)}" target="_blank" rel="noreferrer">${escape(s.url)}</a>` : ''}<br>适用：${escape(s.applicability)}<br>局限：${escape(s.limitations)}<br>摘要：${escape(s.summary)}</p>`).join('')}` : ''}`;
    }
    function renderStyle(w) {
      const p = w?.styleProfile;
      return `<h3>提炼风格特征</h3><p>来源：${escape(sourceLabels[p?.source] || '临时判断')} · 把握度：${escape(confidenceLabels[p?.confidence] || '低')} · ${!p || p.source === 'temporary' ? '临时判断，等待样本或用户确认' : '只统计可观察形式，含义仍待核实'}</p><ul>${(p?.traits || []).map(t => `<li>${escape(t)}</li>`).join('')}</ul>`;
    }
    function renderHistory(w, f) {
      if (!w) return '';
      const round = w.rounds.find(r => r.id === f.historyId);
      const otherRounds = w.rounds.filter(item => item.id !== round?.id);
      const compareRoundId = otherRounds.some(item => item.id === f.historyCompareId)
        ? f.historyCompareId : otherRounds.at(-1)?.id || '';
      const comparison = round && compareRoundId ? coordinator.compareRounds(w.id, round.id, compareRoundId) : null;
      const comparedFields = comparison ? ['draft', 'prompt', 'diagnosis', 'feedback', 'userFeedback'].map((key, index) => {
        const label = ['稿件', '提示词', '诊断', '反馈', '用户反馈'][index];
        const change = comparison.changes[key];
        const removed = change.removed.map(line => `<span class="writing-diff-removed">− ${escape(line)}</span>`).join('<br>');
        const added = change.added.map(line => `<span class="writing-diff-added">＋ ${escape(line)}</span>`).join('<br>');
        return `<details class="writing-history-diff"><summary>${label} · ${change.changed ? '有变化' : '无变化'}</summary>
          <label class="field">所选轮次<textarea readonly>${escape(change.left)}</textarea></label>
          <label class="field">对照轮次<textarea readonly>${escape(change.right)}</textarea></label>
          ${change.changed ? `<p>逐行变化：${removed}${removed && added ? '<br>' : ''}${added}</p>` : ''}</details>`;
      }).join('') : '';
      const comparedIssues = comparison ? `<h3>关联问题</h3><p>所选轮次：${comparison.issues.left.length
        ? comparison.issues.left.map(issue => `${escape(issue.priority)} · ${escape(issue.excerpt)}`).join('；') : '无关联问题'}</p>
        <p>对照轮次：${comparison.issues.right.length
        ? comparison.issues.right.map(issue => `${escape(issue.priority)} · ${escape(issue.excerpt)}`).join('；') : '无关联问题'}</p>` : '';
      const contexts = [['draft', '稿件'], ['feedback', '反馈'], ['diagnosis', '诊断'], ['materials', '材料'],
        ['unit', '任务单元'], ['route', '专业路线'], ['packs', '基础包选择'], ['prompt', '提示词来源']];
      const forkControls = round ? `<fieldset class="writing-fork-contexts"><legend>从此轮继续时复制的内容</legend>${contexts.map(([key, label]) =>
        `<label class="check-row"><input type="checkbox" data-writing-fork-context="${key}" ${f.forkContexts.includes(key) ? 'checked' : ''}>${label}</label>`).join('')}
        ${button('continue-from-round', '从此轮继续', `data-round-id="${escape(round.id)}"`)}</fieldset>` : '';
      return `<section class="social-panel"><h2>轮次回看与比较</h2><div class="social-tools">${w.rounds.map((r, i) => button('round', `第${i + 1}轮`, `data-round-id="${escape(r.id)}"`)).join('')}</div>${round ? `<label class="field">历史原稿<textarea id="writing-history-draft" readonly>${escape(round.draft)}</textarea></label><label class="field">历史反馈<textarea readonly>${escape(round.feedback || round.userFeedback)}</textarea></label><label class="field">历史诊断<textarea readonly>${escape(round.diagnosis)}</textarea></label><label class="field">历史提示词<textarea readonly>${escape(round.prompt)}</textarea></label>
        <label class="field" for="writing-history-compare"><span class="field-label">与另一轮比较</span><select id="writing-history-compare" data-writing-field="historyCompareId">${otherRounds.map(item => `<option value="${escape(item.id)}" ${item.id === compareRoundId ? 'selected' : ''}>第${w.rounds.findIndex(candidate => candidate.id === item.id) + 1}轮</option>`).join('')}</select></label>
        ${comparison ? `<div id="writing-history-comparison"><h3>逐行对照</h3>${comparedFields}${comparedIssues}</div>` : '<p>至少有两个轮次后可比较。</p>'}${forkControls}` : '<p>选择一个轮次查看，不会替换当前表单。</p>'}</section>`;
    }
    function renderUnits(w, f, locked) {
      if (!w) return '';
      const units = [...(w.units || [])].sort((a, b) => a.order - b.order);
      return `<section class="social-panel" id="writing-task-units"><h2>任务单元</h2>
        <p class="social-muted">单元描述会进入所选单元的提示词。选择单元后，在回带新稿时应用；没有选择时按全文任务处理。</p>
        <label class="field" for="writing-unit-selection"><span class="field-label">本轮任务范围</span><select id="writing-unit-selection" data-writing-field="unitId">
          <option value="" ${f.unitId ? '' : 'selected'}>全文任务</option>${units.filter(unit => !unit.archived).map(unit =>
          `<option value="${escape(unit.id)}" ${f.unitId === unit.id ? 'selected' : ''}>${escape(unit.title)}</option>`).join('')}</select></label>
        <h3>新增单元</h3><div class="social-form-grid">
          ${field('unit-title', '标题', f.unitTitle, { name: 'unitTitle' })}<label class="field" for="writing-unit-type"><span class="field-label">类型</span><select id="writing-unit-type" data-writing-field="unitType">${[['chapter', '章节'], ['fragment', '片段'], ['task', '任务']].map(([value, label]) => `<option value="${value}" ${f.unitType === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        </div>${field('unit-goal', '目标', f.unitGoal, { name: 'unitGoal' })}${field('unit-criteria', '完成标准（每行一项）', f.unitCriteria, { name: 'unitCriteria' })}
        ${w.article.genre === 'longform-research-article' ? `<details><summary>章节规划与关系（可选）</summary>
          ${field('unit-summary', '本节摘要/职责', '', { name: 'unitSummary' })}
          ${field('unit-prior-unit-ids', '前序章节 ID（逗号分隔）', '', { name: 'unitPriorUnitIds', input: true })}
          ${field('unit-next-unit-ids', '后续章节 ID（逗号分隔）', '', { name: 'unitNextUnitIds', input: true })}</details>` : ''}
        ${['fiction', 'script', 'longform-general'].includes(w.article.genre) ? `<details><summary>章节/场景连续性资料（可选）</summary>
          ${field('unit-viewpoint', '视角', '', { name: 'unitViewpoint' })}${field('unit-story-time', '故事内时间', '', { name: 'unitStoryTime' })}${field('unit-location', '地点/内外景', '', { name: 'unitLocation' })}
          ${field('unit-purpose', '场景目的/冲突', '', { name: 'unitPurpose' })}${field('unit-character-ids', '人物 ID（逗号分隔）', '', { name: 'unitCharacterIds', input: true })}
          ${field('unit-summary', '单元用户摘要', '', { name: 'unitSummary' })}${field('unit-prior-unit-ids', '前序单元 ID（逗号分隔）', '', { name: 'unitPriorUnitIds', input: true })}
          ${field('unit-next-unit-ids', '后续单元 ID（逗号分隔）', '', { name: 'unitNextUnitIds', input: true })}
          ${field('unit-format', '剧本场景格式', '', { name: 'unitFormat', input: true })}${field('unit-entrances', '人物出场', '', { name: 'unitEntrances' })}
          ${field('unit-exits', '人物退场', '', { name: 'unitExits' })}${field('unit-action', '可呈现动作', '', { name: 'unitAction' })}
          ${field('unit-canon-ids', '设定 ID（逗号分隔）', '', { name: 'unitCanonIds', input: true })}${field('unit-event-ids', '时间线事件 ID（逗号分隔）', '', { name: 'unitEventIds', input: true })}
          ${field('unit-foreshadowing-ids', '伏笔 ID（逗号分隔）', '', { name: 'unitForeshadowingIds', input: true })}</details>` : ''}
        ${button('add-unit', '新增任务单元', '', locked)}
        ${units.length ? units.map(unit => `<div class="writing-unit" id="writing-unit-${escape(unit.id)}"><h3>${escape(unit.title)}${unit.archived ? ' · 已归档' : ''}</h3>
          <label class="field">标题<input id="writing-unit-${escape(unit.id)}-title" value="${escape(unit.title)}"></label>
          <label class="field">目标<textarea id="writing-unit-${escape(unit.id)}-goal">${escape(unit.goal)}</textarea></label>
          <label class="field">完成标准（每行一项）<textarea id="writing-unit-${escape(unit.id)}-criteria">${escape(unit.completionCriteria.join('\n'))}</textarea></label>
          <label class="field">排序序号<input id="writing-unit-${escape(unit.id)}-order" type="number" min="0" value="${unit.order}"></label>
          ${w.article.genre === 'longform-research-article' ? `<details><summary>章节规划与关系</summary>
            <label class="field">本节摘要/职责<textarea id="writing-unit-${escape(unit.id)}-summary">${escape(unit.summary || '')}</textarea></label>
            <label class="field">前序章节 ID（逗号分隔）<input id="writing-unit-${escape(unit.id)}-priorUnitIds" value="${escape((unit.priorUnitIds || []).join(', '))}"></label>
            <label class="field">后续章节 ID（逗号分隔）<input id="writing-unit-${escape(unit.id)}-nextUnitIds" value="${escape((unit.nextUnitIds || []).join(', '))}"></label></details>` : ''}
          ${['fiction', 'script', 'longform-general'].includes(w.article.genre) ? `<details><summary>场景与连续性关系</summary>
            <label class="field">视角<input id="writing-unit-${escape(unit.id)}-viewpoint" value="${escape(unit.viewpoint || '')}"></label>
            <label class="field">单元用户摘要<textarea id="writing-unit-${escape(unit.id)}-summary">${escape(unit.summary || '')}</textarea></label>
            <label class="field">前序单元 ID（逗号分隔）<input id="writing-unit-${escape(unit.id)}-priorUnitIds" value="${escape((unit.priorUnitIds || []).join(', '))}"></label>
            <label class="field">后续单元 ID（逗号分隔）<input id="writing-unit-${escape(unit.id)}-nextUnitIds" value="${escape((unit.nextUnitIds || []).join(', '))}"></label>
            <label class="field">故事内时间<input id="writing-unit-${escape(unit.id)}-storyTime" value="${escape(unit.storyTime || '')}"></label>
            <label class="field">地点/内外景<input id="writing-unit-${escape(unit.id)}-location" value="${escape(unit.location || '')}"></label>
            <label class="field">场景目的/冲突<textarea id="writing-unit-${escape(unit.id)}-purpose">${escape(unit.purpose || '')}</textarea></label>
            <label class="field">剧本场景格式<input id="writing-unit-${escape(unit.id)}-format" value="${escape(unit.format || '')}"></label>
            <label class="field">人物出场<textarea id="writing-unit-${escape(unit.id)}-entrances">${escape(unit.entrances || '')}</textarea></label>
            <label class="field">人物退场<textarea id="writing-unit-${escape(unit.id)}-exits">${escape(unit.exits || '')}</textarea></label>
            <label class="field">可呈现动作<textarea id="writing-unit-${escape(unit.id)}-action">${escape(unit.action || '')}</textarea></label>
            ${[['characterIds', '人物'], ['canonIds', '设定'], ['eventIds', '事件'], ['foreshadowingIds', '伏笔']].map(([key, label]) => `<label class="field">${label} ID（逗号分隔）<input id="writing-unit-${escape(unit.id)}-${key}" value="${escape((unit[key] || []).join(', '))}"></label>`).join('')}</details>` : ''}
          ${button('update-unit', '保存单元修改', `data-unit-id="${escape(unit.id)}"`, locked)}${button('archive-unit', '归档单元', `data-unit-id="${escape(unit.id)}"`, locked || unit.archived)}</div>`).join('') : '<p>尚无任务单元。</p>'}
      </section>`;
    }
    function renderIssues(w, f, locked) {
      if (!w) return '';
      const round = w.rounds.at(-1);
      const judgmentLabels = { candidate: '候选问题', 'needs-verification': '待核对疑点', preference: '个人偏好', undetermined: '无法判断' };
      const statusLabels = { pending: '未处理', 'pending-user': '待用户判断', 'resolved-awaiting-review': '已处理待复核', 'review-passed': '复核通过', deferred: '暂不处理' };
      const categories = [['source', '来源'], ['logic', '逻辑'], ['method', '方法'], ['requirement', '要求'], ['preference', '偏好'], ['other', '其他']];
      const statuses = [['pending', '未处理'], ['pending-user', '待用户判断'], ['resolved-awaiting-review', '已处理待复核'], ['review-passed', '复核通过'], ['deferred', '暂不处理']];
      const judgments = [['candidate', '候选问题'], ['needs-verification', '待核对疑点'], ['preference', '个人偏好'], ['undetermined', '无法判断']];
      return `<section class="social-panel" id="writing-issues"><h2>问题记录与跨轮复核</h2>
        <p class="social-muted">模型问题只作为候选；状态需你明确判断。新稿不会自动关闭问题，复核通过必须选择一条后续轮次。</p>
        <h3>手动新增问题</h3>${field('issue-location', '位置说明', f.issueLocation, { name: 'issueLocation' })}${field('issue-excerpt', '原文摘录', f.issueExcerpt, { name: 'issueExcerpt' })}${field('issue-observation', '可观察表现', f.issueObservation, { name: 'issueObservation' })}${field('issue-impact', '影响', f.issueImpact, { name: 'issueImpact' })}
        <div class="social-form-grid"><label class="field" for="writing-issue-evidence-category"><span class="field-label">依据类别</span><select id="writing-issue-evidence-category" data-writing-field="issueEvidenceCategory">${categories.map(([value, label]) => `<option value="${value}" ${f.issueEvidenceCategory === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field" for="writing-issue-priority"><span class="field-label">优先级</span><select id="writing-issue-priority" data-writing-field="issuePriority">${[['low', '低'], ['medium', '中'], ['high', '高']].map(([value, label]) => `<option value="${value}" ${f.issuePriority === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
        ${field('issue-evidence', '依据说明', f.issueEvidence, { name: 'issueEvidence' })}${field('issue-suggestion', '修改建议', f.issueSuggestion, { name: 'issueSuggestion' })}${button('add-issue', '新增候选问题', '', locked)}
        ${(w.issues || []).map(issue => {
          const issueRoundIndex = w.rounds.findIndex(item => item.id === issue.roundId);
          const laterRounds = w.rounds.filter((item, index) => index > issueRoundIndex);
          return `<article class="writing-issue" id="writing-issue-${escape(issue.id)}"><h3>${escape(judgmentLabels[issue.judgment] || '问题')} · ${escape(issue.excerpt)}</h3>
            <p>发现轮次：${w.rounds.findIndex(item => item.id === issue.roundId) + 1} · ${escape(issue.location || '位置未提供')} · ${escape(issue.observation)}</p>
            <p>影响：${escape(issue.impact || '未提供')} · 依据：${escape(issue.evidenceDescription || '未提供')} · 建议：${escape(issue.suggestion || '未提供')}</p>
            <div class="social-form-grid"><label class="field" for="writing-issue-${escape(issue.id)}-judgment"><span class="field-label">用户判断</span><select id="writing-issue-${escape(issue.id)}-judgment">${judgments.map(([value, label]) => `<option value="${value}" ${issue.judgment === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <label class="field" for="writing-issue-${escape(issue.id)}-status"><span class="field-label">处理状态</span><select id="writing-issue-${escape(issue.id)}-status">${statuses.map(([value, label]) => `<option value="${value}" ${issue.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
            <label class="field" for="writing-issue-${escape(issue.id)}-reason"><span class="field-label">处理理由</span><textarea id="writing-issue-${escape(issue.id)}-reason">${escape(issue.statusReason)}</textarea></label>
            <label class="field" for="writing-issue-${escape(issue.id)}-review-round"><span class="field-label">复核轮次</span><select id="writing-issue-${escape(issue.id)}-review-round"><option value="">未选择</option>${laterRounds.map(item => `<option value="${escape(item.id)}" ${issue.reviewedRoundId === item.id ? 'selected' : ''}>第${w.rounds.findIndex(candidate => candidate.id === item.id) + 1}轮</option>`).join('')}</select></label>
            ${button('update-issue', '保存判断与状态', `data-issue-id="${escape(issue.id)}"`, locked)}<p>优先级：${escape(issue.priority)} · 诊断提示词：${escape(issue.promptVersionId || '未关联')}</p></article>`;
        }).join('') || '<p>暂无问题记录。</p>'}
      </section>`;
    }
    function renderRoute(w, f, locked) {
      if (!w) return '';
      const routes = coordinator.listRoutes(w.id, f.taskType || (w.article.genre === 'academic-paper' ? 'academic-planning' : 'revision'));
      const currentRound = w.rounds.at(-1);
      const progress = w.routeProgress?.roundId === currentRound?.id ? w.routeProgress : null;
      const stage = progress?.stages?.find(item => item.id === progress.currentStageId);
      const statusLabels = { 'not-started': '待开始', 'in-progress': '进行中', 'user-confirmed-complete': '用户确认完成', skipped: '已跳过', blocked: '受阻' };
      const pendingIssues = (w.issues || []).filter(issue => !['review-passed', 'deferred'].includes(issue.status)
        && (!currentRound?.unitId || issue.unitId === currentRound.unitId))
        .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]));
      const nextStep = stage ? `<section class="writing-route-next-step" aria-label="当前下一步建议">
        <h4 id="writing-route-next-step-heading" tabindex="-1">当前建议：${escape(stage.status === 'in-progress' ? '完成当前步骤并记录结果' : stage.status === 'blocked' ? '补齐缺项后继续' : '开始当前步骤')}</h4>
        <p>依据：路线顺序、当前步骤输入与检查项；${escape(stage.checks.join('、') || '本步骤未登记检查项')}。</p>
        <p>缺口：${escape(stage.status === 'blocked' ? stage.statusReason : pendingIssues[0]?.observation || '尚无登记问题；需按检查项确认输入、结果与证据。')}</p>
        <p>优先理由：${escape(pendingIssues[0] ? `${pendingIssues[0].priority} 优先级问题仍未复核：${pendingIssues[0].observation || pendingIssues[0].excerpt || '需查看问题记录'}` : stage.status === 'blocked' ? '当前步骤受阻，先解除已记录缺项。' : '这是路线中当前首个未完成步骤。')}</p>
      </section>` : progress?.routeId ? '<p class="writing-route-next-step">当前路线步骤均已结束；这只表示路线记录完成，不代表专业结果通过。</p>' : '';
      const routeList = routes.length ? routes.map(route => `<article class="writing-route"><h3>${escape(route.title || route.routeId)}</h3>
        <p>包：${escape(route.packName)} v${route.packVersion} · 来源状态：${escape(verificationLabels[route.verificationStatus] || '未核验')}</p>
        <div><strong>路线来源</strong>${route.sources.map(source => `<p>${escape(source.title || source.id)} · ${escape(verificationLabels[source.verificationStatus] || '未核验')} · 版本 ${escape(source.version || '未提供')} · 定位 ${escape(source.url || source.locator || '未提供')} · 适用范围 ${escape(source.applicability || '未提供')} · 局限 ${escape(source.limitations || '未提供')}${source.license ? ` · 许可 ${escape(source.license)}` : ''}</p>`).join('') || '<p>未提供来源。</p>'}</div>
        <ol>${route.stages.map(item => `<li>${escape(item.title || item.id)}：输入 ${escape(item.inputs.join('、') || '未提供')}；产出 ${escape(item.outputs.join('、') || '未提供')}；检查 ${escape(item.checks.join('、') || '未提供')}；来源 ${escape(item.sourceIds.join('、') || '未提供')}（${escape(verificationLabels[item.verificationStatus] || '未核验')}）；缺项退回条件 ${escape(item.returnWhenMissing.join('、') || '未提供')}；${item.skippable ? '允许跳过' : '不可跳过'}</li>`).join('')}</ol>
        ${button('select-writing-route', '采用此路线', `data-route-id="${escape(route.routeId)}" data-pack-id="${escape(route.packId)}"`, locked)}</article>`).join('') : '<p>当前选用的基础包没有适用路线，可直接按提示词推进。</p>';
      const current = progress?.routeId ? `<article class="writing-route-progress"><h3>当前路线：${escape(progress.title || progress.routeId)}</h3>
        <p>包 ${escape(progress.packName)} v${progress.packVersion} · 来源状态：${escape(verificationLabels[progress.verificationStatus] || '未核验')} · 用户确认完成不代表专业认证。</p>
        ${nextStep}
        ${progress.stages.map(item => `<div class="writing-route-stage"><h4>${escape(item.title || item.id)} · ${escape(statusLabels[item.status] || item.status)}</h4>
          <p>输入：${escape(item.inputs.join('、') || '未提供')} · 产出：${escape(item.outputs.join('、') || '未提供')} · 检查：${escape(item.checks.join('、') || '未提供')}</p>
          <p>来源：${escape(item.sourceIds.join('、') || '未提供')} · 核验：${escape(verificationLabels[item.verificationStatus] || '未核验')}${item.statusReason ? ` · 受阻说明：${escape(item.statusReason)}` : ''}</p>
          ${item.id === progress.currentStageId ? `<div class="social-tools">${['not-started', 'blocked', 'user-confirmed-complete'].includes(item.status) ? button('route-start', '开始或重新开始此步骤', `id="writing-route-start-${escape(item.id)}" data-stage-id="${escape(item.id)}"`, locked) : ''}
            ${item.skippable && item.status !== 'user-confirmed-complete' ? button('route-skip', '跳过此步骤', `data-stage-id="${escape(item.id)}"`, locked) : ''}</div>
            ${item.status === 'in-progress' ? `${field('route-result', '步骤结果', f.routeResult, { name: 'routeResult' })}${field('route-evidence', '完成证据或定位', f.routeEvidence, { name: 'routeEvidence' })}<div class="social-tools">${button('route-complete', '确认完成', `id="writing-route-complete-${escape(item.id)}" data-stage-id="${escape(item.id)}"`, locked)}</div>` : ''}
            ${item.returnWhenMissing.length ? `${field('route-block-reason', '缺少什么', f.routeBlockReason, { name: 'routeBlockReason' })}<label class="field" for="writing-route-return"><span class="field-label">退回步骤（可选）</span><select id="writing-route-return" data-writing-field="routeReturnToStageId"><option value="">不退回，暂时受阻</option>${progress.stages.filter((candidate, index) => index < progress.stages.findIndex(item => item.id === stage?.id)).map(candidate => `<option value="${escape(candidate.id)}" ${f.routeReturnToStageId === candidate.id ? 'selected' : ''}>${escape(candidate.title || candidate.id)}</option>`).join('')}</select></label>${button('route-block', '标记受阻', `data-stage-id="${escape(item.id)}"`, locked)}` : ''}` : ''}
        </div>`).join('')}</article>` : '';
      return `<section class="social-panel" id="writing-route-workflow"><h2>专业路线</h2><p class="social-muted">路线仅来自当前已选且适用的基础包；来源核验状态保持原样。</p>${routeList}${current}</section>`;
    }
    function renderNotifications(f) {
      return f.notifications.map(n => `<p role="status">${escape(n.message)}${button('undo-memory', '撤销新增记忆', `data-memory-id="${escape(n.memoryId)}"`)}</p>`).join('');
    }
    function renderMemories(w) {
      const relevant = coordinator.getRelevantMemories(w ? w.genre : 'article', w?.id);
      const all = (state().writingMemories || []).filter(m => !m.undo?.undoneAt);
      return `<section class="social-panel"><h2>当前相关记忆（最多3条）</h2>${relevant.map(m => `<p>${escape(m.preference)} · ${escape(scopeLabels[m.scope])}${m.example ? `<br>例句：${escape(m.example)}` : ''}${m.counterexample ? `<br>反例：${escape(m.counterexample)}` : ''}</p>`).join('') || '<p>暂无相关记忆。</p>'}
        ${managerOpen ? `<h3>全部有效记忆（${all.length}）</h3>${all.map(m => {
          if (!memoryDrafts.has(m.id)) memoryDrafts.set(m.id, clone(m));
          const edit = memoryDrafts.get(m.id);
          return `<div class="writing-memory"><p>范围：${escape(scopeLabels[m.scope])} · 来源文章：${escape(m.sourceArticleId)} · 更新时间：${escape(m.updatedAt)}</p>${['preference', 'example', 'counterexample'].map((key, i) => `<label class="field">${['偏好', '例句', '反例'][i]}<textarea id="writing-memory-${escape(m.id)}-${key}" data-memory-id="${escape(m.id)}" data-memory-field="${key}">${escape(edit[key] || '')}</textarea></label>`).join('')}${button('edit-memory', '保存记忆修改', `data-memory-id="${escape(m.id)}"`)}${button('delete-memory', '删除记忆', `data-memory-id="${escape(m.id)}"`)}</div>`;
        }).join('')}` : ''}</section>`;
    }
    function capture(target) {
      const f = form();
      const d = target.dataset || {};
      if (d.writingField && !target.readOnly) {
        f[d.writingField] = target.value;
        if (d.writingField === 'draft' && target.value.trim() && f.wizardSourceDocument) {
          sourceImportJob?.controller.abort(); sourceImportJob = null;
          f.wizardSourceDocument = null; f.wizardSourceError = '';
        }
        if (d.writingField === 'wizardSourceScope' && f.wizardSourceDocument) {
          f.wizardSourceDocument.processingScope = target.value === 'sections' ? 'sections' : 'whole';
        }
        if (d.writingField === 'wizardSourceManualRange' && f.wizardSourceDocument) {
          f.wizardSourceDocument.manualSectionRange = target.value;
        }
        if (d.writingField === 'wizardMode') { f.wizardSuggestion = null; f.wizardError = ''; }
        if (d.writingField === 'prompt' && f.wizardUsedPrompt && target.value !== f.wizardUsedPrompt) f.wizardPromptEdited = true;
        if (d.writingField === 'wizardGenre') { f.wizardManualGenre = target.value; f.wizardTaskType = ''; }
        if (d.writingField === 'genre' && !articleId) {
          const selectedGenre = genreId(target.value);
          f.taskType = selectedGenre === 'academic-paper' ? 'academic-planning'
            : selectedGenre === 'article' ? 'revision' : schema.getWritingGenreConfig(selectedGenre)?.taskTypes?.[0] || 'revision';
        }
        f.dirty = [...new Set([...f.dirty, d.writingField])];
      }
      if (d.writingDomainField) {
        f.domainInputs = { ...(f.domainInputs || {}), [d.writingDomainField]: target.value };
        f.dirty = [...new Set([...f.dirty, 'domainInputs'])];
      }
      if (Object.hasOwn(d, 'academicRequirementIndex') && d.academicRequirementField) {
        const requirement = f.academicRequirements[Number(d.academicRequirementIndex)];
        if (requirement) requirement[d.academicRequirementField] = target.value;
        f.dirty = [...new Set([...f.dirty, 'academicRequirements'])];
      }
      if (d.writingDimension) { f.dimensions = target.checked ? [...new Set([...f.dimensions, d.writingDimension])] : f.dimensions.filter(v => v !== d.writingDimension); f.dirty = [...new Set([...f.dirty, 'dimensions'])]; }
      if (d.writingPackSelection) {
        f.packSelections = target.checked ? [...new Set([...f.packSelections, d.writingPackSelection])]
          : f.packSelections.filter(id => id !== d.writingPackSelection);
        f.dirty = [...new Set([...f.dirty, 'packSelections'])];
      }
      if (d.writingForkContext) {
        f.forkContexts = target.checked
          ? [...new Set([...f.forkContexts, d.writingForkContext])]
          : f.forkContexts.filter(context => context !== d.writingForkContext);
      }
      if (d.materialField && f.materials[Number(d.materialIndex)]) {
        const material = f.materials[Number(d.materialIndex)];
        if (d.materialField === 'url') webReadResults.delete(material.id);
        material[d.materialField] = d.materialField === 'selectedForPrompt' ? target.checked : target.value;
        if (d.materialField === 'excerpt' && material.kind === 'material') {
          material.sourceType ||= 'pasted-text';
          material.origin ||= 'user-pasted';
          material.contentStatus = target.value.trim() ? 'embedded' : 'reference-only';
        }
        f.dirty = [...new Set([...f.dirty, 'materials'])];
      }
      if (Object.hasOwn(d, 'materialUnitId') && f.materials[Number(d.materialIndex)]) {
        const material = f.materials[Number(d.materialIndex)];
        const unitIds = new Set(material.unitIds || []);
        if (!d.materialUnitId || target.checked) {
          if (!d.materialUnitId) unitIds.clear();
          else unitIds.add(d.materialUnitId);
        } else unitIds.delete(d.materialUnitId);
        material.unitIds = [...unitIds];
        f.dirty = [...new Set([...f.dirty, 'materials'])];
      }
      if (d.memoryField) { const m = memoryDrafts.get(d.memoryId); if (m) m[d.memoryField] = target.value; }
    }
    function addMaterialLink() {
      const f = form();
      if (f.materials.length >= 3) { f.error = '本轮最多添加3份材料'; render(); return; }
      let url;
      try { url = new URL(f.linkUrl.trim()); } catch { url = null; }
      if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        f.error = '仅支持公开的 HTTP 或 HTTPS 链接，不接受本地路径或含账号密码的链接'; render(); return;
      }
      f.materials.push({ id: newMaterialId(), title: f.linkTitle.trim() || url.hostname, url: url.href, excerpt: '',
        purpose: 'content', verificationStatus: 'unverified', sourceType: 'link', origin: 'link', contentStatus: 'reference-only', attachmentRequired: true, kind: 'source' });
      f.linkTitle = ''; f.linkUrl = ''; f.error = ''; f.dirty = [...new Set([...f.dirty, 'materials'])]; render();
    }
    async function readWebMaterial(index) {
      if (processingMaterials) return;
      const f = form();
      const material = f.materials[Number(index)];
      if (!material || material.sourceType !== 'link') return;
      if (!confirm(`将向该网站发送读取请求，并暴露你的网络地址。链接中的查询参数也会发送给网站。是否继续？\n${material.url}`)) return;
      const job = { articleId, materialId: material.id, controller: new AbortController() };
      activeMaterialJob = job;
      processingMaterials = true;
      webReadResults.delete(material.id);
      render();
      try {
        const response = await fetchImpl('/api/writing-materials/read-webpage', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: material.url }), signal: job.controller.signal
        });
        const result = await response.json();
        if (activeMaterialJob !== job || job.controller.signal.aborted || articleId !== job.articleId) return;
        if (!response.ok) throw new Error(result.message || '网页读取失败。');
        webReadResults.set(material.id, { ...result, ok: true });
        f.error = '';
      } catch (error) {
        if (activeMaterialJob !== job || job.controller.signal.aborted || articleId !== job.articleId) return;
        webReadResults.set(material.id, { ok: false, error: String(error.message || '网页读取失败。').slice(0, 240) });
        f.error = '网页读取失败；链接卡片仍保留，可粘贴需要使用的摘录。';
      } finally {
        if (activeMaterialJob === job) {
          activeMaterialJob = null;
          processingMaterials = false;
          render();
        }
      }
    }
    function fileMimeType(file, extension) {
      const allowed = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
      const expected = allowed[extension];
      return expected && (!file.type || file.type === expected) ? expected : '';
    }
    function encodeBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      return (root?.btoa || globalThis.btoa)(binary);
    }
    async function importMaterialFiles(files) {
      if (processingMaterials) return;
      const f = form();
      const job = { articleId, controller: new AbortController() };
      activeMaterialJob = job;
      processingMaterials = true;
      render();
      try {
        for (const file of Array.from(files || [])) {
          if (f.materials.length >= (articleId ? 3 : 10000)) { f.error = articleId ? '本轮最多添加3份材料，剩余文件未添加' : '参考文件最多索引10,000份，剩余文件未添加'; break; }
          const relativePath = String(file?.webkitRelativePath || '').replace(/\\/g, '/').slice(0, 500);
          const name = (relativePath || String(file?.name || '未命名文件')).slice(0, 160);
          const fingerprint = `${Number(file?.size) || 0}:${(Number(file?.lastModified) || 0).toString(16).slice(0, 8) || '0'}`;
          if (!articleId && f.materials.some(item => (item.relativePath || item.title) === (relativePath || name) && item.fingerprint === fingerprint)) continue;
          const extension = name.includes('.') ? name.split('.').at(-1).toLowerCase() : '';
          if (['txt', 'md', 'csv', 'json'].includes(extension)) {
            if (Number(file.size) > 2 * 1024 * 1024) {
              const message = `${name} 超过2MB，未读取`;
              f.materials.push({ id: newMaterialId(), title: name, relativePath, fingerprint, purpose: 'content', excerpt: '', sourceType: 'unread-file-reference', origin: 'file-import',
                contentStatus: 'failed', contentError: message, originalLength: Number(file.size), attachmentRequired: true, kind: 'material' });
              f.error = message;
              continue;
            }
            try {
              if (typeof file.text !== 'function') throw new Error('当前环境无法读取此文件');
              const content = await file.text();
              if (typeof content !== 'string') throw new Error('文件没有可读取的文本');
              f.materials.push({ id: newMaterialId(), relativePath, fingerprint,
                title: name, purpose: 'content', excerpt: content.slice(0, 1200), sourceType: 'text-file', origin: 'file-import',
                contentStatus: content.length > 1200 ? 'truncated' : 'embedded', originalLength: content.length,
                attachmentRequired: content.length > 1200, kind: 'material' });
            } catch (error) {
              const message = String(error.message || error);
              f.materials.push({ id: newMaterialId(), title: name, relativePath, fingerprint, purpose: 'content', excerpt: '', sourceType: 'unread-file-reference', origin: 'file-import',
                contentStatus: 'failed', contentError: message, originalLength: 0, attachmentRequired: true, kind: 'material' });
              f.error = `${name} 读取失败，只保留了文件名引用：${message}`;
            }
          } else if (['pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
            const material = { id: newMaterialId(), title: name, relativePath, fingerprint, purpose: 'content', excerpt: '', sourceType: 'unread-file-reference', origin: 'file-import',
              contentStatus: 'reference-only', originalLength: 0, attachmentRequired: true, kind: 'material' };
            f.materials.push(material);
            try {
              const mimeType = fileMimeType(file, extension);
              if (!mimeType) throw new Error('文件类型与扩展名不匹配');
              if (Number(file.size) > 20 * 1024 * 1024) throw new Error('文件超过20MB本机解析上限');
              if (typeof file.arrayBuffer !== 'function' || typeof fetchImpl !== 'function') throw new Error('当前环境不支持本机文件解析');
              const buffer = await file.arrayBuffer();
              if (activeMaterialJob !== job || job.controller.signal.aborted) throw new Error('解析已取消');
              const response = await fetchImpl('/api/writing-materials/parse', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ fileName: name, mimeType, dataBase64: encodeBase64(buffer) }), signal: job.controller.signal });
              const result = await response.json();
              if (activeMaterialJob !== job || job.controller.signal.aborted) return;
              if (!response.ok) throw new Error(result.message || '本机解析失败');
              material.contentStatus = result.status === 'empty' ? 'reference-only' : 'parsed';
              material.sourceType = extension === 'pdf' ? 'pdf' : extension === 'docx' ? 'docx' : 'image';
              material.originalLength = Number(result.extractedCharacters) || 0;
              material.extractedCharacterCount = Number(result.extractedCharacters) || 0;
              material.extractionMethod = result.method === 'pdf-text' ? 'pdf-text' : result.method === 'pdf-ocr' ? 'pdf-ocr' : result.method === 'docx-text' ? 'docx-text' : 'image-ocr';
              material.pageCount = Number(result.pageCount) || 0;
              if (Number.isFinite(result.recognitionConfidence)) material.recognitionConfidence = result.recognitionConfidence;
              material.parseWarnings = Array.isArray(result.warnings) ? result.warnings.slice(0, 4).map(item => String(item).slice(0, 180)) : [];
              material.parsedSegments = Array.isArray(result.segments) ? result.segments.slice(0, 100).map(segment => ({ locator: String(segment.locator || '').slice(0, 120), text: String(segment.text || '').slice(0, 4000) })) : [];
              if (!material.parsedSegments.length) material.contentError = '未提取到可选文字；可粘贴所需摘录并保留原附件引用。';
            } catch (error) {
              if (activeMaterialJob !== job || job.controller.signal.aborted) return;
              material.contentStatus = 'failed';
              material.contentError = String(error.message || error).slice(0, 300);
              f.error = `${name} 本机解析失败；已保留材料卡片和原附件引用。${material.contentError}`;
            }
          } else {
            const message = `${name} 格式暂不支持`;
            f.materials.push({ id: newMaterialId(), title: name, relativePath, fingerprint, purpose: 'content', excerpt: '', sourceType: 'unread-file-reference', origin: 'file-import',
              contentStatus: 'unsupported', contentError: message, originalLength: 0, attachmentRequired: true, kind: 'material' });
            f.error = message;
          }
        }
      } finally {
        if (activeMaterialJob === job) {
          activeMaterialJob = null;
          processingMaterials = false;
          f.dirty = [...new Set([...f.dirty, 'materials'])];
          if (!articleId && !f.wizardMaterialIds.length) f.wizardMaterialIds = (prompts?.recommendMaterials?.(f.materials, { goal: f.goal }, f.taskType) || []).map(item => item.id).slice(0, 3);
          if (!articleId && f.wizardWorkspaceId) {
            const saved = (state().writingWorkspaces || []).find(item => item.id === f.wizardWorkspaceId);
            const folder = f.materials.filter(item => item.relativePath);
            const root = folder[0]?.relativePath?.split('/')[0] || '';
            const matches = saved && saved.rootLabel === root && saved.selectedPaths.length > 0
              && saved.selectedPaths.every(path => folder.some(item => item.relativePath === path.path && item.fingerprint === path.fingerprint));
            if (matches) f.wizardMaterialIds = saved.selectedPaths.map(path => f.materials.find(item => item.relativePath === path.path)?.id).filter(Boolean).slice(0, 3);
            else if (folder.length) f.error = '所选文件夹或文件版本与已保存工作空间不匹配；未恢复历史勾选。可继续作为临时文件夹使用。';
          }
          render();
        }
      }
    }
    async function indexReferenceFolder(files) {
      const fileList = Array.from(files || []);
      if (!fileList.length) return;
      if (typeof browserIndex?.indexBrowserProjectFiles !== 'function') {
        form().error = '本机目录索引不可用；请改用“选择文件”添加参考材料。'; render(); return;
      }
      const f = form();
      const sourceId = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const rootLabel = String(fileList[0]?.webkitRelativePath || fileList[0]?.name || '').split(/[\\/]/)[0].slice(0, 120);
      const job = { articleId, controller: new AbortController() };
      activeMaterialJob?.controller.abort();
      activeMaterialJob = job; processingMaterials = true; render();
      try {
        const result = await browserIndex.indexBrowserProjectFiles(fileList, { signal: job.controller.signal });
        if (activeMaterialJob !== job || job.controller.signal.aborted) return;
        projectSources.set(sourceId, { sourceId, rootLabel, files: fileList, result });
        for (const item of result.files) {
          const existing = f.materials.find(candidate => (candidate.relativePath || candidate.title) === item.relativePath);
          if (existing) {
            existing.projectSourceIds = [...new Set([...(existing.projectSourceIds || [existing.projectSourceId].filter(Boolean)), sourceId])];
            continue;
          }
          f.materials.push({ id: `project:${item.relativePath}`, projectSourceId: sourceId,
            projectSourceIds: [sourceId],
            title: item.title, relativePath: item.relativePath, fingerprint: item.fingerprint,
            purpose: 'content', excerpt: item.excerpt, sourceType: 'text-file', origin: 'authorized-directory',
            contentStatus: 'embedded', originalLength: item.excerpt.length, attachmentRequired: true, kind: 'material' });
        }
        const filtered = result.filteredCandidates.map(item => ({ ...item, projectSourceId: sourceId }));
        f.wizardFilteredCandidates = [...(f.wizardFilteredCandidates || []), ...filtered]
          .filter((item, index, list) => list.findIndex(other => other.relativePath === item.relativePath) === index);
        f.wizardInventoryComplete = result.inventoryComplete && [...projectSources.values()].every(source => source.result.inventoryComplete);
        if (!f.wizardMaterialIds.length) {
          f.wizardMaterialIds = (prompts?.recommendMaterials?.(f.materials, { goal: f.goal }, f.taskType) || []).map(item => item.id).slice(0, 3);
        }
        const matchedWorkspace = (state().writingWorkspaces || []).find(item => item.id === f.wizardWorkspaceId);
        const folderMatches = matchedWorkspace && matchedWorkspace.rootLabel === rootLabel
          && matchedWorkspace.selectedPaths.every(saved => result.files.some(item => item.relativePath === saved.path && item.fingerprint === saved.fingerprint));
        if (folderMatches) f.wizardMaterialIds = matchedWorkspace.selectedPaths
          .map(saved => f.materials.find(item => item.relativePath === saved.path)?.id).filter(Boolean).slice(0, 3);
        else if (matchedWorkspace) f.error = '所选文件夹与常用工作空间不匹配；未恢复历史勾选。请核对目录后继续。';
        if (!result.inventoryComplete) f.error = '文件夹超过 10,000 项扫描上限；其余文件未扫描。';
      } catch (error) {
        if (error?.name !== 'AbortError') f.error = String(error.message || '文件夹索引失败').slice(0, 300);
      } finally {
        if (activeMaterialJob === job) { activeMaterialJob = null; processingMaterials = false; render(); }
      }
    }
    async function importWritingSourceFile(file) {
      if (!file) return;
      sourceImportJob?.controller.abort();
      const job = { file, controller: new AbortController() };
      sourceImportJob = job;
      const f = form();
      const name = String(file.name || '未命名原文').split(/[\\/]/).at(-1).slice(0, 160);
      const extension = name.includes('.') ? name.split('.').at(-1).toLowerCase() : '';
      const fingerprint = `${Number(file.size) || 0}:${(Number(file.lastModified) || 0).toString(16).slice(0, 8) || '0'}`;
      f.wizardSourceBusy = true;
      f.wizardSourceError = '';
      f.wizardSourceDocument = { name, format: extension, fingerprint, parseStatus: 'partial',
        extractedCharacterCount: 0, pageCount: 0, preview: '', outline: [], selectedSectionIds: [],
        manualSectionRange: '', processingScope: 'whole', attachmentRequired: true };
      f.draft = '';
      render();
      try {
        if (!['txt', 'md', 'docx', 'pdf'].includes(extension)) throw new Error('仅支持 TXT、MD、DOCX、PDF 原文文件');
        let extractedText = '';
        let segments = [];
        let truncated = false;
        let pageCount = 0;
        let extractedCharacterCount = 0;
        if (extension === 'txt' || extension === 'md') {
          if (Number(file.size) > 30 * 1024 * 1024) throw new Error('文本文件超过 30 MB，暂不导入');
          const raw = await file.text();
          extractedText = raw.slice(0, 30000);
          extractedCharacterCount = raw.length;
          truncated = raw.length > 30000;
        } else {
          if (Number(file.size) > 20 * 1024 * 1024) throw new Error('DOCX/PDF 文件超过 20 MB 本机解析上限');
          if (typeof file.arrayBuffer !== 'function' || typeof fetchImpl !== 'function') throw new Error('当前环境不支持本机文件解析');
          const mimeType = fileMimeType(file, extension);
          if (!mimeType) throw new Error('文件类型与扩展名不匹配');
          const buffer = await file.arrayBuffer();
          if (sourceImportJob !== job || job.controller.signal.aborted) return;
          const response = await fetchImpl('/api/writing-materials/parse', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fileName: name, mimeType, dataBase64: encodeBase64(buffer) }), signal: job.controller.signal });
          const result = await response.json();
          if (!response.ok) throw new Error(result.message || '原文解析失败');
          segments = Array.isArray(result.segments) ? result.segments.slice(0, 200).map(item => ({
            locator: String(item.locator || '').slice(0, 120), text: String(item.text || '').slice(0, 30000),
            ...(Number.isInteger(item.headingLevel) ? { headingLevel: item.headingLevel } : {})
          })) : [];
          extractedText = segments.map(item => item.text).join('\n').slice(0, 30000);
          extractedCharacterCount = Number(result.extractedCharacters) || extractedText.length;
          pageCount = Math.max(0, Math.min(100, Number(result.pageCount) || 0));
          truncated = result.truncated === true;
          if (result.method === 'pdf-ocr') f.wizardSourceError = 'PDF 使用了 OCR，识别结果请人工核对。';
        }
        if (sourceImportJob !== job || job.controller.signal.aborted) return;
        const extracted = outlineApi?.extractWritingOutline?.({ format: extension, text: extractedText, segments, truncated });
        const outline = extracted?.items || [];
        f.wizardSourceDocument = { name, format: extension, fingerprint,
          parseStatus: truncated ? 'truncated' : extractedText ? extracted?.complete === false ? 'partial' : 'parsed' : 'empty',
          extractedCharacterCount: Math.min(30000, extractedCharacterCount), pageCount,
          preview: extractedText.slice(0, 8000), outline,
          selectedSectionIds: [], manualSectionRange: '', processingScope: 'whole', attachmentRequired: true };
      } catch (error) {
        if (sourceImportJob !== job || job.controller.signal.aborted) return;
        f.wizardSourceDocument = { ...f.wizardSourceDocument, parseStatus: 'failed' };
        f.wizardSourceError = String(error.message || '原文导入失败').slice(0, 300);
      } finally {
        if (sourceImportJob === job) {
          sourceImportJob = null;
          f.wizardSourceBusy = false;
          render();
        }
      }
    }
    async function operate(action, data = {}) {
      if (action === 'new') { activeMaterialJob?.controller.abort(); sourceImportJob?.controller.abort(); webReadResults.clear(); if (articleId) coordinator.cancelResearch(articleId); articleId = ''; const fresh = form(); fresh.wizardStage = 1; fresh.wizardMode = 'new'; fresh.wizardSuggestion = null; fresh.wizardError = ''; fresh.wizardSourceDocument = null; fresh.draft = ''; render(); return; }
      if (action === 'wizard-clear-material-search') { form().wizardMaterialSearch = ''; render(); document.getElementById('writing-wizard-material-search')?.focus?.(); return; }
      if (action === 'wizard-candidate-page') { candidatePage = Math.max(1, Number(data.page) || 1); render(); return; }
      if (action === 'wizard-filtered-toggle') { const f = form(); f.wizardShowFiltered = !f.wizardShowFiltered; render(); return; }
      if (action === 'wizard-restore-filtered') {
        const f = form();
        const source = projectSources.get(data.projectSource);
        if (!source || typeof browserIndex?.restoreBrowserProjectCandidate !== 'function') {
          f.error = '原文件列表已不可用，请重新选择文件夹后恢复。'; render(); return;
        }
        const job = { articleId, controller: new AbortController() };
        activeMaterialJob?.controller.abort(); activeMaterialJob = job; processingMaterials = true; render();
        try {
          const { file: item } = await browserIndex.restoreBrowserProjectCandidate(source.files, data.relativePath, { signal: job.controller.signal });
          if (activeMaterialJob !== job || job.controller.signal.aborted) return;
          const existing = f.materials.find(candidate => candidate.relativePath === item.relativePath);
          if (existing) existing.projectSourceIds = [...new Set([...(existing.projectSourceIds || [existing.projectSourceId].filter(Boolean)), source.sourceId])];
          else f.materials.push({
            id: `project:${item.relativePath}`, projectSourceId: source.sourceId, projectSourceIds: [source.sourceId], title: item.title,
            relativePath: item.relativePath, fingerprint: item.fingerprint, purpose: 'content', excerpt: item.excerpt,
            sourceType: 'text-file', origin: 'authorized-directory', contentStatus: 'embedded',
            originalLength: item.excerpt.length, attachmentRequired: true, kind: 'material'
          });
          f.wizardFilteredCandidates = f.wizardFilteredCandidates.filter(candidate => candidate.relativePath !== item.relativePath);
          f.error = '';
        } catch (error) { f.error = `恢复失败：${String(error.message || error).slice(0, 240)}`; }
        finally { if (activeMaterialJob === job) { activeMaterialJob = null; processingMaterials = false; render(); } }
        return;
      }
      if (action === 'wizard-remove-project-source') {
        const f = form();
        projectSources.delete(data.projectSource);
        for (const item of f.materials) {
          item.projectSourceIds = (item.projectSourceIds || [item.projectSourceId].filter(Boolean)).filter(id => id !== data.projectSource);
          if (item.projectSourceId === data.projectSource) {
            item.projectSourceId = item.projectSourceIds[0] || '';
            const replacement = projectSources.get(item.projectSourceId)?.result.files.find(candidate => candidate.relativePath === item.relativePath);
            if (replacement) {
              item.title = replacement.title;
              item.fingerprint = replacement.fingerprint;
              item.excerpt = replacement.excerpt;
              item.originalLength = replacement.excerpt.length;
            }
          }
        }
        const removedIds = new Set(f.materials.filter(item => item.id.startsWith('project:') && !item.projectSourceIds.length).map(item => item.id));
        f.materials = f.materials.filter(item => !item.id.startsWith('project:') || item.projectSourceIds.length);
        f.wizardMaterialIds = f.wizardMaterialIds.filter(id => !removedIds.has(id));
        f.wizardFilteredCandidates = f.wizardFilteredCandidates.filter(item => item.projectSourceId !== data.projectSource);
        f.wizardInventoryComplete = [...projectSources.values()].every(source => source.result.inventoryComplete);
        render(); return;
      }
      if (action === 'import-source-file') { document.getElementById('writing-source-file')?.click?.(); return; }
      if (action === 'remove-source-file') {
        sourceImportJob?.controller.abort(); sourceImportJob = null;
        const f = form(); f.wizardSourceDocument = null; f.wizardSourceError = ''; f.wizardSourceBusy = false; render(); return;
      }
      if (action === 'wizard-new-plan') { navigate?.('home'); return; }
      if (action === 'wizard-stage') { const requested = Number(data.stage); if (requested < (form().wizardStage || 1)) { form().wizardStage = requested; render(); } return; }
      if (action === 'wizard-back') { form().wizardStage = 1; render(); return; }
      if (action === 'wizard-import-files') { document.getElementById('writing-material-files')?.click?.(); return; }
      if (action === 'wizard-import-folder') { document.getElementById('writing-material-folder')?.click?.(); return; }
      if (action === 'wizard-remove-material') { const f = form(); const [removed] = f.materials.splice(Number(data.index), 1); f.wizardMaterialIds = f.wizardMaterialIds.filter(id => id !== removed?.id); render(); return; }
      if (action === 'wizard-save-workspace') {
        const f = form();
        try {
          const selected = f.materials.filter(item => f.wizardMaterialIds.includes(item.id) && item.relativePath);
          const firstPath = selected[0]?.relativePath || '';
          const record = schema.normalizeWritingWorkspaceRecord({ id: `writing-workspace-${Date.now()}`, name: f.wizardWorkspaceName,
            rootLabel: firstPath.includes('/') ? firstPath.split('/')[0] : firstPath,
            sourceKind: 'browser-directory',
            selectedPaths: selected.map(item => ({ path: item.relativePath, fingerprint: item.fingerprint || '' })), createdAt: new Date().toISOString() });
          if (!record.id || !record.name || !selected.length) throw new Error('请填写名称，并先选中至少一份文件夹材料');
          if (typeof persistState !== 'function') throw new Error('当前页面无法保存工作空间');
          persistState({ ...state(), writingWorkspaces: [record, ...(state().writingWorkspaces || []).filter(item => item.name !== record.name)].slice(0, 20) });
          f.wizardWorkspaceId = record.id; f.promptNotice = '已保存；下次使用时需重新选择文件夹并核对文件版本。';
        } catch (error) { f.error = error.message || '保存工作空间失败'; }
        render(); return;
      }
      if (action === 'wizard-analyze') {
        const f = form(); f.wizardError = ''; f.error = '';
        if (!f.goal.trim() || f.wizardMode === 'rewrite' && !f.draft.trim() && !f.wizardSourceDocument) {
          f.error = f.wizardMode === 'rewrite' ? '请先提供待改原文和改写目标' : '请先描述写作目标'; render(); return;
        }
        if (f.wizardMaterialIds.length > 3) { f.error = '直接参考材料最多3份，请取消多余选择'; render(); return; }
        busy.add(''); render();
        try {
          const confirmed = f.materials.filter(item => f.wizardMaterialIds.includes(item.id) && item.excerpt && !['failed','unsupported'].includes(item.contentStatus));
          f.wizardSuggestion = await coordinator.analyzeTask({ goal: f.goal, draft: f.wizardMode === 'rewrite' && !f.wizardSourceDocument ? f.draft : '',
            sourceDocument: f.wizardMode === 'rewrite' ? f.wizardSourceDocument : null, materials: confirmed });
          f.wizardManualGenre = f.wizardSuggestion.genre; f.wizardTaskType = f.wizardSuggestion.taskType; f.wizardStage = 2;
        } catch (error) { f.wizardError = error.message || '任务分析不可用'; f.wizardStage = 2; }
        finally { busy.delete(''); render(); }
        return;
      }
      if (action === 'wizard-confirm') {
        const f = form();
        try {
          const manuallyEditedPrompt = f.wizardPromptEdited ? f.prompt : '';
          const genre = genreId(f.wizardManualGenre || f.wizardSuggestion?.genre) || 'article';
          f.genre = schema.getWritingGenreConfig(genre).name;
          f.taskType = f.wizardTaskType || f.wizardSuggestion?.taskType || (genre === 'article' ? 'revision' : schema.getWritingGenreConfig(genre).taskTypes[0]);
          f.materials = f.materials.filter(item => f.wizardMaterialIds.includes(item.id)).slice(0, 3);
          const input = { ...articlePatch(f), draft: f.wizardMode === 'rewrite' && !f.wizardSourceDocument ? f.draft : '',
            sourceDocument: f.wizardMode === 'rewrite' ? f.wizardSourceDocument : undefined,
            materials: f.materials.filter(m => m.kind !== 'source'), sources: f.materials.filter(m => m.kind === 'source'), taskType: f.taskType, packSelections: f.packSelections };
          let created;
          if (articleId) {
            const existing = coordinator.getWorkspace(articleId);
            await coordinator.updateArticle(articleId, articlePatch(f));
            const latest = coordinator.getWorkspace(articleId).rounds.at(-1);
            const referenceKey = items => JSON.stringify(items.map(item => [item.title, item.excerpt, item.purpose]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
            const referencesChanged = referenceKey(references(latest)) !== referenceKey(f.materials);
            const targetChanged = Object.entries(articlePatch(f)).some(([key, value]) => {
              const previous = existing.article[key] === undefined
                ? Array.isArray(value) ? [] : value && typeof value === 'object' ? {} : ''
                : existing.article[key];
              return JSON.stringify(previous) !== JSON.stringify(value);
            });
            const sourceChanged = JSON.stringify(latest.sourceDocument || null) !== JSON.stringify(input.sourceDocument || null);
            if (latest.draft !== input.draft || referencesChanged || targetChanged || sourceChanged || latest.taskType !== f.taskType) await coordinator.appendRound(articleId, input);
            created = coordinator.getWorkspace(articleId);
          } else {
            created = await coordinator.createArticle(input);
            articleId = created.id;
          }
          drafts.set(articleId, f);
          const generatedPrompt = created.rounds.at(-1)?.prompt || '';
          f.prompt = manuallyEditedPrompt || generatedPrompt;
          if (manuallyEditedPrompt && f.prompt !== generatedPrompt) await coordinator.recordPromptVersion(articleId, created.rounds.at(-1).id, f.prompt);
          f.wizardStage = 3; f.wizardUsedPrompt = f.prompt; f.wizardPromptEdited = Boolean(manuallyEditedPrompt);
          f.promptNotice = manuallyEditedPrompt ? '已保留你手动编辑的提示词并记录为版本；请核对它是否仍适用于更新后的任务方向。' : '';
        } catch (error) { f.error = error.message || '创建任务失败'; }
        render(); return;
      }
      if (action === 'wizard-used') { form().wizardStage = 4; render(); return; }
      if (action === 'wizard-check') {
        const f = form(); f.error = '';
        try {
          const latest = coordinator.getWorkspace(articleId).rounds.at(-1);
          if (latest.draft !== f.newDraft) await coordinator.appendRound(articleId, { draft: f.newDraft, feedback: f.feedback, taskType: f.taskType, packSelections: f.packSelections });
          const result = await coordinator.runModelDiagnosis(articleId); f.diagnosis = result.diagnosis; f.prompt = result.prompt;
        }
        catch (error) { f.error = error.message || '检查失败'; }
        render(); return;
      }
      if (action === 'wizard-next') {
        const f = form();
        try {
          const w = coordinator.getWorkspace(articleId);
          const latest = w.rounds.at(-1);
          const selectedIssues = (w.issues || []).filter(issue => f.wizardIssueIds.includes(issue.id) && issue.roundId === latest.id);
          const issueFocus = selectedIssues.length
            ? `\n\n用户确认优先处理以下问题：\n${selectedIssues.map(issue => `- ${issue.observation || issue.excerpt || issue.suggestion}`).join('\n')}\n只针对这些问题提出修改要求；保留其他已确认内容。`
            : '';
          f.prompt = `${latest.prompt}${issueFocus}`;
          await coordinator.recordPromptVersion(articleId, latest.id, f.prompt, { source: 'user-confirmed-revision-focus' });
          f.wizardStage = 3; f.newDraft = ''; f.feedback = ''; f.wizardUsedPrompt = f.prompt; f.wizardPromptEdited = false;
        }
        catch (error) { f.error = error.message || '生成下一轮提示词失败'; }
        render(); return;
      }
      if (action === 'wizard-finish') { form().wizardStage = 3; render(); return; }
      if (action?.startsWith('coverage-')) {
        const id = articleId;
        const f = form(id);
        try {
          if (action === 'coverage-preview-library') {
            const entries = (state().knowledgeEntries || []).filter(item => !item.hiddenAt);
            const items = entries.map(entry => {
              const excerpt = String(entry.contentExcerpt || entry.summary || entry.reusablePatterns || '').slice(0, 1200);
              const itemId = `library:${entry.id}`;
              return { id: itemId, title: entry.title || '未命名资料', sourceVersion: entry.updatedAt || entry.createdAt || '',
                relativePath: '', status: excerpt ? 'pending' : 'failed', reason: excerpt ? '' : '资料条目没有可用摘要或摘录' };
            });
            coverageCandidates.set(id, new Map(entries.map(entry => [`library:${entry.id}`, {
              id: `library:${entry.id}`, sourceVersion: entry.updatedAt || entry.createdAt || '',
              excerpt: String(entry.contentExcerpt || entry.summary || entry.reusablePatterns || '').slice(0, 1200)
            }])));
            coveragePreview.set(id, { sourceKind: 'knowledge-library', label: '全部未隐藏资料库条目', filters: '全部资料，无相关度截断', items, knownTotal: items.length, inventoryComplete: true });
          } else if (action === 'coverage-preview-directory') {
            const api = desktopApi?.promptAgentSources;
            if (typeof api?.refreshIndex !== 'function') throw new Error('授权目录全量索引仅在 Windows 桌面版可用');
            const index = await api.refreshIndex(data.sourceId);
            const rawFilter = String(document.getElementById('writing-coverage-directory-filter')?.value || '').trim().replace(/\\/g, '/');
            const directoryFilter = rawFilter ? `${rawFilter.replace(/^\/+|\/+$/g, '')}/` : '';
            if (directoryFilter && (rawFilter.startsWith('/') || directoryFilter.split('/').some(part => part === '..') || /^[a-z]:/i.test(directoryFilter))) {
              throw new Error('子目录筛选必须是授权目录内的相对位置');
            }
            const files = new Map((index.files || []).map(item => [item.relativePath, item]));
            const inventory = Array.isArray(index.inventory) ? index.inventory : [];
            const scopedInventory = inventory.filter(item => !directoryFilter || item.relativePath.startsWith(directoryFilter));
            const relevantErrors = (index.traversalErrors || []).filter(error => !directoryFilter || !error.relativePath
              || error.relativePath === directoryFilter.slice(0, -1) || error.relativePath.startsWith(directoryFilter)
              || directoryFilter.startsWith(`${error.relativePath}/`));
            const items = scopedInventory.map(item => {
              const indexed = files.get(item.relativePath);
              const itemId = `directory:${data.sourceId}:${item.id}`;
              const usable = item.status === 'indexed' && indexed;
              return { id: itemId, title: item.title || '未命名文件', sourceVersion: indexed?.fingerprint || '',
                relativePath: item.relativePath || '', status: usable ? 'pending' : item.status === 'excluded-private' ? 'excluded' : 'failed',
                reason: usable ? '' : item.status === 'excluded-private' ? '按本地安全规则排除的敏感文件' : item.reason || `不支持或不可读取：${item.status}` };
            });
            for (const [indexNumber, error] of relevantErrors.entries()) items.push({
              id: `directory:${data.sourceId}:unknown:${indexNumber}`, title: '未能完整枚举的目录内容',
              sourceVersion: '', relativePath: error.relativePath || '', status: 'failed', reason: error.reason || '目录读取失败'
            });
            coverageCandidates.set(id, new Map(items.map(item => {
              const relative = item.relativePath;
              const indexed = files.get(relative);
              return [item.id, { id: item.id, sourceVersion: indexed?.fingerprint || '', excerpt: indexed?.excerpt || '' }];
            })));
            coveragePreview.set(id, { sourceKind: 'authorized-directory', label: (state().promptAgentSources || []).find(source => source.id === data.sourceId)?.label || '授权目录',
              sourceId: data.sourceId, filters: `${directoryFilter ? `相对目录：${directoryFilter}` : '全目录'}（安全策略排除构建目录与敏感文件）`, items,
              knownTotal: items.length, inventoryComplete: index.inventoryComplete === true && relevantErrors.length === 0 });
          } else if (action === 'coverage-confirm-range') {
            const preview = coveragePreview.get(id);
            if (!preview) throw new Error('请先预览资料范围');
            await coordinator.setMaterialCoverage(id, { id: `coverage-${Date.now()}`, sourceKind: preview.sourceKind,
              filters: preview.filters, createdAt: new Date().toISOString(), knownTotal: preview.knownTotal,
              inventoryComplete: preview.inventoryComplete, items: preview.items.map(item => item.included === false
                ? { ...item, status: 'excluded', reason: '用户在范围预览中排除' } : item) });
          } else if (action === 'coverage-start-batch') {
            const size = Number(document.getElementById('writing-coverage-batch-size')?.value || 3);
            const saved = workspace(id)?.materialCoverage;
            const directoryItemId = saved?.items?.find(item => item.id.startsWith('directory:'))?.id || '';
            const sourceId = saved?.sourceKind === 'authorized-directory'
              ? coveragePreview.get(id)?.sourceId || directoryItemId.split(':')[1] || '' : '';
            let materials = [...(coverageCandidates.get(id)?.values() || [])];
            if (sourceId) {
              const api = desktopApi?.promptAgentSources;
              if (typeof api?.refreshIndex !== 'function') throw new Error('无法验证授权目录当前状态，请重新在 Windows 桌面版授权并刷新');
              const index = await api.refreshIndex(sourceId);
              const current = new Map((index.files || []).map(item => [`directory:${sourceId}:${item.id}`, {
                id: `directory:${sourceId}:${item.id}`, sourceVersion: item.fingerprint, excerpt: item.excerpt
              }]));
              materials = saved.items.filter(item => item.status === 'pending').map(item => current.get(item.id)).filter(Boolean);
            }
            await coordinator.startMaterialBatch(id, { batchSize: size, materials });
          } else if (action === 'coverage-copy-batch') {
            const w = workspace(id);
            const batch = w?.materialCoverage?.batches?.at(-1);
            const version = w?.rounds?.at(-1)?.promptVersions?.find(item => item.id === batch?.promptVersionId);
            if (!version || typeof copyText !== 'function') throw new Error('当前批次提示词不可用或复制功能未配置');
            await copyText(version.content);
            await coordinator.markPromptVersionCopied(id, w.rounds.at(-1).id, version.id);
          } else if (action === 'coverage-return' || action === 'coverage-fail') {
            const w = workspace(id);
            const batch = w?.materialCoverage?.batches?.find(item => item.id === data.batchId);
            if (!batch) throw new Error('找不到当前批次');
            if (action === 'coverage-return') await coordinator.recordMaterialBatchOutcome(id, data.batchId, {
              kind: 'returned', promptVersionId: batch.promptVersionId,
              resultSummary: document.getElementById(`writing-coverage-result-${data.batchId}`)?.value || ''
            });
            else await coordinator.recordMaterialBatchOutcome(id, data.batchId, {
              kind: 'failed', reason: document.getElementById(`writing-coverage-failure-${data.batchId}`)?.value || ''
            });
          } else if (action === 'coverage-confirm') await coordinator.confirmMaterialBatch(id, data.batchId, {
            evidence: document.getElementById(`writing-coverage-confirmation-${data.batchId}`)?.value || '', confirmedAt: new Date().toISOString()
          });
          else if (action === 'coverage-retry') await coordinator.retryMaterialBatch(id, data.batchId);
          else if (action === 'coverage-exclude') await coordinator.excludeMaterialFromCoverage(id, data.sourceId,
            document.getElementById(`writing-coverage-reason-${data.sourceId}`)?.value || '用户明确排除');
          f.error = '';
        } catch (error) { f.error = error.message || '资料覆盖操作失败'; }
        render();
        return;
      }
      if (action === 'cancel-material-parse') { activeMaterialJob?.controller.abort(); form().error = '本机解析已取消；原附件引用仍保留。'; render(); return; }
      if (action === 'manage-memories') { managerOpen = !managerOpen; render(); return; }
      if (action === 'manage-packs') { packUI && packUI.handle('pack-open'); return; }
      if (action === 'import-material-files') { document.getElementById('writing-material-files')?.click(); return; }
      if (action === 'add-material-link') { addMaterialLink(); return; }
      if (action === 'read-web-material') { await readWebMaterial(data.index); return; }
      if (action?.startsWith('pack-')) { await packUI?.handle(action, data); return; }
      const id = articleId;
      const f = form(id);
      if (action === 'use-material-segment') {
        const material = f.materials[Number(data.index)];
        const segment = material?.parsedSegments?.[Number(data.segmentIndex)];
        if (!material || !segment) return;
        material.excerpt = segment.text.slice(0, 1200);
        material.excerptLocator = segment.locator;
        material.sourceType ||= 'unread-file-reference';
        material.contentStatus = 'embedded';
        material.verificationStatus = 'unverified';
        material.attachmentRequired = true;
        material.parsedSegments = [];
        f.dirty = [...new Set([...f.dirty, 'materials'])];
        render(); return;
      }
      if (action === 'use-web-segment') {
        const material = f.materials[Number(data.index)];
        const result = material && webReadResults.get(material.id);
        if (!material || !result?.ok) return;
        material.title = result.title.slice(0, 160);
        material.excerpt = result.text.slice(0, 1200);
        material.excerptLocator = `网页选摘 · ${result.finalUrl}`.slice(0, 120);
        material.sourceType = 'web-text';
        material.contentStatus = 'embedded';
        material.originalLength = result.characterCount;
        material.attachmentRequired = false;
        material.verificationStatus = 'unverified';
        webReadResults.delete(material.id);
        f.dirty = [...new Set([...f.dirty, 'materials'])];
        render(); return;
      }
      if (action === 'academic-add-requirement') {
        if (f.academicRequirements.length < 20) f.academicRequirements.push({ id: newMaterialId(), title: '', issuer: '', target: '', version: '', text: '', sourceUrl: '', locator: '', verificationStatus: 'unverified' });
        render(); return;
      }
      if (action === 'academic-remove-requirement') {
        f.academicRequirements.splice(Number(data.index), 1); render(); return;
      }
      if (action === 'save-longform-project') {
        try {
          const patch = Object.fromEntries([...mount.querySelectorAll('[data-longform-project]')]
            .map(input => [input.dataset.longformProject, input.value]));
          await coordinator.updateLongformProject(id, patch);
          f.error = '';
        } catch (error) { f.error = error.message || '项目设定未保存'; }
        render(); return;
      }
      if (action === 'archive-longform-item' || action === 'restore-longform-item') {
        try {
          await coordinator.saveLongformItem(id, data.longformType, data.itemId, {
            archived: action === 'archive-longform-item',
            changeReason: action === 'archive-longform-item' ? '用户归档故事资料' : '用户恢复故事资料'
          });
          f.error = '';
        } catch (error) { f.error = error.message || '故事资料状态未保存'; }
        render(); return;
      }
      if (action === 'add-longform-item' || action === 'update-longform-item') {
        const type = data.longformType;
        const itemId = data.itemId || '';
        const prefix = itemId ? `writing-story-item-${itemId}` : `writing-story-${type}`;
        const value = document.getElementById(`${prefix}-${itemId ? 'value' : 'text'}`)?.value || '';
        const unitIds = String(document.getElementById(`${prefix}-${itemId ? 'units' : 'units'}`)?.value || '')
          .split(',').map(unit => unit.trim()).filter(Boolean);
        const primaryField = { canon: 'name', character: 'name', timeline: 'text', foreshadowing: 'planted' }[type];
        const secondaryField = { canon: 'text', character: 'goals', timeline: 'storyTime', foreshadowing: 'expectedPayoff' }[type];
        const patch = { [secondaryField]: value, unitIds };
        const primary = document.getElementById(`${prefix}-${itemId ? 'name' : 'name'}`)?.value || '';
        patch[primaryField] = primary;
        const extras = {
          character: ['identity', 'relationships', 'known', 'unknown', 'state', 'arc', 'firstUnitId', 'lastUnitId', 'notes'],
          timeline: ['characterIds', 'canonIds', 'order'],
          foreshadowing: ['characterIds', 'canonIds', 'confirmation']
        }[type] || [];
        for (const key of extras) {
          const extraId = itemId ? `writing-story-${type}-item-${itemId}-${key}` : `writing-story-${type}-${key}`;
          const rawValue = document.getElementById(extraId)?.value || '';
          patch[key] = ['characterIds', 'canonIds'].includes(key)
            ? rawValue.split(',').map(value => value.trim()).filter(Boolean) : rawValue;
        }
        if (itemId) {
          if (type !== 'character') patch.status = document.getElementById(`${prefix}-status`)?.value;
          patch.changeReason = document.getElementById(`${prefix}-reason`)?.value || '';
        }
        try {
          await coordinator.saveLongformItem(id, type, itemId, patch);
          f.error = '';
        } catch (error) { f.error = error.message || '故事资料未保存'; }
        render(); return;
      }
      if (action === 'review-longform-impact') {
        const reason = document.getElementById(`writing-story-impact-${data.changeId}-${data.itemId}`)?.value || '';
        const statusInput = document.getElementById(`writing-story-impact-status-${data.changeId}-${data.itemId}`);
        const status = statusInput?.value || '';
        if (!status) {
          statusInput?.focus?.();
          statusInput?.reportValidity?.();
          return;
        }
        try { await coordinator.reviewLongformImpact(id, data.changeId, data.itemId, status, reason); f.error = ''; }
        catch (error) { f.error = error.message || '影响审查未保存'; }
        render(); return;
      }
      if (action === 'save-material-to-library') {
        const material = f.materials[Number(data.index)];
        if (!material || !String(material.excerpt || '').trim()) {
          f.error = '没有可保存的摘录；请先读取或粘贴材料内容';
          render();
          return;
        }
        try {
          if (typeof saveMaterialToLibrary !== 'function') throw new Error('资料库保存功能暂不可用');
          const saved = await saveMaterialToLibrary(clone(material));
          material.savedToLibrary = true;
          material.savedEntryId = saved?.id || '';
          f.error = '';
        } catch (error) {
          f.error = `保存到资料库失败：${error.message || error}`;
          notify?.(f.error);
        }
        render();
        return;
      }
      if (action === 'cancel-research') { coordinator.cancelResearch(id); render(); return; }
      if (action === 'round') { f.historyId = data.roundId; render(); return; }
      if (action === 'continue-from-round') {
        const submitted = clone(f);
        busy.add(id); f.error = ''; render();
        try {
          const result = await coordinator.continueFromRound(id, data.roundId, { contexts: submitted.forkContexts });
          f.draft = result.round.draft;
          f.historyId = result.round.id;
          f.sourcePromptVersionId = '';
          updateOutputs(f, result.round, submitted);
        } catch (error) { f.error = error.message || '无法从此轮继续，当前输入已保留'; }
        finally { busy.delete(id); render(); }
        return;
      }
      if (action === 'add-material') { if (f.materials.length < 3) f.materials.push({ id: newMaterialId(), title: '', excerpt: '', purpose: 'content', kind: 'material', sourceType: 'pasted-text', origin: 'user-pasted', contentStatus: 'reference-only' }); render(); return; }
      if (action === 'remove-material') { const [removed] = f.materials.splice(Number(data.index), 1); if (removed) webReadResults.delete(removed.id); render(); return; }
      if (action === 'copy-diagnosis') {
        try { await copyText?.(f.diagnosis); }
        catch (error) { f.error = `复制失败：${error.message || error}`; render(); }
        return;
      }
      if (action === 'save-prompt-version' || action === 'copy-prompt') {
        try {
          if (action === 'copy-prompt') {
            if (typeof copyText !== 'function') throw new Error('当前环境无法复制提示词');
            await copyText(f.prompt);
          }
          const latest = coordinator.getWorkspace(id).rounds.at(-1);
          const version = await coordinator.recordPromptVersion(id, latest.id, f.prompt, { copied: action === 'copy-prompt' });
          f.error = '';
          f.promptNotice = action === 'copy-prompt' ? '提示词已复制并记录为版本' : '提示词版本已保存';
          f.lastPromptVersionId = version.id;
        } catch (error) { f.error = error.message || '提示词版本未保存'; }
        render();
        return;
      }
      if (action === 'export-prompt-history') {
        try {
          const latest = coordinator.getWorkspace(id)?.rounds?.at(-1);
          const versions = latest?.promptVersions || [];
          if (!versions.length) throw new Error('本轮还没有可导出的提示词版本');
          const payload = JSON.stringify({ articleId: id, roundId: latest.id, exportedAt: new Date().toISOString(), promptVersions: versions }, null, 2);
          if (typeof downloadText === 'function') downloadText(`writing-prompt-history-${latest.id}.json`, payload);
          else {
            const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `writing-prompt-history-${latest.id}.json`;
            link.click();
            URL.revokeObjectURL(url);
          }
          f.error = '';
          f.promptNotice = `已导出本轮${versions.length}条提示词版本`;
        } catch (error) { f.error = error.message || '提示词历史导出失败'; }
        render();
        return;
      }
      const writingActions = new Set(['add-unit', 'update-unit', 'archive-unit', 'apply-material-units', 'add-issue', 'update-issue',
        'select-writing-route', 'route-start', 'route-complete', 'route-skip', 'route-block']);
      if (writingActions.has(action)) {
        if (busy.has(id)) return;
        const submitted = clone(f);
        if (action === 'update-unit') {
          const unitId = data.unitId;
          submitted.unitPatch = {
            title: document.getElementById(`writing-unit-${unitId}-title`)?.value,
            goal: document.getElementById(`writing-unit-${unitId}-goal`)?.value,
            completionCriteria: lines(document.getElementById(`writing-unit-${unitId}-criteria`)?.value),
            order: Number(document.getElementById(`writing-unit-${unitId}-order`)?.value)
          };
          const genre = coordinator.getWorkspace(id).article.genre;
          if (genre === 'longform-research-article') {
            const list = key => String(document.getElementById(`writing-unit-${unitId}-${key}`)?.value || '').split(',').map(value => value.trim()).filter(Boolean);
            submitted.unitPatch.summary = document.getElementById(`writing-unit-${unitId}-summary`)?.value || '';
            submitted.unitPatch.priorUnitIds = list('priorUnitIds');
            submitted.unitPatch.nextUnitIds = list('nextUnitIds');
          }
          if (['fiction', 'script', 'longform-general'].includes(genre)) {
            const list = key => String(document.getElementById(`writing-unit-${unitId}-${key}`)?.value || '').split(',').map(value => value.trim()).filter(Boolean);
            for (const key of ['viewpoint', 'storyTime', 'location', 'purpose', 'format', 'entrances', 'exits', 'action']) submitted.unitPatch[key] = document.getElementById(`writing-unit-${unitId}-${key}`)?.value || '';
            for (const key of ['characterIds', 'canonIds', 'eventIds', 'foreshadowingIds']) submitted.unitPatch[key] = list(key);
            submitted.unitPatch.summary = document.getElementById(`writing-unit-${unitId}-summary`)?.value || '';
            submitted.unitPatch.priorUnitIds = list('priorUnitIds');
            submitted.unitPatch.nextUnitIds = list('nextUnitIds');
          }
        }
        const genre = coordinator.getWorkspace(id).article.genre;
        if (action === 'add-unit' && genre === 'longform-research-article') {
          const value = key => document.getElementById(`writing-${key}`)?.value || '';
          const list = key => value(key).split(',').map(item => item.trim()).filter(Boolean);
          submitted.unitResearch = { summary: value('unit-summary'), priorUnitIds: list('unit-prior-unit-ids'), nextUnitIds: list('unit-next-unit-ids') };
        }
        if (action === 'add-unit' && ['fiction', 'script', 'longform-general'].includes(genre)) {
          const value = key => document.getElementById(`writing-${key}`)?.value || '';
          const list = key => value(key).split(',').map(item => item.trim()).filter(Boolean);
          submitted.unitStory = { viewpoint: value('unit-viewpoint'), storyTime: value('unit-story-time'), location: value('unit-location'),
            purpose: value('unit-purpose'), format: value('unit-format'), entrances: value('unit-entrances'), exits: value('unit-exits'), action: value('unit-action'),
            characterIds: list('unit-character-ids'), canonIds: list('unit-canon-ids'),
            eventIds: list('unit-event-ids'), foreshadowingIds: list('unit-foreshadowing-ids'), summary: value('unit-summary'),
            priorUnitIds: list('unit-prior-unit-ids'), nextUnitIds: list('unit-next-unit-ids') };
        }
        if (action === 'update-issue') {
          const issueId = data.issueId;
          submitted.issuePatch = {
            judgment: document.getElementById(`writing-issue-${issueId}-judgment`)?.value,
            status: document.getElementById(`writing-issue-${issueId}-status`)?.value,
            statusReason: document.getElementById(`writing-issue-${issueId}-reason`)?.value,
            reviewedRoundId: document.getElementById(`writing-issue-${issueId}-review-round`)?.value
          };
        }
        busy.add(id); f.error = ''; render();
        try {
          if (action === 'add-unit') {
            const unit = await coordinator.addUnit(id, { title: submitted.unitTitle, type: submitted.unitType,
              goal: submitted.unitGoal, completionCriteria: lines(submitted.unitCriteria), ...(submitted.unitStory || {}), ...(submitted.unitResearch || {}) });
            f.unitId = unit.id; f.unitTitle = ''; f.unitGoal = ''; f.unitCriteria = '';
          } else if (action === 'update-unit') {
            await coordinator.updateUnit(id, data.unitId, submitted.unitPatch);
          } else if (action === 'archive-unit') {
            await coordinator.archiveUnit(id, data.unitId);
            if (f.unitId === data.unitId) f.unitId = '';
          } else if (action === 'apply-material-units') {
            const round = coordinator.getWorkspace(id).rounds.at(-1);
            const material = f.materials[Number(data.index)];
            if (!material?.id) throw new Error('材料尚未保存到轮次；请先创建或回带一轮');
            const updated = await coordinator.setMaterialUnits(id, round.id, material.id, material.unitIds || []);
            f.materials = references(updated);
            updateOutputs(f, updated, submitted);
          } else if (action === 'add-issue') {
            const round = coordinator.getWorkspace(id).rounds.at(-1);
            const diagnosisVersion = [...(round.promptVersions || [])].reverse().find(version => version.taskType === 'diagnosis');
            await coordinator.addIssue(id, {
              roundId: round.id, unitId: round.unitId,
              promptVersionId: diagnosisVersion?.id || round.sourcePromptVersionId || round.promptVersions?.at(-1)?.id || '',
              location: submitted.issueLocation, excerpt: submitted.issueExcerpt, observation: submitted.issueObservation,
              impact: submitted.issueImpact, evidenceCategory: submitted.issueEvidenceCategory,
              evidenceDescription: submitted.issueEvidence, suggestion: submitted.issueSuggestion, priority: submitted.issuePriority,
              judgment: 'candidate', status: 'pending-user'
            });
            for (const key of ['issueExcerpt', 'issueLocation', 'issueObservation', 'issueImpact', 'issueEvidence', 'issueSuggestion']) f[key] = '';
          } else if (action === 'update-issue') {
            await coordinator.updateIssue(id, data.issueId, submitted.issuePatch);
          } else if (action === 'select-writing-route') {
            const result = await coordinator.selectRoute(id, data.routeId, data.packId);
            updateOutputs(f, result.round, submitted);
            const selectedRoute = coordinator.getWorkspace(id)?.routeProgress;
            focusAfterRenderId = selectedRoute?.currentStageId ? `writing-route-start-${selectedRoute.currentStageId}` : 'writing-route-next-step-heading';
          } else {
            const operation = { 'route-start': 'start', 'route-complete': 'complete', 'route-skip': 'skip', 'route-block': 'block' }[action];
            if (operation === 'complete' && !await confirm('请确认当前路线步骤已完成。该确认只记录你的操作，不代表专业认证。')) return;
            const result = await coordinator.advanceRoute(id, data.stageId, operation, {
              confirmed: operation === 'complete', result: submitted.routeResult, evidence: submitted.routeEvidence,
              reason: submitted.routeBlockReason, returnToStageId: submitted.routeReturnToStageId || ''
            });
            updateOutputs(f, result.round, submitted);
            if (operation === 'complete') { f.routeResult = ''; f.routeEvidence = ''; }
            if (operation === 'block') { f.routeBlockReason = ''; f.routeReturnToStageId = ''; }
            const updatedRoute = coordinator.getWorkspace(id)?.routeProgress;
            const updatedStage = updatedRoute?.stages?.find(item => item.id === updatedRoute.currentStageId);
            focusAfterRenderId = updatedStage?.status === 'in-progress' ? 'writing-route-result'
              : updatedStage && ['not-started', 'blocked', 'user-confirmed-complete'].includes(updatedStage.status)
                ? `writing-route-start-${updatedStage.id}` : 'writing-route-next-step-heading';
          }
          f.error = '';
        } catch (error) { f.error = error.message || '操作失败，输入已保留'; focusAfterRenderId = 'writing-error'; }
        finally { busy.delete(id); render(); }
        return;
      }
      if (busy.has(id)) return;
      const submitted = clone(f);
      busy.add(id); f.error = ''; render();
      try {
        if (action === 'create') {
          let confirmAsArticle = false;
          let genre = genreId(f.genre);
          if (!genre) {
            confirmAsArticle = await confirm('输入的文体暂不支持。确认按普通文章处理？');
            if (!confirmAsArticle) return;
            genre = 'article';
          }
          const memoryIds = new Set((state().writingMemories || []).map(m => m.id));
          const w = await coordinator.createArticle({ ...articlePatch(submitted), ...roundInput(submitted, submitted.draft, ''), genre, confirmAsArticle });
          drafts.delete(''); drafts.set(w.id, f);
          if (articleId === '') articleId = w.id;
          if (JSON.stringify(f.materials) === JSON.stringify(submitted.materials)) f.materials = references(w.rounds.at(-1));
          f.genre = schema.getWritingGenreConfig(w.article.genre)?.name || articleConfig.name;
          f.taskType = w.rounds.at(-1).taskType || 'revision';
          updateOutputs(f, w.rounds.at(-1), submitted);
          acknowledge(f, submitted, ['title', 'goal', 'audience', 'platform', 'success', 'preserve', 'constraints', 'dimensions', 'materials', 'corrections', 'draft', 'packSelections', 'academicRequirements', 'domainInputs']);
          for (const m of state().writingMemories || []) {
            if (!memoryIds.has(m.id) && m.undo?.action === 'auto-promote' && !m.undo.undoneAt && m.evidenceArticleIds.includes(w.id)) {
              f.notifications.push({ memoryId: m.id, message: '已记住跨文章重复偏好，可撤销' });
            }
          }
        } else if (action === 'update' || action === 'build') {
          const w = await coordinator.updateArticle(id, articlePatch(submitted));
          updateOutputs(f, w.rounds.at(-1), submitted);
          acknowledge(f, submitted, ['title', 'goal', 'audience', 'platform', 'success', 'preserve', 'constraints', 'dimensions', 'packSelections', 'domainInputs']);
        } else if (action === 'academic-task' || action === 'domain-task') {
          if (action === 'domain-task') {
            await coordinator.updateArticle(id, articlePatch(submitted));
            acknowledge(f, submitted, ['title', 'goal', 'audience', 'platform', 'success', 'preserve', 'constraints', 'dimensions', 'packSelections', 'domainInputs']);
            const result = await coordinator.appendRound(id, {
              ...roundInput(submitted, submitted.draft, id), taskType: data.taskType
            });
            f.taskType = result.round.taskType;
            f.sourcePromptVersionId = '';
            if (JSON.stringify(f.materials) === JSON.stringify(submitted.materials)) f.materials = references(result.round);
            updateOutputs(f, result.round, submitted);
            f.notifications.push(...result.notifications);
            acknowledge(f, submitted, ['materials', 'corrections', 'draft', 'packSelections']);
            const label = DOMAIN_TASK_LABELS[result.round.taskType] || schema.getWritingGenreConfig(genreId(f.genre))?.name || '领域';
            f.promptNotice = `已生成${label}提示词，并保存为独立版本`;
          } else {
            const roundId = coordinator.getWorkspace(id).rounds.at(-1).id;
            const result = await coordinator.build(id, { taskType: data.taskType, roundId, unitId: submitted.unitId });
            f.taskType = result.taskType;
            f.prompt = result.prompt;
            f.dirty = f.dirty.filter(key => key !== 'prompt');
            const labels = { 'academic-planning': '研究规划', 'academic-outline': '论文提纲',
              'academic-chapter-draft': '章节起草', diagnosis: '诊断', revision: '定向改稿' };
            f.promptNotice = `已生成${labels[result.taskType] || '学术'}提示词，并保存为独立版本`;
          }
        } else if (action === 'append') {
          try { await coordinator.updateArticle(id, articlePatch(submitted)); }
          catch (error) {
            // 旧失败轮可能超长；目标已更新后允许精简新稿绕过旧轮，原文仍留会话。
            if (!(error instanceof RangeError) || !submitted.newDraft.trim()) throw error;
          }
          const result = await coordinator.appendRound(id, roundInput(submitted, submitted.newDraft || submitted.draft, id));
          f.draft = result.round.draft;
          f.sourcePromptVersionId = '';
          if (JSON.stringify(f.materials) === JSON.stringify(submitted.materials)) f.materials = references(result.round);
          updateOutputs(f, result.round, submitted);
          f.notifications.push(...result.notifications);
          acknowledge(f, submitted, ['title', 'goal', 'audience', 'platform', 'success', 'preserve', 'constraints', 'dimensions', 'materials', 'corrections', 'packSelections', 'domainInputs']);
          for (const key of ['newDraft', 'feedback', 'preference', 'example', 'counterexample']) if (f[key] === submitted[key]) f[key] = '';
        } else if (action === 'save') await coordinator.setSaveEnabled(id, f.saveEnabled);
        else if (action === 'delete-article') {
          if (!await confirm('确认删除整篇文章及所有轮次、稿件和反馈？取消会保留全部历史。')) return;
          await coordinator.deleteArticle(id, { confirmed: true }); drafts.delete(id);
          if (articleId === id) articleId = '';
        } else if (action === 'correct-style') {
          await coordinator.correctStyleProfile(id, submitted.corrections);
          updateOutputs(f, coordinator.getWorkspace(id).rounds.at(-1), submitted);
          acknowledge(f, submitted, ['corrections']);
        } else if (action === 'select-materials') {
          const result = await coordinator.selectMaterials(id);
          if (JSON.stringify(f.materials) === JSON.stringify(submitted.materials)) {
            const selected = references(result);
            const identity = m => JSON.stringify([m.title, m.excerpt, m.purpose]);
            f.materials = [...f.materials, ...selected.filter(m => !f.materials.some(old => identity(old) === identity(m)))].slice(0, 3);
          }
          updateOutputs(f, coordinator.readRound(id, result.roundId), submitted);
        } else if (action === 'preview-research') {
          coordinator.previewResearch(id, { method: submitted.researchMethod, keywords: submitted.researchKeywords });
        } else if (action === 'reject-research') {
          await coordinator.rejectResearch(id);
        } else if (action === 'approve-research') {
          const pending = coordinator.approveResearch(id, { confirmed: true });
          render();
          const result = await pending;
          if (result.status !== 'cancelled') {
            syncResearch(f, coordinator.readRound(id, result.roundId), submitted);
          }
        } else if (action === 'model') {
          const roundId = coordinator.getWorkspace(id).rounds.at(-1).id;
          const result = await coordinator.runModelDiagnosis(id, { roundId });
          updateOutputs(f, result, submitted);
        } else if (action === 'remember') {
          const m = await coordinator.rememberPreference(id, { scope: submitted.scope, preference: submitted.preference, example: submitted.example, counterexample: submitted.counterexample });
          f.notifications.push({ memoryId: m.id, message: '偏好已保存到本机，可撤销' });
        } else if (action === 'undo-memory') {
          await coordinator.undoMemory(data.memoryId); f.notifications = f.notifications.filter(n => n.memoryId !== data.memoryId);
        } else if (action === 'edit-memory') await coordinator.editMemory(data.memoryId, memoryDrafts.get(data.memoryId));
        else if (action === 'delete-memory') await coordinator.deleteMemory(data.memoryId);
      } catch (error) {
        f.error = promptLimitGuidance(error.message || '操作失败，输入已保留', error.articleId || id, submitted);
        if (action === 'approve-research' && error.code === 'PERSIST_FAILED') {
          syncResearch(f, coordinator.getWorkspace(id).rounds.at(-1), submitted);
          f.error += '；搜索上下文与提示词仅在会话中，尚未保存到本机';
        }
        if (action === 'append' && error.code !== 'STALE_RESULT') {
          // 新轮可能已留在会话，仅落盘失败；可见稿必须与下一次模型诊断使用的轮次一致。
          const round = coordinator.getWorkspace(id).rounds.at(-1);
          f.draft = round.draft;
          updateOutputs(f, round, submitted);
        }
        if (action === 'create' && error.articleId && error.code !== 'STALE_RESULT') {
          drafts.delete(''); drafts.set(error.articleId, f); if (articleId === '') articleId = error.articleId;
        }
        notify?.(f.error);
      } finally { busy.delete(id); render(); }
    }
    mount.addEventListener('input', event => {
      const target = event.target;
      if (target.dataset?.writingField === 'wizardMaterialSearch') {
        const caret = target.selectionStart;
        capture(target);
        render();
        const search = document.getElementById('writing-wizard-material-search');
        search?.focus?.();
        search?.setSelectionRange?.(caret, caret);
        return;
      }
      const isReplacingFileSource = target.dataset?.writingField === 'draft' && Boolean(form().wizardSourceDocument);
      const caret = isReplacingFileSource ? target.selectionStart : null;
      capture(target);
      if (isReplacingFileSource) {
        render();
        const draft = document.getElementById('writing-draft');
        draft?.focus?.();
        draft?.setSelectionRange?.(caret, caret);
      }
    });
    mount.addEventListener('change', async event => {
      const target = event.target;
      if (target.dataset?.coverageInclude) {
        const preview = coveragePreview.get(articleId);
        const item = preview?.items.find(entry => entry.id === target.dataset.coverageInclude);
        if (item) item.included = target.checked;
        render();
      }
      else if (target.id === 'writing-source-file') { await importWritingSourceFile(target.files?.[0]); target.value = ''; }
      else if (target.id === 'writing-material-folder') { await indexReferenceFolder(target.files); target.value = ''; }
      else if (target.id === 'writing-material-files') { await importMaterialFiles(target.files); target.value = ''; }
      else if (target.id === 'writing-article-list') { if (articleId && articleId !== target.value) coordinator.cancelResearch(articleId); activeMaterialJob?.controller.abort(); webReadResults.clear(); articleId = target.value; render(); }
      else if (target.dataset?.writingField === 'wizardSourceScope') { capture(target); render(); }
      else if (target.id === 'writing-genre' && !articleId) {
        // 文体输入框失焦时若整块重绘，会替换用户正要输入的下一个控件；
        // 先记录选择，创建后再按新文体绘制专属字段与任务。
        capture(target);
      }
      else if (target.id === 'writing-wizard-genre' || target.id === 'writing-wizard-task-type'
        || target.dataset?.writingField === 'wizardMode') { capture(target); render(); }
      else if (target.id === 'writing-save') { form().saveEnabled = target.checked; await operate('save'); }
      else if (target.dataset?.materialField === 'selectedForPrompt') {
        const material = form().materials[Number(target.dataset.materialIndex)];
        if (material) material.selectedForPrompt = target.checked;
        render();
      }
      else if (target.dataset?.wizardMaterial !== undefined) {
        const f = form();
        const item = f.materials[Number(target.dataset.wizardMaterial)];
        if (item && target.checked && !f.wizardMaterialIds.includes(item.id) && f.wizardMaterialIds.length >= 3) {
          f.error = '直接参考材料最多 3 份；请先取消一份已选材料。';
        } else if (item) f.wizardMaterialIds = target.checked
          ? [...new Set([...f.wizardMaterialIds, item.id])]
          : f.wizardMaterialIds.filter(id => id !== item.id);
        render();
      }
      else if (target.dataset?.sourceSection !== undefined) {
        const source = form().wizardSourceDocument;
        if (source) source.selectedSectionIds = target.checked
          ? [...new Set([...source.selectedSectionIds, target.dataset.sourceSection])]
          : source.selectedSectionIds.filter(id => id !== target.dataset.sourceSection);
        render();
      }
      else if (target.dataset?.writingField === 'wizardSourceScope') {
        capture(target); render();
      }
      else if (target.dataset?.wizardIssue) {
        const selected = new Set(form().wizardIssueIds);
        if (target.checked) selected.add(target.dataset.wizardIssue);
        else selected.delete(target.dataset.wizardIssue);
        form().wizardIssueIds = [...selected];
        render();
      }
      else capture(target);
    });
    mount.addEventListener('click', event => {
      const target = event.target.closest('[data-writing-action], [data-action]');
      if (!target || target.disabled) return;
      event.preventDefault();
      return operate(target.dataset.writingAction || target.dataset.action, target.dataset);
    });
    render();
    return { render, openArticle(id) { if (articleId && articleId !== id) coordinator.cancelResearch(articleId); activeMaterialJob?.controller.abort(); sourceImportJob?.controller.abort(); webReadResults.clear(); articleId = id || ''; render(); },
      refreshFromStorage() {
        memoryDrafts.clear();
        const ids = new Set(coordinator.listArticles().map(a => a.id));
        for (const [id, previous] of [...drafts]) {
          if (!id || !ids.has(id)) continue;
          drafts.delete(id);
          const fresh = form(id);
          // 恢复已提交的轮次，同时保留用户尚在编辑的输入。
          const retained = new Set([...previous.dirty, 'newDraft', 'feedback', 'preference', 'example', 'counterexample', 'scope']);
          for (const key of retained) if (key !== 'draft' && key !== 'saveEnabled') fresh[key] = clone(previous[key]);
          fresh.dirty = [...previous.dirty];
          drafts.set(id, fresh);
        }
        if (articleId && !ids.has(articleId)) articleId = '';
        render();
      } };
  }
  return { createWritingWorkbenchUI };
});
