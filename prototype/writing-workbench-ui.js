(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./writing-workbench-schema.js'));
  else root.WritingWorkbenchUI = factory(root.WritingWorkbenchSchema);
})(typeof globalThis === 'undefined' ? this : globalThis, function (schema) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const lines = value => String(value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const articleConfig = schema.getWritingGenreConfig('article');
  const scopeLabels = { general: '通用', genre: articleConfig.name, article: '仅本篇' };
  const sourceLabels = { temporary: '临时判断', sample: '样本提炼', user: '用户指定', 'user-corrected': '用户纠正', mixed: '样本与用户要求' };
  const confidenceLabels = { low: '低', medium: '中', high: '高' };
  const verificationLabels = { unverified: '未核验', 'source-reviewed': '已核对来源', 'user-confirmed': '用户确认' };

  function createWritingWorkbenchUI({ document, coordinator, getState, copyText, confirm = message => globalThis.confirm(message), notify } = {}) {
    const mount = document?.getElementById('writing-workbench-root');
    if (!mount || !coordinator || typeof getState !== 'function') throw new TypeError('写作工作台缺少必要依赖');
    const drafts = new Map();
    const busy = new Set();
    let articleId = '';
    let managerOpen = false;
    const memoryDrafts = new Map();
    const state = () => getState() || {};
    const workspace = id => id ? coordinator.getWorkspace(id) : null;

    function form(id = articleId) {
      if (!drafts.has(id)) {
        const w = workspace(id);
        const a = w?.article || {};
        const round = w?.rounds.at(-1);
        drafts.set(id, {
          title: a.title || '', genre: w ? schema.getWritingGenreConfig(a.genre)?.name || a.genre || '未支持文体' : articleConfig.name,
          goal: a.goal || '', audience: a.audience || '', platform: a.platform || '',
          success: (a.successCriteria || []).join('\n'), preserve: (a.preserveItems || []).join('\n'), constraints: a.constraints || '',
          dimensions: a.dimensions || [], draft: round?.draft || '', newDraft: '', feedback: '', preference: '', example: '', counterexample: '',
          scope: 'general', corrections: w?.styleProfile.userCorrections || '', materials: round ? references(round) : [],
          prompt: round?.prompt || '', diagnosis: round?.diagnosis || '', saveEnabled: a.saveEnabled === true,
          historyId: '', error: '', notifications: [], dirty: [],
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
      return { title: f.title, goal: f.goal, audience: f.audience, platform: f.platform,
        successCriteria: lines(f.success), preserveItems: lines(f.preserve), constraints: f.constraints, dimensions: f.dimensions };
    }
    function roundInput(f, draft, id) {
      const previousCorrections = id ? workspace(id).styleProfile.userCorrections : '';
      return { draft, feedback: f.feedback,
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
    function render() {
      const f = form();
      const w = workspace(articleId);
      const config = w ? schema.getWritingGenreConfig(w.article.genre) : articleConfig;
      const dimensions = config?.checkDimensions || [];
      const labels = config?.targetFields || articleConfig.targetFields;
      const locked = busy.has(articleId);
      const articles = coordinator.listArticles();
      mount.innerHTML = `<section class="social-panel">
        <div class="social-tools"><h2>写作工作台</h2>${button('new', '新建文章')}${button('manage-memories', managerOpen ? '收起记忆管理' : '管理全部写作记忆')}</div>
        <label class="field" for="writing-article-list"><span class="field-label">文章列表</span><select id="writing-article-list"><option value="">新文章</option>${articles.map(a => `<option value="${escape(a.id)}" ${a.id === articleId ? 'selected' : ''}>${escape(a.title || a.goal || '未命名文章')}</option>`).join('')}</select></label>
        <div class="social-form-grid">${field('title', escape(labels.title), f.title, { input: true })}${field('genre', `文体（首版支持${escape(articleConfig.name)}）`, f.genre, { input: true })}</div>
        ${field('goal', escape(labels.goal), f.goal)}<div class="social-form-grid">${field('audience', escape(labels.audience), f.audience, { input: true })}${field('platform', escape(labels.platform), f.platform, { input: true })}</div>
        <div class="social-form-grid">${field('success', `${escape(labels.successCriteria)}（每行一项）`, f.success)}${field('preserve', `${escape(labels.preserveItems)}（每行一项）`, f.preserve)}</div>${field('constraints', `${escape(labels.constraints)}（最多500字）`, f.constraints)}
        ${config ? `<details><summary>${escape(config.name)}检查依据</summary><p>适用：${escape(config.applicability)}</p><p>风险：${escape(config.riskReminders.join('；'))}</p><p>风格建议（低于当前要求、样本/用户更正和适用记忆）：${escape(config.styleBaseline.join('；'))}</p></details>` : '<p>当前文体暂无专用检查依据，请确认是否按普通文章处理。</p>'}
        <fieldset class="writing-dimensions"><legend>诊断维度（可选；不选按全部${dimensions.length}项初检）</legend>${dimensions.map((d, i) => `<label><input id="writing-dimension-${i}" type="checkbox" data-writing-dimension="${escape(d)}" ${f.dimensions.includes(d) ? 'checked' : ''}>${escape(d)}</label>`).join('')}</fieldset>
        ${field('draft', w ? '当前稿件（只读；新稿从下方带回）' : '初稿（可选）', f.draft, { readOnly: !!w })}
        <div class="social-tools">${button(w ? 'update' : 'create', w ? '更新目标并本地初检' : '新建并本地初检', '', locked)}${w ? button('build', '重新本地初检', '', locked) : ''}</div>
        <label class="check-row"><input id="writing-save" type="checkbox" ${f.saveEnabled ? 'checked' : ''} ${!w || locked ? 'disabled' : ''}>开启本机保存</label>
        <p class="social-muted">默认不保存正文。开启后稿件、反馈和轮次保存在本机；发送模型仍须查看发送预览并确认。</p>
        <p id="writing-save-status" role="status">${escape(persistenceStatus(w))}</p>
        <p id="writing-error" role="alert">${escape(f.error)}</p>${locked ? '<p role="status">正在处理当前文章…</p>' : ''}
        ${w ? button('delete-article', '删除整篇及所有轮次', '', locked) : ''}
      </section>
      <section class="social-panel"><h2>参考材料与风格</h2><p class="social-muted">内容 / 风格 / 两者合计最多3份。风格样本只提供提炼特征，不把原文观点作为文章内容。材料编辑在新建或下一轮时应用。</p>
        ${renderMaterials(f)}<div class="social-tools">${button('add-material', '添加材料', '', f.materials.length >= 3)}${button('select-materials', '选择本地资料', '', !w || locked)}</div>
        ${renderStyle(w)}${field('style-corrections', '用户纠正（最多2000字）', f.corrections, { name: 'corrections' })}${button('correct-style', '应用风格纠正', '', !w || locked)}
        ${renderResearch(w, f, locked)}
      </section>
      <section class="social-panel"><h2>本轮初检与下一轮提示词</h2><p class="social-muted">可编辑后复制；编辑副本不会覆盖历史轮次。模型诊断只分析并给提示词，不直接改写文章。正文和反馈可能离开本机，发送前仍需确认。</p>
        ${field('diagnosis', '具体诊断（本地初检不等于模型判断）', f.diagnosis)}${button('copy-diagnosis', '复制诊断')}
        ${field('prompt', '下一轮提示词', f.prompt)}<div class="social-tools">${button('copy-prompt', '复制提示词')}${button('model', '预览并请求模型诊断', '', !w || locked)}</div>
      </section>
      <section class="social-panel"><h2>带回外部新稿与反馈</h2>${field('new-draft', '外部 AI 新稿', f.newDraft, { name: 'newDraft' })}${field('feedback', '本轮反馈（不会自动变成长久偏好）', f.feedback)}
        <h3>可选偏好候选</h3><p class="social-muted">只统计你在下方明确填写的候选；两篇不同文章重复时可晋升，并提供撤销。</p>
        ${field('preference', '偏好候选（可编辑）', f.preference)}<div class="social-form-grid">${field('example', '例句', f.example)}${field('counterexample', '反例', f.counterexample)}</div>
        ${button('append', '回带并新增同篇一轮', '', !w || locked)}
        <label class="field" for="writing-memory-scope"><span class="field-label">显式记忆范围</span><select id="writing-memory-scope" data-writing-field="scope">${Object.entries(scopeLabels).map(([value, label]) => `<option value="${value}" ${f.scope === value ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select></label>
        ${button('remember', '记住这个偏好', '', !w || locked)}${renderNotifications(f)}
      </section>
      ${renderHistory(w, f)}${renderMemories(w)}`;
    }
    function renderMaterials(f) {
      return f.materials.map((m, i) => `<div class="writing-material"><h3>材料 ${i + 1}</h3>
        <label class="field">标题<input id="writing-material-${i}-title" data-material-index="${i}" data-material-field="title" value="${escape(m.title)}"></label>
        <label class="field">用途<select id="writing-material-${i}-purpose" data-material-index="${i}" data-material-field="purpose" data-material-purpose="${i}">${[['content', '内容'], ['style', '风格'], ['both', '两者']].map(([value, label]) => `<option value="${value}" ${m.purpose === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="field">摘要或样本（最多1200字）<textarea id="writing-material-${i}-excerpt" data-material-index="${i}" data-material-field="excerpt">${escape(m.excerpt)}</textarea></label>
        ${m.url && /^https?:\/\//i.test(m.url) ? `<a href="${escape(m.url)}" target="_blank" rel="noreferrer">来源</a>` : ''}${m.kind === 'source' ? `<p>来源核验：${escape(verificationLabels[m.verificationStatus] || '未核验')}</p>` : ''}
        ${button('remove-material', '移除材料', `data-index="${i}"`)}</div>`).join('');
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
      return `<section class="social-panel"><h2>轮次回看（只读副本）</h2><div class="social-tools">${w.rounds.map((r, i) => button('round', `第${i + 1}轮`, `data-round-id="${escape(r.id)}"`)).join('')}</div>${round ? `<label class="field">历史原稿<textarea id="writing-history-draft" readonly>${escape(round.draft)}</textarea></label><label class="field">历史反馈<textarea readonly>${escape(round.feedback || round.userFeedback)}</textarea></label><label class="field">历史诊断<textarea readonly>${escape(round.diagnosis)}</textarea></label><label class="field">历史提示词<textarea readonly>${escape(round.prompt)}</textarea></label>` : '<p>选择一个轮次查看，不会替换当前表单。</p>'}</section>`;
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
      if (d.writingField && !target.readOnly) { f[d.writingField] = target.value; f.dirty = [...new Set([...f.dirty, d.writingField])]; }
      if (d.writingDimension) { f.dimensions = target.checked ? [...new Set([...f.dimensions, d.writingDimension])] : f.dimensions.filter(v => v !== d.writingDimension); f.dirty = [...new Set([...f.dirty, 'dimensions'])]; }
      if (d.materialField && f.materials[Number(d.materialIndex)]) { f.materials[Number(d.materialIndex)][d.materialField] = target.value; f.dirty = [...new Set([...f.dirty, 'materials'])]; }
      if (d.memoryField) { const m = memoryDrafts.get(d.memoryId); if (m) m[d.memoryField] = target.value; }
    }
    async function operate(action, data = {}) {
      if (action === 'new') { if (articleId) coordinator.cancelResearch(articleId); articleId = ''; render(); return; }
      if (action === 'manage-memories') { managerOpen = !managerOpen; render(); return; }
      const id = articleId;
      const f = form(id);
      if (action === 'cancel-research') { coordinator.cancelResearch(id); render(); return; }
      if (action === 'round') { f.historyId = data.roundId; render(); return; }
      if (action === 'add-material') { if (f.materials.length < 3) f.materials.push({ title: '', excerpt: '', purpose: 'content', kind: 'material' }); render(); return; }
      if (action === 'remove-material') { f.materials.splice(Number(data.index), 1); render(); return; }
      if (action === 'copy-prompt' || action === 'copy-diagnosis') {
        try { await copyText?.(f[action === 'copy-prompt' ? 'prompt' : 'diagnosis']); }
        catch (error) { f.error = `复制失败：${error.message || error}`; render(); }
        return;
      }
      if (busy.has(id)) return;
      const submitted = clone(f);
      busy.add(id); f.error = ''; render();
      try {
        if (action === 'create') {
          let confirmAsArticle = false;
          const genre = [articleConfig.name, 'article', ''].includes(f.genre.trim()) ? 'article' : f.genre;
          if (genre !== 'article') {
            confirmAsArticle = await confirm('当前仅支持普通文章。确认将当前文体按普通文章处理？');
            if (!confirmAsArticle) return;
          }
          const memoryIds = new Set((state().writingMemories || []).map(m => m.id));
          const w = await coordinator.createArticle({ ...articlePatch(submitted), ...roundInput(submitted, submitted.draft, ''), genre, confirmAsArticle });
          drafts.delete(''); drafts.set(w.id, f);
          if (articleId === '') articleId = w.id;
          f.genre = articleConfig.name; updateOutputs(f, w.rounds.at(-1), submitted);
          acknowledge(f, submitted, ['title', 'goal', 'audience', 'platform', 'success', 'preserve', 'constraints', 'dimensions', 'materials', 'corrections', 'draft']);
          for (const m of state().writingMemories || []) {
            if (!memoryIds.has(m.id) && m.undo?.action === 'auto-promote' && !m.undo.undoneAt && m.evidenceArticleIds.includes(w.id)) {
              f.notifications.push({ memoryId: m.id, message: '已记住跨文章重复偏好，可撤销' });
            }
          }
        } else if (action === 'update' || action === 'build') {
          const w = await coordinator.updateArticle(id, articlePatch(submitted));
          updateOutputs(f, w.rounds.at(-1), submitted);
          acknowledge(f, submitted, ['title', 'goal', 'audience', 'platform', 'success', 'preserve', 'constraints', 'dimensions']);
        } else if (action === 'append') {
          try { await coordinator.updateArticle(id, articlePatch(submitted)); }
          catch (error) {
            // 旧失败轮可能超长；目标已更新后允许精简新稿绕过旧轮，原文仍留会话。
            if (!(error instanceof RangeError) || !submitted.newDraft.trim()) throw error;
          }
          const result = await coordinator.appendRound(id, roundInput(submitted, submitted.newDraft || submitted.draft, id));
          f.draft = result.round.draft;
          updateOutputs(f, result.round, submitted);
          f.notifications.push(...result.notifications);
          acknowledge(f, submitted, ['title', 'goal', 'audience', 'platform', 'success', 'preserve', 'constraints', 'dimensions', 'materials', 'corrections']);
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
        f.error = error.message || '操作失败，输入已保留';
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
      if (target.id === 'writing-article-list') { if (articleId && articleId !== target.value) coordinator.cancelResearch(articleId); articleId = target.value; render(); }
      else if (target.id === 'writing-save') { form().saveEnabled = target.checked; await operate('save'); }
      else capture(target);
    });
    mount.addEventListener('click', event => {
      const target = event.target.closest('[data-writing-action]');
      if (!target || target.disabled) return;
      event.preventDefault();
      return operate(target.dataset.writingAction, target.dataset);
    });
    render();
    return { render, openArticle(id) { if (articleId && articleId !== id) coordinator.cancelResearch(articleId); articleId = id || ''; render(); },
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
