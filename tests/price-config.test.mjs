import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INPUT_PRICE_PER_MILLION, normalizeConfig } from '../src/core/config.js';

test('通貨と単価を正規化する', () => {
  const cases = [
    [{}, 'USD', DEFAULT_INPUT_PRICE_PER_MILLION],
    [{ billingCurrency: 'JPY', inputPricePerMillion: null }, 'JPY', null],
    [{ billingCurrency: 'USD', inputPricePerMillion: null }, 'USD', DEFAULT_INPUT_PRICE_PER_MILLION],
    [{ billingCurrency: 'JPY', inputPricePerMillion: 12 }, 'JPY', 12]
  ];
  for (const [input, currency, price] of cases) {
    const config = normalizeConfig(input);
    assert.equal(config.billingCurrency, currency);
    assert.equal(config.inputPricePerMillion, price);
  }
});

test('新規設定はUSDの初期上限を持ち、既存の上限と削除を保持する', () => {
  assert.deepEqual(normalizeConfig().usageLimits, { '5h': 0.06, '1d': 0.10, '7d': 0.50, '30d': null });
  assert.equal(normalizeConfig({ usageLimits: { '5h': 2 } }).usageLimits['5h'], 2);
  assert.equal(normalizeConfig({ usageLimits: {} }).usageLimits['5h'], null);
  assert.equal(normalizeConfig({ usageLimits: { '7d': 0 } }).usageLimits['7d'], null);
  assert.equal(normalizeConfig({ billingCurrency: 'JPY' }).usageLimits['5h'], null);
});
