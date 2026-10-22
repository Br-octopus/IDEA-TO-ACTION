'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const yazl = require('yazl');
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
  return JSON.stringify({
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
  });
}

test('流式导出和导入保留工作区与已保存附件', async () => {
  await withTemp(async directory => {
    const source = attachment();
    const archivePath = path.join(directory, 'workspace.zip');
    const output = fs.createWriteStream(archivePath);
    const exported = await exportWorkspaceArchive({ output, workspace: { projects: [{ id: 'p1' }] }, attachments: [source] });
    assert.deepEqual(exported, { format: FORMAT, formatVersion: FORMAT_VERSION, attachmentCount: 1 });

    const extraction = path.join(directory, 'extract');
    await fs.promises.mkdir(extraction);
    const imported = await importWorkspaceArchive({ archivePath, tempDirectory: extraction });
    assert.deepEqual(imported.workspace, { projects: [{ id: 'p1' }] });
    assert.equal(imported.attachments.length, 1);
    assert.equal(await fs.promises.readFile(imported.attachments[0].path, 'utf8'), 'saved text');
    assert.equal(imported.attachments[0].id, source.id);
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
    await assert.rejects(importWorkspaceArchive({ archivePath, tempDirectory: extraction }), { code: 'CHECKSUM_MISMATCH' });
    assert.deepEqual(await fs.promises.readdir(extraction), []);
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
  assert.equal(LIMITS.attachmentBytes, 25 * 1024 * 1024);
  await withTemp(async directory => {
    const output = fs.createWriteStream(path.join(directory, 'unused.zip'));
    await assert.rejects(exportWorkspaceArchive({ output, workspace: {}, attachments: Array(10_001).fill(attachment()) }), { code: 'ATTACHMENT_COUNT_LIMIT' });
    const first = { ...attachment('task-1_0123456789abcdef0123456789abcdef.txt'), size: 15 * 1024 * 1024 };
    const second = { ...attachment('task-1_1123456789abcdef0123456789abcdef.txt'), size: 11 * 1024 * 1024 };
    await assert.rejects(exportWorkspaceArchive({ output, workspace: {}, attachments: [first, second] }), { code: 'TASK_ATTACHMENT_LIMIT' });
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
