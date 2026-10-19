const { normalizeSocialResult } = require('../prototype/social-research-schema.js');

const PLATFORM_CONFIG = Object.freeze({
  xiaohongshu: {
    searchUrl: query => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`,
    loginScript: 'xiaohongshu.login',
    searchScript: 'xiaohongshu.search'
  },
  reddit: {
    searchUrl: query => `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`,
    loginScript: 'reddit.login',
    searchScript: 'reddit.search'
  },
  youtube: {
    searchUrl: query => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    loginScript: 'youtube.login',
    searchScript: 'youtube.search'
  }
});
const RESULT_HOSTS = Object.freeze({
  xiaohongshu: new Set(['www.xiaohongshu.com', 'xiaohongshu.com']),
  reddit: new Set(['www.reddit.com', 'reddit.com']),
  youtube: new Set(['www.youtube.com', 'youtube.com'])
});

// 选择器只覆盖当前稳定的语义标记和页面结构；平台改版时明确报错，不猜测空结果。
const PAGE_SCRIPTS = {
  'xiaohongshu.login': () => {
    const loggedIn = Boolean(document.querySelector('[class*="user"], [class*="avatar"], a[href*="/user/profile/"]'));
    const loginPrompt = Boolean(document.querySelector('[class*="login"], button[class*="login"]'));
    return { ready: loggedIn && !loginPrompt, supported: loggedIn || loginPrompt };
  },
  'xiaohongshu.search': () => {
    const cards = [...document.querySelectorAll('section.note-item, [class*="note-item"]')];
    if (!cards.length && !document.querySelector('[class*="search-result"], [class*="result-list"]')) return { supported: false };
    return { supported: true, items: cards.map(card => ({
      title: card.querySelector('[class*="title"]')?.innerText?.trim(),
      url: card.querySelector('a[href]')?.href,
      author: card.querySelector('[class*="author"], [class*="nickname"]')?.innerText?.trim(),
      summary: card.querySelector('[class*="desc"]')?.innerText?.trim()
    })) };
  },
  'reddit.login': () => {
    const loggedIn = Boolean(document.querySelector('a[href*="/user/"], shreddit-header-action[aria-label*="profile" i]'));
    const loginPrompt = Boolean(document.querySelector('a[href*="/login"], button[aria-label*="log in" i]'));
    return { ready: loggedIn && !loginPrompt, supported: loggedIn || loginPrompt };
  },
  'reddit.search': () => {
    const cards = [...document.querySelectorAll('shreddit-post, [data-testid="search-post-unit"]')];
    if (!cards.length && !document.querySelector('faceplate-partial, [data-testid*="search"]')) return { supported: false };
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
    if (!cards.length && !document.querySelector('ytd-search[has-results], #section-list')) return { supported: false };
    return { supported: true, items: cards.map(card => ({
      title: card.querySelector('#video-title')?.textContent?.trim(),
      url: card.querySelector('#video-title')?.href,
      author: card.querySelector('#channel-name a')?.textContent?.trim(),
      summary: card.querySelector('#description-text')?.textContent?.trim()
    })) };
  }
};

function unsupported(operation) {
  return { status: 'unsupported', operation, code: 'UNSUPPORTED' };
}

function createBrowserPlatformAdapters({ manager, waitForNavigation = async () => {}, now = () => new Date().toISOString() }) {
  if (!manager) throw new TypeError('manager 为必需依赖');
  if (typeof manager.registerReadOnlyScript === 'function') {
    for (const [name, script] of Object.entries(PAGE_SCRIPTS)) manager.registerReadOnlyScript(name, script);
  }

  return Object.freeze(Object.fromEntries(Object.entries(PLATFORM_CONFIG).map(([platform, config]) => {
    let sessionId = '';
    async function read(scriptName, args) {
      try {
        const result = await manager.executeReadOnlyScript(sessionId, scriptName, args);
        if (!result || result.supported !== true) {
          return { status: 'adapter-error', code: 'UNSUPPORTED_PAGE', message: `${platform} 页面结构暂不支持` };
        }
        return { status: 'ok', data: result };
      } catch {
        return { status: 'adapter-error', code: 'PAGE_READ_FAILED', message: `${platform} 页面读取失败` };
      }
    }
    const adapter = {
      async checkReady() {
        if (!sessionId) return { status: 'not-ready', platform };
        const response = await read(config.loginScript, {});
        if (response.status !== 'ok') return { ...response, platform };
        return { status: 'ok', platform, ready: response.data.ready === true, checkedAt: now() };
      },
      async search(query, options = {}) {
        const normalizedQuery = typeof query === 'string' ? query.trim() : '';
        if (!normalizedQuery) throw new TypeError('搜索词不能为空');
        if (!sessionId) return { status: 'not-ready', platform, results: [] };
        const startUrl = config.searchUrl(normalizedQuery);
        try {
          const navigation = await manager.navigateSession(sessionId, startUrl);
          if (navigation.status === 'timeout') return { status: 'timeout', platform, results: [] };
          await waitForNavigation(platform);
        } catch {
          return { status: 'adapter-error', code: 'NAVIGATION_FAILED', platform, results: [] };
        }
        const response = await read(config.searchScript, {});
        if (response.status !== 'ok') return { ...response, platform, results: [] };
        const maxResults = Math.max(1, Math.min(Number(options.maxResults) || 20, 100));
        const results = (Array.isArray(response.data.items) ? response.data.items : []).slice(0, maxResults).map(item => {
          const hasTitle = typeof item.title === 'string' && item.title.trim();
          const hasUrl = typeof item.url === 'string' && item.url.trim();
          if (!hasTitle || !hasUrl) return null;
          try {
            const resultUrl = new URL(item.url);
            if (resultUrl.protocol !== 'https:' || !RESULT_HOSTS[platform].has(resultUrl.hostname.toLowerCase())) return null;
            return normalizeSocialResult({
              platform, title: item.title, url: item.url, author: item.author,
              summary: item.summary, searchQueries: [normalizedQuery], capturedAt: now(),
              retrievalMethod: 'browser', evidenceStatus: 'unverified'
            });
          } catch { return null; }
        }).filter(Boolean);
        return { status: 'ok', platform, results };
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

module.exports = { createBrowserPlatformAdapters, PLATFORM_CONFIG, PAGE_SCRIPTS };
