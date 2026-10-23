const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../prototype/storage.js');
const { createWritingApp } = require('./helpers/writing-app.js');

test('D 盘资料库 UI 可创建综述、确认题录快照并生成固定批次提示词', async () => {
  const initialState = storage.createEmptyState();
  initialState.knowledgeEntries.push({
    id: 'mock-literature-1', type: 'academic-literature', title: '模拟题录',
    literature: { authors: ['模拟作者'], year: '2025', abstractExcerpt: '仅用于验收的摘要摘录', readingStatus: 'excerpt-only' }
  });
  const app = createWritingApp({ initialState });
  const ui = app.academicReviewDOM;
  assert.ok(ui, '应用测试环境应挂载综述工作台真实 DOM');
  assert.equal(typeof app.academicReviewCoordinator?.createProject, 'function');

  await ui.input('review-create-title', '验收范围综述');
  await ui.input('review-create-question', '模拟研究问题');
  await ui.input('review-create-scope', '模拟研究范围');
  await ui.input('review-create-inclusion', '模拟纳入条件');
  await ui.input('review-create-exclusion', '模拟排除条件');
  await ui.change('review-create-type', 'scoping-review');
  await ui.click('review-create-project');
  const project = app.academicReviewCoordinator.listProjects()[0];
  assert.equal(project.reviewType, 'scoping-review');
  await ui.change(`review-toggle-save-${project.id}`, true);
  assert.equal(app.diskState.writingReviews.length, 1);

  await ui.changeAction('review-select-literature', { entryId: 'mock-literature-1' }, true);
  await ui.click('review-preview-literature');
  await ui.click('review-confirm-literature');
  assert.equal(app.academicReviewCoordinator.getProject(project.id).records.length, 1, '确认后应冻结题录快照');
  await ui.change('review-batch-stage', 'title-abstract');
  await ui.click('review-create-batches');
  const afterBatches = app.academicReviewCoordinator.getProject(project.id);
  assert.equal(afterBatches.batches.length, 1, '待筛选题录应进入固定批次');
  assert.equal(app.window.ForwardStepAcademicReviewUIController.getActiveProjectId(), project.id);
  assert.equal(app.window.ForwardStepAcademicReviewUIController.getSelectedBatchId(), afterBatches.batches[0].id);
  assert.equal(ui.mount.querySelector('[data-action="review-generate-prompt"]')?.disabled, false, ui.mount.innerHTML.slice(-2200));
  await ui.click('review-generate-prompt');

  const updated = app.academicReviewCoordinator.getProject(project.id);
  assert.equal(updated.records.length, 1);
  assert.equal(updated.batches.length, 1);
  assert.match(ui.mount.innerHTML, /仅用于验收的摘要摘录/);
  assert.match(ui.mount.innerHTML, /提示词已生成/);

  const generatedRound = updated.rounds.at(-1);
  const editedPrompt = `${generatedRound.prompt}\n用户验收补充条件`;
  await ui.input('review-generated-prompt', editedPrompt);
  await ui.change('review-generated-prompt', editedPrompt);
  const editedRound = app.academicReviewCoordinator.getProject(project.id).rounds.at(-1);
  assert.equal(editedRound.status, 'edited');
  assert.equal(editedRound.parentPromptId, generatedRound.id);
  await ui.click('review-copy-prompt');
  assert.equal(app.academicReviewCoordinator.getProject(project.id).rounds.at(-1).status, 'copied');

  const batch = updated.batches[0];
  await ui.input('review-external-result', JSON.stringify({ batchId: batch.id, stage: batch.stage, candidates: [
    { recordId: batch.recordIds[0], decision: 'include', reason: '符合范围', evidence: '模拟摘要', location: '摘要' }
  ] }));
  await ui.click('review-store-result');
  const round = app.academicReviewCoordinator.getProject(project.id).rounds.at(-1);
  assert.equal(round.status, 'parsed');
  assert.equal(round.promptVersionId, editedRound.id);
  assert.equal(round.candidates[0].status, 'pending');
  await ui.click('review-candidate-accept', { roundId: round.id, candidateId: round.candidates[0].id });
  assert.equal(app.academicReviewCoordinator.getProject(project.id).records[0].screening.titleAbstract.reviewerOne.decision, 'include');
  assert.equal(app.diskState.writingReviews[0].records[0].screening.titleAbstract.reviewerOne.decision, 'include');

  await ui.change('review-batch-stage', 'full-text');
  await ui.change('review-batch-size', 1);
  await ui.click('review-create-batches');
  const fullTextBatch = app.academicReviewCoordinator.getProject(project.id).batches.at(-1);
  await ui.click('review-generate-prompt');
  assert.match(app.academicReviewCoordinator.getProject(project.id).rounds.at(-1).prompt, /题录与摘录不等于全文/);

  const fullTextResult = {
    batchId: fullTextBatch.id,
    stage: 'full-text',
    candidates: [{
      recordId: 'mock-literature-1', decision: 'include', reason: '模拟全文符合范围',
      evidence: '模拟全文中的研究设计段落', location: '模拟全文第 2 页'
    }]
  };
  await ui.input('review-external-result', JSON.stringify(fullTextResult));
  await ui.click('review-store-result');
  const fullTextRound = app.academicReviewCoordinator.getProject(project.id).rounds.at(-1);
  const fullTextCandidate = fullTextRound.candidates[0];
  await ui.change(`review-candidate-fulltext-confirm-${fullTextCandidate.id}`, true);
  await ui.change(`review-candidate-fulltext-available-${fullTextCandidate.id}`, true);
  await ui.click('review-candidate-accept', { roundId: fullTextRound.id, candidateId: fullTextCandidate.id });

  const afterFullText = app.academicReviewCoordinator.getProject(project.id);
  assert.equal(afterFullText.records[0].screening.fullText.decision, 'include');
  assert.equal(afterFullText.records[0].screening.fullText.userConfirmedFullText, true);
  assert.equal(afterFullText.records[0].screening.fullText.availableToUser, true);
  assert.equal(afterFullText.rounds.at(-1).candidates[0].status, 'accepted');

  const extractionField = afterFullText.extractionFields[0];
  const extractionPrefix = `review-extract-value-${afterFullText.records[0].id}-${extractionField.id}`;
  await ui.input(extractionPrefix, '模拟提取结果');
  await ui.input(`review-extract-evidence-${afterFullText.records[0].id}-${extractionField.id}`, '模拟全文支持该结果的原文');
  await ui.input(`review-extract-location-${afterFullText.records[0].id}-${extractionField.id}`, '第 2 页');
  await ui.click('review-confirm-extraction', { recordId: afterFullText.records[0].id, fieldId: extractionField.id });

  const confirmedProject = app.academicReviewCoordinator.getProject(project.id);
  const confirmedExtraction = confirmedProject.records[0].extraction[extractionField.id];
  assert.equal(confirmedExtraction.value, '模拟提取结果');
  assert.equal(confirmedExtraction.evidence, '模拟全文支持该结果的原文');
  assert.equal(confirmedExtraction.sourceLocation, '第 2 页');
  assert.equal(confirmedExtraction.confirmed, true);
  assert.equal(app.diskState.writingReviews[0].records[0].extraction[extractionField.id].confirmed, true);
});

