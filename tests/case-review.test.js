const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  buildCaseReviewPrompt
} = require('../prototype/prompt-engine.js');
const {
  createEmptyState,
  confirmCase,
  updateCase,
  upsertKnowledgeEntry
} = require('../prototype/storage.js');
const { collectKnowledgeEntries } = require('../prototype/knowledge-search.js');

const project = {
  id: 'project-writing',
  idea: '保留观点和事实，减少模板化句式',
  goalSummary: '保留观点和事实，减少模板化句式',
  domain: '写作',
  successCriteria: ['观点和事实没有被改偏', '句式更自然'],
  preserveItems: ['观点', '事实', '句式']
};

test('复盘提示词明确要求前后对照、具体证据、结论和下一条提示词', () => {
  const text = buildCaseReviewPrompt({
    ...project,
    before: '原文',
    after: '改写后',
    externalResult: '外部 AI 返回的改写结果',
    userFeedback: '观点被改掉了'
  });

  for (const phrase of ['前后对照', '具体证据', '成功/失败/待验证', '下一条提示词']) {
    assert.match(text, new RegExp(phrase));
  }
  for (const value of ['原文', '改写后', '外部 AI 返回的改写结果', '观点被改掉了']) {
    assert.ok(text.includes(value), `复盘提示词应包含 ${value}`);
  }
});

test('未确认案例不进入 cases，明确确认后进入且字段完整', () => {
  const reviewedCase = {
    id: 'case-writing-1',
    projectId: project.id,
    domain: project.domain,
    taskType: '文章改写',
    goal: project.goalSummary,
    preserveItems: project.preserveItems,
    before: '原文',
    after: '改写后',
    externalResult: '外部 AI 返回的改写结果',
    userFeedback: '观点被改掉了',
    dimensions: ['观点', '事实', '句式'],
    evidence: ['第二段的观点被替换'],
    suggestedLabel: '失败：改偏原意',
    status: '失败',
    lessons: '先锁定观点，再调整句式',
    nextPrompt: '保留原文观点，只调整句式',
    createdAt: '2026-10-17T00:00:00.000Z'
  };

  const pending = confirmCase(createEmptyState(), reviewedCase, false);
  assert.deepEqual(pending.cases, []);

  const confirmed = confirmCase(pending, reviewedCase, true);
  assert.equal(confirmed.cases.length, 1);
  assert.equal(confirmed.cases[0].confirmed, true);
  for (const field of [
    'id', 'projectId', 'domain', 'taskType', 'goal', 'preserveItems', 'before', 'after',
    'externalResult', 'userFeedback', 'dimensions', 'evidence', 'suggestedLabel', 'status',
    'lessons', 'nextPrompt', 'createdAt'
  ]) {
    assert.ok(Object.hasOwn(confirmed.cases[0], field), `案例应包含 ${field}`);
  }
});

test('案例确认会为不完整输入补齐统一字段，页面提供完整确认动作', () => {
  const confirmed = confirmCase(createEmptyState(), { id: 'sparse-case' }, true);
  for (const field of [
    'id', 'projectId', 'domain', 'taskType', 'goal', 'preserveItems', 'before', 'after',
    'externalResult', 'userFeedback', 'dimensions', 'evidence', 'suggestedLabel', 'status',
    'lessons', 'nextPrompt', 'createdAt'
  ]) {
    assert.ok(Object.hasOwn(confirmed.cases[0], field), `不完整案例也应包含 ${field}`);
  }

  const html = fs.readFileSync(require.resolve('../prototype/index.html'), 'utf8');
  for (const phrase of ['确认记录', '修改判断', '暂不记录', '目标', '保留项', '外部结果', '用户意见', '证据', '建议标签', '下一条指令']) {
    assert.match(html, new RegExp(phrase));
  }
  assert.match(html, /原稿和外部结果可能会离开本机/);
});

test('修改判断更新已有案例结论但不产生重复 id', () => {
  const first = confirmCase(createEmptyState(), {
    id: 'case-1',
    goal: '目标',
    status: '待验证',
    suggestedLabel: '待验证',
    nextPrompt: '先补证据'
  }, true);
  const updated = updateCase(first, {
    id: 'case-1',
    status: '失败',
    suggestedLabel: '失败：保留项丢失',
    evidence: ['第二个步骤被删除'],
    nextPrompt: '保留第二个步骤，只修改表达'
  });
  const repeated = confirmCase(updated, {
    id: 'case-1',
    status: '失败'
  }, true);

  assert.equal(updated.cases.length, 1);
  assert.equal(updated.cases[0].status, '失败');
  assert.equal(updated.cases[0].suggestedLabel, '失败：保留项丢失');
  assert.deepEqual(updated.cases[0].evidence, ['第二个步骤被删除']);
  assert.equal(repeated.cases.length, 1);
});

