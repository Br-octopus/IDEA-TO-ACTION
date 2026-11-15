# 阶段 C：各板块功能与交接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 七板块各有合适布局，操作产生真实结果，跨板块交接保留正文、来源及版本。

**Architecture:** 在现有面板内改显示结构和局部交互，复用既有业务接口。只为现有接口缺少的引用元数据与采用状态补契约，不创建通用页面引擎。

**Tech Stack:** React.createElement、现有 Host Remote、事务与领域模块、Node test。

---

工作目录：D:/VScode/项目/提示词工具/.dsh-workspace。依赖 A；查看、批注、真实附件依赖 B。15–21按顺序执行，共享index.ts/types.ts的更改不并行。每项提交前构建修改层并检查暂存范围；纯布局以真实浏览器验收为主，不添加只断言CSS文本的测试。

页面布局落实到各面板，不能只给旧长表单加导航：

| 页面 | 桌面布局与默认内容 | 次级入口 | 窄屏 |
| --- | --- | --- | --- |
| 资料库 | 顶部搜索/筛选＋资料列表，行内只留标题/类型/来源/状态 | 详情抽屉、添加弹层、回收站 | 列表与详情单区切换 |
| 收藏 | 220px分类/列表＋minmax(0,1fr)正文；版本对比占正文区 | 新建/编辑、案例/方法子页 | 列表/正文切换，差异可上下阅读 |
| 写作 | 220px文章列表＋minmax(0,1fr)正文＋260px轮次 | 专业包、保留要求抽屉 | 文章/正文/轮次切换 |
| 学术 | 项目选择＋证据表；摘要不扩成常驻长正文 | 文献详情、导入预览、投稿/回应子页 | 证据卡片与详情切换 |
| 社媒 | 单列目标/计划/执行/结果，当前阶段为主 | 预算、平台能力、结果详情 | 同一阶段单列 |
| 偏好 | 范围筛选＋简短偏好列表；待确认建议单独分区 | 来源/版本/历史详情 | 单列与详情抽屉 |
| 设置 | 180px分类＋minmax(0,1fr)当前设置 | 恢复/迁移独立步骤 | 分类先选、内容单区 |

断点和颜色/间距沿用阶段A的局部样式及宿主主题；可读正文建议限制在72ch，主动作每个工作区一个。错误靠近对应操作，长技术结果折叠，不将内部ID、事务字段和完整原始JSON常驻页面。上表宽度是实现起点，以960/1440px真实宿主检查调整，不重造全局主题。

## 保存结果与跨板块交接的强制验收

下表随对应任务实施，不能推迟到任务23才补接线。保存返回的真实条目先更新当前列表，再按需重读；保存已成功但重读失败时显示“已保存，列表刷新失败”，允许只重读，不能让重试造成第二次保存。当前筛选排除了新条目时说明原因并提供“查看刚保存的条目”，不悄悄清筛选。

| 任务 | 动作与实际结果 | 必须测试的失败分支 |
| --- | --- | --- |
| 15 | 导入/编辑/回收/撤销后以真实entry.id定位；查看传完整source/version | 保存成功而listKnowledgeEntries失败，重试只查列表；重复导入选择引用既有条目 |
| 16 | 收藏新版本定位返回prompt.id；案例和方法卡更新对应子页 | 复用变量/正文保存失败不清稿；旧版采用只新增；不存在目标任务先选任务 |
| 17 | 新稿追加到返回workspace.rounds；采用只移动adoptedRoundId | 保存成功刷新失败不重复append；撤销过期采用不覆盖新采用 |
| 18 | 题录预览数与实际导入数一致；回应保存后返回原编号行 | 只导入选中有效条目；错误项单独修正；取消不导入 |
| 19 | 仅选中结果写资料/提示词并定位新条目 | 单平台失败保留其他结果；重复点击不生成重复收据 |
| 20 | 接受候选后从建议区进入已确认列表，撤销同步显示 | 版本冲突保留用户输入；失败不显示已生效 |
| 21 | 下载完成显示真实文件；恢复/迁移展示实际收据 | 取消不报成功；已完成项按eventId避免重复写入 |

