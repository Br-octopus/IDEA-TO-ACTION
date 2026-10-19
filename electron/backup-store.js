const fs = require('node:fs');
const path = require('node:path');

const BACKUP_DIRECTORY = 'backups';
const BACKUP_REASONS = new Set(['import', 'replace', 'merge', 'clear', 'bulk-delete']);

function createBackupStore({ userDataPath, fsModule = fs, pathModule = path } = {}) {
  if (typeof userDataPath !== 'string' || !userDataPath) {
    throw new TypeError('缺少 userData 路径');
  }

  const backupDirectory = pathModule.join(userDataPath, BACKUP_DIRECTORY);
  let sequence = 0;

  function ensureBackupDirectory() {
    fsModule.mkdirSync(backupDirectory, { recursive: true });
  }

  function isSafeFilename(filename) {
    return typeof filename === 'string'
      && filename.length > 5
      && filename === pathModule.basename(filename)
      && !filename.includes('/')
      && !filename.includes('\\')
      && filename.toLowerCase().endsWith('.json');
  }

  function safeFilename(filename) {
    if (!isSafeFilename(filename)) throw new TypeError('备份文件名必须是单层 JSON basename');
    return filename;
  }

  function backupPath(filename) {
    return pathModule.join(backupDirectory, safeFilename(filename));
  }

  function listBackups() {
    if (!fsModule.existsSync(backupDirectory)) return [];

    return fsModule.readdirSync(backupDirectory)
      .filter(filename => isSafeFilename(filename))
      .map(filename => {
        const filePath = pathModule.join(backupDirectory, filename);
        const stats = fsModule.statSync(filePath);
        return { filename, mtimeMs: stats.mtimeMs, size: stats.size };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs || right.filename.localeCompare(left.filename));
  }

  function nextFilename(reason) {
    const timestamp = Date.now();
    let filename;
    do {
      sequence += 1;
      filename = `auto-${timestamp}-${reason}-${sequence}.json`;
    } while (fsModule.existsSync(pathModule.join(backupDirectory, filename)));
    return filename;
  }

  function serializeContent(content) {
    if (typeof content === 'string' || Buffer.isBuffer(content)) return content;
    const serialized = JSON.stringify(content);
    if (serialized === undefined) throw new TypeError('备份内容必须是字符串或可序列化对象');
    return serialized;
  }

  function writeAutoBackup(content, reason) {
    if (!BACKUP_REASONS.has(reason)) throw new TypeError('备份原因不在允许的白名单中');
    ensureBackupDirectory();
    const filename = nextFilename(reason);
    fsModule.writeFileSync(backupPath(filename), serializeContent(content), {
      encoding: 'utf8',
      mode: 0o600
    });
    deleteOldBackups();
    return { filename };
  }

  function readBackup(filename) {
    return fsModule.readFileSync(backupPath(filename), 'utf8');
  }

  function deleteOldBackups(limit = 5) {
    if (!Number.isInteger(limit) || limit < 0) throw new TypeError('备份保留数量必须是非负整数');
    const backups = listBackups();
    const deleted = backups.slice(limit).map(backup => {
      fsModule.unlinkSync(backupPath(backup.filename));
      return backup.filename;
    });
    return deleted;
  }

  return { writeAutoBackup, listBackups, readBackup, deleteOldBackups };
}

module.exports = { BACKUP_DIRECTORY, BACKUP_REASONS, createBackupStore };
