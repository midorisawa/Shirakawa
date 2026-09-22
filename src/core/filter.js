export function evaluateAnswers(answers, rules, whiteRules = []) {
  const matches = (candidates) => candidates.reduce((result, rule, index) => {
    if (!rule.enabled) return result;
    const answer = answers?.[rule.id];
    const probability = typeof answer?.noul === 'number' ? answer.noul : answer?.probabilities?.yes;
    if (typeof probability === 'number') result.push({ ...rule, probability, index, matched: probability >= Number(rule.threshold) });
    return result;
  }, []);
  const black = matches(rules);
  const white = matches(whiteRules);
  const blackMatched = black.filter(rule => rule.matched);
  const whiteMatched = white.filter(rule => rule.matched);
  const hasWhite = whiteRules.some(rule => rule.enabled);
  const blockedByWhite = !blackMatched.length && hasWhite && !whiteMatched.length;
  const blocked = blackMatched.length > 0 || blockedByWhite;
  return { matched: blocked, blockedByWhite: Boolean(blockedByWhite), rules: blocked ? (blockedByWhite ? white : blackMatched) : [] };
}

export function validAnswer(answer) {
  const noul = answer?.noul;
  const yes = answer?.probabilities?.yes;
  return (typeof noul === 'number' && noul >= 0 && noul <= 1) || (typeof yes === 'number' && yes >= 0 && yes <= 1);
}
