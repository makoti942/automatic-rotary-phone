/**
 * Pure analysis engine for the AI Analyst panel.
 * Computes REAL statistics from raw tick series (no guessing) and asks
 * Gemini to select a strategy strictly grounded in those numbers.
 */

export const VOLATILITY_LIST = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
] as const;

export type VolatilitySymbol = typeof VOLATILITY_LIST[number];

export type AiContractType =
    | 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';

export interface AiEntryTrigger {
    /** gap_reached = wait until `digit` absent for min_gap ticks; last_digit_equals = fire when newest tick ends in `digit`; immediate = fire at once */
    type: 'gap_reached' | 'last_digit_equals' | 'immediate';
    digit: number;
    min_gap: number;
}

export interface AiPlan {
    market: VolatilitySymbol;
    contract_type: AiContractType;
    barrier_digit: number | null;
    duration_ticks: number;
    entry_trigger: AiEntryTrigger;
    confidence: number;
    rationale: string;
    monitoring: string;
    risk_notes: string;
}

export interface SymbolStats {
    symbol: string;
    total_ticks: number;
    digit_pct: number[];
    transitions: { from: number; to: number; pct: number }[];
    mean_gap: number[];
    max_streaks: { digit: number; length: number }[];
    recent_drift: number[];
}

/** Default pip sizes for volatility indices (matches Deriv values). */
export function volPipSize(symbol: string): number {
    if (symbol.startsWith('1HZ')) return 2;
    switch (symbol) {
        case 'R_25': return 3;
        case 'R_75': return 4;
        case 'R_50': return 4;
        case 'R_100': return 2;
        default: return 3; // R_10
    }
}

