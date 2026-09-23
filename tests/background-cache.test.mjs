import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { DEFAULT_CONFIG, hashCondition } from '../src/core/config.js';

const DB_NAME = 'jev-decision-cache';
const openDb = indexedDB => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 4);
  request.onupgradeneeded = () => {
    const db = request.result;
    const results = db.createObjectStore('results', { keyPath: 'key' });
    results.createIndex('lastUsedAt', 'lastUsedAt');
    results.createIndex('lookup', ['postId', 'provider', 'model']);
    db.createObjectStore('metadata', { keyPath: 'key' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function createDb(seed = {}) {
  const indexed = new IDBFactory();
  if (!seed.records?.length && !seed.metadata?.length) return indexed;
  const db = await openDb(indexed);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['results', 'metadata'], 'readwrite');
    for (const value of seed.records || []) tx.objectStore('results').put(value);
    for (const value of seed.metadata || []) tx.objectStore('metadata').put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return indexed;
}
async function createLegacyDb() {
  const indexed = new IDBFactory();
  await new Promise((resolve, reject) => {
    const request = indexed.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      const results = request.result.createObjectStore('results', { keyPath: 'key' });
      results.createIndex('lastUsedAt', 'lastUsedAt');
      results.createIndex('lookup', ['text', 'provider', 'model']);
      request.result.createObjectStore('metadata', { keyPath: 'key' });
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
  const db = await new Promise((resolve, reject) => { const request = indexed.open(DB_NAME); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['results', 'metadata'], 'readwrite');
    tx.objectStore('results').put({ key: '{"text":"旧本文"}', text: '旧本文', result: { answers: {} }, createdAt: 1, lastUsedAt: 1, size: 100 });
    tx.objectStore('metadata').put({ key: '{"text":"旧本文"}', text: '旧本文', createdAt: 1, lastUsedAt: 1, size: 100 });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return indexed;
}
async function readStore(indexed, name) {
  const db = await openDb(indexed);
  const values = await new Promise((resolve, reject) => {
    const request = db.transaction(name).objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return values;
}
async function load({ config, db, fetchResult }) {
  let listener;
  let changed;
  let currentConfig = config;
  const key = config.apiKey || '';
  globalThis.chrome = { runtime: { onMessage: { addListener: callback => { listener = callback; } } }, storage: { onChanged: { addListener: callback => { changed = callback; } }, local: { get: async requested => requested === 'config' ? ({ config: currentConfig }) : ({ jevApiKeys: key ? { [currentConfig.provider]: key } : {} }), set: async () => {} } } };
  globalThis.indexedDB = db;
  globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => {
    return fetchResult(options);
  } });
  await import(`../src/background.js?cache-test=${Date.now()}-${Math.random()}`);
  const call = (text = '同じ本文', priority, postId) => new Promise(resolve => listener({ type: 'classify', text, postId: postId === undefined ? text : postId, priority }, { url: 'https://x.com/home' }, resolve));
  const cacheSize = () => new Promise(resolve => listener({ type: 'get-cache-size' }, {}, resolve));
  const clearCache = () => new Promise(resolve => listener({ type: 'clear-cache' }, {}, resolve));
  return { call, cacheSize, clearCache, changed: (value, oldValue = currentConfig) => { currentConfig = value; changed({ config: { oldValue, newValue: value } }); } };
}

test('判定cacheの現在容量はrecord.sizeを合算し、DB失敗は利用不可で返す', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB };
  try {
    const db = await createDb({ records: [{ key: 'a', size: 120 }, { key: 'b', size: 80 }] });
    const h = await load({ db, config: { ...DEFAULT_CONFIG }, fetchResult: () => ({ answers: {} }) });
    assert.deepEqual(await h.cacheSize(), { bytes: 200 });
    const unavailable = await load({ db: undefined, config: { ...DEFAULT_CONFIG }, fetchResult: () => ({ answers: {} }) });
    assert.deepEqual(await unavailable.cacheSize(), { unavailable: true });
    assert.deepEqual(await unavailable.clearCache(), { ok: false, unavailable: true });
  } finally { Object.entries(old).forEach(([key, value]) => { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }); }
});

test('判定cacheのクリア後は容量0になり、次の判定を再取得する', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB };
  const db = await createDb();
  let fetchCount = 0;
  const config = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', blackRules: [{ ...DEFAULT_CONFIG.blackRules[0], enabled: true }] };
  try {
    const h = await load({ db, config, fetchResult: () => { fetchCount++; return { answers: { [hashCondition(config.blackRules[0].condition)]: { noul: 0 } } }; } });
    await h.call('本文');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal((await readStore(db, 'results')).length, 1);
    assert.equal(fetchCount, 1);
    assert.deepEqual(await h.clearCache(), { ok: true });
    assert.deepEqual(await h.cacheSize(), { bytes: 0 });
    await h.call('本文');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fetchCount, 2);
  } finally { Object.entries(old).forEach(([key, value]) => { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }); }
});

