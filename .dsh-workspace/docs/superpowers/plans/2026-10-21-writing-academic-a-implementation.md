# 学术 A：文献记录、题录检索与阅读提示词实施计划

对应规格：`docs/superpowers/specs/2026-10-21-writing-academic-a-spec.md`
依赖：共用核心 A/B/C 已验收；复用现有资料库、材料选择和工作区备份。
执行方式：当前代理串行推进；按失败测试、最小实现、定向回归、D 盘应用验收推进。

## Task 1：学术记录 schema、RIS/BibTeX 和阅读提示词

**Files:**
- Create: `prototype/academic-literature.js`
- Modify: `prototype/knowledge-schema.js`
- Test: `tests/academic-literature.test.js`
- Test: `tests/knowledge-schema.test.js`

- [x] 先为 RIS/BibTeX 子集解析、字段规范化、重复 DOI 去重、三类状态互不越级、1200 字摘录上限和阅读提示词范围写失败测试。
- [x] 扩展知识类型与严格嵌套题录白名单；旧普通资料规范化结果保持不变。
- [x] 实现导入解析、RIS 导出和阅读提示词；无效条目报告错误，不丢其他尚未导入的文本。

## Task 2：用户确认的 DOI/PMID 题录查询

**Files:**
- Create: `server/academic-literature-client.js`
- Modify: `server.js`
- Test: `tests/academic-literature-client.test.js`
- Test: `tests/server.test.js`

- [x] 写失败测试覆盖 DOI/PMID 校验、Crossref/NCBI 返回映射、找不到、上游失败和没有摘要/正文。
- [x] 新增只接受单个 DOI 或 PMID 的固定上游接口；URL 不接受用户提供 host，响应白名单不回传上游原始 JSON。
- [x] UI 只在用户勾选外发内容范围并确认后调用；请求体仅含规范化 DOI/PMID，应用不缓存提供方摘要。

## Task 3：本地资料兼容和备份往返

**Files:**
- Modify: `prototype/knowledge-schema.js`
- Test: `tests/knowledge-schema.test.js`
- Test: `tests/workspace-backup.test.js`
- Test: `tests/storage.test.js`

- [x] 验证文献存在现有 `knowledgeEntries` 中，旧条目迁移无语义变化；不知道题录字段时不造默认引用。
- [x] 验证嵌套字段只按 schema 白名单保存；凭证、路径和未知字段不持久化。
- [x] 验证完整工作区备份往返保留本地题录/状态，知识库备份边界保持不变。

## Task 4：文献库 UI 与提示词接线

**Files:**
- Modify: `prototype/index.html`
- Modify: `prototype/app.js`
- Modify: `tests/helpers/writing-app.js`
- Test: `tests/academic-literature-ui.test.js`

- [x] 先用页面级测试覆盖单条 DOI/PMID 查询确认、RIS/BibTeX 预览、导入/导出、状态编辑和生成阅读提示词。
- [x] 在现有资料库增加文献管理区；列表搜索沿用本地资料，文献可作为写作工作台材料选择。
- [x] 查询失败、保存失败和取消时保留输入与原状态；提示词复制不冒称已发送。
- [x] 确认键盘焦点、窄屏布局和实际预览所包含的文献/摘录范围。

## Task 5：D 盘应用验收、记录与阶段状态

**Files:**
- Create: `docs/superpowers/plans/2026-10-21-writing-academic-a-acceptance.md`
- Modify: `docs/superpowers/plans/2026-10-21-writing-academic-a-implementation.md`
- Modify: `docs/superpowers/specs/2026-10-20-writing-domain-expansion-design.md`
- Modify: `package.json`（将新模块加入既有语法检查命令）

- [x] 运行学术、知识 schema、备份、服务端与应用页面专项回归、`pnpm check`、`git diff --check`。
- [x] 在新的隔离 Electron 配置中导入/保存/搜索/选择文献，生成提示词并验证只含所选题录和用户摘录。
- [x] 测试 DOI 与 PMID 的实际查询响应及上游失败状态；不发送真实摘要或正文。
- [x] 刷新、完整备份往返、390×844 和键盘验收；真实模型与真机如实标注。
- [x] 记录风险边界，将蓝图学术 A 状态改为已验收；然后进入学术 B。
