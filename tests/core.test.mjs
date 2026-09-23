import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, OPENROUTER_DEFAULT_MODEL, exportConfig, importConfig, normalizeConfig } from '../src/core/config.js';
import { evaluateAnswers } from '../src/core/filter.js';

test('設定のエクスポートはAPIキーを除外し、インポートで既存キーを保持する', () => {
  const config = normalizeConfig({ ...DEFAULT_CONFIG, apiKey: 'secret', blackRules: [{ id: 'r', condition: '宣伝である', threshold: 0.8 }] });
  const imported = importConfig(exportConfig(config), config);
  const backup = JSON.parse(exportConfig(config));
  assert.deepEqual(Object.keys(backup).sort(), ['blackRules', 'version', 'whiteRules']);
  assert.equal(imported.provider, config.provider);
  assert.equal(imported.blackRules[0].condition, '宣伝である');
  assert.equal(normalizeConfig({ provider: 'openrouter' }).model, OPENROUTER_DEFAULT_MODEL);
  const openrouter = normalizeConfig({ provider: 'openrouter', model: 'typesafe/jev-1.13' });
  assert.equal(openrouter.model, 'typesafe/jev-1.13');
  assert.equal('apiKey' in importConfig(exportConfig(openrouter), { ...openrouter, apiKey: 'malicious' }), false);
});

test('有効ルールの確率が閾値以上なら該当する', () => {
  const rules = [{ id: 'a', condition: '怒りを煽る', threshold: 0.8, enabled: true }, { id: 'b', condition: 'x', threshold: 0.1, enabled: false }];
  const matched = evaluateAnswers({ a: { noul: 0.8 }, b: { noul: 1 } }, rules);
  assert.equal(matched.matched, true);
  assert.equal(matched.rules[0].probability, 0.8);
  assert.equal(evaluateAnswers({ a: { noul: 0.79 } }, rules).matched, false);
});

test('有効なホワイトリストはallowlistとして4状態を判定する', () => {
  const black = [{ id: 'b', condition: '黒', threshold: 0.8, enabled: true }];
  const white = [{ id: 'w', condition: '白', threshold: 0.8, enabled: true }];
  const cases = [
    [{ b: { noul: 0.9 }, w: { noul: 0.9 } }, true, false], [{ b: { noul: 0.9 }, w: { noul: 0.1 } }, true, false],
    [{ b: { noul: 0.1 }, w: { noul: 0.9 } }, false, false], [{ b: { noul: 0.1 }, w: { noul: 0.1 } }, true, true]
  ];
  for (const [answers, matched, blockedByWhite] of cases) {
    const result = evaluateAnswers(answers, black, white);
    assert.equal(result.matched, matched);
    assert.equal(result.blockedByWhite, blockedByWhite);
  }
  assert.equal(evaluateAnswers({ b: { noul: 0.9 } }, black, [{ ...white[0], enabled: false }]).matched, true);
});
