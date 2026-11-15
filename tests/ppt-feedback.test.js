const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createOfficeSelectionTarget,
  getOfficeSelectionInvalidReason,
  createPptAnnotation,
  createReassociatedAnnotation,
  getAnnotationLocationStatus,
  markStaleAnnotations,
  buildSelectedFeedbackContext,
  buildSelectedAnnotationPrompt,
  findSelectedAnnotationConflicts,
  getSelectedAnnotationConflictKey,
  resolveSelectedAnnotationConflicts,
  buildSelectedAnnotationPrompts,
  buildSelectedAnnotationPromptBatches,
  buildPreflightReport,
  buildAcceptanceReport
} = require('../prototype/ppt-feedback.js');

test('Office 文字与元素选区归一化为有界、可验证的页级锚点', () => {
  const docx = createOfficeSelectionTarget({ kind: 'docx' }, {
    format: 'docx', kind: 'text', text: ' 需要修改的原文 ', pageIndexes: [2], truncated: false,
    runs: [{ pageIndex: 2, paragraphId: 'paragraph-1', runIndex: 3 }]
  });
  assert.deepEqual(docx, {
    pageIndex: 2,
    target: { kind: 'text', selector: 'ooxml:docx:page:3:p:paragraph-1:r3', exact: '需要修改的原文', prefix: '', suffix: '' }
  });

  const pptx = createOfficeSelectionTarget({ kind: 'pptx' }, {
    format: 'pptx', kind: 'element', slideIndex: 4, elementIndex: 7, shapeId: 'shape-7',
    origin: 'native', name: '标题', elementType: 'shape', text: '标题内容',
    bounds: { x: 100, y: 50, width: 200, height: 100, rotation: 15 }
  }, { slideWidth: 1000, slideHeight: 500 });
  assert.equal(pptx.pageIndex, 4);
  assert.equal(pptx.target.kind, 'element');
  assert.match(pptx.target.selector, /^ooxml:pptx:page:5:shape:shape-7:/);
  assert.equal(pptx.target.excerpt, '标题内容');
  assert.deepEqual(pptx.target.bounds, { x: 0.1, y: 0.1, width: 0.2, height: 0.2, rotation: 15 });
  const docxElement = createOfficeSelectionTarget({ kind: 'docx' }, {
    format: 'docx', kind: 'element', pageIndex: 2, elementIndex: 3, elementType: 'image', text: '图表',
    source: { path: [1, 2] }, bounds: { xPt: 60, yPt: 120, widthPt: 180, heightPt: 80 }
  }, { pageSize: () => ({ widthPt: 600, heightPt: 800 }) });
  assert.deepEqual(docxElement.target.bounds, { x: 0.1, y: 0.15, width: 0.3, height: 0.1 });
  assert.equal(createOfficeSelectionTarget({ kind: 'docx' }, {
    format: 'docx', kind: 'element', pageIndex: 0, elementIndex: 1, elementType: 'shape',
    bounds: { xPt: 1, yPt: 1, widthPt: 2, heightPt: 2 }
  }), null, '缺少页尺寸时不保存无法恢复的 Office 对象批注');
  assert.equal(createOfficeSelectionTarget({ kind: 'docx' }, { format: 'docx', kind: 'text', text: '截断', truncated: true }), null);
  assert.equal(createOfficeSelectionTarget({ kind: 'docx' }, { format: 'docx', kind: 'text', text: '无运行锚点', pageIndexes: [0], runs: [] }), null);
});

test('DOCX 没有段落 ID 时使用 OOXML 来源路径，缺少两者则拒绝文字批注', () => {
  const context = {
    format: 'docx', kind: 'text', text: '第二页原文', pageIndexes: [1], truncated: false,
    runs: [{ pageIndex: 1, runIndex: 0, source: { story: 'body', storyInstance: 'body', path: [2] } }]
  };
  assert.deepEqual(createOfficeSelectionTarget({ kind: 'docx' }, context), {
    pageIndex: 1,
    target: { kind: 'text', selector: 'ooxml:docx:page:2:p:source:body:body:[2]:r0', exact: '第二页原文', prefix: '', suffix: '' }
  });
  assert.equal(createOfficeSelectionTarget({ kind: 'docx' }, {
    ...context, runs: [{ pageIndex: 1, runIndex: 0 }]
  }), null);
  assert.equal(createOfficeSelectionTarget({ kind: 'docx' }, {
    ...context, runs: [...context.runs, { pageIndex: 1, runIndex: 1 }]
  }), null, '跨运行选区不能只记录可定位的一部分');
  assert.equal(createOfficeSelectionTarget({ kind: 'docx' }, {
    ...context, runs: Array.from({ length: 16 }, (_, runIndex) => ({
      ...context.runs[0], runIndex, source: { ...context.runs[0].source, storyInstance: 'a'.repeat(48) }
    }))
  }), null, '超出锚点长度时不能截断成半个定位符');
});

