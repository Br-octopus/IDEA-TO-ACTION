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

  // 专业基础包管理区：渲染真实控件并委托点击到协调器方法。
  function createWritingPackUI({ document, packCoordinator, getState, confirm = message => globalThis.confirm(message), notify = () => {}, copyText = async () => {} } = {}) {
    const mount = document?.getElementById('writing-workbench-root');
    if (!mount || !packCoordinator || typeof getState !== 'function') throw new TypeError('包管理缺少必要依赖');
    let open = false;
    let editing = null; // { basePack: boolean, packId?: string, form: {...} }
    let detailId = '';
    const state = () => getState() || {};

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
      if (!open) return;
      const packs = packCoordinator.listPacks();
      const selection = packCoordinator.getSelection();
      const rows = packs.map(p => {
        const selected = selection.selectedIds.includes(p.id);
        const editable = p.builtin !== true;
        const ver = verificationSummary(p);
        const src = sourceLabel(p);
        const actions = [
          `<button type="button" data-action="pack-detail" data-pack-id="${escape(p.id)}">${detailId === p.id ? '收起详情' : '详情'}</button>`,
          `<button type="button" data-action="pack-edit" data-pack-id="${escape(p.id)}">编辑</button>`,
          `<button type="button" data-action="pack-duplicate" data-pack-id="${escape(p.id)}">复制</button>`,
          `<button type="button" data-action="pack-toggle" data-pack-id="${escape(p.id)}">${selected ? '停用' : '启用'}</button>`
        ];
        if (p.basePackId || p.builtin === true) actions.push(`<button type="button" data-action="pack-restore" data-pack-id="${escape(p.id)}">恢复内置</button>`);
        if (editable) actions.push(`<button type="button" data-action="pack-delete" data-pack-id="${escape(p.id)}">删除</button>`);
        const sources = (p.sources || []).map(s => `<li>${escape(s.title || s.id)}：${escape(s.locator || '')}（${escape(s.verificationStatus || 'unverified')}）</li>`).join('');
        const detail = detailId === p.id ? `
          <div class="pack-detail">
            <p>版本：${escape(p.version)}；适用：${escape(p.applicability?.description || '未描述')}；限制：${escape((p.applicability?.exclusions || []).join('；') || '无')}</p>
            <ul>${sources || '<li>无来源记录</li>'}</ul>
          </div>` : '';
        return `
          <div class="pack-row" data-pack-id="${escape(p.id)}">
            <strong>${escape(p.name || p.id)}</strong>
            <span>${layerLabel(p)} · ${escape(p.genre || p.taskType || '')} · ${src} · ${ver} · ${selected ? '已选用' : '未选用'}</span>
            <div>${actions.join('')}</div>
            ${detail}
          </div>`;
      }).join('');
      const editor = editing ? renderEditor() : '';
      mount.innerHTML = `
        <section class="writing-pack-manager">
          <h2>专业基础包</h2>
          <div class="social-tools">
            <button type="button" data-action="pack-close">收起</button>
            <button type="button" data-action="pack-new">新增包</button>
            <button type="button" data-action="pack-import-open">导入</button>
            <button type="button" data-action="pack-export-open">导出</button>
          </div>
          ${editor}
          ${rows || '<p>暂无包。</p>'}
        </section>`;
    }

    function renderEditor() {
      const f = editing.form;
      return `
        <form class="pack-editor" data-pack-editor>
          <h3>${editing.isNew ? '新增包' : editing.builtinBase ? '编辑内置包（生成副本）' : '编辑包'}</h3>
          <input id="pack-field-name" name="name" placeholder="名称" value="${escape(f.name)}" />
          <input id="pack-field-genre" name="genre" placeholder="文体" value="${escape(f.genre)}" />
          <input id="pack-field-task" name="taskType" placeholder="任务类型" value="${escape(f.taskType)}" />
          <textarea id="pack-field-checks" name="checks" placeholder="每行一个检查项">${escape(f.checks)}</textarea>
          <button type="button" data-action="pack-save">保存</button>
          <button type="button" data-action="pack-cancel">取消</button>
        </form>`;
    }

    function toForm(pack) {
      return {
        name: pack.name || '',
        genre: pack.genre || '',
        taskType: pack.taskType || '',
        checks: (pack.checks || []).map(c => c.statement).join('\n')
      };
    }

    async function save() {
      const f = editing.form;
      const input = {
        name: f.name,
        genre: f.genre,
        taskType: f.taskType,
        layer: editing.builtinBase ? 'genre' : 'task',
        checks: f.checks.split('\n').map(s => s.trim()).filter(Boolean).map((statement, i) => ({
          id: `check-${i + 1}`, statement, sourceIds: [], verificationStatus: 'unverified'
        }))
      };
      try {
        if (editing.isNew) await packCoordinator.createPack(input);
        else if (editing.packId) await packCoordinator.updatePack(editing.packId, input);
        editing = null;
        notify('包已保存');
      } catch (error) {
        notify(`保存失败：${error.message}`);
      }
      render();
    }

    async function handle(action, data) {
      if (action === 'pack-open') { open = true; render(); return; }
      if (action === 'pack-close') { open = false; mount.innerHTML = ''; return; }
      if (action === 'pack-new') { editing = { isNew: true, form: toForm({}) }; render(); return; }
      if (action === 'pack-edit') {
        const pack = packCoordinator.getPack(data.packId);
        editing = { packId: data.packId, builtinBase: pack?.builtin === true, form: toForm(pack || {}) };
        render();
        return;
      }
      if (action === 'pack-cancel') { editing = null; render(); return; }
      if (action === 'pack-save') { await save(); return; }
      if (action === 'pack-detail') { detailId = detailId === data.packId ? '' : data.packId; render(); return; }
      if (action === 'pack-duplicate') { try { await packCoordinator.duplicatePack(data.packId); notify('已复制'); } catch (error) { notify(`复制失败：${error.message}`); } render(); return; }
      if (action === 'pack-toggle') {
        const pack = packCoordinator.getPack(data.packId);
        try { await packCoordinator.setPackEnabled(data.packId, !(pack?.enabled !== false)); notify(pack?.enabled !== false ? '已停用' : '已启用'); }
        catch (error) { notify(`操作失败：${error.message}`); }
        render();
        return;
      }
      if (action === 'pack-restore') {
        if (!confirm('恢复内置包将丢弃该包的自定义副本，确定吗？')) return;
        try { await packCoordinator.restoreBuiltin(data.packId); notify('已恢复内置'); }
        catch (error) { notify(`恢复失败：${error.message}`); }
        render();
        return;
      }
      if (action === 'pack-delete') {
        if (!confirm(`确定删除包 ${data.packId} 吗？此操作不可撤销。`)) return;
        try { await packCoordinator.deletePack(data.packId); notify('已删除'); }
        catch (error) { notify(`删除失败：${error.message}`); }
        render();
        return;
      }
      if (action === 'pack-import-open') {
        const raw = prompt('粘贴要导入的包 JSON 数组');
        if (!raw) return;
        try {
          const packs = JSON.parse(raw);
          const preview = packCoordinator.previewImport(packs);
          if (preview.collisions.length) { notify(`导入冲突：${preview.collisions.join(', ')}`); return; }
          if (!confirm(`将导入 ${preview.packs.length} 个包，确认保存吗？`)) { notify('已取消导入'); return; }
          await packCoordinator.confirmImport(preview);
          notify('导入成功');
        } catch (error) { notify(`导入失败：${error.message}`); }
        render();
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

    mount.addEventListener('click', async event => {
      const target = event.target?.closest?.('[data-action]');
      if (!target || target.disabled) return;
      event.preventDefault();
      await handle(target.dataset.action, target.dataset);
    });
    return { render, handle, getSelection, get isOpen() { return open; } };
  }

  return { createWritingPackUI };
});
