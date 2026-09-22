import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/core/config.js';

test('初期ブラックリストに誇張や論理の飛躍によるこじつけを含む条件を追加する', () => {
  const index = DEFAULT_CONFIG.blackRules.findIndex(rule => rule.condition === '特定の地域・団体・界隈や、個人の属性を一括りにした決めつけ');
  assert.equal(DEFAULT_CONFIG.blackRules[index + 1].condition, 'ユーモアの域を超えた、明らかな誇張や論理の飛躍したこじつけ');
  assert.equal(DEFAULT_CONFIG.blackRules[index + 1].enabled, true);
  assert.equal(DEFAULT_CONFIG.blackRules[index + 1].threshold, 0.9);
});

test('実要求だけusageを加算し、キャッシュとリセットを分離する', async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  let listener;
  let calls = 0;
  const state = {
    config: { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', blackRules: [{ ...DEFAULT_CONFIG.blackRules[0], enabled: true }] },
    tokenUsage: { inputTokens: 10, outputTokens: 0, totalTokens: 0, unreportedRequests: 1 }, jevApiKeys: { typesafe: 'key' }
  };
  globalThis.chrome = {
    runtime: { onMessage: { addListener: callback => { listener = callback; } } },
    storage: { local: { get: async key => ({ [key]: state[key] }), set: async value => Object.assign(state, value) } }
  };
  globalThis.fetch = async (_url, options) => { calls++; return { ok: true, json: async () => { const body = JSON.parse(options.body); return { answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, { noul: 0.1 }])), usage: calls === 1 ? { input_tokens: 10, output_tokens: 2 } : calls === 2 ? { input_tokens: 5 } : undefined }; } }; };
  try {
    await import(`../src/background.js?usage=${Date.now()}`);
    const ask = text => new Promise(resolve => listener({ type: 'classify', text }, { url: 'https://x.com/home' }, resolve));
    const message = type => new Promise(resolve => listener({ type }, {}, resolve));
    await ask('same');
    await ask('same');
    assert.equal(calls, 1);
    assert.equal((await message('get-usage')).inputTokens, 20);
    await message('reset-usage');
    assert.equal((await message('get-usage')).inputTokens, 20);
    assert.equal((await message('get-usage')).unreportedRequests, 1);
    await ask('different');
    assert.equal((await message('get-usage')).inputTokens, 25);
    await ask('missing');
    const missing = await message('get-usage');
    assert.equal(missing.inputTokens, 25);
    assert.equal(missing.unreportedRequests, 2);
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
