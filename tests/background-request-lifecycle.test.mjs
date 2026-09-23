import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DEFAULT_CONFIG, hashCondition } from '../src/core/config.js';
const NO_LIMITS = { '5h': null, '1d': null, '7d': null, '30d': null };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function load(config, fetchImpl) {
  let listener;
  let changed;
  const state = { config, jevApiKeys: { [config.provider]: config.apiKey || 'test-key' }, tokenUsage: {}, usage: {} };
  globalThis.chrome = {
    runtime: { id: 'test', onMessage: { addListener: callback => { listener = callback; } } },
    storage: { onChanged: { addListener: callback => { changed = callback; } }, local: {
      get: async key => ({ [key]: state[key] }),
      set: async value => Object.assign(state, value)
    } }
  };
  globalThis.fetch = fetchImpl;
  await import(`../src/background.js?lifecycle=${Date.now()}-${Math.random()}`);
  const call = text => new Promise(resolve => listener({ type: 'classify', text, postId: text }, { url: 'https://x.com/home' }, resolve));
  const clear = () => new Promise(resolve => listener({ type: 'clear-cache' }, {}, resolve));
  const setKey = apiKey => new Promise(resolve => listener({ type: 'set-api-key', provider: config.provider, apiKey }, { url: 'chrome-extension://test/options/index.html' }, resolve));
  return { call, clear, setKey, changed, state };
}

test('キー変更後の待機中要求は旧キーで送信しない', { timeout: 5000 }, async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const rule = { ...DEFAULT_CONFIG.blackRules[0], enabled: true };
  const config = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'old-key', usageLimits: NO_LIMITS, blackRules: [rule], whiteRules: [] };
  const calls = [];
  const startedA = deferred();
  const startedB = deferred();
  let releaseA;
  let releaseB;
  try {
    const h = await load(config, async (_url, options) => {
      const key = options.headers.Authorization;
      const state = JSON.parse(options.body).state;
      calls.push({ state, key });
      if (state === 'A') { startedA.resolve(); await new Promise(resolve => { releaseA = resolve; }); }
      if (state === 'B') { startedB.resolve(); await new Promise(resolve => { releaseB = resolve; }); }
      return { ok: true, json: async () => ({ answers: { [hashCondition(rule.condition)]: { noul: 0 } } }) };
    });
    const a = h.call('A');
    const b = h.call('B');
    await Promise.all([startedA.promise, startedB.promise]);
    const waiting = h.call('C');
    await new Promise(resolve => setImmediate(resolve));
    await h.setKey('new-key');
    releaseA(); releaseB();
    const result = await waiting;
    assert.ok(result.unknown || result.answers);
    assert.equal(calls.some(call => call.state === 'C' && call.key === 'Bearer old-key'), false);
    assert.deepEqual(calls.filter(call => call.key === 'Bearer old-key').map(call => call.state), ['A', 'B']);
    await Promise.all([a, b]);
  } finally { globalThis.chrome = old.chrome; globalThis.fetch = old.fetch; }
});

test('設定無効化後に待機中の要求をAPIへ送信しない', { timeout: 5000 }, async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const rule = { ...DEFAULT_CONFIG.blackRules[0], enabled: true };
  const config = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', usageLimits: NO_LIMITS, blackRules: [rule], whiteRules: [] };
  const started = deferred();
  let startedCount = 0;
  let release;
  try {
    const h = await load(config, async () => { startedCount++; started.resolve(); await new Promise(resolve => { release = resolve; }); return { ok: true, json: async () => ({ answers: { [hashCondition(rule.condition)]: { noul: 0 } } }) }; });
    const first = h.call('A');
    await started.promise;
    const second = h.call('B');
    h.state.config = { ...config, enabled: false };
    h.changed({ config: { oldValue: config, newValue: h.state.config } });
    release();
    await Promise.all([first, second]);
    assert.equal(startedCount, 1);
  } finally { globalThis.chrome = old.chrome; globalThis.fetch = old.fetch; }
});

