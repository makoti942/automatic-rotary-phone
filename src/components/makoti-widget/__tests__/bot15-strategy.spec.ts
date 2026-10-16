import { createBot15Plan, detectBot15Direction, isBot15DirectionalLoss } from '../bot15-strategy';

describe('Bot 15 strategy', () => {
    const stakes = {
        riseToFall: 1,
        riseToOnlyUps: 2,
        riseFallRetry: 3,
        fallToOnlyDowns: 4,
        fallToRise: 5,
        fallRiseRetry: 6,
    };

    it('detects two consecutive movements in either direction', () => {
        expect(detectBot15Direction([100, 101, 102])).toBe('rise');
        expect(detectBot15Direction([102, 101, 100])).toBe('fall');
        expect(detectBot15Direction([100, 101, 100])).toBeNull();
    });

    it('creates the rise and fall paired contract flows with retries', () => {
        expect(createBot15Plan('rise', stakes)).toMatchObject({
            legs: [
                { strategy: 'fall', contractType: 'PUT', duration: 1, stake: 1 },
                { strategy: 'only_ups', contractType: 'RUNHIGH', duration: 2, stake: 2 },
            ],
            retry: { strategy: 'fall', contractType: 'PUT', duration: 1, stake: 3 },
        });
        expect(createBot15Plan('fall', stakes)).toMatchObject({
            legs: [
                { strategy: 'only_downs', contractType: 'RUNLOW', duration: 2, stake: 4 },
                { strategy: 'rise', contractType: 'CALL', duration: 1, stake: 5 },
            ],
            retry: { strategy: 'rise', contractType: 'CALL', duration: 1, stake: 6 },
        });
    });

    it('decides a local loss from entry and exit quotes', () => {
        expect(isBot15DirectionalLoss('CALL', 100, 99)).toBe(true);
        expect(isBot15DirectionalLoss('PUT', 100, 99)).toBe(false);
        expect(isBot15DirectionalLoss('CALL', 100, 101)).toBe(false);
    });
});
