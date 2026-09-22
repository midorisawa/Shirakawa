import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { DEFAULT_CONFIG } from '../src/core/config.js';

function mockDialog(dom, decide = () => true) {
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    queueMicrotask(() => {
      const result = decide(this.querySelector('#confirmMessage')?.textContent ?? '');
      if (result !== 'escape') this.returnValue = result ? 'confirm' : 'cancel';
      this.open = false;
      this.dispatchEvent(new dom.window.Event('close'));
    });
  };
}

test('編集とリスト操作は保存ボタンまで反映せず、保存時にAPIキー確認を再送しない', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  const dom = new JSDOM(readFileSync(new URL('../src/options/index.html', import.meta.url), 'utf8'));
  mockDialog(dom);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  let storageSets = 0;
  let savedConfig;
  let verificationCalls = 0;
  let unhandled;
  const onUnhandled = reason => { unhandled = reason; };
  process.on('unhandledRejection', onUnhandled);
  globalThis.chrome = {
    storage: {},
    runtime: { sendMessage: message => { if (message.type === 'verify-api-key') verificationCalls++; if (message.type === 'get-config') return Promise.resolve({ ...DEFAULT_CONFIG, apiKey: undefined, inputPricePerMillion: 0.5, keyConfigured: true }); if (message.type === 'save-config') { storageSets++; savedConfig = message.config; return Promise.resolve({ ok: true }); } return Promise.resolve(message.type === 'get-cache-size' ? { bytes: 1572864 } : message.type === 'get-usage' ? { inputTokens: 0, unreportedRequests: 0, periods: {} } : { ok: true }); } }
  };
  try {
    await import(`../src/options/index.js?stale=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(document.querySelector('#confirmDialog button[autofocus]'));
    assert.equal(document.getElementById('panel-usage').hidden, false);
    assert.equal(document.querySelector('.save-links a[href="https://forms.gle/4CB9upXFC3STrus16"]')?.textContent, '報告・要望');
    assert.equal(document.getElementById('closeWithoutSaving').querySelector('.button-icon'), null);
    const optionsCss = readFileSync(new URL('../src/options/index.css', import.meta.url), 'utf8');
    assert.match(optionsCss, /\.rule-condition textarea\s*\{[^}]*resize:\s*none/s);
    assert.doesNotMatch(optionsCss, /gap:\s*24px 12px/);
    assert.match(optionsCss, /\.rule-group:not\(\[data-editing="true"\]\) > p\[data-group\]:is\([\s\S]*?textarea \{ background: #f1f3f4/);
    const modelInput = document.getElementById('model');
    const originalModel = modelInput.value;
    assert.equal(document.getElementById('save').disabled, true);
    assert.equal(document.getElementById('closeWithoutSaving').disabled, true);
    modelInput.value = 'changed-model';
    modelInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(document.getElementById('saveState').textContent, '未保存の変更があります');
    assert.equal(document.getElementById('save').disabled, false);
    assert.equal(document.getElementById('closeWithoutSaving').disabled, false);
    modelInput.value = originalModel;
    modelInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(document.getElementById('saveState').textContent, '');
    assert.equal(document.getElementById('save').disabled, true);
    assert.equal(document.getElementById('closeWithoutSaving').disabled, true);
    const dollarLimit = document.querySelector('[data-limit-period="7d"]');
    assert.equal(dollarLimit.value, '0.50');
    dollarLimit.value = '0.5';
    dollarLimit.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(dollarLimit.value, '0.50');
    assert.equal(document.getElementById('saveState').textContent, '');
    const originalClose = dom.window.close;
    modelInput.value = 'changed-model';
    modelInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    let closed = false;
    dom.window.close = () => { closed = true; };
    document.getElementById('closeWithoutSaving').click();
    dom.window.close = originalClose;
    assert.equal(closed, true);
    assert.equal(storageSets, 0);
    modelInput.value = originalModel;
    modelInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(document.getElementById('panel-rules').hidden, true);
    document.getElementById('tab-rules').click();
    assert.equal(document.getElementById('panel-usage').hidden, true);
    assert.equal(document.getElementById('panel-rules').hidden, false);
    document.getElementById('resetInputPrice').click();
    assert.equal(document.getElementById('inputPricePerMillion').value, '0.042');
    assert.equal(storageSets, 0);
    assert.equal(document.getElementById('cacheUsageValue').textContent, '1.50');
    assert.equal(document.getElementById('cacheUsageUnit').textContent, 'MB');
    assert.equal(document.getElementById('keyStatus').textContent, '保存済み');
    assert.equal(document.getElementById('apiKeyRow').hidden, true);
    assert.equal(document.getElementById('changeApiKey').hidden, false);
    assert.equal(document.getElementById('deleteApiKey').hidden, false);
    document.getElementById('changeApiKey').click();
    assert.equal(document.getElementById('apiKeyRow').hidden, false);
    assert.equal(document.getElementById('keyStatus').textContent, '未確認');
    document.getElementById('cancelApiKey').click();
    assert.equal(document.getElementById('apiKeyRow').hidden, true);
    assert.equal(document.getElementById('keyStatus').textContent, '保存済み');
    assert.match(document.querySelector('#rules h3').textContent, /ブラックリスト/);
    const slider = document.querySelector('[data-group="black"] [data-field="threshold"]');
    assert.equal(slider.type, 'range');
    const savesBeforeDrag = storageSets;
    slider.value = '0.836';
    slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(slider.closest('.rule-threshold').querySelector('output').value, '0.84');
    assert.equal(storageSets, savesBeforeDrag);
    slider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(storageSets, savesBeforeDrag);
    assert.equal(document.getElementById('saveState').textContent, '未保存の変更があります');
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(savedConfig.blackRules[0].threshold, 0.84);
    assert.equal(document.getElementById('saveState').textContent, '');
    const textareaFocusOptions = [];
    const originalTextareaFocus = dom.window.HTMLTextAreaElement.prototype.focus;
    dom.window.HTMLTextAreaElement.prototype.focus = function (options) { textareaFocusOptions.push(options); return originalTextareaFocus.call(this, options); };
    document.querySelector('[data-edit-group="black"]').click();
    assert.equal(document.querySelector('[data-group="black"] textarea').hidden, false);
    assert.equal(document.activeElement, document.querySelector('[data-group="black"] textarea'));
    assert.deepEqual(textareaFocusOptions.at(-1), { preventScroll: true });
    const discardButton = document.querySelector('[data-edit-group="black"]');
    assert.equal(discardButton.textContent, '編集を破棄する');
    assert.equal(discardButton.querySelector('.button-icon'), null);
    assert.equal(discardButton.previousElementSibling.dataset.resetGroup, 'black');
    const blackIdsBeforeReorder = [...document.querySelectorAll('[data-group="black"]')].slice(0, 2).map(row => row.dataset.id);
    const firstHandle = document.querySelector('[data-group="black"] .rule-drag-handle');
    firstHandle.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    const blackIdsAfterReorder = [...document.querySelectorAll('[data-group="black"]')].slice(0, 2).map(row => row.dataset.id);
    assert.deepEqual(blackIdsAfterReorder, [...blackIdsBeforeReorder].reverse());
    assert.equal(document.getElementById('saveState').textContent, '未保存の変更があります');
    const blackRows = [...document.querySelectorAll('[data-group="black"]')];
    blackRows.forEach((row, index) => Object.defineProperty(row, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, right: 700, top: 100 + index * 80, bottom: 180 + index * 80, height: 80, width: 700 }) }));
    const pointerEvent = (type, values = {}) => {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      for (const [key, value] of Object.entries({ button: 0, pointerId: 7, clientX: 20, clientY: 100, ...values })) Object.defineProperty(event, key, { value });
      return event;
    };
    const handle = blackRows[0].querySelector('.rule-drag-handle');
    const blackOrderBeforePointer = blackRows.map(row => row.dataset.id);
    handle.dispatchEvent(pointerEvent('pointerdown'));
    handle.dispatchEvent(pointerEvent('pointermove', { clientY: 220 }));
    assert.equal(document.querySelector('.rule-drag-clone')?.getAttribute('aria-hidden'), 'true');
    handle.dispatchEvent(pointerEvent('pointerup', { clientY: 220 }));
    const reorderedIds = [...document.querySelectorAll('[data-group="black"]')].map(row => row.dataset.id);
    assert.notDeepEqual(reorderedIds, blackOrderBeforePointer);
    const cancelHandle = document.querySelector('[data-group="black"] .rule-drag-handle');
    cancelHandle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 8 }));
    cancelHandle.dispatchEvent(pointerEvent('pointermove', { pointerId: 8, clientY: 220 }));
    cancelHandle.dispatchEvent(pointerEvent('pointercancel', { pointerId: 8, clientY: 220 }));
    assert.equal(document.querySelector('.rule-drag-clone'), null);
    assert.deepEqual([...document.querySelectorAll('[data-group="black"]')].map(row => row.dataset.id), reorderedIds);
    const draftCondition = document.querySelector('[data-group="black"] textarea');
    draftCondition.value = '破棄される編集中の条件';
    draftCondition.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    document.querySelector('[data-edit-group="black"]').click();
    assert.equal(document.querySelector('[data-group="black"] textarea').hidden, true);
    assert.deepEqual([...document.querySelectorAll('[data-group="black"]')].slice(0, 2).map(row => row.dataset.id), blackIdsBeforeReorder);
    assert.notEqual(document.querySelector('[data-group="black"] .rule-condition-text').textContent, '破棄される編集中の条件');
    const savesBeforeEdits = storageSets;
    document.querySelector('[data-edit-group="black"]').click();
    document.querySelector('[data-add-group="black"]').click();
    const newCondition = [...document.querySelectorAll('[data-field="condition"]')].findLast(node => node.closest('p')?.dataset.group === 'black');
    assert.equal(newCondition.value, '');
    assert.equal(newCondition.placeholder, '例：攻撃的な表現を含む投稿');
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(storageSets, savesBeforeEdits);
    assert.match(document.getElementById('status').textContent, /空の条件は保存できません/);
    assert.equal(document.querySelector('[data-group="black"] textarea').hidden, false);
    newCondition.value = '保存される条件';
    newCondition.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.querySelector('[data-group="black"] textarea').hidden, true);
    document.querySelector('[data-edit-group="black"]').click();
    document.getElementById('model').value = 'custom-model';
    document.getElementById('reset-black').click();
    document.getElementById('reset-white').click();
    assert.equal(document.getElementById('model').value, 'custom-model');
    assert.equal(document.querySelectorAll('[data-group="black"]').length, DEFAULT_CONFIG.blackRules.length);
    assert.equal(document.querySelectorAll('[data-group="white"]').length, DEFAULT_CONFIG.whiteRules.length);
    document.getElementById('addUsageLimit').click();
    assert.equal(document.getElementById('usageLimitPicker').hidden, false);
    assert.equal(document.querySelector('[data-limit-period="30d"]'), null);
    document.getElementById('confirmUsageLimit').click();
    assert.equal(document.getElementById('usageLimitPicker').hidden, true);
    const addedLimit = document.querySelector('[data-limit-period="30d"]');
    assert.ok(addedLimit);
    addedLimit.value = '1.5';
    addedLimit.closest('p').querySelector('[data-remove-limit="30d"]').click();
    assert.equal(document.querySelector('[data-limit-period="30d"]'), null);
    document.getElementById('addUsageLimit').click();
    document.getElementById('usageLimitPeriod').value = '30d';
    document.getElementById('confirmUsageLimit').click();
    document.querySelector('[data-limit-period="30d"]').value = '1.5';
    document.getElementById('model').dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(storageSets, savesBeforeEdits + 1);
    const importInput = document.getElementById('import');
    Object.defineProperty(importInput, 'files', { value: [{ text: async () => JSON.stringify({ version: 2, whiteRules: [{ condition: '読み込んだ条件', threshold: 0.75, enabled: true }] }) }] });
    importInput.dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(storageSets, savesBeforeEdits + 1);
    assert.equal(document.querySelector('[data-group="white"] textarea').value, '読み込んだ条件');
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(storageSets > 1);
    assert.equal(verificationCalls, 0);
    assert.equal(document.getElementById('keyStatus').textContent, '保存済み');
    assert.equal(savedConfig.model, 'custom-model');
    assert.equal(savedConfig.usageLimits['30d'], 1.5);
    assert.equal(savedConfig.whiteRules[0].condition, '読み込んだ条件');
    assert.equal(unhandled, undefined);
  } finally {
    dom.window.close();
    process.off('unhandledRejection', onUnhandled);
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome;
  }
});

test('削除・リセット操作は保存時まで送信せず、確認キャンセルと部分失敗を保持する', async () => {
  const previous = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome };
  const dom = new JSDOM(readFileSync(new URL('../src/options/index.html', import.meta.url), 'utf8'));
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  let confirmResult = false;
  let cacheFailures = 1;
  let confirmMessage = '';
  const messages = [];
  mockDialog(dom, message => { confirmMessage = message; return confirmResult; });
  globalThis.chrome = {
    storage: {},
    runtime: { sendMessage: async message => {
      messages.push(message);
      if (message.type === 'get-config') return { ...DEFAULT_CONFIG, keyConfigured: true, keyConfiguredByProvider: { typesafe: true, openrouter: false } };
      if (message.type === 'get-usage') return { inputTokens: 0, unreportedRequests: 0, periods: {} };
      if (message.type === 'get-cache-size') return { bytes: 0 };
      if (message.type === 'clear-cache' && cacheFailures-- > 0) return { ok: false };
      return { ok: true };
    } }
  };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    await import(`../src/options/index.js?pending=${Date.now()}`);
    await tick();
    const $ = id => document.getElementById(id);
    $('clearCache').click();
    $('resetUsage').click();
    $('resetAllUsage').click();
    $('deleteApiKey').click();
    assert.equal(messages.some(message => message.type === 'clear-cache'), false);
    assert.equal(messages.some(message => message.type === 'reset-usage'), false);
    assert.equal(messages.some(message => message.type === 'reset-all-usage'), false);
    assert.equal(messages.some(message => message.type === 'delete-api-key'), false);
    assert.equal($('save').disabled, false);
    $('save').click();
    await tick();
    assert.equal(messages.some(message => message.type === 'save-config'), false);
    assert.equal(messages.some(message => message.type === 'clear-cache'), false);
    assert.equal(messages.some(message => message.type === 'reset-usage'), false);
    assert.equal(messages.some(message => message.type === 'reset-all-usage'), false);
    assert.equal(messages.some(message => message.type === 'delete-api-key'), false);
    confirmResult = true;
    $('save').click();
    await tick();
    assert.match(confirmMessage, /保存すると、以下の操作が実行されます。/);
    assert.match(confirmMessage, /キャッシュの消去/);
    assert.match(confirmMessage, /各期間の使用量のリセット/);
    assert.match(confirmMessage, /すべての使用量のリセット/);
    assert.match(confirmMessage, /TypeSafe APIキーの削除\nこのブラウザに保存されているTypeSafeのAPIキーが削除されます。/);
    assert.match(confirmMessage, /※これらの操作は元に戻せません。実行しますか？/);
    assert.equal(messages.filter(message => message.type === 'save-config').length, 1);
    assert.equal(messages.filter(message => message.type === 'clear-cache').length, 1);
    assert.equal(messages.filter(message => message.type === 'reset-usage').length, 1);
    assert.equal(messages.filter(message => message.type === 'reset-all-usage').length, 1);
    assert.equal(messages.filter(message => message.type === 'delete-api-key').length, 1);
    assert.match($('status').textContent, /一部の操作に失敗/);
    $('save').click();
    await tick();
    assert.equal(messages.filter(message => message.type === 'clear-cache').length, 2);
    assert.equal(messages.filter(message => message.type === 'reset-usage').length, 1);
    assert.equal(messages.filter(message => message.type === 'reset-all-usage').length, 1);
    assert.equal(messages.filter(message => message.type === 'delete-api-key').length, 1);
    assert.match($('status').textContent, /設定を保存しました$/);
    assert.equal($('save').disabled, true);
    $('resetInputPrice').click();
    assert.equal(messages.filter(message => message.type === 'save-config').length, 2);
    $('save').click();
    await tick();
    assert.equal(messages.filter(message => message.type === 'save-config').length, 3);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('確認後に再表示してEscapeで閉じると承認状態を引き継がない', async () => {
  const previous = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome };
  const dom = new JSDOM(readFileSync(new URL('../src/options/index.html', import.meta.url), 'utf8'));
  mockDialog(dom, (() => { const results = ['confirm', 'escape']; return () => results.shift(); })());
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  let saves = 0;
  globalThis.chrome = { storage: {}, runtime: { sendMessage: async message => { if (message.type === 'get-config') return { ...DEFAULT_CONFIG, keyConfigured: true }; if (message.type === 'save-config') saves++; return { ok: true }; } } };
  try {
    await import(`../src/options/index.js?dialog-repeat=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    document.getElementById('resetInputPrice').click();
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(saves, 1);
    document.getElementById('resetInputPrice').click();
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(saves, 1);
    assert.match(document.getElementById('status').textContent, /実行せず/);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('保存した単価で使用額を再計算し、編集中は保存済み設定で表示する', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  const dom = new JSDOM(readFileSync(new URL('../src/options/index.html', import.meta.url), 'utf8'));
  mockDialog(dom);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const config = { ...DEFAULT_CONFIG, inputPricePerMillion: 2, billingCurrency: 'USD', usageLimits: { '5h': 2, '1d': null, '7d': null, '30d': null } };
  const messages = [];
  let unknownUsage = 1;
  globalThis.chrome = {
    storage: {},
    runtime: { sendMessage: async message => { messages.push(message.type); return message.type === 'get-config' ? { ...config, keyConfigured: false } : message.type === 'get-usage' ? { inputTokens: 100000, unreportedRequests: unknownUsage, periods: { '5h': { startedAt: Date.now() - 26 * 60000, inputTokens: 100000, unreportedRequests: 0 } } } : { ok: true }; } }
  };
  try {
    await import(`../src/options/index.js?price=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(document.getElementById('usage').textContent, /累計：100,000トークン／金額不明/);
    assert.equal(document.querySelector('.budget-reset').textContent, '次回リセット：あと4時間34分');
    assert.doesNotMatch(document.getElementById('usage').textContent, /USD/);
    assert.equal(document.querySelector('.usage-budget progress').value, 90);
    assert.match(document.querySelector('.budget-metrics').textContent, /上限：USD 2\.00残り90%/);
    document.getElementById('inputPricePerMillion').value = '4';
    document.getElementById('billingCurrency').value = 'JPY';
    document.getElementById('model').dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.querySelector('.usage-budget progress').value, 90);
    assert.equal(messages.includes('save-config'), false);
    unknownUsage = 0;
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(document.getElementById('usageLimitsStatus').textContent, /JPY 0\.4/);
    assert.equal(document.getElementById('usage').textContent, '累計：100,000トークン／0.4円');
    assert.equal(document.querySelector('.usage-budget progress').value, 80);
    document.getElementById('inputPricePerMillion').value = '18';
    document.getElementById('inputPricePerMillion').dispatchEvent(new dom.window.Event('change'));
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.querySelector('.usage-budget').dataset.state, 'low');
    document.getElementById('inputPricePerMillion').value = '24';
    document.getElementById('inputPricePerMillion').dispatchEvent(new dom.window.Event('change'));
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.querySelector('.usage-budget progress').value, 0);
    assert.equal(document.querySelector('.usage-budget').dataset.state, 'exhausted');
    document.getElementById('inputPricePerMillion').value = '0';
    document.getElementById('inputPricePerMillion').dispatchEvent(new dom.window.Event('change'));
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.querySelector('.usage-budget progress').hidden, true);
    assert.equal(document.querySelector('.usage-budget').dataset.state, 'unknown');
    assert.ok(messages.includes('get-usage'));
  } finally {
    dom.window.close();
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome;
  }
});

test('初回キー保存と接続先別の保存状態を表示し、不正な設定は保存しない', async () => {
  const previous = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome };
  const dom = new JSDOM(readFileSync(new URL('../src/options/index.html', import.meta.url), 'utf8'));
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  const messages = [];
  let failSave = false;
  let finishSave;
  let holdSave = false;
  globalThis.chrome = {
    storage: {},
    runtime: { sendMessage: async message => {
      messages.push(message);
      if (message.type === 'get-config') return { ...DEFAULT_CONFIG, keyConfigured: false, keyConfiguredByProvider: { typesafe: false, openrouter: true } };
      if (message.type === 'get-usage') return { inputTokens: 0 };
      if (message.type === 'get-cache-size') return { bytes: 0 };
      if (message.type === 'save-config' && failSave) return { ok: false };
      if (message.type === 'save-config' && holdSave) return new Promise(resolve => { finishSave = resolve; });
      return { ok: true };
    } }
  };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    await import(`../src/options/index.js?first-key=${Date.now()}`);
    await tick();
    const $ = id => document.getElementById(id);
    $('tab-connection').click();
    assert.equal($('saveApiKey').hidden, false);
    $('apiKey').value = 'test-only-key';
    $('saveApiKey').click();
    await tick();
    assert.ok(messages.some(message => message.type === 'verify-api-key'));
    assert.ok(messages.some(message => message.type === 'set-api-key'));
    assert.equal($('apiKeyRow').hidden, true);
    assert.match($('keyStatus').textContent, /保存済み/);
    assert.equal($('keyStatus').closest('[hidden]'), null);
    $('provider').value = 'openrouter';
    $('provider').dispatchEvent(new dom.window.Event('change'));
    await tick();
    assert.equal($('apiKeyRow').hidden, true);
    assert.equal($('changeApiKey').hidden, false);
    $('decisionCacheLimitMb').value = '-1';
    const savesBefore = messages.filter(message => message.type === 'save-config').length;
    $('decisionCacheLimitMb').dispatchEvent(new dom.window.Event('change'));

    $('save').click();
    await tick();
    assert.equal(messages.filter(message => message.type === 'save-config').length, savesBefore);
    assert.match($('status').textContent, /保存されていません/);
    assert.equal(document.activeElement, $('decisionCacheLimitMb'));
    assert.equal($('panel-cache').hidden, false);
    $('decisionCacheLimitMb').value = '200';
    $('decisionCacheLimitMb').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    failSave = true;
    $('save').click();
    await tick();
    assert.match($('status').textContent, /保存できません/);
    assert.equal($('saveState').textContent, '未保存の変更があります');
    assert.equal($('save').disabled, false);
    failSave = false;
    holdSave = true;
    $('save').click();
    assert.equal($('save').disabled, true);
    $('model').value = 'edited-during-save';
    $('model').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    finishSave({ ok: true });
    await tick();
    assert.equal($('saveState').textContent, '未保存の変更があります');
    holdSave = false;
    $('save').click();
    await tick();
    assert.equal($('saveState').textContent, '');
    assert.equal($('status').textContent, '設定を保存しました');
    assert.equal(messages.filter(message => message.type === 'save-config').at(-1).config.model, 'edited-during-save');
    $('model').value = 'unsaved-model';
    $('model').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const previousEnabled = $('enabled').checked;
    $('enabled').click();
    assert.equal($('save').disabled, true);
    await tick();
    const toggleSave = messages.filter(message => message.type === 'save-config').at(-1).config;
    assert.equal(toggleSave.enabled, !previousEnabled);
    assert.equal(toggleSave.model, 'edited-during-save');
    assert.equal($('model').value, 'unsaved-model');
    assert.equal($('saveState').textContent, '未保存の変更があります');
    failSave = true;
    $('enabled').click();
    await tick();
    assert.equal($('enabled').checked, !previousEnabled);
    assert.match($('status').textContent, /切り替えを保存できません/);
    assert.equal($('save').disabled, false);
    failSave = false;
    $('enabled').click();
    await tick();
    assert.equal(messages.filter(message => message.type === 'save-config').at(-1).config.enabled, false);
    $('model').value = 'changed-while-disabled';
    $('model').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    $('save').click();
    await tick();
    assert.equal(messages.filter(message => message.type === 'save-config').at(-1).config.enabled, false);
    $('enabled').click();
    await tick();
    const reenabledConfig = messages.filter(message => message.type === 'save-config').at(-1).config;
    assert.equal(reenabledConfig.enabled, true);
    assert.equal(reenabledConfig.model, 'changed-while-disabled');
    while (document.querySelector('[data-remove-limit]')) document.querySelector('[data-remove-limit]').click();
    $('save').click();
    await tick();
    const withoutLimits = messages.filter(message => message.type === 'save-config').at(-1).config;
    assert.ok(Object.values(withoutLimits.usageLimits).every(limit => limit === null));
    assert.equal($('usageLimitsStatus').textContent, '利用上限はありません。');
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
