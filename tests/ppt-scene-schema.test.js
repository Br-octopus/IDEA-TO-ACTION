const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PPT_ROUTES,
  createPptBrief,
  normalizePptDraft,
  normalizePptScene
} = require('../prototype/ppt-scene-schema.js');

test('brief 保留目标、材料用途、受众和约束，并提供稳定默认值', () => {
  const brief = createPptBrief({
    idea: '向团队说明新客服流程',
    audience: '一线客服',
    durationMinutes: 10,
    constraints: { minSlides: 6, maxSlides: 10, maxWordsPerSlide: 35 },
    materials: [{ id: 'f1', role: 'both', kind: 'pptx' }]
  });

  assert.equal(brief.idea, '向团队说明新客服流程');
  assert.equal(brief.audience, '一线客服');
  assert.equal(brief.durationMinutes, 10);
  assert.equal(brief.constraints.minSlides, 6);
  assert.equal(brief.materials[0].role, 'both');
  assert.equal(brief.constraints.maxSlides, 10);
  assert.equal(brief.constraints.maxWordsPerSlide, 35);
  assert.equal(brief.route, 'undecided');
});

test('brief 固定硬性要求、偏好、保留/排除项、事实/假设和听众行动', () => {
  const brief = createPptBrief({
    hardRequirements: ['必须解释升级条件'],
    preferences: ['少用术语'],
    preserveItems: ['原值班流程'],
    excludeItems: ['客户隐私'],
    facts: ['新流程下周启用'],
    assumptions: ['听众熟悉旧流程'],
    audienceAction: '按新流程完成分流'
  });

  assert.deepEqual(brief.hardRequirements, ['必须解释升级条件']);
  assert.deepEqual(brief.preferences, ['少用术语']);
  assert.deepEqual(brief.preserveItems, ['原值班流程']);
  assert.deepEqual(brief.excludeItems, ['客户隐私']);
  assert.deepEqual(brief.facts, ['新流程下周启用']);
  assert.deepEqual(brief.assumptions, ['听众熟悉旧流程']);
  assert.equal(brief.audienceAction, '按新流程完成分流');
});

test('brief 校验页数边界、时长、材料用途、来源 ID 和路线枚举', () => {
  assert.throws(() => createPptBrief({ constraints: { minSlides: 12, maxSlides: 4 } }), /页数/);
  assert.throws(() => createPptBrief({ durationMinutes: -1 }), /时长/);
  assert.throws(() => createPptBrief({ durationMinutes: true }), /时长/);
  assert.throws(() => createPptBrief({ durationMinutes: 9007199254740992 }), /时长/);
  assert.throws(() => createPptBrief({ constraints: { minSlides: true } }), /minSlides/);
  assert.throws(() => createPptBrief({ constraints: { maxSlides: 9007199254740992 } }), /maxSlides/);
  assert.throws(() => createPptBrief({ materials: [{ id: 'f1', role: 'notes' }] }), /材料用途/);
  assert.throws(() => createPptBrief({ sourceIds: ['s1', ''] }), /来源/);
  assert.throws(() => createPptBrief({ route: 'magic' }), /路线/);
  assert.deepEqual(PPT_ROUTES, ['undecided', 'native-ppt', 'image-rebuild', 'html-final', 'html-to-ppt']);
});

test('草稿规范化输出稳定字段并拒绝无效页码和敏感字段', () => {
  const draft = normalizePptDraft({
    title: '客服分流',
    slides: [{ id: 'slide-1', title: '先判断紧急程度', body: ['立即处理'], sourceIds: ['s1'] }],
    apiKey: 'do-not-keep',
    originalAttachmentBody: 'private attachment text'
  });

  assert.equal(draft.title, '客服分流');
  assert.equal(draft.slides[0].sourceIds[0], 's1');
  assert.equal(JSON.stringify(draft).includes('do-not-keep'), false);
  assert.equal(JSON.stringify(draft).includes('private attachment text'), false);
  assert.throws(() => normalizePptDraft({ slides: [{ page: -1 }] }), /页码/);
  assert.throws(() => normalizePptDraft({ slides: [{ page: true }] }), /页码/);
  assert.throws(() => normalizePptDraft({ slides: [{ page: 9007199254740992 }] }), /页码/);
});

test('场景白名单持久化阶段、大纲核对、路线、来源摘要和逐页处理原因', () => {
  const scene = normalizePptScene({
    brief: { idea: '客服流程', route: 'html-final' },
    status: 'needs-review', stage: 'outline-review', outlineStatus: 'approved',
    route: { selected: 'html-final', recommended: 'native-ppt' },
    sources: [{ id: 'source-1', title: '流程手册', url: 'https://example.test/guide', summary: '分流说明', content: '附件原文不得保存', apiKey: 'secret' }],
    outline: { title: '流程故事', storyLine: '识别后再分流', rationale: '按 5 分钟说明规划', reviewSummary: '覆盖主要路径', reviewIssues: ['补充升级依据'], slides: [{ id: 'o1', page: 1, title: '识别问题', claim: '先核实紧急程度', sourceIds: ['source-1'], evidenceStatus: 'cited' }] },
    draft: { title: '客服分流', slides: [{ id: 's1', page: 1, title: '已替代页面', disposition: 'deleted', deleteReason: '新流程不再使用此步骤', body: ['旧步骤'], originalAttachmentBody: '不得保存' }] },
    credentials: { token: 'private' }, originalAttachmentBody: '私有附件原文'
  });

  assert.equal(scene.stage, 'outline-review');
  assert.equal(scene.outlineStatus, 'approved');
  assert.equal(scene.route.selected, 'html-final');
  assert.equal(scene.sources[0].summary, '分流说明');
  assert.equal(scene.outline.slides[0].evidenceStatus, 'cited');
  assert.equal(scene.draft.slides[0].disposition, 'deleted');
  assert.equal(scene.draft.slides[0].deleteReason, '新流程不再使用此步骤');
  const serialized = JSON.stringify(scene);
  for (const secret of ['附件原文不得保存', 'secret', '私有附件原文', '不得保存', 'private']) assert.equal(serialized.includes(secret), false);
  assert.throws(() => normalizePptScene({ stage: 'unknown-stage' }), /阶段/);
  assert.throws(() => normalizePptScene({ route: { selected: 'unknown-route' } }), /路线/);
});

test('列表只规范化上限范围内的条目，超出部分的无效值不影响结果', () => {
  const hardRequirements = Array.from({ length: 30 }, (_, index) => `要求${index}`);
  hardRequirements.push({ invalid: true });
  const sourceIds = Array.from({ length: 50 }, (_, index) => `source-${index}`);
  sourceIds.push({ invalid: true });

  const brief = createPptBrief({ hardRequirements, sourceIds });

  assert.equal(brief.hardRequirements.length, 30);
  assert.equal(brief.hardRequirements[29], '要求29');
  assert.equal(brief.sourceIds.length, 50);
  assert.equal(brief.sourceIds[49], 'source-49');
});
