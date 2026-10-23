const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPptAnnotation,
  markStaleAnnotations,
  buildSelectedFeedbackContext,
  buildPreflightReport,
  buildAcceptanceReport
} = require('../prototype/ppt-feedback.js');

test('创建标注绑定附件版本，并在附件 hash 变化后标记旧标注过期', () => {
  const hash1 = 'sha256:abcdef';
  const hash2 = 'sha256:123456';
  const annotation = createPptAnnotation({ attachmentId: 'a1', contentHash: hash1, comment: '保留用户原话', target: { kind: 'point', x: 0.2, y: 0.3 } });
  assert.equal(annotation.status, 'active');
  assert.ok(annotation.id);
  const stale = markStaleAnnotations([annotation], { a1: hash2 });
  assert.equal(stale[0].status, 'stale');
  assert.equal(markStaleAnnotations([annotation], { a1: hash1 })[0].status, 'active');
});

test('反馈上下文只包含已选标注、按附件和页分组并限制条数字符数', () => {
  const annotations = [
    { id: '1', attachmentId: 'a1', pageIndex: 0, selected: true, comment: '标题太小', category: 'readability' },
    { id: '2', attachmentId: 'a1', pageIndex: 0, selected: false, comment: '未选择的意见', category: 'style' },
    { id: '3', attachmentId: 'a1', pageIndex: 1, selected: true, comment: '次页颜色不符合品牌', category: 'style' },
    { id: '4', attachmentId: 'a2', pageIndex: 0, selected: true, comment: '另一文件', category: 'content' }
  ];
  const context = buildSelectedFeedbackContext(annotations, { maxItems: 2, maxCharacters: 100 });
  assert.equal(context.itemCount, 2);
  assert.equal(context.groups.length, 2);
  assert.equal(context.groups[0].attachmentId, 'a1');
  assert.equal(context.groups[0].pageIndex, 0);
  assert.deepEqual(context.groups[0].comments.map(item => item.comment), ['标题太小']);
  assert.ok(context.characterCount <= 100);
  assert.equal(JSON.stringify(context).includes('未选择的意见'), false);
});

test('预检和完整验收报告共享附件版本关联并按验收等级分组', () => {
  const preflight = buildPreflightReport({ attachmentId: 'a1', contentHash: 'sha256:abcdef', issues: [{ id: 'p1', message: '页面溢出' }] });
  const acceptance = buildAcceptanceReport({
    attachmentId: 'a1', contentHash: 'sha256:abcdef', preflightReportId: preflight.id,
    generalCriteria: ['文字可读'], taskCriteria: ['保留销售数据'],
    issues: [
      { message: '标题被裁切', severity: 'must-fix' },
      { message: '图表对比不明显', severity: 'recommended' },
      { message: '与参考稿字体不同', severity: 'acceptable' }
    ]
  });
  assert.equal(acceptance.preflightReportId, preflight.id);
  assert.equal(acceptance.contentHash, preflight.contentHash);
  assert.deepEqual(acceptance.criteria, { general: ['文字可读'], taskSpecific: ['保留销售数据'] });
  assert.equal(acceptance.issues.mustFix.length, 1);
  assert.equal(acceptance.issues.recommended.length, 1);
  assert.equal(acceptance.issues.acceptable.length, 1);
});
