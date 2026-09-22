import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/core/config.js';

function harness(options) {
  const { tokenUsage = {}, usageLimits = { '5h': 0.01, '1d': null, '7d': null, '30d': null }, responses = [] } = options;
  let listener; let configChanged; let calls = 0;
  const state = { config: { ...DEFAULT_CONFIG, enabled: true, usageLimits, apiKey: 'key', blackRules: [{ ...DEFAULT_CONFIG.blackRules[0], enabled: true }] }, tokenUsage };
  globalThis.chrome = { runtime: { id: 'test-id', onMessage: { addListener: callback => { listener = callback; } } }, storage: { onChanged: { addListener: callback => { configChanged = callback; } }, local: { get: async key => key === 'jevApiKeys' ? { jevApiKeys: { typesafe: 'key' } } : ({ [key]: state[key] }), set: async value => Object.assign(state, value) } } };
  globalThis.fetch = async (_url, requestOptions) => ({ ok: true, json: async () => { await options.beforeResponse?.(); const body = JSON.parse(requestOptions.body); return { answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, { noul: 0 }])), usage: responses[Math.min(calls++, responses.length - 1)] }; } });
  return { state, ask: text => new Promise(resolve => listener({ type: 'classify', text }, { url: 'https://x.com/home' }, resolve)), message: type => new Promise(resolve => listener({ type }, {}, resolve)), changeConfig: async config => { state.config = config; configChanged?.({ config: { newValue: config } }); await new Promise(resolve => setTimeout(resolve, 0)); }, saveConfig: config => new Promise(resolve => listener({ type: 'save-config', config }, { url: 'chrome-extension://test-id/options/index.html' }, result => { state.config = config; resolve(result); })) };
}
async function withHarness(options, name, callback) {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch, now: Date.now };
  try { const h = harness(options); await import(`../src/background.js?${name}=${Date.now()}-${Math.random()}`); await callback(h); }
  finally { Date.now = old.now; if (old.chrome === undefined) delete globalThis.chrome; else globalThis.chrome = old.chrome; if (old.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = old.fetch; }
}

test('複数上限はどれか一つに到達した時点で次の要求を停止する', () => withHarness({ responses: [{ input_tokens: 1_000_000 }], usageLimits: { '5h': 0.01, '1d': null, '7d': 100, '30d': null } }, 'multiple-limits', async h => { assert.equal((await h.ask('first')).unknown, undefined); assert.deepEqual(await h.ask('second'), { unknown: true, reason: 'daily-cost-limit' }); }));
test('短期区間がリセットしても長期上限の消費は継続する', () => withHarness({ tokenUsage: { inputTokens: 0, unreportedRequests: 0, periods: { '5h': { startedAt: 1_000_000, inputTokens: 0, unreportedRequests: 0 }, '7d': { startedAt: 1_000_000, inputTokens: 0, unreportedRequests: 0 } } }, usageLimits: { '5h': 0.01, '1d': null, '7d': 0.05, '30d': null }, responses: [{ input_tokens: 1_000_000 }, { input_tokens: 1_000_000 }] }, 'long-limit', async h => { Date.now = () => 1_000_000; await h.ask('first'); Date.now = () => 1_000_000 + 5 * 60 * 60 * 1000; assert.equal((await h.ask('second')).unknown, undefined); assert.deepEqual(await h.ask('third'), { unknown: true, reason: 'daily-cost-limit' }); }));
test('設定保存で追加した期間は保存時刻から開始し、既存期間の履歴を保持する', () => withHarness({ tokenUsage: { inputTokens: 12, unreportedRequests: 0, periods: { '7d': { startedAt: 1_000_000, inputTokens: 12, unreportedRequests: 0 } } }, usageLimits: { '5h': null, '1d': null, '7d': null, '30d': null } }, 'config-period-start', async h => { Date.now = () => 1_000_000; assert.equal((await h.message('get-usage')).periods['7d'].inputTokens, 12); Date.now = () => 1_001_234; assert.deepEqual(await h.saveConfig({ ...h.state.config, usageLimits: { '5h': 1, '1d': null, '7d': null, '30d': null } }), { ok: true }); const after = await h.message('get-usage'); assert.equal(after.periods['5h'].startedAt, 1_001_234); assert.equal(after.periods['7d'].inputTokens, 12); }));
test('設定保存とAPI使用量計上が重なっても既存期間のトークンを失わない', () => {
  const options = { tokenUsage: { inputTokens: 12, unreportedRequests: 0, periods: { '7d': { startedAt: Date.now(), inputTokens: 12, unreportedRequests: 0 } } }, usageLimits: { '5h': null, '1d': null, '7d': null, '30d': null }, responses: [{ input_tokens: 3 }] };
  return withHarness(options, 'config-usage-race', async h => {
    options.beforeResponse = () => h.saveConfig({ ...h.state.config, usageLimits: { '5h': 1, '1d': null, '7d': null, '30d': null } });
    await h.ask('race');
    const usage = await h.message('get-usage');
    assert.equal(usage.inputTokens, 15);
    assert.equal(usage.periods['7d'].inputTokens, 15);
    assert.equal(usage.periods['5h'].inputTokens, 3);
  });
});
test('期間使用量が不明なときは予算判定を停止する', () => withHarness({ tokenUsage: { inputTokens: 0, unreportedRequests: 1, periods: { '5h': { startedAt: Date.now(), inputTokens: 0, unreportedRequests: 1 } } }, usageLimits: { '5h': 0.01, '1d': null, '7d': null, '30d': null } }, 'unknown-budget', async h => { assert.deepEqual(await h.ask('blocked'), { unknown: true, reason: 'cost-unknown' }); }));
