import { DEFAULT_CONFIG, normalizeConfig } from './core/config.js';
import { evaluateAnswers, validAnswer } from './core/filter.js';

let config = DEFAULT_CONFIG;
let keyConfigured = false;
let pageGeneration = 0;
let configGeneration = 0;
let runtimeContextInvalidated = false;
let observer;
const requestIdentity = new WeakMap();
const partState = new WeakMap();
const resultCache = new Map();
const manuallyShown = new Set();
let touchedCache = new WeakMap();
const RESULT_CACHE_LIMIT = 200;
const RESULT_CACHE_TTL = 5 * 60 * 1000;
const selector = 'main [data-testid="primaryColumn"] article[role="article"][data-testid="tweet"]';
const hiddenClass = 'jev-content-hidden';
const quoteHiddenClass = 'jev-quote-hidden';
const allRules = () => [...config.blackRules, ...config.whiteRules];

const style = document.createElement('style');
style.textContent = `
article:has(> .jev-placeholder), [role="link"]:has(> .jev-placeholder) { flex-direction: column !important; }
.jev-main-path > :not(.jev-main-path):not(.jev-main-header):not(.jev-placeholder), .jev-quote-path > :not(.jev-quote-path):not(.jev-quote-header):not(.jev-placeholder) { display: none !important; }
.jev-placeholder { box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; width: 100%; min-width: 0; padding: 16px; margin: 8px 0; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 12px; background: transparent; color: inherit; font: 14px/1.5 Arial, sans-serif; cursor: default; }
.jev-placeholder .jev-message { flex: 1 1 200px; min-width: 0; }
.jev-placeholder .jev-title { display: block; font-weight: 600; }
.jev-placeholder .jev-reason { color: color-mix(in srgb, currentColor 65%, transparent); margin: 8px 0 0; font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; white-space: pre-line; font-variant-numeric: tabular-nums; }
.jev-placeholder button { flex: 0 0 auto; margin: 0; padding: 7px 14px; min-height: 36px; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 18px; background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.jev-placeholder button:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.jev-placeholder button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 3px; }
.jev-placeholder[data-jev-kind="quote"] { margin: 0; padding: 12px; border: 0; border-radius: 0; background: transparent; gap: 8px 12px; }
.jev-placeholder[data-jev-kind="quote"] .jev-title { font-size: 13px; }
.jev-placeholder[data-jev-kind="quote"] .jev-reason { margin-top: 4px; }
.jev-placeholder[data-jev-kind="quote"] button { min-height: 32px; padding: 5px 12px; font-size: 13px; }
`;
document.documentElement.append(style);

chrome.runtime.onMessage?.addListener?.(message => {
  if (runtimeContextInvalidated || message.type !== 'config-updated' || !message.config) return;
  const next = normalizeConfig(message.config);
  const nextKeyConfigured = Boolean(message.config.keyConfigured);
  if (JSON.stringify([config.provider, config.model, config.decisionCacheLimitMb, keyConfigured]) !== JSON.stringify([next.provider, next.model, next.decisionCacheLimitMb, nextKeyConfigured])) { resultCache.clear(); manuallyShown.clear(); }
  pageGeneration++;
  configGeneration++;
  config = next;
  keyConfigured = nextKeyConfigured;
  scan();
});
chrome.storage.onChanged.addListener(changes => {
  if (runtimeContextInvalidated) return;
  if (changes.cacheGeneration) {
    pageGeneration++;
    resultCache.clear();
    touchedCache = new WeakMap();
    for (const article of document.querySelectorAll(selector)) {
      for (const part of extractParts(article)) {
        const state = partState.get(part.root);
        if (!state?.pending) continue;
        handleUnknownPart(part, getPlaceholders(part.root).find(node => node.classList.contains('jev-pending')), 'cache-cleared');
        partState.set(part.root, { ...state, pending: false });
      }
    }
  }
});
const observerOptions = { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] };
observer = new MutationObserver(records => scan(records));
observer.observe(document.documentElement, observerOptions);
sendRuntimeMessage({ type: 'get-config' }).then(next => { if (runtimeContextInvalidated) return; if (next && !next.error) { config = normalizeConfig(next); keyConfigured = Boolean(next.keyConfigured); } scan(); }).catch(() => { if (!runtimeContextInvalidated) scan(); });

