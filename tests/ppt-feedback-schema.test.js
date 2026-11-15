const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePptFeedbackAttachment,
  normalizePptAnnotation
} = require('../prototype/ppt-feedback-schema.js');

test('附件只接受配对的 HTML、PDF、Office 与图片 MIME/扩展名白名单', () => {
  assert.equal(normalizePptFeedbackAttachment({ id: 'a1', sourceType: 'file', mimeType: 'text/html', extension: '.html', contentHash: 'sha256:abcdef' }).mimeType, 'text/html');
  assert.equal(normalizePptFeedbackAttachment({ id: 'a2', sourceType: 'file', mimeType: 'image/jpeg', extension: '.jpg', contentHash: 'sha256:abcdef' }).extension, '.jpg');
  for (const attachment of [
    { id: 'bad-1', sourceType: 'file', mimeType: 'text/html', extension: '.png', contentHash: 'sha256:abcdef' },
    { id: 'bad-2', sourceType: 'file', mimeType: 'image/svg+xml', extension: '.svg', contentHash: 'sha256:abcdef' }
  ]) assert.throws(() => normalizePptFeedbackAttachment(attachment), /MIME|扩展名/);
  assert.equal(normalizePptFeedbackAttachment({ id: 'pdf-1', sourceType: 'file', mimeType: 'application/pdf', extension: '.pdf', contentHash: 'sha256:abcdef' }).mimeType, 'application/pdf');
  assert.equal(normalizePptFeedbackAttachment({ id: 'ppt-1', sourceType: 'file', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: '.pptx', contentHash: 'sha256:abcdef' }).extension, '.pptx');
  assert.equal(normalizePptFeedbackAttachment({ id: 'doc-1', sourceType: 'file', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx', contentHash: 'sha256:abcdef' }).extension, '.docx');
});

test('附件来源类型、内容 hash 和元数据白名单被规范化', () => {
  const attachment = normalizePptFeedbackAttachment({
    id: ' a1 ', taskId: 'task-1', sourceType: 'folder', mimeType: 'text/html', extension: 'HTML',
    contentHash: 'sha256:abc123', absolutePath: 'C:/private/file.html', dataUrl: 'data:text/html,secret', binary: [1, 2], apiKey: 'secret'
  });
  assert.equal(attachment.id, 'a1');
  assert.equal(attachment.sourceType, 'folder');
  assert.equal(attachment.extension, '.html');
  assert.equal(attachment.contentHash, 'sha256:abc123');
  assert.deepEqual(Object.keys(attachment).sort(), ['contentHash', 'extension', 'id', 'mimeType', 'sourceType', 'taskId'].sort());
  for (const sourceType of ['file', 'folder', 'url', 'current-browser-page']) {
    assert.equal(normalizePptFeedbackAttachment({ id: 'x', sourceType, mimeType: 'image/png', extension: '.png', contentHash: 'sha256:abcdef' }).sourceType, sourceType);
  }
  assert.throws(() => normalizePptFeedbackAttachment({ id: 'x', sourceType: 'unknown', mimeType: 'image/png', extension: '.png', contentHash: 'sha256:abcdef' }), /来源/);
});

test('标注点和区域坐标夹在 0 到 1 且限制 selector、评论和类别', () => {
  const point = normalizePptAnnotation({
    id: 'n1', taskId: 'task-1', attachmentId: 'a1', contentHash: 'sha256:abcdef',
    target: { kind: 'point', x: 1.2, y: -0.2 }, comment: '  标题太小  ', category: 'layout'
  });
  assert.deepEqual(point.target, { kind: 'point', x: 1, y: 0 });
  assert.equal(point.comment, '标题太小');
  assert.equal(normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: { kind: 'region', x: 0.1, y: 0.2, width: 1.4, height: 0.4 }, comment: '问题' }).target.width, 0.9);
  assert.equal(normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: { kind: 'element', selector: '  main > h1  ' }, comment: '问题' }).target.selector, 'main > h1');
  assert.deepEqual(normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: { kind: 'text', selector: 'main > p', exact: '选中句子', prefix: '前文', suffix: '后文' }, comment: '改写此句' }).target,
    { kind: 'text', selector: 'main > p', exact: '选中句子', prefix: '前文', suffix: '后文' });
  assert.equal(normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: { kind: 'element', selector: 'main > p', excerpt: '页面摘要' }, comment: '检查这个段落' }).target.excerpt, '页面摘要');
  assert.deepEqual(normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: {
    kind: 'element', selector: 'ooxml:pptx:page:1:shape:7', excerpt: '标题',
    bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, rotation: 15 }
  }, comment: '检查对象' }).target.bounds, { x: 0.1, y: 0.2, width: 0.3, height: 0.4, rotation: 15 });
  assert.throws(() => normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: {
    kind: 'element', selector: 'ooxml:docx:page:1:index:1', bounds: { x: 0.9, y: 0.2, width: 0.3, height: 0.4 }
  }, comment: '越界对象' }), /坐标/);
  assert.deepEqual(normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: {
    kind: 'text', selector: 'main > p', exact: '网页原文', source: {
      url: 'https://example.com/page?token=secret#part', fetchedAt: '2026-11-12T01:02:03.000Z', contentHash: `sha256:${'a'.repeat(64)}`
    }
  }, comment: '网页批注' }).target.source, {
    url: 'https://example.com/page', fetchedAt: '2026-11-12T01:02:03.000Z', contentHash: `sha256:${'a'.repeat(64)}`
  });
  assert.throws(() => normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: {
    kind: 'element', selector: 'main > p', source: { url: 'file:///secret', fetchedAt: 'now', contentHash: 'bad' }
  }, comment: '网页批注' }), /来源/);
  assert.throws(() => normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: { kind: 'text', selector: 'p', exact: '' }, comment: '问题' }), /原文/);
  assert.throws(() => normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: { kind: 'text', selector: 'p', exact: 'x'.repeat(2001) }, comment: '问题' }), /原文/);
  assert.deepEqual(normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: { kind: 'text', selector: 'main > p', exact: '选中句子', prefix: '前文', suffix: '后文' }, comment: '改写此句' }).target,
    { kind: 'text', selector: 'main > p', exact: '选中句子', prefix: '前文', suffix: '后文' });
  assert.equal(normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: { kind: 'element', selector: 'main > p', excerpt: '页面摘要' }, comment: '检查这个段落' }).target.excerpt, '页面摘要');
  assert.throws(() => normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: { kind: 'text', selector: 'p', exact: '' }, comment: '问题' }), /原文/);
  assert.throws(() => normalizePptAnnotation({ contentHash: 'sha256:abcdef', target: { kind: 'text', selector: 'p', exact: 'x'.repeat(2001) }, comment: '问题' }), /原文/);
  assert.throws(() => normalizePptAnnotation({ target: { kind: 'element', selector: 'x'.repeat(1001) }, comment: '问题' }), /selector/);
  assert.throws(() => normalizePptAnnotation({ target: { kind: 'point', x: 0, y: 0 }, comment: 'x'.repeat(2001) }), /评论/);
  assert.throws(() => normalizePptAnnotation({ target: { kind: 'point', x: 0, y: 0 }, comment: '问题', category: 'unknown' }), /分类/);
  assert.throws(() => normalizePptAnnotation({ target: { kind: 'region', x: 0, y: 0, width: 0, height: 0 }, comment: '问题' }), /区域/);
});

