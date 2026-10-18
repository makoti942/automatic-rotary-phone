import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATED_FREQUENCY_WINDOW,
  AUTOMATED_PAIR_HITS_REQUIRED,
  RECOVERY_SAMPLE_SIZE,
  REQUIRED_TARGET_DIGITS_IN_TOP,
  TWO_DIGIT_EXPECTED_PERCENT,
  advancePairHitCount,
  isPairLessAppearing,
  nextAutomatedStage,
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

test('automated frequency checks use the 1,000-tick window and 20% two-digit baseline', () => {
  assert.equal(AUTOMATED_FREQUENCY_WINDOW, 1000);
  assert.equal(TWO_DIGIT_EXPECTED_PERCENT, 20);
});

test('qualifies a pair by combined frequency even when one member is above 10%', () => {
  const pcts = [12, 7, 11, 11, 11, 11, 11, 11, 7, 8];
  assert.equal(isPairLessAppearing(pcts, [0, 1]), true); // 19%; digit 0 is 12%
});

test('does not treat a pair at or above 20% as less appearing', () => {
  const pcts = [13, 7, 11, 11, 11, 11, 11, 11, 7, 7];
  assert.equal(isPairLessAppearing(pcts, [0, 1]), false); // exactly 20%
  assert.equal(isPairLessAppearing(pcts, [8, 9]), true); // 14%
});

test('automated wins advance Differs → Over 1 → Under 8 → Differs', () => {
  const over1 = nextAutomatedStage('differs');
  const under8 = nextAutomatedStage(over1);
  const differsAgain = nextAutomatedStage(under8);
  assert.deepEqual([over1, under8, differsAgain], ['over1', 'under8', 'differs']);
});

test('pair trigger waits for three target appearances while allowing intervening digits', () => {
  let hits = 0;
  for (const digit of [0, 5, 1, 7, 1]) hits = advancePairHitCount(hits, digit, [0, 1]);
  assert.equal(AUTOMATED_PAIR_HITS_REQUIRED, 3);
  assert.equal(hits, 3);
  assert.equal(advancePairHitCount(hits, 4, [0, 1]), 3);
});