function scan(records) {
  if (runtimeContextInvalidated) return;
  observer.disconnect();
  try {
    if (!config.enabled || !allRules().some(rule => rule.enabled && rule.condition)) {
      restoreAllContent();
      return setStatus('disabled');
    }
    setStatus('ready');
    const articles = records?.length ? affectedArticles(records) : [...document.querySelectorAll(selector)];
    articles.sort((left, right) => articlePriority(left) - articlePriority(right));
    for (const article of articles) {
      for (const part of extractParts(article)) syncPart(part);
    }
  } finally {
    if (!runtimeContextInvalidated) observer.observe(document.documentElement, observerOptions);
  }
}

function restoreAllContent() {
  for (const article of document.querySelectorAll(selector)) {
    article.classList.remove(hiddenClass);
    clearHeaderLayout(article);
    getPlaceholders(article).forEach(node => node.remove());
    for (const part of extractParts(article).filter(part => part.kind === 'quote')) {
      part.root.classList.remove(quoteHiddenClass);
      clearHeaderLayout(part.root);
      getPlaceholders(part.root).forEach(node => node.remove());
    }
  }
}
function stopForInvalidatedContext() {
  if (runtimeContextInvalidated) return;
  runtimeContextInvalidated = true;
  observer?.disconnect();
  restoreAllContent();
}
async function sendRuntimeMessage(message) {
  if (runtimeContextInvalidated) throw new Error('Extension context invalidated');
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (String(error?.message || error).includes('Extension context invalidated')) stopForInvalidatedContext();
    throw error;
  }
}

function extractParts(article) {
  const quoteCards = [...article.querySelectorAll('[role="link"]')].filter(card => card.closest('article') === article && card.querySelector('[data-testid="User-Name"]') && card.querySelector('[data-testid="tweetText"]'));
  const quoteNodes = new Set(quoteCards.flatMap(card => [...card.querySelectorAll('[data-testid="tweetText"]')]));
  const mainText = [...article.querySelectorAll('[data-testid="tweetText"]')].filter(node => !quoteNodes.has(node)).map(node => node.textContent.trim()).filter(Boolean).join('\n');
  const parts = [{ kind: 'main', article, root: article, text: mainText }];
  for (const card of quoteCards) {
    const text = [...card.querySelectorAll('[data-testid="tweetText"]')].map(node => node.textContent.trim()).filter(Boolean).join('\n');
    if (text) parts.push({ kind: 'quote', article, root: card, text });
  }
  return parts;
}
function cacheKey(article, text, kind = 'main', root = article) {
  const postId = kind === 'quote'
    ? root.querySelector('a[href*="/status/"]')?.href || `quote:${text}`
    : article.dataset.postId || article.querySelector('a[href*="/status/"]')?.href;
  if (!postId || !text) return null;
  const rules = [...new Map(allRules().filter(rule => rule.condition).map(rule => [rule.id, rule.id])).values()].sort();
  const settings = JSON.stringify({ provider: config.provider, model: config.model, rules });
  return `${kind}|${postId}|${text}|${settings}`;
}
function rememberResult(key, result, expires = Date.now() + RESULT_CACHE_TTL, persistent = false) {
  resultCache.delete(key);
  resultCache.set(key, { answers: result, expires, persistent });
  // ponytail: 200件で上限を固定し、ページ内スクロールで無制限に増えないようにする
  while (resultCache.size > RESULT_CACHE_LIMIT) resultCache.delete(resultCache.keys().next().value);
}
function syncPart(part) {
  if (runtimeContextInvalidated) return;
  const key = cacheKey(part.article, part.text, part.kind, part.root);
  const signature = `${configGeneration}|${part.kind}|${part.article.dataset.postId || ''}|${part.text}|${key || ''}`;
  const cached = key && resultCache.get(key);
  if (cached && cached.expires > Date.now()) {
    if (validAnswers(cached.answers)) {
      partState.set(part.root, { signature });
      applyAnswers(part, key, cached.answers);
      if (cached.persistent && touchedCache.get(part.root) !== key) { touchedCache.set(part.root, key); sendRuntimeMessage({ type: 'touch-cache', text: part.text }).catch(() => {}); }
      return;
    }
  }
  if (cached?.expires <= Date.now()) { resultCache.delete(key); partState.delete(part.root); }
  if (partState.get(part.root)?.signature !== signature) processPart(part, signature, timingNow());
}

