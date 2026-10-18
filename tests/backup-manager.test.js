const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldBackupBefore,
  shouldBackupOnStartup,
  keepRecentBackups
} = require('../prototype/backup-manager.js');

test('只允许指定原因触发操作前备份', () => {
  for (const reason of ['import', 'replace', 'merge', 'clear', 'bulk-delete']) {
    assert.equal(shouldBackupBefore(reason), true);
  }
  assert.equal(shouldBackupBefore('startup'), false);
  assert.equal(shouldBackupBefore('delete-one'), false);
  assert.equal(shouldBackupBefore(''), false);
});

test('每天首次启动按本地日期判断是否备份', () => {
  const sameDay = new Date(2026, 9, 19, 18, 30, 0);
  const earlierSameDay = new Date(2026, 9, 19, 8, 0, 0);
  const nextDay = new Date(2026, 9, 20, 8, 0, 0);

  assert.equal(shouldBackupOnStartup(null, sameDay), true);
  assert.equal(shouldBackupOnStartup(earlierSameDay, sameDay), false);
  assert.equal(shouldBackupOnStartup(earlierSameDay, nextDay), true);
  assert.equal(shouldBackupOnStartup('invalid-date', sameDay), true);
});

test('保留按修改时间排序的最近 5 个备份且不修改输入', () => {
  const files = [
    { name: 'old.json', mtimeMs: 1 },
    { name: 'newest.json', mtimeMs: 5 },
    { name: 'middle.json', mtimeMs: 3 },
    { name: 'newer.json', mtimeMs: 4 },
    { name: 'old-2.json', mtimeMs: 2 },
    { name: 'latest.json', mtimeMs: 6 }
  ];
  const before = JSON.stringify(files);

  const kept = keepRecentBackups(files);

  assert.deepEqual(kept.map(file => file.name), [
    'latest.json', 'newest.json', 'newer.json', 'middle.json', 'old-2.json'
  ]);
  assert.deepEqual(files, JSON.parse(before));
  assert.deepEqual(keepRecentBackups(files, 2).map(file => file.name), ['latest.json', 'newest.json']);
});
