import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hashCondition } from '../src/core/config.js';

test('両接続先へ条件全文を共通の問いで包んで送信する', async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const rule = { ...DEFAULT_CONFIG.blackRules.at(-1), enabled: true };
  const disabledRule = { ...DEFAULT_CONFIG.blackRules[1], enabled: false };
  let config;
  let listener;
  let request;
  const keys = {};
  globalThis.chrome = {
    runtime: { onMessage: { addListener: callback => { listener = callback; } } },
    storage: { local: { get: async key => key === 'config' ? { config } : { jevApiKeys: keys }, set: async () => {} } }
  };
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ answers: {} }) };
  };
  try {
    await import('../src/background.js');
    for (const provider of ['typesafe', 'openrouter']) {
      config = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'test-key', provider, blackRules: [rule, disabledRule] };
      keys[provider] = 'test-key';
      await new Promise(resolve => listener({ type: 'classify', text: '判定対象の本文' }, { url: 'https://x.com/home' }, resolve));
      const prefix = provider === 'openrouter' ? 'For the record with id "post": ' : '';
      const id = provider === 'openrouter' ? `post__${hashCondition(rule.condition)}` : hashCondition(rule.condition);
      assert.deepEqual(request.questions[id], {
        type: 'noul',
        instructions: `${prefix}この投稿は、次の条件に該当しますか？\n条件：${rule.condition}`
      });
      const disabledId = provider === 'openrouter' ? `post__${hashCondition(disabledRule.condition)}` : hashCondition(disabledRule.condition);
      assert.equal(request.questions[disabledId], undefined);
    }
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

test('分類要求はx.comからの送信元だけを受け付ける', async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  let listener;
  globalThis.chrome = { runtime: { onMessage: { addListener: callback => { listener = callback; } } }, storage: { local: { get: async () => ({ config: DEFAULT_CONFIG }), set: async () => {} } } };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ answers: {} }) });
  try {
    await import(`../src/background.js?sender=${Date.now()}`);
    for (const url of ['https://twitter.com/home', 'https://example.com/', undefined]) {
      const result = await new Promise(resolve => listener({ type: 'classify', text: '本文' }, url ? { url } : {}, resolve));
      assert.deepEqual(result, { error: true, reason: 'forbidden-sender' });
    }
    const allowed = await new Promise(resolve => listener({ type: 'classify', text: '本文' }, { url: 'https://x.com/home' }, resolve));
    assert.notEqual(allowed.reason, 'forbidden-sender');
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
