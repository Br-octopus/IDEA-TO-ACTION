const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../prototype/writing-resource-registry.js');

test('资源按文体和任务筛选，并保留跳过原因', () => {
  const result = registry.selectWritingResources({
    genre: 'article',
    taskType: 'revision',
    packs: [{ id: 'pack', version: 2, name: '规则包', resources: [
      { id: 'template', kind: 'template', title: '模板', purpose: '结构', relativePath: 'references/template.md', taskTypes: ['revision'] },
      { id: 'other-task', kind: 'reference', title: '其他', purpose: '其他', relativePath: 'references/other.md', taskTypes: ['technical-design'] },
      { id: 'disabled', kind: 'example', title: '停用', purpose: '示例', relativePath: 'examples/disabled.md', enabled: false }
    ] }]
  });
  assert.deepEqual(result.resources.map(item => item.id), ['template']);
  assert.deepEqual(result.skipped.map(item => [item.id, item.reason]), [
    ['other-task', 'task-mismatch'], ['disabled', 'disabled']
  ]);
});

test('资源提示词按类型区分边界，示例不会被标为事实', () => {
  const text = registry.resourcePromptLines({ resources: [
    { id: 'example', kind: 'example', title: '示例', summary: '表达参考', verificationStatus: 'unverified' },
    { id: 'script', kind: 'script', title: '扫描', summary: '受控动作', actionId: 'scan', verificationStatus: 'unverified' }
  ] });
  assert.match(text, /示例参考/);
  assert.match(text, /表达\/格式/);
  assert.match(text, /受控脚本能力/);
  assert.match(text, /不能替代用户事实/);
});

test('资源片段读取器保留有界状态', async () => {
  const result = await registry.loadResourceExcerpt({ id: 'reference', archive: 'a', relativePath: 'x.md' }, async () => ({ content: '片段' }), 20);
  assert.deepEqual(result, { status: 'used', content: '片段', truncated: false });
  const unavailable = await registry.loadResourceExcerpt({ id: 'reference' }, null);
  assert.equal(unavailable.status, 'unavailable');
});
