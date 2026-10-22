const { normalizeSocialResult, resolveDomesticContentId } = require('../prototype/social-research-schema.js');
const { parseSocialContentUrl } = require('./social-content-url.js');

// 固定页面脚本只读取已知结果容器，并识别明确的登录、验证和限流提示。
const PAGE_SCRIPTS = Object.freeze({
  'xiaohongshu.login': () => {
    if (document.querySelector('iframe[src*="captcha"], [class*="captcha-container"], [class*="verify-container"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="rate-limit"], [class*="too-frequent"], [class*="limit-tips"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('[class*="login-modal"], [class*="login-dialog"], [class*="login-container"]')) return { supported: true, code: 'LOGIN_REQUIRED' };
    if (document.querySelector('[data-testid="user-avatar"], a[href^="/user/profile/"] img, .user-avatar img')) return { supported: true, loginState: 'logged-in' };
    if (document.querySelector('a[href*="/login"], button[class*="login"]')) return { supported: true, loginState: 'logged-out' };
    return { supported: true, loginState: 'unknown' };
  },
  'xiaohongshu.search': () => {
    if (document.querySelector('iframe[src*="captcha"], [class*="captcha-container"], [class*="verify-container"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="rate-limit"], [class*="too-frequent"], [class*="limit-tips"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('[class*="login-modal"], [class*="login-dialog"], [class*="login-container"]')) return { supported: true, code: 'LOGIN_REQUIRED' };
    const cards = [...document.querySelectorAll('section.note-item, [class*="note-item"], [class*="noteItem"], [data-testid*="note-card"], [data-testid*="note-item"]')];
    const root = document.querySelector('[class*="search-result"], [class*="result-list"], [data-testid*="search-result"]');
    const empty = document.querySelector('[class*="search-empty"], [class*="no-result"], [class*="noResult"]');
    if (!cards.length && empty) return { supported: true, empty: true, items: [] };
    if (!cards.length) return { supported: false, pending: document.readyState !== 'complete' || Boolean(root?.querySelector('[class*="loading"], [aria-busy="true"]')) };
    return { supported: true, items: cards.map(card => ({
      title: card.querySelector('[class*="title"], [class*="Title"], h3, h4')?.innerText?.trim(),
      url: card.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"], a[href]')?.href,
      author: card.querySelector('[class*="author"], [class*="nickname"], [class*="user-name"]')?.innerText?.trim(),
      summary: card.querySelector('[class*="desc"], [class*="content"]')?.innerText?.trim()
    })) };
  },
  'bilibili.login': () => {
    if (document.querySelector('iframe[src*="captcha"], .geetest_panel, [class*="verify-dialog"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="rate-limit"], [class*="too-frequent"], [class*="request-limit"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('.bili-login-mask, [class*="login-modal"], [class*="login-tip"]')) return { supported: true, code: 'LOGIN_REQUIRED' };
    if (document.querySelector('#i_user a[href*="/space/"], .header-avatar-wrap img, [data-testid="user-avatar"]')) return { supported: true, loginState: 'logged-in' };
    if (document.querySelector('.header-login-entry, a[href*="passport.bilibili.com/login"]')) return { supported: true, loginState: 'logged-out' };
    return { supported: true, loginState: 'unknown' };
  },
  'bilibili.search': () => {
    if (document.querySelector('iframe[src*="captcha"], .geetest_panel, [class*="verify-dialog"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="rate-limit"], [class*="too-frequent"], [class*="request-limit"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('.bili-login-mask, [class*="login-modal"], [class*="login-tip"]')) return { supported: true, code: 'LOGIN_REQUIRED' };
    const cards = [...document.querySelectorAll('.bili-video-card, li.video-item, .video-list li')];
    const root = document.querySelector('.video-list, .search-page, #i_cecream');
    const empty = document.querySelector('.search-empty-wrap, .no-result, [class*="no-result"]');
    if (!cards.length && empty) return { supported: true, empty: true, items: [] };
    if (!cards.length) return { supported: false, pending: document.readyState !== 'complete' || Boolean(root?.querySelector('[class*="loading"], [aria-busy="true"]')) };
    return { supported: true, items: cards.map(card => ({
      title: card.querySelector('.bili-video-card__title, .title, a[title]')?.innerText?.trim() || card.querySelector('.bili-video-card__title, .title, a[title]')?.getAttribute('title'),
      url: card.querySelector('a[href*="/video/"]')?.href,
      author: card.querySelector('.bili-video-card__author, .up-name, .author')?.innerText?.trim(),
      summary: card.querySelector('.bili-video-card__desc, .des, .description')?.innerText?.trim()
    })) };
  },
  'weibo.login': () => {
    if (document.querySelector('iframe[src*="captcha"], #pl_login_form [class*="verify"], [class*="verify-layer"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="rate-limit"], [class*="too-frequent"], [class*="request-limit"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('#pl_login_form, [class*="login-modal"], [class*="login-dialog"]')) return { supported: true, code: 'LOGIN_REQUIRED' };
    if (document.querySelector('.gn_name, [node-type="loginname"]')) return { supported: true, loginState: 'logged-in' };
    if (document.querySelector('a[href*="login.php"], .gn_login')) return { supported: true, loginState: 'logged-out' };
    return { supported: true, loginState: 'unknown' };
  },
  'weibo.search': () => {
    if (document.querySelector('iframe[src*="captcha"], #pl_login_form [class*="verify"], [class*="verify-layer"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="rate-limit"], [class*="too-frequent"], [class*="request-limit"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('#pl_login_form, [class*="login-modal"], [class*="login-dialog"]')) return { supported: true, code: 'LOGIN_REQUIRED' };
    const cards = [...document.querySelectorAll('.card-wrap[action-type="feed_list_item"], .card-wrap')];
    const root = document.querySelector('#pl_feedlist_index, [node-type="feed_list"], .m-main');
    const empty = document.querySelector('.card-no-result, .WB_empty');
    if (!cards.length && empty) return { supported: true, empty: true, items: [] };
    if (!cards.length) return { supported: false, pending: document.readyState !== 'complete' || Boolean(root?.querySelector('[class*="loading"], [aria-busy="true"]')) };
    const text = node => String(node?.innerText || node?.textContent || '').trim();
    return { supported: true, items: cards.map(card => {
      const content = card.querySelector('[node-type="feed_list_content"], .txt, [class*="content"]');
      const link = card.querySelector('a[node-type="feed_list_item_date"], .from a[href], a[href*="weibo.com/"]');
      return { title: text(content), url: link?.href || link?.getAttribute('href') || '', author: text(card.querySelector('.name, [class*="name"]')), summary: text(content), publishedAt: link?.getAttribute('title') || '' };
    }) };
  },
  'zhihu.login': () => {
    if (document.querySelector('iframe[src*="captcha"], [class*="Captcha"], [class*="HumanVerify"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="RateLimit"], [class*="rate-limit"], [class*="TooManyRequest"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('.SignFlow, [class*="SignFlowModal"], [class*="login-dialog"]')) return { supported: true, code: 'LOGIN_REQUIRED' };
    if (document.querySelector('.Avatar, [data-za-detail-view-element_name="User"] img')) return { supported: true, loginState: 'logged-in' };
    if (document.querySelector('a[href*="/signin"], button[aria-label*="登录"]')) return { supported: true, loginState: 'logged-out' };
    return { supported: true, loginState: 'unknown' };
  },
  'zhihu.search': () => {
    if (document.querySelector('iframe[src*="captcha"], [class*="Captcha"], [class*="HumanVerify"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="RateLimit"], [class*="rate-limit"], [class*="TooManyRequest"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('.SignFlow, [class*="SignFlowModal"], [class*="login-dialog"]')) return { supported: true, code: 'LOGIN_REQUIRED' };
    const root = document.querySelector('.SearchResultApp, [class*="SearchResultApp"]');
    const cards = [...document.querySelectorAll('.SearchResult-Card, .List-item .ContentItem')];
    const empty = document.querySelector('.SearchResult-Empty, [class*="SearchResultEmpty"]');
    if (!cards.length && empty) return { supported: true, empty: true, items: [] };
    if (!cards.length) return { supported: false, pending: document.readyState !== 'complete' || Boolean(root?.querySelector('[class*="Loading"], [aria-busy="true"]')) };
    const text = node => String(node?.innerText || node?.textContent || '').trim();
    return { supported: true, items: cards.map(card => {
      const link = card.querySelector('a[href*="/question/"], a[href*="zhuanlan.zhihu.com/p/"]');
      return { title: text(card.querySelector('.ContentItem-title, .Highlight, h2, h3')), url: link?.href || link?.getAttribute('href') || '', author: text(card.querySelector('.AuthorInfo-name, [class*="AuthorInfo"] [class*="name"]')), summary: text(card.querySelector('.RichContent-inner, .SearchResult-Content, [class*="RichContent"]')) };
    }) };
  },
  'reddit.login': () => {
    if (document.querySelector('iframe[src*="captcha"], [class*="captcha"], [class*="verification"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="rate-limit"], [class*="too-frequent"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('shreddit-login, [data-testid="login-modal"]')) return { supported: true, code: 'LOGIN_REQUIRED' };
    if (document.querySelector('shreddit-header-action[aria-label*="profile" i]')) return { supported: true, loginState: 'logged-in' };
    if (document.querySelector('a[href*="/login"], button[aria-label*="log in" i]')) return { supported: true, loginState: 'logged-out' };
    return { supported: true, loginState: 'unknown' };
  },
  'reddit.search': () => {
    if (document.querySelector('iframe[src*="captcha"], [class*="captcha"], [class*="verification"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="rate-limit"], [class*="too-frequent"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('shreddit-login, [data-testid="login-modal"]')) return { supported: true, code: 'LOGIN_REQUIRED' };
    const cards = [...document.querySelectorAll('shreddit-post, [data-testid="search-post-unit"]')];
    const root = document.querySelector('faceplate-partial, [data-testid*="search"]');
    const empty = document.querySelector('faceplate-empty-state, [data-testid*="empty"], [class*="no-results"]');
    if (!cards.length && empty) return { supported: true, empty: true, items: [] };
    if (!cards.length) return { supported: false, pending: document.readyState !== 'complete' || Boolean(root?.querySelector('[class*="loading"], [aria-busy="true"]')) };
    return { supported: true, items: cards.map(card => ({ title: card.getAttribute('post-title') || card.querySelector('a[slot="title"], h3')?.innerText?.trim(), url: card.getAttribute('permalink') || card.querySelector('a[href*="/comments/"]')?.href, author: card.getAttribute('author'), summary: card.querySelector('[slot="text-body"], [data-testid="post-content"]')?.innerText?.trim() })) };
  },
  'youtube.login': () => {
    if (document.querySelector('iframe[src*="captcha"], [class*="captcha"], [class*="verification"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="rate-limit"], [class*="too-frequent"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('ytd-popup-container tp-yt-paper-dialog, ytd-button-renderer a[href*="accounts.google.com"]')) return { supported: true, code: 'LOGIN_REQUIRED' };
    if (document.querySelector('ytd-topbar-menu-button-renderer #avatar-btn, #avatar-btn img')) return { supported: true, loginState: 'logged-in' };
    if (document.querySelector('ytd-button-renderer a[href*="accounts.google.com"]')) return { supported: true, loginState: 'logged-out' };
    return { supported: true, loginState: 'unknown' };
  },
  'youtube.search': () => {
    if (document.querySelector('iframe[src*="captcha"], [class*="captcha"], [class*="verification"]')) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (document.querySelector('[class*="rate-limit"], [class*="too-frequent"]')) return { supported: true, code: 'RATE_LIMITED' };
    if (document.querySelector('ytd-popup-container tp-yt-paper-dialog')) return { supported: true, code: 'LOGIN_REQUIRED' };
    const cards = [...document.querySelectorAll('ytd-video-renderer')];
    const root = document.querySelector('ytd-search[has-results], #section-list');
    const emptyMarker = document.querySelector('#zero-results');
    const empty = Boolean(emptyMarker);
    if (!cards.length && empty) return { supported: true, empty: true, items: [] };
    if (!cards.length) return { supported: false, pending: document.readyState !== 'complete' || Boolean(root?.querySelector('[class*="loading"], [aria-busy="true"]')) };
    return { supported: true, items: cards.map(card => ({ title: card.querySelector('#video-title')?.textContent?.trim(), url: card.querySelector('#video-title')?.href, author: card.querySelector('#channel-name a')?.textContent?.trim(), summary: card.querySelector('#description-text')?.textContent?.trim() })) };
  }
});

const PLATFORM_CONFIG = Object.freeze({
  xiaohongshu: { searchUrl: query => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`, loginScript: 'xiaohongshu.login', searchScript: 'xiaohongshu.search' },
  bilibili: { searchUrl: query => `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`, loginScript: 'bilibili.login', searchScript: 'bilibili.search' },
  weibo: { searchUrl: query => `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`, loginScript: 'weibo.login', searchScript: 'weibo.search' },
  zhihu: { searchUrl: query => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`, loginScript: 'zhihu.login', searchScript: 'zhihu.search' },
  reddit: { searchUrl: query => `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`, loginScript: 'reddit.login', searchScript: 'reddit.search' },
  youtube: { searchUrl: query => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, loginScript: 'youtube.login', searchScript: 'youtube.search' }
});
const LEGACY_RESULT_HOSTS = Object.freeze({
  reddit: new Set(['www.reddit.com', 'reddit.com']),
  youtube: new Set(['www.youtube.com', 'youtube.com'])
});
const CONTENT_PLATFORMS = new Set(['xiaohongshu', 'bilibili', 'weibo', 'zhihu']);
const LOGIN_STATES = new Set(['unknown', 'logged-in', 'logged-out', 'login-required', 'restricted']);
const PAGE_ERROR_MESSAGES = Object.freeze({
  LOGIN_REQUIRED: '该平台要求登录后才能继续搜索。',
  RESTRICTED: '该平台当前限制了此连接。',
  MANUAL_VERIFICATION_REQUIRED: '该平台要求人工完成安全验证。',
  RATE_LIMITED: '该平台暂时限制了访问频率。',
  UNSUPPORTED_PAGE: '平台页面结构暂不支持。',
  PAGE_NOT_READY: '平台搜索结果在等待时间内未就绪。',
  SESSION_CLOSED: '平台浏览器已关闭。',
  SESSION_NOT_FOUND: '尚未打开该平台浏览器。',
  SESSION_BUSY: '该平台浏览器正在执行其他操作。',
  PAGE_READ_FAILED: '无法读取平台页面。',
  NAVIGATION_FAILED: '平台页面导航失败。',
  NAVIGATION_TIMEOUT: '平台页面加载超时；浏览器已关闭，请重新检查连接。',
  SCRIPT_TIMEOUT: '平台页面读取超时；浏览器已关闭，请重新检查连接。',
  BUDGET_EXCEEDED: '研究任务已达到 maxDurationMs。'
});
const PAGE_ERROR_CODES = new Set(Object.keys(PAGE_ERROR_MESSAGES));
const MAX_SEARCH_READ_ATTEMPTS = 8;
const SEARCH_READ_INTERVAL_MS = 200;

function unsupported(operation) {
  return { status: 'unsupported', operation, code: 'UNSUPPORTED' };
}

function parseLegacyContentUrl(platform, value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !LEGACY_RESULT_HOSTS[platform]?.has(url.hostname.toLowerCase())) return null;
    if (platform === 'reddit') {
      const contentId = url.pathname.match(/^\/r\/[A-Za-z0-9_]+\/comments\/([A-Za-z0-9]+)(?:\/|$)/)?.[1] || '';
      return contentId ? { url: url.href, contentId } : null;
    }
    const contentId = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]+)\/?$/)?.[1]
      || (url.pathname === '/watch' ? url.searchParams.get('v') : '') || '';
    return /^[A-Za-z0-9_-]+$/.test(contentId) ? { url: url.href, contentId } : null;
  } catch {
    return null;
  }
}

function isRegisteredSearchAdapter(platform) {
  const config = PLATFORM_CONFIG[platform];
  return Boolean(config && typeof PAGE_SCRIPTS[config.searchScript] === 'function');
}

function createBrowserPlatformAdapters({
  manager,
  now = () => new Date().toISOString(),
  nowMs = () => globalThis.performance?.now?.() ?? Date.now(),
  maxSearchReadAttempts = MAX_SEARCH_READ_ATTEMPTS,
  searchReadIntervalMs = SEARCH_READ_INTERVAL_MS
}) {
  if (!manager) throw new TypeError('manager 为必需依赖');
  const readAttempts = Number.isInteger(maxSearchReadAttempts)
    ? Math.max(1, Math.min(MAX_SEARCH_READ_ATTEMPTS, maxSearchReadAttempts)) : MAX_SEARCH_READ_ATTEMPTS;
  const readIntervalMs = Number.isFinite(searchReadIntervalMs)
    ? Math.max(0, Math.min(500, searchReadIntervalMs)) : SEARCH_READ_INTERVAL_MS;

  return Object.freeze(Object.fromEntries(Object.entries(PLATFORM_CONFIG)
    .filter(([platform]) => isRegisteredSearchAdapter(platform))
    .map(([platform, config]) => {
      let sessionId = '';
      const errorResponse = (code, extra = {}) => ({ status: 'error', code, message: PAGE_ERROR_MESSAGES[code] || PAGE_ERROR_MESSAGES.PAGE_READ_FAILED, platform, ...extra });
      const createDeadline = timeoutMs => Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
        ? nowMs() + Number(timeoutMs) : Infinity;
      const remainingTimeout = deadline => {
        if (deadline === Infinity) return undefined;
        const remaining = Math.ceil(deadline - nowMs());
        if (remaining <= 0) throw Object.assign(new Error(PAGE_ERROR_MESSAGES.BUDGET_EXCEEDED), { code: 'BUDGET_EXCEEDED' });
        return remaining;
      };

      async function read(scriptName, args, actions, timeoutMs) {
        try {
          const execute = actions?.executeReadOnlyScript
            ? (name, value, options) => actions.executeReadOnlyScript(name, value, options)
            : (name, value, options) => manager.executeReadOnlyScript(sessionId, name, value, options);
          const result = await execute(scriptName, args, { timeoutMs });
          if (PAGE_ERROR_CODES.has(result?.code)) return { status: 'ok', data: result };
          if (!result || (result.supported !== true && result.pending !== true)) {
            return { status: 'error', code: 'UNSUPPORTED_PAGE', message: PAGE_ERROR_MESSAGES.UNSUPPORTED_PAGE };
          }
          return { status: 'ok', data: result };
        } catch (error) {
          const code = PAGE_ERROR_CODES.has(error?.code) ? error.code : 'PAGE_READ_FAILED';
          return { status: 'error', code, message: PAGE_ERROR_MESSAGES[code] };
        }
      }

      function runExclusive(action) {
        if (typeof manager.runSessionAction === 'function') return manager.runSessionAction(sessionId, action);
        return action({
          navigateSession: (value, options) => manager.navigateSession(sessionId, value, options),
          executeReadOnlyScript: (name, args, options) => manager.executeReadOnlyScript(sessionId, name, args, options)
        });
      }

      function checkFailure(code) {
        const browserStatus = ['SESSION_CLOSED', 'SESSION_NOT_FOUND'].includes(code) ? 'closed'
          : code === 'SESSION_BUSY' ? 'busy'
            : ['RATE_LIMITED', 'RESTRICTED'].includes(code) ? 'restricted'
              : code === 'MANUAL_VERIFICATION_REQUIRED' ? 'manual-verification' : 'error';
        return {
          ...errorResponse(code), ready: false, browserStatus,
          loginState: code === 'LOGIN_REQUIRED' ? 'login-required' : code === 'RESTRICTED' ? 'restricted' : 'unknown',
          searchVerified: false, checkedAt: now()
        };
      }

      const adapter = {
        async checkReady(options = {}) {
          if (!sessionId) return checkFailure('SESSION_NOT_FOUND');
          const deadline = createDeadline(options.timeoutMs);
          try {
            return await runExclusive(async actions => {
              const response = await read(config.loginScript, {}, actions, remainingTimeout(deadline));
              if (response.status !== 'ok') return checkFailure(response.code);
              const data = response.data;
              if (data.code === 'LOGIN_REQUIRED' || data.loginState === 'login-required') {
                return {
                  status: 'ok', platform, ready: false, browserStatus: 'not-ready', loginState: 'login-required',
                  code: 'LOGIN_REQUIRED', message: PAGE_ERROR_MESSAGES.LOGIN_REQUIRED,
                  searchVerified: false, checkedAt: now()
                };
              }
              if (PAGE_ERROR_CODES.has(data.code)) return checkFailure(data.code);
              const loginState = LOGIN_STATES.has(data.loginState)
                ? data.loginState
                : data.code === 'LOGIN_REQUIRED' ? 'login-required' : 'unknown';
              if (loginState === 'restricted') return checkFailure('RESTRICTED');
              return {
                status: 'ok', platform, ready: true, browserStatus: 'ready', loginState,
                ...(PAGE_ERROR_CODES.has(data.code) ? { code: data.code, message: PAGE_ERROR_MESSAGES[data.code] } : {}),
                searchVerified: false, checkedAt: now()
              };
            });
          } catch (error) {
            const code = PAGE_ERROR_CODES.has(error?.code) ? error.code : 'PAGE_READ_FAILED';
            return checkFailure(code);
          }
        },
        async search(query, options = {}) {
          const normalizedQuery = typeof query === 'string' ? query.trim() : '';
          if (!normalizedQuery) throw new TypeError('搜索词不能为空');
          if (!sessionId) return errorResponse('SESSION_NOT_FOUND');
          const deadline = createDeadline(options.timeoutMs);
          try {
            return await runExclusive(async actions => {
            const startUrl = config.searchUrl(normalizedQuery);
            let navigation;
            try {
              navigation = await actions.navigateSession(startUrl, { timeoutMs: remainingTimeout(deadline) });
            } catch (error) {
              const code = PAGE_ERROR_CODES.has(error?.code) ? error.code : 'NAVIGATION_FAILED';
              return errorResponse(code);
            }
            if (navigation?.status === 'closed') return errorResponse('SESSION_CLOSED');
            if (navigation?.status === 'failed') return errorResponse(navigation.errorCode || 'NAVIGATION_FAILED');

            let response;
            let complete = false;
            for (let attempt = 0; attempt < readAttempts; attempt += 1) {
              response = await read(config.searchScript, {}, actions, remainingTimeout(deadline));
              if (response.status !== 'ok') return errorResponse(response.code);
              const data = response.data;
              if (PAGE_ERROR_CODES.has(data.code)) return errorResponse(data.code);
              if (data.supported === true && Array.isArray(data.items)
                && (data.items.length > 0 || data.empty === true)) {
                complete = true;
                break;
              }
              if (data.pending !== true) return errorResponse('UNSUPPORTED_PAGE');
              if (attempt < readAttempts - 1) {
                const waitMs = remainingTimeout(deadline);
                await new Promise(resolve => setTimeout(resolve, Math.min(readIntervalMs, waitMs ?? readIntervalMs)));
                if (deadline !== Infinity) remainingTimeout(deadline);
              }
            }
            if (!complete) return errorResponse('PAGE_NOT_READY');

            const candidates = [];
            for (const item of response.data.items) {
              if (!item || typeof item.title !== 'string' || !item.title.trim()) continue;
              const parsed = CONTENT_PLATFORMS.has(platform)
                ? parseSocialContentUrl(platform, item.url, { allowRelative: true })
                : parseLegacyContentUrl(platform, item.url, startUrl);
              if (!parsed) continue;
              const normalized = normalizeSocialResult({
                platform, contentId: parsed.contentId, title: item.title, url: parsed.url,
                author: item.author, publishedAt: item.publishedAt, summary: item.summary,
                contentType: ['bilibili', 'youtube'].includes(platform) ? 'video' : 'post',
                searchQueries: [normalizedQuery], capturedAt: now(),
                retrievalMethod: 'browser', evidenceStatus: 'unverified'
              });
              const xiaohongshuAccess = platform === 'xiaohongshu'
                ? resolveDomesticContentId({ platform, contentId: parsed.contentId, url: parsed.url })
                : null;
              candidates.push(xiaohongshuAccess?.xsecToken
                ? { ...normalized, volatileAccess: { xsecToken: xiaohongshuAccess.xsecToken } }
                : normalized);
            }
            if (response.data.items.length > 0 && candidates.length === 0) return errorResponse('UNSUPPORTED_PAGE');
            const unique = dedupePageResults(candidates);
            const requestedLimit = Number(options.maxResults);
            const maxResults = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 20;
            return { status: 'ok', platform, results: unique.slice(0, maxResults) };
            });
          } catch (error) {
            const code = PAGE_ERROR_CODES.has(error?.code) ? error.code : 'PAGE_READ_FAILED';
            return errorResponse(code);
          }
        },
        async fetchDetail() { return unsupported('detail'); },
        async captureEvidence() { return unsupported('screenshot'); }
      };

      return [platform, Object.freeze({
        ...adapter,
        attachSession(value) { sessionId = typeof value === 'string' ? value : value?.sessionId || ''; }
      })];
    })));
}

function dedupePageResults(results) {
  const merged = [];
  const byContent = new Map();
  const byUrl = new Map();
  for (const result of results) {
    const platform = String(result.platform || '').toLowerCase();
    const url = String(result.url || '');
    const contentKey = result.contentId ? `${platform}:${result.contentId}` : '';
    const urlKey = exactUrlKey(url);
    const exactUrlLookup = `${platform}:${urlKey}`;
    const existingIndex = contentKey && byContent.has(contentKey) ? byContent.get(contentKey)
      : urlKey && byUrl.has(exactUrlLookup) ? byUrl.get(exactUrlLookup) : undefined;
    if (existingIndex !== undefined) {
      const existing = merged[existingIndex];
      existing.searchQueries = [...new Set([...(existing.searchQueries || []), ...(result.searchQueries || [])])];
      if (!existing.contentId && result.contentId) existing.contentId = result.contentId;
      if (!isValidAccessUrl(existing.url) && isValidAccessUrl(result.url)) existing.url = result.url;
      if (contentKey) byContent.set(contentKey, existingIndex);
      if (urlKey) byUrl.set(`${platform}:${urlKey}`, existingIndex);
      continue;
    }
    const index = merged.push({ ...result, searchQueries: [...new Set(result.searchQueries || [])] }) - 1;
    if (contentKey) byContent.set(contentKey, index);
    if (urlKey) byUrl.set(`${platform}:${urlKey}`, index);
  }
  return merged;
}

function isValidAccessUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function exactUrlKey(value) {
  try {
    const url = new URL(value);
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '';
  }
}

module.exports = { createBrowserPlatformAdapters, isRegisteredSearchAdapter, PLATFORM_CONFIG, PAGE_SCRIPTS };
