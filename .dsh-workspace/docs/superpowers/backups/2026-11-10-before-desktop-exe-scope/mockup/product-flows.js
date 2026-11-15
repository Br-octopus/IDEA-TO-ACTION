// 设计演示：仅在当前页面内维护流程草稿和完成记录，不连接真实资料与服务。
const flowDefinitions = {
  task: {
    route: 'workbench', title: '从想法开始一个任务', entry: '新任务', output: '一个有明确目标、保留要求和下一步动作的任务。', next: '进入任务对话',
    notes: ['缺少影响方向的信息才询问。', '任务开始后仍可补材料、改目标。', '返回或切换板块保留本页草稿。'],
    steps: [
      { title: '描述想法', note: '先说你想完成什么，不需要先配置一堆选项。', fields: [{key:'goal',label:'你想完成什么？',type:'textarea',required:true,sample:'准备一份面向管理层的产品方案汇报，先梳理内容和修改提示词。'},{key:'entry',label:'从哪里开始',options:['梳理想法','优化现有提示词','诊断 AI 结果'],sample:'梳理想法'}] },
      { title: '确认关键点', note: '这是系统遇到关键信息不足时的单问题示例。已明确的信息不重复询问。', fields: [{key:'audience',label:'这次主要讲给谁听？',options:['管理层 / 决策者','执行团队','外部客户','暂不确定'],sample:'管理层 / 决策者'},{key:'preserve',label:'有什么必须保留或遵守的？',type:'textarea',sample:'不编造数据，保留已有证据，先做内容大纲。'}] },
      { title: '任务确认', review:true, note:'检查工作台的理解。修改任何字段都可以返回，确认后进入任务。', confirm:'创建任务并继续' },
      { title: '开始推进', done:true }
    ]
  },
  review: {
    route:'workbench',title:'把批注意见整理成修改提示词',entry:'批注整理流程',output:'可编辑、可复制、能回到资料核对的修改提示词及附件清单。',next:'打开提示词',
    notes:['批注与文件版本、原文或区域关联。','失效定位先重新确认，不能自动套到新版。','只把选中的意见带入提示词。'],
    steps:[
      {title:'选择批注',note:'实际产品从批注列表带入选择。这里可编辑批注及其对应位置。',fields:[{key:'source',label:'资料与版本',required:true,sample:'产品落地页 / 固定快照 V1'},{key:'target',label:'批注针对的原文或区域',type:'textarea',required:true,sample:'首页介绍：“系统就会自动完成所有工作”。'},{key:'comment',label:'希望怎样修改？',type:'textarea',required:true,sample:'去掉夸大能力的描述，准确说明需求梳理与修改提示词生成。'}]},
      {title:'检查依据',note:'视觉意见需要对应截图，纯文本复制不等于已经附上图片。',fields:[{key:'validity',label:'目标定位状态',options:['已确认，对应当前版本','资料已更新，需要重新定位'],sample:'已确认，对应当前版本'},{key:'attachment',label:'需要附上的材料',type:'textarea',sample:'原页面快照；视觉区域意见需附区域截图。'},{key:'constraints',label:'需要保留什么？',type:'textarea',sample:'保留原页面的信息结构与未批注内容。'}]},
      {title:'确认本轮',review:true,confirm:'整理修改提示词',note:'按目标、修改要求、保留项和附件整理。待重新定位的意见会阻止这一轮确认。'},
      {title:'修改提示词',done:true}
    ]
  },
  history:{route:'workbench',title:'继续历史任务',entry:'任务历史与归档',output:'回到所选任务的版本与进度，不覆盖已有草稿。',next:'继续任务',notes:['归档只是整理任务列表。','恢复时保留原有资料和批注。','当前输入先保留，再切换任务。'],steps:[
    {title:'找到任务',fields:[{key:'task',label:'示例任务',options:['产品方案汇报','文章结构优化','已归档：访谈提纲'],sample:'产品方案汇报'},{key:'version',label:'继续的位置',options:['最近一次进度','上一次提示词版本'],sample:'最近一次进度'}]},
    {title:'确认恢复',review:true,confirm:'打开所选任务',note:'展示任务关联资料、批注与历史版本；恢复归档任务不会重新运行模型。'},
    {title:'继续推进',done:true}]},
  material:{route:'library',title:'添加并核对资料',entry:'添加资料',output:'带来源、用途和验证状态的资料条目，可继续批注或加入任务。',next:'回到资料库',notes:['选择来源后只显示必要输入。','导入状态与内容可信度分开。','查看结果后再决定是否加入任务。'],steps:[
    {title:'选择来源',fields:[{key:'sourceType',label:'资料来自哪里？',options:['网页链接','本地文件','粘贴文本'],sample:'网页链接'}]},
    {title:'填写资料',note:'本地文件在此草图中只选择名称，不读取或上传文件内容。',fields:[{key:'name',label:'资料名称',required:true,sample:'产品落地页参考'},{key:'url',label:'网页链接',type:'url',required:true,when:['sourceType','网页链接'],sample:'https://example.com/product'},{key:'file',label:'选择本地文件',type:'file',required:true,when:['sourceType','本地文件']},{key:'body',label:'资料正文',type:'textarea',required:true,when:['sourceType','粘贴文本'],sample:'整理任务、资料与批注，并生成可追溯的修改要求。'},{key:'purpose',label:'材料用途',options:['内容来源','风格参考','两者都有'],sample:'内容来源'}]},
    {title:'核对结果',review:true,confirm:'保存到资料库',note:'正式产品先显示解析结果、来源和重复提示。这里不执行网页抓取，新增资料默认待核实。'},
    {title:'资料已加入',done:true}]},
  attach:{route:'library',title:'将资料加入任务',entry:'关联任务',output:'任务获得用户选定的资料引用，资料库原条目保留。',next:'打开任务资料',notes:['关联不等于立即发送给模型。','每轮发送前仍可检查引用。','重复关联应提示已有条目。'],steps:[
    {title:'选择内容',fields:[{key:'name',label:'资料名称',required:true,sample:'产品落地页参考'},{key:'excerpt',label:'本轮采用的内容',type:'textarea',required:true,sample:'页面价值主张与流程说明，其他内容暂不引用。'}]},
    {title:'选择任务',fields:[{key:'task',label:'加入到',options:['产品方案汇报','文章结构优化'],sample:'产品方案汇报'},{key:'purpose',label:'引用用途',options:['内容来源','风格参考','对比材料'],sample:'对比材料'}]},
    {title:'确认引用',review:true,confirm:'加入所选任务',note:'只建立所选范围的引用，模型请求另行确认。'},
    {title:'引用已关联',done:true}]},
  prompt:{route:'prompts',title:'收藏或修订提示词',entry:'新建 / 修订提示词',output:'保留来源与验证状态的提示词版本，可复制或用于任务。',next:'查看收藏',notes:['编辑已有提示词形成新版本。','保存不代表实际效果验证通过。','版本对比用于检查改动。'],steps:[
    {title:'编辑正文',fields:[{key:'name',label:'标题',required:true,sample:'根据批注修改产品页面'},{key:'body',label:'提示词正文',type:'textarea',required:true,sample:'请依据所附资料和批注逐项修改，说明对应原文或区域，保留未批注部分，不编造事实。'}]},
    {title:'用途与来源',fields:[{key:'domain',label:'适用领域',options:['通用','写作','PPT','研究'],sample:'通用'},{key:'origin',label:'来源说明',sample:'产品方案任务 / 用户修改版本'},{key:'change',label:'这次主要改了什么？',type:'textarea',sample:'增加批注定位和保留要求。'}]},
    {title:'保存前检查',review:true,confirm:'保存新版本',note:'初次创建为 V1；修订时保留旧版。实际验证状态从使用反馈产生。'},
    {title:'版本已保留',done:true}]},
  reuse:{route:'prompts',title:'将提示词用于当前任务',entry:'复用提示词',output:'带当前任务背景的可编辑提示词，不自动执行。',next:'打开任务提示词',notes:['检查变量与任务是否匹配。','来源提示词原版本不被改写。','外发仍经过发送预览。'],steps:[
    {title:'选定提示词',fields:[{key:'name',label:'提示词名称',required:true,sample:'将模糊想法整理为执行步骤'},{key:'task',label:'目标任务',options:['产品方案汇报','文章结构优化'],sample:'产品方案汇报'}]},
    {title:'补充背景',fields:[{key:'context',label:'本次任务背景',type:'textarea',required:true,sample:'面向管理层说明产品价值与资源需求，当前只有初步想法。'},{key:'constraints',label:'本次约束',sample:'每次只问一个关键问题，不编造数据。'}]},
    {title:'检查发送内容',review:true,confirm:'生成任务草稿',note:'先得到可编辑草稿，使用或复制不会改变收藏中的版本。'},
    {title:'任务草稿',done:true}]},
  case:{route:'prompts',title:'记录一次使用结果',entry:'记录案例',output:'能区分有效、失败和未验证的案例，保留证据与适用边界。',next:'查看案例',notes:['成功需要实际使用依据。','无证据时保留待验证状态。','案例可以来自成功或失败。'],steps:[
    {title:'关联任务',fields:[{key:'task',label:'任务名称',required:true,sample:'产品方案汇报'},{key:'version',label:'采用的提示词版本',required:true,sample:'决策导向大纲 / V3'}]},
    {title:'结果与证据',fields:[{key:'verdict',label:'结果判断',options:['待验证','有效','未达到目标'],sample:'待验证'},{key:'evidence',label:'实际结果与反馈',type:'textarea',sample:'汇报结构变清楚，但还未得到真实听众反馈。'},{key:'boundary',label:'适用条件或局限',type:'textarea',sample:'适用于需要明确资源决策的汇报，不能替代业务证据。'}]},
    {title:'检查记录',review:true,confirm:'保存案例',note:'没有结果依据时不能标记为有效。'},
    {title:'案例已记录',done:true}]},
  method:{route:'prompts',title:'整理自建方法卡',entry:'新建方法卡',output:'含适用场景和明确步骤的方法卡，供任务引用。',next:'查看方法卡',notes:['方法步骤与提示词正文分别管理。','使用时检查领域适配。','修订形成新版本。'],steps:[
    {title:'定义方法',fields:[{key:'name',label:'方法名称',required:true,sample:'先确认决策，再组织材料'},{key:'scope',label:'适用场景',required:true,sample:'产品汇报、资源提案与方案讨论'}]},
    {title:'整理步骤',fields:[{key:'steps',label:'执行步骤，每行一项',type:'textarea',required:true,sample:'明确听众需要做的决定\n区分事实和假设\n选择支持决定的证据\n整理内容顺序'},{key:'limit',label:'使用边界',sample:'已有明确目标的任务不重复澄清。'}]},
    {title:'预览方法卡',review:true,confirm:'保存方法卡'},
    {title:'方法已保留',done:true}]},
  article:{route:'writing',title:'开始一篇文章',entry:'新建文章',output:'具有目标、读者与保留要求的文章工作区。',next:'进入稿件',notes:['有初稿时可以直接诊断。','没有初稿时先整理写作目标。','保存历史由用户明确开启。'],steps:[
    {title:'文章起点',fields:[{key:'name',label:'文章名称',required:true,sample:'把想法写清楚'},{key:'draft',label:'已有初稿或想法',type:'textarea',required:true,sample:'我想写一篇文章，解释怎样把零散想法整理成清晰表达。'}]},
    {title:'目标与读者',fields:[{key:'reader',label:'写给谁看？',required:true,sample:'想改善日常表达的普通读者'},{key:'goal',label:'读者看完后得到什么？',required:true,sample:'学会从一个具体问题开始组织文章。'},{key:'preserve',label:'需要保留的风格或内容',type:'textarea',sample:'第一人称、个人经历、自然表达。'},{key:'history',label:'是否保存文章历史',options:['仅当前会话，暂不开启历史保存','开启本篇历史保存'],sample:'仅当前会话，暂不开启历史保存'}]},
    {title:'确认开始',review:true,confirm:'创建文章工作区'},
    {title:'文章工作区',done:true}]},
  round:{route:'writing',title:'推进下一轮修改',entry:'开始修改轮次',output:'保留上轮稿件与反馈的修改提示词，下一轮结果另存。',next:'查看写作轮次',notes:['原稿和旧轮次保留。','目标、反馈与专业包版本随轮次记录。','生成提示词不等于稿件已改完。'],steps:[
    {title:'选择稿件',fields:[{key:'name',label:'文章',required:true,sample:'把想法写清楚'},{key:'version',label:'作为修改依据的稿件',options:['当前稿件 / 第 3 轮','上一轮稿件 / 第 2 轮'],sample:'当前稿件 / 第 3 轮'}]},
    {title:'本轮重点',fields:[{key:'focus',label:'最想改善哪一方面？',options:['结构与逻辑','表达与风格','事实与证据'],sample:'结构与逻辑'},{key:'feedback',label:'具体修改意见',type:'textarea',required:true,sample:'开头信息太多，先从一个具体问题切入。'},{key:'preserve',label:'保留要求',type:'textarea',sample:'保留个人经历和第一人称，暂不改变核心观点。'}]},
    {title:'核对轮次',review:true,confirm:'创建修改轮次',note:'正式产品显示本轮材料和专业包版本，确认后固定版本。'},
    {title:'本轮修改指令',done:true}]},
  academic:{route:'research',title:'建立学术证据流程',entry:'学术研究流程',output:'带出处、筛选理由和待验证标记的证据清单。',next:'查看文献证据',notes:['先明确研究问题，再导入与筛选。','纳入、排除都记录理由。','没有核实的出处不能变成可靠结论。'],steps:[
    {title:'研究问题',fields:[{key:'name',label:'项目名称',required:true,sample:'反馈与批注定位研究'},{key:'question',label:'这次需要回答的问题',type:'textarea',required:true,sample:'资料更新后，怎样保持用户批注与原内容的对应关系？'}]},
    {title:'题录与来源',note:'这里展示导入交互，正式产品需要实际解析 RIS / BibTeX 并报告重复或错误条目。',fields:[{key:'bibliography',label:'待导入的题录或出处',type:'textarea',required:true,sample:'示例条目：反馈定位方法研究；出处待核对。'},{key:'status',label:'导入后的初始状态',options:['待核实','已核实原始出处'],sample:'待核实'}]},
    {title:'筛选与证据',fields:[{key:'screening',label:'筛选结论',options:['待评估','拟纳入','排除'],sample:'待评估'},{key:'reason',label:'筛选理由 / 与问题的关系',type:'textarea',required:true,sample:'检查是否讨论文本引用定位与跨版本匹配。'}]},
    {title:'核对清单',review:true,confirm:'保存项目与证据记录'},
    {title:'证据工作区',done:true}]},
  social:{route:'research',title:'规划一次社媒研究',entry:'社媒研究流程',output:'确认范围后的研究计划；采集状态与结果逐项保留。',next:'查看研究任务',notes:['登录状态与配置状态分别检查。','执行前展示预算，不自动扩大范围。','失败、无结果和完成是不同状态。'],steps:[
    {title:'研究目标',fields:[{key:'topic',label:'想了解什么？',type:'textarea',required:true,sample:'用户怎样整理 AI 生成内容的修改意见？'}]},
    {title:'平台与范围',fields:[{key:'platform',label:'示例平台',options:['小红书','B 站','微博','知乎'],sample:'小红书'},{key:'query',label:'查询关键词',required:true,sample:'AI 修改意见 批注'},{key:'budget',label:'结果上限',type:'number',required:true,sample:'15'}]},
    {title:'能力与预算',review:true,confirm:'确认计划（演示）',note:'此处实际执行前必须读取平台登录与采集能力。本页仅演示，未验证登录，也不会发出请求。'},
    {title:'计划就绪',done:true}]},
  memory:{route:'memory',title:'修正一条记忆与偏好',entry:'偏好编辑流程',output:'作用范围明确、可追溯、可撤销的偏好版本。',next:'查看偏好',notes:['系统建议与用户确认分别显示。','全局范围影响后续多个任务。','旧任务保留当时使用的依据。'],steps:[
    {title:'查看来源',fields:[{key:'origin',label:'偏好来源',required:true,sample:'用户在文章结构优化任务中明确提出'},{key:'content',label:'偏好内容',type:'textarea',required:true,sample:'先给结论，再补必要细节。'}]},
    {title:'确定作用范围',fields:[{key:'scope',label:'应用到哪里？',options:['当前任务','当前领域','全局'],sample:'当前任务'},{key:'enabled',label:'生效状态',options:['启用','暂时停用'],sample:'启用'}]},
    {title:'确认修改',review:true,confirm:'保存偏好版本',note:'保存只影响后续使用，历史记录保留；可从记录查看本次变更。'},
    {title:'偏好已更新',done:true}]},
  connection:{route:'settings',title:'配置并检查服务连接',entry:'连接设置流程',output:'分别显示已配置、未验证、已验证或失败的连接状态。',next:'回到连接设置',notes:['凭证由宿主管理，不在草图中输入。','保存地址不是连接成功。','测试失败保留配置供修正。'],steps:[
    {title:'服务配置',fields:[{key:'service',label:'服务类型',options:['搜索服务','辅助写作服务'],sample:'搜索服务'},{key:'url',label:'服务地址',type:'url',required:true,sample:'https://example.com/search'}]},
    {title:'检查范围',fields:[{key:'test',label:'保存后的操作',options:['只保存配置，稍后验证','保存后测试连通性'],sample:'只保存配置，稍后验证'}],note:'正式测试只发送固定测试请求，不附上任务正文。'},
    {title:'确认配置',review:true,confirm:'保存配置示例',note:'草图不会访问服务；结果明确保留“未验证”。'},
    {title:'已配置，未验证',done:true}]},
  backup:{route:'settings',title:'导出备份',entry:'备份流程',output:'范围明确的备份及导出结果记录。',next:'回到备份管理',notes:['导出前展示内容范围。','不打包 API 密钥和登录凭证。','失败时明确结果，不假称文件已下载。'],steps:[
    {title:'选择范围',fields:[{key:'scope',label:'备份内容',options:['完整工作空间','仅资料库'],sample:'完整工作空间'},{key:'attachments',label:'附件',options:['包含所选附件','只保存引用和索引'],sample:'包含所选附件'},{key:'preferences',label:'偏好',options:['包含非敏感偏好','不包含偏好'],sample:'包含非敏感偏好'}]},
    {title:'导出前预览',review:true,confirm:'生成备份（演示）',note:'正式产品展示实际项目、条目、附件数量与体积；演示不伪造真实统计或下载。'},
    {title:'备份结果',done:true}]},
  restore:{route:'settings',title:'从备份恢复工作空间',entry:'恢复流程',output:'经范围检查、冲突处理和确认后的恢复结果及收据。',next:'回到恢复记录',notes:['确认前不写入数据。','冲突先处理，不能静默覆盖。','真正写入前创建恢复前备份。'],steps:[
    {title:'选择备份',fields:[{key:'name',label:'用于预览的备份名称',required:true,sample:'workspace-backup.zip'},{key:'mode',label:'恢复方式',options:['合并到当前空间','替换当前空间'],sample:'合并到当前空间'}]},
    {title:'检查内容',fields:[{key:'scope',label:'恢复范围',options:['任务、资料与批注','仅资料库'],sample:'任务、资料与批注'},{key:'conflict',label:'冲突状态演示',options:['没有冲突','存在重复 ID，需先处理'],sample:'没有冲突'}],note:'正式产品根据解析结果显示数量、来源版本、附件和冲突。'},
    {title:'确认影响',review:true,requireConsent:true,consentLabel:'我已检查恢复方式、影响范围，并知晓需要恢复前备份。',confirm:'确认恢复（演示）'},
    {title:'恢复收据',done:true}]},
  migration:{route:'settings',title:'迁移旧工具的数据',entry:'迁移流程',output:'类别明确的迁移结果、未导入项和收据。',next:'回到迁移管理',notes:['识别旧格式及可迁移类别。','未知字段列出，不悄悄丢弃。','凭证与登录信息不随资料迁移。'],steps:[
    {title:'选择来源',fields:[{key:'name',label:'旧备份名称',required:true,sample:'forward-step-export.zip'},{key:'format',label:'备份格式',options:['完整 ZIP','JSON'],sample:'完整 ZIP'}]},
    {title:'检查兼容性',fields:[{key:'categories',label:'选择迁移类别',options:['任务、提示词、资料与附件','任务与提示词','仅资料库'],sample:'任务、提示词、资料与附件'},{key:'compatibility',label:'兼容性状态演示',options:['所选类别兼容','存在不支持的字段，需核对'],sample:'所选类别兼容'}]},
    {title:'确认导入',review:true,requireConsent:true,consentLabel:'我已核对迁移类别、兼容性与附件关联。',confirm:'确认迁移（演示）'},
    {title:'迁移结果',done:true}]}
};
Object.assign(flowDefinitions, {
  pack:{route:'writing',title:'选择本轮专业包',entry:'专业包选择',output:'本轮采用的专业包版本及保留要求。',next:'返回文章',notes:['先预览规则，再决定是否采用。','旧轮次继续保留原版本。','更换只影响尚未开始的新轮次。'],steps:[
    {title:'选择适用规则',fields:[{key:'name',label:'文章名称',required:true,sample:'把想法写清楚'},{key:'pack',label:'专业包与版本',options:['结构与表达 / V1','事实与证据 / V1'],sample:'结构与表达 / V1'}]},
    {title:'检查适用范围',note:'结构与表达包检查开头、段落顺序和重复表达；事实与证据包检查出处、事实与推测的区分。',fields:[{key:'preserve',label:'本轮不能被规则覆盖的要求',type:'textarea',required:true,sample:'保留第一人称与个人经历，不把口语全部改成书面语。'}]},
    {title:'确认本轮版本',review:true,confirm:'采用本轮规则'},
    {title:'专业包选择已记录',done:true}]},
  evidence:{route:'research',title:'核对一条文献证据',entry:'文献证据核对',output:'原始出处、摘录、筛选理由与核实状态完整的证据卡。',next:'返回文献证据',notes:['摘录与自己的判断分开。','未核实内容保留待核实标记。','排除证据仍保留理由。'],steps:[
    {title:'出处与摘录',fields:[{key:'source',label:'文献出处或 DOI',required:true,sample:'演示文献 / 出处待补充核实'},{key:'quote',label:'原文摘录与页码',type:'textarea',required:true,sample:'第 3 页：讨论文字引用与页面位置的对应关系（演示摘录）。'}]},
    {title:'判断与筛选',fields:[{key:'status',label:'核实状态',options:['待核实','已对照原文'],sample:'待核实'},{key:'decision',label:'筛选决定',options:['待评估','纳入','排除'],sample:'待评估'},{key:'reason',label:'判断理由',type:'textarea',required:true,sample:'需检查其定位机制是否适用于内容更新后的页面。'}]},
    {title:'核对证据卡',review:true,confirm:'保存证据记录'},
    {title:'证据卡已记录',done:true}]},
  submission:{route:'research',title:'整理投稿要求',entry:'投稿要求清单',output:'有来源与检查状态的投稿清单，供写作任务引用。',next:'返回研究项目',notes:['期刊要求需要核实来源和日期。','未核实要求不标记为已满足。','清单不自动提交稿件。'],steps:[
    {title:'确定目标与来源',fields:[{key:'journal',label:'目标期刊或会议',required:true,sample:'目标期刊（待确定）'},{key:'source',label:'要求来源与查阅日期',required:true,sample:'作者指南 / 待查阅确认'}]},
    {title:'逐项列出要求',fields:[{key:'requirements',label:'篇幅、格式、材料要求',type:'textarea',required:true,sample:'确认正文篇幅上限\n检查参考文献格式\n准备图表与补充材料'},{key:'status',label:'当前检查状态',options:['待核实要求','已核实要求，稿件待检查','稿件已逐项检查'],sample:'待核实要求'}]},
    {title:'检查投稿清单',review:true,confirm:'保存要求清单'},
    {title:'投稿清单已记录',done:true}]},
  reviewer:{route:'research',title:'组织审稿回应',entry:'审稿回应流程',output:'逐条关联意见、回复草稿与修改位置的回应记录。',next:'返回研究项目',notes:['保留审稿人原文。','计划修改和实际完成分开记录。','标记完成需要具体修改位置。'],steps:[
    {title:'保留原始意见',fields:[{key:'comment',label:'审稿意见原文与编号',type:'textarea',required:true,sample:'意见 2：请说明研究方法选择的依据。'}]},
    {title:'回复与修改依据',fields:[{key:'response',label:'回复草稿',type:'textarea',required:true,sample:'计划补充方法选择依据，并说明与其他方法的比较。'},{key:'status',label:'修改进展',options:['计划修改','已完成修改','解释不修改理由'],sample:'计划修改'},{key:'location',label:'实际修改位置或不修改理由',type:'textarea',sample:'尚未修改，待确认补充内容。'}]},
    {title:'检查回应记录',review:true,confirm:'保存回应草稿'},
    {title:'回应草稿已记录',done:true}]}
});
const flowDrafts = new Map();
const flowReceipts = [];
let activeFlow = null;
let lastFlowFocus = null;
const basePageRender = render;
// shortcut: 仅保留当前演示页的查看状态；接入真实任务时改用已有任务草稿存储。
const retainedView = { frame:null, readers:new Map() };
let lastFrameRequest = frameState;
function rememberView() {
  if($('generated-text'))promptDraft=$('generated-text').value;
  const frame=$('work-frame'), d=frame?.contentDocument;
  if(d?.readyState==='complete'&&d.getElementById('idea')){
    const w=frame.contentWindow;
    retainedView.frame={state:w.eval('state'),page:w.eval('pageIndex'),tab:w.eval('activeTab'),
      idea:d.getElementById('idea').value,follow:d.getElementById('follow-text').value,
      user:d.getElementById('user-message').textContent,audience:d.getElementById('audience-summary').textContent,
      hidden:d.getElementById('preview').hidden,expanded:d.getElementById('preview').classList.contains('expanded'),
      conversation:d.getElementById('stage').classList.contains('focus-conversation'),
      scroll:d.getElementById('preview-body').scrollTop};
  }
  const shownKind=document.querySelector('.reader-top [data-kind].active')?.dataset.kind;
  if(shownKind)retainedView.readers.set(shownKind,{known:[...document.querySelectorAll('.include-note')].map(x=>x.value),selected:[...document.querySelectorAll('.include-note:checked')].map(x=>x.value),scroll:document.querySelector('.reader-canvas').scrollTop});
}
function originalRender() {
  rememberView();
  if(frameState===lastFrameRequest&&retainedView.frame)frameState=retainedView.frame.state;
  lastFrameRequest=frameState;
  basePageRender();
  const reader=retainedView.readers.get(readerKind);
  if(reader&&document.querySelector('.reader-canvas')){
    document.querySelectorAll('.include-note').forEach(x=>{if(reader.known.includes(x.value))x.checked=reader.selected.includes(x.value)});
    document.querySelector('.reader-canvas').scrollTop=reader.scroll;
  }
  const frame=$('work-frame');
  if(!frame)return;
  const setup=frame.onload;
  frame.onload=()=>{
    setup();
    const d=frame.contentDocument,w=frame.contentWindow,saved=retainedView.frame;
    const focusButton=d.createElement('button');focusButton.id='focus-conversation';focusButton.type='button';
    const style=d.createElement('style');style.textContent='.stage.focus-conversation .preview{display:none!important}.stage.focus-conversation .conversation{display:flex!important;flex:1;width:100%;max-width:none}#focus-conversation{align-self:flex-start;margin-bottom:16px;border:1px solid #e1e6df;background:white;padding:7px 12px;border-radius:7px;font-size:12px}';d.head.append(style);
    d.getElementById('thread').prepend(focusButton);
    const updateFocus=()=>{const active=d.getElementById('stage').classList.contains('focus-conversation');focusButton.textContent=active?'返回双栏':'专注对话';focusButton.setAttribute('aria-pressed',String(active))};
    focusButton.onclick=()=>{d.getElementById('stage').classList.toggle('focus-conversation');updateFocus()};
    // 从资料卡再次打开内容时恢复可见的查看器。
    ['open-artifact','show-prompt','expand-preview'].forEach(id=>d.getElementById(id).addEventListener('click',()=>{d.getElementById('stage').classList.remove('focus-conversation');updateFocus()}));
    if(saved){
      d.getElementById('idea').value=saved.idea;d.getElementById('follow-text').value=saved.follow;
      d.getElementById('user-message').textContent=saved.user;d.getElementById('audience-summary').textContent=saved.audience;
      w.eval('setPage('+saved.page+')');
      if(saved.state===frameState){w.eval('tab('+JSON.stringify(saved.tab)+');preview('+!saved.hidden+')');d.getElementById('preview').classList.toggle('expanded',saved.expanded);d.getElementById('expand-preview').setAttribute('aria-label',saved.expanded?'还原预览大小':'放大预览');d.getElementById('stage').classList.toggle('focus-conversation',saved.conversation)}
      d.getElementById('preview-body').scrollTop=saved.scroll;
    }
    updateFocus();
  };
}
const flowIdsForRoute = r => Object.keys(flowDefinitions).filter(key => flowDefinitions[key].route === r);
const fieldsFor = (step, values) => (step.fields || []).filter(f => !f.when || values[f.when[0]] === f.when[1]);
const flowLabels = def => Object.fromEntries(def.steps.flatMap(s => (s.fields || []).map(f => [f.key, f.label])));

