import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/core/config.js';

test('アイコンは無効・キー欠落・通信失敗・復旧に連動する', async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const stored = { config: { ...DEFAULT_CONFIG, enabled: false, usageLimits: {} } };
  let listener;
  const icons = [];
  globalThis.chrome = {
    action: { setIcon: async value => icons.push(value.path), setTitle: async () => {} },
    runtime: { id: 'test', onMessage: { addListener: callback => { listener = callback; } }, sendMessage: async () => {} },
    storage: { local: { get: async key => ({ [key]: stored[key] }), set: async values => Object.assign(stored, values) } }
  };
  const send = async (message, url = 'chrome-extension://test/options/index.html') => {
    const result = await new Promise(resolve => listener(message, { url }, resolve));
    await new Promise(resolve => setTimeout(resolve, 0));
    return result;
  };
  try {
    await import(`../src/background.js?icons=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(icons.at(-1)[16], 'icons/icon-disabled16.png');
    await send({ type: 'save-config', config: { ...stored.config, enabled: true } });
    assert.equal(icons.at(-1)[32], 'icons/icon-error32.png');
    await send({ type: 'set-api-key', provider: 'typesafe', apiKey: 'test-key' });
    assert.equal(icons.at(-1)[48], 'icons/icon48.png');
    globalThis.fetch = async () => { throw new Error('network'); };
    await send({ type: 'classify', text: '失敗する投稿' }, 'https://x.com/home');
    assert.equal(icons.at(-1)[16], 'icons/icon-error16.png');
    globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => { const body = JSON.parse(options.body); return { answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, { noul: 0 }])), usage: { input_tokens: 1 } }; } });
    await send({ type: 'classify', text: '復旧した投稿' }, 'https://x.com/home');
    assert.equal(icons.at(-1)[16], 'icons/icon16.png');
    await send({ type: 'delete-api-key', provider: 'typesafe' });
    assert.equal(icons.at(-1)[16], 'icons/icon-error16.png');
    await send({ type: 'save-config', config: { ...stored.config, enabled: false } });
    assert.equal(icons.at(-1)[16], 'icons/icon-disabled16.png');
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
