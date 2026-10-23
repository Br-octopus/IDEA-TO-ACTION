const test = require('node:test');
const assert = require('node:assert/strict');
const publishing = require('../prototype/academic-publishing.js');

function project() {
  return publishing.createProject({ id: 'pub-1', title: '论文核引与投稿', target: { venue: '目标期刊' } });
}

test('学术投稿项目只保留白名单字段并补齐三种任务的数据集合', () => {
  const normalized = publishing.normalizeProject({
    id: 'pub-1', title: '待核验论文', taskType: 'citation-check', saveEnabled: true,
    packSnapshot: { id: 'builtin-academic-publishing', version: 1, sourceIds: ['crossref-rest-api'] },
    citationClaims: [{ id: 'claim-1', statement: '用户论断', sources: [] }],
    reviewerRounds: [{ id: 'round-1', title: '第一轮', comments: [] }],
    requirements: [{ id: 'req-1', title: '作者指南', body: '用户提供的要求' }],
    checklist: [{ id: 'check-1', title: '匿名稿', status: 'todo' }],
    history: [], credential: 'api_key=secret-value'
  });
  assert.equal(normalized.id, 'pub-1');
  assert.equal(normalized.taskType, 'citation-check');
  assert.equal(normalized.citationClaims[0].statement, '用户论断');
  assert.equal(normalized.reviewerRounds[0].title, '第一轮');
  assert.equal(normalized.requirements[0].title, '作者指南');
  assert.equal(normalized.checklist[0].status, 'todo');
  assert.equal(normalized.packSnapshot.id, 'builtin-academic-publishing');
  assert.deepEqual(normalized.packSnapshot.sourceIds, ['crossref-rest-api']);
  assert.equal(Object.hasOwn(normalized, 'credential'), false);
});

test('要求来源支持记录用户核对状态与原文位置，并拒绝不存在的来源', () => {
  const base = publishing.createProject({ id: 'p-requirement-review', title: '投稿要求核对' });
  const withRequirement = publishing.addRequirementCard(base, {
    id: 'req-1', title: '匿名投稿', sourceUrl: 'https://journal.example/guide'
  });
  const reviewed = publishing.updateRequirementCard(withRequirement, 'req-1', {
    verificationStatus: 'user-confirmed', sourceLocator: '作者指南 > 投稿文件'
  });
  assert.equal(reviewed.requirements[0].verificationStatus, 'user-confirmed');
  assert.equal(reviewed.requirements[0].sourceLocator, '作者指南 > 投稿文件');
  assert.throws(() => publishing.updateRequirementCard(reviewed, 'missing', { verificationStatus: 'source-reviewed' }), { code: 'REQUIREMENT_NOT_FOUND' });
});

test('引用关系必须有依据位置，题录登记状态与论断支持状态分开保存', () => {
  const base = project();
  const withClaim = publishing.addCitationClaim(base, {
    id: 'claim-1', statement: '某干预改善主要结局', manuscriptLocation: '第 2 页第 3 段',
    sources: [
      { knowledgeEntryId: 'lit-1', snapshot: { title: '支持性研究', doi: '10.1000/test' }, relation: 'supports', metadataStatus: 'registry-returned', readingStatus: 'excerpt-only', evidenceExcerpt: '摘录结果', evidenceLocation: '表 2' },
      { knowledgeEntryId: 'lit-2', snapshot: { title: '相反结果' }, relation: 'contradicts', evidenceExcerpt: '结果不显著', evidenceLocation: '摘要结果段' }
    ]
  });
  assert.equal(withClaim.citationClaims[0].sources.length, 2);
  assert.equal(withClaim.citationClaims[0].sources[0].metadataStatus, 'registry-returned');
  assert.equal(withClaim.citationClaims[0].sources[0].relation, 'supports');
  assert.equal(publishing.getCitationCoverage(withClaim).unassessed, 0);
  assert.equal(publishing.getCitationCoverage(withClaim).conflicts, 1);
  assert.throws(() => publishing.addCitationClaim(base, {
    id: 'claim-bad', statement: '缺少依据的论断', sources: [{ knowledgeEntryId: 'lit-1', relation: 'supports' }]
  }), /依据|位置/);
});

