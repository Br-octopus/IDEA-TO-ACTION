const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAgentResponse, confirmsRecommendation, promptReplacementNeedsConfirmation, groupConversationTurns, buildComposerDocumentTransfer, buildPromptTransferDraft, captureKnowledgeSource, appendKnowledgeSource, buildModificationPrompt, appendPromptVersion } = require("../prototype/workbench-dialogue.js");

test("解析当前问题的情境选项和推荐索引，同时保留自由追问", () => {
  const result = parseAgentResponse(JSON.stringify({
    reply: "我理解你要压缩周报整理时间。",
    question: "先统一哪个团队的周报？",
    options: ["产品团队", "研发团队"],
    recommendedOption: 1,
    recommendation: { text: "先从研发团队开始", reason: "你提到这部分重复工作最多。" },
    optional: false
  }));
  assert.equal(result.reply, "我理解你要压缩周报整理时间。");
  assert.equal(result.text, "我理解你要压缩周报整理时间。\n\n先统一哪个团队的周报？");
  assert.deepEqual(result.options, ["产品团队", "研发团队"]);
  assert.equal(result.recommendedOption, 1);
  assert.equal(result.optional, false);
  assert.deepEqual(result.recommendation, { text: "先从研发团队开始", reason: "你提到这部分重复工作最多。" });
  const nested = parseAgentResponse(JSON.stringify({
    reply: "我理解你想让周报更高效。",
    question: { text: "你先看哪一项？", options: ["整理时间", "可读性"] },
    recommendedOption: 0,
    optional: true
  }));
  assert.deepEqual(nested.options, ["整理时间", "可读性"]);
  assert.equal(nested.recommendedOption, 0);
  assert.equal(nested.optional, true);
});

test("非法、重复或超量选项不生成按钮，普通文本不猜测菜单", () => {
  for (const options of [["甲", "乙", "丙", "丁"], ["甲", "甲"], ["甲", ""]]) {
    const result = parseAgentResponse(JSON.stringify({ question: "选择方向？", options, recommendedOption: 1 }));
    assert.deepEqual(result.options, []);
    assert.equal(result.recommendedOption, null);
    assert.equal(result.question, "选择方向？");
  }
  assert.equal(parseAgentResponse('{"question":"选择一个","options":["甲"],"recommendedOption":9}').recommendedOption, null);
  const plain = parseAgentResponse("我理解你希望缩短整理时间，也提高可读性。");
  assert.equal(plain.reply, "我理解你希望缩短整理时间，也提高可读性。");
  assert.deepEqual(plain.options, []);
  assert.deepEqual(parseAgentResponse("null").options, []);
});

test("用户在对话中简短确认建议时识别为确认，修正意见不误判", () => {
  assert.equal(confirmsRecommendation("好"), true);
  assert.equal(confirmsRecommendation("按这个建议"), true);
  assert.equal(confirmsRecommendation("好的，就按这个建议继续"), true);
  assert.equal(confirmsRecommendation("我同意这个建议"), true);
  assert.equal(confirmsRecommendation("这个建议不错"), true);
  assert.equal(confirmsRecommendation("OK"), true);
  assert.equal(confirmsRecommendation("可以，但别自动汇总"), false);
  assert.equal(confirmsRecommendation("不要这个建议"), false);
});

test("替换已手改提示词时仅在草稿不同于生成稿和目标历史版时要求确认", () => {
  assert.equal(promptReplacementNeedsConfirmation("手改稿", "生成稿"), true);
  assert.equal(promptReplacementNeedsConfirmation("生成稿", "生成稿"), false);
  assert.equal(promptReplacementNeedsConfirmation("目标历史稿", "生成稿", "目标历史稿"), false);
});

test("对话按用户轮次分组并标记最后一轮保持展开", () => {
  const turns = groupConversationTurns([
    { role: "user", text: "初始目标" }, { role: "assistant", text: "第一轮回应" },
    { role: "user", text: "补充要求" }, { role: "assistant", text: "当前回应" }
  ]);
  assert.deepEqual(turns.map(turn => turn.messages.map(message => message.text)), [["初始目标", "第一轮回应"], ["补充要求", "当前回应"]]);
  assert.deepEqual(turns.map(turn => turn.current), [false, true]);
});

test("长正文转文档支持选区并保留未选意见", () => {
  const source = "请先看这段意见：\n" + "正文内容。".repeat(100);
  const start = source.indexOf("正文内容");
  const end = start + "正文内容。".length * 3;
  const selected = buildComposerDocumentTransfer(source, start, end);
  assert.equal(selected.text, source.slice(start, end));
  assert.equal(selected.remaining, `${source.slice(0, start)}${source.slice(end)}`);
  assert.equal(buildComposerDocumentTransfer("短意见", 0, 0), null);
  const whole = buildComposerDocumentTransfer("长正文".repeat(500));
  assert.equal(whole.remaining, "");
  assert.equal(whole.text, "长正文".repeat(500));
});

