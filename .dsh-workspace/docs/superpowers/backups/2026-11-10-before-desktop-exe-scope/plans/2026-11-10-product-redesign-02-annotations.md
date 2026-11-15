# 阶段 B：真实资料与批注修改提示词 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 真实资料能够查看和批注，工作台能据所选意见生成有定位依据的修改提示词，旧手改稿得到保留。

**Architecture:** 资料保存不可变版本，任务引用版本；批注附着于版本而非屏幕像素。复用任务事务、附件、版本与备份；默认使用确定性整理，不增加一次非必要模型调用。

**Tech Stack:** 现有 React/TypeScript、DOM/SVG、PDF.js、parse5、DSH attachments、Node test。

---

工作目录：D:/VScode/项目/提示词工具/.dsh-workspace。依赖阶段 A。下列新类型、函数和 Remote 协议是实施目标，不代表当前已有能力。测试命令均在工作目录运行。

### Task 6：资料版本与能力取证

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/types.ts
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/material-review.js
- Create/Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/test_material_review.mjs
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/docs/superpowers/acceptance/2026-11-10-material-capabilities.md

- [ ] **Step 1：记录真实能力。** 按 image、文字PDF、扫描PDF、PPTX、DOCX、HTML、website 分行记录：输入样本、字节读取、渲染器和版本、文字层、固定平面、取消、限制、实测结果。“能解析摘录”不能作为“保真查看”证据。
- [ ] **Step 2：加入共享类型。** TaskMaterial 增加 source?: MaterialSource；TaskMethodState 增加 materialReview?: MaterialReviewState；客户端重复定义改用同一类型。

    export interface MaterialBlob {
      id: string; sha256: string; bytes: number;
    }
    export interface MaterialSource {
      sourceId: string; versionId: string; title: string;
      kind: 'image' | 'pdf' | 'pptx' | 'docx' | 'html' | 'website' | 'text';
      mimeType: string; createdAt: string; url?: string;
      original?: MaterialBlob; text?: string;
      rendition?: MaterialBlob;
      conversion?: {inputSha256:string;renderer:string;rendererVersion:string;warnings:string[]};
      pages: {pageId:string;width:number;height:number;blob?:MaterialBlob}[];
      capabilities: {text:boolean;region:boolean;ink:boolean};
      renderer: {name:string;version:string};
    }
    export type MaterialTarget =
      | {kind:'text';exact:string;prefix:string;suffix:string;start:number;end:number;pageId?:string}
      | {kind:'point'|'rect'|'ellipse'|'arrow'|'ink';pageId:string;
         width:number;height:number;points:{x:number;y:number}[]}
      | {kind:'page';pageId:string}
      | {kind:'document'};
    export interface MaterialAnnotation {
      id:string;revision:number;sourceId:string;sourceVersionId:string;
      target:MaterialTarget;comment:string;
      intent:'change'|'delete'|'preserve'|'question';
      decoration?:'highlight'|'underline'|'strike';
      evidence?:MaterialBlob;requiresVisual:boolean;
      locationDescription?:string;
      status:'open'|'resolved';anchorStatus:'valid'|'needs-confirmation'|'missing';
      selected:boolean;createdAt:string;
    }
    export interface MaterialPromptDraft {
      id:string;parentId?:string;text:string;edited:boolean;createdAt:string;
      basedOn:{annotationId:string;revision:number;sourceVersionId:string}[];
      annotationSnapshots:MaterialAnnotation[];
      includedIds:string[];deferred:{id:string;reason:string}[];
      attachments:{annotationId:string;name:string;blobId:string;sha256:string}[];
    }
    export interface MaterialReviewState {
      annotations:MaterialAnnotation[];promptDrafts:MaterialPromptDraft[];
    }

sourceId 标识逻辑资料，versionId 由 Host 生成并固定一次快照；pageId 在版本内唯一，页码只作显示。新版本不覆盖原字节。没有原件的旧摘录仍可读，不能伪装真实分页。

- [ ] **Step 2a：固定旧版本与批注历史的保存规则。** 任务materials按sourceId+versionId保留不可变source快照，更新资料增加记录，不替换被旧批注/提示词引用的版本。页面标签以这个二元组为键；显示“资料名·版本”用于区分同份资料的新旧版。提示词生成时在同一事务保存annotationSnapshots，内容是所选批注当时的完整目标、意见、证据和revision；之后编辑/删除/重新定位当前批注不改变它。basedOn用于变化提示，回原处使用annotationSnapshots而非最新annotations。避免为每次勾选创建全套历史；仅提示词版本与删除撤销保留所需快照。

MaterialBlob是前后端共享的附件引用，只含id/hash/bytes；真实storageRef仅存Host的materialUploads注册记录（包含已完成的verified记录），原件、转换页、证据都在此登记。客户端读取只传id和owner，Host先确认该id出现在所属资料/批注或历史快照中，再从注册表反查；绝不接受客户端上传任意storageRef。

