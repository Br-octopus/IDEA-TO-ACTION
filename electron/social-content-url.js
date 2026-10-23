const CONTENT_HOSTS = Object.freeze({
  xiaohongshu: new Set(['www.xiaohongshu.com', 'xiaohongshu.com']),
  bilibili: new Set(['www.bilibili.com', 'bilibili.com']),
  weibo: new Set(['www.weibo.com', 'weibo.com']),
  zhihu: new Set(['www.zhihu.com', 'zhihu.com', 'zhuanlan.zhihu.com'])
});

const CONTENT_BASE_URLS = Object.freeze({
  xiaohongshu: 'https://www.xiaohongshu.com/',
  bilibili: 'https://www.bilibili.com/',
  weibo: 'https://weibo.com/',
  zhihu: 'https://www.zhihu.com/'
});

function parseSocialContentUrl(platform, value, { allowRelative = false } = {}) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 2048) return null;
  const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(value);
  if (!allowRelative && !isAbsolute) return null;

  let url;
  try {
    url = new URL(value, CONTENT_BASE_URLS[platform]);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !CONTENT_HOSTS[platform]?.has(url.hostname.toLowerCase())) return null;

  let contentId = '';
  if (platform === 'xiaohongshu') {
    contentId = url.pathname.match(/^\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)\/?$/)?.[1] || '';
  } else if (platform === 'bilibili') {
    contentId = url.pathname.match(/^\/video\/(BV[A-Za-z0-9]+|av\d+)\/?$/)?.[1] || '';
  } else if (platform === 'weibo') {
    const post = url.pathname.match(/^\/(\d{1,20})\/([A-Za-z0-9]+)\/?$/);
    const detail = url.pathname.match(/^\/detail\/(\d{1,30})\/?$/);
    const status = url.pathname.match(/^\/status\/([A-Za-z0-9]+)\/?$/);
    contentId = post?.[2] || detail?.[1] || status?.[1] || '';
  } else if (platform === 'zhihu') {
    const answer = url.pathname.match(/^\/question\/(\d{1,30})\/answer\/(\d{1,30})\/?$/);
    const article = url.hostname.toLowerCase() === 'zhuanlan.zhihu.com'
      ? url.pathname.match(/^\/p\/(\d{1,30})\/?$/)
      : null;
    contentId = url.hostname.toLowerCase() !== 'zhuanlan.zhihu.com' && answer
      ? `${answer[1]}:${answer[2]}`
      : article?.[1] || '';
  }

  if (!contentId) return null;
  // 保留完整查询串；小红书的 xsec_token 等安全参数可能位于其中。
  return { url: url.href, contentId };
}

module.exports = { parseSocialContentUrl };
