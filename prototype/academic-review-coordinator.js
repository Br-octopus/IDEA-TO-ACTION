(function (root, factory) {
  const review = typeof module === 'object' && module.exports && typeof require === 'function'
    ? require('./academic-review.js')
    : root.ForwardStepAcademicReview;
  const api = factory(review);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepAcademicReviewCoordinator = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (review) {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  let idSequence = 0;
  const makeId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++idSequence}-${Math.random().toString(36).slice(2)}`}`;
  const now = () => new Date().toISOString();
  const MAX_PROMPT_CHARS = 8000;
  const MAX_RESULT_CHARS = 20000;

  function createAcademicReviewCoordinator(dependencies = {}) {
    const model = dependencies.review || review;
    const getState = typeof dependencies.getState === 'function' ? dependencies.getState : () => ({});
    const persistState = typeof dependencies.persistState === 'function' ? dependencies.persistState : null;
    const newId = dependencies.newId || makeId;
    const nowFn = dependencies.now || now;
    const sessions = new Map();
    let persistence = Promise.resolve();

    function state() { return getState() || {}; }
    function savedProjects() {
      return (Array.isArray(state().writingReviews) ? state().writingReviews : [])
        .map(item => model.normalizeReviewProject(item));
    }
    function project(projectId) {
      const current = sessions.get(projectId);
      if (current) return model.normalizeReviewProject(current);
      const saved = savedProjects().find(item => item.id === projectId);
      if (!saved) throw Object.assign(new Error(`找不到综述项目：${projectId}`), { code: 'PROJECT_NOT_FOUND' });
      sessions.set(projectId, saved);
      return model.normalizeReviewProject(saved);
    }
    function listProjects() {
      const projects = new Map(savedProjects().map(item => [item.id, item]));
      for (const [id, item] of sessions) projects.set(id, model.normalizeReviewProject(item));
      return [...projects.values()].map(clone);
    }
    function getProject(projectId) {
      try { return clone(project(projectId)); } catch (error) {
        if (error.code === 'PROJECT_NOT_FOUND') return null;
        throw error;
      }
    }
    function currentKnowledgeEntries() {
      if (typeof dependencies.getKnowledgeEntries === 'function') return dependencies.getKnowledgeEntries() || [];
      return Array.isArray(state().knowledgeEntries) ? state().knowledgeEntries : [];
    }
    function stateWithProject(base, item, remove = false) {
      const next = clone(base);
      const projects = Array.isArray(next.writingReviews) ? next.writingReviews : [];
      next.writingReviews = remove
        ? projects.filter(saved => saved.id !== item.id)
        : [...projects.filter(saved => saved.id !== item.id), clone(item)];
      return next;
    }
    function persist(nextState) {
      if (!persistState) throw Object.assign(new Error('未配置本机保存方法。'), { code: 'PERSIST_UNAVAILABLE' });
      const operation = persistence.then(async () => {
        const result = await persistState(nextState);
        if (result === false || result?.warning || result?.error) {
          throw new Error(result?.warning?.message || result?.error?.message || '综述项目保存失败。');
        }
        return result;
      });
      persistence = operation.catch(() => {});
      return operation;
    }
    async function commitProject(nextProject, sessionProject = nextProject) {
      const normalized = model.normalizeReviewProject(nextProject);
      if (normalized.saveEnabled !== true) {
        sessions.set(normalized.id, normalized);
        return clone(normalized);
      }
      const result = await persist(stateWithProject(state(), normalized));
      const canonical = Array.isArray(result?.writingReviews)
        ? result.writingReviews.find(item => item.id === normalized.id) : null;
      sessions.set(normalized.id, model.normalizeReviewProject(sessionProject || canonical || normalized));
      return clone(sessions.get(normalized.id));
    }
    async function persistProjectSnapshot(snapshot, sessionProject) {
      const normalized = model.normalizeReviewProject(snapshot);
      await persist(stateWithProject(state(), normalized));
      sessions.set(normalized.id, model.normalizeReviewProject(sessionProject || normalized));
      return clone(sessions.get(normalized.id));
    }
    async function mutateProject(projectId, transform) {
      const current = project(projectId);
      const next = model.normalizeReviewProject(transform(current));
      next.updatedAt = nowFn();
      return commitProject(next);
    }
    function makeRoundId() { return newId('round'); }

    async function generatePrompt(projectId, stageOrBatchId) {
      const current = project(projectId);
      const isPlan = stageOrBatchId === 'plan';
      const batch = isPlan ? null : current.batches.find(item => item.id === stageOrBatchId);
      if (!isPlan && !batch) throw Object.assign(new Error('找不到当前项目的固定批次。'), { code: 'BATCH_NOT_FOUND' });
      const stage = isPlan ? 'plan' : batch.stage;
      const result = model.generateReviewPrompt(current, stage, batch);
      const round = {
        id: makeRoundId(), stage, batchId: batch?.id || '',
        promptVersionId: '', parentPromptId: '',
        reviewer: batch?.reviewer || 'reviewerOne', recordIds: [...result.recordIds],
        prompt: result.prompt, result: '', status: 'generated', candidates: [], error: '',
        inputCount: result.inputCount, inputChars: result.inputChars, createdAt: nowFn()
      };
      round.promptVersionId = round.id;
      const next = model.normalizeReviewProject({ ...current, rounds: [...current.rounds, round], updatedAt: nowFn() });
      await commitProject(next);
      return { ...result, roundId: round.id, round: clone(round) };
    }

    return {
      listProjects,
      getProject,
      refreshFromStorage() { sessions.clear(); return listProjects(); },
      async createProject(input = {}) {
        const id = input.id || newId('review');
        if (sessions.has(id) || savedProjects().some(item => item.id === id)) {
          throw Object.assign(new Error('综述项目 ID 已存在。'), { code: 'DUPLICATE_PROJECT' });
        }
        const created = model.createReviewProject({ ...input, id });
        sessions.set(created.id, created);
        return clone(created);
      },
      async updateProject(projectId, changes = {}) {
        const allowed = new Set(['title', 'reviewType', 'question', 'scope', 'audience', 'inclusionCriteria', 'exclusionCriteria', 'screeningModel', 'synthesisMethod', 'batchSize', 'searchLogs', 'extractionFields']);
        return mutateProject(projectId, current => ({ ...current,
          ...Object.fromEntries(Object.entries(changes || {}).filter(([key]) => allowed.has(key)))
        }));
      },
      async deleteProject(projectId) {
        const current = project(projectId);
        const hasSaved = savedProjects().some(item => item.id === projectId);
        if (hasSaved) {
          const nextState = clone(state());
          nextState.writingReviews = (Array.isArray(nextState.writingReviews) ? nextState.writingReviews : [])
            .filter(item => item.id !== projectId);
          await persist(nextState);
        }
        sessions.delete(current.id);
        return true;
      },
      async setSaveEnabled(projectId, enabled) {
        const current = project(projectId);
        if (enabled === true) {
          return commitProject(model.normalizeReviewProject({ ...current, saveEnabled: true, updatedAt: nowFn() }));
        }
        const saved = savedProjects().find(item => item.id === projectId);
        if (saved?.saveEnabled) {
          const pausedSnapshot = model.normalizeReviewProject({ ...saved, saveEnabled: false });
          const sessionSnapshot = model.normalizeReviewProject({ ...current, saveEnabled: false, updatedAt: nowFn() });
          return persistProjectSnapshot(pausedSnapshot, sessionSnapshot);
        }
        const paused = model.normalizeReviewProject({ ...current, saveEnabled: false, updatedAt: nowFn() });
        sessions.set(projectId, paused);
        return clone(paused);
      },
      async previewLiteratureRefresh(projectId, selectedIds) {
        return model.previewLiteratureRefresh(project(projectId), selectedIds, currentKnowledgeEntries());
      },
      async confirmLiteratureRefresh(projectId, preview) {
        const result = model.confirmLiteratureRefresh(project(projectId), preview, currentKnowledgeEntries());
        await commitProject(result.project);
        return clone(result);
      },
      async updateExtractionFields(projectId, fields) {
        return mutateProject(projectId, current => model.updateExtractionFields(current, fields));
      },
      async setScreeningDecision(projectId, recordId, reviewer, input) {
        return mutateProject(projectId, current => model.setScreeningDecision(current, recordId, 'title-abstract', reviewer, input));
      },
      async adjudicate(projectId, recordId, input) {
        return mutateProject(projectId, current => model.adjudicateScreeningDecision(current, recordId, input));
      },
      async setFullTextDecision(projectId, recordId, input) {
        return mutateProject(projectId, current => model.setFullTextDecision(current, recordId, input));
      },
      async setNarrativeSelection(projectId, recordId, selected) {
        return mutateProject(projectId, current => model.setNarrativeSelection(current, recordId, selected));
      },
      async setExtractionValue(projectId, recordId, fieldId, input) {
        return mutateProject(projectId, current => model.setExtractionValue(current, recordId, fieldId, input));
      },
      getCoverage(projectId) { return model.getReviewCoverage(project(projectId)); },
      async createBatches(projectId, stage, options = {}) {
        const batches = model.createReviewBatches(project(projectId), stage, options);
        if (!batches.length) return [];
        await mutateProject(projectId, current => ({ ...current, batches: [...current.batches, ...batches] }));
        return clone(batches);
      },
      generatePrompt,
      async generatePlanPrompt(projectId) { return generatePrompt(projectId, 'plan'); },
      async updatePrompt(projectId, roundId, prompt) {
        if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_CHARS) throw new Error(`提示词最多 ${MAX_PROMPT_CHARS} 字。`);
        const current = project(projectId);
        const sourceRound = current.rounds.find(item => item.id === roundId);
        if (!sourceRound) throw Object.assign(new Error('找不到要编辑的提示词版本。'), { code: 'ROUND_NOT_FOUND' });
        const edited = {
          ...sourceRound, id: makeRoundId(), promptVersionId: '', parentPromptId: sourceRound.id,
          prompt, result: '', status: 'edited', candidates: [], error: '', createdAt: nowFn()
        };
        edited.promptVersionId = edited.id;
        const next = model.normalizeReviewProject({ ...current, rounds: [...current.rounds, edited], updatedAt: nowFn() });
        await commitProject(next);
        return clone(next.rounds.find(item => item.id === edited.id));
      },
      async markPromptCopied(projectId, roundId, prompt) {
        if (typeof prompt === 'string' && prompt.length > MAX_PROMPT_CHARS) throw new Error(`提示词最多 ${MAX_PROMPT_CHARS} 字。`);
        const current = project(projectId);
        const sourceRound = current.rounds.find(item => item.id === roundId);
        if (!sourceRound) throw Object.assign(new Error('找不到要复制的提示词版本。'), { code: 'ROUND_NOT_FOUND' });
        let copied;
        let rounds;
        if (typeof prompt === 'string' && prompt !== sourceRound.prompt) {
          copied = {
            ...sourceRound, id: makeRoundId(), promptVersionId: '', parentPromptId: sourceRound.id,
            prompt, result: '', status: 'copied', candidates: [], error: '', createdAt: nowFn()
          };
          copied.promptVersionId = copied.id;
          rounds = [...current.rounds, copied];
        } else {
          copied = { ...sourceRound, status: 'copied' };
          rounds = current.rounds.map(item => item.id === roundId ? copied : item);
        }
        const next = model.normalizeReviewProject({ ...current, rounds, updatedAt: nowFn() });
        await commitProject(next);
        return clone(next.rounds.find(item => item.id === copied.id));
      },
      async storeExternalResult(projectId, roundOrBatchId, rawResult, prompt) {
        if (typeof rawResult !== 'string' || rawResult.length > MAX_RESULT_CHARS) throw new Error(`外部结果最多 ${MAX_RESULT_CHARS} 字。`);
        if (typeof prompt === 'string' && prompt.length > MAX_PROMPT_CHARS) throw new Error(`提示词最多 ${MAX_PROMPT_CHARS} 字。`);
        const current = project(projectId);
        const existingRound = current.rounds.find(item => item.id === roundOrBatchId);
        let next;
        let roundId;
        if (existingRound) {
          if (existingRound.status === 'returned' || existingRound.status === 'parsed' || existingRound.status === 'failed') {
            throw Object.assign(new Error('该轮次已接收外部结果，请选择生成或编辑后的提示词版本。'), { code: 'ROUND_ALREADY_RETURNED' });
          }
          if (existingRound.stage === 'plan') {
            const returned = {
              ...existingRound, id: makeRoundId(), parentPromptId: existingRound.id,
              promptVersionId: existingRound.promptVersionId || existingRound.id,
              ...(typeof prompt === 'string' ? { prompt } : {}), result: rawResult,
              status: 'returned', candidates: [], error: '', createdAt: nowFn()
            };
            next = model.normalizeReviewProject({ ...current, rounds: [...current.rounds, returned], updatedAt: nowFn() });
            roundId = returned.id;
          } else {
            const batch = current.batches.find(item => item.id === existingRound.batchId);
            if (!batch) throw Object.assign(new Error('提示词版本对应的固定批次已不存在。'), { code: 'BATCH_NOT_FOUND' });
            next = model.storeExternalReviewResult(current, {
              ...batch, promptVersionId: existingRound.promptVersionId || existingRound.id
            }, rawResult, prompt || existingRound.prompt);
            roundId = next.rounds.at(-1)?.id;
          }
        } else {
          const batch = current.batches.find(item => item.id === roundOrBatchId);
          if (!batch) throw Object.assign(new Error('找不到与外部结果对应的提示词轮次或批次。'), { code: 'ROUND_NOT_FOUND' });
          next = model.storeExternalReviewResult(current, batch, rawResult, prompt || '');
          roundId = next.rounds.at(-1)?.id;
        }
        await commitProject(next);
        return clone(project(projectId).rounds.find(item => item.id === roundId));
      },
      async parseExternalResult(projectId, roundId) {
        const current = project(projectId);
        const round = current.rounds.find(item => item.id === roundId);
        if (!round) throw Object.assign(new Error(`找不到综述轮次：${roundId}`), { code: 'ROUND_NOT_FOUND' });
        if (round.stage === 'plan') return { project: clone(current), error: null };
        const result = model.parseExternalReviewRound(current, roundId);
        await commitProject(result.project);
        return { project: clone(project(projectId)), error: result.error };
      },
      async resolveCandidate(projectId, roundId, candidateId, action, changes = {}) {
        return mutateProject(projectId, current => model.resolveReviewCandidate(current, roundId, candidateId, action, changes));
      }
    };
  }

  return { createAcademicReviewCoordinator };
});
