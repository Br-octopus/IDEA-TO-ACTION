// Task 5：把本地知识条目接入发送预览
const fs = require('fs');
const path = 'C:/Users/Alarm/.codex/worktrees/local-knowledge-base/提示词工具/prototype/app.js';
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);

function findLine(snippet, from = 0) {
  const i = lines.findIndex((l, idx) => idx >= from && l.includes(snippet));
  if (i === -1) throw new Error('未找到: ' + snippet);
  return i;
}

// 1) 解构补 appendKnowledgeContext
let i = findLine('buildCaseReviewPrompt } = promptEngine');
lines[i] = lines[i].replace('buildCaseReviewPrompt }', 'buildCaseReviewPrompt, appendKnowledgeContext }');

// 2) 在 promptEngine 解构之后插入 selectedKnowledgeEntries
const helper = [
  '  // 读取用户勾选的本地资料，最多 5 条；缺失或已删除的条目直接忽略',
  '  function selectedKnowledgeEntries() {',
  '    const api = window.ForwardStepKnowledgeSearch;',
  '    if (!api || !Array.isArray(state.knowledgeSelection) || !state.knowledgeSelection.length) return [];',
  '    const entries = api.collectKnowledgeEntries(state, { references: research.catalog, methodCards: [] });',
  '    const byId = new Map(entries.map(item => [item.id, item]));',
  '    return state.knowledgeSelection.map(id => byId.get(id)).filter(Boolean).slice(0, 5);',
  '  }'
];
lines.splice(i + 1, 0, ...helper);

// 3) renderSendPanel：加入知识条目渲染
i = findLine('references.innerHTML = sendDraft.references.length');
lines[i] = '    const knowledgeItems = sendDraft.knowledgeEntries || [];';
lines.splice(i + 1, 0, '    references.innerHTML = sendDraft.references.length || knowledgeItems.length');

const j = findLine('未选择资料摘要', i);
const fallbackLine = lines[j];
lines[j] = '        + knowledgeItems.map(item => renderKnowledgeReference(item)).join("")';
lines.splice(j + 1, 0, fallbackLine);

// 4) 知识条目删除事件：插到 send-preview-confirm 之前
let k = findLine('document.getElementById("send-preview-confirm")');
lines.splice(k, 0,
  '    references.querySelectorAll("[data-remove-knowledge-reference]").forEach(button => button.addEventListener("click", () => {',
  '      sendDraft.knowledgeEntries = (sendDraft.knowledgeEntries || []).filter(item => item.id !== button.dataset.removeKnowledgeReference);',
  '      if (!sendDraft.userEdited) sendDraft.renderedText = appendKnowledgeContext(sendDraft.basePrompt + buildSelectedReferenceContext(sendDraft.references), sendDraft.knowledgeEntries);',
  '      renderSendPanel();',
  '    }));'
);

// 5) openSendPanel 携带本地资料
k = findLine('sendDraft = { basePrompt: String(prompt), references: selectedReferences()');
lines.splice(k, 1,
  '    const knowledgeEntries = selectedKnowledgeEntries();',
  '    sendDraft = {',
  '      basePrompt: String(prompt),',
  '      references: selectedReferences(),',
  '      knowledgeEntries,',
  '      renderedText: appendKnowledgeContext(withSelectedReferences(prompt), knowledgeEntries),',
  '      userEdited: false',
  '    };'
);

fs.writeFileSync(path, lines.join('\r\n'));
console.log('app.js Task5 修改完成');
