const test = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateSlideCount,
  validatePptConstraints,
  recommendPptRoute,
  checkSlideDraft
} = require('../prototype/ppt-scene-workflow.js');

test('短时长与 30 页硬性要求冲突，并说明冲突依据', () => {
  const brief = {
    durationMinutes: 10,
    constraints: { maxSlides: 30 }
  };
  const result = validatePptConstraints(brief, {
    slides: Array.from({ length: 30 }, (_, index) => ({ page: index + 1 }))
  });

  assert.ok(result.hardConflicts.some(item => /时长|分钟|页/.test(item.message)));
  assert.ok(result.hardConflicts.some(item => item.basis));
});

test('报告总字数、页数容量和单页超限的计算依据', () => {
  const brief = { constraints: { maxSlides: 2, maxWordsPerSlide: 5 } };
  const draft = {
    slides: [
      { title: '第一结论', purpose: '提出问题', body: ['一 二 三 四 五 六'] },
      { title: '第二结论', purpose: '给出方案', body: ['甲 乙'] }
    ]
  };
  const result = validatePptConstraints(brief, draft);

  assert.equal(result.wordCount, 16);
  assert.equal(result.wordCapacity, 10);
  assert.equal(result.wordCountBasis.slideCount, 2);
  assert.equal(result.wordCountBasis.maxWordsPerSlide, 5);
  assert.ok(result.hardConflicts.some(item => item.page === 1 && item.actualWords === 10));
  assert.ok(result.hardConflicts.some(item => item.type === 'total-word-capacity' && item.actualWords === 16));
  assert.ok(result.hardConflicts.every(item => item.basis));
  assert.match(result.wordCountBasis.countingRule, /中文每个汉字计 1 词/);
});

test('未提供时长时给页数建议并明确假设', () => {
  const result = estimateSlideCount({ contentUnits: 8, density: 'medium' });

  assert.ok(result.range.min <= result.range.max);
  assert.ok(result.assumptions.length > 0);
  assert.ok(result.assumptions.some(item => /时长|假设|未知/.test(item)));
  assert.equal(result.precise, false);
});

test('页数估算同时考虑时长、内容量、密度和用户范围', () => {
  const result = estimateSlideCount({
    durationMinutes: 10,
    contentUnits: 12,
    density: 'low',
    userRange: { min: 8, max: 14 }
  });

  assert.ok(result.range.min >= 8);
  assert.ok(result.range.max <= 14);
  assert.ok(result.assumptions.some(item => /内容|单元/.test(item)));
  assert.ok(result.assumptions.some(item => /密度/.test(item)));
});

test('内容量与时长范围不相交时明确报告冲突，不伪造单点交集', () => {
  const result = estimateSlideCount({ durationMinutes: 5, contentUnits: 30, density: 'medium' });

  assert.ok(result.conflicts.some(item => item.type === 'duration-content'));
  assert.ok(result.range.min <= result.range.max);
  assert.notEqual(result.range.min, result.range.max);
});

test('密度会改变估算，估算不采用统一固定页数比率', () => {
  const low = estimateSlideCount({ durationMinutes: 10, contentUnits: 12, density: 'low' });
  const high = estimateSlideCount({ durationMinutes: 10, contentUnits: 12, density: 'high' });

  assert.notDeepEqual(low.range, high.range);
  assert.ok(low.assumptions.some(item => /不.*固定|规划假设/.test(item)));
});

test('估算拒绝布尔时长、非整数页数范围和相反的页数边界', () => {
  assert.throws(() => estimateSlideCount({ durationMinutes: true }), /时长/);
  assert.throws(() => estimateSlideCount({ userRange: { min: 1.5, max: 4 } }), /正安全整数/);
  assert.throws(() => estimateSlideCount({ userRange: { min: 8, max: 4 } }), /下限不能大于上限/);
});

