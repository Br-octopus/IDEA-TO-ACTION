(function (root, factory) {
  const schema = typeof module === 'object' && module.exports
    ? require('./ppt-scene-schema.js')
    : root.ForwardStepPptSceneSchema;
  const api = factory(schema);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepPptSceneWorkflow = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (schema) {
  const DENSITY = Object.freeze({
    low: { unitsPerSlide: [0.75, 1.5], secondsPerSlide: [55, 85], label: '低密度' },
    medium: { unitsPerSlide: [1, 2], secondsPerSlide: [40, 65], label: '中密度' },
    high: { unitsPerSlide: [1.5, 3], secondsPerSlide: [25, 45], label: '高密度' }
  });
  const ROUTES = Object.freeze([
    {
      id: 'native-ppt',
      editability: '文字、图表和形状可作为 PowerPoint 原生对象直接编辑。',
      visualFidelity: '复杂效果可能需要简化，视觉表现取决于 PowerPoint 对象能力。',
      modificationCost: '后续修改成本低到中；结构清楚时可直接调整对象。',
      conversionLimitations: '复杂动效和特殊视觉效果可能无法原样表达；提示词应要求可编辑对象。',
      reasons: ['适合需要在 PowerPoint 内直接修改和协作的交付。']
    },
    {
      id: 'image-rebuild',
      editability: '整页图片不可独立编辑；重建后的文字、图表和形状可编辑。',
      visualFidelity: '视觉稿可高度贴近目标效果，重建后仍可能有位置和识别误差。',
      modificationCost: '先出图较快；后续逐页重建和核验成本高。',
      conversionLimitations: '图片不会自动变成可编辑对象，必须人工或借助外部工具逐页重建并检查。',
      reasons: ['适合优先追求视觉完成度且愿意承担后续重建工作的场景。']
    },
    {
      id: 'html-final',
      editability: '可通过修改 HTML、CSS 和脚本编辑；不是 PowerPoint 原生对象。',
      visualFidelity: '浏览器中可保留网页排版、动效和交互表现。',
      modificationCost: '熟悉网页技术时迭代成本低；不熟悉时需要网页开发支持。',
      conversionLimitations: '依赖浏览器和播放设备，不等同于 PPT 文件；离线、字体和屏幕环境会影响呈现。',
      reasons: ['适合网页播放、快速迭代或需要 HTML 交互效果的场景。']
    },
    {
      id: 'html-to-ppt',
      editability: '转换成功的文本、图形可编辑，但结果取决于转换工具和页面结构。',
      visualFidelity: '可保留部分 HTML 视觉设计，复杂布局可能出现差异。',
      modificationCost: '前期可复用 HTML；转换后需要逐页修复和核对。',
      conversionLimitations: 'CSS、字体、分页、动画和复杂元素可能无法忠实转换，必须列入验收。',
      reasons: ['适合同时需要 HTML 迭代和 PowerPoint 可编辑交付的场景。']
    }
  ]);

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function numberOrNull(value, field = '数值') {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'boolean') throw new TypeError(`${field}必须是有效数值`);
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > Number.MAX_SAFE_INTEGER) {
      throw new TypeError(`${field}必须是大于 0 的安全范围数值`);
    }
    return number;
  }

  function normalizeDensity(value) {
    return DENSITY[value] ? value : 'medium';
  }

  function estimateSlideCount({ durationMinutes, contentUnits, density, userRange } = {}) {
    const level = normalizeDensity(density);
    const profile = DENSITY[level];
    const duration = numberOrNull(durationMinutes, '时长');
    const units = Array.isArray(contentUnits)
      ? contentUnits.filter(item => item !== null && item !== undefined && String(item).trim()).length
      : numberOrNull(contentUnits, '内容单元数');
    const assumptions = [
      `按${profile.label}处理；每页承载约 ${profile.unitsPerSlide[0]}-${profile.unitsPerSlide[1]} 个内容单元。`,
      `按${profile.label}内容估计每页讲解 ${profile.secondsPerSlide[0]}-${profile.secondsPerSlide[1]} 秒；这只是规划假设，不是固定的每分钟页数。`
    ];
    if (density !== undefined && !DENSITY[density]) assumptions.push('未识别密度值，按中密度作为临时假设。');
    let range = { min: 3, max: 8 };
    const conflicts = [];

    if (units !== null && units > 0) {
      range = {
        min: Math.max(1, Math.ceil(units / profile.unitsPerSlide[1])),
        max: Math.max(1, Math.ceil(units / profile.unitsPerSlide[0]))
      };
      assumptions.push(`内容量按 ${units} 个内容单元估算；尚未逐条评估复杂度和论证深度。`);
    } else {
      assumptions.push('未提供内容单元，暂以 3-8 页作为待调整的初始工作区间。');
    }

    if (duration !== null) {
      const durationMin = Math.max(1, Math.floor(duration * 60 / profile.secondsPerSlide[1]));
      const durationMax = Math.max(durationMin, Math.ceil(duration * 60 / profile.secondsPerSlide[0]));
      const overlap = { min: Math.max(range.min, durationMin), max: Math.min(range.max, durationMax) };
      if (overlap.min <= overlap.max) {
        range = overlap;
      } else {
        conflicts.push({
          type: 'duration-content',
          message: `时长对应约 ${durationMin}-${durationMax} 页，与内容量估算 ${range.min}-${range.max} 页不重叠。`,
          durationRange: { min: durationMin, max: durationMax },
          contentRange: { ...range }
        });
        range = { min: durationMin, max: durationMax };
      }
      assumptions.push(`${duration} 分钟时长按每页讲解时间换算为约 ${durationMin}-${durationMax} 页；与内容量范围不相交时暂按时长范围展示并单列冲突，实际节奏需校正。`);
    } else {
      assumptions.push('未提供演讲时长，页数建议不代表精确的时间规划。');
    }

    const requested = object(userRange);
    const requestedMin = numberOrNull(requested.min ?? requested.minSlides, '用户页数下限');
    const requestedMax = numberOrNull(requested.max ?? requested.maxSlides, '用户页数上限');
    if (requestedMin !== null || requestedMax !== null) {
      if (requestedMin !== null && !Number.isSafeInteger(requestedMin)) throw new TypeError('用户页数下限必须是正安全整数');
      if (requestedMax !== null && !Number.isSafeInteger(requestedMax)) throw new TypeError('用户页数上限必须是正安全整数');
      if (requestedMin !== null && requestedMax !== null && requestedMin > requestedMax) {
        throw new TypeError('用户页数下限不能大于上限');
      }
      const before = { ...range };
      const overlap = {
        min: Math.max(range.min, requestedMin || 1),
        max: Math.min(range.max, requestedMax || Infinity)
      };
      if (overlap.min > overlap.max) {
        conflicts.push({
          type: 'user-range',
          message: `用户范围 ${requestedMin || 1}-${requestedMax || '未设上限'} 页与估算区间 ${before.min}-${before.max} 页不重叠。`,
          estimateRange: before,
          userRange: { min: requestedMin, max: requestedMax }
        });
        range = {
          min: requestedMin || Math.min(before.min, requestedMax),
          max: requestedMax || Math.max(before.max, requestedMin)
        };
      } else {
        range = overlap;
      }
      assumptions.push(`已将用户指定范围 ${requestedMin || 1}-${requestedMax || '未设上限'} 页纳入估算。`);
    }

    return { range, assumptions, conflicts, precise: false };
  }

  function countWords(value) {
    const text = String(value || '');
    const pieces = text.match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu);
    return pieces ? pieces.length : 0;
  }

  function slideWords(slide) {
    const body = Array.isArray(slide.body) ? slide.body.join(' ') : slide.body;
    return countWords([slide.title, body].filter(Boolean).join(' '));
  }

  function validatePptConstraints(briefInput = {}, draftInput = {}) {
    const brief = schema.createPptBrief(object(briefInput));
    const draft = schema.normalizePptDraft(object(draftInput));
    const constraints = object(brief.constraints);
    const slides = Array.isArray(draft.slides) ? draft.slides : [];
    const hardConflicts = [];
    const preferenceDeviations = [];
    const preferenceReview = Array.isArray(brief.preferences) ? brief.preferences.slice() : [];
    const maxSlides = numberOrNull(constraints.maxSlides);
    const minSlides = numberOrNull(constraints.minSlides);
    const maxWordsPerSlide = numberOrNull(constraints.maxWordsPerSlide);

    if (minSlides !== null && slides.length < minSlides) {
      hardConflicts.push({
        type: 'min-slides', message: `当前 ${slides.length} 页，低于硬性下限 ${minSlides} 页。`,
        actual: slides.length, limit: minSlides, basis: `按草稿 slides 数量 ${slides.length} 与 constraints.minSlides=${minSlides} 比较。`
      });
    }
    if (maxSlides !== null && slides.length > maxSlides) {
      hardConflicts.push({
        type: 'max-slides', message: `当前 ${slides.length} 页，超过硬性上限 ${maxSlides} 页。`,
        actual: slides.length, limit: maxSlides, basis: `按草稿 slides 数量 ${slides.length} 与 constraints.maxSlides=${maxSlides} 比较。`
      });
    }

    const perSlideWords = slides.map((slide, index) => ({ page: slide.page || index + 1, words: slideWords(slide) }));
    const wordCount = perSlideWords.reduce((sum, item) => sum + item.words, 0);
    const wordCapacity = maxWordsPerSlide === null ? null : slides.length * maxWordsPerSlide;
    if (maxWordsPerSlide !== null) {
      for (const item of perSlideWords) {
        if (item.words > maxWordsPerSlide) {
          hardConflicts.push({
            type: 'max-words-per-slide', page: item.page,
            message: `第 ${item.page} 页约 ${item.words} 词，超过单页上限 ${maxWordsPerSlide} 词。`,
            actualWords: item.words, limit: maxWordsPerSlide,
            basis: `按标题与 body 的词项计数；中文每个汉字计 1 词，拉丁字母/数字连续串计 1 词。`
          });
        }
      }
      if (wordCapacity !== null && wordCount > wordCapacity) {
        hardConflicts.push({
          type: 'total-word-capacity',
          message: `总文案约 ${wordCount} 词，超过当前 ${slides.length} 页按单页上限计算的容量 ${wordCapacity} 词。`,
          actualWords: wordCount, capacity: wordCapacity,
          basis: `${slides.length} 页 × ${maxWordsPerSlide} 词/页 = ${wordCapacity} 词；总字数按每页 title 与 body 统计。`
        });
      }
    }

    const duration = numberOrNull(brief.durationMinutes);
    if (duration !== null && slides.length) {
      const pacing = estimateSlideCount({ durationMinutes: duration, contentUnits: slides.length, density: 'medium' });
      if (slides.length > pacing.range.max) {
        hardConflicts.push({
          type: 'duration-slides',
          message: `${duration} 分钟容纳 ${slides.length} 页超出本次讲解节奏估算上界 ${pacing.range.max} 页，存在时长冲突。`,
          actual: slides.length, limit: pacing.range.max,
          basis: pacing.assumptions.join(' ')
        });
      }
    }

    return {
      hardConflicts,
      preferenceDeviations,
      preferenceReview,
      effectiveConstraints: { minSlides, maxSlides, maxWordsPerSlide },
      wordCount,
      wordCapacity,
      wordCountBasis: {
        included: '每页 title 与 body',
        slideCount: slides.length,
        maxWordsPerSlide,
        capacityFormula: maxWordsPerSlide === null ? null : `${slides.length} 页 × ${maxWordsPerSlide} 词/页 = ${wordCapacity} 词`,
        countingRule: '中文每个汉字计 1 词，拉丁字母或数字连续串计 1 词；不计视觉说明、来源 ID 和演讲备注。'
      }
    };
  }

  function recommendPptRoute(briefInput = {}) {
    const brief = object(briefInput);
    const preferences = Array.isArray(brief.preferences) ? brief.preferences.join(' ') : '';
    let recommended = brief.route && brief.route !== 'undecided' ? brief.route : 'native-ppt';
    if (recommended === 'native-ppt' && /HTML.{0,8}(转|转换).{0,8}PPT|转.{0,8}PPT.{0,8}HTML|同时.{0,8}HTML.{0,8}PPT/i.test(preferences)) recommended = 'html-to-ppt';
    else if (recommended === 'native-ppt' && /HTML|网页|浏览器|交互/i.test(preferences)) recommended = 'html-final';
    else if (recommended === 'native-ppt' && /视觉|美观|图片|高保真/.test(preferences)) recommended = 'image-rebuild';

    const options = ROUTES.map(route => ({
      ...route,
      reasons: [...route.reasons],
      recommended: route.id === recommended
    }));
    const selected = options.find(option => option.id === recommended);
    selected.reasons.unshift(brief.route && brief.route !== 'undecided'
      ? '按用户指定路线标记为当前建议；仍需结合交付环境核对限制。'
      : '未指定路线，暂按需要广泛编辑和常见 PowerPoint 交付环境推荐原生可编辑 PPT。');
    return {
      recommendedRoute: recommended,
      reasons: selected.reasons.slice(),
      limitations: selected.conversionLimitations,
      options
    };
  }

  function checkSlideDraft(draftInput = {}, briefInput = {}) {
    const brief = schema.createPptBrief(object(briefInput));
    const draft = schema.normalizePptDraft(object(draftInput));
    const slides = Array.isArray(draft.slides) ? draft.slides : [];
    const knownSources = new Set(Array.isArray(brief.sourceIds) ? brief.sourceIds : []);
    const pages = slides.map((slide, index) => {
      const page = slide.page || index + 1;
      const words = slideWords(slide);
      const maxWords = numberOrNull(object(brief.constraints).maxWordsPerSlide);
      const sourceIds = Array.isArray(slide.sourceIds) ? slide.sourceIds : [];
      const invalidSources = knownSources.size ? sourceIds.filter(id => !knownSources.has(id)) : [];
      const missingEvidence = sourceIds.length === 0;
      const checks = {
        purpose: Boolean(String(slide.purpose || '').trim()),
        conclusion: Boolean(String(slide.title || '').trim()),
        conciseCopy: maxWords === null || words <= maxWords,
        evidence: !missingEvidence && invalidSources.length === 0,
        visualDirection: Boolean(String(slide.visualDescription || '').trim()),
        speakerNotes: { optional: true, provided: Boolean(String(slide.speakerNotes || '').trim()) }
      };
      const issues = [];
      if (!checks.purpose) issues.push('缺少页面职责 purpose。');
      if (!checks.conclusion) issues.push('缺少页面结论或标题。');
      if (!checks.conciseCopy) issues.push(`页面文案约 ${words} 词，超过单页上限 ${maxWords} 词。`);
      if (missingEvidence) issues.push('缺少证据来源引用。');
      if (invalidSources.length) issues.push(`引用了简报未登记的来源 ID：${invalidSources.join(', ')}。`);
      if (!checks.visualDirection) issues.push('缺少视觉表达方向。');
      return { page, words, checks, invalidSources, issues };
    });

    const transitionChecks = [];
    for (let index = 1; index < slides.length; index++) {
      const previous = slides[index - 1];
      const current = slides[index];
      transitionChecks.push({
        fromPage: previous.page || index,
        toPage: current.page || index + 1,
        sequential: current.page === previous.page + 1,
        hasPagePurposes: Boolean(String(previous.purpose || '').trim() && String(current.purpose || '').trim()),
        connected: current.page === previous.page + 1
          && Boolean(String(previous.purpose || '').trim() && String(current.purpose || '').trim()),
        basis: '根据相邻页页码连续性和 purpose 是否填写检查结构衔接；语义因果仍需人工审阅。'
      });
    }
    const totalConstraints = validatePptConstraints(brief, draft);
    const issues = pages.flatMap(page => page.issues.map(message => ({ page: page.page, message })))
      .concat(transitionChecks.filter(transition => !transition.connected)
        .map(transition => ({ page: transition.toPage, message: `第 ${transition.fromPage} 页到第 ${transition.toPage} 页的结构衔接不完整。` })))
      .concat(totalConstraints.hardConflicts.map(conflict => ({ page: conflict.page || null, message: conflict.message })));
    return { pages, transitionChecks, totalConstraints, issues };
  }

  return { estimateSlideCount, validatePptConstraints, recommendPptRoute, checkSlideDraft };
});
