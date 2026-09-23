import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { DEFAULT_CONFIG } from '../src/core/config.js';

test('APIキー未設定のままフィルターを有効にすると案内が開閉し、通常通知は5秒で消える', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  const dom = new JSDOM(readFileSync(new URL('../src/options/index.html', import.meta.url), 'utf8'));
  const style = dom.window.document.createElement('style');
  style.textContent = readFileSync(new URL('../src/options/index.css', import.meta.url), 'utf8');
  dom.window.document.head.append(style);
  const realSetTimeout = dom.window.setTimeout.bind(dom.window);
  const realClearTimeout = dom.window.clearTimeout.bind(dom.window);
  let nextTimer = 1;
  const transientTimers = new Map();
  dom.window.setTimeout = (callback, delay, ...args) => {
    if (delay === 5000) {
      const id = nextTimer++;
      transientTimers.set(id, () => callback(...args));
      return id;
    }
    return realSetTimeout(callback, delay, ...args);
  };
  dom.window.clearTimeout = id => {
    transientTimers.delete(id);
    return realClearTimeout(id);
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.chrome = {
    storage: {},
    runtime: { sendMessage: message => {
      if (message.type === 'get-config') return Promise.resolve({ ...DEFAULT_CONFIG, keyConfigured: false, keyConfiguredByProvider: { typesafe: false } });
      if (message.type === 'get-usage') return Promise.resolve({ inputTokens: 0, unreportedRequests: 0, periods: {} });
      if (message.type === 'get-cache-size') return Promise.resolve({ bytes: 0 });
      return Promise.resolve({ ok: true });
    } }
  };
  try {
    await import(`../src/options/index.js?filter-status=${Date.now()}`);
    await new Promise(resolve => setImmediate(resolve));
    const checkbox = document.getElementById('enabled');
    const collapse = document.querySelector('.filter-status-collapse');
    const text = document.getElementById('filterStatusText');
    assert.equal(collapse.classList.contains('is-visible'), false);
    assert.equal(collapse.getAttribute('aria-hidden'), 'true');
    const notice = document.getElementById('filterStatus');
    assert.equal(notice.querySelector('.filter-status-mark').textContent, '!');
    assert.equal(dom.window.getComputedStyle(notice).marginTop, '4px');
    assert.equal(dom.window.getComputedStyle(notice).marginBottom, '4px');

    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(collapse.classList.contains('is-visible'), true);
    assert.equal(collapse.getAttribute('aria-hidden'), 'false');
    assert.equal(text.textContent, 'APIキーが未設定のため、フィルターを有効にしても判定できません。API接続を設定してください。');
    assert.equal(dom.window.getComputedStyle(notice).backgroundColor, 'rgb(251, 248, 242)');
    assert.equal(document.getElementById('status').textContent, 'フィルターを有効にしました');
    assert.equal(transientTimers.size, 1);
    [...transientTimers.values()][0]();
    transientTimers.clear();
    assert.equal(document.getElementById('status').textContent, '');
    assert.equal(collapse.classList.contains('is-visible'), true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(collapse.classList.contains('is-visible'), false);
    assert.equal(collapse.getAttribute('aria-hidden'), 'true');
    assert.equal(text.textContent, '');

    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(collapse.classList.contains('is-visible'), true);
    assert.notEqual(text.textContent, '');
  } finally {
    dom.window.close();
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
  }
});
