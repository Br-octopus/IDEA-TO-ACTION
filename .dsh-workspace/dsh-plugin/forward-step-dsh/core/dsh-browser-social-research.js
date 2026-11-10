const PLATFORM_CONFIG = Object.freeze({
  xiaohongshu: {
    host: 'www.xiaohongshu.com', domain: 'xiaohongshu.com',
    url: query => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`,
    spec: { item: `section.note-item, [class*='note-item'], [class*='noteItem'], [data-testid*='note-card'], [data-testid*='note-item']`, title: `[class*='title'], [class*='Title'], h3, h4`, link: `a[href*='/explore/'], a[href*='/discovery/item/'], a[href]`, text: `[class*='desc'], [class*='content']` },
  },
  bilibili: {
    host: 'search.bilibili.com', domain: 'bilibili.com',
    url: query => `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`,
    spec: { item: `.bili-video-card, li.video-item, .video-list li`, title: `.bili-video-card__title, .title, a[title]`, link: `a[href*='/video/']`, text: `.bili-video-card__desc, .des, [class*='desc']` },
  },
  weibo: {
    host: 's.weibo.com', domain: 'weibo.com',
    url: query => `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`,
    spec: { item: `.card-wrap[action-type='feed_list_item'], .card-wrap`, title: `[node-type='feed_list_content'], .txt, [class*='content']`, link: `a[node-type='feed_list_item_date'], .from a[href], a[href*='weibo.com/']`, text: `[node-type='feed_list_content'], .txt, [class*='content']` },
  },
  zhihu: {
    host: 'www.zhihu.com', domain: 'zhihu.com',
    url: query => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`,
    spec: { item: `.SearchResult-Card, .List-item .ContentItem`, title: `.ContentItem-title, h2, h3`, link: `a[href*='/question/'], a[href*='zhuanlan.zhihu.com/p/']`, text: `.RichContent-inner, .RichText, [class*='RichContent']` },
  },
})

function normalizeDomain(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/^(?:\*\.|\.)/u, '') : ''
}

function coversHost(allowedDomain, host) {
  const domain = normalizeDomain(allowedDomain)
  return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`))
}

function matchingProfiles(profiles, platform) {
  const config = PLATFORM_CONFIG[platform]
  if (!config || !Array.isArray(profiles)) return []
  return profiles.filter(profile => typeof profile?.id === 'string' && profile.id.trim()
    && Array.isArray(profile.allowedDomains)
    && profile.allowedDomains.some(domain => coversHost(domain, config.host)))
}

function profileState(profiles, platform) {
  const count = matchingProfiles(profiles, platform).length
  return { authorized: false, profileConfigured: count === 1, status: count === 1 ? 'profile-configured' : count > 1 ? 'profile-ambiguous' : 'profile-not-configured' }
}

function safeResultUrl(platform, value) {
  const config = PLATFORM_CONFIG[platform]
  if (!config || typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !(url.hostname === config.domain || url.hostname.endsWith(`.${config.domain}`))) return ''
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:token|key|auth|session|credential|password|cookie)/iu.test(key)) url.searchParams.delete(key)
    }
    url.hash = ''
    return url.href
  } catch {
    return ''
  }
}

function browserFailure(error, signal) {
  const detail = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
  const code = signal?.aborted || error?.name === 'AbortError' || /abort|cancel/u.test(detail) ? 'cancelled'
    : /login|auth|profile/u.test(detail) ? 'unauthorized'
      : /rate|limit/u.test(detail) ? 'rate_limited'
        : /timeout/u.test(detail) ? 'timeout' : 'search_failed'
  const message = code === 'unauthorized'
    ? 'DSH Browser 登录配置不可用；请检查该站登录状态和域名授权。'
    : 'DSH Browser 站内采集失败；请检查登录、验证码、限流或页面结构。'
  return Object.assign(new Error(message), { code })
}

export function createDshBrowserSocialResearch(browser) {
  if (!browser || typeof browser.policyReport !== 'function' || typeof browser.searchResults !== 'function') return undefined

  const readProfiles = async () => {
    try {
      const report = await browser.policyReport()
      return Array.isArray(report?.authProfiles) ? report.authProfiles : []
    } catch (error) {
      throw browserFailure(error)
    }
  }

  return {
    async getPlatformState() {
      const profiles = await readProfiles()
      return {
        capabilities: Object.keys(PLATFORM_CONFIG).map(platform => ({ platform, status: 'unverified', verified: false, available: true })),
        connections: Object.fromEntries(Object.keys(PLATFORM_CONFIG).map(platform => [platform, profileState(profiles, platform)])),
      }
    },

    async collectPlatform({ platform, queries, budget, signal } = {}) {
      const config = PLATFORM_CONFIG[platform]
      if (!config) throw Object.assign(new Error('不支持的平台'), { code: 'unsupported_platform' })
      if (!Array.isArray(queries) || queries.some(query => typeof query !== 'string' || !query.trim())) {
        throw Object.assign(new Error('采集查询无效'), { code: 'invalid_input' })
      }
      const profiles = await readProfiles()
      const matches = matchingProfiles(profiles, platform)
      if (matches.length !== 1) {
        const message = matches.length ? '存在多个覆盖该站的 DSH Browser 登录 profile，请保留唯一匹配项。' : '未配置覆盖该站的 DSH Browser 登录 profile。'
        throw Object.assign(new Error(message), { code: 'unauthorized' })
      }
      const count = Number.isInteger(budget?.maxResultsPerQuery) && budget.maxResultsPerQuery > 0
        ? Math.min(budget.maxResultsPerQuery, 50) : 10
      const results = []
      const seen = new Set()
      for (const query of queries) {
        if (signal?.aborted) throw browserFailure(signal.reason, signal)
        let items
        try {
          items = await browser.searchResults(config.url(query.trim()), config.spec, { authProfile: matches[0].id, signal, count })
        } catch (error) {
          throw browserFailure(error, signal)
        }
        if (!Array.isArray(items)) throw Object.assign(new Error('DSH Browser 返回了无效的搜索结果'), { code: 'invalid_adapter_result' })
        for (const item of items) {
          const url = safeResultUrl(platform, item?.url)
          if (!url || seen.has(url)) continue
          seen.add(url)
          results.push({ url, title: typeof item.title === 'string' ? item.title.trim().slice(0, 500) : '', snippet: typeof item.snippet === 'string' ? item.snippet.trim().slice(0, 2000) : '' })
        }
      }
      return results
    },
  }
}