function flowField(field, values) {
  const id = 'flow-' + field.key;
  const value = values[field.key] || '';
  let input;
  if (field.options) input = '<select id="'+id+'" name="'+field.key+'">'+field.options.map(x=>'<option'+(x===value?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select>';
  else if(field.type==='textarea')input='<textarea id="'+id+'" name="'+field.key+'" '+(field.required?'required':'')+'>'+esc(value)+'</textarea>';
  else if(field.type==='file')input='<input id="'+id+'" name="'+field.key+'" type="file">'+(value?'<small>本页已选择：'+esc(value)+'（只保留名称）</small>':'');
  else input='<input id="'+id+'" name="'+field.key+'" type="'+(field.type||'text')+'" value="'+esc(value)+'" '+(field.required?'required':'')+(field.type==='number'?' min="1" max="100" step="1"':'')+'>';
  return '<label class="flow-field" for="'+id+'"><span>'+esc(field.label)+(field.required?' · 必填':'')+'</span>'+input+'</label>';
}

function saveFlowFields() {
  if(!activeFlow)return;
  const data=flowDrafts.get(activeFlow), step=flowDefinitions[activeFlow].steps[data.index];
  fieldsFor(step,data.values).forEach(field=>{const el=$('flow-'+field.key);if(!el)return;if(field.type==='file'){if(el.files?.[0])data.values[field.key]=el.files[0].name;}else data.values[field.key]=el.value;});
}

function openFlow(id, initial={}) {
  if(!flowDefinitions[id])return;
  saveFlowFields();
  if($('modal').open)$('modal').close();
  lastFlowFocus=document.activeElement;
  activeFlow=id;const def=flowDefinitions[id];route=def.route;viewState='normal';previewFocus=false;$('shell').classList.remove('menu-compact');
  if(!flowDrafts.has(id)){const values={};def.steps.forEach(step=>(step.fields||[]).forEach(field=>{if(field.options)values[field.key]=field.options[0]}));flowDrafts.set(id,{index:0,values,simulation:'normal',error:''})}
  Object.assign(flowDrafts.get(id).values,initial);
  originalRender();renderFlow();$('nav').classList.remove('open');
}

function summary(def, values) {
  const labels=flowLabels(def);
  const allowed=new Set(def.steps.flatMap(step=>fieldsFor(step,values).map(f=>f.key)));
  return '<dl class="flow-summary">'+Object.entries(values).filter(([k,v])=>allowed.has(k)&&v).map(([k,v])=>'<dt>'+esc(labels[k]||k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl>';
}

function resultText(id, v) {
  if(id==='review')return '请根据以下批注修改资料。\n\n资料及版本：'+v.source+'\n定位依据：'+v.target+'\n修改要求：'+v.comment+'\n\n保留要求：'+(v.constraints||'保留未批注内容原意。')+'\n所需附件：'+(v.attachment||'请附上原资料。')+'\n交付：逐项对应批注说明修改结果，缺少依据时列出待补充项。';
  if(id==='round')return '请对《'+v.name+'》进行下一轮修改。\n依据版本：'+v.version+'\n本轮重点：'+v.focus+'\n具体意见：'+v.feedback+'\n保留要求：'+(v.preserve||'保留核心观点。')+'\n请说明逐项修改及未解决的问题。';
  if(id==='reuse')return '请使用“'+v.name+'”的方法处理当前任务。\n\n任务：'+v.task+'\n背景：'+v.context+'\n约束：'+(v.constraints||'对不确定事实明确标注。')+'\n先检查关键信息缺口，再给出下一步及验收方式。';
  if(id==='connection')return '服务：'+v.service+'\n配置：已在本页演示中保留\n连接状态：未验证\n本草图没有访问该地址，也没有修改真实服务配置。';
  if(id==='backup')return '导出范围：'+v.scope+'\n附件选择：'+v.attachments+'\n偏好选择：'+v.preferences+'\n演示结束：未生成或下载真实备份。';
  if(id==='social')return '计划主题：'+v.topic+'\n平台：'+v.platform+'\n查询：'+v.query+'\n结果上限：'+v.budget+'\n状态：演示计划待实际能力检查，未登录、未采集。';
  if(id==='restore'||id==='migration')return '本页流程已完成，确认内容已形成演示记录。\n原工作空间没有发生写入。\n正式执行的结果页需逐项列出成功、失败、未处理项和恢复前备份。';
  return flowDefinitions[id].output+'\n\n本次内容仅保留在当前设计页面；刷新后重置。';
}

function validateFlow(data, step) {
  if(step.review&&activeFlow==='reviewer'&&data.values.status!=='计划修改'&&!data.values.location?.trim())return '请补充实际修改位置或不修改理由。';
  for(const f of fieldsFor(step,data.values)){const value=(data.values[f.key]||'').trim();if(f.required&&!value)return '请填写“'+f.label+'”。';if(f.type==='url'&&value){try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol))return '请填写 HTTP 或 HTTPS 地址。'}catch{return '请填写有效的网址。'}}if(f.type==='number'&&(!Number.isInteger(Number(value))||Number(value)<1||Number(value)>100))return '结果上限请填写 1–100 的整数。';}
  if(step.review){if(activeFlow==='review'&&data.values.validity!=='已确认，对应当前版本')return '资料已经更新，请先返回“检查依据”重新确认目标位置。';if(activeFlow==='restore'&&data.values.conflict!=='没有冲突')return '存在重复 ID，请先返回“检查内容”处理冲突。';if(activeFlow==='migration'&&data.values.compatibility!=='所选类别兼容')return '存在不支持的字段，请先核对兼容性。';if(activeFlow==='case'&&data.values.verdict==='有效'&&!data.values.evidence?.trim())return '标记为有效需要实际结果与反馈，请返回补充证据。';if(step.requireConsent&&!$('flow-consent')?.checked)return '请先核对影响范围并勾选确认。';}
  return '';
}

function renderFlow() {
  const def=flowDefinitions[activeFlow],data=flowDrafts.get(activeFlow),step=def.steps[data.index];
  $('route-name').textContent=routes[route][0]+' / '+def.title;
  let body='';
  if(data.simulation==='loading')body='<div role="status"><h2>正在处理这一阶段…</h2><p>演示等待状态；输入、资料选择和当前步骤仍保留。</p><div class="progress-line"><span></span></div><div class="actions"><button data-flow-cancel-operation>取消本次处理</button></div></div>';
  else if(data.simulation==='error')body='<div role="alert"><h2>这一阶段没有完成</h2><p>演示：连接中断或解析失败。尚未确认的改动不提交，输入完整保留。</p><div class="actions"><button class="primary" data-flow-retry>重试当前步骤</button><button data-flow-cancel-operation>返回编辑</button></div></div>';
  else if(step.done)body='<h2>'+step.title+'</h2><div class="flow-result">流程演示已完成 · 本页记录可回看，未操作真实数据</div>'+summary(def,data.values)+'<pre class="flow-preview" id="flow-result-text">'+esc(resultText(activeFlow,data.values))+'</pre><div class="actions">'+(['review','round','reuse'].includes(activeFlow)?'<button class="primary" data-flow-copy>复制这份示例提示词</button>':'')+'<button data-flow-destination>'+def.next+'</button><button data-flow-restart>再试一次</button></div>';
  else body='<h2>'+step.title+'</h2>'+(step.note?'<p>'+step.note+'</p>':'')+(step.review?summary(def,data.values):fieldsFor(step,data.values).map(f=>flowField(f,data.values)).join(''))+(step.requireConsent?'<label class="flow-check"><input type="checkbox" id="flow-consent" '+(data.consent?'checked':'')+'><span>'+step.consentLabel+'</span></label>':'')+'<div class="flow-actions">'+(data.index?'<button type="button" data-flow-prev>上一步</button>':'<button type="button" data-flow-exit>取消并保留草稿</button>')+'<button class="primary" type="submit">'+(step.confirm||'下一步')+'</button></div>';
  $('page').innerHTML='<div class="flow-page" tabindex="-1"><button class="flow-back" data-flow-exit>← 返回'+routes[route][0]+'，保留草稿</button><h1>'+def.title+'</h1><p class="flow-intro">'+def.output+'</p><ol class="flow-steps">'+def.steps.map((s,i)=>'<li class="'+(i===data.index?'current':i<data.index?'done':'')+'" '+(i===data.index?'aria-current="step"':'')+'><b>'+(i+1)+'</b>'+s.title+'</li>').join('')+'</ol><div class="flow-grid"><form class="flow-form" id="workflow-form" novalidate>'+(data.error?'<div class="flow-message" role="alert">'+esc(data.error)+'</div>':'')+body+'</form><aside class="flow-side"><div><h3>这个流程要保证什么</h3><ul>'+def.notes.map(n=>'<li>'+n+'</li>').join('')+'</ul><button class="flow-sample" data-flow-sample>填入一组示例，体验流程</button></div><div class="flow-outcome"><h3>完成后得到</h3><p>'+def.output+'</p><p>入口：'+routes[def.route][0]+' → '+def.entry+'</p></div></aside></div><div class="flow-status-sim"><label for="flow-simulation">查看这一阶段的状态</label><select id="flow-simulation"><option value="normal">正常处理</option><option value="loading">正在处理</option><option value="error">失败与恢复</option></select><span>演示控件，不属于正式产品表单</span></div><p class="flow-screen-caption">设计讨论稿：可填写、返回、取消、确认和回看本页记录；不发送模型请求、不抓取网站、不写入真实工作空间。</p></div>';
  $('flow-simulation').value=data.simulation;
  $('page').scrollTop=0;
  $('workflow-form').onsubmit=event=>{event.preventDefault();saveFlowFields();data.consent=$('flow-consent')?.checked||false;data.error=validateFlow(data,step);if(data.error){renderFlow();return}data.index++;if(def.steps[data.index]?.done)flowReceipts.push({id:activeFlow,title:def.title,values:{...data.values},time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})});renderFlow();};
  $('flow-simulation').onchange=e=>{saveFlowFields();data.simulation=e.target.value;data.error='';renderFlow()};
}

