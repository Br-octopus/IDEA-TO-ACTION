(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepAcademicReview = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const REVIEW_TYPES = Object.freeze(['narrative-review', 'scoping-review', 'systematic-review']);
  const SCREENING_MODELS = Object.freeze(['single-reviewer', 'two-reviewers']);
  const SCREENING_DECISIONS = Object.freeze(['include', 'exclude', 'uncertain', 'duplicate']);
  const FULL_TEXT_DECISIONS = Object.freeze(['pending', 'include', 'exclude', 'not-retrieved']);
  const BATCH_STAGES = Object.freeze(['title-abstract', 'full-text', 'extraction', 'synthesis']);
  const REVIEW_ROUND_STAGES = Object.freeze(['plan', ...BATCH_STAGES]);
  const MAX_REVIEW_RECORDS = 1000;
  const MAX_BATCH_SIZE = 5;
  const MAX_TEXT = 1200;
  const MAX_PROMPT_CHARS = 8000;
  const MAX_EXTERNAL_RESULT_CHARS = 20000;
  const REVIEW_FIELDS = new Set([
    'id', 'title', 'reviewType', 'question', 'scope', 'audience', 'inclusionCriteria', 'exclusionCriteria',
    'screeningModel', 'synthesisMethod', 'batchSize', 'searchLogs', 'extractionFields', 'records', 'rounds',
    'batches', 'packSnapshot', 'saveEnabled', 'createdAt', 'updatedAt'
  ]);

  const DEFAULT_EXTRACTION_FIELDS = Object.freeze({
    'narrative-review': [
      ['theme', '主题'], ['main-claim', '主要观点'], ['evidence', '证据与材料'], ['limitations', '局限'], ['source-location', '原文位置']
    ],
    'scoping-review': [
      ['study-design', '研究类型'], ['population-context', '对象与情境'], ['concept', '核心概念'], ['key-findings', '主要发现'], ['source-location', '原文位置']
    ],
    'systematic-review': [
      ['study-design', '研究设计'], ['population', '研究对象'], ['intervention-exposure', '干预或暴露'], ['outcomes', '结局指标'],
      ['findings', '主要结果'], ['limitations', '局限'], ['source-location', '原文位置']
    ]
  });

  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function text(value, limit = MAX_TEXT) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, limit)
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [凭证已省略]')
      .replace(/(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*[^\s,;]+/gi, '[凭证已省略]')
      .replace(/(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\)[^\s"'<>]*/g, '[本机路径已省略]');
  }
  function textList(value, limit = 30) {
    const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
    return [...new Set(items.map(item => text(item, MAX_TEXT)).filter(Boolean))].slice(0, limit);
  }
  function makeId(prefix) {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`;
  }
  function fail(message, code = 'INVALID_REVIEW') { return Object.assign(new Error(message), { code }); }

  function normalizeExtractionFields(value, reviewType) {
    const defaults = DEFAULT_EXTRACTION_FIELDS[reviewType].map(([id, label], order) => ({ id, label, required: true, order }));
    if (!Array.isArray(value)) return defaults;
    if (value.length > 20) throw fail('提取字段最多 20 项。');
    const fields = value.map((item, order) => {
      const source = isObject(item) ? item : {};
      return {
        id: text(source.id, 80), label: text(source.label, 120),
        required: source.required !== false, order: Number.isSafeInteger(source.order) && source.order >= 0 ? source.order : order
      };
    }).filter(item => item.id && item.label);
    if (!fields.length) return defaults;
    const ids = new Set();
    for (const field of fields) {
      if (ids.has(field.id)) throw fail(`提取字段 ID 重复：${field.id}`);
      ids.add(field.id);
    }
    return fields.sort((a, b) => a.order - b.order);
  }

  function normalizeDecision(value) {
    const source = isObject(value) ? value : {};
    return {
      decision: SCREENING_DECISIONS.includes(source.decision) ? source.decision : '',
      reason: text(source.reason), location: text(source.location, 240), evidence: text(source.evidence),
      reviewerId: text(source.reviewerId, 120), decidedAt: text(source.decidedAt, 80)
    };
  }

  function normalizeReviewRecord(input, project) {
    const source = isObject(input) ? input : {};
    const recordId = text(source.id, 120);
    const sourceEntryId = text(source.sourceEntryId, 100);
    const snapshot = isObject(source.snapshot) ? source.snapshot : {};
    const excerpt = typeof snapshot.excerpt === 'string' ? snapshot.excerpt.trim() : '';
    if (excerpt.length > MAX_TEXT) throw fail(`每条文献摘录最多 ${MAX_TEXT} 字。`, 'TEXT_LIMIT_EXCEEDED');
    const literature = {
      authors: textList(snapshot.authors, 30), year: text(snapshot.year, 20), publication: text(snapshot.publication, 240),
      doi: text(snapshot.doi, 240), pmid: text(snapshot.pmid, 40),
      metadataStatus: ['unverified', 'registry-returned', 'user-verified'].includes(snapshot.metadataStatus) ? snapshot.metadataStatus : 'unverified',
      readingStatus: ['unread', 'title-only', 'abstract-only', 'excerpt-only', 'full-text-user-confirmed'].includes(snapshot.readingStatus) ? snapshot.readingStatus : 'unread',
      excerpt: text(excerpt), excerptLocation: text(snapshot.excerptLocation, 240)
    };
    const screeningSource = isObject(source.screening) ? source.screening : {};
    const titleAbstractSource = isObject(screeningSource.titleAbstract) ? screeningSource.titleAbstract : {};
    const fullTextSource = isObject(screeningSource.fullText) ? screeningSource.fullText : {};
    const extractionSource = isObject(source.extraction) ? source.extraction : {};
    const extraction = Object.fromEntries(project.extractionFields.map(field => {
      const value = isObject(extractionSource[field.id]) ? extractionSource[field.id] : {};
      return [field.id, {
        value: text(value.value), evidence: text(value.evidence), sourceLocation: text(value.sourceLocation, 240),
        confirmed: value.confirmed === true, confirmedAt: text(value.confirmedAt, 80)
      }];
    }));
    return {
      id: recordId || sourceEntryId,
      sourceEntryId,
      snapshot: { title: text(snapshot.title), ...literature },
      studyGroupId: text(source.studyGroupId, 120),
      narrativeSelected: source.narrativeSelected !== false,
      screening: {
        titleAbstract: {
          reviewerOne: normalizeDecision(titleAbstractSource.reviewerOne),
          reviewerTwo: normalizeDecision(titleAbstractSource.reviewerTwo),
          adjudication: normalizeDecision(titleAbstractSource.adjudication)
        },
        fullText: {
          decision: FULL_TEXT_DECISIONS.includes(fullTextSource.decision) ? fullTextSource.decision : 'pending',
          reason: text(fullTextSource.reason), location: text(fullTextSource.location, 240),
          reviewerId: text(fullTextSource.reviewerId, 120), decidedAt: text(fullTextSource.decidedAt, 80),
          userConfirmedFullText: fullTextSource.userConfirmedFullText === true,
          availableToUser: fullTextSource.availableToUser === true
        }
      },
      extraction
    };
  }

  function normalizeSearchLogs(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 30).map((item, index) => {
      const source = isObject(item) ? item : {};
      const count = Number(source.recordsIdentified);
      return {
        id: text(source.id, 100) || `search-${index + 1}`,
        database: text(source.database, 160), query: text(source.query, 2000), date: text(source.date, 40),
        limits: text(source.limits, 500), recordsIdentified: Number.isSafeInteger(count) && count >= 0 ? count : 0,
        note: text(source.note, 500)
      };
    }).filter(item => item.database || item.query);
  }

  function normalizePackSnapshot(value) {
    const source = isObject(value) ? value : {};
    const sources = Array.isArray(source.sources) ? source.sources.slice(0, 50).map(item => ({
      id: text(item?.id, 120), title: text(item?.title, 200), url: text(item?.url, 1000),
      locator: text(item?.locator, 500), version: text(item?.version, 120), license: text(item?.license, 500),
      checkedAt: text(item?.checkedAt, 40), applicability: text(item?.applicability, 500),
      limitations: text(item?.limitations, 500),
      verificationStatus: ['unverified', 'source-reviewed', 'case-validated'].includes(item?.verificationStatus)
        ? item.verificationStatus : 'unverified'
    })).filter(item => item.id) : [];
    return {
      id: text(source.id, 120), version: Number.isSafeInteger(source.version) && source.version > 0 ? source.version : 0,
      name: text(source.name, 160),
      sourceIds: [...new Set([
        ...textList(source.sourceIds, 50).map(item => item.slice(0, 120)), ...sources.map(item => item.id)
      ])].slice(0, 50),
      sources,
      entries: Array.isArray(source.entries) ? source.entries.slice(0, 50).map(item => ({
        id: text(item?.id, 120), kind: text(item?.kind, 40), text: text(item?.text, 500),
        sourceIds: textList(item?.sourceIds, 30).map(id => id.slice(0, 120)),
        verificationStatus: ['unverified', 'source-reviewed', 'case-validated'].includes(item?.verificationStatus) ? item.verificationStatus : 'unverified'
      })).filter(item => item.id && item.text) : []
    };
  }

  function normalizeReviewProject(input = {}) {
    const source = isObject(input) ? input : {};
    const reviewType = REVIEW_TYPES.includes(source.reviewType) ? source.reviewType : '';
    if (!reviewType) throw fail('综述类型无效。');
    const project = {
      id: text(source.id, 120), title: text(source.title), reviewType,
      question: text(source.question), scope: text(source.scope), audience: text(source.audience),
      inclusionCriteria: textList(source.inclusionCriteria), exclusionCriteria: textList(source.exclusionCriteria),
      screeningModel: SCREENING_MODELS.includes(source.screeningModel) ? source.screeningModel : 'single-reviewer',
      synthesisMethod: ['descriptive', 'thematic', 'narrative', 'quantitative-plan'].includes(source.synthesisMethod) ? source.synthesisMethod : 'narrative',
      batchSize: Number.isSafeInteger(source.batchSize) && source.batchSize >= 1 && source.batchSize <= MAX_BATCH_SIZE ? source.batchSize : 3,
      searchLogs: normalizeSearchLogs(source.searchLogs),
      extractionFields: normalizeExtractionFields(source.extractionFields, reviewType),
      records: [],
      rounds: Array.isArray(source.rounds) ? source.rounds.slice(-100).map(item => ({
        id: text(item?.id, 120), stage: REVIEW_ROUND_STAGES.includes(item?.stage) ? item.stage : '',
        promptVersionId: text(item?.promptVersionId, 120), parentPromptId: text(item?.parentPromptId, 120),
        recordIds: textList(item?.recordIds, MAX_REVIEW_RECORDS).map(id => id.slice(0, 120)),
        prompt: text(item?.prompt, MAX_PROMPT_CHARS), result: text(item?.result, MAX_EXTERNAL_RESULT_CHARS),
        status: ['generated', 'edited', 'copied', 'returned', 'parsed', 'failed'].includes(item?.status) ? item.status : 'generated',
        batchId: text(item?.batchId, 120), reviewer: ['reviewerOne', 'reviewerTwo'].includes(item?.reviewer) ? item.reviewer : 'reviewerOne',
        inputCount: Number.isSafeInteger(item?.inputCount) && item.inputCount >= 0 ? item.inputCount : 0,
        inputChars: Number.isSafeInteger(item?.inputChars) && item.inputChars >= 0 ? item.inputChars : 0,
        error: text(item?.error, 500),
        candidates: Array.isArray(item?.candidates) ? item.candidates.slice(0, 100).map(candidate => ({
          id: text(candidate?.id, 120), recordId: text(candidate?.recordId, 120), fieldId: text(candidate?.fieldId, 80),
          decision: text(candidate?.decision, 40), reason: text(candidate?.reason), evidence: text(candidate?.evidence),
          location: text(candidate?.location, 240), value: text(candidate?.value),
          status: ['pending', 'accepted', 'modified', 'rejected'].includes(candidate?.status) ? candidate.status : 'pending'
        })).filter(candidate => candidate.id && candidate.recordId) : [],
        createdAt: text(item?.createdAt, 80)
      })).filter(item => item.id && item.stage) : [],
      batches: Array.isArray(source.batches) ? source.batches.slice(-500).map(item => ({
        id: text(item?.id, 120), stage: BATCH_STAGES.includes(item?.stage) ? item.stage : '',
        reviewer: ['reviewerOne', 'reviewerTwo'].includes(item?.reviewer) ? item.reviewer : 'reviewerOne',
        recordIds: textList(item?.recordIds, MAX_REVIEW_RECORDS).map(id => id.slice(0, 120)),
        inputCount: Number.isSafeInteger(item?.inputCount) && item.inputCount >= 0 ? item.inputCount : 0,
        inputChars: Number.isSafeInteger(item?.inputChars) && item.inputChars >= 0 ? item.inputChars : 0,
        createdAt: text(item?.createdAt, 80),
        status: ['pending', 'in-progress', 'complete', 'failed'].includes(item?.status) ? item.status : 'pending'
      })).filter(item => item.id && item.stage) : [],
      packSnapshot: normalizePackSnapshot(source.packSnapshot),
      saveEnabled: source.saveEnabled === true,
      createdAt: text(source.createdAt, 80) || new Date().toISOString(),
      updatedAt: text(source.updatedAt, 80) || new Date().toISOString()
    };
    if (!project.id) throw fail('综述项目缺少稳定 ID。');
    if (!project.title) throw fail('综述项目标题不能为空。');
    if (!project.question) throw fail('研究问题不能为空。');
    if (!project.scope) throw fail('综述范围不能为空。');
    if (project.reviewType !== 'narrative-review' && (!project.inclusionCriteria.length || !project.exclusionCriteria.length)) {
      throw fail('范围综述和系统综述必须分别填写纳入与排除标准。');
    }
    if (project.reviewType !== 'systematic-review') project.screeningModel = 'single-reviewer';
    if (Array.isArray(source.records) && source.records.length > MAX_REVIEW_RECORDS) {
      throw fail(`一个综述项目最多跟踪 ${MAX_REVIEW_RECORDS} 条文献记录。`, 'RECORD_LIMIT_EXCEEDED');
    }
    project.records = Array.isArray(source.records) ? source.records.map(item => normalizeReviewRecord(item, project)).filter(item => item.id && item.sourceEntryId) : [];
    const recordIds = new Set();
    for (const record of project.records) {
      if (recordIds.has(record.id)) throw fail(`综述项目存在重复文献 ID：${record.id}`, 'DUPLICATE_RECORD');
      recordIds.add(record.id);
    }
    return Object.fromEntries(Object.entries(project).filter(([key]) => REVIEW_FIELDS.has(key)));
  }

  function createReviewProject(input = {}) {
    const now = new Date().toISOString();
    return normalizeReviewProject({ ...input, records: [], rounds: [], batches: [], saveEnabled: false, createdAt: now, updatedAt: now });
  }

  function addLiteratureRecords(projectInput, selectedIds, knowledgeEntries = []) {
    const project = normalizeReviewProject(projectInput);
    const suppliedIds = (Array.isArray(selectedIds) ? selectedIds : []).map(id => text(id, 100)).filter(Boolean);
    const byId = new Map((knowledgeEntries || []).filter(isObject).map(entry => [text(entry.id, 100), entry]));
    const existingIds = new Set(project.records.map(item => item.sourceEntryId));
    const selectedIdsSeen = new Set();
    const added = [];
    const duplicates = [];
    const errors = [];
    for (const id of suppliedIds) {
      if (selectedIdsSeen.has(id)) {
        duplicates.push({ id, message: '本次选择中重复出现。' });
        continue;
      }
      selectedIdsSeen.add(id);
      const entry = byId.get(id);
      if (!entry || entry.type !== 'academic-literature') {
        errors.push({ id, message: '找不到所选学术文献记录。' });
        continue;
      }
      if (existingIds.has(id)) { duplicates.push({ id, message: '该文献已在当前项目快照中。' }); continue; }
      const literature = isObject(entry.literature) ? entry.literature : {};
      added.push(normalizeReviewRecord({
        id, sourceEntryId: id, snapshot: {
          title: entry.title, authors: literature.authors, year: literature.year, publication: literature.publication,
          doi: literature.doi, pmid: literature.pmid, metadataStatus: literature.metadataStatus,
          readingStatus: literature.readingStatus, excerpt: literature.abstractExcerpt, excerptLocation: literature.excerptLocation
        }
      }, project));
      existingIds.add(id);
    }
    if (project.records.length + added.length > MAX_REVIEW_RECORDS) {
      throw fail(`一个综述项目最多跟踪 ${MAX_REVIEW_RECORDS} 条文献记录。`, 'RECORD_LIMIT_EXCEEDED');
    }
    const updated = normalizeReviewProject({ ...project, records: [...project.records, ...added], updatedAt: new Date().toISOString() });
    return { project: updated, added: added.map(item => item.id), duplicates, errors };
  }

  function previewLiteratureRefresh(projectInput, selectedIds, knowledgeEntries = []) {
    const project = normalizeReviewProject(projectInput);
    const available = new Set((knowledgeEntries || []).filter(isObject).map(entry => text(entry.id, 100)));
    const result = addLiteratureRecords(project, selectedIds, knowledgeEntries);
    return {
      additions: result.project.records.filter(record => !project.records.some(existing => existing.id === record.id)),
      missing: project.records.filter(record => !available.has(record.sourceEntryId)).map(record => ({
        id: record.id, sourceEntryId: record.sourceEntryId, title: record.snapshot.title
      })),
      duplicates: result.duplicates.map(item => item.id),
      errors: result.errors
    };
  }

  function confirmLiteratureRefresh(projectInput, preview, knowledgeEntries = []) {
    if (!isObject(preview) || !Array.isArray(preview.additions)) throw fail('文献快照预览无效。');
    return addLiteratureRecords(projectInput, preview.additions.map(record => record.sourceEntryId), knowledgeEntries);
  }

  function updateExtractionFields(projectInput, inputFields) {
    const project = normalizeReviewProject(projectInput);
    if (!Array.isArray(inputFields) || !inputFields.length) throw fail('至少保留一个提取字段。');
    const fields = normalizeExtractionFields(inputFields, project.reviewType);
    const records = project.records.map(record => ({
      ...record,
      extraction: Object.fromEntries(fields.map(field => [field.id, record.extraction[field.id] || {
        value: '', evidence: '', sourceLocation: '', confirmed: false
      }]))
    }));
    return normalizeReviewProject({ ...project, extractionFields: fields, records, updatedAt: new Date().toISOString() });
  }

  function findRecord(project, recordId) {
    const record = project.records.find(item => item.id === recordId);
    if (!record) throw fail(`综述项目中不存在文献记录：${recordId}`, 'REVIEW_RECORD_NOT_FOUND');
    return record;
  }

  function setScreeningDecision(projectInput, recordId, stage, reviewer, input = {}) {
    const project = normalizeReviewProject(projectInput);
    if (stage !== 'title-abstract') throw fail('当前只允许更新题名/摘要筛选决定。', 'INVALID_STAGE');
    if (!['reviewerOne', 'reviewerTwo'].includes(reviewer)) throw fail('审阅者标识无效。');
    if (reviewer === 'reviewerTwo' && project.screeningModel !== 'two-reviewers') throw fail('单人筛选项目不支持第二审阅者。');
    if (!SCREENING_DECISIONS.includes(input.decision)) throw fail('筛选决定无效。');
    const reason = text(input.reason);
    if (['exclude', 'duplicate'].includes(input.decision) && !reason) throw fail('排除或重复决定必须填写理由。');
    const record = findRecord(project, recordId);
    record.screening.titleAbstract[reviewer] = {
      decision: input.decision, reason, location: text(input.location, 240), evidence: text(input.evidence),
      reviewerId: reviewer, decidedAt: new Date().toISOString()
    };
    record.screening.titleAbstract.adjudication = { decision: '', reason: '', location: '', evidence: '' };
    if (!fullTextEligible(project, record)) {
      record.screening.fullText = {
        decision: 'pending', reason: '', location: '', userConfirmedFullText: false, availableToUser: false
      };
    }
    project.updatedAt = new Date().toISOString();
    return normalizeReviewProject(project);
  }

  function adjudicateScreeningDecision(projectInput, recordId, input = {}) {
    const project = normalizeReviewProject(projectInput);
    if (project.screeningModel !== 'two-reviewers') throw fail('只有双人筛选项目需要裁定。');
    if (!SCREENING_DECISIONS.includes(input.decision) || !text(input.reason)) throw fail('裁定决定和理由均为必填项。');
    const record = findRecord(project, recordId);
    record.screening.titleAbstract.adjudication = {
      decision: input.decision, reason: text(input.reason), location: text(input.location, 240), evidence: text(input.evidence),
      reviewerId: text(input.reviewerId, 120) || 'adjudicator', decidedAt: new Date().toISOString()
    };
    if (!fullTextEligible(project, record)) {
      record.screening.fullText = {
        decision: 'pending', reason: '', location: '', userConfirmedFullText: false, availableToUser: false
      };
    }
    project.updatedAt = new Date().toISOString();
    return normalizeReviewProject(project);
  }

  function setFullTextDecision(projectInput, recordId, input = {}) {
    const project = normalizeReviewProject(projectInput);
    if (!['scoping-review', 'systematic-review'].includes(project.reviewType)) throw fail('叙述性综述不使用全文筛选阶段。');
    if (!FULL_TEXT_DECISIONS.includes(input.decision) || input.decision === 'pending') throw fail('全文决定无效。');
    const record = findRecord(project, recordId);
    const effective = getTitleAbstractDecision(project, record);
    if (!['include', 'uncertain'].includes(effective)) throw fail('该记录尚未进入全文筛选阶段。');
    const confirmed = input.userConfirmedFullText === true;
    if (['include', 'exclude'].includes(input.decision) && !confirmed) throw fail('确认纳入或排除全文前，必须先由用户亲自核对全文。');
    if (input.decision === 'exclude' && !text(input.reason)) throw fail('全文排除必须填写理由。');
    if (input.decision === 'not-retrieved' && !text(input.reason)) throw fail('无法获取全文必须说明原因。');
    record.screening.fullText = {
      decision: input.decision, reason: text(input.reason), location: text(input.location, 240),
      reviewerId: text(input.reviewerId, 120) || 'user', decidedAt: new Date().toISOString(),
      userConfirmedFullText: confirmed, availableToUser: input.availableToUser === true
    };
    project.updatedAt = new Date().toISOString();
    return normalizeReviewProject(project);
  }

  function setNarrativeSelection(projectInput, recordId, selected) {
    const project = normalizeReviewProject(projectInput);
    if (project.reviewType !== 'narrative-review') throw fail('此操作仅适用于叙述性综述。');
    findRecord(project, recordId).narrativeSelected = selected === true;
    project.updatedAt = new Date().toISOString();
    return normalizeReviewProject(project);
  }

  function setExtractionValue(projectInput, recordId, fieldId, input = {}) {
    const project = normalizeReviewProject(projectInput);
    const field = project.extractionFields.find(item => item.id === fieldId);
    if (!field) throw fail(`提取字段不存在：${fieldId}`);
    const record = findRecord(project, recordId);
    if (!extractionEligible(project, record)) throw fail('请先确认全文纳入，或在叙述性综述中选择该材料。', 'RECORD_NOT_READY');
    record.extraction[fieldId] = {
      value: text(input.value), evidence: text(input.evidence), sourceLocation: text(input.sourceLocation, 240),
      confirmed: input.confirmed === true, confirmedAt: input.confirmed === true ? new Date().toISOString() : ''
    };
    if (record.extraction[fieldId].confirmed && (!record.extraction[fieldId].value || !record.extraction[fieldId].evidence || !record.extraction[fieldId].sourceLocation)) {
      throw fail('确认提取值前必须填写内容、原文依据和来源位置。');
    }
    project.updatedAt = new Date().toISOString();
    return normalizeReviewProject(project);
  }

  function getTitleAbstractDecision(project, record) {
    const state = record.screening.titleAbstract;
    const one = state.reviewerOne.decision;
    if (project.screeningModel === 'single-reviewer') return one || 'pending';
    const two = state.reviewerTwo.decision;
    if (!one || !two) return 'pending';
    if (one === two) return one;
    return state.adjudication.decision || 'needs-adjudication';
  }

  function extractionComplete(project, record) {
    const eligible = project.extractionFields.filter(field => field.required);
    return eligible.length > 0 && eligible.every(field => {
      const value = record.extraction[field.id];
      return value?.confirmed === true && value.value && value.evidence && value.sourceLocation;
    });
  }

  function fullTextEligible(project, record) {
    return ['include', 'uncertain'].includes(getTitleAbstractDecision(project, record));
  }

  function extractionEligible(project, record) {
    if (project.reviewType === 'narrative-review') return record.narrativeSelected;
    return fullTextEligible(project, record)
      && record.screening.fullText.decision === 'include' && record.screening.fullText.userConfirmedFullText;
  }

  function synthesisEligible(project, record) {
    return extractionEligible(project, record) && extractionComplete(project, record);
  }

  function getReviewCoverage(projectInput) {
    const project = normalizeReviewProject(projectInput);
    const titleApplicable = project.reviewType !== 'narrative-review';
    const fullTextApplicable = project.reviewType !== 'narrative-review';
    const decisions = project.records.map(record => getTitleAbstractDecision(project, record));
    const eligibleFullText = project.records.filter(record => fullTextApplicable && fullTextEligible(project, record));
    const includedFullText = eligibleFullText.filter(record => record.screening.fullText.decision === 'include' && record.screening.fullText.userConfirmedFullText);
    const excludedFullText = eligibleFullText.filter(record => record.screening.fullText.decision === 'exclude' && record.screening.fullText.userConfirmedFullText);
    const notRetrieved = eligibleFullText.filter(record => record.screening.fullText.decision === 'not-retrieved');
    const extractionDone = project.records.filter(record => extractionEligible(project, record) && extractionComplete(project, record));
    const ready = project.records.filter(record => synthesisEligible(project, record));
    const pendingTitle = titleApplicable ? decisions.filter(decision => decision === 'pending').length : 0;
    const needsAdjudication = titleApplicable ? decisions.filter(decision => decision === 'needs-adjudication').length : 0;
    const pendingFullText = eligibleFullText.filter(record => record.screening.fullText.decision === 'pending').length;
    const notApplicableNarrative = project.reviewType === 'narrative-review';
    const narrativePending = notApplicableNarrative
      ? project.records.filter(record => record.narrativeSelected && !extractionComplete(project, record)).length : 0;
    const complete = project.records.length > 0 && pendingTitle === 0 && needsAdjudication === 0
      && pendingFullText === 0 && notRetrieved.length === 0
      && (notApplicableNarrative
        ? project.records.some(record => record.narrativeSelected) && narrativePending === 0
        : extractionDone.length >= includedFullText.length);
    return {
      totalRecords: project.records.length,
      titleAbstractApplicable: titleApplicable,
      titleAbstractPending: pendingTitle,
      titleAbstractNeedsAdjudication: needsAdjudication,
      titleAbstractIncluded: decisions.filter(decision => decision === 'include').length,
      titleAbstractExcluded: decisions.filter(decision => decision === 'exclude').length,
      titleAbstractUncertain: decisions.filter(decision => decision === 'uncertain').length,
      titleAbstractDuplicates: decisions.filter(decision => decision === 'duplicate').length,
      fullTextApplicable,
      fullTextEligible: eligibleFullText.length,
      fullTextPending: pendingFullText,
      fullTextIncluded: includedFullText.length,
      fullTextExcluded: excludedFullText.length,
      fullTextNotRetrieved: notRetrieved.length,
      extractionComplete: extractionDone.length,
      extractionPending: project.reviewType === 'narrative-review'
        ? narrativePending
        : Math.max(0, includedFullText.length - extractionDone.length),
      narrativeSelected: notApplicableNarrative ? project.records.filter(record => record.narrativeSelected).length : 0,
      synthesisReady: ready.length,
      failedRounds: project.rounds.filter(round => round.status === 'failed').length,
      complete
    };
  }

  function batchableRecords(project, stage, reviewer) {
    if (stage === 'title-abstract') {
      if (project.reviewType === 'narrative-review') throw fail('叙述性综述不使用题名/摘要筛选阶段。', 'INVALID_STAGE');
      if (!['reviewerOne', 'reviewerTwo'].includes(reviewer)) throw fail('审阅者标识无效。');
      if (reviewer === 'reviewerTwo' && project.screeningModel !== 'two-reviewers') throw fail('单人筛选项目不支持第二审阅者。');
      if (reviewer === 'reviewerTwo') return project.records.filter(record => record.screening.titleAbstract.reviewerOne.decision && !record.screening.titleAbstract.reviewerTwo.decision);
      return project.records.filter(record => !record.screening.titleAbstract.reviewerOne.decision);
    }
    if (stage === 'full-text') return project.records.filter(record => fullTextEligible(project, record) && record.screening.fullText.decision === 'pending');
    if (stage === 'extraction') return project.records.filter(record => fullTextEligible(project, record)
      && record.screening.fullText.decision === 'include'
      && record.screening.fullText.userConfirmedFullText && !extractionComplete(project, record));
    if (stage === 'synthesis') return project.records.filter(record => synthesisEligible(project, record));
    throw fail(`综述阶段无效：${stage}`, 'INVALID_STAGE');
  }

  function createReviewBatches(projectInput, stage, options = {}) {
    const project = normalizeReviewProject(projectInput);
    if (!BATCH_STAGES.includes(stage)) throw fail(`综述阶段无效：${stage}`, 'INVALID_STAGE');
    const size = options.size === undefined ? project.batchSize : options.size;
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BATCH_SIZE) throw fail(`每批大小须为 1 到 ${MAX_BATCH_SIZE} 条。`);
    const reviewer = options.reviewer || 'reviewerOne';
    const records = batchableRecords(project, stage, reviewer);
    const batches = [];
    for (let index = 0; index < records.length; index += size) {
      const batchRecords = records.slice(index, index + size);
      const recordIds = batchRecords.map(record => record.id);
      const inputChars = batchRecords.reduce((total, record) => total + record.snapshot.title.length + record.snapshot.excerpt.length, 0);
      batches.push({
        id: makeId('batch'), stage, reviewer, recordIds, inputCount: recordIds.length, inputChars,
        createdAt: new Date().toISOString(), status: 'pending'
      });
    }
    return batches;
  }

  function generateReviewPrompt(projectInput, stage, batch) {
    const project = normalizeReviewProject(projectInput);
    const allowedStages = ['plan', ...BATCH_STAGES];
    if (!allowedStages.includes(stage)) throw fail(`综述阶段无效：${stage}`, 'INVALID_STAGE');
    if (stage === 'plan') {
      const prompt = [
        '你是综述方案讨论助手，只能给出待用户确认的建议，不得声称已执行检索、筛选或质量评估。',
        `类型：${project.reviewType}`,
        `研究问题：${project.question}`,
        `范围：${project.scope}`,
        `对象：${project.audience || '未提供'}`,
        `纳入标准：${project.inclusionCriteria.join('；') || '未提供'}`,
        `排除标准：${project.exclusionCriteria.join('；') || '未提供'}`,
        `检索记录：${JSON.stringify(project.searchLogs)}`,
        `当前基础包：${project.packSnapshot.name || '未选择'} v${project.packSnapshot.version || '未知'}`,
        '请列出仍需用户补齐的信息、适用的方法路线、容易误用的结论边界，并明确 PRISMA 等报告指南不是方法质量认证。'
      ].join('\n');
      if (prompt.length > MAX_PROMPT_CHARS) throw fail(`方案提示词超过 ${MAX_PROMPT_CHARS} 字，请缩短项目字段。`, 'PROMPT_TOO_LONG');
      return { prompt, inputCount: 0, inputChars: prompt.length, excerptChars: 0, promptChars: prompt.length, recordIds: [] };
    }

    if (!isObject(batch) || batch.stage !== stage || !text(batch.id, 120)) throw fail('批次与提示词阶段不匹配。', 'BATCH_MISMATCH');
    const ids = Array.isArray(batch.recordIds) ? batch.recordIds.map(id => text(id, 120)) : [];
    if (!ids.length || ids.length > MAX_BATCH_SIZE || new Set(ids).size !== ids.length) throw fail(`每个批次须包含 1 到 ${MAX_BATCH_SIZE} 条不同记录。`, 'INVALID_BATCH');
    if (['reviewerOne', 'reviewerTwo'].includes(batch.reviewer) === false && stage === 'title-abstract') throw fail('批次审阅者标识无效。');
    const recordsById = new Map(project.records.map(record => [record.id, record]));
    const records = ids.map(id => recordsById.get(id));
    if (records.some(record => !record)) throw fail('批次包含不属于当前项目的文献 ID。', 'BATCH_MISMATCH');
    const eligibleIds = new Set(batchableRecords(project, stage, batch.reviewer || 'reviewerOne').map(record => record.id));
    if (ids.some(id => !eligibleIds.has(id))) throw fail('批次包含不符合当前阶段条件的记录。', 'BATCH_MISMATCH');

    let payload;
    let instruction;
    if (stage === 'title-abstract') {
      payload = records.map(record => ({
        recordId: record.id, title: record.snapshot.title, authors: record.snapshot.authors,
        year: record.snapshot.year, publication: record.snapshot.publication,
        excerpt: record.snapshot.excerpt, excerptLocation: record.snapshot.excerptLocation,
        metadataStatus: record.snapshot.metadataStatus, readingStatus: record.snapshot.readingStatus
      }));
      instruction = '仅根据已提供题录和摘录提出候选决定，不代表已核读全文。不要推断未提供的内容；逐条返回 JSON 候选，保留 recordId、决定、理由、依据和位置。模型候选不是独立审阅者。';
    } else if (stage === 'full-text') {
      payload = records.map(record => ({
        recordId: record.id, title: record.snapshot.title, excerpt: record.snapshot.excerpt,
        excerptLocation: record.snapshot.excerptLocation, readingStatus: record.snapshot.readingStatus,
        userSuppliedFullText: record.screening.fullText.availableToUser && record.screening.fullText.userConfirmedFullText
      }));
      instruction = '题录与摘录不等于全文。只依据当前实际提供的材料给出待复核候选；若未提供可核对的全文，不得生成全文纳入或排除结论。排除理由须具体。';
    } else if (stage === 'extraction') {
      payload = records.map(record => ({
        recordId: record.id, title: record.snapshot.title, excerpt: record.snapshot.excerpt,
        readingStatus: record.snapshot.readingStatus,
        fields: project.extractionFields.map(field => ({ id: field.id, label: field.label, required: field.required }))
      }));
      instruction = '只返回当前材料中能逐字段找到依据的提取候选，缺少原文内容时留空并标记待核对，不得猜测。每个值附依据摘录和原文位置；候选不会自动计为已确认。';
    } else if (stage === 'synthesis') {
      payload = records.map(record => ({
        recordId: record.id, title: record.snapshot.title,
        extraction: Object.fromEntries(project.extractionFields.filter(field => record.extraction[field.id]?.confirmed)
          .map(field => [field.id, { label: field.label, value: record.extraction[field.id].value,
            evidence: record.extraction[field.id].evidence, sourceLocation: record.extraction[field.id].sourceLocation }]))
      }));
      if (records.some(record => !synthesisEligible(project, record))) throw fail('综合提示词只能使用已确认纳入且已确认提取的记录。', 'RECORD_NOT_READY');
      instruction = '只综合下面已经由用户确认纳入和提取的材料。区分证据、推断和缺失信息；不得把相关性写成因果，不得扩大到未提供文献或全文。';
    }
    const payloadText = JSON.stringify(payload);
    const excerptChars = records.reduce((total, record) => total + record.snapshot.excerpt.length, 0);
    const prompt = [
      `综述类型：${project.reviewType}`,
      `阶段：${stage}`,
      `批次：${batch.id}`,
      `固定记录：${ids.join(', ')}`,
      `研究问题：${project.question}`,
      `范围：${project.scope}`,
      `纳入标准：${project.inclusionCriteria.join('；')}`,
      `排除标准：${project.exclusionCriteria.join('；')}`,
      `批次输入：${records.length} 条；摘录 ${excerptChars} 字；JSON 输入 ${payloadText.length} 字。`,
      `内置包：${project.packSnapshot.name || '未选择'} v${project.packSnapshot.version || '未知'}。来源仅作方法提醒，不构成质量认证。`,
      instruction,
      '返回格式：{"batchId":"","stage":"","candidates":[{"recordId":"","decision":"","reason":"","evidence":"","location":"","fieldId":"","value":""}]}',
      `本批材料：${payloadText}`
    ].join('\n');
    if (prompt.length > MAX_PROMPT_CHARS) throw fail(`提示词共 ${prompt.length} 字，超过 ${MAX_PROMPT_CHARS} 字。请缩小批次或精简摘录后重试。`, 'PROMPT_TOO_LONG');
    return { prompt, inputCount: records.length, inputChars: payloadText.length, excerptChars, promptChars: prompt.length, recordIds: ids };
  }

  function parseReviewCandidates(rawInput, projectInput, batch) {
    const raw = typeof rawInput === 'string' ? rawInput : '';
    if (raw.length > MAX_PROMPT_CHARS) throw fail(`外部结果超过 ${MAX_PROMPT_CHARS} 字，请拆分批次后再粘贴。`, 'RESULT_TOO_LONG');
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw fail('外部结果不是有效 JSON；原文应保留供人工查看。', 'RESULT_INVALID_JSON'); }
    if (!isObject(parsed) || Object.keys(parsed).some(key => !['batchId', 'stage', 'candidates'].includes(key))
      || parsed.batchId !== batch?.id || parsed.stage !== batch?.stage || parsed.stage === 'synthesis'
      || !Array.isArray(parsed.candidates) || !parsed.candidates.length || parsed.candidates.length > MAX_BATCH_SIZE * 20) {
      throw fail('外部结果结构、批次或阶段不匹配。', 'RESULT_SCHEMA_INVALID');
    }
    const project = normalizeReviewProject(projectInput);
    const batchIds = new Set(Array.isArray(batch.recordIds) ? batch.recordIds : []);
    if (!batchIds.size || batchIds.size > MAX_BATCH_SIZE) throw fail('批次记录范围无效。', 'INVALID_BATCH');
    const records = new Map(project.records.map(record => [record.id, record]));
    const seen = new Set();
    return parsed.candidates.map((item, index) => {
      const allowed = ['recordId', 'decision', 'reason', 'evidence', 'location', 'fieldId', 'value'];
      if (!isObject(item) || Object.keys(item).some(key => !allowed.includes(key))) throw fail(`第 ${index + 1} 条候选包含未知字段。`, 'RESULT_SCHEMA_INVALID');
      const recordId = text(item.recordId, 120);
      const fieldId = text(item.fieldId, 80);
      const key = parsed.stage === 'extraction' ? `${recordId}:${fieldId}` : recordId;
      if (!recordId || !batchIds.has(recordId) || !records.has(recordId)) throw fail(`候选文献不属于当前批次：${recordId}`, 'RESULT_RECORD_OUTSIDE_BATCH');
      if (seen.has(key)) throw fail(`候选文献或字段重复：${key}`, 'RESULT_DUPLICATE_CANDIDATE');
      seen.add(key);
      for (const name of ['reason', 'evidence', 'value']) {
        if (typeof item[name] === 'string' && item[name].length > MAX_TEXT) throw fail(`${name} 最多 ${MAX_TEXT} 字。`, 'TEXT_LIMIT_EXCEEDED');
      }
      if (typeof item.location === 'string' && item.location.length > 240) throw fail('原文位置最多 240 字。', 'TEXT_LIMIT_EXCEEDED');
      const candidate = {
        id: makeId('candidate'), recordId, fieldId, decision: text(item.decision, 40),
        reason: text(item.reason), evidence: text(item.evidence), location: text(item.location, 240),
        value: text(item.value), status: 'pending'
      };
      if (parsed.stage === 'title-abstract') {
        if (!SCREENING_DECISIONS.includes(candidate.decision) || (['exclude', 'duplicate'].includes(candidate.decision) && !candidate.reason)) {
          throw fail(`题名/摘要候选决定无效或缺少理由：${recordId}`, 'RESULT_DECISION_INVALID');
        }
        if (fieldId || candidate.value) throw fail('筛选候选不能包含提取字段。', 'RESULT_SCHEMA_INVALID');
      } else if (parsed.stage === 'full-text') {
        if (!['include', 'exclude', 'not-retrieved'].includes(candidate.decision)
          || (['exclude', 'not-retrieved'].includes(candidate.decision) && !candidate.reason)) {
          throw fail(`全文候选决定无效或缺少理由：${recordId}`, 'RESULT_DECISION_INVALID');
        }
        if (fieldId || candidate.value) throw fail('全文候选不能包含提取字段。', 'RESULT_SCHEMA_INVALID');
      } else if (parsed.stage === 'extraction') {
        if (!project.extractionFields.some(field => field.id === fieldId)) throw fail(`提取候选字段未知：${fieldId}`, 'RESULT_FIELD_UNKNOWN');
        if (candidate.decision || !candidate.value || !candidate.evidence || !candidate.location) throw fail(`提取候选缺少值、依据或位置：${recordId}/${fieldId}`, 'RESULT_EXTRACTION_INCOMPLETE');
      } else {
        throw fail('当前阶段不支持结构化候选。', 'INVALID_STAGE');
      }
      return candidate;
    });
  }

  function storeExternalReviewResult(projectInput, batch, rawResult, prompt = '') {
    const project = normalizeReviewProject(projectInput);
    if (!isObject(batch) || !BATCH_STAGES.includes(batch.stage) || !text(batch.id, 120)) throw fail('批次无效。', 'INVALID_BATCH');
    if (typeof rawResult !== 'string' || rawResult.length > MAX_EXTERNAL_RESULT_CHARS) {
      throw fail(`外部结果最多 ${MAX_EXTERNAL_RESULT_CHARS} 字，当前结果未保存。`, 'RESULT_TOO_LONG');
    }
    const generated = typeof prompt === 'string' ? prompt : '';
    if (generated.length > MAX_PROMPT_CHARS) throw fail(`提示词超过 ${MAX_PROMPT_CHARS} 字。`, 'PROMPT_TOO_LONG');
    const round = {
      id: makeId('round'), stage: batch.stage, batchId: batch.id,
      promptVersionId: text(batch.promptVersionId, 120), parentPromptId: '',
      reviewer: ['reviewerOne', 'reviewerTwo'].includes(batch.reviewer) ? batch.reviewer : 'reviewerOne',
      recordIds: [...new Set((batch.recordIds || []).map(id => text(id, 120)))],
      prompt: generated, result: rawResult, status: 'returned', candidates: [], error: '',
      inputCount: Number.isSafeInteger(batch.inputCount) ? batch.inputCount : (batch.recordIds || []).length,
      inputChars: Number.isSafeInteger(batch.inputChars) ? batch.inputChars : 0,
      createdAt: new Date().toISOString()
    };
    return normalizeReviewProject({ ...project, rounds: [...project.rounds, round], updatedAt: new Date().toISOString() });
  }

  function parseExternalReviewRound(projectInput, roundId) {
    const project = normalizeReviewProject(projectInput);
    const round = project.rounds.find(item => item.id === roundId);
    if (!round) throw fail(`找不到综述轮次：${roundId}`, 'ROUND_NOT_FOUND');
    const batch = { id: round.batchId, stage: round.stage, reviewer: round.reviewer, recordIds: round.recordIds };
    try {
      round.candidates = parseReviewCandidates(round.result, project, batch);
      round.status = 'parsed';
      round.error = '';
      return { project: normalizeReviewProject(project), error: null };
    } catch (error) {
      round.status = 'failed';
      round.error = text(error.message || '外部结果解析失败', 500);
      return { project: normalizeReviewProject(project), error: { code: error.code || 'RESULT_PARSE_FAILED', message: round.error } };
    }
  }

  function resolveReviewCandidate(projectInput, roundId, candidateId, action, changes = {}) {
    let project = normalizeReviewProject(projectInput);
    const round = project.rounds.find(item => item.id === roundId);
    const candidate = round?.candidates.find(item => item.id === candidateId);
    if (!round || !candidate) throw fail('找不到待确认的综述候选。', 'CANDIDATE_NOT_FOUND');
    if (candidate.status !== 'pending') throw fail('该候选已处理。', 'CANDIDATE_ALREADY_RESOLVED');
    if (!['accept', 'modify', 'reject'].includes(action)) throw fail('候选处理方式无效。');
    if (action === 'reject') {
      candidate.status = 'rejected';
      project.updatedAt = new Date().toISOString();
      return normalizeReviewProject(project);
    }
    if (round.stage === 'title-abstract' && round.reviewer === 'reviewerTwo') {
      throw fail('审阅者二必须独立录入决定；模型候选不能计作第二方意见。', 'INDEPENDENT_REVIEW_REQUIRED');
    }
    const chosen = action === 'modify' ? { ...candidate, ...(isObject(changes) ? changes : {}) } : candidate;
    const recordId = candidate.recordId;
    if (round.stage === 'title-abstract') {
      if (changes.reviewer && changes.reviewer !== 'reviewerOne') throw fail('模型建议不算独立第二审阅者，请在人工复核中分别录入第二方决定。');
      project = setScreeningDecision(project, recordId, 'title-abstract', 'reviewerOne', {
        decision: chosen.decision, reason: chosen.reason, evidence: chosen.evidence, location: chosen.location
      });
    } else if (round.stage === 'full-text') {
      project = setFullTextDecision(project, recordId, {
        decision: chosen.decision, reason: chosen.reason, location: chosen.location,
        userConfirmedFullText: changes.userConfirmedFullText === true,
        availableToUser: changes.availableToUser === true
      });
    } else if (round.stage === 'extraction') {
      project = setExtractionValue(project, recordId, chosen.fieldId, {
        value: chosen.value, evidence: chosen.evidence, sourceLocation: chosen.location, confirmed: true
      });
    } else {
      throw fail('综合阶段没有可逐条确认的候选。', 'INVALID_STAGE');
    }
    const updatedRound = project.rounds.find(item => item.id === roundId);
    const updatedCandidate = updatedRound.candidates.find(item => item.id === candidateId);
    updatedCandidate.status = action === 'modify' ? 'modified' : 'accepted';
    project.updatedAt = new Date().toISOString();
    return normalizeReviewProject(project);
  }

  return {
    REVIEW_TYPES, SCREENING_MODELS, SCREENING_DECISIONS, FULL_TEXT_DECISIONS, BATCH_STAGES, REVIEW_ROUND_STAGES,
    MAX_REVIEW_RECORDS, MAX_BATCH_SIZE, DEFAULT_EXTRACTION_FIELDS,
    normalizeReviewProject, createReviewProject, addLiteratureRecords, previewLiteratureRefresh, confirmLiteratureRefresh,
    updateExtractionFields,
    setScreeningDecision, adjudicateScreeningDecision, setFullTextDecision, setNarrativeSelection, setExtractionValue,
    getTitleAbstractDecision, getReviewCoverage, createReviewBatches, generateReviewPrompt, parseReviewCandidates,
    storeExternalReviewResult, parseExternalReviewRound, resolveReviewCandidate
  };
});
