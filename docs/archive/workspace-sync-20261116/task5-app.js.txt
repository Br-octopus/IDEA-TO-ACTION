const fs = require('fs');
const p = 'C:/Users/Alarm/.codex/worktrees/local-knowledge-base/提示词工具/prototype/app.js';
let s = fs.readFileSync(p, 'utf8');

function rep(from, to) {
  if (!s.includes(from)) throw new Error('未找到替换目标: ' + from.slice(0, 80));
  s = s.replace(from, to);
}

// 1. 解构补 appendKnowledgeContext，并新增本地资料读取函数
rep(
  'const { buildGoalPrompt, buildStagePrompt, buildFollowupPrompt, buildArticleDiagnosticPrompt, buildPromptOptimizationPrompt, buildCaseReviewPrompt } = promptEngine;',
  'const { buildGoalPrompt, buildStagePrompt, buildFollowupPrompt, buildArticleDiagnosticPrompt, buildPromptOptimizationPrompt, buildCaseReviewPrompt, appendKnowledgeContext } = promptEngine;' +
  '\n  // 读取用户勾选的本地资料，最多 5 条；缺失或已删除的条目直接忽略' +
  '\n  function selectedKnowledgeEntries() {' +
  '\n    const api = window.ForwardStepKnowledgeSearch;' +
  '\n    if (!api || !Array.isArray(state.knowledgeSelection) || !state.knowledgeSelection.length) return [];' +
  '\n    const entries = api.collectKnowledgeEntries(state, { references: research.catalog, methodCards: [] });' +
  '\n    const byId = new Map(entries.map(item => [item.id, item]));' +
  '\n    return state.knowledgeSelection.map(id => byId.get(id)).filter(Boolean).slice(0, 5);' +
  '\n  }'
);

// 2. renderSendPanel 显示本地资料条目
rep(
  'references.innerHTML = sendDraft.references.length',
  'const knowledgeItems = sendDraft.knowledgeEntries || [];\n    references.innerHTML = sendDraft.references.length || knowledgeItems.length'
);

// 3. 追加本地资料条目到参考资料列表
rep(
  ').join("")\r\n      : \',
  ').join("")\r\n        + knowledgeItems.map(item => \`<div class="send-reference"><span>本地资料 \${escapeHtml(item.title)}：\${escapeHtml(item.summary || "暂无摘要")}</span><button type="button" data-remove-knowledge-reference="\${escapeHtml(item.id)}" aria-label="删除 \${escapeHtml(item.title)}">删除</button></div>\`).join("")\r\n      : \'
);

// 4. 本地资料删除事件
rep(
  'renderSendPanel();\r\n    }));\r\n    document.getElementById("send-preview-confirm")',
  'renderSendPanel();\r\n    }));\r\n    references.querySelectorAll("[data-remove-knowledge-reference]").forEach(button => button.addEventListener("click", () => {\r\n      sendDraft.knowledgeEntries = (sendDraft.knowledgeEntries || []).filter(item => item.id !== button.dataset.removeKnowledgeReference);\r\n      if (!sendDraft.userEdited) sendDraft.renderedText = appendKnowledgeContext(sendDraft.basePrompt + buildSelectedReferenceContext(sendDraft.references), sendDraft.knowledgeEntries);\r\n      renderSendPanel();\r\n    }));\r\n    document.getElementById("send-preview-confirm")'
);

// 5. openSendPanel 携带本地资料
rep(
  'sendDraft = { basePrompt: String(prompt), references: selectedReferences(), renderedText: withSelectedReferences(prompt), userEdited: false };',
  'const knowledgeEntries = selectedKnowledgeEntries();\r\n    sendDraft = {\r\n      basePrompt: String(prompt),\r\n      references: selectedReferences(),\r\n      knowledgeEntries,\r\n      renderedText: appendKnowledgeContext(withSelectedReferences(prompt), knowledgeEntries),\r\n      userEdited: false\r\n    };'
);

fs.writeFileSync(p, s);
console.log('app.js 更新完成');