- [ ] **Step 3：先写失败测试。**

    import test from 'node:test';
    import assert from 'node:assert/strict';
    import { toolsForSource } from '../../dsh-plugin/forward-step-dsh/core/material-review.js';
    test('扫描页只开放区域工具', () => {
      assert.deepEqual(toolsForSource({capabilities:{text:false,region:true,ink:true}}),
        ['point','rect','ellipse','arrow','page','document','ink']);
    });
    test('重排正文没有区域平面', () => {
      assert.deepEqual(toolsForSource({capabilities:{text:true,region:false,ink:false}}),
        ['text','document']);
    });

- [ ] **Step 4：运行 node --test tests/dsh-plugin/test_material_review.mjs，确认缺失模块/导出；增加以下完整函数后再跑，预期通过。**

    export function toolsForSource(source) {
      const {text,region,ink}=source.capabilities;
      return [...(text?['text']:[]),
        ...(region?['point','rect','ellipse','arrow','page']:[]),
        'document',...(region&&ink?['ink']:[])];
    }

- [ ] **Step 5：构建 host，验证旧任务缺少新字段仍可读取；只暂存本任务文件并提交 feat: 定义资料版本与批注能力。**

### Task 7：原件持久化、校验读取和上传恢复

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/host-service.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/types.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/client/material-files.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/tasks.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/knowledge.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/vendor/core/knowledge-schema.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/schema.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/backup.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/backup-archive.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/store.js
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/backup-archive.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/writing-material-host.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/writing-material-files.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/knowledge.test.mjs

- [ ] **Step 1：新增下列 Remote 协议。** 按现有分块上传实现，输出遵循现有 RemoteResult；禁止客户端任意提交 storageRef/磁盘路径。知识库资料的 materialSources?: MaterialSource[] 保存在现有知识条目中，normalizeKnowledgeEntry 必须显式保留经过验证的字段，不能被规范化删掉；普通编辑不得覆盖历史版本。

    export type MaterialOwner =
      | {kind:'task';projectId:string;taskId:string;conversationId:string;taskRevision:number}
      | {kind:'knowledge';entryId:string;expectedRevision:number};
    export interface BeginMaterialUpload {
      owner:MaterialOwner;name:string;mimeType:string;size:number;eventId:string;
      purpose:{kind:'original';sourceId?:string}
        | {kind:'evidence';sourceId:string;versionId:string;annotationId:string;annotationRevision:number};
    }
    export interface MaterialUploadChunk {
      uploadId:string;index:number;dataBase64:string;
    }
    export interface MaterialReadRequest {
      owner:MaterialOwner;sourceId:string;versionId:string;offset:number;
      target:{kind:'original'|'rendition'}|{kind:'page';pageId:string}
        |{kind:'evidence';blobId:string};
    }

协议表（全部拟新增）：

| 方法 | 输入 | 成功返回 |
| --- | --- | --- |
| beginMaterialUpload | BeginMaterialUpload | uploadId, chunkBytes |
| appendMaterialChunk | MaterialUploadChunk | nextChunk, bytes |
| commitMaterialUpload | {uploadId:string} | {kind:'original',source:MaterialSource,revision:number} 或 {kind:'evidence',blob:MaterialBlob,revision:number} |
| cancelMaterialUpload | {uploadId:string} | cancelled:boolean |
| readMaterialChunk | MaterialReadRequest | dataBase64, nextOffset, done, sha256, totalBytes |

owner=task 校验当前项目/会话/任务，写入还校验 taskRevision；owner=knowledge 校验当前插件存储的条目及 expectedRevision。读取按所属记录反查附件，不信任客户端附件引用。已失效 owner 的上传在提交时拒绝。

- [ ] **Step 1a：同一入口覆盖区域截图。** original省略sourceId表示新资料，提供sourceId表示为已存在且有权限的资料另存版本；Host生成新versionId。evidence必须引用已保存source/version，上传文件须为PNG/JPEG并校验魔数、像素尺寸和字节限制。annotationId可属于当前未保存草稿，先登记证据，再由保存批注事务绑定；证据不能跨owner借用。重复commit按eventId返回同一结果；删除上传会话后也能查提交收据，不能仅靠临时Map实现幂等。page/rendition由受控渲染器生成并登记，不能通过original上传伪造转换完成。

- [ ] **Step 2：扩展现有 fake attachments 用例并先运行。** 复用测试文件中的存储夹具，新增输入/结果如下；失败必须指向缺少新入口或新行为。

| 用例 | 必须断言 |
| --- | --- |
| 中文PNG名，分块提交后重开 store | 字节、长度、SHA256 完全一致 |
| 同 eventId 的 commit 重试 | 只生成一个版本 |
| 乱序分块、非法 base64、超量 | invalid_input，未产生可用 source |
| 附件返回错 hash / 读回失败 | 不显示已保存；记录待恢复状态 |
| 开始上传后任务归属改变 | 不写入另一个任务 |
| cancel两次、卸载时上传中 | 临时文件释放，已保存资料保留 |
| 知识条目改标题后重读 | materialSources 与旧版本均仍在 |

