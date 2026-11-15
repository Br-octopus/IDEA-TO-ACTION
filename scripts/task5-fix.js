const fs = require('fs');
const p = 'C:/Users/Alarm/.codex/worktrees/local-knowledge-base/提示词工具/scripts/task5-app.js';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('// 3. 追加本地资料条目到参考资料列表');
const end = s.indexOf('// 4. 本地资料删除事件');
if (start === -1 || end === -1) throw new Error('定位失败');
const fixed = [
  "// 3. 追加本地资料条目到参考资料列表",
  "rep(",
  "  ').join(\"\\r\\n      : \\sic',"
].join('\n');
const replacement = [
  "// 3. 追加本地资料条目到参考资料列表",
  "const tpl = '<div class="send-reference"><span>本地资料 ' + escapeHtml(item.title) + '：' + escapeHtml(item.summary || \"暂无摘要\") + '</span><button type="button" data-remove-knowledge-reference="' + escapeHtml(item.id) + '" aria-label="删除 ' + escapeHtml(item.title) + '">删除</button></div>';",
  "rep(",
  "  ').join(\"\\r\\n      : \\sic',".replace('sic', ''),
  "  ').join(\"\\r\\n        + knowledgeItems.map(item => \\\`' + tpl + '\\\`).join(\"\\r\\n      : \\sic',".replace('sic', ''),
  ");",
  ""
].join('\n');
s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(p, s);
console.log('已修复脚本');