test('只有用户确认的成功或失败案例进入可复用案例检索', () => {
  const entries = collectKnowledgeEntries({
    prompts: [],
    cases: [
      { id: 'success', confirmed: true, status: '成功', lessons: '先定义验收标准' },
      { id: 'pending', confirmed: true, status: '待验证', lessons: '证据不足' },
      { id: 'draft', confirmed: false, status: '失败', lessons: '未确认' }
    ]
  });
  assert.equal(entries.some(item => item.id === 'case-success' && item.type === 'success-case'), true);
  assert.equal(entries.some(item => item.id === 'case-pending' && item.type === 'review-insight'), true);
  assert.equal(entries.some(item => item.id === 'case-draft'), false);
});

test('案例资料卡按 linkedCaseId 更新并经统一 schema 规范化', () => {
  const first = upsertKnowledgeEntry(createEmptyState(), {
    id: 'case-insight-case-1',
    type: 'success-case',
    title: '文章改写复盘经验',
    domains: ['写作'],
    summary: '保留目标并改善表达',
    reusablePatterns: '先定义验收标准',
    limitations: '仅适用于该案例',
    linkedCaseId: 'case-1',
    verificationStatus: 'user-confirmed',
    sourceType: '用户确认案例'
  });
  const second = upsertKnowledgeEntry(first.state, {
    id: 'case-insight-case-1',
    type: 'success-case',
    title: '文章改写复盘经验（更新）',
    domains: ['写作'],
    summary: '更新后的摘要',
    reusablePatterns: '先定义验收标准，再用证据复核',
    limitations: '仍需相似任务验证',
    linkedCaseId: 'case-1',
    verificationStatus: 'user-confirmed',
    sourceType: '用户确认案例'
  });

  assert.equal(first.updated, false);
  assert.equal(second.updated, true);
  assert.equal(second.state.knowledgeEntries.length, 1);
  assert.equal(second.entry.title, '文章改写复盘经验（更新）');
  assert.equal(second.entry.linkedCaseId, 'case-1');
  assert.equal(second.entry.before, undefined);
  assert.equal(second.entry.externalResult, undefined);
});

