import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { hashCondition } from '../src/core/config.js';

const html = await readFile(new URL('./fixtures/x-page.html', import.meta.url), 'utf8');
const originalGlobals = Object.fromEntries(['chrome', 'document', 'location', 'MutationObserver'].map(key => [key, globalThis[key]]));
let activeWindow;

test.afterEach(() => {
  activeWindow?.close();
  activeWindow = undefined;
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
});

test('content.jsは判定前に隠した原文を非該当時と通信失敗時に復元する', async () => {
  const config = {
    enabled: true,
    pending: 'hide',
    unknown: 'hide',
    matched: 'collapse',
    blackRules: [{ id: 'rule', condition: '条件', threshold: 0.8, enabled: true }]
  };
  const storage = { local: { get: async () => ({ config }) }, onChanged: { addListener() {} } };
  let classifyCount = 0;
  globalThis.chrome = { storage, runtime: { sendMessage: async message => {
    if (message.type === 'get-config') return config;
    const { text } = message;
    classifyCount += 1;
    if (text.includes('通信失敗')) throw new Error('通信失敗');
    return { answers: { [hashCondition('条件')]: { noul: 0 } } };
  } } };
  const dom = new JSDOM(html, { url: 'https://x.com/home?mode=home-recommended', runScripts: 'dangerously', resources: 'usable' });
  activeWindow = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.MutationObserver = dom.window.MutationObserver;
  await import(`../src/content.js?fixture=${Date.now()}`);
  await new Promise(resolve => setTimeout(resolve, 20));
  const region = document.querySelector('[role="region"]');
  const unchanged = region.querySelector('[data-post-id="fixture-1"]');
  assert.equal(unchanged.querySelector('[data-testid="tweetText"]').textContent, '落ち着いた内容の架空投稿');
  assert.equal(unchanged.dataset.jevState, 'no-match');

  const failed = document.createElement('article');
  failed.setAttribute('role', 'article');
  failed.dataset.testid = 'tweet';
  failed.dataset.postId = 'fixture-failed';
  failed.innerHTML = '<div data-testid="tweetText">通信失敗の架空投稿</div><img src="https://img.example/loaded.jpg">';
  const image = failed.querySelector('img');
  region.append(failed);
  await new Promise(resolve => setTimeout(resolve, 20));
  const placeholder = region.querySelector('[data-post-id="fixture-failed"]');
  assert.match(placeholder.textContent, /判定できない投稿/);
  assert.equal(placeholder.dataset.jevState, 'unknown');
  assert.equal(placeholder.dataset.jevReason, 'request-error');
  placeholder.querySelector('button').click();
  assert.equal(region.querySelector('[data-post-id="fixture-failed"] [data-testid="tweetText"]').textContent, '通信失敗の架空投稿');
  assert.equal(region.querySelector('[data-post-id="fixture-failed"] img'), image);
  const restoredText = region.querySelector('[data-post-id="fixture-failed"] [data-testid="tweetText"]');
  const countBeforeReuse = classifyCount;
  restoredText.textContent = '復元後に再利用された架空投稿';
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(classifyCount, countBeforeReuse + 1);
});

