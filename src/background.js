import { DEFAULT_CONFIG, OPENROUTER_DEFAULT_MODEL, normalizeConfig } from './core/config.js';
import { validAnswer } from './core/filter.js';

const endpoints = { typesafe: 'https://api.typesafe.ai/v1/systemone', openrouter: 'https://openrouter.ai/api/alpha/decisions' };
const verifyEndpoints = { typesafe: 'https://api.typesafe.ai/v1/systemone', openrouter: 'https://openrouter.ai/api/v1/key' };
const KEY_STORAGE = 'jevApiKeys';
const KEY_ACCESS = 'TRUSTED_CONTEXTS';
let storageReady;
let actionError = false;
let actionRevision = 0;
let actionIconQueue = Promise.resolve();
function scheduleActionIcon() {
  actionIconQueue = actionIconQueue.then(() => refreshActionIcon(), () => refreshActionIcon()).catch(() => undefined);
  return actionIconQueue;
}
async function refreshActionIcon() {
  if (!chrome.action?.setIcon) return;
  const revision = ++actionRevision;
  let state = 'error';
  try {
    const config = await getConfig();
    state = !config.enabled ? 'disabled' : actionError || !await getApiKey(config.provider) || await getBudgetStatus(config) ? 'error' : 'normal';
  } catch { /* 設定を読めない場合はエラー表示を維持 */ }
  if (revision !== actionRevision) return;
  const suffix = state === 'normal' ? '' : `-${state}`;
  try {
    await chrome.action.setIcon({ path: Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon${suffix}${size}.png`])) });
    await chrome.action.setTitle?.({ title: `Shirakawa：${state === 'disabled' ? '無効' : state === 'error' ? '判定できません。設定を確認してください' : '有効'}` });
  } catch { /* アイコン更新の失敗で判定処理を止めない */ }
}
async function initializeStorage() {
  if (storageReady) return storageReady;
  storageReady = (async () => {
    try {
      await chrome.storage.local?.setAccessLevel?.({ accessLevel: KEY_ACCESS });
    } catch (error) { storageReady = undefined; throw error; }
  })();
  return storageReady;
}
async function getConfig() {
  await initializeStorage();
  const config = normalizeConfig((await chrome.storage.local.get('config')).config || DEFAULT_CONFIG);
  return config;
}
async function getApiKey(provider) {
  await initializeStorage();
  const local = (await chrome.storage.local.get(KEY_STORAGE))[KEY_STORAGE] || {};
  return typeof local[provider] === 'string' ? local[provider] : '';
}
function isManagementSender(sender) {
  const prefix = `chrome-extension://${chrome.runtime.id}/`;
  return typeof sender?.url === 'string' && sender.url === `${prefix}options/index.html`;
}
function isXSender(sender) {
  try { return new URL(sender?.url).origin === 'https://x.com'; } catch { return false; }
}
async function saveConfig(rawConfig) {
  const operation = usageQueue.then(async () => {
    const oldRawConfig = (await chrome.storage.local.get('config')).config || {};
    const config = normalizeConfig(rawConfig);
    const oldConfig = normalizeConfig(oldRawConfig);
    const limits = configuredLimits(config);
    const oldLimits = configuredLimits(oldConfig);
    const stored = (await chrome.storage.local.get('tokenUsage')).tokenUsage || {};
    const periods = structuredClone(stored.periods || {});
    for (const period of Object.keys(USAGE_PERIODS)) {
      if (limits[period] && (!oldLimits[period] || !Number.isFinite(periodState(stored, period).startedAt))) periods[period] = { startedAt: Date.now(), inputTokens: 0, unreportedRequests: 0 };
    }
    await chrome.storage.local.set({ config, tokenUsage: { ...stored, periods } });
    await notifyConfig();
    return { ok: true };
  });
  usageQueue = operation.catch(() => undefined);
  return operation;
}
async function keyConfiguredByProvider() { const keys = (await chrome.storage.local.get(KEY_STORAGE))[KEY_STORAGE] || {}; return Object.fromEntries(Object.keys(endpoints).map(provider => [provider, typeof keys[provider] === 'string' && Boolean(keys[provider])])); }
async function publicConfig(config, keyStatus = false) { return { ...config, keyConfigured: keyStatus, keyConfiguredByProvider: await keyConfiguredByProvider() }; }
async function notifyConfig() {
  actionError = false;
  await refreshActionIcon();
  const config = await getConfig();
  const key = await getApiKey(config.provider);
  const message = { type: 'config-updated', config: await publicConfig(config, Boolean(key)) };
  try {
    const tabs = await chrome.tabs?.query?.({ url: ['https://x.com/*'] }) || [];
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => chrome.tabs.sendMessage(tab.id, message)));
  } catch {}
}
const API_CONCURRENCY = 2;
let apiOrder = 0;
let apiActive = 0;
const apiPending = [];
function enqueueApi(task, priority = 1) {
  return new Promise((resolve, reject) => {
    apiPending.push({ task, priority: Number.isFinite(priority) ? Math.max(0, Math.min(2, priority)) : 1, order: apiOrder++, resolve, reject });
    pumpApi();
  });
}
function pumpApi() {
  while (apiActive < API_CONCURRENCY && apiPending.length) {
    apiPending.sort((a, b) => a.priority - b.priority || a.order - b.order);
    const item = apiPending.shift();
    apiActive++;
    Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => { apiActive--; pumpApi(); });
  }
}
let usageQueue = Promise.resolve();
const inFlight = new Map();
const inFlightGenerations = new Map();
const resultCache = new Map();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const CACHE_DB = 'jev-decision-cache';
const CACHE_STORE = 'results';
const CACHE_META_STORE = 'metadata';
const CACHE_META_KEY = '__jev_cache_meta__';
let cacheDbPromise;
let cacheGeneration = 0;
let cacheToken = '';
let keyGeneration = 0;
let configGeneration = 0;

