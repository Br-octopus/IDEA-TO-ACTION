const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePptFeedbackAttachment,
  normalizePptAnnotation
} = require('../prototype/ppt-feedback-schema.js');

test('附件只接受配对的 HTML 与图片 MIME/扩展名白名单', () => {
  assert.equal(normalizePptFeedbackAttachment({ id: 'a1', sourceType: 'file', mimeType: 'text/html', extension: '.html', contentHash: 'sha256:abcdef' }).mimeType, 'text/html');
  assert.equal(normalizePptFeedbackAttachment({ id: 'a2', sourceType: 'file', mimeType: 'image/jpeg', extension: '.jpg', contentHash: 'sha256:abcdef' }).extension, '.jpg');
  for (const attachment of [
    { id: 'bad-1', sourceType: 'file', mimeType: 'application/pdf', extension: '.pdf', contentHash: 'sha256:abcdef' },
    { id: 'bad-2', sourceType: 'file', mimeType: 'text/html', extension: '.png', contentHash: 'sha256:abcdef' },
    { id: 'bad-3', sourceType: 'file', mimeType: 'image/svg+xml', extension: '.svg', contentHash: 'sha256:abcdef' }
  ]) assert.throws(() => normalizePptFeedbackAttachment(attachment), /MIME|扩展名/);
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
  assert.throws(() => normalizePptAnnotation({ target: { kind: 'element', selector: 'x'.repeat(1001) }, comment: '问题' }), /selector/);
  assert.throws(() => normalizePptAnnotation({ target: { kind: 'point', x: 0, y: 0 }, comment: 'x'.repeat(2001) }), /评论/);
  assert.throws(() => normalizePptAnnotation({ target: { kind: 'point', x: 0, y: 0 }, comment: '问题', category: 'unknown' }), /分类/);
  assert.throws(() => normalizePptAnnotation({ target: { kind: 'region', x: 0, y: 0, width: 0, height: 0 }, comment: '问题' }), /区域/);
});
