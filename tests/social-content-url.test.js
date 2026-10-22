const assert = require('node:assert/strict');
const test = require('node:test');
const { parseSocialContentUrl } = require('../electron/social-content-url');

test('识别四个平台允许的内容链接并生成 contentId', () => {
  const cases = [
    ['xiaohongshu', '/explore/abc123', 'abc123'],
    ['xiaohongshu', 'https://www.xiaohongshu.com/discovery/item/Note_1', 'Note_1'],
    ['bilibili', '/video/BV1xx411c7mD', 'BV1xx411c7mD'],
    ['bilibili', 'https://www.bilibili.com/video/av123456', 'av123456'],
    ['weibo', '/1234567890/AbC987', 'AbC987'],
    ['weibo', 'https://weibo.com/detail/1234567890123', '1234567890123'],
    ['weibo', 'https://weibo.com/status/AbC987', 'AbC987'],
    ['zhihu', '/question/123/answer/456', '123:456'],
    ['zhihu', 'https://zhuanlan.zhihu.com/p/789', '789']
  ];
  for (const [platform, input, contentId] of cases) {
    assert.equal(parseSocialContentUrl(platform, input, { allowRelative: true })?.contentId, contentId, `${platform} ${input}`);
  }
});

test('相对链接按平台基址解析并保留小红书安全查询参数', () => {
  const parsed = parseSocialContentUrl('xiaohongshu', '/explore/note-id?xsec_token=secret&xsec_source=pc', { allowRelative: true });
  assert.equal(parsed.contentId, 'note-id');
  assert.equal(parsed.url, 'https://www.xiaohongshu.com/explore/note-id?xsec_token=secret&xsec_source=pc');
});

test('拒绝用户主页、非内容路径、lookalike host、非 HTTPS、凭证和非默认端口', () => {
  const invalid = [
    ['xiaohongshu', 'https://www.xiaohongshu.com/user/profile/123'],
    ['bilibili', 'https://www.bilibili.com/space/123/video'],
    ['bilibili', 'https://www.bilibili.com/video/owner/123'],
    ['weibo', 'https://weibo.com/u/123'],
    ['weibo', 'https://weibo.com/123456'],
    ['zhihu', 'https://www.zhihu.com/people/someone'],
    ['zhihu', 'https://www.zhihu.com/question/123'],
    ['xiaohongshu', 'https://xiaohongshu.com.attacker.invalid/explore/123'],
    ['bilibili', 'http://www.bilibili.com/video/BV1xx411c7mD'],
    ['weibo', 'https://user:pass@weibo.com/123/456'],
    ['zhihu', 'https://zhuanlan.zhihu.com:444/p/123']
  ];
  for (const [platform, url] of invalid) assert.equal(parseSocialContentUrl(platform, url), null, `${platform} ${url}`);
  assert.equal(parseSocialContentUrl('reddit', 'https://www.reddit.com/r/x/comments/1/a/'), null);
});
