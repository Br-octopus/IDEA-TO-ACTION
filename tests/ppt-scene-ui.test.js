const test = require('node:test');
const assert = require('node:assert/strict');
const sceneSchema = require('../prototype/ppt-scene-schema.js');
const taskSchema = require('../prototype/prompt-agent-schema.js');
const { createPptSceneUI } = require('../prototype/ppt-scene-ui.js');

function fixture() {
  const handlers = {};
  const mount = {
    innerHTML: '',
    addEventListener(type, handler) { handlers[type] = handler; },
    querySelectorAll() { return []; }
  };
  const task = {
    ...taskSchema.createPromptAgentTask({ id: 'ui-task', goal: '<img src=x onerror=alert(1)>' }),
    pptScene: sceneSchema.normalizePptScene({
      brief: { idea: '<script>brief</script>', facts: ['<b>已知</b>'], assumptions: ['<i>假设</i>'], hardRequirements: ['保留事实'], preferences: ['简洁'] },
      status: 'needs-review', stage: 'outline-review', outlineStatus: 'needs-review',
      route: { selected: 'undecided', recommended: 'native-ppt' },
      sources: [{ id: 'source-1', title: '<svg onload=alert(1)>', summary: '<script>摘要</script>' }],
      outline: { title: '流程', storyLine: '先说明，再行动', slides: [{ id: 'o1', page: 1, title: '起点', claim: '来源主张', sourceIds: ['source-1'], evidenceStatus: 'cited' }] },
      draft: { title: '逐页稿', slides: [{ id: 's1', page: 1, title: '页面标题', body: ['页面文案'], visualDescription: '视觉说明', sourceIds: ['source-1'] }] }
    })
  };
  const state = { promptAgentTasks: [task] };
  const calls = [];
  const coordinator = {
    getStagePrompt: (current, stage) => `当前提示词 ${stage} ${current.pptScene.brief.idea}`,
    approveOutline(current) { calls.push('approve'); return { ...current, pptScene: { ...current.pptScene, outlineStatus: 'approved' } }; },
    chooseRoute(current, route) { calls.push(['route', route]); return { ...current, pptScene: { ...current.pptScene, route: { ...current.pptScene.route, selected: route }, brief: { ...current.pptScene.brief, route } } }; },
    setSlideDisposition(current, id, disposition, reason) { calls.push(['disposition', id, disposition, reason]); return current; },
    editSlide(current, id, patch) { calls.push(['edit', id, patch]); return current; }
  };
  const document = { getElementById: id => id === 'ppt-scene-root' ? mount : null };
  const ui = createPptSceneUI({ document, coordinator, sceneSchema, taskSchema, getState: () => state, persistState: next => Object.assign(state, next), copyText: async () => {} });
  return { handlers, mount, task, state, calls, ui };
}

test('工作台展示简报分类、大纲故事线、页数依据、逐页内容、路线和当前提示词', () => {
  const { mount, ui } = fixture();
  ui.render();

  for (const label of ['演示简报', '已知事实', '当前假设', '待确认', '硬性要求', '偏好', '故事线', '推荐页数依据', '逐页文稿', '视觉说明', '来源', '路线比较', '当前阶段提示词']) {
    assert.ok(mount.innerHTML.includes(label), `工作台应显示${label}`);
  }
  assert.match(mount.innerHTML, /data-ppt-action="approve-outline"/);
  assert.match(mount.innerHTML, /data-ppt-action="choose-route"/);
  assert.match(mount.innerHTML, /data-ppt-action="delete-slide"/);
  assert.match(mount.innerHTML, /data-ppt-delete-reason=/);
});

test('所有动态内容均转义，且工作台操作贯通大纲确认和路线选择', async () => {
  const { handlers, mount, calls, ui } = fixture();
  ui.render();

  assert.equal(mount.innerHTML.includes('<script>brief</script>'), false);
  assert.equal(mount.innerHTML.includes('<img src=x'), false);
  assert.equal(mount.innerHTML.includes('<svg onload='), false);
  assert.match(mount.innerHTML, /&lt;script&gt;brief&lt;\/script&gt;/);

  await handlers.click({ target: { dataset: { pptAction: 'approve-outline' }, closest() { return this; } } });
  await handlers.click({ target: { dataset: { pptAction: 'choose-route', route: 'native-ppt' }, closest() { return this; } } });
  assert.deepEqual(calls, ['approve', ['route', 'native-ppt']]);
});

test('页面支持保留、修改和带原因删除，并在模型失败时显示已有草稿', async () => {
  const { handlers, calls, ui } = fixture();
  ui.render();

  await handlers.click({ target: { dataset: { pptAction: 'keep-slide', slideId: 's1' }, closest() { return this; } } });
  await handlers.click({ target: { dataset: { pptAction: 'edit-slide', slideId: 's1', field: 'title', value: '修订标题' }, closest() { return this; } } });
  await handlers.click({ target: { dataset: { pptAction: 'delete-slide', slideId: 's1', reason: '已被新流程替代' }, closest() { return this; } } });

  assert.ok(calls.some(call => Array.isArray(call) && call[2] === 'keep'));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'edit' && call[2].title === '修订标题'));
  assert.ok(calls.some(call => Array.isArray(call) && call[2] === 'deleted' && call[3] === '已被新流程替代'));
});
