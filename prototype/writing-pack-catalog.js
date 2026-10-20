(function (root, factory) {
  const schema = typeof module === 'object' && module.exports && typeof require === 'function'
    ? require('./writing-pack-schema.js')
    : root.WritingPackSchema;
  const api = factory(schema);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WritingPackCatalog = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (schema) {
  function freezeDeep(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeDeep);
      Object.freeze(value);
    }
    return value;
  }

  function createArticlePack() {
    const config = typeof module === 'object' && module.exports && typeof require === 'function'
      ? require('./writing-workbench-schema.js').WRITING_GENRE_CONFIGS.article
      : (typeof globalThis !== 'undefined' && globalThis.WritingWorkbenchSchema
        ? globalThis.WritingWorkbenchSchema.WRITING_GENRE_CONFIGS.article : null);
    const safeConfig = config || {
      applicability: '用于普通文章的目标澄清、初稿诊断和连续改稿；其他文体需确认按普通文章处理。',
      targetFields: {},
      checkDimensions: [], outputRequirements: {}, riskReminders: [], styleBaseline: []
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
