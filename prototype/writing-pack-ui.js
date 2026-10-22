(function (root, factory) {
  const coordinator = typeof module === 'object' && module.exports && typeof require === 'function'
    ? require('./writing-pack-coordinator.js')
    : root.WritingPackCoordinator;
  const api = factory(coordinator);
  if (typeof module === 'object') module.exports = api;
  else root.WritingPackUI = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (coordinatorModule) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CONTENT_FIELDS = [
    'applicability', 'targetFields', 'memoryNamespace', 'checkDimensions', 'outputRequirements',
    'riskReminders', 'styleBaseline', 'clarifications', 'materials', 'requirements', 'methods',
    'prompts', 'structures', 'style', 'terminology', 'evidenceRules', 'routes', 'checks',
    'repairs', 'nextSteps', 'examples', 'sources'
  ];

  // 专业基础包管理区：渲染真实控件并委托点击到协调器方法。
  function createWritingPackUI({ document, packCoordinator, getState, confirm = message => globalThis.confirm(message), notify = () => {}, copyText = async () => {} } = {}) {
    const mount = document?.getElementById('writing-workbench-root');
    if (!mount || !packCoordinator || typeof getState !== 'function') throw new TypeError('包管理缺少必要依赖');
    let open = false;
    let editing = null; // { basePack: boolean, packId?: string, form: {...} }
    let detailId = '';
    let importDraft = null;
    let updatePreview = null;
    let itemEditing = null;

    const IMPORT_COLLECTIONS = [
      ['methods', '方法'], ['prompts', '提示词'], ['structures', '结构'], ['requirements', '要求'],
      ['evidenceRules', '证据规则'], ['routes', '路线'], ['checks', '检查项'], ['repairs', '修复策略'], ['examples', '案例']
    ];

    function importSummary(pack) {
      const base = pack.basePackId ? packCoordinator.getPack(pack.basePackId) : null;
      const changes = IMPORT_COLLECTIONS.map(([field, label]) => {
        const incoming = pack[field] || [];
        const existingById = new Map((base?.[field] || []).map(item => [item.id, item]));
        let added = 0;
        let changed = 0;
        for (const item of incoming) {
          const old = existingById.get(item.id);
          if (!old) added++;
          else if (JSON.stringify(old) !== JSON.stringify(item)) changed++;
          existingById.delete(item.id);
        }
        const removed = existingById.size;
        return { label, added, changed, removed, count: incoming.length };
      }).filter(item => item.count || item.added || item.changed || item.removed);
      return { base, changes };
    }

    function renderImport() {
      if (!importDraft) return '';
      const preview = importDraft.preview;
      const previewMarkup = preview ? `
        <div class="pack-import-preview" aria-live="polite">
          <h3>导入预览 · ${preview.packs.length} 个包</h3>
          ${preview.collisions.length ? `<p role="alert">ID 冲突：${escape(preview.collisions.join('、'))}。请先修改 ID 或取消导入。</p>` : ''}
          ${preview.packs.map(pack => {
            const { base, changes } = importSummary(pack);
            const sources = (pack.sources || []).map(source => `<li><strong>${escape(source.title || source.id)}</strong> · ${escape(source.locator || '未提供定位')} · 版本 ${escape(source.version || '未提供')} · 许可 ${escape(source.license || '未说明')} · 适用 ${escape(source.applicability || '未说明')} · ${escape(source.limitations || '未说明限制')} · 导入后状态：未核验</li>`).join('');
            const diff = changes.map(item => `<li>${escape(item.label)}：${item.count} 项；相对${base ? '内置基础包' : '空白包'}新增 ${item.added}、变更 ${item.changed}、未包含 ${item.removed}</li>`).join('');
            return `<article class="pack-import-item"><h4>${escape(pack.name || pack.id)} <small>v${escape(pack.version)} · ${escape(layerLabel(pack))} · ${escape(pack.genre || pack.taskType || '未限定文体/任务')}</small></h4>
              <p>ID：${escape(pack.id)} · 覆盖对象：${base ? `${escape(base.name)} (${escape(base.id)}) 的自定义副本` : '新增自定义包'} · 适用范围：${escape(pack.applicability?.description || '未说明')}</p>
              <p>范围细节：任务 ${escape((pack.applicability?.tasks || []).join('、') || '未说明')}；语言 ${escape((pack.applicability?.languages || []).join('、') || '未说明')}；排除 ${escape((pack.applicability?.exclusions || []).join('、') || '未说明')}</p>
              <ul>${sources || '<li>未提供来源；包内容仍需审查。</li>'}</ul>
              <ul>${diff || '<li>未包含可比较的规则集合。</li>'}</ul>
            </article>`;
          }).join('')}
          <p>导入的来源、方法和规则核验状态会统一降为“未核验”；此预览不构成专业审查。</p>
        </div>` : '';
      return `<section class="pack-import" aria-labelledby="pack-import-title">
        <h3 id="pack-import-title">导入专业基础包</h3>
        <label class="field" for="pack-import-json"><span class="field-label">包 JSON（数组或单个包对象）</span>
          <textarea id="pack-import-json" data-action-input="pack-import-json" spellcheck="false" aria-describedby="pack-import-help">${escape(importDraft.raw)}</textarea>
        </label>
        <small id="pack-import-help">预览会显示来源、许可、适用范围、版本、覆盖对象和规则差异。ID 冲突时不会导入。</small>
        ${importDraft.error ? `<p role="alert">${escape(importDraft.error)}</p>` : ''}
        <div class="pack-actions">
          <button type="button" data-action="pack-import-preview">预览导入</button>
          ${preview ? `<button type="button" data-action="pack-import-confirm"${preview.collisions.length ? ' disabled' : ''}>确认导入</button>` : ''}
          <button type="button" data-action="pack-import-cancel">取消</button>
        </div>
        ${previewMarkup}
      </section>`;
    }

    function layerLabel(p) {
      return p.layer === 'core' ? '核心' : p.layer === 'genre' ? '文体' : '任务';
    }
    function sourceLabel(p) {
      if (p.builtin === true) return '内置';
      if (p.basePackId) return '内置副本';
      return '自定义';
    }
    function verificationSummary(p) {
      const items = [...(p.checks || []), ...(p.style || []), ...(p.prompts || [])];
      if (!items.length) return '无验证项';
      const unverified = items.filter(i => !i.verificationStatus || i.verificationStatus === 'unverified').length;
      if (unverified === 0) return '全部已核验';
      return `未核验 ${unverified}/${items.length}`;
    }

    function render() {
      refreshWorkbench();
    }

    function renderManager() {
      if (!open) return '';
      const packs = packCoordinator.listPacks();
      const selection = packCoordinator.getSelection();
      const rows = packs.map(p => {
        const selected = selection.selectedIds.includes(p.id);
        const editable = p.builtin !== true;
        const ver = verificationSummary(p);
        const update = p.builtin === true && typeof packCoordinator.previewBuiltinUpdate === 'function'
          ? packCoordinator.previewBuiltinUpdate(p.id) : null;
        const src = sourceLabel(p);
        const actions = [
          `<button type="button" data-action="pack-detail" data-pack-id="${escape(p.id)}">${detailId === p.id ? '收起详情' : '详情'}</button>`,
          `<button type="button" data-action="pack-edit" data-pack-id="${escape(p.id)}">编辑</button>`,
          `<button type="button" data-action="pack-duplicate" data-pack-id="${escape(p.id)}">复制</button>`,
          `<button type="button" data-action="pack-toggle" data-pack-id="${escape(p.id)}">${selected ? '停用' : '启用'}</button>`
        ];
        if (update?.available) actions.push(`<button type="button" data-action="pack-update-preview" data-pack-id="${escape(p.id)}">查看更新 v${escape(update.latestVersion)}</button>`);
        if (p.basePackId || p.builtin === true) actions.push(`<button type="button" data-action="pack-restore" data-pack-id="${escape(p.basePackId || p.id)}">恢复内置</button>`);
        if (editable) actions.push(`<button type="button" data-action="pack-delete" data-pack-id="${escape(p.id)}">删除</button>`);
        const sources = (p.sources || []).map(s => `<li>
          <strong>${escape(s.title || s.id)}</strong>
          <span>定位：${escape(s.locator || '未提供')}</span>
          <span>URL：${escape(s.url || '未提供')}</span>
          <span>版本：${escape(s.version || '未提供')}</span>
          <span>固定版本/摘要：${escape(s.versionHash || '未提供')}；读取日期：${escape(s.readAt || '未记录')}</span>
          <span>许可：${escape(s.license || '未说明')}</span>
          <span>采用理由：${escape(s.adoptionReason || '未记录')}；审查记录：${escape(s.reviewRecord || '未记录')}</span>
          <span>适用范围：${escape(s.applicability || '未说明')}</span>
          <span>限制：${escape(s.limitations || '未说明')}</span>
          <span>检查日期：${escape(s.checkedAt || '未记录')}；验证：${escape(s.verificationStatus || 'unverified')}</span>
        </li>`).join('');
        const detail = detailId === p.id ? `
          <div class="pack-detail">
            <p>版本：${escape(p.version)}；适用：${escape(p.applicability?.description || '未描述')}；限制：${escape((p.applicability?.exclusions || []).join('；') || '无')}</p>
            ${['methods','prompts','requirements','checks','style','evidenceRules','repairs','nextSteps','structures','terminology','routes'].map(field => {
              const entries = p[field] || [];
              if (!entries.length) return '';
              return `<section><h4>${escape(field)}</h4><ul>${entries.map(item => {
                const isEditing = itemEditing?.packId === p.id && itemEditing.field === field && itemEditing.itemId === item.id;
                const editableFields = Object.entries(item).filter(([key, value]) => key !== 'id' && key !== 'verificationStatus'
                  && typeof value === 'string' && value);
                return `<li>${escape(item.title || item.statement || item.content || item.term || item.id)} · ${item.enabled === false ? '已停用' : '启用'}
                  <button type="button" data-action="pack-item-edit" data-pack-id="${escape(p.id)}" data-pack-field="${field}" data-item-id="${escape(item.id)}">编辑此项</button>
                  <button type="button" data-action="pack-item-toggle" data-pack-id="${escape(p.id)}" data-pack-field="${field}" data-item-id="${escape(item.id)}">${item.enabled === false ? '启用此项' : '停用此项'}</button>
                  ${isEditing ? `<div class="pack-item-editor">${editableFields.map(([key]) => `<label>${escape(key)}<textarea data-pack-item-field="${key}">${escape(itemEditing.draft[key] ?? '')}</textarea></label>`).join('')}<button type="button" data-action="pack-item-save">保存此项</button><button type="button" data-action="pack-item-cancel">取消</button></div>` : ''}
                </li>`;
              }).join('')}</ul></section>`;
            }).join('')}
            <ul>${sources || '<li>无来源记录</li>'}</ul>
            ${updatePreview?.id === p.id ? `<section class="pack-update-preview"><h4>更新预览 v${escape(updatePreview.currentVersion)} → v${escape(updatePreview.latestVersion)}</h4><ul>${updatePreview.changes.map(change => `<li>${escape(change.field)}：新增 ${change.added}、修改 ${change.changed}、移除 ${change.removed}</li>`).join('') || '<li>字段无变化，版本号已更新</li>'}</ul><p>接受后只记录当前内置版本为后续新轮基线；现有用户副本与历史轮次快照保留。</p><button type="button" data-action="pack-update-accept" data-pack-id="${escape(p.id)}">接受此更新</button><button type="button" data-action="pack-update-cancel">取消</button></section>` : ''}
          </div>` : '';
        return `
          <div class="pack-row" data-pack-id="${escape(p.id)}">
            <strong>${escape(p.name || p.id)}</strong>
            <span>${layerLabel(p)} · ${escape(p.genre || p.taskType || '')} · ${src} · ${ver} · ${selected ? '已选用' : '未选用'}</span>
            <div class="pack-actions">${actions.join('')}</div>
            ${detail}
          </div>`;
      }).join('');
      const editor = editing ? renderEditor() : '';
      return `
        <section class="writing-pack-manager">
          <h2>专业基础包</h2>
          <div class="social-tools">
            <button type="button" data-action="pack-close">收起</button>
            <button type="button" data-action="pack-new">新增包</button>
            <button type="button" data-action="pack-import-open">导入</button>
            <button type="button" data-action="pack-export-open">导出</button>
          </div>
          ${renderImport()}
          ${editor}
          ${rows || '<p>暂无包。</p>'}
        </section>`;
    }

    let refreshWorkbench = () => {};

    mount.addEventListener('input', event => {
      if (itemEditing && event.target?.dataset?.packItemField) {
        itemEditing.draft[event.target.dataset.packItemField] = event.target.value;
        return;
      }
      if (event.target?.dataset?.actionInput === 'pack-import-json' && importDraft) {
        importDraft.raw = event.target.value;
        importDraft.preview = null;
        importDraft.error = '';
        return;
      }
      if (!editing || !event.target?.id?.startsWith('pack-field-')) return;
      const field = event.target.id.slice('pack-field-'.length);
      if (Object.hasOwn(editing.form, field)) {
        editing.form[field] = event.target.value;
        editing.changedFields.add(field);
      }
    });

    function renderEditor() {
      const f = editing.form;
      return `
        <form class="pack-editor" data-pack-editor>
          <h3>${editing.isNew ? '新增包' : editing.builtinBase ? '编辑内置包（生成副本）' : '编辑包'}</h3>
          ${editing.isNew ? `<input id="pack-field-id" name="id" placeholder="稳定 ID（字母、数字或短横线）" value="${escape(f.id)}" />` : ''}
          <input id="pack-field-name" name="name" placeholder="名称" value="${escape(f.name)}" />
          <label for="pack-field-layer">包层级</label>
          <select id="pack-field-layer" name="layer">
            <option value="core"${f.layer === 'core' ? ' selected' : ''}>核心层</option>
            <option value="genre"${f.layer === 'genre' ? ' selected' : ''}>文体层</option>
            <option value="task"${f.layer === 'task' ? ' selected' : ''}>任务层</option>
          </select>
          <input id="pack-field-genre" name="genre" placeholder="文体" value="${escape(f.genre)}" />
          <input id="pack-field-taskType" name="taskType" placeholder="任务类型" value="${escape(f.taskType)}" />
          <textarea id="pack-field-checks" name="checks" placeholder="每行一个检查项">${escape(f.checks)}</textarea>
          <label class="field">专业来源（每行：标题 | 文件/条目 | URL | 版本 | 固定版本/摘要 | 读取日期 | 许可 | 采用理由 | 审查记录 | 适用范围 | 限制）
            <textarea id="pack-field-sources" name="sources" placeholder="例如：写作指南 | 第 2 节 | https://example.org/guide | 2026-01 | sha256:… | 2026-01-20 | CC BY 4.0 | 适用于普通文章改稿 | 已核对官方版本 | 普通文章改稿 | 不用于事实核验">${escape(f.sources)}</textarea>
          </label>
          <label class="field" for="pack-field-content">完整包内容 JSON（方法、提示词、结构、证据规则、路线、案例和来源验证信息）
            <textarea id="pack-field-content" name="content" spellcheck="false" aria-describedby="pack-content-help">${escape(f.content)}</textarea>
          <small id="pack-content-help">仅接受 JSON 对象，字段按包 schema 校验，未知字段和凭证不会保存。条目可在详情中单独停用；修改 JSON 后以其中的完整内容为准；另有改动的名称、层级、文体、任务、检查项和来源文本优先。</small>
          </label>
          <button type="button" data-action="pack-save">保存</button>
          <button type="button" data-action="pack-cancel">取消</button>
        </form>`;
    }

    function toForm(pack) {
      const content = Object.fromEntries(CONTENT_FIELDS.map(field => [field, pack[field] ?? (Array.isArray(pack[field]) ? [] : {})]));
      return {
        id: pack.id || '',
        name: pack.name || '',
        layer: pack.layer || 'task',
        genre: pack.genre || '',
        taskType: pack.taskType || '',
        checks: (pack.checks || []).map(c => c.statement).join('\n'),
        sources: (pack.sources || []).map(source => [source.title, source.locator, source.url, source.version,
          source.versionHash, source.readAt, source.license, source.adoptionReason, source.reviewRecord,
          source.applicability, source.limitations].join(' | ')).join('\n'),
        content: JSON.stringify(content, null, 2)
      };
    }

    async function save() {
      const f = editing.form;
      let content;
      try {
        content = JSON.parse(f.content || '{}');
        if (!content || Array.isArray(content) || typeof content !== 'object') throw new TypeError('完整包内容必须是 JSON 对象');
      } catch (error) {
        notify(`包内容无效：${error.message}`);
        return;
      }
      const input = {
        ...content,
        ...(editing.isNew ? { id: f.id } : {}),
        name: f.name,
        layer: f.layer,
        genre: f.genre,
        taskType: f.taskType
      };
      if (editing.changedFields.has('sources')) {
        input.sources = f.sources.split('\n').map(line => line.trim()).filter(Boolean).map((line, i) => {
          const values = line.split('|').map(value => value.trim());
          const [title = '', locator = '', url = '', version = ''] = values;
          const [versionHash = '', readAt = '', license = '', adoptionReason = '', reviewRecord = '', applicability = '', limitations = ''] = values.length <= 7
            ? ['', '', values[4] || '', '', '', values[5] || '', values[6] || ''] : values.slice(4);
          return { id: `source-${i + 1}`, title, locator, url, version, versionHash, readAt, license, adoptionReason, reviewRecord, checkedAt: '待核验',
            applicability,
            limitations, verificationStatus: 'unverified' };
        });
      }
      if (editing.changedFields.has('checks')) {
        input.checks = f.checks.split('\n').map(s => s.trim()).filter(Boolean).map((statement, i) => ({
          id: `check-${i + 1}`, statement, sourceIds: (input.sources || []).map(source => source.id),
          verificationStatus: 'unverified'
        }));
      }
      try {
        if (editing.isNew) await packCoordinator.createPack(input);
        else if (editing.packId) await packCoordinator.updatePack(editing.packId, input);
        editing = null;
        notify('包已保存');
      } catch (error) {
        notify(`保存失败：${error.message}`);
      }
      refreshWorkbench();
    }

    async function handle(action, data) {
      if (action === 'pack-open') {
        open = true;
        render();
        if (typeof packCoordinator.initializeBuiltinBaselines === 'function') {
          packCoordinator.initializeBuiltinBaselines().then(render)
            .catch(error => notify(`初始化版本基线失败：${error.message}`));
        }
        return;
      }
      if (action === 'pack-close') { open = false; refreshWorkbench(); return; }
      if (action === 'pack-new') { editing = { isNew: true, form: toForm({}), changedFields: new Set() }; refreshWorkbench(); return; }
      if (action === 'pack-edit') {
        const pack = packCoordinator.getPack(data.packId);
        editing = { packId: data.packId, builtinBase: pack?.builtin === true, form: toForm(pack || {}), changedFields: new Set() };
        refreshWorkbench();
        return;
      }
      if (action === 'pack-cancel') { editing = null; refreshWorkbench(); return; }
      if (action === 'pack-save') { await save(); return; }
      if (action === 'pack-detail') { detailId = detailId === data.packId ? '' : data.packId; refreshWorkbench(); return; }
      if (action === 'pack-update-preview') {
        try { updatePreview = packCoordinator.previewBuiltinUpdate(data.packId); detailId = data.packId; }
        catch (error) { notify(`读取更新失败：${error.message}`); }
        refreshWorkbench(); return;
      }
      if (action === 'pack-update-cancel') { updatePreview = null; refreshWorkbench(); return; }
      if (action === 'pack-update-accept') {
        try { await packCoordinator.acceptBuiltinUpdate(data.packId); updatePreview = null; notify('已接受内置包更新；已有自定义副本与历史快照保留'); }
        catch (error) { notify(`接受更新失败：${error.message}`); }
        refreshWorkbench(); return;
      }
      if (action === 'pack-item-toggle') {
        const pack = packCoordinator.getPack(data.packId);
        const field = data.packField;
        const item = pack?.[field]?.find(entry => entry.id === data.itemId);
        if (!item || !Array.isArray(pack[field])) { notify('条目不存在'); return; }
        try {
          await packCoordinator.updatePack(data.packId, { [field]: pack[field].map(entry => entry.id === item.id ? { ...entry, enabled: entry.enabled === false } : entry) });
          notify(item.enabled === false ? '条目已启用' : '条目已停用');
        } catch (error) { notify(`操作失败：${error.message}`); }
        refreshWorkbench(); return;
      }
      if (action === 'pack-item-edit') {
        const pack = packCoordinator.getPack(data.packId);
        const item = pack?.[data.packField]?.find(entry => entry.id === data.itemId);
        if (!item) { notify('条目不存在'); return; }
        itemEditing = { packId: data.packId, field: data.packField, itemId: data.itemId, draft: { ...item } };
        refreshWorkbench(); return;
      }
      if (action === 'pack-item-cancel') { itemEditing = null; refreshWorkbench(); return; }
      if (action === 'pack-item-save') {
        const pack = packCoordinator.getPack(itemEditing?.packId);
        const draft = itemEditing;
        if (!pack || !draft) return;
        try {
          await packCoordinator.updatePack(draft.packId, { [draft.field]: pack[draft.field].map(item =>
            item.id === draft.itemId ? { ...item, ...draft.draft } : item) });
          itemEditing = null;
          notify('条目已保存；内容变更会重新标为未核验');
        } catch (error) { notify(`保存失败：${error.message}`); }
        refreshWorkbench(); return;
      }
      if (action === 'pack-duplicate') { try { await packCoordinator.duplicatePack(data.packId); notify('已复制'); } catch (error) { notify(`复制失败：${error.message}`); } refreshWorkbench(); return; }
      if (action === 'pack-toggle') {
        const pack = packCoordinator.getPack(data.packId);
        try { await packCoordinator.setPackEnabled(data.packId, !(pack?.enabled !== false)); notify(pack?.enabled !== false ? '已停用' : '已启用'); }
        catch (error) { notify(`操作失败：${error.message}`); }
        refreshWorkbench();
        return;
      }
      if (action === 'pack-restore') {
        if (!confirm('恢复内置包将丢弃该包的自定义副本，确定吗？')) return;
        try { await packCoordinator.restoreBuiltin(data.packId); notify('已恢复内置'); }
        catch (error) { notify(`恢复失败：${error.message}`); }
        refreshWorkbench();
        return;
      }
      if (action === 'pack-delete') {
        if (!confirm(`确定删除包 ${data.packId} 吗？此操作不可撤销。`)) return;
        try { await packCoordinator.deletePack(data.packId); notify('已删除'); }
        catch (error) { notify(`删除失败：${error.message}`); }
        refreshWorkbench();
        return;
      }
      if (action === 'pack-import-open') {
        importDraft = { raw: '', preview: null, error: '' };
        refreshWorkbench();
        return;
      }
      if (action === 'pack-import-cancel') {
        importDraft = null;
        refreshWorkbench();
        return;
      }
      if (action === 'pack-import-preview') {
        try {
          const parsed = JSON.parse(importDraft?.raw || '');
          importDraft.preview = packCoordinator.previewImport(Array.isArray(parsed) ? parsed : [parsed]);
          importDraft.error = importDraft.preview.packs.length ? '' : '没有可导入的包';
        } catch (error) { importDraft.error = `无法预览：${error.message}`; importDraft.preview = null; }
        refreshWorkbench();
        return;
      }
      if (action === 'pack-import-confirm') {
        if (!importDraft?.preview || importDraft.preview.collisions.length) return;
        try {
          await packCoordinator.confirmImport(importDraft.preview);
          notify(`导入成功：${importDraft.preview.packs.length} 个包；核验状态均为未核验`);
          importDraft = null;
        } catch (error) { importDraft.error = `导入失败：${error.message}`; }
        refreshWorkbench();
        return;
      }
      if (action === 'pack-export-open') {
        try {
          const packs = packCoordinator.listPacks().filter(p => p.builtin !== true);
          if (!packs.length) { notify('没有可导出的自定义包'); return; }
          const exported = packCoordinator.exportPacks(packs.map(p => p.id));
          await copyText(JSON.stringify(exported, null, 2));
          notify(`已导出 ${exported.length} 个包`);
        } catch (error) { notify(`导出失败：${error.message}`); }
        return;
      }
    }

    function getSelection() { return packCoordinator.getSelection(); }
    function getAvailablePacks() { return packCoordinator.listPacks(); }

    return {
      render,
      renderManager,
      connectWorkbenchRenderer(callback) { refreshWorkbench = typeof callback === 'function' ? callback : () => {}; },
      handle,
      getSelection,
      getAvailablePacks,
      get isOpen() { return open; }
    };
  }

  return { createWritingPackUI };
});
