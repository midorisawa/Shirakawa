import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, OLLAMA_DEFAULT_MODEL, OPENROUTER_DEFAULT_MODEL, hashCondition, normalizeConfig } from '../src/core/config.js';

test('Ollamaの既定モデルはnimbleで、他接続先の既定モデルは持ち越さない', () => {
  assert.equal(normalizeConfig({ provider: 'ollama' }).model, OLLAMA_DEFAULT_MODEL);
  assert.equal(normalizeConfig({ provider: 'ollama', model: 'jev-latest' }).model, OLLAMA_DEFAULT_MODEL);
  assert.equal(normalizeConfig({ provider: 'ollama', model: OPENROUTER_DEFAULT_MODEL }).model, OLLAMA_DEFAULT_MODEL);
  assert.equal(normalizeConfig({ provider: 'ollama', model: 'nimble:custom' }).model, 'nimble:custom');
  assert.equal(normalizeConfig({ provider: 'typesafe', model: 'jev-latest' }).model, 'jev-latest');
});

async function loadBackground(config, keys = {}) {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const requests = [];
  const writes = [];
  let listener;
  globalThis.chrome = {
    runtime: { id: 'test-id', onMessage: { addListener: callback => { listener = callback; } } },
    storage: { local: { get: async key => key === 'config' ? { config } : { jevApiKeys: keys }, set: async value => { writes.push(value); } } }
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ answers: {}, usage: { input_tokens: 100 } }) };
  };
  await import(`../src/background.js?ollama=${Date.now()}-${Math.random()}`);
  const send = (message, url = 'https://x.com/home') => new Promise(resolve => listener(message, { url }, resolve));
  const restore = () => {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  };
  return { send, requests, writes, restore };
}