命令：node --test tests/dsh-plugin/writing-material-host.test.mjs tests/dsh-plugin/writing-material-files.test.mjs tests/dsh-plugin/knowledge.test.mjs。

- [ ] **Step 3：沿用 host-service.ts 已有社媒附件 begin/append/commit/cancel 的机制。** 保留48KiB分块、互斥、序号检查、超量拒绝、dispose等待；换成上表 owner 校验。原件保持当前20MiB/个、40MiB/批次限制；不冒用社媒 taskId/resultId。核心已验证的附件调用是：

    const sha256=createHash('sha256').update(bytes).digest('hex');
    const storageRef=await this.attachments.saveFileStream({
      data:Readable.from([bytes]),name:descriptor.id
    });
    if(storageRef.attachmentId!=='sha256:'+sha256||storageRef.bytes!==bytes.length)
      throw Object.assign(new Error('资料存储摘要不匹配'),{code:'attachment_mismatch'});
    const readHash=createHash('sha256');
    let readBytes=0;
    for await(const chunk of this.attachments.readFileStream(storageRef)){
      readHash.update(chunk);readBytes+=chunk.byteLength;
    }
    if(readBytes!==bytes.length||readHash.digest('hex')!==sha256)
      throw Object.assign(new Error('资料读回校验失败'),{code:'attachment_mismatch'});

bytes 来自已完成并验长的临时上传文件，descriptor.id 来自提交时的待恢复记录。沿用“登记 pending-recovery→保存→读回→提交 verified”的顺序；source 仅在全部完成后可用。现有 store 顶层拟新增 materialUploads 注册表，默认空数组；内容为 id/eventId/owner/name/mimeType/size/sha256/storageRef/status，owner 明确关联资料所属记录。不得把临时文件路径写进备份；上传中的未提交字节只在当前临时目录，提交中的持久化恢复记录才进入注册表。初次写入时即扩展 schema 和 JSON 备份，任务22再验证完整附件归档与恢复；不加入第二套数据库。

- [ ] **Step 4：前端先保存原件再解析摘录。** 原件成功而解析失败时分开显示；读取校验全部字节后创建 Blob URL，切资料取消旧读取并释放 URL。数据写入继续走现有 expectedRevision/eventId/activeStorageWrites，保存失败不得清空输入。
- [ ] **Step 4a：补区域截图闭环。** 当前已验证的原页canvas或图片→按原始平面target裁剪（留必要上下文，附可区分的批注编号）→Blob预览→evidence上传→保存批注→下载/恢复后再次核对hash。文字批注优先保留原文；视觉问题用户确认requiresVisual才要求图。截图采用未旋转的规范页坐标，缩放/旋转只影响显示，不能截到工具栏或另一页。canvas被跨源污染、页图缺失或截图失败时显示缺图并保留意见，禁止生成空白图冒充证据。为单条区域批注设置10MiB/1200万像素上限；超出由用户确认缩小后重试，不能静默降采样改变证据。需要显示整页时仍遵循原附件25MiB上限。
- [ ] **Step 4b：上传一旦触及新字段，同任务补最小备份恢复测试。** 修改core/backup-archive.js、core/backup.js及backup-archive.test.mjs，先验证一个原件＋一个证据图导出/导入可读，再交付此任务；任务22扩大为全量回归，不把新数据可备份推迟到产品末尾。
- [ ] **Step 5：build:host→generate-typert→build:client，运行上述测试加 typert.test.mjs；提交 feat: 保存资料原件并提供校验读取。**

### Task 8：真实图片/PDF、多标签和查看状态

**Files:**
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/material-viewer.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/client/workspace-view.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/workspace-shell.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/tsdown.config.mjs
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/package.json
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/test_workspace_view.mjs
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/docs/superpowers/acceptance/2026-11-10-real-viewer.md

- [ ] **Step 1：追加关闭标签测试并确认失败。** 给现有 test_workspace_view.mjs 增加 closeSource 导入：

    test('关闭标签只改变打开列表，最后关闭回对话',()=>{
      const state={mode:'split',sourceId:'b',openSourceIds:['a','b','c'],
        positions:{a:{pageIndex:2,zoom:2}}};
      const next=closeSource(state,'b');
      assert.equal(next.sourceId,'c');
      assert.equal(next.positions.a.zoom,2);
      assert.equal(closeSource({...state,openSourceIds:['b']},'b').mode,'conversation');
    });

- [ ] **Step 2：新增完整状态函数。**

    export function closeSource(state,id){
      const old=state.openSourceIds.indexOf(id);
      const ids=state.openSourceIds.filter(value=>value!==id);
      const sourceId=state.sourceId===id
        ?(ids[Math.min(Math.max(old,0),ids.length-1)]??''):state.sourceId;
      return {...state,openSourceIds:ids,sourceId,mode:ids.length?state.mode:'conversation'};
    }

