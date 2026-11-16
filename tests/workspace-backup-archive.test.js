'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { Readable, Writable } = require('node:stream');
const yazl = require('yazl');
const { createPptFeedbackAttachmentStore } = require('../electron/ppt-feedback-attachment-store.js');
const appSource = fs.readFileSync(process.env.WORKBENCH_APP_SOURCE || path.join(__dirname, '../prototype/app.js'), 'utf8');

test('完整工作区备份清单包含 PPTX 和 DOCX 资料', async () => {
  const start = appSource.indexOf('  async function addWorkbenchBackupAssets(');
  assert.notEqual(start, -1);
  const context = {
    desktopApi: { pptFeedback: {
      listBackupAttachments: async () => ({ attachments: [
        { id: 'slide', taskId: 'task', displayName: 'slide.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
        { id: 'document', taskId: 'task', displayName: 'document.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
      ] }),
      listAnnotations: async () => ({ annotations: [] })
    } },
    workspaceBackup: { validateBackup() {} }
  };
  vm.createContext(context);
  vm.runInContext(appSource.slice(start, appSource.indexOf('  async function createWorkspaceBackup(', start)), context);
  const backup = { scope: 'workspace', data: { projects: [{ id: 'task' }] }, counts: {} };
  await context.addWorkbenchBackupAssets(backup);
  assert.deepEqual(Array.from(backup.data.workbenchAttachments, item => item.archiveId), ['task_slide.pptx', 'task_document.docx']);
  assert.equal(backup.counts.workbenchAttachments, 2);
});
const { createBackup, replaceState } = require('../prototype/workspace-backup.js');
const {
  FORMAT,
  FORMAT_VERSION,
  LIMITS,
  exportWorkspaceArchive,
  importWorkspaceArchive
} = require('../electron/workspace-backup-archive.js');

async function withTemp(callback) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'workspace-archive-'));
  try { await callback(directory); } finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
}

function attachment(id = 'task-1_0123456789abcdef0123456789abcdef.txt', content = 'saved text') {
  const bytes = Buffer.from(content);
  return {
    id,
    taskId: 'task-1',
    type: 'text/plain',
    size: bytes.length,
    openStream: () => Readable.from([bytes])
  };
}