function getDigit(price: number, pip: number): number {
    return Number(Number(price).toFixed(pip).slice(-1));
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function computeSymbolStats(symbol: string, prices: number[]): SymbolStats {
    const pip = volPipSize(symbol);
    const digits = prices.map(p => getDigit(p, pip)).filter(d => d >= 0 && d <= 9);
    const n = digits.length;

    // Digit percentages across the full window
    const counts = new Array(10).fill(0);
    digits.forEach(d => counts[d]++);
    const pct = counts.map(c => r1((c / n) * 100));

    // Transition matrix: P(next | current) — keep strongest pairs
    const transCount: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
    for (let i = 0; i < n - 1; i++) transCount[digits[i]][digits[i + 1]]++;
    const rowTotals = transCount.map(row => row.reduce((a, v) => a + v, 0));
    const transitions: { from: number; to: number; pct: number }[] = [];
    for (let f = 0; f < 10; f++) {
        for (let t = 0; t < 10; t++) {
            if (transCount[f][t] > 0 && rowTotals[f] > 0) {
                transitions.push({ from: f, to: t, pct: r1((transCount[f][t] / rowTotals[f]) * 100) });
            }
        }
    }
    transitions.sort((a, b) => b.pct - a.pct);

    // Gap analysis: average spacing between appearances of each digit
    const meanGap = new Array(10).fill(-1);
    for (let d = 0; d < 10; d++) {
        const idxs: number[] = [];
        digits.forEach((v, i) => { if (v === d) idxs.push(i); });
        if (idxs.length >= 2) {
            let sum = 0;
            for (let i = 1; i < idxs.length; i++) sum += idxs[i] - idxs[i - 1];
            meanGap[d] = r1(sum / (idxs.length - 1));
        }
    }

    // Streaks: longest consecutive runs per digit
    const bestStreak = new Array(10).fill(0);
    let cur = 1;
    for (let i = 1; i <= n; i++) {
        if (i < n && digits[i] === digits[i - 1]) cur++;
        else {
            if (cur > bestStreak[digits[i - 1]]) bestStreak[digits[i - 1]] = cur;
            cur = 1;
        }
    }
    const max_streaks = bestStreak
        .map((length, digit) => ({ digit, length }))
        .filter(s => s.length > 0)
        .sort((a, b) => b.length - a.length)
        .slice(0, 3);

    // Recent drift: last-50 percentage minus overall percentage per digit
    const recent = digits.slice(-50);
    const rc = new Array(10).fill(0);
    recent.forEach(d => rc[d]++);
    const rpct = rc.map(c => r1((c / Math.max(1, recent.length)) * 100));
    const recent_drift = rpct.map((p, i) => r1(p - pct[i]));

    return {
        symbol,
        total_ticks: n,
        digit_pct: pct,
        transitions: transitions.slice(0, 8),
        mean_gap: meanGap,
        max_streaks,
        recent_drift,
    };
}

const SYS_PROMPT =
    'You are a rigorous quantitative analyst specialising in digit statistics of Deriv ' +
    'volatility indices (synthetic random 1-tick-per-second price series). You receive EXACT ' +
    'statistics computed over the most recent 1000 ticks of 10 markets: per-digit frequency %, ' +
    'strongest digit-to-digit transition probabilities, mean gap (average tick distance between ' +
    'reappearances of a digit), longest streaks, and recent-50 drift vs baseline. ' +
    'RULES: Base every claim ONLY on the supplied numbers — zero speculation about hidden ' +
    'mechanics. A useful edge is small: uniform expectation is 10.00% per digit, so flag digits ' +
    'materially above/below that and transitions far above ~10%. Prefer DIGITDIFF when one digit ' +
    'is clearly hot (its absence is rare), DIGITMATCH only for an unusually cold digit with high ' +
    'mean gap, OVER/UNDER around extreme digits (0 or 9 edges), EVEN/ODD only on a real skew. ' +
    'Pick exactly ONE market and ONE contract. Set entry_trigger to maximise statistical sense: ' +
    '"gap_reached" waits until the chosen digit has been absent >= min_gap ticks (use its ' +
    'mean_gap as guide), "last_digit_equals" fires when the newest tick ends in your digit, ' +
    '"immediate" enters right away. duration_ticks must be 1-5 and justified by transition or ' +
    'streak data. confidence 0-100 must reflect how strong the numbers really are — be honest, ' +
    'weak edges get low confidence. Write rationale, monitoring and risk_notes as concrete, ' +
    'number-citing sentences. Respond ONLY with minified JSON matching the schema given.';

export function buildDigest(stats: SymbolStats[]): string {
    return JSON.stringify({
        note: 'uniform baseline = 10.00% per digit; drift = recent50% minus overall%',
        markets: stats,
    });
}

export function buildUserPrompt(digest: string): string {
    return (
        'Statistics (exact, last 1000 ticks):\n' + digest +
        '\n\nDecide the single best tradable setup. Respond ONLY with minified JSON: {' +
        '"market":"<one of the symbols>","contract_type":"DIGITMATCH|DIGITDIFF|DIGITOVER|DIGITUNDER|DIGITEVEN|DIGITODD",' +
        '"barrier_digit":<0-9 or null>,"duration_ticks":<1-5>,' +
        '"entry_trigger":{"type":"gap_reached|last_digit_equals|immediate","digit":<0-9>,"min_gap":<int>=0},' +
        '"confidence":<0-100>,"rationale":"...","monitoring":"...","risk_notes":"..."}'
    );
}

export function normalizePlan(raw: any): AiPlan {
    const market = VOLATILITY_LIST.includes(raw?.market)
        ? raw.market
        : VOLATILITY_LIST[0];
    const TYPES: AiContractType[] = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD'];
    const contract_type: AiContractType = TYPES.includes(raw?.contract_type) ? raw.contract_type : 'DIGITDIFF';
    const needsBarrier = contract_type !== 'DIGITEVEN' && contract_type !== 'DIGITODD';
    let barrier = Number(raw?.barrier_digit);
    const barrier_digit = needsBarrier
        ? (Number.isFinite(barrier) ? Math.min(9, Math.max(0, Math.round(barrier))) : 5)
        : null;
    const duration_ticks = Math.min(5, Math.max(1, Math.round(Number(raw?.duration_ticks)) || 1));
    const tTypes = ['gap_reached', 'last_digit_equals', 'immediate'];
    const trig = raw?.entry_trigger ?? {};
    const digit = Math.min(9, Math.max(0, Math.round(Number(trig.digit)) || 0));
    const min_gap = Math.max(0, Math.round(Number(trig.min_gap)) || 0);
    const type = tTypes.includes(trig.type) ? trig.type : 'immediate';
    return {
        market,
        contract_type,
        barrier_digit,
        duration_ticks,
        entry_trigger: { type, digit, min_gap },
        confidence: Math.min(100, Math.max(0, Math.round(Number(raw?.confidence)) || 0)),
        rationale: String(raw?.rationale ?? '').slice(0, 1200),
        monitoring: String(raw?.monitoring ?? '').slice(0, 800),
        risk_notes: String(raw?.risk_notes ?? '').slice(0, 800),
    };
}

/** Calls Gemini and returns a validated trading plan. Throws on HTTP/parse errors. */
export async function requestAiPlan(apiKey: string, stats: SymbolStats[]): Promise<AiPlan> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
        systemInstruction: { parts: [{ text: SYS_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(buildDigest(stats)) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
        let msg = `Gemini HTTP ${res.status}`;
        try {
            const j = await res.json();
            msg = j?.error?.message ?? msg;
        } catch (_) { /* keep status message */ }
        throw new Error(msg);
    }
    const j = await res.json();
    let text: string = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('AI returned no JSON plan.');
    return normalizePlan(JSON.parse(text.slice(start, end + 1)));
}