test('再マウントは成功キャッシュを同期適用し、手動表示を引き継ぐ', async () => {
  const config = {
    enabled: true,
    pending: 'hide',
    unknown: 'hide',
    matched: 'collapse',
    blackRules: [{ id: 'rule-cache', condition: '条件', threshold: 0.8, enabled: true }]
  };
  const storage = { local: { get: async () => ({ config }) }, onChanged: { addListener() {} } };
  let classifyCount = 0;
  globalThis.chrome = { storage, runtime: { sendMessage: async message => {
    if (message.type === 'get-config') return config;
    classifyCount += 1;
    return { answers: { [hashCondition('条件')]: { noul: 1 } } };
  } } };
  const dom = new JSDOM('<main><div data-testid="primaryColumn"><article role="article" data-testid="tweet" data-post-id="cached"><div class="top-spacer" style="height:12px"><div></div></div><div class="row"><div data-testid="Tweet-User-Avatar"><a href="/cached">アイコン</a></div><div class="body"><div class="header"><div data-testid="User-Name">cached user</div><a href="/cached/status/1"><time>9月21日</time></a></div><div data-testid="tweetText">再マウント対象</div><div data-testid="tweetPhoto">画像</div></div></div></article></div></main>', { url: 'https://x.com/home?mode=home-recommended', runScripts: 'dangerously', resources: 'usable' });
  activeWindow = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.MutationObserver = dom.window.MutationObserver;
  await import(`../src/content.js?cache=${Date.now()}`);
  await new Promise(resolve => setTimeout(resolve, 20));
  const region = document.querySelector('[data-testid="primaryColumn"]');
  const original = region.querySelector('article');
  assert.equal(original.dataset.jevState, 'matched');
  assert.match(original.querySelector('.jev-placeholder').textContent, /非表示条件「条件」1\.00/);
  assert.equal(classifyCount, 1);
  let postClicks = 0;
  original.addEventListener('click', () => postClicks++);
  original.querySelector('.jev-reason').click();
  assert.equal(postClicks, 0);
  original.querySelector('button').click();
  assert.equal(original.classList.contains('jev-content-hidden'), false);
  assert.equal(postClicks, 0);
  assert.match(original.querySelector('.jev-placeholder').textContent, /非表示条件「条件」1\.00/);
  assert.equal(original.querySelector('button').textContent, '非表示に戻す');
  original.querySelector('button').click();
  assert.equal(original.classList.contains('jev-content-hidden'), true);
  assert.equal(original.querySelector('button').textContent, '表示する');
  original.querySelector('button').click();
  assert.equal(original.classList.contains('jev-content-hidden'), false);

  original.remove();
  const replacement = document.createElement('article');
  replacement.setAttribute('role', 'article');
  replacement.dataset.testid = 'tweet';
  replacement.dataset.postId = 'cached';
  replacement.innerHTML = '<div data-testid="User-Name">cached user</div><div data-testid="tweetText">再マウント対象</div>';
  region.append(replacement);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(replacement.classList.contains('jev-content-hidden'), false);
  assert.equal(replacement.dataset.jevState, 'matched');
  assert.match(replacement.querySelector('.jev-placeholder').textContent, /非表示条件「条件」1\.00/);
  assert.equal(replacement.querySelector('button').textContent, '非表示に戻す');
  assert.equal(classifyCount, 1);

  replacement.classList.add('jev-content-hidden');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(replacement.classList.contains('jev-content-hidden'), false);
  assert.equal(classifyCount, 1);
});

test('本文と引用元を独立判定し、引用元だけのblackと本文blackを分離して表示する', async () => {
  const black = { id: hashCondition('black'), condition: 'black', threshold: 0.8, enabled: true };
  const white = { id: hashCondition('white'), condition: 'white', threshold: 0.8, enabled: true, allowWhenBlacklisted: false };
  const config = { enabled: true, pending: 'hide', unknown: 'hide', matched: 'collapse', blackRules: [black], whiteRules: [white] };
  const answers = text => ({ answers: {
    [black.id]: { noul: text.includes('black') ? 1 : 0 },
    [white.id]: { noul: text.includes('white') ? 1 : 0 }
  } });
  globalThis.chrome = {
    storage: { local: { get: async () => ({ config }) }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async message => message.type === 'get-config' ? config : answers(message.text) }
  };
  const dom = new JSDOM(`<main><div data-testid="primaryColumn">
    <article role="article" data-testid="tweet" data-post-id="independent-1">
      <div data-testid="tweetText">本文white</div>
      <div role="link"><div class="quote-header"><span data-testid="UserAvatar-Container-quote">アイコン</span><div data-testid="User-Name">引用ユーザー</div><time>日時</time></div><div data-testid="tweetText">引用black</div></div>
    </article>
    <article role="article" data-testid="tweet" data-post-id="independent-2">
      <div data-testid="tweetText">本文black</div>
      <div role="link"><div class="quote-header"><span data-testid="UserAvatar-Container-quote">アイコン</span><div data-testid="User-Name">引用ユーザー</div><time>日時</time></div><div data-testid="tweetText">引用white</div></div>
    </article>
  </div></main>`, { url: 'https://x.com/home?mode=home-recommended', runScripts: 'dangerously', resources: 'usable' });
  activeWindow = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.MutationObserver = dom.window.MutationObserver;
  await import(`../src/content.js?quote=${Date.now()}`);
  await new Promise(resolve => setTimeout(resolve, 30));
  const first = document.querySelector('[data-post-id="independent-1"]');
  const second = document.querySelector('[data-post-id="independent-2"]');
  const firstQuote = first.querySelector('[role="link"]');
  const secondQuote = second.querySelector('[role="link"]');
  assert.equal(first.classList.contains('jev-content-hidden'), false);
  assert.equal(firstQuote.classList.contains('jev-quote-hidden'), true);
  assert.equal(first.querySelector('[data-testid="tweetText"]').textContent, '本文white');
  assert.equal(second.classList.contains('jev-content-hidden'), true);
  assert.equal(secondQuote.classList.contains('jev-quote-hidden'), false);
});