每个领域测试以fake Remote分别计数写操作与列表读取：写成功、下一次读取失败、点击重试后写计数仍为1；真实浏览器从用户可见按钮进入，刷新后核对同一个ID的结果，不能只调用原型openFlow。批量操作逐项列成功/失败/未处理，回收站和批量资料动作仅在选择后出现。

### Task 15：资料库的列表、详情、版本与引用

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/knowledge-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/external-references-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/host-service.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/knowledge.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/vendor/core/knowledge-schema.js
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/knowledge.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/knowledge-workspace.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/client.test.mjs

- [ ] **Step 1：记录旧页基线并先补关键失败用例。** 复用knowledge.test.mjs的真实store夹具：关键词＋类型＋验证状态同时满足才出现；更新标题保留materialSources；隐藏资料后任务旧引用保留来源版本；撤销隐藏恢复；固定同hash导入默认提示重复，不自动生成第二条。运行 node --test tests/dsh-plugin/knowledge.test.mjs tests/dsh-plugin/knowledge-workspace.test.mjs，红灯必须落在新增行为。
- [ ] **Step 2：增加局部选中状态和详情抽屉。** 搜索栏/列表保持挂载，只有一份详情；添加资料按文件/网页/文本显示所需字段。下面状态放KnowledgePanel：

    const [detailId,setDetailId]=useState('');
    const [libraryTab,setLibraryTab]=useState<'materials'|'references'>('materials');
    const [sourceKind,setSourceKind]=useState<'file'|'website'|'text'>('file');

列表点击只设置detailId，编辑继续使用原beginEdit/saveEntry；详情关闭不清filters/selectedIds。外部来源并入references子页，保留原可信状态，不重复建资料库。

- [ ] **Step 3：串起统一查看器。** KnowledgePanel新props为onOpenSource:(source:MaterialSource)=>void、onUseMaterial:(material:TaskMaterial)=>void。查看时传所选materialSources版本；加入任务时传实际摘录/范围、source及purpose。父级通过现有updateTask保存materials，成功后切工作台并打开该版本；没有当前任务先选择任务，保留资料选择。仅加入资料不发模型请求。
- [ ] **Step 4：版本与重复。** 相同hash显示“引用现有/另存版本”；另存复用sourceId并产生新versionId。旧版本不覆盖，解析成功后显示页数/摘录长度/遗漏/来源状态。普通编辑禁止客户端伪造原件引用。
- [ ] **Step 5：改删除为回收站路径。** 复用setKnowledgeFlags，不调用已有永久删除作为普通按钮：

    await remote.setKnowledgeFlags({
      entryId:entry.id,
      patch:{hiddenAt:new Date().toISOString()},
      eventId:globalThis.crypto.randomUUID()
    });

撤销发送hiddenAt:''。调用后检查RemoteResult.ok，再更新列表。补拟新增previewKnowledgeRemoval({entryId})返回引用该资料版本的taskId/title/versionId；Host按tasks.materials和materialReview扫描，数量来自真实记录。listKnowledgeEntries增加includeHidden?:boolean供回收站，默认保持旧行为。隐藏条目后已有引用标“来源已移入回收站”，旧快照仍可追溯；永久删除如保留在更多菜单，必须列出影响，不能把批注改指到新版。

- [ ] **Step 6：真实路径验收。** 导入两文件＋网页→筛选交集→详情→查看→加入指定任务→返回原筛选位置→回收→撤销；失败保留输入，取消不写新条目。构建Host/Remote/client并运行上述测试及client.test.mjs。提交 feat: 完善资料库版本引用与回收流程。

### Task 16：提示词正文、变量、版本、案例和方法卡

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/assets-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/types.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/host-service.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/assets.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/method-cards.js
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/client/prompt-variables.js
- Create/Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/test_prompt_variables.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/assets.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/method-cards.test.mjs