test('D 盘资料库 UI 将系统综述分歧送交人工裁定并计入全文无法获取覆盖', async () => {
  const initialState = storage.createEmptyState();
  initialState.knowledgeEntries.push({
    id: 'mock-systematic-literature', type: 'academic-literature', title: '模拟系统综述题录',
    literature: { authors: ['模拟作者'], year: '2026', abstractExcerpt: '仅用于系统综述 UI 验收', readingStatus: 'excerpt-only' }
  });
  const app = createWritingApp({ initialState });
  const ui = app.academicReviewDOM;

  await ui.input('review-create-title', '验收双人筛选系统综述');
  await ui.input('review-create-question', '模拟题录是否符合纳入条件');
  await ui.input('review-create-scope', '仅测试双人分歧与全文无法获取状态');
  await ui.input('review-create-inclusion', '模拟纳入条件');
  await ui.input('review-create-exclusion', '模拟排除条件');
  await ui.change('review-create-type', 'systematic-review');
  await ui.change('review-create-screening', 'two-reviewers');
  await ui.click('review-create-project');
  const project = app.academicReviewCoordinator.listProjects()[0];
  await ui.change(`review-toggle-save-${project.id}`, true);

  await ui.changeAction('review-select-literature', { entryId: 'mock-systematic-literature' }, true);
  await ui.click('review-preview-literature');
  await ui.click('review-confirm-literature');

  async function submitDecision(reviewer, decision) {
    await ui.change('review-batch-stage', 'title-abstract');
    await ui.change('review-batch-reviewer', reviewer);
    assert.equal(ui.mount.querySelector('#review-batch-reviewer')?.value, reviewer, '界面应保留所选审阅者');
    await ui.change('review-batch-size', 1);
    await ui.click('review-create-batches');
    const batch = app.academicReviewCoordinator.getProject(project.id).batches.at(-1);
    assert.equal(batch.reviewer, reviewer, '新批次应绑定当前审阅者');
    await ui.click('review-generate-prompt');
    await ui.input('review-external-result', JSON.stringify({
      batchId: batch.id, stage: 'title-abstract', candidates: [{
        recordId: batch.recordIds[0], decision, reason: `审阅者决定：${decision}`,
        evidence: '模拟摘要内容', location: '摘要第 1 段'
      }]
    }));
    await ui.click('review-store-result');
    const round = app.academicReviewCoordinator.getProject(project.id).rounds.at(-1);
    if (reviewer === 'reviewerTwo') return round;
    await ui.click('review-candidate-accept', { roundId: round.id, candidateId: round.candidates[0].id });
    return round;
  }

  await submitDecision('reviewerOne', 'include');
  const secondReviewerRound = await submitDecision('reviewerTwo', 'exclude');
  assert.equal(secondReviewerRound.candidates[0].status, 'pending', '第二审阅者的模型建议应继续保持待处理');
  assert.equal(ui.mount.querySelector('[data-action="review-candidate-accept"]')?.disabled, true);
  assert.match(ui.mount.innerHTML, /模型候选不能作为独立意见/);
  let current = app.academicReviewCoordinator.getProject(project.id);
  const recordId = current.records[0].id;
  assert.equal(current.records[0].screening.titleAbstract.reviewerOne.decision, 'include', '第二审阅者批次不能覆盖第一方意见');
  assert.equal(current.records[0].screening.titleAbstract.reviewerTwo.decision, '');
  await ui.input(`review-reason-${recordId}-reviewerTwo`, '审阅者二独立判断为排除');
  await ui.changeAction('review-screening-decision', { recordId, reviewer: 'reviewerTwo' }, 'exclude');
  current = app.academicReviewCoordinator.getProject(project.id);
  assert.equal(current.records[0].screening.titleAbstract.adjudication.decision, '');
  assert.equal(app.academicReviewCoordinator.getCoverage(project.id).titleAbstractNeedsAdjudication, 1, JSON.stringify(current.records[0].screening.titleAbstract));
  assert.match(ui.mount.innerHTML, /data-action="review-adjudication"/);

  await ui.input(`review-adjudication-reason-${recordId}`, '按预先记录的范围人工裁定为纳入');
  await ui.changeAction('review-adjudication', { recordId }, 'include');
  current = app.academicReviewCoordinator.getProject(project.id);
  assert.equal(current.records[0].screening.titleAbstract.adjudication.decision, 'include');
  assert.equal(app.academicReviewCoordinator.getCoverage(project.id).titleAbstractNeedsAdjudication, 0);

  await ui.change('review-batch-stage', 'full-text');
  await ui.click('review-create-batches');
  const fullTextBatch = app.academicReviewCoordinator.getProject(project.id).batches.at(-1);
  await ui.click('review-generate-prompt');
  await ui.input('review-external-result', JSON.stringify({
    batchId: fullTextBatch.id, stage: 'full-text', candidates: [{
      recordId, decision: 'not-retrieved', reason: '馆藏未提供可获取的全文',
      evidence: '本轮没有全文材料', location: '全文状态'
    }]
  }));
  await ui.click('review-store-result');
  const fullTextRound = app.academicReviewCoordinator.getProject(project.id).rounds.at(-1);
  await ui.click('review-candidate-accept', { roundId: fullTextRound.id, candidateId: fullTextRound.candidates[0].id });

  current = app.academicReviewCoordinator.getProject(project.id);
  assert.equal(current.records[0].screening.fullText.decision, 'not-retrieved');
  assert.equal(current.records[0].screening.fullText.reason, '馆藏未提供可获取的全文');
  assert.equal(app.academicReviewCoordinator.getCoverage(project.id).fullTextNotRetrieved, 1);
  assert.equal(app.diskState.writingReviews[0].records[0].screening.fullText.decision, 'not-retrieved');
});
