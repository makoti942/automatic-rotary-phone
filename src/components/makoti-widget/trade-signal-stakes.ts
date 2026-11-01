const MIN_STAKE = 0.01;
const DEFAULT_MARTINGALE = 2;

export const normalizeTradeSignalStake = (value: unknown, fallback = 1): number => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < MIN_STAKE) return fallback;
    return Math.round((amount + Number.EPSILON * Math.max(1, Math.abs(amount))) * 100) / 100;
};

export const normalizeTradeSignalMartingale = (value: unknown): number => {
    const factor = Number(value);
    return Number.isFinite(factor) && factor >= 1 ? factor : DEFAULT_MARTINGALE;
};

export const getNextTradeSignalStake = (
    profit: unknown,
    settledStake: unknown,
    baseStake: unknown,
    martingale: unknown
): number => {
    const base = normalizeTradeSignalStake(baseStake, 1);
    const amount = normalizeTradeSignalStake(settledStake, base);
    const netProfit = Number(profit);
    if (Number.isFinite(netProfit) && netProfit > 0) return base;

    const factor = normalizeTradeSignalMartingale(martingale);
    const multipliedStake = amount * factor;
    const roundedStake = Math.round((multipliedStake + Number.EPSILON * Math.max(1, Math.abs(multipliedStake))) * 100) / 100;
    return Math.max(MIN_STAKE, roundedStake);
};
