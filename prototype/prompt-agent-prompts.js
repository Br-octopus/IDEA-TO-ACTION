(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForwardStepPromptAgentPrompts = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  function list(value) {
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : [];
  }

  function summary(task) {
    const source = task && typeof task === 'object' ? task : {};
    return {
      任务类型: source.type || '',
      目标: source.goal || '',
      对象: source.target || '',
      现状: source.currentState || '',
      约束: source.constraints || '',
      成功标准: list(source.successCriteria),
      保留项: list(source.preserveItems),
      已知事实: list(source.facts),
      当前假设: list(source.assumptions),
      待确认信息: list(source.missingInfo),
      外部研究结果: source.researchReturn && (
        source.researchReturn.summary || source.researchReturn.sources?.length || source.researchReturn.errors?.length
      ) ? {
        状态: source.researchReturn.status,
        摘要: String(source.researchReturn.summary || '').slice(0, 800),
        查询: list(source.researchReturn.queries).slice(0, 5),
        来源: Array.isArray(source.researchReturn.sources) ? source.researchReturn.sources.slice(0, 3).map(item => ({
          平台: item.platform || '',
          查询: list(item.queries).slice(0, 2),
          标题: String(item.title || '').slice(0, 100),
          链接: item.url || '',
          日期: item.date || '',
          摘要: String(item.summary || '').slice(0, 240),
          适用性: String(item.applicability || '').slice(0, 120),
          局限: String(item.limitations || '').slice(0, 120)
        })) : [],
        局限: list(source.researchReturn.limitations).slice(0, 5),
        未完成项: Array.isArray(source.researchReturn.errors) ? source.researchReturn.errors : []
      } : null
    };
  }

  function block(title, value) {
    return `${title}\n${JSON.stringify(value, null, 2)}`;
  }

  function base(task) {
    return block('当前阶段任务摘要', summary(task));
  }

  function buildClarificationPrompt(task) {
    return `${base(task)}\n\n请按“目标理解、已知事实、当前假设、待确认信息、本轮关键问题、建议”分段输出。只提出最能改变方案的一个问题；每轮最多提出一个问题，累计最多三个关键追问。信息已足够时先给可修改的分析初稿，非阻断缺口列为假设。只提供分析和建议，不得直接产出目标成果。`;
  }

  function buildDiagnosisPrompt(task) {
    return `${base(task)}\n\n请按“目标理解、已知事实、当前假设、待确认信息、遗漏与矛盾、必须保留、本轮关键问题、建议”分段输出。诊断当前任务输入中的遗漏、矛盾、依据不足和必须保留项；引用具体依据并给出可修改的诊断初稿。每轮最多提出一个问题，累计最多三个关键追问。不得直接产出目标成果，不改写文章、不生成代码，只给分析、建议和后续验收要点。`;
  }

  function buildRoutePrompt(task, evidence) {
    const selectedEvidence = Array.isArray(evidence) ? evidence.filter(item => item && typeof item === 'object' && item.selected !== false).map(item => ({
      id: item.id || '', title: item.title || '', excerpt: item.excerpt || '', url: item.url || ''
    })) : [];
    return `${base(task)}\n\n已选引用\n${JSON.stringify(selectedEvidence, null, 2)}\n\n只规划路线，不执行任务或生成目标成果。每一步都必须写明目标、输入、产出和检查方式；路线步骤保持简短，只为当前选定步骤生成详细提示词。`;
  }

  function buildStepPrompt(task, step) {
    const current = step && typeof step === 'object' ? {
      id: step.id || '', title: step.title || '', goal: step.goal || '',
      inputs: list(step.inputs), deliverable: step.deliverable || '', checklist: list(step.checklist)
    } : {};
    return `${base(task)}\n\n当前选定步骤\n${JSON.stringify(current, null, 2)}\n\n仅为上述步骤编写可交给外部 AI 的执行提示词，明确步骤目标、输入、产出和检查项。不得展开其他步骤，不得直接完成目标任务，也不得产出最终文章、代码及其他目标成果。`;
  }

  function buildResultReviewPrompt(task, externalResult, feedback) {
    const result = externalResult && typeof externalResult === 'object' ? {
      excerpt: externalResult.excerpt || '', differences: list(externalResult.differences), evidence: list(externalResult.evidence)
    } : { excerpt: String(externalResult || ''), differences: [], evidence: [] };
    return `${base(task)}\n\n待复盘结果摘录与差异\n${JSON.stringify(result, null, 2)}\n\n用户反馈\n${String(feedback || '')}\n\n对照目标、成功标准和保留项，逐项引用具体差异及证据；给出“成功”“失败”或“待验证”的建议标签，并说明依据、局限和下一步核验建议。不得改写结果正文或直接产出目标成果。`;
  }

  return { buildClarificationPrompt, buildDiagnosisPrompt, buildRoutePrompt, buildStepPrompt, buildResultReviewPrompt };
});
