const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../prototype/academic-review.js');

function literature(id, title, excerpt = '') {
  return {
    id,
    type: 'academic-literature',
    title,
    sourceUrl: 'file:///C:/private/paper.pdf',
    apiKey: 'review-secret-marker',
    literature: {
      authors: ['作者'], year: '2024', publication: '期刊', doi: `10.5555/${id}`,
      pmid: '', metadataStatus: 'user-verified', readingStatus: excerpt ? 'excerpt-only' : 'unread',
      abstractExcerpt: excerpt, excerptLocation: excerpt ? '第 2 页' : ''
    }
  };
}

function project(reviewType = 'systematic-review', screeningModel = 'single-reviewer') {
  return review.createReviewProject({
    id: 'review-1', title: '模拟综述', reviewType, question: '模拟问题', scope: '模拟范围',
    screeningModel, inclusionCriteria: ['模拟纳入标准'], exclusionCriteria: ['模拟排除标准']
  });
}

function decide(projectState, recordId, reviewer, decision) {
  return review.setScreeningDecision(projectState, recordId, 'title-abstract', reviewer, {
    decision, reason: `模拟理由 ${reviewer}`
  });
}

test('综述项目按类型校验必填项，并默认不保存项目历史', () => {
  assert.deepEqual(review.REVIEW_TYPES, ['narrative-review', 'scoping-review', 'systematic-review']);
  const item = project('scoping-review');
  assert.equal(item.reviewType, 'scoping-review');
  assert.equal(item.saveEnabled, false);
  assert.equal(item.screeningModel, 'single-reviewer');
  assert.deepEqual(item.records, []);
  assert.ok(item.extractionFields.length > 0);
  assert.throws(() => review.createReviewProject({ ...item, reviewType: 'magic-review' }), /综述类型/);
  assert.throws(() => review.createReviewProject({ ...item, question: '' }), /研究问题/);
});

test('文献快照只包含用户选择的题录和用户摘录，并清除路径与未知敏感字段', () => {
  const base = project();
  const result = review.addLiteratureRecords(base, ['paper-1', 'paper-2'], [
    literature('paper-1', '模拟研究一', '模拟摘录一'),
    literature('paper-2', '模拟研究二', '模拟摘录二'),
    literature('paper-3', '未选研究')
  ]);
  assert.equal(result.added.length, 2);
  assert.equal(result.project.records.length, 2);
  assert.deepEqual(result.project.records.map(item => item.sourceEntryId), ['paper-1', 'paper-2']);
  assert.equal(result.project.records[0].snapshot.title, '模拟研究一');
  assert.equal(result.project.records[0].snapshot.excerpt, '模拟摘录一');
  assert.equal(JSON.stringify(result.project).includes('file:///'), false);
  assert.equal(JSON.stringify(result.project).includes('review-secret-marker'), false);
});

test('重复选择和未知题录单独报告，不改变既有项目快照', () => {
  const original = review.addLiteratureRecords(project(), ['paper-1'], [literature('paper-1', '已选研究')]).project;
  const result = review.addLiteratureRecords(original, ['paper-1', 'missing'], [literature('paper-1', '后来改名')]);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.project.records.length, 1);
  assert.equal(result.project.records[0].snapshot.title, '已选研究');
  assert.equal(original.records[0].snapshot.title, '已选研究');
});

