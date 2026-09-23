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
  globalThis.chrome = {
    storage: {},
    runtime: { sendMessage: message => { if (message.type === 'verify-api-key') verificationCalls++; if (message.type === 'get-config') return Promise.resolve({ ...DEFAULT_CONFIG, apiKey: undefined, inputPricePerMillion: 0.5, keyConfigured: true }); if (message.type === 'save-config') { storageSets++; savedConfig = message.config; return Promise.resolve({ ok: true }); } return Promise.resolve(message.type === 'get-cache-size' ? { bytes: 1572864 } : message.type === 'get-usage' ? { inputTokens: 0, unreportedRequests: 0, periods: {} } : { ok: true }); } }
  };
  try {
    await import(`../src/options/index.js?stale=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(document.querySelector('#confirmDialog button[autofocus]'));
    assert.equal(document.getElementById('panel-usage').hidden, false);
    const interactionRow = document.querySelector('#rules [data-group]');
    const interactionSwitch = interactionRow.querySelector('.rule-enabled input');
    assert.equal(document.querySelector('[data-group="black"]').dataset.enabled, String(DEFAULT_CONFIG.blackRules[0].enabled));
    const modelInput = document.getElementById('model');
    const originalModel = modelInput.value;
    assert.equal(document.getElementById('save').disabled, true);
    assert.equal(document.getElementById('closeWithoutSaving').disabled, true);
    const originalAnimate = dom.window.HTMLElement.prototype.animate;
    dom.window.HTMLElement.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
    modelInput.value = 'changed-model';
    modelInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(document.getElementById('saveState').textContent, '未保存の変更があります');
    modelInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(document.getElementById('save').disabled, false);
    assert.equal(document.getElementById('closeWithoutSaving').disabled, false);
    modelInput.value = originalModel;
    modelInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(document.getElementById('saveState').textContent, '未保存の変更があります');
    assert.equal(document.getElementById('saveState').getAttribute('aria-hidden'), 'true');
    modelInput.value = 'changed-model';
    modelInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(document.getElementById('saveState').getAttribute('aria-hidden'), null);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(document.getElementById('saveState').textContent, '未保存の変更があります');
    modelInput.value = originalModel;
    modelInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(document.getElementById('saveState').textContent, '');
    assert.equal(document.getElementById('save').disabled, true);
    assert.equal(document.getElementById('closeWithoutSaving').disabled, true);
    if (originalAnimate === undefined) delete dom.window.HTMLElement.prototype.animate;
    else dom.window.HTMLElement.prototype.animate = originalAnimate;
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
    const originalMatchMedia = dom.window.matchMedia;
    document.getElementById('changeApiKey').click();
    assert.equal(document.getElementById('apiKeyRow').hidden, false);
    assert.equal(document.activeElement, document.getElementById('apiKey'));
    assert.equal(document.getElementById('keyStatus').textContent, '未確認');
    document.getElementById('cancelApiKey').click();
    assert.equal(document.getElementById('apiKeyRow').hidden, true);
    assert.equal(document.activeElement, document.getElementById('changeApiKey'));
    assert.equal(document.getElementById('keyStatus').textContent, '保存済み');
    dom.window.matchMedia = () => ({ matches: true });
    document.getElementById('changeApiKey').click();
    document.getElementById('cancelApiKey').click();
    if (originalMatchMedia === undefined) delete dom.window.matchMedia; else dom.window.matchMedia = originalMatchMedia;
    const score = document.querySelector('[data-group="black"] .threshold-value');
    const savesBeforeDrag = storageSets;
    const slider = document.querySelector('[data-group="black"] [data-field="threshold-range"]');
    slider.value = '0.91';
    slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    slider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(score.textContent, '0.91');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(storageSets, savesBeforeDrag);
    assert.equal(document.getElementById('saveState').textContent, '未保存の変更があります');
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(savedConfig.blackRules[0].threshold, 0.91);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(document.getElementById('saveState').textContent, '');
    const textareaFocusOptions = [];
    const originalTextareaFocus = dom.window.HTMLTextAreaElement.prototype.focus;
    dom.window.HTMLTextAreaElement.prototype.focus = function (options) { textareaFocusOptions.push(options); return originalTextareaFocus.call(this, options); };
    document.querySelector('[data-group="black"] [data-edit-rule]').click();
    assert.equal(document.querySelector('[data-group="black"] textarea:not([hidden])').hidden, false);
    assert.equal(document.querySelectorAll('[data-group="black"] textarea:not([hidden])').length, 1);
    assert.ok(document.querySelector('[data-group="black"] input[type="range"]'));
    assert.equal(document.querySelector('[data-group="black"] .threshold-value').hidden, false);
    assert.equal(document.activeElement, document.querySelector('[data-group="black"] textarea:not([hidden])'));
    assert.deepEqual(textareaFocusOptions.at(-1), { preventScroll: true });
    const focusedRow = document.querySelector('[data-group="black"][data-editing="true"]');
    const editingTextarea = document.querySelector('[data-group="black"] textarea:not([hidden])');
    assert.equal(editingTextarea.selectionEnd, editingTextarea.value.length);
    const originalCondition = editingTextarea.value;
    editingTextarea.value += '追記';
    editingTextarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(document.querySelector('[data-reset-group="black"]').hidden, false);
    editingTextarea.value = originalCondition;
    editingTextarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(document.querySelector('[data-reset-group="black"]').hidden, false);
    const otherRowSwitch = document.querySelector('[data-group="black"] .rule-enabled:not([hidden]) input');
    const switchBefore = otherRowSwitch.checked;
    otherRowSwitch.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(otherRowSwitch.checked, !switchBefore);
    assert.equal(document.querySelector('[data-group="black"][data-editing="true"]'), null);
    document.querySelector('[data-group="black"] [data-edit-rule]').click();
    const blackIdsBeforeReorder = [...document.querySelectorAll('[data-group="black"]')].slice(0, 2).map(row => row.dataset.id);
    const firstHandle = document.querySelector('[data-group="black"] .rule-drag-handle');
    firstHandle.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    const blackIdsAfterReorder = [...document.querySelectorAll('[data-group="black"]')].slice(0, 2).map(row => row.dataset.id);
    assert.deepEqual(blackIdsAfterReorder, [...blackIdsBeforeReorder].reverse());
    assert.equal(document.getElementById('saveState').textContent, '未保存の変更があります');
    const pointerEvent = (type, values = {}) => {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      for (const [key, value] of Object.entries({ button: 0, pointerId: 7, clientX: 20, clientY: 100, ...values })) Object.defineProperty(event, key, { value });
      return event;
    };
    const deleteRow = document.querySelector('[data-group="black"]:not([data-editing="true"])');
    const deleteId = deleteRow.dataset.id;
    const deleteSwitch = deleteRow.querySelector('.rule-enabled input');
    const enabledBeforeDelete = deleteSwitch.checked;
    deleteRow.querySelector('[data-edit-rule]').click();
    const editingDeleteRow = document.querySelector(`[data-group="black"][data-id="${deleteId}"]`);
    const deleteTextarea = editingDeleteRow.querySelector('textarea:not([hidden])');
    const removeButton = editingDeleteRow.querySelector('.rule-remove');
    assert.equal(document.activeElement, deleteTextarea);
    const removePointerDown = pointerEvent('pointerdown');
    removeButton.dispatchEvent(removePointerDown);
    assert.equal(removePointerDown.defaultPrevented, true);
    assert.equal(document.activeElement, deleteTextarea);
    assert.equal(deleteSwitch.checked, enabledBeforeDelete);
    removeButton.click();
    assert.equal(document.querySelector(`[data-group="black"][data-id="${deleteId}"]`), null);
    const blackRows = [...document.querySelectorAll('[data-group="black"]')];
    blackRows.forEach((row, index) => Object.defineProperty(row, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, right: 700, top: 100 + index * 80, bottom: 180 + index * 80, height: 80, width: 700 }) }));
    const handle = document.querySelector('[data-group="black"] .rule-drag-handle');
    const blackOrderBeforePointer = blackRows.map(row => row.dataset.id);
    const uncheckedRow = blackRows.find(row => !row.querySelector('.rule-enabled input').checked);
    let draggedThresholdId;
    let dragHandle = uncheckedRow?.querySelector('.rule-drag-handle') ?? handle;
    let activeDragRow = uncheckedRow;
    if (uncheckedRow) {
      const uncheckedId = uncheckedRow.dataset.id;
      draggedThresholdId = uncheckedId;
      const editingRow = document.querySelector(`[data-group="black"][data-id="${uncheckedId}"]`);
      activeDragRow = editingRow;
      dragHandle = editingRow.querySelector('.rule-drag-handle');
      const dragSlider = editingRow.querySelector('[data-field="threshold-range"]');
      dragSlider.value = '0.73';
      dragSlider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    }
    dragHandle.dispatchEvent(pointerEvent('pointerdown'));
    dragHandle.dispatchEvent(pointerEvent('pointermove', { clientY: 350 }));
    assert.equal(document.querySelector('.rule-drag-clone')?.getAttribute('aria-hidden'), 'true');
    if (uncheckedRow) {
      assert.equal(document.querySelector('.rule-drag-clone [data-field="threshold"]').value, '0.73');
    }
    if (uncheckedRow) {
      assert.equal(document.querySelector('.rule-drag-clone .rule-enabled input').checked, false);
    }
    dragHandle.dispatchEvent(pointerEvent('pointerup', { clientY: 350 }));
    const reorderedIds = [...document.querySelectorAll('[data-group="black"]')].map(row => row.dataset.id);
    assert.notDeepEqual(reorderedIds, blackOrderBeforePointer);
    if (draggedThresholdId) {
      assert.equal(document.querySelector(`[data-group="black"][data-id="${draggedThresholdId}"] [data-field="threshold"]`).value, '0.73');
      document.getElementById('save').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(savedConfig.blackRules.find(rule => rule.id === draggedThresholdId).threshold, 0.73);
    }
    const cancelHandle = document.querySelector('[data-group="black"] .rule-drag-handle');
    cancelHandle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 8 }));
    cancelHandle.dispatchEvent(pointerEvent('pointermove', { pointerId: 8, clientY: 350 }));
    cancelHandle.dispatchEvent(pointerEvent('pointercancel', { pointerId: 8, clientY: 350 }));
    assert.equal(document.querySelector('.rule-drag-clone'), null);
    assert.deepEqual([...document.querySelectorAll('[data-group="black"]')].map(row => row.dataset.id), reorderedIds);
    document.querySelector('[data-group="black"] [data-edit-rule]').click();
    const draftRow = document.querySelector('[data-group="black"][data-editing="true"]');
    const draftCondition = draftRow.querySelector('textarea');
    draftCondition.value = 'ドラフトを保持する条件';
    draftCondition.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    document.getElementById('saveState').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.querySelector('[data-group="black"] textarea:not([hidden])'), null);
    assert.equal(document.querySelector(`[data-group="black"][data-id="${draftRow.dataset.id}"] .rule-condition-text`).textContent, 'ドラフトを保持する条件');
    const savesBeforeEdits = storageSets;
    document.querySelector('[data-group="black"] [data-edit-rule]').click();
    const originalAddAnimate = dom.window.HTMLElement.prototype.animate;
    dom.window.HTMLElement.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
    document.querySelector('[data-add-group="black"]').click();
    if (originalAddAnimate === undefined) delete dom.window.HTMLElement.prototype.animate;
    else dom.window.HTMLElement.prototype.animate = originalAddAnimate;
    const newCondition = [...document.querySelectorAll('[data-field="condition"]')].findLast(node => node.closest('p')?.dataset.group === 'black');
    assert.equal(newCondition.value, '');
    const newRow = newCondition.closest('[data-group]');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(newRow.style.overflow, '');
    assert.equal(newRow.dataset.emptyCondition, 'true');
    assert.equal(document.activeElement, newCondition);
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(storageSets, savesBeforeEdits);
    assert.match(document.getElementById('status').textContent, /空の条件は保存できません/);
    assert.equal(document.querySelector('[data-group="black"][data-editing="true"] textarea').hidden, false);
    newCondition.value = '保存される条件';
    newCondition.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    newCondition.blur();
    assert.equal(newRow.dataset.emptyCondition, 'false');
    document.getElementById('save').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.querySelector('[data-group="black"] [data-editing="true"]'), null);
    const initiallyDisabledRule = DEFAULT_CONFIG.blackRules.find(rule => !rule.enabled);
    assert.equal(savedConfig.blackRules.find(rule => rule.id === initiallyDisabledRule.id).enabled, false);
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
    assert.equal(verificationCalls, 0);
    assert.equal(document.getElementById('keyStatus').textContent, '保存済み');
    assert.equal(savedConfig.model, 'custom-model');
    assert.equal(savedConfig.usageLimits['30d'], 1.5);
    assert.equal(savedConfig.whiteRules[0].condition, '読み込んだ条件');
  } finally {
    dom.window.close();
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome;
  }
});

test('条件の削除アニメーション後も行がDOMと保存データから消える', async () => {
  const previous = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome, getComputedStyle: globalThis.getComputedStyle };
  const dom = new JSDOM(readFileSync(new URL('../src/options/index.html', import.meta.url), 'utf8'));
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  mockDialog(dom);
  dom.window.matchMedia = () => ({ matches: false });
  dom.window.HTMLElement.prototype.animate = function () { return { finished: new Promise(resolve => setTimeout(resolve, 0)), cancel() {} }; };
  let savedConfig;
  globalThis.chrome = { storage: {}, runtime: { sendMessage: async message => {
    if (message.type === 'get-config') return { ...DEFAULT_CONFIG, keyConfigured: true };
    if (message.type === 'get-usage') return { inputTokens: 0, unreportedRequests: 0, periods: {} };
    if (message.type === 'get-cache-size') return { bytes: 0 };
    if (message.type === 'save-config') { savedConfig = message.config; return { ok: true }; }
    return { ok: true };
  } } };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    await import(`../src/options/index.js?delete-animation=${Date.now()}`);
    await tick();
    const row = document.querySelector('#rules [data-group="black"]');
    const deletedId = row.dataset.id;
    row.querySelector('.rule-remove').click();
    await tick();
    await tick();
    assert.equal(document.querySelector(`#rules [data-id="${deletedId}"]`), null);
    assert.equal(document.getElementById('save').disabled, false);
    document.getElementById('save').click();
    await tick();
    await tick();
    assert.equal(savedConfig.blackRules.some(rule => rule.id === deletedId), false);
    assert.equal(document.querySelector(`#rules [data-id="${deletedId}"]`), null);
  } finally {
    dom.window.close();
    if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
    if (previous.chrome === undefined) delete globalThis.chrome; else globalThis.chrome = previous.chrome;
    if (previous.getComputedStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = previous.getComputedStyle;
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
      if (message.type === 'reset-usage' || message.type === 'reset-all-usage') return { ok: true, inputTokens: 0, unreportedRequests: 0, periods: {} };
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
    assert.doesNotMatch($('status').textContent, /使用量リセット/);
    assert.doesNotMatch($('status').textContent, /すべての使用量リセット/);
    $('save').click();
    await tick();
    assert.equal(messages.filter(message => message.type === 'clear-cache').length, 2);
    assert.equal(messages.filter(message => message.type === 'reset-usage').length, 1);
    assert.equal(messages.filter(message => message.type === 'reset-all-usage').length, 1);
    assert.equal(messages.filter(message => message.type === 'delete-api-key').length, 1);
    assert.match($('status').textContent, /設定を保存しました$/);
    assert.equal($('save').disabled, true);
    assert.equal($('resetInputPrice').hidden, false);
    assert.equal($('resetInputPrice').classList.contains('is-default'), true);
    assert.equal($('resetInputPrice').disabled, true);
    $('resetInputPrice').click();
    assert.equal($('save').disabled, true);
    assert.equal(messages.filter(message => message.type === 'save-config').length, 2);
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
  globalThis.chrome = { storage: {}, runtime: { sendMessage: async message => { if (message.type === 'get-config') return { ...DEFAULT_CONFIG, inputPricePerMillion: 0.5, keyConfigured: true }; if (message.type === 'save-config') saves++; return { ok: true }; } } };
  try {
    await import(`../src/options/index.js?dialog-repeat=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    document.getElementById('resetUsage').click();
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
    const modelBeforeProviderChange = $('model').value;
    $('provider').value = 'openrouter';
    $('provider').dispatchEvent(new dom.window.Event('change'));
    await tick();
    assert.notEqual($('model').value, modelBeforeProviderChange);
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
