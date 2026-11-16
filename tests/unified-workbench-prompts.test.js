const test = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../prototype/unified-workbench-prompts.js');

test('统一提示词固定目标、素材版本、批注与本轮意见', () => {
  const prompt = prompts.buildUnifiedPrompt({
    goal: '把截图复刻成网页',
    selectedContents: [{ id: 'v1', title: '首页截图', kind: 'image', hash: 'sha256:1', readStatus: 'preview-only' }],
    annotations: [{ id: 'a1', contentVersionId: 'v1', comment: '保留顶部导航' }],
    feedback: '按钮改成绿色', layoutIntent: { enabled: false }
  });
  assert.match(prompt.text, /任务目标：把截图复刻成网页/);
  assert.match(prompt.text, /保留顶部导航/);
  assert.match(prompt.text, /按钮改成绿色/);
  assert.match(prompt.text, /用途：参考资料/);
  assert.deepEqual(prompt.contentVersionIds, ['v1']);
  assert.deepEqual(prompt.layoutIntent, { enabled: false });
});

test('无素材与未读取文件均不会被描述成已理解正文', () => {
  assert.match(prompts.buildUnifiedPrompt({ goal: '整理任务' }).text, /本轮未附素材/);
  const unread = prompts.buildUnifiedPrompt({ selectedContents: [{ id: 'v2', title: '扫描件', kind: 'pdf', parseStatus: 'failed', sourceRef: { path: 'C:/Users/private/scan.pdf' } }] });
  assert.match(unread.text, /解析失败/);
  assert.match(unread.text, /文件正文尚未确认读取/);
  assert.equal(unread.text.includes('C:/Users/private'), false);
  assert.equal(unread.text.includes('已读正文'), false);
});

test('构图意图只在显式启用时进入提示词', () => {
  const layoutIntent = { enabled: true, bounds: { width: 800, height: 600 }, nodes: [{ nodeId: 'n1', x: 0.2, y: 0.1, width: 0.5, height: 0.6, zIndex: 2 }] };
  const prompt = prompts.buildUnifiedPrompt({ goal: '制作海报', layoutIntent });
  assert.match(prompt.text, /构图意图/);
  assert.match(prompt.text, /叠放顺序 2/);
  assert.equal(prompts.buildUnifiedPrompt({ layoutIntent: { ...layoutIntent, enabled: false } }).text.includes('构图意图'), false);
});

test('沿用既有提示词上下文时只追加统一素材和构图段落', () => {
  const prompt = prompts.buildUnifiedPrompt({
    basePrompt: '现有目标与领域规则',
    selectedContents: [{ id: 'v5', title: '交付稿', kind: 'document', purpose: 'result', readStatus: 'read', text: '正文' }]
  });
  assert.match(prompt.text, /^现有目标与领域规则/);
  assert.match(prompt.text, /用途：外部结果/);
  assert.doesNotMatch(prompt.text, /任务目标：/);
});

test('素材清单剔除本机路径和非 HTTP 来源，只保留已读正文', () => {
  const manifest = prompts.buildMaterialManifest([{
    id: 'v3', title: '说明文档', kind: 'text', text: '正文内容', readStatus: 'read', hash: 'sha256:3',
    sourceRef: { sourceName: '说明文档.md', pageIndex: 0, path: 'C:/Users/private/说明文档.md', url: 'file:///private/说明文档.md' }
  }]);
  assert.equal(manifest[0].text, '正文内容');
  assert.deepEqual(manifest[0].sourceRef, { sourceName: '说明文档.md', pageIndex: 0 });
});

test('导出的提示词快照会去掉不可供外部访问的本机绝对路径', () => {
  const cleaned = prompts.sanitizeLocalPaths('打开 C:\\Users\\private\\brief.md 和 /Users/private/brief.md');
  assert.equal(cleaned.includes('C:\\Users\\private'), false);
  assert.equal(cleaned.includes('/Users/private'), false);
  assert.equal((cleaned.match(/本机路径已省略/g) || []).length, 2);
});

test('交付轮次保存不可变素材与批注快照并排除取消选择项', () => {
  const material = { id: 'v4', title: '原始稿', kind: 'text', text: '旧正文', readStatus: 'read' };
  const round = { id: 'r1', deliveries: [] };
  const result = prompts.snapshotPromptRound({
    round, roundId: 'r1', deliveryId: 'd1', createdAt: '2026-11-16T00:00:00.000Z', goal: '修改稿件', selectedContents: [material],
    annotations: [{ id: 'a1', contentVersionId: 'v4', comment: '保留标题' }, { id: 'a2', contentVersionId: 'v4', comment: '不纳入', selected: false }]
  });
  material.text = '新正文';
  assert.equal(result.delivery.materials[0].text, '旧正文');
  assert.deepEqual(result.delivery.annotations.map(item => item.id), ['a1']);
  assert.equal(round.deliveries.length, 0);
  assert.equal(result.round.deliveries.length, 1);
  assert.equal(result.round.deliveries[0].status, 'prepared');
});

test('排除素材会生成独立交付快照并同步过滤批注和构图节点', () => {
  const delivery = {
    id: 'delivery-1', text: '固定提示词', contentVersionIds: ['v1', 'v2'], status: 'copied',
    materials: [
      { contentVersionId: 'v1', title: '保留图', kind: 'image', attachmentId: 'a1', hash: 'sha256:1' },
      { contentVersionId: 'v2', title: '排除图', kind: 'image', attachmentId: 'a2', hash: 'sha256:2' }
    ],
    annotations: [{ id: 'n1', contentVersionId: 'v1' }, { id: 'n2', contentVersionId: 'v2' }],
    layoutIntent: { enabled: true, bounds: { width: 100, height: 50 }, nodes: [
      { nodeId: 'node-1', contentVersionId: 'v1' }, { nodeId: 'node-2', contentVersionId: 'v2' }
    ] }
  };
  const snapshot = prompts.snapshotMaterialExport({
    delivery, excludedContentVersionIds: ['v2'], exportDeliveryId: 'export-1', createdAt: '2026-11-16T00:00:00.000Z'
  });

  assert.equal(delivery.status, 'copied');
  assert.deepEqual(delivery.contentVersionIds, ['v1', 'v2']);
  assert.equal(snapshot.id, 'export-1');
  assert.equal(snapshot.sourceDeliveryId, 'delivery-1');
  assert.equal(snapshot.parentDeliveryId, 'delivery-1');
  assert.equal(snapshot.status, 'prepared');
  assert.deepEqual(snapshot.contentVersionIds, ['v1']);
  assert.deepEqual(snapshot.materials.map(item => item.contentVersionId), ['v1']);
  assert.deepEqual(snapshot.annotations.map(item => item.id), ['n1']);
  assert.deepEqual(snapshot.layoutIntent.nodes.map(item => item.contentVersionId), ['v1']);
  assert.match(snapshot.text, /排除图（版本 v2）/);
  assert.deepEqual(snapshot.excludedMaterials.map(item => item.contentVersionId), ['v2']);
  assert.throws(() => prompts.snapshotMaterialExport({ delivery, excludedContentVersionIds: ['v2', 'v2'], exportDeliveryId: 'export-2' }), /不能重复/);
});