ViewState新增openSourceIds与positions，但这里的sourceId键是标签键，定义为JSON.stringify([sourceId,versionId])；positions[tagKey]存实际sourceId/versionId/pageIndex/zoom/rotation/scrollTop/scrollLeft。同资料v1和v2可以同时打开且互不覆盖。单标签旧草稿首次读时结合当前材料版本转换，无法确认版本则保留草稿并要求选择资料，不能自动选最新。closeSource仅关闭视图，不删除materials或清除其他标签位置。

- [ ] **Step 3：实现单一 MaterialViewer。** props 固定为 source、bytes、position、onPosition、onTarget。source 使用任务6类型；bytes:Uint8Array；position 为上述六字段；onPosition接收完整新position；onTarget接收MaterialTarget。图片读取 naturalWidth/naturalHeight；PDF使用当前包的viewport与对应文字层，文字版本和页必须一致。页面内只读原内容，叠加SVG，不以摘录伪造分页。
- [ ] **Step 4：锁定 PDF worker 及宿主资源路径。** 读取本地 pdfjs-dist 发布入口和现有渲染方式，实际加载测试后把入口、版本、代码及CSP结果写进 real-viewer.md。Host渲染路径若已可用则优先复用。新增 worker 产物须加入 package.json files；不直接复制主分支代码到当前6.4.299。
- [ ] **Step 5：处理大文件与竞争。** 当前页及邻页按需渲染；取消旧renderTask、释放document与Blob URL；迟到的旧页结果按source/version/page核对后丢弃。工具栏翻页、缩放、旋转必须更新任务草稿，拖双栏宽度也保存；所有按钮有中文可访问名称。
- [ ] **Step 6：真样本检查。** 图片/文字PDF/扫描PDF各检查200%缩放、90度旋转、长页滚动、标签切换、A/C及重载；没文字层只开区域工具。构建后运行 test_workspace_view.mjs、client.test.mjs、package.test.mjs。提交 feat: 接入真实图片与PDF查看器。

### Task 9：HTML、网站与 Office 能力关口

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/material-viewer.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/host-service.ts
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/material-rendering.js
- Create/Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/test_material_rendering.mjs
- Reuse: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/ppt-html-import.js
- Reuse: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/ppt-html-export.js
- Reuse: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/pptx-import.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/docs/superpowers/acceptance/2026-11-10-material-capabilities.md
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/ppt-html-export.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/writing-material-parser.test.mjs

- [ ] **Step 1：核对现有真实能力，运行原格式测试作为基线。**

    rg -n 'export.*(importPptHtmlPresentation|importPptxPresentation)|parse5|pdfjs' dsh-plugin/forward-step-dsh/core
    node --test tests/dsh-plugin/ppt-html-export.test.mjs tests/dsh-plugin/writing-material-parser.test.mjs

- [ ] **Step 2：HTML 生成可控静态阅读树。** 复用parse5；允许正文元素p/div/span/h1-h6/ul/ol/li/blockquote/pre/code/table/thead/tbody/tr/th/td/br/strong/em/a/img，属性只保留经验证的href/src/alt/colspan/rowspan。剥离script/form/iframe/object/embed、事件属性、原style与活动URL；用React文本节点构造，不直接执行原HTML。链接只允许http/https并另开原站；图片先取得并保存为附件，否则显示缺图。
- [ ] **Step 3：文字视图与固定快照分开。** 文本范围基于只读DOM；区域基于已保存的固定页图，两者不混用坐标。网站保存url/捕获时间/versionId，刷新另存版本。抓取沿用已配置能力并通过原请求确认；受限页面保留导入HTML/截图入口，不报成功。
- [ ] **Step 4：验证Office转换后再决定工具。** 使用含表格/中文字体/图片的真实PPTX和DOCX。先验证现有解析/转换；若需新增转换程序，单独记录候选、许可、系统依赖、输入输出与通过条件，并按用户约定确认安装。PPT完整页图开区域/笔迹；Word重排开文字；只有精确映射文字层才开原页划选。转换来源、程序版本、原件和输出hash都留存。未通过真实Office样本，此分支不能标完成。
- [ ] **Step 4a：将格式探索变成有出口的实施关口。** 新建core/material-rendering.js、tests/dsh-plugin/test_material_rendering.mjs，在host-service.ts调用受控转换。优先使用已有可用转换；否则评估本机LibreOffice将PPTX/DOCX转PDF，再交给既有PDF.js渲染，Office到PDF的实际调用参数以该安装版本帮助输出核实。每份文档独立临时目录与进程配置，禁止覆盖原件；120秒超时、取消、退出非0、缺输出、缺字体、密码文件各有状态。转换完成必须打开PDF并验页数/关键文字/图片，而非只看退出码。若当前机器缺转换器，该任务状态是“受阻，待补转换能力”，其余任务可继续；不能取消Office验收项。报告必须写明已选路线、真实命令和样本证据，不能只写“评估以后再说”。
- [ ] **Step 4b：HTML文字视图与网站外观分别验收。** parse5白名单阅读树是文字视图，不能声称保留原站布局。网站外观使用宿主现有受控浏览器固定视口截图，保存URL、捕获时间、视口、截图及资源缺失信息；HTML文件可在禁止脚本、表单和网络访问的隔离呈现环境生成页图。涉及认证页面只用已获准的宿主访问，不外传账号。若宿主没有截图能力，仍允许用户导入真实截图作固定平面，但“自动网站捕获”验收保持未通过。长页分块保留各块pageId和纵向范围；文字锚点与截图无可靠映射时分视图标注，不能假装能自动跳到截图中的同一句。
- [ ] **Step 5：补格式测试和浏览器证据。** HTML样本含重复句、onclick、javascript链接、长表格、缺图；预期正文可读、无活动脚本/背景外连、文字选择不偏移。验证原站返回、重新捕获和旧版本批注。运行上述格式测试及样本；提交 feat: 接入网页快照与Office资料呈现。