function questionRules(config) {
  const unique = new Map();
  for (const rule of [...config.blackRules, ...config.whiteRules]) {
    if (rule.enabled && rule.condition && !unique.has(rule.id)) unique.set(rule.id, rule);
  }
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function cacheKey(postId, config) {
  const questions = Object.fromEntries(questionRules(config).map(rule => [rule.id, { type: 'noul', instructions: `この投稿は、次の条件に該当しますか？\n条件：${rule.condition}` }]));
  return JSON.stringify({ postId, provider: config.provider, model: config.model, questions });
}
function cacheSize(key, result, createdAt, lastUsedAt) { return new TextEncoder().encode(JSON.stringify({ key, result, createdAt, lastUsedAt })).byteLength; }
function openCache() {
  if (cacheDbPromise || typeof indexedDB === 'undefined') return cacheDbPromise;
  cacheDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 4);
    request.onupgradeneeded = event => {
      const db = request.result;
      let store;
      try { store = request.transaction.objectStore(CACHE_STORE); } catch { store = db.createObjectStore(CACHE_STORE, { keyPath: 'key' }); }
      let metaStore;
      try { metaStore = request.transaction.objectStore(CACHE_META_STORE); } catch { metaStore = db.createObjectStore(CACHE_META_STORE, { keyPath: 'key' }); }
      if (event.oldVersion < 4) {
        store.clear();
        metaStore.clear();
        if (store.indexNames?.contains?.('lookup')) store.deleteIndex('lookup');
      }
      if (store?.createIndex && !store.indexNames?.contains?.('lastUsedAt')) store.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
      if (store?.createIndex && !store.indexNames?.contains?.('lookup')) store.createIndex('lookup', ['postId', 'provider', 'model'], { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(() => null);
  return cacheDbPromise;
}
function transaction(db, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, mode);
    let value;
    try { value = work(tx.objectStore(CACHE_STORE)); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('cache transaction aborted'));
  });
}
function transactionStores(db, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CACHE_STORE, CACHE_META_STORE], mode);
    let value;
    try { value = work(tx.objectStore(CACHE_STORE), tx.objectStore(CACHE_META_STORE)); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('cache transaction aborted'));
  });
}
function requestValue(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function trimMemory(limit, now = Date.now()) {
  for (const [key, record] of resultCache) if (record.createdAt + CACHE_TTL <= now) resultCache.delete(key);
  let total = [...resultCache.values()].reduce((sum, record) => sum + record.size, 0);
  for (const [key, record] of [...resultCache].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)) {
    if (total <= limit) break;
    resultCache.delete(key);
    total -= record.size;
  }
}
function trimMetadata(resultStore, metaStore, limit, now) {
  const request = metaStore.openCursor();
  const records = [];
  request.onsuccess = () => { const cursor = request.result; if (cursor) { records.push(cursor.value); cursor.continue(); } else {
    const active = records.filter(item => item.createdAt + CACHE_TTL > now).sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    let total = active.reduce((sum, item) => sum + item.size, 0);
    for (const item of records) if (item.createdAt + CACHE_TTL <= now) { metaStore.delete(item.key); resultStore.delete(item.key); }
    for (const item of active) { if (total <= limit) break; total -= item.size; metaStore.delete(item.key); resultStore.delete(item.key); }
  } };
}
async function getCached(key, limit, generation = cacheGeneration) {
  const now = Date.now();
  trimMemory(limit, now);
  const memory = resultCache.get(key);
  if (memory) {
    if (memory.createdAt + CACHE_TTL <= now) { resultCache.delete(key); }
    else { memory.lastUsedAt = now; await touchPersistent(key, now, limit, generation); if (generation !== cacheGeneration) return undefined; return { ...memory.result, _jevCacheExpiresAt: memory.createdAt + CACHE_TTL }; }
  }
  const db = await openCache();
  if (!db) return undefined;
  try {
    const record = await requestValue(db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(key));
    if (generation !== cacheGeneration) return undefined;
    if (!record) return undefined;
    if (record.createdAt + CACHE_TTL <= now) {
      await transaction(db, 'readwrite', store => store.delete(key));
      return undefined;
    }
    if (generation !== cacheGeneration) return undefined;
    await transactionStores(db, 'readwrite', (store, meta) => { store.put({ ...record, lastUsedAt: now }); meta.put({ key, createdAt: record.createdAt, lastUsedAt: now, size: record.size, postId: record.postId, provider: record.provider, model: record.model }); });
    resultCache.set(key, { result: record.result, createdAt: record.createdAt, lastUsedAt: now, size: record.size });
    return { ...record.result, _jevCacheExpiresAt: record.createdAt + CACHE_TTL };
  } catch { return undefined; }
}
async function findCompatibleCached(postId, config, questions, limit, generation = cacheGeneration) {
  const db = await openCache();
  try {
    const records = [...resultCache].map(([key, value]) => ({ key, result: value.result, createdAt: value.createdAt, lastUsedAt: value.lastUsedAt, size: value.size }));
    if (db) {
      const store = db.transaction(CACHE_STORE).objectStore(CACHE_STORE);
      const candidates = [];
      const index = store.index?.('lookup');
      const range = globalThis.IDBKeyRange?.only?.([postId, config.provider, config.model]);
      await new Promise((resolve, reject) => {
        const request = index?.openCursor(range) || store.openCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { resolve(); return; }
          const value = cursor.value;
          if (value?.key !== CACHE_META_KEY && value.postId === postId && value.provider === config.provider && value.model === config.model) candidates.push(value);
          cursor.continue();
        };
      });
      records.push(...candidates);
    }
    if (generation !== cacheGeneration) return undefined;
    const wanted = new Set(Object.keys(questions));
    const merged = {};
    let matched = false;
    let oldestCreatedAt = Infinity;
    for (const record of records) {
      let parsed;
      try { parsed = JSON.parse(record.key); } catch { continue; }
      if (parsed.postId !== postId || parsed.provider !== config.provider || parsed.model !== config.model) continue;
      if (record.createdAt + CACHE_TTL <= Date.now()) continue;
      const available = Object.keys(parsed.questions || {});
      const relevant = available.filter(id => wanted.has(id));
      if (!relevant.length) continue;
      if (!record.result?.answers) continue;
      for (const id of relevant) if (!Object.hasOwn(merged, id)) merged[id] = record.result.answers[id];
      oldestCreatedAt = Math.min(oldestCreatedAt, record.createdAt);
      matched = true;
    }
    if (!matched) return undefined;
    const missing = Object.keys(questions).filter(id => !Object.hasOwn(merged, id));
    if (!missing.length) {
      if (!validAnswers(merged, questions, config)) return undefined;
      const result = { answers: merged };
      const createdAt = await putCached(cacheKey(postId, config), result, limit, generation, oldestCreatedAt);
      return generation === cacheGeneration ? { ...result, _jevCacheExpiresAt: createdAt + CACHE_TTL } : undefined;
    }
    if (!Object.values(merged).every(answer => validAnswer(answer))) return undefined;
    return { answers: merged, _jevCachePartial: true, _jevMissing: missing, _jevCacheCreatedAt: oldestCreatedAt };
  } catch { return undefined; }
}
async function touchPersistent(key, now, limit, generation = cacheGeneration) {
  const db = await openCache();
  if (!db) return now;
  try {
    const record = await requestValue(db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(key));
    if (generation !== cacheGeneration) return;
    if (!record || record.createdAt + CACHE_TTL <= now) return;
    if (generation !== cacheGeneration) return;
    await transactionStores(db, 'readwrite', (store, meta) => { store.put({ ...record, lastUsedAt: now }); meta.put({ key, createdAt: record.createdAt, lastUsedAt: now, size: record.size, postId: record.postId, provider: record.provider, model: record.model }); });
  } catch { /* IndexedDBが利用できない環境ではメモリcacheを使う */ }
}
async function touchCache(postId) {
  if (!postId) return;
  const config = await getConfig();
  await touchPersistent(cacheKey(postId, config), Date.now(), config.decisionCacheLimitMb * 1024 * 1024);
}
async function putCached(key, result, limit, generation = cacheGeneration, createdAt = Date.now()) {
  if (generation !== cacheGeneration) return 0;
  const now = createdAt;
  const size = cacheSize(key, result, now, now);
  let identity = {};
  try {
    const parsed = JSON.parse(key);
    identity = { postId: parsed.postId, provider: parsed.provider, model: parsed.model };
  } catch { /* 不正なキーは検索用属性なしで保存 */ }
  const memory = { result, createdAt: now, lastUsedAt: now, size };
  resultCache.set(key, memory);
  trimMemory(limit, now);
  const db = await openCache();
  if (!db) return now;
  if (generation !== cacheGeneration) return 0;
  try {
    await transactionStores(db, 'readwrite', (store, meta) => {
      if (size <= limit) {
        store.put({ key, result, ...identity, createdAt: now, lastUsedAt: now, size });
        meta.put({ key, createdAt: now, lastUsedAt: now, size, ...identity });
      }
      trimMetadata(store, meta, limit, now);
    });
  } catch { /* IndexedDBが利用できない環境ではメモリcacheを使う */ }
  return now;
}
function cacheConfigSignature(config) {
  return JSON.stringify({ provider: config.provider, model: config.model, enabled: config.enabled, inputPricePerMillion: config.inputPricePerMillion, usageLimits: config.usageLimits, rules: questionRules(config).map(rule => [rule.id, rule.condition]) });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get-config') { initializeStorage().then(async () => { const config = await getConfig(); const management = isManagementSender(sender); sendResponse(await publicConfig(config, management && Boolean(await getApiKey(config.provider)))); }).catch(() => sendResponse({ error: true, reason: 'storage-error' })); return true; }
  if (message.type === 'set-api-key' || message.type === 'delete-api-key' || message.type === 'verify-api-key') {
    if (!isManagementSender(sender)) { sendResponse({ ok: false, reason: 'forbidden-sender' }); return false; }
  }
  if (message.type === 'save-config') {
    if (!isManagementSender(sender)) { sendResponse({ ok: false, reason: 'forbidden-sender' }); return false; }
    saveConfig(message.config).then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'storage-error' }));
    return true;
  }
  if (message.type === 'set-api-key') { setApiKey(message.provider, message.apiKey).then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'storage-error' })); return true; }
  if (message.type === 'delete-api-key') { deleteApiKey(message.provider).then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'storage-error' })); return true; }
  if (message.type === 'touch-cache') { touchCache(message.postId).then(() => sendResponse({ ok: true })); return true; }
  if (message.type === 'verify-api-key') {
    verifyApiKey(message.provider, message.apiKey).then(sendResponse).catch(error => sendResponse({ ok: false, reason: error.reason || 'network-error' }));
    return true;
  }
  if (message.type === 'get-usage') { getUsage().then(async usage => { await refreshActionIcon(); sendResponse(usage); }); return true; }
  if (message.type === 'get-cache-size') { getCacheSize().then(sendResponse).catch(() => sendResponse({ unavailable: true })); return true; }
  if (message.type === 'clear-cache') { clearDecisionCache().then(sendResponse).catch(() => sendResponse({ ok: false })); return true; }
  if (message.type === 'reset-usage') { resetUsage().then(sendResponse); return true; }
  if (message.type === 'reset-all-usage') { resetAllUsage().then(sendResponse); return true; }
  if (message.type !== 'classify') return;
  if (!isXSender(sender)) { sendResponse({ error: true, reason: 'forbidden-sender' }); return false; }
  classify(message.text, message.postId, message.priority, message.timing).then(result => { sendResponse(result); void scheduleActionIcon(); }).catch(async error => { actionError = true; await scheduleActionIcon(); sendResponse({ error: true, reason: error.reason || 'request-error', status: Number.isInteger(error.status) ? error.status : undefined }); });
  return true;
});
chrome.storage.onChanged?.addListener?.(changes => {
  if (changes.config || changes[KEY_STORAGE]) actionError = false;
  if (changes.config || changes[KEY_STORAGE] || changes.tokenUsage) void refreshActionIcon();
  if (changes.config) {
    const oldConfig = normalizeConfig(changes.config.oldValue);
    const newConfig = normalizeConfig(changes.config.newValue);
    if (cacheConfigSignature(oldConfig) !== cacheConfigSignature(newConfig)) {
      configGeneration++;
    }
    void enforceCacheLimit(newConfig.decisionCacheLimitMb * 1024 * 1024);
  }
});
async function enforceCacheLimit(limit) { const db = await openCache(); if (db) try { await transactionStores(db, 'readwrite', (store, meta) => trimMetadata(store, meta, limit, Date.now())); } catch {} }
async function getCacheSize() {
  const config = await getConfig();
  await enforceCacheLimit(config.decisionCacheLimitMb * 1024 * 1024);
  const db = await openCache();
  if (!db) return { unavailable: true };
  try {
    const metadata = await requestValue(db.transaction(CACHE_META_STORE).objectStore(CACHE_META_STORE).getAll());
    if (metadata?.length) return { bytes: metadata.reduce((sum, item) => sum + (Number(item.size) || 0), 0) };
  } catch {}
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const request = tx.objectStore(CACHE_STORE).openCursor();
    let bytes = 0;
    request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve({ bytes }); return; } bytes += Number(cursor.value?.size) || 0; cursor.continue(); };
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('cache transaction aborted'));
  });
}
async function clearDecisionCache() {
  cacheGeneration++;
  cacheToken = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  resultCache.clear();
  inFlight.clear();
  const db = await openCache();
  if (!db) return { ok: false, unavailable: true };
  await transactionStores(db, 'readwrite', (store, meta) => { store.clear(); meta.clear(); });
  await chrome.storage.local.set({ cacheGeneration: cacheToken });
  return { ok: true };
}

