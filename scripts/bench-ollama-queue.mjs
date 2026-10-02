import { readFile, rm, writeFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/core/config.js';

const TRIALS = Number(process.env.TRIALS ?? 3);
const BACKLOG = Number(process.env.BACKLOG ?? 12);
const VIEWPORT = Number(process.env.VIEWPORT ?? 3);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 1);
const PORT = process.env.PORT ?? '11434';

const rules = DEFAULT_CONFIG.blackRules.filter(rule => rule.enabled);
const config = { ...DEFAULT_CONFIG, enabled: true, provider: 'ollama', model: 'nimble', blackRules: rules, whiteRules: [] };
let listener;
globalThis.chrome = {
  runtime: { id: 'bench', onMessage: { addListener: callback => { listener = callback; } } },
  storage: { local: { get: async key => key === 'config' ? { config } : {}, set: async () => {} } }
};
const source = (await readFile(new URL('../src/background.js', import.meta.url), 'utf8'))
  .replace('{ ollama: 1 }', `{ ollama: ${CONCURRENCY} }`)
  .replace('localhost:11434', `localhost:${PORT}`);
const tempUrl = new URL(`../src/background.bench-${process.pid}.js`, import.meta.url);
await writeFile(tempUrl, source);
try { await import(tempUrl.href); } finally { await rm(tempUrl); }

const classify = (text, priority) => new Promise(resolve => listener({ type: 'classify', text, priority }, { url: 'https://x.com/home' }, resolve));
const post = label => `ベンチ投稿 ${label} ${Math.random()}：今日は駅前の新しいカフェに行ってきました。コーヒーが美味しくて、また行きたいなと思います。みなさんのおすすめも教えてください。`;

await classify(post('warm'), 0);

const viewportMs = [];
const totalMs = [];
for (let trial = 0; trial < TRIALS; trial++) {
  const started = performance.now();
  const backlog = Array.from({ length: BACKLOG }, (_, i) => classify(post(`backlog-${i}`), 2));
  await new Promise(resolve => setTimeout(resolve, 100));
  const sentAt = performance.now();
  const viewport = Array.from({ length: VIEWPORT }, (_, i) => classify(post(`viewport-${i}`), 0).then(result => {
    if (!result?.answers) throw new Error(`viewport request failed: ${JSON.stringify(result)}`);
    return performance.now() - sentAt;
  }));
  const done = await Promise.all(viewport);
  viewportMs.push(Math.max(...done));
  await Promise.all(backlog);
  totalMs.push(performance.now() - started);
}

const round = values => values.map(value => Math.round(value));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({
  concurrency: CONCURRENCY,
  backlog: BACKLOG,
  viewport: VIEWPORT,
  viewportLastDoneMs: round(viewportMs),
  viewportLastDoneMedianMs: Math.round(median(viewportMs)),
  allDoneMs: round(totalMs),
  allDoneMedianMs: Math.round(median(totalMs))
}));
process.exit(0);
