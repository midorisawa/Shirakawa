import { DEFAULT_CONFIG, DEFAULT_INPUT_PRICE_PER_MILLION, OPENROUTER_DEFAULT_MODEL, exportConfig, importConfig, normalizeConfig } from '../core/config.js';
let config = DEFAULT_CONFIG;
let verifiedConnection = null;
let verificationResult = null;
let keyEditing = false;
let appliedConfig = structuredClone(DEFAULT_CONFIG);
let saving = false;
let activeRule = null;
let activeDrag = null;
const pendingActions = { cache: false, usage: false, allUsage: false, blackReset: false, whiteReset: false, priceReset: false, apiKeyDelete: new Set() };
const scheduleFrame = callback => (window.requestAnimationFrame ? window.requestAnimationFrame(callback) : window.setTimeout(callback, 16));
const cancelFrame = id => (window.cancelAnimationFrame ? window.cancelAnimationFrame(id) : window.clearTimeout(id));
const $ = id => document.getElementById(id);
let statusTimer = 0;
const feedbackStates = new WeakMap();
const keyViewAnimations = new WeakMap();
function setFeedbackText(element, message, onHidden) {
  const previous = feedbackStates.get(element);
  const visible = element.classList.contains('feedback-visible');
  if (message && visible && element.textContent === message && !previous?.hiding) return;
  if (!message && previous?.hiding) { previous.onHidden = onHidden; return; }
  if (!message && !visible) { onHidden?.(); return; }
  if (previous?.timer) window.clearTimeout(previous.timer);
  const opacity = visible ? Number(window.getComputedStyle(element).opacity) : 0;
  previous?.animation?.cancel();
  const state = { onHidden };
  feedbackStates.set(element, state);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const animate = frames => {
    const animation = element.animate(frames, { duration: 110, easing: 'ease', fill: 'both' });
    animation.finished.catch(() => {});
    return animation;
  };
  if (message) {
    element.removeAttribute('aria-hidden');
    element.textContent = message;
    element.classList.add('feedback-visible');
    if (!reducedMotion && element.animate) state.animation = animate([{ opacity }, { opacity: 1 }]);
    return;
  }
  if (reducedMotion || !element.animate) {
    element.textContent = '';
    element.classList.remove('feedback-visible');
    element.setAttribute('aria-hidden', 'true');
    feedbackStates.delete(element);
    onHidden?.();
    return;
  }
  state.hiding = true;
  element.setAttribute('aria-hidden', 'true');
  state.animation = animate([{ opacity }, { opacity: 0 }]);
  state.timer = window.setTimeout(() => {
    if (feedbackStates.get(element) !== state) return;
    element.textContent = '';
    element.classList.remove('feedback-visible');
    state.animation.cancel();
    feedbackStates.delete(element);
    state.onHidden?.();
  }, 110);
}
const status = (message, transient = true) => {
  if (statusTimer) window.clearTimeout(statusTimer);
  const element = $('status');
  if (message) element.dataset.error = String(/できません|失敗|保存されていません/.test(message));
  setFeedbackText(element, message, message ? undefined : () => { element.dataset.error = 'false'; });
  if (transient && message) statusTimer = window.setTimeout(() => { statusTimer = 0; status(''); }, 5000);
};
const keyStatus = message => { $('keyStatus').textContent = message; };
let confirmationPending = false;
function confirmInPage(message, actionLabel = '続ける') {
  if (confirmationPending) return Promise.resolve(false);
  confirmationPending = true;
  const dialog = $('confirmDialog');
  $('confirmMessage').textContent = message;
  $('confirmAction').textContent = actionLabel;
  return new Promise(resolve => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => {
      confirmationPending = false;
      resolve(dialog.returnValue === 'confirm');
    }, { once: true });
    dialog.showModal();
  });
}
const toggleMotionTimers = new WeakMap();
let activePanelId = document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('aria-controls') ?? null;
function clearToggleMotion(input) {
  const control = input.closest('.rule-enabled, .toggle-control');
  if (!control) return;
  const timer = toggleMotionTimers.get(control);
  if (timer) window.clearTimeout(timer);
  toggleMotionTimers.delete(control);
  control.classList.remove('motion-enabled');
}
function animateToggle(input) {
  const control = input.closest('.rule-enabled, .toggle-control');
  if (!control || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  control.classList.add('motion-enabled');
  const previousTimer = toggleMotionTimers.get(control);
  if (previousTimer) window.clearTimeout(previousTimer);
  toggleMotionTimers.set(control, window.setTimeout(() => {
    control.classList.remove('motion-enabled');
    toggleMotionTimers.delete(control);
  }, 180));
}
const buttonIcons = { edit:'ic_fluent_edit_24_regular.svg', discard:'ic_fluent_arrow_reset_24_regular.svg', reset:'ic_fluent_arrow_reset_24_regular.svg', trash:'ic_fluent_delete_24_regular.svg', dismiss:'ic_fluent_game_controller_button_x_20_regular.svg', save:'ic_fluent_save_24_regular.svg', plus:'M12 5v14m-7-7h14', check:'m5 12 4 4L19 6', download:'M12 4v11m0 0 4-4m-4 4-4-4M5 20h14', upload:'M12 16V5m0 0 4 4m-4-4-4 4M5 20h14' };
function buttonIconKey(button) {
  if (button.dataset.resetGroup || ['resetInputPrice', 'resetUsage', 'resetAllUsage'].includes(button.id)) return 'reset';
  if (button.dataset.remove) return 'trash';
  if (button.dataset.removeLimit) return 'dismiss';
  if (button.dataset.addGroup || button.id === 'addUsageLimit') return 'plus';
  if (['save', 'saveApiKey'].includes(button.id)) return 'save';
  if (['cancelApiKey', 'cancelUsageLimit'].includes(button.id)) return 'discard';
  if (button.classList.contains('file-control')) return 'upload';
  if (button.id === 'changeApiKey') return 'edit';
  if (['clearCache', 'deleteApiKey'].includes(button.id)) return 'trash';
  if (button.id === 'confirmUsageLimit') return 'check';
  if (button.id === 'export') return 'download';
  if (button.id === 'import') return 'upload';
  return null;
}
function decorateButtons() {
  const targets = [...document.querySelectorAll('button, .file-control')];
  for (const button of targets) {
    const key = buttonIconKey(button);
    if (key === 'dismiss' && button.querySelector('svg')) button.replaceChildren();
    if (!key || button.querySelector('svg, .button-icon')) continue;
    if (!buttonIcons[key]) continue;
    if (buttonIcons[key].endsWith('.svg')) {
      const icon = document.createElement('span');
      icon.className = 'button-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('focusable', 'false');
      icon.style.maskImage = `url(../icons/${buttonIcons[key]})`;
      icon.style.webkitMaskImage = icon.style.maskImage;
      button.prepend(icon);
    } else {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.style.pointerEvents = 'none';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', buttonIcons[key]); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.8'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
      svg.append(path); button.prepend(svg);
    }
  }
  for (const element of document.querySelectorAll('[title]')) {
    if (!element.dataset.tooltip) element.dataset.tooltip = element.title;
    element.removeAttribute('title');
  }
}
const hasSavedKey = () => Boolean(config.keyConfiguredByProvider?.[config.provider] ?? config.keyConfigured);
function animateKeyElements(elements) {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  for (const element of elements.filter(Boolean)) {
    keyViewAnimations.get(element)?.cancel();
    keyViewAnimations.delete(element);
    if (reducedMotion || element.hidden || !element.animate) continue;
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out', fill: 'both' });
    keyViewAnimations.set(element, animation);
    animation.finished.then(() => {
      if (keyViewAnimations.get(element) !== animation) return;
      animation.cancel();
      keyViewAnimations.delete(element);
    }, () => { if (keyViewAnimations.get(element) === animation) keyViewAnimations.delete(element); });
  }
}
function markDirty() {
  updateDirtyState();
  status('');
}
function updateDirtyState() {
  read();
  const sameRules = (left, right) => JSON.stringify(left.map(({ condition, threshold, enabled }) => [condition, Number(threshold), Boolean(enabled)])) === JSON.stringify(right.map(({ condition, threshold, enabled }) => [condition, Number(threshold), Boolean(enabled)]));
  for (const group of ['black', 'white']) {
    const resetButton = document.querySelector(`[data-reset-group="${group}"]`);
    const key = `${group}Rules`;
    if (resetButton) {
      const isDefault = sameRules(config[key], DEFAULT_CONFIG[key]);
      resetButton.hidden = false;
      resetButton.classList.toggle('is-default', isDefault);
      resetButton.disabled = isDefault;
      resetButton.setAttribute('aria-hidden', String(isDefault));
    }
    if (pendingActions[`${group}Reset`] && sameRules(config[key], appliedConfig[key])) pendingActions[`${group}Reset`] = false;
  }
  const defaultConfig = normalizeConfig(DEFAULT_CONFIG);
  const resetInputPrice = $('resetInputPrice');
  const samePriceSettings = (left, right) => {
    const current = normalizeConfig(left);
    const target = normalizeConfig(right);
    return JSON.stringify([current.inputPricePerMillion, current.billingCurrency, current.usageLimits]) === JSON.stringify([target.inputPricePerMillion, target.billingCurrency, target.usageLimits]);
  };
  if (resetInputPrice) {
    const isDefault = samePriceSettings(config, defaultConfig);
    resetInputPrice.hidden = false;
    resetInputPrice.classList.toggle('is-default', isDefault);
    resetInputPrice.disabled = isDefault;
    resetInputPrice.setAttribute('aria-hidden', String(isDefault));
  }
  if (pendingActions.priceReset && samePriceSettings(config, appliedConfig)) pendingActions.priceReset = false;
  const priceInput = $('inputPricePerMillion');
  if ($('zeroPriceWarning')) $('zeroPriceWarning').hidden = !priceInput || priceInput.value === '' || Number(priceInput.value) !== 0;
  const comparable = value => {
    const normalized = normalizeConfig(value);
    return JSON.stringify(['provider', 'model', 'inputPricePerMillion', 'billingCurrency', 'usageLimits', 'decisionCacheLimitMb', 'blackRules', 'whiteRules'].map(key => normalized[key]));
  };
  const invalid = [...document.querySelectorAll('input[type="number"]')].some(input => !input.checkValidity()) || [...document.querySelectorAll('[data-field="condition"]')].some(input => !input.value.trim());
  const dirty = invalid || comparable(config) !== comparable(appliedConfig) || pendingActions.cache || pendingActions.usage || pendingActions.allUsage || pendingActions.blackReset || pendingActions.whiteReset || pendingActions.priceReset || pendingActions.apiKeyDelete.size > 0;
  if ($('saveState')) setFeedbackText($('saveState'), dirty ? '未保存の変更があります' : '');
  $('save').disabled = saving || !dirty;
  if ($('closeWithoutSaving')) $('closeWithoutSaving').disabled = saving || !dirty;
}
function activateTab(panelId) {
  const previousPanelId = activePanelId;
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const selected = tab.getAttribute('aria-controls') === panelId;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !selected;
  }
  if (previousPanelId && previousPanelId !== panelId) {
    $(previousPanelId)?.classList.remove('tab-panel-fade');
    const panel = $(panelId);
    if (panel && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      panel.classList.remove('tab-panel-fade');
      panel.classList.add('tab-panel-fade');
    }
  }
  activePanelId = panelId;
  document.body.scrollTop = 0;
  if (panelId === 'panel-usage') void refreshUsage();
}
function revealField(input) {
  const panel = input.closest('[role="tabpanel"]');
  if (panel?.hidden) activateTab(panel.id);
  const details = input.closest('details');
  if (details) details.open = true;
  input.focus();
}
function focusConditionTextarea(group, id) {
  const textarea = document.querySelector(`[data-group="${group}"][data-id="${id}"] textarea`);
  if (!textarea) return;
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}
for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener('click', () => activateTab(tab.getAttribute('aria-controls')));
  tab.addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    activateTab(tabs[next].getAttribute('aria-controls'));
    tabs[next].focus();
  });
}
function renderFilterStatus() {
  const configured = Boolean(config.keyConfiguredByProvider?.[appliedConfig.provider]);
  const notice = $('filterStatus');
  const visible = appliedConfig.enabled && !configured;
  if (notice) {
    $('filterStatusText').textContent = visible ? 'APIキーが未設定のため、フィルターを有効にしても判定できません。API接続を設定してください。' : '';
    const collapse = notice.closest('.filter-status-collapse');
    collapse.classList.toggle('is-visible', visible);
    collapse.setAttribute('aria-hidden', String(!visible));
  }
}
function pendingActionLabels() {
  const labels = [];
  if (pendingActions.cache) labels.push('キャッシュの消去');
  if (pendingActions.usage) labels.push('各期間の使用量のリセット');
  if (pendingActions.allUsage) labels.push('すべての使用量のリセット');
  if (pendingActions.blackReset) labels.push('ブラックリストの初期化\n現在の設定（条件、スコア、有効/無効、表示順）はすべて消去され、初期状態に戻ります。');
  if (pendingActions.whiteReset) labels.push('ホワイトリストの初期化\n現在の設定（条件、スコア、有効/無効、表示順）はすべて消去され、初期状態に戻ります。');
  if (pendingActions.priceReset) labels.push('単価・通貨・上限の初期化\n現在の単価・通貨、および上限（期間・金額）の設定が消去され、初期状態に戻ります。');
  for (const provider of pendingActions.apiKeyDelete) {
    const providerName = provider === 'typesafe' ? 'TypeSafe' : provider === 'openrouter' ? 'OpenRouter' : provider;
    labels.push(`${providerName} APIキーの削除\nこのブラウザに保存されている${providerName}のAPIキーが削除されます。`);
  }
  return labels;
}
async function executePendingActions(snapshot) {
  const failed = [];
  const run = async (key, message, label) => {
    if (!snapshot[key]) return;
    try {
      const result = await chrome.runtime.sendMessage(message);
      if (!result?.ok) throw new Error('operation failed');
      pendingActions[key] = false;
    } catch { failed.push(label); }
  };
  await run('cache', { type: 'clear-cache' }, 'キャッシュ削除');
  await run('usage', { type: 'reset-usage' }, '使用量リセット');
  await run('allUsage', { type: 'reset-all-usage' }, 'すべての使用量リセット');
  for (const provider of snapshot.apiKeyDelete) {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'delete-api-key', provider });
      if (!result?.ok) throw new Error('operation failed');
      pendingActions.apiKeyDelete.delete(provider);
      config.keyConfiguredByProvider = { ...(config.keyConfiguredByProvider || {}), [provider]: false };
      if (config.provider === provider) config.keyConfigured = false;
      appliedConfig.keyConfiguredByProvider = { ...(appliedConfig.keyConfiguredByProvider || {}), [provider]: false };
      if (appliedConfig.provider === provider) appliedConfig.keyConfigured = false;
    } catch { failed.push(`${provider}のAPIキー削除`); }
  }
  return failed;
}
const USAGE_PERIOD_LABELS = { '5h': '5時間', '1d': '1日', '7d': '7日間', '30d': '30日間' };
function renderUsageLimitInputs() {
  const container = $('usageLimitInputs');
  if (!container) return;
  const limits = config.usageLimits || {};
  container.replaceChildren(...Object.entries(limits).filter(([, limit]) => limit !== null && limit !== '').map(([period, limit]) => {
    const row = document.createElement('p'); row.dataset.period = period;
    row.innerHTML = `<label><span>${USAGE_PERIOD_LABELS[period]}の上限額</span><input data-limit-period="${period}" type="number" min="${config.billingCurrency === 'USD' ? '0.01' : '1'}" step="${config.billingCurrency === 'USD' ? '0.01' : '1'}" required value="${config.billingCurrency === 'USD' ? Number(limit).toFixed(2) : limit ?? ''}"><span class="limit-currency">${config.billingCurrency}</span></label> <button class="usage-limit-remove" type="button" data-remove-limit="${period}" aria-label="${USAGE_PERIOD_LABELS[period]}の上限を削除する" data-tooltip="${USAGE_PERIOD_LABELS[period]}の上限を削除する"></button>`;
    return row;
  }));
  const select = $('usageLimitPeriod');
  if (select) {
    for (const option of select.options) option.disabled = limits[option.value] !== null && limits[option.value] !== undefined && limits[option.value] !== '';
    if (select.selectedOptions[0]?.disabled) select.value = [...select.options].find(option => !option.disabled)?.value ?? '';
  }
  if ($('addUsageLimit')) $('addUsageLimit').disabled = !select?.value;
  if ($('resetInputPrice')) {
    $('resetInputPrice').dataset.tooltip = `初期値：入力単価USD ${DEFAULT_INPUT_PRICE_PER_MILLION}／100万トークン、5時間USD 0.06、1日USD 0.10、7日間USD 0.50`;
  }
}
function renderKeyView(animate = false, animateModel = false) {
  renderFilterStatus();
  const saved = hasSavedKey();
  if ($('apiKeyRow')) $('apiKeyRow').hidden = saved && !keyEditing;
  if ($('changeApiKey')) $('changeApiKey').hidden = !saved || keyEditing;
  if ($('cancelApiKey')) $('cancelApiKey').hidden = !saved || !keyEditing;
  if ($('deleteApiKey')) $('deleteApiKey').hidden = !saved || keyEditing;
  if ($('saveApiKey')) $('saveApiKey').hidden = saved && !keyEditing;
  if (!keyEditing) keyStatus(saved ? '保存済み' : '未設定');
  if ($('key-usage-note')) $('key-usage-note').hidden = config.provider !== 'typesafe' || (!keyEditing && saved);
  if (animate) {
    const view = $('apiKeyRow')?.closest('.connection-grid');
    animateKeyElements([view, ...(animateModel ? [$('model')] : [])]);
  }
}
let verificationId = 0;
function render(animateKeyView = false) {
  verificationId++;
  clearToggleMotion($('enabled'));
  $('enabled').checked = config.enabled;
  if ($('enabledLabel')) $('enabledLabel').textContent = config.enabled ? '有効' : '無効';
  $('provider').value = config.provider;
  renderKeyView(animateKeyView);
  $('model').value = config.model;
  if ($('inputPricePerMillion')) $('inputPricePerMillion').value = config.inputPricePerMillion ?? '';
  if ($('billingCurrency')) $('billingCurrency').value = config.billingCurrency;
  renderUsageLimitInputs();

  if ($('decisionCacheLimitMb')) $('decisionCacheLimitMb').value = config.decisionCacheLimitMb;
  const renderGroup = (rules, group, title) => {
    const heading = document.createElement('h3');
    heading.textContent = title;
    const headingBar = document.createElement('div');
    headingBar.className = 'rule-heading';
    const headingActions = document.createElement('div');
    headingActions.className = 'rule-heading-actions';
    const reset = document.createElement('button');
    reset.type = 'button'; reset.id = `reset-${group}`; reset.dataset.resetGroup = group; reset.textContent = '初期設定に戻す';
    headingActions.append(reset);
    headingBar.append(heading, headingActions);
    const nodes = [headingBar];
    rules.forEach((rule, index) => {
      const editing = activeRule?.group === group && activeRule.id === rule.id;
      const row = document.createElement('p');
      row.dataset.group = group;
      row.dataset.id = rule.id;
      row.dataset.editing = String(editing);
      row.dataset.enabled = String(rule.enabled);
      row.dataset.emptyCondition = String(!rule.condition.trim());
      const thresholdId = `threshold-${group}-${index}`;
      row.innerHTML = `<button class="rule-drag-handle" type="button" aria-label="${escapeHtml(rule.condition || '空の条件')}の順序を変更する"><svg class="rule-drag-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><div class="rule-condition"><button class="rule-condition-text" data-edit-rule="${escapeHtml(rule.id)}"${editing ? ' hidden' : ''}>${escapeHtml(rule.condition)}</button><textarea data-field="condition" aria-label="条件文" rows="2" placeholder="例：攻撃的な表現を含む投稿"${editing ? '' : ' hidden'}>${escapeHtml(rule.condition)}</textarea></div>
        <div class="rule-threshold"><span class="threshold-summary"><span class="threshold-copy">スコア<output class="threshold-value">${Number(rule.threshold).toFixed(2)}</output>以上の投稿${group === 'black' ? 'を非表示' : 'のみ表示'}</span></span><span class="threshold-slider"><input data-field="threshold-range" type="range" min="0" max="1" step="0.01" value="${rule.threshold}" aria-label="${group === 'black' ? '非表示にする' : '表示する'}最低スコア"></span><input data-field="threshold" type="hidden" value="${rule.threshold}"></div>
        <label class="rule-enabled"><input data-field="enabled" role="switch" type="checkbox" aria-label="${escapeHtml(rule.condition || '空の条件')}を有効にする" ${rule.enabled ? 'checked' : ''}></label>
        <button class="rule-remove" type="button" data-remove="${index}" aria-label="${escapeHtml(rule.condition || '空の条件')}を削除する"></button>`;
      nodes.push(row);
    });
    const actions = document.createElement('p');
    actions.className = 'rule-actions';
    const add = document.createElement('button');
    add.type = 'button'; add.id = `add-${group}`; add.dataset.addGroup = group; add.textContent = '条件を追加する';
    actions.append(add); nodes.push(actions);
    const section = document.createElement('section');
    section.className = 'rule-group';
    heading.id = `rules-${group}-heading`;
    section.setAttribute('aria-labelledby', heading.id);
    section.append(...nodes);
    return section;
  };
  $('rules').replaceChildren(
    renderGroup(config.blackRules, 'black', '投稿を非表示にする（ブラックリスト）'),
    renderGroup(config.whiteRules, 'white', '表示する投稿を絞る（ホワイトリスト）')
  );
  void refreshUsage();
  void refreshCacheUsage();
  updateDirtyState();
  decorateButtons();
  document.documentElement.classList.add('options-ready');
}
const stickyHeader = document.querySelector('.sticky-header');
if (stickyHeader && 'ResizeObserver' in window) new ResizeObserver(([entry]) => document.documentElement.style.setProperty('--sticky-header-height', `${entry.target.getBoundingClientRect().height}px`)).observe(stickyHeader);
function renderPreservingScroll(animateKeyView = false) {
  const scrollTop = document.body.scrollTop;
  render(animateKeyView);
  document.body.scrollTop = scrollTop;
}
function animateAddedRule(group, id) {
  const row = document.querySelector(`#rules [data-group="${group}"][data-id="${id}"]`);
  if (!row || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !row.animate) return;
  const style = window.getComputedStyle(row);
  const end = {
    height: `${row.getBoundingClientRect().height}px`,
    paddingBlock: style.paddingBlock,
    marginBlock: style.marginBlock,
    borderBottomWidth: style.borderBottomWidth,
    opacity: 1
  };
  row.style.overflow = 'hidden';
  const animation = row.animate([
    { height: '0px', paddingBlock: '0px', marginBlock: '0px', borderBottomWidth: '0px', opacity: 0 },
    end
  ], { duration: 180, easing: 'ease-out', fill: 'both' });
  const restoreOverflow = () => row.style.removeProperty('overflow');
  animation.finished.then(restoreOverflow, restoreOverflow);
}
function escapeHtml(value) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function read() {
  const rows = [...$('rules').querySelectorAll('p')];
  const readRules = group => rows.filter(row => row.dataset.group === group && row.dataset.removing !== 'true').map(row => ({ id: row.dataset.id, condition: row.querySelector('[data-field="condition"]').value, threshold: Number(row.querySelector('[data-field="threshold"]').value), enabled: row.querySelector('[data-field="enabled"]')?.checked ?? row.dataset.enabled === 'true' }));
  config = {
    ...config,
    enabled: $('enabled').checked,
    provider: $('provider').value,
    model: $('model').value,
    usageLimits: Object.fromEntries([...document.querySelectorAll('[data-limit-period]')].map(input => [input.dataset.limitPeriod, input.value])),
    inputPricePerMillion: $('inputPricePerMillion')?.value ?? config.inputPricePerMillion,
    billingCurrency: $('billingCurrency')?.value ?? config.billingCurrency,
    decisionCacheLimitMb: $('decisionCacheLimitMb')?.value ?? config.decisionCacheLimitMb,
    blackRules: readRules('black'), whiteRules: readRules('white')
  };
}
function readNormalConfig() {
  read();
  const normalized = normalizeConfig(config);
  config = { ...config, ...normalized };
  return structuredClone(normalized);
}
async function saveConfig() {
  const button = $('save');
  if (button.disabled || confirmationPending) return;
  const emptyCondition = [...document.querySelectorAll('[data-field="condition"]')].find(input => !input.value.trim());
  if (emptyCondition) { status('空の条件は保存できません。入力するか削除してください'); revealField(emptyCondition); return; }
  const invalid = [...document.querySelectorAll('input[type="number"]')].find(input => !input.checkValidity());
  if (invalid) { status('入力値を確認してください。変更は保存されていません'); revealField(invalid); invalid.reportValidity(); return; }
  const pending = pendingActionLabels();
  if (pending.length && !await confirmInPage(`保存すると、以下の操作が実行されます。\n\n${pending.join('\n\n')}\n\n※これらの操作は元に戻せません。実行しますか？`, '実行する')) {
    status('操作を実行せず、変更を保持しました', true);
    return;
  }
  status('保存中…', false);
  const pendingSnapshot = { ...pendingActions, apiKeyDelete: new Set(pendingActions.apiKeyDelete) };
  const snapshot = readNormalConfig();
  button.disabled = true;
  saving = true;
  if ($('closeWithoutSaving')) $('closeWithoutSaving').disabled = true;
  $('enabled').disabled = true;
  try {
    const saved = await chrome.runtime.sendMessage({ type: 'save-config', config: snapshot });
    if (!saved?.ok) { status('設定を保存できませんでした', true); return; }
    pendingActions.blackReset = false;
    pendingActions.whiteReset = false;
    pendingActions.priceReset = false;
    appliedConfig = snapshot;
    read();
    activeRule = null;
    const keyWasSaved = hasSavedKey();
    const failedActions = await executePendingActions(pendingSnapshot);
    renderPreservingScroll(keyWasSaved !== hasSavedKey());
    status(failedActions.length ? `設定を保存しました。一部の操作に失敗しました：${failedActions.join('、')}` : '設定を保存しました', true);
  } catch { status('設定を保存できませんでした', true); }
  finally { saving = false; $('enabled').disabled = false; updateDirtyState(); }
}
async function saveEnabled() {
  const toggle = $('enabled');
  const enabled = toggle.checked;
  toggle.disabled = true;
  saving = true;
  $('save').disabled = true;
  if ($('closeWithoutSaving')) $('closeWithoutSaving').disabled = true;
  try {
    const saved = await chrome.runtime.sendMessage({ type: 'save-config', config: { ...appliedConfig, enabled } });
    if (!saved?.ok) throw new Error('save failed');
    appliedConfig.enabled = enabled;
    config.enabled = enabled;
    if ($('enabledLabel')) $('enabledLabel').textContent = enabled ? '有効' : '無効';
    renderFilterStatus();
    status(enabled ? 'フィルターを有効にしました' : 'フィルターを無効にしました', true);
  } catch {
    toggle.checked = appliedConfig.enabled;
    if ($('enabledLabel')) $('enabledLabel').textContent = appliedConfig.enabled ? '有効' : '無効';
    status('フィルターの切り替えを保存できませんでした', true);
  } finally {
    toggle.disabled = false;
    saving = false;
    updateDirtyState();
  }
}
$('enabled').addEventListener('change', () => { animateToggle($('enabled')); void saveEnabled(); });
document.addEventListener('pointerdown', event => {
  const input = event.target.closest?.('.rule-enabled input, .toggle-control input');
  if (input) animateToggle(input);
}, true);
document.addEventListener('keydown', event => {
  if (![' ', 'Enter'].includes(event.key)) return;
  const input = event.target.closest?.('.rule-enabled input, .toggle-control input');
  if (input) animateToggle(input);
}, true);
$('closeWithoutSaving')?.addEventListener('click', () => window.close());
async function saveApiKey() {
  const provider = $('provider').value;
  const requestId = ++verificationId;
  const key = $('apiKey').value.trim();
  if (!key) { keyStatus('APIキーを入力してください'); $('apiKey').focus(); return; }
  $('saveApiKey').disabled = true;
  try {
    keyStatus('確認中…');
    let result = verifiedConnection && verifiedConnection.provider === provider && verifiedConnection.apiKey === key ? verificationResult || { ok: true } : null;
    if (!result) {
      try { result = await chrome.runtime.sendMessage({ type: 'verify-api-key', provider, apiKey: key }); }
      catch { result = { reason: 'network-error' }; }
    }
    if (requestId !== verificationId) return;
    if (!result?.ok) { keyStatus(keyMessage(result)); return; }
    const savedKey = await chrome.runtime.sendMessage({ type: 'set-api-key', provider, apiKey: key });
    if (!savedKey?.ok) { keyStatus('保存できませんでした'); return; }
    if (requestId !== verificationId) return;
    verifiedConnection = { provider, apiKey: key }; verificationResult = result;
    config.keyConfigured = true;
    config.keyConfiguredByProvider = { ...(config.keyConfiguredByProvider || {}), [provider]: config.keyConfigured };
    $('apiKey').value = '';
    keyEditing = false;
    status('APIキーを保存しました', true);
    renderKeyView(true);
    keyStatus(`保存済み（${keyMessage(result)}）`);
    $('changeApiKey').focus();
  } catch { keyStatus('保存できませんでした。接続を確認して再試行してください'); }
  finally { $('saveApiKey').disabled = false; }
}
function keyMessage(result) {
  if (result?.ok) return '有効';
  if (result?.reason === 'unauthorized') return '認証失敗（キーを確認してください）';
  if (result?.reason === 'forbidden') return '権限不足（キーの権限を確認してください）';
  if (result?.reason === 'network-error') return '通信エラー（接続を確認してください）';
  if (result?.reason === 'daily-cost-limit') return '使用額上限に達したため停止しました';
  if (result?.reason === 'cost-unknown') return '使用額を確認できないため停止しました';
  if (result?.reason === 'cost-unavailable') return '単価未設定のため使用額上限を適用できません';
  return result?.status ? `APIエラー（HTTP ${result.status}）` : '確認できませんでした';
}
$('rules').onclick = event => {
  if (saving) return;
  const add = event.target.closest('button[data-add-group]');
  if (add) { const group = add.dataset.addGroup; read(); const rule = { id: crypto.randomUUID(), condition: '', threshold: 0.8, enabled: true }; config[`${group}Rules`].push(rule); activeRule = { group, id: rule.id }; renderPreservingScroll(); animateAddedRule(group, rule.id); markDirty(); focusConditionTextarea(group, rule.id); return; }
  const reset = event.target.closest('button[data-reset-group]');
  if (reset) { const group = reset.dataset.resetGroup; read(); config[`${group}Rules`] = structuredClone(DEFAULT_CONFIG[`${group}Rules`]); const key = `${group}Rules`; pendingActions[`${group}Reset`] = JSON.stringify(config[key].map(({ condition, threshold, enabled }) => [condition, Number(threshold), Boolean(enabled)])) !== JSON.stringify(appliedConfig[key].map(({ condition, threshold, enabled }) => [condition, Number(threshold), Boolean(enabled)])); if (activeRule?.group === group) activeRule = null; renderPreservingScroll(); markDirty(); return; }
  const edit = event.target.closest('button[data-edit-rule]');
  if (edit) { const row = edit.closest('[data-group]'); const group = row.dataset.group; const id = row.dataset.id; read(); activeRule = { group, id }; renderPreservingScroll(); focusConditionTextarea(group, id); markDirty(); return; }
  const remove = event.target.closest('button[data-remove]');
  if (remove) {
    const row = remove.closest('[data-group]'); const { group, id } = row.dataset;
    read(); row.dataset.removing = 'true'; row.inert = true; config[`${group}Rules`] = config[`${group}Rules`].filter(rule => rule.id !== id);
    if (activeRule?.group === group && activeRule.id === id) activeRule = null;
    markDirty();
    const finish = () => { if (!row.isConnected) return; row.getAnimations?.().forEach(animation => animation.cancel()); renderPreservingScroll(); };
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !row.animate) { finish(); return; }
    const fade = row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' });
    fade.finished.then(() => {
      if (!row.isConnected) return;
      const height = row.getBoundingClientRect().height;
      return row.animate([{ height: `${height}px`, paddingBlock: getComputedStyle(row).paddingBlock, marginBlock: getComputedStyle(row).marginBlock, borderBottomWidth: getComputedStyle(row).borderBottomWidth }, { height: '0px', paddingBlock: '0px', marginBlock: '0px', borderBottomWidth: '0px' }], { duration: 180, easing: 'ease-in', fill: 'forwards' }).finished.then(finish, finish);
    }, finish).catch(finish);
  }
};
document.addEventListener('click', event => {
  if (!activeRule || event.target.closest?.('[data-edit-rule], .rule-actions button, #save')) return;
  const previous = activeRule;
  window.setTimeout(() => {
    if (activeRule !== previous || document.querySelector(`[data-group="${previous.group}"][data-id="${previous.id}"] textarea`)?.contains(event.target)) return;
    read();
    activeRule = null;
    renderPreservingScroll();
    markDirty();
  });
});
function clearRuleDrag() {
  if (!activeDrag) return;
  if (activeDrag.scrollFrame) cancelFrame(activeDrag.scrollFrame);
  activeDrag.clone?.remove();
  activeDrag.row?.classList.remove('rule-dragging');
  document.querySelectorAll('#rules [data-group]').forEach(node => { node.classList.remove('drop-target'); delete node.dataset.dropPosition; node.style.transform = ''; });
  activeDrag = null;
}
function dragScrollFrame() {
  const drag = activeDrag;
  if (!drag?.started) return;
  if (drag.scrollVelocity) {
    document.body.scrollTop += drag.scrollVelocity;
    if (drag.lastPointer) updateRuleDrag(drag.lastPointer);
  }
  drag.scrollFrame = scheduleFrame(dragScrollFrame);
}
function updateRuleDrag(event) {
  const drag = activeDrag;
  if (!drag || !drag.started) return;
  drag.clone.style.left = `${event.clientX - drag.offsetX}px`;
  drag.clone.style.top = `${event.clientY - drag.offsetY}px`;
  drag.lastPointer = event;
  const y = event.clientY + document.body.scrollTop - drag.startScrollTop;
  const inside = event.clientX >= drag.groupRect.left && event.clientX <= drag.groupRect.right && y >= drag.groupRect.top && y <= drag.groupRect.bottom;
  if (!inside) {
    drag.scrollVelocity = 0;
    document.querySelectorAll('#rules [data-group]').forEach(node => { node.classList.remove('drop-target'); delete node.dataset.dropPosition; node.style.transform = ''; });
    drag.insertion = null;
    return;
  }
  const rows = drag.rows;
  const from = rows.indexOf(drag.row);
  const insertion = rows.reduce((count, row, index) => index === from || drag.rects[index].top + drag.rects[index].height / 2 > y ? count : count + 1, 0);
  const target = rows.find((row, index) => index !== from && drag.rects[index].top <= y && y <= drag.rects[index].bottom) || null;
  document.querySelectorAll('.drop-target').forEach(node => { node.classList.remove('drop-target'); delete node.dataset.dropPosition; });
  if (target) { target.classList.add('drop-target'); target.dataset.dropPosition = y > drag.rects[rows.indexOf(target)].top + drag.rects[rows.indexOf(target)].height / 2 ? 'after' : 'before'; }
  const offset = drag.row.getBoundingClientRect().height;
  rows.forEach(row => {
    if (row === drag.row) return;
    const current = rows.indexOf(row);
    row.style.transform = from < insertion && current > from && current <= insertion
      ? `translateY(-${offset}px)`
      : from > insertion && current >= insertion && current < from
        ? `translateY(${offset}px)`
        : '';
  });
  drag.insertion = insertion;
}
$('rules').addEventListener('pointerdown', event => {
  const handle = event.target.closest('.rule-drag-handle');
  if (!handle || event.button !== 0) return;
  const row = handle.closest('[data-group]');
  if (!row) return;
  const rows = [...document.querySelectorAll(`[data-group="${row.dataset.group}"]`)];
  const rects = rows.map(item => item.getBoundingClientRect());
  const groupRect = rects.reduce((box, itemRect) => ({ left: Math.min(box.left, itemRect.left), right: Math.max(box.right, itemRect.right), top: Math.min(box.top, itemRect.top), bottom: Math.max(box.bottom, itemRect.bottom) }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
  const rect = rects[rows.indexOf(row)];
  activeDrag = { group: row.dataset.group, id: row.dataset.id, row, rows, rects, groupRect, startScrollTop: document.body.scrollTop, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, started: false };
  handle.setPointerCapture?.(event.pointerId);
});
$('rules').addEventListener('pointermove', event => {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
  const drag = activeDrag;
  if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
  if (!drag.started) {
    drag.started = true;
    const rect = drag.row.getBoundingClientRect();
    drag.clone = drag.row.cloneNode(true);
    drag.clone.classList.add('rule-drag-clone');
    drag.clone.setAttribute('aria-hidden', 'true');
    drag.clone.removeAttribute('data-group');
    drag.clone.removeAttribute('data-id');
    drag.clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    drag.clone.querySelectorAll('textarea,input,button').forEach(input => { input.tabIndex = -1; });
    for (const [selector, area] of [['.rule-drag-handle', 'handle'], ['.rule-condition', 'condition'], ['.rule-threshold', 'threshold'], ['.rule-enabled, .rule-remove', 'action']]) drag.clone.querySelector(selector)?.style.setProperty('grid-area', area);
    const style = window.getComputedStyle(drag.row);
    Object.assign(drag.clone.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px`, gridTemplateColumns: style.gridTemplateColumns, gridTemplateAreas: style.gridTemplateAreas, gap: style.gap, padding: style.padding, alignItems: style.alignItems });
    document.body.append(drag.clone);
    drag.row.classList.add('rule-dragging');
    drag.scrollFrame = scheduleFrame(dragScrollFrame);
  }
  const tabsBottom = document.querySelector('.settings-tabs')?.getBoundingClientRect().bottom ?? 0;
  const headingBottom = drag.row.closest('.rule-group')?.querySelector('.rule-heading')?.getBoundingClientRect().bottom ?? tabsBottom;
  const saveBarTop = document.querySelector('.save-bar')?.getBoundingClientRect().top ?? window.innerHeight;
  const edge = 24;
  const topEdge = Math.max(tabsBottom, headingBottom);
  const bottomEdge = Math.min(saveBarTop, window.innerHeight);
  drag.scrollVelocity = event.clientY < topEdge + edge ? -Math.max(1, Math.ceil((topEdge + edge - event.clientY) / 8)) : event.clientY > bottomEdge - edge ? Math.max(1, Math.ceil((event.clientY - (bottomEdge - edge)) / 8)) : 0;
  event.preventDefault();
  updateRuleDrag(event);
});
function finishRuleDrag(event, cancel = false) {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
  const drag = activeDrag;
  if (drag.started && !cancel && Number.isInteger(drag.insertion)) {
    read();
    const rules = config[`${drag.group}Rules`];
    const from = rules.findIndex(rule => rule.id === drag.id);
    if (from >= 0) {
      const [rule] = rules.splice(from, 1);
      rules.splice(Math.max(0, Math.min(drag.insertion, rules.length)), 0, rule);
      clearRuleDrag();
      render();
      markDirty();
      return;
    }
  }
  clearRuleDrag();
}
$('rules').addEventListener('pointerup', event => finishRuleDrag(event));
$('rules').addEventListener('pointercancel', event => finishRuleDrag(event, true));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && activeDrag) clearRuleDrag(); });
$('rules').addEventListener('keydown', event => { const handle = event.target.closest('.rule-drag-handle'); if (!handle || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const row = handle.closest('[data-group]'); read(); const rules = config[`${row.dataset.group}Rules`]; const index = rules.findIndex(rule => rule.id === row.dataset.id); const next = index + (event.key === 'ArrowUp' ? -1 : 1); if (next < 0 || next >= rules.length) return; [rules[index], rules[next]] = [rules[next], rules[index]]; render(); markDirty(); document.querySelector(`[data-group="${row.dataset.group}"][data-id="${rules[next].id}"] .rule-drag-handle`)?.focus(); });
$('rules').addEventListener('change', event => { const target = event.target; if (!target.dataset.field) return; const row = target.closest('[data-group]'); if (!row) return; if (target.dataset.field === 'enabled') { animateToggle(target); row.dataset.enabled = String(target.checked); } if (!row.querySelector('[data-field="condition"]').value.trim()) { status('空の条件は保存されません。条件を入力するか削除してください'); return; } markDirty(); });
$('rules').addEventListener('pointerdown', event => { if (event.target.closest('.rule-remove') && event.button === 0) event.preventDefault(); });
$('rules').addEventListener('input', event => {
  const slider = event.target;
  if (slider.dataset.field === 'condition') {
    slider.closest('[data-group]').dataset.emptyCondition = String(!slider.value.trim());
    return;
  }
  if (slider.dataset.field !== 'threshold-range') return;
  const row = slider.closest('[data-group]');
  const score = Math.round(Number(slider.value) * 100) / 100;
  row.querySelector('[data-field="threshold"]').value = String(score);
  row.querySelector('.threshold-value').textContent = score.toFixed(2);
});
$('save')?.addEventListener('click', () => { void saveConfig(); });
document.addEventListener('input', event => {
  if (event.target.matches('input:not(#apiKey):not(#import):not(#enabled), textarea')) markDirty();
});

$('saveApiKey')?.addEventListener('click', () => { void saveApiKey(); });
$('provider').onchange = () => { verificationId++; verifiedConnection = null; verificationResult = null; $('apiKey').value = ''; config.provider = $('provider').value; config.keyConfigured = Boolean(config.keyConfiguredByProvider?.[config.provider]); keyEditing = false; if ($('provider').value === 'openrouter' && (!$('model').value || $('model').value === 'jev-latest')) $('model').value = OPENROUTER_DEFAULT_MODEL; else if ($('provider').value === 'typesafe' && ($('model').value === OPENROUTER_DEFAULT_MODEL || $('model').value === 'typesafe/jev-1.13')) $('model').value = 'jev-latest'; renderKeyView(true, true); markDirty(); };
$('changeApiKey')?.addEventListener('click', () => { keyEditing = true; $('apiKey').value = ''; renderKeyView(true); keyStatus('未確認'); $('apiKey').focus(); });
$('cancelApiKey')?.addEventListener('click', () => { keyEditing = false; $('apiKey').value = ''; renderKeyView(true); $('changeApiKey').focus(); });
$('apiKey').oninput = () => { verificationId++; keyStatus('未確認'); };
 $('deleteApiKey')?.addEventListener('click', () => { if (saving) return; const provider = $('provider').value; pendingActions.apiKeyDelete.add(provider); markDirty(); status('APIキー削除を保存時に実行します'); });
$('billingCurrency')?.addEventListener('change', () => { read(); renderUsageLimitInputs(); markDirty(); });
$('resetInputPrice')?.addEventListener('click', () => {
  if (saving) return;
  read();
  config.usageLimits = structuredClone(DEFAULT_CONFIG.usageLimits);
  config.billingCurrency = DEFAULT_CONFIG.billingCurrency;
  const resetSettings = normalizeConfig({ ...config, inputPricePerMillion: DEFAULT_INPUT_PRICE_PER_MILLION, billingCurrency: DEFAULT_CONFIG.billingCurrency, usageLimits: DEFAULT_CONFIG.usageLimits });
  const savedSettings = normalizeConfig(appliedConfig);
  pendingActions.priceReset = JSON.stringify([resetSettings.inputPricePerMillion, resetSettings.billingCurrency, resetSettings.usageLimits]) !== JSON.stringify([savedSettings.inputPricePerMillion, savedSettings.billingCurrency, savedSettings.usageLimits]);
  $('inputPricePerMillion').value = DEFAULT_INPUT_PRICE_PER_MILLION;
  $('billingCurrency').value = config.billingCurrency;
  renderUsageLimitInputs();
  showLimitPicker(false);
  markDirty();
});
function showLimitPicker(show) {
  if ($('usageLimitPicker')) $('usageLimitPicker').hidden = !show;
  $('addUsageLimit').setAttribute('aria-expanded', String(show));
  if (show) $('usageLimitPeriod').focus();
}
$('addUsageLimit')?.addEventListener('click', () => { read(); renderUsageLimitInputs(); showLimitPicker(true); });
$('cancelUsageLimit')?.addEventListener('click', () => { showLimitPicker(false); $('addUsageLimit').focus(); });
$('confirmUsageLimit')?.addEventListener('click', () => { read(); const period = $('usageLimitPeriod').value; if (!period) return; if (!Object.hasOwn(config.usageLimits, period) || config.usageLimits[period] === null) { config.usageLimits[period] = config.billingCurrency === 'USD' ? 0.01 : 1; renderUsageLimitInputs(); showLimitPicker(false); markDirty(); document.querySelector(`[data-limit-period="${period}"]`).focus(); } });
$('usageLimitInputs')?.addEventListener('change', event => { const input = event.target; if (!input.matches('[data-limit-period]')) return; if (config.billingCurrency === 'USD' && input.value !== '' && input.checkValidity()) input.value = Number(input.value).toFixed(2); markDirty(); });
$('usageLimitInputs')?.addEventListener('click', event => { const period = event.target.closest('[data-remove-limit]')?.dataset.removeLimit; if (!period) return; read(); delete config.usageLimits[period]; render(); markDirty(); });
$('export').onclick = async () => { read(); const blob = new Blob([exportConfig(config)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'jev-filter-rules.json'; link.click(); URL.revokeObjectURL(url); };
$('import').onchange = async event => { const file = event.target.files[0]; if (!file) return; try { read(); const imported = importConfig(await file.text(), config); if (!await confirmInPage('ファイルに含まれるリストで現在の条件を置き換えます。続けますか？', '読み込む')) return; config = { ...config, ...imported }; render(); markDirty(); } catch (error) { status(error.message, true); } finally { event.target.value = ''; } };
for (const id of ['model', 'inputPricePerMillion', 'decisionCacheLimitMb']) {
  $(id)?.addEventListener('change', () => { markDirty(); });
}
async function refreshUsage() {
  const config = appliedConfig;
  if (!$('usage')) return;
  try {
    const usage = await chrome.runtime.sendMessage({ type: 'get-usage' });
    const price = config.inputPricePerMillion;
    const formatCost = tokens => price === null || !Number.isFinite(tokens) ? '取得不可' : `${config.billingCurrency} ${(tokens / 1e6 * price).toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
    const total = usage.inputTokens;
    const totalUnknownCount = usage.unreportedRequests;
    const totalUnknown = totalUnknownCount ? `（累計の使用量未取得${totalUnknownCount}件・総額は不明）` : '';
    const totalCost = totalUnknownCount || price === null || !Number.isFinite(total) ? '金額不明' : `${(total / 1e6 * price).toLocaleString('ja-JP', { maximumFractionDigits: 6 })}${config.billingCurrency === 'JPY' ? '円' : 'ドル'}`;
    $('usage').textContent = `累計：${Number.isFinite(total) ? total.toLocaleString('ja-JP') : '取得不可'}トークン／${totalCost}${totalUnknown}`;

    if ($('usageLimitsStatus')) {
      const durations = { '5h': 5 * 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 };
      const labels = { '5h': '5時間', '1d': '1日', '7d': '7日間', '30d': '30日間' };
      const active = Object.entries(config.usageLimits || {}).filter(([, limit]) => Number(limit) > 0);
      $('usageLimitsStatus').replaceChildren(...active.map(([period, limit]) => {
        const item = usage.periods?.[period];
        const reported = Number.isFinite(item?.inputTokens);
        const cost = price === null || !reported ? null : item.inputTokens / 1e6 * price;
        const measurable = price > 0 && reported && !item?.unreportedRequests;
        const remaining = measurable ? Math.max(0, Number(limit) - cost) : null;
        const remainingRate = measurable ? Math.max(0, Math.min(100, remaining / Number(limit) * 100)) : null;
        const state = !measurable ? 'unknown' : remainingRate === 0 ? 'exhausted' : remainingRate <= 20 ? 'low' : 'available';
        const card = document.createElement('div');
        card.className = 'usage-budget';
        card.dataset.state = state;
        const periodColumn = document.createElement('div');
        periodColumn.className = 'budget-period';
        const title = document.createElement('h3');
        title.textContent = labels[period];
        const badge = document.createElement('span');
        badge.className = 'budget-state';
        badge.textContent = state === 'exhausted' ? '上限に到達' : state === 'low' ? '残りわずか' : state === 'unknown' ? '算出できません' : '利用可能';
        periodColumn.append(title, badge);
        const details = document.createElement('div');
        details.className = 'budget-details';
        const bar = document.createElement('progress');
        bar.max = 100;
        bar.value = remainingRate ?? 0;
        bar.hidden = !measurable;
        bar.setAttribute('aria-label', `${labels[period]}の残り利用額`);
        bar.setAttribute('aria-valuetext', measurable ? `上限の${remainingRate.toLocaleString(undefined, { maximumFractionDigits: 1 })}%が残っています` : '算出できません');
        const metrics = document.createElement('div');
        metrics.className = 'budget-metrics';
        const spent = document.createElement('span');
        spent.className = 'budget-amounts';
        const usedAmount = document.createElement('span');
        usedAmount.textContent = `使用済み：${cost === null ? '不明' : formatCost(item.inputTokens)}`;
        const limitAmount = document.createElement('span');
        limitAmount.textContent = `／上限：${config.billingCurrency} ${Number(limit).toLocaleString('en-US', { minimumFractionDigits: config.billingCurrency === 'USD' ? 2 : 0, maximumFractionDigits: config.billingCurrency === 'USD' ? 2 : 6 })}`;
        spent.append(usedAmount, document.createElement('wbr'), limitAmount);
        const percent = document.createElement('span');
        if (measurable) {
          const number = document.createElement('strong');
          number.textContent = remainingRate.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
          percent.append('残り', number, '%');
        } else percent.textContent = price === 0 ? '単価0・上限無効' : '残り不明';
        metrics.append(spent, percent);
        const reset = document.createElement('p');
        reset.className = 'budget-reset';
        const next = Number.isFinite(item?.startedAt) ? formatRemainingTime(item.startedAt + durations[period]) : '未開始';
        reset.textContent = `次回リセット：${next}`;
        const notice = document.createElement('p');
        notice.className = 'budget-notice';
        notice.hidden = state === 'available' || state === 'low';
        notice.textContent = item?.unreportedRequests ? '使用量が未取得の通信があるため、判定を停止しています。' : price === null ? '単価を設定すると残額を確認できます。' : price === 0 ? '利用上限を使うには、0より大きい単価を設定してください。' : !reported ? '期間内の使用量を取得できません。' : 'この期間のリセットまで、新しい判定を停止します。';
        details.append(metrics, bar, reset, notice);
        card.append(periodColumn, details);
        return card;
      }));
      if (!active.length) {
        const empty = document.createElement('p');
        empty.className = 'usage-empty';
        empty.textContent = '利用上限はありません。';
        $('usageLimitsStatus').append(empty);
      }
    }
    $('usageLimitsStatus')?.classList.add('usage-ready');
  } catch {
    $('usage').textContent = '使用量を取得できません';
    if ($('usageLimitsStatus')) $('usageLimitsStatus').textContent = '上限状況を取得できません';
    $('usageLimitsStatus')?.classList.add('usage-ready');
  }
}
function formatRemainingTime(resetAt) {
  const totalMinutes = Math.max(0, Math.ceil((resetAt - Date.now()) / 60000));
  if (!totalMinutes) return 'まもなくリセット';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  return `あと${days ? `${days}日 ` : ''}${days || hours ? `${hours}時間` : ''}${minutes}分`;
}
async function refreshCacheUsage() {
  const value = $('cacheUsageValue');
  const unit = $('cacheUsageUnit');
  if (!value || !unit) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'get-cache-size' });
    const bytes = Number(result?.bytes);
    if (result?.unavailable || !Number.isFinite(bytes)) {
      value.textContent = '取得不可';
      unit.textContent = '';
      return;
    }
    value.textContent = (bytes / 1024 / 1024).toFixed(2);
    unit.textContent = 'MB';
  } catch {
    value.textContent = '取得不可';
    unit.textContent = '';
  }
}
if ($('clearCache')) $('clearCache').onclick = () => { if (saving) return; pendingActions.cache = true; markDirty(); status('キャッシュ削除を保存時に実行します'); };
if ($('resetUsage')) $('resetUsage').onclick = () => { if (saving) return; pendingActions.usage = true; markDirty(); status('使用量リセットを保存時に実行します'); };
if ($('resetAllUsage')) $('resetAllUsage').onclick = () => { if (saving) return; pendingActions.allUsage = true; markDirty(); status('すべての使用量リセットを保存時に実行します'); };
chrome.runtime.sendMessage({ type: 'get-config' }).then(result => { config = normalizeConfig(result || {}); appliedConfig = structuredClone(config); config.keyConfigured = Boolean(result?.keyConfigured); config.keyConfiguredByProvider = result?.keyConfiguredByProvider || { [config.provider]: config.keyConfigured }; verifiedConnection = null; verificationResult = config.keyConfigured ? { reason: 'unchecked' } : { reason: 'missing-key' }; render(); }).catch(() => { config = normalizeConfig(); appliedConfig = structuredClone(config); render(); });
chrome.storage.onChanged?.addListener?.((changes, area) => { if (area === 'local' && changes.tokenUsage) refreshUsage(); });
if (document.querySelector('[role="tabpanel"]')) {
  const timer = window.setInterval(() => { if (!document.hidden && !$('panel-usage').hidden) void refreshUsage(); }, 60000);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
}