test('Office 选区失效时返回具体原因并拒绝跨任务、跨资料和错版本保存', () => {
  const attachment = { id: 'office-1', kind: 'docx', sha256: 'a'.repeat(64) };
  const pending = {
    taskId: 'task-1', attachmentId: attachment.id, contentHash: attachment.sha256, pageIndex: 0,
    target: { kind: 'text', selector: 'ooxml:docx:page:1:p:p1:r0', exact: '原文' }
  };
  const context = { taskId: 'task-1', attachmentId: attachment.id, attachments: [attachment] };
  assert.equal(getOfficeSelectionInvalidReason(pending, context), '');
  assert.equal(getOfficeSelectionInvalidReason(null, context), 'missing');
  assert.equal(getOfficeSelectionInvalidReason(pending, { ...context, taskId: 'task-2' }), 'task-changed');
  assert.equal(getOfficeSelectionInvalidReason(pending, { ...context, attachmentId: 'office-2' }), 'attachment-changed');
  assert.equal(getOfficeSelectionInvalidReason(pending, { ...context, attachments: [] }), 'attachment-unavailable');
  assert.equal(getOfficeSelectionInvalidReason(pending, { ...context, attachments: [{ ...attachment, sha256: 'b'.repeat(64) }] }), 'version-changed');
  assert.equal(getOfficeSelectionInvalidReason({ ...pending, pageIndex: -1 }, context), 'location-invalid');
  assert.equal(getOfficeSelectionInvalidReason({ ...pending, target: { kind: 'text', selector: 'ooxml:docx' } }, context), 'location-invalid');
});

test('创建标注绑定附件版本，并在附件 hash 变化后标记旧标注过期', () => {
  const hash1 = 'sha256:abcdef';
  const hash2 = 'sha256:123456';
  const annotation = createPptAnnotation({ attachmentId: 'a1', contentHash: hash1, comment: '保留用户原话', target: { kind: 'point', x: 0.2, y: 0.3 } });
  assert.equal(annotation.status, 'active');
  assert.ok(annotation.id);
  assert.equal(annotation.updatedAt, annotation.createdAt);
  const stale = markStaleAnnotations([annotation], { a1: hash2 });
  assert.equal(stale[0].status, 'stale');
  assert.equal(markStaleAnnotations([annotation], { a1: hash1 })[0].status, 'active');
});

test('批注撤销重做按记录顺序移动快照，新修改清空重做并限制最近 20 步', () => {
  const history = require('../prototype/ppt-feedback.js').createAnnotationHistory();
  const original = { id: 'note-1', comment: '原意见' };
  const edited = { id: 'note-1', comment: '改后意见' };
  history.record(null, original);
  history.record(original, edited);
  assert.equal(history.canUndo(), true);
  assert.deepEqual(history.peek('undo'), { before: original, after: edited });
  assert.equal(history.commit('undo'), true);
  assert.equal(history.canRedo(), true);
  assert.deepEqual(history.peek('redo'), { before: original, after: edited });
  assert.equal(history.commit('redo'), true);
  assert.deepEqual(history.peek('undo'), { before: original, after: edited });
  assert.equal(history.commit('undo'), true);
  history.record(edited, { ...edited, comment: '再次修改' });
  assert.equal(history.canRedo(), false);
  for (let index = 0; index < 21; index++) history.record(null, { id: `note-${index}` });
  for (let index = 0; index < 20; index++) { assert.ok(history.peek('undo')); history.commit('undo'); }
  assert.equal(history.canUndo(), false);
});