- [ ] **Step 1：编写变量替换失败测试。** 模板约定使用双花括号，重复变量只问一次；未填必需变量不形成任务副本。

    import test from 'node:test';
    import assert from 'node:assert/strict';
    import {fillPromptVariables} from '../../dsh-plugin/forward-step-dsh/client/prompt-variables.js';
    test('变量缺失明确指出，替换保留正文',()=>{
      assert.deepEqual(fillPromptVariables('给{{受众}}解释{{主题}}',{受众:'新同事'}).missing,['主题']);
      assert.deepEqual(fillPromptVariables('给{{受众}}说明',{受众:'新同事'}),
        {text:'给新同事说明',missing:[]});
    });
    test('替换值不会被当成新的模板',()=>{
      assert.equal(fillPromptVariables('{{内容}}',{内容:'{{保留原样}}'}).text,'{{保留原样}}');
    });

运行 node --test tests/dsh-plugin/test_prompt_variables.mjs，预期新模块缺失。

- [ ] **Step 2：实现一次替换，不加模板库。**

    export function fillPromptVariables(text,values){
      const missing=[];
      const output=text.replace(/\{\{([^{}]+)\}\}/gu,(match,key)=>{
        const name=key.trim();
        const value=Object.hasOwn(values,name)?values[name]:undefined;
        if(typeof value!=='string'||!value.trim()){
          if(!missing.includes(name))missing.push(name);
          return match;
        }
        return value;
      });
      return {text:output,missing};
    }

- [ ] **Step 3：资产页改为三个独立子页。** assetsTab='prompts'|'cases'|'methods'；提示词页为分类/列表＋正文，版本比较调用已有comparePromptVersions。原编辑表单按需打开且带入真实正文；版本恢复通过savePromptAsset新建版本，不覆盖旧版。搜索/当前条目/未保存稿在切子页后保留。
- [ ] **Step 4：新增明确交接。** AssetsPanel增加onUsePrompt:(value:{text:string;promptId:string;version:number})=>void；填变量后将实际text和来源传父级，写任务草稿再切workbench，不调用模型。回存收藏保存用户编辑后的text；PromptAsset拟增加sourceTaskId/sourcePromptVersionId/sourceReviewDraftId，core/assets.js规范化及类型、备份同时保留。sourcePromptVersionId只指现有StoredVersion，批注整理稿使用sourceReviewDraftId，不能把两种ID混用。案例拟增加promptAssetId/promptAssetVersion/sourceTaskId/resultVersionId，证据存在才允许tested。
- [ ] **Step 5：方法卡保留其步骤和适用边界。** 复用listMethodCards/saveMethodCard，版本历史缺失时在core/method-cards.js补revision/history，并在save时追加旧快照；已有内置卡不可原地覆盖。复用动作携带cardId/revision/summary/stages/domain，按实际任务领域显示差异，确认后进入任务材料而非只改标题。案例同样携带局限与结果，不自动变成长期规则。
- [ ] **Step 6：测试与验收。** node --test tests/dsh-plugin/test_prompt_variables.mjs tests/dsh-plugin/assets.test.mjs tests/dsh-plugin/method-cards.test.mjs。新增断言：采用旧版生成新版、缺变量阻止、case来源保存后可读、方法卡历史可追溯、收藏不自动tested。真浏览器走“复用→编辑→收藏→记录结果→回原版本”。提交 feat: 完善收藏版本与正文复用。

### Task 17：写作的正文、轮次、采用和专业包

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/writing-workspace-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/writing-packs-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/writing.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/vendor/core/writing-workbench-schema.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/host-service.ts
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/writing-workspace.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/writing-packs.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/writing-host.test.mjs

