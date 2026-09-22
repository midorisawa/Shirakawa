import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INPUT_PRICE_PER_MILLION, normalizeConfig } from '../src/core/config.js';

test('既定単価はOpenRouterのJev 1.13入力価格を使う', () => {
  const config = normalizeConfig({});
  assert.equal(config.billingCurrency, 'USD');
  assert.equal(config.inputPricePerMillion, DEFAULT_INPUT_PRICE_PER_MILLION);
});

test('JPY未設定へUSD既定単価を混入しない', () => {
  assert.equal(normalizeConfig({ billingCurrency: 'JPY', inputPricePerMillion: null }).inputPricePerMillion, null);
  assert.equal(normalizeConfig({ billingCurrency: 'USD', inputPricePerMillion: null }).inputPricePerMillion, DEFAULT_INPUT_PRICE_PER_MILLION);
});

test('ユーザー指定単価と通貨を保持する', () => {
  const config = normalizeConfig({ billingCurrency: 'JPY', inputPricePerMillion: 12 });
  assert.equal(config.billingCurrency, 'JPY');
  assert.equal(config.inputPricePerMillion, 12);
});

test('新規設定はUSDの初期上限を持ち、既存の上限と削除を保持する', () => {
  assert.deepEqual(normalizeConfig().usageLimits, { '5h': 0.06, '1d': 0.10, '7d': 0.50, '30d': null });
  assert.equal(normalizeConfig({ usageLimits: { '5h': 2 } }).usageLimits['5h'], 2);
  assert.equal(normalizeConfig({ usageLimits: {} }).usageLimits['5h'], null);
  assert.equal(normalizeConfig({ usageLimits: { '7d': 0 } }).usageLimits['7d'], null);
  assert.equal(normalizeConfig({ billingCurrency: 'JPY' }).usageLimits['5h'], null);
});
