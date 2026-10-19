const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBackupStore } = require('../electron/backup-store');

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-backups-'));
}

test('自动备份固定写入用户数据目录的 backups 子目录并可读回', () => {
  const userDataPath = tempUserData();
  const store = createBackupStore({ userDataPath });

  const result = store.writeAutoBackup('{"version":1}', 'import');

  assert.match(result.filename, /^auto-\d+-import(?:-\d+)?\.json$/);
  assert.equal(fs.readFileSync(path.join(userDataPath, 'backups', result.filename), 'utf8'), '{"version":1}');
  assert.equal(store.readBackup(result.filename), '{"version":1}');
  assert.deepEqual(store.listBackups().map(item => item.filename), [result.filename]);
  assert.equal(fs.existsSync(path.join(userDataPath, result.filename)), false);

  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test('自动备份最多保留最近 5 份', () => {
  const userDataPath = tempUserData();
  const store = createBackupStore({ userDataPath });

  for (const reason of ['import', 'replace', 'merge', 'clear', 'bulk-delete', 'import']) {
    store.writeAutoBackup(`{"reason":"${reason}"}`, reason);
  }

  const backups = store.listBackups();
  assert.equal(backups.length, 5);
  assert.equal(fs.readdirSync(path.join(userDataPath, 'backups')).length, 5);
  assert.equal(backups.every(item => item.filename.endsWith('.json')), true);

  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test('只接受 JSON basename，拒绝路径穿越和非白名单原因', () => {
  const userDataPath = tempUserData();
  const secretPath = path.join(userDataPath, 'secret.json');
  fs.writeFileSync(secretPath, 'secret', 'utf8');
  const store = createBackupStore({ userDataPath });

  assert.throws(() => store.readBackup('../secret.json'), /备份文件名/);
  assert.throws(() => store.readBackup('..\\secret.json'), /备份文件名/);
  assert.throws(() => store.readBackup('secret.txt'), /备份文件名/);
  assert.throws(() => store.writeAutoBackup('{}', 'startup'), /备份原因/);
  assert.equal(fs.readFileSync(secretPath, 'utf8'), 'secret');

  fs.rmSync(userDataPath, { recursive: true, force: true });
});
