const test = require('node:test');
const assert = require('node:assert/strict');
const publishing = require('../prototype/academic-publishing.js');
let coordinatorModule;
try { coordinatorModule = require('../prototype/academic-publishing-coordinator.js'); } catch { coordinatorModule = {}; }

function harness(initialState = {}) {
  let state = { knowledgeEntries: [], academicResponseProjects: [], ...initialState };
  let writes = 0;
  let failWrite = false;
  const coordinator = coordinatorModule.createAcademicPublishingCoordinator({
    publishing,
    getState: () => state,
    getKnowledgeEntries: () => state.knowledgeEntries,
    builtinPack: { id: 'builtin-academic-publishing', name: '学术核验与投稿准备', version: 1, sources: [{ id: 'crossref-rest-api' }, { id: 'cope-peer-reviewers' }] },
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

test('新建投稿项目默认只在会话中，开启保存后写入且固定基础包版本', async () => {
  const app = harness();
  const project = await app.coordinator.createProject({ title: '引用核验', target: { venue: '目标期刊' } });
  assert.equal(project.saveEnabled, false);
  assert.equal(project.packSnapshot.id, 'builtin-academic-publishing');
  assert.equal(app.state.academicResponseProjects.length, 0);
  await app.coordinator.setSaveEnabled(project.id, true);
  assert.equal(app.state.academicResponseProjects.length, 1);
  assert.equal(app.state.academicResponseProjects[0].saveEnabled, true);
});

test('从文献库建立论断来源快照，登记题录对照不会更改人工状态', async () => {
  const app = harness({ knowledgeEntries: [{
    id: 'lit-1', type: 'academic-literature', title: '原题名',
    literature: { authors: ['甲'], year: '2023', publication: '期刊', doi: '10.1000/test', metadataStatus: 'unverified', readingStatus: 'excerpt-only' }
  }] });
  const project = await app.coordinator.createProject({ title: '引文证据' });
  const claim = await app.coordinator.addCitationClaim(project.id, {
    id: 'claim-1', statement: '待核验论断', manuscriptLocation: '第 1 页'
  }, ['lit-1']);
  const source = claim.citationClaims[0].sources[0];
  assert.equal(source.knowledgeEntryId, 'lit-1');
  assert.equal(source.snapshot.title, '原题名');
  assert.equal(source.readingStatus, 'excerpt-only');
  const diff = app.coordinator.compareBibliography(project.id, 'claim-1', source.id, { title: '登记题名', doi: '10.1000/test' });
  assert.deepEqual(diff.map(item => item.field), ['title']);
  assert.equal(app.coordinator.getProject(project.id).citationClaims[0].sources[0].metadataStatus, 'unverified');
  assert.equal(app.coordinator.getProject(project.id).citationClaims[0].sources[0].relation, 'unassessed');
});

test('三种任务生成独立提示词轮次，带回模拟结果不会改变用户状态', async () => {
  const app = harness();
  const project = await app.coordinator.createProject({ title: '结果核验' });
  const withClaim = await app.coordinator.addCitationClaim(project.id, {
    id: 'claim-1', statement: '需要核验的论断', manuscriptLocation: '第 1 页'
  }, []);
  assert.equal(withClaim.citationClaims.length, 1);
  const round = await app.coordinator.generatePrompt(project.id, 'citation-check', ['claim-1']);
  assert.match(round.prompt, /需要核验的论断/);
  const copied = await app.coordinator.markPromptCopied(project.id, round.id, round.prompt);
  assert.equal(copied.status, 'copied');
  const returned = await app.coordinator.storeExternalResult(project.id, round.id, '模型建议支持', 'simulation');
  assert.equal(returned.resultStatus, 'pending-user-review');
  assert.equal(app.coordinator.getProject(project.id).citationClaims[0].sources.length, 0);

  const reviewRound = await app.coordinator.addReviewerRound(project.id, { id: 'round-1', title: '第一轮' });
  const withComment = await app.coordinator.addReviewerComment(project.id, reviewRound.reviewerRounds[0].id, {
    id: 'comment-1', rawComment: '请说明分析方法。'
  });
  assert.equal(withComment.reviewerRounds[0].comments[0].id, 'comment-1');
  const round2 = await app.coordinator.generatePrompt(project.id, 'reviewer-response', ['comment-1']);
  assert.match(round2.prompt, /保密/);
});

test('暂停保存冻结上次快照，写入失败不改变当前项目', async () => {
  const app = harness();
  const project = await app.coordinator.createProject({ title: '初始标题' });
  await app.coordinator.setSaveEnabled(project.id, true);
  await app.coordinator.updateProject(project.id, { title: '已保存标题' });
  const writesBeforePause = app.writes;
  await app.coordinator.setSaveEnabled(project.id, false);
  await app.coordinator.updateProject(project.id, { title: '仅会话标题' });
  assert.equal(app.writes, writesBeforePause + 1);
  assert.equal(app.state.academicResponseProjects[0].title, '已保存标题');
  assert.equal(app.coordinator.getProject(project.id).title, '仅会话标题');

  await app.coordinator.setSaveEnabled(project.id, true);
  app.failWrite = true;
  await assert.rejects(app.coordinator.updateProject(project.id, { title: '写入失败' }), /磁盘已满/);
  assert.equal(app.coordinator.getProject(project.id).title, '仅会话标题');
});

test('删除核验项目不会删除知识库文献记录', async () => {
  const entry = { id: 'lit-1', type: 'academic-literature', title: '保留文献', literature: {} };
  const app = harness({ knowledgeEntries: [entry] });
  const project = await app.coordinator.createProject({ title: '临时项目' });
  await app.coordinator.setSaveEnabled(project.id, true);
  await app.coordinator.deleteProject(project.id);
  assert.deepEqual(app.state.academicResponseProjects, []);
  assert.deepEqual(app.state.knowledgeEntries, [entry]);
  assert.equal(app.coordinator.getProject(project.id), null);
});
