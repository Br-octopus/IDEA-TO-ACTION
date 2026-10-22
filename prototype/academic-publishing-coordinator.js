(function (root, factory) {
  const publishing = typeof module === 'object' && module.exports && typeof require === 'function'
    ? require('./academic-publishing.js')
    : root.ForwardStepAcademicPublishing;
  const api = factory(publishing);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepAcademicPublishingCoordinator = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (publishing) {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  let idSequence = 0;
  const makeId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++idSequence}-${Math.random().toString(36).slice(2)}`}`;

  function createAcademicPublishingCoordinator(dependencies = {}) {
    const model = dependencies.publishing || publishing;
    const getState = typeof dependencies.getState === 'function' ? dependencies.getState : () => ({});
    const persistState = typeof dependencies.persistState === 'function' ? dependencies.persistState : null;
    const getKnowledgeEntries = typeof dependencies.getKnowledgeEntries === 'function'
      ? dependencies.getKnowledgeEntries
      : () => getState()?.knowledgeEntries || [];
    const newId = dependencies.newId || makeId;
    const now = dependencies.now || (() => new Date().toISOString());
    const sessions = new Map();
    let persistence = Promise.resolve();

    function state() { return getState() || {}; }
    function savedProjects() {
      return (Array.isArray(state().academicResponseProjects) ? state().academicResponseProjects : [])
        .map(item => model.normalizeProject(item));
    }
    function project(projectId) {
      const active = sessions.get(projectId);
      if (active) return model.normalizeProject(active);
      const saved = savedProjects().find(item => item.id === projectId);
      if (!saved) throw Object.assign(new Error(`找不到学术核验项目：${projectId}`), { code: 'PROJECT_NOT_FOUND' });
      sessions.set(projectId, saved);
      return model.normalizeProject(saved);
    }
    function listProjects() {
      const projects = new Map(savedProjects().map(item => [item.id, item]));
      for (const [id, item] of sessions) projects.set(id, model.normalizeProject(item));
      return [...projects.values()].map(clone);
    }
    function getProject(projectId) {
      try { return clone(project(projectId)); } catch (error) {
        if (error.code === 'PROJECT_NOT_FOUND') return null;
        throw error;
      }
    }
    function stateWithProject(base, item, remove = false) {
      const next = clone(base);
      const projects = Array.isArray(next.academicResponseProjects) ? next.academicResponseProjects : [];
      next.academicResponseProjects = remove
        ? projects.filter(saved => saved.id !== item.id)
        : [...projects.filter(saved => saved.id !== item.id), clone(item)];
      return next;
    }
    function persist(nextState) {
      if (!persistState) throw Object.assign(new Error('未配置本机保存方法。'), { code: 'PERSIST_UNAVAILABLE' });
      const operation = persistence.then(async () => {
        const result = await persistState(nextState);
        if (result === false || result?.warning || result?.error) {
          throw new Error(result?.warning?.message || result?.error?.message || '学术核验项目保存失败。');
        }
        return result;
      });
      persistence = operation.catch(() => {});
      return operation;
    }
    function packSnapshot() {
      const pack = dependencies.builtinPack || {};
      return model.normalizePackSnapshot({
        id: pack.id,
        name: pack.name,
        version: pack.version,
        sourceIds: (pack.sources || []).map(source => source.id),
        sources: (pack.sources || []).map(source => ({
          id: source.id, title: source.title, url: source.url,
          version: source.version, verificationStatus: source.verificationStatus
        }))
      });
    }
    async function commitProject(nextProject, sessionProject = nextProject) {
      const normalized = model.normalizeProject(nextProject);
      if (normalized.saveEnabled !== true) {
        sessions.set(normalized.id, normalized);
        return clone(normalized);
      }
      const result = await persist(stateWithProject(state(), normalized));
      const canonical = Array.isArray(result?.academicResponseProjects)
        ? result.academicResponseProjects.find(item => item.id === normalized.id) : null;
      sessions.set(normalized.id, model.normalizeProject(sessionProject || canonical || normalized));
      return clone(sessions.get(normalized.id));
    }
    async function mutateProject(projectId, transform) {
      const current = project(projectId);
      const next = model.normalizeProject(transform(current));
      next.updatedAt = now();
      return commitProject(next);
    }
    function knowledgeEntry(id) {
      const entry = (getKnowledgeEntries() || []).find(item => item?.id === id && item?.type === 'academic-literature');
      if (!entry) throw Object.assign(new Error(`文献库中找不到文献：${id}`), { code: 'LITERATURE_NOT_FOUND' });
      const literature = entry.literature || {};
      return {
        knowledgeEntryId: entry.id,
        snapshot: {
          title: entry.title,
          authors: literature.authors || [],
          year: literature.year || '',
          publication: literature.publication || '',
          volume: literature.volume || '',
          issue: literature.issue || '',
          pages: literature.pages || '',
          doi: literature.doi || '',
          pmid: literature.pmid || '',
          metadataProvider: literature.metadataProvider || entry.sourceType || '',
          queriedAt: literature.queriedAt || '',
          metadataStatus: literature.metadataStatus || 'unverified',
          readingStatus: literature.readingStatus || 'unread'
        },
        metadataStatus: literature.metadataStatus || 'unverified',
        readingStatus: literature.readingStatus || 'unread',
        relation: 'unassessed', evidenceExcerpt: '', evidenceLocation: '', userNote: ''
      };
    }
    function withHistory(projectInput, transform) {
      const current = project(projectInput);
      const next = model.normalizeProject(transform(current));
      next.updatedAt = now();
      return commitProject(next);
    }

    return {
      listProjects,
      getProject,
      refreshFromStorage() { sessions.clear(); return listProjects(); },
      async createProject(input = {}) {
        if (listProjects().length >= model.getProjectCountLimit()) throw Object.assign(new Error('学术核验项目数量已达上限。'), { code: 'ITEM_LIMIT_EXCEEDED' });
        const id = input.id || newId('academic-publishing');
        if (sessions.has(id) || savedProjects().some(item => item.id === id)) throw Object.assign(new Error('学术核验项目 ID 已存在。'), { code: 'DUPLICATE_PROJECT' });
        const created = model.createProject({ ...input, id, packSnapshot: input.packSnapshot || packSnapshot() });
        sessions.set(created.id, created);
        return clone(created);
      },
      async updateProject(projectId, changes = {}) {
        const allowed = new Set(['title', 'taskType', 'target']);
        return mutateProject(projectId, current => {
          const next = { ...current };
          for (const [key, value] of Object.entries(changes || {})) {
            if (!allowed.has(key)) continue;
            next[key] = key === 'target' ? { ...current.target, ...(value || {}) } : value;
          }
          return next;
        });
      },
      async deleteProject(projectId) {
        const current = project(projectId);
        if (savedProjects().some(item => item.id === projectId)) await persist(stateWithProject(state(), current, true));
        sessions.delete(current.id);
        return true;
      },
      async setSaveEnabled(projectId, enabled) {
        const current = project(projectId);
        if (enabled === true) return commitProject(model.normalizeProject({ ...current, saveEnabled: true, updatedAt: now() }));
        const saved = savedProjects().find(item => item.id === projectId);
        if (saved?.saveEnabled) {
          const pausedSnapshot = model.normalizeProject({ ...saved, saveEnabled: false });
          const sessionSnapshot = model.normalizeProject({ ...current, saveEnabled: false, updatedAt: now() });
          await persist(stateWithProject(state(), pausedSnapshot));
          sessions.set(projectId, sessionSnapshot);
          return clone(sessionSnapshot);
        }
        const paused = model.normalizeProject({ ...current, saveEnabled: false, updatedAt: now() });
        sessions.set(projectId, paused);
        return clone(paused);
      },
      async addCitationClaim(projectId, claimInput, knowledgeEntryIds = []) {
        const sources = [...new Set((knowledgeEntryIds || []).map(String))].map(knowledgeEntry);
        return mutateProject(projectId, current => model.addCitationClaim(current, { ...claimInput, sources }));
      },
      async updateCitationSource(projectId, claimId, sourceId, changes) {
        return mutateProject(projectId, current => model.updateCitationSource(current, claimId, sourceId, changes));
      },
      compareBibliography(projectId, claimId, sourceId, returnedMetadata) {
        const current = project(projectId);
        const claim = current.citationClaims.find(item => item.id === claimId);
        const source = claim?.sources.find(item => item.id === sourceId);
        if (!source) throw Object.assign(new Error('找不到论断的文献来源。'), { code: 'SOURCE_NOT_FOUND' });
        return model.compareBibliography(source.snapshot, returnedMetadata);
      },
      async addReviewerRound(projectId, input) {
        return mutateProject(projectId, current => model.addReviewerRound(current, { ...input, id: input.id || newId('review-round') }));
      },
      async addReviewerComment(projectId, roundId, input) {
        return mutateProject(projectId, current => model.addReviewerComment(current, roundId, { ...input, id: input.id || newId('comment') }));
      },
      async resolveReviewerComment(projectId, roundId, commentId, resolution) {
        return mutateProject(projectId, current => model.resolveReviewerComment(current, roundId, commentId, resolution));
      },
      async addRequirementCard(projectId, input) {
        return mutateProject(projectId, current => model.addRequirementCard(current, { ...input, id: input.id || newId('requirement') }));
      },
      async updateRequirementCard(projectId, requirementId, changes) {
        return mutateProject(projectId, current => model.updateRequirementCard(current, requirementId, changes));
      },
      async addChecklistItem(projectId, input) {
        return mutateProject(projectId, current => model.addChecklistItem(current, { ...input, id: input.id || newId('check') }));
      },
      async updateChecklistItem(projectId, itemId, changes) {
        return mutateProject(projectId, current => model.updateChecklistItem(current, itemId, changes));
      },
      getCitationCoverage(projectId) { return model.getCitationCoverage(project(projectId)); },
      getReviewerCoverage(projectId) { return model.getReviewerCoverage(project(projectId)); },
      getChecklistCoverage(projectId) { return model.getChecklistCoverage(project(projectId)); },
      async generatePrompt(projectId, taskType, selectedIds) {
        const current = project(projectId);
        const builders = {
          'citation-check': model.buildCitationCheckPrompt,
          'reviewer-response': model.buildReviewerResponsePrompt,
          'submission-prep': model.buildSubmissionPrepPrompt
        };
        const builder = builders[taskType];
        if (!builder) throw Object.assign(new Error('学术任务类型无效。'), { code: 'INVALID_TASK_TYPE' });
        const prompt = builder(current, selectedIds);
        const round = {
          id: newId('publishing-round'), taskType, prompt, selectedIds: [...selectedIds],
          status: 'generated', resultSource: 'none', packSnapshot: current.packSnapshot, createdAt: now()
        };
        const updated = await withHistory(projectId, item => model.addPromptRound(item, round));
        return { ...clone(updated.history.find(item => item.id === round.id)), roundId: round.id };
      },
      async updatePrompt(projectId, historyId, prompt) {
        const current = project(projectId);
        const source = current.history.find(item => item.id === historyId);
        if (!source) throw Object.assign(new Error('找不到提示词版本。'), { code: 'HISTORY_NOT_FOUND' });
        const round = {
          ...source, id: newId('publishing-round'), parentId: source.id, prompt,
          result: '', resultSource: 'none', status: 'edited', createdAt: now()
        };
        const updated = await withHistory(projectId, item => model.addPromptRound(item, round));
        return clone(updated.history.find(item => item.id === round.id));
      },
      async markPromptCopied(projectId, historyId, prompt) {
        const current = project(projectId);
        const source = current.history.find(item => item.id === historyId);
        if (!source) throw Object.assign(new Error('找不到要复制的提示词版本。'), { code: 'HISTORY_NOT_FOUND' });
        if (typeof prompt === 'string' && prompt !== source.prompt) {
          const round = { ...source, id: newId('publishing-round'), parentId: source.id, prompt, result: '', resultSource: 'none', status: 'copied', createdAt: now() };
          const updated = await withHistory(projectId, item => model.addPromptRound(item, round));
          return clone(updated.history.find(item => item.id === round.id));
        }
        const history = current.history.map(item => item.id === historyId ? { ...item, status: 'copied' } : item);
        const updated = await withHistory(projectId, item => ({ ...item, history }));
        return clone(updated.history.find(item => item.id === historyId));
      },
      async storeExternalResult(projectId, historyId, result, resultSource = 'manual') {
        const current = project(projectId);
        const source = current.history.find(item => item.id === historyId);
        if (!source) throw Object.assign(new Error('找不到提示词轮次。'), { code: 'HISTORY_NOT_FOUND' });
        if (source.status === 'returned') throw Object.assign(new Error('该提示词轮次已带回结果，请另建版本。'), { code: 'RESULT_ALREADY_RETURNED' });
        const updated = await withHistory(projectId, item => model.attachExternalResult(item, historyId, result, resultSource));
        return clone(updated.history.find(item => item.id === historyId));
      }
    };
  }

  return { createAcademicPublishingCoordinator };
});