test('Ollamaへの判定はAPIキーなしでローカルへ送り、認証ヘッダーと使用量記録を付けない', async () => {
  const rule = { ...DEFAULT_CONFIG.blackRules.at(-1), enabled: true };
  const config = { ...DEFAULT_CONFIG, enabled: true, provider: 'ollama', model: 'nimble', blackRules: [rule], whiteRules: [] };
  const { send, requests, writes, restore } = await loadBackground(config);
  try {
    await send({ type: 'classify', text: '判定対象の本文' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://localhost:11434/v1/systemone');
    assert.equal(requests[0].options.headers.Authorization, undefined);
    assert.equal(requests[0].body.model, 'nimble');
    assert.equal(requests[0].body.state, '判定対象の本文');
    assert.deepEqual(Object.keys(requests[0].body.questions), [hashCondition(rule.condition)]);
    assert.equal(writes.some(write => 'tokenUsage' in write), false);
  } finally { restore(); }
});

test('Ollamaは使用額上限の対象外で、キー保存状態は常に設定済みとして返す', async () => {
  const rule = { ...DEFAULT_CONFIG.blackRules.at(-1), enabled: true };
  const config = { ...DEFAULT_CONFIG, enabled: true, provider: 'ollama', model: 'nimble', inputPricePerMillion: null, billingCurrency: 'JPY', blackRules: [rule], whiteRules: [] };
  const { send, requests, restore } = await loadBackground(config);
  try {
    await send({ type: 'classify', text: '本文' });
    assert.equal(requests.length, 1);
    const publicConfig = await send({ type: 'get-config' }, 'chrome-extension://test-id/options/index.html');
    assert.equal(publicConfig.keyConfiguredByProvider.ollama, true);
    assert.equal(publicConfig.keyConfiguredByProvider.typesafe, false);
  } finally { restore(); }
});

test('Ollamaの接続確認はキー不要で、指定モデルを認証ヘッダーなしで送る', async () => {
  const { send, requests, restore } = await loadBackground(DEFAULT_CONFIG);
  try {
    const url = 'chrome-extension://test-id/options/index.html';
    assert.deepEqual(await send({ type: 'verify-api-key', provider: 'ollama', apiKey: '', model: 'nimble' }, url), { ok: true, usage: { inputTokens: 100 } });
    assert.equal(requests[0].url, 'http://localhost:11434/v1/systemone');
    assert.equal(requests[0].options.headers.Authorization, undefined);
    assert.equal(requests[0].body.model, 'nimble');
    assert.deepEqual(await send({ type: 'verify-api-key', provider: 'typesafe', apiKey: '' }, url), { ok: false, reason: 'missing-key' });
    globalThis.fetch = async () => ({ ok: false, status: 403 });
    assert.deepEqual(await send({ type: 'verify-api-key', provider: 'ollama', apiKey: '' }, url), { ok: false, reason: 'forbidden' });
  } finally { restore(); }
});

test('Ollamaは他モデルの生成待ちを見込んで判定タイムアウトを延ばし、他の接続先は30秒のまま', async () => {
  const rule = { ...DEFAULT_CONFIG.blackRules.at(-1), enabled: true };
  const originalTimeout = AbortSignal.timeout;
  const timeouts = [];
  AbortSignal.timeout = ms => { timeouts.push(ms); return originalTimeout.call(AbortSignal, ms); };
  try {
    for (const [provider, expected] of [['ollama', 120000], ['typesafe', 30000]]) {
      const config = { ...DEFAULT_CONFIG, enabled: true, provider, blackRules: [rule], whiteRules: [] };
      const { send, restore } = await loadBackground(config, { [provider]: 'test-key' });
      try {
        timeouts.length = 0;
        await send({ type: 'classify', text: `本文-${provider}` });
        assert.deepEqual(timeouts, [expected]);
      } finally { restore(); }
    }
  } finally { AbortSignal.timeout = originalTimeout; }
});

test('Ollamaは並列リクエスト数1で送り、画面内の投稿を先に判定する', async () => {
  const rule = { ...DEFAULT_CONFIG.blackRules.at(-1), enabled: true };
  const results = {};
  for (const [provider, expectedMax] of [['ollama', 1], ['typesafe', 2]]) {
    const config = { ...DEFAULT_CONFIG, enabled: true, provider, blackRules: [rule], whiteRules: [] };
    const { send, restore } = await loadBackground(config, { [provider]: 'test-key' });
    const order = [];
    let active = 0;
    let maxActive = 0;
    globalThis.fetch = async (_url, options) => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(JSON.parse(options.body).state);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return { ok: true, status: 200, json: async () => ({ answers: {} }) };
    };
    try {
      await Promise.all([
        ...[0, 1, 2].map(i => send({ type: 'classify', text: `後回し-${provider}-${i}`, priority: 2 })),
        send({ type: 'classify', text: `画面内-${provider}`, priority: 0 })
      ]);
      results[provider] = { maxActive, viewportIndex: order.indexOf(`画面内-${provider}`) };
      assert.equal(maxActive, expectedMax);
    } finally { restore(); }
  }
  assert.ok(results.ollama.viewportIndex <= 1, `Ollamaでは画面内が先頭付近で送られる: ${results.ollama.viewportIndex}`);
});

test('Ollamaの接続確認は、モデルのロード待ちを見込んで他の接続先より長いタイムアウトを使う', async () => {
  const originalTimeout = AbortSignal.timeout;
  const timeouts = [];
  AbortSignal.timeout = ms => { timeouts.push(ms); return originalTimeout.call(AbortSignal, ms); };
  const { send, restore } = await loadBackground(DEFAULT_CONFIG);
  try {
    const url = 'chrome-extension://test-id/options/index.html';
    await send({ type: 'verify-api-key', provider: 'ollama', apiKey: '' }, url);
    await send({ type: 'verify-api-key', provider: 'openrouter', apiKey: 'test-key' }, url);
    assert.deepEqual(timeouts, [120000, 10000]);
  } finally {
    restore();
    AbortSignal.timeout = originalTimeout;
  }
});
