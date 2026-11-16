'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { exportWorkspaceArchive, FORMAT, FORMAT_VERSION } = require('../electron/workspace-backup-archive.js');
const { createPptFeedbackAttachmentStore } = require('../electron/ppt-feedback-attachment-store.js');
const { createSettingsStore } = require('../electron/settings-store.js');
const workbenchSchema = require('../prototype/unified-workbench-schema.js');

async function withTemp(callback) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'electron-workbench-backup-'));
  try { await callback(directory); } finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
}

async function writeZip(filePath, entries) {
  const zip = new yazl.ZipFile();
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.content), entry.name);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    output.once('finish', resolve);
    output.once('error', reject);
    zip.once('error', reject);
    zip.outputStream.pipe(output);
    zip.end();
  });
}

function readZipEntries(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (openError, zip) => {
      if (openError) return reject(openError);
      const entries = {};
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', entry => zip.openReadStream(entry, (streamError, stream) => {
        if (streamError) return reject(streamError);
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => { entries[entry.fileName] = Buffer.concat(chunks); zip.readEntry(); });
      }));
      zip.readEntry();
    });
  });
}

function loadMain({ userData, archivePath, selectedPath = archivePath, messageBoxResponse = 0, onMessageBox, onSaveDialog } = {}) {
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
    showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPath] }),
    showSaveDialog: async (...args) => {
      onSaveDialog?.(args.at(-1));
      return { canceled: false, filePath: archivePath };
    },
    showMessageBox: async (...args) => {
      onMessageBox?.(args.at(-1));
      return { response: messageBoxResponse };
    }
  };
  class BrowserWindow { static getAllWindows() { return []; } }
  const context = {
    console, __dirname: path.join(__dirname, '..', 'electron'), Buffer, Date, Promise,
    setTimeout, clearTimeout, process: { env: {}, platform: process.platform, pid: process.pid },
    require(request) {
      if (request === 'electron') return { app, BrowserWindow, dialog, ipcMain, safeStorage: {}, session: {}, shell: { openPath: async () => "" } };
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

function createPdf(pageStreams) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageStreams.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pageStreams.length} >>`
  ];
  pageStreams.forEach((content, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents ${contentObjectId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

test('桌面工作台可受控导入并读取 TXT/MD 附件', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const source = path.join(directory, 'notes.md');
    const bytes = Buffer.from('# 参考页面\n\n保留顶部导航', 'utf8');
    await fs.promises.writeFile(source, bytes);
    const handlers = loadMain({ userData, archivePath: path.join(directory, 'backup.zip'), selectedPath: source });
    const imported = await handlers.get('ppt-feedback:choose-file')(null, { taskId: 'task-text' });
    assert.equal(imported.attachment.mimeType, 'text/markdown');
    assert.equal(imported.attachment.kind, 'markdown');
    const preview = await handlers.get('ppt-feedback:read-text')(null, { attachmentId: imported.attachment.id });
    assert.equal(preview.status, 'ok');
    assert.equal(preview.sha256, imported.attachment.sha256);
    assert.equal(preview.text, bytes.toString('utf8'));
    assert.deepEqual(await fs.promises.readFile(source), bytes);
  });
});

test('桌面完整 ZIP 备份携带工作台任务清单并可在导入预览读取', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const archivePath = path.join(directory, 'backup.zip');
    const taskId = 'task-manifest';
    const project = workbenchSchema.normalizeWorkbenchProject({
      id: taskId, workbenchPersistenceEnabled: true,
      workbenchDraft: { goal: '恢复目标', opinion: '', promptText: '提示词', annotations: [] }
    });
    const store = createPptFeedbackAttachmentStore({ app: { getPath: () => userData } });
    store.saveTaskManifest(taskId, {
      schemaVersion: workbenchSchema.WORKBENCH_SCHEMA_VERSION, taskId, revision: 2, project
    });
    const handlers = loadMain({ userData, archivePath });
    const backup = {
      format: 'forward-step-workspace', scope: 'workspace', schemaVersion: 1,
      data: { projects: [project] }, counts: { projects: 1 }
    };

    await handlers.get('backup:export')(null, {
      format: 'workspace-archive', content: JSON.stringify(backup), attachmentIds: []
    });
    const stage = await handlers.get('backup:import')();
    assert.equal(stage.workbenchManifests.length, 1);
    assert.equal(stage.workbenchManifests[0].taskId, taskId);
    assert.equal(stage.workbenchManifests[0].revision, 2);
    assert.equal(stage.workbenchManifests[0].project.workbenchDraft.goal, '恢复目标');
    assert.deepEqual(stage.workbenchErrors, []);
    await handlers.get('backup:discard-import')(null, stage.stageId);
  });
});

test('工作台任务清单 ZIP 导入可回滚恢复且不会覆盖已有清单', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const archivePath = path.join(directory, 'backup.zip');
    const sourceTaskId = 'task-manifest-source';
    const taskId = 'task-manifest-import';
    const project = workbenchSchema.normalizeWorkbenchProject({
      id: sourceTaskId, workbenchPersistenceEnabled: true,
      workbenchDraft: { goal: '导入清单目标', opinion: '', promptText: '', annotations: [] }
    });
    const manifest = {
      schemaVersion: workbenchSchema.WORKBENCH_SCHEMA_VERSION, taskId: sourceTaskId, revision: 2, project
    };
    await exportWorkspaceArchive({
      output: fs.createWriteStream(archivePath),
      workspace: { projects: [project] }, attachments: [], workbenchManifests: [manifest]
    });
    const handlers = loadMain({ userData, archivePath });
    const createPayload = stage => ({
        stageId: stage.stageId, attachmentIds: [], targetAttachmentIds: [],
        workbenchAssets: {
          mode: 'replace', attachments: [], annotations: [], taskIds: [taskId],
          manifests: stage.workbenchManifests.map(item => ({ ...item, sourceTaskId: item.taskId, taskId,
            project: workbenchSchema.normalizeWorkbenchProject({ ...item.project, id: taskId,
              workbenchAttachmentId: null, workbenchAttachmentIds: [] }) })),
          taskIdMap: [{ from: sourceTaskId, to: taskId }], attachmentIdMap: []
        }
      });
    const commitStage = async targetHandlers => {
      const stage = await targetHandlers.get('backup:import')();
      return targetHandlers.get('backup:commit-import')(null, createPayload(stage));
    };
    const readManifest = async targetHandlers => (await targetHandlers.get('workbench:read-manifest')(null, { taskId })).manifest;

    const firstStage = await handlers.get('backup:import')();
    const firstPayload = createPayload(firstStage);
    const forgedMap = structuredClone(firstPayload);
    forgedMap.workbenchAssets.taskIdMap[0].to = 'task-forged-target';
    await assert.rejects(handlers.get('backup:commit-import')(null, forgedMap), { code: 'BACKUP_IMPORT_INVALID_MANIFEST' });
    const forgedManifest = structuredClone(firstPayload);
    forgedManifest.workbenchAssets.manifests[0].project.workbenchDraft.goal = '未经归档的改写';
    await assert.rejects(handlers.get('backup:commit-import')(null, forgedManifest), { code: 'BACKUP_IMPORT_INVALID_MANIFEST' });
    const first = await handlers.get('backup:commit-import')(null, firstPayload);
    assert.equal((await readManifest(handlers)).revision, 2);
    assert.equal((await handlers.get('backup:rollback-import')(null, first.transactionId)).rolledBack, true);
    assert.equal(await readManifest(handlers), null);

    await commitStage(handlers);
    const rollbackHandlers = loadMain({ userData, archivePath });
    const editStore = createPptFeedbackAttachmentStore({ app: { getPath: () => userData } });
    const editedManifest = await readManifest(rollbackHandlers);
    const editedProject = workbenchSchema.normalizeWorkbenchProject({
      ...editedManifest.project, workbenchRevision: 3,
      workbenchDraft: { ...editedManifest.project.workbenchDraft, goal: '导入后继续编辑' }
    });
    editStore.saveTaskManifest(taskId, {
      schemaVersion: workbenchSchema.WORKBENCH_SCHEMA_VERSION, taskId, revision: 3, project: editedProject
    });
    const rolledBack = await rollbackHandlers.get('backup:recover-imports')(null, {
      attachmentIds: [], workbenchAttachmentIds: [], workbenchTaskIds: []
    });
    assert.equal(rolledBack.recovered, 1);
    assert.equal((await readManifest(rollbackHandlers)).project.workbenchDraft.goal, '导入后继续编辑');
    editStore.deleteTaskManifest(taskId);

    await commitStage(rollbackHandlers);
    const recoveryHandlers = loadMain({ userData, archivePath });
    const rolledForward = await recoveryHandlers.get('backup:recover-imports')(null, {
      attachmentIds: [], workbenchAttachmentIds: [], workbenchTaskIds: [taskId]
    });
    assert.equal(rolledForward.recovered, 1);
    assert.equal((await readManifest(recoveryHandlers)).revision, 2);

    await assert.rejects(commitStage(recoveryHandlers), { code: 'BACKUP_IMPORT_MANIFEST_CONFLICT' });
    assert.equal((await readManifest(recoveryHandlers)).revision, 2);
  });
});

test('工作台 ZIP 导入事务安装批注并可整体回滚附件与批注', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const archivePath = path.join(directory, 'backup.zip');
    const taskId = 'task-transaction';
    const attachmentId = '550e8400-e29b-41d4-a716-446655440000';
    const targetTaskId = 'task-transaction-remapped';
    const targetAttachmentId = '650e8400-e29b-41d4-a716-446655440001';
    const content = Buffer.from('<!doctype html><main><p>hello</p></main>');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const archiveId = `${taskId}_${attachmentId}.html`;
    const targetArchiveId = `${targetTaskId}_${targetAttachmentId}.html`;
    const attachment = {
      id: archiveId, taskId, type: 'text/html', size: content.length,
      openStream: () => Readable.from([content])
    };
    const workspace = {
      projects: [{ id: taskId, workbenchPersistenceEnabled: true, workbenchAttachmentId: attachmentId, workbenchAttachmentIds: [attachmentId] }],
      workbenchAttachments: [{
        id: attachmentId, archiveId, taskId, kind: 'html', mimeType: 'text/html', displayName: 'review.html',
        size: content.length, sha256, version: sha256, createdAt: '2026-11-11T10:00:00.000Z', deleted: false
      }], workbenchAnnotations: []
    };
    const output = fs.createWriteStream(archivePath);
    await exportWorkspaceArchive({ output, workspace, attachments: [attachment] });

    const handlers = loadMain({ userData, archivePath });
    const stage = await handlers.get('backup:import')();
    assert.equal(stage.format, 'workspace-archive');
    const annotation = {
      id: 'note-transaction', taskId: targetTaskId, attachmentId: targetAttachmentId, contentHash: sha256, pageIndex: 0,
      target: { kind: 'text', selector: 'main > p', exact: 'hello', prefix: '', suffix: '', start: 0, end: 5 },
      comment: '保留原词', category: 'content', intent: 'keep',
      createdAt: '2026-11-11T10:00:00.000Z', updatedAt: '2026-11-11T10:00:00.000Z', status: 'active', selected: true
    };
    await assert.rejects(handlers.get('backup:commit-import')(null, {
      stageId: stage.stageId, attachmentIds: [], workbenchAssets: { mode: 'replace', attachments: [], annotations: [], taskIds: ['../outside'] }
    }), { code: 'BACKUP_IMPORT_INVALID_ATTACHMENT' });
    const payload = {
      attachmentIds: [archiveId],
      targetAttachmentIds: [targetAttachmentId],
      workbenchAssets: {
        mode: 'replace',
        taskIds: [targetTaskId],
        attachments: [{
          id: targetAttachmentId, archiveId: targetArchiveId, sourceArchiveId: archiveId, taskId: targetTaskId, displayName: 'review.html', kind: 'html',
          mimeType: 'text/html', size: content.length, sha256,
          version: sha256, createdAt: '2026-11-11T10:00:00.000Z', deleted: false
        }],
        annotations: [annotation],
        taskIdMap: [{ from: taskId, to: targetTaskId }],
        attachmentIdMap: [{ from: attachmentId, to: targetAttachmentId }]
      }
    };
    const committed = await handlers.get('backup:commit-import')(null, { ...payload, stageId: stage.stageId });
    assert.equal(committed.status, 'ok');
    assert.equal((await handlers.get('ppt-feedback:list-backup-attachments')(null, { taskId: targetTaskId })).attachments[0].sha256, sha256);
    assert.deepEqual(JSON.parse(JSON.stringify((await handlers.get('ppt-feedback:list-annotations')(null, { taskId: targetTaskId })).annotations)), [annotation]);

    const rolledBack = await handlers.get('backup:rollback-import')(null, committed.transactionId);
    assert.equal(rolledBack.rolledBack, true);
    assert.deepEqual(JSON.parse(JSON.stringify((await handlers.get('ppt-feedback:list-backup-attachments')(null, { taskId: targetTaskId })).attachments)), []);
    assert.deepEqual(JSON.parse(JSON.stringify((await handlers.get('ppt-feedback:list-annotations')(null, { taskId: targetTaskId })).annotations)), []);

    const persistentStage = await handlers.get('backup:import')();
    await handlers.get('backup:commit-import')(null, { ...payload, stageId: persistentStage.stageId });
    const rollbackHandlers = loadMain({ userData, archivePath });
    const rolledBackAfterRestart = await rollbackHandlers.get('backup:recover-imports')(null, { attachmentIds: [], workbenchAttachmentIds: [] });
    assert.equal(rolledBackAfterRestart.recovered, 1);
    assert.deepEqual(JSON.parse(JSON.stringify((await rollbackHandlers.get('ppt-feedback:list-backup-attachments')(null, { taskId: targetTaskId })).attachments)), []);
    assert.deepEqual(JSON.parse(JSON.stringify((await rollbackHandlers.get('ppt-feedback:list-annotations')(null, { taskId: targetTaskId })).annotations)), []);

    const restoredStage = await rollbackHandlers.get('backup:import')();
    await rollbackHandlers.get('backup:commit-import')(null, { ...payload, stageId: restoredStage.stageId });
    const restartedHandlers = loadMain({ userData, archivePath });
    const rolledForward = await restartedHandlers.get('backup:recover-imports')(null, { attachmentIds: [], workbenchAttachmentIds: [targetAttachmentId] });
    assert.equal(rolledForward.recovered, 1);
    assert.equal((await restartedHandlers.get('ppt-feedback:list-backup-attachments')(null, { taskId: targetTaskId })).attachments[0].sha256, sha256);
    assert.deepEqual(JSON.parse(JSON.stringify((await restartedHandlers.get('ppt-feedback:list-annotations')(null, { taskId: targetTaskId })).annotations)), [annotation]);
    assert.deepEqual(fs.readFileSync(path.join(userData, 'ppt-feedback', targetTaskId, targetAttachmentId, 'attachment.html')), content);
  });
});

test('ZIP 中一份工作台附件缺失时仅导入有效附件并同步清单引用', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const archivePath = path.join(directory, 'partial.zip');
    const sourceTaskId = 'task-partial-source';
    const taskId = 'task-partial-target';
    const attachmentId = '750e8400-e29b-41d4-a716-446655440001';
    const missingAttachmentId = '750e8400-e29b-41d4-a716-446655440002';
    const bytes = Buffer.from('<!doctype html><main>可恢复内容</main>');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const missingHash = 'a'.repeat(64);
    const archiveId = `${sourceTaskId}_${attachmentId}.html`;
    const missingArchiveId = `${sourceTaskId}_${missingAttachmentId}.html`;
    const project = workbenchSchema.normalizeWorkbenchProject({
      id: sourceTaskId, workbenchPersistenceEnabled: true, workbenchAttachmentId: attachmentId,
      workbenchAttachmentIds: [attachmentId, missingAttachmentId],
      workbenchDraft: { goal: '部分恢复', opinion: '', promptText: '', annotations: [] }
    });
    const createdAt = '2026-11-11T10:00:00.000Z';
    const sourceAssets = [
      { id: attachmentId, archiveId, taskId: sourceTaskId, mimeType: 'text/html', size: bytes.length, sha256, version: sha256, createdAt, deleted: false },
      { id: missingAttachmentId, archiveId: missingArchiveId, taskId: sourceTaskId, mimeType: 'text/html', size: 8, sha256: missingHash, version: missingHash, createdAt, deleted: false }
    ];
    const sourceManifest = {
      schemaVersion: workbenchSchema.WORKBENCH_SCHEMA_VERSION, taskId: sourceTaskId, revision: 2, project
    };
    const manifestBytes = Buffer.from(JSON.stringify(sourceManifest));
    const archiveManifest = {
      format: FORMAT, formatVersion: FORMAT_VERSION,
      workspace: { format: 'forward-step-workspace', scope: 'workspace', schemaVersion: 1,
        data: { projects: [project], workbenchAttachments: sourceAssets, workbenchAnnotations: [] },
        counts: { projects: 1, workbenchAttachments: 2, workbenchAnnotations: 0 } },
      attachments: sourceAssets.map(asset => ({
        id: asset.archiveId, taskId: sourceTaskId, type: asset.mimeType, size: asset.size, sha256: asset.sha256,
        path: `attachments/${sourceTaskId}/${asset.archiveId}`
      })),
      workbenchManifests: [{ taskId: sourceTaskId, revision: sourceManifest.revision, size: manifestBytes.length,
        sha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'), path: `workbench/${sourceTaskId}/workbench.json` }]
    };
    await writeZip(archivePath, [
      { name: 'manifest.json', content: JSON.stringify(archiveManifest) },
      { name: `attachments/${sourceTaskId}/${archiveId}`, content: bytes },
      { name: `workbench/${sourceTaskId}/workbench.json`, content: manifestBytes }
    ]);
    const handlers = loadMain({ userData, archivePath });
    const stage = await handlers.get('backup:import')();
    assert.deepEqual(stage.attachments.map(item => item.id), [archiveId]);
    assert.deepEqual(stage.attachmentErrors.map(item => item.id), [missingArchiveId]);
    assert.deepEqual(stage.workbenchErrors, []);

    const targetProject = workbenchSchema.normalizeWorkbenchProject({
      ...project, id: taskId, workbenchAttachmentId: attachmentId, workbenchAttachmentIds: [attachmentId]
    });
    const committed = await handlers.get('backup:commit-import')(null, {
      stageId: stage.stageId, attachmentIds: [archiveId], targetAttachmentIds: [attachmentId],
      workbenchAssets: {
        mode: 'replace', taskIds: [taskId],
        attachments: [{ ...sourceAssets[0], archiveId: `${taskId}_${attachmentId}.html`, sourceArchiveId: archiveId, taskId }],
        annotations: [],
        manifests: [{ ...sourceManifest, sourceTaskId, taskId, project: targetProject }],
        taskIdMap: [{ from: sourceTaskId, to: taskId }], attachmentIdMap: []
      }
    });
    assert.equal(committed.status, 'ok');
    assert.deepEqual((await handlers.get('workbench:read-manifest')(null, { taskId })).manifest.project.workbenchAttachmentIds, [attachmentId]);
    assert.deepEqual((await handlers.get('ppt-feedback:list-backup-attachments')(null, { taskId })).attachments.map(item => item.id), [attachmentId]);
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

test("工作台 manifest 原子保存、revision 冲突与损坏记录枚举", async () => {
  await withTemp(async userData => {
    const store = createPptFeedbackAttachmentStore({ app: { getPath: () => userData } });
    const project = { id: "task-1", goalSummary: "保留完整任务正文" };
    assert.equal(store.saveTaskManifest("task-1", { schemaVersion: 1, revision: 1, project }), 1);
    assert.equal(store.readTaskManifest("task-1").project.goalSummary, project.goalSummary);
    assert.throws(() => store.saveTaskManifest("task-1", { schemaVersion: 1, revision: 1, project }), error => error.code === "STALE_WORKBENCH_REVISION");

    const failingFs = Object.create(fs);
    failingFs.renameSync = (source, target) => {
      if (path.basename(target) === "workbench.json") throw Object.assign(new Error("rename failed"), { code: "EIO" });
      return fs.renameSync(source, target);
    };
    const failingStore = createPptFeedbackAttachmentStore({ app: { getPath: () => userData }, fs: failingFs });
    assert.throws(() => failingStore.saveTaskManifest("task-1", { schemaVersion: 1, revision: 2, project }), error => error.code === "WORKBENCH_MANIFEST_WRITE_FAILED");
    assert.equal(store.readTaskManifest("task-1").revision, 1);

    const brokenDirectory = store.getTaskDirectory("broken-task");
    fs.writeFileSync(path.join(brokenDirectory, "workbench.json"), "{", "utf8");
    const listed = store.listTaskManifests();
    assert.deepEqual(listed.manifests.map(item => item.taskId), ["task-1"]);
    assert.equal(listed.errors[0].taskId, "broken-task");
    assert.equal(listed.errors[0].code, "INVALID_WORKBENCH_MANIFEST");
    assert.throws(() => store.getTaskDirectory("../outside"), error => error.code === "INVALID_WORKBENCH_TASK_ID");
  });
});

test("工作台 manifest IPC 提供受校验的读写、列表和目录打开", async () => {
  await withTemp(async userData => {
    const archivePath = path.join(userData, "backup.zip");
    const handlers = loadMain({ userData, archivePath });
    const taskId = "task-1";
    const manifest = { schemaVersion: 1, revision: 1, project: { id: taskId, goalSummary: "任务目标" } };
    assert.deepEqual(JSON.parse(JSON.stringify(await handlers.get("workbench:save-manifest")(null, { taskId, manifest }))), { status: "ok", revision: 1 });
    assert.equal((await handlers.get("workbench:read-manifest")(null, { taskId })).manifest.revision, 1);
    assert.deepEqual((await handlers.get("workbench:list-manifests")()).manifests.map(item => item.taskId), [taskId]);
    assert.deepEqual(JSON.parse(JSON.stringify(await handlers.get("workbench:open-task-folder")(null, { taskId }))), { status: "ok" });
    await assert.rejects(handlers.get("workbench:read-manifest")(null, { taskId: "../outside" }), error => error.code === "INVALID_WORKBENCH_TASK_ID");
  });
});

test('工作台素材包只携带固定版本、去重原件和构图参考图', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const taskId = 'task-material-export';
    const sourcePath = path.join(directory, 'private-source', 'notes.md');
    await fs.promises.mkdir(path.dirname(sourcePath), { recursive: true });
    const sourceBytes = Buffer.from('# 原件\n保留原始字节', 'utf8');
    await fs.promises.writeFile(sourcePath, sourceBytes);
    const store = createPptFeedbackAttachmentStore({ app: { getPath: () => userData } });
    const attachment = await store.saveAttachment({ taskId, sourcePath, mimeType: 'text/markdown' });
    const delivery = {
      id: 'delivery-1', text: '请参考素材 1 和素材 2。', status: 'copied', createdAt: '2026-11-16T00:00:00.000Z',
      contentVersionIds: ['version-1', 'version-2'],
      materials: [
        { contentVersionId: 'version-1', title: '首页参考', kind: 'markdown', purpose: 'reference', attachmentId: attachment.id, hash: attachment.sha256, sourceRef: { sourceName: sourcePath, pageIndex: 0, region: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, path: sourcePath } },
        { contentVersionId: 'version-2', title: '同一原件的第二处引用', kind: 'markdown', purpose: 'reference', attachmentId: attachment.id, hash: attachment.sha256 }
      ],
      annotations: [], layoutIntent: { enabled: true, bounds: { width: 200, height: 100 }, nodes: [
        { nodeId: 'node-1', contentVersionId: 'version-1', x: 0, y: 0, width: 0.5, height: 1, zIndex: 1 },
        { nodeId: 'node-2', contentVersionId: 'version-2', x: 0.5, y: 0, width: 0.5, height: 1, zIndex: 2 }
      ] }
    };
    const project = workbenchSchema.normalizeWorkbenchProject({
      id: taskId, workbenchPersistenceEnabled: true,
      workbenchContents: [{ id: 'content-1', title: 'notes.md', kind: 'markdown', purpose: 'reference', versions: [
        { id: 'version-1', attachmentId: attachment.id, hash: attachment.sha256, text: sourceBytes.toString('utf8'), parseStatus: 'read' },
        { id: 'version-2', attachmentId: attachment.id, hash: attachment.sha256, text: sourceBytes.toString('utf8'), parseStatus: 'read' }
      ] }],
      workbenchPromptRounds: [{ id: 'round-1', contentVersionIds: ['version-1', 'version-2'], deliveries: [delivery] }]
    });
    const originalDelivery = JSON.stringify(project.workbenchPromptRounds[0].deliveries[0]);
    store.saveTaskManifest(taskId, { schemaVersion: workbenchSchema.WORKBENCH_SCHEMA_VERSION, taskId, revision: 1, project });
    const archivePath = path.join(directory, 'materials.zip');
    const dialogEvents = [];
    let scopeWarning;
    const handlers = loadMain({ userData, archivePath,
      onMessageBox: options => { scopeWarning = options; dialogEvents.push('warning'); },
      onSaveDialog: () => dialogEvents.push('save')
    });

    const result = await handlers.get('workbench:export-materials')(null, { taskId, roundId: 'round-1', deliveryId: 'delivery-1' });
    assert.equal(result.status, 'ok');
    assert.deepEqual(dialogEvents, ['warning', 'save']);
    assert.deepEqual(Array.from(scopeWarning.buttons), ['继续并附带完整原件', '取消并返回排除素材']);
    assert.equal(result.summary.materialCount, 2);
    assert.equal(result.summary.fileCount, 5);
    const entries = await readZipEntries(archivePath);
    assert.deepEqual(Object.keys(entries).sort(), [
      'MATERIALS.md', 'layout-reference.png', 'manifest.json', 'materials/001-notes.md', 'prompt.txt'
    ]);
    assert.deepEqual(entries['materials/001-notes.md'], sourceBytes);
    assert.deepEqual(entries['layout-reference.png'].subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
    const packageManifest = JSON.parse(entries['manifest.json'].toString('utf8'));
    assert.equal(packageManifest.materials[0].file, packageManifest.materials[1].file);
    assert.equal(packageManifest.materials[0].sourceRef.sourceName, 'notes.md');
    assert.match(packageManifest.materials[0].scopeNote, /完整原件/);
    assert.match(packageManifest.scopeNotice, /暂不能生成页面或区域图/);
    const serializedPackage = Buffer.concat(Object.values(entries)).toString('utf8');
    assert.doesNotMatch(serializedPackage, /private-source|user-data|[A-Za-z]:\\Users\\/i);
    assert.equal(JSON.stringify(store.readTaskManifest(taskId).project.workbenchPromptRounds[0].deliveries[0]), originalDelivery);
  });
});

test('工作台素材包只为图片区域生成裁剪图，不附带完整图片', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const taskId = 'task-image-range';
    const sourcePath = path.join(directory, 'quadrants.png');
    const sourceCanvas = createCanvas(80, 60);
    const sourceContext = sourceCanvas.getContext('2d');
    sourceContext.fillStyle = '#00ff00';
    sourceContext.fillRect(0, 0, 80, 60);
    sourceContext.fillStyle = '#ff0000';
    sourceContext.fillRect(20, 15, 40, 30);
    const sourceBytes = sourceCanvas.toBuffer('image/png');
    await fs.promises.writeFile(sourcePath, sourceBytes);
    const store = createPptFeedbackAttachmentStore({ app: { getPath: () => userData } });
    const attachment = await store.saveAttachment({ taskId, sourcePath, mimeType: 'image/png' });
    const region = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const project = workbenchSchema.normalizeWorkbenchProject({
      id: taskId, workbenchContents: [{ id: 'content-1', title: 'quadrants.png', kind: 'image', versions: [
        { id: 'version-1', attachmentId: attachment.id, hash: attachment.sha256, sourceRef: { region } }
      ] }],
      workbenchPromptRounds: [{ id: 'round-1', deliveries: [{ id: 'delivery-1', text: '只使用选区。', materials: [
        { contentVersionId: 'version-1', title: 'quadrants.png', kind: 'image', attachmentId: attachment.id, hash: attachment.sha256, sourceRef: { region } }
      ] }] }]
    });
    store.saveTaskManifest(taskId, { schemaVersion: 1, taskId, revision: 1, project });
    const archivePath = path.join(directory, 'materials.zip');
    const handlers = loadMain({ userData, archivePath });

    const result = await handlers.get('workbench:export-materials')(null, { taskId, roundId: 'round-1', deliveryId: 'delivery-1' });
    assert.equal(result.status, 'ok');
    const entries = await readZipEntries(archivePath);
    const packageManifest = JSON.parse(entries['manifest.json'].toString('utf8'));
    const rendered = await loadImage(entries[packageManifest.materials[0].file]);
    assert.equal(rendered.width, 40);
    assert.equal(rendered.height, 30);
    const pixels = createCanvas(rendered.width, rendered.height).getContext('2d');
    pixels.drawImage(rendered, 0, 0);
    assert.deepEqual([...pixels.getImageData(20, 15, 1, 1).data], [255, 0, 0, 255]);
    assert.equal(Object.keys(entries).some(name => name.endsWith('quadrants.png')), false);
    assert.match(packageManifest.materials[0].scopeNote, /所选区域裁剪图/);
  });
});

test('工作台素材包将 PDF 所选页渲染成单页图', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const taskId = 'task-pdf-page';
    const sourcePath = path.join(directory, 'two-pages.pdf');
    const sourceBytes = createPdf(['1 0 0 rg 0 0 100 100 re f', '0 1 0 rg 0 0 100 100 re f']);
    await fs.promises.writeFile(sourcePath, sourceBytes);
    const store = createPptFeedbackAttachmentStore({ app: { getPath: () => userData } });
    const attachment = await store.saveAttachment({ taskId, sourcePath, mimeType: 'application/pdf' });
    const sourceRef = { pageIndex: 1, region: { x: 0.5, y: 0, width: 0.5, height: 1 } };
    const project = workbenchSchema.normalizeWorkbenchProject({
      id: taskId, workbenchContents: [{ id: 'content-1', title: 'two-pages.pdf', kind: 'pdf', versions: [
        { id: 'version-1', attachmentId: attachment.id, hash: attachment.sha256, sourceRef }
      ] }],
      workbenchPromptRounds: [{ id: 'round-1', deliveries: [{ id: 'delivery-1', text: '参考第二页。', materials: [
        { contentVersionId: 'version-1', title: 'two-pages.pdf', kind: 'pdf', attachmentId: attachment.id, hash: attachment.sha256, sourceRef }
      ] }] }]
    });
    store.saveTaskManifest(taskId, { schemaVersion: 1, taskId, revision: 1, project });
    const archivePath = path.join(directory, 'materials.zip');
    const handlers = loadMain({ userData, archivePath });

    const result = await handlers.get('workbench:export-materials')(null, { taskId, roundId: 'round-1', deliveryId: 'delivery-1' });
    assert.equal(result.status, 'ok');
    const entries = await readZipEntries(archivePath);
    const packageManifest = JSON.parse(entries['manifest.json'].toString('utf8'));
    const rendered = await loadImage(entries[packageManifest.materials[0].file]);
    assert.equal(rendered.width, 100);
    assert.equal(rendered.height, 200);
    const pixels = createCanvas(rendered.width, rendered.height).getContext('2d');
    pixels.drawImage(rendered, 0, 0);
    assert.deepEqual([...pixels.getImageData(Math.floor(rendered.width / 2), Math.floor(rendered.height / 2), 1, 1).data], [0, 255, 0, 255]);
    assert.match(packageManifest.materials[0].scopeNote, /第 2 页选区图/);
    assert.equal(Object.keys(entries).some(name => name.endsWith('two-pages.pdf')), false);
  });
});

test('无法生成范围图时可在保存对话框前取消并返回排除素材', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const taskId = 'task-range-cancel';
    const sourcePath = path.join(directory, 'notes.md');
    await fs.promises.writeFile(sourcePath, '完整原件', 'utf8');
    const store = createPptFeedbackAttachmentStore({ app: { getPath: () => userData } });
    const attachment = await store.saveAttachment({ taskId, sourcePath, mimeType: 'text/markdown' });
    const sourceRef = { pageIndex: 0 };
    const project = workbenchSchema.normalizeWorkbenchProject({
      id: taskId, workbenchContents: [{ id: 'content-1', title: 'notes.md', kind: 'markdown', versions: [
        { id: 'version-1', attachmentId: attachment.id, hash: attachment.sha256, sourceRef }
      ] }],
      workbenchPromptRounds: [{ id: 'round-1', deliveries: [{ id: 'delivery-1', text: '使用第一页。', materials: [
        { contentVersionId: 'version-1', title: 'notes.md', kind: 'markdown', attachmentId: attachment.id, hash: attachment.sha256, sourceRef }
      ] }] }]
    });
    store.saveTaskManifest(taskId, { schemaVersion: 1, taskId, revision: 1, project });
    let saveDialogCalls = 0;
    let warning;
    const archivePath = path.join(directory, 'materials.zip');
    const handlers = loadMain({ userData, archivePath, messageBoxResponse: 1,
      onMessageBox: options => { warning = options; }, onSaveDialog: () => { saveDialogCalls += 1; }
    });

    const result = await handlers.get('workbench:export-materials')(null, { taskId, roundId: 'round-1', deliveryId: 'delivery-1' });
    assert.equal(result.canceled, true);
    assert.equal(result.reason, 'full-original-scope');
    assert.equal(saveDialogCalls, 0);
    assert.match(warning.detail, /返回工作台排除这些素材/);
    assert.equal(fs.existsSync(archivePath), false);
  });
});

test('原件内容与固定哈希不符时素材包导出失败并清理临时 ZIP', async () => {
  await withTemp(async directory => {
    const userData = path.join(directory, 'user-data');
    const taskId = 'task-material-tamper';
    const sourcePath = path.join(directory, 'notes.txt');
    await fs.promises.writeFile(sourcePath, '原始内容', 'utf8');
    const store = createPptFeedbackAttachmentStore({ app: { getPath: () => userData } });
    const attachment = await store.saveAttachment({ taskId, sourcePath, mimeType: 'text/plain' });
    const project = workbenchSchema.normalizeWorkbenchProject({
      id: taskId, workbenchContents: [{ id: 'content-1', title: 'notes.txt', kind: 'text', versions: [
        { id: 'version-1', attachmentId: attachment.id, hash: attachment.sha256, parseStatus: 'read' }
      ] }],
      workbenchPromptRounds: [{ id: 'round-1', deliveries: [{ id: 'delivery-1', text: '提示詞', contentVersionIds: ['version-1'], materials: [
        { contentVersionId: 'version-1', title: 'notes.txt', kind: 'text', attachmentId: attachment.id, hash: attachment.sha256 }
      ] }] }]
    });
    store.saveTaskManifest(taskId, { schemaVersion: 1, taskId, revision: 1, project });
    const storedAttachment = store.getAttachmentPath(attachment.id);
    fs.chmodSync(storedAttachment, 0o600);
    await fs.promises.writeFile(storedAttachment, '篡改内容', 'utf8');
    const archivePath = path.join(directory, 'materials.zip');
    const handlers = loadMain({ userData, archivePath });

    await assert.rejects(
      handlers.get('workbench:export-materials')(null, { taskId, roundId: 'round-1', deliveryId: 'delivery-1' }),
      error => error.code === 'WORKBENCH_EXPORT_ATTACHMENT_MISSING'
    );
    assert.equal(fs.existsSync(archivePath), false);
    assert.equal(fs.readdirSync(directory).some(name => name.startsWith('materials.zip.tmp-')), false);
  });
});
