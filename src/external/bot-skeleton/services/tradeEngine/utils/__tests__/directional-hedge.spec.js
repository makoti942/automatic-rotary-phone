import {
    createDirectionalHedgePlan,
    getDirectionalSpotOutcome,
    getDirectionalOneTickOutcome,
    getConfirmedTickDirection,
    isDirectionalTickLoss,
} from '../directional-hedge';

describe('getConfirmedTickDirection', () => {
    it('confirms two consecutive upward movements', () => {
        expect(getConfirmedTickDirection([100, 101, 102])).toBe('rise');
    });

    it('confirms two consecutive downward movements', () => {
        expect(getConfirmedTickDirection([103, 102, 101])).toBe('fall');
    });

    it('does not confirm a mixed-direction sequence', () => {
        expect(getConfirmedTickDirection([100, 101, 100])).toBe('');
    });

    it('does not confirm an equal-price movement', () => {
        expect(getConfirmedTickDirection([100, 101, 101])).toBe('');
    });

    it('requires at least three quotes for two movements', () => {
        expect(getConfirmedTickDirection([100, 101])).toBe('');
    });

    it('rejects non-numeric quotes', () => {
        expect(getConfirmedTickDirection([100, 101, 'bad'])).toBe('');
    });

    it('still supports an explicitly requested three-movement threshold', () => {
        expect(getConfirmedTickDirection([100, 101, 102, 103], 3)).toBe('rise');
    });
});

describe('createDirectionalHedgePlan', () => {
    it('buys Fall for 1 tick with Only Ups for 2 ticks after a rising sequence, then retries Fall', () => {
        const plan = createDirectionalHedgePlan('rise', {
            riseToFallStake: 1.25,
            riseToOnlyUpsStake: 2.5,
            riseFallRetryStake: 3.75,
        });

        expect(plan).toEqual({
            legs: [
                { contract_type: 'PUT', duration: 1, stake: 1.25 },
                { contract_type: 'RUNHIGH', duration: 2, stake: 2.5 },
            ],
            retry: { contract_type: 'PUT', duration: 1, stake: 3.75 },
        });
    });

    it('buys Only Downs for 2 ticks with Rise for 1 tick after a falling sequence, then retries Rise', () => {
        const plan = createDirectionalHedgePlan('fall', {
            fallToOnlyDownsStake: 1.1,
            fallToRiseStake: 2.2,
            fallRiseRetryStake: 3.3,
        });

        expect(plan).toEqual({
            legs: [
                { contract_type: 'RUNLOW', duration: 2, stake: 1.1 },
                { contract_type: 'CALL', duration: 1, stake: 2.2 },
            ],
            retry: { contract_type: 'CALL', duration: 1, stake: 3.3 },
        });
    });

    it('defaults invalid stakes safely and rejects unknown directions', () => {
        expect(createDirectionalHedgePlan('rise', { riseToFallStake: 0 }).legs[0].stake).toBe(1);
        expect(createDirectionalHedgePlan('sideways')).toBeNull();
    });
});

describe('isDirectionalTickLoss', () => {
    it('recognizes a CALL loss when the exit tick is not higher than the entry', () => {
        expect(isDirectionalTickLoss('CALL', 100, 99)).toBe(true);
        expect(isDirectionalTickLoss('CALL', 100, 100)).toBe(true);
        expect(isDirectionalTickLoss('CALL', 100, 101)).toBe(false);
    });

    it('recognizes a PUT loss when the exit tick is not lower than the entry', () => {
        expect(isDirectionalTickLoss('PUT', 100, 101)).toBe(true);
        expect(isDirectionalTickLoss('PUT', 100, 100)).toBe(true);
        expect(isDirectionalTickLoss('PUT', 100, 99)).toBe(false);
    });

    it('returns null for unsupported contracts or invalid tick quotes', () => {
        expect(isDirectionalTickLoss('RUNLOW', 100, 101)).toBeNull();
        expect(isDirectionalTickLoss('CALL', 100, 'invalid')).toBeNull();
    });
});

describe('getDirectionalOneTickOutcome', () => {
    it('uses the first tick after entry as the local expiry result', () => {
        const outcome = getDirectionalOneTickOutcome('CALL', 100, 10, [
            { epoch: 10, quote: 100 },
            { epoch: 11, quote: 99 },
            { epoch: 12, quote: 103 },
        ]);

        expect(outcome).toEqual({ exitTick: { epoch: 11, quote: 99 }, isLoss: true });
    });

    it('finds the first post-entry tick even when the entry tick is absent from the buffer', () => {
        const outcome = getDirectionalOneTickOutcome('PUT', 100, 10, [
            { epoch: 11, quote: 101 },
            { epoch: 12, quote: 99 },
        ]);

        expect(outcome).toEqual({ exitTick: { epoch: 11, quote: 101 }, isLoss: true });
    });

    it('waits for a tick after entry and rejects unsupported contracts', () => {
        expect(getDirectionalOneTickOutcome('CALL', 100, 10, [{ epoch: 10, quote: 101 }])).toBeNull();
        expect(getDirectionalOneTickOutcome('RUNLOW', 100, 10, [{ epoch: 11, quote: 101 }])).toBeNull();
    });
});

describe('getDirectionalSpotOutcome', () => {
    it('decides a CALL loss directly from entry and exit spots', () => {
        expect(getDirectionalSpotOutcome('CALL', 100, 99)).toEqual({
            isLoss: true,
            entrySpot: 100,
            exitSpot: 99,
        });
    });

    it('decides a PUT win directly from entry and exit spots', () => {
        expect(getDirectionalSpotOutcome('PUT', 100, 99)).toEqual({
            isLoss: false,
            entrySpot: 100,
            exitSpot: 99,
        });
    });

    it('returns null until both spot values are usable', () => {
        expect(getDirectionalSpotOutcome('CALL', 100, undefined)).toBeNull();
        expect(getDirectionalSpotOutcome('CALL', '', 99)).toBeNull();
        expect(getDirectionalSpotOutcome('RUNLOW', 100, 99)).toBeNull();
    });
});
