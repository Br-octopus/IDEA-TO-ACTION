const test = require('node:test');
const assert = require('node:assert/strict');
const { createWritingDOM } = require('./helpers/writing-dom.js');
const publishing = require('../prototype/academic-publishing.js');
const coordinatorApi = require('../prototype/academic-publishing-coordinator.js');
const { createWritingApp } = require('./helpers/writing-app.js');
let uiApi;
try { uiApi = require('../prototype/academic-publishing-ui.js'); } catch { uiApi = {}; }

function harness() {
  const dom = createWritingDOM('academic-publishing-root');
  let state = {
    knowledgeEntries: [{ id: 'lit-1', type: 'academic-literature', title: '示例研究', literature: {
      authors: ['作者甲'], year: '2025', doi: '10.1000/test', metadataStatus: 'unverified', readingStatus: 'excerpt-only', abstractExcerpt: '用户摘录'
    } }],
    academicResponseProjects: []
  };
  const coordinator = coordinatorApi.createAcademicPublishingCoordinator({
    publishing,
    getState: () => state,
    getKnowledgeEntries: () => state.knowledgeEntries,
    builtinPack: require('../prototype/writing-pack-catalog.js').getBuiltinWritingPacks().find(pack => pack.id === 'builtin-academic-publishing'),
    persistState(next) { state = structuredClone(next); return state; },
    newId: (() => { let index = 0; return prefix => `${prefix}-${++index}`; })(),
    now: () => '2026-10-21T00:00:00.000Z'
  });
  const messages = [];
  const ui = uiApi.createAcademicPublishingUI({
    root: dom.mount,
    coordinator,
    getKnowledgeEntries: () => state.knowledgeEntries,
    lookup: async () => ({ title: '登记题名', authors: ['作者乙'], year: '2024', doi: '10.1000/test', metadataStatus: 'registry-returned' }),
    confirm: () => true,
    clipboard: async value => { messages.push(value); },
    notify: value => { messages.push(value); }
  });
  return { dom, coordinator, ui, messages, get state() { return state; } };
}

test('学术投稿界面创建本机会话项目并走通论断、文献关联、提示词复制', async () => {
  const app = harness();
  assert.match(app.dom.mount.innerHTML, /学术核引、审稿回复与投稿准备/);
  await app.dom.input('publishing-create-title', '引用核验任务');
  await app.dom.input('publishing-create-venue', '目标期刊');
  await app.dom.click('publishing-create-project');
  const project = app.coordinator.listProjects()[0];
  assert.equal(project.title, '引用核验任务');
  assert.equal(project.target.venue, '目标期刊');
  assert.equal(project.saveEnabled, false);

  await app.dom.input('publishing-claim-text', '该治疗改善主要结局。');
  await app.dom.input('publishing-claim-location', '第 2 页第 1 段');
  await app.dom.changeAction('publishing-select-literature', { entryId: 'lit-1' }, true);
  await app.dom.click('publishing-add-claim');
  const claim = app.coordinator.getProject(project.id).citationClaims[0];
  assert.equal(claim.sources[0].snapshot.title, '示例研究');
  await app.dom.clickCheckbox('publishing-select-claim', { pubSelect: claim.id });
  await app.dom.click('publishing-generate-prompt');
  assert.match(app.dom.node('publishing-prompt').value, /该治疗改善主要结局/);
  await app.dom.click('publishing-copy-prompt');
  assert.match(app.messages.join('\n'), /该治疗改善主要结局/);
  assert.equal(app.coordinator.getProject(project.id).history[0].status, 'copied');
});

test('登记查询只显示题录差异，要求用户确认后才改变题录核验状态', async () => {
  const app = harness();
  await app.dom.click('publishing-create-project');
  await app.dom.input('publishing-claim-text', '论断');
  await app.dom.changeAction('publishing-select-literature', { entryId: 'lit-1' }, true);
  await app.dom.click('publishing-add-claim');
  const project = app.coordinator.listProjects()[0];
  const source = project.citationClaims[0].sources[0];
  await app.dom.click('publishing-lookup-metadata', { claimId: project.citationClaims[0].id, sourceId: source.id });
  assert.match(app.dom.mount.innerHTML, /登记题名/);
  assert.equal(app.coordinator.getProject(project.id).citationClaims[0].sources[0].metadataStatus, 'unverified');
  await app.dom.click('publishing-confirm-metadata', { claimId: project.citationClaims[0].id, sourceId: source.id });
  assert.equal(app.coordinator.getProject(project.id).citationClaims[0].sources[0].metadataStatus, 'user-verified');
  assert.equal(app.coordinator.getProject(project.id).citationClaims[0].sources[0].relation, 'unassessed');
});

test('UI 清楚标示投稿清单是用户记录而非自动合规认证', async () => {
  const app = harness();
  await app.dom.click('publishing-create-project');
  await app.dom.change('publishing-task-type', 'submission-prep');
  assert.match(app.dom.mount.innerHTML, /不代表投稿合规通过/);
  assert.match(app.dom.mount.innerHTML, /目标要求/);
});

test('投稿要求可以在 UI 中核对并保存来源位置', async () => {
  const app = harness();
  await app.dom.click('publishing-create-project');
  await app.dom.change('publishing-task-type', 'submission-prep');
  await app.dom.input('publishing-requirement-title', '匿名投稿文件');
  await app.dom.input('publishing-requirement-issuer', '目标期刊编辑部');
  await app.dom.input('publishing-requirement-version', '2026 版');
  await app.dom.input('publishing-requirement-url', 'https://journal.example/guide');
  await app.dom.input('publishing-requirement-body', '匿名稿不得包含作者身份信息。');
  await app.dom.click('publishing-add-requirement');
  const project = app.coordinator.listProjects()[0];
  const requirement = project.requirements[0];
  app.dom.mount.querySelector(`[data-pub-requirement-status="${requirement.id}"]`).value = 'user-confirmed';
  app.dom.mount.querySelector(`[data-pub-requirement-locator="${requirement.id}"]`).value = '作者指南 > 投稿文件';
  await app.dom.click('publishing-save-requirement', { requirementId: requirement.id });
  const updated = app.coordinator.getProject(project.id).requirements[0];
  assert.equal(updated.verificationStatus, 'user-confirmed');
  assert.equal(updated.sourceLocator, '作者指南 > 投稿文件');
  assert.match(app.dom.mount.innerHTML, /不构成投稿合规认证/);
});

test('主应用把学术投稿工作台接入真实页面根节点并可刷新恢复', async () => {
  const app = createWritingApp();
  assert.equal(typeof app.window.ForwardStepAcademicPublishingUIController?.render, 'function');
  assert.match(app.academicPublishingDOM.mount.innerHTML, /学术核引、审稿回复与投稿准备/);
  assert.match(app.pageHTML, /id="academic-publishing-root"/);
  assert.match(app.pageHTML, /src="\/prototype\/academic-publishing-ui\.js"/);
  app.window.ForwardStepAcademicPublishingUIController.refreshFromStorage();
  assert.match(app.academicPublishingDOM.mount.innerHTML, /已从本机存储重新载入/);
});
