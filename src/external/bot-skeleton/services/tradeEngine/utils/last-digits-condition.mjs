export const MAX_LAST_DIGITS_CONDITION_COUNT = 1000;

/**
 * Tick digit arrays are chronological; only the newest N entries participate.
 * Return false for invalid counts, unsupported conditions, or incomplete data.
 */
export function isLastDigitsConditionMet(digits, condition, count) {
    const n = Number(count);
    if (!Array.isArray(digits) || !Number.isInteger(n) || n < 1 || n > MAX_LAST_DIGITS_CONDITION_COUNT) return false;
    if (digits.length < n || !['ALL_ODD', 'ALL_EVEN'].includes(condition)) return false;
    const latest = digits.slice(-n);
    return latest.every(value => {
        const digit = Number(value);
        return Number.isInteger(digit) && digit >= 0 && digit <= 9 && (condition === 'ALL_ODD' ? digit % 2 === 1 : digit % 2 === 0);
    });
}
