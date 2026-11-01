import {
    getNextTradeSignalStake,
    normalizeTradeSignalMartingale,
    normalizeTradeSignalStake,
} from '../trade-signal-stakes';

describe('Trade Signal martingale stakes', () => {
    it('multiplies the settled stake after a loss and rounds to cents', () => {
        expect(getNextTradeSignalStake(-1, 0.35, 0.35, 1.5)).toBe(0.53);
        expect(getNextTradeSignalStake(0, 2, 1, 2)).toBe(4);
    });

    it('resets to the configured base stake after a win', () => {
        expect(getNextTradeSignalStake(1.2, 4, 0.75, 2)).toBe(0.75);
    });

    it('normalizes invalid base stakes and martingale factors safely', () => {
        expect(normalizeTradeSignalStake(0, 0.35)).toBe(0.35);
        expect(normalizeTradeSignalMartingale(0)).toBe(2);
        expect(getNextTradeSignalStake(-1, 'invalid', 1, 'invalid')).toBe(2);
    });
});
