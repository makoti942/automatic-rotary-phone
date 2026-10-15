const positiveStake = value => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 1;
};

export const getConfirmedTickDirection = (quotes, movementCount = 3) => {
    if (!Array.isArray(quotes) || movementCount < 1 || quotes.length < movementCount + 1) return '';

    const recentQuotes = quotes.slice(-(movementCount + 1)).map(Number);
    if (recentQuotes.some(quote => !Number.isFinite(quote))) return '';

    const movements = recentQuotes.slice(1).map((quote, index) => quote - recentQuotes[index]);
    if (movements.every(movement => movement > 0)) return 'rise';
    if (movements.every(movement => movement < 0)) return 'fall';
    return '';
};

export const createDirectionalHedgePlan = (direction, stakes = {}) => {
    if (direction === 'rise') {
        return {
            legs: [
                { contract_type: 'PUT', duration: 1, stake: positiveStake(stakes.riseToFallStake) },
                { contract_type: 'RUNHIGH', duration: 2, stake: positiveStake(stakes.riseToOnlyUpsStake) },
            ],
            retry: {
                contract_type: 'PUT',
                duration: 1,
                stake: positiveStake(stakes.riseFallRetryStake),
            },
        };
    }

    if (direction === 'fall') {
        return {
            legs: [
                { contract_type: 'RUNLOW', duration: 2, stake: positiveStake(stakes.fallToOnlyDownsStake) },
                { contract_type: 'CALL', duration: 1, stake: positiveStake(stakes.fallToRiseStake) },
            ],
            retry: {
                contract_type: 'CALL',
                duration: 1,
                stake: positiveStake(stakes.fallRiseRetryStake),
            },
        };
    }

    return null;
};
