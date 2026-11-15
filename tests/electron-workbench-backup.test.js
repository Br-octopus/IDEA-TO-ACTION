'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { exportWorkspaceArchive } = require('../electron/workspace-backup-archive.js');
const { createPptFeedbackAttachmentStore } = require('../electron/ppt-feedback-attachment-store.js');
const { createSettingsStore } = require('../electron/settings-store.js');

async function withTemp(callback) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'electron-workbench-backup-'));
  try { await callback(directory); } finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
}

function loadMain({ userData, archivePath }) {
  const handlers = new Map();
  const appEvents = new Map();
  const ipcMain = {
    handle: (name, handler) => handlers.set(name, handler),
    on: (name, handler) => handlers.set(name, handler)
  };
  const app = {
    isPackaged: false,
    whenReady: () => new Promise(() => {}),
    getPath: name => name === 'userData' ? userData : path.dirname(archivePath),
    getAppPath: () => path.resolve(__dirname, '..'),
    on: (name, handler) => appEvents.set(name, handler),
    quit: () => {}
  };
  const dialog = {
    showOpenDialog: async () => ({ canceled: false, filePaths: [archivePath] }),
    showSaveDialog: async () => ({ canceled: false, filePath: archivePath }),
    showMessageBox: async () => ({ response: 0 })
  };
  class BrowserWindow { static getAllWindows() { return []; } }
  const context = {
    console, __dirname: path.join(__dirname, '..', 'electron'), Buffer, Date, Promise,
    setTimeout, clearTimeout, process: { env: {}, platform: process.platform, pid: process.pid },
    require(request) {
      if (request === 'electron') return { app, BrowserWindow, dialog, ipcMain, safeStorage: {}, session: {} };
      return require(request);
    }
  };
  const mainPath = path.join(__dirname, '..', 'electron', 'main.js');
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), context, { filename: mainPath });
  return handlers;
}

function snapshotFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else files.push([path.relative(root, filePath), fs.readFileSync(filePath)]);
    }
  }
  if (fs.existsSync(root)) visit(root);
  return files.sort(([left], [right]) => left.localeCompare(right));
}

