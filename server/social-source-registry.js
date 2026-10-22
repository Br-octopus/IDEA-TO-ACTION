const { createHash } = require('node:crypto');

const SOURCE_ID = 'mediacrawler-lite';
const SOCIAL_SOURCE_ARTIFACT_ROOT = 'server/social-source-artifacts';
const PROTOCOL_VERSION = 1;
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const TASK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const CAPABILITIES = Object.freeze(['health', 'session', 'detail', 'comments']);
const SOCIAL_SOURCE_ERROR_MESSAGES = Object.freeze({
  PERMISSION_DENIED: '当前账号或连接没有访问该内容的权限。',
  PAGE_STRUCTURE_CHANGED: '平台页面或响应结构已变化，无法按当前规则读取。'
});
const SOCIAL_SOURCE_ERROR_CODES = Object.freeze(Object.keys(SOCIAL_SOURCE_ERROR_MESSAGES));

const source = Object.freeze({
  id: SOURCE_ID,
  name: 'MediaCrawler 固定适配器',
  version: '1.1.0',
  repository: 'https://github.com/NanmiCoder/MediaCrawler',
  revision: '8f583999006d5b692272c608440e193ca282e73b',
  license: '非商业学习使用许可证 1.1（项目已取得明确复用与修改授权）',
  available: true,
  platforms: Object.freeze(['xiaohongshu', 'bilibili', 'weibo', 'zhihu']),
  capabilities: Object.freeze({
    xiaohongshu: CAPABILITIES,
    bilibili: CAPABILITIES,
    weibo: CAPABILITIES,
    zhihu: Object.freeze(['health', 'detail'])
  }),
  errorCodes: SOCIAL_SOURCE_ERROR_CODES,
  protocolVersion: PROTOCOL_VERSION,
  entryPoint: 'vendor/mediacrawler-bridge/bridge.py',
  requirementsLockPath: 'vendor/mediacrawler/requirements.lock',
  requirementsLockSha256: 'b68744b29e4843cce729531935ee8253a59d6292abf6ae21776d95daaaae6e45',
  pythonVersion: '3.11',
  uvInstaller: Object.freeze({
    version: '0.13.2',
    windowsX64: Object.freeze({
      url: 'https://github.com/astral-sh/uv/releases/download/0.13.2/uv-x86_64-pc-windows-msvc.zip',
      sha256: '9cfb447a4027550f134753253fdffbcd35b79a66dd888260bf6776891916069e'
    })
  }),
  browserAutomation: Object.freeze({
    package: 'playwright',
    version: '1.64.0',
    license: 'Apache-2.0',
    source: 'https://pypi.org/project/playwright/1.64.0/',
    browser: 'chromium',
    installDirectory: 'social-source/browsers'
  })
});

const bilibiliTranscriptCandidate = Object.freeze({
  id: 'bilibili-mcp-transcript-candidate',
  name: 'B 站字幕 MCP（候选）',
  repository: 'https://github.com/XZXZZX-Ai/bilibili-mcp',
  version: '1.14.3',
  license: 'Apache-2.0',
  runtime: Object.freeze({ name: 'Node.js', minimumVersion: '20' }),
  platforms: Object.freeze(['bilibili']),
  capabilities: Object.freeze({ bilibili: Object.freeze(['get_video_transcript']) }),
  readOnly: true,
  available: false,
  status: 'unavailable-candidate',
  policy: Object.freeze({ force_asr: false, fallbacks: false, validateDataSource: true, validateTimestamps: true }),
  unavailableReason: '当前来源管理器只支持固定 MediaCrawler Python 适配器；尚未接入并验证该 Node.js MCP 的安全启动、只读工具白名单及字幕元数据校验。'
});

// 仅可登记 server/social-source-artifacts/ 下随应用打包、逐文件锁定摘要的候选版本。
// 当前发行内容没有候选项，不能从用户输入或运行时 URL 增补来源。
const approvedVersionCandidates = Object.freeze([]);

