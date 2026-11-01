import { canRunQueuedQualificationRescan, getOfficialSettlementAction } from '../master-entry-recovery';

describe('Master Entry official settlement handling', () => {
    it('keeps a locally resolved win accounting-only even while every-tick mode is on', () => {
        expect(getOfficialSettlementAction('win', true)).toBe('account-only');
    });

    it('keeps a locally resolved loss accounting-only so a pending recovery stays locked', () => {
        expect(getOfficialSettlementAction('loss', true)).toBe('account-only');
    });

    it('waits for the local tick result when every-tick mode is on and no local result exists', () => {
        expect(getOfficialSettlementAction(null, true)).toBe('await-local-result');
    });

    it('uses the official result only when local-result mode is not active', () => {
        expect(getOfficialSettlementAction(null, false)).toBe('apply-official-result');
    });
});

describe('Master Entry queued qualification rescans', () => {
    const clearState = {
        hasOpenTrade: false,
        buyInFlight: false,
        hasPendingRecovery: false,
        pendingSettlementCount: 0,
        awaitingLocalResult: false,
        hasUnsettledLocalWatch: false,
    };

    it('runs only after all trades, recoveries, and settlements are clear', () => {
        expect(canRunQueuedQualificationRescan(clearState)).toBe(true);
    });

    it.each([
        ['open trade', { hasOpenTrade: true }],
        ['buy in flight', { buyInFlight: true }],
        ['pending recovery', { hasPendingRecovery: true }],
        ['official settlement', { pendingSettlementCount: 1 }],
        ['local result', { awaitingLocalResult: true }],
        ['unsettled local watch', { hasUnsettledLocalWatch: true }],
    ])('defers while there is a %s', (_reason, blockedState) => {
        expect(canRunQueuedQualificationRescan({ ...clearState, ...blockedState })).toBe(false);
    });
});
