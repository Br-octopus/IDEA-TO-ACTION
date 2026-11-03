export function createClientState() {
  return { selectedTaskId: '', draftsByTask: {}, requestByTask: {}, saveStatusByTask: {}, conflictsByTask: {}, outputByTask: {} }
}

export function reduceClient(state, event) {
  switch (event.type) {
    case 'task.selected':
      return { ...state, selectedTaskId: event.taskId }
    case 'draft.changed':
      return { ...state, draftsByTask: { ...state.draftsByTask, [event.taskId]: event.draft }, saveStatusByTask: { ...state.saveStatusByTask, [event.taskId]: 'unsaved' }, conflictsByTask: Object.fromEntries(Object.entries(state.conflictsByTask).filter(([taskId]) => taskId !== event.taskId)) }
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
      return { ...state, requestByTask: { ...state.requestByTask, [event.taskId]: null }, outputByTask: { ...state.outputByTask, [event.taskId]: event.output } }
    case 'request.late':
      return state
    case 'task.deleted': {
      const next = { ...state, selectedTaskId: state.selectedTaskId === event.taskId ? '' : state.selectedTaskId }
      for (const key of ['draftsByTask', 'requestByTask', 'saveStatusByTask', 'conflictsByTask', 'outputByTask']) {
        next[key] = { ...state[key] }
        delete next[key][event.taskId]
      }
      return next
    }
    default:
      return state
  }
}
