(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepBackupManager = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const BACKUP_REASONS = new Set(["import", "replace", "merge", "clear", "bulk-delete"]);

  function shouldBackupBefore(reason) {
    return BACKUP_REASONS.has(reason);
  }

  function asDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (value === undefined || value === null || value === "") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function localDateKey(value) {
    const date = asDate(value);
    return date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : "";
  }

  function shouldBackupOnStartup(lastBackupAt, now) {
    const today = localDateKey(now === undefined ? new Date() : now);
    if (!today) return false;
    const previous = localDateKey(lastBackupAt);
    return !previous || previous !== today;
  }

  function fileTimestamp(file) {
    if (typeof file === "number") return file;
    if (typeof file === "string") {
      const parsed = Date.parse(file);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (!file || typeof file !== "object") return 0;
    if (typeof file.mtimeMs === "number") return file.mtimeMs;
    for (const field of ["mtime", "createdAt", "updatedAt", "lastModified"]) {
      const value = file[field];
      if (value instanceof Date) return value.getTime();
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
    return 0;
  }

  function keepRecentBackups(files, limit = 5) {
    if (!Array.isArray(files)) return [];
    const count = Number.isInteger(limit) && limit > 0 ? limit : 0;
    return files
      .map((file, index) => ({ file, index }))
      .sort((left, right) => fileTimestamp(right.file) - fileTimestamp(left.file) || left.index - right.index)
      .slice(0, count)
      .map(item => item.file);
  }

  return { shouldBackupBefore, shouldBackupOnStartup, keepRecentBackups };
});
