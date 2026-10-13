import {
    clearManualTradeDigitStats,
    getManualTradeDigitPercentage,
    publishManualTradeDigitStats,
} from '../manual-trade-digit-stats';

describe('manual-trade digit percentages', () => {
    beforeEach(() => {
        clearManualTradeDigitStats();
    });

    afterAll(() => {
        clearManualTradeDigitStats();
    });

    it('publishes digit frequencies from the current sample', () => {
        publishManualTradeDigitStats('R_100', [1, 0, 2, 0, 0, 0, 0, 0, 0, 0], 3);

        expect(getManualTradeDigitPercentage(0)).toBe(33.3);
        expect(getManualTradeDigitPercentage(2)).toBe(66.7);
        expect(window.__manualTradeDigitStats?.symbol).toBe('R_100');
        expect(window.__manualTradeDigitStats?.totalTicks).toBe(3);
    });

    it('returns zero when there is no current sample', () => {
        publishManualTradeDigitStats('R_50', Array(10).fill(0), 0);

        expect(getManualTradeDigitPercentage(5)).toBe(0);
    });

    it('returns zero for invalid digit inputs', () => {
        publishManualTradeDigitStats('R_50', Array(10).fill(1), 10);

        expect(getManualTradeDigitPercentage(-1)).toBe(0);
        expect(getManualTradeDigitPercentage(10)).toBe(0);
        expect(getManualTradeDigitPercentage(1.5)).toBe(0);
    });

    it('clears the published snapshot when the provider unmounts', () => {
        publishManualTradeDigitStats('R_50', Array(10).fill(1), 10);
        clearManualTradeDigitStats();

        expect(getManualTradeDigitPercentage(5)).toBe(0);
    });
});
