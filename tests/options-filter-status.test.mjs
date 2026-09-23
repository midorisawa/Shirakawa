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
    const enabledLabel = document.getElementById('enabledLabel');
    const enabledIcon = document.getElementById('enabledIcon');
    const enabledCopy = enabledLabel.closest('.enabled-copy');
    assert.equal(enabledLabel.textContent, '無効');
    assert.equal(dom.window.getComputedStyle(enabledLabel).color, 'var(--muted)');
    assert.equal(dom.window.getComputedStyle(enabledLabel).fontSize, '14px');
    assert.equal(dom.window.getComputedStyle(enabledLabel).fontWeight, '600');
    assert.equal(dom.window.getComputedStyle(enabledLabel).minWidth, '0px');
    assert.equal(enabledLabel.textContent.length, 2);
    assert.equal(enabledCopy.children.length, 2);
    assert.equal(dom.window.getComputedStyle(enabledCopy).width, '46px');
    assert.equal(dom.window.getComputedStyle(enabledCopy).flexBasis, '46px');
    assert.equal(dom.window.getComputedStyle(enabledCopy).lineHeight, '16px');
    assert.equal(dom.window.getComputedStyle(enabledIcon).width, '16px');
    assert.equal(dom.window.getComputedStyle(enabledIcon).display, 'none');
    assert.equal(collapse.classList.contains('is-visible'), false);
    assert.equal(collapse.getAttribute('aria-hidden'), 'true');
    const notice = document.getElementById('filterStatus');
    assert.equal(notice.querySelector('.filter-status-mark').textContent, '!');
    assert.equal(dom.window.getComputedStyle(notice).marginTop, '8px');
    assert.equal(dom.window.getComputedStyle(notice).marginBottom, '4px');

    enabledLabel.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(collapse.classList.contains('is-visible'), true);
    assert.equal(enabledLabel.textContent, '有効');
    assert.equal(dom.window.getComputedStyle(enabledIcon).display, 'inline-block');
    assert.equal(dom.window.getComputedStyle(enabledCopy).gap, '2px');
    assert.equal(dom.window.getComputedStyle(enabledLabel.closest('.toggle-control')).gap, '8px');
    assert.equal(dom.window.getComputedStyle(enabledLabel).color, 'var(--blue)');
    assert.equal(dom.window.getComputedStyle(enabledLabel).fontSize, '14px');
    assert.equal(dom.window.getComputedStyle(enabledLabel).fontWeight, '600');
    assert.equal(enabledIcon.getAttribute('aria-hidden'), 'true');
    assert.equal(collapse.getAttribute('aria-hidden'), 'false');
    assert.equal(text.textContent, 'APIキーが未設定のため、フィルターを有効にしても判定できません。API接続を設定してください。');
    assert.equal(dom.window.getComputedStyle(notice).backgroundColor, 'rgb(251, 248, 242)');
    assert.equal(document.getElementById('status').textContent, 'フィルターを有効にしました');
    const previousTimer = transientTimers.keys().next().value;
    assert.equal(transientTimers.size, 1);
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(transientTimers.size, 1);
    assert.equal(transientTimers.has(previousTimer), false);
    [...transientTimers.values()][0]();
    transientTimers.clear();
    assert.equal(document.getElementById('status').textContent, '');
    assert.equal(collapse.classList.contains('is-visible'), true);
    assert.notEqual(text.textContent, '');

    enabledIcon.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(collapse.classList.contains('is-visible'), false);
    assert.equal(collapse.getAttribute('aria-hidden'), 'true');
    assert.equal(text.textContent, '');
    assert.equal(enabledLabel.textContent, '無効');
    assert.equal(dom.window.getComputedStyle(enabledLabel).color, 'var(--muted)');
    assert.equal(dom.window.getComputedStyle(enabledIcon).display, 'none');

    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(collapse.classList.contains('is-visible'), true);
    assert.notEqual(text.textContent, '');
    const emptyCondition = document.querySelector('#rules [data-field="condition"]');
    emptyCondition.value = '';
    emptyCondition.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.match(document.getElementById('status').textContent, /空の条件は保存されません/);
    assert.equal(transientTimers.size, 1);
    [...transientTimers.values()][0]();
    transientTimers.clear();
    assert.equal(document.getElementById('status').textContent, '');
    assert.notEqual(text.textContent, '');
  } finally {
    dom.window.close();
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
  }
});
