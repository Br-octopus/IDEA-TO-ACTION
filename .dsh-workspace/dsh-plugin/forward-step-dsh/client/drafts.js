const STORAGE_PREFIX = 'forward-step-dsh:draft:v1:'

function storageKey(projectId, taskId) {
  if (!projectId || !taskId) throw new TypeError('projectId and taskId are required')
  return `${STORAGE_PREFIX}${encodeURIComponent(projectId)}:${encodeURIComponent(taskId)}`
}

function readRecord(storage, projectId, taskId) {
  const raw = storage.getItem(storageKey(projectId, taskId))
  if (!raw) return null
  const draft = JSON.parse(raw)
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new TypeError('invalid task draft')
  return draft
}

export function readTaskDraft(storage, projectId, taskId) {
  return readRecord(storage, projectId, taskId)
}

export function writeTaskDraft(storage, projectId, taskId, patch) {
  const key = storageKey(projectId, taskId)
  const current = readRecord(storage, projectId, taskId) ?? {}
  const next = { ...current, ...patch }

  if (patch.externalResult) {
    next.externalResult = { ...(current.externalResult ?? {}), ...patch.externalResult }
    if (Object.values(next.externalResult).every(value => !value)) delete next.externalResult
  }
  if (typeof next.title !== 'string' || !next.title) delete next.title

  if (Object.keys(next).length === 0) storage.removeItem(key)
  else storage.setItem(key, JSON.stringify(next))
  return next
}

export function deleteTaskDraft(storage, projectId, taskId) {
  storage.removeItem(storageKey(projectId, taskId))
}
