const test = require('node:test');
const assert = require('node:assert/strict');
const { createSocialResearchCoordinator } = require('../prototype/app.js');
const storage = require('../prototype/storage.js');

function makeModelClient({ emptyPlan = false, emptyReport = false } = {}) {
  const calls = [];
  return {
    calls,
    async requestModel({ messages, options }) {
      const purpose = options?.purpose;
      const prompt = messages?.[0]?.content || '';
      calls.push({ purpose, prompt });
      if (purpose === 'plan') {
        return emptyPlan ? '' : JSON.stringify({
          objective: '了解独立开发者记账工具的用户痛点',
          researchType: 'pain-points',
          platformRoles: [
            { platform: 'reddit', role: '收集海外体验', queries: ['bookkeeping app'] },
            { platform: 'youtube', role: '收集视频评论', queries: ['bookkeeping app review'] }
          ],
          queries: ['bookkeeping app'],
          expectedResultCount: 2,
          budget: { maxPlatforms: 2, maxQueriesPerPlatform: 2 }
        });
      }
      return emptyReport ? '' : JSON.stringify({
        summary: '发现两个平台的共同痛点',
        coreFindings: ['用户关注账单同步可靠性'],
        resultIds: ['reddit-1', 'youtube-1']
      });
    }
  };
}

function makeSocial(overrides = {}) {
  const calls = [];
  const social = {
    calls,
    async check(platform, profileId) {
      calls.push(['check', platform, profileId]);
      return { platform, status: 'ready', apiAvailable: platform === 'reddit', browserAvailable: true };
    },
    async search(platform, { query, mode }) {
      calls.push(['search', platform, query, mode]);
      if (overrides[platform]?.search) return overrides[platform].search({ platform, query, mode });
      return [{ id: `${platform}-1`, platform, url: `https://${platform}.example/${query}`, title: `${platform} result`, summary: `${platform} summary` }];
    }
  };
  return social;
}

function makeHarness({ social, model, initialState } = {}) {
  const saves = [];
  const api = {
    social: social || makeSocial(),
    requestModel: (model || makeModelClient()).requestModel,
    saveState(state) { saves.push(structuredClone(state)); return state; }
  };
  return { coordinator: createSocialResearchCoordinator({ desktopApi: api, initialState: initialState || storage.createEmptyState() }), saves, api };
}

async function prepareAndRun(harness, input = {}) {
  const task = await harness.coordinator.createPlan({
    topic: '独立开发者记账工具', template: 'pain-points', platforms: ['reddit', 'youtube'], ...input
  });
  assert.equal(task.status, 'awaiting-plan-confirmation');
  const approved = await harness.coordinator.confirmPlan(task.id);
  assert.equal(approved.status, 'awaiting-platform-preparation');
  return harness.coordinator.run(task.id);
}

test('目标到报告并只保存用户勾选结果的完整闭环', async () => {
  const harness = makeHarness();
  const finished = await prepareAndRun(harness);
  assert.equal(finished.status, 'awaiting-save');
  assert.equal(finished.results.length, 2);
  assert.equal(finished.report.summary, '发现两个平台的共同痛点');
  const saved = harness.coordinator.saveSelected(finished.id, ['reddit-1']);
  assert.equal(saved.status, 'saved');
  assert.deepEqual(saved.savedResultIds, ['reddit-1']);
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 1);
  assert.equal(harness.coordinator.getState().knowledgeEntries[0].sourceType, '社媒研究');
  assert.equal(harness.coordinator.getState().knowledgeEntries[0].sourceUrl, 'https://reddit.example/bookkeeping app');
});

test('API 无配置直接使用浏览器，API 空结果自动回退浏览器', async () => {
  const social = makeSocial({
    reddit: { search: async ({ mode }) => mode === 'api' ? [] : [{ id: 'reddit-1', platform: 'reddit', url: 'https://reddit.example/browser', title: 'browser', summary: 'ok' }] },
    youtube: { search: async ({ mode }) => mode === 'browser' ? [{ id: 'youtube-1', platform: 'youtube', url: 'https://youtube.example/browser', title: 'browser', summary: 'ok' }] : [] }
  });
  const harness = makeHarness({ social });
  const result = await prepareAndRun(harness);
  const searches = social.calls.filter(call => call[0] === 'search');
  assert.deepEqual(searches.map(call => [call[1], call[3]]), [['reddit', 'api'], ['reddit', 'browser'], ['youtube', 'browser']]);
  assert.equal(result.results.length, 2);
});

test('用户指定 API 时失败不回退浏览器', async () => {
  const social = makeSocial({ reddit: { search: async ({ mode }) => { if (mode === 'api') throw new Error('api down'); return [{ id: 'unexpected', platform: 'reddit', url: 'https://reddit.example/browser' }]; } } });
  const harness = makeHarness({ social });
  const result = await prepareAndRun(harness, { connectionModes: { reddit: 'api', youtube: 'browser' } });
  assert.equal(result.results.some(item => item.id === 'unexpected'), false);
  assert.equal(result.platformErrors.reddit.message, 'api down');
  assert.ok(harness.coordinator.getState().researchTasks[0].report.needsVerification.includes('reddit 平台执行失败，需核验：api down'));
  assert.equal(social.calls.some(call => call[1] === 'reddit' && call[3] === 'browser'), false);
});

test('单平台失败后继续执行其他平台并生成报告', async () => {
  const social = makeSocial({ reddit: { search: async () => { throw new Error('reddit failed'); } } });
  const harness = makeHarness({ social });
  const result = await prepareAndRun(harness);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].platform, 'youtube');
  assert.equal(result.status, 'awaiting-save');
  assert.equal(result.platformErrors.reddit.message, 'reddit failed');
  assert.ok(harness.coordinator.getState().researchTasks[0].report.needsVerification.includes('reddit 平台执行失败，需核验：reddit failed'));
});

test('用户取消后不执行搜索、不生成报告且不保存结果', async () => {
  const social = makeSocial();
  const harness = makeHarness({ social });
  const task = await harness.coordinator.createPlan({ topic: '取消测试', template: 'trends', platforms: ['reddit'] });
  const cancelled = harness.coordinator.cancel(task.id);
  assert.equal(cancelled.status, 'cancelled');
  await assert.rejects(() => harness.coordinator.run(task.id), /取消|终止/);
  assert.equal(social.calls.some(call => call[0] === 'search'), false);
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 0);
});

test('未勾选结果不会自动进入知识库', async () => {
  const harness = makeHarness();
  const result = await prepareAndRun(harness);
  assert.equal(result.status, 'awaiting-save');
  assert.equal(harness.coordinator.getState().knowledgeEntries.length, 0);
});
