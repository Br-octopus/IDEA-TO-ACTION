(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WritingPackSchema = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const LAYERS = Object.freeze(['core', 'genre', 'task']);
  const VERIFICATION_STATUSES = Object.freeze(['unverified', 'source-reviewed', 'case-validated']);
  const RESOURCE_KINDS = Object.freeze(['script', 'template', 'example', 'reference']);
  const WRITING_PACK_LIMITS = Object.freeze({
    text: 500,
    id: 120,
    listItems: 30,
    itemsPerCollection: 50,
    packs: 100,
    sources: 50,
    resources: 100,
    stagesPerRoute: 20
  });

  const PACK_FIELDS = new Set([
    'id', 'name', 'layer', 'genre', 'taskType', 'version', 'builtin', 'basePackId', 'enabled',
    'applicability', 'targetFields', 'memoryNamespace', 'checkDimensions', 'outputRequirements',
    'riskReminders', 'styleBaseline', 'clarifications', 'materials', 'requirements', 'methods', 'prompts',
    'structures', 'style', 'terminology', 'evidenceRules', 'routes', 'checks', 'repairs',
    'nextSteps', 'examples', 'resources', 'sources', 'createdAt', 'updatedAt'
  ]);
  const ITEM_FIELDS = {
    clarifications: new Set(['id', 'question', 'required', 'when']),
    materials: new Set(['id', 'purpose', 'required', 'acceptedTypes']),
    requirements: new Set(['id', 'enabled', 'statement', 'sourceIds', 'verificationStatus']),
    methods: new Set(['id', 'enabled', 'title', 'guidance', 'applicability', 'inputs', 'outputs', 'checks', 'skippable', 'returnWhenMissing', 'sourceIds', 'verificationStatus']),
    prompts: new Set(['id', 'enabled', 'taskType', 'content', 'sourceIds', 'verificationStatus']),
    structures: new Set(['id', 'enabled', 'taskType', 'sections']),
    style: new Set(['id', 'enabled', 'statement', 'sourceIds', 'verificationStatus']),
    terminology: new Set(['id', 'enabled', 'term', 'definition', 'sourceIds', 'verificationStatus']),
    evidenceRules: new Set(['id', 'enabled', 'statement', 'sourceIds', 'verificationStatus']),
    checks: new Set(['id', 'enabled', 'statement', 'sourceIds', 'verificationStatus']),
    repairs: new Set(['id', 'enabled', 'issue', 'action', 'sourceIds', 'verificationStatus']),
    nextSteps: new Set(['id', 'enabled', 'when', 'action', 'sourceIds', 'verificationStatus']),
    examples: new Set(['id', 'enabled', 'kind', 'taskType', 'input', 'prompt', 'result', 'notes', 'verificationStatus']),
    resources: new Set(['id', 'packId', 'packVersion', 'packName', 'kind', 'title', 'relativePath', 'archive', 'purpose', 'applicability', 'taskTypes', 'genre',
      'sourceIds', 'verificationStatus', 'enabled', 'version', 'summary', 'format', 'sectionIds', 'inputSummary',
      'expectedShape', 'notes', 'actionId', 'inputSchema', 'allowedRoots', 'timeoutMs', 'maxOutputBytes', 'maxFiles']),
    sources: new Set(['id', 'title', 'url', 'locator', 'version', 'versionHash', 'readAt', 'license', 'adoptionReason', 'reviewRecord', 'checkedAt', 'applicability', 'limitations', 'verificationStatus'])
  };
  const ROUTE_STAGE_FIELDS = new Set([
    'id', 'title', 'enabled', 'methodCardIds', 'inputs', 'outputs', 'checks', 'sourceIds', 'verificationStatus',
    'skippable', 'returnWhenMissing'
  ]);

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value, limit = WRITING_PACK_LIMITS.text) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
  }

  function list(value, limit = WRITING_PACK_LIMITS.listItems) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, limit).map(item => text(item)).filter(Boolean);
  }

  function requiredId(value, field) {
    const id = text(value, WRITING_PACK_LIMITS.id);
    if (!id) throw new TypeError(`${field}必须是非空 ID`);
    return id;
  }

  function sourceIds(value) {
    return list(value, WRITING_PACK_LIMITS.listItems).map(id => text(id, WRITING_PACK_LIMITS.id));
  }

  function verificationStatus(value) {
    const status = value === undefined ? 'unverified' : value;
    if (!VERIFICATION_STATUSES.includes(status)) throw new TypeError(`verificationStatus无效：${status}`);
    return status;
  }

  function uniqueIds(items, field) {
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item.id)) throw new TypeError(`${field}存在重复 ID：${item.id}`);
      seen.add(item.id);
    }
    return items;
  }

  function uniqueSourceIds(value, field) {
    const ids = sourceIds(value);
    if (new Set(ids).size !== ids.length) throw new TypeError(`${field}存在重复来源 ID`);
    return ids;
  }

  function normalizeApplicability(input) {
    const source = isObject(input) ? input : {};
    return {
      description: text(source.description),
      tasks: list(source.tasks),
      genres: [...new Set(list(source.genres).filter(item => typeof item === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(item)))].slice(0, 20),
      languages: list(source.languages),
      exclusions: list(source.exclusions)
    };
  }

  function normalizeTargetFields(input) {
    if (!isObject(input)) return {};
    return Object.fromEntries(Object.entries(input).slice(0, WRITING_PACK_LIMITS.itemsPerCollection)
      .map(([key, value]) => [text(key, WRITING_PACK_LIMITS.id), text(value)])
      .filter(([key, value]) => key && value && /^[A-Za-z][A-Za-z0-9_-]*$/.test(key) && !isCredentialKey(key)));
  }

  function normalizeOutputRequirements(input) {
    if (!isObject(input)) return {};
    return Object.fromEntries(Object.entries(input).slice(0, WRITING_PACK_LIMITS.itemsPerCollection)
      .map(([key, value]) => [text(key, WRITING_PACK_LIMITS.id), text(value)])
      .filter(([key, value]) => key && value && /^[A-Za-z][A-Za-z0-9_-]*$/.test(key) && !isCredentialKey(key)));
  }

  function isCredentialKey(key) {
    return /(?:api.?key|private.?key|auth(?:entication|orization)?.?header|access.?token|refresh.?token|token|password|secret|credential|authorization|bearer|jwt)/i.test(key);
  }

  function normalizeResourceSchema(input) {
    if (!isObject(input)) return {};
    const output = {};
    for (const [key, value] of Object.entries(input).slice(0, 40)) {
      if (isCredentialKey(key)) continue;
      if (isObject(value) && isCredentialKey(key)) continue;
      if (isObject(value)) {
        output[key] = Object.fromEntries(Object.entries(value).slice(0, 20)
          .filter(([childKey]) => !isCredentialKey(childKey))
          .map(([childKey, childValue]) => [text(childKey, 80), typeof childValue === 'boolean' || typeof childValue === 'number'
            ? childValue : text(childValue, 300)]).filter(([childKey]) => childKey));
      } else if (Array.isArray(value)) {
        output[key] = list(value, 20);
      } else if (typeof value === 'boolean' || typeof value === 'number') output[key] = value;
      else output[key] = text(value, 300);
    }
    return output;
  }

  function normalizeResource(input) {
    const source = isObject(input) ? input : {};
    const kind = RESOURCE_KINDS.includes(source.kind) ? source.kind : '';
    const output = {
      id: requiredId(source.id, 'resources.id'),
      packId: text(source.packId, WRITING_PACK_LIMITS.id),
      packVersion: Number.isSafeInteger(source.packVersion) && source.packVersion > 0 ? source.packVersion : 1,
      packName: text(source.packName),
      kind,
      title: text(source.title),
      relativePath: text(source.relativePath, 500).replace(/\\/g, '/'),
      archive: text(source.archive, 180),
      purpose: text(source.purpose),
      applicability: text(source.applicability),
      taskTypes: list(source.taskTypes),
      genre: text(source.genre, WRITING_PACK_LIMITS.id),
      sourceIds: sourceIds(source.sourceIds),
      verificationStatus: verificationStatus(source.verificationStatus),
      enabled: source.enabled !== false,
      version: text(source.version, 160),
      summary: text(source.summary, 1200),
      format: text(source.format, 80),
      sectionIds: list(source.sectionIds),
      inputSummary: text(source.inputSummary, 800),
      expectedShape: text(source.expectedShape, 800),
      notes: text(source.notes, 1200)
    };
    if (kind === 'script') Object.assign(output, {
      actionId: text(source.actionId, 160),
      inputSchema: normalizeResourceSchema(source.inputSchema),
      allowedRoots: list(source.allowedRoots, 10),
      timeoutMs: Number.isSafeInteger(source.timeoutMs) ? Math.min(Math.max(source.timeoutMs, 100), 120_000) : 30_000,
      maxOutputBytes: Number.isSafeInteger(source.maxOutputBytes) ? Math.min(Math.max(source.maxOutputBytes, 1024), 2_000_000) : 256_000,
      maxFiles: Number.isSafeInteger(source.maxFiles) ? Math.min(Math.max(source.maxFiles, 1), 10_000) : 10_000
    });
    if (!kind) throw new TypeError(`resources.kind无效：${source.kind}`);
    if (!output.title || !output.purpose || !output.relativePath) throw new TypeError('资源必须包含 title、purpose 和 relativePath');
    if (output.relativePath.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(output.relativePath)
      || output.relativePath.split('/').some(part => !part || part === '..' || part === '.')) {
      throw new TypeError('资源 relativePath 必须是安全相对路径');
    }
    if (kind === 'script' && !output.actionId) throw new TypeError('脚本资源必须包含 actionId');
    return Object.fromEntries(Object.entries(output).filter(([key]) => ITEM_FIELDS.resources.has(key)));
  }

  function normalizeItem(input, kind) {
    const source = isObject(input) ? input : {};
    const output = { id: requiredId(source.id, `${kind}.id`) };
    const fields = ITEM_FIELDS[kind];
    for (const field of fields) {
      if (field === 'id') continue;
      if (field === 'sourceIds') output[field] = sourceIds(source[field]);
      else if (field === 'verificationStatus') output[field] = verificationStatus(source[field]);
      else if (field === 'enabled') output[field] = source.enabled !== false;
      else if (field === 'required') output[field] = source[field] === true;
      else if (['inputs', 'outputs', 'checks', 'returnWhenMissing', 'methodCardIds'].includes(field)) output[field] = list(source[field]);
      else if (field === 'skippable') output[field] = source[field] === true;
      else if (field === 'applicability' && kind === 'sources') {
        output[field] = Array.isArray(source[field])
          ? list(source[field]).join('；')
          : text(source[field]);
      }
      else if (field === 'acceptedTypes' || field === 'applicability' || field === 'sections') output[field] = list(source[field]);
      else output[field] = text(source[field]);
    }
    return output;
  }

  function normalizeStages(value) {
    if (!Array.isArray(value)) return [];
    const stages = value.slice(0, WRITING_PACK_LIMITS.stagesPerRoute).map(input => {
      const source = isObject(input) ? input : {};
      const stage = {
        id: requiredId(source.id, 'routes.stages.id'),
        title: text(source.title),
        enabled: source.enabled !== false,
        inputs: list(source.inputs),
        outputs: list(source.outputs),
        checks: list(source.checks),
        methodCardIds: list(source.methodCardIds),
        sourceIds: uniqueSourceIds(source.sourceIds, 'routes.stages.sourceIds'),
        verificationStatus: verificationStatus(source.verificationStatus),
        skippable: source.skippable === true,
        returnWhenMissing: list(source.returnWhenMissing)
      };
      return Object.fromEntries(Object.entries(stage).filter(([key]) => ROUTE_STAGE_FIELDS.has(key)));
    });
    return uniqueIds(stages, 'routes.stages');
  }

  function normalizeRoutes(value) {
    if (!Array.isArray(value)) return [];
    const routes = value.slice(0, WRITING_PACK_LIMITS.itemsPerCollection).map(input => {
      const source = isObject(input) ? input : {};
      return {
        id: requiredId(source.id, 'routes.id'),
        title: text(source.title),
        enabled: source.enabled !== false,
        taskTypes: [...new Set(list(source.taskTypes))],
        sourceIds: uniqueSourceIds(source.sourceIds, 'routes.sourceIds'),
        verificationStatus: verificationStatus(source.verificationStatus),
        stages: normalizeStages(source.stages)
      };
    });
    return uniqueIds(routes, 'routes');
  }

  function normalizePackItems(source, kind) {
    if (!Array.isArray(source)) return [];
    const limit = kind === 'sources' ? WRITING_PACK_LIMITS.sources : WRITING_PACK_LIMITS.itemsPerCollection;
    return uniqueIds(source.slice(0, limit).map(item => kind === 'resources' ? normalizeResource(item) : normalizeItem(item, kind)), kind);
  }

  function normalizeWritingPack(input) {
    if (!isObject(input)) return {};
    const source = isObject(input) ? input : {};
    const pack = {
      id: requiredId(source.id, 'pack.id'),
      name: text(source.name),
      layer: source.layer === undefined ? 'task' : source.layer,
      genre: text(source.genre, WRITING_PACK_LIMITS.id),
      taskType: text(source.taskType, WRITING_PACK_LIMITS.id),
      version: source.version === undefined ? 1 : source.version,
      builtin: false,
      basePackId: text(source.basePackId, WRITING_PACK_LIMITS.id),
      enabled: source.enabled !== false,
      applicability: normalizeApplicability(source.applicability),
      targetFields: normalizeTargetFields(source.targetFields),
      memoryNamespace: text(source.memoryNamespace, WRITING_PACK_LIMITS.id),
      checkDimensions: list(source.checkDimensions, WRITING_PACK_LIMITS.listItems),
      outputRequirements: normalizeOutputRequirements(source.outputRequirements),
      riskReminders: list(source.riskReminders, WRITING_PACK_LIMITS.listItems),
      styleBaseline: list(source.styleBaseline, WRITING_PACK_LIMITS.listItems),
      clarifications: normalizePackItems(source.clarifications, 'clarifications'),
      materials: normalizePackItems(source.materials, 'materials'),
      requirements: normalizePackItems(source.requirements, 'requirements'),
      methods: normalizePackItems(source.methods, 'methods'),
      prompts: normalizePackItems(source.prompts, 'prompts'),
      structures: normalizePackItems(source.structures, 'structures'),
      style: normalizePackItems(source.style, 'style'),
      terminology: normalizePackItems(source.terminology, 'terminology'),
      evidenceRules: normalizePackItems(source.evidenceRules, 'evidenceRules'),
      routes: normalizeRoutes(source.routes),
      checks: normalizePackItems(source.checks, 'checks'),
      repairs: normalizePackItems(source.repairs, 'repairs'),
      nextSteps: normalizePackItems(source.nextSteps, 'nextSteps'),
      examples: normalizePackItems(source.examples, 'examples'),
      resources: normalizePackItems(source.resources, 'resources'),
      sources: normalizePackItems(source.sources, 'sources'),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    if (!LAYERS.includes(pack.layer)) throw new TypeError(`layer无效：${pack.layer}`);
    if (typeof pack.version !== 'number' || !Number.isSafeInteger(pack.version) || pack.version < 1) {
      throw new TypeError('version必须是正安全整数');
    }
    return pack;
  }

  function normalizeWritingPackSettings(input) {
    if (!isObject(input)) return {};
    const source = isObject(input) ? input : {};
    return {
      id: requiredId(source.id, 'settings.id'),
      enabled: source.enabled !== false,
      updatedAt: text(source.updatedAt, 80),
      ...(Number.isSafeInteger(source.acceptedVersion) && source.acceptedVersion > 0 ? { acceptedVersion: source.acceptedVersion } : {}),
      ...(isObject(source.acceptedPack) ? { acceptedPack: normalizeWritingPack(source.acceptedPack) } : {}),
      ...(Array.isArray(source.history) ? { history: source.history.slice(-50).map(normalizeWritingPack) } : {})
    };
  }

  function normalizeWritingPackCollection(input) {
    if (!Array.isArray(input)) return [];
    const packs = input.slice(0, WRITING_PACK_LIMITS.packs).filter(isObject).map(normalizeWritingPack);
    return uniqueIds(packs, 'writingPacks');
  }

  return {
    LAYERS,
    VERIFICATION_STATUSES,
    RESOURCE_KINDS,
    WRITING_PACK_LIMITS,
    normalizeWritingPack,
    normalizeWritingPackSettings,
    normalizeWritingPackCollection
  };
});