- [ ] **Step 1：先锁定“确认轮次”与“采用正文”的区别。** 现有setWritingRoundReview只记录复盘状态，不能直接当成采用。新增workspace.adoptedRoundId:string|null和adoptionHistory:{id,fromRoundId,toRoundId,createdAt}[]；旧数据缺该字段时不擅自把最后一稿当已采用。
- [ ] **Step 2：在writing-workspace.test.mjs中加入纯函数测试。**

    test('采用只移动正文引用，不改历史轮次',()=>{
      const workspace={rounds:[{id:'r1',draft:'初稿'},{id:'r2',draft:'候选'}],adoptedRoundId:'r1'};
      const next=adoptWritingRound(workspace,'r2');
      assert.equal(next.adoptedRoundId,'r2');
      assert.equal(next.rounds[0].draft,'初稿');
      assert.equal(workspace.adoptedRoundId,'r1');
      assert.throws(()=>adoptWritingRound(workspace,'missing'));
    });

增加adoptWritingRound导入，运行 node --test tests/dsh-plugin/writing-workspace.test.mjs，确认缺失导出。

- [ ] **Step 3：在core/writing.js实现基本采用。**

    export function adoptWritingRound(workspace,roundId){
      const round=workspace.rounds.find(item=>item.id===roundId);
      if(!round||!round.draft?.trim())throw new TypeError('请选择包含正文的轮次');
      return {...workspace,adoptedRoundId:roundId,
        adoptionHistory:[...(workspace.adoptionHistory??[]),{
          id:randomUUID(),fromRoundId:workspace.adoptedRoundId??null,
          toRoundId:roundId,createdAt:new Date().toISOString()
        }]};
    }

randomUUID已由writing.js导入。schema保留新增字段；拟新增Remote adoptWritingRound({articleId,roundId,expectedRevision,eventId})，按现有saveWritingWorkspace事务落盘并校验归属。撤销拟新增undoWritingAdoption({articleId,adoptionId,expectedRevision,eventId})，仅允许撤销当前末次采用；有后续采用则提示冲突。恢复为null意味着尚未采用，不删除稿件。

- [ ] **Step 4：页面以稿件为主。** 左文章列表、中正文、右轮次；article/view/rounds单区切换用于窄屏。新建没有正文时只显示想法。新稿使用appendWritingRound保存为候选，compareWritingRounds展示依据与候选，明确采用后才更新正文引用。restoreWritingRound继续保留历史语义，不用它覆盖原稿。
- [ ] **Step 5：写作批注接同一查看器。** 所选round.id作为来源版本的一部分，原文保存成text资料快照；onUseMaterial携带articleId/roundId/正文/用途。生成的是修改提示词；收到新稿再比较采用。保留项与专业包预览另开抽屉，当前和历史轮次固定packSnapshot，新包版本只用于后续轮次。
- [ ] **Step 6：构建并运行 node --test tests/dsh-plugin/writing-workspace.test.mjs tests/dsh-plugin/writing-packs.test.mjs tests/dsh-plugin/writing-host.test.mjs。** 真浏览器检查新稿保存失败保留输入、未采用不替换、撤销采用、批注返回原轮次。提交 feat: 按稿件与轮次重设计写作页面。

### Task 18：学术证据、题录预览、投稿与回应

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/domain-workbenches-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts
- Modify when validation is missing: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/academic.js
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/academic.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/domain-workbenches.test.mjs

- [ ] **Step 1：先运行既有学术测试并补缺口用例。** 输入一份RIS含一条有效、一条重复、一条缺题名，预览数量=实际分组；确认只导入选中有效项。证据“排除”必须有理由；审稿回应“已完成”必须有实际位置；“不修改”必须有理由。node --test tests/dsh-plugin/academic.test.mjs tests/dsh-plugin/domain-workbenches.test.mjs。
- [ ] **Step 2：研究首页增加学术/社媒选择，学术内部使用独立子页。**

    const [researchTab,setResearchTab]=useState<'academic'|'social'>('academic');
    const [academicTab,setAcademicTab]=useState<'evidence'|'submission'|'responses'>('evidence');

