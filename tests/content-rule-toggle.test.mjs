import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DEFAULT_CONFIG, hashCondition } from '../src/core/config.js';

function setup(config, response, getConfigResponse = config, html = '<main><div data-testid="primaryColumn"><article role="article" data-testid="tweet" data-post-id="toggle"><div data-testid="tweetText">判定対象</div></article></div></main>') {
  const original = { document: globalThis.document, location: globalThis.location, MutationObserver: globalThis.MutationObserver, chrome: globalThis.chrome };
  const dom = new JSDOM(html, { url: 'https://x.com/home', runScripts: 'dangerously' });
  let changed;
  let configUpdated;
  let sends = 0;
  const messages = [];
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.chrome = {
    storage: { local: { get: async () => ({ config }) }, onChanged: { addListener: callback => { changed = callback; } } },
    runtime: { onMessage: { addListener: callback => { configUpdated = callback; } }, sendMessage: async message => { if (message.type === 'get-config') return getConfigResponse; messages.push(message); sends++; return typeof response === 'function' ? response(sends) : response; } }
  };
  return { dom, messages, changed: value => configUpdated({ type: 'config-updated', config: value }), clearCache: () => changed({ cacheGeneration: { newValue: Date.now() } }), sends: () => sends, article: () => dom.window.document.querySelector('article'), restore: () => { dom.window.close(); Object.entries(original).forEach(([key, value]) => { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }); } };
}

const base = { ...DEFAULT_CONFIG, enabled: true, pending: 'hide', unknown: 'hide' };

test('viewport内の投稿を画面外の投稿より先に送信する', async () => {
  const rules = [{ condition: '条件', threshold: 0.8, enabled: true }];
  const html = '<main><div data-testid="primaryColumn">'
    + '<article role="article" data-testid="tweet" data-post-id="far"><div data-testid="tweetText">画面外</div></article>'
    + '<article role="article" data-testid="tweet" data-post-id="near"><div data-testid="tweetText">画面内</div></article>'
    + '</div></main>';
  const h = setup({ ...base, blackRules: rules }, { answers: { [hashCondition('条件')]: { noul: 0 } } }, undefined, html);
  h.dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.dataset.postId === 'near' ? { top: 10, bottom: 100 } : { top: 2000, bottom: 2100 };
  };
  try {
    await import(`../src/content.js?viewport-priority=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(h.messages.map(message => message.text), ['画面内', '画面外']);
    assert.deepEqual(h.messages.map(message => message.priority), [0, 2]);
  } finally { h.restore(); }
});

test('条件の有効切替と閾値変更は回答を再利用し通信しない', async () => {
  const rules = [{ condition: '一つ目', threshold: 0.8, enabled: true }, { condition: '二つ目', threshold: 0.8, enabled: true }];
  const h = setup(DEFAULT_CONFIG, { answers: { [hashCondition('再読み込み後の条件')]: { noul: 0.9 } } }, { ...base, blackRules: [{ condition: '再読み込み後の条件', threshold: 0.8, enabled: true }], keyConfigured: true });
  try {
    await import(`../src/content.js?rule-toggle=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.sends(), 1);
    assert.equal(h.article().dataset.jevState, 'matched');
    h.restore();

    const ruleH = setup({ ...base, blackRules: rules }, { answers: { [hashCondition('一つ目')]: { noul: 0.9 }, [hashCondition('二つ目')]: { noul: 0.7 } } });
    await import(`../src/content.js?rule-toggle-details=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ruleH.sends(), 1);
    assert.equal(ruleH.article().dataset.jevState, 'matched');
    ruleH.changed({ ...base, blackRules: [{ ...rules[0], enabled: false }, rules[1]] });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ruleH.article().dataset.jevState, 'no-match');
    ruleH.changed({ ...base, blackRules: [{ ...rules[0], enabled: false }, { ...rules[1], threshold: 0.5 }] });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ruleH.article().dataset.jevState, 'matched');
    assert.equal(ruleH.sends(), 1);
    ruleH.restore();

    const whiteRules = [{ condition: '建設的な投稿', threshold: 0.8, enabled: true, allowWhenBlacklisted: true }];
    const whiteH = setup({ ...base, blackRules: [{ condition: '攻撃的な投稿', threshold: 0.8, enabled: true }], whiteRules }, { answers: { [hashCondition('攻撃的な投稿')]: { noul: 0.9 }, [hashCondition('建設的な投稿')]: { noul: 0.9 } } });
    await import(`../src/content.js?white-priority=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(whiteH.sends(), 1);
    assert.equal(whiteH.article().dataset.jevState, 'matched');
    whiteH.changed({ ...base, blackRules: [{ condition: '攻撃的な投稿', threshold: 0.8, enabled: false }], whiteRules });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(whiteH.article().dataset.jevState, 'no-match');
    assert.equal(whiteH.sends(), 1);
    whiteH.restore();

    const mismatchH = setup({ ...base, blackRules: [{ condition: '攻撃的な投稿', threshold: 0.8, enabled: true }], whiteRules: [{ condition: '建設的な投稿', threshold: 0.8, enabled: true }] }, { answers: { [hashCondition('攻撃的な投稿')]: { noul: 0.1 }, [hashCondition('建設的な投稿')]: { noul: 0.2 } } });
    await import(`../src/content.js?white-mismatch=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(mismatchH.article().querySelector('.jev-placeholder').textContent, /表示条件「建設的な投稿」0\.20/);
    mismatchH.restore();
  } finally { h.restore(); }
});

test('判定cacheクリアは表示中の投稿を即再送せず次の投稿で再取得する', async () => {
  const rules = [{ condition: '一つ目', threshold: 0.8, enabled: true }];
  const h = setup({ ...base, blackRules: rules }, { answers: { [hashCondition('一つ目')]: { noul: 0.9 } } });
  try {
    await import(`../src/content.js?cache-generation=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.sends(), 1);
    h.clearCache();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.sends(), 1);
    const fresh = h.article().cloneNode(true);
    fresh.dataset.postId = 'new-post';
    h.article().replaceWith(fresh);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.sends(), 2);
  } finally { h.restore(); }
});

