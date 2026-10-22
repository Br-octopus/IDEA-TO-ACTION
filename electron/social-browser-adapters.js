const { normalizeSocialResult } = require('../prototype/social-research-schema.js');
const { parseSocialContentUrl } = require('./social-content-url.js');

// 页面结构会变化；只有识别到结果卡片或明确空结果标记时才报告搜索受支持。
const PAGE_SCRIPTS = Object.freeze({
  'xiaohongshu.login': () => {
    const manual = document.querySelector('[class*="captcha-container"], [class*="verify-container"], iframe[src*="captcha"]');
    const login = document.querySelector('[class*="login-modal"], [class*="login-dialog"], [class*="login-container"]');
    if (manual) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (login) return { supported: true, code: 'LOGIN_REQUIRED' };
    return { supported: true, loginState: 'unknown' };
  },
  'xiaohongshu.search': () => {
    const manual = document.querySelector('[class*="captcha-container"], [class*="verify-container"], iframe[src*="captcha"]');
    const rate = document.querySelector('[class*="rate-limit"], [class*="too-frequent"], [class*="limit-tips"]');
    const login = document.querySelector('[class*="login-modal"], [class*="login-dialog"], [class*="login-container"]');
    if (manual) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (rate) return { supported: true, code: 'RATE_LIMITED' };
    if (login) return { supported: true, code: 'LOGIN_REQUIRED' };
    const cards = [...document.querySelectorAll('section.note-item, [class*="note-item"], [class*="noteItem"], [data-testid*="note-card"], [data-testid*="note-item"]')];
    const empty = document.querySelector('[class*="search-empty"], [class*="no-result"], [class*="noResult"]');
    if (!cards.length && empty) return { supported: true, empty: true, items: [] };
    if (!cards.length) {
      const pending = Boolean(document.querySelector('[class*="search-result"], [class*="result-list"], [class*="loading"]'));
      return { supported: false, pending };
    }
    const find = (card, selectors) => {
      for (const selector of selectors) {
        const element = card.querySelector(selector);
        if (element) return element;
      }
      return null;
    };
    const text = element => String(element?.innerText || element?.textContent || element?.getAttribute?.('title') || '').trim();
    return { supported: true, items: cards.map(card => {
      const title = find(card, ['[class*="title"]', '[class*="Title"]', 'h3', 'h4']);
      const link = find(card, ['a[href*="/explore/"]', 'a[href*="/discovery/item/"]', 'a[href]']);
      const author = find(card, ['[class*="author"]', '[class*="nickname"]', '[class*="user-name"]', '[class*="name"]']);
      const summary = find(card, ['[class*="desc"]', '[class*="content"]']);
      return {
        title: text(title),
        url: link?.href || link?.getAttribute?.('href') || '',
        author: text(author),
        summary: text(summary)
      };
    }) };
  },
  'reddit.login': () => {
    const loggedIn = Boolean(document.querySelector('a[href*="/user/"], shreddit-header-action[aria-label*="profile" i]'));
    const loginPrompt = Boolean(document.querySelector('a[href*="/login"], button[aria-label*="log in" i]'));
    return { ready: loggedIn && !loginPrompt, supported: loggedIn || loginPrompt };
  },
  'reddit.search': () => {
    const cards = [...document.querySelectorAll('shreddit-post, [data-testid="search-post-unit"]')];
    const container = document.querySelector('faceplate-partial, [data-testid*="search"]');
    const empty = document.querySelector('faceplate-empty-state, [data-testid*="empty"], [class*="no-results"]');
    if (!cards.length && empty) return { supported: true, items: [] };
    if (!cards.length || !container) return { supported: false };
    return { supported: true, items: cards.map(card => ({
      title: card.getAttribute('post-title') || card.querySelector('a[slot="title"], h3')?.innerText?.trim(),
      url: card.getAttribute('permalink') || card.querySelector('a[href*="/comments/"]')?.href,
      author: card.getAttribute('author'),
      summary: card.querySelector('[slot="text-body"], [data-testid="post-content"]')?.innerText?.trim()
    })) };
  },
  'youtube.login': () => {
    const loggedIn = Boolean(document.querySelector('ytd-topbar-menu-button-renderer #avatar-btn, #avatar-btn img'));
    const loginPrompt = Boolean(document.querySelector('ytd-button-renderer a[href*="accounts.google.com"]'));
    return { ready: loggedIn && !loginPrompt, supported: loggedIn || loginPrompt };
  },
  'youtube.search': () => {
    const cards = [...document.querySelectorAll('ytd-video-renderer')];
    const container = document.querySelector('ytd-search[has-results], #section-list');
    const empty = document.querySelector('ytd-message-renderer, #zero-results');
    if (!cards.length && empty) return { supported: true, items: [] };
    if (!cards.length || !container) return { supported: false };
    return { supported: true, items: cards.map(card => ({
      title: card.querySelector('#video-title')?.textContent?.trim(),
      url: card.querySelector('#video-title')?.href,
      author: card.querySelector('#channel-name a')?.textContent?.trim(),
      summary: card.querySelector('#description-text')?.textContent?.trim()
    })) };
  },
  'bilibili.login': () => {
    const manual = document.querySelector('[class*="captcha"], [class*="verify-dialog"], iframe[src*="captcha"]');
    const login = document.querySelector('[class*="login-panel"], [class*="login-dialog"]');
    if (manual) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (login) return { supported: true, code: 'LOGIN_REQUIRED' };
    return { supported: true, loginState: 'unknown' };
  },
  'bilibili.search': () => {
    const manual = document.querySelector('[class*="captcha"], [class*="verify-dialog"], iframe[src*="captcha"]');
    const rate = document.querySelector('[class*="rate-limit"], [class*="too-frequent"], [class*="limit-tips"]');
    const login = document.querySelector('[class*="login-panel"], [class*="login-dialog"]');
    if (manual) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (rate) return { supported: true, code: 'RATE_LIMITED' };
    if (login) return { supported: true, code: 'LOGIN_REQUIRED' };
    const cards = [...document.querySelectorAll('li.video-item, .video-list .video-item, .bili-video-card, [data-testid*="video-card"]')];
    const empty = document.querySelector('.search-empty, [class*="no-result"], .empty-result');
    if (!cards.length && empty) return { supported: true, empty: true, items: [] };
    if (!cards.length) {
      const pending = Boolean(document.querySelector('.video-list, .search-all-list, .vui-loading'));
      return { supported: false, pending };
    }
    const find = (card, selectors) => {
      for (const selector of selectors) {
        const element = card.querySelector(selector);
        if (element) return element;
      }
      return null;
    };
    const text = element => String(element?.innerText || element?.textContent || element?.getAttribute?.('title') || '').trim();
    return { supported: true, items: cards.map(card => {
      const title = find(card, ['.bili-video-card__info--tit a', '.video-card__title a', '.title a', 'a[href*="/video/"]', 'a[title]']);
      const link = find(card, ['a[href*="/video/"]', '.bili-video-card__info--tit a', '.video-card__title a', 'a[href]']);
      const author = find(card, ['.bili-video-card__info--owner', '.up-name', '[class*="author"]', '[class*="owner"]', '[class*="up-name"]']);
      const summary = find(card, ['.bili-video-card__info--desc', '.des', '[class*="desc"]', '[class*="description"]']);
      return {
        title: text(title),
        url: link?.href || link?.getAttribute?.('href') || '',
        author: text(author),
        summary: text(summary)
      };
    }) };
  },
  'weibo.login': () => {
    const manual = document.querySelector('[node-type="verify"], [class*="captcha"], [class*="verify-layer"]');
    const login = document.querySelector('.layer_login, [class*="login-dialog"], [class*="login-layer"]');
    if (manual) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (login) return { supported: true, code: 'LOGIN_REQUIRED' };
    return { supported: true, loginState: 'unknown' };
  },
  'weibo.search': () => {
    const manual = document.querySelector('[node-type="verify"], [class*="captcha"], [class*="verify-layer"]');
    const rate = document.querySelector('[class*="rate-limit"], [class*="too-frequent"], [node-type="system_error"]');
    const login = document.querySelector('.layer_login, [class*="login-dialog"], [class*="login-layer"]');
    if (manual) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (rate) return { supported: true, code: 'RATE_LIMITED' };
    if (login) return { supported: true, code: 'LOGIN_REQUIRED' };
    const cards = [...document.querySelectorAll('.card-wrap[action-type="feed_list_item"], .card-wrap')];
    const empty = document.querySelector('.card-no-result');
    if (!cards.length && empty) return { supported: true, empty: true, items: [] };
    if (!cards.length) {
      const pending = Boolean(document.querySelector('[node-type="feed_list"], .m-main, .WB_empty'));
      return { supported: false, pending };
    }
    const items = cards.map(card => {
      const content = card.querySelector('[node-type="feed_list_content"], .txt, [class*="content"]');
      const link = card.querySelector('a[node-type="feed_list_item_date"], .from a[href], a[href*="weibo.com/"], a[href^="/"]');
      const author = card.querySelector('.name, [class*="name"]');
      const publishedAt = link?.getAttribute?.('title') || '';
      const text = value => String(value?.innerText || value?.textContent || '').trim();
      return {
        title: text(content),
        url: link?.href || link?.getAttribute?.('href') || '',
        author: text(author),
        publishedAt,
        summary: text(content)
      };
    });
    if (!items.some(item => item.title && item.url)) return { supported: false };
    return { supported: true, items: items.filter(item => item.title && item.url) };
  },
  'zhihu.login': () => {
    const manual = document.querySelector('[class*="Captcha"], [class*="HumanVerify"], iframe[src*="captcha"]');
    const login = document.querySelector('.SignFlow, [class*="SignFlowModal"], a[href*="/signin"]');
    if (manual) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (login) return { supported: true, code: 'LOGIN_REQUIRED' };
    return { supported: true, loginState: 'unknown' };
  },
  'zhihu.search': () => {
    const manual = document.querySelector('[class*="Captcha"], [class*="HumanVerify"], iframe[src*="captcha"]');
    const rate = document.querySelector('[class*="RateLimit"], [class*="rate-limit"], [class*="TooManyRequest"]');
    const login = document.querySelector('.SignFlow, [class*="SignFlowModal"], a[href*="/signin"]');
    if (manual) return { supported: true, code: 'MANUAL_VERIFICATION_REQUIRED' };
    if (rate) return { supported: true, code: 'RATE_LIMITED' };
    if (login) return { supported: true, code: 'LOGIN_REQUIRED' };
    const empty = document.querySelector('.SearchResult-Empty, [class*="SearchResultEmpty"]');
    if (empty) return { supported: true, empty: true, items: [] };
    const cards = [...document.querySelectorAll('.SearchResult-Card, .List-item .ContentItem, [class*="SearchResult"]')];
    if (!cards.length) {
      const pending = Boolean(document.querySelector('.SearchResultApp, .Loading, [class*="Loading"]'));
      return { supported: false, pending };
    }
    const items = cards.map(card => {
      const title = card.querySelector('.ContentItem-title, .Highlight, h2, h3');
      const link = card.querySelector('a[href*="zhihu.com/question/"], a[href^="/question/"], a[href*="zhihu.com/p/"], a[href^="/p/"], a[href*="zhihu.com/people/"], a[href^="/people/"], a[href*="zhihu.com/zvideo/"], a[href^="/zvideo/"]');
      const author = card.querySelector('.AuthorInfo-name, [class*="AuthorInfo"] [class*="name"]');
      const summary = card.querySelector('.RichContent-inner, .SearchResult-Content, [class*="RichContent"]');
      const text = value => String(value?.innerText || value?.textContent || '').trim();
      return {
        title: text(title),
        url: link?.href || link?.getAttribute?.('href') || '',
        author: text(author),
        summary: text(summary)
      };
    });
    if (!items.some(item => item.title && item.url)) return { supported: false };
    return { supported: true, items: items.filter(item => item.title && item.url) };
  }
});

