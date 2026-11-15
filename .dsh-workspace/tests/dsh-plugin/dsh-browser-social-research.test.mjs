import test from 'node:test'
import assert from 'node:assert/strict'
import { createDshBrowserSocialResearch } from '../../dsh-plugin/forward-step-dsh/core/dsh-browser-social-research.js'

const platforms = {
  xiaohongshu: ['www.xiaohongshu.com', 'xiaohongshu.com', 'https://www.xiaohongshu.com/search_result?keyword='],
  bilibili: ['search.bilibili.com', 'bilibili.com', 'https://search.bilibili.com/all?keyword='],
  weibo: ['s.weibo.com', 'weibo.com', 'https://s.weibo.com/weibo?q='],
  zhihu: ['www.zhihu.com', 'zhihu.com', 'https://www.zhihu.com/search?type=content&q='],
}

test('四个平台使用目标域名 profile、限额与取消信号，并过滤站外或敏感链接', async () => {
  const calls = []
  const browser = {
    policyReport: () => ({ authProfiles: Object.entries(platforms).map(([platform, [, domain]]) => ({ id: `profile-${platform}`, allowedDomains: [domain] })) }),
    searchResults: async (url, spec, options) => {
      calls.push({ url, spec, options })
      const platform = Object.keys(platforms).find(key => url.startsWith(platforms[key][2]))
      const host = platforms[platform][0]
      return [
        { url: `https://${host}/content/${platform}?token=secret&source=test#fragment`, title: ` ${platform} 标题 `, snippet: '摘要' },
        { url: 'https://attacker.example/collect', title: '站外结果' },
        { url: `http://${host}/insecure`, title: '非 HTTPS' },
        { url: `https://not${platforms[platform][1]}/lookalike`, title: '仿冒域名' },
      ]
    },
  }
  const adapter = createDshBrowserSocialResearch(browser)
  const signal = new AbortController().signal
  const state = await adapter.getPlatformState()

  assert.equal(state.capabilities.every(item => item.available && item.status === 'unverified' && !item.verified), true)
  assert.equal(Object.values(state.connections).every(item => item.authorized === false), true)
  assert.doesNotMatch(JSON.stringify(state), /profile-(?:xiaohongshu|bilibili|weibo|zhihu)/u)

  for (const [platform, [host, , searchPrefix]] of Object.entries(platforms)) {
    assert.equal(state.connections[platform].profileConfigured, true)
    const results = await adapter.collectPlatform({ platform, queries: ['中文 query'], budget: { maxResultsPerQuery: 3 }, signal })
    assert.equal(calls.at(-1).url.startsWith(searchPrefix), true)
    assert.equal(calls.at(-1).options.authProfile, `profile-${platform}`)
    assert.equal(calls.at(-1).options.count, 3)
    assert.equal(calls.at(-1).options.signal, signal)
    assert.match(calls.at(-1).spec.item, /./u)
    assert.equal(results.length, 1)
    assert.equal(results[0].url, `https://${host}/content/${platform}?source=test`)
    assert.equal(results[0].title, `${platform} 标题`)
    assert.doesNotMatch(JSON.stringify(results), /profile-|secret|attacker/u)
  }
})

test('未配置或多个匹配 profile 时不触发站点请求', async () => {
  let calls = 0
  for (const authProfiles of [
    [],
    [{ id: 'one', allowedDomains: ['weibo.com'] }, { id: 'two', allowedDomains: ['.weibo.com'] }],
  ]) {
    const adapter = createDshBrowserSocialResearch({ policyReport: () => ({ authProfiles }), searchResults: async () => { calls += 1; return [] } })
    const state = await adapter.getPlatformState()
    assert.equal(state.connections.weibo.profileConfigured, false)
    assert.equal(state.connections.weibo.authorized, false)
    await assert.rejects(adapter.collectPlatform({ platform: 'weibo', queries: ['q'] }), error => {
      assert.equal(error.code, 'unauthorized')
      return true
    })
  }
  assert.equal(calls, 0)
})

test('浏览器异常被归一化，不把 profile 标识透传到错误文案', async () => {
  const adapter = createDshBrowserSocialResearch({
    policyReport: () => ({ authProfiles: [{ id: 'private-profile-id', allowedDomains: ['zhihu.com'] }] }),
    searchResults: async () => { throw new Error('auth profile private-profile-id failed') },
  })
  await assert.rejects(adapter.collectPlatform({ platform: 'zhihu', queries: ['q'] }), error => {
    assert.equal(error.code, 'unauthorized')
    assert.doesNotMatch(error.message, /private-profile-id/u)
    return true
  })
})
