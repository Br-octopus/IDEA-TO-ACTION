(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./writing-workbench-schema.js'), globalThis, require('./writing-material-coverage.js'), require('./writing-workbench-prompts.js'));
  else root.WritingWorkbenchUI = factory(root.WritingWorkbenchSchema, root, root.ForwardStepWritingMaterialCoverage, root.WritingWorkbenchPrompts);
})(typeof globalThis === 'undefined' ? this : globalThis, function (schema, root, coverageApi, prompts) {
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

  function createWritingWorkbenchUI({ document, coordinator, packUI, getState, copyText, downloadText, desktopApi = root?.desktopApi,
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
    let articleId = '';
    let writingStage = 1;
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
      return (pack.layer === 'core' || pack.genre === genre)
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
          .filter(pack => !['builtin-article', 'builtin-academic-paper', 'builtin-softcopyright-content'].includes(pack.id)
            && isSelectablePack(pack, genre) && enabledIds.has(pack.id))
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
      const hasPromptVersion = !!(w?.rounds || []).some(round => (round.promptVersions || []).length);
      if (!w) writingStage = 1;
      else if (writingStage === 4 && !hasPromptVersion) writingStage = 3;
      const stepButton = (step, label, available) => `<button type="button" class="social-wizard-step" data-writing-action="wizard-stage" data-stage="${step}" ${!available || processingMaterials ? 'disabled aria-disabled="true"' : ''} ${writingStage === step ? 'aria-current="step"' : ''}><span class="social-wizard-number">${step}</span><span>${label}</span>${step === 4 && hasPromptVersion ? '<span class="social-wizard-badge">就绪</span>' : ''}</button>`;
      const domainFields = Object.entries(config?.domainFields || {});
      const domainInputs = domainFields.length ? `<details class="writing-domain-inputs"><summary>${escape(config.name)}专属信息（可选）</summary>
        <p class="social-muted">只填写当前任务需要的信息；空项会在提示词中标为“未提供”。</p>
        ${domainFields.map(([key, label]) => `<label class="field" for="writing-domain-${escape(key)}"><span class="field-label">${escape(label)}</span>
          <textarea id="writing-domain-${escape(key)}" aria-label="${escape(label)}" data-writing-domain-field="${escape(key)}">${escape(f.domainInputs?.[key] || '')}</textarea></label>`).join('')}</details>` : '';
      packUI?.connectWorkbenchRenderer?.(render);
      mount.innerHTML = `<h2>写作工作台</h2><p class="social-muted">按步骤完成文章目标、准备材料、生成提示词，再带回外部结果。</p><nav class="social-wizard-steps" aria-label="写作流程">${stepButton(1, '文章目标', true)}${stepButton(2, '参考材料', !!w)}${stepButton(3, '初检与提示词', !!w)}${stepButton(4, '带回结果', !!w && hasPromptVersion)}</nav>${processingMaterials ? `<p role="status">正在读取所选材料，请稍候…</p>${button('cancel-material-parse', '取消读取')}` : ''}
      <div class="social-wizard-panel" id="writing-wizard-stage-1" ${writingStage !== 1 ? 'hidden' : ''}><section class="social-panel">
        <div class="social-tools"><h2>文章目标</h2>${button('new', '新建文章')}</div>
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
        ${field('draft', w ? '当前稿件（只读；新稿从下方带回）' : '初稿（可选）', f.draft, { readOnly: !!w })}
        <div class="social-tools">${button(w ? 'update' : 'create', w ? '更新目标并本地初检' : '新建并本地初检', '', locked)}${w ? button('build', '重新本地初检', '', locked) : ''}</div>
        <p id="writing-error" role="alert" tabindex="-1">${escape(f.error)}</p>${busy.has(articleId) ? '<p role="status">正在处理当前文章…</p>' : ''}
      </section>
      ${renderAcademicTasks(w, f, genre, locked)}
        ${renderDomainTasks(w, f, genre, locked)}
      </div><div class="social-wizard-panel" id="writing-wizard-stage-2" ${writingStage !== 2 ? 'hidden' : ''}><section class="social-panel"><h2>参考材料</h2><p class="social-muted">添加本轮要用的内容、风格样本和要求；内容 / 风格 / 要求合计最多3份。</p>
        ${renderMaterials(f, w, genre)}<div class="social-tools">${button('add-material', '粘贴/填写材料', '', f.materials.length >= 3 || processingMaterials)}${button('import-material-files', '导入文件', '', f.materials.length >= 3 || processingMaterials)}${button('select-materials', '从资料库/授权目录选择', '', !w || locked)}</div>
        <input id="writing-material-files" type="file" aria-label="导入写作参考材料" accept=".txt,.md,.csv,.json,.pdf,.docx,.png,.jpg,.jpeg,.webp" multiple hidden __COND__>
        <details><summary>添加公开链接并按需读取正文</summary>
          <label class="field" for="writing-material-link-title"><span class="field-label">来源标题（可选）</span><input id="writing-material-link-title" data-writing-field="linkTitle" value="${escape(f.linkTitle)}"></label>
          <label class="field" for="writing-material-link-url"><span class="field-label">HTTP 或 HTTPS 链接</span><input id="writing-material-link-url" type="url" data-writing-field="linkUrl" value="${escape(f.linkUrl)}"></label>
          ${button('add-material-link', '加入链接', '', f.materials.length >= 3 || processingMaterials)}
        </details>
        <p class="social-muted">读取公开网页会向该网站发送链接请求并暴露你的网络地址；含查询参数的链接也会发送给该网站。不会携带登录状态或工作区内容。读取文本只暂存在当前页面，选摘后才进入本轮提示词；来源仍未核验。不可访问或需要登录时，请粘贴可读摘录。目录需先在本地资料设置中授权。</p>
        ${renderMaterialCoverage(w, locked)}${renderStyle(w)}${field('style-corrections', '用户纠正（最多2000字）', f.corrections, { name: 'corrections' })}${button('correct-style', '应用风格纠正', '', !w || locked)}
        ${renderResearch(w, f, locked)}
      </section></div><div class="social-wizard-panel" id="writing-wizard-stage-3" ${writingStage !== 3 ? 'hidden' : ''}>
      ${renderRoute(w, f, locked)}
      <section class="social-panel"><h2>本轮初检与下一轮提示词</h2><p class="social-muted">可编辑后保存为版本或复制；复制记录只表示本机复制操作，不表示外部模型已接收。模型诊断只分析并给提示词，不直接改写文章。正文和反馈可能离开本机，发送前仍需确认。</p>
        ${field('diagnosis', '具体诊断（本地初检不等于模型判断）', f.diagnosis)}${button('copy-diagnosis', '复制诊断')}
        ${field('prompt', '下一轮提示词', f.prompt)}<div class="social-tools">${button('save-prompt-version', '保存提示词版本', '', !w || locked)}${button('copy-prompt', '复制并记录提示词版本', '', processingMaterials)}${button('model', '预览并请求模型诊断', '', !w || locked)}</div>${(w?.rounds.at(-1)?.promptVersions?.length || 0) >= 80 ? '<p role="status">本轮提示词历史已接近100条。历史会继续完整保留；建议导出备份。</p>' : ''}<p role="status">${escape(f.promptNotice)}</p>
      </section>
      ${renderIssues(w, f, locked)}</div><div class="social-wizard-panel" id="writing-wizard-stage-4" ${writingStage !== 4 ? 'hidden' : ''}>
      <section class="social-panel"><h2>带回外部新稿与反馈</h2>${field('new-draft', '外部 AI 新稿', f.newDraft, { name: 'newDraft' })}<label class="field" for="writing-source-prompt-version"><span class="field-label">此结果使用的提示词版本</span><select id="writing-source-prompt-version" data-writing-field="sourcePromptVersionId"><option value="" ${f.sourcePromptVersionId ? '' : 'selected'}>来源提示词未关联</option>${promptVersionOptions}</select></label>${field('feedback', '本轮反馈（不会自动变成长久偏好）', f.feedback)}
        <h3>可选偏好候选</h3><p class="social-muted">只统计你在下方明确填写的候选；两篇不同文章重复时可晋升，并提供撤销。</p>
        ${field('preference', '偏好候选（可编辑）', f.preference)}<div class="social-form-grid">${field('example', '例句', f.example)}${field('counterexample', '反例', f.counterexample)}</div>
        ${button('append', '回带并新增同篇一轮', '', !w || locked)}
        ${renderNotifications(f)}<p><a href="#writing-history" data-writing-action="open-history">打开高级区中的历史轮次</a></p>
      </section></div><details class="social-panel" id="writing-advanced"><summary>高级设置与历史</summary>
        <label class="check-row"><input id="writing-save" type="checkbox" ${f.saveEnabled ? 'checked' : ''} ${!w || locked ? 'disabled' : ''}>开启本机保存</label><p class="social-muted">默认不保存正文。开启后稿件、反馈和轮次保存在本机。</p><p id="writing-save-status" role="status">${escape(persistenceStatus(w))}</p>
        ${w ? button('delete-article', '删除整篇及所有轮次', '', locked) : ''}${button('manage-memories', managerOpen ? '收起记忆管理' : '管理全部写作记忆')}${button('manage-packs', '专业基础包')}<label class="field" for="writing-memory-scope"><span class="field-label">显式记忆范围</span><select id="writing-memory-scope" data-writing-field="scope">${Object.entries(scopeLabels).map(([value, label]) => `<option value="${value}" ${f.scope === value ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select></label>${button('remember', '记住这个偏好', '', !w || locked)}${button('export-prompt-history', '导出本轮提示词历史', '', !w)}
        ${renderHistory(w, f)}${renderMemories(w)}${packManager}</details>`;
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
      return `<section class="social-panel" id="writing-history"><h2>轮次回看与比较</h2><div class="social-tools">${w.rounds.map((r, i) => button('round', `第${i + 1}轮`, `data-round-id="${escape(r.id)}"`)).join('')}</div>${round ? `<label class="field">历史原稿<textarea id="writing-history-draft" readonly>${escape(round.draft)}</textarea></label><label class="field">历史反馈<textarea readonly>${escape(round.feedback || round.userFeedback)}</textarea></label><label class="field">历史诊断<textarea readonly>${escape(round.diagnosis)}</textarea></label><label class="field">历史提示词<textarea readonly>${escape(round.prompt)}</textarea></label>
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
          if (f.materials.length >= 3) { f.error = '本轮最多添加3份材料，剩余文件未添加'; break; }
          const name = String(file?.name || '未命名文件').slice(0, 160);
          const extension = name.includes('.') ? name.split('.').at(-1).toLowerCase() : '';
          if (['txt', 'md', 'csv', 'json'].includes(extension)) {
            if (Number(file.size) > 2 * 1024 * 1024) {
              const message = `${name} 超过2MB，未读取`;
              f.materials.push({ id: newMaterialId(), title: name, purpose: 'content', excerpt: '', sourceType: 'unread-file-reference', origin: 'file-import',
                contentStatus: 'failed', contentError: message, originalLength: Number(file.size), attachmentRequired: true, kind: 'material' });
              f.error = message;
              continue;
            }
            try {
              if (typeof file.text !== 'function') throw new Error('当前环境无法读取此文件');
              const content = await file.text();
              if (typeof content !== 'string') throw new Error('文件没有可读取的文本');
              f.materials.push({ id: newMaterialId(),
                title: name, purpose: 'content', excerpt: content.slice(0, 1200), sourceType: 'text-file', origin: 'file-import',
                contentStatus: content.length > 1200 ? 'truncated' : 'embedded', originalLength: content.length,
                attachmentRequired: content.length > 1200, kind: 'material' });
            } catch (error) {
              const message = String(error.message || error);
              f.materials.push({ id: newMaterialId(), title: name, purpose: 'content', excerpt: '', sourceType: 'unread-file-reference', origin: 'file-import',
                contentStatus: 'failed', contentError: message, originalLength: 0, attachmentRequired: true, kind: 'material' });
              f.error = `${name} 读取失败，只保留了文件名引用：${message}`;
            }
          } else if (['pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
            const material = { id: newMaterialId(), title: name, purpose: 'content', excerpt: '', sourceType: 'unread-file-reference', origin: 'file-import',
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
            f.materials.push({ id: newMaterialId(), title: name, purpose: 'content', excerpt: '', sourceType: 'unread-file-reference', origin: 'file-import',
              contentStatus: 'unsupported', contentError: message, originalLength: 0, attachmentRequired: true, kind: 'material' });
            f.error = message;
          }
        }
      } finally {
        if (activeMaterialJob === job) {
          activeMaterialJob = null;
          processingMaterials = false;
          f.dirty = [...new Set([...f.dirty, 'materials'])];
          render();
        }
      }
    }
    async function operate(action, data = {}) {
      if (action === 'wizard-stage') {
        const next = Number(data.stage);
        const w = workspace(articleId);
        const hasPrompts = !!(w?.rounds || []).some(round => (round.promptVersions || []).length);
        if (next === 1 || w && next >= 2 && next <= 3 || next === 4 && w && hasPrompts) { writingStage = next; render(); }
        return;
      }
      if (action === 'open-history') {
        const advanced = document.getElementById('writing-advanced');
        if (advanced) advanced.open = true;
        document.getElementById('writing-history')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (action === 'new') { activeMaterialJob?.controller.abort(); webReadResults.clear(); if (articleId) coordinator.cancelResearch(articleId); articleId = ''; render(); return; }
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
          writingStage = 2;
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
          writingStage = 3;
        } else if (action === 'save') await coordinator.setSaveEnabled(id, f.saveEnabled);
        else if (action === 'delete-article') {
          if (!await confirm('确认删除整篇文章及所有轮次、稿件和反馈？取消会保留全部历史。')) return;
          await coordinator.deleteArticle(id, { confirmed: true }); drafts.delete(id);
          if (articleId === id) { articleId = ''; writingStage = 1; }
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
    mount.addEventListener('input', event => capture(event.target));
    mount.addEventListener('change', async event => {
      const target = event.target;
      if (target.dataset?.coverageInclude) {
        const preview = coveragePreview.get(articleId);
        const item = preview?.items.find(entry => entry.id === target.dataset.coverageInclude);
        if (item) item.included = target.checked;
        render();
      }
      else if (target.id === 'writing-material-files') { await importMaterialFiles(target.files); target.value = ''; }
      else if (target.id === 'writing-article-list') { if (articleId && articleId !== target.value) coordinator.cancelResearch(articleId); activeMaterialJob?.controller.abort(); webReadResults.clear(); articleId = target.value; render(); }
      else if (target.id === 'writing-genre' && !articleId) {
        // 文体输入框失焦时若整块重绘，会替换用户正要输入的下一个控件；
        // 先记录选择，创建后再按新文体绘制专属字段与任务。
        capture(target);
      }
      else if (target.id === 'writing-save') { form().saveEnabled = target.checked; await operate('save'); }
      else if (target.dataset?.materialField === 'selectedForPrompt') {
        const material = form().materials[Number(target.dataset.materialIndex)];
        if (material) material.selectedForPrompt = target.checked;
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
    return { render, openArticle(id) { if (articleId && articleId !== id) coordinator.cancelResearch(articleId); activeMaterialJob?.controller.abort(); webReadResults.clear(); articleId = id || ''; writingStage = articleId ? 2 : 1; render(); },
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
        writingStage = articleId ? 2 : 1;
        render();
      } };
  }
  return { createWritingWorkbenchUI };
});
