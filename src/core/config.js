export const CONFIG_VERSION = 2;
export const PROVIDERS = { typesafe: 'TypeSafe（Jev API）', openrouter: 'OpenRouter（Jev）' };
export const OPENROUTER_DEFAULT_MODEL = '~typesafe/jev-latest';
export const DEFAULT_INPUT_PRICE_PER_MILLION = 0.042;

// 条件文を条件の永続的な識別子へ変換
export function hashCondition(condition) {
  const bytes = new TextEncoder().encode(String(condition).trim());
  let hash = 14695981039346656037n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, '0');
}

const BLACK_DEFAULT_CONDITIONS = [
  ['特定の人物や団体への誹謗中傷', true, 0.9], ['読者の怒りや憎悪の煽動、対立の助長', true, 0.9],
  ['特定の地域・団体・界隈や、個人の属性を一括りにした決めつけ', true, 0.9], ['ユーモアの域を超えた、明らかな誇張や論理の飛躍したこじつけ', true, 0.9], ['攻撃的な表現による批判・反論', true, 0.9],
  ['他者への見下し・侮辱・嘲笑', true, 0.9], ['上から目線の説教やアドバイス', true, 0.9],
  ['他人の楽しみに水を差す冷笑', true, 0.9], ['「知らないと損」などの不安煽り', false, 0.9],
  ['投稿の保存を要求', false, 0.9], ['卑猥な表現', false, 0.9], ['政治的な話題', false, 0.8], ['地震に関する話題', false, 0.8],
  ['戦争に関する話題', false, 0.8]
];
const WHITE_DEFAULT_CONDITIONS = [['エンタメに関するネガティブでない投稿', false, 0.6]];
const makeRules = entries => entries.map(([condition, enabled, threshold = 0.8]) => ({ id: hashCondition(condition), condition, threshold, enabled }));
export const DEFAULT_BLACK_RULES = makeRules(BLACK_DEFAULT_CONDITIONS);
export const DEFAULT_WHITE_RULES = makeRules(WHITE_DEFAULT_CONDITIONS);

export const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  enabled: false,
  blackRules: DEFAULT_BLACK_RULES,
  whiteRules: DEFAULT_WHITE_RULES,
  pending: 'show',
  unknown: 'show',
  matched: 'collapse',
  provider: 'typesafe',
  model: 'jev-latest',
  usageLimits: { '5h': 0.06, '1d': 0.10, '7d': 0.50, '30d': null },
  inputPricePerMillion: DEFAULT_INPUT_PRICE_PER_MILLION,
  billingCurrency: 'USD',
  decisionCacheLimitMb: 100
};
export function normalizeConfig(input = {}) {
  const value = structuredClone(DEFAULT_CONFIG);
  if (!input || typeof input !== 'object') return value;
  for (const key of ['enabled', 'pending', 'unknown', 'matched', 'provider', 'model', 'usageLimits', 'inputPricePerMillion', 'billingCurrency', 'decisionCacheLimitMb']) {
    if (key in input) value[key] = input[key];
  }
  const normalizeRules = rules => rules.map(rule => {
    if (!rule || typeof rule.condition !== 'string') return null;
    const threshold = Number(rule.threshold ?? 0.8);
    const condition = rule.condition.trim();
    return { id: hashCondition(condition), condition, threshold: Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0.8, enabled: rule.enabled !== false };
  }).filter(rule => rule?.condition);
  if (Array.isArray(input.blackRules)) value.blackRules = normalizeRules(input.blackRules);

  if (Array.isArray(input.whiteRules)) value.whiteRules = normalizeRules(input.whiteRules);
  const legacyLimit = input.usageLimits && typeof input.usageLimits === 'object' ? input.usageLimits : {};
  const useDefaultLimits = !('usageLimits' in input) && (!input.billingCurrency || input.billingCurrency === 'USD');
  value.usageLimits = Object.fromEntries(['5h', '1d', '7d', '30d'].map(period => {
    const raw = useDefaultLimits ? DEFAULT_CONFIG.usageLimits[period] : legacyLimit[period];
    return [period, Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : null];
  }));
  if (!Object.hasOwn(PROVIDERS, value.provider)) value.provider = DEFAULT_CONFIG.provider;
  value.billingCurrency = ['USD', 'JPY'].includes(value.billingCurrency) ? value.billingCurrency : DEFAULT_CONFIG.billingCurrency;
  value.decisionCacheLimitMb = Number.isFinite(Number(value.decisionCacheLimitMb)) && Number(value.decisionCacheLimitMb) >= 1 ? Math.min(10240, Number(value.decisionCacheLimitMb)) : DEFAULT_CONFIG.decisionCacheLimitMb;
  const price = value.inputPricePerMillion;
  value.inputPricePerMillion = price === null || price === ''
    ? (value.billingCurrency === 'USD' ? DEFAULT_INPUT_PRICE_PER_MILLION : null)
    : Number.isFinite(Number(price)) && Number(price) >= 0 ? Number(price) : null;
  if (typeof value.model !== 'string' || !value.model.trim() || (value.provider === 'openrouter' && value.model === 'jev-latest')) value.model = value.provider === 'openrouter' ? OPENROUTER_DEFAULT_MODEL : 'jev-latest';
  value.version = CONFIG_VERSION;
  return value;
}

export function exportConfig(input) {
  const config = normalizeConfig(input);
  const pick = rule => ({ condition: rule.condition, threshold: rule.threshold, enabled: rule.enabled });
  return JSON.stringify({ version: CONFIG_VERSION, blackRules: config.blackRules.map(pick), whiteRules: config.whiteRules.map(pick) }, null, 2);
}

export function importConfig(text, current = DEFAULT_CONFIG) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.version !== CONFIG_VERSION) throw new Error('未対応の設定形式');
  if (parsed.blackRules !== undefined && !Array.isArray(parsed.blackRules)) throw new Error('ブラックリスト形式が不正です');
  if (parsed.whiteRules !== undefined && !Array.isArray(parsed.whiteRules)) throw new Error('ホワイトリスト形式が不正です');
  if (parsed.blackRules === undefined && parsed.whiteRules === undefined) throw new Error('条件がありません');
  const base = normalizeConfig(current);
  return normalizeConfig({ ...base, blackRules: parsed.blackRules ?? base.blackRules, whiteRules: parsed.whiteRules ?? base.whiteRules });
}
