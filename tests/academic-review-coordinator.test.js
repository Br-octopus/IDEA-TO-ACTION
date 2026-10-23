const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../prototype/academic-review.js');

let coordinatorModule;
try { coordinatorModule = require('../prototype/academic-review-coordinator.js'); } catch { coordinatorModule = {}; }

function harness(initialState = {}) {
  let state = { knowledgeEntries: [], writingReviews: [], ...initialState };
  let writes = 0;
  let failWrite = false;
  const coordinator = coordinatorModule.createAcademicReviewCoordinator({
    review,
    getState: () => state,
    persistState(next) {
      if (failWrite) throw new Error('磁盘已满');
      writes += 1;
      state = structuredClone(next);
      return state;
    },
    newId: (() => { let next = 0; return prefix => `${prefix}-${++next}`; })(),
    now: () => '2026-10-21T00:00:00.000Z'
  });
  return {
    coordinator,
    get state() { return state; },
    get writes() { return writes; },
    set failWrite(value) { failWrite = value; }
  };
}

function projectInput(overrides = {}) {
  return {
    title: '模拟综述', reviewType: 'scoping-review', question: '问题', scope: '范围',
    inclusionCriteria: ['纳入条件'], exclusionCriteria: ['排除条件'], ...overrides
  };
}

test('新建项目默认只存在当前会话，显式开启保存后写入本机', async () => {
  const app = harness();
  const project = await app.coordinator.createProject(projectInput());
  assert.ok(project.id);
  assert.equal(project.saveEnabled, false);
  assert.equal(app.state.writingReviews.length, 0);
  assert.equal(app.coordinator.getProject(project.id).title, '模拟综述');

  await app.coordinator.setSaveEnabled(project.id, true);
  assert.equal(app.state.writingReviews.length, 1);
  assert.equal(app.state.writingReviews[0].saveEnabled, true);
});

test('暂停保存保留最近一次已保存快照，暂停后的修改不落盘', async () => {
  const app = harness();
  const project = await app.coordinator.createProject(projectInput());
  await app.coordinator.setSaveEnabled(project.id, true);
  await app.coordinator.updateProject(project.id, { title: '已保存标题' });
  const writesBeforePause = app.writes;

  await app.coordinator.setSaveEnabled(project.id, false);
  await app.coordinator.updateProject(project.id, { title: '仅会话标题' });
  assert.equal(app.writes, writesBeforePause + 1);
  assert.equal(app.coordinator.getProject(project.id).title, '仅会话标题');
  assert.equal(app.state.writingReviews[0].title, '已保存标题');
  assert.equal(app.state.writingReviews[0].saveEnabled, false);
});

test('文献刷新先预览后确认，批次固定记录并生成范围提示词', async () => {
  const entries = [{ id: 'lit-1', type: 'academic-literature', title: '题名一', summary: '摘录一' }];
  const app = harness({ knowledgeEntries: entries });
  const project = await app.coordinator.createProject(projectInput());
  const preview = await app.coordinator.previewLiteratureRefresh(project.id, ['lit-1']);
  assert.equal(app.coordinator.getProject(project.id).records.length, 0);
  await app.coordinator.confirmLiteratureRefresh(project.id, preview);
  const batches = await app.coordinator.createBatches(project.id, 'title-abstract', { size: 1 });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].recordIds.length, 1);
  const result = await app.coordinator.generatePrompt(project.id, batches[0].id);
  assert.match(result.prompt, /题名一/);
  assert.equal(result.inputCount, 1);
  assert.ok(result.roundId, '生成的提示词应有可追溯轮次');
  assert.equal(app.coordinator.getProject(project.id).rounds[0].status, 'generated');

  const edited = await app.coordinator.updatePrompt(project.id, result.roundId, `${result.prompt}\n用户补充约束`);
  assert.notEqual(edited.id, result.roundId, '编辑后的提示词应创建独立版本');
  assert.equal(edited.status, 'edited');
  await app.coordinator.markPromptCopied(project.id, edited.id);
  const recordId = batches[0].recordIds[0];
  const raw = JSON.stringify({ batchId: batches[0].id, stage: 'title-abstract', candidates: [
    { recordId, decision: 'include', reason: '符合范围', evidence: '摘录一', location: '摘要' }
  ] });
  const returned = await app.coordinator.storeExternalResult(project.id, edited.id, raw);
  assert.notEqual(returned.id, edited.id, '外部结果应保留为新的结果轮次');
  assert.equal(returned.promptVersionId, edited.id, '外部结果应关联到实际复制的提示词版本');
  assert.equal(app.coordinator.getProject(project.id).rounds.find(round => round.id === edited.id).status, 'copied');
  const parsed = await app.coordinator.parseExternalResult(project.id, returned.id);
  assert.equal(parsed.error, null);
  const candidate = app.coordinator.getProject(project.id).rounds.find(round => round.id === returned.id).candidates[0];
  await app.coordinator.resolveCandidate(project.id, returned.id, candidate.id, 'accept');
  assert.equal(app.coordinator.getProject(project.id).records[0].screening.titleAbstract.reviewerOne.decision, 'include');
});

test('方案提示词可独立生成并保留原始外部结果轮次', async () => {
  const app = harness();
  const project = await app.coordinator.createProject(projectInput());
  const result = await app.coordinator.generatePlanPrompt(project.id);
  assert.match(result.prompt, /研究问题/);
  assert.equal(app.coordinator.getProject(project.id).rounds[0].stage, 'plan');
  const round = await app.coordinator.storeExternalResult(project.id, result.roundId, '方案建议文本');
  assert.equal(round.status, 'returned');
  assert.equal(round.result, '方案建议文本');
});

test('写入失败时保留原项目快照', async () => {
  const app = harness();
  const project = await app.coordinator.createProject(projectInput());
  await app.coordinator.setSaveEnabled(project.id, true);
  app.failWrite = true;
  await assert.rejects(app.coordinator.updateProject(project.id, { title: '不应提交' }), /磁盘已满/);
  assert.equal(app.coordinator.getProject(project.id).title, '模拟综述');
  assert.equal(app.state.writingReviews[0].title, '模拟综述');
});

test('删除已保存项目同时删除其项目快照和轮次', async () => {
  const app = harness();
  const project = await app.coordinator.createProject(projectInput());
  await app.coordinator.setSaveEnabled(project.id, true);
  await app.coordinator.deleteProject(project.id);
  assert.deepEqual(app.state.writingReviews, []);
  assert.equal(app.coordinator.getProject(project.id), null);
});