test('無効条件の回答欠落はcacheへ保存し、有効化時は不足分だけ送信する', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const firstRule = { ...DEFAULT_CONFIG.blackRules[0], enabled: true };
  const secondRule = { ...DEFAULT_CONFIG.blackRules[1], enabled: false };
  const config = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', usageLimits: NO_LIMITS, blackRules: [firstRule, secondRule], whiteRules: [] };
  const calls = [];
  try {
    const h = await load(config, async (_url, options) => { const body = JSON.parse(options.body); calls.push(Object.keys(body.questions)); return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, { noul: 0 }])) }) }; });
    const first = await h.call('同じ本文');
    const second = await h.call('同じ本文');
    assert.ok(first.answers);
    assert.ok(second.answers);
    assert.equal(calls.length, 1);
    h.state.config = { ...config, blackRules: [{ ...firstRule }, { ...secondRule, enabled: true }] };
    h.changed({ config: { oldValue: config, newValue: h.state.config } });
    const activated = await h.call('同じ本文');
    assert.ok(activated.answers);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], [firstRule.id]);
    assert.deepEqual(calls[1], [secondRule.id]);
  } finally { globalThis.chrome = old.chrome; globalThis.fetch = old.fetch; }
});

test('全条件が無効ならAPIを呼ばずno-active-ruleを返す', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const config = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', usageLimits: NO_LIMITS, blackRules: [{ ...DEFAULT_CONFIG.blackRules[0], enabled: false }], whiteRules: [] };
  let fetchCount = 0;
  try {
    const h = await load(config, async () => { fetchCount++; throw new Error('呼び出し不要'); });
    assert.deepEqual(await h.call('対象本文'), { unknown: true, reason: 'no-active-rule' });
    assert.equal(fetchCount, 0);
  } finally { globalThis.chrome = old.chrome; globalThis.fetch = old.fetch; }
});

test('cache clear中の待機要求を重複送信しない', { timeout: 5000 }, async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB };
  const rule = { ...DEFAULT_CONFIG.blackRules[0], enabled: true };
  const config = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', usageLimits: NO_LIMITS, blackRules: [rule], whiteRules: [] };
  const calls = [];
  const startedA = deferred();
  const startedB = deferred();
  let releaseA;
  let releaseB;
  try {
    globalThis.indexedDB = new IDBFactory();
    const h = await load(config, async (_url, options) => { const state = JSON.parse(options.body).state; calls.push(state); if (state === 'A') { startedA.resolve(); await new Promise(resolve => { releaseA = resolve; }); } if (state === 'B') { startedB.resolve(); await new Promise(resolve => { releaseB = resolve; }); } return { ok: true, json: async () => ({ answers: { [hashCondition(rule.condition)]: { noul: 0 } } }) }; });
    const first = h.call('A');
    const second = h.call('B');
    await Promise.all([startedA.promise, startedB.promise]);
    const queued = h.call('C');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(await h.clear(), { ok: true });
    const fresh = h.call('C');
    releaseA();
    releaseB();
    const results = await Promise.all([first, second, queued, fresh]);
    assert.deepEqual(calls, ['A', 'B', 'C']);
    assert.equal(results[0].reason, 'cache-cleared');
    assert.equal(results[1].reason, 'cache-cleared');
    assert.equal(results[2].reason, 'cache-cleared');
    assert.ok(results[3].answers);
  } finally { globalThis.chrome = old.chrome; globalThis.fetch = old.fetch; if (old.indexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = old.indexedDB; }
});

test('API失敗後に後続要求のキュー処理を再開する', { timeout: 5000 }, async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const rule = { ...DEFAULT_CONFIG.blackRules[0], enabled: true };
  const config = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', usageLimits: NO_LIMITS, blackRules: [rule], whiteRules: [] };
  let fetchCount = 0;
  let releaseB;
  const startedA = deferred();
  const startedB = deferred();
  const startedC = deferred();
  try {
    const h = await load(config, async (_url, options) => {
      fetchCount++;
      const state = JSON.parse(options.body).state;
      if (state === '失敗する本文') { startedA.resolve(); throw Object.assign(new Error('timeout'), { reason: 'timeout' }); }
      if (state === '保持する本文') { startedB.resolve(); await new Promise(resolve => { releaseB = resolve; }); }
      if (state === '復旧する本文') startedC.resolve();
      return { ok: true, json: async () => ({ answers: { [hashCondition(rule.condition)]: { noul: 0 } } }) };
    });
    const failed = h.call('失敗する本文');
    const held = h.call('保持する本文');
    await Promise.all([startedA.promise, startedB.promise]);
    assert.equal((await failed).reason, 'timeout');
    const resumed = h.call('復旧する本文');
    await startedC.promise;
    releaseB();
    const [heldResult, resumedResult] = await Promise.all([held, resumed]);
    assert.ok(heldResult.answers);
    assert.ok(resumedResult.answers);
    assert.equal(fetchCount, 3);
  } finally { globalThis.chrome = old.chrome; globalThis.fetch = old.fetch; }
});
