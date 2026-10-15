export const getConfirmedTickDirection = (quotes, movementCount = 3) => {
    if (!Array.isArray(quotes) || movementCount < 1 || quotes.length < movementCount + 1) return '';

    const recentQuotes = quotes.slice(-(movementCount + 1)).map(Number);
    if (recentQuotes.some(quote => !Number.isFinite(quote))) return '';

    const movements = recentQuotes.slice(1).map((quote, index) => quote - recentQuotes[index]);
    if (movements.every(movement => movement > 0)) return 'rise';
    if (movements.every(movement => movement < 0)) return 'fall';
    return '';
};