test('双人筛选分歧保持待裁定，全文和提取覆盖分别计数', () => {
  let state = review.addLiteratureRecords(project('systematic-review', 'two-reviewers'), [
    'paper-1', 'paper-2', 'paper-3', 'paper-4'
  ], [
    literature('paper-1', '纳入研究一', '摘录一'), literature('paper-2', '分歧研究', '摘录二'),
    literature('paper-3', '排除研究', '摘录三'), literature('paper-4', '全文未获取', '摘录四')
  ]).project;
  state = decide(state, 'paper-1', 'reviewerOne', 'include');
  state = decide(state, 'paper-1', 'reviewerTwo', 'include');
  state = decide(state, 'paper-2', 'reviewerOne', 'include');
  state = decide(state, 'paper-2', 'reviewerTwo', 'exclude');
  state = decide(state, 'paper-3', 'reviewerOne', 'exclude');
  state = decide(state, 'paper-3', 'reviewerTwo', 'exclude');
  state = decide(state, 'paper-4', 'reviewerOne', 'include');
  state = decide(state, 'paper-4', 'reviewerTwo', 'include');
  state = review.setFullTextDecision(state, 'paper-1', { decision: 'include', userConfirmedFullText: true, location: '全文第 2 页' });
  state = review.setFullTextDecision(state, 'paper-4', { decision: 'not-retrieved', userConfirmedFullText: false, reason: '暂时无法取得' });
  const report = review.getReviewCoverage(state);
  assert.equal(report.totalRecords, 4);
  assert.equal(report.titleAbstractNeedsAdjudication, 1);
  assert.equal(report.titleAbstractIncluded, 2);
  assert.equal(report.titleAbstractExcluded, 1);
  assert.equal(report.fullTextEligible, 2);
  assert.equal(report.fullTextIncluded, 1);
  assert.equal(report.fullTextNotRetrieved, 1);
  assert.equal(report.synthesisReady, 0);
  assert.equal(report.complete, false);
});

test('审阅者二的模型候选不能覆盖审阅者一或冒充独立决定', () => {
  let state = review.addLiteratureRecords(project('systematic-review', 'two-reviewers'), ['paper-1'], [
    literature('paper-1', '双人筛选模拟研究', '仅供验收的摘要')
  ]).project;
  state = decide(state, 'paper-1', 'reviewerOne', 'include');
  const [batch] = review.createReviewBatches(state, 'title-abstract', { size: 1, reviewer: 'reviewerTwo' });
  const raw = JSON.stringify({ batchId: batch.id, stage: batch.stage, candidates: [
    { recordId: 'paper-1', decision: 'exclude', reason: '模型建议排除', evidence: '模拟摘要', location: '摘要第 1 段' }
  ] });
  state = review.storeExternalReviewResult(state, batch, raw);
  const roundId = state.rounds[0].id;
  const parsed = review.parseExternalReviewRound(state, roundId);
  const candidate = parsed.project.rounds[0].candidates[0];

  assert.throws(
    () => review.resolveReviewCandidate(parsed.project, roundId, candidate.id, 'accept'),
    error => error.code === 'INDEPENDENT_REVIEW_REQUIRED'
  );
  assert.equal(parsed.project.records[0].screening.titleAbstract.reviewerOne.decision, 'include');
  assert.equal(parsed.project.records[0].screening.titleAbstract.reviewerTwo.decision, '');
  assert.equal(parsed.project.rounds[0].candidates[0].status, 'pending');
});

test('叙述性综述不虚构系统筛选阶段，覆盖只描述已选文献和提取状态', () => {
  let state = review.addLiteratureRecords(project('narrative-review'), ['paper-1'], [literature('paper-1', '叙述研究')]).project;
  state = review.setNarrativeSelection(state, 'paper-1', false);
  const report = review.getReviewCoverage(state);
  assert.equal(report.titleAbstractApplicable, false);
  assert.equal(report.fullTextApplicable, false);
  assert.equal(report.totalRecords, 1);
  assert.equal(report.narrativeSelected, 0);
  assert.equal(report.complete, false);
});

test('题名摘要决定转为分歧后，旧全文决定失效且不能继续计入纳入数', () => {
  let state = review.addLiteratureRecords(project('systematic-review', 'two-reviewers'), ['paper-1'], [literature('paper-1', '研究')]).project;
  state = decide(state, 'paper-1', 'reviewerOne', 'include');
  state = decide(state, 'paper-1', 'reviewerTwo', 'include');
  state = review.setFullTextDecision(state, 'paper-1', { decision: 'include', userConfirmedFullText: true, location: '第 3 页' });
  state = decide(state, 'paper-1', 'reviewerTwo', 'exclude');
  const report = review.getReviewCoverage(state);
  assert.equal(report.titleAbstractNeedsAdjudication, 1);
  assert.equal(report.fullTextIncluded, 0);
  assert.equal(report.synthesisReady, 0);
});

