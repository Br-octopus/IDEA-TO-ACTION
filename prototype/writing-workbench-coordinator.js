(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(
    require('./writing-workbench-schema.js'), require('./writing-workbench-prompts.js'));
  else root.WritingWorkbenchCoordinator = factory(root.WritingWorkbenchSchema, root.WritingWorkbenchPrompts);
})(typeof globalThis === 'undefined' ? this : globalThis, function (schema, prompts) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  const key = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu, '');
  let sequence = 0;
  const newId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`}`;
  function failure(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }

  // 变更方法返回 Promise；读取方法返回副本。持久化回调应返回实际写入的 state。
  function createWritingWorkbenchCoordinator(dependencies = {}) {
    const getState = dependencies.getState || (() => ({}));
    const sessions = new Map();
    const memories = new Map();
    const modelRuns = new Map();
    const researchRuns = new Map();
    const researchStates = new Map();
    const pendingMemories = new Set();
    const sessionVersions = new WeakMap();
    const deleting = new WeakSet();
    const failedRounds = new WeakSet();
    let persistence = Promise.resolve();
    function state() { return getState() || {}; }
    function loadMemories() {
      for (const item of state().writingMemories || []) {
        const memory = schema.normalizeWritingMemory(item);
        if (memory.id) memories.set(memory.id, memory);
      }
    }
    loadMemories();
    function workspace(id) {
      if (!sessions.has(id)) {
        const saved = (state().writingArticles || []).find(item => item.id === id);
        if (!saved) throw failure('ARTICLE_NOT_FOUND', '文章不存在', { articleId: id });
        const w = schema.normalizeWritingWorkspace(saved);
        sessions.set(id, w);
        sessionVersions.set(w, {});
      }
      const w = sessions.get(id);
      if (deleting.has(w)) throw failure('STALE_RESULT', '文章正在删除', { articleId: id });
      return w;
    }
    function roundFor(id, roundId) {
      const w = workspace(id);
      const round = roundId ? w.rounds.find(r => r.id === roundId) : w.rounds.at(-1);
      if (!round) throw failure('ROUND_NOT_FOUND', '轮次不存在', { articleId: id, roundId });
      return round;
    }
    function assertCurrent(w, version) {
      if (sessions.get(w.id) !== w || deleting.has(w) || sessionVersions.get(w) !== version) {
        throw failure('STALE_RESULT', '文章已删除或刷新', { articleId: w.id });
      }
    }
    function invalidateModels(w) { for (const round of w.rounds) modelRuns.delete(round.id); }
    function persist(change, details = {}, validate = () => {}) {
      const operation = persistence.then(async () => {
        // 到实际执行时再校验，排队快照不能越过删除或导入边界。
        validate();
        let result;
        try {
          if (typeof dependencies.persistState !== 'function') throw new Error('未配置本地保存方法');
          result = await dependencies.persistState(change(copy(state())));
          if (result?.error || result?.warning || result === false) throw new Error(result?.error?.message || result?.warning?.message || '保存未完成');
        } catch (cause) {
          throw failure('PERSIST_FAILED', `保存失败：${cause.message || cause}`, { ...details, cause });
        }
        // 只验证结果，不用规范化后的磁盘快照替换 sessions。
        validate();
        return result;
      });
      persistence = operation.catch(() => {});
      return operation;
    }
    async function saveWorkspace(w) {
      if (!w.article.saveEnabled) return;
      const version = sessionVersions.get(w);
      const validate = () => { assertCurrent(w, version); validateInput(w, w.rounds.at(-1)); };
      validate();
      const snapshot = copy(w);
      // 失败轮原文只留会话；用户提交精简新轮后可恢复保存，不落盘截断的旧输入。
      snapshot.rounds = snapshot.rounds.filter((_, i) => !failedRounds.has(w.rounds[i]));
      const savedIds = new Set();
      let parentId = '';
      for (const round of snapshot.rounds) {
        if (!savedIds.has(round.parentRoundId)) round.parentRoundId = parentId;
        savedIds.add(round.id); parentId = round.id;
      }
      await persist(s => ({ ...s, writingArticles: [...(s.writingArticles || []).filter(a => a.id !== w.id), snapshot] }), { articleId: w.id }, validate);
    }
    async function saveMemory(memory) {
      pendingMemories.add(memory.id);
      const snapshot = copy(memory);
      await persist(s => ({ ...s, writingMemories: [...(s.writingMemories || []).filter(m => m.id !== memory.id), snapshot] }), { memoryId: memory.id });
      pendingMemories.delete(memory.id);
    }
    function getWorkspace(id) { return copy(workspace(id)); }
    function listArticles() {
      const all = new Map((state().writingArticles || []).map(w => [w.id, w]));
      for (const [id, w] of sessions) all.set(id, w);
      return [...all.values()].map(w => copy(w.article));
    }
    function getRelevantMemories(genre = 'article', articleId) {
      const config = schema.getWritingGenreConfig(genre);
      const priority = { article: 0, genre: 1, general: 2 };
      return [...memories.values()].filter(m => m.preference && !m.undo?.undoneAt && (
        m.scope === 'general' || config && (m.scope === 'genre' && m.genre === config.memoryNamespace
          || m.scope === 'article' && m.articleId === articleId)
      )).sort((a, b) => priority[a.scope] - priority[b.scope] || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 3).map(copy);
    }
    function inputFor(w, round) { return { ...w, round, memories: getRelevantMemories(w.genre, w.id) }; }
    function validateProfile(profile, articleId) {
      if (!profile) return;
      if (profile.scope && !['general', 'genre', 'article'].includes(profile.scope)
        || profile.scope === 'genre' && profile.genre !== 'article'
        || profile.scope === 'article' && profile.articleId && profile.articleId !== articleId) {
        throw failure('STYLE_SCOPE_INVALID', '风格档案不适用于当前普通文章', { articleId });
      }
    }
    function derive(w, round, corrections) {
      const previous = w.styleProfile;
      const samples = [...round.materials, ...round.sources];
      const hasSamples = samples.some(m => ['style', 'both'].includes(m.purpose) && m.excerpt);
      const derived = prompts.deriveWritingStyleProfile(samples, { userCorrections: corrections ?? previous.userCorrections });
      assignProfile(w, { ...(hasSamples ? derived : previous),
        userCorrections: corrections ?? previous.userCorrections,
        ...(corrections !== undefined ? { source: 'user-corrected' } : {}),
        scope: 'article', genre: 'article', updatedAt: now() });
    }
    function references(input) {
      const r = schema.normalizeWritingRound(input);
      r.materials = r.materials.slice(0, 3);
      r.sources = r.sources.slice(0, 3 - r.materials.length);
      return { materials: r.materials, sources: r.sources };
    }
    function applyProfile(w, profile) {
      const next = { ...w.styleProfile, ...schema.normalizeWritingStyleProfile(profile) };
      for (const field of Object.keys(w.styleProfile)) if (!Object.hasOwn(profile, field)) next[field] = w.styleProfile[field];
      // 更正属于强约束，不能先截断再把生成结果当作成功。
      if (typeof profile.userCorrections === 'string') next.userCorrections = profile.userCorrections;
      assignProfile(w, next);
    }
    function assignProfile(w, profile) {
      const comparable = p => JSON.stringify({ ...p, updatedAt: '' });
      if (comparable(w.styleProfile) !== comparable(profile)) invalidateModels(w);
      w.styleProfile = profile;
    }
    function validateInput(w, round) {
      // schema 会截断文字；对硬约束先报错，保留会话中的完整输入供用户精简。
      for (const [text, limit] of [[w.article.constraints, 500], [w.styleProfile.userCorrections, 2000],
        [round.feedback, 2000], [round.userFeedback, 2000], [round.draft, 8000]]) {
        if (String(text || '').length > limit) throw new RangeError(`输入超过${limit}字，请精简后重试；原输入保留在会话中`);
      }
      validateProfile(w.styleProfile, w.id);
    }

    const researchMethods = [
      '普通文章如何减少空泛总结并保留具体证据',
      '普通文章如何组织清晰结构和段落推进',
      '普通文章如何保持自然表达并避免模板化语气'
    ];
    function researchState(w) {
      return researchStates.get(w.id) || w.article.research || { status: 'idle' };
    }
    function writeResearchState(w, next) {
      const safe = copy(next);
      researchStates.set(w.id, safe);
      return safe;
    }
    function invalidateResearch(w, status = 'cancelled') {
      const run = researchRuns.get(w.id);
      if (run) { run.invalidated = true; run.controller.abort(); researchRuns.delete(w.id); }
      if (status === 'cancelled' && ['running', 'awaiting-confirmation'].includes(researchState(w).status)) {
        writeResearchState(w, { ...researchState(w), status });
      }
    }
    function researchKeywords(value) {
      const keywords = String(value || '').trim();
      if (!keywords) return '';
      if (keywords.length > 40 || !/^[\p{L}\p{N} -]+$/u.test(keywords)) {
        throw failure('INVALID_RESEARCH_KEYWORDS', '搜索关键词最多40字，仅限文字、数字、空格和短横线；请勿填写敏感信息');
      }
      return keywords;
    }
    function researchScope(method, keywords) {
      const suffix = keywords ? ` ${keywords}` : '';
      return {
        objective: `为普通文章提供可核验的写作方法线索：${method}`,
        queries: [`site:github.com ${method} skill${suffix}`, `${method} 写作方法${suffix}`, `${method} 案例${suffix}`],
        sourceTypes: ['web', 'github'],
        platforms: [],
        budget: { maxQueries: 3, maxSources: 5 }
      };
    }
    function assertResearchCurrent(w, run) {
      assertCurrent(w, run.version);
      if (researchRuns.get(w.id) !== run || run.invalidated || run.controller.signal.aborted || w.rounds.at(-1) !== run.round) {
        throw failure('RESEARCH_CANCELLED', '搜索结果已过期或已取消', { articleId: w.id });
      }
    }
    function mergeResearchSources(round, result) {
      const sources = (Array.isArray(result?.results) ? result.results : []).slice(0, 5).map(item => ({
        title: item.title || '未命名来源', url: item.url || '',
        excerpt: `公开线索（未验证，不升级为个人记忆）；适用：${item.applicability || '普通文章，需结合原文判断'}；局限：${item.limitations || '搜索摘要未经独立核验'}；摘要：${String(item.summary || '').slice(0, 600)}`,
        purpose: 'content', verificationStatus: 'unverified', origin: 'public-research'
      })).filter(item => item.url);
      // 手工及风格来源不可挤掉；自动内容来源为本次公开线索至少留一个名额。
      const protectedSources = round.sources.filter(s => ['style', 'both'].includes(s.purpose) || !s.origin);
      const automatic = round.sources.filter(s => !protectedSources.includes(s));
      const slots = Math.max(0, 3 - round.materials.length - protectedSources.length);
      const seen = new Set(protectedSources.map(s => s.url).filter(Boolean));
      const incoming = sources.filter(s => !seen.has(s.url));
      const merged = [...protectedSources, ...automatic.slice(0, Math.max(0, slots - (incoming.length ? 1 : 0))), ...incoming];
      const refs = references({ materials: round.materials, sources: merged.filter(s => {
        const identity = s.url || JSON.stringify([s.title, s.excerpt, s.purpose]);
        const duplicate = merged.findIndex(m => (m.url || JSON.stringify([m.title, m.excerpt, m.purpose])) === identity);
        return merged.indexOf(s) === duplicate;
      }) });
      Object.assign(round, refs);
      const includedSources = refs.sources.filter(s => incoming.some(m => m.url === s.url)).length;
      return { ...refs, includedSources, contextNote: sources.length && !includedSources
        ? '公开摘要未纳入提示词：三份上下文已由手工材料或风格样本占用，原资料保留。'
        : `本次公开摘要纳入提示词${includedSources}份；手工材料和风格样本保留，合计最多3份。` };
    }
    function previewResearch(id, options = {}) {
      const w = workspace(id);
      const current = researchState(w);
      if (current.status === 'rejected') throw failure('RESEARCH_REJECTED', '本篇已拒绝搜索，不会重复申请');
      if (current.status === 'running') throw failure('RESEARCH_RUNNING', '搜索正在进行，请先取消');
      const method = String(options.method || researchMethods[0]).trim();
      if (!researchMethods.includes(method)) throw failure('INVALID_RESEARCH_METHOD', '只能选择固定的写作方法问题');
      const keywords = researchKeywords(options.keywords);
      invalidateResearch(w);
      const scope = researchScope(method, keywords);
      const preview = dependencies.promptAgentCoordinator?.previewExternalResearch?.(scope);
      if (!preview) throw failure('RESEARCH_UNAVAILABLE', '研究桥接服务未配置');
      researchRuns.set(id, { version: sessionVersions.get(w), round: roundFor(id), controller: new AbortController(), invalidated: false });
      return copy(writeResearchState(w, { ...preview, requestId: preview.id,
        method, keywords, sourceRange: 'GitHub 和公开网页', expectedUse: '只作普通文章写作方法线索，与本地规则合并后用于当前诊断' }));
    }
    async function approveResearch(id, confirmation = {}) {
      const w = workspace(id);
      const current = researchState(w);
      if (current.status === 'rejected') throw failure('RESEARCH_REJECTED', '本篇已拒绝搜索，不会重复申请');
      if (confirmation.confirmed !== true) throw failure('RESEARCH_CONFIRMATION_REQUIRED', '搜索前必须明确确认计划和预算');
      const requestId = current.requestId;
      if (!requestId || current.status !== 'awaiting-confirmation') throw failure('RESEARCH_PREVIEW_REQUIRED', '请先预览搜索计划');
      if (typeof dependencies.promptAgentCoordinator?.approveExternalResearch !== 'function'
        || typeof dependencies.promptAgentCoordinator?.runExternalResearch !== 'function') throw failure('RESEARCH_UNAVAILABLE', '研究桥接服务未配置');
      const run = researchRuns.get(id);
      if (!run) throw failure('RESEARCH_PREVIEW_REQUIRED', '搜索计划已失效，请重新预览');
      assertResearchCurrent(w, run);
      dependencies.promptAgentCoordinator.approveExternalResearch(requestId);
      const round = run.round;
      writeResearchState(w, { ...current, status: 'running', updatedAt: now() });
      let onAbort;
      try {
        const aborted = new Promise((_, reject) => {
          onAbort = () => reject(failure('RESEARCH_CANCELLED', '搜索已取消'));
          run.controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        assertResearchCurrent(w, run);
        const result = await Promise.race([dependencies.promptAgentCoordinator.runExternalResearch(requestId, { signal: run.controller.signal }), aborted]);
        assertResearchCurrent(w, run);
        const refs = mergeResearchSources(round, result);
        const status = result.status || (result.results?.length ? 'complete' : 'failed');
        writeResearchState(w, { ...current, status, results: result.results || [], contextNote: refs.contextNote,
          error: result.errors?.map(e => e.message).join('；') || '', usedQueries: result.usedQueries, usedSources: result.usedSources });
        if (refs.includedSources) generate(w, round);
        assertResearchCurrent(w, run);
        await saveWorkspace(w);
        return copy({ ...result, status, articleId: id, roundId: round.id, ...refs });
      } catch (error) {
        if (error.code === 'PERSIST_FAILED') throw error;
        if (['RESEARCH_CANCELLED', 'STALE_RESULT'].includes(error.code) || run.controller.signal.aborted) {
          return { status: 'cancelled', articleId: id, roundId: round.id, results: [], errors: [] };
        }
        assertCurrent(w, run.version);
        writeResearchState(w, { ...current, status: 'failed', error: String(error.message || error), updatedAt: now() });
        return { status: 'failed', articleId: id, roundId: round.id, results: [], errors: [{ message: String(error.message || error) }] };
      } finally {
        run.controller.signal.removeEventListener('abort', onAbort);
        if (researchRuns.get(id) === run) researchRuns.delete(id);
      }
    }
    async function rejectResearch(id) {
      const w = workspace(id);
      const current = researchState(w);
      if (current.status === 'rejected') return copy(current);
      if (current.status !== 'awaiting-confirmation') throw failure('RESEARCH_PREVIEW_REQUIRED', '请先预览搜索计划');
      dependencies.promptAgentCoordinator.rejectExternalResearch(current.requestId);
      invalidateResearch(w);
      const next = writeResearchState(w, { ...current, status: 'rejected', updatedAt: now() });
      w.article.research = { status: 'rejected' };
      if (w.article.saveEnabled) await saveWorkspace(w);
      return copy(next);
    }
    function cancelResearch(id) {
      const w = workspace(id);
      const run = researchRuns.get(id);
      if (!run) return false;
      invalidateResearch(w);
      return true;
    }
    function getResearchState(id) { return copy(researchState(workspace(id))); }
    function generate(w, round, refreshDiagnosis = false) {
      validateInput(w, round);
      const input = inputFor(w, round);
      const localDiagnosis = prompts.buildLocalWritingDiagnosis(input);
      const isLocal = round.diagnosis.startsWith(`${localDiagnosis.label}\n`);
      const diagnosis = (!refreshDiagnosis && !isLocal && round.diagnosis) || `${localDiagnosis.label}\n${localDiagnosis.dimensions.map(d =>
        `${d.name}：${d.findings.length ? d.findings.map(f => `${f.quote}：${f.observation}；${f.direction}`).join('；') : d.note}`).join('\n')}`;
      const prompt = prompts.buildWritingRevisionPrompt({ ...input, round: { ...round, diagnosis } });
      round.diagnosis = diagnosis;
      round.prompt = prompt;
      failedRounds.delete(round);
      if (refreshDiagnosis) modelRuns.delete(round.id);
      return { localDiagnosis, diagnosis, prompt };
    }
    async function build(id, options = {}) {
      const w = workspace(id);
      const round = roundFor(id, options.roundId);
      const result = generate(w, round, true);
      await saveWorkspace(w);
      return copy({ articleId: id, roundId: round.id, ...result });
    }
    async function createArticle(input = {}) {
      if (input.genre && input.genre !== 'article' && input.confirmAsArticle !== true) {
        throw failure('GENRE_CONFIRMATION_REQUIRED', '当前仅支持普通文章，请明确确认按普通文章处理');
      }
      const id = newId('article');
      validateProfile(input.styleProfile, id);
      const article = schema.normalizeWritingArticle({ ...input, id, genre: 'article', saveEnabled: false, createdAt: now(), updatedAt: now() });
      if (typeof input.constraints === 'string') article.constraints = input.constraints;
      const w = { id, genre: 'article', article, rounds: [], styleProfile: prompts.deriveWritingStyleProfile([], {}) };
      if (input.styleProfile) applyProfile(w, input.styleProfile);
      sessions.set(id, w);
      sessionVersions.set(w, {});
      try {
        await appendRound(id, input);
        if (input.saveEnabled === true) await setSaveEnabled(id, true);
      } catch (error) { error.articleId = id; throw error; }
      return getWorkspace(id);
    }
    async function updateArticle(id, patch = {}) {
      const w = workspace(id);
      if (patch.genre && patch.genre !== 'article') throw failure('GENRE_CONFIRMATION_REQUIRED', '当前文章仅支持普通文章');
      validateProfile(patch.styleProfile, id);
      const save = patch.saveEnabled;
      if (save !== undefined && typeof save !== 'boolean') throw failure('INVALID_INPUT', '保存开关必须为布尔值');
      if (save === false) await setSaveEnabled(id, false);
      const normalized = schema.normalizeWritingArticle(patch);
      // 只清洗这次提交的白名单字段，未改的失败原文继续留在会话供用户修正。
      for (const field of Object.keys(normalized)) {
        if (Object.hasOwn(patch, field) && !['id', 'genre', 'createdAt', 'updatedAt', 'saveEnabled'].includes(field)) w.article[field] = normalized[field];
      }
      w.article.updatedAt = now();
      invalidateModels(w);
      if (typeof patch.constraints === 'string') w.article.constraints = patch.constraints;
      if (patch.styleProfile) applyProfile(w, patch.styleProfile);
      if (Object.hasOwn(patch, 'draft')) {
        await appendRound(id, { draft: patch.draft });
      } else {
        generate(w, roundFor(id), true);
        await saveWorkspace(w);
      }
      if (save === true && !w.article.saveEnabled) await setSaveEnabled(id, true);
      return getWorkspace(id);
    }
    async function appendRound(id, input = {}) {
      const w = workspace(id);
      invalidateResearch(w);
      validateProfile(input.styleProfile, id);
      const previous = w.rounds.at(-1);
      const round = schema.normalizeWritingRound({ ...input, ...references(input), id: newId('round'), articleId: id,
        parentRoundId: previous?.id || '', draft: input.draft ?? w.article.draft, diagnosis: '', prompt: '', createdAt: now(), updatedAt: now() });
      // 用户的原始强约束和正文不能在生成失败时被规范化截掉。
      for (const field of ['draft', 'feedback', 'userFeedback']) if (typeof input[field] === 'string') round[field] = input[field];
      if (input.draft === undefined) round.draft = w.article.draft;
      w.rounds.push(round);
      failedRounds.add(round);
      w.article.draft = round.draft;
      w.article.updatedAt = now();
      if (input.styleProfile) applyProfile(w, input.styleProfile);
      derive(w, round, input.userCorrections);
      generate(w, round);
      await saveWorkspace(w);
      const notifications = await promotePreferences();
      return copy({ articleId: id, round, notifications });
    }
    async function setSaveEnabled(id, enabled) {
      if (typeof enabled !== 'boolean') throw failure('INVALID_INPUT', '保存开关必须为布尔值');
      const w = workspace(id);
      const version = sessionVersions.get(w);
      w.article.saveEnabled = enabled;
      if (enabled) { generate(w, roundFor(id)); await saveWorkspace(w); }
      else await persist(s => ({ ...s, writingArticles: (s.writingArticles || []).map(item => item.id === id
        ? { ...item, article: { ...item.article, saveEnabled: false } } : item) }), { articleId: id }, () => assertCurrent(w, version));
      return getWorkspace(id);
    }
    async function deleteArticle(id, options = {}) {
      if (options.confirmed !== true) throw failure('CONFIRMATION_REQUIRED', '删除整篇文章需要明确确认', { articleId: id });
      const w = workspace(id);
      invalidateResearch(w);
      const version = {};
      sessionVersions.set(w, version);
      deleting.add(w);
      invalidateModels(w);
      const validate = () => {
        if (sessions.get(id) !== w || sessionVersions.get(w) !== version) throw failure('STALE_RESULT', '文章已刷新', { articleId: id });
      };
      try {
        await persist(s => ({ ...s, writingArticles: (s.writingArticles || []).filter(item => item.id !== id) }), { articleId: id }, validate);
        sessions.delete(id);
      } finally { deleting.delete(w); }
      return { deleted: true, articleId: id };
    }
    async function correctStyleProfile(id, corrections) {
      if (typeof corrections !== 'string') throw failure('INVALID_INPUT', '风格更正必须为文字');
      const w = workspace(id);
      derive(w, roundFor(id), corrections);
      await build(id);
      return copy(w.styleProfile);
    }
    async function selectMaterials(id, options = {}) {
      const w = workspace(id);
      const round = roundFor(id, options.roundId);
      const version = sessionVersions.get(w);
      const profile = w.styleProfile;
      if (typeof dependencies.promptAgentCoordinator?.selectMaterials !== 'function') {
        throw failure('MATERIALS_UNAVAILABLE', '未配置本地资料选择器', { articleId: id });
      }
      const selected = await dependencies.promptAgentCoordinator.selectMaterials({
        goal: w.article.goal, target: w.article.audience, domain: '普通文章',
        currentState: `读者：${w.article.audience}；平台：${w.article.platform}`, allowResearch: false
      }, { stage: 'clarification' });
      assertCurrent(w, version);
      const sources = (Array.isArray(selected) ? selected : []).slice(0, 3).map(m => ({
        title: `${m.title || '参考资料'}（${m.id || m.location || '来源未提供'}）`,
        url: /^https?:\/\//i.test(m.location || '') ? m.location : '', excerpt: m.excerpt || m.summary || '',
        purpose: m.purpose || 'content', verificationStatus: m.verificationStatus || 'unverified', origin: 'local-search'
      }));
      // 手工材料和已有来源优先，重复选择同一资料不会占用额外名额。
      const merged = [...round.sources, ...schema.normalizeWritingRound({ sources }).sources];
      const seen = new Set();
      const refs = references({ materials: round.materials, sources: merged.filter(source => {
        const identity = JSON.stringify([source.title, source.url, source.excerpt, source.purpose]);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      }) });
      Object.assign(round, refs);
      if (w.rounds.at(-1) === round && w.styleProfile === profile) derive(w, round);
      generate(w, round, true);
      await saveWorkspace(w);
      return copy({ articleId: id, roundId: round.id, ...refs, prompt: round.prompt });
    }
    async function runModelDiagnosis(id, options = {}) {
      const w = workspace(id);
      const round = roundFor(id, options.roundId);
      const version = sessionVersions.get(w);
      validateInput(w, round);
      if (typeof dependencies.requestModel !== 'function') throw failure('MODEL_UNAVAILABLE', '未配置模型发送预览');
      const prompt = prompts.buildWritingDiagnosisPrompt(inputFor(w, round));
      const token = {};
      modelRuns.set(round.id, token);
      const signal = options.signal;
      let onAbort;
      let result;
      try {
        if (signal?.aborted) throw failure('MODEL_CANCELLED', '模型诊断已取消');
        const abort = new Promise((_, reject) => {
          onAbort = () => reject(failure('MODEL_CANCELLED', '模型诊断已取消'));
          signal?.addEventListener('abort', onAbort, { once: true });
        });
        result = await Promise.race([dependencies.requestModel({
          messages: [{ role: 'user', content: prompt }], signal, stage: 'writing-diagnosis', articleId: id, roundId: round.id
        }), abort]);
        if (signal?.aborted || result?.cancelled) throw failure('MODEL_CANCELLED', '模型诊断已取消');
        if (typeof result !== 'string' || !result.trim()) throw new Error('模型未返回诊断文字');
      } catch (cause) {
        if (cause.code === 'MODEL_CANCELLED' || cause.name === 'AbortError') throw failure('MODEL_CANCELLED', '模型诊断已取消', { articleId: id, roundId: round.id, cause });
        throw failure('MODEL_FAILED', `模型诊断失败：${cause.message || cause}`, {
          articleId: id, roundId: round.id, cause, diagnosisCurrent: false
        });
      } finally { signal?.removeEventListener('abort', onAbort); }
      assertCurrent(w, version);
      if (modelRuns.get(round.id) !== token || !w.rounds.includes(round)) {
        throw failure('STALE_RESULT', '诊断结果已过期', { articleId: id, roundId: round.id });
      }
      validateInput(w, round);
      const diagnosis = result.trim().slice(0, 4000);
      const nextPrompt = prompts.buildWritingRevisionPrompt({ ...inputFor(w, round), round: { ...round, diagnosis } });
      Object.assign(round, { diagnosis, prompt: nextPrompt, updatedAt: now() });
      failedRounds.delete(round);
      await saveWorkspace(w);
      return copy({ articleId: id, roundId: round.id, diagnosis, prompt: nextPrompt });
    }
    async function rememberPreference(id, input = {}) {
      workspace(id);
      if (!['general', 'genre', 'article'].includes(input.scope || 'general') || input.genre && input.genre !== 'article') {
        throw failure('INVALID_INPUT', '记忆范围必须为 general、genre(article) 或 article');
      }
      if (typeof input.preference !== 'string' || !input.preference.trim()) throw failure('INVALID_INPUT', '记忆偏好不能为空');
      const memory = schema.normalizeWritingMemory({ ...input, id: newId('memory'), scope: input.scope || 'general', genre: 'article',
        articleId: input.scope === 'article' ? id : '', sourceArticleId: id, evidenceArticleIds: [id], createdAt: now(), updatedAt: now() });
      memory.sourcePreferenceKey = key(memory.preference);
      memories.set(memory.id, memory);
      await saveMemory(memory);
      return copy(memory);
    }
    function findMemory(id) {
      const memory = memories.get(id);
      if (!memory) throw failure('MEMORY_NOT_FOUND', '记忆不存在', { memoryId: id });
      return memory;
    }
    async function editMemory(id, patch = {}) {
      const memory = findMemory(id);
      if (Object.hasOwn(patch, 'preference') && !String(patch.preference || '').trim()) throw failure('INVALID_INPUT', '记忆偏好不能为空');
      const editable = Object.fromEntries(['preference', 'reason', 'example', 'counterexample'].filter(f => Object.hasOwn(patch, f)).map(f => [f, patch[f]]));
      const sourcePreferenceKey = memory.sourcePreferenceKey || key(memory.preference);
      const updated = schema.normalizeWritingMemory({ ...memory, ...editable,
        ...(sourcePreferenceKey ? { sourcePreferenceKey } : {}), updatedAt: now() });
      memories.set(id, updated);
      await saveMemory(updated);
      return copy(updated);
    }
    async function deleteMemory(id) {
      const memory = findMemory(id);
      // 跨篇记忆删除后保留原候选墓碑；单篇删除不扩大为全局抑制。
      if (memory.scope !== 'article') {
        memory.sourcePreferenceKey ||= key(memory.preference);
        await undoMemory(id);
        return { deleted: true, memoryId: id };
      }
      await persist(s => ({ ...s, writingMemories: (s.writingMemories || []).filter(m => m.id !== id) }), { memoryId: id });
      memories.delete(id);
      return { deleted: true, memoryId: id };
    }
    async function undoMemory(id) {
      const memory = findMemory(id);
      memory.undo = { ...memory.undo, memoryId: id, undoneAt: now() };
      memory.updatedAt = now();
      await saveMemory(memory);
      return { undone: true, memoryId: id };
    }
    async function promotePreferences() {
      const all = new Map((state().writingArticles || []).map(w => [w.id, w]));
      for (const [id, w] of sessions) all.set(id, w);
      const candidates = new Map();
      for (const [id, w] of all) for (const round of w.rounds || []) for (const p of round.preferences || []) {
        const normalizedKey = key(p.preference);
        if (!normalizedKey) continue;
        if (!candidates.has(normalizedKey)) candidates.set(normalizedKey, { ...p, ids: new Set() });
        candidates.get(normalizedKey).ids.add(id);
      }
      const notifications = [];
      for (const [normalizedKey, candidate] of candidates) {
        if (candidate.ids.size < 2) continue;
        const existing = [...memories.values()].find(m => (m.scope === 'general' || m.scope === 'genre' && m.genre === 'article')
          && (key(m.preference) === normalizedKey || m.sourcePreferenceKey === normalizedKey));
        if (existing?.undo?.undoneAt) continue;
        if (existing) {
          const ids = [...new Set([...existing.evidenceArticleIds, ...candidate.ids])];
          if (ids.length !== existing.evidenceArticleIds.length || pendingMemories.has(existing.id)) {
            existing.evidenceArticleIds = ids;
            existing.updatedAt = now();
            await saveMemory(existing);
          }
          continue;
        }
        const id = newId('memory');
        const memory = schema.normalizeWritingMemory({ ...candidate, id, scope: 'genre', genre: 'article', sourcePreferenceKey: normalizedKey,
          sourceArticleId: [...candidate.ids][0], evidenceArticleIds: [...candidate.ids],
          undo: { action: 'auto-promote', memoryId: id }, createdAt: now(), updatedAt: now() });
        memories.set(id, memory);
        await saveMemory(memory);
        notifications.push({ type: 'memory-promoted', message: '已记住跨文章重复偏好，可撤销', memoryId: id, undoId: id });
      }
      return notifications;
    }
    async function refreshFromStorage(options = {}) {
      // 合并保留尚未落盘的会话，但导入前的异步结果和排队保存仍必须失效。
      for (const w of sessions.values()) invalidateResearch(w);
      if (options.preserveSessions) {
        for (const w of sessions.values()) sessionVersions.set(w, {});
      } else { sessions.clear(); researchStates.clear(); }
      modelRuns.clear();
      await persistence;
      memories.clear(); pendingMemories.clear(); loadMemories();
      return listArticles();
    }
    return { createArticle, openArticle: getWorkspace, getWorkspace, listArticles, updateArticle, appendRound,
      setSaveEnabled, deleteArticle, getRounds: id => copy(workspace(id).rounds),
      readRound: (id, roundId) => copy(roundFor(id, roundId)), correctStyleProfile,
      build, diagnose: build, runModelDiagnosis, selectMaterials, rememberPreference,
      editMemory, deleteMemory, undoMemory, getRelevantMemories, refreshFromStorage, reset: refreshFromStorage,
      previewResearch, approveResearch, rejectResearch, cancelResearch, getResearchState };
  }
  return { createWritingWorkbenchCoordinator };
});