test('四条路线均比较可编辑性、视觉精度、修改成本和转换限制', () => {
  const result = recommendPptRoute({ route: 'undecided' });
  const titles = result.options.map(option => option.title);

  assert.equal(new Set(titles).size, 4, '四条路线标题应各不相同');

  for (const route of ['native-ppt', 'image-rebuild', 'html-final', 'html-to-ppt']) {
    const option = result.options.find(item => item.id === route);
    assert.ok(option, `缺少路线 ${route}`);
    assert.ok(option.title?.trim(), `${route} 缺少可读标题`);
    for (const field of ['editability', 'visualFidelity', 'modificationCost', 'conversionLimitations']) {
      assert.ok(option[field], `${route} 缺少 ${field}`);
    }
    assert.ok(option.reasons.length > 0);
  }
});

test('路线偏好同时提到 HTML 与 PPT 转换时推荐转换路线', () => {
  const result = recommendPptRoute({ preferences: ['需要 HTML 转换为 PPT'] });
  assert.equal(result.recommendedRoute, 'html-to-ppt');
});

test('模型草稿中的自报约束不能覆盖简报硬约束', () => {
  const brief = { constraints: { maxSlides: 5 } };
  const draft = {
    constraints: { maxSlides: 50 },
    slides: Array.from({ length: 6 }, (_, index) => ({ page: index + 1 }))
  };

  const result = validatePptConstraints(brief, draft);
  assert.ok(result.hardConflicts.some(item => /页数|上限/.test(item.message)));
  assert.equal(result.effectiveConstraints.maxSlides, 5);
});

test('硬约束校验沿用 schema 严格数值规则，无法判断的自由文本偏好单独待审', () => {
  assert.throws(() => validatePptConstraints({ constraints: { maxSlides: true } }, { slides: [] }), /正安全整数/);

  const result = validatePptConstraints({
    preferences: ['尽量少用术语'],
    constraints: { minSlides: 2, maxSlides: 3 }
  }, { slides: [{ page: 1 }] });
  assert.ok(result.hardConflicts.some(item => item.type === 'min-slides'));
  assert.deepEqual(result.preferenceDeviations, []);
  assert.equal(result.preferenceReview[0].preference, '尽量少用术语');
  assert.equal(result.preferenceReview[0].status, 'needs-review');
});

test('明确数值偏好计算偏离并与硬约束分开', () => {
  const result = validatePptConstraints({
    preferences: ['最多 1 页', '每页不超过 3 词', '尽量少用术语'],
    constraints: { maxSlides: 3 }
  }, {
    slides: [
      { page: 1, title: '一二', body: ['三四'] },
      { page: 2, title: '五六', body: ['七八'] }
    ]
  });

  assert.deepEqual(result.hardConflicts, []);
  assert.equal(result.preferenceDeviations.length, 2);
  assert.deepEqual(result.preferenceDeviations.map(item => item.type), ['max-slides', 'max-words-per-slide']);
  assert.ok(result.preferenceDeviations.every(item => item.status === 'deviation' && item.basis));
  assert.equal(result.preferenceChecks.length, 2);
  assert.equal(result.preferenceReview[0].status, 'needs-review');
});

test('满足的明确数值偏好记录为 met，不列为偏离或待审', () => {
  const result = validatePptConstraints({ preferences: ['最多 2 页'] }, { slides: [{ page: 1 }] });

  assert.equal(result.preferenceChecks[0].status, 'met');
  assert.deepEqual(result.preferenceDeviations, []);
  assert.deepEqual(result.preferenceReview, []);
});

