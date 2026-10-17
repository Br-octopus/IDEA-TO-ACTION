(function (root, factory) {
  const cards = factory(
    typeof module === "object" && module.exports
      ? require("./knowledge-schema.js")
      : root.ForwardStepKnowledgeSchema,
    root
  );
  if (typeof module === "object" && module.exports) module.exports = cards;
  else root.ForwardStepMethodCards = cards;
})(typeof globalThis === "undefined" ? this : globalThis, function (knowledgeSchema, browserRoot) {
  const cards = {
    "通用计划": {
      temporary: false,
      stages: ["说清目标和限制", "查证关键步骤", "拆解行动与产出", "复盘并调整"],
      stageDetails: [
        ["说明想实现的变化、相关对象、当前情况和现实限制。", "目标摘要、关键约束和待确认项"],
        ["只查会影响路线的事实与做法，比较来源和适用前提。", "带来源的关键信息与适用边界"],
        ["按依赖关系拆成小步，为每步写出产出和完成检查。", "可编辑的步骤、产出和验收方式"],
        ["对照实际结果和成功标准，决定保留、修改或停止什么。", "复盘结论和下一步建议"]
      ],
      guidance: "先辨明目标、受影响对象、输入材料、约束和验收方式；根据任务性质选方法，不强套单一领域流程。"
    },
    "写作": {
      temporary: false,
      stages: ["明确文章目的与读者", "整理观点、事实和参考", "设计结构并检查表达", "对照目标复核并形成修改指令"],
      stageDetails: [
        ["明确文章要解决什么、发布场景和读者需要带走什么。", "文章目标、读者和成功标准"],
        ["区分作者观点、论据、事实、个人经验和待补材料。", "观点与证据清单、需核实或补充项"],
        ["检查段落逻辑、上下文、用词、句式节奏、修辞和格式。", "结构建议和具体表达问题清单"],
        ["对照目标与必须保留内容，生成交给外部 AI 的修改指令。", "可复制修改提示词与核对清单"]
      ],
      guidance: "区分观点、事实、证据和待补材料；观察用词、句式节奏、逻辑、上下文、修辞与格式。保护作者观点、事实、步骤、经验和个人语气；本工具只诊断并生成可复制的修改提示词。"
    },
    "PPT": {
      temporary: false,
      stages: ["明确演示目的与听众", "核对核心信息和证据", "规划叙事结构与页面", "检查信息层级与讲述效果"],
      stageDetails: [
        ["明确听众、演示场景、时长和希望听众理解或采取的行动。", "演示目标、受众和限制"],
        ["整理核心结论、支撑证据、来源和待确认信息。", "结论与证据清单"],
        ["建立开场、论证、转折和结尾的叙事，并分配页面职责。", "故事线和逐页目的草案"],
        ["检查每页的信息层级、可读性、证据对应和讲述节奏。", "逐页审查清单与外部制作指令"]
      ],
      guidance: "检查听众、场景、时长、核心结论、证据来源和行动诉求；逐页明确目的与信息层级，避免把文章直接拆页。本工具只提供诊断和可复制给其他 AI 的制作指令，不直接做 PPT。"
    },
    "软件开发": {
      temporary: false,
      stages: ["确认用户问题和最小范围", "研究方案并定义验收", "拆解实现与测试步骤", "复核结果、风险和发布准备"],
      stageDetails: [
        ["明确用户、实际问题、现有环境和首版明确不做的内容。", "问题陈述、范围边界和关键假设"],
        ["检查现有技术约束、候选方案、安全风险和可验证标准。", "方案取舍、验收条件和风险清单"],
        ["按依赖关系拆成可独立验证的实现、测试和集成步骤。", "任务清单、测试方案和预期结果"],
        ["核对测试证据、未解决问题、发布条件和回退方式。", "验收结论、已知风险和发布准备项"]
      ],
      guidance: "特别检查用户问题、范围、现有技术约束、数据安全、测试和发布条件；优先最小可验证方案。本工具只帮助诊断需求和生成给编码 AI 的指令，不写或执行代码。"
    },
    "产品构想": {
      temporary: false,
      stages: ["明确用户与待解决问题", "研究现有替代方案", "提出价值假设和最小验证", "依据反馈调整方向"],
      stageDetails: [
        ["明确目标用户、具体情境、痛点证据和当前替代做法。", "用户问题陈述和待验证假设"],
        ["比较用户现在如何解决问题及现有产品/服务的局限。", "替代方案对照和证据来源"],
        ["提出可被证伪的价值假设，选择成本最低的验证方式。", "验证问题、实验步骤和判断门槛"],
        ["用反馈判断假设成立程度，决定调整、继续或停止。", "验证记录和方向决策建议"]
      ],
      guidance: "检查用户和问题证据、现有替代方案、价值假设、成本与低风险验证；区分已知事实和待验证假设。"
    },
    "工作任务": {
      temporary: false,
      stages: ["明确交付物和验收人", "盘点资料、依赖与限制", "梳理步骤和沟通节点", "检查交付结果与后续事项"],
      stageDetails: [
        ["确认交付对象、接收人、期限和可验收的完成定义。", "交付说明和验收标准"],
        ["盘点已有资料、参与方、前置依赖、时间和资源限制。", "输入清单、依赖关系和风险项"],
        ["安排有先后关系的行动、责任人、检查点和沟通节点。", "行动清单和沟通安排"],
        ["按验收标准核对交付，记录遗留事项和后续负责人。", "交付检查结果和后续事项"]
      ],
      guidance: "检查交付物、负责人、截止时间、依赖方、验收口径、风险和沟通节点；不假设资源充足。"
    },
    "学习目标": {
      temporary: false,
      stages: ["盘点起点并定义能力目标", "选择资料和练习路径", "安排循序练习与反馈", "用测验或作品复核进步"],
      stageDetails: [
        ["梳理已有基础、学习动机、可投入时间和目标应用场景。", "起点评估和可观察能力目标"],
        ["按目标选择少量可靠材料，并安排由易到难的练习。", "资料依据和练习路线"],
        ["设计主动练习、反馈来源、复习节奏和卡点处理方式。", "练习计划和反馈检查点"],
        ["用测验、讲解或作品验证掌握程度并定位薄弱点。", "学习证据和下一轮补强建议"]
      ],
      guidance: "检查当前基础、可用时间、练习机会、反馈渠道和可观察的能力证据；学习步骤应包含主动练习和复盘。"
    },
    "其他": {
      temporary: true,
      stages: ["暂定目标与边界", "查证领域做法和前提", "拟定小步及检查方式", "根据证据复盘调整"],
      stageDetails: [
        ["先识别任务类型、受影响对象、目标和不可越过的边界。", "临时目标摘要和待确认项"],
        ["搜索该领域可靠方法，检查适用条件、风险和反例。", "方法来源、前提和不确定性"],
        ["选择低风险的小步，为其设定产出与停止/继续标准。", "可调整步骤和检查标准"],
        ["根据结果和新证据判断是否换用更合适的领域方法。", "方法调整理由和下一步建议"]
      ],
      guidance: "这是临时、可调整的方法骨架。先判断任务所属领域及其风险；搜索该领域可靠方法后再决定是否保留、替换或缩小步骤。"
    }
  };

  function getMethodCard(domain) {
    const aliases = { "文章写作": "写作", "内容写作": "写作", "演示文稿": "PPT", "产品/工作": "产品构想" };
    const key = aliases[domain] || domain;
    const card = cards[key] || cards["其他"];
    return { id: cards[key] ? key : "其他", temporary: card.temporary || !cards[key], stages: [...card.stages], stageDetails: card.stageDetails.map(([description, deliverable]) => ({ description, deliverable })), guidance: card.guidance };
  }

  function normalizeKnowledgeEntry(input) {
    const schema = knowledgeSchema || browserRoot.ForwardStepKnowledgeSchema;
    return schema.normalizeKnowledgeEntry(input);
  }

  function toKnowledgeEntry(card = {}, id = card.id) {
    return normalizeKnowledgeEntry({
      id,
      type: "method-card",
      title: card.title || card.name || id,
      domains: card.domains || card.domain,
      stages: card.stages,
      keywords: card.checks || card.keywords,
      summary: card.description || card.guidance,
      reusablePatterns: card.guidance,
      verificationStatus: "source-reviewed",
      sourceType: "内置方法卡"
    });
  }

  function methodCardsToKnowledgeEntries(source = cards) {
    if (Array.isArray(source)) return source.map(card => toKnowledgeEntry(card, card.id));
    return Object.entries(source || {}).map(([id, card]) => toKnowledgeEntry(card, id));
  }

  return { getMethodCard, methodCardsToKnowledgeEntries };
});