test('待筛选文献按批次分组，大小限制 1 到 5 且只返回项目内记录', () => {
  const entries = Array.from({ length: 7 }, (_, index) => literature(`paper-${index}`, `模拟研究 ${index}`));
  const ids = entries.map(item => item.id);
  const state = review.addLiteratureRecords(project(), ids, entries).project;
  const batches = review.createReviewBatches(state, 'title-abstract', { size: 3, reviewer: 'reviewerOne' });
  assert.deepEqual(batches.map(batch => batch.recordIds.length), [3, 3, 1]);
  assert.equal(new Set(batches.flatMap(batch => batch.recordIds)).size, 7);
  assert.throws(() => review.createReviewBatches(state, 'title-abstract', { size: 6 }), /1 到 5/);
  assert.throws(() => review.createReviewBatches(state, 'unknown-stage', { size: 2 }), /阶段/);
});

test('超过项目记录上限时拒绝整批添加，不静默截断', () => {
  const entries = Array.from({ length: review.MAX_REVIEW_RECORDS + 1 }, (_, index) => literature(`paper-${index}`, `研究 ${index}`));
  const ids = entries.map(item => item.id);
  const base = project();
  assert.throws(() => review.addLiteratureRecords(base, ids, entries), /最多/);
  assert.equal(base.records.length, 0);
});

test('超出 1200 字的文献摘录明确拒绝，不静默截断', () => {
  const base = project();
  const entry = literature('long-paper', '长摘录研究', '摘录'.repeat(601));
  assert.throws(() => review.addLiteratureRecords(base, ['long-paper'], [entry]), /1200/);
  assert.equal(base.records.length, 0);
});

test('刷新文献快照只预览新增、重复和资料库缺失项，不改写既有快照', () => {
  const base = review.addLiteratureRecords(project(), ['paper-1'], [literature('paper-1', '固定题名')]).project;
  const preview = review.previewLiteratureRefresh(base, ['paper-1', 'paper-2'], [
    literature('paper-1', '后来改名'), literature('paper-2', '新增题名')
  ]);
  assert.deepEqual(preview.additions.map(item => item.sourceEntryId), ['paper-2']);
  assert.deepEqual(preview.duplicates, ['paper-1']);
  assert.deepEqual(preview.missing, []);
  assert.equal(base.records[0].snapshot.title, '固定题名');
});

test('提取字段可增删排序，并为新字段建立空的逐文献值', () => {
  const base = review.addLiteratureRecords(project(), ['paper-1'], [literature('paper-1', '研究')]).project;
  const updated = review.updateExtractionFields(base, [
    { id: 'result', label: '结果', required: true, order: 2 },
    { id: 'population', label: '对象', required: false, order: 1 }
  ]);
  assert.deepEqual(updated.extractionFields.map(field => field.id), ['population', 'result']);
  assert.deepEqual(Object.keys(updated.records[0].extraction), ['population', 'result']);
  assert.throws(() => review.updateExtractionFields(base, Array.from({ length: 21 }, (_, index) => ({ id: `f${index}`, label: `字段${index}` }))), /20/);
});

test('项目固定包快照保留官方来源版本、章节和核验边界', () => {
  const pack = require('../prototype/writing-pack-catalog.js').getBuiltinWritingPacks().find(item => item.id === 'builtin-academic-review');
  const state = review.createReviewProject({
    id: 'review-source-snapshot', title: '来源快照', reviewType: 'narrative-review',
    question: '问题', scope: '范围', packSnapshot: pack
  });
  const jbi = state.packSnapshot.sources.find(source => source.id === 'jbi-manual');
  assert.match(jbi.locator, /10\.1.*10\.2/);
  assert.equal(jbi.verificationStatus, 'source-reviewed');
  assert.match(jbi.version, /27 August 2026/);
});

