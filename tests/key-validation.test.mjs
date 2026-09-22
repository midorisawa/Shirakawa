import test from 'node:test';
import assert from 'node:assert/strict';

test('APIキー確認は認証・権限・通信・成功を区別し、投稿本文を送らない', async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  let listener;
  let request;
  globalThis.chrome = { runtime: { id: 'test-id', onMessage: { addListener: callback => { listener = callback; } } }, storage: { local: { get: async () => ({}), set: async () => {} } } };
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200 };
  };
  try {
    await import(`../src/background.js?key-validation=${Date.now()}`);
    const verify = provider => new Promise(resolve => listener({ type: 'verify-api-key', provider, apiKey: '  secret  ' }, { url: 'chrome-extension://test-id/options/index.html' }, resolve));
    assert.deepEqual(await verify('typesafe'), { ok: true });
    assert.equal(request.url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(request.options.method, 'POST');
    assert.match(request.options.body, /APIキー接続確認/);
    assert.doesNotMatch(request.options.body, /投稿本文/);
    for (const [status, reason] of [[401, 'unauthorized'], [403, 'forbidden'], [500, 'http-error']]) {
      globalThis.fetch = async () => ({ ok: false, status });
      const result = await verify('openrouter');
      assert.equal(result.reason, reason);
      if (status === 500) assert.equal(result.status, 500);
    }
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.deepEqual(await verify('openrouter'), { ok: false, reason: 'network-error' });
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
