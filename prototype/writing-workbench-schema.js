(function (root, factory) {
  const coverageApi = typeof module === "object" && module.exports
    ? require("./writing-material-coverage.js") : root.ForwardStepWritingMaterialCoverage;
  const api = factory(coverageApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WritingWorkbenchSchema = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (coverageApi) {
  // 文体配置描述提示词可实际消费的领域规则，不写入工作区历史。
  const STRUCTURED_GENRES = {
    'longform-research-article': ['research-brief', 'section-plan', 'section-diagnosis', 'section-revision', 'cross-section-review'],
    'technical-document': ['technical-procedure', 'technical-api', 'technical-design', 'technical-troubleshooting'],
    'business-document': ['business-report', 'business-proposal', 'business-marketing'],
    news: ['news-fact-organization', 'news-release', 'news-review'],
    'tutorial-course': ['course-plan', 'lesson-plan', 'learning-check'],
    'resume-job-search': ['resume-experience-map', 'resume-target-fit', 'resume-revision'],
    email: ['email-draft', 'email-revision', 'email-review'],
    'official-document': ['official-document-plan', 'official-document-review'],
    'legal-document': ['legal-fact-organization', 'legal-document-outline', 'legal-document-review']
  };
  const AUDIOVISUAL_GENRES = {
    'social-post': ['social-post-draft', 'social-carousel', 'social-series', 'social-adaptation'],
    'short-video': ['video-plan', 'video-script', 'video-revision'],
    'spoken-script': ['spoken-draft', 'spoken-revision'],
    'podcast': ['podcast-plan', 'podcast-interview', 'podcast-script', 'podcast-revision'],
    'speech': ['speech-plan', 'speech-outline', 'speech-draft', 'speech-revision']
  };
  const LONGFORM_GENRES = {
    fiction: ['longform-planning', 'longform-outline', 'longform-worldbuilding', 'longform-character', 'longform-chapter-draft', 'longform-continuity', 'longform-revision'],
    script: ['longform-planning', 'longform-outline', 'longform-worldbuilding', 'longform-character', 'longform-scene-draft', 'longform-continuity', 'longform-revision'],
    'longform-general': ['longform-planning', 'longform-outline', 'longform-chapter-draft', 'longform-continuity', 'longform-revision']
  };
  const GENRE_LABELS = {
    'longform-research-article': ['长篇研究文章', '跨章节规划、分节证据与问题复核；不替代学术论文或综述流程。'],
    'technical-document': ['技术文档', '依据用户提供的产品版本、环境、接口与验证材料组织技术文档提示词。'],
    'business-document': ['商务文档', '支持报告、方案和营销内容；产品事实、数据与承诺须由用户材料支持。'],
    news: ['新闻与机构新闻稿', '组织事实、采访材料和新闻稿；引语、时间及归属须可追溯。'],
    'tutorial-course': ['教程与课程', '围绕学习目标、先备知识、示例、练习和可观察完成条件规划。'],
    'resume-job-search': ['简历与求职', '仅依据用户确认的经历和岗位资料生成提示词，不补造履历。'],
    email: ['邮件', '按收件人关系、往来语境、目的与行动项起草或检查，不发送邮件。'],
    'official-document': ['公文', '依据用户指定文种、组织、时点和要求材料辅助整理，不宣称普遍合规。'],
    'legal-document': ['法律文书', '仅组织用户提供的事实与材料并生成审校提示词，不提供法律意见或结果预测。'],
    'social-post': ['社媒图文', '依据用户提供的平台规则和材料组织图文、轮播或系列提示词。'],
    'short-video': ['短视频', '按用户指定时长和格式组织分段脚本、画面、字幕与旁白提示词。'],
    'spoken-script': ['口播', '生成便于朗读的提示词；时长仅估算，不虚构说话人事实。'],
    podcast: ['播客', '支持单人、对谈和采访结构；不编造嘉宾回答或经历。'],
    speech: ['演讲', '依据场合、听众和时长组织演讲提示词；个人经历和承诺须用户确认。'],
    fiction: ['小说', '管理故事设定、角色、时间线与章节连续性提示词。'],
    script: ['剧本', '管理剧种、场景、人物出入场与可呈现动作提示词。'],
    'longform-general': ['通用长篇创作', '提供通用分章任务和连续性提示词，不宣称小说或剧本专项规则。']
  };
  const DOMAIN_FIELDS = {
    'longform-research-article': { question: '研究问题', scope: '文章范围', outline: '章节职责/结构', evidenceMap: '跨节论点与证据关系', terms: '需保持一致的术语' },
    'technical-document': { documentType: '文档类型', productVersion: '产品/系统版本', environment: '目标环境', prerequisites: '前置条件', steps: '步骤/输入与预期结果', failures: '异常与恢复条件' },
    'business-document': { documentType: '文档用途', decisionMaker: '决策对象', businessGoal: '业务目标', dataSources: '数据及来源', options: '方案选项', deadline: '决策期限' },
    news: { topic: '报道主题', timeline: '时间与地点', people: '相关人物/机构', quotes: '采访引语及出处', response: '待回应方', publishTime: '发布时间' },
    'tutorial-course': { learner: '学习者基础', objectives: '可观察学习目标', prerequisites: '先修知识', duration: '课时/时长', exercises: '练习与反馈', assessment: '评估方式' },
    'resume-job-search': { targetRole: '目标岗位', jobSource: '招聘信息来源/日期', experience: '本人确认经历', outcomes: '成果与指标依据', skills: '技能证据', privacy: '隐私删减要求' },
    email: { recipient: '收件人及关系', purpose: '沟通目的', context: '往来背景', action: '希望对方采取的行动', deadline: '时限', commitment: '承诺/披露边界' },
    'official-document': { issuer: '发文主体', documentType: '文种', recipient: '主送对象', basis: '事项依据', action: '办理要求', requirements: '格式要求及版本来源' },
    'legal-document': { jurisdiction: '法域与适用时间', procedure: '程序阶段', documentType: '文书类型', parties: '当事方角色', facts: '事实与证据来源', reviewer: '专业复核要求' },
    'social-post': { format: '单条/轮播/系列形态', platformRules: '平台规则来源/版本', callToAction: '目标行动', cardCount: '页数/条数', tags: '标签/格式约束' },
    'short-video': { platform: '平台/分发场景', duration: '目标时长', opening: '开场方向', tracks: '口播/画面/字幕轨道', pacing: '节奏/分段', assumptions: '时长估算假设' },
    'spoken-script': { speaker: '说话人身份/关系', duration: '目标时长', delivery: '语速/停顿/语气', terminology: '需解释的术语' },
    podcast: { format: '单人/多人/采访', speakers: '主持人与嘉宾角色', duration: '目标时长', segments: '段落与提问次序', sources: '引用材料' },
    speech: { occasion: '演讲场合', listeners: '听众与熟悉程度', duration: '目标时长', mode: '现场/线上', interaction: '互动与行动目标', personalFacts: '待演讲者确认的经历/承诺' },
    fiction: { genre: '题材/类型', viewpoint: '视角/时态', conflict: '核心冲突', canon: '已确认设定', continuity: '连续性约束' },
    script: { medium: '剧种/媒介', format: '场景格式', entrances: '人物出入场', actions: '可呈现动作', continuity: '前后场关系' },
    'longform-general': { form: '长篇体裁', structure: '章节/部分结构', audience: '目标读者', continuity: '需跨单元保持的信息' }
  };
  function createDomainConfig(genre, taskTypes) {
    const [name, applicability] = GENRE_LABELS[genre];
    const dimensions = ['目标与范围', '材料与来源', '结构与格式', '事实与约束', '未解决问题'];
    return [genre, Object.freeze({
      name, applicability,
      targetFields: Object.freeze({ title: '标题/项目名', goal: '目标', audience: '目标对象', platform: '平台/场景', successCriteria: '成功标准', preserveItems: '必须保留', constraints: '限制条件' }),
      domainFields: Object.freeze({ ...(DOMAIN_FIELDS[genre] || {}) }),
      taskTypes: Object.freeze(taskTypes),
      checkDimensions: Object.freeze(dimensions),
      outputRequirements: Object.freeze(Object.fromEntries(taskTypes.map(task => [task, `按${name}的专属任务目标和用户提供材料生成可复制提示词；缺项标为未提供，不补造事实或已完成状态。`]))),
      riskReminders: Object.freeze([applicability, '来源、专业要求和外部结果保持其实际核验状态；不把提示词生成视为事实或合规认证。']),
      styleBaseline: Object.freeze(['保留用户目标和材料含义，避免无依据增强事实强度。']),
      memoryNamespace: genre
    })];
  }
  const WRITING_GENRE_CONFIGS = Object.freeze({
    article: Object.freeze({
      name: "普通文章",
      applicability: "用于普通文章的目标澄清、初稿诊断和连续改稿；其他文体需确认按普通文章处理。",
      targetFields: Object.freeze({
        title: "标题", goal: "目标", audience: "读者", platform: "平台",
        successCriteria: "成功标准", preserveItems: "保留项", constraints: "限制条件"
      }),
      checkDimensions: Object.freeze(["目标读者", "事实依据", "逻辑结构", "语言表达", "风格修辞", "术语一致", "格式排版", "约束风险"]),
      outputRequirements: Object.freeze({
        diagnosis: "你负责诊断当前稿件。不得直接改写文章或产出文章成品。逐项引用具体句段，给出观察、影响、方向、优先级；方向描述修改意图，不提供替换正文。未确定项写待核实。",
        revision: "交给外部 AI 的下一轮写作指令。本工具只生成提示词；外部 AI 可依据本指令执行修改并输出修改稿。请保留目标、成功标准、保留项、反馈、前轮诊断和风格，勿擅增事实。"
      }),
      riskReminders: Object.freeze(["事实、数据和引用需核对来源，不补造依据。", "AI味只检查具体表达，不判断作者身份；无问题不强改。"]),
      styleBaseline: Object.freeze(["表达清晰具体，段落围绕同一重点推进，减少空泛总结。", "保留必要术语和有依据的细节，不机械缩句或替词。"]),
      memoryNamespace: "article"
    }),
    "academic-paper": Object.freeze({
      name: "学术论文与学位论文",
      applicability: "用于课程论文、期刊论文和学位论文的研究规划、提纲、章节起草、诊断及定向优化。具体机构要求须由用户提供或选择。",
      targetFields: Object.freeze({
        title: "论文/学位论文标题", goal: "研究问题与论文目标", audience: "目标读者/项目/投稿对象",
        platform: "学科或研究类型", successCriteria: "目标要求", preserveItems: "必须保留的论点与结果",
        constraints: "研究边界与限制", paperType: "论文类型", discipline: "学科/领域", researchType: "研究类型",
        institution: "目标学校", program: "项目/院系", degreeLevel: "学位层级", journal: "目标期刊",
        section: "投稿栏目", citationStyle: "引用格式", requirements: "机构/期刊要求"
      }),
      checkDimensions: Object.freeze(["目标与范围", "结构与论证", "证据与引用", "方法与结果一致性", "术语与表达", "目标要求", "未解决问题"]),
      outputRequirements: Object.freeze({
        diagnosis: "只诊断用户提供的论文范围，不直接改写。逐项引用可定位原文，说明观察、影响、依据和待核验边界；区分报告完整性与研究质量。",
        revision: "只生成定向修改提示词，写明依据、改动范围、必须保留的结论/数据/术语、不可增强的结论和复核方式；不得补造研究结果、引用或机构要求。"
      }),
      riskReminders: Object.freeze(["学校、期刊、研究结果和引用缺失时标为未提供或待核对，不猜测补齐。", "报告指南只用于适用研究类型的报告完整性线索，不代表研究质量评分或所有学科的通用规范。"]),
      styleBaseline: Object.freeze(["保持术语、论证范围和结论强度一致，区分证据、解释与待核实内容。", "优先清楚、可核对的学术表达，不为显得正式而改变原意。"]),
      memoryNamespace: "academic-paper"
    }),
    ...Object.fromEntries(Object.entries({ ...STRUCTURED_GENRES, ...AUDIOVISUAL_GENRES, ...LONGFORM_GENRES })
      .map(([genre, tasks]) => createDomainConfig(genre, tasks)))
  });
  const WRITING_GENRES = Object.freeze(Object.keys(WRITING_GENRE_CONFIGS));

  function getWritingGenreConfig(genre) {
    return typeof genre === "string" && Object.prototype.hasOwnProperty.call(WRITING_GENRE_CONFIGS, genre)
      ? WRITING_GENRE_CONFIGS[genre] : null;
  }
  const MATERIAL_PURPOSES = Object.freeze(["content", "style", "both", "requirement"]);
  const MATERIAL_CONTENT_STATES = Object.freeze(["embedded", "truncated", "parsed", "reference-only", "failed", "unsupported"]);
  const MATERIAL_SOURCE_TYPES = Object.freeze([
    "text-file", "unread-file-reference", "pasted-text", "link", "web-text", "library-entry", "authorized-directory", "pdf", "docx", "image"
  ]);
  const MATERIAL_EXTRACTION_METHODS = Object.freeze(["pdf-text", "pdf-ocr", "docx-text", "image-ocr"]);
  const MATERIAL_ORIGINS = Object.freeze([
    "manual", "user-pasted", "file-import", "link", "knowledge-library", "authorized-directory", "local-search", "public-research"
  ]);
  const STYLE_PROFILE_SOURCES = Object.freeze(["sample", "user", "user-corrected", "mixed", "temporary"]);
  const STYLE_CONFIDENCE = Object.freeze(["low", "medium", "high"]);
  const MEMORY_SCOPES = Object.freeze(["general", "genre", "project", "article"]);
  const VERIFICATION_STATES = Object.freeze(["unverified", "source-reviewed", "user-confirmed"]);
  const TEXT_LIMIT = 500;
  const PACK_ID_LIMIT = 120;
  const PACK_SELECTION_LIMIT = 20;
  const ACADEMIC_REQUIREMENT_LIMIT = 20;
  // 沿用正文上限；历史按数组顺序保留最近轮次，避免新改稿被旧记录挤掉。
  const DRAFT_LIMIT = 8000;
  const ROUND_LIMIT = 100;
  const UNIT_LIMIT = 100;
  const ISSUE_LIMIT = 200;
  const UNIT_TYPES = Object.freeze(["chapter", "fragment", "task"]);
  const ISSUE_JUDGMENTS = Object.freeze(["candidate", "needs-verification", "preference", "undetermined"]);
  const ISSUE_STATUSES = Object.freeze(["pending", "pending-user", "resolved-awaiting-review", "review-passed", "deferred"]);
  const ISSUE_PRIORITIES = Object.freeze(["low", "medium", "high"]);
  const ROUTE_STEP_STATUSES = Object.freeze(["not-started", "in-progress", "user-confirmed-complete", "skipped", "blocked"]);
  const PACK_VERIFICATION_STATES = Object.freeze(["unverified", "source-reviewed", "case-validated"]);
  const WRITING_TASK_TYPES = new Set(["diagnosis", "revision", "academic-planning", "academic-outline", "academic-chapter-draft",
    ...Object.values({ ...STRUCTURED_GENRES, ...AUDIOVISUAL_GENRES, ...LONGFORM_GENRES }).flat()]);

  const ARTICLE_FIELDS = new Set([
    "id", "title", "genre", "goal", "audience", "platform", "preserveItems", "dimensions", "constraints",
    "successCriteria", "sourceArticleId", "draft", "saveEnabled", "styleProfileId", "packSelections", "academicTarget",
    "createdAt", "updatedAt", "research", "domainInputs"
  ]);
  const MATERIAL_FIELDS = new Set([
    "id", "title", "purpose", "excerpt", "sourceArticleId", "sourceType", "contentStatus", "contentError", "originalLength",
    "sourceId", "origin", "sourceLocator", "sourceVersion", "excerptLocator", "selectionReason", "selectedForPrompt",
    "verificationStatus", "provider", "accessedAt", "license", "applicability", "limitations",
    "attachmentRequired", "unitIds", "extractionMethod", "pageCount", "extractedCharacterCount", "recognitionConfidence"
  ]);
  const SOURCE_FIELDS = new Set([
    "id", "title", "url", "excerpt", "purpose", "verificationStatus", "origin", "contentStatus", "contentError",
    "sourceType", "sourceId", "sourceLocator", "sourceVersion", "excerptLocator", "selectionReason", "attachmentRequired", "unitIds",
    "provider", "accessedAt", "license", "applicability", "limitations",
    "extractionMethod", "pageCount", "extractedCharacterCount", "recognitionConfidence"
  ]);
  const ROUND_FIELDS = new Set([
    "id", "articleId", "draft", "feedback", "userFeedback", "revisionNote", "diagnosisParseStatus",
    "parentRoundId", "diagnosis", "prompt", "sources", "materials", "preferences", "undo", "packSelections",
    "packSnapshot", "unitId", "unitSnapshot", "longformSnapshot", "promptVersions", "sourcePromptVersionId", "restoredFromRoundId",
    "routeSnapshot", "taskType", "createdAt", "updatedAt"
  ]);
  const UNDO_FIELDS = new Set(["action", "memoryId", "roundId", "undoneAt"]);
  const STYLE_SAMPLE_FIELDS = new Set(["sourceArticleId", "excerpt", "features"]);
  const STYLE_PROFILE_FIELDS = new Set([
    "id", "source", "confidence", "traits", "samples", "userCorrections", "scope", "genre",
    "sourceArticleIds", "createdAt", "updatedAt"
  ]);
  const MEMORY_FIELDS = new Set([
    "id", "scope", "genre", "projectId", "articleId", "sourceArticleId",
    "preference", "reason", "example", "counterexample", "sourcePreferenceKey", "evidenceArticleIds", "undo",
    "createdAt", "updatedAt"
  ]);
  const WORKSPACE_FIELDS = new Set([
    "id", "genre", "article", "rounds", "styleProfile",
    "styleProfiles", "memory", "memories", "sourceArticleIds",
    "units", "issues", "routeProgress", "longform", "materialCoverage", "createdAt", "updatedAt"
  ]);

  const UNIT_FIELDS = new Set(["id", "type", "title", "goal", "completionCriteria", "order", "archived",
    "viewpoint", "storyTime", "location", "format", "entrances", "exits", "action",
    "characterIds", "canonIds", "eventIds", "foreshadowingIds",
    "purpose", "priorUnitIds", "nextUnitIds", "summary", "status"]);
  const LONGFORM_MODES = Object.freeze(["fiction", "script", "longform-general"]);
  const LONGFORM_ITEM_STATUSES = Object.freeze(["tentative", "confirmed", "deprecated"]);
  const FORESHADOWING_STATUSES = Object.freeze(["planned", "planted", "pending-payoff", "paid-off", "abandoned", "unconfirmed"]);
  const IMPACT_STATUSES = Object.freeze(["pending", "reviewed", "no-change", "deferred"]);
  const ISSUE_FIELDS = new Set([
    "id", "roundId", "promptVersionId", "unitId", "location", "excerpt", "observation", "impact",
    "evidenceCategory", "evidenceDescription", "packId", "sourceId", "suggestion", "priority",
    "judgment", "status", "statusReason", "reviewedRoundId", "reviewedAt"
  ]);
  const PROMPT_VERSION_FIELDS = new Set(["id", "parentVersionId", "content", "createdAt", "copied", "taskType", "generated", "unitId", "unitSnapshot", "longformSnapshot", "packVersions"]);
  const ROUTE_SNAPSHOT_FIELDS = new Set([
    "roundId", "packId", "packVersion", "packName", "routeId", "title", "taskTypes", "sourceIds", "verificationStatus",
    "currentUnitId", "currentStageId", "stages", "sources"
  ]);
  const ROUTE_STAGE_SNAPSHOT_FIELDS = new Set([
    "id", "title", "methodCardIds", "inputs", "outputs", "checks", "sourceIds", "verificationStatus", "skippable",
    "returnWhenMissing", "status", "statusReason", "result", "evidence", "confirmedAt"
  ]);

  const PACK_SNAPSHOT_PACK_FIELDS = new Set(["id", "version", "name", "layer", "genre", "taskType"]);
  const PACK_SNAPSHOT_ENTRY_FIELDS = new Set([
    "id", "packId", "packVersion", "kind", "taskType", "text", "sourceIds", "verificationStatus",
    "inputs", "outputs", "checks", "skippable", "returnWhenMissing"
  ]);
  // packId 让同名来源 ID 可以按包归属去重，跨包同名不再互相覆盖。
  const PACK_SNAPSHOT_SOURCE_FIELDS = new Set([
    "id", "packId", "title", "url", "locator", "version", "versionHash", "readAt", "license", "adoptionReason", "reviewRecord", "checkedAt", "applicability", "limitations", "verificationStatus"
  ]);
  const PACK_SNAPSHOT_SKIPPED_FIELDS = new Set(["id", "reason"]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function text(value, limit = TEXT_LIMIT) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
  }

  function safeMetadataText(value, limit = TEXT_LIMIT) {
    return text(value, limit)
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [凭证已省略]")
      .replace(/(["']?(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|client[\s_-]?secret|private[\s_-]?key|authorization|password|secret|credential|token)["']?\s*[:=]\s*["']?)[^"'\s,;}&]+/gi,
        "$1[凭证已省略]")
      .replace(/\b[A-Za-z]:[\\/][^\s"'<>]*/g, "[本地路径已省略]")
      .replace(/\\\\[^\s"'<>]+/g, "[本地路径已省略]")
      .replace(/(^|[\s("'=])\\(?!\\)[^\s"'<>]*/g, "$1[本地路径已省略]")
      .replace(/(^|[\s("'=])\/(?:[A-Za-z0-9._~-]+\/)+[A-Za-z0-9._~-]+/g, "$1[本地路径已省略]");
  }

  function relativeLocator(value) {
    const locator = text(value, 500).replace(/\\/g, "/");
    if (!locator || locator.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(locator)
      || locator.split("/").some(part => !part || part === "." || part === "..")) return "";
    return locator;
  }

  function textList(value, limit = 30, itemLimit = TEXT_LIMIT) {
    if (!Array.isArray(value)) return [];
    return value.map(item => text(item, itemLimit)).filter(Boolean).slice(0, limit);
  }

  function uniqueTextList(value, limit = PACK_SELECTION_LIMIT, itemLimit = PACK_ID_LIMIT) {
    return [...new Set(textList(value, limit, itemLimit))];
  }

  function snapshotVersion(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 1;
  }

  function normalizeWritingPackSnapshot(input) {
    const source = isObject(input) ? input : {};
    const packs = Array.isArray(source.packs) ? source.packs.slice(0, PACK_SELECTION_LIMIT).map(item => {
      const value = isObject(item) ? item : {};
      return Object.fromEntries(Object.entries({
        id: text(value.id, PACK_ID_LIMIT), version: snapshotVersion(value.version), name: text(value.name),
        layer: text(value.layer, 20), genre: text(value.genre, PACK_ID_LIMIT), taskType: text(value.taskType, PACK_ID_LIMIT)
      }).filter(([key, itemValue]) => PACK_SNAPSHOT_PACK_FIELDS.has(key) && (key === "version" || itemValue)));
    }).filter(item => item.id) : [];
    const skipped = Array.isArray(source.skipped) ? source.skipped.slice(0, PACK_SELECTION_LIMIT).map(item => {
      const value = isObject(item) ? item : {};
      return Object.fromEntries(Object.entries({ id: text(value.id, PACK_ID_LIMIT), reason: text(value.reason, 80) })
        .filter(([key, itemValue]) => PACK_SNAPSHOT_SKIPPED_FIELDS.has(key) && itemValue));
    }).filter(item => item.id && item.reason) : [];
    const entries = Array.isArray(source.entries) ? source.entries.slice(0, 100).map(item => {
      const value = isObject(item) ? item : {};
      const entry = {
        id: text(value.id, PACK_ID_LIMIT), packId: text(value.packId, PACK_ID_LIMIT),
        packVersion: snapshotVersion(value.packVersion), kind: text(value.kind, 40),
        taskType: text(value.taskType, PACK_ID_LIMIT), text: text(value.text),
        sourceIds: uniqueTextList(value.sourceIds),
        verificationStatus: ["unverified", "source-reviewed", "case-validated"].includes(value.verificationStatus)
          ? value.verificationStatus : "unverified"
      };
      if (entry.kind === 'method') Object.assign(entry, {
        inputs: textList(value.inputs), outputs: textList(value.outputs), checks: textList(value.checks),
        skippable: value.skippable === true, returnWhenMissing: textList(value.returnWhenMissing)
      });
      return Object.fromEntries(Object.entries(entry).filter(([key, itemValue]) => PACK_SNAPSHOT_ENTRY_FIELDS.has(key)
        && (key === "packVersion" || key === "sourceIds" || itemValue)));
    }).filter(item => item.id && item.packId && item.text) : [];
    // 上限 100 条会静默截断；这里按包去重记录被截掉的规则，保证降级可观察。
    if (Array.isArray(source.entries) && source.entries.length > 100) {
      const truncatedPackIds = new Set(skipped.filter(item => item.reason === 'entries-truncated').map(item => item.id));
      source.entries.slice(100).forEach(item => {
        const value = isObject(item) ? item : {};
        const packId = text(value.packId, PACK_ID_LIMIT);
        if (packId && !truncatedPackIds.has(packId)) {
          truncatedPackIds.add(packId);
          skipped.push({ id: packId, reason: 'entries-truncated' });
        }
      });
      skipped.splice(PACK_SELECTION_LIMIT);
    }
    const sources = Array.isArray(source.sources) ? source.sources.slice(0, 100).map(item => {
      const value = isObject(item) ? item : {};
      const entry = {
        id: text(value.id, PACK_ID_LIMIT), packId: text(value.packId, PACK_ID_LIMIT), title: text(value.title), url: text(value.url, 2000),
        locator: text(value.locator), version: text(value.version, 160), license: text(value.license, 500),
        versionHash: text(value.versionHash, 160), readAt: text(value.readAt, 80),
        adoptionReason: text(value.adoptionReason), reviewRecord: text(value.reviewRecord),
        checkedAt: text(value.checkedAt, 80), applicability: text(value.applicability), limitations: text(value.limitations),
        verificationStatus: ["unverified", "source-reviewed", "case-validated"].includes(value.verificationStatus)
          ? value.verificationStatus : "unverified"
      };
      return Object.fromEntries(Object.entries(entry).filter(([key, itemValue]) => PACK_SNAPSHOT_SOURCE_FIELDS.has(key)
        && (key === "verificationStatus" || itemValue)));
    }).filter(item => item.id) : [];
    return { packs, entries, sources, skipped };
  }

  function count(value, maximum, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(maximum, Math.floor(number))) : fallback;
  }

  function normalizeUndo(input) {
    const source = isObject(input) ? input : {};
    const undo = {
      action: text(source.action, 100),
      memoryId: text(source.memoryId, 100),
      roundId: text(source.roundId, 100),
      undoneAt: text(source.undoneAt, 80)
    };
    return Object.fromEntries(Object.entries(undo).filter(([key, value]) => UNDO_FIELDS.has(key) && value));
  }

  function normalizeWritingUnit(input, fallbackOrder = 0) {
    const source = isObject(input) ? input : {};
    const type = UNIT_TYPES.includes(source.type) ? source.type : "task";
    const unit = {
      id: safeMetadataText(source.id, 100),
      type,
      title: safeMetadataText(source.title),
      goal: safeMetadataText(source.goal),
      completionCriteria: textList(source.completionCriteria, 30, 500).map(item => safeMetadataText(item, 500)),
      order: count(source.order, 100000, fallbackOrder),
      archived: source.archived === true,
      ...(Object.hasOwn(source, "viewpoint") ? { viewpoint: safeMetadataText(source.viewpoint, 300) } : {}),
      ...(Object.hasOwn(source, "storyTime") ? { storyTime: safeMetadataText(source.storyTime, 300) } : {}),
      ...(Object.hasOwn(source, "location") ? { location: safeMetadataText(source.location, 300) } : {}),
      ...(Object.hasOwn(source, "format") ? { format: safeMetadataText(source.format, 160) } : {}),
      ...(Object.hasOwn(source, "entrances") ? { entrances: safeMetadataText(source.entrances, 500) } : {}),
      ...(Object.hasOwn(source, "exits") ? { exits: safeMetadataText(source.exits, 500) } : {}),
      ...(Object.hasOwn(source, "action") ? { action: safeMetadataText(source.action, 1000) } : {}),
      ...(Object.hasOwn(source, "characterIds") ? { characterIds: uniqueTextList(source.characterIds, 30, 100) } : {}),
      ...(Object.hasOwn(source, "canonIds") ? { canonIds: uniqueTextList(source.canonIds, 30, 100) } : {}),
      ...(Object.hasOwn(source, "eventIds") ? { eventIds: uniqueTextList(source.eventIds, 30, 100) } : {}),
      ...(Object.hasOwn(source, "foreshadowingIds") ? { foreshadowingIds: uniqueTextList(source.foreshadowingIds, 30, 100) } : {}),
      ...(Object.hasOwn(source, "purpose") ? { purpose: safeMetadataText(source.purpose, 500) } : {}),
      ...(Object.hasOwn(source, "priorUnitIds") ? { priorUnitIds: uniqueTextList(source.priorUnitIds, 30, 100) } : {}),
      ...(Object.hasOwn(source, "nextUnitIds") ? { nextUnitIds: uniqueTextList(source.nextUnitIds, 30, 100) } : {}),
      ...(Object.hasOwn(source, "summary") ? { summary: safeMetadataText(source.summary, 1200) } : {}),
      ...(Object.hasOwn(source, "status") ? { status: ["planned", "drafting", "review", "complete", "archived"].includes(source.status) ? source.status : "planned" } : {})
    };
    return Object.fromEntries(Object.entries(unit).filter(([key]) => UNIT_FIELDS.has(key)));
  }

  function normalizeLongform(input) {
    const source = isObject(input) ? input : {};
    if (!LONGFORM_MODES.includes(source.mode)) return null;
    const ids = new Set();
    const uniqueItems = (items, limit, mapper) => (Array.isArray(items) ? items : []).slice(0, limit)
      .filter(isObject).map((item, index) => mapper(item, index)).filter(item => {
        if (!item.id || ids.has(item.id)) return false;
        ids.add(item.id);
        return true;
      });
    const references = value => uniqueTextList(value, 30, 100);
    const longform = {
      mode: source.mode,
      medium: safeMetadataText(source.medium, 160),
      viewpoint: safeMetadataText(source.viewpoint, 300),
      tense: safeMetadataText(source.tense, 100),
      audience: safeMetadataText(source.audience, 300),
      scope: safeMetadataText(source.scope, 300),
      constraints: safeMetadataText(source.constraints, 1000),
      contextNote: safeMetadataText(source.contextNote, 500),
      canon: uniqueItems(source.canon, 100, item => ({
        id: safeMetadataText(item.id, 100), category: safeMetadataText(item.category, 60),
        name: safeMetadataText(item.name, 160), text: safeMetadataText(item.text, 1200),
        scope: safeMetadataText(item.scope, 300), status: LONGFORM_ITEM_STATUSES.includes(item.status) ? item.status : "tentative",
        sourceNote: safeMetadataText(item.sourceNote, 500), unitIds: references(item.unitIds), updatedAt: text(item.updatedAt, 80), archived: item.archived === true
      })),
      characters: uniqueItems(source.characters, 100, item => ({
        id: safeMetadataText(item.id, 100), name: safeMetadataText(item.name, 160), identity: safeMetadataText(item.identity, 500),
        relationships: safeMetadataText(item.relationships, 1000), goals: safeMetadataText(item.goals, 1000),
        known: safeMetadataText(item.known, 1000), unknown: safeMetadataText(item.unknown, 1000),
        state: safeMetadataText(item.state, 1000), arc: safeMetadataText(item.arc, 1000),
        firstUnitId: safeMetadataText(item.firstUnitId, 100), lastUnitId: safeMetadataText(item.lastUnitId, 100),
        unitIds: references(item.unitIds), notes: safeMetadataText(item.notes, 1000), archived: item.archived === true
      })),
      timeline: uniqueItems(source.timeline, 200, item => ({
        id: safeMetadataText(item.id, 100), text: safeMetadataText(item.text, 1000), storyTime: safeMetadataText(item.storyTime, 160),
        characterIds: references(item.characterIds), canonIds: references(item.canonIds), unitIds: references(item.unitIds),
        order: ["before", "after", "simultaneous", "unknown"].includes(item.order) ? item.order : "unknown",
        status: LONGFORM_ITEM_STATUSES.includes(item.status) ? item.status : "tentative", archived: item.archived === true
      })),
      foreshadowing: uniqueItems(source.foreshadowing, 100, item => ({
        id: safeMetadataText(item.id, 100), planted: safeMetadataText(item.planted, 1000), location: safeMetadataText(item.location, 300),
        expectedPayoff: safeMetadataText(item.expectedPayoff, 1000), characterIds: references(item.characterIds),
        canonIds: references(item.canonIds), unitIds: references(item.unitIds),
        status: FORESHADOWING_STATUSES.includes(item.status) ? item.status : "unconfirmed",
        confirmation: safeMetadataText(item.confirmation, 500), archived: item.archived === true
      })),
      relatedMaterials: (Array.isArray(source.relatedMaterials) ? source.relatedMaterials : []).slice(0, 3)
        .filter(isObject).map(normalizeWritingMaterial).filter(item => item.id || item.title || item.excerpt),
      changes: uniqueItems(source.changes, 200, item => ({
        id: safeMetadataText(item.id, 100), itemId: safeMetadataText(item.itemId, 100),
        itemType: ["canon", "character", "timeline", "foreshadowing"].includes(item.itemType) ? item.itemType : "canon",
        oldValue: safeMetadataText(item.oldValue, 1200), newValue: safeMetadataText(item.newValue, 1200),
        reason: safeMetadataText(item.reason, 500), createdAt: text(item.createdAt, 80),
        impacts: (Array.isArray(item.impacts) ? item.impacts : []).slice(0, 100).filter(isObject).map(impact => ({
          id: safeMetadataText(impact.id, 100), type: ["unit", "material", "issue", "foreshadowing"].includes(impact.type) ? impact.type : "unit",
          status: IMPACT_STATUSES.includes(impact.status) ? impact.status : "pending", reason: safeMetadataText(impact.reason, 500), reviewedAt: text(impact.reviewedAt, 80)
        })).filter(impact => impact.id)
      }))
    };
    return longform;
  }

  function normalizeWritingIssue(input) {
    const source = isObject(input) ? input : {};
    const issue = {
      id: safeMetadataText(source.id, 100),
      roundId: safeMetadataText(source.roundId, 100),
      promptVersionId: safeMetadataText(source.promptVersionId, 100),
      unitId: safeMetadataText(source.unitId, 100),
      location: safeMetadataText(source.location, 240),
      excerpt: safeMetadataText(source.excerpt, 1200),
      observation: safeMetadataText(source.observation, 1200),
      impact: safeMetadataText(source.impact, 1200),
      evidenceCategory: safeMetadataText(source.evidenceCategory, 80),
      evidenceDescription: safeMetadataText(source.evidenceDescription, 1200),
      packId: safeMetadataText(source.packId, PACK_ID_LIMIT),
      sourceId: safeMetadataText(source.sourceId, PACK_ID_LIMIT),
      suggestion: safeMetadataText(source.suggestion, 1200),
      priority: ISSUE_PRIORITIES.includes(source.priority) ? source.priority : "medium",
      judgment: ISSUE_JUDGMENTS.includes(source.judgment) ? source.judgment : "undetermined",
      status: ISSUE_STATUSES.includes(source.status) ? source.status : "pending",
      statusReason: safeMetadataText(source.statusReason, 1000),
      reviewedRoundId: safeMetadataText(source.reviewedRoundId, 100),
      reviewedAt: safeMetadataText(source.reviewedAt, 80)
    };
    return Object.fromEntries(Object.entries(issue).filter(([key]) => ISSUE_FIELDS.has(key)));
  }

  function normalizePromptVersions(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.map(input => {
      const source = isObject(input) ? input : {};
      const version = {
        id: safeMetadataText(source.id, 100),
        parentVersionId: safeMetadataText(source.parentVersionId, 100),
        content: safeMetadataText(source.content, 8000),
        createdAt: safeMetadataText(source.createdAt, 80),
        copied: source.copied === true,
        ...(safeMetadataText(source.unitId, 100) ? { unitId: safeMetadataText(source.unitId, 100) } : {}),
        ...(isObject(source.unitSnapshot) ? { unitSnapshot: normalizeWritingUnit(source.unitSnapshot) } : {}),
        ...(isObject(source.longformSnapshot) ? { longformSnapshot: normalizeLongform(source.longformSnapshot) } : {}),
        ...(Array.isArray(source.packVersions) ? { packVersions: source.packVersions.slice(0, PACK_SELECTION_LIMIT).filter(isObject).map(pack => ({
          id: safeMetadataText(pack.id, PACK_ID_LIMIT), version: snapshotVersion(pack.version)
        })).filter(pack => pack.id) } : {})
      };
      if (WRITING_TASK_TYPES.has(source.taskType)) version.taskType = source.taskType;
      if (Object.prototype.hasOwnProperty.call(source, "generated")) version.generated = source.generated === true;
      return version;
    }).filter(version => {
      if (!version.id || seen.has(version.id)) return false;
      seen.add(version.id);
      return true;
    }).map(version => Object.fromEntries(Object.entries(version)
      .filter(([key]) => PROMPT_VERSION_FIELDS.has(key))));
  }

  function normalizeRouteStageSnapshot(input) {
    const source = isObject(input) ? input : {};
    const verificationStatus = PACK_VERIFICATION_STATES.includes(source.verificationStatus)
      ? source.verificationStatus : "unverified";
    const status = ROUTE_STEP_STATUSES.includes(source.status) ? source.status : "not-started";
    const stage = {
      id: safeMetadataText(source.id, PACK_ID_LIMIT),
      title: safeMetadataText(source.title),
      methodCardIds: uniqueTextList(source.methodCardIds, 30, PACK_ID_LIMIT),
      inputs: textList(source.inputs, 30, 500).map(item => safeMetadataText(item, 500)),
      outputs: textList(source.outputs, 30, 500).map(item => safeMetadataText(item, 500)),
      checks: textList(source.checks, 30, 500).map(item => safeMetadataText(item, 500)),
      sourceIds: uniqueTextList(source.sourceIds, 30, PACK_ID_LIMIT),
      verificationStatus,
      skippable: source.skippable === true,
      returnWhenMissing: textList(source.returnWhenMissing, 30, 500).map(item => safeMetadataText(item, 500)),
      status,
      statusReason: safeMetadataText(source.statusReason, 1000),
      result: safeMetadataText(source.result, 2000),
      evidence: safeMetadataText(source.evidence, 2000),
      confirmedAt: safeMetadataText(source.confirmedAt, 80)
    };
    return Object.fromEntries(Object.entries(stage).filter(([key]) => ROUTE_STAGE_SNAPSHOT_FIELDS.has(key)));
  }

  function normalizeRouteSnapshot(input) {
    const source = isObject(input) ? input : {};
    const snapshot = {
      roundId: safeMetadataText(source.roundId, 100),
      packId: safeMetadataText(source.packId, PACK_ID_LIMIT),
      packVersion: snapshotVersion(source.packVersion),
      packName: safeMetadataText(source.packName),
      routeId: safeMetadataText(source.routeId, PACK_ID_LIMIT),
      title: safeMetadataText(source.title),
      taskTypes: uniqueTextList(source.taskTypes, 30, PACK_ID_LIMIT),
      sourceIds: uniqueTextList(source.sourceIds, 30, PACK_ID_LIMIT),
      verificationStatus: PACK_VERIFICATION_STATES.includes(source.verificationStatus)
        ? source.verificationStatus : "unverified",
      currentUnitId: safeMetadataText(source.currentUnitId, 100),
      currentStageId: safeMetadataText(source.currentStageId, PACK_ID_LIMIT),
      stages: Array.isArray(source.stages)
        ? source.stages.slice(0, 20).map(normalizeRouteStageSnapshot).filter(stage => stage.id)
        : [],
      sources: normalizeWritingPackSnapshot({ sources: source.sources }).sources
    };
    return Object.fromEntries(Object.entries(snapshot).filter(([key]) => ROUTE_SNAPSHOT_FIELDS.has(key)));
  }

  function normalizeWritingArticle(input) {
    const source = isObject(input) ? input : {};
    const article = {
      id: text(source.id, 100),
      title: text(source.title),
      genre: WRITING_GENRES.includes(source.genre) ? source.genre : (source.genre === undefined ? "article" : ""),
      goal: text(source.goal),
      successCriteria: textList(source.successCriteria, 20, 500),
      audience: text(source.audience),
      platform: text(source.platform, 160),
      preserveItems: textList(source.preserveItems, 30),
      dimensions: textList(source.dimensions, 8, 160),
      constraints: text(source.constraints),
      sourceArticleId: text(source.sourceArticleId, 100),
      draft: text(source.draft, DRAFT_LIMIT),
      saveEnabled: source.saveEnabled === true,
      styleProfileId: text(source.styleProfileId, 100),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    // 研究计划只在会话中，持久化仅记录本篇拒绝，导入不能自动授权搜索。
    if (isObject(source.research) && source.research.status === 'rejected') article.research = { status: 'rejected' };
    if (Object.prototype.hasOwnProperty.call(source, "packSelections")) {
      article.packSelections = uniqueTextList(source.packSelections);
    }
    if (article.genre === "academic-paper" && isObject(source.academicTarget)) {
      article.academicTarget = normalizeAcademicTarget(source.academicTarget);
    }
    const domainFields = WRITING_GENRE_CONFIGS[article.genre]?.domainFields;
    if (domainFields && isObject(source.domainInputs)) {
      article.domainInputs = Object.fromEntries(Object.keys(domainFields).map(key => [key, safeMetadataText(source.domainInputs[key], 1000)])
        .filter(([, value]) => value));
    }
    return Object.fromEntries(Object.entries(article).filter(([key]) => ARTICLE_FIELDS.has(key)));
  }

  function normalizeAcademicTarget(input) {
    const source = isObject(input) ? input : {};
    const target = {};
    for (const field of ["paperType", "discipline", "researchType", "institution", "program", "degreeLevel", "journal", "section", "citationStyle"]) {
      target[field] = safeMetadataText(source[field], 160);
    }
    target.requirements = Array.isArray(source.requirements)
      ? source.requirements.slice(0, ACADEMIC_REQUIREMENT_LIMIT).filter(isObject).map(requirement => ({
        id: safeMetadataText(requirement.id, 100),
        title: safeMetadataText(requirement.title, 160),
        issuer: safeMetadataText(requirement.issuer, 160),
        target: safeMetadataText(requirement.target, 160),
        version: safeMetadataText(requirement.version, 120),
        text: safeMetadataText(requirement.text, 1200),
        sourceUrl: /^https?:\/\//i.test(text(requirement.sourceUrl, 2000)) ? safeMetadataText(requirement.sourceUrl, 2000) : "",
        locator: relativeLocator(requirement.locator),
        verificationStatus: VERIFICATION_STATES.includes(requirement.verificationStatus) ? requirement.verificationStatus : "unverified"
      })) : [];
    return target;
  }

  function normalizeWritingMaterial(input) {
    const source = isObject(input) ? input : {};
    const material = {
      id: safeMetadataText(source.id, 100),
      title: safeMetadataText(source.title, 160),
      purpose: MATERIAL_PURPOSES.includes(source.purpose) ? source.purpose : "content",
      excerpt: safeMetadataText(source.excerpt, 1200),
      sourceArticleId: safeMetadataText(source.sourceArticleId, 100),
      ...(MATERIAL_SOURCE_TYPES.includes(source.sourceType) ? { sourceType: source.sourceType } : {}),
      ...(MATERIAL_ORIGINS.includes(source.origin) ? { origin: source.origin } : {}),
      ...(safeMetadataText(source.sourceId, 240) ? { sourceId: safeMetadataText(source.sourceId, 240) } : {}),
      ...(relativeLocator(source.sourceLocator) ? { sourceLocator: relativeLocator(source.sourceLocator) } : {}),
      ...(safeMetadataText(source.sourceVersion, 160) ? { sourceVersion: safeMetadataText(source.sourceVersion, 160) } : {}),
      ...(safeMetadataText(source.excerptLocator, 120) ? { excerptLocator: safeMetadataText(source.excerptLocator, 120) } : {}),
      ...(safeMetadataText(source.selectionReason, 300) ? { selectionReason: safeMetadataText(source.selectionReason, 300) } : {}),
      ...(typeof source.selectedForPrompt === 'boolean' ? { selectedForPrompt: source.selectedForPrompt } : {}),
      ...(VERIFICATION_STATES.includes(source.verificationStatus) ? { verificationStatus: source.verificationStatus } : {}),
      ...normalizeSourceMetadata(source),
      ...(typeof source.attachmentRequired === "boolean" ? { attachmentRequired: source.attachmentRequired } : {}),
      ...(MATERIAL_CONTENT_STATES.includes(source.contentStatus) ? { contentStatus: source.contentStatus } : {}),
      ...(safeMetadataText(source.contentError, 300) ? { contentError: safeMetadataText(source.contentError, 300) } : {}),
      ...(Number.isSafeInteger(source.originalLength) && source.originalLength >= 0
        ? { originalLength: Math.min(source.originalLength, 2_000_000) } : {}),
      ...(MATERIAL_EXTRACTION_METHODS.includes(source.extractionMethod) ? { extractionMethod: source.extractionMethod } : {}),
      ...(Number.isSafeInteger(source.pageCount) && source.pageCount >= 0 ? { pageCount: Math.min(source.pageCount, 500) } : {}),
      ...(Number.isSafeInteger(source.extractedCharacterCount) && source.extractedCharacterCount >= 0
        ? { extractedCharacterCount: Math.min(source.extractedCharacterCount, 2_000_000) } : {}),
      ...(Number.isFinite(source.recognitionConfidence) && source.recognitionConfidence >= 0 && source.recognitionConfidence <= 100
        ? { recognitionConfidence: Math.round(source.recognitionConfidence) } : {})
    };
    if (Object.prototype.hasOwnProperty.call(source, "unitIds")) {
      material.unitIds = uniqueTextList(source.unitIds, UNIT_LIMIT, 100);
    }
    return Object.fromEntries(Object.entries(material).filter(([key]) => MATERIAL_FIELDS.has(key)));
  }

  function normalizeWritingRound(input) {
    const source = isObject(input) ? input : {};
    const round = {
      id: text(source.id, 100),
      articleId: text(source.articleId, 100),
      parentRoundId: text(source.parentRoundId, 100),
      draft: text(source.draft, DRAFT_LIMIT),
      diagnosis: text(source.diagnosis, 4000),
      prompt: text(source.prompt, 8000),
      ...(WRITING_TASK_TYPES.has(source.taskType) ? { taskType: source.taskType } : {}),
      feedback: text(source.feedback, 2000),
      userFeedback: text(source.userFeedback, 2000),
      revisionNote: text(source.revisionNote, 1000),
      unitId: safeMetadataText(source.unitId, 100),
      restoredFromRoundId: safeMetadataText(source.restoredFromRoundId, 100),
      sources: Array.isArray(source.sources)
        ? source.sources.slice(0, 20).map(normalizeWritingSource).filter(item => item.title || item.url || item.excerpt)
        : [],
      materials: Array.isArray(source.materials)
        ? source.materials.slice(0, 20).map(normalizeWritingMaterial).filter(item => item.id || item.title || item.excerpt)
        : [],
      undo: normalizeUndo(source.undo),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    if (Object.prototype.hasOwnProperty.call(source, "preferences")) {
      round.preferences = (Array.isArray(source.preferences) ? source.preferences : []).slice(0, 8)
        .filter(isObject).map(item => ({
          preference: text(item.preference),
          ...(Object.prototype.hasOwnProperty.call(item, "example") ? { example: text(item.example) } : {}),
          ...(Object.prototype.hasOwnProperty.call(item, "counterexample") ? { counterexample: text(item.counterexample) } : {})
        })).filter(item => item.preference);
    }
    if (Object.prototype.hasOwnProperty.call(source, "packSelections")) {
      round.packSelections = uniqueTextList(source.packSelections);
    }
    if (Object.prototype.hasOwnProperty.call(source, "packSnapshot")) {
      round.packSnapshot = normalizeWritingPackSnapshot(source.packSnapshot);
    }
    if (Object.prototype.hasOwnProperty.call(source, "unitSnapshot")) {
      round.unitSnapshot = normalizeWritingUnit(source.unitSnapshot);
    }
    if (Object.prototype.hasOwnProperty.call(source, "longformSnapshot")) {
      round.longformSnapshot = normalizeLongform(source.longformSnapshot);
    }
    if (Object.prototype.hasOwnProperty.call(source, "promptVersions")) {
      round.promptVersions = normalizePromptVersions(source.promptVersions);
    }
    if (Object.prototype.hasOwnProperty.call(source, "sourcePromptVersionId")) {
      round.sourcePromptVersionId = safeMetadataText(source.sourcePromptVersionId, 100);
    }
    if (Object.prototype.hasOwnProperty.call(source, "routeSnapshot")) {
      round.routeSnapshot = normalizeRouteSnapshot(source.routeSnapshot);
    }
    if (["parsed", "unparsed"].includes(source.diagnosisParseStatus)) {
      round.diagnosisParseStatus = source.diagnosisParseStatus;
    }
    return Object.fromEntries(Object.entries(round).filter(([key]) => ROUND_FIELDS.has(key)));
  }

  function normalizeWritingSource(input) {
    const source = isObject(input) ? input : {};
    const url = text(source.url, 2000);
    const entry = {
      ...(safeMetadataText(source.id, 100) ? { id: safeMetadataText(source.id, 100) } : {}),
      title: safeMetadataText(source.title, 160),
      url: /^file:/i.test(url) ? "" : safeMetadataText(url, 2000),
      excerpt: safeMetadataText(source.excerpt, 1200),
      purpose: MATERIAL_PURPOSES.includes(source.purpose) ? source.purpose : "content",
      verificationStatus: VERIFICATION_STATES.includes(source.verificationStatus) ? source.verificationStatus : "unverified",
      ...normalizeSourceMetadata(source),
      ...(MATERIAL_SOURCE_TYPES.includes(source.sourceType) ? { sourceType: source.sourceType } : {}),
      ...(MATERIAL_ORIGINS.includes(source.origin) ? { origin: source.origin } : {}),
      ...(safeMetadataText(source.sourceId, 240) ? { sourceId: safeMetadataText(source.sourceId, 240) } : {}),
      ...(relativeLocator(source.sourceLocator) ? { sourceLocator: relativeLocator(source.sourceLocator) } : {}),
      ...(safeMetadataText(source.sourceVersion, 160) ? { sourceVersion: safeMetadataText(source.sourceVersion, 160) } : {}),
      ...(safeMetadataText(source.excerptLocator, 120) ? { excerptLocator: safeMetadataText(source.excerptLocator, 120) } : {}),
      ...(safeMetadataText(source.selectionReason, 300) ? { selectionReason: safeMetadataText(source.selectionReason, 300) } : {}),
      ...(typeof source.attachmentRequired === "boolean" ? { attachmentRequired: source.attachmentRequired } : {}),
      ...(MATERIAL_CONTENT_STATES.includes(source.contentStatus) ? { contentStatus: source.contentStatus } : {}),
      ...(safeMetadataText(source.contentError, 300) ? { contentError: safeMetadataText(source.contentError, 300) } : {}),
      ...(MATERIAL_EXTRACTION_METHODS.includes(source.extractionMethod) ? { extractionMethod: source.extractionMethod } : {}),
      ...(Number.isSafeInteger(source.pageCount) && source.pageCount >= 0 ? { pageCount: Math.min(source.pageCount, 500) } : {}),
      ...(Number.isSafeInteger(source.extractedCharacterCount) && source.extractedCharacterCount >= 0
        ? { extractedCharacterCount: Math.min(source.extractedCharacterCount, 2_000_000) } : {}),
      ...(Number.isFinite(source.recognitionConfidence) && source.recognitionConfidence >= 0 && source.recognitionConfidence <= 100
        ? { recognitionConfidence: Math.round(source.recognitionConfidence) } : {})
    };
    if (Object.prototype.hasOwnProperty.call(source, "unitIds")) {
      entry.unitIds = uniqueTextList(source.unitIds, UNIT_LIMIT, 100);
    }
    return Object.fromEntries(Object.entries(entry).filter(([key]) => SOURCE_FIELDS.has(key)));
  }

  function normalizeSourceMetadata(source) {
    const fields = { provider: 160, accessedAt: 80, license: 300, applicability: 500, limitations: 500 };
    return Object.fromEntries(Object.entries(fields)
      .map(([field, limit]) => [field, safeMetadataText(source[field], limit)])
      .filter(([, value]) => value));
  }

  function normalizeWritingStyleSample(input) {
    const source = isObject(input) ? input : {};
    const sample = {
      sourceArticleId: text(source.sourceArticleId, 100),
      excerpt: text(source.excerpt, 1200),
      features: textList(source.features, 12, 160)
    };
    return Object.fromEntries(Object.entries(sample).filter(([key]) => STYLE_SAMPLE_FIELDS.has(key)));
  }

  function normalizeWritingStyleProfile(input) {
    const source = isObject(input) ? input : {};
    const profile = {
      id: text(source.id, 100),
      source: STYLE_PROFILE_SOURCES.includes(source.source) ? source.source : "",
      confidence: STYLE_CONFIDENCE.includes(source.confidence) ? source.confidence : "low",
      userCorrections: text(source.userCorrections, 2000),
      scope: MEMORY_SCOPES.includes(source.scope) ? source.scope : "article",
      genre: WRITING_GENRES.includes(source.genre) ? source.genre : "",
      traits: textList(source.traits, 20, 160),
      samples: Array.isArray(source.samples)
        ? source.samples.slice(0, 5).map(normalizeWritingStyleSample).filter(item => item.sourceArticleId || item.excerpt || item.features.length)
        : [],
      sourceArticleIds: textList(source.sourceArticleIds, 20, 100),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    return Object.fromEntries(Object.entries(profile).filter(([key]) => STYLE_PROFILE_FIELDS.has(key)));
  }

  function normalizeWritingMemory(input) {
    const source = isObject(input) ? input : {};
    const memory = {
      id: text(source.id, 100),
      scope: MEMORY_SCOPES.includes(source.scope) ? source.scope : "general",
      genre: WRITING_GENRES.includes(source.genre) ? source.genre : "",
      projectId: text(source.projectId, 100),
      articleId: text(source.articleId, 100),
      sourceArticleId: text(source.sourceArticleId, 100),
      preference: text(source.preference),
      reason: text(source.reason, 1000),
      evidenceArticleIds: textList(source.evidenceArticleIds, 20, 100),
      undo: normalizeUndo(source.undo),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    for (const field of ["example", "counterexample", "sourcePreferenceKey"]) {
      if (Object.prototype.hasOwnProperty.call(source, field)) memory[field] = text(source[field]);
    }
    return Object.fromEntries(Object.entries(memory).filter(([key]) => MEMORY_FIELDS.has(key)));
  }

  function normalizeWritingWorkspace(input) {
    const source = isObject(input) ? input : {};
    const genre = WRITING_GENRES.includes(source.genre) ? source.genre : (source.genre === undefined ? "article" : "");
    const articleInput = isObject(source.article) ? source.article : {};
    const workspace = {
      id: text(source.id, 100),
      genre,
      article: normalizeWritingArticle({
        ...articleInput,
        genre: articleInput.genre === undefined ? source.genre : articleInput.genre
      }),
      rounds: Array.isArray(source.rounds)
        ? source.rounds.slice(-ROUND_LIMIT).map(normalizeWritingRound).filter(round => round.id || round.draft
          || round.feedback || round.userFeedback || round.revisionNote || round.diagnosis || round.prompt
          || round.sources.length || round.materials.length || round.preferences?.length || round.promptVersions?.length
          || Object.keys(round.undo).length)
        : [],
      styleProfile: normalizeWritingStyleProfile(source.styleProfile),
      styleProfiles: Array.isArray(source.styleProfiles)
        ? source.styleProfiles.slice(0, 3).map(normalizeWritingStyleProfile)
        : [],
      memory: normalizeWritingMemory(source.memory),
      memories: Array.isArray(source.memories)
        ? source.memories.slice(0, 30).map(normalizeWritingMemory).filter(memory => memory.id || memory.preference)
        : [],
      sourceArticleIds: textList(source.sourceArticleIds, 20, 100),
      createdAt: text(source.createdAt, 80),
      updatedAt: text(source.updatedAt, 80)
    };
    if (Object.prototype.hasOwnProperty.call(source, "units")) {
      const seenUnitIds = new Set();
      workspace.units = (Array.isArray(source.units) ? source.units : []).slice(0, UNIT_LIMIT)
        .map((unit, index) => normalizeWritingUnit(unit, index))
        .filter(unit => {
          if (!unit.id || seenUnitIds.has(unit.id)) return false;
          seenUnitIds.add(unit.id);
          return true;
        });
    }
    if (Object.prototype.hasOwnProperty.call(source, "issues")) {
      const seenIssueIds = new Set();
      workspace.issues = (Array.isArray(source.issues) ? source.issues : []).slice(-ISSUE_LIMIT)
        .map(normalizeWritingIssue)
        .filter(issue => {
          if (!issue.id || seenIssueIds.has(issue.id)) return false;
          seenIssueIds.add(issue.id);
          return true;
        });
    }
    if (Object.prototype.hasOwnProperty.call(source, "routeProgress")) {
      workspace.routeProgress = normalizeRouteSnapshot(source.routeProgress);
    }
    if (Object.prototype.hasOwnProperty.call(source, "longform")) {
      const longform = normalizeLongform(source.longform);
      if (longform && longform.mode === genre) workspace.longform = longform;
    }
    if (Object.prototype.hasOwnProperty.call(source, "materialCoverage")
      && typeof coverageApi?.normalizeCoverageSnapshot === "function") {
      const coverage = coverageApi.normalizeCoverageSnapshot(source.materialCoverage);
      if (coverage) workspace.materialCoverage = coverage;
    }
    return Object.fromEntries(Object.entries(workspace).filter(([key]) => WORKSPACE_FIELDS.has(key)));
  }

  return {
    WRITING_GENRES,
    WRITING_GENRE_CONFIGS,
    getWritingGenreConfig,
    MATERIAL_PURPOSES,
    STYLE_PROFILE_SOURCES,
    STYLE_CONFIDENCE,
    MEMORY_SCOPES,
    UNIT_TYPES,
    ISSUE_JUDGMENTS,
    ISSUE_STATUSES,
    ISSUE_PRIORITIES,
    ROUTE_STEP_STATUSES,
    normalizeWritingArticle,
    normalizeWritingRound,
    normalizeWritingUnit,
    normalizeWritingIssue,
    normalizeWritingStyleProfile,
    normalizeWritingMemory,
    normalizeWritingPackSnapshot,
    normalizeWritingWorkspace,
    normalizeLongform,
    LONGFORM_MODES,
    LONGFORM_ITEM_STATUSES,
    FORESHADOWING_STATUSES,
    IMPACT_STATUSES
  };
});
