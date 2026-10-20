(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WritingPackSchema = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const LAYERS = Object.freeze(['core', 'genre', 'task']);
  const VERIFICATION_STATUSES = Object.freeze(['unverified', 'source-reviewed', 'case-validated']);
  const WRITING_PACK_LIMITS = Object.freeze({
    text: 500,
    id: 120,
    listItems: 30,
    itemsPerCollection: 50,
    packs: 100,
    sources: 50,
    stagesPerRoute: 20
  });

  const PACK_FIELDS = new Set([
    'id', 'name', 'layer', 'genre', 'taskType', 'version', 'builtin', 'basePackId', 'enabled',
    'applicability', 'clarifications', 'materials', 'requirements', 'methods', 'prompts',
    'structures', 'style', 'terminology', 'evidenceRules', 'routes', 'checks', 'repairs',
    'nextSteps', 'examples', 'sources', 'createdAt', 'updatedAt'
  ]);
  const ITEM_FIELDS = {
    clarifications: new Set(['id', 'question', 'required', 'when']),
    materials: new Set(['id', 'purpose', 'required', 'acceptedTypes']),
    requirements: new Set(['id', 'statement', 'sourceIds', 'verificationStatus']),
    methods: new Set(['id', 'title', 'guidance', 'applicability', 'sourceIds', 'verificationStatus']),
    prompts: new Set(['id', 'taskType', 'content', 'sourceIds', 'verificationStatus']),
    structures: new Set(['id', 'taskType', 'sections']),
    style: new Set(['id', 'statement', 'sourceIds', 'verificationStatus']),
    terminology: new Set(['id', 'term', 'definition', 'sourceIds', 'verificationStatus']),
    evidenceRules: new Set(['id', 'statement', 'sourceIds', 'verificationStatus']),
    checks: new Set(['id', 'statement', 'sourceIds', 'verificationStatus']),
    repairs: new Set(['id', 'issue', 'action', 'sourceIds', 'verificationStatus']),
    nextSteps: new Set(['id', 'when', 'action', 'sourceIds', 'verificationStatus']),
    examples: new Set(['id', 'kind', 'taskType', 'input', 'prompt', 'result', 'notes', 'verificationStatus']),
    sources: new Set(['id', 'title', 'url', 'locator', 'version', 'license', 'checkedAt', 'applicability', 'limitations', 'verificationStatus'])
  };

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

  function normalizeApplicability(input) {
    const source = isObject(input) ? input : {};
    return {
      tasks: list(source.tasks),
      languages: list(source.languages),
      exclusions: list(source.exclusions)
    };
  }

  function normalizeItem(input, kind) {
    const source = isObject(input) ? input : {};
    const output = { id: requiredId(source.id, `${kind}.id`) };
    const fields = ITEM_FIELDS[kind];
    for (const field of fields) {
      if (field === 'id') continue;
      if (field === 'sourceIds') output[field] = sourceIds(source[field]);
      else if (field === 'verificationStatus') output[field] = verificationStatus(source[field]);
      else if (field === 'required') output[field] = source[field] === true;
      else if (field === 'acceptedTypes' || field === 'applicability' || field === 'sections') output[field] = list(source[field]);
      else output[field] = text(source[field]);
    }
    return output;
  }

  function normalizeStages(value) {
    if (!Array.isArray(value)) return [];
    const stages = value.slice(0, WRITING_PACK_LIMITS.stagesPerRoute).map(input => {
      const source = isObject(input) ? input : {};
      return {
        id: requiredId(source.id, 'routes.stages.id'),
        inputs: list(source.inputs),
        outputs: list(source.outputs),
        checks: list(source.checks),
        skippable: source.skippable === true,
        returnWhenMissing: list(source.returnWhenMissing)
      };
    });
    return uniqueIds(stages, 'routes.stages');
  }

  function normalizeRoutes(value) {
    if (!Array.isArray(value)) return [];
    const routes = value.slice(0, WRITING_PACK_LIMITS.itemsPerCollection).map(input => {
      const source = isObject(input) ? input : {};
      return { id: requiredId(source.id, 'routes.id'), stages: normalizeStages(source.stages) };
    });
    return uniqueIds(routes, 'routes');
  }

  function normalizePackItems(source, kind) {
    if (!Array.isArray(source)) return [];
    const limit = kind === 'sources' ? WRITING_PACK_LIMITS.sources : WRITING_PACK_LIMITS.itemsPerCollection;
    return uniqueIds(source.slice(0, limit).map(item => normalizeItem(item, kind)), kind);
  }

  function normalizeWritingPack(input) {
    const source = isObject(input) ? input : {};
    const pack = {
      id: source.id === undefined ? '' : requiredId(source.id, 'pack.id'),
      name: text(source.name),
      layer: source.layer === undefined ? 'task' : source.layer,
      genre: text(source.genre, WRITING_PACK_LIMITS.id),
      taskType: text(source.taskType, WRITING_PACK_LIMITS.id),
      version: source.version === undefined ? 1 : source.version,
      builtin: false,
      basePackId: text(source.basePackId, WRITING_PACK_LIMITS.id),
      enabled: source.enabled !== false,
      applicability: normalizeApplicability(source.applicability),
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
    const source = isObject(input) ? input : {};
    return {
      id: source.id === undefined ? '' : requiredId(source.id, 'settings.id'),
      enabled: source.enabled !== false,
      updatedAt: text(source.updatedAt, 80)
    };
  }

  function normalizeWritingPackCollection(input) {
    if (!Array.isArray(input)) return [];
    const packs = input.slice(0, WRITING_PACK_LIMITS.packs).map(normalizeWritingPack);
    return uniqueIds(packs, 'writingPacks');
  }

  return {
    LAYERS,
    VERIFICATION_STATUSES,
    WRITING_PACK_LIMITS,
    normalizeWritingPack,
    normalizeWritingPackSettings,
    normalizeWritingPackCollection
  };
});
