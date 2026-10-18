export const RECOVERY_SAMPLE_SIZE = 100;
export const RECOVERY_PARITY_TARGET = 60;
export const TOP_DIGIT_COUNT = 5;
export const REQUIRED_TARGET_DIGITS_IN_TOP = 3;
export const AUTOMATED_FREQUENCY_WINDOW = 1000;
export const TWO_DIGIT_EXPECTED_PERCENT = 20;

export function nextAutomatedStage(stage) {
  return stage === 'differs' ? 'over1' : stage === 'over1' ? 'under8' : 'differs';
}

/** Count only target-pair appearances; unrelated digits do not reset the count. */
export function advancePairHitCount(currentCount, digit, pair) {
  return Array.isArray(pair) && pair.includes(digit) ? (Number(currentCount) || 0) + 1 : (Number(currentCount) || 0);
}

/** Less-appearing means the combined pair rate is below its 20% baseline. */
export function isPairLessAppearing(digitPcts, pair) {
  if (!Array.isArray(digitPcts) || !Array.isArray(pair) || pair.length !== 2) return false;
  const combined = pair.reduce((sum, digit) => sum + (Number(digitPcts[digit]) || 0), 0);
  return combined < TWO_DIGIT_EXPECTED_PERCENT;
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
