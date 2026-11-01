export type LocalTradeOutcome = 'win' | 'loss' | null | undefined;
export type OfficialSettlementAction = 'account-only' | 'await-local-result' | 'apply-official-result';
export type QualificationRescanState = {
    hasOpenTrade: boolean;
    buyInFlight: boolean;
    hasPendingRecovery: boolean;
    pendingSettlementCount: number;
    awaitingLocalResult: boolean;
    hasUnsettledLocalWatch: boolean;
};

/**
 * Once the Master Entry strategy has resolved a one-tick trade from market
 * ticks, its later official settlement must not change the recovery sequence
 * or volatility lock. Official settlement is only authoritative when no local
 * result was recorded (for example, when every-tick mode is disabled).
 */
export const getOfficialSettlementAction = (
    localOutcome: LocalTradeOutcome,
    everyTickMode: boolean
): OfficialSettlementAction => {
    if (localOutcome) return 'account-only';
    return everyTickMode ? 'await-local-result' : 'apply-official-result';
};

export const canRunQueuedQualificationRescan = (state: QualificationRescanState): boolean =>
    !state.hasOpenTrade &&
    !state.buyInFlight &&
    !state.hasPendingRecovery &&
    state.pendingSettlementCount === 0 &&
    !state.awaitingLocalResult &&
    !state.hasUnsettledLocalWatch;