async function verifyApiKey(provider, apiKey) {
  if (provider !== 'typesafe') return verifyApiKeyUnqueued(provider, apiKey);
  await new Promise(resolve => setTimeout(resolve, 0));
  if (inFlight.size) await Promise.all([...inFlight.values()].map(task => task.catch(() => undefined)));
  return enqueueApi(() => verifyApiKeyUnqueued(provider, apiKey), 0);
}

async function verifyApiKeyUnqueued(provider, apiKey) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) return { ok: false, reason: 'missing-key' };
  if (!verifyEndpoints[provider]) return { ok: false, reason: 'unsupported-provider' };
  if (provider === 'typesafe') {
    const budget = await getBudgetStatus(await getConfig());
    if (budget) return { ok: false, reason: budget };
  }
  let response;
  try {
    const options = { headers: { Authorization: `Bearer ${key}` } };
    if (provider === 'typesafe') {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify({ model: 'jev-latest', state: 'APIキー接続確認', questions: { connection: { type: 'noul', instructions: 'この接続確認に応答できるか？' } } });
    }
    options.signal = AbortSignal.timeout(10000);
    response = await fetch(verifyEndpoints[provider], options);
  }
  catch { return { ok: false, reason: 'network-error' }; }
  if (response.status === 401) return { ok: false, reason: 'unauthorized' };
  if (response.status === 403) return { ok: false, reason: 'forbidden' };
  if (!response.ok) return { ok: false, reason: 'http-error', status: response.status };
  let usage;
  try { usage = await response.json(); } catch { usage = null; }
  if (provider === 'typesafe') await recordUsage(usage?.usage);
  const normalized = normalizeUsage(usage?.usage);
  return normalized.inputTokens === null ? { ok: true } : { ok: true, usage: normalized };
}