项目选择和证据表常驻于学术区；题录导入、证据详情、投稿要求、回应编辑分别按需展开。切子页不销毁原请求控制器和草稿。

- [ ] **Step 3：复用确实存在的接口。** previewAcademicBibliography({text,format})先预览，importAcademicBibliography({entries})只传确认项；listAcademicWorkspaces显示真实列表；保存/筛选动作继续使用现有applyAcademicWorkspaceAction的已定义action，不杜撰新字符串。原始出处/原文/页码与推断分栏；核实状态与筛选状态分开。
- [ ] **Step 4：只传选中证据。** buildAcademicPrompt({projectId,kind,ids})的ids来自用户勾选；DomainWorkbenchesPanel拟新增props `onUsePrompt:(value:{text:string;projectId:string;kind:string;ids:string[]})=>void`，返回prompt作为text带入工作台草稿，附项目ID/证据ID引用。父级将该领域回调与AssetsPanel的收藏回调分别处理，不混用两种参数。kind沿用现有按钮实际值。资料进入查看器使用任务15的onUseMaterial；没有全文的题录只能展示题录/摘录，不能标已读全文。
- [ ] **Step 5：补投稿与审稿闭环。** 要求来源和查阅时间保留，“已核实要求”与“稿件已满足”分开；原始审稿编号不可丢，草稿/计划/实际完成分开。导出前列出缺回应、缺位置、缺依据条目，不自动投稿。用表单原值和保存返回结果驱动列表，取消不写记录。
- [ ] **Step 6：构建并重跑上述测试；真浏览器走题录→筛选→证据→提示词、要求→清单、意见→实际位置→完成。** 提交 feat: 重排学术证据与审稿回应流程。

### Task 19：社媒计划、执行、部分结果和报告

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/domain-workbenches-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts
- Modify when needed: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/social-research.js
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/social-research.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/domain-workbenches.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/dsh-browser-social-research.test.mjs

- [ ] **Step 1：先覆盖状态回归。** 现有fixture让两个平台一成功一失败，断言成功结果仍保留；取消保留已完成结果；重试不超过原预算；切换任务后旧结果不写新任务。运行 node --test tests/dsh-plugin/social-research.test.mjs tests/dsh-plugin/domain-workbenches.test.mjs tests/dsh-plugin/dsh-browser-social-research.test.mjs。
- [ ] **Step 2：按阶段显示页面。** 未开始显示目标和“建立计划”；计划就绪显示平台/关键词/范围/预算/可运行状态；运行显示逐平台收据和取消；结束显示结果列表及失败原因，不再同时铺开所有表单。
- [ ] **Step 3：保留现有控制器与真实执行API。** runAuthorizedSocialResearch({taskId,confirmed:true,platforms},signal)仅在用户核对计划后调用。暂停/继续/取消/跳过平台使用现有applySocialResearchTaskAction；原activeSocialSearch/activeSocialReport/activeSocialDownload的归属与Abort处理全部保留。profileConfigured不显示成已登录，未核实状态有单独说明。
- [ ] **Step 4：结果选择与报告。** 展示平台、来源链接、时间、摘录、采集状态；仅勾选结果进入保存资料或buildSocialResearchReportPrompt({taskId,resultIds})。生成报告是另一个明确动作generateSocialResearchReport，不能点“生成提示词”就调用模型；手改报告提示词经saveSocialResearchReportPrompt另存parentRunId版本。
- [ ] **Step 5：失败/无结果/部分完成分别显示。** 重试失败平台前展示剩余预算与将执行查询；取消与删除不是同一个动作。保存资料后定位实际新条目；附件下载走既有校验，不伪造文件。
- [ ] **Step 6：构建并运行上述测试，真实平台验收与模拟分开记录。** 未具备登录不把模拟结果当真实采集通过。提交 feat: 按执行阶段展示社媒计划与结果。

### Task 20：已确认偏好、候选建议与可撤销操作

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/memory-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts
- Reuse/Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/memory/history.js
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/memory-view.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/memory-history.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/memory-policy.test.mjs