render=function(){
  if(activeFlow&&flowDefinitions[activeFlow].route!==route){saveFlowFields();activeFlow=null}
  originalRender();
  if(activeFlow){viewState='normal';$('state-select').value='normal';renderFlow();return}
  if(viewState==='normal'){
    const launch=document.createElement('details');launch.className='flow-launcher';launch.setAttribute('aria-label','本板块功能流程');
    launch.innerHTML='<summary>查看本板块操作流程 <small>设计评审工具</small></summary><div>'+flowIdsForRoute(route).map(id=>'<button data-flow-open="'+id+'">'+flowDefinitions[id].entry+'</button>').join('')+'<button class="quiet flow-records" data-flow-records>本页操作记录 '+flowReceipts.filter(r=>flowDefinitions[r.id].route===route).length+'</button></div>';
    $('page').prepend(launch);
  }
};

function closeFlow() {saveFlowFields();activeFlow=null;render();lastFlowFocus?.isConnected&&lastFlowFocus.focus();}
function goFlowDestination(id) {
  const values=flowDrafts.get(id).values;activeFlow=null;viewState='normal';
  if(['task','history'].includes(id)){route='workbench';workMode='chat';frameState='work';render();const frame=$('work-frame'),previous=frame.onload;frame.onload=()=>{previous();const d=frame.contentDocument;if(values.goal)d.getElementById('user-message').textContent=values.goal;};return}
  if(['review','reuse'].includes(id)){route='workbench';workMode='prompt';promptDraft=resultText(id,values)}
  else if(id==='attach'){route='workbench';workMode='reader'}
  else if(id==='case'){route='prompts';subtabs.prompts='案例'}
  else if(id==='method'){route='prompts';subtabs.prompts='方法卡'}
  else if(id==='prompt'){route='prompts';subtabs.prompts='提示词'}
  else if(id==='social'){route='research';subtabs.research='社媒'}
  else if(id==='academic'){route='research';subtabs.research='学术'}
  else if(id==='connection'){route='settings';subtabs.settings='模型与连接'}
  else if(['backup','restore'].includes(id)){route='settings';subtabs.settings='备份与恢复'}
  else if(id==='migration'){route='settings';subtabs.settings='迁移'}
  render();toast('已返回板块；刚才填写的内容可在“本页操作记录”回看。');
}

