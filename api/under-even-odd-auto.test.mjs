import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATED_FREQUENCY_WINDOW,
  AUTOMATED_TRIGGER_WINDOW,
  AUTOMATED_LOW_DIGIT_PERCENT,
  RECOVERY_SAMPLE_SIZE,
  REQUIRED_TARGET_DIGITS_IN_TOP,
  calculateDigitPercentages,
  findWinningDigitTrigger,
  nextAutomatedStage,
  selectAutomatedMarkets,
  selectRecoveryCandidate,
} from '../src/components/makoti-widget/under-even-odd-utils.mjs';

const candidate = (symbol, side, evenPct, oddPct, losingTopCount) => ({
  symbol, side, evenPct, oddPct, losingTopCount,
});

test('recovery uses the intended 100-tick analysis window', () => {
  assert.equal(RECOVERY_SAMPLE_SIZE, 100);
  assert.equal(REQUIRED_TARGET_DIGITS_IN_TOP, 3);
});

test('ranks candidates near 60%, but rejects the closest candidate if its top digits disagree', () => {
  const rejected = candidate('R_10', 'odd', 40, 60, 3);
  const accepted = candidate('R_25', 'odd', 41, 59, 2);
  assert.equal(selectRecoveryCandidate([rejected, accepted]), accepted);
});

test('among passing candidates, chooses the one closest to 60% in the >=60% tier', () => {
  const farther = candidate('R_10', 'odd', 38, 62, 2);
  const closer = candidate('R_25', 'even', 60, 40, 2);
  assert.equal(selectRecoveryCandidate([farther, closer]), closer);
});

test('uses the closest below-60 candidate only when no >=60 candidate passes the digit check', () => {
  const rejectedAbove = candidate('R_10', 'odd', 39, 61, 3);
  const fartherBelow = candidate('R_25', 'even', 57, 43, 2);
  const closestBelow = candidate('R_50', 'odd', 41, 59, 2);
  assert.equal(selectRecoveryCandidate([rejectedAbove, fartherBelow, closestBelow]), closestBelow);
});

test('does not select a market when the top-five digit majority disagrees with the parity', () => {
  assert.equal(selectRecoveryCandidate([
    candidate('R_10', 'odd', 39, 61, 3),
    candidate('R_25', 'even', 58, 42, 4),
  ]), null);
});

test('automated scanning uses 1,000 ticks and a 30-tick trigger window', () => {
  assert.equal(AUTOMATED_FREQUENCY_WINDOW, 1000);
  assert.equal(AUTOMATED_TRIGGER_WINDOW, 30);
  assert.equal(AUTOMATED_LOW_DIGIT_PERCENT, 10);
});

test('digit percentages use count divided by valid digit total', () => {
  const result = calculateDigitPercentages([0, 1, 1, 2, 9]);
  assert.equal(result.total, 5);
  assert.deepEqual(result.percentages, [20, 40, 20, 0, 0, 0, 0, 0, 0, 20]);
});

test('finds a trigger whose following digits are always winners', () => {
  const trigger = findWinningDigitTrigger([4, 2, 4, 9, 4, 8], [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(trigger, { triggerDigit: 4, occurrences: 3, winningNext: 3, confidence: 100 });
});

test('rejects a trigger when one of its following digits is not a winner', () => {
  assert.equal(findWinningDigitTrigger([4, 2, 4, 1, 4, 8], [2, 3, 4, 5, 6, 7, 8, 9]), null);
});

test('automated markets require each losing digit to be below 10%', () => {
  const markets = selectAutomatedMarkets([
    { symbol: 'R_10', pairPct: 15, digitPcts: [6, 10, 10, 10, 10, 10, 10, 10, 17, 18] },
    { symbol: 'R_25', pairPct: 12, digitPcts: [9, 9, 10, 10, 10, 10, 10, 10, 16, 17] },
  ], [0, 1]);
  assert.deepEqual(markets.map(item => item.symbol), ['R_25']);
});

test('automated wins advance Differs → Over 1 → Under 8 → Differs', () => {
  const over1 = nextAutomatedStage('differs');
  const under8 = nextAutomatedStage(over1);
  const differsAgain = nextAutomatedStage(under8);
  assert.deepEqual([over1, under8, differsAgain], ['over1', 'under8', 'differs']);
});