test('审稿意见只有记录实际修改或不修改理由后才能标为已处理', () => {
  const withRound = publishing.addReviewerRound(project(), { id: 'round-1', title: '第一轮审稿' });
  const withComment = publishing.addReviewerComment(withRound, 'round-1', {
    id: 'comment-1', reviewer: '审稿人 1', rawComment: '请补充分析并说明局限。'
  });
  assert.throws(() => publishing.resolveReviewerComment(withComment, 'round-1', 'comment-1', { status: 'revised' }), /位置|改动/);
  const revised = publishing.resolveReviewerComment(withComment, 'round-1', 'comment-1', {
    status: 'revised', changeLocation: '第 5 页第 2 段', changeSummary: '补充了分层分析说明', afterExcerpt: '修订后的局限说明'
  });
  assert.equal(revised.reviewerRounds[0].comments[0].status, 'revised');
  assert.equal(publishing.getReviewerCoverage(revised).completed, 1);
  assert.throws(() => publishing.resolveReviewerComment(withComment, 'round-1', 'comment-1', { status: 'no-change' }), /理由/);
  const noChange = publishing.resolveReviewerComment(withComment, 'round-1', 'comment-1', { status: 'no-change', noChangeReason: '现有分析已经覆盖该问题，并在第 5 页说明。' });
  assert.equal(noChange.reviewerRounds[0].comments[0].status, 'no-change');
});

test('投稿清单未知状态会降级为待办且完成状态不代表自动合规', () => {
  const normalized = publishing.normalizeProject({
    ...project(), checklist: [
      { id: 'check-1', title: '匿名稿', requirementId: 'req-1', status: 'compliant' },
      { id: 'check-2', title: '伦理声明', requirementId: 'req-2', status: 'complete', evidence: '用户核对了文件' }
    ]
  });
  assert.equal(normalized.checklist[0].status, 'todo');
  assert.equal(publishing.getChecklistCoverage(normalized).complete, 1);
  assert.equal(publishing.getChecklistCoverage(normalized).certified, false);
});

test('三类提示词仅含明确选择项，外部结果只进入待复核历史', () => {
  let current = publishing.addCitationClaim(project(), {
    id: 'claim-1', statement: '选中的论断', manuscriptLocation: '第 1 页',
    sources: [{ knowledgeEntryId: 'lit-1', snapshot: { title: '选中的研究' }, relation: 'supports', evidenceExcerpt: '证据', evidenceLocation: '第 3 页' }]
  });
  current = publishing.addCitationClaim(current, {
    id: 'claim-2', statement: '未选中的论断', manuscriptLocation: '第 4 页',
    sources: [{ knowledgeEntryId: 'lit-2', snapshot: { title: '未选的研究' }, relation: 'unassessed' }]
  });
  const prompt = publishing.buildCitationCheckPrompt(current, ['claim-1']);
  assert.match(prompt, /选中的论断/);
  assert.doesNotMatch(prompt, /未选中的论断|未选的研究/);
  const history = publishing.addPromptRound(current, { id: 'history-1', taskType: 'citation-check', prompt, selectedIds: ['claim-1'] });
  const result = publishing.attachExternalResult(history, 'history-1', '建议标为支持。', 'simulation');
  assert.equal(result.history[0].resultStatus, 'pending-user-review');
  assert.equal(result.history[0].status, 'returned');
  assert.equal(result.citationClaims.find(item => item.id === 'claim-1').sources[0].relation, 'supports');
  assert.equal(result.history[0].resultSource, 'simulation');
});

test('题录对照只返回差异，不会提升核验或论断关系状态', () => {
  const diff = publishing.compareBibliography(
    { title: '原题名', authors: ['甲'], year: '2023', doi: '10.1000/test' },
    { title: '登记题名', authors: ['乙'], year: '2024', doi: '10.1000/test', metadataStatus: 'registry-returned' }
  );
  assert.deepEqual(diff.map(item => item.field), ['title', 'authors', 'year']);
  assert.equal(diff.some(item => item.field === 'doi'), false);
  const unchanged = publishing.normalizeProject(project());
  assert.equal(unchanged.citationClaims.length, 0);
});