test('箭头和画笔批注保存归一化坐标并限制笔迹点数', () => {
  const arrow = normalizePptAnnotation({
    contentHash: 'sha256:abcdef', target: { kind: 'arrow', x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 }, comment: '指向这里'
  });
  assert.deepEqual(arrow.target, { kind: 'arrow', x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 });
  const path = normalizePptAnnotation({
    contentHash: 'sha256:abcdef', target: { kind: 'path', points: [{ x: -0.1, y: 0.2 }, { x: 0.7, y: 1.2 }] }, comment: '圈出问题'
  });
  assert.deepEqual(path.target, { kind: 'path', points: [{ x: 0, y: 0.2 }, { x: 0.7, y: 1 }] });
  assert.throws(() => normalizePptAnnotation({
    contentHash: 'sha256:abcdef', target: { kind: 'arrow', x1: 0.2, y1: 0.2, x2: 0.2, y2: 0.2 }, comment: '指向这里'
  }), /箭头/);
  assert.throws(() => normalizePptAnnotation({
    contentHash: 'sha256:abcdef', target: { kind: 'path', points: [{ x: 0.2, y: 0.2 }] }, comment: '圈出问题'
  }), /笔迹/);
  assert.throws(() => normalizePptAnnotation({
    contentHash: 'sha256:abcdef', target: { kind: 'path', points: Array.from({ length: 129 }, (_, index) => ({ x: index / 129, y: 0.5 })) }, comment: '圈出问题'
  }), /笔迹/);
});

