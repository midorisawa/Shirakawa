import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hashCondition } from '../src/core/config.js';

test('同一判定要求を同時に送らず成功結果を再利用する', async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const rule = { ...DEFAULT_CONFIG.blackRules.at(-1), enabled: true };
  let listener;
  let fetchCount = 0;
  let request;
  let config = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'test-key', blackRules: [rule] };
  globalThis.chrome = {
    runtime: { onMessage: { addListener: callback => { listener = callback; } } },
    storage: { local: { get: async key => key === 'config' ? ({ config }) : ({ jevApiKeys: { typesafe: 'test-key' } }), set: async () => {} } }
  };
  globalThis.fetch = async (_url, options) => { fetchCount += 1; request = JSON.parse(options.body); return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, { noul: 0 }])) }) }; };
  try {
    await import(`../src/background.js?dedupe=${Date.now()}`);
    const call = () => new Promise(resolve => listener({ type: 'classify', text: '同じ本文', postId: 'post-1' }, { url: 'https://x.com/home' }, resolve));
    await Promise.all([call(), call(), call()]);
    await call();
    config.blackRules[0] = { ...config.blackRules[0], enabled: false, threshold: 0.99 };
    await call();
    assert.equal(fetchCount, 1);
    const first = { condition: '  同じ条件  ', threshold: 0.8, enabled: false };
    const duplicate = { condition: '同じ条件', threshold: 0.2, enabled: true };
    const other = { condition: '別の条件', threshold: 0.8, enabled: false };
    config.blackRules = [first, duplicate, other];
    await new Promise(resolve => listener({ type: 'classify', text: '別本文', postId: 'post-2' }, { url: 'https://x.com/home' }, resolve));
    assert.deepEqual(Object.keys(request.questions), [hashCondition('同じ条件')]);
    config.blackRules = [other, { ...duplicate, enabled: false }, first];
    await new Promise(resolve => listener({ type: 'classify', text: '別本文', postId: 'post-2' }, { url: 'https://x.com/home' }, resolve));
    assert.equal(fetchCount, 2);
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
