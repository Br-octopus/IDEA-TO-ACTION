const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const review = require('../prototype/academic-review.js');
const { createWritingDOM } = require('./helpers/writing-dom.js');

let uiModule;
try { uiModule = require('../prototype/academic-review-ui.js'); } catch { uiModule = {}; }

function makeHarness() {
  const dom = createWritingDOM();
  const calls = [];
  const notices = [];
  let projects = [];
  const coordinator = {
    listProjects: () => projects,
    getProject: id => projects.find(project => project.id === id) || null,
    async createProject(input) {
      calls.push({ action: 'createProject', input });
      const project = review.createReviewProject({ ...input, id: 'review-created' });
      projects = [...projects, project];
      return project;
    },
    async setSaveEnabled(id, enabled) { calls.push({ action: 'setSaveEnabled', id, enabled }); },
    async deleteProject(id) { calls.push({ action: 'deleteProject', id }); projects = projects.filter(item => item.id !== id); }
  };
  const ui = uiModule.createAcademicReviewUI({
    root: dom.mount, coordinator, getState: () => ({ knowledgeEntries: [] }),
    getKnowledgeEntries: () => [], getPackSnapshot: () => ({ id: 'builtin-academic-review', version: 1, name: '学术综述', sourceIds: ['prisma-2020'], entries: [], sources: [{ id: 'prisma-2020', title: 'PRISMA 2020', url: 'https://www.prisma-statement.org/prisma-2020', verificationStatus: 'source-reviewed' }] }),
    confirm: () => true, notify: message => notices.push(message), clipboard: async () => {}
  });
  return { ...dom, ui, coordinator, calls, notices, get projects() { return projects; } };
}

test('综述工作台展示三种类型、来源状态、默认关闭保存和覆盖说明', () => {
  assert.equal(typeof uiModule.createAcademicReviewUI, 'function', '应提供学术综述工作台界面');
  const { mount } = makeHarness();
  assert.match(mount.innerHTML, /叙述性综述/);
  assert.match(mount.innerHTML, /范围综述/);
  assert.match(mount.innerHTML, /系统综述/);
  assert.match(mount.innerHTML, /默认关闭/);
  assert.match(mount.innerHTML, /PRISMA/);
  assert.match(mount.innerHTML, /aria-live=/);
});

test('真实页面加载综述协调器和 UI，并在资料库提供工作台根节点与窄屏样式', () => {
  const html = fs.readFileSync(require.resolve('../prototype/index.html'), 'utf8');
  assert.match(html, /id="academic-review-root"/);
  assert.match(html, /src="\/prototype\/academic-review-coordinator\.js"/);
  assert.match(html, /src="\/prototype\/academic-review-ui\.js"/);
  assert.match(html, /#academic-review-root[\s\S]*overflow-wrap:\s*anywhere/);
  const mobileStylesStart = html.indexOf('@media (max-width: 760px) {');
  const mobileReviewRule = html.indexOf('#academic-review-root .academic-review-workspace', mobileStylesStart);
  assert.ok(mobileStylesStart >= 0 && mobileReviewRule > mobileStylesStart, '窄屏规则应覆盖综述工作台');
});

test('通过界面输入必填项创建综述项目并带入学术基础包快照', async () => {
  const app = makeHarness();
  await app.change('review-create-title', '模拟范围综述');
  await app.change('review-create-type', 'scoping-review');
  await app.change('review-create-question', '模拟问题');
  await app.change('review-create-scope', '模拟范围');
  await app.change('review-create-inclusion', '纳入模拟研究');
  await app.change('review-create-exclusion', '排除非研究');
  await app.click('review-create-project');
  assert.equal(app.calls[0].action, 'createProject');
  assert.equal(app.calls[0].input.reviewType, 'scoping-review');
  assert.equal(app.projects[0].saveEnabled, false);
  assert.equal(app.projects[0].packSnapshot.id, 'builtin-academic-review');
  assert.match(app.mount.innerHTML, /模拟范围综述/);
});

test('项目列表支持显式保存开关与二次确认删除操作', async () => {
  const app = makeHarness();
  await app.change('review-create-title', '可删除项目');
  await app.change('review-create-question', '问题');
  await app.change('review-create-scope', '范围');
  await app.change('review-create-inclusion', '纳入标准');
  await app.change('review-create-exclusion', '排除标准');
  await app.click('review-create-project');
  await app.change('review-toggle-save-review-created', true);
  assert.ok(app.calls.some(call => call.action === 'setSaveEnabled' && call.enabled === true));
  await app.click('review-delete-project', { projectId: 'review-created' });
  assert.ok(app.calls.some(call => call.action === 'deleteProject' && call.id === 'review-created'));
});
