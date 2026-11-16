const test = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../prototype/unified-workbench-schema.js");

test("旧项目得到空的统一工作台结构且保留原字段", () => {
  const project = schema.normalizeWorkbenchProject({ id: "p1", idea: "复刻一个 APP" });
  assert.equal(project.id, "p1");
  assert.equal(project.idea, "复刻一个 APP");
  assert.deepEqual(project.workbenchContents, []);
  assert.deepEqual(project.workbenchCanvases, []);
  assert.deepEqual(project.workbenchPromptRounds, []);
  assert.deepEqual(project.workbenchSelection.items, []);
  assert.equal(project.workbenchSelection.layoutIntent.enabled, false);
});

test("内容、版本、画布节点和提示词轮次保留稳定 ID 与快照引用", () => {
  const project = schema.normalizeWorkbenchProject({
    id: "p1",
    workbenchContents: [{ id: "content-1", versions: [{ id: "version-1", hash: "sha256:x", text: "正文" }] }],
    workbenchCanvases: [{ id: "canvas-1", nodes: [{ id: "node-1", contentVersionId: "version-1" }] }],
    workbenchPromptRounds: [{ id: "round-1", contentVersionIds: ["version-1"], deliveries: [{ id: "delivery-1", materials: [{ contentVersionId: "version-1" }] }] }],
    workbenchSelection: { items: [{ contentVersionId: "version-1" }] }
  });
  assert.equal(project.workbenchContents[0].versions[0].id, "version-1");
  assert.equal(project.workbenchCanvases[0].nodes[0].contentVersionId, "version-1");
  assert.deepEqual(project.workbenchPromptRounds[0].contentVersionIds, ["version-1"]);
  assert.equal(project.workbenchPromptRounds[0].deliveries[0].materials[0].contentVersionId, "version-1");
  assert.deepEqual(project.workbenchSelection.items.map(item => item.contentVersionId), ["version-1"]);
});

test("显式旧记录关联可重复迁移且不自动吞并旧集合", () => {
  const record = { collection: "promptAgentTasks", sourceId: "task-1" };
  const source = { id: "p1", idea: "任务", legacyTaskSnapshot: { id: "task-1" } };
  const once = schema.migrateWorkbenchProject(source, [record, record]);
  const twice = schema.migrateWorkbenchProject(once, [record]);
  assert.deepEqual(once.workbenchLegacyRefs, [record]);
  assert.deepEqual(twice.workbenchLegacyRefs, [record]);
  assert.equal(twice.legacyTaskSnapshot.id, "task-1");
  assert.deepEqual(schema.normalizeWorkbenchProject(source).workbenchLegacyRefs, []);
});

test("悬空引用、重复 ID 和错误引用类型明确失败", () => {
  assert.throws(() => schema.normalizeWorkbenchProject({
    workbenchPromptRounds: [{ id: "round-1", contentVersionIds: "version-1" }]
  }), /须为数组/);
  assert.throws(() => schema.normalizeWorkbenchProject({
    workbenchCanvases: [{ id: "canvas-1", nodes: [{ id: "node-1", contentVersionId: "missing" }] }]
  }), /不存在的内容版本/);
  assert.throws(() => schema.normalizeWorkbenchProject({
    workbenchContents: [{ id: "duplicate" }, { id: "duplicate" }]
  }), /ID 无效或重复/);
  assert.throws(() => schema.normalizeWorkbenchProject({
    workbenchCanvases: [{ id: "canvas-1", nodes: [{ id: "node-1" }, { id: "node-1" }] }]
  }), /ID 无效或重复/);
});
