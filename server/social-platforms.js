const PLATFORM_DEFINITIONS = Object.freeze([
  Object.freeze({
    platform: 'xiaohongshu', displayName: '小红书', domestic: true, apiAvailable: false,
    browserAvailable: true, connectionModes: ['browser'],
    searchVerified: false, browserSearchStatus: 'pending-live-test',
    requiredConfig: [], maxResults: 20,
    supportedFields: ['url', 'title', 'author', 'summary'],
    supportsSearch: true, supportsDetail: false, supportsComments: false,
    notes: '浏览器搜索待实测；API 尚未接入。'
  }),
  Object.freeze({
    platform: 'bilibili', displayName: 'B 站', domestic: true, apiAvailable: false,
    browserAvailable: true, connectionModes: ['browser'],
    searchVerified: false, browserSearchStatus: 'pending-live-test',
    requiredConfig: [], maxResults: 20,
    supportedFields: ['url', 'title', 'author', 'summary'],
    supportsSearch: true, supportsDetail: false, supportsComments: false,
    notes: '浏览器搜索待实测；API 尚未接入。'
  }),
  Object.freeze({
    platform: 'weibo', displayName: '微博', domestic: true, apiAvailable: false,
    browserAvailable: true, connectionModes: ['browser'],
    searchVerified: false, browserSearchStatus: 'pending-live-test',
    requiredConfig: [], maxResults: 20,
    supportedFields: ['url', 'title', 'author', 'summary'],
    supportsSearch: true, supportsDetail: false, supportsComments: false,
    notes: '浏览器搜索待实测；API 尚未接入。'
  }),
  Object.freeze({
    platform: 'zhihu', displayName: '知乎', domestic: true, apiAvailable: false,
    browserAvailable: true, connectionModes: ['browser'],
    searchVerified: false, browserSearchStatus: 'pending-live-test',
    requiredConfig: [], maxResults: 20,
    supportedFields: ['url', 'title', 'author', 'summary'],
    supportsSearch: true, supportsDetail: false, supportsComments: false,
    notes: '浏览器搜索待实测；API 尚未接入。'
  }),
  Object.freeze({
    platform: 'reddit', displayName: 'Reddit', domestic: false, apiAvailable: true,
    browserAvailable: true, connectionModes: ['api', 'browser'],
    requiredConfig: ['accessToken', 'userAgent'], maxResults: 5,
    supportedFields: ['url', 'title', 'author', 'publishedAt', 'summary', 'publicMetrics.likes', 'publicMetrics.comments'],
    supportsSearch: true, supportsDetail: false, supportsComments: false,
    endpoint: 'https://oauth.reddit.com/search.json'
  }),
  Object.freeze({
    platform: 'youtube', displayName: 'YouTube', domestic: false, apiAvailable: true,
    browserAvailable: true, connectionModes: ['api', 'browser'],
    requiredConfig: ['apiKey'], maxResults: 5,
    supportedFields: ['url', 'title', 'author', 'publishedAt', 'summary'],
    supportsSearch: true, supportsDetail: false, supportsComments: false,
    endpoint: 'https://www.googleapis.com/youtube/v3/search'
  })
]);

function listSocialPlatformDefinitions() {
  return PLATFORM_DEFINITIONS.map(({ endpoint, ...definition }) => ({
    ...definition,
    requiredConfig: [...definition.requiredConfig],
    supportedFields: [...definition.supportedFields],
    connectionModes: [...(definition.connectionModes || [])]
  }));
}

function getSocialPlatformDefinition(platform) {
  return PLATFORM_DEFINITIONS.find(definition => definition.platform === platform) || null;
}

module.exports = { listSocialPlatformDefinitions, getSocialPlatformDefinition };