function affectedArticles(records) {
  const articles = new Set();
  for (const record of records) {
    const target = record.target?.closest?.(selector) || record.target?.parentElement?.closest?.(selector);
    if (target) articles.add(target);
    for (const node of record.addedNodes || []) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.(selector)) articles.add(node);
      node.querySelectorAll?.(selector).forEach(article => articles.add(article));
      const parentArticle = node.closest?.(selector);
      if (parentArticle) articles.add(parentArticle);
    }
  }
  return [...articles].filter(article => article.isConnected);
}

function articlePriority(article) {
  const rect = article.getBoundingClientRect?.();
  if (!rect || !Number.isFinite(rect.top)) return 1;
  const viewportHeight = document.defaultView?.innerHeight || document.documentElement.clientHeight || 0;
  if (rect.bottom >= 0 && rect.top <= viewportHeight) return 0;
  if (rect.bottom >= -viewportHeight && rect.top <= viewportHeight * 2) return 1;
  return 2;
}
async function processPart(part, signature, detectedAt) {
  if (runtimeContextInvalidated) return;
  const { article, root, kind, text } = part;
  partState.set(root, { signature, pending: true });
  const identity = Symbol('request');
  requestIdentity.set(root, identity);
  if (kind === 'main') { article.dataset.jevState = 'pending'; delete article.dataset.jevReason; }
  else { root.classList.remove(quoteHiddenClass); clearHeaderLayout(root); getPlaceholders(root).forEach(node => node.remove()); }
  const postId = article.dataset.postId || article.querySelector('a[href*="/status/"]')?.href || '';
  const requestKey = cacheKey(article, text, kind, root);
  const generation = pageGeneration;
  if (!text) return handleUnknownPart(part, undefined, 'empty-text');
  const result = document.createElement('div');
  result.className = 'jev-pending jev-placeholder';
  result.textContent = config.pending === 'hide' ? '判定中…' : '';
  if (config.pending === 'hide') kind === 'main' ? hideOriginal(article, result) : hideQuote(root, result);
  let response;
  const sentAt = timingNow();
  try {
    const message = { type: 'classify', text, priority: articlePriority(article) };
    if (globalThis.JEV_DEV_TIMING) message.timing = { detectedAt, sentAt };
    response = await sendRuntimeMessage(message);
  }
  catch {
    if (runtimeContextInvalidated) return;
    const respondedAt = timingNow();
    if (!isCurrentPart(part, identity, text, postId, requestKey, generation)) return;
    partState.set(root, { signature, pending: false });
    handleUnknownPart(part, result, 'request-error');
    emitTiming({ detectedAt, sentAt, respondedAt });
    return;
  }
  if (runtimeContextInvalidated) return;
  const respondedAt = timingNow();
  if (!isCurrentPart(part, identity, text, postId, requestKey, generation)) {
    emitTiming({ detectedAt, sentAt, respondedAt });
    if (generation !== pageGeneration) return;
    if (requestIdentity.get(root) === identity) { partState.delete(root); scan(); }
    return;
  }
  partState.set(root, { signature, pending: false });
  if (!config.enabled) {
    kind === 'main' ? restoreOriginal(article, result) : restoreQuote(root, result);
    emitTiming({ detectedAt, sentAt, respondedAt });
    return;
  }
  if (response?.error || response?.unknown) {
    handleUnknownPart(part, result, response?.reason || 'unknown', response?.status);
    emitTiming({ detectedAt, sentAt, respondedAt });
    return;
  }
  const answers = response.answers || {};
  if (!validAnswers(answers)) {
    handleUnknownPart(part, result, 'invalid-answer');
    emitTiming({ detectedAt, sentAt, respondedAt });
    return;
  }
  const key = cacheKey(article, text, kind, root);
  if (!key) {
    applyAnswers(part, null, answers, result);
    emitTiming({ detectedAt, sentAt, respondedAt });
    return;
  }
  rememberResult(key, answers, response._jevCacheExpiresAt, Boolean(response._jevCacheExpiresAt));
  applyAnswers(part, key, answers, result);
  emitTiming({ detectedAt, sentAt, respondedAt, background: response._jevTiming });
}

