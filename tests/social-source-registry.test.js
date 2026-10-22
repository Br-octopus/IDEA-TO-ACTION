const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const registryPath = path.resolve(__dirname, '../server/social-source-registry.js');
const registry = fs.existsSync(registryPath) ? require(registryPath) : null;

test('来源登记固定版本、平台能力、运行入口和校验后的请求契约', () => {
  assert.ok(registry, '应提供固定来源登记模块');
  const source = registry.getSocialSource('mediacrawler-lite');
  assert.equal(source.version, '1.1.0');
  assert.equal(source.protocolVersion, 1);
  assert.deepEqual(source.platforms, ['xiaohongshu', 'bilibili', 'weibo', 'zhihu']);
  assert.deepEqual(source.capabilities.zhihu, ['health', 'detail']);
  assert.equal(source.capabilities.weibo.includes('comments'), true);
  assert.deepEqual(source.errorCodes, ['PERMISSION_DENIED', 'PAGE_STRUCTURE_CHANGED']);
  assert.equal(registry.SOCIAL_SOURCE_ERROR_MESSAGES.PERMISSION_DENIED, '当前账号或连接没有访问该内容的权限。');
  assert.equal(registry.SOCIAL_SOURCE_ERROR_MESSAGES.PAGE_STRUCTURE_CHANGED, '平台页面或响应结构已变化，无法按当前规则读取。');
  assert.equal(source.entryPoint, 'vendor/mediacrawler-bridge/bridge.py');
  assert.match(source.requirementsLockSha256, /^[a-f0-9]{64}$/);
  const lock = fs.readFileSync(path.resolve(__dirname, '..', source.requirementsLockPath));
  assert.equal(source.requirementsLockSha256, createHash('sha256').update(lock).digest('hex'));
  assert.match(lock.toString('utf8'), /^pyee==13\.0\.0$/m);
  assert.doesNotMatch(lock.toString('utf8'), /^pyee==14\./m);
  assert.equal(source.uvInstaller.version, '0.13.2');
  assert.equal(source.uvInstaller.windowsX64.sha256, '9cfb447a4027550f134753253fdffbcd35b79a66dd888260bf6776891916069e');

  const request = registry.validateSourceRequest({
    requestId: 'request-123',
    protocolVersion: 1,
    sourceId: 'mediacrawler-lite',
    action: 'comments',
    capability: 'comments',
    platform: 'bilibili',
    profileId: 'account_1',
    taskId: 'task-1',
    contentId: { bvid: 'BV1xx411c7mD', cursor: '0' },
    budget: { maxRequests: 2, maxItems: 20, deadlineAt: new Date(Date.now() + 60_000).toISOString() }
  });
  assert.equal(request.action, 'comments');
  assert.equal(request.budget.maxRequests, 2);

  for (const [platform, action, contentId] of [
    ['weibo', 'detail', { postId: '123456789' }],
    ['weibo', 'comments', { postId: '123456789' }],
    ['zhihu', 'detail', { questionId: '123', answerId: '456' }],
    ['zhihu', 'detail', { articleId: '789' }]
  ]) {
    assert.equal(registry.validateSourceRequest({
      requestId: 'request-123', protocolVersion: 1, sourceId: 'mediacrawler-lite',
      action, capability: action, platform, profileId: 'account_1', taskId: 'task-1', contentId,
      budget: { maxRequests: 1, maxItems: 20, deadlineAt: new Date(Date.now() + 60_000).toISOString() }
    }).platform, platform);
  }
  assert.throws(() => registry.validateSourceRequest({
    requestId: 'request-123', protocolVersion: 1, sourceId: 'mediacrawler-lite',
    action: 'comments', capability: 'comments', platform: 'zhihu', profileId: 'account_1', taskId: 'task-1',
    contentId: { articleId: '789' },
    budget: { maxRequests: 1, maxItems: 20, deadlineAt: new Date(Date.now() + 60_000).toISOString() }
  }), { code: 'INVALID_REQUEST' });

  for (const hostile of [
    { command: 'python evil.py' },
    { script: 'import os' },
    { path: 'C:/private' },
    { env: { PATH: 'evil' } },
    { debugPort: 9222 }
  ]) {
    assert.throws(() => registry.validateSourceRequest({
      requestId: 'r', protocolVersion: 1, sourceId: 'mediacrawler-lite',
      action: 'health', capability: 'health', platform: 'bilibili', profileId: 'p', taskId: 't',
      contentId: null,
      budget: { maxRequests: 1, maxItems: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString() },
      ...hostile
    }), { code: 'INVALID_REQUEST' });
  }
  assert.throws(() => registry.getSocialSource('unknown'), { code: 'UNSUPPORTED_SOURCE' });
});