test('閾値変更後とIndexedDB再open後もcacheを再利用し、参照でTTLを延長しない', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB, now: Date.now };
  const db = await createDb();
  const rule = { ...DEFAULT_CONFIG.blackRules.at(-1), enabled: true };
  let fetchCount = 0;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const first = await load({ db, config: { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', blackRules: [rule] }, fetchResult: () => { fetchCount++; return { answers: { [hashCondition(rule.condition)]: { noul: 0 } } }; } });
    await first.call();
    await new Promise(resolve => setTimeout(resolve, 0));
    first.changed({ ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', blackRules: [{ ...rule, threshold: 0.5 }] });
    await first.call();
    assert.equal(fetchCount, 1);
    now += 29 * 24 * 60 * 60 * 1000;
    const second = await load({ db, config: { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', blackRules: [rule] }, fetchResult: () => { fetchCount++; return { answers: { [hashCondition(rule.condition)]: { noul: 0 } } }; } });
    await second.call();
    assert.equal(fetchCount, 1);
    now += 2 * 24 * 60 * 60 * 1000;
    const third = await load({ db, config: { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', blackRules: [rule] }, fetchResult: () => { fetchCount++; return { answers: { [hashCondition(rule.condition)]: { noul: 0 } } }; } });
    await third.call();
    assert.equal(fetchCount, 2);
  } finally {
    Date.now = old.now;
    if (old.chrome === undefined) delete globalThis.chrome; else globalThis.chrome = old.chrome;
    if (old.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = old.fetch;
    if (old.indexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = old.indexedDB;
  }
});

test('永続cacheの条件追加は既存条件を再送せず、不足条件だけ取得する', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB, now: Date.now };
  const db = await createDb();
  let now = 1_000_000;
  Date.now = () => now;
  const ruleA = { ...DEFAULT_CONFIG.blackRules[0], id: hashCondition('既存条件'), condition: '既存条件', enabled: true };
  const ruleB = { ...DEFAULT_CONFIG.blackRules[1], id: hashCondition('追加条件'), condition: '追加条件', enabled: true };
  const firstConfig = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', blackRules: [ruleA], whiteRules: [] };
  const requests = [];
  try {
    const h = await load({ db, config: firstConfig, fetchResult: options => {
      const body = JSON.parse(options.body);
      requests.push(Object.keys(body.questions));
      return { answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, { noul: 0 }])) };
    } });
    await h.call('本文');
    await new Promise(resolve => setTimeout(resolve, 0));
    now += 1000;
    h.changed({ ...firstConfig, blackRules: [ruleA, ruleB] });
    await h.call('本文');
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], [ruleA.id]);
    assert.deepEqual(requests[1], [ruleB.id]);
    now += 30 * 24 * 60 * 60 * 1000;
    await h.call('本文');
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[2], [ruleA.id, ruleB.id]);
  } finally { Date.now = old.now; Object.entries(old).filter(([key]) => key !== 'now').forEach(([key, value]) => { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }); }
});

test('本文を含む旧形式cacheは移行時に削除する', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB };
  const db = await createLegacyDb();
  try {
    const h = await load({ db, config: { ...DEFAULT_CONFIG }, fetchResult: () => ({ answers: {} }) });
    assert.deepEqual(await h.cacheSize(), { bytes: 0 });
    for (const store of ['results', 'metadata']) {
      assert.equal(JSON.stringify(await readStore(db, store)).includes('旧本文'), false);
    }
  } finally { Object.entries(old).forEach(([key, value]) => { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }); }
});

test('本文を保存せず、投稿IDがない要求は再利用しない', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB };
  const db = await createDb();
  const rule = { ...DEFAULT_CONFIG.blackRules[0], enabled: true };
  let fetchCount = 0;
  try {
    const h = await load({ db, config: { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', blackRules: [rule] }, fetchResult: () => { fetchCount++; return { answers: { [hashCondition(rule.condition)]: { noul: 0 } } }; } });
    await h.call('秘匿する本文', undefined, 'post-1');
    await new Promise(resolve => setTimeout(resolve, 0));
    const [record] = await readStore(db, 'results');
    assert.equal(JSON.stringify(record).includes('秘匿する本文'), false);
    await h.call('同じ本文', undefined, null);
    await h.call('同じ本文', undefined, null);
    assert.equal(fetchCount, 3);
  } finally { Object.entries(old).forEach(([key, value]) => { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }); }
});

test('条件削除後は互換cacheの完全回答を再送せず利用する', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB };
  const db = await createDb();
  const ruleA = { ...DEFAULT_CONFIG.blackRules[0], id: hashCondition('条件A'), condition: '条件A', enabled: true };
  const ruleB = { ...DEFAULT_CONFIG.blackRules[1], id: hashCondition('条件B'), condition: '条件B', enabled: true };
  const both = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', blackRules: [ruleA, ruleB], whiteRules: [] };
  const onlyA = { ...both, blackRules: [ruleA] };
  let fetchCount = 0;
  try {
    const h = await load({ db, config: both, fetchResult: options => {
      fetchCount++;
      const body = JSON.parse(options.body);
      return { answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, { noul: 0 }])) };
    } });
    await h.call('本文');
    await new Promise(resolve => setTimeout(resolve, 0));
    h.changed(onlyA, both);
    const result = await h.call('本文');
    assert.equal(fetchCount, 1);
    assert.deepEqual(Object.keys(result.answers), [ruleA.id]);
  } finally { Object.entries(old).forEach(([key, value]) => { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }); }
});