### Task 10：文本锚点和固定平面坐标

**Files:**
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/client/material-target.js
- Create/Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/test_material_target.mjs
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/material-viewer.ts

- [ ] **Step 1：先写失败测试。**

    import test from 'node:test';
    import assert from 'node:assert/strict';
    import {locateText,toPlanePoint} from '../../dsh-plugin/forward-step-dsh/client/material-target.js';
    test('重复原文不默认选第一项',()=>{
      assert.equal(locateText('甲相同乙相同丙',{exact:'相同'}).status,'needs-confirmation');
      assert.deepEqual(locateText('甲相同乙相同丙',{exact:'相同',prefix:'乙',suffix:'丙'}),
        {status:'valid',start:4,end:6});
    });
    test('90度双倍缩放回到原始坐标',()=>{
      assert.deepEqual(toPlanePoint({x:60,y:60},{left:10,top:20,width:100,height:200},
        {width:100,height:50},90),{x:20,y:25});
    });

- [ ] **Step 2：运行 node --test tests/dsh-plugin/test_material_target.mjs，确认缺失导出；写入以下函数后重跑。**

    export function locateText(text,target,{sameVersion=false}={}){
      const {exact,prefix='',suffix=''}=target;
      if(!exact)return {status:'missing'};
      const matchesContext=i=>(!prefix||text.slice(Math.max(0,i-prefix.length),i)===prefix)
        &&(!suffix||text.slice(i+exact.length,i+exact.length+suffix.length)===suffix);
      if(sameVersion&&Number.isInteger(target.start)&&target.start>=0
        &&target.end===target.start+exact.length
        &&text.slice(target.start,target.end)===exact&&matchesContext(target.start))
        return {status:'valid',start:target.start,end:target.end};
      const matches=[];
      for(let i=text.indexOf(exact);i!==-1;i=text.indexOf(exact,i+1)){
        if(prefix&&text.slice(Math.max(0,i-prefix.length),i)!==prefix)continue;
        if(suffix&&text.slice(i+exact.length,i+exact.length+suffix.length)!==suffix)continue;
        matches.push(i);
      }
      if(matches.length!==1)return {status:matches.length?'needs-confirmation':'missing'};
      return {status:'valid',start:matches[0],end:matches[0]+exact.length};
    }
    export function toPlanePoint(point,rect,plane,rotation=0){
      if(![0,90,180,270].includes(rotation)||rect.width<=0||rect.height<=0)
        throw new TypeError('页面变换无效');
      const u=(point.x-rect.left)/rect.width,v=(point.y-rect.top)/rect.height;
      const [x,y]=rotation===90?[v,1-u]:rotation===180?[1-u,1-v]:rotation===270?[1-v,u]:[u,v];
      return {x:Math.max(0,Math.min(1,x))*plane.width,y:Math.max(0,Math.min(1,y))*plane.height};
    }

- [ ] **Step 3：Selection/Range保存exact、前后各32字、start/end。** Text节点索引只覆盖正文；不跨资料、工具栏或未渲染页。PDF断字规范化需同时用于选区与索引，保留原文。旧位置先核对原文和上下文，重复候选要求用户确认。DOM路径仅辅助。
- [ ] **Step 3a：同版本位置与改版重新查找分别测试。** 同一固定版本、相同句子重复两次，保存的位置且exact/前后文均匹配时可精确返回第二处；换版后禁止信任旧offset，多个候选要求选择，即使唯一匹配也先展示改版确认。文字显示通过Range.getClientRects得到每行矩形，逐矩形画高亮/下划线/删除线，不能用跨行总包围框盖住中间其他文字。这些矩形只作当前渲染缓存，改变字体/宽度后由文字锚点重建；原文字位置不改成屏幕像素。
- [ ] **Step 4：指针统一经toPlanePoint映射。** rect传旋转后内容平面的矩形，不能包含工具栏/留白；SVG viewBox用原始宽高。窗口缩放只改变显示；资料改版区域坐标不自动复用。
- [ ] **Step 5：运行上述测试并真浏览器核对缩放、旋转和重复句；提交 feat: 为批注建立文本与固定页面定位。** 借鉴Hypothesis的多种定位及原文核对；实际移植时保留固定提交和许可。

### Task 11：多类型独立批注

