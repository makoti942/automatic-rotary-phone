export const RECOVERY_SAMPLE_SIZE = 100;
export const RECOVERY_PARITY_TARGET = 60;
export const TOP_DIGIT_COUNT = 5;
export const REQUIRED_TARGET_DIGITS_IN_TOP = 3;

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