test('工作台 ZIP 导入事务安装批注并可整体回滚附件与批注', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const archivePath = path.join(directory, 'backup.zip');
    const taskId = 'task-transaction';
    const attachmentId = '550e8400-e29b-41d4-a716-446655440000';
    const content = Buffer.from('<!doctype html><main><p>hello</p></main>');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const archiveId = `${taskId}_${attachmentId}.html`;
    const attachment = {
      id: archiveId, taskId, type: 'text/html', size: content.length,
      openStream: () => Readable.from([content])
    };
    const workspace = { projects: [{ id: taskId, workbenchAttachmentIds: [attachmentId] }] };
    const output = fs.createWriteStream(archivePath);
    await exportWorkspaceArchive({ output, workspace, attachments: [attachment] });

    const handlers = loadMain({ userData, archivePath });
    const stage = await handlers.get('backup:import')();
    assert.equal(stage.format, 'workspace-archive');
    const annotation = {
      id: 'note-transaction', taskId, attachmentId, contentHash: sha256, pageIndex: 0,
      target: { kind: 'text', selector: 'main > p', exact: 'hello', prefix: '', suffix: '', start: 0, end: 5 },
      comment: '保留原词', category: 'content', intent: 'keep',
      createdAt: '2026-11-11T10:00:00.000Z', updatedAt: '2026-11-11T10:00:00.000Z', status: 'active', selected: true
    };
    await assert.rejects(handlers.get('backup:commit-import')(null, {
      stageId: stage.stageId, attachmentIds: [], workbenchAssets: { mode: 'replace', attachments: [], annotations: [], taskIds: ['../outside'] }
    }), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
    const payload = {
      attachmentIds: [archiveId],
      targetAttachmentIds: [attachmentId],
      workbenchAssets: {
        mode: 'replace',
        taskIds: [taskId],
        attachments: [{
          id: attachmentId, archiveId, taskId, displayName: 'review.html', kind: 'html',
          mimeType: 'text/html', size: content.length, sha256,
          version: sha256, createdAt: '2026-11-11T10:00:00.000Z', deleted: false
        }],
        annotations: [annotation]
      }
    };
    const committed = await handlers.get('backup:commit-import')(null, { ...payload, stageId: stage.stageId });
    assert.equal(committed.status, 'ok');
    assert.equal((await handlers.get('ppt-feedback:list-backup-attachments')(null, { taskId })).attachments[0].sha256, sha256);
    assert.deepEqual(JSON.parse(JSON.stringify((await handlers.get('ppt-feedback:list-annotations')(null, { taskId })).annotations)), [annotation]);

    const rolledBack = await handlers.get('backup:rollback-import')(null, committed.transactionId);
    assert.equal(rolledBack.rolledBack, true);
    assert.deepEqual(JSON.parse(JSON.stringify((await handlers.get('ppt-feedback:list-backup-attachments')(null, { taskId })).attachments)), []);
    assert.deepEqual(JSON.parse(JSON.stringify((await handlers.get('ppt-feedback:list-annotations')(null, { taskId })).annotations)), []);

    const persistentStage = await handlers.get('backup:import')();
    await handlers.get('backup:commit-import')(null, { ...payload, stageId: persistentStage.stageId });
    const rollbackHandlers = loadMain({ userData, archivePath });
    const rolledBackAfterRestart = await rollbackHandlers.get('backup:recover-imports')(null, { attachmentIds: [], workbenchAttachmentIds: [] });
    assert.equal(rolledBackAfterRestart.recovered, 1);
    assert.deepEqual(JSON.parse(JSON.stringify((await rollbackHandlers.get('ppt-feedback:list-backup-attachments')(null, { taskId })).attachments)), []);
    assert.deepEqual(JSON.parse(JSON.stringify((await rollbackHandlers.get('ppt-feedback:list-annotations')(null, { taskId })).annotations)), []);

    const restoredStage = await rollbackHandlers.get('backup:import')();
    await rollbackHandlers.get('backup:commit-import')(null, { ...payload, stageId: restoredStage.stageId });
    const restartedHandlers = loadMain({ userData, archivePath });
    const rolledForward = await restartedHandlers.get('backup:recover-imports')(null, { attachmentIds: [], workbenchAttachmentIds: [attachmentId] });
    assert.equal(rolledForward.recovered, 1);
    assert.equal((await restartedHandlers.get('ppt-feedback:list-backup-attachments')(null, { taskId })).attachments[0].sha256, sha256);
    assert.deepEqual(JSON.parse(JSON.stringify((await restartedHandlers.get('ppt-feedback:list-annotations')(null, { taskId })).annotations)), [annotation]);
    assert.deepEqual(fs.readFileSync(path.join(userData, 'ppt-feedback', taskId, attachmentId, 'attachment.html')), content);
  });
});

test('工作台 UUID 与其他任务现存附件冲突时拒绝导入且保留现存资料', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const taskId = 'task-target';
    const otherTaskId = 'task-other';
    const attachmentId = '550e8400-e29b-41d4-a716-446655440000';
    const existingBytes = Buffer.from('<!doctype html><p>existing</p>');
    const incomingBytes = Buffer.from('<!doctype html><p>incoming</p>');
    const existingPath = path.join(directory, 'existing.html');
    const incomingPath = path.join(directory, 'incoming.html');
    await fs.promises.writeFile(existingPath, existingBytes);
    await fs.promises.writeFile(incomingPath, incomingBytes);
    const existingStore = createPptFeedbackAttachmentStore({
      app: { getPath: () => userData }, createId: () => attachmentId
    });
    const existing = await existingStore.saveAttachment({ taskId: otherTaskId, sourcePath: existingPath, mimeType: 'text/html' });
    const incomingHash = crypto.createHash('sha256').update(incomingBytes).digest('hex');
    const archivePath = path.join(directory, 'backup.zip');
    const output = fs.createWriteStream(archivePath);
    await exportWorkspaceArchive({
      output,
      workspace: { projects: [{ id: taskId }], workbenchAttachments: [{
        id: attachmentId, archiveId: `${taskId}_${attachmentId}.html`, taskId, mimeType: 'text/html',
        kind: 'html', displayName: 'incoming.html', size: incomingBytes.length, sha256: incomingHash,
        version: incomingHash, createdAt: new Date().toISOString(), deleted: false
      }], workbenchAnnotations: [] },
      attachments: [{ id: `${taskId}_${attachmentId}.html`, taskId, type: 'text/html', size: incomingBytes.length,
        openStream: () => Readable.from([incomingBytes]) }]
    });
    const handlers = loadMain({ userData, archivePath });
    const stage = await handlers.get('backup:import')();
    await assert.rejects(handlers.get('backup:commit-import')(null, {
      stageId: stage.stageId,
      attachmentIds: [`${taskId}_${attachmentId}.html`],
      targetAttachmentIds: [attachmentId],
      workbenchAssets: {
        mode: 'replace', taskIds: [taskId],
        attachments: [{
          id: attachmentId, archiveId: `${taskId}_${attachmentId}.html`, taskId, kind: 'html',
          mimeType: 'text/html', displayName: 'incoming.html', size: incomingBytes.length,
          sha256: incomingHash, version: incomingHash, createdAt: new Date().toISOString(), deleted: false
        }],
        annotations: []
      }
    }), { code: 'BACKUP_IMPORT_ATTACHMENT_CONFLICT' });
    assert.deepEqual(fs.readFileSync(existingStore.getAttachmentPath(existing.id)), existingBytes);
  });
});

