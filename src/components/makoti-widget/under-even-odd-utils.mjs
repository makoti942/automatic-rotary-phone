export const RECOVERY_SAMPLE_SIZE = 100;
export const RECOVERY_PARITY_TARGET = 60;
export const TOP_DIGIT_COUNT = 5;
export const REQUIRED_TARGET_DIGITS_IN_TOP = 3;
export const AUTOMATED_FREQUENCY_WINDOW = 1000;
export const AUTOMATED_TRIGGER_WINDOW = 30;
export const AUTOMATED_DIFFERS_REPEAT = 4;
export const AUTOMATED_LOW_DIGIT_PERCENT = 10;
export const AUTOMATED_TRIGGER_MIN_OCCURRENCES = 4;
export const AUTOMATED_TOP_MARKETS = 1;

export function nextAutomatedStage(stage) {
  return stage === 'differs' ? 'over1' : stage === 'over1' ? 'under8' : 'differs';
}

/** An entry needs both boundary digits in the latest three ticks, in any order. */
export function hasThreeTickPairPattern(digits, pair) {
  const window = (digits || []).slice(-3).map(Number);
  const target = new Set((pair || []).map(Number));
  return window.length === 3
    && target.size === 2
    && window.every(digit => target.has(digit))
    && target.size === new Set(window).size;
}

/** Manual Trade's digit percentage formula: digit count divided by valid digit total. */
export function calculateDigitPercentages(digits) {
  const counts = Array(10).fill(0);
  const valid = (digits || []).filter(digit => Number.isInteger(Number(digit)) && Number(digit) >= 0 && Number(digit) <= 9).map(Number);
  valid.forEach(digit => { counts[digit] += 1; });
  return { counts, total: valid.length, percentages: counts.map(count => valid.length ? (count / valid.length) * 100 : 0) };
}

/** Select the first trigger whose every observed next digit is a winning digit. */
export function findWinningDigitTrigger(digits, winningDigits, minOccurrences = AUTOMATED_TRIGGER_MIN_OCCURRENCES) {
  const values = (digits || []).map(Number).filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
  const winners = new Set((winningDigits || []).map(Number));
  const candidates = [];
  for (let trigger = 0; trigger <= 9; trigger += 1) {
    const nextDigits = [];
    for (let index = 0; index < values.length - 1; index += 1) {
      if (values[index] === trigger) nextDigits.push(values[index + 1]);
    }
    if (nextDigits.length >= minOccurrences && nextDigits.every(digit => winners.has(digit))) {
      candidates.push({ triggerDigit: trigger, occurrences: nextDigits.length, winningNext: nextDigits.length, confidence: 100 });
    }
  }
  return candidates.sort((a, b) => b.occurrences - a.occurrences || a.triggerDigit - b.triggerDigit)[0] || null;
}

/** Keep only markets whose required losing digits are each below the 10% threshold. */
export function selectAutomatedMarkets(samples, lowDigits, maxPercent = AUTOMATED_LOW_DIGIT_PERCENT) {
  const usable = (samples || []).filter(item => item && Array.isArray(item.digitPcts)
    && (lowDigits || []).every(digit => Number(item.digitPcts[digit]) < maxPercent));
  return [...usable].sort((a, b) => (a.pairPct - b.pairPct) || String(a.symbol).localeCompare(String(b.symbol))).slice(0, AUTOMATED_TOP_MARKETS);
}

/**
 * Rank candidates at/above the target first, nearest to 60% within that group,
 * then rank below-target candidates by closeness. A candidate is selected only
 * when at least three of its five most frequent individual digits match its
 * majority parity (losingTopCount <= 2).
 */
export function selectRecoveryCandidate(samples) {
  const score = item => Math.max(Number(item.evenPct) || 0, Number(item.oddPct) || 0);
  const ordered = [...(samples || [])].sort((a, b) => {
    const aScore = score(a);
    const bScore = score(b);
    const aTier = aScore >= RECOVERY_PARITY_TARGET ? 0 : 1;
    const bTier = bScore >= RECOVERY_PARITY_TARGET ? 0 : 1;
    return aTier - bTier
      || Math.abs(aScore - RECOVERY_PARITY_TARGET) - Math.abs(bScore - RECOVERY_PARITY_TARGET)
      || String(a.symbol || '').localeCompare(String(b.symbol || ''));
  });
  const maxOppositeDigits = TOP_DIGIT_COUNT - REQUIRED_TARGET_DIGITS_IN_TOP;
  return ordered.find(item => Number(item.losingTopCount) <= maxOppositeDigits) || null;
}

/** Select the closest usable market when no candidate passes the strict filter. */
export function selectNearestRecoveryCandidate(samples) {
  return [...(samples || [])]
    .filter(item => item && Number.isFinite(Number(item.evenPct)) && Number.isFinite(Number(item.oddPct)))
    .sort((a, b) => {
      const aScore = Math.max(Number(a.evenPct) || 0, Number(a.oddPct) || 0);
      const bScore = Math.max(Number(b.evenPct) || 0, Number(b.oddPct) || 0);
      return Math.abs(aScore - RECOVERY_PARITY_TARGET) - Math.abs(bScore - RECOVERY_PARITY_TARGET)
        || Number(a.losingTopCount || 0) - Number(b.losingTopCount || 0)
        || String(a.symbol || '').localeCompare(String(b.symbol || ''));
    })[0] || null;
}