test('容量縮小時に永続cacheをtrimし、期限切れをLRUより先に削除する', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB, now: Date.now };
  const db = await createDb();
  const rule = { ...DEFAULT_CONFIG.blackRules.at(-1), enabled: true };
  let now = 2_000_000;
  Date.now = () => now;
  try {
    const config = { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', decisionCacheLimitMb: 100, blackRules: [rule] };
    const h = await load({ db, config, fetchResult: () => ({ answers: { [hashCondition(rule.condition)]: { noul: 0 } } }) });
    await h.call();
    await new Promise(resolve => setTimeout(resolve, 0));
    const record = (await readStore(db, 'results'))[0];
    const key = record.key;
    const expired = { ...record, key: 'expired', createdAt: now - 31 * 24 * 60 * 60 * 1000, lastUsedAt: now - 1 };
    const seeded = await openDb(db);
    await new Promise((resolve, reject) => {
      const tx = seeded.transaction(['results', 'metadata'], 'readwrite');
      const oldActive = { ...record, key: 'old-active', size: 700_000, createdAt: now, lastUsedAt: now - 2 };
      const newActive = { ...record, key: 'new-active', size: 700_000, createdAt: now, lastUsedAt: now - 1 };
      tx.objectStore('results').put(expired); tx.objectStore('results').put(oldActive); tx.objectStore('results').put(newActive);
      tx.objectStore('metadata').put({ key: 'expired', size: record.size, createdAt: expired.createdAt, lastUsedAt: expired.lastUsedAt });
      tx.objectStore('metadata').put({ key: 'old-active', size: oldActive.size, createdAt: now, lastUsedAt: oldActive.lastUsedAt });
      tx.objectStore('metadata').put({ key: 'new-active', size: newActive.size, createdAt: now, lastUsedAt: newActive.lastUsedAt });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    seeded.close();
    config.decisionCacheLimitMb = 1;
    h.changed(config);
    await new Promise(resolve => setTimeout(resolve, 0));
    const remaining = await readStore(db, 'results');
    assert.equal(remaining.some(item => item.key === 'expired'), false);
    assert.equal(remaining.some(item => item.key === 'old-active'), false);
    assert.equal(remaining.some(item => item.key === 'new-active'), true);
    assert.equal(remaining.some(item => item.key === key), true);
  } finally {
    Date.now = old.now;
    if (old.chrome === undefined) delete globalThis.chrome; else globalThis.chrome = old.chrome;
    if (old.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = old.fetch;
    if (old.indexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = old.indexedDB;
  }
});

test('API実行枠は最大2件で3件目は枠が空くまで待機する', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB };
  const db = undefined;
  const rule = { ...DEFAULT_CONFIG.blackRules.at(-1), enabled: true };
  let releaseA;
  let releaseB;
  let releaseP;
  let releaseQ;
  let active = 0;
  let maxActive = 0;
  const calls = [];
  try {
    const h = await load({ db, config: { ...DEFAULT_CONFIG, enabled: true, apiKey: 'key', blackRules: [rule] }, fetchResult: () => ({ answers: { [hashCondition(rule.condition)]: { noul: 0 } } }) });
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body.state); active++; maxActive = Math.max(maxActive, active);
      if (body.state === 'A') await new Promise(resolve => { releaseA = resolve; });
      if (body.state === 'B') await new Promise(resolve => { releaseB = resolve; });
      if (body.state === 'P') await new Promise(resolve => { releaseP = resolve; });
      if (body.state === 'Q') await new Promise(resolve => { releaseQ = resolve; });
      active--;
      return { ok: true, json: async () => ({ answers: { [hashCondition(rule.condition)]: { noul: 0 } } }) };
    };
    const a = h.call('A');
    const b = h.call('B');
    const c = h.call('C');
    for (let attempt = 0; attempt < 20 && (!releaseA || !releaseB); attempt++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(typeof releaseA, 'function');
    assert.equal(typeof releaseB, 'function');
    assert.equal(maxActive, 2);
    assert.deepEqual(calls, ['A', 'B']);
    releaseA();
    releaseB();
    await Promise.all([a, b, c]);
    assert.deepEqual(calls, ['A', 'B', 'C']);

    const p = h.call('P', 1);
    const q = h.call('Q', 1);
    for (let attempt = 0; attempt < 20 && (!releaseP || !releaseQ); attempt++) await new Promise(resolve => setTimeout(resolve, 1));
    const low = h.call('低優先', 2);
    const high = h.call('高優先', 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.slice(3), ['P', 'Q']);
    releaseP();
    releaseQ();
    await Promise.all([p, q, low, high]);
    assert.deepEqual(calls.slice(3), ['P', 'Q', '高優先', '低優先']);
  } finally {
    if (old.chrome === undefined) delete globalThis.chrome; else globalThis.chrome = old.chrome;
    if (old.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = old.fetch;
    if (old.indexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = old.indexedDB;
  }
});
