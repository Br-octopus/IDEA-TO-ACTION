export function initialState() {
  return {
    schemaVersion: 1,
    revision: 0,
    projects: [],
    tasks: [],
    bindings: [],
    memories: [],
    changes: [],
    suppressions: [],
    sources: [],
    learning: { paused: false, jobs: [] },
    processedEvents: [],
  }
}
