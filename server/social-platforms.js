const PLATFORM_DEFINITIONS = Object.freeze([
  Object.freeze({
    platform: 'xiaohongshu', displayName: '小红书', market: 'domestic', apiAvailable: false,
    requiresLogin: 'conditional', searchVerified: false,
    requiredConfig: [], maxResults: 20,
    supportedFields: ['url', 'title', 'author', 'publishedAt', 'summary'],
    supportsSearch: true, supportsDetail: false, supportsComments: false
  }),
  Object.freeze({
    platform: 'bilibili', displayName: '哔哩哔哩', market: 'domestic', apiAvailable: false,
    requiresLogin: 'conditional', searchVerified: false,
    requiredConfig: [], maxResults: 20,
    supportedFields: ['url', 'title', 'author', 'publishedAt', 'summary'],
    supportsSearch: true, supportsDetail: false, supportsComments: false
  }),
  Object.freeze({
    platform: 'weibo', displayName: '微博', market: 'domestic', apiAvailable: false,
    requiresLogin: 'conditional', searchVerified: false,
    requiredConfig: [], maxResults: 20,
    supportedFields: ['url', 'title', 'author', 'publishedAt', 'summary'],
    supportsSearch: true, supportsDetail: false, supportsComments: false
  }),
  Object.freeze({
    platform: 'zhihu', displayName: '知乎', market: 'domestic', apiAvailable: false,
    requiresLogin: 'conditional', searchVerified: false,
    requiredConfig: [], maxResults: 20,
    supportedFields: ['url', 'title', 'author', 'publishedAt', 'summary'],
    supportsSearch: true, supportsDetail: false, supportsComments: false
  }),
  Object.freeze({
    platform: 'reddit', displayName: 'Reddit', market: 'international', apiAvailable: true,
    requiredConfig: ['accessToken', 'userAgent'], maxResults: 5,
    supportedFields: ['url', 'title', 'author', 'publishedAt', 'summary', 'publicMetrics.likes', 'publicMetrics.comments'],
    supportsSearch: true, supportsDetail: false, supportsComments: false,
    endpoint: 'https://oauth.reddit.com/search.json'
  }),
  Object.freeze({
    platform: 'youtube', displayName: 'YouTube', market: 'international', apiAvailable: true,
    requiredConfig: ['apiKey'], maxResults: 5,
    supportedFields: ['url', 'title', 'author', 'publishedAt', 'summary'],
    supportsSearch: true, supportsDetail: false, supportsComments: false,
    endpoint: 'https://www.googleapis.com/youtube/v3/search'
  })
]);

function listSocialPlatformDefinitions() {
  return PLATFORM_DEFINITIONS.map(({ endpoint, ...definition }) => ({ ...definition, requiredConfig: [...definition.requiredConfig], supportedFields: [...definition.supportedFields] }));
}

function getSocialPlatformDefinition(platform) {
  return PLATFORM_DEFINITIONS.find(definition => definition.platform === platform) || null;
}

module.exports = { listSocialPlatformDefinitions, getSocialPlatformDefinition };
