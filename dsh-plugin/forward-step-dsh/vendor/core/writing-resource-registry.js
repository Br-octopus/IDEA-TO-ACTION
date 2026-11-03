(function (root, factory) {
  const api = factory(root.WritingPackSchema);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WritingResourceRegistry = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (packSchema) {
  'use strict';

  const KINDS = new Set(['script', 'template', 'example', 'reference']);
  const clone = value => JSON.parse(JSON.stringify(value));
  const list = value => Array.isArray(value) ? value : [];

  function matches(resource, genre, taskType) {
    if (!resource || resource.enabled === false || !KINDS.has(resource.kind)) return 'disabled';
    if (resource.genre && resource.genre !== genre) return 'genre-mismatch';
    const tasks = list(resource.taskTypes);
    if (tasks.length && !tasks.includes(taskType) && !tasks.includes('article')) return 'task-mismatch';
    return '';
  }

  function selectWritingResources({ packs = [], selectedIds = [], genre = 'article', taskType = 'revision', snapshot } = {}) {
    const requested = new Set(list(selectedIds).filter(id => typeof id === 'string' && id.trim()));
    const candidates = snapshot && Array.isArray(snapshot.resources)
      ? snapshot.resources
      : packs.filter(pack => !requested.size || requested.has(pack.id)).flatMap(pack =>
        list(pack.resources).map(resource => ({ ...resource, packId: pack.id, packVersion: pack.version, packName: pack.name })));
    const resources = [];
    const skipped = [];
    const seen = new Set();
    for (const input of candidates) {
      const resource = { ...input };
      const id = String(resource.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const reason = matches(resource, genre, taskType);
      if (reason) { skipped.push({ id, kind: resource.kind || '', reason }); continue; }
      if (!resource.relativePath) { skipped.push({ id, kind: resource.kind || '', reason: 'missing-path' }); continue; }
      resources.push(resource);
    }
    return {
      resources: resources.map(clone),
      skipped: skipped.map(clone),
      unavailable: []
    };
  }

  function snapshotResources(resources = []) {
    const values = list(resources).map(resource => ({ ...resource }));
    if (packSchema?.normalizeWritingPack) {
      try {
        return packSchema.normalizeWritingPack({ id: 'resource-snapshot', name: 'resource-snapshot', resources: values }).resources;
      } catch {}
    }
    return values.map(resource => clone(resource));
  }

  function resourcePromptLines(selection = {}) {
    const resources = list(selection.resources);
    const byKind = kind => resources.filter(resource => resource.kind === kind);
    const lines = [];
    for (const [kind, label] of [['script', '受控脚本能力'], ['template', '模板参考'], ['example', '示例参考'], ['reference', '原始参考资料']]) {
      const items = byKind(kind);
      if (!items.length) continue;
      lines.push(`${label}（只按需加载，不能替代用户事实）：` + items.map(resource => {
        const detail = [resource.title, resource.summary, resource.format ? `格式：${resource.format}` : '', resource.actionId ? `动作：${resource.actionId}` : '']
          .filter(Boolean).join('；');
        return `${resource.id}：${detail}；来源状态：${resource.verificationStatus || 'unverified'}；仅供${kind === 'example' ? '表达/格式' : '当前任务'}参考`;
      }).join('\n'));
    }
    if (selection.skipped?.length) lines.push(`未加载资源：${selection.skipped.map(item => `${item.id}（${item.reason}）`).join('、')}`);
    if (selection.unavailable?.length) lines.push(`不可用资源：${selection.unavailable.map(item => `${item.id}（${item.reason}）`).join('、')}`);
    return lines.join('\n');
  }

  async function loadResourceExcerpt(resource, read, limit = 2400) {
    if (!resource || typeof read !== 'function') return { status: 'unavailable', reason: '没有提供受控资源读取器' };
    try {
      const result = await read({ resourceId: resource.id, archive: resource.archive, relativePath: resource.relativePath, limit });
      const content = String(result?.content || result?.text || '').slice(0, limit);
      if (!content) return { status: 'unavailable', reason: result?.reason || '资源没有可读片段' };
      return { status: 'used', content, truncated: content.length >= limit };
    } catch (error) {
      return { status: 'unavailable', reason: error?.message || '资源读取失败' };
    }
  }

  return { KINDS: [...KINDS], selectWritingResources, snapshotResources, resourcePromptLines, loadResourceExcerpt };
});