function computeSourceSnapshotSha256(files) {
  const canonical = [...files]
    .map(file => ({ path: file.path, sha256: file.sha256.toLowerCase() }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
    .map(file => `${file.path}\0${file.sha256}\n`)
    .join('');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function getSocialSourceVersion(sourceId, version) {
  if (sourceId !== SOURCE_ID) {
    throw Object.assign(new Error('未登记的采集来源'), { code: 'UNSUPPORTED_SOURCE' });
  }
  if (version === source.version) return source;
  const candidate = approvedVersionCandidates.find(item => item.source.version === version);
  if (!candidate) throw Object.assign(new Error('未批准的来源版本'), { code: 'VERSION_NOT_APPROVED' });
  return candidate.source;
}

function listApprovedSocialSourceCandidates(sourceId) {
  if (sourceId !== SOURCE_ID) {
    throw Object.assign(new Error('未登记的采集来源'), { code: 'UNSUPPORTED_SOURCE' });
  }
  return approvedVersionCandidates.map(item => item.source);
}

function invalidRequest(message = '来源请求参数无效') {
  return Object.assign(new TypeError(message), { code: 'INVALID_REQUEST' });
}

function getSocialSource(sourceId) {
  if (sourceId !== SOURCE_ID) {
    throw Object.assign(new Error('未登记的采集来源'), { code: 'UNSUPPORTED_SOURCE' });
  }
  return source;
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every(key => keys.includes(key));
}

function validateContentId(platform, action, value) {
  if (!['detail', 'comments'].includes(action)) {
    if (value !== null) throw invalidRequest();
    return null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidRequest();
  if (platform === 'xiaohongshu') {
    const allowed = ['noteId', 'xsecSource', 'xsecToken', 'cursor'];
    if (Object.keys(value).some(key => !allowed.includes(key))
      || typeof value.noteId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.noteId)) throw invalidRequest();
    for (const key of ['xsecSource', 'xsecToken', 'cursor']) {
      if (value[key] != null && (typeof value[key] !== 'string' || value[key].length > 512
        || /[\r\n\0]/.test(value[key]))) throw invalidRequest();
    }
    return Object.freeze({ ...value });
  }

  if (platform === 'weibo') {
    if (Object.keys(value).some(key => !['postId', 'cursor'].includes(key))
      || typeof value.postId !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(value.postId)
      || (value.cursor != null && (typeof value.cursor !== 'string'
        || value.cursor.length > 64 || !/^[0-9]*$/.test(value.cursor) || action !== 'comments'))) {
      throw invalidRequest();
    }
    return Object.freeze({ ...value });
  }

  if (platform === 'zhihu') {
    if (action !== 'detail') throw invalidRequest();
    const answer = Object.keys(value).length === 2
      && typeof value.questionId === 'string' && /^[1-9][0-9]{0,29}$/.test(value.questionId)
      && typeof value.answerId === 'string' && /^[1-9][0-9]{0,29}$/.test(value.answerId);
    const article = Object.keys(value).length === 1
      && typeof value.articleId === 'string' && /^[1-9][0-9]{0,29}$/.test(value.articleId);
    if (!answer && !article) throw invalidRequest();
    return Object.freeze({ ...value });
  }

  const allowed = ['bvid', 'aid', 'cursor'];
  if (Object.keys(value).some(key => !allowed.includes(key))
    || Boolean(value.bvid) === Boolean(value.aid)) throw invalidRequest();
  if (value.bvid != null && (typeof value.bvid !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(value.bvid))) throw invalidRequest();
  if (value.aid != null && !(typeof value.aid === 'string' && /^[1-9][0-9]{0,19}$/.test(value.aid)
    || Number.isSafeInteger(value.aid) && value.aid > 0)) throw invalidRequest();
  if (value.cursor != null && !(typeof value.cursor === 'string' && value.cursor.length <= 128
    && !/[\r\n\0]/.test(value.cursor) || Number.isSafeInteger(value.cursor) && value.cursor >= 0)) throw invalidRequest();
  if (value.cursor != null && action !== 'comments') throw invalidRequest();
  return Object.freeze({ ...value });
}

function validateSourceRequest(value, { now = Date.now() } = {}) {
  const keys = ['requestId', 'protocolVersion', 'sourceId', 'action', 'capability', 'platform', 'profileId', 'taskId', 'contentId', 'budget'];
  if (!hasExactKeys(value, keys)) throw invalidRequest();
  if (typeof value.requestId !== 'string' || typeof value.taskId !== 'string'
    || typeof value.profileId !== 'string' || typeof value.platform !== 'string'
    || typeof value.action !== 'string' || typeof value.capability !== 'string'
    || value.sourceId !== SOURCE_ID || value.protocolVersion !== PROTOCOL_VERSION
    || !REQUEST_ID_PATTERN.test(value.requestId) || !TASK_ID_PATTERN.test(value.taskId)
    || !PROFILE_ID_PATTERN.test(value.profileId) || !source.platforms.includes(value.platform)
    || !CAPABILITIES.includes(value.action) || value.capability !== value.action
    || !source.capabilities[value.platform].includes(value.capability)) throw invalidRequest();
  if (!hasExactKeys(value.budget, ['maxRequests', 'maxItems', 'deadlineAt'])) throw invalidRequest();
  if (typeof value.budget.deadlineAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.budget.deadlineAt)) throw invalidRequest();
  const deadline = Date.parse(value.budget.deadlineAt);
  if (!Number.isInteger(value.budget.maxRequests) || value.budget.maxRequests < 1 || value.budget.maxRequests > 10
    || !Number.isInteger(value.budget.maxItems) || value.budget.maxItems < 1 || value.budget.maxItems > 20
    || !Number.isFinite(deadline) || deadline <= now || deadline > now + 15 * 60_000) throw invalidRequest();

  const contentId = validateContentId(value.platform, value.action, value.contentId);
  return Object.freeze({
    requestId: value.requestId,
    protocolVersion: PROTOCOL_VERSION,
    sourceId: SOURCE_ID,
    action: value.action,
    capability: value.capability,
    platform: value.platform,
    profileId: value.profileId,
    taskId: value.taskId,
    contentId,
    budget: Object.freeze({
      maxRequests: value.budget.maxRequests,
      maxItems: value.budget.maxItems,
      deadlineAt: new Date(deadline).toISOString()
    })
  });
}

module.exports = {
  PROTOCOL_VERSION,
  SOCIAL_SOURCE_ID: SOURCE_ID,
  SOCIAL_SOURCE_ARTIFACT_ROOT,
  SOCIAL_SOURCE_ERROR_CODES,
  SOCIAL_SOURCE_ERROR_MESSAGES,
  getSocialSource,
  getSocialSourceVersion,
  listApprovedSocialSourceCandidates,
  computeSourceSnapshotSha256,
  listSocialSources: () => [source, bilibiliTranscriptCandidate],
  BILIBILI_TRANSCRIPT_CANDIDATE: bilibiliTranscriptCandidate,
  validateSourceRequest
};
