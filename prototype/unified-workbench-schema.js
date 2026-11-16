(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepUnifiedWorkbenchSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const WORKBENCH_SCHEMA_VERSION = 1;
  const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const text = value => typeof value === "string" ? value : "";
  const list = (value, map, label) => {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new TypeError(`${label} 必须是数组`);
    return value.map((item, index) => {
      if (!isObject(item)) throw new TypeError(`${label}[${index}] 必须是对象`);
      return map(item);
    });
  };
  const annotations = value => list(value, item => ({ ...item }), "批注");

  function normalizeWorkbenchContentVersion(value) {
    const source = isObject(value) ? value : {};
    return { ...source, id: text(source.id), text: text(source.text), attachmentId: text(source.attachmentId),
      hash: text(source.hash), sourceRef: source.sourceRef ?? null, parseStatus: text(source.parseStatus),
      annotations: annotations(source.annotations), parentVersionId: text(source.parentVersionId),
      roundId: text(source.roundId), deliveryId: text(source.deliveryId) };
  }

  function normalizeWorkbenchContent(value) {
    const source = isObject(value) ? value : {};
    const draft = typeof source.draft === "string" ? { text: source.draft } : isObject(source.draft) ? source.draft : {};
    return { ...source, id: text(source.id), title: text(source.title), kind: text(source.kind) || "unknown",
      purpose: ["reference", "result"].includes(source.purpose) ? source.purpose : "reference",
      purposeReason: text(source.purposeReason), draft: { ...draft, text: text(draft.text), baseVersionId: text(draft.baseVersionId) },
      versions: list(source.versions, normalizeWorkbenchContentVersion, "内容版本"), sourceRef: source.sourceRef ?? null };
  }

  function normalizeWorkbenchCanvasNode(value) {
    const source = isObject(value) ? value : {};
    const position = isObject(source.position) ? source.position : {};
    const size = isObject(source.size) ? source.size : {};
    const numeric = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    return { ...source, id: text(source.id), contentVersionId: text(source.contentVersionId),
      position: { ...position, x: numeric(position.x, 0), y: numeric(position.y, 0) },
      size: { ...size, width: numeric(size.width, 0), height: numeric(size.height, 0) },
      zIndex: numeric(source.zIndex, 0), groupId: text(source.groupId), annotations: annotations(source.annotations) };
  }

  function normalizeWorkbenchCanvas(value) {
    const source = isObject(value) ? value : {};
    const view = isObject(source.viewport) ? source.viewport : {};
    const numeric = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    return { ...source, id: text(source.id), title: text(source.title),
      purpose: ["reference", "result"].includes(source.purpose) ? source.purpose : "reference",
      viewport: { ...view, x: numeric(view.x, 0), y: numeric(view.y, 0), zoom: numeric(view.zoom, 1) },
      groups: list(source.groups, item => ({ ...item, id: text(item.id) }), "画布分组"),
      nodes: list(source.nodes, normalizeWorkbenchCanvasNode, "画布节点") };
  }

  const layoutIntent = value => ({ ...(isObject(value) ? value : {}), enabled: isObject(value) && value.enabled === true });
  function normalizeDelivery(value) {
    const source = isObject(value) ? value : {};
    return { ...source, id: text(source.id), text: text(source.text),
      materials: list(source.materials, item => ({ ...item }), "交付素材"), annotations: annotations(source.annotations),
      layoutIntent: layoutIntent(source.layoutIntent), createdAt: text(source.createdAt) };
  }
  function normalizeWorkbenchPromptRound(value) {
    const source = isObject(value) ? value : {};
    return { ...source, id: text(source.id), draftText: text(source.draftText),
      contentVersionIds: (() => {
        if (source.contentVersionIds != null && !Array.isArray(source.contentVersionIds)) {
          throw new TypeError(`提示词轮次的内容版本引用须为数组`);
        }
        return Array.isArray(source.contentVersionIds) ? source.contentVersionIds.map(text) : [];
      })(),
      deliveries: list(source.deliveries, normalizeDelivery, "提示词交付") };
  }
  function normalizeWorkbenchDraft(value) {
    const source = isObject(value) ? value : {};
    return { ...source, goal: text(source.goal), opinion: text(source.opinion), promptText: text(source.promptText),
      annotations: annotations(source.annotations) };
  }
  const normalizeSelection = value => ({ ...value, contentVersionId: text(value.contentVersionId) });

  function assertReferences(project) {
    const versions = new Set();
    const unique = (items, label) => {
      const ids = new Set();
      for (const item of items) {
        if (!item.id || ids.has(item.id)) throw new TypeError(`${label} ID 无效或重复：${item.id}`);
        ids.add(item.id);
      }
    };
    unique(project.workbenchContents, `工作台内容`);
    for (const content of project.workbenchContents) {
      if (!content.id) throw new TypeError("工作台内容必须提供非空 id");
      for (const version of content.versions) {
        if (!version.id || versions.has(version.id)) throw new TypeError(`内容版本 ID 无效或重复：${version.id}`);
        versions.add(version.id);
      }
    }
    unique(project.workbenchCanvases, "工作台画布");
    unique(project.workbenchPromptRounds, "提示词轮次");
    for (const canvas of project.workbenchCanvases) {
      unique(canvas.nodes, `画布 ${canvas.id} 的节点`);
      for (const node of canvas.nodes) {
        if (!node.id) throw new TypeError(`画布 ${canvas.id} 的节点必须提供非空 id`);
        if (node.contentVersionId && !versions.has(node.contentVersionId)) throw new TypeError(`不存在的内容版本：${node.contentVersionId}`);
      }
    }
    const refs = [...project.workbenchSelection.items.map(item => item.contentVersionId),
      ...project.workbenchPromptRounds.flatMap(round => round.contentVersionIds),
      ...project.workbenchPromptRounds.flatMap(round => round.deliveries.flatMap(delivery => delivery.materials.map(item => item.contentVersionId).filter(Boolean)))];
    for (const id of refs) if (!versions.has(id)) throw new TypeError(`不存在的内容版本：${id}`);
    for (const round of project.workbenchPromptRounds) unique(round.deliveries, `提示词轮次 ${round.id} 的交付`);
  }

  function normalizeWorkbenchProject(value) {
    const source = isObject(value) ? value : {};
    const selection = isObject(source.workbenchSelection) ? source.workbenchSelection : {};
    const project = { ...source,
      workbenchSchemaVersion: Math.max(WORKBENCH_SCHEMA_VERSION, Number.isInteger(source.workbenchSchemaVersion) ? source.workbenchSchemaVersion : 1),
      workbenchRevision: Number.isInteger(source.workbenchRevision) && source.workbenchRevision >= 0 ? source.workbenchRevision : 0,
      workbenchContents: list(source.workbenchContents, normalizeWorkbenchContent, "工作台内容"),
      workbenchCanvases: list(source.workbenchCanvases, normalizeWorkbenchCanvas, "工作台画布"),
      workbenchPromptRounds: list(source.workbenchPromptRounds, normalizeWorkbenchPromptRound, "提示词轮次"),
      workbenchDraft: normalizeWorkbenchDraft(source.workbenchDraft),
      workbenchSelection: { ...selection, items: list(selection.items, normalizeSelection, "本轮素材选择"), layoutIntent: layoutIntent(selection.layoutIntent) },
      workbenchLegacyRefs: list(source.workbenchLegacyRefs, item => ({ ...item, collection: text(item.collection), sourceId: text(item.sourceId) }), "旧记录关联"),
      workbenchDraftStatus: text(source.workbenchDraftStatus), workbenchSaveError: text(source.workbenchSaveError) };
    assertReferences(project);
    return project;
  }

  function migrateWorkbenchProject(project, legacyRecords = []) {
    const source = isObject(project) ? project : {};
    const refs = new Map((Array.isArray(source.workbenchLegacyRefs) ? source.workbenchLegacyRefs : [])
      .filter(ref => isObject(ref) && text(ref.collection) && text(ref.sourceId))
      .map(ref => [JSON.stringify([ref.collection, ref.sourceId]), ref]));
    for (const record of legacyRecords) {
      if (!isObject(record) || !text(record.collection) || !text(record.sourceId)) throw new TypeError("旧记录须明确提供 collection 和 sourceId");
      refs.set(JSON.stringify([record.collection, record.sourceId]), { collection: record.collection, sourceId: record.sourceId });
    }
    return normalizeWorkbenchProject({ ...source, workbenchLegacyRefs: [...refs.values()] });
  }

  return { WORKBENCH_SCHEMA_VERSION, normalizeWorkbenchProject, normalizeWorkbenchContent, normalizeWorkbenchContentVersion,
    normalizeWorkbenchCanvas, normalizeWorkbenchCanvasNode, normalizeWorkbenchPromptRound, migrateWorkbenchProject };
});
