(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepAcademicPublishing = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const TASK_TYPES = Object.freeze(['citation-check', 'reviewer-response', 'submission-prep']);
  const CLAIM_RELATIONS = Object.freeze(['unassessed', 'supports', 'partially-supports', 'does-not-support', 'contradicts', 'insufficient']);
  const METADATA_STATES = Object.freeze(['unverified', 'registry-returned', 'user-verified']);
  const READING_STATES = Object.freeze(['unread', 'title-only', 'abstract-only', 'excerpt-only', 'full-text-user-confirmed']);
  const REVIEW_STATUSES = Object.freeze(['unresolved', 'planned', 'revised', 'no-change']);
  const CHECKLIST_STATUSES = Object.freeze(['todo', 'complete', 'not-applicable', 'blocked']);
  const MAX_PROJECTS = 100;
  const MAX_CLAIMS = 300;
  const MAX_SOURCES_PER_CLAIM = 30;
  const MAX_REVIEW_ROUNDS = 30;
  const MAX_COMMENTS_PER_ROUND = 200;
  const MAX_REQUIREMENTS = 200;
  const MAX_CHECKLIST_ITEMS = 500;
  const MAX_HISTORY = 200;
  const MAX_PROMPT_CHARS = 8000;
  const MAX_RESULT_CHARS = 20000;
  const SECRET_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*[^\s,;]+/gi;
  const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\)[^\s"'<>]*/g;

  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function makeId(prefix) {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`;
  }
  function fail(message, code = 'INVALID_ACADEMIC_PUBLISHING') {
    return Object.assign(new Error(message), { code });
  }
  function text(value, limit, label = '文本') {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') throw fail(`${label}必须是文本。`);
    const clean = value.trim();
    if (clean.length > limit) throw fail(`${label}最多 ${limit} 字。`, 'TEXT_LIMIT_EXCEEDED');
    return clean.replace(SECRET_PATTERN, '[凭证已省略]').replace(LOCAL_PATH_PATTERN, '[本机路径已省略]');
  }
  function uniqueId(value, prefix) {
    const id = text(value, 120, 'ID');
    return id || makeId(prefix);
  }
  function enumValue(value, choices, fallback) { return choices.includes(value) ? value : fallback; }
  function list(value, normalizer, limit, label) {
    if (!Array.isArray(value)) return [];
    if (value.length > limit) throw fail(`${label}最多 ${limit} 项。`, 'ITEM_LIMIT_EXCEEDED');
    const normalized = value.map(normalizer);
    const ids = new Set();
    for (const item of normalized) {
      if (!item.id) continue;
      if (ids.has(item.id)) throw fail(`${label}存在重复 ID：${item.id}。`, 'DUPLICATE_ID');
      ids.add(item.id);
    }
    return normalized;
  }

  function normalizeBibliographySnapshot(value = {}) {
    const source = isObject(value) ? value : {};
    const authors = Array.isArray(source.authors) ? source.authors : [];
    if (authors.length > 30) throw fail('单条文献作者最多 30 人。', 'ITEM_LIMIT_EXCEEDED');
    return {
      title: text(source.title, 1000, '文献题名'),
      authors: authors.map(author => text(author, 200, '作者')).filter(Boolean),
      year: text(source.year, 20, '出版年份'),
      publication: text(source.publication, 500, '刊物/出版物'),
      volume: text(source.volume, 50, '卷'),
      issue: text(source.issue, 50, '期'),
      pages: text(source.pages, 100, '页码'),
      doi: text(source.doi, 240, 'DOI').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/[.,;\s]+$/g, '').toLowerCase(),
      pmid: text(source.pmid, 40, 'PMID'),
      metadataProvider: text(source.metadataProvider, 120, '题录来源'),
      queriedAt: text(source.queriedAt, 80, '查询时间'),
      metadataStatus: enumValue(source.metadataStatus, METADATA_STATES, 'unverified'),
      readingStatus: enumValue(source.readingStatus, READING_STATES, 'unread')
    };
  }

  function normalizeCitationSource(value = {}) {
    const source = isObject(value) ? value : {};
    const relation = enumValue(source.relation, CLAIM_RELATIONS, 'unassessed');
    const normalized = {
      id: uniqueId(source.id, 'citation-source'),
      knowledgeEntryId: text(source.knowledgeEntryId, 120, '文献 ID'),
      citationLabel: text(source.citationLabel, 500, '稿件引文'),
      snapshot: normalizeBibliographySnapshot(source.snapshot),
      metadataStatus: enumValue(source.metadataStatus ?? source.snapshot?.metadataStatus, METADATA_STATES, 'unverified'),
      readingStatus: enumValue(source.readingStatus ?? source.snapshot?.readingStatus, READING_STATES, 'unread'),
      relation,
      evidenceExcerpt: text(source.evidenceExcerpt, 1200, '证据摘录'),
      evidenceLocation: text(source.evidenceLocation, 300, '证据位置'),
      userNote: text(source.userNote, 2000, '核验备注'),
      updatedAt: text(source.updatedAt, 80, '更新时间')
    };
    if (relation !== 'unassessed' && !normalized.evidenceExcerpt && !normalized.evidenceLocation) {
      throw fail('确认论断关系前，请记录可见依据摘录或原文位置。', 'EVIDENCE_REQUIRED');
    }
    return normalized;
  }

  function normalizeCitationClaim(value = {}) {
    const source = isObject(value) ? value : {};
    return {
      id: uniqueId(source.id, 'claim'),
      statement: text(source.statement, 5000, '稿件论断'),
      manuscriptLocation: text(source.manuscriptLocation, 500, '稿件位置'),
      note: text(source.note, 2000, '备注'),
      sources: list(source.sources, normalizeCitationSource, MAX_SOURCES_PER_CLAIM, '论断来源'),
      createdAt: text(source.createdAt, 80, '创建时间'),
      updatedAt: text(source.updatedAt, 80, '更新时间')
    };
  }

  function normalizeReviewerComment(value = {}) {
    const source = isObject(value) ? value : {};
    const status = enumValue(source.status, REVIEW_STATUSES, 'unresolved');
    const comment = {
      id: uniqueId(source.id, 'comment'),
      reviewer: text(source.reviewer, 160, '审稿人/编辑'),
      rawComment: text(source.rawComment, 5000, '审稿意见'),
      manuscriptLocation: text(source.manuscriptLocation, 500, '意见对应位置'),
      severity: text(source.severity, 80, '意见级别'),
      responseDraft: text(source.responseDraft, 5000, '回应草稿'),
      status,
      changeSummary: text(source.changeSummary, 2000, '实际改动摘要'),
      changeLocation: text(source.changeLocation, 500, '实际改动位置'),
      beforeExcerpt: text(source.beforeExcerpt, 1200, '改动前摘录'),
      afterExcerpt: text(source.afterExcerpt, 1200, '改动后摘录'),
      noChangeReason: text(source.noChangeReason, 2000, '不修改理由'),
      createdAt: text(source.createdAt, 80, '创建时间'),
      updatedAt: text(source.updatedAt, 80, '更新时间')
    };
    validateReviewerResolution(comment);
    return comment;
  }

  function validateReviewerResolution(comment) {
    if (comment.status === 'revised' && (!comment.changeLocation || !comment.changeSummary || (!comment.afterExcerpt && !comment.beforeExcerpt))) {
      throw fail('标为已修改时，必须记录实际改动摘要、稿件位置和改动前/后摘录之一。', 'REVISION_EVIDENCE_REQUIRED');
    }
    if (comment.status === 'no-change' && !comment.noChangeReason) {
      throw fail('标为不修改时，必须说明理由。', 'NO_CHANGE_REASON_REQUIRED');
    }
  }

  function normalizeReviewerRound(value = {}) {
    const source = isObject(value) ? value : {};
    return {
      id: uniqueId(source.id, 'review-round'),
      title: text(source.title, 240, '审稿轮次'),
      decision: text(source.decision, 500, '编辑决定'),
      receivedAt: text(source.receivedAt, 80, '收件日期'),
      sourceLabel: text(source.sourceLabel, 200, '意见来源'),
      comments: list(source.comments, normalizeReviewerComment, MAX_COMMENTS_PER_ROUND, '审稿意见'),
      createdAt: text(source.createdAt, 80, '创建时间')
    };
  }

  function normalizeRequirement(value = {}) {
    const source = isObject(value) ? value : {};
    const status = enumValue(source.verificationStatus, ['unverified', 'source-reviewed', 'user-confirmed'], 'unverified');
    return {
      id: uniqueId(source.id, 'requirement'),
      title: text(source.title, 300, '要求标题'),
      body: text(source.body, 5000, '要求原文/摘录'),
      issuer: text(source.issuer, 300, '发布机构'),
      target: text(source.target, 300, '适用目标'),
      version: text(source.version, 160, '要求版本'),
      effectiveDate: text(source.effectiveDate, 80, '生效日期'),
      sourceUrl: text(source.sourceUrl, 1000, '来源链接'),
      sourceLocator: text(source.sourceLocator, 500, '来源位置'),
      verificationStatus: status,
      applicability: text(source.applicability, 1000, '适用性说明')
    };
  }

  function normalizeChecklistItem(value = {}) {
    const source = isObject(value) ? value : {};
    const status = enumValue(source.status, CHECKLIST_STATUSES, 'todo');
    return {
      id: uniqueId(source.id, 'check'),
      title: text(source.title, 300, '清单项'),
      requirementId: text(source.requirementId, 120, '要求 ID'),
      custom: source.custom === true,
      expected: text(source.expected, 2000, '预期内容'),
      status,
      evidence: text(source.evidence, 2000, '核对证据'),
      reason: text(source.reason, 2000, '处理理由'),
      checkedAt: text(source.checkedAt, 80, '核对时间')
    };
  }

  function normalizeHistoryItem(value = {}) {
    const source = isObject(value) ? value : {};
    const resultSource = enumValue(source.resultSource, ['none', 'simulation', 'external-copy', 'manual'], 'none');
    return {
      id: uniqueId(source.id, 'prompt-round'),
      taskType: enumValue(source.taskType, TASK_TYPES, 'citation-check'),
      prompt: text(source.prompt, MAX_PROMPT_CHARS, '提示词'),
      parentId: text(source.parentId, 120, '父提示词 ID'),
      status: enumValue(source.status, ['generated', 'edited', 'copied', 'returned'], source.result ? 'returned' : 'generated'),
      selectedIds: [...new Set((Array.isArray(source.selectedIds) ? source.selectedIds : []).map(id => text(id, 120, '所选 ID')).filter(Boolean))].slice(0, 500),
      result: text(source.result, MAX_RESULT_CHARS, '外部结果'),
      resultSource,
      resultStatus: source.result ? 'pending-user-review' : 'none',
      packSnapshot: normalizePackSnapshot(source.packSnapshot),
      createdAt: text(source.createdAt, 80, '创建时间')
    };
  }

  function normalizePackSnapshot(value = {}) {
    const source = isObject(value) ? value : {};
    const sourceIds = [...new Set((Array.isArray(source.sourceIds) ? source.sourceIds : []).map(id => text(id, 120, '来源 ID')).filter(Boolean))].slice(0, 100);
    const version = Number.isSafeInteger(source.version) && source.version >= 0 ? source.version : 0;
    const sources = (Array.isArray(source.sources) ? source.sources : []).slice(0, 100).map(item => ({
      id: text(item?.id, 120, '来源 ID'),
      title: text(item?.title, 300, '来源标题'),
      url: text(item?.url, 1000, '来源链接'),
      version: text(item?.version, 160, '来源版本'),
      verificationStatus: enumValue(item?.verificationStatus, ['unverified', 'source-reviewed', 'user-confirmed'], 'unverified')
    })).filter(item => item.id);
    return {
      id: text(source.id, 120, '基础包 ID'),
      name: text(source.name, 300, '基础包名称'),
      version,
      sourceIds,
      sources
    };
  }

  function normalizeProject(input = {}) {
    const source = isObject(input) ? input : {};
    const project = {
      id: uniqueId(source.id, 'academic-publishing'),
      title: text(source.title, 300, '项目标题'),
      taskType: enumValue(source.taskType, TASK_TYPES, 'citation-check'),
      packSnapshot: normalizePackSnapshot(source.packSnapshot),
      target: {
        venue: text(source.target?.venue, 300, '目标期刊/机构'),
        submissionType: text(source.target?.submissionType, 200, '投稿类型'),
        manuscriptVersion: text(source.target?.manuscriptVersion, 160, '稿件版本'),
        requirementVersion: text(source.target?.requirementVersion, 160, '要求版本'),
        effectiveDate: text(source.target?.effectiveDate, 80, '要求生效日期'),
        note: text(source.target?.note, 2000, '目标备注')
      },
      citationClaims: list(source.citationClaims, normalizeCitationClaim, MAX_CLAIMS, '论断'),
      reviewerRounds: list(source.reviewerRounds, normalizeReviewerRound, MAX_REVIEW_ROUNDS, '审稿轮次'),
      requirements: list(source.requirements, normalizeRequirement, MAX_REQUIREMENTS, '要求来源'),
      checklist: list(source.checklist, normalizeChecklistItem, MAX_CHECKLIST_ITEMS, '投稿清单'),
      history: list(source.history, normalizeHistoryItem, MAX_HISTORY, '提示词历史'),
      saveEnabled: source.saveEnabled === true,
      createdAt: text(source.createdAt, 80, '创建时间') || new Date().toISOString(),
      updatedAt: text(source.updatedAt, 80, '更新时间') || new Date().toISOString()
    };
    if (!project.title) throw fail('请填写项目标题。', 'TITLE_REQUIRED');
    return project;
  }

  function createProject(input = {}) {
    return normalizeProject({ ...input, id: input.id || makeId('academic-publishing'), title: input.title || '新建学术核验项目' });
  }

  function replaceProjectList(projectInput, field, values) {
    const project = normalizeProject(projectInput);
    return normalizeProject({ ...project, [field]: values, updatedAt: new Date().toISOString() });
  }

  function addCitationClaim(projectInput, input) {
    const project = normalizeProject(projectInput);
    if (project.citationClaims.length >= MAX_CLAIMS) throw fail(`每个项目最多 ${MAX_CLAIMS} 条论断。`, 'ITEM_LIMIT_EXCEEDED');
    const claim = normalizeCitationClaim(input);
    if (project.citationClaims.some(item => item.id === claim.id)) throw fail(`论断 ID 重复：${claim.id}。`, 'DUPLICATE_ID');
    if (!claim.statement) throw fail('请填写稿件论断。', 'CLAIM_REQUIRED');
    return replaceProjectList(project, 'citationClaims', [claim, ...project.citationClaims]);
  }

  function updateCitationSource(projectInput, claimId, sourceId, changes = {}) {
    const project = normalizeProject(projectInput);
    let found = false;
    const claims = project.citationClaims.map(claim => {
      if (claim.id !== claimId) return claim;
      const sources = claim.sources.map(source => {
        if (source.id !== sourceId) return source;
        found = true;
        return normalizeCitationSource({ ...source, ...changes, updatedAt: new Date().toISOString() });
      });
      return { ...claim, sources };
    });
    if (!found) throw fail('找不到需要更新的文献关联。', 'SOURCE_NOT_FOUND');
    return replaceProjectList(project, 'citationClaims', claims);
  }

  function addReviewerRound(projectInput, input) {
    const project = normalizeProject(projectInput);
    if (project.reviewerRounds.length >= MAX_REVIEW_ROUNDS) throw fail(`每个项目最多 ${MAX_REVIEW_ROUNDS} 轮审稿。`, 'ITEM_LIMIT_EXCEEDED');
    const round = normalizeReviewerRound(input);
    if (project.reviewerRounds.some(item => item.id === round.id)) throw fail(`审稿轮次 ID 重复：${round.id}。`, 'DUPLICATE_ID');
    if (!round.title) throw fail('请填写审稿轮次。');
    return replaceProjectList(project, 'reviewerRounds', [round, ...project.reviewerRounds]);
  }

  function addReviewerComment(projectInput, roundId, input) {
    const project = normalizeProject(projectInput);
    let found = false;
    const rounds = project.reviewerRounds.map(round => {
      if (round.id !== roundId) return round;
      found = true;
      if (round.comments.length >= MAX_COMMENTS_PER_ROUND) throw fail(`每轮最多 ${MAX_COMMENTS_PER_ROUND} 条审稿意见。`, 'ITEM_LIMIT_EXCEEDED');
      const comment = normalizeReviewerComment(input);
      if (!comment.rawComment) throw fail('请填写审稿意见原文。');
      if (round.comments.some(item => item.id === comment.id)) throw fail(`审稿意见 ID 重复：${comment.id}。`, 'DUPLICATE_ID');
      return { ...round, comments: [comment, ...round.comments] };
    });
    if (!found) throw fail('找不到审稿轮次。', 'ROUND_NOT_FOUND');
    return replaceProjectList(project, 'reviewerRounds', rounds);
  }

  function resolveReviewerComment(projectInput, roundId, commentId, resolution = {}) {
    const project = normalizeProject(projectInput);
    let found = false;
    const rounds = project.reviewerRounds.map(round => {
      if (round.id !== roundId) return round;
      const comments = round.comments.map(comment => {
        if (comment.id !== commentId) return comment;
        found = true;
        return normalizeReviewerComment({ ...comment, ...resolution, updatedAt: new Date().toISOString() });
      });
      return { ...round, comments };
    });
    if (!found) throw fail('找不到审稿意见。', 'COMMENT_NOT_FOUND');
    return replaceProjectList(project, 'reviewerRounds', rounds);
  }

  function addRequirementCard(projectInput, input) {
    const project = normalizeProject(projectInput);
    if (project.requirements.length >= MAX_REQUIREMENTS) throw fail(`每个项目最多 ${MAX_REQUIREMENTS} 条要求来源。`, 'ITEM_LIMIT_EXCEEDED');
    const requirement = normalizeRequirement(input);
    if (!requirement.title) throw fail('请填写要求标题。');
    if (project.requirements.some(item => item.id === requirement.id)) throw fail(`要求 ID 重复：${requirement.id}。`, 'DUPLICATE_ID');
    return replaceProjectList(project, 'requirements', [requirement, ...project.requirements]);
  }

  function updateRequirementCard(projectInput, requirementId, changes = {}) {
    const project = normalizeProject(projectInput);
    let found = false;
    const requirements = project.requirements.map(requirement => {
      if (requirement.id !== requirementId) return requirement;
      found = true;
      return normalizeRequirement({ ...requirement, ...changes });
    });
    if (!found) throw fail('找不到目标要求来源。', 'REQUIREMENT_NOT_FOUND');
    return replaceProjectList(project, 'requirements', requirements);
  }

  function addChecklistItem(projectInput, input) {
    const project = normalizeProject(projectInput);
    if (project.checklist.length >= MAX_CHECKLIST_ITEMS) throw fail(`每个项目最多 ${MAX_CHECKLIST_ITEMS} 项投稿清单。`, 'ITEM_LIMIT_EXCEEDED');
    const item = normalizeChecklistItem(input);
    if (!item.title) throw fail('请填写投稿检查项。');
    if (!item.requirementId && !item.custom) throw fail('清单项需关联要求来源，或明确标记为自定义项。');
    if (item.requirementId && !project.requirements.some(requirement => requirement.id === item.requirementId)) {
      throw fail('清单项关联的要求来源不存在。', 'REQUIREMENT_NOT_FOUND');
    }
    if (project.checklist.some(existing => existing.id === item.id)) throw fail(`清单 ID 重复：${item.id}。`, 'DUPLICATE_ID');
    return replaceProjectList(project, 'checklist', [item, ...project.checklist]);
  }

  function updateChecklistItem(projectInput, itemId, changes = {}) {
    const project = normalizeProject(projectInput);
    let found = false;
    const checklist = project.checklist.map(item => {
      if (item.id !== itemId) return item;
      found = true;
      const updated = normalizeChecklistItem({ ...item, ...changes, checkedAt: changes.status && changes.status !== 'todo' ? new Date().toISOString() : item.checkedAt });
      if (!updated.requirementId && !updated.custom) throw fail('清单项需关联要求来源，或明确标记为自定义项。');
      if (updated.requirementId && !project.requirements.some(requirement => requirement.id === updated.requirementId)) throw fail('清单项关联的要求来源不存在。');
      return updated;
    });
    if (!found) throw fail('找不到投稿检查项。', 'CHECKLIST_ITEM_NOT_FOUND');
    return replaceProjectList(project, 'checklist', checklist);
  }

  function getCitationCoverage(projectInput) {
    const claims = normalizeProject(projectInput).citationClaims;
    const sources = claims.flatMap(claim => claim.sources);
    return {
      claims: claims.length,
      linked: claims.filter(claim => claim.sources.length > 0).length,
      unlinked: claims.filter(claim => claim.sources.length === 0).length,
      unassessed: sources.filter(source => source.relation === 'unassessed').length,
      withEvidence: sources.filter(source => Boolean(source.evidenceExcerpt || source.evidenceLocation)).length,
      conflicts: claims.filter(claim => claim.sources.some(source => source.relation === 'supports')
        && claim.sources.some(source => source.relation === 'contradicts' || source.relation === 'does-not-support')).length
    };
  }

  function getReviewerCoverage(projectInput) {
    const comments = normalizeProject(projectInput).reviewerRounds.flatMap(round => round.comments);
    return {
      total: comments.length,
      completed: comments.filter(comment => comment.status === 'revised' || comment.status === 'no-change').length,
      planned: comments.filter(comment => comment.status === 'planned').length,
      unresolved: comments.filter(comment => comment.status === 'unresolved').length
    };
  }

  function getChecklistCoverage(projectInput) {
    const items = normalizeProject(projectInput).checklist;
    return {
      total: items.length,
      complete: items.filter(item => item.status === 'complete').length,
      notApplicable: items.filter(item => item.status === 'not-applicable').length,
      blocked: items.filter(item => item.status === 'blocked').length,
      todo: items.filter(item => item.status === 'todo').length,
      certified: false
    };
  }

  function selectedRecords(items, ids, label) {
    const selectedIds = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    if (!selectedIds.length) throw fail(`请先选择至少一项${label}。`, 'SELECTION_REQUIRED');
    const map = new Map(items.map(item => [item.id, item]));
    const selected = selectedIds.map(id => map.get(id));
    if (selected.some(item => !item)) throw fail(`所选${label}中包含已不存在的记录。`, 'SELECTION_NOT_FOUND');
    return selected;
  }

  function enforcePromptLimit(prompt) {
    if (prompt.length > MAX_PROMPT_CHARS) throw fail(`提示词共 ${prompt.length} 字，超过 ${MAX_PROMPT_CHARS} 字限制。请缩小本轮选择，原有材料不会被截断。`, 'PROMPT_LIMIT_EXCEEDED');
    return prompt;
  }

  function buildCitationCheckPrompt(projectInput, claimIds) {
    const project = normalizeProject(projectInput);
    const claims = selectedRecords(project.citationClaims, claimIds, '论断');
    const body = claims.map((claim, index) => {
      const sources = claim.sources.length ? claim.sources.map(source => {
        const snapshot = source.snapshot;
        const citation = [snapshot.authors.join('、'), snapshot.year, snapshot.title, snapshot.publication, snapshot.doi && `DOI ${snapshot.doi}`, snapshot.pmid && `PMID ${snapshot.pmid}`].filter(Boolean).join('；');
        return `  来源：${citation || source.knowledgeEntryId}\n  题录状态：${source.metadataStatus}；用户阅读范围：${source.readingStatus}\n  现有关系：${source.relation}\n  用户提供证据：${source.evidenceExcerpt || '未提供'}\n  证据位置：${source.evidenceLocation || '未提供'}\n  用户备注：${source.userNote || '无'}`;
      }).join('\n') : '  尚未关联文献来源。';
      return `${index + 1}. 稿件论断（${claim.manuscriptLocation || '位置未提供'}）：${claim.statement}\n${sources}`;
    }).join('\n\n');
    return enforcePromptLimit(`请按用户实际提供的材料逐项核对引用证据。登记题录、题名或摘要不能证明全文支持论断；严格区分支持、部分支持、不支持、冲突和证据不足。每项候选判断须指出可见材料与位置；不可见全文时明确说无法判断，不得补造内容。模型意见均待用户人工确认。\n\n稿件版本：${project.target.manuscriptVersion || '未提供'}\n\n${body}`);
  }

  function buildReviewerResponsePrompt(projectInput, commentIds) {
    const project = normalizeProject(projectInput);
    const comments = project.reviewerRounds.flatMap(round => round.comments.map(comment => ({ ...comment, roundTitle: round.title })));
    const selected = selectedRecords(comments, commentIds, '审稿意见');
    const body = selected.map((comment, index) => [
      `${index + 1}. 轮次：${comment.roundTitle || '未命名'}；审稿人：${comment.reviewer || '未标注'}`,
      `意见原文：${comment.rawComment}`,
      `当前状态：${comment.status}`,
      `回应草稿：${comment.responseDraft || '尚未填写'}`,
      `实际改动摘要：${comment.changeSummary || '无已记录改动'}`,
      `实际位置：${comment.changeLocation || '未提供'}`,
      `不修改理由：${comment.noChangeReason || '未提供'}`,
      `改动后摘录：${comment.afterExcerpt || '未提供'}`
    ].join('\n')).join('\n\n');
    return enforcePromptLimit(`请协助整理逐条审稿回应草稿。必须如实区分已完成修改、计划修改、暂未解决和有理由不修改；只有已记录的实际稿件改动才能写成“已修改”。不得编造实验、分析、结果、引文、页码或改稿动作。审稿材料可能受保密义务约束，外发前由用户确认目标期刊许可。\n\n稿件版本：${project.target.manuscriptVersion || '未提供'}\n目标：${project.target.venue || '未提供'}\n\n${body}`);
  }

  function buildSubmissionPrepPrompt(projectInput, checklistIds) {
    const project = normalizeProject(projectInput);
    const items = selectedRecords(project.checklist, checklistIds, '投稿检查项');
    const body = items.map((item, index) => {
      const requirement = project.requirements.find(value => value.id === item.requirementId);
      return [
        `${index + 1}. ${item.title}（当前状态：${item.status}）`,
        `目标要求：${requirement?.body || item.expected || '未提供具体要求'}`,
        `来源：${requirement ? [requirement.issuer, requirement.version, requirement.effectiveDate, requirement.sourceUrl, requirement.sourceLocator].filter(Boolean).join('；') : '用户自定义/来源缺失'}`,
        `要求核对状态：${requirement?.verificationStatus || 'unverified'}`,
        `用户记录证据：${item.evidence || '未提供'}`,
        `处理理由：${item.reason || '未提供'}`
      ].join('\n');
    }).join('\n\n');
    return enforcePromptLimit(`只按下列用户选定的目标要求检查稿件准备情况。若要求来源、版本或稿件证据缺失，列为待核对；不得将通用建议表述为目标期刊现行规则，不给出自动合规结论，不代用户提交文件。\n\n目标期刊/机构：${project.target.venue || '未提供'}\n投稿类型：${project.target.submissionType || '未提供'}\n要求版本：${project.target.requirementVersion || '未提供'}\n\n${body}`);
  }

  function addPromptRound(projectInput, input = {}) {
    const project = normalizeProject(projectInput);
    const entry = normalizeHistoryItem({ ...input, id: input.id || makeId('prompt-round') });
    if (!entry.prompt) throw fail('提示词不能为空。');
    if (project.history.some(item => item.id === entry.id)) throw fail(`提示词轮次 ID 重复：${entry.id}。`, 'DUPLICATE_ID');
    return replaceProjectList(project, 'history', [entry, ...project.history]);
  }

  function attachExternalResult(projectInput, historyId, result, resultSource = 'manual') {
    const project = normalizeProject(projectInput);
    const allowedSource = ['simulation', 'external-copy', 'manual'].includes(resultSource) ? resultSource : 'manual';
    let found = false;
    const history = project.history.map(item => {
      if (item.id !== historyId) return item;
      found = true;
      return normalizeHistoryItem({ ...item, result: text(result, MAX_RESULT_CHARS, '外部结果'), resultSource: allowedSource, status: 'returned' });
    });
    if (!found) throw fail('找不到提示词轮次。', 'HISTORY_NOT_FOUND');
    return replaceProjectList(project, 'history', history);
  }

  function compareBibliography(existingInput = {}, returnedInput = {}) {
    const existing = normalizeBibliographySnapshot(existingInput);
    const returned = normalizeBibliographySnapshot(returnedInput);
    const fields = [
      ['title', '题名'], ['authors', '作者'], ['year', '年份'], ['publication', '刊物/出版物'],
      ['volume', '卷'], ['issue', '期'], ['pages', '页码'], ['doi', 'DOI'], ['pmid', 'PMID']
    ];
    return fields.flatMap(([field, label]) => {
      const left = Array.isArray(existing[field]) ? existing[field].join('；') : existing[field];
      const right = Array.isArray(returned[field]) ? returned[field].join('；') : returned[field];
      if (!left || !right || String(left).toLocaleLowerCase() === String(right).toLocaleLowerCase()) return [];
      return [{ field, label, existing: left, returned: right }];
    });
  }

  function getProjectCountLimit() { return MAX_PROJECTS; }

  return {
    TASK_TYPES, CLAIM_RELATIONS, METADATA_STATES, READING_STATES, REVIEW_STATUSES, CHECKLIST_STATUSES,
    normalizePackSnapshot,
    normalizeProject, createProject, normalizeBibliographySnapshot, addCitationClaim, updateCitationSource,
    addReviewerRound, addReviewerComment, resolveReviewerComment, addRequirementCard, updateRequirementCard, addChecklistItem,
    updateChecklistItem, getCitationCoverage, getReviewerCoverage, getChecklistCoverage,
    buildCitationCheckPrompt, buildReviewerResponsePrompt, buildSubmissionPrepPrompt,
    addPromptRound, attachExternalResult, compareBibliography, getProjectCountLimit
  };
});