test('逐页检查职责、结论、精简文案、证据、视觉方向、衔接和总量', () => {
  const brief = {
    durationMinutes: 8,
    sourceIds: ['source-1'],
    constraints: { minSlides: 2, maxSlides: 3, maxWordsPerSlide: 20 }
  };
  const result = checkSlideDraft({
    title: '客服流程优化',
    slides: [
      {
        page: 1,
        purpose: '解释当前问题',
        title: '高峰期等待时间过长',
        body: ['先识别积压环节'],
        visualDescription: '用一张流程图突出排队节点',
        sourceIds: ['source-1'],
        speakerNotes: '补充背景和口径'
      },
      {
        page: 2,
        purpose: '给出改进方案',
        title: '分流可以缩短等待',
        body: ['按问题类型分配队列'],
        visualDescription: '用前后对照图呈现变化',
        sourceIds: ['source-1']
      }
    ]
  }, brief);

  assert.deepEqual(result.issues, []);
  assert.equal(result.pages.length, 2);
  assert.ok(result.pages.every(page => page.checks.purpose && page.checks.conclusion
    && page.checks.conciseCopy.status === 'pass' && page.checks.evidence && page.checks.visualDirection));
  assert.equal(result.transitionChecks.length, 1);
  assert.equal(result.transitionChecks[0].pageOrder.status, 'pass');
  assert.equal(result.transitionChecks[0].purposeFields.status, 'present');
  assert.equal(result.transitionChecks[0].semanticContinuity.status, 'needs-review');
  assert.equal(result.transitionChecks[0].semanticContinuity.evaluated, false);
  assert.equal(Object.hasOwn(result.transitionChecks[0], 'connected'), false);
  assert.ok(result.totalConstraints);
});

test('逐页检查指出缺少的内容和无效证据引用', () => {
  const result = checkSlideDraft({
    slides: [{ page: 1, purpose: '', title: '', body: [], sourceIds: ['unknown'] }]
  }, { sourceIds: ['known'], constraints: { maxWordsPerSlide: 5 } });

  assert.ok(result.issues.some(item => item.page === 1 && /职责/.test(item.message)));
  assert.ok(result.issues.some(item => item.page === 1 && /结论|标题/.test(item.message)));
  assert.ok(result.issues.some(item => item.page === 1 && /来源|证据/.test(item.message)));
});

test('页面编号不连续会报告衔接问题，未提供演讲备注仍属有效', () => {
  const result = checkSlideDraft({
    slides: [
      { page: 1, purpose: '说明问题', title: '问题', body: ['现状'], sourceIds: ['s1'] },
      { page: 3, purpose: '提出方案', title: '方案', body: ['分流'], sourceIds: ['s1'] }
    ]
  }, { sourceIds: ['s1'] });

  assert.equal(result.pages[0].checks.speakerNotes.optional, true);
  assert.equal(result.pages[0].checks.speakerNotes.provided, false);
  assert.equal(result.transitionChecks[0].pageOrder.sequential, false);
  assert.equal(result.transitionChecks[0].semanticContinuity.status, 'needs-review');
  assert.ok(result.issues.some(item => /页序或职责字段/.test(item.message)));
});

test('没有单页字数上限时长文案的精简度标记待审，不误报通过', () => {
  const longCopy = '这是一段很长的页面正文内容'.repeat(20);
  const result = checkSlideDraft({
    slides: [{ page: 1, purpose: '说明背景', title: '背景', body: [longCopy], sourceIds: ['s1'] }]
  }, { sourceIds: ['s1'] });

  assert.ok(result.pages[0].words > 100);
  assert.equal(result.pages[0].checks.conciseCopy.status, 'needs-review');
  assert.equal(result.pages[0].checks.conciseCopy.limit, null);
  assert.match(result.pages[0].checks.conciseCopy.reason, /未设置单页字数上限/);
  assert.equal(result.issues.some(item => /精简|字数上限/.test(item.message)), false);
});

test('页序和职责字段齐全仍不推断语义衔接成立', () => {
  const result = checkSlideDraft({
    slides: [
      { page: 1, purpose: '讨论天气', title: '天气', body: ['晴天'], sourceIds: ['s1'] },
      { page: 2, purpose: '讨论预算', title: '预算', body: ['成本'], sourceIds: ['s1'] }
    ]
  }, { sourceIds: ['s1'] });

  const transition = result.transitionChecks[0];
  assert.equal(transition.pageOrder.status, 'pass');
  assert.equal(transition.purposeFields.status, 'present');
  assert.equal(transition.semanticContinuity.status, 'needs-review');
  assert.equal(transition.semanticContinuity.evaluated, false);
  assert.equal(Object.hasOwn(transition, 'connected'), false);
});
