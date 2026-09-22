import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/core/config.js';

test('設定更新をXのcontent scriptへタブ通知する', async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const state = { config: { ...DEFAULT_CONFIG, enabled: true }, jevApiKeys: { typesafe: 'test-key' }, tokenUsage: {} };
  const sent = [];
  let listener;
  globalThis.chrome = {
    runtime: {
      id: 'test-id',
      onMessage: { addListener: callback => { listener = callback; } },
      sendMessage: async message => sent.push({ target: 'runtime', message })
    },
    tabs: {
      query: async query => { sent.push({ target: 'query', query }); return [{ id: 41 }, { id: 42 }]; },
      sendMessage: async (tabId, message) => sent.push({ target: tabId, message })
    },
    storage: {
      local: {
        get: async key => key === 'jevApiKeys' ? { jevApiKeys: state.jevApiKeys } : { [key]: state[key] },
        set: async value => Object.assign(state, value)
      }
    }
  };
  globalThis.fetch = originalFetch;
  try {
    await import(`../src/background.js?notify-tabs=${Date.now()}`);
    const result = await new Promise(resolve => listener({ type: 'save-config', config: { ...state.config, enabled: false } }, { url: 'chrome-extension://test-id/options/index.html' }, resolve));
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(sent.find(item => item.target === 'query')?.query, { url: ['https://x.com/*'] });
    const tabMessages = sent.filter(item => item.target === 41 || item.target === 42);
    assert.equal(tabMessages.length, 2);
    assert.ok(tabMessages.every(item => item.message.type === 'config-updated'));
    assert.ok(tabMessages.every(item => item.message.config.enabled === false));
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
