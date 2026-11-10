export function createClientState() {
  return { selectedTaskId: '', draftsByTask: {}, requestByTask: {}, saveStatusByTask: {}, conflictsByTask: {}, outputByTask: {}, unsavedOutputByTask: {}, memoryView: null, memoryError: null }
}

export function reduceClient(state, event) {
  switch (event.type) {
    case 'task.selected':
      return { ...state, selectedTaskId: event.taskId, memoryView: null, memoryError: null }
    case 'memory.loaded':
      if (state.selectedTaskId && state.selectedTaskId !== event.taskId) return state
      return { ...state, memoryView: event.view, memoryError: null }
    case 'memory.updated':
      if (state.selectedTaskId && state.selectedTaskId !== event.taskId) return state
      return { ...state, memoryView: event.view, memoryError: null }
    case 'memory.conflict':
      if (state.selectedTaskId && state.selectedTaskId !== event.taskId) return state
      return { ...state, memoryError: { kind: 'conflict', detail: event.detail ?? null } }
    case 'learning.failed':
      if (state.selectedTaskId && state.selectedTaskId !== event.taskId) return state
      return { ...state, memoryError: { kind: 'learning', jobId: event.jobId, message: event.message ?? '自动学习失败' } }
    case 'draft.changed':
      return { ...state, draftsByTask: { ...state.draftsByTask, [event.taskId]: event.draft }, saveStatusByTask: { ...state.saveStatusByTask, [event.taskId]: 'unsaved' }, conflictsByTask: Object.fromEntries(Object.entries(state.conflictsByTask).filter(([taskId]) => taskId !== event.taskId)) }
    case 'draft.restored':
      return { ...state, draftsByTask: { ...state.draftsByTask, [event.taskId]: event.draft }, saveStatusByTask: { ...state.saveStatusByTask, [event.taskId]: 'unsaved' } }
    case 'save.started':
      return { ...state, saveStatusByTask: { ...state.saveStatusByTask, [event.taskId]: 'saving' } }
    case 'save.succeeded': {
      const draftsByTask = { ...state.draftsByTask }
      delete draftsByTask[event.taskId]
      const conflictsByTask = { ...state.conflictsByTask }
      delete conflictsByTask[event.taskId]
      return { ...state, draftsByTask, conflictsByTask, saveStatusByTask: { ...state.saveStatusByTask, [event.taskId]: 'saved' } }
    }
    case 'save.failed':
      return { ...state, draftsByTask: { ...state.draftsByTask, [event.taskId]: event.draft }, saveStatusByTask: { ...state.saveStatusByTask, [event.taskId]: 'unsaved' } }
    case 'conflict':
      return { ...state, draftsByTask: { ...state.draftsByTask, [event.taskId]: event.localDraft }, saveStatusByTask: { ...state.saveStatusByTask, [event.taskId]: 'conflict' }, conflictsByTask: { ...state.conflictsByTask, [event.taskId]: { localDraft: event.localDraft, serverVersion: event.serverVersion ?? null } } }
    case 'request.started':
      return { ...state, requestByTask: { ...state.requestByTask, [event.taskId]: event.requestId } }
    case 'request.completed':
      if (state.requestByTask[event.taskId] !== event.requestId) return state
      return { ...state, requestByTask: { ...state.requestByTask, [event.taskId]: null }, outputByTask: { ...state.outputByTask, [event.taskId]: event.output }, unsavedOutputByTask: { ...state.unsavedOutputByTask, [event.taskId]: false } }
    case 'request.unsaved':
      if (state.requestByTask[event.taskId] !== event.requestId) return state
      return { ...state, requestByTask: { ...state.requestByTask, [event.taskId]: null }, outputByTask: { ...state.outputByTask, [event.taskId]: event.output }, unsavedOutputByTask: { ...state.unsavedOutputByTask, [event.taskId]: true } }
    case 'request.failed':
    case 'request.cancelled':
      if (state.requestByTask[event.taskId] !== event.requestId) return state
      return { ...state, requestByTask: { ...state.requestByTask, [event.taskId]: null }, outputByTask: { ...state.outputByTask, [event.taskId]: event.output }, unsavedOutputByTask: { ...state.unsavedOutputByTask, [event.taskId]: false } }
    case 'request.late':
      return state
    case 'task.deleted': {
      const next = { ...state, selectedTaskId: state.selectedTaskId === event.taskId ? '' : state.selectedTaskId }
      for (const key of ['draftsByTask', 'requestByTask', 'saveStatusByTask', 'conflictsByTask', 'outputByTask', 'unsavedOutputByTask']) {
        next[key] = { ...state[key] }
        delete next[key][event.taskId]
      }
      return next
    }
    default:
      return state
  }
}