test("收藏提示词交接保留已填写正文、版本来源和本次补充", () => {
  const draft = buildPromptTransferDraft({ id: "prompt-v3", groupId: "prompt-set", title: "验收提示词", version: 3, domain: "软件测试" }, "检查登录流程的返回结果", "重点关注失败分支", "prompt-v3");
  assert.match(draft, /来源 ID：prompt-v3/);
  assert.match(draft, /版本：V3/);
  assert.match(draft, /状态：当前版本/);
  assert.match(draft, /【本次任务实际使用的正文】\n检查登录流程的返回结果/);
  assert.match(draft, /【本次任务补充】\n重点关注失败分支/);
  assert.equal(buildPromptTransferDraft(null, "正文"), "");
});

test("修改提示词只汇总原始目标和用户补充，不混入 Agent 追问", () => {
  const prompt = buildModificationPrompt({
    idea: "改进团队周报",
    conversation: [
      { role: "user", text: "改进团队周报" },
      { role: "assistant", text: "这次更重视什么？", options: ["省时间", "更易读"] },
      { role: "user", text: "省时间" },
      { role: "assistant", text: "还可以继续补充。" },
      { role: "user", text: "本轮先跳过这个问题", skipped: true, replyToMessageId: "old-question" },
      { role: "user", text: "每周最多花半小时", confirmedRecommendation: "统一周报结构并自动汇总进展" }
    ]
  });
  assert.match(prompt, /改进团队周报/);
  assert.match(prompt, /省时间/);
  assert.match(prompt, /每周最多花半小时/);
  assert.doesNotMatch(prompt, /本轮先跳过这个问题/);
  assert.match(prompt, /用户已在对话中明确确认的方向：[\s\S]*统一周报结构并自动汇总进展/);
  assert.equal(prompt.endsWith("\n"), false);
  assert.doesNotMatch(prompt, /这次更重视什么/);
});

test("资料快照保留版本与来源更新时间，并在重复带入时去重", () => {
  const source = {
    id: "manual-source",
    version: 4,
    title: "检查方法",
    updatedAt: "2026-11-10T08:00:00.000Z"
  };
  const first = appendKnowledgeSource([], source, "2026-11-11T08:00:00.000Z");
  const importedSnapshot = captureKnowledgeSource(first[0]);
  const repeated = appendKnowledgeSource(first, importedSnapshot, "2026-11-11T09:00:00.000Z");

  assert.equal(first[0].version, 4);
  assert.equal(first[0].sourceUpdatedAt, source.updatedAt);
  assert.equal(importedSnapshot.sourceUpdatedAt, source.updatedAt);
  assert.strictEqual(repeated, first, "已保存快照再次带入不得重复添加");

  const newer = appendKnowledgeSource(first, { ...source, version: 5, updatedAt: "2026-11-11T10:00:00.000Z" });
  assert.equal(newer.length, 2);
  assert.equal(newer[1].version, 5);
});

test("提示词版本冻结当时引用的批注快照，并只保留最近 10 版", () => {
  const attachment = { id: "attachment-a", displayName: "方案.png", sha256: "sha256:a" };
  const annotation = {
    id: "note-a", attachmentId: attachment.id, contentHash: attachment.sha256,
    pageIndex: 2, target: { kind: "region", x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    comment: "保留图例", category: "style", intent: "keep", selected: true, status: "active"
  };
  const excludedAnnotations = [
    { ...annotation, id: "note-stale", status: "stale" },
    { ...annotation, id: "note-unselected", selected: false },
    { ...annotation, id: "note-old-version", contentHash: "sha256:old" }
  ];
  const versions = appendPromptVersion([], {
    id: "version-1", createdAt: "2026-11-11T00:00:00.000Z", prompt: "提示词第一版",
    annotations: [annotation, ...excludedAnnotations], attachments: [attachment]
  });
  assert.equal(versions[0].version, 1);
  assert.deepEqual(versions[0].citations, [{
    annotationId: "note-a", attachmentId: "attachment-a", attachmentName: "方案.png",
    contentHash: "sha256:a", pageIndex: 2,
    targetSnapshot: JSON.stringify(annotation.target), comment: "保留图例", category: "style", intent: "keep"
  }]);
  const mergedComment = "合并意见".repeat(400);
  const mergedVersion = appendPromptVersion([], {
    prompt: "合并版提示词", annotations: [{ ...annotation, comment: mergedComment, mergedConflict: true }], attachments: [attachment]
  });
  assert.equal(mergedVersion[0].citations[0].comment, mergedComment);
  assert.strictEqual(appendPromptVersion(versions, {
    id: "duplicate", createdAt: "2026-11-11T00:01:00.000Z", prompt: "提示词第一版",
    annotations: [annotation], attachments: [attachment]
  }), versions, "正文与引用快照不变时不重复记版本");

  annotation.comment = "后来修改的意见";
  annotation.target.x = 0.8;
  assert.equal(versions[0].citations[0].comment, "保留图例");
  assert.equal(versions[0].citations[0].targetSnapshot, JSON.stringify({ kind: "region", x: 0.1, y: 0.2, width: 0.3, height: 0.4 }));

  let history = versions;
  for (let number = 2; number <= 12; number++) {
    history = appendPromptVersion(history, {
      id: `version-${number}`, createdAt: `2026-11-11T00:${String(number).padStart(2, "0")}:00.000Z`,
      prompt: `提示词第 ${number} 版`, annotations: [], attachments: []
    });
  }
  assert.equal(history.length, 10);
  assert.equal(history[0].version, 3);
  assert.equal(history.at(-1).version, 12);
});
