const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../prototype/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../prototype/index.html'), 'utf8');
const start = app.indexOf('  async function exportWorkbenchTaskBackup(project) {');
const end = app.indexOf('  async function exportKnowledgeBackup(', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

test('统一工作台任务导出先确认保存，再导出所选任务及附件清单', async () => {
  const project = { id: 'task-a' };
  const backup = {
    format: 'forward-step-workspace', scope: 'workspace', data: {
      projects: [project], researchAttachments: [],
      workbenchAttachments: [{ archiveId: 'task-a_file-a.txt' }]
    }
  };
  const calls = [];
  let request;
  const context = {
    state: { projects: [project] },
    workspaceBackup: { createTaskBackup: (state, taskId) => {
      assert.equal(state.projects[0], project);
      assert.equal(taskId, project.id);
      calls.push('create-backup');
      return backup;
    } },
    addWorkbenchBackupAssets: async value => value,
    saveWorkbenchManifest: async taskId => { calls.push(`save:${taskId}`); return true; },
    desktopApi: { exportBackup: async value => { calls.push('export'); request = value; return { canceled: false, filePath: 'task-a.zip' }; } }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);

  const result = await context.exportWorkbenchTaskBackup(project);

  assert.deepEqual(calls, ['save:task-a', 'create-backup', 'export']);
  assert.deepEqual(Array.from(request.attachmentIds), ['task-a_file-a.txt']);
  assert.deepEqual(Array.from(request.workbenchTaskIds), ['task-a']);
  assert.equal(JSON.parse(request.content).data.projects.length, 1);
  assert.deepEqual(result, { canceled: false, filePath: 'task-a.zip' });

  context.saveWorkbenchManifest = async () => false;
  request = null;
  await assert.rejects(context.exportWorkbenchTaskBackup(project), /尚未确认保存/);
  assert.equal(request, null);
});

test('统一工作台页面提供桌面端完整任务导出入口并接入点击事件', () => {
  assert.match(html, /id="workbench-export-task"/);
  assert.match(app, /getElementById\("workbench-export-task"\)\.addEventListener\("click"/);
});
