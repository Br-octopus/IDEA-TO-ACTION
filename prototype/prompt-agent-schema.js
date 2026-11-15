(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPromptAgentSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const TASK_TYPES = Object.freeze(["advance-idea", "optimize-prompt", "diagnose-ai-result"]);
  const REVIEW_LABELS = Object.freeze(["成功", "失败", "待验证"]);
  const RESEARCH_DECISIONS = Object.freeze(["none", "pending", "approved", "rejected"]);
  const LEGACY_RESEARCH_REJECTION = "用户已拒绝本任务联网研究";
  const TASK_FIELDS = new Set([
    "id", "type", "goal", "target", "currentState", "constraints", "successCriteria",
    "preserveItems", "facts", "assumptions", "missingInfo", "excludedSourceIds", "clarificationCount", "clarifications",
    "researchDecision", "researchScope", "researchReturn", "steps",
    "currentStepId", "researchBudget", "review", "status", "stage", "draft", "selectedSources", "createdAt", "updatedAt"
  ]);
  const STEP_FIELDS = new Set([
    "id", "title", "description", "goal", "inputs", "deliverable", "checklist", "status", "order"
  ]);
  const SENSITIVE_KEY = /(?:password|credential|authorization|cookie|session|(?:api|access|refresh|client|bearer|private|model|search)?(?:key|token|secret)|profilepath|absolute.?path)/i;
  const TEXT_LIMIT = 500;

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function rejectSensitiveFields(value, path = "") {
    if (Array.isArray(value)) {
      value.forEach((item, index) => rejectSensitiveFields(item, `${path}[${index}]`));
      return;
    }
    if (!isObject(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key.replace(/[^a-z0-9]/gi, ""))) {
        throw new TypeError(`包含敏感字段：${path ? `${path}.` : ""}${key}`);
      }
      rejectSensitiveFields(item, path ? `${path}.${key}` : key);
    }
  }

  function text(value, limit = TEXT_LIMIT) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
  }

  function textList(value, limit = 30) {
    if (!Array.isArray(value)) return [];
    return value.map(item => text(item)).filter(Boolean).slice(0, limit);
  }

  function normalizePromptAgentResearchScope(input) {
    const source = isObject(input) ? input : {};
    const allowedSourceTypes = new Set(["web", "social", "official-docs", "community", "github", "官方文档", "评测", "案例"]);
    const allowedPlatforms = new Set(["web", "xiaohongshu", "reddit", "youtube"]);
    const rawBudget = isObject(source.budget) ? source.budget : {};
    const budget = {
      maxQueries: count(rawBudget.maxQueries, 10, 3),
      maxSources: count(rawBudget.maxSources, 20, 5)
    };
    if (rawBudget.requiresConfirmation === true) budget.requiresConfirmation = true;
    return {
      objective: text(source.objective, 300),
      queries: Array.isArray(source.queries) ? source.queries.map(item => text(item, 240)).filter(Boolean).slice(0, 10) : [],
      sourceTypes: textList(source.sourceTypes, 8).filter(item => allowedSourceTypes.has(item)),
      platforms: textList(source.platforms, 3).map(item => item.toLowerCase()).filter(item => allowedPlatforms.has(item)),
      budget
    };
  }

  function count(value, maximum, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(maximum, Math.floor(number))) : fallback;
  }

  function normalizePromptAgentStep(input) {
    const source = isObject(input) ? input : {};
    rejectSensitiveFields(source);
    const step = {
      id: text(source.id, 100),
      title: text(source.title, 160),
      description: text(source.description),
      goal: text(source.goal),
      inputs: textList(source.inputs),
      deliverable: text(source.deliverable),
      checklist: textList(source.checklist),
      status: ["pending", "current", "completed"].includes(source.status) ? source.status : "pending",
      order: count(source.order, 10000)
    };
    return Object.fromEntries(Object.entries(step).filter(([key]) => STEP_FIELDS.has(key)));
  }

  function normalizePromptAgentTask(input) {
    const source = isObject(input) ? input : {};
    rejectSensitiveFields(source);
    const type = TASK_TYPES.includes(source.type) ? source.type : "advance-idea";
    if (source.type !== undefined && !TASK_TYPES.includes(source.type)) throw new TypeError("Agent 任务类型无效");
    const rawBudget = isObject(source.researchBudget) ? source.researchBudget : {};
    const rawReview = isObject(source.review) ? source.review : {};
    const rawResearchReturn = isObject(source.researchReturn) ? source.researchReturn : {};
    const steps = Array.isArray(source.steps) ? source.steps.map(normalizePromptAgentStep).filter(step => step.id) : [];
    const stepIds = new Set(steps.map(step => step.id));
    const review = {
      label: REVIEW_LABELS.includes(rawReview.label) ? rawReview.label : "待验证",
      evidence: textList(rawReview.evidence),
      feedback: text(rawReview.feedback),
      confirmed: rawReview.confirmed === true,
      confirmedAt: text(rawReview.confirmedAt, 80)
    };
    const task = {
      id: text(source.id, 100),
      type,
      goal: text(source.goal),
      target: text(source.target),
      currentState: text(source.currentState),
      constraints: text(source.constraints),
      successCriteria: textList(source.successCriteria),
      preserveItems: textList(source.preserveItems),
      facts: textList(source.facts),
      assumptions: textList(source.assumptions).filter(item => item !== LEGACY_RESEARCH_REJECTION),
      missingInfo: textList(source.missingInfo),
      excludedSourceIds: textList(source.excludedSourceIds, 20),
      clarificationCount: count(source.clarificationCount, 3),
      clarifications: Array.isArray(source.clarifications)
        ? source.clarifications.slice(0, 3).map(item => ({
          question: text(isObject(item) ? item.question : ""),
          answer: text(isObject(item) ? item.answer : "")
        })).filter(item => item.question && item.answer)
        : [],
      researchDecision: RESEARCH_DECISIONS.includes(source.researchDecision)
        ? source.researchDecision
        : (Array.isArray(source.assumptions) && source.assumptions.includes(LEGACY_RESEARCH_REJECTION) ? "rejected" : "none"),
      researchScope: normalizePromptAgentResearchScope(source.researchScope),
      researchReturn: {
        status: text(rawResearchReturn.status, 60),
        stage: text(rawResearchReturn.stage, 60),
        socialTaskId: text(rawResearchReturn.socialTaskId, 100),
        collected: rawResearchReturn.collected === true,
        summary: text(rawResearchReturn.summary, 1200),
        sources: Array.isArray(rawResearchReturn.sources) ? rawResearchReturn.sources.slice(0, 5).map(item => {
          const sourceItem = isObject(item) ? item : {};
          const url = text(sourceItem.url, 1000);
          return {
            platform: text(sourceItem.platform, 60).toLowerCase(),
            queries: textList(sourceItem.queries, 5).map(query => query.slice(0, 240)),
            title: text(sourceItem.title, 180),
            url: /^https?:\/\//i.test(url) ? url : "",
            date: text(sourceItem.date, 80),
            summary: text(sourceItem.summary, 600),
            applicability: text(sourceItem.applicability, 240),
            limitations: text(sourceItem.limitations, 240)
          };
        }).filter(item => item.url) : [],
        limitations: textList(rawResearchReturn.limitations, 10),
        errors: Array.isArray(rawResearchReturn.errors) ? rawResearchReturn.errors.slice(0, 10).map(item => ({
          type: text(isObject(item) ? item.type : "", 60),
          message: text(isObject(item) ? item.message : item, 240)
        })).filter(item => item.message) : [],
        queries: textList(rawResearchReturn.queries, 10).map(query => query.slice(0, 240)),
        budget: {
          maxPlatforms: count(rawResearchReturn.budget?.maxPlatforms, 3),
          maxQueriesPerPlatform: count(rawResearchReturn.budget?.maxQueriesPerPlatform, 10),
          maxDetails: count(rawResearchReturn.budget?.maxDetails, 20),
          maxQueries: count(rawResearchReturn.budget?.maxQueries, 10),
          usedQueries: count(rawResearchReturn.budget?.usedQueries, 10),
          maxSources: count(rawResearchReturn.budget?.maxSources, 20),
          usedSources: count(rawResearchReturn.budget?.usedSources, 20)
        }
      },
      steps,
      currentStepId: stepIds.has(source.currentStepId) ? source.currentStepId : "",
      researchBudget: {
        maxQueries: count(rawBudget.maxQueries, 3, 3),
        maxSources: count(rawBudget.maxSources, 5, 5),
        usedQueries: count(rawBudget.usedQueries, 3),
        usedSources: count(rawBudget.usedSources, 5)
      },
      review,
      draft: text(source.draft, 8000),
      selectedSources: Array.isArray(source.selectedSources) ? source.selectedSources.slice(0, 8).map(item => {
        const sourceItem = isObject(item) ? item : {};
        const location = text(sourceItem.location, 500);
        return {
          id: text(sourceItem.id, 100),
          title: text(sourceItem.title, 120),
          type: text(sourceItem.type, 60),
          location: /^https?:\/\//i.test(location) ? location : location.replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s]*/g, "授权资料"),
          useReason: text(sourceItem.useReason, 120),
          verificationStatus: text(sourceItem.verificationStatus, 40),
          applicableConditions: text(sourceItem.applicableConditions, 160),
          limitations: text(sourceItem.limitations, 160),
          excerpt: text(sourceItem.excerpt, 240),
          selected: sourceItem.selected !== false
        };
      }).filter(item => item.id || item.title) : [],
      status: ["clarifying", "planning", "ready", "reviewing", "completed", "awaiting-research-approval", "awaiting-research-budget-approval"].includes(source.status) ? source.status : "clarifying",
      stage: text(source.stage, 60),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    return Object.fromEntries(Object.entries(task).filter(([key]) => TASK_FIELDS.has(key)));
  }

  function createPromptAgentTask(input = {}) {
    const source = isObject(input) ? input : {};
    return normalizePromptAgentTask({ ...source, id: source.id || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  }

  function normalizePromptAgentSource(input) {
    const source = isObject(input) ? input : {};
    rejectSensitiveFields(source);
    const normalized = {
      id: text(source.id, 100),
      label: text(source.label, 160),
      sourceType: text(source.sourceType, 60),
      permission: source.permission === "read" ? "read" : "",
      enabled: source.enabled === true,
      authorizedAt: text(source.authorizedAt, 80)
    };
    return Object.fromEntries(Object.entries(normalized).filter(([key, value]) =>
      key === "enabled" || Boolean(value)
    ));
  }

  function sanitizePromptAgentState(state) {
    const source = isObject(state) ? state : {};
    const taskFields = [...TASK_FIELDS];
    const sourceFields = ["id", "label", "sourceType", "permission", "enabled", "authorizedAt"];
    return {
      promptAgentTasks: Array.isArray(source.promptAgentTasks)
        ? source.promptAgentTasks.map(item => normalizePromptAgentTask(
          isObject(item) ? Object.fromEntries(Object.entries(item).filter(([key]) => taskFields.includes(key))) : item
        )).filter(task => task.id)
        : [],
      promptAgentSources: Array.isArray(source.promptAgentSources)
        ? source.promptAgentSources.map(item => normalizePromptAgentSource(
          isObject(item) ? Object.fromEntries(Object.entries(item).filter(([key]) => sourceFields.includes(key))) : item
        )).filter(item => item.id)
        : []
    };
  }

  return {
    TASK_TYPES,
    REVIEW_LABELS,
    createPromptAgentTask,
    normalizePromptAgentTask,
    normalizePromptAgentStep,
    normalizePromptAgentResearchScope,
    normalizePromptAgentSource,
    sanitizePromptAgentState
  };
});