async function setApiKey(provider, apiKey) {
  await initializeStorage();
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key || !verifyEndpoints[provider]) return { ok: false, reason: 'missing-key' };
  const current = (await chrome.storage.local.get(KEY_STORAGE))[KEY_STORAGE] || {};
  await chrome.storage.local.set({ [KEY_STORAGE]: { ...current, [provider]: key } });
  keyGeneration++;
  await notifyConfig();
  return { ok: true, persisted: true };
}
async function deleteApiKey(provider) {
  await initializeStorage();
  const keys = (await chrome.storage.local.get(KEY_STORAGE))[KEY_STORAGE] || {};
  delete keys[provider];
  await chrome.storage.local.set({ [KEY_STORAGE]: keys });
  keyGeneration++;
  await notifyConfig();
  return { ok: true };
}

async function classify(text, postId, priority = 1, requestTiming) {
  const startedAt = performance.now();
  const config = await getConfig();
  if (!config.enabled) return { unknown: true, reason: 'disabled' };
  const requestedKeyGeneration = keyGeneration;
  const requestedConfigGeneration = configGeneration;
  const generation = cacheGeneration;
  const apiKey = await getApiKey(config.provider);
  if (!apiKey) return { unknown: true, reason: 'missing-key' };
  if (requestedKeyGeneration !== keyGeneration || requestedConfigGeneration !== configGeneration || generation !== cacheGeneration) return { unknown: true, reason: 'stale-request' };
  const questions = Object.fromEntries(questionRules(config).map(rule => [rule.id, { type: 'noul', instructions: `この投稿は、次の条件に該当しますか？\n条件：${rule.condition}` }]));
  const key = postId ? cacheKey(postId, config) : null;
  const requestGeneration = `${generation}:${requestedKeyGeneration}:${requestedConfigGeneration}`;
  if (key && inFlightGenerations.get(key) === requestGeneration && inFlight.has(key)) return inFlight.get(key);
  let resolveTask;
  let rejectTask;
  const task = new Promise((resolve, reject) => { resolveTask = resolve; rejectTask = reject; });
  if (key) { inFlight.set(key, task); inFlightGenerations.set(key, requestGeneration); }
  (async () => {
    const cached = key && await getCached(key, config.decisionCacheLimitMb * 1024 * 1024, generation);
    if (cached) return generation === cacheGeneration ? cached : { unknown: true, reason: 'cache-cleared' };
    const compatible = postId && await findCompatibleCached(postId, config, questions, config.decisionCacheLimitMb * 1024 * 1024, generation);
    if (compatible && !compatible._jevCachePartial) return compatible;
    const requestQuestions = compatible?._jevCachePartial ? Object.fromEntries(compatible._jevMissing.map(id => [id, questions[id]])) : questions;
    const request = enqueueApi(() => classifyUncached(text, config, requestQuestions, requestedKeyGeneration, generation, requestedConfigGeneration, apiKey, startedAt), priority);
    const result = await request;
    if (compatible?._jevCachePartial && result?.answers) result.answers = { ...compatible.answers, ...result.answers };
    if (generation !== cacheGeneration) return { unknown: true, reason: 'cache-cleared' };
    const createdAt = result?.answers && validAnswers(result.answers, questions, config) ? (compatible?._jevCacheCreatedAt || Date.now()) : 0;
    if (createdAt && key) void putCached(key, result, config.decisionCacheLimitMb * 1024 * 1024, generation, createdAt).catch(() => undefined);
    if (generation !== cacheGeneration) return { unknown: true, reason: 'cache-cleared' };
    if (globalThis.JEV_DEV_TIMING) console.debug('[jev timing]', { totalMs: Math.round(performance.now() - startedAt), cachePersistScheduled: Boolean(createdAt) });
    const response = result?.answers ? { ...result, _jevCacheExpiresAt: createdAt + CACHE_TTL } : result;
    if (globalThis.JEV_DEV_TIMING && requestTiming && response && typeof response === 'object') response._jevTiming = { ...requestTiming, backgroundMs: Math.round(performance.now() - startedAt) };
    return response;
  })().then(resolveTask, rejectTask);
  task.then(result => {
    if (key && inFlight.get(key) === task) { inFlight.delete(key); inFlightGenerations.delete(key); }
    if (!result?.answers) return;
  }, () => { if (key && inFlight.get(key) === task) { inFlight.delete(key); inFlightGenerations.delete(key); } });
  return task;
}