**Files:**
- Create: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/annotation-panel.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/material-viewer.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/material-review.js
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/test_material_review.mjs

- [ ] **Step 1：追加测试及replaceAnnotation导入，先运行确认失败。**

    test('编辑只影响选定ID，第二次批注追加',()=>{
      const old=[{id:'a',comment:'甲'},{id:'b',comment:'乙'}];
      const next=replaceAnnotation(old,{id:'a',comment:'新甲'});
      assert.equal(next[1].comment,'乙');
      assert.equal(old[0].comment,'甲');
      assert.equal(replaceAnnotation(next,{id:'c',comment:'丙'}).length,3);
    });

- [ ] **Step 2：实现最小更新函数。**

    export function replaceAnnotation(items,annotation){
      return items.some(item=>item.id===annotation.id)
        ?items.map(item=>item.id===annotation.id?annotation:item)
        :[...items,annotation];
    }

- [ ] **Step 3：工具栏按能力展开。** point用单点；rect/ellipse/arrow用起止点；ink保存连续points；page/document无需圈选。pointerdown捕获、move追加、up完成、cancel保留草稿；短误触不创建空线。使用SVG circle/rect/ellipse/line/polyline；箭头markerEnd。高亮/下划线/删除线是decoration，修改意图由intent单独表达。
- [ ] **Step 3a：绑定必做工具验收，防止只完成意见弹框。** 分别绘制并保存点便签、框、椭圆、箭头、连续笔迹，重载后逐项还原；文字跨三行的三种装饰均能选择正确正文；整页/整份不要求先画区域。pointerdown后先存文字Selection的Range副本，再打开浮层，避免点按钮令选区消失。单次笔迹最多5000点，pointermove仅在原图距离达到1像素时采样；达到上限结束当前笔迹并提示继续新笔，保留已有笔迹。Ctrl+Z在正文输入中仍撤销文字，只在批注画布/列表聚焦时撤销批注。
- [ ] **Step 4：批注独立编辑、选择与撤销。** 输入写父级草稿，Escape/翻页/模式切换只收起；“丢弃”才清除。保存按ID增修且revision递增。每次删除保留删除前记录与版本；撤销时只还原该条，遇后续变更先显示冲突。首次整理默认选择一次，后续切换不重置用户勾选。
- [ ] **Step 5：列表与图层联动。** 点击条目回对应版本/页/区域；图层点击打开该ID；工具不可用说明原因。键盘可以操作全部列表动作、保存与选择，画笔保留点/整页意见入口。
- [ ] **Step 6：运行 test_material_review.mjs，真实浏览器画两条、改一条、删一条、撤销并重载；提交 feat: 支持独立批注与按需工具。**

### Task 12：保存失败、旧点位和资料改版

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/material-review.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/tasks.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/host-service.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/annotation-panel.ts
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/tasks.test.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/test_material_review.mjs

- [ ] **Step 1：追加测试及markSourceChanged导入，运行确认失败。**

    test('改版保留旧证据并要求重新确认',()=>{
      const old={id:'a',sourceId:'s',sourceVersionId:'v1',anchorStatus:'valid'};
      const next=markSourceChanged([old],'s','v2');
      assert.equal(next[0].anchorStatus,'needs-confirmation');
      assert.equal(next[0].sourceVersionId,'v1');
      assert.equal(old.anchorStatus,'valid');
    });

- [ ] **Step 2：实现版本变化标记。**

    export function markSourceChanged(items,sourceId,versionId){
      return items.map(item=>item.sourceId===sourceId&&item.sourceVersionId!==versionId
        ?{...item,anchorStatus:'needs-confirmation'}:item);
    }

- [ ] **Step 3：统一从updateTask保存完整methodState合并。** Host校验ID唯一、source/version存在、pageId属于固定版本、坐标有限且不越界、类型对应点数、revision递增；附图只能引用所属记录内已验证附件。taskRevision冲突显示差异并保留输入，不自动覆盖。内部保留writing.packSnapshot/ppt等其他状态。
- [ ] **Step 4：分别显示保存状态、处理状态、定位状态。** pending/saving/error/saved是请求结果；open/resolved由用户操作；valid/needs-confirmation/missing由核对决定。复制/生成不自动resolved。草稿保存失败仍留在内存；重试用原eventId；迟到结果按任务ID隔离。
- [ ] **Step 5：旧PptVisualFeedback只读适配。** 同一旧ID映射固定legacy ID，保留原字段；有确切原页图尺寸与版本才迁移坐标，否则显示contentSnapshot并待确认。确认后才写新记录；二次加载不重复迁移。重新定位存新修订并保留旧证据。
- [ ] **Step 6：在原tasks夹具覆盖：无新字段的旧任务、重复迁移、保存失败重试、两次同revision只成功一个、其他methodState不丢。** 运行 node --test tests/dsh-plugin/tasks.test.mjs tests/dsh-plugin/test_material_review.mjs tests/dsh-plugin/ppt.test.mjs；提交 feat: 保存批注并处理旧数据与改版。

### Task 13：所选批注生成修改提示词

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/material-review.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/annotation-panel.ts
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/test_material_review.mjs

