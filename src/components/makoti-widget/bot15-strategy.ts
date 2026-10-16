export type Bot15Direction = 'rise' | 'fall';

export type Bot15StakeConfig = {
    riseToFall: number;
    riseToOnlyUps: number;
    riseFallRetry: number;
    fallToOnlyDowns: number;
    fallToRise: number;
    fallRiseRetry: number;
};

export type Bot15Leg = {
    strategy: 'fall' | 'only_ups' | 'only_downs' | 'rise';
    contractType: 'PUT' | 'RUNHIGH' | 'RUNLOW' | 'CALL';
    duration: number;
    stake: number;
};

export type Bot15Plan = {
    legs: [Bot15Leg, Bot15Leg];
    retry: Bot15Leg;
};

const positiveStake = (value: number): number =>
    Number.isFinite(value) && value > 0 ? value : 1;

export const detectBot15Direction = (quotes: number[]): Bot15Direction | null => {
    if (!Array.isArray(quotes) || quotes.length < 3) return null;
    const recent = quotes.slice(-3).map(Number);
    if (recent.some(value => !Number.isFinite(value))) return null;
    if (recent[0] < recent[1] && recent[1] < recent[2]) return 'rise';
    if (recent[0] > recent[1] && recent[1] > recent[2]) return 'fall';
    return null;
};

export const createBot15Plan = (direction: Bot15Direction, stakes: Bot15StakeConfig): Bot15Plan => {
    if (direction === 'rise') {
        return {
            legs: [
                { strategy: 'fall', contractType: 'PUT', duration: 1, stake: positiveStake(stakes.riseToFall) },
                { strategy: 'only_ups', contractType: 'RUNHIGH', duration: 2, stake: positiveStake(stakes.riseToOnlyUps) },
            ],
            retry: { strategy: 'fall', contractType: 'PUT', duration: 1, stake: positiveStake(stakes.riseFallRetry) },
        };
    }
    return {
        legs: [
            { strategy: 'only_downs', contractType: 'RUNLOW', duration: 2, stake: positiveStake(stakes.fallToOnlyDowns) },
            { strategy: 'rise', contractType: 'CALL', duration: 1, stake: positiveStake(stakes.fallToRise) },
        ],
        retry: { strategy: 'rise', contractType: 'CALL', duration: 1, stake: positiveStake(stakes.fallRiseRetry) },
    };
};

export const isBot15DirectionalLoss = (contractType: 'CALL' | 'PUT', entryQuote: number, exitQuote: number): boolean | null => {
    const entry = Number(entryQuote);
    const exit = Number(exitQuote);
    if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;
    return contractType === 'CALL' ? exit <= entry : exit >= entry;
};
