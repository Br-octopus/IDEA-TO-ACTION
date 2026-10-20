(function (root, factory) {
  const schema = typeof module === 'object' && module.exports && typeof require === 'function'
    ? require('./writing-pack-schema.js')
    : root.WritingPackSchema;
  const api = factory(root, schema);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WritingPackCatalog = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (root, schema) {
  function freezeDeep(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeDeep);
      Object.freeze(value);
    }
    return value;
  }

  function createArticlePack() {
    const config = typeof module === 'object' && module.exports && typeof require === 'function'
      ? require('./writing-workbench-schema.js')?.WRITING_GENRE_CONFIGS?.article
      : root?.WritingWorkbenchSchema?.WRITING_GENRE_CONFIGS?.article;
    const defaults = {
      name: '普通文章',
      applicability: '用于普通文章的目标澄清、初稿诊断和连续改稿；其他文体需确认按普通文章处理。',
      targetFields: {
        title: '标题', goal: '目标', audience: '读者', platform: '平台',
        successCriteria: '成功标准', preserveItems: '保留项', constraints: '限制条件'
      },
      checkDimensions: ['目标读者', '事实依据', '逻辑结构', '语言表达', '风格修辞', '术语一致', '格式排版', '约束风险'],
      outputRequirements: {
        diagnosis: '你负责诊断当前稿件。不得直接改写文章或产出文章成品。逐项引用具体句段，给出观察、影响、方向、优先级；方向描述修改意图，不提供替换正文。未确定项写待核实。',
        revision: '交给外部 AI 的下一轮写作指令。本工具只生成提示词；外部 AI 可依据本指令执行修改并输出修改稿。请保留目标、成功标准、保留项、反馈、前轮诊断和风格，勿擅增事实。'
      },
      riskReminders: ['事实、数据和引用需核对来源，不补造依据。', 'AI味只检查具体表达，不判断作者身份；无问题不强改。'],
      styleBaseline: ['表达清晰具体，段落围绕同一重点推进，减少空泛总结。', '保留必要术语和有依据的细节，不机械缩句或替词。'],
      memoryNamespace: 'article'
    };
    const safeConfig = {
      ...defaults,
      ...(config && typeof config === 'object' ? config : {}),
      targetFields: config?.targetFields && typeof config.targetFields === 'object'
        ? { ...defaults.targetFields, ...config.targetFields } : defaults.targetFields,
      checkDimensions: Array.isArray(config?.checkDimensions) ? config.checkDimensions : defaults.checkDimensions,
      outputRequirements: config?.outputRequirements && typeof config.outputRequirements === 'object'
        ? { ...defaults.outputRequirements, ...config.outputRequirements } : defaults.outputRequirements,
      riskReminders: Array.isArray(config?.riskReminders) ? config.riskReminders : defaults.riskReminders,
      styleBaseline: Array.isArray(config?.styleBaseline) ? config.styleBaseline : defaults.styleBaseline,
      memoryNamespace: typeof config?.memoryNamespace === 'string' ? config.memoryNamespace : defaults.memoryNamespace
    };
    const sourceId = 'writing-workbench-article';
    const source = {
      id: sourceId, title: '现有普通文章规则', url: '', locator: 'WRITING_GENRE_CONFIGS.article',
      version: '当前代码基线', license: '项目内部规则', checkedAt: '未核对',
      applicability: '现有普通文章工作台配置', limitations: '未作独立外部来源核验', verificationStatus: 'unverified'
    };
    const checks = safeConfig.checkDimensions.map((statement, index) => ({
      id: `article-check-${index + 1}`, statement, sourceIds: [sourceId], verificationStatus: 'unverified'
    }));
    const style = safeConfig.styleBaseline.map((statement, index) => ({
      id: `article-style-${index + 1}`, statement, sourceIds: [sourceId], verificationStatus: 'unverified'
    }));
    const repairs = safeConfig.riskReminders.map((action, index) => ({
      id: `article-risk-${index + 1}`, issue: '约束或事实风险', action, sourceIds: [sourceId], verificationStatus: 'unverified'
    }));
    const prompts = Object.entries(safeConfig.outputRequirements).map(([taskType, content], index) => ({
      id: `article-prompt-${index + 1}`, taskType, content, sourceIds: [sourceId], verificationStatus: 'unverified'
    }));
    return {
      id: 'builtin-article', name: safeConfig.name || '普通文章', layer: 'genre', genre: 'article',
      taskType: 'article', version: 1, builtin: false, basePackId: '', enabled: true,
      applicability: {
        description: safeConfig.applicability,
        tasks: ['article'], languages: ['zh'],
        exclusions: ['其他文体需确认按普通文章处理。']
      },
      targetFields: safeConfig.targetFields,
      memoryNamespace: safeConfig.memoryNamespace || 'article',
      checkDimensions: safeConfig.checkDimensions,
      outputRequirements: safeConfig.outputRequirements,
      riskReminders: safeConfig.riskReminders,
      styleBaseline: safeConfig.styleBaseline,
      clarifications: [], materials: [], requirements: [], methods: [], prompts, structures: [], style,
      terminology: [], evidenceRules: [], routes: [], checks, repairs, nextSteps: [], examples: [], sources: [source],
      createdAt: '2026-10-20', updatedAt: '2026-10-20'
    };
  }

  function getBuiltinWritingPacks() {
    const normalized = schema && typeof schema.normalizeWritingPack === 'function'
      ? schema.normalizeWritingPack(createArticlePack())
      : createArticlePack();
    normalized.builtin = true;
    normalized.basePackId = '';
    return freezeDeep([normalized]);
  }

  return { getBuiltinWritingPacks };
});