- [ ] **Step 1：追加prepareReview导入和测试，先确认失败。**

    test('未选意见不进入正文，圈画无意图需补充',()=>{
      const base={sourceId:'s',sourceVersionId:'v1',anchorStatus:'valid',requiresVisual:false};
      const result=prepareReview([
        {...base,id:'a',selected:true,comment:'缩短标题'},
        {...base,id:'b',selected:false,comment:'删除图片'},
        {...base,id:'c',selected:true,comment:''}
      ]);
      assert.deepEqual(result.ready.map(x=>x.id),['a']);
      assert.deepEqual(result.questions.map(x=>x.id),['c']);
    });

- [ ] **Step 2：实现筛选。**

    export function prepareReview(items){
      const ready=[],questions=[];
      for(const item of items.filter(value=>value.selected)){
        const region=['point','rect','ellipse','arrow','ink'].includes(item.target?.kind);
        const needsEvidence=item.requiresVisual||(region&&!item.locationDescription?.trim());
        const reason=item.anchorStatus!=='valid'?'确认定位':!item.comment.trim()?'补充修改意图':
          needsEvidence&&!item.evidence?'补充区域图片':'';
        if(reason)questions.push({id:item.id,reason});else ready.push(item);
      }
      return {ready,questions};
    }

- [ ] **Step 3：逐个决定点使用任务3的QuestionDialog。** 没选择→留在列表；圈画没意图→就近问修改什么；定位失效→旧证据/新内容对照；缺图→截图预览并附带；同区域“删除/保留”冲突→保留一条/合并/暂缓。不可可靠判断的语义冲突并列核对，不按列表顺序决定。
- [ ] **Step 3a：将冲突和本轮决定写成确定性协议。** 只比较同sourceId/sourceVersionId；整份与其任何目标冲突，整页与同页目标冲突；文字按[start,end)相交；区域按原始平面包围框相交。文字与区域没有可靠空间映射时标“需核对”，不凭坐标推断。只有intent=delete与preserve同时出现才自动列明确冲突；其他意见保持并列。决定保存为 `{pair:[id,revision,id,revision],action:'keep-left'|'keep-right'|'merge'|'defer',mergedComment?:string}`，改变意见或来源后原决定失效。合并不能覆盖原批注，生成一条带两条来源引用的本轮意见。忽略/暂缓项均进入提示词deferred清单，不自动取消用户长期勾选。
- [ ] **Step 4：分组生成正文。** 新增下列函数，输入为已完成冲突/容量确认的items；来源不足必须阻止，不静默丢项。

    export function buildModificationPrompt({sources,items,preserveItems=[],attachments=[]}){
      if(!items.length)throw new TypeError('请选择至少一条有效批注');
      for(const item of items){
        if(!sources.some(s=>s.sourceId===item.sourceId&&s.versionId===item.sourceVersionId))
          throw new TypeError('批注来源版本缺失');
        if(item.requiresVisual&&!item.evidence)throw new TypeError('缺少视觉证据');
      }
      const lines=['请根据以下批注修改资料。'];
      for(const source of sources){
        const selected=items.filter(x=>x.sourceId===source.sourceId&&x.sourceVersionId===source.versionId);
        if(!selected.length)continue;
        lines.push('资料：'+source.title+'；版本：'+source.versionId);
        for(const item of selected){
          const t=item.target;
          const pageIndex=source.pages.findIndex(page=>page.pageId===t.pageId);
          if(t.pageId&&pageIndex<0)throw new TypeError('批注页缺失');
          const pageLabel=pageIndex>=0?'第'+(pageIndex+1)+'页':'';
          const region=['point','rect','ellipse','arrow','ink'].includes(t.kind);
          const location=t.kind==='text'?pageLabel+'原文“'+t.exact+'”':t.kind==='document'?'整份资料':pageLabel;
          lines.push('['+item.id+'] '+location+'：'+item.comment.trim());
          if(region){
            if(!item.evidence&&(item.requiresVisual||!item.locationDescription?.trim()))
              throw new TypeError('区域批注需要定位图片');
            if(item.evidence)lines.push('区域位置见附件：'+item.evidence.id+'.png，标记['+item.id+']');
            else lines.push('位置：'+item.locationDescription.trim());
          }
        }
      }
      if(preserveItems.length)lines.push('保留要求：'+preserveItems.join('；'));
      const names=[...new Set([...attachments,...items.filter(item=>item.evidence)
        .map(item=>item.evidence.id+'.png')])];
      lines.push('附件：'+(names.length?names.join('、')+'（使用时请一并附上）':'无'));
      lines.push('验收：逐项对应批注说明修改结果；未完成项说明原因；保留未要求改动的内容。');
      return lines.join('\n');
    }

区域条目补用户可读位置描述/附件名；完整坐标留在批注证据中。超出已知模型容量或本地明确字符上限时按资料/页分批，展示本轮与后续ID及原因，允许调整；不静默截断。