const PLATFORM_CONFIG = Object.freeze({
  xiaohongshu: {
    searchUrl: query => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`,
    loginScript: 'xiaohongshu.login', searchScript: 'xiaohongshu.search'
  },
  reddit: {
    searchUrl: query => `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`,
    loginScript: 'reddit.login', searchScript: 'reddit.search'
  },
  youtube: {
    searchUrl: query => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    loginScript: 'youtube.login', searchScript: 'youtube.search'
  },
  bilibili: {
    searchUrl: query => `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`,
    loginScript: 'bilibili.login', searchScript: 'bilibili.search'
  },
  weibo: {
    searchUrl: query => `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`,
    loginScript: 'weibo.login', searchScript: 'weibo.search'
  },
  zhihu: {
    searchUrl: query => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`,
    loginScript: 'zhihu.login', searchScript: 'zhihu.search'
  }
});
const PAGE_ERROR_MESSAGES = Object.freeze({
  LOGIN_REQUIRED: '该平台要求登录后才能继续搜索。',
  MANUAL_VERIFICATION_REQUIRED: '该平台要求人工完成安全验证。',
  RATE_LIMITED: '该平台暂时限制了访问频率。',
  UNSUPPORTED_PAGE: '平台页面结构暂不支持。',
  PAGE_NOT_READY: '平台搜索结果在等待时间内未就绪。',
  SESSION_CLOSED: '平台浏览器已关闭。',
  SESSION_NOT_FOUND: '尚未打开该平台浏览器。',
  SESSION_BUSY: '该平台浏览器正在执行其他操作。',
  PAGE_READ_FAILED: '无法读取平台页面。',
  NAVIGATION_FAILED: '平台页面导航失败。',
  NAVIGATION_TIMEOUT: '平台页面加载超时。'
});
const PAGE_ERROR_CODES = new Set(Object.keys(PAGE_ERROR_MESSAGES));
const MAX_SEARCH_READ_ATTEMPTS = 8;
const SEARCH_READ_INTERVAL_MS = 250;
const CONTENT_PLATFORMS = new Set(['xiaohongshu', 'bilibili', 'weibo', 'zhihu']);
const LEGACY_RESULT_HOSTS = Object.freeze({
  reddit: new Set(['www.reddit.com', 'reddit.com']),
  youtube: new Set(['www.youtube.com', 'youtube.com'])
});