test('临时工作区 ZIP 往返保留工作台附件哈希、批注、手改稿和提示词引用快照', async () => {
  await withTemp(async directory => {
    const taskId = 'task-archive';
    const attachmentId = '550e8400-e29b-41d4-a716-446655440000';
    const bytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
    const originalFile = path.join(directory, 'source.png');
    await fs.promises.writeFile(originalFile, bytes);
    const sourceStore = createPptFeedbackAttachmentStore({
      app: { getPath: () => path.join(directory, 'source-user-data') },
      createId: () => attachmentId,
      now: () => '2026-11-11T10:00:00.000Z'
    });
    const stored = await sourceStore.saveAttachment({ taskId, sourcePath: originalFile, mimeType: 'image/png' });
    const annotation = {
      id: 'note-archive', taskId, attachmentId: stored.id, contentHash: stored.sha256, pageIndex: 0,
      target: { kind: 'region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      comment: '保留图例', category: 'style', intent: 'keep', createdAt: '2026-11-11T10:01:00.000Z', updatedAt: '2026-11-11T10:02:00.000Z',
      status: 'active', selected: true, reassociatedFromId: 'note-source'
    };
    const backup = createBackup({ projects: [{
      id: taskId, idea: '修订图片对应方案', workbenchGeneratedPrompt: '生成稿',
      workbenchPromptDraft: '用户手改后的提示词', workbenchPromptVersions: [{
        id: 'prompt-v1', version: 1, createdAt: '2026-11-11T10:02:00.000Z', prompt: '生成稿',
        citations: [{ annotationId: annotation.id, attachmentId: stored.id, attachmentName: stored.displayName,
          contentHash: stored.sha256, pageIndex: 0, targetSnapshot: JSON.stringify(annotation.target),
          comment: annotation.comment, category: annotation.category, intent: annotation.intent }]
      }]
    }] }, { scope: 'workspace', now: '2026-11-11T10:03:00.000Z' });
    const metadata = sourceStore.listBackupAttachments(taskId)[0];
    const extension = '.png';
    backup.data.workbenchAttachments = [{ ...metadata, archiveId: `${taskId}_${metadata.id}${extension}` }];
    backup.data.workbenchAnnotations = [annotation];
    backup.data.projects[0].workbenchAttachmentIds = [metadata.id];
    backup.counts.workbenchAttachments = 1;
    backup.counts.workbenchAnnotations = 1;

    const archivePath = path.join(directory, 'complete-workspace.zip');
    const output = fs.createWriteStream(archivePath);
    const exported = await exportWorkspaceArchive({
      output, workspace: backup,
      attachments: [{ id: backup.data.workbenchAttachments[0].archiveId, taskId, type: metadata.mimeType,
        size: metadata.size, openStream: () => sourceStore.createReadStream(metadata.id, { includeDeleted: true }) }]
    });
    assert.equal(exported.attachmentCount, 1);

    const stageDirectory = path.join(directory, 'stage');
    await fs.promises.mkdir(stageDirectory);
    const imported = await importWorkspaceArchive({ archivePath, tempDirectory: stageDirectory });
    assert.deepEqual(imported.attachmentErrors, []);
    assert.equal(imported.attachments[0].sha256, stored.sha256);
    const targetStore = createPptFeedbackAttachmentStore({ app: { getPath: () => path.join(directory, 'target-user-data') } });
    await targetStore.importAttachment({
      taskId, id: metadata.id, mimeType: metadata.mimeType, displayName: metadata.displayName,
      size: imported.attachments[0].size, sha256: imported.attachments[0].sha256,
      sourcePath: imported.attachments[0].path, createdAt: metadata.createdAt
    });
    assert.deepEqual(await fs.promises.readFile(targetStore.getAttachmentPath(metadata.id)), bytes);
    const restored = replaceState({}, imported.workspace);
    assert.equal(restored.projects[0].workbenchPromptDraft, '用户手改后的提示词');
    assert.deepEqual(restored.projects[0].workbenchPromptVersions, backup.data.projects[0].workbenchPromptVersions);
    assert.deepEqual(restored.workbenchAnnotations, [annotation]);
    assert.equal(restored.workbenchAnnotations[0].updatedAt, '2026-11-11T10:02:00.000Z');
    assert.equal(restored.workbenchAnnotations[0].reassociatedFromId, 'note-source');
    assert.equal(restored.workbenchAttachments[0].sha256, stored.sha256);
    assert.deepEqual(restored.projects[0].workbenchAttachmentIds, [metadata.id]);
  });
});

test('阶段 D 隔离夹具完整往返旧任务、多附件、点/区域批注、写作稿件与偏好', async () => {
  await withTemp(async directory => {
    const taskId = 'legacy-task-2026';
    const attachmentIds = [
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-12d3-a456-426614174001'
    ];
    const fileInputs = [
      { displayName: '旧幻灯片.png', mimeType: 'image/png', bytes: Buffer.from('89504e470d0a1a0a00000000', 'hex') },
      { displayName: '旧说明.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4\nlegacy sample\n') }
    ];
    const sourceStore = createPptFeedbackAttachmentStore({
      app: { getPath: () => path.join(directory, 'source-user-data') },
      createId: (() => { let index = 0; return () => attachmentIds[index++]; })(),
      now: () => '2026-11-12T08:00:00.000Z'
    });
    const storedAttachments = [];
    for (const input of fileInputs) {
      const sourcePath = path.join(directory, input.displayName);
      await fs.promises.writeFile(sourcePath, input.bytes);
      storedAttachments.push(await sourceStore.saveAttachment({ taskId, sourcePath, mimeType: input.mimeType }));
    }

    const slide = storedAttachments[0];
    const annotations = [
      {
        id: 'legacy-point-note', taskId, attachmentId: slide.id, contentHash: slide.sha256, pageIndex: 0,
        target: { kind: 'point', x: 0.25, y: 0.35 }, comment: '旧点批注', category: 'content', intent: 'modify',
        createdAt: '2025-01-02T03:04:05.000Z', status: 'active', selected: true
      },
      {
        id: 'legacy-region-note', taskId, attachmentId: slide.id, contentHash: slide.sha256, pageIndex: 0,
        target: { kind: 'region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, comment: '旧区域批注', category: 'layout', intent: 'keep',
        createdAt: '2025-01-02T03:05:06.000Z', status: 'active', selected: false
      }
    ];
    const attachmentMetadata = sourceStore.listBackupAttachments(taskId).map(item => ({
      ...item,
      archiveId: `${taskId}_${item.id}${item.kind === 'pdf' ? '.pdf' : '.png'}`
    }));
    const state = {
      projects: [{
        id: taskId, title: '旧任务', idea: '从旧版工作区继续修改', workbenchAttachmentIds: attachmentIds,
        workbenchGeneratedPrompt: '旧版生成稿', workbenchPromptDraft: '用户保留的手改提示词',
        workbenchPromptVersions: [{
          id: 'legacy-prompt-v1', version: 1, createdAt: '2025-01-02T03:06:00.000Z', prompt: '旧版生成稿',
          citations: [{ annotationId: annotations[0].id, attachmentId: slide.id, attachmentName: slide.displayName,
            contentHash: slide.sha256, pageIndex: 0, targetSnapshot: JSON.stringify(annotations[0].target),
            comment: annotations[0].comment, category: annotations[0].category, intent: annotations[0].intent }]
        }]
      }],
      writingArticles: [{
        id: 'legacy-article', genre: 'article', article: { id: 'legacy-article', draft: '旧稿正文', draftRoundId: 'legacy-round-2', saveEnabled: true },
        rounds: [{ id: 'legacy-round-1', draft: '更早的稿件' }, { id: 'legacy-round-2', draft: '旧稿正文', draftDecision: {
          status: 'adopted', previousDraft: '更早的稿件', previousDraftRoundId: 'legacy-round-1', adoptedAt: '2025-01-02T03:07:00.000Z'
        } }],
        styleProfile: { id: 'legacy-style', source: 'user', traits: ['简洁'] }
      }],
      writingMemories: [{ id: 'legacy-memory', scope: 'general', preference: '优先保留原文数据', reason: '用户确认', origin: 'user-confirmed', status: 'confirmed', enabled: true }],
      writingPackSettings: [{ id: 'legacy-pack', enabled: false }],
      platformConnections: { reddit: { platform: 'reddit', status: 'ready', profileId: 'fixture', apiKey: 'must-not-export' } },
      workbenchAttachments: attachmentMetadata,
      workbenchAnnotations: annotations
    };
    const backup = createBackup(state, { scope: 'workspace', now: '2026-11-12T08:05:00.000Z' });
    assert.equal(backup.counts.workbenchAttachments, 2);
    assert.equal(backup.counts.workbenchAnnotations, 2);
    assert.doesNotMatch(JSON.stringify(backup), /must-not-export/);

    const archivePath = path.join(directory, 'legacy-workspace.zip');
    const output = fs.createWriteStream(archivePath);
    const exportResult = await exportWorkspaceArchive({
      output,
      workspace: backup,
      attachments: attachmentMetadata.map(item => ({
        id: item.archiveId, taskId, type: item.mimeType, size: item.size,
        openStream: () => sourceStore.createReadStream(item.id, { includeDeleted: true })
      }))
    });
    assert.equal(exportResult.attachmentCount, 2);

    const stageDirectory = path.join(directory, 'restore-stage');
    await fs.promises.mkdir(stageDirectory);
    const imported = await importWorkspaceArchive({ archivePath, tempDirectory: stageDirectory });
    assert.deepEqual(imported.attachmentErrors, []);
    assert.equal(imported.attachments.length, 2);
    const restoredState = replaceState({}, imported.workspace);
    assert.equal(restoredState.projects[0].id, taskId);
    assert.equal(restoredState.projects[0].workbenchPromptDraft, '用户保留的手改提示词');
    assert.deepEqual(restoredState.projects[0].workbenchPromptVersions, backup.data.projects[0].workbenchPromptVersions);
    assert.deepEqual(restoredState.workbenchAnnotations.map(item => item.target.kind), ['point', 'region']);
    assert.deepEqual(restoredState.writingArticles, backup.data.writingArticles);
    assert.deepEqual(restoredState.writingMemories, backup.data.writingMemories);
    assert.deepEqual(restoredState.writingPackSettings, backup.data.writingPackSettings);
    assert.equal(JSON.stringify(restoredState).includes('must-not-export'), false);

    const targetStore = createPptFeedbackAttachmentStore({ app: { getPath: () => path.join(directory, 'target-user-data') } });
    const importedById = new Map(imported.attachments.map(item => [item.id, item]));
    for (const original of attachmentMetadata) {
      const staged = importedById.get(original.archiveId);
      assert.equal(staged.sha256, original.sha256);
      await targetStore.importAttachment({
        taskId, id: original.id, mimeType: original.mimeType, displayName: original.displayName,
        size: staged.size, sha256: staged.sha256, sourcePath: staged.path, createdAt: original.createdAt
      });
      const restoredBytes = await fs.promises.readFile(targetStore.getAttachmentPath(original.id));
      assert.equal(createHash('sha256').update(restoredBytes).digest('hex'), original.sha256);
    }
  });
});

async function createZip(filePath, entries) {
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

function manifestFor(item, overrides = {}, digest = createHash('sha256').update('saved text').digest('hex')) {
  const manifest = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    workspace: { projects: [{ id: 'p1' }] },
    attachments: item ? [{
      id: item.id,
      taskId: item.taskId,
      type: item.type,
      size: item.size,
      sha256: digest,
      path: `attachments/${item.taskId}/${item.id}`
    }] : [],
    ...overrides
  };
  if (manifest.formatVersion === FORMAT_VERSION) {
    if (!Object.hasOwn(overrides, 'workbenchManifests')) manifest.workbenchManifests = [];
  }
  return JSON.stringify(manifest);
}

test('流式导出和导入保留工作区与已保存附件', async () => {
  await withTemp(async directory => {
    const source = attachment();
    const contentHash = createHash('sha256').update('saved text').digest('hex');
    const workspace = {
      projects: [{
        id: 'p1',
        workbenchGeneratedPrompt: '生成稿',
        workbenchPromptDraft: '手动修改后的稿件',
        workbenchPromptVersions: [{
          id: 'prompt-v1', version: 1, createdAt: '2026-11-11T00:00:00.000Z', prompt: '生成稿',
          citations: [{
            annotationId: 'note-1', attachmentId: source.id, attachmentName: '说明.txt',
            contentHash, pageIndex: 0, targetSnapshot: '{"kind":"text","exact":"原文"}',
            comment: '保留术语', category: 'content', intent: 'keep'
          }]
        }]
      }]
    };
    const archivePath = path.join(directory, 'workspace.zip');
    const output = fs.createWriteStream(archivePath);
    const exported = await exportWorkspaceArchive({ output, workspace, attachments: [source] });
    assert.deepEqual(exported, { format: FORMAT, formatVersion: FORMAT_VERSION, attachmentCount: 1 });

    const extraction = path.join(directory, 'extract');
    await fs.promises.mkdir(extraction);
    const imported = await importWorkspaceArchive({ archivePath, tempDirectory: extraction });
    assert.deepEqual(imported.workspace, workspace);
    assert.equal(imported.attachments.length, 1);
    assert.equal(await fs.promises.readFile(imported.attachments[0].path, 'utf8'), 'saved text');
    assert.equal(imported.attachments[0].id, source.id);
  });
});

test('工作区 ZIP 往返保留任务 manifest 文件', async () => {
  await withTemp(async directory => {
    const taskId = 'task-manifest';
    const workbenchManifest = {
      schemaVersion: 1, taskId, revision: 4,
      project: { id: taskId, goalSummary: '恢复工作台正文' }
    };
    const archivePath = path.join(directory, 'manifest.zip');
    const output = fs.createWriteStream(archivePath);
    await exportWorkspaceArchive({
      output, workspace: { projects: [workbenchManifest.project] },
      workbenchManifests: [workbenchManifest]
    });

    const extraction = path.join(directory, 'extract-manifest');
    await fs.promises.mkdir(extraction);
    const imported = await importWorkspaceArchive({ archivePath, tempDirectory: extraction });
    assert.deepEqual(imported.workbenchManifests, [workbenchManifest]);
    assert.deepEqual(
      JSON.parse(await fs.promises.readFile(path.join(extraction, 'workbench', taskId, 'workbench.json'), 'utf8')),
      workbenchManifest
    );
  });
});

test('当前归档保存工作台 HTML 原始附件 ID，并继续读取 v1 归档', async () => {
  await withTemp(async directory => {
    const bytes = '<!doctype html><title>工作台</title>';
    const id = 'task-html_550e8400-e29b-41d4-a716-446655440000.html';
    const source = {
      id, taskId: 'task-html', type: 'text/html', size: Buffer.byteLength(bytes),
      openStream: () => Readable.from([Buffer.from(bytes)])
    };
    const archivePath = path.join(directory, 'workbench-html.zip');
    const output = fs.createWriteStream(archivePath);
    const exported = await exportWorkspaceArchive({ output, workspace: { projects: [{ id: 'task-html' }] }, attachments: [source] });
    assert.equal(exported.formatVersion, FORMAT_VERSION);
    const v2Stage = path.join(directory, 'v2-stage');
    await fs.promises.mkdir(v2Stage);
    const imported = await importWorkspaceArchive({ archivePath, tempDirectory: v2Stage });
    assert.equal(imported.attachments[0].id, id);
    assert.equal(await fs.promises.readFile(imported.attachments[0].path, 'utf8'), bytes);

    const legacy = attachment();
    const legacyPath = path.join(directory, 'legacy-v1.zip');
    await createZip(legacyPath, [
      { name: 'manifest.json', content: manifestFor(legacy, { formatVersion: 1 }) },
      { name: `attachments/${legacy.taskId}/${legacy.id}`, content: 'saved text' }
    ]);
    const legacyStage = path.join(directory, 'v1-stage');
    await fs.promises.mkdir(legacyStage);
    const legacyImport = await importWorkspaceArchive({ archivePath: legacyPath, tempDirectory: legacyStage });
    assert.equal(legacyImport.formatVersion, 1);
    assert.equal(legacyImport.attachments.length, 1);
  });
});

test('流式导出拒绝不一致大小、重复 ID 与无效安全 ID', async () => {
  await withTemp(async directory => {
    const output = fs.createWriteStream(path.join(directory, 'bad.zip'));
    const wrongSize = { ...attachment(), size: 1 };
    await assert.rejects(exportWorkspaceArchive({ output, workspace: {}, attachments: [wrongSize] }), { code: 'SIZE_MISMATCH' });
    const duplicate = attachment();
    await assert.rejects(exportWorkspaceArchive({ output, workspace: {}, attachments: [duplicate, duplicate] }), { code: 'INVALID_ATTACHMENT' });
    await assert.rejects(exportWorkspaceArchive({
      output,
      workspace: {},
      attachments: [{ ...attachment('../escape.txt'), id: '../escape.txt' }]
    }), { code: 'INVALID_ATTACHMENT' });
  });
});

test('导入拒绝摘要不匹配且清理已写入的临时附件', async () => {
  await withTemp(async directory => {
    const archivePath = path.join(directory, 'bad-hash.zip');
    const source = attachment();
    await createZip(archivePath, [
      { name: 'manifest.json', content: manifestFor(source, {}, '0'.repeat(64)) },
      { name: `attachments/${source.taskId}/${source.id}`, content: 'saved text' }
    ]);
    const extraction = path.join(directory, 'extract');
    await fs.promises.mkdir(extraction);
    const imported = await importWorkspaceArchive({ archivePath, tempDirectory: extraction });
    assert.equal(imported.attachments.length, 0);
    assert.deepEqual(imported.attachmentErrors, [{ id: source.id, taskId: source.taskId, code: 'CHECKSUM_MISMATCH' }]);
    assert.deepEqual(await fs.promises.readdir(extraction), []);
  });
});

test('缺失附件按部分恢复返回错误明细，不阻止工作区数据恢复', async () => {
  await withTemp(async directory => {
    const source = attachment();
    const archivePath = path.join(directory, 'missing-entry.zip');
    await createZip(archivePath, [{ name: 'manifest.json', content: manifestFor(source) }]);
    const stage = path.join(directory, 'stage');
    await fs.promises.mkdir(stage);
    const imported = await importWorkspaceArchive({ archivePath, tempDirectory: stage });
    assert.deepEqual(imported.workspace, { projects: [{ id: 'p1' }] });
    assert.deepEqual(imported.attachments, []);
    assert.deepEqual(imported.attachmentErrors, [{ id: source.id, taskId: source.taskId, code: 'MISSING_ENTRY' }]);
    assert.deepEqual(await fs.promises.readdir(stage), []);
  });
});

test('ZIP 条目实际大小与 manifest 声明不一致时中止且清理暂存内容', async () => {
  await withTemp(async directory => {
    const archivePath = path.join(directory, 'size-mismatch.zip');
    const source = { ...attachment(), size: 1 };
    await createZip(archivePath, [
      { name: 'manifest.json', content: manifestFor(source) },
      { name: `attachments/${source.taskId}/${source.id}`, content: 'saved text' }
    ]);
    const extraction = path.join(directory, 'extract');
    await fs.promises.mkdir(extraction);
    await assert.rejects(importWorkspaceArchive({ archivePath, tempDirectory: extraction }), { code: 'SIZE_MISMATCH' });
    assert.deepEqual(await fs.promises.readdir(extraction), []);
  });
});

test('导入拒绝清单不在首项、路径穿越、重复条目和未知条目', async t => {
  await withTemp(async directory => {
    const extraction = path.join(directory, 'extract');
    await fs.promises.mkdir(extraction);
    const cases = [
      { name: 'manifest-not-first', entries: [{ name: 'unknown', content: 'x' }, { name: 'manifest.json', content: manifestFor() }], code: 'INVALID_MANIFEST' },
      { name: 'unknown', entries: [{ name: 'manifest.json', content: manifestFor() }, { name: 'extra', content: 'x' }], code: 'UNKNOWN_ENTRY' }
    ];
    for (const item of cases) {
      await t.test(item.name, async () => {
        const archivePath = path.join(directory, `${item.name}.zip`);
        await createZip(archivePath, item.entries);
        await assert.rejects(importWorkspaceArchive({ archivePath, tempDirectory: extraction }), { code: item.code });
      });
    }
    await t.test('traversal', async () => {
      const source = attachment();
      const archivePath = path.join(directory, 'traversal.zip');
      await createZip(archivePath, [
        { name: 'manifest.json', content: manifestFor(source) },
        { name: `attachments/${source.taskId}/${source.id}`, content: 'saved text' }
      ]);
      const bytes = await fs.promises.readFile(archivePath);
      const marker = Buffer.from('attachments');
      const occurrences = [];
      for (let offset = bytes.indexOf(marker); offset !== -1; offset = bytes.indexOf(marker, offset + marker.length)) occurrences.push(offset);
      assert.equal(occurrences.length, 2);
      for (const offset of occurrences) Buffer.from('../xxxments').copy(bytes, offset);
      await fs.promises.writeFile(archivePath, bytes);
      await assert.rejects(importWorkspaceArchive({ archivePath, tempDirectory: extraction }), { code: 'UNSAFE_PATH' });
    });
    await t.test('duplicate', async () => {
      const source = attachment();
      const archivePath = path.join(directory, 'duplicate.zip');
      const item = { name: `attachments/${source.taskId}/${source.id}`, content: 'saved text' };
      await createZip(archivePath, [
        { name: 'manifest.json', content: manifestFor(source) }, item, item
      ]);
      await assert.rejects(importWorkspaceArchive({ archivePath, tempDirectory: extraction }), { code: 'DUPLICATE_ENTRY' });
    });
  });
});

test('清单执行逐任务附件上限及附件数量上限', async () => {
  assert.equal(LIMITS.totalBytes, 2 * 1024 * 1024 * 1024);
  assert.equal(LIMITS.manifestBytes, 128 * 1024 * 1024);
  assert.equal(LIMITS.attachments, 10_000);
  assert.equal(LIMITS.attachmentBytes, 50 * 1024 * 1024);
  assert.equal(LIMITS.researchAttachmentBytes, 25 * 1024 * 1024);
  assert.equal(LIMITS.perTaskAttachmentBytes, 512 * 1024 * 1024);
  await withTemp(async directory => {
    const output = new Writable({ write(chunk, encoding, callback) { callback(); } });
    await assert.rejects(exportWorkspaceArchive({ output, workspace: {}, attachments: Array(10_001).fill(attachment()) }), { code: 'ATTACHMENT_COUNT_LIMIT' });
    const oversizedTask = Array.from({ length: 11 }, (_, index) => ({
      id: `task-1_00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}.pdf`,
      taskId: 'task-1', type: 'application/pdf', size: 50 * 1024 * 1024,
      openStream: () => Readable.from([])
    }));
    await assert.rejects(exportWorkspaceArchive({ output, workspace: {}, attachments: oversizedTask }), { code: 'TASK_ATTACHMENT_LIMIT' });
  });
});

test('导入在读取 ZIP 前拒绝超过解压总量上限的归档文件', async () => {
  await withTemp(async directory => {
    const archivePath = path.join(directory, 'oversized.zip');
    const handle = await fs.promises.open(archivePath, 'w');
    try { await handle.truncate(LIMITS.totalBytes + 1); } finally { await handle.close(); }
    await assert.rejects(
      importWorkspaceArchive({ archivePath, tempDirectory: directory }),
      error => error.code === 'ARCHIVE_SIZE_LIMIT'
    );
  });
});