test('取消已暂存的工作区 ZIP 导入后原附件、批注与设置文件逐字节不变', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const taskId = 'task-existing';
    const existingId = '123e4567-e89b-12d3-a456-426614174000';
    const existingBytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
    const existingPath = path.join(directory, 'existing.png');
    await fs.promises.writeFile(existingPath, existingBytes);
    const existingStore = createPptFeedbackAttachmentStore({
      app: { getPath: () => userData }, createId: () => existingId
    });
    const existing = await existingStore.saveAttachment({ taskId, sourcePath: existingPath, mimeType: 'image/png' });

    const incomingTaskId = 'task-incoming';
    const incomingId = '123e4567-e89b-12d3-a456-426614174001';
    const incomingBytes = Buffer.from('<!doctype html><main>incoming</main>');
    const incomingArchiveId = `${incomingTaskId}_${incomingId}.html`;
    const archivePath = path.join(directory, 'incoming.zip');
    const output = fs.createWriteStream(archivePath);
    await exportWorkspaceArchive({
      output,
      workspace: { projects: [{ id: incomingTaskId, title: '待导入任务' }] },
      attachments: [{
        id: incomingArchiveId, taskId: incomingTaskId, type: 'text/html', size: incomingBytes.length,
        openStream: () => Readable.from([incomingBytes])
      }]
    });

    const handlers = loadMain({ userData, archivePath });
    const annotation = {
      id: 'existing-point-note', taskId, attachmentId: existing.id, contentHash: existing.sha256, pageIndex: 0,
      target: { kind: 'point', x: 0.25, y: 0.35 }, comment: '原批注保持不变', category: 'content', intent: 'modify',
      createdAt: '2026-11-12T08:00:00.000Z', updatedAt: '2026-11-12T08:00:00.000Z', status: 'active', selected: true
    };
    await handlers.get('ppt-feedback:save-annotation')(null, annotation);
    const settingsStore = createSettingsStore({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: value => Buffer.from(`encrypted:${value}`, 'utf8'),
        decryptString: value => Buffer.from(value).toString('utf8').replace(/^encrypted:/, '')
      },
      getUserDataPath: () => userData
    });
    settingsStore.save({ model: { baseUrl: 'https://model.example/v1', name: 'fixture-model', credential: 'fixture-key' } });
    const settingsPath = settingsStore.filePath();
    const settingsBytes = fs.readFileSync(settingsPath);
    const filesBefore = snapshotFiles(userData);

    const staged = await handlers.get('backup:import')();
    assert.equal(staged.format, 'workspace-archive');
    assert.deepEqual(staged.attachmentErrors, []);
    const stageDirectory = path.join(userData, 'workspace-backup-import-staging', staged.stageId);
    assert.equal(fs.existsSync(stageDirectory), true);
    assert.deepEqual(JSON.parse(JSON.stringify((await handlers.get('ppt-feedback:list-annotations')(null, { taskId })).annotations)), [annotation]);

    const discarded = await handlers.get('backup:discard-import')(null, staged.stageId);
    assert.deepEqual(JSON.parse(JSON.stringify(discarded)), { status: 'ok', discarded: true });
    assert.equal(fs.existsSync(stageDirectory), false);
    assert.deepEqual(snapshotFiles(userData), filesBefore);
    assert.deepEqual(fs.readFileSync(existingStore.getAttachmentPath(existing.id)), existingBytes);
    assert.deepEqual(fs.readFileSync(settingsPath), settingsBytes);
    assert.deepEqual(JSON.parse(JSON.stringify((await handlers.get('ppt-feedback:list-annotations')(null, { taskId })).annotations)), [annotation]);
  });
});
