import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { DEFAULT_CONFIG } from '../src/core/config.js';

test('Ollama選択時はAPIキー欄を隠し、接続許可を求めてから接続確認する', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  const dom = new JSDOM(readFileSync(new URL('../src/options/index.html', import.meta.url), 'utf8'));
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const messages = [];
  let granted = true;
  let permissionRequest;
  let verifyResult = { ok: true };
  globalThis.chrome = {
    storage: {},
    permissions: { request: async request => { permissionRequest = request; return granted; } },
    runtime: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      sendMessage: async message => {
        messages.push(message);
        if (message.type === 'get-config') return { ...DEFAULT_CONFIG, keyConfigured: false, keyConfiguredByProvider: { typesafe: false, openrouter: false, ollama: true } };
        if (message.type === 'verify-api-key') return verifyResult;
        return { ok: true };
      }
    }
  };
  try {
    await import(`../src/options/index.js?ollama=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    const provider = document.getElementById('provider');
    assert.equal(document.getElementById('verifyLocal').hidden, true);
    provider.value = 'ollama';
    provider.dispatchEvent(new dom.window.Event('change'));
    assert.equal(document.getElementById('model').value, 'nimble');
    assert.equal(document.getElementById('apiKeyRow').hidden, true);
    assert.equal(document.getElementById('saveApiKey').hidden, true);
    assert.equal(document.getElementById('deleteApiKey').hidden, true);
    assert.equal(document.getElementById('verifyLocal').hidden, false);
    assert.equal(document.getElementById('local-note').hidden, false);
    assert.equal(document.getElementById('provider-note').hidden, true);
    assert.equal(document.getElementById('apiKeyLabel').textContent, '接続状態');

    document.getElementById('verifyLocal').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(permissionRequest, { origins: ['http://localhost:11434/*'] });
    assert.deepEqual(messages.findLast(message => message.type === 'verify-api-key'), { type: 'verify-api-key', provider: 'ollama', apiKey: '', model: 'nimble' });
    assert.equal(document.getElementById('keyStatus').textContent, '接続できました');

    verifyResult = { ok: false, reason: 'forbidden' };
    document.getElementById('verifyLocal').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(document.getElementById('keyStatus').textContent, /OLLAMA_ORIGINSにchrome-extension:\/\/abcdefghijklmnopabcdefghijklmnop/);

    granted = false;
    const before = messages.length;
    document.getElementById('verifyLocal').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(messages.length, before);
    assert.match(document.getElementById('keyStatus').textContent, /許可されていません/);

    provider.value = 'typesafe';
    provider.dispatchEvent(new dom.window.Event('change'));
    assert.equal(document.getElementById('model').value, 'jev-latest');
    assert.equal(document.getElementById('verifyLocal').hidden, true);
    assert.equal(document.getElementById('apiKeyLabel').textContent, 'APIキー');
    assert.equal(document.getElementById('key-note').hidden, false);
    assert.equal(document.getElementById('provider-note').hidden, false);
  } finally {
    dom.window.close();
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome;
  }
});
