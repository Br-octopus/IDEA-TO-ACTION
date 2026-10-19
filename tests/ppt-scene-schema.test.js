const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PPT_ROUTES,
  createPptBrief,
  normalizePptDraft
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
});
