(function (root, factory) {
  const schema = typeof module === 'object' && module.exports
    ? require('./prompt-agent-schema.js')
    : root.ForwardStepPromptAgentSchema;
  const api = factory(schema);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepPromptAgentWorkflow = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (schema) {
  const TERMINAL_STATUSES = new Set(['completed']);

  function invalidTransition(task, event) {
    const error = new Error(`不允许的提示词 Agent 状态迁移: ${task.status || '未知'} -> ${event}`);
    error.code = 'invalid_transition';
    return error;
  }

  function assertTask(task) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) throw new TypeError('task 必须是任务对象');
  }

  function assertActive(task, action) {
    assertTask(task);
    if (TERMINAL_STATUSES.has(task.status)) throw invalidTransition(task, action);
  }

  function createPromptAgentFlow(task) {
    assertTask(task);
    if (!['advance-idea', 'optimize-prompt', 'diagnose-ai-result'].includes(task.type)) {
      throw new TypeError('Agent 任务类型无效');
    }
    return {
      ...task,
      status: task.status === undefined ? 'clarifying' : task.status,
      stage: task.stage || 'clarification',
      clarificationCount: task.clarificationCount === undefined
        ? 0
        : Math.min(3, Number(task.clarificationCount) || 0),
      clarifications: task.clarifications === undefined ? [] : task.clarifications,
      researchDecision: task.researchDecision === undefined ? 'none' : task.researchDecision
    };
  }

  function recordClarification(task, answer) {
    assertActive(task, 'record_clarification');
    if (task.status !== 'clarifying') throw invalidTransition(task, 'record_clarification');
    if (answer && Array.isArray(answer.questions) && answer.questions.length > 1) {
      throw new TypeError('每轮最多提出一个问题');
    }
    const question = typeof answer === 'string' ? '' : String(answer?.question || '').trim();
    const response = typeof answer === 'string' ? answer.trim() : String(answer?.answer || '').trim();
    if (!question || !response) throw new TypeError('澄清记录必须包含一个问题和答复');
    if ((Number(task.clarificationCount) || 0) >= 3) throw new RangeError('关键追问最多三个');
    return {
      ...task,
      clarificationCount: (Number(task.clarificationCount) || 0) + 1,
      clarifications: [...(task.clarifications || []), { question, answer: response }]
    };
  }

  function setTaskDraft(task, draft) {
    assertActive(task, 'set_draft');
    if (!['clarifying', 'planning', 'ready'].includes(task.status)) throw invalidTransition(task, 'set_draft');
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new TypeError('draft 必须是摘要对象');
    const gaps = Array.isArray(draft.nonBlockingGaps) ? draft.nonBlockingGaps.map(String).filter(Boolean) : [];
    return {
      ...task,
      draft: { ...draft },
      assumptions: [...new Set([...(task.assumptions || []), ...gaps])],
      missingInfo: (task.missingInfo || []).filter(item => !gaps.includes(item)),
      status: 'ready',
      stage: 'draft'
    };
  }

  function requestExternalResearch(task, scope) {
    assertActive(task, 'request_external_research');
    if (task.researchDecision === 'rejected') {
      throw new Error('用户已拒绝联网，本任务不能再次申请搜索');
    }
    if (task.status === 'awaiting-research-approval') throw invalidTransition(task, 'request_external_research');
    if (!scope || typeof scope !== 'object' || Array.isArray(scope) || !String(scope.objective || '').trim()) {
      throw new TypeError('联网研究范围必须包含 objective');
    }
    const normalizedScope = schema.normalizePromptAgentResearchScope({
      ...scope,
      queries: Array.isArray(scope.queries) && scope.queries.length ? scope.queries : [scope.objective],
      sourceTypes: Array.isArray(scope.sourceTypes) && scope.sourceTypes.length ? scope.sourceTypes : ['web'],
      platforms: Array.isArray(scope.platforms) && scope.platforms.length ? scope.platforms : ['web']
    });
    if (!normalizedScope.objective || !normalizedScope.queries.length || !normalizedScope.sourceTypes.length) {
      throw new TypeError('联网研究范围必须包含目标、查询和来源类型');
    }
    const requestedQueries = Math.max(normalizedScope.queries.length, normalizedScope.budget.maxQueries);
    const requestedSources = normalizedScope.budget.maxSources;
    const requiresConfirmation = requestedQueries > 3 || requestedSources > 5;
    normalizedScope.budget.maxQueries = Math.min(10, requestedQueries);
    normalizedScope.budget.maxSources = Math.min(20, requestedSources);
    if (requiresConfirmation) normalizedScope.budget.requiresConfirmation = true;
    return {
      ...task,
      status: requiresConfirmation ? 'awaiting-research-budget-approval' : 'awaiting-research-approval',
      stage: 'research-approval',
      researchDecision: 'pending',
      researchScope: normalizedScope,
      researchReturn: { status: task.status, stage: task.stage }
    };
  }

  function approveExternalResearchBudget(task) {
    assertTask(task);
    if (task.status !== 'awaiting-research-budget-approval' || task.researchDecision !== 'pending') {
      throw new Error('当前任务不在等待预算确认状态');
    }
    const researchScope = schema.normalizePromptAgentResearchScope(task.researchScope);
    return {
      ...task,
      status: 'awaiting-research-approval',
      researchScope: { ...researchScope, budget: { ...researchScope.budget, requiresConfirmation: false } }
    };
  }

  function approveExternalResearch(task) {
    assertTask(task);
    if (task.status === 'awaiting-research-budget-approval' || task.researchScope?.budget?.requiresConfirmation) {
      throw new Error('超出默认预算，必须先确认预算');
    }
    if (task.status !== 'awaiting-research-approval' || task.researchDecision !== 'pending') {
      if (task.status !== 'awaiting-research-approval') throw new Error('当前任务不在等待联网确认状态');
      throw invalidTransition(task, 'approve_external_research');
    }
    return { ...task, status: task.researchReturn?.status || 'planning', stage: task.researchReturn?.stage || 'planning', researchDecision: 'approved' };
  }

  function rejectExternalResearch(task) {
    assertTask(task);
    if (!['awaiting-research-approval', 'awaiting-research-budget-approval'].includes(task.status) || task.researchDecision !== 'pending') {
      if (task.status !== 'awaiting-research-approval') throw new Error('当前任务不在等待联网确认状态');
      throw invalidTransition(task, 'reject_external_research');
    }
    return {
      ...task,
      status: task.researchReturn?.status || 'planning',
      stage: task.researchReturn?.stage || 'planning',
      researchDecision: 'rejected',
      researchScope: { ...task.researchScope, budget: { ...task.researchScope?.budget, requiresConfirmation: false } }
    };
  }

  function selectPromptStep(task, stepId) {
    assertActive(task, 'select_prompt_step');
    if (!['ready', 'planning'].includes(task.status)) throw invalidTransition(task, 'select_prompt_step');
    const step = (task.steps || []).find(item => item.id === stepId);
    if (!step) throw new RangeError(`路线步骤不存在: ${stepId}`);
    return { ...task, currentStepId: step.id, stage: 'step-prompt' };
  }

  function transitionPromptAgentTask(task, event) {
    assertTask(task);
    const type = typeof event === 'string' ? event : event?.type;
    const transitions = {
      begin_planning: ['clarifying', 'planning'],
      ready: [['clarifying', 'planning'], 'ready'],
      resume_planning: ['ready', 'planning'],
      begin_review: ['ready', 'reviewing'],
      complete: ['reviewing', 'completed']
    };
    const transition = transitions[type];
    if (!transition) throw invalidTransition(task, type || '未知事件');
    const [from, to] = transition;
    const allowed = Array.isArray(from) ? from.includes(task.status) : task.status === from;
    if (!allowed) throw invalidTransition(task, type);
    return { ...task, status: to, stage: type === 'complete' ? 'completed' : to };
  }

  return {
    createPromptAgentFlow,
    recordClarification,
    setTaskDraft,
    requestExternalResearch,
    approveExternalResearchBudget,
    approveExternalResearch,
    rejectExternalResearch,
    selectPromptStep,
    transitionPromptAgentTask
  };
});