test('案例库界面提供案例组合筛选、摘要字段和安全的资料卡操作', () => {
  const html = fs.readFileSync(require.resolve('../prototype/index.html'), 'utf8');
  const app = fs.readFileSync(require.resolve('../prototype/app.js'), 'utf8');

  assert.match(html, /<option value="">全部资料<\/option><option value="case">全部案例<\/option>/);
  for (const phrase of ['全部案例', '成功案例', '失败案例', '待验证复盘', '当前领域', '当前项目']) {
    assert.match(html, new RegExp(phrase));
  }
  for (const phrase of ['目标', '复盘维度', '证据摘要', '用户意见', '经验教训', '下一条提示词摘要', '确认时间']) {
    assert.match(app, new RegExp(phrase));
  }
  assert.match(app, /caseItem\.confirmed === true/);
  assert.match(app, /case-insight-\$\{caseItem\.id\}/);
  assert.match(app, /upsertKnowledgeEntry/);
  assert.match(app, /if \(!persist\(\)\) return/);
  const caseFilter = app.match(/function filterCaseEntries\(entries, filters\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(caseFilter, /filters\.caseType === "case"/);
  assert.match(caseFilter, /if \(!caseItem\) return false/);
  assert.doesNotMatch(app, /before[\s\S]{0,160}externalResult[\s\S]{0,160}buildKnowledgeContext/);
});

test('软件方案过度复杂案例可生成复盘并确认保存', () => {
  const softwareProject = {
    id: 'project-software-complexity',
    idea: '先做一个自己能用的本地记账工具',
    goalSummary: '先做一个自己能用的本地记账工具',
    domain: '软件开发',
    successCriteria: ['能记录和查询收支', '先保持本地可用，不扩大范围'],
    preserveItems: ['本地优先', '只做核心记账功能', '不自动执行现实任务']
  };
  const reviewedCase = {
    id: 'case-software-overengineering',
    projectId: softwareProject.id,
    domain: softwareProject.domain,
    taskType: '软件方案设计',
    goal: softwareProject.goalSummary,
    preserveItems: softwareProject.preserveItems,
    before: '本地单机记账：新增、查询、导出三项核心功能。',
    after: '改成多 Agent、云同步、权限系统和向量数据库的完整平台方案。',
    externalResult: '外部方案增加了多服务部署、账号体系和复杂监控，尚未实现核心记账闭环。',
    userFeedback: '方案看起来先进，但已经超出个人本地 MVP 范围。',
    dimensions: ['目标范围', '保留项', '实现复杂度', '核心功能闭环'],
    evidence: [
      '原目标只有本地新增、查询、导出三项功能',
      '结果新增多 Agent、云同步、权限系统和向量数据库',
      '结果没有证明核心记账闭环已经可用'
    ],
    suggestedLabel: '失败：软件方案过度复杂',
    status: '失败',
    lessons: '个人本地 MVP 先完成核心闭环，再评估是否需要平台化能力。',
    nextPrompt: '只保留本地新增、查询、导出三项功能；逐项说明实现成本和验收方式，不引入多 Agent、云同步或向量数据库。',
    createdAt: '2026-10-17T00:00:00.000Z'
  };

  const prompt = buildCaseReviewPrompt(softwareProject, reviewedCase);
  for (const value of [softwareProject.goalSummary, ...softwareProject.preserveItems, reviewedCase.before, reviewedCase.after, reviewedCase.externalResult]) {
    assert.ok(prompt.includes(value), `复盘提示词应包含 ${value}`);
  }
  for (const phrase of ['具体证据', '建议标签', '成功/失败/待验证', '下一条提示词']) {
    assert.match(prompt, new RegExp(phrase));
  }

  const confirmed = confirmCase(createEmptyState(), reviewedCase, true);
  assert.equal(confirmed.cases.length, 1);
  assert.equal(confirmed.cases[0].suggestedLabel, reviewedCase.suggestedLabel);
  assert.equal(confirmed.cases[0].status, reviewedCase.status);
  assert.deepEqual(confirmed.cases[0].evidence, reviewedCase.evidence);
  assert.equal(confirmed.cases[0].nextPrompt, reviewedCase.nextPrompt);
});

test('项目和文章复盘重新开始时会清理旧判断与结果，但项目未生成输入只在切换项目时清理', () => {
  const app = fs.readFileSync(require.resolve('../prototype/app.js'), 'utf8');

  assert.match(app, /function resetProjectReviewFields\(\{ clearInputs = false \} = \{\}\)/);
  assert.match(app, /resetProjectReviewFields\(\);\s+currentProjectReviewCase = projectReviewDraft\(\)/);
  assert.match(app, /resetProjectReviewFields\(\);\s+toast\("本次复盘暂不记录"\)/);
  for (const field of ['project-review-evidence', 'project-review-label', 'project-review-status', 'project-review-lessons', 'project-review-next-prompt', 'project-review-prompt', 'project-review-result']) {
    assert.match(app, new RegExp(`document\\.getElementById\\("${field}"\\)`), `项目复盘应清理 ${field}`);
  }
  assert.match(app, /if \(clearInputs\) \{[\s\S]*project-review-before/);
  assert.match(app, /if \(clearInputs\) \{[\s\S]*project-review-external-result/);

  assert.match(app, /function resetArticleReviewResult\(\{ clearFeedback = false \} = \{\}\)/);
  assert.match(app, /resetArticleReviewResult\(\{ clearFeedback: true \}\);/);
  const skipArticleReview = app.match(/document\.getElementById\("skip-article-review"\)\.addEventListener\("click", \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(skipArticleReview, '文章暂不记录事件应存在');
  assert.match(skipArticleReview[1], /resetArticleReviewResult\(\{ clearFeedback: true \}\);/);
  for (const field of ['article-review-result', 'article-review-prompt', 'article-review-evidence', 'article-review-label', 'article-review-status', 'article-review-lessons', 'article-review-next-prompt', 'article-revised']) {
    assert.match(app, new RegExp(`document\\.getElementById\\("${field}"\\)`), `文章复盘应清理 ${field}`);
  }
  assert.match(app, /const prompt = document\.getElementById\("article-review-prompt"\)\.textContent;[\s\S]*if \(prompt\) copyText\(prompt\)/);
});