test('筛选提示词只包含固定批次题录，显示真实条数、摘录字数与全文边界', () => {
  const state = review.addLiteratureRecords(project(), ['paper-1', 'paper-2', 'paper-3'], [
    literature('paper-1', '批次内一', '一段已提供摘录'),
    literature('paper-2', '批次内二', '第二段摘录'),
    literature('paper-3', '批次外', '不可混入的摘录')
  ]).project;
  const [batch] = review.createReviewBatches(state, 'title-abstract', { size: 2 });
  const result = review.generateReviewPrompt(state, 'title-abstract', batch);
  assert.equal(result.inputCount, 2);
  assert.equal(result.recordIds.length, 2);
  assert.match(result.prompt, /不代表已核读全文/);
  assert.doesNotMatch(result.prompt, /批次外/);
});

test('外部结构化候选必须匹配批次和文献 ID，且保持待人工确认', () => {
  const state = review.addLiteratureRecords(project(), ['paper-1', 'paper-2'], [
    literature('paper-1', '研究一'), literature('paper-2', '研究二')
  ]).project;
  const [batch] = review.createReviewBatches(state, 'title-abstract', { size: 2 });
  const raw = JSON.stringify({ batchId: batch.id, stage: batch.stage, candidates: [
    { recordId: 'paper-1', decision: 'include', reason: '模拟理由', evidence: '模拟摘录', location: '摘要' }
  ] });
  const parsed = review.parseReviewCandidates(raw, state, batch);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].status, 'pending');
  assert.throws(() => review.parseReviewCandidates(raw, state, { ...batch, recordIds: ['paper-2'] }), /批次/);
  assert.throws(() => review.parseReviewCandidates(JSON.stringify({ batchId: batch.id, stage: batch.stage, candidates: [
    { recordId: 'outside', decision: 'include' }
  ] }), state, batch), /批次/);
});

test('不能把已排除记录伪装成新的题名摘要批次输入', () => {
  let state = review.addLiteratureRecords(project(), ['paper-1'], [literature('paper-1', '已排除研究')]).project;
  state = decide(state, 'paper-1', 'reviewerOne', 'exclude');
  assert.throws(() => review.generateReviewPrompt(state, 'title-abstract', {
    id: 'forged-batch', stage: 'title-abstract', reviewer: 'reviewerOne', recordIds: ['paper-1']
  }), /不符合当前阶段条件/);
});

test('解析失败保留外部原文；全文候选须由用户确认核读后才能写入', () => {
  let state = review.addLiteratureRecords(project('scoping-review'), ['paper-1'], [literature('paper-1', '研究')]).project;
  state = decide(state, 'paper-1', 'reviewerOne', 'include');
  const [batch] = review.createReviewBatches(state, 'full-text', { size: 1 });
  const raw = JSON.stringify({ batchId: batch.id, stage: batch.stage, candidates: [
    { recordId: 'paper-1', decision: 'include', reason: '', evidence: '待用户核对的材料', location: '第 2 页' }
  ] });
  state = review.storeExternalReviewResult(state, batch, raw);
  const roundId = state.rounds[0].id;
  const parsed = review.parseExternalReviewRound(state, roundId);
  assert.equal(parsed.error, null);
  const candidate = parsed.project.rounds[0].candidates[0];
  assert.throws(() => review.resolveReviewCandidate(parsed.project, roundId, candidate.id, 'accept'), /亲自核对全文/);
  state = review.resolveReviewCandidate(parsed.project, roundId, candidate.id, 'accept', {
    userConfirmedFullText: true, availableToUser: true
  });
  assert.equal(state.records[0].screening.fullText.decision, 'include');
  assert.equal(state.records[0].screening.fullText.userConfirmedFullText, true);
  assert.equal(state.rounds[0].candidates[0].status, 'accepted');

  const invalid = review.storeExternalReviewResult(state, batch, '{not json');
  const failed = review.parseExternalReviewRound(invalid, invalid.rounds[1].id);
  assert.equal(failed.project.rounds[1].result, '{not json');
  assert.equal(failed.project.rounds[1].status, 'failed');
  assert.equal(failed.error.code, 'RESULT_INVALID_JSON');
});