const modalFlows={import:'material','file-import':'material','url-import':'material','text-import':'material','prompt-edit':'prompt','method-edit':'method','article-new':'article','writing-round':'round',retained:'round','academic-new':'academic',bibliography:'academic','social-plan':'social',learning:'memory',connection:'connection','backup-export':'backup','backup-restore':'restore','migration-preview':'migration'};
Object.assign(modalFlows,{'pack-preview':'pack',evidence:'evidence',submission:'submission',reviewer:'reviewer'});
document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b)return;
  let handler=null;
  if(b.dataset.flowOpen)handler=()=>openFlow(b.dataset.flowOpen);
  else if(b.dataset.modal&&modalFlows[b.dataset.modal])handler=()=>openFlow(modalFlows[b.dataset.modal],b.dataset.modal==='prompt-edit'?{name:promptEntries[selectedPrompt].title,body:promptEntries[selectedPrompt].body}:{});
  else if(b.dataset.memory)handler=()=>openFlow('memory',{content:b.dataset.memory});
  else if(b.dataset.use)handler=()=>openFlow(route==='prompts'?'reuse':'attach',{name:b.dataset.use});
  else if(b.hasAttribute('data-flow-exit'))handler=closeFlow;
  else if(b.hasAttribute('data-flow-sample'))handler=()=>{const data=flowDrafts.get(activeFlow);flowDefinitions[activeFlow].steps.forEach(s=>(s.fields||[]).forEach(f=>{if(f.sample)data.values[f.key]=f.sample}));data.error='';data.simulation='normal';renderFlow()};
  else if(b.hasAttribute('data-flow-prev'))handler=()=>{saveFlowFields();const data=flowDrafts.get(activeFlow);data.index=Math.max(0,data.index-1);data.error='';data.consent=false;renderFlow()};
  else if(b.hasAttribute('data-flow-restart'))handler=()=>{const data=flowDrafts.get(activeFlow);data.index=0;data.error='';data.consent=false;renderFlow()};
  else if(b.hasAttribute('data-flow-destination'))handler=()=>goFlowDestination(activeFlow);
  else if(b.hasAttribute('data-flow-copy'))handler=async()=>{try{await navigator.clipboard.writeText(resultText(activeFlow,flowDrafts.get(activeFlow).values));toast('示例提示词已复制，请自行附上所需资料。')}catch{toast('复制失败，请选中结果正文手动复制。')}};
  else if(b.hasAttribute('data-flow-retry'))handler=()=>{const data=flowDrafts.get(activeFlow);data.simulation='normal';data.error='';renderFlow()};
  else if(b.hasAttribute('data-flow-cancel-operation'))handler=()=>{const data=flowDrafts.get(activeFlow);data.simulation='normal';data.error='处理已取消，输入和当前步骤保留。';renderFlow()};
  else if(b.hasAttribute('data-flow-records'))handler=()=>{const records=flowReceipts.filter(r=>flowDefinitions[r.id].route===route);modal('<h2>'+routes[route][0]+' · 本页操作记录</h2><p>只记录当前页面中的演示操作，刷新后清空。真实数据未改变。</p>'+(records.length?records.map(r=>'<article class="flow-record"><h3>'+esc(r.title)+' · '+r.time+'</h3>'+summary(flowDefinitions[r.id],r.values)+'</article>').join(''):'<p>还没有完成的操作。可以先选择一个流程，填写并确认。</p>')+modalEnd())};
  if(handler){event.preventDefault();event.stopImmediatePropagation();await handler()}
},true);

document.addEventListener('change',event=>{if(!activeFlow)return;if(event.target.id==='flow-consent'){flowDrafts.get(activeFlow).consent=event.target.checked;return}if(event.target.closest('#workflow-form'))saveFlowFields()});
document.addEventListener('input',event=>{if(activeFlow&&event.target.closest('#workflow-form'))saveFlowFields()});
document.querySelector('header.study strong').textContent='向前一步 · 页面与功能流程设计';
document.querySelector('header.study p').textContent='自查修订 04 · 已补状态保留与流程规则；真实资料能力待验证';
document.querySelector('header.study > p').textContent='页面布局＋功能流程 / 本地演示数据';
document.querySelector('.design-caption > span').textContent='设计自查已记录缺口；示例内容不代表真实文件与完整批注能力。';
render();
