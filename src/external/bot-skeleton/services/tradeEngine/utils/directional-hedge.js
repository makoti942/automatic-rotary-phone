const positiveStake = value => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 1;
};

export const getConfirmedTickDirection = (quotes, movementCount = 2) => {
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

export const isDirectionalTickLoss = (contractType, entryQuote, exitQuote) => {
    const entry = Number(entryQuote);
    const exit = Number(exitQuote);
    if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;
    if (contractType === 'CALL') return exit <= entry;
    if (contractType === 'PUT') return exit >= entry;
    return null;
};

export const getDirectionalOneTickOutcome = (contractType, entryQuote, entryEpoch, ticks) => {
    const entry = Number(entryQuote);
    const entryTime = Number(entryEpoch);
    if (!Number.isFinite(entry) || !Number.isFinite(entryTime) || !Array.isArray(ticks)) return null;

    let entryIndex = -1;
    ticks.forEach((tick, index) => {
        if (Number(tick?.epoch) === entryTime && Number(tick?.quote) === entry) entryIndex = index;
    });
    const exitTick =
        entryIndex >= 0 ? ticks[entryIndex + 1] : ticks.find(tick => Number(tick?.epoch) > entryTime);
    if (!exitTick) return null;

    const isLoss = isDirectionalTickLoss(contractType, entry, exitTick.quote);
    return isLoss === null ? null : { exitTick, isLoss };
};