test('HTML 文字锚点保存非负且成对的文字位置', () => {
  const base = { contentHash: 'sha256:abcdef', target: { kind: 'text', selector: 'main > p', exact: '选中句子', prefix: '前文', suffix: '后文' }, comment: '检查' };
  assert.deepEqual(normalizePptAnnotation({ ...base, target: { ...base.target, start: 4, end: 8 } }).target,
    { ...base.target, start: 4, end: 8 });
  assert.throws(() => normalizePptAnnotation({ ...base, target: { ...base.target, start: 4 } }), /位置/);
  assert.throws(() => normalizePptAnnotation({ ...base, target: { ...base.target, start: 8, end: 8 } }), /位置/);
  assert.throws(() => normalizePptAnnotation({ ...base, target: { ...base.target, start: -1, end: 3 } }), /位置/);
  assert.throws(() => normalizePptAnnotation({ ...base, target: { ...base.target, start: 1.5, end: 3 } }), /位置/);
});

test('批注意图与问题类别分开保存，并为旧批注补默认修改意图', () => {
  const base = { contentHash: 'sha256:abcdef', target: { kind: 'point', x: 0.2, y: 0.3 }, comment: '调整标题' };
  assert.equal(normalizePptAnnotation(base).intent, 'modify');
  for (const intent of ['modify', 'add', 'remove', 'keep', 'question', 'verify']) {
    assert.equal(normalizePptAnnotation({ ...base, intent }).intent, intent);
  }
  assert.throws(() => normalizePptAnnotation({ ...base, intent: 'rewrite-everything' }), /意图/);
});

test('新批注记录更新时间，旧记录沿用创建时间', () => {
  const base = {
    id: 'note-time', taskId: 'task-1', attachmentId: 'asset-1', contentHash: 'sha256:abcdef',
    target: { kind: 'point', x: 0.2, y: 0.3 }, comment: '检查'
  };
  assert.equal(normalizePptAnnotation({ ...base, createdAt: '2026-01-01T00:00:00.000Z' }).updatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(normalizePptAnnotation({ ...base, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }).updatedAt, '2026-01-02T00:00:00.000Z');
});

test('重新关联批注保留来源 ID，并拒绝自引用', () => {
  const base = { id: 'note-new', contentHash: 'sha256:abcdef', target: { kind: 'point', x: 0.2, y: 0.3 }, comment: '检查' };
  assert.equal(normalizePptAnnotation({ ...base, reassociatedFromId: 'note-old' }).reassociatedFromId, 'note-old');
  assert.throws(() => normalizePptAnnotation({ ...base, reassociatedFromId: base.id }), /不能重新关联到自身/);
});

test('已撤销批注保留为可恢复记录且不得进入提示词', () => {
  const deleted = normalizePptAnnotation({
    id: 'n-deleted', taskId: 'task-1', attachmentId: 'a1', contentHash: 'sha256:abcdef',
    target: { kind: 'point', x: 0.4, y: 0.6 }, comment: '暂时不采用', status: 'deleted', selected: false
  });
  assert.equal(deleted.status, 'deleted');
  assert.equal(deleted.selected, false);
  assert.throws(() => normalizePptAnnotation({
    id: 'n-invalid', taskId: 'task-1', attachmentId: 'a1', contentHash: 'sha256:abcdef',
    target: { kind: 'point', x: 0.4, y: 0.6 }, comment: '不应被采用', status: 'deleted', selected: true
  }), /已撤销.*不能.*选择/);
});