test('判定中のcacheクリア後は旧応答を適用せず判定不能として復元する', async () => {
  let resolve;
  const h = setup({ ...base, blackRules: [{ condition: '一つ目', threshold: 0.8, enabled: true }] }, () => new Promise(done => { resolve = done; }));
  try {
    await import(`../src/content.js?cache-pending-generation=${Date.now()}`);
    await new Promise(done => setTimeout(done, 10));
    h.clearCache();
    resolve({ answers: { [hashCondition('一つ目')]: { noul: 0.9 } } });
    await new Promise(done => setTimeout(done, 20));
    assert.equal(h.article().dataset.jevState, 'unknown');
    assert.equal(h.article().dataset.jevReason, 'cache-cleared');
    assert.equal(h.sends(), 1);
  } finally { h.restore(); }
});

test('無効時に欠落したwhite回答は有効化後に不足分を再取得する', async () => {
  const blackRules = [{ condition: '攻撃的な投稿', threshold: 0.8, enabled: true }];
  const whiteRules = [{ condition: '建設的な投稿', threshold: 0.8, enabled: false }];
  const h = setup({ ...base, blackRules, whiteRules }, sends => sends === 1
    ? { answers: { [hashCondition('攻撃的な投稿')]: { noul: 0.1 } } }
    : { answers: { [hashCondition('攻撃的な投稿')]: { noul: 0.1 }, [hashCondition('建設的な投稿')]: { noul: 0.9 } } });
  try {
    await import(`../src/content.js?white-cache-missing=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.sends(), 1);
    h.changed({ ...base, blackRules, whiteRules: [{ ...whiteRules[0], enabled: true }] });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.article().dataset.jevState, 'no-match');
    assert.equal(h.sends(), 2);
  } finally { h.restore(); }
});

test('判定中に同一投稿の条件が変わった場合は旧回答を適用しない', async () => {
  const rules = [{ condition: '旧条件', threshold: 0.8, enabled: true }];
  const resolvers = [];
  const h = setup({ ...base, blackRules: rules }, () => new Promise(done => { resolvers.push(done); }));
  try {
    await import(`../src/content.js?rule-pending=${Date.now()}`);
    await new Promise(done => setTimeout(done, 10));
    h.changed({ ...base, blackRules: [{ ...rules[0], condition: '新条件' }] });
    resolvers[0]({ answers: { [hashCondition('旧条件')]: { noul: 1 } } });
    await new Promise(done => setTimeout(done, 20));
    assert.equal(h.article().dataset.jevState, 'pending');
    assert.equal(h.sends(), 2);
    resolvers[1]({ answers: { [hashCondition('新条件')]: { noul: 1 } } });
    await new Promise(done => setTimeout(done, 20));
    assert.equal(h.article().dataset.jevState, 'matched');
  } finally { h.restore(); }
});

test('回答不足はinvalid-answerで止まり再送しない', async () => {
  const rules = [{ condition: '一つ目', threshold: 0.8, enabled: true }, { condition: '二つ目', threshold: 0.8, enabled: true }];
  const h = setup({ ...base, blackRules: rules }, { answers: { [hashCondition('一つ目')]: { noul: 1 } } });
  try {
    await import(`../src/content.js?rule-missing=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.article().dataset.jevState, 'unknown');
    assert.equal(h.article().dataset.jevReason, 'invalid-answer');
    assert.equal(h.sends(), 1);
  } finally { h.restore(); }
});

test('missing-key後のAPIキー保存通知で同じ投稿を再判定する', async () => {
  const rules = [{ condition: '一つ目', threshold: 0.8, enabled: true }];
  const h = setup({ ...base, blackRules: rules }, sends => sends === 1
    ? { unknown: true, reason: 'missing-key' }
    : { answers: { [hashCondition('一つ目')]: { noul: 0.9 } } });
  try {
    await import(`../src/content.js?missing-key-recovery=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.article().dataset.jevReason, 'missing-key');
    h.changed({ ...base, blackRules: rules, keyConfigured: true });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.article().dataset.jevState, 'matched');
    assert.equal(h.sends(), 2);
  } finally { h.restore(); }
});

test('条件を削除して再追加しても元の条件集合の回答を再利用する', async () => {
  const rules = [{ condition: '一つ目', threshold: 0.8, enabled: true }, { condition: '二つ目', threshold: 0.8, enabled: true }];
  const h = setup({ ...base, blackRules: rules }, { answers: { [hashCondition('一つ目')]: { noul: 0.9 }, [hashCondition('二つ目')]: { noul: 0.9 } } });
  try {
    await import(`../src/content.js?rule-readd=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.sends(), 1);
    h.changed({ ...base, blackRules: [rules[0]] });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.sends(), 2);
    h.changed({ ...base, blackRules: rules });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.sends(), 2);
  } finally { h.restore(); }
});