async function classifyUncached(text, config, questions, requestedKeyGeneration = keyGeneration, requestedCacheGeneration = cacheGeneration, requestedConfigGeneration = configGeneration, requestedApiKey, startedAt = performance.now()) {
  if (!config.enabled) return { unknown: true, reason: 'disabled' };
  const apiKey = requestedApiKey || await getApiKey(config.provider);
  if (!apiKey) return { unknown: true, reason: 'missing-key' };
  if (requestedKeyGeneration !== keyGeneration) return { unknown: true, reason: 'missing-key' };
  if (requestedCacheGeneration !== cacheGeneration || requestedConfigGeneration !== configGeneration) return { unknown: true, reason: 'stale-request' };
  const budget = await getBudgetStatus(config);
  if (budget) return { unknown: true, reason: budget };
  if (requestedKeyGeneration !== keyGeneration) return { unknown: true, reason: 'missing-key' };
  if (!Object.keys(questions).length) return { unknown: true, reason: 'no-active-rule' };
  const body = config.provider === 'openrouter'
    ? { model: config.model || OPENROUTER_DEFAULT_MODEL, state: { description: 'An X post to classify.', records: [{ id: 'post', record: text }] }, questions: Object.fromEntries(Object.entries(questions).map(([id, question]) => [`post__${id}`, { ...question, instructions: `For the record with id "post": ${question.instructions}` }])) }
    : { state: text, model: config.model, questions };
  if (requestedKeyGeneration !== keyGeneration || requestedCacheGeneration !== cacheGeneration || requestedConfigGeneration !== configGeneration) return { unknown: true, reason: 'stale-request' };
  const requestStartedAt = performance.now();
  const response = await fetch(endpoints[config.provider], { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Object.assign(new Error('API request failed'), { reason: 'http-error', status: response.status });
    const result = await response.json();
    const answers = config.provider === 'openrouter'
      ? Object.fromEntries(Object.entries(result?.answers || {}).filter(([id]) => id.startsWith('post__')).map(([id, answer]) => [id.slice('post__'.length), answer]))
      : result?.answers;
    if (globalThis.JEV_DEV_TIMING) console.debug('[jev timing]', { preApiMs: Math.round(requestStartedAt - startedAt), apiMs: Math.round(performance.now() - requestStartedAt) });
    if (!result || typeof result !== 'object' || !result.answers || typeof result.answers !== 'object' || !validAnswers(answers, questions)) throw Object.assign(new Error('Invalid API response'), { reason: 'invalid-response' });
    await recordUsage(result.usage);
    actionError = false;
    return config.provider === 'openrouter' ? { ...result, answers } : result;
}

function validAnswers(answers, questions) { return Object.keys(questions || {}).every(id => validAnswer(answers?.[id])); }

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return { inputTokens: null };
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const input = usage.input_tokens;
  return { inputTokens: valid(input) ? input : null };
}
const USAGE_PERIODS = { '5h': 5 * 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 };
function configuredLimits(config) {
  const limits = config.usageLimits && typeof config.usageLimits === 'object' ? config.usageLimits : {};
  return Object.fromEntries(Object.keys(USAGE_PERIODS).map(period => {
  const raw = limits[period];
    return [period, Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : null];
  }));
}
function periodState(stored, period, now = Date.now()) {
  const item = stored.periods?.[period] || {};
  const started = Number.isFinite(item.startedAt) ? item.startedAt : null;
  if (started === null) return { startedAt: null, inputTokens: 0, unreportedRequests: 0 };
  const duration = USAGE_PERIODS[period];
  const currentStart = started + Math.floor(Math.max(0, now - started) / duration) * duration;
  const active = currentStart === started;
  return { startedAt: currentStart, inputTokens: active && Number.isFinite(item.inputTokens) ? item.inputTokens : 0, unreportedRequests: active && Number.isFinite(item.unreportedRequests) ? item.unreportedRequests : 0 };
}
async function getUsage() {
  const stored = (await chrome.storage.local.get('tokenUsage')).tokenUsage || {};
  const inputTokens = Number.isFinite(stored.inputTokens) && stored.inputTokens >= 0 ? stored.inputTokens : 0;
  const unreportedRequests = Number.isFinite(stored.unreportedRequests) && stored.unreportedRequests >= 0 ? stored.unreportedRequests : 0;
  const periods = Object.fromEntries(Object.keys(USAGE_PERIODS).map(period => [period, periodState(stored, period)]));
  return { inputTokens, unreportedRequests, periods };
}
function recordUsage(raw) {
  usageQueue = usageQueue.then(async () => {
    const current = await getUsage();
    const next = normalizeUsage(raw);
    const stored = (await chrome.storage.local.get('tokenUsage')).tokenUsage || {};
    const merged = { inputTokens: current.inputTokens, unreportedRequests: current.unreportedRequests, periods: structuredClone(stored.periods || {}) };
    for (const [period, duration] of Object.entries(USAGE_PERIODS)) {
      const item = periodState(stored, period);
      merged.periods[period] = { startedAt: item.startedAt || Date.now(), inputTokens: item.inputTokens, unreportedRequests: item.unreportedRequests };
      if (Number.isFinite(next.inputTokens)) merged.periods[period].inputTokens += next.inputTokens;
      else merged.periods[period].unreportedRequests++;
    }
    if (Number.isFinite(next.inputTokens)) merged.inputTokens += next.inputTokens;
    else merged.unreportedRequests++;
    await chrome.storage.local.set({ tokenUsage: merged });
  });
  return usageQueue;
}
async function getBudgetStatus(config) {
  const limits = configuredLimits(config);
  if (!Object.values(limits).some(Boolean)) return null;
  if (config.inputPricePerMillion === null) return 'cost-unavailable';
  const usage = await getUsage();
  for (const [period, limit] of Object.entries(limits)) {
    if (!limit) continue;
    const item = usage.periods[period];
    if (item.unreportedRequests > 0) return 'cost-unknown';
    if (item.inputTokens / 1e6 * config.inputPricePerMillion >= limit) return 'daily-cost-limit';
  }
  return null;
}
function resetUsage() {
  usageQueue = usageQueue.then(async () => {
    const current = await getUsage();
    await chrome.storage.local.set({ tokenUsage: { inputTokens: current.inputTokens, unreportedRequests: current.unreportedRequests, periods: Object.fromEntries(Object.keys(USAGE_PERIODS).map(period => [period, { startedAt: Date.now(), inputTokens: 0, unreportedRequests: 0 }])) } });
  });
  return usageQueue.then(async () => { await notifyConfig(); return { ...(await getUsage()), ok: true }; });
}
function resetAllUsage() {
  usageQueue = usageQueue.then(async () => {
    const startedAt = Date.now();
    await chrome.storage.local.set({ tokenUsage: { inputTokens: 0, unreportedRequests: 0, periods: Object.fromEntries(Object.keys(USAGE_PERIODS).map(period => [period, { startedAt, inputTokens: 0, unreportedRequests: 0 }])) } });
  });
  return usageQueue.then(async () => { await notifyConfig(); return { ...(await getUsage()), ok: true }; });
}

void refreshActionIcon();
