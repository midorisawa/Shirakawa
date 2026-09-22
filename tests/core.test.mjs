import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, OPENROUTER_DEFAULT_MODEL, exportConfig, hashCondition, importConfig, normalizeConfig } from '../src/core/config.js';
import { evaluateAnswers } from '../src/core/filter.js';

test('設定のエクスポートはAPIキーを除外し、インポートで既存キーを保持する', () => {
  const config = normalizeConfig({ ...DEFAULT_CONFIG, apiKey: 'secret', blackRules: [{ id: 'r', condition: '宣伝である', threshold: 0.8 }] });
  const imported = importConfig(exportConfig(config), config);
  const backup = JSON.parse(exportConfig(config));
  assert.deepEqual(Object.keys(backup).sort(), ['blackRules', 'version', 'whiteRules']);
  assert.equal('apiKey' in imported, false);
  assert.equal(imported.provider, config.provider);
  assert.equal(imported.blackRules[0].condition, '宣伝である');
  assert.equal(normalizeConfig({ provider: 'openrouter' }).model, OPENROUTER_DEFAULT_MODEL);
  const openrouter = normalizeConfig({ provider: 'openrouter', model: 'typesafe/jev-1.13' });
  assert.equal(openrouter.model, 'typesafe/jev-1.13');
  assert.equal('apiKey' in importConfig(exportConfig(openrouter), { ...openrouter, apiKey: 'malicious' }), false);
});

test('ブラックリストの初期条件を指定順と有効状態で復元する', () => {
  assert.deepEqual(DEFAULT_CONFIG.blackRules.map(rule => rule.condition), [
    '特定の人物や団体への誹謗中傷', '読者の怒りや憎悪の煽動、対立の助長',
    '特定の地域・団体・界隈や、個人の属性を一括りにした決めつけ', 'ユーモアの域を超えた、明らかな誇張や論理の飛躍したこじつけ', '攻撃的な表現による批判・反論',
    '他者への見下し・侮辱・嘲笑', '上から目線の説教やアドバイス',
    '他人の楽しみに水を差す冷笑', '「知らないと損」などの不安煽り',
    '投稿の保存を要求', '卑猥な表現', '政治的な話題', '地震に関する話題',
    '戦争に関する話題'
  ]);
  assert.deepEqual(DEFAULT_CONFIG.blackRules.map(rule => rule.enabled), [...Array(8).fill(true), ...Array(6).fill(false)]);
  assert.deepEqual(DEFAULT_CONFIG.blackRules.map(rule => rule.threshold), [...Array(11).fill(0.9), 0.8, 0.8, 0.8]);
});

test('ホワイトリストの初期条件を復元する', () => {
  assert.deepEqual(DEFAULT_CONFIG.whiteRules, [{ id: hashCondition('エンタメに関するネガティブでない投稿'), condition: 'エンタメに関するネガティブでない投稿', threshold: 0.6, enabled: false }]);
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
    [{ b: { noul: 0.9 }, w: { noul: 0.9 } }, true], [{ b: { noul: 0.9 }, w: { noul: 0.1 } }, true],
    [{ b: { noul: 0.1 }, w: { noul: 0.9 } }, false], [{ b: { noul: 0.1 }, w: { noul: 0.1 } }, true]
  ];
  for (const [answers, expected] of cases) assert.equal(evaluateAnswers(answers, black, white).matched, expected);
  assert.equal(evaluateAnswers({ b: { noul: 0.1 }, w: { noul: 0.1 } }, black, white).blockedByWhite, true);
  assert.equal(evaluateAnswers({ b: { noul: 0.9 }, w: { noul: 0.1 } }, black, white).blockedByWhite, false);
  assert.equal(evaluateAnswers({ b: { noul: 0.9 } }, black, [{ ...white[0], enabled: false }]).matched, true);
});

test('ホワイトリストに複数一致してもブラックリストを優先する', () => {
  const black = [{ id: 'b', condition: '黒', threshold: 0.8, enabled: true }];
  const white = [
    { id: 'deny', condition: '白拒否', threshold: 0.8, enabled: true, allowWhenBlacklisted: false },
    { id: 'allow', condition: '白許可', threshold: 0.8, enabled: true, allowWhenBlacklisted: true }
  ];
  const bothMatched = { b: { noul: 0.9 }, deny: { noul: 0.9 }, allow: { noul: 0.9 } };
  assert.equal(evaluateAnswers(bothMatched, black, white).matched, true);
  assert.equal(evaluateAnswers({ ...bothMatched, allow: { noul: 0.1 } }, black, white).matched, true);
});