- [ ] **Step 4a：补容量策略和附件一致性。** 纯复制每批完整正文上限12000个UTF-16字符（包含来源、保留项与附件清单），在页面明确该指标不是模型token。按资料/页稳定排序，逐项试放；单条超过上限时要求用户拆分意见，不截断。模型发送使用现有上下文预算预览再检查，未知容量保留人工确认。ready、questions、deferred的ID并集必须等于本轮选择，且互不重叠；提交前复核每项revision。附件清单从实际evidence派生，输出annotationId、下载文件名、blobId与sha256；渲染器生成证据统一PNG，所以正文和下载均用blobId.png，并显示资料名/页序/批注编号作为可读标签。用户导入的JPEG先经验证并转PNG再登记evidence，不能只改扩展名。区域默认requiresVisual=true；用户确认不需视觉的点便签必须另存locationDescription后才允许纯文字交付。整页/整份的视觉问题也照此检查。

- [ ] **Step 4b：新增可运行的生成验收测试。** 在test_material_review.mjs导入buildModificationPrompt并追加：

    test('提示词显示真实页序且未选意见不混入',()=>{
      const source={sourceId:'s',versionId:'v1',title:'简报',pages:[{pageId:'p1'},{pageId:'p2'}]};
      const item={id:'a',sourceId:'s',sourceVersionId:'v1',target:{kind:'page',pageId:'p2'},comment:'缩短标题'};
      const text=buildModificationPrompt({sources:[source],items:[item]});
      assert.ok(text.includes('第2页'));
      assert.ok(text.includes('缩短标题'));
      assert.ok(!text.includes('第p2页'));
      assert.throws(()=>buildModificationPrompt({sources:[],items:[item]}),/来源版本缺失/);
    });

此外直接在入口测试selected=false确实在prepareReview被过滤；builder只收经过准备的ready，不从整个列表自行猜选择。

- [ ] **Step 5：追加生成结果断言并运行。** 两份来源、三条选择、一条取消，只输出所选；缺来源拒绝；全部暂缓不生成空版本；缺图/冲突/超量均需决定；复制/收藏不改处理状态。命令 node --test tests/dsh-plugin/test_material_review.mjs；提交 feat: 从所选批注生成可追溯修改提示词。

### Task 14：保护手改稿、版本和附件交付

**Files:**
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/core/material-review.js
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/index.ts
- Modify: D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh/src/client/annotation-panel.ts
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/test_material_review.mjs
- Test: D:/VScode/项目/提示词工具/.dsh-workspace/tests/dsh-plugin/versions.test.mjs

- [ ] **Step 1：追加appendReviewDraft导入和测试，确认失败。**

    test('再次整理不覆盖旧手改稿',()=>{
      const old=[{id:'v1',text:'用户修改',edited:true}];
      const next=appendReviewDraft(old,{id:'v2',text:'新整理',parentId:'v1'});
      assert.equal(next[0].text,'用户修改');
      assert.equal(next[1].parentId,'v1');
      assert.equal(old.length,1);
    });

- [ ] **Step 2：增加不可覆盖的追加函数。**

    export function appendReviewDraft(drafts,next){
      if(drafts.some(item=>item.id===next.id))throw new TypeError('提示词版本重复');
      return [...drafts,next];
    }

- [ ] **Step 3：每次整理存MaterialPromptDraft及basedOn。** 手改保存新版本并记录parentId，未保存输入进任务草稿。来源/批注revision改变时标“依据已变化”，可继续编辑旧稿或生成新版；effect不得自动重算覆盖textarea。
- [ ] **Step 3a：补旧稿来源失效的回归。** 生成v1→把原批注目标挪到另一页→删除当前批注→打开v1，仍显示当时原文、页和证据图；采用新资料版本不会让v1指向新版。任务materialReview中的promptDrafts历史只追加，Host拒绝通过updateTask改写旧annotationSnapshots；手改正文的新版本继承旧snapshot，重新整理的新版本取新的snapshot。
- [ ] **Step 4：复制/收藏取实际编辑正文。** 附件列名称、下载和缺失状态；复制文本不宣称图片一并复制。收藏携带实际任务/提示词版本，状态默认未验证。发送模型时复用现有请求预览与确认，图片走已存在admitPromptContent；默认动作仍是生成提示词。
- [ ] **Step 5：返回原处解析basedOn→批注→固定来源版本。** 来源缺失显示版本和恢复入口，不打开同名新文件替代；跨任务迟到生成不更新当前任务。中断保留已保存内容和本次选择。
- [ ] **Step 6：构建并运行 node --test tests/dsh-plugin/test_material_review.mjs tests/dsh-plugin/versions.test.mjs tests/dsh-plugin/client.test.mjs。** 真浏览器验证“手改→改意见→再次整理→旧稿仍在→复制新版→回原处”；提交 feat: 保留手改提示词与整理版本。

阶段B完成标准：每种宣称支持的真实格式都有“打开→两条批注→取消一条→切视图→重载恢复→仅生成所选意见”的证据。只通过纯函数单测或示例草图不能代替真实验收。

