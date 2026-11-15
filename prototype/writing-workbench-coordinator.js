(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(
    require('./writing-workbench-schema.js'), require('./writing-workbench-prompts.js'), require('./writing-material-coverage.js'));
  else root.WritingWorkbenchCoordinator = factory(root.WritingWorkbenchSchema, root.WritingWorkbenchPrompts, root.ForwardStepWritingMaterialCoverage);
})(typeof globalThis === 'undefined' ? this : globalThis, function (schema, prompts, materialCoverage) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  const key = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu, '');
  let sequence = 0;
  const newId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`}`;
  function failure(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
  const ISSUE_CATEGORIES = new Set(['source', 'logic', 'method', 'requirement', 'preference', 'other']);
  const ISSUE_PRIORITIES = new Set(['low', 'medium', 'high']);
  const ACADEMIC_TASK_TYPES = new Set(['academic-planning', 'academic-outline', 'academic-chapter-draft', 'diagnosis', 'revision']);
  const DIAGNOSIS_ISSUE_FIELDS = new Set([
    'location', 'excerpt', 'observation', 'impact', 'evidenceCategory', 'evidenceDescription',
    'packId', 'sourceId', 'suggestion', 'priority'
  ]);

  function extractJsonDocument(raw) {
    const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!text) return null;
    try { return JSON.parse(text); } catch {}
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}' && --depth === 0) {
        try { return JSON.parse(text.slice(start, index + 1)); } catch { return null; }
      }
    }
    return null;
  }

  function taskSuggestionError(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '模型返回的 JSON 不是对象';
    const fields = Object.keys(parsed).slice(0, 12).join('、') || '无字段';
    const genre = typeof parsed.genre === 'string' ? parsed.genre : '缺少 genre';
    const taskType = typeof parsed.taskType === 'string' ? parsed.taskType : '缺少 taskType';
    return `模型返回了 JSON，但最终任务判断字段无效（字段：${fields}；文体：${genre}；任务类型：${taskType}）`;
  }

  function parseDiagnosisIssueCandidates(raw, round) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.issues) || parsed.issues.length > 20) return null;
    const validPackIds = new Set((round.packSnapshot?.packs || []).map(pack => pack.id));
    const validSourceIds = new Set([
      ...(round.packSnapshot?.sources || []).map(source => source.id),
      ...(round.materials || []).flatMap(item => [item.id, item.sourceId]).filter(Boolean),
      ...(round.sources || []).flatMap(item => [item.id, item.sourceId]).filter(Boolean)
    ]);
    const required = ['location', 'excerpt', 'observation', 'impact', 'evidenceCategory', 'evidenceDescription', 'suggestion', 'priority'];
    const limits = { location: 240, excerpt: 1200, observation: 1200, impact: 1200,
      evidenceCategory: 80, evidenceDescription: 1200, packId: 120, sourceId: 120, suggestion: 1200 };
    for (const issue of parsed.issues) {
      if (!issue || typeof issue !== 'object' || Array.isArray(issue)
        || Object.keys(issue).some(key => !DIAGNOSIS_ISSUE_FIELDS.has(key))
        || required.some(key => typeof issue[key] !== 'string' || !issue[key].trim() || issue[key].length > limits[key])
        || ['packId', 'sourceId'].some(key => issue[key] !== undefined
          && (typeof issue[key] !== 'string' || issue[key].length > limits[key]))
        || !ISSUE_CATEGORIES.has(issue.evidenceCategory) || !ISSUE_PRIORITIES.has(issue.priority)
        || issue.packId && !validPackIds.has(issue.packId)
        || issue.sourceId && !validSourceIds.has(issue.sourceId)) return null;
    }
    return parsed.issues;
  }

  // 变更方法返回 Promise；读取方法返回副本。持久化回调应返回实际写入的 state。
  function createWritingWorkbenchCoordinator(dependencies = {}) {
    const getState = dependencies.getState || (() => ({}));
    const sessions = new Map();
    const memories = new Map();
    const modelRuns = new Map();
    let taskAnalysisToken = null;
    const researchRuns = new Map();
    const researchStates = new Map();
    const pendingMemories = new Set();
    const sessionVersions = new WeakMap();
    const deleting = new WeakSet();
    const failedRounds = new WeakSet();
    let persistence = Promise.resolve();
    function state() { return getState() || {}; }
    function availableWritingPacks() {
      if (typeof dependencies.getWritingPacks === 'function') return dependencies.getWritingPacks() || [];
      return Array.isArray(dependencies.writingPacks) ? dependencies.writingPacks : (state().writingPacks || []);
    }
    function writingPackSettings() {
      if (typeof dependencies.getWritingPackSettings === 'function') return dependencies.getWritingPackSettings() || [];
      return Array.isArray(dependencies.writingPackSettings) ? dependencies.writingPackSettings : (state().writingPackSettings || []);
    }
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
      try {
        await persist(s => ({ ...s, writingMemories: [...(s.writingMemories || []).filter(m => m.id !== memory.id), snapshot] }), { memoryId: memory.id });
      } finally { pendingMemories.delete(memory.id); }
    }
    function getWorkspace(id) { return copy(workspace(id)); }
    async function addUnit(id, input = {}) {
      const w = workspace(id);
      const units = w.units || (w.units = []);
      if (units.length >= 100) throw failure('UNIT_LIMIT', '一个工作区最多创建 100 个任务单元', { articleId: id });
      const unit = schema.normalizeWritingUnit({ ...input, id: newId('unit'), order: input.order ?? units.length }, units.length);
      if (!unit.title) throw failure('INVALID_INPUT', '任务单元标题不能为空', { articleId: id });
      units.push(unit);
      w.article.updatedAt = now();
      await saveWorkspace(w);
      return copy(unit);
    }
    async function updateUnit(id, unitId, patch = {}) {
      const w = workspace(id);
      const unit = (w.units || []).find(item => item.id === unitId);
      if (!unit) throw failure('UNIT_NOT_FOUND', '任务单元不存在', { articleId: id, unitId });
      const updated = schema.normalizeWritingUnit({ ...unit, ...patch, id: unitId }, unit.order);
      if (!updated.title) throw failure('INVALID_INPUT', '任务单元标题不能为空', { articleId: id, unitId });
      Object.assign(unit, updated);
      w.article.updatedAt = now();
      await saveWorkspace(w);
      return copy(unit);
    }
    async function archiveUnit(id, unitId) {
      const w = workspace(id);
      const unit = (w.units || []).find(item => item.id === unitId);
      if (!unit) throw failure('UNIT_NOT_FOUND', '任务单元不存在', { articleId: id, unitId });
      unit.archived = true;
      w.article.updatedAt = now();
      await saveWorkspace(w);
      return copy(unit);
    }
    function ensureLongform(w) {
      if (!['fiction', 'script', 'longform-general'].includes(w.article.genre)) {
        throw failure('LONGFORM_UNSUPPORTED', '当前文体不支持长篇故事资料');
      }
      if (!w.longform) w.longform = schema.normalizeLongform({ mode: w.article.genre });
      return w.longform;
    }
    async function updateLongformProject(id, patch = {}) {
      const w = workspace(id);
      const current = ensureLongform(w);
      const allowed = ['medium', 'viewpoint', 'tense', 'audience', 'scope', 'constraints'];
      const next = schema.normalizeLongform({ ...current, ...Object.fromEntries(allowed
        .filter(field => Object.hasOwn(patch, field)).map(field => [field, patch[field]])), mode: w.article.genre });
      w.longform = next;
      w.article.updatedAt = now();
      generate(w, roundFor(id), true);
      await saveWorkspace(w);
      return copy(w.longform);
    }
    async function saveLongformItem(id, type, itemId, patch = {}) {
      const w = workspace(id);
      const longform = ensureLongform(w);
      const collections = { canon: 'canon', character: 'characters', timeline: 'timeline', foreshadowing: 'foreshadowing' };
      const collection = collections[type];
      if (!collection) throw failure('INVALID_INPUT', '不支持的故事资料类型', { type });
      const list = longform[collection];
      const existing = itemId ? list.find(item => item.id === itemId) : null;
      if (itemId && !existing) throw failure('LONGFORM_ITEM_NOT_FOUND', '故事资料不存在', { itemId });
      if (!existing && list.length >= (type === 'timeline' ? 200 : 100)) throw failure('LONGFORM_LIMIT', '故事资料已达到数量上限', { type });
      const candidate = schema.normalizeLongform({ ...longform, [collection]: existing
        ? list.map(item => item.id === itemId ? { ...item, ...patch, id: itemId, updatedAt: now() } : item)
        : [...list, { ...patch, id: newId(type), updatedAt: now() }] });
      const updated = candidate[collection].find(item => item.id === (itemId || candidate[collection].at(-1)?.id));
      if (!updated || (type === 'canon' && !updated.name && !updated.text)
        || (type === 'character' && !updated.name) || (type === 'timeline' && !updated.text)
        || (type === 'foreshadowing' && !updated.planted)) throw failure('INVALID_INPUT', '故事资料需要填写名称或内容', { type });
      if (existing && JSON.stringify(existing) !== JSON.stringify(updated)) {
        const affectedUnitIds = new Set([...(existing.unitIds || []), ...(updated.unitIds || [])]);
        if (existing.firstUnitId) affectedUnitIds.add(existing.firstUnitId);
        if (existing.lastUnitId) affectedUnitIds.add(existing.lastUnitId);
        const relationFields = {
          canon: ['canonIds'], character: ['characterIds'], timeline: ['eventIds', 'canonIds'],
          foreshadowing: ['foreshadowingIds', 'canonIds']
        }[type];
        for (const unit of w.units || []) {
          if (relationFields.some(field => (unit[field] || []).includes(itemId))) affectedUnitIds.add(unit.id);
        }
        const impacts = [...affectedUnitIds].filter(unitId => (w.units || []).some(unit => unit.id === unitId))
          .map(affectedId => ({ id: affectedId, type: 'unit', status: 'pending' }));
        for (const round of w.rounds) for (const material of [...(round.materials || []), ...(round.sources || [])]) {
          if ((material.unitIds || []).some(unitId => affectedUnitIds.has(unitId))) impacts.push({ id: material.id, type: 'material', status: 'pending' });
        }
        for (const issue of w.issues || []) if (issue.unitId && affectedUnitIds.has(issue.unitId)) impacts.push({ id: issue.id, type: 'issue', status: 'pending' });
        for (const entry of candidate.foreshadowing) {
          if (type === 'canon' && (entry.canonIds || []).includes(itemId)
            || (entry.unitIds || []).some(unitId => affectedUnitIds.has(unitId))) {
            impacts.push({ id: entry.id, type: 'foreshadowing', status: 'pending' });
          }
        }
        candidate.changes = [...candidate.changes, {
          id: newId('change'), itemId, itemType: type, oldValue: JSON.stringify(existing), newValue: JSON.stringify(updated),
          reason: String(patch.changeReason || '').slice(0, 500), createdAt: now(),
          impacts: [...new Map(impacts.map(impact => [`${impact.type}:${impact.id}`, impact])).values()]
        }].slice(-200);
      }
      w.longform = candidate;
      w.article.updatedAt = now();
      generate(w, roundFor(id), true);
      await saveWorkspace(w);
      return copy(updated);
    }
    async function reviewLongformImpact(id, changeId, impactReference, status, reason = '') {
      const w = workspace(id);
      const longform = ensureLongform(w);
      if (!schema.IMPACT_STATUSES.includes(status) || status === 'pending') throw failure('INVALID_INPUT', '请提供明确的影响审查状态');
      const change = longform.changes.find(item => item.id === changeId);
      const reference = typeof impactReference === 'string' ? { id: impactReference } : impactReference || {};
      const matches = (change?.impacts || []).filter(item => item.id === reference.id
        && (!reference.type || item.type === reference.type));
      if (matches.length > 1) throw failure('LONGFORM_IMPACT_AMBIGUOUS', '影响项 ID 重复，请同时提供类型和 ID', { changeId, impactId: reference.id });
      const impact = matches[0];
      if (!impact) throw failure('LONGFORM_IMPACT_NOT_FOUND', '影响项不存在', { changeId, impactId: reference.id });
      impact.status = status;
      impact.reason = String(reason || '').slice(0, 500);
      impact.reviewedAt = now();
      await saveWorkspace(w);
      return copy(impact);
    }
    async function setMaterialUnits(id, roundId, materialId, unitIds) {
      const w = workspace(id);
      const round = roundFor(id, roundId);
      const knownUnitIds = new Set((w.units || []).map(unit => unit.id));
      const requested = [...new Set(Array.isArray(unitIds) ? unitIds.filter(value => typeof value === 'string' && value.trim()) : [])];
      if (requested.some(unitId => !knownUnitIds.has(unitId))) {
        throw failure('UNIT_NOT_FOUND', '材料关联了不存在的任务单元', { articleId: id, materialId });
      }
      const material = round.materials.find(item => item.id === materialId);
      const source = material || round.sources.find(item => item.id === materialId);
      if (!source) throw failure('MATERIAL_NOT_FOUND', '材料不存在', { articleId: id, roundId, materialId });
      source.unitIds = requested;
      generate(w, round, true);
      await saveWorkspace(w);
      return copy(round);
    }
    async function addIssue(id, input = {}) {
      const w = workspace(id);
      const round = roundFor(id, input.roundId);
      const unitId = Object.hasOwn(input, 'unitId') ? String(input.unitId || '').trim() : round.unitId || '';
      if (unitId && !(w.units || []).some(unit => unit.id === unitId)) {
        throw failure('UNIT_NOT_FOUND', '问题关联的任务单元不存在', { articleId: id, unitId });
      }
      const promptVersionId = String(input.promptVersionId || '').trim();
      const hasPromptVersion = promptVersionId && w.rounds.some(item =>
        (item.promptVersions || []).some(version => version.id === promptVersionId));
      if (promptVersionId && !hasPromptVersion) {
        throw failure('PROMPT_VERSION_NOT_FOUND', '问题关联的提示词版本不存在', { articleId: id, promptVersionId });
      }
      const issue = schema.normalizeWritingIssue({ ...input, id: newId('issue'), roundId: round.id,
        promptVersionId, unitId, judgment: input.judgment || 'undetermined', status: input.status || 'pending-user' });
      if (!issue.excerpt || !issue.observation) throw failure('INVALID_INPUT', '问题记录至少需要原文摘录和可观察表现', { articleId: id });
      w.issues = [...(w.issues || []), issue];
      w.article.updatedAt = now();
      await saveWorkspace(w);
      return copy(issue);
    }
    async function updateIssue(id, issueId, patch = {}) {
      const w = workspace(id);
      const issue = (w.issues || []).find(item => item.id === issueId);
      if (!issue) throw failure('ISSUE_NOT_FOUND', '问题记录不存在', { articleId: id, issueId });
      for (const field of ['judgment', 'status', 'priority']) {
        if (!Object.hasOwn(patch, field)) continue;
        const allowed = field === 'judgment' ? schema.ISSUE_JUDGMENTS
          : field === 'status' ? schema.ISSUE_STATUSES : schema.ISSUE_PRIORITIES;
        if (!allowed.includes(patch[field])) throw failure('INVALID_INPUT', `问题${field}无效`, { articleId: id, issueId });
      }
      const editable = Object.fromEntries([
        'location', 'observation', 'impact', 'evidenceCategory', 'evidenceDescription',
        'packId', 'sourceId', 'suggestion', 'priority', 'judgment', 'status', 'statusReason',
        'reviewedRoundId', 'reviewedAt'
      ].filter(field => Object.hasOwn(patch, field)).map(field => [field, patch[field]]));
      const next = schema.normalizeWritingIssue({ ...issue, ...editable });
      if (next.status === 'review-passed') {
        if (!next.reviewedRoundId || next.reviewedRoundId === issue.roundId) {
          throw failure('ISSUE_REVIEW_ROUND_REQUIRED', '复核通过必须关联一条新的复核轮次', { articleId: id, issueId });
        }
        roundFor(id, next.reviewedRoundId);
        next.reviewedAt = now();
      }
      Object.assign(issue, next);
      w.article.updatedAt = now();
      await saveWorkspace(w);
      return copy(issue);
    }
    function listRoutes(id, taskType = 'revision') {
      const w = workspace(id);
      const round = roundFor(id);
      return prompts.listWritingPackRoutes({
        workspace: w, packs: availableWritingPacks(), packSettings: writingPackSettings(),
        selectedIds: selectedPackIds(w, round), taskType
      }).map(copy);
    }
    async function selectRoute(id, routeId, packId = '') {
      const w = workspace(id);
      const round = roundFor(id);
      const taskType = round.taskType || (w.article.genre === 'academic-paper' ? 'academic-planning' : 'revision');
      const routes = listRoutes(id, taskType).filter(route => route.routeId === routeId
        && (!packId || route.packId === packId));
      if (!routes.length) throw failure('ROUTE_NOT_AVAILABLE', '当前选用的基础包没有适用路线', { articleId: id, routeId, packId });
      if (routes.length > 1) throw failure('ROUTE_AMBIGUOUS', '多个已选基础包包含同 ID 路线，请指定基础包', { articleId: id, routeId });
      const selected = routes[0];
      const snapshot = schema.normalizeWritingWorkspace({ routeProgress: {
        ...selected, roundId: round.id, currentUnitId: round.unitId || '',
        currentStageId: selected.stages[0]?.id || '',
        stages: selected.stages.map(stage => ({ ...stage, status: 'not-started' }))
      } }).routeProgress;
      w.routeProgress = snapshot;
      round.routeSnapshot = copy(snapshot);
      generate(w, round, true);
      await saveWorkspace(w);
      return copy({ routeProgress: snapshot, round });
    }
    async function advanceRoute(id, stageId, action, details = {}) {
      const w = workspace(id);
      const route = w.routeProgress;
      if (!route?.routeId) throw failure('ROUTE_NOT_SELECTED', '请先选择适用的专业路线', { articleId: id });
      const stageIndex = route.stages.findIndex(stage => stage.id === stageId);
      if (stageIndex < 0) throw failure('ROUTE_STEP_NOT_FOUND', '路线步骤不存在', { articleId: id, stageId });
      if (route.currentStageId !== stageId) throw failure('ROUTE_STEP_NOT_CURRENT', '只能推进当前路线步骤', { articleId: id, stageId });
      const stage = route.stages[stageIndex];
      if (action === 'start') {
        if (!['not-started', 'blocked', 'user-confirmed-complete'].includes(stage.status)) {
          throw failure('ROUTE_STEP_STATE_INVALID', '当前路线步骤不能从此状态开始', { articleId: id, stageId });
        }
        if (stage.status === 'user-confirmed-complete') {
          stage.result = '';
          stage.evidence = '';
          stage.confirmedAt = '';
        }
        stage.status = 'in-progress';
        stage.statusReason = '';
      } else if (action === 'complete') {
        if (details.confirmed !== true) throw failure('ROUTE_CONFIRMATION_REQUIRED', '请明确确认该步骤已完成', { articleId: id, stageId });
        if (stage.status !== 'in-progress') throw failure('ROUTE_STEP_STATE_INVALID', '请先开始该步骤再确认完成', { articleId: id, stageId });
        stage.status = 'user-confirmed-complete';
        stage.statusReason = '';
        stage.result = String(details.result || '');
        stage.evidence = String(details.evidence || '');
        stage.confirmedAt = now();
      } else if (action === 'skip') {
        if (!stage.skippable) throw failure('ROUTE_STEP_NOT_SKIPPABLE', '该基础包路线不允许跳过此步骤', { articleId: id, stageId });
        stage.status = 'skipped';
        stage.statusReason = '';
      } else if (action === 'block') {
        const reason = String(details.reason || '').trim();
        if (!reason) throw failure('INVALID_INPUT', '标记受阻时请说明缺少什么', { articleId: id, stageId });
        const returnIndex = details.returnToStageId
          ? route.stages.findIndex(item => item.id === details.returnToStageId) : -1;
        if (details.returnToStageId && (!stage.returnWhenMissing.length || returnIndex < 0 || returnIndex >= stageIndex)) {
          throw failure('ROUTE_RETURN_INVALID', '该步骤未配置退回条件或目标步骤无效', { articleId: id, stageId });
        }
        stage.status = 'blocked';
        stage.statusReason = reason;
        if (details.returnToStageId) route.currentStageId = details.returnToStageId;
      } else {
        throw failure('INVALID_INPUT', '路线步骤操作无效', { articleId: id, stageId, action });
      }
      if (['complete', 'skip'].includes(action)) {
        route.currentStageId = route.stages.slice(stageIndex + 1)
          .find(item => !['user-confirmed-complete', 'skipped'].includes(item.status))?.id || '';
      }
      const round = roundFor(id, route.roundId);
      w.routeProgress = schema.normalizeWritingWorkspace({ routeProgress: route }).routeProgress;
      generate(w, round);
      await saveWorkspace(w);
      return copy({ routeProgress: w.routeProgress, round });
    }
    function listArticles() {
      const all = new Map((state().writingArticles || []).map(w => [w.id, w]));
      for (const [id, w] of sessions) all.set(id, w);
      return [...all.values()].map(w => copy(w.article));
    }
    function listMemories() { return [...memories.values()].map(copy); }
    function getRelevantMemories(genre = 'article', articleId, options = {}) {
      const config = schema.getWritingGenreConfig(genre);
      const priority = { article: 0, project: 1, genre: 2, general: 3 };
      const article = sessions.get(articleId)?.article || (state().writingArticles || []).find(item => item.id === articleId)?.article;
      const skipped = new Set(article?.skippedMemoryIds || []);
      return [...memories.values()].filter(m => m.preference && m.status === 'confirmed' && m.enabled !== false && !m.undo?.undoneAt
        && (options.includeSkipped === true || !skipped.has(m.id)) && (
        m.scope === 'general' || config && (m.scope === 'genre' && m.genre === config.memoryNamespace
          || m.scope === 'project' && m.projectId === articleId
          || m.scope === 'article' && m.articleId === articleId)
      )).sort((a, b) => priority[a.scope] - priority[b.scope] || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 3).map(copy);
    }
    function inputFor(w, round) {
      return { ...w, round, memories: getRelevantMemories(w.genre, w.id),
        writingPacks: availableWritingPacks(), writingPackSettings: writingPackSettings() };
    }
    function storySnapshot(w, round, taskType) {
      if (!['fiction', 'script', 'longform-general'].includes(w.article.genre)) return null;
      const project = ensureLongform(w);
      const unit = round.unitSnapshot || (w.units || []).find(item => item.id === round.unitId);
      const broad = !unit || ['longform-planning', 'longform-outline', 'longform-worldbuilding'].includes(taskType);
      const linked = (item, ids = []) => broad || ids.includes(item.id) || (item.unitIds || []).includes(unit?.id)
        || (item.characterIds || []).some(id => (unit?.characterIds || []).includes(id));
      const selected = {
        canon: project.canon.filter(item => !item.archived && linked(item, unit?.canonIds || [])),
        characters: project.characters.filter(item => !item.archived && (linked(item, unit?.characterIds || [])
          || item.firstUnitId === unit?.id || item.lastUnitId === unit?.id)),
        timeline: project.timeline.filter(item => !item.archived && linked(item, unit?.eventIds || [])),
        foreshadowing: project.foreshadowing.filter(item => !item.archived && linked(item, unit?.foreshadowingIds || []))
      };
      const priorIds = new Set(unit?.priorUnitIds || []);
      const nextIds = new Set(unit?.nextUnitIds || []);
      const relatedUnits = (w.units || []).filter(item => !item.archived && (priorIds.has(item.id) || nextIds.has(item.id)));
      const priorSummaries = relatedUnits.filter(item => priorIds.has(item.id) && item.summary).slice(0, 2)
        .map(item => `前序单元[${item.id}]：${item.summary.slice(0, 100)}`);
      const nextSummaries = relatedUnits.filter(item => nextIds.has(item.id) && item.summary).slice(0, 2)
        .map(item => `后续单元[${item.id}]：${item.summary.slice(0, 100)}`);
      const relatedUnitIds = new Set([unit?.id, ...priorIds, ...nextIds]);
      const adjacentUnitIds = new Set([...priorIds, ...nextIds]);
      const relatedMaterialsById = new Map();
      for (const relatedRound of w.rounds || []) {
        for (const item of [...(relatedRound.materials || []), ...(relatedRound.sources || [])]) {
          if (!(item.unitIds || []).some(id => adjacentUnitIds.has(id))) continue;
          const id = item.id || item.sourceId || `${relatedRound.id}:${item.title || ''}`;
          relatedMaterialsById.set(id, { ...item, id, linkedUnitIds: (item.unitIds || []).filter(id => adjacentUnitIds.has(id)) });
        }
      }
      const relatedMaterials = [...relatedMaterialsById.values()].slice(-3).map(item => ({
        ...item,
        excerpt: (item.excerpt || '').slice(0, 400)
      }));
      const unresolvedIssues = (w.issues || []).filter(issue =>
        issue.status !== 'review-passed' && relatedUnitIds.has(issue.unitId))
        .slice(0, 3).map(issue => `[${issue.id}] 单元[${issue.unitId}]：${(issue.observation || issue.excerpt || '待处理问题').slice(0, 90)}`);
      const relatedContext = [
        priorSummaries.length ? `前序摘要：${priorSummaries.join('；')}` : '',
        nextSummaries.length ? `后续摘要：${nextSummaries.join('；')}` : '',
        unresolvedIssues.length ? `未解决问题：${unresolvedIssues.join('；')}` : ''
      ].filter(Boolean).join('；').slice(0, 430);
      const compact = (items, fields) => items.slice(0, 2).map(item => Object.fromEntries(Object.entries(item)
        .map(([key, value]) => [key, typeof value === 'string' && fields.includes(key) ? value.slice(0, 400) : value])));
      const included = Object.values(selected).reduce((sum, items) => sum + Math.min(items.length, 2), 0);
      const omitted = Object.values(selected).reduce((sum, items) => sum + Math.max(0, items.length - 2), 0);
      const storyNote = omitted
        ? `共关联${Object.values(selected).reduce((sum, items) => sum + items.length, 0)}条故事资料，本轮按类别各选入最多2条，另有${omitted}条未纳入。请按需要分轮检查；未纳入内容不视为已检查。`
        : `本轮从已登记资料中选入${included}条；未关联资料、其他章节正文和附件不视为已检查。`;
      const contextLimit = Math.max(0, 500 - storyNote.length - 1);
      const boundedRelatedContext = relatedContext.length > contextLimit
        ? `${relatedContext.slice(0, Math.max(0, contextLimit - 14))}〔关联内容有省略〕`
        : relatedContext;
      return schema.normalizeLongform({ ...project,
        canon: compact(selected.canon, ['name', 'text', 'scope', 'sourceNote']),
        characters: compact(selected.characters, ['name', 'identity', 'relationships', 'goals', 'known', 'unknown', 'state', 'arc', 'notes']),
        timeline: compact(selected.timeline, ['text', 'storyTime']),
        foreshadowing: compact(selected.foreshadowing, ['planted', 'location', 'expectedPayoff', 'confirmation']),
        relatedMaterials,
        changes: project.changes.slice(-5),
        contextNote: [storyNote, boundedRelatedContext].filter(Boolean).join(' ')
      });
    }
    function addPromptVersion(round, content, taskType, generated) {
      const versions = round.promptVersions || [];
      const version = schema.normalizeWritingRound({ promptVersions: [{
        id: newId('prompt-version'), parentVersionId: versions.at(-1)?.id || '', content,
        createdAt: now(), copied: false, taskType, generated,
        unitId: round.unitId || '', unitSnapshot: round.unitSnapshot,
        longformSnapshot: round.longformSnapshot,
        packVersions: (round.packSnapshot?.packs || []).map(pack => ({ id: pack.id, version: pack.version }))
      }] }).promptVersions[0];
      round.promptVersions = [...versions, version];
      return version;
    }
    function lineChanges(before, after) {
      const left = String(before || '').split('\n');
      const right = String(after || '').split('\n');
      let prefix = 0;
      while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
      let suffix = 0;
      while (suffix < left.length - prefix && suffix < right.length - prefix
        && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
      const removed = left.slice(prefix, left.length - suffix).filter(Boolean);
      const added = right.slice(prefix, right.length - suffix).filter(Boolean);
      return { changed: removed.length > 0 || added.length > 0, removed, added };
    }
    async function recordPromptVersion(id, roundId, content, options = {}) {
      const w = workspace(id);
      const round = roundFor(id, roundId);
      if (typeof content !== 'string' || !content.trim() || content.length > 8000) {
        throw failure('INVALID_INPUT', '提示词版本必须为非空文字且不超过8000字', { articleId: id, roundId });
      }
      if (options.copied !== undefined && typeof options.copied !== 'boolean') {
        throw failure('INVALID_INPUT', '复制状态必须为布尔值', { articleId: id, roundId });
      }
      const version = addPromptVersion(round, content, round.taskType || 'revision', false);
      version.copied = options.copied === true;
      round.updatedAt = now();
      await saveWorkspace(w);
      return copy(version);
    }
    async function markPromptVersionCopied(id, roundId, versionId) {
      const w = workspace(id);
      const round = roundFor(id, roundId);
      const version = (round.promptVersions || []).find(item => item.id === String(versionId || ''));
      if (!version) throw failure('PROMPT_VERSION_NOT_FOUND', '找不到要标记复制的提示词版本', { articleId: id, roundId });
      version.copied = true;
      round.updatedAt = now();
      await saveWorkspace(w);
      return copy(version);
    }
    function compareRounds(id, leftRoundId, rightRoundId) {
      const w = workspace(id);
      const left = roundFor(id, leftRoundId);
      const right = roundFor(id, rightRoundId);
      const fields = ['draft', 'prompt', 'diagnosis', 'feedback', 'userFeedback'];
      const changes = Object.fromEntries(fields.map(field => [field, {
        ...lineChanges(left[field], right[field]), left: left[field] || '', right: right[field] || ''
      }]));
      const issuesFor = roundId => (w.issues || []).filter(issue => issue.roundId === roundId || issue.reviewedRoundId === roundId);
      return copy({ left, right, changes, issues: { left: issuesFor(left.id), right: issuesFor(right.id) } });
    }
    async function continueFromRound(id, roundId, options = {}) {
      const w = workspace(id);
      const source = roundFor(id, roundId);
      const allowed = new Set(['draft', 'feedback', 'diagnosis', 'materials', 'unit', 'route', 'packs', 'prompt']);
      const contexts = [...new Set(Array.isArray(options.contexts) ? options.contexts : [])];
      if (contexts.some(context => !allowed.has(context))) {
        throw failure('INVALID_INPUT', '继续上下文选择无效', { articleId: id, roundId });
      }
      const selected = new Set(contexts);
      const input = {
        draft: selected.has('draft') ? source.draft : '',
        parentRoundId: source.id,
        restoredFromRoundId: source.id,
        ...(selected.has('feedback') ? { feedback: source.feedback, userFeedback: source.userFeedback } : {}),
        ...(selected.has('diagnosis') ? { diagnosis: source.diagnosis } : {}),
        ...(selected.has('materials') ? { materials: source.materials, sources: source.sources } : {}),
        ...(selected.has('unit') ? { unitId: source.unitId, unitSnapshot: source.unitSnapshot } : {}),
        ...(selected.has('route') ? { routeSnapshot: source.routeSnapshot } : {}),
        ...(selected.has('packs') ? { packSelections: source.packSelections, packSnapshot: source.packSnapshot } : {}),
        ...(selected.has('prompt') ? { sourcePromptVersionId: source.promptVersions?.at(-1)?.id || source.sourcePromptVersionId || '' } : {})
      };
      return appendRound(id, input);
    }
    function selectedPackIds(w, round) {
      if (Array.isArray(round?.packSelections)) return round.packSelections;
      return Array.isArray(w.article.packSelections) ? w.article.packSelections : [];
    }
    function selectPacksForTask(w, round, taskType) {
      return prompts.selectWritingPacks({ workspace: w, packs: availableWritingPacks(), packSettings: writingPackSettings(),
        selectedIds: selectedPackIds(w, round), taskType, snapshot: round?.packSnapshot });
    }
    function ensurePackSnapshot(w, round) {
      if (round.packSnapshot) {
        if (!round.resourceSnapshot) round.resourceSnapshot = round.packSnapshot.resources || [];
        if (!round.resourceUsage) round.resourceUsage = (round.resourceSnapshot || []).map(resource => ({ id: resource.id, kind: resource.kind, status: 'used',
          sourceIds: resource.sourceIds, actionId: resource.actionId, updatedAt: now() }));
        return round.packSnapshot;
      }
      const genreConfig = schema.getWritingGenreConfig(w.article.genre);
      const taskTypes = w.article.genre === 'academic-paper' ? [...ACADEMIC_TASK_TYPES]
        : w.article.genre === 'article' ? ['revision', 'diagnosis'] : genreConfig?.taskTypes || [];
      const selections = taskTypes.map(taskType => selectPacksForTask(w, round, taskType));
      const packs = selections.flatMap(selection => selection.packs);
      const packIds = new Set(packs.map(item => item.id));
      const entries = selections.flatMap(selection => selection.entries).filter((item, index, all) =>
        all.findIndex(other => `${other.packId}:${other.id}:${other.taskType || ''}` === `${item.packId}:${item.id}:${item.taskType || ''}`) === index);
      // 来源 ID 只在包内唯一，快照按“包 + 来源”保留，避免跨包同名互相覆盖。
      const sources = selections.flatMap(selection => selection.sources).filter((item, index, all) =>
        all.findIndex(other => `${other.packId}:${other.id}` === `${item.packId}:${item.id}`) === index);
      const resources = selections.flatMap(selection => selection.resources || selection.resourceSelection?.resources || []).filter((item, index, all) =>
        all.findIndex(other => `${other.packId || ''}:${other.id}` === `${item.packId || ''}:${item.id}`) === index);
      const skipped = selections.flatMap(selection => selection.skipped).filter((item, index, all) =>
        all.findIndex(other => `${other.id}:${other.reason}` === `${item.id}:${item.reason}`) === index);
      round.packSnapshot = schema.normalizeWritingPackSnapshot({
        packs: [...packIds].map(id => packs.find(item => item.id === id)),
        entries, sources, resources, skipped
      });
      round.resourceSnapshot = round.packSnapshot.resources;
      round.resourceUsage = round.packSnapshot.resources.map(resource => ({ id: resource.id, kind: resource.kind, status: 'used',
        sourceIds: resource.sourceIds, actionId: resource.actionId, updatedAt: now() }));
      round.skippedResources = round.packSnapshot.skipped.filter(item => item.kind || item.reason?.includes('mismatch'))
        .map(item => ({ ...item, status: 'skipped', updatedAt: now() }));
      return round.packSnapshot;
    }
    function validateProfile(profile, articleId, genre = 'article') {
      if (!profile) return;
      const config = schema.getWritingGenreConfig(genre);
      if (profile.scope && !['general', 'genre', 'article'].includes(profile.scope)
        || profile.scope === 'genre' && profile.genre !== config?.memoryNamespace
        || profile.scope === 'article' && profile.articleId && profile.articleId !== articleId) {
        throw failure('STYLE_SCOPE_INVALID', '风格档案不适用于当前文体', { articleId });
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
        scope: 'article', genre: w.article.genre, updatedAt: now() });
    }
    function references(input) {
      const r = schema.normalizeWritingRound(input);
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
      // 手工、风格和自动来源全部保留，重复来源按 URL 去重。
      const protectedSources = round.sources.filter(s => ['style', 'both'].includes(s.purpose) || !s.origin);
      const automatic = round.sources.filter(s => !protectedSources.includes(s));
      const seen = new Set(protectedSources.map(s => s.url).filter(Boolean));
      const incoming = sources.filter(s => !seen.has(s.url));
      const merged = [...protectedSources, ...automatic, ...incoming];
      const refs = references({ materials: round.materials, sources: merged.filter(s => {
        const identity = s.url || JSON.stringify([s.title, s.excerpt, s.purpose]);
        const duplicate = merged.findIndex(m => (m.url || JSON.stringify([m.title, m.excerpt, m.purpose])) === identity);
        return merged.indexOf(s) === duplicate;
      }) });
      Object.assign(round, refs);
      const includedSources = refs.sources.filter(s => incoming.some(m => m.url === s.url)).length;
      return { ...refs, includedSources, contextNote: sources.length && !includedSources
        ? '公开摘要未纳入提示词；原资料保留，可调整材料后重试。'
        : `本次公开摘要纳入提示词${includedSources}份；未纳入的材料仍保留在资料列表中。` };
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
    function generate(w, round, refreshDiagnosis = false, requestedTaskType = '') {
      validateInput(w, round);
      const genreConfig = schema.getWritingGenreConfig(w.article.genre);
      const defaultTaskType = w.article.genre === 'academic-paper' ? 'academic-planning'
        : w.article.genre === 'article' ? 'revision' : genreConfig?.taskTypes?.[0];
      const taskType = requestedTaskType || round.taskType || defaultTaskType;
      const input = inputFor(w, round);
      round.memorySnapshot = input.memories.map(memory => ({ id: memory.id, preference: memory.preference, scope: memory.scope,
        sourceArticleId: memory.sourceArticleId, origin: memory.origin, updatedAt: memory.updatedAt }));
      if (w.article.genre === 'academic-paper') {
        if (!ACADEMIC_TASK_TYPES.has(taskType)) throw failure('INVALID_TASK_TYPE', '不支持的学术写作任务', { articleId: w.id, taskType });
        ensurePackSnapshot(w, round);
        const prompt = prompts.buildAcademicWritingPrompt(input, taskType);
        round.taskType = taskType;
        round.prompt = prompt;
        const previousPrompt = round.promptVersions?.at(-1);
        if (!previousPrompt || previousPrompt.content !== prompt || previousPrompt.taskType !== taskType || previousPrompt.generated !== true) {
          addPromptVersion(round, prompt, taskType, true);
        }
        failedRounds.delete(round);
        if (refreshDiagnosis) modelRuns.delete(round.id);
        return { diagnosis: round.diagnosis, prompt, taskType };
      }
      if (w.article.genre !== 'article') {
        if (!genreConfig?.taskTypes?.includes(taskType)) throw failure('INVALID_TASK_TYPE', '当前文体不支持该专属任务', { articleId: w.id, taskType });
        ensurePackSnapshot(w, round);
        round.longformSnapshot = storySnapshot(w, round, taskType);
        const localDiagnosis = prompts.buildLocalWritingDiagnosis(input);
        const isLocal = round.diagnosis.startsWith(`${localDiagnosis.label}\n`);
        const diagnosis = (!refreshDiagnosis && !isLocal && round.diagnosis) || `${localDiagnosis.label}\n${localDiagnosis.dimensions.map(d =>
          `${d.name}：${d.findings.length ? d.findings.map(f => `${f.quote}：${f.observation}；${f.direction}`).join('；') : d.note}`).join('\n')}`;
        round.diagnosis = diagnosis;
        const prompt = prompts.buildDomainWritingPrompt(input, taskType);
        round.taskType = taskType;
        round.prompt = prompt;
        const previousPrompt = round.promptVersions?.at(-1);
        if (!previousPrompt || previousPrompt.content !== prompt || previousPrompt.taskType !== taskType || previousPrompt.generated !== true) {
          addPromptVersion(round, prompt, taskType, true);
        }
        failedRounds.delete(round);
        if (refreshDiagnosis) modelRuns.delete(round.id);
        return { localDiagnosis, diagnosis, prompt, taskType };
      }
      ensurePackSnapshot(w, round);
      const localDiagnosis = prompts.buildLocalWritingDiagnosis(input);
      const isLocal = round.diagnosis.startsWith(`${localDiagnosis.label}\n`);
      const diagnosis = (!refreshDiagnosis && !isLocal && round.diagnosis) || `${localDiagnosis.label}\n${localDiagnosis.dimensions.map(d =>
        `${d.name}：${d.findings.length ? d.findings.map(f => `${f.quote}：${f.observation}；${f.direction}`).join('；') : d.note}`).join('\n')}`;
      const prompt = prompts.buildWritingRevisionPrompt({ ...input, round: { ...round, diagnosis } });
      round.diagnosis = diagnosis;
      round.prompt = prompt;
      const previousPrompt = round.promptVersions?.at(-1);
      round.taskType = 'revision';
      if (!previousPrompt || previousPrompt.content !== prompt || previousPrompt.taskType !== 'revision' || previousPrompt.generated !== true) {
        addPromptVersion(round, prompt, 'revision', true);
      }
      failedRounds.delete(round);
      if (refreshDiagnosis) modelRuns.delete(round.id);
      return { localDiagnosis, diagnosis, prompt };
    }
    async function build(id, options = {}) {
      const w = workspace(id);
      const round = roundFor(id, options.roundId);
      if (Object.hasOwn(options, 'unitId')) {
        const unitId = String(options.unitId || '').trim();
        const unit = unitId ? (w.units || []).find(item => item.id === unitId) : null;
        if (unitId && !unit) throw failure('UNIT_NOT_FOUND', '提示词指定了不存在的章节或任务单元', { articleId: id, unitId });
        if (unit?.archived) throw failure('UNIT_ARCHIVED', '已归档任务单元不能用于新提示词', { articleId: id, unitId });
        round.unitId = unit?.id || '';
        if (unit) round.unitSnapshot = copy(unit);
        else delete round.unitSnapshot;
      }
      const taskType = w.article.genre === 'academic-paper' ? options.taskType || round.taskType || 'academic-planning'
        : w.article.genre === 'article' ? '' : options.taskType || round.taskType || schema.getWritingGenreConfig(w.article.genre)?.taskTypes?.[0];
      const result = generate(w, round, true, taskType);
      await saveWorkspace(w);
      return copy({ articleId: id, roundId: round.id, ...result, ...(taskType ? { taskType } : {}) });
    }
    async function analyzeTask(input = {}, options = {}) {
      if (typeof dependencies.requestModel !== 'function') throw failure('MODEL_UNAVAILABLE', '当前模型不可用，请手动选择文体和任务类型');
      const token = {};
      taskAnalysisToken = token;
      const signal = options.signal;
      if (signal?.aborted) throw failure('MODEL_CANCELLED', '任务分析已取消');
      const candidates = new Map((Array.isArray(input.uploadCandidates) ? input.uploadCandidates : [])
        .filter(item => item?.id && item?.excerpt).map(item => [String(item.id), { ...item }]));
      const sentIds = new Set();
      const sentEvidence = new Map();
      const omittedCandidates = new Map();
      const requestBodyLimit = 1_800_000;
      const inputTokenBudget = Number.isSafeInteger(options.inputTokenBudget) && options.inputTokenBudget > 1000
        ? Math.min(options.inputTokenBudget, 32000) : 8000;
      const estimateTokens = value => {
        const cjk = (String(value).match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
        return cjk + Math.ceil((String(value).length - cjk) / 3);
      };
      const safeMaterialList = Array.isArray(input.materials) ? input.materials : [];
      const followupFragments = [];
      let observedPromptTokens = 0;
      let estimatedPromptTokens = 0;
      const buildBoundedPrompt = remainingTokenBudget => {
        let excerptLimit = 1200;
        let manualLimit = 1200;
        let goalLimit = 4000;
        let draftLimit = 6000;
        let sourcePreviewLimit = 3000;
        let retrievalLimit = 6000;
        let candidateList = [...candidates.values()].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
        let prompt = '';
        let requestBytes = 0;
        let estimatedTokens = 0;
        for (let attempt = 0; attempt < 24; attempt++) {
          const boundedInput = {
            ...input,
            goal: String(input.goal || '').slice(0, goalLimit),
            draft: String(input.draft || '').slice(0, draftLimit),
            sourceDocument: input.sourceDocument ? { ...input.sourceDocument,
              preview: String(input.sourceDocument.preview || '').slice(0, sourcePreviewLimit),
              outline: Array.isArray(input.sourceDocument.outline) ? input.sourceDocument.outline.slice(0, 40) : [] } : input.sourceDocument,
            materials: safeMaterialList.map(item => ({ ...item, excerpt: String(item?.excerpt || '').slice(0, manualLimit) })),
            uploadCandidates: candidateList.map(item => ({ ...item, excerpt: String(item.excerpt || '').slice(0, excerptLimit) })),
            retrievalRound: followupFragments.join('\n\n').slice(0, retrievalLimit),
            retrievalStatus: { ...(input.retrievalStatus || {}), omittedExcerptCount: omittedCandidates.size,
              omittedCandidates: [...omittedCandidates.values()] }
          };
          prompt = prompts.buildWritingTaskAnalysisPrompt(boundedInput);
          const serialized = JSON.stringify({ messages: [{ role: 'user', content: prompt }] });
          requestBytes = new TextEncoder().encode(serialized).length;
          // 预留 1,200 tokens 给服务端 system prompt、协议封装和估算误差。
          estimatedTokens = estimateTokens(serialized) + 1200;
          if (requestBytes <= requestBodyLimit && estimatedTokens <= remainingTokenBudget) {
            return { prompt, requestBytes, estimatedTokens, candidates: boundedInput.uploadCandidates };
          }
          if (excerptLimit > 120) excerptLimit = Math.max(120, Math.floor(excerptLimit / 2));
          else if (manualLimit > 120) manualLimit = Math.max(120, Math.floor(manualLimit / 2));
          else if (retrievalLimit > 1000) retrievalLimit = Math.max(1000, Math.floor(retrievalLimit / 2));
          else if (sourcePreviewLimit > 400) sourcePreviewLimit = Math.max(400, Math.floor(sourcePreviewLimit / 2));
          else if (draftLimit > 1200) draftLimit = Math.max(1200, Math.floor(draftLimit / 2));
          else if (goalLimit > 800) goalLimit = Math.max(800, Math.floor(goalLimit / 2));
          else if (candidateList.length > 1) {
            const omitted = candidateList.pop();
            omittedCandidates.set(String(omitted.id), { id: String(omitted.id), reason: '主模型累计输入预算不足，未发送该候选摘录' });
          }
          else if (candidateList.length === 1 && candidateList[0].excerpt.length > 120) {
            candidateList[0] = { ...candidateList[0], excerpt: candidateList[0].excerpt.slice(0, 120) };
          } else break;
        }
        if (requestBytes > requestBodyLimit || estimatedTokens > inputTokenBudget) {
          throw failure('UPLOAD_CONTEXT_TOO_LARGE', '任务说明和检索材料仍超过模型输入预算；请精简任务目标或减少手动加入的材料。未送达的片段会标记为未分析。');
        }
        return { prompt, requestBytes, estimatedTokens };
      };
      let onAbort;
      try {
        const abort = new Promise((_, reject) => {
          onAbort = () => reject(failure('MODEL_CANCELLED', '任务分析已取消'));
          signal?.addEventListener('abort', onAbort, { once: true });
        });
        const executedSearches = new Set();
        for (let turn = 0; turn <= 3; turn++) {
          const remainingTokenBudget = inputTokenBudget - estimatedPromptTokens;
          if (remainingTokenBudget <= 1200) {
            throw failure('UPLOAD_CONTEXT_TOO_LARGE', '主模型累计输入预算已用尽，无法继续完成任务判断；可缩短目标或减少手动材料后重试。');
          }
          const bounded = buildBoundedPrompt(remainingTokenBudget);
          for (const item of bounded.candidates) {
            const id = String(item.id);
            sentIds.add(id);
            sentEvidence.set(id, { ...candidates.get(id), ...item });
            omittedCandidates.delete(id);
          }
          estimatedPromptTokens += bounded.estimatedTokens;
          const response = await Promise.race([dependencies.requestModel({
            messages: [{ role: 'user', content: bounded.prompt }], signal, stage: 'writing-task-analysis',
            inputTokenBudget: remainingTokenBudget, estimatedPromptTokens: bounded.estimatedTokens, requestBytes: bounded.requestBytes
          }), abort]);
          if (signal?.aborted || response?.cancelled) throw failure('MODEL_CANCELLED', '任务分析已取消');
          if (taskAnalysisToken !== token) throw failure('STALE_RESULT', '任务分析结果已过期');
          if (Number.isSafeInteger(response?.usage?.prompt_tokens)) observedPromptTokens += response.usage.prompt_tokens;
          const raw = typeof response === 'string' ? response : response?.text;
          if (typeof raw !== 'string' || !raw.trim()) throw failure('INVALID_TASK_SUGGESTION', '模型没有返回任务判断');
          const parsed = extractJsonDocument(raw);
          if (!parsed) throw failure('INVALID_TASK_SUGGESTION', '模型返回内容不是有效 JSON；请让模型只返回任务判断对象。');
          const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
          const suggestion = schema.normalizeWritingTaskSuggestion(parsed);
          const hasFinal = Boolean(suggestion);
          if (hasFinal) {
            const allowedUploadMaterialIds = new Set(sentIds);
            const selectedUploadMaterialIds = [...new Set(Array.isArray(parsed.selectedUploadMaterialIds)
              ? parsed.selectedUploadMaterialIds.filter(id => typeof id === 'string' && allowedUploadMaterialIds.has(id)) : [])];
            const selectedUploadCandidates = selectedUploadMaterialIds
              .map(id => sentEvidence.get(id))
              .filter(item => item?.materialId && item?.excerpt)
              .map(item => ({ id: String(item.id), materialId: String(item.materialId), title: String(item.title || ''),
                relativePath: String(item.relativePath || ''), locator: String(item.locator || ''),
                excerpt: String(item.excerpt || ''), selectionReason: String(item.selectionReason || '') }));
            return { ...suggestion, selectedUploadMaterialIds, selectedUploadCandidates,
              retrieval: { completedRounds: turn, omittedExcerptCount: omittedCandidates.size,
                sentMaterialIds: [...sentIds], omittedCandidates: [...omittedCandidates.values()],
                estimatedPromptTokens, ...(observedPromptTokens ? { observedPromptTokens } : {}) } };
          }
          if (turn < 3 && actions.length) {
            const queries = [...new Set(actions.filter(action => action?.type === 'search')
              .flatMap(action => Array.isArray(action.queries) ? action.queries : [action.query])
              .filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))].slice(0, 5);
            if (queries.length && typeof options.searchMaterials === 'function') {
              const key = queries.join('\n');
              if (!executedSearches.has(key)) {
                executedSearches.add(key);
                const found = await options.searchMaterials(queries);
                for (const item of Array.isArray(found) ? found : []) if (item?.id && item?.excerpt) candidates.set(String(item.id), { ...item });
                followupFragments.push(...(Array.isArray(found) ? found : []).filter(item => item?.excerpt)
                  .map(item => `文件 ID：${item.id}\n文件：${item.relativePath || item.title || ''}\n位置：${item.locator || '位置未识别'}\n摘录：\n${item.excerpt}`));
              }
            }
            for (const action of actions.filter(item => item?.type === 'read').slice(0, 5)) {
              const materialId = String(action.materialId || action.id || '');
              const source = candidates.get(materialId);
              const offset = Number(action.offset);
              const length = Number(action.length);
              if (!source || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1
                || length > 1800 || typeof options.readMaterial !== 'function') continue;
              const result = await options.readMaterial(materialId, offset, length);
              if (result?.excerpt) followupFragments.push(`文件 ID：${materialId}\n文件：${result.relativePath || result.title || ''}\n位置：${result.locator || '位置未识别'}\n摘录：\n${result.excerpt}`);
            }
            continue;
          }
          throw failure('INVALID_TASK_SUGGESTION', taskSuggestionError(parsed));
        }
        throw failure('INVALID_TASK_SUGGESTION', '模型未在允许的检索轮次内给出最终任务判断');
      } catch (error) {
        if (error.code) throw error;
        throw failure('MODEL_FAILED', `任务分析失败：${error.message || error}`);
      } finally { signal?.removeEventListener('abort', onAbort); }
    }
    async function createArticle(input = {}) {
      const requestedGenre = input.genre || 'article';
      const supportedGenre = schema.getWritingGenreConfig(requestedGenre) ? requestedGenre : '';
      if (!supportedGenre && input.confirmAsArticle !== true) {
        throw failure('GENRE_CONFIRMATION_REQUIRED', '当前仅支持普通文章，请明确确认按普通文章处理');
      }
      const genre = supportedGenre || 'article';
      const id = newId('article');
      validateProfile(input.styleProfile, id, genre);
      const article = schema.normalizeWritingArticle({ ...input, id, genre, saveEnabled: false, createdAt: now(), updatedAt: now() });
      if (typeof input.constraints === 'string') article.constraints = input.constraints;
      const w = { id, genre, article, rounds: [], styleProfile: prompts.deriveWritingStyleProfile([], {}) };
      if (['fiction', 'script', 'longform-general'].includes(genre)) {
        w.longform = schema.normalizeLongform({ ...(input.longform || {}), mode: genre });
      }
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
      if (patch.genre && patch.genre !== w.article.genre) throw failure('GENRE_CONFIRMATION_REQUIRED', '不能在现有工作区中更换文体');
      validateProfile(patch.styleProfile, id, w.article.genre);
      const save = patch.saveEnabled;
      if (save !== undefined && typeof save !== 'boolean') throw failure('INVALID_INPUT', '保存开关必须为布尔值');
      if (save === false) await setSaveEnabled(id, false);
      const normalized = schema.normalizeWritingArticle(patch);
      // 只清洗这次提交的白名单字段，未改的失败原文继续留在会话供用户修正。
      for (const field of Object.keys(normalized)) {
        if (Object.hasOwn(patch, field) && !['id', 'genre', 'createdAt', 'updatedAt', 'saveEnabled'].includes(field)) w.article[field] = normalized[field];
      }
      if (Object.hasOwn(patch, 'packSelections')) {
        const currentRound = w.rounds.at(-1);
        if (currentRound) {
          currentRound.packSelections = copy(w.article.packSelections || []);
          delete currentRound.packSnapshot;
        }
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
      if (Object.hasOwn(input, 'draftDecision') && input.draftDecision?.status !== 'pending') {
        throw failure('INVALID_INPUT', '新轮次只能以待决定状态接收外部稿件', { articleId: id });
      }
      invalidateResearch(w);
      validateProfile(input.styleProfile, id, w.article.genre);
      const previous = w.rounds.at(-1);
      const parentRoundId = Object.hasOwn(input, 'parentRoundId') ? String(input.parentRoundId || '') : previous?.id || '';
      if (parentRoundId && !w.rounds.some(round => round.id === parentRoundId)) {
        throw failure('ROUND_NOT_FOUND', '父轮次不存在，不能建立历史分支', { articleId: id, roundId: parentRoundId });
      }
      const requestedPromptVersionId = String(input.sourcePromptVersionId || '').trim();
      const knownPromptVersion = requestedPromptVersionId && w.rounds.some(round =>
        (round.promptVersions || []).some(version => version.id === requestedPromptVersionId));
      const unitId = Object.hasOwn(input, 'unitId') ? String(input.unitId || '').trim() : previous?.unitId || '';
      const unit = unitId ? (w.units || []).find(item => item.id === unitId) : null;
      if (unitId && !unit) throw failure('UNIT_NOT_FOUND', '任务单元不存在', { articleId: id, unitId });
      if (unit?.archived) throw failure('UNIT_ARCHIVED', '已归档任务单元不能用于新轮次', { articleId: id, unitId });
      const roundInput = { ...input, ...references(input) };
      const genreConfig = schema.getWritingGenreConfig(w.article.genre);
      const taskType = input.taskType || (w.article.genre === 'academic-paper' ? 'academic-planning'
        : w.article.genre === 'article' ? 'revision' : genreConfig?.taskTypes?.[0]);
      if (w.article.genre === 'academic-paper' && !ACADEMIC_TASK_TYPES.has(taskType)
        || w.article.genre !== 'article' && w.article.genre !== 'academic-paper' && !genreConfig?.taskTypes?.includes(taskType)) {
        throw failure('INVALID_TASK_TYPE', '不支持的学术写作任务', { articleId: id, taskType });
      }
      roundInput.taskType = taskType;
      roundInput.sourcePromptVersionId = knownPromptVersion ? requestedPromptVersionId : '';
      if (unit) {
        roundInput.unitId = unit.id;
        roundInput.unitSnapshot = copy(unit);
      } else {
        delete roundInput.unitSnapshot;
        roundInput.unitId = '';
      }
      const round = schema.normalizeWritingRound({ ...roundInput, id: newId('round'), articleId: id,
        parentRoundId, draft: input.draft ?? w.article.draft, diagnosis: input.diagnosis || '', prompt: '', createdAt: now(), updatedAt: now() });
      if (input.draftDecision) round.draftDecision = { status: 'pending', previousDraft: '', previousDraftRoundId: '', adoptedAt: '', undoneAt: '' };
      if (Object.hasOwn(input, 'packSelections')) w.article.packSelections = round.packSelections;
      else if (Array.isArray(w.article.packSelections)) round.packSelections = copy(w.article.packSelections);
      // 用户的原始强约束和正文不能在生成失败时被规范化截掉。
      for (const field of ['draft', 'feedback', 'userFeedback']) if (typeof input[field] === 'string') round[field] = input[field];
      if (input.draft === undefined) round.draft = w.article.draft;
      w.rounds.push(round);
      failedRounds.add(round);
      if (round.draftDecision?.status !== 'pending') {
        w.article.draft = round.draft;
        w.article.draftRoundId = round.id;
      }
      w.article.updatedAt = now();
      if (input.styleProfile) applyProfile(w, input.styleProfile);
      derive(w, round, input.userCorrections);
      generate(w, round, false, taskType);
      await saveWorkspace(w);
      const notifications = await promotePreferences();
      return copy({ articleId: id, round, notifications });
    }
    async function decideRoundDraft(id, roundId, decision) {
      if (!['adopt', 'keep', 'undo'].includes(decision)) throw failure('INVALID_INPUT', '稿件决定无效', { articleId: id, roundId });
      const w = workspace(id);
      const round = roundFor(id, roundId);
      if (!round.draftDecision) throw failure('DRAFT_DECISION_STALE', '这轮没有待决定的新稿', { articleId: id, roundId });
      const current = round.draftDecision || { status: 'pending', previousDraft: '', previousDraftRoundId: '', adoptedAt: '', undoneAt: '' };
      const previousDecision = copy(current);
      const previousDraft = w.article.draft;
      const previousDraftRoundId = w.article.draftRoundId || '';
      const previousRoundUpdatedAt = round.updatedAt;
      const time = now();
      if (decision === 'keep') {
        if (current.status !== 'pending') throw failure('DRAFT_DECISION_STALE', '这版稿件已处理，不能再次选择保留', { articleId: id, roundId });
        round.draftDecision = { ...current, status: 'kept' };
      } else if (decision === 'adopt') {
        if (!['pending', 'kept', 'undone'].includes(current.status)) throw failure('DRAFT_DECISION_STALE', '这版稿件当前不能采用', { articleId: id, roundId });
        round.draftDecision = { ...current, status: 'adopted', previousDraft, previousDraftRoundId,
          adoptedAt: time, undoneAt: '' };
        w.article.draft = round.draft;
        w.article.draftRoundId = round.id;
      } else {
        if (current.status !== 'adopted' || previousDraftRoundId !== round.id) {
          throw failure('DRAFT_DECISION_STALE', '当前稿件已基于后续版本变化；为避免覆盖新稿，不能撤销这次采用', { articleId: id, roundId });
        }
        round.draftDecision = { ...current, status: 'undone', undoneAt: time };
        w.article.draft = current.previousDraft;
        w.article.draftRoundId = current.previousDraftRoundId;
      }
      round.updatedAt = time;
      w.article.updatedAt = time;
      try {
        await saveWorkspace(w);
      } catch (error) {
        round.draftDecision = previousDecision;
        round.updatedAt = previousRoundUpdatedAt;
        w.article.draft = previousDraft;
        if (previousDraftRoundId) w.article.draftRoundId = previousDraftRoundId;
        else delete w.article.draftRoundId;
        throw error;
      }
      return copy({ round, articleDraft: w.article.draft, articleDraftRoundId: w.article.draftRoundId || '' });
    }
    async function recordResourceUsage(id, resourceId, patch = {}) {
      const w = workspace(id);
      const round = w.rounds.at(-1);
      if (!round) throw failure('ROUND_NOT_FOUND', '当前没有可记录资源状态的轮次', { articleId: id });
      const resource = (round.resourceSnapshot || round.packSnapshot?.resources || []).find(item => item.id === resourceId);
      if (!resource) throw failure('RESOURCE_NOT_FOUND', '资源不在当前轮次快照中', { articleId: id, resourceId });
      const allowed = new Set(['used', 'skipped', 'unavailable', 'pending', 'executed', 'failed']);
      const state = schema.normalizeWritingRound({ ...round,
        resourceUsage: [...(round.resourceUsage || []).filter(item => item.id !== resourceId), {
          id: resourceId, kind: resource.kind, status: allowed.has(patch.status) ? patch.status : 'pending',
          ...(patch.reason ? { reason: String(patch.reason) } : {}),
          ...(patch.outputSummary ? { outputSummary: String(patch.outputSummary) } : {}),
          ...(resource.actionId ? { actionId: resource.actionId } : {}), updatedAt: now()
        }] }).resourceUsage;
      round.resourceUsage = state;
      round.updatedAt = now();
      await saveWorkspace(w);
      return copy(round);
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
    function getMaterialCoverage(id) {
      return copy(workspace(id).materialCoverage || null);
    }
    async function setMaterialCoverage(id, input) {
      const w = workspace(id);
      const snapshot = materialCoverage.createCoverageSnapshot(input);
      if (w.materialCoverage) {
        snapshot.history = [...(w.materialCoverage.history || []), { ...copy(w.materialCoverage), history: [] }].slice(-10);
      }
      w.materialCoverage = snapshot;
      await saveWorkspace(w);
      return copy({ snapshot, summary: materialCoverage.summarizeCoverage(snapshot) });
    }
    async function startMaterialBatch(id, options = {}) {
      const w = workspace(id);
      if (!w.materialCoverage) throw failure('COVERAGE_NOT_FOUND', '请先确认完整资料范围', { articleId: id });
      const round = w.rounds.at(-1);
      if (!round) throw failure('ROUND_NOT_FOUND', '请先创建写作轮次', { articleId: id });
      const started = materialCoverage.createNextBatch(w.materialCoverage, { batchSize: options.batchSize || 3 });
      const provided = Array.isArray(options.materials) ? options.materials : [];
      const byId = new Map(provided.map(item => [String(item.id || ''), item]));
      const batchItems = started.batch.itemIds.map(itemId => {
        const record = started.snapshot.items.find(item => item.id === itemId);
        const source = byId.get(itemId);
        if (!source) throw failure('BATCH_MATERIAL_MISSING', `批次材料不可用：${record.title}`, { articleId: id, sourceId: itemId });
        const currentVersion = String(source.sourceVersion || source.fingerprint || '');
        if (record.sourceVersion && currentVersion !== record.sourceVersion) {
          throw failure('BATCH_SOURCE_CHANGED', `资料版本已变化，请刷新范围后重试：${record.title}`, { articleId: id, sourceId: itemId });
        }
        return { record, excerpt: String(source.excerpt || source.summary || '').slice(0, 1200) };
      });
      const prompt = [
        `写作工作台资料批次：${w.article.title || '未命名项目'}`,
        `当前目标：${w.article.goal || '未提供'}；本次批次 ${started.batch.id}，材料 ${batchItems.length} 项。`,
        '只处理下面明确列出的合成/用户资料摘录；逐项记录已处理内容和范围，遇到不可访问、内容不足或无法判断时说明原因。不得声称阅读未列出的原文件或整个资料库。',
        ...batchItems.map(({ record, excerpt }, index) => `材料 ${index + 1}：${record.title}\n来源 ID：${record.id}\n来源版本：${record.sourceVersion || '未提供'}\n相对位置：${record.relativePath || '未提供'}\n摘录状态：${excerpt ? '已嵌入，来源未核验' : '没有可用摘录；需用户另行提供原材料'}\n摘录：${excerpt || '〔无摘录〕'}`),
        '请返回逐项处理状态、实际使用范围、未处理/失败项及原因，并区分材料内容和需要外部核验的事实。'
      ].join('\n\n');
      if (prompt.length > 8000) throw failure('BATCH_PROMPT_TOO_LARGE', '本批提示词超过 8000 字，请减小批次数或摘录长度', { articleId: id });
      const version = addPromptVersion(round, prompt, 'writing-material-batch', true);
      round.prompt = prompt;
      started.snapshot.batches.at(-1).promptVersionId = version.id;
      w.materialCoverage = started.snapshot;
      derive(w, round);
      await saveWorkspace(w);
      return copy({ batch: started.snapshot.batches.at(-1), promptVersion: version,
        items: batchItems.map(({ record, excerpt }) => ({ ...record, excerpt })),
        summary: materialCoverage.summarizeCoverage(started.snapshot) });
    }
    async function recordMaterialBatchOutcome(id, batchId, outcome) {
      const w = workspace(id);
      w.materialCoverage = materialCoverage.recordBatchOutcome(w.materialCoverage, batchId, outcome);
      await saveWorkspace(w);
      return copy({ snapshot: w.materialCoverage, summary: materialCoverage.summarizeCoverage(w.materialCoverage) });
    }
    async function confirmMaterialBatch(id, batchId, confirmation) {
      const w = workspace(id);
      w.materialCoverage = materialCoverage.confirmBatch(w.materialCoverage, batchId, confirmation);
      await saveWorkspace(w);
      return copy({ snapshot: w.materialCoverage, summary: materialCoverage.summarizeCoverage(w.materialCoverage) });
    }
    async function retryMaterialBatch(id, batchId) {
      const w = workspace(id);
      w.materialCoverage = materialCoverage.retryFailedBatch(w.materialCoverage, batchId);
      await saveWorkspace(w);
      return copy({ snapshot: w.materialCoverage, summary: materialCoverage.summarizeCoverage(w.materialCoverage) });
    }
    async function excludeMaterialFromCoverage(id, sourceId, reason) {
      const w = workspace(id);
      w.materialCoverage = materialCoverage.excludeItem(w.materialCoverage, sourceId, reason);
      await saveWorkspace(w);
      return copy({ snapshot: w.materialCoverage, summary: materialCoverage.summarizeCoverage(w.materialCoverage) });
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
      const sources = (Array.isArray(selected) ? selected : []).map(m => {
        const authorizedDirectory = Boolean(m.relativePath) || m.origin === 'authorized-directory'
          || String(m.type || '').startsWith('local-source-');
        const libraryEntry = Boolean(m.type) && !authorizedDirectory;
        return ({
        title: m.title || '参考资料',
        url: /^https?:\/\//i.test(m.location || '') ? m.location : '', excerpt: m.excerpt || m.summary || '',
        purpose: m.purpose || 'content', verificationStatus: m.verificationStatus || 'unverified',
        ...(m.sourceId ? { sourceId: m.sourceId } : m.id ? { sourceId: m.id } : {}),
        ...(m.relativePath || m.location ? { sourceLocator: m.relativePath || m.location } : {}),
        ...( /^[a-f0-9]{64}$/i.test(String(m.fingerprint || '')) ? { sourceVersion: `sha256:${String(m.fingerprint).toLowerCase()}` } : {}),
        ...(Array.isArray(m.fragments) && m.fragments.some(fragment => Number.isSafeInteger(fragment?.line) && fragment.line > 0)
          ? { excerptLocator: `第 ${m.fragments.find(fragment => Number.isSafeInteger(fragment?.line) && fragment.line > 0).line} 行` } : {}),
        ...(m.useReason ? { selectionReason: m.useReason } : {}),
        ...(m.sourceType ? { sourceType: m.sourceType } : authorizedDirectory ? { sourceType: 'authorized-directory' }
          : libraryEntry ? { sourceType: 'library-entry' } : {}),
        ...(m.origin ? { origin: m.origin } : authorizedDirectory ? { origin: 'authorized-directory' }
          : libraryEntry ? { origin: 'knowledge-library' } : { origin: 'local-search' }),
        ...(typeof m.attachmentRequired === 'boolean' ? { attachmentRequired: m.attachmentRequired }
          : authorizedDirectory ? { attachmentRequired: true } : {}),
        ...(m.excerpt ? { contentStatus: 'embedded' } : { contentStatus: 'reference-only' })
      });
      });
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
      ensurePackSnapshot(w, round);
      if (typeof dependencies.requestModel !== 'function') throw failure('MODEL_UNAVAILABLE', '未配置模型发送预览');
      const diagnosisInput = inputFor(w, round);
      const genreConfig = schema.getWritingGenreConfig(w.article.genre);
      const domainTaskType = w.article.genre !== 'article' && w.article.genre !== 'academic-paper'
        ? round.taskType || genreConfig?.taskTypes?.[0] : '';
      const prompt = w.article.genre === 'academic-paper'
        ? prompts.buildAcademicWritingPrompt(diagnosisInput, 'diagnosis')
        : domainTaskType
          ? prompts.buildDomainWritingPrompt(diagnosisInput, domainTaskType, { phase: 'diagnosis' })
          : prompts.buildWritingDiagnosisPrompt(diagnosisInput);
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
      const candidates = parseDiagnosisIssueCandidates(diagnosis, round);
      const remainingIssueSlots = Math.max(0, 200 - (w.issues || []).length);
      const validCandidates = candidates && candidates.length <= remainingIssueSlots ? candidates : null;
      const diagnosisPromptVersion = addPromptVersion(round, prompt, 'diagnosis', true);
      const revisionInput = { ...inputFor(w, round), round: { ...round, diagnosis } };
      const nextPrompt = w.article.genre === 'academic-paper'
        ? prompts.buildAcademicWritingPrompt(revisionInput, 'revision')
        : domainTaskType
          ? prompts.buildDomainWritingPrompt(revisionInput, domainTaskType, { phase: 'revision' })
          : prompts.buildWritingRevisionPrompt(revisionInput);
      if (w.article.genre === 'academic-paper') round.taskType = 'revision';
      else if (domainTaskType) addPromptVersion(round, nextPrompt, domainTaskType, true);
      Object.assign(round, { diagnosis, diagnosisParseStatus: validCandidates ? 'parsed' : 'unparsed',
        prompt: nextPrompt, updatedAt: now() });
      w.issues = w.issues || [];
      if (validCandidates?.length) {
        const generatedIssues = validCandidates.map(candidate => schema.normalizeWritingIssue({
          ...candidate, id: newId('issue'), roundId: round.id, promptVersionId: diagnosisPromptVersion.id,
          unitId: round.unitId || '', judgment: 'candidate', status: 'pending-user'
        }));
        w.issues = [...(w.issues || []), ...generatedIssues];
      }
      failedRounds.delete(round);
      await saveWorkspace(w);
      return copy({ articleId: id, roundId: round.id, diagnosis, diagnosisParseStatus: round.diagnosisParseStatus, prompt: nextPrompt });
    }
    async function rememberPreference(id, input = {}) {
      const w = workspace(id);
      const config = schema.getWritingGenreConfig(w.article.genre);
      const namespace = config?.memoryNamespace || '';
      const scope = input.scope || 'general';
      if (!schema.MEMORY_SCOPES.includes(scope) || input.genre && input.genre !== namespace) {
        throw failure('INVALID_INPUT', '记忆范围必须为通用、当前文体或当前工作区');
      }
      if (typeof input.preference !== 'string' || !input.preference.trim()) throw failure('INVALID_INPUT', '记忆偏好不能为空');
      const memory = schema.normalizeWritingMemory({ ...input, id: newId('memory'), scope, genre: namespace,
        origin: 'user-confirmed', status: 'confirmed', enabled: true,
        projectId: scope === 'project' ? id : '', articleId: scope === 'article' ? id : '',
        sourceArticleId: id, evidenceArticleIds: [id], createdAt: now(), updatedAt: now() });
      memory.sourcePreferenceKey = key(memory.preference);
      await saveMemory(memory);
      memories.set(memory.id, memory);
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
      const currentContent = Object.fromEntries(['preference', 'reason', 'example', 'counterexample'].map(field => [field, memory[field] || '']));
      const nextContent = { ...currentContent, ...editable };
      const history = JSON.stringify(currentContent) === JSON.stringify(nextContent) ? (memory.history || [])
        : [...(memory.history || []), { id: newId('memory-version'), ...currentContent, savedAt: memory.updatedAt || now() }].slice(-10);
      const updated = schema.normalizeWritingMemory({ ...memory, ...editable, history,
        ...(sourcePreferenceKey ? { sourcePreferenceKey } : {}), updatedAt: now() });
      await saveMemory(updated);
      memories.set(id, updated);
      return copy(updated);
    }
    async function confirmMemory(id, patch = {}) {
      const memory = findMemory(id);
      if (memory.status !== 'pending') throw failure('MEMORY_STATUS_STALE', '这条建议已处理，请刷新后再试', { memoryId: id });
      const scope = patch.scope || memory.scope;
      if (!['general', 'genre'].includes(scope)) throw failure('INVALID_INPUT', '待确认建议只能应用于通用或当前文体范围');
      if (Object.hasOwn(patch, 'preference') && !String(patch.preference || '').trim()) throw failure('INVALID_INPUT', '记忆偏好不能为空');
      const namespace = schema.getWritingGenreConfig(memory.genre)?.memoryNamespace || '';
      const updated = schema.normalizeWritingMemory({ ...memory, ...Object.fromEntries(['preference', 'reason', 'example', 'counterexample']
        .filter(field => Object.hasOwn(patch, field)).map(field => [field, patch[field]])),
      scope, genre: scope === 'genre' ? namespace : '', projectId: '', articleId: '', status: 'confirmed', enabled: true,
      undo: {}, updatedAt: now(), sourcePreferenceKey: memory.sourcePreferenceKey || key(memory.preference) });
      await saveMemory(updated);
      memories.set(id, updated);
      return copy(updated);
    }
    async function ignoreMemory(id) {
      const memory = findMemory(id);
      if (memory.status !== 'pending') throw failure('MEMORY_STATUS_STALE', '只有待确认建议可以忽略', { memoryId: id });
      const updated = schema.normalizeWritingMemory({ ...memory, status: 'ignored', enabled: false, updatedAt: now() });
      await saveMemory(updated);
      memories.set(id, updated);
      return copy(updated);
    }
    async function restoreMemory(id) {
      const memory = findMemory(id);
      if (memory.status === 'ignored') {
        const updated = schema.normalizeWritingMemory({ ...memory,
          status: memory.origin === 'repeated-round' ? 'pending' : 'confirmed',
          enabled: memory.origin !== 'repeated-round', undo: {}, updatedAt: now() });
        await saveMemory(updated);
        memories.set(id, updated);
        return copy(updated);
      }
      return setMemoryEnabled(id, true);
    }
    async function setMemoryEnabled(id, enabled) {
      const memory = findMemory(id);
      if (memory.status !== 'confirmed' || typeof enabled !== 'boolean') throw failure('INVALID_INPUT', '只能启用或停用已确认偏好');
      const updated = schema.normalizeWritingMemory({ ...memory, enabled, undo: enabled ? {} : memory.undo, updatedAt: now() });
      await saveMemory(updated);
      memories.set(id, updated);
      return copy(updated);
    }
    async function restoreMemoryVersion(id, versionId, expectedUpdatedAt) {
      const memory = findMemory(id);
      if (expectedUpdatedAt && memory.updatedAt !== expectedUpdatedAt) throw failure('MEMORY_VERSION_STALE', '此偏好已有更新，请刷新后重新选择版本', { memoryId: id });
      const version = (memory.history || []).find(item => item.id === versionId);
      if (!version) throw failure('MEMORY_VERSION_NOT_FOUND', '找不到要恢复的偏好版本', { memoryId: id, versionId });
      const currentContent = Object.fromEntries(['preference', 'reason', 'example', 'counterexample'].map(field => [field, memory[field] || '']));
      const history = [...(memory.history || []), { id: newId('memory-version'), ...currentContent, savedAt: memory.updatedAt || now() }].slice(-10);
      const updated = schema.normalizeWritingMemory({ ...memory, ...Object.fromEntries(['preference', 'reason', 'example', 'counterexample']
        .map(field => [field, version[field] || ''])), history, updatedAt: now() });
      await saveMemory(updated);
      memories.set(id, updated);
      return copy(updated);
    }
    async function setMemorySkipped(id, memoryId, skipped) {
      if (typeof skipped !== 'boolean') throw failure('INVALID_INPUT', '跳过状态必须是布尔值', { articleId: id, memoryId });
      const w = workspace(id);
      if (!getRelevantMemories(w.genre, id, { includeSkipped: true }).some(item => item.id === memoryId)) {
        throw failure('MEMORY_NOT_APPLICABLE', '该偏好不适用于当前写作任务', { articleId: id, memoryId });
      }
      const excluded = new Set(w.article.skippedMemoryIds || []);
      const previous = [...excluded];
      const previousUpdatedAt = w.article.updatedAt;
      if (skipped) excluded.add(memoryId); else excluded.delete(memoryId);
      w.article.skippedMemoryIds = [...excluded];
      w.article.updatedAt = now();
      try { await saveWorkspace(w); }
      catch (error) { w.article.skippedMemoryIds = previous; w.article.updatedAt = previousUpdatedAt; throw error; }
      return getRelevantMemories(w.genre, id);
    }
    async function deleteMemory(id) {
      const memory = findMemory(id);
      // 跨篇记忆删除后保留原候选墓碑；单篇删除不扩大为全局抑制。
      if (memory.scope !== 'article') {
        const updated = schema.normalizeWritingMemory({ ...memory, sourcePreferenceKey: memory.sourcePreferenceKey || key(memory.preference),
          status: memory.status === 'pending' ? 'ignored' : 'confirmed', enabled: false,
          undo: { ...memory.undo, memoryId: id, undoneAt: now() }, updatedAt: now() });
        await saveMemory(updated);
        memories.set(id, updated);
        return { deleted: true, memoryId: id };
      }
      await persist(s => ({ ...s, writingMemories: (s.writingMemories || []).filter(m => m.id !== id) }), { memoryId: id });
      memories.delete(id);
      return { deleted: true, memoryId: id };
    }
    async function undoMemory(id) {
      const memory = findMemory(id);
      const updated = schema.normalizeWritingMemory({ ...memory,
        status: memory.status === 'pending' ? 'ignored' : 'confirmed', enabled: false,
        undo: { ...memory.undo, memoryId: id, undoneAt: now() }, updatedAt: now() });
      await saveMemory(updated);
      memories.set(id, updated);
      return { undone: true, memoryId: id };
    }
    async function promotePreferences() {
      const all = new Map((state().writingArticles || []).map(w => [w.id, w]));
      for (const [id, w] of sessions) all.set(id, w);
      const candidates = new Map();
      for (const [id, w] of all) for (const round of w.rounds || []) for (const p of round.preferences || []) {
        const normalizedKey = key(p.preference);
        if (!normalizedKey) continue;
        const genre = w.article.genre || 'article';
        const candidateKey = `${genre}\u0000${normalizedKey}`;
        if (!candidates.has(candidateKey)) candidates.set(candidateKey, { ...p, genre, normalizedKey, ids: new Set() });
        candidates.get(candidateKey).ids.add(id);
      }
      const notifications = [];
      for (const candidate of candidates.values()) {
        const { genre, normalizedKey } = candidate;
        if (candidate.ids.size < 2) continue;
        const namespace = schema.getWritingGenreConfig(genre)?.memoryNamespace || '';
        const existing = [...memories.values()].find(m => (m.scope === 'general' || m.scope === 'genre' && m.genre === namespace)
          && (key(m.preference) === normalizedKey || m.sourcePreferenceKey === normalizedKey));
        if (existing?.status === 'ignored' || existing?.undo?.undoneAt) continue;
        if (existing) {
          const ids = [...new Set([...existing.evidenceArticleIds, ...candidate.ids])];
          if (ids.length !== existing.evidenceArticleIds.length || pendingMemories.has(existing.id)) {
            const updated = schema.normalizeWritingMemory({ ...existing, evidenceArticleIds: ids, updatedAt: now() });
            await saveMemory(updated);
            memories.set(existing.id, updated);
          }
          continue;
        }
        const id = newId('memory');
        const memory = schema.normalizeWritingMemory({ ...candidate, id, scope: 'genre', genre: namespace, sourcePreferenceKey: normalizedKey,
          sourceArticleId: [...candidate.ids][0], evidenceArticleIds: [...candidate.ids],
          origin: 'repeated-round', status: 'pending', enabled: false,
          reason: '在多篇稿件中重复提交的本轮偏好，待用户确认后才会应用。',
          undo: { action: 'auto-promote', memoryId: id }, createdAt: now(), updatedAt: now() });
        await saveMemory(memory);
        memories.set(id, memory);
        notifications.push({ type: 'memory-candidate', message: '发现跨文章重复的偏好建议；确认后才会应用。', memoryId: id });
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
    return { analyzeTask, createArticle, openArticle: getWorkspace, getWorkspace, listArticles, listMemories, updateArticle, appendRound, decideRoundDraft,
      addUnit, updateUnit, archiveUnit, setMaterialUnits, addIssue, updateIssue, recordResourceUsage, listRoutes, selectRoute, advanceRoute,
      updateLongformProject, saveLongformItem, reviewLongformImpact,
      getMaterialCoverage, setMaterialCoverage, startMaterialBatch, recordMaterialBatchOutcome,
      confirmMaterialBatch, retryMaterialBatch, excludeMaterialFromCoverage,
      recordPromptVersion, markPromptVersionCopied, compareRounds, continueFromRound,
      setSaveEnabled, deleteArticle, getRounds: id => copy(workspace(id).rounds),
      readRound: (id, roundId) => copy(roundFor(id, roundId)), correctStyleProfile,
      build, diagnose: build, runModelDiagnosis, selectMaterials, rememberPreference, confirmMemory, ignoreMemory, restoreMemory,
      setMemoryEnabled, setMemorySkipped, restoreMemoryVersion, editMemory, deleteMemory, undoMemory, getRelevantMemories, refreshFromStorage, reset: refreshFromStorage,
      previewResearch, approveResearch, rejectResearch, cancelResearch, getResearchState };
  }
  return { createWritingWorkbenchCoordinator };
});