test('同哈希批注可原位关联，改版批注必须给出新定位且保留旧记录', () => {
  const source = {
    id: 'note-old', taskId: 'task-1', attachmentId: 'asset-old', contentHash: 'sha256:same', pageIndex: 2,
    target: { kind: 'point', x: 0.2, y: 0.3 }, comment: '调整标题', category: 'readability', intent: 'modify', selected: true, status: 'active'
  };
  const exactCopy = createReassociatedAnnotation(source, { id: 'asset-copy', taskId: 'task-1', sha256: 'sha256:same' });
  assert.notEqual(exactCopy.id, source.id);
  assert.equal(exactCopy.attachmentId, 'asset-copy');
  assert.equal(exactCopy.reassociatedFromId, source.id);
  assert.deepEqual(exactCopy.target, source.target);
  assert.equal(exactCopy.selected, false);
  assert.equal(source.attachmentId, 'asset-old');
  assert.throws(() => createReassociatedAnnotation(source, { id: 'asset-v2', taskId: 'task-1', sha256: 'sha256:new' }), /必须先重新定位/);
  const relocated = createReassociatedAnnotation(source, { id: 'asset-v2', taskId: 'task-1', sha256: 'sha256:new' }, { kind: 'region', x: 0.1, y: 0.2, width: 0.3, height: 0.2 });
  assert.equal(relocated.contentHash, 'sha256:new');
  assert.equal(relocated.target.kind, 'region');
  assert.equal(relocated.target.x, 0.1);
  assert.equal(relocated.target.y, 0.2);
  assert.ok(Math.abs(relocated.target.width - 0.3) < Number.EPSILON);
  assert.equal(relocated.target.height, 0.2);
  assert.deepEqual(source.target, { kind: 'point', x: 0.2, y: 0.3 });
});

test('批注定位状态区分完全匹配、待确认和来源缺失', () => {
  const annotation = { status: 'active', contentHash: 'sha256:old' };
  assert.equal(getAnnotationLocationStatus(annotation, { sha256: 'sha256:old' }, null), 'matched');
  assert.equal(getAnnotationLocationStatus(annotation, { sha256: 'sha256:new' }, { id: 'asset-old' }), 'needs-confirmation');
  assert.equal(getAnnotationLocationStatus(annotation, { sha256: 'sha256:new' }, null), 'invalid');
  assert.equal(getAnnotationLocationStatus({ ...annotation, status: 'stale' }, { sha256: 'sha256:old' }, { id: 'asset-old' }), 'needs-confirmation');
});

test('反馈上下文只包含已选标注、按附件和页分组并限制条数字符数', () => {
  const annotations = [
    { id: '1', attachmentId: 'a1', pageIndex: 0, selected: true, intent: 'keep', comment: '标题太小', category: 'readability' },
    { id: '2', attachmentId: 'a1', pageIndex: 0, selected: false, comment: '未选择的意见', category: 'style' },
    { id: '5', attachmentId: 'a1', pageIndex: 0, selected: true, status: 'deleted', comment: '已撤销的意见', category: 'style' },
    { id: '6', attachmentId: 'a1', pageIndex: 0, selected: true, status: 'stale', comment: '版本过期的意见', category: 'style' },
    { id: '3', attachmentId: 'a1', pageIndex: 1, selected: true, comment: '次页颜色不符合品牌', category: 'style' },
    { id: '4', attachmentId: 'a2', pageIndex: 0, selected: true, comment: '另一文件', category: 'content' }
  ];
  const context = buildSelectedFeedbackContext(annotations, { maxItems: 2, maxCharacters: 100 });
  assert.equal(context.itemCount, 2);
  assert.equal(context.groups.length, 2);
  assert.equal(context.groups[0].attachmentId, 'a1');
  assert.equal(context.groups[0].pageIndex, 0);
  assert.deepEqual(context.groups[0].comments.map(item => item.comment), ['标题太小']);
  assert.equal(context.groups[0].comments[0].intent, 'keep');
  assert.ok(context.characterCount <= 100);
  assert.equal(context.batchCount, 2);
  assert.equal(context.totalItemCount, 3);
  assert.deepEqual(context.batches.flatMap(batch => batch.groups.flatMap(group => group.comments.map(item => item.comment))), ['标题太小', '次页颜色不符合品牌', '另一文件']);
  assert.equal(JSON.stringify(context).includes('未选择的意见'), false);
  assert.equal(JSON.stringify(context).includes('已撤销的意见'), false);
  assert.equal(JSON.stringify(context).includes('版本过期的意见'), false);
});