function unsupported(operation) {
  return { status: 'unsupported', operation, code: 'UNSUPPORTED' };
}

function createBrowserPlatformAdapters({ manager, now = () => new Date().toISOString() }) {
  if (!manager) throw new TypeError('manager 为必需依赖');

  return Object.freeze(Object.fromEntries(Object.entries(PLATFORM_CONFIG).map(([platform, config]) => {
    let sessionId = '';
    const errorResponse = (code, extra = {}) => ({
      status: 'error', code,
      message: PAGE_ERROR_MESSAGES[code] || PAGE_ERROR_MESSAGES.PAGE_READ_FAILED,
      platform, ...extra
    });
    const runExclusive = action => typeof manager.runSessionAction === 'function'
      ? manager.runSessionAction(sessionId, action)
      : action();

    async function read(scriptName, args) {
      try {
        const result = await manager.executeReadOnlyScript(sessionId, scriptName, args);
        if (PAGE_ERROR_CODES.has(result?.code)) return { status: 'error', code: result.code, message: PAGE_ERROR_MESSAGES[result.code] };
        if (!result || (result.supported !== true && result.pending !== true)) return { status: 'error', code: 'UNSUPPORTED_PAGE', message: PAGE_ERROR_MESSAGES.UNSUPPORTED_PAGE };
        return { status: 'ok', data: result };
      } catch (error) {
        const code = PAGE_ERROR_CODES.has(error?.code) ? error.code : 'PAGE_READ_FAILED';
        return { status: 'error', code, message: PAGE_ERROR_MESSAGES[code] };
      }
    }

    const adapter = {
      async checkReady() {
        if (!sessionId) return { status: 'not-ready', platform };
        const checkFailure = code => ({
          ...errorResponse(code), ready: false,
          browserStatus: ['SESSION_CLOSED', 'SESSION_NOT_FOUND'].includes(code) ? 'closed' : code === 'SESSION_BUSY' ? 'busy' : 'ready',
          loginState: code === 'LOGIN_REQUIRED' ? 'required'
            : code === 'MANUAL_VERIFICATION_REQUIRED' ? 'verification-required' : 'unknown',
          searchVerified: false, checkedAt: now()
        });
        try {
          return await runExclusive(async () => {
            const response = await read(config.loginScript, {});
            if (response.status !== 'ok') return checkFailure(response.code);
            return {
              status: 'ok', platform, ready: true, browserStatus: 'ready',
              loginState: 'unknown', searchVerified: false, checkedAt: now()
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
        if (!sessionId) return { status: 'not-ready', platform, results: [] };
        try {
          return await runExclusive(async () => {
            const startUrl = config.searchUrl(normalizedQuery);
            let navigation;
            try {
              navigation = await manager.navigateSession(sessionId, startUrl);
            } catch (error) {
              const code = PAGE_ERROR_CODES.has(error?.code) ? error.code : 'NAVIGATION_FAILED';
              return errorResponse(code, { results: [] });
            }
            if (navigation?.status === 'closed') return errorResponse('SESSION_CLOSED', { results: [] });

            let response;
            for (let attempt = 0; attempt < MAX_SEARCH_READ_ATTEMPTS; attempt += 1) {
              response = await read(config.searchScript, {});
              if (response.status !== 'ok') return { ...response, platform, results: [] };
              const data = response.data;
              if (data.supported === true && Array.isArray(data.items) && (data.items.length > 0 || data.empty === true)) break;
              if (data.pending !== true) return errorResponse('UNSUPPORTED_PAGE', { results: [] });
              if (attempt === MAX_SEARCH_READ_ATTEMPTS - 1) return errorResponse('PAGE_NOT_READY', { results: [] });
              await new Promise(resolve => setTimeout(resolve, SEARCH_READ_INTERVAL_MS));
            }

            const items = response?.data?.items;
            if (!Array.isArray(items)) return errorResponse('UNSUPPORTED_PAGE', { results: [] });
            const candidates = items.map(item => {
              if (!item || typeof item.title !== 'string' || !item.title.trim()) return null;
              let safeUrl;
              let contentId = '';
              if (CONTENT_PLATFORMS.has(platform)) {
                const parsed = parseSocialContentUrl(platform, item.url, { allowRelative: true });
                if (!parsed) return null;
                safeUrl = parsed.url;
                contentId = parsed.contentId;
              } else {
                try {
                  const resultUrl = new URL(item.url, startUrl);
                  if (resultUrl.protocol !== 'https:' || resultUrl.username || resultUrl.password || resultUrl.port
                    || !LEGACY_RESULT_HOSTS[platform]?.has(resultUrl.hostname.toLowerCase())) return null;
                  safeUrl = resultUrl.href;
                } catch { return null; }
              }
              return normalizeSocialResult({
                platform, title: item.title, url: safeUrl, contentId, author: item.author,
                publishedAt: item.publishedAt, summary: item.summary,
                contentType: ['youtube', 'bilibili'].includes(platform) ? 'video' : 'post',
                searchQueries: [normalizedQuery], capturedAt: now(),
                retrievalMethod: 'browser', evidenceStatus: 'unverified'
              });
            }).filter(Boolean);

            if (items.length > 0 && candidates.length === 0) return errorResponse('UNSUPPORTED_PAGE', { results: [] });
            const maxResults = Math.max(1, Math.min(Number(options.maxResults) || 20, 100));
            return { status: 'ok', platform, results: candidates.slice(0, maxResults) };
          });
        } catch (error) {
          const code = PAGE_ERROR_CODES.has(error?.code) ? error.code : 'PAGE_READ_FAILED';
          return errorResponse(code, { results: [] });
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

module.exports = {
  createBrowserPlatformAdapters,
  PLATFORM_CONFIG,
  PAGE_SCRIPTS
};