test('全文决定、双人裁定和提取确认保留审阅者与时间', () => {
  let state = review.addLiteratureRecords(project('systematic-review', 'two-reviewers'), ['paper-1'], [
    literature('paper-1', '需追溯决定的研究')
  ]).project;
  state = decide(state, 'paper-1', 'reviewerOne', 'include');
  state = decide(state, 'paper-1', 'reviewerTwo', 'exclude');
  state = review.adjudicateScreeningDecision(state, 'paper-1', { decision: 'include', reason: '人工裁定', reviewerId: 'reviewer-final' });
  state = review.setFullTextDecision(state, 'paper-1', {
    decision: 'include', userConfirmedFullText: true, availableToUser: true, reviewerId: 'reader-1'
  });
  state = review.setExtractionValue(state, 'paper-1', 'study-design', {
    value: '随机对照', evidence: '原文依据', sourceLocation: '第 4 页', confirmed: true
  });
  const record = state.records[0];
  assert.equal(record.screening.titleAbstract.adjudication.reviewerId, 'reviewer-final');
  assert.ok(Date.parse(record.screening.titleAbstract.adjudication.decidedAt));
  assert.equal(record.screening.fullText.reviewerId, 'reader-1');
  assert.ok(Date.parse(record.screening.fullText.decidedAt));
  assert.ok(Date.parse(record.extraction['study-design'].confirmedAt));
});

test('提示词与外部候选超限时明确报错并保留原结果，不截断', () => {
  const stateInput = project('systematic-review');
  stateInput.question = '问'.repeat(1200);
  stateInput.scope = '界'.repeat(1200);
  stateInput.inclusionCriteria = ['纳'.repeat(1200)];
  stateInput.exclusionCriteria = ['排'.repeat(1200)];
  const entries = Array.from({ length: 5 }, (_, index) => literature(`paper-${index}`, `研究 ${index}`, '摘'.repeat(900)));
  let state = review.addLiteratureRecords(stateInput, entries.map(entry => entry.id), entries).project;
  const [batch] = review.createReviewBatches(state, 'title-abstract', { size: 5 });
  assert.throws(() => review.generateReviewPrompt(state, 'title-abstract', batch), /超过 8000 字.*缩小批次/);

  const raw = 'x'.repeat(8001);
  state = review.storeExternalReviewResult(state, batch, raw);
  const failed = review.parseExternalReviewRound(state, state.rounds[0].id);
  assert.equal(failed.project.rounds[0].result, raw);
  assert.equal(failed.project.rounds[0].status, 'failed');
  assert.equal(failed.error.code, 'RESULT_TOO_LONG');

  const duplicate = JSON.stringify({ batchId: batch.id, stage: batch.stage, candidates: [
    { recordId: 'paper-0', decision: 'include' }, { recordId: 'paper-0', decision: 'include' }
  ] });
  assert.throws(() => review.parseReviewCandidates(duplicate, state, batch), /重复/);
});

test('只有已确认纳入全文或已选叙述材料才能保存提取值', () => {
  let state = review.addLiteratureRecords(project('systematic-review'), ['paper-1'], [literature('paper-1', '待筛选研究')]).project;
  assert.throws(() => review.setExtractionValue(state, 'paper-1', 'study-design', {
    value: '随机对照', evidence: '原文依据', sourceLocation: '第 4 页', confirmed: true
  }), /先确认全文纳入/);
  state = decide(state, 'paper-1', 'reviewerOne', 'include');
  state = review.setFullTextDecision(state, 'paper-1', { decision: 'include', userConfirmedFullText: true });
  assert.doesNotThrow(() => review.setExtractionValue(state, 'paper-1', 'study-design', {
    value: '随机对照', evidence: '原文依据', sourceLocation: '第 4 页', confirmed: true
  }));
});