test('本文投稿は引用カード内のstatus URLを投稿IDとして使わない', async () => {
  const config = { enabled: true, pending: 'show', unknown: 'show', matched: 'collapse', blackRules: [{ id: hashCondition('条件'), condition: '条件', threshold: 0.8, enabled: true }], whiteRules: [] };
  const messages = [];
  globalThis.chrome = {
    storage: { local: { get: async () => ({ config }) }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async message => { if (message.type === 'get-config') return config; messages.push(message); return { answers: { [hashCondition('条件')]: { noul: 0 } } }; } }
  };
  const dom = new JSDOM(`<main><div data-testid="primaryColumn"><article role="article" data-testid="tweet">
    <a href="/owner/status/100"><time>親投稿</time></a><div data-testid="tweetText">親本文</div>
    <div role="link"><div data-testid="User-Name">引用ユーザー</div><a href="/quoted/status/200"><time>引用投稿</time></a><div data-testid="tweetText">引用本文</div></div>
  </article></div></main>`, { url: 'https://x.com/home', runScripts: 'dangerously', resources: 'usable' });
  activeWindow = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.MutationObserver = dom.window.MutationObserver;
  await import(`../src/content.js?post-id=${Date.now()}`);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(messages.find(message => message.text === '親本文')?.postId, '100');
  assert.equal(messages.find(message => message.text === '引用本文')?.postId, '200');
});

test('content scriptは同期throwで無効化されたコンテキストを停止し、非表示中の投稿を復元する', async () => {
  const config = {
    enabled: true,
    pending: 'hide',
    unknown: 'hide',
    matched: 'collapse',
    blackRules: [{ id: hashCondition('条件'), condition: '条件', threshold: 0.8, enabled: true }]
  };
  let classifyCount = 0;
  let touchCount = 0;
  globalThis.chrome = {
    storage: { local: { get: async () => ({ config }) }, onChanged: { addListener() {} } },
    runtime: { sendMessage(message) {
      if (message.type === 'get-config') return Promise.resolve(config);
      if (message.type === 'touch-cache') {
        touchCount++;
        if (touchCount > 1) throw new Error('Extension context invalidated.');
        return Promise.resolve({ ok: true });
      }
      classifyCount++;
      return Promise.resolve({
        answers: { [hashCondition('条件')]: { noul: 1 } },
        _jevCacheExpiresAt: Date.now() + 60_000
      });
    } }
  };
  const dom = new JSDOM(`<main><div data-testid="primaryColumn">
    <article role="article" data-testid="tweet" data-post-id="context-cache">
      <div class="row"><div data-testid="Tweet-User-Avatar">アイコン</div><div class="body">
        <div class="header"><div data-testid="User-Name">test</div><a href="/test/status/1"><time>日時</time></a></div>
        <div data-testid="tweetText">同期throw後に復元する投稿</div>
      </div></div>
    </article>
  </div></main>`, { url: 'https://x.com/home', runScripts: 'dangerously', resources: 'usable' });
  activeWindow = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.MutationObserver = dom.window.MutationObserver;
  await import(`../src/content.js?invalidated=${Date.now()}`);
  await new Promise(resolve => setTimeout(resolve, 20));
  const region = document.querySelector('[data-testid="primaryColumn"]');
  const original = region.querySelector('article');
  assert.equal(original.classList.contains('jev-content-hidden'), true);
  assert.equal(classifyCount, 1);

  original.remove();
  const replacement = original.cloneNode(true);
  region.append(replacement);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(touchCount, 2);
  assert.equal(replacement.classList.contains('jev-content-hidden'), false);
  assert.equal(replacement.querySelector('.jev-placeholder'), null);

  const later = document.createElement('article');
  later.setAttribute('role', 'article');
  later.dataset.testid = 'tweet';
  later.dataset.postId = 'after-invalidation';
  later.innerHTML = '<div data-testid="tweetText">無効化後の投稿</div>';
  region.append(later);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(classifyCount, 1);
  assert.equal(later.dataset.jevState, undefined);
});
