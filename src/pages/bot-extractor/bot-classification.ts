const BUILT_IN_BOT_IDENTIFIERS = new Set([
    '1 3 2 6',
    'accumulators dalembert',
    'accumulators dalembert on stat reset',
    'accumulators martingale',
    'accumulators martingale on stat reset',
    'accumulators reverse dalembert',
    'accumulators reverse dalembert on stat reset',
    'accumulators reverse martingale',
    'accumulators reverse martingale on stat reset',
    'dalembert',
    'dalembert max stake',
    'dbot collection',
    'martingale',
    'martingale max stake',
    'oscars grind',
    'oscars grind max stake',
    'reverse dalembert',
    'reverse martingale',
]);

function normalizeBotIdentifier(value: string | null | undefined): string {
    return (value || '')
        .toLowerCase()
        .replace(/[’']/g, '')
        .replace(/[_-]+/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isBuiltInBotName(name: string | null | undefined): boolean {
    const normalized = normalizeBotIdentifier(name);
    return BUILT_IN_BOT_IDENTIFIERS.has(normalized) || BUILT_IN_BOT_IDENTIFIERS.has(normalized.replace(/\s+(?:bot|strategy)$/, ''));
}

export function isBuiltInBotSource(source: string | null | undefined): boolean {
    if (!source) return false;
    const candidates = source.match(/https?:\/\/[^\s"'<>]+/gi) || [source];
    return candidates.some(candidate => {
        let pathname = candidate.split(/[?#]/)[0];
        try { pathname = new URL(candidate).pathname; } catch {}
        let filename = pathname.split(/[\\/]/).pop() || '';
        try { filename = decodeURIComponent(filename); } catch {}
        const identifier = filename
            .replace(/\.[a-f0-9]{6,}\.js$/i, '')
            .replace(/\.(?:js|xml)$/i, '')
            .replace(/-xml$/i, '');
        return isBuiltInBotName(identifier);
    });
}

export function isBuiltInBot(bot: { name?: string | null; source?: string | null }): boolean {
    return isBuiltInBotName(bot.name) || isBuiltInBotSource(bot.source);
}