- [ ] **Step 1：先补真实行为测试。** candidate默认不参与有效偏好；接受后生效；忽略后不自动复活；停用/撤销留历史；撤销遇后续修改要冲突选择。现有getMemoryView必须带真实TaskScopeContext，无任务不得虚构taskId。命令 node --test tests/dsh-plugin/memory-view.test.mjs tests/dsh-plugin/memory-history.test.mjs tests/dsh-plugin/memory-policy.test.mjs。
- [ ] **Step 2：列表分成确认项和建议区。** scope筛选显示当前任务/领域/全局，详情包含内容、来源、版本、历史。独立记忆页没选任务时显示“选择任务查看适用偏好”及真实任务选择器，保持现有按任务查询契约。
- [ ] **Step 3：复用已有动作，文案表达影响。** setMemoryStatus active=确认/启用，disabled=忽略/停用；editMemory保留memoryRevision/eventId及范围确认；undoMemory先预览冲突，删除继续沿用现有明确影响。扩大到全局显示实际范围；普通启停直接生效并给撤销，避免每次都弹确认。
- [ ] **Step 4：保留隔离判断。** 原isCurrentMemoryViewRequest防止迟到响应；key/草稿按taskId和memoryId保存，切页面不清草稿。历史使用依据保持原revision，新偏好只影响后续请求，不能重写旧任务记录。
- [ ] **Step 5：构建并运行上述测试；真浏览器接受/编辑/忽略/停用/撤销并核对后续上下文。** 提交 feat: 区分偏好建议与已确认记忆。

### Task 21：设置分类、连接状态、备份与迁移入口

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/settings-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/backup-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/migration-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/plugin-settings.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/backup-ui.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/migration-ui.test.mjs

- [ ] **Step 1：先锁定默认模型初始化回归。** 初次未打开设置仍能读取偏好/模型；保存连接只显示已配置，测试成功才验证；修改地址后旧验证状态失效；取消测试不报成功。复用SettingsPanel已存在testPluginServiceEndpoint和AbortController，补对应测试。
- [ ] **Step 2：父级设置页增加分类，保留SettingsPanel eager挂载。**

    const [settingsTab,setSettingsTab]=useState<'general'|'connections'|'backup'|'migration'>('general');

SettingsPanel拟新增section:'general'|'connections' props，内部初始化effect不依赖分类；分类仅隐藏展示。backup/migration面板保活以保留上传和预览，切分类不重新初始化恢复任务。

- [ ] **Step 3：连通状态与配置绑定。** 已有端点测试继续发送{service,confirmed:true}并传signal；状态保存本次地址/模型摘要，编辑输入或取消后不得复用旧success。失败保留配置和输入；凭证沿用宿主，不进入产品本地导出。
- [ ] **Step 4：备份/恢复/迁移使用现有流程。** 备份选择范围→展示真实条目/附件数量→生成文件→下载确认；恢复/迁移选择文件→校验和预览→逐项冲突选择→影响确认→提交→收据。沿用expectedRevision、hash、eventId、分块与取消，不直接把输入JSON写store。
- [ ] **Step 5：收据细分成功/失败/未处理。** 成功项重试不重复写；预览后数据变化时重新预览；确认前取消不改数据。恢复前备份及位置可见；新增资料/批注附件的真实性由任务22验收。
- [ ] **Step 6：构建并运行 node --test tests/dsh-plugin/plugin-settings.test.mjs tests/dsh-plugin/backup-ui.test.mjs tests/dsh-plugin/migration-ui.test.mjs。** 真浏览器验证四分类、未配置/测试取消、下载失败、预览取消和逐项收据。提交 feat: 分类设置并明确连接与恢复结果。

阶段C完成标准：每个主页面都有独立布局和一个可完成的主流程；所有次级流程可达且写入真实结果。返回工作台必须携带实际内容与固定版本，不能只带标题或显示成功提示。

