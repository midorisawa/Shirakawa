import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { hashCondition } from '../src/core/config.js';

const run = promisify(execFile);

test('ビルド済みcontent scriptはclassic scriptとして構文解析できる', async () => {
  await run(process.execPath, ['scripts/build.mjs']);
  const content = await readFile('dist/content.js', 'utf8');
  assert.doesNotMatch(content, /^\s*(?:import|export)\b/m);
  assert.doesNotThrow(() => new vm.Script(content));
  const dom = new JSDOM('<!doctype html>', { url: 'https://x.com/home', runScripts: 'dangerously' });
  dom.window.structuredClone = structuredClone;
  dom.window.chrome = {
    storage: { onChanged: { addListener() {} }, local: { get: async () => ({ config: { enabled: false } }) } },
    runtime: { sendMessage: async () => ({ unknown: true }) }
  };
  assert.doesNotThrow(() => dom.window.eval(content));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  dom.window.close();

  const config = { enabled: true, pending: 'hide', unknown: 'hide', matched: 'collapse', blackRules: [{ id: 'rule', condition: '条件', threshold: 0.8, enabled: true }] };
  const headless = new JSDOM('<main><div data-testid="primaryColumn"><article role="article" data-testid="tweet" data-post-id="headless"><div data-testid="tweetText">判定対象</div></article></div></main>', {
    url: 'https://x.com/home?mode=home-recommended',
    runScripts: 'dangerously',
    beforeParse(window) { Object.defineProperty(window.document, 'head', { configurable: true, get: () => null }); }
  });
  headless.window.structuredClone = structuredClone;
  headless.window.chrome = {
    storage: { local: { get: async () => ({ config }) }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async message => message.type === 'get-config' ? config : ({ answers: { [hashCondition('条件')]: { noul: 1 } } }) }
  };
  assert.doesNotThrow(() => headless.window.eval(content));
  await new Promise(resolve => headless.window.setTimeout(resolve, 20));
  const article = headless.window.document.querySelector('article');
  assert.equal(article.classList.contains('jev-content-hidden'), true);
  assert.match(article.textContent, /非表示条件「条件」1\.00/);
  assert.equal(article.querySelector('[data-testid="tweetText"]').textContent, '判定対象');
  headless.window.close();
});
