import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOVERY_SAMPLE_SIZE,
  REQUIRED_TARGET_DIGITS_IN_TOP,
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
  const rejected = candidate('R_10', 'odd', 40, 60, 3); // only 2 of top 5 digits are odd
  const accepted = candidate('R_25', 'odd', 41, 59, 2); // 3 of top 5 digits are odd
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
  const samples = [
    candidate('R_10', 'odd', 39, 61, 3),
    candidate('R_25', 'even', 58, 42, 4),
  ];
  assert.equal(selectRecoveryCandidate(samples), null);
});