function timingNow() { return globalThis.performance?.now?.() ?? Date.now(); }
function emitTiming(timing) {
  if (!globalThis.JEV_DEV_TIMING) return;
  console.debug('[jev timing]', {
    detectToSendMs: Math.round(timing.sentAt - timing.detectedAt),
    sendToResponseMs: Math.round(timing.respondedAt - timing.sentAt),
    responseToDomMs: Math.round(timingNow() - timing.respondedAt),
    background: timing.background
  });
}

function isCurrentPart(part, identity, text, postId, requestKey, generation) {
  return generation === pageGeneration && requestIdentity.get(part.root) === identity && extractParts(part.article).some(current => current.root === part.root && current.kind === part.kind && current.text === text) && (part.article.dataset.postId || part.article.querySelector('a[href*="/status/"]')?.href || '') === postId && cacheKey(part.article, text, part.kind, part.root) === requestKey;
}
function applyAnswers(part, key, answers, pending) {
  if (!validAnswers(answers)) return handleUnknownPart(part, pending, 'invalid-answer');
  const normalized = Object.fromEntries(allRules().map(rule => [rule.id, answers?.[rule.id]]));
  const outcome = evaluateAnswers(normalized, config.blackRules, config.whiteRules);
  if (part.kind === 'quote') applyQuoteResult(part, key, outcome, pending);
  else applyResult(part.article, key, outcome, pending);
}

function validAnswers(answers) { return allRules().filter(rule => rule.condition && rule.enabled).every(rule => validAnswer(answers?.[rule.id])); }

function applyResult(article, key, outcome, pending) {
  if (!outcome.matched) {
    if (article.dataset.jevState !== 'no-match') article.dataset.jevState = 'no-match';
    delete article.dataset.jevCollapsed;
    getPlaceholders(article).forEach(node => node.remove());
    article.classList.remove(hiddenClass); clearHeaderLayout(article);
    pending?.remove();
    return;
  }
  if (article.dataset.jevState !== 'matched') article.dataset.jevState = 'matched';
  if (article.dataset.jevCollapsed !== 'true') article.dataset.jevCollapsed = 'true';
  pending?.remove();
  getPlaceholders(article).filter(node => node.classList.contains('jev-pending')).forEach(node => node.remove());
  const placeholder = getPlaceholders(article)[0] || makeCollapsed(outcome.rules, () => {
    showOriginal(article, getPlaceholders(article)[0], key);
  });
  mountPlaceholder(article, placeholder);
  const label = outcome.blockedByWhite ? formatWhiteMismatch(outcome.rules) : formatMatches(outcome.rules);
  updateCollapsed(placeholder, label);
  if (manuallyShown.has(key)) return showOriginal(article, placeholder, key);
  placeholder.querySelector('button').onclick = () => showOriginal(article, placeholder, key);
  if (placeholder.querySelector('button').textContent !== '表示する') placeholder.querySelector('button').textContent = '表示する';
  hideOriginal(article, placeholder);
}

function showOriginal(article, placeholder, key) {
  if (key) manuallyShown.add(key);
  restoreOriginal(article, placeholder, true);
  setMessageTitle(placeholder, '投稿を表示しています');
  const button = placeholder?.querySelector('button');
  if (!button) return;
  button.disabled = false;
  button.textContent = '非表示に戻す';
  button.onclick = () => {
    if (key) manuallyShown.delete(key);
    button.textContent = '表示する';
    button.onclick = () => showOriginal(article, placeholder, key);
    hideOriginal(article, placeholder);
  };
}