test('反馈批次不截断单条评论，超过字数上限时完整移入下一批', () => {
  const longComment = 'a'.repeat(120);
  const context = buildSelectedFeedbackContext([
    { id: '1', attachmentId: 'a1', selected: true, comment: '先处理' },
    { id: '2', attachmentId: 'a1', selected: true, comment: longComment },
    { id: '3', attachmentId: 'a1', selected: true, comment: '最后处理' }
  ], { maxItems: 2, maxCharacters: 100 });
  assert.equal(context.batchCount, 3);
  assert.deepEqual(context.batches.flatMap(batch => batch.groups.flatMap(group => group.comments.map(item => item.comment))), ['先处理', longComment, '最后处理']);
});

test('工作台批注提示词超长时按完整批注分批并保留来源版本和定位', () => {
  const attachment = { id: 'a1', displayName: '方案.png', sha256: 'sha256:current' };
  const annotations = Array.from({ length: 3 }, (_, index) => ({
    id: `note-${index + 1}`, attachmentId: 'a1', contentHash: attachment.sha256, pageIndex: index,
    target: { kind: 'region', x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
    selected: true, status: 'active', intent: 'modify', category: 'content', comment: `意见${index + 1}：${'保留原意并调整表达。'.repeat(12)}`
  }));
  const result = buildSelectedAnnotationPromptBatches(annotations, [attachment], { maxCharacters: 450 });

  assert.ok(result.batchCount > 1);
  assert.equal(result.totalItemCount, annotations.length);
  assert.deepEqual(result.batches.flatMap(batch => batch.annotationIds), annotations.map(item => item.id));
  for (const batch of result.batches) {
    assert.ok(batch.characterCount <= 450);
    assert.match(batch.prompt, /资料版本 SHA-256：sha256:current/);
    assert.match(batch.prompt, /区域/);
  }
});

test('工作台批注提示词不会截断超预算的单条意见', () => {
  const comment = '完整批注内容'.repeat(80);
  const result = buildSelectedAnnotationPromptBatches([{
    id: 'note-long', attachmentId: 'a1', contentHash: 'sha256:current', selected: true, status: 'active', comment
  }], [{ id: 'a1', sha256: 'sha256:current' }], { maxCharacters: 100 });

  assert.equal(result.batchCount, 1);
  assert.equal(result.batches[0].oversized, true);
  assert.ok(result.batches[0].prompt.includes(comment));
});

test('修改提示词只包含当前资料版本中已选且有效的批注，并保留批注意图与页码', () => {
  const attachment = { id: 'a1', sha256: 'sha256:current' };
  const annotations = [
    { id: 'keep', attachmentId: 'a1', contentHash: 'sha256:current', pageIndex: 1, target: { kind: 'region', x: 0.1, y: 0.2, width: 0.3, height: 0.2 }, selected: true, status: 'active', intent: 'keep', category: 'content', comment: '保留免责声明' },
    { id: 'deleted', attachmentId: 'a1', contentHash: 'sha256:current', selected: true, status: 'deleted', comment: '已撤销意见' },
    { id: 'stale', attachmentId: 'a1', contentHash: 'sha256:current', selected: true, status: 'stale', comment: '过期意见' },
    { id: 'other-version', attachmentId: 'a1', contentHash: 'sha256:old', selected: true, status: 'active', comment: '旧版本意见' },
    { id: 'unselected', attachmentId: 'a1', contentHash: 'sha256:current', selected: false, status: 'active', comment: '未选意见' },
    { id: 'other-file', attachmentId: 'a2', contentHash: 'sha256:current', selected: true, status: 'active', comment: '其他资料意见' }
  ];
  const prompt = buildSelectedAnnotationPrompt(annotations, attachment);
  assert.match(prompt, /资料版本 SHA-256：sha256:current/);
  assert.match(prompt, /\[批注 ID：keep；保留；content；区域\] 第 2 页，区域/);
  assert.match(prompt, /保留免责声明/);
  for (const excluded of ['已撤销意见', '过期意见', '旧版本意见', '未选意见', '其他资料意见']) {
    assert.doesNotMatch(prompt, new RegExp(excluded));
  }
});

test('视觉批注列出需附的页面证据，并声明提示词没有附图', () => {
  const attachment = { id: 'deck-1', kind: 'pptx', displayName: '方案.pptx', sha256: 'sha256:deck-v1' };
  const annotations = [
    { id: 'region', attachmentId: attachment.id, contentHash: attachment.sha256, pageIndex: 2, selected: true, status: 'active', target: { kind: 'region', x: 0.1, y: 0.2, width: 0.3, height: 0.2 }, comment: '调整图表标签' },
    { id: 'arrow', attachmentId: attachment.id, contentHash: attachment.sha256, pageIndex: 2, selected: true, status: 'active', target: { kind: 'arrow', x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 }, comment: '这里补充说明' },
    { id: 'text', attachmentId: attachment.id, contentHash: attachment.sha256, pageIndex: 4, selected: true, status: 'active', target: { kind: 'text', exact: '原文' }, comment: '改写句子' },
    { id: 'unselected', attachmentId: attachment.id, contentHash: attachment.sha256, pageIndex: 5, selected: false, status: 'active', target: { kind: 'region', x: 0.1, y: 0.2, width: 0.3, height: 0.2 }, comment: '未选意见' }
  ];
  const prompt = buildSelectedAnnotationPrompt(annotations, attachment);

  assert.match(prompt, /第 3 张幻灯片的批注区域截图和对应整页截图/);
  assert.doesNotMatch(prompt, /第 6 张幻灯片的批注区域截图/);
  assert.match(prompt, /纯文本，未包含图像附件/);
  assert.match(prompt, /先补充并确认目标区域的文字描述/);
});

test('多份资料的有效批注按来源分组，旧版本和已移除资料不会进入提示词', () => {
  const attachments = [
    { id: 'image-1', displayName: '流程图.png', sha256: 'sha256:image-v1' },
    { id: 'pdf-1', displayName: '说明.pdf', sha256: 'sha256:pdf-v1' }
  ];
  const annotations = [
    { id: 'image-note', attachmentId: 'image-1', contentHash: 'sha256:image-v1', target: { kind: 'point', x: 0.2, y: 0.3 }, comment: '保留图例', intent: 'keep', selected: true, status: 'active' },
    { id: 'pdf-note', attachmentId: 'pdf-1', contentHash: 'sha256:pdf-v1', target: { kind: 'text', selector: 'p', exact: '原文', prefix: '', suffix: '' }, comment: '补充定义', intent: 'add', selected: true, status: 'active' },
    { id: 'old-note', attachmentId: 'pdf-1', contentHash: 'sha256:old', target: { kind: 'point', x: 0.4, y: 0.5 }, comment: '旧版本意见', intent: 'modify', selected: true, status: 'active' },
    { id: 'removed-note', attachmentId: 'removed-1', contentHash: 'sha256:gone', target: { kind: 'point', x: 0.4, y: 0.5 }, comment: '已移除资料意见', intent: 'modify', selected: true, status: 'active' }
  ];
  const prompt = buildSelectedAnnotationPrompts(annotations, attachments);
  assert.match(prompt, /资料来源：流程图\.png[\s\S]*保留图例/);
  assert.match(prompt, /资料来源：说明\.pdf[\s\S]*补充定义/);
  assert.doesNotMatch(prompt, /旧版本意见|已移除资料意见/);
});

test('同一资料版本、页码和定位上的互斥批注显式冲突并排除', () => {
  const attachments = [{ id: 'a1', displayName: '页面.png', sha256: 'sha256:current' }];
  const target = { kind: 'region', x: 0.1, y: 0.2, width: 0.3, height: 0.2 };
  const annotations = [
    { id: 'keep-note', attachmentId: 'a1', contentHash: 'sha256:current', pageIndex: 0, target, comment: '保留原图', intent: 'keep', selected: true, status: 'active' },
    { id: 'remove-note', attachmentId: 'a1', contentHash: 'sha256:current', pageIndex: 0, target: { ...target }, comment: '删除这个区域', intent: 'remove', selected: true, status: 'active' },
    { id: 'other-page', attachmentId: 'a1', contentHash: 'sha256:current', pageIndex: 1, target, comment: '第二页仍需修改', intent: 'modify', selected: true, status: 'active' }
  ];
  const conflicts = findSelectedAnnotationConflicts(annotations, attachments);
  assert.deepEqual(conflicts.map(item => item.annotationIds.sort()), [['keep-note', 'remove-note']]);
  const prompt = buildSelectedAnnotationPrompts(annotations, attachments);
  assert.doesNotMatch(prompt, /保留原图|删除这个区域/);
  assert.match(prompt, /冲突批注/);
  assert.match(prompt, /已从提示词排除/);
  assert.match(prompt, /第二页仍需修改/);
});

test('批注冲突决定仅影响对应版本，并分别支持保留、合并与暂缓', () => {
  const attachments = [{ id: 'a1', displayName: '页面.png', sha256: 'sha256:current' }];
  const annotations = [
    { id: 'keep-note', attachmentId: 'a1', contentHash: 'sha256:current', target: { kind: 'point', x: 0.4, y: 0.5 }, comment: '保留原图', intent: 'keep', selected: true, status: 'active' },
    { id: 'remove-note', attachmentId: 'a1', contentHash: 'sha256:current', target: { kind: 'point', x: 0.4, y: 0.5 }, comment: '删除这个区域', intent: 'remove', selected: true, status: 'active' }
  ];
  const conflict = findSelectedAnnotationConflicts(annotations, attachments)[0];
  const key = getSelectedAnnotationConflictKey(conflict, annotations);
  const decision = annotationConflictChoice => ({ kind: 'annotation-conflict-resolution', annotationConflictKey: key, annotationConflictChoice, annotationConflictKeepId: 'keep-note' });

  const pending = resolveSelectedAnnotationConflicts(annotations, attachments);
  assert.equal(pending.pendingConflicts.length, 1);
  assert.equal(pending.promptSources.length, 0);
  const kept = resolveSelectedAnnotationConflicts(annotations, attachments, [decision('keep')]);
  assert.deepEqual(kept.promptSources.map(item => item.id), ['keep-note']);
  assert.equal(kept.pendingConflicts.length, 0);
  const merged = resolveSelectedAnnotationConflicts(annotations, attachments, [decision('merge')]);
  assert.equal(merged.promptSources.length, 1);
  assert.match(merged.promptSources[0].comment, /保留原图[\s\S]*删除这个区域/);
  assert.match(merged.promptSources[0].comment, /不要擅自执行/);
  const mergedPrompt = buildSelectedAnnotationPrompt(merged.promptSources, attachments[0]);
  assert.match(mergedPrompt, /保留：保留原图[\s\S]*删除：删除这个区域/);
  const deferred = resolveSelectedAnnotationConflicts(annotations, attachments, [decision('defer')]);
  assert.equal(deferred.deferredConflicts.length, 1);
  assert.equal(deferred.promptSources.length, 0);
  assert.equal(resolveSelectedAnnotationConflicts([{ ...annotations[0], comment: '新版本意见' }, annotations[1]], attachments, [decision('keep')]).pendingConflicts.length, 1);
});

test('HTML 文字锚点提示词包含原文、上下文与稳定元素线索', () => {
  const prompt = buildSelectedAnnotationPrompt([{
    id: 'html-text', attachmentId: 'html-1', contentHash: 'sha256:html-v1', selected: true, status: 'active',
    target: { kind: 'text', selector: 'main > p:nth-of-type(2)', exact: '用户选择的原文', prefix: '前文上下文', suffix: '后文上下文', source: {
      url: 'https://example.com/article', fetchedAt: '2026-11-12T01:02:03.000Z', contentHash: `sha256:${'b'.repeat(64)}`
    } },
    comment: '将这句改成更直接的表达', category: 'readability', intent: 'modify'
  }], { id: 'html-1', sha256: 'sha256:html-v1' });
  assert.match(prompt, /sha256:html-v1/);
  assert.match(prompt, /main > p:nth-of-type\(2\)/);
  assert.match(prompt, /用户选择的原文/);
  assert.match(prompt, /前文上下文.*后文上下文/);
  assert.match(prompt, /网页来源 https:\/\/example\.com\/article/);
  assert.match(prompt, /网页版本 sha256:b{64}/);
  assert.match(prompt, /将这句改成更直接的表达/);
});

test('箭头和画笔批注在修改提示词中保留定位线索', () => {
  const prompt = buildSelectedAnnotationPrompt([
    { id: 'arrow', attachmentId: 'a1', contentHash: 'sha256:one', selected: true, status: 'active', target: { kind: 'arrow', x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 }, comment: '这里需要替换' },
    { id: 'path', attachmentId: 'a1', contentHash: 'sha256:one', selected: true, status: 'active', target: { kind: 'path', points: [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.6 }] }, comment: '检查圈出的部分' }
  ], { id: 'a1', sha256: 'sha256:one' });
  assert.match(prompt, /箭头/);
  assert.match(prompt, /10%.*20%.*80%.*90%/);
  assert.match(prompt, /画笔/);
  assert.match(prompt, /2 个定位点，起点 \(20%, 30%\)，终点 \(70%, 60%\)，覆盖范围 \(20%, 30%\) 至 \(70%, 60%\)/);
  assert.match(prompt, /这里需要替换/);
  assert.match(prompt, /检查圈出的部分/);
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
