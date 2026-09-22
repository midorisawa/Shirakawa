import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const encode = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const configSource = await fs.readFile('src/core/config.js', 'utf8');
const filterSource = await fs.readFile('src/core/filter.js', 'utf8');
const currentBackground = await fs.readFile('src/background.js', 'utf8');
const currentContent = await fs.readFile('src/content.js', 'utf8');
const baselineBackground = execSync('git show c0b78df:src/background.js', { encoding: 'utf8' });
const baselineContent = execSync('git show c0b78df:src/content.js', { encoding: 'utf8' });
const { hashCondition } = await import('../src/core/config.js');

async function measure(backgroundSource, contentSource, label) {
  const ruleId = hashCondition('condition');
  const values = [];
  for (let trial = 0; trial < 5; trial++) {
    const dom = new JSDOM('<main><div data-testid="primaryColumn"></div></main>', { url: 'https://x.com/home', runScripts: 'dangerously' });
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    globalThis.MutationObserver = dom.window.MutationObserver;
    const rule = { id: ruleId, condition: 'condition', threshold: 0.8, enabled: true };
    const config = { enabled: true, pending: 'hide', unknown: 'hide', matched: 'collapse', provider: 'typesafe', model: 'jev-latest', blackRules: [rule], whiteRules: [], usageLimits: { '5h': null, '1d': null, '7d': null, '30d': null }, periodCostLimit: null, decisionCacheLimitMb: 100 };
    const state = { config, jevApiKeys: { typesafe: 'test-key' }, tokenUsage: {}, usage: {} };
    const listeners = [];
    globalThis.chrome = { runtime: { id: 'test', onMessage: { addListener: listener => listeners.push(listener) }, sendMessage: message => new Promise(resolve => listeners.forEach(listener => listener(message, { url: 'https://x.com/home' }, resolve))) }, storage: { onChanged: { addListener() {} }, local: { get: async key => ({ [key]: state[key] }), set: async value => Object.assign(state, value) } } };
    globalThis.fetch = async () => { await new Promise(resolve => setTimeout(resolve, 40)); return { ok: true, json: async () => ({ answers: { [ruleId]: { noul: 1 } }, usage: { input_tokens: 1 } }) }; };
    const background = backgroundSource.replace("from './core/config.js'", `from '${encode(configSource)}'`).replace("from './core/filter.js'", `from '${encode(filterSource)}'`);
    const content = contentSource.replace("from './core/config.js'", `from '${encode(configSource)}'`).replace("from './core/filter.js'", `from '${encode(filterSource)}'`);
    await import(encode(background) + `#background-${label}-${trial}`);
    await import(encode(content) + `#content-${label}-${trial}`);
    await new Promise(resolve => setTimeout(resolve, 15));
    const column = document.querySelector('[data-testid="primaryColumn"]');
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 10; index++) { const article = document.createElement('article'); article.setAttribute('role', 'article'); article.dataset.testid = 'tweet'; article.dataset.postId = `post-${index}`; article.innerHTML = `<div data-testid="tweetText">post-${index}</div>`; fragment.append(article); }
    const started = performance.now();
    column.append(fragment);
    for (let wait = 0; wait < 300; wait++) { const posts = [...document.querySelectorAll('article')]; if (posts.length === 10 && posts.every(post => post.dataset.jevState === 'matched' && post.classList.contains('jev-content-hidden'))) break; await new Promise(resolve => setTimeout(resolve, 2)); }
    const posts = [...document.querySelectorAll('article')];
    if (posts.length !== 10 || !posts.every(post => post.dataset.jevState === 'matched' && post.classList.contains('jev-content-hidden'))) throw new Error(`${label} did not hide all posts`);
    values.push(performance.now() - started);
    dom.window.close();
  }
  return values;
}

console.log(JSON.stringify({ baseline: await measure(baselineBackground, baselineContent, 'baseline'), current: await measure(currentBackground, currentContent, 'current') }));
