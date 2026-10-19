const test = require('node:test');
const assert = require('node:assert/strict');
const sceneSchema = require('../prototype/ppt-scene-schema.js');
const taskSchema = require('../prototype/prompt-agent-schema.js');
const { createPptSceneUI } = require('../prototype/ppt-scene-ui.js');

function fixture() {
  const handlers = {};
  const controls = [
    ...['idea', 'audience', 'audienceAction', 'assumptions', 'hardRequirements', 'preferences'].map(key => ({ dataset: { brief: key }, value: key === 'idea' ? '<script>brief</script>' : '' })),
    ...['minSlides', 'maxSlides', 'maxWordsPerSlide'].map(key => ({ dataset: { pptConstraint: key }, value: key === 'minSlides' ? '2' : key === 'maxSlides' ? '6' : '40' })),
    { dataset: { slideEdit: 'title', slideId: 's1' }, value: '页面标题' },
    { dataset: { slideEdit: 'body', slideId: 's1' }, value: '<img src=x onerror=alert(2)>' },
    { dataset: { slideEdit: 'visualDescription', slideId: 's1' }, value: '<svg onload=alert(3)>' }
  ];
  const mount = {
    innerHTML: '',
    addEventListener(type, handler) { handlers[type] = handler; },
    querySelectorAll(selector) {
      if (selector === '[data-brief]') return controls.filter(node => node.dataset.brief);
      if (selector === '[data-ppt-constraint]') return controls.filter(node => node.dataset.pptConstraint);
      if (selector === '[data-slide-edit]') return controls.filter(node => node.dataset.slideEdit);
      return [];
    }
  };
  const task = {
    ...taskSchema.createPromptAgentTask({ id: 'ui-task', goal: '<img src=x onerror=alert(1)>' }),
    pptScene: sceneSchema.normalizePptScene({
      status: 'needs-review', stage: 'outline-review', outlineStatus: 'needs-review',
      route: { selected: 'undecided', recommended: 'native-ppt' },
      sources: [{ id: 'source-1', title: '<svg onload=alert(1)>', summary: '<script>摘要</script>' }],
      outline: { title: '流程', storyLine: '先说明，再行动', slides: [{ id: 'o1', page: 1, title: '起点', claim: '来源主张', sourceIds: ['source-1'], evidenceStatus: 'cited' }] },
      brief: { idea: '<script>brief</script>', facts: ['<b>已知</b>'], assumptions: ['<i>假设</i>'], hardRequirements: ['保留事实'], preferences: ['简洁'], constraints: { minSlides: 2, maxSlides: 6, maxWordsPerSlide: 40 } },
      draft: { title: '逐页稿', slides: [{ id: 's1', page: 1, title: '页面标题', body: ['<img src=x onerror=alert(1)>'], visualDescription: '<svg onload=alert(1)>', sourceIds: ['source-1'] }] }
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
  return { handlers, mount, task, state, calls, controls, ui };
}

test('工作台展示简报分类、大纲故事线、页数依据、逐页内容、路线和当前提示词', () => {
  const { mount, ui } = fixture();
  ui.render();

  for (const label of ['演示简报', '已知事实', '当前假设', '待确认', '硬性要求', '偏好', '硬性约束', '最少页数', '最多页数', '每页最多字数', '故事线', '推荐页数依据', '逐页文稿', '页面文案', '视觉说明', '来源', '路线比较', '当前阶段提示词']) {
    assert.ok(mount.innerHTML.includes(label), `工作台应显示${label}`);
  }
  for (const key of ['minSlides', 'maxSlides', 'maxWordsPerSlide']) assert.match(mount.innerHTML, new RegExp(`data-ppt-constraint="${key}"`));
  assert.match(mount.innerHTML, /data-ppt-action="approve-outline"/);
  assert.match(mount.innerHTML, /data-ppt-action="choose-route"/);
  for (const title of ['原生可编辑 PPT', '图片参考后重建 PPT', 'HTML 网页成品', 'HTML 制作后转换为 PPT']) {
    assert.ok(mount.innerHTML.includes(title), `路线比较应渲染${title}`);
  }
  assert.equal((mount.innerHTML.match(/data-ppt-action="choose-route"/g) || []).length, 4);
  assert.match(mount.innerHTML, /data-ppt-action="delete-slide"/);
  assert.match(mount.innerHTML, /data-ppt-delete-reason=/);
});

test('所有动态内容均转义，且工作台操作贯通大纲确认和路线选择', async () => {
  const { handlers, mount, state, calls, ui } = fixture();
  ui.render();

  assert.equal(mount.innerHTML.includes('<script>brief</script>'), false);
  assert.equal(mount.innerHTML.includes('<img src=x'), false);
  assert.equal(mount.innerHTML.includes('<svg onload='), false);
  assert.match(mount.innerHTML, /&lt;script&gt;brief&lt;\/script&gt;/);

  await handlers.click({ target: { dataset: { pptAction: 'approve-outline' }, closest() { return this; } } });
  await handlers.click({ target: { dataset: { pptAction: 'choose-route', route: 'native-ppt' }, closest() { return this; } } });
  assert.deepEqual(calls, ['approve', ['route', 'native-ppt']]);
  assert.equal(state.promptAgentTasks[0].pptScene.route.selected, 'native-ppt');
  assert.equal(state.promptAgentTasks[0].pptScene.brief.route, 'native-ppt');
  assert.match(mount.innerHTML, /原生可编辑 PPT · 推荐 · 已选/);
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

test('逐页正文和视觉说明可编辑提交，输入和展示值均转义', async () => {
  const { handlers, mount, calls, controls, ui } = fixture();
  ui.render();
  const body = controls.find(node => node.dataset.slideEdit === 'body');
  const visual = controls.find(node => node.dataset.slideEdit === 'visualDescription');
  body.value = '<img src=x onerror=alert(2)>';
  visual.value = '<svg onload=alert(3)>';
  assert.match(mount.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(mount.innerHTML, /&lt;svg onload=alert\(1\)&gt;/);
  assert.doesNotMatch(mount.innerHTML, /<img src=x|<svg onload=/);

  await handlers.click({ target: { dataset: { pptAction: 'edit-slide', slideId: 's1' }, closest() { return this; } } });
  const patch = calls.find(call => Array.isArray(call) && call[0] === 'edit')[2];
  assert.deepEqual(patch.body, ['<img src=x onerror=alert(2)>']);
  assert.equal(patch.visualDescription, '<svg onload=alert(3)>');
});

test('硬约束可编辑持久化，交叉页数范围报错且保留已保存旧值', async () => {
  const { handlers, mount, state, controls, ui } = fixture();
  ui.render();
  const min = controls.find(node => node.dataset.pptConstraint === 'minSlides');
  const max = controls.find(node => node.dataset.pptConstraint === 'maxSlides');
  const words = controls.find(node => node.dataset.pptConstraint === 'maxWordsPerSlide');
  min.value = '3'; max.value = '7'; words.value = '55';
  await handlers.click({ target: { dataset: { pptAction: 'save-brief' }, closest() { return this; } } });
  assert.deepEqual(state.promptAgentTasks[0].pptScene.brief.constraints, { minSlides: 3, maxSlides: 7, maxWordsPerSlide: 55 });

  min.value = '8'; max.value = '4';
  await handlers.click({ target: { dataset: { pptAction: 'save-brief' }, closest() { return this; } } });
  assert.match(mount.innerHTML, /页数下限不能大于页数上限/);
  assert.deepEqual(state.promptAgentTasks[0].pptScene.brief.constraints, { minSlides: 3, maxSlides: 7, maxWordsPerSlide: 55 });
});
