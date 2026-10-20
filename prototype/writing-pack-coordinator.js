(function (root, factory) {
  const schema = typeof module === 'object' && module.exports && typeof require === 'function'
    ? require('./writing-pack-schema.js')
    : root.WritingPackSchema;
  const api = factory(schema);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WritingPackCoordinator = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (schema) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  let sequence = 0;
  const defaultNewId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`}`;
  function failure(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

  // 读写写作专业基础包集合；内置包来自 builtinCatalog，不可通过本协调器改写。
  // 自定义包存于 state.writingPacks，启停设置存于 state.writingPackSettings。
  function createWritingPackCoordinator(dependencies = {}, options = {}) {
    const getState = dependencies.getState || (() => ({}));
    const persistState = typeof dependencies.persistState === 'function' ? dependencies.persistState : null;
    const builtinCatalog = Array.isArray(dependencies.builtinCatalog) ? dependencies.builtinCatalog : [];
    const nowFn = dependencies.now || now;
    const newId = dependencies.newId || defaultNewId;
    const { failWrite = false } = options;
    let persistence = Promise.resolve();

    function builtinById(id) { return builtinCatalog.find(p => p.id === id); }
    function customPacks() { return schema.normalizeWritingPackCollection(state().writingPacks || []); }
    function settings() { return (state().writingPackSettings || []).map(s => schema.normalizeWritingPackSettings(s)); }
    function state() { return getState() || {}; }

    function requirePersist() {
      if (!persistState) throw failure('PERSIST_UNAVAILABLE', '未配置持久化依赖，写操作不可用');
    }

    // 串行持久化：任何写入排队执行，失败时抛错且不改变调用方内存状态。
    function commit(mutate) {
      requirePersist();
      const run = persistence.then(() => {
        if (failWrite) throw failure('PERSIST_FAILED', '磁盘写入失败');
        const s = state();
        const next = copy(s);
        mutate(next);
        return Promise.resolve(persistState(next)).then(saved => {
          if (saved && typeof saved === 'object') Object.assign(s, saved);
          return null;
        });
      });
      persistence = run.catch(() => {});
      return run.then(() => null);
    }

    function findCustom(id) {
      const packs = customPacks();
      const pack = packs.find(p => p.id === id);
      if (pack) return { pack, packs };
      return null;
    }

    function effectivePack(pack) {
      const setting = settings().find(s => s.id === pack.id);
      return copy({ ...pack, enabled: setting ? setting.enabled : pack.enabled !== false });
    }

    function listPacks() {
      const result = [];
      for (const builtin of builtinCatalog) {
        const setting = settings().find(s => s.id === builtin.id);
        result.push({ ...copy(builtin), enabled: setting ? setting.enabled : builtin.enabled !== false });
      }
      for (const pack of customPacks()) {
        result.push(effectivePack(pack));
      }
      return result;
    }

    function getPack(id) {
      const found = listPacks().find(p => p.id === id);
      return found ? copy(found) : null;
    }

    function getSelection() {
      return { selectedIds: listPacks().filter(p => p.enabled !== false).map(p => p.id) };
    }

    function assertMutable(id) {
      if (builtinById(id)) throw failure('BUILTIN_IMMUTABLE', '内置包不可原地修改', { packId: id });
      if (!findCustom(id)) throw failure('PACK_NOT_FOUND', '自定义包不存在', { packId: id });
    }

    async function selectPacks(ids) {
      return commit(next => {
        const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
        next.writingPackSettings = listPacks()
          .filter(p => wanted.has(p.id) ? !p.enabled : p.enabled)
          .map(p => ({ id: p.id, enabled: wanted.has(p.id), updatedAt: nowFn() }))
          .concat((next.writingPackSettings || []).filter(s => listPacks().some(p => p.id === s.id) && wanted.has(s.id) === (s.enabled !== false) ? false : false));
      });
    }

    async function createPack(input) {
      const pack = schema.normalizeWritingPack({ ...copy(input), builtin: false, basePackId: '' });
      if (builtinById(pack.id) || findCustom(pack.id)) throw failure('PACK_COLLISION', `包 ID 已存在：${pack.id}`, { packId: pack.id });
      return commit(next => {
        next.writingPacks = [...(next.writingPacks || []), pack].slice(0, schema.WRITING_PACK_LIMITS.packs);
      }).then(() => copy({ ...pack, createdAt: pack.createdAt || nowFn(), updatedAt: nowFn() }));
    }

    async function duplicatePack(id) {
      const found = findCustom(id);
      if (!found) {
        const builtin = builtinById(id);
        if (!builtin) throw failure('PACK_NOT_FOUND', '包不存在', { packId: id });
        return duplicateFrom(copy(builtin), builtin.id);
      }
      return duplicateFrom(copy(found.pack), found.pack.basePackId || '');
    }

    function duplicateFrom(pack, baseId) {
      const clone = {
        ...pack,
        id: newId('pack'),
        name: `${pack.name || '副本'} 副本`,
        builtin: false,
        basePackId: baseId,
        enabled: true,
        version: 1,
        createdAt: nowFn(),
        updatedAt: nowFn()
      };
      const normalized = schema.normalizeWritingPack(clone);
      return commit(next => {
        if (findCustom(normalized.id)) throw failure('PACK_COLLISION', `包 ID 已存在：${normalized.id}`, { packId: normalized.id });
        next.writingPacks = [...(next.writingPacks || []), normalized];
      }).then(() => copy(normalized));
    }

    async function updatePack(id, changes) {
      const builtin = builtinById(id);
      if (builtin) {
        // 内置包编辑：不改写内置数据，而是生成带 basePackId 的自定义副本。
        const overrideInput = {
          ...copy(builtin),
          ...copy(isObject(changes) ? changes : {}),
          id: newId('pack'),
          builtin: false,
          basePackId: builtin.id,
          enabled: true,
          createdAt: nowFn(),
          updatedAt: nowFn()
        };
        const normalized = schema.normalizeWritingPack(overrideInput);
        return commit(next => {
          const existing = (next.writingPacks || []).find(p => p.basePackId === builtin.id);
          next.writingPacks = existing
            ? (next.writingPacks || []).map(p => (p.basePackId === builtin.id ? normalized : p))
            : [...(next.writingPacks || []), normalized];
        }).then(() => copy(normalized));
      }
      assertMutable(id);
      const updated = schema.normalizeWritingPack({
        ...copy(findCustom(id).pack),
        ...copy(isObject(changes) ? changes : {}),
        id,
        builtin: false,
        updatedAt: nowFn()
      });
      return commit(next => {
        next.writingPacks = (next.writingPacks || []).map(p => (p.id === id ? updated : p));
      }).then(() => copy(updated));
    }

    async function setPackEnabled(id, enabled) {
      const value = enabled !== false;
      if (!builtinById(id) && !findCustom(id)) throw failure('PACK_NOT_FOUND', '包不存在', { packId: id });
      return commit(next => {
        const list = (next.writingPackSettings || []).filter(s => s.id !== id);
        list.push({ id, enabled: value, updatedAt: nowFn() });
        next.writingPackSettings = list;
      }).then(() => getPack(id));
    }

    async function deletePack(id) {
      assertMutable(id);
      return commit(next => {
        next.writingPacks = (next.writingPacks || []).filter(p => p.id !== id);
        next.writingPackSettings = (next.writingPackSettings || []).filter(s => s.id !== id);
      });
    }

    async function restoreBuiltin(id) {
      if (!builtinById(id)) throw failure('PACK_NOT_FOUND', '内置包不存在', { packId: id });
      return commit(next => {
        next.writingPacks = (next.writingPacks || []).filter(p => p.basePackId !== id);
        next.writingPackSettings = (next.writingPackSettings || []).filter(s => s.id !== id);
      });
    }

    function previewImport(packs) {
      const input = Array.isArray(packs) ? packs : [];
      const normalized = input.map(item => schema.normalizeWritingPack(copy(item)));
      const collisions = normalized.map(p => p.id).filter(id => builtinById(id) || findCustom(id));
      return copy({ packs: normalized, collisions });
    }

    async function confirmImport(preview) {
      if (!isObject(preview) || !Array.isArray(preview.packs)) throw failure('IMPORT_INVALID', '导入预览无效');
      const normalized = preview.packs.map(item => schema.normalizeWritingPack(copy(item)));
      const collisions = normalized.map(p => p.id).filter(id => builtinById(id) || findCustom(id));
      if (collisions.length) throw failure('IMPORT_COLLISION', `导入包 ID 冲突：${collisions.join(', ')}`, { collisions });
      return commit(next => {
        next.writingPacks = [...(next.writingPacks || []), ...normalized];
      }).then(() => copy(normalized));
    }

    function exportPacks(ids) {
      const wanted = Array.isArray(ids) ? ids.map(String) : [];
      if (!wanted.length) throw failure('EXPORT_EMPTY', '请选择要导出的自定义包');
      const packs = [];
      for (const id of wanted) {
        if (builtinById(id)) throw failure('EXPORT_BUILTIN', '内置包不可导出', { packId: id });
        const found = findCustom(id);
        if (!found) throw failure('PACK_NOT_FOUND', '自定义包不存在', { packId: id });
        packs.push(copy(found.pack));
      }
      return packs;
    }

    return {
      listPacks, getPack, getSelection, selectPacks, createPack, duplicatePack,
      updatePack, setPackEnabled, deletePack, restoreBuiltin,
      previewImport, confirmImport, exportPacks
    };
  }

  return { createWritingPackCoordinator };
});

