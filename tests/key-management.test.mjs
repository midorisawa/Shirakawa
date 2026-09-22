import test from 'node:test';
import assert from 'node:assert/strict';

function storageArea(initial = {}) { const data = { ...initial }; return { get: async key => key ? { [key]: data[key] } : { ...data }, set: async values => Object.assign(data, values), remove: async key => { delete data[key]; }, setAccessLevel: async () => {}, data }; }

test('sender未認証の管理操作を拒否する', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch }; let listener;
  const local = storageArea({ jevApiKeys: { typesafe: 'secret' }, config: { enabled: true } });
  globalThis.chrome = { runtime: { id: 'test-id', onMessage: { addListener: callback => { listener = callback; } }, sendMessage: async () => {} }, storage: { local } };
  try { await import(`../src/background.js?key-management=${Date.now()}`); const result = await new Promise(resolve => listener({ type: 'delete-api-key', provider: 'typesafe' }, { url: 'https://x.com/home' }, resolve)); assert.deepEqual(result, { ok: false, reason: 'forbidden-sender' }); assert.equal(local.data.jevApiKeys.typesafe, 'secret'); }
  finally { if (old.chrome === undefined) delete globalThis.chrome; else globalThis.chrome = old.chrome; if (old.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = old.fetch; }
});

test('キー切替の保存失敗時は既存キーを消去しない', async () => {
  const old = globalThis.chrome; let listener; const local = storageArea({ jevApiKeys: { typesafe: 'old-secret' }, config: { enabled: true } }); const originalSet = local.set;
  local.set = async values => { if (values.jevApiKeys?.typesafe === 'new-secret') throw new Error('disk full'); return originalSet(values); };
  globalThis.chrome = { runtime: { id: 'test-id', onMessage: { addListener: callback => { listener = callback; } }, sendMessage: async () => {} }, storage: { local } };
  try { await import(`../src/background.js?key-switch=${Date.now()}`); const result = await new Promise(resolve => listener({ type: 'set-api-key', provider: 'typesafe', apiKey: 'new-secret', persist: true }, { url: 'chrome-extension://test-id/options/index.html' }, resolve)); assert.deepEqual(result, { ok: false, reason: 'storage-error' }); assert.equal(local.data.jevApiKeys.typesafe, 'old-secret'); }
  finally { if (old === undefined) delete globalThis.chrome; else globalThis.chrome = old; }
});