function handleUnknownPart(part, pending, reason = 'unknown', status) {
  if (part.kind === 'quote') return handleUnknownQuote(part.root, pending, reason, status);
  return handleUnknown(part.article, pending, reason, status);
}
function handleUnknown(article, pending, reason = 'unknown', status) {
  article.dataset.jevState = 'unknown';
  article.dataset.jevReason = reason;
  if (Number.isInteger(status) && status >= 100 && status <= 599) article.dataset.jevHttpStatus = String(status);
  else delete article.dataset.jevHttpStatus;
  if (config.unknown !== 'hide') {
    if (pending?.isConnected) restoreOriginal(article, pending);
    return;
  }
  let placeholder;
  placeholder = makeCollapsed([], () => restoreOriginal(article, placeholder), '判定できない投稿');
  if (pending?.isConnected) pending.replaceWith(placeholder);
  else hideOriginal(article, placeholder);
}
function handleUnknownQuote(card, pending, reason = 'unknown', status) {
  card.dataset.jevState = 'unknown';
  card.dataset.jevReason = reason;
  if (Number.isInteger(status) && status >= 100 && status <= 599) card.dataset.jevHttpStatus = String(status);
  else delete card.dataset.jevHttpStatus;
  if (config.unknown !== 'hide') return restoreQuote(card, pending);
  const placeholder = makeCollapsed([], () => restoreQuote(card, placeholder), '判定できない引用元');
  if (pending?.isConnected) pending.replaceWith(placeholder);
  else hideQuote(card, placeholder);
  mountPlaceholder(card, placeholder);
}
function hideOriginal(article, placeholder) { setMessageTitle(placeholder, '投稿を非表示にしました'); if (!article.classList.contains(hiddenClass)) article.classList.add(hiddenClass); preserveHeader(article, placeholder); }
function restoreOriginal(article, placeholder, keepMessage = false) {
  if (!article.isConnected && placeholder?.isConnected) placeholder.replaceWith(article);
  else if (keepMessage) {
    const button = placeholder?.querySelector('button');
    if (button) { button.disabled = true; button.textContent = '表示済み'; }
  } else placeholder?.remove();
  article.classList.remove(hiddenClass); clearHeaderLayout(article);
  if (article.dataset.jevRestored !== 'true') article.dataset.jevRestored = 'true';
}
function applyQuoteResult(part, key, outcome, pending) {
  const card = part.root;
  if (!outcome.matched) {
    card.dataset.jevState = 'no-match';
    delete card.dataset.jevCollapsed;
    getPlaceholders(card).forEach(node => node.remove());
    restoreQuote(card);
    pending?.remove();
    return;
  }
  card.dataset.jevState = 'matched';
  card.dataset.jevCollapsed = 'true';
  pending?.remove();
  getPlaceholders(card).filter(node => node.classList.contains('jev-pending')).forEach(node => node.remove());
  const placeholder = getPlaceholders(card)[0] || makeCollapsed(outcome.rules, () => showQuote(card, getPlaceholders(card)[0], key));
  mountPlaceholder(card, placeholder);
  const label = outcome.blockedByWhite ? formatWhiteMismatch(outcome.rules) : formatMatches(outcome.rules);
  updateCollapsed(placeholder, label);
  if (manuallyShown.has(key)) return showQuote(card, placeholder, key);
  placeholder.querySelector('button').onclick = () => showQuote(card, placeholder, key);
  if (placeholder.querySelector('button').textContent !== '表示する') placeholder.querySelector('button').textContent = '表示する';
  hideQuote(card, placeholder);
}
function hideQuote(card, placeholder) { setMessageTitle(placeholder, '引用元を非表示にしました'); card.classList.add(quoteHiddenClass); preserveHeader(card, placeholder); }
function restoreQuote(card, placeholder, keepMessage = false) {
  placeholder?.remove();
  card.classList.remove(quoteHiddenClass); clearHeaderLayout(card);
  if (keepMessage && placeholder) mountPlaceholder(card, placeholder);
}
function showQuote(card, placeholder, key) {
  if (key) manuallyShown.add(key);
  restoreQuote(card, placeholder, true);
  setMessageTitle(placeholder, '引用元を表示しています');
  const button = placeholder?.querySelector('button');
  if (!button) return;
  button.disabled = false;
  button.textContent = '非表示に戻す';
  button.onclick = () => {
    if (key) manuallyShown.delete(key);
    button.textContent = '表示する';
    button.onclick = () => showQuote(card, placeholder, key);
    hideQuote(card, placeholder);
  };
}
function formatMatches(rules) { return formatRuleScores(rules, '非表示条件'); }
function formatWhiteMismatch(rules) { return formatRuleScores(rules, '表示条件'); }
function formatRuleScores(rules, kind) {
  return rules.map(rule => `${kind}「${rule.condition}」${rule.probability.toFixed(2)}`).join('\n');
}
function setMessageTitle(box, text) {
  const title = box?.querySelector('.jev-title');
  if (title && title.textContent !== text) title.textContent = text;
}
function updateCollapsed(box, label) {
  const reason = box.querySelector('.jev-reason');
  if (reason && reason.textContent !== label) reason.textContent = label;
}
// Xのヘッダーを複製・移動せず、元の本文列に案内を挿入する。
function getPlaceholders(root) {
  return [...root.querySelectorAll('.jev-placeholder')].filter(box => box.closest('[data-jev-part]') === root);
}
function headerLayout(root) {
  const quoted = root.getAttribute('role') === 'link';
  const owns = node => quoted || !node.closest('[role="link"]');
  const name = [...root.querySelectorAll('[data-testid="User-Name"]')].find(owns);
  let header = name;
  while (header && header.parentElement !== root && !header.parentElement.querySelector('[data-testid="tweetText"]')) header = header.parentElement;
  const avatar = [...root.querySelectorAll('[data-testid="Tweet-User-Avatar"], [data-testid^="UserAvatar-Container"]')].find(owns);
  return { header, avatar, host: header?.parentElement || root, kind: quoted ? 'quote' : 'main' };
}
function mountPlaceholder(root, placeholder) {
  const { header, host, kind } = headerLayout(root);
  root.dataset.jevPart = kind;
  placeholder.dataset.jevKind = kind;
  if (placeholder.parentElement !== host || (header && header.nextElementSibling !== placeholder)) {
    if (header) header.after(placeholder);
    else host.append(placeholder);
  }
}
function clearHeaderLayout(root) {
  const kind = root.getAttribute('role') === 'link' ? 'quote' : 'main';
  for (const node of [root, ...root.querySelectorAll(`.jev-${kind}-path, .jev-${kind}-header`)]) {
    node.classList.remove(`jev-${kind}-path`, `jev-${kind}-header`);
  }
}
function preserveHeader(root, placeholder) {
  clearHeaderLayout(root);
  mountPlaceholder(root, placeholder);
  const { header, avatar, kind } = headerLayout(root);
  root.classList.add(`jev-${kind}-path`);
  for (const node of [header, header?.contains(avatar) ? null : avatar].filter(Boolean)) {
    node.classList.add(`jev-${kind}-header`);
    for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) parent.classList.add(`jev-${kind}-path`);
  }
  // 投稿者行より前にある余白・リポスト表示も元のレイアウトとして残す。
  if (kind === 'main' && header && avatar) {
    let row = header;
    while (row !== root && !row.contains(avatar)) row = row.parentElement;
    for (; row && row !== root; row = row.parentElement) {
      for (let before = row.previousElementSibling; before; before = before.previousElementSibling) before.classList.add(`jev-${kind}-header`);
    }
  }
}
function makeCollapsed(rules, restore, prefix = '') {
  const box = document.createElement('div');
  box.className = 'jev-placeholder';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Shirakawa');
  const message = document.createElement('div');
  message.className = 'jev-message';
  const title = document.createElement('span');
  title.className = 'jev-title';
  title.textContent = prefix || '投稿を非表示にしました';
  const reason = document.createElement('p');
  reason.className = 'jev-reason';
  reason.textContent = prefix || formatMatches(rules);

  message.append(title, reason);
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '表示する';
  button.onclick = restore;
  box.append(message, button);
  box.addEventListener('click', event => event.stopPropagation());
  box.addEventListener('keydown', event => event.stopPropagation());
  return box;
}
function setStatus(status) { if (document.documentElement.dataset.jevStatus !== status) document.documentElement.dataset.jevStatus = status; }
